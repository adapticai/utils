import type {
  CryptoBarsParams,
  CryptoBarsResponse,
  CryptoBar,
  AlpacaNewsArticle,
  LatestTradesResponse,
  LatestQuotesResponse
} from './types/alpaca-types.js';
import { logIfDebug } from './misc-utils.js';
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from './http-timeout.js';
import { MARKET_DATA_API } from './config/api-endpoints';
import { withRetry, API_RETRY_CONFIGS } from './utils/retry';

const ALPACA_API_BASE = MARKET_DATA_API.CRYPTO;

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
export async function fetchBars(params: CryptoBarsParams): Promise<{ [symbol: string]: CryptoBar[] }> {
  // Convert symbols array to comma-separated string
  const symbolsParam = params.symbols.join(',');

  // Initialize result object to store all bars
  const allBars: { [symbol: string]: CryptoBar[] } = {};
  params.symbols.forEach((symbol) => {
    allBars[symbol] = [];
  });

  let pageToken = params.page_token;
  let hasMorePages = true;

  while (hasMorePages) {
    // Convert Date objects to RFC-3339 strings for the API
    const queryParams = new URLSearchParams({
      symbols: symbolsParam,
      timeframe: params.timeframe,
      ...(params.start && { start: params.start.toISOString() }),
      ...(params.end && { end: params.end.toISOString() }),
      ...(params.limit && { limit: params.limit.toString() }),
      ...(pageToken && { page_token: pageToken }),
      ...(params.sort && { sort: params.sort }),
    });

    const url = `${ALPACA_API_BASE}/crypto/us/bars?${queryParams}`;

    logIfDebug(`Fetching crypto bars from: ${url}`);

    try {
      await withRetry(
        async () => {
          const response = await fetch(url, {
            signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
          }

          const data: Omit<CryptoBarsResponse, 'bars'> & {
            bars: { [symbol: string]: Array<Omit<CryptoBar, 't'> & { t: string }> };
          } = await response.json();

          // Convert timestamp strings to Date objects and merge bars
          Object.entries(data.bars).forEach(([symbol, bars]) => {
            if (allBars[symbol]) {
              const barsWithDateObjects = bars.map((bar) => ({
                ...bar,
                t: new Date(bar.t),
              }));
              allBars[symbol].push(...barsWithDateObjects);
            }
          });

          // Check if there are more pages
          pageToken = data.next_page_token;
          hasMorePages = !!pageToken;

          logIfDebug(`Received ${Object.values(data.bars).flat().length} bars. More pages: ${hasMorePages}`);
        },
        API_RETRY_CONFIGS.CRYPTO,
        `Crypto.fetchBars(${symbolsParam})`
      );
    } catch (error) {
      logIfDebug(`Error fetching crypto bars: ${error}`);
      throw error;
    }
  }

  return allBars;
}

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
export async function fetchNews(
  params: {
    symbol: string;
    start?: Date;
    sort?: string;
    includeContent?: boolean;
    limit?: number;
  },
  auth: AlpacaAuth
): Promise<AlpacaNewsArticle[]> {
  const {
    symbol,
    start = new Date(Date.now() - 24 * 60 * 60 * 1000),
    sort = 'desc',
    includeContent = false,
    limit = 1000,
  } = params;
  if (!auth.APIKey || !auth.APISecret) {
    throw new Error('Alpaca API key and secret are required');
  }
  if (!symbol) {
    throw new Error('Symbol is required');
  }
  
  const queryParams = new URLSearchParams({
    start: start.toISOString(),
    sort,
    symbols: symbol,
    include_content: includeContent.toString(),
    limit: limit.toString(),
  });

  const url = `${ALPACA_API_BASE}/news?${queryParams}`;

  logIfDebug(`Fetching news from: ${url}`);

  interface RawNewsArticle {
    id: number;
    headline: string;
    author: string;
    created_at: string;
    updated_at: string;
    source: string;
    summary: string;
    url: string;
    content: string;
    symbols: string[];
    images: Array<{ size: 'large' | 'small' | 'thumb'; url: string }>;
  }

  let newsArticles: AlpacaNewsArticle[] = [];
  let pageToken: string | null = null;
  let hasMorePages = true;

  while (hasMorePages) {
    if (pageToken) {
      queryParams.append('page_token', pageToken);
    }

    await withRetry(
      async () => {
        const response = await fetch(url, {
          signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
        }

        const data: { news: RawNewsArticle[]; next_page_token?: string } = await response.json();
        newsArticles = newsArticles.concat(
          data.news.map((article): AlpacaNewsArticle => ({
            id: article.id,
            author: article.author,
            content: article.content,
            created_at: article.created_at,
            updated_at: article.updated_at,
            headline: article.headline,
            source: article.source,
            summary: article.summary,
            url: article.url,
            symbols: article.symbols,
            images: article.images,
          }))
        );

        pageToken = data.next_page_token;
        hasMorePages = !!pageToken;

        logIfDebug(`Received ${data.news.length} news articles. More pages: ${hasMorePages}`);
      },
      API_RETRY_CONFIGS.CRYPTO,
      `Crypto.fetchNews(${symbol})`
    );
  }

  // If sort is "asc" and limit is 10, return only the 10 most recent articles
  if (sort === 'asc' && limit === 10) {
    return newsArticles.slice(-10);
  }

  return newsArticles;
}

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
export async function fetchLatestTrades(
  params: {
    symbols: string[];
    loc?: string;
  },
  auth: AlpacaAuth
): Promise<LatestTradesResponse> {
  const { symbols, loc = 'us' } = params;

  if (!auth.APIKey || !auth.APISecret) {
    throw new Error('Alpaca API key and secret are required');
  }
  if (!symbols || symbols.length === 0) {
    throw new Error('At least one symbol is required');
  }

  // Convert symbols array to comma-separated string
  const symbolsParam = symbols.join(',');

  const queryParams = new URLSearchParams({
    symbols: symbolsParam,
  });

  const url = `${ALPACA_API_BASE}/crypto/${loc}/latest/trades?${queryParams}`;

  logIfDebug(`Fetching crypto latest trades from: ${url}`);

  return withRetry(
    async () => {
      const response = await fetch(url, {
        headers: {
          'APCA-API-KEY-ID': auth.APIKey,
          'APCA-API-SECRET-KEY': auth.APISecret,
        },
        signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
      }

      const data: LatestTradesResponse = await response.json();

      logIfDebug(`Received latest trades for ${Object.keys(data.trades).length} symbols`);

      return data;
    },
    API_RETRY_CONFIGS.CRYPTO,
    `Crypto.fetchLatestTrades(${symbolsParam})`
  );
}

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
export async function fetchLatestQuotes(
  params: {
    symbols: string[];
    loc?: string;
  },
  auth: AlpacaAuth
): Promise<LatestQuotesResponse> {
  const { symbols, loc = 'us' } = params;

  if (!auth.APIKey || !auth.APISecret) {
    throw new Error('Alpaca API key and secret are required');
  }
  if (!symbols || symbols.length === 0) {
    throw new Error('At least one symbol is required');
  }

  // Convert symbols array to comma-separated string
  const symbolsParam = symbols.join(',');

  const queryParams = new URLSearchParams({
    symbols: symbolsParam,
  });

  const url = `${ALPACA_API_BASE}/crypto/${loc}/latest/quotes?${queryParams}`;

  logIfDebug(`Fetching crypto latest quotes from: ${url}`);

  return withRetry(
    async () => {
      const response = await fetch(url, {
        headers: {
          'APCA-API-KEY-ID': auth.APIKey,
          'APCA-API-SECRET-KEY': auth.APISecret,
        },
        signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
      }

      const data: LatestQuotesResponse = await response.json();

      logIfDebug(`Received latest quotes for ${Object.keys(data.quotes).length} symbols`);

      return data;
    },
    API_RETRY_CONFIGS.CRYPTO,
    `Crypto.fetchLatestQuotes(${symbolsParam})`
  );
}
