/**
 * Alpaca SDK Client Factory
 * Provides unified access to Alpaca Trading API using official SDK
 */
import Alpaca from '@alpacahq/alpaca-trade-api';
import { log as baseLog } from '../logging';
import { LogOptions } from '../types/logging-types';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'AlpacaClient' });
};

/**
 * Configuration for Alpaca client
 */
export interface AlpacaClientConfig {
  /** Alpaca API Key */
  apiKey: string;
  /** Alpaca API Secret */
  apiSecret: string;
  /** Account type: PAPER for testing, LIVE for production */
  accountType: 'PAPER' | 'LIVE';
  /** Optional data feed: 'sip' for premium, 'iex' for free tier */
  dataFeed?: 'sip' | 'iex';
}

/**
 * Validated Alpaca credentials with account info
 */
export interface ValidatedCredentials extends AlpacaClientConfig {
  accountId: string;
  accountNumber: string;
  isValid: boolean;
}

/**
 * AlpacaClient wraps the official SDK with additional features:
 * - Connection pooling
 * - Automatic reconnection
 * - Logging
 * - Error handling
 * - Direct API access for endpoints not covered by SDK
 */
export class AlpacaClient {
  private sdk: Alpaca;
  private config: AlpacaClientConfig;
  private isConnected: boolean = false;
  private apiBaseUrl: string;
  private headers: Record<string, string>;

  constructor(config: AlpacaClientConfig) {
    this.config = config;
    this.sdk = new Alpaca({
      keyId: config.apiKey,
      secretKey: config.apiSecret,
      paper: config.accountType === 'PAPER',
      usePolygon: false,
    });

    // Set up for direct API calls
    this.apiBaseUrl = getTradingApiUrl(config.accountType);

    this.headers = {
      'APCA-API-KEY-ID': config.apiKey,
      'APCA-API-SECRET-KEY': config.apiSecret,
      'Content-Type': 'application/json',
    };

    log(`AlpacaClient initialized (${config.accountType} mode)`, { type: 'info' });
  }

  /**
   * Get the underlying SDK instance for direct access
   */
  getSDK(): Alpaca {
    return this.sdk;
  }

  /**
   * Get the configuration
   */
  getConfig(): AlpacaClientConfig {
    return { ...this.config };
  }

  /**
   * Check if using paper trading
   */
  isPaper(): boolean {
    return this.config.accountType === 'PAPER';
  }

  /**
   * Validate credentials by fetching account info
   */
  async validateCredentials(): Promise<ValidatedCredentials> {
    try {
      const account = await this.sdk.getAccount();
      this.isConnected = true;
      return {
        ...this.config,
        accountId: account.id,
        accountNumber: account.account_number,
        isValid: true,
      };
    } catch (error) {
      this.isConnected = false;
      log(`Credential validation failed: ${(error as Error).message}`, { type: 'error' });
      throw error;
    }
  }

  /**
   * Check connection status
   */
  isConnectionValid(): boolean {
    return this.isConnected;
  }

  /**
   * Get the API base URL
   */
  getApiBaseUrl(): string {
    return this.apiBaseUrl;
  }

  /**
   * Get the API headers for authentication
   */
  getHeaders(): Record<string, string> {
    return { ...this.headers };
  }

  /**
   * Make a direct HTTP request to the Alpaca API
   * Use this for endpoints not covered by the SDK
   *
   * @param endpoint - API endpoint (e.g., '/options/contracts')
   * @param method - HTTP method (default: 'GET')
   * @param body - Request body for POST/PUT requests
   * @returns Response data
   */
  async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${endpoint}`;

    const options: RequestInit = {
      method,
      headers: this.headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, {
      ...options,
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed (${response.status}): ${errorText}`);
      }

      // Handle empty responses (e.g., DELETE requests)
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return {} as T;
      }

      return await response.json() as T;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`API request to ${endpoint} failed: ${errorMessage}`, { type: 'error' });
      throw error;
    }
  }
}

// Client cache for connection pooling
const clientCache = new Map<string, AlpacaClient>();

/**
 * Create or get a cached Alpaca client
 * Uses apiKey as cache key for connection pooling
 */
export function createAlpacaClient(config: AlpacaClientConfig): AlpacaClient {
  const cacheKey = `${config.apiKey}-${config.accountType}`;

  if (clientCache.has(cacheKey)) {
    log(`Returning cached client for ${config.accountType}`, { type: 'debug' });
    return clientCache.get(cacheKey)!;
  }

  const client = new AlpacaClient(config);
  clientCache.set(cacheKey, client);
  return client;
}

/**
 * Create a client from environment variables
 */
export function createClientFromEnv(): AlpacaClient {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_SECRET_KEY;
  const accountType = (process.env.ALPACA_ACCOUNT_TYPE as 'PAPER' | 'LIVE') || 'PAPER';

  if (!apiKey || !apiSecret) {
    throw new Error('ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables are required');
  }

  return createAlpacaClient({
    apiKey,
    apiSecret,
    accountType,
  });
}

/**
 * Clear client cache (useful for testing or credential rotation)
 */
export function clearClientCache(): void {
  clientCache.clear();
  log('Client cache cleared', { type: 'info' });
}

export default AlpacaClient;
