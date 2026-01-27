/**
 * Market Data Module
 * Exports quotes, bars, trades, and news functionality for market data access
 */

// Quotes exports
export {
  getLatestQuote,
  getLatestQuotes,
  getSpread,
  getSpreads,
  hasGoodLiquidity,
  QuoteError,
} from './quotes';

export type { SpreadInfo } from './quotes';

// Bars exports
export {
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
} from './bars';

export type { GetBarsParams, BarAnalysis } from './bars';

// Trades exports
export {
  getLatestTrade,
  getLatestTrades,
  getHistoricalTrades,
  getCurrentPrice,
  getCurrentPrices,
  getTradeVolume,
  TradeError,
} from './trades';

export type { GetHistoricalTradesParams } from './trades';

// News exports
export {
  getNews,
  getLatestNews,
  searchNews,
  getNewsForSymbols,
  getSymbolSentiment,
  NewsError,
} from './news';

export type { GetNewsParams } from './news';
