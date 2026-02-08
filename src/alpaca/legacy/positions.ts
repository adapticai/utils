/**
 * Legacy Alpaca Position Functions
 * Position management using AlpacaAuth pattern with direct fetch calls.
 */
import {
  AlpacaAuth,
  AlpacaOrder,
  AlpacaPosition,
} from '../../types/alpaca-types';
import { validateAuth } from './auth';
import { createOrder, getOrders, cancelOrder, cancelAllOrders, createLimitOrder, makeRequest } from './orders';
import { getLatestQuotes } from './market-data';
import { roundPriceForAlpaca } from './utils';
import { getTradingApiUrl } from '../../config/api-endpoints';
import { getLogger } from '../../logger';
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from '../../http-timeout';

/**
 * Fetches all positions for an Alpaca trading account.
 * @param auth - The authentication details for Alpaca
 * @returns The list of positions
 */
export async function fetchAllPositions(auth: AlpacaAuth): Promise<AlpacaPosition[]> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');
    const apiUrl = `${apiBaseUrl}/v2/positions`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch positions: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaPosition[];
  } catch (error) {
    getLogger().error('Error in fetchAllPositions:', error);
    throw error;
  }
}

/**
 * Fetches a specific position for an Alpaca account.
 * @param auth - The authentication details for Alpaca
 * @param symbolOrAssetId - The symbol or asset ID to fetch the position for
 * @returns The position details or null with message if not found
 */
export async function fetchPosition(auth: AlpacaAuth, symbolOrAssetId: string): Promise<{ position: AlpacaPosition | null; message?: string }> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');

    const response = await fetch(`${apiBaseUrl}/v2/positions/${symbolOrAssetId}`, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        return { position: null, message: `Position does not exist: ${symbolOrAssetId}` };
      } else {
        throw new Error(`Failed to fetch position: ${response.status} ${response.statusText} ${errorText}`);
      }
    }

    const position = (await response.json()) as AlpacaPosition;
    return { position };
  } catch (error) {
    getLogger().error('Error in fetchPosition:', error);
    throw error;
  }
}

/**
 * Closes a specific position in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param symbolOrAssetId - The symbol or asset ID of the position to close
 * @param params - Optional parameters for closing the position
 * @returns The order created to close the position
 */
export async function closePosition(
  auth: AlpacaAuth,
  symbolOrAssetId: string,
  params?: {
    qty?: number;
    percentage?: number;
    useLimitOrder?: boolean;
    cancelOrders?: boolean;
    slippagePercent1?: number;
    extendedHours?: boolean;
  }
): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');

    const useLimitOrder = params?.useLimitOrder ?? false;
    const cancelOrdersFlag = params?.cancelOrders ?? true;
    const slippagePercent1 = params?.slippagePercent1 ?? 0.1;
    const extendedHours = params?.extendedHours ?? false;

    // Cancel open orders for this symbol if requested
    if (cancelOrdersFlag) {
      getLogger().info(`Canceling open orders for ${symbolOrAssetId} before closing position`, {
        account: auth.adapticAccountId || 'direct',
        symbol: symbolOrAssetId
      });

      const openOrders = await getOrders(auth, { status: 'open', symbols: [symbolOrAssetId] });

      for (const order of openOrders) {
        if (order.symbol === symbolOrAssetId) {
          await cancelOrder(auth, order.id);
        }
      }
    }

    if (useLimitOrder) {
      const { position } = await fetchPosition(auth, symbolOrAssetId);

      if (!position) {
        throw new Error(`Position not found for ${symbolOrAssetId}`);
      }

      // Construct global Alpaca Auth for quote fetching
      const alpacaAuth = {
        type: 'LIVE',
        alpacaApiKey: process.env.ALPACA_API_KEY,
        alpacaApiSecret: process.env.ALPACA_SECRET_KEY,
      } as AlpacaAuth;

      const quotesResponse = await getLatestQuotes(alpacaAuth, { symbols: [symbolOrAssetId] });
      const quote = quotesResponse.quotes[symbolOrAssetId];

      if (!quote) {
        throw new Error(`No quote available for ${symbolOrAssetId}`);
      }

      let qty = Math.abs(parseFloat(position.qty));
      if (params?.qty !== undefined) {
        qty = params.qty;
      } else if (params?.percentage !== undefined) {
        qty = Math.abs(parseFloat(position.qty)) * (params.percentage / 100);
      }

      const side = position.side === 'long' ? 'sell' : 'buy';
      const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';
      const currentPrice = side === 'sell' ? quote.bp : quote.ap;

      if (!currentPrice) {
        throw new Error(`No valid price available for ${symbolOrAssetId}`);
      }

      const limitSlippage = slippagePercent1 / 100;
      const limitPrice = side === 'sell'
        ? roundPriceForAlpaca(currentPrice * (1 - limitSlippage))
        : roundPriceForAlpaca(currentPrice * (1 + limitSlippage));

      getLogger().info(`Creating limit order to close ${symbolOrAssetId} position: ${side} ${qty} shares at ${limitPrice.toFixed(2)}`, {
        account: auth.adapticAccountId || 'direct',
        symbol: symbolOrAssetId
      });

      return await createLimitOrder(auth, {
        symbol: symbolOrAssetId,
        qty,
        side,
        limitPrice,
        position_intent: positionIntent,
        extended_hours: extendedHours
      });
    } else {
      const queryParams = new URLSearchParams();
      if (params?.qty !== undefined) {
        queryParams.append('qty', params.qty.toString());
      }
      if (params?.percentage !== undefined) {
        queryParams.append('percentage', params.percentage.toString());
      }

      const queryString = queryParams.toString();
      const url = `${apiBaseUrl}/v2/positions/${encodeURIComponent(symbolOrAssetId)}${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'APCA-API-KEY-ID': APIKey,
          'APCA-API-SECRET-KEY': APISecret,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to close position: ${response.status} ${response.statusText} ${errorText}`);
      }

      return (await response.json()) as AlpacaOrder;
    }
  } catch (error) {
    getLogger().error('Error in closePosition:', error);
    throw error;
  }
}

/**
 * Closes all positions in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param params - Optional parameters for closing all positions
 * @returns The status of each position closure attempt
 */
export async function closeAllPositions(
  auth: AlpacaAuth,
  params: {
    cancel_orders?: boolean;
    useLimitOrders?: boolean;
    slippagePercent1?: number;
  } = { cancel_orders: true, useLimitOrders: false, slippagePercent1: 0.1 }
): Promise<Array<{ symbol: string; status: number; body?: AlpacaOrder }> | void> {
  const { cancel_orders, useLimitOrders, slippagePercent1 = 0.1 } = params;
  getLogger().info(`Closing all positions${useLimitOrders ? ' using limit orders' : ''}${cancel_orders ? ' and canceling open orders' : ''}`, {
    account: auth.adapticAccountId || 'direct'
  });

  if (useLimitOrders) {
    const positions = await fetchAllPositions(auth);

    if (positions.length === 0) {
      getLogger().info('No positions to close', {
        account: auth.adapticAccountId || 'direct'
      });
      return [];
    }

    getLogger().info(`Found ${positions.length} positions to close`, {
      account: auth.adapticAccountId || 'direct'
    });

    const alpacaAuth = {
      type: 'LIVE',
      alpacaApiKey: process.env.ALPACA_API_KEY,
      alpacaApiSecret: process.env.ALPACA_SECRET_KEY,
    } as AlpacaAuth;

    const symbols = positions.map(position => position.symbol);
    const quotesResponse = await getLatestQuotes(alpacaAuth, { symbols });

    const lengthOfQuotes = Object.keys(quotesResponse.quotes).length;
    if (lengthOfQuotes === 0) {
      getLogger().error('No quotes available for positions, received 0 quotes', {
        account: auth.adapticAccountId || 'direct',
        type: 'error'
      });
      return [];
    }

    if (lengthOfQuotes !== positions.length) {
      getLogger().warn(`Received ${lengthOfQuotes} quotes for ${positions.length} positions, expected ${positions.length} quotes`, {
        account: auth.adapticAccountId || 'direct',
        type: 'warn'
      });
      return [];
    }

    for (const position of positions) {
      const quote = quotesResponse.quotes[position.symbol];
      if (!quote) {
        getLogger().warn(`No quote available for ${position.symbol}, skipping limit order`, {
          account: auth.adapticAccountId || 'direct',
          symbol: position.symbol,
          type: 'warn'
        });
        continue;
      }

      const qty = Math.abs(parseFloat(position.qty));
      const side = position.side === 'long' ? 'sell' : 'buy';
      const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';
      const currentPrice = side === 'sell' ? quote.bp : quote.ap;

      if (!currentPrice) {
        getLogger().warn(`No valid price available for ${position.symbol}, skipping limit order`, {
          account: auth.adapticAccountId || 'direct',
          symbol: position.symbol,
          type: 'warn'
        });
        continue;
      }

      const limitSlippage = slippagePercent1 / 100;
      const limitPrice = side === 'sell'
        ? roundPriceForAlpaca(currentPrice * (1 - limitSlippage))
        : roundPriceForAlpaca(currentPrice * (1 + limitSlippage));

      getLogger().info(`Creating limit order to close ${position.symbol} position: ${side} ${qty} shares at ${limitPrice.toFixed(2)}`, {
        account: auth.adapticAccountId || 'direct',
        symbol: position.symbol
      });

      await createLimitOrder(auth, {
        symbol: position.symbol,
        qty,
        side,
        limitPrice,
        position_intent: positionIntent,
        extended_hours: false
      });
    }
  } else {
    const response = await makeRequest<{ symbol: string; status: number; body?: AlpacaOrder }[]>(auth, {
      endpoint: '/v2/positions', method: 'DELETE', queryString: cancel_orders ? '?cancel_orders=true' : ''
    });
    return response;
  }
}

/**
 * Closes all positions in Alpaca using limit orders during extended hours trading.
 * @param auth - The authentication details for Alpaca
 * @param params - Optional parameters for closing all positions
 * @returns The status of each position closure attempt
 */
export async function closeAllPositionsAfterHours(
  auth: AlpacaAuth,
  params: {
    cancel_orders?: boolean;
    slippagePercent1?: number;
  } = { cancel_orders: true, slippagePercent1: 0.1 }
): Promise<Array<{ symbol: string; status: number; body?: AlpacaOrder }> | void> {
  getLogger().info('Closing all positions using limit orders during extended hours trading', {
    account: auth.adapticAccountId || 'direct'
  });

  const { cancel_orders, slippagePercent1 = 0.1 } = params;

  const positions = await fetchAllPositions(auth);

  if (positions.length === 0) {
    getLogger().info('No positions to close', {
      account: auth.adapticAccountId || 'direct'
    });
    return;
  }

  getLogger().info(`Found ${positions.length} positions to close`, {
    account: auth.adapticAccountId || 'direct'
  });

  if (cancel_orders) {
    await cancelAllOrders(auth);
    getLogger().info('Cancelled all open orders', {
      account: auth.adapticAccountId || 'direct'
    });
  }

  const alpacaAuth = {
    type: 'LIVE',
    alpacaApiKey: process.env.ALPACA_API_KEY,
    alpacaApiSecret: process.env.ALPACA_SECRET_KEY,
  } as AlpacaAuth;

  const symbols = positions.map(position => position.symbol);
  const quotesResponse = await getLatestQuotes(alpacaAuth, { symbols });

  for (const position of positions) {
    const quote = quotesResponse.quotes[position.symbol];
    if (!quote) {
      getLogger().warn(`No quote available for ${position.symbol}, skipping limit order`, {
        account: auth.adapticAccountId || 'direct',
        symbol: position.symbol,
        type: 'warn'
      });
      continue;
    }

    const qty = Math.abs(parseFloat(position.qty));
    const side = position.side === 'long' ? 'sell' : 'buy';
    const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';
    const currentPrice = side === 'sell' ? quote.bp : quote.ap;

    if (!currentPrice) {
      getLogger().warn(`No valid price available for ${position.symbol}, skipping limit order`, {
        account: auth.adapticAccountId || 'direct',
        symbol: position.symbol,
        type: 'warn'
      });
      continue;
    }

    const limitSlippage = slippagePercent1 / 100;
    const limitPrice = side === 'sell'
      ? roundPriceForAlpaca(currentPrice * (1 - limitSlippage))
      : roundPriceForAlpaca(currentPrice * (1 + limitSlippage));

    getLogger().info(`Creating extended hours limit order to close ${position.symbol} position: ${side} ${qty} shares at ${limitPrice.toFixed(2)}`, {
      account: auth.adapticAccountId || 'direct',
      symbol: position.symbol
    });

    await createLimitOrder(auth, {
      symbol: position.symbol,
      qty,
      side,
      limitPrice,
      position_intent: positionIntent,
      extended_hours: true
    });
  }

  getLogger().info(`All positions closed: ${positions.map(p => p.symbol).join(', ')}`, {
    account: auth.adapticAccountId || 'direct'
  });
}
