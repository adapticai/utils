/**
 * OCO (One-Cancels-Other) Order Module
 *
 * OCO orders consist of two orders where filling one automatically cancels the other.
 * This is commonly used for protective strategies where you want to either:
 * - Take profit at a target price, OR
 * - Stop loss at a predetermined level
 *
 * When either order fills, Alpaca automatically cancels the other order.
 *
 * @module oco-orders
 */

import { AlpacaClient } from '../client';
import { AlpacaOrder, OrderSide, TimeInForce } from '../../types/alpaca-types';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'OCOOrders' });
};

/**
 * OCO Order Parameters
 * Creates two orders where filling one cancels the other.
 *
 * @example
 * // Protect a long position with take profit at $150 OR stop loss at $130
 * const params: OCOOrderParams = {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'sell', // Selling to close long position
 *   takeProfit: {
 *     limitPrice: 150.00
 *   },
 *   stopLoss: {
 *     stopPrice: 130.00,
 *     limitPrice: 129.50 // Optional: creates stop-limit instead of stop
 *   },
 *   timeInForce: 'gtc'
 * };
 */
export interface OCOOrderParams {
  /** Symbol of the asset to trade */
  symbol: string;
  /** Quantity of shares to trade */
  qty: number;
  /** Order side - typically 'sell' for protecting long positions, 'buy' for short */
  side: OrderSide;
  /** Take profit limit order configuration */
  takeProfit: {
    /** Limit price for take profit order */
    limitPrice: number;
  };
  /** Stop loss order configuration */
  stopLoss: {
    /** Stop trigger price */
    stopPrice: number;
    /** Optional limit price - if provided, creates stop-limit instead of stop market */
    limitPrice?: number;
  };
  /** Time in force for both orders (default: 'gtc') */
  timeInForce?: TimeInForce;
}

/**
 * Result of OCO order creation
 * Contains both leg orders and helper accessors
 */
export interface OCOOrderResult {
  /** The take profit limit order */
  takeProfitOrder: AlpacaOrder;
  /** The stop loss order */
  stopLossOrder: AlpacaOrder;
  /** All orders in the OCO group */
  allOrders: AlpacaOrder[];
  /** Parent order ID (can be used for cancellation) */
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
 * Validate OCO order parameters
 * @throws Error if parameters are invalid
 */
function validateOCOParams(params: OCOOrderParams): void {
  if (!params.symbol || params.symbol.trim() === '') {
    throw new Error('OCO order requires a valid symbol');
  }

  if (!params.qty || params.qty <= 0) {
    throw new Error('OCO order requires a positive quantity');
  }

  if (!Number.isInteger(params.qty)) {
    throw new Error('OCO order quantity must be a whole number');
  }

  if (!params.takeProfit || !params.takeProfit.limitPrice) {
    throw new Error('OCO order requires takeProfit with limitPrice');
  }

  if (params.takeProfit.limitPrice <= 0) {
    throw new Error('Take profit limitPrice must be positive');
  }

  if (!params.stopLoss || !params.stopLoss.stopPrice) {
    throw new Error('OCO order requires stopLoss with stopPrice');
  }

  if (params.stopLoss.stopPrice <= 0) {
    throw new Error('Stop loss stopPrice must be positive');
  }

  if (params.stopLoss.limitPrice !== undefined && params.stopLoss.limitPrice <= 0) {
    throw new Error('Stop loss limitPrice must be positive if provided');
  }

  // Validate price logic based on side
  if (params.side === 'sell') {
    // For sell orders (closing long): take profit should be higher than stop
    if (params.takeProfit.limitPrice <= params.stopLoss.stopPrice) {
      throw new Error(
        'For sell OCO orders, take profit limit price must be higher than stop loss price'
      );
    }
  } else {
    // For buy orders (closing short): take profit should be lower than stop
    if (params.takeProfit.limitPrice >= params.stopLoss.stopPrice) {
      throw new Error(
        'For buy OCO orders, take profit limit price must be lower than stop loss price'
      );
    }
  }
}

/**
 * Create an OCO order (take profit OR stop loss)
 *
 * Use this to protect an existing position with automatic cancellation
 * of the remaining order when one fills.
 *
 * @param client - AlpacaClient instance
 * @param params - OCO order parameters
 * @returns OCO order result with both leg orders
 *
 * @example
 * // Protect 100 shares of AAPL long position
 * // Take profit at $155, stop loss at $145
 * const result = await createOCOOrder(client, {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'sell',
 *   takeProfit: { limitPrice: 155.00 },
 *   stopLoss: { stopPrice: 145.00 },
 *   timeInForce: 'gtc'
 * });
 *
 * console.log('Take profit order:', result.takeProfitOrder.id);
 * console.log('Stop loss order:', result.stopLossOrder.id);
 *
 * @example
 * // Use stop-limit instead of stop-market for stop loss
 * const result = await createOCOOrder(client, {
 *   symbol: 'TSLA',
 *   qty: 50,
 *   side: 'sell',
 *   takeProfit: { limitPrice: 280.00 },
 *   stopLoss: {
 *     stopPrice: 240.00,
 *     limitPrice: 238.00 // Limit price for stop-limit order
 *   },
 *   timeInForce: 'gtc'
 * });
 *
 * @example
 * // Protect a short position (buying to close)
 * const result = await createOCOOrder(client, {
 *   symbol: 'NVDA',
 *   qty: 25,
 *   side: 'buy', // Buy to close short
 *   takeProfit: { limitPrice: 380.00 }, // Take profit at lower price
 *   stopLoss: { stopPrice: 420.00 }, // Stop loss at higher price
 *   timeInForce: 'gtc'
 * });
 */
export async function createOCOOrder(
  client: AlpacaClient,
  params: OCOOrderParams
): Promise<OCOOrderResult> {
  // Validate parameters
  validateOCOParams(params);

  const { symbol, qty, side, takeProfit, stopLoss, timeInForce = 'gtc' } = params;

  log(
    `Creating OCO order for ${symbol}: ${side} ${qty} shares | ` +
    `Take profit at $${takeProfit.limitPrice.toFixed(2)} | ` +
    `Stop loss at $${stopLoss.stopPrice.toFixed(2)}` +
    (stopLoss.limitPrice ? ` (limit: $${stopLoss.limitPrice.toFixed(2)})` : ''),
    { symbol, type: 'info' }
  );

  const sdk = client.getSDK();

  try {
    // Build the OCO order request
    const orderRequest: Record<string, unknown> = {
      symbol,
      qty: qty.toString(),
      side,
      type: 'limit', // Primary order is the take profit limit
      time_in_force: timeInForce,
      order_class: 'oco',
      limit_price: roundPriceForAlpaca(takeProfit.limitPrice).toString(),
      stop_loss: {
        stop_price: roundPriceForAlpaca(stopLoss.stopPrice).toString(),
      },
    };

    // Add stop-limit price if provided
    if (stopLoss.limitPrice !== undefined) {
      orderRequest.stop_loss.limit_price = roundPriceForAlpaca(stopLoss.limitPrice).toString();
    }

    log(
      `Submitting OCO order request: ${JSON.stringify(orderRequest)}`,
      { symbol, type: 'debug' }
    );

    // Submit the order
    const order = await sdk.createOrder(orderRequest) as AlpacaOrder;

    // Extract leg orders from the response
    const legs = order.legs || [];

    if (legs.length < 2) {
      log(
        `OCO order created but legs not found in response. Order ID: ${order.id}`,
        { symbol, type: 'warn' }
      );
    }

    // Identify take profit and stop loss orders from legs
    // Take profit is the limit order, stop loss is the stop/stop_limit order
    const takeProfitOrder = legs.find(
      (leg) => leg.type === 'limit'
    ) || order;

    const stopLossOrder = legs.find(
      (leg) => leg.type === 'stop' || leg.type === 'stop_limit'
    ) || legs.find((leg) => leg !== takeProfitOrder) || order;

    log(
      `OCO order created successfully | Parent ID: ${order.id} | ` +
      `Take profit ID: ${takeProfitOrder.id} | Stop loss ID: ${stopLossOrder.id}`,
      { symbol, type: 'info' }
    );

    return {
      takeProfitOrder,
      stopLossOrder,
      allOrders: legs.length > 0 ? legs : [order],
      parentOrderId: order.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(
      `Failed to create OCO order for ${symbol}: ${errorMessage}`,
      { symbol, type: 'error' }
    );
    throw error;
  }
}

/**
 * Cancel an OCO order group by parent order ID
 * This will cancel both the take profit and stop loss orders
 *
 * @param client - AlpacaClient instance
 * @param parentOrderId - The parent order ID from OCOOrderResult
 *
 * @example
 * const result = await createOCOOrder(client, params);
 * // Later...
 * await cancelOCOOrder(client, result.parentOrderId);
 */
export async function cancelOCOOrder(
  client: AlpacaClient,
  parentOrderId: string
): Promise<void> {
  log(`Canceling OCO order group: ${parentOrderId}`, { type: 'info' });

  const sdk = client.getSDK();

  try {
    await sdk.cancelOrder(parentOrderId);
    log(`OCO order group canceled successfully: ${parentOrderId}`, { type: 'info' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to cancel OCO order ${parentOrderId}: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get the status of an OCO order group
 *
 * @param client - AlpacaClient instance
 * @param parentOrderId - The parent order ID from OCOOrderResult
 * @returns The parent order with leg status information
 *
 * @example
 * const result = await createOCOOrder(client, params);
 * const status = await getOCOOrderStatus(client, result.parentOrderId);
 * console.log('Order status:', status.status);
 * status.legs?.forEach(leg => {
 *   console.log(`Leg ${leg.id}: ${leg.status}`);
 * });
 */
export async function getOCOOrderStatus(
  client: AlpacaClient,
  parentOrderId: string
): Promise<AlpacaOrder> {
  log(`Getting OCO order status: ${parentOrderId}`, { type: 'debug' });

  const sdk = client.getSDK();

  try {
    const order = await sdk.getOrder(parentOrderId) as AlpacaOrder;
    log(
      `OCO order ${parentOrderId} status: ${order.status} | ` +
      `Legs: ${order.legs?.length || 0}`,
      { type: 'debug' }
    );
    return order;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to get OCO order status ${parentOrderId}: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Helper to create OCO order for protecting a long position
 * Convenience wrapper with sensible defaults for long protection
 *
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param qty - Number of shares to protect
 * @param takeProfitPrice - Price to take profit
 * @param stopLossPrice - Price to stop loss
 * @param stopLimitPrice - Optional limit price for stop-limit order
 *
 * @example
 * // Simple long protection
 * const result = await protectLongPosition(
 *   client,
 *   'AAPL',
 *   100,
 *   155.00, // Take profit
 *   145.00  // Stop loss
 * );
 */
export async function protectLongPosition(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  takeProfitPrice: number,
  stopLossPrice: number,
  stopLimitPrice?: number
): Promise<OCOOrderResult> {
  return createOCOOrder(client, {
    symbol,
    qty,
    side: 'sell',
    takeProfit: { limitPrice: takeProfitPrice },
    stopLoss: {
      stopPrice: stopLossPrice,
      limitPrice: stopLimitPrice,
    },
    timeInForce: 'gtc',
  });
}

/**
 * Helper to create OCO order for protecting a short position
 * Convenience wrapper with sensible defaults for short protection
 *
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param qty - Number of shares to cover
 * @param takeProfitPrice - Price to take profit (lower than current)
 * @param stopLossPrice - Price to stop loss (higher than current)
 * @param stopLimitPrice - Optional limit price for stop-limit order
 *
 * @example
 * // Simple short protection
 * const result = await protectShortPosition(
 *   client,
 *   'TSLA',
 *   50,
 *   200.00, // Take profit at lower price
 *   260.00  // Stop loss at higher price
 * );
 */
export async function protectShortPosition(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  takeProfitPrice: number,
  stopLossPrice: number,
  stopLimitPrice?: number
): Promise<OCOOrderResult> {
  return createOCOOrder(client, {
    symbol,
    qty,
    side: 'buy',
    takeProfit: { limitPrice: takeProfitPrice },
    stopLoss: {
      stopPrice: stopLossPrice,
      limitPrice: stopLimitPrice,
    },
    timeInForce: 'gtc',
  });
}

export default {
  createOCOOrder,
  cancelOCOOrder,
  getOCOOrderStatus,
  protectLongPosition,
  protectShortPosition,
};
