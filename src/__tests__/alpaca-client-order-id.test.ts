/**
 * Pins the derived `client_order_id` idempotency contract on the order paths
 * (U01-utils-lib-01): derivation stability inside a 300s bucket, divergence
 * across buckets, explicit-id passthrough, `idempotencyNonce` discrimination,
 * and the 422 duplicate-rejection recovery matrix (idempotent return of a live
 * order, one salted resubmit over a terminally-dead order, typed error for
 * caller-supplied ids, and fail-closed when the status lookup fails).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { AlpacaTradingAPI } from "../alpaca-trading-api";
import { DuplicateClientOrderIdError } from "../errors";
import { AlpacaCredentials } from "../types/alpaca-types";

const testCredentials: AlpacaCredentials = {
  accountName: "test-account",
  apiKey: "test-api-key-123",
  apiSecret: "test-api-secret-123",
  type: "PAPER",
  orderType: "market",
  engine: "adaptic",
};

/** Derivation window from the implementation (5 minutes). */
const WINDOW_MS = 300_000;

/** Derived ids are "adaptic-" + 32 lowercase hex chars (40 chars total). */
const DERIVED_ID_PATTERN = /^adaptic-[0-9a-f]{32}$/;

function jsonResponse(data: unknown): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(data),
  };
}

function duplicate422Response(): Record<string, unknown> {
  return {
    ok: false,
    status: 422,
    headers: new Headers({ "content-type": "application/json" }),
    text: () =>
      Promise.resolve('{"message":"client order id must be unique"}'),
  };
}

function sentBody(callIndex: number): Record<string, unknown> {
  const init = mockFetch.mock.calls[callIndex][1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

function sentUrl(callIndex: number): string {
  return String(mockFetch.mock.calls[callIndex][0]);
}

describe("derived client_order_id", () => {
  let api: AlpacaTradingAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T15:00:00.000Z"));
    mockFetch.mockReset();
    api = new AlpacaTradingAPI(testCredentials);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is stable for identical params within one window bucket and matches the adaptic-hex shape", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "o1", status: "new" }));

    await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");
    vi.setSystemTime(vi.getMockedSystemTime()!.getTime() + 30_000);
    await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");

    const first = sentBody(0).client_order_id as string;
    const second = sentBody(1).client_order_id as string;
    expect(first).toMatch(DERIVED_ID_PATTERN);
    expect(second).toBe(first);
  });

  it("diverges across window buckets", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "o1", status: "new" }));

    await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");
    vi.setSystemTime(vi.getMockedSystemTime()!.getTime() + WINDOW_MS);
    await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");

    expect(sentBody(1).client_order_id).not.toBe(sentBody(0).client_order_id);
    expect(sentBody(1).client_order_id).toMatch(DERIVED_ID_PATTERN);
  });

  it("passes an explicit clientOrderId through verbatim", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "o1", status: "new" }));

    await api.createMarketOrder(
      "AAPL",
      10,
      "buy",
      "buy_to_open",
      "caller-key-7",
    );

    expect(sentBody(0).client_order_id).toBe("caller-key-7");
  });

  it("folds idempotencyNonce into the derived id so identical repeats in one bucket get distinct ids", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "o1", status: "new" }));

    await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open", undefined, 1);
    await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open", undefined, 2);

    const first = sentBody(0).client_order_id as string;
    const second = sentBody(1).client_order_id as string;
    expect(first).toMatch(DERIVED_ID_PATTERN);
    expect(second).toMatch(DERIVED_ID_PATTERN);
    expect(second).not.toBe(first);
  });
});

describe("422 duplicate recovery", () => {
  let api: AlpacaTradingAPI;

  beforeEach(() => {
    mockFetch.mockReset();
    api = new AlpacaTradingAPI(testCredentials);
  });

  it("returns the existing order as idempotent success when the colliding order is live", async () => {
    const existing = { id: "live-1", status: "accepted" };
    mockFetch
      .mockResolvedValueOnce(duplicate422Response())
      .mockResolvedValueOnce(jsonResponse(existing));

    const order = await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");

    expect(order.id).toBe("live-1");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sentUrl(1)).toContain("/orders:by_client_order_id?client_order_id=");
    expect(sentUrl(1)).toContain(
      encodeURIComponent(String(sentBody(0).client_order_id)),
    );
  });

  it("resubmits exactly once with a fresh salted id when the colliding order is terminally dead", async () => {
    mockFetch
      .mockResolvedValueOnce(duplicate422Response())
      .mockResolvedValueOnce(jsonResponse({ id: "dead-1", status: "canceled" }))
      .mockResolvedValueOnce(jsonResponse({ id: "fresh-1", status: "new" }));

    const order = await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");

    expect(order.id).toBe("fresh-1");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const originalId = sentBody(0).client_order_id as string;
    const saltedId = sentBody(2).client_order_id as string;
    expect(saltedId).toMatch(DERIVED_ID_PATTERN);
    expect(saltedId).not.toBe(originalId);
  });

  it("throws the typed error when the salted resubmit is itself rejected as a duplicate", async () => {
    mockFetch
      .mockResolvedValueOnce(duplicate422Response())
      .mockResolvedValueOnce(jsonResponse({ id: "dead-1", status: "expired" }))
      .mockResolvedValueOnce(duplicate422Response());

    await expect(
      api.createMarketOrder("AAPL", 10, "buy", "buy_to_open"),
    ).rejects.toBeInstanceOf(DuplicateClientOrderIdError);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("surfaces a typed DuplicateClientOrderIdError (wasDerived=false) for caller-supplied ids without recovery", async () => {
    mockFetch.mockResolvedValueOnce(duplicate422Response());

    const attempt = api.createMarketOrder(
      "AAPL",
      10,
      "buy",
      "buy_to_open",
      "caller-key-7",
    );
    await expect(attempt).rejects.toBeInstanceOf(DuplicateClientOrderIdError);
    await attempt.catch((error: DuplicateClientOrderIdError) => {
      expect(error.wasDerived).toBe(false);
      expect(error.clientOrderId).toBe("caller-key-7");
    });
    // No lookup, no resubmit: caller owns idempotency semantics.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed (typed error, no resubmit) when the duplicate-status lookup fails", async () => {
    mockFetch
      .mockResolvedValueOnce(duplicate422Response())
      .mockRejectedValueOnce(new Error("socket hang up"));

    const attempt = api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");
    await expect(attempt).rejects.toBeInstanceOf(DuplicateClientOrderIdError);
    await attempt.catch((error: DuplicateClientOrderIdError) => {
      expect(error.wasDerived).toBe(true);
    });
    // Exactly POST + failed GET — never a blind second POST.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not treat a non-duplicate 422 as recoverable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      headers: new Headers({ "content-type": "application/json" }),
      text: () => Promise.resolve('{"message":"insufficient buying power"}'),
    });

    await expect(
      api.createMarketOrder("AAPL", 10, "buy", "buy_to_open"),
    ).rejects.toThrow(/insufficient buying power/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
