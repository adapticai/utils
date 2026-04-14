/**********************************************************************************
 * Massive.com calls
 **********************************************************************************/

import pLimit from "p-limit";
import { getLogger } from "./logger";
import { fetchWithRetry, hideApiKeyFromurl, logIfDebug } from "./misc-utils";
import {
  MassiveDailyOpenClose,
  MassiveErrorResponse,
  MassiveGroupedDailyResponse,
  MassivePriceData,
  MassiveQuote,
  MassiveQuotesResponse,
  MassiveSpreadInfo,
  MassiveTickerInfo,
  MassiveTradesResponse,
  RawMassivePriceData,
} from "./types";
import { rateLimiters } from "./rate-limiter";
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from "./http-timeout";
import { validateMassiveApiKey } from "./utils/auth-validator";

/**
 * Set of Massive API response statuses that indicate valid, usable data.
 * "OK" = real-time data, "DELAYED" = delayed data (still valid, e.g. free-tier plans).
 */
const MASSIVE_VALID_STATUSES = new Set(["OK", "DELAYED"]);

/**
 * Throttle map for DELAYED data warnings — logs once per ticker per 15 minutes
 * to avoid flooding logs when the entire feed is delayed (e.g. free-tier plans).
 */
const DELAYED_WARN_COOLDOWN_MS = 15 * 60 * 1000;
const delayedWarnTimestamps = new Map<string, number>();

// Constants from environment variables
const MASSIVE_API_KEY = process.env.MASSIVE_API_KEY;

// Define concurrency limits per API
const MASSIVE_CONCURRENCY_LIMIT = 100;

const massiveLimit = pLimit(MASSIVE_CONCURRENCY_LIMIT);

/**
 * In-flight request deduplication for fetchLastTrade.
 * When multiple callers request the same symbol simultaneously (e.g. 10 options
 * contracts all need the AMD underlying price), only one actual HTTP request is
 * made. All callers share the same Promise. The entry is removed when the
 * request settles, so subsequent calls after resolution make a fresh request.
 */
const fetchLastTradeInflight = new Map<string, Promise<MassiveQuote>>();

/**
 * Check if a symbol is a crypto pair based on common patterns.
 * Crypto symbols typically end in USD, USDT, USDC, or contain a hyphen with USD.
 * Examples: BTCUSD, BTC-USD, BTC/USD, LINKUSD, SOL-USD
 *
 * @param symbol - The ticker symbol to check
 * @returns True if the symbol appears to be a crypto pair
 */
function isCryptoSymbol(symbol: string): boolean {
  // Pattern: ends with USD/USDT/USDC and has 3-4 letter base (e.g., BTCUSD, LINKUSD)
  if (/^[A-Z]{2,5}(USD[TC]?)$/i.test(symbol)) {
    return true;
  }
  // Pattern: contains hyphen or slash with USD (e.g., BTC-USD, BTC/USD)
  if (/^[A-Z]{2,5}[-/]USD[TC]?$/i.test(symbol)) {
    return true;
  }
  // Pattern: already has X: prefix (e.g., X:BTC-USD)
  if (symbol.startsWith("X:")) {
    return true;
  }
  return false;
}

/**
 * Normalize a symbol for the Massive.com API.
 * Crypto symbols must be prefixed with "X:" and use hyphen format (e.g., X:BTC-USD).
 * Stock symbols are passed through unchanged.
 *
 * @param symbol - The raw ticker symbol
 * @returns The symbol formatted for Massive.com API
 */
function normalizeMassiveSymbol(symbol: string): string {
  // If already has X: prefix, ensure hyphen format
  if (symbol.startsWith("X:")) {
    return symbol;
  }

  // Check if it's a crypto symbol
  if (!isCryptoSymbol(symbol)) {
    return symbol; // Stock symbol - return unchanged
  }

  // Normalize crypto symbol to X:BASE-QUOTE format
  // Handle formats: BTCUSD, BTC-USD, BTC/USD -> X:BTC-USD
  let base: string;
  let quote: string;

  if (symbol.includes("-")) {
    // Format: BTC-USD
    const parts = symbol.split("-");
    base = parts[0];
    quote = parts.slice(1).join("-");
  } else if (symbol.includes("/")) {
    // Format: BTC/USD
    const parts = symbol.split("/");
    base = parts[0];
    quote = parts.slice(1).join("/");
  } else {
    // Format: BTCUSD - need to extract base and quote
    // Common quote currencies: USD, USDT, USDC
    if (symbol.endsWith("USDT")) {
      base = symbol.slice(0, -4);
      quote = "USDT";
    } else if (symbol.endsWith("USDC")) {
      base = symbol.slice(0, -4);
      quote = "USDC";
    } else if (symbol.endsWith("USD")) {
      base = symbol.slice(0, -3);
      quote = "USD";
    } else {
      // Unknown format, return as-is
      return symbol;
    }
  }

  return `X:${base.toUpperCase()}-${quote.toUpperCase()}`;
}

// Use to update general information about stocks
/**
 * Fetches general information about a stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch information for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<MassiveTickerInfo | null>} The ticker information or null if not found.
 */

export const fetchTickerInfo = async (
  symbol: string,
  options?: { apiKey?: string },
): Promise<MassiveTickerInfo | null> => {
  if (!options?.apiKey && !MASSIVE_API_KEY) {
    throw new Error("Massive API key is missing");
  }

  const apiKey = options?.apiKey || MASSIVE_API_KEY!;
  validateMassiveApiKey(apiKey);

  const baseUrl = `https://api.massive.com/v3/reference/tickers/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams({
    apiKey,
  });

  return massiveLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(
        `${baseUrl}?${params.toString()}`,
        { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) },
        3,
        1000,
      );
      const data = await response.json();

      // Check for "NOT_FOUND" status and return null
      if (data.status === "NOT_FOUND") {
        getLogger().warn(`Ticker not found: ${symbol}`);
        return null;
      }

      // Map the results to the required structure
      const results = data.results;
      if (!results) {
        throw new Error("No results in Massive API response");
      }

      // Validate required fields
      const requiredFields = [
        "active",
        "currency_name",
        "locale",
        "market",
        "name",
        "primary_exchange",
        "ticker",
        "type",
      ];

      for (const field of requiredFields) {
        if (results[field] === undefined) {
          throw new Error(
            `Missing required field in Massive API response: ${field}`,
          );
        }
      }

      // Handle optional share_class_shares_outstanding field
      if (results.share_class_shares_outstanding === undefined) {
        results.share_class_shares_outstanding = null;
      }

      const tickerInfo = {
        ticker: results.ticker,
        type: results.type,
        active: results.active,
        currency_name: results.currency_name,
        description: results.description ?? "No description available",
        locale: results.locale,
        market: results.market,
        market_cap: results.market_cap ?? 0,
        name: results.name,
        primary_exchange: results.primary_exchange,
        share_class_shares_outstanding: results.share_class_shares_outstanding,
      };
      return tickerInfo as MassiveTickerInfo;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      const contextualMessage = `Error fetching ticker info for ${symbol}`;

      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        symbol,
        errorType:
          error instanceof Error && error.message.includes("AUTH_ERROR")
            ? "AUTH_ERROR"
            : error instanceof Error && error.message.includes("RATE_LIMIT")
              ? "RATE_LIMIT"
              : error instanceof Error &&
                  error.message.includes("NETWORK_ERROR")
                ? "NETWORK_ERROR"
                : "UNKNOWN",
        url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
        source: "MassiveAPI.fetchTickerInfo",
        timestamp: new Date().toISOString(),
      });

      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};

// Fetch last trade using Massive.com
/**
 * Fetches the last trade for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch the last trade for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<MassiveQuote>} The last trade information.
 */

export const fetchLastTrade = async (
  symbol: string,
  options?: { apiKey?: string },
): Promise<MassiveQuote> => {
  // Coalesce concurrent requests for the same symbol.
  // If a request is already in-flight, return the shared promise.
  const inflight = fetchLastTradeInflight.get(symbol);
  if (inflight) {
    return inflight;
  }

  const promise = fetchLastTradeImpl(symbol, options);
  fetchLastTradeInflight.set(symbol, promise);

  try {
    return await promise;
  } finally {
    fetchLastTradeInflight.delete(symbol);
  }
};

/**
 * Internal implementation of fetchLastTrade (called once per dedup window).
 */
const fetchLastTradeImpl = async (
  symbol: string,
  options?: { apiKey?: string },
): Promise<MassiveQuote> => {
  if (!options?.apiKey && !MASSIVE_API_KEY) {
    throw new Error("Massive API key is missing");
  }

  const apiKey = options?.apiKey || MASSIVE_API_KEY!;
  validateMassiveApiKey(apiKey);

  // Normalize crypto symbols to Massive.com API format (e.g., LINK-USD -> X:LINK-USD)
  const normalizedSymbol = normalizeMassiveSymbol(symbol);
  const baseUrl = `https://api.massive.com/v3/trades/${encodeURIComponent(normalizedSymbol)}`;
  const params = new URLSearchParams({
    apiKey,
    limit: "1",
    sort: "timestamp",
    order: "desc",
  });

  return massiveLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(
        `${baseUrl}?${params.toString()}`,
        { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) },
        3,
        1000,
      );
      const data = (await response.json()) as
        | MassiveTradesResponse
        | MassiveErrorResponse;

      if ("message" in data) {
        throw new Error(
          `Massive.com API error: ${(data as MassiveErrorResponse).message}`,
        );
      }

      if (
        !data.results ||
        !Array.isArray(data.results) ||
        data.results.length === 0
      ) {
        throw new Error(
          `Massive.com API error: No trade results for ${symbol}`,
        );
      }

      const latestTrade = data.results[0];
      const price = latestTrade.price;
      const vol = latestTrade.size;
      const timestamp = latestTrade.sip_timestamp;

      if (
        typeof price !== "number" ||
        typeof vol !== "number" ||
        typeof timestamp !== "number"
      ) {
        throw new Error("Invalid trade data received from Massive.com API");
      }

      return {
        price,
        vol,
        time: new Date(Math.floor(timestamp / 1000000)), // Convert nanoseconds to milliseconds
      } satisfies MassiveQuote;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      const contextualMessage = `Error fetching last trade for ${symbol}${normalizedSymbol !== symbol ? ` (normalized: ${normalizedSymbol})` : ""}`;

      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        symbol,
        normalizedSymbol,
        errorType:
          error instanceof Error && error.message.includes("AUTH_ERROR")
            ? "AUTH_ERROR"
            : error instanceof Error && error.message.includes("RATE_LIMIT")
              ? "RATE_LIMIT"
              : error instanceof Error &&
                  error.message.includes("NETWORK_ERROR")
                ? "NETWORK_ERROR"
                : "UNKNOWN",
        url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
        source: "MassiveAPI.fetchLastTrade",
        timestamp: new Date().toISOString(),
      });

      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};

/**
 * Fetches the latest NBBO quote for a given stock ticker using the Massive v3 API.
 * Returns processed spread information including bid, ask, spread, and mid price.
 *
 * @param symbol - The stock ticker symbol.
 * @param options - Optional parameters including API key override.
 * @returns Processed quote data with spread metrics.
 */
export const fetchLastQuote = async (
  symbol: string,
  options?: { apiKey?: string },
): Promise<MassiveSpreadInfo> => {
  if (!options?.apiKey && !MASSIVE_API_KEY) {
    throw new Error("Massive API key is missing");
  }

  const apiKey = options?.apiKey || MASSIVE_API_KEY!;
  validateMassiveApiKey(apiKey);

  const baseUrl = `https://api.massive.com/v3/quotes/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams({
    apiKey,
    limit: "1",
    sort: "timestamp",
    order: "desc",
  });

  return massiveLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(
        `${baseUrl}?${params.toString()}`,
        { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) },
        3,
        1000,
      );
      const data = (await response.json()) as
        | MassiveQuotesResponse
        | MassiveErrorResponse;

      if ("message" in data) {
        throw new Error(
          `Massive.com API error: ${(data as MassiveErrorResponse).message}`,
        );
      }

      const results = (data as MassiveQuotesResponse).results;
      if (!Array.isArray(results) || results.length === 0) {
        throw new Error(
          `Massive.com API error: No quote results for ${symbol}`,
        );
      }

      const quote = results[0];
      if (
        typeof quote.bid_price !== "number" ||
        typeof quote.ask_price !== "number"
      ) {
        throw new Error("Invalid quote data received from Massive.com API");
      }

      const midPrice = (quote.bid_price + quote.ask_price) / 2;
      const spread = quote.ask_price - quote.bid_price;

      return {
        bid: quote.bid_price,
        ask: quote.ask_price,
        spread,
        spreadPercent: midPrice > 0 ? (spread / midPrice) * 100 : 0,
        midPrice,
        bidSize: quote.bid_size,
        askSize: quote.ask_size,
        time: new Date(Math.floor(quote.sip_timestamp / 1000000)),
      } satisfies MassiveSpreadInfo;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      const contextualMessage = `Error fetching last quote for ${symbol}`;

      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        symbol,
        errorType:
          error instanceof Error && error.message.includes("AUTH_ERROR")
            ? "AUTH_ERROR"
            : error instanceof Error && error.message.includes("RATE_LIMIT")
              ? "RATE_LIMIT"
              : error instanceof Error &&
                  error.message.includes("NETWORK_ERROR")
                ? "NETWORK_ERROR"
                : "UNKNOWN",
        url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
        source: "MassiveAPI.fetchLastQuote",
        timestamp: new Date().toISOString(),
      });

      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};

// use Massive for all price data fetching
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
 * @returns {Promise<MassivePriceData[]>} The fetched price data.
 */

export const fetchPrices = async (
  params: {
    ticker: string;
    start: number;
    end?: number;
    multiplier: number;
    timespan: string;
    limit?: number;
    adjusted?: boolean;
  },
  options?: { apiKey?: string },
): Promise<MassivePriceData[]> => {
  if (!options?.apiKey && !MASSIVE_API_KEY) {
    throw new Error("Massive API key is missing");
  }

  const apiKey = options?.apiKey || MASSIVE_API_KEY!;
  validateMassiveApiKey(apiKey);

  const {
    ticker,
    start,
    end = Date.now().valueOf(),
    multiplier,
    timespan,
    limit = 1000,
  } = params;

  const baseUrl = `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(
    ticker,
  )}/range/${multiplier}/${timespan}/${start}/${end}`;

  const urlParams = new URLSearchParams({
    apiKey,
    ...(params.adjusted !== false && { adjusted: "true" }),
    sort: "asc",
    limit: limit.toString(),
  });

  return massiveLimit(async () => {
    try {
      let allResults: RawMassivePriceData[] = [];
      let nextUrl = `${baseUrl}?${urlParams.toString()}`;

      while (nextUrl) {
        //getLogger().info(`Debug: Fetching ${nextUrl}`);
        await rateLimiters.massive.acquire();
        const response = await fetchWithRetry(nextUrl, { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) }, 3, 1000);
        const data = await response.json();

        if (!MASSIVE_VALID_STATUSES.has(data.status)) {
          throw new Error(
            `Massive.com API responded with status: ${data.status}`,
          );
        }

        if (data.status === "DELAYED") {
          const now = Date.now();
          const lastWarn = delayedWarnTimestamps.get(params.ticker) ?? 0;
          if (now - lastWarn > DELAYED_WARN_COOLDOWN_MS) {
            delayedWarnTimestamps.set(params.ticker, now);
            getLogger().info(
              `Massive.com returned DELAYED data for ${params.ticker} — using delayed results`,
              { ticker: params.ticker, source: "MassiveAPI.fetchPrices" },
            );
          }
        }

        if (data.results) {
          allResults = [...allResults, ...data.results];
        }

        // Check if there's a next page and append API key
        nextUrl = data.next_url ? `${data.next_url}&apiKey=${apiKey}` : "";
      }

      return allResults.map((entry: RawMassivePriceData) => ({
        date: new Date(entry.t).toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: "America/New_York",
          timeZoneName: "short",
          hourCycle: "h23",
        }),
        timeStamp: entry.t,
        open: entry.o,
        high: entry.h,
        low: entry.l,
        close: entry.c,
        vol: entry.v,
        vwap: entry.vw,
        trades: entry.n,
      })) as MassivePriceData[];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      const contextualMessage = `Error fetching price data for ${ticker}`;

      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        ticker,
        errorType:
          error instanceof Error && error.message.includes("AUTH_ERROR")
            ? "AUTH_ERROR"
            : error instanceof Error && error.message.includes("RATE_LIMIT")
              ? "RATE_LIMIT"
              : error instanceof Error &&
                  error.message.includes("NETWORK_ERROR")
                ? "NETWORK_ERROR"
                : "UNKNOWN",
        source: "MassiveAPI.fetchPrices",
        timestamp: new Date().toISOString(),
      });

      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};

/**
 * Analyzes the price data for a given stock.
 * @param {MassivePriceData[]} priceData - The price data to analyze.
 * @returns {string} The analysis report.
 */

export function analyseMassivePriceData(priceData: MassivePriceData[]): string {
  if (!priceData || priceData.length === 0) {
    return "No price data available for analysis.";
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
  const _totalTimeInHours =
    (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

  // Calculate the interval between data points
  const intervals = parsedData
    .slice(1)
    .map(
      (_, i) =>
        (parsedData[i + 1].date.getTime() - parsedData[i].date.getTime()) /
        1000,
    ); // in seconds
  const avgInterval =
    intervals.length > 0
      ? intervals.reduce((sum, interval) => sum + interval, 0) /
        intervals.length
      : 0;

  // Format the report
  const report = `
Report:
* Start time of data (US Eastern): ${startTime.toLocaleString("en-US", { timeZone: "America/New_York" })}
* End time of data (US Eastern): ${endTime.toLocaleString("en-US", { timeZone: "America/New_York" })}
* Number of data points: ${priceData.length}
* Average interval between data points (seconds): ${avgInterval.toFixed(2)}
  `;

  return report.trim();
}

import { formatCurrency } from "./format-tools";

/**
 * Fetches grouped daily price data for a specific date.
 * @param {string} date - The date to fetch grouped daily data for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @param {boolean} [options.adjusted] - Whether to adjust the data.
 * @param {boolean} [options.includeOTC] - Whether to include OTC data.
 * @returns {Promise<MassiveGroupedDailyResponse>} The grouped daily response.
 */

export const fetchGroupedDaily = async (
  date: string,
  options?: {
    apiKey?: string;
    adjusted?: boolean;
    includeOTC?: boolean;
  },
): Promise<MassiveGroupedDailyResponse> => {
  if (!options?.apiKey && !MASSIVE_API_KEY) {
    throw new Error("Massive API key is missing");
  }

  const baseUrl = `https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/${date}`;
  const params = new URLSearchParams({
    apiKey: options?.apiKey || MASSIVE_API_KEY!,
    adjusted: options?.adjusted !== false ? "true" : "false",
    include_otc: options?.includeOTC ? "true" : "false",
  });

  return massiveLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(
        `${baseUrl}?${params.toString()}`,
        { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) },
        3,
        1000,
      );
      const data = await response.json();

      if (!MASSIVE_VALID_STATUSES.has(data.status)) {
        throw new Error(
          `Massive.com API responded with status: ${data.status}`,
        );
      }

      const groupedDaily = {
        adjusted: data.adjusted,
        queryCount: data.queryCount,
        request_id: data.request_id,
        resultsCount: data.resultsCount,
        status: data.status,
        results: data.results.map((result: RawMassivePriceData) => ({
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
      };
      return groupedDaily as MassiveGroupedDailyResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      const contextualMessage = `Error fetching grouped daily data for ${date}`;

      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        date,
        errorType:
          error instanceof Error && error.message.includes("AUTH_ERROR")
            ? "AUTH_ERROR"
            : error instanceof Error && error.message.includes("RATE_LIMIT")
              ? "RATE_LIMIT"
              : error instanceof Error &&
                  error.message.includes("NETWORK_ERROR")
                ? "NETWORK_ERROR"
                : "UNKNOWN",
        url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
        source: "MassiveAPI.fetchGroupedDaily",
        timestamp: new Date().toISOString(),
      });

      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};

/**
 * Formats the price data into a readable string.
 * @param {MassivePriceData[]} priceData - The price data to format.
 * @returns {string} The formatted price data.
 */

export function formatPriceData(priceData: MassivePriceData[]): string {
  if (!priceData || priceData.length === 0) return "No price data available";

  return priceData
    .map((d) => {
      // For daily data, remove the time portion if it's all zeros
      const dateStr = d.date.includes(", 00:00:00")
        ? d.date.split(", 00:00:00")[0]
        : d.date;

      return [
        dateStr,
        `O: ${formatCurrency(d.open)}`,
        `H: ${formatCurrency(d.high)}`,
        `L: ${formatCurrency(d.low)}`,
        `C: ${formatCurrency(d.close)}`,
        `Vol: ${d.vol}`,
      ].join(" | ");
    })
    .join("\n");
}

export const fetchDailyOpenClose = async (
  /**
   * Fetches the daily open and close data for a given stock ticker.
   * @param {string} symbol - The stock ticker symbol to fetch data for.
   * @param {Date} [date=new Date()] - The date to fetch data for.
   * @param {Object} [options] - Optional parameters.
   * @param {string} [options.apiKey] - The API key to use for the request.
   * @param {boolean} [options.adjusted] - Whether to adjust the data.
   * @returns {Promise<MassiveDailyOpenClose>} The daily open and close data.
   */

  symbol: string,
  date: Date = new Date(),
  options?: {
    apiKey?: string;
    adjusted?: boolean;
  },
): Promise<MassiveDailyOpenClose> => {
  if (!options?.apiKey && !MASSIVE_API_KEY) {
    throw new Error("Massive API key is missing");
  }

  const formattedDate = date.toISOString().split("T")[0]; // Format as YYYY-MM-DD
  const baseUrl = `https://api.massive.com/v1/open-close/${encodeURIComponent(symbol)}/${formattedDate}`;
  const params = new URLSearchParams({
    apiKey: options?.apiKey || MASSIVE_API_KEY!,
    adjusted: (options?.adjusted ?? true).toString(),
  });

  return massiveLimit(async () => {
    await rateLimiters.massive.acquire();
    try {
      const response = await fetchWithRetry(
        `${baseUrl}?${params.toString()}`,
        { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) },
        3,
        1000,
      );
      const data = await response.json();

      if (!MASSIVE_VALID_STATUSES.has(data.status)) {
        throw new Error(
          `Failed to fetch daily open/close data for ${symbol}: ${data.status}`,
        );
      }

      return data;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      getLogger().error(
        `Error fetching daily open/close for ${symbol}: ${errorMessage}`,
      );
      throw error;
    }
  });
};

import { getLastFullTradingDate } from "./market-time";

/**
 * Gets the previous close price for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch the previous close for.
 * @param {Date} [referenceDate] - The reference date to use for fetching the previous close.
 * @returns {Promise<{ close: number; date: Date }>} The previous close price and date.
 */

export async function getPreviousClose(
  symbol: string,
  referenceDate?: Date,
  options?: { apiKey?: string },
): Promise<{ close: number; date: Date }> {
  const previousDate = getLastFullTradingDate(referenceDate).date;
  const lastOpenClose = await fetchDailyOpenClose(
    symbol,
    previousDate,
    options,
  );
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
 * @returns {Promise<MassiveTradesResponse>} The fetched trades response.
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
    order?: "asc" | "desc";
    limit?: number;
    sort?: string;
  },
): Promise<MassiveTradesResponse> => {
  if (!options?.apiKey && !MASSIVE_API_KEY) {
    throw new Error("Massive API key is missing");
  }

  const baseUrl = `https://api.massive.com/v3/trades/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams({
    apiKey: options?.apiKey || MASSIVE_API_KEY!,
  });

  // Add optional parameters if they exist
  if (options?.timestamp)
    params.append("timestamp", options.timestamp.toString());
  if (options?.timestampgt)
    params.append("timestamp.gt", options.timestampgt.toString());
  if (options?.timestampgte)
    params.append("timestamp.gte", options.timestampgte.toString());
  if (options?.timestamplt)
    params.append("timestamp.lt", options.timestamplt.toString());
  if (options?.timestamplte)
    params.append("timestamp.lte", options.timestamplte.toString());
  if (options?.order) params.append("order", options.order);
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.sort) params.append("sort", options.sort);

  return massiveLimit(async () => {
    await rateLimiters.massive.acquire();
    const url = `${baseUrl}?${params.toString()}`;
    try {
      logIfDebug(`Fetching trades for ${symbol} from ${url}`);
      const response = await fetchWithRetry(url, { signal: createTimeoutSignal(DEFAULT_TIMEOUTS.MASSIVE_API) }, 3, 1000);
      const data = (await response.json()) as
        | MassiveTradesResponse
        | MassiveErrorResponse;

      if ("message" in data) {
        // This is an error response
        throw new Error(`Massive API Error: ${data.message}`);
      }

      return data;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      const contextualMessage = `Error fetching trades for ${symbol}`;

      getLogger().error(`${contextualMessage}: ${errorMessage}`, {
        symbol,
        errorType:
          error instanceof Error && error.message.includes("AUTH_ERROR")
            ? "AUTH_ERROR"
            : error instanceof Error && error.message.includes("RATE_LIMIT")
              ? "RATE_LIMIT"
              : error instanceof Error &&
                  error.message.includes("NETWORK_ERROR")
                ? "NETWORK_ERROR"
                : "UNKNOWN",
        url: hideApiKeyFromurl(url),
        source: "MassiveAPI.fetchTrades",
        timestamp: new Date().toISOString(),
      });

      throw new Error(`${contextualMessage}: ${errorMessage}`);
    }
  });
};
