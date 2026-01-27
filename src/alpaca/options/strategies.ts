/**
 * Options Strategies Module
 * Build and execute common option strategies using Alpaca SDK
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  AlpacaOrder,
  PositionIntent,
  TimeInForce,
  OrderLeg,
  CreateMultiLegOrderParams,
  AlpacaPosition,
} from '../../types/alpaca-types';
import { createOrder } from '../trading/orders';

const LOG_SOURCE = 'OptionsStrategies';

/**
 * Internal logging helper with consistent source
 */
const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: LOG_SOURCE });
};

/**
 * Error class for option strategy operations
 */
export class OptionStrategyError extends Error {
  constructor(
    message: string,
    public code: string,
    public strategy?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'OptionStrategyError';
  }
}

/**
 * Parameters for creating a vertical spread (call or put spread)
 */
export interface VerticalSpreadParams {
  /** Underlying stock symbol */
  underlying: string;
  /** Expiration date in YYYY-MM-DD format */
  expirationDate: string;
  /** Option type: call or put */
  type: 'call' | 'put';
  /** Strike price for the long leg */
  longStrike: number;
  /** Strike price for the short leg */
  shortStrike: number;
  /** Number of contracts */
  qty: number;
  /** Debit = buy spread, Credit = sell spread */
  direction: 'debit' | 'credit';
  /** Optional limit price for the spread (net debit or credit) */
  limitPrice?: number;
  /** Time in force for the order */
  timeInForce?: TimeInForce;
}

/**
 * Parameters for creating an iron condor
 */
export interface IronCondorParams {
  /** Underlying stock symbol */
  underlying: string;
  /** Expiration date in YYYY-MM-DD format */
  expirationDate: string;
  /** Strike price for the long put (lowest strike) */
  putLongStrike: number;
  /** Strike price for the short put */
  putShortStrike: number;
  /** Strike price for the short call */
  callShortStrike: number;
  /** Strike price for the long call (highest strike) */
  callLongStrike: number;
  /** Number of contracts */
  qty: number;
  /** Optional limit price for the spread (net credit) */
  limitPrice?: number;
  /** Time in force for the order */
  timeInForce?: TimeInForce;
}

/**
 * Parameters for creating a straddle
 */
export interface StraddleParams {
  /** Underlying stock symbol */
  underlying: string;
  /** Expiration date in YYYY-MM-DD format */
  expirationDate: string;
  /** Strike price (same for both call and put) */
  strike: number;
  /** Number of contracts */
  qty: number;
  /** Long = buy both options, Short = sell both options */
  direction: 'long' | 'short';
  /** Optional limit price for the spread */
  limitPrice?: number;
  /** Time in force for the order */
  timeInForce?: TimeInForce;
}

/**
 * Parameters for creating a covered call
 */
export interface CoveredCallParams {
  /** Underlying stock symbol */
  underlying: string;
  /** Expiration date in YYYY-MM-DD format */
  expirationDate: string;
  /** Strike price for the call option */
  strike: number;
  /** Number of contracts (each contract = 100 shares) */
  qty: number;
  /** Optional limit price for the call option */
  limitPrice?: number;
  /** Time in force for the order */
  timeInForce?: TimeInForce;
}

/**
 * Parameters for rolling an option position
 */
export interface RollPositionParams {
  /** Current option contract symbol to close */
  currentSymbol: string;
  /** New expiration date in YYYY-MM-DD format */
  newExpirationDate: string;
  /** New strike price */
  newStrike: number;
  /** Option type: call or put */
  type: 'call' | 'put';
  /** Optional limit price for the roll (net debit or credit) */
  limitPrice?: number;
  /** Time in force for the order */
  timeInForce?: TimeInForce;
}

/**
 * Parameters for creating a strangle
 */
export interface StrangleParams {
  /** Underlying stock symbol */
  underlying: string;
  /** Expiration date in YYYY-MM-DD format */
  expirationDate: string;
  /** Strike price for the put option (lower strike) */
  putStrike: number;
  /** Strike price for the call option (higher strike) */
  callStrike: number;
  /** Number of contracts */
  qty: number;
  /** Long = buy both options, Short = sell both options */
  direction: 'long' | 'short';
  /** Optional limit price for the spread */
  limitPrice?: number;
  /** Time in force for the order */
  timeInForce?: TimeInForce;
}

/**
 * Parameters for creating a butterfly spread
 */
export interface ButterflySpreadParams {
  /** Underlying stock symbol */
  underlying: string;
  /** Expiration date in YYYY-MM-DD format */
  expirationDate: string;
  /** Option type: call or put */
  type: 'call' | 'put';
  /** Lower strike price */
  lowerStrike: number;
  /** Middle strike price (usually ATM) */
  middleStrike: number;
  /** Upper strike price */
  upperStrike: number;
  /** Number of contracts */
  qty: number;
  /** Optional limit price for the spread */
  limitPrice?: number;
  /** Time in force for the order */
  timeInForce?: TimeInForce;
}

/**
 * Build an OCC-compliant option symbol
 * Format: ROOT + YYMMDD + C/P + Strike (8 digits with 3 decimals)
 */
export function buildOptionSymbol(
  underlying: string,
  expirationDate: string,
  type: 'call' | 'put',
  strike: number
): string {
  const root = underlying.toUpperCase().padEnd(6, ' ').substring(0, 6).replace(/ /g, '');
  const paddedRoot = root.padEnd(6, ' ');

  // Parse expiration date
  const expDate = new Date(expirationDate);
  const year = expDate.getFullYear().toString().slice(-2);
  const month = (expDate.getMonth() + 1).toString().padStart(2, '0');
  const day = expDate.getDate().toString().padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  // Type indicator
  const typeChar = type === 'call' ? 'C' : 'P';

  // Strike price: 8 digits, 3 decimal places implied
  // e.g., $150.00 -> 00150000
  const strikeInt = Math.round(strike * 1000);
  const strikeStr = strikeInt.toString().padStart(8, '0');

  return `${paddedRoot}${dateStr}${typeChar}${strikeStr}`;
}

/**
 * Create a vertical spread (call or put spread)
 * - Bull Call Spread: Buy lower strike call, sell higher strike call
 * - Bear Call Spread: Sell lower strike call, buy higher strike call
 * - Bull Put Spread: Sell higher strike put, buy lower strike put
 * - Bear Put Spread: Buy higher strike put, sell lower strike put
 */
export async function createVerticalSpread(
  client: AlpacaClient,
  params: VerticalSpreadParams
): Promise<AlpacaOrder> {
  const {
    underlying,
    expirationDate,
    type,
    longStrike,
    shortStrike,
    qty,
    direction,
    limitPrice,
    timeInForce = 'day',
  } = params;

  // Validate strikes
  if (longStrike === shortStrike) {
    throw new OptionStrategyError(
      'Long and short strikes must be different',
      'INVALID_STRIKES',
      'vertical_spread'
    );
  }

  log(`Creating ${direction} ${type} spread on ${underlying}: ${longStrike}/${shortStrike} x${qty}`, {
    type: 'info',
    symbol: underlying,
  });

  // Build option symbols
  const longSymbol = buildOptionSymbol(underlying, expirationDate, type, longStrike);
  const shortSymbol = buildOptionSymbol(underlying, expirationDate, type, shortStrike);

  // Determine position intents based on direction
  const longIntent: PositionIntent = direction === 'debit' ? 'buy_to_open' : 'sell_to_close';
  const shortIntent: PositionIntent = direction === 'debit' ? 'sell_to_open' : 'buy_to_close';

  // Build multi-leg order
  const legs: OrderLeg[] = [
    {
      symbol: longSymbol,
      ratio_qty: '1',
      side: direction === 'debit' ? 'buy' : 'sell',
      position_intent: longIntent,
    },
    {
      symbol: shortSymbol,
      ratio_qty: '1',
      side: direction === 'debit' ? 'sell' : 'buy',
      position_intent: shortIntent,
    },
  ];

  const orderParams: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: qty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs,
  };

  if (limitPrice !== undefined) {
    orderParams.limit_price = limitPrice.toFixed(2);
  }

  try {
    const sdk = client.getSDK();
    const order = await sdk.createOrder(orderParams);

    log(`Vertical spread order created: ${order.id}`, {
      type: 'info',
      symbol: underlying,
      metadata: { orderId: order.id, status: order.status },
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to create vertical spread: ${errorMessage}`, { type: 'error', symbol: underlying });
    throw new OptionStrategyError(
      `Failed to create vertical spread: ${errorMessage}`,
      'ORDER_FAILED',
      'vertical_spread',
      error
    );
  }
}

/**
 * Create an iron condor
 * Combines a bull put spread and a bear call spread
 * - Buy put at putLongStrike (lowest)
 * - Sell put at putShortStrike
 * - Sell call at callShortStrike
 * - Buy call at callLongStrike (highest)
 */
export async function createIronCondor(
  client: AlpacaClient,
  params: IronCondorParams
): Promise<AlpacaOrder> {
  const {
    underlying,
    expirationDate,
    putLongStrike,
    putShortStrike,
    callShortStrike,
    callLongStrike,
    qty,
    limitPrice,
    timeInForce = 'day',
  } = params;

  // Validate strikes are in order
  if (
    putLongStrike >= putShortStrike ||
    putShortStrike >= callShortStrike ||
    callShortStrike >= callLongStrike
  ) {
    throw new OptionStrategyError(
      'Strikes must be in ascending order: putLong < putShort < callShort < callLong',
      'INVALID_STRIKES',
      'iron_condor'
    );
  }

  log(
    `Creating iron condor on ${underlying}: ${putLongStrike}/${putShortStrike}/${callShortStrike}/${callLongStrike} x${qty}`,
    { type: 'info', symbol: underlying }
  );

  // Build option symbols
  const putLongSymbol = buildOptionSymbol(underlying, expirationDate, 'put', putLongStrike);
  const putShortSymbol = buildOptionSymbol(underlying, expirationDate, 'put', putShortStrike);
  const callShortSymbol = buildOptionSymbol(underlying, expirationDate, 'call', callShortStrike);
  const callLongSymbol = buildOptionSymbol(underlying, expirationDate, 'call', callLongStrike);

  // Iron condor legs (selling the inner strikes, buying the outer strikes)
  const legs: OrderLeg[] = [
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
  ];

  const orderParams: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: qty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs,
  };

  if (limitPrice !== undefined) {
    orderParams.limit_price = limitPrice.toFixed(2);
  }

  try {
    const sdk = client.getSDK();
    const order = await sdk.createOrder(orderParams);

    log(`Iron condor order created: ${order.id}`, {
      type: 'info',
      symbol: underlying,
      metadata: { orderId: order.id, status: order.status },
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to create iron condor: ${errorMessage}`, { type: 'error', symbol: underlying });
    throw new OptionStrategyError(
      `Failed to create iron condor: ${errorMessage}`,
      'ORDER_FAILED',
      'iron_condor',
      error
    );
  }
}

/**
 * Create a straddle (buy/sell both call and put at same strike)
 * - Long straddle: Buy call and put at same strike (expects high volatility)
 * - Short straddle: Sell call and put at same strike (expects low volatility)
 */
export async function createStraddle(
  client: AlpacaClient,
  params: StraddleParams
): Promise<AlpacaOrder> {
  const {
    underlying,
    expirationDate,
    strike,
    qty,
    direction,
    limitPrice,
    timeInForce = 'day',
  } = params;

  log(`Creating ${direction} straddle on ${underlying} at ${strike} x${qty}`, {
    type: 'info',
    symbol: underlying,
  });

  // Build option symbols
  const callSymbol = buildOptionSymbol(underlying, expirationDate, 'call', strike);
  const putSymbol = buildOptionSymbol(underlying, expirationDate, 'put', strike);

  const side = direction === 'long' ? 'buy' : 'sell';
  const intent: PositionIntent = direction === 'long' ? 'buy_to_open' : 'sell_to_open';

  const legs: OrderLeg[] = [
    {
      symbol: callSymbol,
      ratio_qty: '1',
      side,
      position_intent: intent,
    },
    {
      symbol: putSymbol,
      ratio_qty: '1',
      side,
      position_intent: intent,
    },
  ];

  const orderParams: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: qty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs,
  };

  if (limitPrice !== undefined) {
    orderParams.limit_price = limitPrice.toFixed(2);
  }

  try {
    const sdk = client.getSDK();
    const order = await sdk.createOrder(orderParams);

    log(`Straddle order created: ${order.id}`, {
      type: 'info',
      symbol: underlying,
      metadata: { orderId: order.id, status: order.status },
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to create straddle: ${errorMessage}`, { type: 'error', symbol: underlying });
    throw new OptionStrategyError(
      `Failed to create straddle: ${errorMessage}`,
      'ORDER_FAILED',
      'straddle',
      error
    );
  }
}

/**
 * Create a covered call
 * - Buy (or already own) 100 shares per contract
 * - Sell call option against the shares
 */
export async function createCoveredCall(
  client: AlpacaClient,
  params: CoveredCallParams
): Promise<{ stockOrder: AlpacaOrder; optionOrder: AlpacaOrder }> {
  const {
    underlying,
    expirationDate,
    strike,
    qty,
    limitPrice,
    timeInForce = 'day',
  } = params;

  const sharesNeeded = qty * 100;

  log(`Creating covered call on ${underlying}: ${sharesNeeded} shares + sell ${strike} call x${qty}`, {
    type: 'info',
    symbol: underlying,
  });

  // First, check current position
  const sdk = client.getSDK();
  let currentPosition: AlpacaPosition | null = null;

  try {
    currentPosition = await sdk.getPosition(underlying);
  } catch {
    // No existing position
    currentPosition = null;
  }

  const existingShares = currentPosition ? parseInt(currentPosition.qty, 10) : 0;
  const additionalSharesNeeded = sharesNeeded - existingShares;

  let stockOrder: AlpacaOrder;

  // Buy shares if needed
  if (additionalSharesNeeded > 0) {
    log(`Buying ${additionalSharesNeeded} additional shares of ${underlying}`, {
      type: 'info',
      symbol: underlying,
    });

    stockOrder = await createOrder(client, {
      symbol: underlying,
      qty: additionalSharesNeeded.toString(),
      side: 'buy',
      type: 'market',
      time_in_force: timeInForce,
    });
  } else {
    // Already have enough shares - create a placeholder response
    log(`Already have ${existingShares} shares of ${underlying}, no stock purchase needed`, {
      type: 'info',
      symbol: underlying,
    });

    // Return a mock order indicating no purchase was needed
    stockOrder = {
      id: 'existing-position',
      client_order_id: 'existing-position',
      created_at: new Date().toISOString(),
      updated_at: null,
      submitted_at: null,
      filled_at: null,
      expired_at: null,
      canceled_at: null,
      failed_at: null,
      replaced_at: null,
      replaced_by: null,
      replaces: null,
      asset_id: '',
      symbol: underlying,
      asset_class: 'us_equity',
      notional: null,
      qty: existingShares.toString(),
      filled_qty: existingShares.toString(),
      filled_avg_price: currentPosition?.avg_entry_price || '0',
      order_class: 'simple',
      type: 'market',
      side: 'buy',
      time_in_force: timeInForce,
      limit_price: null,
      stop_price: null,
      trail_price: null,
      trail_percent: null,
      hwm: null,
      position_intent: null,
      status: 'filled',
      extended_hours: false,
      legs: null,
    };
  }

  // Sell the call option
  const callSymbol = buildOptionSymbol(underlying, expirationDate, 'call', strike);

  try {
    const optionOrderParams = {
      symbol: callSymbol,
      qty: qty.toString(),
      side: 'sell' as const,
      type: limitPrice !== undefined ? 'limit' as const : 'market' as const,
      time_in_force: timeInForce,
      position_intent: 'sell_to_open' as PositionIntent,
      limit_price: limitPrice?.toFixed(2),
    };

    const optionOrder = await sdk.createOrder(optionOrderParams);

    log(`Covered call option order created: ${optionOrder.id}`, {
      type: 'info',
      symbol: underlying,
      metadata: { orderId: optionOrder.id, status: optionOrder.status },
    });

    return {
      stockOrder,
      optionOrder: optionOrder as AlpacaOrder,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to create covered call option: ${errorMessage}`, { type: 'error', symbol: underlying });
    throw new OptionStrategyError(
      `Failed to create covered call: ${errorMessage}`,
      'ORDER_FAILED',
      'covered_call',
      error
    );
  }
}

/**
 * Roll an option position to a new expiration/strike
 * Closes the current position and opens a new one
 */
export async function rollOptionPosition(
  client: AlpacaClient,
  params: RollPositionParams
): Promise<AlpacaOrder> {
  const {
    currentSymbol,
    newExpirationDate,
    newStrike,
    type,
    limitPrice,
    timeInForce = 'day',
  } = params;

  log(`Rolling option position from ${currentSymbol} to ${newStrike} exp ${newExpirationDate}`, {
    type: 'info',
    symbol: currentSymbol,
  });

  // Get current position to determine quantity and side
  const sdk = client.getSDK();
  let currentPosition: AlpacaPosition;

  try {
    currentPosition = await sdk.getPosition(currentSymbol);
  } catch (error) {
    throw new OptionStrategyError(
      `No existing position found for ${currentSymbol}`,
      'NO_POSITION',
      'roll',
      error
    );
  }

  const positionQty = Math.abs(parseInt(currentPosition.qty, 10));
  const isLong = parseInt(currentPosition.qty, 10) > 0;

  // Extract underlying from current symbol (first 1-6 chars before the date)
  const underlying = currentSymbol.replace(/\s+/g, '').substring(0, 6).trim();

  // Build new option symbol
  const newSymbol = buildOptionSymbol(underlying, newExpirationDate, type, newStrike);

  // Create legs for the roll
  // Close current position, open new position
  const legs: OrderLeg[] = [
    {
      symbol: currentSymbol,
      ratio_qty: '1',
      side: isLong ? 'sell' : 'buy',
      position_intent: isLong ? 'sell_to_close' : 'buy_to_close',
    },
    {
      symbol: newSymbol,
      ratio_qty: '1',
      side: isLong ? 'buy' : 'sell',
      position_intent: isLong ? 'buy_to_open' : 'sell_to_open',
    },
  ];

  const orderParams: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: positionQty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs,
  };

  if (limitPrice !== undefined) {
    orderParams.limit_price = limitPrice.toFixed(2);
  }

  try {
    const order = await sdk.createOrder(orderParams);

    log(`Roll order created: ${order.id}`, {
      type: 'info',
      symbol: underlying,
      metadata: { orderId: order.id, status: order.status, from: currentSymbol, to: newSymbol },
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to roll position: ${errorMessage}`, { type: 'error', symbol: currentSymbol });
    throw new OptionStrategyError(
      `Failed to roll position: ${errorMessage}`,
      'ORDER_FAILED',
      'roll',
      error
    );
  }
}

/**
 * Create a strangle (buy/sell call and put at different strikes)
 * - Long strangle: Buy OTM call and OTM put (expects high volatility)
 * - Short strangle: Sell OTM call and OTM put (expects low volatility)
 */
export async function createStrangle(
  client: AlpacaClient,
  params: StrangleParams
): Promise<AlpacaOrder> {
  const {
    underlying,
    expirationDate,
    putStrike,
    callStrike,
    qty,
    direction,
    limitPrice,
    timeInForce = 'day',
  } = params;

  // Validate strikes
  if (putStrike >= callStrike) {
    throw new OptionStrategyError(
      'Put strike must be less than call strike for a strangle',
      'INVALID_STRIKES',
      'strangle'
    );
  }

  log(`Creating ${direction} strangle on ${underlying}: ${putStrike}P/${callStrike}C x${qty}`, {
    type: 'info',
    symbol: underlying,
  });

  // Build option symbols
  const callSymbol = buildOptionSymbol(underlying, expirationDate, 'call', callStrike);
  const putSymbol = buildOptionSymbol(underlying, expirationDate, 'put', putStrike);

  const side = direction === 'long' ? 'buy' : 'sell';
  const intent: PositionIntent = direction === 'long' ? 'buy_to_open' : 'sell_to_open';

  const legs: OrderLeg[] = [
    {
      symbol: callSymbol,
      ratio_qty: '1',
      side,
      position_intent: intent,
    },
    {
      symbol: putSymbol,
      ratio_qty: '1',
      side,
      position_intent: intent,
    },
  ];

  const orderParams: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: qty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs,
  };

  if (limitPrice !== undefined) {
    orderParams.limit_price = limitPrice.toFixed(2);
  }

  try {
    const sdk = client.getSDK();
    const order = await sdk.createOrder(orderParams);

    log(`Strangle order created: ${order.id}`, {
      type: 'info',
      symbol: underlying,
      metadata: { orderId: order.id, status: order.status },
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to create strangle: ${errorMessage}`, { type: 'error', symbol: underlying });
    throw new OptionStrategyError(
      `Failed to create strangle: ${errorMessage}`,
      'ORDER_FAILED',
      'strangle',
      error
    );
  }
}

/**
 * Create a butterfly spread
 * - Long butterfly: Buy 1 lower, sell 2 middle, buy 1 upper
 * - Expects price to stay near middle strike
 */
export async function createButterflySpread(
  client: AlpacaClient,
  params: ButterflySpreadParams
): Promise<AlpacaOrder> {
  const {
    underlying,
    expirationDate,
    type,
    lowerStrike,
    middleStrike,
    upperStrike,
    qty,
    limitPrice,
    timeInForce = 'day',
  } = params;

  // Validate strikes are equally spaced
  if (
    lowerStrike >= middleStrike ||
    middleStrike >= upperStrike
  ) {
    throw new OptionStrategyError(
      'Strikes must be in ascending order: lower < middle < upper',
      'INVALID_STRIKES',
      'butterfly'
    );
  }

  const lowerWidth = middleStrike - lowerStrike;
  const upperWidth = upperStrike - middleStrike;

  if (Math.abs(lowerWidth - upperWidth) > 0.01) {
    log(`Warning: Butterfly spread has unequal wings (${lowerWidth} vs ${upperWidth})`, {
      type: 'warn',
      symbol: underlying,
    });
  }

  log(
    `Creating butterfly spread on ${underlying}: ${lowerStrike}/${middleStrike}/${upperStrike} ${type} x${qty}`,
    { type: 'info', symbol: underlying }
  );

  // Build option symbols
  const lowerSymbol = buildOptionSymbol(underlying, expirationDate, type, lowerStrike);
  const middleSymbol = buildOptionSymbol(underlying, expirationDate, type, middleStrike);
  const upperSymbol = buildOptionSymbol(underlying, expirationDate, type, upperStrike);

  // Butterfly: Buy 1 lower, Sell 2 middle, Buy 1 upper
  const legs: OrderLeg[] = [
    {
      symbol: lowerSymbol,
      ratio_qty: '1',
      side: 'buy',
      position_intent: 'buy_to_open',
    },
    {
      symbol: middleSymbol,
      ratio_qty: '2',
      side: 'sell',
      position_intent: 'sell_to_open',
    },
    {
      symbol: upperSymbol,
      ratio_qty: '1',
      side: 'buy',
      position_intent: 'buy_to_open',
    },
  ];

  const orderParams: CreateMultiLegOrderParams = {
    order_class: 'mleg',
    qty: qty.toString(),
    type: limitPrice !== undefined ? 'limit' : 'market',
    time_in_force: timeInForce,
    legs,
  };

  if (limitPrice !== undefined) {
    orderParams.limit_price = limitPrice.toFixed(2);
  }

  try {
    const sdk = client.getSDK();
    const order = await sdk.createOrder(orderParams);

    log(`Butterfly spread order created: ${order.id}`, {
      type: 'info',
      symbol: underlying,
      metadata: { orderId: order.id, status: order.status },
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to create butterfly spread: ${errorMessage}`, { type: 'error', symbol: underlying });
    throw new OptionStrategyError(
      `Failed to create butterfly spread: ${errorMessage}`,
      'ORDER_FAILED',
      'butterfly',
      error
    );
  }
}

export default {
  buildOptionSymbol,
  createVerticalSpread,
  createIronCondor,
  createStraddle,
  createCoveredCall,
  rollOptionPosition,
  createStrangle,
  createButterflySpread,
};
