/**
 * HTTP request timeout utilities
 * Provides configurable timeout handling for external API calls
 */

/**
 * Default timeout values for different external APIs (in milliseconds)
 * Can be overridden via environment variables
 */
export const DEFAULT_TIMEOUTS = {
  ALPACA_API: parseInt(process.env.ALPACA_API_TIMEOUT || '30000', 10),
  POLYGON_API: parseInt(process.env.POLYGON_API_TIMEOUT || '30000', 10),
  ALPHA_VANTAGE: parseInt(process.env.ALPHA_VANTAGE_API_TIMEOUT || '30000', 10),
  GENERAL: parseInt(process.env.HTTP_TIMEOUT || '30000', 10),
} as const;

/**
 * Wraps a promise with a timeout
 * @param promise - The promise to wrap with timeout
 * @param ms - Timeout duration in milliseconds
 * @param label - Label for error messages to identify the request
 * @returns Promise that rejects if timeout is exceeded
 * @throws Error if the promise takes longer than the specified timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Request timeout after ${ms}ms: ${label}`)),
        ms
      )
    ),
  ]);
}

/**
 * Creates an AbortSignal that times out after the specified duration
 * Compatible with fetch API
 * @param ms - Timeout duration in milliseconds
 * @returns AbortSignal that will abort after the specified duration
 */
export function createTimeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/**
 * Get the appropriate timeout value for a given API
 * @param api - The API type to get timeout for
 * @returns Timeout value in milliseconds
 */
export function getTimeout(api: keyof typeof DEFAULT_TIMEOUTS): number {
  return DEFAULT_TIMEOUTS[api];
}
