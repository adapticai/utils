/**
 * One run of the decision contract probe.
 *
 * A run resolves the route, makes the calls of its plan through the hosted
 * transport, and reports what came back. It is the onboarding call: it is made
 * before the route table says the provider account is live or the contract
 * confirmed, because it is the act that establishes both. So it resolves the
 * route against the table as onboarding will leave it, with those two facts
 * set and nothing else changed, and every other rule of resolution still
 * applies: a model id that is not confirmed, a route the consumer serves
 * itself and a base URL that cannot be used are refused here as anywhere.
 *
 * The calls are made one at a time, and never closer together than a fixed
 * spacing that keeps a run far under the vendor's published ceiling whatever
 * the limits config says, so a run cannot be a burst however quickly the
 * vendor answers. A run is a guest on an account that is being opened: when
 * the vendor says to wait, it waits at least that long, and when the vendor
 * says twice that it is being called too often, or that it is full, the run
 * stops and says so. Each call is abandoned after the longest
 * budget any route may declare and not after this route's own: the route's
 * budget is one of the numbers a run exists to re-derive, and a run that cut
 * calls off at it could never see how far past it the vendor's tail reaches.
 *
 * The transport is called directly and not through the admitting client. The
 * client refuses a route that is not admitted, and this is the call that has
 * to be made before a route can be. Everything the client would decide about
 * an answer is decided here by the same rules: the answering model is compared
 * with the pin in full and before the body is trusted, and the body is
 * decoded by the production codec against the request that drew it.
 *
 * @module scripts/decision-probe/probe-run
 */

import limitsConfig from "../../src/llm/provider-limits.json";
import { decodeDecisionResponse } from "../../src/llm/decision/codec";
import {
  DECISION_BUDGET_CEILING_MS,
  decisionRouteDeclaration,
  decisionRouteTable,
  resolveDecisionRoute,
} from "../../src/llm/decision/decision-route-table";
import {
  DecisionCallError,
  DecisionCredentialError,
  DecisionRequestInvalidError,
  DecisionResponseFormatError,
  DecisionRouteUnavailableError,
  DecisionTransportError,
} from "../../src/llm/decision/errors";
import type { DecisionFault } from "../../src/llm/decision/errors";
import type { DecisionRouteTable, ResolvedDecisionRoute } from "../../src/llm/decision/route-types";
import { createSystemOneTransport, decisionFaultForStatus } from "../../src/llm/decision/transports/systemone";
import type {
  SystemOneFetch,
  SystemOneFetchInit,
  SystemOneFetchResponse,
  SystemOneTransportResult,
} from "../../src/llm/decision/transports/systemone";
import type {
  DecisionJsonObject,
  DecisionRequest,
  DecisionRoute,
  DecisionWireRequest,
} from "../../src/llm/decision/types";
import { buildProbePlan, recordObservation } from "./probe-plan";
import type { ProbeObservation, ProbeRequest, ProbeResponseHeaders } from "./probe-plan";
import { assembleProbeReport, utcDateOf } from "./probe-report";
import type { ProbeDispatchResult, ProbeEndpoint, ProbeReport, ProbeSample, ProbeStop } from "./probe-report";

/** Milliseconds in one minute, the unit a limits entry states its rate over. */
const MS_PER_MINUTE = 60_000;

/** Milliseconds in one second, the unit the vendor publishes its request ceiling over. */
const MS_PER_SECOND = 1_000;

/**
 * The most requests a second the hosted decision vendor publishes that an
 * account may send. A request over it is answered 429.
 */
const PUBLISHED_REQUESTS_PER_SECOND = 40;

/** The share of the published ceiling a run may reach at most: one part in this many. */
const PUBLISHED_CEILING_DIVISOR = 4;

/**
 * The least time a run ever leaves between two dispatches: 100 ms.
 *
 * A run sends one request at a time and starts no request sooner than this
 * after it started the last one, so it sends at most ten in any second, a
 * quarter of the forty the vendor publishes as its ceiling. The bound holds by
 * construction: it is a constant of the probe and the larger of it and the
 * limits config's own interval is used, so no edit to the limits config, and
 * no vendor however quick to answer, can bring a run closer to the ceiling
 * than this. A quarter, and not the whole, because the ceiling belongs to the
 * account and the account may be carrying other traffic, and because the
 * publisher says the ceiling can move without notice.
 */
export const PROBE_MIN_DISPATCH_SPACING_MS = (MS_PER_SECOND * PUBLISHED_CEILING_DIVISOR) / PUBLISHED_REQUESTS_PER_SECOND;

/** The status with which a vendor says it is being called too often. */
const TOO_MANY_REQUESTS_STATUS = 429;

/**
 * How many times a vendor may say it is being called too often, or that it is
 * full, before the run stops.
 *
 * The first such answer is the observation the contract needs: its status, the
 * shape of its body and the names of its headers. The run then waits as long
 * as it was asked to and tries the next call. A second one, after that wait,
 * says the vendor is still refusing, and every further call would be sent into
 * a limiter that has already answered twice.
 */
export const PROBE_CAPACITY_REFUSALS_BEFORE_STOP = 2;

/**
 * The longest a run waits because a vendor asked it to: one minute.
 *
 * A run never calls sooner than it was asked to. Asked to wait longer than
 * this, it stops instead of waiting: an operator is at the terminal, and a run
 * told to come back in an hour has been told to stop.
 */
export const PROBE_LONGEST_HONOURED_WAIT_MS = 60_000;

/** How many decimal places of a millisecond a timing is written to. */
const TIMING_DECIMALS = 3;

/** The status with which a vendor rejects a request as invalid. */
const REQUEST_INVALID_STATUS = 422;

/**
 * The form a model id must have to be written down.
 *
 * The id a vendor reports is the vendor's text. One made of letters, digits
 * and the marks model ids are written with, and of ordinary length, is an id;
 * anything else is recorded as present and not written.
 */
const PLAIN_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * The names a field path can be made of without quoting a vendor.
 *
 * The fields the contract defines for a response. A path is also made of the
 * request's own question ids, options and level indexes, which are added per
 * request.
 */
const CONTRACT_FIELD_NAMES: readonly string[] = [
  "$",
  "model",
  "answers",
  "usage",
  "type",
  "noul",
  "choice",
  "probabilities",
  "confidence",
  "score",
  "legend",
];

/** An index into an array, as a field path writes one after a name. */
const PATH_INDEXES = /(?:\[\d+\])+$/;

/** The part of a response the probe reads: what the transport reads, and every header's name. */
export interface ProbeFetchResponse extends SystemOneFetchResponse {
  readonly headers: SystemOneFetchResponse["headers"] & ProbeResponseHeaders;
}

/**
 * The HTTP call a run makes.
 *
 * The transport's own, with a response whose headers can be listed. The
 * platform's `fetch` satisfies it.
 */
export type ProbeFetch = (url: string, init: SystemOneFetchInit) => Promise<ProbeFetchResponse>;

/** The time a run reads and the waiting it does, each replaceable so a test waits on nothing. */
export interface ProbeClock {
  /**
   * @returns Milliseconds on a clock that only moves forward, for timing a call.
   */
  monotonicMs(): number;
  /**
   * @returns Milliseconds since the epoch, for dating the run.
   */
  epochMs(): number;
  /**
   * @param ms How long to wait before the next dispatch.
   * @returns A promise settled once that long has passed.
   */
  wait(ms: number): Promise<void>;
}

/** How a run is made. */
export interface ProbeRunConfig {
  readonly route: DecisionRoute;
  /** How many times each answerable shape is asked. */
  readonly samples: number;
  /** Whether the request a vendor is expected to refuse is sent. */
  readonly includeRefusal: boolean;
  readonly fetchImpl: ProbeFetch;
  readonly clock: ProbeClock;
  /** The route table to read; the canonical one unless a test supplies another. */
  readonly table?: DecisionRouteTable;
  /** How long one call may take before it is abandoned; the longest budget a route may declare unless given. */
  readonly requestTimeoutMs?: number;
}

/** A route resolved for a run, and where its calls will go. */
export interface ProbeTarget {
  readonly resolved: ResolvedDecisionRoute;
  readonly endpoint: ProbeEndpoint;
}

/** Thrown when a run is refused before any call is made. */
export class ProbeRefusal extends Error {
  /**
   * @param message Why the run is refused, in words an operator can act on.
   */
  public constructor(message: string) {
    super(message);
    this.name = "ProbeRefusal";
  }
}

/**
 * Whether a value is a plain object whose members can be read.
 *
 * @param value The value to test.
 * @returns True when it is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a field an object holds itself.
 *
 * @param holder The object.
 * @param key The field's name.
 * @returns The field, or `undefined` when the object does not itself hold it.
 */
function ownField(holder: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(holder, key) ? holder[key] : undefined;
}

/**
 * Round a timing to the precision it is written at.
 *
 * @param ms A duration in milliseconds.
 * @returns The duration, to a thousandth of a millisecond.
 */
function roundedMs(ms: number): number {
  const scale = 10 ** TIMING_DECIMALS;
  return Math.round(ms * scale) / scale;
}

/**
 * The table as onboarding will leave it for one route.
 *
 * The two facts a run exists to establish are set: the provider account is
 * live, and the contract was confirmed by an authenticated call on the day of
 * the run. Nothing else is changed, so every other reason a route can be
 * refused for still refuses it. A route the consumer serves is returned
 * untouched, and is then refused for that reason.
 *
 * @param table The table to start from.
 * @param route The route being probed.
 * @param observedOn The date of the run.
 * @returns A table in which the route is refused only for a reason a run cannot settle.
 */
function asOnboarded(table: DecisionRouteTable, route: DecisionRoute, observedOn: string): DecisionRouteTable {
  const declaration = decisionRouteDeclaration(route, table);
  const provider = Object.hasOwn(table.providers, declaration.provider)
    ? table.providers[declaration.provider]
    : undefined;
  if (declaration.served_by !== "utils" || provider === undefined) {
    return table;
  }
  return {
    ...table,
    providers: { ...table.providers, [declaration.provider]: { ...provider, account_status: "live" } },
    routes: {
      ...table.routes,
      [route]: { ...declaration, contract_evidence: "authenticated-call", contract_verified: observedOn },
    },
  };
}

/**
 * Resolve a route for a run, and say where its calls will go.
 *
 * The calls go to the declared endpoint when the base URL they resolve to is
 * the one the table declares. Whatever else the environment points them at is
 * an override, and a run against an override is not evidence about the vendor.
 *
 * @param route The route to probe.
 * @param observedOn The date of the run.
 * @param table The table to read; the canonical one unless a test supplies another.
 * @returns The resolved route and where its calls go.
 * @throws {DecisionRouteUnavailableError} When the route cannot be probed: the
 *   consumer serves it, its model id is unconfirmed, or no base URL resolves.
 */
export function resolveProbeTarget(
  route: DecisionRoute,
  observedOn: string,
  table: DecisionRouteTable = decisionRouteTable,
): ProbeTarget {
  const onboarded = asOnboarded(table, route, observedOn);
  const resolved = resolveDecisionRoute(route, onboarded);
  let declaredBaseUrl: string | null;
  try {
    declaredBaseUrl = resolveDecisionRoute(route, onboarded, {}).baseUrl;
  } catch (error) {
    if (!(error instanceof DecisionRouteUnavailableError)) {
      throw error;
    }
    declaredBaseUrl = null;
  }
  return { resolved, endpoint: resolved.baseUrl === declaredBaseUrl ? "declared" : "environment_override" };
}

/**
 * A limits entry's refill rate, when it states a usable one.
 *
 * @param entry A provider's limits entry, a model's override, or the defaults.
 * @returns Requests per minute, or `null` when the entry states no positive finite rate.
 */
function requestsPerMinuteOf(entry: unknown): number | null {
  if (!isRecord(entry)) {
    return null;
  }
  const rate = entry.requests_per_minute;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * The spacing a run keeps, given the interval the limits config asks for.
 *
 * @param configuredIntervalMs The refill interval the limits config declares.
 * @returns That interval, or {@link PROBE_MIN_DISPATCH_SPACING_MS} when the config asks for less.
 */
export function probeDispatchSpacingMs(configuredIntervalMs: number): number {
  return Math.max(PROBE_MIN_DISPATCH_SPACING_MS, configuredIntervalMs);
}

/**
 * The least time a run leaves between two dispatches.
 *
 * It is the refill interval the limits config declares for the provider: the
 * rate this package has decided to hold that provider to. A run therefore
 * never calls faster than a production caller is allowed to on average. The
 * same order as the rate guard reads it in: a model's own override where the
 * provider is limited per model, then the provider's entry, then the defaults.
 * The interval is never shorter than the probe's own floor, whatever the
 * config says: see {@link PROBE_MIN_DISPATCH_SPACING_MS}.
 *
 * @param provider The provider the route names.
 * @param modelPin The model the route pins.
 * @returns The interval in milliseconds.
 * @throws {ProbeRefusal} When the limits config states no usable rate at all.
 */
export function probeDispatchIntervalMs(provider: string, modelPin: string): number {
  const providers: Readonly<Record<string, unknown>> = limitsConfig.providers;
  const entry = ownField(providers, provider);
  const override =
    isRecord(entry) && entry.scope === "model" && isRecord(entry.models) ? ownField(entry.models, modelPin) : undefined;
  const rate =
    requestsPerMinuteOf(override) ?? requestsPerMinuteOf(entry) ?? requestsPerMinuteOf(limitsConfig.defaults);
  if (rate === null) {
    throw new ProbeRefusal(
      `the limits config states no request rate for provider ${provider} and none by default, ` +
        "so there is no rate to hold a run to",
    );
  }
  return probeDispatchSpacingMs(MS_PER_MINUTE / rate);
}

/** What one call's response was, as seen where it arrived. */
interface ObservedArrival {
  readonly observation: ProbeObservation;
  readonly headersMs: number;
  /** `null` when the body could not be read. */
  readonly bodyMs: number | null;
}

/**
 * Where the observing call leaves what it saw, for the dispatch that made it.
 *
 * One slot serves a whole run, because a run has one call in flight at a time:
 * a dispatch empties it, and reads it once its own call has settled.
 */
interface ArrivalSlot {
  arrival: ObservedArrival | null;
}

/**
 * Wrap the HTTP call so that every response is observed where it arrives.
 *
 * The transport hands back an answer or an error, and neither holds the
 * response's headers or says when they arrived. So the response is observed
 * here, on its way to the transport, and then handed on with its body already
 * read. Only the response is passed to the observation; the request, which
 * holds the key, is passed straight through and is never read.
 *
 * @param send The HTTP call to wrap.
 * @param clock The clock calls are timed on.
 * @param slot Where the observation of the response is left.
 * @returns The HTTP call the transport is built over.
 */
function observing(send: ProbeFetch, clock: ProbeClock, slot: ArrivalSlot): SystemOneFetch {
  return async (url, init) => {
    const sentAt = clock.monotonicMs();
    const response = await send(url, init);
    const headersMs = roundedMs(clock.monotonicMs() - sentAt);
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      slot.arrival = {
        observation: recordObservation({ status: response.status, headers: response.headers, body: null }),
        headersMs,
        bodyMs: null,
      };
      return { status: response.status, headers: response.headers, text: () => Promise.reject(error) };
    }
    slot.arrival = {
      observation: recordObservation({ status: response.status, headers: response.headers, body }),
      headersMs,
      bodyMs: roundedMs(clock.monotonicMs() - sentAt),
    };
    return { status: response.status, headers: response.headers, text: () => Promise.resolve(body) };
  };
}

/**
 * Hand the transport a body the wire type does not admit.
 *
 * The transport sends a body exactly as it is given, and the wire type exists
 * so that production code cannot give it an invalid one. The refused request
 * is invalid on purpose, to see how the vendor says so. This is the one place
 * a body is passed without satisfying the type, it is reachable only for the
 * plan's refused request, and what it sends is fixed text of this package.
 *
 * @param body The refused request's body.
 * @returns The same body, typed as the transport's parameter requires.
 */
function asSentUnvalidated(body: DecisionJsonObject): DecisionWireRequest {
  return body as unknown as DecisionWireRequest;
}

/**
 * The model id a response reported, when it can be written down.
 *
 * @param servedModel The id as reported, in full.
 * @returns The id, or `null` when it does not have the form of one.
 */
function writableModelId(servedModel: string): string | null {
  return PLAIN_MODEL_ID.test(servedModel) ? servedModel : null;
}

/**
 * The names a request's own field paths are written in.
 *
 * @param request The request an answer is decoded against.
 * @returns The contract's field names, and the request's question ids, options and level indexes.
 */
function ownNamesOf(request: DecisionRequest): ReadonlySet<string> {
  const names = new Set(CONTRACT_FIELD_NAMES);
  for (const [id, question] of Object.entries(request.questions)) {
    names.add(id);
    if (question.type === "choice") {
      Object.keys(question.criteria).forEach((option) => names.add(option));
    } else if (question.type === "score") {
      question.criteria.forEach((_level, index) => names.add(String(index)));
    }
  }
  return names;
}

/**
 * The part of a field path that is written in the request's own names.
 *
 * A path that names where an answer failed validation can end in a key the
 * vendor wrote, such as an option the request never offered. The path is kept
 * up to the first name that is not the request's or the contract's, so the
 * report says where the answer broke without repeating the vendor.
 *
 * @param fieldPath The path the codec or the transport reported.
 * @param ownNames The names the request and the contract define.
 * @returns The leading part of the path in those names, and whether anything was left out.
 */
function ownWordsOf(fieldPath: string, ownNames: ReadonlySet<string>): { path: string; withheld: boolean } {
  const kept: string[] = [];
  for (const segment of fieldPath.split(".")) {
    if (!ownNames.has(segment.replace(PATH_INDEXES, ""))) {
      return { path: kept.join("."), withheld: true };
    }
    kept.push(segment);
  }
  return { path: kept.join("."), withheld: false };
}

/** What a dispatch knows about a call before its outcome is known. */
interface DispatchContext {
  readonly sequence: number;
  readonly planned: ProbeRequest;
  readonly expectedServedModel: string;
  readonly arrival: ObservedArrival | null;
  readonly settledMs: number;
}

/** The fields of a sample that depend on how the call ended. */
type SampleOutcomeFields = Omit<
  ProbeSample,
  "sequence" | "shape" | "status" | "headersMs" | "bodyMs" | "settledMs" | "observation"
>;

/**
 * Build a call's sample from how it ended.
 *
 * The status, the timings and the observation are the ones taken where the
 * response arrived, and are `null` when none did. A status has no other
 * source: one is only ever read from a response.
 *
 * @param context The call, and what was observed of its response.
 * @param fields How it ended.
 * @returns The sample.
 */
function sampleOf(context: DispatchContext, fields: SampleOutcomeFields): ProbeSample {
  const { arrival } = context;
  return {
    sequence: context.sequence,
    shape: context.planned.shape,
    outcome: fields.outcome,
    fault: fields.fault,
    faultSource: fields.faultSource,
    faultFieldPath: fields.faultFieldPath,
    faultFieldPathWithheld: fields.faultFieldPathWithheld,
    status: arrival === null ? null : arrival.observation.status,
    headersMs: arrival === null ? null : arrival.headersMs,
    bodyMs: arrival === null ? null : arrival.bodyMs,
    settledMs: context.settledMs,
    observation: arrival === null ? null : arrival.observation,
    servedModel: fields.servedModel,
    servedModelWithheld: fields.servedModelWithheld,
    servedModelMatchesPin: fields.servedModelMatchesPin,
    inputTokens: fields.inputTokens,
    outputTokens: fields.outputTokens,
    cost: fields.cost,
    probabilitySums: fields.probabilitySums,
  };
}

/** The fields of a sample that an answer fills and a fault leaves empty. */
const NOTHING_ANSWERED = {
  servedModel: null,
  servedModelWithheld: false,
  servedModelMatchesPin: null,
  inputTokens: null,
  outputTokens: null,
  cost: null,
  probabilitySums: null,
} as const;

/** The fields of a sample that a fault fills and an answer leaves empty. */
const NO_FAULT = { fault: null, faultSource: null, faultFieldPath: null, faultFieldPathWithheld: false } as const;

/**
 * The closed-list source an error states for its fault.
 *
 * @param error The error a call ended in.
 * @returns The source, or `null` for an error that states none.
 */
function faultSourceOf(error: DecisionCallError): string | null {
  if (
    error instanceof DecisionCredentialError ||
    error instanceof DecisionRequestInvalidError ||
    error instanceof DecisionTransportError
  ) {
    return error.source;
  }
  return null;
}

/**
 * The sample of a call the transport answered.
 *
 * The answering model is compared with the route's pin first, on the whole id.
 * A different model is a fault whatever the body holds, so the body of a
 * mismatched answer is never decoded. Only then is the body decoded, against
 * the request that drew it and by the production codec.
 *
 * @param context The call.
 * @param result What the transport returned.
 * @returns The sample, and the decoded answers in canonical form when there are any.
 */
function answeredResult(context: DispatchContext, result: SystemOneTransportResult): ProbeDispatchResult {
  const { planned } = context;
  const servedModel = writableModelId(result.servedModel);
  const reported = {
    servedModel,
    servedModelWithheld: servedModel === null,
    servedModelMatchesPin: result.servedModel === context.expectedServedModel,
    inputTokens: result.usage.prompt_tokens,
    outputTokens: result.usage.completion_tokens,
    cost: result.usage.cost,
  };
  if (!reported.servedModelMatchesPin) {
    return {
      sample: sampleOf(context, {
        ...reported,
        outcome: "fault",
        fault: "route_mismatch",
        faultSource: null,
        faultFieldPath: null,
        faultFieldPathWithheld: false,
        probabilitySums: null,
      }),
      answerKey: null,
      retryAfterMs: null,
    };
  }
  if (planned.expect === "refusal") {
    return {
      sample: sampleOf(context, { ...reported, ...NO_FAULT, outcome: "answered", probabilitySums: null }),
      answerKey: null,
      retryAfterMs: null,
    };
  }
  try {
    const decoded = decodeDecisionResponse(result.payload, planned.request, { billedUsage: result.usage });
    return {
      sample: sampleOf(context, {
        ...reported,
        ...NO_FAULT,
        outcome: "answered",
        probabilitySums: decoded.probabilitySums,
      }),
      answerKey: JSON.stringify(decoded.answers),
      retryAfterMs: null,
    };
  } catch (error) {
    if (!(error instanceof DecisionResponseFormatError)) {
      throw error;
    }
    const where = ownWordsOf(error.fieldPath, ownNamesOf(planned.request));
    return {
      sample: sampleOf(context, {
        ...reported,
        outcome: "fault",
        fault: error.fault,
        faultSource: null,
        faultFieldPath: where.path,
        faultFieldPathWithheld: where.withheld,
        probabilitySums: null,
      }),
      answerKey: null,
      retryAfterMs: null,
    };
  }
}

/**
 * The sample of a call the transport raised an error for.
 *
 * The refused request ending in the vendor's rejection is the outcome it was
 * sent for, and is recorded as a refusal. Every other error is a fault.
 *
 * @param context The call.
 * @param error The error the transport raised.
 * @returns The sample.
 */
function faultedResult(context: DispatchContext, error: DecisionCallError): ProbeDispatchResult {
  const refusedAsExpected =
    context.planned.expect === "refusal" &&
    error instanceof DecisionRequestInvalidError &&
    error.source === "vendor_rejected" &&
    error.status === REQUEST_INVALID_STATUS;
  const where =
    error instanceof DecisionResponseFormatError
      ? ownWordsOf(error.fieldPath, new Set(CONTRACT_FIELD_NAMES))
      : null;
  return {
    sample: sampleOf(context, {
      ...NOTHING_ANSWERED,
      outcome: refusedAsExpected ? "refused" : "fault",
      fault: error.fault,
      faultSource: faultSourceOf(error),
      faultFieldPath: where === null ? null : where.path,
      faultFieldPathWithheld: where === null ? false : where.withheld,
      inputTokens: error.usage === null ? null : error.usage.prompt_tokens,
      outputTokens: error.usage === null ? null : error.usage.completion_tokens,
      cost: error.usage === null ? null : error.usage.cost,
    }),
    answerKey: null,
    retryAfterMs: error.retryAfterMs,
  };
}

/**
 * The sample of a call the probe abandoned.
 *
 * @param context The call.
 * @returns The sample: a timeout, with whatever was observed before it.
 */
function abandonedResult(context: DispatchContext): ProbeDispatchResult {
  const fault: DecisionFault = "timeout";
  return {
    sample: sampleOf(context, {
      ...NOTHING_ANSWERED,
      outcome: "fault",
      fault,
      faultSource: "probe_deadline",
      faultFieldPath: null,
      faultFieldPathWithheld: false,
    }),
    answerKey: null,
    retryAfterMs: null,
  };
}

/**
 * What a call says about whether the vendor is refusing the run.
 *
 * @param sample The call.
 * @returns `rate_limited` when the vendor answered that it is being called too
 *   often, `vendor_unavailable` when it answered with another status that says
 *   it is full or not serving, and `null` for every other outcome.
 */
function capacityRefusalOf(sample: ProbeSample): Exclude<ProbeStop, "credential"> | null {
  if (sample.fault !== "transport" || sample.status === null) {
    return null;
  }
  if (decisionFaultForStatus(sample.status)?.breakerKind !== "capacity") {
    return null;
  }
  return sample.status === TOO_MANY_REQUESTS_STATUS ? "rate_limited" : "vendor_unavailable";
}

/**
 * Make one run.
 *
 * @param config The route, the size of the plan, and the HTTP call and clock to use.
 * @returns The report of the run.
 * @throws {DecisionRouteUnavailableError} When the route cannot be probed.
 * @throws {ProbeRefusal} When the limits config states no rate to hold the run to.
 * @throws {ProbePlanError} When the plan asked for is one the probe will not send.
 * @throws Whatever a call raised that is neither one of the decision errors
 *   nor the probe's own deadline. The transport raises nothing else, so this
 *   is a defect, and it is not recorded as an outcome of the vendor's.
 */
export async function runDecisionProbe(config: ProbeRunConfig): Promise<ProbeReport> {
  const { clock } = config;
  const startedAtMs = clock.epochMs();
  const { resolved, endpoint } = resolveProbeTarget(config.route, utcDateOf(startedAtMs), config.table);
  const plan = buildProbePlan(resolved, { samples: config.samples, includeRefusal: config.includeRefusal });
  const minDispatchIntervalMs = probeDispatchIntervalMs(resolved.providerName, resolved.modelPin);
  const requestTimeoutMs = config.requestTimeoutMs ?? DECISION_BUDGET_CEILING_MS;

  const slot: ArrivalSlot = { arrival: null };
  const transport = createSystemOneTransport({
    fetchImpl: observing(config.fetchImpl, clock, slot),
    now: () => clock.epochMs(),
  });

  const results: ProbeDispatchResult[] = [];
  let stopped: ProbeStop | null = null;
  let retryHints = 0;
  const refusals: Record<Exclude<ProbeStop, "credential">, number> = { rate_limited: 0, vendor_unavailable: 0 };
  // The earliest instant the next request may be started at, on the clock that
  // only moves forward: the spacing after the last dispatch, or the end of a
  // wait the vendor asked for, whichever is later.
  let nextDispatchNotBefore: number | null = null;
  for (const [sequence, planned] of plan.dispatches.entries()) {
    if (nextDispatchNotBefore !== null) {
      const untilAllowed = nextDispatchNotBefore - clock.monotonicMs();
      if (untilAllowed > 0) {
        await clock.wait(untilAllowed);
      }
    }
    const dispatchedAt = clock.monotonicMs();
    nextDispatchNotBefore = dispatchedAt + minDispatchIntervalMs;
    slot.arrival = null;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), requestTimeoutMs);
    const contextNow = (): DispatchContext => ({
      sequence,
      planned,
      expectedServedModel: resolved.expectedServedModel,
      arrival: slot.arrival,
      settledMs: roundedMs(clock.monotonicMs() - dispatchedAt),
    });
    let result: ProbeDispatchResult;
    try {
      const answer = await transport.execute({
        route: resolved,
        body: planned.expect === "answer" ? planned.body : asSentUnvalidated(planned.body),
        signal: deadline.signal,
      });
      result = answeredResult(contextNow(), answer);
    } catch (error) {
      if (error instanceof DecisionCallError) {
        result = faultedResult(contextNow(), error);
      } else if (deadline.signal.aborted) {
        result = abandonedResult(contextNow());
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
    const settledAt = clock.monotonicMs();
    results.push(result);
    if (result.sample.fault === "credential") {
      // A key the vendor refuses is refused on every call, and a key that is
      // not there is not there for the next one: the rest of the plan would
      // spend calls to learn nothing.
      stopped = "credential";
      break;
    }
    const refusal = capacityRefusalOf(result.sample);
    if (refusal !== null) {
      refusals[refusal] += 1;
      if (refusals[refusal] >= PROBE_CAPACITY_REFUSALS_BEFORE_STOP) {
        stopped = refusal;
        break;
      }
    }
    if (result.retryAfterMs !== null) {
      retryHints += 1;
      if (result.retryAfterMs > PROBE_LONGEST_HONOURED_WAIT_MS) {
        // Asked to stay away for longer than a run will wait. The run does not
        // call sooner than it was asked to, so it ends here.
        stopped = refusal ?? "vendor_unavailable";
        break;
      }
      // The wait is counted from the instant the call settled, which is never
      // earlier than the instant its response arrived and never earlier than
      // the instant the hint was read against the clock. So the next request
      // starts no sooner than the vendor asked, whether it gave a delay or a
      // time of day, and however long the refused call itself had taken.
      nextDispatchNotBefore = Math.max(nextDispatchNotBefore, settledAt + result.retryAfterMs);
    }
  }

  return assembleProbeReport(
    {
      route: resolved.route,
      provider: resolved.providerName,
      modelPin: resolved.modelPin,
      expectedServedModel: resolved.expectedServedModel,
      endpoint,
      routeBudgetMs: resolved.budgetMs,
      requestTimeoutMs,
      minDispatchIntervalMs,
      samplesPerShape: plan.samples,
      planned: plan.dispatches.length,
      plannedAnswerable: plan.dispatches.filter((dispatch) => dispatch.expect === "answer").length,
      startedAtMs,
      finishedAtMs: clock.epochMs(),
      stopped,
      retryHints,
    },
    results,
  );
}
