# Vitest Test Framework Setup

This package has been configured to use Vitest as its test framework, replacing the manual `test.ts` approach.

## Installation Required

Before running tests, install the required devDependencies:

```bash
npm install -D vitest @vitest/coverage-v8
```

## Test Scripts

- `npm test` - Run all tests once
- `npm run test:watch` - Run tests in watch mode (re-runs on file changes)
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:legacy` - Run the old manual test.js (kept for backwards compatibility)

## Test Files

Tests are located in `src/__tests__/`:

- `market-time.test.ts` - Tests for market hours detection, holiday handling, and time calculations
- `cache.test.ts` - Tests for stampede-protected cache operations (hits, misses, coalescing, TTL)
- `technical-analysis.test.ts` - Tests for EMA, RSI, MACD, Bollinger Bands, and Stochastic calculations

## Configuration

The Vitest configuration is in `vitest.config.ts`:

- Test environment: Node.js
- Test file patterns: `src/**/*.test.ts`, `src/**/*.spec.ts`
- Coverage provider: v8
- Test timeout: 10 seconds

## Writing New Tests

1. Create test files with `.test.ts` or `.spec.ts` extension in `src/__tests__/`
2. Import test utilities from `vitest`:
   ```typescript
   import { describe, it, expect, beforeEach, vi } from 'vitest';
   ```
3. Follow existing test patterns for consistency
4. Use meaningful test data (not just import verification)
5. No `any` types in test code

## Type Safety

All tests follow strict TypeScript typing:
- Explicit types for test data
- No use of `any` type
- Proper typing of mock functions with `vi.fn()`

## Test Coverage

Coverage reports are generated in the `coverage/` directory when running `npm run test:coverage`.

Target coverage metrics:
- Statements: >80%
- Branches: >75%
- Functions: >80%
- Lines: >80%
