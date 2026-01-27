/**
 * Crypto Market Data Module
 * Real-time and historical cryptocurrency data
 * Crypto data is available 24/7
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  CryptoBar,
  CryptoPair,
  CryptoTimeframe,
  BTCPairs,
  USDTPairs,
  USDCPairs,
  USDPairs,
} from '../../types/alpaca-types';

const LOG_SOURCE = 'CryptoData';

/**
 * Internal logging helper with consistent source
 */
const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: LOG_SOURCE });
};

/**
 * Error thrown when crypto data operations fail
 */
export class CryptoDataError extends Error {
  constructor(
    message: string,
    public code: string,
    public symbol?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CryptoDataError';
  }
}

/**
 * Crypto trade data
 */
export interface CryptoTrade {
  /** Trade price */
  price: number;
  /** Trade size */
  size: number;
  /** Trade timestamp */
  timestamp: Date;
  /** Trade ID */
  id?: number;
  /** Taker side: 'B' for buy, 'S' for sell */
  takerSide?: 'B' | 'S';
}

/**
 * Crypto quote data
 */
export interface CryptoQuote {
  /** Bid price */
  bid: number;
  /** Bid size */
  bidSize: number;
  /** Ask price */
  ask: number;
  /** Ask size */
  askSize: number;
  /** Quote timestamp */
  timestamp: Date;
}

/**
 * Parameters for fetching crypto bars
 */
export interface GetCryptoBarsParams {
  /** Array of crypto symbols (e.g., ['BTC/USD', 'ETH/USD']) */
  symbols: string[];
  /** Timeframe for bars (e.g., '1Min', '1Hour', '1Day') */
  timeframe: string;
  /** Start date/time for data range */
  start?: Date;
  /** End date/time for data range */
  end?: Date;
  /** Maximum number of bars to return per symbol */
  limit?: number;
  /** Sort order */
  sort?: 'asc' | 'desc';
}

/**
 * Crypto snapshot data
 */
export interface CryptoSnapshot {
  /** Symbol */
  symbol: string;
  /** Latest trade */
  latestTrade?: CryptoTrade;
  /** Latest quote */
  latestQuote?: CryptoQuote;
  /** Daily bar */
  dailyBar?: CryptoBar;
  /** Previous daily bar */
  prevDailyBar?: CryptoBar;
  /** Minute bar */
  minuteBar?: CryptoBar;
}

/**
 * Normalize crypto symbol to Alpaca format
 */
function normalizeCryptoSymbol(symbol: string): string {
  if (symbol.includes('/')) {
    return symbol.toUpperCase();
  }

  const upperSymbol = symbol.toUpperCase();
  const quoteCurrencies = ['USD', 'USDT', 'USDC', 'BTC'];

  for (const quote of quoteCurrencies) {
    if (upperSymbol.endsWith(quote)) {
      const base = upperSymbol.slice(0, -quote.length);
      if (base.length > 0) {
        return `${base}/${quote}`;
      }
    }
  }

  return `${upperSymbol}/USD`;
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
 * Get crypto bars (OHLCV data)
 *
 * @param client - AlpacaClient instance
 * @param params - Parameters for fetching bars
 * @returns Map of symbol to array of bars
 *
 * @example
 * const bars = await getCryptoBars(client, {
 *   symbols: ['BTC/USD', 'ETH/USD'],
 *   timeframe: '1Hour',
 *   start: new Date('2024-01-01'),
 *   limit: 100,
 * });
 */
export async function getCryptoBars(
  client: AlpacaClient,
  params: GetCryptoBarsParams
): Promise<Map<string, CryptoBar[]>> {
  const { symbols, timeframe, start, end, limit, sort } = params;

  if (!symbols || symbols.length === 0) {
    throw new CryptoDataError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map(normalizeCryptoSymbol);

  log(`Fetching crypto bars for ${normalizedSymbols.length} symbols with timeframe ${timeframe}`, {
    type: 'debug',
  });

  try {
    const sdk = client.getSDK();

    const options: Record<string, unknown> = {
      timeframe,
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
    if (sort) {
      options.sort = sort;
    }

    const result = new Map<string, CryptoBar[]>();

    // Initialize empty arrays for each symbol
    for (const symbol of normalizedSymbols) {
      result.set(symbol, []);
    }

    // Use SDK's getCryptoBars method
    // The SDK returns an async iterator, but TypeScript may not recognize it properly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const barsResponse = sdk.getCryptoBars(normalizedSymbols, options) as any;

    // Handle both async iterator and direct response formats
    if (barsResponse && typeof barsResponse[Symbol.asyncIterator] === 'function') {
      for await (const bar of barsResponse) {
        const symbol = bar.Symbol;
        const existingBars = result.get(symbol) || [];

        existingBars.push({
          t: new Date(bar.Timestamp),
          o: bar.Open,
          h: bar.High,
          l: bar.Low,
          c: bar.Close,
          v: bar.Volume,
          n: bar.TradeCount || 0,
          vw: bar.VWAP || 0,
        });

        result.set(symbol, existingBars);
      }
    } else if (barsResponse && barsResponse.then) {
      // Handle Promise response
      const response = await barsResponse;
      if (response && response.bars) {
        for (const [symbol, bars] of Object.entries(response.bars)) {
          const barArray = bars as Array<{
            Timestamp: string;
            Open: number;
            High: number;
            Low: number;
            Close: number;
            Volume: number;
            TradeCount?: number;
            VWAP?: number;
          }>;

          result.set(
            symbol,
            barArray.map((bar) => ({
              t: new Date(bar.Timestamp),
              o: bar.Open,
              h: bar.High,
              l: bar.Low,
              c: bar.Close,
              v: bar.Volume,
              n: bar.TradeCount || 0,
              vw: bar.VWAP || 0,
            }))
          );
        }
      }
    }

    const totalBars = Array.from(result.values()).reduce((sum, bars) => sum + bars.length, 0);
    log(`Successfully fetched ${totalBars} crypto bars for ${normalizedSymbols.length} symbols`, {
      type: 'debug',
    });

    return result;
  } catch (error) {
    if (error instanceof CryptoDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch crypto bars: ${errorMessage}`, { type: 'error' });

    throw new CryptoDataError(
      `Failed to fetch crypto bars: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get latest crypto trades
 *
 * @param client - AlpacaClient instance
 * @param symbols - Array of crypto symbols
 * @returns Map of symbol to latest trade data
 *
 * @example
 * const trades = await getLatestCryptoTrades(client, ['BTC/USD', 'ETH/USD']);
 * const btcTrade = trades.get('BTC/USD');
 * console.log(`BTC last trade: $${btcTrade?.price}`);
 */
export async function getLatestCryptoTrades(
  client: AlpacaClient,
  symbols: string[]
): Promise<Map<string, CryptoTrade>> {
  if (!symbols || symbols.length === 0) {
    throw new CryptoDataError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map(normalizeCryptoSymbol);

  log(`Fetching latest crypto trades for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  try {
    const sdk = client.getSDK();

    const response = await sdk.getLatestCryptoTrades(normalizedSymbols);

    const result = new Map<string, CryptoTrade>();

    for (const [symbol, trade] of Object.entries(response)) {
      const t = trade as {
        Price: number;
        Size: number;
        Timestamp: string;
        ID?: number;
        TakerSide?: 'B' | 'S';
      };

      result.set(symbol, {
        price: t.Price,
        size: t.Size,
        timestamp: new Date(t.Timestamp),
        id: t.ID,
        takerSide: t.TakerSide,
      });
    }

    log(`Successfully fetched latest trades for ${result.size} crypto symbols`, { type: 'debug' });

    return result;
  } catch (error) {
    if (error instanceof CryptoDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch latest crypto trades: ${errorMessage}`, { type: 'error' });

    throw new CryptoDataError(
      `Failed to fetch latest crypto trades: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get latest crypto quotes
 *
 * @param client - AlpacaClient instance
 * @param symbols - Array of crypto symbols
 * @returns Map of symbol to latest quote data
 *
 * @example
 * const quotes = await getLatestCryptoQuotes(client, ['BTC/USD']);
 * const btcQuote = quotes.get('BTC/USD');
 * console.log(`BTC bid/ask: $${btcQuote?.bid}/$${btcQuote?.ask}`);
 */
export async function getLatestCryptoQuotes(
  client: AlpacaClient,
  symbols: string[]
): Promise<Map<string, CryptoQuote>> {
  if (!symbols || symbols.length === 0) {
    throw new CryptoDataError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map(normalizeCryptoSymbol);

  log(`Fetching latest crypto quotes for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  try {
    const sdk = client.getSDK();

    const response = await sdk.getLatestCryptoQuotes(normalizedSymbols);

    const result = new Map<string, CryptoQuote>();

    for (const [symbol, quote] of Object.entries(response)) {
      const q = quote as {
        BidPrice: number;
        BidSize: number;
        AskPrice: number;
        AskSize: number;
        Timestamp: string;
      };

      result.set(symbol, {
        bid: q.BidPrice,
        bidSize: q.BidSize,
        ask: q.AskPrice,
        askSize: q.AskSize,
        timestamp: new Date(q.Timestamp),
      });
    }

    log(`Successfully fetched latest quotes for ${result.size} crypto symbols`, { type: 'debug' });

    return result;
  } catch (error) {
    if (error instanceof CryptoDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch latest crypto quotes: ${errorMessage}`, { type: 'error' });

    throw new CryptoDataError(
      `Failed to fetch latest crypto quotes: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get the current price for a crypto symbol
 * Uses the latest trade price
 *
 * @param client - AlpacaClient instance
 * @param symbol - Crypto symbol (e.g., 'BTC/USD')
 * @returns Current price
 *
 * @example
 * const btcPrice = await getCryptoPrice(client, 'BTC/USD');
 * console.log(`Bitcoin is currently $${btcPrice.toFixed(2)}`);
 */
export async function getCryptoPrice(
  client: AlpacaClient,
  symbol: string
): Promise<number> {
  const normalizedSymbol = normalizeCryptoSymbol(symbol);

  log(`Fetching price for ${normalizedSymbol}`, { type: 'debug', symbol: normalizedSymbol });

  const trades = await getLatestCryptoTrades(client, [normalizedSymbol]);
  const trade = trades.get(normalizedSymbol);

  if (!trade) {
    throw new CryptoDataError(
      `No price data available for ${normalizedSymbol}`,
      'NO_DATA',
      normalizedSymbol
    );
  }

  return trade.price;
}

/**
 * Get the bid-ask spread for a crypto symbol
 *
 * @param client - AlpacaClient instance
 * @param symbol - Crypto symbol (e.g., 'BTC/USD')
 * @returns Object with bid, ask, spread, and spreadPercent
 *
 * @example
 * const spread = await getCryptoSpread(client, 'BTC/USD');
 * console.log(`BTC spread: $${spread.spread.toFixed(2)} (${spread.spreadPercent.toFixed(4)}%)`);
 */
export async function getCryptoSpread(
  client: AlpacaClient,
  symbol: string
): Promise<{ bid: number; ask: number; spread: number; spreadPercent: number }> {
  const normalizedSymbol = normalizeCryptoSymbol(symbol);

  log(`Fetching spread for ${normalizedSymbol}`, { type: 'debug', symbol: normalizedSymbol });

  const quotes = await getLatestCryptoQuotes(client, [normalizedSymbol]);
  const quote = quotes.get(normalizedSymbol);

  if (!quote) {
    throw new CryptoDataError(
      `No quote data available for ${normalizedSymbol}`,
      'NO_DATA',
      normalizedSymbol
    );
  }

  const spread = quote.ask - quote.bid;
  const midPrice = (quote.ask + quote.bid) / 2;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

  return {
    bid: quote.bid,
    ask: quote.ask,
    spread,
    spreadPercent,
  };
}

/**
 * Get crypto snapshots with latest trade, quote, and bar data
 *
 * @param client - AlpacaClient instance
 * @param symbols - Array of crypto symbols
 * @returns Map of symbol to snapshot data
 *
 * @example
 * const snapshots = await getCryptoSnapshots(client, ['BTC/USD', 'ETH/USD']);
 */
export async function getCryptoSnapshots(
  client: AlpacaClient,
  symbols: string[]
): Promise<Map<string, CryptoSnapshot>> {
  if (!symbols || symbols.length === 0) {
    throw new CryptoDataError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map(normalizeCryptoSymbol);

  log(`Fetching crypto snapshots for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  try {
    const sdk = client.getSDK();

    const response = await sdk.getCryptoSnapshots(normalizedSymbols);

    const result = new Map<string, CryptoSnapshot>();

    for (const [symbol, snapshot] of Object.entries(response)) {
      const s = snapshot as {
        latestTrade?: {
          Price: number;
          Size: number;
          Timestamp: string;
          ID?: number;
          TakerSide?: 'B' | 'S';
        };
        latestQuote?: {
          BidPrice: number;
          BidSize: number;
          AskPrice: number;
          AskSize: number;
          Timestamp: string;
        };
        dailyBar?: {
          Timestamp: string;
          Open: number;
          High: number;
          Low: number;
          Close: number;
          Volume: number;
          TradeCount?: number;
          VWAP?: number;
        };
        prevDailyBar?: {
          Timestamp: string;
          Open: number;
          High: number;
          Low: number;
          Close: number;
          Volume: number;
          TradeCount?: number;
          VWAP?: number;
        };
        minuteBar?: {
          Timestamp: string;
          Open: number;
          High: number;
          Low: number;
          Close: number;
          Volume: number;
          TradeCount?: number;
          VWAP?: number;
        };
      };

      const cryptoSnapshot: CryptoSnapshot = {
        symbol,
      };

      if (s.latestTrade) {
        cryptoSnapshot.latestTrade = {
          price: s.latestTrade.Price,
          size: s.latestTrade.Size,
          timestamp: new Date(s.latestTrade.Timestamp),
          id: s.latestTrade.ID,
          takerSide: s.latestTrade.TakerSide,
        };
      }

      if (s.latestQuote) {
        cryptoSnapshot.latestQuote = {
          bid: s.latestQuote.BidPrice,
          bidSize: s.latestQuote.BidSize,
          ask: s.latestQuote.AskPrice,
          askSize: s.latestQuote.AskSize,
          timestamp: new Date(s.latestQuote.Timestamp),
        };
      }

      if (s.dailyBar) {
        cryptoSnapshot.dailyBar = {
          t: new Date(s.dailyBar.Timestamp),
          o: s.dailyBar.Open,
          h: s.dailyBar.High,
          l: s.dailyBar.Low,
          c: s.dailyBar.Close,
          v: s.dailyBar.Volume,
          n: s.dailyBar.TradeCount || 0,
          vw: s.dailyBar.VWAP || 0,
        };
      }

      if (s.prevDailyBar) {
        cryptoSnapshot.prevDailyBar = {
          t: new Date(s.prevDailyBar.Timestamp),
          o: s.prevDailyBar.Open,
          h: s.prevDailyBar.High,
          l: s.prevDailyBar.Low,
          c: s.prevDailyBar.Close,
          v: s.prevDailyBar.Volume,
          n: s.prevDailyBar.TradeCount || 0,
          vw: s.prevDailyBar.VWAP || 0,
        };
      }

      if (s.minuteBar) {
        cryptoSnapshot.minuteBar = {
          t: new Date(s.minuteBar.Timestamp),
          o: s.minuteBar.Open,
          h: s.minuteBar.High,
          l: s.minuteBar.Low,
          c: s.minuteBar.Close,
          v: s.minuteBar.Volume,
          n: s.minuteBar.TradeCount || 0,
          vw: s.minuteBar.VWAP || 0,
        };
      }

      result.set(symbol, cryptoSnapshot);
    }

    log(`Successfully fetched snapshots for ${result.size} crypto symbols`, { type: 'debug' });

    return result;
  } catch (error) {
    if (error instanceof CryptoDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch crypto snapshots: ${errorMessage}`, { type: 'error' });

    throw new CryptoDataError(
      `Failed to fetch crypto snapshots: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get historical crypto trades
 *
 * @param client - AlpacaClient instance
 * @param symbol - Crypto symbol
 * @param start - Start date/time
 * @param end - Optional end date/time
 * @param limit - Maximum number of trades
 * @returns Array of trades
 *
 * @example
 * const trades = await getCryptoTrades(client, 'BTC/USD', new Date('2024-01-01'), undefined, 100);
 */
export async function getCryptoTrades(
  client: AlpacaClient,
  symbol: string,
  start: Date,
  end?: Date,
  limit?: number
): Promise<CryptoTrade[]> {
  const normalizedSymbol = normalizeCryptoSymbol(symbol);

  log(`Fetching crypto trades for ${normalizedSymbol}`, { type: 'debug', symbol: normalizedSymbol });

  try {
    const sdk = client.getSDK();

    const options: Record<string, unknown> = {
      start: toRFC3339(start),
    };

    if (end) {
      options.end = toRFC3339(end);
    }

    if (limit) {
      options.limit = limit;
    }

    const trades: CryptoTrade[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tradesResponse = sdk.getCryptoTrades(normalizedSymbol, options) as any;

    // Handle both async iterator and direct response formats
    if (tradesResponse && typeof tradesResponse[Symbol.asyncIterator] === 'function') {
      for await (const trade of tradesResponse) {
        trades.push({
          price: trade.Price,
          size: trade.Size,
          timestamp: new Date(trade.Timestamp),
          id: trade.ID,
          takerSide: trade.TakerSide,
        });

        // Respect limit
        if (limit && trades.length >= limit) {
          break;
        }
      }
    } else if (tradesResponse && tradesResponse.then) {
      // Handle Promise response
      const response = await tradesResponse;
      if (response && response.trades) {
        const tradeArray = response.trades as Array<{
          Price: number;
          Size: number;
          Timestamp: string;
          ID?: number;
          TakerSide?: 'B' | 'S';
        }>;

        for (const trade of tradeArray) {
          trades.push({
            price: trade.Price,
            size: trade.Size,
            timestamp: new Date(trade.Timestamp),
            id: trade.ID,
            takerSide: trade.TakerSide,
          });

          // Respect limit
          if (limit && trades.length >= limit) {
            break;
          }
        }
      }
    }

    log(`Successfully fetched ${trades.length} crypto trades for ${normalizedSymbol}`, {
      type: 'debug',
      symbol: normalizedSymbol,
    });

    return trades;
  } catch (error) {
    if (error instanceof CryptoDataError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch crypto trades: ${errorMessage}`, { type: 'error' });

    throw new CryptoDataError(
      `Failed to fetch crypto trades: ${errorMessage}`,
      'FETCH_ERROR',
      normalizedSymbol,
      error
    );
  }
}

/**
 * Get daily prices for a crypto symbol
 *
 * @param client - AlpacaClient instance
 * @param symbol - Crypto symbol
 * @param days - Number of days of history
 * @returns Array of daily bars
 *
 * @example
 * const dailyBars = await getCryptoDailyPrices(client, 'BTC/USD', 30);
 */
export async function getCryptoDailyPrices(
  client: AlpacaClient,
  symbol: string,
  days: number
): Promise<CryptoBar[]> {
  const normalizedSymbol = normalizeCryptoSymbol(symbol);

  if (days <= 0) {
    throw new CryptoDataError('Days must be a positive number', 'INVALID_DAYS', normalizedSymbol);
  }

  log(`Fetching ${days} days of daily prices for ${normalizedSymbol}`, {
    type: 'debug',
    symbol: normalizedSymbol,
  });

  // Calculate start date with buffer
  const start = new Date();
  start.setDate(start.getDate() - Math.ceil(days * 1.5));

  const result = await getCryptoBars(client, {
    symbols: [normalizedSymbol],
    timeframe: '1Day',
    start,
    limit: days,
  });

  const bars = result.get(normalizedSymbol) || [];

  // Return only the requested number of days (most recent)
  if (bars.length > days) {
    return bars.slice(-days);
  }

  return bars;
}

/**
 * Calculate 24-hour price change for a crypto symbol
 *
 * @param client - AlpacaClient instance
 * @param symbol - Crypto symbol
 * @returns Object with current price, previous price, change, and change percent
 *
 * @example
 * const change = await getCrypto24HourChange(client, 'BTC/USD');
 * console.log(`BTC 24h change: ${change.changePercent.toFixed(2)}%`);
 */
export async function getCrypto24HourChange(
  client: AlpacaClient,
  symbol: string
): Promise<{
  currentPrice: number;
  previousPrice: number;
  change: number;
  changePercent: number;
}> {
  const normalizedSymbol = normalizeCryptoSymbol(symbol);

  log(`Calculating 24h change for ${normalizedSymbol}`, {
    type: 'debug',
    symbol: normalizedSymbol,
  });

  const snapshots = await getCryptoSnapshots(client, [normalizedSymbol]);
  const snapshot = snapshots.get(normalizedSymbol);

  if (!snapshot?.latestTrade) {
    throw new CryptoDataError(
      `No price data available for ${normalizedSymbol}`,
      'NO_DATA',
      normalizedSymbol
    );
  }

  const currentPrice = snapshot.latestTrade.price;
  let previousPrice = currentPrice;

  // Use previous daily bar close if available
  if (snapshot.prevDailyBar) {
    previousPrice = snapshot.prevDailyBar.c;
  } else if (snapshot.dailyBar) {
    previousPrice = snapshot.dailyBar.o; // Use daily open as fallback
  }

  const change = currentPrice - previousPrice;
  const changePercent = previousPrice !== 0 ? (change / previousPrice) * 100 : 0;

  return {
    currentPrice,
    previousPrice,
    change,
    changePercent,
  };
}

// ============================================================================
// Supported Crypto Pairs
// ============================================================================

/**
 * All supported BTC trading pairs
 */
export const BTC_PAIRS: BTCPairs[] = ['BCH/BTC', 'ETH/BTC', 'LTC/BTC', 'UNI/BTC'];

/**
 * All supported USDT trading pairs
 */
export const USDT_PAIRS: USDTPairs[] = [
  'AAVE/USDT',
  'BCH/USDT',
  'BTC/USDT',
  'DOGE/USDT',
  'ETH/USDT',
  'LINK/USDT',
  'LTC/USDT',
  'SUSHI/USDT',
  'UNI/USDT',
  'YFI/USDT',
];

/**
 * All supported USDC trading pairs
 */
export const USDC_PAIRS: USDCPairs[] = [
  'AAVE/USDC',
  'AVAX/USDC',
  'BAT/USDC',
  'BCH/USDC',
  'BTC/USDC',
  'CRV/USDC',
  'DOGE/USDC',
  'DOT/USDC',
  'ETH/USDC',
  'GRT/USDC',
  'LINK/USDC',
  'LTC/USDC',
  'MKR/USDC',
  'SHIB/USDC',
  'SUSHI/USDC',
  'UNI/USDC',
  'XTZ/USDC',
  'YFI/USDC',
];

/**
 * All supported USD trading pairs
 */
export const USD_PAIRS: USDPairs[] = [
  'AAVE/USD',
  'AVAX/USD',
  'BAT/USD',
  'BCH/USD',
  'BTC/USD',
  'CRV/USD',
  'DOGE/USD',
  'DOT/USD',
  'ETH/USD',
  'GRT/USD',
  'LINK/USD',
  'LTC/USD',
  'MKR/USD',
  'SHIB/USD',
  'SUSHI/USD',
  'UNI/USD',
  'USDC/USD',
  'USDT/USD',
  'XTZ/USD',
  'YFI/USD',
];

/**
 * Get all supported crypto pairs
 *
 * @returns Array of all supported crypto trading pairs
 *
 * @example
 * const pairs = getSupportedCryptoPairs();
 * console.log(`${pairs.length} crypto pairs available`);
 */
export function getSupportedCryptoPairs(): CryptoPair[] {
  return [...BTC_PAIRS, ...USDT_PAIRS, ...USDC_PAIRS, ...USD_PAIRS];
}

/**
 * Get supported crypto pairs by quote currency
 *
 * @param quoteCurrency - Quote currency ('USD', 'USDC', 'USDT', 'BTC')
 * @returns Array of supported pairs for that quote currency
 *
 * @example
 * const usdPairs = getCryptoPairsByQuote('USD');
 */
export function getCryptoPairsByQuote(
  quoteCurrency: 'USD' | 'USDC' | 'USDT' | 'BTC'
): CryptoPair[] {
  switch (quoteCurrency) {
    case 'USD':
      return USD_PAIRS;
    case 'USDC':
      return USDC_PAIRS;
    case 'USDT':
      return USDT_PAIRS;
    case 'BTC':
      return BTC_PAIRS;
    default:
      return [];
  }
}

/**
 * Check if a crypto pair is supported
 *
 * @param symbol - Crypto pair to check
 * @returns true if the pair is supported
 *
 * @example
 * if (isSupportedCryptoPair('BTC/USD')) {
 *   // Trade BTC
 * }
 */
export function isSupportedCryptoPair(symbol: string): boolean {
  const normalized = normalizeCryptoSymbol(symbol);
  const allPairs = getSupportedCryptoPairs();
  return allPairs.includes(normalized as CryptoPair);
}

/**
 * Get popular crypto pairs (most commonly traded)
 *
 * @returns Array of popular crypto trading pairs
 */
export function getPopularCryptoPairs(): CryptoPair[] {
  return [
    'BTC/USD',
    'ETH/USD',
    'DOGE/USD',
    'LINK/USD',
    'AVAX/USD',
    'SHIB/USD',
    'LTC/USD',
    'UNI/USD',
  ];
}

export default {
  getCryptoBars,
  getLatestCryptoTrades,
  getLatestCryptoQuotes,
  getCryptoPrice,
  getCryptoSpread,
  getCryptoSnapshots,
  getCryptoTrades,
  getCryptoDailyPrices,
  getCrypto24HourChange,
  getSupportedCryptoPairs,
  getCryptoPairsByQuote,
  isSupportedCryptoPair,
  getPopularCryptoPairs,
  BTC_PAIRS,
  USDT_PAIRS,
  USDC_PAIRS,
  USD_PAIRS,
};
