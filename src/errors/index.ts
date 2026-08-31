/**
 * Structured error type hierarchy for all API integrations
 *
 * This module provides a comprehensive error handling system for external API integrations,
 * including Alpaca, Massive, and AlphaVantage services.
 */

/**
 * Base error class for all @adaptic/utils errors
 * Extends Error with additional context about service, error code, and retry capability
 */
export class AdapticUtilsError extends Error {
  public readonly name: string;

  constructor(
    message: string,
    public readonly code: string,
    public readonly service: string,
    public readonly isRetryable: boolean = false,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;

    // Maintains proper stack trace for where error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Normalized Alpaca broker-rejection detail, extracted once at the vendor
 * boundary from the SDK/axios `error.response.data` payload.
 *
 * Alpaca reports the machine-readable reason for a rejection in the HTTP
 * response body — a numeric `code` (e.g. `42210000` "cannot replace order in
 * pending_cancel status", `40310000` "insufficient qty available for order")
 * and a human `message` — while the SDK's own `Error.message` is only
 * "Request failed with status code NNN". Surfacing that body as a typed field
 * is the vendor-boundary contract (utils engineering rule 2): downstream
 * consumers branch on {@link brokerCode} instead of string-matching a
 * flattened message, and the `422/42210000` stale-order reject becomes a
 * typed, terminal outcome rather than a leaked, lossy quirk.
 */
export interface AlpacaBrokerErrorDetail {
  /**
   * Alpaca's machine-readable numeric error code from the response body, or
   * `null` when the body carried no numeric code. Never fabricated — an absent
   * code stays `null`, it never resolves to `0` or a guessed value.
   */
  readonly brokerCode: number | null;
  /** Alpaca's human-readable reason from the response body, or `null` when absent. */
  readonly brokerMessage: string | null;
  /** The HTTP status the rejection was carried on, or `null` when unknown. */
  readonly statusCode: number | null;
  /**
   * The raw vendor payload (`error.response.data`) exactly as received,
   * preserved verbatim for diagnostics and forward-compatibility with codes a
   * given release does not yet enumerate.
   */
  readonly raw: unknown;
}

/**
 * Alpaca API specific errors
 * Handles all errors from Alpaca trading and market data APIs
 */
export class AlpacaApiError extends AdapticUtilsError {
  constructor(
    message: string,
    code: string,
    public readonly statusCode?: number,
    cause?: unknown,
    /**
     * Normalized Alpaca broker-rejection detail (numeric code + message + raw
     * body), when the underlying rejection carried one. Additive and optional:
     * synthetic errors and non-broker failures omit it, and every existing
     * consumer of `message`/`code`/`statusCode`/`cause` is unaffected.
     */
    public readonly brokerError?: AlpacaBrokerErrorDetail,
  ) {
    // Rate limit (429) and server errors (5xx) are retryable
    const isRetryable =
      statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
    super(message, code, "alpaca", isRetryable, cause);
  }
}

/**
 * Massive.com API specific errors
 * Handles all errors from Massive market data API
 */
export class MassiveApiError extends AdapticUtilsError {
  constructor(
    message: string,
    code: string,
    public readonly statusCode?: number,
    cause?: unknown,
  ) {
    // Rate limit (429) and server errors (5xx) are retryable
    const isRetryable =
      statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
    super(message, code, "massive", isRetryable, cause);
  }
}

/**
 * AlphaVantage API specific errors
 * Handles all errors from AlphaVantage financial data API
 */
export class AlphaVantageError extends AdapticUtilsError {
  constructor(
    message: string,
    code: string,
    public readonly statusCode?: number,
    cause?: unknown,
  ) {
    // Rate limit (429) and server errors (5xx) are retryable
    const isRetryable =
      statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
    super(message, code, "alphavantage", isRetryable, cause);
  }
}

/**
 * Network timeout errors
 * Used when API requests exceed configured timeout limits
 * Always retryable as timeouts are often transient
 */
export class TimeoutError extends AdapticUtilsError {
  constructor(
    message: string,
    public readonly service: string,
    public readonly timeoutMs: number,
    cause?: unknown,
  ) {
    super(
      message,
      "TIMEOUT",
      service,
      true, // Timeouts are always retryable
      cause,
    );
  }
}

/**
 * Input validation errors
 * Used when function inputs fail validation checks
 * Never retryable as the inputs need to be corrected
 */
export class ValidationError extends AdapticUtilsError {
  constructor(
    message: string,
    public readonly service: string,
    public readonly invalidField?: string,
    cause?: unknown,
  ) {
    super(
      message,
      "VALIDATION_ERROR",
      service,
      false, // Validation errors are never retryable
      cause,
    );
  }
}

/**
 * Authentication and authorization errors
 * Used when API credentials are invalid, expired, or lack permissions
 * Never retryable as credentials need to be updated
 */
export class AuthenticationError extends AdapticUtilsError {
  constructor(
    message: string,
    public readonly service: string,
    public readonly statusCode?: number,
    cause?: unknown,
  ) {
    super(
      message,
      "AUTH_ERROR",
      service,
      false, // Auth errors are never retryable
      cause,
    );
  }
}

/**
 * HTTP client errors (4xx)
 * Used for client-side errors that are not authentication or validation related
 * Generally not retryable unless specific status codes indicate otherwise
 */
export class HttpClientError extends AdapticUtilsError {
  constructor(
    message: string,
    public readonly service: string,
    public readonly statusCode: number,
    cause?: unknown,
  ) {
    super(
      message,
      "CLIENT_ERROR",
      service,
      false, // Client errors are generally not retryable
      cause,
    );
  }
}

/**
 * HTTP server errors (5xx)
 * Used for server-side errors from external APIs
 * Always retryable as server issues are often transient
 */
export class HttpServerError extends AdapticUtilsError {
  constructor(
    message: string,
    public readonly service: string,
    public readonly statusCode: number,
    cause?: unknown,
  ) {
    super(
      message,
      "SERVER_ERROR",
      service,
      true, // Server errors are always retryable
      cause,
    );
  }
}

/**
 * Rate limit errors (429)
 * Used when API rate limits are exceeded
 * Always retryable, often with retry-after header information
 */
export class RateLimitError extends AdapticUtilsError {
  constructor(
    message: string,
    public readonly service: string,
    public readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(
      message,
      "RATE_LIMIT",
      service,
      true, // Rate limit errors are always retryable
      cause,
    );
  }
}

/**
 * WebSocket connection errors
 * Used for WebSocket-specific connection and communication failures
 * Retryability depends on the specific error condition
 */
export class WebSocketError extends AdapticUtilsError {
  constructor(
    message: string,
    public readonly service: string,
    isRetryable: boolean = true,
    cause?: unknown,
  ) {
    super(message, "WEBSOCKET_ERROR", service, isRetryable, cause);
  }
}

/**
 * Network errors (connection failures, DNS issues, etc.)
 * Used for low-level network failures
 * Always retryable as network issues are often transient
 */
export class NetworkError extends AdapticUtilsError {
  constructor(
    message: string,
    public readonly service: string,
    cause?: unknown,
  ) {
    super(
      message,
      "NETWORK_ERROR",
      service,
      true, // Network errors are always retryable
      cause,
    );
  }
}

/**
 * Unsupported brokerage provider errors
 * Thrown when a broker operation is requested for a provider that has no
 * implemented integration (e.g. IBKR or COINBASE before their adapters land,
 * or an unrecognised provider string from an untyped caller).
 * Never retryable — the caller must route to a supported provider.
 */
export class UnsupportedBrokerError extends AdapticUtilsError {
  constructor(
    /** The provider that was requested but is not supported. */
    public readonly provider: string,
    cause?: unknown,
  ) {
    super(
      `Brokerage provider "${provider}" is not supported. Supported providers: ALPACA`,
      "UNSUPPORTED_BROKER",
      "broker",
      false, // Unsupported providers are never retryable
      cause,
    );
  }
}

/**
 * Data parsing and format errors
 * Used when API responses cannot be parsed or are in unexpected format
 * Not retryable as the data format issue needs investigation
 */
export class DataFormatError extends AdapticUtilsError {
  constructor(
    message: string,
    public readonly service: string,
    cause?: unknown,
  ) {
    super(
      message,
      "DATA_FORMAT_ERROR",
      service,
      false, // Data format errors are not retryable
      cause,
    );
  }
}

/**
 * Broker-side duplicate `client_order_id` rejection (Alpaca HTTP 422,
 * "client order id must be unique").
 *
 * Thrown by the order-creation paths of `AlpacaTradingAPI` so callers can
 * distinguish "this exact order was already submitted" from a genuine order
 * rejection. When {@link wasDerived} is `false` the id was caller-supplied and
 * the caller owns idempotency semantics (a legitimate repeat needs a new
 * explicit id or an `idempotencyNonce`). When `true`, the wrapper's automatic
 * recovery (existing-order lookup, then one salted resubmit) was exhausted.
 *
 * Never retryable with the same id — resubmitting the identical
 * `client_order_id` will 422 again.
 */
export class DuplicateClientOrderIdError extends AlpacaApiError {
  constructor(
    message: string,
    /** The `client_order_id` that collided broker-side. */
    public readonly clientOrderId: string,
    /** Whether the colliding id was derived by the wrapper (vs caller-supplied). */
    public readonly wasDerived: boolean,
    cause?: unknown,
  ) {
    // Carry the normalized broker payload forward from the original rejection
    // (the `cause`) so a consumer can read the numeric code without re-parsing.
    super(
      message,
      "DUPLICATE_CLIENT_ORDER_ID",
      422,
      cause,
      extractAlpacaBrokerError(cause),
    );
  }
}

/** Max depth walked along the `error.cause` chain when locating a broker payload. */
const MAX_BROKER_ERROR_CAUSE_DEPTH = 6;

/**
 * Narrows an unknown value to an index-signature record so nested properties
 * can be probed without an unsafe cast.
 * @param value - The value to test.
 * @returns true when the value is a non-null object.
 */
function isBrokerErrorRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads a finite number from an unknown value, accepting Alpaca's numeric
 * `code` whether it arrives as a JSON number or a numeric string.
 * @param value - The candidate value.
 * @returns The number when finite, otherwise null.
 */
function asBrokerCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Reads the axios/SDK-shaped broker payload from a SINGLE node's `response`
 * field: an object `response.data` (`{ code, message }`) or a `response.data`
 * left as an unparsed JSON string (the raw-`fetch` seams attach the body as a
 * string). A known HTTP `response.status` is itself a broker-boundary signal —
 * a `422` whose body carries no numeric code is still a `422` — so a
 * status-only detail (`brokerCode: null`) is surfaced rather than discarded.
 * Returns `undefined` only when the node carries no `response` and no status.
 *
 * @param node - The candidate error-like record.
 * @returns The normalized detail, or undefined when the node has no response.
 */
function readResponseBrokerDetail(
  node: Record<string, unknown>,
): AlpacaBrokerErrorDetail | undefined {
  const response = node.response;
  if (!isBrokerErrorRecord(response)) {
    return undefined;
  }
  const statusCode = asBrokerCode(response.status);

  // A known status with no structured code/message: preserve the status rather
  // than discarding it (a code null is never fabricated into a value).
  const statusOnly: AlpacaBrokerErrorDetail | undefined =
    statusCode === null
      ? undefined
      : { brokerCode: null, brokerMessage: null, statusCode, raw: response.data };

  // Keep the raw body in its own const so the string narrowing survives the
  // JSON.parse (a reassigned `let` would widen back to `unknown` in the catch).
  const rawData: unknown = response.data;
  let parsed: unknown = rawData;
  if (typeof rawData === "string") {
    try {
      parsed = JSON.parse(rawData) as unknown;
    } catch {
      // A non-JSON string body carries a human reason but no structured code.
      return { brokerCode: null, brokerMessage: rawData, statusCode, raw: rawData };
    }
  }
  if (!isBrokerErrorRecord(parsed)) {
    return statusOnly;
  }

  const brokerCode = asBrokerCode(parsed.code);
  const brokerMessage =
    typeof parsed.message === "string" ? parsed.message : null;
  if (brokerCode === null && brokerMessage === null) {
    return statusOnly;
  }
  return { brokerCode, brokerMessage, statusCode, raw: rawData };
}

/**
 * Reads the normalized broker detail from a SINGLE error-like node, without
 * walking its `cause` chain. Recognizes two carriers on the node: an
 * {@link AlpacaBrokerErrorDetail} already attached as `brokerError`, and an
 * axios/SDK-shaped `response` body (object or unparsed JSON string). A carrier
 * bearing a numeric code wins over a code-less one, so an enrichment that
 * resolved no code never shadows a numeric code sitting in the same node's raw
 * response body. Returns `undefined` when the node carries no broker payload,
 * so absence is never converted into a fabricated code.
 *
 * @param node - The candidate error-like value.
 * @returns The normalized detail, or undefined.
 */
function readBrokerDetailFromNode(
  node: unknown,
): AlpacaBrokerErrorDetail | undefined {
  if (!isBrokerErrorRecord(node)) {
    return undefined;
  }

  // Carrier 1: a detail already normalized and attached by this module
  // (e.g. AlpacaApiError.brokerError or a value enriched via enrichAlpacaError).
  let attachedDetail: AlpacaBrokerErrorDetail | undefined;
  const attached = node.brokerError;
  if (isBrokerErrorRecord(attached) && "brokerCode" in attached) {
    attachedDetail = {
      brokerCode: asBrokerCode(attached.brokerCode),
      brokerMessage:
        typeof attached.brokerMessage === "string"
          ? attached.brokerMessage
          : null,
      statusCode: asBrokerCode(attached.statusCode),
      raw: attached.raw,
    };
    // A numeric code on the attached detail is authoritative for this node.
    if (attachedDetail.brokerCode !== null) {
      return attachedDetail;
    }
  }

  // Carrier 2: an axios/SDK-shaped `response` body on the same node. Prefer a
  // numeric code found here over a code-less attached detail.
  const responseDetail = readResponseBrokerDetail(node);
  if (responseDetail?.brokerCode != null) {
    return responseDetail;
  }
  return attachedDetail ?? responseDetail;
}

/**
 * Extracts the normalized {@link AlpacaBrokerErrorDetail} from a thrown Alpaca
 * SDK/axios error, reading the vendor payload at `error.response.data` and,
 * failing that, walking the `error.cause` chain (the raw SDK error is preserved
 * there once a wrapper has re-thrown). Returns `undefined` when no broker
 * payload is present anywhere on the chain.
 *
 * Pure and outcome-independent: derived solely from Alpaca's documented error
 * contract, with zero reference to realized P&L, fills, or account state.
 *
 * A node bearing a numeric broker code wins immediately; a code-less detail
 * (status-only or message-only) found higher on the chain is held as a fallback
 * while the walk continues, so a numeric code sitting deeper in the `cause`
 * chain is never shadowed by a shallower code-less node — and when no code
 * exists anywhere, the code-less detail is still returned rather than discarded.
 *
 * @param error - The thrown value.
 * @returns The normalized broker detail, or undefined when none is present.
 */
export function extractAlpacaBrokerError(
  error: unknown,
): AlpacaBrokerErrorDetail | undefined {
  let current: unknown = error;
  let fallback: AlpacaBrokerErrorDetail | undefined;
  for (
    let depth = 0;
    depth < MAX_BROKER_ERROR_CAUSE_DEPTH && current != null;
    depth++
  ) {
    const detail = readBrokerDetailFromNode(current);
    if (detail !== undefined) {
      if (detail.brokerCode !== null) {
        return detail;
      }
      if (fallback === undefined) {
        fallback = detail;
      }
    }
    if (!isBrokerErrorRecord(current)) {
      break;
    }
    current = current.cause;
  }
  return fallback;
}

/**
 * Returns the normalized {@link AlpacaBrokerErrorDetail} for a thrown error, or
 * `null` when the error carries no Alpaca broker payload. The typed
 * vendor-boundary replacement for reaching into `err.response.data` downstream.
 *
 * @param error - The thrown value.
 * @returns The normalized detail, or null.
 */
export function getAlpacaBrokerErrorDetail(
  error: unknown,
): AlpacaBrokerErrorDetail | null {
  return extractAlpacaBrokerError(error) ?? null;
}

/**
 * Returns Alpaca's machine-readable numeric broker error code from a thrown
 * error (walking the `cause` chain), or `null` when absent. The typed
 * replacement for `err.message.includes("42210000")`:
 *
 * ```typescript
 * if (getAlpacaBrokerErrorCode(err) === 42210000) { ... } // stale-order reject
 * ```
 *
 * The code resolves uniformly across every vendor seam: the SDK/axios path
 * (where `response.data` rides along for free) and the raw-`fetch` paths — the
 * `AlpacaTradingAPI` class `makeRequest` and the legacy order helpers, which
 * throw via {@link alpacaHttpError} so the verbatim status + body are carried as
 * a typed `.response`. A consumer branching on the stale-order `42210000` gets
 * the same answer regardless of which seam produced the reject, including the
 * dominant percent-trailing-stop tighten path where a plain `Error` previously
 * dropped the broker payload.
 *
 * @param error - The thrown value.
 * @returns The numeric broker code, or null.
 */
export function getAlpacaBrokerErrorCode(error: unknown): number | null {
  return extractAlpacaBrokerError(error)?.brokerCode ?? null;
}

/**
 * Additively enriches a thrown error with the normalized Alpaca broker detail
 * extracted from `source` (the original SDK/axios rejection), WITHOUT changing
 * the target's `message`, `name`, or prototype. It:
 *
 *  - sets `target.cause = source` when the target has no cause yet, so the raw
 *    rejection (and its `response.data`) is never lost down the wrapper chain;
 *  - attaches the normalized {@link AlpacaBrokerErrorDetail} as
 *    `target.brokerError` when `source` carried a broker payload.
 *
 * Purely additive by construction: a caller writes
 * `throw enrichAlpacaError(new Error(msg), error)` and every consumer that read
 * `error.message` or `error instanceof Error` before reads the identical value
 * after, while new consumers can call {@link getAlpacaBrokerErrorCode}. This is
 * the restoration for the dropped-`response.data` defect (Alpaca `42210000` /
 * `40310000` reaching consumers only as a lossy "status code NNN" string).
 *
 * @param target - The wrapper error about to be thrown.
 * @param source - The original rejection to normalize and preserve.
 * @returns The same `target`, typed to expose the optional `brokerError`.
 */
export function enrichAlpacaError<E extends Error>(
  target: E,
  source: unknown,
): E & { brokerError?: AlpacaBrokerErrorDetail } {
  const enriched = target as E & {
    brokerError?: AlpacaBrokerErrorDetail;
    cause?: unknown;
  };
  if (enriched.cause === undefined && source !== undefined) {
    enriched.cause = source;
  }
  const detail = extractAlpacaBrokerError(source);
  if (detail !== undefined) {
    enriched.brokerError = detail;
  }
  return enriched;
}

/**
 * Builds a thrown-ready `Error` for a raw-`fetch` Alpaca rejection, carrying the
 * verbatim HTTP status + body as a typed `.response` so that
 * {@link getAlpacaBrokerErrorCode} / {@link extractAlpacaBrokerError} resolve
 * the numeric broker code on the `fetch` seams (the `AlpacaTradingAPI` class
 * `makeRequest` and the legacy functional order helpers) exactly as they
 * already do on the SDK seam — where the SDK/axios error carries `response.data`
 * for free but a hand-thrown `new Error(...)` does not.
 *
 * Purely additive by construction: the `.message` is caller-supplied and
 * returned byte-identical (so message string-matching consumers are
 * unaffected), the returned value `instanceof Error` still holds, and only the
 * `.response` surface is added. The `data` is the raw string body exactly as
 * `response.text()` returned it — {@link extractAlpacaBrokerError} parses a
 * JSON-string body itself, so no vendor payload is lost or reshaped here.
 *
 * @param message - The error message, thrown verbatim (never rewritten).
 * @param status - The HTTP status the rejection arrived on.
 * @param body - The raw response body (`response.text()`), preserved verbatim.
 * @returns An `Error` whose `.response` exposes `{ status, data: body }`.
 */
export function alpacaHttpError(
  message: string,
  status: number,
  body: string,
): Error & { response: { status: number; data: string } } {
  return Object.assign(new Error(message), {
    response: { status, data: body },
  });
}
