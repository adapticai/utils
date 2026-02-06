# Rate Limiter

Client-side rate limiting for external API integrations using the token bucket algorithm.

## Overview

The rate limiter prevents exceeding API quotas by controlling the rate of requests. It uses the token bucket algorithm to allow burst traffic while maintaining an average rate limit.

## Features

- **Token Bucket Algorithm**: Efficient rate limiting with burst support
- **Request Queuing**: Automatically queues requests when rate limit is reached
- **Timeout Protection**: Prevents indefinite waiting with configurable timeouts
- **Pre-configured Limiters**: Ready-to-use limiters for Alpaca, Polygon, and AlphaVantage
- **Custom Configuration**: Create limiters for any API with custom rate limits
- **Monitoring**: Check available tokens and queue length
- **Type Safe**: Full TypeScript support with no `any` types

## Quick Start

### Using Pre-configured Limiters

```typescript
import { rateLimiters } from '@adaptic/utils';

// Before making an Alpaca API call (200 req/min)
await rateLimiters.alpaca.acquire();
const orders = await alpaca.getOrders();

// Before making a Polygon API call (5 req/sec)
await rateLimiters.polygon.acquire();
const tickerInfo = await polygon.fetchTickerInfo('AAPL');

// Before making an AlphaVantage API call (5 req/min free tier)
await rateLimiters.alphaVantage.acquire();
const quote = await av.fetchQuote('GOOGL');
```

## Pre-configured Rate Limiters

### Alpaca
- **Rate**: 200 requests per minute
- **Refill**: ~3.33 tokens per second
- **Timeout**: 60 seconds

### Polygon.io
- **Rate**: 5 requests per second (basic plan)
- **Refill**: 5 tokens per second
- **Timeout**: 30 seconds
- **Note**: Adjust for higher tier subscriptions

### AlphaVantage
- **Rate**: 5 requests per minute (free tier)
- **Refill**: ~0.083 tokens per second
- **Timeout**: 60 seconds
- **Note**: See custom configuration for premium tier

## Custom Configuration

### AlphaVantage Premium (75 req/min)

```typescript
import { TokenBucketRateLimiter } from '@adaptic/utils';

const premiumAV = new TokenBucketRateLimiter({
  maxTokens: 75,
  refillRate: 75 / 60, // 75 requests per 60 seconds
  label: 'alphaVantage-premium',
  timeoutMs: 60000,
});

await premiumAV.acquire();
```

### Custom API

```typescript
const customLimiter = new TokenBucketRateLimiter({
  maxTokens: 100,        // Maximum burst size
  refillRate: 10,        // 10 requests per second
  label: 'my-api',       // For logging
  timeoutMs: 30000,      // 30 second timeout
});
```

## Error Handling

```typescript
import { rateLimiters, RateLimitError } from '@adaptic/utils';

try {
  await rateLimiters.alpaca.acquire();
  const result = await makeApiCall();
} catch (error) {
  if (error instanceof RateLimitError) {
    console.error(`Rate limit timeout: ${error.message}`);
    console.error(`Service: ${error.service}`);
    // Implement backoff or user notification
  } else {
    // Handle other errors
  }
}
```

## API Wrapper Pattern

Wrap API functions to automatically apply rate limiting:

```typescript
import { rateLimiters } from '@adaptic/utils';

class RateLimitedAlpacaClient {
  async getOrders() {
    await rateLimiters.alpaca.acquire();
    return alpaca.getOrders();
  }

  async getAccount() {
    await rateLimiters.alpaca.acquire();
    return alpaca.getAccount();
  }

  async createOrder(params: OrderParams) {
    await rateLimiters.alpaca.acquire();
    return alpaca.createOrder(params);
  }
}

const client = new RateLimitedAlpacaClient();
await client.getOrders(); // Automatically rate limited
```

## Decorator Pattern

For class methods:

```typescript
function rateLimited(limiter: TokenBucketRateLimiter) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      await limiter.acquire();
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

class ApiClient {
  @rateLimited(rateLimiters.polygon)
  async fetchData(symbol: string) {
    return polygon.fetchTickerInfo(symbol);
  }
}
```

## Monitoring

```typescript
const limiter = rateLimiters.polygon;

// Check available tokens
const available = limiter.getAvailableTokens();
console.log(`Available tokens: ${available}`);

// Check queue length
const queued = limiter.getQueueLength();
console.log(`Queued requests: ${queued}`);

// Warn if capacity is low
if (available < 2) {
  console.warn('Rate limit capacity low, slowing down requests');
}
```

## Burst Protection

The rate limiter automatically handles multiple concurrent requests:

```typescript
const symbols = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA'];

// All requests will be properly rate limited
const promises = symbols.map(async (symbol) => {
  await rateLimiters.polygon.acquire();
  return fetchTickerInfo(symbol);
});

const results = await Promise.all(promises);
```

## Advanced: Reset

Clear queued requests and reset the token bucket:

```typescript
const limiter = rateLimiters.alpaca;

// Reset (useful for testing or reconfiguration)
limiter.reset();

// All queued requests will be rejected with RateLimitError
```

## Integration with Existing Code

### Wrap Existing Client

```typescript
interface ApiClient {
  makeRequest(endpoint: string): Promise<unknown>;
}

class RateLimitedApiClient implements ApiClient {
  constructor(
    private readonly client: ApiClient,
    private readonly limiter: TokenBucketRateLimiter
  ) {}

  async makeRequest(endpoint: string): Promise<unknown> {
    await this.limiter.acquire();
    return this.client.makeRequest(endpoint);
  }
}

// Use the wrapped client
const originalClient = new OriginalApiClient();
const client = new RateLimitedApiClient(
  originalClient,
  rateLimiters.alpaca
);

await client.makeRequest('/v2/account'); // Rate limited automatically
```

## Configuration Reference

### RateLimiterConfig

```typescript
interface RateLimiterConfig {
  /** Maximum tokens (burst size) */
  maxTokens: number;

  /** Tokens refilled per second */
  refillRate: number;

  /** Label for logging and errors */
  label: string;

  /** Max wait time before timeout (ms) */
  timeoutMs?: number; // Default: 60000
}
```

## Token Bucket Algorithm

The token bucket algorithm works as follows:

1. **Bucket Capacity**: `maxTokens` defines the maximum number of tokens
2. **Refill Rate**: Tokens are added at `refillRate` per second
3. **Request Consumption**: Each request consumes one token
4. **Queuing**: If no tokens available, requests are queued
5. **Processing**: Queued requests are processed FIFO when tokens become available

### Example Timeline

For Polygon (5 req/sec):
- T=0s: Bucket has 5 tokens
- T=0.1s: Request 1 - consumes token (4 remaining)
- T=0.2s: Request 2 - consumes token (3 remaining)
- T=1.0s: Refill +5 tokens (8 total, capped at 5)
- T=1.1s: Burst of 6 requests - 5 immediate, 1 queued
- T=2.0s: Refill +5 tokens, queued request processes

## Best Practices

1. **Single Instance**: Use the pre-configured instances for each service
2. **Early Acquire**: Call `acquire()` before API requests, not after
3. **Error Handling**: Always catch `RateLimitError` for timeouts
4. **Monitoring**: Log available tokens in production to detect issues
5. **Configuration**: Adjust limits based on your subscription tier
6. **Testing**: Use `reset()` between tests to clear state

## Logging

The rate limiter integrates with the utils logger:

```typescript
import { setLogger } from '@adaptic/utils';

// Configure Pino or another logger
setLogger(pinoLogger);

// Rate limiter will use configured logger for:
// - Debug: Token acquisition, queue processing
// - Info: Limiter resets
// - Warn: Timeouts and rate limit warnings
```

## Testing

For unit tests, create dedicated instances:

```typescript
import { TokenBucketRateLimiter } from '@adaptic/utils';

describe('My API Tests', () => {
  let limiter: TokenBucketRateLimiter;

  beforeEach(() => {
    limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 10,
      label: 'test-limiter',
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    limiter.reset();
  });

  it('should rate limit requests', async () => {
    // Test implementation
  });
});
```

## See Also

- [Examples](../src/examples/rate-limiter-example.ts)
- [Source Code](../src/rate-limiter.ts)
- [Error Types](../src/errors/index.ts)
