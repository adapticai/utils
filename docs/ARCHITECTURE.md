# Utils Architecture

## System Overview

`@adaptic/utils` is a financial utilities library providing broker API integration, market data access, performance analytics, and technical analysis tools for the Adaptic.ai algorithmic trading platform. Published as a dual ESM/CJS NPM package, it serves as the canonical financial calculation layer consumed primarily by the engine package.

### Build Pipeline

```
Source (src/index.ts)
        |
   Rollup 4.46
   + @rollup/plugin-typescript
   + @rollup/plugin-node-resolve
   + @rollup/plugin-commonjs
   + @rollup/plugin-json
   + rollup-plugin-visualizer (optional)
        |
        v
+----------------+----------------+-------------------+
| dist/index.mjs | dist/index.cjs | dist/types/*.d.ts |
|   (ESM)        |   (CJS)        |  (declarations)   |
+----------------+----------------+-------------------+
        |
        v
  NPM Package (@adaptic/utils)
        |
        v
  Engine (primary consumer)
```

**Externals** (not bundled, resolved at consumer's node_modules):
- react, react-dom
- @adaptic/backend-legacy
- date-fns, date-fns-tz, date-holidays
- ms, node-fetch

**TypeScript:** 5.8.3, target ES2022, strict mode, ESNext module resolution.

## Dependency Graph

```
@adaptic/utils
    |
    +---> @adaptic/backend-legacy  (Prisma-generated canonical types)
    +---> @adaptic/lumic-utils     (LLM, AWS, Google Sheets, Slack)
    +---> @alpacahq/alpaca-trade-api (Alpaca official SDK)
    +---> @apollo/client           (GraphQL client for backend queries)
    +---> date-fns / date-fns-tz   (date manipulation, timezone handling)
    +---> lru-cache                (LRU caching primitives)
    +---> p-limit                  (concurrency limiting)
    +---> zod                      (API response validation schemas)
    +---> chalk                    (terminal output formatting)
    +---> ms                       (time string parsing)
```

**Consumed by:** `engine` (build-time import), external services via NPM.

## Module Organization

### 1. Alpaca Integration (`src/alpaca/`)

The largest subsystem. Two generations of Alpaca API wrappers coexist:

**Modern SDK-based client** (`src/alpaca/client.ts`):
- Factory pattern: `createAlpacaClient()` / `createClientFromEnv()`
- Client caching to avoid redundant connections
- All modern modules accept `AlpacaClient` as first parameter

**Trading** (`src/alpaca/trading/`):
| Module | Purpose |
|--------|---------|
| `orders.ts` | Create, get, list, cancel, replace orders |
| `positions.ts` | Get, close, close-all positions |
| `account.ts` | Account details, configuration, portfolio history |
| `clock.ts` | Market clock and trading calendar |
| `bracket-orders.ts` | Bracket order creation with stop-loss and take-profit |
| `oco-orders.ts` | One-Cancels-Other order pairs |
| `oto-orders.ts` | One-Triggers-Other order chains |
| `trailing-stops.ts` | Trailing stop orders with percentage or dollar amounts |
| `smart-orders.ts` | High-level smart order factory combining all order types |
| `order-utils.ts` | Shared order validation, formatting, status checking |

**Market Data** (`src/alpaca/market-data/`):
| Module | Purpose |
|--------|---------|
| `quotes.ts` | Latest quotes, spreads, liquidity checks |
| `bars.ts` | Historical and latest OHLCV bars, daily/intraday prices, volume analysis |
| `trades.ts` | Latest and historical trades, current prices, trade volume |
| `news.ts` | Market news with sentiment analysis and symbol-based search |

**Options** (`src/alpaca/options/`):
| Module | Purpose |
|--------|---------|
| `contracts.ts` | Option chain, expiration dates, strikes, ATM finding, OCC symbol parsing |
| `orders.ts` | Single-leg and multi-leg option orders, verticals, iron condors, exercise |
| `strategies.ts` | Strategy builders: covered calls, butterflies, roll positions |
| `data.ts` | Options quotes, trades, snapshots, implied volatility, Greeks, moneyness |

**Crypto** (`src/alpaca/crypto/`):
| Module | Purpose |
|--------|---------|
| `orders.ts` | Crypto market/limit/stop orders, notional buys, sell-all |
| `data.ts` | Crypto bars, trades, quotes, snapshots, 24h change, supported pairs |

**Streams** (`src/alpaca/streams/`):
| Module | Purpose |
|--------|---------|
| `stream-manager.ts` | Centralized WebSocket stream lifecycle manager |
| `base-stream.ts` | Abstract base class for all stream types |
| `trading-stream.ts` | Order/fill/cancel event stream |
| `stock-stream.ts` | Real-time stock quotes, bars, trades |
| `crypto-stream.ts` | Real-time crypto market data |
| `option-stream.ts` | Real-time options market data |

**Legacy** (`src/alpaca/legacy/`):
| Module | Purpose |
|--------|---------|
| `auth.ts` | AlpacaAuth credential pattern (backward compatibility) |
| `orders.ts` | Legacy order CRUD |
| `positions.ts` | Legacy position management |
| `account.ts` | Legacy account details, config, portfolio history |
| `market-data.ts` | Legacy quotes |
| `assets.ts` | Legacy asset lookup |
| `utils.ts` | Shared legacy helpers |

**Top-level legacy classes:**
- `alpaca-trading-api.ts` -- `AlpacaTradingAPI` class with WebSocket support, bracket orders, equities trading
- `alpaca-market-data-api.ts` -- `AlpacaMarketDataAPI` singleton for bars, quotes, trades, snapshots

### 2. Additional Market Data Providers

| Module | External API | Key Functions |
|--------|-------------|---------------|
| `polygon.ts` | Polygon.io | fetchTickerInfo, fetchGroupedDaily, fetchLastTrade, fetchTrades, fetchPrices, fetchDailyOpenClose, getPreviousClose |
| `polygon-indices.ts` | Polygon.io (indices) | fetchIndicesAggregates, fetchIndicesPreviousClose, fetchIndicesSnapshot, fetchUniversalSnapshot |
| `alphavantage.ts` | Alpha Vantage | fetchQuote, fetchTickerNews, date format conversions |
| `crypto.ts` | Alpaca v1beta3 | fetchBars, fetchNews, fetchLatestTrades, fetchLatestQuotes |

### 3. Financial Calculations

| Module | Key Functions |
|--------|---------------|
| `performance-metrics.ts` | calculateAlphaAndBeta, calculateMaxDrawdown, calculateDailyReturns, calculateBetaFromReturns, calculateInformationRatio, fetchPerformanceMetrics (full suite) |
| `metrics-calcs.ts` | fetchTradeMetrics (trade-level PnL) |
| `technical-analysis.ts` | calculateEMA, calculateMACD, calculateRSI, calculateStochasticOscillator, calculateBollingerBands, calculateSupportAndResistance, calculateFibonacciLevels |
| `asset-allocation-algorithm.ts` | AssetAllocationEngine class, generateOptimalAllocation, getDefaultRiskProfile |
| `price-utils.ts` | roundStockPrice, getEquityValues, computeTotalFees |

### 4. Time & Formatting

| Module | Key Functions |
|--------|---------------|
| `market-time.ts` | MarketTimeUtil class, getMarketStatus, getDateInNY, getStartAndEndTimestamps, getLastTradingDateYYYYMMDD, getNextMarketDay, currentTimeET, getNYTimeZone |
| `market-hours.ts` | NYSE holiday calendar (2024-2027), early close schedule, isHoliday/isEarlyClose checks |
| `time-utils.ts` | toUnixTimestamp, getTimeAgo, normalizeDate, calculateTimeRange, calculateDaysLeft, formatToUSEastern |
| `format-tools.ts` | formatCurrency, formatNumber, formatPercentage, capitalize, formatEnum, dateTimeForGS |

### 5. Infrastructure

| Module | Purpose |
|--------|---------|
| `cache/stampede-protected-cache.ts` | LRU cache with stale-while-revalidate semantics and thundering herd protection. Configurable TTL, max size, and background refresh. |
| `rate-limiter.ts` | Token bucket rate limiter with pre-configured per-API limiters (Alpaca, Polygon, Alpha Vantage). Supports burst capacity. |
| `utils/retry.ts` | Exponential backoff retry wrapper with jitter. Pre-configured API-specific retry configs (API_RETRY_CONFIGS). |
| `utils/paginator.ts` | Generic async-iterator pagination supporting cursor (Alpaca), URL (Polygon), and offset strategies. Safety limits via maxPages/maxItems. |
| `utils/http-keep-alive.ts` | HTTP connection pooling verification for native fetch (Node.js >=20 undici). Agent pool status monitoring. |
| `utils/auth-validator.ts` | API credential validation for Alpaca, Polygon, Alpha Vantage. |
| `http-timeout.ts` | Configurable timeout utilities with AbortSignal support. Default timeouts per operation type. |
| `config/api-endpoints.ts` | Centralized Alpaca API URLs: trading (v2), stocks (v2), crypto (v1beta3), options (v1beta1), WebSocket streams. |
| `errors/index.ts` | 12 typed error classes extending AdapticUtilsError: AlpacaApiError, PolygonApiError, AlphaVantageError, TimeoutError, ValidationError, AuthenticationError, HttpClientError, HttpServerError, RateLimitError, WebSocketError, NetworkError, DataFormatError. Each carries service, code, isRetryable. |
| `schemas/` | Zod validation schemas for all external API responses. validateResponse() and safeValidateResponse() helpers with strict/non-strict modes. |
| `logger.ts` | Configurable Logger interface (error/warn/info/debug) compatible with Pino. setLogger/getLogger/resetLogger for dependency injection. |
| `logging.ts` | Logger configuration setup. |
| `adaptic.ts` | Shared Apollo Client management (getSharedApolloClient), auth configuration (configureAuth), and asset overview fetching. |
| `display-manager.ts` | Terminal display management with chalk formatting and readline cursor control. |
| `misc-utils.ts` | Debug logging helpers, fetchWithRetry, Polygon API key validation. |

### 6. Type System (`src/types/`)

| File | Lines | Contents |
|------|-------|----------|
| `alpaca-types.ts` | 1,465+ | AlpacaCredentials, AlpacaPosition, AlpacaOrder, TradeUpdate, AlpacaBar, AlpacaQuote, OrderSide, OrderType, TimeInForce, AssetClass, and 100+ more |
| `polygon-types.ts` | ~170 | RawPriceData, PolygonTrade, TickerInfo, GroupedDailyResult |
| `polygon-indices-types.ts` | ~190 | IndicesAggregatesResponse, IndicesSnapshot, UniversalSnapshot |
| `alphavantage-types.ts` | ~90 | AVQuoteResponse, AVNewsArticle, AVNewsResponse |
| `market-time-types.ts` | ~50 | MarketSchedule, MarketStatus, HolidayEntry |
| `ta-types.ts` | ~60 | EMAResult, MACDResult, RSIResult, BollingerBandsResult, FibonacciLevels |
| `metrics-types.ts` | ~30 | PerformanceMetrics, TradeMetrics |
| `asset-allocation-types.ts` | ~300 | RiskProfile, AllocationConstraints, OptimizationResult |
| `adaptic-types.ts` | ~15 | Shared Adaptic platform types |
| `logging-types.ts` | ~10 | LogOptions |

### 7. Validation Schemas (`src/schemas/`)

| File | Schemas |
|------|---------|
| `alpaca-schemas.ts` | AlpacaAccountDetailsSchema, AlpacaPositionSchema, AlpacaOrderSchema (recursive legs), AlpacaBarSchema, AlpacaQuoteSchema, AlpacaTradeSchema, AlpacaNewsArticleSchema, AlpacaPortfolioHistoryResponseSchema, AlpacaCryptoBarsResponseSchema |
| `polygon-schemas.ts` | RawPolygonPriceDataSchema, PolygonTickerInfoSchema, PolygonGroupedDailyResponseSchema, PolygonDailyOpenCloseSchema, PolygonTradeSchema, PolygonAggregatesResponseSchema, PolygonErrorResponseSchema |
| `alphavantage-schemas.ts` | AlphaVantageQuoteResponseSchema, AVNewsArticleSchema, AVNewsResponseSchema |
| `validate-response.ts` | validateResponse(), safeValidateResponse(), ValidationResponseError class |

## Export Architecture

The package provides two complementary export patterns:

### Named Exports (Modern)
Direct imports of classes, functions, types, and utilities:
```typescript
import {
  AlpacaTradingAPI, AlpacaMarketDataAPI,
  StampedeProtectedCache, TokenBucketRateLimiter,
  withRetry, withTimeout, paginate,
  AlpacaApiError, ValidationError,
  validateResponse, AlpacaOrderSchema,
  alpaca  // namespace for SDK-based Alpaca functions
} from '@adaptic/utils';
```

### Namespace Object (Legacy)
Single `adaptic` object (aliased as `adptc`) with organized sub-namespaces:
```typescript
import { adaptic } from '@adaptic/utils';

adaptic.alpaca.orders.create(...)
adaptic.polygon.fetchTickerInfo(...)
adaptic.metrics.allpm(...)
adaptic.ta.calculateEMA(...)
adaptic.time.getMarketStatus(...)
```

Sub-namespaces: `alpaca`, `av`, `crypto`, `format`, `metrics`, `polygon`, `indices`, `price`, `ta`, `time`, `utils`, `rateLimiter`, `backend`, `types`.

## Testing Architecture

**Framework:** Vitest 4.0.18 with v8 coverage provider.

**Test files** (22 in `src/__tests__/`):

| Test File | Module Covered | Type |
|-----------|---------------|------|
| `alpaca-functions.test.ts` | Alpaca legacy API | Unit |
| `api-endpoints.test.ts` | API endpoint config | Unit |
| `asset-allocation.test.ts` | Allocation algorithm | Unit |
| `auth-validator.test.ts` | Credential validation | Unit |
| `cache.test.ts` | StampedeProtectedCache | Unit |
| `errors.test.ts` | Error class hierarchy | Unit |
| `financial-regression.test.ts` | Financial calc regression | Regression |
| `format-tools.test.ts` | Formatting utilities | Unit |
| `http-keep-alive.test.ts` | Connection pooling | Unit |
| `http-timeout.test.ts` | Timeout utilities | Unit |
| `logger.test.ts` | Logger interface | Unit |
| `market-time.test.ts` | Market time utilities | Unit |
| `misc-utils.test.ts` | Misc utilities | Unit |
| `paginator.test.ts` | Pagination utility | Unit |
| `performance-metrics.test.ts` | Performance metrics | Unit |
| `polygon.test.ts` | Polygon.io integration | Unit |
| `price-utils.test.ts` | Price utilities | Unit |
| `property-based-financial.test.ts` | Financial calcs | Property-based (fast-check) |
| `rate-limiter.test.ts` | Token bucket limiter | Unit |
| `schema-validation.test.ts` | Zod schemas | Unit |
| `technical-analysis.test.ts` | TA indicators | Unit |
| `time-utils.test.ts` | Time utilities | Unit |

**Property-based tests** cover: beta calculation (identity, linearity, inverse correlation, zero-variance), drawdown (bounds, monotonicity, peak/trough invariants), returns (log return additivity, round-trip symmetry), EMA (constant series, bounds, output length), RSI (0-100 bounds, trend direction), Bollinger Bands (band ordering, SMA accuracy).

**Legacy test** (`src/test.ts`): Manual integration tests for live Alpaca API calls (pre-market data, WebSocket, order creation). Bundled separately by Rollup.

## Error Handling Strategy

All errors extend `AdapticUtilsError` with structured fields:
- `code` -- Machine-readable error code (TIMEOUT, RATE_LIMIT, AUTH_ERROR, etc.)
- `service` -- Which API service (alpaca, polygon, alphavantage)
- `isRetryable` -- Whether the operation can be retried
- `cause` -- Original error for chaining

Retryable errors: TimeoutError, HttpServerError (5xx), RateLimitError (429), NetworkError, WebSocketError.
Non-retryable errors: ValidationError, AuthenticationError, HttpClientError (4xx), DataFormatError.

## Known Architectural Decisions

1. **Two Alpaca API generations coexist** -- The modern SDK-based client (`src/alpaca/`) and the legacy AlpacaAuth-based wrappers (`src/alpaca/legacy/`, `alpaca-trading-api.ts`). The engine uses both. Deprecation is gradual.
2. **Single bundle entry point** -- All code is bundled through `src/index.ts`. No tree-shaking at the module level for consumers (they get the full bundle).
3. **Namespace + named exports** -- Both patterns are maintained for backward compatibility. New code should prefer named exports.
4. **Zod schemas are non-strict by default** -- `safeValidateResponse()` logs warnings but does not throw. Strict mode available for critical paths.
5. **Market calendar is hardcoded** -- NYSE holidays for 2024-2027 are in `src/market-hours.ts`. Must be updated annually.
