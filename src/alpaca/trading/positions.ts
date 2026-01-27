/**
 * Position Management Module
 * Handles all position-related operations using Alpaca SDK
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { AlpacaPosition, AssetClass, AlpacaOrder } from '../../types/alpaca-types';

const log = (message: string, options: { type?: 'info' | 'warn' | 'error' | 'debug'; symbol?: string } = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'Positions' });
};

// ============================================================================
// Types
// ============================================================================

/**
 * P&L summary for a single position
 */
export interface PositionPnLSummary {
  /** Trading symbol */
  symbol: string;
  /** Number of shares/contracts held */
  qty: number;
  /** Average entry price per share */
  avgEntryPrice: number;
  /** Current market price per share */
  currentPrice: number;
  /** Total market value of the position */
  marketValue: number;
  /** Total cost basis of the position */
  costBasis: number;
  /** Unrealized profit/loss in dollars */
  unrealizedPL: number;
  /** Unrealized profit/loss as a percentage */
  unrealizedPLPercent: number;
  /** Today's profit/loss in dollars */
  todayPL: number;
  /** Today's profit/loss as a percentage */
  todayPLPercent: number;
}

/**
 * P&L summary for the entire portfolio
 */
export interface PortfolioPnLSummary {
  /** Total market value of all positions */
  totalMarketValue: number;
  /** Total cost basis of all positions */
  totalCostBasis: number;
  /** Total unrealized profit/loss in dollars */
  totalUnrealizedPL: number;
  /** Total unrealized profit/loss as a percentage */
  totalUnrealizedPLPercent: number;
  /** Today's total profit/loss in dollars */
  todayPL: number;
  /** Today's total profit/loss as a percentage */
  todayPLPercent: number;
  /** Individual position summaries */
  positions: PositionPnLSummary[];
}

/**
 * Options for closing a single position
 */
export interface ClosePositionOptions {
  /** Percentage of position to close (0-100) */
  percentage?: number;
  /** Specific quantity to close */
  qty?: number;
}

/**
 * Options for closing all positions
 */
export interface CloseAllPositionsOptions {
  /** Whether to cancel open orders first */
  cancelOrders?: boolean;
}

/**
 * Options for closing positions during after-hours
 */
export interface ClosePositionsAfterHoursOptions {
  /** Percentage offset from current price for limit orders (default: 0.5) */
  limitPriceOffset?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Round a price to the appropriate decimal places for Alpaca
 * Prices >= $1 are rounded to 2 decimal places
 * Prices < $1 are rounded to 4 decimal places
 *
 * @param price - The price to round
 * @returns The rounded price
 *
 * @example
 * roundPriceForAlpaca(123.456) // Returns 123.46
 * roundPriceForAlpaca(0.12345) // Returns 0.1235
 */
function roundPriceForAlpaca(price: number): number {
  return price >= 1 ? Math.round(price * 100) / 100 : Math.round(price * 10000) / 10000;
}

/**
 * Parse numeric string to number, handling null/undefined
 *
 * @param value - The string value to parse
 * @param defaultValue - Default value if parsing fails (default: 0)
 * @returns The parsed number or default value
 */
function parseNumericString(value: string | null | undefined, defaultValue: number = 0): number {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// ============================================================================
// Position Query Functions
// ============================================================================

/**
 * Get all open positions for the account
 *
 * @param client - The Alpaca client instance
 * @returns Array of all open positions
 *
 * @example
 * const client = createAlpacaClient(config);
 * const positions = await getPositions(client);
 * console.log(`Found ${positions.length} open positions`);
 */
export async function getPositions(client: AlpacaClient): Promise<AlpacaPosition[]> {
  log('Fetching all open positions', { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const positions = await sdk.getPositions() as AlpacaPosition[];
    log(`Retrieved ${positions.length} positions`, { type: 'info' });
    return positions;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch positions: ${message}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get positions filtered by asset class
 *
 * @param client - The Alpaca client instance
 * @param assetClass - The asset class to filter by ('us_equity', 'us_option', 'crypto')
 * @returns Array of positions matching the asset class
 *
 * @example
 * const equityPositions = await getPositionsByAssetClass(client, 'us_equity');
 * const optionPositions = await getPositionsByAssetClass(client, 'us_option');
 */
export async function getPositionsByAssetClass(
  client: AlpacaClient,
  assetClass: AssetClass
): Promise<AlpacaPosition[]> {
  log(`Fetching positions for asset class: ${assetClass}`, { type: 'debug' });

  try {
    const positions = await getPositions(client);
    const filtered = positions.filter((position) => position.asset_class === assetClass);
    log(`Found ${filtered.length} ${assetClass} positions`, { type: 'info' });
    return filtered;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch ${assetClass} positions: ${message}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get a specific position by symbol
 *
 * @param client - The Alpaca client instance
 * @param symbol - The trading symbol to look up
 * @returns The position if found, null otherwise
 *
 * @example
 * const applePosition = await getPosition(client, 'AAPL');
 * if (applePosition) {
 *   console.log(`Holding ${applePosition.qty} shares of AAPL`);
 * }
 */
export async function getPosition(
  client: AlpacaClient,
  symbol: string
): Promise<AlpacaPosition | null> {
  log(`Fetching position for symbol: ${symbol}`, { type: 'debug', symbol });

  try {
    const sdk = client.getSDK();
    const position = await sdk.getPosition(symbol) as AlpacaPosition;
    log(`Found position for ${symbol}: ${position.qty} shares`, { type: 'info', symbol });
    return position;
  } catch (error) {
    // Alpaca returns 404 if no position exists
    if (error instanceof Error && error.message.includes('404')) {
      log(`No position found for ${symbol}`, { type: 'debug', symbol });
      return null;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch position for ${symbol}: ${message}`, { type: 'error', symbol });
    throw error;
  }
}

/**
 * Check if a position exists for a given symbol
 *
 * @param client - The Alpaca client instance
 * @param symbol - The trading symbol to check
 * @returns True if a position exists, false otherwise
 *
 * @example
 * if (await hasPosition(client, 'AAPL')) {
 *   console.log('Already have AAPL position');
 * }
 */
export async function hasPosition(client: AlpacaClient, symbol: string): Promise<boolean> {
  const position = await getPosition(client, symbol);
  return position !== null;
}

/**
 * Get the quantity of shares held for a symbol
 *
 * @param client - The Alpaca client instance
 * @param symbol - The trading symbol
 * @returns The quantity held (positive for long, negative for short), 0 if no position
 *
 * @example
 * const qty = await getPositionQty(client, 'AAPL');
 * console.log(`Holding ${qty} shares of AAPL`);
 */
export async function getPositionQty(client: AlpacaClient, symbol: string): Promise<number> {
  const position = await getPosition(client, symbol);
  if (!position) {
    return 0;
  }
  const qty = parseNumericString(position.qty);
  return position.side === 'short' ? -Math.abs(qty) : qty;
}

/**
 * Get the market value of a position
 *
 * @param client - The Alpaca client instance
 * @param symbol - The trading symbol
 * @returns The market value in dollars, 0 if no position
 *
 * @example
 * const value = await getPositionValue(client, 'AAPL');
 * console.log(`AAPL position worth $${value.toFixed(2)}`);
 */
export async function getPositionValue(client: AlpacaClient, symbol: string): Promise<number> {
  const position = await getPosition(client, symbol);
  if (!position) {
    return 0;
  }
  return parseNumericString(position.market_value);
}

/**
 * Get the side of a position (long or short)
 *
 * @param client - The Alpaca client instance
 * @param symbol - The trading symbol
 * @returns 'long', 'short', or null if no position
 *
 * @example
 * const side = await getPositionSide(client, 'AAPL');
 * if (side === 'long') {
 *   console.log('Long position in AAPL');
 * }
 */
export async function getPositionSide(
  client: AlpacaClient,
  symbol: string
): Promise<'long' | 'short' | null> {
  const position = await getPosition(client, symbol);
  return position?.side ?? null;
}

// ============================================================================
// Position Close Functions
// ============================================================================

/**
 * Close a specific position
 *
 * @param client - The Alpaca client instance
 * @param symbol - The trading symbol to close
 * @param options - Optional parameters for partial closes
 * @returns The resulting close order
 * @throws Error if no position exists or close fails
 *
 * @example
 * // Close entire position
 * const order = await closePosition(client, 'AAPL');
 *
 * // Close 50% of position
 * const order = await closePosition(client, 'AAPL', { percentage: 50 });
 *
 * // Close specific quantity
 * const order = await closePosition(client, 'AAPL', { qty: 10 });
 */
export async function closePosition(
  client: AlpacaClient,
  symbol: string,
  options?: ClosePositionOptions
): Promise<AlpacaOrder> {
  log(`Closing position for ${symbol}`, { type: 'info', symbol });

  try {
    const sdk = client.getSDK();

    // Build query params for partial closes
    const queryParams: Record<string, string> = {};

    if (options?.qty !== undefined) {
      queryParams.qty = options.qty.toString();
      log(`Closing ${options.qty} shares of ${symbol}`, { type: 'info', symbol });
    } else if (options?.percentage !== undefined) {
      queryParams.percentage = options.percentage.toString();
      log(`Closing ${options.percentage}% of ${symbol} position`, { type: 'info', symbol });
    } else {
      log(`Closing entire position for ${symbol}`, { type: 'info', symbol });
    }

    // Use sendRequest for parameterized close, closePosition for full close
    let order: AlpacaOrder;
    if (Object.keys(queryParams).length > 0) {
      // SDK doesn't support params, use sendRequest directly
      order = await sdk.sendRequest(
        `/positions/${encodeURIComponent(symbol)}`,
        queryParams,
        null,
        'DELETE'
      ) as AlpacaOrder;
    } else {
      order = await sdk.closePosition(symbol) as AlpacaOrder;
    }

    log(`Position close order created for ${symbol}: ${order.id}`, { type: 'info', symbol });
    return order;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to close position for ${symbol}: ${message}`, { type: 'error', symbol });
    throw error;
  }
}

/**
 * Close all open positions
 *
 * @param client - The Alpaca client instance
 * @param options - Optional parameters
 * @returns Array of close orders
 *
 * @example
 * // Close all positions and cancel orders
 * const orders = await closeAllPositions(client, { cancelOrders: true });
 *
 * // Close all positions without canceling orders
 * const orders = await closeAllPositions(client, { cancelOrders: false });
 */
export async function closeAllPositions(
  client: AlpacaClient,
  options?: CloseAllPositionsOptions
): Promise<AlpacaOrder[]> {
  const cancelOrders = options?.cancelOrders ?? true;

  log(`Closing all positions${cancelOrders ? ' and canceling open orders' : ''}`, { type: 'info' });

  try {
    const sdk = client.getSDK();

    // Build query params for cancel_orders option
    const queryParams: Record<string, string> = {
      cancel_orders: cancelOrders.toString(),
    };

    // Use sendRequest to pass the cancel_orders parameter
    const response = await sdk.sendRequest('/positions', queryParams, null, 'DELETE');

    // The SDK returns an array of objects with order info
    const orders = Array.isArray(response) ? response as AlpacaOrder[] : [];
    log(`Closed ${orders.length} positions`, { type: 'info' });
    return orders;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to close all positions: ${message}`, { type: 'error' });
    throw error;
  }
}

/**
 * Close all positions with limit orders (for after-hours trading)
 * Sets limit price slightly below current price for sells, above for buys
 *
 * @param client - The Alpaca client instance
 * @param options - Optional parameters
 * @returns Array of limit orders created
 *
 * @example
 * // Close positions after hours with 0.5% price offset
 * const orders = await closeAllPositionsAfterHours(client, { limitPriceOffset: 0.5 });
 */
export async function closeAllPositionsAfterHours(
  client: AlpacaClient,
  options?: ClosePositionsAfterHoursOptions
): Promise<AlpacaOrder[]> {
  const limitPriceOffset = options?.limitPriceOffset ?? 0.5;

  log(`Closing all positions with limit orders (${limitPriceOffset}% offset) for after-hours`, { type: 'info' });

  try {
    const sdk = client.getSDK();
    const positions = await getPositions(client);

    if (positions.length === 0) {
      log('No positions to close', { type: 'info' });
      return [];
    }

    // First cancel all open orders
    await sdk.cancelAllOrders();
    log('Cancelled all open orders', { type: 'info' });

    const orders: AlpacaOrder[] = [];
    const offsetMultiplier = limitPriceOffset / 100;

    for (const position of positions) {
      const qty = Math.abs(parseNumericString(position.qty));
      const currentPrice = parseNumericString(position.current_price);
      const side = position.side === 'long' ? 'sell' : 'buy';

      if (qty === 0 || currentPrice === 0) {
        log(`Skipping ${position.symbol}: invalid qty or price`, { type: 'warn', symbol: position.symbol });
        continue;
      }

      // Calculate limit price with offset
      const limitPrice = side === 'sell'
        ? roundPriceForAlpaca(currentPrice * (1 - offsetMultiplier))
        : roundPriceForAlpaca(currentPrice * (1 + offsetMultiplier));

      log(
        `Creating limit order to close ${position.symbol}: ${side} ${qty} shares at $${limitPrice.toFixed(2)}`,
        { type: 'info', symbol: position.symbol }
      );

      try {
        const order = await sdk.createOrder({
          symbol: position.symbol,
          qty: qty,
          side: side,
          type: 'limit',
          time_in_force: 'day',
          limit_price: limitPrice,
          extended_hours: true,
        }) as AlpacaOrder;

        orders.push(order);
      } catch (orderError) {
        const message = orderError instanceof Error ? orderError.message : 'Unknown error';
        log(`Failed to create close order for ${position.symbol}: ${message}`, { type: 'error', symbol: position.symbol });
      }
    }

    log(`Created ${orders.length} limit orders to close positions`, { type: 'info' });
    return orders;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to close positions after hours: ${message}`, { type: 'error' });
    throw error;
  }
}

// ============================================================================
// P&L Functions
// ============================================================================

/**
 * Get P&L summary for a specific position
 *
 * @param client - The Alpaca client instance
 * @param symbol - The trading symbol
 * @returns P&L summary for the position, null if no position exists
 *
 * @example
 * const pnl = await getPositionPnL(client, 'AAPL');
 * if (pnl) {
 *   console.log(`AAPL unrealized P&L: $${pnl.unrealizedPL.toFixed(2)} (${pnl.unrealizedPLPercent.toFixed(2)}%)`);
 * }
 */
export async function getPositionPnL(
  client: AlpacaClient,
  symbol: string
): Promise<PositionPnLSummary | null> {
  log(`Calculating P&L for ${symbol}`, { type: 'debug', symbol });

  const position = await getPosition(client, symbol);
  if (!position) {
    log(`No position found for ${symbol}`, { type: 'debug', symbol });
    return null;
  }

  const qty = parseNumericString(position.qty);
  const avgEntryPrice = parseNumericString(position.avg_entry_price);
  const currentPrice = parseNumericString(position.current_price);
  const marketValue = parseNumericString(position.market_value);
  const costBasis = parseNumericString(position.cost_basis);
  const unrealizedPL = parseNumericString(position.unrealized_pl);
  const unrealizedPLPercent = parseNumericString(position.unrealized_plpc) * 100;
  const todayPL = parseNumericString(position.unrealized_intraday_pl);
  const todayPLPercent = parseNumericString(position.unrealized_intraday_plpc) * 100;

  const summary: PositionPnLSummary = {
    symbol: position.symbol,
    qty,
    avgEntryPrice,
    currentPrice,
    marketValue,
    costBasis,
    unrealizedPL,
    unrealizedPLPercent,
    todayPL,
    todayPLPercent,
  };

  log(
    `${symbol} P&L: $${unrealizedPL.toFixed(2)} (${unrealizedPLPercent.toFixed(2)}%)`,
    { type: 'info', symbol }
  );

  return summary;
}

/**
 * Get total portfolio P&L summary
 *
 * @param client - The Alpaca client instance
 * @returns Portfolio-level P&L summary including all positions
 *
 * @example
 * const portfolio = await getPortfolioPnL(client);
 * console.log(`Total unrealized P&L: $${portfolio.totalUnrealizedPL.toFixed(2)}`);
 * console.log(`Today's P&L: $${portfolio.todayPL.toFixed(2)}`);
 */
export async function getPortfolioPnL(client: AlpacaClient): Promise<PortfolioPnLSummary> {
  log('Calculating portfolio P&L', { type: 'debug' });

  const positions = await getPositions(client);

  const positionSummaries: PositionPnLSummary[] = positions.map((position) => {
    const qty = parseNumericString(position.qty);
    const avgEntryPrice = parseNumericString(position.avg_entry_price);
    const currentPrice = parseNumericString(position.current_price);
    const marketValue = parseNumericString(position.market_value);
    const costBasis = parseNumericString(position.cost_basis);
    const unrealizedPL = parseNumericString(position.unrealized_pl);
    const unrealizedPLPercent = parseNumericString(position.unrealized_plpc) * 100;
    const todayPL = parseNumericString(position.unrealized_intraday_pl);
    const todayPLPercent = parseNumericString(position.unrealized_intraday_plpc) * 100;

    return {
      symbol: position.symbol,
      qty,
      avgEntryPrice,
      currentPrice,
      marketValue,
      costBasis,
      unrealizedPL,
      unrealizedPLPercent,
      todayPL,
      todayPLPercent,
    };
  });

  // Calculate totals
  const totalMarketValue = positionSummaries.reduce((sum, p) => sum + p.marketValue, 0);
  const totalCostBasis = positionSummaries.reduce((sum, p) => sum + p.costBasis, 0);
  const totalUnrealizedPL = positionSummaries.reduce((sum, p) => sum + p.unrealizedPL, 0);
  const todayPL = positionSummaries.reduce((sum, p) => sum + p.todayPL, 0);

  // Calculate percentage returns
  const totalUnrealizedPLPercent = totalCostBasis !== 0
    ? (totalUnrealizedPL / totalCostBasis) * 100
    : 0;

  // Today's P&L percent is calculated based on previous day's market value
  const previousDayValue = totalMarketValue - todayPL;
  const todayPLPercent = previousDayValue !== 0
    ? (todayPL / previousDayValue) * 100
    : 0;

  const summary: PortfolioPnLSummary = {
    totalMarketValue,
    totalCostBasis,
    totalUnrealizedPL,
    totalUnrealizedPLPercent,
    todayPL,
    todayPLPercent,
    positions: positionSummaries,
  };

  log(
    `Portfolio P&L: $${totalUnrealizedPL.toFixed(2)} (${totalUnrealizedPLPercent.toFixed(2)}%), ` +
    `Today: $${todayPL.toFixed(2)} (${todayPLPercent.toFixed(2)}%)`,
    { type: 'info' }
  );

  return summary;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get all equity positions (us_equity asset class)
 *
 * @param client - The Alpaca client instance
 * @returns Array of equity positions
 *
 * @example
 * const equities = await getEquityPositions(client);
 */
export async function getEquityPositions(client: AlpacaClient): Promise<AlpacaPosition[]> {
  return getPositionsByAssetClass(client, 'us_equity');
}

/**
 * Get all option positions (us_option asset class)
 *
 * @param client - The Alpaca client instance
 * @returns Array of option positions
 *
 * @example
 * const options = await getOptionPositions(client);
 */
export async function getOptionPositions(client: AlpacaClient): Promise<AlpacaPosition[]> {
  return getPositionsByAssetClass(client, 'us_option');
}

/**
 * Get all crypto positions
 *
 * @param client - The Alpaca client instance
 * @returns Array of crypto positions
 *
 * @example
 * const crypto = await getCryptoPositions(client);
 */
export async function getCryptoPositions(client: AlpacaClient): Promise<AlpacaPosition[]> {
  return getPositionsByAssetClass(client, 'crypto');
}

/**
 * Get count of open positions
 *
 * @param client - The Alpaca client instance
 * @param assetClass - Optional asset class filter
 * @returns Number of open positions
 *
 * @example
 * const totalPositions = await getPositionCount(client);
 * const equityPositions = await getPositionCount(client, 'us_equity');
 */
export async function getPositionCount(
  client: AlpacaClient,
  assetClass?: AssetClass
): Promise<number> {
  const positions = assetClass
    ? await getPositionsByAssetClass(client, assetClass)
    : await getPositions(client);
  return positions.length;
}

/**
 * Get symbols of all open positions
 *
 * @param client - The Alpaca client instance
 * @param assetClass - Optional asset class filter
 * @returns Array of position symbols
 *
 * @example
 * const symbols = await getPositionSymbols(client);
 * console.log(`Holding positions in: ${symbols.join(', ')}`);
 */
export async function getPositionSymbols(
  client: AlpacaClient,
  assetClass?: AssetClass
): Promise<string[]> {
  const positions = assetClass
    ? await getPositionsByAssetClass(client, assetClass)
    : await getPositions(client);
  return positions.map((p) => p.symbol);
}

/**
 * Get total market value of all positions
 *
 * @param client - The Alpaca client instance
 * @param assetClass - Optional asset class filter
 * @returns Total market value in dollars
 *
 * @example
 * const totalValue = await getTotalMarketValue(client);
 * const equityValue = await getTotalMarketValue(client, 'us_equity');
 */
export async function getTotalMarketValue(
  client: AlpacaClient,
  assetClass?: AssetClass
): Promise<number> {
  const positions = assetClass
    ? await getPositionsByAssetClass(client, assetClass)
    : await getPositions(client);

  return positions.reduce((total, p) => total + parseNumericString(p.market_value), 0);
}

/**
 * Check if there are any open positions
 *
 * @param client - The Alpaca client instance
 * @param assetClass - Optional asset class filter
 * @returns True if there are open positions
 *
 * @example
 * if (await hasAnyPositions(client)) {
 *   console.log('Portfolio has open positions');
 * }
 */
export async function hasAnyPositions(
  client: AlpacaClient,
  assetClass?: AssetClass
): Promise<boolean> {
  const count = await getPositionCount(client, assetClass);
  return count > 0;
}

/**
 * Get positions sorted by market value (descending)
 *
 * @param client - The Alpaca client instance
 * @param assetClass - Optional asset class filter
 * @returns Positions sorted by market value (largest first)
 *
 * @example
 * const sortedPositions = await getPositionsByValue(client);
 * console.log(`Largest position: ${sortedPositions[0]?.symbol}`);
 */
export async function getPositionsByValue(
  client: AlpacaClient,
  assetClass?: AssetClass
): Promise<AlpacaPosition[]> {
  const positions = assetClass
    ? await getPositionsByAssetClass(client, assetClass)
    : await getPositions(client);

  return positions.sort((a, b) => {
    const aValue = Math.abs(parseNumericString(a.market_value));
    const bValue = Math.abs(parseNumericString(b.market_value));
    return bValue - aValue;
  });
}

/**
 * Get positions sorted by unrealized P&L (descending - best performers first)
 *
 * @param client - The Alpaca client instance
 * @param assetClass - Optional asset class filter
 * @returns Positions sorted by unrealized P&L
 *
 * @example
 * const sortedPositions = await getPositionsByPnL(client);
 * const winners = sortedPositions.filter(p => parseFloat(p.unrealized_pl) > 0);
 * const losers = sortedPositions.filter(p => parseFloat(p.unrealized_pl) < 0);
 */
export async function getPositionsByPnL(
  client: AlpacaClient,
  assetClass?: AssetClass
): Promise<AlpacaPosition[]> {
  const positions = assetClass
    ? await getPositionsByAssetClass(client, assetClass)
    : await getPositions(client);

  return positions.sort((a, b) => {
    const aPnL = parseNumericString(a.unrealized_pl);
    const bPnL = parseNumericString(b.unrealized_pl);
    return bPnL - aPnL;
  });
}

/**
 * Get winning positions (positive unrealized P&L)
 *
 * @param client - The Alpaca client instance
 * @param assetClass - Optional asset class filter
 * @returns Positions with positive unrealized P&L
 *
 * @example
 * const winners = await getWinningPositions(client);
 */
export async function getWinningPositions(
  client: AlpacaClient,
  assetClass?: AssetClass
): Promise<AlpacaPosition[]> {
  const positions = assetClass
    ? await getPositionsByAssetClass(client, assetClass)
    : await getPositions(client);

  return positions.filter((p) => parseNumericString(p.unrealized_pl) > 0);
}

/**
 * Get losing positions (negative unrealized P&L)
 *
 * @param client - The Alpaca client instance
 * @param assetClass - Optional asset class filter
 * @returns Positions with negative unrealized P&L
 *
 * @example
 * const losers = await getLosingPositions(client);
 */
export async function getLosingPositions(
  client: AlpacaClient,
  assetClass?: AssetClass
): Promise<AlpacaPosition[]> {
  const positions = assetClass
    ? await getPositionsByAssetClass(client, assetClass)
    : await getPositions(client);

  return positions.filter((p) => parseNumericString(p.unrealized_pl) < 0);
}

// ============================================================================
// Export Default
// ============================================================================

export default {
  // Query functions
  getPositions,
  getPositionsByAssetClass,
  getPosition,
  hasPosition,
  getPositionQty,
  getPositionValue,
  getPositionSide,

  // Close functions
  closePosition,
  closeAllPositions,
  closeAllPositionsAfterHours,

  // P&L functions
  getPositionPnL,
  getPortfolioPnL,

  // Utility functions
  getEquityPositions,
  getOptionPositions,
  getCryptoPositions,
  getPositionCount,
  getPositionSymbols,
  getTotalMarketValue,
  hasAnyPositions,
  getPositionsByValue,
  getPositionsByPnL,
  getWinningPositions,
  getLosingPositions,
};
