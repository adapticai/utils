/**
 * Bars Module
 * Historical and real-time OHLCV data using Alpaca SDK
 */
import { AlpacaClient } from '../client';
import { Bar, TimeFrame } from '../../types/alpaca-types';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'AlpacaBars' });
};

/**
 * Error thrown when bar operations fail
 */
export class BarError extends Error {
  constructor(
    message: string,
    public code: string,
    public symbol?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'BarError';
  }
}

/**
 * Parameters for fetching bars
 */
export interface GetBarsParams {
  /** Symbols to fetch bars for */
  symbols: string[];
  /** Bar timeframe (e.g., '1Min', '5Min', '1Hour', '1Day') */
  timeframe: TimeFrame;
  /** Start date/time for the data range */
  start?: Date | string;
  /** End date/time for the data range */
  end?: Date | string;
  /** Maximum number of bars to return per symbol */
  limit?: number;
  /** Price adjustment type */
  adjustment?: 'raw' | 'split' | 'dividend' | 'all';
  /** Data feed (sip for premium, iex for free tier) */
  feed?: 'sip' | 'iex';
}

/**
 * Bar analysis summary
 */
export interface BarAnalysis {
  /** Opening price of the period */
  open: number;
  /** Highest price during the period */
  high: number;
  /** Lowest price during the period */
  low: number;
  /** Closing price of the period */
  close: number;
  /** Total volume traded */
  volume: number;
  /** Volume-weighted average price */
  vwap: number;
  /** Price change (close - open) */
  change: number;
  /** Price change as percentage */
  changePercent: number;
  /** Number of bars analyzed */
  barCount: number;
  /** Total number of trades */
  totalTrades: number;
}

/**
 * Convert date to RFC-3339 format string
 */
function toRFC3339(date: Date | string): string {
  if (typeof date === 'string') {
    return date;
  }
  return date.toISOString();
}

/**
 * Get historical bars with automatic pagination
 * @param client - AlpacaClient instance
 * @param params - Parameters for fetching bars
 * @returns Map of symbol to array of bars
 */
export async function getBars(
  client: AlpacaClient,
  params: GetBarsParams
): Promise<Map<string, Bar[]>> {
  const { symbols, timeframe, start, end, limit, adjustment, feed } = params;

  if (!symbols || symbols.length === 0) {
    throw new BarError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  if (normalizedSymbols.length === 0) {
    throw new BarError('No valid symbols provided', 'INVALID_SYMBOLS');
  }

  log(`Fetching bars for ${normalizedSymbols.length} symbols with timeframe ${timeframe}`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const config = client.getConfig();
    const dataFeed = feed || config.dataFeed || 'iex';

    const options: {
      timeframe: string;
      start?: string;
      end?: string;
      limit?: number;
      adjustment?: string;
      feed?: string;
    } = {
      timeframe,
      feed: dataFeed,
    };

    if (start) {
      options.start = toRFC3339(start);
    }
    if (end) {
      options.end = toRFC3339(end);
    }
    if (limit) {
      options.limit = limit;
    }
    if (adjustment) {
      options.adjustment = adjustment;
    }

    // Use SDK's getBarsV2 method with pagination
    const result = new Map<string, Bar[]>();

    // Initialize empty arrays for each symbol
    for (const symbol of normalizedSymbols) {
      result.set(symbol, []);
    }

    // Fetch bars - the SDK handles pagination internally via async iterator
    const barsIterator = sdk.getBarsV2(normalizedSymbols.join(','), options);

    for await (const bar of barsIterator) {
      const symbol = bar.Symbol;
      const existingBars = result.get(symbol) || [];

      existingBars.push({
        t: bar.Timestamp,
        o: bar.OpenPrice,
        h: bar.HighPrice,
        l: bar.LowPrice,
        c: bar.ClosePrice,
        v: bar.Volume,
        n: bar.TradeCount,
        vw: bar.VWAP,
      });

      result.set(symbol, existingBars);
    }

    const totalBars = Array.from(result.values()).reduce((sum, bars) => sum + bars.length, 0);
    log(`Successfully fetched ${totalBars} bars for ${normalizedSymbols.length} symbols`, { type: 'debug' });

    return result;
  } catch (error) {
    if (error instanceof BarError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch bars: ${errorMessage}`, { type: 'error' });

    throw new BarError(
      `Failed to fetch bars: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get latest bars for symbols
 * @param client - AlpacaClient instance
 * @param symbols - Array of stock symbols
 * @returns Map of symbol to latest bar
 */
export async function getLatestBars(
  client: AlpacaClient,
  symbols: string[]
): Promise<Map<string, Bar>> {
  if (!symbols || symbols.length === 0) {
    throw new BarError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  log(`Fetching latest bars for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const config = client.getConfig();
    const dataFeed = config.dataFeed || 'iex';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await sdk.getLatestBars(normalizedSymbols, { feed: dataFeed } as any);

    const result = new Map<string, Bar>();

    for (const [symbol, bar] of Object.entries(response)) {
      const b = bar as {
        Timestamp: string;
        OpenPrice: number;
        HighPrice: number;
        LowPrice: number;
        ClosePrice: number;
        Volume: number;
        TradeCount: number;
        VWAP: number;
      };

      result.set(symbol, {
        t: b.Timestamp,
        o: b.OpenPrice,
        h: b.HighPrice,
        l: b.LowPrice,
        c: b.ClosePrice,
        v: b.Volume,
        n: b.TradeCount,
        vw: b.VWAP,
      });
    }

    log(`Successfully fetched latest bars for ${result.size} symbols`, { type: 'debug' });

    return result;
  } catch (error) {
    if (error instanceof BarError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch latest bars: ${errorMessage}`, { type: 'error' });

    throw new BarError(
      `Failed to fetch latest bars: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get daily prices for a symbol
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param days - Number of days of history to fetch
 * @returns Array of daily bars
 */
export async function getDailyPrices(
  client: AlpacaClient,
  symbol: string,
  days: number
): Promise<Bar[]> {
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!normalizedSymbol) {
    throw new BarError('Symbol is required', 'INVALID_SYMBOL');
  }

  if (days <= 0) {
    throw new BarError('Days must be a positive number', 'INVALID_DAYS');
  }

  log(`Fetching ${days} days of daily prices for ${normalizedSymbol}`, { type: 'debug' });

  // Calculate start date (add buffer for weekends/holidays)
  const bufferDays = Math.ceil(days * 1.5) + 10;
  const start = new Date();
  start.setDate(start.getDate() - bufferDays);

  const result = await getBars(client, {
    symbols: [normalizedSymbol],
    timeframe: '1Day',
    start,
    limit: days,
    adjustment: 'all',
  });

  const bars = result.get(normalizedSymbol) || [];

  // Return only the requested number of days (most recent)
  if (bars.length > days) {
    return bars.slice(-days);
  }

  return bars;
}

/**
 * Get intraday prices for a symbol
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param timeframe - Bar timeframe
 * @param start - Start date/time
 * @param end - Optional end date/time (defaults to now)
 * @returns Array of intraday bars
 */
export async function getIntradayPrices(
  client: AlpacaClient,
  symbol: string,
  timeframe: TimeFrame,
  start: Date,
  end?: Date
): Promise<Bar[]> {
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!normalizedSymbol) {
    throw new BarError('Symbol is required', 'INVALID_SYMBOL');
  }

  log(`Fetching intraday prices for ${normalizedSymbol} (${timeframe})`, { type: 'debug' });

  const result = await getBars(client, {
    symbols: [normalizedSymbol],
    timeframe,
    start,
    end: end || new Date(),
  });

  return result.get(normalizedSymbol) || [];
}

/**
 * Get previous close price for a symbol
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @returns Previous close price
 */
export async function getPreviousClose(
  client: AlpacaClient,
  symbol: string
): Promise<number> {
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!normalizedSymbol) {
    throw new BarError('Symbol is required', 'INVALID_SYMBOL');
  }

  log(`Fetching previous close for ${normalizedSymbol}`, { type: 'debug' });

  // Get the last 2 daily bars to ensure we have the previous day
  const bars = await getDailyPrices(client, normalizedSymbol, 2);

  if (bars.length === 0) {
    throw new BarError(
      `No price data available for ${normalizedSymbol}`,
      'NO_DATA',
      normalizedSymbol
    );
  }

  // If we have 2 bars, the previous close is from the second-to-last bar
  // If we only have 1 bar, use that bar's close
  const previousBar = bars.length >= 2 ? bars[bars.length - 2] : bars[bars.length - 1];

  return previousBar.c;
}

/**
 * Analyze bars and return summary statistics
 * @param bars - Array of bars to analyze
 * @returns Analysis summary with OHLCV stats and price change
 */
export function analyzeBars(bars: Bar[]): BarAnalysis {
  if (!bars || bars.length === 0) {
    return {
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      volume: 0,
      vwap: 0,
      change: 0,
      changePercent: 0,
      barCount: 0,
      totalTrades: 0,
    };
  }

  const open = bars[0].o;
  const close = bars[bars.length - 1].c;

  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let vwapSum = 0;
  let volumeSum = 0;
  let totalTrades = 0;

  for (const bar of bars) {
    if (bar.h > high) high = bar.h;
    if (bar.l < low) low = bar.l;
    volume += bar.v;
    totalTrades += bar.n;

    // Calculate VWAP using volume-weighted prices
    if (bar.vw > 0 && bar.v > 0) {
      vwapSum += bar.vw * bar.v;
      volumeSum += bar.v;
    }
  }

  const vwap = volumeSum > 0 ? vwapSum / volumeSum : 0;
  const change = close - open;
  const changePercent = open !== 0 ? (change / open) * 100 : 0;

  return {
    open,
    high: high === -Infinity ? 0 : high,
    low: low === Infinity ? 0 : low,
    close,
    volume,
    vwap,
    change,
    changePercent,
    barCount: bars.length,
    totalTrades,
  };
}

/**
 * Get price range statistics for a symbol over a period
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param days - Number of days to analyze
 * @returns Analysis of the price range
 */
export async function getPriceRange(
  client: AlpacaClient,
  symbol: string,
  days: number
): Promise<BarAnalysis> {
  const bars = await getDailyPrices(client, symbol, days);
  return analyzeBars(bars);
}

/**
 * Calculate average daily volume for a symbol
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param days - Number of days to average (default 20)
 * @returns Average daily volume
 */
export async function getAverageDailyVolume(
  client: AlpacaClient,
  symbol: string,
  days: number = 20
): Promise<number> {
  const bars = await getDailyPrices(client, symbol, days);

  if (bars.length === 0) {
    return 0;
  }

  const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
  return totalVolume / bars.length;
}

/**
 * Check if a symbol has sufficient trading volume
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param minAvgVolume - Minimum average daily volume required (default 100,000)
 * @param days - Number of days to check (default 20)
 * @returns true if average volume meets minimum requirement
 */
export async function hasSufficientVolume(
  client: AlpacaClient,
  symbol: string,
  minAvgVolume: number = 100000,
  days: number = 20
): Promise<boolean> {
  try {
    const avgVolume = await getAverageDailyVolume(client, symbol, days);
    return avgVolume >= minAvgVolume;
  } catch (error) {
    log(`Failed to check volume for ${symbol}: ${(error as Error).message}`, { type: 'warn' });
    return false;
  }
}

export default {
  getBars,
  getLatestBars,
  getDailyPrices,
  getIntradayPrices,
  getPreviousClose,
  analyzeBars,
  getPriceRange,
  getAverageDailyVolume,
  hasSufficientVolume,
};
