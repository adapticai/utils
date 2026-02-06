# @adaptic/utils - Target State Architecture

**Vision:** Zero-`any`, fully-typed financial utilities library with comprehensive error handling, retry logic, and institutional-grade API integrations. The canonical library for all financial data operations across the Adaptic platform.

## Gap Analysis & Tasks

### P0 - Critical

1. **Eliminate all `any` types** - Replace all 47 instances of `any`/`as any` with proper types. This is the #1 type safety issue.
2. **Add request timeouts** - All HTTP calls (Alpaca, Polygon, Alpha Vantage) must have configurable timeouts (default 30s).
3. **Add retry logic with exponential backoff** - All external API calls must retry on transient failures (429, 500, 503, network errors).
4. **Remove deprecated functions** - Clean up legacy order functions or move to a separate legacy namespace with deprecation timeline.
5. **Standardize API base URLs** - Resolve v1beta1 vs v1beta3 inconsistency. Use latest Alpaca API versions consistently.

### P1 - High Priority

6. **Add proper test framework** - Migrate from manual test.ts to Vitest with proper unit tests for every exported function.
7. **Rate limiting client-side** - Implement per-API rate limiting to stay within Alpaca/Polygon quotas.
8. **Structured error types** - Create error class hierarchy (AlpacaApiError, PolygonApiError, etc.) instead of generic Error throws.
9. **Configurable caching** - Allow consumers to configure LRU cache sizes and TTLs.
10. **Replace console.error** - Use a configurable logger (or callback) instead of console.error. Engine uses Pino - make it compatible.
11. **Auth validation** - Validate API keys/secrets format before making requests.

### P2 - Medium Priority

12. **Financial calculation accuracy** - Add property-based tests for performance metrics (beta, drawdown, returns) against known datasets.
13. **Connection pooling** - Reuse HTTP connections for Alpaca API calls instead of creating new fetch per request.
14. **API response validation** - Validate API responses against expected schemas (use zod or similar).
15. **Pagination helper** - Generic pagination utility for all APIs that support it (Alpaca orders, news, bars).
16. **Market calendar integration** - MarketTimeTracker should use actual exchange calendar data, not just time-of-day checks.

### P3 - Enhancement

17. **Bundle size optimization** - Analyze and optimize the Rollup bundle. Consider tree-shaking of unused Alpaca SDK functions.
18. **TypeDoc generation** - Auto-generate API documentation from JSDoc comments.
19. **Changelog automation** - Automated changelog from commit messages for NPM releases.

## Cross-Package Alignment

- Types MUST come from @adaptic/backend-legacy (Prisma-generated). Do not redefine Trade, Position, Order, etc.
- src/types/ should contain ONLY types specific to external APIs (Alpaca, Polygon, Alpha Vantage response types)
- Shared Apollo Client setup must be consistent with backend-legacy's client.ts patterns
- Logger interface should be compatible with engine's Pino-based logging
