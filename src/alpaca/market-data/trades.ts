/**
 * Trades Module
 * Real-time and historical trade data using Alpaca SDK
 */
import { AlpacaClient } from '../client';
import { AlpacaTrade, LatestTradesResponse, DataFeed } from '../../types/alpaca-types';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'AlpacaTrades' });
};

/**
 * Error thrown when trade operations fail
 */
export class TradeError extends Error {
  constructor(
    message: string,
    public code: string,
    public symbol?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'TradeError';
  }
}

/**
 * Parameters for fetching historical trades
 */
export interface GetHistoricalTradesParams {
  /** Stock symbol */
  symbol: string;
  /** Start date/time for the data range */
  start: Date;
  /** End date/time for the data range (defaults to now) */
  end?: Date;
  /** Maximum number of trades to return */
  limit?: number;
  /** Data feed (sip for premium, iex for free tier) */
  feed?: DataFeed;
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
 * Get latest trade for a single symbol
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol to get trade for
 * @param feed - Optional data feed (sip, iex, delayed_sip)
 * @returns Latest trade for the symbol
 * @throws TradeError if the request fails
 */
export async function getLatestTrade(
  client: AlpacaClient,
  symbol: string,
  feed?: DataFeed
): Promise<AlpacaTrade> {
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!normalizedSymbol) {
    throw new TradeError('Symbol is required', 'INVALID_SYMBOL');
  }

  log(`Fetching latest trade for ${normalizedSymbol}`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const config = client.getConfig();
    const dataFeed = feed || config.dataFeed || 'iex';

    // Use SDK's getLatestTrade method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await sdk.getLatestTrade(normalizedSymbol, { feed: dataFeed } as any);

    if (!response) {
      throw new TradeError(
        `No trade data returned for ${normalizedSymbol}`,
        'NO_DATA',
        normalizedSymbol
      );
    }

    log(`Successfully fetched trade for ${normalizedSymbol}: price=${response.Price}, size=${response.Size}`, { type: 'debug' });

    // Map SDK response to our AlpacaTrade type
    return {
      t: response.Timestamp,
      p: response.Price,
      s: response.Size,
      x: response.Exchange,
      i: response.ID,
      z: response.Tape || '',
      c: response.Conditions || [],
    };
  } catch (error) {
    if (error instanceof TradeError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch trade for ${normalizedSymbol}: ${errorMessage}`, { type: 'error' });

    throw new TradeError(
      `Failed to fetch trade for ${normalizedSymbol}: ${errorMessage}`,
      'FETCH_ERROR',
      normalizedSymbol,
      error
    );
  }
}

/**
 * Get latest trades for multiple symbols
 * @param client - AlpacaClient instance
 * @param symbols - Array of stock symbols
 * @param feed - Optional data feed (sip, iex, delayed_sip)
 * @returns Object containing trades for all requested symbols
 * @throws TradeError if the request fails
 */
export async function getLatestTrades(
  client: AlpacaClient,
  symbols: string[],
  feed?: DataFeed
): Promise<LatestTradesResponse> {
  if (!symbols || symbols.length === 0) {
    throw new TradeError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  if (normalizedSymbols.length === 0) {
    throw new TradeError('No valid symbols provided', 'INVALID_SYMBOLS');
  }

  log(`Fetching latest trades for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const config = client.getConfig();
    const dataFeed = feed || config.dataFeed || 'iex';

    // Use SDK's getLatestTrades method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await sdk.getLatestTrades(normalizedSymbols, { feed: dataFeed } as any);

    if (!response) {
      throw new TradeError(
        'No trade data returned',
        'NO_DATA'
      );
    }

    // Map SDK response to our LatestTradesResponse type
    const trades: { [symbol: string]: AlpacaTrade } = {};

    for (const [symbol, trade] of Object.entries(response)) {
      const t = trade as {
        Timestamp: string;
        Price: number;
        Size: number;
        Exchange: string;
        ID: number;
        Tape?: string;
        Conditions?: string[];
      };

      trades[symbol] = {
        t: t.Timestamp,
        p: t.Price,
        s: t.Size,
        x: t.Exchange,
        i: t.ID,
        z: t.Tape || '',
        c: t.Conditions || [],
      };
    }

    log(`Successfully fetched trades for ${Object.keys(trades).length} symbols`, { type: 'debug' });

    return {
      trades,
      currency: 'USD',
    };
  } catch (error) {
    if (error instanceof TradeError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch trades: ${errorMessage}`, { type: 'error' });

    throw new TradeError(
      `Failed to fetch trades: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get historical trades with automatic pagination
 * @param client - AlpacaClient instance
 * @param params - Parameters for fetching historical trades
 * @returns Array of trades for the symbol
 * @throws TradeError if the request fails
 */
export async function getHistoricalTrades(
  client: AlpacaClient,
  params: GetHistoricalTradesParams
): Promise<AlpacaTrade[]> {
  const { symbol, start, end, limit, feed } = params;
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!normalizedSymbol) {
    throw new TradeError('Symbol is required', 'INVALID_SYMBOL');
  }

  log(`Fetching historical trades for ${normalizedSymbol}`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const config = client.getConfig();
    const dataFeed = feed || config.dataFeed || 'iex';

    const options: {
      start: string;
      end?: string;
      limit?: number;
      feed: string;
    } = {
      start: toRFC3339(start),
      feed: dataFeed,
    };

    if (end) {
      options.end = toRFC3339(end);
    }
    if (limit) {
      options.limit = limit;
    }

    const trades: AlpacaTrade[] = [];

    // Use SDK's getTradesV2 method with pagination (async iterator)
    const tradesIterator = sdk.getTradesV2(normalizedSymbol, options);

    for await (const trade of tradesIterator) {
      trades.push({
        t: trade.Timestamp,
        p: trade.Price,
        s: trade.Size,
        x: trade.Exchange,
        i: trade.ID,
        z: trade.Tape || '',
        c: trade.Conditions || [],
      });

      // Respect limit if specified
      if (limit && trades.length >= limit) {
        break;
      }
    }

    log(`Successfully fetched ${trades.length} historical trades for ${normalizedSymbol}`, { type: 'debug' });

    return trades;
  } catch (error) {
    if (error instanceof TradeError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch historical trades for ${normalizedSymbol}: ${errorMessage}`, { type: 'error' });

    throw new TradeError(
      `Failed to fetch historical trades: ${errorMessage}`,
      'FETCH_ERROR',
      normalizedSymbol,
      error
    );
  }
}

/**
 * Get current price for a symbol
 * Uses mid-point of latest quote if available, otherwise falls back to last trade price
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param feed - Optional data feed (sip, iex, delayed_sip)
 * @returns Current price for the symbol
 * @throws TradeError if unable to get price
 */
export async function getCurrentPrice(
  client: AlpacaClient,
  symbol: string,
  feed?: DataFeed
): Promise<number> {
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!normalizedSymbol) {
    throw new TradeError('Symbol is required', 'INVALID_SYMBOL');
  }

  log(`Fetching current price for ${normalizedSymbol}`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const config = client.getConfig();
    const dataFeed = feed || config.dataFeed || 'iex';

    // Try to get quote first for mid-point price
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const quote = await sdk.getLatestQuote(normalizedSymbol, { feed: dataFeed } as any);

      if (quote && quote.BidPrice > 0 && quote.AskPrice > 0) {
        const midPrice = (quote.BidPrice + quote.AskPrice) / 2;
        log(`Current price for ${normalizedSymbol} (mid-point): ${midPrice}`, { type: 'debug' });
        return midPrice;
      }
    } catch (quoteError) {
      log(`Could not get quote for ${normalizedSymbol}, falling back to trade: ${(quoteError as Error).message}`, { type: 'debug' });
    }

    // Fall back to last trade price
    const trade = await getLatestTrade(client, normalizedSymbol, feed);

    if (!trade || trade.p <= 0) {
      throw new TradeError(
        `No valid price available for ${normalizedSymbol}`,
        'NO_PRICE',
        normalizedSymbol
      );
    }

    log(`Current price for ${normalizedSymbol} (last trade): ${trade.p}`, { type: 'debug' });
    return trade.p;
  } catch (error) {
    if (error instanceof TradeError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get current price for ${normalizedSymbol}: ${errorMessage}`, { type: 'error' });

    throw new TradeError(
      `Failed to get current price for ${normalizedSymbol}: ${errorMessage}`,
      'FETCH_ERROR',
      normalizedSymbol,
      error
    );
  }
}

/**
 * Get current prices for multiple symbols
 * Uses mid-point of latest quote if available, otherwise falls back to last trade price
 * @param client - AlpacaClient instance
 * @param symbols - Array of stock symbols
 * @param feed - Optional data feed (sip, iex, delayed_sip)
 * @returns Map of symbol to current price
 */
export async function getCurrentPrices(
  client: AlpacaClient,
  symbols: string[],
  feed?: DataFeed
): Promise<Map<string, number>> {
  if (!symbols || symbols.length === 0) {
    throw new TradeError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  if (normalizedSymbols.length === 0) {
    throw new TradeError('No valid symbols provided', 'INVALID_SYMBOLS');
  }

  log(`Fetching current prices for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  const prices = new Map<string, number>();

  try {
    const sdk = client.getSDK();
    const config = client.getConfig();
    const dataFeed = feed || config.dataFeed || 'iex';

    // First try to get quotes for mid-point prices
    const symbolsNeedingTrades: string[] = [];

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const quotes = await sdk.getLatestQuotes(normalizedSymbols, { feed: dataFeed } as any);

      for (const symbol of normalizedSymbols) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawQuote = (quotes as any).get ? (quotes as any).get(symbol) : (quotes as any)[symbol];
        const quote = rawQuote as {
          BidPrice: number;
          AskPrice: number;
        } | undefined;

        if (quote && quote.BidPrice > 0 && quote.AskPrice > 0) {
          const midPrice = (quote.BidPrice + quote.AskPrice) / 2;
          prices.set(symbol, midPrice);
        } else {
          symbolsNeedingTrades.push(symbol);
        }
      }
    } catch (quoteError) {
      log(`Could not get quotes, falling back to trades: ${(quoteError as Error).message}`, { type: 'debug' });
      symbolsNeedingTrades.push(...normalizedSymbols.filter((s) => !prices.has(s)));
    }

    // Fall back to trades for symbols without valid quotes
    if (symbolsNeedingTrades.length > 0) {
      try {
        const tradesResponse = await getLatestTrades(client, symbolsNeedingTrades, feed);

        for (const [symbol, trade] of Object.entries(tradesResponse.trades)) {
          if (trade && trade.p > 0) {
            prices.set(symbol, trade.p);
          }
        }
      } catch (tradeError) {
        log(`Failed to get trades for some symbols: ${(tradeError as Error).message}`, { type: 'warn' });
      }
    }

    log(`Successfully fetched prices for ${prices.size} of ${normalizedSymbols.length} symbols`, { type: 'debug' });

    return prices;
  } catch (error) {
    if (error instanceof TradeError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get current prices: ${errorMessage}`, { type: 'error' });

    throw new TradeError(
      `Failed to get current prices: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get trade volume summary for a symbol over a time period
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param start - Start date/time
 * @param end - End date/time (defaults to now)
 * @returns Total volume and trade count for the period
 */
export async function getTradeVolume(
  client: AlpacaClient,
  symbol: string,
  start: Date,
  end?: Date
): Promise<{ totalVolume: number; tradeCount: number; avgTradeSize: number }> {
  const trades = await getHistoricalTrades(client, {
    symbol,
    start,
    end: end || new Date(),
  });

  if (trades.length === 0) {
    return {
      totalVolume: 0,
      tradeCount: 0,
      avgTradeSize: 0,
    };
  }

  const totalVolume = trades.reduce((sum, trade) => sum + trade.s, 0);
  const tradeCount = trades.length;
  const avgTradeSize = totalVolume / tradeCount;

  log(`Trade volume for ${symbol}: ${totalVolume} shares across ${tradeCount} trades`, { type: 'debug' });

  return {
    totalVolume,
    tradeCount,
    avgTradeSize,
  };
}

export default {
  getLatestTrade,
  getLatestTrades,
  getHistoricalTrades,
  getCurrentPrice,
  getCurrentPrices,
  getTradeVolume,
};
