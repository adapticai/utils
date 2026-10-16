/**
 * Tests for the unit a provider guard is keyed by, and for the guard's permit
 * accounting on every way a call can end.
 *
 * The permit tests hold a token in hand before each caller reaches the permit
 * queue, on a faked clock. That is not scaffolding but the guard's order: the
 * rate token is taken BEFORE the permit, and a bucket sized at the guard's own
 * concurrency ceiling is emptied by the very calls that saturate it, so a
 * caller arriving in that same instant waits for a token and never reaches the
 * permits at all. The permit queue is reached, in production as here, by a
 * caller that arrives once the bucket has refilled while earlier calls are
 * still in flight.
 *
 * Two properties are asserted here because each one, broken, produces the same
 * symptom in production — a healthy provider that the chain refuses to call.
 *
 * The first is the guard's UNIT. A provider that enforces its ceilings per
 * model gives each model its own ceiling; a client that holds one guard for the
 * whole provider enforces a limit the provider does not impose, and lets one
 * model's traffic refuse calls to another. When a chain's primary and secondary
 * live on the same provider, that shared guard skips the secondary at exactly
 * the moment the primary's queue is full, so the fallback that exists for that
 * moment is never reached.
 *
 * The second is that no settlement path — success, failure, a call cancelled in
 * flight, a waiter that times out, a waiter whose caller stops waiting — can
 * consume a permit it does not give back, and that a caller who stops waiting
 * leaves the queue at once rather than holding its place until its budget runs
 * out.
 *
 * @module __tests__/llm/rate-guard-permits
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RateGuardTimeoutError,
  burstCapacityFor,
  guardSnapshots,
  limitsFor,
  resetProviderGuards,
  withProviderGuards,
} from "../../llm/rate-guard";
import type { GuardSnapshot } from "../../llm/rate-guard";

/** A provider whose published ceilings apply per model. */
const PER_MODEL_PROVIDER = "deepinfra";

/** A provider that publishes no per-model unit, so one guard covers all its models. */
const PER_PROVIDER_PROVIDER = "groq";

/** Concurrency limit configured for groq; the tightest in the config. */
const GROQ_MAX_CONCURRENT = 2;

/** Milliseconds in a minute, for turning a per-minute refill into one token's wait. */
const MS_PER_MINUTE = 60_000;

/** Two distinct model ids on the same provider. */
const MODEL_A = "vendor/model-a";
const MODEL_B = "vendor/model-b";

/** Where DeepInfra publishes its rate limits. */
const DEEPINFRA_RATE_LIMITS_DOC = "https://docs.deepinfra.com/account/rate-limits";

/** DeepInfra's published default: "200 concurrent requests per model". */
const DEEPINFRA_PUBLISHED_CONCURRENT_PER_MODEL = 200;

/** Where Anthropic states that its limits apply separately for each model. */
const ANTHROPIC_RATE_LIMITS_DOC = "https://platform.claude.com/docs/en/api/rate-limits";

/** A wait short enough that a blocked caller gives up well inside the test's own budget. */
const SHORT_WAIT_MS = 40;

/**
 * A wait long enough that a caller still queued at the end of the test can only
 * have left early by abandoning, never by timing out.
 */
const LONG_WAIT_MS = 3_000;

/** Upper bound on how long an abandoning caller may take to leave the queue. */
const PROMPT_EXIT_MS = 500;

/** How long an in-flight call runs before its own budget cancels it. */
const IN_FLIGHT_BUDGET_MS = 5;

/** Calls in the burst that time out in flight; several times the limit, so leaks would compound. */
const TIMED_OUT_CALLS = 8;

/** Waiters abandoned per scenario, more than the limit so a leak cannot hide inside it. */
const QUEUED_WAITERS = 3;

/**
 * A promise plus the handle to settle it from outside, so calls can be held
 * open deterministically rather than by a timer the test would then be racing.
 *
 * @returns The deferred.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolveFn: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolveFn = resolvePromise;
  });
  return { promise, resolve: resolveFn };
}

/**
 * Yield one macrotask, so every admitted call has reached its body and every
 * refused one is queued. Microtask ticks are not enough: the rate token is
 * acquired asynchronously before the permit, and how many ticks that takes is
 * the limiter's business, not this test's.
 *
 * @returns Resolves on the next macrotask.
 */
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Yield one macrotask on a faked clock.
 *
 * @returns Resolves once pending work has run.
 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/**
 * Let a guard's bucket accrue whole tokens, on a faked clock.
 *
 * A token returns by the passage of time and by nothing else, so a test that
 * needs a caller to reach the permit queue has to wait for one exactly as a
 * caller does.
 *
 * @param provider The provider whose refill rate sets the wait.
 * @param tokens How many whole tokens to accrue.
 * @returns Resolves once they have.
 */
async function grantTokens(provider: string, tokens: number): Promise<void> {
  const oneTokenMs = MS_PER_MINUTE / limitsFor(provider).requests_per_minute;
  await vi.advanceTimersByTimeAsync(oneTokenMs * tokens);
}

/**
 * The snapshot of one guard.
 *
 * @param provider The provider.
 * @param modelId The model, for a per-model guard.
 * @returns Its snapshot, if the guard has been used.
 */
function snapshotOf(provider: string, modelId?: string): GuardSnapshot | undefined {
  return guardSnapshots().find(
    (entry) => entry.provider === provider && (modelId === undefined || entry.modelId === modelId),
  );
}

/**
 * Hold a guard's whole concurrency limit open.
 *
 * @param provider The provider.
 * @param count How many calls to hold.
 * @param modelId The model the calls address.
 * @returns The release handle and the held calls.
 */
function saturate(
  provider: string,
  count: number,
  modelId?: string,
): { release: () => void; held: Promise<void>[] } {
  const gate = deferred();
  const held = Array.from({ length: count }, () =>
    withProviderGuards(
      provider,
      async () => {
        await gate.promise;
      },
      undefined,
      { modelId },
    ),
  );
  return { release: gate.resolve, held };
}

describe("provider guard scope and permit accounting", () => {
  beforeEach(() => {
    resetProviderGuards();
  });

  afterEach(() => {
    resetProviderGuards();
  });

  describe("the unit a guard is keyed by", () => {
    it("gives each model of a per-model provider its own guard, so a saturated model never refuses a call to another", async () => {
      const { release, held } = saturate(
        PER_MODEL_PROVIDER,
        limitsFor(PER_MODEL_PROVIDER).max_concurrent,
        MODEL_A,
      );
      await nextMacrotask();

      const otherModel = await withProviderGuards(
        PER_MODEL_PROVIDER,
        async () => "served",
        SHORT_WAIT_MS,
        { modelId: MODEL_B },
      ).catch((error: unknown) => error);
      expect(otherModel).toBe("served");

      // Anti-vacuity: model A really is saturated, so the answer above came from
      // B's own guard and not from spare room in a shared one.
      const sameModel = await withProviderGuards(
        PER_MODEL_PROVIDER,
        async () => "served",
        SHORT_WAIT_MS,
        { modelId: MODEL_A },
      ).catch((error: unknown) => error);
      expect(sameModel).toBeInstanceOf(RateGuardTimeoutError);
      expect((sameModel as RateGuardTimeoutError).modelId).toBe(MODEL_A);

      release();
      await Promise.all(held);
    });

    it("keeps one guard across all models of a provider that publishes no per-model unit", async () => {
      const { release, held } = saturate(PER_PROVIDER_PROVIDER, GROQ_MAX_CONCURRENT, MODEL_A);
      await nextMacrotask();

      const otherModel = await withProviderGuards(
        PER_PROVIDER_PROVIDER,
        async () => "served",
        SHORT_WAIT_MS,
        { modelId: MODEL_B },
      ).catch((error: unknown) => error);
      expect(otherModel).toBeInstanceOf(RateGuardTimeoutError);

      release();
      await Promise.all(held);
    });

    it("holds DeepInfra to its published per-model ceiling and cites where it was read", () => {
      const limits = limitsFor(PER_MODEL_PROVIDER);
      expect(limits.basis).toBe("published");
      expect(limits.scope).toBe("model");
      expect(limits.max_concurrent).toBe(DEEPINFRA_PUBLISHED_CONCURRENT_PER_MODEL);
      expect(limits.source).toBe(DEEPINFRA_RATE_LIMITS_DOC);
      // DeepInfra publishes no per-minute ceiling, so the per-minute number is
      // the client's own choice and must not borrow the published label.
      expect(limits.requests_per_minute_basis).toBe("conservative-default");
    });

    it("keys Anthropic per model, as it publishes, while its unread tier keeps its numbers conservative", () => {
      const limits = limitsFor("anthropic");
      expect(limits.scope).toBe("model");
      expect(limits.scope_source).toBe(ANTHROPIC_RATE_LIMITS_DOC);
      expect(limits.basis).toBe("conservative-default");
    });
  });

  describe("a caller that stops waiting", () => {
    it("leaves the queue at once and never takes a permit", async () => {
      vi.useFakeTimers();
      const { release, held } = saturate(PER_PROVIDER_PROVIDER, GROQ_MAX_CONCURRENT);
      await settle();
      // The saturating calls spent this guard's bucket as well as its permits,
      // because the bucket holds exactly the concurrency ceiling. A caller
      // arriving now waits for a token and never reaches the permits, so the
      // permit queue this test is about is reached only once a token has
      // accrued behind the calls still in flight.
      await grantTokens(PER_PROVIDER_PROVIDER, 1);

      const controller = new AbortController();
      let ranAfterAbandoning = false;
      const startedAt = Date.now();
      const abandoned = withProviderGuards(
        PER_PROVIDER_PROVIDER,
        async () => {
          ranAfterAbandoning = true;
          return "served";
        },
        LONG_WAIT_MS,
        { signal: controller.signal },
      ).catch((error: unknown) => error);
      await settle();
      expect(snapshotOf(PER_PROVIDER_PROVIDER)?.concurrencyQueueLength).toBe(1);

      controller.abort(new Error("the caller's own deadline passed"));
      const outcome = await abandoned;
      const waitedMs = Date.now() - startedAt;

      expect(outcome).toBeInstanceOf(RateGuardTimeoutError);
      expect((outcome as RateGuardTimeoutError).message).toContain("never contacted");
      expect(waitedMs).toBeLessThan(PROMPT_EXIT_MS);
      expect(snapshotOf(PER_PROVIDER_PROVIDER)?.concurrencyQueueLength).toBe(0);

      release();
      await Promise.all(held);
      await settle();
      // A permit freed after the caller left must go to a caller still waiting,
      // not to one that has already given up.
      expect(ranAfterAbandoning).toBe(false);
      expect(snapshotOf(PER_PROVIDER_PROVIDER)?.inFlight).toBe(0);
      vi.useRealTimers();
    });

    it("is refused before taking a permit when its signal has already fired, even with permits free", async () => {
      const controller = new AbortController();
      controller.abort(new Error("already gone"));
      let ran = false;

      const outcome = await withProviderGuards(
        PER_PROVIDER_PROVIDER,
        async () => {
          ran = true;
          return "served";
        },
        SHORT_WAIT_MS,
        { signal: controller.signal },
      ).catch((error: unknown) => error);

      expect(outcome).toBeInstanceOf(RateGuardTimeoutError);
      expect(ran).toBe(false);
      expect(snapshotOf(PER_PROVIDER_PROVIDER)?.inFlight ?? 0).toBe(0);
    });
  });

  describe("permit accounting", () => {
    it("returns every permit however a call ends, so N timed-out, failed or abandoned calls never shrink the limit", async () => {
      const provider = PER_PROVIDER_PROVIDER;
      // Every call below takes a token before it takes a permit, and this
      // guard's bucket holds only its concurrency ceiling, so the clock is
      // faked and tokens are accrued where a caller would wait for one. What
      // is asserted is unchanged: whatever each call's fate, its permit comes
      // back, and the full limit is admitted at once at the end.
      vi.useFakeTimers();
      const capacity = burstCapacityFor(limitsFor(provider));
      expect(capacity).toBe(GROQ_MAX_CONCURRENT);

      // Success.
      await withProviderGuards(provider, async () => "ok");

      // Asynchronous failure.
      await withProviderGuards(provider, async () => {
        throw new Error("provider returned 500");
      }).catch(() => undefined);

      // Synchronous throw from the call itself, before any promise exists.
      await grantTokens(provider, 1);
      await withProviderGuards(provider, () => {
        throw new Error("threw before returning a promise");
      }).catch(() => undefined);

      // A burst of calls that each time out IN FLIGHT: the budget's abort ends
      // them while they hold a permit, several times over the limit.
      const timedOut = Array.from({ length: TIMED_OUT_CALLS }, () => {
        const controller = new AbortController();
        return withProviderGuards(
          provider,
          () =>
            new Promise<string>((_resolve, reject) => {
              setTimeout(() => controller.abort(new Error("leg budget exceeded")), IN_FLIGHT_BUDGET_MS);
              controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
                once: true,
              });
            }),
          undefined,
          { signal: controller.signal },
        ).catch(() => undefined);
      });
      await grantTokens(provider, TIMED_OUT_CALLS);
      await Promise.all(timedOut);

      // Waiters that time out in the queue. The blockers hold the permits; a
      // waiter reaches that queue once its own token has accrued, and is
      // refused there by its own wait budget.
      await grantTokens(provider, GROQ_MAX_CONCURRENT);
      const blockers = saturate(provider, GROQ_MAX_CONCURRENT);
      await settle();
      const queuedOut = Array.from({ length: QUEUED_WAITERS }, () =>
        withProviderGuards(provider, async () => "x", SHORT_WAIT_MS).catch(() => undefined),
      );
      await grantTokens(provider, QUEUED_WAITERS);
      // The last waiter's token arrives at the end of that stretch, and its own
      // wait budget runs from there, so the budget is given its time too.
      await vi.advanceTimersByTimeAsync(SHORT_WAIT_MS);
      await Promise.all(queuedOut);
      blockers.release();
      await Promise.all(blockers.held);

      // Waiters whose callers stop waiting. Those holding a token leave the
      // permit queue the moment they are abandoned; one still waiting for a
      // token is granted it, because the rate queue does not hear a signal
      // unless the caller asks, and is then refused at the gate as a caller
      // that has gone. Neither path consumes a permit.
      await grantTokens(provider, GROQ_MAX_CONCURRENT);
      const moreBlockers = saturate(provider, GROQ_MAX_CONCURRENT);
      await settle();
      const controllers = Array.from({ length: QUEUED_WAITERS }, () => new AbortController());
      const abandoned = controllers.map((controller) =>
        withProviderGuards(provider, async () => "x", LONG_WAIT_MS, {
          signal: controller.signal,
        }).catch(() => undefined),
      );
      await settle();
      for (const controller of controllers) {
        controller.abort(new Error("caller gave up"));
      }
      await grantTokens(provider, QUEUED_WAITERS);
      await vi.advanceTimersByTimeAsync(SHORT_WAIT_MS);
      await Promise.all(abandoned);
      moreBlockers.release();
      await Promise.all(moreBlockers.held);

      expect(snapshotOf(provider)?.inFlight).toBe(0);
      expect(snapshotOf(provider)?.concurrencyQueueLength).toBe(0);

      // The full limit is admitted at once: nothing above was kept.
      await grantTokens(provider, GROQ_MAX_CONCURRENT);
      const gate = deferred();
      let admitted = 0;
      const fresh = Array.from({ length: GROQ_MAX_CONCURRENT }, () =>
        withProviderGuards(
          provider,
          async () => {
            admitted += 1;
            await gate.promise;
          },
          SHORT_WAIT_MS,
        ),
      );
      await settle();
      expect(admitted).toBe(GROQ_MAX_CONCURRENT);
      gate.resolve();
      await Promise.all(fresh);
      vi.useRealTimers();
    });
  });
});
