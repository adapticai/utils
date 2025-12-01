import { ApolloClientType, NormalizedCacheObject } from '@adaptic/backend-legacy';
import { types } from '@adaptic/backend-legacy';
/**
 * Represents the authentication details for Alpaca.
 */
export interface AlpacaAuth {
    adapticAccountId?: string;
    alpacaApiKey?: string;
    alpacaApiSecret?: string;
    type?: 'PAPER' | 'LIVE';
}
/**
 * Options for fetching Alpaca account details.
 */
export interface AlpacaAccountGetOptions {
    accountId?: string;
    client?: ApolloClientType<NormalizedCacheObject>;
    alpacaAccount?: types.AlpacaAccount;
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
    marketOpen?: boolean;
    realTime?: boolean;
    suspend_trade: boolean;
    tradeAllocationPct?: number;
    minPercentageChange?: number;
    volumeThreshold?: number;
    cryptoTradingEnabled?: boolean;
    cryptoTradingPairs?: string[];
    cryptoTradeAllocationPct?: number;
    autoAllocation?: boolean;
    allocation?: AllocationConfig;
    dtbp_check: 'both' | 'entry' | 'exit';
    trade_confirm_email: 'all' | 'none';
    no_shorting: boolean;
    fractional_trading: boolean;
    max_margin_multiplier: '1' | '2' | '4';
    max_options_trading_level?: 0 | 1 | 2 | 3;
    pdt_check: 'both' | 'entry' | 'exit';
    ptp_no_exception_entry: boolean;
    enablePortfolioTrailingStop?: boolean;
    portfolioTrailPercent?: number;
    portfolioProfitThresholdPercent?: number;
    reducedPortfolioTrailPercent?: number;
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
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    n: number;
    vw: number;
}
/**
 * Represents the history of a portfolio.
 */
export interface PortfolioHistory {
    equity: number[];
    timestamp: number[];
}
/**
 * Represents a single benchmark bar.
 */
export interface BenchmarkBar {
    t: number;
    c: number;
}
/**
 * Result of the beta calculation.
 */
export interface CalculateBetaResult {
    beta: number;
    covariance: number;
    variance: number;
    averagePortfolioReturn: number;
    averageBenchmarkReturn: number;
}
/**
 * Represents a position in the portfolio.
 */
export type AlpacaPosition = {
    asset_id: string;
    symbol: string;
    exchange: string;
    asset_class: string;
    asset_marginable: boolean;
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
};
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
export type OrderStatus = 'new' | 'partially_filled' | 'filled' | 'done_for_day' | 'canceled' | 'expired' | 'replaced' | 'pending_cancel' | 'pending_replace' | 'accepted' | 'pending_new' | 'accepted_for_bidding' | 'stopped' | 'rejected' | 'suspended' | 'calculated';
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
    limit_price: string;
    stop_price?: string;
    order_class?: OrderClass;
}
/**
 * Parameters for stop loss orders.
 */
export interface StopLossParams {
    stop_price: string;
    limit_price?: string;
    order_class?: OrderClass;
}
/**
 * Parameters for creating an order.
 */
export interface CreateOrderParams {
    symbol: string;
    qty?: string;
    notional?: string;
    side: OrderSide;
    type: OrderType;
    time_in_force: TimeInForce;
    limit_price?: string;
    stop_price?: string;
    trail_price?: string;
    trail_percent?: string;
    extended_hours?: boolean;
    client_order_id?: string;
    order_class?: OrderClass;
    take_profit?: TakeProfitParams;
    stop_loss?: StopLossParams;
    position_intent?: PositionIntent;
    legs?: OrderLeg[];
}
export interface CreateMultiLegOrderParams {
    order_class: 'mleg';
    qty: string;
    type: OrderType;
    limit_price?: string;
    time_in_force: TimeInForce;
    legs: Array<{
        symbol: string;
        ratio_qty: string;
        side: OrderSide;
        position_intent: PositionIntent;
    }>;
}
/**
 * Parameters for getting orders.
 */
export interface GetOrdersParams {
    status?: 'open' | 'closed' | 'all';
    limit?: number;
    after?: string;
    until?: string;
    direction?: 'asc' | 'desc';
    nested?: boolean;
    symbols?: string[];
    side?: OrderSide;
}
/**
 * Parameters for replacing an order.
 */
export interface ReplaceOrderParams {
    qty?: string;
    time_in_force?: TimeInForce;
    limit_price?: string;
    stop_price?: string;
    trail?: string;
    client_order_id?: string;
}
/**
 * Represents an order.
 */
export type AlpacaOrder = {
    id: string;
    client_order_id: string;
    created_at: string;
    updated_at: string | null;
    submitted_at: string | null;
    filled_at: string | null;
    expired_at: string | null;
    canceled_at: string | null;
    failed_at: string | null;
    replaced_at: string | null;
    replaced_by: string | null;
    replaces: string | null;
    asset_id: string;
    symbol: string;
    asset_class: AssetClass;
    notional: string | null;
    qty: string | null;
    filled_qty: string;
    filled_avg_price: string | null;
    order_class: OrderClass;
    type: OrderType;
    side: OrderSide;
    time_in_force: TimeInForce;
    limit_price: string | null;
    stop_price: string | null;
    trail_price: string | null;
    trail_percent: string | null;
    hwm: string | null;
    position_intent: PositionIntent | null;
    status: OrderStatus;
    extended_hours: boolean;
    legs: AlpacaOrder[] | null;
};
export type CryptoTimeframe = `${number}Min` | `${number}T` | `${number}Hour` | `${number}H` | '1Day' | '1D' | '1Week' | '1W' | `${1 | 2 | 3 | 4 | 6 | 12}Month` | `${1 | 2 | 3 | 4 | 6 | 12}M`;
/**
 * Represents a single bar of cryptocurrency market data.
 */
export interface CryptoBar {
    t: Date;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    n: number;
    vw: number;
}
/**
 * Parameters for fetching cryptocurrency bars.
 */
export interface CryptoBarsParams {
    symbols: CryptoPair[];
    timeframe: CryptoTimeframe;
    start?: Date;
    end?: Date;
    limit?: number;
    page_token?: string;
    sort?: 'asc' | 'desc';
}
export type TimeFrame = '1Min' | '5Min' | '15Min' | '30Min' | '1Hour' | '2Hour' | '4Hour' | '1Day' | '1Week' | '1Month';
/**
 * Response structure for fetching cryptocurrency bars.
 */
export interface CryptoBarsResponse {
    bars: {
        [symbol: string]: CryptoBar[];
    };
    next_page_token?: string;
}
export type BTCPairs = 'BCH/BTC' | 'ETH/BTC' | 'LTC/BTC' | 'UNI/BTC';
export type USDTPairs = 'AAVE/USDT' | 'BCH/USDT' | 'BTC/USDT' | 'DOGE/USDT' | 'ETH/USDT' | 'LINK/USDT' | 'LTC/USDT' | 'SUSHI/USDT' | 'UNI/USDT' | 'YFI/USDT';
export type USDCPairs = 'AAVE/USDC' | 'AVAX/USDC' | 'BAT/USDC' | 'BCH/USDC' | 'BTC/USDC' | 'CRV/USDC' | 'DOGE/USDC' | 'DOT/USDC' | 'ETH/USDC' | 'GRT/USDC' | 'LINK/USDC' | 'LTC/USDC' | 'MKR/USDC' | 'SHIB/USDC' | 'SUSHI/USDC' | 'UNI/USDC' | 'XTZ/USDC' | 'YFI/USDC';
export type USDPairs = 'AAVE/USD' | 'AVAX/USD' | 'BAT/USD' | 'BCH/USD' | 'BTC/USD' | 'CRV/USD' | 'DOGE/USD' | 'DOT/USD' | 'ETH/USD' | 'GRT/USD' | 'LINK/USD' | 'LTC/USD' | 'MKR/USD' | 'SHIB/USD' | 'SUSHI/USD' | 'UNI/USD' | 'USDC/USD' | 'USDT/USD' | 'XTZ/USD' | 'YFI/USD';
/**
 * Represents a cryptocurrency trading pair.
 */
export type CryptoPair = BTCPairs | USDTPairs | USDCPairs | USDPairs;
/**
 * Represents an image associated with a news article.
 */
export interface NewsImage {
    size: 'large' | 'small' | 'thumb';
    url: string;
}
/**
 * Represents a news article from Alpaca.
 */
export interface AlpacaNewsArticle {
    id: number;
    author: string;
    content: string;
    created_at: string;
    updated_at: string;
    headline: string;
    source: string;
    summary: string;
    url: string;
    symbols: string[];
    images: NewsImage[];
}
/**
 * Represents the response structure for fetching news articles.
 */
export interface NewsResponse {
    news: AlpacaNewsArticle[];
    next_page_token?: string;
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
    period?: string;
    timeframe?: '1Min' | '5Min' | '15Min' | '1H' | '1D';
    intraday_reporting?: 'market_hours' | 'extended_hours' | 'continuous';
    start?: string;
    end?: string;
    date_end?: string;
    extended_hours?: boolean;
    pnl_reset?: 'per_day' | 'no_reset';
    cashflow_types?: string;
}
/**
 * Parameters for fetching portfolio history.
 */
export interface FetchPortfolioHistoryProps {
    params: PortfolioHistoryParams;
    accountId?: string;
    client?: ApolloClientType<NormalizedCacheObject>;
    alpacaAccount?: types.AlpacaAccount;
}
/**
 * Response structure for fetching portfolio history.
 */
export interface PortfolioHistoryResponse {
    timestamp: number[];
    equity: number[];
    profit_loss: number[];
    profit_loss_pct: number[];
    base_value: number;
    base_value_asof?: string;
}
/**
 * Parameters for fetching account details.
 */
export interface FetchAccountDetailsProps {
    accountId?: string;
    client?: ApolloClientType<NormalizedCacheObject>;
    alpacaAccount?: types.AlpacaAccount;
}
/**
 * Represents the details of an Alpaca account.
 */
export interface AlpacaAccountDetails {
    id: string;
    account_number: string;
    status: 'ONBOARDING' | 'SUBMISSION_FAILED' | 'SUBMITTED' | 'ACCOUNT_UPDATED' | 'APPROVAL_PENDING' | 'ACTIVE' | 'REJECTED';
    currency: string;
    cash: string;
    portfolio_value: string;
    non_marginable_buying_power: string;
    accrued_fees: string;
    pending_transfer_in: string;
    pending_transfer_out: string;
    pattern_day_trader: boolean;
    trade_suspended_by_user: boolean;
    trading_blocked: boolean;
    transfers_blocked: boolean;
    account_blocked: boolean;
    created_at: string;
    shorting_enabled: boolean;
    long_market_value: string;
    short_market_value: string;
    equity: string;
    last_equity: string;
    multiplier: '1' | '2' | '4';
    buying_power: string;
    initial_margin: string;
    maintenance_margin: string;
    sma: string;
    daytrade_count: number;
    balance_asof: string;
    last_maintenance_margin: string;
    daytrading_buying_power: string;
    regt_buying_power: string;
    options_buying_power: string;
    options_approved_level: 0 | 1 | 2 | 3;
    options_trading_level: 0 | 1 | 2 | 3;
    intraday_adjustments: string;
    pending_reg_taf_fees: string;
}
/**
 * Represents an asset in Alpaca.
 */
export interface AlpacaAsset {
    id: string;
    class: 'us_equity' | 'us_option' | 'crypto';
    exchange: string;
    symbol: string;
    name: string;
    status: 'active' | 'inactive';
    tradable: boolean;
    marginable: boolean;
    shortable: boolean;
    easy_to_borrow: boolean;
    fractionable: boolean;
    maintenance_margin_requirement?: number;
    margin_requirement_long?: string;
    margin_requirement_short?: string;
    attributes?: string[];
}
/**
 * Parameters for getting an asset.
 */
export interface GetAssetParams {
    symbolOrAssetId: string;
}
export type DataFeed = 'sip' | 'iex' | 'delayed_sip';
export interface AlpacaQuote {
    t: string;
    ap: number;
    as: number;
    ax: string;
    bp: number;
    bs: number;
    bx: string;
    c: string[];
    z: string;
}
export interface AlpacaTrade {
    t: string;
    p: number;
    s: number;
    x: string;
    i: number;
    z: string;
    c: string[];
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
export type OptionsTradingLevel = 0 | 1 | 2 | 3;
export type OptionType = 'call' | 'put';
export type OptionStyle = 'american' | 'european';
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
export interface OptionContractsResponse {
    option_contracts: OptionContract[];
    page_token?: string;
    limit: number;
}
export interface OrderLeg {
    symbol: string;
    ratio_qty: string;
    side: 'buy' | 'sell';
    position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
}
export interface OptionGreeks {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    rho?: number;
}
export interface OptionTrade {
    t: string;
    p: number;
    s: number;
    x: string;
    i: number;
    c: string[];
}
export interface OptionQuote {
    t: string;
    ap: number;
    as: number;
    ax: string;
    bp: number;
    bs: number;
    bx: string;
    c: string[];
}
export interface OptionBar {
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    n: number;
    vw: number;
}
export interface OptionSnapshot {
    latestTrade?: OptionTrade;
    latestQuote?: OptionQuote;
    greeks?: OptionGreeks;
    impliedVolatility?: number;
    openInterest?: number;
}
export interface OptionsChainResponse {
    snapshots: {
        [symbol: string]: OptionSnapshot;
    };
    next_page_token?: string;
}
export interface LatestOptionsTradesResponse {
    trades: {
        [symbol: string]: OptionTrade;
    };
    next_page_token?: string;
}
export interface LatestOptionsQuotesResponse {
    quotes: {
        [symbol: string]: OptionQuote;
    };
    next_page_token?: string;
}
export interface HistoricalOptionsBarsResponse {
    bars: {
        [symbol: string]: OptionBar[];
    };
    next_page_token?: string;
}
export interface HistoricalOptionsTradesResponse {
    trades: {
        [symbol: string]: OptionTrade[];
    };
    next_page_token?: string;
}
export interface OptionsSnapshotsResponse {
    snapshots: {
        [symbol: string]: OptionSnapshot;
    };
    next_page_token?: string;
}
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
export interface LatestOptionsTradesParams {
    /** Comma-separated list of option contract symbols */
    symbols: string[];
    /** Number of results to return (not supported by this endpoint) */
    limit?: number;
    /** Pagination token for next page (not supported by this endpoint) */
    page_token?: string;
}
export interface LatestOptionsQuotesParams {
    /** Comma-separated list of option contract symbols */
    symbols: string[];
    /** Number of results to return (not supported by this endpoint) */
    limit?: number;
    /** Pagination token for next page (not supported by this endpoint) */
    page_token?: string;
}
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
export interface OptionsSnapshotsParams {
    /** Comma-separated list of option contract symbols */
    symbols: string[];
    /** Number of results to return (may not be supported by this endpoint) */
    limit?: number;
    /** Pagination token for next page (may not be supported by this endpoint) */
    page_token?: string;
}
export interface OptionsConditionCodesResponse {
    [conditionCode: string]: string;
}
export interface OptionsExchangeCodesResponse {
    [exchangeCode: string]: string;
}
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
export type OptionActivityType = 'OPEXC' | 'OPASN' | 'OPEXP';
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
    event: 'new' | 'fill' | 'partial_fill' | 'canceled' | 'expired' | 'pending_new' | 'pending_cancel' | 'pending_replace' | 'replaced' | 'done_for_day';
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
    accountName: string;
    apiKey: string;
    apiSecret: string;
    type: AlpacaAccountType;
    orderType: AlpacaOrderType;
    engine: EngineType;
}
export type { AlpacaTradingAPI } from '../alpaca-trading-api';
export type { AlpacaMarketDataAPI } from '../alpaca-market-data-api';
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
    i: number;
    x: string;
    p: number;
    s: number;
    c: string[];
    t: string;
    z: string;
}
/**
 * Real-time stock quote message. (T: 'q')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#quotes
 */
export interface AlpacaQuoteStream extends AlpacaStreamMessage {
    T: 'q';
    ax: string;
    ap: number;
    as: number;
    bx: string;
    bp: number;
    bs: number;
    c: string[];
    t: string;
    z: string;
}
/**
 * Real-time stock bar message. (T: 'b')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#bars
 */
export interface AlpacaBarStream extends AlpacaStreamMessage {
    T: 'b';
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    t: string;
    vw: number;
    n: number;
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
    sc: string;
    sm: string;
    rc: string;
    rm: string;
    t: string;
    z: string;
}
/**
 * Real-time LULD (Limit Up/Limit Down) message. (T: 'l')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#lulds
 */
export interface AlpacaLULDStream extends AlpacaStreamMessage {
    T: 'l';
    ldp: number;
    lup: number;
    i: string;
    t: string;
    z: string;
}
/**
 * Real-time trade correction message. (T: 'c')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#trade-corrections
 */
export interface AlpacaTradeCorrectionStream extends AlpacaStreamMessage {
    T: 'c';
    oi: number;
    ci: number;
    ox: string;
    cx: string;
    op: number;
    cp: number;
    os: number;
    cs: number;
    oc: string[];
    cc: string[];
    t: string;
    z: string;
}
/**
 * Real-time trade cancel/error message. (T: 'x')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#trade-cancelserros
 */
export interface AlpacaTradeCancelStream extends AlpacaStreamMessage {
    T: 'x';
    i: number;
    p: number;
    s: number;
    t: string;
    z: string;
}
/**
 * Real-time order imbalance message. (T: 'i')
 * @see https://docs.alpaca.markets/docs/real-time-stock-pricing-data#order-imbalances
 */
export interface AlpacaOrderImbalanceStream extends AlpacaStreamMessage {
    T: 'i';
    p: number;
    z: string;
    t: string;
}
/**
 * Real-time option trade message. (T: 't')
 * @see https://docs.alpaca.markets/docs/real-time-option-data#trades
 */
export interface AlpacaOptionTradeStream extends AlpacaStreamMessage {
    T: 't';
    p: number;
    s: number;
    c: string[];
    x: string;
    t: string;
}
/**
 * Real-time option quote message. (T: 'q')
 * @see https://docs.alpaca.markets/docs/real-time-option-data#quotes
 */
export interface AlpacaOptionQuoteStream extends AlpacaStreamMessage {
    T: 'q';
    ap: number;
    as: number;
    ax: string;
    bp: number;
    bs: number;
    bx: string;
    t: string;
}
/**
 * Real-time option bar message. (T: 'b')
 * @see https://docs.alpaca.markets/docs/real-time-option-data#bars
 */
export interface AlpacaOptionBarStream extends AlpacaStreamMessage {
    T: 'b';
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    t: string;
    vw: number;
    n: number;
}
export type AlpacaStockStreamMessage = AlpacaTradeStream | AlpacaQuoteStream | AlpacaBarStream | AlpacaDailyBarStream | AlpacaUpdatedBarStream | AlpacaTradingStatusStream | AlpacaLULDStream | AlpacaTradeCorrectionStream | AlpacaTradeCancelStream | AlpacaOrderImbalanceStream;
export type AlpacaOptionStreamMessage = AlpacaOptionTradeStream | AlpacaOptionQuoteStream | AlpacaOptionBarStream;
export type StockStreamEventName = 'stock-t' | 'stock-q' | 'stock-b' | 'stock-d' | 'stock-u' | 'stock-s' | 'stock-l' | 'stock-c' | 'stock-x' | 'stock-i' | 'stock-data';
export type OptionStreamEventName = 'option-t' | 'option-q' | 'option-b' | 'option-data';
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
/**
 * Crypto trade stream message from Alpaca WebSocket
 * Format: wss://stream.data.alpaca.markets/v1beta3/crypto/us
 */
export interface AlpacaCryptoTradeStream {
    T: 't';
    S: string;
    p: number;
    s: number;
    t: string;
    i: number;
    tks: 'B' | 'S';
}
/**
 * Crypto quote stream message from Alpaca WebSocket
 */
export interface AlpacaCryptoQuoteStream {
    T: 'q';
    S: string;
    bp: number;
    bs: number;
    ap: number;
    as: number;
    t: string;
}
/**
 * Crypto bar stream message from Alpaca WebSocket
 */
export interface AlpacaCryptoBarStream {
    T: 'b';
    S: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    t: string;
    n: number;
    vw: number;
}
/**
 * Crypto daily bar stream message from Alpaca WebSocket
 */
export interface AlpacaCryptoDailyBarStream {
    T: 'd';
    S: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    t: string;
    n: number;
    vw: number;
}
/**
 * Crypto updated bar stream message from Alpaca WebSocket
 */
export interface AlpacaCryptoUpdatedBarStream {
    T: 'u';
    S: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    t: string;
    n: number;
    vw: number;
}
/**
 * Union type for all crypto stream messages
 */
export type AlpacaCryptoStreamMessage = AlpacaCryptoTradeStream | AlpacaCryptoQuoteStream | AlpacaCryptoBarStream | AlpacaCryptoDailyBarStream | AlpacaCryptoUpdatedBarStream;
/**
 * Type-safe event names for crypto market data streams
 */
export type CryptoStreamEventName = 'crypto-t' | 'crypto-q' | 'crypto-b' | 'crypto-d' | 'crypto-u' | 'crypto-data';
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
//# sourceMappingURL=alpaca-types.d.ts.map