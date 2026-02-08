# @adaptic/utils - Target State Architecture

**Vision:** Zero-`any`, fully-typed financial utilities library with comprehensive error handling, retry logic, and institutional-grade API integrations. The canonical library for all financial data operations across the Adaptic platform.

**Last Updated:** 2026-02-08

## Gap Analysis & Tasks

### P0 - Critical

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Eliminate all `any` types | RESOLVED | All 47 instances removed as of 2026-02-07. |
| 2 | Add request timeouts | RESOLVED | Implemented in `src/http-timeout.ts` with configurable defaults. |
| 3 | Add retry logic with exponential backoff | RESOLVED | Implemented in `src/utils/retry.ts` with token bucket rate limiting in `src/rate-limiter.ts`. |
| 4 | Remove deprecated functions | RESOLVED | Deprecated aliases cleaned up in Wave 3C. Legacy functions removed or properly migrated. |
| 5 | Standardize API base URLs | RESOLVED | `src/config/api-endpoints.ts` consolidates all URLs; v1beta1/v1beta3 are the correct latest Alpaca API versions. |
| 6 | Add Node engine requirement to package.json | RESOLVED | `package.json` has `"engines": { "node": ">=20.0.0" }`. |

### P1 - High Priority

| # | Task | Status | Notes |
|---|------|--------|-------|
| 7 | Rate limiting client-side | RESOLVED | Token bucket rate limiter implemented in `src/rate-limiter.ts` with per-API limiters. |
| 8 | Structured error types | RESOLVED | 13 error classes implemented in `src/errors/index.ts` (AlpacaApiError, PolygonApiError, TimeoutError, RateLimitError, etc.). |
| 9 | Configurable caching | RESOLVED | StampedeProtectedCache with stale-while-revalidate implemented in `src/cache/stampede-protected-cache.ts`. |
| 10 | Replace console.error | RESOLVED | Configurable Pino-compatible logger implemented in `src/logger.ts`. |
| 11 | Auth validation | RESOLVED | API credential validation implemented in `src/utils/auth-validator.ts`. |
| 12 | Expand Vitest test suite | MOSTLY RESOLVED | 617 tests passing (up from 516), significantly expanded from 4 test files. Coverage includes auth-validator, cache, market-time, technical-analysis, alpaca, crypto, format, metrics, polygon, property-based, regression, schema-validation, paginator, and http-keep-alive modules. Some modules may still lack complete coverage. |
| 13 | Property-based tests for financial calculations | RESOLVED | 55 property-based and regression tests using fast-check in `src/__tests__/property-based-financial.test.ts` and `src/__tests__/financial-regression.test.ts`. Covers beta (identity, linearity, inverse correlation, zero-variance), drawdown (bounds, monotonicity, peak/trough invariants), returns (log return additivity, round-trip symmetry), EMA (constant series, bounds, output length), RSI (0-100 bounds, trend direction), and Bollinger Bands (band ordering, SMA accuracy, known std dev). |

### P2 - Medium Priority

| # | Task | Status | Notes |
|---|------|--------|-------|
| 14 | API response validation with Zod schemas | RESOLVED | Zod schemas implemented in `src/schemas/` for all critical API responses: Alpaca (Account, Position, Order with recursive legs, Bar, Quote, Trade, News, Portfolio History, Crypto Bars), Polygon (RawPriceData, TickerInfo, GroupedDaily, DailyOpenClose, Trade, Aggregates, Error), and Alpha Vantage (Quote, NewsArticle, NewsResponse). `validateResponse()` and `safeValidateResponse()` helpers in `src/schemas/validate-response.ts`. Non-strict mode (default) logs warnings without breaking; strict mode throws `ValidationResponseError`. 55 tests in `src/__tests__/schema-validation.test.ts`. |
| 15 | Bundle size analysis and tree-shaking optimization | RESOLVED | `rollup-plugin-visualizer` configured in `rollup.config.mjs`. Run `npm run build:analyze` (sets `ANALYZE_BUNDLE=true`) to generate `dist/bundle-stats.html` (interactive treemap with gzip/brotli sizes) and `dist/bundle-stats.json` (raw data). |
| 16 | TypeDoc generation from JSDoc | RESOLVED | TypeDoc configured via `typedoc.json`. Run `npm run docs` to generate API documentation in `docs/` directory. Configured with category ordering (Alpaca, Polygon, Performance Metrics, etc.), private/internal exclusions, and search support. Run `npm run docs:watch` for live regeneration during development. |
| 17 | Changelog automation for NPM releases | RESOLVED | `conventional-changelog-cli` configured with Angular preset. Run `npm run changelog` to generate/update `CHANGELOG.md` from conventional commit messages. Tag prefix set to `utils-v` for monorepo compatibility. Configuration in `.changelogrc.json` with custom type sections (Features, Bug Fixes, Performance, Refactoring, Documentation, Tests, Build System, CI/CD). |
| 18 | Connection pooling verification for HTTP clients | RESOLVED | Verified in `src/utils/http-keep-alive.ts`. All API clients use native `fetch()` (Node.js >= 20 undici with built-in connection pooling and keep-alive). Pre-configured `httpAgent`/`httpsAgent` for `node:http`/`node:https` use cases. `getAgentPoolStatus()` for monitoring, `verifyFetchKeepAlive()` for runtime verification. Comprehensive API client transport table documenting connection reuse behavior. 24 tests in `src/__tests__/http-keep-alive.test.ts`. |
| 19 | Pagination helper | RESOLVED | Generic async-iterator pagination utility in `src/utils/paginator.ts`. Supports three strategies: `CursorPaginationConfig` (Alpaca `next_page_token`/`page_token`), `UrlPaginationConfig` (Polygon `next_url`), and `OffsetPaginationConfig` (page-number based). `paginate()` yields items one at a time via AsyncGenerator; `paginateAll()` collects all into an array. Safety limits via `maxPages` (default 1000) and `maxItems`. 23 tests in `src/__tests__/paginator.test.ts`. |
| 20 | Market calendar integration | RESOLVED | `src/market-hours.ts` contains NYSE holiday and early close data for 2024-2027. `src/market-time.ts` uses this calendar data for `isHolidayZoned()`, `isEarlyCloseDayZoned()`, `getMarketStatus()`, `getNextMarketDay()`, `getLastTradingDateYYYYMMDD()`, and `getLastFullTradingDate()`. 2027 data sourced from official NYSE Group announcement. |

### P3 - Enhancement

| # | Task | Status | Notes |
|---|------|--------|-------|
| 21 | Complete legacy migration | RESOLVED | Migrated `alpaca-functions.ts` (1,688 lines) into `src/alpaca/legacy/` with 6 modular files: `auth.ts`, `orders.ts`, `positions.ts`, `account.ts`, `market-data.ts`, `assets.ts`, plus `utils.ts` for shared helpers. Legacy file deleted. All 618 tests pass, build succeeds. |

## Progress Summary

| Priority | Total | Resolved | In Progress | Not Started |
|----------|-------|----------|-------------|-------------|
| P0 | 6 | 6 | 0 | 0 |
| P1 | 7 | 7 | 0 | 0 |
| P2 | 7 | 7 | 0 | 0 |
| P3 | 1 | 1 | 0 | 0 |

## Cross-Package Alignment

- Types MUST come from @adaptic/backend-legacy (Prisma-generated). Do not redefine Trade, Position, Order, etc.
- src/types/ should contain ONLY types specific to external APIs (Alpaca, Polygon, Alpha Vantage response types)
- Shared Apollo Client setup must be consistent with backend-legacy's client.ts patterns
- Logger interface should be compatible with engine's Pino-based logging (RESOLVED - src/logger.ts)
- Node engine requirement must align: >=20 (matching backend-legacy and lumic-utils)
- TypeScript version: currently 5.8.3 (backend-legacy on 5.9.x - minor drift, non-blocking)
