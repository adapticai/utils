# Utils Testing Strategy

## Framework
- **Vitest** (v4.0.18) - 461+ tests across 22 test files
- **fast-check** - Property-based testing for financial calculations
- **@vitest/coverage-v8** - Code coverage via V8

## Test Location
Tests are co-located in `src/__tests__/` with filenames matching the source module:
- `src/format-tools.ts` -> `src/__tests__/format-tools.test.ts`
- `src/market-time.ts` -> `src/__tests__/market-time.test.ts`
- `src/performance-metrics.ts` -> `src/__tests__/performance-metrics.test.ts`

## Configuration
Defined in `vitest.config.ts`:
- **Environment:** node
- **Globals:** enabled (no need to import `describe`, `it`, `expect`)
- **Test timeout:** 10,000ms
- **Include:** `src/**/*.test.ts`, `src/**/*.spec.ts`
- **Exclude:** `node_modules`, `dist`
- **Coverage excludes:** test files, `src/test.ts` (legacy), `src/types/`

## Commands
```bash
npm run test             # Run all tests (vitest run)
npm run test:watch       # Watch mode (vitest)
npm run test:coverage    # Run with V8 coverage report
npm run test:legacy      # Build + run legacy test (node dist/test.js)
```

### Running a Single Test File
```bash
cd ~/adapticai/utils
npx vitest run src/__tests__/format-tools.test.ts
npx vitest run src/__tests__/market-time.test.ts --reporter=verbose
```

### Running Tests Matching a Pattern
```bash
npx vitest run -t "calculateBeta"       # Run tests matching name pattern
npx vitest run src/__tests__/alpha       # Run files matching path pattern
```

## Legacy Testing (src/test.ts)
This package also has a legacy manual test file (`src/test.ts`) built by Rollup into `dist/test.js`:
1. Add or modify function calls in `src/test.ts`
2. Run `npm run test:legacy` (builds then executes `node dist/test.js`)
3. Useful for testing live API calls that cannot be unit tested

## Test Categories

### Unit Tests (majority)
- Pure function testing with known inputs/outputs
- Format utilities, time utilities, price calculations
- Example: `format-tools.test.ts`, `time-utils.test.ts`, `price-utils.test.ts`

### Financial Regression Tests
- `financial-regression.test.ts` - Known-good reference values for financial calculations
- Guards against formula regressions in metrics like beta, drawdown, returns

### Property-Based Tests
- `property-based-financial.test.ts` - Uses `fast-check` for randomized input testing
- Validates invariants: beta within expected range, returns sum correctly, etc.

### API Schema Validation Tests
- `schema-validation.test.ts` - Validates Zod schemas against sample API responses
- Ensures schema definitions match actual Alpaca/Polygon/AlphaVantage response shapes

### Infrastructure Tests
- `cache.test.ts` - StampedeProtectedCache behavior (hits, misses, eviction, stampede prevention)
- `rate-limiter.test.ts` - TokenBucketRateLimiter token management and throttling
- `http-timeout.test.ts` - Timeout signal creation and defaults
- `http-keep-alive.test.ts` - Connection pooling and keep-alive agent status
- `logger.test.ts` - Pluggable logger set/get/reset
- `errors.test.ts` - Error hierarchy, isRetryable flags, error codes

### Market Time Tests
- `market-time.test.ts` - NYSE hours, holidays, early closes, DST transitions
- `time-utils.test.ts` - Date formatting, timezone conversion, time range calculations

### API Function Tests
- `alpaca-functions.test.ts` - Alpaca trading and market data API wrappers
- `polygon.test.ts` - Polygon.io market data API wrappers

## What to Test for New Code

### API Wrappers
- Response parsing with realistic data
- Error handling (4xx, 5xx, timeout, network errors)
- Rate limiting behavior
- Zod schema validation of response shapes
- Authentication validation

### Financial Calculations
- Known reference values (regression anchors)
- Edge cases: empty arrays, single data point, all zeros, NaN, negative values
- Floating point precision (use `toBeCloseTo` for percentage comparisons)
- Property-based invariants with fast-check

### Market Time Functions
- Regular hours, pre-market, post-market
- Holiday detection and early close handling
- DST boundary transitions (March spring-forward, November fall-back)
- Timezone conversion accuracy

### Cache and Infrastructure
- Cache hit/miss/eviction behavior
- TTL expiration
- Stampede protection (concurrent requests for same key)
- Rate limiter token replenishment and exhaustion

## Test Quality Standards
- Use realistic broker API response data (not trivial stubs)
- Include both happy path and error cases
- Test edge cases specific to financial data
- Use `@ts-expect-error` (not `@ts-ignore`) when testing invalid inputs
- Prefer `toBeCloseTo` over `toBe` for floating point comparisons
- Document test intent with clear `describe` and `it` descriptions
