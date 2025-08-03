# AlpacaMarketDataAPI Documentation

Last updated: 2025-07-07

```ts
import { marketDataAPI } from '@/src/alpaca-market-data-api';
```

---

## Configuration

```ts
marketDataAPI.setMode(mode: 'sandbox' | 'test' | 'production');
const current = marketDataAPI.getMode(); // 'sandbox'|'test'|'production'
```

---

## REST Endpoints

### 1. Historical Bars

```ts
interface HistoricalBarsParams {
  symbols: string[];           // e.g. ['AAPL','MSFT']
  timeframe: TimeFrame;        // '1Min'|'5Min'|'1Hour'|'1Day'|…
  start?: string;              // ISO timestamp
  end?: string;                // ISO timestamp
  limit?: number;              // 1–10000
  page_token?: string;         // pagination
  sort?: 'asc'|'desc';         // default 'asc'
}

interface HistoricalBarsResponse {
  bars: Record<string, Bar[]>; // symbol→Bar[]
  next_page_token: string|null;
  currency: string;            // e.g. 'USD'
}

const resp = await marketDataAPI.getHistoricalBars({
  symbols: ['AAPL'],
  timeframe: '1Hour',
  start: '2024-01-01T00:00:00Z',
  end:   '2024-01-02T00:00:00Z',
});
```

---

### 2. Latest Bars

```ts
// symbols: string[],
// currency?: string
interface LatestBarsResponse {
  bars: Record<string, Bar>;   // symbol→Bar
  currency: string;
}

const latest = await marketDataAPI.getLatestBars(['AAPL','MSFT']);
```

---

### 3. Last Trade

```ts
// symbol: string
interface LastTradeResponse {
  status: string;
  symbol: string;
  last: {
    price: number; size: number; exchange: number;
    cond1: number; cond2: number; cond3: number; cond4: number;
    timestamp: number;
  };
}

const lastTrade = await marketDataAPI.getLastTrade('AAPL');
```

---

### 4. Latest Trades & Quotes

```ts
// getLatestTrades(symbols: string[], feed?: DataFeed, currency?: string)
interface LatestTradesResponse {
  trades: Record<string, AlpacaTrade>;
  currency: string;
}

const trades = await marketDataAPI.getLatestTrades(['AAPL']);

// getLatestQuotes(symbols: string[], feed?: DataFeed, currency?: string)
interface LatestQuotesResponse {
  quotes: Record<string, Quote>;
  currency: string;
}

const quotes = await marketDataAPI.getLatestQuotes(['AAPL']);
```

---

### 5. Single Latest Quote

```ts
// symbol: string, feed?: DataFeed, currency?: string
Promise<{ quote: Quote; symbol: string; currency: string }>
const single = await marketDataAPI.getLatestQuote('AAPL');
```

---

### 6. Convenience Price Fetchers

```ts
getPreviousClose(symbol: string, referenceDate?: Date): Promise<Bar|null>
getHourlyPrices(symbol: string, start: number, end: number): Promise<Bar[]>
getHalfHourlyPrices(symbol: string, start: number, end: number): Promise<Bar[]>
getDailyPrices(symbol: string, start: number, end: number): Promise<Bar[]>
getIntradayPrices(symbol: string, minutePeriod: number, start: number, end: number): Promise<Bar[]>
```

---

### 7. Static Analyzer

```ts
// bars: Bar[]
static analyzeBars(bars): string
// → e.g. "Price: $100.00 -> $105.00 (5.00%), Volume: …"
```

---

## Asset Endpoints

```ts
getAssets(params?: { status?: string; asset_class?: string; }): Promise<AlpacaAsset[]>
getAsset(symbolOrAssetId: string): Promise<AlpacaAsset>
```

---

## Options Market Data

```ts
// getOptionsChain(params: OptionsChainParams): Promise<OptionsChainResponse>
// getLatestOptionsTrades(params: LatestOptionsTradesParams): Promise<LatestOptionsTradesResponse>
// getLatestOptionsQuotes(params: LatestOptionsQuotesParams): Promise<LatestOptionsQuotesResponse>
// getHistoricalOptionsBars(params: HistoricalOptionsBarsParams): Promise<HistoricalOptionsBarsResponse>
// getHistoricalOptionsTrades(params: HistoricalOptionsTradesParams): Promise<HistoricalOptionsTradesResponse>
// getOptionsSnapshot(params: OptionsSnapshotsParams): Promise<OptionsSnapshotsResponse>
// getOptionsConditionCodes(tickType: OptionTickType): Promise<OptionsConditionCodesResponse>
// getOptionsExchangeCodes(): Promise<OptionsExchangeCodesResponse>

// Static helpers:
static analyzeOptionBars(bars: OptionBar[]): string
static formatOptionGreeks(greeks: any): string
static interpretConditionCodes(codes: string[], map: OptionsConditionCodesResponse): string
static getExchangeName(code: string, map: OptionsExchangeCodesResponse): string
```

---

## News

```ts
// symbol: string, params?: { start?: Date|string; end?: Date|string; limit?: number; sort?: 'asc'|'desc'; include_content?: boolean; }
Promise<SimpleNews[]>
const news = await marketDataAPI.fetchNews('AAPL', { limit: 5 });
```

---

## WebSocket Streaming

```ts
connectStockStream(): void
connectOptionStream(): void
disconnectStockStream(): void
disconnectOptionStream(): void

subscribe(
  streamType: 'stock'|'option',
  subscriptions: { trades?: string[]; quotes?: string[]; bars?: string[] }
): void

unsubscribe(streamType, { trades, quotes, bars }): void
```

### Events

```ts
type StockEvent = 'stock-trade' | 'stock-quote' | 'stock-bar' | 'stock-data';
type OptionEvent = 'option-trade' | 'option-quote' | 'option-bar' | 'option-data';

marketDataAPI.on('stock-trade', (msg: AlpacaStockStreamMessage) => { /*…*/ });
marketDataAPI.subscribe('stock', { trades: ['AAPL'] });
marketDataAPI.connectStockStream();
```

---

Keep this sheet as your quick reference for method signatures, input types, and return types when integrating or generating code against Alpaca Market Data.