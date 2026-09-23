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
 * the provider rather than measuring us. The same reasoning bounds the guard
 * from the other side: a client held far BELOW the provider's ceiling refuses
 * calls the provider would have served, and the chain answers those refusals by
 * failing over — the same unchosen routing change, arrived at by under-driving.
 *
 * Two distinct bounds are applied because they fail differently. The rate bound
 * (requests per minute) protects the provider's published ceiling. The
 * concurrency bound protects the caller: a hundred simultaneous in-flight
 * requests will each wait behind the other ninety-nine at the provider, so
 * every one of them blows its latency budget and the fan-out produces a hundred
 * timeouts instead of a queue.
 *
 * Each guard is keyed by the unit its provider enforces limits in. A provider
 * that publishes its ceilings per model gets one independent guard per model.
 * Sharing one guard across its models would enforce a ceiling the provider does
 * not impose, and — when a chain's primary and secondary are served by the same
 * provider — would refuse the secondary at exactly the moment the primary's
 * queue is full, so the fallback that exists for that moment is never reached.
 *
 * Limits live in `provider-limits.json` rather than in code, each beside the
 * source it was transcribed from, so a published ceiling and a conservative
 * guess can never be mistaken for one another in review. The file is bundled
 * at build time: changing a limit is a release of this package, not a runtime
 * switch.
 *
 * @module llm/rate-guard
 */

import { TokenBucketRateLimiter } from "../rate-limiter";

import limitsConfig from "./provider-limits.json";

/** Seconds in a minute, converting a published per-minute ceiling to a refill rate. */
const SECONDS_PER_MINUTE = 60;

/** One request consumes one token. */
const TOKENS_PER_REQUEST = 1;

/** Where a limit came from: a provider's documented ceiling, or a deliberate under-estimate of an unknown one. */
export type ProviderLimitBasis = "published" | "conservative-default";

/**
 * The unit a provider enforces its limits in.
 *
 * `model` means each of the provider's models has its own ceilings, so the
 * client keeps one guard per model; `provider` means one guard covers every
 * model the provider serves.
 */
export type ProviderLimitScope = "provider" | "model";

/** Limits for one provider. */
export interface ProviderLimits {
  /** Whether these numbers were transcribed from a provider doc or chosen conservatively. */
  readonly basis: ProviderLimitBasis;
  /** The unit the provider enforces its limits in. Absent means `provider`. */
  readonly scope?: ProviderLimitScope;
  /**
   * Where a per-model scope was read from, when the entry's numbers are not
   * themselves published. The unit is a claim about the provider and carries
   * the same burden of proof as a number.
   */
  readonly scope_source?: string | null;
  readonly requests_per_minute: number;
  /**
   * Provenance of `requests_per_minute` when it differs from `basis`. A provider
   * can publish a concurrency ceiling and no per-minute ceiling at all; the
   * per-minute number is then the client's own choice and must not borrow the
   * published label of the bound that was transcribed.
   */
  readonly requests_per_minute_basis?: ProviderLimitBasis;
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

/** Which guard a call is held by, and how its caller can stop waiting. */
export interface GuardCallScope {
  /**
   * The model the call is addressed to. Selects the guard for a provider whose
   * limits apply per model; ignored for a provider whose limits apply per
   * provider.
   */
  readonly modelId?: string;
  /**
   * The caller's cancellation. A caller that stops waiting leaves the queue at
   * once rather than holding its place until its wait budget runs out, and a
   * permit freed after it has gone goes to a caller that is still waiting.
   */
  readonly signal?: AbortSignal;
}

/** What a refusal says about the call it refused. */
interface RefusalDetail {
  /** The model whose guard refused the call, for a provider whose limits apply per model. */
  readonly modelId?: string;
  /** Whether the caller stopped waiting before the guard's own budget ran out. */
  readonly abandoned?: boolean;
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

  /** The model whose guard refused the call, when the provider's limits apply per model. */
  public readonly modelId: string | undefined;

  /** Whether the caller stopped waiting before the guard's own wait budget ran out. */
  public readonly abandoned: boolean;

  /**
   * @param provider The provider.
   * @param bound Which bound was binding.
   * @param waitedMs How long the caller was prepared to wait.
   * @param detail The model, and whether the caller left before the budget ran out.
   */
  public constructor(
    provider: string,
    bound: "rate" | "concurrency",
    waitedMs: number,
    detail: RefusalDetail = {},
  ) {
    const guard =
      detail.modelId === undefined
        ? `client-side ${bound} guard for provider "${provider}"`
        : `client-side ${bound} guard for provider "${provider}", model "${detail.modelId}",`;
    const outcome =
      detail.abandoned === true
        ? `was left by its caller before it could admit the call (wait budget ${waitedMs} ms)`
        : `did not admit the call within ${waitedMs} ms`;
    super(
      `${guard} ${outcome}. ` +
        "The provider was never contacted, so this says nothing about its health.",
    );
    this.name = "RateGuardTimeoutError";
    this.provider = provider;
    this.bound = bound;
    this.modelId = detail.modelId;
    this.abandoned = detail.abandoned === true;
  }
}

/** Identity of one guard: its provider, and its model when that provider's limits apply per model. */
interface GuardIdentity {
  readonly key: string;
  readonly provider: string;
  readonly modelId: string | undefined;
}

/**
 * The guard a call is held by.
 *
 * A call to a per-model provider that names no model shares one provider-wide
 * guard held at the per-model ceiling. That is never looser than the limit of
 * any single model it might reach, so the fallback errs toward pacing.
 *
 * @param provider The provider key.
 * @param modelId The model the call is addressed to, if known.
 * @returns The guard's identity.
 */
function guardIdentity(provider: string, modelId: string | undefined): GuardIdentity {
  const perModel =
    limitsFor(provider).scope === "model" && modelId !== undefined && modelId.length > 0;
  return perModel
    ? { key: `${provider}/${modelId}`, provider, modelId }
    : { key: provider, provider, modelId: undefined };
}

/** A caller queued for a concurrency permit. */
interface GateWaiter {
  /** Hands the waiter a permit released by a finishing call. */
  readonly admit: () => void;
}

/**
 * A counting semaphore bounding simultaneous in-flight calls.
 *
 * Written here rather than pulled from a dependency because the waiting
 * behaviour is the point. A waiter that times out must be removed from the
 * queue, or a burst of abandoned callers permanently consumes the permits that
 * later callers need. And a waiter whose caller has stopped waiting must leave
 * at once: left queued, it holds its caller until the wait budget expires and
 * is then handed a permit it can only waste.
 */
class ConcurrencyGate {
  private inFlight = 0;

  private readonly waiters: GateWaiter[] = [];

  private readonly limit: number;

  private readonly identity: GuardIdentity;

  /**
   * @param identity The guard this gate implements.
   * @param limit Maximum simultaneous in-flight calls.
   */
  public constructor(identity: GuardIdentity, limit: number) {
    this.identity = identity;
    this.limit = limit;
  }

  /**
   * Wait for a permit.
   *
   * @param timeoutMs How long the caller is willing to queue.
   * @param signal The caller's cancellation; firing it takes the caller out of the queue.
   * @returns A release function the caller must invoke exactly once.
   * @throws {RateGuardTimeoutError} When no permit was granted in time, or the caller stopped waiting.
   */
  public async acquire(timeoutMs: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted === true) {
      // Nobody is waiting for this answer. Taking a permit for it would spend
      // capacity a live caller needs on a call that can only be torn down.
      throw this.refusal(timeoutMs, true);
    }

    if (this.inFlight < this.limit) {
      this.inFlight += 1;
      return () => this.release();
    }

    await new Promise<void>((resolve, reject) => {
      /**
       * Take this waiter out of the queue and refuse it. A waiter that `release`
       * has already admitted is no longer queued; it now holds a permit, which
       * its call returns, so there is nothing to undo here.
       *
       * @param abandoned Whether the caller left before the wait budget ran out.
       * @returns void
       */
      const leave = (abandoned: boolean): void => {
        const index = this.waiters.indexOf(waiter);
        if (index === -1) {
          return;
        }
        this.waiters.splice(index, 1);
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(this.refusal(timeoutMs, abandoned));
      };
      const onAbort = (): void => {
        leave(true);
      };
      const timer = setTimeout(() => {
        leave(false);
      }, timeoutMs);
      const waiter: GateWaiter = {
        admit: (): void => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });

    this.inFlight += 1;
    return () => this.release();
  }

  /**
   * Build the refusal for a caller this gate did not admit.
   *
   * @param timeoutMs The wait budget the caller had.
   * @param abandoned Whether the caller left before the budget ran out.
   * @returns The error to raise.
   */
  private refusal(timeoutMs: number, abandoned: boolean): RateGuardTimeoutError {
    return new RateGuardTimeoutError(this.identity.provider, "concurrency", timeoutMs, {
      modelId: this.identity.modelId,
      abandoned,
    });
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
      next.admit();
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

/** Guards, created on first use and shared process-wide, keyed by {@link GuardIdentity.key}. */
const rateLimiters = new Map<string, TokenBucketRateLimiter>();
const concurrencyGates = new Map<string, ConcurrencyGate>();
const guardIdentities = new Map<string, GuardIdentity>();

/**
 * The rate limiter for a guard.
 *
 * Shared process-wide rather than per-call-site, because the provider's ceiling
 * applies to the process as a whole. Per-call-site limiters would each stay
 * under the ceiling while their sum sailed past it.
 *
 * @param identity The guard.
 * @returns Its limiter.
 */
function rateLimiterFor(identity: GuardIdentity): TokenBucketRateLimiter {
  let limiter = rateLimiters.get(identity.key);
  if (limiter === undefined) {
    const limits = limitsFor(identity.provider);
    limiter = new TokenBucketRateLimiter({
      maxTokens: limits.requests_per_minute,
      refillRate: limits.requests_per_minute / SECONDS_PER_MINUTE,
      label: `llm:${identity.key}`,
      timeoutMs: limits.acquire_timeout_ms,
    });
    rateLimiters.set(identity.key, limiter);
    guardIdentities.set(identity.key, identity);
  }
  return limiter;
}

/**
 * The concurrency gate for a guard.
 *
 * @param identity The guard.
 * @returns Its gate.
 */
function concurrencyGateFor(identity: GuardIdentity): ConcurrencyGate {
  let gate = concurrencyGates.get(identity.key);
  if (gate === undefined) {
    gate = new ConcurrencyGate(identity, limitsFor(identity.provider).max_concurrent);
    concurrencyGates.set(identity.key, gate);
    guardIdentities.set(identity.key, identity);
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
 * @param scope The model the call addresses, and the caller's cancellation.
 * @returns The call's result.
 * @throws {RateGuardTimeoutError} When neither bound admitted the call in time,
 *   or the caller stopped waiting first.
 */
export async function withProviderGuards<T>(
  provider: string,
  call: () => Promise<T>,
  maxWaitMs?: number,
  scope: GuardCallScope = {},
): Promise<T> {
  const limits = limitsFor(provider);
  const identity = guardIdentity(provider, scope.modelId);
  const waitBudgetMs =
    maxWaitMs === undefined
      ? limits.acquire_timeout_ms
      : Math.min(maxWaitMs, limits.acquire_timeout_ms);

  try {
    await rateLimiterFor(identity).acquire();
  } catch {
    throw new RateGuardTimeoutError(provider, "rate", waitBudgetMs, {
      modelId: identity.modelId,
    });
  }

  const release = await concurrencyGateFor(identity).acquire(waitBudgetMs, scope.signal);
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
  /** The guard's identity: the provider, or `provider/model` for a per-model guard. */
  readonly key: string;
  readonly provider: string;
  /** The model this guard covers, for a provider whose limits apply per model. */
  readonly modelId: string | undefined;
  readonly scope: ProviderLimitScope;
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
 * @returns A snapshot per guard that has been used, sorted by guard key.
 */
export function guardSnapshots(): GuardSnapshot[] {
  return [...guardIdentities.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((identity) => {
      const limits = limitsFor(identity.provider);
      const limiter = rateLimiters.get(identity.key);
      const gate = concurrencyGates.get(identity.key);
      return {
        key: identity.key,
        provider: identity.provider,
        modelId: identity.modelId,
        scope: limits.scope ?? "provider",
        basis: limits.basis,
        requestsPerMinute: limits.requests_per_minute,
        maxConcurrent: limits.max_concurrent,
        inFlight: gate?.inFlightCount() ?? 0,
        rateQueueLength: limiter?.getQueueLength() ?? 0,
        concurrencyQueueLength: gate?.queueLength() ?? 0,
        availableTokens:
          limiter?.getAvailableTokens() ?? limits.requests_per_minute * TOKENS_PER_REQUEST,
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
  guardIdentities.clear();
}
