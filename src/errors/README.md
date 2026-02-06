# Error Type Hierarchy

This module provides a structured error type hierarchy for all API integrations in `@adaptic/utils`.

## Overview

All error classes extend from `AdapticUtilsError`, which provides:
- Structured error information (code, service, message)
- Automatic retry capability detection based on error type
- Error chaining with `cause` parameter
- Proper stack traces

## Error Classes

### Base Error

#### `AdapticUtilsError`
Base class for all utils errors.

```typescript
new AdapticUtilsError(
  message: string,
  code: string,
  service: string,
  isRetryable: boolean,
  cause?: unknown
)
```

### API-Specific Errors

#### `AlpacaApiError`
Errors from Alpaca Trading and Market Data APIs.

```typescript
new AlpacaApiError(
  message: string,
  code: string,
  statusCode?: number,
  cause?: unknown
)
```

**Auto-retryable when:**
- Status code is 429 (rate limit)
- Status code is 5xx (server error)

#### `PolygonApiError`
Errors from Polygon.io market data API.

```typescript
new PolygonApiError(
  message: string,
  code: string,
  statusCode?: number,
  cause?: unknown
)
```

**Auto-retryable when:**
- Status code is 429 (rate limit)
- Status code is 5xx (server error)

#### `AlphaVantageError`
Errors from AlphaVantage financial data API.

```typescript
new AlphaVantageError(
  message: string,
  code: string,
  statusCode?: number,
  cause?: unknown
)
```

**Auto-retryable when:**
- Status code is 429 (rate limit)
- Status code is 5xx (server error)

### General Error Types

#### `TimeoutError`
Request timeout errors. Always retryable.

```typescript
new TimeoutError(
  message: string,
  service: string,
  timeoutMs: number,
  cause?: unknown
)
```

#### `ValidationError`
Input validation failures. Never retryable.

```typescript
new ValidationError(
  message: string,
  service: string,
  invalidField?: string,
  cause?: unknown
)
```

#### `AuthenticationError`
Authentication/authorization failures. Never retryable.

```typescript
new AuthenticationError(
  message: string,
  service: string,
  statusCode?: number,
  cause?: unknown
)
```

#### `RateLimitError`
Rate limit exceeded. Always retryable.

```typescript
new RateLimitError(
  message: string,
  service: string,
  retryAfterMs?: number,
  cause?: unknown
)
```

#### `HttpClientError`
4xx client errors. Never retryable.

```typescript
new HttpClientError(
  message: string,
  service: string,
  statusCode: number,
  cause?: unknown
)
```

#### `HttpServerError`
5xx server errors. Always retryable.

```typescript
new HttpServerError(
  message: string,
  service: string,
  statusCode: number,
  cause?: unknown
)
```

#### `WebSocketError`
WebSocket connection/communication errors.

```typescript
new WebSocketError(
  message: string,
  service: string,
  isRetryable: boolean,
  cause?: unknown
)
```

#### `NetworkError`
Low-level network failures. Always retryable.

```typescript
new NetworkError(
  message: string,
  service: string,
  cause?: unknown
)
```

#### `DataFormatError`
Data parsing/format errors. Never retryable.

```typescript
new DataFormatError(
  message: string,
  service: string,
  cause?: unknown
)
```

## Usage Examples

### Basic Usage

```typescript
import { AlpacaApiError, ValidationError } from '@adaptic/utils';

// API error with status code
throw new AlpacaApiError(
  'Failed to fetch account details',
  'ACCOUNT_FETCH_ERROR',
  500
);

// Validation error
throw new ValidationError(
  'Symbol must be a non-empty string',
  'alpaca',
  'symbol'
);
```

### Error Handling with Retry Logic

```typescript
import { AlpacaApiError, TimeoutError } from '@adaptic/utils';

async function fetchWithRetry(fn: () => Promise<any>, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (error instanceof AdapticUtilsError && error.isRetryable) {
        console.log(`Attempt ${attempt} failed, retrying...`);

        // If it's a rate limit error, wait for the specified time
        if (error instanceof RateLimitError && error.retryAfterMs) {
          await new Promise(resolve => setTimeout(resolve, error.retryAfterMs));
        } else {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }

        continue;
      }

      // Non-retryable error, throw immediately
      throw error;
    }
  }

  throw lastError;
}
```

### Error Chaining

```typescript
import { AlpacaApiError, NetworkError } from '@adaptic/utils';

async function fetchData() {
  try {
    const response = await fetch('https://api.alpaca.markets/v2/account');
    if (!response.ok) {
      throw new AlpacaApiError(
        'Failed to fetch account',
        'ACCOUNT_FETCH_ERROR',
        response.status
      );
    }
    return response.json();
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new NetworkError(
        'Network request failed',
        'alpaca',
        error // Chain the original error
      );
    }
    throw error;
  }
}
```

### Type Guards

```typescript
import {
  AdapticUtilsError,
  AlpacaApiError,
  AuthenticationError
} from '@adaptic/utils';

try {
  await someApiCall();
} catch (error) {
  if (error instanceof AuthenticationError) {
    // Handle auth errors specifically
    console.error('Authentication failed:', error.message);
    // Redirect to login, etc.
  } else if (error instanceof AlpacaApiError) {
    // Handle Alpaca-specific errors
    console.error(`Alpaca API error (${error.statusCode}):`, error.message);
  } else if (error instanceof AdapticUtilsError) {
    // Handle any other utils error
    console.error(`${error.service} error:`, error.message);
    if (error.isRetryable) {
      // Implement retry logic
    }
  } else {
    // Handle unexpected errors
    console.error('Unexpected error:', error);
  }
}
```

## Migration Guide

When updating existing code to use these error classes:

1. **Identify error patterns**: Look for `throw new Error(...)` calls in API-related code
2. **Determine error type**: Based on the context, choose the appropriate error class
3. **Add context**: Include relevant information like status codes, service names, etc.
4. **Update error handling**: Use `isRetryable` property for retry logic

### Before

```typescript
throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
```

### After

```typescript
throw new AlpacaApiError(
  errorText,
  'API_ERROR',
  response.status
);
```

## Best Practices

1. **Always include context**: Provide meaningful error messages and codes
2. **Chain errors**: Use the `cause` parameter to preserve error context
3. **Check retryability**: Use `error.isRetryable` before implementing retry logic
4. **Use specific error classes**: Prefer specific classes (e.g., `AlpacaApiError`) over generic ones
5. **Document error codes**: Maintain a consistent set of error codes for your service
6. **Handle all error types**: Use type guards to handle different error classes appropriately
