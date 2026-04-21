import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry } from "../utils/retry";

describe("withRetry — classifier coverage for transient network errors", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const runWithRetry = async <T>(fn: () => Promise<T>) => {
    const promise = withRetry(
      fn,
      { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 },
      "test",
    );
    // Drain timers so backoff completes without real delay.
    await vi.runAllTimersAsync();
    return promise;
  };

  it("retries on AbortError (name-based)", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        const err = new Error("The user aborted a request.");
        err.name = "AbortError";
        throw err;
      }
      return "ok";
    });

    const result = await runWithRetry(fn);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("retries on TimeoutError (name-based)", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        const err = new Error("Operation timed out");
        err.name = "TimeoutError";
        throw err;
      }
      return "ok";
    });

    const result = await runWithRetry(fn);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("retries on ETIMEDOUT code", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        const err = new Error("connect ETIMEDOUT 10.0.0.1:443") as Error & {
          code: string;
        };
        err.code = "ETIMEDOUT";
        throw err;
      }
      return "ok";
    });

    const result = await runWithRetry(fn);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("retries on ECONNRESET code", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        const err = new Error("socket hang up") as Error & { code: string };
        err.code = "ECONNRESET";
        throw err;
      }
      return "ok";
    });

    const result = await runWithRetry(fn);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("retries on UND_ERR_CONNECT_TIMEOUT code", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        const err = new Error("Connect timeout") as Error & { code: string };
        err.code = "UND_ERR_CONNECT_TIMEOUT";
        throw err;
      }
      return "ok";
    });

    const result = await runWithRetry(fn);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("retries when network error is wrapped via error.cause", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        const cause = new Error("socket hang up") as Error & { code: string };
        cause.code = "ECONNRESET";
        const wrapper = new Error("Apollo request failed") as Error & {
          cause: unknown;
        };
        wrapper.cause = cause;
        throw wrapper;
      }
      return "ok";
    });

    const result = await runWithRetry(fn);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("retries on deeply nested cause chain (undici wraps inside fetch wraps inside Apollo)", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        const root = new Error("Body Timeout Error") as Error & {
          code: string;
        };
        root.code = "UND_ERR_BODY_TIMEOUT";
        const mid = new Error("fetch failed") as Error & { cause: unknown };
        mid.cause = root;
        const outer = new Error("Network error") as Error & { cause: unknown };
        outer.cause = mid;
        throw outer;
      }
      return "ok";
    });

    const result = await runWithRetry(fn);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("retries on message-based timeout pattern when no code/name is set", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error("The operation was aborted due to timeout");
      }
      return "ok";
    });

    const result = await runWithRetry(fn);
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does NOT retry on non-network errors (generic Error)", async () => {
    const fn = vi.fn(async () => {
      throw new Error("Something random went wrong");
    });

    await expect(runWithRetry(fn)).rejects.toThrow(
      "Something random went wrong",
    );
    // Should stop after 1 attempt (non-retryable)
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry when retryOnNetworkError is false", async () => {
    const fn = vi.fn(async () => {
      const err = new Error("connect ECONNRESET") as Error & { code: string };
      err.code = "ECONNRESET";
      throw err;
    });

    const promise = withRetry(
      fn,
      { maxRetries: 3, baseDelayMs: 10, retryOnNetworkError: false },
      "test",
    );
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("bounds cause-chain traversal so deeply nested non-retryable chains do not hang", async () => {
    // Build a 20-level deep chain of generic non-retryable errors. The
    // classifier caps traversal at MAX_CAUSE_DEPTH (6), so this must resolve
    // synchronously (as non-retryable) rather than walk the entire chain.
    let deepCause: Error = new Error("level-0 non-retryable");
    for (let i = 1; i < 20; i++) {
      const next = new Error(`level-${i} non-retryable`) as Error & {
        cause: unknown;
      };
      next.cause = deepCause;
      deepCause = next;
    }

    const fn = vi.fn(async () => {
      throw deepCause;
    });

    await expect(runWithRetry(fn)).rejects.toThrow();
    // Classifier returns non-retryable → stops after 1 attempt.
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
