/**
 * Client-side rate and concurrency guards, per provider (W4-04).
 *
 * A provider's rate limit is enforced at the provider whether or not the client
 * respects it. The reason to respect it here is what a 429 means once it
 * arrives: to the fallback chain it is indistinguishable from provider
 * ill-health, so a client that over-drives a healthy provider will open that
 * provider's circuit breaker, fail over to a more expensive leg, and keep doing
 * so — converting a self-inflicted pacing problem into a permanent routing
 * change nobody chose. Pacing at the client is what keeps the breaker measuring
 * the provider rather than measuring us.
 *
 * Two distinct bounds are applied because they fail differently. The rate bound
 * (requests per minute) protects the provider's published ceiling. The
 * concurrency bound protects the caller: a hundred simultaneous in-flight
 * requests will each wait behind the other ninety-nine at the provider, so
 * every one of them blows its latency budget and the fan-out produces a hundred
 * timeouts instead of a queue.
 *
 * Limits live in `provider-limits.json`, not here. A rate limit discovered
 * during an incident should be correctable by config, not by a release.
 *
 * @module llm/rate-guard
 */

import { TokenBucketRateLimiter } from "../rate-limiter";

import limitsConfig from "./provider-limits.json";

/** Seconds in a minute, converting a published per-minute ceiling to a refill rate. */
const SECONDS_PER_MINUTE = 60;

/** One request consumes one token. */
const TOKENS_PER_REQUEST = 1;

/** Limits for one provider. */
export interface ProviderLimits {
  /** Whether these numbers were transcribed from a provider doc or chosen conservatively. */
  readonly basis: "published" | "conservative-default";
  readonly requests_per_minute: number;
  readonly max_concurrent: number;
  readonly acquire_timeout_ms: number;
  /** Where a published limit was read from. Null while the basis is a conservative default. */
  readonly source?: string | null;
  readonly note?: string;
}

/** The parsed limits config. */
interface LimitsConfig {
  readonly schema_version: number;
  readonly revised: string;
  readonly defaults: ProviderLimits;
  readonly providers: Readonly<Record<string, ProviderLimits>>;
}

const config = limitsConfig as unknown as LimitsConfig;

/**
 * Resolve the limits that apply to a provider.
 *
 * An unregistered provider falls back to the conservative defaults rather than
 * to no limit at all. Treating "unknown" as "unlimited" would make every newly
 * onboarded provider the one most likely to be over-driven, which is exactly
 * backwards: a new provider is the one whose real ceiling is least understood.
 *
 * @param provider The provider key.
 * @returns Its limits.
 */
export function limitsFor(provider: string): ProviderLimits {
  return config.providers[provider] ?? config.defaults;
}

/** Every provider with a recorded limit, plus whether it is published or a default. */
export function limitsInventory(): { provider: string; limits: ProviderLimits }[] {
  return Object.keys(config.providers)
    .sort()
    .map((provider) => ({ provider, limits: config.providers[provider] }));
}

/**
 * Thrown when a caller could not acquire a slot within its budget.
 *
 * Distinguished from a provider failure so the chain does not count it against
 * route health: the provider was never asked, so nothing was learned about it.
 */
export class RateGuardTimeoutError extends Error {
  /** The provider whose guard could not admit the call. */
  public readonly provider: string;

  /** Which of the two bounds the caller waited on. */
  public readonly bound: "rate" | "concurrency";

  /**
   * @param provider The provider.
   * @param bound Which bound was binding.
   * @param waitedMs How long the caller waited.
   */
  public constructor(provider: string, bound: "rate" | "concurrency", waitedMs: number) {
    super(
      `client-side ${bound} guard for provider "${provider}" did not admit the call within ${waitedMs} ms. ` +
        "The provider was never contacted, so this says nothing about its health.",
    );
    this.name = "RateGuardTimeoutError";
    this.provider = provider;
    this.bound = bound;
  }
}

/**
 * A counting semaphore bounding simultaneous in-flight calls.
 *
 * Written here rather than pulled from a dependency because it is fifteen lines
 * and because the waiting behaviour matters: a waiter that times out must be
 * removed from the queue, or a burst of abandoned callers permanently consumes
 * the permits that later callers need.
 */
class ConcurrencyGate {
  private inFlight = 0;

  private readonly waiters: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];

  private readonly limit: number;

  private readonly provider: string;

  /**
   * @param provider The provider this gate guards.
   * @param limit Maximum simultaneous in-flight calls.
   */
  public constructor(provider: string, limit: number) {
    this.provider = provider;
    this.limit = limit;
  }

  /**
   * Wait for a permit.
   *
   * @param timeoutMs How long the caller is willing to queue.
   * @returns A release function the caller must invoke exactly once.
   */
  public async acquire(timeoutMs: number): Promise<() => void> {
    if (this.inFlight < this.limit) {
      this.inFlight += 1;
      return () => this.release();
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
        reject(new RateGuardTimeoutError(this.provider, "concurrency", timeoutMs));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });

    this.inFlight += 1;
    return () => this.release();
  }

  /**
   * Return a permit and admit the next waiter.
   *
   * @returns void
   */
  private release(): void {
    this.inFlight -= 1;
    const next = this.waiters.shift();
    if (next !== undefined) {
      clearTimeout(next.timer);
      next.resolve();
    }
  }

  /**
   * @returns How many calls are currently in flight.
   */
  public inFlightCount(): number {
    return this.inFlight;
  }

  /**
   * @returns How many callers are queued.
   */
  public queueLength(): number {
    return this.waiters.length;
  }
}

/** Per-provider guards, created on first use and shared process-wide. */
const rateLimiters = new Map<string, TokenBucketRateLimiter>();
const concurrencyGates = new Map<string, ConcurrencyGate>();

/**
 * The rate limiter for a provider.
 *
 * Shared process-wide rather than per-call-site, because the provider's ceiling
 * applies to the process as a whole. Per-call-site limiters would each stay
 * under the ceiling while their sum sailed past it.
 *
 * @param provider The provider key.
 * @returns Its limiter.
 */
function rateLimiterFor(provider: string): TokenBucketRateLimiter {
  let limiter = rateLimiters.get(provider);
  if (limiter === undefined) {
    const limits = limitsFor(provider);
    limiter = new TokenBucketRateLimiter({
      maxTokens: limits.requests_per_minute,
      refillRate: limits.requests_per_minute / SECONDS_PER_MINUTE,
      label: `llm:${provider}`,
      timeoutMs: limits.acquire_timeout_ms,
    });
    rateLimiters.set(provider, limiter);
  }
  return limiter;
}

/**
 * The concurrency gate for a provider.
 *
 * @param provider The provider key.
 * @returns Its gate.
 */
function concurrencyGateFor(provider: string): ConcurrencyGate {
  let gate = concurrencyGates.get(provider);
  if (gate === undefined) {
    gate = new ConcurrencyGate(provider, limitsFor(provider).max_concurrent);
    concurrencyGates.set(provider, gate);
  }
  return gate;
}

/**
 * Run a call under a provider's rate and concurrency guards.
 *
 * The concurrency permit is taken AFTER the rate token. Taking it first would
 * let callers hold scarce permits while idling in the rate queue, which
 * throttles the provider twice over and turns a pacing bound into a deadlock
 * shaped like slowness.
 *
 * `maxWaitMs` bounds how long a caller may queue. It exists because the queue
 * spends the SAME budget the call itself does: a caller that waits out its whole
 * deadline in a rate queue has failed just as completely as one that waited on
 * the provider, and worse, it never reached the fallback chain that could have
 * answered it. Passing the leg's own timeout keeps one clock governing the
 * whole attempt.
 *
 * @param provider The provider key.
 * @param call The work to run once admitted.
 * @param maxWaitMs Ceiling on queue time; the configured guard timeout applies when lower.
 * @returns The call's result.
 * @throws {RateGuardTimeoutError} When neither bound admitted the call in time.
 */
export async function withProviderGuards<T>(
  provider: string,
  call: () => Promise<T>,
  maxWaitMs?: number,
): Promise<T> {
  const limits = limitsFor(provider);
  const waitBudgetMs =
    maxWaitMs === undefined
      ? limits.acquire_timeout_ms
      : Math.min(maxWaitMs, limits.acquire_timeout_ms);

  try {
    await rateLimiterFor(provider).acquire();
  } catch {
    throw new RateGuardTimeoutError(provider, "rate", waitBudgetMs);
  }

  const release = await concurrencyGateFor(provider).acquire(waitBudgetMs);
  try {
    return await call();
  } finally {
    // Released on every path. A permit leaked on the error path would shrink
    // the effective limit by one on each failure until nothing could run — and
    // failures cluster exactly when throughput matters most.
    release();
  }
}

/** Observable guard state, for dashboards and tests. */
export interface GuardSnapshot {
  readonly provider: string;
  readonly basis: ProviderLimits["basis"];
  readonly requestsPerMinute: number;
  readonly maxConcurrent: number;
  readonly inFlight: number;
  readonly rateQueueLength: number;
  readonly concurrencyQueueLength: number;
  readonly availableTokens: number;
}

/**
 * Inspect the guards currently in use.
 *
 * @returns A snapshot per provider that has been used, sorted by provider.
 */
export function guardSnapshots(): GuardSnapshot[] {
  const providers = new Set([...rateLimiters.keys(), ...concurrencyGates.keys()]);
  return [...providers].sort().map((provider) => {
    const limits = limitsFor(provider);
    const limiter = rateLimiters.get(provider);
    const gate = concurrencyGates.get(provider);
    return {
      provider,
      basis: limits.basis,
      requestsPerMinute: limits.requests_per_minute,
      maxConcurrent: limits.max_concurrent,
      inFlight: gate?.inFlightCount() ?? 0,
      rateQueueLength: limiter?.getQueueLength() ?? 0,
      concurrencyQueueLength: gate?.queueLength() ?? 0,
      availableTokens: limiter?.getAvailableTokens() ?? limits.requests_per_minute * TOKENS_PER_REQUEST,
    };
  });
}

/**
 * Discard all guard state.
 *
 * Exists so a test can start from a known position; a shared process-wide
 * limiter is otherwise carried between tests and makes their order matter.
 *
 * @returns void
 */
export function resetProviderGuards(): void {
  for (const limiter of rateLimiters.values()) {
    limiter.reset();
  }
  rateLimiters.clear();
  concurrencyGates.clear();
}
