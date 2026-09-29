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
 * A route can also be opened by LATENCY (when `latency_trip` is armed): a
 * provider whose answers arrive, but later than the latency class's objective
 * in most recent windows, is failing a hot path without ever producing an
 * error. A latency-opened breaker is not closed by an answer from an attempt
 * that started before it opened, because such an answer is exactly the slow
 * evidence that opened it.
 *
 * The half-open probe budget scales with how much traffic the route carried
 * before it opened (`probe_fraction`), so a route that served forty calls at
 * once is not re-tested by a single probe whose one slow answer decides it.
 *
 * The clock is injected. Breaker behaviour is entirely about elapsed time, and
 * a test that must sleep to observe a cooldown is a test nobody runs.
 *
 * @module llm/circuit-breaker
 */

import { nearestRank } from "./leg-latency-tracker";
import type { LlmBreakerDefaults, LlmLatencyClass } from "./types";

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
  /** Whether the current open was caused by latency rather than failures. */
  readonly openedByLatency: boolean;
  /** Half-open probes admitted at once. */
  readonly probeBudget: number;
}

interface BreakerRecord {
  consecutiveFailures: number;
  openedAtMs: number | null;
  probesInFlight: number;
  /** Whether any failure in the current run was hard rather than capacity. */
  runHasHardFailure: boolean;
  /** Whether the current open was caused by the latency trip. */
  openedByLatency: boolean;
  /** Peak concurrent attempts observed before the breaker last opened. */
  concurrencyAtOpen: number;
}

/** Latency-trip state, kept apart from the failure record so a success does not erase it. */
interface LatencyRecord {
  samples: number[];
  /** Whether each recent completed window exceeded the objective, oldest first. */
  verdicts: boolean[];
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
    openedByLatency: false,
    concurrencyAtOpen: 0,
  };
}

/**
 * Tracks route health and decides whether a leg may be attempted.
 */
export class CircuitBreakerRegistry {
  private readonly records = new Map<string, BreakerRecord>();

  private readonly latency = new Map<string, LatencyRecord>();

  /** Attempts currently in flight per route, for scaling the probe budget. */
  private readonly inFlight = new Map<string, number>();

  /** Peak of {@link inFlight} since the route last opened. */
  private readonly peakInFlight = new Map<string, number>();

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
    return record.probesInFlight < this.probeBudgetFor(record);
  }

  /**
   * How many half-open probes a route admits at once.
   *
   * @param record The route's record.
   * @returns The larger of the configured floor and the concurrency-scaled budget.
   */
  private probeBudgetFor(record: BreakerRecord): number {
    const fraction = this.config.probe_fraction;
    if (fraction === undefined || fraction <= 0) {
      return this.config.half_open_probes;
    }
    return Math.max(
      this.config.half_open_probes,
      Math.ceil(fraction * record.concurrencyAtOpen),
    );
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
    const inFlight = (this.inFlight.get(routeKey) ?? 0) + 1;
    this.inFlight.set(routeKey, inFlight);
    this.peakInFlight.set(routeKey, Math.max(this.peakInFlight.get(routeKey) ?? 0, inFlight));
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
   * Mark an attempt started with {@link onAttemptStart} as finished, whatever
   * its outcome, so the in-flight count that scales the probe budget stays true.
   *
   * @param routeKey The route's stable key.
   * @returns void
   */
  public onAttemptEnd(routeKey: string): void {
    const inFlight = this.inFlight.get(routeKey) ?? 0;
    this.inFlight.set(routeKey, Math.max(0, inFlight - 1));
  }

  /**
   * Record a success, closing the breaker.
   *
   * A single success closes it fully rather than decrementing the failure
   * count. The breaker's question is "is this route working now", and one
   * working call answers it; requiring several would keep a recovered provider
   * excluded while the chain paid for slower legs.
   *
   * The one exception is a breaker opened by latency: an answer from an
   * attempt that started before it opened is the slow evidence that opened it,
   * not evidence of recovery, and is ignored.
   *
   * @param routeKey The route's stable key.
   * @param startedAtMs When the answering attempt started, on the registry's clock.
   * @returns void
   */
  public onSuccess(routeKey: string, startedAtMs?: number): void {
    const record = this.records.get(routeKey);
    if (
      record !== undefined &&
      record.openedByLatency &&
      record.openedAtMs !== null &&
      startedAtMs !== undefined &&
      startedAtMs < record.openedAtMs
    ) {
      return;
    }
    this.records.set(routeKey, freshRecord());
  }

  /**
   * Record how long an attempt that reached the provider took.
   *
   * Durations fill fixed-size windows; each full window is judged against the
   * latency class's objective at the configured quantile, and the breaker opens
   * when enough of the recent windows were over it. Does nothing unless the
   * latency trip is armed.
   *
   * @param routeKey The route's stable key.
   * @param durationMs The attempt's duration.
   * @param latencyClass The alias's latency class, which selects the objective.
   * @returns void
   */
  public onLatencySample(
    routeKey: string,
    durationMs: number,
    latencyClass: LlmLatencyClass | undefined,
  ): void {
    const trip = this.config.latency_trip;
    if (trip === undefined || !trip.enabled || latencyClass === undefined) {
      return;
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    let state = this.latency.get(routeKey);
    if (state === undefined) {
      state = { samples: [], verdicts: [] };
      this.latency.set(routeKey, state);
    }
    state.samples.push(durationMs);
    if (state.samples.length < trip.window_size) {
      return;
    }
    const sorted = [...state.samples].sort((a, b) => a - b);
    state.samples = [];
    state.verdicts.push(nearestRank(sorted, trip.quantile) > trip.slo_ms[latencyClass]);
    while (state.verdicts.length > trip.of_windows) {
      state.verdicts.shift();
    }
    const over = state.verdicts.filter(Boolean).length;
    if (over >= trip.trip_windows && this.stateOf(routeKey) === "closed") {
      const record = this.recordFor(routeKey);
      this.open(routeKey, record);
      record.openedByLatency = true;
      state.verdicts = [];
    }
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
      this.open(routeKey, record);
      record.openedByLatency = false;
    }
  }

  /**
   * Open a route, capturing the concurrency its probe budget scales with.
   *
   * @param routeKey The route's stable key.
   * @param record Its record.
   * @returns void
   */
  private open(routeKey: string, record: BreakerRecord): void {
    record.openedAtMs = this.now();
    record.concurrencyAtOpen = Math.max(
      record.concurrencyAtOpen,
      this.peakInFlight.get(routeKey) ?? 0,
    );
    this.peakInFlight.set(routeKey, this.inFlight.get(routeKey) ?? 0);
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
      openedByLatency: record.openedByLatency,
      probeBudget: this.probeBudgetFor(record),
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
    this.latency.clear();
    this.inFlight.clear();
    this.peakInFlight.clear();
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
