/**
 * The report of a decision contract probe.
 *
 * A run's report is the one thing the probe writes. It is read by whoever
 * decides whether a route's contract is confirmed, and by whoever sets the
 * limits a route runs under, so it holds what those two decisions need and is
 * built to be safe to hand to either.
 *
 * It holds counts, timings and model ids, and classifications this package
 * defines: a fault from the closed list of faults, a body shape from the closed
 * list of shapes, the names of headers from a short list. It never holds a
 * key, a response body, or the value of a header. The answers themselves are
 * not written either: what is kept of them is how far each distribution's sum
 * lies from one and how many different answers the same request drew.
 *
 * Latency is reported so that a limit can be derived from it and so that it
 * cannot be over-read. Every duration is written, in the order the calls were
 * made, so any statistic can be recomputed and the first call of a run, which
 * also opens the connection, can be told from the rest. A percentile is stated
 * only from a sample large enough to tell it from the largest value seen: a
 * percentile of four calls is not a measurement of a tail, and a limit set on
 * one would be set on a guess.
 *
 * Everything here is a pure function of its arguments.
 *
 * @module scripts/decision-probe/probe-report
 */

import type { DecisionFault } from "../../src/llm/decision/errors";
import { VENDOR_REQUEST_ID_HEADER } from "../../src/llm/decision/transports/systemone";
import type { DecisionRoute } from "../../src/llm/decision/types";
import { PROBE_ANSWERABLE_SHAPES, PROBE_RECORDED_HEADER_PREFIX, PROBE_REFUSAL_SHAPE } from "./probe-plan";
import type { ProbeAnswerableShape, ProbeBodyShape, ProbeObservation, ProbeShape } from "./probe-plan";

/** The layout of the report. A reader checks it before reading anything else. */
export const PROBE_REPORT_SCHEMA_VERSION = 1;

/** The name the report gives the tool that wrote it. */
export const PROBE_TOOL_NAME = "probe-decision-contract";

/**
 * The evidence class of a report made by authenticated calls to the vendor.
 *
 * The same label the contract fixtures' manifest reserves for a response
 * recorded from an authenticated call.
 */
export const PROBE_EVIDENCE_AUTHENTICATED = "observed-authenticated";

/**
 * Why a report is not evidence about the vendor.
 *
 * - `base_url_overridden`: the calls went to a base URL the environment
 *   supplied and not to the one the route table declares, so whatever answered
 *   was not established to be the vendor.
 * - `no_authenticated_answer`: no call was answered, so no authenticated
 *   response was observed.
 */
export type ProbeEvidenceWithheld = "base_url_overridden" | "no_authenticated_answer";

/** Where the calls of a run went. */
export type ProbeEndpoint = "declared" | "environment_override";

/**
 * How one call ended.
 *
 * - `answered`: a status in the success range arrived and, for an answerable
 *   request, the pinned model answered and the answer decoded.
 * - `refused`: the vendor rejected the request as invalid, which is what the
 *   refused request is sent to see.
 * - `fault`: anything else.
 */
export type ProbeSampleOutcome = "answered" | "refused" | "fault";

/** What the probe keeps of one call. */
export interface ProbeSample {
  /** The call's position in the run, from zero. */
  readonly sequence: number;
  readonly shape: ProbeShape;
  readonly outcome: ProbeSampleOutcome;
  /** The fault the call ended in, or `null` when it did not end in one. */
  readonly fault: DecisionFault | null;
  /** The fault's own closed-list source, such as `vendor_rejected`, or `null` when it states none. */
  readonly faultSource: string | null;
  /**
   * Where an answer failed validation, as far as the path is written in the
   * request's own names, or `null` when the fault names no field.
   */
  readonly faultFieldPath: string | null;
  /** Whether part of that path was a name the vendor wrote, and was left out. */
  readonly faultFieldPathWithheld: boolean;
  /** The HTTP status, or `null` when no response arrived. */
  readonly status: number | null;
  /** Time from the request leaving until the response's headers arrived, or `null` when none did. */
  readonly headersMs: number | null;
  /** Time from the request leaving until the whole body was read, or `null` when it was not. */
  readonly bodyMs: number | null;
  /** Time from dispatch until the call settled, whatever it settled as. */
  readonly settledMs: number;
  /** What was kept of the response, or `null` when none arrived. */
  readonly observation: ProbeObservation | null;
  /** The model the vendor reports answered, when it has the form of a model id; otherwise `null`. */
  readonly servedModel: string | null;
  /** Whether the vendor reported a model whose text is not written down. */
  readonly servedModelWithheld: boolean;
  /** Whether the reported model is the route's pin, compared in full, or `null` when none was reported. */
  readonly servedModelMatchesPin: boolean | null;
  /** The input tokens the vendor reported, or `null` when it reported none. */
  readonly inputTokens: number | null;
  /** The output tokens the vendor reported, or `null` when it reported none. */
  readonly outputTokens: number | null;
  /** The cost at the route's declared price, or `null` when a term of it is unknown. */
  readonly cost: number | null;
  /** Each question's distribution sum, `null` for a yes/no; or `null` when no answer decoded. */
  readonly probabilitySums: Readonly<Record<string, number | null>> | null;
}

/** One call's sample, with what is used of its answer and never written. */
export interface ProbeDispatchResult {
  readonly sample: ProbeSample;
  /**
   * The decoded answers in canonical form, for counting how many different
   * answers one request drew. `null` when no answer decoded. Never written.
   */
  readonly answerKey: string | null;
}

/** A percentile the report states, and the smallest sample it is stated from. */
interface LatencyPercentile {
  readonly name: "p50" | "p90" | "p95" | "p99";
  /** The percentile, as a whole number of hundredths. */
  readonly percent: number;
  /**
   * The smallest sample in which this percentile is not simply the largest
   * value: below it the nearest rank is the last one, and the number reported
   * would be a maximum under another name.
   */
  readonly minimumSamples: number;
}

/** The percentiles a latency summary states. */
const LATENCY_PERCENTILES: readonly LatencyPercentile[] = [
  { name: "p50", percent: 50, minimumSamples: 2 },
  { name: "p90", percent: 90, minimumSamples: 10 },
  { name: "p95", percent: 95, minimumSamples: 20 },
  { name: "p99", percent: 99, minimumSamples: 100 },
];

/** How many hundredths make the whole. */
const PERCENT_WHOLE = 100;

/** What a distribution's probabilities sum to when they are exact. */
const DISTRIBUTION_TOTAL = 1;

/** The latency of one request shape. */
export interface ProbeLatencySummary {
  /** How many calls the summary is of. Read it before any other field. */
  readonly n: number;
  /** The smallest duration, or `null` when there is no call. */
  readonly min: number | null;
  /** The median, or `null` from fewer than two calls. */
  readonly p50: number | null;
  /** The 90th percentile, or `null` from fewer than ten calls. */
  readonly p90: number | null;
  /** The 95th percentile, or `null` from fewer than twenty calls. */
  readonly p95: number | null;
  /** The 99th percentile, or `null` from fewer than a hundred calls. */
  readonly p99: number | null;
  /** The largest duration, or `null` when there is no call. */
  readonly max: number | null;
}

/**
 * Summarise a sample of durations.
 *
 * A percentile is the nearest-rank value. The rank is computed in whole
 * numbers, because a percentile written as a fraction multiplies inexactly and
 * can land one rank high. A percentile the sample is too small to tell from
 * its largest value is `null`, and an empty sample has no smallest or largest
 * value: none of them is ever zero for want of a call.
 *
 * @param durationsMs The durations, in any order.
 * @returns The count, the extremes and the percentiles the sample supports.
 */
export function summariseLatency(durationsMs: readonly number[]): ProbeLatencySummary {
  const sorted = [...durationsMs].sort((left, right) => left - right);
  const n = sorted.length;
  const percentile = (name: LatencyPercentile["name"]): number | null => {
    const stated = LATENCY_PERCENTILES.find((candidate) => candidate.name === name);
    if (stated === undefined || n < stated.minimumSamples) {
      return null;
    }
    return sorted[Math.ceil((stated.percent * n) / PERCENT_WHOLE) - 1];
  };
  return {
    n,
    min: n === 0 ? null : sorted[0],
    p50: percentile("p50"),
    p90: percentile("p90"),
    p95: percentile("p95"),
    p99: percentile("p99"),
    max: n === 0 ? null : sorted[n - 1],
  };
}

/** What a run found about one answerable shape. */
export interface ProbeShapeSummary {
  /** How many calls of this shape were made. */
  readonly dispatched: number;
  /** How many were answered by the pinned model with an answer that decoded. */
  readonly answered: number;
  /** How many ended in each fault. A fault that never occurred is absent. */
  readonly faults: Readonly<Partial<Record<DecisionFault, number>>>;
  /**
   * The latency of the calls a status in the success range arrived for, from
   * the request leaving until the whole body was read.
   */
  readonly latencyMs: ProbeLatencySummary;
  /** The durations that summary is of, in the order the calls were made. */
  readonly durationsMs: readonly number[];
  /** How many of those took longer than the budget the route declares. */
  readonly overRouteBudget: number;
  /** Each different input-token count the vendor reported, ascending. */
  readonly inputTokens: readonly number[];
  /** How many different answers the decoded calls drew, or `null` when none decoded. */
  readonly distinctAnswers: number | null;
  /** The furthest any distribution's sum lay from one, or `null` when there was no distribution. */
  readonly largestSumDeviation: number | null;
}

/** Whether something was present on every response, on some, or on none. */
export type ProbePresence = "always" | "sometimes" | "never";

/** What the refused request drew. */
export interface ProbeRefusalFinding {
  /**
   * - `refused`: the vendor rejected it as invalid.
   * - `answered`: the vendor answered it, so the field left out is not required.
   * - `fault`: it ended in a fault that is not the refusal it was sent to see.
   */
  readonly outcome: ProbeSampleOutcome;
  readonly status: number | null;
  /** The shape of the body the vendor sent with it, or `null` when no response arrived. */
  readonly bodyShape: ProbeBodyShape | null;
}

/** What a run found about the contract. */
export interface ProbeFindings {
  /** Every different model id recorded from a response, sorted. */
  readonly servedModels: readonly string[];
  /** Whether a success reported its input tokens, or `null` when there was no success. */
  readonly usageOnAnswers: ProbePresence | null;
  /** Whether a success carried the vendor's request id, or `null` when there was no success. */
  readonly requestIdOnAnswers: ProbePresence | null;
  /** Whether a failing response carried the vendor's request id, or `null` when there was none. */
  readonly requestIdOnFailures: ProbePresence | null;
  /** The name of every rate-limit header any response carried, sorted. */
  readonly rateLimitHeaderNames: readonly string[];
  /** The furthest any distribution's sum lay from one, or `null` when there was no distribution. */
  readonly largestSumDeviation: number | null;
  /** What the refused request drew, or `null` when it was not sent. */
  readonly refusal: ProbeRefusalFinding | null;
}

/** Whether a run confirmed the contract. */
export type ProbeVerdict = "confirmed" | "not_confirmed";

/** What a report is assembled from, besides the calls. */
export interface ProbeRunFacts {
  readonly route: DecisionRoute;
  readonly provider: string;
  readonly modelPin: string;
  readonly expectedServedModel: string;
  readonly endpoint: ProbeEndpoint;
  /** The budget the route declares, in milliseconds. */
  readonly routeBudgetMs: number;
  /** How long the probe waited for one call before abandoning it, in milliseconds. */
  readonly requestTimeoutMs: number;
  /** The least time between two dispatches, in milliseconds. */
  readonly minDispatchIntervalMs: number;
  readonly samplesPerShape: number;
  /** How many calls the plan held. */
  readonly planned: number;
  /** How many answerable calls the plan held. */
  readonly plannedAnswerable: number;
  /** The instant the run began and ended, in milliseconds since the epoch. */
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  /** Why the run stopped before its plan was done, or `null` when it ran to the end. */
  readonly stopped: "credential" | null;
}

/** The report of a run. */
export interface ProbeReport {
  readonly schemaVersion: typeof PROBE_REPORT_SCHEMA_VERSION;
  readonly tool: typeof PROBE_TOOL_NAME;
  /** The evidence class of the report, or `null` when it is not evidence about the vendor. */
  readonly evidence: typeof PROBE_EVIDENCE_AUTHENTICATED | null;
  /** Why the report is not evidence about the vendor, or `null` when it is. */
  readonly evidenceWithheld: ProbeEvidenceWithheld | null;
  /** The calendar date of the run, in UTC. */
  readonly observedOn: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly route: DecisionRoute;
  readonly provider: string;
  readonly modelPin: string;
  readonly expectedServedModel: string;
  readonly endpoint: ProbeEndpoint;
  readonly routeBudgetMs: number;
  readonly requestTimeoutMs: number;
  readonly minDispatchIntervalMs: number;
  readonly samplesPerShape: number;
  readonly planned: number;
  readonly dispatched: number;
  readonly stopped: "credential" | null;
  readonly verdict: ProbeVerdict;
  /** Why the contract is not confirmed, sorted: the faults that occurred, and `stopped_early`. */
  readonly verdictReasons: readonly string[];
  readonly findings: ProbeFindings;
  readonly shapes: Readonly<Record<ProbeAnswerableShape, ProbeShapeSummary>>;
  readonly samples: readonly ProbeSample[];
}

/** How many characters of an ISO timestamp are its calendar date. */
const ISO_DATE_LENGTH = 10;

/** First status of the range that is an answer. */
const SUCCESS_STATUS_FIRST = 200;

/** First status past the range that is an answer. */
const SUCCESS_STATUS_END = 300;

/**
 * Whether a call drew a status in the success range.
 *
 * @param sample The call.
 * @returns True when a response arrived and its status is an answer.
 */
function isSuccess(sample: ProbeSample): boolean {
  return sample.status !== null && sample.status >= SUCCESS_STATUS_FIRST && sample.status < SUCCESS_STATUS_END;
}

/**
 * The calendar date of an instant, in UTC.
 *
 * @param epochMs The instant, in milliseconds since the epoch.
 * @returns The date as `YYYY-MM-DD`.
 */
export function utcDateOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, ISO_DATE_LENGTH);
}

/**
 * How often something held across a set of calls.
 *
 * @param samples The calls.
 * @param holds Whether it held for one call.
 * @returns `always`, `sometimes` or `never`, or `null` when there is no call to ask it of.
 */
function presenceOver(samples: readonly ProbeSample[], holds: (sample: ProbeSample) => boolean): ProbePresence | null {
  if (samples.length === 0) {
    return null;
  }
  const count = samples.filter(holds).length;
  if (count === samples.length) {
    return "always";
  }
  return count === 0 ? "never" : "sometimes";
}

/**
 * The furthest any distribution's sum lay from one.
 *
 * @param samples The calls.
 * @returns The largest deviation, or `null` when no call decoded a distribution.
 */
function largestSumDeviationOf(samples: readonly ProbeSample[]): number | null {
  const deviations = samples.flatMap((sample) =>
    Object.values(sample.probabilitySums ?? {}).flatMap((sum) =>
      sum === null ? [] : [Math.abs(sum - DISTRIBUTION_TOTAL)],
    ),
  );
  return deviations.length === 0 ? null : Math.max(...deviations);
}

/**
 * Whether a response carried the vendor's request id.
 *
 * @param sample The call.
 * @returns True when the response's recorded headers include the request id's.
 */
function carriesRequestId(sample: ProbeSample): boolean {
  return sample.observation !== null && sample.observation.headersPresent.includes(VENDOR_REQUEST_ID_HEADER);
}

/**
 * Summarise the calls of one answerable shape.
 *
 * @param results The calls of that shape, in the order they were made.
 * @param routeBudgetMs The budget the route declares.
 * @returns The summary.
 */
function summariseShape(results: readonly ProbeDispatchResult[], routeBudgetMs: number): ProbeShapeSummary {
  const samples = results.map((result) => result.sample);
  const faults: Partial<Record<DecisionFault, number>> = {};
  for (const sample of samples) {
    if (sample.fault !== null) {
      faults[sample.fault] = (faults[sample.fault] ?? 0) + 1;
    }
  }
  const durationsMs = samples.flatMap((sample) =>
    isSuccess(sample) && sample.bodyMs !== null ? [sample.bodyMs] : [],
  );
  const answerKeys = results.flatMap((result) => (result.answerKey === null ? [] : [result.answerKey]));
  const inputTokens = samples.flatMap((sample) => (sample.inputTokens === null ? [] : [sample.inputTokens]));
  return {
    dispatched: samples.length,
    answered: samples.filter((sample) => sample.outcome === "answered").length,
    faults,
    latencyMs: summariseLatency(durationsMs),
    durationsMs,
    overRouteBudget: durationsMs.filter((duration) => duration > routeBudgetMs).length,
    inputTokens: [...new Set(inputTokens)].sort((left, right) => left - right),
    distinctAnswers: answerKeys.length === 0 ? null : new Set(answerKeys).size,
    largestSumDeviation: largestSumDeviationOf(samples),
  };
}

/**
 * Assemble the report of a run.
 *
 * The contract is confirmed only when every answerable call the plan held was
 * made, was answered by the pinned model, and decoded. The refused request
 * does not decide the verdict: what it drew is a finding, whichever way it
 * went.
 *
 * The report is labelled as evidence about the vendor only when the calls went
 * to the base URL the route table declares and at least one was answered. A
 * run against any other base URL measured whatever answered there.
 *
 * @param facts What the run was, besides its calls.
 * @param results The calls, in the order they were made.
 * @returns The report.
 */
export function assembleProbeReport(facts: ProbeRunFacts, results: readonly ProbeDispatchResult[]): ProbeReport {
  const samples = results.map((result) => result.sample);
  const answerable = results.filter((result) => result.sample.shape !== PROBE_REFUSAL_SHAPE);
  const answerableSamples = answerable.map((result) => result.sample);
  const successes = samples.filter(isSuccess);
  const failures = samples.filter((sample) => sample.status !== null && !isSuccess(sample));
  const refusal = samples.find((sample) => sample.shape === PROBE_REFUSAL_SHAPE);

  const reasons = new Set<string>();
  for (const sample of answerableSamples) {
    if (sample.fault !== null) {
      reasons.add(sample.fault);
    }
  }
  if (answerableSamples.length < facts.plannedAnswerable) {
    reasons.add("stopped_early");
  }
  const answeredAll =
    facts.plannedAnswerable > 0 &&
    answerableSamples.filter((sample) => sample.outcome === "answered").length === facts.plannedAnswerable;

  let evidenceWithheld: ProbeEvidenceWithheld | null = null;
  if (facts.endpoint !== "declared") {
    evidenceWithheld = "base_url_overridden";
  } else if (successes.length === 0) {
    evidenceWithheld = "no_authenticated_answer";
  }

  const shapeSummary = (shape: ProbeAnswerableShape): ProbeShapeSummary =>
    summariseShape(
      answerable.filter((result) => result.sample.shape === shape),
      facts.routeBudgetMs,
    );
  const headerNames = samples.flatMap((sample) => sample.observation?.headersPresent ?? []);
  const servedModels = samples.flatMap((sample) => (sample.servedModel === null ? [] : [sample.servedModel]));

  return {
    schemaVersion: PROBE_REPORT_SCHEMA_VERSION,
    tool: PROBE_TOOL_NAME,
    evidence: evidenceWithheld === null ? PROBE_EVIDENCE_AUTHENTICATED : null,
    evidenceWithheld,
    observedOn: utcDateOf(facts.startedAtMs),
    startedAt: new Date(facts.startedAtMs).toISOString(),
    finishedAt: new Date(facts.finishedAtMs).toISOString(),
    route: facts.route,
    provider: facts.provider,
    modelPin: facts.modelPin,
    expectedServedModel: facts.expectedServedModel,
    endpoint: facts.endpoint,
    routeBudgetMs: facts.routeBudgetMs,
    requestTimeoutMs: facts.requestTimeoutMs,
    minDispatchIntervalMs: facts.minDispatchIntervalMs,
    samplesPerShape: facts.samplesPerShape,
    planned: facts.planned,
    dispatched: samples.length,
    stopped: facts.stopped,
    verdict: answeredAll && reasons.size === 0 ? "confirmed" : "not_confirmed",
    verdictReasons: [...reasons].sort(),
    findings: {
      servedModels: [...new Set(servedModels)].sort(),
      usageOnAnswers: presenceOver(successes, (sample) => sample.inputTokens !== null),
      requestIdOnAnswers: presenceOver(successes, carriesRequestId),
      requestIdOnFailures: presenceOver(failures, carriesRequestId),
      rateLimitHeaderNames: [
        ...new Set(headerNames.filter((name) => name.startsWith(PROBE_RECORDED_HEADER_PREFIX))),
      ].sort(),
      largestSumDeviation: largestSumDeviationOf(samples),
      refusal:
        refusal === undefined
          ? null
          : { outcome: refusal.outcome, status: refusal.status, bodyShape: refusal.observation?.bodyShape ?? null },
    },
    shapes: {
      choice: shapeSummary("choice"),
      noul: shapeSummary("noul"),
      score: shapeSummary("score"),
    },
    samples,
  };
}

/**
 * Write a number that may be absent.
 *
 * @param value The number, or `null`.
 * @returns The number as text, or the words for an absent reading.
 */
function shown(value: number | string | null): string {
  return value === null ? "not measured" : String(value);
}

/**
 * The lines an operator reads after a run.
 *
 * Written from the report and from nothing else, so the screen and the file
 * cannot say different things, and the screen holds nothing the file may not.
 *
 * @param report The report.
 * @returns The lines, in the order they are printed.
 */
export function renderProbeSummary(report: ProbeReport): string[] {
  const { findings } = report;
  const listed = (names: readonly string[], none: string): string => (names.length === 0 ? none : names.join(", "));
  const lines = [
    `decision contract probe: ${report.route} (${report.provider}, pinned to ${report.modelPin})`,
    `calls: ${report.dispatched} of ${report.planned} planned` +
      (report.stopped === null ? "" : `; stopped early (${report.stopped})`),
    `endpoint: ${report.endpoint}`,
    `answering models: ${listed(findings.servedModels, "none recorded")}`,
    `usage reported on answers: ${shown(findings.usageOnAnswers)}`,
    `request id on answers: ${shown(findings.requestIdOnAnswers)}; on failures: ${shown(findings.requestIdOnFailures)}`,
    `rate-limit headers: ${listed(findings.rateLimitHeaderNames, "none seen")}`,
    `largest distance of a distribution's sum from one: ${shown(findings.largestSumDeviation)}`,
  ];
  for (const shape of PROBE_ANSWERABLE_SHAPES) {
    const summary = report.shapes[shape];
    const latency = summary.latencyMs;
    lines.push(
      `${shape}: ${summary.answered} of ${summary.dispatched} answered by the pin and decoded; ` +
        `latency ms over n=${latency.n}: min ${shown(latency.min)}, p50 ${shown(latency.p50)}, ` +
        `p90 ${shown(latency.p90)}, p95 ${shown(latency.p95)}, p99 ${shown(latency.p99)}, max ${shown(latency.max)}; ` +
        `${summary.overRouteBudget} over the route's ${report.routeBudgetMs} ms budget; ` +
        `input tokens ${listed(summary.inputTokens.map(String), "not reported")}; ` +
        `different answers ${shown(summary.distinctAnswers)}`,
    );
  }
  for (const sample of report.samples) {
    if (sample.shape !== PROBE_REFUSAL_SHAPE && sample.probabilitySums !== null) {
      for (const [question, sum] of Object.entries(sample.probabilitySums)) {
        if (sum !== null) {
          lines.push(`call ${sample.sequence} (${sample.shape}): probabilities of ${question} sum to ${sum}`);
        }
      }
    }
    if (sample.fault !== null && sample.outcome === "fault") {
      lines.push(
        `call ${sample.sequence} (${sample.shape}): ${sample.fault}` +
          (sample.faultSource === null ? "" : ` (${sample.faultSource})`) +
          (sample.status === null ? "" : `, HTTP ${sample.status}`) +
          (sample.faultFieldPath === null ? "" : `, at ${sample.faultFieldPath}`) +
          (sample.faultFieldPathWithheld ? " and a name the vendor wrote" : ""),
      );
    }
  }
  if (findings.refusal === null) {
    lines.push("request with no instructions: not sent");
  } else {
    lines.push(
      `request with no instructions: ${findings.refusal.outcome}, HTTP ${shown(findings.refusal.status)}, ` +
        `body shape ${shown(findings.refusal.bodyShape)}`,
    );
  }
  lines.push(
    report.evidence === null
      ? `evidence: none about the vendor (${shown(report.evidenceWithheld)})`
      : `evidence: ${report.evidence}, ${report.observedOn}`,
  );
  lines.push(
    report.verdict === "confirmed"
      ? "verdict: confirmed"
      : `verdict: not confirmed (${listed(report.verdictReasons, "no answerable call was answered")})`,
  );
  return lines;
}

/**
 * The name of the file a report is written to.
 *
 * @param report The report.
 * @returns A name made of the route and the instant the run began, which sorts
 *   by time and holds only characters safe in a file name.
 */
export function probeReportFileName(report: ProbeReport): string {
  const stamp = report.startedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `decision-probe.${report.route}.${stamp}.json`;
}
