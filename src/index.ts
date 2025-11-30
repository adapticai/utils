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

export const adaptic = {
  types: Types,
  backend: {
    fetchAssetOverview: backend.fetchAssetOverview,
    getApolloClient: backend.getSharedApolloClient,
  },
  alpaca: {
    TradingAPI: AlpacaTradingAPI,
    MarketDataAPI: AlpacaMarketDataAPI,
    makeRequest: Alpaca.makeRequest,
    accountDetails: Alpaca.fetchAccountDetails,
    positions: Alpaca.fetchAllPositions, // to be deprecated
    position: {
      fetch: Alpaca.fetchPosition,
      close: Alpaca.closePosition,
      fetchAll: Alpaca.fetchAllPositions,
      closeAll: Alpaca.closeAllPositions,
      closeAllAfterHours: Alpaca.closeAllPositionsAfterHours,
    },
    portfolioHistory: Alpaca.fetchPortfolioHistory,
    getConfig: Alpaca.getConfiguration,
    updateConfig: Alpaca.updateConfiguration,
    news: Alpaca.fetchNews,
    orders: {
      create: Alpaca.createOrder,
      createLimitOrder: Alpaca.createLimitOrder,
      get: Alpaca.getOrder,
      getAll: Alpaca.getOrders,
      replace: Alpaca.replaceOrder,
      cancel: Alpaca.cancelOrder,
      cancelAll: Alpaca.cancelAllOrders,
    },
    asset: {
      get: Alpaca.getAsset,
    },
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
