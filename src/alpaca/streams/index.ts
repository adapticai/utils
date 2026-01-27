/**
 * Streams Module Index
 * Re-exports all stream-related functionality for Alpaca WebSocket connections.
 *
 * This module provides unified WebSocket streaming for:
 * - Trading updates (order fills, cancellations, etc.)
 * - Stock market data (trades, quotes, bars)
 * - Options market data (trades, quotes, bars)
 * - Crypto market data (trades, quotes, bars)
 *
 * @example
 * ```typescript
 * import { createStreamManager, createAlpacaClient } from '@adaptic/utils';
 *
 * const client = createAlpacaClient({
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret',
 *   accountType: 'PAPER',
 * });
 *
 * // Use the unified stream manager
 * const manager = createStreamManager(client);
 * await manager.connectAll();
 *
 * // Subscribe to stock data
 * manager.subscribeStocks({
 *   trades: ['AAPL', 'MSFT'],
 *   quotes: ['AAPL', 'MSFT'],
 * });
 *
 * // Listen for trading updates
 * const tradingStream = manager.getTradingStream();
 * tradingStream?.on('fill', (update) => {
 *   console.log(`Order filled: ${update.order.symbol}`);
 * });
 *
 * // Or use individual streams directly
 * import { createStockDataStream, createTradingStream } from '@adaptic/utils';
 *
 * const stockStream = createStockDataStream(client);
 * await stockStream.connect();
 * stockStream.subscribeTrades(['AAPL', 'TSLA']);
 * stockStream.on('trade', (trade) => {
 *   console.log(`Trade: ${trade.S} @ ${trade.p}`);
 * });
 * ```
 */

// Base stream exports
export {
  BaseStream,
  StreamConfig,
  StreamState,
  SubscriptionRequest,
  DEFAULT_STREAM_CONFIG,
} from './base-stream';

// Trading stream exports
export {
  TradingStream,
  TradingStreamEvent,
  TradingStreamEventMap,
  createTradingStream,
} from './trading-stream';

// Stock data stream exports
export {
  StockDataStream,
  StockDataFeed,
  StockStreamConfig,
  StockStreamEventMap,
  createStockDataStream,
  DEFAULT_STOCK_STREAM_CONFIG,
} from './stock-stream';

// Option data stream exports
export {
  OptionDataStream,
  OptionDataFeed,
  OptionStreamConfig,
  OptionStreamEventMap,
  createOptionDataStream,
  DEFAULT_OPTION_STREAM_CONFIG,
} from './option-stream';

// Crypto data stream exports
export {
  CryptoDataStream,
  CryptoStreamLocation,
  CryptoStreamConfig,
  CryptoStreamEventMap,
  createCryptoDataStream,
  DEFAULT_CRYPTO_STREAM_CONFIG,
} from './crypto-stream';

// Stream manager exports
export {
  StreamManager,
  StreamStatus,
  DetailedStreamStatus,
  StreamManagerConfig,
  StreamManagerEventMap,
  createStreamManager,
  DEFAULT_STREAM_MANAGER_CONFIG,
} from './stream-manager';
