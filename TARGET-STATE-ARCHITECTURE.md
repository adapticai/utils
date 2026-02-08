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
| 12 | Expand Vitest test suite | MOSTLY RESOLVED | 516 tests passing, significantly expanded from 4 test files. Coverage includes auth-validator, cache, market-time, technical-analysis, alpaca, crypto, format, metrics, polygon, property-based, and regression modules. Some modules may still lack complete coverage. |
| 13 | Property-based tests for financial calculations | RESOLVED | 55 property-based and regression tests using fast-check in `src/__tests__/property-based-financial.test.ts` and `src/__tests__/financial-regression.test.ts`. Covers beta (identity, linearity, inverse correlation, zero-variance), drawdown (bounds, monotonicity, peak/trough invariants), returns (log return additivity, round-trip symmetry), EMA (constant series, bounds, output length), RSI (0-100 bounds, trend direction), and Bollinger Bands (band ordering, SMA accuracy, known std dev). |

### P2 - Medium Priority

| # | Task | Status | Notes |
|---|------|--------|-------|
| 14 | API response validation with Zod schemas | NOT STARTED | Validate API responses from Alpaca, Polygon, and Alpha Vantage against expected schemas to catch breaking API changes early. |
| 15 | Bundle size analysis and tree-shaking optimization | NOT STARTED | Analyze Rollup bundle output. Verify tree-shaking works correctly for consumers that import only subsets. |
| 16 | TypeDoc generation from JSDoc | NOT STARTED | Auto-generate API documentation from existing JSDoc comments. Publish alongside NPM package. |
| 17 | Changelog automation for NPM releases | NOT STARTED | Automated changelog generation from commit messages (conventional commits). |
| 18 | Connection pooling verification for HTTP clients | NOT STARTED | Verify HTTP connection reuse across Alpaca/Polygon/Alpha Vantage clients. Ensure keep-alive is configured correctly. |
| 19 | Pagination helper | NOT STARTED | Generic pagination utility for all APIs that support it (Alpaca orders, news, bars). |
| 20 | Market calendar integration | NOT STARTED | MarketTimeTracker should use actual exchange calendar data, not just time-of-day checks. |

### P3 - Enhancement

| # | Task | Status | Notes |
|---|------|--------|-------|
| 21 | Complete legacy migration | NOT STARTED | Fully migrate `alpaca-functions.ts` (1,688 lines) into modular `src/alpaca/` structure and remove the legacy file. |

## Progress Summary

| Priority | Total | Resolved | In Progress | Not Started |
|----------|-------|----------|-------------|-------------|
| P0 | 6 | 6 | 0 | 0 |
| P1 | 7 | 7 | 0 | 0 |
| P2 | 7 | 0 | 0 | 7 |
| P3 | 1 | 0 | 0 | 1 |

## Cross-Package Alignment

- Types MUST come from @adaptic/backend-legacy (Prisma-generated). Do not redefine Trade, Position, Order, etc.
- src/types/ should contain ONLY types specific to external APIs (Alpaca, Polygon, Alpha Vantage response types)
- Shared Apollo Client setup must be consistent with backend-legacy's client.ts patterns
- Logger interface should be compatible with engine's Pino-based logging (RESOLVED - src/logger.ts)
- Node engine requirement must align: >=20 (matching backend-legacy and lumic-utils)
- TypeScript version: currently 5.8.3 (backend-legacy on 5.9.x - minor drift, non-blocking)
