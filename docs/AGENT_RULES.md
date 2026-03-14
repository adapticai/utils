# Utils Agent Rules

## Before Making Changes
- Read the existing module to understand the full API surface
- Check `src/index.ts` to see how functions are exported (via `adaptic` namespace or named exports)
- Check if a function already exists before creating a new one
- Verify type imports come from the correct source (`@adaptic/backend-legacy` for data models, `src/types/` for broker types)
- Check impact on engine (primary consumer of this package)
- Read `CLAUDE.md` at the repo root and `utils/CLAUDE.md` for project-wide and package-specific standards

## API Wrapper Changes
- Match actual broker API response shapes exactly (Alpaca, Polygon, AlphaVantage)
- Include proper error handling using structured error classes from `src/errors/`
- Use `withRetry` from `src/utils/retry.ts` for transient failure recovery
- Use `createTimeoutSignal` from `src/http-timeout.ts` for all HTTP requests
- Validate responses with Zod schemas from `src/schemas/` where applicable
- Test with realistic API response data
- Maintain backward compatibility (engine depends on current signatures)
- Use `TokenBucketRateLimiter` for APIs with rate limits

## Type Changes
- If a type is consumed by engine, ensure backward compatibility
- If a type maps to a Prisma model, import from `@adaptic/backend-legacy` instead of redefining
- New broker/API types belong in `src/types/alpaca-types.ts` or appropriate type file
- Document any new types with JSDoc
- Export new types from `src/types/index.ts` and `src/index.ts`

## Financial Calculation Changes
- Verify mathematical correctness against known reference values
- Test edge cases: empty data, single data point, division by zero, NaN, negative values
- Compare output against established financial libraries or formulas
- Document formulas and assumptions in JSDoc
- Handle insufficient data gracefully (return `"N/A"` or safe defaults, do not throw)

## Market Time Changes
- Test across DST boundaries (March/November transitions)
- Verify against NYSE holiday calendar in `src/market-hours.ts`
- Handle early close days correctly
- Always use `America/New_York` timezone via `MARKET_TIMES.TIMEZONE`
- Use `date-fns-tz` functions, never manual UTC offset arithmetic

## Error Handling Changes
- Extend `AdapticUtilsError` hierarchy for new error types
- Set `isRetryable` correctly (true for 429, 5xx; false for 4xx client errors)
- Include `service`, `code`, and `cause` fields for traceability
- Never swallow errors silently

## Adding New Modules
- Create the source file in `src/` (kebab-case filename)
- Add types in `src/types/` if needed
- Add Zod schemas in `src/schemas/` if the module handles external API data
- Export from `src/index.ts` (either as named export or under the `adaptic` namespace)
- Add tests in `src/__tests__/` (co-located test file)
- Verify both ESM and CJS outputs work after build

## Build Verification
- `npm run build` must produce both `dist/index.mjs` and `dist/index.cjs`
- `npm run test` must pass all 461+ tests
- Verify exports are accessible from both ESM and CJS consumers
- Check that `dist/types/index.d.ts` includes new type exports

## Prohibited Patterns
- No `any` types (use `unknown` with type narrowing)
- No `eslint-disable` comments
- No `@ts-ignore` (use `@ts-expect-error` only in tests with explanation)
- No `console.log` in production code (use `getLogger()`)
- No direct `process.env` access in library code
- No mock/stub implementations in production code
- No TODO/FIXME comments in production code
- No commented-out code
- No magic numbers (use named constants)
- No hardcoded secrets
