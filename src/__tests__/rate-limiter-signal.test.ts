/**
 * The token wait of the rate limiter, and a caller that stops waiting.
 *
 * A limiter is shared by every caller of one upstream service, so two things
 * are pinned here. The first is that handing the wait a signal changes nothing
 * for a caller that never fires it: the same arrivals are admitted in the same
 * order at the same instants, with a signal or without one, and the instants
 * themselves are written down so a change to either path shows. The second is
 * what the signal is for: a waiter whose caller has gone leaves the queue at
 * once, takes no token, and leaves neither a timer nor a listener behind, so
 * the callers still waiting are admitted exactly as if it had never queued.
 *
 * Every test runs on a faked clock, so an instant asserted here is the
 * limiter's own arithmetic and not the scheduler's.
 */

import { getEventListeners } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimitError, RateLimitWaitAbandonedError, TokenBucketRateLimiter } from "../rate-limiter";

/** The instant the faked clock starts at. */
const START_MS = Date.UTC(2026, 0, 5, 14, 30, 0);

/** A bucket of three tokens refilled at ten a second: one token every 100 ms. */
const BURST_TOKENS = 3;
const TOKENS_PER_SECOND = 10;
const REFILL_INTERVAL_MS = 100;

/** How long a queued caller waits before the limiter gives up on it. */
const WAIT_TIMEOUT_MS = 450;

/** How long the scripted sequence is run for: past its last arrival and every wait. */
const SCRIPT_SPAN_MS = 2_500;

/** A wait long enough that no waiter in a short scenario can time out. */
const LONG_TIMEOUT_MS = 60_000;

/** How one scripted caller's wait ended. */
interface WaitOutcome {
  readonly id: string;
  readonly outcome: "admitted" | "timed out" | "abandoned";
  /** Milliseconds after the script began. */
  readonly atMs: number;
}

/** A scripted arrival: who asks for a token, and when. */
interface Arrival {
  readonly id: string;
  readonly atMs: number;
}

/**
 * The scripted arrivals: a burst that empties the bucket and queues two, three
 * stragglers that each join a queue already draining, a second burst deep
 * enough that its last caller times out, and one arrival after a long quiet.
 */
const ARRIVALS: readonly Arrival[] = [
  ...["a", "b", "c", "d", "e"].map((id) => ({ id, atMs: 0 })),
  { id: "f", atMs: 30 },
  { id: "g", atMs: 120 },
  { id: "h", atMs: 250 },
  ...["i", "j", "k", "l", "m", "n"].map((id) => ({ id, atMs: 600 })),
  { id: "o", atMs: 1_900 },
];

/**
 * What the scripted arrivals are admitted as, in the order their waits end.
 *
 * Recorded from the limiter as it stood before its wait took a signal. A burst
 * of three is admitted at once; each later caller is admitted on a refill, one
 * every 100 ms in arrival order; the sixth caller of the second burst is still
 * queued when its 450 ms wait runs out.
 */
const ADMISSIONS: readonly WaitOutcome[] = [
  { id: "a", outcome: "admitted", atMs: 0 },
  { id: "b", outcome: "admitted", atMs: 0 },
  { id: "c", outcome: "admitted", atMs: 0 },
  { id: "d", outcome: "admitted", atMs: 100 },
  { id: "e", outcome: "admitted", atMs: 200 },
  { id: "f", outcome: "admitted", atMs: 300 },
  { id: "g", outcome: "admitted", atMs: 400 },
  { id: "h", outcome: "admitted", atMs: 500 },
  { id: "i", outcome: "admitted", atMs: 600 },
  { id: "j", outcome: "admitted", atMs: 700 },
  { id: "k", outcome: "admitted", atMs: 800 },
  { id: "l", outcome: "admitted", atMs: 900 },
  { id: "m", outcome: "admitted", atMs: 1_000 },
  { id: "n", outcome: "timed out", atMs: 1_050 },
  { id: "o", outcome: "admitted", atMs: 1_900 },
];

/**
 * Milliseconds since the faked clock started.
 *
 * @returns The elapsed time.
 */
function elapsedMs(): number {
  return Date.now() - START_MS;
}

/** The name of the error a wait rejects with when its caller left. */
const ABANDONED_ERROR_NAME = "RateLimitWaitAbandonedError";

/**
 * Name how a wait ended from what it rejected with.
 *
 * Read from the error's name, so the record of a run that abandons nobody
 * depends on nothing but the limiter's behaviour.
 *
 * @param error The rejection.
 * @returns The outcome.
 */
function outcomeOfRejection(error: unknown): WaitOutcome["outcome"] {
  if (!(error instanceof RateLimitError)) {
    throw error;
  }
  return error.name === ABANDONED_ERROR_NAME ? "abandoned" : "timed out";
}

/**
 * Ask for a token and record how the wait ends, and when.
 *
 * @param limiter The limiter.
 * @param id The caller's name in the record.
 * @param record Where the outcome is written.
 * @param signal The caller's signal, when it has one.
 * @returns A promise that settles once the outcome is recorded.
 */
function waitFor(
  limiter: TokenBucketRateLimiter,
  id: string,
  record: WaitOutcome[],
  signal?: AbortSignal,
): Promise<void> {
  const wait = signal === undefined ? limiter.acquire() : limiter.acquire(signal);
  return wait.then(
    () => {
      record.push({ id, outcome: "admitted", atMs: elapsedMs() });
    },
    (error: unknown) => {
      record.push({ id, outcome: outcomeOfRejection(error), atMs: elapsedMs() });
    },
  );
}

/** What a run of the scripted arrivals leaves behind. */
interface ScriptRun {
  readonly outcomes: readonly WaitOutcome[];
  readonly queueLength: number;
  readonly availableTokens: number;
  readonly timersLeft: number;
}

/**
 * Run the scripted arrivals against a fresh limiter.
 *
 * @param signalFor The signal each caller hands over, or `undefined` for none.
 * @returns The outcomes in the order the waits ended, and what was left.
 */
async function runScript(signalFor: (id: string) => AbortSignal | undefined): Promise<ScriptRun> {
  vi.setSystemTime(START_MS);
  const limiter = new TokenBucketRateLimiter({
    maxTokens: BURST_TOKENS,
    refillRate: TOKENS_PER_SECOND,
    label: "scripted",
    timeoutMs: WAIT_TIMEOUT_MS,
  });
  const outcomes: WaitOutcome[] = [];
  const waits: Promise<void>[] = [];
  for (const arrival of ARRIVALS) {
    setTimeout(() => {
      waits.push(waitFor(limiter, arrival.id, outcomes, signalFor(arrival.id)));
    }, arrival.atMs);
  }
  await vi.advanceTimersByTimeAsync(SCRIPT_SPAN_MS);
  await Promise.all(waits);
  return {
    outcomes,
    queueLength: limiter.getQueueLength(),
    availableTokens: limiter.getAvailableTokens(),
    timersLeft: vi.getTimerCount(),
  };
}

/**
 * A limiter whose bucket has just been emptied.
 *
 * @param timeoutMs How long a queued caller waits.
 * @returns The limiter, with no token and nobody queued.
 */
async function emptiedLimiter(timeoutMs: number = LONG_TIMEOUT_MS): Promise<TokenBucketRateLimiter> {
  const limiter = new TokenBucketRateLimiter({
    maxTokens: BURST_TOKENS,
    refillRate: TOKENS_PER_SECOND,
    label: "emptied",
    timeoutMs,
  });
  for (let token = 0; token < BURST_TOKENS; token += 1) {
    await limiter.acquire();
  }
  return limiter;
}

/**
 * How many listeners a signal holds for its abort.
 *
 * @param signal The signal.
 * @returns The count.
 */
function abortListeners(signal: AbortSignal): number {
  return getEventListeners(signal, "abort").length;
}

describe("the rate limiter's token wait and the caller's signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("a caller that never fires its signal", () => {
    it("admits the scripted arrivals in the recorded order at the recorded instants when no signal is passed", async () => {
      const run = await runScript(() => undefined);

      expect(run.outcomes).toEqual(ADMISSIONS);
      expect(run.queueLength).toBe(0);
      expect(run.availableTokens).toBe(BURST_TOKENS);
      expect(run.timersLeft).toBe(0);
    });

    it("admits the same arrivals in the same order at the same instants when every caller passes a signal it never fires", async () => {
      const signals = new Map<string, AbortSignal>();
      const withSignals = await runScript((id) => {
        const { signal } = new AbortController();
        signals.set(id, signal);
        return signal;
      });
      const without = await runScript(() => undefined);

      expect(withSignals).toEqual(without);
      expect(withSignals.outcomes).toEqual(ADMISSIONS);
      expect(signals.size).toBe(ARRIVALS.length);
      // However each wait ended (at once, on a refill, or by timing out), the
      // caller's signal is left holding nothing of the limiter's.
      expect([...signals.values()].map(abortListeners)).toEqual(ARRIVALS.map(() => 0));
    });
  });

  describe("a caller that stops waiting", () => {
    it("takes no token, and the next waiter is admitted at the instant it would have been had the abandoned one never queued", async () => {
      /**
       * One waiter queued behind an abandoned one, or alone.
       *
       * @param withAbandonedAhead Whether an abandoned waiter is queued first.
       * @returns When the live waiter was admitted and what the bucket held afterwards.
       */
      const liveWaiterRun = async (
        withAbandonedAhead: boolean,
      ): Promise<{ admittedAtMs: number | undefined; tokensAfter: number; outcomes: WaitOutcome[] }> => {
        vi.setSystemTime(START_MS);
        const limiter = await emptiedLimiter();
        const outcomes: WaitOutcome[] = [];
        const gone = new AbortController();
        const waits: Promise<void>[] = [];
        if (withAbandonedAhead) {
          waits.push(waitFor(limiter, "gone", outcomes, gone.signal));
        }
        await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS / 4);
        waits.push(waitFor(limiter, "live", outcomes));
        await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS / 4);
        gone.abort();
        await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS * 2);
        await Promise.all(waits);
        return {
          admittedAtMs: outcomes.find((entry) => entry.id === "live")?.atMs,
          tokensAfter: limiter.getAvailableTokens(),
          outcomes,
        };
      };

      const behindAbandoned = await liveWaiterRun(true);
      const alone = await liveWaiterRun(false);

      expect(behindAbandoned.outcomes).toEqual([
        { id: "gone", outcome: "abandoned", atMs: REFILL_INTERVAL_MS / 2 },
        { id: "live", outcome: "admitted", atMs: REFILL_INTERVAL_MS },
      ]);
      expect(alone.outcomes).toEqual([{ id: "live", outcome: "admitted", atMs: REFILL_INTERVAL_MS }]);
      expect(behindAbandoned.admittedAtMs).toBe(alone.admittedAtMs);
      // Two refills ran and one caller was admitted, in both runs: the caller
      // that left took nothing.
      expect(behindAbandoned.tokensAfter).toBe(1);
      expect(behindAbandoned.tokensAfter).toBe(alone.tokensAfter);
    });

    it("leaves the queue at the instant its signal fires", async () => {
      const limiter = await emptiedLimiter();
      const caller = new AbortController();
      const outcomes: WaitOutcome[] = [];
      const wait = waitFor(limiter, "gone", outcomes, caller.signal);
      await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS / 2);
      expect(limiter.getQueueLength()).toBe(1);

      caller.abort(new Error("the caller's own deadline passed"));

      expect(limiter.getQueueLength()).toBe(0);
      await wait;
      expect(outcomes).toEqual([{ id: "gone", outcome: "abandoned", atMs: REFILL_INTERVAL_MS / 2 }]);
    });

    it("keeps the order of the waiters that remain, each admitted one refill after the last", async () => {
      const limiter = await emptiedLimiter();
      const outcomes: WaitOutcome[] = [];
      const callers = ["first", "second", "third", "fourth", "fifth"].map((id) => ({
        id,
        controller: new AbortController(),
      }));
      const waits = callers.map(({ id, controller }) => waitFor(limiter, id, outcomes, controller.signal));
      await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS / 2);

      callers[3].controller.abort();
      callers[1].controller.abort();
      await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS * callers.length);
      await Promise.all(waits);

      expect(outcomes).toEqual([
        { id: "fourth", outcome: "abandoned", atMs: REFILL_INTERVAL_MS / 2 },
        { id: "second", outcome: "abandoned", atMs: REFILL_INTERVAL_MS / 2 },
        { id: "first", outcome: "admitted", atMs: REFILL_INTERVAL_MS },
        { id: "third", outcome: "admitted", atMs: REFILL_INTERVAL_MS * 2 },
        { id: "fifth", outcome: "admitted", atMs: REFILL_INTERVAL_MS * 3 },
      ]);
    });

    it("is refused without a token or a place in the queue when its signal has already fired", async () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: BURST_TOKENS,
        refillRate: TOKENS_PER_SECOND,
        label: "full",
        timeoutMs: LONG_TIMEOUT_MS,
      });
      const caller = new AbortController();
      caller.abort();

      const refused: unknown = await limiter.acquire(caller.signal).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(RateLimitWaitAbandonedError);
      expect(refused).toBeInstanceOf(RateLimitError);
      expect((refused as RateLimitWaitAbandonedError).name).toBe(ABANDONED_ERROR_NAME);

      expect(limiter.getAvailableTokens()).toBe(BURST_TOKENS);
      expect(limiter.getQueueLength()).toBe(0);
      expect(abortListeners(caller.signal)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves no timer and no listener behind", async () => {
      const limiter = await emptiedLimiter();
      const caller = new AbortController();
      const outcomes: WaitOutcome[] = [];
      const wait = waitFor(limiter, "gone", outcomes, caller.signal);
      // Its own timeout and the limiter's wake-up are both armed while it waits.
      expect(vi.getTimerCount()).toBe(2);
      expect(abortListeners(caller.signal)).toBe(1);

      caller.abort();
      await wait;

      expect(vi.getTimerCount()).toBe(0);
      expect(abortListeners(caller.signal)).toBe(0);
      expect(outcomes.map((entry) => entry.outcome)).toEqual(["abandoned"]);
    });

    it("keeps the wake-up armed for the waiters behind it, and only for them", async () => {
      const limiter = await emptiedLimiter();
      const caller = new AbortController();
      const outcomes: WaitOutcome[] = [];
      const waits = [waitFor(limiter, "gone", outcomes, caller.signal), waitFor(limiter, "live", outcomes)];
      // Two timeouts and one wake-up.
      expect(vi.getTimerCount()).toBe(3);

      caller.abort();

      // The live waiter's timeout and the wake-up that will admit it.
      expect(vi.getTimerCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS);
      await Promise.all(waits);
      expect(outcomes.map((entry) => entry.id)).toEqual(["gone", "live"]);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("a signal that outlives the wait", () => {
    it("holds no listener once the wait was granted a token, at once or from the queue", async () => {
      const limiter = new TokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: TOKENS_PER_SECOND,
        label: "listeners",
        timeoutMs: LONG_TIMEOUT_MS,
      });
      const immediate = new AbortController();
      const queued = new AbortController();

      await limiter.acquire(immediate.signal);
      expect(abortListeners(immediate.signal)).toBe(0);

      const wait = limiter.acquire(queued.signal);
      expect(abortListeners(queued.signal)).toBe(1);
      await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS);
      await wait;

      expect(abortListeners(queued.signal)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("changes nothing when it fires after the token was granted", async () => {
      const limiter = await emptiedLimiter();
      const granted = new AbortController();
      const outcomes: WaitOutcome[] = [];
      const waits = [waitFor(limiter, "granted", outcomes, granted.signal), waitFor(limiter, "next", outcomes)];
      await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS);

      granted.abort();
      await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS);
      await Promise.all(waits);

      expect(outcomes).toEqual([
        { id: "granted", outcome: "admitted", atMs: REFILL_INTERVAL_MS },
        { id: "next", outcome: "admitted", atMs: REFILL_INTERVAL_MS * 2 },
      ]);
      expect(limiter.getQueueLength()).toBe(0);
    });

    it("holds no listener once the wait timed out or the limiter was reset", async () => {
      const limiter = await emptiedLimiter(REFILL_INTERVAL_MS / 2);
      const timedOut = new AbortController();
      const outcomes: WaitOutcome[] = [];
      const wait = waitFor(limiter, "timed out", outcomes, timedOut.signal);
      await vi.advanceTimersByTimeAsync(REFILL_INTERVAL_MS / 2);
      await wait;
      expect(outcomes).toEqual([{ id: "timed out", outcome: "timed out", atMs: REFILL_INTERVAL_MS / 2 }]);
      expect(abortListeners(timedOut.signal)).toBe(0);

      const resetLimiter = await emptiedLimiter();
      const queued = new AbortController();
      const rejected = resetLimiter.acquire(queued.signal).catch((error: unknown) => error);
      expect(abortListeners(queued.signal)).toBe(1);
      resetLimiter.reset();

      expect(await rejected).toBeInstanceOf(RateLimitError);
      expect(await rejected).not.toBeInstanceOf(RateLimitWaitAbandonedError);
      expect(abortListeners(queued.signal)).toBe(0);
    });
  });
});
