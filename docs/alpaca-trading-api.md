# AlpacaTradingAPI Documentation

Last updated: 2025-07-07

```ts
import { AlpacaTradingAPI } from '@/src/alpaca-trading-api';
import type {
  AlpacaCredentials,
  AlpacaAccountDetails,
  AlpacaPosition,
  AlpacaOrder,
  TradeUpdate,
  GetOrdersParams,
  AssetClass,
  OptionContractsResponse,
  OptionContract,
  OptionAccountActivity,
  OrderLeg
} from '@/src/types/alpaca-types';

const credentials: AlpacaCredentials = {
  accountName: 'MY_ACCOUNT',
  apiKey:       'YOUR_KEY',
  apiSecret:    'YOUR_SECRET',
  type:         'PAPER',    // or 'LIVE'
  orderType:    'DAY'       // default order type
};

const tradingAPI = AlpacaTradingAPI.getInstance(credentials);
```

---

## 1. WebSocket Streaming

```ts
tradingAPI.connectWebsocket();
// ↳ auto-authenticates & subscribes to trade_updates

tradingAPI.onTradeUpdate((update: TradeUpdate) => {
  // update.event, update.order.symbol, update.order.qty, …
});
```

---

## 2. Account & Portfolio

```ts
// Account details
const acct: AlpacaAccountDetails = await tradingAPI.getAccountDetails();

// Positions (all or filter by AssetClass)
const allPos: AlpacaPosition[]      = await tradingAPI.getPositions();
const equityPos: AlpacaPosition[]  = await tradingAPI.getPositions('us_equity');

// Portfolio history
const history = await tradingAPI.getPortfolioHistory({
  timeframe: '1D',
  period:    '1M',
  extended_hours: false,
  date_end:  '2024-07-01'
});
// → { timestamp: number[], equity: number[], profit_loss: number[], profit_loss_pct: number[], … }
```

---

## 3. Orders REST

### 3.1 Fetch & Cancel

```ts
// List orders
const orders: AlpacaOrder[] = await tradingAPI.getOrders({
  status: 'open', limit: 50, after: '…', symbols: ['AAPL']
});

// Cancel
await tradingAPI.cancelAllOrders();
await tradingAPI.cancelOrder('order-id-123');
```

### 3.2 Single-Leg Orders

```ts
// Market order
const mkt: AlpacaOrder = await tradingAPI.createMarketOrder(
  'AAPL',  10, 'buy', 'buy_to_open', /*clientOrderId?*/
);

// Limit order
const lim: AlpacaOrder = await tradingAPI.createLimitOrder(
  'TSLA', 5, 'sell',
  720.00,               // limitPrice
  'sell_to_close',
  true,                // extended_hours?
  'my-client-id'
);

// Trailing stop (percent scale-100, e.g. 0.5%)
await tradingAPI.createTrailingStop(
  'MSFT', 20, 'sell',
  0.5,                 // trailPercent100
  'sell_to_close'
);

// Trail helpers
const currentTrail: number|null = await tradingAPI.getCurrentTrailPercent('MSFT');
await tradingAPI.updateTrailingStop('MSFT', 0.75);
```

### 3.3 Bracket/OTO Equity Trade

```ts
const bracket: AlpacaOrder = await tradingAPI.createEquitiesTrade(
  { symbol: 'QQQ', qty:  10, side: 'buy', referencePrice: 400 },
  {
    type: 'limit',
    limitPrice: 401,
    useStopLoss: true,
    stopPercent100: 1.5,    // 1.5%
    useTakeProfit: true,
    takeProfitPrice: 410,
    extendedHours: false,
    clientOrderId: 'xyz'
  }
);
```

---

## 4. Batch Position Close

```ts
// Close all equity positions (cancel orders & market-close)
await tradingAPI.closeAllPositions({
  cancel_orders: true,
  useLimitOrders: false
});

// Extended-hours limit close
await tradingAPI.closeAllPositionsAfterHours();
```

---

## 5. Options Chain & Contracts

```ts
// List contracts
const chain: OptionContractsResponse = await tradingAPI.getOptionContracts({
  underlying_symbols: ['AAPL'],
  expiration_date_gte: '2024-07-01',
  limit: 500
});

// Single contract
const opt: OptionContract = await tradingAPI.getOptionContract('AAPL240719C00150000');

// Helper: all strikes on a date
const strikes: OptionContract[] = await tradingAPI.getOptionChain('AAPL', '2024-07-19');
const dates: string[]            = await tradingAPI.getOptionExpirationDates('AAPL');
```

---

## 6. Option Positions & Activities

```ts
const optPos: AlpacaPosition[] = await tradingAPI.getOptionPositions();
const acts: OptionAccountActivity[] = await tradingAPI.getOptionActivities('OPEXC', '2024-06-30');
```

---

## 7. Option Orders

### 7.1 Single & Multi-Leg

```ts
// Simple option order
const o1: AlpacaOrder = await tradingAPI.createOptionOrder(
  'AAPL240719C00150000',
  2,
  'buy',
  'buy_to_open',
  'limit',
  1.25
);

// Multi-leg (legs: OrderLeg[])
const legs: OrderLeg[] = [
  { symbol: '…C1', ratio_qty: '1', side: 'buy',  position_intent: 'buy_to_open' },
  { symbol: '…C2', ratio_qty: '1', side: 'sell', position_intent: 'sell_to_open' }
];
const mleg: AlpacaOrder = await tradingAPI.createMultiLegOptionOrder(legs, 1, 'limit', 0.50);

// Exercise & close
await tradingAPI.exerciseOption('…');
const closed: AlpacaOrder = await tradingAPI.closeOptionPosition('…', 1);

// Close all option positions + cancel orders
await tradingAPI.closeAllOptionPositions(true);
```

### 7.2 Common Strategies

```ts
const callSpread: AlpacaOrder = await tradingAPI.createLongCallSpread(
  '…C_low','…C_high',1, 0.75
);
const putSpread: AlpacaOrder  = await tradingAPI.createLongPutSpread(
  '…P_high','…P_low',1, 0.60
);
const iron: AlpacaOrder       = await tradingAPI.createIronCondor(
  '…P_low','…P_high','…C_low','…C_high',1, 0.90
);
const covered: AlpacaOrder    = await tradingAPI.createCoveredCall(
  'AAPL','…C',5, 1.10
);
const rolled: AlpacaOrder     = await tradingAPI.rollOptionPosition(
  '…old','…new',1,'buy', 0.80
);
```

---

## 8. Account Options Settings

```ts
const level: number  = await tradingAPI.getOptionsTradingLevel(); // 0–3
const enabled: boolean = await tradingAPI.isOptionsEnabled();
```