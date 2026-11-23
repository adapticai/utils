/**
 * The traffic path of a decision call, and the breaker run it is counted on.
 *
 * An observer asks a route only to measure it: its answer is compared and
 * discarded, and what serves is decided elsewhere. So nothing an observer's
 * call meets may move the run that serving reads. Serving reads the live run in
 * two ways: an open breaker refuses every serving call on the route, and a
 * consumer may refuse a serving leg while that run holds any failure at all.
 * Both halves of the path split are asserted here, because a test of either
 * alone passes while the defect is live: an observer's outcomes are written to
 * a run of its own, AND an observer's admission still reads the live run, so
 * measurement never adds load to a route serving is already struggling with
 * and never spends the probe that decides whether serving may resume.
 *
 * Each breaker site of the client is pinned by at least one test here, so
 * leaving any one of them on the live run turns a named test red.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionRequestInvalidError } from "../../../llm/decision/errors";
import type { DecisionCallOptions } from "../../../llm/decision/types";
import { guardSnapshots } from "../../../llm/rate-guard";
import {
  HOSTED_BREAKER_KEY,
  UNAVAILABLE,
  askHosted,
  documentedAnswer,
  hangingFetch,
  liveRun,
  outcomeOf,
  registryRuns,
  shadowRun,
  unwireBreakerHarness,
  vendorError,
  wireBreakerHarness,
} from "./support/breaker-harness";
import type { CallOutcome, RunState } from "./support/breaker-harness";

/** An observer's call. */
const SHADOW: DecisionCallOptions = { breakerPath: "shadow" };

/** More consecutive observer failures than the live threshold, so a leak would show. */
const PAST_THRESHOLD = 3;

/** The share of prior concurrency a half-open breaker may probe with, in the table that sets one. */
const PROBE_FRACTION = 0.5;

/** The live run's entry in the registry, and the shadow run's. */
const LIVE_RUN = `${HOSTED_BREAKER_KEY}@live`;
const SHADOW_RUN = `${HOSTED_BREAKER_KEY}@shadow`;

/** A run with nothing on file. */
const EMPTY_RUN: RunState = {
  state: "closed",
  consecutiveFailures: 0,
  openedAtMs: null,
  failureKind: null,
  cooldownMs: 15_000,
  probesInFlight: 0,
  probeBudget: 1,
  opens: 0,
};

/** What an observer refused by its own open run is told. */
const SHADOW_OPEN_REFUSAL =
  "the route's shadow circuit breaker opened after 5 consecutive failure(s) " +
  "and admits a probe once its 15000 ms cooldown has run";

/** What an observer refused while its own run's one probe is in flight is told. */
const SHADOW_PROBING_REFUSAL = "the route's shadow circuit breaker is testing recovery and its 1 probe(s) are in flight";

/**
 * What an observer refused by the live run is told.
 *
 * @param state The live run's state.
 * @returns The reason.
 */
const LIVE_NOT_CLOSED_REFUSAL = (state: string): string =>
  `the route's live circuit breaker is ${state}, and a shadow call is admitted only while it is closed`;

/**
 * An outcome that is a breaker refusal.
 *
 * @param refusal The reason.
 * @returns The outcome.
 */
function refused(refusal: string): CallOutcome {
  return { outcome: "unavailable", refusal };
}

/** An outcome that is an answer. */
const ANSWERED: CallOutcome = { outcome: "ok", refusal: null };

/** An outcome that is a vendor fault. */
const TRANSPORT_FAULT: CallOutcome = { outcome: "transport", refusal: null };

/**
 * Let every promise that is ready run, without moving the faked clock.
 *
 * @returns When the ready work has run.
 */
async function settleReadyWork(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("an observer's call is counted on a breaker run of its own", () => {
  afterEach(() => {
    unwireBreakerHarness();
  });

  it("a run of 503s past the threshold leaves the live run empty and closed, and serving is still answered", async () => {
    const harness = wireBreakerHarness((_call, index) =>
      index < harness.breaker.failure_threshold ? vendorError(UNAVAILABLE) : documentedAnswer(),
    );
    const threshold = harness.breaker.failure_threshold;

    const outcomes: CallOutcome[] = [];
    for (let call = 0; call < threshold + PAST_THRESHOLD; call += 1) {
      outcomes.push(await outcomeOf(askHosted(SHADOW)));
    }

    expect(liveRun()).toEqual(EMPTY_RUN);
    expect(shadowRun()).toMatchObject({ state: "open", consecutiveFailures: threshold, failureKind: "capacity", opens: 1 });
    expect(outcomes).toEqual([
      ...Array.from({ length: threshold }, () => TRANSPORT_FAULT),
      ...Array.from({ length: PAST_THRESHOLD }, () => refused(SHADOW_OPEN_REFUSAL)),
    ]);
    expect(harness.double.calls).toHaveLength(threshold);

    expect(await outcomeOf(askHosted())).toEqual(ANSWERED);
    expect(harness.double.calls).toHaveLength(threshold + 1);
    expect(liveRun()).toEqual(EMPTY_RUN);
  });

  it("a run of budget timeouts leaves the live run empty and closed", async () => {
    const harness = wireBreakerHarness((call, index) =>
      index < harness.breaker.failure_threshold ? hangingFetch(call) : documentedAnswer(),
    );
    const threshold = harness.breaker.failure_threshold;

    for (let call = 0; call < threshold; call += 1) {
      const pending = outcomeOf(askHosted(SHADOW));
      await vi.advanceTimersByTimeAsync(harness.budgetMs);
      expect(await pending).toEqual({ outcome: "timeout", refusal: null });
    }

    expect(liveRun()).toEqual(EMPTY_RUN);
    expect(shadowRun()).toMatchObject({ state: "open", consecutiveFailures: threshold, failureKind: "capacity" });
    expect(await outcomeOf(askHosted())).toEqual(ANSWERED);
  });

  it("an observer's open run refuses only observers, and its own probe closes it", async () => {
    const harness = wireBreakerHarness((_call, index) =>
      index < harness.breaker.failure_threshold ? vendorError(UNAVAILABLE) : documentedAnswer(),
    );
    const threshold = harness.breaker.failure_threshold;
    for (let call = 0; call < threshold; call += 1) {
      await outcomeOf(askHosted(SHADOW));
    }

    expect(await outcomeOf(askHosted(SHADOW))).toEqual(refused(SHADOW_OPEN_REFUSAL));
    expect(harness.double.calls).toHaveLength(threshold);

    expect(await outcomeOf(askHosted())).toEqual(ANSWERED);
    expect(harness.double.calls).toHaveLength(threshold + 1);
    expect(liveRun()).toEqual(EMPTY_RUN);
    expect(shadowRun().state).toBe("open");

    await vi.advanceTimersByTimeAsync(harness.breaker.capacity_cooldown_ms ?? harness.breaker.cooldown_ms);
    expect(shadowRun().state).toBe("half-open");
    expect(await outcomeOf(askHosted(SHADOW))).toEqual(ANSWERED);
    expect(shadowRun()).toMatchObject({ state: "closed", consecutiveFailures: 0, opens: 1 });
    expect(registryRuns()).toEqual([LIVE_RUN, SHADOW_RUN]);
  });

  it("an observer is refused while the live run is open, and while it is half-open spends none of its probes", async () => {
    let vendorUp = false;
    const harness = wireBreakerHarness(() => (vendorUp ? documentedAnswer() : vendorError(UNAVAILABLE)));
    const threshold = harness.breaker.failure_threshold;
    for (let call = 0; call < threshold; call += 1) {
      await outcomeOf(askHosted());
    }
    expect(liveRun().state).toBe("open");

    expect(await outcomeOf(askHosted(SHADOW))).toEqual(refused(LIVE_NOT_CLOSED_REFUSAL("open")));
    expect(harness.double.calls).toHaveLength(threshold);
    expect(registryRuns()).toEqual([LIVE_RUN]);

    await vi.advanceTimersByTimeAsync(harness.breaker.capacity_cooldown_ms ?? harness.breaker.cooldown_ms);
    vendorUp = true;
    expect(liveRun().state).toBe("half-open");
    expect(await outcomeOf(askHosted(SHADOW))).toEqual(refused(LIVE_NOT_CLOSED_REFUSAL("half-open")));
    expect(harness.double.calls).toHaveLength(threshold);
    expect(liveRun()).toMatchObject({ state: "half-open", probesInFlight: 0 });

    expect(await outcomeOf(askHosted())).toEqual(ANSWERED);
    expect(liveRun()).toMatchObject({ state: "closed", consecutiveFailures: 0 });
    expect(await outcomeOf(askHosted(SHADOW))).toEqual(ANSWERED);
    expect(harness.double.calls).toHaveLength(threshold + 2);
  });

  it("an observer's answer does not clear a failure run serving holds", async () => {
    const serving = 2;
    const harness = wireBreakerHarness((_call, index) => (index < serving ? vendorError(UNAVAILABLE) : documentedAnswer()));
    for (let call = 0; call < serving; call += 1) {
      await outcomeOf(askHosted());
    }
    expect(liveRun()).toMatchObject({ state: "closed", consecutiveFailures: serving });

    expect(await outcomeOf(askHosted(SHADOW))).toEqual(ANSWERED);
    expect(harness.double.calls).toHaveLength(serving + 1);
    expect(liveRun()).toMatchObject({ state: "closed", consecutiveFailures: serving, failureKind: "capacity" });
    expect(shadowRun()).toEqual(EMPTY_RUN);
  });

  it("an observer's probe takes its own run's probe slot, and returns it when the observer leaves", async () => {
    const harness = wireBreakerHarness((call, index) => {
      const threshold = harness.breaker.failure_threshold;
      if (index < threshold) {
        return vendorError(UNAVAILABLE);
      }
      return index === threshold ? hangingFetch(call) : documentedAnswer();
    });
    const threshold = harness.breaker.failure_threshold;
    for (let call = 0; call < threshold; call += 1) {
      await outcomeOf(askHosted(SHADOW));
    }
    await vi.advanceTimersByTimeAsync(harness.breaker.capacity_cooldown_ms ?? harness.breaker.cooldown_ms);
    expect(shadowRun().state).toBe("half-open");

    const leave = new AbortController();
    const probe = outcomeOf(askHosted({ ...SHADOW, signal: leave.signal }));
    await settleReadyWork();
    expect(harness.double.calls).toHaveLength(threshold + 1);
    expect(shadowRun()).toMatchObject({ state: "half-open", probesInFlight: 1 });
    expect(liveRun()).toMatchObject({ state: "closed", probesInFlight: 0 });

    expect(await outcomeOf(askHosted(SHADOW))).toEqual(refused(SHADOW_PROBING_REFUSAL));
    expect(await outcomeOf(askHosted())).toEqual(ANSWERED);
    expect(harness.double.calls).toHaveLength(threshold + 2);

    leave.abort();
    expect(await probe).toEqual({ outcome: "timeout", refusal: null });
    expect(shadowRun()).toMatchObject({ state: "half-open", probesInFlight: 0, consecutiveFailures: threshold });

    expect(await outcomeOf(askHosted(SHADOW))).toEqual(ANSWERED);
    expect(shadowRun()).toMatchObject({ state: "closed", consecutiveFailures: 0 });
    expect(liveRun()).toEqual(EMPTY_RUN);
  });

  it("an observer's attempt is counted in flight on its own run only until it ends", async () => {
    const harness = wireBreakerHarness(
      () => vendorError(UNAVAILABLE),
      (table) => {
        table.defaults.circuit_breaker.probe_fraction = PROBE_FRACTION;
      },
    );
    const threshold = harness.breaker.failure_threshold;
    for (let call = 0; call < threshold; call += 1) {
      await outcomeOf(askHosted(SHADOW));
    }

    // The calls ran one at a time, so the route never carried more than one at once.
    expect(shadowRun()).toMatchObject({ state: "open", probeBudget: harness.breaker.half_open_probes });
    expect(liveRun()).toEqual(EMPTY_RUN);
  });

  it("interleaved observer traffic leaves the live run's trace identical to serving alone", async () => {
    /**
     * Serve five 503s, a refusal, a cooldown and a recovering probe, with or
     * without an observer's call after each serving call.
     *
     * @param withObservers Whether an observer calls between serving calls.
     * @returns The serving outcomes and the live run after each serving step.
     */
    const serve = async (withObservers: boolean): Promise<{ outcomes: CallOutcome[]; runs: RunState[] }> => {
      let vendorUp = false;
      const harness = wireBreakerHarness(() => (vendorUp ? documentedAnswer() : vendorError(UNAVAILABLE)));
      const outcomes: CallOutcome[] = [];
      const runs: RunState[] = [];
      const serveOnce = async (): Promise<void> => {
        outcomes.push(await outcomeOf(askHosted()));
        runs.push(liveRun());
        if (withObservers) {
          await outcomeOf(askHosted(SHADOW));
        }
      };
      for (let call = 0; call <= harness.breaker.failure_threshold; call += 1) {
        await serveOnce();
      }
      await vi.advanceTimersByTimeAsync(harness.breaker.capacity_cooldown_ms ?? harness.breaker.cooldown_ms);
      vendorUp = true;
      await serveOnce();
      await serveOnce();
      unwireBreakerHarness();
      return { outcomes, runs };
    };

    const alone = await serve(false);
    const observed = await serve(true);

    expect(alone.runs.map(({ state }) => state)).toEqual(["closed", "closed", "closed", "closed", "open", "open", "closed", "closed"]);
    expect(observed).toEqual(alone);
  });

  it("an unknown breaker path is refused before anything is spent", async () => {
    const harness = wireBreakerHarness(() => documentedAnswer());
    const unknown: readonly unknown[] = ["observer", "Shadow", "", null, 1, { path: "shadow" }];

    for (const breakerPath of unknown) {
      const error: unknown = await askHosted({ breakerPath } as unknown as DecisionCallOptions).then(
        () => null,
        (rejection: unknown) => rejection,
      );
      expect(error).toBeInstanceOf(DecisionRequestInvalidError);
      expect((error as DecisionRequestInvalidError).fieldPath).toBe("options.breakerPath");
    }

    expect(harness.double.calls).toHaveLength(0);
    expect(registryRuns()).toEqual([]);
    expect(guardSnapshots()).toEqual([]);
  });
});
