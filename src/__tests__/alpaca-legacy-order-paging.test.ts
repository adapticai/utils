/**
 * The legacy `getOrders` paging walk.
 *
 * WHY THIS FILE EXISTS. `src/alpaca/legacy/orders.ts` is exported from the
 * package index (`src/alpaca/index.ts` re-exports `./legacy`) and had no test
 * of its own, while carrying the same short-page termination that
 * `AlpacaTradingAPI.getOrders` carried: the walk stopped as soon as a page
 * returned fewer than `ORDER_CHUNK_SIZE` top-level orders. Fixing only the
 * path the engine happens to call today would leave the identical defect on
 * a public export for the next caller to find.
 *
 * The legacy walk was further behind than the other one: it had no
 * de-duplication, and it took the cursor from the LAST element of the page
 * rather than the oldest, which inverts under `direction: "asc"`. Those are
 * covered here too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger", () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// The credential seam is the single backend-coupled function in this package
// (utils engineering rule 4); stubbing it keeps this file pure.
vi.mock("../alpaca/legacy/auth", () => ({
  validateAuth: () =>
    Promise.resolve({
      APIKey: "test-key",
      APISecret: "test-secret",
      type: "PAPER",
    }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getOrders } from "../alpaca/legacy/orders";
import type { AlpacaAuth, AlpacaOrder } from "../types/alpaca-types";

const CHUNK = 500;
/** Mirrors MIN_PAGE_LENGTH_POSSIBLY_CAPPED in the module under test. */
const POSSIBLY_CAPPED = Math.ceil(CHUNK / 3); // 167

const auth = {
  alpacaApiKey: "test-key",
  alpacaApiSecret: "test-secret",
  type: "PAPER",
} as unknown as AlpacaAuth;

/** Orders with descending submitted_at, ids `${prefix}-<n>`. */
function makeOrders(
  count: number,
  prefix: string,
  startOffsetSeconds = 0,
): AlpacaOrder[] {
  const baseMs = Date.parse("2026-06-12T15:00:00.000Z");
  return Array.from({ length: count }, (_, i) => {
    const offset = startOffsetSeconds + i;
    return {
      id: `${prefix}-${i}`,
      symbol: "AAPL",
      status: "open",
      submitted_at: new Date(baseMs - offset * 1000).toISOString(),
    } as unknown as AlpacaOrder;
  });
}

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

const requestedUrl = (i: number) => String(mockFetch.mock.calls[i][0]);

describe("legacy getOrders paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps paging past a short page that could still be a capped one", async () => {
    // The discriminating case. Neither page reaches CHUNK, both are long
    // enough that nested legs could account for the shortfall, and history
    // continues behind both. The old rule returned only the first page.
    mockFetch
      .mockResolvedValueOnce(jsonResponse(makeOrders(300, "p1", 0)))
      .mockResolvedValueOnce(jsonResponse(makeOrders(200, "p2", 1000)))
      .mockResolvedValueOnce(jsonResponse([]));

    const result = await getOrders(auth, { status: "open", nested: true });

    expect(result).toHaveLength(500); // every order — correct
    expect(result).not.toHaveLength(300); // stopped on the first short page
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("stops on a page too short for nesting to explain, without a probe request", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(makeOrders(POSSIBLY_CAPPED - 1, "p1")),
    );

    const result = await getOrders(auth, { status: "open" });

    expect(result).toHaveLength(POSSIBLY_CAPPED - 1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates the boundary order that an inclusive `until` re-serves", async () => {
    const page1 = makeOrders(CHUNK, "p1", 0);
    const boundary = page1[page1.length - 1];
    mockFetch
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(
        jsonResponse([boundary, ...makeOrders(200, "p2", CHUNK + 1)]),
      )
      .mockResolvedValueOnce(jsonResponse([]));

    const result = await getOrders(auth, { status: "all" });

    expect(result).toHaveLength(CHUNK + 200);
    const ids = result.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("takes the cursor from the OLDEST order on the page, not the last element", async () => {
    // Ascending input: the last element is the NEWEST, so a cursor taken from
    // it would move `until` forward and re-request the same window.
    const ascending = makeOrders(CHUNK, "p1", 0).reverse();
    const oldest = ascending[0].submitted_at as string;
    mockFetch
      .mockResolvedValueOnce(jsonResponse(ascending))
      .mockResolvedValueOnce(jsonResponse([]));

    await getOrders(auth, { status: "all", direction: "asc" });

    expect(requestedUrl(1)).toContain(`until=${encodeURIComponent(oldest)}`);
  });

  it("ends when a page yields no order it has not already seen", async () => {
    const page1 = makeOrders(CHUNK, "p1", 0);
    mockFetch
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page1));

    const result = await getOrders(auth, { status: "all" });

    expect(result).toHaveLength(CHUNK);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws rather than returning a partial set when the cursor cannot narrow", async () => {
    const at = "2026-06-12T15:00:00.000Z";
    const flat = (prefix: string) =>
      makeOrders(CHUNK, prefix).map((o) => ({
        ...o,
        submitted_at: at,
      })) as AlpacaOrder[];
    mockFetch
      .mockResolvedValueOnce(jsonResponse(flat("p1")))
      .mockResolvedValueOnce(jsonResponse(flat("p2")));

    await expect(getOrders(auth, { status: "all" })).rejects.toThrow(
      /cannot page past/,
    );
  });

  it("throws when a full page of new orders carries no usable submitted_at", async () => {
    const undated = makeOrders(CHUNK, "p1").map((o) => ({
      ...o,
      submitted_at: undefined,
    })) as unknown as AlpacaOrder[];
    mockFetch.mockResolvedValueOnce(jsonResponse(undated));

    await expect(getOrders(auth, { status: "open" })).rejects.toThrow(
      /no usable submitted_at/,
    );
  });

  it("rejects an unparseable caller-supplied until instead of silently disabling the stall guard", async () => {
    await expect(
      getOrders(auth, { status: "all", until: "not-a-timestamp" }),
    ).rejects.toThrow(/unparseable/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
