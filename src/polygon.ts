/**********************************************************************************
 * Polygon.io calls
 **********************************************************************************/

import { getLogger } from './logger';
import { fetchWithRetry, hideApiKeyFromurl } from './misc-utils';
import {
  PolygonQuote,
  PolygonPriceData,
  PolygonGroupedDailyResponse,
  RawPolygonPriceData,
  PolygonTickerInfo,
  PolygonDailyOpenClose,
  PolygonTradesResponse,
  PolygonErrorResponse,
} from './types';
import pLimit from 'p-limit';
import { validatePolygonApiKey } from './utils/auth-validator';

// Constants from environment variables
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

// Define concurrency limits per API
const POLYGON_CONCURRENCY_LIMIT = 100;

const polygonLimit = pLimit(POLYGON_CONCURRENCY_LIMIT);

// Use to update general information about stocks
/**
 * Fetches general information about a stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch information for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<PolygonTickerInfo | null>} The ticker information or null if not found.
 */

export const fetchTickerInfo = async (
  symbol: string,
  options?: { apiKey?: string }
): Promise<PolygonTickerInfo | null> => {
  if (!options?.apiKey && !POLYGON_API_KEY) {
    throw new Error('Polygon API key is missing');
  }

  const apiKey = options?.apiKey || POLYGON_API_KEY!;
  validatePolygonApiKey(apiKey);

  const baseUrl = `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams({
    apiKey,
  });

  return polygonLimit(async () => {
    try {
      const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`, {}, 3, 1000);
      const data = await response.json();

      // Check for "NOT_FOUND" status and return null
      if (data.status === 'NOT_FOUND') {
        getLogger().warn(`Ticker not found: ${symbol}`);
        return null;
      }

      // Map the results to the required structure
      const results = data.results;
      if (!results) {
        throw new Error('No results in Polygon API response');
      }

      // Validate required fields
      const requiredFields = [
        'active',
        'currency_name',
        'locale',
        'market',
        'name',
        'primary_exchange',
        'ticker',
        'type'
      ];

      for (const field of requiredFields) {
        if (results[field] === undefined) {
          throw new Error(`Missing required field in Polygon API response: ${field}`);
        }
      }

      // Handle optional share_class_shares_outstanding field
      if (results.share_class_shares_outstanding === undefined) {
        results.share_class_shares_outstanding = null;
      }

      return {
        ticker: results.ticker,
        type: results.type,
        active: results.active,
        currency_name: results.currency_name,
        description: results.description ?? 'No description available',
        locale: results.locale,
        market: results.market,
        market_cap: results.market_cap ?? 0,
        name: results.name,
        primary_exchange: results.primary_exchange,
        share_class_shares_outstanding: results.share_class_shares_outstanding
      } as PolygonTickerInfo;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const contextualMessage = `Error fetching ticker info for ${symbol}`;
      
      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        symbol,
        errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' : 
                   error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' : 
                   error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
        url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
        source: 'PolygonAPI.fetchTickerInfo',
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};

// Fetch last trade using Polygon.io
/**
 * Fetches the last trade for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch the last trade for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<PolygonQuote>} The last trade information.
 */

export const fetchLastTrade = async (symbol: string, options?: { apiKey?: string }): Promise<PolygonQuote> => {
  if (!options?.apiKey && !POLYGON_API_KEY) {
    throw new Error('Polygon API key is missing');
  }

  const apiKey = options?.apiKey || POLYGON_API_KEY!;
  validatePolygonApiKey(apiKey);

  const baseUrl = `https://api.polygon.io/v2/last/trade/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams({
    apiKey,
  });

  return polygonLimit(async () => {
    try {
      const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`, {}, 3, 1000);
      const data = await response.json();

      if (data.status !== 'OK' || !data.results) {
        throw new Error(`Polygon.io API error: ${data.status || 'No results'} ${data.error || ''}`);
      }

      const { p: price, s: vol, t: timestamp } = data.results;
      if (typeof price !== 'number' || typeof vol !== 'number' || typeof timestamp !== 'number') {
        throw new Error('Invalid trade data received from Polygon.io API');
      }

      return {
        price,
        vol,
        time: new Date(Math.floor(timestamp / 1000000)), // Convert nanoseconds to milliseconds
      } as PolygonQuote;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const contextualMessage = `Error fetching last trade for ${symbol}`;
      
      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        symbol,
        errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' : 
                   error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' : 
                   error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
        url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
        source: 'PolygonAPI.fetchLastTrade',
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};

// use Polygon for all price data fetching
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

export const fetchPrices = async (
  params: {
    ticker: string;
    start: number;
    end?: number;
    multiplier: number;
    timespan: string;
    limit?: number;
  },
  options?: { apiKey?: string }
): Promise<PolygonPriceData[]> => {
  if (!options?.apiKey && !POLYGON_API_KEY) {
    throw new Error('Polygon API key is missing');
  }

  const apiKey = options?.apiKey || POLYGON_API_KEY!;
  validatePolygonApiKey(apiKey);

  const { ticker, start, end = Date.now().valueOf(), multiplier, timespan, limit = 1000 } = params;

  const baseUrl = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
    ticker
  )}/range/${multiplier}/${timespan}/${start}/${end}`;

  const urlParams = new URLSearchParams({
    apiKey,
    adjusted: 'true',
    sort: 'asc',
    limit: limit.toString(),
  });

  return polygonLimit(async () => {
    try {
      let allResults: RawPolygonPriceData[] = [];
      let nextUrl = `${baseUrl}?${urlParams.toString()}`;

      while (nextUrl) {
        //getLogger().info(`Debug: Fetching ${nextUrl}`);
        const response = await fetchWithRetry(nextUrl, {}, 3, 1000);
        const data = await response.json();

        if (data.status !== 'OK') {
          throw new Error(`Polygon.io API responded with status: ${data.status}`);
        }

        if (data.results) {
          allResults = [...allResults, ...data.results];
        }

        // Check if there's a next page and append API key
        nextUrl = data.next_url ? `${data.next_url}&apiKey=${apiKey}` : '';
      }

      return allResults.map((entry: RawPolygonPriceData) => ({
        date: new Date(entry.t).toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone: 'America/New_York',
          timeZoneName: 'short',
          hourCycle: 'h23',
        }),
        timeStamp: entry.t,
        open: entry.o,
        high: entry.h,
        low: entry.l,
        close: entry.c,
        vol: entry.v,
        vwap: entry.vw,
        trades: entry.n,
      })) as PolygonPriceData[];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const contextualMessage = `Error fetching price data for ${ticker}`;
      
      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        ticker,
        errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' : 
                   error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' : 
                   error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
        source: 'PolygonAPI.fetchPrices',
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};

/**
 * Analyzes the price data for a given stock.
 * @param {PolygonPriceData[]} priceData - The price data to analyze.
 * @returns {string} The analysis report.
 */

export function analysePolygonPriceData(priceData: PolygonPriceData[]): string {
  if (!priceData || priceData.length === 0) {
    return 'No price data available for analysis.';
  }

  // Parse the dates into Date objects
  const parsedData = priceData.map((entry) => ({
    ...entry,
    date: new Date(entry.date),
  }));

  // Sort the data by date
  parsedData.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Extract start and end times
  const startTime = parsedData[0].date;
  const endTime = parsedData[parsedData.length - 1].date;

  // Calculate the total time in hours
  const totalTimeInHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

  // Calculate the interval between data points
  const intervals = parsedData
    .slice(1)
    .map((_, i) => (parsedData[i + 1].date.getTime() - parsedData[i].date.getTime()) / 1000); // in seconds
  const avgInterval =
    intervals.length > 0 ? intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length : 0;

  // Format the report
  const report = `
Report:
* Start time of data (US Eastern): ${startTime.toLocaleString('en-US', { timeZone: 'America/New_York' })}
* End time of data (US Eastern): ${endTime.toLocaleString('en-US', { timeZone: 'America/New_York' })}
* Number of data points: ${priceData.length}
* Average interval between data points (seconds): ${avgInterval.toFixed(2)}
  `;

  return report.trim();
}

import { formatCurrency } from './format-tools';

/**
 * Fetches grouped daily price data for a specific date.
 * @param {string} date - The date to fetch grouped daily data for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @param {boolean} [options.adjusted] - Whether to adjust the data.
 * @param {boolean} [options.includeOTC] - Whether to include OTC data.
 * @returns {Promise<PolygonGroupedDailyResponse>} The grouped daily response.
 */

export const fetchGroupedDaily = async (
  date: string,
  options?: {
    apiKey?: string;
    adjusted?: boolean;
    includeOTC?: boolean;
  }
): Promise<PolygonGroupedDailyResponse> => {
  if (!options?.apiKey && !POLYGON_API_KEY) {
    throw new Error('Polygon API key is missing');
  }

  const baseUrl = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}`;
  const params = new URLSearchParams({
    apiKey: options?.apiKey || POLYGON_API_KEY!,
    adjusted: options?.adjusted !== false ? 'true' : 'false',
    include_otc: options?.includeOTC ? 'true' : 'false',
  });

  return polygonLimit(async () => {
    try {
      const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`, {}, 3, 1000);
      const data = await response.json();

      if (data.status !== 'OK') {
        throw new Error(`Polygon.io API responded with status: ${data.status}`);
      }

      return {
        adjusted: data.adjusted,
        queryCount: data.queryCount,
        request_id: data.request_id,
        resultsCount: data.resultsCount,
        status: data.status,
        results: data.results.map((result: RawPolygonPriceData) => ({
          symbol: result.T,
          timeStamp: result.t,
          open: result.o,
          high: result.h,
          low: result.l,
          close: result.c,
          vol: result.v,
          vwap: result.vw,
          trades: result.n,
        })),
      } as PolygonGroupedDailyResponse;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const contextualMessage = `Error fetching grouped daily data for ${date}`;
      
      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        date,
        errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' : 
                   error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' : 
                   error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
        url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
        source: 'PolygonAPI.fetchGroupedDaily',
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};

/**
 * Formats the price data into a readable string.
 * @param {PolygonPriceData[]} priceData - The price data to format.
 * @returns {string} The formatted price data.
 */

export function formatPriceData(priceData: PolygonPriceData[]): string {
  if (!priceData || priceData.length === 0) return 'No price data available';

  return priceData
    .map((d) => {
      // For daily data, remove the time portion if it's all zeros
      const dateStr = d.date.includes(', 00:00:00') ? d.date.split(', 00:00:00')[0] : d.date;

      return [
        dateStr,
        `O: ${formatCurrency(d.open)}`,
        `H: ${formatCurrency(d.high)}`,
        `L: ${formatCurrency(d.low)}`,
        `C: ${formatCurrency(d.close)}`,
        `Vol: ${d.vol}`,
      ].join(' | ');
    })
    .join('\n');
}

export const fetchDailyOpenClose = async (
/**
 * Fetches the daily open and close data for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch data for.
 * @param {Date} [date=new Date()] - The date to fetch data for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @param {boolean} [options.adjusted] - Whether to adjust the data.
 * @returns {Promise<PolygonDailyOpenClose>} The daily open and close data.
 */

  symbol: string,
  date: Date = new Date(),
  options?: {
    apiKey?: string;
    adjusted?: boolean;
  }
): Promise<PolygonDailyOpenClose> => {
  if (!options?.apiKey && !POLYGON_API_KEY) {
    throw new Error('Polygon API key is missing');
  }

  const formattedDate = date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  const baseUrl = `https://api.polygon.io/v1/open-close/${encodeURIComponent(symbol)}/${formattedDate}`;
  const params = new URLSearchParams({
    apiKey: options?.apiKey || POLYGON_API_KEY!,
    adjusted: (options?.adjusted ?? true).toString(),
  });

  return polygonLimit(async () => {
    const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`, {}, 3, 1000);
    const data = await response.json();

    if (data.status !== 'OK') {
      throw new Error(`Failed to fetch daily open/close data for ${symbol}: ${data.status}`);
    }

    return data;
  });
};

import { getLastFullTradingDate } from './market-time';

/**
 * Gets the previous close price for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch the previous close for.
 * @param {Date} [referenceDate] - The reference date to use for fetching the previous close.
 * @returns {Promise<{ close: number; date: Date }>} The previous close price and date.
 */

export async function getPreviousClose(symbol: string, referenceDate?: Date, options?: { apiKey?: string }): Promise<{ close: number; date: Date }> {
  const previousDate = getLastFullTradingDate(referenceDate).date;
  const lastOpenClose = await fetchDailyOpenClose(symbol, previousDate, options);
  if (!lastOpenClose) {
    throw new Error(`Could not fetch last trade price for ${symbol}`);
  }
  return {
    close: lastOpenClose.close,
    date: previousDate,
  };
}

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

export const fetchTrades = async (
  symbol: string,
  options?: {
    apiKey?: string;
    timestamp?: string | number;
    timestampgt?: string | number;
    timestampgte?: string | number;
    timestamplt?: string | number;
    timestamplte?: string | number;
    order?: 'asc' | 'desc';
    limit?: number;
    sort?: string;
  }
): Promise<PolygonTradesResponse> => {
  if (!options?.apiKey && !POLYGON_API_KEY) {
    throw new Error('Polygon API key is missing');
  }

  const baseUrl = `https://api.polygon.io/v3/trades/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams({
    apiKey: options?.apiKey || POLYGON_API_KEY!,
  });

  // Add optional parameters if they exist
  if (options?.timestamp) params.append('timestamp', options.timestamp.toString());
  if (options?.timestampgt) params.append('timestamp.gt', options.timestampgt.toString());
  if (options?.timestampgte) params.append('timestamp.gte', options.timestampgte.toString());
  if (options?.timestamplt) params.append('timestamp.lt', options.timestamplt.toString());
  if (options?.timestamplte) params.append('timestamp.lte', options.timestamplte.toString());
  if (options?.order) params.append('order', options.order);
  if (options?.limit) params.append('limit', options.limit.toString());
  if (options?.sort) params.append('sort', options.sort);

  return polygonLimit(async () => {
    const url = `${baseUrl}?${params.toString()}`;
    try {
      getLogger().info(`[DEBUG] Fetching trades for ${symbol} from ${url}`);
      const response = await fetchWithRetry(url, {}, 3, 1000);
      const data = await response.json() as PolygonTradesResponse | PolygonErrorResponse;

      if ('message' in data) {
        // This is an error response
        throw new Error(`Polygon API Error: ${data.message}`);
      }

      return data;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const contextualMessage = `Error fetching trades for ${symbol}`;
      
      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        symbol,
        errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' : 
                   error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' : 
                   error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
        url: hideApiKeyFromurl(url),
        source: 'PolygonAPI.fetchTrades',
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};
