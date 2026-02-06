/**
 * Centralized API Endpoints Configuration
 *
 * This file defines all Alpaca API base URLs to ensure consistency
 * across the codebase and make updates easier.
 *
 * API Version Guidelines:
 * - Trading API: v2 (stable, production-ready)
 * - Market Data (stocks): v2 (stable)
 * - Market Data (crypto): v1beta3 (latest beta)
 * - Market Data (options): v1beta1 (latest beta)
 * - News API: v1beta1 (latest beta)
 */

/**
 * Account type for trading
 */
export type AccountType = 'PAPER' | 'LIVE';

/**
 * Trading API base URLs (v2)
 * Used for orders, positions, account management
 */
export const TRADING_API = {
  PAPER: 'https://paper-api.alpaca.markets/v2',
  LIVE: 'https://api.alpaca.markets/v2',
} as const;

/**
 * Get trading API base URL for account type
 */
export function getTradingApiUrl(accountType: AccountType): string {
  return TRADING_API[accountType];
}

/**
 * Market Data API base URLs
 */
export const MARKET_DATA_API = {
  /** Stock market data (v2) - bars, quotes, trades */
  STOCKS: 'https://data.alpaca.markets/v2',
  /** Cryptocurrency market data (v1beta3) - latest stable beta */
  CRYPTO: 'https://data.alpaca.markets/v1beta3',
  /** Options market data (v1beta1) */
  OPTIONS: 'https://data.alpaca.markets/v1beta1',
  /** News API (v1beta1) */
  NEWS: 'https://data.alpaca.markets/v1beta1',
} as const;

/**
 * WebSocket stream URLs
 */
export const WEBSOCKET_STREAMS = {
  /** Trading updates (orders, fills, etc.) */
  TRADING: {
    PAPER: 'wss://paper-api.alpaca.markets/stream',
    LIVE: 'wss://api.alpaca.markets/stream',
  },
  /** Stock market data stream (v2) */
  STOCKS: {
    PRODUCTION: 'wss://stream.data.alpaca.markets/v2/sip',
    TEST: 'wss://stream.data.alpaca.markets/v2/test',
  },
  /** Options market data stream (v1beta3) */
  OPTIONS: {
    PRODUCTION: 'wss://stream.data.alpaca.markets/v1beta3/options',
    SANDBOX: 'wss://stream.data.sandbox.alpaca.markets/v1beta3/options',
  },
  /** Crypto market data stream (v1beta3) */
  CRYPTO: {
    PRODUCTION: 'wss://stream.data.alpaca.markets/v1beta3/crypto/us',
    SANDBOX: 'wss://stream.data.sandbox.alpaca.markets/v1beta3/crypto/us',
  },
} as const;

/**
 * Get trading WebSocket URL for account type
 */
export function getTradingWebSocketUrl(accountType: AccountType): string {
  return WEBSOCKET_STREAMS.TRADING[accountType];
}

/**
 * Get stock stream WebSocket URL
 */
export function getStockStreamUrl(mode: 'PRODUCTION' | 'TEST' = 'PRODUCTION'): string {
  return WEBSOCKET_STREAMS.STOCKS[mode];
}

/**
 * Get options stream WebSocket URL
 */
export function getOptionsStreamUrl(mode: 'PRODUCTION' | 'SANDBOX' = 'PRODUCTION'): string {
  return WEBSOCKET_STREAMS.OPTIONS[mode];
}

/**
 * Get crypto stream WebSocket URL
 */
export function getCryptoStreamUrl(mode: 'PRODUCTION' | 'SANDBOX' = 'PRODUCTION'): string {
  return WEBSOCKET_STREAMS.CRYPTO[mode];
}

/**
 * Legacy support - map old API version references to current
 * @deprecated Use the constants above directly
 */
export const LEGACY_API_VERSIONS = {
  /** @deprecated Use MARKET_DATA_API.OPTIONS instead */
  v1beta1: MARKET_DATA_API.OPTIONS,
  /** @deprecated Use MARKET_DATA_API.CRYPTO instead */
  v1beta3: MARKET_DATA_API.CRYPTO,
} as const;
