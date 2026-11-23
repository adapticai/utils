/**
 * The live breaker run of a decision route, step by step, for calls that name
 * no breaker path.
 *
 * This is the executed no-op proof for the breaker-path change. A call that
 * names no path, and a call that names `live`, must move the route's breaker
 * through exactly the transitions, at exactly the times, with exactly the
 * refusal text, that the client gave every call before paths existed. The
 * expected traces below are literal, and this file imports nothing the
 * pre-path client did not export, so the same file runs unchanged against the
 * source that predates the change and must pass there too.
 *
 * Three runs are traced, one per way a run earns its cooldown: a vendor that is
 * full (503, the capacity cooldown), a run with one hard failure in it (500,
 * the full cooldown) and a run of budget timeouts (counted as capacity). Each is
 * driven through the open, the refusal, the half-open probe and the close.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DecisionCallOptions } from "../../../llm/decision/types";
import {
  SERVER_ERROR,
  UNAVAILABLE,
  askHosted,
  documentedAnswer,
  hangingFetch,
  liveRun,
  outcomeOf,
  registryRuns,
  unwireBreakerHarness,
  vendorError,
  wireBreakerHarness,
} from "./support/breaker-harness";
import type { BreakerHarness, CallOutcome, RunState } from "./support/breaker-harness";
import type { DecisionFetchScript } from "./support/fetch-double";

/** One step of a traced run. */
type Step =
  /** A call whose HTTP request, if one is sent, is answered at once. */
  | { readonly kind: "call" }
  /** A call whose HTTP request never answers, so the route's budget ends it. */
  | { readonly kind: "budget_call" }
  /** Move the clock forward. */
  | { readonly kind: "advance"; readonly ms: number };

/** What a step left behind. */
interface TraceRow {
  readonly step: string;
  readonly call: CallOutcome | null;
  /** HTTP requests sent so far. */
  readonly dispatched: number;
  readonly live: RunState;
  /** Every run the registry holds, as `route@path`. */
  readonly runs: readonly string[];
}

/**
 * An expected row, written compactly: the step, how its call ended, the
 * refusal text, the requests sent so far, then the live run's state, failure
 * count, open time, failure kind, cooldown, probes in flight, probe budget and
 * open count.
 */
type ExpectedRow = readonly [
  step: string,
  outcome: string | null,
  refusal: string | null,
  dispatched: number,
  state: RunState["state"],
  consecutiveFailures: number,
  openedAtMs: number | null,
  failureKind: RunState["failureKind"],
  cooldownMs: number,
  probesInFlight: number,
  probeBudget: number,
  opens: number,
];

/** The one run live-only traffic may create. */
const LIVE_ONLY: readonly string[] = ["decision:dm.hosted@live"];

/** The capacity cooldown and the full cooldown the shipped table declares. */
const CAPACITY_COOLDOWN_MS = 15_000;
const HARD_COOLDOWN_MS = 60_000;

/** The shipped route budget, which a budget-ended call spends in full. */
const ROUTE_BUDGET_MS = 1_500;

/** The shipped failure threshold. */
const THRESHOLD = 5;

/** A millisecond: the last one before a cooldown has run. */
const ONE_MS = 1;

/** What a caller refused by an open breaker is told, for a run of a given cooldown. */
const OPEN_REFUSAL = (cooldownMs: number): string =>
  `the route's circuit breaker opened after ${THRESHOLD} consecutive failure(s) ` +
  `and admits a probe once its ${cooldownMs} ms cooldown has run`;

/**
 * Turn the compact rows into the recorded shape.
 *
 * @param rows The expected rows.
 * @returns The rows as a trace records them.
 */
function expectedTrace(rows: readonly ExpectedRow[]): TraceRow[] {
  return rows.map(
    ([step, outcome, refusal, dispatched, state, consecutiveFailures, openedAtMs, failureKind, cooldownMs, probesInFlight, probeBudget, opens]) => ({
      step,
      call: outcome === null ? null : { outcome, refusal },
      dispatched,
      live: { state, consecutiveFailures, openedAtMs, failureKind, cooldownMs, probesInFlight, probeBudget, opens },
      runs: LIVE_ONLY,
    }),
  );
}

/**
 * Drive a run and record each step.
 *
 * @param script What the scripted HTTP call does with each request.
 * @param steps The steps.
 * @param options The options every call is made with.
 * @returns The trace.
 */
async function trace(
  script: DecisionFetchScript,
  steps: readonly Step[],
  options: DecisionCallOptions | undefined,
): Promise<TraceRow[]> {
  const harness: BreakerHarness = wireBreakerHarness(script);
  expect(harness.budgetMs).toBe(ROUTE_BUDGET_MS);
  expect(harness.breaker).toMatchObject({
    failure_threshold: THRESHOLD,
    cooldown_ms: HARD_COOLDOWN_MS,
    capacity_cooldown_ms: CAPACITY_COOLDOWN_MS,
  });
  const rows: TraceRow[] = [];
  for (const step of steps) {
    let call: CallOutcome | null = null;
    if (step.kind === "advance") {
      await vi.advanceTimersByTimeAsync(step.ms);
    } else if (step.kind === "call") {
      call = await outcomeOf(askHosted(options));
    } else {
      const pending = outcomeOf(askHosted(options));
      await vi.advanceTimersByTimeAsync(harness.budgetMs);
      call = await pending;
    }
    rows.push({
      step: step.kind === "advance" ? `advance ${step.ms}` : step.kind,
      call,
      dispatched: harness.double.calls.length,
      live: liveRun(),
      runs: registryRuns(),
    });
  }
  return rows;
}

/** The two ways a caller asks for the live path: by saying nothing, and by naming it. */
const LIVE_CALLERS: readonly (readonly [string, DecisionCallOptions | undefined])[] = [
  ["no options", undefined],
  ["breakerPath live", { breakerPath: "live" } as DecisionCallOptions],
];

const CALL: Step = { kind: "call" };
const BUDGET_CALL: Step = { kind: "budget_call" };

describe("the live breaker run is unchanged for a call that names no path", () => {
  afterEach(() => {
    unwireBreakerHarness();
  });

  describe.each(LIVE_CALLERS)("called with %s", (_label, options) => {
    it("a run of 503s opens for the capacity cooldown, refuses, probes, re-opens and closes", async () => {
      const script: DecisionFetchScript = (_call, index) =>
        index <= THRESHOLD ? vendorError(UNAVAILABLE) : documentedAnswer();
      const steps: readonly Step[] = [
        CALL, CALL, CALL, CALL, CALL,
        CALL,
        { kind: "advance", ms: CAPACITY_COOLDOWN_MS - ONE_MS },
        CALL,
        { kind: "advance", ms: ONE_MS },
        CALL,
        { kind: "advance", ms: CAPACITY_COOLDOWN_MS },
        CALL,
      ];
      const refusal = OPEN_REFUSAL(CAPACITY_COOLDOWN_MS);
      expect(await trace(script, steps, options)).toEqual(
        expectedTrace([
          ["call", "transport", null, 1, "closed", 1, null, "capacity", 15_000, 0, 1, 0],
          ["call", "transport", null, 2, "closed", 2, null, "capacity", 15_000, 0, 1, 0],
          ["call", "transport", null, 3, "closed", 3, null, "capacity", 15_000, 0, 1, 0],
          ["call", "transport", null, 4, "closed", 4, null, "capacity", 15_000, 0, 1, 0],
          ["call", "transport", null, 5, "open", 5, 0, "capacity", 15_000, 0, 1, 1],
          ["call", "unavailable", refusal, 5, "open", 5, 0, "capacity", 15_000, 0, 1, 1],
          ["advance 14999", null, null, 5, "open", 5, 0, "capacity", 15_000, 0, 1, 1],
          ["call", "unavailable", refusal, 5, "open", 5, 0, "capacity", 15_000, 0, 1, 1],
          ["advance 1", null, null, 5, "half-open", 5, 0, "capacity", 15_000, 0, 1, 1],
          ["call", "transport", null, 6, "open", 6, 15_000, "capacity", 15_000, 0, 1, 1],
          ["advance 15000", null, null, 6, "half-open", 6, 15_000, "capacity", 15_000, 0, 1, 1],
          ["call", "ok", null, 7, "closed", 0, null, null, 15_000, 0, 1, 1],
        ]),
      );
    });

    it("one 500 in the run earns the full cooldown", async () => {
      const statuses = [UNAVAILABLE, UNAVAILABLE, SERVER_ERROR, UNAVAILABLE, UNAVAILABLE];
      const script: DecisionFetchScript = (_call, index) =>
        index < statuses.length ? vendorError(statuses[index]) : documentedAnswer();
      const steps: readonly Step[] = [
        CALL, CALL, CALL, CALL, CALL,
        CALL,
        { kind: "advance", ms: HARD_COOLDOWN_MS - ONE_MS },
        CALL,
        { kind: "advance", ms: ONE_MS },
        CALL,
      ];
      const refusal = OPEN_REFUSAL(HARD_COOLDOWN_MS);
      expect(await trace(script, steps, options)).toEqual(
        expectedTrace([
          ["call", "transport", null, 1, "closed", 1, null, "capacity", 15_000, 0, 1, 0],
          ["call", "transport", null, 2, "closed", 2, null, "capacity", 15_000, 0, 1, 0],
          ["call", "transport", null, 3, "closed", 3, null, "hard", 60_000, 0, 1, 0],
          ["call", "transport", null, 4, "closed", 4, null, "hard", 60_000, 0, 1, 0],
          ["call", "transport", null, 5, "open", 5, 0, "hard", 60_000, 0, 1, 1],
          ["call", "unavailable", refusal, 5, "open", 5, 0, "hard", 60_000, 0, 1, 1],
          ["advance 59999", null, null, 5, "open", 5, 0, "hard", 60_000, 0, 1, 1],
          ["call", "unavailable", refusal, 5, "open", 5, 0, "hard", 60_000, 0, 1, 1],
          ["advance 1", null, null, 5, "half-open", 5, 0, "hard", 60_000, 0, 1, 1],
          ["call", "ok", null, 6, "closed", 0, null, null, 15_000, 0, 1, 1],
        ]),
      );
    });

    it("a run of budget timeouts is counted as capacity and opens at the fifth", async () => {
      const script: DecisionFetchScript = (call, index) =>
        index < THRESHOLD ? hangingFetch(call) : documentedAnswer();
      const steps: readonly Step[] = [
        BUDGET_CALL, BUDGET_CALL, BUDGET_CALL, BUDGET_CALL, BUDGET_CALL,
        CALL,
        { kind: "advance", ms: CAPACITY_COOLDOWN_MS },
        CALL,
      ];
      const refusal = OPEN_REFUSAL(CAPACITY_COOLDOWN_MS);
      expect(await trace(script, steps, options)).toEqual(
        expectedTrace([
          ["budget_call", "timeout", null, 1, "closed", 1, null, "capacity", 15_000, 0, 1, 0],
          ["budget_call", "timeout", null, 2, "closed", 2, null, "capacity", 15_000, 0, 1, 0],
          ["budget_call", "timeout", null, 3, "closed", 3, null, "capacity", 15_000, 0, 1, 0],
          ["budget_call", "timeout", null, 4, "closed", 4, null, "capacity", 15_000, 0, 1, 0],
          ["budget_call", "timeout", null, 5, "open", 5, 7_500, "capacity", 15_000, 0, 1, 1],
          ["call", "unavailable", refusal, 5, "open", 5, 7_500, "capacity", 15_000, 0, 1, 1],
          ["advance 15000", null, null, 5, "half-open", 5, 7_500, "capacity", 15_000, 0, 1, 1],
          ["call", "ok", null, 6, "closed", 0, null, null, 15_000, 0, 1, 1],
        ]),
      );
    });
  });
});
