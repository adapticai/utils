/**
 * Stock Data Stream Module
 * Real-time stock quotes, trades, and bars via Alpaca WebSocket
 *
 * Uses the official Alpaca SDK data_stream_v2 for reliable real-time data.
 * Provides automatic reconnection, subscription management, and type-safe events.
 */
import { EventEmitter } from 'events';
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  AlpacaTradeStream,
  AlpacaQuoteStream,
  AlpacaBarStream,
  AlpacaDailyBarStream,
  AlpacaUpdatedBarStream,
  AlpacaTradingStatusStream,
  AlpacaLULDStream,
  AlpacaTradeCorrectionStream,
  AlpacaTradeCancelStream,
  AlpacaOrderImbalanceStream,
  AlpacaStockStreamMessage,
} from '../../types/alpaca-types';
import { StreamConfig, StreamState, SubscriptionRequest, DEFAULT_STREAM_CONFIG } from './base-stream';

// SDK types from @alpacahq/alpaca-trade-api
interface AlpacaSDKTrade {
  Symbol: string;
  ID: number;
  Exchange: string;
  Price: number;
  Size: number;
  Timestamp: string;
  Conditions: string[];
  Tape: string;
}

interface AlpacaSDKQuote {
  Symbol: string;
  BidExchange: string;
  BidPrice: number;
  BidSize: number;
  AskExchange: string;
  AskPrice: number;
  AskSize: number;
  Timestamp: string;
  Conditions: string[];
  Tape: string;
}

interface AlpacaSDKBar {
  Symbol: string;
  OpenPrice: number;
  HighPrice: number;
  LowPrice: number;
  ClosePrice: number;
  Volume: number;
  Timestamp: string;
  VWAP: number;
  TradeCount: number;
}

interface AlpacaSDKStatus {
  Symbol: string;
  StatusCode: string;
  StatusMessage: string;
  ReasonCode: string;
  ReasonMessage: string;
  Timestamp: string;
  Tape: string;
}

interface AlpacaSDKLuld {
  Symbol: string;
  LimitUpPrice: number;
  LimitDownPrice: number;
  Indicator: string;
  Timestamp: string;
  Tape: string;
}

interface AlpacaSDKCancelError {
  Symbol: string;
  ID: number;
  Exchange: string;
  Price: number;
  Size: number;
  CancelErrorAction: string;
  Tape: string;
  Timestamp: string;
}

interface AlpacaSDKCorrection {
  Symbol: string;
  Exchange: string;
  OriginalID: number;
  OriginalPrice: number;
  OriginalSize: number;
  OriginalConditions: string[];
  CorrectedID: number;
  CorrectedPrice: number;
  CorrectedSize: number;
  CorrectedConditions: string[];
  Tape: string;
  Timestamp: string;
}

/**
 * Stock stream data feed type
 */
export type StockDataFeed = 'sip' | 'iex' | 'test';

/**
 * Stock stream configuration
 */
export interface StockStreamConfig extends StreamConfig {
  /** Data feed to use */
  feed: StockDataFeed;
}

/**
 * Default stock stream configuration
 */
export const DEFAULT_STOCK_STREAM_CONFIG: Partial<StockStreamConfig> = {
  ...DEFAULT_STREAM_CONFIG,
  feed: 'sip',
};

/**
 * Stock stream event map for type-safe event handling
 */
export interface StockStreamEventMap {
  trade: AlpacaTradeStream;
  quote: AlpacaQuoteStream;
  bar: AlpacaBarStream;
  dailyBar: AlpacaDailyBarStream;
  updatedBar: AlpacaUpdatedBarStream;
  tradingStatus: AlpacaTradingStatusStream;
  luld: AlpacaLULDStream;
  tradeCorrection: AlpacaTradeCorrectionStream;
  tradeCancel: AlpacaTradeCancelStream;
  orderImbalance: AlpacaOrderImbalanceStream;
  data: AlpacaStockStreamMessage;
  subscription: { trades: string[]; quotes: string[]; bars: string[] };
  authenticated: void;
  connected: void;
  disconnected: { code: number; reason: string };
  stateChange: StreamState;
  error: Error;
}

/**
 * Stock Data Stream class for receiving real-time stock market data
 * Uses the official Alpaca SDK data_stream_v2 for WebSocket management.
 */
export class StockDataStream extends EventEmitter {
  private client: AlpacaClient;
  private socket: any = null;
  private state: StreamState = 'disconnected';
  private feed: StockDataFeed;
  private config: StockStreamConfig;
  private subscriptions: SubscriptionRequest = { trades: [], quotes: [], bars: [] };
  private pendingSubscriptions: SubscriptionRequest | null = null;

  constructor(client: AlpacaClient, config: Partial<StockStreamConfig> = {}) {
    super();
    this.client = client;
    this.config = { ...DEFAULT_STOCK_STREAM_CONFIG, ...config } as StockStreamConfig;
    this.feed = config.feed || DEFAULT_STOCK_STREAM_CONFIG.feed || 'sip';
  }

  /**
   * Log helper
   */
  private log(message: string, options: LogOptions = { type: 'info' }): void {
    baseLog(message, { ...options, source: 'StockDataStream' });
  }

  /**
   * Get the current stream state
   */
  getState(): StreamState {
    return this.state;
  }

  /**
   * Check if stream is connected and authenticated
   */
  isStreamConnected(): boolean {
    return this.state === 'authenticated';
  }

  /**
   * Get current subscriptions
   */
  getSubscriptions(): SubscriptionRequest {
    return { ...this.subscriptions };
  }

  /**
   * Set the data feed
   */
  setFeed(feed: StockDataFeed): void {
    if (this.isStreamConnected()) {
      this.log('Cannot change feed while connected. Disconnect first.', { type: 'warn' });
      return;
    }
    this.feed = feed;
  }

  /**
   * Get the current data feed
   */
  getFeed(): StockDataFeed {
    return this.feed;
  }

  /**
   * Connect to the stock data stream using SDK
   */
  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'authenticated') {
      this.log('Already connected or connecting', { type: 'debug' });
      return;
    }

    return new Promise((resolve, reject) => {
      this.state = 'connecting';
      this.log('Connecting to stock data stream...');

      const sdk = this.client.getSDK();
      this.socket = sdk.data_stream_v2;

      if (!this.socket) {
        this.state = 'error';
        reject(new Error('Stock data stream not available on SDK'));
        return;
      }

      const connectionTimeout = setTimeout(() => {
        if (this.state === 'connecting') {
          this.state = 'error';
          reject(new Error('Connection timeout'));
        }
      }, this.config.connectionTimeout || 30000);

      // Handle connection
      this.socket.onConnect(() => {
        clearTimeout(connectionTimeout);
        this.state = 'connected';
        this.log('WebSocket connected, awaiting authentication');
      });

      // Handle state changes
      this.socket.onStateChange((newState: string) => {
        this.log(`State changed: ${newState}`, { type: 'debug' });
        if (newState === 'authenticated') {
          this.state = 'authenticated';
          this.log('Stock stream authenticated');
          this.emit('authenticated', undefined);
          this.emit('connected', undefined);

          // Send pending subscriptions
          if (this.pendingSubscriptions) {
            this.sendSubscription();
            this.pendingSubscriptions = null;
          }

          resolve();
        }
        this.emit('stateChange', newState as StreamState);
      });

      // Handle errors
      this.socket.onError((err: Error) => {
        this.log(`Stream error: ${err.message}`, { type: 'error' });
        this.emit('error', err);

        if (this.state === 'connecting') {
          clearTimeout(connectionTimeout);
          this.state = 'error';
          reject(err);
        }
      });

      // Handle disconnection
      this.socket.onDisconnect(() => {
        this.state = 'disconnected';
        this.log('Disconnected from stock data stream', { type: 'warn' });
        this.emit('disconnected', { code: 0, reason: 'disconnected' });
      });

      // Set up data handlers
      this.setupDataHandlers();

      // Initiate connection
      this.socket.connect();
    });
  }

  /**
   * Set up all data event handlers for SDK
   */
  private setupDataHandlers(): void {
    // Trade events
    this.socket.onStockTrade((trade: AlpacaSDKTrade) => {
      const converted = this.convertTrade(trade);
      this.emit('trade', converted);
      this.emit('data', converted);
    });

    // Quote events
    this.socket.onStockQuote((quote: AlpacaSDKQuote) => {
      const converted = this.convertQuote(quote);
      this.emit('quote', converted);
      this.emit('data', converted);
    });

    // Bar events (minute bars)
    this.socket.onStockBar((bar: AlpacaSDKBar) => {
      const converted = this.convertBar(bar);
      this.emit('bar', converted);
      this.emit('data', converted);
    });

    // Daily bar events
    this.socket.onStockDailyBar((bar: AlpacaSDKBar) => {
      const converted = this.convertDailyBar(bar);
      this.emit('dailyBar', converted);
      this.emit('data', converted);
    });

    // Updated bar events
    this.socket.onStockUpdatedBar((bar: AlpacaSDKBar) => {
      const converted = this.convertUpdatedBar(bar);
      this.emit('updatedBar', converted);
      this.emit('data', converted);
    });

    // Trading status events
    this.socket.onStatuses((status: AlpacaSDKStatus) => {
      const converted = this.convertStatus(status);
      this.emit('tradingStatus', converted);
      this.emit('data', converted);
    });

    // LULD events
    this.socket.onLulds((luld: AlpacaSDKLuld) => {
      const converted = this.convertLuld(luld);
      this.emit('luld', converted);
      this.emit('data', converted);
    });

    // Cancel/Error events
    this.socket.onCancelErrors((cancelError: AlpacaSDKCancelError) => {
      const converted = this.convertCancelError(cancelError);
      this.emit('tradeCancel', converted);
      this.emit('data', converted);
    });

    // Correction events
    this.socket.onCorrections((correction: AlpacaSDKCorrection) => {
      const converted = this.convertCorrection(correction);
      this.emit('tradeCorrection', converted);
      this.emit('data', converted);
    });
  }

  /**
   * Disconnect from the stock data stream
   */
  disconnect(): void {
    if (!this.socket) {
      this.log('No socket to disconnect', { type: 'warn' });
      return;
    }

    this.log('Disconnecting from stock data stream');
    this.socket.disconnect();
    this.state = 'disconnected';
    this.emit('disconnected', { code: 0, reason: 'manual disconnect' });
  }

  /**
   * Subscribe to market data
   */
  subscribe(request: SubscriptionRequest): void {
    // Merge with existing subscriptions
    if (request.trades) {
      this.subscriptions.trades = [...new Set([...(this.subscriptions.trades || []), ...request.trades])];
    }
    if (request.quotes) {
      this.subscriptions.quotes = [...new Set([...(this.subscriptions.quotes || []), ...request.quotes])];
    }
    if (request.bars) {
      this.subscriptions.bars = [...new Set([...(this.subscriptions.bars || []), ...request.bars])];
    }

    if (this.isStreamConnected()) {
      this.sendSubscription();
    } else {
      this.pendingSubscriptions = { ...this.subscriptions };
    }
  }

  /**
   * Unsubscribe from market data
   */
  unsubscribe(request: SubscriptionRequest): void {
    // Remove from existing subscriptions
    if (request.trades) {
      this.subscriptions.trades = (this.subscriptions.trades || []).filter(
        (s) => !request.trades!.includes(s)
      );
    }
    if (request.quotes) {
      this.subscriptions.quotes = (this.subscriptions.quotes || []).filter(
        (s) => !request.quotes!.includes(s)
      );
    }
    if (request.bars) {
      this.subscriptions.bars = (this.subscriptions.bars || []).filter(
        (s) => !request.bars!.includes(s)
      );
    }

    if (this.isStreamConnected()) {
      this.sendUnsubscription(request);
    }
  }

  /**
   * Subscribe to stock trades
   */
  subscribeTrades(symbols: string[]): void {
    this.subscribe({ trades: symbols });
  }

  /**
   * Subscribe to stock quotes
   */
  subscribeQuotes(symbols: string[]): void {
    this.subscribe({ quotes: symbols });
  }

  /**
   * Subscribe to stock bars
   */
  subscribeBars(symbols: string[]): void {
    this.subscribe({ bars: symbols });
  }

  /**
   * Subscribe to all data types for symbols
   */
  subscribeAll(symbols: string[]): void {
    this.subscribe({ trades: symbols, quotes: symbols, bars: symbols });
  }

  /**
   * Unsubscribe from stock trades
   */
  unsubscribeTrades(symbols: string[]): void {
    this.unsubscribe({ trades: symbols });
  }

  /**
   * Unsubscribe from stock quotes
   */
  unsubscribeQuotes(symbols: string[]): void {
    this.unsubscribe({ quotes: symbols });
  }

  /**
   * Unsubscribe from stock bars
   */
  unsubscribeBars(symbols: string[]): void {
    this.unsubscribe({ bars: symbols });
  }

  /**
   * Unsubscribe from all data types for symbols
   */
  unsubscribeAll(symbols: string[]): void {
    this.unsubscribe({ trades: symbols, quotes: symbols, bars: symbols });
  }

  /**
   * Send subscription request using SDK methods
   */
  private sendSubscription(): void {
    if (!this.socket || !this.isStreamConnected()) {
      this.log('Cannot send subscription: socket not ready', { type: 'warn' });
      return;
    }

    const { trades, quotes, bars } = this.subscriptions;

    if (trades && trades.length > 0) {
      this.socket.subscribeForTrades(trades);
      this.log(`Subscribed to trades: ${trades.join(', ')}`, { type: 'debug' });
    }
    if (quotes && quotes.length > 0) {
      this.socket.subscribeForQuotes(quotes);
      this.log(`Subscribed to quotes: ${quotes.join(', ')}`, { type: 'debug' });
    }
    if (bars && bars.length > 0) {
      this.socket.subscribeForBars(bars);
      this.log(`Subscribed to bars: ${bars.join(', ')}`, { type: 'debug' });
    }

    this.emit('subscription', { trades: trades || [], quotes: quotes || [], bars: bars || [] });
  }

  /**
   * Send unsubscription request using SDK methods
   */
  private sendUnsubscription(request: SubscriptionRequest): void {
    if (!this.socket || !this.isStreamConnected()) {
      this.log('Cannot send unsubscription: socket not ready', { type: 'warn' });
      return;
    }

    if (request.trades && request.trades.length > 0) {
      this.socket.unsubscribeFromTrades(request.trades);
      this.log(`Unsubscribed from trades: ${request.trades.join(', ')}`, { type: 'debug' });
    }
    if (request.quotes && request.quotes.length > 0) {
      this.socket.unsubscribeFromQuotes(request.quotes);
      this.log(`Unsubscribed from quotes: ${request.quotes.join(', ')}`, { type: 'debug' });
    }
    if (request.bars && request.bars.length > 0) {
      this.socket.unsubscribeFromBars(request.bars);
      this.log(`Unsubscribed from bars: ${request.bars.join(', ')}`, { type: 'debug' });
    }
  }

  // Conversion helpers: SDK format -> Stream format
  private convertTrade(trade: AlpacaSDKTrade): AlpacaTradeStream {
    return {
      T: 't',
      S: trade.Symbol,
      i: trade.ID,
      x: trade.Exchange,
      p: trade.Price,
      s: trade.Size,
      c: trade.Conditions || [],
      t: trade.Timestamp,
      z: trade.Tape,
    };
  }

  private convertQuote(quote: AlpacaSDKQuote): AlpacaQuoteStream {
    return {
      T: 'q',
      S: quote.Symbol,
      ax: quote.AskExchange,
      ap: quote.AskPrice,
      as: quote.AskSize,
      bx: quote.BidExchange,
      bp: quote.BidPrice,
      bs: quote.BidSize,
      c: quote.Conditions || [],
      t: quote.Timestamp,
      z: quote.Tape,
    };
  }

  private convertBar(bar: AlpacaSDKBar): AlpacaBarStream {
    return {
      T: 'b',
      S: bar.Symbol,
      o: bar.OpenPrice,
      h: bar.HighPrice,
      l: bar.LowPrice,
      c: bar.ClosePrice,
      v: bar.Volume,
      t: bar.Timestamp,
      vw: bar.VWAP,
      n: bar.TradeCount,
    };
  }

  private convertDailyBar(bar: AlpacaSDKBar): AlpacaDailyBarStream {
    return {
      T: 'd',
      S: bar.Symbol,
      o: bar.OpenPrice,
      h: bar.HighPrice,
      l: bar.LowPrice,
      c: bar.ClosePrice,
      v: bar.Volume,
      t: bar.Timestamp,
      vw: bar.VWAP,
      n: bar.TradeCount,
    };
  }

  private convertUpdatedBar(bar: AlpacaSDKBar): AlpacaUpdatedBarStream {
    return {
      T: 'u',
      S: bar.Symbol,
      o: bar.OpenPrice,
      h: bar.HighPrice,
      l: bar.LowPrice,
      c: bar.ClosePrice,
      v: bar.Volume,
      t: bar.Timestamp,
      vw: bar.VWAP,
      n: bar.TradeCount,
    };
  }

  private convertStatus(status: AlpacaSDKStatus): AlpacaTradingStatusStream {
    return {
      T: 's',
      S: status.Symbol,
      sc: status.StatusCode,
      sm: status.StatusMessage,
      rc: status.ReasonCode,
      rm: status.ReasonMessage,
      t: status.Timestamp,
      z: status.Tape,
    };
  }

  private convertLuld(luld: AlpacaSDKLuld): AlpacaLULDStream {
    return {
      T: 'l',
      S: luld.Symbol,
      lup: luld.LimitUpPrice,
      ldp: luld.LimitDownPrice,
      i: luld.Indicator,
      t: luld.Timestamp,
      z: luld.Tape,
    };
  }

  private convertCancelError(cancelError: AlpacaSDKCancelError): AlpacaTradeCancelStream {
    return {
      T: 'x',
      S: cancelError.Symbol,
      i: cancelError.ID,
      p: cancelError.Price,
      s: cancelError.Size,
      t: cancelError.Timestamp,
      z: cancelError.Tape,
    };
  }

  private convertCorrection(correction: AlpacaSDKCorrection): AlpacaTradeCorrectionStream {
    return {
      T: 'c',
      S: correction.Symbol,
      oi: correction.OriginalID,
      ci: correction.CorrectedID,
      ox: correction.Exchange,
      cx: correction.Exchange,
      op: correction.OriginalPrice,
      cp: correction.CorrectedPrice,
      os: correction.OriginalSize,
      cs: correction.CorrectedSize,
      oc: correction.OriginalConditions || [],
      cc: correction.CorrectedConditions || [],
      t: correction.Timestamp,
      z: correction.Tape,
    };
  }

  /**
   * Type-safe event listener registration
   */
  on<K extends keyof StockStreamEventMap>(
    event: K,
    listener: (data: StockStreamEventMap[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Type-safe event emitter
   */
  emit<K extends keyof StockStreamEventMap>(event: K, data?: StockStreamEventMap[K]): boolean {
    return super.emit(event, data);
  }
}

/**
 * Create a stock data stream for a client
 */
export function createStockDataStream(
  client: AlpacaClient,
  config: Partial<StockStreamConfig> = {}
): StockDataStream {
  return new StockDataStream(client, config);
}

export default StockDataStream;
