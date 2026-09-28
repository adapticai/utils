/**
 * Per-route circuit breaker for the alias client.
 *
 * A provider that has just failed five calls will almost certainly fail the
 * sixth, and every attempt spends latency budget the next leg of the chain
 * needs. The breaker converts that repeated discovery into a decision made
 * once: an unhealthy leg is skipped outright until it has had time to recover,
 * so a chain reaches its working leg quickly instead of paying the full
 * timeout of each dead one first.
 *
 * Breakers are keyed by chain POSITION, not by provider. Two consequences
 * follow, and both are intended. Reverting an alias to a different model at the
 * same position inherits that position's health rather than starting blind. And
 * an isolated route never shares a breaker with the shared one, so isolated
 * traffic can neither trip nor be tripped by traffic on the other side of the
 * PD-9 boundary.
 *
 * How long a tripped breaker stays open depends on WHY it tripped. A provider
 * that is refusing work because it is momentarily full ("model busy", 429,
 * 503, 529, or a leg that ran out its budget queued behind other traffic) is
 * shedding load it expects to take back within seconds; excluding it for a
 * full minute pushes every call onto the next leg, which is how one provider's
 * capacity blip becomes the last leg's overload. Such a run opens for the
 * shorter `capacity_cooldown_ms`. A run that contains any hard failure (a
 * rejected credential, a malformed request, an unreachable gateway, an answer
 * that does not parse) says the route is broken rather than busy, and opens
 * for the full `cooldown_ms`. Either way the route then admits a bounded number
 * of half-open probes, and one success closes it.
 *
 * The clock is injected. Breaker behaviour is entirely about elapsed time, and
 * a test that must sleep to observe a cooldown is a test nobody runs.
 *
 * @module llm/circuit-breaker
 */

import type { LlmBreakerDefaults } from "./types";

/** What the breaker will currently permit for a route. */
export type BreakerState = "closed" | "open" | "half-open";

/**
 * Why an attempt failed, as far as the breaker is concerned.
 *
 * `capacity`: the provider was reachable and declined or delayed the work
 * because it was full. Expected to clear in seconds.
 * `hard`: anything else that counts against the route's health.
 */
export type BreakerFailureKind = "capacity" | "hard";

/** Snapshot of one route's breaker, for observability and tests. */
export interface BreakerSnapshot {
  readonly routeKey: string;
  readonly state: BreakerState;
  readonly consecutiveFailures: number;
  readonly openedAtMs: number | null;
  readonly probesInFlight: number;
  /**
   * Why the current run of failures is counted: `capacity` only when every
   * failure in it was a capacity signal, `hard` once any was not, null while
   * the run is empty.
   */
  readonly failureKind: BreakerFailureKind | null;
  /** How long the breaker stays open from `openedAtMs`, given that kind. */
  readonly cooldownMs: number;
}

interface BreakerRecord {
  consecutiveFailures: number;
  openedAtMs: number | null;
  probesInFlight: number;
  /** Whether any failure in the current run was hard rather than capacity. */
  runHasHardFailure: boolean;
}

/**
 * @returns A record for a route with no failures on file.
 */
function freshRecord(): BreakerRecord {
  return {
    consecutiveFailures: 0,
    openedAtMs: null,
    probesInFlight: 0,
    runHasHardFailure: false,
  };
}

/**
 * Tracks route health and decides whether a leg may be attempted.
 */
export class CircuitBreakerRegistry {
  private readonly records = new Map<string, BreakerRecord>();

  private readonly config: LlmBreakerDefaults;

  private readonly now: () => number;

  /**
   * @param config Failure threshold, cooldown and half-open probe budget.
   * @param now Clock, injected so cooldowns are testable without waiting.
   */
  public constructor(config: LlmBreakerDefaults, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  /**
   * Current state of a route's breaker.
   *
   * The transition from open to half-open is computed from elapsed time at read
   * time rather than scheduled with a timer. A timer would keep the process
   * awake for every route that ever failed, and would drift whenever the
   * process was busy — which is exactly when a breaker matters most.
   *
   * @param routeKey The route's stable key.
   * @returns Its state.
   */
  public stateOf(routeKey: string): BreakerState {
    const record = this.records.get(routeKey);
    if (record === undefined || record.openedAtMs === null) {
      return "closed";
    }
    const elapsed = this.now() - record.openedAtMs;
    return elapsed >= this.cooldownFor(record) ? "half-open" : "open";
  }

  /**
   * The cooldown a record's current run earns.
   *
   * A run made only of capacity failures earns the capacity cooldown; one hard
   * failure anywhere in the run earns the full one. Mixed evidence is read as
   * the worse case, because a route that is both busy and broken is broken.
   * The capacity cooldown is never allowed to exceed the full one, so a
   * misconfigured table cannot make busy routes wait longer than broken ones.
   *
   * @param record The route's record.
   * @returns The cooldown in milliseconds.
   */
  private cooldownFor(record: BreakerRecord): number {
    const capacityCooldown = this.config.capacity_cooldown_ms ?? this.config.cooldown_ms;
    if (record.runHasHardFailure) {
      return this.config.cooldown_ms;
    }
    return Math.min(capacityCooldown, this.config.cooldown_ms);
  }

  /**
   * Whether a route may be attempted now.
   *
   * A half-open route admits a bounded number of probes at once. Letting the
   * whole queue through the moment a cooldown expires would re-hammer a
   * provider that is still recovering, which is how a breaker turns into a
   * synchronised retry storm.
   *
   * @param routeKey The route's stable key.
   * @returns Whether an attempt is permitted.
   */
  public allows(routeKey: string): boolean {
    const state = this.stateOf(routeKey);
    if (state === "closed") {
      return true;
    }
    if (state === "open") {
      return false;
    }
    const record = this.recordFor(routeKey);
    return record.probesInFlight < this.config.half_open_probes;
  }

  /**
   * Register that an attempt is starting, so half-open probes stay bounded.
   *
   * @param routeKey The route's stable key.
   * @returns Whether the attempt took a half-open probe slot. A caller holding
   *   one must end the attempt with {@link onSuccess}, {@link onFailure} or
   *   {@link onAttemptAbandoned}, or the slot is never returned.
   */
  public onAttemptStart(routeKey: string): boolean {
    if (this.stateOf(routeKey) === "half-open") {
      this.recordFor(routeKey).probesInFlight += 1;
      return true;
    }
    return false;
  }

  /**
   * Return a half-open probe slot whose attempt ended without a verdict.
   *
   * A probe that never tested the provider — refused by the client's own
   * pacing guard, cancelled by its caller, or found to be the wrong leg for the
   * request — says nothing about whether the route has recovered, so neither a
   * success nor a failure is recorded. The slot must still come back. Without
   * it the half-open route admits no further probe, no probe can ever close or
   * re-open the breaker, and the route stays excluded for the life of the
   * process while its traffic is quietly served by the next leg.
   *
   * @param routeKey The route's stable key.
   * @returns void
   */
  public onAttemptAbandoned(routeKey: string): void {
    const record = this.records.get(routeKey);
    if (record !== undefined && record.probesInFlight > 0) {
      record.probesInFlight -= 1;
    }
  }

  /**
   * Record a success, closing the breaker.
   *
   * A single success closes it fully rather than decrementing the failure
   * count. The breaker's question is "is this route working now", and one
   * working call answers it; requiring several would keep a recovered provider
   * excluded while the chain paid for slower legs.
   *
   * @param routeKey The route's stable key.
   * @returns void
   */
  public onSuccess(routeKey: string): void {
    this.records.set(routeKey, freshRecord());
  }

  /**
   * Record a failure, opening the breaker once the threshold is reached.
   *
   * A failure while half-open re-opens immediately without waiting to
   * re-accumulate the threshold: the probe was the test, and it failed.
   *
   * @param routeKey The route's stable key.
   * @param kind Whether the failure was a capacity signal or a hard failure.
   *   Defaults to `hard`, so a caller that cannot tell gets the longer, safer
   *   cooldown.
   * @returns void
   */
  public onFailure(routeKey: string, kind: BreakerFailureKind = "hard"): void {
    const wasHalfOpen = this.stateOf(routeKey) === "half-open";
    const record = this.recordFor(routeKey);
    record.probesInFlight = 0;
    record.consecutiveFailures += 1;
    if (kind === "hard") {
      record.runHasHardFailure = true;
    }

    if (wasHalfOpen || record.consecutiveFailures >= this.config.failure_threshold) {
      record.openedAtMs = this.now();
    }
  }

  /**
   * Inspect a route's breaker.
   *
   * @param routeKey The route's stable key.
   * @returns A snapshot.
   */
  public snapshot(routeKey: string): BreakerSnapshot {
    const record = this.records.get(routeKey) ?? freshRecord();
    return {
      routeKey,
      state: this.stateOf(routeKey),
      consecutiveFailures: record.consecutiveFailures,
      openedAtMs: record.openedAtMs,
      probesInFlight: record.probesInFlight,
      failureKind:
        record.consecutiveFailures === 0
          ? null
          : record.runHasHardFailure
            ? "hard"
            : "capacity",
      cooldownMs: this.cooldownFor(record),
    };
  }

  /**
   * Every route the registry has observed.
   *
   * @returns Snapshots, sorted by route key for stable output.
   */
  public snapshotAll(): BreakerSnapshot[] {
    return [...this.records.keys()]
      .sort()
      .map((routeKey) => this.snapshot(routeKey));
  }

  /**
   * Discard all breaker state.
   *
   * @returns void
   */
  public reset(): void {
    this.records.clear();
  }

  /**
   * @param routeKey The route's stable key.
   * @returns The mutable record, created on first use.
   */
  private recordFor(routeKey: string): BreakerRecord {
    let record = this.records.get(routeKey);
    if (record === undefined) {
      record = freshRecord();
      this.records.set(routeKey, record);
    }
    return record;
  }
}
