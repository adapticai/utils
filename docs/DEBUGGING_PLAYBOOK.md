# Utils Debugging Playbook

## Build Fails (Rollup)

1. Check `rollup.config.mjs` for module resolution issues
2. Verify all imports resolve correctly (check `external` array for dependencies that should not be bundled)
3. Check for circular dependencies between modules
4. Verify TypeScript compiles cleanly (`npx tsc --noEmit`) before suspecting Rollup
5. Check for ESM/CJS compatibility issues (e.g., default vs named exports)
6. Inspect the `@rollup/plugin-typescript` config and `tsconfig.json` alignment
7. If `commonjs` plugin fails, check `ignoreDynamicRequires` and `ignore` lists in rollup config

**Common causes:** unresolved import path, circular dependency, TypeScript type error, missing file in `src/`, dependency not listed in `external` array

**Quick fix sequence:**
```bash
cd ~/adapticai/utils
npm run clean
npx tsc --noEmit          # Isolate TS errors from Rollup errors
npm run build             # Full rebuild
```

## Test Fails (Vitest)

1. Run the failing test in isolation: `cd ~/adapticai/utils && npx vitest run src/__tests__/<file>.test.ts`
2. Check if the test relies on mocked data that no longer matches API response shapes
3. For financial calculation tests, check for floating point precision (use `toBeCloseTo` not `toBe`)
4. For market time tests, verify timezone and holiday data in `src/market-hours.ts`
5. Check `vitest.config.ts` for test configuration (timeout: 10s, environment: node)

**Common causes:** API response format changed, calculation precision issue, timezone/holiday data outdated, test timeout (increase beyond default 10s if needed)

**Quick fix sequence:**
```bash
cd ~/adapticai/utils
npx vitest run                           # Run all tests
npx vitest run src/__tests__/specific.test.ts  # Run single file
npx vitest run --reporter=verbose        # Verbose output
```

## Legacy Test Fails (src/test.ts)

1. Check `src/test.ts` for the failing function call
2. This file is built separately by Rollup into `dist/test.js` (ESM)
3. Run with: `npm run test:legacy` (builds then runs `node dist/test.js`)
4. Verify API credentials are set in environment if test calls live APIs
5. Check that imported functions from `src/index.ts` are still exported

**Common causes:** API credentials missing, live API response format changed, export removed from index

## Type Errors in Consumers (Engine)

1. Verify `npm run build` completed successfully in utils
2. Check that `@adaptic/backend-legacy` types are up to date (`npm install @adaptic/backend-legacy@latest`)
3. Verify type exports in `package.json` (`"types": "dist/types/index.d.ts"`)
4. Check the `exports` field in `package.json` for correct `types` entry
5. Verify the type is exported from `src/index.ts`
6. Check for version mismatches between utils and engine's `package.json`

**Quick fix sequence:**
```bash
cd ~/adapticai/utils
npm run build
ls dist/types/index.d.ts    # Verify types generated
# In engine:
cd ~/adapticai/engine
yarn install                 # Pick up latest utils
yarn typecheck               # Verify types resolve
```

## API Wrapper Issues

1. Check API credentials/keys (use `validateAlpacaCredentials`, `validatePolygonApiKey`, `validateAlphaVantageApiKey`)
2. Verify API endpoint URLs in `src/config/api-endpoints.ts` (paper vs live, v1 vs v2)
3. Check rate limiting status via `TokenBucketRateLimiter` - are requests being throttled?
4. Inspect API response format for changes (validate against Zod schemas in `src/schemas/`)
5. Test with actual API call (not just mocks) using `src/test.ts`
6. Check HTTP timeout settings in `src/http-timeout.ts` (`DEFAULT_TIMEOUTS`)
7. Check connection pool status with `getAgentPoolStatus()` from `src/utils/http-keep-alive.ts`

**Common causes:** expired/invalid API key, API endpoint URL changed, rate limit exceeded, response schema drift, network timeout

## Financial Calculation Accuracy

1. Compare against known reference values (use regression tests in `src/__tests__/financial-regression.test.ts`)
2. Check for floating point precision issues (especially in percentage calculations)
3. Verify edge case handling: empty arrays, single data points, zero denominators
4. Check input data validity (NaN, null, undefined, negative values)
5. Run property-based tests: `npx vitest run src/__tests__/property-based-financial.test.ts`
6. Review mathematical formulas in JSDoc comments against authoritative sources

**Common causes:** floating point accumulation error, division by zero not guarded, empty array not checked, incorrect formula implementation

## Cache Issues (StampedeProtectedCache)

1. Verify cache key construction (are keys unique and deterministic?)
2. Check TTL settings in `StampedeProtectedCacheOptions`
3. Verify cache invalidation triggers
4. Check cache size limits (LRU eviction may be dropping entries)
5. Inspect stampede protection: is `isRefreshing` flag stuck?
6. Use `CacheStats` to diagnose hit/miss ratios
7. Run cache tests: `npx vitest run src/__tests__/cache.test.ts`

**Common causes:** TTL too short for use case, cache key collision, stampede protection deadlock, LRU size too small

## Rate Limiter Issues

1. Check `TokenBucketRateLimiter` configuration (tokens per interval, burst capacity)
2. Verify the correct limiter is being used for the API (Alpaca vs Polygon have different limits)
3. Check `rateLimiters` exported instances for current state
4. Inspect if `RateLimitError` is being thrown with correct `isRetryable: true`
5. Run rate limiter tests: `npx vitest run src/__tests__/rate-limiter.test.ts`

**Common causes:** bucket size too small, refill interval too long, limiter shared across unrelated requests

## Import/Export Issues

1. Check `src/index.ts` for the export (named export vs `adaptic` namespace)
2. Verify the function is not only in the `adaptic` object but also as a standalone named export if needed
3. Check `package.json` `exports` field for correct ESM/CJS/types paths
4. For tree-shaking issues, check if function is in the `adaptic` namespace object (not tree-shakeable) vs a named export (tree-shakeable)

**Common causes:** function only exported in namespace object, missing re-export from barrel file, CJS/ESM mismatch
