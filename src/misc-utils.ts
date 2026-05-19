// Utility function for debug logging
import { getLogger } from "./logger";
import { withRetry } from "./utils/retry";

/**
 * Per-host circuit-breaker state. One entry per distinct hostname in
 * a sliding window of recent fetch attempts. The breaker opens when
 * the recent failure ratio crosses the threshold; while open, callers
 * fail-fast with a `MASSIVE_CIRCUIT_OPEN` error (the name reflects
 * the original Massive REST motivation but the breaker is host-
 * agnostic and protects any host fronted by `fetchWithRetry`).
 *
 * Why per-host: a single downstream service degrading should not
 * cause callers of every other service (Alpaca, Massive, Anthropic,
 * etc.) to fail-fast. Hostnames are coarse enough to cover the common
 * cases (api.massive.com, paper-api.alpaca.markets, api.alpaca.markets,
 * etc.) without introducing path-level complexity.
 *
 * Why sliding window vs. consecutive: bursty workloads (e.g. a screener
 * tick fanning out 50 concurrent symbol fetches against Massive) need
 * a window-based view because intermittent successes between failures
 * naturally reset a consecutive-failure counter. The window is small
 * enough (recent 20 attempts, ~30 s lifetime) that healing happens
 * within seconds of recovery.
 */
interface CircuitWindowEntry {
  readonly atMs: number;
  readonly ok: boolean;
}

interface CircuitState {
  readonly host: string;
  /**
   * Bounded ring of the most recent fetch outcomes against this host.
   * Newer entries push older ones out once `WINDOW_SIZE` is reached.
   */
  recent: CircuitWindowEntry[];
  /**
   * Timestamp (ms) when the breaker last opened, or 0 if closed.
   * While `Date.now() < openedAt + OPEN_COOLDOWN_MS`, requests
   * fail-fast without reaching the network.
   */
  openedAt: number;
  /**
   * Diagnostic — most recent failure ratio at the moment the breaker
   * tripped, so log lines can surface "61 % of last 20 attempts to
   * api.massive.com failed" without recomputing.
   */
  lastTripFailureRatio: number;
}

/** Sliding-window size (number of recent outcomes tracked per host). */
const CIRCUIT_WINDOW_SIZE = 20;

/** Maximum age (ms) of an outcome before it is dropped from the window. */
const CIRCUIT_WINDOW_TTL_MS = 30_000;

/**
 * Failure ratio (0..1) at which the breaker trips when the window
 * is full (i.e. CIRCUIT_WINDOW_SIZE outcomes recorded).
 *
 * Tuned to be permissive enough that a few transient failures during
 * normal operation do not trip the breaker, but tight enough that a
 * persistent upstream outage (where >= half of recent calls are
 * failing) is detected quickly. With WINDOW=20 and threshold=0.6 we
 * need 12 failures within the most recent 20 attempts to trip.
 */
const CIRCUIT_TRIP_FAILURE_RATIO = 0.6;

/**
 * Minimum number of recent outcomes required before the failure-ratio
 * gate is even evaluated. Without this guard, a single failure on a
 * cold host would give a 100 % ratio and trip the breaker on the
 * second attempt — which would be useless protection while also being
 * highly destructive.
 */
const CIRCUIT_MIN_SAMPLES = 8;

/**
 * How long the breaker stays open before transitioning to half-open
 * (i.e. allowing the next request through as a probe). The next
 * outcome — success or failure — fully recloses or re-opens the
 * breaker. 5 s aligns with typical upstream recovery times and is
 * short enough that the next caller drives the probe.
 */
const CIRCUIT_OPEN_COOLDOWN_MS = 5_000;

/**
 * Fail-fast latency. We sleep a short, deterministic amount before
 * rejecting so the upstream caller's outer timeout (commonly 10–25 s)
 * sees a clean rejection rather than a synchronous reject-storm that
 * could starve other event-loop work. 100 ms aligns with the user's
 * G1 analysis target: "cap per-symbol fallback latency at 100 ms
 * during outages — eliminating the 25 s × N-concurrent-symbols
 * event-loop hog."
 */
const CIRCUIT_FAIL_FAST_LATENCY_MS = 100;

const circuitStates = new Map<string, CircuitState>();

function getCircuitState(host: string): CircuitState {
  let state = circuitStates.get(host);
  if (!state) {
    state = {
      host,
      recent: [],
      openedAt: 0,
      lastTripFailureRatio: 0,
    };
    circuitStates.set(host, state);
  }
  return state;
}

function pruneStaleSamples(state: CircuitState, now: number): void {
  const cutoff = now - CIRCUIT_WINDOW_TTL_MS;
  // Remove entries older than the TTL. Window is small so a simple
  // filter is fine — no need for a deque structure.
  if (state.recent.length === 0) return;
  let firstFreshIndex = 0;
  while (
    firstFreshIndex < state.recent.length &&
    state.recent[firstFreshIndex]!.atMs < cutoff
  ) {
    firstFreshIndex += 1;
  }
  if (firstFreshIndex > 0) {
    state.recent.splice(0, firstFreshIndex);
  }
}

function recordOutcome(host: string, ok: boolean): void {
  const now = Date.now();
  const state = getCircuitState(host);
  pruneStaleSamples(state, now);
  state.recent.push({ atMs: now, ok });
  if (state.recent.length > CIRCUIT_WINDOW_SIZE) {
    state.recent.shift();
  }

  // If we are in the open or half-open window and just received an
  // outcome, decide whether to close or re-open.
  if (state.openedAt > 0) {
    if (now - state.openedAt >= CIRCUIT_OPEN_COOLDOWN_MS) {
      // Half-open probe outcome arrived.
      if (ok) {
        // Recovered. Close the breaker.
        state.openedAt = 0;
        state.lastTripFailureRatio = 0;
        getLogger().info(
          `Circuit breaker for ${host} closed — upstream recovered`,
          { host },
        );
      } else {
        // Probe failed. Re-open the breaker for another cooldown.
        state.openedAt = now;
      }
      return;
    }
    // Still inside the cooldown window — outcomes are recorded for
    // statistics but the breaker stays open regardless.
    return;
  }

  // Closed breaker — evaluate whether the failure ratio has tripped.
  if (state.recent.length < CIRCUIT_MIN_SAMPLES) return;
  const failures = state.recent.reduce(
    (acc, entry) => acc + (entry.ok ? 0 : 1),
    0,
  );
  const ratio = failures / state.recent.length;
  if (ratio >= CIRCUIT_TRIP_FAILURE_RATIO) {
    state.openedAt = now;
    state.lastTripFailureRatio = ratio;
    getLogger().warn(
      `Circuit breaker for ${host} opened — ${failures}/${state.recent.length} recent attempts failed (${(ratio * 100).toFixed(0)}%); fail-fast for ${CIRCUIT_OPEN_COOLDOWN_MS}ms`,
      {
        host,
        recentFailures: failures,
        recentSamples: state.recent.length,
        failureRatio: ratio,
        cooldownMs: CIRCUIT_OPEN_COOLDOWN_MS,
      },
    );
  }
}

function isCircuitOpen(host: string, now: number): boolean {
  const state = circuitStates.get(host);
  if (!state || state.openedAt === 0) return false;
  pruneStaleSamples(state, now);
  return now - state.openedAt < CIRCUIT_OPEN_COOLDOWN_MS;
}

/**
 * Error thrown by {@link fetchWithRetry} when the per-host circuit
 * breaker is open and fail-fast suppression is in effect.
 *
 * Carries the host, the failure ratio that tripped the breaker, and
 * the remaining cooldown so callers can render an actionable log.
 */
export class CircuitOpenError extends Error {
  readonly code = "MASSIVE_CIRCUIT_OPEN";
  readonly host: string;
  readonly tripFailureRatio: number;
  readonly cooldownRemainingMs: number;

  constructor(
    host: string,
    tripFailureRatio: number,
    cooldownRemainingMs: number,
  ) {
    super(
      `Circuit open for ${host} — fail-fast (recent failure ratio ${(tripFailureRatio * 100).toFixed(0)}%, retry in ${cooldownRemainingMs}ms)`,
    );
    this.name = "CircuitOpenError";
    this.host = host;
    this.tripFailureRatio = tripFailureRatio;
    this.cooldownRemainingMs = cooldownRemainingMs;
  }
}

/**
 * Force-close the breaker for a given host. Exposed for tests and
 * operator-runbook scripts so a stuck-open breaker can be reset
 * without bouncing the process. Not intended for hot-path use.
 *
 * @param host The hostname whose breaker should be reset.
 */
export function resetCircuitBreaker(host: string): void {
  const state = circuitStates.get(host);
  if (!state) return;
  state.openedAt = 0;
  state.lastTripFailureRatio = 0;
  state.recent = [];
}

/**
 * Snapshot of all known per-host circuit-breaker states. Intended for
 * an operational-truth / status endpoint to surface upstream health.
 *
 * @returns Map of host → {open, openedAt, recentSamples, failureRatio,
 *          lastTripFailureRatio}.
 */
export function getCircuitBreakerSnapshot(): Record<
  string,
  {
    open: boolean;
    openedAt: number;
    cooldownRemainingMs: number;
    recentSamples: number;
    failureRatio: number;
    lastTripFailureRatio: number;
  }
> {
  const now = Date.now();
  const snapshot: ReturnType<typeof getCircuitBreakerSnapshot> = {};
  for (const [host, state] of circuitStates) {
    pruneStaleSamples(state, now);
    const failures = state.recent.reduce(
      (acc, entry) => acc + (entry.ok ? 0 : 1),
      0,
    );
    const ratio = state.recent.length > 0 ? failures / state.recent.length : 0;
    snapshot[host] = {
      open: state.openedAt > 0 && now - state.openedAt < CIRCUIT_OPEN_COOLDOWN_MS,
      openedAt: state.openedAt,
      cooldownRemainingMs:
        state.openedAt > 0
          ? Math.max(0, CIRCUIT_OPEN_COOLDOWN_MS - (now - state.openedAt))
          : 0,
      recentSamples: state.recent.length,
      failureRatio: ratio,
      lastTripFailureRatio: state.lastTripFailureRatio,
    };
  }
  return snapshot;
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Define the possible log types as a const array for better type inference
const _LOG_TYPES = ["info", "warn", "error", "debug", "trace"] as const;
// Create a union type from the array
type LogType = (typeof _LOG_TYPES)[number];

/**
 * Debug logging utility that respects environment debug flags.
 * Logs messages through the configured structured logger when LUMIC_DEBUG
 * is enabled. The level is preserved by routing through the corresponding
 * logger method — the structured logger already encodes the level, so we
 * do NOT prefix the message text with `[DEBUG][LEVEL]` (that produced
 * malformed `[INFO] [DEBUG][INFO] ...` lines in downstream consumers
 * that wrap this logger with Pino).
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
  type: LogType = "info",
) => {
  const debugMode =
    process.env.LUMIC_DEBUG === "true" ||
    process.env.lumic_debug === "true" ||
    false;

  if (!debugMode) return;

  const logger = getLogger();
  const context =
    data !== undefined
      ? typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : { data }
      : undefined;

  switch (type) {
    case "error":
      logger.error(message, context);
      break;
    case "warn":
      logger.warn(message, context);
      break;
    case "debug":
      logger.debug(message, context);
      break;
    case "trace":
      // trace maps to debug in our logger interface
      logger.debug(message, context);
      break;
    case "info":
    default:
      logger.info(message, context);
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
      if (key.toLowerCase() === "apikey") {
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
  initialBackoff: number = 1000,
): Promise<Response> {
  // Per-host circuit-breaker check. When upstream is failing
  // pervasively (e.g. Massive REST in an outage), short-circuit to a
  // 100 ms fail-fast rejection so the caller's outer timeout (25 s,
  // 10 s, etc.) does not pile concurrent symbol fetches against a
  // dead host. Without this, an upstream outage during a screener tick
  // can lock up the event loop for up to (timeout × N-concurrent-symbols).
  const host = hostnameFromUrl(url);
  if (host) {
    const now = Date.now();
    if (isCircuitOpen(host, now)) {
      const state = getCircuitState(host);
      const cooldownRemainingMs = Math.max(
        0,
        CIRCUIT_OPEN_COOLDOWN_MS - (now - state.openedAt),
      );
      await sleep(CIRCUIT_FAIL_FAST_LATENCY_MS);
      throw new CircuitOpenError(
        host,
        state.lastTripFailureRatio,
        cooldownRemainingMs,
      );
    }
  }

  return withRetry(
    async () => {
      let response: Response;
      try {
        response = await fetch(url, options);
      } catch (networkError) {
        // Network failure (e.g. DNS, connection refused, TLS abort).
        // Record against the breaker so a sustained outage trips it
        // for subsequent calls; then re-throw so withRetry handles
        // its own retry policy.
        if (host) recordOutcome(host, false);
        throw networkError;
      }

      if (!response.ok) {
        // Classify the outcome for the circuit breaker. 5xx and 429
        // are upstream-health signals (record as failure). 4xx client
        // errors are caller-side and should NOT affect the breaker —
        // a request with a bad API key shouldn't trip the host's
        // breaker for everyone else.
        const upstreamUnhealthy =
          response.status === 429 ||
          (response.status >= 500 && response.status < 600);
        if (host) recordOutcome(host, !upstreamUnhealthy);

        // Enhanced HTTP error handling with specific error types
        if (response.status === 429) {
          // Check for Retry-After header
          const retryAfter = response.headers.get("Retry-After");
          const retryDelay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : null;

          const error = new Error(
            `RATE_LIMIT: ${response.status}${retryDelay ? `:${retryDelay}` : ""}`,
          );
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

      // Success — record against the breaker so a healthy upstream
      // closes any half-open state cleanly.
      if (host) recordOutcome(host, true);

      return response;
    },
    {
      maxRetries: retries,
      baseDelayMs: initialBackoff,
      maxDelayMs: 30000,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      retryOnNetworkError: true,
    },
    `fetchWithRetry: ${hideApiKeyFromurl(url)}`,
  );
}

/**
 * Validates a Massive.com API key by making a test request.
 * @param apiKey - The API key to validate.
 * @returns Promise that resolves to true if valid, false otherwise.
 */
export async function validateMassiveApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.massive.com/v1/meta/symbols?apikey=${apiKey}&limit=1`,
    );
    if (response.status === 401) {
      throw new Error("Invalid or expired Massive.com API key");
    }
    if (response.status === 403) {
      throw new Error("Massive.com API key lacks required permissions");
    }
    return response.ok;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    getLogger().error("Massive.com API key validation failed:", {
      errorMessage,
    });
    return false;
  }
}
