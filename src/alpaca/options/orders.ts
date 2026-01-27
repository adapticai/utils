/**
 * Options Orders Module
 * Create and manage option orders
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  AlpacaOrder,
  AlpacaPosition,
  PositionIntent,
  TimeInForce,
  CreateMultiLegOrderParams,
  OrderLeg,
  OrderStatus,
} from '../../types/alpaca-types';

const LOG_SOURCE = 'OptionsOrders';

/**
 * Internal logging helper with consistent source
 */
const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: LOG_SOURCE });
};

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters for creating a single-leg option order
 */
export interface SingleLegOptionOrderParams {
  /** Option contract symbol (e.g., AAPL230120C00150000) */
  symbol: string;
  /** Number of contracts to trade */
  qty: number;
  /** Order side: buy or sell */
  side: 'buy' | 'sell';
  /** Order type: market or limit */
  type: 'market' | 'limit';
  /** Limit price for limit orders (price per share, not per contract) */
  limitPrice?: number;
  /** Position intent: indicates opening or closing a position */
  positionIntent: PositionIntent;
  /** Time in force: day, gtc, ioc, fok, opg, cls */
  timeInForce?: TimeInForce;
  /** Optional client order ID for tracking */
  clientOrderId?: string;
}

/**
 * Parameters for closing an option position
 */
export interface CloseOptionPositionParams {
  /** Specific quantity to close (defaults to full position) */
  qty?: number;
  /** Limit price for limit order close */
  limitPrice?: number;
  /** Time in force for the close order */
  timeInForce?: TimeInForce;
}

/**
 * Result of closing all option positions
 */
export interface CloseAllOptionsResult {
  /** Orders created for closing positions */
  orders: AlpacaOrder[];
  /** Positions that failed to close */
  failed: { symbol: string; error: string }[];
  /** Total number of positions processed */
  totalProcessed: number;
}

/**
 * Parameters for exercising an option
 */
export interface ExerciseOptionParams {
  /** Option contract symbol */
  symbol: string;
  /** Number of contracts to exercise (defaults to full position) */
  qty?: number;
}

/**
 * Multi-leg order validation result
 */
export interface MultiLegValidationResult {
  /** Whether the order is valid */
  isValid: boolean;
  /** Validation errors if any */
  errors: string[];
  /** Validation warnings if any */
  warnings: string[];
}

// ============================================================================
// Single-Leg Option Orders
// ============================================================================

/**
 * Create a single-leg option order
 *
 * @param client - The AlpacaClient instance
 * @param params - Order parameters
 * @returns The created order
 * @throws Error if order creation fails
 *
 * @example
 * // Buy to open 5 call contracts
 * const order = await createOptionOrder(client, {
 *   symbol: 'AAPL230120C00150000',
 *   qty: 5,
 *   side: 'buy',
 *   type: 'limit',
 *   limitPrice: 2.50,
 *   positionIntent: 'buy_to_open',
 *   timeInForce: 'day',
 * });
 *
 * @example
 * // Sell to close with market order
 * const order = await createOptionOrder(client, {
 *   symbol: 'AAPL230120C00150000',
 *   qty: 5,
 *   side: 'sell',
 *   type: 'market',
 *   positionIntent: 'sell_to_close',
 * });
 */
export async function createOptionOrder(
  client: AlpacaClient,
  params: SingleLegOptionOrderParams
): Promise<AlpacaOrder> {
  const { symbol, qty, side, type, limitPrice, positionIntent, timeInForce, clientOrderId } = params;

  log(`Creating option order: ${side} ${qty} ${symbol} (${positionIntent})`, {
    type: 'info',
    symbol,
    metadata: { type, limitPrice, positionIntent },
  });

  // Validate parameters
  if (type === 'limit' && limitPrice === undefined) {
    throw new Error('Limit price is required for limit orders');
  }

  if (qty <= 0 || !Number.isInteger(qty)) {
    throw new Error('Quantity must be a positive integer');
  }

  try {
    const sdk = client.getSDK();

    const orderParams: Record<string, unknown> = {
      symbol,
      qty: qty.toString(),
      side,
      type,
      time_in_force: timeInForce || 'day',
      position_intent: positionIntent,
    };

    if (type === 'limit' && limitPrice !== undefined) {
      orderParams.limit_price = limitPrice.toString();
    }

    if (clientOrderId) {
      orderParams.client_order_id = clientOrderId;
    }

    const order = await sdk.createOrder(orderParams) as AlpacaOrder;

    log(`Option order created: ${order.id}`, {
      type: 'info',
      symbol,
      metadata: {
        orderId: order.id,
        status: order.status,
        positionIntent,
        qty: order.qty,
      },
    });

    return order;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to create option order for ${symbol}: ${errorMessage}`, {
      type: 'error',
      symbol,
      metadata: { params },
    });
    throw new Error(`Failed to create option order: ${errorMessage}`);
  }
}

/**
 * Buy to open option contracts
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Option contract symbol
 * @param qty - Number of contracts
 * @param limitPrice - Optional limit price (market order if not provided)
 * @param timeInForce - Time in force (default: day)
 * @returns The created order
 *
 * @example
 * const order = await buyToOpen(client, 'AAPL230120C00150000', 5, 2.50);
 */
export async function buyToOpen(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  limitPrice?: number,
  timeInForce: TimeInForce = 'day'
): Promise<AlpacaOrder> {
  return createOptionOrder(client, {
    symbol,
    qty,
    side: 'buy',
    type: limitPrice !== undefined ? 'limit' : 'market',
    limitPrice,
    positionIntent: 'buy_to_open',
    timeInForce,
  });
}

/**
 * Sell to close option contracts
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Option contract symbol
 * @param qty - Number of contracts
 * @param limitPrice - Optional limit price (market order if not provided)
 * @param timeInForce - Time in force (default: day)
 * @returns The created order
 *
 * @example
 * const order = await sellToClose(client, 'AAPL230120C00150000', 5, 3.00);
 */
export async function sellToClose(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  limitPrice?: number,
  timeInForce: TimeInForce = 'day'
): Promise<AlpacaOrder> {
  return createOptionOrder(client, {
    symbol,
    qty,
    side: 'sell',
    type: limitPrice !== undefined ? 'limit' : 'market',
    limitPrice,
    positionIntent: 'sell_to_close',
    timeInForce,
  });
}

/**
 * Sell to open option contracts (short selling options)
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Option contract symbol
 * @param qty - Number of contracts
 * @param limitPrice - Optional limit price (market order if not provided)
 * @param timeInForce - Time in force (default: day)
 * @returns The created order
 *
 * @example
 * const order = await sellToOpen(client, 'AAPL230120P00140000', 5, 1.50);
 */
export async function sellToOpen(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  limitPrice?: number,
  timeInForce: TimeInForce = 'day'
): Promise<AlpacaOrder> {
  return createOptionOrder(client, {
    symbol,
    qty,
    side: 'sell',
    type: limitPrice !== undefined ? 'limit' : 'market',
    limitPrice,
    positionIntent: 'sell_to_open',
    timeInForce,
  });
}

/**
 * Buy to close option contracts (closing short options)
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Option contract symbol
 * @param qty - Number of contracts
 * @param limitPrice - Optional limit price (market order if not provided)
 * @param timeInForce - Time in force (default: day)
 * @returns The created order
 *
 * @example
 * const order = await buyToClose(client, 'AAPL230120P00140000', 5, 0.50);
 */
export async function buyToClose(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  limitPrice?: number,
  timeInForce: TimeInForce = 'day'
): Promise<AlpacaOrder> {
  return createOptionOrder(client, {
    symbol,
    qty,
    side: 'buy',
    type: limitPrice !== undefined ? 'limit' : 'market',
    limitPrice,
    positionIntent: 'buy_to_close',
    timeInForce,
  });
}

// ============================================================================
// Multi-Leg Option Orders
// ============================================================================

/**
 * Validate multi-leg order parameters
 *
 * @param params - Multi-leg order parameters
 * @returns Validation result with errors and warnings
 */
export function validateMultiLegOrder(params: CreateMultiLegOrderParams): MultiLegValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check legs count
  if (!params.legs || params.legs.length < 2) {
    errors.push('Multi-leg orders require at least 2 legs');
  }

  if (params.legs && params.legs.length > 4) {
    errors.push('Multi-leg orders support a maximum of 4 legs');
  }

  // Validate order class
  if (params.order_class !== 'mleg') {
    errors.push("Order class must be 'mleg' for multi-leg orders");
  }

  // Validate quantity
  const qty = parseFloat(params.qty);
  if (isNaN(qty) || qty <= 0) {
    errors.push('Quantity must be a positive number');
  }

  // Validate limit price for limit orders
  if (params.type === 'limit' && !params.limit_price) {
    errors.push('Limit price is required for limit orders');
  }

  // Validate each leg
  if (params.legs) {
    const seenSymbols = new Set<string>();
    for (let i = 0; i < params.legs.length; i++) {
      const leg = params.legs[i];

      if (!leg.symbol) {
        errors.push(`Leg ${i + 1}: Symbol is required`);
      }

      if (!leg.ratio_qty) {
        errors.push(`Leg ${i + 1}: Ratio quantity is required`);
      } else {
        const ratioQty = parseFloat(leg.ratio_qty);
        if (isNaN(ratioQty) || ratioQty <= 0) {
          errors.push(`Leg ${i + 1}: Ratio quantity must be a positive number`);
        }
      }

      if (!['buy', 'sell'].includes(leg.side)) {
        errors.push(`Leg ${i + 1}: Side must be 'buy' or 'sell'`);
      }

      if (!['buy_to_open', 'buy_to_close', 'sell_to_open', 'sell_to_close'].includes(leg.position_intent)) {
        errors.push(`Leg ${i + 1}: Invalid position intent`);
      }

      // Check for duplicate symbols
      if (leg.symbol && seenSymbols.has(leg.symbol)) {
        warnings.push(`Leg ${i + 1}: Duplicate symbol ${leg.symbol} found`);
      }
      if (leg.symbol) {
        seenSymbols.add(leg.symbol);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Create a multi-leg option order (spreads, straddles, etc.)
 *
 * @param client - The AlpacaClient instance
 * @param params - Multi-leg order parameters
 * @returns The created order
 * @throws Error if validation fails or order creation fails
 *
 * @example
 * // Create a vertical call spread
 * const order = await createMultiLegOptionOrder(client, {
 *   order_class: 'mleg',
 *   qty: '1',
 *   type: 'limit',
 *   limit_price: '1.50',
 *   time_in_force: 'day',
 *   legs: [
 *     {
 *       symbol: 'AAPL230120C00150000',
 *       ratio_qty: '1',
 *       side: 'buy',
 *       position_intent: 'buy_to_open',
 *     },
 *     {
 *       symbol: 'AAPL230120C00155000',
 *       ratio_qty: '1',
 *       side: 'sell',
 *       position_intent: 'sell_to_open',
 *     },
 *   ],
 * });
 */
export async function createMultiLegOptionOrder(
  client: AlpacaClient,
  params: CreateMultiLegOrderParams
): Promise<AlpacaOrder> {
  const legSymbols = params.legs.map((l) => l.symbol).join(', ');
  log(`Creating multi-leg option order: ${params.qty}x [${legSymbols}]`, {
    type: 'info',
    metadata: { legsCount: params.legs.length, type: params.type },
  });

  // Validate parameters
  const validation = validateMultiLegOrder(params);
  if (!validation.isValid) {
    const errorMsg = `Multi-leg order validation failed: ${validation.errors.join('; ')}`;
    log(errorMsg, { type: 'error', metadata: { errors: validation.errors } });
    throw new Error(errorMsg);
  }

  if (validation.warnings.length > 0) {
    log(`Multi-leg order warnings: ${validation.warnings.join('; ')}`, {
      type: 'warn',
      metadata: { warnings: validation.warnings },
    });
  }

  try {
    const sdk = client.getSDK();

    const orderParams: Record<string, unknown> = {
      order_class: params.order_class,
      qty: params.qty,
      type: params.type,
      time_in_force: params.time_in_force,
      legs: params.legs,
    };

    if (params.limit_price) {
      orderParams.limit_price = params.limit_price;
    }

    const order = await sdk.createOrder(orderParams) as AlpacaOrder;

    log(`Multi-leg option order created: ${order.id}`, {
      type: 'info',
      metadata: {
        orderId: order.id,
        status: order.status,
        legsCount: params.legs.length,
      },
    });

    return order;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to create multi-leg option order: ${errorMessage}`, {
      type: 'error',
      metadata: { params },
    });
    throw new Error(`Failed to create multi-leg option order: ${errorMessage}`);
  }
}

// ============================================================================
// Spread Order Helpers
// ============================================================================

/**
 * Create a vertical spread (bull call spread or bear put spread)
 *
 * @param client - The AlpacaClient instance
 * @param longSymbol - Symbol of the long leg
 * @param shortSymbol - Symbol of the short leg
 * @param qty - Number of spreads
 * @param limitPrice - Net debit or credit for the spread
 * @param timeInForce - Time in force (default: day)
 * @returns The created order
 *
 * @example
 * // Bull call spread: buy lower strike call, sell higher strike call
 * const order = await createVerticalSpread(
 *   client,
 *   'AAPL230120C00150000', // Long leg
 *   'AAPL230120C00155000', // Short leg
 *   5,
 *   1.50 // Net debit
 * );
 */
export async function createVerticalSpread(
  client: AlpacaClient,
  longSymbol: string,
  shortSymbol: string,
  qty: number,
  limitPrice?: number,
  timeInForce: TimeInForce = 'day'
): Promise<AlpacaOrder> {
  log(`Creating vertical spread: ${qty}x ${longSymbol} / ${shortSymbol}`, {
    type: 'info',
    metadata: { limitPrice },
  });

  const params: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: qty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs: [
      {
        symbol: longSymbol,
        ratio_qty: '1',
        side: 'buy',
        position_intent: 'buy_to_open',
      },
      {
        symbol: shortSymbol,
        ratio_qty: '1',
        side: 'sell',
        position_intent: 'sell_to_open',
      },
    ],
  };

  if (limitPrice !== undefined) {
    params.limit_price = limitPrice.toString();
  }

  return createMultiLegOptionOrder(client, params);
}

/**
 * Create an iron condor spread
 *
 * @param client - The AlpacaClient instance
 * @param putLongSymbol - Lower strike put (buy)
 * @param putShortSymbol - Higher strike put (sell)
 * @param callShortSymbol - Lower strike call (sell)
 * @param callLongSymbol - Higher strike call (buy)
 * @param qty - Number of iron condors
 * @param limitPrice - Net credit for the iron condor
 * @param timeInForce - Time in force (default: day)
 * @returns The created order
 *
 * @example
 * const order = await createIronCondor(
 *   client,
 *   'AAPL230120P00140000', // Buy put
 *   'AAPL230120P00145000', // Sell put
 *   'AAPL230120C00155000', // Sell call
 *   'AAPL230120C00160000', // Buy call
 *   5,
 *   2.00 // Net credit
 * );
 */
export async function createIronCondor(
  client: AlpacaClient,
  putLongSymbol: string,
  putShortSymbol: string,
  callShortSymbol: string,
  callLongSymbol: string,
  qty: number,
  limitPrice?: number,
  timeInForce: TimeInForce = 'day'
): Promise<AlpacaOrder> {
  log(`Creating iron condor: ${qty}x contracts`, {
    type: 'info',
    metadata: { putLongSymbol, putShortSymbol, callShortSymbol, callLongSymbol, limitPrice },
  });

  const params: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: qty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs: [
      {
        symbol: putLongSymbol,
        ratio_qty: '1',
        side: 'buy',
        position_intent: 'buy_to_open',
      },
      {
        symbol: putShortSymbol,
        ratio_qty: '1',
        side: 'sell',
        position_intent: 'sell_to_open',
      },
      {
        symbol: callShortSymbol,
        ratio_qty: '1',
        side: 'sell',
        position_intent: 'sell_to_open',
      },
      {
        symbol: callLongSymbol,
        ratio_qty: '1',
        side: 'buy',
        position_intent: 'buy_to_open',
      },
    ],
  };

  if (limitPrice !== undefined) {
    params.limit_price = limitPrice.toString();
  }

  return createMultiLegOptionOrder(client, params);
}

/**
 * Create a straddle (buy both call and put at same strike)
 *
 * @param client - The AlpacaClient instance
 * @param callSymbol - Call option symbol
 * @param putSymbol - Put option symbol
 * @param qty - Number of straddles
 * @param limitPrice - Net debit for the straddle
 * @param timeInForce - Time in force (default: day)
 * @returns The created order
 *
 * @example
 * const order = await createStraddle(
 *   client,
 *   'AAPL230120C00150000',
 *   'AAPL230120P00150000',
 *   5,
 *   6.00 // Net debit
 * );
 */
export async function createStraddle(
  client: AlpacaClient,
  callSymbol: string,
  putSymbol: string,
  qty: number,
  limitPrice?: number,
  timeInForce: TimeInForce = 'day'
): Promise<AlpacaOrder> {
  log(`Creating straddle: ${qty}x ${callSymbol} + ${putSymbol}`, {
    type: 'info',
    metadata: { limitPrice },
  });

  const params: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: qty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs: [
      {
        symbol: callSymbol,
        ratio_qty: '1',
        side: 'buy',
        position_intent: 'buy_to_open',
      },
      {
        symbol: putSymbol,
        ratio_qty: '1',
        side: 'buy',
        position_intent: 'buy_to_open',
      },
    ],
  };

  if (limitPrice !== undefined) {
    params.limit_price = limitPrice.toString();
  }

  return createMultiLegOptionOrder(client, params);
}

/**
 * Create a strangle (buy OTM call and OTM put at different strikes)
 *
 * @param client - The AlpacaClient instance
 * @param callSymbol - OTM call option symbol
 * @param putSymbol - OTM put option symbol
 * @param qty - Number of strangles
 * @param limitPrice - Net debit for the strangle
 * @param timeInForce - Time in force (default: day)
 * @returns The created order
 */
export async function createStrangle(
  client: AlpacaClient,
  callSymbol: string,
  putSymbol: string,
  qty: number,
  limitPrice?: number,
  timeInForce: TimeInForce = 'day'
): Promise<AlpacaOrder> {
  log(`Creating strangle: ${qty}x ${callSymbol} + ${putSymbol}`, {
    type: 'info',
    metadata: { limitPrice },
  });

  const params: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: qty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs: [
      {
        symbol: callSymbol,
        ratio_qty: '1',
        side: 'buy',
        position_intent: 'buy_to_open',
      },
      {
        symbol: putSymbol,
        ratio_qty: '1',
        side: 'buy',
        position_intent: 'buy_to_open',
      },
    ],
  };

  if (limitPrice !== undefined) {
    params.limit_price = limitPrice.toString();
  }

  return createMultiLegOptionOrder(client, params);
}

// ============================================================================
// Position Management
// ============================================================================

/**
 * Close an option position
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Option contract symbol
 * @param options - Optional close parameters
 * @returns The close order
 * @throws Error if position not found or close fails
 *
 * @example
 * // Close entire position with market order
 * const order = await closeOptionPosition(client, 'AAPL230120C00150000');
 *
 * @example
 * // Close partial position with limit order
 * const order = await closeOptionPosition(client, 'AAPL230120C00150000', {
 *   qty: 2,
 *   limitPrice: 3.00,
 * });
 */
export async function closeOptionPosition(
  client: AlpacaClient,
  symbol: string,
  options?: CloseOptionPositionParams
): Promise<AlpacaOrder> {
  log(`Closing option position: ${symbol}`, {
    type: 'info',
    symbol,
    metadata: options,
  });

  try {
    const sdk = client.getSDK();

    // First get the current position to determine side and quantity
    let position: AlpacaPosition;
    try {
      position = await sdk.getPosition(symbol) as AlpacaPosition;
    } catch (error) {
      throw new Error(`No position found for ${symbol}`);
    }

    const positionQty = Math.abs(parseFloat(position.qty));
    const closeQty = options?.qty ?? positionQty;

    if (closeQty > positionQty) {
      throw new Error(`Close quantity (${closeQty}) exceeds position quantity (${positionQty})`);
    }

    // Determine the correct side and intent based on current position
    const isLong = position.side === 'long';
    const side = isLong ? 'sell' : 'buy';
    const positionIntent: PositionIntent = isLong ? 'sell_to_close' : 'buy_to_close';

    const order = await createOptionOrder(client, {
      symbol,
      qty: closeQty,
      side,
      type: options?.limitPrice !== undefined ? 'limit' : 'market',
      limitPrice: options?.limitPrice,
      positionIntent,
      timeInForce: options?.timeInForce || 'day',
    });

    log(`Option position close order created: ${order.id}`, {
      type: 'info',
      symbol,
      metadata: {
        orderId: order.id,
        closeQty,
        remainingQty: positionQty - closeQty,
      },
    });

    return order;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to close option position ${symbol}: ${errorMessage}`, {
      type: 'error',
      symbol,
    });
    throw new Error(`Failed to close option position: ${errorMessage}`);
  }
}

/**
 * Close all option positions
 *
 * @param client - The AlpacaClient instance
 * @returns Result containing orders and any failures
 *
 * @example
 * const result = await closeAllOptionPositions(client);
 * console.log(`Closed ${result.orders.length} positions`);
 * if (result.failed.length > 0) {
 *   console.log(`Failed to close: ${result.failed.map(f => f.symbol).join(', ')}`);
 * }
 */
export async function closeAllOptionPositions(
  client: AlpacaClient
): Promise<CloseAllOptionsResult> {
  log('Closing all option positions', { type: 'info' });

  const result: CloseAllOptionsResult = {
    orders: [],
    failed: [],
    totalProcessed: 0,
  };

  try {
    const sdk = client.getSDK();

    // Get all positions and filter for options
    const positions = await sdk.getPositions() as AlpacaPosition[];
    const optionPositions = positions.filter(
      (p) => p.asset_class === 'us_option'
    );

    result.totalProcessed = optionPositions.length;

    if (optionPositions.length === 0) {
      log('No option positions to close', { type: 'info' });
      return result;
    }

    log(`Found ${optionPositions.length} option positions to close`, {
      type: 'info',
      metadata: { symbols: optionPositions.map((p) => p.symbol) },
    });

    // Close each position
    for (const position of optionPositions) {
      try {
        const order = await closeOptionPosition(client, position.symbol);
        result.orders.push(order);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.failed.push({
          symbol: position.symbol,
          error: errorMessage,
        });
        log(`Failed to close position ${position.symbol}: ${errorMessage}`, {
          type: 'warn',
          symbol: position.symbol,
        });
      }
    }

    log(`Closed ${result.orders.length} option positions, ${result.failed.length} failed`, {
      type: 'info',
      metadata: {
        closed: result.orders.length,
        failed: result.failed.length,
      },
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to close all option positions: ${errorMessage}`, { type: 'error' });
    throw new Error(`Failed to close all option positions: ${errorMessage}`);
  }
}

/**
 * Exercise an option contract
 * Note: Exercise is only available for American-style options before expiration
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Option contract symbol
 * @param qty - Number of contracts to exercise (defaults to full position)
 * @throws Error if exercise fails
 *
 * @example
 * // Exercise all contracts in position
 * await exerciseOption(client, 'AAPL230120C00150000');
 *
 * @example
 * // Exercise specific quantity
 * await exerciseOption(client, 'AAPL230120C00150000', 5);
 */
export async function exerciseOption(
  client: AlpacaClient,
  symbol: string,
  qty?: number
): Promise<void> {
  log(`Exercising option: ${symbol}${qty ? ` (qty: ${qty})` : ''}`, {
    type: 'info',
    symbol,
  });

  try {
    const sdk = client.getSDK();

    // Get current position
    let position: AlpacaPosition;
    try {
      position = await sdk.getPosition(symbol) as AlpacaPosition;
    } catch (error) {
      throw new Error(`No position found for ${symbol}`);
    }

    // Verify it's a long position (can't exercise short options)
    if (position.side !== 'long') {
      throw new Error('Can only exercise long option positions');
    }

    const positionQty = Math.abs(parseFloat(position.qty));
    const exerciseQty = qty ?? positionQty;

    if (exerciseQty > positionQty) {
      throw new Error(`Exercise quantity (${exerciseQty}) exceeds position quantity (${positionQty})`);
    }

    // Call the exercise endpoint using direct API
    const endpoint = `/positions/${encodeURIComponent(symbol)}/exercise`;
    const body: Record<string, unknown> = {};
    if (qty !== undefined) {
      body.qty = qty.toString();
    }

    await client.makeRequest(endpoint, 'POST', Object.keys(body).length > 0 ? body : undefined);

    log(`Option exercised: ${symbol} (${exerciseQty} contracts)`, {
      type: 'info',
      symbol,
      metadata: { exerciseQty },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to exercise option ${symbol}: ${errorMessage}`, {
      type: 'error',
      symbol,
    });
    throw new Error(`Failed to exercise option: ${errorMessage}`);
  }
}

// ============================================================================
// Order Status Helpers
// ============================================================================

/**
 * Check if an option order is in a terminal state
 *
 * @param status - The order status
 * @returns True if the order is in a terminal state
 */
export function isOptionOrderTerminal(status: OrderStatus): boolean {
  const terminalStates: OrderStatus[] = ['filled', 'canceled', 'expired', 'rejected'];
  return terminalStates.includes(status);
}

/**
 * Check if an option order can be canceled
 *
 * @param status - The order status
 * @returns True if the order can be canceled
 */
export function isOptionOrderCancelable(status: OrderStatus): boolean {
  const cancelableStates: OrderStatus[] = ['new', 'partially_filled', 'accepted', 'pending_new'];
  return cancelableStates.includes(status);
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  // Single-leg orders
  createOptionOrder,
  buyToOpen,
  sellToClose,
  sellToOpen,
  buyToClose,

  // Multi-leg orders
  validateMultiLegOrder,
  createMultiLegOptionOrder,
  createVerticalSpread,
  createIronCondor,
  createStraddle,
  createStrangle,

  // Position management
  closeOptionPosition,
  closeAllOptionPositions,
  exerciseOption,

  // Order status helpers
  isOptionOrderTerminal,
  isOptionOrderCancelable,
};
