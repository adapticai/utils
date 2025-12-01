// src/types/alpaca-types.ts

import { ApolloClientType, NormalizedCacheObject } from '@adaptic/backend-legacy';
import { types } from '@adaptic/backend-legacy';

/**
 * Represents the authentication details for Alpaca.
 */
export interface AlpacaAuth {
  adapticAccountId?: string; // Optional account ID for Adaptic
  alpacaApiKey?: string; // API key for Alpaca
  alpacaApiSecret?: string; // API secret for Alpaca
  type?: 'PAPER' | 'LIVE'; // Type of Alpaca account
}

/**
 * Options for fetching Alpaca account details.
 */
export interface AlpacaAccountGetOptions {
  accountId?: string; // Optional account ID
  client?: ApolloClientType<NormalizedCacheObject>; // Apollo client instance
  alpacaAccount?: types.AlpacaAccount; // Optional Alpaca account object
}

/**
 * Represents the configuration of an Alpaca account.
 */

export interface AllocationConfig {
  stocks?: number;
  options?: number;
  futures?: number;
  etfs?: number;
  forex?: number;
  crypto?: number;
}

export interface AccountConfiguration {
  // Account Status Fields
  marketOpen?: boolean;
  realTime?: boolean;
  suspend_trade: boolean;

  // Trade Parameters
  tradeAllocationPct?: number;
  minPercentageChange?: number;
  volumeThreshold?: number;

  // Crypto Trading Fields
  cryptoTradingEnabled?: boolean;
  cryptoTradingPairs?: string[];
  cryptoTradeAllocationPct?: number;

  // Allocation Strategy
  autoAllocation?: boolean;
  allocation?: AllocationConfig;

  // Regulatory & Safety Settings
  dtbp_check: 'both' | 'entry' | 'exit';
  trade_confirm_email: 'all' | 'none';
  no_shorting: boolean;
  fractional_trading: boolean;
  max_margin_multiplier: '1' | '2' | '4';
  max_options_trading_level?: 0 | 1 | 2 | 3;
  pdt_check: 'both' | 'entry' | 'exit';
  ptp_no_exception_entry: boolean;

  // Portfolio Protection
  enablePortfolioTrailingStop?: boolean;
  portfolioTrailPercent?: number;
  portfolioProfitThresholdPercent?: number;
  reducedPortfolioTrailPercent?: number;

  // Position Trailing Stop Service Fields
  defaultTrailingStopPercentage100?: number;
  firstTrailReductionThreshold100?: number;
  secondTrailReductionThreshold100?: number;
  firstReducedTrailPercentage100?: number;
  secondReducedTrailPercentage100?: number;
  minimumPriceChangePercent100?: number;
}

/**
 * Represents a single bar of market data.
 */
export interface Bar {
  t: string; // Timestamp in RFC-3339 format
  o: number; // Open price
  h: number; // High price
  l: number; // Low price
  c: number; // Close price
  v: number; // Volume
  n: number; // Number of trades
  vw: number; // Volume weighted price
}

/**
 * Represents the history of a portfolio.
 */
export interface PortfolioHistory {
  equity: number[]; // Array of equity values
  timestamp: number[]; // Array of timestamps
}

/**
 * Represents a single benchmark bar.
 */
export interface BenchmarkBar {
  t: number; // Timestamp
  c: number; // Close price
}

/**
 * Result of the beta calculation.
 */
export interface CalculateBetaResult {
  beta: number; // Beta value
  covariance: number; // Covariance value
  variance: number; // Variance value
  averagePortfolioReturn: number; // Average portfolio return
  averageBenchmarkReturn: number; // Average benchmark return
}

/**
 * Represents a position in the portfolio.
 */
export type AlpacaPosition = {
  asset_id: string; // Asset ID
  symbol: string; // Asset symbol
  exchange: string; // Exchange where the asset is traded
  asset_class: string; // Class of the asset
  asset_marginable: boolean; // Indicates if the asset is marginable
  qty: string; // Quantity of the asset
  qty_available: string; // Available quantity of the asset
  avg_entry_price: string; // Average entry price of the position
  side: 'long' | 'short'; // Position side
  market_value: string; // Market value of the position
  cost_basis: string; // Cost basis of the position
  unrealized_pl: string; // Unrealized profit/loss
  unrealized_plpc: string; // Unrealized profit/loss percentage
  unrealized_intraday_pl: string; // Unrealized intraday profit/loss
  unrealized_intraday_plpc: string; // Unrealized intraday profit/loss percentage
  current_price: string; // Current price of the asset
  lastday_price: string; // Last day's price of the asset
  change_today: string; // Change today
};

// Order Types
export type OrderSide = 'buy' | 'sell';

/**
 * Represents the type of order.
 */
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';

/**
 * Represents the time in force for an order.
 */
export type TimeInForce = 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';

/**
 * Represents the class of an order.
 */
export type OrderClass = 'simple' | 'oco' | 'oto' | 'bracket' | 'mleg';

/**
 * Represents the status of an order.
 */
export type OrderStatus =
  | 'new'
  | 'partially_filled'
  | 'filled'
  | 'done_for_day'
  | 'canceled'
  | 'expired'
  | 'replaced'
  | 'pending_cancel'
  | 'pending_replace'
  | 'accepted'
  | 'pending_new'
  | 'accepted_for_bidding'
  | 'stopped'
  | 'rejected'
  | 'suspended'
  | 'calculated';

/**
 * Represents the class of an asset.
 */
export type AssetClass = 'us_equity' | 'us_option' | 'crypto';

/**
 * Represents the intent of a position.
 */
export type PositionIntent = 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';

/**
 * Parameters for take profit orders.
 */
export interface TakeProfitParams {
  limit_price: string; // Limit price for take profit
  stop_price?: string; // Optional stop price
  order_class?: OrderClass; // Optional order class
}

/**
 * Parameters for stop loss orders.
 */
export interface StopLossParams {
  stop_price: string; // Stop price for stop loss
  limit_price?: string; // Optional limit price
  order_class?: OrderClass; // Optional order class
}

/**
 * Parameters for creating an order.
 */
export interface CreateOrderParams {
  symbol: string; // Symbol of the asset
  qty?: string; // Optional quantity
  notional?: string; // Optional notional value
  side: OrderSide; // Side of the order
  type: OrderType; // Type of the order
  time_in_force: TimeInForce; // Time in force for the order
  limit_price?: string; // Optional limit price
  stop_price?: string; // Optional stop price
  trail_price?: string; // Optional trailing price
  trail_percent?: string; // Optional trailing percentage
  extended_hours?: boolean; // Optional extended hours trading
  client_order_id?: string; // Optional client order ID
  order_class?: OrderClass; // Optional order class
  take_profit?: TakeProfitParams; // Optional take profit parameters
  stop_loss?: StopLossParams; // Optional stop loss parameters
  position_intent?: PositionIntent; // Optional position intent
  legs?: OrderLeg[]; // Optional legs for multi-leg orders
}
export interface CreateMultiLegOrderParams {
  order_class: 'mleg'; // Must be 'mleg' for multi-leg orders
  qty: string; // Quantity of the multi-leg order
  type: OrderType; // Type of the order (market or limit)
  limit_price?: string; // Optional limit price for limit orders
  time_in_force: TimeInForce; // Time in force for the order
  legs: Array<{
    symbol: string; // Option contract symbol
    ratio_qty: string; // Ratio quantity for this leg (must be in simplest form)
    side: OrderSide; // Side of the order (buy or sell)
    position_intent: PositionIntent; // Position intent (buy_to_open, buy_to_close, etc.)
  }>;
}

/**
 * Parameters for getting orders.
 */
export interface GetOrdersParams {
  status?: 'open' | 'closed' | 'all'; // Status of the orders
  limit?: number; // Optional limit on the number of orders
  after?: string; // Optional date to filter orders after
  until?: string; // Optional date to filter orders until
  direction?: 'asc' | 'desc'; // Optional direction for sorting
  nested?: boolean; // Optional nested parameter
  symbols?: string[]; // Optional symbols to filter orders
  side?: OrderSide; // Optional side to filter orders
}

/**
 * Parameters for replacing an order.
 */
export interface ReplaceOrderParams {
  qty?: string; // Optional quantity
  time_in_force?: TimeInForce; // Optional time in force of order
  limit_price?: string; // Optional limit price
  stop_price?: string; // Optional stop price
  trail?: string; // Optional trailing price or percent
  client_order_id?: string; // Optional client order ID
}

/**
 * Represents an order.
 */
export type AlpacaOrder = {
  id: string; // Order ID
  client_order_id: string; // Client order ID
  created_at: string; // Creation timestamp
  updated_at: string | null; // Update timestamp
  submitted_at: string | null; // Submission timestamp
  filled_at: string | null; // Filled timestamp
  expired_at: string | null; // Expiration timestamp
  canceled_at: string | null; // Cancellation timestamp
  failed_at: string | null; // Failure timestamp
  replaced_at: string | null; // Replacement timestamp
  replaced_by: string | null; // ID of the order that replaced this order
  replaces: string | null; // ID of the order this order replaces
  asset_id: string; // Asset ID
  symbol: string; // Asset symbol
  asset_class: AssetClass; // Class of the asset
  notional: string | null; // Notional value of the order
  qty: string | null; // Quantity of the order
  filled_qty: string; // Filled quantity
  filled_avg_price: string | null; // Average filled price
  order_class: OrderClass; // Class of the order
  type: OrderType; // Type of the order
  side: OrderSide; // Side of the order
  time_in_force: TimeInForce; // Time in force for the order
  limit_price: string | null; // Limit price
  stop_price: string | null; // Stop price
  trail_price: string | null; // Trailing price
  trail_percent: string | null; // Trailing percentage
  hwm: string | null; // High water mark
  position_intent: PositionIntent | null; // Intent of the position
  status: OrderStatus; // Status of the order
  extended_hours: boolean; // Indicates if extended hours trading is allowed
  legs: AlpacaOrder[] | null; // Optional legs for multi-leg orders
};

// Crypto Types
export type CryptoTimeframe =
  | `${number}Min`
  | `${number}T` // 1-59 minutes
  | `${number}Hour`
  | `${number}H` // 1-23 hours
  | '1Day'
  | '1D'
  | '1Week'
  | '1W'
  | `${1 | 2 | 3 | 4 | 6 | 12}Month`
  | `${1 | 2 | 3 | 4 | 6 | 12}M`;

/**
 * Represents a single bar of cryptocurrency market data.
 */
export interface CryptoBar {
  t: Date; // Timestamp as Date object
  o: number; // Open price
  h: number; // High price
  l: number; // Low price
  c: number; // Close price
  v: number; // Volume
  n: number; // Number of trades
  vw: number; // Volume weighted price
}

/**
 * Parameters for fetching cryptocurrency bars.
 */
export interface CryptoBarsParams {
  symbols: CryptoPair[]; // Array of cryptocurrency pairs
  timeframe: CryptoTimeframe; // Timeframe for the bars
  start?: Date; // Start date for fetching bars
  end?: Date; // End date for fetching bars
  limit?: number; // Maximum number of bars to return
  page_token?: string; // Token for pagination
  sort?: 'asc' | 'desc'; // Sorting order
}

export type TimeFrame = '1Min' | '5Min' | '15Min' | '30Min' | '1Hour' | '2Hour' | '4Hour' | '1Day' | '1Week' | '1Month';

/**
 * Response structure for fetching cryptocurrency bars.
 */
export interface CryptoBarsResponse {
  bars: {
    [symbol: string]: CryptoBar[]; // Bars for each cryptocurrency symbol
  };
  next_page_token?: string; // Token for the next page of results
}

// Supported trading pairs
export type BTCPairs = 'BCH/BTC' | 'ETH/BTC' | 'LTC/BTC' | 'UNI/BTC';
export type USDTPairs =
  | 'AAVE/USDT'
  | 'BCH/USDT'
  | 'BTC/USDT'
  | 'DOGE/USDT'
  | 'ETH/USDT'
  | 'LINK/USDT'
  | 'LTC/USDT'
  | 'SUSHI/USDT'
  | 'UNI/USDT'
  | 'YFI/USDT';
export type USDCPairs =
  | 'AAVE/USDC'
  | 'AVAX/USDC'
  | 'BAT/USDC'
  | 'BCH/USDC'
  | 'BTC/USDC'
  | 'CRV/USDC'
  | 'DOGE/USDC'
  | 'DOT/USDC'
  | 'ETH/USDC'
  | 'GRT/USDC'
  | 'LINK/USDC'
  | 'LTC/USDC'
  | 'MKR/USDC'
  | 'SHIB/USDC'
  | 'SUSHI/USDC'
  | 'UNI/USDC'
  | 'XTZ/USDC'
  | 'YFI/USDC';
export type USDPairs =
  | 'AAVE/USD'
  | 'AVAX/USD'
  | 'BAT/USD'
  | 'BCH/USD'
  | 'BTC/USD'
  | 'CRV/USD'
  | 'DOGE/USD'
  | 'DOT/USD'
  | 'ETH/USD'
  | 'GRT/USD'
  | 'LINK/USD'
  | 'LTC/USD'
  | 'MKR/USD'
  | 'SHIB/USD'
  | 'SUSHI/USD'
  | 'UNI/USD'
  | 'USDC/USD'
  | 'USDT/USD'
  | 'XTZ/USD'
  | 'YFI/USD';

/**
 * Represents a cryptocurrency trading pair.
 */
export type CryptoPair = BTCPairs | USDTPairs | USDCPairs | USDPairs;

/**
 * Represents an image associated with a news article.
 */
export interface NewsImage {
  size: 'large' | 'small' | 'thumb'; // Size of the image
  url: string; // URL of the image
}

/**
 * Represents a news article from Alpaca.
 */
export interface AlpacaNewsArticle {
  id: number; // Article ID
  author: string; // Author of the article
  content: string; // Content of the article
  created_at: string; // Creation timestamp
  updated_at: string; // Update timestamp
  headline: string; // Headline of the article
  source: string; // Source of the article
  summary: string; // Summary of the article
  url: string; // URL to the full article
  symbols: string[]; // Associated symbols
  images: NewsImage[]; // Associated images
}

/**
 * Represents the response structure for fetching news articles.
 */
export interface NewsResponse {
  news: AlpacaNewsArticle[]; // Array of news articles
  next_page_token?: string; // Token for the next page of results
}

/**
 * Represents a simplified news article.
 */
export interface SimpleNews {
  symbols: string | string[];
  title: string;
  summary: string;
  content?: string;
  url: string;
  source: string;
  author: string;
  date: string | Date;
  updatedDate: string | Date;
  sentiment: number;
}

/**
 * Parameters for fetching portfolio history.
 */
export interface PortfolioHistoryParams {
  period?: string; // Format: number + unit (e.g., '1D', '1W', '1M', '1A')
  timeframe?: '1Min' | '5Min' | '15Min' | '1H' | '1D'; // Timeframe for the data
  intraday_reporting?: 'market_hours' | 'extended_hours' | 'continuous'; // Reporting mode
  start?: string; // Start date in RFC3339 format
  end?: string; // End date in RFC3339 format
  date_end?: string; // End date in YYYY-MM-DD format (deprecated)
  extended_hours?: boolean; // Extended hours trading (deprecated)
  pnl_reset?: 'per_day' | 'no_reset'; // PnL reset option
  cashflow_types?: string; // Cashflow types to include
}

/**
 * Parameters for fetching portfolio history.
 */
export interface FetchPortfolioHistoryProps {
  params: PortfolioHistoryParams; // Parameters for fetching portfolio history
  accountId?: string; // Optional account ID
  client?: ApolloClientType<NormalizedCacheObject>; // Apollo client instance
  alpacaAccount?: types.AlpacaAccount; // Optional Alpaca account object
}

/**
 * Response structure for fetching portfolio history.
 */
export interface PortfolioHistoryResponse {
  timestamp: number[]; // Array of timestamps in UNIX epoch format
  equity: number[]; // Array of equity values
  profit_loss: number[]; // Array of profit/loss values
  profit_loss_pct: number[]; // Array of profit/loss percentages
  base_value: number; // Base value of the portfolio
  base_value_asof?: string; // Date of the base value
}

/**
 * Parameters for fetching account details.
 */
export interface FetchAccountDetailsProps {
  accountId?: string; // Optional account ID
  client?: ApolloClientType<NormalizedCacheObject>; // Apollo client instance
  alpacaAccount?: types.AlpacaAccount; // Optional Alpaca account object
}

/**
 * Represents the details of an Alpaca account.
 */
export interface AlpacaAccountDetails {
  id: string; // Account ID
  account_number: string; // Account number
  status:
    | 'ONBOARDING'
    | 'SUBMISSION_FAILED'
    | 'SUBMITTED'
    | 'ACCOUNT_UPDATED'
    | 'APPROVAL_PENDING'
    | 'ACTIVE'
    | 'REJECTED'; // Account status
  currency: string; // Currency of the account
  cash: string; // Cash balance
  portfolio_value: string; // Deprecated, equivalent to equity
  non_marginable_buying_power: string; // Non-marginable buying power
  accrued_fees: string; // Accrued fees
  pending_transfer_in: string; // Pending transfer in amount
  pending_transfer_out: string; // Pending transfer out amount
  pattern_day_trader: boolean; // Indicates if the account is a pattern day trader
  trade_suspended_by_user: boolean; // Indicates if trading is suspended by the user
  trading_blocked: boolean; // Indicates if trading is blocked
  transfers_blocked: boolean; // Indicates if transfers are blocked
  account_blocked: boolean; // Indicates if the account is blocked
  created_at: string; // Creation timestamp
  shorting_enabled: boolean; // Indicates if shorting is enabled
  long_market_value: string; // Long market value
  short_market_value: string; // Short market value
  equity: string; // Equity value
  last_equity: string; // Last equity value
  multiplier: '1' | '2' | '4'; // Margin multiplier
  buying_power: string; // Buying power
  initial_margin: string; // Initial margin
  maintenance_margin: string; // Maintenance margin
  sma: string; // SMA value
  daytrade_count: number; // Day trade count
  balance_asof: string; // Balance as of date
  last_maintenance_margin: string; // Last maintenance margin
  daytrading_buying_power: string; // Day trading buying power
  regt_buying_power: string; // Reg T buying power
  options_buying_power: string; // Options buying power
  options_approved_level: 0 | 1 | 2 | 3; // Options approved level
  options_trading_level: 0 | 1 | 2 | 3; // Options trading level
  intraday_adjustments: string; // Intraday adjustments
  pending_reg_taf_fees: string; // Pending Reg TAF fees
}

/**
 * Represents an asset in Alpaca.
 */
export interface AlpacaAsset {
  id: string; // Asset ID
  class: 'us_equity' | 'us_option' | 'crypto'; // Class of the asset
  exchange: string; // Exchange where the asset is traded
  symbol: string; // Symbol of the asset
  name: string; // Name of the asset
  status: 'active' | 'inactive'; // Status of the asset
  tradable: boolean; // Indicates if the asset is tradable
  marginable: boolean; // Indicates if the asset is marginable
  shortable: boolean; // Indicates if the asset is shortable
  easy_to_borrow: boolean; // Indicates if the asset is easy to borrow
  fractionable: boolean; // Indicates if the asset is fractionable
  maintenance_margin_requirement?: number; // Deprecated: Maintenance margin requirement
  margin_requirement_long?: string; // Margin requirement for long positions
  margin_requirement_short?: string; // Margin requirement for short positions
  attributes?: string[]; // Unique characteristics of the asset
}

/**
 * Parameters for getting an asset.
 */
export interface GetAssetParams {
  symbolOrAssetId: string; // Symbol or asset ID to retrieve
}

export type DataFeed = 'sip' | 'iex' | 'delayed_sip';

export interface AlpacaQuote {
  t: string; // RFC-3339 timestamp with nanoseconds
  ap: number; // Ask price
  as: number; // Ask size
  ax: string; // Ask exchange
  bp: number; // Bid price
  bs: number; // Bid size
  bx: string; // Bid exchange
  c: string[]; // Quote conditions
  z: string; // Tape (market center)
}

export interface AlpacaTrade {
  t: string; // RFC-3339 timestamp with nanoseconds
  p: number; // Trade price
  s: number; // Trade size (quantity)
  x: string; // Exchange where trade occurred
  i: number; // Trade ID
  z: string; // Tape (market center)
  c: string[]; // Trade conditions
}

/**
 * Response from latest trades endpoint
 * Contains the most recent trade for each requested symbol
 */
export interface LatestTradesResponse {
  /**
   * Map of symbol to latest trade data
   * Each trade contains price, size, exchange, and conditions
   */
  trades: {
    [symbol: string]: AlpacaTrade;
  };
  /** Currency of the price data in ISO 4217 format */
  currency: string;
}

/**
 * Response from latest quotes endpoint
 * Contains the most recent bid/ask quotes for each requested symbol
 */
export interface LatestQuotesResponse {
  /**
   * Map of symbol to latest quote data
   * Each quote contains bid/ask prices, sizes, and exchange information
   */
  quotes: {
    [symbol: string]: AlpacaQuote;
  };
  /** Currency of the price data in ISO 4217 format */
  currency: string;
}

// Options Market Data Types

// Options Trading Level
export type OptionsTradingLevel = 0 | 1 | 2 | 3;

// Option Contract Type
export type OptionType = 'call' | 'put';

// Option Style
export type OptionStyle = 'american' | 'european';

// Option Contract
export interface OptionContract {
  id: string;
  symbol: string;
  name: string;
  status: 'active' | 'inactive';
  tradable: boolean;
  expiration_date: string;
  root_symbol: string;
  underlying_symbol: string;
  underlying_asset_id: string;
  type: OptionType;
  style: OptionStyle;
  strike_price: string;
  size: string;
  open_interest?: string;
  open_interest_date?: string;
  close_price?: string;
  close_price_date?: string;
}

// Parameters for fetching option contracts
export interface GetOptionContractsParams {
  underlying_symbols: string[];
  expiration_date_gte?: string;
  expiration_date_lte?: string;
  strike_price_gte?: string;
  strike_price_lte?: string;
  type?: OptionType;
  status?: 'active' | 'inactive';
  limit?: number;
  page_token?: string;
}

// Response for option contracts
export interface OptionContractsResponse {
  option_contracts: OptionContract[];
  page_token?: string;
  limit: number;
}

// Multi-leg order leg
export interface OrderLeg {
  symbol: string;
  ratio_qty: string;
  side: 'buy' | 'sell';
  position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
}

// Option Greeks
export interface OptionGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
}

// Option Trade
export interface OptionTrade {
  t: string; // RFC-3339 timestamp with nanoseconds
  p: number; // Trade price
  s: number; // Trade size (quantity)
  x: string; // Exchange where trade occurred
  i: number; // Trade ID
  c: string[]; // Trade conditions
}

// Option Quote
export interface OptionQuote {
  t: string; // RFC-3339 timestamp with nanoseconds
  ap: number; // Ask price
  as: number; // Ask size
  ax: string; // Ask exchange
  bp: number; // Bid price
  bs: number; // Bid size
  bx: string; // Bid exchange
  c: string[]; // Quote conditions
}

// Option Bar (OHLCV data for options)
export interface OptionBar {
  t: string; // RFC-3339 timestamp
  o: number; // Open price
  h: number; // High price
  l: number; // Low price
  c: number; // Close price
  v: number; // Volume
  n: number; // Number of trades
  vw: number; // Volume-weighted average price
}

// Option Snapshot (combines latest trade, quote, and greeks)
export interface OptionSnapshot {
  latestTrade?: OptionTrade;
  latestQuote?: OptionQuote;
  greeks?: OptionGreeks;
  impliedVolatility?: number;
  openInterest?: number;
}

// Options Chain Response
export interface OptionsChainResponse {
  snapshots: {
    [symbol: string]: OptionSnapshot;
  };
  next_page_token?: string;
}

// Latest Options Trades Response
export interface LatestOptionsTradesResponse {
  trades: {
    [symbol: string]: OptionTrade;
  };
  next_page_token?: string;
}

// Latest Options Quotes Response
export interface LatestOptionsQuotesResponse {
  quotes: {
    [symbol: string]: OptionQuote;
  };
  next_page_token?: string;
}

// Historical Options Bars Response
export interface HistoricalOptionsBarsResponse {
  bars: {
    [symbol: string]: OptionBar[];
  };
  next_page_token?: string;
}

// Historical Options Trades Response
export interface HistoricalOptionsTradesResponse {
  trades: {
    [symbol: string]: OptionTrade[];
  };
  next_page_token?: string;
}

// Options Snapshots Response
export interface OptionsSnapshotsResponse {
  snapshots: {
    [symbol: string]: OptionSnapshot;
  };
  next_page_token?: string;
}

// Parameters for options chain request
export interface OptionsChainParams {
  /** The underlying symbol for the options chain */
  underlying_symbol: string;
  /**
   * The source feed of the data. opra is the official OPRA feed, indicative is a free indicative feed
   * where trades are delayed and quotes are modified. Default: opra if the user has a subscription, otherwise indicative.
   */
  feed?: 'opra' | 'indicative';
  /**
   * Number of maximum snapshots to return in a response (1 to 1000)
   * The limit applies to the total number of data points, not the number per symbol!
   * Use next_page_token to fetch the next set of responses.
   */
  limit?: number;
  /**
   * Filter to snapshots that were updated since this timestamp, meaning that the timestamp
   * of the trade or the quote is greater than or equal to this value.
   * Format: RFC-3339 or YYYY-MM-DD. If missing, all values are returned.
   */
  updated_since?: string;
  /**
   * The pagination token from which to continue. The value to pass here is returned in specific
   * requests when more data is available, usually because of a response result limit.
   */
  page_token?: string;
  /** Filter contracts by the type (call or put) */
  type?: OptionType;
  /** Filter contracts with strike price greater than or equal to the specified value */
  strike_price_gte?: number;
  /** Filter contracts with strike price less than or equal to the specified value */
  strike_price_lte?: number;
  /** Filter contracts by the exact expiration date (format: YYYY-MM-DD) */
  expiration_date?: string;
  /** Filter contracts with expiration date greater than or equal to the specified date */
  expiration_date_gte?: string;
  /** Filter contracts with expiration date less than or equal to the specified date */
  expiration_date_lte?: string;
  /** Filter contracts by the root symbol */
  root_symbol?: string;
}

// Parameters for latest options trades request
export interface LatestOptionsTradesParams {
  /** Comma-separated list of option contract symbols */
  symbols: string[];
  /** Number of results to return (not supported by this endpoint) */
  limit?: number;
  /** Pagination token for next page (not supported by this endpoint) */
  page_token?: string;
}

// Parameters for latest options quotes request
export interface LatestOptionsQuotesParams {
  /** Comma-separated list of option contract symbols */
  symbols: string[];
  /** Number of results to return (not supported by this endpoint) */
  limit?: number;
  /** Pagination token for next page (not supported by this endpoint) */
  page_token?: string;
}

// Parameters for historical options bars request
export interface HistoricalOptionsBarsParams {
  /** Comma-separated list of option contract symbols */
  symbols: string[];
  /**
   * Bar duration/timeframe
   * Format: [1-59]Min/T, [1-23]Hour/H, 1Day/D, 1Week/W, [1,2,3,4,6,12]Month/M
   * Examples: "1Min", "5Min", "1Hour", "1Day", "1Week", "1Month"
   */
  timeframe: TimeFrame;
  /**
   * Start datetime in RFC-3339 format (YYYY-MM-DD)
   * Example: "2024-02-11T09:00:00Z"
   */
  start?: string;
  /**
   * End datetime in RFC-3339 format (YYYY-MM-DD)
   * Example: "2024-02-11T16:00:00Z"
   */
  end?: string;
  /** Number of results to return (max 10000) */
  limit?: number;
  /** Pagination token for next page */
  page_token?: string;
  /** Sort order (asc or desc) */
  sort?: 'asc' | 'desc';
}

// Parameters for historical options trades request
export interface HistoricalOptionsTradesParams {
  /** Comma-separated list of option contract symbols */
  symbols: string[];
  /**
   * Start datetime in RFC-3339 format (YYYY-MM-DD)
   * Example: "2024-02-11T09:00:00Z"
   */
  start?: string;
  /**
   * End datetime in RFC-3339 format (YYYY-MM-DD)
   * Example: "2024-02-11T16:00:00Z"
   */
  end?: string;
  /** Number of results to return (max 10000) */
  limit?: number;
  /** Pagination token for next page */
  page_token?: string;
  /** Sort order (asc or desc) */
  sort?: 'asc' | 'desc';
}

// Parameters for options snapshots request
export interface OptionsSnapshotsParams {
  /** Comma-separated list of option contract symbols */
  symbols: string[];
  /** Number of results to return (may not be supported by this endpoint) */
  limit?: number;
  /** Pagination token for next page (may not be supported by this endpoint) */
  page_token?: string;
}

// Options Condition Codes Response
export interface OptionsConditionCodesResponse {
  [conditionCode: string]: string; // Maps condition code to description
}

// Options Exchange Codes Response
export interface OptionsExchangeCodesResponse {
  [exchangeCode: string]: string; // Maps exchange code to exchange name
}

// Tick type for condition codes
export type OptionTickType = 'trade' | 'quote';

/**
 * Configuration for options spread trading strategies.
 * Now includes a field to target a predicted stock price movement (in percent, scale 100).
 */
export interface OptionsSpreadConfig {
  /** Strategy type to use - only spreads allowed */
  strategy: 'call_spread' | 'put_spread';
  /** Days to expiration target (will find closest available) */
  daysToExpiration: number;
  /** Delta target for the long leg (0.1-0.9 range) */
  longLegDeltaTarget: number;
  /** Strike width in dollars between long and short legs */
  strikeWidthDollars: number;
  /** Maximum net debit to pay as percentage of underlying price */
  maxNetDebitPercent100: number;
  /** Use market orders for better execution (vs limit orders) */
  useMarketOrders: boolean;
  /** Maximum number of spreads per trade */
  maxSpreads: number;
  /**
   * Target predicted stock price movement in percent (scale 100, e.g. 1 = 1%).
   * Used to select spreads that best match the expected move.
   */
  targetMovePercent100?: number;
}


// Option-specific non-trade activity types
export type OptionActivityType = 'OPEXC' | 'OPASN' | 'OPEXP';

// Option-specific account activity
export interface OptionAccountActivity {
  id: string;
  activity_type: OptionActivityType;
  date: string;
  net_amount: string;
  description: string;
  symbol: string;
  qty: string;
  price?: string;
  status: 'executed';
}

export interface TradeUpdate {
  event:
    | 'new'
    | 'fill'
    | 'partial_fill'
    | 'canceled'
    | 'expired'
    | 'pending_new'
    | 'pending_cancel'
    | 'pending_replace'
    | 'replaced'
    | 'done_for_day';
  price?: string;
  timestamp: string;
  qty?: string;
  position_qty?: string;
  order: AlpacaOrder;
}

export type AlpacaAccountType = 'PAPER' | 'LIVE';
export type AlpacaOrderType = 'limit' | 'market' | 'options';
export type EngineType = 'adaptic' | 'brain' | 'quant';

export interface AlpacaCredentials {
  accountName: string; // The account identifier used in logs and tracking
  apiKey: string; // Alpaca API key
  apiSecret: string; // Alpaca API secret
  type: AlpacaAccountType;
  orderType: AlpacaOrderType;
  engine: EngineType; // execution engine
}

// Re-export class types for external use
export type { AlpacaTradingAPI } from '../alpaca-trading-api';
export type { AlpacaMarketDataAPI } from '../alpaca-market-data-api';

// ===== REAL-TIME DATA STREAM TYPES =====

/**
 * Base interface for all real-time stream messages from Alpaca.
 * All stream messages will have a 'T' (Type) and 'S' (Symbol) property.
 */
export interface AlpacaStreamMessage {
  T: string;
  S: string;
}

/**
 * Real-time stock trade message. (T: 't')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#trades
 */
export interface AlpacaTradeStream extends AlpacaStreamMessage {
  T: 't';
  i: number; // Trade ID
  x: string; // Exchange code
  p: number; // Trade price
  s: number; // Trade size
  c: string[]; // Trade conditions
  t: string; // RFC-3339 formatted timestamp with nanosecond precision
  z: string; // Tape
}

/**
 * Real-time stock quote message. (T: 'q')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#quotes
 */
export interface AlpacaQuoteStream extends AlpacaStreamMessage {
  T: 'q';
  ax: string; // Ask exchange code
  ap: number; // Ask price
  as: number; // Ask size
  bx: string; // Bid exchange code
  bp: number; // Bid price
  bs: number; // Bid size
  c: string[]; // Quote conditions
  t: string; // RFC-3339 formatted timestamp with nanosecond precision
  z: string; // Tape
}

/**
 * Real-time stock bar message. (T: 'b')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#bars
 */
export interface AlpacaBarStream extends AlpacaStreamMessage {
  T: 'b';
  o: number; // Open price
  h: number; // High price
  l: number; // Low price
  c: number; // Close price
  v: number; // Volume
  t: string; // RFC-3339 formatted timestamp
  vw: number; // Volume-weighted average price
  n: number; // Number of trades
}

/**
 * Real-time daily stock bar message. (T: 'd')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#bars
 */
export interface AlpacaDailyBarStream extends Omit<AlpacaBarStream, 'T'> {
  T: 'd';
}

/**
 * Real-time updated stock bar message. (T: 'u')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#bars
 */
export interface AlpacaUpdatedBarStream extends Omit<AlpacaBarStream, 'T'> {
  T: 'u';
}

/**
 * Real-time trading status message. (T: 's')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#trading-status
 */
export interface AlpacaTradingStatusStream extends AlpacaStreamMessage {
  T: 's';
  sc: string; // Status code
  sm: string; // Status message
  rc: string; // Reason code
  rm: string; // Reason message
  t: string; // RFC-3339 formatted timestamp
  z: string; // Tape
}

/**
 * Real-time LULD (Limit Up/Limit Down) message. (T: 'l')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#lulds
 */
export interface AlpacaLULDStream extends AlpacaStreamMessage {
  T: 'l';
  ldp: number; // Limit down price
  lup: number; // Limit up price
  i: string; // LULD indicator
  t: string; // RFC-3339 formatted timestamp
  z: string; // Tape
}

/**
 * Real-time trade correction message. (T: 'c')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#trade-corrections
 */
export interface AlpacaTradeCorrectionStream extends AlpacaStreamMessage {
  T: 'c';
  oi: number; // Original trade ID
  ci: number; // Corrected trade ID
  ox: string; // Original exchange
  cx: string; // Corrected exchange
  op: number; // Original price
  cp: number; // Corrected price
  os: number; // Original size
  cs: number; // Corrected size
  oc: string[]; // Original conditions
  cc: string[]; // Corrected conditions
  t: string; // RFC-3339 formatted timestamp
  z: string; // Tape
}

/**
 * Real-time trade cancel/error message. (T: 'x')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#trade-cancelserros
 */
export interface AlpacaTradeCancelStream extends AlpacaStreamMessage {
  T: 'x';
  i: number; // Trade ID to be canceled
  p: number; // Price of the canceled trade
  s: number; // Size of the canceled trade
  t: string; // RFC-3339 formatted timestamp
  z: string; // Tape
}

/**
 * Real-time order imbalance message. (T: 'i')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#order-imbalances
 */
export interface AlpacaOrderImbalanceStream extends AlpacaStreamMessage {
  T: 'i';
  p: number; // Price
  z: string; // Tape
  t: string; // RFC-3339 formatted timestamp
}

/**
 * Real-time option trade message. (T: 't')
 * @see https://docs.alpaca.markets/docs/real-time-option-data#trades
 */
export interface AlpacaOptionTradeStream extends AlpacaStreamMessage {
  T: 't';
  p: number; // Trade price
  s: number; // Trade size
  c: string[]; // Trade conditions
  x: string; // Exchange
  t: string; // Timestamp
}

/**
 * Real-time option quote message. (T: 'q')
 * @see https://docs.alpaca.markets/docs/real-time-option-data#quotes
 */
export interface AlpacaOptionQuoteStream extends AlpacaStreamMessage {
  T: 'q';
  ap: number; // Ask price
  as: number; // Ask size
  ax: string; // Ask exchange
  bp: number; // Bid price
  bs: number; // Bid size
  bx: string; // Bid exchange
  t: string; // Timestamp
}

/**
 * Real-time option bar message. (T: 'b')
 * @see https://docs.alpaca.markets/docs/real-time-option-data#bars
 */
export interface AlpacaOptionBarStream extends AlpacaStreamMessage {
  T: 'b';
  o: number; // Open
  h: number; // High
  l: number; // Low
  c: number; // Close
  v: number; // Volume
  t: string; // Timestamp
  vw: number; // Volume-weighted average price
  n: number; // Number of trades
}

export type AlpacaStockStreamMessage =
  | AlpacaTradeStream
  | AlpacaQuoteStream
  | AlpacaBarStream
  | AlpacaDailyBarStream
  | AlpacaUpdatedBarStream
  | AlpacaTradingStatusStream
  | AlpacaLULDStream
  | AlpacaTradeCorrectionStream
  | AlpacaTradeCancelStream
  | AlpacaOrderImbalanceStream;

export type AlpacaOptionStreamMessage = AlpacaOptionTradeStream | AlpacaOptionQuoteStream | AlpacaOptionBarStream;

// Type-safe event names for market data streams
export type StockStreamEventName =
  | 'stock-t' // Trade events
  | 'stock-q' // Quote events
  | 'stock-b' // Minute bar events
  | 'stock-d' // Daily bar events
  | 'stock-u' // Updated bar events
  | 'stock-s' // Trading status events
  | 'stock-l' // LULD events
  | 'stock-c' // Trade correction events
  | 'stock-x' // Trade cancel/error events
  | 'stock-i' // Order imbalance events
  | 'stock-data'; // Generic data event

export type OptionStreamEventName =
  | 'option-t' // Option trade events
  | 'option-q' // Option quote events
  | 'option-b' // Option bar events
  | 'option-data'; // Generic option data event

// Event payload mapping
export interface StockStreamEventMap {
  'stock-t': AlpacaTradeStream;
  'stock-q': AlpacaQuoteStream;
  'stock-b': AlpacaBarStream;
  'stock-d': AlpacaDailyBarStream;
  'stock-u': AlpacaUpdatedBarStream;
  'stock-s': AlpacaTradingStatusStream;
  'stock-l': AlpacaLULDStream;
  'stock-c': AlpacaTradeCorrectionStream;
  'stock-x': AlpacaTradeCancelStream;
  'stock-i': AlpacaOrderImbalanceStream;
  'stock-data': AlpacaStockStreamMessage;
}

export interface OptionStreamEventMap {
  'option-t': AlpacaOptionTradeStream;
  'option-q': AlpacaOptionQuoteStream;
  'option-b': AlpacaOptionBarStream;
  'option-data': AlpacaOptionStreamMessage;
}

// ===== CRYPTO STREAM TYPES =====

/**
 * Crypto trade stream message from Alpaca WebSocket
 * Format: wss://stream.data.alpaca.markets/v1beta3/crypto/us
 */
export interface AlpacaCryptoTradeStream {
  T: 't';          // Message type: trade
  S: string;       // Symbol (e.g., "BTC/USD")
  p: number;       // Trade price
  s: number;       // Trade size
  t: string;       // Timestamp (RFC-3339)
  i: number;       // Trade ID
  tks: 'B' | 'S';  // Taker side: B=buy, S=sell
}

/**
 * Crypto quote stream message from Alpaca WebSocket
 */
export interface AlpacaCryptoQuoteStream {
  T: 'q';          // Message type: quote
  S: string;       // Symbol (e.g., "BTC/USD")
  bp: number;      // Bid price
  bs: number;      // Bid size
  ap: number;      // Ask price
  as: number;      // Ask size
  t: string;       // Timestamp (RFC-3339)
}

/**
 * Crypto bar stream message from Alpaca WebSocket
 */
export interface AlpacaCryptoBarStream {
  T: 'b';          // Message type: bar
  S: string;       // Symbol (e.g., "BTC/USD")
  o: number;       // Open price
  h: number;       // High price
  l: number;       // Low price
  c: number;       // Close price
  v: number;       // Volume
  t: string;       // Timestamp (RFC-3339)
  n: number;       // Number of trades
  vw: number;      // Volume weighted average price
}

/**
 * Crypto daily bar stream message from Alpaca WebSocket
 */
export interface AlpacaCryptoDailyBarStream {
  T: 'd';          // Message type: daily bar
  S: string;       // Symbol
  o: number;       // Open price
  h: number;       // High price
  l: number;       // Low price
  c: number;       // Close price
  v: number;       // Volume
  t: string;       // Timestamp (RFC-3339)
  n: number;       // Number of trades
  vw: number;      // Volume weighted average price
}

/**
 * Crypto updated bar stream message from Alpaca WebSocket
 */
export interface AlpacaCryptoUpdatedBarStream {
  T: 'u';          // Message type: updated bar
  S: string;       // Symbol
  o: number;       // Open price
  h: number;       // High price
  l: number;       // Low price
  c: number;       // Close price
  v: number;       // Volume
  t: string;       // Timestamp (RFC-3339)
  n: number;       // Number of trades
  vw: number;      // Volume weighted average price
}

/**
 * Union type for all crypto stream messages
 */
export type AlpacaCryptoStreamMessage =
  | AlpacaCryptoTradeStream
  | AlpacaCryptoQuoteStream
  | AlpacaCryptoBarStream
  | AlpacaCryptoDailyBarStream
  | AlpacaCryptoUpdatedBarStream;

/**
 * Type-safe event names for crypto market data streams
 */
export type CryptoStreamEventName =
  | 'crypto-t'    // Trade events
  | 'crypto-q'    // Quote events
  | 'crypto-b'    // Minute bar events
  | 'crypto-d'    // Daily bar events
  | 'crypto-u'    // Updated bar events
  | 'crypto-data'; // Generic data event

/**
 * Event payload mapping for crypto streams
 */
export interface CryptoStreamEventMap {
  'crypto-t': AlpacaCryptoTradeStream;
  'crypto-q': AlpacaCryptoQuoteStream;
  'crypto-b': AlpacaCryptoBarStream;
  'crypto-d': AlpacaCryptoDailyBarStream;
  'crypto-u': AlpacaCryptoUpdatedBarStream;
  'crypto-data': AlpacaCryptoStreamMessage;
}
