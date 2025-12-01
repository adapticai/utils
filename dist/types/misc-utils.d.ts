declare const LOG_TYPES: readonly ["info", "warn", "error", "debug", "trace"];
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
export declare const logIfDebug: (message: string, data?: unknown, type?: LogType) => void;
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
export declare function hideApiKeyFromurl(url: string): string;
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
export declare function fetchWithRetry(url: string, options?: RequestInit, retries?: number, initialBackoff?: number): Promise<Response>;
/**
 * Validates a Polygon.io API key by making a test request.
 * @param apiKey - The API key to validate.
 * @returns Promise that resolves to true if valid, false otherwise.
 */
export declare function validatePolygonApiKey(apiKey: string): Promise<boolean>;
export {};
//# sourceMappingURL=misc-utils.d.ts.map