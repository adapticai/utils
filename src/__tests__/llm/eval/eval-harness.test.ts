/**
 * Tests for the LLM migration eval harness.
 *
 * Every comparator is exercised in three directions — a fixture it must admit,
 * a fixture it must reject, and a fixture it must refuse to decide — because a
 * gate is only trustworthy when all three have been seen. A comparator tested
 * only on the passing case is indistinguishable from one that returns `pass`
 * unconditionally, which is the exact defect an eval gate is meant to catch in
 * a model and must therefore not contain itself.
 *
 * @module __tests__/llm/eval/eval-harness
 */

import { beforeEach, describe, expect, it } from "vitest";

import { configureLlmClient } from "../../../llm";
import type {
  LlmAliasDefinition,
  LlmProvider,
  LlmRoute,
  LlmRouteDefaults,
  LlmRouteTable,
  LlmTransport,
  LlmTransportResponse,
  LlmUsageRecord,
} from "../../../llm/types";
import {
  BASELINE_ATTESTATION_TOLERANCE,
  GoldenSetError,
  JudgeNotPinnedError,
  MAX_STRUCTURED_RETRIES,
  PINNED_JUDGE,
  assertPinnedJudge,
  compareJudgeScore,
  compareLatencyP95,
  compareMatchScore,
  compareSchemaValidRate,
  compareValidCallRate,
  computeCoverage,
  deriveMetrics,
  evaluateRun,
  evaluateSet,
  fieldF1,
  isValidToolCall,
  jsonEquals,
  p95,
  parseCandidateRun,
  parseGoldenSet,
  satisfiesShape,
  scoreWithPinnedJudge,
} from "../../../llm/eval";
import type { CandidateRun, GoldenSet, Verdict } from "../../../llm/eval";

/** Cases in every fixture set, chosen to sit comfortably above the fixtures' min_n. */
const CASE_COUNT = 8;

/** min_n used by fixtures that are meant to be decidable. */
const DECIDABLE_MIN_N = 6;

/** Usage record a fake transport reports; the harness never reads it, but the type requires one. */
const FAKE_USAGE: LlmUsageRecord = {
  prompt_tokens: 1,
  completion_tokens: 1,
  provider: "fake",
  model: "fake",
  cost: 0,
};

/**
 * Build a structured-output golden set whose incumbent answers are all correct.
 *
 * @param overrides Fields to replace on the built set.
 * @returns The golden set.
 */
function structuredSet(overrides: Partial<GoldenSet> = {}): GoldenSet {
  const cases = Array.from({ length: CASE_COUNT }, (_unused, index) => ({
    id: `c-${index}`,
    input: `synthetic input ${index}`,
    expected: { subject: `s-${index}`, label: index % 2 === 0 ? "a" : "b" },
    incumbent_result: {
      raw: { subject: `s-${index}`, label: index % 2 === 0 ? "a" : "b" },
      latency_ms: 100 + index,
    },
  }));
  const base: GoldenSet = {
    id: "fixture-structured",
    call_site_category: "synthetic",
    alias: "llm.extract",
    eval_gate: "structured-output",
    min_n: DECIDABLE_MIN_N,
    redaction_profile: "synthetic-none",
    latency_class: "batch",
    assertions: ["schema-valid", "match", "latency"],
    match_metric: "field_f1",
    response_shape: {
      type: "object",
      properties: { subject: { type: "string" }, label: { type: "string", enum: ["a", "b"] } },
      required: ["subject", "label"],
    },
    incumbent_baseline: {
      recorded_at: "2026-09-10T00:00:00Z",
      source: "synthetic fixture",
      model_family: "synthetic",
      n: CASE_COUNT,
      metrics: { schema_valid_rate: 1, field_f1: 100, latency_p95_ms: 107 },
    },
    cases,
  };
  return { ...base, ...overrides };
}

/**
 * Build a candidate run answering a structured set.
 *
 * @param mutate Applied to each case's answer, so a fixture can spoil one axis.
 * @param setId The set the run answers.
 * @returns The candidate run.
 */
function structuredCandidate(
  mutate: (index: number) => { raw: unknown; latency_ms: number },
  setId = "fixture-structured",
): CandidateRun {
  const results: Record<string, { raw: unknown; latency_ms: number }> = {};
  for (let index = 0; index < CASE_COUNT; index += 1) {
    results[`c-${index}`] = mutate(index);
  }
  return {
    set_id: setId,
    candidate_label: "synthetic-candidate",
    recorded_at: "2026-09-10T00:00:00Z",
    results,
  };
}

/** A perfect candidate: same answers, faster. */
const PERFECT_CANDIDATE = (): CandidateRun =>
  structuredCandidate((index) => ({
    raw: { subject: `s-${index}`, label: index % 2 === 0 ? "a" : "b" },
    latency_ms: 50 + index,
  }));

/**
 * Find one assertion's verdict in a report.
 *
 * @param verdicts The verdicts.
 * @param assertion The assertion to find.
 * @returns The verdict.
 */
function verdictFor(verdicts: readonly Verdict[], assertion: string): Verdict {
  const found = verdicts.find((verdict) => verdict.assertion === assertion);
  if (found === undefined) {
    throw new Error(`no verdict rendered for "${assertion}"`);
  }
  return found;
}

/**
 * A transport that answers with a fixed payload and counts its calls.
 *
 * @param payload What every call returns.
 * @returns The transport and its call counter.
 */
function recordingTransport(payload: unknown): {
  transport: LlmTransport;
  calls: { count: number };
} {
  const calls = { count: 0 };
  const transport: LlmTransport = {
    name: "recording",
    /**
     * @returns The fixed payload.
     */
    execute<T>(): Promise<LlmTransportResponse<T>> {
      calls.count += 1;
      return Promise.resolve({ response: payload as T, usage: FAKE_USAGE });
    },
  };
  return { transport, calls };
}

/** A transport that fails if it is ever reached. */
const EXPLODING_TRANSPORT: LlmTransport = {
  name: "exploding",
  /**
   * @returns Never; always throws.
   */
  execute<T>(): Promise<LlmTransportResponse<T>> {
    throw new Error("transport must not be reached");
  },
};

/** Route-table defaults a synthetic table needs but no assertion here reads. */
const SYNTHETIC_DEFAULTS: LlmRouteDefaults = {
  request_timeout_ms: { "hot-path": 30000, background: 90000, batch: 300000 },
  retries_per_leg: 1,
  circuit_breaker: { failure_threshold: 5, cooldown_ms: 60000, half_open_probes: 1 },
};

/** The provider a synthetic judge table routes to. */
const SYNTHETIC_PROVIDER: LlmProvider = {
  display_name: "Synthetic Anthropic",
  tier: "closed",
  api_style: "anthropic",
  base_url: null,
  base_url_env: null,
  api_key_env: "SYNTHETIC_KEY_ENV",
  secret_path: "synthetic/path",
  account_status: "live",
  docs_url: "https://example.invalid/docs",
};

/**
 * Build a route table defining only the judge alias, varied one way at a time.
 *
 * Constructed from literals rather than copied from the canonical table so that
 * each pin condition is tested in isolation: a copy would carry every other
 * condition along with it, and a refusal could then be attributed to the wrong
 * one.
 *
 * @param overrides How this table differs from a correctly pinned one.
 * @param overrides.pinned Whether the alias is marked pinned.
 * @param overrides.modelId The model id the single route names.
 * @param overrides.evalGate The eval gate the alias declares.
 * @param overrides.withFallback Whether to add a second route.
 * @returns The synthetic table.
 */
function judgeTable(overrides: {
  pinned?: boolean;
  modelId?: string;
  evalGate?: LlmAliasDefinition["eval_gate"];
  withFallback?: boolean;
} = {}): LlmRouteTable {
  const primary: LlmRoute = {
    role: "primary",
    provider: "anthropic",
    model_id: overrides.modelId ?? PINNED_JUDGE.modelId,
    model_id_status: "confirmed",
    model_family: "synthetic-judge",
  };
  const routes: LlmRoute[] = overrides.withFallback === true
    ? [primary, { ...primary, role: "secondary" }]
    : [primary];
  const judge: LlmAliasDefinition = {
    workload: "Eval judging only",
    latency_class: "batch",
    criticality: "internal",
    isolation_capable: false,
    pinned: overrides.pinned ?? true,
    eval_gate: overrides.evalGate ?? "none-pinned-judge",
    budget: { basis: "provisional-pre-baseline", monthly_usd: 1, alert_pct: [100] },
    routes,
  };
  return {
    schema_version: 1,
    policy_source: "synthetic fixture",
    defaults: SYNTHETIC_DEFAULTS,
    providers: { anthropic: SYNTHETIC_PROVIDER },
    aliases: { [PINNED_JUDGE.alias]: judge },
  };
}

describe("json-shape primitives", () => {
  it("validates the documented JSON-shape subset", () => {
    const shape = {
      type: "object" as const,
      properties: { label: { type: "string" as const, enum: ["a", "b"] } },
      required: ["label"],
    };
    expect(satisfiesShape({ label: "a" }, shape)).toBe(true);
    expect(satisfiesShape({ label: "c" }, shape)).toBe(false);
    expect(satisfiesShape({}, shape)).toBe(false);
    expect(satisfiesShape("a", shape)).toBe(false);
  });

  it("treats object key order as irrelevant and array order as significant", () => {
    expect(jsonEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEquals([1, 2], [2, 1])).toBe(false);
  });

  it("scores field-level F1 partially rather than all-or-nothing", () => {
    expect(fieldF1({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(100);
    expect(fieldF1({ a: 1, b: 9 }, { a: 1, b: 2 })).toBeCloseTo(50, 6);
    expect(fieldF1({ a: 9 }, { a: 1 })).toBe(0);
  });

  it("takes p95 by nearest rank, so the value is one the sample contains", () => {
    expect(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(10);
    expect(p95([5])).toBe(5);
    expect(p95([])).toBeNull();
  });
});

describe("tool-call validity", () => {
  const expectation = { tool: "do_thing", required_arguments: ["target"] };

  it("accepts a well-formed call inside the permitted retry budget", () => {
    expect(
      isValidToolCall(
        {
          raw: null,
          latency_ms: 10,
          structured_retries: MAX_STRUCTURED_RETRIES,
          tool_calls: [{ name: "do_thing", arguments: '{"target":"x"}' }],
        },
        expectation,
      ),
    ).toBe(true);
  });

  it("rejects unparseable arguments, missing arguments, and an over-budget retry", () => {
    expect(
      isValidToolCall(
        { raw: null, latency_ms: 10, tool_calls: [{ name: "do_thing", arguments: '{"target":' }] },
        expectation,
      ),
    ).toBe(false);
    expect(
      isValidToolCall(
        { raw: null, latency_ms: 10, tool_calls: [{ name: "do_thing", arguments: "{}" }] },
        expectation,
      ),
    ).toBe(false);
    expect(
      isValidToolCall(
        {
          raw: null,
          latency_ms: 10,
          structured_retries: MAX_STRUCTURED_RETRIES + 1,
          tool_calls: [{ name: "do_thing", arguments: '{"target":"x"}' }],
        },
        expectation,
      ),
    ).toBe(false);
    expect(isValidToolCall({ raw: null, latency_ms: 10 }, expectation)).toBe(false);
  });
});

describe("comparators", () => {
  const decidable = { n: CASE_COUNT, minN: DECIDABLE_MIN_N };

  it("schema-valid rate passes at or above the incumbent and fails below it", () => {
    expect(compareSchemaValidRate({ candidate: 1, incumbent: 1, ...decidable }).kind).toBe("pass");
    expect(compareSchemaValidRate({ candidate: 0.99, incumbent: 1, ...decidable }).kind).toBe("fail");
  });

  it("valid-call rate passes at or above the incumbent and fails below it", () => {
    expect(compareValidCallRate({ candidate: 0.9, incumbent: 0.9, ...decidable }).kind).toBe("pass");
    expect(compareValidCallRate({ candidate: 0.8, incumbent: 0.9, ...decidable }).kind).toBe("fail");
  });

  it("match tolerates one point and no more", () => {
    expect(compareMatchScore({ candidate: 89, incumbent: 90, ...decidable }).kind).toBe("pass");
    expect(compareMatchScore({ candidate: 88.9, incumbent: 90, ...decidable }).kind).toBe("fail");
  });

  it("judge tolerates three percent and no more", () => {
    expect(compareJudgeScore({ candidate: 87.3, incumbent: 90, ...decidable }).kind).toBe("pass");
    expect(compareJudgeScore({ candidate: 87, incumbent: 90, ...decidable }).kind).toBe("fail");
  });

  it("latency passes when the candidate is no slower and fails when it is", () => {
    expect(compareLatencyP95({ candidate: 900, incumbent: 900, ...decidable }).kind).toBe("pass");
    expect(compareLatencyP95({ candidate: 901, incumbent: 900, ...decidable }).kind).toBe("fail");
  });

  it("refuses to decide without an incumbent baseline, and never defaults to pass", () => {
    const verdict = compareSchemaValidRate({ candidate: 1, incumbent: undefined, ...decidable });
    expect(verdict.kind).toBe("indeterminate");
    if (verdict.kind === "indeterminate") {
      expect(verdict.reason).toContain("no recorded incumbent baseline");
    }
  });

  it("refuses to decide without a candidate measurement", () => {
    expect(
      compareLatencyP95({ candidate: undefined, incumbent: 900, ...decidable }).kind,
    ).toBe("indeterminate");
  });

  it("refuses to decide below the declared minimum sample", () => {
    const verdict = compareMatchScore({ candidate: 100, incumbent: 90, n: 3, minN: 30 });
    expect(verdict.kind).toBe("indeterminate");
    if (verdict.kind === "indeterminate") {
      expect(verdict.reason).toContain("min_n=30");
    }
  });
});

describe("metric derivation", () => {
  it("derives only what a set's assertions call for", () => {
    const set = structuredSet();
    const metrics = deriveMetrics(
      set,
      set.cases.map((goldenCase) => ({ goldenCase, result: goldenCase.incumbent_result })),
    );
    expect(metrics.schema_valid_rate).toBe(1);
    expect(metrics.field_f1).toBe(100);
    expect(metrics.latency_p95_ms).toBe(107);
    expect(metrics.judge_score).toBeUndefined();
    expect(metrics.valid_call_rate).toBeUndefined();
  });

  it("reports a judged metric as absent when any case is unscored", () => {
    const set = structuredSet({ assertions: ["schema-valid", "match", "latency", "judge"] });
    const samples = set.cases.map((goldenCase, index) => ({
      goldenCase,
      result:
        index === 0
          ? goldenCase.incumbent_result
          : { ...goldenCase.incumbent_result, judge_score: 90 },
    }));
    expect(deriveMetrics(set, samples).judge_score).toBeUndefined();
  });
});

describe("evaluateSet", () => {
  it("passes a candidate that matches the incumbent and is faster", () => {
    const report = evaluateSet(structuredSet(), PERFECT_CANDIDATE());
    expect(report.status).toBe("PASSED");
    expect(report.verdicts.every((verdict) => verdict.kind === "pass")).toBe(true);
  });

  it("fails only the schema assertion when only the shape is spoiled", () => {
    const candidate = structuredCandidate((index) => ({
      raw: index < 2 ? { subject: `s-${index}` } : { subject: `s-${index}`, label: index % 2 === 0 ? "a" : "b" },
      latency_ms: 50 + index,
    }));
    const report = evaluateSet(structuredSet(), candidate);
    expect(report.status).toBe("FAILED");
    expect(verdictFor(report.verdicts, "schema-valid").kind).toBe("fail");
    expect(verdictFor(report.verdicts, "latency").kind).toBe("pass");
  });

  it("fails only the latency assertion when only latency regresses", () => {
    const candidate = structuredCandidate((index) => ({
      raw: { subject: `s-${index}`, label: index % 2 === 0 ? "a" : "b" },
      latency_ms: 500 + index,
    }));
    const report = evaluateSet(structuredSet(), candidate);
    expect(report.status).toBe("FAILED");
    expect(verdictFor(report.verdicts, "latency").kind).toBe("fail");
    expect(verdictFor(report.verdicts, "schema-valid").kind).toBe("pass");
    expect(verdictFor(report.verdicts, "match").kind).toBe("pass");
  });

  it("renders indeterminate — never pass — when the attested baseline omits a metric", () => {
    const set = structuredSet({
      incumbent_baseline: {
        recorded_at: "2026-09-10T00:00:00Z",
        source: "synthetic fixture",
        model_family: "synthetic",
        n: CASE_COUNT,
        metrics: { schema_valid_rate: 1, latency_p95_ms: 107 },
      },
    });
    const report = evaluateSet(set, PERFECT_CANDIDATE());
    expect(verdictFor(report.verdicts, "match").kind).toBe("indeterminate");
    expect(report.status).toBe("FAILED");
  });

  it("renders indeterminate when the attested baseline disagrees with its own records", () => {
    const set = structuredSet({
      incumbent_baseline: {
        recorded_at: "2026-09-10T00:00:00Z",
        source: "synthetic fixture",
        model_family: "synthetic",
        n: CASE_COUNT,
        metrics: {
          schema_valid_rate: 1 - BASELINE_ATTESTATION_TOLERANCE * 1000,
          field_f1: 100,
          latency_p95_ms: 107,
        },
      },
    });
    const report = evaluateSet(set, PERFECT_CANDIDATE());
    expect(report.status).toBe("FAILED");
    expect(report.verdicts.every((verdict) => verdict.kind === "indeterminate")).toBe(true);
  });

  it("renders indeterminate rather than grading a partial candidate run", () => {
    const candidate = PERFECT_CANDIDATE();
    const partial: CandidateRun = {
      ...candidate,
      results: Object.fromEntries(Object.entries(candidate.results).slice(0, 4)),
    };
    const report = evaluateSet(structuredSet(), partial);
    expect(report.status).toBe("FAILED");
    expect(report.verdicts.every((verdict) => verdict.kind === "indeterminate")).toBe(true);
  });

  it("refuses to grade a candidate run that answers a different set", () => {
    expect(() =>
      evaluateSet(structuredSet(), structuredCandidate(() => ({ raw: {}, latency_ms: 1 }), "other")),
    ).toThrow(GoldenSetError);
  });
});

describe("evaluateRun", () => {
  it("fails an evaluation that graded nothing", () => {
    const report = evaluateRun([]);
    expect(report.status).toBe("FAILED");
    expect(report.summary).toContain("no golden sets were graded");
  });

  it("fails the run when any set fails", () => {
    const slow = structuredCandidate((index) => ({
      raw: { subject: `s-${index}`, label: index % 2 === 0 ? "a" : "b" },
      latency_ms: 900,
    }));
    const report = evaluateRun([
      { set: structuredSet(), candidate: PERFECT_CANDIDATE() },
      { set: structuredSet(), candidate: slow },
    ]);
    expect(report.status).toBe("FAILED");
  });
});

describe("golden-set parsing", () => {
  /**
   * Serialise a golden set to the JSON shape the parser reads.
   *
   * @param set The set.
   * @returns The parsed-JSON representation.
   */
  const asJson = (set: GoldenSet): unknown => JSON.parse(JSON.stringify(set));

  it("accepts a well-formed set", () => {
    expect(parseGoldenSet(asJson(structuredSet()), "test").id).toBe("fixture-structured");
  });

  it("rejects a set whose eval gate disagrees with the route table", () => {
    expect(() =>
      parseGoldenSet(asJson(structuredSet({ eval_gate: "tool-call" })), "test"),
    ).toThrow(GoldenSetError);
  });

  it("rejects a set whose latency class disagrees with the route table", () => {
    expect(() =>
      parseGoldenSet(asJson(structuredSet({ latency_class: "hot-path" })), "test"),
    ).toThrow(GoldenSetError);
  });

  it("rejects a schema assertion carried without a schema", () => {
    const raw = asJson(structuredSet()) as Record<string, unknown>;
    delete raw.response_shape;
    expect(() => parseGoldenSet(raw, "test")).toThrow(/response_shape/);
  });

  it("rejects a baseline whose n disagrees with the case count", () => {
    const set = structuredSet();
    const raw = asJson({
      ...set,
      incumbent_baseline: { ...set.incumbent_baseline, n: CASE_COUNT + 1 },
    }) as Record<string, unknown>;
    expect(() => parseGoldenSet(raw, "test")).toThrow(/disagrees with/);
  });

  it("rejects duplicate case ids", () => {
    const set = structuredSet();
    const raw = asJson({ ...set, cases: [set.cases[0], set.cases[0]] }) as Record<string, unknown>;
    (raw.incumbent_baseline as { n: number }).n = 2;
    expect(() => parseGoldenSet(raw, "test")).toThrow(/duplicated/);
  });

  it("round-trips a candidate run", () => {
    const run = parseCandidateRun(JSON.parse(JSON.stringify(PERFECT_CANDIDATE())), "test");
    expect(Object.keys(run.results)).toHaveLength(CASE_COUNT);
  });
});

describe("judge pinning (PD-6)", () => {
  beforeEach(() => {
    configureLlmClient({
      gatewayTransport: EXPLODING_TRANSPORT,
      directTransport: EXPLODING_TRANSPORT,
    });
  });

  it("accepts the pinned judge as the canonical route table defines it", () => {
    const resolved = assertPinnedJudge(PINNED_JUDGE.alias);
    expect(resolved.provider).toBe(PINNED_JUDGE.provider);
    expect(resolved.modelId).toBe(PINNED_JUDGE.modelId);
  });

  it("refuses any alias other than the pinned judge", () => {
    expect(() => assertPinnedJudge("llm.reason")).toThrow(JudgeNotPinnedError);
  });

  it("accepts a correctly pinned synthetic table, isolating the conditions below", () => {
    expect(assertPinnedJudge(PINNED_JUDGE.alias, judgeTable()).modelId).toBe(PINNED_JUDGE.modelId);
  });

  it("refuses a route table that unpins the judge", () => {
    expect(() => assertPinnedJudge(PINNED_JUDGE.alias, judgeTable({ pinned: false }))).toThrow(
      JudgeNotPinnedError,
    );
  });

  it("refuses a route table that swaps the judge model", () => {
    expect(() =>
      assertPinnedJudge(PINNED_JUDGE.alias, judgeTable({ modelId: "some-other-model" })),
    ).toThrow(JudgeNotPinnedError);
  });

  it("refuses a judge that has acquired a fallback leg", () => {
    expect(() =>
      assertPinnedJudge(PINNED_JUDGE.alias, judgeTable({ withFallback: true })),
    ).toThrow(JudgeNotPinnedError);
  });

  it("refuses a judge whose eval gate is not the pinned-judge gate", () => {
    expect(() =>
      assertPinnedJudge(PINNED_JUDGE.alias, judgeTable({ evalGate: "free-text-judge" })),
    ).toThrow(JudgeNotPinnedError);
  });

  it("refuses to grade a judged set through a non-pinned alias", () => {
    const set = structuredSet({
      assertions: ["schema-valid", "match", "latency", "judge"],
    });
    expect(() => evaluateSet(set, PERFECT_CANDIDATE(), { judgeAlias: "llm.reason" })).toThrow(
      JudgeNotPinnedError,
    );
  });

  it("refuses a judge call through a non-pinned alias before any transport is reached", async () => {
    await expect(
      scoreWithPinnedJudge(
        { rubric: "r", input: "i", reference: "e", answer: "a" },
        { alias: "llm.reason" },
      ),
    ).rejects.toBeInstanceOf(JudgeNotPinnedError);
  });

  it("scores through the pinned judge alias and validates the reply", async () => {
    const { transport, calls } = recordingTransport({ score: 91 });
    configureLlmClient({ gatewayTransport: transport, directTransport: EXPLODING_TRANSPORT });
    const score = await scoreWithPinnedJudge({
      rubric: "r",
      input: "i",
      reference: "e",
      answer: "a",
    });
    expect(score).toBe(91);
    expect(calls.count).toBe(1);
  });

  it("rejects a judge reply that carries no usable score", async () => {
    const { transport } = recordingTransport({ verdict: "good" });
    configureLlmClient({ gatewayTransport: transport, directTransport: EXPLODING_TRANSPORT });
    await expect(
      scoreWithPinnedJudge({ rubric: "r", input: "i", reference: "e", answer: "a" }),
    ).rejects.toThrow();
  });
});

describe("coverage", () => {
  it("passes only when every required assertion was demonstrated both ways", () => {
    const all = ["schema-valid", "match", "judge", "tool-call", "latency"] as const;
    expect(computeCoverage({ green: [...all], red: [...all] }).status).toBe("PASSED");
  });

  it("fails when an assertion was never demonstrated failing", () => {
    const all = ["schema-valid", "match", "judge", "tool-call", "latency"] as const;
    const report = computeCoverage({ green: [...all], red: ["match", "judge", "tool-call", "latency"] });
    expect(report.status).toBe("FAILED");
    expect(report.problems.join(" ")).toContain("never demonstrated FAILING");
  });

  it("fails when the pinned judge cannot be verified", () => {
    const all = ["schema-valid", "match", "judge", "tool-call", "latency"] as const;
    const report = computeCoverage({ green: [...all], red: [...all] }, judgeTable({ pinned: false }));
    expect(report.status).toBe("FAILED");
    expect(report.problems.join(" ")).toContain("pinned-judge alias is not covered");
  });
});
