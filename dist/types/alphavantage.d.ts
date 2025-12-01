/**********************************************************************************
 * AlphaVantage calls
 **********************************************************************************/
import { AlphaVantageQuoteResponse, AVNewsArticle } from './types';
/**
 * Fetches the current quote for a given ticker symbol.
 * @param {string} ticker - The ticker symbol to fetch the quote for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<AlphaVantageQuoteResponse>} The current quote response.
 */
export declare const fetchQuote: (ticker: string, options?: {
    apiKey?: string;
}) => Promise<AlphaVantageQuoteResponse>;
/**
 * Converts a Date object to a string in the format YYYYMMDDTHHMM.
 * @param {Date} date - The date to convert.
 * @returns {string} The formatted date string.
 */
export declare function convertDateToYYYYMMDDTHHMM(date: Date): string;
/**
 * Converts a string in the format YYYYMMDDTHHMMSS to a Date object.
 * @param {string} dateString - The date string to convert.
 * @returns {Date} The corresponding Date object.
 */
export declare function convertYYYYMMDDTHHMMSSToDate(dateString: string): Date;
/**
 * Fetches news articles from AlphaVantage for a given ticker symbol. Performs filtering as the API endpoint doesn't respect the parameters.
 * @param {string} ticker - The ticker symbol to fetch news for.
 * @param {Object} [options] - Optional parameters.
 * @param {Date} [options.start] - The start date for fetching news.
 * @param {Date} [options.end] - The end date for fetching news.
 * @param {number} [options.limit] - The maximum number of news articles to fetch.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<AVNewsArticle[]>} The fetched news articles.
 */
export declare const fetchTickerNews: (ticker: string, options?: {
    start?: Date;
    end?: Date;
    limit?: number;
    apiKey?: string;
    sort?: "LATEST" | "EARLIEST" | "RELEVANCE";
}) => Promise<AVNewsArticle[]>;
//# sourceMappingURL=alphavantage.d.ts.map