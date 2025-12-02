# @adaptic/utils - Test Coverage Analysis

**Generated:** 2025-12-02
**Current Coverage:** 0% (No formal tests)
**Target Coverage:** 90%
**Recommended Framework:** Vitest
**Total LOC to Test:** ~15,429 lines

---

## Executive Summary

The `@adaptic/utils` package currently has **no formal test coverage**. Only a manual test script exists (`test.ts`), which is insufficient for production use. This document provides a comprehensive testing strategy to achieve 90% code coverage using Vitest.

**Critical Gaps:**
- No unit tests for core broker APIs (4,616 LOC untested)
- No tests for financial calculations (analytics, metrics)
- No tests for market time utilities (critical for trading accuracy)
- No tests for cache infrastructure (high-risk for stampede bugs)
- No integration tests for API clients
- No CI/CD pipeline for automated testing

---

## Current Test Inventory

### Existing Test Files

**1. `test.ts` (302 LOC)**
- Manual test script, not automated
- Tests various utilities ad-hoc
- Requires manual execution: `npm run test`
- No assertions, just console output
- Not suitable for CI/CD

**2. `examples/asset-allocation-example.ts`**
- Example code, not tests
- Shows usage of asset allocation engine
- No assertions

**3. `testing/options-ws.ts`**
- WebSocket testing for options data
- Manual test, not automated

**Coverage:** 0% formal coverage

---

## Testing Strategy

### Framework Selection: Vitest

**Why Vitest:**
- Native ESM support (matches package `"type": "module"`)
- Fast execution with worker threads
- Compatible with TypeScript
- Excellent mocking capabilities
- Built-in coverage with c8/istanbul
- Familiar Jest-like API
- Watch mode for development

**Installation:**
```bash
npm install -D vitest @vitest/coverage-v8
```

**Configuration:**
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/test.ts',
        '**/examples/**',
        '**/testing/**',
      ],
      all: true,
      lines: 90,
      functions: 90,
      branches: 90,
      statements: 90,
    },
    setupFiles: ['./test/setup.ts'],
  },
});
```

---

## Test Organization

### Directory Structure

```
test/
├── setup.ts                          # Global test setup
├── mocks/
│   ├── alpaca-api-mock.ts            # Mock Alpaca API responses
│   ├── polygon-api-mock.ts           # Mock Polygon API responses
│   ├── alphavantage-api-mock.ts      # Mock AlphaVantage responses
│   └── backend-mock.ts               # Mock backend GraphQL
├── fixtures/
│   ├── market-data.ts                # Sample market data
│   ├── positions.ts                  # Sample positions
│   ├── orders.ts                     # Sample orders
│   ├── portfolio-history.ts          # Sample portfolio history
│   └── price-data.ts                 # Sample price bars
├── unit/
│   ├── brokers/
│   │   ├── alpaca-trading-api.test.ts
│   │   ├── alpaca-market-data-api.test.ts
│   │   └── alpaca-functions.test.ts
│   ├── data-providers/
│   │   ├── polygon.test.ts
│   │   ├── polygon-indices.test.ts
│   │   └── alphavantage.test.ts
│   ├── analytics/
│   │   ├── performance-metrics.test.ts
│   │   ├── technical-analysis.test.ts
│   │   └── asset-allocation.test.ts
│   ├── time/
│   │   ├── market-time.test.ts
│   │   ├── market-hours.test.ts
│   │   └── time-utils.test.ts
│   ├── cache/
│   │   └── stampede-protected-cache.test.ts
│   ├── formatting/
│   │   └── format-tools.test.ts
│   └── utils/
│       ├── misc-utils.test.ts
│       └── price-utils.test.ts
├── integration/
│   ├── alpaca-integration.test.ts    # Live API tests (optional)
│   ├── polygon-integration.test.ts
│   └── cache-integration.test.ts
└── e2e/
    └── trading-workflow.test.ts      # End-to-end trading scenarios
```

---

## Priority Testing Matrix

### Priority 1: Critical Path (90%+ coverage required)

#### 1.1 Broker APIs (4,616 LOC)
**Files:**
- `alpaca-trading-api.ts` (1,683 LOC)
- `alpaca-functions.ts` (1,659 LOC)
- `alpaca-market-data-api.ts` (1,274 LOC)

**Test Requirements:**
- Mock all HTTP requests (no live API calls in unit tests)
- Test error handling (401, 403, 429, 500, network errors)
- Test retry logic
- Test rate limiting
- Test credential validation
- Test response parsing

**Example Test:**
```typescript
// test/unit/brokers/alpaca-trading-api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlpacaTradingAPI } from '../../../src/alpaca-trading-api';
import { mockFetch } from '../../mocks/alpaca-api-mock';

describe('AlpacaTradingAPI', () => {
  let api: AlpacaTradingAPI;

  beforeEach(() => {
    global.fetch = vi.fn();
    api = new AlpacaTradingAPI({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      paper: true,
    });
  });

  describe('getAccount', () => {
    it('should fetch account details successfully', async () => {
      mockFetch.mockAccountDetails();

      const account = await api.getAccount();

      expect(account).toBeDefined();
      expect(account.id).toBe('test-account-id');
      expect(account.equity).toBeGreaterThan(0);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/account'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'APCA-API-KEY-ID': 'test-key',
          }),
        })
      );
    });

    it('should handle 401 authentication error', async () => {
      mockFetch.mockUnauthorized();

      await expect(api.getAccount()).rejects.toThrow('AUTH_ERROR: 401');
    });

    it('should retry on 500 server error', async () => {
      mockFetch.mockServerError().mockAccountDetails();

      const account = await api.getAccount();

      expect(account).toBeDefined();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle rate limiting with backoff', async () => {
      mockFetch.mockRateLimit(5000).mockAccountDetails();

      const start = Date.now();
      await api.getAccount();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('getPositions', () => {
    it('should fetch all positions', async () => {
      mockFetch.mockPositions([
        { symbol: 'AAPL', qty: '10', current_price: '150.00' },
        { symbol: 'GOOGL', qty: '5', current_price: '2800.00' },
      ]);

      const positions = await api.getPositions();

      expect(positions).toHaveLength(2);
      expect(positions[0].symbol).toBe('AAPL');
      expect(positions[1].symbol).toBe('GOOGL');
    });

    it('should return empty array when no positions', async () => {
      mockFetch.mockPositions([]);

      const positions = await api.getPositions();

      expect(positions).toEqual([]);
    });
  });

  describe('createOrder', () => {
    it('should create market order successfully', async () => {
      mockFetch.mockCreateOrder({
        id: 'order-123',
        symbol: 'AAPL',
        qty: '10',
        side: 'buy',
        type: 'market',
        status: 'filled',
      });

      const order = await api.createOrder({
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        timeInForce: 'day',
      });

      expect(order.id).toBe('order-123');
      expect(order.status).toBe('filled');
    });

    it('should validate order parameters', async () => {
      await expect(api.createOrder({
        symbol: '',
        qty: 0,
        side: 'buy',
        type: 'market',
        timeInForce: 'day',
      })).rejects.toThrow('Invalid order parameters');
    });
  });
});
```

**Coverage Target:** 95%

---

#### 1.2 Cache Infrastructure (839 LOC)
**Files:**
- `cache/stampede-protected-cache.ts`

**Test Requirements:**
- Test LRU eviction
- Test TTL expiration
- Test jitter application
- Test stale-while-revalidate
- Test request coalescing
- Test background refresh
- Test error handling during refresh
- Test statistics tracking

**Example Test:**
```typescript
// test/unit/cache/stampede-protected-cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StampedeProtectedCache } from '../../../src/cache/stampede-protected-cache';

describe('StampedeProtectedCache', () => {
  let cache: StampedeProtectedCache<string>;
  let loader: vi.Mock;

  beforeEach(() => {
    loader = vi.fn();
    cache = new StampedeProtectedCache({
      maxSize: 100,
      defaultTtl: 1000,
      staleWhileRevalidateTtl: 2000,
      minJitter: 0.9,
      maxJitter: 1.1,
      enableBackgroundRefresh: true,
    });
  });

  describe('get', () => {
    it('should load value on cache miss', async () => {
      loader.mockResolvedValue('value1');

      const result = await cache.get('key1', loader);

      expect(result).toBe('value1');
      expect(loader).toHaveBeenCalledTimes(1);
      expect(cache.getStats().misses).toBe(1);
      expect(cache.getStats().hits).toBe(0);
    });

    it('should return cached value on cache hit', async () => {
      loader.mockResolvedValue('value1');

      await cache.get('key1', loader);
      const result = await cache.get('key1', loader);

      expect(result).toBe('value1');
      expect(loader).toHaveBeenCalledTimes(1);
      expect(cache.getStats().hits).toBe(1);
    });

    it('should coalesce concurrent requests', async () => {
      loader.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve('value1'), 100))
      );

      const [result1, result2, result3] = await Promise.all([
        cache.get('key1', loader),
        cache.get('key1', loader),
        cache.get('key1', loader),
      ]);

      expect(result1).toBe('value1');
      expect(result2).toBe('value1');
      expect(result3).toBe('value1');
      expect(loader).toHaveBeenCalledTimes(1);
      expect(cache.getStats().coalescedRequests).toBe(2);
    });

    it('should serve stale while revalidating', async () => {
      vi.useFakeTimers();
      loader.mockResolvedValue('value1');

      // Load initial value
      await cache.get('key1', loader);

      // Advance time past TTL but within stale-while-revalidate
      vi.advanceTimersByTime(1500);

      loader.mockResolvedValue('value2');

      // Should return stale value immediately
      const result = await cache.get('key1', loader);
      expect(result).toBe('value1');
      expect(cache.getStats().staleHits).toBe(1);

      // Wait for background refresh
      await vi.runAllTimersAsync();

      // Next call should return refreshed value
      const result2 = await cache.get('key1', loader);
      expect(result2).toBe('value2');

      vi.useRealTimers();
    });

    it('should handle loader errors gracefully', async () => {
      loader.mockRejectedValue(new Error('API error'));

      await expect(cache.get('key1', loader)).rejects.toThrow('API error');
      expect(cache.getStats().refreshErrors).toBe(1);
    });
  });

  describe('eviction', () => {
    it('should evict LRU entries when max size reached', async () => {
      cache = new StampedeProtectedCache({
        maxSize: 3,
        defaultTtl: 10000,
      });

      loader.mockImplementation((key) => Promise.resolve(`value-${key}`));

      await cache.get('key1', loader);
      await cache.get('key2', loader);
      await cache.get('key3', loader);

      expect(cache.size).toBe(3);

      await cache.get('key4', loader);

      expect(cache.size).toBe(3);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key4')).toBe(true);
    });
  });
});
```

**Coverage Target:** 95%

---

#### 1.3 Market Time Utilities (1,149 LOC)
**Files:**
- `market-time.ts` (818 LOC)
- `market-hours.ts` (131 LOC)
- `time-utils.ts` (200 LOC)

**Test Requirements:**
- Test all market hours (pre, regular, extended)
- Test early close days
- Test holidays
- Test weekend detection
- Test timezone conversions (ET ↔ UTC)
- Test trading day calculations
- Test edge cases (DST transitions)

**Example Test:**
```typescript
// test/unit/time/market-time.test.ts
import { describe, it, expect } from 'vitest';
import { MarketTimeUtil, getMarketStatus, MARKET_TIMES } from '../../../src/market-time';

describe('MarketTimeUtil', () => {
  let util: MarketTimeUtil;

  beforeEach(() => {
    util = new MarketTimeUtil('America/New_York', 'market_hours');
  });

  describe('isMarketDay', () => {
    it('should return false for weekends', () => {
      const saturday = new Date('2025-12-06T10:00:00Z'); // Saturday
      const sunday = new Date('2025-12-07T10:00:00Z'); // Sunday

      expect(util.isMarketDay(saturday)).toBe(false);
      expect(util.isMarketDay(sunday)).toBe(false);
    });

    it('should return true for weekdays', () => {
      const monday = new Date('2025-12-01T10:00:00Z'); // Monday
      const friday = new Date('2025-12-05T10:00:00Z'); // Friday

      expect(util.isMarketDay(monday)).toBe(true);
      expect(util.isMarketDay(friday)).toBe(true);
    });

    it('should return false for Christmas', () => {
      const christmas = new Date('2025-12-25T10:00:00Z');

      expect(util.isMarketDay(christmas)).toBe(false);
    });

    it('should return false for Thanksgiving', () => {
      const thanksgiving = new Date('2025-11-27T10:00:00Z'); // 4th Thursday

      expect(util.isMarketDay(thanksgiving)).toBe(false);
    });
  });

  describe('isWithinMarketHours', () => {
    it('should return true during regular market hours', () => {
      const date = new Date('2025-12-01T15:00:00Z'); // 10:00 AM ET

      expect(util.isWithinMarketHours(date)).toBe(true);
    });

    it('should return false before market open', () => {
      const date = new Date('2025-12-01T13:00:00Z'); // 8:00 AM ET

      expect(util.isWithinMarketHours(date)).toBe(false);
    });

    it('should return false after market close', () => {
      const date = new Date('2025-12-01T22:00:00Z'); // 5:00 PM ET

      expect(util.isWithinMarketHours(date)).toBe(false);
    });
  });

  describe('getMarketStatus', () => {
    it('should return "open" during market hours', () => {
      const date = new Date('2025-12-01T15:00:00Z'); // 10:00 AM ET Monday

      const status = getMarketStatus(date);

      expect(status.isOpen).toBe(true);
      expect(status.status).toBe('open');
    });

    it('should return "closed" on weekends', () => {
      const saturday = new Date('2025-12-06T15:00:00Z');

      const status = getMarketStatus(saturday);

      expect(status.isOpen).toBe(false);
      expect(status.status).toBe('closed');
    });

    it('should return "pre" during pre-market hours', () => {
      const date = new Date('2025-12-01T12:00:00Z'); // 7:00 AM ET

      const status = getMarketStatus(date);

      expect(status.isOpen).toBe(false);
      expect(status.status).toBe('pre');
    });

    it('should return "after" during after-hours', () => {
      const date = new Date('2025-12-01T21:00:00Z'); // 4:00 PM ET

      const status = getMarketStatus(date);

      expect(status.isOpen).toBe(false);
      expect(status.status).toBe('after');
    });
  });

  describe('isEarlyCloseDay', () => {
    it('should return true for Black Friday', () => {
      const blackFriday = new Date('2025-11-28T10:00:00Z'); // Day after Thanksgiving

      expect(util.isEarlyCloseDay(blackFriday)).toBe(true);
    });

    it('should return true for Christmas Eve', () => {
      const christmasEve = new Date('2025-12-24T10:00:00Z');

      expect(util.isEarlyCloseDay(christmasEve)).toBe(true);
    });

    it('should return false for regular days', () => {
      const regularDay = new Date('2025-12-01T10:00:00Z');

      expect(util.isEarlyCloseDay(regularDay)).toBe(false);
    });
  });
});
```

**Coverage Target:** 90%

---

### Priority 2: Analytics & Calculations (85%+ coverage)

#### 2.1 Performance Metrics (1,627 LOC)
**Test Requirements:**
- Test Sharpe ratio calculation
- Test Sortino ratio
- Test alpha/beta vs benchmark
- Test max drawdown
- Test daily returns alignment
- Test edge cases (zero returns, negative returns)

#### 2.2 Technical Analysis (535 LOC)
**Test Requirements:**
- Test EMA calculation accuracy
- Test MACD calculation
- Test RSI bounds (0-100)
- Test Bollinger Bands calculation
- Test support/resistance levels
- Test insufficient data handling

#### 2.3 Asset Allocation (1,334 LOC)
**Test Requirements:**
- Test portfolio optimization
- Test risk profile constraints
- Test diversification logic
- Test rebalancing recommendations

**Coverage Target:** 85%

---

### Priority 3: Data Providers (80%+ coverage)

#### 3.1 Polygon API (882 LOC)
**Test Requirements:**
- Mock all API responses
- Test error handling
- Test rate limiting
- Test data parsing

#### 3.2 AlphaVantage API (148 LOC)
**Test Requirements:**
- Mock API responses
- Test date conversion utilities
- Test error handling

**Coverage Target:** 80%

---

### Priority 4: Utilities (75%+ coverage)

#### 4.1 Formatting (240 LOC)
**Test Requirements:**
- Test currency formatting ($1,234.56)
- Test percentage formatting (75.00%)
- Test enum formatting (STOCK_TICKER → Stock Ticker)
- Test edge cases (NaN, Infinity, negative)

#### 4.2 Misc Utils (281 LOC)
**Test Requirements:**
- Test fetchWithRetry logic
- Test retry backoff
- Test API key masking
- Test validation functions

**Coverage Target:** 75%

---

## Mock Data Fixtures

### Example Fixtures

```typescript
// test/fixtures/positions.ts
export const mockPositions = [
  {
    symbol: 'AAPL',
    qty: '10',
    side: 'long',
    market_value: '1500.00',
    cost_basis: '1400.00',
    unrealized_pl: '100.00',
    current_price: '150.00',
    avg_entry_price: '140.00',
  },
  {
    symbol: 'GOOGL',
    qty: '5',
    side: 'long',
    market_value: '14000.00',
    cost_basis: '13500.00',
    unrealized_pl: '500.00',
    current_price: '2800.00',
    avg_entry_price: '2700.00',
  },
];

// test/fixtures/market-data.ts
export const mockBars = [
  { t: 1701388800000, o: 150.0, h: 152.0, l: 149.0, c: 151.5, v: 1000000 },
  { t: 1701475200000, o: 151.5, h: 153.0, l: 151.0, c: 152.8, v: 1200000 },
  { t: 1701561600000, o: 152.8, h: 154.0, l: 152.5, c: 153.5, v: 1100000 },
];

// test/fixtures/portfolio-history.ts
export const mockPortfolioHistory = {
  timestamp: [1701388800, 1701475200, 1701561600],
  equity: [10000, 10150, 10300],
  base_value: 10000,
  base_value_asof: '2025-12-01T00:00:00Z',
  timeframe: '1D',
};
```

---

## Mock API Setup

```typescript
// test/mocks/alpaca-api-mock.ts
import { vi } from 'vitest';

export const mockFetch = {
  mockAccountDetails: () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'test-account-id',
        account_number: '123456789',
        status: 'ACTIVE',
        currency: 'USD',
        cash: '10000.00',
        equity: '15000.00',
        buying_power: '20000.00',
      }),
    });
  },

  mockPositions: (positions: any[]) => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => positions,
    });
  },

  mockUnauthorized: () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });
  },

  mockServerError: () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    return mockFetch;
  },

  mockRateLimit: (retryAfter: number) => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({
        'Retry-After': String(retryAfter / 1000),
      }),
    });
    return mockFetch;
  },
};
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [18.x, 20.x, 22.x]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm run test:ci

      - name: Generate coverage report
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: unittests
          name: codecov-umbrella

      - name: Check coverage thresholds
        run: |
          if [ $(grep -oP 'Lines\s+:\s+\K[0-9.]+' coverage/coverage-summary.json | bc -l | awk '{print ($1 < 90)}') -eq 1 ]; then
            echo "Coverage below 90%"
            exit 1
          fi
```

### Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:ci": "vitest run --reporter=verbose",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  }
}
```

---

## Coverage Requirements by Module

| Module | LOC | Priority | Target Coverage | Est. Test LOC |
|--------|-----|----------|----------------|---------------|
| Broker APIs | 4,616 | P1 | 95% | ~2,300 |
| Cache | 839 | P1 | 95% | ~420 |
| Market Time | 1,149 | P1 | 90% | ~575 |
| Performance Metrics | 1,627 | P2 | 85% | ~690 |
| Technical Analysis | 535 | P2 | 85% | ~230 |
| Asset Allocation | 1,334 | P2 | 85% | ~565 |
| Polygon API | 882 | P3 | 80% | ~350 |
| AlphaVantage | 148 | P3 | 80% | ~60 |
| Crypto | 315 | P3 | 80% | ~125 |
| Formatting | 240 | P4 | 75% | ~90 |
| Misc Utils | 281 | P4 | 75% | ~105 |
| Price Utils | 222 | P4 | 75% | ~85 |
| **TOTAL** | **12,188** | | **90%** | **~5,595** |

**Estimated Total Test Code:** ~5,600 LOC

---

## Testing Best Practices

### 1. Unit Test Guidelines

```typescript
describe('ModuleName', () => {
  // Group related tests
  describe('functionName', () => {
    it('should handle normal case', () => {
      // Arrange
      const input = ...;

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toBe(expected);
    });

    it('should handle edge case', () => {
      // Test boundary conditions
    });

    it('should throw error on invalid input', () => {
      expect(() => functionName(invalidInput)).toThrow('Error message');
    });
  });
});
```

### 2. Mock External Dependencies

```typescript
// Mock fetch
global.fetch = vi.fn();

// Mock date
vi.useFakeTimers();
vi.setSystemTime(new Date('2025-12-01T10:00:00Z'));

// Mock environment variables
vi.stubEnv('POLYGON_API_KEY', 'test-key');
```

### 3. Test Isolation

```typescript
beforeEach(() => {
  // Reset mocks before each test
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

afterEach(() => {
  // Clean up
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
```

### 4. Async Testing

```typescript
it('should fetch data asynchronously', async () => {
  const promise = fetchData();

  expect(promise).toBeInstanceOf(Promise);

  const result = await promise;

  expect(result).toBeDefined();
});
```

### 5. Error Testing

```typescript
it('should handle network errors', async () => {
  global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

  await expect(fetchData()).rejects.toThrow('Network error');
});
```

---

## Test Implementation Timeline

### Week 1-2: Setup & Infrastructure
- [ ] Install Vitest and dependencies
- [ ] Configure vitest.config.ts
- [ ] Set up test directory structure
- [ ] Create mock fixtures
- [ ] Set up GitHub Actions CI/CD

### Week 3-4: Priority 1 Tests (Critical Path)
- [ ] Broker API tests (95% coverage)
- [ ] Cache tests (95% coverage)
- [ ] Market time tests (90% coverage)

### Week 5-6: Priority 2 Tests (Analytics)
- [ ] Performance metrics tests (85% coverage)
- [ ] Technical analysis tests (85% coverage)
- [ ] Asset allocation tests (85% coverage)

### Week 7: Priority 3 Tests (Data Providers)
- [ ] Polygon API tests (80% coverage)
- [ ] AlphaVantage tests (80% coverage)
- [ ] Crypto tests (80% coverage)

### Week 8: Priority 4 Tests (Utilities)
- [ ] Formatting tests (75% coverage)
- [ ] Misc utils tests (75% coverage)
- [ ] Price utils tests (75% coverage)

### Week 9: Integration & E2E Tests
- [ ] Integration tests for API clients
- [ ] End-to-end trading workflow tests

### Week 10: Coverage Review & Refinement
- [ ] Achieve 90% overall coverage
- [ ] Fix failing tests
- [ ] Refactor tests for maintainability

---

## Known Testing Challenges

### 1. Live API Testing
**Challenge:** Can't call real APIs in unit tests
**Solution:** Comprehensive mocking with realistic fixtures

### 2. Time-Dependent Tests
**Challenge:** Market hours depend on current time
**Solution:** Use `vi.useFakeTimers()` to control time

### 3. Async Stampede Protection
**Challenge:** Testing concurrent request coalescing
**Solution:** Use `Promise.all()` with controlled delays

### 4. Rate Limiting
**Challenge:** Testing retry backoff without long waits
**Solution:** Mock timers and fast-forward time

### 5. DST Transitions
**Challenge:** Timezone tests during DST changes
**Solution:** Test specific dates with known DST transitions

---

## Success Metrics

### Coverage Thresholds
- **Lines:** 90%
- **Functions:** 90%
- **Branches:** 90%
- **Statements:** 90%

### Quality Metrics
- All tests pass in CI/CD
- No flaky tests (100% consistent results)
- Test execution time < 30 seconds
- Zero test dependencies on external APIs

### Code Quality
- All critical paths have tests
- Edge cases covered
- Error scenarios tested
- Documentation for complex test setups

---

**End of Test Coverage Analysis**
