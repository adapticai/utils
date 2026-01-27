import * as Alpaca from './alpaca-functions';
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

// New modular Alpaca SDK imports
import { alpaca as alpacaSDK } from './alpaca';

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

// Asset Allocation utilities
export {
  AssetAllocationEngine,
  generateOptimalAllocation,
  getDefaultRiskProfile
} from './asset-allocation-algorithm';

export * from './types/asset-allocation-types';

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
    /** @description Standard order operations */
    orders: alpacaSDK.orders,
    /** @description Position management */
    positions: alpacaSDK.positions,
    /** @description Account information and configuration */
    account: alpacaSDK.account,
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

    // =========================================================================
    // DEPRECATED: Legacy API (maintained for backward compatibility)
    // Prefer using the new SDK-based modules above
    // =========================================================================

    /** @deprecated Use new createClient() instead */
    TradingAPI: AlpacaTradingAPI,
    /** @deprecated Use new createClient() instead */
    MarketDataAPI: AlpacaMarketDataAPI,
    /** @deprecated Use new SDK modules instead */
    makeRequest: Alpaca.makeRequest,
    /** @deprecated Use account.getAccountDetails() instead */
    accountDetails: Alpaca.fetchAccountDetails,
    /** @deprecated Use positions.getPositions() instead */
    legacyPositions: Alpaca.fetchAllPositions,
    /** @deprecated Use the new positions module instead */
    position: {
      /** @deprecated Use positions.getPosition() instead */
      fetch: Alpaca.fetchPosition,
      /** @deprecated Use positions.closePosition() instead */
      close: Alpaca.closePosition,
      /** @deprecated Use positions.getPositions() instead */
      fetchAll: Alpaca.fetchAllPositions,
      /** @deprecated Use positions.closeAllPositions() instead */
      closeAll: Alpaca.closeAllPositions,
      /** @deprecated Use positions.closeAllPositionsAfterHours() instead */
      closeAllAfterHours: Alpaca.closeAllPositionsAfterHours,
    },
    /** @deprecated Use account.getPortfolioHistory() instead */
    portfolioHistory: Alpaca.fetchPortfolioHistory,
    /** @deprecated Use account.getAccountConfiguration() instead */
    getConfig: Alpaca.getConfiguration,
    /** @deprecated Use account.updateAccountConfiguration() instead */
    updateConfig: Alpaca.updateConfiguration,
    /** @deprecated Use news.getNews() instead */
    legacyNews: Alpaca.fetchNews,
    /** @deprecated Use the new orders module instead */
    legacyOrders: {
      /** @deprecated Use orders.createOrder() instead */
      create: Alpaca.createOrder,
      /** @deprecated Use orders.createOrder() with type='limit' instead */
      createLimitOrder: Alpaca.createLimitOrder,
      /** @deprecated Use orders.getOrder() instead */
      get: Alpaca.getOrder,
      /** @deprecated Use orders.getOrders() instead */
      getAll: Alpaca.getOrders,
      /** @deprecated Use orders.replaceOrder() instead */
      replace: Alpaca.replaceOrder,
      /** @deprecated Use orders.cancelOrder() instead */
      cancel: Alpaca.cancelOrder,
      /** @deprecated Use orders.cancelAllOrders() instead */
      cancelAll: Alpaca.cancelAllOrders,
    },
    /** @deprecated Use SDK asset functions instead */
    asset: {
      get: Alpaca.getAsset,
    },
    /** @deprecated Use quotes.getLatestQuotes() instead */
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
};

export const adptc = adaptic;

