/**
 * OTO (One-Triggers-Other) Order Module
 *
 * OTO orders consist of a primary order and a dependent order. When the primary
 * order fills, it automatically triggers the dependent order. This is commonly
 * used for:
 * - Entry orders that automatically set up a stop loss
 * - Entry orders that automatically set up a take profit
 * - Automatic position management after entry
 *
 * Unlike bracket orders, OTO only has one dependent order (not two).
 *
 * @module oto-orders
 */

import { AlpacaClient } from '../client';
import { AlpacaOrder, OrderSide, OrderType, TimeInForce } from '../../types/alpaca-types';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'OTOOrders' });
};

/**
 * Dependent order type options for OTO orders
 */
export type DependentOrderType = 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';

/**
 * Configuration for the dependent order in an OTO
 */
export interface DependentOrderConfig {
  /** Side of the dependent order */
  side: OrderSide;
  /** Type of the dependent order */
  type: DependentOrderType;
  /** Limit price (required for 'limit' and 'stop_limit' types) */
  limitPrice?: number;
  /** Stop price (required for 'stop' and 'stop_limit' types) */
  stopPrice?: number;
  /** Trail percent for trailing stop orders (e.g., 5 for 5%) */
  trailPercent?: number;
  /** Trail price for trailing stop orders (absolute dollar amount) */
  trailPrice?: number;
}

/**
 * OTO Order Parameters
 * Primary order triggers secondary order on fill.
 *
 * @example
 * // Buy 100 shares with automatic trailing stop on fill
 * const params: OTOOrderParams = {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'buy',
 *   type: 'limit',
 *   limitPrice: 150.00,
 *   dependent: {
 *     side: 'sell',
 *     type: 'trailing_stop',
 *     trailPercent: 5
 *   },
 *   timeInForce: 'gtc'
 * };
 */
export interface OTOOrderParams {
  /** Symbol of the asset to trade */
  symbol: string;
  /** Quantity of shares to trade */
  qty: number;
  /** Side of the primary order */
  side: OrderSide;
  /** Type of the primary order */
  type: OrderType;
  /** Limit price for primary order (required for 'limit' and 'stop_limit') */
  limitPrice?: number;
  /** Stop price for primary order (required for 'stop' and 'stop_limit') */
  stopPrice?: number;
  /** Configuration for the dependent order that triggers on primary fill */
  dependent: DependentOrderConfig;
  /** Time in force for orders (default: 'day') */
  timeInForce?: TimeInForce;
  /** Allow extended hours trading */
  extendedHours?: boolean;
  /** Client-specified order ID for tracking */
  clientOrderId?: string;
}

/**
 * Result of OTO order creation
 */
export interface OTOOrderResult {
  /** The primary (entry) order */
  primaryOrder: AlpacaOrder;
  /** The dependent order (will be triggered when primary fills) - null until triggered */
  dependentOrder: AlpacaOrder | null;
  /** All orders in the OTO group */
  allOrders: AlpacaOrder[];
  /** Parent order ID (can be used for cancellation and tracking) */
  parentOrderId: string;
}

/**
 * Round a price to the nearest 2 decimal places for Alpaca,
 * or 4 decimal places for prices less than $1
 */
function roundPriceForAlpaca(price: number): number {
  return price >= 1 ? Math.round(price * 100) / 100 : Math.round(price * 10000) / 10000;
}

/**
 * Validate OTO order parameters
 * @throws Error if parameters are invalid
 */
function validateOTOParams(params: OTOOrderParams): void {
  if (!params.symbol || params.symbol.trim() === '') {
    throw new Error('OTO order requires a valid symbol');
  }

  if (!params.qty || params.qty <= 0) {
    throw new Error('OTO order requires a positive quantity');
  }

  if (!Number.isInteger(params.qty)) {
    throw new Error('OTO order quantity must be a whole number');
  }

  // Validate primary order type requirements
  if (params.type === 'limit' || params.type === 'stop_limit') {
    if (!params.limitPrice || params.limitPrice <= 0) {
      throw new Error(`Primary ${params.type} order requires a positive limitPrice`);
    }
  }

  if (params.type === 'stop' || params.type === 'stop_limit') {
    if (!params.stopPrice || params.stopPrice <= 0) {
      throw new Error(`Primary ${params.type} order requires a positive stopPrice`);
    }
  }

  // Validate dependent order
  if (!params.dependent) {
    throw new Error('OTO order requires a dependent order configuration');
  }

  const { dependent } = params;

  // Validate dependent order type requirements
  if (dependent.type === 'limit' || dependent.type === 'stop_limit') {
    if (!dependent.limitPrice || dependent.limitPrice <= 0) {
      throw new Error(`Dependent ${dependent.type} order requires a positive limitPrice`);
    }
  }

  if (dependent.type === 'stop' || dependent.type === 'stop_limit') {
    if (!dependent.stopPrice || dependent.stopPrice <= 0) {
      throw new Error(`Dependent ${dependent.type} order requires a positive stopPrice`);
    }
  }

  if (dependent.type === 'trailing_stop') {
    if (!dependent.trailPercent && !dependent.trailPrice) {
      throw new Error('Trailing stop requires either trailPercent or trailPrice');
    }
    if (dependent.trailPercent && dependent.trailPrice) {
      throw new Error('Trailing stop cannot have both trailPercent and trailPrice');
    }
    if (dependent.trailPercent && (dependent.trailPercent <= 0 || dependent.trailPercent > 100)) {
      throw new Error('trailPercent must be between 0 and 100');
    }
    if (dependent.trailPrice && dependent.trailPrice <= 0) {
      throw new Error('trailPrice must be positive');
    }
  }

  // Validate logical order of sides for typical use cases
  // Primary buy should typically trigger sell (exit), and vice versa
  if (params.side === dependent.side) {
    log(
      `Warning: Primary and dependent orders have the same side (${params.side}). ` +
      'This is unusual - typically entry and exit are opposite sides.',
      { symbol: params.symbol, type: 'warn' }
    );
  }
}

/**
 * Create an OTO order (entry triggers exit)
 *
 * Useful for setting up automatic exit orders when an entry fills.
 * The dependent order remains dormant until the primary order fills.
 *
 * @param client - AlpacaClient instance
 * @param params - OTO order parameters
 * @returns OTO order result with primary and dependent orders
 *
 * @example
 * // Buy entry with automatic stop loss
 * const result = await createOTOOrder(client, {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'buy',
 *   type: 'limit',
 *   limitPrice: 150.00,
 *   dependent: {
 *     side: 'sell',
 *     type: 'stop',
 *     stopPrice: 145.00
 *   },
 *   timeInForce: 'gtc'
 * });
 *
 * @example
 * // Market entry with automatic trailing stop
 * const result = await createOTOOrder(client, {
 *   symbol: 'TSLA',
 *   qty: 50,
 *   side: 'buy',
 *   type: 'market',
 *   dependent: {
 *     side: 'sell',
 *     type: 'trailing_stop',
 *     trailPercent: 3 // 3% trailing stop
 *   }
 * });
 *
 * @example
 * // Limit entry with take profit limit order
 * const result = await createOTOOrder(client, {
 *   symbol: 'NVDA',
 *   qty: 25,
 *   side: 'buy',
 *   type: 'limit',
 *   limitPrice: 400.00,
 *   dependent: {
 *     side: 'sell',
 *     type: 'limit',
 *     limitPrice: 440.00 // Take profit at 10% gain
 *   },
 *   timeInForce: 'gtc'
 * });
 *
 * @example
 * // Short entry with stop-limit protection
 * const result = await createOTOOrder(client, {
 *   symbol: 'GOOGL',
 *   qty: 10,
 *   side: 'sell',
 *   type: 'limit',
 *   limitPrice: 140.00,
 *   dependent: {
 *     side: 'buy',
 *     type: 'stop_limit',
 *     stopPrice: 145.00,
 *     limitPrice: 146.00
 *   },
 *   timeInForce: 'gtc'
 * });
 */
export async function createOTOOrder(
  client: AlpacaClient,
  params: OTOOrderParams
): Promise<OTOOrderResult> {
  // Validate parameters
  validateOTOParams(params);

  const {
    symbol,
    qty,
    side,
    type,
    limitPrice,
    stopPrice,
    dependent,
    timeInForce = 'day',
    extendedHours,
    clientOrderId,
  } = params;

  // Build log message
  let primaryDescription = `${type} ${side} ${qty} shares`;
  if (limitPrice) primaryDescription += ` at $${limitPrice.toFixed(2)}`;
  if (stopPrice) primaryDescription += ` stop $${stopPrice.toFixed(2)}`;

  let dependentDescription = `${dependent.type} ${dependent.side}`;
  if (dependent.limitPrice) dependentDescription += ` at $${dependent.limitPrice.toFixed(2)}`;
  if (dependent.stopPrice) dependentDescription += ` stop $${dependent.stopPrice.toFixed(2)}`;
  if (dependent.trailPercent) dependentDescription += ` trail ${dependent.trailPercent}%`;
  if (dependent.trailPrice) dependentDescription += ` trail $${dependent.trailPrice.toFixed(2)}`;

  log(
    `Creating OTO order for ${symbol}: Primary [${primaryDescription}] -> Dependent [${dependentDescription}]`,
    { symbol, type: 'info' }
  );

  const sdk = client.getSDK();

  try {
    // Build the OTO order request
    const orderRequest: Record<string, unknown> = {
      symbol,
      qty: qty.toString(),
      side,
      type,
      time_in_force: timeInForce,
      order_class: 'oto',
    };

    // Add primary order prices
    if (limitPrice !== undefined) {
      orderRequest.limit_price = roundPriceForAlpaca(limitPrice).toString();
    }
    if (stopPrice !== undefined) {
      orderRequest.stop_price = roundPriceForAlpaca(stopPrice).toString();
    }

    // Add extended hours if specified
    if (extendedHours) {
      orderRequest.extended_hours = true;
    }

    // Add client order ID if specified
    if (clientOrderId) {
      orderRequest.client_order_id = clientOrderId;
    }

    // Build dependent order based on type
    // For OTO orders, Alpaca uses take_profit or stop_loss object
    // We need to determine which one based on the dependent order configuration
    if (dependent.type === 'limit') {
      // Take profit order
      orderRequest.take_profit = {
        limit_price: roundPriceForAlpaca(dependent.limitPrice!).toString(),
      };
    } else if (dependent.type === 'stop') {
      // Stop loss order (market)
      orderRequest.stop_loss = {
        stop_price: roundPriceForAlpaca(dependent.stopPrice!).toString(),
      };
    } else if (dependent.type === 'stop_limit') {
      // Stop loss order with limit
      orderRequest.stop_loss = {
        stop_price: roundPriceForAlpaca(dependent.stopPrice!).toString(),
        limit_price: roundPriceForAlpaca(dependent.limitPrice!).toString(),
      };
    } else if (dependent.type === 'trailing_stop') {
      // Trailing stop order
      orderRequest.stop_loss = {};
      if (dependent.trailPercent !== undefined) {
        orderRequest.stop_loss.trail_percent = dependent.trailPercent.toString();
      }
      if (dependent.trailPrice !== undefined) {
        orderRequest.stop_loss.trail_price = roundPriceForAlpaca(dependent.trailPrice).toString();
      }
    }

    log(
      `Submitting OTO order request: ${JSON.stringify(orderRequest)}`,
      { symbol, type: 'debug' }
    );

    // Submit the order
    const order = await sdk.createOrder(orderRequest) as AlpacaOrder;

    // Extract leg orders from the response
    const legs = order.legs || [];

    // The primary order is the parent, dependent is in legs
    const primaryOrder = order;
    const dependentOrder = legs.length > 0 ? legs[0] : null;

    log(
      `OTO order created successfully | Parent ID: ${order.id} | Status: ${order.status}` +
      (dependentOrder ? ` | Dependent ID: ${dependentOrder.id}` : ''),
      { symbol, type: 'info' }
    );

    return {
      primaryOrder,
      dependentOrder,
      allOrders: [order, ...(dependentOrder ? [dependentOrder] : [])],
      parentOrderId: order.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(
      `Failed to create OTO order for ${symbol}: ${errorMessage}`,
      { symbol, type: 'error' }
    );
    throw error;
  }
}

/**
 * Cancel an OTO order group by parent order ID
 * This will cancel both the primary order and any pending dependent order
 *
 * @param client - AlpacaClient instance
 * @param parentOrderId - The parent order ID from OTOOrderResult
 *
 * @example
 * const result = await createOTOOrder(client, params);
 * // Later, before primary fills...
 * await cancelOTOOrder(client, result.parentOrderId);
 */
export async function cancelOTOOrder(
  client: AlpacaClient,
  parentOrderId: string
): Promise<void> {
  log(`Canceling OTO order group: ${parentOrderId}`, { type: 'info' });

  const sdk = client.getSDK();

  try {
    await sdk.cancelOrder(parentOrderId);
    log(`OTO order group canceled successfully: ${parentOrderId}`, { type: 'info' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to cancel OTO order ${parentOrderId}: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get the status of an OTO order group
 *
 * @param client - AlpacaClient instance
 * @param parentOrderId - The parent order ID from OTOOrderResult
 * @returns The parent order with dependent order information
 *
 * @example
 * const result = await createOTOOrder(client, params);
 * const status = await getOTOOrderStatus(client, result.parentOrderId);
 * console.log('Primary status:', status.status);
 * if (status.legs && status.legs[0]) {
 *   console.log('Dependent status:', status.legs[0].status);
 * }
 */
export async function getOTOOrderStatus(
  client: AlpacaClient,
  parentOrderId: string
): Promise<AlpacaOrder> {
  log(`Getting OTO order status: ${parentOrderId}`, { type: 'debug' });

  const sdk = client.getSDK();

  try {
    const order = await sdk.getOrder(parentOrderId) as AlpacaOrder;
    log(
      `OTO order ${parentOrderId} status: ${order.status} | ` +
      `Legs: ${order.legs?.length || 0}`,
      { type: 'debug' }
    );
    return order;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to get OTO order status ${parentOrderId}: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Create a market buy with automatic stop loss
 * Convenience wrapper for common use case
 *
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param qty - Number of shares
 * @param stopLossPrice - Stop loss trigger price
 * @param stopLimitPrice - Optional limit price for stop-limit
 *
 * @example
 * // Buy AAPL with immediate stop loss protection
 * const result = await buyWithStopLoss(client, 'AAPL', 100, 145.00);
 */
export async function buyWithStopLoss(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  stopLossPrice: number,
  stopLimitPrice?: number
): Promise<OTOOrderResult> {
  return createOTOOrder(client, {
    symbol,
    qty,
    side: 'buy',
    type: 'market',
    dependent: {
      side: 'sell',
      type: stopLimitPrice ? 'stop_limit' : 'stop',
      stopPrice: stopLossPrice,
      limitPrice: stopLimitPrice,
    },
    timeInForce: 'day',
  });
}

/**
 * Create a market buy with automatic trailing stop
 * Convenience wrapper for common use case
 *
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param qty - Number of shares
 * @param trailPercent - Trail percentage (e.g., 5 for 5%)
 *
 * @example
 * // Buy TSLA with 3% trailing stop
 * const result = await buyWithTrailingStop(client, 'TSLA', 50, 3);
 */
export async function buyWithTrailingStop(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  trailPercent: number
): Promise<OTOOrderResult> {
  return createOTOOrder(client, {
    symbol,
    qty,
    side: 'buy',
    type: 'market',
    dependent: {
      side: 'sell',
      type: 'trailing_stop',
      trailPercent,
    },
    timeInForce: 'day',
  });
}

/**
 * Create a limit buy with automatic take profit
 * Convenience wrapper for limit entry with profit target
 *
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param qty - Number of shares
 * @param entryPrice - Limit price for entry
 * @param takeProfitPrice - Take profit limit price
 *
 * @example
 * // Buy NVDA at $400 with take profit at $440
 * const result = await limitBuyWithTakeProfit(client, 'NVDA', 25, 400.00, 440.00);
 */
export async function limitBuyWithTakeProfit(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  entryPrice: number,
  takeProfitPrice: number
): Promise<OTOOrderResult> {
  return createOTOOrder(client, {
    symbol,
    qty,
    side: 'buy',
    type: 'limit',
    limitPrice: entryPrice,
    dependent: {
      side: 'sell',
      type: 'limit',
      limitPrice: takeProfitPrice,
    },
    timeInForce: 'gtc',
  });
}

/**
 * Create a short entry with automatic stop loss
 * Convenience wrapper for short selling with protection
 *
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param qty - Number of shares
 * @param entryPrice - Limit price for short entry
 * @param stopLossPrice - Stop loss trigger price (higher than entry)
 *
 * @example
 * // Short GOOGL at $140 with stop at $145
 * const result = await shortWithStopLoss(client, 'GOOGL', 10, 140.00, 145.00);
 */
export async function shortWithStopLoss(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  entryPrice: number,
  stopLossPrice: number
): Promise<OTOOrderResult> {
  return createOTOOrder(client, {
    symbol,
    qty,
    side: 'sell',
    type: 'limit',
    limitPrice: entryPrice,
    dependent: {
      side: 'buy',
      type: 'stop',
      stopPrice: stopLossPrice,
    },
    timeInForce: 'gtc',
  });
}

/**
 * Create entry with automatic stop loss using percentage
 * Calculates stop price based on entry price and percentage
 *
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param qty - Number of shares
 * @param entryPrice - Limit price for entry (null for market)
 * @param stopLossPercent - Stop loss percentage (e.g., 5 for 5%)
 * @param side - Order side ('buy' or 'sell')
 *
 * @example
 * // Buy AAPL at $150 with 3% stop loss (stop at $145.50)
 * const result = await entryWithPercentStopLoss(client, 'AAPL', 100, 150.00, 3, 'buy');
 */
export async function entryWithPercentStopLoss(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  entryPrice: number | null,
  stopLossPercent: number,
  side: OrderSide = 'buy'
): Promise<OTOOrderResult> {
  if (stopLossPercent <= 0 || stopLossPercent >= 100) {
    throw new Error('stopLossPercent must be between 0 and 100');
  }

  // For market orders without entry price, we cannot calculate stop
  if (entryPrice === null) {
    throw new Error('Entry price required to calculate percentage-based stop loss. Use buyWithStopLoss for market orders.');
  }

  // Calculate stop price based on side
  const stopMultiplier = side === 'buy'
    ? (1 - stopLossPercent / 100)  // Below entry for longs
    : (1 + stopLossPercent / 100); // Above entry for shorts
  const stopPrice = roundPriceForAlpaca(entryPrice * stopMultiplier);

  const exitSide: OrderSide = side === 'buy' ? 'sell' : 'buy';

  return createOTOOrder(client, {
    symbol,
    qty,
    side,
    type: 'limit',
    limitPrice: entryPrice,
    dependent: {
      side: exitSide,
      type: 'stop',
      stopPrice,
    },
    timeInForce: 'gtc',
  });
}

export default {
  createOTOOrder,
  cancelOTOOrder,
  getOTOOrderStatus,
  buyWithStopLoss,
  buyWithTrailingStop,
  limitBuyWithTakeProfit,
  shortWithStopLoss,
  entryWithPercentStopLoss,
};
