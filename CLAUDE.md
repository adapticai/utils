# Utils Package - CLAUDE.md

## Overview

Financial utilities library for Adaptic.ai. Published as `@adaptic/utils` on NPM (v0.1.44). Provides Alpaca API wrappers (equities, options, crypto, streaming), Polygon.io market data, Alpha Vantage integration, performance metrics, technical analysis indicators, market time utilities, asset allocation algorithms, Zod-based API response validation, and LRU caching with stampede protection.

## Critical Role

This package is the canonical financial calculation and broker API integration layer consumed by the engine. It owns all broker/API types (AlpacaPosition, AlpacaOrder, AlpacaCredentials, etc.) and external API response shapes. Business-critical types like Trade, Position, and Order come from `@adaptic/backend-legacy` (Prisma-generated) -- this package must never redefine those.

**Type resolution priority:** `@adaptic/backend-legacy` -> `@adaptic/utils` -> `@adaptic/lumic-utils` -> `src/interfaces/`

## Build & Test

```bash
npm run build              # clean + rollup -c (outputs dist/index.mjs + dist/index.cjs + dist/types/)
npm run test               # vitest run (461+ tests)
npm run test:watch         # vitest in watch mode
npm run test:coverage      # vitest with v8 coverage
npm run test:legacy        # build + node dist/test.js (legacy manual tests)
npm run build:analyze      # ANALYZE_BUNDLE=true build with bundle visualization
npm run docs               # TypeDoc generation
npm run docs:watch         # TypeDoc with live regeneration
npm run changelog          # conventional-changelog from commit messages
```

## Important: Testing Patterns

**Vitest (primary):** Tests live in `src/__tests__/`. Run with `npm run test`. 22 test files covering all major modules. Includes property-based tests via `fast-check`.

**Legacy manual testing:** `src/test.ts` is bundled separately by Rollup into `dist/test.js`. Modify the file, then `npm run test:legacy`. This is for ad-hoc broker API integration tests that hit live endpoints.

**You CANNOT compile/run arbitrary TS files** since this is a Rollup-bundled package. Either add Vitest tests in `src/__tests__/` or modify `src/test.ts`.

## Architecture

### Build System

Rollup 4.46 for ESM+CJS dual build. Entry point: `src/index.ts`. Outputs:
- `dist/index.mjs` (ESM)
- `dist/index.cjs` (CJS)
- `dist/types/` (TypeScript declarations)

Externals: react, react-dom, @adaptic/backend-legacy, date-fns, date-fns-tz, date-holidays, ms, node-fetch.

TypeScript 5.8.3, target ES2022, strict mode, ESNext modules.

### Module Organization

**Alpaca Integration (`src/alpaca/`)** -- Modular SDK-based client:
- `client.ts` -- AlpacaClient factory with environment-based creation and caching
- `trading/` -- Orders, positions, account, bracket orders, OCO, OTO, trailing stops, smart orders, clock
- `market-data/` -- Quotes, bars (OHLCV), trades, news
- `crypto/` -- Crypto orders and market data (BTC, ETH, supported pairs)
- `options/` -- Contracts, orders, strategies (verticals, iron condors, straddles, butterflies), data with Greeks
- `streams/` -- WebSocket stream manager, stock/crypto/option/trading streams with base class
- `legacy/` -- Backward-compatible AlpacaAuth-based REST API (auth, orders, positions, account, market-data, assets)

**Legacy Alpaca Classes (top-level):**
- `alpaca-trading-api.ts` -- AlpacaTradingAPI class (equities trading, WebSocket, bracket orders)
- `alpaca-market-data-api.ts` -- AlpacaMarketDataAPI singleton (bars, quotes, trades, snapshots)

**Market Data Providers:**
- `polygon.ts` -- Polygon.io REST API (ticker info, grouped daily, trades, prices, daily open/close)
- `polygon-indices.ts` -- Polygon.io index data (aggregates, snapshots, previous close)
- `alphavantage.ts` -- Alpha Vantage (quotes, news, date conversion)
- `crypto.ts` -- Cryptocurrency data via Alpaca v1beta3 (bars, news, trades, quotes)

**Financial Calculations:**
- `performance-metrics.ts` -- Alpha/beta, max drawdown, daily returns, information ratio, full performance suite
- `metrics-calcs.ts` -- Trade-level PnL metrics
- `technical-analysis.ts` -- EMA, MACD, RSI, Stochastic, Bollinger Bands, Support/Resistance, Fibonacci levels
- `asset-allocation-algorithm.ts` -- Portfolio allocation engine with risk profiles
- `price-utils.ts` -- Stock price rounding, equity values, fee computation

**Time & Formatting:**
- `market-time.ts` -- MarketTimeUtil class (isMarketOpen, next open/close, timezone conversion, market status)
- `market-hours.ts` -- NYSE holiday calendar and early close data (2024-2027)
- `time-utils.ts` -- Unix timestamps, time ago, date normalization, date range calculation
- `format-tools.ts` -- Currency, number, percentage, date, enum formatting

**Infrastructure:**
- `cache/stampede-protected-cache.ts` -- LRU cache with stale-while-revalidate and thundering herd protection
- `rate-limiter.ts` -- Token bucket rate limiter with per-API limiters
- `utils/retry.ts` -- Exponential backoff retry with configurable API-specific retry configs
- `utils/paginator.ts` -- Generic async-iterator pagination (cursor, URL, offset strategies)
- `utils/http-keep-alive.ts` -- HTTP connection pooling verification and monitoring
- `utils/auth-validator.ts` -- API credential validation (Alpaca, Polygon, Alpha Vantage)
- `http-timeout.ts` -- Configurable timeout utilities with abort signal support
- `config/api-endpoints.ts` -- Centralized Alpaca API URLs (trading, market data, WebSocket streams)
- `errors/index.ts` -- 12 typed error classes (AlpacaApiError, PolygonApiError, TimeoutError, RateLimitError, etc.)
- `schemas/` -- Zod validation schemas for Alpaca, Polygon, and Alpha Vantage API responses
- `logger.ts` -- Configurable Pino-compatible logger interface
- `adaptic.ts` -- Shared Apollo Client management and auth configuration

### Type Ownership

This package owns broker/API types in `src/types/`:
- `alpaca-types.ts` (1,465+ lines) -- AlpacaCredentials, AlpacaPosition, AlpacaOrder, TradeUpdate, etc.
- `polygon-types.ts` -- Polygon.io response types (RawPriceData, TickerInfo, etc.)
- `polygon-indices-types.ts` -- Polygon index data types
- `alphavantage-types.ts` -- Alpha Vantage response types
- `market-time-types.ts` -- Market time and hours types
- `ta-types.ts` -- Technical analysis parameter/result types
- `metrics-types.ts` -- Performance metrics types
- `asset-allocation-types.ts` -- Allocation algorithm types (risk profiles, constraints)
- `adaptic-types.ts` -- Shared Adaptic platform types
- `logging-types.ts` -- Logger interface types

**Canonical types from `@adaptic/backend-legacy`:** Trade, Position, Order, Account, Strategy, etc. Never redefine these.

### Export Pattern

Two export styles coexist:
1. **Named exports** -- Error classes, cache, rate limiter, retry, schemas, pagination, logger, types (modern pattern)
2. **Namespace object** -- `adaptic.*` / `adptc.*` with sub-namespaces (alpaca, polygon, metrics, ta, time, format, etc.)

The `alpaca` namespace is also exported directly for SDK-style usage: `import { alpaca } from '@adaptic/utils'`.

## Dependencies

- **Depends on:** `@adaptic/backend-legacy` ^0.0.72 (Prisma types), `@adaptic/lumic-utils` ^1.0.6
- **External:** `@alpacahq/alpaca-trade-api` ^3.1.3, `@apollo/client` ^3.13.8, `date-fns` ^4.1.0, `date-fns-tz` ^3.2.0, `lru-cache` ^11.2.2, `p-limit` ^6.2.0, `zod` ^3.25.76, `chalk` ^5.4.1, `ms` ^2.1.3
- **Peer:** `react` ^16.8.0 || ^17 || ^18 || ^19
- **Dev:** Rollup, Vitest, fast-check (property-based testing), TypeDoc, rollup-plugin-visualizer
- **Package manager:** NPM
- **Node engine:** >=20.0.0
- **Published:** `@adaptic/utils` on NPM

## Code Standards

Same as monorepo-wide standards enforced by the root CLAUDE.md:
- No `any` types (zero instances as of 2026-02-07)
- No `eslint-disable`, no `@ts-ignore`
- No `console.log` in production code -- use the configurable logger (`src/logger.ts`)
- No floating promises
- No TODO/FIXME comments, no commented-out code
- No magic numbers -- use named constants
- Explicit parameter and return types
- JSDoc for all public functions/interfaces
- ESM+CJS compatible exports
- 2-space indentation, K&R braces, camelCase/PascalCase/UPPER_SNAKE_CASE naming

## Workflow Orchestration (God Mode)

### Plan Mode

Enter plan mode before:
- Adding new API wrappers or broker integrations
- Implementing new financial calculations or indicators
- Changing type definitions consumed by engine
- Modifying the Rollup build configuration
- Adding/removing package exports (affects all consumers)

### Verification Checklist

1. `npm run build` must pass (Rollup ESM+CJS dual build)
2. `npm run test` must pass (461+ Vitest tests)
3. Type exports must be correct for consumers (check `dist/types/index.d.ts`)
4. No breaking changes to the `adaptic` namespace object without engine coordination
5. New Zod schemas for any new API response types
6. Error classes for any new external API integrations

### Autonomous Bug Fixing

When debugging utils issues:
1. Check Rollup build output -- look for unresolved externals or circular dependencies
2. Verify ESM/CJS compatibility -- both `dist/index.mjs` and `dist/index.cjs` must work
3. Check API wrapper error handling -- all external calls should use typed error classes
4. Verify financial calculation accuracy -- cross-reference with known-good values
5. Test with property-based tests for numeric functions (`fast-check`)
6. Verify rate limiter and retry behavior under load
7. Check cache invalidation and stampede protection
8. Validate market time calculations against NYSE calendar (holidays, DST transitions, early closes)

### Core Principles

- **Financial accuracy is paramount** -- never approximate, never round prematurely, use proper decimal handling
- **Broker API types must match actual API responses** -- validate with Zod schemas
- **Cache invalidation must be correct** -- stale data in financial context is dangerous
- **Market time calculations must handle all edge cases** -- holidays, DST, early closes, pre/post market
- **Error handling must be structured** -- use typed error classes, never swallow errors
- **Rate limiting must be per-API** -- different APIs have different limits
- **Backward compatibility matters** -- engine depends on the `adaptic` namespace; deprecate before removing
