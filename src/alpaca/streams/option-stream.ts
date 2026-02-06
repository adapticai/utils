/**
 * Option Data Stream Module
 * Real-time options quotes, trades, and bars via Alpaca WebSocket
 *
 * Uses the official Alpaca SDK option_stream for reliable real-time data.
 * Provides automatic reconnection, subscription management, and type-safe events.
 */
import { EventEmitter } from 'events';
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  AlpacaOptionTradeStream,
  AlpacaOptionQuoteStream,
  AlpacaOptionBarStream,
  AlpacaOptionStreamMessage,
} from '../../types/alpaca-types';
import { StreamConfig, StreamState, SubscriptionRequest, DEFAULT_STREAM_CONFIG } from './base-stream';

// SDK types from @alpacahq/alpaca-trade-api
interface AlpacaSDKOptionTrade {
  Symbol?: string;
  Exchange: string;
  Price: number;
  Size: number;
  Timestamp: string;
  Condition: string;
}

interface AlpacaSDKOptionQuote {
  Symbol?: string;
  BidExchange: string;
  BidPrice: number;
  BidSize: number;
  AskExchange: string;
  AskPrice: number;
  AskSize: number;
  Timestamp: string;
  Condition: string;
}

/**
 * Option stream data feed type
 */
export type OptionDataFeed = 'opra' | 'indicative';

/**
 * Option stream configuration
 */
export interface OptionStreamConfig extends StreamConfig {
  /** Data feed to use */
  feed: OptionDataFeed;
}

/**
 * Default option stream configuration
 */
export const DEFAULT_OPTION_STREAM_CONFIG: Partial<OptionStreamConfig> = {
  ...DEFAULT_STREAM_CONFIG,
  feed: 'opra',
};

/**
 * Option stream event map for type-safe event handling
 */
export interface OptionStreamEventMap {
  trade: AlpacaOptionTradeStream;
  quote: AlpacaOptionQuoteStream;
  bar: AlpacaOptionBarStream;
  data: AlpacaOptionStreamMessage;
  subscription: { trades: string[]; quotes: string[] };
  authenticated: void;
  connected: void;
  disconnected: { code: number; reason: string };
  stateChange: StreamState;
  error: Error;
}

/**
 * Option Data Stream class for receiving real-time options market data
 * Uses the official Alpaca SDK option_stream for WebSocket management.
 */
export class OptionDataStream extends EventEmitter {
  private client: AlpacaClient;
  private socket: EventEmitter | null = null;
  private state: StreamState = 'disconnected';
  private feed: OptionDataFeed;
  private config: OptionStreamConfig;
  private subscriptions: { trades: string[]; quotes: string[] } = { trades: [], quotes: [] };
  private pendingSubscriptions: { trades: string[]; quotes: string[] } | null = null;

  constructor(client: AlpacaClient, config: Partial<OptionStreamConfig> = {}) {
    super();
    this.client = client;
    this.config = { ...DEFAULT_OPTION_STREAM_CONFIG, ...config } as OptionStreamConfig;
    this.feed = config.feed || DEFAULT_OPTION_STREAM_CONFIG.feed || 'opra';
  }

  /**
   * Log helper
   */
  private log(message: string, options: LogOptions = { type: 'info' }): void {
    baseLog(message, { ...options, source: 'OptionDataStream' });
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
    return { ...this.subscriptions, bars: [] };
  }

  /**
   * Set the data feed
   */
  setFeed(feed: OptionDataFeed): void {
    if (this.isStreamConnected()) {
      this.log('Cannot change feed while connected. Disconnect first.', { type: 'warn' });
      return;
    }
    this.feed = feed;
  }

  /**
   * Get the current data feed
   */
  getFeed(): OptionDataFeed {
    return this.feed;
  }

  /**
   * Connect to the option data stream using SDK
   */
  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'authenticated') {
      this.log('Already connected or connecting', { type: 'debug' });
      return;
    }

    return new Promise((resolve, reject) => {
      this.state = 'connecting';
      this.log('Connecting to option data stream...');

      const sdk = this.client.getSDK();
      this.socket = sdk.option_stream;

      if (!this.socket) {
        this.state = 'error';
        reject(new Error('Option data stream not available on SDK'));
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
          this.log('Option stream authenticated');
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
        this.log('Disconnected from option data stream', { type: 'warn' });
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
    this.socket.onOptionTrade((trade: AlpacaSDKOptionTrade) => {
      const converted = this.convertTrade(trade);
      this.emit('trade', converted);
      this.emit('data', converted);
    });

    // Quote events
    this.socket.onOptionQuote((quote: AlpacaSDKOptionQuote) => {
      const converted = this.convertQuote(quote);
      this.emit('quote', converted);
      this.emit('data', converted);
    });
  }

  /**
   * Disconnect from the option data stream
   */
  disconnect(): void {
    if (!this.socket) {
      this.log('No socket to disconnect', { type: 'warn' });
      return;
    }

    this.log('Disconnecting from option data stream');
    this.socket.disconnect();
    this.state = 'disconnected';
    this.emit('disconnected', { code: 0, reason: 'manual disconnect' });
  }

  /**
   * Subscribe to market data
   */
  subscribe(request: SubscriptionRequest): void {
    // Merge with existing subscriptions (options only support trades and quotes)
    if (request.trades) {
      this.subscriptions.trades = [...new Set([...(this.subscriptions.trades || []), ...request.trades])];
    }
    if (request.quotes) {
      this.subscriptions.quotes = [...new Set([...(this.subscriptions.quotes || []), ...request.quotes])];
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

    if (this.isStreamConnected()) {
      this.sendUnsubscription(request);
    }
  }

  /**
   * Subscribe to option trades
   */
  subscribeTrades(symbols: string[]): void {
    this.subscribe({ trades: symbols });
  }

  /**
   * Subscribe to option quotes
   */
  subscribeQuotes(symbols: string[]): void {
    this.subscribe({ quotes: symbols });
  }

  /**
   * Subscribe to option bars (not supported by SDK - logs warning)
   */
  subscribeBars(symbols: string[]): void {
    this.log('Option bars are not supported by the SDK option_stream', { type: 'warn' });
  }

  /**
   * Subscribe to all data types for option symbols
   */
  subscribeAll(symbols: string[]): void {
    this.subscribe({ trades: symbols, quotes: symbols });
  }

  /**
   * Unsubscribe from option trades
   */
  unsubscribeTrades(symbols: string[]): void {
    this.unsubscribe({ trades: symbols });
  }

  /**
   * Unsubscribe from option quotes
   */
  unsubscribeQuotes(symbols: string[]): void {
    this.unsubscribe({ quotes: symbols });
  }

  /**
   * Unsubscribe from option bars (not supported)
   */
  unsubscribeBars(symbols: string[]): void {
    this.log('Option bars are not supported by the SDK option_stream', { type: 'warn' });
  }

  /**
   * Unsubscribe from all data types for option symbols
   */
  unsubscribeAll(symbols: string[]): void {
    this.unsubscribe({ trades: symbols, quotes: symbols });
  }

  /**
   * Subscribe to options by underlying symbol
   * @param underlying The underlying stock symbol (not used in this implementation)
   * @param contracts Array of option contract symbols to subscribe to
   */
  subscribeByUnderlying(underlying: string, contracts: string[]): void {
    this.subscribeAll(contracts);
  }

  /**
   * Send subscription request using SDK methods
   */
  private sendSubscription(): void {
    if (!this.socket || !this.isStreamConnected()) {
      this.log('Cannot send subscription: socket not ready', { type: 'warn' });
      return;
    }

    const { trades, quotes } = this.subscriptions;

    if (trades && trades.length > 0) {
      this.socket.subscribeForTrades(trades);
      this.log(`Subscribed to option trades: ${trades.join(', ')}`, { type: 'debug' });
    }
    if (quotes && quotes.length > 0) {
      this.socket.subscribeForQuotes(quotes);
      this.log(`Subscribed to option quotes: ${quotes.join(', ')}`, { type: 'debug' });
    }

    this.emit('subscription', { trades: trades || [], quotes: quotes || [] });
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
      this.log(`Unsubscribed from option trades: ${request.trades.join(', ')}`, { type: 'debug' });
    }
    if (request.quotes && request.quotes.length > 0) {
      this.socket.unsubscribeFromQuotes(request.quotes);
      this.log(`Unsubscribed from option quotes: ${request.quotes.join(', ')}`, { type: 'debug' });
    }
  }

  // Conversion helpers: SDK format -> Stream format
  private convertTrade(trade: AlpacaSDKOptionTrade): AlpacaOptionTradeStream {
    return {
      T: 't',
      S: trade.Symbol || '',
      p: trade.Price,
      s: trade.Size,
      c: trade.Condition ? [trade.Condition] : [],
      x: trade.Exchange,
      t: trade.Timestamp,
    };
  }

  private convertQuote(quote: AlpacaSDKOptionQuote): AlpacaOptionQuoteStream {
    return {
      T: 'q',
      S: quote.Symbol || '',
      ap: quote.AskPrice,
      as: quote.AskSize,
      ax: quote.AskExchange,
      bp: quote.BidPrice,
      bs: quote.BidSize,
      bx: quote.BidExchange,
      t: quote.Timestamp,
    };
  }

  /**
   * Type-safe event listener registration
   */
  on<K extends keyof OptionStreamEventMap>(
    event: K,
    listener: (data: OptionStreamEventMap[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Type-safe event emitter
   */
  emit<K extends keyof OptionStreamEventMap>(event: K, data?: OptionStreamEventMap[K]): boolean {
    return super.emit(event, data);
  }
}

/**
 * Create an option data stream for a client
 */
export function createOptionDataStream(
  client: AlpacaClient,
  config: Partial<OptionStreamConfig> = {}
): OptionDataStream {
  return new OptionDataStream(client, config);
}

export default OptionDataStream;
