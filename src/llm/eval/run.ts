/**
 * Grading one candidate run against one golden set, and a whole evaluation
 * against many.
 *
 * The orchestration here holds two invariants that the comparators cannot hold
 * on their own.
 *
 * The bar is the ATTESTED baseline, not a number recomputed at grading time —
 * so the bar a candidate clears is the same bar every earlier candidate cleared,
 * and a re-baselining is a visible edit to the set rather than a silent
 * consequence of running the harness again. The recomputation still happens,
 * as an integrity check: when the attested baseline and the records it claims
 * to summarise disagree, the set renders `indeterminate` instead of grading
 * against a bar that has been moved by hand.
 *
 * And an incomplete candidate run is never graded. Scoring the subset of cases
 * that happened to produce an answer silently reweights the set toward whatever
 * the candidate found easy, which is the most flattering possible error a model
 * comparison can make.
 *
 * @module llm/eval/run
 */

import type { LlmAlias, LlmRouteTable } from "../types";
import { COMPARATORS, RATE_TO_POINTS } from "./comparators";
import { GoldenSetError } from "./golden-set";
import { PINNED_JUDGE, assertPinnedJudge } from "./judge";
import { deriveMetrics } from "./metrics";
import type { MetricSample } from "./metrics";
import type {
  BaselineMetrics,
  CandidateRun,
  EvalAssertion,
  EvalStatus,
  GoldenSet,
  RunReport,
  SetReport,
  Verdict,
} from "./types";

/**
 * Absolute agreement required between an attested baseline metric and the same
 * metric recomputed from the set's own records.
 *
 * Tight enough that only floating-point representation error fits inside it: the
 * check exists to catch a baseline edited independently of its evidence, and a
 * generous tolerance would let exactly that through.
 */
export const BASELINE_ATTESTATION_TOLERANCE = 1e-6;

/** Missing case ids listed by name before the rest are elided, to keep a CI line readable. */
const MISSING_IDS_SHOWN = 3;

/**
 * Overrides for grading, used only by the harness's own pinning check.
 *
 * Production grading passes none of these: the judge is the pinned one and the
 * route table is the canonical one, and an override that a caller could reach in
 * normal use would be a way around PD-6 rather than a way to verify it.
 */
export interface EvaluateOptions {
  /** The alias judged assertions are served by. Only the pinned judge is accepted. */
  readonly judgeAlias?: LlmAlias;
  /** The route table the pin is verified against. */
  readonly routeTable?: LlmRouteTable;
}

/** One golden set paired with the candidate answers to grade against it. */
export interface EvalPair {
  /** The golden set. */
  readonly set: GoldenSet;
  /** The candidate run answering it. */
  readonly candidate: CandidateRun;
}

/**
 * The measured pair of numbers one assertion is decided on.
 *
 * Both sides carry the same unit by construction, because the extraction that
 * builds them is the only place a rate is converted to points.
 */
interface AssertionInputs {
  /** The candidate's measured value, or `undefined` when it is not measurable. */
  readonly candidate: number | undefined;
  /** The attested incumbent value, or `undefined` when the set attests none. */
  readonly incumbent: number | undefined;
}

/**
 * Pull the candidate and incumbent numbers for one assertion, in matching units.
 *
 * @param assertion The assertion being decided.
 * @param set The golden set, which fixes which match measurement is used.
 * @param candidateMetrics Metrics derived from the candidate's answers.
 * @param incumbentMetrics The attested incumbent metrics.
 * @returns The two numbers, either of which may be absent.
 */
function inputsFor(
  assertion: EvalAssertion,
  set: GoldenSet,
  candidateMetrics: BaselineMetrics,
  incumbentMetrics: BaselineMetrics,
): AssertionInputs {
  switch (assertion) {
    case "schema-valid":
      return {
        candidate: candidateMetrics.schema_valid_rate,
        incumbent: incumbentMetrics.schema_valid_rate,
      };
    case "tool-call":
      return {
        candidate: candidateMetrics.valid_call_rate,
        incumbent: incumbentMetrics.valid_call_rate,
      };
    case "judge":
      return {
        candidate: candidateMetrics.judge_score,
        incumbent: incumbentMetrics.judge_score,
      };
    case "latency":
      return {
        candidate: candidateMetrics.latency_p95_ms,
        incumbent: incumbentMetrics.latency_p95_ms,
      };
    case "match":
      return set.match_metric === "exact_match"
        ? {
            candidate: toPoints(candidateMetrics.exact_match_rate),
            incumbent: toPoints(incumbentMetrics.exact_match_rate),
          }
        : { candidate: candidateMetrics.field_f1, incumbent: incumbentMetrics.field_f1 };
    default:
      return { candidate: undefined, incumbent: undefined };
  }
}

/**
 * Convert a 0-1 rate to the 0-100 point scale, preserving absence.
 *
 * @param rate The rate, or `undefined`.
 * @returns The value in points, or `undefined`.
 */
function toPoints(rate: number | undefined): number | undefined {
  return rate === undefined ? undefined : rate * RATE_TO_POINTS;
}

/**
 * Metric keys an attested baseline may declare, paired with their recomputed
 * counterparts for the integrity check.
 */
const ATTESTED_METRIC_KEYS: readonly (keyof BaselineMetrics)[] = [
  "schema_valid_rate",
  "exact_match_rate",
  "field_f1",
  "judge_score",
  "valid_call_rate",
  "latency_p95_ms",
];

/**
 * Check the attested baseline against the set's own records.
 *
 * @param set The golden set.
 * @param recomputed Metrics recomputed from the recorded incumbent answers.
 * @returns The disagreements found, empty when the attestation holds.
 */
function attestationBreaks(set: GoldenSet, recomputed: BaselineMetrics): string[] {
  const breaks: string[] = [];
  for (const key of ATTESTED_METRIC_KEYS) {
    const attested = set.incumbent_baseline.metrics[key];
    if (attested === undefined) {
      continue;
    }
    const actual = recomputed[key];
    if (actual === undefined) {
      breaks.push(
        `attests ${key}=${attested} but the recorded incumbent answers do not support that metric`,
      );
      continue;
    }
    if (Math.abs(actual - attested) > BASELINE_ATTESTATION_TOLERANCE) {
      breaks.push(
        `attests ${key}=${attested} but its own records compute ${actual}`,
      );
    }
  }
  return breaks;
}

/**
 * Render every assertion of a set as `indeterminate` for one shared reason.
 *
 * @param set The golden set.
 * @param reason Why no verdict can be rendered.
 * @returns One indeterminate verdict per asserted comparison.
 */
function allIndeterminate(set: GoldenSet, reason: string): Verdict[] {
  return set.assertions.map((assertion) => ({
    kind: "indeterminate" as const,
    assertion,
    reason,
  }));
}

/**
 * Grade one candidate run against one golden set.
 *
 * A set that asserts `judge` verifies the judge pin BEFORE it grades, even
 * though the scores it grades were recorded earlier. The scores are only
 * meaningful as the output of a specific, unchanged instrument, so a set whose
 * judge has moved since capture has no valid scores to grade — and refusing is
 * the only outcome that says so.
 *
 * @param set The golden set.
 * @param candidate The candidate's answers.
 * @param options Overrides used by the harness's own pinning check.
 * @returns The set's report.
 * @throws {GoldenSetError} When the candidate run answers a different set.
 * @throws {JudgeNotPinnedError} When a judged set's judge is not the pinned one.
 */
export function evaluateSet(
  set: GoldenSet,
  candidate: CandidateRun,
  options: EvaluateOptions = {},
): SetReport {
  if (set.assertions.includes("judge")) {
    assertPinnedJudge(options.judgeAlias ?? PINNED_JUDGE.alias, options.routeTable);
  }
  if (candidate.set_id !== set.id) {
    throw new GoldenSetError(
      candidate.set_id,
      `candidate run "${candidate.candidate_label}" targets set "${candidate.set_id}" but was graded against "${set.id}"`,
    );
  }

  const incumbentSamples: MetricSample[] = set.cases.map((goldenCase) => ({
    goldenCase,
    result: goldenCase.incumbent_result,
  }));
  const recomputed = deriveMetrics(set, incumbentSamples);

  const breaks = attestationBreaks(set, recomputed);
  if (breaks.length > 0) {
    return report(set, candidate, allIndeterminate(
      set,
      `the attested incumbent baseline disagrees with the set's own records — ${breaks.join("; ")}`,
    ));
  }

  const missing = set.cases
    .filter((goldenCase) => candidate.results[goldenCase.id] === undefined)
    .map((goldenCase) => goldenCase.id);
  if (missing.length > 0) {
    return report(set, candidate, allIndeterminate(
      set,
      `the candidate run answers ${set.cases.length - missing.length} of ${set.cases.length} cases ` +
        `(missing ${missing.slice(0, MISSING_IDS_SHOWN).join(", ")}${missing.length > MISSING_IDS_SHOWN ? ", …" : ""}); grading a partial ` +
        "set would reweight it toward the cases the candidate answered",
    ));
  }

  const candidateSamples: MetricSample[] = set.cases.map((goldenCase) => ({
    goldenCase,
    result: candidate.results[goldenCase.id] as MetricSample["result"],
  }));
  const candidateMetrics = deriveMetrics(set, candidateSamples);

  const verdicts = set.assertions.map((assertion): Verdict => {
    const inputs = inputsFor(assertion, set, candidateMetrics, set.incumbent_baseline.metrics);
    return COMPARATORS[assertion]({
      candidate: inputs.candidate,
      incumbent: inputs.incumbent,
      n: set.cases.length,
      minN: set.min_n,
    });
  });

  return report(set, candidate, verdicts);
}

/**
 * Assemble a set report and decide its status.
 *
 * @param set The golden set.
 * @param candidate The candidate run.
 * @param verdicts The verdicts rendered.
 * @returns The report.
 */
function report(
  set: GoldenSet,
  candidate: CandidateRun,
  verdicts: readonly Verdict[],
): SetReport {
  const status: EvalStatus =
    verdicts.length > 0 && verdicts.every((verdict) => verdict.kind === "pass")
      ? "PASSED"
      : "FAILED";
  return { setId: set.id, candidateLabel: candidate.candidate_label, verdicts, status };
}

/**
 * Grade a whole evaluation.
 *
 * An evaluation with no sets is FAILED, not PASSED. A gate that reports green
 * when it graded nothing is indistinguishable from a gate that is working, and
 * is the exact failure this harness exists to prevent.
 *
 * @param pairs The sets and the candidate runs answering them.
 * @param options Overrides used by the harness's own pinning check.
 * @returns The run report.
 */
export function evaluateRun(
  pairs: readonly EvalPair[],
  options: EvaluateOptions = {},
): RunReport {
  if (pairs.length === 0) {
    return {
      sets: [],
      status: "FAILED",
      summary:
        "no golden sets were graded; an eval gate that certifies an empty evaluation certifies nothing",
    };
  }
  const sets = pairs.map((pair) => evaluateSet(pair.set, pair.candidate, options));
  const failed = sets.filter((setReport) => setReport.status === "FAILED");
  const status: EvalStatus = failed.length === 0 ? "PASSED" : "FAILED";
  const summary =
    failed.length === 0
      ? `${sets.length} set(s) graded, all passed`
      : `${failed.length} of ${sets.length} set(s) failed: ${failed.map((setReport) => setReport.setId).join(", ")}`;
  return { sets, status, summary };
}

/**
 * Render one verdict as a single log line.
 *
 * @param verdict The verdict.
 * @returns A line naming the assertion, the outcome and the numbers behind it.
 */
export function formatVerdict(verdict: Verdict): string {
  if (verdict.kind === "indeterminate") {
    return `    INDETERMINATE ${verdict.assertion}: ${verdict.reason}`;
  }
  if (verdict.kind === "pass") {
    return `    PASS          ${verdict.assertion}: ${verdict.detail} (n=${verdict.n})`;
  }
  return `    FAIL          ${verdict.assertion}: ${verdict.reason} (n=${verdict.n})`;
}

/**
 * Render a run report as lines for a CI log.
 *
 * @param runReport The report.
 * @returns The lines, in display order.
 */
export function formatRunReport(runReport: RunReport): string[] {
  const lines: string[] = [];
  for (const setReport of runReport.sets) {
    lines.push(`  [${setReport.status}] ${setReport.setId} vs ${setReport.candidateLabel}`);
    for (const verdict of setReport.verdicts) {
      lines.push(formatVerdict(verdict));
    }
  }
  lines.push(`  RUN ${runReport.status}: ${runReport.summary}`);
  return lines;
}
