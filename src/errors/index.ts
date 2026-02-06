/**
 * Structured error type hierarchy for all API integrations
 *
 * This module provides a comprehensive error handling system for external API integrations,
 * including Alpaca, Polygon, and AlphaVantage services.
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
    public readonly cause?: unknown
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
 * Alpaca API specific errors
 * Handles all errors from Alpaca trading and market data APIs
 */
export class AlpacaApiError extends AdapticUtilsError {
  constructor(
    message: string,
    code: string,
    public readonly statusCode?: number,
    cause?: unknown
  ) {
    // Rate limit (429) and server errors (5xx) are retryable
    const isRetryable = statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
    super(message, code, 'alpaca', isRetryable, cause);
  }
}

/**
 * Polygon.io API specific errors
 * Handles all errors from Polygon market data API
 */
export class PolygonApiError extends AdapticUtilsError {
  constructor(
    message: string,
    code: string,
    public readonly statusCode?: number,
    cause?: unknown
  ) {
    // Rate limit (429) and server errors (5xx) are retryable
    const isRetryable = statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
    super(message, code, 'polygon', isRetryable, cause);
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
    cause?: unknown
  ) {
    // Rate limit (429) and server errors (5xx) are retryable
    const isRetryable = statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
    super(message, code, 'alphavantage', isRetryable, cause);
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
    cause?: unknown
  ) {
    super(
      message,
      'TIMEOUT',
      service,
      true, // Timeouts are always retryable
      cause
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
    cause?: unknown
  ) {
    super(
      message,
      'VALIDATION_ERROR',
      service,
      false, // Validation errors are never retryable
      cause
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
    cause?: unknown
  ) {
    super(
      message,
      'AUTH_ERROR',
      service,
      false, // Auth errors are never retryable
      cause
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
    cause?: unknown
  ) {
    super(
      message,
      'CLIENT_ERROR',
      service,
      false, // Client errors are generally not retryable
      cause
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
    cause?: unknown
  ) {
    super(
      message,
      'SERVER_ERROR',
      service,
      true, // Server errors are always retryable
      cause
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
    cause?: unknown
  ) {
    super(
      message,
      'RATE_LIMIT',
      service,
      true, // Rate limit errors are always retryable
      cause
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
    cause?: unknown
  ) {
    super(
      message,
      'WEBSOCKET_ERROR',
      service,
      isRetryable,
      cause
    );
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
    cause?: unknown
  ) {
    super(
      message,
      'NETWORK_ERROR',
      service,
      true, // Network errors are always retryable
      cause
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
    cause?: unknown
  ) {
    super(
      message,
      'DATA_FORMAT_ERROR',
      service,
      false, // Data format errors are not retryable
      cause
    );
  }
}
