import type { CryptoBarsParams, CryptoBar, AlpacaNewsArticle, LatestTradesResponse, LatestQuotesResponse } from './types/alpaca-types.js';
/**
 * Fetches cryptocurrency bars for the specified parameters.
 * This function retrieves historical price data for multiple cryptocurrencies.
 *
 * @param params - The parameters for fetching crypto bars.
 * @param params.symbols - An array of cryptocurrency symbols to fetch data for.
 * @param params.timeframe - The timeframe for the bars (e.g., '1Min', '5Min', '1H', '1D').
 * @param params.start - The start date for fetching bars (optional).
 * @param params.end - The end date for fetching bars (optional).
 * @param params.limit - The maximum number of bars to return (optional).
 * @param params.page_token - The token for pagination (optional).
 * @param params.sort - The sorting order for the results (optional).
 * @returns A promise that resolves to an object containing arrays of CryptoBar objects for each symbol.
 */
export declare function fetchBars(params: CryptoBarsParams): Promise<{
    [symbol: string]: CryptoBar[];
}>;
type AlpacaAuth = {
    APIKey: string;
    APISecret: string;
    type?: 'PAPER' | 'LIVE';
};
/**
 * Fetches news articles related to a specific cryptocurrency symbol.
 * This function retrieves news articles from the Alpaca API.
 *
 * @param params - The parameters for fetching news articles.
 * @param params.symbol - The cryptocurrency symbol to fetch news for.
 * @param params.start - The start date for fetching news (optional).
 * @param params.sort - The sorting order for the results (optional).
 * @param params.includeContent - Whether to include the full content of the articles (optional).
 * @param params.limit - The maximum number of articles to return (optional).
 * @param auth - The Alpaca authentication object containing API key and secret.
 * @returns A promise that resolves to an array of AlpacaNewsArticle objects.
 * @throws Will throw an error if required parameters are missing or if fetching fails.
 */
export declare function fetchNews(params: {
    symbol: string;
    start?: Date;
    sort?: string;
    includeContent?: boolean;
    limit?: number;
}, auth: AlpacaAuth): Promise<AlpacaNewsArticle[]>;
/**
 * Fetches the latest trades for the specified cryptocurrency symbols.
 * This function retrieves the most recent trade price and volume for each symbol.
 *
 * @param params - The parameters for fetching latest trades.
 * @param params.symbols - An array of cryptocurrency symbols to fetch data for (e.g., ['BTC-USD', 'ETH-USD']).
 * @param params.loc - The location identifier (default: 'us'). Options: 'us' (Alpaca US), 'us-1' (Kraken US), 'eu-1' (Kraken EU).
 * @param auth - The Alpaca authentication object containing API key and secret.
 * @returns A promise that resolves to an object containing the latest trade for each symbol.
 * @throws Will throw an error if required parameters are missing or if fetching fails.
 */
export declare function fetchLatestTrades(params: {
    symbols: string[];
    loc?: string;
}, auth: AlpacaAuth): Promise<LatestTradesResponse>;
/**
 * Fetches the latest quotes (bid/ask prices) for the specified cryptocurrency symbols.
 * This function retrieves the most recent bid and ask prices for each symbol.
 *
 * @param params - The parameters for fetching latest quotes.
 * @param params.symbols - An array of cryptocurrency symbols to fetch data for (e.g., ['BTC-USD', 'ETH-USD']).
 * @param params.loc - The location identifier (default: 'us'). Options: 'us' (Alpaca US), 'us-1' (Kraken US), 'eu-1' (Kraken EU).
 * @param auth - The Alpaca authentication object containing API key and secret.
 * @returns A promise that resolves to an object containing the latest quote for each symbol.
 * @throws Will throw an error if required parameters are missing or if fetching fails.
 */
export declare function fetchLatestQuotes(params: {
    symbols: string[];
    loc?: string;
}, auth: AlpacaAuth): Promise<LatestQuotesResponse>;
export {};
//# sourceMappingURL=crypto.d.ts.map