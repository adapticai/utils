/**
 * Token bucket rate limiter for external API integrations
 *
 * Implements client-side rate limiting to prevent exceeding API quotas
 * and ensure fair usage of external services like Alpaca, Polygon, and AlphaVantage.
 *
 * @example
 * ```typescript
 * import { rateLimiters } from '@adaptic/utils';
 *
 * // Before making an API call
 * await rateLimiters.alpaca.acquire();
 * const result = await makeAlpacaApiCall();
 * ```
 */

import { getLogger } from './logger';
import { RateLimitError } from './errors';

/**
 * Configuration for a rate limiter instance
 */
export interface RateLimiterConfig {
  /** Maximum number of tokens (requests) that can be accumulated */
  maxTokens: number;
  /** Rate at which tokens are refilled (tokens per second) */
  refillRate: number;
  /** Human-readable label for logging and error messages */
  label: string;
  /** Maximum time to wait for a token before timing out (milliseconds) */
  timeoutMs?: number;
}

/**
 * Represents a queued request waiting for a token
 */
interface QueuedRequest {
  /** Resolves when a token becomes available */
  resolve: () => void;
  /** Rejects if the request times out */
  reject: (error: Error) => void;
  /** Timeout handle for cleanup */
  timeoutHandle: NodeJS.Timeout;
}

/**
 * Token bucket rate limiter implementation
 *
 * Uses the token bucket algorithm to control the rate of API requests.
 * Tokens are consumed on each request and refilled at a constant rate.
 * Requests that exceed the available tokens are queued and processed
 * when tokens become available.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: QueuedRequest[] = [];
  private readonly timeoutMs: number;
  private processingQueue: boolean = false;

  /**
   * Creates a new rate limiter instance
   *
   * @param config - Rate limiter configuration
   *
   * @example
   * ```typescript
   * // Alpaca: 200 requests per minute
   * const alpacaLimiter = new TokenBucketRateLimiter({
   *   maxTokens: 200,
   *   refillRate: 200 / 60, // ~3.33 per second
   *   label: 'alpaca',
   *   timeoutMs: 60000
   * });
   * ```
   */
  constructor(private readonly config: RateLimiterConfig) {
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
    this.timeoutMs = config.timeoutMs ?? 60000; // Default 60 second timeout
  }

  /**
   * Acquires a token for making an API request
   *
   * If a token is available, it is consumed immediately.
   * If no tokens are available, the request is queued and will resolve
   * when a token becomes available or reject if it times out.
   *
   * @throws {RateLimitError} If the request times out waiting for a token
   *
   * @example
   * ```typescript
   * try {
   *   await limiter.acquire();
   *   // Make API call
   * } catch (error) {
   *   if (error instanceof RateLimitError) {
   *     // Handle rate limit timeout
   *   }
   * }
   * ```
   */
  async acquire(): Promise<void> {
    const logger = getLogger();

    this.refill();

    if (this.tokens > 0) {
      this.tokens--;
      logger.debug(`Rate limit token acquired for ${this.config.label}`, {
        remainingTokens: this.tokens,
        queueLength: this.queue.length,
      });
      return;
    }

    // No tokens available, queue the request
    logger.debug(`Rate limit reached for ${this.config.label}, queuing request`, {
      queueLength: this.queue.length,
    });

    return new Promise<void>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        // Remove from queue on timeout
        const index = this.queue.findIndex(req => req.timeoutHandle === timeoutHandle);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }

        const error = new RateLimitError(
          `Rate limit timeout for ${this.config.label} after ${this.timeoutMs}ms`,
          this.config.label,
          undefined
        );

        logger.warn(`Rate limit timeout for ${this.config.label}`, {
          queueLength: this.queue.length,
          timeoutMs: this.timeoutMs,
        });

        reject(error);
      }, this.timeoutMs);

      this.queue.push({ resolve, reject, timeoutHandle });
    });
  }

  /**
   * Refills tokens based on elapsed time and processes queued requests
   *
   * Tokens are refilled at the configured rate up to the maximum capacity.
   * If tokens are available after refilling, queued requests are processed.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // Convert to seconds
    const tokensToAdd = elapsed * this.config.refillRate;

    this.tokens = Math.min(this.config.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;

    // Process queued requests if we have tokens
    this.processQueue();
  }

  /**
   * Processes queued requests when tokens are available
   *
   * Prevents concurrent queue processing to ensure FIFO order.
   */
  private processQueue(): void {
    // Prevent concurrent queue processing
    if (this.processingQueue) {
      return;
    }

    this.processingQueue = true;
    const logger = getLogger();

    try {
      while (this.queue.length > 0 && this.tokens > 0) {
        this.tokens--;
        const next = this.queue.shift();

        if (next) {
          clearTimeout(next.timeoutHandle);
          next.resolve();

          logger.debug(`Processed queued request for ${this.config.label}`, {
            remainingTokens: this.tokens,
            remainingQueue: this.queue.length,
          });
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Gets the current number of available tokens
   *
   * @returns Number of tokens currently available
   */
  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Gets the current queue length
   *
   * @returns Number of requests waiting for tokens
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Clears all queued requests and resets the token bucket
   *
   * All queued requests will be rejected with a RateLimitError.
   * Useful for cleanup or when changing rate limit configurations.
   */
  reset(): void {
    const logger = getLogger();

    // Reject all queued requests
    for (const request of this.queue) {
      clearTimeout(request.timeoutHandle);
      request.reject(
        new RateLimitError(
          `Rate limiter reset for ${this.config.label}`,
          this.config.label,
          undefined
        )
      );
    }

    this.queue = [];
    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();
    this.processingQueue = false;

    logger.info(`Rate limiter reset for ${this.config.label}`, {
      maxTokens: this.config.maxTokens,
    });
  }
}

/**
 * Pre-configured rate limiters for common external APIs
 *
 * These limiters are configured based on the documented rate limits
 * for each service. Adjust the configurations if you have different
 * tier access or if limits change.
 *
 * @example
 * ```typescript
 * import { rateLimiters } from '@adaptic/utils';
 *
 * // Use before making API calls
 * await rateLimiters.alpaca.acquire();
 * await rateLimiters.polygon.acquire();
 * await rateLimiters.alphaVantage.acquire();
 * ```
 */
export const rateLimiters = {
  /**
   * Alpaca API rate limiter
   *
   * Configured for 200 requests per minute.
   * See: https://alpaca.markets/docs/api-references/trading-api/#rate-limit
   */
  alpaca: new TokenBucketRateLimiter({
    maxTokens: 200,
    refillRate: 200 / 60, // 200 requests per 60 seconds (~3.33/sec)
    label: 'alpaca',
    timeoutMs: 60000,
  }),

  /**
   * Polygon.io API rate limiter
   *
   * Configured for 5 requests per second (basic plan).
   * Adjust if you have a different subscription tier.
   * See: https://polygon.io/pricing
   */
  polygon: new TokenBucketRateLimiter({
    maxTokens: 5,
    refillRate: 5, // 5 requests per second
    label: 'polygon',
    timeoutMs: 30000,
  }),

  /**
   * AlphaVantage API rate limiter
   *
   * Configured for 5 requests per minute (free tier).
   * For premium tier (75/min), create a custom limiter:
   *
   * @example
   * ```typescript
   * const premiumAV = new TokenBucketRateLimiter({
   *   maxTokens: 75,
   *   refillRate: 75 / 60,
   *   label: 'alphaVantage-premium',
   *   timeoutMs: 60000,
   * });
   * ```
   *
   * See: https://www.alphavantage.co/premium/
   */
  alphaVantage: new TokenBucketRateLimiter({
    maxTokens: 5,
    refillRate: 5 / 60, // 5 requests per 60 seconds (~0.083/sec)
    label: 'alphaVantage',
    timeoutMs: 60000,
  }),
};
