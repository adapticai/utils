// src/alpaca/trading/bracket-orders.ts
// Bracket Orders Module - Combines entry, take profit, and stop loss orders

import { log as baseLog } from '../../logging';
import { AlpacaOrder, OrderSide, TimeInForce, CreateOrderParams } from '../../types/alpaca-types';
import { LogOptions } from '../../types/logging-types';

/**
 * Logs a message with the BracketOrders source.
 * @param message - The message to log.
 * @param options - Optional logging options.
 */
const log = (message: string, options: LogOptions = { type: 'info' }): void => {
  baseLog(message, { ...options, source: 'BracketOrders' });
};

/**
 * Interface for the Alpaca client/API that can execute bracket orders.
 * This can be implemented by AlpacaTradingAPI or a future AlpacaClient class.
 */
export interface BracketOrderExecutor {
  /** Execute an order request and return the created order */
  createOrder(params: CreateOrderParams): Promise<AlpacaOrder>;
}

/**
 * Parameters for creating a bracket order.
 */
export interface BracketOrderParams {
  /** Stock symbol */
  symbol: string;
  /** Number of shares */
  qty: number;
  /** Order side: buy or sell */
  side: OrderSide;
  /** Entry order type: market for immediate, limit for price-specific */
  type: 'market' | 'limit';
  /** Limit price for entry (required if type is 'limit') */
  limitPrice?: number;
  /** Take profit configuration */
  takeProfit: {
    /** Price at which to take profit */
    limitPrice: number;
  };
  /** Stop loss configuration */
  stopLoss: {
    /** Price at which to trigger stop */
    stopPrice: number;
    /** Optional limit price for stop-limit (if omitted, uses market stop) */
    limitPrice?: number;
  };
  /** Time in force: 'day' expires at market close, 'gtc' good till canceled */
  timeInForce?: TimeInForce;
  /** Enable extended hours trading */
  extendedHours?: boolean;
  /** Client-specified order ID for tracking */
  clientOrderId?: string;
}

/**
 * Result of a bracket order submission.
 */
export interface BracketOrderResult {
  /** The parent/entry order */
  entryOrder: AlpacaOrder;
  /** The take profit leg */
  takeProfitLeg: AlpacaOrder | null;
  /** The stop loss leg */
  stopLossLeg: AlpacaOrder | null;
  /** All legs combined */
  allOrders: AlpacaOrder[];
}

/**
 * Validates bracket order parameters.
 * @param params - The bracket order parameters to validate.
 * @throws Error if validation fails.
 */
function validateBracketOrderParams(params: BracketOrderParams): void {
  if (!params.symbol || params.symbol.trim() === '') {
    throw new Error('Symbol is required for bracket order');
  }

  if (!params.qty || params.qty <= 0) {
    throw new Error('Quantity must be a positive number');
  }

  if (params.type === 'limit' && (params.limitPrice === undefined || params.limitPrice <= 0)) {
    throw new Error('Limit price is required and must be positive for limit orders');
  }

  if (!params.takeProfit?.limitPrice || params.takeProfit.limitPrice <= 0) {
    throw new Error('Take profit limit price is required and must be positive');
  }

  if (!params.stopLoss?.stopPrice || params.stopLoss.stopPrice <= 0) {
    throw new Error('Stop loss stop price is required and must be positive');
  }

  // Validate price levels make sense based on side
  if (params.side === 'buy') {
    // For a buy order, take profit should be higher than entry, stop loss lower
    const entryPrice = params.limitPrice || params.takeProfit.limitPrice; // Use a reference price
    if (params.takeProfit.limitPrice <= params.stopLoss.stopPrice) {
      log('Warning: Take profit price should typically be higher than stop loss price for buy orders', { type: 'warn' });
    }
  } else {
    // For a sell order, take profit should be lower than entry, stop loss higher
    if (params.takeProfit.limitPrice >= params.stopLoss.stopPrice) {
      log('Warning: Take profit price should typically be lower than stop loss price for sell orders', { type: 'warn' });
    }
  }
}

/**
 * Rounds a price to the appropriate precision for Alpaca.
 * Uses 2 decimal places for prices >= $1, 4 decimal places for prices < $1.
 * @param price - The price to round.
 * @returns The rounded price as a string.
 */
function roundPriceForAlpaca(price: number): string {
  const rounded = price >= 1
    ? Math.round(price * 100) / 100
    : Math.round(price * 10000) / 10000;
  return rounded.toString();
}

/**
 * Create a bracket order (entry + take profit + stop loss).
 *
 * A bracket order ensures that when the entry fills:
 * - A take profit limit order is placed
 * - A stop loss order is placed
 * - If either TP or SL fills, the other is automatically canceled (OCO behavior)
 *
 * @param executor - The order executor (AlpacaTradingAPI or AlpacaClient)
 * @param params - The bracket order parameters
 * @returns The bracket order result containing entry and leg orders
 *
 * @example
 * ```typescript
 * const api = AlpacaTradingAPI.new(credentials);
 * const result = await createBracketOrder(
 *   { createOrder: (p) => api.makeRequest('/orders', 'POST', p) },
 *   {
 *     symbol: 'AAPL',
 *     qty: 100,
 *     side: 'buy',
 *     type: 'limit',
 *     limitPrice: 150.00,
 *     takeProfit: { limitPrice: 160.00 },
 *     stopLoss: { stopPrice: 145.00 },
 *     timeInForce: 'gtc',
 *   }
 * );
 * ```
 */
export async function createBracketOrder(
  executor: BracketOrderExecutor,
  params: BracketOrderParams
): Promise<BracketOrderResult> {
  log(`Creating bracket order: ${params.side} ${params.qty} ${params.symbol}`, { type: 'info' });
  log(`  Entry: ${params.type}${params.limitPrice ? ` @ $${params.limitPrice}` : ''}`, { type: 'debug' });
  log(`  Take Profit: $${params.takeProfit.limitPrice}`, { type: 'debug' });
  log(`  Stop Loss: $${params.stopLoss.stopPrice}${params.stopLoss.limitPrice ? ` (limit $${params.stopLoss.limitPrice})` : ''}`, { type: 'debug' });

  // Validate parameters
  validateBracketOrderParams(params);

  try {
    // Build the order parameters
    const orderParams: CreateOrderParams = {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: params.type,
      time_in_force: params.timeInForce || 'day',
      order_class: 'bracket',
      take_profit: {
        limit_price: roundPriceForAlpaca(params.takeProfit.limitPrice),
      },
      stop_loss: {
        stop_price: roundPriceForAlpaca(params.stopLoss.stopPrice),
        ...(params.stopLoss.limitPrice && {
          limit_price: roundPriceForAlpaca(params.stopLoss.limitPrice),
        }),
      },
    };

    // Add limit price for entry if it's a limit order
    if (params.type === 'limit' && params.limitPrice) {
      orderParams.limit_price = roundPriceForAlpaca(params.limitPrice);
    }

    // Add extended hours if specified
    if (params.extendedHours) {
      orderParams.extended_hours = true;
    }

    // Add client order ID if specified
    if (params.clientOrderId) {
      orderParams.client_order_id = params.clientOrderId;
    }

    // Execute the order
    const order = await executor.createOrder(orderParams);

    log(`Bracket order created successfully: ${order.id}`, { type: 'info' });
    log(`  Order status: ${order.status}`, { type: 'debug' });

    // Parse the legs from the response
    const legs = order.legs || [];

    // Find take profit leg - it's a limit order at the take profit price
    const takeProfitLeg = legs.find((leg: AlpacaOrder) =>
      leg.type === 'limit' &&
      parseFloat(leg.limit_price || '0') === params.takeProfit.limitPrice
    ) || null;

    // Find stop loss leg - it's a stop or stop_limit order
    const stopLossLeg = legs.find((leg: AlpacaOrder) =>
      leg.type === 'stop' || leg.type === 'stop_limit'
    ) || null;

    if (takeProfitLeg) {
      log(`  Take profit leg ID: ${takeProfitLeg.id}`, { type: 'debug' });
    }
    if (stopLossLeg) {
      log(`  Stop loss leg ID: ${stopLossLeg.id}`, { type: 'debug' });
    }

    return {
      entryOrder: order,
      takeProfitLeg,
      stopLossLeg,
      allOrders: [order, ...legs],
    };
  } catch (error) {
    const err = error as Error;
    log(`Bracket order failed: ${err.message}`, { type: 'error' });
    throw new Error(`Failed to create bracket order for ${params.symbol}: ${err.message}`);
  }
}

/**
 * Parameters for creating a protective bracket on an existing position.
 */
export interface ProtectiveBracketParams {
  /** Stock symbol */
  symbol: string;
  /** Number of shares to protect */
  qty: number;
  /** Side is always 'sell' to close a long position */
  side: 'sell';
  /** Take profit configuration */
  takeProfit: {
    /** Price at which to take profit */
    limitPrice: number;
  };
  /** Stop loss configuration */
  stopLoss: {
    /** Price at which to trigger stop */
    stopPrice: number;
    /** Optional limit price for stop-limit */
    limitPrice?: number;
  };
  /** Time in force: 'day' expires at market close, 'gtc' good till canceled */
  timeInForce?: TimeInForce;
}

/**
 * Create a bracket order for an existing position (protective bracket).
 * Useful for adding stop loss and take profit to a position that was entered without them.
 *
 * Note: This creates an OCO (One-Cancels-Other) order rather than a full bracket
 * because we already have the position - we just need the exit legs.
 *
 * @param executor - The order executor (AlpacaTradingAPI or AlpacaClient)
 * @param params - The protective bracket parameters
 * @returns The bracket order result
 *
 * @example
 * ```typescript
 * // Add protection to an existing long position
 * const result = await createProtectiveBracket(
 *   executor,
 *   {
 *     symbol: 'AAPL',
 *     qty: 100,
 *     side: 'sell',
 *     takeProfit: { limitPrice: 160.00 },
 *     stopLoss: { stopPrice: 145.00 },
 *     timeInForce: 'gtc',
 *   }
 * );
 * ```
 */
export async function createProtectiveBracket(
  executor: BracketOrderExecutor,
  params: ProtectiveBracketParams
): Promise<BracketOrderResult> {
  log(`Creating protective bracket for ${params.symbol}: ${params.qty} shares`, { type: 'info' });
  log(`  Take Profit: $${params.takeProfit.limitPrice}`, { type: 'debug' });
  log(`  Stop Loss: $${params.stopLoss.stopPrice}${params.stopLoss.limitPrice ? ` (limit $${params.stopLoss.limitPrice})` : ''}`, { type: 'debug' });

  // Validate parameters
  if (!params.symbol || params.symbol.trim() === '') {
    throw new Error('Symbol is required for protective bracket');
  }

  if (!params.qty || params.qty <= 0) {
    throw new Error('Quantity must be a positive number');
  }

  if (!params.takeProfit?.limitPrice || params.takeProfit.limitPrice <= 0) {
    throw new Error('Take profit limit price is required and must be positive');
  }

  if (!params.stopLoss?.stopPrice || params.stopLoss.stopPrice <= 0) {
    throw new Error('Stop loss stop price is required and must be positive');
  }

  // For a protective sell bracket, take profit should be higher than stop loss
  if (params.takeProfit.limitPrice <= params.stopLoss.stopPrice) {
    log('Warning: Take profit price should be higher than stop loss price for protective sell bracket', { type: 'warn' });
  }

  try {
    // Build the OCO order parameters
    const orderParams: CreateOrderParams = {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: 'limit', // Primary leg is a limit order (take profit)
      time_in_force: params.timeInForce || 'gtc',
      order_class: 'oco',
      limit_price: roundPriceForAlpaca(params.takeProfit.limitPrice),
      stop_loss: {
        stop_price: roundPriceForAlpaca(params.stopLoss.stopPrice),
        ...(params.stopLoss.limitPrice && {
          limit_price: roundPriceForAlpaca(params.stopLoss.limitPrice),
        }),
      },
    };

    // Execute the order
    const order = await executor.createOrder(orderParams);

    log(`Protective bracket created successfully: ${order.id}`, { type: 'info' });

    // Parse the legs from the response
    const legs = order.legs || [];

    // The primary order is the take profit (limit order)
    const takeProfitLeg = order;

    // Find stop loss leg
    const stopLossLeg = legs.find((leg: AlpacaOrder) =>
      leg.type === 'stop' || leg.type === 'stop_limit'
    ) || null;

    return {
      entryOrder: order,
      takeProfitLeg,
      stopLossLeg,
      allOrders: [order, ...legs],
    };
  } catch (error) {
    const err = error as Error;
    log(`Protective bracket failed: ${err.message}`, { type: 'error' });
    throw new Error(`Failed to create protective bracket for ${params.symbol}: ${err.message}`);
  }
}

/**
 * Creates an adapter to use AlpacaTradingAPI as a BracketOrderExecutor.
 *
 * @param api - Instance of AlpacaTradingAPI
 * @returns BracketOrderExecutor compatible with bracket order functions
 *
 * @example
 * ```typescript
 * const api = AlpacaTradingAPI.new(credentials);
 * const executor = createExecutorFromTradingAPI(api);
 * const result = await createBracketOrder(executor, params);
 * ```
 */
export function createExecutorFromTradingAPI(api: {
  makeRequest: (endpoint: string, method: string, body?: unknown) => Promise<AlpacaOrder>;
}): BracketOrderExecutor {
  return {
    createOrder: async (params: CreateOrderParams): Promise<AlpacaOrder> => {
      return api.makeRequest('/orders', 'POST', params);
    },
  };
}

export default {
  createBracketOrder,
  createProtectiveBracket,
  createExecutorFromTradingAPI,
};
