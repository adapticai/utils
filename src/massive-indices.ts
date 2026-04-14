/**
 * Massive Indices API Implementation
 *
 * This module provides functions to interact with the Massive.com Indices API.
 */

import pLimit from "p-limit";
import { getLogger } from "./logger";
import { fetchWithRetry } from "./misc-utils";
import { rateLimiters } from "./rate-limiter";
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from "./http-timeout";
import {
  MassiveIndicesAggregatesParams,
  MassiveIndicesAggregatesResponse,
  MassiveIndicesDailyOpenCloseResponse,
  MassiveIndicesPrevCloseResponse,
  MassiveIndicesSnapshotParams,
  MassiveIndicesSnapshotResponse
} from "./types";

// Constants from environment variables
const { ALPACA_INDICES_API_KEY } = process.env as Record<string, string>;

// Define concurrency limits for API
const MASSIVE_INDICES_CONCURRENCY_LIMIT = 5;
const massiveIndicesLimit = pLimit(MASSIVE_INDICES_CONCURRENCY_LIMIT);

// Base URL for Massive API
const MASSIVE_API_BASE_URL = "https://api.massive.com";

/**
 * Validates that an API key is available
 * @param {string | undefined} apiKey - Optional API key to use
 * @throws {Error} If no API key is available
 */
const validateApiKey = (apiKey?: string): string => {
  const key = apiKey || ALPACA_INDICES_API_KEY;
  if (!key) {
    throw new Error("Massive Indices API key is missing");
  }
  return key;
};

/**
 * Fetches aggregate bars for an index over a given date range in custom time window sizes.
 *
 * @param {MassiveIndicesAggregatesParams} params - Parameters for the aggregates request
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<MassiveIndicesAggregatesResponse>} The aggregates response
 */
export const fetchIndicesAggregates = async (
  params: MassiveIndicesAggregatesParams,
  options?: { apiKey?: string },
): Promise<MassiveIndicesAggregatesResponse> => {
  const apiKey = validateApiKey(options?.apiKey);

  const {
    indicesTicker,
    multiplier,
    timespan,
    from,
    to,
    sort = "asc",
    limit,
  } = params;

  const url = new URL(
    `${MASSIVE_API_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(indicesTicker)}/range/${multiplier}/${timespan}/${from}/${to}`,
  );

  const queryParams = new URLSearchParams();
  queryParams.append("apiKey", apiKey);

  if (sort) {
    queryParams.append("sort", sort);
  }

  if (limit) {
    queryParams.append("limit", limit.toString());
  }

  url.search = queryParams.toString();

  return massiveIndicesLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(url.toString(), { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) }, 3, 300);
      const data = await response.json();

      if (data.status === "ERROR") {
        throw new Error(`Massive API Error: ${data.error}`);
      }

      return data as MassiveIndicesAggregatesResponse;
    } catch (error) {
      getLogger().error("Error fetching indices aggregates:", error);
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
 * @returns {Promise<MassiveIndicesPrevCloseResponse>} The previous close response
 */
export const fetchIndicesPreviousClose = async (
  indicesTicker: string,
  options?: { apiKey?: string },
): Promise<MassiveIndicesPrevCloseResponse> => {
  const apiKey = validateApiKey(options?.apiKey);

  const url = new URL(
    `${MASSIVE_API_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(indicesTicker)}/prev`,
  );

  const queryParams = new URLSearchParams();
  queryParams.append("apiKey", apiKey);

  url.search = queryParams.toString();

  return massiveIndicesLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(url.toString(), { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) }, 3, 300);
      const data = await response.json();

      if (data.status === "ERROR") {
        throw new Error(`Massive API Error: ${data.error}`);
      }

      return data as MassiveIndicesPrevCloseResponse;
    } catch (error) {
      getLogger().error("Error fetching indices previous close:", error);
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
 * @returns {Promise<MassiveIndicesDailyOpenCloseResponse>} The daily open/close response
 */
export const fetchIndicesDailyOpenClose = async (
  indicesTicker: string,
  date: string,
  options?: { apiKey?: string },
): Promise<MassiveIndicesDailyOpenCloseResponse> => {
  const apiKey = validateApiKey(options?.apiKey);

  const url = new URL(
    `${MASSIVE_API_BASE_URL}/v1/open-close/${encodeURIComponent(indicesTicker)}/${date}`,
  );

  const queryParams = new URLSearchParams();
  queryParams.append("apiKey", apiKey);

  url.search = queryParams.toString();

  return massiveIndicesLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(url.toString(), { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) }, 3, 300);
      const data = await response.json();

      if (data.status === "ERROR") {
        throw new Error(`Massive API Error: ${data.error}`);
      }

      return data as MassiveIndicesDailyOpenCloseResponse;
    } catch (error) {
      getLogger().error("Error fetching indices daily open/close:", error);
      throw error;
    }
  });
};

/**
 * Gets a snapshot of indices data for specified tickers.
 *
 * @param {MassiveIndicesSnapshotParams} [params] - Parameters for the snapshot request
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<MassiveIndicesSnapshotResponse>} The indices snapshot response
 */
export const fetchIndicesSnapshot = async (
  params?: MassiveIndicesSnapshotParams,
  options?: { apiKey?: string },
): Promise<MassiveIndicesSnapshotResponse> => {
  const apiKey = validateApiKey(options?.apiKey);

  const url = new URL(`${MASSIVE_API_BASE_URL}/v3/snapshot/indices`);

  const queryParams = new URLSearchParams();
  queryParams.append("apiKey", apiKey);

  if (params?.tickers?.length) {
    queryParams.append("ticker.any_of", params.tickers.join(","));
  }

  if (params?.order) {
    queryParams.append("order", params.order);
  }

  if (params?.limit) {
    queryParams.append("limit", params.limit.toString());
  }

  if (params?.sort) {
    queryParams.append("sort", params.sort);
  }

  url.search = queryParams.toString();

  return massiveIndicesLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(url.toString(), { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) }, 3, 300);
      const data = await response.json();

      if (data.status === "ERROR") {
        throw new Error(`Massive API Error: ${data.error}`);
      }

      return data as MassiveIndicesSnapshotResponse;
    } catch (error) {
      getLogger().error("Error fetching indices snapshot:", error);
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
 * @returns {Promise<MassiveIndicesSnapshotResponse>} The universal snapshot response
 */
export const fetchUniversalSnapshot = async (
  tickers: string[],
  options?: {
    apiKey?: string;
    type?: string;
    order?: string;
    limit?: number;
    sort?: string;
  },
): Promise<MassiveIndicesSnapshotResponse> => {
  const apiKey = validateApiKey(options?.apiKey);

  const url = new URL(`${MASSIVE_API_BASE_URL}/v3/snapshot`);

  const queryParams = new URLSearchParams();
  queryParams.append("apiKey", apiKey);

  if (tickers.length) {
    queryParams.append("ticker.any_of", tickers.join(","));
  }

  if (options?.type) {
    queryParams.append("type", options.type);
  }

  if (options?.order) {
    queryParams.append("order", options.order);
  }

  if (options?.limit) {
    queryParams.append("limit", options.limit.toString());
  }

  if (options?.sort) {
    queryParams.append("sort", options.sort);
  }

  url.search = queryParams.toString();

  return massiveIndicesLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(url.toString(), { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) }, 3, 300);
      const data = await response.json();

      if (data.status === "ERROR") {
        throw new Error(`Massive API Error: ${data.error}`);
      }

      return data;
    } catch (error) {
      getLogger().error("Error fetching universal snapshot:", error);
      throw error;
    }
  });
};

/**
 * Converts Massive Indices bar data to a more standardized format
 *
 * @param {MassiveIndicesAggregatesResponse} data - The raw aggregates response
 * @returns {Array<{date: string, open: number, high: number, low: number, close: number, timestamp: number}>} Formatted bar data
 */
export const formatIndicesBarData = (
  data: MassiveIndicesAggregatesResponse,
): Array<{
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
}> => {
  return data.results.map((bar) => {
    const date = new Date(bar.t);
    return {
      date: date.toISOString().split("T")[0],
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      timestamp: bar.t,
    };
  });
};
