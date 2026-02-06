# HTTP Request Timeout Implementation

## Summary

Added configurable request timeouts to ALL external HTTP calls in the `@adaptic/utils` package to prevent requests from hanging indefinitely.

## Changes Made

### 1. Created HTTP Timeout Utility (`src/http-timeout.ts`)

New utility module providing:

- **`DEFAULT_TIMEOUTS`**: Configurable timeout constants for different APIs
  - `ALPACA_API`: 30s (configurable via `ALPACA_API_TIMEOUT` env var)
  - `POLYGON_API`: 30s (configurable via `POLYGON_API_TIMEOUT` env var)
  - `ALPHA_VANTAGE`: 30s (configurable via `ALPHA_VANTAGE_API_TIMEOUT` env var)
  - `GENERAL`: 30s (configurable via `HTTP_TIMEOUT` env var)

- **`createTimeoutSignal(ms: number)`**: Creates an AbortSignal for fetch API
- **`withTimeout<T>(promise, ms, label)`**: Wraps any promise with timeout
- **`getTimeout(api)`**: Gets timeout value for a specific API

### 2. Updated Files with Timeout Implementation

#### External API Calls (29 total implementations):

1. **`src/crypto.ts`** (5 implementations)
   - `fetchBars()` - Alpaca Crypto bars
   - `fetchNews()` - Alpaca Crypto news
   - `fetchLatestTrades()` - Latest crypto trades
   - `fetchLatestQuotes()` - Latest crypto quotes

2. **`src/alphavantage.ts`** (3 implementations)
   - `fetchQuote()` - Stock quotes
   - `fetchTickerNews()` - Ticker news

3. **`src/adaptic.ts`** (2 implementations)
   - `fetchAssetOverview()` - Asset overview from Adaptic backend

4. **`src/alpaca-functions.ts`** (14 implementations)
   - `createOrder()` - Create new order
   - `getOrders()` - Get all orders
   - `cancelAllOrders()` - Cancel all orders
   - `getOrder()` - Get specific order
   - `replaceOrder()` - Replace/modify order
   - `cancelOrder()` - Cancel specific order
   - `fetchNews()` - Fetch news articles
   - `fetchAccountDetails()` - Get account details
   - `fetchPortfolioHistory()` - Portfolio history
   - `fetchAllPositions()` - All positions
   - `fetchPosition()` - Specific position
   - `closePosition()` - Close position
   - `makeRequest()` - Generic request handler
   - `getAsset()` - Get asset information

5. **`src/alpaca-trading-api.ts`** (1 implementation)
   - `makeRequest()` - Trading API base request method

6. **`src/alpaca-market-data-api.ts`** (1 implementation)
   - `makeRequest()` - Market data API base request method

7. **`src/alpaca/client.ts`** (1 implementation)
   - `request()` - SDK client base request method

8. **`src/alpaca/options/data.ts`** (1 implementation)
   - `makeOptionsDataRequest()` - Options data requests

9. **`src/performance-metrics.ts`** (1 implementation)
   - `fetchPerformanceMetrics()` - Internal benchmark data fetch

### 3. Exported from Main Index

Updated `src/index.ts` to export timeout utilities:

```typescript
export {
  DEFAULT_TIMEOUTS,
  withTimeout,
  createTimeoutSignal,
  getTimeout,
} from './http-timeout';
```

## Usage Examples

### Using with fetch API (Recommended)

```typescript
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from '@adaptic/utils';

const response = await fetch(url, {
  signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
  headers: { /* ... */ },
});
```

### Wrapping existing promises

```typescript
import { withTimeout, DEFAULT_TIMEOUTS } from '@adaptic/utils';

const result = await withTimeout(
  someAsyncOperation(),
  DEFAULT_TIMEOUTS.GENERAL,
  'Operation Name'
);
```

### Environment Variable Configuration

Set custom timeout values via environment variables:

```bash
# Override default 30s timeouts
export ALPACA_API_TIMEOUT=45000      # 45 seconds
export POLYGON_API_TIMEOUT=60000     # 60 seconds
export ALPHA_VANTAGE_API_TIMEOUT=30000
export HTTP_TIMEOUT=30000             # Default for unspecified APIs
```

## Technical Details

### Implementation Approach

- **Non-breaking**: All changes are additive; no existing API signatures changed
- **Type-safe**: No `any` types used; proper TypeScript typing throughout
- **Configurable**: Timeout values can be overridden via environment variables
- **Consistent**: Same timeout mechanism used across all external API calls

### Error Handling

When a timeout occurs:
- Fetch calls with `AbortSignal.timeout()` will throw an `AbortError`
- `withTimeout()` wrapper will throw: `Error: Request timeout after {ms}ms: {label}`

Applications should handle these timeout errors appropriately:

```typescript
try {
  const data = await fetchData();
} catch (error) {
  if (error.name === 'AbortError' || error.message.includes('timeout')) {
    // Handle timeout
    console.error('Request timed out');
  }
  throw error;
}
```

## Testing

The package builds successfully with the new timeout implementation:

```bash
npm run build
# ✓ created dist in 1.4s
```

All 29 timeout implementations were verified across 9 different files.

## Future Enhancements

Potential improvements for future iterations:

1. Add per-endpoint timeout configuration
2. Implement automatic retry with exponential backoff on timeout
3. Add timeout metrics/monitoring
4. Create timeout configuration presets for different deployment environments

## Files Modified

- ✅ `src/http-timeout.ts` (created)
- ✅ `src/crypto.ts`
- ✅ `src/alphavantage.ts`
- ✅ `src/adaptic.ts`
- ✅ `src/alpaca-functions.ts`
- ✅ `src/alpaca-trading-api.ts`
- ✅ `src/alpaca-market-data-api.ts`
- ✅ `src/alpaca/client.ts`
- ✅ `src/alpaca/options/data.ts`
- ✅ `src/performance-metrics.ts`
- ✅ `src/index.ts`

## Verification

Run the following to verify timeout implementations:

```bash
# Count total timeout implementations
grep -r "createTimeoutSignal" src --include="*.ts" | \
  grep -v "node_modules\|dist\|__tests__" | wc -l
# Expected: 35 (29 usages + 1 definition + 5 exports)

# List all files using timeouts
grep -r "createTimeoutSignal\|DEFAULT_TIMEOUTS" src --include="*.ts" | \
  grep -v "node_modules\|dist\|__tests__" | \
  cut -d: -f1 | sort -u
```
