/**
 * The provider guard's rate queue, and a caller that stops waiting in it.
 *
 * The guard is shared by every call this process makes to a provider, and
 * whether a caller's signal ends its wait for a rate token is that caller's
 * own choice, off unless it asks. So three things are pinned here. Nothing
 * changes for a caller that never stops waiting: a scripted sequence of
 * arrivals is admitted, queued and refused in a recorded order at recorded
 * instants, identically whether its callers hand over a signal or not and
 * whether or not they ask for the signal to end the rate wait. Nothing changes
 * either for a caller that stops waiting without having asked: it stays in the
 * rate queue, is granted the token it was waiting for and is refused at the
 * concurrency gate, at the recorded instants. And a caller that did ask leaves
 * the rate queue at once and takes no token, so the capacity it would have
 * wasted goes to the caller behind it.
 *
 * Every test runs on a faked clock, so an instant asserted here is the
 * guard's own arithmetic and not the scheduler's.
 *
 * @module __tests__/llm/rate-guard-signal
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

/** The provider with the tightest limits in the config, so every bound is reached quickly. */
const PROVIDER = "groq";

/**
 * Its limits as configured: thirty requests a minute refilling a bucket of
 * two, two calls at once, a ten second wait. The refill rate and the bucket's
 * size are separate numbers, and on this entry the bucket is the tighter of
 * the two bounds on an instant, so the script below is paced by it.
 */
const REQUESTS_PER_MINUTE = 30;
const BURST_CAPACITY = 2;
const MAX_CONCURRENT = 2;
const ACQUIRE_TIMEOUT_MS = 10_000;

/** One token accrues every two seconds at thirty a minute. */
const REFILL_INTERVAL_MS = 2_000;

/** The instant the faked clock starts at. */
const START_MS = Date.UTC(2026, 0, 5, 14, 30, 0);

/** How long the two opening calls hold their permits: long enough to outlast several refills. */
const OPENER_HOLD_MS = 5_000;

/** When the queued callers arrive: just after the openers, so no token lands on a caller's own deadline. */
const BURST_AT_MS = 100;

/** How many callers arrive at an emptied bucket. */
const QUEUED_CALLS = 7;

/** How long the first queued caller will wait for a permit once it holds a token. */
const BURST_WAIT_MS = 300;

/** When a caller arrives long after the burst, at a bucket that has recovered. */
const LATE_AT_MS = 12_000;

/** How long the scripted sequence is run for: past its last arrival and every wait. */
const SCRIPT_SPAN_MS = 25_000;

/** One scripted call: who makes it, when, how long it holds its permit and how long it will queue. */
interface ScriptedCall {
  readonly id: string;
  readonly atMs: number;
  readonly holdMs: number;
  readonly maxWaitMs?: number;
}

/** What became of a scripted call, and when. */
interface CallOutcome {
  readonly id: string;
  /** `ran`: admitted, at the instant its work began. Otherwise the bound that refused it. */
  readonly outcome: "ran" | "refused by rate" | "refused by concurrency";
  /** Milliseconds after the script began. */
  readonly atMs: number;
  /** Whether a refusal says the caller left, as opposed to the wait running out. */
  readonly abandoned?: boolean;
}

/**
 * The scripted sequence.
 *
 * Two openers that take the whole bucket and both permits and hold them past
 * several refills; seven callers arriving at the emptied bucket, admitted one
 * refill apart as tokens accrue, of which the first will not wait for a permit
 * and the last two cannot be granted a token inside the guard's own wait; and
 * one arrival long afterwards, at a bucket that has recovered.
 */
const SCRIPT: readonly ScriptedCall[] = [
  ...Array.from({ length: BURST_CAPACITY }, (_, index) => ({
    id: `opener-${String(index + 1)}`,
    atMs: 0,
    holdMs: OPENER_HOLD_MS,
  })),
  ...Array.from({ length: QUEUED_CALLS }, (_, index) => ({
    id: `queued-${String(index + 1)}`,
    atMs: BURST_AT_MS,
    holdMs: 0,
    // Only the first states a wait, so it is the one refused at the permit
    // queue while the openers still hold them; the rest wait out the guard's
    // own ten seconds for a token.
    ...(index === 0 ? { maxWaitMs: BURST_WAIT_MS } : {}),
  })),
  { id: "late", atMs: LATE_AT_MS, holdMs: 0 },
];

/**
 * What the scripted sequence is admitted and refused as, in the order it happens.
 *
 * Derived from the guard's two bounds and not from a recording: the bucket
 * holds two, so the openers run at once and empty it; a token accrues every
 * two seconds and is granted to the queued callers in the order they arrived;
 * the first of them holds a token at 2000 ms but will wait only 300 ms for a
 * permit the openers hold until 5000 ms, so it is refused there; the next four
 * are admitted at their tokens, the first of them once a permit frees; and the
 * last two queued for a token that cannot arrive before the guard's own ten
 * second wait runs out, so they are refused on the rate bound.
 */
const OUTCOMES: readonly CallOutcome[] = [
  { id: "opener-1", outcome: "ran", atMs: 0 },
  { id: "opener-2", outcome: "ran", atMs: 0 },
  { id: "queued-1", outcome: "refused by concurrency", atMs: REFILL_INTERVAL_MS + BURST_WAIT_MS, abandoned: false },
  { id: "queued-2", outcome: "ran", atMs: OPENER_HOLD_MS },
  { id: "queued-3", outcome: "ran", atMs: REFILL_INTERVAL_MS * 3 },
  { id: "queued-4", outcome: "ran", atMs: REFILL_INTERVAL_MS * 4 },
  { id: "queued-5", outcome: "ran", atMs: REFILL_INTERVAL_MS * 5 },
  { id: "queued-6", outcome: "refused by rate", atMs: BURST_AT_MS + ACQUIRE_TIMEOUT_MS, abandoned: false },
  { id: "queued-7", outcome: "refused by rate", atMs: BURST_AT_MS + ACQUIRE_TIMEOUT_MS, abandoned: false },
  { id: "late", outcome: "ran", atMs: LATE_AT_MS },
];

/**
 * Milliseconds since the faked clock started.
 *
 * @returns The elapsed time.
 */
function elapsedMs(): number {
  return Date.now() - START_MS;
}

/**
 * The guard's own account of itself.
 *
 * @returns Its snapshot, or `undefined` before any call has reached it.
 */
function guard(): GuardSnapshot | undefined {
  return guardSnapshots().find((entry) => entry.provider === PROVIDER);
}

/**
 * Make one call under the guard and record what became of it.
 *
 * @param call The scripted call.
 * @param record Where the outcome is written.
 * @param signal The caller's signal, when it has one.
 * @param signalEndsRateWait Whether the caller asks for its signal to end the wait for a rate token.
 * @returns A promise that settles once the call has ended, however it ended.
 */
function make(
  call: ScriptedCall,
  record: CallOutcome[],
  signal?: AbortSignal,
  signalEndsRateWait?: boolean,
): Promise<void> {
  return withProviderGuards(
    PROVIDER,
    async () => {
      record.push({ id: call.id, outcome: "ran", atMs: elapsedMs() });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, call.holdMs);
      });
    },
    call.maxWaitMs,
    {
      ...(signal === undefined ? {} : { signal }),
      ...(signalEndsRateWait === undefined ? {} : { signalEndsRateWait }),
    },
  ).catch((error: unknown) => {
    if (!(error instanceof RateGuardTimeoutError)) {
      throw error;
    }
    record.push({
      id: call.id,
      outcome: error.bound === "rate" ? "refused by rate" : "refused by concurrency",
      atMs: elapsedMs(),
      abandoned: error.abandoned,
    });
  });
}

/** What a run of the scripted sequence leaves behind. */
interface ScriptRun {
  readonly outcomes: readonly CallOutcome[];
  readonly guardAfter: GuardSnapshot | undefined;
  readonly timersLeft: number;
}

/**
 * Run the scripted sequence against fresh guards.
 *
 * @param signalFor The signal each caller hands over, or `undefined` for none.
 * @param signalEndsRateWait Whether every caller asks for its signal to end the rate wait.
 * @returns The outcomes in the order they happened, and what was left.
 */
async function runScript(
  signalFor: (id: string) => AbortSignal | undefined,
  signalEndsRateWait?: boolean,
): Promise<ScriptRun> {
  resetProviderGuards();
  vi.setSystemTime(START_MS);
  const outcomes: CallOutcome[] = [];
  const calls: Promise<void>[] = [];
  for (const call of SCRIPT) {
    setTimeout(() => {
      calls.push(make(call, outcomes, signalFor(call.id), signalEndsRateWait));
    }, call.atMs);
  }
  await vi.advanceTimersByTimeAsync(SCRIPT_SPAN_MS);
  await Promise.all(calls);
  return { outcomes, guardAfter: guard(), timersLeft: vi.getTimerCount() };
}

/**
 * Spend every token the guard's bucket holds, in one instant.
 *
 * @returns When the bucket is empty.
 */
async function drainBucket(): Promise<void> {
  // The bucket's SIZE, which the refill rate does not set: spending a minute's
  // allowance out of a bucket that never held one would queue on a token the
  // frozen clock is not going to produce.
  for (let token = 0; token < BURST_CAPACITY; token += 1) {
    await withProviderGuards(PROVIDER, () => Promise.resolve());
  }
  expect(guard()?.availableTokens).toBe(0);
}

describe("the provider guard's rate queue and the caller's signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
    resetProviderGuards();
  });

  afterEach(() => {
    resetProviderGuards();
    vi.useRealTimers();
  });

  it("is configured as the script assumes", () => {
    const limits = limitsFor(PROVIDER);
    expect(limits.requests_per_minute).toBe(REQUESTS_PER_MINUTE);
    expect(burstCapacityFor(limits)).toBe(BURST_CAPACITY);
    expect(limits.max_concurrent).toBe(MAX_CONCURRENT);
    expect(limits.acquire_timeout_ms).toBe(ACQUIRE_TIMEOUT_MS);
  });

  describe("a caller that never stops waiting", () => {
    it("admits, queues and refuses the scripted calls in the recorded order at the recorded instants when no signal is passed", async () => {
      const run = await runScript(() => undefined);

      expect(run.outcomes).toEqual(OUTCOMES);
      expect(run.guardAfter).toMatchObject({ inFlight: 0, rateQueueLength: 0, concurrencyQueueLength: 0 });
      expect(run.timersLeft).toBe(0);
    });

    it("does exactly the same when every caller passes a signal it never fires", async () => {
      const withSignals = await runScript(() => new AbortController().signal);
      const without = await runScript(() => undefined);

      expect(withSignals).toEqual(without);
      expect(withSignals.outcomes).toEqual(OUTCOMES);
    });

    it("does exactly the same when every caller also asks for that signal to end its wait for a rate token", async () => {
      const asking = await runScript(() => new AbortController().signal, true);
      const without = await runScript(() => undefined);

      expect(asking).toEqual(without);
      expect(asking.outcomes).toEqual(OUTCOMES);
    });

    it("does exactly the same when a caller asks for it and has no signal", async () => {
      const asking = await runScript(() => undefined, true);

      expect(asking.outcomes).toEqual(OUTCOMES);
    });
  });

  describe("callers that stop waiting", () => {
    /** When the first caller of the script fires its signal. */
    const LEFT_AT_MS = 500;

    /** When a caller whose signal has already fired arrives. */
    const ALREADY_GONE_AT_MS = 100;

    /** When a caller arrives after the others have been dealt with or are still queued. */
    const LATE_AT_MS = 4_500;

    /** How long the script is run for. */
    const SPAN_MS = 10_500;

    /**
     * Four callers at a drained bucket: one that leaves while queued for a
     * token, a live one behind it, one whose signal had fired before it
     * arrived, and a live one that arrives later.
     *
     * @param signalEndsRateWait What the two callers that leave ask of the guard.
     * @returns What became of each, in order, and the tokens left at the end.
     */
    const runLeavers = async (
      signalEndsRateWait: boolean | undefined,
    ): Promise<{ outcomes: CallOutcome[]; queueAfterLeaving: number | undefined; tokensAtEnd: number | undefined }> => {
      resetProviderGuards();
      vi.setSystemTime(START_MS);
      await drainBucket();
      const outcomes: CallOutcome[] = [];
      const leaves = new AbortController();
      const gone = new AbortController();
      gone.abort();
      const calls: Promise<void>[] = [
        make({ id: "leaves", atMs: 0, holdMs: 0 }, outcomes, leaves.signal, signalEndsRateWait),
        make({ id: "live", atMs: 0, holdMs: 0 }, outcomes),
      ];
      setTimeout(() => {
        calls.push(make({ id: "already-gone", atMs: ALREADY_GONE_AT_MS, holdMs: 0 }, outcomes, gone.signal, signalEndsRateWait));
      }, ALREADY_GONE_AT_MS);
      setTimeout(() => {
        calls.push(make({ id: "late", atMs: LATE_AT_MS, holdMs: 0 }, outcomes));
      }, LATE_AT_MS);
      await vi.advanceTimersByTimeAsync(LEFT_AT_MS);
      leaves.abort();
      const queueAfterLeaving = guard()?.rateQueueLength;
      await vi.advanceTimersByTimeAsync(SPAN_MS - LEFT_AT_MS);
      await Promise.all(calls);
      return { outcomes, queueAfterLeaving, tokensAtEnd: guard()?.availableTokens };
    };

    /**
     * What becomes of the four when nobody asks for the signal to end the rate
     * wait. Recorded from the guard as it stood before its rate queue could
     * hear a signal: each caller that has gone is still granted the token it
     * queued for, one refill apart, and is refused only then, at the
     * concurrency gate; the live callers wait behind them.
     */
    const AS_BEFORE: readonly CallOutcome[] = [
      { id: "leaves", outcome: "refused by concurrency", atMs: REFILL_INTERVAL_MS, abandoned: true },
      { id: "live", outcome: "ran", atMs: REFILL_INTERVAL_MS * 2 },
      { id: "already-gone", outcome: "refused by concurrency", atMs: REFILL_INTERVAL_MS * 3, abandoned: true },
      { id: "late", outcome: "ran", atMs: REFILL_INTERVAL_MS * 4 },
    ];

    it("stay in the rate queue and are granted the token they queued for, as before, unless they asked otherwise", async () => {
      const unset = await runLeavers(undefined);
      const declined = await runLeavers(false);

      expect(unset.outcomes).toEqual(AS_BEFORE);
      // The caller that left and the live one behind it are both still queued.
      expect(unset.queueAfterLeaving).toBe(3);
      expect(unset.tokensAtEnd).toBe(1);
      expect(declined).toEqual(unset);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("leave the rate queue at once and take no token when they asked for their signal to end the wait", async () => {
      const asked = await runLeavers(true);

      expect(asked.outcomes).toEqual([
        { id: "already-gone", outcome: "refused by rate", atMs: ALREADY_GONE_AT_MS, abandoned: true },
        { id: "leaves", outcome: "refused by rate", atMs: LEFT_AT_MS, abandoned: true },
        { id: "live", outcome: "ran", atMs: REFILL_INTERVAL_MS },
        { id: "late", outcome: "ran", atMs: LATE_AT_MS },
      ]);
      expect(asked.queueAfterLeaving).toBe(1);
      // Two tokens were spent where four were, and the two unspent ones are in
      // the bucket rather than four of them: a bucket holds what it was built
      // to hold, and this one is built to hold two, so the refill it does not
      // need accrues into a full bucket and stops there.
      expect(asked.tokensAtEnd).toBe(BURST_CAPACITY);
    });
  });

  describe("a caller that stops waiting for a rate token, having asked for its signal to end the wait", () => {
    it("leaves the rate queue at once, is refused as abandoned on the rate bound, and takes no token", async () => {
      /**
       * Let the bucket refill for two tokens' worth of time, with or without a
       * caller that queued for one and left.
       *
       * @param withAbandonedCaller Whether a caller queues and then leaves.
       * @returns What was recorded and what the bucket holds afterwards.
       */
      const refillRun = async (
        withAbandonedCaller: boolean,
      ): Promise<{ outcomes: CallOutcome[]; tokensAfter: number | undefined }> => {
        resetProviderGuards();
        vi.setSystemTime(START_MS);
        await drainBucket();
        const outcomes: CallOutcome[] = [];
        const caller = new AbortController();
        const calls: Promise<void>[] = [];
        if (withAbandonedCaller) {
          calls.push(make({ id: "gone", atMs: 0, holdMs: 0 }, outcomes, caller.signal, true));
          await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS / 4);
          expect(guard()?.rateQueueLength).toBe(1);
          caller.abort(new Error("the caller's own deadline passed"));
          expect(guard()?.rateQueueLength).toBe(0);
        }
        await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS * 2);
        await Promise.all(calls);
        return { outcomes, tokensAfter: guard()?.availableTokens };
      };

      const abandoned = await refillRun(true);
      const control = await refillRun(false);

      expect(abandoned.outcomes).toEqual([
        { id: "gone", outcome: "refused by rate", atMs: REFILL_INTERVAL_MS / 4, abandoned: true },
      ]);
      expect(control.outcomes).toEqual([]);
      expect(control.tokensAfter).toBe(2);
      expect(abandoned.tokensAfter).toBe(control.tokensAfter);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("says the caller left and that the provider was never contacted", async () => {
      await drainBucket();
      const caller = new AbortController();
      const refused = withProviderGuards(PROVIDER, () => Promise.resolve("served"), undefined, {
        signal: caller.signal,
        signalEndsRateWait: true,
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1);

      caller.abort();
      const error = await refused;

      expect(error).toBeInstanceOf(RateGuardTimeoutError);
      expect((error as RateGuardTimeoutError).bound).toBe("rate");
      expect((error as RateGuardTimeoutError).abandoned).toBe(true);
      expect((error as RateGuardTimeoutError).message).toContain("was left by its caller");
      expect((error as RateGuardTimeoutError).message).toContain("never contacted");
    });

    it("lets the caller behind it in at the instant it would have been admitted had the first never queued", async () => {
      /**
       * One live caller, queued behind a caller that leaves or alone.
       *
       * @param behindAbandoned Whether a caller that leaves is queued first.
       * @returns What was recorded.
       */
      const liveRun = async (behindAbandoned: boolean): Promise<CallOutcome[]> => {
        resetProviderGuards();
        vi.setSystemTime(START_MS);
        await drainBucket();
        const outcomes: CallOutcome[] = [];
        const caller = new AbortController();
        const calls: Promise<void>[] = [];
        if (behindAbandoned) {
          calls.push(make({ id: "gone", atMs: 0, holdMs: 0 }, outcomes, caller.signal, true));
        }
        calls.push(make({ id: "live", atMs: 0, holdMs: 0 }, outcomes));
        await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS / 2);
        caller.abort();
        await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS * 2);
        await Promise.all(calls);
        return outcomes;
      };

      const behindAbandoned = await liveRun(true);
      const alone = await liveRun(false);

      expect(alone).toEqual([{ id: "live", outcome: "ran", atMs: REFILL_INTERVAL_MS }]);
      expect(behindAbandoned).toEqual([
        { id: "gone", outcome: "refused by rate", atMs: REFILL_INTERVAL_MS / 2, abandoned: true },
        { id: "live", outcome: "ran", atMs: REFILL_INTERVAL_MS },
      ]);
    });

    it("is refused before a token is taken when its signal has already fired", async () => {
      const caller = new AbortController();
      caller.abort();
      let ran = false;

      const error = await withProviderGuards(
        PROVIDER,
        () => {
          ran = true;
          return Promise.resolve("served");
        },
        undefined,
        { signal: caller.signal, signalEndsRateWait: true },
      ).catch((raised: unknown) => raised);

      expect(error).toBeInstanceOf(RateGuardTimeoutError);
      expect((error as RateGuardTimeoutError).bound).toBe("rate");
      expect((error as RateGuardTimeoutError).abandoned).toBe(true);
      expect(ran).toBe(false);
      expect(guard()?.availableTokens).toBe(BURST_CAPACITY);
      expect(guard()?.inFlight ?? 0).toBe(0);
    });
  });
});
