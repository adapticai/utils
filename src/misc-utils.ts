// Utility function for debug logging
import { getLogger } from './logger';
import { withRetry } from './utils/retry';

// Define the possible log types as a const array for better type inference
const LOG_TYPES = ['info', 'warn', 'error', 'debug', 'trace'] as const;
// Create a union type from the array
type LogType = typeof LOG_TYPES[number];

/**
 * Debug logging utility that respects environment debug flags.
 * Logs messages to the console based on the specified log level.
 *
 * @param message - The message to log.
 * @param data - Optional data to log alongside the message. This can be any type of data.
 * @param type - Log level. One of: 'info' | 'warn' | 'error' | 'debug' | 'trace'. Defaults to 'info'.
 *
 * @example
 * logIfDebug("User login failed", { userId: 123 }, "error");
 * logIfDebug("Cache miss", undefined, "warn");
 * logIfDebug("Processing request", { requestId: "abc" }, "debug");
 */
export const logIfDebug = (
  message: string,
  data?: unknown,
  type: LogType = 'info'
) => {
  const debugMode = process.env.LUMIC_DEBUG === 'true' || process.env.lumic_debug === 'true' || false;

  if (!debugMode) return;

  const prefix = `[DEBUG][${type.toUpperCase()}]`;
  const logger = getLogger();
  const context = data !== undefined ? (typeof data === 'object' && data !== null ? data as Record<string, unknown> : { data }) : undefined;

  const fullMessage = prefix + ' ' + message;

  switch (type) {
    case 'error':
      logger.error(fullMessage, context);
      break;
    case 'warn':
      logger.warn(fullMessage, context);
      break;
    case 'debug':
      logger.debug(fullMessage, context);
      break;
    case 'trace':
      // trace maps to debug in our logger interface
      logger.debug(fullMessage, context);
      break;
    case 'info':
    default:
      logger.info(fullMessage, context);
  }
};

/**
 * Masks the middle part of an API key, returning only the first 2 and last 2 characters.
 * If the API key is very short (<= 4 characters), it will be returned as is.
 *
 * @param keyValue - The API key to mask.
 * @returns The masked API key.
 *
 * @example
 * maskApiKey("12341239856677"); // Returns "12****77"
 */
function maskApiKey(keyValue: string): string {
  if (keyValue.length <= 4) {
    return keyValue;
  }
  const firstTwo = keyValue.slice(0, 2);
  const lastTwo = keyValue.slice(-2);
  return `${firstTwo}****${lastTwo}`;
}

/**
 * Hides (masks) the value of any query parameter that is "apiKey" (case-insensitive),
 * replacing the middle part with **** and keeping only the first 2 and last 2 characters.
 *
 * @param url - The URL containing the query parameters.
 * @returns The URL with the masked API key.
 *
 * @example
 * hideApiKeyFromurl("https://xxx.com/s/23/fdsa/?apiKey=12341239856677");
 * // Returns "https://xxx.com/s/23/fdsa/?apiKey=12****77"
 */
export function hideApiKeyFromurl(url: string): string {
  try {
    const parsedUrl = new URL(url);

    // We iterate over all search params and look for one named 'apikey' (case-insensitive)
    for (const [key, value] of parsedUrl.searchParams.entries()) {
      if (key.toLowerCase() === 'apikey') {
        const masked = maskApiKey(value);
        parsedUrl.searchParams.set(key, masked);
      }
    }

    return parsedUrl.toString();
  } catch {
    // If we can't parse it as a valid URL, just return the original string
    return url;
  }
}

/**
 * Fetches a resource with intelligent retry logic for handling transient errors.
 * Features enhanced error logging, rate limit detection, and adaptive backoff.
 *
 * This is a wrapper around the new retry utility for backward compatibility.
 * It wraps fetch calls with retry logic using exponential backoff.
 *
 * @param url - The URL to fetch.
 * @param options - Optional fetch options.
 * @param retries - The number of retry attempts. Defaults to 3.
 * @param initialBackoff - The initial backoff time in milliseconds. Defaults to 1000.
 * @returns A promise that resolves to the response.
 *
 * @throws Will throw an error if the fetch fails after the specified number of retries.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries: number = 3,
  initialBackoff: number = 1000
): Promise<Response> {
  return withRetry(
    async () => {
      const response = await fetch(url, options);

      if (!response.ok) {
        // Enhanced HTTP error handling with specific error types
        if (response.status === 429) {
          // Check for Retry-After header
          const retryAfter = response.headers.get('Retry-After');
          const retryDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : null;

          const error = new Error(`RATE_LIMIT: ${response.status}${retryDelay ? `:${retryDelay}` : ''}`);
          (error as Error & { response?: Response }).response = response;
          throw error;
        }
        if ([500, 502, 503, 504].includes(response.status)) {
          const error = new Error(`SERVER_ERROR: ${response.status}`);
          (error as Error & { response?: Response }).response = response;
          throw error;
        }
        if ([401, 403].includes(response.status)) {
          const error = new Error(`AUTH_ERROR: ${response.status}`);
          (error as Error & { response?: Response }).response = response;
          throw error;
        }
        if (response.status >= 400 && response.status < 500) {
          // Don't retry most 4xx client errors
          const error = new Error(`CLIENT_ERROR: ${response.status}`);
          (error as Error & { response?: Response }).response = response;
          throw error;
        }
        const error = new Error(`HTTP_ERROR: ${response.status}`);
        (error as Error & { response?: Response }).response = response;
        throw error;
      }

      return response;
    },
    {
      maxRetries: retries,
      baseDelayMs: initialBackoff,
      maxDelayMs: 30000,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      retryOnNetworkError: true,
    },
    `fetchWithRetry: ${hideApiKeyFromurl(url)}`
  );
}

/**
 * Validates a Polygon.io API key by making a test request.
 * @param apiKey - The API key to validate.
 * @returns Promise that resolves to true if valid, false otherwise.
 */
export async function validatePolygonApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.polygon.io/v1/meta/symbols?apikey=${apiKey}&limit=1`);
    if (response.status === 401) {
      throw new Error('Invalid or expired Polygon.io API key');
    }
    if (response.status === 403) {
      throw new Error('Polygon.io API key lacks required permissions');
    }
    return response.ok;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    getLogger().error('Polygon.io API key validation failed:', { errorMessage });
    return false;
  }
}
