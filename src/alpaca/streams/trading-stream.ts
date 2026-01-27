/**
 * Trading Stream Module
 * WebSocket stream for real-time trading updates (order fills, cancellations, etc.)
 *
 * Features:
 * - Real-time order status updates
 * - Automatic reconnection with exponential backoff
 * - Type-safe event handling
 * - Comprehensive logging
 *
 * @example
 * ```typescript
 * const client = createAlpacaClient(config);
 * const stream = createTradingStream(client);
 *
 * stream.on('fill', (update) => {
 *   console.log(`Order filled: ${update.order.symbol} @ ${update.price}`);
 * });
 *
 * stream.on('trade_update', (update) => {
 *   console.log(`Trade update: ${update.event}`);
 * });
 *
 * await stream.connect();
 * ```
 */
import { AlpacaClient } from '../client';
import { BaseStream, StreamConfig } from './base-stream';
import { TradeUpdate } from '../../types/alpaca-types';

/**
 * Trading stream event names representing all possible order status changes.
 * These events are emitted when order state changes occur.
 */
export type TradingStreamEvent =
  | 'new'                     // Order has been received and created
  | 'fill'                    // Order has been completely filled
  | 'partial_fill'            // Order has been partially filled
  | 'canceled'                // Order has been canceled
  | 'expired'                 // Order has expired (e.g., day order at market close)
  | 'done_for_day'            // Order is done for the day (not canceled or expired)
  | 'replaced'                // Order has been replaced by another order
  | 'rejected'                // Order has been rejected
  | 'pending_new'             // Order is pending acceptance
  | 'pending_cancel'          // Order cancellation is pending
  | 'pending_replace'         // Order replacement is pending
  | 'calculated'              // Order has been calculated (for multi-leg orders)
  | 'suspended'               // Order has been suspended
  | 'order_cancel_rejected'   // Order cancellation was rejected
  | 'order_replace_rejected'  // Order replacement was rejected
  | 'stopped'                 // Order has been stopped
  | 'accepted'                // Order has been accepted
  | 'accepted_for_bidding';   // Order has been accepted for bidding (auction)

/**
 * Trading stream event map for type-safe event handling.
 * Maps event names to their payload types.
 */
export interface TradingStreamEventMap {
  /** Generic trade update event - emitted for all order changes */
  'trade_update': TradeUpdate;
  /** Emitted when stream is authenticated */
  'authenticated': void;
  /** Emitted when stream is connected */
  'connected': void;
  /** Emitted when stream is disconnected */
  'disconnected': { code: number; reason: string };
  /** Emitted on stream errors */
  'error': Error;
  /** Emitted when max reconnection attempts reached */
  'max_reconnects': void;
  // Individual event types for specific order state changes
  'new': TradeUpdate;
  'fill': TradeUpdate;
  'partial_fill': TradeUpdate;
  'canceled': TradeUpdate;
  'expired': TradeUpdate;
  'done_for_day': TradeUpdate;
  'replaced': TradeUpdate;
  'rejected': TradeUpdate;
  'pending_new': TradeUpdate;
  'pending_cancel': TradeUpdate;
  'pending_replace': TradeUpdate;
  'calculated': TradeUpdate;
  'suspended': TradeUpdate;
  'order_cancel_rejected': TradeUpdate;
  'order_replace_rejected': TradeUpdate;
  'stopped': TradeUpdate;
  'accepted': TradeUpdate;
  'accepted_for_bidding': TradeUpdate;
}

/**
 * Trading Stream class for receiving real-time order updates.
 *
 * Connects to Alpaca's trading WebSocket and provides real-time
 * updates on order status changes including fills, cancellations,
 * rejections, and more.
 *
 * @extends BaseStream
 */
export class TradingStream extends BaseStream {
  protected readonly streamName = 'TradingStream';
  private tradeUpdateCallback: ((update: TradeUpdate) => void) | null = null;
  private orderCallbacks: Map<string, (update: TradeUpdate) => void> = new Map();

  constructor(client: AlpacaClient, config: Partial<StreamConfig> = {}) {
    super(client, config);
  }

  /**
   * Get the WebSocket URL for trading stream
   */
  protected getStreamUrl(): string {
    const isPaper = this.client.isPaper();
    return isPaper
      ? 'wss://paper-api.alpaca.markets/stream'
      : 'wss://api.alpaca.markets/stream';
  }

  /**
   * Override authenticate to use trading stream format
   */
  protected authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) {
        reject(new Error('WebSocket not ready for authentication'));
        return;
      }

      const config = this.client.getConfig();
      const authMessage = {
        action: 'auth',
        key: config.apiKey,
        secret: config.apiSecret,
      };

      const authTimeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, this.config.authTimeout);

      const handleAuthResponse = (data: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.stream === 'authorization') {
            clearTimeout(authTimeout);
            this.ws?.removeListener('message', handleAuthResponse);

            if (message.data?.status === 'authorized') {
              this.state = 'authenticated';
              this.log('Trading stream authenticated');
              this.emit('authenticated');
              this.subscribeToTradeUpdates();
              resolve();
            } else {
              reject(new Error(message.data?.message || 'Authentication failed'));
            }
          }
        } catch (error) {
          // Continue waiting for auth response
        }
      };

      this.ws.on('message', handleAuthResponse);
      this.ws.send(JSON.stringify(authMessage));
    });
  }

  /**
   * Subscribe to trade updates after authentication
   */
  private subscribeToTradeUpdates(): void {
    if (!this.ws || this.ws.readyState !== 1) {
      this.log('Cannot subscribe to trade updates: WebSocket not ready', { type: 'warn' });
      return;
    }

    const listenMessage = {
      action: 'listen',
      data: {
        streams: ['trade_updates'],
      },
    };

    this.log('Subscribing to trade updates');
    this.ws.send(JSON.stringify(listenMessage));
  }

  /**
   * Process incoming messages
   */
  protected processMessage(message: Record<string, unknown>): void {
    const stream = message.stream as string;
    const data = message.data as Record<string, unknown>;

    switch (stream) {
      case 'authorization':
        // Already handled in authenticate
        break;

      case 'listening':
        this.handleListeningMessage(data);
        break;

      case 'trade_updates':
        this.handleTradeUpdate(data as unknown as TradeUpdate);
        break;

      default:
        this.log(`Unknown stream type: ${stream}`, { type: 'debug' });
    }
  }

  /**
   * Handle listening confirmation message
   */
  private handleListeningMessage(data: Record<string, unknown>): void {
    const streams = data.streams as string[] | undefined;
    if (streams?.includes('trade_updates')) {
      this.log('Successfully subscribed to trade updates');
    }
  }

  /**
   * Handle trade update message
   */
  private handleTradeUpdate(update: TradeUpdate): void {
    // Emit the generic trade_update event
    this.emit('trade_update', update);

    // Emit specific event based on update type
    const event = update.event as TradingStreamEvent;
    this.emit(event, update);

    // Call the global callback if set
    if (this.tradeUpdateCallback) {
      this.tradeUpdateCallback(update);
    }

    // Call order-specific callback if registered
    const orderId = update.order.id;
    const orderCallback = this.orderCallbacks.get(orderId);
    if (orderCallback) {
      orderCallback(update);
      // Remove callback for terminal states
      if (this.isTerminalState(update.event)) {
        this.orderCallbacks.delete(orderId);
      }
    }

    this.log(
      `Trade update: ${update.event} for ${update.order.symbol} (${update.order.side} ${update.order.qty || update.order.notional})`,
      { type: 'debug', symbol: update.order.symbol }
    );
  }

  /**
   * Check if an event represents a terminal order state
   */
  private isTerminalState(event: string): boolean {
    return ['fill', 'canceled', 'expired', 'rejected', 'replaced'].includes(event);
  }

  /**
   * Register a callback for trade updates
   * @param callback Function to call when trade updates are received
   */
  onTradeUpdate(callback: (update: TradeUpdate) => void): void {
    this.tradeUpdateCallback = callback;
  }

  /**
   * Remove the trade update callback
   */
  removeTradeUpdateCallback(): void {
    this.tradeUpdateCallback = null;
  }

  /**
   * Register a callback for a specific order's updates.
   * The callback is automatically removed when the order reaches a terminal state.
   *
   * @param orderId The order ID to watch
   * @param callback Function to call when updates for this order are received
   */
  watchOrder(orderId: string, callback: (update: TradeUpdate) => void): void {
    this.orderCallbacks.set(orderId, callback);
    this.log(`Watching order: ${orderId}`, { type: 'debug' });
  }

  /**
   * Stop watching a specific order
   *
   * @param orderId The order ID to stop watching
   */
  unwatchOrder(orderId: string): void {
    this.orderCallbacks.delete(orderId);
    this.log(`Unwatched order: ${orderId}`, { type: 'debug' });
  }

  /**
   * Get all currently watched order IDs
   */
  getWatchedOrders(): string[] {
    return Array.from(this.orderCallbacks.keys());
  }

  /**
   * Wait for an order to reach a terminal state.
   * Returns a promise that resolves with the final trade update.
   *
   * @param orderId The order ID to wait for
   * @param timeoutMs Optional timeout in milliseconds (default: 30000)
   * @returns Promise resolving to the final TradeUpdate
   * @throws Error if timeout is reached
   *
   * @example
   * ```typescript
   * const finalUpdate = await stream.waitForOrderCompletion(order.id, 60000);
   * console.log(`Order ${finalUpdate.event}: ${finalUpdate.order.filled_qty} filled`);
   * ```
   */
  waitForOrderCompletion(orderId: string, timeoutMs: number = 30000): Promise<TradeUpdate> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.unwatchOrder(orderId);
        reject(new Error(`Timeout waiting for order ${orderId} to complete`));
      }, timeoutMs);

      this.watchOrder(orderId, (update) => {
        if (this.isTerminalState(update.event)) {
          clearTimeout(timeout);
          resolve(update);
        }
      });
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Emits 'max_reconnects' event when maximum attempts are reached.
   */
  protected scheduleReconnect(): void {
    if (this.config.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.log(`Max reconnection attempts (${this.config.maxReconnectAttempts}) reached`, { type: 'error' });
      this.emit('max_reconnects');
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff capped at 5x the base delay
    const delay = this.config.reconnectDelay * Math.min(this.reconnectAttempts, 5);

    this.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);

    setTimeout(async () => {
      try {
        await this.connect();
        this.log('Reconnection successful');
        this.emit('connected');
      } catch (error) {
        this.log(`Reconnection failed: ${(error as Error).message}`, { type: 'error' });
        // The handleClose will trigger another scheduleReconnect
      }
    }, delay);
  }

  /**
   * Type-safe event listener registration
   */
  on<K extends keyof TradingStreamEventMap>(
    event: K,
    listener: (data: TradingStreamEventMap[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Type-safe once event listener registration
   */
  once<K extends keyof TradingStreamEventMap>(
    event: K,
    listener: (data: TradingStreamEventMap[K]) => void
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Type-safe event emitter
   */
  emit<K extends keyof TradingStreamEventMap>(
    event: K,
    data?: TradingStreamEventMap[K]
  ): boolean {
    return super.emit(event, data);
  }

  /**
   * Type-safe remove listener
   */
  off<K extends keyof TradingStreamEventMap>(
    event: K,
    listener: (data: TradingStreamEventMap[K]) => void
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

/**
 * Create a trading stream for a client
 */
export function createTradingStream(
  client: AlpacaClient,
  config: Partial<StreamConfig> = {}
): TradingStream {
  return new TradingStream(client, config);
}

export default TradingStream;
