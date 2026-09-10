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
 * The clock is injected. Breaker behaviour is entirely about elapsed time, and
 * a test that must sleep to observe a cooldown is a test nobody runs.
 *
 * @module llm/circuit-breaker
 */

import type { LlmBreakerDefaults } from "./types";

/** What the breaker will currently permit for a route. */
export type BreakerState = "closed" | "open" | "half-open";

/** Snapshot of one route's breaker, for observability and tests. */
export interface BreakerSnapshot {
  readonly routeKey: string;
  readonly state: BreakerState;
  readonly consecutiveFailures: number;
  readonly openedAtMs: number | null;
  readonly probesInFlight: number;
}

interface BreakerRecord {
  consecutiveFailures: number;
  openedAtMs: number | null;
  probesInFlight: number;
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
    return elapsed >= this.config.cooldown_ms ? "half-open" : "open";
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
   * @returns void
   */
  public onAttemptStart(routeKey: string): void {
    if (this.stateOf(routeKey) === "half-open") {
      this.recordFor(routeKey).probesInFlight += 1;
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
    this.records.set(routeKey, {
      consecutiveFailures: 0,
      openedAtMs: null,
      probesInFlight: 0,
    });
  }

  /**
   * Record a failure, opening the breaker once the threshold is reached.
   *
   * A failure while half-open re-opens immediately without waiting to
   * re-accumulate the threshold: the probe was the test, and it failed.
   *
   * @param routeKey The route's stable key.
   * @returns void
   */
  public onFailure(routeKey: string): void {
    const wasHalfOpen = this.stateOf(routeKey) === "half-open";
    const record = this.recordFor(routeKey);
    record.probesInFlight = 0;
    record.consecutiveFailures += 1;

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
    const record = this.records.get(routeKey) ?? {
      consecutiveFailures: 0,
      openedAtMs: null,
      probesInFlight: 0,
    };
    return {
      routeKey,
      state: this.stateOf(routeKey),
      consecutiveFailures: record.consecutiveFailures,
      openedAtMs: record.openedAtMs,
      probesInFlight: record.probesInFlight,
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
      record = { consecutiveFailures: 0, openedAtMs: null, probesInFlight: 0 };
      this.records.set(routeKey, record);
    }
    return record;
  }
}
