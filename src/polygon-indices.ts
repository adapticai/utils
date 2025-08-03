/**
 * Polygon Indices API Implementation
 * 
 * This module provides functions to interact with the Polygon.io Indices API.
 */

import { fetchWithRetry } from './misc-utils';
import pLimit from 'p-limit';
import {
  PolygonIndicesAggregatesParams,
  PolygonIndicesAggregatesResponse,
  PolygonIndicesPrevCloseResponse,
  PolygonIndicesDailyOpenCloseResponse,
  PolygonIndicesSnapshotParams,
  PolygonIndicesSnapshotResponse,
  PolygonIndicesErrorResponse,
} from './types';

// Constants from environment variables
const { ALPACA_INDICES_API_KEY } = process.env as Record<string, string>;

// Define concurrency limits for API
const POLYGON_INDICES_CONCURRENCY_LIMIT = 5;
const polygonIndicesLimit = pLimit(POLYGON_INDICES_CONCURRENCY_LIMIT);

// Base URL for Polygon API
const POLYGON_API_BASE_URL = 'https://api.polygon.io';

/**
 * Validates that an API key is available
 * @param {string | undefined} apiKey - Optional API key to use
 * @throws {Error} If no API key is available
 */
const validateApiKey = (apiKey?: string): string => {
  const key = apiKey || ALPACA_INDICES_API_KEY;
  if (!key) {
    throw new Error('Polygon Indices API key is missing');
  }
  return key;
};

/**
 * Fetches aggregate bars for an index over a given date range in custom time window sizes.
 * 
 * @param {PolygonIndicesAggregatesParams} params - Parameters for the aggregates request
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesAggregatesResponse>} The aggregates response
 */
export const fetchIndicesAggregates = async (
  params: PolygonIndicesAggregatesParams,
  options?: { apiKey?: string }
): Promise<PolygonIndicesAggregatesResponse> => {
  const apiKey = validateApiKey(options?.apiKey);
  
  const { indicesTicker, multiplier, timespan, from, to, sort = 'asc', limit } = params;
  
  const url = new URL(`${POLYGON_API_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(indicesTicker)}/range/${multiplier}/${timespan}/${from}/${to}`);
  
  const queryParams = new URLSearchParams();
  queryParams.append('apiKey', apiKey);
  
  if (sort) {
    queryParams.append('sort', sort);
  }
  
  if (limit) {
    queryParams.append('limit', limit.toString());
  }
  
  url.search = queryParams.toString();
  
  return polygonIndicesLimit(async () => {
    try {
      const response = await fetchWithRetry(url.toString(), {}, 3, 300);
      const data = await response.json();
      
      if (data.status === 'ERROR') {
        throw new Error(`Polygon API Error: ${data.error}`);
      }
      
      return data as PolygonIndicesAggregatesResponse;
    } catch (error) {
      console.error('Error fetching indices aggregates:', error);
      throw error;
    }
  });
};

/**
 * Gets the previous day's open, high, low, and close (OHLC) for the specified index.
 * 
 * @param {string} indicesTicker - The ticker symbol of the index
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesPrevCloseResponse>} The previous close response
 */
export const fetchIndicesPreviousClose = async (
  indicesTicker: string,
  options?: { apiKey?: string }
): Promise<PolygonIndicesPrevCloseResponse> => {
  const apiKey = validateApiKey(options?.apiKey);
  
  const url = new URL(`${POLYGON_API_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(indicesTicker)}/prev`);
  
  const queryParams = new URLSearchParams();
  queryParams.append('apiKey', apiKey);
  
  url.search = queryParams.toString();
  
  return polygonIndicesLimit(async () => {
    try {
      const response = await fetchWithRetry(url.toString(), {}, 3, 300);
      const data = await response.json();
      
      if (data.status === 'ERROR') {
        throw new Error(`Polygon API Error: ${data.error}`);
      }
      
      return data as PolygonIndicesPrevCloseResponse;
    } catch (error) {
      console.error('Error fetching indices previous close:', error);
      throw error;
    }
  });
};

/**
 * Gets the open, close and afterhours values of an index symbol on a certain date.
 * 
 * @param {string} indicesTicker - The ticker symbol of the index
 * @param {string} date - The date in YYYY-MM-DD format
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesDailyOpenCloseResponse>} The daily open/close response
 */
export const fetchIndicesDailyOpenClose = async (
  indicesTicker: string,
  date: string,
  options?: { apiKey?: string }
): Promise<PolygonIndicesDailyOpenCloseResponse> => {
  const apiKey = validateApiKey(options?.apiKey);
  
  const url = new URL(`${POLYGON_API_BASE_URL}/v1/open-close/${encodeURIComponent(indicesTicker)}/${date}`);
  
  const queryParams = new URLSearchParams();
  queryParams.append('apiKey', apiKey);
  
  url.search = queryParams.toString();
  
  return polygonIndicesLimit(async () => {
    try {
      const response = await fetchWithRetry(url.toString(), {}, 3, 300);
      const data = await response.json();
      
      if (data.status === 'ERROR') {
        throw new Error(`Polygon API Error: ${data.error}`);
      }
      
      return data as PolygonIndicesDailyOpenCloseResponse;
    } catch (error) {
      console.error('Error fetching indices daily open/close:', error);
      throw error;
    }
  });
};

/**
 * Gets a snapshot of indices data for specified tickers.
 * 
 * @param {PolygonIndicesSnapshotParams} [params] - Parameters for the snapshot request
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesSnapshotResponse>} The indices snapshot response
 */
export const fetchIndicesSnapshot = async (
  params?: PolygonIndicesSnapshotParams,
  options?: { apiKey?: string }
): Promise<PolygonIndicesSnapshotResponse> => {
  const apiKey = validateApiKey(options?.apiKey);
  
  const url = new URL(`${POLYGON_API_BASE_URL}/v3/snapshot/indices`);
  
  const queryParams = new URLSearchParams();
  queryParams.append('apiKey', apiKey);
  
  if (params?.tickers?.length) {
    queryParams.append('ticker.any_of', params.tickers.join(','));
  }
  
  if (params?.order) {
    queryParams.append('order', params.order);
  }
  
  if (params?.limit) {
    queryParams.append('limit', params.limit.toString());
  }
  
  if (params?.sort) {
    queryParams.append('sort', params.sort);
  }
  
  url.search = queryParams.toString();
  
  return polygonIndicesLimit(async () => {
    try {
      const response = await fetchWithRetry(url.toString(), {}, 3, 300);
      const data = await response.json();
      
      if (data.status === 'ERROR') {
        throw new Error(`Polygon API Error: ${data.error}`);
      }
      
      return data as PolygonIndicesSnapshotResponse;
    } catch (error) {
      console.error('Error fetching indices snapshot:', error);
      throw error;
    }
  });
};

/**
 * Gets snapshots for assets of all types, including indices.
 * 
 * @param {string[]} tickers - Array of tickers to fetch snapshots for
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @param {string} [options.type] - Filter by asset type
 * @param {string} [options.order] - Order results
 * @param {number} [options.limit] - Limit the number of results
 * @param {string} [options.sort] - Sort field
 * @returns {Promise<any>} The universal snapshot response
 */
export const fetchUniversalSnapshot = async (
  tickers: string[],
  options?: {
    apiKey?: string;
    type?: string;
    order?: string;
    limit?: number;
    sort?: string;
  }
): Promise<any> => {
  const apiKey = validateApiKey(options?.apiKey);
  
  const url = new URL(`${POLYGON_API_BASE_URL}/v3/snapshot`);
  
  const queryParams = new URLSearchParams();
  queryParams.append('apiKey', apiKey);
  
  if (tickers.length) {
    queryParams.append('ticker.any_of', tickers.join(','));
  }
  
  if (options?.type) {
    queryParams.append('type', options.type);
  }
  
  if (options?.order) {
    queryParams.append('order', options.order);
  }
  
  if (options?.limit) {
    queryParams.append('limit', options.limit.toString());
  }
  
  if (options?.sort) {
    queryParams.append('sort', options.sort);
  }
  
  url.search = queryParams.toString();
  
  return polygonIndicesLimit(async () => {
    try {
      const response = await fetchWithRetry(url.toString(), {}, 3, 300);
      const data = await response.json();
      
      if (data.status === 'ERROR') {
        throw new Error(`Polygon API Error: ${data.error}`);
      }
      
      return data;
    } catch (error) {
      console.error('Error fetching universal snapshot:', error);
      throw error;
    }
  });
};

/**
 * Converts Polygon Indices bar data to a more standardized format
 * 
 * @param {PolygonIndicesAggregatesResponse} data - The raw aggregates response
 * @returns {Array<{date: string, open: number, high: number, low: number, close: number, timestamp: number}>} Formatted bar data
 */
export const formatIndicesBarData = (data: PolygonIndicesAggregatesResponse): Array<{
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
}> => {
  return data.results.map(bar => {
    const date = new Date(bar.t);
    return {
      date: date.toISOString().split('T')[0],
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      timestamp: bar.t,
    };
  });
}; 