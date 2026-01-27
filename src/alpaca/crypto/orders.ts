/**
 * Crypto Orders Module
 * Create and manage cryptocurrency orders
 * Crypto trading is available 24/7 on Alpaca
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  AlpacaOrder,
  OrderSide,
  OrderType,
  TimeInForce,
  CryptoPair,
} from '../../types/alpaca-types';

const LOG_SOURCE = 'CryptoOrders';

/**
 * Internal logging helper with consistent source
 */
const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: LOG_SOURCE });
};

/**
 * Error thrown when crypto order operations fail
 */
export class CryptoOrderError extends Error {
  constructor(
    message: string,
    public code: string,
    public symbol?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'CryptoOrderError';
  }
}

/**
 * Parameters for creating a crypto order
 * Crypto trading is available 24/7
 */
export interface CryptoOrderParams {
  /** Crypto pair symbol (e.g., 'BTC/USD', 'ETH/USD') */
  symbol: string;
  /** Quantity to trade (mutually exclusive with notional) */
  qty?: number;
  /** Dollar amount to trade (mutually exclusive with qty) */
  notional?: number;
  /** Order side: 'buy' or 'sell' */
  side: OrderSide;
  /** Order type: 'market', 'limit', 'stop', 'stop_limit' */
  type: OrderType;
  /** Limit price for limit/stop_limit orders */
  limitPrice?: number;
  /** Stop price for stop/stop_limit orders */
  stopPrice?: number;
  /** Time in force - typically 'gtc' for crypto */
  timeInForce?: TimeInForce;
  /** Optional client-specified order ID */
  clientOrderId?: string;
}

/**
 * Normalize crypto symbol to Alpaca format
 * Ensures proper formatting (e.g., 'BTCUSD' -> 'BTC/USD')
 */
function normalizeCryptoSymbol(symbol: string): string {
  // If already in format 'XXX/YYY', return as is
  if (symbol.includes('/')) {
    return symbol.toUpperCase();
  }

  // Handle common formats like 'BTCUSD' -> 'BTC/USD'
  const upperSymbol = symbol.toUpperCase();

  // Check for common quote currencies
  const quoteCurrencies = ['USD', 'USDT', 'USDC', 'BTC'];

  for (const quote of quoteCurrencies) {
    if (upperSymbol.endsWith(quote)) {
      const base = upperSymbol.slice(0, -quote.length);
      if (base.length > 0) {
        return `${base}/${quote}`;
      }
    }
  }

  // Default: assume USD quote
  return `${upperSymbol}/USD`;
}

/**
 * Validate crypto order parameters
 */
function validateCryptoOrderParams(params: CryptoOrderParams): void {
  if (!params.symbol) {
    throw new CryptoOrderError('Symbol is required', 'MISSING_SYMBOL');
  }

  if (params.qty === undefined && params.notional === undefined) {
    throw new CryptoOrderError(
      'Either qty or notional is required',
      'MISSING_QUANTITY',
      params.symbol
    );
  }

  if (params.qty !== undefined && params.notional !== undefined) {
    throw new CryptoOrderError(
      'Cannot specify both qty and notional',
      'INVALID_QUANTITY',
      params.symbol
    );
  }

  if (params.qty !== undefined && params.qty <= 0) {
    throw new CryptoOrderError(
      'Quantity must be positive',
      'INVALID_QUANTITY',
      params.symbol
    );
  }

  if (params.notional !== undefined && params.notional <= 0) {
    throw new CryptoOrderError(
      'Notional must be positive',
      'INVALID_NOTIONAL',
      params.symbol
    );
  }

  if ((params.type === 'limit' || params.type === 'stop_limit') && !params.limitPrice) {
    throw new CryptoOrderError(
      'Limit price required for limit orders',
      'MISSING_LIMIT_PRICE',
      params.symbol
    );
  }

  if ((params.type === 'stop' || params.type === 'stop_limit') && !params.stopPrice) {
    throw new CryptoOrderError(
      'Stop price required for stop orders',
      'MISSING_STOP_PRICE',
      params.symbol
    );
  }
}

/**
 * Create a crypto order
 * Crypto trading is available 24/7 on Alpaca
 *
 * @param client - The AlpacaClient instance
 * @param params - Crypto order parameters
 * @returns The created order
 * @throws CryptoOrderError if order creation fails
 *
 * @example
 * // Buy 0.5 BTC at market price
 * const order = await createCryptoOrder(client, {
 *   symbol: 'BTC/USD',
 *   qty: 0.5,
 *   side: 'buy',
 *   type: 'market',
 * });
 *
 * @example
 * // Buy $100 worth of ETH
 * const order = await createCryptoOrder(client, {
 *   symbol: 'ETH/USD',
 *   notional: 100,
 *   side: 'buy',
 *   type: 'market',
 * });
 */
export async function createCryptoOrder(
  client: AlpacaClient,
  params: CryptoOrderParams
): Promise<AlpacaOrder> {
  validateCryptoOrderParams(params);

  const normalizedSymbol = normalizeCryptoSymbol(params.symbol);
  const { qty, notional, side, type, limitPrice, stopPrice, timeInForce, clientOrderId } = params;

  const qtyDescription = qty !== undefined ? `${qty}` : `$${notional}`;
  log(`Creating crypto ${type} order: ${side} ${qtyDescription} ${normalizedSymbol}`, {
    type: 'info',
    symbol: normalizedSymbol,
  });

  try {
    const sdk = client.getSDK();

    // Build order request
    const orderRequest: Record<string, unknown> = {
      symbol: normalizedSymbol,
      side,
      type,
      time_in_force: timeInForce || 'gtc', // GTC is typical for crypto
    };

    if (qty !== undefined) {
      orderRequest.qty = qty.toString();
    }

    if (notional !== undefined) {
      orderRequest.notional = notional.toString();
    }

    if (limitPrice !== undefined) {
      orderRequest.limit_price = limitPrice.toString();
    }

    if (stopPrice !== undefined) {
      orderRequest.stop_price = stopPrice.toString();
    }

    if (clientOrderId) {
      orderRequest.client_order_id = clientOrderId;
    }

    const order = await sdk.createOrder(orderRequest);

    log(`Crypto order created successfully: ${order.id}`, {
      type: 'info',
      symbol: normalizedSymbol,
      metadata: {
        orderId: order.id,
        status: order.status,
        type: order.type,
        side: order.side,
      },
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to create crypto order for ${normalizedSymbol}: ${errorMessage}`, {
      type: 'error',
      symbol: normalizedSymbol,
      metadata: { params },
    });
    throw new CryptoOrderError(
      `Failed to create crypto ${type} order for ${normalizedSymbol}: ${errorMessage}`,
      'ORDER_CREATION_FAILED',
      normalizedSymbol,
      error
    );
  }
}

/**
 * Create a crypto market order
 * Executes immediately at the current market price
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Crypto pair symbol (e.g., 'BTC/USD')
 * @param side - Order side: 'buy' or 'sell'
 * @param qty - Quantity to trade
 * @returns The created order
 *
 * @example
 * const order = await createCryptoMarketOrder(client, 'BTC/USD', 'buy', 0.1);
 */
export async function createCryptoMarketOrder(
  client: AlpacaClient,
  symbol: string,
  side: OrderSide,
  qty: number
): Promise<AlpacaOrder> {
  return createCryptoOrder(client, {
    symbol,
    qty,
    side,
    type: 'market',
  });
}

/**
 * Create a crypto limit order
 * Executes only at the specified price or better
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Crypto pair symbol (e.g., 'BTC/USD')
 * @param side - Order side: 'buy' or 'sell'
 * @param qty - Quantity to trade
 * @param limitPrice - Maximum (buy) or minimum (sell) price
 * @returns The created order
 *
 * @example
 * // Buy 0.5 BTC at $40,000 or lower
 * const order = await createCryptoLimitOrder(client, 'BTC/USD', 'buy', 0.5, 40000);
 */
export async function createCryptoLimitOrder(
  client: AlpacaClient,
  symbol: string,
  side: OrderSide,
  qty: number,
  limitPrice: number
): Promise<AlpacaOrder> {
  return createCryptoOrder(client, {
    symbol,
    qty,
    side,
    type: 'limit',
    limitPrice,
  });
}

/**
 * Create a crypto stop order
 * Becomes a market order when the stop price is reached
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Crypto pair symbol (e.g., 'BTC/USD')
 * @param side - Order side: 'buy' or 'sell'
 * @param qty - Quantity to trade
 * @param stopPrice - Price at which to trigger the order
 * @returns The created order
 *
 * @example
 * // Sell 0.5 BTC if price drops to $35,000
 * const order = await createCryptoStopOrder(client, 'BTC/USD', 'sell', 0.5, 35000);
 */
export async function createCryptoStopOrder(
  client: AlpacaClient,
  symbol: string,
  side: OrderSide,
  qty: number,
  stopPrice: number
): Promise<AlpacaOrder> {
  return createCryptoOrder(client, {
    symbol,
    qty,
    side,
    type: 'stop',
    stopPrice,
  });
}

/**
 * Create a crypto stop-limit order
 * Becomes a limit order when the stop price is reached
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Crypto pair symbol (e.g., 'BTC/USD')
 * @param side - Order side: 'buy' or 'sell'
 * @param qty - Quantity to trade
 * @param stopPrice - Price at which to trigger the limit order
 * @param limitPrice - Limit price for the resulting order
 * @returns The created order
 *
 * @example
 * // Sell 0.5 BTC when price drops to $35,000, but not below $34,500
 * const order = await createCryptoStopLimitOrder(client, 'BTC/USD', 'sell', 0.5, 35000, 34500);
 */
export async function createCryptoStopLimitOrder(
  client: AlpacaClient,
  symbol: string,
  side: OrderSide,
  qty: number,
  stopPrice: number,
  limitPrice: number
): Promise<AlpacaOrder> {
  return createCryptoOrder(client, {
    symbol,
    qty,
    side,
    type: 'stop_limit',
    stopPrice,
    limitPrice,
  });
}

/**
 * Buy crypto with a dollar amount (notional order)
 * Allows purchasing crypto with a specific USD amount
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Crypto pair symbol (e.g., 'BTC/USD')
 * @param dollarAmount - Amount in USD to spend
 * @returns The created order
 *
 * @example
 * // Buy $500 worth of Bitcoin
 * const order = await buyCryptoNotional(client, 'BTC/USD', 500);
 */
export async function buyCryptoNotional(
  client: AlpacaClient,
  symbol: string,
  dollarAmount: number
): Promise<AlpacaOrder> {
  if (dollarAmount <= 0) {
    throw new CryptoOrderError(
      'Dollar amount must be positive',
      'INVALID_AMOUNT',
      symbol
    );
  }

  return createCryptoOrder(client, {
    symbol,
    notional: dollarAmount,
    side: 'buy',
    type: 'market',
  });
}

/**
 * Sell crypto for a dollar amount (notional order)
 * Allows selling crypto for a specific USD amount
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Crypto pair symbol (e.g., 'BTC/USD')
 * @param dollarAmount - Amount in USD to receive
 * @returns The created order
 *
 * @example
 * // Sell $200 worth of Ethereum
 * const order = await sellCryptoNotional(client, 'ETH/USD', 200);
 */
export async function sellCryptoNotional(
  client: AlpacaClient,
  symbol: string,
  dollarAmount: number
): Promise<AlpacaOrder> {
  if (dollarAmount <= 0) {
    throw new CryptoOrderError(
      'Dollar amount must be positive',
      'INVALID_AMOUNT',
      symbol
    );
  }

  return createCryptoOrder(client, {
    symbol,
    notional: dollarAmount,
    side: 'sell',
    type: 'market',
  });
}

/**
 * Sell all of a crypto position
 * Closes the entire position for the specified crypto pair
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Crypto pair symbol (e.g., 'BTC/USD')
 * @returns The close order
 * @throws CryptoOrderError if no position exists or close fails
 *
 * @example
 * const order = await sellAllCrypto(client, 'BTC/USD');
 */
export async function sellAllCrypto(
  client: AlpacaClient,
  symbol: string
): Promise<AlpacaOrder> {
  const normalizedSymbol = normalizeCryptoSymbol(symbol);

  log(`Closing entire crypto position for ${normalizedSymbol}`, {
    type: 'info',
    symbol: normalizedSymbol,
  });

  try {
    const sdk = client.getSDK();

    // Get current position
    const position = await sdk.getPosition(normalizedSymbol);

    if (!position) {
      throw new CryptoOrderError(
        `No position found for ${normalizedSymbol}`,
        'NO_POSITION',
        normalizedSymbol
      );
    }

    const qty = Math.abs(parseFloat(position.qty));

    if (qty === 0) {
      throw new CryptoOrderError(
        `Position for ${normalizedSymbol} has zero quantity`,
        'ZERO_POSITION',
        normalizedSymbol
      );
    }

    // Determine side based on position
    const side: OrderSide = position.side === 'long' ? 'sell' : 'buy';

    log(`Selling ${qty} of ${normalizedSymbol}`, {
      type: 'info',
      symbol: normalizedSymbol,
    });

    // Create market order to close position
    const order = await createCryptoOrder(client, {
      symbol: normalizedSymbol,
      qty,
      side,
      type: 'market',
    });

    log(`Crypto position close order created: ${order.id}`, {
      type: 'info',
      symbol: normalizedSymbol,
      metadata: { orderId: order.id },
    });

    return order;
  } catch (error) {
    if (error instanceof CryptoOrderError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check for 404 (no position)
    if (errorMessage.includes('404')) {
      throw new CryptoOrderError(
        `No position found for ${normalizedSymbol}`,
        'NO_POSITION',
        normalizedSymbol
      );
    }

    log(`Failed to close crypto position for ${normalizedSymbol}: ${errorMessage}`, {
      type: 'error',
      symbol: normalizedSymbol,
    });

    throw new CryptoOrderError(
      `Failed to close crypto position for ${normalizedSymbol}: ${errorMessage}`,
      'CLOSE_FAILED',
      normalizedSymbol,
      error
    );
  }
}

/**
 * Get all open crypto orders
 *
 * @param client - The AlpacaClient instance
 * @param symbols - Optional array of crypto symbols to filter by
 * @returns Array of open crypto orders
 *
 * @example
 * const orders = await getOpenCryptoOrders(client);
 * const btcOrders = await getOpenCryptoOrders(client, ['BTC/USD']);
 */
export async function getOpenCryptoOrders(
  client: AlpacaClient,
  symbols?: string[]
): Promise<AlpacaOrder[]> {
  log('Fetching open crypto orders', { type: 'debug' });

  try {
    const sdk = client.getSDK();

    // Build query params with proper typing
    const queryParams = {
      status: 'open' as const,
      symbols: symbols && symbols.length > 0 ? symbols.map(normalizeCryptoSymbol).join(',') : undefined,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders = (await sdk.getOrders(queryParams as any)) as AlpacaOrder[];

    // Filter to only crypto orders (asset_class === 'crypto')
    const cryptoOrders = orders.filter((order) => order.asset_class === 'crypto');

    log(`Found ${cryptoOrders.length} open crypto orders`, {
      type: 'debug',
      metadata: { count: cryptoOrders.length },
    });

    return cryptoOrders;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch open crypto orders: ${errorMessage}`, { type: 'error' });
    throw new CryptoOrderError(
      `Failed to fetch open crypto orders: ${errorMessage}`,
      'FETCH_ORDERS_FAILED',
      undefined,
      error
    );
  }
}

/**
 * Cancel all open crypto orders
 *
 * @param client - The AlpacaClient instance
 * @param symbol - Optional specific crypto symbol to cancel orders for
 * @returns Number of orders canceled
 *
 * @example
 * // Cancel all crypto orders
 * const canceled = await cancelAllCryptoOrders(client);
 *
 * // Cancel only BTC orders
 * const canceled = await cancelAllCryptoOrders(client, 'BTC/USD');
 */
export async function cancelAllCryptoOrders(
  client: AlpacaClient,
  symbol?: string
): Promise<number> {
  log(`Canceling ${symbol ? `${symbol} ` : ''}crypto orders`, { type: 'info' });

  try {
    const sdk = client.getSDK();

    // Get open crypto orders
    const symbols = symbol ? [symbol] : undefined;
    const orders = await getOpenCryptoOrders(client, symbols);

    if (orders.length === 0) {
      log('No open crypto orders to cancel', { type: 'info' });
      return 0;
    }

    // Cancel each order
    let canceledCount = 0;
    for (const order of orders) {
      try {
        await sdk.cancelOrder(order.id);
        canceledCount++;
      } catch (cancelError) {
        const msg = cancelError instanceof Error ? cancelError.message : 'Unknown error';
        log(`Failed to cancel order ${order.id}: ${msg}`, { type: 'warn' });
      }
    }

    log(`Canceled ${canceledCount} crypto orders`, { type: 'info' });
    return canceledCount;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to cancel crypto orders: ${errorMessage}`, { type: 'error' });
    throw new CryptoOrderError(
      `Failed to cancel crypto orders: ${errorMessage}`,
      'CANCEL_FAILED',
      symbol,
      error
    );
  }
}

/**
 * Check if a symbol is a valid crypto pair
 *
 * @param symbol - Symbol to check
 * @returns true if the symbol appears to be a crypto pair
 */
export function isCryptoPair(symbol: string): boolean {
  const normalized = normalizeCryptoSymbol(symbol);
  return normalized.includes('/');
}

export default {
  createCryptoOrder,
  createCryptoMarketOrder,
  createCryptoLimitOrder,
  createCryptoStopOrder,
  createCryptoStopLimitOrder,
  buyCryptoNotional,
  sellCryptoNotional,
  sellAllCrypto,
  getOpenCryptoOrders,
  cancelAllCryptoOrders,
  isCryptoPair,
};
