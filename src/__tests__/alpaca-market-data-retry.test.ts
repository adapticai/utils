/**
 * Pins the transient-retry contract on Alpaca market-data reads
 * (U01-utils-lib-03): connection-phase faults (ECONNRESET class) retry up to 3
 * attempts with a limiter re-acquire per attempt; non-2xx HTTP responses and
 * non-GET methods never retry; client-deadline expiries retry at most once;
 * and a cumulative deadline budget refuses retries that cannot fit another
 * full-length attempt.
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

const acquireMock = vi.fn<() => Promise<void>>(() => Promise.resolve());
vi.mock("../rate-limiter", () => ({
  rateLimiters: {
    alpaca: {
      get acquire() {
        return acquireMock;
      },
    },
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { marketDataAPI } from "../alpaca-market-data-api";

/** Private-method access for the non-GET retry assertion. */
type MakeRequestAccess = {
  makeRequest: (endpoint: string, method: string) => Promise<unknown>;
};

function jsonResponse(data: unknown): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(data),
  };
}

function connectionResetError(): Error {
  return Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
}

function deadlineExpiryError(): Error {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
}

describe("AlpacaMarketDataAPI transient retry", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    acquireMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries ECONNRESET-class faults up to 3 attempts with a limiter re-acquire per attempt", async () => {
    mockFetch
      .mockRejectedValueOnce(connectionResetError())
      .mockRejectedValueOnce(connectionResetError())
      .mockResolvedValueOnce(jsonResponse({ symbol: "AAPL" }));

    await expect(marketDataAPI.getLastTrade("AAPL")).resolves.toEqual({
      symbol: "AAPL",
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(acquireMock).toHaveBeenCalledTimes(3);
  });

  it("never retries a non-2xx HTTP response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: () => Promise.resolve("upstream exploded"),
    });

    await expect(marketDataAPI.getLastTrade("AAPL")).rejects.toThrow(/500/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("never retries a non-GET request", async () => {
    mockFetch.mockRejectedValueOnce(connectionResetError());

    const api = marketDataAPI as unknown as MakeRequestAccess;
    await expect(api.makeRequest("/v2/anything", "POST")).rejects.toThrow(
      /ECONNRESET/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a client-deadline expiry at most once", async () => {
    mockFetch
      .mockRejectedValueOnce(deadlineExpiryError())
      .mockRejectedValueOnce(deadlineExpiryError());

    await expect(marketDataAPI.getLastTrade("AAPL")).rejects.toThrow(
      /timeout/i,
    );
    // First expiry consumed the single allowed deadline retry; the second
    // must throw instead of burning a third full-length attempt.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("refuses a retry that cannot fit another full-length attempt inside the total budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T15:00:00.000Z"));

    // A connection-phase fault (normally retried cheaply) surfacing only
    // after the elapsed clock ate the budget: elapsed + one more full
    // client timeout would exceed 1.5x the per-attempt timeout, so the
    // loop must throw rather than schedule attempt 2.
    mockFetch.mockImplementationOnce(() => {
      vi.setSystemTime(
        (vi.getMockedSystemTime() as Date).getTime() + 31_000,
      );
      return Promise.reject(connectionResetError());
    });

    await expect(marketDataAPI.getLastTrade("AAPL")).rejects.toThrow(
      /ECONNRESET/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
