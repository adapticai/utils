/**
 * Tests for the per-provider rate and concurrency guards (W4-04).
 *
 * The guards exist so the client's own pacing is never mistaken for provider
 * ill-health, so the properties worth asserting are the ones that would let
 * that confusion back in: that the bounds actually bind, that a caller's wait
 * is bounded by its own budget rather than the guard's, that an abandoned
 * waiter does not permanently consume a permit, and that a guard timeout is
 * classified as our problem rather than the provider's.
 *
 * @module __tests__/llm/rate-guard
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  RateGuardTimeoutError,
  guardSnapshots,
  limitsFor,
  limitsInventory,
  resetProviderGuards,
  withProviderGuards,
} from "../../llm/rate-guard";

/** A provider key absent from the limits config, used to exercise the default path. */
const UNREGISTERED_PROVIDER = "provider-that-does-not-exist";

/** Concurrency limit configured for groq; the tightest in the config. */
const GROQ_MAX_CONCURRENT = 2;

/** A wait short enough that a blocked caller gives up well inside the test's own budget. */
const SHORT_WAIT_MS = 40;

/**
 * A promise plus the handles needed to settle it from outside.
 *
 * Used to hold calls open deterministically. Holding them with a timer would
 * make the test measure the scheduler rather than the guard.
 *
 * @returns The deferred.
 */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolveFn: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolveFn = resolvePromise;
  });
  return { promise, resolve: resolveFn };
}

describe("provider rate and concurrency guards", () => {
  beforeEach(() => {
    resetProviderGuards();
  });

  afterEach(() => {
    resetProviderGuards();
    vi.useRealTimers();
  });

  describe("limits configuration", () => {
    it("resolves an unregistered provider to the conservative defaults rather than to no limit", () => {
      const limits = limitsFor(UNREGISTERED_PROVIDER);
      expect(limits.requests_per_minute).toBeGreaterThan(0);
      expect(limits.max_concurrent).toBeGreaterThan(0);
      expect(limits.basis).toBe("conservative-default");
    });

    it("states the basis of every configured limit, so a guess never reads as a published ceiling", () => {
      const inventory = limitsInventory();
      expect(inventory.length).toBeGreaterThan(0);
      for (const entry of inventory) {
        expect(["published", "conservative-default"]).toContain(entry.limits.basis);
        if (entry.limits.basis === "published") {
          // A published limit must say where it was read from; otherwise it is a
          // conservative default wearing a more confident label.
          expect(entry.limits.source).toBeTruthy();
        }
      }
    });

    it("holds the hot-path provider tighter than the shared default, because a hot-path caller cannot afford to queue", () => {
      expect(limitsFor("groq").max_concurrent).toBeLessThanOrEqual(
        limitsFor(UNREGISTERED_PROVIDER).max_concurrent,
      );
    });
  });

  describe("concurrency bound", () => {
    it("admits up to the limit and makes the next caller wait", async () => {
      const held = deferred();
      let admitted = 0;

      const inflight = Array.from({ length: GROQ_MAX_CONCURRENT }, () =>
        withProviderGuards("groq", async () => {
          admitted += 1;
          await held.promise;
        }),
      );

      // Let the admitted calls reach their bodies before asserting.
      await Promise.resolve();
      await Promise.resolve();
      expect(admitted).toBe(GROQ_MAX_CONCURRENT);

      let thirdAdmitted = false;
      const third = withProviderGuards(
        "groq",
        async () => {
          thirdAdmitted = true;
        },
        SHORT_WAIT_MS,
      ).catch((error: unknown) => error);

      await new Promise((resolve) => setTimeout(resolve, SHORT_WAIT_MS / 2));
      expect(thirdAdmitted).toBe(false);

      held.resolve();
      await Promise.all(inflight);
      await third;
      expect(thirdAdmitted).toBe(true);
    });

    it("rejects a caller that cannot be admitted within its own budget", async () => {
      const held = deferred();
      const inflight = Array.from({ length: GROQ_MAX_CONCURRENT }, () =>
        withProviderGuards("groq", async () => {
          await held.promise;
        }),
      );
      await Promise.resolve();
      await Promise.resolve();

      const result = await withProviderGuards("groq", async () => "served", SHORT_WAIT_MS).catch(
        (error: unknown) => error,
      );

      expect(result).toBeInstanceOf(RateGuardTimeoutError);
      expect((result as RateGuardTimeoutError).bound).toBe("concurrency");
      expect((result as RateGuardTimeoutError).provider).toBe("groq");

      held.resolve();
      await Promise.all(inflight);
    });

    it("says plainly that the provider was never contacted, so the chain does not read it as ill-health", async () => {
      const held = deferred();
      const inflight = Array.from({ length: GROQ_MAX_CONCURRENT }, () =>
        withProviderGuards("groq", async () => {
          await held.promise;
        }),
      );
      await Promise.resolve();
      await Promise.resolve();

      const error = (await withProviderGuards("groq", async () => "x", SHORT_WAIT_MS).catch(
        (caught: unknown) => caught,
      )) as RateGuardTimeoutError;

      expect(error.message).toContain("never contacted");

      held.resolve();
      await Promise.all(inflight);
    });

    it("releases its permit when the guarded call throws, so a burst of failures does not shrink the limit", async () => {
      for (let attempt = 0; attempt < GROQ_MAX_CONCURRENT * 2; attempt += 1) {
        const outcome = await withProviderGuards("groq", async () => {
          throw new Error("provider exploded");
        }).catch((error: unknown) => error);
        expect(outcome).toBeInstanceOf(Error);
      }

      // If permits leaked, this call would queue and time out instead of running.
      const served = await withProviderGuards("groq", async () => "served", SHORT_WAIT_MS);
      expect(served).toBe("served");
    });

    it("does not leave an abandoned waiter holding a permit", async () => {
      const held = deferred();
      const inflight = Array.from({ length: GROQ_MAX_CONCURRENT }, () =>
        withProviderGuards("groq", async () => {
          await held.promise;
        }),
      );
      await Promise.resolve();
      await Promise.resolve();

      // Abandon a waiter by letting it time out.
      await withProviderGuards("groq", async () => "x", SHORT_WAIT_MS).catch(() => undefined);
      held.resolve();
      await Promise.all(inflight);

      const snapshot = guardSnapshots().find((entry) => entry.provider === "groq");
      expect(snapshot?.inFlight).toBe(0);
      expect(snapshot?.concurrencyQueueLength).toBe(0);
    });
  });

  describe("wait budget", () => {
    it("never queues a caller longer than the budget it was given, even when the guard would allow more", async () => {
      const configured = limitsFor("groq").acquire_timeout_ms;
      expect(configured).toBeGreaterThan(SHORT_WAIT_MS);

      const held = deferred();
      const inflight = Array.from({ length: GROQ_MAX_CONCURRENT }, () =>
        withProviderGuards("groq", async () => {
          await held.promise;
        }),
      );
      await Promise.resolve();
      await Promise.resolve();

      const startedAt = Date.now();
      await withProviderGuards("groq", async () => "x", SHORT_WAIT_MS).catch(() => undefined);
      const waited = Date.now() - startedAt;

      // The caller's budget governs, not the guard's more generous configured
      // timeout: queue time is spent from the same deadline as the call itself.
      expect(waited).toBeLessThan(configured);

      held.resolve();
      await Promise.all(inflight);
    });
  });

  describe("observability", () => {
    it("reports a snapshot per provider that has been used, and none for one that has not", async () => {
      await withProviderGuards("deepseek", async () => "served");
      const providers = guardSnapshots().map((entry) => entry.provider);
      expect(providers).toContain("deepseek");
      expect(providers).not.toContain("zai");
    });

    it("surfaces whether a provider is running on a published ceiling or a conservative guess", async () => {
      await withProviderGuards("anthropic", async () => "served");
      const snapshot = guardSnapshots().find((entry) => entry.provider === "anthropic");
      expect(snapshot).toBeDefined();
      expect(["published", "conservative-default"]).toContain(snapshot?.basis);
    });
  });
});
