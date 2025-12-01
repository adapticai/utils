/**********************************************************************************
 * Polygon.io calls
 **********************************************************************************/
import { PolygonQuote, PolygonPriceData, PolygonGroupedDailyResponse, PolygonTickerInfo, PolygonDailyOpenClose, PolygonTradesResponse } from './types';
/**
 * Fetches general information about a stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch information for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<PolygonTickerInfo | null>} The ticker information or null if not found.
 */
export declare const fetchTickerInfo: (symbol: string, options?: {
    apiKey?: string;
}) => Promise<PolygonTickerInfo | null>;
/**
 * Fetches the last trade for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch the last trade for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<PolygonQuote>} The last trade information.
 */
export declare const fetchLastTrade: (symbol: string, options?: {
    apiKey?: string;
}) => Promise<PolygonQuote>;
/**
 * Fetches price data for a given stock ticker.
 * @param {Object} params - The parameters for fetching price data.
 * @param {string} params.ticker - The stock ticker symbol.
 * @param {number} params.start - The start timestamp for fetching price data.
 * @param {number} [params.end] - The end timestamp for fetching price data.
 * @param {number} params.multiplier - The multiplier for the price data.
 * @param {string} params.timespan - The timespan for the price data.
 * @param {number} [params.limit] - The maximum number of price data points to fetch.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<PolygonPriceData[]>} The fetched price data.
 */
export declare const fetchPrices: (params: {
    ticker: string;
    start: number;
    end?: number;
    multiplier: number;
    timespan: string;
    limit?: number;
}, options?: {
    apiKey?: string;
}) => Promise<PolygonPriceData[]>;
/**
 * Analyzes the price data for a given stock.
 * @param {PolygonPriceData[]} priceData - The price data to analyze.
 * @returns {string} The analysis report.
 */
export declare function analysePolygonPriceData(priceData: PolygonPriceData[]): string;
/**
 * Fetches grouped daily price data for a specific date.
 * @param {string} date - The date to fetch grouped daily data for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @param {boolean} [options.adjusted] - Whether to adjust the data.
 * @param {boolean} [options.includeOTC] - Whether to include OTC data.
 * @returns {Promise<PolygonGroupedDailyResponse>} The grouped daily response.
 */
export declare const fetchGroupedDaily: (date: string, options?: {
    apiKey?: string;
    adjusted?: boolean;
    includeOTC?: boolean;
}) => Promise<PolygonGroupedDailyResponse>;
/**
 * Formats the price data into a readable string.
 * @param {PolygonPriceData[]} priceData - The price data to format.
 * @returns {string} The formatted price data.
 */
export declare function formatPriceData(priceData: PolygonPriceData[]): string;
export declare const fetchDailyOpenClose: (
/**
 * Fetches the daily open and close data for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch data for.
 * @param {Date} [date=new Date()] - The date to fetch data for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @param {boolean} [options.adjusted] - Whether to adjust the data.
 * @returns {Promise<PolygonDailyOpenClose>} The daily open and close data.
 */
symbol: string, date?: Date, options?: {
    apiKey?: string;
    adjusted?: boolean;
}) => Promise<PolygonDailyOpenClose>;
/**
 * Gets the previous close price for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch the previous close for.
 * @param {Date} [referenceDate] - The reference date to use for fetching the previous close.
 * @returns {Promise<{ close: number; date: Date }>} The previous close price and date.
 */
export declare function getPreviousClose(symbol: string, referenceDate?: Date, options?: {
    apiKey?: string;
}): Promise<{
    close: number;
    date: Date;
}>;
/**
 * Fetches trade data for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch trades for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @param {string | number} [options.timestamp] - The timestamp for fetching trades.
 * @param {string | number} [options.timestampgt] - Greater than timestamp for fetching trades.
 * @param {string | number} [options.timestampgte] - Greater than or equal to timestamp for fetching trades.
 * @param {string | number} [options.timestamplt] - Less than timestamp for fetching trades.
 * @param {string | number} [options.timestamplte] - Less than or equal to timestamp for fetching trades.
 * @param {'asc' | 'desc'} [options.order] - The order of the trades.
 * @param {number} [options.limit] - The maximum number of trades to fetch.
 * @param {string} [options.sort] - The sort order for the trades.
 * @returns {Promise<PolygonTradesResponse>} The fetched trades response.
 */
export declare const fetchTrades: (symbol: string, options?: {
    apiKey?: string;
    timestamp?: string | number;
    timestampgt?: string | number;
    timestampgte?: string | number;
    timestamplt?: string | number;
    timestamplte?: string | number;
    order?: "asc" | "desc";
    limit?: number;
    sort?: string;
}) => Promise<PolygonTradesResponse>;
//# sourceMappingURL=polygon.d.ts.map