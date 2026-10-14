/**
 * One attempt against one leg: dispatch under a hard timeout, and the
 * classification of how it ended.
 *
 * Split from the chain walker so the same-model hedge runner and the walker
 * share exactly one definition of what a timeout, a capacity refusal, a
 * cancellation and a superseded attempt are. Two copies of that
 * classification would drift, and the breaker would then read the same event
 * differently depending on which code path produced it.
 *
 * @module llm/leg-attempt
 */

import {
  ToolChoiceIgnoredError,
  UnsupportedCapabilityError,
  assertToolChoiceHonoured,
} from "./param-matrix";
import { RateGuardTimeoutError, withProviderGuards } from "./rate-guard";
import { LlmResponseFormatError } from "./structured-content";
import type { BreakerFailureKind } from "./circuit-breaker";
import type {
  AliasAttemptRecord,
  LlmAttemptFailureClass,
  LlmTransport,
  LlmTransportRequest,
  LlmTransportResponse,
  LlmUsageRecord,
  ResolvedRoute,
} from "./types";

/** What one leg of the chain needs in order to run. */
export interface ChainLeg {
  readonly route: ResolvedRoute;
  /** The transport that will carry this leg. */
  readonly transport: LlmTransport;
  /** Provider-normalised parameters, or the error that made this leg unusable. */
  readonly params: Record<string, unknown> | UnsupportedCapabilityError;
  /**
   * The same model at other live providers, prepared like the leg itself.
   * Reached before any different-model leg, and only through hedging.
   */
  readonly equivalents?: readonly ChainLeg[];
}

/** The request-shaped part of a call that every attempt carries unchanged. */
export interface AttemptRequest {
  readonly content: string | readonly unknown[];
  readonly responseFormat: LlmTransportRequest["responseFormat"];
  readonly developerPrompt?: string;
  readonly context?: readonly unknown[];
  readonly correlationId?: string;
  /** The caller's own cancellation, honoured ahead of any per-attempt budget. */
  readonly callerSignal?: AbortSignal;
}

/** Raised internally when an attempt exceeds its hard budget. */
export class LegTimeoutError extends Error {
  /**
   * @param routeKey The leg that timed out.
   * @param budgetMs Its budget in milliseconds.
   */
  public constructor(routeKey: string, budgetMs: number) {
    super(`route ${routeKey} exceeded its ${budgetMs} ms budget`);
    this.name = "LegTimeoutError";
  }
}

/**
 * Raised internally when an attempt ran past its MEASURED timeout and was
 * replaced by another attempt on the same model.
 *
 * Not a verdict on the provider: the measured timeout is the chain's own
 * impatience, applied only because a same-model alternative could take over,
 * so the breaker learns nothing from it.
 */
export class AttemptSupersededError extends Error {
  /**
   * @param routeKey The attempt's leg.
   * @param afterMs How long it ran before it was replaced.
   */
  public constructor(routeKey: string, afterMs: number) {
    super(
      `route ${routeKey} exceeded its measured ${afterMs} ms attempt timeout and was ` +
        "superseded by a same-model attempt",
    );
    this.name = "AttemptSupersededError";
  }
}

/**
 * Raised internally on an attempt that was still running when another
 * attempt on the same model answered first. Not a verdict on the provider.
 */
export class HedgeLoserError extends Error {
  /**
   * @param routeKey The losing attempt's leg.
   */
  public constructor(routeKey: string) {
    super(`route ${routeKey} was cancelled: a same-model attempt answered first`);
    this.name = "HedgeLoserError";
  }
}

/** An attempt in flight. */
export interface AttemptHandle<T> {
  readonly promise: Promise<LlmTransportResponse<T>>;
  /** Cancel the attempt, recording why; the first reason given is kept. */
  readonly abort: (reason: Error) => void;
  /** The reason this attempt was cancelled by the chain, if it was. */
  readonly abortReason: () => Error | undefined;
  /** Whether the attempt's hard budget ran out. */
  readonly timedOut: () => boolean;
}

/**
 * Start one attempt under a hard timeout, honouring the caller's own cancellation.
 *
 * The timer is always cleared and the abort listener always removed, including
 * on the success path. A long-lived process that leaked one timer per LLM call
 * would accumulate them at exactly the rate it does useful work.
 *
 * @param leg The leg to run.
 * @param params Normalised parameters for this leg.
 * @param request The call's request fields and cancellation.
 * @param budgetMs The attempt's hard budget.
 * @returns A handle on the attempt.
 */
export function startAttempt<T>(
  leg: ChainLeg,
  params: Record<string, unknown>,
  request: AttemptRequest,
  budgetMs: number,
): AttemptHandle<T> {
  const controller = new AbortController();
  let chainReason: Error | undefined;
  let hardTimeout = false;

  const timer = setTimeout(() => {
    hardTimeout = true;
    controller.abort(new LegTimeoutError(leg.route.routeKey, budgetMs));
  }, budgetMs);

  const forwardAbort = (): void => {
    controller.abort(request.callerSignal?.reason);
  };
  if (request.callerSignal !== undefined) {
    if (request.callerSignal.aborted) {
      forwardAbort();
    } else {
      request.callerSignal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  const run = async (): Promise<LlmTransportResponse<T>> => {
    try {
      // The guards wrap the transport rather than the whole attempt, so the
      // hard timeout above still bounds the total wait: a caller queued behind
      // the rate limiter is spending its budget just as surely as one waiting
      // on the provider, and only one clock should govern both. The attempt's
      // own signal is handed to the guard as well, so an attempt whose budget
      // or caller is gone leaves the queue at once instead of holding its place.
      const response = await withProviderGuards(
        leg.route.providerName,
        () =>
          leg.transport.execute<T>({
            route: leg.route,
            content: request.content,
            responseFormat: request.responseFormat,
            params,
            developerPrompt: request.developerPrompt,
            context: request.context,
            signal: controller.signal,
            correlationId: request.correlationId,
          }),
        budgetMs,
        { modelId: leg.route.modelId, signal: controller.signal },
      );
      assertToolChoiceHonoured(leg.route, params, response);
      return response;
    } finally {
      clearTimeout(timer);
      request.callerSignal?.removeEventListener("abort", forwardAbort);
    }
  };

  return {
    promise: run(),
    abort: (reason: Error): void => {
      if (chainReason === undefined && !controller.signal.aborted) {
        chainReason = reason;
        controller.abort(reason);
      }
    },
    abortReason: () => chainReason,
    timedOut: () => hardTimeout,
  };
}

/**
 * HTTP statuses a provider (or the gateway relaying it) uses to say it is full
 * rather than that the request or the route is wrong: request timeout, too
 * early, too many requests, service unavailable, and Anthropic's overloaded.
 */
const CAPACITY_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 503, 529]);

/**
 * Wording providers use for a capacity refusal when the status is lost on the
 * way (a relayed body, a client library's own error). DeepInfra's is
 * "Model busy, retry later"; Anthropic's is "Overloaded".
 */
const CAPACITY_WORDING =
  /\b(busy|overloaded|capacity|rate[ -]?limit(ed)?|too many requests)\b/i;

/**
 * Whether a failure is the provider saying it is full rather than broken.
 *
 * Read by shape rather than by class, because the same signal reaches the
 * chain from more than one transport and not every transport's error class is
 * importable here.
 *
 * @param error The thrown value.
 * @param reason Its message.
 * @returns Whether it is a capacity signal.
 */
export function isCapacitySignal(error: unknown, reason: string): boolean {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && CAPACITY_STATUSES.has(status)) {
      return true;
    }
  }
  return CAPACITY_WORDING.test(reason);
}

/** HTTP statuses a provider uses to reject the caller's credentials. */
const CREDENTIAL_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/**
 * What the gateway transport's own errors about the exchange itself are, by
 * the `name` every copy of each carries.
 *
 * These two are raised when no provider said anything: the gateway was not
 * reached, or its answer could not be read. Their messages describe a failure
 * of the HTTP layer by its class names and system codes, the address that was
 * called and the variable the key is read from. All of that is description,
 * and a description can hold any word: a platform failure is called
 * `AbortError` or coded `ECONNABORTED` without the leg having timed out, and a
 * host can be named for anything. So neither error is ever read by its
 * wording. Read by name and not by class identity, because a consumer may
 * load a second copy of the transport.
 */
const GATEWAY_EXCHANGE_FAILURE_CLASSES: Readonly<Record<string, LlmAttemptFailureClass>> = {
  GatewayUnreachableError: "gateway_unreachable",
  GatewayResponseUnreadableError: "provider_error",
};

/**
 * The class of one of the gateway transport's own errors about the exchange.
 *
 * @param error The thrown value.
 * @returns The class, or null when the value is not one of those errors.
 */
function gatewayExchangeFailureClassOf(error: unknown): LlmAttemptFailureClass | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const { name } = error as { name?: unknown };
  return typeof name === "string" && Object.hasOwn(GATEWAY_EXCHANGE_FAILURE_CLASSES, name)
    ? GATEWAY_EXCHANGE_FAILURE_CLASSES[name]
    : null;
}

/**
 * The typed cause of a failure no branch of {@link classify} recognised by class.
 *
 * Read by shape for the same reason as {@link isCapacitySignal}: the failure
 * reaches the chain from more than one transport, including a consumer's own,
 * so its class cannot be relied on here. A status is trusted only when it is a
 * number, because some error types carry a non-HTTP status as a string.
 *
 * @param error The thrown value.
 * @param reason Its message.
 * @returns The class.
 */
function providerFailureClassOf(error: unknown, reason: string): LlmAttemptFailureClass {
  if (typeof error === "object" && error !== null) {
    const { status } = error as { status?: unknown };
    if (typeof status === "number" && CREDENTIAL_STATUSES.has(status)) {
      return "credential";
    }
  }
  return isCapacitySignal(error, reason) ? "capacity" : "provider_error";
}

/** What the chain learned from one failed leg. */
export interface LegFailure {
  /** How the attempt is recorded. A failure is never `ok`. */
  readonly outcome: Exclude<AliasAttemptRecord["outcome"], "ok">;
  readonly reason: string;
  readonly countsAgainstHealth: boolean;
  /** Which cooldown the failure earns, when it counts against health. */
  readonly failureKind: BreakerFailureKind;
  /**
   * The typed cause, carried onto the attempt record. Set from the failure's
   * type or shape and read by nothing in the chain: the breaker and the hedge
   * runner act on the fields above.
   */
  readonly failureClass: LlmAttemptFailureClass;
}

/**
 * Classify why a leg failed.
 *
 * The distinction matters to the breaker: a timeout and a 5xx are evidence the
 * provider is unhealthy, while the caller cancelling is not. Counting a
 * cancellation as a provider failure would let a burst of user-cancelled
 * requests open the breaker on a perfectly healthy route.
 *
 * Among failures that do count, a capacity signal (the provider said it is
 * busy, or the leg ran out its budget waiting on it) is told apart from a hard
 * failure so the breaker can re-admit a busy route sooner than a broken one. A
 * timeout is read as capacity: on a reachable provider it is what a full queue
 * looks like from outside, and a provider that is actually down still costs no
 * more than one probe per capacity cooldown.
 *
 * An attempt the chain itself cancelled — replaced after its measured
 * timeout, or beaten by a same-model attempt — is not a verdict on the
 * provider either, and is classified by the chain's reason rather than by
 * whatever the transport happened to throw on the way out.
 *
 * A failure is read by what it is before it is read by what it says. Every
 * error with a class of its own is decided by that class, and only a failure
 * that has none (a provider client's own error, a consumer transport's) is
 * read from its wording.
 *
 * @param error The thrown value.
 * @param callerSignal The caller's cancellation signal, if any.
 * @returns The outcome and whether it counts against route health.
 */
export function classify(
  error: unknown,
  callerSignal: AbortSignal | undefined,
): LegFailure {
  if (callerSignal !== undefined && callerSignal.aborted) {
    return {
      outcome: "skipped",
      reason: "caller cancelled",
      countsAgainstHealth: false,
      failureKind: "hard",
      failureClass: "caller_cancelled",
    };
  }
  if (error instanceof AttemptSupersededError) {
    return {
      outcome: "timeout",
      reason: error.message,
      countsAgainstHealth: false,
      failureKind: "capacity",
      failureClass: "superseded",
    };
  }
  if (error instanceof HedgeLoserError) {
    return {
      outcome: "skipped",
      reason: error.message,
      countsAgainstHealth: false,
      failureKind: "capacity",
      failureClass: "hedge_loser",
    };
  }
  if (error instanceof LegTimeoutError) {
    return {
      outcome: "timeout",
      reason: error.message,
      countsAgainstHealth: true,
      failureKind: "capacity",
      failureClass: "leg_timeout",
    };
  }
  if (error instanceof UnsupportedCapabilityError) {
    return {
      outcome: "skipped",
      reason: error.message,
      countsAgainstHealth: false,
      failureKind: "hard",
      failureClass: "unsupported_capability",
    };
  }
  if (error instanceof ToolChoiceIgnoredError) {
    // The route answered; it broke a declared guarantee rather than failing to
    // be available, so its breaker is not charged for it.
    return {
      outcome: "error",
      reason: error.message,
      countsAgainstHealth: false,
      failureKind: "hard",
      failureClass: "tool_choice_ignored",
    };
  }
  // Self-inflicted pacing, not provider ill-health. Counting it would let the
  // client's own throttling open a breaker on a perfectly healthy provider and
  // permanently reroute traffic nobody chose to reroute.
  if (error instanceof RateGuardTimeoutError) {
    return {
      outcome: "skipped",
      reason: error.message,
      countsAgainstHealth: false,
      failureKind: "hard",
      failureClass: "rate_guard",
    };
  }
  const reason = error instanceof Error ? error.message : String(error);
  const exchangeFailureClass = gatewayExchangeFailureClassOf(error);
  if (exchangeFailureClass !== null) {
    // Decided before anything reads the wording: this error says what it is,
    // and its message only describes a failure of the HTTP layer. Nothing
    // behind the gateway said it was full, so the failure is a hard one.
    return {
      outcome: "error",
      reason,
      countsAgainstHealth: true,
      failureKind: "hard",
      failureClass: exchangeFailureClass,
    };
  }
  if (/abort/i.test(reason)) {
    return {
      outcome: "timeout",
      reason: `aborted: ${reason}`,
      countsAgainstHealth: true,
      failureKind: "capacity",
      // An unparseable answer quotes the content it failed on, so the model's
      // own words can be what matched here. The class follows the error's type.
      failureClass: error instanceof LlmResponseFormatError ? "response_format" : "leg_timeout",
    };
  }
  if (error instanceof LlmResponseFormatError) {
    // The provider answered, badly. That is a route defect, not a full queue,
    // whatever words the unparseable content happens to contain.
    return {
      outcome: "error",
      reason,
      countsAgainstHealth: true,
      failureKind: "hard",
      failureClass: "response_format",
    };
  }
  return {
    outcome: "error",
    reason,
    countsAgainstHealth: true,
    failureKind: isCapacitySignal(error, reason) ? "capacity" : "hard",
    failureClass: providerFailureClassOf(error, reason),
  };
}

/**
 * Whether the caller has stopped waiting.
 *
 * Read through a function rather than inline, because `AbortSignal.aborted` is
 * a live getter: it can flip to true while a leg is in flight, but a compiler
 * that narrowed it at the top of the loop would prove the later check
 * unreachable and invite its removal. The check is not redundant — it is the
 * only thing that stops the chain spending money on an answer nobody will read.
 *
 * @param signal The caller's signal, if any.
 * @returns Whether the call has been cancelled.
 */
export function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

/**
 * The usage a failed leg was billed for, when the leg reached an answer.
 *
 * A leg that failed after the provider answered — content that does not parse,
 * or prose where a tool call was mandatory — was still charged. A leg that
 * never answered (timeout, outage, skip) carries no usage, and none is invented.
 *
 * @param error The thrown value.
 * @returns The billed usage, or undefined when the leg never produced an answer.
 */
export function billedUsageOf(error: unknown): LlmUsageRecord | undefined {
  if (error instanceof LlmResponseFormatError || error instanceof ToolChoiceIgnoredError) {
    return error.usage;
  }
  return undefined;
}
