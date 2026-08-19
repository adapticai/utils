import { AdapticUtilsError } from "../errors";
import { getLogger } from "../logger";

/**
 * Retry utility with exponential backoff for handling transient errors in external API calls.
 *
 * Features:
 * - Configurable retry attempts and delays
 * - Exponential backoff with jitter to prevent thundering herd
 * - Respects Retry-After headers for rate limiting (429)
 * - Fail-fast for non-retryable errors (4xx client errors)
 * - Detailed error logging with context
 * - Retryability is decided from a **typed** HTTP status or a typed error
 *   class only; an error message is never parsed for a status (F-0035)
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

/**
 * Typed taxonomy of retry outcomes. Every classification decision resolves to
 * exactly one member; the union is exhaustive by construction so a new class
 * cannot be added without every consumer switch failing to compile.
 */
export type RetryErrorType =
  | "RATE_LIMIT"
  | "SERVER_ERROR"
  | "CLIENT_ERROR"
  | "AUTH_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN";

/**
 * The verdict produced by {@link classifyRetryError}: what kind of failure this
 * is, the HTTP status it was decided from (null when the failure carried no
 * status), and whether the call may be re-issued.
 */
export interface RetryErrorDetails {
  /** Typed failure class. */
  type: RetryErrorType;
  /** Human-readable reason, for logs only — never used to decide anything. */
  reason: string;
  /** HTTP status the verdict was derived from, or null for status-less failures. */
  status: number | null;
  /** Delay (ms) mandated by the upstream `Retry-After` header. */
  retryAfter?: number;
  /** Whether the operation may be re-issued. */
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
 * Node.js / undici / system error codes that represent transient network
 * conditions. Present on `error.code` for net/http/dns/undici errors.
 */
const RETRYABLE_ERROR_CODES = new Set<string>([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPIPE",
  "ECONNABORTED",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
]);

/**
 * Error constructor names / `error.name` values that indicate transient
 * abort / timeout conditions.
 */
const RETRYABLE_ERROR_NAMES = new Set<string>([
  "AbortError",
  "TimeoutError",
  "FetchError",
  "RequestTimeoutError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
]);

/**
 * Message-pattern fallback for libraries that discard error codes/names but
 * preserve text (e.g., some Apollo/axios wrappers).
 */
const RETRYABLE_MESSAGE_PATTERNS: RegExp[] = [
  /aborted/i,
  /timeout/i,
  /timed out/i,
  /network error/i,
  /socket hang up/i,
  /connection (reset|refused|closed)/i,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /EAI_AGAIN/,
  /UND_ERR_/,
];

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

/**
 * Walks the `error.cause` chain (capped to avoid cycles) and tests whether
 * any link along the chain looks like a transient network error. Modern APIs
 * (undici, fetch, Apollo Client 3.8+) wrap the root network failure as a
 * `.cause`, so the surface `Error` may report a generic message while the
 * actionable signal lives one or more levels deeper.
 *
 * Exported for use by downstream consumers (engine services, per-call catch
 * blocks, application-level loggers) that need to demote recoverable
 * transient errors from ERROR to WARN. Aligns the whole stack on a single
 * canonical classifier so MassiveAPI, AlpacaAPI, and application-layer
 * retry handlers all treat the same network blips identically.
 */
export function isTransientNetworkError(error: unknown): boolean {
  const MAX_CAUSE_DEPTH = 6;
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    if (current instanceof Error || typeof current === "object") {
      const err = current as ErrorLike;

      if (typeof err.name === "string" && RETRYABLE_ERROR_NAMES.has(err.name)) {
        return true;
      }

      if (typeof err.code === "string" && RETRYABLE_ERROR_CODES.has(err.code)) {
        return true;
      }

      if (typeof err.message === "string") {
        for (const pattern of RETRYABLE_MESSAGE_PATTERNS) {
          if (pattern.test(err.message)) {
            return true;
          }
        }
      }

      current = err.cause;
    } else {
      break;
    }
  }

  return false;
}

/**
 * Error names that indicate the CLIENT's own request deadline expired (an
 * `AbortSignal` timeout or an undici per-phase timeout) rather than a
 * connection-phase fault. These faults have already consumed a full request
 * timeout, so retrying them is expensive by construction.
 */
const DEADLINE_EXPIRY_ERROR_NAMES = new Set<string>([
  "AbortError",
  "TimeoutError",
  "RequestTimeoutError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
]);

/**
 * Error codes that indicate an expired request/phase deadline (vs a fast
 * connection-phase fault such as `ECONNRESET`/`ECONNREFUSED`).
 */
const DEADLINE_EXPIRY_ERROR_CODES = new Set<string>([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNABORTED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** Message-pattern fallback for deadline-expiry errors that lost name/code. */
const DEADLINE_EXPIRY_MESSAGE_PATTERNS: RegExp[] = [
  /timed out/i,
  /timeout/i,
  /aborted/i,
];

/**
 * Whether an error represents the client's OWN deadline expiring (abort /
 * timeout) rather than a connection-phase network fault. Both classes are
 * "transient" per {@link isTransientNetworkError}, but they have very
 * different retry economics: a connection fault (`ECONNRESET`, `EPIPE`,
 * refused socket) settles in milliseconds and is cheap to retry, while a
 * deadline expiry has already consumed the full per-attempt timeout — blindly
 * retrying it multiplies time-to-failure exactly when the caller most needs
 * to fail fast. Walks the `error.cause` chain like the transient classifier.
 *
 * @param error - The error to classify.
 * @returns true when the fault is a client deadline/abort expiry.
 */
export function isClientDeadlineExpiry(error: unknown): boolean {
  const MAX_CAUSE_DEPTH = 6;
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    if (current instanceof Error || typeof current === "object") {
      const err = current as ErrorLike;

      if (
        typeof err.name === "string" &&
        DEADLINE_EXPIRY_ERROR_NAMES.has(err.name)
      ) {
        return true;
      }

      if (
        typeof err.code === "string" &&
        DEADLINE_EXPIRY_ERROR_CODES.has(err.code)
      ) {
        return true;
      }

      if (typeof err.message === "string") {
        for (const pattern of DEADLINE_EXPIRY_MESSAGE_PATTERNS) {
          if (pattern.test(err.message)) {
            return true;
          }
        }
      }

      current = err.cause;
    } else {
      break;
    }
  }

  return false;
}

/**
 * HTTP statuses the classifier reasons about, named rather than inlined.
 */
const HTTP_STATUS = {
  /** Too Many Requests — retryable, honouring `Retry-After`. */
  RATE_LIMIT: 429,
  /** Unauthorized — never retryable, the credentials are wrong. */
  UNAUTHORIZED: 401,
  /** Forbidden — never retryable, the permissions are wrong. */
  FORBIDDEN: 403,
  /** Lowest status in the client-error band. */
  CLIENT_ERROR_MIN: 400,
  /** Lowest status in the server-error band. */
  SERVER_ERROR_MIN: 500,
  /** First status above the server-error band. */
  SERVER_ERROR_MAX_EXCLUSIVE: 600,
} as const;

/** `Retry-After` is expressed in seconds; delays are handled in milliseconds. */
const MILLISECONDS_PER_SECOND = 1000;

/** A failure that carries an HTTP status, however it was transported. */
interface HttpFailure {
  /** The HTTP status the upstream returned. */
  status: number;
  /** Upstream-mandated delay before the next attempt, in milliseconds. */
  retryAfterMs?: number;
}

/**
 * Narrows an unknown value to an index-signature record so its properties can
 * be probed without an `any` cast.
 * @param value - The value to test.
 * @returns true when the value is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads a `Retry-After` header (seconds) from either a `Headers` instance or a
 * plain header map, and converts it to milliseconds.
 * @param headers - The headers carrier from a Response or an HTTP client error.
 * @returns The delay in milliseconds, or undefined when absent/unparseable.
 */
function readRetryAfterMs(headers: unknown): number | undefined {
  let raw: unknown;
  if (headers instanceof Headers) {
    raw = headers.get("Retry-After");
  } else if (isRecord(headers)) {
    raw = headers["retry-after"] ?? headers["Retry-After"];
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw * MILLISECONDS_PER_SECOND;
  }
  if (typeof raw === "string") {
    const seconds = Number.parseInt(raw, 10);
    if (Number.isFinite(seconds)) {
      return seconds * MILLISECONDS_PER_SECOND;
    }
  }
  return undefined;
}

/**
 * Reads a numeric HTTP status from an unknown property value.
 * @param value - The candidate status value.
 * @returns The status when it is a finite number, otherwise null.
 */
function asStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Extracts the HTTP status from a **typed** carrier: a `Response`, a typed
 * {@link AdapticUtilsError}, an HTTP-client error exposing `response.status`
 * (axios/the Alpaca SDK), or an error exposing a numeric `status`/`statusCode`.
 *
 * @param error - The thrown value.
 * @returns The typed failure, or null when the value carries no status.
 */
function extractTypedHttpFailure(error: unknown): HttpFailure | null {
  if (error instanceof Response) {
    return {
      status: error.status,
      retryAfterMs: readRetryAfterMs(error.headers),
    };
  }

  if (error instanceof AdapticUtilsError) {
    const status = asStatus(
      (error as AdapticUtilsError & { statusCode?: unknown }).statusCode,
    );
    if (status !== null) {
      return { status };
    }
    return null;
  }

  if (!isRecord(error)) {
    return null;
  }

  const nested = error.response;
  if (nested instanceof Response) {
    return {
      status: nested.status,
      retryAfterMs: readRetryAfterMs(nested.headers),
    };
  }
  if (isRecord(nested)) {
    const status = asStatus(nested.status);
    if (status !== null) {
      return { status, retryAfterMs: readRetryAfterMs(nested.headers) };
    }
  }

  const direct = asStatus(error.status) ?? asStatus(error.statusCode);
  return direct === null ? null : { status: direct };
}

/**
 * Maps an HTTP status to the typed retry verdict. This is the single place
 * retryability is decided for status-bearing failures.
 *
 * @param failure - The status (and any upstream-mandated delay).
 * @param config - Effective retry configuration.
 * @returns The typed classification.
 */
function classifyByStatus(
  failure: HttpFailure,
  config: RetryConfig,
): RetryErrorDetails {
  const { status } = failure;

  if (status === HTTP_STATUS.RATE_LIMIT) {
    return {
      type: "RATE_LIMIT",
      reason: "Rate limit exceeded",
      status,
      retryAfter: failure.retryAfterMs,
      isRetryable: true,
    };
  }

  if (
    status === HTTP_STATUS.UNAUTHORIZED ||
    status === HTTP_STATUS.FORBIDDEN
  ) {
    return {
      type: "AUTH_ERROR",
      reason:
        status === HTTP_STATUS.UNAUTHORIZED
          ? "Authentication failed - invalid credentials"
          : "Access forbidden - insufficient permissions",
      status,
      isRetryable: false,
    };
  }

  if (
    status >= HTTP_STATUS.SERVER_ERROR_MIN &&
    status < HTTP_STATUS.SERVER_ERROR_MAX_EXCLUSIVE
  ) {
    return {
      type: "SERVER_ERROR",
      reason: `Server error (${status})`,
      status,
      retryAfter: failure.retryAfterMs,
      isRetryable: config.retryableStatusCodes.includes(status),
    };
  }

  if (
    status >= HTTP_STATUS.CLIENT_ERROR_MIN &&
    status < HTTP_STATUS.SERVER_ERROR_MIN
  ) {
    return {
      type: "CLIENT_ERROR",
      reason: `Client error (${status})`,
      status,
      isRetryable: false,
    };
  }

  return {
    type: "UNKNOWN",
    reason: `Unexpected HTTP status (${status})`,
    status,
    isRetryable: false,
  };
}

/**
 * Classifies a failure into the typed {@link RetryErrorDetails} taxonomy.
 *
 * **An HTTP status is only ever read from a typed carrier.** There is no path
 * from the characters of an error message to a status, and therefore none to a
 * retry decision derived from a status (F-0035). A throw site that wants its
 * status honoured must attach it: throw the `Response`, set `response.status`
 * (axios / the Alpaca SDK do this), set a numeric `status` / `statusCode`, or
 * raise an {@link AdapticUtilsError}. A plain `Error` whose text mentions
 * "429", "503" or "CLIENT_ERROR: 422" is `UNKNOWN` and is **not** retried.
 *
 * Precedence, strongest evidence first:
 *
 * 1. an explicit `Response`, or a thrown `Response`;
 * 2. a **typed** carrier — {@link AdapticUtilsError} (status, else its declared
 *    `isRetryable`), `error.response.status` (axios / Alpaca SDK), or a numeric
 *    `error.status` / `error.statusCode`;
 * 3. transient network conditions — {@link isTransientNetworkError}, which
 *    reads `error.code` / `error.name` / the `cause` chain. This decides
 *    *transience*, never a status, so it can never turn a broker rejection into
 *    a 5xx; a rejection that carries a typed status is already resolved above;
 * 4. otherwise `UNKNOWN`, which is **not** retryable.
 *
 * @param error - The thrown value.
 * @param response - Optional Response already in hand for this failure.
 * @param config - Optional retry-configuration overrides.
 * @returns The typed classification.
 */
export function classifyRetryError(
  error: unknown,
  response: Response | null = null,
  config: Partial<RetryConfig> = {},
): RetryErrorDetails {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  if (response && !response.ok) {
    return classifyByStatus(
      {
        status: response.status,
        retryAfterMs: readRetryAfterMs(response.headers),
      },
      fullConfig,
    );
  }

  const typedFailure = extractTypedHttpFailure(error);
  if (typedFailure) {
    return classifyByStatus(typedFailure, fullConfig);
  }

  // A typed error class that declares its own retryability but carries no
  // status (timeouts, validation failures, network wrappers) is authoritative.
  if (error instanceof AdapticUtilsError) {
    return {
      type: error.isRetryable ? "NETWORK_ERROR" : "CLIENT_ERROR",
      reason: error.message,
      status: null,
      isRetryable: error.isRetryable && fullConfig.retryOnNetworkError,
    };
  }

  // Transient network conditions: fetch TypeErrors, AbortError/TimeoutError,
  // Node/undici error codes, and failures wrapped via `error.cause`.
  if (
    (error instanceof TypeError && error.message.includes("fetch")) ||
    isTransientNetworkError(error)
  ) {
    return {
      type: "NETWORK_ERROR",
      reason:
        error instanceof Error ? error.message : "Transient network error",
      status: null,
      isRetryable: fullConfig.retryOnNetworkError,
    };
  }

  // Unknown error - not retryable by default for safety
  return {
    type: "UNKNOWN",
    reason: error instanceof Error ? error.message : String(error),
    status: null,
    isRetryable: false,
  };
}

/**
 * Calculates the delay before the next retry attempt using exponential backoff
 * with jitter, capped at `maxDelay`. Exported so the backoff contract (growth,
 * cap, jitter) is directly testable rather than only observable through timers.
 *
 * @param attempt - Current attempt number (1-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds (before jitter)
 * @returns Delay in milliseconds
 */
export function calculateRetryBackoff(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
): number {
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
 * @param label - A descriptive label for logging (e.g., 'Massive.fetchTickerInfo')
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
  label: string = "unknown",
): Promise<T> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  let lastError: unknown;

  for (let attempt = 1; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      const result = await fn();

      // If we succeeded after retries, log it
      if (attempt > 1) {
        getLogger().info(
          `[${label}] Succeeded on attempt ${attempt}/${fullConfig.maxRetries}`,
        );
      }

      return result;
    } catch (error: unknown) {
      lastError = error;

      // If this is the last attempt, throw the error.
      // Transient network classes (undici/fetch timeouts, ECONNRESET,
      // AbortError, etc.) are self-healing at the upstream retry layer —
      // the caller re-invokes on the next refresh/poll tick. Logging them
      // at ERROR produces alert noise that does not represent actionable
      // failures. Demote the transient class to WARN with a recovery hint;
      // reserve ERROR for non-transient final failures (auth, schema,
      // contract violations, unknown classes).
      if (attempt === fullConfig.maxRetries) {
        const isTransient = isTransientNetworkError(error);
        const logMeta = {
          error: error instanceof Error ? error.message : String(error),
          attempts: fullConfig.maxRetries,
          timestamp: new Date().toISOString(),
          ...(isTransient
            ? {
                transient: true,
                recoveryHint: "Upstream caller should retry on next cycle",
              }
            : {}),
        };
        if (isTransient) {
          getLogger().warn(
            `[${label}] Failed after ${fullConfig.maxRetries} attempts (transient)`,
            logMeta,
          );
        } else {
          getLogger().error(
            `[${label}] Failed after ${fullConfig.maxRetries} attempts`,
            logMeta,
          );
        }
        throw error;
      }

      // Analyze the error to determine if we should retry
      const response = error instanceof Response ? error : null;
      const errorDetails = classifyRetryError(error, response, fullConfig);

      // If error is not retryable, fail immediately
      if (!errorDetails.isRetryable) {
        getLogger().error(
          `[${label}] Non-retryable error (${errorDetails.type})`,
          {
            reason: errorDetails.reason,
            status: errorDetails.status,
            timestamp: new Date().toISOString(),
          },
        );
        throw error;
      }

      // Calculate delay for next retry
      let delayMs: number;
      if (errorDetails.type === "RATE_LIMIT" && errorDetails.retryAfter) {
        // Use Retry-After header if available
        delayMs = errorDetails.retryAfter;
      } else if (errorDetails.type === "RATE_LIMIT") {
        // For rate limits without Retry-After, use a longer minimum delay
        delayMs = Math.max(
          calculateRetryBackoff(
            attempt,
            fullConfig.baseDelayMs,
            fullConfig.maxDelayMs,
          ),
          5000,
        );
      } else {
        // Standard exponential backoff with jitter
        delayMs = calculateRetryBackoff(
          attempt,
          fullConfig.baseDelayMs,
          fullConfig.maxDelayMs,
        );
      }

      // Log the retry attempt
      getLogger().warn(
        `[${label}] Attempt ${attempt}/${fullConfig.maxRetries} failed: ${errorDetails.reason}. Retrying in ${delayMs}ms...`,
        {
          attemptNumber: attempt,
          totalRetries: fullConfig.maxRetries,
          errorType: errorDetails.type,
          httpStatus: errorDetails.status,
          retryDelay: delayMs,
          timestamp: new Date().toISOString(),
        },
      );

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
export const API_RETRY_CONFIGS: Record<string, Partial<RetryConfig>> = {
  /** Massive.com API - 5 requests/second rate limit */
  MASSIVE: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryOnNetworkError: true,
  },

  /** Alpha Vantage API - 5 requests/minute rate limit (more strict) */
  ALPHA_VANTAGE: {
    maxRetries: 5,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryOnNetworkError: true,
  },

  /** Alpaca API - generally reliable, shorter retry window */
  ALPACA: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryOnNetworkError: true,
  },

  /** Generic crypto API configuration */
  CRYPTO: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryOnNetworkError: true,
  },
};
