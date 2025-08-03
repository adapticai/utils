// Utility function for debug logging

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
  const formattedData = data !== undefined ? JSON.stringify(data, null, 2) : '';

  switch (type) {
    case 'error':
      console.error(prefix, message, formattedData);
      break;
    case 'warn':
      console.warn(prefix, message, formattedData);
      break;
    case 'debug':
      console.debug(prefix, message, formattedData);
      break;
    case 'trace':
      console.trace(prefix, message, formattedData);
      break;
    case 'info':
    default:
      console.info(prefix, message, formattedData);
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

interface ErrorDetails {
  type: string;
  reason: string;
  status: number | null;
  retryAfter?: number;
}

/**
 * Extracts meaningful error information from various error types.
 * @param error - The error to analyze.
 * @param response - Optional response object for HTTP errors.
 * @returns Structured error details.
 */
function extractErrorDetails(error: any, response?: Response): ErrorDetails {
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return { type: 'NETWORK_ERROR', reason: 'Network connectivity issue', status: null };
  }
  if (error.message.includes('HTTP error: 429')) {
    const match = error.message.match(/RATE_LIMIT: 429:(\d+)/);
    const retryAfter = match ? parseInt(match[1]) : undefined;
    return { type: 'RATE_LIMIT', reason: 'Rate limit exceeded', status: 429, retryAfter };
  }
  if (error.message.includes('HTTP error: 401') || error.message.includes('AUTH_ERROR: 401')) {
    return { type: 'AUTH_ERROR', reason: 'Authentication failed - invalid API key', status: 401 };
  }
  if (error.message.includes('HTTP error: 403') || error.message.includes('AUTH_ERROR: 403')) {
    return { type: 'AUTH_ERROR', reason: 'Access forbidden - insufficient permissions', status: 403 };
  }
  if (error.message.includes('SERVER_ERROR:')) {
    const status = parseInt(error.message.split('SERVER_ERROR: ')[1]) || 500;
    return { type: 'SERVER_ERROR', reason: `Server error (${status})`, status };
  }
  if (error.message.includes('CLIENT_ERROR:')) {
    const status = parseInt(error.message.split('CLIENT_ERROR: ')[1]) || 400;
    return { type: 'CLIENT_ERROR', reason: `Client error (${status})`, status };
  }
  return { type: 'UNKNOWN', reason: error.message || 'Unknown error', status: null };
}

/**
 * Fetches a resource with intelligent retry logic for handling transient errors.
 * Features enhanced error logging, rate limit detection, and adaptive backoff.
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
  let backoff = initialBackoff;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        // Enhanced HTTP error handling with specific error types
        if (response.status === 429) {
          // Check for Retry-After header
          const retryAfter = response.headers.get('Retry-After');
          const retryDelay = retryAfter ? parseInt(retryAfter) * 1000 : null;
          
          throw new Error(`RATE_LIMIT: ${response.status}${retryDelay ? `:${retryDelay}` : ''}`);
        }
        if ([500, 502, 503, 504].includes(response.status)) {
          throw new Error(`SERVER_ERROR: ${response.status}`);
        }
        if ([401, 403].includes(response.status)) {
          throw new Error(`AUTH_ERROR: ${response.status}`);
        }
        if (response.status >= 400 && response.status < 500) {
          // Don't retry most 4xx client errors
          throw new Error(`CLIENT_ERROR: ${response.status}`);
        }
        throw new Error(`HTTP_ERROR: ${response.status}`);
      }
      return response;
    } catch (error: any) {
      if (attempt === retries) {
        throw error;
      }
      
      // Extract meaningful error information
      const errorDetails = extractErrorDetails(error);
      let adaptiveBackoff = backoff;
      
      // Adaptive backoff based on error type
      if (errorDetails.type === 'RATE_LIMIT') {
        // Use Retry-After header if available, otherwise use minimum 5s for rate limits
        if (errorDetails.retryAfter) {
          adaptiveBackoff = errorDetails.retryAfter;
        } else {
          adaptiveBackoff = Math.max(backoff, 5000);
        }
      } else if (errorDetails.type === 'AUTH_ERROR') {
        // Don't retry auth errors - fail fast
        console.error(`Authentication error for ${hideApiKeyFromurl(url)}: ${errorDetails.reason}`, {
          attemptNumber: attempt,
          errorType: errorDetails.type,
          httpStatus: errorDetails.status,
          url: hideApiKeyFromurl(url),
          source: 'fetchWithRetry',
          timestamp: new Date().toISOString()
        });
        throw error;
      } else if (errorDetails.type === 'CLIENT_ERROR') {
        // Don't retry client errors (except 429 which is handled above)
        console.error(`Client error for ${hideApiKeyFromurl(url)}: ${errorDetails.reason}`, {
          attemptNumber: attempt,
          errorType: errorDetails.type,
          httpStatus: errorDetails.status,
          url: hideApiKeyFromurl(url),
          source: 'fetchWithRetry',
          timestamp: new Date().toISOString()
        });
        throw error;
      }
      
      // Enhanced error logging with structured data
      console.warn(`Fetch attempt ${attempt} of ${retries} for ${hideApiKeyFromurl(url)} failed: ${errorDetails.reason}. Retrying in ${adaptiveBackoff}ms...`, {
        attemptNumber: attempt,
        totalRetries: retries,
        errorType: errorDetails.type,
        httpStatus: errorDetails.status,
        retryDelay: adaptiveBackoff,
        url: hideApiKeyFromurl(url),
        source: 'fetchWithRetry',
        timestamp: new Date().toISOString()
      });
      
      await new Promise((resolve) => setTimeout(resolve, adaptiveBackoff));
      backoff = Math.min(backoff * 2, 30000); // Cap at 30 seconds
    }
  }
  throw new Error('Failed to fetch after multiple attempts');
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
    console.error('Polygon.io API key validation failed:', errorMessage);
    return false;
  }
}
