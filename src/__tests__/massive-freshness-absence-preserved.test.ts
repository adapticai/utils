/**
 * Pins that `fetchPricesWithFreshness` reports an UNMEASURED freshness as
 * absence — `status: null`, `receivedAt: null` — instead of fabricating a live
 * `"OK"` stamped with the current wall clock, while a measured response keeps
 * reporting exactly what was measured.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../misc-utils", () => ({
  fetchWithRetry: vi.fn(),
  hideApiKeyFromurl: vi.fn((url: string) =>
    url.replace(/apiKey=[^&]+/, "apiKey=***"),
  ),
  logIfDebug: vi.fn(),
  validateMassiveApiKey: vi.fn(),
}));

vi.mock("../utils/auth-validator", () => ({
  validateMassiveApiKey: vi.fn(),
}));

vi.mock("../logger", () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { fetchPricesWithFreshness } from "../massive";
import { fetchWithRetry } from "../misc-utils";

const mockFetchWithRetry = vi.mocked(fetchWithRetry);

const PARAMS = {
  ticker: "AAPL",
  start: 1736424000000,
  multiplier: 1,
  timespan: "minute",
};

const BAR = {
  T: "AAPL",
  o: 150,
  h: 155,
  l: 149,
  c: 153,
  v: 10000,
  vw: 152,
  n: 500,
  t: 1736510400000,
};

function respond(body: Record<string, unknown>): void {
  mockFetchWithRetry.mockResolvedValueOnce({
    json: () => Promise.resolve(body),
  } as Response);
}

describe("massive-freshness-absence-preserved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("an empty window carries no freshness measurement, so status and receivedAt are null, not 'OK' and now", async () => {
    respond({ status: "OK", results: [] });

    const result = await fetchPricesWithFreshness(PARAMS, {
      apiKey: "test-key",
    });

    expect(result.data).toEqual([]);
    expect(result.status).toBeNull();
    expect(result.receivedAt).toBeNull();
    expect(result.status).not.toBe("OK");
    expect(result.receivedAt).not.toBeInstanceOf(Date);
  });

  it("a measured live response still reports the measured 'OK' and the measured receipt instant", async () => {
    respond({ status: "OK", results: [BAR] });

    const result = await fetchPricesWithFreshness(PARAMS, {
      apiKey: "test-key",
    });

    expect(result.status).toBe("OK");
    expect(result.receivedAt).toBeInstanceOf(Date);
    expect(result.receivedAt).toBe(result.data[0]?._freshness?.receivedAt);
  });

  it("a measured delayed response still reports DELAYED with its receipt instant", async () => {
    respond({ status: "DELAYED", results: [BAR] });

    const result = await fetchPricesWithFreshness(PARAMS, {
      apiKey: "test-key",
    });

    expect(result.status).toBe("DELAYED");
    if (result.status !== "DELAYED") {
      throw new Error("expected a DELAYED result");
    }
    expect(result.receivedAt).toBe(result.data[0]?._freshness?.receivedAt);
    expect(result.delayedSince).toBeNull();
  });
});
