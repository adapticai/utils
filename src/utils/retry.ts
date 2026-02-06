/**
import { getLogger } from '../logger';
 * Retry utility with exponential backoff for handling transient errors in external API calls.
 *
 * Features:
 * - Configurable retry attempts and delays
 * - Exponential backoff with jitter to prevent thundering herd
 * - Respects Retry-After headers for rate limiting (429)
 * - Fail-fast for non-retryable errors (4xx client errors)
 * - Detailed error logging with context
 */

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs: number;
  /** HTTP status codes that should trigger a retry (default: [429, 500, 502, 503, 504]) */
  retryableStatusCodes: number[];
  /** Whether to retry on network errors (default: true) */
  retryOnNetworkError: boolean;
  /** Optional callback invoked on each retry attempt */
  onRetry?: (attempt: number, error: unknown) => void;
}

interface ErrorDetails {
  type: 'RATE_LIMIT' | 'SERVER_ERROR' | 'CLIENT_ERROR' | 'AUTH_ERROR' | 'NETWORK_ERROR' | 'UNKNOWN';
  reason: string;
  status: number | null;
  retryAfter?: number;
  isRetryable: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  retryOnNetworkError: true,
};

/**
 * Analyzes an error and determines if it's retryable.
 * @param error - The error to analyze
 * @param response - Optional Response object for HTTP errors
 * @param config - Retry configuration
 * @returns Structured error details
 */
function analyzeError(
  error: unknown,
  response: Response | null,
  config: RetryConfig
): ErrorDetails {
  // Handle Response objects with error status codes
  if (response && !response.ok) {
    const status = response.status;

    // Rate limit errors - always retryable
    if (status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : undefined;
      return {
        type: 'RATE_LIMIT',
        reason: 'Rate limit exceeded',
        status,
        retryAfter,
        isRetryable: true,
      };
    }

    // Authentication errors - never retry
    if (status === 401 || status === 403) {
      return {
        type: 'AUTH_ERROR',
        reason: status === 401 ? 'Authentication failed - invalid credentials' : 'Access forbidden - insufficient permissions',
        status,
        isRetryable: false,
      };
    }

    // Server errors - check if in retryable list
    if (status >= 500 && status < 600) {
      return {
        type: 'SERVER_ERROR',
        reason: `Server error (${status})`,
        status,
        isRetryable: config.retryableStatusCodes.includes(status),
      };
    }

    // Other client errors - never retry
    if (status >= 400 && status < 500) {
      return {
        type: 'CLIENT_ERROR',
        reason: `Client error (${status})`,
        status,
        isRetryable: false,
      };
    }
  }

  // Handle network errors (TypeError from fetch API)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return {
      type: 'NETWORK_ERROR',
      reason: 'Network connectivity issue',
      status: null,
      isRetryable: config.retryOnNetworkError,
    };
  }

  // Handle error objects with messages
  if (error instanceof Error) {
    // Parse error messages that might contain status information
    if (error.message.includes('429') || error.message.includes('RATE_LIMIT')) {
      const match = error.message.match(/RATE_LIMIT: 429:(\d+)/);
      const retryAfter = match ? parseInt(match[1], 10) : undefined;
      return {
        type: 'RATE_LIMIT',
        reason: 'Rate limit exceeded',
        status: 429,
        retryAfter,
        isRetryable: true,
      };
    }

    if (error.message.includes('401') || error.message.includes('403') || error.message.includes('AUTH_ERROR')) {
      const status = error.message.includes('401') ? 401 : 403;
      return {
        type: 'AUTH_ERROR',
        reason: `Authentication error (${status})`,
        status,
        isRetryable: false,
      };
    }

    if (error.message.includes('SERVER_ERROR') || error.message.match(/50[0-9]/)) {
      const statusMatch = error.message.match(/50[0-9]/);
      const status = statusMatch ? parseInt(statusMatch[0], 10) : 500;
      return {
        type: 'SERVER_ERROR',
        reason: `Server error (${status})`,
        status,
        isRetryable: config.retryableStatusCodes.includes(status),
      };
    }

    if (error.message.includes('network') || error.message.includes('NETWORK_ERROR')) {
      return {
        type: 'NETWORK_ERROR',
        reason: error.message,
        status: null,
        isRetryable: config.retryOnNetworkError,
      };
    }
  }

  // Unknown error - not retryable by default for safety
  return {
    type: 'UNKNOWN',
    reason: error instanceof Error ? error.message : String(error),
    status: null,
    isRetryable: false,
  };
}

/**
 * Calculates the delay before the next retry attempt using exponential backoff with jitter.
 * @param attempt - Current attempt number (1-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @returns Delay in milliseconds
 */
function calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number {
  // Exponential backoff: baseDelay * 2^(attempt-1)
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);

  // Add jitter (random value between 0% and 25% of the delay)
  const jitter = Math.random() * cappedDelay * 0.25;

  return Math.floor(cappedDelay + jitter);
}

/**
 * Wraps an async function with retry logic and exponential backoff.
 *
 * This utility handles transient errors in external API calls by automatically retrying
 * failed requests with intelligent backoff strategies. It respects rate limit headers,
 * fails fast on non-retryable errors, and provides detailed logging.
 *
 * @template T - The return type of the wrapped function
 * @param fn - The async function to wrap with retry logic
 * @param config - Retry configuration (merged with defaults)
 * @param label - A descriptive label for logging (e.g., 'Polygon.fetchTickerInfo')
 * @returns A promise that resolves to the function's return value
 * @throws The last error encountered if all retries are exhausted
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const data = await withRetry(
 *   async () => fetch('https://api.example.com/data'),
 *   {},
 *   'ExampleAPI.fetchData'
 * );
 *
 * // Custom configuration for rate-limited API
 * const result = await withRetry(
 *   async () => alphaVantageAPI.getQuote(symbol),
 *   {
 *     maxRetries: 5,
 *     baseDelayMs: 5000,
 *     maxDelayMs: 60000,
 *     onRetry: (attempt, error) => {
 *       getLogger().info(`Retry ${attempt} after error:`, error);
 *     }
 *   },
 *   'AlphaVantage.getQuote'
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  label: string = 'unknown'
): Promise<T> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  let lastError: unknown;

  for (let attempt = 1; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      const result = await fn();

      // If we succeeded after retries, log it
      if (attempt > 1) {
        getLogger().info(`[${label}] Succeeded on attempt ${attempt}/${fullConfig.maxRetries}`);
      }

      return result;
    } catch (error: unknown) {
      lastError = error;

      // If this is the last attempt, throw the error
      if (attempt === fullConfig.maxRetries) {
        getLogger().error(`[${label}] Failed after ${fullConfig.maxRetries} attempts`, {
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
        throw error;
      }

      // Analyze the error to determine if we should retry
      const response = error instanceof Response ? error : null;
      const errorDetails = analyzeError(error, response, fullConfig);

      // If error is not retryable, fail immediately
      if (!errorDetails.isRetryable) {
        getLogger().error(`[${label}] Non-retryable error (${errorDetails.type})`, {
          reason: errorDetails.reason,
          status: errorDetails.status,
          timestamp: new Date().toISOString(),
        });
        throw error;
      }

      // Calculate delay for next retry
      let delayMs: number;
      if (errorDetails.type === 'RATE_LIMIT' && errorDetails.retryAfter) {
        // Use Retry-After header if available
        delayMs = errorDetails.retryAfter;
      } else if (errorDetails.type === 'RATE_LIMIT') {
        // For rate limits without Retry-After, use a longer minimum delay
        delayMs = Math.max(calculateBackoff(attempt, fullConfig.baseDelayMs, fullConfig.maxDelayMs), 5000);
      } else {
        // Standard exponential backoff with jitter
        delayMs = calculateBackoff(attempt, fullConfig.baseDelayMs, fullConfig.maxDelayMs);
      }

      // Log the retry attempt
      getLogger().warn(`[${label}] Attempt ${attempt}/${fullConfig.maxRetries} failed: ${errorDetails.reason}. Retrying in ${delayMs}ms...`, {
        attemptNumber: attempt,
        totalRetries: fullConfig.maxRetries,
        errorType: errorDetails.type,
        httpStatus: errorDetails.status,
        retryDelay: delayMs,
        timestamp: new Date().toISOString(),
      });

      // Call the optional retry callback
      if (fullConfig.onRetry) {
        fullConfig.onRetry(attempt, error);
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // This should never be reached due to the throw in the last attempt,
  // but TypeScript needs this to satisfy the return type
  throw lastError;
}

/**
 * API-specific retry configurations for different external services.
 * These configurations are tuned based on each API's rate limits and characteristics.
 */
export const API_RETRY_CONFIGS = {
  /** Polygon.io API - 5 requests/second rate limit */
  POLYGON: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryOnNetworkError: true,
  } as Partial<RetryConfig>,

  /** Alpha Vantage API - 5 requests/minute rate limit (more strict) */
  ALPHA_VANTAGE: {
    maxRetries: 5,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryOnNetworkError: true,
  } as Partial<RetryConfig>,

  /** Alpaca API - generally reliable, shorter retry window */
  ALPACA: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryOnNetworkError: true,
  } as Partial<RetryConfig>,

  /** Generic crypto API configuration */
  CRYPTO: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryOnNetworkError: true,
  } as Partial<RetryConfig>,
};
