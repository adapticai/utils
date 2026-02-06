/**
 * Quotes Module
 * Real-time and snapshot quote data using Alpaca SDK
 */
import { AlpacaClient } from '../client';
import { AlpacaQuote, LatestQuotesResponse, DataFeed, SDKMarketDataOptions } from '../../types/alpaca-types';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'AlpacaQuotes' });
};

/**
 * Error thrown when quote operations fail
 */
export class QuoteError extends Error {
  constructor(
    message: string,
    public code: string,
    public symbol?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'QuoteError';
  }
}

/**
 * Spread information for a symbol
 */
export interface SpreadInfo {
  /** Bid price */
  bid: number;
  /** Ask price */
  ask: number;
  /** Absolute spread (ask - bid) */
  spread: number;
  /** Spread as percentage of mid price */
  spreadPercent: number;
  /** Mid price ((bid + ask) / 2) */
  midPrice: number;
  /** Bid size */
  bidSize: number;
  /** Ask size */
  askSize: number;
}

/**
 * Get latest quote for a single symbol
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol to get quote for
 * @param feed - Optional data feed (sip, iex, delayed_sip)
 * @returns Latest quote for the symbol
 * @throws QuoteError if the request fails
 */
export async function getLatestQuote(
  client: AlpacaClient,
  symbol: string,
  feed?: DataFeed
): Promise<AlpacaQuote> {
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!normalizedSymbol) {
    throw new QuoteError('Symbol is required', 'INVALID_SYMBOL');
  }

  log(`Fetching latest quote for ${normalizedSymbol}`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const config = client.getConfig();
    const dataFeed = feed || config.dataFeed || 'iex';

    // Use SDK's getLatestQuote method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await sdk.getLatestQuote(normalizedSymbol, { feed: dataFeed } as SDKMarketDataOptions);

    if (!response) {
      throw new QuoteError(
        `No quote data returned for ${normalizedSymbol}`,
        'NO_DATA',
        normalizedSymbol
      );
    }

    log(`Successfully fetched quote for ${normalizedSymbol}: bid=${response.BidPrice}, ask=${response.AskPrice}`, { type: 'debug' });

    // Map SDK response to our AlpacaQuote type
    return {
      t: response.Timestamp,
      ap: response.AskPrice,
      as: response.AskSize,
      ax: response.AskExchange,
      bp: response.BidPrice,
      bs: response.BidSize,
      bx: response.BidExchange,
      c: response.Conditions || [],
      z: response.Tape || '',
    };
  } catch (error) {
    if (error instanceof QuoteError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch quote for ${normalizedSymbol}: ${errorMessage}`, { type: 'error' });

    throw new QuoteError(
      `Failed to fetch quote for ${normalizedSymbol}: ${errorMessage}`,
      'FETCH_ERROR',
      normalizedSymbol,
      error
    );
  }
}

/**
 * Get latest quotes for multiple symbols
 * @param client - AlpacaClient instance
 * @param symbols - Array of stock symbols
 * @param feed - Optional data feed (sip, iex, delayed_sip)
 * @returns Object containing quotes for all requested symbols
 * @throws QuoteError if the request fails
 */
export async function getLatestQuotes(
  client: AlpacaClient,
  symbols: string[],
  feed?: DataFeed
): Promise<LatestQuotesResponse> {
  if (!symbols || symbols.length === 0) {
    throw new QuoteError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  if (normalizedSymbols.length === 0) {
    throw new QuoteError('No valid symbols provided', 'INVALID_SYMBOLS');
  }

  log(`Fetching latest quotes for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const config = client.getConfig();
    const dataFeed = feed || config.dataFeed || 'iex';

    // Use SDK's getLatestQuotes method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await sdk.getLatestQuotes(normalizedSymbols, { feed: dataFeed } as SDKMarketDataOptions);

    if (!response) {
      throw new QuoteError(
        'No quote data returned',
        'NO_DATA'
      );
    }

    // Map SDK response to our LatestQuotesResponse type
    const quotes: { [symbol: string]: AlpacaQuote } = {};

    for (const [symbol, quote] of Object.entries(response)) {
      const q = quote as {
        Timestamp: string;
        AskPrice: number;
        AskSize: number;
        AskExchange: string;
        BidPrice: number;
        BidSize: number;
        BidExchange: string;
        Conditions?: string[];
        Tape?: string;
      };

      quotes[symbol] = {
        t: q.Timestamp,
        ap: q.AskPrice,
        as: q.AskSize,
        ax: q.AskExchange,
        bp: q.BidPrice,
        bs: q.BidSize,
        bx: q.BidExchange,
        c: q.Conditions || [],
        z: q.Tape || '',
      };
    }

    log(`Successfully fetched quotes for ${Object.keys(quotes).length} symbols`, { type: 'debug' });

    return {
      quotes,
      currency: 'USD',
    };
  } catch (error) {
    if (error instanceof QuoteError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch quotes: ${errorMessage}`, { type: 'error' });

    throw new QuoteError(
      `Failed to fetch quotes: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get bid/ask spread for a symbol
 * Useful for evaluating liquidity and trading costs
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @returns Spread information including bid, ask, spread, and percentage
 * @throws QuoteError if the request fails or if prices are invalid
 */
export async function getSpread(
  client: AlpacaClient,
  symbol: string
): Promise<SpreadInfo> {
  const quote = await getLatestQuote(client, symbol);

  const bid = quote.bp;
  const ask = quote.ap;

  if (bid <= 0 || ask <= 0) {
    throw new QuoteError(
      `Invalid quote prices for ${symbol}: bid=${bid}, ask=${ask}`,
      'INVALID_PRICES',
      symbol
    );
  }

  if (ask < bid) {
    log(`Warning: Ask price (${ask}) is less than bid price (${bid}) for ${symbol}`, { type: 'warn' });
  }

  const spread = ask - bid;
  const midPrice = (bid + ask) / 2;
  const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

  log(`Spread for ${symbol}: ${spread.toFixed(4)} (${spreadPercent.toFixed(4)}%)`, { type: 'debug' });

  return {
    bid,
    ask,
    spread,
    spreadPercent,
    midPrice,
    bidSize: quote.bs,
    askSize: quote.as,
  };
}

/**
 * Get multiple spreads for an array of symbols
 * @param client - AlpacaClient instance
 * @param symbols - Array of stock symbols
 * @returns Map of symbol to spread information
 */
export async function getSpreads(
  client: AlpacaClient,
  symbols: string[]
): Promise<Map<string, SpreadInfo>> {
  const quotesResponse = await getLatestQuotes(client, symbols);
  const spreads = new Map<string, SpreadInfo>();

  for (const [symbol, quote] of Object.entries(quotesResponse.quotes)) {
    const bid = quote.bp;
    const ask = quote.ap;

    if (bid > 0 && ask > 0) {
      const spread = ask - bid;
      const midPrice = (bid + ask) / 2;
      const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

      spreads.set(symbol, {
        bid,
        ask,
        spread,
        spreadPercent,
        midPrice,
        bidSize: quote.bs,
        askSize: quote.as,
      });
    }
  }

  return spreads;
}

/**
 * Check if a symbol has good liquidity based on spread
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param maxSpreadPercent - Maximum acceptable spread percentage (default 1%)
 * @returns true if spread is within acceptable range
 */
export async function hasGoodLiquidity(
  client: AlpacaClient,
  symbol: string,
  maxSpreadPercent: number = 1.0
): Promise<boolean> {
  try {
    const spreadInfo = await getSpread(client, symbol);
    return spreadInfo.spreadPercent <= maxSpreadPercent;
  } catch (error) {
    log(`Failed to check liquidity for ${symbol}: ${(error as Error).message}`, { type: 'warn' });
    return false;
  }
}

export default {
  getLatestQuote,
  getLatestQuotes,
  getSpread,
  getSpreads,
  hasGoodLiquidity,
};
