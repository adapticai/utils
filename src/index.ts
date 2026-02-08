import * as Alpaca from './alpaca/legacy';
import * as pm from './performance-metrics';
import * as tu from './time-utils';
import * as mt from './market-time';
import fetchTradeMetrics from './metrics-calcs';
import * as pu from './price-utils';
import * as ft from './format-tools';
import * as Types from './types';
import * as misc from './misc-utils';
import * as polygon from './polygon';
import * as polygonIndices from './polygon-indices';
import * as av from './alphavantage';
import * as backend from './adaptic';
import * as crypto from './crypto';
import * as ta from './technical-analysis';
import { AlpacaTradingAPI } from './alpaca-trading-api';
import { AlpacaMarketDataAPI } from './alpaca-market-data-api';
import { TokenBucketRateLimiter, rateLimiters } from './rate-limiter';

// New modular Alpaca SDK imports
import { alpaca as alpacaSDK } from './alpaca';

// Logger utilities
export {
  type Logger,
  setLogger,
  getLogger,
  resetLogger,
} from './logger';

// Error utilities
export {
  AdapticUtilsError,
  AlpacaApiError,
  PolygonApiError,
  AlphaVantageError,
  TimeoutError,
  ValidationError,
  AuthenticationError,
  HttpClientError,
  HttpServerError,
  RateLimitError,
  WebSocketError,
  NetworkError,
  DataFormatError,
} from './errors';

// Auth validation utilities
export {
  validateAlpacaCredentials,
  validatePolygonApiKey,
  validateAlphaVantageApiKey,
} from './utils/auth-validator';

// API Endpoints Configuration
export {
  TRADING_API,
  MARKET_DATA_API,
  WEBSOCKET_STREAMS,
  getTradingApiUrl,
  getTradingWebSocketUrl,
  getStockStreamUrl,
  getOptionsStreamUrl,
  getCryptoStreamUrl,
  type AccountType,
} from './config/api-endpoints';

// Cache utilities
export {
  StampedeProtectedCache,
  createStampedeProtectedCache,
  DEFAULT_CACHE_OPTIONS,
  type StampedeProtectedCacheOptions,
  type CacheEntry,
  type CacheStats,
  type CacheLoader,
} from './cache/stampede-protected-cache';

// Rate limiting utilities
export {
  TokenBucketRateLimiter,
  rateLimiters,
  type RateLimiterConfig,
} from './rate-limiter';

// Retry utilities with exponential backoff
export {
  withRetry,
  API_RETRY_CONFIGS,
  type RetryConfig,
} from './utils/retry';

// HTTP timeout utilities
export {
  DEFAULT_TIMEOUTS,
  withTimeout,
  createTimeoutSignal,
  getTimeout,
} from './http-timeout';

// Asset Allocation utilities
export {
  AssetAllocationEngine,
  generateOptimalAllocation,
  getDefaultRiskProfile
} from './asset-allocation-algorithm';

export * from './types/asset-allocation-types';

// API Response Validation Schemas
export {
  validateResponse,
  safeValidateResponse,
  ValidationResponseError,
  type ValidationResult,
  type ValidateResponseOptions,
  // Alpaca schemas
  AlpacaAccountDetailsSchema,
  AlpacaPositionSchema,
  AlpacaPositionsArraySchema,
  AlpacaOrderSchema,
  AlpacaOrdersArraySchema,
  AlpacaBarSchema,
  AlpacaHistoricalBarsResponseSchema,
  AlpacaLatestBarsResponseSchema,
  AlpacaQuoteSchema,
  AlpacaLatestQuotesResponseSchema,
  AlpacaTradeSchema,
  AlpacaLatestTradesResponseSchema,
  AlpacaNewsArticleSchema,
  AlpacaNewsResponseSchema,
  AlpacaPortfolioHistoryResponseSchema,
  AlpacaCryptoBarsResponseSchema,
  // Polygon schemas
  RawPolygonPriceDataSchema,
  PolygonTickerInfoSchema,
  PolygonTickerDetailsResponseSchema,
  PolygonGroupedDailyResponseSchema,
  PolygonDailyOpenCloseSchema,
  PolygonTradeSchema as PolygonTradeZodSchema,
  PolygonTradesResponseSchema,
  PolygonLastTradeResponseSchema,
  PolygonAggregatesResponseSchema,
  PolygonErrorResponseSchema,
  // Alpha Vantage schemas
  AlphaVantageQuoteResponseSchema,
  AVNewsArticleSchema,
  AVNewsResponseSchema,
} from './schemas';

// Pagination utilities
export {
  paginate,
  paginateAll,
  type CursorPaginationConfig,
  type UrlPaginationConfig,
  type OffsetPaginationConfig,
  type PaginationConfig,
} from './utils/paginator';

// HTTP connection pooling utilities
export {
  KEEP_ALIVE_DEFAULTS,
  httpAgent,
  httpsAgent,
  getAgentPoolStatus,
  verifyFetchKeepAlive,
  type ConnectionPoolStatus,
} from './utils/http-keep-alive';

// Re-export all types
export * from './types';

// Export key classes directly for easier access
export { AlpacaTradingAPI } from './alpaca-trading-api';
export { AlpacaMarketDataAPI } from './alpaca-market-data-api';

// Export factory functions for easier instantiation
export const createAlpacaTradingAPI = (credentials: Types.AlpacaCredentials) => {
  return new AlpacaTradingAPI(credentials);
};

export const createAlpacaMarketDataAPI = () => {
  return AlpacaMarketDataAPI.getInstance();
};

// Export new modular Alpaca SDK wrappers
export * from './alpaca';

// Export TokenProvider type for Apollo client auth
export type { TokenProvider } from './adaptic';

export const adaptic = {
  types: Types,
  backend: {
    fetchAssetOverview: backend.fetchAssetOverview,
    getApolloClient: backend.getSharedApolloClient,
    configureAuth: backend.configureAuth,
    isAuthConfigured: backend.isAuthConfigured,
  },
  alpaca: {
    // New SDK-based client factory (RECOMMENDED)
    createClient: alpacaSDK.createClient,
    createClientFromEnv: alpacaSDK.createClientFromEnv,
    clearClientCache: alpacaSDK.clearClientCache,

    // New SDK-based modules (RECOMMENDED)
    /** @description Smart orders: brackets, OCO, OTO, trailing stops */
    smartOrders: alpacaSDK.smartOrders,
    /** @description Standard order operations - SDK-based (requires AlpacaClient) */
    sdkOrders: alpacaSDK.orders,
    /** @description Position management - SDK-based (requires AlpacaClient) */
    sdkPositions: alpacaSDK.positions,
    /** @description Account information and configuration - SDK-based (requires AlpacaClient) */
    sdkAccount: alpacaSDK.account,

    // Legacy API (with original signatures for backward compatibility)
    /** @description Standard order operations - Legacy API (uses AlpacaAuth) */
    orders: {
      create: Alpaca.createOrder,
      createLimitOrder: Alpaca.createLimitOrder,
      get: Alpaca.getOrder,
      getAll: Alpaca.getOrders,
      replace: Alpaca.replaceOrder,
      cancel: Alpaca.cancelOrder,
      cancelAll: Alpaca.cancelAllOrders,
    },
    /** @description Position management - Legacy API (uses AlpacaAuth) */
    positions: {
      fetch: Alpaca.fetchPosition,
      close: Alpaca.closePosition,
      fetchAll: Alpaca.fetchAllPositions,
      closeAll: Alpaca.closeAllPositions,
      closeAllAfterHours: Alpaca.closeAllPositionsAfterHours,
    },
    /** @description Account information - Legacy API (uses AlpacaAuth) */
    account: Alpaca.fetchAccountDetails,
    /** @description Real-time and historical quotes */
    quotes: alpacaSDK.quotes,
    /** @description Historical price bars (OHLCV) */
    bars: alpacaSDK.bars,
    /** @description Trade data */
    trades: alpacaSDK.trades,
    /** @description Market news */
    news: alpacaSDK.news,
    /** @description Options trading and data */
    options: alpacaSDK.options,
    /** @description Cryptocurrency trading and data */
    crypto: alpacaSDK.crypto,
    /** @description Real-time WebSocket streams */
    streams: alpacaSDK.streams,

    // Backward-compatible aliases (engine still references these directly)
    /** @deprecated Use positions module instead */
    position: {
      fetch: Alpaca.fetchPosition,
      close: Alpaca.closePosition,
      fetchAll: Alpaca.fetchAllPositions,
      closeAll: Alpaca.closeAllPositions,
      closeAllAfterHours: Alpaca.closeAllPositionsAfterHours,
    },
    /** @deprecated Use account() instead */
    accountDetails: Alpaca.fetchAccountDetails,
    /** @deprecated Use sdkAccount.getPortfolioHistory() instead */
    portfolioHistory: Alpaca.fetchPortfolioHistory,
    /** @deprecated Use sdkAccount.getAccountConfiguration() instead */
    getConfig: Alpaca.getConfiguration,
    /** @deprecated Use sdkAccount.updateAccountConfiguration() instead */
    updateConfig: Alpaca.updateConfiguration,
    /** @deprecated Use SDK asset functions instead */
    asset: {
      get: Alpaca.getAsset,
    },
    /** @deprecated Use quotes module instead */
    quote: {
      getLatest: Alpaca.getLatestQuotes,
    },
  },
  av: {
    fetchQuote: av.fetchQuote,
    fetchTickerNews: av.fetchTickerNews,
    convertDateToYYYYMMDDTHHMM: av.convertDateToYYYYMMDDTHHMM,
    convertYYYYMMDDTHHMMSSToDate: av.convertYYYYMMDDTHHMMSSToDate,
  },
  crypto: {
    fetchBars: crypto.fetchBars,
    fetchNews: crypto.fetchNews,
    fetchLatestTrades: crypto.fetchLatestTrades,
    fetchLatestQuotes: crypto.fetchLatestQuotes,
  },
  format: {
    capitalize: ft.capitalize,
    enum: ft.formatEnum,
    currency: ft.formatCurrency,
    number: ft.formatNumber,
    percentage: ft.formatPercentage,
    date: tu.formatDate,
    dateToString: tu.formatDateToString,
    dateTimeForGS: ft.dateTimeForGS,
  },
  metrics: {
    trade: fetchTradeMetrics,
    alphaAndBeta: pm.calculateAlphaAndBeta,
    maxDrawdown: pm.calculateMaxDrawdown,
    dailyReturns: pm.calculateDailyReturns,
    returnsByDate: pm.alignReturnsByDate,
    beta: pm.calculateBetaFromReturns,
    infoRatio: pm.calculateInformationRatio,
    allpm: pm.fetchPerformanceMetrics,
  },
  polygon: {
    fetchTickerInfo: polygon.fetchTickerInfo,
    fetchGroupedDaily: polygon.fetchGroupedDaily,
    fetchLastTrade: polygon.fetchLastTrade,
    fetchTrades: polygon.fetchTrades,
    fetchPrices: polygon.fetchPrices,
    analysePolygonPriceData: polygon.analysePolygonPriceData,
    formatPriceData: polygon.formatPriceData,
    fetchDailyOpenClose: polygon.fetchDailyOpenClose,
    getPreviousClose: polygon.getPreviousClose,
  },
  indices: {
    fetchAggregates: polygonIndices.fetchIndicesAggregates,
    fetchPreviousClose: polygonIndices.fetchIndicesPreviousClose,
    fetchDailyOpenClose: polygonIndices.fetchIndicesDailyOpenClose,
    fetchSnapshot: polygonIndices.fetchIndicesSnapshot,
    fetchUniversalSnapshot: polygonIndices.fetchUniversalSnapshot,
    formatBarData: polygonIndices.formatIndicesBarData,
  },
  price: {
    roundUp: pu.roundStockPrice,
    equityValues: pu.getEquityValues,
    totalFees: pu.computeTotalFees,
  },
  ta: {
    calculateEMA: ta.calculateEMA,
    calculateMACD: ta.calculateMACD,
    calculateRSI: ta.calculateRSI,
    calculateStochasticOscillator: ta.calculateStochasticOscillator,
    calculateBollingerBands: ta.calculateBollingerBands,
    calculateSupportAndResistance: ta.calculateSupportAndResistance,
    calculateFibonacciLevels: ta.calculateFibonacciLevels,
  },
  time: {
    toUnixTimestamp: tu.toUnixTimestamp,
    getTimeAgo: tu.getTimeAgo,
    timeAgo: tu.timeAgo,
    normalizeDate: tu.normalizeDate,
    getDateInNY: mt.getDateInNY,
    createMarketTimeUtil: mt.createMarketTimeUtil,
    getStartAndEndTimestamps: mt.getStartAndEndTimestamps,
    getStartAndEndDates: mt.getStartAndEndDates,
    getMarketOpenClose: mt.getMarketOpenClose,
    calculateTimeRange: tu.calculateTimeRange,
    calculateDaysLeft: tu.calculateDaysLeft,
    formatDate: tu.formatDate /* move to format, keeping here for compatibility  */,
    currentTimeET: mt.currentTimeET,
    MarketTimeUtil: mt.MarketTimeUtil,
    MARKET_TIMES: mt.MARKET_TIMES,
    getLastTradingDateYYYYMMDD: mt.getLastTradingDateYYYYMMDD,
    getLastFullTradingDate: mt.getLastFullTradingDate,
    getNextMarketDay: mt.getNextMarketDay,
    parseETDateFromAV: tu.parseETDateFromAV,
    formatToUSEastern: tu.formatToUSEastern,
    unixTimetoUSEastern: tu.unixTimetoUSEastern,
    getMarketStatus: mt.getMarketStatus,
    timeDiffString: tu.timeDiffString,
    getNYTimeZone: mt.getNYTimeZone,
    getTradingDate: mt.getTradingDate,
  },
  utils: {
    logIfDebug: misc.logIfDebug,
    fetchWithRetry: misc.fetchWithRetry,
    validatePolygonApiKey: misc.validatePolygonApiKey,
  },
  rateLimiter: {
    TokenBucketRateLimiter,
    limiters: rateLimiters,
  },
};

export const adptc = adaptic;

