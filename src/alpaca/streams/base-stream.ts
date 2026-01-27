/**
 * Base Stream Module
 * Abstract base class for all Alpaca WebSocket streams
 */
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import { AlpacaClient } from '../client';

/**
 * Stream connection state
 */
export type StreamState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error';

/**
 * Stream configuration options
 */
export interface StreamConfig {
  /** Auto-reconnect on disconnect */
  autoReconnect: boolean;
  /** Reconnect delay in milliseconds */
  reconnectDelay: number;
  /** Maximum reconnection attempts (0 = unlimited) */
  maxReconnectAttempts: number;
  /** Connection timeout in milliseconds */
  connectionTimeout: number;
  /** Authentication timeout in milliseconds */
  authTimeout: number;
  /** Heartbeat interval in milliseconds (0 = disabled) */
  heartbeatInterval: number;
}

/**
 * Default stream configuration
 */
export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  autoReconnect: true,
  reconnectDelay: 5000,
  maxReconnectAttempts: 10,
  connectionTimeout: 30000,
  authTimeout: 10000,
  heartbeatInterval: 30000,
};

/**
 * Subscription request structure
 */
export interface SubscriptionRequest {
  trades?: string[];
  quotes?: string[];
  bars?: string[];
}

/**
 * Abstract base class for all Alpaca WebSocket streams
 */
export abstract class BaseStream extends EventEmitter {
  protected client: AlpacaClient;
  protected ws: WebSocket | null = null;
  protected state: StreamState = 'disconnected';
  protected config: StreamConfig;
  protected reconnectAttempts: number = 0;
  protected reconnectTimer: NodeJS.Timeout | null = null;
  protected heartbeatTimer: NodeJS.Timeout | null = null;
  protected connectionTimer: NodeJS.Timeout | null = null;
  protected subscriptions: SubscriptionRequest = { trades: [], quotes: [], bars: [] };
  protected pendingSubscriptions: SubscriptionRequest | null = null;

  /** Name of the stream for logging */
  protected abstract readonly streamName: string;

  /** WebSocket URL for the stream */
  protected abstract getStreamUrl(): string;

  constructor(client: AlpacaClient, config: Partial<StreamConfig> = {}) {
    super();
    this.client = client;
    this.config = { ...DEFAULT_STREAM_CONFIG, ...config };
  }

  /**
   * Log a message with stream context
   */
  protected log(message: string, options: LogOptions = { type: 'info' }): void {
    baseLog(message, { ...options, source: this.streamName });
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
    return this.state === 'authenticated' && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get current subscriptions
   */
  getSubscriptions(): SubscriptionRequest {
    return { ...this.subscriptions };
  }

  /**
   * Connect to the WebSocket stream
   */
  async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'authenticated') {
      this.log('Already connected or connecting', { type: 'debug' });
      return;
    }

    return new Promise((resolve, reject) => {
      this.state = 'connecting';
      this.log('Connecting to stream...');

      const url = this.getStreamUrl();
      this.ws = new WebSocket(url);

      // Set connection timeout
      this.connectionTimer = setTimeout(() => {
        if (this.state === 'connecting') {
          this.log('Connection timeout', { type: 'error' });
          this.ws?.terminate();
          this.state = 'error';
          reject(new Error('Connection timeout'));
        }
      }, this.config.connectionTimeout);

      this.ws.on('open', () => {
        this.clearConnectionTimer();
        this.state = 'connected';
        this.log('WebSocket connected');
        this.authenticate()
          .then(() => {
            this.startHeartbeat();
            this.reconnectAttempts = 0;
            resolve();
          })
          .catch((error) => {
            this.log(`Authentication failed: ${error.message}`, { type: 'error' });
            this.ws?.close();
            reject(error);
          });
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        this.handleClose(code, reason.toString());
      });

      this.ws.on('error', (error) => {
        this.handleError(error);
        if (this.state === 'connecting') {
          reject(error);
        }
      });
    });
  }

  /**
   * Disconnect from the WebSocket stream
   */
  disconnect(): void {
    this.log('Disconnecting from stream');
    this.clearAllTimers();
    this.config.autoReconnect = false;

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.state = 'disconnected';
    this.emit('disconnected');
  }

  /**
   * Subscribe to market data
   */
  subscribe(request: SubscriptionRequest): void {
    // Merge with existing subscriptions
    if (request.trades) {
      this.subscriptions.trades = Array.from(new Set([...(this.subscriptions.trades || []), ...request.trades]));
    }
    if (request.quotes) {
      this.subscriptions.quotes = Array.from(new Set([...(this.subscriptions.quotes || []), ...request.quotes]));
    }
    if (request.bars) {
      this.subscriptions.bars = Array.from(new Set([...(this.subscriptions.bars || []), ...request.bars]));
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
   * Authenticate with the WebSocket
   */
  protected authenticate(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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

      const handleAuthResponse = (data: WebSocket.Data) => {
        try {
          const messages = JSON.parse(data.toString());
          for (const message of Array.isArray(messages) ? messages : [messages]) {
            if (message.T === 'success' && message.msg === 'authenticated') {
              clearTimeout(authTimeout);
              this.ws?.removeListener('message', handleAuthResponse);
              this.state = 'authenticated';
              this.log('Stream authenticated');
              this.emit('authenticated');

              // Send pending subscriptions
              if (this.pendingSubscriptions) {
                this.sendSubscription();
                this.pendingSubscriptions = null;
              }

              resolve();
              return;
            } else if (message.T === 'error') {
              clearTimeout(authTimeout);
              this.ws?.removeListener('message', handleAuthResponse);
              reject(new Error(message.msg || 'Authentication failed'));
              return;
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
   * Send subscription request
   */
  protected sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('Cannot send subscription: WebSocket not ready', { type: 'warn' });
      return;
    }

    const subMessage: Record<string, unknown> = { action: 'subscribe' };

    if (this.subscriptions.trades && this.subscriptions.trades.length > 0) {
      subMessage.trades = this.subscriptions.trades;
    }
    if (this.subscriptions.quotes && this.subscriptions.quotes.length > 0) {
      subMessage.quotes = this.subscriptions.quotes;
    }
    if (this.subscriptions.bars && this.subscriptions.bars.length > 0) {
      subMessage.bars = this.subscriptions.bars;
    }

    if (Object.keys(subMessage).length > 1) {
      this.log(`Subscribing to: trades=${this.subscriptions.trades?.length || 0}, quotes=${this.subscriptions.quotes?.length || 0}, bars=${this.subscriptions.bars?.length || 0}`, { type: 'debug' });
      this.ws.send(JSON.stringify(subMessage));
    }
  }

  /**
   * Send unsubscription request
   */
  protected sendUnsubscription(request: SubscriptionRequest): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('Cannot send unsubscription: WebSocket not ready', { type: 'warn' });
      return;
    }

    const unsubMessage: Record<string, unknown> = { action: 'unsubscribe' };

    if (request.trades && request.trades.length > 0) {
      unsubMessage.trades = request.trades;
    }
    if (request.quotes && request.quotes.length > 0) {
      unsubMessage.quotes = request.quotes;
    }
    if (request.bars && request.bars.length > 0) {
      unsubMessage.bars = request.bars;
    }

    if (Object.keys(unsubMessage).length > 1) {
      this.log(`Unsubscribing from: trades=${request.trades?.length || 0}, quotes=${request.quotes?.length || 0}, bars=${request.bars?.length || 0}`, { type: 'debug' });
      this.ws.send(JSON.stringify(unsubMessage));
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  protected handleMessage(data: WebSocket.Data): void {
    try {
      const rawData = data.toString();
      const messages = JSON.parse(rawData);

      for (const message of Array.isArray(messages) ? messages : [messages]) {
        this.processMessage(message);
      }
    } catch (error) {
      this.log(`Failed to parse message: ${(error as Error).message}`, { type: 'error' });
    }
  }

  /**
   * Process a single message - to be implemented by subclasses
   */
  protected abstract processMessage(message: Record<string, unknown>): void;

  /**
   * Handle WebSocket close event
   */
  protected handleClose(code: number, reason: string): void {
    this.log(`WebSocket closed: code=${code}, reason=${reason}`, { type: 'warn' });
    this.clearAllTimers();
    this.state = 'disconnected';
    this.emit('disconnected', { code, reason });

    if (this.config.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket error event
   */
  protected handleError(error: Error): void {
    this.log(`WebSocket error: ${error.message}`, { type: 'error' });
    this.state = 'error';
    this.emit('error', error);
  }

  /**
   * Schedule a reconnection attempt
   */
  protected scheduleReconnect(): void {
    if (this.config.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.log(`Max reconnection attempts (${this.config.maxReconnectAttempts}) reached`, { type: 'error' });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.min(this.reconnectAttempts, 5); // Exponential backoff capped at 5x

    this.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.log('Reconnection successful');
      } catch (error) {
        this.log(`Reconnection failed: ${(error as Error).message}`, { type: 'error' });
      }
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  protected startHeartbeat(): void {
    if (this.config.heartbeatInterval <= 0) return;

    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Send ping to keep connection alive
        this.ws.ping();
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  protected stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Clear connection timer
   */
  protected clearConnectionTimer(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  /**
   * Clear all timers
   */
  protected clearAllTimers(): void {
    this.clearConnectionTimer();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export default BaseStream;
