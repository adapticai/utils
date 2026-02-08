# @adaptic/utils - Current Architecture

**Package:** @adaptic/utils v0.1.1 (NPM published, ES Module)
**Build:** Rollup 4.46.2, TypeScript 5.8.3, dual ESM+CJS output (dist/index.mjs + dist/index.cjs)
**Source Scale:** 82 TypeScript source files
**Last Audit:** 2026-02-08

## Core Architecture

- Financial utility library consumed by engine and external services
- Dual ESM/CJS build via Rollup (dist/index.mjs + dist/index.cjs)
- Exports a single unified namespace object from src/index.ts
- Dependencies: @adaptic/backend-legacy ^0.0.43, @adaptic/lumic-utils ^1.0.6, @alpacahq/alpaca-trade-api ^3.1.3, @apollo/client ^3.13.8, date-fns ^4.1.0, lru-cache ^11.2.2, p-limit ^6.2.0

## Public API Surface (via namespace object)

The package exports everything through a single `adaptic.*` namespace with sub-namespaces:

- **alpaca** - Alpaca brokerage integration
  - account: getDetails, getConfig, updateConfig, getPositions, getPosition, getPortfolioHistory
  - orders: create, createLimitOrder, get, getAll, replace, cancel, cancelAll (legacy + new SDK)
  - asset: get
  - quote: getLatest
  - MarketDataAPI class, TradingAPI class
- **av** - Alpha Vantage integration (fetchQuote, fetchTickerNews, date conversion)
- **crypto** - Cryptocurrency data (fetchBars, fetchNews, fetchLatestTrades, fetchLatestQuotes)
- **format** - Formatting utilities (capitalize, enum, currency, number, percentage, date, dateToString, dateTimeForGS)
- **metrics** - Performance metrics (trade metrics, alpha/beta, max drawdown, daily returns, beta from returns, information ratio, full performance metrics suite)
- **time** - Market time utilities (MarketTimeTracker class - isMarketOpen, getNextOpen/Close, timezone conversion, getDateRange, formatISO)
- **news** - News fetching with pagination (fetchNews, fetchNewsV2, fetchNextNewsPage)
- **ta** - Technical analysis (calculateEMA with dual-period support)
- **allocation** - Asset allocation algorithm
- **polygon** - Polygon.io market data API integration
- **indices** - Polygon index data

## Module Structure (82 source files)

### src/alpaca/ (11 files, 6 subdirectories)

Modular SDK-based Alpaca client, organized by domain:

- **trading/** (12 files): account, orders, positions, bracket-orders, oco-orders, oto-orders, trailing-stops, smart-orders
- **market-data/** (5 files): quotes, bars, trades, news
- **crypto/** (3 files): data, orders
- **options/** (5 files): contracts, data, orders, strategies
- **streams/** (7 files): stream-manager, base-stream, trading-stream, stock-stream, crypto-stream, option-stream

### Core Modules

| File | Lines | Description |
|------|-------|-------------|
| `src/alpaca/legacy/` | ~600 | Legacy Alpaca REST API wrapper (AlpacaAuth pattern), migrated from alpaca-functions.ts into 6 modular files |
| `src/performance-metrics.ts` | 1,113 | Trade PnL, alpha, beta, drawdown, info ratio |
| `src/technical-analysis.ts` | 535 | EMA, MACD, RSI, Stochastic, Bollinger, S&R, Fibonacci |
| `src/market-time.ts` | - | MarketTimeTracker class with timezone-aware market hours |
| `src/market-hours.ts` | - | US holiday calendar, market schedule data |
| `src/polygon.ts` | - | Polygon.io REST API |
| `src/polygon-indices.ts` | - | Polygon.io index data |
| `src/alphavantage.ts` | - | Alpha Vantage integration |
| `src/crypto.ts` | - | Cryptocurrency data via Alpaca v1beta3 |
| `src/asset-allocation-algorithm.ts` | - | Portfolio allocation engine |

### Infrastructure

| File | Description |
|------|-------------|
| `src/cache/stampede-protected-cache.ts` | LRU cache with stale-while-revalidate |
| `src/rate-limiter.ts` | Token bucket rate limiter |
| `src/http-timeout.ts` | Timeout utilities and configuration |
| `src/errors/index.ts` | 13 error classes (AlpacaApiError, PolygonApiError, TimeoutError, RateLimitError, etc.) |
| `src/utils/retry.ts` | Exponential backoff retry wrapper |
| `src/utils/auth-validator.ts` | API credential validation |
| `src/logger.ts` | Configurable Pino-compatible logger |
| `src/logging.ts` | Logger configuration and setup |
| `src/adaptic.ts` | Shared Apollo Client management |
| `src/misc-utils.ts` | Debug logging helpers |

## Type System

| File | Lines | Description |
|------|-------|-------------|
| `src/types/alpaca-types.ts` | 1,465 | Comprehensive Alpaca API types |
| `src/types/market-time-types.ts` | - | Market time and hours types |
| `src/types/polygon-types.ts` | - | Polygon.io response types |
| `src/types/alphavantage-types.ts` | - | Alpha Vantage response types |
| `src/types/ta-types.ts` | - | Technical analysis parameter/result types |
| `src/types/metrics-types.ts` | - | Performance metrics types |
| `src/types/asset-allocation-types.ts` | - | Allocation algorithm types |
| `src/types/adaptic-types.ts` | - | Shared Adaptic platform types |
| `src/types/logging-types.ts` | - | Logger interface types |

**Type ownership:** `@adaptic/backend-legacy` owns all Prisma-generated canonical types (Trade, Position, Order, etc.). `@adaptic/utils` owns broker/API types (AlpacaPosition, AlpacaOrder, etc.). Types in `src/types/` are limited to external API response/request shapes.

## Code Quality (as of 2026-02-07)

- Zero `any` types in production code (47 instances from prior audit fully resolved)
- Structured error handling via 13 typed error classes in `src/errors/index.ts`
- Token bucket rate limiting implemented in `src/rate-limiter.ts`
- HTTP timeout utilities implemented in `src/http-timeout.ts`
- Exponential backoff retry implemented in `src/utils/retry.ts`
- StampedeProtectedCache with stale-while-revalidate in `src/cache/`
- Configurable logger compatible with Pino in `src/logger.ts`
- API credential validation in `src/utils/auth-validator.ts`

## Testing

- Vitest infrastructure fully operational with scripts: `test`, `test:watch`, `test:coverage`
- Comprehensive test suite with 461 tests passing (significantly expanded in Wave 3C)
- Test coverage across major modules:
  - `auth-validator.test.ts` - API credential validation
  - `cache.test.ts` - StampedeProtectedCache with stale-while-revalidate
  - `market-time.test.ts` - MarketTimeTracker and market hours
  - `technical-analysis.test.ts` - EMA, MACD, RSI, Bollinger, Fibonacci
  - Expanded coverage for alpaca, crypto, format, metrics, polygon, and other modules
- Legacy `src/test.ts` for manual testing still present (build -> `node dist/test.js`)

## Known Issues

1. **Node engine NOT SPECIFIED** in package.json (should be `>=20` to align with lumic-utils and backend-legacy)
2. **Deprecated functions cleaned up** - Deprecated aliases removed or properly migrated in Wave 3C
3. **API version inconsistency** - Mixed v1/v1beta1/v1beta3 Alpaca endpoint versions across modules
4. **Test coverage significantly improved** - 461 tests now passing (up from 4 test files), though some modules may still lack complete coverage
5. **Legacy alpaca-functions.ts migration COMPLETE** - 1,688 lines migrated to `src/alpaca/legacy/` (6 modular files: auth, orders, positions, account, market-data, assets, utils); original file deleted
