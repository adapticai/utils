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
import * as av from './alphavantage';
import * as backend from './adaptic';
import * as crypto from './crypto';
import * as ta from './technical-analysis';
export { StampedeProtectedCache, createStampedeProtectedCache, DEFAULT_CACHE_OPTIONS, type StampedeProtectedCacheOptions, type CacheEntry, type CacheStats, type CacheLoader, } from './cache/stampede-protected-cache';
export { AssetAllocationEngine, generateOptimalAllocation, getDefaultRiskProfile } from './asset-allocation-algorithm';
export * from './types/asset-allocation-types';
export * from './types';
export { AlpacaTradingAPI } from './alpaca-trading-api';
export { AlpacaMarketDataAPI } from './alpaca-market-data-api';
export declare const createAlpacaTradingAPI: (credentials: Types.AlpacaCredentials) => Types.AlpacaTradingAPI;
export declare const createAlpacaMarketDataAPI: () => Types.AlpacaMarketDataAPI;
export type { TokenProvider } from './adaptic';
export declare const adaptic: {
    types: typeof Types;
    backend: {
        fetchAssetOverview: (symbol: string) => Promise<Types.AssetOverviewResponse>;
        getApolloClient: () => Promise<any>;
        configureAuth: (provider: backend.TokenProvider) => void;
        isAuthConfigured: () => boolean;
    };
    alpaca: {
        TradingAPI: typeof Types.AlpacaTradingAPI;
        MarketDataAPI: typeof Types.AlpacaMarketDataAPI;
        makeRequest: typeof Alpaca.makeRequest;
        accountDetails: typeof Alpaca.fetchAccountDetails;
        positions: typeof Alpaca.fetchAllPositions;
        position: {
            fetch: typeof Alpaca.fetchPosition;
            close: typeof Alpaca.closePosition;
            fetchAll: typeof Alpaca.fetchAllPositions;
            closeAll: typeof Alpaca.closeAllPositions;
            closeAllAfterHours: typeof Alpaca.closeAllPositionsAfterHours;
        };
        portfolioHistory: typeof Alpaca.fetchPortfolioHistory;
        getConfig: typeof Alpaca.getConfiguration;
        updateConfig: typeof Alpaca.updateConfiguration;
        news: typeof Alpaca.fetchNews;
        orders: {
            create: typeof Alpaca.createOrder;
            createLimitOrder: typeof Alpaca.createLimitOrder;
            get: typeof Alpaca.getOrder;
            getAll: typeof Alpaca.getOrders;
            replace: typeof Alpaca.replaceOrder;
            cancel: typeof Alpaca.cancelOrder;
            cancelAll: typeof Alpaca.cancelAllOrders;
        };
        asset: {
            get: typeof Alpaca.getAsset;
        };
        quote: {
            getLatest: typeof Alpaca.getLatestQuotes;
        };
    };
    av: {
        fetchQuote: (ticker: string, options?: {
            apiKey?: string;
        }) => Promise<Types.AlphaVantageQuoteResponse>;
        fetchTickerNews: (ticker: string, options?: {
            start?: Date;
            end?: Date;
            limit?: number;
            apiKey?: string;
            sort?: "LATEST" | "EARLIEST" | "RELEVANCE";
        }) => Promise<Types.AVNewsArticle[]>;
        convertDateToYYYYMMDDTHHMM: typeof av.convertDateToYYYYMMDDTHHMM;
        convertYYYYMMDDTHHMMSSToDate: typeof av.convertYYYYMMDDTHHMMSSToDate;
    };
    crypto: {
        fetchBars: typeof crypto.fetchBars;
        fetchNews: typeof crypto.fetchNews;
        fetchLatestTrades: typeof crypto.fetchLatestTrades;
        fetchLatestQuotes: typeof crypto.fetchLatestQuotes;
    };
    format: {
        capitalize: typeof ft.capitalize;
        enum: typeof ft.formatEnum;
        currency: typeof ft.formatCurrency;
        number: typeof ft.formatNumber;
        percentage: typeof ft.formatPercentage;
        date: (dateString: string, updateDate?: boolean) => string;
        dateToString: (date: Date) => string;
        dateTimeForGS: typeof ft.dateTimeForGS;
    };
    metrics: {
        trade: typeof fetchTradeMetrics;
        alphaAndBeta: typeof pm.calculateAlphaAndBeta;
        maxDrawdown: typeof pm.calculateMaxDrawdown;
        dailyReturns: typeof pm.calculateDailyReturns;
        returnsByDate: typeof pm.alignReturnsByDate;
        beta: typeof pm.calculateBetaFromReturns;
        infoRatio: typeof pm.calculateInformationRatio;
        allpm: typeof pm.fetchPerformanceMetrics;
    };
    polygon: {
        fetchTickerInfo: (symbol: string, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonTickerInfo | null>;
        fetchGroupedDaily: (date: string, options?: {
            apiKey?: string;
            adjusted?: boolean;
            includeOTC?: boolean;
        }) => Promise<Types.PolygonGroupedDailyResponse>;
        fetchLastTrade: (symbol: string, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonQuote>;
        fetchTrades: (symbol: string, options?: {
            apiKey?: string;
            timestamp?: string | number;
            timestampgt?: string | number;
            timestampgte?: string | number;
            timestamplt?: string | number;
            timestamplte?: string | number;
            order?: "asc" | "desc";
            limit?: number;
            sort?: string;
        }) => Promise<Types.PolygonTradesResponse>;
        fetchPrices: (params: {
            ticker: string;
            start: number;
            end?: number;
            multiplier: number;
            timespan: string;
            limit?: number;
        }, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonPriceData[]>;
        analysePolygonPriceData: typeof polygon.analysePolygonPriceData;
        formatPriceData: typeof polygon.formatPriceData;
        fetchDailyOpenClose: (symbol: string, date?: Date, options?: {
            apiKey?: string;
            adjusted?: boolean;
        }) => Promise<Types.PolygonDailyOpenClose>;
        getPreviousClose: typeof polygon.getPreviousClose;
    };
    indices: {
        fetchAggregates: (params: Types.PolygonIndicesAggregatesParams, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonIndicesAggregatesResponse>;
        fetchPreviousClose: (indicesTicker: string, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonIndicesPrevCloseResponse>;
        fetchDailyOpenClose: (indicesTicker: string, date: string, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonIndicesDailyOpenCloseResponse>;
        fetchSnapshot: (params?: Types.PolygonIndicesSnapshotParams, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonIndicesSnapshotResponse>;
        fetchUniversalSnapshot: (tickers: string[], options?: {
            apiKey?: string;
            type?: string;
            order?: string;
            limit?: number;
            sort?: string;
        }) => Promise<any>;
        formatBarData: (data: Types.PolygonIndicesAggregatesResponse) => Array<{
            date: string;
            open: number;
            high: number;
            low: number;
            close: number;
            timestamp: number;
        }>;
    };
    price: {
        roundUp: typeof pu.roundStockPrice;
        equityValues: typeof pu.getEquityValues;
        totalFees: (trade: import("@adaptic/backend-legacy/generated/typegraphql-prisma/models").Trade) => Promise<number>;
    };
    ta: {
        calculateEMA: typeof ta.calculateEMA;
        calculateMACD: typeof ta.calculateMACD;
        calculateRSI: typeof ta.calculateRSI;
        calculateStochasticOscillator: typeof ta.calculateStochasticOscillator;
        calculateBollingerBands: typeof ta.calculateBollingerBands;
        calculateSupportAndResistance: typeof ta.calculateSupportAndResistance;
        calculateFibonacciLevels: typeof ta.calculateFibonacciLevels;
    };
    time: {
        toUnixTimestamp: (ts: string) => number;
        getTimeAgo: typeof tu.getTimeAgo;
        timeAgo: (timestamp?: Date) => string;
        normalizeDate: typeof tu.normalizeDate;
        getDateInNY: typeof mt.getDateInNY;
        createMarketTimeUtil: typeof mt.createMarketTimeUtil;
        getStartAndEndTimestamps: typeof mt.getStartAndEndTimestamps;
        getStartAndEndDates: typeof mt.getStartAndEndDates;
        getMarketOpenClose: typeof mt.getMarketOpenClose;
        calculateTimeRange: typeof tu.calculateTimeRange;
        calculateDaysLeft: (accountCreationDate: Date) => number;
        formatDate: (dateString: string, updateDate?: boolean) => string;
        currentTimeET: () => Date;
        MarketTimeUtil: typeof mt.MarketTimeUtil;
        MARKET_TIMES: Types.MarketTimesConfig;
        getLastTradingDateYYYYMMDD: typeof mt.getLastTradingDateYYYYMMDD;
        getLastFullTradingDate: typeof mt.getLastFullTradingDate;
        getNextMarketDay: typeof mt.getNextMarketDay;
        parseETDateFromAV: (dateString: string) => Date;
        formatToUSEastern: (date: Date, justDate?: boolean) => string;
        unixTimetoUSEastern: (timestamp: number) => {
            date: Date;
            timeString: string;
            dateString: string;
        };
        getMarketStatus: typeof mt.getMarketStatus;
        timeDiffString: (milliseconds: number) => string;
        getNYTimeZone: (date?: Date) => "-04:00" | "-05:00";
        getTradingDate: typeof mt.getTradingDate;
    };
    utils: {
        logIfDebug: (message: string, data?: unknown, type?: "info" | "warn" | "error" | "debug" | "trace") => void;
        fetchWithRetry: typeof misc.fetchWithRetry;
        validatePolygonApiKey: typeof misc.validatePolygonApiKey;
    };
};
export declare const adptc: {
    types: typeof Types;
    backend: {
        fetchAssetOverview: (symbol: string) => Promise<Types.AssetOverviewResponse>;
        getApolloClient: () => Promise<any>;
        configureAuth: (provider: backend.TokenProvider) => void;
        isAuthConfigured: () => boolean;
    };
    alpaca: {
        TradingAPI: typeof Types.AlpacaTradingAPI;
        MarketDataAPI: typeof Types.AlpacaMarketDataAPI;
        makeRequest: typeof Alpaca.makeRequest;
        accountDetails: typeof Alpaca.fetchAccountDetails;
        positions: typeof Alpaca.fetchAllPositions;
        position: {
            fetch: typeof Alpaca.fetchPosition;
            close: typeof Alpaca.closePosition;
            fetchAll: typeof Alpaca.fetchAllPositions;
            closeAll: typeof Alpaca.closeAllPositions;
            closeAllAfterHours: typeof Alpaca.closeAllPositionsAfterHours;
        };
        portfolioHistory: typeof Alpaca.fetchPortfolioHistory;
        getConfig: typeof Alpaca.getConfiguration;
        updateConfig: typeof Alpaca.updateConfiguration;
        news: typeof Alpaca.fetchNews;
        orders: {
            create: typeof Alpaca.createOrder;
            createLimitOrder: typeof Alpaca.createLimitOrder;
            get: typeof Alpaca.getOrder;
            getAll: typeof Alpaca.getOrders;
            replace: typeof Alpaca.replaceOrder;
            cancel: typeof Alpaca.cancelOrder;
            cancelAll: typeof Alpaca.cancelAllOrders;
        };
        asset: {
            get: typeof Alpaca.getAsset;
        };
        quote: {
            getLatest: typeof Alpaca.getLatestQuotes;
        };
    };
    av: {
        fetchQuote: (ticker: string, options?: {
            apiKey?: string;
        }) => Promise<Types.AlphaVantageQuoteResponse>;
        fetchTickerNews: (ticker: string, options?: {
            start?: Date;
            end?: Date;
            limit?: number;
            apiKey?: string;
            sort?: "LATEST" | "EARLIEST" | "RELEVANCE";
        }) => Promise<Types.AVNewsArticle[]>;
        convertDateToYYYYMMDDTHHMM: typeof av.convertDateToYYYYMMDDTHHMM;
        convertYYYYMMDDTHHMMSSToDate: typeof av.convertYYYYMMDDTHHMMSSToDate;
    };
    crypto: {
        fetchBars: typeof crypto.fetchBars;
        fetchNews: typeof crypto.fetchNews;
        fetchLatestTrades: typeof crypto.fetchLatestTrades;
        fetchLatestQuotes: typeof crypto.fetchLatestQuotes;
    };
    format: {
        capitalize: typeof ft.capitalize;
        enum: typeof ft.formatEnum;
        currency: typeof ft.formatCurrency;
        number: typeof ft.formatNumber;
        percentage: typeof ft.formatPercentage;
        date: (dateString: string, updateDate?: boolean) => string;
        dateToString: (date: Date) => string;
        dateTimeForGS: typeof ft.dateTimeForGS;
    };
    metrics: {
        trade: typeof fetchTradeMetrics;
        alphaAndBeta: typeof pm.calculateAlphaAndBeta;
        maxDrawdown: typeof pm.calculateMaxDrawdown;
        dailyReturns: typeof pm.calculateDailyReturns;
        returnsByDate: typeof pm.alignReturnsByDate;
        beta: typeof pm.calculateBetaFromReturns;
        infoRatio: typeof pm.calculateInformationRatio;
        allpm: typeof pm.fetchPerformanceMetrics;
    };
    polygon: {
        fetchTickerInfo: (symbol: string, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonTickerInfo | null>;
        fetchGroupedDaily: (date: string, options?: {
            apiKey?: string;
            adjusted?: boolean;
            includeOTC?: boolean;
        }) => Promise<Types.PolygonGroupedDailyResponse>;
        fetchLastTrade: (symbol: string, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonQuote>;
        fetchTrades: (symbol: string, options?: {
            apiKey?: string;
            timestamp?: string | number;
            timestampgt?: string | number;
            timestampgte?: string | number;
            timestamplt?: string | number;
            timestamplte?: string | number;
            order?: "asc" | "desc";
            limit?: number;
            sort?: string;
        }) => Promise<Types.PolygonTradesResponse>;
        fetchPrices: (params: {
            ticker: string;
            start: number;
            end?: number;
            multiplier: number;
            timespan: string;
            limit?: number;
        }, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonPriceData[]>;
        analysePolygonPriceData: typeof polygon.analysePolygonPriceData;
        formatPriceData: typeof polygon.formatPriceData;
        fetchDailyOpenClose: (symbol: string, date?: Date, options?: {
            apiKey?: string;
            adjusted?: boolean;
        }) => Promise<Types.PolygonDailyOpenClose>;
        getPreviousClose: typeof polygon.getPreviousClose;
    };
    indices: {
        fetchAggregates: (params: Types.PolygonIndicesAggregatesParams, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonIndicesAggregatesResponse>;
        fetchPreviousClose: (indicesTicker: string, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonIndicesPrevCloseResponse>;
        fetchDailyOpenClose: (indicesTicker: string, date: string, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonIndicesDailyOpenCloseResponse>;
        fetchSnapshot: (params?: Types.PolygonIndicesSnapshotParams, options?: {
            apiKey?: string;
        }) => Promise<Types.PolygonIndicesSnapshotResponse>;
        fetchUniversalSnapshot: (tickers: string[], options?: {
            apiKey?: string;
            type?: string;
            order?: string;
            limit?: number;
            sort?: string;
        }) => Promise<any>;
        formatBarData: (data: Types.PolygonIndicesAggregatesResponse) => Array<{
            date: string;
            open: number;
            high: number;
            low: number;
            close: number;
            timestamp: number;
        }>;
    };
    price: {
        roundUp: typeof pu.roundStockPrice;
        equityValues: typeof pu.getEquityValues;
        totalFees: (trade: import("@adaptic/backend-legacy/generated/typegraphql-prisma/models").Trade) => Promise<number>;
    };
    ta: {
        calculateEMA: typeof ta.calculateEMA;
        calculateMACD: typeof ta.calculateMACD;
        calculateRSI: typeof ta.calculateRSI;
        calculateStochasticOscillator: typeof ta.calculateStochasticOscillator;
        calculateBollingerBands: typeof ta.calculateBollingerBands;
        calculateSupportAndResistance: typeof ta.calculateSupportAndResistance;
        calculateFibonacciLevels: typeof ta.calculateFibonacciLevels;
    };
    time: {
        toUnixTimestamp: (ts: string) => number;
        getTimeAgo: typeof tu.getTimeAgo;
        timeAgo: (timestamp?: Date) => string;
        normalizeDate: typeof tu.normalizeDate;
        getDateInNY: typeof mt.getDateInNY;
        createMarketTimeUtil: typeof mt.createMarketTimeUtil;
        getStartAndEndTimestamps: typeof mt.getStartAndEndTimestamps;
        getStartAndEndDates: typeof mt.getStartAndEndDates;
        getMarketOpenClose: typeof mt.getMarketOpenClose;
        calculateTimeRange: typeof tu.calculateTimeRange;
        calculateDaysLeft: (accountCreationDate: Date) => number;
        formatDate: (dateString: string, updateDate?: boolean) => string;
        currentTimeET: () => Date;
        MarketTimeUtil: typeof mt.MarketTimeUtil;
        MARKET_TIMES: Types.MarketTimesConfig;
        getLastTradingDateYYYYMMDD: typeof mt.getLastTradingDateYYYYMMDD;
        getLastFullTradingDate: typeof mt.getLastFullTradingDate;
        getNextMarketDay: typeof mt.getNextMarketDay;
        parseETDateFromAV: (dateString: string) => Date;
        formatToUSEastern: (date: Date, justDate?: boolean) => string;
        unixTimetoUSEastern: (timestamp: number) => {
            date: Date;
            timeString: string;
            dateString: string;
        };
        getMarketStatus: typeof mt.getMarketStatus;
        timeDiffString: (milliseconds: number) => string;
        getNYTimeZone: (date?: Date) => "-04:00" | "-05:00";
        getTradingDate: typeof mt.getTradingDate;
    };
    utils: {
        logIfDebug: (message: string, data?: unknown, type?: "info" | "warn" | "error" | "debug" | "trace") => void;
        fetchWithRetry: typeof misc.fetchWithRetry;
        validatePolygonApiKey: typeof misc.validatePolygonApiKey;
    };
};
//# sourceMappingURL=index.d.ts.map