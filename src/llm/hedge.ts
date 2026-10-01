/**
 * Same-model attempts for one leg: hedging, measured attempt timeouts, and
 * reserving deadline for a same-model alternative.
 *
 * A leg is a model. Before the chain gives up on it and reaches a DIFFERENT
 * model — which changes the answer's quality, not just its latency — it is
 * worth spending the leg's budget on every way of getting that same model to
 * answer: the same model at another provider (an "equivalent"), or a second
 * request to the same provider when that provider has capacity to spare (a
 * "duplicate"). This module runs those attempts as one group.
 *
 * Three mechanics, all bounded by the leg's budget and none of them selecting
 * a different model:
 *
 * - **Hedging.** Once an attempt has run past the model's healthy p90 (from
 *   the latency tracker), the next same-model attempt starts beside it. The
 *   first answer wins and every other attempt is cancelled through its own
 *   abort signal. A hedge that loses, or an attempt cancelled because another
 *   won, says nothing about the provider and never touches its breaker.
 *
 * - **Measured attempt timeout.** With latency evidence, an attempt that has
 *   run past `k × p99` of healthy latency is replaced by a same-model
 *   alternative instead of holding the budget to its end. It is replaced only
 *   when an alternative exists: with none, cutting it short would only move
 *   the call to a different model sooner, and it runs to the leg budget as
 *   before.
 *
 * - **Deadline reservation.** When a same-model equivalent exists, no single
 *   attempt holds more than `max_attempt_share` of the remaining budget before
 *   the equivalent starts beside it, so a slow first attempt cannot consume the
 *   whole deadline while the equivalent that could have answered never runs.
 *
 * With no latency evidence and no equivalent, none of the three can act and
 * the group is exactly one attempt with the leg's full budget: the serial
 * chain's behaviour, which a fresh process therefore starts from.
 *
 * Every extra attempt shares the leg's end, so one started late gets only what
 * is left of the leg. None starts with less than the attempt floor
 * (`attempt_timeout_floor_ms`) remaining: the floor is the shortest attempt the
 * chain ever allows, and an attempt given less cannot be expected to answer —
 * it only sends the provider a full prompt whose answer nobody can use. The
 * leg's first attempt is the leg itself and keeps whatever budget the leg has.
 * Each refusal is counted, so the work not sent is observable.
 *
 * @module llm/hedge
 */

import type { CircuitBreakerRegistry } from "./circuit-breaker";
import {
  AttemptSupersededError,
  HedgeLoserError,
  billedUsageOf,
  classify,
  isAborted,
  startAttempt,
} from "./leg-attempt";
import type { AttemptHandle, AttemptRequest, ChainLeg } from "./leg-attempt";
import type { LegLatencyTracker } from "./leg-latency-tracker";
import { ToolChoiceIgnoredError, UnsupportedCapabilityError } from "./param-matrix";
import type {
  AliasAttemptRecord,
  LlmAttemptFailureClass,
  LlmHedgingDefaults,
  LlmTransportResponse,
  LlmUsageRecord,
  ResolvedRoute,
} from "./types";

/** Same-model controls, read from the route table's `hedging` defaults. */
export interface SameModelPolicy {
  readonly maxExtraAttempts: number;
  readonly hedgeQuantile: number;
  readonly timeoutQuantile: number;
  readonly kTimeout: number;
  readonly attemptTimeoutFloorMs: number;
  readonly maxAttemptShare: number;
  readonly duplicateReserve: number;
}

/**
 * Read the policy from the table's defaults.
 *
 * @param defaults The `hedging` defaults.
 * @returns The policy.
 */
export function sameModelPolicyFrom(defaults: LlmHedgingDefaults): SameModelPolicy {
  return {
    maxExtraAttempts: defaults.max_same_model_hedges,
    hedgeQuantile: defaults.hedge_quantile,
    timeoutQuantile: defaults.timeout_quantile,
    kTimeout: defaults.k_timeout,
    attemptTimeoutFloorMs: defaults.attempt_timeout_floor_ms,
    maxAttemptShare: defaults.max_attempt_share,
    duplicateReserve: defaults.duplicate_headroom_reserve,
  };
}

/** What a producer supplies for any attempt, answered or not. */
type AttemptCommonFields = Omit<
  AliasAttemptRecord,
  | "outcome"
  | "failureClass"
  | "servedProvider"
  | "modelClass"
  | "modelClassRelation"
  | "hedged"
  | "attemptIndex"
>;

/**
 * The fields of one attempt record as its producer supplies them; the chain
 * adds provenance.
 *
 * A union on the outcome, so an attempt that did not answer cannot be recorded
 * without its typed cause and one that answered cannot carry one. The public
 * record leaves the cause optional for consumers' own doubles; every record
 * this client produces goes through this type instead.
 */
export type AttemptFields =
  | (AttemptCommonFields & { readonly outcome: "ok"; readonly failureClass?: never })
  | (AttemptCommonFields & {
      readonly outcome: Exclude<AliasAttemptRecord["outcome"], "ok">;
      readonly failureClass: LlmAttemptFailureClass;
    });

/** What the group needs from the chain around it. */
export interface SameModelGroupContext {
  readonly request: AttemptRequest;
  readonly breakers: CircuitBreakerRegistry;
  readonly now: () => number;
  /** Absent: no hedging, no measured timeouts — one attempt with the full budget. */
  readonly policy?: SameModelPolicy;
  readonly tracker?: LegLatencyTracker;
  readonly promptTokens: number | null;
  readonly admitDuplicate: (route: ResolvedRoute, reserveFraction: number) => boolean;
  /** Record one settled attempt. `servedProvider` is the provider's own report, if any. */
  readonly record: (
    route: ResolvedRoute,
    fields: AttemptFields,
    dispatch: { readonly hedged: boolean; readonly attemptIndex: number },
    servedProvider: string | null | undefined,
  ) => void;
  /** The next zero-based dispatch index across the whole call. */
  readonly nextAttemptIndex: () => number;
}

/** How a group ended. */
export interface SameModelGroupResult<T> {
  readonly answer?: {
    readonly response: LlmTransportResponse<T>;
    readonly route: ResolvedRoute;
    readonly hedged: boolean;
  };
  /** Usage billed by every attempt in the group, answered or not. */
  readonly billed: readonly LlmUsageRecord[];
  /** Whether the group ended because the caller's deadline ran out. */
  readonly deadlineBound: boolean;
  /**
   * Extra same-model attempts this group did not start because less than the
   * attempt floor of its budget remained when one was due: 0 or 1, since once
   * the remaining budget is below the floor no later extra attempt can start.
   */
  readonly hedgesRefusedBelowFloor: number;
}

/** An attempt the group is running. */
interface LiveAttempt<T> {
  readonly leg: ChainLeg;
  readonly handle: AttemptHandle<T>;
  readonly startedAt: number;
  readonly budgetMs: number;
  readonly holdsProbe: boolean;
  readonly hedged: boolean;
  readonly attemptIndex: number;
  softTimer?: ReturnType<typeof setTimeout>;
  /** Already recorded (a cancelled loser); its eventual settlement is ignored. */
  closed: boolean;
}

/** The next same-model attempt the group could start. */
interface Candidate {
  readonly leg: ChainLeg;
  readonly kind: "equivalent" | "duplicate";
  /** Index into the equivalents, for an equivalent. */
  readonly index: number;
}

/**
 * The parameters of a prepared leg, when it can serve.
 *
 * @param leg The leg.
 * @returns Its parameters, or undefined when it cannot serve this request.
 */
function paramsOf(leg: ChainLeg): Record<string, unknown> | undefined {
  return leg.params instanceof UnsupportedCapabilityError ? undefined : leg.params;
}

/**
 * Every candidate kind may start.
 *
 * @returns Always true.
 */
function anyCandidate(): boolean {
  return true;
}

/**
 * Only a same-model equivalent may start: after a fast failure a duplicate on
 * the provider that just failed would most likely fail the same way.
 *
 * @param candidate The candidate.
 * @returns Whether it is an equivalent.
 */
function isEquivalent(candidate: Candidate): boolean {
  return candidate.kind === "equivalent";
}

/**
 * Run every same-model attempt for one leg until one answers or the budget,
 * the alternatives, or the caller run out.
 *
 * The caller has already found the leg servable (breaker allows it, budget
 * positive). The returned promise settles only once every attempt it started
 * has been recorded, so the call's attempt record is complete when it returns.
 *
 * @param leg The leg, with its equivalents.
 * @param groupBudgetMs The leg's budget: its route budget cut to the deadline.
 * @param budgetIsDeadline Whether that budget was cut by the caller's deadline.
 * @param ctx The chain around the group.
 * @returns How the group ended.
 */
export function runSameModelGroup<T>(
  leg: ChainLeg,
  groupBudgetMs: number,
  budgetIsDeadline: boolean,
  ctx: SameModelGroupContext,
): Promise<SameModelGroupResult<T>> {
  const { breakers, now, policy, tracker, promptTokens, request } = ctx;
  const endsAt = now() + groupBudgetMs;
  const equivalents = (leg.equivalents ?? []).filter((equivalent) => paramsOf(equivalent) !== undefined);
  const live = new Set<LiveAttempt<T>>();
  const billed: LlmUsageRecord[] = [];
  const timeoutCharged = new Set<string>();
  let nextEquivalent = 0;
  let extraLaunched = 0;
  let settled = false;
  let finished = false;
  let deadlineBound = false;
  let refusedBelowFloor = false;
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
  let answer: SameModelGroupResult<T>["answer"];

  return new Promise<SameModelGroupResult<T>>((resolve) => {
    /**
     * A healthy-latency quantile for a leg's model, when there is evidence.
     *
     * @param route The leg's route.
     * @param q The quantile.
     * @returns Milliseconds, or null.
     */
    const quantileOf = (route: ResolvedRoute, q: number): number | null =>
      tracker === undefined ? null : tracker.quantile(route.providerName, route.modelId, promptTokens, q);

    /**
     * The next same-model attempt the group has: an equivalent first, then a
     * duplicate, which needs latency evidence and spare provider capacity.
     * Whether there is still time for it is {@link peek}'s question.
     *
     * @returns The candidate, or undefined.
     */
    const nextCandidate = (): Candidate | undefined => {
      if (policy === undefined || extraLaunched >= policy.maxExtraAttempts) {
        return undefined;
      }
      for (let index = nextEquivalent; index < equivalents.length; index += 1) {
        const equivalent = equivalents[index];
        if (breakers.allows(equivalent.route.routeKey)) {
          return { leg: equivalent, kind: "equivalent", index };
        }
      }
      if (
        quantileOf(leg.route, policy.hedgeQuantile) !== null &&
        breakers.allows(leg.route.routeKey) &&
        ctx.admitDuplicate(leg.route, policy.duplicateReserve)
      ) {
        return { leg, kind: "duplicate", index: -1 };
      }
      return undefined;
    };

    /**
     * The same-model attempt that may start now, if any.
     *
     * None may start with less than the attempt floor of the leg's budget
     * left: it would end at the leg's end with less time than the shortest
     * attempt the chain allows. Every path that starts an extra attempt asks
     * here, so the hedge point, the measured timeout and the failover after a
     * fast failure all hold to the floor. A refusal of an attempt that would
     * otherwise have started is recorded — not one whose leg is already spent,
     * nor one whose caller has gone, since neither could have started anyway.
     *
     * @param eligible Which candidate kinds the asking path would start.
     * @returns The candidate to start, or undefined.
     */
    const peek = (eligible: (candidate: Candidate) => boolean = anyCandidate): Candidate | undefined => {
      const candidate = nextCandidate();
      if (policy === undefined || candidate === undefined || !eligible(candidate)) {
        return undefined;
      }
      const remainingMs = endsAt - now();
      if (remainingMs < policy.attemptTimeoutFloorMs) {
        if (remainingMs > 0 && !isAborted(request.callerSignal)) {
          refusedBelowFloor = true;
        }
        return undefined;
      }
      return candidate;
    };

    /** Resolve once nothing is left in flight. */
    const finishIfIdle = (): void => {
      if (finished || live.size > 0) {
        return;
      }
      finished = true;
      if (hedgeTimer !== undefined) {
        clearTimeout(hedgeTimer);
      }
      resolve({ answer, billed, deadlineBound, hedgesRefusedBelowFloor: refusedBelowFloor ? 1 : 0 });
    };

    /**
     * Arm the hedge for the most recent attempt: at the model's healthy p90,
     * or — when an equivalent is waiting — no later than the reserved share of
     * the remaining budget.
     *
     * The timer is armed even when the hedge point leaves less than the floor,
     * and the floor is applied when it fires: only then is it known whether the
     * group is still waiting and a same-model attempt is still available, and
     * so whether an attempt was actually refused rather than never needed.
     *
     * @param latest The attempt just started.
     */
    const scheduleHedge = (latest: LiveAttempt<T>): void => {
      if (hedgeTimer !== undefined) {
        clearTimeout(hedgeTimer);
        hedgeTimer = undefined;
      }
      const candidate = nextCandidate();
      if (policy === undefined || candidate === undefined) {
        return;
      }
      const measured = quantileOf(latest.leg.route, policy.hedgeQuantile);
      const reserved =
        candidate.kind === "equivalent"
          ? policy.maxAttemptShare * (endsAt - now())
          : Number.POSITIVE_INFINITY;
      const delay = Math.min(measured ?? Number.POSITIVE_INFINITY, reserved);
      if (!Number.isFinite(delay)) {
        return;
      }
      hedgeTimer = setTimeout(() => {
        hedgeTimer = undefined;
        if (settled) {
          return;
        }
        const next = peek();
        if (next !== undefined) {
          launch(next.leg, next, true);
        }
      }, Math.max(0, delay));
    };

    /**
     * Start one attempt.
     *
     * @param target The leg to address.
     * @param candidate The candidate it came from, for a hedge.
     * @param hedged Whether this is a hedge rather than the leg's first attempt.
     * @returns Whether it started.
     */
    const launch = (target: ChainLeg, candidate: Candidate | undefined, hedged: boolean): boolean => {
      const params = paramsOf(target);
      const budgetMs = endsAt - now();
      if (params === undefined || budgetMs <= 0 || isAborted(request.callerSignal)) {
        return false;
      }
      if (candidate !== undefined) {
        extraLaunched += 1;
        if (candidate.kind === "equivalent") {
          nextEquivalent = candidate.index + 1;
        }
      }
      const key = target.route.routeKey;
      const attempt: LiveAttempt<T> = {
        leg: target,
        handle: startAttempt<T>(target, params, request, budgetMs),
        startedAt: now(),
        budgetMs,
        holdsProbe: breakers.onAttemptStart(key),
        hedged,
        attemptIndex: ctx.nextAttemptIndex(),
        closed: false,
      };
      live.add(attempt);

      if (policy !== undefined) {
        const tail = quantileOf(target.route, policy.timeoutQuantile);
        if (tail !== null) {
          const measuredMs = Math.max(policy.attemptTimeoutFloorMs, policy.kTimeout * tail);
          if (measuredMs < budgetMs) {
            attempt.softTimer = setTimeout(() => supersede(attempt, measuredMs), measuredMs);
          }
        }
      }
      scheduleHedge(attempt);
      attempt.handle.promise.then(
        (response) => onAnswer(attempt, response),
        (error: unknown) => onFailure(attempt, error),
      );
      return true;
    };

    /**
     * An attempt ran past its measured timeout: replace it if a same-model
     * alternative can take over, otherwise leave it running to the leg budget.
     *
     * @param attempt The slow attempt.
     * @param afterMs Its measured timeout.
     */
    const supersede = (attempt: LiveAttempt<T>, afterMs: number): void => {
      attempt.softTimer = undefined;
      if (settled || !live.has(attempt)) {
        return;
      }
      const othersInFlight = live.size > 1;
      const candidate = othersInFlight ? undefined : peek();
      if (!othersInFlight && candidate === undefined) {
        return;
      }
      // Recorded now rather than when its rejection arrives, so a replacement
      // that answers first cannot find it still live and misfile it as a loser.
      const superseded = new AttemptSupersededError(attempt.leg.route.routeKey, afterMs);
      close(attempt, superseded);
      if (candidate !== undefined) {
        launch(candidate.leg, candidate, true);
      }
      finishIfIdle();
    };

    /**
     * Cancel an attempt the chain no longer wants and record it at once, with
     * no verdict on the provider.
     *
     * @param attempt The attempt.
     * @param reason Why it was cancelled.
     */
    const close = (attempt: LiveAttempt<T>, reason: AttemptSupersededError | HedgeLoserError): void => {
      const fields = baseFields(attempt);
      attempt.handle.abort(reason);
      attempt.closed = true;
      retire(attempt);
      if (attempt.holdsProbe) {
        breakers.onAttemptAbandoned(attempt.leg.route.routeKey);
      }
      const failure = classify(reason, request.callerSignal);
      emit(attempt, {
        ...fields,
        outcome: failure.outcome,
        reason: failure.reason,
        failureClass: failure.failureClass,
      });
    };

    /**
     * Stop tracking an attempt and release its breaker bookkeeping.
     *
     * @param attempt The attempt.
     */
    const retire = (attempt: LiveAttempt<T>): void => {
      if (attempt.softTimer !== undefined) {
        clearTimeout(attempt.softTimer);
        attempt.softTimer = undefined;
      }
      live.delete(attempt);
      breakers.onAttemptEnd(attempt.leg.route.routeKey);
    };

    /**
     * Record one attempt through the chain.
     *
     * @param attempt The attempt.
     * @param fields What happened.
     * @param servedProvider The provider's own report of who served, if any.
     */
    const emit = (
      attempt: LiveAttempt<T>,
      fields: AttemptFields,
      servedProvider?: string | null,
    ): void => {
      ctx.record(
        attempt.leg.route,
        fields,
        { hedged: attempt.hedged, attemptIndex: attempt.attemptIndex },
        servedProvider,
      );
    };

    /**
     * Base fields shared by every record of an attempt.
     *
     * @param attempt The attempt.
     * @returns The identity and timing fields.
     */
    const baseFields = (
      attempt: LiveAttempt<T>,
    ): Pick<AttemptFields, "routeKey" | "role" | "provider" | "modelId" | "durationMs" | "budgetMs"> => ({
      routeKey: attempt.leg.route.routeKey,
      role: attempt.leg.route.role,
      provider: attempt.leg.route.providerName,
      modelId: attempt.leg.route.modelId,
      durationMs: now() - attempt.startedAt,
      budgetMs: attempt.budgetMs,
    });

    const onAnswer = (attempt: LiveAttempt<T>, response: LlmTransportResponse<T>): void => {
      if (attempt.closed) {
        return;
      }
      const { route } = attempt.leg;
      const fields = baseFields(attempt);
      retire(attempt);
      breakers.onSuccess(route.routeKey, attempt.startedAt);
      breakers.onLatencySample(route.routeKey, fields.durationMs, route.latencyClass);
      tracker?.record(route.providerName, route.modelId, promptTokens, fields.durationMs);
      billed.push(response.usage);

      if (settled) {
        // Answered in the same instant as the winner, before its cancellation
        // arrived. Its spend is real; its answer is not the one returned.
        emit(
          attempt,
          {
            ...fields,
            outcome: "skipped",
            reason: "answered after a same-model attempt had already won",
            failureClass: "hedge_loser",
            servedModel: response.servedModel ?? null,
            usage: response.usage,
          },
          response.servedProvider,
        );
        finishIfIdle();
        return;
      }

      settled = true;
      answer = { response, route, hedged: attempt.hedged };
      emit(
        attempt,
        {
          ...fields,
          outcome: "ok",
          servedModel: response.servedModel ?? null,
          usage: response.usage,
        },
        response.servedProvider,
      );
      for (const loser of [...live]) {
        // Cancelled through its own signal and recorded now, so the answer is
        // returned without waiting for a loser still queued at the provider.
        close(loser, new HedgeLoserError(loser.leg.route.routeKey));
      }
      finishIfIdle();
    };

    const onFailure = (attempt: LiveAttempt<T>, error: unknown): void => {
      if (attempt.closed) {
        return;
      }
      const { route } = attempt.leg;
      const key = route.routeKey;
      const fields = baseFields(attempt);
      const hardTimeout = attempt.handle.timedOut();
      retire(attempt);

      const failure = classify(attempt.handle.abortReason() ?? error, request.callerSignal);
      let charged = failure.countsAgainstHealth;
      if (charged && hardTimeout) {
        // Every attempt of a leg shares the leg's end, so several can time out
        // together; the provider is charged once for the leg, as before hedging.
        charged = !timeoutCharged.has(key);
        timeoutCharged.add(key);
        if (budgetIsDeadline) {
          deadlineBound = true;
        }
      }
      if (charged) {
        breakers.onFailure(key, failure.failureKind);
      } else if (attempt.holdsProbe) {
        // No verdict on the route's health, but the probe slot this attempt
        // took must come back, or a half-open route admits no probe ever again.
        breakers.onAttemptAbandoned(key);
      }
      if (failure.countsAgainstHealth) {
        breakers.onLatencySample(key, fields.durationMs, route.latencyClass);
      }

      // A provider that answered — with unparseable content, or in prose where a
      // tool call was mandatory — still billed for the answer.
      const usage = billedUsageOf(error);
      if (usage !== undefined) {
        billed.push(usage);
      }
      const answeredBy = error instanceof ToolChoiceIgnoredError ? error.servedModel : undefined;
      emit(attempt, {
        ...fields,
        outcome: failure.outcome,
        reason: failure.reason,
        failureClass: failure.failureClass,
        ...(answeredBy === undefined ? {} : { servedModel: answeredBy }),
        ...(usage === undefined ? {} : { usage }),
      });

      if (settled || live.size > 0) {
        finishIfIdle();
        return;
      }
      if (!hardTimeout && !isAborted(request.callerSignal)) {
        // A failed attempt with time left moves to the same model at another
        // provider at once. A duplicate on the provider that just failed is not
        // started here: it would most likely fail the same way.
        const candidate = peek(isEquivalent);
        if (candidate !== undefined) {
          launch(candidate.leg, candidate, true);
        }
      }
      finishIfIdle();
    };

    if (!launch(leg, undefined, false)) {
      finishIfIdle();
    }
  });
}
