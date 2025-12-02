# @adaptic/utils - Consolidation Plan

**Generated:** 2025-12-02
**Target Architecture:** Monorepo-ready, Multi-broker, Multi-tenant
**Consolidation Target:** Merge `@adaptic/lumic-utils` into `@adaptic/utils`

---

## Executive Summary

This document outlines the strategy for consolidating `@adaptic/lumic-utils` into `@adaptic/utils`, refactoring for multi-broker support, and preparing for monorepo migration.

**Key Objectives:**
1. **Merge Lumic Utils:** Consolidate `@adaptic/lumic-utils` under `/lumic` namespace
2. **Multi-broker Abstraction:** Abstract Alpaca-specific code for Interactive Brokers, Schwab support
3. **Multi-tenant Backend:** Remove hardcoded `@adaptic/backend-legacy` dependency
4. **Tree-shaking Optimization:** Implement subpath exports for smaller bundle sizes
5. **Test Coverage:** Achieve 90% test coverage with Vitest
6. **Breaking Changes:** Document and version migration path

---

## Current State Analysis

### @adaptic/utils Current Structure

**Package Version:** 0.0.380
**Total LOC:** 15,429 lines
**Dependencies:**
- `@adaptic/backend-legacy@^0.0.38` - Backend GraphQL client
- `@adaptic/lumic-utils@^1.0.6` - Lumic utilities (TO BE MERGED)
- `@apollo/client@^3.13.8` - GraphQL
- `date-fns@^4.1.0`, `date-fns-tz@^3.2.0` - Date handling
- `lru-cache@^11.2.2` - Caching
- `ws@^8.18.3` - WebSocket
- `p-limit@^6.2.0` - Concurrency
- `ms@^2.1.3`, `chalk@^5.4.1` - Utilities

**Key Characteristics:**
- Alpaca-centric (4,616 LOC / 29.9% of codebase)
- NYSE-specific market hours/holidays
- No formal test coverage
- Namespace-based exports (`adaptic.*`)
- No subpath exports (entire bundle required)

**Broker-Specific Code (Requires Abstraction):**
- `alpaca-trading-api.ts` (1,683 LOC)
- `alpaca-functions.ts` (1,659 LOC)
- `alpaca-market-data-api.ts` (1,274 LOC)
- `crypto.ts` (315 LOC - Alpaca Crypto API)
- `price-utils.ts` (222 LOC - partially)
- `metrics-calcs.ts` (516 LOC - Alpaca portfolio format)

**Total Abstraction Required:** ~5,824 LOC (37% of codebase)

---

### @adaptic/lumic-utils Analysis

**Note:** Need to inspect actual package contents. Based on dependency, likely contains:

**Expected Lumic Utilities:**
- Lightweight charting utilities
- UI component helpers
- React hooks for financial data
- Display formatting utilities
- Real-time data streaming helpers

**Action Required:**
```bash
# Analyze lumic-utils package
npm view @adaptic/lumic-utils
# or
cat node_modules/@adaptic/lumic-utils/package.json
ls -R node_modules/@adaptic/lumic-utils/
```

**Estimated LOC:** 1,000-2,000 lines (based on typical utility package size)

---

## Target Structure (Post-Consolidation)

### Directory Organization

```
@adaptic/utils/
├── src/
│   ├── brokers/                    # NEW: Multi-broker abstraction layer
│   │   ├── types.ts                # Common broker interface types
│   │   ├── base-broker.ts          # Abstract base class
│   │   ├── broker-factory.ts       # Factory for creating broker instances
│   │   ├── alpaca/
│   │   │   ├── index.ts
│   │   │   ├── trading-client.ts   # Implements BrokerTradingInterface
│   │   │   ├── market-data-client.ts
│   │   │   ├── account-client.ts
│   │   │   ├── types.ts            # Alpaca-specific types
│   │   │   └── utils.ts
│   │   ├── interactive-brokers/    # NEW: Future support
│   │   │   └── index.ts
│   │   └── schwab/                 # NEW: Future support
│   │       └── index.ts
│   │
│   ├── data-providers/             # REFACTORED: Market data sources
│   │   ├── types.ts                # Common data provider interfaces
│   │   ├── polygon/
│   │   │   ├── index.ts
│   │   │   ├── stocks.ts           # Stock market data
│   │   │   ├── indices.ts          # Index data
│   │   │   ├── types.ts
│   │   │   └── utils.ts
│   │   ├── alphavantage/
│   │   │   ├── index.ts
│   │   │   ├── quotes.ts
│   │   │   ├── news.ts
│   │   │   └── types.ts
│   │   └── crypto/                 # Broker-agnostic crypto data
│   │       ├── index.ts
│   │       └── types.ts
│   │
│   ├── analytics/                  # Financial calculations (broker-agnostic)
│   │   ├── performance/
│   │   │   ├── index.ts
│   │   │   ├── metrics.ts          # Performance metrics
│   │   │   ├── returns.ts          # Return calculations
│   │   │   └── types.ts
│   │   ├── technical-analysis/
│   │   │   ├── index.ts
│   │   │   ├── indicators.ts       # EMA, MACD, RSI, etc.
│   │   │   ├── oscillators.ts
│   │   │   ├── bands.ts            # Bollinger Bands
│   │   │   └── types.ts
│   │   └── asset-allocation/
│   │       ├── index.ts
│   │       ├── engine.ts           # AssetAllocationEngine
│   │       ├── optimizer.ts
│   │       ├── risk-profiles.ts
│   │       └── types.ts
│   │
│   ├── time/                       # Market time utilities
│   │   ├── index.ts
│   │   ├── market-time.ts          # Market hours, status
│   │   ├── market-calendar.ts      # Holidays, early closes
│   │   ├── timezone-utils.ts       # Time zone conversions
│   │   ├── formatters.ts           # Date formatting
│   │   └── types.ts
│   │
│   ├── cache/                      # Caching infrastructure
│   │   ├── index.ts
│   │   ├── stampede-protected-cache.ts
│   │   └── types.ts
│   │
│   ├── formatting/                 # Display and formatting
│   │   ├── index.ts
│   │   ├── currency.ts             # Currency formatting
│   │   ├── numbers.ts              # Number formatting
│   │   ├── dates.ts                # Date formatting
│   │   ├── enums.ts                # Enum formatting
│   │   └── types.ts
│   │
│   ├── utils/                      # General utilities
│   │   ├── index.ts
│   │   ├── http.ts                 # fetchWithRetry, etc.
│   │   ├── logging.ts              # Debug logging
│   │   ├── validation.ts           # API key validation
│   │   └── types.ts
│   │
│   ├── lumic/                      # NEW: Merged from @adaptic/lumic-utils
│   │   ├── index.ts
│   │   ├── charts/                 # Charting utilities
│   │   ├── hooks/                  # React hooks
│   │   ├── components/             # UI components
│   │   └── types.ts
│   │
│   ├── backend/                    # NEW: Backend abstraction (was adaptic.ts)
│   │   ├── index.ts
│   │   ├── interface.ts            # Backend interface
│   │   ├── adaptic-backend.ts      # Adaptic implementation
│   │   ├── graphql-client.ts       # Generic GraphQL client
│   │   └── types.ts
│   │
│   ├── types/                      # Shared type definitions
│   │   └── index.ts                # Re-export all types
│   │
│   └── index.ts                    # Main entry point with namespace exports
│
├── package.json                    # Updated exports, dependencies
├── tsconfig.json
├── rollup.config.mjs               # Updated for new structure
├── vitest.config.ts                # NEW: Test configuration
├── .github/
│   └── workflows/
│       ├── test.yml                # NEW: CI/CD tests
│       └── publish.yml             # NPM publish workflow
└── docs/
    ├── UTILS-INVENTORY.md
    ├── CONSOLIDATION-PLAN.md       # This file
    ├── TEST-COVERAGE-ANALYSIS.md
    ├── API-SURFACE.md
    └── MIGRATION-GUIDE.md          # NEW: v1.0.0 migration guide
```

---

## Broker Abstraction Layer Design

### Core Interfaces

```typescript
// src/brokers/types.ts

/**
 * Common credential interface for all brokers
 */
export interface BrokerCredentials {
  apiKey: string;
  apiSecret: string;
  paper?: boolean; // Paper trading vs live
  baseUrl?: string; // Optional custom base URL
}

/**
 * Unified position interface across all brokers
 */
export interface Position {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  side: 'long' | 'short';
  assetClass: 'stock' | 'option' | 'crypto' | 'future';
}

/**
 * Unified order interface
 */
export interface Order {
  id: string;
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  timeInForce: 'day' | 'gtc' | 'ioc' | 'fok';
  limitPrice?: number;
  stopPrice?: number;
  status: 'pending' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';
  filledQty?: number;
  filledAvgPrice?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Unified account interface
 */
export interface Account {
  id: string;
  accountNumber: string;
  currency: string;
  cash: number;
  equity: number;
  buyingPower: number;
  portfolioValue: number;
  status: 'active' | 'inactive' | 'pending' | 'restricted';
}

/**
 * Broker trading interface
 */
export interface BrokerTradingInterface {
  // Account
  getAccount(): Promise<Account>;

  // Positions
  getPositions(): Promise<Position[]>;
  getPosition(symbol: string): Promise<Position | null>;
  closePosition(symbol: string, qty?: number): Promise<Order>;
  closeAllPositions(): Promise<Order[]>;

  // Orders
  createOrder(params: CreateOrderParams): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;
  getOrders(params?: GetOrdersParams): Promise<Order[]>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAllOrders(): Promise<void>;
  replaceOrder(orderId: string, params: ReplaceOrderParams): Promise<Order>;

  // Portfolio history
  getPortfolioHistory(params: PortfolioHistoryParams): Promise<PortfolioHistory>;
}

/**
 * Broker market data interface
 */
export interface BrokerMarketDataInterface {
  getLatestQuote(symbol: string): Promise<Quote>;
  getLatestQuotes(symbols: string[]): Promise<Record<string, Quote>>;
  getLatestTrade(symbol: string): Promise<Trade>;
  getBars(params: GetBarsParams): Promise<Bar[]>;
  getSnapshot(symbol: string): Promise<Snapshot>;
}
```

### Base Broker Implementation

```typescript
// src/brokers/base-broker.ts

export abstract class BaseBroker implements BrokerTradingInterface, BrokerMarketDataInterface {
  protected credentials: BrokerCredentials;
  protected baseUrl: string;

  constructor(credentials: BrokerCredentials) {
    this.credentials = credentials;
    this.validateCredentials();
  }

  protected abstract validateCredentials(): void;
  protected abstract makeRequest<T>(endpoint: string, options?: RequestInit): Promise<T>;

  // Abstract methods to be implemented by each broker
  abstract getAccount(): Promise<Account>;
  abstract getPositions(): Promise<Position[]>;
  abstract createOrder(params: CreateOrderParams): Promise<Order>;
  // ... etc
}
```

### Broker Factory

```typescript
// src/brokers/broker-factory.ts

export type BrokerType = 'alpaca' | 'interactive-brokers' | 'schwab';

export interface CreateBrokerParams {
  type: BrokerType;
  credentials: BrokerCredentials;
}

export function createBroker(params: CreateBrokerParams): BrokerTradingInterface & BrokerMarketDataInterface {
  switch (params.type) {
    case 'alpaca':
      return new AlpacaBroker(params.credentials);
    case 'interactive-brokers':
      return new InteractiveBrokersBroker(params.credentials);
    case 'schwab':
      return new SchwabBroker(params.credentials);
    default:
      throw new Error(`Unsupported broker type: ${params.type}`);
  }
}
```

### Alpaca Implementation

```typescript
// src/brokers/alpaca/trading-client.ts

import { BaseBroker } from '../base-broker';
import type { Account, Position, Order, CreateOrderParams } from '../types';

export class AlpacaBroker extends BaseBroker {
  protected validateCredentials(): void {
    if (!this.credentials.apiKey || !this.credentials.apiSecret) {
      throw new Error('Alpaca requires apiKey and apiSecret');
    }
  }

  protected async makeRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'APCA-API-KEY-ID': this.credentials.apiKey,
      'APCA-API-SECRET-KEY': this.credentials.apiSecret,
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    const response = await fetchWithRetry(url, { ...options, headers });
    if (!response.ok) {
      throw new Error(`Alpaca API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async getAccount(): Promise<Account> {
    const data = await this.makeRequest<AlpacaAccountResponse>('/v2/account');
    return this.mapAlpacaAccount(data);
  }

  async getPositions(): Promise<Position[]> {
    const data = await this.makeRequest<AlpacaPositionResponse[]>('/v2/positions');
    return data.map(this.mapAlpacaPosition);
  }

  private mapAlpacaAccount(data: AlpacaAccountResponse): Account {
    return {
      id: data.id,
      accountNumber: data.account_number,
      currency: data.currency,
      cash: parseFloat(data.cash),
      equity: parseFloat(data.equity),
      buyingPower: parseFloat(data.buying_power),
      portfolioValue: parseFloat(data.portfolio_value),
      status: this.mapAlpacaAccountStatus(data.status),
    };
  }

  // ... more mapping methods
}
```

---

## Export Strategy

### Package.json Exports (Tree-shaking)

```json
{
  "name": "@adaptic/utils",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/types/index.d.ts"
    },
    "./brokers": {
      "import": "./dist/brokers/index.mjs",
      "require": "./dist/brokers/index.cjs",
      "types": "./dist/types/brokers/index.d.ts"
    },
    "./brokers/alpaca": {
      "import": "./dist/brokers/alpaca/index.mjs",
      "require": "./dist/brokers/alpaca/index.cjs",
      "types": "./dist/types/brokers/alpaca/index.d.ts"
    },
    "./data-providers": {
      "import": "./dist/data-providers/index.mjs",
      "require": "./dist/data-providers/index.cjs",
      "types": "./dist/types/data-providers/index.d.ts"
    },
    "./data-providers/polygon": {
      "import": "./dist/data-providers/polygon/index.mjs",
      "require": "./dist/data-providers/polygon/index.cjs",
      "types": "./dist/types/data-providers/polygon/index.d.ts"
    },
    "./analytics": {
      "import": "./dist/analytics/index.mjs",
      "require": "./dist/analytics/index.cjs",
      "types": "./dist/types/analytics/index.d.ts"
    },
    "./analytics/performance": {
      "import": "./dist/analytics/performance/index.mjs",
      "require": "./dist/analytics/performance/index.cjs",
      "types": "./dist/types/analytics/performance/index.d.ts"
    },
    "./analytics/technical-analysis": {
      "import": "./dist/analytics/technical-analysis/index.mjs",
      "require": "./dist/analytics/technical-analysis/index.cjs",
      "types": "./dist/types/analytics/technical-analysis/index.d.ts"
    },
    "./analytics/asset-allocation": {
      "import": "./dist/analytics/asset-allocation/index.mjs",
      "require": "./dist/analytics/asset-allocation/index.cjs",
      "types": "./dist/types/analytics/asset-allocation/index.d.ts"
    },
    "./time": {
      "import": "./dist/time/index.mjs",
      "require": "./dist/time/index.cjs",
      "types": "./dist/types/time/index.d.ts"
    },
    "./cache": {
      "import": "./dist/cache/index.mjs",
      "require": "./dist/cache/index.cjs",
      "types": "./dist/types/cache/index.d.ts"
    },
    "./formatting": {
      "import": "./dist/formatting/index.mjs",
      "require": "./dist/formatting/index.cjs",
      "types": "./dist/types/formatting/index.d.ts"
    },
    "./utils": {
      "import": "./dist/utils/index.mjs",
      "require": "./dist/utils/index.cjs",
      "types": "./dist/types/utils/index.d.ts"
    },
    "./lumic": {
      "import": "./dist/lumic/index.mjs",
      "require": "./dist/lumic/index.cjs",
      "types": "./dist/types/lumic/index.d.ts"
    },
    "./types": {
      "import": "./dist/types/index.mjs",
      "require": "./dist/types/index.cjs",
      "types": "./dist/types/index.d.ts"
    }
  },
  "files": [
    "dist",
    "README.md",
    "CHANGELOG.md"
  ]
}
```

### Usage Examples

```typescript
// Before (v0.x - namespace import, entire bundle)
import { adaptic } from '@adaptic/utils';
const positions = await adaptic.alpaca.position.fetchAll(...);

// After (v1.x - subpath imports, tree-shaking)
import { createBroker } from '@adaptic/utils/brokers';
import { AlpacaBroker } from '@adaptic/utils/brokers/alpaca';

const broker = createBroker({
  type: 'alpaca',
  credentials: { apiKey: '...', apiSecret: '...' }
});
const positions = await broker.getPositions();

// Or direct import
const broker = new AlpacaBroker({ apiKey: '...', apiSecret: '...' });

// Analytics (broker-agnostic)
import { calculateRSI } from '@adaptic/utils/analytics/technical-analysis';
import { AssetAllocationEngine } from '@adaptic/utils/analytics/asset-allocation';

// Time utilities
import { MarketTimeUtil, getMarketStatus } from '@adaptic/utils/time';

// Cache
import { createStampedeProtectedCache } from '@adaptic/utils/cache';

// Lumic utilities
import { useChartData } from '@adaptic/utils/lumic';
```

---

## Migration Path for Existing Code

### Breaking Changes (v0.x → v1.0)

#### 1. Namespace API Removal

**Before:**
```typescript
import { adaptic } from '@adaptic/utils';
await adaptic.alpaca.position.fetchAll(...);
await adaptic.time.getMarketStatus();
```

**After:**
```typescript
import { createBroker } from '@adaptic/utils/brokers';
import { getMarketStatus } from '@adaptic/utils/time';

const broker = createBroker({ type: 'alpaca', credentials });
await broker.getPositions();
await getMarketStatus();
```

#### 2. Factory Function Changes

**Before:**
```typescript
import { createAlpacaTradingAPI } from '@adaptic/utils';
const api = createAlpacaTradingAPI(credentials);
```

**After:**
```typescript
import { createBroker } from '@adaptic/utils/brokers';
const broker = createBroker({ type: 'alpaca', credentials });
// or
import { AlpacaBroker } from '@adaptic/utils/brokers/alpaca';
const broker = new AlpacaBroker(credentials);
```

#### 3. Type Imports

**Before:**
```typescript
import { adaptic } from '@adaptic/utils';
type Position = adaptic.types.AlpacaPosition;
```

**After:**
```typescript
import type { Position } from '@adaptic/utils/types';
// or
import type { Position } from '@adaptic/utils/brokers';
```

#### 4. Lumic Utils Migration

**Before:**
```typescript
import { someFunction } from '@adaptic/lumic-utils';
```

**After:**
```typescript
import { someFunction } from '@adaptic/utils/lumic';
```

---

### Compatibility Layer (v1.0 - Optional)

For gradual migration, provide a compatibility shim:

```typescript
// src/compat/index.ts
import { AlpacaBroker } from '../brokers/alpaca';
import * as time from '../time';
import * as format from '../formatting';
// ... etc

/**
 * @deprecated Use subpath imports instead. This compatibility layer will be removed in v2.0.
 */
export const adaptic = {
  alpaca: {
    position: {
      fetchAll: async (creds) => {
        console.warn('adaptic.alpaca.position.fetchAll is deprecated. Use createBroker() instead.');
        const broker = new AlpacaBroker(creds);
        return broker.getPositions();
      },
      // ... other methods
    },
  },
  time,
  format,
  // ... etc
};
```

**Usage:**
```typescript
// Import compatibility layer (with deprecation warnings)
import { adaptic } from '@adaptic/utils/compat';
```

---

## Backend Abstraction

### Current Issue

`adaptic.ts` hardcodes dependency on `@adaptic/backend-legacy`:

```typescript
import adaptic from "@adaptic/backend-legacy";
```

This prevents multi-tenant architectures where different customers use different backends.

### Solution: Backend Interface

```typescript
// src/backend/interface.ts

export interface BackendInterface {
  /**
   * Fetch asset overview data
   */
  fetchAssetOverview(params: FetchAssetParams): Promise<AssetOverview>;

  /**
   * Get GraphQL client
   */
  getGraphQLClient(): ApolloClient<NormalizedCacheObject>;

  /**
   * Configure authentication
   */
  configureAuth(tokenProvider: TokenProvider): void;

  /**
   * Check if auth is configured
   */
  isAuthConfigured(): boolean;
}

export interface TokenProvider {
  getToken(): Promise<string> | string;
}

export interface BackendConfig {
  graphqlEndpoint: string;
  tokenProvider?: TokenProvider;
}
```

### Adaptic Backend Implementation

```typescript
// src/backend/adaptic-backend.ts

import { ApolloClient, InMemoryCache } from '@apollo/client';
import type { BackendInterface, BackendConfig, TokenProvider } from './interface';

export class AdapticBackend implements BackendInterface {
  private client: ApolloClient<NormalizedCacheObject>;
  private tokenProvider?: TokenProvider;

  constructor(config: BackendConfig) {
    this.client = new ApolloClient({
      uri: config.graphqlEndpoint,
      cache: new InMemoryCache(),
      // ... auth link setup
    });

    if (config.tokenProvider) {
      this.configureAuth(config.tokenProvider);
    }
  }

  async fetchAssetOverview(params: FetchAssetParams): Promise<AssetOverview> {
    // Implementation using this.client
  }

  getGraphQLClient(): ApolloClient<NormalizedCacheObject> {
    return this.client;
  }

  configureAuth(tokenProvider: TokenProvider): void {
    this.tokenProvider = tokenProvider;
  }

  isAuthConfigured(): boolean {
    return !!this.tokenProvider;
  }
}
```

### Usage

```typescript
// Before (hardcoded)
import adaptic from '@adaptic/backend-legacy';

// After (configurable)
import { AdapticBackend } from '@adaptic/utils/backend';

const backend = new AdapticBackend({
  graphqlEndpoint: process.env.BACKEND_GRAPHQL_URL,
  tokenProvider: async () => await getAuthToken(),
});

const assetData = await backend.fetchAssetOverview({ symbol: 'AAPL' });
```

---

## Lumic Utils Consolidation

### Action Items

1. **Analyze `@adaptic/lumic-utils` contents:**
   ```bash
   cd /Users/ravi/adapticai
   npm view @adaptic/lumic-utils
   # or
   ls -R node_modules/@adaptic/lumic-utils/
   cat node_modules/@adaptic/lumic-utils/package.json
   ```

2. **Copy source files to `src/lumic/`:**
   ```bash
   cp -r node_modules/@adaptic/lumic-utils/src/* src/lumic/
   ```

3. **Update internal imports:**
   - Replace `@adaptic/lumic-utils` imports with relative imports
   - Update type definitions

4. **Create lumic index:**
   ```typescript
   // src/lumic/index.ts
   export * from './charts';
   export * from './hooks';
   export * from './components';
   ```

5. **Update package.json:**
   - Remove `@adaptic/lumic-utils` from dependencies
   - Add subpath export for `/lumic`

6. **Document migration:**
   ```markdown
   # Migration from @adaptic/lumic-utils

   Before:
   ```typescript
   import { useChartData } from '@adaptic/lumic-utils';
   ```

   After:
   ```typescript
   import { useChartData } from '@adaptic/utils/lumic';
   ```
   ```

---

## Rollup Configuration Updates

```javascript
// rollup.config.mjs

import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

const external = [
  '@apollo/client',
  'date-fns',
  'date-fns-tz',
  'lru-cache',
  'ws',
  'p-limit',
  'ms',
  'chalk',
  'react',
  'lightweight-charts',
];

const subpackages = [
  'brokers',
  'brokers/alpaca',
  'data-providers',
  'data-providers/polygon',
  'data-providers/alphavantage',
  'analytics',
  'analytics/performance',
  'analytics/technical-analysis',
  'analytics/asset-allocation',
  'time',
  'cache',
  'formatting',
  'utils',
  'lumic',
  'types',
];

const createConfig = (input, outputDir) => ({
  input,
  external,
  output: [
    {
      file: `dist/${outputDir}/index.mjs`,
      format: 'esm',
      sourcemap: true,
    },
    {
      file: `dist/${outputDir}/index.cjs`,
      format: 'cjs',
      sourcemap: true,
    },
  ],
  plugins: [
    resolve(),
    commonjs(),
    json(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: `dist/types/${outputDir}`,
    }),
  ],
});

export default [
  // Main entry
  createConfig('src/index.ts', '.'),

  // Subpackages
  ...subpackages.map(pkg =>
    createConfig(`src/${pkg}/index.ts`, pkg)
  ),
];
```

---

## Testing Strategy (See TEST-COVERAGE-ANALYSIS.md)

**Target:** 90% code coverage with Vitest

**Key Areas:**
1. Broker abstraction layer (100% coverage required)
2. Analytics utilities (performance, TA, allocation)
3. Time utilities (market hours, calendars)
4. Cache infrastructure
5. Data provider clients

---

## Rollout Plan

### Phase 1: Preparation (Week 1-2)
- [ ] Analyze `@adaptic/lumic-utils` package contents
- [ ] Design broker abstraction interfaces
- [ ] Set up Vitest test framework
- [ ] Create migration documentation

### Phase 2: Broker Abstraction (Week 3-5)
- [ ] Implement `BrokerInterface` and `BaseBroker`
- [ ] Refactor `AlpacaBroker` to use new interface
- [ ] Create broker factory
- [ ] Write tests for broker layer (100% coverage)

### Phase 3: Directory Restructuring (Week 6-7)
- [ ] Move files to new directory structure
- [ ] Update internal imports
- [ ] Create subpackage index files
- [ ] Update Rollup config for subpath exports

### Phase 4: Lumic Consolidation (Week 8)
- [ ] Copy lumic-utils source to `src/lumic/`
- [ ] Update imports
- [ ] Test lumic functionality
- [ ] Remove `@adaptic/lumic-utils` dependency

### Phase 5: Backend Abstraction (Week 9)
- [ ] Create `BackendInterface`
- [ ] Implement `AdapticBackend`
- [ ] Refactor `adaptic.ts` → `backend/adaptic-backend.ts`
- [ ] Make backend configurable

### Phase 6: Testing & Documentation (Week 10-11)
- [ ] Achieve 90% test coverage
- [ ] Write API documentation
- [ ] Create migration guide
- [ ] Update README with new usage examples

### Phase 7: Release (Week 12)
- [ ] Version bump to 1.0.0
- [ ] Publish to NPM
- [ ] Update dependent packages
- [ ] Deprecate `@adaptic/lumic-utils`

---

## Breaking Changes Summary

### v1.0.0 Breaking Changes

1. **Namespace API Removed:**
   - `adaptic.alpaca.*` → Import from `@adaptic/utils/brokers`
   - `adaptic.time.*` → Import from `@adaptic/utils/time`
   - `adaptic.format.*` → Import from `@adaptic/utils/formatting`

2. **Factory Functions Changed:**
   - `createAlpacaTradingAPI()` → `createBroker({ type: 'alpaca', ... })`
   - `createAlpacaMarketDataAPI()` → Integrated into broker client

3. **Type Exports Moved:**
   - `import type { X } from '@adaptic/utils'` still works
   - Prefer `import type { X } from '@adaptic/utils/types'`

4. **Lumic Utils Merged:**
   - `@adaptic/lumic-utils` → `@adaptic/utils/lumic`
   - Package deprecated, use main package

5. **Backend Now Configurable:**
   - No longer hardcoded to `@adaptic/backend-legacy`
   - Must instantiate `AdapticBackend` with config

6. **Subpath Exports Required:**
   - Enable tree-shaking
   - Import specific modules to reduce bundle size

---

## Migration Guide Template

```markdown
# Migrating from @adaptic/utils v0.x to v1.0

## Overview
Version 1.0 introduces multi-broker support, lumic-utils consolidation, and tree-shaking optimization.

## Quick Start

### Install
```bash
npm install @adaptic/utils@^1.0.0
```

### Update Imports

#### Broker API
```diff
- import { adaptic } from '@adaptic/utils';
- const positions = await adaptic.alpaca.position.fetchAll(creds);
+ import { createBroker } from '@adaptic/utils/brokers';
+ const broker = createBroker({ type: 'alpaca', credentials: creds });
+ const positions = await broker.getPositions();
```

#### Analytics
```diff
- import { adaptic } from '@adaptic/utils';
- const rsi = adaptic.ta.calculateRSI(data);
+ import { calculateRSI } from '@adaptic/utils/analytics/technical-analysis';
+ const rsi = calculateRSI(data);
```

#### Time Utilities
```diff
- import { adaptic } from '@adaptic/utils';
- const status = adaptic.time.getMarketStatus();
+ import { getMarketStatus } from '@adaptic/utils/time';
+ const status = getMarketStatus();
```

#### Lumic Utils
```diff
- import { useChartData } from '@adaptic/lumic-utils';
+ import { useChartData } from '@adaptic/utils/lumic';
```

## Full API Mapping
[See API-SURFACE.md for complete mapping]
```

---

**End of Consolidation Plan**
