/**
 * The hosted typed-decision transport: one request, one outcome.
 *
 * It sends an already encoded request to a resolved route and reports what
 * came back, and it does nothing else. It makes exactly one attempt. It never
 * retries, never waits on a vendor's retry hint, and never tries another
 * route: a decision call runs inside a deadline measured in fractions of a
 * second, and a second attempt made here would spend the time the caller's
 * next step needs while hiding from the caller that the first one failed. The
 * walk across routes belongs to whoever called.
 *
 * A failing status is classified by the status alone. The bodies a vendor
 * sends with its failures are for the most part documented by name only, so a
 * classifier that read them would be acting on a shape nobody has seen. The
 * body is carried on the error as a bounded excerpt for a reader, and the one
 * field read out of it is read only when the body has exactly the one shape
 * that has been observed.
 *
 * A successful body is returned undecoded. This layer reads only what it needs
 * to account for the call, in this order: what the vendor billed, then which
 * model the vendor says answered. Usage comes first because the vendor charged
 * for the answer whether or not it turns out to be usable, and a rejection
 * that dropped the count would report the calls that went wrong as free. The
 * answering model is returned exactly as reported, never replaced by the model
 * the request named, because checking one against the other is how a silent
 * substitution is caught.
 *
 * The key is read from the environment by NAME on every call and exists only
 * in the request's authorization header. It is never stored, and three rules
 * keep it out of everything raised here. A failure below this layer is
 * described by its class and system code, never by its message, because a
 * runtime that refuses a request it could not build quotes the offending
 * header in that message. Once the caller has aborted, what is raised is the
 * reason the caller aborted with and never what the layer below threw, because
 * a call can fail for a reason of its own at the moment it is aborted. And
 * text a vendor answered with, or a lower layer named its failure with, has
 * the key taken out wherever it stands verbatim before that text is put on an
 * error, because a vendor may quote back the credential it was sent. A key
 * handed back altered, masked or encoded for instance, is not recognised.
 *
 * Nothing in this file names a vendor host or a model. Both arrive with the
 * route.
 *
 * @module llm/decision/transports/systemone
 */

import type { BreakerFailureKind } from "../../circuit-breaker";
import type { LlmUsageRecord } from "../../types";
import {
  DecisionCredentialError,
  DecisionRequestInvalidError,
  DecisionResponseFormatError,
  DecisionTransportError,
  decisionErrorExcerpt,
} from "../errors";
import type { DecisionCallError } from "../errors";
import { decisionUsageOf, parseRetryAfterMs } from "../metering";
import type { ResolvedDecisionRoute } from "../route-types";
import type { DecisionRoute, DecisionWireRequest } from "../types";

/** Path of the typed-decision endpoint under a route's base URL. */
export const SYSTEMONE_PATH = "/v1/systemone";

/** Response header in which the vendor reports its own id for the request. */
export const VENDOR_REQUEST_ID_HEADER = "x-typesafe-request-id";

/** Media type of the request body, and the one asked for in return. */
const JSON_MEDIA_TYPE = "application/json";

/** First status of the range that is an answer. */
const SUCCESS_STATUS_FIRST = 200;

/** First status past the range that is an answer. */
const SUCCESS_STATUS_END = 300;

/** First status of the range in which the vendor itself failed. */
const SERVER_ERROR_STATUS_FIRST = 500;

/** First status past the range in which the vendor itself failed. */
const SERVER_ERROR_STATUS_END = 600;

/** Statuses with which a vendor rejects the key: one documented, one observed for a missing key. */
const CREDENTIAL_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/** The status with which a vendor rejects the request body as invalid. */
const REQUEST_INVALID_STATUS = 422;

/**
 * Statuses with which a vendor says it is full rather than broken: request
 * timeout, too many requests, service unavailable and overloaded.
 */
const CAPACITY_STATUSES: ReadonlySet<number> = new Set([408, 429, 503, 529]);

/** How many links of a failure's chain of causes are described. */
const FAILURE_CAUSE_DEPTH = 4;

/** What stands where the key was, in text this layer did not write. */
const KEY_REMOVED = "[credential removed]";

/**
 * What a failure's class name or system code looks like.
 *
 * Anything else found in those fields is not printed, so a description is made
 * only of identifiers a runtime assigns.
 */
const FAILURE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** What a status says about a call, when the status is not an answer. */
export type DecisionStatusFault =
  | {
      /** The vendor rejected the key. Says nothing about the vendor's health. */
      readonly fault: "credential";
      readonly retryable: false;
      readonly breakerKind: null;
    }
  | {
      /** The vendor rejected the request as invalid. Says nothing about the vendor's health. */
      readonly fault: "schema";
      readonly retryable: false;
      readonly breakerKind: null;
    }
  | {
      /** The vendor could not serve the call. */
      readonly fault: "transport";
      /** Whether the same request could plausibly succeed later. */
      readonly retryable: boolean;
      /** Whether a breaker counts this as the vendor being full, or as the vendor failing. */
      readonly breakerKind: BreakerFailureKind;
    };

/** The vendor rejected the key. */
const CREDENTIAL_FAULT: DecisionStatusFault = { fault: "credential", retryable: false, breakerKind: null };

/** The vendor rejected the request. */
const REQUEST_INVALID_FAULT: DecisionStatusFault = { fault: "schema", retryable: false, breakerKind: null };

/** The vendor is full. */
const CAPACITY_FAULT: DecisionStatusFault = { fault: "transport", retryable: true, breakerKind: "capacity" };

/** The vendor failed. */
const SERVER_FAULT: DecisionStatusFault = { fault: "transport", retryable: true, breakerKind: "hard" };

/** A status this contract gives no meaning to. */
const UNEXPECTED_STATUS_FAULT: DecisionStatusFault = { fault: "transport", retryable: false, breakerKind: "hard" };

/**
 * Classify an HTTP status.
 *
 * The status is the whole input: no body and no header changes the result.
 * Only a status in the success range is an answer. Every other number,
 * including one this contract gives no meaning to, is a fault, so an
 * unforeseen status can never be read as a decision.
 *
 * @param status The HTTP status received.
 * @returns What the status means, or `null` when it is an answer.
 */
export function decisionFaultForStatus(status: number): DecisionStatusFault | null {
  if (Number.isInteger(status) && status >= SUCCESS_STATUS_FIRST && status < SUCCESS_STATUS_END) {
    return null;
  }
  if (CREDENTIAL_STATUSES.has(status)) {
    return CREDENTIAL_FAULT;
  }
  if (status === REQUEST_INVALID_STATUS) {
    return REQUEST_INVALID_FAULT;
  }
  if (CAPACITY_STATUSES.has(status)) {
    return CAPACITY_FAULT;
  }
  if (status >= SERVER_ERROR_STATUS_FIRST && status < SERVER_ERROR_STATUS_END) {
    return SERVER_FAULT;
  }
  return UNEXPECTED_STATUS_FAULT;
}

/** The request this transport hands to the HTTP layer. */
export interface SystemOneFetchInit {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** A redirect is refused: following one would send the key to a host the route did not name. */
  readonly redirect: "error";
  readonly signal: AbortSignal;
}

/** The part of a response this transport reads. A fetch `Response` satisfies it. */
export interface SystemOneFetchResponse {
  readonly status: number;
  readonly headers: {
    /**
     * @param name The header's name.
     * @returns The header's value, or `null` when the response carries none.
     */
    get(name: string): string | null;
  };
  /**
   * @returns The whole body as text.
   */
  text(): Promise<string>;
}

/**
 * The HTTP call this transport makes.
 *
 * Declared as the narrow shape actually used, so the platform's own function
 * satisfies it and a test can stand in for it without a network.
 */
export type SystemOneFetch = (url: string, init: SystemOneFetchInit) => Promise<SystemOneFetchResponse>;

/** How the transport is built. */
export interface SystemOneTransportConfig {
  /** The HTTP call to make. Defaults to the platform's own. */
  readonly fetchImpl?: SystemOneFetch;
  /**
   * The current time in milliseconds since the epoch. Defaults to the system clock.
   *
   * It times the call and is the instant a retry hint written as a date is
   * measured against.
   */
  readonly now?: () => number;
}

/** One call for the transport to make. */
export interface SystemOneTransportRequest {
  /** The route to call, already resolved and admitted by the caller. */
  readonly route: ResolvedDecisionRoute;
  /** The encoded request, sent as it is given. */
  readonly body: DecisionWireRequest;
  /**
   * Aborts the call. An aborted call rejects with this signal's own reason,
   * the very value, so the caller that aborted recognises its own abort.
   */
  readonly signal: AbortSignal;
}

/** What a call that was answered returns. */
export interface SystemOneTransportResult {
  /** The response body as parsed JSON, not validated and not decoded. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** The model the vendor reports answered, exactly as reported and in full. */
  readonly servedModel: string;
  /** An excerpt of the vendor's id for the request, or `null` when the response carried none. */
  readonly vendorRequestId: string | null;
  /** What the vendor billed, credited to the route's provider and pinned model. */
  readonly usage: LlmUsageRecord;
  /** The HTTP status of the answer. */
  readonly status: number;
  /** Time from dispatch until the body was read, in milliseconds. */
  readonly durationMs: number;
}

/** The hosted typed-decision transport. */
export interface SystemOneTransport {
  readonly name: "systemone";
  /**
   * Make one call.
   *
   * @param request The route, the encoded request and the abort signal.
   * @returns The undecoded answer and what the call cost.
   * @throws {DecisionCallError} For every failure while the signal is live.
   *   Once the signal has aborted, a call that gets no answer rejects with the
   *   signal's reason instead.
   */
  execute(request: SystemOneTransportRequest): Promise<SystemOneTransportResult>;
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
 * Whether an object's keys are exactly the ones given.
 *
 * @param record The object.
 * @param keys The keys it must hold, and no others.
 * @returns True when the two sets are equal.
 */
function hasExactlyKeys(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const present = Object.keys(record);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

/**
 * The vendor's own error type, read from the one body shape ever observed.
 *
 * That shape is an object holding only `detail`, which holds only a text
 * `error_type` and a text `message`. A body of another shape yields `null`
 * however plausible a field in it looks: the other shapes are unobserved, and
 * a guess read out of one would be reported as the vendor's word.
 *
 * @param body The response body as text.
 * @returns The error type, or `null` when the body is not of the observed shape.
 */
function observedErrorType(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !hasExactlyKeys(parsed, ["detail"])) {
    return null;
  }
  const detail = parsed.detail;
  if (!isRecord(detail) || !hasExactlyKeys(detail, ["error_type", "message"])) {
    return null;
  }
  const errorType = detail.error_type;
  return typeof errorType === "string" && errorType !== "" && typeof detail.message === "string" ? errorType : null;
}

/**
 * A printable identifier, or `null`.
 *
 * @param value A failure's `name` or `code`.
 * @returns The value when it is a short identifier, else `null`.
 */
function identifierOrNull(value: unknown): string | null {
  return typeof value === "string" && FAILURE_IDENTIFIER.test(value) ? value : null;
}

/**
 * Describe a failure of the HTTP layer without quoting it.
 *
 * Built from the class name and the system code of the failure and of each of
 * its causes, and never from a message. A message is free text written by the
 * layer that failed, and when that layer refused to build the request it
 * quotes the header it refused, which is where the key is.
 *
 * @param error Whatever the HTTP layer threw.
 * @returns A description that names the failure and holds no text from it.
 */
function describeFailure(error: unknown): string {
  const links: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < FAILURE_CAUSE_DEPTH && isRecord(current); depth += 1) {
    const name = identifierOrNull(current.name) ?? "an unnamed failure";
    const code = identifierOrNull(current.code);
    links.push(code === null ? name : `${name} ${code}`);
    current = current.cause;
  }
  return links.length === 0 ? "a thrown value that is not an error" : links.join(", caused by ");
}

/**
 * Take the key out of text this layer did not write.
 *
 * Every exact occurrence is replaced, and the replacement is done on the whole
 * text before any of it is excerpted, so a key lying across an excerpt's bound
 * is removed whole and not cut to a prefix. Text that does not hold the key is
 * returned unchanged.
 *
 * @param text Text from a vendor or from a lower layer.
 * @param key The key the request was sent with; never empty.
 * @returns The text with the key replaced wherever it stood.
 */
function withoutKey(text: string, key: string): string {
  return text.split(key).join(KEY_REMOVED);
}

/**
 * Read the key for a route from the environment, by name.
 *
 * @param route The route whose key is wanted.
 * @returns The key, without surrounding whitespace, which is never part of one.
 * @throws {DecisionCredentialError} When the variable is unset or holds no
 *   key, because a request sent without one would reach the vendor anonymous
 *   and be rejected there later and less clearly.
 */
function readKey(route: ResolvedDecisionRoute): string {
  const value = process.env[route.apiKeyEnv];
  const key = value === undefined ? "" : value.trim();
  if (key.length === 0) {
    throw new DecisionCredentialError({ source: "key_unset", route: route.route, apiKeyEnv: route.apiKeyEnv });
  }
  return key;
}

/**
 * Write the request body as JSON.
 *
 * @param request The call being made.
 * @returns The body as text.
 * @throws {DecisionRequestInvalidError} When the request cannot be written as
 *   JSON, so that the failure is one of this package's own and not a raw one.
 */
function serialiseBody(request: SystemOneTransportRequest): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(request.body);
  } catch {
    text = undefined;
  }
  if (typeof text !== "string") {
    throw new DecisionRequestInvalidError({
      source: "request_validation",
      route: request.route.route,
      fieldPath: "$",
      reason: "the request cannot be written as JSON",
    });
  }
  return text;
}

/**
 * A response header's value, or `null` when the response carries none.
 *
 * @param response The response.
 * @param name The header's name.
 * @returns The value, or `null` when it is absent or blank.
 */
function headerOrNull(response: SystemOneFetchResponse, name: string): string | null {
  const value = response.headers.get(name);
  return value === null || value.trim() === "" ? null : value;
}

/**
 * The vendor's id for a request, with the key taken out of it.
 *
 * @param response The response.
 * @param key The key the request was sent with.
 * @returns The id, or `null` when the response carried none.
 */
function vendorRequestIdOf(response: SystemOneFetchResponse, key: string): string | null {
  const id = headerOrNull(response, VENDOR_REQUEST_ID_HEADER);
  return id === null ? null : withoutKey(id, key);
}

/** What a failing status came with. */
interface StatusFailureContext {
  readonly route: ResolvedDecisionRoute;
  readonly response: SystemOneFetchResponse;
  /** The response body as text, the key taken out; empty when it could not be read. */
  readonly body: string;
  /** The vendor's id for the request, the key taken out; `null` when there was none. */
  readonly vendorRequestId: string | null;
  readonly nowMs: number;
}

/**
 * Build the error for a status that is not an answer.
 *
 * The fault is the one the status table gives. The body and the headers add
 * detail to the error and never change which error it is. A retry hint is
 * carried only for a status worth retrying: a hint beside a rejected key or a
 * rejected request would invite a retry that cannot succeed.
 *
 * @param statusFault What the status means.
 * @param context The route, the response, its body and the current time.
 * @returns The error to raise.
 */
function failureForStatus(statusFault: DecisionStatusFault, context: StatusFailureContext): DecisionCallError {
  const { route, response, body, vendorRequestId } = context;
  const answered = {
    route: route.route,
    status: response.status,
    body,
    vendorErrorType: observedErrorType(body),
    vendorRequestId,
  };
  switch (statusFault.fault) {
    case "credential":
      return new DecisionCredentialError({ source: "vendor_rejected", ...answered });
    case "schema":
      return new DecisionRequestInvalidError({ source: "vendor_rejected", ...answered });
    case "transport":
      return new DecisionTransportError({
        source: "status",
        ...answered,
        retryable: statusFault.retryable,
        retryAfterMs: statusFault.retryable ? parseRetryAfterMs(response.headers, context.nowMs) : null,
      });
  }
}

/**
 * Read the body of a failing response.
 *
 * @param response The response.
 * @returns The body as text, or empty text when it could not be read: the
 *   status has already decided the fault, and a body that would only have been
 *   quoted must not turn a known status into an unknown failure.
 */
async function readFailureBody(response: SystemOneFetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/**
 * Turn a throw of the HTTP layer into the call's outcome.
 *
 * Once the signal has aborted, the outcome is the signal's own reason, so the
 * caller that aborted can tell its own deadline from a vendor failure. What
 * the HTTP layer threw is dropped and not rethrown. For an abort that loses
 * nothing: the platform's call rejects with the signal's reason, so the two
 * are one object. For anything else it is the point: a failure that merely
 * coincides with the abort is free text from another layer, and it may quote
 * the request it failed on.
 *
 * While the signal is live, the throw is a transport fault with no status. It
 * is marked retryable because no response arrived, which says nothing against
 * the request itself.
 *
 * @param error What the HTTP layer threw.
 * @param signal The call's abort signal.
 * @param route The route being called.
 * @param key The key the request was sent with, to keep it out of the fault.
 * @returns Never.
 * @throws The signal's reason, or a {@link DecisionTransportError}.
 */
function raiseWithoutAnswer(error: unknown, signal: AbortSignal, route: DecisionRoute, key: string): never {
  if (signal.aborted) {
    const reason: unknown = signal.reason;
    throw reason;
  }
  throw new DecisionTransportError({
    source: "network",
    route,
    retryable: true,
    detail: withoutKey(describeFailure(error), key),
  });
}

/**
 * Build the hosted typed-decision transport.
 *
 * @param config The HTTP call and the clock, each replaceable for testing.
 * @returns A transport that makes one call per `execute`.
 */
export function createSystemOneTransport(config: SystemOneTransportConfig = {}): SystemOneTransport {
  const send: SystemOneFetch = config.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = config.now ?? Date.now;

  return {
    name: "systemone",
    async execute(request: SystemOneTransportRequest): Promise<SystemOneTransportResult> {
      const { route, signal } = request;
      const routeName = route.route;
      const key = readKey(route);
      const body = serialiseBody(request);
      const startedAt = now();

      let response: SystemOneFetchResponse;
      try {
        response = await send(`${route.baseUrl.replace(/\/+$/, "")}${SYSTEMONE_PATH}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": JSON_MEDIA_TYPE,
            accept: JSON_MEDIA_TYPE,
          },
          body,
          redirect: "error",
          signal,
        });
      } catch (error) {
        return raiseWithoutAnswer(error, signal, routeName, key);
      }

      const status = response.status;
      const vendorRequestId = vendorRequestIdOf(response, key);
      const statusFault = decisionFaultForStatus(status);
      if (statusFault !== null) {
        throw failureForStatus(statusFault, {
          route,
          response,
          body: withoutKey(await readFailureBody(response), key),
          vendorRequestId,
          nowMs: now(),
        });
      }

      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        return raiseWithoutAnswer(error, signal, routeName, key);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
      if (!isRecord(payload)) {
        throw new DecisionResponseFormatError({
          route: routeName,
          fieldPath: "$",
          reason: "the body is not a JSON object",
          status,
          usage: null,
          vendorRequestId,
        });
      }

      const usage = decisionUsageOf(
        payload.usage,
        { provider: route.providerName, model: route.modelPin },
        route.priceAnchor,
      );
      const servedModel = payload.model;
      if (typeof servedModel !== "string" || servedModel.trim() === "") {
        throw new DecisionResponseFormatError({
          route: routeName,
          fieldPath: "model",
          reason: "the body names no answering model",
          status,
          usage,
          vendorRequestId,
        });
      }

      return {
        payload,
        servedModel,
        vendorRequestId: vendorRequestId === null ? null : decisionErrorExcerpt(vendorRequestId),
        usage,
        status,
        durationMs: now() - startedAt,
      };
    },
  };
}
