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
 * Each leg is first run as a group of SAME-MODEL attempts (see `hedge.ts`):
 * hedged at the model's healthy p90, replaced after a measured timeout, and
 * reaching the same model at another provider before the leg is given up.
 * Only then does the walk move to the next leg — and a leg that serves a
 * different model than the configured one runs only when the caller's
 * cross-model policy allows it. With no latency evidence and no equivalent
 * configured, each group is a single attempt with the leg's budget, which is
 * the serial walk exactly.
 *
 * Nothing here ever substitutes a value for an outcome. When every leg is
 * exhausted the caller gets a typed error naming each leg and why it failed —
 * `LlmDeadlineExceededError` when the caller's deadline is what ran out,
 * `ChainExhaustedError` with reason `cross_model_denied` when policy stopped
 * the walk — because a default returned in place of an answer is a wrong
 * answer that nobody is told about.
 *
 * @module llm/fallback-chain
 */

import { LIVE_BREAKER_PATH } from "./circuit-breaker";
import type { BreakerPathView, CircuitBreakerRegistry } from "./circuit-breaker";
import { runSameModelGroup } from "./hedge";
import type { AttemptFields, SameModelPolicy } from "./hedge";
import { isAborted } from "./leg-attempt";
import type { ChainLeg } from "./leg-attempt";
import type { LegLatencyTracker } from "./leg-latency-tracker";
import { estimatePromptTokens } from "./leg-latency-tracker";
import { UnsupportedCapabilityError } from "./param-matrix";
import type {
  AliasAttemptRecord,
  BreakerPath,
  LlmCrossModelPolicy,
  LlmHedgeRefusals,
  LlmModelClassRelation,
  LlmRouteRole,
  LlmTransportRequest,
  LlmTransportResponse,
  LlmUsageRecord,
  ResolvedRoute,
} from "./types";

export { isCapacitySignal } from "./leg-attempt";
export type { ChainLeg } from "./leg-attempt";

/** Zero-valued usage, used as the identity when summing across attempts. */
const EMPTY_USAGE: LlmUsageRecord = {
  prompt_tokens: 0,
  completion_tokens: 0,
  provider: "none",
  model: "none",
  cost: 0,
};

/** No same-model attempt refused on any leg: the identity when tallying refusals. */
export const NO_HEDGE_REFUSALS: LlmHedgeRefusals = Object.freeze({
  primary: 0,
  secondary: 0,
  closed_incumbent: 0,
});

/**
 * Add a run's refusals, or one leg's, to a running tally.
 *
 * @param total The running tally.
 * @param more The refusals to add.
 * @returns The combined tally.
 */
export function sumHedgeRefusals(total: LlmHedgeRefusals, more: LlmHedgeRefusals): LlmHedgeRefusals {
  return {
    primary: total.primary + more.primary,
    secondary: total.secondary + more.secondary,
    closed_incumbent: total.closed_incumbent + more.closed_incumbent,
  };
}

/**
 * One leg's refusals as a tally.
 *
 * @param role The leg's role.
 * @param refused How many of its same-model attempts were refused.
 * @returns The tally.
 */
function refusalsOf(role: LlmRouteRole, refused: number): LlmHedgeRefusals {
  return { ...NO_HEDGE_REFUSALS, [role]: refused };
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
  /**
   * The traffic class this call belongs to. Absent means `live`.
   *
   * A measurement call (a shadow comparison, a health probe) reads the live
   * route's breaker to decide whether it may run and charges its own failures
   * to its own run, so measuring a candidate can never be the reason the model
   * that serves live decisions is excluded.
   */
  readonly breakerPath?: BreakerPath;
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
  /** Invoked once per attempt after it settles, for metrics and shadow comparison. */
  readonly onAttempt?: (record: AliasAttemptRecord) => void;
  /**
   * Same-model controls. Absent: every leg is one attempt with its full
   * budget, as in the serial chain.
   */
  readonly hedging?: SameModelPolicy;
  /** Healthy-latency evidence the hedging controls read, and the chain feeds. */
  readonly latency?: LegLatencyTracker;
  /** Whether a duplicate same-provider attempt may start; absent means never. */
  readonly admitDuplicate?: (route: ResolvedRoute, reserveFraction: number) => boolean;
  /** Whether a different-model leg may run. Absent means `allow_record`. */
  readonly crossModelPolicy?: LlmCrossModelPolicy;
  /**
   * The configured model's class. Absent means the first leg's; supplied when
   * the legs are a subset of the chain (the degraded direct path), whose first
   * leg is not the configured model.
   */
  readonly configuredModelClass?: string;
}

/** Result of walking a chain to a successful leg. */
export interface ChainOutcome<T> {
  readonly response: LlmTransportResponse<T>;
  readonly servedBy: ResolvedRoute;
  readonly attempts: readonly AliasAttemptRecord[];
  readonly totalUsage: LlmUsageRecord;
  /** Whether the answer came from the configured model. */
  readonly modelClassRelation: LlmModelClassRelation;
  /** Whether the answering attempt was a same-model hedge. */
  readonly hedged: boolean;
  /** Same-model attempts refused below the attempt floor, by leg role. */
  readonly hedgesRefusedBelowFloor: LlmHedgeRefusals;
}

/** Why a chain ended without an answer. */
export type ChainExhaustionReason = "exhausted" | "cross_model_denied" | "deadline_exceeded";

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
   * Why the chain ended. `cross_model_denied`: the configured model's attempts
   * were spent and policy forbade a different model. Callers map every reason
   * to no decision; the reason says which remedy applies.
   */
  public readonly reason: ChainExhaustionReason;

  /** Same-model attempts refused below the attempt floor, by leg role. */
  public readonly hedgesRefusedBelowFloor: LlmHedgeRefusals;

  /**
   * @param alias The alias.
   * @param attempts The attempt record.
   * @param totalUsage Usage spent across all attempts.
   * @param reason Why the chain ended; defaults to plain exhaustion.
   * @param hedgesRefusedBelowFloor Same-model attempts refused below the
   *   attempt floor, by leg role; defaults to none.
   */
  public constructor(
    alias: string,
    attempts: readonly AliasAttemptRecord[],
    totalUsage: LlmUsageRecord,
    reason: ChainExhaustionReason = "exhausted",
    hedgesRefusedBelowFloor: LlmHedgeRefusals = NO_HEDGE_REFUSALS,
  ) {
    const detail = attempts
      .map(
        (attempt) =>
          `${attempt.role}(${attempt.provider}/${attempt.modelId}): ${attempt.outcome}` +
          (attempt.reason === undefined ? "" : ` — ${attempt.reason}`),
      )
      .join("; ");
    const why =
      reason === "cross_model_denied"
        ? " Different-model legs were denied by the caller's cross-model policy."
        : reason === "deadline_exceeded"
          ? " The caller's deadline ran out."
          : "";
    super(
      `LLM alias "${alias}" exhausted its fallback chain.${why} Attempts: ${detail || "(no leg was servable)"}`,
    );
    this.name = "ChainExhaustedError";
    this.alias = alias;
    this.attempts = attempts;
    this.totalUsage = totalUsage;
    this.reason = reason;
    this.hedgesRefusedBelowFloor = hedgesRefusedBelowFloor;
  }
}

/**
 * Thrown when the caller's deadline ran out before any leg answered.
 *
 * A subclass of {@link ChainExhaustedError}, so a consumer that already treats
 * exhaustion as "no answer" keeps doing so, while one that needs to tell "the
 * models failed" from "we ran out of time" can match this class — the two call
 * for different remedies (a provider problem versus a budget problem), and
 * both map to no decision, never to a default.
 */
export class LlmDeadlineExceededError extends ChainExhaustedError {
  /** Discriminant for consumers that switch on shape rather than class. */
  public readonly kind = "deadline_exceeded" as const;

  /** The whole-call budget the chain started with, in milliseconds. */
  public readonly deadlineMs: number;

  /** The model class of the last attempt dispatched, or null when none was. */
  public readonly lastModelClass: string | null;

  /**
   * @param alias The alias.
   * @param attempts The attempt record.
   * @param totalUsage Usage spent across all attempts.
   * @param deadlineMs The budget the chain started with.
   * @param lastModelClass The last dispatched attempt's model class.
   * @param hedgesRefusedBelowFloor Same-model attempts refused below the
   *   attempt floor, by leg role; defaults to none.
   */
  public constructor(
    alias: string,
    attempts: readonly AliasAttemptRecord[],
    totalUsage: LlmUsageRecord,
    deadlineMs: number,
    lastModelClass: string | null,
    hedgesRefusedBelowFloor: LlmHedgeRefusals = NO_HEDGE_REFUSALS,
  ) {
    super(alias, attempts, totalUsage, "deadline_exceeded", hedgesRefusedBelowFloor);
    this.name = "LlmDeadlineExceededError";
    this.deadlineMs = deadlineMs;
    this.lastModelClass = lastModelClass;
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

/**
 * The model a leg serves, independent of which provider hosts it.
 *
 * @param route The leg's route.
 * @returns Its model class.
 */
export function modelClassOf(route: ResolvedRoute): string {
  return route.modelClass ?? route.modelId;
}

/**
 * Whether a provider-reported model names the model a route addressed.
 *
 * Providers report with or without an organisation prefix and in their own
 * case, so the comparison is case-insensitive and accepts one side being a
 * `/`-suffix of the other.
 *
 * @param reported The provider's report.
 * @param expected The route's model id.
 * @returns Whether they name the same model.
 */
export function isSameReportedModel(reported: string, expected: string): boolean {
  const a = reported.trim().toLowerCase();
  const b = expected.trim().toLowerCase();
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * How an attempt's model relates to the configured one.
 *
 * A leg addressed to a different model class is `different` whatever it
 * reported. A leg addressed to the configured class is `same` only when it
 * answered and the provider named the expected model; `different` when the
 * provider named another; `unknown` when it answered without saying. An
 * attempt that never answered carries the relation of the model it was
 * addressed to.
 *
 * @param route The attempt's route.
 * @param configuredClass The configured model class.
 * @param fields What the attempt recorded.
 * @returns The relation.
 */
export function modelClassRelationOf(
  route: ResolvedRoute,
  configuredClass: string,
  fields: Pick<AttemptFields, "outcome" | "servedModel">,
): LlmModelClassRelation {
  if (modelClassOf(route) !== configuredClass) {
    return "different";
  }
  if (fields.outcome !== "ok") {
    return "same";
  }
  if (fields.servedModel === undefined || fields.servedModel === null) {
    return "unknown";
  }
  return isSameReportedModel(fields.servedModel, route.modelId) ? "same" : "different";
}

/**
 * The prompt size the latency evidence is bucketed by.
 *
 * @param execution The call.
 * @returns Estimated prompt tokens, or null.
 */
function promptTokensOf(execution: ChainExecution): number | null {
  return estimatePromptTokens([
    execution.content,
    execution.developerPrompt,
    execution.context,
  ]);
}

/**
 * Walk a chain until a leg answers.
 *
 * @param alias The alias being served, for error attribution.
 * @param execution The call context.
 * @returns The first successful leg's answer, with the full attempt record.
 * @throws {LlmDeadlineExceededError} When the caller's deadline ran out first.
 * @throws {ChainExhaustedError} When no leg produced an answer.
 */
export async function executeChain<T>(
  alias: string,
  execution: ChainExecution,
): Promise<ChainOutcome<T>> {
  const now = execution.now ?? Date.now;
  const startedAt = now();
  const attempts: AliasAttemptRecord[] = [];
  const firstRoute = execution.legs[0]?.route;
  const configuredClass =
    execution.configuredModelClass ?? (firstRoute === undefined ? "" : modelClassOf(firstRoute));
  const policy = execution.crossModelPolicy ?? "allow_record";
  // Resolved once, where the call's traffic class is known, rather than at each
  // site that observes an attempt: one site left on the registry would be one
  // path whose failures still reach the live run.
  const breakers: BreakerPathView = execution.breakers.forPath(
    execution.breakerPath ?? LIVE_BREAKER_PATH,
  );
  const promptTokens = execution.latency === undefined ? null : promptTokensOf(execution);
  let totalUsage = EMPTY_USAGE;
  let hedgeRefusals = NO_HEDGE_REFUSALS;
  let dispatchIndex = 0;
  let deadlineHit = false;
  let crossModelDenied = false;
  let lastModelClass: string | null = null;

  /**
   * Record one attempt with its provenance.
   *
   * @param route The attempt's route.
   * @param fields What happened.
   * @param dispatch Whether it was a hedge, and its dispatch index.
   * @param servedProvider The provider's own report of who served, if any.
   * @returns The record.
   */
  const record = (
    route: ResolvedRoute,
    fields: AttemptFields,
    dispatch?: { readonly hedged: boolean; readonly attemptIndex: number },
    servedProvider?: string | null,
  ): AliasAttemptRecord => {
    const full: AliasAttemptRecord = {
      ...fields,
      servedProvider: servedProvider ?? route.providerName,
      modelClass: modelClassOf(route),
      modelClassRelation: modelClassRelationOf(route, configuredClass, fields),
      ...(dispatch === undefined
        ? {}
        : { hedged: dispatch.hedged, attemptIndex: dispatch.attemptIndex }),
    };
    attempts.push(full);
    execution.onAttempt?.(full);
    return full;
  };

  /**
   * The identity fields of a leg that was never dispatched.
   *
   * @param route The leg's route.
   * @returns The fields.
   */
  const undispatched = (
    route: ResolvedRoute,
  ): Pick<AttemptFields, "routeKey" | "role" | "provider" | "modelId" | "durationMs"> => ({
    routeKey: route.routeKey,
    role: route.role,
    provider: route.providerName,
    modelId: route.modelId,
    durationMs: 0,
  });

  for (const leg of execution.legs) {
    const { route } = leg;

    if (isAborted(execution.callerSignal)) {
      // The caller has stopped waiting. Continuing to walk the chain would
      // spend money on an answer nobody will read.
      break;
    }

    if (policy === "deny" && modelClassOf(route) !== configuredClass) {
      crossModelDenied = true;
      record(route, {
        ...undispatched(route),
        outcome: "skipped",
        reason: `cross-model leg denied by policy: configured model is ${configuredClass}, this leg serves ${modelClassOf(route)}`,
        failureClass: "cross_model_denied",
      });
      continue;
    }

    if (leg.params instanceof UnsupportedCapabilityError) {
      record(route, {
        ...undispatched(route),
        outcome: "skipped",
        reason: leg.params.message,
        failureClass: "unsupported_capability",
      });
      continue;
    }

    if (!breakers.allows(route.routeKey)) {
      record(route, {
        ...undispatched(route),
        outcome: "breaker-open",
        reason: breakers.refusalReason(route.routeKey),
        failureClass: "breaker_open",
      });
      continue;
    }

    const budgetMs = legBudgetMs(route.timeoutMs, execution.deadlineAtMs, now());
    if (budgetMs <= 0) {
      // The caller's deadline is spent. Dispatching now would start a call
      // that is cancelled the moment it begins, and charge nothing but noise.
      deadlineHit = true;
      record(route, {
        ...undispatched(route),
        outcome: "skipped",
        reason: "caller deadline exhausted before this leg",
        failureClass: "deadline_spent",
      });
      continue;
    }

    lastModelClass = modelClassOf(route);
    const group = await runSameModelGroup<T>(leg, budgetMs, budgetMs < route.timeoutMs, {
      request: execution,
      breakers,
      now,
      policy: execution.hedging,
      tracker: execution.latency,
      promptTokens,
      admitDuplicate: execution.admitDuplicate ?? (() => false),
      record: (attemptRoute, fields, dispatch, servedProvider) => {
        record(attemptRoute, fields, dispatch, servedProvider);
      },
      nextAttemptIndex: () => {
        const index = dispatchIndex;
        dispatchIndex += 1;
        return index;
      },
    });
    for (const usage of group.billed) {
      totalUsage = sumUsage(totalUsage, usage);
    }
    hedgeRefusals = sumHedgeRefusals(hedgeRefusals, refusalsOf(route.role, group.hedgesRefusedBelowFloor));
    deadlineHit = deadlineHit || group.deadlineBound;

    if (group.answer !== undefined) {
      const winner = attempts.find(
        (attempt) => attempt.outcome === "ok" && attempt.routeKey === group.answer?.route.routeKey,
      );
      return {
        response: group.answer.response,
        servedBy: group.answer.route,
        attempts,
        totalUsage,
        modelClassRelation: winner?.modelClassRelation ?? "unknown",
        hedged: group.answer.hedged,
        hedgesRefusedBelowFloor: hedgeRefusals,
      };
    }

    if (isAborted(execution.callerSignal)) {
      break;
    }
  }

  if (deadlineHit && !isAborted(execution.callerSignal) && execution.deadlineAtMs !== undefined) {
    throw new LlmDeadlineExceededError(
      alias,
      attempts,
      totalUsage,
      execution.deadlineAtMs - startedAt,
      lastModelClass,
      hedgeRefusals,
    );
  }
  throw new ChainExhaustedError(
    alias,
    attempts,
    totalUsage,
    crossModelDenied ? "cross_model_denied" : "exhausted",
    hedgeRefusals,
  );
}
