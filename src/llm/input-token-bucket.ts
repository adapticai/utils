/**
 * A token bucket over a VARIABLE cost, for a provider that meters input tokens.
 *
 * The package's {@link TokenBucketRateLimiter} spends exactly one token per
 * call, which is the right shape for a ceiling counted in requests and the
 * wrong one for a ceiling counted in tokens: two calls a request-counting
 * guard sees as identical can differ by three orders of magnitude in what the
 * provider bills them. A guard that cannot carry a cost therefore cannot hold
 * a token ceiling at all — it can only hold the request ceiling a second time.
 *
 * The bucket holds two independent quantities for the same reason the request
 * guard does. The refill rate is the pace the client sustains; the capacity is
 * the most it may spend in one instant. A provider enforcing its ceiling per
 * second is held by the second of these, because the first is an average and
 * an average permits any burst. Over any window of `t` seconds this bucket
 * admits at most `capacity + refillPerSecond * t` tokens, which is the bound
 * an entry's numbers are chosen against.
 *
 * Waiters are served strictly in arrival order, and a waiter whose cost the
 * bucket cannot yet meet holds the line. Serving a cheaper waiter behind it
 * would be throughput at the price of starving exactly the calls the ceiling
 * is about: under a steady stream of small requests a large one would never
 * run, and would time out reporting a bucket that was never empty.
 *
 * @module llm/input-token-bucket
 */

/** Milliseconds in one second, converting a per-second refill to elapsed time. */
const MS_PER_SECOND = 1000;

/** How a bucket answers a request for tokens. */
export type InputTokenAdmission =
  /** The cost was taken from the bucket and the caller may proceed. */
  | { readonly admitted: true }
  /**
   * The cost was not taken, and the reason says whether the caller could ever
   * have been admitted. `exceeds_capacity` is a permanent answer about the
   * request; `waited_out` and `abandoned` are answers about this moment.
   */
  | { readonly admitted: false; readonly reason: InputTokenRefusal };

/** Why a bucket did not admit a cost. */
export type InputTokenRefusal =
  /** The cost is larger than the bucket can ever hold, so no wait could admit it. */
  | "exceeds_capacity"
  /** The bucket did not hold the cost within the caller's wait budget. */
  | "waited_out"
  /** The caller stopped waiting before the bucket could hold the cost. */
  | "abandoned";

/** How a bucket is built. */
export interface InputTokenBucketConfig {
  /** The most the bucket holds, which is the most it admits in one instant. */
  readonly capacity: number;
  /** The pace tokens are replaced at, in tokens per second. */
  readonly refillPerSecond: number;
  /** Names the bucket in whatever reads its state. */
  readonly label: string;
  /**
   * Reads the current instant in milliseconds. Injected so a test can drive
   * the bucket from a clock it owns rather than from elapsed real time, which
   * is the difference between asserting the refill arithmetic and asserting
   * that a machine was not busy.
   */
  readonly now?: () => number;
}

/** A caller queued for tokens. */
interface TokenWaiter {
  /** What the caller is waiting to spend. */
  readonly cost: number;
  /** Hands the waiter the tokens the bucket now holds for it. */
  readonly admit: () => void;
  /** Refuses the waiter and takes it out of the queue. */
  readonly refuse: (reason: InputTokenRefusal) => void;
}

/**
 * A bucket of input tokens, refilled at a fixed pace and spent by the token.
 *
 * Created per guard and shared process-wide by whatever holds it, because the
 * provider's ceiling applies to the process as a whole.
 */
export class InputTokenBucket {
  private tokens: number;

  private lastRefillMs: number;

  private readonly waiters: TokenWaiter[] = [];

  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly config: InputTokenBucketConfig;

  private readonly now: () => number;

  /**
   * @param config The bucket's capacity, refill pace and label.
   */
  public constructor(config: InputTokenBucketConfig) {
    this.config = config;
    this.now = config.now ?? Date.now;
    this.tokens = config.capacity;
    this.lastRefillMs = this.now();
  }

  /** @returns The bucket's capacity, in input tokens. */
  public capacity(): number {
    return this.config.capacity;
  }

  /** @returns How many tokens the bucket holds, after accruing what time has added. */
  public available(): number {
    this.refill();
    return this.tokens;
  }

  /** @returns How many callers are queued for tokens. */
  public queueLength(): number {
    return this.waiters.length;
  }

  /**
   * Spend `cost` tokens, waiting for them if the bucket does not hold them yet.
   *
   * A cost above the capacity is refused at once rather than queued. Queuing
   * it would spend the caller's whole wait budget to reach the same answer,
   * and would hold every waiter behind it for that time, so the permanent
   * answer is given immediately and named as permanent.
   *
   * @param cost The request's input tokens.
   * @param timeoutMs How long the caller is willing to wait.
   * @param signal The caller's cancellation; firing it takes the caller out of the queue.
   * @returns Whether the cost was taken, and when it was not, why.
   */
  public async acquire(
    cost: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<InputTokenAdmission> {
    if (cost > this.config.capacity) {
      return { admitted: false, reason: "exceeds_capacity" };
    }
    if (signal?.aborted === true) {
      // Nobody is waiting for this answer. Spending the bucket on it would
      // take tokens from a caller that is still there.
      return { admitted: false, reason: "abandoned" };
    }
    this.refill();
    // Admitted straight away only with nobody ahead: a caller that jumped a
    // queued waiter would take the tokens that waiter is accruing, and a large
    // request behind a stream of small ones would never be served.
    if (this.waiters.length === 0 && this.tokens >= cost) {
      this.tokens -= cost;
      return { admitted: true };
    }

    return new Promise<InputTokenAdmission>((resolve) => {
      /**
       * Take this waiter out of the queue, if it is still in it.
       *
       * @returns Whether the waiter was still queued.
       */
      const leave = (): boolean => {
        const index = this.waiters.indexOf(waiter);
        if (index === -1) {
          return false;
        }
        this.waiters.splice(index, 1);
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        return true;
      };
      const onAbort = (): void => {
        if (leave()) {
          resolve({ admitted: false, reason: "abandoned" });
          // The head of the queue may have changed, so the wake-up this
          // waiter's deficit timed is no longer the right one.
          this.rearm();
        }
      };
      const timer = setTimeout(() => {
        if (leave()) {
          resolve({ admitted: false, reason: "waited_out" });
          this.rearm();
        }
      }, timeoutMs);
      const waiter: TokenWaiter = {
        cost,
        admit: (): void => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve({ admitted: true });
        },
        refuse: (reason: InputTokenRefusal): void => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve({ admitted: false, reason });
        },
      };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.rearm();
    });
  }

  /**
   * Discard every token and refuse every waiter.
   *
   * Exists so a test can start from a known position; a bucket shared
   * process-wide is otherwise carried between tests and makes their order
   * matter. Waiters are refused rather than left, because a promise nobody
   * will ever settle is a hang dressed as a slow test.
   *
   * @returns void
   */
  public reset(): void {
    this.clearWake();
    const queued = this.waiters.splice(0, this.waiters.length);
    for (const waiter of queued) {
      waiter.refuse("waited_out");
    }
    this.tokens = this.config.capacity;
    this.lastRefillMs = this.now();
  }

  /**
   * Accrue the tokens elapsed time has added, up to the capacity.
   *
   * @returns void
   */
  private refill(): void {
    const nowMs = this.now();
    const elapsedMs = nowMs - this.lastRefillMs;
    if (elapsedMs <= 0) {
      // A clock that went backwards accrues nothing rather than draining the
      // bucket: the elapsed time is unknown, and the fail-safe reading of an
      // unknown interval is that no tokens were earned.
      this.lastRefillMs = nowMs;
      return;
    }
    this.lastRefillMs = nowMs;
    const accrued = (elapsedMs / MS_PER_SECOND) * this.config.refillPerSecond;
    this.tokens = Math.min(this.config.capacity, this.tokens + accrued);
  }

  /**
   * Serve whoever the bucket can now afford, in arrival order.
   *
   * @returns void
   */
  private drain(): void {
    this.refill();
    while (this.waiters.length > 0 && this.tokens >= this.waiters[0].cost) {
      const waiter = this.waiters.shift();
      if (waiter === undefined) {
        return;
      }
      this.tokens -= waiter.cost;
      waiter.admit();
    }
  }

  /**
   * Schedule the one wake-up that serves the head of the queue.
   *
   * Timed to the deficit the head is short by at the refill pace, so the
   * bucket wakes when it can pay rather than polling. The timer is `unref`'d
   * where the runtime allows it, so a queued waiter never holds the process
   * open on its own.
   *
   * @returns void
   */
  private rearm(): void {
    this.clearWake();
    this.drain();
    const head = this.waiters[0];
    if (head === undefined) {
      return;
    }
    if (this.config.refillPerSecond <= 0) {
      // A bucket that never refills will never serve this waiter; its own wait
      // budget is what answers it.
      return;
    }
    const deficit = head.cost - this.tokens;
    const waitMs = Math.max(1, Math.ceil((deficit / this.config.refillPerSecond) * MS_PER_SECOND));
    const timer = setTimeout(() => {
      this.wakeTimer = null;
      this.rearm();
    }, waitMs);
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    this.wakeTimer = timer;
  }

  /**
   * Cancel any pending wake-up.
   *
   * @returns void
   */
  private clearWake(): void {
    if (this.wakeTimer !== null) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }
}
