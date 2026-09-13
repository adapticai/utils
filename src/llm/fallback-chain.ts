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
import { UnsupportedCapabilityError } from "./param-matrix";
import { RateGuardTimeoutError, withProviderGuards } from "./rate-guard";
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
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
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
    cost: a.cost + b.cost,
  };
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
 * @returns The provider's answer.
 */
async function runLeg<T>(
  leg: ChainLeg,
  params: Record<string, unknown>,
  execution: ChainExecution,
): Promise<LlmTransportResponse<T>> {
  const controller = new AbortController();
  const budgetMs = leg.route.timeoutMs;

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
    // provider, and only one clock should govern both.
    return await withProviderGuards(
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
    );
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

    const startedAt = now();
    execution.breakers.onAttemptStart(route.routeKey);

    try {
      const response = await runLeg<T>(leg, leg.params, execution);
      execution.breakers.onSuccess(route.routeKey);
      totalUsage = sumUsage(totalUsage, response.usage);
      const record: AliasAttemptRecord = {
        routeKey: route.routeKey,
        role: route.role,
        provider: route.providerName,
        modelId: route.modelId,
        outcome: "ok",
        durationMs: now() - startedAt,
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
      }
      const record: AliasAttemptRecord = {
        routeKey: route.routeKey,
        role: route.role,
        provider: route.providerName,
        modelId: route.modelId,
        outcome,
        durationMs: now() - startedAt,
        reason,
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
