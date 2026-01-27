/**
 * Smart Orders Module
 * Unified interface for bracket, OCO, OTO, and trailing stop orders
 *
 * This module aggregates all advanced order types and provides:
 * - Automatic order type selection based on parameters
 * - Convenience functions for common trading strategies
 * - Risk-managed position creation with automatic sizing
 * - Percentage-based bracket orders
 *
 * @module smart-orders
 */
import { AlpacaClient } from '../client';
import { AlpacaOrder, OrderSide, TimeInForce } from '../../types/alpaca-types';
import {
  createBracketOrder,
  createProtectiveBracket,
  BracketOrderParams,
  BracketOrderResult,
  BracketOrderExecutor,
  createExecutorFromTradingAPI,
} from './bracket-orders';
import { createOCOOrder, OCOOrderParams, OCOOrderResult } from './oco-orders';
import { createOTOOrder, OTOOrderParams, OTOOrderResult } from './oto-orders';
import { createTrailingStop, updateTrailingStop, TrailingStopParams } from './trailing-stops';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'SmartOrders' });
};

// Re-export all types for convenience
export * from './bracket-orders';
export * from './oco-orders';
export * from './oto-orders';
export * from './trailing-stops';

/**
 * Unified smart order creation parameters
 * Allows specifying entry, take profit, stop loss, and trailing stop in a single interface
 */
export interface SmartOrderParams {
  /** Trading symbol (e.g., 'AAPL') */
  symbol: string;
  /** Number of shares */
  qty: number;
  /** Order side: 'buy' or 'sell' */
  side: OrderSide;

  /** Entry configuration (optional - if omitted, assumes existing position) */
  entry?: {
    /** Entry order type */
    type: 'market' | 'limit';
    /** Limit price for entry (required if type is 'limit') */
    limitPrice?: number;
  };

  /** Take profit configuration (optional) */
  takeProfit?: {
    /** Limit price for take profit */
    limitPrice: number;
  };

  /** Stop loss configuration (optional) */
  stopLoss?: {
    /** Stop price to trigger stop loss */
    stopPrice: number;
    /** Optional limit price for stop-limit orders */
    limitPrice?: number;
  };

  /** Trailing stop configuration (alternative to fixed stop loss) */
  trailingStop?: {
    /** Trail by percentage (e.g., 5 = 5%) */
    trailPercent?: number;
    /** Trail by fixed dollar amount */
    trailPrice?: number;
  };

  /** Time in force for the order */
  timeInForce?: TimeInForce;
  /** Allow extended hours trading */
  extendedHours?: boolean;
}

/**
 * Type of order determined by smart order analysis
 */
export type SmartOrderType = 'bracket' | 'oco' | 'oto' | 'trailing_stop' | 'simple';

/**
 * Result of smart order creation - union of all possible result types
 */
export type SmartOrderResult = BracketOrderResult | OCOOrderResult | OTOOrderResult | AlpacaOrder;

/**
 * Analyze parameters and determine the best order type
 *
 * Decision logic:
 * - Bracket: Entry + Take Profit + Stop Loss
 * - OCO: Take Profit + Stop Loss (no entry - for existing position)
 * - OTO: Entry + single exit (either TP or SL, not both)
 * - Trailing Stop: Only trailing stop specified
 * - Simple: None of the above
 *
 * @param params - Smart order parameters
 * @returns The recommended order type
 *
 * @example
 * ```typescript
 * const orderType = determineOrderType({
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'buy',
 *   entry: { type: 'limit', limitPrice: 150 },
 *   takeProfit: { limitPrice: 160 },
 *   stopLoss: { stopPrice: 145 },
 * });
 * // Returns: 'bracket'
 * ```
 */
export function determineOrderType(params: SmartOrderParams): SmartOrderType {
  const hasEntry = !!params.entry;
  const hasTakeProfit = !!params.takeProfit;
  const hasStopLoss = !!params.stopLoss;
  const hasTrailingStop = !!params.trailingStop;

  // Bracket: Entry + Take Profit + Stop Loss
  if (hasEntry && hasTakeProfit && hasStopLoss) {
    return 'bracket';
  }

  // OCO: Take Profit + Stop Loss (no entry - for existing position)
  if (!hasEntry && hasTakeProfit && hasStopLoss) {
    return 'oco';
  }

  // OTO: Entry + single exit (either TP or SL)
  if (hasEntry && (hasTakeProfit !== hasStopLoss)) {
    return 'oto';
  }

  // Trailing Stop
  if (hasTrailingStop) {
    return 'trailing_stop';
  }

  return 'simple';
}

/**
 * Create an executor adapter for bracket orders from AlpacaClient
 */
function createExecutorFromClient(client: AlpacaClient): BracketOrderExecutor {
  const sdk = client.getSDK();
  return {
    createOrder: async (params) => {
      return sdk.createOrder(params) as Promise<AlpacaOrder>;
    },
  };
}

/**
 * Create a smart order based on parameters
 * Automatically selects the appropriate order type based on provided configuration
 *
 * @param client - AlpacaClient instance
 * @param params - Smart order parameters
 * @returns The created order(s) based on the determined order type
 * @throws Error if parameters result in 'simple' order type (use createOrder directly)
 *
 * @example
 * ```typescript
 * // Full bracket order with entry, take profit, and stop loss
 * const result = await createSmartOrder(client, {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'buy',
 *   entry: { type: 'limit', limitPrice: 150 },
 *   takeProfit: { limitPrice: 160 },
 *   stopLoss: { stopPrice: 145 },
 *   timeInForce: 'gtc',
 * });
 *
 * // OCO for existing position (no entry)
 * const result = await createSmartOrder(client, {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'sell',
 *   takeProfit: { limitPrice: 160 },
 *   stopLoss: { stopPrice: 145 },
 * });
 *
 * // OTO with entry and stop loss only
 * const result = await createSmartOrder(client, {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'buy',
 *   entry: { type: 'limit', limitPrice: 150 },
 *   stopLoss: { stopPrice: 145 },
 * });
 *
 * // Trailing stop
 * const result = await createSmartOrder(client, {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'sell',
 *   trailingStop: { trailPercent: 5 },
 * });
 * ```
 */
export async function createSmartOrder(
  client: AlpacaClient,
  params: SmartOrderParams
): Promise<SmartOrderResult> {
  const orderType = determineOrderType(params);

  log(`Creating smart order: ${orderType} for ${params.symbol}`, { type: 'info' });
  log(`  Side: ${params.side}, Qty: ${params.qty}`, { type: 'debug' });

  switch (orderType) {
    case 'bracket': {
      const executor = createExecutorFromClient(client);
      return createBracketOrder(executor, {
        symbol: params.symbol,
        qty: params.qty,
        side: params.side,
        type: params.entry!.type,
        limitPrice: params.entry!.limitPrice,
        takeProfit: params.takeProfit!,
        stopLoss: params.stopLoss!,
        timeInForce: params.timeInForce,
        extendedHours: params.extendedHours,
      });
    }

    case 'oco': {
      return createOCOOrder(client, {
        symbol: params.symbol,
        qty: params.qty,
        side: params.side,
        takeProfit: params.takeProfit!,
        stopLoss: params.stopLoss!,
        timeInForce: params.timeInForce,
      });
    }

    case 'oto': {
      // Determine exit side (opposite of entry)
      const exitSide: OrderSide = params.side === 'buy' ? 'sell' : 'buy';

      // Build dependent order based on what's provided (TP or SL)
      const dependent = params.takeProfit
        ? {
            side: exitSide,
            type: 'limit' as const,
            limitPrice: params.takeProfit.limitPrice,
          }
        : {
            side: exitSide,
            type: 'stop' as const,
            stopPrice: params.stopLoss!.stopPrice,
            limitPrice: params.stopLoss!.limitPrice,
          };

      return createOTOOrder(client, {
        symbol: params.symbol,
        qty: params.qty,
        side: params.side,
        type: params.entry!.type,
        limitPrice: params.entry!.limitPrice,
        dependent,
        timeInForce: params.timeInForce,
        extendedHours: params.extendedHours,
      });
    }

    case 'trailing_stop': {
      return createTrailingStop(client, {
        symbol: params.symbol,
        qty: params.qty,
        side: params.side,
        trailPercent: params.trailingStop!.trailPercent,
        trailPrice: params.trailingStop!.trailPrice,
        timeInForce: params.timeInForce,
        extendedHours: params.extendedHours,
      });
    }

    default:
      throw new Error(
        'Simple orders should use createOrder directly. ' +
        'Smart orders require at least one of: entry+takeProfit+stopLoss (bracket), ' +
        'takeProfit+stopLoss (OCO), entry+takeProfit/stopLoss (OTO), or trailingStop.'
      );
  }
}

/**
 * Parameters for percentage-based bracket order
 */
export interface PercentageBracketParams {
  /** Trading symbol */
  symbol: string;
  /** Number of shares */
  qty: number;
  /** Order side: 'buy' or 'sell' */
  side: OrderSide;
  /** Entry price (limit order) */
  entryPrice: number;
  /** Take profit percentage above/below entry (e.g., 5 = 5% profit target) */
  takeProfitPercent: number;
  /** Stop loss percentage above/below entry (e.g., 2 = 2% risk) */
  stopLossPercent: number;
  /** Time in force for the order */
  timeInForce?: TimeInForce;
}

/**
 * Quick bracket order with percentage-based take profit and stop loss
 * Calculates TP and SL prices based on percentages from entry price
 *
 * For buy orders:
 * - Take profit is entryPrice + takeProfitPercent
 * - Stop loss is entryPrice - stopLossPercent
 *
 * For sell (short) orders:
 * - Take profit is entryPrice - takeProfitPercent
 * - Stop loss is entryPrice + stopLossPercent
 *
 * @param client - AlpacaClient instance
 * @param params - Percentage bracket parameters
 * @returns The created bracket order result
 *
 * @example
 * ```typescript
 * // Buy AAPL at $150 with 5% take profit ($157.50) and 2% stop loss ($147)
 * const result = await createPercentageBracket(client, {
 *   symbol: 'AAPL',
 *   qty: 100,
 *   side: 'buy',
 *   entryPrice: 150.00,
 *   takeProfitPercent: 5,  // Take profit at $157.50
 *   stopLossPercent: 2,    // Stop loss at $147.00
 *   timeInForce: 'gtc',
 * });
 * ```
 */
export async function createPercentageBracket(
  client: AlpacaClient,
  params: PercentageBracketParams
): Promise<BracketOrderResult> {
  const {
    symbol,
    qty,
    side,
    entryPrice,
    takeProfitPercent,
    stopLossPercent,
    timeInForce = 'gtc',
  } = params;

  // Multiplier: +1 for buy (profit above, stop below), -1 for sell (profit below, stop above)
  const multiplier = side === 'buy' ? 1 : -1;

  const takeProfitPrice = entryPrice * (1 + (multiplier * takeProfitPercent / 100));
  const stopLossPrice = entryPrice * (1 - (multiplier * stopLossPercent / 100));

  // Round to 2 decimal places for prices >= $1, 4 decimal places for prices < $1
  const roundPrice = (price: number): number => {
    return price >= 1 ? Math.round(price * 100) / 100 : Math.round(price * 10000) / 10000;
  };

  log(
    `Creating percentage bracket for ${symbol}: ` +
    `${side} ${qty} @ $${entryPrice} | ` +
    `TP: ${takeProfitPercent}% ($${roundPrice(takeProfitPrice).toFixed(2)}) | ` +
    `SL: ${stopLossPercent}% ($${roundPrice(stopLossPrice).toFixed(2)})`,
    { symbol, type: 'info' }
  );

  const executor = createExecutorFromClient(client);

  return createBracketOrder(executor, {
    symbol,
    qty,
    side,
    type: 'limit',
    limitPrice: entryPrice,
    takeProfit: { limitPrice: roundPrice(takeProfitPrice) },
    stopLoss: { stopPrice: roundPrice(stopLossPrice) },
    timeInForce,
  });
}

/**
 * Parameters for risk-managed position
 */
export interface RiskManagedPositionParams {
  /** Trading symbol */
  symbol: string;
  /** Order side: 'buy' or 'sell' */
  side: OrderSide;
  /** Entry price (limit order) */
  entryPrice: number;
  /** Stop loss price */
  stopPrice: number;
  /** Dollar amount willing to risk */
  riskAmount: number;
  /** Optional take profit price */
  takeProfitPrice?: number;
  /** Time in force for the order */
  timeInForce?: TimeInForce;
}

/**
 * Create a risk-managed position
 * Calculates position size based on risk amount and stop distance
 *
 * Position size formula: riskAmount / abs(entryPrice - stopPrice)
 *
 * @param client - AlpacaClient instance
 * @param params - Risk-managed position parameters
 * @returns The created bracket or OTO order result
 * @throws Error if risk amount is too small for the stop distance
 *
 * @example
 * ```typescript
 * // Risk $500 on AAPL trade with entry at $150 and stop at $145
 * // Position size = $500 / ($150 - $145) = 100 shares
 * const result = await createRiskManagedPosition(client, {
 *   symbol: 'AAPL',
 *   side: 'buy',
 *   entryPrice: 150.00,
 *   stopPrice: 145.00,
 *   riskAmount: 500,
 *   takeProfitPrice: 160.00, // Optional
 *   timeInForce: 'gtc',
 * });
 *
 * // Actual risk: 100 shares * $5 stop distance = $500
 * ```
 */
export async function createRiskManagedPosition(
  client: AlpacaClient,
  params: RiskManagedPositionParams
): Promise<BracketOrderResult | OTOOrderResult> {
  const {
    symbol,
    side,
    entryPrice,
    stopPrice,
    riskAmount,
    takeProfitPrice,
    timeInForce = 'gtc',
  } = params;

  const stopDistance = Math.abs(entryPrice - stopPrice);
  const qty = Math.floor(riskAmount / stopDistance);

  if (qty < 1) {
    throw new Error(
      `Risk amount $${riskAmount.toFixed(2)} is too small for stop distance $${stopDistance.toFixed(2)}. ` +
      `Minimum position size would be 1 share, requiring risk of at least $${stopDistance.toFixed(2)}.`
    );
  }

  const actualRisk = qty * stopDistance;
  log(
    `Creating risk-managed position for ${symbol}: ` +
    `${side} ${qty} shares @ $${entryPrice} | ` +
    `Stop: $${stopPrice} | ` +
    `Risking: $${actualRisk.toFixed(2)} (target: $${riskAmount.toFixed(2)})`,
    { symbol, type: 'info' }
  );

  const executor = createExecutorFromClient(client);

  if (takeProfitPrice) {
    // Create full bracket order with TP and SL
    return createBracketOrder(executor, {
      symbol,
      qty,
      side,
      type: 'limit',
      limitPrice: entryPrice,
      takeProfit: { limitPrice: takeProfitPrice },
      stopLoss: { stopPrice },
      timeInForce,
    });
  } else {
    // Create OTO order with just stop loss
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
      timeInForce,
    });
  }
}

/**
 * Calculate reward-to-risk ratio for a trade setup
 *
 * @param entryPrice - Entry price
 * @param takeProfitPrice - Take profit price
 * @param stopLossPrice - Stop loss price
 * @param side - Order side ('buy' or 'sell')
 * @returns Reward-to-risk ratio (e.g., 2.5 means 2.5:1 reward:risk)
 *
 * @example
 * ```typescript
 * // Buy at $150, TP at $160, SL at $145
 * const rr = calculateRewardRiskRatio(150, 160, 145, 'buy');
 * // Returns: 2.0 (reward: $10 / risk: $5 = 2:1)
 * ```
 */
export function calculateRewardRiskRatio(
  entryPrice: number,
  takeProfitPrice: number,
  stopLossPrice: number,
  side: OrderSide
): number {
  let reward: number;
  let risk: number;

  if (side === 'buy') {
    reward = takeProfitPrice - entryPrice;
    risk = entryPrice - stopLossPrice;
  } else {
    reward = entryPrice - takeProfitPrice;
    risk = stopLossPrice - entryPrice;
  }

  if (risk <= 0) {
    throw new Error('Risk must be positive. Check stop loss placement.');
  }

  if (reward <= 0) {
    throw new Error('Reward must be positive. Check take profit placement.');
  }

  return reward / risk;
}

/**
 * Calculate position size based on account risk percentage
 *
 * @param accountValue - Total account value
 * @param riskPercent - Percentage of account to risk (e.g., 1 = 1%)
 * @param entryPrice - Entry price
 * @param stopPrice - Stop loss price
 * @returns Recommended position size in shares
 *
 * @example
 * ```typescript
 * // $100,000 account, risk 1%, entry at $150, stop at $145
 * const shares = calculatePositionSize(100000, 1, 150, 145);
 * // Returns: 200 (risk $1,000 / $5 per share = 200 shares)
 * ```
 */
export function calculatePositionSize(
  accountValue: number,
  riskPercent: number,
  entryPrice: number,
  stopPrice: number
): number {
  const riskAmount = accountValue * (riskPercent / 100);
  const stopDistance = Math.abs(entryPrice - stopPrice);

  if (stopDistance <= 0) {
    throw new Error('Stop distance must be positive');
  }

  return Math.floor(riskAmount / stopDistance);
}

/**
 * Default export with all smart order functions
 */
export default {
  // Core functions
  createSmartOrder,
  determineOrderType,

  // Convenience functions
  createPercentageBracket,
  createRiskManagedPosition,

  // Utility functions
  calculateRewardRiskRatio,
  calculatePositionSize,

  // Re-exported from sub-modules
  createBracketOrder,
  createProtectiveBracket,
  createExecutorFromTradingAPI,
  createOCOOrder,
  createOTOOrder,
  createTrailingStop,
  updateTrailingStop,
};
