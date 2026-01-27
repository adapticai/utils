/**
 * Crypto Data Stream Module
 * Real-time cryptocurrency quotes, trades, and bars via Alpaca WebSocket (24/7)
 *
 * Uses the official Alpaca SDK crypto_stream_v1beta3 for reliable real-time data.
 * Provides automatic reconnection, subscription management, and type-safe events.
 */
import { EventEmitter } from 'events';
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  AlpacaCryptoTradeStream,
  AlpacaCryptoQuoteStream,
  AlpacaCryptoBarStream,
  AlpacaCryptoDailyBarStream,
  AlpacaCryptoUpdatedBarStream,
  AlpacaCryptoStreamMessage,
  CryptoPair,
} from '../../types/alpaca-types';
import { StreamConfig, StreamState, SubscriptionRequest, DEFAULT_STREAM_CONFIG } from './base-stream';

// SDK types from @alpacahq/alpaca-trade-api
interface AlpacaSDKCryptoTrade {
  Timestamp: string;
  Price: number;
  Size: number;
  TakerSide: string;
  Id: number;
}

interface AlpacaSDKCryptoQuote {
  Timestamp: string;
  BidPrice: number;
  BidSize: number;
  AskPrice: number;
  AskSize: number;
}

interface AlpacaSDKCryptoBar {
  Timestamp: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
  VWAP: number;
  TradeCount: number;
}

/**
 * Crypto stream location
 */
export type CryptoStreamLocation = 'us';

/**
 * Crypto stream configuration
 */
export interface CryptoStreamConfig extends StreamConfig {
  /** Location for crypto data */
  location: CryptoStreamLocation;
}

/**
 * Default crypto stream configuration
 */
export const DEFAULT_CRYPTO_STREAM_CONFIG: Partial<CryptoStreamConfig> = {
  ...DEFAULT_STREAM_CONFIG,
  location: 'us',
};

/**
 * Crypto stream event map for type-safe event handling
 */
export interface CryptoStreamEventMap {
  trade: AlpacaCryptoTradeStream;
  quote: AlpacaCryptoQuoteStream;
  bar: AlpacaCryptoBarStream;
  dailyBar: AlpacaCryptoDailyBarStream;
  updatedBar: AlpacaCryptoUpdatedBarStream;
  data: AlpacaCryptoStreamMessage;
  subscription: { trades: string[]; quotes: string[]; bars: string[] };
  authenticated: void;
  connected: void;
  disconnected: { code: number; reason: string };
  stateChange: StreamState;
  error: Error;
}

/**
 * Crypto Data Stream class for receiving real-time cryptocurrency market data
 * Uses the official Alpaca SDK crypto_stream_v1beta3 for WebSocket management.
 * Operates 24/7 for cryptocurrency markets.
 */
export class CryptoDataStream extends EventEmitter {
  private client: AlpacaClient;
  private socket: any = null;
  private state: StreamState = 'disconnected';
  private location: CryptoStreamLocation;
  private config: CryptoStreamConfig;
  private subscriptions: SubscriptionRequest = { trades: [], quotes: [], bars: [] };
  private pendingSubscriptions: SubscriptionRequest | null = null;
  // Map to track symbol association for SDK events (SDK doesn't include symbol in callbacks)
  private currentSymbol: string = '';

  constructor(client: AlpacaClient, config: Partial<CryptoStreamConfig> = {}) {
    super();
    this.client = client;
    this.config = { ...DEFAULT_CRYPTO_STREAM_CONFIG, ...config } as CryptoStreamConfig;
    this.location = config.location || DEFAULT_CRYPTO_STREAM_CONFIG.location || 'us';
  }

  /**
   * Log helper
   */
  private log(message: string, options: LogOptions = { type: 'info' }): void {
    baseLog(message, { ...options, source: 'CryptoDataStream' });
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
   * Set the stream location
   */
  setLocation(location: CryptoStreamLocation): void {
    if (this.isStreamConnected()) {
      this.log('Cannot change location while connected. Disconnect first.', { type: 'warn' });
      return;
    }
    this.location = location;
  }

  /**
   * Get the current stream location
   */
  getLocation(): CryptoStreamLocation {
    return this.location;
  }

  /**
   * Connect to the crypto data stream using SDK
   */
  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'authenticated') {
      this.log('Already connected or connecting', { type: 'debug' });
      return;
    }

    return new Promise((resolve, reject) => {
      this.state = 'connecting';
      this.log('Connecting to crypto data stream...');

      const sdk = this.client.getSDK();
      this.socket = sdk.crypto_stream_v1beta3;

      if (!this.socket) {
        this.state = 'error';
        reject(new Error('Crypto data stream not available on SDK'));
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
          this.log('Crypto stream authenticated');
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
        this.log('Disconnected from crypto data stream', { type: 'warn' });
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
    this.socket.onCryptoTrade((trade: AlpacaSDKCryptoTrade & { Symbol?: string }) => {
      const converted = this.convertTrade(trade);
      this.emit('trade', converted);
      this.emit('data', converted);
    });

    // Quote events
    this.socket.onCryptoQuote((quote: AlpacaSDKCryptoQuote & { Symbol?: string }) => {
      const converted = this.convertQuote(quote);
      this.emit('quote', converted);
      this.emit('data', converted);
    });

    // Bar events (minute bars)
    this.socket.onCryptoBar((bar: AlpacaSDKCryptoBar & { Symbol?: string }) => {
      const converted = this.convertBar(bar);
      this.emit('bar', converted);
      this.emit('data', converted);
    });

    // Daily bar events
    this.socket.onCryptoDailyBar((bar: AlpacaSDKCryptoBar & { Symbol?: string }) => {
      const converted = this.convertDailyBar(bar);
      this.emit('dailyBar', converted);
      this.emit('data', converted);
    });

    // Updated bar events
    this.socket.onCryptoUpdatedBar((bar: AlpacaSDKCryptoBar & { Symbol?: string }) => {
      const converted = this.convertUpdatedBar(bar);
      this.emit('updatedBar', converted);
      this.emit('data', converted);
    });
  }

  /**
   * Disconnect from the crypto data stream
   */
  disconnect(): void {
    if (!this.socket) {
      this.log('No socket to disconnect', { type: 'warn' });
      return;
    }

    this.log('Disconnecting from crypto data stream');
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
   * Subscribe to crypto trades
   */
  subscribeTrades(symbols: string[]): void {
    this.subscribe({ trades: symbols });
  }

  /**
   * Subscribe to crypto quotes
   */
  subscribeQuotes(symbols: string[]): void {
    this.subscribe({ quotes: symbols });
  }

  /**
   * Subscribe to crypto bars
   */
  subscribeBars(symbols: string[]): void {
    this.subscribe({ bars: symbols });
  }

  /**
   * Subscribe to all data types for crypto symbols
   */
  subscribeAll(symbols: string[]): void {
    this.subscribe({ trades: symbols, quotes: symbols, bars: symbols });
  }

  /**
   * Unsubscribe from crypto trades
   */
  unsubscribeTrades(symbols: string[]): void {
    this.unsubscribe({ trades: symbols });
  }

  /**
   * Unsubscribe from crypto quotes
   */
  unsubscribeQuotes(symbols: string[]): void {
    this.unsubscribe({ quotes: symbols });
  }

  /**
   * Unsubscribe from crypto bars
   */
  unsubscribeBars(symbols: string[]): void {
    this.unsubscribe({ bars: symbols });
  }

  /**
   * Unsubscribe from all data types for crypto symbols
   */
  unsubscribeAll(symbols: string[]): void {
    this.unsubscribe({ trades: symbols, quotes: symbols, bars: symbols });
  }

  /**
   * Subscribe to popular crypto pairs
   */
  subscribePopularPairs(): void {
    const popularPairs: CryptoPair[] = ['BTC/USD', 'ETH/USD', 'DOGE/USD', 'LINK/USD', 'AVAX/USD'];
    this.subscribeAll(popularPairs);
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
      this.log(`Subscribed to crypto trades: ${trades.join(', ')}`, { type: 'debug' });
    }
    if (quotes && quotes.length > 0) {
      this.socket.subscribeForQuotes(quotes);
      this.log(`Subscribed to crypto quotes: ${quotes.join(', ')}`, { type: 'debug' });
    }
    if (bars && bars.length > 0) {
      this.socket.subscribeForBars(bars);
      this.log(`Subscribed to crypto bars: ${bars.join(', ')}`, { type: 'debug' });
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
      this.log(`Unsubscribed from crypto trades: ${request.trades.join(', ')}`, { type: 'debug' });
    }
    if (request.quotes && request.quotes.length > 0) {
      this.socket.unsubscribeFromQuotes(request.quotes);
      this.log(`Unsubscribed from crypto quotes: ${request.quotes.join(', ')}`, { type: 'debug' });
    }
    if (request.bars && request.bars.length > 0) {
      this.socket.unsubscribeFromBars(request.bars);
      this.log(`Unsubscribed from crypto bars: ${request.bars.join(', ')}`, { type: 'debug' });
    }
  }

  // Conversion helpers: SDK format -> Stream format
  private convertTrade(trade: AlpacaSDKCryptoTrade & { Symbol?: string }): AlpacaCryptoTradeStream {
    return {
      T: 't',
      S: trade.Symbol || '',
      p: trade.Price,
      s: trade.Size,
      t: trade.Timestamp,
      i: trade.Id,
      tks: trade.TakerSide === 'buy' ? 'B' : 'S',
    };
  }

  private convertQuote(quote: AlpacaSDKCryptoQuote & { Symbol?: string }): AlpacaCryptoQuoteStream {
    return {
      T: 'q',
      S: quote.Symbol || '',
      bp: quote.BidPrice,
      bs: quote.BidSize,
      ap: quote.AskPrice,
      as: quote.AskSize,
      t: quote.Timestamp,
    };
  }

  private convertBar(bar: AlpacaSDKCryptoBar & { Symbol?: string }): AlpacaCryptoBarStream {
    return {
      T: 'b',
      S: bar.Symbol || '',
      o: bar.Open,
      h: bar.High,
      l: bar.Low,
      c: bar.Close,
      v: bar.Volume,
      t: bar.Timestamp,
      n: bar.TradeCount,
      vw: bar.VWAP,
    };
  }

  private convertDailyBar(bar: AlpacaSDKCryptoBar & { Symbol?: string }): AlpacaCryptoDailyBarStream {
    return {
      T: 'd',
      S: bar.Symbol || '',
      o: bar.Open,
      h: bar.High,
      l: bar.Low,
      c: bar.Close,
      v: bar.Volume,
      t: bar.Timestamp,
      n: bar.TradeCount,
      vw: bar.VWAP,
    };
  }

  private convertUpdatedBar(bar: AlpacaSDKCryptoBar & { Symbol?: string }): AlpacaCryptoUpdatedBarStream {
    return {
      T: 'u',
      S: bar.Symbol || '',
      o: bar.Open,
      h: bar.High,
      l: bar.Low,
      c: bar.Close,
      v: bar.Volume,
      t: bar.Timestamp,
      n: bar.TradeCount,
      vw: bar.VWAP,
    };
  }

  /**
   * Type-safe event listener registration
   */
  on<K extends keyof CryptoStreamEventMap>(
    event: K,
    listener: (data: CryptoStreamEventMap[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Type-safe event emitter
   */
  emit<K extends keyof CryptoStreamEventMap>(event: K, data?: CryptoStreamEventMap[K]): boolean {
    return super.emit(event, data);
  }
}

/**
 * Create a crypto data stream for a client
 */
export function createCryptoDataStream(
  client: AlpacaClient,
  config: Partial<CryptoStreamConfig> = {}
): CryptoDataStream {
  return new CryptoDataStream(client, config);
}

export default CryptoDataStream;
