/**
 * Rate Limiter Usage Examples
 *
 * Demonstrates how to use the TokenBucketRateLimiter for various API integrations
 */

import { rateLimiters, TokenBucketRateLimiter, RateLimitError } from '../rate-limiter';

/**
 * Example 1: Using pre-configured rate limiters
 *
 * The easiest way to use rate limiting is with the pre-configured instances.
 */
async function examplePreConfiguredLimiters(): Promise<void> {
  console.log('Example 1: Pre-configured rate limiters\n');

  // Before making an Alpaca API call
  await rateLimiters.alpaca.acquire();
  console.log('Alpaca token acquired, making API call...');
  // await makeAlpacaApiCall();

  // Before making a Polygon API call
  await rateLimiters.polygon.acquire();
  console.log('Polygon token acquired, making API call...');
  // await makePolygonApiCall();

  // Before making an AlphaVantage API call
  await rateLimiters.alphaVantage.acquire();
  console.log('AlphaVantage token acquired, making API call...');
  // await makeAlphaVantageApiCall();
}

/**
 * Example 2: Creating a custom rate limiter
 *
 * For APIs with different rate limits or custom requirements.
 */
async function exampleCustomRateLimiter(): Promise<void> {
  console.log('\nExample 2: Custom rate limiter\n');

  // AlphaVantage Premium: 75 requests per minute
  const premiumAV = new TokenBucketRateLimiter({
    maxTokens: 75,
    refillRate: 75 / 60, // 75 requests per 60 seconds
    label: 'alphaVantage-premium',
    timeoutMs: 60000,
  });

  await premiumAV.acquire();
  console.log('Premium AlphaVantage token acquired');
}

/**
 * Example 3: Handling rate limit errors
 *
 * Shows proper error handling when rate limits are exceeded.
 */
async function exampleErrorHandling(): Promise<void> {
  console.log('\nExample 3: Error handling\n');

  try {
    await rateLimiters.alpaca.acquire();
    console.log('Token acquired successfully');
    // await makeApiCall();
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      console.error(`Rate limit error: ${error.message}`);
      console.error(`Service: ${error.service}`);
      console.error(`Retry after: ${error.retryAfterMs}ms`);
    } else if (error instanceof Error) {
      console.error('Unexpected error:', error.message);
    } else {
      console.error('Unexpected error:', String(error));
    }
  }
}

/**
 * Example 4: Monitoring rate limiter status
 *
 * Check available tokens and queue length for monitoring.
 */
async function exampleMonitoring(): Promise<void> {
  console.log('\nExample 4: Monitoring\n');

  const limiter = rateLimiters.polygon;

  console.log(`Available tokens: ${limiter.getAvailableTokens()}`);
  console.log(`Queue length: ${limiter.getQueueLength()}`);

  // Make a request
  await limiter.acquire();

  console.log(`After request - Available tokens: ${limiter.getAvailableTokens()}`);
  console.log(`After request - Queue length: ${limiter.getQueueLength()}`);
}

/**
 * Example 5: Wrapping API functions with rate limiting
 *
 * Create wrapper functions that automatically apply rate limiting.
 */
class AlpacaApiWrapper {
  async getOrders(): Promise<void> {
    await rateLimiters.alpaca.acquire();
    // return alpaca.getOrders();
    console.log('Fetching orders...');
  }

  async getAccount(): Promise<void> {
    await rateLimiters.alpaca.acquire();
    // return alpaca.getAccount();
    console.log('Fetching account...');
  }

  async createOrder(/* params */): Promise<void> {
    await rateLimiters.alpaca.acquire();
    // return alpaca.createOrder(params);
    console.log('Creating order...');
  }
}

async function exampleApiWrapper(): Promise<void> {
  console.log('\nExample 5: API wrapper with rate limiting\n');

  const api = new AlpacaApiWrapper();

  await api.getOrders();
  await api.getAccount();
  await api.createOrder();
}

/**
 * Example 6: Burst protection
 *
 * Handle multiple concurrent requests with rate limiting.
 */
async function exampleBurstProtection(): Promise<void> {
  console.log('\nExample 6: Burst protection\n');

  const symbols = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA'];

  // Make multiple concurrent requests - rate limiter will queue them
  const promises = symbols.map(async (symbol) => {
    await rateLimiters.polygon.acquire();
    console.log(`Fetching data for ${symbol}...`);
    // return fetchTickerInfo(symbol);
  });

  await Promise.all(promises);
  console.log('All requests completed');
}

/**
 * Example 7: Resetting a rate limiter
 *
 * Clear the queue and reset the token bucket (e.g., for testing or reconfiguration).
 */
async function exampleReset(): Promise<void> {
  console.log('\nExample 7: Resetting rate limiter\n');

  const limiter = new TokenBucketRateLimiter({
    maxTokens: 10,
    refillRate: 1,
    label: 'test-limiter',
  });

  // Queue some requests
  const promises = Array.from({ length: 20 }, () => limiter.acquire());

  console.log(`Queue length before reset: ${limiter.getQueueLength()}`);

  // Reset the limiter - all queued requests will be rejected
  limiter.reset();

  console.log(`Queue length after reset: ${limiter.getQueueLength()}`);

  try {
    await Promise.all(promises);
  } catch (error: unknown) {
    console.log('Queued requests were rejected as expected');
    if (error instanceof Error) {
      console.log('Error message:', error.message);
    }
  }
}

/**
 * Example 8: Integration with existing API client
 *
 * Shows how to integrate rate limiting into an existing codebase.
 */
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

async function exampleIntegration(): Promise<void> {
  console.log('\nExample 8: Integration with existing client\n');

  // Wrap existing client with rate limiting
  // const originalClient = new SomeApiClient();
  // const rateLimitedClient = new RateLimitedApiClient(
  //   originalClient,
  //   rateLimiters.alpaca
  // );

  // Now all requests automatically respect rate limits
  // await rateLimitedClient.makeRequest('/v2/account');

  console.log('Client wrapped with rate limiting');
}

// Run all examples
async function runExamples(): Promise<void> {
  try {
    await examplePreConfiguredLimiters();
    await exampleCustomRateLimiter();
    await exampleErrorHandling();
    await exampleMonitoring();
    await exampleApiWrapper();
    await exampleBurstProtection();
    await exampleReset();
    await exampleIntegration();

    console.log('\n✓ All examples completed successfully');
  } catch (error: unknown) {
    console.error('Error running examples:', error instanceof Error ? error.message : String(error));
  }
}

// Uncomment to run examples
// runExamples();
