# Utils Repository Map

## Directory Structure

```
utils/
  src/
    index.ts                        Entry point; namespace object + named exports
    test.ts                         Legacy manual test runner (Rollup-bundled separately)

    alpaca/                         Modular Alpaca SDK integration
      index.ts                      Unified alpaca namespace export
      client.ts                     AlpacaClient factory (createAlpacaClient, createClientFromEnv)
      streams.ts                    Top-level stream convenience functions
      test-imports.ts               Import verification

      trading/                      Order management and account operations
        index.ts                    Re-exports all trading modules
        orders.ts                   Create, get, list, cancel, replace orders
        positions.ts                Get, close, close-all positions
        account.ts                  Account details, configuration, portfolio history
        clock.ts                    Market clock and trading calendar
        bracket-orders.ts           Bracket orders (entry + stop-loss + take-profit)
        oco-orders.ts               One-Cancels-Other order pairs
        oto-orders.ts               One-Triggers-Other order chains
        trailing-stops.ts           Trailing stop orders (% or $)
        smart-orders.ts             High-level smart order factory
        order-utils.ts              Shared order validation and formatting

      market-data/                  Real-time and historical market data
        index.ts                    Re-exports all market-data modules
        quotes.ts                   Latest quotes, spreads, liquidity checks
        bars.ts                     OHLCV bars (historical, latest, daily, intraday)
        trades.ts                   Latest/historical trades, current prices
        news.ts                     Market news with sentiment and search

      crypto/                       Cryptocurrency trading and data
        index.ts                    Re-exports crypto modules
        orders.ts                   Crypto market/limit/stop/stop-limit orders
        data.ts                     Crypto bars, quotes, trades, snapshots, pairs

      options/                      Options trading and data
        index.ts                    Re-exports options modules
        contracts.ts                Option chain, expirations, strikes, OCC symbols
        orders.ts                   Single-leg and multi-leg option orders
        strategies.ts               Verticals, iron condors, butterflies, covered calls
        data.ts                     Options quotes, trades, Greeks, implied vol

      streams/                      WebSocket real-time data streams
        index.ts                    Re-exports all stream types
        stream-manager.ts           Centralized stream lifecycle management
        base-stream.ts              Abstract base class for streams
        trading-stream.ts           Order/fill/cancel event stream
        stock-stream.ts             Real-time stock market data
        crypto-stream.ts            Real-time crypto market data
        option-stream.ts            Real-time options market data

      legacy/                       Backward-compatible AlpacaAuth API
        index.ts                    Re-exports all legacy modules
        auth.ts                     AlpacaAuth credential pattern
        orders.ts                   Legacy order CRUD
        positions.ts                Legacy position management
        account.ts                  Legacy account details and config
        market-data.ts              Legacy quote retrieval
        assets.ts                   Legacy asset lookup
        utils.ts                    Shared legacy helpers

    alpaca-trading-api.ts           AlpacaTradingAPI class (equities, WebSocket, brackets)
    alpaca-market-data-api.ts       AlpacaMarketDataAPI singleton (bars, quotes, trades)

    polygon.ts                      Polygon.io REST API (ticker, trades, prices, daily)
    polygon-indices.ts              Polygon.io index data (aggregates, snapshots)
    alphavantage.ts                 Alpha Vantage (quotes, news, date conversion)
    crypto.ts                       Crypto data via Alpaca v1beta3 (bars, news, trades)

    performance-metrics.ts          Alpha, beta, drawdown, returns, information ratio
    metrics-calcs.ts                Trade-level PnL metrics
    technical-analysis.ts           EMA, MACD, RSI, Stochastic, Bollinger, S&R, Fibonacci
    asset-allocation-algorithm.ts   Portfolio allocation engine with risk profiles
    price-utils.ts                  Stock price rounding, equity values, fees

    market-time.ts                  MarketTimeUtil class, market status, timezone conversion
    market-hours.ts                 NYSE holiday calendar 2024-2027, early close schedule
    time-utils.ts                   Unix timestamps, time ago, date normalization
    format-tools.ts                 Currency, number, percentage, date formatting

    cache/
      stampede-protected-cache.ts   LRU cache with stale-while-revalidate + thundering herd

    config/
      api-endpoints.ts              Centralized Alpaca API URLs (trading, data, WebSocket)

    errors/
      index.ts                      12 typed error classes (see hierarchy below)

    schemas/
      index.ts                      Re-exports all schemas
      alpaca-schemas.ts             Zod schemas for Alpaca API responses
      polygon-schemas.ts            Zod schemas for Polygon.io responses
      alphavantage-schemas.ts       Zod schemas for Alpha Vantage responses
      validate-response.ts          validateResponse() / safeValidateResponse() helpers

    types/
      index.ts                      Re-exports all type modules + EquityPoint, AlpacaPortfolioHistory
      alpaca-types.ts               1,465+ lines: all Alpaca API types
      polygon-types.ts              Polygon.io response types
      polygon-indices-types.ts      Polygon index data types
      alphavantage-types.ts         Alpha Vantage response types
      market-time-types.ts          Market time and hours types
      ta-types.ts                   Technical analysis types
      metrics-types.ts              Performance metrics types
      asset-allocation-types.ts     Allocation algorithm types (risk profiles, constraints)
      adaptic-types.ts              Shared Adaptic platform types
      logging-types.ts              Logger interface types

    utils/
      retry.ts                      Exponential backoff retry with API-specific configs
      paginator.ts                  Generic async-iterator pagination (cursor, URL, offset)
      http-keep-alive.ts            HTTP connection pooling verification
      auth-validator.ts             API credential validation

    testing/
      options-ws.ts                 Options WebSocket testing utility

    examples/
      asset-allocation-example.ts   Asset allocation usage examples
      rate-limiter-example.ts       Rate limiter usage examples

    rate-limiter.ts                 Token bucket rate limiter with per-API limiters
    http-timeout.ts                 Configurable timeout utilities with AbortSignal
    logger.ts                       Configurable Pino-compatible logger interface
    logging.ts                      Logger configuration setup
    adaptic.ts                      Shared Apollo Client management and auth config
    display-manager.ts              Terminal display management (chalk + readline)
    misc-utils.ts                   Debug logging helpers, fetchWithRetry

    __tests__/                      Vitest test suite (22 files, 461+ tests)
      alpaca-functions.test.ts      Alpaca legacy API tests
      api-endpoints.test.ts         API endpoint configuration tests
      asset-allocation.test.ts      Allocation algorithm tests
      auth-validator.test.ts        Credential validation tests
      cache.test.ts                 StampedeProtectedCache tests
      errors.test.ts                Error class hierarchy tests
      financial-regression.test.ts  Financial calculation regression tests
      format-tools.test.ts          Formatting utility tests
      http-keep-alive.test.ts       Connection pooling tests
      http-timeout.test.ts          Timeout utility tests
      logger.test.ts                Logger interface tests
      market-time.test.ts           Market time utility tests
      misc-utils.test.ts            Misc utility tests
      paginator.test.ts             Pagination utility tests
      performance-metrics.test.ts   Performance metrics tests
      polygon.test.ts               Polygon.io integration tests
      price-utils.test.ts           Price utility tests
      property-based-financial.test.ts  Property-based financial tests (fast-check)
      rate-limiter.test.ts          Token bucket limiter tests
      schema-validation.test.ts     Zod schema validation tests
      technical-analysis.test.ts    Technical analysis indicator tests
      time-utils.test.ts            Time utility tests

  dist/                             Build output
    index.mjs                       ESM bundle
    index.cjs                       CJS bundle
    index.mjs.map                   ESM source map
    index.cjs.map                   CJS source map
    test.js                         Legacy test bundle
    types/                          TypeScript declaration files
      index.d.ts                    Main type declarations
      ...

  docs/                             Documentation
    alpaca-market-data.md           Alpaca market data API docs
    alpaca-trading-api.md           Alpaca trading API docs
    asset-allocation-guide.md       Asset allocation usage guide
    rate-limiter.md                 Rate limiter documentation
    plans/                          Planning documents
    ARCHITECTURE.md                 This file
    REPO_MAP.md                     This file

  package.json                      NPM package config (v0.1.44)
  package-lock.json                 NPM lockfile
  rollup.config.mjs                 Rollup build configuration (ESM+CJS dual output)
  tsconfig.json                     TypeScript configuration (ES2022, strict, ESNext)
  vitest.config.ts                  Vitest test configuration (node env, v8 coverage)
  typedoc.json                      TypeDoc API documentation config
  .changelogrc.json                 Conventional changelog config
  .gitignore                        Git ignore rules

  CLAUDE.md                         Claude Code instructions
  CURRENT-ARCHITECTURE.md           Current architecture state document
  TARGET-STATE-ARCHITECTURE.md      Gap analysis with prioritized tasks (all resolved)
  ARCHITECTURE.md                   Detailed architecture overview
  README.md                         Package README
  ASSET_ALLOCATION_IMPLEMENTATION.md  Allocation implementation notes
  LOGGER_MIGRATION_SUMMARY.md       Logger migration from console.log
  REFACTORING_SUMMARY.md            Refactoring changelog
  TIMEOUT_IMPLEMENTATION.md         Timeout implementation details
  TIMEOUT_COVERAGE.md               Timeout coverage analysis
  TYPE_SAFETY_SUMMARY.md            Type safety improvements
  VALIDATION_SUMMARY.md             API validation summary
  VERIFICATION.md                   Verification results
  VITEST_SETUP.md                   Vitest migration notes
```

## API Surface by Category

### Alpaca Trading
- `createAlpacaClient(config)` / `createClientFromEnv()` -- Client factory
- `adaptic.alpaca.orders.*` -- Order CRUD (create, get, getAll, replace, cancel, cancelAll)
- `adaptic.alpaca.positions.*` -- Position management (fetch, close, fetchAll, closeAll)
- `adaptic.alpaca.account` -- Account details
- `adaptic.alpaca.smartOrders.*` -- Bracket, OCO, OTO, trailing stop orders
- `adaptic.alpaca.sdkOrders.*` -- SDK-based order operations
- `adaptic.alpaca.sdkPositions.*` -- SDK-based position management
- `adaptic.alpaca.sdkAccount.*` -- SDK-based account operations
- `adaptic.alpaca.sdkClock.*` -- Market clock and calendar
- `AlpacaTradingAPI` class -- Equities trading with WebSocket support
- `AlpacaMarketDataAPI` class -- Market data singleton

### Alpaca Market Data
- `adaptic.alpaca.quotes.*` -- Real-time quotes and spreads
- `adaptic.alpaca.bars.*` -- Historical/latest OHLCV bars
- `adaptic.alpaca.trades.*` -- Historical/latest trades, current prices
- `adaptic.alpaca.news.*` -- Market news with sentiment

### Alpaca Options
- `adaptic.alpaca.options.contracts.*` -- Option chains, expirations, strikes
- `adaptic.alpaca.options.orders.*` -- Option order management
- `adaptic.alpaca.options.strategies.*` -- Multi-leg strategies
- `adaptic.alpaca.options.data.*` -- Quotes, Greeks, implied volatility

### Alpaca Crypto
- `adaptic.alpaca.crypto.orders.*` -- Crypto order management
- `adaptic.alpaca.crypto.data.*` -- Crypto market data, pairs

### Alpaca Streams
- `adaptic.alpaca.streams.*` -- WebSocket stream management

### Polygon.io
- `adaptic.polygon.fetchTickerInfo(ticker)` -- Company info
- `adaptic.polygon.fetchGroupedDaily(date)` -- All tickers for a date
- `adaptic.polygon.fetchLastTrade(ticker)` -- Most recent trade
- `adaptic.polygon.fetchTrades(ticker, date)` -- Historical trades
- `adaptic.polygon.fetchPrices(ticker, from, to)` -- Price aggregates
- `adaptic.polygon.fetchDailyOpenClose(ticker, date)` -- OHLCV for date
- `adaptic.polygon.getPreviousClose(ticker)` -- Previous close price

### Polygon.io Indices
- `adaptic.indices.fetchAggregates(ticker, from, to)` -- Index aggregates
- `adaptic.indices.fetchPreviousClose(ticker)` -- Previous close
- `adaptic.indices.fetchDailyOpenClose(ticker, date)` -- Daily OHLCV
- `adaptic.indices.fetchSnapshot(ticker)` -- Current snapshot
- `adaptic.indices.fetchUniversalSnapshot(tickers)` -- Multi-ticker snapshot

### Alpha Vantage
- `adaptic.av.fetchQuote(ticker)` -- Real-time quote
- `adaptic.av.fetchTickerNews(ticker)` -- Ticker news
- `adaptic.av.convertDateToYYYYMMDDTHHMM(date)` -- Date formatting
- `adaptic.av.convertYYYYMMDDTHHMMSSToDate(str)` -- Date parsing

### Crypto (Legacy)
- `adaptic.crypto.fetchBars(symbols, params)` -- Crypto OHLCV bars
- `adaptic.crypto.fetchNews(params)` -- Crypto news
- `adaptic.crypto.fetchLatestTrades(symbols)` -- Latest trades
- `adaptic.crypto.fetchLatestQuotes(symbols)` -- Latest quotes

### Performance Metrics
- `adaptic.metrics.trade(trades)` -- Trade-level PnL metrics
- `adaptic.metrics.alphaAndBeta(returns, benchmark)` -- Alpha and beta
- `adaptic.metrics.maxDrawdown(returns)` -- Maximum drawdown
- `adaptic.metrics.dailyReturns(equity)` -- Daily return series
- `adaptic.metrics.beta(returns, benchmark)` -- Beta from return arrays
- `adaptic.metrics.infoRatio(returns, benchmark)` -- Information ratio
- `adaptic.metrics.allpm(params)` -- Full performance metrics suite

### Technical Analysis
- `adaptic.ta.calculateEMA(data, period)` -- Exponential Moving Average
- `adaptic.ta.calculateMACD(data, fast, slow, signal)` -- MACD
- `adaptic.ta.calculateRSI(data, period)` -- Relative Strength Index
- `adaptic.ta.calculateStochasticOscillator(data, period)` -- Stochastic
- `adaptic.ta.calculateBollingerBands(data, period, stdDev)` -- Bollinger Bands
- `adaptic.ta.calculateSupportAndResistance(data)` -- Support/Resistance levels
- `adaptic.ta.calculateFibonacciLevels(high, low)` -- Fibonacci retracement

### Asset Allocation
- `AssetAllocationEngine` class -- Portfolio optimization
- `generateOptimalAllocation(params)` -- Generate optimal allocation
- `getDefaultRiskProfile()` -- Default risk profile

### Market Time
- `adaptic.time.MarketTimeUtil` class -- Core market time operations
- `adaptic.time.getMarketStatus()` -- Current market status (open/closed/pre/post)
- `adaptic.time.getLastTradingDateYYYYMMDD()` -- Last trading date
- `adaptic.time.getNextMarketDay(date)` -- Next trading day
- `adaptic.time.currentTimeET()` -- Current Eastern Time
- `adaptic.time.getNYTimeZone()` -- Current NY timezone identifier
- `adaptic.time.getMarketOpenClose(date)` -- Open/close times for date

### Formatting
- `adaptic.format.currency(value)` -- Format as currency ($1,234.56)
- `adaptic.format.number(value)` -- Format with commas
- `adaptic.format.percentage(value)` -- Format as percentage
- `adaptic.format.capitalize(str)` -- Capitalize first letter
- `adaptic.format.enum(value)` -- Format enum value for display
- `adaptic.format.date(date)` -- Format date

### Price Utilities
- `adaptic.price.roundUp(price)` -- Round stock price
- `adaptic.price.equityValues(params)` -- Calculate equity values
- `adaptic.price.totalFees(params)` -- Compute total fees

### Infrastructure Exports
- `StampedeProtectedCache` / `createStampedeProtectedCache()` -- LRU cache
- `TokenBucketRateLimiter` / `rateLimiters` -- Rate limiting
- `withRetry(fn, config)` / `API_RETRY_CONFIGS` -- Retry with backoff
- `withTimeout(promise, ms)` / `createTimeoutSignal(ms)` -- Timeouts
- `paginate(config)` / `paginateAll(config)` -- Pagination
- `validateResponse(schema, data)` / `safeValidateResponse(schema, data)` -- Zod validation
- `validateAlpacaCredentials()` / `validatePolygonApiKey()` / `validateAlphaVantageApiKey()` -- Auth
- `setLogger(logger)` / `getLogger()` / `resetLogger()` -- Logger DI
- Error classes: `AlpacaApiError`, `PolygonApiError`, `TimeoutError`, `RateLimitError`, etc.

## Error Class Hierarchy

```
AdapticUtilsError (base)
  +-- AlpacaApiError        (Alpaca API errors, retryable for 429/5xx)
  +-- PolygonApiError        (Polygon.io errors, retryable for 429/5xx)
  +-- AlphaVantageError      (Alpha Vantage errors, retryable for 429/5xx)
  +-- TimeoutError           (always retryable)
  +-- ValidationError        (never retryable)
  +-- AuthenticationError    (never retryable)
  +-- HttpClientError        (4xx, not retryable)
  +-- HttpServerError        (5xx, always retryable)
  +-- RateLimitError         (429, always retryable, may have retryAfterMs)
  +-- WebSocketError         (retryable by default)
  +-- NetworkError           (always retryable)
  +-- DataFormatError        (not retryable)
```

## Important Files for Common Tasks

| Task | Files to Read/Modify |
|------|---------------------|
| Add new Alpaca endpoint | `src/alpaca/trading/` or `src/alpaca/market-data/`, then `src/alpaca/index.ts`, then `src/index.ts` |
| Add new Polygon endpoint | `src/polygon.ts`, `src/types/polygon-types.ts`, `src/schemas/polygon-schemas.ts` |
| Add new technical indicator | `src/technical-analysis.ts`, `src/types/ta-types.ts`, `src/__tests__/technical-analysis.test.ts` |
| Add new performance metric | `src/performance-metrics.ts`, `src/types/metrics-types.ts`, `src/__tests__/performance-metrics.test.ts` |
| Fix market time bug | `src/market-time.ts`, `src/market-hours.ts`, `src/__tests__/market-time.test.ts` |
| Update NYSE holidays | `src/market-hours.ts` |
| Add new error type | `src/errors/index.ts`, `src/index.ts` (export) |
| Add Zod schema | `src/schemas/`, then `src/schemas/index.ts`, then `src/index.ts` |
| Fix build issue | `rollup.config.mjs`, `tsconfig.json`, `package.json` |
| Add new export | `src/index.ts` (both named export and adaptic namespace) |
| Modify types | `src/types/` (check consumers in engine before breaking changes) |
