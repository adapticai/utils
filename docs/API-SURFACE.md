# @adaptic/utils - API Surface Documentation

**Generated:** 2025-12-02
**Package Version:** 0.0.380
**Target Version:** 1.0.0 (Post-Consolidation)

---

## Table of Contents

1. [Overview](#overview)
2. [Broker APIs](#broker-apis)
3. [Data Providers](#data-providers)
4. [Analytics](#analytics)
5. [Market Time Utilities](#market-time-utilities)
6. [Cache Infrastructure](#cache-infrastructure)
7. [Formatting Utilities](#formatting-utilities)
8. [General Utilities](#general-utilities)
9. [Type Definitions](#type-definitions)
10. [Deprecated APIs](#deprecated-apis)

---

## Overview

### Current Export Pattern (v0.x)

```typescript
import { adaptic } from '@adaptic/utils';

// Namespace-based access
await adaptic.alpaca.position.fetchAll(...);
const rsi = adaptic.ta.calculateRSI(data);
const status = adaptic.time.getMarketStatus();
```

### Future Export Pattern (v1.0+)

```typescript
// Subpath imports for tree-shaking
import { createBroker } from '@adaptic/utils/brokers';
import { calculateRSI } from '@adaptic/utils/analytics/technical-analysis';
import { getMarketStatus } from '@adaptic/utils/time';

const broker = createBroker({ type: 'alpaca', credentials });
const rsi = calculateRSI(data);
const status = getMarketStatus();
```

---

## Broker APIs

### Alpaca Trading API

#### Class: `AlpacaTradingAPI`

```typescript
import { AlpacaTradingAPI } from '@adaptic/utils';
// Future: import { AlpacaTradingAPI } from '@adaptic/utils/brokers/alpaca';

interface AlpacaCredentials {
  apiKey: string;
  apiSecret: string;
  paper?: boolean;
  baseUrl?: string;
}

const api = new AlpacaTradingAPI(credentials: AlpacaCredentials);
```

**Methods:**

##### Account Operations

```typescript
// Get account details
async getAccount(): Promise<AlpacaAccountDetails>

interface AlpacaAccountDetails {
  id: string;
  account_number: string;
  status: 'ONBOARDING' | 'SUBMISSION_FAILED' | 'SUBMITTED' |
          'ACCOUNT_UPDATED' | 'APPROVAL_PENDING' | 'ACTIVE' | 'REJECTED';
  currency: string;
  cash: string;
  equity: string;
  buying_power: string;
  portfolio_value: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  transfers_blocked: boolean;
  account_blocked: boolean;
  created_at: string;
  daytrade_count: number;
  initial_margin: string;
  maintenance_margin: string;
  daytrading_buying_power: string;
  regt_buying_power: string;
  options_buying_power: string;
  options_approved_level: 0 | 1 | 2 | 3;
  options_trading_level: 0 | 1 | 2;
}
```

##### Position Operations

```typescript
// Get all positions
async getPositions(): Promise<AlpacaPosition[]>

// Get specific position
async getPosition(symbol: string): Promise<AlpacaPosition | null>

// Close position
async closePosition(symbol: string, qty?: number): Promise<AlpacaOrder>

// Close all positions
async closeAllPositions(): Promise<AlpacaOrder[]>

interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  qty: string;
  qty_available: string;
  avg_entry_price: string;
  side: 'long' | 'short';
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}
```

##### Order Operations

```typescript
// Create order
async createOrder(params: CreateOrderParams): Promise<AlpacaOrder>

interface CreateOrderParams {
  symbol: string;
  qty?: number;
  notional?: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  time_in_force: 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
  trail_price?: number;
  trail_percent?: number;
  extended_hours?: boolean;
  client_order_id?: string;
  order_class?: 'simple' | 'bracket' | 'oco' | 'oto';
  take_profit?: { limit_price: number };
  stop_loss?: { stop_price: number; limit_price?: number };
}

// Create limit order (helper)
async createLimitOrder(params: LimitOrderParams): Promise<AlpacaOrder>

interface LimitOrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  limit_price: number;
  time_in_force?: 'day' | 'gtc' | 'ioc' | 'fok';
  extended_hours?: boolean;
}

// Get order
async getOrder(orderId: string): Promise<AlpacaOrder>

// Get all orders
async getOrders(params?: GetOrdersParams): Promise<AlpacaOrder[]>

interface GetOrdersParams {
  status?: 'open' | 'closed' | 'all';
  limit?: number;
  after?: string;
  until?: string;
  direction?: 'asc' | 'desc';
  nested?: boolean;
  symbols?: string;
}

// Replace order
async replaceOrder(orderId: string, params: ReplaceOrderParams): Promise<AlpacaOrder>

interface ReplaceOrderParams {
  qty?: number;
  time_in_force?: 'day' | 'gtc' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
  trail?: number;
  client_order_id?: string;
}

// Cancel order
async cancelOrder(orderId: string): Promise<void>

// Cancel all orders
async cancelAllOrders(): Promise<void>

interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  replaced_at: string | null;
  replaced_by: string | null;
  replaces: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  notional: string | null;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  order_class: string;
  order_type: string;
  type: string;
  side: 'buy' | 'sell';
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  status: 'new' | 'partially_filled' | 'filled' | 'done_for_day' |
          'canceled' | 'expired' | 'replaced' | 'pending_cancel' |
          'pending_replace' | 'accepted' | 'pending_new' | 'accepted_for_bidding' |
          'stopped' | 'rejected' | 'suspended' | 'calculated';
  extended_hours: boolean;
  legs: AlpacaOrder[] | null;
  trail_percent: string | null;
  trail_price: string | null;
  hwm: string | null;
}
```

##### Portfolio History

```typescript
// Get portfolio history
async getPortfolioHistory(params: PortfolioHistoryParams): Promise<PortfolioHistoryResponse>

interface PortfolioHistoryParams {
  period?: '1D' | '1W' | '1M' | '3M' | '6M' | '1A' | 'YTD' | 'all';
  timeframe?: '1Min' | '5Min' | '15Min' | '1H' | '1D';
  start?: string; // RFC3339 format
  end?: string; // RFC3339 format
  extended_hours?: boolean;
  intraday_reporting?: 'market_hours' | 'extended_hours' | 'continuous';
  pnl_reset?: 'per_day' | 'no_reset';
}

interface PortfolioHistoryResponse {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
  base_value: number;
  timeframe: string;
  base_value_asof?: string;
}
```

##### Asset Information

```typescript
// Get asset details
async getAsset(symbol: string): Promise<AlpacaAsset>

interface AlpacaAsset {
  id: string;
  class: string;
  exchange: string;
  symbol: string;
  name: string;
  status: 'active' | 'inactive';
  tradable: boolean;
  marginable: boolean;
  shortable: boolean;
  easy_to_borrow: boolean;
  fractionable: boolean;
  min_order_size: string | null;
  min_trade_increment: string | null;
  price_increment: string | null;
  maintenance_margin_requirement: number;
  attributes: string[];
}
```

##### Configuration

```typescript
// Get account configuration
async getConfiguration(): Promise<AccountConfiguration>

// Update account configuration
async updateConfiguration(config: Partial<AccountConfiguration>): Promise<AccountConfiguration>

interface AccountConfiguration {
  dtbp_check: 'both' | 'entry' | 'exit';
  trade_confirm_email: 'all' | 'none';
  suspend_trade: boolean;
  no_shorting: boolean;
  fractional_trading: boolean;
  max_margin_multiplier: '1' | '2' | '4';
  max_options_trading_level?: 0 | 1 | 2 | 3;
  pdt_check: 'both' | 'entry' | 'exit';
  ptp_no_exception_entry: boolean;
}
```

---

#### Class: `AlpacaMarketDataAPI`

```typescript
import { AlpacaMarketDataAPI } from '@adaptic/utils';
// Future: import { AlpacaMarketDataAPI } from '@adaptic/utils/brokers/alpaca';

// Singleton pattern
const api = AlpacaMarketDataAPI.getInstance();
```

**Methods:**

##### Quotes

```typescript
// Get latest quote
async getLatestQuote(symbol: string): Promise<AlpacaQuote>

// Get latest quotes for multiple symbols
async getLatestQuotes(symbols: string[]): Promise<Record<string, AlpacaQuote>>

interface AlpacaQuote {
  t: string; // Timestamp
  ax: string; // Ask exchange
  ap: number; // Ask price
  as: number; // Ask size
  bx: string; // Bid exchange
  bp: number; // Bid price
  bs: number; // Bid size
  c: string[]; // Conditions
  z: string; // Tape
}
```

##### Bars (OHLCV)

```typescript
// Get bars
async getBars(params: GetBarsParams): Promise<Bar[]>

interface GetBarsParams {
  symbol: string;
  timeframe: '1Min' | '5Min' | '15Min' | '30Min' | '1Hour' | '1Day' | '1Week' | '1Month';
  start: string; // RFC3339 or date string
  end?: string; // RFC3339 or date string
  limit?: number; // Max 10,000
  adjustment?: 'raw' | 'split' | 'dividend' | 'all';
  feed?: 'iex' | 'otc' | 'sip';
  sort?: 'asc' | 'desc';
}

interface Bar {
  t: string; // Timestamp
  o: number; // Open
  h: number; // High
  l: number; // Low
  c: number; // Close
  v: number; // Volume
  n: number; // Trade count
  vw: number; // Volume weighted average price
}
```

##### Trades

```typescript
// Get latest trade
async getLatestTrade(symbol: string): Promise<AlpacaTrade>

interface AlpacaTrade {
  t: string; // Timestamp
  x: string; // Exchange
  p: number; // Price
  s: number; // Size
  c: string[]; // Conditions
  i: number; // Trade ID
  z: string; // Tape
}
```

##### Snapshots

```typescript
// Get snapshot (all data in one call)
async getSnapshot(symbol: string): Promise<AlpacaSnapshot>

interface AlpacaSnapshot {
  symbol: string;
  latestTrade: AlpacaTrade;
  latestQuote: AlpacaQuote;
  minuteBar: Bar;
  dailyBar: Bar;
  prevDailyBar: Bar;
}
```

##### News

```typescript
// Get news
async getNews(params: GetNewsParams): Promise<AlpacaNews[]>

interface GetNewsParams {
  symbols?: string;
  start?: string;
  end?: string;
  limit?: number;
  sort?: 'asc' | 'desc';
  include_content?: boolean;
  exclude_contentless?: boolean;
}

interface AlpacaNews {
  id: number;
  headline: string;
  author: string;
  created_at: string;
  updated_at: string;
  summary: string;
  content?: string;
  url: string;
  images: Array<{
    size: string;
    url: string;
  }>;
  symbols: string[];
  source: string;
}
```

---

#### Legacy Functions (v0.x - Exported via `adaptic` namespace)

```typescript
import { adaptic } from '@adaptic/utils';

// Account
await adaptic.alpaca.accountDetails(props);
await adaptic.alpaca.getConfig(props);
await adaptic.alpaca.updateConfig(props, config);

// Positions
await adaptic.alpaca.position.fetch(props, symbol);
await adaptic.alpaca.position.fetchAll(props);
await adaptic.alpaca.position.close(props, symbol);
await adaptic.alpaca.position.closeAll(props);
await adaptic.alpaca.position.closeAllAfterHours(props);

// Orders
await adaptic.alpaca.orders.create(props, params);
await adaptic.alpaca.orders.createLimitOrder(props, params);
await adaptic.alpaca.orders.get(props, orderId);
await adaptic.alpaca.orders.getAll(props, params);
await adaptic.alpaca.orders.replace(props, orderId, params);
await adaptic.alpaca.orders.cancel(props, orderId);
await adaptic.alpaca.orders.cancelAll(props);

// Asset
await adaptic.alpaca.asset.get(props, symbol);

// Quote
await adaptic.alpaca.quote.getLatest(props, symbols);

// Portfolio History
await adaptic.alpaca.portfolioHistory(props);

// News
await adaptic.alpaca.news(props, params);
```

---

## Data Providers

### Polygon.io API

```typescript
import { adaptic } from '@adaptic/utils';
// Future: import * as polygon from '@adaptic/utils/data-providers/polygon';
```

#### Stock Data

```typescript
// Get ticker information
async fetchTickerInfo(ticker: string): Promise<PolygonTickerInfo>

interface PolygonTickerInfo {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  primary_exchange: string;
  type: string;
  active: boolean;
  currency_name: string;
  cik: string;
  composite_figi: string;
  share_class_figi: string;
  market_cap: number;
  phone_number: string;
  address: {
    address1: string;
    city: string;
    state: string;
    postal_code: string;
  };
  description: string;
  sic_code: string;
  sic_description: string;
  ticker_root: string;
  homepage_url: string;
  total_employees: number;
  list_date: string;
  branding: {
    logo_url: string;
    icon_url: string;
  };
  share_class_shares_outstanding: number;
  weighted_shares_outstanding: number;
}

// Get grouped daily bars (all tickers)
async fetchGroupedDaily(date: string, adjusted?: boolean): Promise<PolygonGroupedDaily>

// Get last trade
async fetchLastTrade(ticker: string): Promise<PolygonTrade>

interface PolygonTrade {
  conditions: number[];
  exchange: number;
  price: number;
  size: number;
  timestamp: number;
}

// Get historical trades
async fetchTrades(params: FetchTradesParams): Promise<PolygonTrade[]>

interface FetchTradesParams {
  ticker: string;
  timestamp?: number;
  timestampLimit?: number;
  reverse?: boolean;
  limit?: number;
}

// Get price data (aggregates/bars)
async fetchPrices(params: FetchPricesParams): Promise<PolygonPriceData[]>

interface FetchPricesParams {
  ticker: string;
  multiplier: number;
  timespan: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
  from: string;
  to: string;
  adjusted?: boolean;
  sort?: 'asc' | 'desc';
  limit?: number;
}

interface PolygonPriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  transactions?: number;
  vwap?: number;
}

// Get daily open/close
async fetchDailyOpenClose(ticker: string, date: string, adjusted?: boolean): Promise<PolygonDailyOC>

interface PolygonDailyOC {
  symbol: string;
  from: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  afterHours: number;
  preMarket: number;
}

// Get previous close
async getPreviousClose(ticker: string, adjusted?: boolean): Promise<PolygonPreviousClose>

interface PolygonPreviousClose {
  ticker: string;
  status: string;
  from: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  afterHours: number;
  preMarket: number;
}
```

#### Utilities

```typescript
// Analyze price data
function analysePolygonPriceData(data: PolygonPriceData[]): PolygonPriceAnalysis

interface PolygonPriceAnalysis {
  averagePrice: number;
  highestPrice: number;
  lowestPrice: number;
  totalVolume: number;
  priceChange: number;
  priceChangePercent: number;
}

// Format price data
function formatPriceData(data: any[]): PolygonPriceData[]
```

---

### Polygon Indices API

```typescript
import { adaptic } from '@adaptic/utils';
// Future: import * as indices from '@adaptic/utils/data-providers/polygon/indices';
```

```typescript
// Fetch index aggregates
async fetchIndicesAggregates(params: IndicesAggregatesParams): Promise<IndicesBar[]>

interface IndicesAggregatesParams {
  ticker: string; // e.g., 'I:SPX', 'I:DJI'
  multiplier: number;
  timespan: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
  from: string;
  to: string;
  adjusted?: boolean;
  sort?: 'asc' | 'desc';
  limit?: number;
}

interface IndicesBar {
  v: number; // Volume
  vw: number; // Volume weighted average
  o: number; // Open
  c: number; // Close
  h: number; // High
  l: number; // Low
  t: number; // Timestamp
  n: number; // Number of items
}

// Fetch index previous close
async fetchIndicesPreviousClose(ticker: string, adjusted?: boolean): Promise<IndicesPreviousClose>

// Fetch index daily open/close
async fetchIndicesDailyOpenClose(ticker: string, date: string, adjusted?: boolean): Promise<IndicesDailyOC>

// Fetch index snapshot
async fetchIndicesSnapshot(ticker: string): Promise<IndicesSnapshot>

interface IndicesSnapshot {
  status: string;
  value: number;
  session: {
    change: number;
    change_percent: number;
    early_trading_change: number;
    early_trading_change_percent: number;
    close: number;
    high: number;
    low: number;
    open: number;
    previous_close: number;
  };
  type: string;
  market_status: string;
  name: string;
  timeframe: string;
}

// Fetch universal snapshot (all indices)
async fetchUniversalSnapshot(tickers?: string[]): Promise<IndicesSnapshot[]>

// Format bar data
function formatIndicesBarData(data: any[]): IndicesBar[]
```

---

### AlphaVantage API

```typescript
import { adaptic } from '@adaptic/utils';
// Future: import * as alphavantage from '@adaptic/utils/data-providers/alphavantage';
```

```typescript
// Fetch quote
async fetchQuote(symbol: string): Promise<AVQuote>

interface AVQuote {
  '01. symbol': string;
  '02. open': string;
  '03. high': string;
  '04. low': string;
  '05. price': string;
  '06. volume': string;
  '07. latest trading day': string;
  '08. previous close': string;
  '09. change': string;
  '10. change percent': string;
}

// Fetch ticker news
async fetchTickerNews(ticker: string, limit?: number): Promise<AVNewsItem[]>

interface AVNewsItem {
  title: string;
  url: string;
  time_published: string;
  authors: string[];
  summary: string;
  banner_image: string;
  source: string;
  category_within_source: string;
  source_domain: string;
  topics: Array<{
    topic: string;
    relevance_score: string;
  }>;
  overall_sentiment_score: number;
  overall_sentiment_label: string;
  ticker_sentiment: Array<{
    ticker: string;
    relevance_score: string;
    ticker_sentiment_score: string;
    ticker_sentiment_label: string;
  }>;
}

// Date conversion utilities
function convertDateToYYYYMMDDTHHMM(date: Date): string
function convertYYYYMMDDTHHMMSSToDate(dateString: string): Date
```

---

### Crypto Data

```typescript
import { adaptic } from '@adaptic/utils';
// Future: import * as crypto from '@adaptic/utils/data-providers/crypto';
```

```typescript
// Fetch crypto bars
async fetchBars(params: CryptoBarsParams): Promise<CryptoBar[]>

interface CryptoBarsParams {
  symbols: string; // e.g., 'BTCUSD,ETHUSD'
  timeframe: '1Min' | '5Min' | '15Min' | '1Hour' | '1Day';
  start?: string;
  end?: string;
  limit?: number;
  exchanges?: string[];
}

interface CryptoBar {
  t: string; // Timestamp
  o: number; // Open
  h: number; // High
  l: number; // Low
  c: number; // Close
  v: number; // Volume
  vw: number; // VWAP
  n: number; // Trade count
}

// Fetch crypto news
async fetchNews(params: CryptoNewsParams): Promise<AlpacaNews[]>

interface CryptoNewsParams {
  symbols?: string;
  start?: string;
  end?: string;
  limit?: number;
  sort?: 'asc' | 'desc';
}

// Fetch latest trades
async fetchLatestTrades(symbols: string): Promise<Record<string, CryptoTrade>>

interface CryptoTrade {
  t: string; // Timestamp
  p: number; // Price
  s: number; // Size
  tks: string; // Taker side
  i: number; // Trade ID
}

// Fetch latest quotes
async fetchLatestQuotes(symbols: string): Promise<Record<string, CryptoQuote>>

interface CryptoQuote {
  t: string; // Timestamp
  bp: number; // Bid price
  bs: number; // Bid size
  ap: number; // Ask price
  as: number; // Ask size
}
```

---

## Analytics

### Performance Metrics

```typescript
import { adaptic } from '@adaptic/utils';
// Future: import * as performance from '@adaptic/utils/analytics/performance';
```

#### Comprehensive Performance Analysis

```typescript
// Fetch all performance metrics
async fetchPerformanceMetrics(props: FetchPerformanceMetricsProps): Promise<PerformanceMetrics>

interface FetchPerformanceMetricsProps {
  accountId?: string;
  client?: ApolloClient<NormalizedCacheObject>;
  alpacaAccount?: AlpacaAccount;
  period?: '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'all';
  benchmarkSymbol?: string; // Default: 'SPY'
}

interface PerformanceMetrics {
  totalReturn: string; // e.g., "15.25%"
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  alpha: number;
  beta: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  annualizedReturn: number;
  volatility: number; // Annualized
  informationRatio: number;
}
```

#### Individual Metric Calculations

```typescript
// Calculate alpha and beta
function calculateAlphaAndBeta(params: AlphaBetaParams): Promise<AlphaBetaResult>

interface AlphaBetaParams {
  portfolioHistory: PortfolioHistory;
  benchmarkBars: Bar[];
  riskFreeRate?: number; // Default: 0.02 (2%)
}

interface AlphaBetaResult {
  alpha: number;
  beta: number;
  rSquared: number;
  correlation: number;
  excessReturn: number;
}

// Calculate beta from returns
function calculateBetaFromReturns(params: BetaFromReturnsParams): CalculateBetaResult

interface BetaFromReturnsParams {
  portfolioReturns: number[];
  benchmarkReturns: number[];
}

interface CalculateBetaResult {
  beta: number;
  covariance: number;
  variance: number;
  averagePortfolioReturn: number;
  averageBenchmarkReturn: number;
}

// Calculate maximum drawdown
function calculateMaxDrawdown(equity: number[]): MaxDrawdownResult

interface MaxDrawdownResult {
  maxDrawdown: number;
  maxDrawdownPercent: number;
  peakValue: number;
  troughValue: number;
  peakDate: number; // Timestamp
  troughDate: number; // Timestamp
  recoveryDate: number | null; // Timestamp or null if not recovered
  drawdownDuration: number; // Days
  recoveryDuration: number | null; // Days or null
}

// Calculate daily returns
function calculateDailyReturns(equity: number[], timestamps: number[]): DailyReturn[]

interface DailyReturn {
  date: string; // YYYY-MM-DD
  timestamp: number;
  return: number;
  cumulativeReturn: number;
}

// Align returns by date (for benchmark comparison)
function alignReturnsByDate(params: AlignReturnsParams): AlignedReturns

interface AlignReturnsParams {
  portfolioReturns: DailyReturn[];
  benchmarkReturns: DailyReturn[];
}

interface AlignedReturns {
  dates: string[];
  portfolioReturns: number[];
  benchmarkReturns: number[];
  excessReturns: number[];
}

// Calculate information ratio
function calculateInformationRatio(params: InfoRatioParams): number

interface InfoRatioParams {
  portfolioReturns: number[];
  benchmarkReturns: number[];
}
```

---

### Technical Analysis

```typescript
import { adaptic } from '@adaptic/utils';
// Future: import * as ta from '@adaptic/utils/analytics/technical-analysis';
```

#### Moving Averages

```typescript
// Calculate EMA (Exponential Moving Average)
function calculateEMA(priceData: PolygonPriceData[], params?: EMAParams): EMAData[]

interface EMAParams {
  period?: number; // Default: 20
  period2?: number; // Optional second EMA, default: 9
}

interface EMAData {
  date: string;
  ema: number;
  ema2?: number;
  close: number;
}
```

#### Oscillators

```typescript
// Calculate MACD (Moving Average Convergence Divergence)
function calculateMACD(priceData: PolygonPriceData[], params?: MACDParams): MACDData[]

interface MACDParams {
  fastPeriod?: number; // Default: 12
  slowPeriod?: number; // Default: 26
  signalPeriod?: number; // Default: 9
}

interface MACDData {
  date: string;
  macd: number;
  signal: number;
  histogram: number;
  close: number;
}

// Calculate RSI (Relative Strength Index)
function calculateRSI(priceData: PolygonPriceData[], params?: RSIParams): RSIData[]

interface RSIParams {
  period?: number; // Default: 14
}

interface RSIData {
  date: string;
  rsi: number; // 0-100
  close: number;
}

// Calculate Stochastic Oscillator
function calculateStochasticOscillator(priceData: PolygonPriceData[], params?: StochasticParams): StochasticData[]

interface StochasticParams {
  kPeriod?: number; // Default: 14
  dPeriod?: number; // Default: 3
  smooth?: number; // Default: 3
}

interface StochasticData {
  date: string;
  k: number; // %K line (0-100)
  d: number; // %D line (0-100)
  close: number;
}
```

#### Bands and Channels

```typescript
// Calculate Bollinger Bands
function calculateBollingerBands(priceData: PolygonPriceData[], params?: BollingerBandsParams): BollingerBandsData[]

interface BollingerBandsParams {
  period?: number; // Default: 20
  standardDeviations?: number; // Default: 2
}

interface BollingerBandsData {
  date: string;
  upper: number;
  middle: number; // SMA
  lower: number;
  close: number;
  bandwidth?: number; // (upper - lower) / middle
  percentB?: number; // (close - lower) / (upper - lower)
}
```

#### Support and Resistance

```typescript
// Calculate support and resistance levels
function calculateSupportAndResistance(priceData: PolygonPriceData[], params?: SRParams): SupportResistanceData

interface SRParams {
  sensitivity?: number; // Default: 0.02 (2%)
  minTouches?: number; // Default: 2
}

interface SupportResistanceData {
  support: number[];
  resistance: number[];
  pivotPoint: number;
  r1: number; // Resistance 1
  r2: number; // Resistance 2
  r3: number; // Resistance 3
  s1: number; // Support 1
  s2: number; // Support 2
  s3: number; // Support 3
}

// Calculate Fibonacci retracement levels
function calculateFibonacciLevels(priceData: PolygonPriceData[], params?: FibonacciParams): FibonacciData

interface FibonacciParams {
  trend?: 'up' | 'down' | 'auto'; // Default: 'auto'
}

interface FibonacciData {
  high: number;
  low: number;
  levels: {
    '0.0': number;
    '0.236': number;
    '0.382': number;
    '0.5': number;
    '0.618': number;
    '0.786': number;
    '1.0': number;
  };
  extensions: {
    '1.272': number;
    '1.414': number;
    '1.618': number;
    '2.0': number;
  };
}
```

---

### Asset Allocation

```typescript
import { AssetAllocationEngine, generateOptimalAllocation, getDefaultRiskProfile } from '@adaptic/utils';
// Future: import * as allocation from '@adaptic/utils/analytics/asset-allocation';
```

#### Asset Allocation Engine

```typescript
class AssetAllocationEngine {
  constructor(config: AllocationConfig);

  // Generate optimal portfolio
  generateAllocation(params: AllocationParams): AllocationResult;

  // Calculate expected return
  calculateExpectedReturn(weights: number[], expectedReturns: number[]): number;

  // Calculate portfolio risk
  calculateRisk(weights: number[], covarianceMatrix: number[][]): number;

  // Optimize for Sharpe ratio
  optimizeSharpeRatio(params: OptimizationParams): AllocationResult;

  // Optimize for minimum variance
  optimizeMinimumVariance(params: OptimizationParams): AllocationResult;

  // Generate efficient frontier
  generateEfficientFrontier(params: FrontierParams): FrontierPoint[];
}

interface AllocationConfig {
  riskFreeRate?: number; // Default: 0.02
  optimizationMethod?: 'sharpe' | 'min_variance' | 'max_return' | 'risk_parity';
  constraints?: AllocationConstraints;
}

interface AllocationConstraints {
  minWeight?: number; // Minimum weight per asset (default: 0)
  maxWeight?: number; // Maximum weight per asset (default: 1)
  sectorLimits?: Record<string, number>; // Sector exposure limits
  assetClassLimits?: Record<string, number>; // Asset class limits
  longOnly?: boolean; // No short positions (default: true)
  sumToOne?: boolean; // Weights sum to 100% (default: true)
}

interface AllocationParams {
  assets: AssetData[];
  riskProfile?: RiskProfile;
  constraints?: AllocationConstraints;
  targetReturn?: number;
  targetRisk?: number;
}

interface AssetData {
  symbol: string;
  name: string;
  expectedReturn: number;
  volatility: number;
  correlations: Record<string, number>;
  sector?: string;
  assetClass?: string;
  currentWeight?: number;
}

interface AllocationResult {
  weights: Record<string, number>;
  expectedReturn: number;
  expectedRisk: number;
  sharpeRatio: number;
  diversificationRatio: number;
  rebalanceRecommendations: RebalanceAction[];
  metrics: {
    totalValue: number;
    targetAllocations: Record<string, number>;
    currentAllocations: Record<string, number>;
    deviations: Record<string, number>;
  };
}

interface RebalanceAction {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  currentShares: number;
  targetShares: number;
  sharesToTrade: number;
  currentValue: number;
  targetValue: number;
  valueChange: number;
}

type RiskProfile = 'conservative' | 'moderate' | 'aggressive' | 'custom';

interface FrontierPoint {
  risk: number;
  return: number;
  weights: Record<string, number>;
  sharpeRatio: number;
}
```

#### Helper Functions

```typescript
// Generate optimal allocation (convenience function)
function generateOptimalAllocation(params: AllocationParams): AllocationResult

// Get default risk profile
function getDefaultRiskProfile(profile: RiskProfile): AllocationConstraints

// Conservative: Low risk, stable returns
// Moderate: Balanced risk/return
// Aggressive: High risk, high potential return
```

---

## Market Time Utilities

```typescript
import { adaptic } from '@adaptic/utils';
// Future: import * as time from '@adaptic/utils/time';
```

### Market Time Utility Class

```typescript
class MarketTimeUtil {
  constructor(timezone?: string, intradayReporting?: IntradayReporting);

  // Check if date is a trading day
  isMarketDay(date: Date): boolean;

  // Check if time is within market hours
  isWithinMarketHours(date: Date): boolean;

  // Check if early close day
  isEarlyCloseDay(date: Date): boolean;

  // Get market open/close times
  getMarketOpenClose(date: Date): MarketOpenCloseResult;

  // Get next market day
  getNextMarketDay(date: Date): Date;

  // Get previous market day
  getPreviousMarketDay(date: Date): Date;

  // Get trading date for timestamp
  getTradingDate(timestamp: number): Date;
}

interface MarketOpenCloseResult {
  open: Date;
  close: Date;
  isEarlyClose: boolean;
  nextOpen: Date;
  previousClose: Date;
}

type IntradayReporting = 'market_hours' | 'extended_hours' | 'continuous';
```

### Market Status

```typescript
// Get current market status
function getMarketStatus(date?: Date): MarketStatus

interface MarketStatus {
  isOpen: boolean;
  status: 'open' | 'closed' | 'pre' | 'after';
  nextOpen: Date;
  nextClose: Date;
  isEarlyClose: boolean;
  timeUntilOpen?: number; // Milliseconds
  timeUntilClose?: number; // Milliseconds
  currentPhase: 'pre-market' | 'regular' | 'after-hours' | 'closed';
}
```

### Market Hours Configuration

```typescript
const MARKET_TIMES: MarketTimesConfig = {
  TIMEZONE: 'America/New_York',
  PRE: {
    START: { HOUR: 4, MINUTE: 0, MINUTES: 240 },
    END: { HOUR: 9, MINUTE: 30, MINUTES: 570 }
  },
  REGULAR: {
    START: { HOUR: 9, MINUTE: 30, MINUTES: 570 },
    END: { HOUR: 16, MINUTE: 0, MINUTES: 960 }
  },
  EXTENDED: {
    START: { HOUR: 4, MINUTE: 0, MINUTES: 240 },
    END: { HOUR: 20, MINUTE: 0, MINUTES: 1200 }
  },
  EARLY_CLOSE_BEFORE_HOLIDAY: {
    START: { HOUR: 9, MINUTE: 30, MINUTES: 570 },
    END: { HOUR: 13, MINUTE: 0, MINUTES: 780 }
  }
};
```

### Trading Day Calculations

```typescript
// Get last trading date (YYYYMMDD format)
function getLastTradingDateYYYYMMDD(date?: Date): string

// Get last full trading date
function getLastFullTradingDate(date?: Date): Date

// Get next market day
function getNextMarketDay(date?: Date): Date

// Get start and end timestamps for period
function getStartAndEndTimestamps(params: PeriodParams): { start: number; end: number }

interface PeriodParams {
  period: Period;
  intradayReporting?: IntradayReporting;
  customStart?: string;
  customEnd?: string;
}

type Period = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'YTD' | 'all';

// Get start and end dates for period
function getStartAndEndDates(params: PeriodParams): { start: Date; end: Date }

// Get date in New York timezone
function getDateInNY(timestamp: number | string | Date): Date

// Get current time in ET
function currentTimeET(): Date

// Get NY timezone
function getNYTimeZone(): string // Returns 'America/New_York'
```

### Time Utilities

```typescript
// Convert to Unix timestamp (seconds)
function toUnixTimestamp(ts: string): number

// Normalize date to YYYY-MM-DD
function normalizeDate(timestamp: number): string

// Calculate time range
function calculateTimeRange(range: '1d' | '3d' | '1w' | '1m' | '3m' | '1y'): string // Returns YYYY-MM-DD

// Calculate days left in period
function calculateDaysLeft(accountCreationDate: Date): number

// Parse ET date from AlphaVantage format
function parseETDateFromAV(dateString: string): Date

// Format to US Eastern timezone
function formatToUSEastern(date: Date, justDate?: boolean): string

// Convert Unix time to US Eastern
function unixTimetoUSEastern(timestamp: number): { date: Date; timeString: string; dateString: string }

// Time difference string
function timeDiffString(milliseconds: number): string // e.g., "2 days, 3 hours, 15 minutes"
```

### Relative Time

```typescript
// Time ago (human-readable)
function timeAgo(timestamp?: Date): string // e.g., "2 hours ago", "3 days ago"

// Get time ago (alternative format)
function getTimeAgo(dateString: string): string // e.g., "2 hrs ago", "1 day ago"

// Format date
function formatDate(dateString: string, updateDate?: boolean): string // e.g., "December 1, 2025"

// Format date to detailed string
function formatDateToString(date: Date): string // e.g., "Monday, Dec 1, 2025, at 14:30:00"
```

---

## Cache Infrastructure

```typescript
import { StampedeProtectedCache, createStampedeProtectedCache, DEFAULT_CACHE_OPTIONS } from '@adaptic/utils';
// Future: import * as cache from '@adaptic/utils/cache';
```

### Stampede-Protected Cache

```typescript
class StampedeProtectedCache<T> {
  constructor(options: StampedeProtectedCacheOptions);

  // Get value (load if missing)
  async get(key: string, loader: CacheLoader<T>, ttl?: number): Promise<T>;

  // Set value
  set(key: string, value: T, ttl?: number): void;

  // Check if key exists
  has(key: string): boolean;

  // Delete key
  delete(key: string): boolean;

  // Invalidate key (alias for delete)
  invalidate(key: string): boolean;

  // Clear all entries
  clear(): void;

  // Get statistics
  getStats(): CacheStats;

  // Get all keys
  keys(): string[];

  // Get cache size
  get size(): number;

  // Reset statistics
  resetStats(): void;
}

interface StampedeProtectedCacheOptions {
  maxSize: number; // Max entries
  defaultTtl: number; // Default TTL in ms
  staleWhileRevalidateTtl?: number; // Grace period for stale data
  minJitter?: number; // Min jitter multiplier (default: 0.9)
  maxJitter?: number; // Max jitter multiplier (default: 1.1)
  enableBackgroundRefresh?: boolean; // Enable background refresh (default: true)
  logger?: Logger; // Optional logger
}

interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

type CacheLoader<T> = (key: string) => Promise<T>;

interface CacheStats {
  totalGets: number;
  hits: number;
  misses: number;
  staleHits: number;
  hitRatio: number;
  size: number;
  maxSize: number;
  activeRefreshes: number;
  coalescedRequests: number;
  backgroundRefreshes: number;
  refreshErrors: number;
}

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  ttl: number;
  expiresAt: number;
  accessCount: number;
  lastAccessedAt: number;
  isRefreshing: boolean;
  lastError?: Error;
}

// Factory function
function createStampedeProtectedCache<T>(options: StampedeProtectedCacheOptions): StampedeProtectedCache<T>

// Default options
const DEFAULT_CACHE_OPTIONS: StampedeProtectedCacheOptions = {
  maxSize: 1000,
  defaultTtl: 60000, // 1 minute
  staleWhileRevalidateTtl: 120000, // 2 minutes
  minJitter: 0.9,
  maxJitter: 1.1,
  enableBackgroundRefresh: true,
};
```

### Usage Example

```typescript
import { createStampedeProtectedCache } from '@adaptic/utils';

const positionCache = createStampedeProtectedCache<AlpacaPosition[]>({
  maxSize: 1000,
  defaultTtl: 30000, // 30 seconds
  staleWhileRevalidateTtl: 60000, // 60 seconds grace
});

// Fetch with automatic caching
const positions = await positionCache.get(
  accountId,
  async (key) => await alpacaApi.getPositions(key)
);

// Check stats
const stats = positionCache.getStats();
console.log(`Hit ratio: ${stats.hitRatio}`);
```

---

## Formatting Utilities

```typescript
import { adaptic } from '@adaptic/utils';
// Future: import * as formatting from '@adaptic/utils/formatting';
```

### String Formatting

```typescript
// Capitalize first letter
function capitalize(str: string): string

// Format enum to human-readable
function formatEnum(value: string): string
// Example: 'STOCK_TICKER' → 'Stock Ticker'
```

### Number Formatting

```typescript
// Format as currency
function formatCurrency(value: number): string
// Example: 1234.56 → '$1,234.56'

// Format number with commas
function formatNumber(value: number): string
// Example: 1234.56 → '1,234.56'

// Format as percentage
function formatPercentage(value: number, decimalPlaces?: number): string
// Example: 0.75 → '75.00%'
```

### Date Formatting

```typescript
// Format date (from time-utils)
function formatDate(dateString: string, updateDate?: boolean): string

// Format date to string
function formatDateToString(date: Date): string

// Format for Google Sheets
function dateTimeForGS(date: Date): string
// Example: '01/12/2025 14:30:00'
```

---

## General Utilities

```typescript
import { adaptic } from '@adaptic/utils';
// Future: import * as utils from '@adaptic/utils/utils';
```

### HTTP Utilities

```typescript
// Fetch with retry logic
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries?: number,
  initialBackoff?: number
): Promise<Response>

// Features:
// - Exponential backoff (1s, 2s, 4s, max 30s)
// - Rate limit detection (429)
// - Retry-After header support
// - Auth error fast-fail (401, 403)
// - Server error retry (500, 502, 503, 504)
// - Client error no-retry (4xx except 429)
```

### Logging

```typescript
// Debug logging (respects LUMIC_DEBUG env var)
function logIfDebug(
  message: string,
  data?: unknown,
  type?: 'info' | 'warn' | 'error' | 'debug' | 'trace'
): void
```

### Validation

```typescript
// Validate Polygon API key
async function validatePolygonApiKey(apiKey: string): Promise<boolean>

// Hide API key from URL (for logging)
function hideApiKeyFromurl(url: string): string
// Example: 'https://api.polygon.io?apiKey=12341239856677'
//       → 'https://api.polygon.io?apiKey=12****77'
```

### Price Utilities

```typescript
// Round stock price
function roundStockPrice(price: number): number
// >= $1: 2 decimals, < $1: 4 decimals

// Get equity values from portfolio history
function getEquityValues(
  equityData: EquityPoint[],
  portfolioHistory?: AlpacaPortfolioHistory,
  marketTimeUtil?: MarketTimeUtil,
  period?: string
): EquityValues

interface EquityValues {
  latestEquity: number;
  initialEquity: number;
  latestTimestamp?: number;
  initialTimestamp?: number;
  baseValueAsOf?: string;
  baseValue?: number;
}

// Compute total trading fees
async function computeTotalFees(trade: Trade): Promise<number>
```

---

## Type Definitions

All types are exported from the main package and subpaths:

```typescript
import type {
  AlpacaPosition,
  AlpacaOrder,
  AlpacaAccountDetails,
  Bar,
  Quote,
  Trade
} from '@adaptic/utils';

// Or from specific modules (v1.0+)
import type { AlpacaPosition } from '@adaptic/utils/brokers/alpaca';
import type { PerformanceMetrics } from '@adaptic/utils/analytics/performance';
import type { MarketStatus } from '@adaptic/utils/time';
```

### Major Type Categories

1. **Alpaca Types** (`types/alpaca-types.ts` - 1,382 LOC)
   - Account, Position, Order, Asset, Bar, Quote, Trade
   - Configuration, Portfolio History, News

2. **Asset Allocation Types** (`types/asset-allocation-types.ts` - 473 LOC)
   - Risk Profiles, Allocation Results, Constraints, Optimization

3. **Polygon Types** (`types/polygon-types.ts` - 213 LOC)
   - Ticker Info, Aggregates, Trades, Quotes

4. **Polygon Indices Types** (`types/polygon-indices-types.ts` - 200 LOC)
   - Index Bars, Snapshots, Previous Close

5. **Technical Analysis Types** (`types/ta-types.ts` - 101 LOC)
   - EMA, MACD, RSI, Bollinger Bands, Support/Resistance

6. **AlphaVantage Types** (`types/alphavantage-types.ts` - 70 LOC)
   - Quotes, News, Market Overview

7. **Market Time Types** (`types/market-time-types.ts` - 66 LOC)
   - Periods, Market Status, Trading Hours

8. **Metrics Types** (`types/metrics-types.ts` - 36 LOC)
   - Performance Metrics, Returns, Drawdown

9. **Adaptic Backend Types** (`types/adaptic-types.ts` - 12 LOC)
   - Asset Overview, Backend Interfaces

10. **Logging Types** (`types/logging-types.ts` - 9 LOC)
    - Log Levels, Logger Interface

---

## Deprecated APIs

### v0.x APIs (To be removed in v2.0)

#### Namespace API (adaptic.*)

```typescript
// DEPRECATED: Use subpath imports instead
import { adaptic } from '@adaptic/utils';

// Will be removed in v2.0
adaptic.alpaca.*
adaptic.av.*
adaptic.crypto.*
adaptic.format.*
adaptic.metrics.*
adaptic.polygon.*
adaptic.indices.*
adaptic.price.*
adaptic.ta.*
adaptic.time.*
adaptic.utils.*
```

**Migration:**
```typescript
// Before
import { adaptic } from '@adaptic/utils';
await adaptic.alpaca.position.fetchAll(...);

// After (v1.0+)
import { createBroker } from '@adaptic/utils/brokers';
const broker = createBroker({ type: 'alpaca', credentials });
await broker.getPositions();
```

#### Factory Functions

```typescript
// DEPRECATED
createAlpacaTradingAPI(credentials)
createAlpacaMarketDataAPI()

// Use instead (v1.0+)
import { createBroker } from '@adaptic/utils/brokers';
createBroker({ type: 'alpaca', credentials })
```

#### Lumic Utils Package

```typescript
// DEPRECATED PACKAGE
import { ... } from '@adaptic/lumic-utils';

// Use instead (v1.0+)
import { ... } from '@adaptic/utils/lumic';
```

---

## Environment Variables

```bash
# Required for broker APIs
ALPACA_API_KEY=your-alpaca-key
ALPACA_API_SECRET=your-alpaca-secret

# Required for data providers
POLYGON_API_KEY=your-polygon-key
ALPHA_VANTAGE_API_KEY=your-av-key

# Optional debug logging
LUMIC_DEBUG=true

# Backend configuration (if using Adaptic backend)
BACKEND_HTTPS_URL=https://your-backend.com
NODE_ENV=production
```

---

## Usage Examples

### Complete Trading Workflow

```typescript
import { createBroker } from '@adaptic/utils/brokers';
import { getMarketStatus } from '@adaptic/utils/time';
import { calculateRSI } from '@adaptic/utils/analytics/technical-analysis';
import { createStampedeProtectedCache } from '@adaptic/utils/cache';

// Create broker client
const broker = createBroker({
  type: 'alpaca',
  credentials: {
    apiKey: process.env.ALPACA_API_KEY!,
    apiSecret: process.env.ALPACA_API_SECRET!,
    paper: true,
  }
});

// Set up caching
const positionCache = createStampedeProtectedCache({
  maxSize: 1000,
  defaultTtl: 30000, // 30 seconds
});

// Check market status
const marketStatus = getMarketStatus();
if (!marketStatus.isOpen) {
  console.log(`Market closed. Next open: ${marketStatus.nextOpen}`);
  process.exit(0);
}

// Get positions with caching
const positions = await positionCache.get(
  'positions',
  async () => await broker.getPositions()
);

console.log(`Found ${positions.length} positions`);

// Analyze with technical indicators
// (Fetch price data first from data provider)
const priceData = await fetchPriceData('AAPL');
const rsi = calculateRSI(priceData);

if (rsi[rsi.length - 1].rsi < 30) {
  console.log('RSI oversold - consider buying');

  // Place order
  const order = await broker.createOrder({
    symbol: 'AAPL',
    qty: 10,
    side: 'buy',
    type: 'market',
    time_in_force: 'day',
  });

  console.log(`Order placed: ${order.id}`);
}
```

---

**End of API Surface Documentation**
