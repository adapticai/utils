/**
 * B-0010 / F-0035 — retry classification must be decided by a **typed** HTTP
 * status or a typed error class, never by scanning the error text for a number.
 *
 * The defect this pins: `analyzeError` matched `/50[0-9]/` anywhere in the
 * message, so a 422 rejection whose body quoted a price ("502.50") was
 * classified as a 502 server error and the non-idempotent order POST was
 * re-sent. These tests assert the classification table by status, the
 * "502.50-in-a-422" regression in all three error shapes the repo actually
 * throws (sentinel prefix, free-form text, axios-shaped carrier), and that the
 * legitimate retry behaviour of the non-order fetch paths is preserved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withRetry,
  classifyRetryError,
  calculateRetryBackoff,
} from "../utils/retry";
import {
  AlpacaApiError,
  DuplicateClientOrderIdError,
  TimeoutError,
  ValidationError,
} from "../errors";

/** Retry budget used by every table case below. */
const MAX_RETRIES = 3;

/**
 * Drives `withRetry` with fake timers and returns the settled promise plus the
 * number of attempts the wrapped function saw.
 */
async function runWithRetry(
  fn: () => Promise<string>,
): Promise<{ settled: Promise<string> }> {
  const settled = withRetry(
    fn,
    { maxRetries: MAX_RETRIES, baseDelayMs: 10, maxDelayMs: 50 },
    "b-0010",
  );
  // Observe rejections immediately so a fail-fast rejection during the timer
  // drain is not reported as unhandled.
  void settled.catch(() => undefined);
  await vi.runAllTimersAsync();
  return { settled };
}

/** Builds an axios-shaped error (the shape the Alpaca SDK surfaces). */
function axiosError(status: number, body: unknown): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: body },
  });
}

describe("classifyRetryError — typed status table", () => {
  const cases: ReadonlyArray<{ status: number; retryable: boolean }> = [
    { status: 400, retryable: false },
    { status: 401, retryable: false },
    { status: 403, retryable: false },
    { status: 404, retryable: false },
    { status: 422, retryable: false },
    { status: 429, retryable: true },
    { status: 500, retryable: true },
    { status: 502, retryable: true },
    { status: 503, retryable: true },
    { status: 504, retryable: true },
  ];

  for (const { status, retryable } of cases) {
    it(`classifies HTTP ${status} as ${retryable ? "" : "non-"}retryable from a typed carrier`, () => {
      const details = classifyRetryError(axiosError(status, { message: "x" }));
      expect(details.status).toBe(status);
      expect(details.isRetryable).toBe(retryable);
    });
  }

  it("classifies a typed AlpacaApiError by its status, not its text", () => {
    const details = classifyRetryError(
      new AlpacaApiError("limit price 502.50 rejected", "ORDER_REJECTED", 422),
    );
    expect(details.status).toBe(422);
    expect(details.type).toBe("CLIENT_ERROR");
    expect(details.isRetryable).toBe(false);
  });

  it("never retries a duplicate client_order_id rejection", () => {
    const details = classifyRetryError(
      new DuplicateClientOrderIdError("dup", "trade-1", false),
    );
    expect(details.isRetryable).toBe(false);
  });

  it("uses the typed retryability flag when a typed error carries no status", () => {
    expect(classifyRetryError(new TimeoutError("slow", "alpaca", 30_000))
      .isRetryable).toBe(true);
    expect(
      classifyRetryError(new ValidationError("bad qty", "alpaca", "qty"))
        .isRetryable,
    ).toBe(false);
  });

  it("reads Retry-After from a typed Response carrier", () => {
    const response = new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "7" },
    });
    const details = classifyRetryError(
      Object.assign(new Error("RATE_LIMIT: 429"), { response }),
    );
    expect(details.type).toBe("RATE_LIMIT");
    expect(details.retryAfter).toBe(7000);
  });
});

describe("withRetry — the 502.50-in-a-422 regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const rejectionBody =
    '{"code":40010001,"message":"limit price 502.50 is more than 50% away from the market"}';

  it("does not retry a sentinel-prefixed 422 whose body quotes 502.50", async () => {
    const fn = vi.fn(async (): Promise<string> => {
      throw new Error(`CLIENT_ERROR: 422: ${rejectionBody}`);
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).rejects.toThrow(/422/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a free-form 422 whose body quotes 502.50", async () => {
    const fn = vi.fn(async (): Promise<string> => {
      throw new Error(`Alpaca API error (422): ${rejectionBody}`);
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).rejects.toThrow(/422/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry an axios-shaped 422 whose body quotes 502.50", async () => {
    const fn = vi.fn(async (): Promise<string> => {
      throw axiosError(422, JSON.parse(rejectionBody));
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).rejects.toThrow(/422/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("withRetry — preserved retry behaviour of the non-order paths", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("still retries the free-form 5xx thrown by the crypto/bars fetchers", async () => {
    let attempts = 0;
    const fn = vi.fn(async (): Promise<string> => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("Alpaca API error (503): upstream unavailable");
      }
      return "ok";
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("still retries the free-form 429 thrown by the AlphaVantage fetcher", async () => {
    let attempts = 0;
    const fn = vi.fn(async (): Promise<string> => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("Failed to fetch quote for AAPL: 429");
      }
      return "ok";
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("still retries the SERVER_ERROR sentinel thrown by makeRequest", async () => {
    let attempts = 0;
    const fn = vi.fn(async (): Promise<string> => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("SERVER_ERROR: 502");
      }
      return "ok";
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("still fails fast on the AUTH_ERROR sentinel", async () => {
    const fn = vi.fn(async (): Promise<string> => {
      throw new Error("AUTH_ERROR: 401: invalid credentials");
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("still honours the Retry-After encoded in the RATE_LIMIT sentinel", () => {
    const details = classifyRetryError(new Error("RATE_LIMIT: 429:60000"));
    expect(details.type).toBe("RATE_LIMIT");
    expect(details.retryAfter).toBe(60_000);
    expect(details.isRetryable).toBe(true);
  });

  it("still retries transient network errors that carry no status", async () => {
    let attempts = 0;
    const fn = vi.fn(async (): Promise<string> => {
      attempts += 1;
      if (attempts < 2) {
        throw Object.assign(new Error("socket hang up"), {
          code: "ECONNRESET",
        });
      }
      return "ok";
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does not invent a status from a price-shaped number", () => {
    const details = classifyRetryError(
      new Error("Order rejected: limit 502.50 vs last 499.10"),
    );
    expect(details.status).toBeNull();
    expect(details.type).toBe("UNKNOWN");
    expect(details.isRetryable).toBe(false);
  });
});

describe("calculateRetryBackoff — backoff, jitter and cap", () => {
  const BASE_MS = 1000;
  const MAX_MS = 30_000;
  /** Jitter is drawn from [0, 25%) of the capped delay. */
  const MAX_JITTER_FACTOR = 1.25;

  it("grows exponentially from the base delay", () => {
    expect(calculateRetryBackoff(1, BASE_MS, MAX_MS)).toBeGreaterThanOrEqual(
      BASE_MS,
    );
    expect(calculateRetryBackoff(3, BASE_MS, MAX_MS)).toBeGreaterThanOrEqual(
      BASE_MS * 4,
    );
  });

  it("caps the exponential term at the configured maximum", () => {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const delay = calculateRetryBackoff(attempt, BASE_MS, MAX_MS);
      expect(delay).toBeLessThanOrEqual(MAX_MS * MAX_JITTER_FACTOR);
    }
  });

  it("applies jitter so concurrent callers do not align", () => {
    const samples = new Set<number>();
    for (let i = 0; i < 50; i += 1) {
      samples.add(calculateRetryBackoff(3, BASE_MS, MAX_MS));
    }
    expect(samples.size).toBeGreaterThan(1);
  });
});
