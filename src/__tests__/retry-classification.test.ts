/**
 * B-0010 / F-0035 — retry classification must be decided by a **typed** HTTP
 * status or a typed error class, never by scanning the error text for a number.
 *
 * The defect this pins: `analyzeError` matched `/50[0-9]/` anywhere in the
 * message, so a 422 rejection whose body quoted a price ("502.50") was
 * classified as a 502 server error and the non-idempotent order POST was
 * re-sent. The mechanism — not the fixture — is what is removed: there is no
 * longer any path from message text to an HTTP status, so no message can
 * produce a status-derived retry, whatever numbers it contains.
 *
 * These tests assert the classification table by typed status, that every
 * text-only shape this repo throws (the `CLASS: status` sentinels, the
 * free-form vendor strings, and the two wave-1 review repros) yields
 * `status: null` / not-retryable, and that the same statuses are honoured as
 * soon as the throw site carries them typed.
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

describe("classifyRetryError — a status in message text is never a status", () => {
  /**
   * Every shape this repo actually throws with the status embedded in free
   * text, plus the two live repros the wave-1 review reproduced. None of them
   * may yield a status, and therefore none may yield a status-derived retry.
   */
  const textOnlyFailures: ReadonlyArray<{ label: string; message: string }> = [
    // src/alpaca/client.ts makeRequest sentinels.
    { label: "RATE_LIMIT sentinel", message: "RATE_LIMIT: 429:60000" },
    { label: "SERVER_ERROR sentinel", message: "SERVER_ERROR: 502" },
    { label: "AUTH_ERROR sentinel", message: "AUTH_ERROR: 401: bad key" },
    { label: "CLIENT_ERROR sentinel", message: "CLIENT_ERROR: 422: rejected" },
    // src/crypto.ts fetchers.
    {
      label: "crypto free-form 5xx",
      message: "Alpaca API error (503): upstream unavailable",
    },
    // src/alphavantage.ts fetchers.
    {
      label: "AlphaVantage free-form 429",
      message: "Failed to fetch quote for AAPL: 429",
    },
    // Wave-1 review repro 1: a 422 rejection whose FIRST standalone token is a
    // whole-number quantity, read by the deleted shim as HTTP 500.
    {
      label: "422 rejection quoting a whole-number quantity",
      message:
        "insufficient qty available (requested: 500, available: 100) — Alpaca API error (422)",
    },
    // Wave-1 review repro 2: a message carrying no HTTP status at all, read by
    // the deleted shim as HTTP 503.
    {
      label: "no status at all, only a status-shaped quantity",
      message: "Failed to create market order for AAPL: qty 503 exceeds position",
    },
    // The original F-0035 fixture.
    {
      label: "422 rejection quoting a price",
      message: "Order rejected: limit 502.50 vs last 499.10",
    },
  ];

  for (const { label, message } of textOnlyFailures) {
    it(`derives no status and no retry from ${label}`, () => {
      const details = classifyRetryError(new Error(message));
      expect(details.status).toBeNull();
      expect(details.type).toBe("UNKNOWN");
      expect(details.isRetryable).toBe(false);
      expect(details.retryAfter).toBeUndefined();
    });
  }

  it("honours the same statuses once the throw site carries them typed", () => {
    expect(classifyRetryError(axiosError(429, {})).isRetryable).toBe(true);
    expect(classifyRetryError(axiosError(503, {})).isRetryable).toBe(true);
    expect(classifyRetryError(axiosError(422, {})).isRetryable).toBe(false);
  });
});

describe("withRetry — what a text-only failure does end to end", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits exactly once for a free-form 5xx (no status ⇒ no retry)", async () => {
    const fn = vi.fn(async (): Promise<string> => {
      throw new Error("Alpaca API error (503): upstream unavailable");
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).rejects.toThrow(/503/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx that arrives on a typed carrier", async () => {
    let attempts = 0;
    const fn = vi.fn(async (): Promise<string> => {
      attempts += 1;
      if (attempts < 2) {
        throw axiosError(503, { message: "upstream unavailable" });
      }
      return "ok";
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("retries a 429 that arrives on a typed Response carrier", async () => {
    let attempts = 0;
    const fn = vi.fn(async (): Promise<string> => {
      attempts += 1;
      if (attempts < 2) {
        throw Object.assign(new Error("rate limited"), {
          response: new Response("slow down", { status: 429 }),
        });
      }
      return "ok";
    });
    const { settled } = await runWithRetry(fn);
    await expect(settled).resolves.toBe("ok");
    expect(attempts).toBe(2);
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
