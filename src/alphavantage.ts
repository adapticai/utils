/**********************************************************************************
 * AlphaVantage calls
 **********************************************************************************/

import { AlphaVantageQuoteResponse, AVNewsResponse, AVNewsArticle } from './types';
import pLimit from 'p-limit';
import { logIfDebug } from './misc-utils';
// Constants from environment variables
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

function checkEnvironment(apiKey?: string) {
  if (!apiKey && !ALPHA_VANTAGE_API_KEY) {
    throw new Error('ALPHA_VANTAGE_API_KEY is not defined in environment variables or options.');
  }
}

// Define concurrency limits per API
const ALPHA_VANTAGE_CONCURRENCY_LIMIT = 5;
const AVBaseUrl = 'https://www.alphavantage.co/query?function=';

const alphaVantageLimit = pLimit(ALPHA_VANTAGE_CONCURRENCY_LIMIT);

// Fetch current quote. Does not need start / end date
/**
 * Fetches the current quote for a given ticker symbol.
 * @param {string} ticker - The ticker symbol to fetch the quote for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<AlphaVantageQuoteResponse>} The current quote response.
 */

export const fetchQuote = async (ticker: string, options?: { apiKey?: string }): Promise<AlphaVantageQuoteResponse> => {
  checkEnvironment(options?.apiKey);
  const endpoint = `${AVBaseUrl}GLOBAL_QUOTE&symbol=${ticker.replace('.', '-')}&entitlement=realtime&apikey=${options?.apiKey || ALPHA_VANTAGE_API_KEY
    }`;

  return alphaVantageLimit(async () => {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Failed to fetch quote for ${ticker}`);
    }
    const data = await response.json();
    return data as AlphaVantageQuoteResponse;
  });
};

/**
 * Converts a Date object to a string in the format YYYYMMDDTHHMM.
 * @param {Date} date - The date to convert.
 * @returns {string} The formatted date string.
 */

export function convertDateToYYYYMMDDTHHMM(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // Months are zero-based
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${year}${month}${day}T${hours}${minutes}`;
}

/**
 * Converts a string in the format YYYYMMDDTHHMMSS to a Date object.
 * @param {string} dateString - The date string to convert.
 * @returns {Date} The corresponding Date object.
 */

export function convertYYYYMMDDTHHMMSSToDate(dateString: string): Date {
  const year = parseInt(dateString.substring(0, 4), 10);
  const month = parseInt(dateString.substring(4, 6), 10) - 1; // Months are 0-based in JavaScript
  const day = parseInt(dateString.substring(6, 8), 10);
  const hours = parseInt(dateString.substring(9, 11), 10);
  const minutes = parseInt(dateString.substring(11, 13), 10);
  const seconds = parseInt(dateString.substring(13, 15), 10);

  return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
}

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
export const fetchTickerNews = async (
  ticker: string,
  options: { start?: Date; end?: Date; limit?: number; apiKey?: string; sort?: 'LATEST' | 'EARLIEST' | 'RELEVANCE' } = {
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    end: new Date(),
    limit: 10,
    sort: 'LATEST'
  }
): Promise<AVNewsArticle[]> => {
  checkEnvironment(options?.apiKey);
  // Format start date as YYYYMMDDTHHMM
  const formattedStart = convertDateToYYYYMMDDTHHMM(options.start ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const formattedEnd = convertDateToYYYYMMDDTHHMM(options.end ?? new Date());

  // Construct the API endpoint
  const endpoint = `${AVBaseUrl}NEWS_SENTIMENT&tickers=${ticker}&time_from=${formattedStart}&time_to=${formattedEnd}&sort=${options.sort}&limit=${options.limit}&apikey=${options?.apiKey || ALPHA_VANTAGE_API_KEY
    }`;

  return alphaVantageLimit(async () => {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Failed to fetch news for ticker ${ticker} from AlphaVantage`);
    }

    const data = (await response.json()) as AVNewsResponse;
    let newsItems: AVNewsArticle[] = [];
    if (data.items === 0) {
      logIfDebug(`No news found for ticker ${ticker}`);
    } else {
      logIfDebug(`Fetched ${data.items} news items for ticker ${ticker}`);
      // Filter articles within date range
      const startTime = options.start?.getTime() ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).getTime();
      const endTime = options.end?.getTime() ?? new Date().getTime();

      newsItems = data && data.feed && data.feed.length > 0 ? data.feed.filter(article => {
        const articleDate = convertYYYYMMDDTHHMMSSToDate(article.time_published);
        return articleDate.getTime() >= startTime && articleDate.getTime() <= endTime;
      }) : [];

      // Sort articles based on the sort parameter
      newsItems.sort((a, b) => {
        const dateA = convertYYYYMMDDTHHMMSSToDate(a.time_published).getTime();
        const dateB = convertYYYYMMDDTHHMMSSToDate(b.time_published).getTime();
        if (options.sort === 'LATEST') {
          return dateB - dateA;
        } else if (options.sort === 'EARLIEST') {
          return dateA - dateB;
        }
        return 0; // For RELEVANCE, maintain API's order
      });

      // Apply limit after filtering and sorting
      newsItems = newsItems.slice(0, options.limit);
    }
    return newsItems;
  });
};
