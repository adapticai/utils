/**
 * The incumbent-relative comparators, one per assertion type in Section 6 of
 * the migration backlog.
 *
 * Each is a pure function from two measured numbers to a verdict, which is what
 * makes PD-6 enforceable: the gate is decided by code from recorded data, and
 * there is no place in the call for judgement to enter. Keeping them separate
 * and separately testable also keeps their tolerances honest — a tolerance
 * buried inside a runner is a tolerance nobody re-reads.
 *
 * Three preconditions are shared by all of them, and all three yield
 * `indeterminate` rather than a verdict:
 *
 * - no recorded incumbent value, because every gate here is a comparison and a
 *   comparison with one side missing is not a strict measurement;
 * - no candidate value, for the same reason;
 * - fewer cases than the set's declared minimum, because a difference measured
 *   on too few cases is indistinguishable from sampling noise.
 *
 * @module llm/eval/comparators
 */

import type { EvalAssertion, EvalGate, Verdict } from "./types";

/**
 * Tolerance for the match assertion, in points.
 *
 * Section 6: "exact-match or field-level F1 within 1 point of incumbent". The
 * band is two-sided in principle and one-sided in effect — a candidate above
 * the incumbent passes outright — so only the downside is checked.
 */
export const MATCH_TOLERANCE_POINTS = 1;

/**
 * Tolerance for the pinned-judge assertion, as a fraction of the incumbent's score.
 *
 * Section 6: "pinned-judge score within 3% of incumbent". Relative rather than
 * absolute because judge scores are not linear across their range: three points
 * near the top of the scale is a much larger regression than three points in
 * the middle.
 */
export const JUDGE_TOLERANCE_FRACTION = 0.03;

/** Scale factor converting a 0-1 rate into the 0-100 point scale tolerances are stated in. */
export const RATE_TO_POINTS = 100;

/**
 * Slack allowed on an "at least as good" comparison, to absorb binary
 * floating-point representation error rather than any real regression.
 */
const FLOAT_EPSILON = 1e-9;

/** Decimal places a 0-1 rate is reported to, chosen to resolve a one-case difference in a large set. */
const RATE_DECIMALS = 4;

/** Decimal places a 0-100 point score is reported to, one finer than the one-point tolerance. */
const POINT_DECIMALS = 2;

/** Decimal places a latency is reported to; sub-millisecond precision is noise at this scale. */
const MS_DECIMALS = 0;

/** The measured inputs one comparator decides on. */
export interface ComparatorInput {
  /** The candidate's measured value, or `undefined` when it could not be measured. */
  readonly candidate: number | undefined;
  /** The recorded incumbent value, or `undefined` when the set has no baseline for it. */
  readonly incumbent: number | undefined;
  /** Cases the measurement was taken over. */
  readonly n: number;
  /** The set's declared minimum case count. */
  readonly minN: number;
}

/** A comparator: measured inputs in, one verdict out. */
export type Comparator = (input: ComparatorInput) => Verdict;

/**
 * Check the preconditions every comparator shares.
 *
 * @param assertion The assertion being decided, named in any refusal.
 * @param input The measured inputs.
 * @returns An `indeterminate` verdict when a precondition fails, otherwise `null`.
 */
function refuseIfUndecidable(
  assertion: EvalAssertion,
  input: ComparatorInput,
): Verdict | null {
  if (input.incumbent === undefined) {
    return {
      kind: "indeterminate",
      assertion,
      reason:
        `no recorded incumbent baseline for "${assertion}": every gate here is incumbent-relative, ` +
        "so a set without a recorded baseline has no bar to clear and renders no verdict",
    };
  }
  if (input.candidate === undefined) {
    return {
      kind: "indeterminate",
      assertion,
      reason: `the candidate run records no measurable value for "${assertion}"`,
    };
  }
  if (input.n < input.minN) {
    return {
      kind: "indeterminate",
      assertion,
      reason:
        `n=${input.n} is below the set's declared min_n=${input.minN}: a difference measured on ` +
        "fewer cases than the category requires is not separable from sampling noise",
    };
  }
  return null;
}

/**
 * Decide an "at least as good, higher is better" comparison.
 *
 * @param assertion The assertion being decided.
 * @param input The measured inputs.
 * @param unitLabel How the numbers read in the verdict message.
 * @returns The verdict.
 */
function atLeastAsGood(
  assertion: EvalAssertion,
  input: ComparatorInput,
  unitLabel: string,
): Verdict {
  const refusal = refuseIfUndecidable(assertion, input);
  if (refusal !== null) {
    return refusal;
  }
  const candidate = input.candidate ?? 0;
  const incumbent = input.incumbent ?? 0;
  if (candidate + FLOAT_EPSILON >= incumbent) {
    return {
      kind: "pass",
      assertion,
      unit: "rate",
      candidate,
      incumbent,
      n: input.n,
      detail: `${unitLabel} ${candidate.toFixed(RATE_DECIMALS)} >= incumbent ${incumbent.toFixed(RATE_DECIMALS)}`,
    };
  }
  return {
    kind: "fail",
    assertion,
    unit: "rate",
    candidate,
    incumbent,
    n: input.n,
    reason: `${unitLabel} ${candidate.toFixed(RATE_DECIMALS)} is below incumbent ${incumbent.toFixed(RATE_DECIMALS)}`,
  };
}

/**
 * Schema-valid rate: the candidate must parse at least as often as the incumbent.
 *
 * No tolerance band, because a malformed structured answer is not a slightly
 * worse answer — it is one the call site cannot consume at all.
 *
 * @param input The measured rates, on a 0-1 scale.
 * @returns The verdict.
 */
export const compareSchemaValidRate: Comparator = (input) =>
  atLeastAsGood("schema-valid", input, "schema-valid rate");

/**
 * Tool-call valid-call rate: the candidate must call correctly at least as often.
 *
 * The permitted single structured retry is applied when the rate is derived, so
 * by the time the comparison is made both sides have been measured under the
 * same retry budget.
 *
 * @param input The measured rates, on a 0-1 scale.
 * @returns The verdict.
 */
export const compareValidCallRate: Comparator = (input) =>
  atLeastAsGood("tool-call", input, "valid-call rate");

/**
 * Exact-match or field-level F1: the candidate must stay within one point.
 *
 * Both measurements are expressed in points on a 0-100 scale before the
 * comparison, so the same tolerance means the same thing whichever a set is
 * scored on.
 *
 * @param input The measured scores, in points.
 * @returns The verdict.
 */
export const compareMatchScore: Comparator = (input) => {
  const refusal = refuseIfUndecidable("match", input);
  if (refusal !== null) {
    return refusal;
  }
  const candidate = input.candidate ?? 0;
  const incumbent = input.incumbent ?? 0;
  const floor = incumbent - MATCH_TOLERANCE_POINTS;
  if (candidate + FLOAT_EPSILON >= floor) {
    return {
      kind: "pass",
      assertion: "match",
      unit: "points",
      candidate,
      incumbent,
      n: input.n,
      detail: `match ${candidate.toFixed(POINT_DECIMALS)}pt within ${MATCH_TOLERANCE_POINTS}pt of incumbent ${incumbent.toFixed(POINT_DECIMALS)}pt`,
    };
  }
  return {
    kind: "fail",
    assertion: "match",
    unit: "points",
    candidate,
    incumbent,
    n: input.n,
    reason:
      `match ${candidate.toFixed(POINT_DECIMALS)}pt is more than ${MATCH_TOLERANCE_POINTS}pt below incumbent ` +
      `${incumbent.toFixed(POINT_DECIMALS)}pt (floor ${floor.toFixed(POINT_DECIMALS)}pt)`,
  };
};

/**
 * Pinned-judge score: the candidate must stay within 3% of the incumbent.
 *
 * The comparison assumes the pinning guard has already run; a judged verdict
 * produced by an unpinned judge would grade one model's output against another
 * model's standard, which is why the guard refuses rather than warns.
 *
 * @param input The measured scores, in points.
 * @returns The verdict.
 */
export const compareJudgeScore: Comparator = (input) => {
  const refusal = refuseIfUndecidable("judge", input);
  if (refusal !== null) {
    return refusal;
  }
  const candidate = input.candidate ?? 0;
  const incumbent = input.incumbent ?? 0;
  const floor = incumbent * (1 - JUDGE_TOLERANCE_FRACTION);
  if (candidate + FLOAT_EPSILON >= floor) {
    return {
      kind: "pass",
      assertion: "judge",
      unit: "points",
      candidate,
      incumbent,
      n: input.n,
      detail: `judge ${candidate.toFixed(POINT_DECIMALS)}pt within ${JUDGE_TOLERANCE_FRACTION * RATE_TO_POINTS}% of incumbent ${incumbent.toFixed(POINT_DECIMALS)}pt`,
    };
  }
  return {
    kind: "fail",
    assertion: "judge",
    unit: "points",
    candidate,
    incumbent,
    n: input.n,
    reason:
      `judge ${candidate.toFixed(POINT_DECIMALS)}pt is more than ${JUDGE_TOLERANCE_FRACTION * RATE_TO_POINTS}% below ` +
      `incumbent ${incumbent.toFixed(POINT_DECIMALS)}pt (floor ${floor.toFixed(POINT_DECIMALS)}pt)`,
  };
};

/**
 * Latency: the candidate's p95 must not exceed the incumbent's.
 *
 * Lower is better here, which is why this is the one comparator that cannot
 * share the "at least as good" helper — inverting a comparison by reusing a
 * helper with swapped arguments is exactly the kind of quiet sign error a
 * latency gate would never surface on its own.
 *
 * @param input The measured p95 values, in milliseconds.
 * @returns The verdict.
 */
export const compareLatencyP95: Comparator = (input) => {
  const refusal = refuseIfUndecidable("latency", input);
  if (refusal !== null) {
    return refusal;
  }
  const candidate = input.candidate ?? 0;
  const incumbent = input.incumbent ?? 0;
  if (candidate <= incumbent + FLOAT_EPSILON) {
    return {
      kind: "pass",
      assertion: "latency",
      unit: "ms",
      candidate,
      incumbent,
      n: input.n,
      detail: `p95 ${candidate.toFixed(MS_DECIMALS)}ms <= incumbent p95 ${incumbent.toFixed(MS_DECIMALS)}ms`,
    };
  }
  return {
    kind: "fail",
    assertion: "latency",
    unit: "ms",
    candidate,
    incumbent,
    n: input.n,
    reason: `p95 ${candidate.toFixed(MS_DECIMALS)}ms exceeds incumbent p95 ${incumbent.toFixed(MS_DECIMALS)}ms`,
  };
};

/**
 * Every assertion type mapped to the comparator that decides it.
 *
 * A registry rather than a switch, so "is every assertion type implemented" is
 * a question code can answer — which is what the harness's own coverage check
 * asks before it will certify anything.
 */
export const COMPARATORS: Readonly<Record<EvalAssertion, Comparator>> = {
  "schema-valid": compareSchemaValidRate,
  match: compareMatchScore,
  judge: compareJudgeScore,
  "tool-call": compareValidCallRate,
  latency: compareLatencyP95,
};

/**
 * The assertions each eval-gate category requires.
 *
 * `none-pinned-judge` requires none by design: the judge alias is the
 * instrument, not a subject. It is held to the pinning guard instead, which is
 * a stricter contract than any score comparison — the judge may not change at
 * all, rather than merely not getting worse.
 */
export const EVAL_GATE_ASSERTIONS: Readonly<Record<EvalGate, readonly EvalAssertion[]>> = {
  "structured-output": ["schema-valid", "match", "latency"],
  "free-text-judge": ["judge", "latency"],
  "tool-call": ["tool-call", "latency"],
  "none-pinned-judge": [],
};
