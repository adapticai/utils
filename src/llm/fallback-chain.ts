/**
 * Ordered execution of an alias's fallback chain (PD-3).
 *
 * Every call walks the chain primary -> secondary -> closed incumbent, and each
 * leg runs under a hard timeout and a circuit breaker. Those three controls are
 * one mechanism rather than three features: a chain without timeouts never
 * reaches its second leg, a chain without a breaker pays a dead provider's full
 * timeout on every call, and a timeout without a chain is just a slower
 * failure. Timeout cascades are this system's known brown-out mode, which is
 * why the budget is enforced here — at the only place that knows both the
 * caller's deadline and how many legs are left to spend it on.
 *
 * Nothing here ever substitutes a value for an outcome. When every leg is
 * exhausted the caller gets a typed error naming each leg and why it failed,
 * because a default returned in place of an answer is a wrong answer that
 * nobody is told about.
 *
 * @module llm/fallback-chain
 */

import type { CircuitBreakerRegistry } from "./circuit-breaker";
import {
  ToolChoiceIgnoredError,
  UnsupportedCapabilityError,
  assertToolChoiceHonoured,
} from "./param-matrix";
import { RateGuardTimeoutError, withProviderGuards } from "./rate-guard";
import { LlmResponseFormatError } from "./structured-content";
import type {
  AliasAttemptRecord,
  LlmTransport,
  LlmTransportRequest,
  LlmTransportResponse,
  LlmUsageRecord,
  ResolvedRoute,
} from "./types";

/** Zero-valued usage, used as the identity when summing across attempts. */
const EMPTY_USAGE: LlmUsageRecord = {
  prompt_tokens: 0,
  completion_tokens: 0,
  provider: "none",
  model: "none",
  cost: 0,
};

/** What one leg of the chain needs in order to run. */
export interface ChainLeg {
  readonly route: ResolvedRoute;
  /** The transport that will carry this leg. */
  readonly transport: LlmTransport;
  /** Provider-normalised parameters, or the error that made this leg unusable. */
  readonly params: Record<string, unknown> | UnsupportedCapabilityError;
}

/** Everything the executor needs for one call. */
export interface ChainExecution {
  readonly legs: readonly ChainLeg[];
  readonly content: string | readonly unknown[];
  readonly responseFormat: LlmTransportRequest["responseFormat"];
  /**
   * System/developer instruction and prior turns, carried alongside `content`
   * rather than inside `params`, because they become MESSAGES rather than body
   * parameters and every leg must rebuild them in its provider's shape.
   */
  readonly developerPrompt?: string;
  readonly context?: readonly unknown[];
  readonly breakers: CircuitBreakerRegistry;
  readonly correlationId?: string;
  /** The caller's own cancellation, honoured ahead of any per-leg budget. */
  readonly callerSignal?: AbortSignal;
  /**
   * The instant, on {@link ChainExecution.now}'s clock, at which the caller's
   * whole-call deadline expires. Every leg's budget is cut to what remains of
   * it, and a leg reached after it has expired is not dispatched. Absent, each
   * leg runs for its route budget.
   */
  readonly deadlineAtMs?: number;
  /** Clock, injected so elapsed time is observable in tests without waiting. */
  readonly now?: () => number;
  /** Invoked once per leg after it settles, for metrics and shadow comparison. */
  readonly onAttempt?: (record: AliasAttemptRecord) => void;
}

/** Result of walking a chain to a successful leg. */
export interface ChainOutcome<T> {
  readonly response: LlmTransportResponse<T>;
  readonly servedBy: ResolvedRoute;
  readonly attempts: readonly AliasAttemptRecord[];
  readonly totalUsage: LlmUsageRecord;
}

/**
 * Thrown when every leg of a chain has been tried and none produced an answer.
 *
 * Carries the full attempt record rather than only the last error. The last
 * error is usually the least informative one — the incumbent timing out says
 * nothing about why the two legs before it were skipped — and an operator
 * reading only that would go looking in the wrong place.
 */
export class ChainExhaustedError extends Error {
  /** The alias whose chain was exhausted. */
  public readonly alias: string;

  /** Every leg tried, in order, with its outcome. */
  public readonly attempts: readonly AliasAttemptRecord[];

  /** Usage spent across the failed attempts, so the spend is still accounted for. */
  public readonly totalUsage: LlmUsageRecord;

  /**
   * @param alias The alias.
   * @param attempts The attempt record.
   * @param totalUsage Usage spent across all attempts.
   */
  public constructor(
    alias: string,
    attempts: readonly AliasAttemptRecord[],
    totalUsage: LlmUsageRecord,
  ) {
    const detail = attempts
      .map(
        (attempt) =>
          `${attempt.role}(${attempt.provider}/${attempt.modelId}): ${attempt.outcome}` +
          (attempt.reason === undefined ? "" : ` — ${attempt.reason}`),
      )
      .join("; ");
    super(
      `LLM alias "${alias}" exhausted its fallback chain. Attempts: ${detail || "(no leg was servable)"}`,
    );
    this.name = "ChainExhaustedError";
    this.alias = alias;
    this.attempts = attempts;
    this.totalUsage = totalUsage;
  }
}

/**
 * Add two usage records.
 *
 * Attribution keeps the LAST attempt's provider and model, because that is the
 * one that produced the answer the caller is holding, while the token counts
 * accumulate across every attempt. Charging only the successful attempt would
 * understate spend by exactly the amount the failures cost — which is the
 * amount a fallback chain is most likely to run up.
 *
 * A count one attempt did not report makes the total for that count unknown
 * (`null`): a sum that skipped it would present a partial figure as complete.
 *
 * @param a The running total.
 * @param b The attempt to add, if any.
 * @returns The combined usage.
 */
export function sumUsage(
  a: LlmUsageRecord,
  b: LlmUsageRecord | undefined,
): LlmUsageRecord {
  if (b === undefined) {
    return a;
  }
  return {
    prompt_tokens: addKnown(a.prompt_tokens, b.prompt_tokens),
    completion_tokens: addKnown(a.completion_tokens, b.completion_tokens),
    reasoning_tokens:
      a.reasoning_tokens === undefined && b.reasoning_tokens === undefined
        ? undefined
        : (a.reasoning_tokens ?? 0) + (b.reasoning_tokens ?? 0),
    cached_tokens:
      a.cached_tokens === undefined && b.cached_tokens === undefined
        ? undefined
        : (a.cached_tokens ?? 0) + (b.cached_tokens ?? 0),
    provider: b.provider,
    model: b.model,
    cost: addKnown(a.cost, b.cost),
  };
}

/**
 * Add two measured quantities, either of which may be unreported.
 *
 * @param a The running total, or null when already unknown.
 * @param b The value to add, or null when unreported.
 * @returns The sum, or null when either side is unknown.
 */
function addKnown(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/**
 * The budget one leg may spend.
 *
 * The route's own budget, cut to what remains of the caller's deadline. The
 * route budget is never widened, so a caller with a long deadline still has a
 * slow leg abandoned in time for the next one to run; and the deadline is never
 * exceeded, so the last leg reached ends when the caller stops waiting.
 *
 * @param routeBudgetMs The leg's route budget.
 * @param deadlineAtMs The caller's deadline instant, if any.
 * @param nowMs The current instant on the same clock.
 * @returns The leg's budget in milliseconds; zero or less means none is left.
 */
export function legBudgetMs(
  routeBudgetMs: number,
  deadlineAtMs: number | undefined,
  nowMs: number,
): number {
  if (deadlineAtMs === undefined) {
    return routeBudgetMs;
  }
  return Math.min(routeBudgetMs, deadlineAtMs - nowMs);
}

/** Raised internally when a leg exceeds its budget. */
class LegTimeoutError extends Error {
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
 * Run one leg under a hard timeout, honouring the caller's own cancellation.
 *
 * The timer is always cleared and the abort listener always removed, including
 * on the success path. A long-lived process that leaked one timer per LLM call
 * would accumulate them at exactly the rate it does useful work.
 *
 * @param leg The leg to run.
 * @param params Normalised parameters for this leg.
 * @param execution The call context.
 * @param budgetMs The leg's budget: its route budget cut to the caller's deadline.
 * @returns The provider's answer.
 */
async function runLeg<T>(
  leg: ChainLeg,
  params: Record<string, unknown>,
  execution: ChainExecution,
  budgetMs: number,
): Promise<LlmTransportResponse<T>> {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort(new LegTimeoutError(leg.route.routeKey, budgetMs));
  }, budgetMs);

  const forwardAbort = (): void => {
    controller.abort(execution.callerSignal?.reason);
  };
  if (execution.callerSignal !== undefined) {
    if (execution.callerSignal.aborted) {
      forwardAbort();
    } else {
      execution.callerSignal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  try {
    // The guards wrap the transport rather than the whole leg, so the per-leg
    // timeout above still bounds the total wait: a caller queued behind the
    // rate limiter is spending its budget just as surely as one waiting on the
    // provider, and only one clock should govern both. The leg's own signal is
    // handed to the guard as well, so a leg whose budget or caller is gone
    // leaves the queue at once instead of holding its place in it.
    const response = await withProviderGuards(
      leg.route.providerName,
      () =>
        leg.transport.execute<T>({
          route: leg.route,
          content: execution.content,
          responseFormat: execution.responseFormat,
          params,
          developerPrompt: execution.developerPrompt,
          context: execution.context,
          signal: controller.signal,
          correlationId: execution.correlationId,
        }),
      budgetMs,
      { modelId: leg.route.modelId, signal: controller.signal },
    );
    assertToolChoiceHonoured(leg.route, params, response.tool_calls);
    return response;
  } finally {
    clearTimeout(timer);
    execution.callerSignal?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Classify why a leg failed.
 *
 * The distinction matters to the breaker: a timeout and a 5xx are evidence the
 * provider is unhealthy, while the caller cancelling is not. Counting a
 * cancellation as a provider failure would let a burst of user-cancelled
 * requests open the breaker on a perfectly healthy route.
 *
 * @param error The thrown value.
 * @param callerSignal The caller's cancellation signal, if any.
 * @returns The outcome and whether it counts against route health.
 */
function classify(
  error: unknown,
  callerSignal: AbortSignal | undefined,
): { outcome: AliasAttemptRecord["outcome"]; reason: string; countsAgainstHealth: boolean } {
  if (callerSignal !== undefined && callerSignal.aborted) {
    return {
      outcome: "skipped",
      reason: "caller cancelled",
      countsAgainstHealth: false,
    };
  }
  if (error instanceof LegTimeoutError) {
    return { outcome: "timeout", reason: error.message, countsAgainstHealth: true };
  }
  if (error instanceof UnsupportedCapabilityError) {
    return { outcome: "skipped", reason: error.message, countsAgainstHealth: false };
  }
  if (error instanceof ToolChoiceIgnoredError) {
    // The route answered; it broke a declared guarantee rather than failing to
    // be available, so its breaker is not charged for it.
    return { outcome: "error", reason: error.message, countsAgainstHealth: false };
  }
  if (error instanceof RateGuardTimeoutError) {
    // Self-inflicted pacing, not provider ill-health. Counting it would let the
    // client's own throttling open a breaker on a perfectly healthy provider
    // and permanently reroute traffic nobody chose to reroute.
    return { outcome: "skipped", reason: error.message, countsAgainstHealth: false };
  }
  const reason = error instanceof Error ? error.message : String(error);
  if (/abort/i.test(reason)) {
    return {
      outcome: "timeout",
      reason: `aborted: ${reason}`,
      countsAgainstHealth: true,
    };
  }
  return { outcome: "error", reason, countsAgainstHealth: true };
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
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

/**
 * Walk a chain until a leg answers.
 *
 * @param alias The alias being served, for error attribution.
 * @param execution The call context.
 * @returns The first successful leg's answer, with the full attempt record.
 * @throws {ChainExhaustedError} When no leg produced an answer.
 */
export async function executeChain<T>(
  alias: string,
  execution: ChainExecution,
): Promise<ChainOutcome<T>> {
  const now = execution.now ?? Date.now;
  const attempts: AliasAttemptRecord[] = [];
  let totalUsage = EMPTY_USAGE;

  for (const leg of execution.legs) {
    const { route } = leg;

    if (isAborted(execution.callerSignal)) {
      // The caller has stopped waiting. Continuing to walk the chain would
      // spend money on an answer nobody will read.
      break;
    }

    if (leg.params instanceof UnsupportedCapabilityError) {
      const record: AliasAttemptRecord = {
        routeKey: route.routeKey,
        role: route.role,
        provider: route.providerName,
        modelId: route.modelId,
        outcome: "skipped",
        durationMs: 0,
        reason: leg.params.message,
      };
      attempts.push(record);
      execution.onAttempt?.(record);
      continue;
    }

    if (!execution.breakers.allows(route.routeKey)) {
      const record: AliasAttemptRecord = {
        routeKey: route.routeKey,
        role: route.role,
        provider: route.providerName,
        modelId: route.modelId,
        outcome: "breaker-open",
        durationMs: 0,
        reason: `circuit breaker is ${execution.breakers.stateOf(route.routeKey)}`,
      };
      attempts.push(record);
      execution.onAttempt?.(record);
      continue;
    }

    const budgetMs = legBudgetMs(route.timeoutMs, execution.deadlineAtMs, now());
    if (budgetMs <= 0) {
      // The caller's deadline is spent. Dispatching now would start a call
      // that is cancelled the moment it begins, and charge nothing but noise.
      const record: AliasAttemptRecord = {
        routeKey: route.routeKey,
        role: route.role,
        provider: route.providerName,
        modelId: route.modelId,
        outcome: "skipped",
        durationMs: 0,
        reason: "caller deadline exhausted before this leg",
      };
      attempts.push(record);
      execution.onAttempt?.(record);
      continue;
    }

    const startedAt = now();
    const holdsProbe = execution.breakers.onAttemptStart(route.routeKey);

    try {
      const response = await runLeg<T>(leg, leg.params, execution, budgetMs);
      execution.breakers.onSuccess(route.routeKey);
      totalUsage = sumUsage(totalUsage, response.usage);
      const record: AliasAttemptRecord = {
        routeKey: route.routeKey,
        role: route.role,
        provider: route.providerName,
        modelId: route.modelId,
        outcome: "ok",
        durationMs: now() - startedAt,
        budgetMs,
        servedModel: response.servedModel ?? null,
        usage: response.usage,
      };
      attempts.push(record);
      execution.onAttempt?.(record);
      return { response, servedBy: route, attempts, totalUsage };
    } catch (error) {
      const { outcome, reason, countsAgainstHealth } = classify(
        error,
        execution.callerSignal,
      );
      if (countsAgainstHealth) {
        execution.breakers.onFailure(route.routeKey);
      } else if (holdsProbe) {
        // No verdict on the route's health, but the probe slot this attempt
        // took must come back, or a half-open route admits no probe ever again.
        execution.breakers.onAttemptAbandoned(route.routeKey);
      }
      // A provider that answered with unparseable content still billed for the
      // answer; the spend belongs in the total whether or not a later leg serves.
      const billed = error instanceof LlmResponseFormatError ? error.usage : undefined;
      totalUsage = sumUsage(totalUsage, billed);
      const record: AliasAttemptRecord = {
        routeKey: route.routeKey,
        role: route.role,
        provider: route.providerName,
        modelId: route.modelId,
        outcome,
        durationMs: now() - startedAt,
        budgetMs,
        reason,
        ...(billed === undefined ? {} : { usage: billed }),
      };
      attempts.push(record);
      execution.onAttempt?.(record);

      if (outcome === "skipped" && isAborted(execution.callerSignal)) {
        break;
      }
    }
  }

  throw new ChainExhaustedError(alias, attempts, totalUsage);
}
