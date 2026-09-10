/**
 * Types for the LLM migration eval harness.
 *
 * Every gate in this harness is INCUMBENT-RELATIVE: the question is never "is
 * the candidate good" but "is the candidate at least as good as the model it
 * would replace". That framing is what makes a gate decidable by code from
 * recorded data, which PD-6 requires — agent judgement never substitutes for a
 * gate. It also fixes the shape of these types: a golden set that carries no
 * recorded incumbent baseline has no comparison basis, so it can only render an
 * `indeterminate` verdict. A gate that passed on missing data would certify
 * nothing while looking green, which is strictly worse than having no gate.
 *
 * @module llm/eval/types
 */

import type { LlmAlias, LlmLatencyClass } from "../types";

/**
 * The assertion types this harness implements, one per line of Section 6 of
 * the migration backlog.
 *
 * `match` covers both exact-match and field-level F1 because the backlog treats
 * them as one gate with two measurement choices — a set declares which of the
 * two its category can be scored on, and the tolerance is the same.
 */
export type EvalAssertion =
  | "schema-valid"
  | "match"
  | "judge"
  | "tool-call"
  | "latency";

/** The eval-gate categories the route table assigns to each alias. */
export type EvalGate =
  | "structured-output"
  | "free-text-judge"
  | "tool-call"
  | "none-pinned-judge";

/** Which measurement a structured set is scored on for the `match` assertion. */
export type MatchMetric = "exact_match" | "field_f1";

/** Unit a verdict's numbers are expressed in, so a reader cannot misread a scale. */
export type MetricUnit = "rate" | "points" | "ms";

/** One tool call as a provider reported it. */
export interface RecordedToolCall {
  /** The function the model asked to call. */
  readonly name: string;
  /** The raw argument JSON, kept unparsed because "did it parse" is part of the measurement. */
  readonly arguments: string;
}

/**
 * One model answer as it was recorded.
 *
 * Recorded rather than re-derived: a gate that re-ran the incumbent to obtain
 * its baseline would compare two different samples of a stochastic process and
 * call the difference a regression.
 */
export interface RecordedResult {
  /** The answer payload — a parsed object for structured sites, a string for free-text ones. */
  readonly raw: unknown;
  /** Wall-clock latency of the call that produced it. */
  readonly latency_ms: number;
  /** Tool calls the model asked for, where the site is a tool-call site. */
  readonly tool_calls?: readonly RecordedToolCall[];
  /** Pinned-judge score on a 0-100 scale, where the site is judged. */
  readonly judge_score?: number;
  /**
   * Structured retries spent before this answer.
   *
   * Section 6 permits exactly one structured retry before the chain falls back,
   * so the retry count is part of whether a tool call counts as valid — an
   * answer that took three attempts did not meet the contract even if the third
   * attempt parsed.
   */
  readonly structured_retries?: number;
}

/** One graded example: an input, the answer it should produce, and what the incumbent produced. */
export interface GoldenCase {
  /** Stable id, so a candidate run can be matched to the case it answered. */
  readonly id: string;
  /** The prompt exactly as the call site would send it, post-redaction. */
  readonly input: string;
  /** The reference answer the case is graded against. */
  readonly expected: unknown;
  /** What the incumbent model returned when the set was captured. */
  readonly incumbent_result: RecordedResult;
}

/** Summary metrics attested for one side of a comparison. */
export interface BaselineMetrics {
  /** Fraction of answers that parsed against the set's response shape. */
  readonly schema_valid_rate?: number;
  /** Fraction of answers deep-equal to `expected`. */
  readonly exact_match_rate?: number;
  /** Field-level F1 against `expected`, on a 0-100 point scale. */
  readonly field_f1?: number;
  /** Mean pinned-judge score, on a 0-100 point scale. */
  readonly judge_score?: number;
  /** Fraction of cases whose tool call was valid within the permitted retry budget. */
  readonly valid_call_rate?: number;
  /** p95 latency across the set. */
  readonly latency_p95_ms?: number;
}

/**
 * The attested incumbent baseline for a golden set.
 *
 * Attested AND recomputable: the harness recomputes every declared metric from
 * the per-case `incumbent_result` records and refuses to render a verdict when
 * the two disagree. A baseline that could be edited independently of the data
 * it summarises would let a gate be passed by lowering the bar rather than by
 * meeting it.
 */
export interface IncumbentBaseline {
  /** When the incumbent run was captured. */
  readonly recorded_at: string;
  /** Where the traffic came from, so a reader can audit provenance. */
  readonly source: string;
  /** The incumbent's model family, recorded for attribution rather than for routing. */
  readonly model_family: string;
  /** Number of cases the baseline was computed over. */
  readonly n: number;
  /** The attested metrics. */
  readonly metrics: BaselineMetrics;
}

/**
 * The JSON-shape subset a structured set is validated against.
 *
 * A deliberate subset rather than full JSON Schema: the harness adds no
 * dependency, and every keyword it does honour is one a captured call site
 * actually uses. An unrecognised keyword is ignored rather than treated as
 * satisfied, and that is stated here because silent leniency in a validator is
 * how a schema gate stops separating anything.
 */
export interface JsonShape {
  /** The JSON type this node must have. */
  readonly type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  /** Property shapes, for an object node. */
  readonly properties?: Readonly<Record<string, JsonShape>>;
  /** Properties that must be present, for an object node. */
  readonly required?: readonly string[];
  /** Element shape, for an array node. */
  readonly items?: JsonShape;
  /** Permitted values, for a scalar node. */
  readonly enum?: readonly (string | number | boolean)[];
}

/** What a tool-call site's answer must call, and with which arguments. */
export interface ToolExpectation {
  /** The function name the model is expected to call. */
  readonly tool: string;
  /** Argument keys that must be present in the parsed argument object. */
  readonly required_arguments: readonly string[];
}

/**
 * A golden set: the durable, per-call-site-category evidence a gate runs on.
 *
 * Real sets are captured from PAPER traffic under a redaction profile (W5-01).
 * The profile is recorded on the set rather than applied ad hoc, because a set
 * whose redaction rules are not written down cannot be re-derived or audited.
 */
export interface GoldenSet {
  /** Stable set id, unique across the golden-set directory. */
  readonly id: string;
  /** The call-site category this set stands for. */
  readonly call_site_category: string;
  /** The alias the category routes through. */
  readonly alias: LlmAlias;
  /** The eval gate this set enforces; must agree with the alias's route-table gate. */
  readonly eval_gate: EvalGate;
  /** Minimum cases below which no verdict is rendered. */
  readonly min_n: number;
  /** Named redaction profile applied when the set was captured. */
  readonly redaction_profile: string;
  /** The latency class the p95 comparison belongs to; must agree with the route table. */
  readonly latency_class: LlmLatencyClass;
  /** Which assertions this set is graded on. */
  readonly assertions: readonly EvalAssertion[];
  /** Which match measurement the set is scored on, where `match` is asserted. */
  readonly match_metric?: MatchMetric;
  /** The response shape, where `schema-valid` is asserted. */
  readonly response_shape?: JsonShape;
  /** The tool contract, where `tool-call` is asserted. */
  readonly tool_expectation?: ToolExpectation;
  /** The recorded incumbent baseline every assertion compares against. */
  readonly incumbent_baseline: IncumbentBaseline;
  /** The graded cases. */
  readonly cases: readonly GoldenCase[];
}

/**
 * A candidate model's answers to one golden set.
 *
 * Separate from the set because the set is durable and the candidate run is
 * per-evaluation: swapping the candidate must not require re-capturing the
 * evidence, or every model comparison would be against a different bar.
 */
export interface CandidateRun {
  /** The golden set these answers belong to. */
  readonly set_id: string;
  /** Human-readable identity of the candidate, for the report. */
  readonly candidate_label: string;
  /** When the candidate run was produced. */
  readonly recorded_at: string;
  /** Answers keyed by golden-case id. */
  readonly results: Readonly<Record<string, RecordedResult>>;
}

/**
 * The outcome of one assertion.
 *
 * A discriminated union with a first-class `indeterminate` arm. Collapsing
 * "could not decide" into "pass" is the specific failure this shape forecloses:
 * it is the difference between a gate that is silent about missing evidence and
 * a gate that certifies its absence.
 */
export type Verdict =
  | {
      readonly kind: "pass";
      readonly assertion: EvalAssertion;
      readonly unit: MetricUnit;
      readonly candidate: number;
      readonly incumbent: number;
      readonly n: number;
      readonly detail: string;
    }
  | {
      readonly kind: "fail";
      readonly assertion: EvalAssertion;
      readonly unit: MetricUnit;
      readonly candidate: number;
      readonly incumbent: number;
      readonly n: number;
      readonly reason: string;
    }
  | {
      readonly kind: "indeterminate";
      readonly assertion: EvalAssertion;
      readonly reason: string;
    };

/** Whether a set or a whole run cleared its gate. Only `PASSED` permits a merge. */
export type EvalStatus = "PASSED" | "FAILED";

/** The graded outcome of one golden set against one candidate run. */
export interface SetReport {
  /** The set that was graded. */
  readonly setId: string;
  /** The candidate that was graded. */
  readonly candidateLabel: string;
  /** One verdict per asserted comparison, in assertion order. */
  readonly verdicts: readonly Verdict[];
  /** PASSED only when every verdict is `pass`. */
  readonly status: EvalStatus;
}

/** The graded outcome of every set in one evaluation. */
export interface RunReport {
  /** Per-set reports, in the order the sets were evaluated. */
  readonly sets: readonly SetReport[];
  /** PASSED only when every set passed and at least one set was graded. */
  readonly status: EvalStatus;
  /** Why the run reached its status, for the CI log. */
  readonly summary: string;
}
