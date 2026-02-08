/**
 * Legacy Alpaca Order Functions
 * Order management using AlpacaAuth pattern with direct fetch calls.
 */
import {
  AlpacaAuth,
  AlpacaOrder,
  CreateOrderParams,
  GetOrdersParams,
  ReplaceOrderParams,
} from '../../types/alpaca-types';
import { validateAuth } from './auth';
import { getTradingApiUrl, MARKET_DATA_API } from '../../config/api-endpoints';
import { getLogger } from '../../logger';
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from '../../http-timeout';

const PAGINATION_DELAY_MS = 300;
const ORDER_CHUNK_SIZE = 500;

/**
 * Makes a generic authenticated request to the Alpaca API.
 * @param auth - The authentication details for Alpaca
 * @param params - Request parameters including endpoint, method, body, queryString, and apiBaseUrl
 * @returns The parsed JSON response
 * @throws Error if the request fails
 */
export async function makeRequest<T = unknown>(
  auth: AlpacaAuth,
  params: {
    endpoint: string;
    method: string;
    body?: Record<string, unknown> | CreateOrderParams;
    queryString?: string;
    apiBaseUrl?: string;
  }
): Promise<T> {
  const { endpoint, method, body, queryString, apiBaseUrl } = params;

  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrlInner = apiBaseUrl ? apiBaseUrl : getTradingApiUrl(type as 'PAPER' | 'LIVE');
    if (!APIKey || !APISecret) {
      throw new Error('No valid Alpaca authentication found. Please provide either auth object or set ALPACA_API_KEY and ALPACA_API_SECRET environment variables.');
    }

    const url = `${apiBaseUrlInner}${endpoint}${queryString || ''}`;

    getLogger().info(`Making ${method} request to ${endpoint}${queryString || ''}`, {
      account: auth.adapticAccountId || 'direct',
      source: 'AlpacaAPI'
    });

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
      },
    };

    // Only add Content-Type and body for non-GET/HEAD requests that have a body
    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.headers = {
        ...fetchOptions.headers,
        'Content-Type': 'application/json',
      };
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, { ...fetchOptions, signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API) });

    // Handle 207 Multi-Status responses (used by closeAll positions)
    if (response.status === 207 || response.ok) {
      return await response.json();
    }

    const errorText = await response.text();
    getLogger().error(`Alpaca API error (${response.status}): ${errorText}`, {
      account: auth.adapticAccountId || 'direct',
      source: 'AlpacaAPI',
      type: 'error'
    });
    throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
  } catch (err) {
    const error = err as Error;
    getLogger().error(`Error in makeRequest: ${error.message}`, {
      source: 'AlpacaAPI',
      type: 'error'
    });
    throw error;
  }
}

/**
 * Creates a new order in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param params - The parameters for creating the order
 * @returns The created order
 */
export async function createOrder(auth: AlpacaAuth, params: CreateOrderParams): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');

    const response = await fetch(`${apiBaseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create order: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    getLogger().error('Error in createOrder:', error);
    throw error;
  }
}

/**
 * Retrieves a list of orders from Alpaca with automatic pagination.
 * @param auth - The authentication details for Alpaca
 * @param params - The parameters for fetching orders
 * @returns The list of orders
 */
export async function getOrders(auth: AlpacaAuth, params: GetOrdersParams = {}): Promise<AlpacaOrder[]> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');

    const allOrders: AlpacaOrder[] = [];
    let currentUntil = params.until ? params.until : new Date().toISOString();

    while (true) {
      const queryParams = new URLSearchParams();
      if (params.status) queryParams.append('status', params.status);
      queryParams.append('limit', ORDER_CHUNK_SIZE.toString());
      if (params.after) queryParams.append('after', params.after);
      queryParams.append('until', currentUntil);
      if (params.direction) queryParams.append('direction', params.direction);
      if (params.nested) queryParams.append('nested', params.nested.toString());
      if (params.symbols) queryParams.append('symbols', params.symbols.join(','));
      if (params.side) queryParams.append('side', params.side);

      const response = await fetch(`${apiBaseUrl}/v2/orders?${queryParams}`, {
        method: 'GET',
        headers: {
          'APCA-API-KEY-ID': APIKey,
          'APCA-API-SECRET-KEY': APISecret,
        },
        signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get orders: ${response.status} ${response.statusText} ${errorText}`);
      }

      const orders = (await response.json()) as AlpacaOrder[];
      allOrders.push(...orders);

      if (orders.length < ORDER_CHUNK_SIZE) break;

      const lastOrder = orders[orders.length - 1];
      if (!lastOrder.submitted_at) break;
      currentUntil = lastOrder.submitted_at;
      await new Promise((resolve) => setTimeout(resolve, PAGINATION_DELAY_MS));
    }

    return allOrders;
  } catch (error) {
    getLogger().error('Error in getOrders:', error);
    throw error;
  }
}

/**
 * Cancels all orders in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @returns The list of canceled orders with their statuses
 */
export async function cancelAllOrders(auth: AlpacaAuth): Promise<{ id: string; status: number }[]> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');

    const response = await fetch(`${apiBaseUrl}/v2/orders`, {
      method: 'DELETE',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cancel orders: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as { id: string; status: number }[];
  } catch (error) {
    getLogger().error('Error in cancelAllOrders:', error);
    throw error;
  }
}

/**
 * Retrieves a specific order from Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param orderId - The ID of the order to retrieve
 * @param nested - Whether to include nested details
 * @returns The requested order
 */
export async function getOrder(auth: AlpacaAuth, orderId: string, nested?: boolean): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');

    const queryParams = new URLSearchParams();
    if (nested) queryParams.append('nested', 'true');

    const response = await fetch(`${apiBaseUrl}/v2/orders/${orderId}?${queryParams}`, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get order: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    getLogger().error('Error in getOrder:', error);
    throw error;
  }
}

/**
 * Replaces an existing order in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param orderId - The ID of the order to replace
 * @param params - The parameters for replacing the order
 * @returns The updated order
 */
export async function replaceOrder(auth: AlpacaAuth, orderId: string, params: ReplaceOrderParams): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');

    const response = await fetch(`${apiBaseUrl}/v2/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(params),
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to replace order: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    getLogger().error('Error in replaceOrder:', error);
    throw error;
  }
}

/**
 * Cancels a specific order in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param orderId - The ID of the order to cancel
 * @returns Success status and optional message if order not found
 */
export async function cancelOrder(auth: AlpacaAuth, orderId: string): Promise<{ success: boolean; message?: string }> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');

    const response = await fetch(`${apiBaseUrl}/v2/orders/${orderId}`, {
      method: 'DELETE',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        return { success: false, message: `Order not found: ${orderId}` };
      } else {
        throw new Error(`Failed to cancel order: ${response.status} ${response.statusText} ${errorText}`);
      }
    }

    return { success: true };
  } catch (error) {
    getLogger().error('Error in cancelOrder:', error);
    throw error;
  }
}

/**
 * Creates a limit order in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param params - Order parameters including symbol, qty, side, limitPrice, position_intent, extended_hours
 * @returns The created limit order
 */
export async function createLimitOrder(
  auth: AlpacaAuth,
  params: {
    symbol: string;
    qty: number;
    side: 'buy' | 'sell';
    limitPrice: number;
    position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
    extended_hours: boolean;
    client_order_id?: string;
  } = {
    symbol: '',
    qty: 0,
    side: 'buy',
    limitPrice: 0,
    position_intent: 'buy_to_open',
    extended_hours: false,
    client_order_id: undefined
  }
): Promise<AlpacaOrder> {
  const { symbol, qty, side, limitPrice, position_intent, extended_hours, client_order_id } = params;

  getLogger().info(`Creating limit order for ${symbol}: ${side} ${qty} shares at ${limitPrice.toFixed(2)} (${position_intent})`, {
    account: auth.adapticAccountId || 'direct',
    symbol
  });

  const body: Record<string, unknown> = {
    symbol,
    qty: Math.abs(qty),
    side,
    position_intent,
    type: 'limit',
    limit_price: limitPrice.toString(),
    time_in_force: 'day',
    order_class: 'simple',
    extended_hours,
  };
  if (client_order_id !== undefined) {
    body.client_order_id = client_order_id;
  }

  return makeRequest(auth, {
    endpoint: '/v2/orders',
    method: 'POST',
    body,
  });
}
