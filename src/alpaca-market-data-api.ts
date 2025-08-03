import { log as baseLog } from './logging';
import { LogOptions } from './types/logging-types';
import {
  Bar,
  AlpacaQuote,
  TimeFrame,
  AlpacaTrade,
  AlpacaAsset,
  OptionBar,
  OptionTrade,
  OptionsChainParams,
  OptionsChainResponse,
  LatestOptionsTradesParams,
  LatestOptionsTradesResponse,
  LatestOptionsQuotesParams,
  LatestOptionsQuotesResponse,
  LatestQuotesResponse,
  LatestTradesResponse,
  HistoricalOptionsBarsParams,
  HistoricalOptionsBarsResponse,
  HistoricalOptionsTradesParams,
  HistoricalOptionsTradesResponse,
  OptionsSnapshotsParams,
  OptionsSnapshotsResponse,
  OptionsConditionCodesResponse,
  OptionsExchangeCodesResponse,
  OptionTickType,
  SimpleNews,
  AlpacaNewsArticle,
  DataFeed,
  AlpacaStockStreamMessage,
  AlpacaOptionStreamMessage,
  StockStreamEventName,
  OptionStreamEventName,
  StockStreamEventMap,
  OptionStreamEventMap,
} from './types/alpaca-types';
import { getLastFullTradingDate } from './market-time';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'AlpacaMarketDataAPI' });
};

// Default settings for market data API
const DEFAULT_ADJUSTMENT = 'all' as const;
const DEFAULT_FEED = 'sip' as DataFeed;
const DEFAULT_CURRENCY = 'USD' as const;

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
export class AlpacaMarketDataAPI extends EventEmitter {
  private static instance: AlpacaMarketDataAPI;
  private headers: Record<string, string>;
  private dataURL: string;
  private apiURL: string;
  private v1beta1url: string;
  private stockStreamUrl: string = 'wss://stream.data.alpaca.markets/v2/sip'; // production values
  private optionStreamUrl: string = 'wss://stream.data.alpaca.markets/v1beta3/options'; // production values
  private stockWs: WebSocket | null = null;
  private optionWs: WebSocket | null = null;
  private stockSubscriptions: Record<string, string[]> = { trades: [], quotes: [], bars: [] };
  private optionSubscriptions: Record<string, string[]> = { trades: [], quotes: [], bars: [] };

  public setMode(mode: 'sandbox' | 'test' | 'production' = 'production'): void {
    if (mode === 'sandbox') { // sandbox mode
      this.stockStreamUrl = 'wss://stream.data.sandbox.alpaca.markets/v2/sip';
      this.optionStreamUrl = 'wss://stream.data.sandbox.alpaca.markets/v1beta3/options';
    } else if (mode === 'test') { // test mode, can only use ticker FAKEPACA
      this.stockStreamUrl = 'wss://stream.data.alpaca.markets/v2/test';
      this.optionStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/options'; // there's no test mode for options
    } else { // production
      this.stockStreamUrl = 'wss://stream.data.alpaca.markets/v2/sip';
      this.optionStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/options';
    }
  }

  public getMode(): 'sandbox' | 'test' | 'production' {
    if (this.stockStreamUrl.includes('sandbox')) {
      return 'sandbox';
    } else if (this.stockStreamUrl.includes('test')) {
      return 'test';
    } else {
      return 'production';
    }
  }

  private constructor() {
    super();
    this.dataURL = 'https://data.alpaca.markets/v2';
    this.apiURL =
      process.env.ALPACA_ACCOUNT_TYPE === 'PAPER'
        ? 'https://paper-api.alpaca.markets/v2'
        : 'https://api.alpaca.markets/v2'; // used by some, e.g. getAssets
    this.v1beta1url = 'https://data.alpaca.markets/v1beta1'; // used for options endpoints
    this.setMode('production'); // sets stockStreamUrl and optionStreamUrl
    this.headers = {
      'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY!,
      'Content-Type': 'application/json',
    };
  }

  public static getInstance(): AlpacaMarketDataAPI {
    if (!AlpacaMarketDataAPI.instance) {
      AlpacaMarketDataAPI.instance = new AlpacaMarketDataAPI();
    }
    return AlpacaMarketDataAPI.instance;
  }

  // Type-safe event emitter methods
  public on<K extends StockStreamEventName>(event: K, listener: (data: StockStreamEventMap[K]) => void): this;
  public on<K extends OptionStreamEventName>(event: K, listener: (data: OptionStreamEventMap[K]) => void): this;
  public on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  public emit<K extends StockStreamEventName>(event: K, data: StockStreamEventMap[K]): boolean;
  public emit<K extends OptionStreamEventName>(event: K, data: OptionStreamEventMap[K]): boolean;
  public emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  private connect(streamType: 'stock' | 'option'): void {
    const url = streamType === 'stock' ? this.stockStreamUrl : this.optionStreamUrl;
    const ws = new WebSocket(url);
    if (streamType === 'stock') {
      this.stockWs = ws;
    } else {
      this.optionWs = ws;
    }

    ws.on('open', () => {
      log(`${streamType} stream connected`, { type: 'info' });
      const authMessage = {
        action: 'auth',
        key: process.env.ALPACA_API_KEY!,
        secret: process.env.ALPACA_SECRET_KEY!,
      };
      ws.send(JSON.stringify(authMessage));
    });

    ws.on('message', (data: WebSocket.Data) => {
      //log(`RAW MESSASGE: ${data.toString()}`);
      const messages = JSON.parse(data.toString());
      for (const message of messages) {
        if (message.T === 'success' && message.msg === 'authenticated') {
          log(`${streamType} stream authenticated`, { type: 'info' });
          this.sendSubscription(streamType);
        } else if (message.T === 'error') {
          log(`${streamType} stream error: ${message.msg}`, { type: 'error' });
        } else if (message.S) {
          super.emit(`${streamType}-${message.T}`, message);
          super.emit(`${streamType}-data`, message as AlpacaStockStreamMessage | AlpacaOptionStreamMessage);
        }
      }
    });

    ws.on('close', () => {
      log(`${streamType} stream disconnected`, { type: 'warn' });
      if (streamType === 'stock') {
        this.stockWs = null;
      } else {
        this.optionWs = null;
      }
      // Optional: implement reconnect logic
    });

    ws.on('error', (error: Error) => {
      log(`${streamType} stream error: ${error.message}`, { type: 'error' });
    });
  }

  private sendSubscription(streamType: 'stock' | 'option'): void {
    const ws = streamType === 'stock' ? this.stockWs : this.optionWs;
    const subscriptions = streamType === 'stock' ? this.stockSubscriptions : this.optionSubscriptions;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const subMessagePayload: { trades?: string[]; quotes?: string[]; bars?: string[] } = {};

      if (subscriptions.trades.length > 0) {
        subMessagePayload.trades = subscriptions.trades;
      }
      if (subscriptions.quotes.length > 0) {
        subMessagePayload.quotes = subscriptions.quotes;
      }
      if (subscriptions.bars.length > 0) {
        subMessagePayload.bars = subscriptions.bars;
      }

      if (Object.keys(subMessagePayload).length > 0) {
        const subMessage = {
          action: 'subscribe',
          ...subMessagePayload,
        };
        ws.send(JSON.stringify(subMessage));
      }
    }
  }

  public connectStockStream(): void {
    if (!this.stockWs) {
      this.connect('stock');
    }
  }

  public connectOptionStream(): void {
    if (!this.optionWs) {
      this.connect('option');
    }
  }

  public disconnectStockStream(): void {
    if (this.stockWs) {
      this.stockWs.close();
    }
  }

  public disconnectOptionStream(): void {
    if (this.optionWs) {
      this.optionWs.close();
    }
  }

  public subscribe(streamType: 'stock' | 'option', subscriptions: { trades?: string[]; quotes?: string[]; bars?: string[] }): void {
    const currentSubscriptions = streamType === 'stock' ? this.stockSubscriptions : this.optionSubscriptions;
    Object.entries(subscriptions).forEach(([key, value]) => {
      if (value) {
        currentSubscriptions[key] = [...new Set([...(currentSubscriptions[key] || []), ...value])];
      }
    });

    this.sendSubscription(streamType);
  }

  public unsubscribe(streamType: 'stock' | 'option', subscriptions: { trades?: string[]; quotes?: string[]; bars?: string[] }): void {
    const currentSubscriptions = streamType === 'stock' ? this.stockSubscriptions : this.optionSubscriptions;
    Object.entries(subscriptions).forEach(([key, value]) => {
      if (value) {
        currentSubscriptions[key] = (currentSubscriptions[key] || []).filter(s => !value.includes(s));
      }
    });
    const unsubMessage = {
        action: 'unsubscribe',
        ...subscriptions,
    };

    const ws = streamType === 'stock' ? this.stockWs : this.optionWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(unsubMessage));
    }
  }

  private async makeRequest(
    endpoint: string,
    method: string = 'GET',
    params?: Record<string, any>,
    baseUrlName: 'data' | 'api' | 'v1beta1' = 'data',
  ): Promise<any> {
    const baseUrl = baseUrlName === 'data' ? this.dataURL : baseUrlName === 'api' ? this.apiURL : this.v1beta1url;
    const url = new URL(`${baseUrl}${endpoint}`);
    
    try {
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            url.searchParams.append(key, value.join(','));
          } else if (value !== undefined) {
            url.searchParams.append(key, value.toString());
          }
        });
      }

      const response = await fetch(url.toString(), {
        method,
        headers: this.headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        log(`Market Data API error (${response.status}): ${errorText}`, { type: 'error' });
        throw new Error(`Market Data API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      const error = err as Error;
      log(`Error in makeRequest: ${error.message}. Endpoint: ${endpoint}. Url: ${url.toString()}`, { type: 'error' });
      if (error instanceof TypeError) {
        log(`Network error details: ${error.stack}`, { type: 'error' });
      }
      throw error;
    }
  }

  /**
   * Get historical OHLCV bars for specified symbols, including pre-market and post-market data
   * Automatically handles pagination to fetch all available data
   * @param params Parameters for historical bars request
   * @returns Historical bars data with all pages combined
   */
  async getHistoricalBars(params: HistoricalBarsParams): Promise<HistoricalBarsResponse> {
    const symbols = params.symbols;
    const symbolsStr = symbols.join(',');
    let allBars: { [symbol: string]: Bar[] } = {};
    let pageToken: string | null = null;
    let hasMorePages = true;
    let totalBarsCount = 0;
    let pageCount = 0;
    let currency = '';
    
    // Initialize bar arrays for each symbol
    symbols.forEach(symbol => {
      allBars[symbol] = [];
    });

    log(`Starting historical bars fetch for ${symbolsStr} (${params.timeframe}, ${params.start || 'no start'} to ${params.end || 'no end'})`, {
      type: 'info'
    });

    while (hasMorePages) {
      pageCount++;
      const requestParams = {
        ...params,
        adjustment: DEFAULT_ADJUSTMENT,
        feed: DEFAULT_FEED,
        ...(pageToken && { page_token: pageToken }),
      };

      const response: HistoricalBarsResponse = await this.makeRequest('/stocks/bars', 'GET', requestParams);
      
      if (!response.bars) {
        log(`No bars data found in response for ${symbolsStr}`, { type: 'warn' });
        break;
      }

      // Track currency from first response
      if (!currency) {
        currency = response.currency;
      }

      // Combine bars for each symbol
      let pageBarsCount = 0;
      let earliestTimestamp: Date | null = null;
      let latestTimestamp: Date | null = null;

      Object.entries(response.bars).forEach(([symbol, bars]) => {
        if (bars && bars.length > 0) {
          allBars[symbol] = [...allBars[symbol], ...bars];
          pageBarsCount += bars.length;
          
          // Track date range for this page
          bars.forEach(bar => {
            const barDate = new Date(bar.t);
            if (!earliestTimestamp || barDate < earliestTimestamp) {
              earliestTimestamp = barDate;
            }
            if (!latestTimestamp || barDate > latestTimestamp) {
              latestTimestamp = barDate;
            }
          });
        }
      });

      totalBarsCount += pageBarsCount;
      pageToken = response.next_page_token || null;
      hasMorePages = !!pageToken;

      // Enhanced logging with date range and progress info
      const dateRangeStr = earliestTimestamp && latestTimestamp 
        ? `${(earliestTimestamp as Date).toLocaleDateString('en-US', { timeZone: 'America/New_York' })} to ${(latestTimestamp as Date).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
        : 'unknown range';
      
      log(`Page ${pageCount}: Fetched ${pageBarsCount.toLocaleString()} bars (total: ${totalBarsCount.toLocaleString()}) for ${symbolsStr}, date range: ${dateRangeStr}${hasMorePages ? ', more pages available' : ', complete'}`, {
        type: 'info'
      });

      // Prevent infinite loops
      if (pageCount > 1000) {
        log(`Stopping pagination after ${pageCount} pages to prevent infinite loop`, { type: 'warn' });
        break;
      }
    }

    // Final summary
    const symbolCounts = Object.entries(allBars).map(([symbol, bars]) => `${symbol}: ${bars.length}`).join(', ');
    log(`Historical bars fetch complete: ${totalBarsCount.toLocaleString()} total bars across ${pageCount} pages (${symbolCounts})`, {
      type: 'info'
    });

    return {
      bars: allBars,
      next_page_token: null, // Always null since we fetch all pages
      currency: currency || DEFAULT_CURRENCY,
    };
  }

  /**
   * Get the most recent minute bar for requested symbols
   * @param symbols Array of stock symbols to query
   * @param currency Optional currency in ISO 4217 format
   * @returns Latest bar data for each symbol
   
   */
  async getLatestBars(symbols: string[], currency?: string): Promise<LatestBarsResponse> {
    return this.makeRequest('/stocks/bars/latest', 'GET', {
      symbols,
      feed: DEFAULT_FEED,
      currency: currency || DEFAULT_CURRENCY,
    });
  }

  /**
   * Get the last trade for a single symbol
   * @param symbol The stock symbol to query
   * @returns Last trade details including price, size, exchange, and conditions
   */
  async getLastTrade(symbol: string): Promise<LastTradeResponse> {
    return this.makeRequest(`/v1/last/stocks/${symbol}`, 'GET');
  }

  /**
   * Get the most recent trades for requested symbols
   * @param symbols Array of stock symbols to query
   * @param feed Optional data source (sip/iex/delayed_sip)
   * @param currency Optional currency in ISO 4217 format
   * @returns Latest trade data for each symbol
   
   */
  async getLatestTrades(symbols: string[], feed?: DataFeed, currency?: string): Promise<LatestTradesResponse> {
    return this.makeRequest('/stocks/trades/latest', 'GET', {
      symbols,
      feed: feed || DEFAULT_FEED,
      currency: currency || DEFAULT_CURRENCY,
    });
  }

  /**
   * Get the most recent quotes for requested symbols
   * @param symbols Array of stock symbols to query
   * @param feed Optional data source (sip/iex/delayed_sip)
   * @param currency Optional currency in ISO 4217 format
   * @returns Latest quote data for each symbol
   */
  async getLatestQuotes(symbols: string[], feed?: DataFeed, currency?: string): Promise<LatestQuotesResponse> {
    // Return empty response if symbols array is empty to avoid API error
    if (!symbols || symbols.length === 0) {
      log('No symbols provided to getLatestQuotes, returning empty response', { type: 'warn' });
      return {
        quotes: {},
        currency: currency || DEFAULT_CURRENCY,
      };
    }

    return this.makeRequest('/stocks/quotes/latest', 'GET', {
      symbols,
      feed: feed || DEFAULT_FEED,
      currency: currency || DEFAULT_CURRENCY,
    });
  }

  /**
   * Get the latest quote for a single symbol
   * @param symbol The stock symbol to query
   * @param feed Optional data source (sip/iex/delayed_sip)
   * @param currency Optional currency in ISO 4217 format
   * @returns Latest quote data with symbol and currency information
   */
  async getLatestQuote(
    symbol: string,
    feed?: DataFeed,
    currency?: string
  ): Promise<{ quote: AlpacaQuote; symbol: string; currency: string }> {
    return this.makeRequest(`/stocks/${symbol}/quotes/latest`, 'GET', {
      feed: feed || DEFAULT_FEED,
      currency,
    });
  }

  /**
   * Get the previous day's closing price for a symbol
   * @param symbol The stock symbol to query
   * @param referenceDate Optional reference date to get the previous close for
   * @returns Previous day's closing price data
   */
  async getPreviousClose(symbol: string, referenceDate?: Date): Promise<Bar | null> {
    const date = referenceDate || new Date();
    const prevMarketDate = getLastFullTradingDate(date);

    const response = await this.getHistoricalBars({
      symbols: [symbol],
      timeframe: '1Day',
      start: prevMarketDate.date.toISOString(),
      end: prevMarketDate.date.toISOString(),
      limit: 1,
    });

    if (!response.bars[symbol] || response.bars[symbol].length === 0) {
      log(`No previous close data available for ${symbol}`, { type: 'error', symbol });
      return null;
    }

    return response.bars[symbol][0];
  }

  /**
   * Get hourly price data for a symbol
   * @param symbol The stock symbol to query
   * @param start Start time in milliseconds
   * @param end End time in milliseconds
   * @returns Array of hourly price bars
   */
  async getHourlyPrices(symbol: string, start: number, end: number): Promise<Bar[]> {
    const response = await this.getHistoricalBars({
      symbols: [symbol],
      timeframe: '1Hour',
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      limit: 96, // Last 96 hours (4 days)
    });

    return response.bars[symbol] || [];
  }

  /**
   * Get half-hourly price data for a symbol
   * @param symbol The stock symbol to query
   * @param start Start time in milliseconds
   * @param end End time in milliseconds
   * @returns Array of half-hourly price bars
   */
  async getHalfHourlyPrices(symbol: string, start: number, end: number): Promise<Bar[]> {
    const response = await this.getHistoricalBars({
      symbols: [symbol],
      timeframe: '30Min',
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      limit: 16 * 2 * 4, // last 4 days, 16 hours per day, 2 bars per hour
    });

    return response.bars[symbol] || [];
  }

  /**
   * Get daily price data for a symbol
   * @param symbol The stock symbol to query
   * @param start Start time in milliseconds
   * @param end End time in milliseconds
   * @returns Array of daily price bars
   */
  async getDailyPrices(symbol: string, start: number, end: number): Promise<Bar[]> {
    const response = await this.getHistoricalBars({
      symbols: [symbol],
      timeframe: '1Day',
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      limit: 100, // Last 100 days
    });

    return response.bars[symbol] || [];
  }

  /**
   * Get intraday price data for a symbol
   * @param symbol The stock symbol to query
   * @param minutePeriod Minutes per bar (1, 5, 15, etc.)
   * @param start Start time in milliseconds
   * @param end End time in milliseconds
   * @returns Array of intraday price bars
   */
  async getIntradayPrices(symbol: string, minutePeriod: number, start: number, end: number): Promise<Bar[]> {
    const timeframe = `${minutePeriod}Min` as TimeFrame;
    const response = await this.getHistoricalBars({
      symbols: [symbol],
      timeframe,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    });

    return response.bars[symbol] || [];
  }

  /**
   * Analyzes an array of price bars and returns a summary string
   * @param bars Array of price bars to analyze
   * @returns A string summarizing the price data
   */
  static analyzeBars(bars: Bar[]): string {
    if (!bars || bars.length === 0) {
      return 'No price data available';
    }

    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];
    const priceChange = lastBar.c - firstBar.o;
    const percentChange = (priceChange / firstBar.o) * 100;

    const volumeChange = lastBar.v - firstBar.v;
    const percentVolumeChange = (volumeChange / firstBar.v) * 100;

    const high = Math.max(...bars.map((bar) => bar.h));
    const low = Math.min(...bars.map((bar) => bar.l));
    const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
    const avgVolume = totalVolume / bars.length;

    return (
      `Price: $${firstBar.o.toFixed(2)} -> $${lastBar.c.toFixed(2)} (${percentChange.toFixed(2)}%), ` +
      `Volume: ${firstBar.v.toLocaleString()} -> ${lastBar.v.toLocaleString()} (${percentVolumeChange.toFixed(2)}%), ` +
      `High: $${high.toFixed(2)}, Low: $${low.toFixed(2)}, ` +
      `Avg Volume: ${avgVolume.toLocaleString()}`
    );
  }

  /**
   * Get all assets available for trade and data consumption from Alpaca
   * @param params Optional query params: status (e.g. 'active'), asset_class (e.g. 'us_equity', 'crypto')
   * @returns Array of AlpacaAsset objects
   * @see https://docs.alpaca.markets/reference/get-v2-assets-1
   */
  async getAssets(params?: { status?: string; asset_class?: string }): Promise<AlpacaAsset[]> {
    // Endpoint: GET /v2/assets
    return this.makeRequest('/assets', 'GET', params, 'api'); // use apiURL
  }

  /**
   * Get a single asset by symbol or asset_id
   * @param symbolOrAssetId Symbol or asset_id
   * @returns AlpacaAsset object
   * @see https://docs.alpaca.markets/reference/get-v2-assets-symbol_or_asset_id
   */
  async getAsset(symbolOrAssetId: string): Promise<AlpacaAsset> {
    // Endpoint: GET /v2/assets/{symbol_or_asset_id}
    return this.makeRequest(`/assets/${encodeURIComponent(symbolOrAssetId)}`, 'GET', undefined, 'api');
  }

  // ===== OPTIONS MARKET DATA METHODS =====

  /**
   * Get options chain for an underlying symbol
   * Provides the latest trade, latest quote, and greeks for each contract symbol of the underlying symbol
   * @param params Options chain request parameters
   * @returns Options chain data with snapshots for each contract
   * @see https://docs.alpaca.markets/reference/optionchain
   */
  async getOptionsChain(params: OptionsChainParams): Promise<OptionsChainResponse> {
    const { underlying_symbol, ...queryParams } = params;
    return this.makeRequest(
      `/options/snapshots/${encodeURIComponent(underlying_symbol)}`,
      'GET',
      queryParams,
      'v1beta1'
    );
  }

  /**
   * Get the most recent trades for requested option contract symbols
   * @param params Latest options trades request parameters
   * @returns Latest trade data for each option contract symbol
   
   * @see https://docs.alpaca.markets/reference/optionlatesttrades
   */
  async getLatestOptionsTrades(params: LatestOptionsTradesParams): Promise<LatestOptionsTradesResponse> {
    // Remove limit and page_token as they're not supported by this endpoint
    const { limit, page_token, ...requestParams } = params;
    return this.makeRequest('/options/trades/latest', 'GET', requestParams, 'v1beta1');
  }

  /**
   * Get the most recent quotes for requested option contract symbols
   * @param params Latest options quotes request parameters
   * @returns Latest quote data for each option contract symbol
   
   * @see https://docs.alpaca.markets/reference/optionlatestquotes
   */
  async getLatestOptionsQuotes(params: LatestOptionsQuotesParams): Promise<LatestOptionsQuotesResponse> {
    // Remove limit and page_token as they're not supported by this endpoint
    const { limit, page_token, ...requestParams } = params;
    return this.makeRequest('/options/quotes/latest', 'GET', requestParams, 'v1beta1');
  }

  /**
   * Get historical OHLCV bars for option contract symbols
   * Automatically handles pagination to fetch all available data
   * @param params Historical options bars request parameters
   * @returns Historical bar data for each option contract symbol with all pages combined
   
   * @see https://docs.alpaca.markets/reference/optionbars
   */
  async getHistoricalOptionsBars(params: HistoricalOptionsBarsParams): Promise<HistoricalOptionsBarsResponse> {
    const symbols = params.symbols;
    const symbolsStr = symbols.join(',');
    let allBars: { [symbol: string]: OptionBar[] } = {};
    let pageToken: string | null = null;
    let hasMorePages = true;
    let totalBarsCount = 0;
    let pageCount = 0;
    
    // Initialize bar arrays for each symbol
    symbols.forEach(symbol => {
      allBars[symbol] = [];
    });

    log(`Starting historical options bars fetch for ${symbolsStr} (${params.timeframe}, ${params.start || 'no start'} to ${params.end || 'no end'})`, {
      type: 'info'
    });

    while (hasMorePages) {
      pageCount++;
      const requestParams = {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      };

      const response: HistoricalOptionsBarsResponse = await this.makeRequest('/options/bars', 'GET', requestParams, 'v1beta1');
      
      if (!response.bars) {
        log(`No options bars data found in response for ${symbolsStr}`, { type: 'warn' });
        break;
      }

      // Combine bars for each symbol
      let pageBarsCount = 0;
      let earliestTimestamp: Date | null = null;
      let latestTimestamp: Date | null = null;

      Object.entries(response.bars).forEach(([symbol, bars]) => {
        if (bars && bars.length > 0) {
          allBars[symbol] = [...allBars[symbol], ...bars];
          pageBarsCount += bars.length;
          
          // Track date range for this page
          bars.forEach(bar => {
            const barDate = new Date(bar.t);
            if (!earliestTimestamp || barDate < earliestTimestamp) {
              earliestTimestamp = barDate;
            }
            if (!latestTimestamp || barDate > latestTimestamp) {
              latestTimestamp = barDate;
            }
          });
        }
      });

      totalBarsCount += pageBarsCount;
      pageToken = response.next_page_token || null;
      hasMorePages = !!pageToken;

      // Enhanced logging with date range and progress info
      const dateRangeStr = earliestTimestamp && latestTimestamp 
        ? `${(earliestTimestamp as Date).toLocaleDateString('en-US', { timeZone: 'America/New_York' })} to ${(latestTimestamp as Date).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
        : 'unknown range';
      
      log(`Page ${pageCount}: Fetched ${pageBarsCount.toLocaleString()} option bars (total: ${totalBarsCount.toLocaleString()}) for ${symbolsStr}, date range: ${dateRangeStr}${hasMorePages ? ', more pages available' : ', complete'}`, {
        type: 'info'
      });

      // Prevent infinite loops
      if (pageCount > 1000) {
        log(`Stopping options bars pagination after ${pageCount} pages to prevent infinite loop`, { type: 'warn' });
        break;
      }
    }

    // Final summary
    const symbolCounts = Object.entries(allBars).map(([symbol, bars]) => `${symbol}: ${bars.length}`).join(', ');
    log(`Historical options bars fetch complete: ${totalBarsCount.toLocaleString()} total bars across ${pageCount} pages (${symbolCounts})`, {
      type: 'info'
    });

    return {
      bars: allBars,
      next_page_token: undefined, // Always undefined since we fetch all pages
    };
  }

  /**
   * Get historical trades for option contract symbols
   * Automatically handles pagination to fetch all available data
   * @param params Historical options trades request parameters
   * @returns Historical trade data for each option contract symbol with all pages combined
   
   * @see https://docs.alpaca.markets/reference/optiontrades
   */
  async getHistoricalOptionsTrades(params: HistoricalOptionsTradesParams): Promise<HistoricalOptionsTradesResponse> {
    const symbols = params.symbols;
    const symbolsStr = symbols.join(',');
    let allTrades: { [symbol: string]: OptionTrade[] } = {};
    let pageToken: string | null = null;
    let hasMorePages = true;
    let totalTradesCount = 0;
    let pageCount = 0;
    
    // Initialize trades arrays for each symbol
    symbols.forEach(symbol => {
      allTrades[symbol] = [];
    });

    log(`Starting historical options trades fetch for ${symbolsStr} (${params.start || 'no start'} to ${params.end || 'no end'})`, {
      type: 'info'
    });

    while (hasMorePages) {
      pageCount++;
      const requestParams = {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      };

      const response: HistoricalOptionsTradesResponse = await this.makeRequest('/options/trades', 'GET', requestParams, 'v1beta1');
      
      if (!response.trades) {
        log(`No options trades data found in response for ${symbolsStr}`, { type: 'warn' });
        break;
      }

      // Combine trades for each symbol
      let pageTradesCount = 0;
      let earliestTimestamp: Date | null = null;
      let latestTimestamp: Date | null = null;

      Object.entries(response.trades).forEach(([symbol, trades]) => {
        if (trades && trades.length > 0) {
          allTrades[symbol] = [...allTrades[symbol], ...trades];
          pageTradesCount += trades.length;
          
          // Track date range for this page
          trades.forEach(trade => {
            const tradeDate = new Date(trade.t);
            if (!earliestTimestamp || tradeDate < earliestTimestamp) {
              earliestTimestamp = tradeDate;
            }
            if (!latestTimestamp || tradeDate > latestTimestamp) {
              latestTimestamp = tradeDate;
            }
          });
        }
      });

      totalTradesCount += pageTradesCount;
      pageToken = response.next_page_token || null;
      hasMorePages = !!pageToken;

      // Enhanced logging with date range and progress info
      const dateRangeStr = earliestTimestamp && latestTimestamp 
        ? `${(earliestTimestamp as Date).toLocaleDateString('en-US', { timeZone: 'America/New_York' })} to ${(latestTimestamp as Date).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
        : 'unknown range';
      
      log(`Page ${pageCount}: Fetched ${pageTradesCount.toLocaleString()} option trades (total: ${totalTradesCount.toLocaleString()}) for ${symbolsStr}, date range: ${dateRangeStr}${hasMorePages ? ', more pages available' : ', complete'}`, {
        type: 'info'
      });

      // Prevent infinite loops
      if (pageCount > 1000) {
        log(`Stopping options trades pagination after ${pageCount} pages to prevent infinite loop`, { type: 'warn' });
        break;
      }
    }

    // Final summary
    const symbolCounts = Object.entries(allTrades).map(([symbol, trades]) => `${symbol}: ${trades.length}`).join(', ');
    log(`Historical options trades fetch complete: ${totalTradesCount.toLocaleString()} total trades across ${pageCount} pages (${symbolCounts})`, {
      type: 'info'
    });

    return {
      trades: allTrades,
      next_page_token: undefined, // Always undefined since we fetch all pages
    };
  }

  /**
   * Get snapshots for option contract symbols
   * Provides latest trade, latest quote, and greeks for each contract symbol
   * @param params Options snapshots request parameters
   * @returns Snapshot data for each option contract symbol
   
   * @see https://docs.alpaca.markets/reference/optionsnapshots
   */
  async getOptionsSnapshot(params: OptionsSnapshotsParams): Promise<OptionsSnapshotsResponse> {
    // Remove limit and page_token as they may not be supported by this endpoint
    const { limit, page_token, ...requestParams } = params;
    return this.makeRequest('/options/snapshots', 'GET', requestParams, 'v1beta1');
  }

  /**
   * Get condition codes for options trades or quotes
   * Returns the mapping between condition codes and their descriptions
   * @param tickType The type of tick data ('trade' or 'quote')
   * @returns Mapping of condition codes to descriptions
   
   * @see https://docs.alpaca.markets/reference/optionmetaconditions
   */
  async getOptionsConditionCodes(tickType: OptionTickType): Promise<OptionsConditionCodesResponse> {
    return this.makeRequest(`/options/meta/conditions/${tickType}`, 'GET', undefined, 'v1beta1');
  }

  /**
   * Get exchange codes for options
   * Returns the mapping between option exchange codes and exchange names
   * @returns Mapping of exchange codes to exchange names
   
   * @see https://docs.alpaca.markets/reference/optionmetaexchanges
   */
  async getOptionsExchangeCodes(): Promise<OptionsExchangeCodesResponse> {
    return this.makeRequest('/options/meta/exchanges', 'GET', undefined, 'v1beta1');
  }

  /**
   * Analyzes an array of option bars and returns a summary string
   * @param bars Array of option bars to analyze
   * @returns A string summarizing the option price data
   */
  static analyzeOptionBars(bars: OptionBar[]): string {
    if (!bars || bars.length === 0) {
      return 'No option price data available';
    }

    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];
    const priceChange = lastBar.c - firstBar.o;
    const percentChange = (priceChange / firstBar.o) * 100;

    const volumeChange = lastBar.v - firstBar.v;
    const percentVolumeChange = firstBar.v > 0 ? (volumeChange / firstBar.v) * 100 : 0;

    const high = Math.max(...bars.map((bar) => bar.h));
    const low = Math.min(...bars.map((bar) => bar.l));
    const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
    const avgVolume = totalVolume / bars.length;

    return (
      `Option Price: $${firstBar.o.toFixed(2)} -> $${lastBar.c.toFixed(2)} (${percentChange.toFixed(2)}%), ` +
      `Volume: ${firstBar.v.toLocaleString()} -> ${lastBar.v.toLocaleString()} (${percentVolumeChange.toFixed(2)}%), ` +
      `High: $${high.toFixed(2)}, Low: $${low.toFixed(2)}, ` +
      `Avg Volume: ${avgVolume.toLocaleString()}`
    );
  }

  /**
   * Formats option greeks for display
   * @param greeks Option greeks object
   * @returns Formatted string with greek values
   */
  static formatOptionGreeks(greeks: any): string {
    if (!greeks) {
      return 'No greeks data available';
    }

    const parts: string[] = [];
    if (greeks.delta !== undefined) parts.push(`Delta: ${greeks.delta.toFixed(4)}`);
    if (greeks.gamma !== undefined) parts.push(`Gamma: ${greeks.gamma.toFixed(4)}`);
    if (greeks.theta !== undefined) parts.push(`Theta: ${greeks.theta.toFixed(4)}`);
    if (greeks.vega !== undefined) parts.push(`Vega: ${greeks.vega.toFixed(4)}`);
    if (greeks.rho !== undefined) parts.push(`Rho: ${greeks.rho.toFixed(4)}`);

    return parts.length > 0 ? parts.join(', ') : 'No greeks data available';
  }

  /**
   * Interprets condition codes using the provided condition codes mapping
   * @param conditionCodes Array of condition codes from trade or quote
   * @param conditionCodesMap Mapping of condition codes to descriptions
   * @returns Formatted string with condition descriptions
   */
  static interpretConditionCodes(conditionCodes: string[], conditionCodesMap: OptionsConditionCodesResponse): string {
    if (!conditionCodes || conditionCodes.length === 0) {
      return 'No conditions';
    }

    const descriptions = conditionCodes
      .map((code) => conditionCodesMap[code] || `Unknown (${code})`)
      .filter((desc) => desc !== undefined);

    return descriptions.length > 0 ? descriptions.join(', ') : 'No condition descriptions available';
  }

  /**
   * Gets the exchange name from exchange code using the provided exchange codes mapping
   * @param exchangeCode Exchange code from trade or quote
   * @param exchangeCodesMap Mapping of exchange codes to names
   * @returns Exchange name or formatted unknown exchange
   */
  static getExchangeName(exchangeCode: string, exchangeCodesMap: OptionsExchangeCodesResponse): string {
    return exchangeCodesMap[exchangeCode] || `Unknown Exchange (${exchangeCode})`;
  }

  /**
   * Fetches news articles from Alpaca API for a symbol, paginating through all results.
   * @param symbol The symbol to fetch news for (e.g., 'AAPL')
   * @param params Optional parameters: start, end, limit, sort, include_content
   * @returns Array of SimpleNews articles
   */
  async fetchNews(
    symbol: string,
    params?: {
      start?: Date | string;
      end?: Date | string;
      limit?: number;
      sort?: 'asc' | 'desc';
      include_content?: boolean;
    }
  ): Promise<SimpleNews[]> {
    const defaultParams = {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(),
      limit: 10,
      sort: 'desc' as const,
      include_content: true,
    };
    const mergedParams = { ...defaultParams, ...params };
    let newsArticles: SimpleNews[] = [];
    let pageToken: string | null = null;
    let hasMorePages = true;
    let fetchedCount = 0;
    const maxLimit = mergedParams.limit;

    // Utility to clean content
    function cleanContent(content: string | undefined): string | undefined {
      if (!content) return undefined;
      // Remove excessive whitespace, newlines, and trim
      return content.replace(/\s+/g, ' ').trim();
    }

    while (hasMorePages) {
      const queryParams: URLSearchParams = new URLSearchParams({
        ...(mergedParams.start && { start: new Date(mergedParams.start).toISOString() }),
        ...(mergedParams.end && { end: new Date(mergedParams.end).toISOString() }),
        ...(symbol && { symbols: symbol }),
        ...(mergedParams.limit && { limit: Math.min(50, maxLimit - fetchedCount).toString() }),
        ...(mergedParams.sort && { sort: mergedParams.sort }),
        ...(mergedParams.include_content !== undefined ? { include_content: mergedParams.include_content.toString() } : {}),
        ...(pageToken && { page_token: pageToken }),
      });
      const url: string = `${this.v1beta1url}/news?${queryParams}`;
      log(`Fetching news from: ${url}`, { type: 'debug', symbol });
      const response: Response = await fetch(url, {
        method: 'GET',
        headers: this.headers,
      });
      if (!response.ok) {
        const errorText = await response.text();
        log(`Alpaca news API error (${response.status}): ${errorText}`, { type: 'error', symbol });
        throw new Error(`Alpaca news API error (${response.status}): ${errorText}`);
      }
      const data: { news: AlpacaNewsArticle[]; next_page_token: string | null } = await response.json();
      if (!data.news || !Array.isArray(data.news)) {
        log(`No news data found in Alpaca response for ${symbol}`, { type: 'warn', symbol });
        break;
      }
      const transformedNews: SimpleNews[] = data.news.map((article: AlpacaNewsArticle) => ({
        symbols: article.symbols,
        title: article.headline,
        summary: cleanContent(article.summary) ?? '',
        content: article.content ? cleanContent(article.content) : undefined,
        url: article.url,
        source: article.source,
        author: article.author,
        date: article.updated_at || article.created_at,
        updatedDate: article.updated_at || article.created_at,
        sentiment: 0,
      }));
      newsArticles = newsArticles.concat(transformedNews);
      fetchedCount = newsArticles.length;
      pageToken = data.next_page_token || null;
      hasMorePages = !!pageToken && (!maxLimit || fetchedCount < maxLimit);
      log(`Fetched ${transformedNews.length} news articles (total: ${fetchedCount}) for ${symbol}. More pages: ${hasMorePages}`, { type: 'debug', symbol });
      if (maxLimit && fetchedCount >= maxLimit) {
        newsArticles = newsArticles.slice(0, maxLimit);
        break;
      }
    }
    return newsArticles;
  }
}

// Export the singleton instance
export const marketDataAPI = AlpacaMarketDataAPI.getInstance();
