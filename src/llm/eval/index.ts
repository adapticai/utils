/**
 * Public surface of the LLM migration eval harness.
 *
 * The harness grades a candidate model against a recorded incumbent baseline on
 * captured golden sets, and renders every verdict by code from recorded data —
 * PD-6 forbids agent judgement from standing in for a gate, and an exported
 * surface with no "just tell me if this looks fine" entry point is what makes
 * that structural rather than aspirational.
 *
 * @module llm/eval
 */

export {
  COMPARATORS,
  EVAL_GATE_ASSERTIONS,
  JUDGE_TOLERANCE_FRACTION,
  MATCH_TOLERANCE_POINTS,
  RATE_TO_POINTS,
  compareJudgeScore,
  compareLatencyP95,
  compareMatchScore,
  compareSchemaValidRate,
  compareValidCallRate,
} from "./comparators";
export type { Comparator, ComparatorInput } from "./comparators";

export { computeCoverage } from "./coverage";
export type { CoverageReport, ObservedAssertions } from "./coverage";

export { GoldenSetError, parseCandidateRun, parseGoldenSet } from "./golden-set";

export { F1_SCALE_POINTS, fieldF1, jsonEquals, leafFields, p95, satisfiesShape } from "./json-shape";

export {
  JUDGE_SCORE_MAX,
  JUDGE_SCORE_MIN,
  JudgeNotPinnedError,
  PINNED_JUDGE,
  assertPinnedJudge,
  scoreCandidateRun,
  scoreWithPinnedJudge,
} from "./judge";
export type { JudgeRequest, PinnedJudgeIdentity, ResolvedJudge } from "./judge";

export { MAX_STRUCTURED_RETRIES, deriveMetrics, isValidToolCall } from "./metrics";
export type { MetricSample } from "./metrics";

export {
  BASELINE_ATTESTATION_TOLERANCE,
  evaluateRun,
  evaluateSet,
  formatRunReport,
  formatVerdict,
} from "./run";
export type { EvalPair, EvaluateOptions } from "./run";

export type {
  BaselineMetrics,
  CandidateRun,
  EvalAssertion,
  EvalGate,
  EvalStatus,
  GoldenCase,
  GoldenSet,
  IncumbentBaseline,
  JsonShape,
  MatchMetric,
  MetricUnit,
  RecordedResult,
  RecordedToolCall,
  RunReport,
  SetReport,
  ToolExpectation,
  Verdict,
} from "./types";
