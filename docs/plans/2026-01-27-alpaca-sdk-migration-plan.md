# Alpaca Markets SDK Migration Plan

## Overview
Complete rebuild of Alpaca integration using official @alpacahq/alpaca-trade-api v3.1.3 SDK with full support for bracket orders, OCO, OTO, native trailing stops, and multi-leg options.

**Approach**: Clean break - no backward compatibility
**SDK**: @alpacahq/alpaca-trade-api v3.1.3

---

## Phase 1: @adaptic/utils Core Overhaul

### 1.1 Install SDK & Update Dependencies
- Add `@alpacahq/alpaca-trade-api` to package.json
- Remove direct `ws` dependency (SDK manages WebSockets)
- Update TypeScript types

### 1.2 New Module Structure
```
src/
├── alpaca/
│   ├── index.ts                 # Main export aggregator
│   ├── client.ts                # SDK client wrapper & factory
│   ├── types.ts                 # Consolidated types
│   ├── trading/
│   │   ├── orders.ts            # Order management (simple, bracket, OCO, OTO)
│   │   ├── positions.ts         # Position management
│   │   ├── account.ts           # Account details & config
│   │   └── smart-orders.ts      # Bracket, OCO, OTO implementations
│   ├── market-data/
│   │   ├── quotes.ts            # Real-time quotes
│   │   ├── bars.ts              # Historical bars
│   │   ├── trades.ts            # Trade data
│   │   └── news.ts              # News feed
│   ├── options/
│   │   ├── contracts.ts         # Option contract queries
│   │   ├── orders.ts            # Single & multi-leg orders
│   │   ├── strategies.ts        # Spreads, condors, etc.
│   │   └── data.ts              # Options market data
│   ├── crypto/
│   │   ├── orders.ts            # Crypto order management
│   │   └── data.ts              # Crypto market data
│   └── streams/
│       ├── trading-stream.ts    # Trade updates WebSocket
│       ├── stock-stream.ts      # Stock data WebSocket
│       ├── option-stream.ts     # Options data WebSocket
│       └── crypto-stream.ts     # Crypto data WebSocket
```

### 1.3 Smart Order Types (NEW)

#### Bracket Orders
```typescript
interface BracketOrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  limitPrice?: number;
  takeProfit: { limitPrice: number };
  stopLoss: { stopPrice: number; limitPrice?: number };
  timeInForce?: 'day' | 'gtc';
}
```

#### OCO Orders
```typescript
interface OCOOrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  takeProfit: { limitPrice: number };
  stopLoss: { stopPrice: number; limitPrice?: number };
  timeInForce?: 'day' | 'gtc';
}
```

#### OTO Orders
```typescript
interface OTOOrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  limitPrice?: number;
  dependent: {
    type: 'take_profit' | 'stop_loss';
    limitPrice?: number;
    stopPrice?: number;
  };
  timeInForce?: 'day' | 'gtc';
}
```

#### Native Trailing Stops
```typescript
interface TrailingStopParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  trailPercent?: number;  // Percentage (e.g., 1 = 1%)
  trailPrice?: number;    // Dollar amount
  timeInForce?: 'day' | 'gtc';
}
```

### 1.4 SDK Client Factory
```typescript
// New unified client factory
export function createAlpacaClient(config: AlpacaConfig): AlpacaClient {
  const sdk = new Alpaca({
    keyId: config.apiKey,
    secretKey: config.apiSecret,
    paper: config.type === 'PAPER',
  });

  return new AlpacaClient(sdk, config);
}
```

---

## Phase 2: Implementation Tasks (20 Parallel Agents)

### Agent 1-2: Core SDK Integration
- Install SDK, update package.json
- Create client factory and configuration

### Agent 3-4: Order Management
- Implement simple orders using SDK
- Implement order queries, cancel, replace

### Agent 5-6: Smart Orders (Bracket/OCO/OTO)
- Implement bracket orders
- Implement OCO orders
- Implement OTO orders

### Agent 7-8: Trailing Stops
- Implement native trailing stop orders
- Implement trailing stop management (update, cancel)

### Agent 9-10: Position Management
- Implement position queries using SDK
- Implement position closing (market/limit)
- Implement close all positions

### Agent 11-12: Account & Configuration
- Implement account details using SDK
- Implement portfolio history
- Implement account configuration

### Agent 13-14: Market Data
- Implement quotes, trades, bars using SDK
- Implement news feed

### Agent 15-16: Options Trading
- Implement option contract queries
- Implement single & multi-leg orders
- Implement option strategies (spreads, condors)

### Agent 17-18: WebSocket Streams
- Implement trading stream using SDK
- Implement market data streams (stock, option, crypto)

### Agent 19: Types & Exports
- Consolidate all types
- Update index.ts exports
- Update adaptic namespace

### Agent 20: Integration Testing & Validation
- Verify all functions work
- Test build process
- Validate TypeScript compilation

---

## Phase 3: Consumer Updates

### Engine Updates
- Replace direct API calls with @adaptic/utils
- Update trailing stop service to use native stops
- Update crypto service
- Update WebSocket connections

### App Updates
- Update API routes to use new utils
- Update components if needed
- Verify type compatibility

### Adaptic-App Updates
- Update API routes
- Update alpaca library files
- Verify functionality

---

## API Changes Summary

### Removed (Breaking)
- `AlpacaTradingAPI` class (replaced by SDK-based implementation)
- `AlpacaMarketDataAPI` class (replaced by SDK-based implementation)
- Direct `makeRequest` function
- Manual WebSocket management

### Added (New)
- `createBracketOrder(params)` - Native bracket orders
- `createOCOOrder(params)` - Native OCO orders
- `createOTOOrder(params)` - Native OTO orders
- `createTrailingStopOrder(params)` - Native trailing stops
- SDK-based WebSocket streams with built-in reconnection

### Changed
- All order functions now use SDK internally
- WebSocket streams use SDK's built-in stream management
- Market data uses SDK's data endpoints

---

## Dependency Update Workflow

1. Update @adaptic/utils → npm publish
2. Wait 3-5 minutes for npm propagation
3. Update @adaptic/engine → yarn upgrade @adaptic/utils
4. Update @adaptic/app → yarn upgrade @adaptic/utils
5. Update adaptic-app → yarn upgrade @adaptic/utils
6. Push all changes to git origin main
