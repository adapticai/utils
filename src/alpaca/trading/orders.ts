/**
 * Alpaca Order Management Module
 * Provides functions for creating, managing, and canceling orders using the official SDK
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  AlpacaOrder,
  CreateOrderParams,
  GetOrdersParams,
  ReplaceOrderParams,
  OrderStatus,
  SDKGetOrdersParams,
} from '../../types/alpaca-types';

const LOG_SOURCE = 'AlpacaOrders';

/**
 * Internal logging helper with consistent source
 */
const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: LOG_SOURCE });
};

/**
 * Response from cancel all orders operation
 */
export interface CancelAllOrdersResponse {
  /** Number of orders successfully canceled */
  canceled: number;
  /** Order IDs that failed to cancel */
  failed: string[];
}

/**
 * Creates a new order using the Alpaca SDK.
 * Supports market, limit, stop, and stop_limit order types.
 *
 * @param client - The AlpacaClient instance
 * @param params - Order parameters including symbol, qty, side, type, and time_in_force
 * @returns The created order object
 * @throws Error if order creation fails
 *
 * @example
 * // Create a market order
 * const order = await createOrder(client, {
 *   symbol: 'AAPL',
 *   qty: '10',
 *   side: 'buy',
 *   type: 'market',
 *   time_in_force: 'day',
 * });
 *
 * @example
 * // Create a limit order
 * const order = await createOrder(client, {
 *   symbol: 'AAPL',
 *   qty: '10',
 *   side: 'buy',
 *   type: 'limit',
 *   limit_price: '150.00',
 *   time_in_force: 'gtc',
 * });
 */
export async function createOrder(
  client: AlpacaClient,
  params: CreateOrderParams
): Promise<AlpacaOrder> {
  const { symbol, qty, side, type } = params;
  log(`Creating ${type} order: ${side} ${qty || params.notional} ${symbol}`, {
    type: 'info',
    symbol,
  });

  try {
    const sdk = client.getSDK();
    const order = await sdk.createOrder(params);

    log(`Order created successfully: ${order.id}`, {
      type: 'info',
      symbol,
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
    log(`Failed to create order for ${symbol}: ${errorMessage}`, {
      type: 'error',
      symbol,
      metadata: { params },
    });
    throw new Error(`Failed to create ${type} order for ${symbol}: ${errorMessage}`);
  }
}

/**
 * Retrieves a specific order by its ID.
 *
 * @param client - The AlpacaClient instance
 * @param orderId - The unique identifier of the order
 * @returns The order object if found
 * @throws Error if order is not found or request fails
 *
 * @example
 * const order = await getOrder(client, 'order-uuid-here');
 * console.log(`Order status: ${order.status}`);
 */
export async function getOrder(
  client: AlpacaClient,
  orderId: string
): Promise<AlpacaOrder> {
  log(`Fetching order: ${orderId}`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const order = await sdk.getOrder(orderId);

    log(`Order retrieved: ${orderId} (${order.status})`, {
      type: 'debug',
      symbol: order.symbol,
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch order ${orderId}: ${errorMessage}`, { type: 'error' });
    throw new Error(`Failed to fetch order ${orderId}: ${errorMessage}`);
  }
}

/**
 * Retrieves all orders matching the specified filters.
 *
 * @param client - The AlpacaClient instance
 * @param params - Optional filter parameters
 * @param params.status - Filter by order status: 'open', 'closed', or 'all'
 * @param params.limit - Maximum number of orders to return (default: 50, max: 500)
 * @param params.after - Filter orders created after this timestamp (RFC-3339 format)
 * @param params.until - Filter orders created before this timestamp (RFC-3339 format)
 * @param params.direction - Sort direction: 'asc' or 'desc' (default: 'desc')
 * @param params.nested - Include nested orders (for bracket orders)
 * @param params.symbols - Filter by specific symbols
 * @param params.side - Filter by order side: 'buy' or 'sell'
 * @returns Array of orders matching the filters
 *
 * @example
 * // Get all open orders
 * const openOrders = await getOrders(client, { status: 'open' });
 *
 * @example
 * // Get recent orders for specific symbols
 * const orders = await getOrders(client, {
 *   symbols: ['AAPL', 'GOOGL'],
 *   limit: 100,
 * });
 */
export async function getOrders(
  client: AlpacaClient,
  params: GetOrdersParams = {}
): Promise<AlpacaOrder[]> {
  const filterDescription = params.status || 'all';
  log(`Fetching orders (status: ${filterDescription})`, { type: 'debug' });

  try {
    const sdk = client.getSDK();

    // Build query parameters for the SDK
    const queryParams: SDKGetOrdersParams = {};
    if (params.status) queryParams.status = params.status;
    if (params.limit) queryParams.limit = params.limit;
    if (params.after) queryParams.after = params.after;
    if (params.until) queryParams.until = params.until;
    if (params.direction) queryParams.direction = params.direction;
    if (params.nested !== undefined) queryParams.nested = params.nested;
    if (params.symbols && params.symbols.length > 0) {
      queryParams.symbols = params.symbols.join(',');
    }
    if (params.side) queryParams.side = params.side;

    const orders = await sdk.getOrders(queryParams);

    log(`Retrieved ${orders.length} orders`, {
      type: 'debug',
      metadata: { count: orders.length, status: filterDescription },
    });

    return orders as AlpacaOrder[];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch orders: ${errorMessage}`, { type: 'error' });
    throw new Error(`Failed to fetch orders: ${errorMessage}`);
  }
}

/**
 * Cancels a specific order by its ID.
 * Only orders that are 'new', 'partially_filled', or 'accepted' can be canceled.
 *
 * @param client - The AlpacaClient instance
 * @param orderId - The unique identifier of the order to cancel
 * @throws Error if order cannot be canceled (e.g., already filled or canceled)
 *
 * @example
 * await cancelOrder(client, 'order-uuid-here');
 * console.log('Order canceled successfully');
 */
export async function cancelOrder(
  client: AlpacaClient,
  orderId: string
): Promise<void> {
  log(`Canceling order: ${orderId}`, { type: 'info' });

  try {
    const sdk = client.getSDK();
    await sdk.cancelOrder(orderId);

    log(`Order canceled successfully: ${orderId}`, { type: 'info' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check for specific error conditions
    if (errorMessage.includes('422') || errorMessage.includes('not cancelable')) {
      log(`Order ${orderId} is not cancelable (may already be filled or canceled)`, {
        type: 'warn',
      });
      throw new Error(`Order ${orderId} is not cancelable`);
    }

    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      log(`Order ${orderId} not found`, { type: 'error' });
      throw new Error(`Order ${orderId} not found`);
    }

    log(`Failed to cancel order ${orderId}: ${errorMessage}`, { type: 'error' });
    throw new Error(`Failed to cancel order ${orderId}: ${errorMessage}`);
  }
}

/**
 * Cancels all open orders.
 * This operation is atomic - if any cancellation fails, the function continues
 * with remaining orders and returns information about failures.
 *
 * @param client - The AlpacaClient instance
 * @returns Object containing count of canceled orders and any failures
 *
 * @example
 * const result = await cancelAllOrders(client);
 * console.log(`Canceled ${result.canceled} orders`);
 * if (result.failed.length > 0) {
 *   console.log(`Failed to cancel: ${result.failed.join(', ')}`);
 * }
 */
export async function cancelAllOrders(
  client: AlpacaClient
): Promise<CancelAllOrdersResponse> {
  log('Canceling all open orders', { type: 'info' });

  try {
    const sdk = client.getSDK();
    const result = await sdk.cancelAllOrders();

    // The SDK returns an array of canceled order statuses
    const canceled = Array.isArray(result) ? result.length : 0;
    const failed: string[] = [];

    // Check for any failures in the response
    if (Array.isArray(result)) {
      result.forEach((item: { id?: string; status?: number }) => {
        if (item.status && item.status >= 400 && item.id) {
          failed.push(item.id);
        }
      });
    }

    log(`Canceled ${canceled} orders${failed.length > 0 ? `, ${failed.length} failed` : ''}`, {
      type: 'info',
      metadata: { canceled, failed: failed.length },
    });

    return { canceled, failed };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to cancel all orders: ${errorMessage}`, { type: 'error' });
    throw new Error(`Failed to cancel all orders: ${errorMessage}`);
  }
}

/**
 * Replaces (modifies) an existing order with new parameters.
 * Only pending orders can be replaced. The order must not be filled.
 *
 * Common use cases:
 * - Update the quantity of an order
 * - Change the limit price
 * - Adjust the stop price
 * - Update trailing stop parameters
 *
 * @param client - The AlpacaClient instance
 * @param orderId - The unique identifier of the order to replace
 * @param params - New order parameters (qty, limit_price, stop_price, trail, time_in_force, client_order_id)
 * @returns The new order object that replaces the original
 * @throws Error if order cannot be replaced
 *
 * @example
 * // Update limit price
 * const newOrder = await replaceOrder(client, 'order-id', {
 *   limit_price: '155.00',
 * });
 *
 * @example
 * // Update quantity and price
 * const newOrder = await replaceOrder(client, 'order-id', {
 *   qty: '20',
 *   limit_price: '152.50',
 * });
 */
export async function replaceOrder(
  client: AlpacaClient,
  orderId: string,
  params: ReplaceOrderParams
): Promise<AlpacaOrder> {
  const updateDescription = Object.keys(params).join(', ');
  log(`Replacing order ${orderId} (updating: ${updateDescription})`, { type: 'info' });

  try {
    const sdk = client.getSDK();
    const newOrder = await sdk.replaceOrder(orderId, params);

    log(`Order replaced successfully: ${orderId} -> ${newOrder.id}`, {
      type: 'info',
      symbol: newOrder.symbol,
      metadata: {
        oldOrderId: orderId,
        newOrderId: newOrder.id,
        status: newOrder.status,
      },
    });

    return newOrder as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check for specific error conditions
    if (errorMessage.includes('422')) {
      log(`Order ${orderId} cannot be replaced (may already be filled)`, {
        type: 'error',
      });
      throw new Error(`Order ${orderId} cannot be replaced: order may already be filled or canceled`);
    }

    if (errorMessage.includes('404')) {
      log(`Order ${orderId} not found`, { type: 'error' });
      throw new Error(`Order ${orderId} not found`);
    }

    log(`Failed to replace order ${orderId}: ${errorMessage}`, { type: 'error' });
    throw new Error(`Failed to replace order ${orderId}: ${errorMessage}`);
  }
}

/**
 * Convenience function to get all open orders.
 *
 * @param client - The AlpacaClient instance
 * @param symbols - Optional array of symbols to filter by
 * @returns Array of open orders
 *
 * @example
 * const openOrders = await getOpenOrders(client);
 * console.log(`Found ${openOrders.length} open orders`);
 */
export async function getOpenOrders(
  client: AlpacaClient,
  symbols?: string[]
): Promise<AlpacaOrder[]> {
  return getOrders(client, { status: 'open', symbols });
}

/**
 * Convenience function to check if an order is in a terminal state.
 * Terminal states are: filled, canceled, expired, rejected
 *
 * @param status - The order status to check
 * @returns True if the order is in a terminal state
 *
 * @example
 * const order = await getOrder(client, 'order-id');
 * if (isOrderTerminal(order.status)) {
 *   console.log('Order is complete');
 * }
 */
export function isOrderTerminal(status: OrderStatus): boolean {
  const terminalStates: OrderStatus[] = ['filled', 'canceled', 'expired', 'rejected'];
  return terminalStates.includes(status);
}

/**
 * Convenience function to check if an order can be canceled.
 * Orders can be canceled if they are: new, partially_filled, accepted, pending_new
 *
 * @param status - The order status to check
 * @returns True if the order can be canceled
 *
 * @example
 * const order = await getOrder(client, 'order-id');
 * if (isOrderCancelable(order.status)) {
 *   await cancelOrder(client, order.id);
 * }
 */
export function isOrderCancelable(status: OrderStatus): boolean {
  const cancelableStates: OrderStatus[] = ['new', 'partially_filled', 'accepted', 'pending_new'];
  return cancelableStates.includes(status);
}

/**
 * Gets an order by client order ID.
 * Useful when you need to track orders using your own identifiers.
 *
 * @param client - The AlpacaClient instance
 * @param clientOrderId - Your custom order identifier
 * @returns The order if found
 * @throws Error if order is not found
 *
 * @example
 * const order = await getOrderByClientId(client, 'my-custom-order-123');
 */
export async function getOrderByClientId(
  client: AlpacaClient,
  clientOrderId: string
): Promise<AlpacaOrder> {
  log(`Fetching order by client_order_id: ${clientOrderId}`, { type: 'debug' });

  try {
    const sdk = client.getSDK();
    const order = await sdk.getOrderByClientId(clientOrderId);

    log(`Order retrieved by client_order_id: ${clientOrderId} -> ${order.id}`, {
      type: 'debug',
      symbol: order.symbol,
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch order by client_order_id ${clientOrderId}: ${errorMessage}`, {
      type: 'error',
    });
    throw new Error(`Failed to fetch order by client_order_id ${clientOrderId}: ${errorMessage}`);
  }
}
