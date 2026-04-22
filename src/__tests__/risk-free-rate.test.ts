import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  DEFAULT_RISK_FREE_RATE,
  RISK_FREE_RATE_TTL_MS,
  getRiskFreeRate,
  getCachedRiskFreeRateSync,
  setRiskFreeRate,
  resetRiskFreeRateCache,
} from "../risk-free-rate";

/**
 * Build a Response-like object the module's fetch path will accept. Only the
 * subset of properties the implementation reads are populated.
 */
function mockTreasuryResponse(
  rows: Array<{
    record_date: string;
    security_term_week_num: string;
    avg_inv_rate: string;
  }>,
  overrides: { ok?: boolean; status?: number; statusText?: string } = {},
): Response {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? "OK",
    json: async () => ({ data: rows }),
  } as unknown as Response;
}

describe("risk-free-rate", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetRiskFreeRateCache();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    resetRiskFreeRateCache();
  });

  describe("getRiskFreeRate", () => {
    it("fetches and normalizes the 13-week T-Bill rate from Treasury API", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockTreasuryResponse([
          {
            record_date: "2026-04-21",
            security_term_week_num: "4",
            avg_inv_rate: "4.20",
          },
          {
            record_date: "2026-04-21",
            security_term_week_num: "13",
            avg_inv_rate: "4.52",
          },
          {
            record_date: "2026-04-21",
            security_term_week_num: "26",
            avg_inv_rate: "4.35",
          },
        ]),
      );

      const rate = await getRiskFreeRate();
      expect(rate).toBeCloseTo(0.0452, 6);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("falls back to the first row when 13-week is missing", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockTreasuryResponse([
          {
            record_date: "2026-04-21",
            security_term_week_num: "4",
            avg_inv_rate: "4.10",
          },
        ]),
      );

      const rate = await getRiskFreeRate();
      expect(rate).toBeCloseTo(0.041, 6);
    });

    it("serves subsequent calls from cache without re-fetching", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockTreasuryResponse([
          {
            record_date: "2026-04-21",
            security_term_week_num: "13",
            avg_inv_rate: "4.52",
          },
        ]),
      );

      const a = await getRiskFreeRate();
      const b = await getRiskFreeRate();
      const c = await getRiskFreeRate();

      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent cold-cache fetches (single in-flight)", async () => {
      let resolveFetch: (res: Response) => void = () => undefined;
      fetchSpy.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      );

      const p1 = getRiskFreeRate();
      const p2 = getRiskFreeRate();
      const p3 = getRiskFreeRate();

      resolveFetch(
        mockTreasuryResponse([
          {
            record_date: "2026-04-21",
            security_term_week_num: "13",
            avg_inv_rate: "4.52",
          },
        ]),
      );

      const results = await Promise.all([p1, p2, p3]);
      expect(results[0]).toBeCloseTo(0.0452, 6);
      expect(results[1]).toBeCloseTo(0.0452, 6);
      expect(results[2]).toBeCloseTo(0.0452, 6);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("falls back to DEFAULT_RISK_FREE_RATE on network failure with no cache", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("ECONNRESET"));

      const rate = await getRiskFreeRate();
      expect(rate).toBe(DEFAULT_RISK_FREE_RATE);
    });

    it("falls back to DEFAULT_RISK_FREE_RATE on HTTP non-2xx with no cache", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockTreasuryResponse([], {
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        }),
      );

      const rate = await getRiskFreeRate();
      expect(rate).toBe(DEFAULT_RISK_FREE_RATE);
    });

    it("uses last-known-good cache when a later fetch fails", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockTreasuryResponse([
          {
            record_date: "2026-04-21",
            security_term_week_num: "13",
            avg_inv_rate: "4.52",
          },
        ]),
      );
      await getRiskFreeRate();

      // Simulate cache expiry by pushing time forward past the TTL.
      const advance = RISK_FREE_RATE_TTL_MS + 1000;
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + advance);

      fetchSpy.mockRejectedValueOnce(new Error("upstream down"));

      const rate = await getRiskFreeRate();
      expect(rate).toBeCloseTo(0.0452, 6);
      vi.useRealTimers();
    });

    it("throws when avg_inv_rate is non-numeric, then falls back", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockTreasuryResponse([
          {
            record_date: "2026-04-21",
            security_term_week_num: "13",
            avg_inv_rate: "not-a-number",
          },
        ]),
      );
      const rate = await getRiskFreeRate();
      expect(rate).toBe(DEFAULT_RISK_FREE_RATE);
    });

    it("falls back when API returns no rows", async () => {
      fetchSpy.mockResolvedValueOnce(mockTreasuryResponse([]));
      const rate = await getRiskFreeRate();
      expect(rate).toBe(DEFAULT_RISK_FREE_RATE);
    });
  });

  describe("setRiskFreeRate", () => {
    it("short-circuits getRiskFreeRate (no network call)", async () => {
      setRiskFreeRate(0.042);
      const rate = await getRiskFreeRate();
      expect(rate).toBe(0.042);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects negative, non-finite, or out-of-range rates", () => {
      expect(() => setRiskFreeRate(Number.NaN)).toThrow();
      expect(() => setRiskFreeRate(-0.01)).toThrow();
      expect(() => setRiskFreeRate(1.5)).toThrow();
      expect(() => setRiskFreeRate(Number.POSITIVE_INFINITY)).toThrow();
    });
  });

  describe("getCachedRiskFreeRateSync", () => {
    it("returns DEFAULT_RISK_FREE_RATE when no value is cached", () => {
      expect(getCachedRiskFreeRateSync()).toBe(DEFAULT_RISK_FREE_RATE);
    });

    it("returns the cached value once populated", () => {
      setRiskFreeRate(0.0475);
      expect(getCachedRiskFreeRateSync()).toBe(0.0475);
    });
  });
});
