/**
 * Derivation of eval metrics from recorded model answers.
 *
 * Both sides of every comparison are measured HERE, by the same code, from
 * records of the same shape. That symmetry is the point: an incumbent baseline
 * computed by one routine and a candidate score computed by another would
 * differ by the routines as much as by the models, and the gate would be
 * measuring its own implementation.
 *
 * A metric that cannot be derived from the records present is returned as
 * `undefined` rather than as a zero or a default. Zero is a measurement; absence
 * is not, and the comparators depend on being able to tell them apart in order
 * to render `indeterminate` instead of a verdict they have not earned.
 *
 * @module llm/eval/metrics
 */

import { fieldF1, jsonEquals, p95, satisfiesShape } from "./json-shape";
import type {
  BaselineMetrics,
  GoldenCase,
  GoldenSet,
  RecordedResult,
  ToolExpectation,
} from "./types";

/**
 * Structured retries a tool-call site may spend before the answer stops
 * counting as a valid call.
 *
 * Section 6 permits exactly one: the retry exists to recover a malformed call
 * from a model that otherwise understood the request, and a site that needs
 * more than one has not produced a valid call — it has been coached into one,
 * which is a different capability from the one being measured.
 */
export const MAX_STRUCTURED_RETRIES = 1;

/** One graded case paired with the answer being scored. */
export interface MetricSample {
  /** The golden case. */
  readonly goldenCase: GoldenCase;
  /** The answer under measurement — incumbent or candidate. */
  readonly result: RecordedResult;
}

/**
 * Whether one recorded answer is a valid tool call under the site's contract.
 *
 * @param result The recorded answer.
 * @param expectation The tool contract the site requires.
 * @returns Whether the answer is a valid call within the permitted retry budget.
 */
export function isValidToolCall(
  result: RecordedResult,
  expectation: ToolExpectation,
): boolean {
  if ((result.structured_retries ?? 0) > MAX_STRUCTURED_RETRIES) {
    return false;
  }
  const call = (result.tool_calls ?? []).find((candidate) => candidate.name === expectation.tool);
  if (call === undefined) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.arguments);
  } catch {
    // A call whose arguments do not parse is not a call the site can execute.
    // This is the failure the structured retry exists to absorb, so it is
    // counted rather than swallowed.
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  const argumentObject = parsed as Record<string, unknown>;
  return expectation.required_arguments.every((key) =>
    Object.prototype.hasOwnProperty.call(argumentObject, key),
  );
}

/**
 * The mean of a sample, or `undefined` when any member is missing.
 *
 * All-or-nothing rather than a mean over whatever is present, because a mean
 * taken over the subset that happened to record a value silently reweights the
 * set toward the cases the recorder found easy.
 *
 * @param values The sample, with gaps expressed as `undefined`.
 * @returns The mean, or `undefined` when the sample is incomplete or empty.
 */
function completeMean(values: readonly (number | undefined)[]): number | undefined {
  if (values.length === 0 || values.some((value) => value === undefined)) {
    return undefined;
  }
  let total = 0;
  for (const value of values) {
    total += value ?? 0;
  }
  return total / values.length;
}

/**
 * Derive every metric a set's assertions need, from one side's answers.
 *
 * @param set The golden set, which fixes what is measured and how.
 * @param samples Cases paired with the answers being scored.
 * @returns The derived metrics; a metric the records cannot support is absent.
 */
export function deriveMetrics(
  set: GoldenSet,
  samples: readonly MetricSample[],
): BaselineMetrics {
  if (samples.length === 0) {
    return {};
  }
  const metrics: {
    schema_valid_rate?: number;
    exact_match_rate?: number;
    field_f1?: number;
    judge_score?: number;
    valid_call_rate?: number;
    latency_p95_ms?: number;
  } = {};

  const shape = set.response_shape;
  if (set.assertions.includes("schema-valid") && shape !== undefined) {
    const valid = samples.filter((sample) => satisfiesShape(sample.result.raw, shape)).length;
    metrics.schema_valid_rate = valid / samples.length;
  }

  if (set.assertions.includes("match")) {
    if (set.match_metric === "exact_match") {
      const matched = samples.filter((sample) =>
        jsonEquals(sample.result.raw, sample.goldenCase.expected),
      ).length;
      metrics.exact_match_rate = matched / samples.length;
    } else if (set.match_metric === "field_f1") {
      const scores = samples.map((sample) =>
        fieldF1(sample.result.raw, sample.goldenCase.expected),
      );
      metrics.field_f1 = completeMean(scores);
    }
  }

  if (set.assertions.includes("judge")) {
    metrics.judge_score = completeMean(samples.map((sample) => sample.result.judge_score));
  }

  const expectation = set.tool_expectation;
  if (set.assertions.includes("tool-call") && expectation !== undefined) {
    const valid = samples.filter((sample) => isValidToolCall(sample.result, expectation)).length;
    metrics.valid_call_rate = valid / samples.length;
  }

  if (set.assertions.includes("latency")) {
    const latencies = samples.map((sample) => sample.result.latency_ms);
    metrics.latency_p95_ms = latencies.some((value) => typeof value !== "number")
      ? undefined
      : (p95(latencies) ?? undefined);
  }

  return metrics;
}
