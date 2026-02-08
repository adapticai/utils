/**
 * Legacy Alpaca Market Data Functions
 * Quotes and news retrieval using AlpacaAuth pattern with direct fetch calls.
 */
import { types } from '@adaptic/backend-legacy';
import adaptic from '@adaptic/backend-legacy';
import { getSharedApolloClient } from '../../adaptic';
import {
  AlpacaAuth,
  DataFeed,
  LatestQuotesResponse,
  NewsResponse,
  SimpleNews,
} from '../../types/alpaca-types';
import { makeRequest } from './orders';
import { cleanContent } from './utils';
import { MARKET_DATA_API } from '../../config/api-endpoints';
import { getLogger } from '../../logger';
import { logIfDebug } from '../../misc-utils.js';
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from '../../http-timeout';

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_FEED: DataFeed = 'sip';

/**
 * Get the most recent quotes for requested symbols.
 * @param auth - The authentication details for Alpaca
 * @param params - Parameters including symbols array, optional feed and currency
 * @returns Latest quote data for each symbol
 * @throws Error if request fails or rate limit exceeded
 */
export async function getLatestQuotes(auth: AlpacaAuth, params: { symbols: string[]; feed?: DataFeed; currency?: string }): Promise<LatestQuotesResponse> {
  const { symbols, feed, currency } = params;

  // Return empty response if symbols array is empty to avoid API error
  if (!symbols || symbols.length === 0) {
    getLogger().warn('No symbols provided to getLatestQuotes, returning empty response', {
      type: 'warn'
    });
    return {
      quotes: {},
      currency: currency || DEFAULT_CURRENCY
    };
  }

  const queryParams = new URLSearchParams();
  queryParams.append('symbols', symbols.join(','));
  queryParams.append('feed', feed || DEFAULT_FEED);
  queryParams.append('currency', currency || DEFAULT_CURRENCY);

  return makeRequest(auth, {
    endpoint: '/v2/stocks/quotes/latest',
    method: 'GET',
    queryString: `?${queryParams.toString()}`,
    apiBaseUrl: MARKET_DATA_API.STOCKS.replace('/v2', '')
  });
}

/**
 * Fetches news articles from Alpaca API for specified symbols.
 * @param symbols - The symbols to fetch news for (comma-separated for multiple symbols)
 * @param params - Optional parameters for fetching news
 * @returns The fetched news articles and optional pagination token
 */
export async function fetchNews(
  symbols: string,
  params?: {
    auth?: AlpacaAuth;
    start?: Date | string;
    end?: Date | string;
    limit?: number;
    sort?: 'asc' | 'desc';
    page_token?: string;
    include_content?: boolean;
  },
): Promise<{ news: SimpleNews[]; nextPageToken?: string }> {
  const defaultParams = {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    end: new Date(),
    limit: 10,
    sort: 'desc' as const,
    page_token: null,
    include_content: true,
  };

  const mergedParams = { ...defaultParams, ...params };

  let APIKey: string | undefined;
  let APISecret: string | undefined;

  if (mergedParams.auth) {
    if (mergedParams.auth.alpacaApiKey && mergedParams.auth.alpacaApiSecret) {
      APIKey = mergedParams.auth.alpacaApiKey;
      APISecret = mergedParams.auth.alpacaApiSecret;
    } else if (mergedParams.auth.adapticAccountId) {
      const client = await getSharedApolloClient();

      const alpacaAccount = (await adaptic.alpacaAccount.get({
        id: mergedParams.auth.adapticAccountId,
      } as types.AlpacaAccount, client)) as types.AlpacaAccount;

      if (!alpacaAccount || !alpacaAccount.APIKey || !alpacaAccount.APISecret) {
        throw new Error('Alpaca account not found or incomplete');
      }

      APIKey = alpacaAccount.APIKey;
      APISecret = alpacaAccount.APISecret;
    }
  } else {
    APIKey = process.env.ALPACA_API_KEY;
    APISecret = process.env.ALPACA_SECRET_KEY;
  }

  if (!APIKey || !APISecret) {
    throw new Error('No valid Alpaca authentication found. Please provide either auth object or set ALPACA_API_KEY and ALPACA_API_SECRET environment variables.');
  }

  try {
    let newsArticles: SimpleNews[] = [];
    let pageToken = mergedParams.page_token;
    let hasMorePages = true;

    while (hasMorePages) {
      const queryParams = new URLSearchParams({
        ...(mergedParams.start && { start: new Date(mergedParams.start).toISOString() }),
        ...(mergedParams.end && { end: new Date(mergedParams.end).toISOString() }),
        ...(symbols && { symbols: symbols }),
        ...(mergedParams.limit && { limit: mergedParams.limit.toString() }),
        ...(mergedParams.sort && { sort: mergedParams.sort }),
        ...(mergedParams.include_content !== undefined ? { include_content: mergedParams.include_content.toString() } : {}),
        ...(pageToken && { page_token: pageToken }),
      });

      const url = `${MARKET_DATA_API.NEWS}/news?${queryParams}`;
      logIfDebug(`Fetching news from: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'APCA-API-KEY-ID': APIKey,
          'APCA-API-SECRET-KEY': APISecret,
          'accept': 'application/json',
        },
        signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as NewsResponse;

      const transformedNews: SimpleNews[] = data.news.map((article) => ({
        symbols: article.symbols,
        title: article.headline,
        summary: cleanContent(article.summary),
        content: article.content ? cleanContent(article.content) : undefined,
        url: article.url,
        source: article.source,
        author: article.author,
        date: article.created_at,
        updatedDate: article.updated_at || article.created_at,
        sentiment: 0,
      }));

      newsArticles = newsArticles.concat(transformedNews);

      pageToken = data.next_page_token || null;
      hasMorePages = !!pageToken;

      logIfDebug(`Received ${data.news.length} news articles. More pages: ${hasMorePages}`);
    }

    // Trim results to respect the limit parameter based on sort order
    if (mergedParams.limit && newsArticles.length > mergedParams.limit) {
      if (mergedParams.sort === 'asc') {
        newsArticles = newsArticles.slice(-mergedParams.limit);
      } else {
        newsArticles = newsArticles.slice(0, mergedParams.limit);
      }
    }

    if (mergedParams.sort === 'asc' && mergedParams.limit) {
      newsArticles = newsArticles.slice(-mergedParams.limit);
    }

    return {
      news: newsArticles,
      nextPageToken: pageToken || undefined,
    };
  } catch (error) {
    getLogger().error('Error in fetchNews:', error);
    throw error;
  }
}
