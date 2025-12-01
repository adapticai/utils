import { Bar, AlpacaQuote, TimeFrame, AlpacaAsset, OptionBar, OptionsChainParams, OptionsChainResponse, LatestOptionsTradesParams, LatestOptionsTradesResponse, LatestOptionsQuotesParams, LatestOptionsQuotesResponse, LatestQuotesResponse, LatestTradesResponse, HistoricalOptionsBarsParams, HistoricalOptionsBarsResponse, HistoricalOptionsTradesParams, HistoricalOptionsTradesResponse, OptionsSnapshotsParams, OptionsSnapshotsResponse, OptionsConditionCodesResponse, OptionsExchangeCodesResponse, OptionTickType, SimpleNews, DataFeed, StockStreamEventName, OptionStreamEventName, CryptoStreamEventName, StockStreamEventMap, OptionStreamEventMap, CryptoStreamEventMap } from './types/alpaca-types';
import { EventEmitter } from 'events';
/**
 * Parameters for retrieving historical market data bars
 * @see https://data.alpaca.markets/v2/stocks/bars
 */
export interface HistoricalBarsParams {
    /** Comma-separated list of stock symbols to query, e.g. 'AAPL,MSFT,TSLA' */
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
    /**
     * Number of bars to return (1-10000)
     * Default: 1000
     */
    limit?: number;
    /**
  
    /**
     * Pagination token for retrieving next page of results
     * Returned in the next_page_token field of the response
     */
    page_token?: string;
    /**
     * Sort order of returned bars
     * - asc: Oldest to newest (default)
     * - desc: Newest to oldest
     */
    sort?: 'asc' | 'desc';
}
/**
 * Response from historical bars endpoint
 * Contains OHLCV (Open, High, Low, Close, Volume) data for requested symbols
 */
export interface HistoricalBarsResponse {
    /**
     * Map of symbol to array of bar data
     * Each bar contains OHLCV data for the specified timeframe
     */
    bars: {
        [symbol: string]: Bar[];
    };
    /**
     * Token for retrieving the next page of results
     * null if there are no more results
     */
    next_page_token: string | null;
    /** Currency of the price data in ISO 4217 format */
    currency: string;
}
/**
 * Response from latest bars endpoint
 * Contains the most recent minute bar for each requested symbol
 */
export interface LatestBarsResponse {
    /**
     * Map of symbol to latest bar data
     * Each bar contains OHLCV data for the most recent minute
     */
    bars: {
        [symbol: string]: Bar;
    };
    /** Currency of the price data in ISO 4217 format */
    currency: string;
}
/**
 * Response from last trade endpoint for a single symbol
 * Contains detailed information about the most recent trade
 */
export interface LastTradeResponse {
    /** Status of the request */
    status: string;
    /** The stock symbol that was queried */
    symbol: string;
    /**
     * Details of the last trade
     * @property price - Trade price
     * @property size - Trade size (quantity)
     * @property exchange - Exchange where trade occurred (see Common Exchange Codes in docs)
     * @property cond1-4 - Trade conditions
     * @property timestamp - UNIX epoch timestamp in milliseconds
     */
    last: {
        price: number;
        size: number;
        exchange: number;
        cond1: number;
        cond2: number;
        cond3: number;
        cond4: number;
        timestamp: number;
    };
}
/**
 * Singleton class for interacting with Alpaca Market Data API
 * Provides methods for fetching historical bars, latest bars, last trades, latest trades, latest quotes, and latest quote for a single symbol
 */
export declare class AlpacaMarketDataAPI extends EventEmitter {
    private static instance;
    private headers;
    private dataURL;
    private apiURL;
    private v1beta1url;
    private stockStreamUrl;
    private optionStreamUrl;
    private cryptoStreamUrl;
    private stockWs;
    private optionWs;
    private cryptoWs;
    private stockSubscriptions;
    private optionSubscriptions;
    private cryptoSubscriptions;
    setMode(mode?: 'sandbox' | 'test' | 'production'): void;
    getMode(): 'sandbox' | 'test' | 'production';
    private constructor();
    static getInstance(): AlpacaMarketDataAPI;
    on<K extends StockStreamEventName>(event: K, listener: (data: StockStreamEventMap[K]) => void): this;
    on<K extends OptionStreamEventName>(event: K, listener: (data: OptionStreamEventMap[K]) => void): this;
    on<K extends CryptoStreamEventName>(event: K, listener: (data: CryptoStreamEventMap[K]) => void): this;
    emit<K extends StockStreamEventName>(event: K, data: StockStreamEventMap[K]): boolean;
    emit<K extends OptionStreamEventName>(event: K, data: OptionStreamEventMap[K]): boolean;
    emit<K extends CryptoStreamEventName>(event: K, data: CryptoStreamEventMap[K]): boolean;
    private connect;
    private sendSubscription;
    connectStockStream(): void;
    connectOptionStream(): void;
    connectCryptoStream(): void;
    disconnectStockStream(): void;
    disconnectOptionStream(): void;
    disconnectCryptoStream(): void;
    /**
     * Check if a specific stream is connected
     * @param streamType - The type of stream to check
     * @returns True if the stream is connected
     */
    isStreamConnected(streamType: 'stock' | 'option' | 'crypto'): boolean;
    subscribe(streamType: 'stock' | 'option' | 'crypto', subscriptions: {
        trades?: string[];
        quotes?: string[];
        bars?: string[];
    }): void;
    unsubscribe(streamType: 'stock' | 'option' | 'crypto', subscriptions: {
        trades?: string[];
        quotes?: string[];
        bars?: string[];
    }): void;
    private makeRequest;
    /**
     * Get historical OHLCV bars for specified symbols, including pre-market and post-market data
     * Automatically handles pagination to fetch all available data
     * @param params Parameters for historical bars request
     * @returns Historical bars data with all pages combined
     */
    getHistoricalBars(params: HistoricalBarsParams): Promise<HistoricalBarsResponse>;
    /**
     * Get the most recent minute bar for requested symbols
     * @param symbols Array of stock symbols to query
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest bar data for each symbol
     
     */
    getLatestBars(symbols: string[], currency?: string): Promise<LatestBarsResponse>;
    /**
     * Get the last trade for a single symbol
     * @param symbol The stock symbol to query
     * @returns Last trade details including price, size, exchange, and conditions
     */
    getLastTrade(symbol: string): Promise<LastTradeResponse>;
    /**
     * Get the most recent trades for requested symbols
     * @param symbols Array of stock symbols to query
     * @param feed Optional data source (sip/iex/delayed_sip)
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest trade data for each symbol
     
     */
    getLatestTrades(symbols: string[], feed?: DataFeed, currency?: string): Promise<LatestTradesResponse>;
    /**
     * Get the most recent quotes for requested symbols
     * @param symbols Array of stock symbols to query
     * @param feed Optional data source (sip/iex/delayed_sip)
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest quote data for each symbol
     */
    getLatestQuotes(symbols: string[], feed?: DataFeed, currency?: string): Promise<LatestQuotesResponse>;
    /**
     * Get the latest quote for a single symbol
     * @param symbol The stock symbol to query
     * @param feed Optional data source (sip/iex/delayed_sip)
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest quote data with symbol and currency information
     */
    getLatestQuote(symbol: string, feed?: DataFeed, currency?: string): Promise<{
        quote: AlpacaQuote;
        symbol: string;
        currency: string;
    }>;
    /**
     * Get the previous day's closing price for a symbol
     * @param symbol The stock symbol to query
     * @param referenceDate Optional reference date to get the previous close for
     * @returns Previous day's closing price data
     */
    getPreviousClose(symbol: string, referenceDate?: Date): Promise<Bar | null>;
    /**
     * Get hourly price data for a symbol
     * @param symbol The stock symbol to query
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of hourly price bars
     */
    getHourlyPrices(symbol: string, start: number, end: number): Promise<Bar[]>;
    /**
     * Get half-hourly price data for a symbol
     * @param symbol The stock symbol to query
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of half-hourly price bars
     */
    getHalfHourlyPrices(symbol: string, start: number, end: number): Promise<Bar[]>;
    /**
     * Get daily price data for a symbol
     * @param symbol The stock symbol to query
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of daily price bars
     */
    getDailyPrices(symbol: string, start: number, end: number): Promise<Bar[]>;
    /**
     * Get intraday price data for a symbol
     * @param symbol The stock symbol to query
     * @param minutePeriod Minutes per bar (1, 5, 15, etc.)
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of intraday price bars
     */
    getIntradayPrices(symbol: string, minutePeriod: number, start: number, end: number): Promise<Bar[]>;
    /**
     * Analyzes an array of price bars and returns a summary string
     * @param bars Array of price bars to analyze
     * @returns A string summarizing the price data
     */
    static analyzeBars(bars: Bar[]): string;
    /**
     * Get all assets available for trade and data consumption from Alpaca
     * @param params Optional query params: status (e.g. 'active'), asset_class (e.g. 'us_equity', 'crypto')
     * @returns Array of AlpacaAsset objects
     * @see https://docs.alpaca.markets/reference/get-v2-assets-1
     */
    getAssets(params?: {
        status?: string;
        asset_class?: string;
    }): Promise<AlpacaAsset[]>;
    /**
     * Get a single asset by symbol or asset_id
     * @param symbolOrAssetId Symbol or asset_id
     * @returns AlpacaAsset object
     * @see https://docs.alpaca.markets/reference/get-v2-assets-symbol_or_asset_id
     */
    getAsset(symbolOrAssetId: string): Promise<AlpacaAsset>;
    /**
     * Get options chain for an underlying symbol
     * Provides the latest trade, latest quote, and greeks for each contract symbol of the underlying symbol
     * @param params Options chain request parameters
     * @returns Options chain data with snapshots for each contract
     * @see https://docs.alpaca.markets/reference/optionchain
     */
    getOptionsChain(params: OptionsChainParams): Promise<OptionsChainResponse>;
    /**
     * Get the most recent trades for requested option contract symbols
     * @param params Latest options trades request parameters
     * @returns Latest trade data for each option contract symbol
     
     * @see https://docs.alpaca.markets/reference/optionlatesttrades
     */
    getLatestOptionsTrades(params: LatestOptionsTradesParams): Promise<LatestOptionsTradesResponse>;
    /**
     * Get the most recent quotes for requested option contract symbols
     * @param params Latest options quotes request parameters
     * @returns Latest quote data for each option contract symbol
     
     * @see https://docs.alpaca.markets/reference/optionlatestquotes
     */
    getLatestOptionsQuotes(params: LatestOptionsQuotesParams): Promise<LatestOptionsQuotesResponse>;
    /**
     * Get historical OHLCV bars for option contract symbols
     * Automatically handles pagination to fetch all available data
     * @param params Historical options bars request parameters
     * @returns Historical bar data for each option contract symbol with all pages combined
     
     * @see https://docs.alpaca.markets/reference/optionbars
     */
    getHistoricalOptionsBars(params: HistoricalOptionsBarsParams): Promise<HistoricalOptionsBarsResponse>;
    /**
     * Get historical trades for option contract symbols
     * Automatically handles pagination to fetch all available data
     * @param params Historical options trades request parameters
     * @returns Historical trade data for each option contract symbol with all pages combined
     
     * @see https://docs.alpaca.markets/reference/optiontrades
     */
    getHistoricalOptionsTrades(params: HistoricalOptionsTradesParams): Promise<HistoricalOptionsTradesResponse>;
    /**
     * Get snapshots for option contract symbols
     * Provides latest trade, latest quote, and greeks for each contract symbol
     * @param params Options snapshots request parameters
     * @returns Snapshot data for each option contract symbol
     
     * @see https://docs.alpaca.markets/reference/optionsnapshots
     */
    getOptionsSnapshot(params: OptionsSnapshotsParams): Promise<OptionsSnapshotsResponse>;
    /**
     * Get condition codes for options trades or quotes
     * Returns the mapping between condition codes and their descriptions
     * @param tickType The type of tick data ('trade' or 'quote')
     * @returns Mapping of condition codes to descriptions
     
     * @see https://docs.alpaca.markets/reference/optionmetaconditions
     */
    getOptionsConditionCodes(tickType: OptionTickType): Promise<OptionsConditionCodesResponse>;
    /**
     * Get exchange codes for options
     * Returns the mapping between option exchange codes and exchange names
     * @returns Mapping of exchange codes to exchange names
     
     * @see https://docs.alpaca.markets/reference/optionmetaexchanges
     */
    getOptionsExchangeCodes(): Promise<OptionsExchangeCodesResponse>;
    /**
     * Analyzes an array of option bars and returns a summary string
     * @param bars Array of option bars to analyze
     * @returns A string summarizing the option price data
     */
    static analyzeOptionBars(bars: OptionBar[]): string;
    /**
     * Formats option greeks for display
     * @param greeks Option greeks object
     * @returns Formatted string with greek values
     */
    static formatOptionGreeks(greeks: any): string;
    /**
     * Interprets condition codes using the provided condition codes mapping
     * @param conditionCodes Array of condition codes from trade or quote
     * @param conditionCodesMap Mapping of condition codes to descriptions
     * @returns Formatted string with condition descriptions
     */
    static interpretConditionCodes(conditionCodes: string[], conditionCodesMap: OptionsConditionCodesResponse): string;
    /**
     * Gets the exchange name from exchange code using the provided exchange codes mapping
     * @param exchangeCode Exchange code from trade or quote
     * @param exchangeCodesMap Mapping of exchange codes to names
     * @returns Exchange name or formatted unknown exchange
     */
    static getExchangeName(exchangeCode: string, exchangeCodesMap: OptionsExchangeCodesResponse): string;
    /**
     * Fetches news articles from Alpaca API for a symbol, paginating through all results.
     * @param symbol The symbol to fetch news for (e.g., 'AAPL')
     * @param params Optional parameters: start, end, limit, sort, include_content
     * @returns Array of SimpleNews articles
     */
    fetchNews(symbol: string, params?: {
        start?: Date | string;
        end?: Date | string;
        limit?: number;
        sort?: 'asc' | 'desc';
        include_content?: boolean;
    }): Promise<SimpleNews[]>;
}
export declare const marketDataAPI: AlpacaMarketDataAPI;
//# sourceMappingURL=alpaca-market-data-api.d.ts.map