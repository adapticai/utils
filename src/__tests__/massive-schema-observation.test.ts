/**
 * Massive payloads are checked against their schemas, and a divergence is
 * reported rather than swallowed.
 *
 * This package carried complete zod schemas for these endpoints that no fetcher
 * used, so a vendor contract change could only be discovered after it had
 * already produced wrong numbers downstream. These tests pin both halves of the
 * fix: the check runs on the live fetch path, and it OBSERVES — a payload that
 * fails the schema is still returned to the caller, because this is the primary
 * real-time US-equities feed and a schema asserting more than the vendor
 * guarantees must not take the feed down mid-session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();

vi.mock("../misc-utils", () => ({
  fetchWithRetry: vi.fn(),
  hideApiKeyFromurl: vi.fn((url: string) => url),
  logIfDebug: vi.fn(),
  validateMassiveApiKey: vi.fn(),
}));
vi.mock("../utils/auth-validator", () => ({ validateMassiveApiKey: vi.fn() }));
vi.mock("../logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() }),
}));

import { fetchPrices } from "../massive";
import { fetchWithRetry } from "../misc-utils";

const mockFetch = vi.mocked(fetchWithRetry);

/** A well-formed single-ticker aggregates bar. */
const goodBar = {
  o: 150,
  h: 155,
  l: 149,
  c: 153,
  v: 10000,
  vw: 152,
  n: 500,
  t: 1736510400000,
};

const respond = (body: unknown): void => {
  mockFetch.mockResolvedValue({
    json: () => Promise.resolve(body),
  } as Response);
};

describe("Massive schema observation", () => {
  beforeEach(() => {
    warn.mockClear();
    mockFetch.mockReset();
  });

  it("stays silent on a well-formed payload", async () => {
    respond({ status: "OK", results: [goodBar] });

    const bars = await fetchPrices(
      { ticker: "AAPL", start: 1736424000000, multiplier: 1, timespan: "day" },
      { apiKey: "test-key" },
    );

    expect(bars).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts a bar without the derived vw/n statistics", async () => {
    // The vendor omits these for bars with too little activity to compute
    // them. Treating that as a divergence would cry wolf on valid data.
    const { vw: _vw, n: _n, ...thin } = goodBar;
    respond({ status: "OK", results: [thin] });

    const bars = await fetchPrices(
      { ticker: "AAPL", start: 1736424000000, multiplier: 1, timespan: "day" },
      { apiKey: "test-key" },
    );

    expect(bars).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a divergence when a price field changes type", async () => {
    respond({ status: "OK", results: [{ ...goodBar, c: "153" }] });

    await fetchPrices(
      { ticker: "AAPL", start: 1736424000000, multiplier: 1, timespan: "day" },
      { apiKey: "test-key" },
    );

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("diverged from its schema");
  });

  it("still returns the payload when it diverges — observe, never reject", async () => {
    respond({ status: "OK", results: [{ ...goodBar, c: "153" }] });

    const bars = await fetchPrices(
      { ticker: "AAPL", start: 1736424000000, multiplier: 1, timespan: "day" },
      { apiKey: "test-key" },
    );

    expect(warn).toHaveBeenCalled();
    expect(bars).toHaveLength(1);
  });

  it("stamps each bar with the symbol the envelope names", async () => {
    // Single-ticker aggregates carry the ticker on the envelope, not per bar.
    respond({ status: "OK", results: [goodBar] });

    const bars = await fetchPrices(
      { ticker: "MSFT", start: 1736424000000, multiplier: 1, timespan: "day" },
      { apiKey: "test-key" },
    );

    expect(bars[0]?.symbol).toBe("MSFT");
  });
});
