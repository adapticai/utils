/**
 * Options Market Data Module
 * Quotes, bars, and analytics for options using Alpaca SDK
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  OptionQuote,
  OptionTrade,
  OptionBar,
  OptionSnapshot,
  OptionGreeks,
  OptionsChainParams,
  OptionsChainResponse,
  TimeFrame,
} from '../../types/alpaca-types';

const LOG_SOURCE = 'OptionsData';

/**
 * Internal logging helper with consistent source
 */
const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: LOG_SOURCE });
};

/**
 * Error class for options data operations
 */
export class OptionsDataError extends Error {
  constructor(
    message: string,
    public code: string,
    public symbol?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'OptionsDataError';
  }
}

/**
 * Options data feed type
 */
export type OptionsFeed = 'opra' | 'indicative';

/**
 * Base URL for Alpaca options market data API
 */
const OPTIONS_DATA_BASE_URL = `${MARKET_DATA_API.OPTIONS}/options`;

/**
 * Make an authenticated request to the Alpaca options data API
 */
async function makeOptionsDataRequest<T>(
  client: AlpacaClient,
  endpoint: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const config = client.getConfig();
  const url = new URL(`${OPTIONS_DATA_BASE_URL}${endpoint}`);

  // Add query parameters
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.append(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'APCA-API-KEY-ID': config.apiKey,
      'APCA-API-SECRET-KEY': config.apiSecret,
      'Content-Type': 'application/json',
    },
    signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new OptionsDataError(
      `Options data request failed: ${response.status} ${response.statusText}`,
      'API_ERROR',
      undefined,
      { status: response.status, body: errorText }
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Get options chain with snapshots for an underlying symbol
 * Returns option contracts with their latest quotes, trades, and Greeks
 */
export async function getOptionsChain(
  client: AlpacaClient,
  params: OptionsChainParams
): Promise<OptionsChainResponse> {
  const { underlying_symbol, ...queryParams } = params;

  if (!underlying_symbol) {
    throw new OptionsDataError(
      'Underlying symbol is required',
      'INVALID_PARAMS'
    );
  }

  log(`Fetching options chain for ${underlying_symbol}`, {
    type: 'debug',
    symbol: underlying_symbol,
  });

  try {
    // Build query parameters
    const apiParams: Record<string, string | number | boolean | undefined> = {
      underlying_symbol,
    };

    if (queryParams.feed) apiParams.feed = queryParams.feed;
    if (queryParams.limit) apiParams.limit = queryParams.limit;
    if (queryParams.updated_since) apiParams.updated_since = queryParams.updated_since;
    if (queryParams.page_token) apiParams.page_token = queryParams.page_token;
    if (queryParams.type) apiParams.type = queryParams.type;
    if (queryParams.strike_price_gte) apiParams.strike_price_gte = queryParams.strike_price_gte;
    if (queryParams.strike_price_lte) apiParams.strike_price_lte = queryParams.strike_price_lte;
    if (queryParams.expiration_date) apiParams.expiration_date = queryParams.expiration_date;
    if (queryParams.expiration_date_gte) apiParams.expiration_date_gte = queryParams.expiration_date_gte;
    if (queryParams.expiration_date_lte) apiParams.expiration_date_lte = queryParams.expiration_date_lte;
    if (queryParams.root_symbol) apiParams.root_symbol = queryParams.root_symbol;

    const response = await makeOptionsDataRequest<OptionsChainResponse>(
      client,
      '/snapshots',
      apiParams
    );

    const snapshotCount = Object.keys(response.snapshots || {}).length;
    log(`Retrieved options chain for ${underlying_symbol}: ${snapshotCount} contracts`, {
      type: 'debug',
      symbol: underlying_symbol,
      metadata: { count: snapshotCount },
    });

    return response;
  } catch (error) {
    if (error instanceof OptionsDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch options chain for ${underlying_symbol}: ${errorMessage}`, {
      type: 'error',
      symbol: underlying_symbol,
    });

    throw new OptionsDataError(
      `Failed to fetch options chain: ${errorMessage}`,
      'FETCH_ERROR',
      underlying_symbol,
      error
    );
  }
}

/**
 * Get latest option quotes for multiple symbols
 */
export async function getLatestOptionsQuotes(
  client: AlpacaClient,
  symbols: string[]
): Promise<Map<string, OptionQuote>> {
  if (!symbols || symbols.length === 0) {
    throw new OptionsDataError(
      'At least one symbol is required',
      'INVALID_PARAMS'
    );
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  log(`Fetching latest option quotes for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  try {
    const response = await makeOptionsDataRequest<{ quotes: Record<string, OptionQuote> }>(
      client,
      '/quotes/latest',
      { symbols: normalizedSymbols.join(',') }
    );

    const quotes = new Map<string, OptionQuote>();

    if (response.quotes) {
      Object.entries(response.quotes).forEach(([symbol, quote]) => {
        quotes.set(symbol, quote);
      });
    }

    log(`Retrieved ${quotes.size} option quotes`, {
      type: 'debug',
      metadata: { count: quotes.size },
    });

    return quotes;
  } catch (error) {
    if (error instanceof OptionsDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch option quotes: ${errorMessage}`, { type: 'error' });

    throw new OptionsDataError(
      `Failed to fetch option quotes: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get latest option trades for multiple symbols
 */
export async function getLatestOptionsTrades(
  client: AlpacaClient,
  symbols: string[]
): Promise<Map<string, OptionTrade>> {
  if (!symbols || symbols.length === 0) {
    throw new OptionsDataError(
      'At least one symbol is required',
      'INVALID_PARAMS'
    );
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  log(`Fetching latest option trades for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  try {
    const response = await makeOptionsDataRequest<{ trades: Record<string, OptionTrade> }>(
      client,
      '/trades/latest',
      { symbols: normalizedSymbols.join(',') }
    );

    const trades = new Map<string, OptionTrade>();

    if (response.trades) {
      Object.entries(response.trades).forEach(([symbol, trade]) => {
        trades.set(symbol, trade);
      });
    }

    log(`Retrieved ${trades.size} option trades`, {
      type: 'debug',
      metadata: { count: trades.size },
    });

    return trades;
  } catch (error) {
    if (error instanceof OptionsDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch option trades: ${errorMessage}`, { type: 'error' });

    throw new OptionsDataError(
      `Failed to fetch option trades: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get option snapshots with Greeks for multiple symbols
 */
export async function getOptionsSnapshots(
  client: AlpacaClient,
  symbols: string[]
): Promise<Map<string, OptionSnapshot>> {
  if (!symbols || symbols.length === 0) {
    throw new OptionsDataError(
      'At least one symbol is required',
      'INVALID_PARAMS'
    );
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  log(`Fetching option snapshots for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  try {
    const response = await makeOptionsDataRequest<{ snapshots: Record<string, OptionSnapshot> }>(
      client,
      '/snapshots',
      { symbols: normalizedSymbols.join(',') }
    );

    const snapshots = new Map<string, OptionSnapshot>();

    if (response.snapshots) {
      Object.entries(response.snapshots).forEach(([symbol, snapshot]) => {
        snapshots.set(symbol, snapshot);
      });
    }

    log(`Retrieved ${snapshots.size} option snapshots`, {
      type: 'debug',
      metadata: { count: snapshots.size },
    });

    return snapshots;
  } catch (error) {
    if (error instanceof OptionsDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch option snapshots: ${errorMessage}`, { type: 'error' });

    throw new OptionsDataError(
      `Failed to fetch option snapshots: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Parameters for historical options bars request
 */
export interface GetHistoricalOptionsBarsParams {
  /** Option contract symbols */
  symbols: string[];
  /** Bar timeframe (e.g., '1Min', '1Hour', '1Day') */
  timeframe: TimeFrame;
  /** Start date/time */
  start?: Date;
  /** End date/time */
  end?: Date;
  /** Maximum number of bars to return */
  limit?: number;
}

/**
 * Get historical option bars (OHLCV data)
 */
export async function getHistoricalOptionsBars(
  client: AlpacaClient,
  params: GetHistoricalOptionsBarsParams
): Promise<Map<string, OptionBar[]>> {
  const { symbols, timeframe, start, end, limit } = params;

  if (!symbols || symbols.length === 0) {
    throw new OptionsDataError(
      'At least one symbol is required',
      'INVALID_PARAMS'
    );
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  log(`Fetching historical option bars for ${normalizedSymbols.length} symbols (${timeframe})`, {
    type: 'debug',
  });

  try {
    const apiParams: Record<string, string | number | boolean | undefined> = {
      symbols: normalizedSymbols.join(','),
      timeframe,
    };

    if (start) apiParams.start = start.toISOString();
    if (end) apiParams.end = end.toISOString();
    if (limit) apiParams.limit = limit;

    const response = await makeOptionsDataRequest<{ bars: Record<string, OptionBar[]> }>(
      client,
      '/bars',
      apiParams
    );

    const bars = new Map<string, OptionBar[]>();

    if (response.bars) {
      Object.entries(response.bars).forEach(([symbol, symbolBars]) => {
        bars.set(symbol, symbolBars);
      });
    }

    const totalBars = Array.from(bars.values()).reduce((sum, b) => sum + b.length, 0);
    log(`Retrieved ${totalBars} option bars for ${bars.size} symbols`, {
      type: 'debug',
      metadata: { symbolCount: bars.size, barCount: totalBars },
    });

    return bars;
  } catch (error) {
    if (error instanceof OptionsDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch historical option bars: ${errorMessage}`, { type: 'error' });

    throw new OptionsDataError(
      `Failed to fetch historical option bars: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Calculate implied volatility from option price (simplified approximation)
 * For production use, consider using a proper Black-Scholes solver
 */
export function approximateImpliedVolatility(
  optionPrice: number,
  underlyingPrice: number,
  strike: number,
  daysToExpiration: number,
  riskFreeRate: number = 0.05,
  isCall: boolean = true
): number {
  // Simplified IV approximation using Brenner-Subrahmanyam formula
  // IV ~ (optionPrice / underlyingPrice) * sqrt(2 * pi / T)
  const T = daysToExpiration / 365;

  if (T <= 0) return 0;

  // Intrinsic value
  const intrinsic = isCall
    ? Math.max(0, underlyingPrice - strike)
    : Math.max(0, strike - underlyingPrice);

  // Time value
  const timeValue = optionPrice - intrinsic;

  if (timeValue <= 0) return 0;

  // Simplified approximation
  const iv = (timeValue / underlyingPrice) * Math.sqrt((2 * Math.PI) / T);

  return Math.min(Math.max(iv, 0), 5); // Cap between 0% and 500%
}

/**
 * Calculate option moneyness
 */
export function calculateMoneyness(
  underlyingPrice: number,
  strike: number,
  isCall: boolean
): 'ITM' | 'ATM' | 'OTM' {
  const threshold = 0.02; // 2% threshold for ATM

  const ratio = underlyingPrice / strike;

  if (Math.abs(ratio - 1) <= threshold) {
    return 'ATM';
  }

  if (isCall) {
    return ratio > 1 ? 'ITM' : 'OTM';
  } else {
    return ratio < 1 ? 'ITM' : 'OTM';
  }
}

/**
 * Find ATM (at-the-money) strikes from an options chain
 */
export function findATMStrikes(
  snapshots: Map<string, OptionSnapshot>,
  underlyingPrice: number
): { callSymbol: string | null; putSymbol: string | null; strike: number } {
  let closestStrike = 0;
  let minDiff = Infinity;

  // Parse all symbols to find closest strike
  for (const symbol of snapshots.keys()) {
    const strikeMatch = symbol.match(/(\d{8})$/);
    if (strikeMatch) {
      const strike = parseInt(strikeMatch[1], 10) / 1000;
      const diff = Math.abs(strike - underlyingPrice);
      if (diff < minDiff) {
        minDiff = diff;
        closestStrike = strike;
      }
    }
  }

  // Find call and put at this strike
  let callSymbol: string | null = null;
  let putSymbol: string | null = null;

  for (const symbol of snapshots.keys()) {
    const strikeMatch = symbol.match(/(\d{8})$/);
    if (strikeMatch) {
      const strike = parseInt(strikeMatch[1], 10) / 1000;
      if (Math.abs(strike - closestStrike) < 0.01) {
        if (symbol.includes('C')) {
          callSymbol = symbol;
        } else if (symbol.includes('P')) {
          putSymbol = symbol;
        }
      }
    }
  }

  return { callSymbol, putSymbol, strike: closestStrike };
}

/**
 * Calculate put/call ratio from options chain
 */
export function calculatePutCallRatio(
  snapshots: Map<string, OptionSnapshot>
): { volumeRatio: number; openInterestRatio: number } {
  let callVolume = 0;
  let putVolume = 0;
  let callOI = 0;
  let putOI = 0;

  for (const [symbol, snapshot] of snapshots) {
    const isCall = symbol.includes('C');
    const volume = snapshot.latestTrade?.s || 0;
    const oi = snapshot.openInterest || 0;

    if (isCall) {
      callVolume += volume;
      callOI += oi;
    } else {
      putVolume += volume;
      putOI += oi;
    }
  }

  return {
    volumeRatio: callVolume > 0 ? putVolume / callVolume : 0,
    openInterestRatio: callOI > 0 ? putOI / callOI : 0,
  };
}

/**
 * Get option Greeks from a snapshot
 */
export function extractGreeks(snapshot: OptionSnapshot): OptionGreeks | null {
  if (!snapshot.greeks) {
    return null;
  }

  return {
    delta: snapshot.greeks.delta,
    gamma: snapshot.greeks.gamma,
    theta: snapshot.greeks.theta,
    vega: snapshot.greeks.vega,
    rho: snapshot.greeks.rho,
  };
}

/**
 * Filter options chain by expiration date range
 */
export function filterByExpiration(
  snapshots: Map<string, OptionSnapshot>,
  minDays: number,
  maxDays: number
): Map<string, OptionSnapshot> {
  const now = new Date();
  const filtered = new Map<string, OptionSnapshot>();

  for (const [symbol, snapshot] of snapshots) {
    // Extract expiration date from symbol (format: ROOT + YYMMDD + C/P + Strike)
    const dateMatch = symbol.match(/(\d{6})[CP]/);
    if (dateMatch) {
      const dateStr = dateMatch[1];
      const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
      const month = parseInt(dateStr.substring(2, 4), 10) - 1;
      const day = parseInt(dateStr.substring(4, 6), 10);

      const expDate = new Date(year, month, day);
      const daysToExp = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysToExp >= minDays && daysToExp <= maxDays) {
        filtered.set(symbol, snapshot);
      }
    }
  }

  return filtered;
}

/**
 * Filter options chain by strike price range
 */
export function filterByStrike(
  snapshots: Map<string, OptionSnapshot>,
  minStrike: number,
  maxStrike: number
): Map<string, OptionSnapshot> {
  const filtered = new Map<string, OptionSnapshot>();

  for (const [symbol, snapshot] of snapshots) {
    // Extract strike from symbol (last 8 digits, 3 decimal places)
    const strikeMatch = symbol.match(/(\d{8})$/);
    if (strikeMatch) {
      const strike = parseInt(strikeMatch[1], 10) / 1000;

      if (strike >= minStrike && strike <= maxStrike) {
        filtered.set(symbol, snapshot);
      }
    }
  }

  return filtered;
}

/**
 * Filter options chain by option type
 */
export function filterByType(
  snapshots: Map<string, OptionSnapshot>,
  type: 'call' | 'put'
): Map<string, OptionSnapshot> {
  const filtered = new Map<string, OptionSnapshot>();
  const typeChar = type === 'call' ? 'C' : 'P';

  for (const [symbol, snapshot] of snapshots) {
    if (symbol.includes(typeChar)) {
      filtered.set(symbol, snapshot);
    }
  }

  return filtered;
}

/**
 * Get the bid-ask spread for an option
 */
export function getOptionSpread(quote: OptionQuote): {
  spread: number;
  spreadPercent: number;
  midPrice: number;
} {
  const spread = quote.ap - quote.bp;
  const midPrice = (quote.ap + quote.bp) / 2;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

  return { spread, spreadPercent, midPrice };
}

/**
 * Check if an option has sufficient liquidity
 */
export function hasGoodLiquidity(
  snapshot: OptionSnapshot,
  maxSpreadPercent: number = 10,
  minOpenInterest: number = 100
): boolean {
  // Check open interest
  if ((snapshot.openInterest || 0) < minOpenInterest) {
    return false;
  }

  // Check bid-ask spread
  if (snapshot.latestQuote) {
    const { spreadPercent } = getOptionSpread(snapshot.latestQuote);
    if (spreadPercent > maxSpreadPercent) {
      return false;
    }
  }

  return true;
}

export default {
  getOptionsChain,
  getLatestOptionsQuotes,
  getLatestOptionsTrades,
  getOptionsSnapshots,
  getHistoricalOptionsBars,
  approximateImpliedVolatility,
  calculateMoneyness,
  findATMStrikes,
  calculatePutCallRatio,
  extractGreeks,
  filterByExpiration,
  filterByStrike,
  filterByType,
  getOptionSpread,
  hasGoodLiquidity,
};
