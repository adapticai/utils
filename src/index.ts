import * as backend from "./adaptic";
import { AlpacaMarketDataAPI } from "./alpaca-market-data-api";
import { AlpacaTradingAPI } from "./alpaca-trading-api";
import * as Alpaca from "./alpaca/legacy";
import * as av from "./alphavantage";
import * as crypto from "./crypto";
import * as ft from "./format-tools";
import * as mt from "./market-time";
import * as massive from "./massive";
import * as massiveIndices from "./massive-indices";
import fetchTradeMetrics from "./metrics-calcs";
import * as misc from "./misc-utils";
import * as pm from "./performance-metrics";
import * as pu from "./price-utils";
import { TokenBucketRateLimiter, rateLimiters } from "./rate-limiter";
import * as ta from "./technical-analysis";
import * as tu from "./time-utils";
import * as Types from "./types";

// New modular Alpaca SDK imports
import { alpaca as alpacaSDK } from "./alpaca";

// Logger utilities
export { getLogger, resetLogger, setLogger, type Logger } from "./logger";

// Error utilities
export {
  AdapticUtilsError,
  AlpacaApiError,
  AlphaVantageError,
  AuthenticationError,
  DataFormatError,
  HttpClientError,
  HttpServerError,
  MassiveApiError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  WebSocketError,
} from "./errors";

// Auth validation utilities
export {
  validateAlpacaCredentials,
  validateAlphaVantageApiKey,
  validateMassiveApiKey,
} from "./utils/auth-validator";

// API Endpoints Configuration
export {
  MARKET_DATA_API,
  TRADING_API,
  WEBSOCKET_STREAMS,
  getCryptoStreamUrl,
  getOptionsStreamUrl,
  getStockStreamUrl,
  getTradingApiUrl,
  getTradingWebSocketUrl,
  type AccountType,
} from "./config/api-endpoints";

// Cache utilities
export {
  DEFAULT_CACHE_OPTIONS,
  StampedeProtectedCache,
  createStampedeProtectedCache,
  type CacheEntry,
  type CacheLoader,
  type CacheStats,
  type StampedeProtectedCacheOptions,
} from "./cache/stampede-protected-cache";

// Rate limiting utilities
export {
  TokenBucketRateLimiter,
  rateLimiters,
  type RateLimiterConfig,
} from "./rate-limiter";

// Retry utilities with exponential backoff
export { API_RETRY_CONFIGS, withRetry, type RetryConfig } from "./utils/retry";

// HTTP timeout utilities
export {
  DEFAULT_TIMEOUTS,
  createTimeoutSignal,
  getTimeout,
  withTimeout,
} from "./http-timeout";

// Asset Allocation utilities
export {
  AssetAllocationEngine,
  generateOptimalAllocation,
  getDefaultRiskProfile,
} from "./asset-allocation-algorithm";

export * from "./types/asset-allocation-types";

// API Response Validation Schemas
export {
  AVNewsArticleSchema,
  AVNewsResponseSchema,
  // Alpaca schemas
  AlpacaAccountDetailsSchema,
  AlpacaBarSchema,
  AlpacaCryptoBarsResponseSchema,
  AlpacaHistoricalBarsResponseSchema,
  AlpacaLatestBarsResponseSchema,
  AlpacaLatestQuotesResponseSchema,
  AlpacaLatestTradesResponseSchema,
  AlpacaNewsArticleSchema,
  AlpacaNewsResponseSchema,
  AlpacaOrderSchema,
  AlpacaOrdersArraySchema,
  AlpacaPortfolioHistoryResponseSchema,
  AlpacaPositionSchema,
  AlpacaPositionsArraySchema,
  AlpacaQuoteSchema,
  AlpacaTradeSchema,
  // Alpha Vantage schemas
  AlphaVantageQuoteResponseSchema,
  MassiveAggregatesResponseSchema,
  MassiveDailyOpenCloseSchema,
  MassiveErrorResponseSchema,
  MassiveGroupedDailyResponseSchema,
  MassiveLastTradeResponseSchema,
  MassiveTickerDetailsResponseSchema,
  MassiveTickerInfoSchema,
  MassiveTradeSchema as MassiveTradeZodSchema,
  MassiveTradesResponseSchema,
  // Massive schemas
  RawMassivePriceDataSchema,
  ValidationResponseError,
  safeValidateResponse,
  validateResponse,
  type ValidateResponseOptions,
  type ValidationResult,
} from "./schemas";

// Pagination utilities
export {
  paginate,
  paginateAll,
  type CursorPaginationConfig,
  type OffsetPaginationConfig,
  type PaginationConfig,
  type UrlPaginationConfig,
} from "./utils/paginator";

// HTTP connection pooling utilities
export {
  KEEP_ALIVE_DEFAULTS,
  getAgentPoolStatus,
  httpAgent,
  httpsAgent,
  verifyFetchKeepAlive,
  type ConnectionPoolStatus,
} from "./utils/http-keep-alive";

// Re-export all types
export * from "./types";

// Export key classes directly for easier access
export { AlpacaMarketDataAPI } from "./alpaca-market-data-api";
export { AlpacaTradingAPI } from "./alpaca-trading-api";

// Export factory functions for easier instantiation
export const createAlpacaTradingAPI = (
  credentials: Types.AlpacaCredentials,
) => {
  return new AlpacaTradingAPI(credentials);
};

export const createAlpacaMarketDataAPI = () => {
  return AlpacaMarketDataAPI.getInstance();
};

// Export new modular Alpaca SDK wrappers
export * from "./alpaca";

// Trading Policy schemas, types, enums, and defaults
export * as tradingPolicy from "./trading-policy";
export {
  AutonomyMode,
  OverlayType,
  OverlaySeverity,
  OverlayStatus,
  DecisionOutcome,
  DecisionRecordStatus,
  DecisionMemoryOutcome,
  LlmProvider,
} from "./trading-policy/enums";
export type {
  AutonomyPrefs,
  AssetUniversePrefs,
  RiskBudgetPrefs,
  SignalConsumptionPrefs,
  ExecutionPrefs,
  PositionManagementPrefs,
  PortfolioConstructionPrefs,
  OverlayResponsePrefs,
  ModelPrefs,
  AuditNotificationPrefs,
  PolicyMutation,
  EffectiveTradingPolicy,
} from "./trading-policy/schemas";
export { DEFAULT_TRADING_POLICY } from "./trading-policy/defaults/default-trading-policy";

// Export TokenProvider type for Apollo client auth
export type { TokenProvider } from "./adaptic";

export const adaptic = {
  types: Types,
  backend: {
    fetchAssetOverview: backend.fetchAssetOverview,
    getApolloClient: backend.getSharedApolloClient,
    configureAuth: backend.configureAuth,
    isAuthConfigured: backend.isAuthConfigured,
    disconnectClient: backend.disconnectClient,
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
    /** @description Market clock and trading calendar - SDK-based (requires AlpacaClient) */
    sdkClock: alpacaSDK.clock,

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
  massive: {
    fetchTickerInfo: massive.fetchTickerInfo,
    fetchGroupedDaily: massive.fetchGroupedDaily,
    fetchLastTrade: massive.fetchLastTrade,
    fetchLastQuote: massive.fetchLastQuote,
    fetchTrades: massive.fetchTrades,
    fetchPrices: massive.fetchPrices,
    analyseMassivePriceData: massive.analyseMassivePriceData,
    formatPriceData: massive.formatPriceData,
    fetchDailyOpenClose: massive.fetchDailyOpenClose,
    getPreviousClose: massive.getPreviousClose,
  },
  indices: {
    fetchAggregates: massiveIndices.fetchIndicesAggregates,
    fetchPreviousClose: massiveIndices.fetchIndicesPreviousClose,
    fetchDailyOpenClose: massiveIndices.fetchIndicesDailyOpenClose,
    fetchSnapshot: massiveIndices.fetchIndicesSnapshot,
    fetchUniversalSnapshot: massiveIndices.fetchUniversalSnapshot,
    formatBarData: massiveIndices.formatIndicesBarData,
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
    formatDate:
      tu.formatDate /* move to format, keeping here for compatibility  */,
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
    validateMassiveApiKey: misc.validateMassiveApiKey,
  },
  rateLimiter: {
    TokenBucketRateLimiter,
    limiters: rateLimiters,
  },
};

export const adptc = adaptic;
