# Utils PR Checklist

## Build
- [ ] `npm run build` passes (Rollup ESM+CJS)
- [ ] Both `dist/index.mjs` and `dist/index.cjs` generated
- [ ] `dist/types/index.d.ts` includes new type exports
- [ ] No Rollup warnings or unresolved import errors

## Tests
- [ ] `npm run test` passes (all 461+ Vitest tests)
- [ ] New code has corresponding tests in `src/__tests__/`
- [ ] Edge cases tested (empty data, division by zero, NaN, negative values)
- [ ] Financial calculations verified against known reference values
- [ ] `npm run test:coverage` shows adequate coverage for changed files

## Types
- [ ] No `any` types
- [ ] Type imports from `@adaptic/backend-legacy` for Prisma model types (not redefined locally)
- [ ] Broker/API types defined in `src/types/` and exported from `src/types/index.ts`
- [ ] New types exported from `src/index.ts` (named export or via `adaptic` namespace)
- [ ] Backward compatible with engine consumers (no breaking type changes)

## API Wrappers
- [ ] Matches actual broker API response shape
- [ ] Error handling uses structured errors from `src/errors/`
- [ ] HTTP timeouts via `createTimeoutSignal` / `DEFAULT_TIMEOUTS`
- [ ] Rate limiting handled via `TokenBucketRateLimiter`
- [ ] Retry logic via `withRetry` for transient failures
- [ ] Response validated against Zod schema from `src/schemas/` (if applicable)
- [ ] Credentials validated before API calls

## Financial Calculations
- [ ] Mathematical formula documented in JSDoc
- [ ] Edge cases handled (empty arrays, single point, zero denominator)
- [ ] Floating point precision appropriate for the use case
- [ ] Regression test added with known-good reference values
- [ ] Property-based test added for invariants (if applicable)

## Market Time
- [ ] Uses `date-fns-tz` for timezone operations (no manual UTC offset math)
- [ ] Handles NYSE holidays from `src/market-hours.ts`
- [ ] Handles early close days before holidays
- [ ] DST transitions tested (March/November boundaries)
- [ ] Uses `MARKET_TIMES.TIMEZONE` constant for `America/New_York`

## Code Quality
- [ ] No `eslint-disable` comments
- [ ] No `@ts-ignore` (use `@ts-expect-error` in tests only)
- [ ] No `console.log` (use `getLogger()` from `src/logger.ts`)
- [ ] No commented-out code
- [ ] No TODO/FIXME comments
- [ ] No magic numbers (use named constants)
- [ ] No hardcoded secrets or API keys
- [ ] JSDoc on all public functions, types, and constants
- [ ] 2-space indentation, K&R braces, camelCase/PascalCase/UPPER_SNAKE_CASE conventions followed

## Exports
- [ ] New public functions exported from `src/index.ts`
- [ ] Added to `adaptic` namespace object if consumed via `adaptic.module.function()` pattern
- [ ] Named exports added for tree-shakeable access if appropriate
- [ ] Backward-compatible aliases maintained for deprecated functions

## Consumer Impact
- [ ] Engine (`@adaptic/utils` consumer) not broken by changes
- [ ] No breaking changes to exported function signatures
- [ ] If breaking change is unavoidable: documented, versioned, and engine updated in same PR
