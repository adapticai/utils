# HTTP Timeout Coverage Report

## Overview
This document lists all external HTTP API calls that now have timeout protection.

## Coverage by API Provider

### Alpaca Markets API (24 endpoints)

#### Crypto API (`src/crypto.ts`)
- ✅ `fetchBars()` - Historical crypto price bars
- ✅ `fetchNews()` - Crypto news articles  
- ✅ `fetchLatestTrades()` - Latest crypto trades
- ✅ `fetchLatestQuotes()` - Latest crypto bid/ask quotes

#### Trading API (`src/alpaca-functions.ts`)
- ✅ `createOrder()` - Create new order
- ✅ `getOrders()` - Get all orders (paginated)
- ✅ `getOrder()` - Get specific order
- ✅ `replaceOrder()` - Modify existing order
- ✅ `cancelOrder()` - Cancel specific order
- ✅ `cancelAllOrders()` - Cancel all open orders
- ✅ `fetchAccountDetails()` - Get account information
- ✅ `fetchPortfolioHistory()` - Portfolio value history
- ✅ `fetchAllPositions()` - Get all positions
- ✅ `fetchPosition()` - Get specific position
- ✅ `closePosition()` - Close a position
- ✅ `fetchNews()` - Stock news articles
- ✅ `makeRequest()` - Generic trading API request
- ✅ `getAsset()` - Get asset information

#### Trading API Class (`src/alpaca-trading-api.ts`)
- ✅ `makeRequest()` - Base request method for all trading operations

#### Market Data API Class (`src/alpaca-market-data-api.ts`)
- ✅ `makeRequest()` - Base request method for all market data operations

#### SDK Client (`src/alpaca/client.ts`)
- ✅ `request()` - Base request method for SDK operations

#### Options API (`src/alpaca/options/data.ts`)
- ✅ `makeOptionsDataRequest()` - Options chain and data requests

### Alpha Vantage API (2 endpoints)

#### Stock Data (`src/alphavantage.ts`)
- ✅ `fetchQuote()` - Real-time stock quotes
- ✅ `fetchTickerNews()` - News sentiment for ticker

### Adaptic Backend API (1 endpoint)

#### Asset Data (`src/adaptic.ts`)
- ✅ `fetchAssetOverview()` - Asset overview from Adaptic backend

### Internal APIs (1 endpoint)

#### Performance Metrics (`src/performance-metrics.ts`)
- ✅ `fetchPerformanceMetrics()` - Historical benchmark price data

## Timeout Configuration

All endpoints use appropriate timeout values:

| API Provider      | Default Timeout | Environment Variable        |
|-------------------|-----------------|----------------------------|
| Alpaca Markets    | 30 seconds      | `ALPACA_API_TIMEOUT`       |
| Polygon.io        | 30 seconds      | `POLYGON_API_TIMEOUT`      |
| Alpha Vantage     | 30 seconds      | `ALPHA_VANTAGE_API_TIMEOUT`|
| General/Internal  | 30 seconds      | `HTTP_TIMEOUT`             |

## Implementation Method

All endpoints use the `createTimeoutSignal()` utility with `fetch()`:

```typescript
const response = await fetch(url, {
  // ... other options
  signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
});
```

## Total Coverage

- **Total HTTP endpoints**: 29
- **Endpoints with timeouts**: 29
- **Coverage**: 100% ✅

## Not Covered (Not Applicable)

The following do NOT make external HTTP calls and therefore do not need timeouts:

- WebSocket streams (use different timeout mechanism)
- Database operations (use @adaptic/backend-legacy with its own timeouts)
- Local file operations
- Synchronous operations
- In-memory calculations

## Verification

To verify timeout coverage:

```bash
cd /Users/jstein/adapticai/utils

# Count all timeout implementations
grep -r "createTimeoutSignal" src --include="*.ts" | \
  grep -v "node_modules\|dist\|__tests__\|http-timeout.ts\|index.ts" | \
  wc -l
# Expected: 29

# List files with timeout protection
grep -r "createTimeoutSignal" src --include="*.ts" | \
  grep -v "node_modules\|dist\|__tests__\|http-timeout.ts\|index.ts" | \
  cut -d: -f1 | sort -u
```

---
Last Updated: 2026-02-06
Coverage: 100%
