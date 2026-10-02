/**
 * The fault vocabulary and typed errors of a decision call.
 *
 * A decision call either returns validated answers or rejects with one of the
 * errors here. There is no third outcome: no default answer, no empty
 * distribution, no partial result. A caller that receives a value can act on
 * it, and a caller that receives a rejection knows which of a closed set of
 * things went wrong.
 *
 * That set is `fault`, and it is written on every error as an own enumerable
 * property. The consumer that decides what a failure means lives in another
 * package and may load a second copy of this one, where `instanceof` against
 * these classes is false for an error raised by the first copy. A plain
 * property read works across both, and across an object spread or a JSON round
 * trip, so the vocabulary is the contract and the classes are a convenience for
 * the code that raises them. A structured clone of an `Error` keeps only its
 * name, message and stack, so an error is serialised before it crosses a worker
 * boundary.
 *
 * The classes are finer than the vocabulary where the remedy differs inside one
 * fault: a request this package refused to send and a response a vendor sent
 * malformed are both `schema`, and are raised as different classes because one
 * is the caller's defect and the other is the vendor's.
 *
 * No error carries a credential. The key is read by NAME where the request is
 * built and only the name can appear here.
 *
 * Text that did not originate in this package is untrusted, and an error is
 * written to logs and journal rows whole. So every such string an error or its
 * attempt record carries passes through one function,
 * {@link decisionErrorExcerpt}, which bounds its length and replaces what
 * cannot be printed: a vendor's body, error type, request id and reported
 * model, a network failure's description, and a field path or reason that may
 * quote a vendor's key. What this package or its caller chose is carried as
 * given: the route, the key variable's name, the pinned model, the provider
 * and the correlation id. Vendor text never decides the fault either: an
 * unobserved error body is not a contract, so classification is by status
 * alone.
 *
 * An error and the attempt record attached to it state several of the same
 * facts. Each such fact has one source, the error, so the two cannot be read
 * as disagreeing. See {@link DecisionCallError.withAttempt}.
 *
 * @module llm/decision/errors
 */

import type { LlmUsageRecord } from "../types";
import type { DecisionAttemptMeasurement, DecisionFaultedAttemptRecord, DecisionRoute } from "./types";

/**
 * Every way a decision call can fail, as a closed list.
 *
 * - `timeout`: the call was dispatched and its budget ran out, or the caller
 *   stopped waiting, before an answer arrived.
 * - `admission`: this package's own rate or concurrency guard did not admit the
 *   call inside the budget. The vendor was never contacted.
 * - `transport`: the vendor could not be reached, or answered with a status
 *   that is neither an answer nor a statement about the request or the key.
 * - `schema`: the request breaks the wire contract or the route's limits, or
 *   the vendor's answer does.
 * - `credential`: there is no key to send, or the vendor rejected the one sent.
 *   Kept apart from `transport` so a revoked key cannot pass for a slow vendor.
 * - `route_mismatch`: a model other than the route's pin answered.
 * - `unavailable`: the route may not be called from here at all.
 */
export const DECISION_FAULTS = [
  "timeout",
  "admission",
  "transport",
  "schema",
  "credential",
  "route_mismatch",
  "unavailable",
] as const;

/** One way a decision call can fail. See {@link DECISION_FAULTS}. */
export type DecisionFault = (typeof DECISION_FAULTS)[number];

/**
 * Why a route may not be called.
 *
 * - `route_not_admitted`: the route table does not admit the route today: its
 *   model id is unconfirmed, its provider account is not live, its contract was
 *   never confirmed by an authenticated call, or it has no base URL.
 * - `engine_served`: the route is answered by the consumer's own process, and
 *   this package holds no transport for it.
 * - `breaker_open`: the route's circuit breaker is refusing calls.
 */
export const DECISION_UNAVAILABLE_CODES = ["route_not_admitted", "engine_served", "breaker_open"] as const;

/** One reason a route may not be called. See {@link DECISION_UNAVAILABLE_CODES}. */
export type DecisionUnavailableCode = (typeof DECISION_UNAVAILABLE_CODES)[number];

/**
 * Maximum characters of vendor or lower-layer text carried in one field of an
 * error.
 *
 * An error body is unbounded input from outside the process. It is kept short
 * enough to read in a log line and long enough to show the shape of what came
 * back; the same bound the generative gateway transport applies.
 */
export const DECISION_ERROR_BODY_EXCERPT = 400;

/**
 * The characters an excerpt never carries.
 *
 * Control characters, which can end a log line or drive a terminal; invisible
 * format characters, which can reorder or hide the text around them; the line
 * and paragraph separators; and a surrogate with no partner, which is not a
 * character at all and is what the length bound leaves when it cuts one in two.
 */
const UNPRINTABLE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu;

/**
 * What stands where an excerpt dropped a character.
 *
 * The Unicode replacement character: visible, so a reader can see that
 * something was there, and never mistaken for text the peer sent.
 */
const UNPRINTABLE_REPLACEMENT = "\uFFFD";

/**
 * Make a piece of text that did not originate in this package safe to carry.
 *
 * The length is cut first, so the work done is bounded however large the input
 * is, and each unprintable character is then replaced one for one, so the
 * result is never longer than the bound.
 *
 * @param text The untrusted text.
 * @returns At most {@link DECISION_ERROR_BODY_EXCERPT} leading characters of
 * it, with every unprintable character replaced.
 */
export function decisionErrorExcerpt(text: string): string {
  return text.slice(0, DECISION_ERROR_BODY_EXCERPT).replace(UNPRINTABLE_CHARACTERS, UNPRINTABLE_REPLACEMENT);
}

/**
 * Excerpt text that may be absent, keeping "none" distinct from "empty".
 *
 * @param text The untrusted text, or `null` when there was none to read.
 * @returns The excerpt, or `null` when there was no text.
 */
function excerptOrNull(text: string | null): string | null {
  return text === null ? null : decisionErrorExcerpt(text);
}

/**
 * Name a route in a message.
 *
 * @param route The route, or `null` when the raising layer does not know it.
 * @returns Text naming the route.
 */
function describeRoute(route: DecisionRoute | null): string {
  return route === null ? "a decision route" : `decision route ${route}`;
}

/** What the base class is built from. */
interface DecisionCallErrorInit {
  readonly fault: DecisionFault;
  readonly message: string;
  readonly route: DecisionRoute | null;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly vendorRequestId: string | null;
  readonly usage: LlmUsageRecord | null;
}

/**
 * The facts of an attempt that some error classes state themselves, beyond the
 * ones every error states.
 *
 * See {@link DecisionCallError.statedAttemptFacts}.
 */
type DecisionStatedAttemptFacts = Partial<Pick<DecisionAttemptMeasurement, "budgetMs" | "servedModel">>;

/**
 * The fields a later layer may complete, with the class's own types.
 *
 * See {@link DecisionCallError.withAttempt}.
 */
type DecisionCallErrorCompletion = Pick<
  DecisionCallError,
  "route" | "status" | "retryAfterMs" | "vendorRequestId" | "usage" | "attempt"
>;

/**
 * Base of every rejection a decision call produces.
 *
 * Abstract: a rejection is always one of the concrete classes, each bound to
 * one fault. Every field is assigned in the constructor, so each is an own
 * property and survives a structural copy of the error.
 *
 * A field a layer could not know is `null`. The codec does not know which route
 * it is encoding for and the transport does not know how long the call queued,
 * so an error raised below the client is completed by the client through
 * {@link DecisionCallError.withAttempt} rather than each layer guessing. An
 * absent input stays `null` on every path: it is never defaulted to zero or to
 * an empty string, which would read as a measurement.
 */
export abstract class DecisionCallError extends Error {
  /** Which of the closed set of failures this is. */
  public readonly fault: DecisionFault;

  /** The route the call named, or `null` until the client completes an error raised without one. */
  public readonly route: DecisionRoute | null;

  /** The HTTP status received, or `null` when no response arrived. */
  public readonly status: number | null;

  /** The vendor's retry hint in milliseconds, or `null` when it gave none. Never slept on here. */
  public readonly retryAfterMs: number | null;

  /** An excerpt of the vendor's id for the request, or `null` when none was read. */
  public readonly vendorRequestId: string | null;

  /**
   * What the vendor billed for the failed call, or `null` when nothing was read.
   *
   * Tokens are spent whether or not the answer is usable, so a rejection that
   * dropped them would report the calls that went wrong as free.
   */
  public readonly usage: LlmUsageRecord | null;

  /** The attempt this error ended, or `null` until the client attaches it. */
  public readonly attempt: DecisionFaultedAttemptRecord | null;

  /**
   * @param init The fault, the message, and what the raising layer knows.
   */
  protected constructor(init: DecisionCallErrorInit) {
    super(init.message);
    this.fault = init.fault;
    this.route = init.route;
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
    this.vendorRequestId = excerptOrNull(init.vendorRequestId);
    this.usage = init.usage;
    this.attempt = null;
  }

  /**
   * The facts of an attempt this error states in a field of its own.
   *
   * A class that carries such a fact returns it here, so the attempt record is
   * written from the error's value and never from a second reading of it.
   *
   * @returns The stated facts; none, unless a class overrides this.
   */
  protected statedAttemptFacts(): DecisionStatedAttemptFacts {
    return {};
  }

  /**
   * Complete the error with the attempt it ended.
   *
   * The record is built here rather than accepted whole, so it cannot disagree
   * with the error it belongs to. One rule covers every fact both carry: the
   * value the error states stands, and the client's measurement fills only
   * what the raising layer could not see. That holds for the fault, the route,
   * the status, the retry hint, the request id and the usage, which every
   * error carries, and for the budget and the answering model, which the
   * classes that are about them carry. An error's message is written from
   * those same values when it is raised, so the message, the fields and the
   * record all say one thing.
   *
   * @param measured What the client measured about the attempt.
   * @returns This error, completed.
   */
  public withAttempt(measured: DecisionAttemptMeasurement): this {
    const route = this.route ?? measured.route;
    const status = this.status ?? measured.status;
    const retryAfterMs = this.retryAfterMs ?? measured.retryAfterMs;
    const vendorRequestId = this.vendorRequestId ?? excerptOrNull(measured.vendorRequestId);
    const usage = this.usage ?? measured.usage;
    const completion: DecisionCallErrorCompletion = {
      route,
      status,
      retryAfterMs,
      vendorRequestId,
      usage,
      attempt: {
        ...measured,
        servedModel: excerptOrNull(measured.servedModel),
        ...this.statedAttemptFacts(),
        route,
        status,
        retryAfterMs,
        vendorRequestId,
        usage,
        outcome: "fault",
        fault: this.fault,
      },
    };
    Object.assign(this, completion);
    return this;
  }
}

/** How a {@link DecisionRouteUnavailableError} is built. */
export interface DecisionRouteUnavailableDetails {
  readonly route: DecisionRoute;
  readonly code: DecisionUnavailableCode;
  /** What about the route closes it, in words an operator can act on. */
  readonly reason: string;
}

/**
 * Thrown when a route may not be called.
 *
 * Raised before anything else is touched: no request is encoded, no guard is
 * entered and no vendor is contacted for a route that is closed.
 */
export class DecisionRouteUnavailableError extends DecisionCallError {
  public declare readonly fault: "unavailable";

  /** Why the route is closed. */
  public readonly code: DecisionUnavailableCode;

  /** An excerpt of what about the route closes it. */
  public readonly reason: string;

  /**
   * @param details The route, the code and the reason.
   */
  public constructor(details: DecisionRouteUnavailableDetails) {
    const reason = decisionErrorExcerpt(details.reason);
    super({
      fault: "unavailable",
      message: `${describeRoute(details.route)} is unavailable (${details.code}): ${reason}`,
      route: details.route,
      status: null,
      retryAfterMs: null,
      vendorRequestId: null,
      usage: null,
    });
    this.name = "DecisionRouteUnavailableError";
    this.code = details.code;
    this.reason = reason;
  }
}

/** How a {@link DecisionRequestInvalidError} is built. */
export type DecisionRequestInvalidDetails =
  | {
      /** The request was refused here, before any HTTP call. */
      readonly source: "request_validation";
      readonly route?: DecisionRoute;
      /** Path of the offending field, such as `questions.tone.criteria`. */
      readonly fieldPath: string;
      readonly reason: string;
    }
  | {
      /** The vendor refused the request as invalid. */
      readonly source: "vendor_rejected";
      readonly route?: DecisionRoute;
      readonly status: number;
      readonly body: string;
      readonly vendorErrorType: string | null;
      readonly vendorRequestId: string | null;
    };

/**
 * Thrown when a request breaks the wire contract or the route's limits.
 *
 * Either this package refused to send it, or the vendor answered that it is
 * invalid. Both mean the same request will fail the same way again, so neither
 * is retryable and neither says anything about the vendor's health.
 */
export class DecisionRequestInvalidError extends DecisionCallError {
  public declare readonly fault: "schema";

  /** Whether the request was refused here or by the vendor. */
  public readonly source: "request_validation" | "vendor_rejected";

  /**
   * An excerpt of the offending field's path, or `null` when the vendor refused
   * the request: the body that names the field has an unobserved shape and is
   * not parsed.
   */
  public readonly fieldPath: string | null;

  /** A bounded excerpt of the vendor's body, or `null` when no request was sent. */
  public readonly bodyExcerpt: string | null;

  /** An excerpt of the vendor's own error type where the body has the one observed shape, else `null`. */
  public readonly vendorErrorType: string | null;

  /**
   * @param details Where the request was refused, and what was wrong with it.
   */
  public constructor(details: DecisionRequestInvalidDetails) {
    const route = details.route ?? null;
    const sent = details.source === "vendor_rejected";
    super({
      fault: "schema",
      message: sent
        ? `${describeRoute(route)} rejected the request as invalid (HTTP ${details.status}): ` +
          decisionErrorExcerpt(details.body)
        : `The request to ${describeRoute(route)} is invalid at ${decisionErrorExcerpt(details.fieldPath)}: ` +
          decisionErrorExcerpt(details.reason),
      route,
      status: sent ? details.status : null,
      retryAfterMs: null,
      vendorRequestId: sent ? details.vendorRequestId : null,
      usage: null,
    });
    this.name = "DecisionRequestInvalidError";
    this.source = details.source;
    this.fieldPath = sent ? null : decisionErrorExcerpt(details.fieldPath);
    this.bodyExcerpt = sent ? decisionErrorExcerpt(details.body) : null;
    this.vendorErrorType = sent ? excerptOrNull(details.vendorErrorType) : null;
  }
}

/** What kept a call from being admitted. */
export type DecisionAdmissionSource = "provider_guard" | "route_budget" | "caller_signal";

/** How a {@link DecisionAdmissionError} is built. */
export interface DecisionAdmissionDetails {
  readonly route: DecisionRoute;
  /**
   * `provider_guard`: the rate or concurrency guard gave up waiting.
   * `route_budget`: the budget ran out while the call was still queued.
   * `caller_signal`: the caller stopped waiting while the call was still queued.
   */
  readonly source: DecisionAdmissionSource;
  /** The budget the call ran under, in milliseconds. */
  readonly budgetMs: number;
}

/**
 * Thrown when this package's own guard did not admit the call in time.
 *
 * The vendor was never contacted, which is what separates this from a timeout:
 * nothing was spent, nothing was learned about the vendor, and the cause is
 * this process's own traffic.
 */
export class DecisionAdmissionError extends DecisionCallError {
  public declare readonly fault: "admission";

  /** What kept the call from being admitted. */
  public readonly source: DecisionAdmissionSource;

  /** The budget the call ran under, in milliseconds. */
  public readonly budgetMs: number;

  /**
   * @param details The route, what refused the call, and the budget.
   */
  public constructor(details: DecisionAdmissionDetails) {
    super({
      fault: "admission",
      message:
        `A call on ${describeRoute(details.route)} was not admitted inside its ${details.budgetMs} ms budget ` +
        `(${details.source}); the vendor was never contacted`,
      route: details.route,
      status: null,
      retryAfterMs: null,
      vendorRequestId: null,
      usage: null,
    });
    this.name = "DecisionAdmissionError";
    this.source = details.source;
    this.budgetMs = details.budgetMs;
  }

  /**
   * @returns The budget this error was raised under, which its message quotes.
   */
  protected override statedAttemptFacts(): DecisionStatedAttemptFacts {
    return { budgetMs: this.budgetMs };
  }
}

/** How a {@link DecisionCredentialError} is built. */
export type DecisionCredentialDetails =
  | {
      /** The key variable is unset or empty, so no request was made. */
      readonly source: "key_unset";
      readonly route?: DecisionRoute;
      /** The variable's NAME. Never its value. */
      readonly apiKeyEnv: string;
    }
  | {
      /** The vendor rejected the key that was sent. */
      readonly source: "vendor_rejected";
      readonly route?: DecisionRoute;
      readonly status: number;
      readonly body: string;
      readonly vendorErrorType: string | null;
      readonly vendorRequestId: string | null;
    };

/**
 * Thrown when a call cannot be authenticated.
 *
 * Its own fault, so a missing or revoked key is counted and alerted on by
 * itself. Filed under a general transport failure it would be absorbed into a
 * fallback rate and read as a slow vendor, and the caller would keep calling.
 */
export class DecisionCredentialError extends DecisionCallError {
  public declare readonly fault: "credential";

  /** Whether there was no key to send, or the vendor rejected the one sent. */
  public readonly source: "key_unset" | "vendor_rejected";

  /** NAME of the unset key variable, or `null` when a key was sent. Never a key. */
  public readonly apiKeyEnv: string | null;

  /** A bounded excerpt of the vendor's body, or `null` when no request was made. */
  public readonly bodyExcerpt: string | null;

  /** An excerpt of the vendor's own error type where the body has the one observed shape, else `null`. */
  public readonly vendorErrorType: string | null;

  /**
   * @param details Whether a key existed, and what the vendor said if one was sent.
   */
  public constructor(details: DecisionCredentialDetails) {
    const route = details.route ?? null;
    const sent = details.source === "vendor_rejected";
    super({
      fault: "credential",
      message: sent
        ? `${describeRoute(route)} rejected the credential (HTTP ${details.status}): ` +
          decisionErrorExcerpt(details.body)
        : `${details.apiKeyEnv} is unset, so ${describeRoute(route)} cannot be authenticated against; ` +
          "no request was made",
      route,
      status: sent ? details.status : null,
      retryAfterMs: null,
      vendorRequestId: sent ? details.vendorRequestId : null,
      usage: null,
    });
    this.name = "DecisionCredentialError";
    this.source = details.source;
    this.apiKeyEnv = sent ? null : details.apiKeyEnv;
    this.bodyExcerpt = sent ? decisionErrorExcerpt(details.body) : null;
    this.vendorErrorType = sent ? excerptOrNull(details.vendorErrorType) : null;
  }
}

/** How a {@link DecisionTransportError} is built. */
export type DecisionTransportDetails =
  | {
      /** The vendor answered with a failing status. */
      readonly source: "status";
      readonly route?: DecisionRoute;
      readonly status: number;
      /** Whether the same request could plausibly succeed later. */
      readonly retryable: boolean;
      readonly retryAfterMs: number | null;
      readonly body: string;
      readonly vendorErrorType: string | null;
      readonly vendorRequestId: string | null;
    }
  | {
      /** No response arrived: the connection failed. */
      readonly source: "network";
      readonly route?: DecisionRoute;
      /** Whether the same request could plausibly succeed later. */
      readonly retryable: boolean;
      /** The underlying failure's own description. It must not contain request headers. */
      readonly detail: string;
    };

/**
 * Thrown when the vendor could not be reached or answered with a failure that
 * is not about the request or the key.
 *
 * `retryable` and `retryAfterMs` are returned to the caller and never acted on
 * here. A call has one attempt: a retry inside a sub-second deadline would
 * spend the time the caller's next step needs.
 */
export class DecisionTransportError extends DecisionCallError {
  public declare readonly fault: "transport";

  /** Whether a failing status arrived, or no response at all. */
  public readonly source: "status" | "network";

  /**
   * Whether the same request could plausibly succeed later.
   *
   * Stated by the layer that classified the failure, for a failing status and
   * for a network failure alike: no value is assumed here.
   */
  public readonly retryable: boolean;

  /** A bounded excerpt of the vendor's body, or `null` when no response arrived. */
  public readonly bodyExcerpt: string | null;

  /** An excerpt of the vendor's own error type where the body has the one observed shape, else `null`. */
  public readonly vendorErrorType: string | null;

  /**
   * @param details The failing status and what came with it, or the network failure.
   */
  public constructor(details: DecisionTransportDetails) {
    const route = details.route ?? null;
    const answered = details.source === "status";
    super({
      fault: "transport",
      message: answered
        ? `${describeRoute(route)} returned HTTP ${details.status}: ${decisionErrorExcerpt(details.body)}`
        : `${describeRoute(route)} could not be reached: ${decisionErrorExcerpt(details.detail)}`,
      route,
      status: answered ? details.status : null,
      retryAfterMs: answered ? details.retryAfterMs : null,
      vendorRequestId: answered ? details.vendorRequestId : null,
      usage: null,
    });
    this.name = "DecisionTransportError";
    this.source = details.source;
    this.retryable = details.retryable;
    this.bodyExcerpt = answered ? decisionErrorExcerpt(details.body) : null;
    this.vendorErrorType = answered ? excerptOrNull(details.vendorErrorType) : null;
  }
}

/** What ended a dispatched call. */
export type DecisionTimeoutSource = "route_budget" | "caller_signal";

/** How a {@link DecisionTimeoutError} is built. */
export interface DecisionTimeoutDetails {
  readonly route: DecisionRoute;
  /**
   * `route_budget`: the call's budget ran out.
   * `caller_signal`: the caller's own signal aborted.
   */
  readonly source: DecisionTimeoutSource;
  /** The budget the call ran under, in milliseconds. */
  readonly budgetMs: number;
}

/**
 * Thrown when a dispatched call ended before an answer arrived.
 *
 * The request reached the transport, so the vendor may have done the work and
 * billed it; that is the difference from an admission failure.
 */
export class DecisionTimeoutError extends DecisionCallError {
  public declare readonly fault: "timeout";

  /** Whether the budget ran out or the caller stopped waiting. */
  public readonly source: DecisionTimeoutSource;

  /** The budget the call ran under, in milliseconds. */
  public readonly budgetMs: number;

  /**
   * @param details The route, what ended the call, and the budget.
   */
  public constructor(details: DecisionTimeoutDetails) {
    super({
      fault: "timeout",
      message:
        details.source === "route_budget"
          ? `A call on ${describeRoute(details.route)} ran out its ${details.budgetMs} ms budget after dispatch`
          : `A call on ${describeRoute(details.route)} was aborted by the caller's signal after dispatch`,
      route: details.route,
      status: null,
      retryAfterMs: null,
      vendorRequestId: null,
      usage: null,
    });
    this.name = "DecisionTimeoutError";
    this.source = details.source;
    this.budgetMs = details.budgetMs;
  }

  /**
   * @returns The budget this error was raised under, which its message quotes.
   */
  protected override statedAttemptFacts(): DecisionStatedAttemptFacts {
    return { budgetMs: this.budgetMs };
  }
}

/** How a {@link DecisionResponseFormatError} is built. */
export interface DecisionResponseFormatDetails {
  readonly route?: DecisionRoute;
  /** Path of the field that failed validation, such as `answers.tone.confidence`, or `$` for the body itself. */
  readonly fieldPath: string;
  readonly reason: string;
  /** The HTTP status of the response, or `null` when the validating layer does not know it. */
  readonly status: number | null;
  /** What the vendor billed for the answer, or `null` when nothing was read. */
  readonly usage: LlmUsageRecord | null;
  readonly vendorRequestId: string | null;
}

/**
 * Thrown when a vendor answered successfully with a body that fails validation.
 *
 * A malformed answer is rejected whole. Repairing it here (dropping an unknown
 * option, renormalising a distribution, defaulting a missing field) would hand
 * the caller a well-typed value no model produced.
 */
export class DecisionResponseFormatError extends DecisionCallError {
  public declare readonly fault: "schema";

  /** An excerpt of the path of the field that failed validation; it may quote a key the vendor sent. */
  public readonly fieldPath: string;

  /**
   * @param details The field, what was wrong with it, and what the answer cost.
   */
  public constructor(details: DecisionResponseFormatDetails) {
    const route = details.route ?? null;
    const fieldPath = decisionErrorExcerpt(details.fieldPath);
    super({
      fault: "schema",
      message:
        `${describeRoute(route)} answered with a body that fails validation at ` +
        `${fieldPath}: ${decisionErrorExcerpt(details.reason)}`,
      route,
      status: details.status,
      retryAfterMs: null,
      vendorRequestId: details.vendorRequestId,
      usage: details.usage,
    });
    this.name = "DecisionResponseFormatError";
    this.fieldPath = fieldPath;
  }
}

/** How a {@link DecisionRouteMismatchError} is built. */
export interface DecisionRouteMismatchDetails {
  readonly route: DecisionRoute;
  /** The model id the route requires a response to report. */
  readonly expectedServedModel: string;
  /** The model id the response reported. */
  readonly servedModel: string;
  readonly status: number | null;
  /** What the vendor billed for the answer, or `null` when nothing was read. */
  readonly usage: LlmUsageRecord | null;
  readonly vendorRequestId: string | null;
}

/**
 * Thrown when a model other than the route's pin answered.
 *
 * A route is a statement about which model decides. A serving stack that
 * silently substitutes another model returns answers of the right shape from
 * the wrong source, so the answer is refused however well formed it is, and it
 * is refused before its body is read.
 */
export class DecisionRouteMismatchError extends DecisionCallError {
  public declare readonly fault: "route_mismatch";

  /** The model id the route requires a response to report. */
  public readonly expectedServedModel: string;

  /**
   * An excerpt of the model id the response reported.
   *
   * The comparison that found the mismatch is made on the whole id, before this
   * error exists; what is kept here is for a reader, and a model id of ordinary
   * length is kept whole.
   */
  public readonly servedModel: string;

  /**
   * @param details The route, the two model ids, and what the answer cost.
   */
  public constructor(details: DecisionRouteMismatchDetails) {
    const servedModel = decisionErrorExcerpt(details.servedModel);
    super({
      fault: "route_mismatch",
      message:
        `${describeRoute(details.route)} was answered by ${servedModel}, ` +
        `not by its pinned model ${details.expectedServedModel}`,
      route: details.route,
      status: details.status,
      retryAfterMs: null,
      vendorRequestId: details.vendorRequestId,
      usage: details.usage,
    });
    this.name = "DecisionRouteMismatchError";
    this.expectedServedModel = details.expectedServedModel;
    this.servedModel = servedModel;
  }

  /**
   * @returns The model that answered, which is the whole content of this fault.
   */
  protected override statedAttemptFacts(): DecisionStatedAttemptFacts {
    return { servedModel: this.servedModel };
  }
}
