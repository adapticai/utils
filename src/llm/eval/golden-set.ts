/**
 * Parsing and structural validation of golden sets and candidate runs.
 *
 * A golden set is evidence, and evidence that is not validated on the way in is
 * evidence nobody can rely on later. Every field is checked here, at the edge,
 * so that by the time a comparator sees a number the only remaining question is
 * the one the comparator exists to answer.
 *
 * Validation is strict in one particular direction: a set that declares an
 * assertion must carry everything that assertion needs. A set asserting
 * `schema-valid` without a response shape, or `tool-call` without a tool
 * contract, is rejected rather than quietly graded on the assertions it does
 * support — a gate that drops the check it cannot perform is a gate that gets
 * weaker exactly where the evidence is thinnest.
 *
 * @module llm/eval/golden-set
 */

import { routeTable } from "../route-table";
import type { LlmAlias, LlmLatencyClass } from "../types";
import { EVAL_GATE_ASSERTIONS } from "./comparators";
import type {
  CandidateRun,
  EvalAssertion,
  EvalGate,
  GoldenCase,
  GoldenSet,
  IncumbentBaseline,
  JsonShape,
  MatchMetric,
  RecordedResult,
  RecordedToolCall,
  ToolExpectation,
} from "./types";

/** Thrown when a golden set or candidate run is not well formed. */
export class GoldenSetError extends Error {
  /** Where the malformed document came from, so the message is actionable. */
  public readonly origin: string;

  /**
   * @param origin Where the document came from.
   * @param detail What is wrong with it.
   */
  public constructor(origin: string, detail: string) {
    super(`golden-set document "${origin}" is invalid: ${detail}`);
    this.name = "GoldenSetError";
    this.origin = origin;
  }
}

/** Every assertion name the harness recognises. */
const KNOWN_ASSERTIONS: readonly EvalAssertion[] = [
  "schema-valid",
  "match",
  "judge",
  "tool-call",
  "latency",
];

/** Every match measurement a set may be scored on. */
const KNOWN_MATCH_METRICS: readonly MatchMetric[] = ["exact_match", "field_f1"];

/** Every JSON type the shape subset honours. */
const KNOWN_SHAPE_TYPES: readonly JsonShape["type"][] = [
  "object",
  "array",
  "string",
  "number",
  "integer",
  "boolean",
];

/**
 * Narrow an unknown value to a JSON object.
 *
 * @param value The value.
 * @param origin Document origin, for the error message.
 * @param path Field path, for the error message.
 * @returns The value as a record.
 * @throws {GoldenSetError} When the value is not a plain object.
 */
function requireObject(
  value: unknown,
  origin: string,
  path: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GoldenSetError(origin, `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Read a required string field.
 *
 * @param record The containing object.
 * @param key The field name.
 * @param origin Document origin, for the error message.
 * @param path Field path, for the error message.
 * @returns The string.
 * @throws {GoldenSetError} When the field is missing or not a non-empty string.
 */
function requireString(
  record: Record<string, unknown>,
  key: string,
  origin: string,
  path: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new GoldenSetError(origin, `${path}.${key} must be a non-empty string`);
  }
  return value;
}

/**
 * Read a required finite number field.
 *
 * @param record The containing object.
 * @param key The field name.
 * @param origin Document origin, for the error message.
 * @param path Field path, for the error message.
 * @returns The number.
 * @throws {GoldenSetError} When the field is missing or not finite.
 */
function requireNumber(
  record: Record<string, unknown>,
  key: string,
  origin: string,
  path: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GoldenSetError(origin, `${path}.${key} must be a finite number`);
  }
  return value;
}

/**
 * Read an optional finite number field.
 *
 * @param record The containing object.
 * @param key The field name.
 * @param origin Document origin, for the error message.
 * @param path Field path, for the error message.
 * @returns The number, or `undefined` when absent.
 * @throws {GoldenSetError} When present but not finite.
 */
function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  origin: string,
  path: string,
): number | undefined {
  if (record[key] === undefined) {
    return undefined;
  }
  return requireNumber(record, key, origin, path);
}

/**
 * Parse a JSON-shape node.
 *
 * @param value The raw node.
 * @param origin Document origin, for the error message.
 * @param path Field path, for the error message.
 * @returns The shape.
 * @throws {GoldenSetError} When the node is not a valid shape.
 */
function parseShape(value: unknown, origin: string, path: string): JsonShape {
  const record = requireObject(value, origin, path);
  const type = requireString(record, "type", origin, path);
  if (!KNOWN_SHAPE_TYPES.some((known) => known === type)) {
    throw new GoldenSetError(
      origin,
      `${path}.type "${type}" is outside the supported JSON-shape subset (${KNOWN_SHAPE_TYPES.join(", ")})`,
    );
  }
  const properties: Record<string, JsonShape> = {};
  if (record.properties !== undefined) {
    const rawProperties = requireObject(record.properties, origin, `${path}.properties`);
    for (const [key, child] of Object.entries(rawProperties)) {
      properties[key] = parseShape(child, origin, `${path}.properties.${key}`);
    }
  }
  const required: string[] = [];
  if (record.required !== undefined) {
    if (!Array.isArray(record.required)) {
      throw new GoldenSetError(origin, `${path}.required must be an array`);
    }
    for (const key of record.required) {
      if (typeof key !== "string") {
        throw new GoldenSetError(origin, `${path}.required entries must be strings`);
      }
      required.push(key);
    }
  }
  const enumValues: (string | number | boolean)[] = [];
  if (record.enum !== undefined) {
    if (!Array.isArray(record.enum)) {
      throw new GoldenSetError(origin, `${path}.enum must be an array`);
    }
    for (const option of record.enum) {
      if (
        typeof option !== "string" &&
        typeof option !== "number" &&
        typeof option !== "boolean"
      ) {
        throw new GoldenSetError(origin, `${path}.enum entries must be scalars`);
      }
      enumValues.push(option);
    }
  }
  return {
    type: type as JsonShape["type"],
    ...(record.properties !== undefined ? { properties } : {}),
    ...(record.required !== undefined ? { required } : {}),
    ...(record.items !== undefined
      ? { items: parseShape(record.items, origin, `${path}.items`) }
      : {}),
    ...(record.enum !== undefined ? { enum: enumValues } : {}),
  };
}

/**
 * Parse one recorded model answer.
 *
 * @param value The raw record.
 * @param origin Document origin, for the error message.
 * @param path Field path, for the error message.
 * @returns The recorded result.
 * @throws {GoldenSetError} When the record is malformed.
 */
function parseRecordedResult(
  value: unknown,
  origin: string,
  path: string,
): RecordedResult {
  const record = requireObject(value, origin, path);
  if (!Object.prototype.hasOwnProperty.call(record, "raw")) {
    throw new GoldenSetError(origin, `${path}.raw is required`);
  }
  const latency = requireNumber(record, "latency_ms", origin, path);
  if (latency < 0) {
    throw new GoldenSetError(origin, `${path}.latency_ms must not be negative`);
  }
  const toolCalls: RecordedToolCall[] = [];
  if (record.tool_calls !== undefined) {
    if (!Array.isArray(record.tool_calls)) {
      throw new GoldenSetError(origin, `${path}.tool_calls must be an array`);
    }
    record.tool_calls.forEach((call, index) => {
      const callRecord = requireObject(call, origin, `${path}.tool_calls[${index}]`);
      toolCalls.push({
        name: requireString(callRecord, "name", origin, `${path}.tool_calls[${index}]`),
        arguments: requireString(
          callRecord,
          "arguments",
          origin,
          `${path}.tool_calls[${index}]`,
        ),
      });
    });
  }
  const judgeScore = optionalNumber(record, "judge_score", origin, path);
  const retries = optionalNumber(record, "structured_retries", origin, path);
  return {
    raw: record.raw,
    latency_ms: latency,
    ...(record.tool_calls !== undefined ? { tool_calls: toolCalls } : {}),
    ...(judgeScore !== undefined ? { judge_score: judgeScore } : {}),
    ...(retries !== undefined ? { structured_retries: retries } : {}),
  };
}

/**
 * Parse the attested incumbent baseline.
 *
 * @param value The raw baseline.
 * @param origin Document origin, for the error message.
 * @returns The baseline.
 * @throws {GoldenSetError} When the baseline is malformed.
 */
function parseBaseline(value: unknown, origin: string): IncumbentBaseline {
  const path = "incumbent_baseline";
  const record = requireObject(value, origin, path);
  const metrics = requireObject(record.metrics, origin, `${path}.metrics`);
  return {
    recorded_at: requireString(record, "recorded_at", origin, path),
    source: requireString(record, "source", origin, path),
    model_family: requireString(record, "model_family", origin, path),
    n: requireNumber(record, "n", origin, path),
    metrics: {
      ...maybe("schema_valid_rate", optionalNumber(metrics, "schema_valid_rate", origin, `${path}.metrics`)),
      ...maybe("exact_match_rate", optionalNumber(metrics, "exact_match_rate", origin, `${path}.metrics`)),
      ...maybe("field_f1", optionalNumber(metrics, "field_f1", origin, `${path}.metrics`)),
      ...maybe("judge_score", optionalNumber(metrics, "judge_score", origin, `${path}.metrics`)),
      ...maybe("valid_call_rate", optionalNumber(metrics, "valid_call_rate", origin, `${path}.metrics`)),
      ...maybe("latency_p95_ms", optionalNumber(metrics, "latency_p95_ms", origin, `${path}.metrics`)),
    },
  };
}

/**
 * Build a single-entry object only when the value is present.
 *
 * Absence has to survive parsing intact: an optional metric materialised as
 * `undefined` and one materialised as `0` are the difference between
 * `indeterminate` and a verdict.
 *
 * @param key The field name.
 * @param value The value, or `undefined`.
 * @returns A one-entry record, or an empty one.
 */
function maybe(key: string, value: number | undefined): Record<string, number> {
  return value === undefined ? {} : { [key]: value };
}

/**
 * Parse and validate a golden set.
 *
 * @param raw The parsed JSON document.
 * @param origin Where it came from, quoted in any error.
 * @returns The validated golden set.
 * @throws {GoldenSetError} When the document is not a valid golden set.
 */
export function parseGoldenSet(raw: unknown, origin: string): GoldenSet {
  const record = requireObject(raw, origin, "$");
  const id = requireString(record, "id", origin, "$");
  const alias = requireString(record, "alias", origin, "$") as LlmAlias;
  const definition = routeTable.aliases[alias];
  if (definition === undefined) {
    throw new GoldenSetError(
      origin,
      `alias "${alias}" is not defined by the route table; a golden set grades a route that exists`,
    );
  }
  const evalGate = requireString(record, "eval_gate", origin, "$") as EvalGate;
  if (evalGate !== definition.eval_gate) {
    throw new GoldenSetError(
      origin,
      `eval_gate "${evalGate}" disagrees with the route table, which assigns "${definition.eval_gate}" to ${alias}`,
    );
  }
  const latencyClass = requireString(record, "latency_class", origin, "$") as LlmLatencyClass;
  if (latencyClass !== definition.latency_class) {
    throw new GoldenSetError(
      origin,
      `latency_class "${latencyClass}" disagrees with the route table, which assigns "${definition.latency_class}" to ${alias}`,
    );
  }

  if (!Array.isArray(record.assertions)) {
    throw new GoldenSetError(origin, "$.assertions must be an array");
  }
  const assertions: EvalAssertion[] = [];
  for (const entry of record.assertions) {
    if (typeof entry !== "string" || !KNOWN_ASSERTIONS.some((known) => known === entry)) {
      throw new GoldenSetError(
        origin,
        `$.assertions entry ${JSON.stringify(entry)} is not a known assertion (${KNOWN_ASSERTIONS.join(", ")})`,
      );
    }
    assertions.push(entry as EvalAssertion);
  }
  const required = EVAL_GATE_ASSERTIONS[evalGate];
  const missing = required.filter((entry) => !assertions.includes(entry));
  if (missing.length > 0) {
    throw new GoldenSetError(
      origin,
      `eval_gate "${evalGate}" requires assertions ${required.join(", ")}; missing ${missing.join(", ")}`,
    );
  }

  const minN = requireNumber(record, "min_n", origin, "$");
  if (minN < 1) {
    throw new GoldenSetError(origin, "$.min_n must be at least 1");
  }

  if (!Array.isArray(record.cases) || record.cases.length === 0) {
    throw new GoldenSetError(origin, "$.cases must be a non-empty array");
  }
  const cases: GoldenCase[] = [];
  const seen = new Set<string>();
  record.cases.forEach((entry, index) => {
    const path = `$.cases[${index}]`;
    const caseRecord = requireObject(entry, origin, path);
    const caseId = requireString(caseRecord, "id", origin, path);
    if (seen.has(caseId)) {
      throw new GoldenSetError(origin, `${path}.id "${caseId}" is duplicated`);
    }
    seen.add(caseId);
    if (!Object.prototype.hasOwnProperty.call(caseRecord, "expected")) {
      throw new GoldenSetError(origin, `${path}.expected is required`);
    }
    cases.push({
      id: caseId,
      input: requireString(caseRecord, "input", origin, path),
      expected: caseRecord.expected,
      incumbent_result: parseRecordedResult(
        caseRecord.incumbent_result,
        origin,
        `${path}.incumbent_result`,
      ),
    });
  });

  let matchMetric: MatchMetric | undefined;
  if (assertions.includes("match")) {
    const declared = requireString(record, "match_metric", origin, "$");
    if (!KNOWN_MATCH_METRICS.some((known) => known === declared)) {
      throw new GoldenSetError(
        origin,
        `$.match_metric "${declared}" must be one of ${KNOWN_MATCH_METRICS.join(", ")}`,
      );
    }
    matchMetric = declared as MatchMetric;
  }

  let shape: JsonShape | undefined;
  if (assertions.includes("schema-valid")) {
    if (record.response_shape === undefined) {
      throw new GoldenSetError(
        origin,
        'asserting "schema-valid" requires $.response_shape; a schema gate with no schema checks nothing',
      );
    }
    shape = parseShape(record.response_shape, origin, "$.response_shape");
  }

  let toolExpectation: ToolExpectation | undefined;
  if (assertions.includes("tool-call")) {
    const expectationRecord = requireObject(
      record.tool_expectation,
      origin,
      "$.tool_expectation",
    );
    const requiredArguments: string[] = [];
    if (!Array.isArray(expectationRecord.required_arguments)) {
      throw new GoldenSetError(origin, "$.tool_expectation.required_arguments must be an array");
    }
    for (const key of expectationRecord.required_arguments) {
      if (typeof key !== "string") {
        throw new GoldenSetError(
          origin,
          "$.tool_expectation.required_arguments entries must be strings",
        );
      }
      requiredArguments.push(key);
    }
    toolExpectation = {
      tool: requireString(expectationRecord, "tool", origin, "$.tool_expectation"),
      required_arguments: requiredArguments,
    };
  }

  const baseline = parseBaseline(record.incumbent_baseline, origin);
  if (baseline.n !== cases.length) {
    throw new GoldenSetError(
      origin,
      `incumbent_baseline.n=${baseline.n} disagrees with ${cases.length} recorded cases`,
    );
  }

  return {
    id,
    call_site_category: requireString(record, "call_site_category", origin, "$"),
    alias,
    eval_gate: evalGate,
    min_n: minN,
    redaction_profile: requireString(record, "redaction_profile", origin, "$"),
    latency_class: latencyClass,
    assertions,
    ...(matchMetric !== undefined ? { match_metric: matchMetric } : {}),
    ...(shape !== undefined ? { response_shape: shape } : {}),
    ...(toolExpectation !== undefined ? { tool_expectation: toolExpectation } : {}),
    incumbent_baseline: baseline,
    cases,
  };
}

/**
 * Parse and validate a candidate run.
 *
 * @param raw The parsed JSON document.
 * @param origin Where it came from, quoted in any error.
 * @returns The validated candidate run.
 * @throws {GoldenSetError} When the document is not a valid candidate run.
 */
export function parseCandidateRun(raw: unknown, origin: string): CandidateRun {
  const record = requireObject(raw, origin, "$");
  const resultsRecord = requireObject(record.results, origin, "$.results");
  const results: Record<string, RecordedResult> = {};
  for (const [caseId, entry] of Object.entries(resultsRecord)) {
    results[caseId] = parseRecordedResult(entry, origin, `$.results.${caseId}`);
  }
  return {
    set_id: requireString(record, "set_id", origin, "$"),
    candidate_label: requireString(record, "candidate_label", origin, "$"),
    recorded_at: requireString(record, "recorded_at", origin, "$"),
    results,
  };
}
