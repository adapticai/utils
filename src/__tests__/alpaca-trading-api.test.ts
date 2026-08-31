import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing module under test.
// `ws` is an unresolved external in this package (provided by consumers),
// so it must be mocked for the module under test to load in vitest.
vi.mock("ws", () => ({
  default: class MockWebSocket {
    static readonly OPEN = 1;
  },
}));

vi.mock("../logging", () => ({
  log: vi.fn(),
}));

vi.mock("../alpaca-market-data-api", () => ({
  marketDataAPI: {},
}));

// Must mock fetch globally before imports
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { AlpacaTradingAPI } from "../alpaca-trading-api";
import { getAlpacaBrokerErrorCode } from "../errors";
import { AlpacaCredentials, AlpacaOrder } from "../types/alpaca-types";

const testCredentials: AlpacaCredentials = {
  accountName: "test-account",
  apiKey: "test-api-key-123",
  apiSecret: "test-api-secret-123",
  type: "PAPER",
  orderType: "market",
  engine: "adaptic",
};

/** Alpaca's maximum (and the wrapper's explicit default) GET /orders page size. */
const PAGE_LIMIT = 500;

/**
 * Builds a fake order with a deterministic id and submitted_at timestamp.
 * `offsetSeconds` is subtracted from a fixed base time so ids ascending map
 * to submitted_at descending (Alpaca's default sort).
 */
function makeOrder(id: string, offsetSeconds: number): AlpacaOrder {
  const baseMs = Date.parse("2026-06-12T15:00:00.000Z");
  return {
    id,
    symbol: "AAPL",
    status: "open",
    submitted_at: new Date(baseMs - offsetSeconds * 1000).toISOString(),
  } as unknown as AlpacaOrder;
}

/** Builds `count` descending-submitted_at orders with ids `${prefix}-<n>`. */
function makeOrders(
  count: number,
  prefix: string,
  startOffsetSeconds: number,
): AlpacaOrder[] {
  return Array.from({ length: count }, (_, i) =>
    makeOrder(`${prefix}-${i}`, startOffsetSeconds + i),
  );
}

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(data),
  };
}

function requestedUrl(callIndex: number): string {
  return String(mockFetch.mock.calls[callIndex][0]);
}

describe("AlpacaTradingAPI.getOrders", () => {
  let api: AlpacaTradingAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new AlpacaTradingAPI(testCredentials);
  });

  it("requests limit=500 explicitly when the caller omits limit (never Alpaca's silent 50 default)", async () => {
    const orders = makeOrders(3, "a", 0);
    mockFetch.mockResolvedValueOnce(jsonResponse(orders));

    const result = await api.getOrders({ status: "open", nested: true });

    expect(result).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = requestedUrl(0);
    expect(url).toContain(`limit=${PAGE_LIMIT}`);
    expect(url).toContain("status=open");
    expect(url).toContain("nested=true");
    // No synthesized cursor on the first page — the caller passed no until.
    expect(url).not.toContain("until=");
  });

  it("honors an explicit caller limit as a hard cap with a single request (no pagination)", async () => {
    const orders = makeOrders(100, "a", 0);
    mockFetch.mockResolvedValueOnce(jsonResponse(orders));

    const result = await api.getOrders({ status: "all", limit: 100 });

    expect(result).toHaveLength(100);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestedUrl(0)).toContain("limit=100");
  });

  it("paginates with an until cursor when a full page returns, terminating on a short page", async () => {
    const page1 = makeOrders(PAGE_LIMIT, "p1", 0);
    const page2 = makeOrders(3, "p2", PAGE_LIMIT + 1);
    mockFetch
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));

    const result = await api.getOrders({ status: "open" });

    expect(result).toHaveLength(PAGE_LIMIT + 3);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Page 2 cursor = oldest order on page 1 (until walks backwards for desc).
    const boundary = page1[page1.length - 1].submitted_at as string;
    expect(requestedUrl(1)).toContain(
      `until=${encodeURIComponent(boundary)}`,
    );
    expect(requestedUrl(1)).toContain(`limit=${PAGE_LIMIT}`);
  });

  it("dedups boundary orders by id when pages overlap at a shared timestamp", async () => {
    const page1 = makeOrders(PAGE_LIMIT, "p1", 0);
    // Page 2 re-returns the boundary order (same id) plus two new orders.
    const boundaryDuplicate = page1[page1.length - 1];
    const page2 = [
      boundaryDuplicate,
      makeOrder("p2-0", PAGE_LIMIT + 1),
      makeOrder("p2-1", PAGE_LIMIT + 2),
    ];
    mockFetch
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));

    const result = await api.getOrders({ status: "open" });

    expect(result).toHaveLength(PAGE_LIMIT + 2);
    const ids = result.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("terminates when a full page yields no new orders (cursor not advancing)", async () => {
    const page1 = makeOrders(PAGE_LIMIT, "p1", 0);
    mockFetch
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page1));

    const result = await api.getOrders({ status: "all" });

    expect(result).toHaveLength(PAGE_LIMIT);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("walks the after cursor for ascending direction", async () => {
    // Ascending: oldest first, so build ascending submitted_at.
    const page1 = makeOrders(PAGE_LIMIT, "p1", 0).reverse();
    const page2 = makeOrders(2, "p2", PAGE_LIMIT + 1);
    mockFetch
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));

    const result = await api.getOrders({ status: "all", direction: "asc" });

    expect(result).toHaveLength(PAGE_LIMIT + 2);
    const boundary = page1[page1.length - 1].submitted_at as string;
    expect(requestedUrl(1)).toContain(
      `after=${encodeURIComponent(boundary)}`,
    );
    expect(requestedUrl(1)).not.toContain("until=");
  });

  it("stops paginating when the boundary order has no usable submitted_at", async () => {
    const page1 = makeOrders(PAGE_LIMIT, "p1", 0);
    page1[page1.length - 1] = {
      ...page1[page1.length - 1],
      submitted_at: undefined,
    } as unknown as AlpacaOrder;
    mockFetch.mockResolvedValueOnce(jsonResponse(page1));

    const result = await api.getOrders({ status: "open" });

    expect(result).toHaveLength(PAGE_LIMIT);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("preserves a caller-supplied until as the initial cursor", async () => {
    const callerUntil = "2026-06-11T00:00:00.000Z";
    mockFetch.mockResolvedValueOnce(jsonResponse(makeOrders(1, "a", 0)));

    await api.getOrders({ status: "closed", until: callerUntil });

    expect(requestedUrl(0)).toContain(
      `until=${encodeURIComponent(callerUntil)}`,
    );
  });
});

describe("AlpacaTradingAPI bulk 207 Multi-Status handling", () => {
  let api: AlpacaTradingAPI;

  beforeEach(() => {
    mockFetch.mockReset();
    api = new AlpacaTradingAPI(testCredentials);
  });

  it("cancelAllOrders throws listing per-order failures from a mixed 207 body", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: "a", status: 200 },
        { id: "b", status: 500 },
      ]),
    );

    await expect(api.cancelAllOrders()).rejects.toThrow(/b:500/);
  });

  it("cancelAllOrders resolves when every per-order status is 2xx", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: "a", status: 200 },
        { id: "b", status: 200 },
      ]),
    );

    await expect(api.cancelAllOrders()).resolves.toBeUndefined();
  });

  it("cancelAllOrders resolves on an empty 204 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers({ "content-length": "0" }),
    });

    await expect(api.cancelAllOrders()).resolves.toBeUndefined();
  });

  it("closeAllPositions throws listing per-position failures from a mixed 207 body", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { symbol: "AAPL", status: 200 },
        { symbol: "TSLA", status: 500 },
      ]),
    );

    await expect(api.closeAllPositions()).rejects.toThrow(/TSLA:500/);
    expect(requestedUrl(0)).toContain("/positions?cancel_orders=true");
  });

  it("closeAllPositions resolves when every per-position status is 2xx", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ symbol: "AAPL", status: 200 }]),
    );

    await expect(api.closeAllPositions()).resolves.toBeUndefined();
  });
});

/**
 * U1 keystone — the class `makeRequest` (raw `fetch`) seam. This is the dominant
 * percent-trailing-stop tighten path (engine stop-execution → updateTrailingStop
 * → makeRequest) and the literal 08-20 defect site: a plain `new Error` dropped
 * the broker's `response.data`, so a stale-order `42210000` reached the engine
 * only as a lossy string. These pin that the numeric code is now structurally
 * recoverable while the thrown message stays byte-identical.
 */
describe("AlpacaTradingAPI broker-code preservation (makeRequest fetch seam)", () => {
  let api: AlpacaTradingAPI;

  /** Alpaca's stale-order-id reject body, exactly as the wire carries it. */
  const STALE_BODY = JSON.stringify({
    code: 42210000,
    message: "cannot replace order in pending_cancel status",
  });

  /** A non-ok fetch Response whose text() body is the raw broker payload. */
  function errorResponse(status: number, body: string) {
    return { ok: false, status, text: () => Promise.resolve(body) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    api = new AlpacaTradingAPI(testCredentials);
  });

  it("preserves 42210000 on the updateTrailingStop PATCH 422 (dominant tighten path), message byte-identical", async () => {
    const trailingStop = {
      id: "ts-1",
      symbol: "AAPL",
      type: "trailing_stop",
      trail_percent: "2.0",
      status: "open",
    } as unknown as AlpacaOrder;
    mockFetch
      .mockResolvedValueOnce(jsonResponse([trailingStop])) // GET /orders
      .mockResolvedValueOnce(errorResponse(422, STALE_BODY)); // PATCH /orders/ts-1

    const thrown = await api.updateTrailingStop("AAPL", 1.5).then(
      () => {
        throw new Error("expected updateTrailingStop to reject");
      },
      (e: unknown) => e as Error,
    );

    // Byte-identical: makeRequest re-thrown unchanged through updateTrailingStop.
    expect(thrown.message).toBe(`Alpaca API error (422): ${STALE_BODY}`);
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });

  it("preserves the broker code on any direct makeRequest 422 (getPositions), re-thrown unchanged", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(422, STALE_BODY));

    const thrown = await api.getPositions().then(
      () => {
        throw new Error("expected getPositions to reject");
      },
      (e: unknown) => e as Error,
    );

    expect(thrown.message).toBe(`Alpaca API error (422): ${STALE_BODY}`);
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });

  it("carries the broker code through cancelOrder's 'not cancelable' re-wrap, message byte-identical", async () => {
    const body = JSON.stringify({
      code: 42210000,
      message: "order is not cancelable",
    });
    mockFetch.mockResolvedValueOnce(errorResponse(422, body));

    const thrown = await api.cancelOrder("order-1").then(
      () => {
        throw new Error("expected cancelOrder to reject");
      },
      (e: unknown) => e as Error,
    );

    expect(thrown.message).toBe("Order order-1 is not cancelable");
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });
});
