import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  CircuitOpenError,
  fetchWithRetry,
  getCircuitBreakerSnapshot,
  hideApiKeyFromurl,
  resetCircuitBreaker,
} from "../misc-utils";

describe("hideApiKeyFromurl", () => {
  it("should mask apiKey parameter in URL", () => {
    const url = "https://api.example.com/data?apiKey=12341239856677";
    const result = hideApiKeyFromurl(url);

    expect(result).toContain("apiKey=12****77");
    expect(result).not.toContain("12341239856677");
  });

  it("should handle case-insensitive apiKey", () => {
    const url = "https://api.example.com/data?APIKEY=12341239856677";
    // The function checks for case-insensitive 'apikey'
    const result = hideApiKeyFromurl(url);

    // The key match is case-insensitive, but it preserves the original parameter name
    expect(result).not.toContain("12341239856677");
  });

  it("should preserve other query parameters", () => {
    const url =
      "https://api.example.com/data?symbol=AAPL&apiKey=12341239856677&limit=10";
    const result = hideApiKeyFromurl(url);

    expect(result).toContain("symbol=AAPL");
    expect(result).toContain("limit=10");
    expect(result).not.toContain("12341239856677");
  });

  it("should handle URL without apiKey parameter", () => {
    const url = "https://api.example.com/data?symbol=AAPL";
    const result = hideApiKeyFromurl(url);

    expect(result).toContain("symbol=AAPL");
  });

  it("should handle short API key (<= 4 characters)", () => {
    const url = "https://api.example.com/data?apiKey=AB";
    const result = hideApiKeyFromurl(url);

    expect(result).toContain("apiKey=AB");
  });

  it("should handle URL with no query parameters", () => {
    const url = "https://api.example.com/data";
    const result = hideApiKeyFromurl(url);

    expect(result).toBe("https://api.example.com/data");
  });

  it("should return original string for invalid URL", () => {
    const url = "not-a-valid-url";
    const result = hideApiKeyFromurl(url);

    expect(result).toBe("not-a-valid-url");
  });

  it("should handle URL with empty apiKey value", () => {
    const url = "https://api.example.com/data?apiKey=";
    const result = hideApiKeyFromurl(url);

    expect(result).toContain("apiKey=");
  });

  it("should handle URL with path segments", () => {
    const url =
      "https://api.example.com/v1/stocks/AAPL?apiKey=ABCDEFGHIJ123456";
    const result = hideApiKeyFromurl(url);

    expect(result).toContain("/v1/stocks/AAPL");
    expect(result).not.toContain("ABCDEFGHIJ123456");
    expect(result).toContain("AB****56");
  });

  it("should handle exactly 4 character apiKey", () => {
    const url = "https://api.example.com?apiKey=ABCD";
    const result = hideApiKeyFromurl(url);

    // Keys <= 4 chars are returned as-is
    expect(result).toContain("apiKey=ABCD");
  });

  it("should handle 5 character apiKey (masking applied)", () => {
    const url = "https://api.example.com?apiKey=ABCDE";
    const result = hideApiKeyFromurl(url);

    // Should mask: AB****DE
    expect(result).toContain("AB****DE");
  });
});

describe("per-host circuit breaker (fetchWithRetry)", () => {
  // We override global.fetch so tests can drive responses deterministically
  // without hitting the network. The breaker state lives in module-private
  // Maps so tests must reset between cases.
  const originalFetch = global.fetch;
  const TEST_HOST = "circuit-breaker-test.invalid";
  const TEST_URL = `https://${TEST_HOST}/v1/test`;

  beforeEach(() => {
    resetCircuitBreaker(TEST_HOST);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetCircuitBreaker(TEST_HOST);
  });

  function mockFetch(
    sequence: Array<{ ok: true } | { ok: false; status: number }>,
  ): ReturnType<typeof vi.fn> {
    let i = 0;
    const fn = vi.fn(async () => {
      const next = sequence[Math.min(i, sequence.length - 1)];
      i += 1;
      if (next.ok) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("", { status: next.status });
    });
    global.fetch = fn as unknown as typeof global.fetch;
    return fn;
  }

  it("trips after sustained 5xx upstream failures within the sliding window", async () => {
    // 12 consecutive 503 responses (well past the 0.6 ratio over the
    // 8-sample minimum). withRetry retries up to 3 times per call, so
    // we only need a handful of distinct fetchWithRetry invocations to
    // saturate the window.
    mockFetch([{ ok: false, status: 503 }]);

    // Drive enough attempts that the circuit breaker reaches the
    // CIRCUIT_MIN_SAMPLES threshold and the 60% failure ratio.
    // Each fetchWithRetry call performs up to 4 fetch invocations
    // (1 initial + 3 retries) with backoff between. Pass retries=0 so
    // each user-level call records exactly one failure outcome.
    for (let i = 0; i < 10; i++) {
      await expect(
        fetchWithRetry(TEST_URL, {}, /* retries */ 1),
      ).rejects.toThrow();
    }

    const snap = getCircuitBreakerSnapshot();
    expect(snap[TEST_HOST]).toBeDefined();
    expect(snap[TEST_HOST]?.open).toBe(true);
    expect(snap[TEST_HOST]?.lastTripFailureRatio).toBeGreaterThanOrEqual(0.6);
  });

  it("4xx client errors do NOT count as upstream failures (caller-side problem)", async () => {
    mockFetch([{ ok: false, status: 404 }]);

    for (let i = 0; i < 10; i++) {
      await expect(
        fetchWithRetry(TEST_URL, {}, /* retries */ 1),
      ).rejects.toThrow();
    }

    const snap = getCircuitBreakerSnapshot();
    // 4xx outcomes are RECORDED but as success (i.e. not upstream-unhealthy).
    // Breaker should NOT have tripped.
    expect(snap[TEST_HOST]?.open).toBe(false);
  });

  it("fail-fast: when open, throws CircuitOpenError without invoking fetch", async () => {
    // Pre-populate the breaker with 10 failures to force-open it.
    const fetchMock = mockFetch([{ ok: false, status: 503 }]);
    for (let i = 0; i < 10; i++) {
      await expect(
        fetchWithRetry(TEST_URL, {}, /* retries */ 1),
      ).rejects.toThrow();
    }
    expect(getCircuitBreakerSnapshot()[TEST_HOST]?.open).toBe(true);

    fetchMock.mockClear();

    // Next call should fail-fast and NOT touch fetch.
    await expect(fetchWithRetry(TEST_URL)).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getCircuitBreakerSnapshot exposes the open state with diagnostic fields", async () => {
    mockFetch([{ ok: false, status: 502 }]);
    for (let i = 0; i < 10; i++) {
      await expect(
        fetchWithRetry(TEST_URL, {}, /* retries */ 1),
      ).rejects.toThrow();
    }

    const snap = getCircuitBreakerSnapshot();
    const entry = snap[TEST_HOST];
    expect(entry).toBeDefined();
    expect(entry!.open).toBe(true);
    expect(entry!.openedAt).toBeGreaterThan(0);
    expect(entry!.recentSamples).toBeGreaterThanOrEqual(8);
    expect(entry!.failureRatio).toBeGreaterThanOrEqual(0.6);
    expect(entry!.cooldownRemainingMs).toBeGreaterThan(0);
    expect(entry!.cooldownRemainingMs).toBeLessThanOrEqual(5_000);
  });

  it("resetCircuitBreaker force-closes a stuck-open breaker", async () => {
    mockFetch([{ ok: false, status: 503 }]);
    for (let i = 0; i < 10; i++) {
      await expect(
        fetchWithRetry(TEST_URL, {}, /* retries */ 1),
      ).rejects.toThrow();
    }
    expect(getCircuitBreakerSnapshot()[TEST_HOST]?.open).toBe(true);

    resetCircuitBreaker(TEST_HOST);
    expect(getCircuitBreakerSnapshot()[TEST_HOST]?.open).toBe(false);
  });
});
