/**
 * Stream Manager Module
 * Unified management of all Alpaca WebSocket streams with connection pooling and coordination.
 *
 * Features:
 * - Centralized stream lifecycle management
 * - Connection pooling and reuse
 * - Automatic reconnection handling
 * - Coordinated subscriptions across streams
 * - Health monitoring and status reporting
 * - Graceful shutdown
 *
 * @example
 * ```typescript
 * const client = createAlpacaClient(config);
 * const manager = createStreamManager(client);
 *
 * // Connect to specific streams
 * await manager.connectTrading();
 * await manager.connectStockData();
 *
 * // Or connect to all streams at once
 * await manager.connectAll();
 *
 * // Get status
 * const status = manager.getStatus();
 * console.log(status); // { trading: true, stock: true, option: false, crypto: false }
 *
 * // Use individual streams
 * const tradingStream = manager.getTradingStream();
 * tradingStream?.on('fill', (update) => console.log('Order filled!'));
 *
 * // Graceful shutdown
 * await manager.disconnectAll();
 * ```
 */
import { AlpacaClient } from '../client';
import { EventEmitter } from 'events';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import { TradingStream, createTradingStream, TradingStreamEventMap } from './trading-stream';
import { StockDataStream, createStockDataStream, StockStreamConfig, StockStreamEventMap } from './stock-stream';
import { OptionDataStream, createOptionDataStream, OptionStreamConfig, OptionStreamEventMap } from './option-stream';
import { CryptoDataStream, createCryptoDataStream, CryptoStreamConfig, CryptoStreamEventMap } from './crypto-stream';
import { StreamConfig, StreamState, SubscriptionRequest } from './base-stream';

/**
 * Log helper for StreamManager
 */
const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'StreamManager' });
};

/**
 * Stream connection status for all managed streams
 */
export interface StreamStatus {
  /** Trading stream connected status */
  trading: boolean;
  /** Stock data stream connected status */
  stock: boolean;
  /** Option data stream connected status */
  option: boolean;
  /** Crypto data stream connected status */
  crypto: boolean;
}

/**
 * Detailed stream status with state information
 */
export interface DetailedStreamStatus {
  trading: { connected: boolean; state: StreamState };
  stock: { connected: boolean; state: StreamState };
  option: { connected: boolean; state: StreamState };
  crypto: { connected: boolean; state: StreamState };
}

/**
 * Stream manager configuration
 */
export interface StreamManagerConfig {
  /** Base stream configuration */
  baseConfig: Partial<StreamConfig>;
  /** Stock stream specific configuration */
  stockConfig: Partial<StockStreamConfig>;
  /** Option stream specific configuration */
  optionConfig: Partial<OptionStreamConfig>;
  /** Crypto stream specific configuration */
  cryptoConfig: Partial<CryptoStreamConfig>;
  /** Auto-connect streams on creation */
  autoConnect: boolean;
  /** Enable health monitoring */
  healthMonitoring: boolean;
  /** Health check interval in milliseconds */
  healthCheckInterval: number;
}

/**
 * Default stream manager configuration
 */
export const DEFAULT_STREAM_MANAGER_CONFIG: StreamManagerConfig = {
  baseConfig: {},
  stockConfig: {},
  optionConfig: {},
  cryptoConfig: {},
  autoConnect: false,
  healthMonitoring: true,
  healthCheckInterval: 30000,
};

/**
 * Stream manager event map
 */
export interface StreamManagerEventMap {
  'stream:connected': { stream: 'trading' | 'stock' | 'option' | 'crypto' };
  'stream:disconnected': { stream: 'trading' | 'stock' | 'option' | 'crypto'; code: number; reason: string };
  'stream:error': { stream: 'trading' | 'stock' | 'option' | 'crypto'; error: Error };
  'all:connected': void;
  'all:disconnected': void;
  'health:check': StreamStatus;
}

/**
 * Unified Stream Manager
 * Manages all WebSocket connections for a client with connection pooling and coordination.
 */
export class StreamManager extends EventEmitter {
  private client: AlpacaClient;
  private config: StreamManagerConfig;
  private tradingStream: TradingStream | null = null;
  private stockStream: StockDataStream | null = null;
  private optionStream: OptionDataStream | null = null;
  private cryptoStream: CryptoDataStream | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  constructor(client: AlpacaClient, config: Partial<StreamManagerConfig> = {}) {
    super();
    this.client = client;
    this.config = { ...DEFAULT_STREAM_MANAGER_CONFIG, ...config };

    if (this.config.healthMonitoring) {
      this.startHealthMonitoring();
    }
  }

  /**
   * Connect to the trading stream
   * @returns The connected trading stream
   */
  async connectTrading(): Promise<TradingStream> {
    if (this.isShuttingDown) {
      throw new Error('Stream manager is shutting down');
    }

    if (!this.tradingStream) {
      this.tradingStream = createTradingStream(this.client, this.config.baseConfig);
      this.setupStreamEventHandlers(this.tradingStream, 'trading');
    }

    if (!this.tradingStream.isStreamConnected()) {
      log('Connecting to trading stream');
      await this.tradingStream.connect();
    }

    return this.tradingStream;
  }

  /**
   * Connect to the stock data stream
   * @returns The connected stock data stream
   */
  async connectStockData(): Promise<StockDataStream> {
    if (this.isShuttingDown) {
      throw new Error('Stream manager is shutting down');
    }

    if (!this.stockStream) {
      this.stockStream = createStockDataStream(this.client, {
        ...this.config.baseConfig,
        ...this.config.stockConfig,
      });
      this.setupStreamEventHandlers(this.stockStream, 'stock');
    }

    if (!this.stockStream.isStreamConnected()) {
      log('Connecting to stock data stream');
      await this.stockStream.connect();
    }

    return this.stockStream;
  }

  /**
   * Connect to the options data stream
   * @returns The connected option data stream
   */
  async connectOptionData(): Promise<OptionDataStream> {
    if (this.isShuttingDown) {
      throw new Error('Stream manager is shutting down');
    }

    if (!this.optionStream) {
      this.optionStream = createOptionDataStream(this.client, {
        ...this.config.baseConfig,
        ...this.config.optionConfig,
      });
      this.setupStreamEventHandlers(this.optionStream, 'option');
    }

    if (!this.optionStream.isStreamConnected()) {
      log('Connecting to option data stream');
      await this.optionStream.connect();
    }

    return this.optionStream;
  }

  /**
   * Connect to the crypto data stream
   * @returns The connected crypto data stream
   */
  async connectCryptoData(): Promise<CryptoDataStream> {
    if (this.isShuttingDown) {
      throw new Error('Stream manager is shutting down');
    }

    if (!this.cryptoStream) {
      this.cryptoStream = createCryptoDataStream(this.client, {
        ...this.config.baseConfig,
        ...this.config.cryptoConfig,
      });
      this.setupStreamEventHandlers(this.cryptoStream, 'crypto');
    }

    if (!this.cryptoStream.isStreamConnected()) {
      log('Connecting to crypto data stream');
      await this.cryptoStream.connect();
    }

    return this.cryptoStream;
  }

  /**
   * Connect all streams concurrently
   */
  async connectAll(): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error('Stream manager is shutting down');
    }

    log('Connecting all streams', { type: 'info' });

    const results = await Promise.allSettled([
      this.connectTrading(),
      this.connectStockData(),
      this.connectOptionData(),
      this.connectCryptoData(),
    ]);

    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      const errors = failed.map((f) => f.reason?.message || 'Unknown error').join(', ');
      log(`Some streams failed to connect: ${errors}`, { type: 'warn' });
    }

    const allConnected = results.every((r) => r.status === 'fulfilled');
    if (allConnected) {
      log('All streams connected successfully', { type: 'info' });
      this.emit('all:connected');
    }
  }

  /**
   * Connect only market data streams (stock, option, crypto)
   */
  async connectMarketData(): Promise<void> {
    log('Connecting market data streams', { type: 'info' });

    await Promise.allSettled([
      this.connectStockData(),
      this.connectOptionData(),
      this.connectCryptoData(),
    ]);
  }

  /**
   * Disconnect from the trading stream
   */
  disconnectTrading(): void {
    if (this.tradingStream) {
      log('Disconnecting trading stream');
      this.tradingStream.disconnect();
    }
  }

  /**
   * Disconnect from the stock data stream
   */
  disconnectStockData(): void {
    if (this.stockStream) {
      log('Disconnecting stock data stream');
      this.stockStream.disconnect();
    }
  }

  /**
   * Disconnect from the option data stream
   */
  disconnectOptionData(): void {
    if (this.optionStream) {
      log('Disconnecting option data stream');
      this.optionStream.disconnect();
    }
  }

  /**
   * Disconnect from the crypto data stream
   */
  disconnectCryptoData(): void {
    if (this.cryptoStream) {
      log('Disconnecting crypto data stream');
      this.cryptoStream.disconnect();
    }
  }

  /**
   * Disconnect all streams
   */
  disconnectAll(): void {
    log('Disconnecting all streams', { type: 'info' });
    this.isShuttingDown = true;

    this.disconnectTrading();
    this.disconnectStockData();
    this.disconnectOptionData();
    this.disconnectCryptoData();

    this.emit('all:disconnected');
    this.isShuttingDown = false;
  }

  /**
   * Graceful shutdown - disconnect all streams and cleanup
   */
  async shutdown(): Promise<void> {
    log('Initiating graceful shutdown', { type: 'info' });
    this.isShuttingDown = true;
    this.stopHealthMonitoring();
    this.disconnectAll();

    // Wait a moment for disconnections to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.tradingStream = null;
    this.stockStream = null;
    this.optionStream = null;
    this.cryptoStream = null;

    log('Shutdown complete', { type: 'info' });
  }

  /**
   * Get simple connection status
   */
  getStatus(): StreamStatus {
    return {
      trading: this.tradingStream?.isStreamConnected() ?? false,
      stock: this.stockStream?.isStreamConnected() ?? false,
      option: this.optionStream?.isStreamConnected() ?? false,
      crypto: this.cryptoStream?.isStreamConnected() ?? false,
    };
  }

  /**
   * Get detailed connection status with state information
   */
  getDetailedStatus(): DetailedStreamStatus {
    return {
      trading: {
        connected: this.tradingStream?.isStreamConnected() ?? false,
        state: this.tradingStream?.getState() ?? 'disconnected',
      },
      stock: {
        connected: this.stockStream?.isStreamConnected() ?? false,
        state: this.stockStream?.getState() ?? 'disconnected',
      },
      option: {
        connected: this.optionStream?.isStreamConnected() ?? false,
        state: this.optionStream?.getState() ?? 'disconnected',
      },
      crypto: {
        connected: this.cryptoStream?.isStreamConnected() ?? false,
        state: this.cryptoStream?.getState() ?? 'disconnected',
      },
    };
  }

  /**
   * Check if any stream is connected
   */
  isAnyConnected(): boolean {
    const status = this.getStatus();
    return status.trading || status.stock || status.option || status.crypto;
  }

  /**
   * Check if all streams are connected
   */
  isAllConnected(): boolean {
    const status = this.getStatus();
    return status.trading && status.stock && status.option && status.crypto;
  }

  /**
   * Get the trading stream (may be null if not connected)
   */
  getTradingStream(): TradingStream | null {
    return this.tradingStream;
  }

  /**
   * Get the stock data stream (may be null if not connected)
   */
  getStockStream(): StockDataStream | null {
    return this.stockStream;
  }

  /**
   * Get the option data stream (may be null if not connected)
   */
  getOptionStream(): OptionDataStream | null {
    return this.optionStream;
  }

  /**
   * Get the crypto data stream (may be null if not connected)
   */
  getCryptoStream(): CryptoDataStream | null {
    return this.cryptoStream;
  }

  /**
   * Subscribe to stock market data
   */
  subscribeStocks(request: SubscriptionRequest): void {
    if (this.stockStream) {
      this.stockStream.subscribe(request);
    } else {
      log('Stock stream not initialized. Call connectStockData() first.', { type: 'warn' });
    }
  }

  /**
   * Subscribe to option market data
   */
  subscribeOptions(request: SubscriptionRequest): void {
    if (this.optionStream) {
      this.optionStream.subscribe(request);
    } else {
      log('Option stream not initialized. Call connectOptionData() first.', { type: 'warn' });
    }
  }

  /**
   * Subscribe to crypto market data
   */
  subscribeCrypto(request: SubscriptionRequest): void {
    if (this.cryptoStream) {
      this.cryptoStream.subscribe(request);
    } else {
      log('Crypto stream not initialized. Call connectCryptoData() first.', { type: 'warn' });
    }
  }

  /**
   * Unsubscribe from stock market data
   */
  unsubscribeStocks(request: SubscriptionRequest): void {
    if (this.stockStream) {
      this.stockStream.unsubscribe(request);
    }
  }

  /**
   * Unsubscribe from option market data
   */
  unsubscribeOptions(request: SubscriptionRequest): void {
    if (this.optionStream) {
      this.optionStream.unsubscribe(request);
    }
  }

  /**
   * Unsubscribe from crypto market data
   */
  unsubscribeCrypto(request: SubscriptionRequest): void {
    if (this.cryptoStream) {
      this.cryptoStream.unsubscribe(request);
    }
  }

  /**
   * Get all current subscriptions
   */
  getAllSubscriptions(): {
    stock: SubscriptionRequest;
    option: SubscriptionRequest;
    crypto: SubscriptionRequest;
  } {
    return {
      stock: this.stockStream?.getSubscriptions() ?? { trades: [], quotes: [], bars: [] },
      option: this.optionStream?.getSubscriptions() ?? { trades: [], quotes: [], bars: [] },
      crypto: this.cryptoStream?.getSubscriptions() ?? { trades: [], quotes: [], bars: [] },
    };
  }

  /**
   * Setup event handlers for a stream
   */
  private setupStreamEventHandlers(
    stream: TradingStream | StockDataStream | OptionDataStream | CryptoDataStream,
    type: 'trading' | 'stock' | 'option' | 'crypto'
  ): void {
    // Use EventEmitter's native 'on' method to avoid type conflicts between different stream event maps
    (stream as EventEmitter).on('authenticated', () => {
      this.emit('stream:connected', { stream: type });
    });

    (stream as EventEmitter).on('disconnected', (data: { code: number; reason: string }) => {
      this.emit('stream:disconnected', { stream: type, ...data });
    });

    (stream as EventEmitter).on('error', (error: Error) => {
      this.emit('stream:error', { stream: type, error });
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      const status = this.getStatus();
      this.emit('health:check', status);

      // Log if any stream is disconnected
      const disconnected: string[] = [];
      if (this.tradingStream && !status.trading) disconnected.push('trading');
      if (this.stockStream && !status.stock) disconnected.push('stock');
      if (this.optionStream && !status.option) disconnected.push('option');
      if (this.cryptoStream && !status.crypto) disconnected.push('crypto');

      if (disconnected.length > 0) {
        log(`Disconnected streams detected: ${disconnected.join(', ')}`, { type: 'warn' });
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Type-safe event listener registration
   */
  on<K extends keyof StreamManagerEventMap>(
    event: K,
    listener: (data: StreamManagerEventMap[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Type-safe event emitter
   */
  emit<K extends keyof StreamManagerEventMap>(
    event: K,
    data?: StreamManagerEventMap[K]
  ): boolean {
    return super.emit(event, data);
  }
}

/**
 * Create a stream manager for a client
 */
export function createStreamManager(
  client: AlpacaClient,
  config: Partial<StreamManagerConfig> = {}
): StreamManager {
  return new StreamManager(client, config);
}

export default StreamManager;
