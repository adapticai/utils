/**
 * Order Query Utilities for Alpaca Trading
 *
 * Provides utility functions for querying, filtering, and managing Alpaca orders.
 * Includes auto-pagination, order status helpers, and formatting utilities.
 *
 * @module order-utils
 */

import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  AlpacaOrder,
  GetOrdersParams,
  OrderStatus,
} from '../../types/alpaca-types';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'OrderUtils' });
};

/**
 * Default delay between pagination requests to avoid rate limits (in milliseconds)
 */
const DEFAULT_PAGINATION_DELAY_MS = 300;

/**
 * Maximum orders per Alpaca API request
 */
const MAX_ORDERS_PER_REQUEST = 500;

/**
 * Order statuses that are considered "open"
 */
const OPEN_ORDER_STATUSES: OrderStatus[] = [
  'new',
  'accepted',
  'pending_new',
  'accepted_for_bidding',
  'partially_filled',
];

/**
 * Order statuses that indicate a filled order
 */
const FILLED_ORDER_STATUSES: OrderStatus[] = ['filled'];

/**
 * Order statuses that can still potentially be filled
 */
const FILLABLE_ORDER_STATUSES: OrderStatus[] = [
  'new',
  'accepted',
  'pending_new',
  'accepted_for_bidding',
  'partially_filled',
];

/**
 * Terminal order statuses (order is no longer active)
 */
const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  'filled',
  'canceled',
  'expired',
  'replaced',
  'stopped',
  'rejected',
  'suspended',
];

/**
 * Parameters for getAllOrders with pagination support
 */
export interface GetAllOrdersParams extends GetOrdersParams {
  /** If true, fetches all orders by paginating through results */
  fetchAll?: boolean;
  /** Delay between pagination requests in ms (default: 300) */
  paginationDelayMs?: number;
}

/**
 * Parameters for getFilledOrders
 */
export interface GetFilledOrdersParams {
  /** Start date for the date range (inclusive) */
  startDate: Date;
  /** End date for the date range (inclusive) */
  endDate: Date;
  /** Optional symbols to filter by */
  symbols?: string[];
  /** Optional side filter */
  side?: 'buy' | 'sell';
}

/**
 * Parameters for getOrderHistory with pagination
 */
export interface GetOrderHistoryParams {
  /** Number of orders per page (max 500) */
  pageSize?: number;
  /** Starting page number (1-indexed) */
  page?: number;
  /** Optional symbols to filter by */
  symbols?: string[];
  /** Optional status filter */
  status?: 'open' | 'closed' | 'all';
  /** Optional side filter */
  side?: 'buy' | 'sell';
  /** Sort direction */
  direction?: 'asc' | 'desc';
}

/**
 * Result of paginated order history
 */
export interface OrderHistoryResult {
  /** Orders for the current page */
  orders: AlpacaOrder[];
  /** Current page number */
  page: number;
  /** Number of orders per page */
  pageSize: number;
  /** Total number of orders fetched so far */
  totalFetched: number;
  /** Whether there are more orders to fetch */
  hasMore: boolean;
}

/**
 * Parameters for waitForOrderFill
 */
export interface WaitForOrderFillParams {
  /** Order ID to monitor */
  orderId: string;
  /** Maximum time to wait in milliseconds (default: 60000) */
  timeoutMs?: number;
  /** Polling interval in milliseconds (default: 1000) */
  pollIntervalMs?: number;
}

/**
 * Result of waitForOrderFill
 */
export interface WaitForOrderFillResult {
  /** Whether the order was filled */
  filled: boolean;
  /** The final order state */
  order: AlpacaOrder;
  /** Time elapsed in milliseconds */
  elapsedMs: number;
}

/**
 * Order summary for display/logging
 */
export interface OrderSummary {
  id: string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  qty: string;
  filledQty: string;
  limitPrice: string | null;
  stopPrice: string | null;
  avgFillPrice: string | null;
  createdAt: string;
  filledAt: string | null;
  timeInForce: string;
  assetClass: string;
}

/**
 * Delay execution for the specified number of milliseconds
 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build SDK-compatible query parameters from GetOrdersParams
 */
function buildOrderQueryParams(params: GetOrdersParams): Record<string, unknown> {
  const queryParams: Record<string, unknown> = {};

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

  return queryParams;
}

/**
 * Get all orders for a specific symbol
 *
 * @param client - AlpacaClient instance
 * @param symbol - Symbol to filter orders by (e.g., 'AAPL', 'BTCUSD')
 * @param params - Optional additional filter parameters
 * @returns Promise resolving to array of orders for the symbol
 *
 * @example
 * ```typescript
 * const client = createAlpacaClient({ apiKey, apiSecret, accountType: 'PAPER' });
 * const orders = await getOrdersBySymbol(client, 'AAPL', { status: 'all' });
 * console.log(`Found ${orders.length} orders for AAPL`);
 * ```
 */
export async function getOrdersBySymbol(
  client: AlpacaClient,
  symbol: string,
  params: Omit<GetOrdersParams, 'symbols'> = {}
): Promise<AlpacaOrder[]> {
  const sdk = client.getSDK();

  try {
    log(`Fetching orders for symbol: ${symbol}`, {
      type: 'debug',
      metadata: { symbol, ...params },
    });

    // Build query parameters as Record<string, unknown> to match SDK expectations
    const queryParams: Record<string, unknown> = {
      symbols: symbol,
    };
    if (params.status) queryParams.status = params.status;
    if (params.limit) queryParams.limit = params.limit;
    if (params.after) queryParams.after = params.after;
    if (params.until) queryParams.until = params.until;
    if (params.direction) queryParams.direction = params.direction;
    if (params.nested !== undefined) queryParams.nested = params.nested;
    if (params.side) queryParams.side = params.side;

    const orders = await sdk.getOrders(queryParams);

    log(`Found ${orders.length} orders for ${symbol}`, {
      type: 'debug',
      metadata: { symbol, count: orders.length },
    });

    return orders as AlpacaOrder[];
  } catch (error) {
    log(`Error fetching orders for symbol ${symbol}: ${(error as Error).message}`, {
      type: 'error',
      metadata: { symbol, error: (error as Error).message },
    });
    throw error;
  }
}

/**
 * Get only open orders
 *
 * @param client - AlpacaClient instance
 * @param params - Optional filter parameters
 * @returns Promise resolving to array of open orders
 *
 * @example
 * ```typescript
 * const openOrders = await getOpenOrders(client);
 * console.log(`You have ${openOrders.length} open orders`);
 * ```
 */
export async function getOpenOrders(
  client: AlpacaClient,
  params: Omit<GetOrdersParams, 'status'> = {}
): Promise<AlpacaOrder[]> {
  const sdk = client.getSDK();

  try {
    log('Fetching open orders', { type: 'debug' });

    // Build query parameters as Record<string, unknown> to match SDK expectations
    const queryParams: Record<string, unknown> = {
      status: 'open',
    };
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

    log(`Found ${orders.length} open orders`, {
      type: 'debug',
      metadata: { count: orders.length },
    });

    return orders as AlpacaOrder[];
  } catch (error) {
    log(`Error fetching open orders: ${(error as Error).message}`, {
      type: 'error',
      metadata: { error: (error as Error).message },
    });
    throw error;
  }
}

/**
 * Get only filled orders within a date range
 *
 * @param client - AlpacaClient instance
 * @param params - Date range and optional filter parameters
 * @returns Promise resolving to array of filled orders in the date range
 *
 * @example
 * ```typescript
 * const startDate = new Date('2024-01-01');
 * const endDate = new Date('2024-01-31');
 * const filledOrders = await getFilledOrders(client, { startDate, endDate });
 * console.log(`Found ${filledOrders.length} filled orders in January`);
 * ```
 */
export async function getFilledOrders(
  client: AlpacaClient,
  params: GetFilledOrdersParams
): Promise<AlpacaOrder[]> {
  const sdk = client.getSDK();
  const { startDate, endDate, symbols, side } = params;

  try {
    log(`Fetching filled orders from ${startDate.toISOString()} to ${endDate.toISOString()}`, {
      type: 'debug',
      metadata: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    });

    const queryParams: GetOrdersParams = {
      status: 'closed',
      after: startDate.toISOString(),
      until: endDate.toISOString(),
      limit: MAX_ORDERS_PER_REQUEST,
    };

    if (symbols && symbols.length > 0) {
      queryParams.symbols = symbols;
    }

    if (side) {
      queryParams.side = side;
    }

    const allOrders = await getAllOrders(client, { ...queryParams, fetchAll: true });

    // Filter to only filled orders
    const filledOrders = allOrders.filter((order) =>
      FILLED_ORDER_STATUSES.includes(order.status as OrderStatus)
    );

    log(`Found ${filledOrders.length} filled orders in date range`, {
      type: 'debug',
      metadata: { count: filledOrders.length },
    });

    return filledOrders;
  } catch (error) {
    log(`Error fetching filled orders: ${(error as Error).message}`, {
      type: 'error',
      metadata: { error: (error as Error).message },
    });
    throw error;
  }
}

/**
 * Get paginated order history with auto-pagination support
 *
 * @param client - AlpacaClient instance
 * @param params - Pagination and filter parameters
 * @returns Promise resolving to order history result with pagination info
 *
 * @example
 * ```typescript
 * // Get first page
 * const result = await getOrderHistory(client, { pageSize: 100, page: 1 });
 *
 * // Get all pages
 * let allOrders: AlpacaOrder[] = [];
 * let page = 1;
 * let hasMore = true;
 *
 * while (hasMore) {
 *   const result = await getOrderHistory(client, { pageSize: 100, page });
 *   allOrders = allOrders.concat(result.orders);
 *   hasMore = result.hasMore;
 *   page++;
 * }
 * ```
 */
export async function getOrderHistory(
  client: AlpacaClient,
  params: GetOrderHistoryParams = {}
): Promise<OrderHistoryResult> {
  const {
    pageSize = 100,
    page = 1,
    symbols,
    status = 'all',
    side,
    direction = 'desc',
  } = params;

  const effectivePageSize = Math.min(pageSize, MAX_ORDERS_PER_REQUEST);
  const sdk = client.getSDK();

  try {
    log(`Fetching order history page ${page} (size: ${effectivePageSize})`, {
      type: 'debug',
      metadata: { page, pageSize: effectivePageSize },
    });

    // Build base query parameters
    const baseParams: GetOrdersParams = {
      status,
      limit: effectivePageSize,
      direction,
    };

    if (symbols && symbols.length > 0) {
      baseParams.symbols = symbols;
    }

    if (side) {
      baseParams.side = side;
    }

    // For pages > 1, we need to fetch previous pages to get the timestamp cursor
    // This is a limitation of Alpaca's API which uses timestamp-based pagination
    if (page > 1) {
      // Fetch all orders up to the requested page
      const allPreviousOrders: AlpacaOrder[] = [];
      let currentBatch: AlpacaOrder[] = [];
      let iterations = 0;
      const maxIterations = page;

      do {
        const batchParams: GetOrdersParams = {
          ...baseParams,
          limit: effectivePageSize,
        };

        if (allPreviousOrders.length > 0) {
          const lastOrder = allPreviousOrders[allPreviousOrders.length - 1];
          if (direction === 'desc') {
            batchParams.until = lastOrder.created_at;
          } else {
            batchParams.after = lastOrder.created_at;
          }
        }

        const sdkParams = buildOrderQueryParams(batchParams);
        currentBatch = (await sdk.getOrders(sdkParams)) as AlpacaOrder[];
        allPreviousOrders.push(...currentBatch);
        iterations++;

        if (iterations < maxIterations && currentBatch.length === effectivePageSize) {
          await delay(DEFAULT_PAGINATION_DELAY_MS);
        }
      } while (currentBatch.length === effectivePageSize && iterations < maxIterations);

      // Get the orders for the requested page
      const startIndex = (page - 1) * effectivePageSize;
      const endIndex = startIndex + effectivePageSize;
      const pageOrders = allPreviousOrders.slice(startIndex, endIndex);

      return {
        orders: pageOrders,
        page,
        pageSize: effectivePageSize,
        totalFetched: allPreviousOrders.length,
        hasMore: endIndex < allPreviousOrders.length || currentBatch.length === effectivePageSize,
      };
    }

    // First page - simple fetch
    const sdkParams = buildOrderQueryParams(baseParams);
    const orders = (await sdk.getOrders(sdkParams)) as AlpacaOrder[];

    return {
      orders,
      page,
      pageSize: effectivePageSize,
      totalFetched: orders.length,
      hasMore: orders.length === effectivePageSize,
    };
  } catch (error) {
    log(`Error fetching order history: ${(error as Error).message}`, {
      type: 'error',
      metadata: { error: (error as Error).message },
    });
    throw error;
  }
}

/**
 * Get all orders with automatic pagination
 * Alpaca limits to 500 orders per request, so this function handles
 * pagination automatically when fetchAll is true.
 *
 * @param client - AlpacaClient instance
 * @param params - Query parameters with optional fetchAll flag
 * @returns Promise resolving to array of all orders matching the criteria
 *
 * @example
 * ```typescript
 * // Fetch all closed orders
 * const allOrders = await getAllOrders(client, {
 *   status: 'closed',
 *   fetchAll: true
 * });
 * console.log(`Total orders: ${allOrders.length}`);
 * ```
 */
export async function getAllOrders(
  client: AlpacaClient,
  params: GetAllOrdersParams = {}
): Promise<AlpacaOrder[]> {
  const {
    fetchAll = false,
    paginationDelayMs = DEFAULT_PAGINATION_DELAY_MS,
    ...queryParams
  } = params;

  const sdk = client.getSDK();

  try {
    // If not fetching all, just make a single request
    if (!fetchAll) {
      const singleParams: GetOrdersParams = {
        ...queryParams,
        limit: queryParams.limit || MAX_ORDERS_PER_REQUEST,
      };
      const sdkParams = buildOrderQueryParams(singleParams);
      const orders = await sdk.getOrders(sdkParams);
      return orders as AlpacaOrder[];
    }

    log('Fetching all orders with pagination', {
      type: 'debug',
      metadata: { params: queryParams },
    });

    const allOrders: AlpacaOrder[] = [];
    let hasMore = true;
    let currentUntil: string | undefined = queryParams.until;
    let pageCount = 0;

    while (hasMore) {
      const batchParams: GetOrdersParams = {
        ...queryParams,
        limit: MAX_ORDERS_PER_REQUEST,
      };

      if (currentUntil) {
        batchParams.until = currentUntil;
      }

      const sdkParams = buildOrderQueryParams(batchParams);
      const batch = (await sdk.getOrders(sdkParams)) as AlpacaOrder[];
      pageCount++;

      log(`Fetched page ${pageCount}: ${batch.length} orders`, {
        type: 'debug',
        metadata: { pageCount, batchSize: batch.length },
      });

      if (batch.length === 0) {
        hasMore = false;
      } else {
        // Add orders to result, avoiding duplicates
        const existingIds = new Set(allOrders.map((o) => o.id));
        const newOrders = batch.filter((o) => !existingIds.has(o.id));
        allOrders.push(...newOrders);

        // Check if we got a full page (might be more)
        if (batch.length < MAX_ORDERS_PER_REQUEST) {
          hasMore = false;
        } else {
          // Use the oldest order's created_at as the next until cursor
          const oldestOrder = batch[batch.length - 1];
          currentUntil = oldestOrder.created_at;

          // Add delay to avoid rate limiting
          await delay(paginationDelayMs);
        }
      }
    }

    log(`Fetched total of ${allOrders.length} orders across ${pageCount} pages`, {
      type: 'info',
      metadata: { totalOrders: allOrders.length, pageCount },
    });

    return allOrders;
  } catch (error) {
    log(`Error fetching all orders: ${(error as Error).message}`, {
      type: 'error',
      metadata: { error: (error as Error).message },
    });
    throw error;
  }
}

/**
 * Wait for an order to be filled or timeout
 *
 * @param client - AlpacaClient instance
 * @param params - Order ID and timeout parameters
 * @returns Promise resolving to fill result with order state and timing info
 *
 * @example
 * ```typescript
 * const order = await submitOrder(client, { ... });
 *
 * const result = await waitForOrderFill(client, {
 *   orderId: order.id,
 *   timeoutMs: 30000, // 30 seconds
 *   pollIntervalMs: 500 // Poll every 500ms
 * });
 *
 * if (result.filled) {
 *   console.log(`Order filled at ${result.order.filled_avg_price}`);
 * } else {
 *   console.log(`Order not filled, status: ${result.order.status}`);
 * }
 * ```
 */
export async function waitForOrderFill(
  client: AlpacaClient,
  params: WaitForOrderFillParams
): Promise<WaitForOrderFillResult> {
  const {
    orderId,
    timeoutMs = 60000,
    pollIntervalMs = 1000,
  } = params;

  const sdk = client.getSDK();
  const startTime = Date.now();

  log(`Waiting for order ${orderId} to fill (timeout: ${timeoutMs}ms)`, {
    type: 'debug',
    metadata: { orderId, timeoutMs, pollIntervalMs },
  });

  try {
    while (true) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= timeoutMs) {
        // Fetch final state before returning
        const order = (await sdk.getOrder(orderId)) as AlpacaOrder;
        log(`Order ${orderId} timed out after ${elapsed}ms, status: ${order.status}`, {
          type: 'warn',
          metadata: { orderId, elapsed, status: order.status },
        });

        return {
          filled: FILLED_ORDER_STATUSES.includes(order.status as OrderStatus),
          order,
          elapsedMs: elapsed,
        };
      }

      const order = (await sdk.getOrder(orderId)) as AlpacaOrder;

      // Check if filled
      if (FILLED_ORDER_STATUSES.includes(order.status as OrderStatus)) {
        log(`Order ${orderId} filled after ${elapsed}ms`, {
          type: 'info',
          metadata: { orderId, elapsed, status: order.status },
        });

        return {
          filled: true,
          order,
          elapsedMs: elapsed,
        };
      }

      // Check if terminal but not filled
      if (TERMINAL_ORDER_STATUSES.includes(order.status as OrderStatus)) {
        log(`Order ${orderId} reached terminal state ${order.status} after ${elapsed}ms`, {
          type: 'info',
          metadata: { orderId, elapsed, status: order.status },
        });

        return {
          filled: false,
          order,
          elapsedMs: elapsed,
        };
      }

      // Wait before next poll
      await delay(pollIntervalMs);
    }
  } catch (error) {
    log(`Error waiting for order fill: ${(error as Error).message}`, {
      type: 'error',
      metadata: { orderId, error: (error as Error).message },
    });
    throw error;
  }
}

/**
 * Check if an order can still be filled
 *
 * @param order - AlpacaOrder to check
 * @returns True if the order can potentially still be filled
 *
 * @example
 * ```typescript
 * const order = await getOrder(client, orderId);
 * if (isOrderFillable(order)) {
 *   console.log('Order is still active and may be filled');
 * } else {
 *   console.log('Order cannot be filled anymore');
 * }
 * ```
 */
export function isOrderFillable(order: AlpacaOrder): boolean {
  return FILLABLE_ORDER_STATUSES.includes(order.status as OrderStatus);
}

/**
 * Check if an order has been filled
 *
 * @param order - AlpacaOrder to check
 * @returns True if the order has been filled
 */
export function isOrderFilled(order: AlpacaOrder): boolean {
  return FILLED_ORDER_STATUSES.includes(order.status as OrderStatus);
}

/**
 * Check if an order is in a terminal state
 *
 * @param order - AlpacaOrder to check
 * @returns True if the order is in a terminal state (no longer active)
 */
export function isOrderTerminal(order: AlpacaOrder): boolean {
  return TERMINAL_ORDER_STATUSES.includes(order.status as OrderStatus);
}

/**
 * Check if an order is open (active, waiting to be filled)
 *
 * @param order - AlpacaOrder to check
 * @returns True if the order is open
 */
export function isOrderOpen(order: AlpacaOrder): boolean {
  return OPEN_ORDER_STATUSES.includes(order.status as OrderStatus);
}

/**
 * Calculate the total value of an order
 * For filled orders, uses the filled quantity and average price.
 * For unfilled orders, uses the order quantity and limit/stop price.
 *
 * @param order - AlpacaOrder to calculate value for
 * @returns Total order value, or null if cannot be calculated
 *
 * @example
 * ```typescript
 * const order = await getOrder(client, orderId);
 * const value = calculateOrderValue(order);
 * if (value !== null) {
 *   console.log(`Order value: $${value.toFixed(2)}`);
 * }
 * ```
 */
export function calculateOrderValue(order: AlpacaOrder): number | null {
  // For filled orders, use filled quantity and average price
  if (isOrderFilled(order)) {
    const filledQty = parseFloat(order.filled_qty);
    const avgPrice = order.filled_avg_price ? parseFloat(order.filled_avg_price) : null;

    if (avgPrice !== null && !isNaN(filledQty) && !isNaN(avgPrice)) {
      return filledQty * avgPrice;
    }
  }

  // For notional orders
  if (order.notional) {
    const notionalValue = parseFloat(order.notional);
    if (!isNaN(notionalValue)) {
      return notionalValue;
    }
  }

  // For limit orders, use limit price
  if (order.limit_price && order.qty) {
    const qty = parseFloat(order.qty);
    const limitPrice = parseFloat(order.limit_price);

    if (!isNaN(qty) && !isNaN(limitPrice)) {
      return qty * limitPrice;
    }
  }

  // For stop orders, use stop price
  if (order.stop_price && order.qty) {
    const qty = parseFloat(order.qty);
    const stopPrice = parseFloat(order.stop_price);

    if (!isNaN(qty) && !isNaN(stopPrice)) {
      return qty * stopPrice;
    }
  }

  // Cannot calculate value (e.g., market orders without fill info)
  return null;
}

/**
 * Format an order for logging or display
 *
 * @param order - AlpacaOrder to format
 * @returns OrderSummary with formatted fields
 *
 * @example
 * ```typescript
 * const order = await getOrder(client, orderId);
 * const summary = formatOrderSummary(order);
 * console.log(`${summary.side.toUpperCase()} ${summary.qty} ${summary.symbol} @ ${summary.avgFillPrice || summary.limitPrice || 'MARKET'}`);
 * ```
 */
export function formatOrderSummary(order: AlpacaOrder): OrderSummary {
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    status: order.status,
    qty: order.qty || '0',
    filledQty: order.filled_qty || '0',
    limitPrice: order.limit_price,
    stopPrice: order.stop_price,
    avgFillPrice: order.filled_avg_price,
    createdAt: order.created_at,
    filledAt: order.filled_at,
    timeInForce: order.time_in_force,
    assetClass: order.asset_class,
  };
}

/**
 * Format order summary as a single-line string for logging
 *
 * @param order - AlpacaOrder to format
 * @returns Formatted string for logging
 *
 * @example
 * ```typescript
 * const order = await getOrder(client, orderId);
 * console.log(formatOrderForLog(order));
 * // Output: "BUY 100 AAPL LIMIT @ $150.00 [filled] - filled 100 @ $149.95"
 * ```
 */
export function formatOrderForLog(order: AlpacaOrder): string {
  const side = order.side.toUpperCase();
  const qty = order.qty || order.notional || '?';
  const qtyLabel = order.notional ? `$${order.notional}` : qty;
  const type = order.type.toUpperCase();

  let priceInfo = '';
  if (order.limit_price) {
    priceInfo = ` @ $${order.limit_price}`;
  } else if (order.stop_price) {
    priceInfo = ` stop @ $${order.stop_price}`;
  } else if (order.trail_percent) {
    priceInfo = ` trail ${order.trail_percent}%`;
  }

  let fillInfo = '';
  if (order.filled_qty && parseFloat(order.filled_qty) > 0) {
    fillInfo = ` - filled ${order.filled_qty}`;
    if (order.filled_avg_price) {
      fillInfo += ` @ $${order.filled_avg_price}`;
    }
  }

  return `${side} ${qtyLabel} ${order.symbol} ${type}${priceInfo} [${order.status}]${fillInfo}`;
}

/**
 * Round prices correctly for Alpaca API
 * Uses 2 decimal places for prices >= $1
 * Uses 4 decimal places for prices < $1 (penny stocks, crypto)
 *
 * @param price - Price to round
 * @returns Formatted price string
 *
 * @example
 * ```typescript
 * roundPriceForAlpaca(150.12345) // "150.12"
 * roundPriceForAlpaca(0.12345)   // "0.1235"
 * roundPriceForAlpaca(0.00123)   // "0.0012"
 * ```
 */
export function roundPriceForAlpaca(price: number): string {
  if (price >= 1) {
    return price.toFixed(2);
  }
  return price.toFixed(4);
}

/**
 * Round price as a number for calculations
 *
 * @param price - Price to round
 * @returns Rounded price as number
 */
export function roundPriceForAlpacaNumber(price: number): number {
  if (price >= 1) {
    return Math.round(price * 100) / 100;
  }
  return Math.round(price * 10000) / 10000;
}

/**
 * Get orders grouped by symbol
 *
 * @param orders - Array of orders to group
 * @returns Map of symbol to orders
 *
 * @example
 * ```typescript
 * const orders = await getAllOrders(client, { fetchAll: true });
 * const bySymbol = groupOrdersBySymbol(orders);
 *
 * for (const [symbol, symbolOrders] of bySymbol) {
 *   console.log(`${symbol}: ${symbolOrders.length} orders`);
 * }
 * ```
 */
export function groupOrdersBySymbol(orders: AlpacaOrder[]): Map<string, AlpacaOrder[]> {
  const grouped = new Map<string, AlpacaOrder[]>();

  for (const order of orders) {
    const existing = grouped.get(order.symbol) || [];
    existing.push(order);
    grouped.set(order.symbol, existing);
  }

  return grouped;
}

/**
 * Get orders grouped by status
 *
 * @param orders - Array of orders to group
 * @returns Map of status to orders
 */
export function groupOrdersByStatus(orders: AlpacaOrder[]): Map<string, AlpacaOrder[]> {
  const grouped = new Map<string, AlpacaOrder[]>();

  for (const order of orders) {
    const existing = grouped.get(order.status) || [];
    existing.push(order);
    grouped.set(order.status, existing);
  }

  return grouped;
}

/**
 * Calculate total filled value across multiple orders
 *
 * @param orders - Array of orders
 * @returns Total filled value
 */
export function calculateTotalFilledValue(orders: AlpacaOrder[]): number {
  let total = 0;

  for (const order of orders) {
    if (isOrderFilled(order)) {
      const value = calculateOrderValue(order);
      if (value !== null) {
        total += value;
      }
    }
  }

  return total;
}

/**
 * Filter orders by date range
 *
 * @param orders - Array of orders to filter
 * @param startDate - Start of date range (inclusive)
 * @param endDate - End of date range (inclusive)
 * @returns Filtered orders
 */
export function filterOrdersByDateRange(
  orders: AlpacaOrder[],
  startDate: Date,
  endDate: Date
): AlpacaOrder[] {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  return orders.filter((order) => {
    const orderDate = new Date(order.created_at).getTime();
    return orderDate >= startMs && orderDate <= endMs;
  });
}

/**
 * Sort orders by created date
 *
 * @param orders - Array of orders to sort
 * @param direction - Sort direction ('asc' or 'desc')
 * @returns Sorted orders (new array)
 */
export function sortOrdersByDate(
  orders: AlpacaOrder[],
  direction: 'asc' | 'desc' = 'desc'
): AlpacaOrder[] {
  const sorted = [...orders];

  sorted.sort((a, b) => {
    const dateA = new Date(a.created_at).getTime();
    const dateB = new Date(b.created_at).getTime();

    return direction === 'asc' ? dateA - dateB : dateB - dateA;
  });

  return sorted;
}

/**
 * Default export containing all order utility functions
 */
export default {
  // Query functions
  getOrdersBySymbol,
  getOpenOrders,
  getFilledOrders,
  getOrderHistory,
  getAllOrders,
  waitForOrderFill,
  // Status check functions
  isOrderFillable,
  isOrderFilled,
  isOrderTerminal,
  isOrderOpen,
  // Value calculation
  calculateOrderValue,
  calculateTotalFilledValue,
  // Formatting
  formatOrderSummary,
  formatOrderForLog,
  roundPriceForAlpaca,
  roundPriceForAlpacaNumber,
  // Grouping and filtering
  groupOrdersBySymbol,
  groupOrdersByStatus,
  filterOrdersByDateRange,
  sortOrdersByDate,
};
