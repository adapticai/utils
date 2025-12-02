# @adaptic/utils - Complete Inventory

**Generated:** 2025-12-02
**Package Version:** 0.0.380
**Total Source Lines:** ~15,429 lines of TypeScript
**Total Files:** 35 source files + 11 type definition files

---

## Executive Summary

The `@adaptic/utils` package is a comprehensive utility library for financial trading applications, specifically designed for the Adaptic algorithmic trading platform. It provides deep integration with multiple broker APIs (Alpaca, Polygon, AlphaVantage) and includes utilities for market time calculations, technical analysis, performance metrics, asset allocation, and caching.

**Key Characteristics:**
- Heavy dependency on Alpaca broker API
- Market-specific utilities (NYSE hours, trading days, holidays)
- Real-time and historical market data processing
- Comprehensive type definitions (3,424 LOC for types alone)
- Advanced caching with stampede protection
- Limited test coverage (no formal test files found)

---

## Module Inventory by Category

### 1. BROKER API INTEGRATIONS

#### 1.1 Alpaca Trading API
**Files:**
- `alpaca-trading-api.ts` (1,683 LOC)
- `alpaca-functions.ts` (1,659 LOC)
- `alpaca-market-data-api.ts` (1,274 LOC)

**Purpose:** Comprehensive Alpaca broker integration including trading operations, account management, and market data retrieval.

**Key Exports:**
- `AlpacaTradingAPI` - Class-based trading API client
- `AlpacaMarketDataAPI` - Singleton market data client
- `createAlpacaTradingAPI()` - Factory function
- `createAlpacaMarketDataAPI()` - Factory function
- Account operations: `fetchAccountDetails()`, `fetchPortfolioHistory()`
- Position management: `fetchPosition()`, `fetchAllPositions()`, `closePosition()`, `closeAllPositions()`
- Order operations: `createOrder()`, `createLimitOrder()`, `getOrder()`, `getOrders()`, `replaceOrder()`, `cancelOrder()`
- Market data: `getLatestQuotes()`, `fetchNews()`
- Asset info: `getAsset()`

**Broker-Specific:**
- Alpaca REST API v2 integration
- Paper trading and live trading support
- OAuth credential management
- Rate limiting and retry logic

**LOC:** 4,616 lines

---

#### 1.2 Polygon.io API
**Files:**
- `polygon.ts` (568 LOC)
- `polygon-indices.ts` (314 LOC)

**Purpose:** Market data retrieval from Polygon.io including stocks and indices.

**Key Exports:**
- `fetchTickerInfo()` - Company/ticker information
- `fetchGroupedDaily()` - Daily aggregates for all tickers
- `fetchLastTrade()` - Latest trade data
- `fetchTrades()` - Historical trades
- `fetchPrices()` - Historical price data
- `fetchDailyOpenClose()` - OHLC data for specific date
- `getPreviousClose()` - Previous trading day close price
- `analysePolygonPriceData()` - Price data analysis
- `formatPriceData()` - Format converter

**Indices-specific:**
- `fetchIndicesAggregates()` - Index aggregates
- `fetchIndicesPreviousClose()` - Index previous close
- `fetchIndicesDailyOpenClose()` - Index OHLC
- `fetchIndicesSnapshot()` - Real-time index snapshot
- `fetchUniversalSnapshot()` - Universal snapshot API
- `formatIndicesBarData()` - Bar data formatter

**LOC:** 882 lines

---

#### 1.3 AlphaVantage API
**Files:**
- `alphavantage.ts` (148 LOC)

**Purpose:** AlphaVantage API integration for quotes and news.

**Key Exports:**
- `fetchQuote()` - Real-time quote data
- `fetchTickerNews()` - News articles for ticker
- `convertDateToYYYYMMDDTHHMM()` - Date formatter for AV API
- `convertYYYYMMDDTHHMMSSToDate()` - Date parser from AV format

**LOC:** 148 lines

---

#### 1.4 Adaptic Backend Integration
**Files:**
- `adaptic.ts` (155 LOC)

**Purpose:** Integration with Adaptic's GraphQL backend for asset data and authentication.

**Key Exports:**
- `getSharedApolloClient()` - GraphQL client singleton
- `configureAuth()` - Configure authentication
- `isAuthConfigured()` - Check auth status
- `fetchAssetOverview()` - Asset overview from backend
- `TokenProvider` type - JWT token provider

**Dependencies:**
- `@apollo/client` for GraphQL
- `@adaptic/backend-legacy` for types and enums

**LOC:** 155 lines

---

### 2. MARKET TIME & CALENDAR UTILITIES

#### 2.1 Market Time Calculations
**Files:**
- `market-time.ts` (818 LOC)
- `market-hours.ts` (131 LOC)
- `time-utils.ts` (200 LOC)

**Purpose:** NYSE market hours, trading days, holidays, and time zone conversions.

**Key Exports:**

**Market Status & Hours:**
- `MarketTimeUtil` - Class for market time operations
- `createMarketTimeUtil()` - Factory function
- `getMarketStatus()` - Check if market is open/closed/pre/post
- `getMarketOpenClose()` - Get market open/close times for date
- `MARKET_TIMES` - Constant with all market hour definitions
- `getNYTimeZone()` - Get NY timezone

**Trading Days:**
- `getLastTradingDateYYYYMMDD()` - Last trading date in YYYYMMDD format
- `getLastFullTradingDate()` - Last complete trading day
- `getNextMarketDay()` - Next market open day
- `getTradingDate()` - Get trading date for timestamp
- `isMarketDay()` - Check if date is a trading day
- `isEarlyCloseDay()` - Check if date has early market close
- `isWithinMarketHours()` - Check if time is during market hours

**Date/Time Utilities:**
- `getDateInNY()` - Convert timestamp to NY timezone date
- `currentTimeET()` - Current time in Eastern Time
- `getStartAndEndTimestamps()` - Period start/end timestamps
- `getStartAndEndDates()` - Period start/end dates
- `toUnixTimestamp()` - Convert to Unix timestamp
- `normalizeDate()` - Normalize timestamp to YYYY-MM-DD
- `calculateTimeRange()` - Calculate date range (1d, 1w, 1m, etc.)
- `calculateDaysLeft()` - Days remaining in period
- `parseETDateFromAV()` - Parse AlphaVantage date strings
- `formatToUSEastern()` - Format date to US Eastern
- `unixTimetoUSEastern()` - Convert Unix timestamp to ET
- `timeDiffString()` - Human-readable time difference

**Relative Time:**
- `timeAgo()` - Relative time string (e.g., "2 hours ago")
- `getTimeAgo()` - Alternative relative time formatter
- `formatDate()` - Format date for display
- `formatDateToString()` - Detailed date/time string

**Market Hours Config:**
- Pre-market: 4:00 AM - 9:30 AM ET
- Regular hours: 9:30 AM - 4:00 PM ET
- Extended hours: 4:00 PM - 8:00 PM ET
- Early close days: 9:30 AM - 1:00 PM ET
- Holiday calendars: 2024-2026+

**LOC:** 1,149 lines

---

### 3. FINANCIAL CALCULATIONS

#### 3.1 Performance Metrics
**Files:**
- `performance-metrics.ts` (1,111 LOC)
- `metrics-calcs.ts` (516 LOC)

**Purpose:** Calculate portfolio performance metrics including Sharpe, Sortino, alpha, beta, drawdown, etc.

**Key Exports:**

**Core Metrics:**
- `fetchPerformanceMetrics()` - Comprehensive performance analysis
- `calculateAlphaAndBeta()` - Alpha and beta vs benchmark
- `calculateBetaFromReturns()` - Beta from return series
- `calculateMaxDrawdown()` - Maximum drawdown calculation
- `calculateDailyReturns()` - Daily return series
- `alignReturnsByDate()` - Align portfolio and benchmark returns
- `calculateInformationRatio()` - Information ratio vs benchmark
- `fetchTradeMetrics()` - Individual trade metrics

**Supported Metrics:**
- Sharpe Ratio
- Sortino Ratio
- Calmar Ratio
- Information Ratio
- Alpha (vs benchmark)
- Beta (vs benchmark)
- Maximum Drawdown
- Win Rate
- Profit Factor
- Average Win/Loss
- Total Return
- Annualized Return
- Volatility (annualized)

**LOC:** 1,627 lines

---

#### 3.2 Technical Analysis
**Files:**
- `technical-analysis.ts` (535 LOC)

**Purpose:** Calculate technical indicators for trading signals.

**Key Exports:**
- `calculateEMA()` - Exponential Moving Average
- `calculateMACD()` - Moving Average Convergence Divergence
- `calculateRSI()` - Relative Strength Index
- `calculateStochasticOscillator()` - Stochastic oscillator
- `calculateBollingerBands()` - Bollinger Bands (SMA + std dev)
- `calculateSupportAndResistance()` - Support/resistance levels
- `calculateFibonacciLevels()` - Fibonacci retracement levels

**Indicators Supported:**
- EMA (single and dual period)
- MACD (12/26/9 configurable)
- RSI (14-period default)
- Stochastic (14/3/3 default)
- Bollinger Bands (20-period, 2 std dev default)
- Support/Resistance (pivot points)
- Fibonacci (0.236, 0.382, 0.5, 0.618, 0.786)

**LOC:** 535 lines

---

#### 3.3 Asset Allocation Engine
**Files:**
- `asset-allocation-algorithm.ts` (1,334 LOC)

**Purpose:** Portfolio optimization and asset allocation using Modern Portfolio Theory (MPT).

**Key Exports:**
- `AssetAllocationEngine` - Main allocation engine class
- `generateOptimalAllocation()` - Generate optimal portfolio
- `getDefaultRiskProfile()` - Get default risk profile

**Features:**
- Mean-variance optimization
- Risk-adjusted portfolio construction
- Configurable risk profiles (conservative, moderate, aggressive)
- Constraint-based optimization (min/max allocations)
- Sector diversification
- Rebalancing recommendations
- Expected return and risk calculations

**Risk Profiles:**
- Conservative: Lower volatility, bonds/stable assets
- Moderate: Balanced stocks/bonds
- Aggressive: Higher equity allocation

**LOC:** 1,334 lines

---

#### 3.4 Price Utilities
**Files:**
- `price-utils.ts` (222 LOC)

**Purpose:** Price manipulation and equity value calculations.

**Key Exports:**
- `roundStockPrice()` - Round price to appropriate precision (>$1: 2 decimals, <$1: 4 decimals)
- `getEquityValues()` - Extract initial and latest equity from portfolio history
- `computeTotalFees()` - Calculate trading fees for a trade

**LOC:** 222 lines

---

### 4. CRYPTO UTILITIES

**Files:**
- `crypto.ts` (315 LOC)

**Purpose:** Cryptocurrency market data via Alpaca Crypto API.

**Key Exports:**
- `fetchBars()` - Historical crypto OHLCV bars
- `fetchNews()` - Crypto-related news
- `fetchLatestTrades()` - Latest crypto trades
- `fetchLatestQuotes()` - Latest crypto quotes

**Supported:**
- Bitcoin, Ethereum, and other crypto pairs
- Real-time quotes
- Historical bars
- News feed

**LOC:** 315 lines

---

### 5. CACHING INFRASTRUCTURE

**Files:**
- `cache/stampede-protected-cache.ts` (839 LOC)

**Purpose:** Advanced LRU cache with stampede protection for high-frequency API calls.

**Key Exports:**
- `StampedeProtectedCache<T>` - Main cache class
- `createStampedeProtectedCache()` - Factory function
- `DEFAULT_CACHE_OPTIONS` - Default configuration
- Types: `CacheEntry`, `CacheStats`, `CacheLoader`, `StampedeProtectedCacheOptions`

**Features:**
- **Three-layer stampede protection:**
  1. Request coalescing (merge concurrent requests)
  2. Stale-while-revalidate (serve stale during refresh)
  3. Probabilistic early expiration (jitter to prevent synchronized expiration)
- LRU eviction (uses `lru-cache` library)
- Configurable TTL with jitter (default: 60s, 90-110% jitter)
- Background refresh for stale data
- Comprehensive statistics (hits, misses, stale hits, coalesced requests)
- Structured logging support

**Use Cases:**
- Position data caching (30-60s TTL)
- Market quote caching (5-10s TTL)
- Account data caching
- Rate limit protection for Alpaca/Polygon APIs

**LOC:** 839 lines

---

### 6. FORMATTING & DISPLAY

**Files:**
- `format-tools.ts` (104 LOC)
- `display-manager.ts` (136 LOC)

**Purpose:** Data formatting and UI display utilities.

**Key Exports:**

**format-tools.ts:**
- `capitalize()` - Capitalize first letter
- `formatEnum()` - Format enum to human-readable (STOCK_TICKER → Stock Ticker)
- `formatCurrency()` - Format as USD currency ($1,234.56)
- `formatNumber()` - Format number with commas (1,234.56)
- `formatPercentage()` - Format as percentage (0.75 → 75.00%)
- `dateTimeForGS()` - Format for Google Sheets (DD/MM/YYYY HH:MM:SS)

**display-manager.ts:**
- `DisplayManager` - React-based chart display manager
- Lightweight Charts integration
- Real-time chart updates

**LOC:** 240 lines

---

### 7. MISCELLANEOUS UTILITIES

**Files:**
- `misc-utils.ts` (265 LOC)
- `logging.ts` (16 LOC)

**Purpose:** General-purpose utilities and debug logging.

**Key Exports:**
- `logIfDebug()` - Debug logging with LUMIC_DEBUG env flag
- `fetchWithRetry()` - HTTP fetch with intelligent retry logic
- `validatePolygonApiKey()` - Validate Polygon API key
- `hideApiKeyFromurl()` - Mask API keys in URLs for logging
- `maskApiKey()` - Mask middle of API key

**Retry Logic Features:**
- Configurable retry attempts (default: 3)
- Exponential backoff (1s, 2s, 4s, max 30s)
- Rate limit detection (429 status)
- Retry-After header support
- Auth error fast-fail (401/403)
- Server error retry (500, 502, 503, 504)
- Client error no-retry (4xx except 429)
- Structured error logging

**LOC:** 281 lines

---

### 8. TYPE DEFINITIONS

**Files:**
- `types/index.ts` (23 LOC) - Main type exports
- `types/alpaca-types.ts` (1,382 LOC) - Alpaca API types
- `types/asset-allocation-types.ts` (473 LOC) - Asset allocation types
- `types/polygon-types.ts` (213 LOC) - Polygon API types
- `types/polygon-indices-types.ts` (200 LOC) - Polygon indices types
- `types/ta-types.ts` (101 LOC) - Technical analysis types
- `types/alphavantage-types.ts` (70 LOC) - AlphaVantage types
- `types/market-time-types.ts` (66 LOC) - Market time types
- `types/metrics-types.ts` (36 LOC) - Metrics types
- `types/adaptic-types.ts` (12 LOC) - Adaptic backend types
- `types/logging-types.ts` (9 LOC) - Logging types

**Total Type Definitions:** 2,585 LOC

**Key Type Categories:**
- Alpaca: Orders, positions, accounts, market data, bars, quotes, trades
- Asset Allocation: Risk profiles, allocation results, constraints, optimization
- Polygon: Tickers, aggregates, quotes, trades, indices
- Technical Analysis: EMA, MACD, RSI, Bollinger Bands, support/resistance
- Market Time: Periods, market status, trading hours, holidays
- Metrics: Performance metrics, returns, drawdown

---

### 9. TESTING & EXAMPLES

**Files:**
- `test.ts` (302 LOC) - Manual test script
- `examples/asset-allocation-example.ts` - Asset allocation usage
- `testing/options-ws.ts` - WebSocket testing for options

**Current State:**
- No formal test framework (Vitest, Jest, Mocha)
- No `*.test.ts` or `*.spec.ts` files
- Manual test script in `test.ts`
- Example files for documentation

**Test Coverage:** 0% formal coverage

---

## Dependency Analysis

### External Dependencies

**Production Dependencies:**
```json
{
  "@adaptic/backend-legacy": "^0.0.38",    // Adaptic backend types
  "@adaptic/lumic-utils": "^1.0.6",        // Lumic utilities (TO BE MERGED)
  "@apollo/client": "^3.13.8",             // GraphQL client
  "chalk": "^5.4.1",                       // Terminal colors
  "date-fns": "^4.1.0",                    // Date manipulation
  "date-fns-tz": "^3.2.0",                 // Timezone support
  "lru-cache": "^11.2.2",                  // LRU cache for stampede protection
  "ms": "^2.1.3",                          // Time string parsing
  "p-limit": "^6.2.0",                     // Concurrency limiting
  "ws": "^8.18.3"                          // WebSocket client
}
```

**Dev Dependencies:**
```json
{
  "@rollup/plugin-commonjs": "^28.0.6",
  "@rollup/plugin-json": "^6.1.0",
  "@rollup/plugin-node-resolve": "^16.0.1",
  "@rollup/plugin-typescript": "^12.1.4",
  "lightweight-charts": "^5.0.8",          // Charting (peer dep for display-manager)
  "react": "^19.1.0",                      // React (peer dep for display-manager)
  "rollup": "^4.46.2",
  "typescript": "^5.8.3"
}
```

**Peer Dependencies:**
```json
{
  "react": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0"
}
```

---

### Internal Dependencies

**Highly Coupled Modules:**
- `alpaca-functions.ts` ← Used by price-utils, metrics-calcs
- `market-time.ts` ← Used by alpaca, polygon, price-utils
- `time-utils.ts` ← Used by market-time, alpaca, polygon
- `misc-utils.ts` ← Used by polygon, alpaca, technical-analysis
- `types/*` ← Used by all modules

**Backend-Specific Dependencies:**
- `@adaptic/backend-legacy` - Used in price-utils, adaptic
- Need to abstract for multi-tenant architecture

---

## Alpaca-Specific Code Requiring Abstraction

The following modules are tightly coupled to Alpaca and need broker abstraction:

### High Priority (Core Trading)
1. **alpaca-trading-api.ts** (1,683 LOC) - Entire file
2. **alpaca-functions.ts** (1,659 LOC) - Entire file
3. **alpaca-market-data-api.ts** (1,274 LOC) - Entire file
4. **price-utils.ts** (222 LOC) - `computeTotalFees()`, `getEquityValues()`
5. **metrics-calcs.ts** (516 LOC) - Uses Alpaca portfolio history format

### Medium Priority (Data/Backend)
6. **crypto.ts** (315 LOC) - Alpaca Crypto API
7. **adaptic.ts** (155 LOC) - Backend integration with Alpaca account types

### Low Priority (Independent)
8. **polygon.ts** (568 LOC) - Independent API, no abstraction needed
9. **alphavantage.ts** (148 LOC) - Independent API, no abstraction needed
10. **market-time.ts** (818 LOC) - NYSE-specific but can support multiple exchanges
11. **technical-analysis.ts** (535 LOC) - Broker-agnostic
12. **performance-metrics.ts** (1,111 LOC) - Broker-agnostic
13. **asset-allocation-algorithm.ts** (1,334 LOC) - Broker-agnostic

**Total LOC Requiring Abstraction:** ~5,824 lines (37% of codebase)

---

## Export Strategy

### Current Main Export (`index.ts`)

The package uses a **namespace-based export** pattern:

```typescript
export const adaptic = {
  types: Types,
  backend: { ... },
  alpaca: { ... },
  av: { ... },
  crypto: { ... },
  format: { ... },
  metrics: { ... },
  polygon: { ... },
  indices: { ... },
  price: { ... },
  ta: { ... },
  time: { ... },
  utils: { ... },
};
```

**Usage:**
```typescript
import { adaptic } from '@adaptic/utils';
const positions = await adaptic.alpaca.position.fetchAll(...);
```

### Also Exported (Direct Access)
```typescript
// Classes
export { AlpacaTradingAPI, AlpacaMarketDataAPI };

// Factory functions
export const createAlpacaTradingAPI = ...;
export const createAlpacaMarketDataAPI = ...;

// Cache utilities
export { StampedeProtectedCache, createStampedeProtectedCache, DEFAULT_CACHE_OPTIONS };

// Asset allocation
export { AssetAllocationEngine, generateOptimalAllocation, getDefaultRiskProfile };

// All types
export * from './types';
export * from './types/asset-allocation-types';
```

**Usage:**
```typescript
import { AlpacaTradingAPI } from '@adaptic/utils';
import { createStampedeProtectedCache } from '@adaptic/utils';
```

---

## Lines of Code by Category

| Category | Files | LOC | % of Total |
|----------|-------|-----|-----------|
| **Broker APIs (Alpaca)** | 3 | 4,616 | 29.9% |
| **Type Definitions** | 11 | 2,585 | 16.7% |
| **Performance Metrics** | 2 | 1,627 | 10.5% |
| **Asset Allocation** | 1 | 1,334 | 8.6% |
| **Market Time & Calendar** | 3 | 1,149 | 7.4% |
| **Polygon API** | 2 | 882 | 5.7% |
| **Cache Infrastructure** | 1 | 839 | 5.4% |
| **Technical Analysis** | 1 | 535 | 3.5% |
| **Crypto (Alpaca Crypto)** | 1 | 315 | 2.0% |
| **Testing** | 3 | 302 | 2.0% |
| **Misc Utilities** | 2 | 281 | 1.8% |
| **Formatting** | 2 | 240 | 1.6% |
| **Price Utils** | 1 | 222 | 1.4% |
| **Backend Integration** | 1 | 155 | 1.0% |
| **AlphaVantage API** | 1 | 148 | 1.0% |
| **Main Exports** | 1 | 199 | 1.3% |
| **TOTAL** | **35** | **15,429** | **100%** |

---

## Known Issues & Technical Debt

### 1. Testing
- **Issue:** No formal test framework
- **Impact:** High risk of regressions
- **Recommendation:** Implement Vitest with 90% coverage target

### 2. Broker Coupling
- **Issue:** 37% of codebase is Alpaca-specific
- **Impact:** Cannot support Interactive Brokers, Schwab, etc.
- **Recommendation:** Create broker abstraction layer

### 3. Backend Coupling
- **Issue:** Hardcoded dependency on `@adaptic/backend-legacy`
- **Impact:** Cannot support multi-tenant architecture
- **Recommendation:** Abstract backend interface

### 4. Lumic Utils Duplication
- **Issue:** Separate `@adaptic/lumic-utils` package
- **Impact:** Duplicate functionality, version conflicts
- **Recommendation:** Merge into this package under `/lumic` namespace

### 5. Missing Subpath Exports
- **Issue:** Only root export, no tree-shaking optimization
- **Impact:** Large bundle sizes
- **Recommendation:** Add subpath exports:
  ```json
  "exports": {
    ".": "./dist/index.mjs",
    "./cache": "./dist/cache/index.mjs",
    "./alpaca": "./dist/alpaca/index.mjs",
    "./time": "./dist/time/index.mjs"
  }
  ```

### 6. Type Organization
- **Issue:** 1,382 LOC in single `alpaca-types.ts` file
- **Impact:** Poor maintainability
- **Recommendation:** Split into separate files (orders, positions, accounts, market-data)

### 7. Environment Variables
- **Issue:** Hardcoded env var names (POLYGON_API_KEY, ALPHA_VANTAGE_API_KEY)
- **Impact:** Not configurable for different environments
- **Recommendation:** Accept config objects instead of env vars

---

## Recommended Module Organization (Post-Consolidation)

```
@adaptic/utils/
├── src/
│   ├── alpaca/              # Alpaca-specific (TO BE ABSTRACTED)
│   │   ├── trading-api.ts
│   │   ├── market-data-api.ts
│   │   ├── functions.ts
│   │   └── types.ts
│   ├── brokers/             # NEW: Multi-broker abstraction
│   │   ├── interface.ts
│   │   ├── alpaca/
│   │   ├── interactive-brokers/
│   │   └── schwab/
│   ├── cache/
│   │   └── stampede-protected-cache.ts
│   ├── data-providers/      # Market data (broker-agnostic)
│   │   ├── polygon/
│   │   ├── alphavantage/
│   │   └── crypto/
│   ├── analytics/           # Financial calculations
│   │   ├── performance-metrics.ts
│   │   ├── technical-analysis.ts
│   │   └── asset-allocation.ts
│   ├── time/                # Market time utilities
│   │   ├── market-time.ts
│   │   ├── market-hours.ts
│   │   └── time-utils.ts
│   ├── formatting/
│   │   ├── format-tools.ts
│   │   └── display-manager.ts
│   ├── utils/               # General utilities
│   │   ├── misc-utils.ts
│   │   ├── price-utils.ts
│   │   └── logging.ts
│   ├── lumic/               # Merged from @adaptic/lumic-utils
│   │   └── [lumic utilities]
│   └── types/
│       └── index.ts
└── package.json
```

---

## Next Steps (See CONSOLIDATION-PLAN.md)

1. Analyze `@adaptic/lumic-utils` contents
2. Design broker abstraction layer
3. Create migration plan for existing consumers
4. Implement test coverage (90% target)
5. Refactor for tree-shaking with subpath exports
6. Document breaking changes

---

**End of Inventory**
