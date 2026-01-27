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
export * from './alpaca';
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
        createClient: typeof import("./alpaca").createAlpacaClient;
        createClientFromEnv: typeof import("./alpaca").createClientFromEnv;
        clearClientCache: typeof import("./alpaca").clearClientCache;
        /** @description Smart orders: brackets, OCO, OTO, trailing stops */
        smartOrders: {
            bracket: typeof import("./alpaca/trading/bracket-orders");
            oco: typeof import("./alpaca/trading/oco-orders");
            oto: typeof import("./alpaca/trading/oto-orders");
            trailingStops: typeof import("./alpaca/trading/trailing-stops");
            determineOrderType(params: import("./alpaca/trading/smart-orders").SmartOrderParams): import("./alpaca/trading/smart-orders").SmartOrderType;
            createSmartOrder(client: import("./alpaca").AlpacaClient, params: import("./alpaca/trading/smart-orders").SmartOrderParams): Promise<import("./alpaca/trading/smart-orders").SmartOrderResult>;
            createPercentageBracket(client: import("./alpaca").AlpacaClient, params: import("./alpaca/trading/smart-orders").PercentageBracketParams): Promise<import("./alpaca").BracketOrderResult>;
            createRiskManagedPosition(client: import("./alpaca").AlpacaClient, params: import("./alpaca/trading/smart-orders").RiskManagedPositionParams): Promise<import("./alpaca").BracketOrderResult | import("./alpaca").OTOOrderResult>;
            calculateRewardRiskRatio(entryPrice: number, takeProfitPrice: number, stopLossPrice: number, side: Types.OrderSide): number;
            calculatePositionSize(accountValue: number, riskPercent: number, entryPrice: number, stopPrice: number): number;
            default: {
                createSmartOrder: typeof import("./alpaca/trading/smart-orders").createSmartOrder;
                determineOrderType: typeof import("./alpaca/trading/smart-orders").determineOrderType;
                createPercentageBracket: typeof import("./alpaca/trading/smart-orders").createPercentageBracket;
                createRiskManagedPosition: typeof import("./alpaca/trading/smart-orders").createRiskManagedPosition;
                calculateRewardRiskRatio: typeof import("./alpaca/trading/smart-orders").calculateRewardRiskRatio;
                calculatePositionSize: typeof import("./alpaca/trading/smart-orders").calculatePositionSize;
                createBracketOrder: typeof import("./alpaca").createBracketOrder;
                createProtectiveBracket: typeof import("./alpaca").createProtectiveBracket;
                createExecutorFromTradingAPI: typeof import("./alpaca").createExecutorFromTradingAPI;
                createOCOOrder: typeof import("./alpaca").createOCOOrder;
                createOTOOrder: typeof import("./alpaca").createOTOOrder;
                createTrailingStop: typeof import("./alpaca").createTrailingStop;
                updateTrailingStop: typeof import("./alpaca").updateTrailingStop;
            };
            createBracketOrder(executor: import("./alpaca").BracketOrderExecutor, params: import("./alpaca").BracketOrderParams): Promise<import("./alpaca").BracketOrderResult>;
            createProtectiveBracket(executor: import("./alpaca").BracketOrderExecutor, params: import("./alpaca").ProtectiveBracketParams): Promise<import("./alpaca").BracketOrderResult>;
            createExecutorFromTradingAPI(api: {
                makeRequest: (endpoint: string, method: string, body?: unknown) => Promise<Types.AlpacaOrder>;
            }): import("./alpaca").BracketOrderExecutor;
            createOCOOrder(client: import("./alpaca").AlpacaClient, params: import("./alpaca").OCOOrderParams): Promise<import("./alpaca").OCOOrderResult>;
            cancelOCOOrder(client: import("./alpaca").AlpacaClient, parentOrderId: string): Promise<void>;
            getOCOOrderStatus(client: import("./alpaca").AlpacaClient, parentOrderId: string): Promise<Types.AlpacaOrder>;
            protectLongPosition(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, takeProfitPrice: number, stopLossPrice: number, stopLimitPrice?: number): Promise<import("./alpaca").OCOOrderResult>;
            protectShortPosition(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, takeProfitPrice: number, stopLossPrice: number, stopLimitPrice?: number): Promise<import("./alpaca").OCOOrderResult>;
            createOTOOrder(client: import("./alpaca").AlpacaClient, params: import("./alpaca").OTOOrderParams): Promise<import("./alpaca").OTOOrderResult>;
            cancelOTOOrder(client: import("./alpaca").AlpacaClient, parentOrderId: string): Promise<void>;
            getOTOOrderStatus(client: import("./alpaca").AlpacaClient, parentOrderId: string): Promise<Types.AlpacaOrder>;
            buyWithStopLoss(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, stopLossPrice: number, stopLimitPrice?: number): Promise<import("./alpaca").OTOOrderResult>;
            buyWithTrailingStop(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, trailPercent: number): Promise<import("./alpaca").OTOOrderResult>;
            limitBuyWithTakeProfit(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, entryPrice: number, takeProfitPrice: number): Promise<import("./alpaca").OTOOrderResult>;
            shortWithStopLoss(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, entryPrice: number, stopLossPrice: number): Promise<import("./alpaca").OTOOrderResult>;
            entryWithPercentStopLoss(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, entryPrice: number | null, stopLossPercent: number, side?: Types.OrderSide): Promise<import("./alpaca").OTOOrderResult>;
            createTrailingStop(client: import("./alpaca").AlpacaClient, params: import("./alpaca").TrailingStopParams): Promise<Types.AlpacaOrder>;
            updateTrailingStop(client: import("./alpaca").AlpacaClient, orderId: string, updates: {
                trailPercent?: number;
                trailPrice?: number;
            }): Promise<Types.AlpacaOrder>;
            getTrailingStopHWM(client: import("./alpaca").AlpacaClient, orderId: string): Promise<import("./alpaca").TrailingStopHWMResult>;
            cancelTrailingStop(client: import("./alpaca").AlpacaClient, orderId: string): Promise<void>;
            createPortfolioTrailingStops(client: import("./alpaca").AlpacaClient, params: import("./alpaca").PortfolioTrailingStopParams): Promise<Map<string, Types.AlpacaOrder>>;
            getOpenTrailingStops(client: import("./alpaca").AlpacaClient, symbol?: string): Promise<Types.AlpacaOrder[]>;
            hasActiveTrailingStop(client: import("./alpaca").AlpacaClient, symbol: string): Promise<boolean>;
            cancelTrailingStopsForSymbol(client: import("./alpaca").AlpacaClient, symbol: string): Promise<number>;
            TrailingStopValidationError: typeof import("./alpaca").TrailingStopValidationError;
        };
        /** @description Standard order operations - SDK-based (requires AlpacaClient) */
        sdkOrders: {
            getOrdersBySymbol(client: import("./alpaca").AlpacaClient, symbol: string, params?: Omit<Types.GetOrdersParams, "symbols">): Promise<Types.AlpacaOrder[]>;
            getOpenOrders(client: import("./alpaca").AlpacaClient, params?: Omit<Types.GetOrdersParams, "status">): Promise<Types.AlpacaOrder[]>;
            getFilledOrders(client: import("./alpaca").AlpacaClient, params: import("./alpaca").GetFilledOrdersParams): Promise<Types.AlpacaOrder[]>;
            getOrderHistory(client: import("./alpaca").AlpacaClient, params?: import("./alpaca").GetOrderHistoryParams): Promise<import("./alpaca").OrderHistoryResult>;
            getAllOrders(client: import("./alpaca").AlpacaClient, params?: import("./alpaca").GetAllOrdersParams): Promise<Types.AlpacaOrder[]>;
            waitForOrderFill(client: import("./alpaca").AlpacaClient, params: import("./alpaca").WaitForOrderFillParams): Promise<import("./alpaca").WaitForOrderFillResult>;
            isOrderFillable(order: Types.AlpacaOrder): boolean;
            isOrderFilled(order: Types.AlpacaOrder): boolean;
            isOrderTerminal(order: Types.AlpacaOrder): boolean;
            isOrderOpen(order: Types.AlpacaOrder): boolean;
            calculateOrderValue(order: Types.AlpacaOrder): number | null;
            formatOrderSummary(order: Types.AlpacaOrder): import("./alpaca").OrderSummary;
            formatOrderForLog(order: Types.AlpacaOrder): string;
            roundPriceForAlpaca(price: number): string;
            roundPriceForAlpacaNumber(price: number): number;
            groupOrdersBySymbol(orders: Types.AlpacaOrder[]): Map<string, Types.AlpacaOrder[]>;
            groupOrdersByStatus(orders: Types.AlpacaOrder[]): Map<string, Types.AlpacaOrder[]>;
            calculateTotalFilledValue(orders: Types.AlpacaOrder[]): number;
            filterOrdersByDateRange(orders: Types.AlpacaOrder[], startDate: Date, endDate: Date): Types.AlpacaOrder[];
            sortOrdersByDate(orders: Types.AlpacaOrder[], direction?: "asc" | "desc"): Types.AlpacaOrder[];
            default: {
                getOrdersBySymbol: typeof import("./alpaca").getOrdersBySymbol;
                getOpenOrders: typeof import("./alpaca").getOpenOrdersQuery;
                getFilledOrders: typeof import("./alpaca").getFilledOrders;
                getOrderHistory: typeof import("./alpaca").getOrderHistory;
                getAllOrders: typeof import("./alpaca").getAllOrders;
                waitForOrderFill: typeof import("./alpaca").waitForOrderFill;
                isOrderFillable: typeof import("./alpaca").isOrderFillable;
                isOrderFilled: typeof import("./alpaca").isOrderFilled;
                isOrderTerminal: typeof import("./alpaca").isOrderTerminalStatus;
                isOrderOpen: typeof import("./alpaca").isOrderOpen;
                calculateOrderValue: typeof import("./alpaca").calculateOrderValue;
                calculateTotalFilledValue: typeof import("./alpaca").calculateTotalFilledValue;
                formatOrderSummary: typeof import("./alpaca").formatOrderSummary;
                formatOrderForLog: typeof import("./alpaca").formatOrderForLog;
                roundPriceForAlpaca: typeof import("./alpaca").roundPriceForAlpaca;
                roundPriceForAlpacaNumber: typeof import("./alpaca").roundPriceForAlpacaNumber;
                groupOrdersBySymbol: typeof import("./alpaca").groupOrdersBySymbol;
                groupOrdersByStatus: typeof import("./alpaca").groupOrdersByStatus;
                filterOrdersByDateRange: typeof import("./alpaca").filterOrdersByDateRange;
                sortOrdersByDate: typeof import("./alpaca").sortOrdersByDate;
            };
            createOrder(client: import("./alpaca").AlpacaClient, params: Types.CreateOrderParams): Promise<Types.AlpacaOrder>;
            getOrder(client: import("./alpaca").AlpacaClient, orderId: string): Promise<Types.AlpacaOrder>;
            getOrders(client: import("./alpaca").AlpacaClient, params?: Types.GetOrdersParams): Promise<Types.AlpacaOrder[]>;
            cancelOrder(client: import("./alpaca").AlpacaClient, orderId: string): Promise<void>;
            cancelAllOrders(client: import("./alpaca").AlpacaClient): Promise<import("./alpaca/trading/orders").CancelAllOrdersResponse>;
            replaceOrder(client: import("./alpaca").AlpacaClient, orderId: string, params: Types.ReplaceOrderParams): Promise<Types.AlpacaOrder>;
            isOrderCancelable(status: Types.OrderStatus): boolean;
            getOrderByClientId(client: import("./alpaca").AlpacaClient, clientOrderId: string): Promise<Types.AlpacaOrder>;
        };
        /** @description Position management - SDK-based (requires AlpacaClient) */
        sdkPositions: typeof import("./alpaca/trading/positions");
        /** @description Account information and configuration - SDK-based (requires AlpacaClient) */
        sdkAccount: typeof import("./alpaca/trading/account");
        /** @description Standard order operations - Legacy API (uses AlpacaAuth) */
        orders: {
            create: typeof Alpaca.createOrder;
            createLimitOrder: typeof Alpaca.createLimitOrder;
            get: typeof Alpaca.getOrder;
            getAll: typeof Alpaca.getOrders;
            replace: typeof Alpaca.replaceOrder;
            cancel: typeof Alpaca.cancelOrder;
            cancelAll: typeof Alpaca.cancelAllOrders;
        };
        /** @description Position management - Legacy API (uses AlpacaAuth) */
        positions: {
            fetch: typeof Alpaca.fetchPosition;
            close: typeof Alpaca.closePosition;
            fetchAll: typeof Alpaca.fetchAllPositions;
            closeAll: typeof Alpaca.closeAllPositions;
            closeAllAfterHours: typeof Alpaca.closeAllPositionsAfterHours;
        };
        /** @description Account information - Legacy API (uses AlpacaAuth) */
        account: typeof Alpaca.fetchAccountDetails;
        /** @description Real-time and historical quotes */
        quotes: typeof import("./alpaca/market-data/quotes");
        /** @description Historical price bars (OHLCV) */
        bars: typeof import("./alpaca/market-data/bars");
        /** @description Trade data */
        trades: typeof import("./alpaca/market-data/trades");
        /** @description Market news */
        news: typeof import("./alpaca/market-data/news");
        /** @description Options trading and data */
        options: {
            contracts: typeof import("./alpaca/options/contracts");
            orders: typeof import("./alpaca/options/orders");
            strategies: typeof import("./alpaca/options/strategies");
            data: typeof import("./alpaca/options/data");
        };
        /** @description Cryptocurrency trading and data */
        crypto: {
            orders: typeof import("./alpaca/crypto/orders");
            data: typeof import("./alpaca/crypto/data");
        };
        /** @description Real-time WebSocket streams */
        streams: typeof import("./alpaca/streams");
        /** @deprecated Use sdkAccount module instead */
        TradingAPI: typeof Types.AlpacaTradingAPI;
        /** @deprecated Use new createClient() instead */
        MarketDataAPI: typeof Types.AlpacaMarketDataAPI;
        /** @deprecated Use new SDK modules instead */
        makeRequest: typeof Alpaca.makeRequest;
        /** @deprecated Use account() instead */
        accountDetails: typeof Alpaca.fetchAccountDetails;
        /** @deprecated Use positions.fetchAll() instead */
        legacyPositions: typeof Alpaca.fetchAllPositions;
        /** @deprecated Use positions module instead */
        position: {
            fetch: typeof Alpaca.fetchPosition;
            close: typeof Alpaca.closePosition;
            fetchAll: typeof Alpaca.fetchAllPositions;
            closeAll: typeof Alpaca.closeAllPositions;
            closeAllAfterHours: typeof Alpaca.closeAllPositionsAfterHours;
        };
        /** @deprecated Use sdkAccount.getPortfolioHistory() instead */
        portfolioHistory: typeof Alpaca.fetchPortfolioHistory;
        /** @deprecated Use sdkAccount.getAccountConfiguration() instead */
        getConfig: typeof Alpaca.getConfiguration;
        /** @deprecated Use sdkAccount.updateAccountConfiguration() instead */
        updateConfig: typeof Alpaca.updateConfiguration;
        /** @deprecated Use news.getNews() instead */
        legacyNews: typeof Alpaca.fetchNews;
        /** @deprecated Use orders module instead */
        legacyOrders: {
            create: typeof Alpaca.createOrder;
            createLimitOrder: typeof Alpaca.createLimitOrder;
            get: typeof Alpaca.getOrder;
            getAll: typeof Alpaca.getOrders;
            replace: typeof Alpaca.replaceOrder;
            cancel: typeof Alpaca.cancelOrder;
            cancelAll: typeof Alpaca.cancelAllOrders;
        };
        /** @deprecated Use SDK asset functions instead */
        asset: {
            get: typeof Alpaca.getAsset;
        };
        /** @deprecated Use quotes module instead */
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
        createClient: typeof import("./alpaca").createAlpacaClient;
        createClientFromEnv: typeof import("./alpaca").createClientFromEnv;
        clearClientCache: typeof import("./alpaca").clearClientCache;
        /** @description Smart orders: brackets, OCO, OTO, trailing stops */
        smartOrders: {
            bracket: typeof import("./alpaca/trading/bracket-orders");
            oco: typeof import("./alpaca/trading/oco-orders");
            oto: typeof import("./alpaca/trading/oto-orders");
            trailingStops: typeof import("./alpaca/trading/trailing-stops");
            determineOrderType(params: import("./alpaca/trading/smart-orders").SmartOrderParams): import("./alpaca/trading/smart-orders").SmartOrderType;
            createSmartOrder(client: import("./alpaca").AlpacaClient, params: import("./alpaca/trading/smart-orders").SmartOrderParams): Promise<import("./alpaca/trading/smart-orders").SmartOrderResult>;
            createPercentageBracket(client: import("./alpaca").AlpacaClient, params: import("./alpaca/trading/smart-orders").PercentageBracketParams): Promise<import("./alpaca").BracketOrderResult>;
            createRiskManagedPosition(client: import("./alpaca").AlpacaClient, params: import("./alpaca/trading/smart-orders").RiskManagedPositionParams): Promise<import("./alpaca").BracketOrderResult | import("./alpaca").OTOOrderResult>;
            calculateRewardRiskRatio(entryPrice: number, takeProfitPrice: number, stopLossPrice: number, side: Types.OrderSide): number;
            calculatePositionSize(accountValue: number, riskPercent: number, entryPrice: number, stopPrice: number): number;
            default: {
                createSmartOrder: typeof import("./alpaca/trading/smart-orders").createSmartOrder;
                determineOrderType: typeof import("./alpaca/trading/smart-orders").determineOrderType;
                createPercentageBracket: typeof import("./alpaca/trading/smart-orders").createPercentageBracket;
                createRiskManagedPosition: typeof import("./alpaca/trading/smart-orders").createRiskManagedPosition;
                calculateRewardRiskRatio: typeof import("./alpaca/trading/smart-orders").calculateRewardRiskRatio;
                calculatePositionSize: typeof import("./alpaca/trading/smart-orders").calculatePositionSize;
                createBracketOrder: typeof import("./alpaca").createBracketOrder;
                createProtectiveBracket: typeof import("./alpaca").createProtectiveBracket;
                createExecutorFromTradingAPI: typeof import("./alpaca").createExecutorFromTradingAPI;
                createOCOOrder: typeof import("./alpaca").createOCOOrder;
                createOTOOrder: typeof import("./alpaca").createOTOOrder;
                createTrailingStop: typeof import("./alpaca").createTrailingStop;
                updateTrailingStop: typeof import("./alpaca").updateTrailingStop;
            };
            createBracketOrder(executor: import("./alpaca").BracketOrderExecutor, params: import("./alpaca").BracketOrderParams): Promise<import("./alpaca").BracketOrderResult>;
            createProtectiveBracket(executor: import("./alpaca").BracketOrderExecutor, params: import("./alpaca").ProtectiveBracketParams): Promise<import("./alpaca").BracketOrderResult>;
            createExecutorFromTradingAPI(api: {
                makeRequest: (endpoint: string, method: string, body?: unknown) => Promise<Types.AlpacaOrder>;
            }): import("./alpaca").BracketOrderExecutor;
            createOCOOrder(client: import("./alpaca").AlpacaClient, params: import("./alpaca").OCOOrderParams): Promise<import("./alpaca").OCOOrderResult>;
            cancelOCOOrder(client: import("./alpaca").AlpacaClient, parentOrderId: string): Promise<void>;
            getOCOOrderStatus(client: import("./alpaca").AlpacaClient, parentOrderId: string): Promise<Types.AlpacaOrder>;
            protectLongPosition(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, takeProfitPrice: number, stopLossPrice: number, stopLimitPrice?: number): Promise<import("./alpaca").OCOOrderResult>;
            protectShortPosition(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, takeProfitPrice: number, stopLossPrice: number, stopLimitPrice?: number): Promise<import("./alpaca").OCOOrderResult>;
            createOTOOrder(client: import("./alpaca").AlpacaClient, params: import("./alpaca").OTOOrderParams): Promise<import("./alpaca").OTOOrderResult>;
            cancelOTOOrder(client: import("./alpaca").AlpacaClient, parentOrderId: string): Promise<void>;
            getOTOOrderStatus(client: import("./alpaca").AlpacaClient, parentOrderId: string): Promise<Types.AlpacaOrder>;
            buyWithStopLoss(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, stopLossPrice: number, stopLimitPrice?: number): Promise<import("./alpaca").OTOOrderResult>;
            buyWithTrailingStop(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, trailPercent: number): Promise<import("./alpaca").OTOOrderResult>;
            limitBuyWithTakeProfit(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, entryPrice: number, takeProfitPrice: number): Promise<import("./alpaca").OTOOrderResult>;
            shortWithStopLoss(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, entryPrice: number, stopLossPrice: number): Promise<import("./alpaca").OTOOrderResult>;
            entryWithPercentStopLoss(client: import("./alpaca").AlpacaClient, symbol: string, qty: number, entryPrice: number | null, stopLossPercent: number, side?: Types.OrderSide): Promise<import("./alpaca").OTOOrderResult>;
            createTrailingStop(client: import("./alpaca").AlpacaClient, params: import("./alpaca").TrailingStopParams): Promise<Types.AlpacaOrder>;
            updateTrailingStop(client: import("./alpaca").AlpacaClient, orderId: string, updates: {
                trailPercent?: number;
                trailPrice?: number;
            }): Promise<Types.AlpacaOrder>;
            getTrailingStopHWM(client: import("./alpaca").AlpacaClient, orderId: string): Promise<import("./alpaca").TrailingStopHWMResult>;
            cancelTrailingStop(client: import("./alpaca").AlpacaClient, orderId: string): Promise<void>;
            createPortfolioTrailingStops(client: import("./alpaca").AlpacaClient, params: import("./alpaca").PortfolioTrailingStopParams): Promise<Map<string, Types.AlpacaOrder>>;
            getOpenTrailingStops(client: import("./alpaca").AlpacaClient, symbol?: string): Promise<Types.AlpacaOrder[]>;
            hasActiveTrailingStop(client: import("./alpaca").AlpacaClient, symbol: string): Promise<boolean>;
            cancelTrailingStopsForSymbol(client: import("./alpaca").AlpacaClient, symbol: string): Promise<number>;
            TrailingStopValidationError: typeof import("./alpaca").TrailingStopValidationError;
        };
        /** @description Standard order operations - SDK-based (requires AlpacaClient) */
        sdkOrders: {
            getOrdersBySymbol(client: import("./alpaca").AlpacaClient, symbol: string, params?: Omit<Types.GetOrdersParams, "symbols">): Promise<Types.AlpacaOrder[]>;
            getOpenOrders(client: import("./alpaca").AlpacaClient, params?: Omit<Types.GetOrdersParams, "status">): Promise<Types.AlpacaOrder[]>;
            getFilledOrders(client: import("./alpaca").AlpacaClient, params: import("./alpaca").GetFilledOrdersParams): Promise<Types.AlpacaOrder[]>;
            getOrderHistory(client: import("./alpaca").AlpacaClient, params?: import("./alpaca").GetOrderHistoryParams): Promise<import("./alpaca").OrderHistoryResult>;
            getAllOrders(client: import("./alpaca").AlpacaClient, params?: import("./alpaca").GetAllOrdersParams): Promise<Types.AlpacaOrder[]>;
            waitForOrderFill(client: import("./alpaca").AlpacaClient, params: import("./alpaca").WaitForOrderFillParams): Promise<import("./alpaca").WaitForOrderFillResult>;
            isOrderFillable(order: Types.AlpacaOrder): boolean;
            isOrderFilled(order: Types.AlpacaOrder): boolean;
            isOrderTerminal(order: Types.AlpacaOrder): boolean;
            isOrderOpen(order: Types.AlpacaOrder): boolean;
            calculateOrderValue(order: Types.AlpacaOrder): number | null;
            formatOrderSummary(order: Types.AlpacaOrder): import("./alpaca").OrderSummary;
            formatOrderForLog(order: Types.AlpacaOrder): string;
            roundPriceForAlpaca(price: number): string;
            roundPriceForAlpacaNumber(price: number): number;
            groupOrdersBySymbol(orders: Types.AlpacaOrder[]): Map<string, Types.AlpacaOrder[]>;
            groupOrdersByStatus(orders: Types.AlpacaOrder[]): Map<string, Types.AlpacaOrder[]>;
            calculateTotalFilledValue(orders: Types.AlpacaOrder[]): number;
            filterOrdersByDateRange(orders: Types.AlpacaOrder[], startDate: Date, endDate: Date): Types.AlpacaOrder[];
            sortOrdersByDate(orders: Types.AlpacaOrder[], direction?: "asc" | "desc"): Types.AlpacaOrder[];
            default: {
                getOrdersBySymbol: typeof import("./alpaca").getOrdersBySymbol;
                getOpenOrders: typeof import("./alpaca").getOpenOrdersQuery;
                getFilledOrders: typeof import("./alpaca").getFilledOrders;
                getOrderHistory: typeof import("./alpaca").getOrderHistory;
                getAllOrders: typeof import("./alpaca").getAllOrders;
                waitForOrderFill: typeof import("./alpaca").waitForOrderFill;
                isOrderFillable: typeof import("./alpaca").isOrderFillable;
                isOrderFilled: typeof import("./alpaca").isOrderFilled;
                isOrderTerminal: typeof import("./alpaca").isOrderTerminalStatus;
                isOrderOpen: typeof import("./alpaca").isOrderOpen;
                calculateOrderValue: typeof import("./alpaca").calculateOrderValue;
                calculateTotalFilledValue: typeof import("./alpaca").calculateTotalFilledValue;
                formatOrderSummary: typeof import("./alpaca").formatOrderSummary;
                formatOrderForLog: typeof import("./alpaca").formatOrderForLog;
                roundPriceForAlpaca: typeof import("./alpaca").roundPriceForAlpaca;
                roundPriceForAlpacaNumber: typeof import("./alpaca").roundPriceForAlpacaNumber;
                groupOrdersBySymbol: typeof import("./alpaca").groupOrdersBySymbol;
                groupOrdersByStatus: typeof import("./alpaca").groupOrdersByStatus;
                filterOrdersByDateRange: typeof import("./alpaca").filterOrdersByDateRange;
                sortOrdersByDate: typeof import("./alpaca").sortOrdersByDate;
            };
            createOrder(client: import("./alpaca").AlpacaClient, params: Types.CreateOrderParams): Promise<Types.AlpacaOrder>;
            getOrder(client: import("./alpaca").AlpacaClient, orderId: string): Promise<Types.AlpacaOrder>;
            getOrders(client: import("./alpaca").AlpacaClient, params?: Types.GetOrdersParams): Promise<Types.AlpacaOrder[]>;
            cancelOrder(client: import("./alpaca").AlpacaClient, orderId: string): Promise<void>;
            cancelAllOrders(client: import("./alpaca").AlpacaClient): Promise<import("./alpaca/trading/orders").CancelAllOrdersResponse>;
            replaceOrder(client: import("./alpaca").AlpacaClient, orderId: string, params: Types.ReplaceOrderParams): Promise<Types.AlpacaOrder>;
            isOrderCancelable(status: Types.OrderStatus): boolean;
            getOrderByClientId(client: import("./alpaca").AlpacaClient, clientOrderId: string): Promise<Types.AlpacaOrder>;
        };
        /** @description Position management - SDK-based (requires AlpacaClient) */
        sdkPositions: typeof import("./alpaca/trading/positions");
        /** @description Account information and configuration - SDK-based (requires AlpacaClient) */
        sdkAccount: typeof import("./alpaca/trading/account");
        /** @description Standard order operations - Legacy API (uses AlpacaAuth) */
        orders: {
            create: typeof Alpaca.createOrder;
            createLimitOrder: typeof Alpaca.createLimitOrder;
            get: typeof Alpaca.getOrder;
            getAll: typeof Alpaca.getOrders;
            replace: typeof Alpaca.replaceOrder;
            cancel: typeof Alpaca.cancelOrder;
            cancelAll: typeof Alpaca.cancelAllOrders;
        };
        /** @description Position management - Legacy API (uses AlpacaAuth) */
        positions: {
            fetch: typeof Alpaca.fetchPosition;
            close: typeof Alpaca.closePosition;
            fetchAll: typeof Alpaca.fetchAllPositions;
            closeAll: typeof Alpaca.closeAllPositions;
            closeAllAfterHours: typeof Alpaca.closeAllPositionsAfterHours;
        };
        /** @description Account information - Legacy API (uses AlpacaAuth) */
        account: typeof Alpaca.fetchAccountDetails;
        /** @description Real-time and historical quotes */
        quotes: typeof import("./alpaca/market-data/quotes");
        /** @description Historical price bars (OHLCV) */
        bars: typeof import("./alpaca/market-data/bars");
        /** @description Trade data */
        trades: typeof import("./alpaca/market-data/trades");
        /** @description Market news */
        news: typeof import("./alpaca/market-data/news");
        /** @description Options trading and data */
        options: {
            contracts: typeof import("./alpaca/options/contracts");
            orders: typeof import("./alpaca/options/orders");
            strategies: typeof import("./alpaca/options/strategies");
            data: typeof import("./alpaca/options/data");
        };
        /** @description Cryptocurrency trading and data */
        crypto: {
            orders: typeof import("./alpaca/crypto/orders");
            data: typeof import("./alpaca/crypto/data");
        };
        /** @description Real-time WebSocket streams */
        streams: typeof import("./alpaca/streams");
        /** @deprecated Use sdkAccount module instead */
        TradingAPI: typeof Types.AlpacaTradingAPI;
        /** @deprecated Use new createClient() instead */
        MarketDataAPI: typeof Types.AlpacaMarketDataAPI;
        /** @deprecated Use new SDK modules instead */
        makeRequest: typeof Alpaca.makeRequest;
        /** @deprecated Use account() instead */
        accountDetails: typeof Alpaca.fetchAccountDetails;
        /** @deprecated Use positions.fetchAll() instead */
        legacyPositions: typeof Alpaca.fetchAllPositions;
        /** @deprecated Use positions module instead */
        position: {
            fetch: typeof Alpaca.fetchPosition;
            close: typeof Alpaca.closePosition;
            fetchAll: typeof Alpaca.fetchAllPositions;
            closeAll: typeof Alpaca.closeAllPositions;
            closeAllAfterHours: typeof Alpaca.closeAllPositionsAfterHours;
        };
        /** @deprecated Use sdkAccount.getPortfolioHistory() instead */
        portfolioHistory: typeof Alpaca.fetchPortfolioHistory;
        /** @deprecated Use sdkAccount.getAccountConfiguration() instead */
        getConfig: typeof Alpaca.getConfiguration;
        /** @deprecated Use sdkAccount.updateAccountConfiguration() instead */
        updateConfig: typeof Alpaca.updateConfiguration;
        /** @deprecated Use news.getNews() instead */
        legacyNews: typeof Alpaca.fetchNews;
        /** @deprecated Use orders module instead */
        legacyOrders: {
            create: typeof Alpaca.createOrder;
            createLimitOrder: typeof Alpaca.createLimitOrder;
            get: typeof Alpaca.getOrder;
            getAll: typeof Alpaca.getOrders;
            replace: typeof Alpaca.replaceOrder;
            cancel: typeof Alpaca.cancelOrder;
            cancelAll: typeof Alpaca.cancelAllOrders;
        };
        /** @deprecated Use SDK asset functions instead */
        asset: {
            get: typeof Alpaca.getAsset;
        };
        /** @deprecated Use quotes module instead */
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