# @adaptic/utils - Current Architecture

**Package:** @adaptic/utils v0.1.1 (NPM published, Rollup ESM+CJS dual build, TypeScript)

## Core Architecture

- Financial utility library consumed by engine and external services
- Dual ESM/CJS build via Rollup (dist/index.mjs + dist/index.cjs)
- Exports a single unified namespace object from src/index.ts
- Dependencies: @adaptic/backend-legacy, @adaptic/lumic-utils, @alpacahq/alpaca-trade-api, @apollo/client, date-fns, lru-cache

## Public API Surface (via namespace object)

The package exports everything through a single `adapticUtils` namespace with sub-namespaces:

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

## Key Source Files (~70 .ts files)

- src/index.ts - Main export namespace (~200 lines)
- src/alpaca-functions.ts - Core Alpaca API integration (~60KB, largest file)
- src/alpaca-trading-api.ts - TradingAPI class wrapping Alpaca REST
- src/alpaca-market-data-api.ts - MarketDataAPI class for market data
- src/alpaca/ - Subdirectory with modular Alpaca functions (accounts, orders, crypto)
- src/crypto.ts - Crypto bars/news/trades/quotes via Alpaca v1beta3 API
- src/market-time.ts - MarketTimeTracker class with timezone-aware market hours
- src/performance-metrics.ts - Financial performance calculations
- src/technical-analysis.ts - EMA calculation
- src/asset-allocation-algorithm.ts - Portfolio allocation logic
- src/types/ - Type definitions (13+ subdirectories)
- src/cache/ - LRU caching utilities
- src/misc-utils.ts - Debug logging helpers
- src/adaptic.ts - Shared Apollo Client management

## Testing Approach

- No test framework (no vitest/jest). Tests run via src/test.ts -> build -> node dist/test.js
- Must modify src/test.ts, add function, call it at bottom, then `npm run test`
- Rollup-bundled package cannot run arbitrary TS files

## Current Issues from Audit

- 47 instances of `: any` or `as any` across source files (type safety violation)
- @deprecated markers on legacy order functions but still exported
- Inconsistent API base URLs (v1beta1 in alpaca-functions.ts vs v1beta3 in crypto.ts)
- Console.error used in some functions instead of structured logging
- No retry logic or rate limiting on Alpaca API calls
- No request timeouts on API calls
- Missing authentication header validation
- LRU cache configuration not tunable by consumers
- AlpacaAuth type has multiple patterns (adapticAccountId OR apiKey+apiSecret)
- No automated tests - only manual src/test.ts
