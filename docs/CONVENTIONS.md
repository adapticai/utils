# Utils Conventions

## Module Organization
- Group related functions in logical modules (e.g., `alpaca/`, `cache/`, `schemas/`, `types/`, `utils/`, `errors/`)
- Export all public APIs from `src/index.ts` via the `adaptic` namespace object or as named exports
- Keep internal helpers private (do not export from index.ts)
- Use barrel exports (`index.ts`) within subdirectories for clean import paths

## Naming
- Functions: camelCase (e.g., `getAlpacaPositions`, `calculateBeta`, `fetchTradeMetrics`)
- Types/interfaces: PascalCase (e.g., `AlpacaPosition`, `PerformanceMetrics`, `CacheEntry`)
- Constants: UPPER_SNAKE_CASE (e.g., `MARKET_TIMES`, `DEFAULT_TIMEOUTS`, `DEFAULT_CACHE_OPTIONS`)
- File names: kebab-case (e.g., `market-time.ts`, `format-tools.ts`, `alpaca-trading-api.ts`)
- Test files: co-located in `src/__tests__/` matching source name (e.g., `format-tools.test.ts`)

## Type Ownership
- This package owns broker/API types: `AlpacaPosition`, `AlpacaOrder`, `AlpacaCredentials`, `TradeUpdate`, etc. (defined in `src/types/alpaca-types.ts`)
- Import canonical data model types from `@adaptic/backend-legacy` (e.g., `types` from `@adaptic/backend-legacy`)
- Never redefine types that exist in backend-legacy
- Type resolution priority: `@adaptic/backend-legacy` -> `@adaptic/utils` -> local `src/types/`

## API Wrappers
- All broker API calls must include error handling with structured error classes from `src/errors/`
- Include retry logic for transient failures (use `withRetry` from `src/utils/retry.ts`)
- Cache responses where appropriate using `StampedeProtectedCache` (LRU-based with stampede prevention)
- Handle rate limiting gracefully via `TokenBucketRateLimiter` from `src/rate-limiter.ts`
- Use `createTimeoutSignal` / `DEFAULT_TIMEOUTS` from `src/http-timeout.ts` for all HTTP requests
- Validate API responses using Zod schemas from `src/schemas/`
- Use `validateAlpacaCredentials` before making Alpaca API calls

## Financial Calculations
- Use precise arithmetic (avoid floating point errors where critical)
- Document mathematical formulas in JSDoc comments
- Include edge case handling (division by zero, empty arrays, NaN checks, zero/negative equity)
- Validate inputs before calculation
- Return `"N/A"` or safe defaults for insufficient data rather than throwing

## Market Time
- Always handle timezone conversions explicitly using `date-fns-tz` (`toZonedTime`, `fromZonedTime`, `formatInTimeZone`)
- Account for market holidays (defined in `src/market-hours.ts` as `marketHolidays`)
- Handle early close days before holidays (`marketEarlyCloses`)
- Handle DST transitions correctly via the `America/New_York` timezone constant
- Use `MarketTimeUtil` class or exported helper functions for all market time operations
- Reference `MARKET_TIMES` config for NYSE hours (pre-market 4:00am, regular 9:30am-4:00pm, extended to 8:00pm)

## Error Handling
- Use structured error hierarchy rooted in `AdapticUtilsError`
- Service-specific errors: `AlpacaApiError`, `PolygonApiError`, `AlphaVantageError`
- HTTP errors: `HttpClientError`, `HttpServerError`
- Infrastructure: `TimeoutError`, `RateLimitError`, `NetworkError`, `WebSocketError`
- Domain: `ValidationError`, `AuthenticationError`, `DataFormatError`
- Mark errors as `isRetryable` where appropriate (429, 5xx)

## Logging
- Use the pluggable logger via `getLogger()` from `src/logger.ts`
- Never use `console.log` in production code
- Consumers set the logger via `setLogger()`

## Build Output
- ESM (`dist/index.mjs`) and CJS (`dist/index.cjs`) dual output via Rollup
- Type declarations in `dist/types/index.d.ts`
- Sourcemaps enabled for both formats
- External dependencies not bundled: `react`, `@adaptic/backend-legacy`, `date-fns`, `date-fns-tz`, `ms`, `node-fetch`
- No side effects in module initialization
- Legacy test build: `dist/test.js` (ESM) from `src/test.ts`

## Code Style
- 2-space indentation, K&R style braces
- Strict TypeScript mode with explicit parameter and return types
- Destructured objects for complex parameter lists
- JSDoc comments for all public functions and interfaces
- Group imports: external deps first, then internal modules
- Use named imports where possible
