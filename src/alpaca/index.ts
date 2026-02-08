/**
 * Alpaca Module
 * Unified export of all Alpaca functionality using official SDK
 *
 * @module @adaptic/utils/alpaca
 */

// Core client
export * from './client';

// Trading - re-export with explicit names to avoid conflicts
export * from './trading';

// Market Data - use explicit exports
export {
  // Quotes
  getLatestQuote,
  getLatestQuotes,
  getSpread,
  getSpreads,
  hasGoodLiquidity as hasStockLiquidity,
  QuoteError,
  // Types
  type SpreadInfo,
} from './market-data/quotes';

export {
  // Bars
  getBars,
  getLatestBars,
  getDailyPrices,
  getIntradayPrices,
  getPreviousClose,
  analyzeBars,
  getPriceRange,
  getAverageDailyVolume,
  hasSufficientVolume,
  BarError,
  // Types
  type GetBarsParams,
  type BarAnalysis,
} from './market-data/bars';

export {
  // Trades
  getLatestTrade,
  getLatestTrades,
  getHistoricalTrades,
  getCurrentPrice,
  getCurrentPrices,
  getTradeVolume,
  TradeError,
  // Types
  type GetHistoricalTradesParams,
} from './market-data/trades';

export {
  // News
  getNews,
  getLatestNews,
  searchNews,
  getNewsForSymbols,
  getSymbolSentiment,
  NewsError,
  // Types
  type GetNewsParams,
} from './market-data/news';

// Options - use explicit exports with prefixes to avoid conflicts
export {
  // Contracts
  getOptionContracts,
  getOptionContract,
  getOptionChain,
  getExpirationDates,
  getStrikePrices,
  findATMOptions,
  getGroupedOptionChain,
  findOptionsByDelta,
  findNearestExpiration,
  parseOCCSymbol,
  buildOCCSymbol,
  isContractTradable,
  getDaysToExpiration,
  isExpiringWithin,
  // Types
  type GetOptionChainParams,
  type ATMOptionsResult,
  type GroupedOptionChain,
} from './options/contracts';

export {
  // Option Orders
  createOptionOrder,
  buyToOpen,
  sellToClose,
  sellToOpen,
  buyToClose,
  validateMultiLegOrder,
  createMultiLegOptionOrder,
  createVerticalSpread,
  createIronCondor,
  createStraddle,
  createStrangle,
  closeOptionPosition,
  closeAllOptionPositions,
  exerciseOption,
  isOptionOrderTerminal,
  isOptionOrderCancelable,
  // Types
  type SingleLegOptionOrderParams,
  type CloseOptionPositionParams,
  type CloseAllOptionsResult,
  type ExerciseOptionParams,
  type MultiLegValidationResult,
} from './options/orders';

export {
  // Strategies
  buildOptionSymbol,
  createVerticalSpread as createVerticalSpreadAdvanced,
  createIronCondor as createIronCondorAdvanced,
  createStraddle as createStraddleAdvanced,
  createCoveredCall,
  rollOptionPosition,
  createStrangle as createStrangleAdvanced,
  createButterflySpread,
  OptionStrategyError,
  // Types
  type VerticalSpreadParams,
  type IronCondorParams,
  type StraddleParams,
  type CoveredCallParams,
  type RollPositionParams,
  type StrangleParams,
  type ButterflySpreadParams,
} from './options/strategies';

export {
  // Options Data
  getOptionsChain,
  getLatestOptionsQuotes,
  getLatestOptionsTrades,
  getOptionsSnapshots,
  getHistoricalOptionsBars,
  approximateImpliedVolatility,
  calculateMoneyness,
  findATMStrikes,
  calculatePutCallRatio,
  extractGreeks,
  filterByExpiration,
  filterByStrike,
  filterByType,
  getOptionSpread,
  hasGoodLiquidity as hasOptionLiquidity,
  OptionsDataError,
  // Types
  type OptionsFeed,
  type GetHistoricalOptionsBarsParams,
} from './options/data';

// Crypto - use explicit exports with prefixes to avoid conflicts
export {
  // Crypto Orders
  CryptoOrderError,
  CryptoOrderParams,
  createCryptoOrder,
  createCryptoMarketOrder,
  createCryptoLimitOrder,
  createCryptoStopOrder,
  createCryptoStopLimitOrder,
  buyCryptoNotional,
  sellCryptoNotional,
  sellAllCrypto,
  getOpenCryptoOrders,
  cancelAllCryptoOrders,
  isCryptoPair,
} from './crypto/orders';

export {
  // Crypto Data
  CryptoDataError,
  CryptoTrade,
  CryptoQuote,
  GetCryptoBarsParams,
  CryptoSnapshot,
  getCryptoBars,
  getLatestCryptoTrades,
  getLatestCryptoQuotes,
  getCryptoPrice,
  getCryptoSpread,
  getCryptoSnapshots,
  getCryptoTrades,
  getCryptoDailyPrices,
  getCrypto24HourChange,
  getSupportedCryptoPairs,
  getCryptoPairsByQuote,
  isSupportedCryptoPair,
  getPopularCryptoPairs,
  BTC_PAIRS,
  USDT_PAIRS,
  USDC_PAIRS,
  USD_PAIRS,
} from './crypto/data';

// Streams
export * from './streams';

// Legacy AlpacaAuth-based API functions (backward compatibility)
import * as legacyApi from './legacy';
export { legacyApi };

// Convenience namespace export
import { createAlpacaClient, AlpacaClient, AlpacaClientConfig, createClientFromEnv, clearClientCache } from './client';

// Trading imports
import * as trading from './trading/orders';
import * as orderUtils from './trading/order-utils';
import * as bracketOrders from './trading/bracket-orders';
import * as ocoOrders from './trading/oco-orders';
import * as otoOrders from './trading/oto-orders';
import * as trailingStops from './trading/trailing-stops';
import * as smartOrders from './trading/smart-orders';
import * as positions from './trading/positions';
import * as account from './trading/account';

// Market Data imports
import * as quotes from './market-data/quotes';
import * as bars from './market-data/bars';
import * as trades from './market-data/trades';
import * as news from './market-data/news';

// Options imports
import * as optionContracts from './options/contracts';
import * as optionOrders from './options/orders';
import * as optionStrategies from './options/strategies';
import * as optionData from './options/data';

// Crypto imports
import * as cryptoOrders from './crypto/orders';
import * as cryptoData from './crypto/data';

// Streams imports
import * as streams from './streams';

/**
 * Alpaca namespace for convenient access to all functionality
 *
 * @example
 * ```typescript
 * import { alpaca } from '@adaptic/utils';
 *
 * // Create client
 * const client = alpaca.createClient({
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret',
 *   accountType: 'PAPER',
 * });
 *
 * // Use trading functions
 * const order = await alpaca.orders.createOrder(client, { ... });
 *
 * // Use market data functions
 * const quote = await alpaca.quotes.getLatestQuote(client, 'AAPL');
 *
 * // Use smart orders
 * const bracket = await alpaca.smartOrders.createSmartOrder(client, { ... });
 * ```
 */
export const alpaca = {
  // Client factory
  createClient: createAlpacaClient,
  createClientFromEnv,
  clearClientCache,

  // Trading - Orders
  orders: {
    ...trading,
    ...orderUtils,
  },

  // Trading - Smart Orders (brackets, OCO, OTO, trailing stops)
  smartOrders: {
    ...smartOrders,
    bracket: bracketOrders,
    oco: ocoOrders,
    oto: otoOrders,
    trailingStops,
  },

  // Trading - Positions
  positions,

  // Trading - Account
  account,

  // Market Data
  quotes,
  bars,
  trades,
  news,

  // Options
  options: {
    contracts: optionContracts,
    orders: optionOrders,
    strategies: optionStrategies,
    data: optionData,
  },

  // Crypto
  crypto: {
    orders: cryptoOrders,
    data: cryptoData,
  },

  // Streams
  streams,
};

/**
 * Re-export type definitions for external use
 */
export type { AlpacaClient, AlpacaClientConfig };

export default alpaca;
