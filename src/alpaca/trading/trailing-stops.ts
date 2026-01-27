/**
 * Native Trailing Stop Orders Module
 *
 * This module provides functions for creating and managing native trailing stop orders
 * using Alpaca's server-side trailing stop functionality. Native trailing stops are
 * handled by Alpaca's servers, eliminating the need for client-side monitoring.
 *
 * Key benefits of native trailing stops:
 * - Server-side execution ensures stops work even if your application is offline
 * - No need for polling or websocket connections to monitor prices
 * - Automatic high water mark (HWM) tracking by Alpaca
 * - Support for both percentage-based and dollar-based trailing
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import { AlpacaOrder, OrderSide, TimeInForce, AlpacaPosition } from '../../types/alpaca-types';

const LOG_SOURCE = 'TrailingStops';

/**
 * Internal logging helper with consistent source
 */
const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: LOG_SOURCE });
};

/**
 * Parameters for creating a trailing stop order
 */
export interface TrailingStopParams {
  /** Stock symbol */
  symbol: string;
  /** Number of shares */
  qty: number;
  /** Order side (usually 'sell' for closing long positions) */
  side: OrderSide;
  /** Trail by percentage (e.g., 1.0 = 1%). Must specify either trailPercent OR trailPrice */
  trailPercent?: number;
  /** Trail by fixed dollar amount. Must specify either trailPercent OR trailPrice */
  trailPrice?: number;
  /** Time in force (default: 'gtc') */
  timeInForce?: TimeInForce;
  /** Extended hours trading */
  extendedHours?: boolean;
  /** Client order ID for tracking */
  clientOrderId?: string;
}

/**
 * Result of trailing stop HWM query
 */
export interface TrailingStopHWMResult {
  /** High water mark - the highest price seen since order placement (for sell stops) */
  hwm: number | null;
  /** Current calculated stop price based on HWM and trail amount */
  currentStop: number | null;
}

/**
 * Parameters for creating trailing stops across a portfolio
 */
export interface PortfolioTrailingStopParams {
  /** Trail by percentage (e.g., 2.0 = 2%) */
  trailPercent: number;
  /** Time in force (default: 'gtc') */
  timeInForce?: TimeInForce;
  /** Symbols to exclude from trailing stop creation */
  excludeSymbols?: string[];
}

/**
 * Validation error for trailing stop parameters
 */
export class TrailingStopValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrailingStopValidationError';
  }
}

/**
 * Validates trailing stop parameters
 * @throws {TrailingStopValidationError} If validation fails
 */
function validateTrailingStopParams(params: TrailingStopParams): void {
  // Must have either trailPercent or trailPrice, not both
  if (params.trailPercent === undefined && params.trailPrice === undefined) {
    throw new TrailingStopValidationError('Must specify either trailPercent or trailPrice');
  }

  if (params.trailPercent !== undefined && params.trailPrice !== undefined) {
    throw new TrailingStopValidationError('Cannot specify both trailPercent and trailPrice');
  }

  // Validate trailPercent range
  if (params.trailPercent !== undefined) {
    if (params.trailPercent <= 0) {
      throw new TrailingStopValidationError('trailPercent must be greater than 0');
    }
    if (params.trailPercent > 100) {
      throw new TrailingStopValidationError('trailPercent cannot exceed 100');
    }
  }

  // Validate trailPrice
  if (params.trailPrice !== undefined) {
    if (params.trailPrice <= 0) {
      throw new TrailingStopValidationError('trailPrice must be greater than 0');
    }
  }

  // Validate quantity
  if (params.qty <= 0) {
    throw new TrailingStopValidationError('qty must be greater than 0');
  }

  // Validate symbol
  if (!params.symbol || params.symbol.trim() === '') {
    throw new TrailingStopValidationError('symbol is required');
  }
}

/**
 * Create a native trailing stop order
 *
 * The trailing stop automatically adjusts based on price movement:
 * - For SELL: Stop rises as price rises, locks in when price falls
 * - For BUY: Stop falls as price falls, triggers when price rises
 *
 * Must specify either trailPercent OR trailPrice (not both)
 *
 * @param client - AlpacaClient instance
 * @param params - Trailing stop parameters
 * @returns The created order
 * @throws {TrailingStopValidationError} If parameters are invalid
 * @throws {Error} If order creation fails
 *
 * @example
 * ```typescript
 * // Trail by 2% on a sell (closing long position)
 * await createTrailingStop(client, {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'sell',
 *   trailPercent: 2.0,
 * });
 *
 * // Trail by $5 on a sell
 * await createTrailingStop(client, {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'sell',
 *   trailPrice: 5.00,
 * });
 * ```
 */
export async function createTrailingStop(
  client: AlpacaClient,
  params: TrailingStopParams
): Promise<AlpacaOrder> {
  // Validate parameters
  validateTrailingStopParams(params);

  const sdk = client.getSDK();
  const trailDescription = params.trailPercent
    ? `${params.trailPercent}%`
    : `$${params.trailPrice?.toFixed(2)}`;

  log(`Creating trailing stop: ${params.side} ${params.qty} ${params.symbol} (trail: ${trailDescription})`, {
    type: 'info',
  });

  try {
    const orderParams: Record<string, unknown> = {
      symbol: params.symbol,
      qty: params.qty,
      side: params.side,
      type: 'trailing_stop',
      time_in_force: params.timeInForce || 'gtc',
    };

    if (params.trailPercent !== undefined) {
      orderParams.trail_percent = params.trailPercent.toString();
    } else if (params.trailPrice !== undefined) {
      orderParams.trail_price = params.trailPrice.toString();
    }

    if (params.extendedHours) {
      orderParams.extended_hours = true;
    }

    if (params.clientOrderId) {
      orderParams.client_order_id = params.clientOrderId;
    }

    const order = await sdk.createOrder(orderParams);

    log(
      `Trailing stop created: orderId=${order.id}, HWM=${order.hwm || 'pending'}, status=${order.status}`,
      { type: 'info' }
    );

    return order as AlpacaOrder;
  } catch (error) {
    const err = error as Error;
    log(`Trailing stop creation failed for ${params.symbol}: ${err.message}`, { type: 'error' });
    throw new Error(`Failed to create trailing stop for ${params.symbol}: ${err.message}`);
  }
}

/**
 * Update an existing trailing stop order
 *
 * You can update the trail_percent or trail_price of an existing order.
 * Note: Alpaca uses 'trail' parameter for replacements (works for both percent and price).
 *
 * @param client - AlpacaClient instance
 * @param orderId - The ID of the order to update
 * @param updates - New trail parameters (specify one of trailPercent or trailPrice)
 * @returns The updated order
 * @throws {Error} If no update parameters provided or update fails
 *
 * @example
 * ```typescript
 * // Tighten trailing stop to 1.5%
 * await updateTrailingStop(client, 'order-id-123', { trailPercent: 1.5 });
 *
 * // Change to $3 trail
 * await updateTrailingStop(client, 'order-id-123', { trailPrice: 3.00 });
 * ```
 */
export async function updateTrailingStop(
  client: AlpacaClient,
  orderId: string,
  updates: {
    trailPercent?: number;
    trailPrice?: number;
  }
): Promise<AlpacaOrder> {
  // Validate that at least one update is provided
  if (updates.trailPercent === undefined && updates.trailPrice === undefined) {
    throw new Error('Must specify either trailPercent or trailPrice for update');
  }

  if (updates.trailPercent !== undefined && updates.trailPrice !== undefined) {
    throw new Error('Cannot specify both trailPercent and trailPrice for update');
  }

  // Validate values
  if (updates.trailPercent !== undefined && updates.trailPercent <= 0) {
    throw new Error('trailPercent must be greater than 0');
  }

  if (updates.trailPrice !== undefined && updates.trailPrice <= 0) {
    throw new Error('trailPrice must be greater than 0');
  }

  const sdk = client.getSDK();
  const updateDescription = updates.trailPercent
    ? `${updates.trailPercent}%`
    : `$${updates.trailPrice?.toFixed(2)}`;

  log(`Updating trailing stop ${orderId} to trail: ${updateDescription}`, { type: 'info' });

  try {
    const replaceParams: Record<string, string> = {};

    // Alpaca's replaceOrder uses 'trail' for both percent and price updates
    if (updates.trailPercent !== undefined) {
      replaceParams.trail = updates.trailPercent.toString();
    } else if (updates.trailPrice !== undefined) {
      replaceParams.trail = updates.trailPrice.toString();
    }

    const order = await sdk.replaceOrder(orderId, replaceParams);

    log(`Trailing stop updated: orderId=${order.id}, new replacement created`, { type: 'info' });

    return order as AlpacaOrder;
  } catch (error) {
    const err = error as Error;
    log(`Trailing stop update failed for ${orderId}: ${err.message}`, { type: 'error' });
    throw new Error(`Failed to update trailing stop ${orderId}: ${err.message}`);
  }
}

/**
 * Get the current high water mark (HWM) for a trailing stop
 *
 * The HWM is the highest price seen since order placement (for sell stops)
 * or the lowest price (for buy stops). The current stop price is calculated
 * based on the HWM and the trail amount.
 *
 * @param client - AlpacaClient instance
 * @param orderId - The ID of the trailing stop order
 * @returns Object containing HWM and current stop price (null if not yet established)
 * @throws {Error} If order retrieval fails
 *
 * @example
 * ```typescript
 * const { hwm, currentStop } = await getTrailingStopHWM(client, 'order-id-123');
 * console.log(`High water mark: $${hwm}, Current stop: $${currentStop}`);
 * ```
 */
export async function getTrailingStopHWM(
  client: AlpacaClient,
  orderId: string
): Promise<TrailingStopHWMResult> {
  const sdk = client.getSDK();

  try {
    const order = await sdk.getOrder(orderId);

    // Validate this is actually a trailing stop order
    if (order.type !== 'trailing_stop') {
      log(`Order ${orderId} is not a trailing stop order (type: ${order.type})`, { type: 'warn' });
    }

    const result: TrailingStopHWMResult = {
      hwm: order.hwm ? parseFloat(order.hwm) : null,
      currentStop: order.stop_price ? parseFloat(order.stop_price) : null,
    };

    log(
      `Retrieved HWM for ${orderId}: HWM=${result.hwm ?? 'N/A'}, currentStop=${result.currentStop ?? 'N/A'}`,
      { type: 'debug' }
    );

    return result;
  } catch (error) {
    const err = error as Error;
    log(`Failed to get trailing stop HWM for ${orderId}: ${err.message}`, { type: 'error' });
    throw new Error(`Failed to get trailing stop HWM for ${orderId}: ${err.message}`);
  }
}

/**
 * Cancel a trailing stop order
 *
 * @param client - AlpacaClient instance
 * @param orderId - The ID of the trailing stop order to cancel
 * @throws {Error} If cancellation fails
 *
 * @example
 * ```typescript
 * await cancelTrailingStop(client, 'order-id-123');
 * ```
 */
export async function cancelTrailingStop(
  client: AlpacaClient,
  orderId: string
): Promise<void> {
  const sdk = client.getSDK();

  log(`Canceling trailing stop order: ${orderId}`, { type: 'info' });

  try {
    await sdk.cancelOrder(orderId);
    log(`Trailing stop order canceled: ${orderId}`, { type: 'info' });
  } catch (error) {
    const err = error as Error;

    // Check if the order was already filled or canceled
    if (err.message.includes('order is not cancelable')) {
      log(`Trailing stop ${orderId} is not cancelable (may already be filled or canceled)`, {
        type: 'warn',
      });
      throw new Error(`Trailing stop ${orderId} is not cancelable: order may already be filled or canceled`);
    }

    log(`Failed to cancel trailing stop ${orderId}: ${err.message}`, { type: 'error' });
    throw new Error(`Failed to cancel trailing stop ${orderId}: ${err.message}`);
  }
}

/**
 * Create trailing stops for all positions in a portfolio
 *
 * This function creates trailing stop orders for all long positions in the portfolio,
 * which is useful for applying blanket downside protection. Short positions are skipped.
 *
 * @param client - AlpacaClient instance
 * @param params - Configuration for portfolio-wide trailing stops
 * @returns Map of symbol to created order (symbols that failed are not included)
 *
 * @example
 * ```typescript
 * // Apply 3% trailing stops to all positions except TSLA and NVDA
 * const orders = await createPortfolioTrailingStops(client, {
 *   trailPercent: 3.0,
 *   excludeSymbols: ['TSLA', 'NVDA'],
 * });
 *
 * console.log(`Created ${orders.size} trailing stops`);
 * for (const [symbol, order] of orders) {
 *   console.log(`${symbol}: ${order.id}`);
 * }
 * ```
 */
export async function createPortfolioTrailingStops(
  client: AlpacaClient,
  params: PortfolioTrailingStopParams
): Promise<Map<string, AlpacaOrder>> {
  // Validate trail percent
  if (params.trailPercent <= 0) {
    throw new Error('trailPercent must be greater than 0');
  }

  if (params.trailPercent > 100) {
    throw new Error('trailPercent cannot exceed 100');
  }

  const sdk = client.getSDK();
  const results = new Map<string, AlpacaOrder>();
  const excludeSet = new Set(params.excludeSymbols?.map((s) => s.toUpperCase()) || []);

  log(`Creating portfolio trailing stops at ${params.trailPercent}%`, { type: 'info' });

  try {
    const positions: AlpacaPosition[] = await sdk.getPositions();

    if (positions.length === 0) {
      log('No positions found in portfolio', { type: 'info' });
      return results;
    }

    log(`Found ${positions.length} positions, checking for eligible trailing stops`, { type: 'debug' });

    const errors: Array<{ symbol: string; error: string }> = [];

    for (const position of positions) {
      const symbol = position.symbol.toUpperCase();

      // Skip excluded symbols
      if (excludeSet.has(symbol)) {
        log(`Skipping ${symbol} (excluded)`, { type: 'debug' });
        continue;
      }

      // Only create trailing stops for long positions
      const qty = parseFloat(position.qty);
      if (qty <= 0) {
        log(`Skipping ${symbol} (not a long position, qty: ${qty})`, { type: 'debug' });
        continue;
      }

      try {
        const order = await createTrailingStop(client, {
          symbol,
          qty: Math.abs(qty),
          side: 'sell',
          trailPercent: params.trailPercent,
          timeInForce: params.timeInForce || 'gtc',
        });
        results.set(symbol, order);
      } catch (err) {
        const errorMessage = (err as Error).message;
        errors.push({ symbol, error: errorMessage });
        log(`Failed to create trailing stop for ${symbol}: ${errorMessage}`, { type: 'error' });
      }
    }

    // Log summary
    const successCount = results.size;
    const failureCount = errors.length;
    const skippedCount = positions.length - successCount - failureCount;

    log(
      `Portfolio trailing stops complete: ${successCount} created, ${failureCount} failed, ${skippedCount} skipped`,
      { type: 'info' }
    );

    if (errors.length > 0) {
      log(`Failed symbols: ${errors.map((e) => `${e.symbol} (${e.error})`).join(', ')}`, {
        type: 'warn',
      });
    }

    return results;
  } catch (error) {
    const err = error as Error;
    log(`Failed to create portfolio trailing stops: ${err.message}`, { type: 'error' });
    throw new Error(`Failed to create portfolio trailing stops: ${err.message}`);
  }
}

/**
 * Get all open trailing stop orders
 *
 * @param client - AlpacaClient instance
 * @param symbol - Optional symbol to filter by
 * @returns Array of open trailing stop orders
 *
 * @example
 * ```typescript
 * // Get all trailing stops
 * const allStops = await getOpenTrailingStops(client);
 *
 * // Get trailing stops for specific symbol
 * const appleStops = await getOpenTrailingStops(client, 'AAPL');
 * ```
 */
export async function getOpenTrailingStops(
  client: AlpacaClient,
  symbol?: string
): Promise<AlpacaOrder[]> {
  const sdk = client.getSDK();

  try {
    const queryParams: Record<string, unknown> = {
      status: 'open',
    };

    if (symbol) {
      queryParams.symbols = symbol.toUpperCase();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders = (await sdk.getOrders(queryParams as any)) as AlpacaOrder[];

    // Filter to only trailing stop orders
    const trailingStops = orders.filter((order) => order.type === 'trailing_stop');

    log(`Found ${trailingStops.length} open trailing stop orders${symbol ? ` for ${symbol}` : ''}`, {
      type: 'debug',
    });

    return trailingStops;
  } catch (error) {
    const err = error as Error;
    log(`Failed to get open trailing stops: ${err.message}`, { type: 'error' });
    throw new Error(`Failed to get open trailing stops: ${err.message}`);
  }
}

/**
 * Check if a symbol has an active trailing stop order
 *
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol to check
 * @returns True if an active trailing stop exists for the symbol
 *
 * @example
 * ```typescript
 * if (await hasActiveTrailingStop(client, 'AAPL')) {
 *   console.log('AAPL already has a trailing stop');
 * }
 * ```
 */
export async function hasActiveTrailingStop(
  client: AlpacaClient,
  symbol: string
): Promise<boolean> {
  const trailingStops = await getOpenTrailingStops(client, symbol);
  return trailingStops.length > 0;
}

/**
 * Cancel all trailing stop orders for a specific symbol
 *
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @returns Number of orders canceled
 *
 * @example
 * ```typescript
 * const canceled = await cancelTrailingStopsForSymbol(client, 'AAPL');
 * console.log(`Canceled ${canceled} trailing stop orders for AAPL`);
 * ```
 */
export async function cancelTrailingStopsForSymbol(
  client: AlpacaClient,
  symbol: string
): Promise<number> {
  const trailingStops = await getOpenTrailingStops(client, symbol);

  if (trailingStops.length === 0) {
    log(`No trailing stops to cancel for ${symbol}`, { type: 'debug' });
    return 0;
  }

  let canceledCount = 0;
  const errors: string[] = [];

  for (const order of trailingStops) {
    try {
      await cancelTrailingStop(client, order.id);
      canceledCount++;
    } catch (err) {
      errors.push(`${order.id}: ${(err as Error).message}`);
    }
  }

  if (errors.length > 0) {
    log(`Some trailing stops failed to cancel for ${symbol}: ${errors.join(', ')}`, { type: 'warn' });
  }

  log(`Canceled ${canceledCount}/${trailingStops.length} trailing stops for ${symbol}`, { type: 'info' });

  return canceledCount;
}

/**
 * Default export object with all trailing stop functions
 */
export default {
  createTrailingStop,
  updateTrailingStop,
  getTrailingStopHWM,
  cancelTrailingStop,
  createPortfolioTrailingStops,
  getOpenTrailingStops,
  hasActiveTrailingStop,
  cancelTrailingStopsForSymbol,
};
