// alpaca.ts
// functions related to Alpaca accounts

import { types } from '@adaptic/backend-legacy';
import adaptic from '@adaptic/backend-legacy';
import { getSharedApolloClient } from './adaptic';
import {
  AccountConfiguration,
  AlpacaPosition,
  NewsResponse,
  SimpleNews,
  CreateOrderParams,
  GetOrdersParams,
  AlpacaOrder,
  ReplaceOrderParams,
  AlpacaAuth,
  AlpacaAccountDetails,
  PortfolioHistoryResponse,
  FetchPortfolioHistoryProps,
  AlpacaAsset,
  DataFeed,
  LatestQuotesResponse,

} from './types/alpaca-types';
import { logIfDebug } from './misc-utils.js';
import { ApolloClientType, NormalizedCacheObject } from '@adaptic/backend-legacy';

/**
 * Round a price to the nearest 2 decimal places for Alpaca, or 4 decimal places for prices less than $1
 * @param price - The price to round
 * @returns The rounded price
 */
const roundPriceForAlpaca = (price: number): number => {
  return price >= 1
    ? Math.round(price * 100) / 100
    : Math.round(price * 10000) / 10000;
};

const ALPACA_API_BASE = 'https://data.alpaca.markets/v1beta1';

interface ValidatedAuth {
  APIKey: string;
  APISecret: string;
  type: string;
}

async function validateAuth(auth: AlpacaAuth): Promise<ValidatedAuth> {
  if (auth.adapticAccountId) {
    // Get shared Apollo client for connection pooling
    const client = await getSharedApolloClient();

    const alpacaAccount = (await adaptic.alpacaAccount.get({
      id: auth.adapticAccountId,
    } as types.AlpacaAccount, client)) as types.AlpacaAccount;

    if (!alpacaAccount || !alpacaAccount.APIKey || !alpacaAccount.APISecret) {
      throw new Error('Alpaca account not found or incomplete');
    }


    return {
      APIKey: alpacaAccount.APIKey,
      APISecret: alpacaAccount.APISecret,
      type: alpacaAccount.type,
    };
  } else if (auth.alpacaApiKey && auth.alpacaApiSecret) {
    const accountType = auth.type || 'PAPER'; // Default to live if type is not provided
    return {
      APIKey: auth.alpacaApiKey,
      APISecret: auth.alpacaApiSecret,
      type: accountType,
    };
  }

  throw new Error('Either adapticAccountId or both alpacaApiKey and alpacaApiSecret must be provided');
}

/**
 * Creates a new order in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {CreateOrderParams} params - The parameters for creating the order.
 * @returns {Promise<Order>} The created order.
 */

// Orders API functions
export async function createOrder(auth: AlpacaAuth, params: CreateOrderParams): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);

    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    const response = await fetch(`${apiBaseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create order: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    console.error('Error in createOrder:', error);
    throw error;
  }
}
/**
 * Retrieves a list of orders from Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {GetOrdersParams} [params={}] - The parameters for fetching orders.
 * @returns {Promise<AlpacaOrder[]>} The list of orders.
 */

export async function getOrders(auth: AlpacaAuth, params: GetOrdersParams = {}): Promise<AlpacaOrder[]> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);

    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    const allOrders: AlpacaOrder[] = [];
    let currentUntil = params.until ? params.until : new Date().toISOString();
    const CHUNK_SIZE = 500;

    while (true) {
      const queryParams = new URLSearchParams();
      if (params.status) queryParams.append('status', params.status);
      queryParams.append('limit', CHUNK_SIZE.toString());
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
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get orders: ${response.status} ${response.statusText} ${errorText}`);
      }

      const orders = (await response.json()) as AlpacaOrder[];
      allOrders.push(...orders);

      if (orders.length < CHUNK_SIZE) break;

      const lastOrder = orders[orders.length - 1];
      if (!lastOrder.submitted_at) break;
      currentUntil = lastOrder.submitted_at;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return allOrders;
  } catch (error) {
    console.error('Error in getOrders:', error);
    throw error;
  }
}

/**
 * Cancels all orders in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @returns {Promise<{ id: string; status: number }[]>} The list of canceled orders with their statuses.
 */

export async function cancelAllOrders(auth: AlpacaAuth): Promise<{ id: string; status: number }[]> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);

    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    const response = await fetch(`${apiBaseUrl}/v2/orders`, {
      method: 'DELETE',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cancel orders: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as { id: string; status: number }[];
  } catch (error) {
    console.error('Error in cancelAllOrders:', error);
    throw error;
  }
}

/**
 * Retrieves a specific order from Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} orderId - The ID of the order to retrieve.
 * @param {boolean} [nested] - Whether to include nested details.
 * @returns {Promise<Order>} The requested order.
 */

export async function getOrder(auth: AlpacaAuth, orderId: string, nested?: boolean): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);

    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    const queryParams = new URLSearchParams();
    if (nested) queryParams.append('nested', 'true');

    const response = await fetch(`${apiBaseUrl}/v2/orders/${orderId}?${queryParams}`, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get order: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    console.error('Error in getOrder:', error);
    throw error;
  }
}

/**
 * Replaces an existing order in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} orderId - The ID of the order to replace.
 * @param {ReplaceOrderParams} params - The parameters for replacing the order.
 * @returns {Promise<Order>} The updated order.
 */

export async function replaceOrder(auth: AlpacaAuth, orderId: string, params: ReplaceOrderParams): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);

    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    const response = await fetch(`${apiBaseUrl}/v2/orders/${orderId}`, {
      method: 'PATCH',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to replace order: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    console.error('Error in replaceOrder:', error);
    throw error;
  }
}

/**
 * Cancels a specific order in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} orderId - The ID of the order to cancel.
 * @returns {Promise<{ success: boolean; message?: string }>} - Success status and optional message if order not found.
 */

export async function cancelOrder(auth: AlpacaAuth, orderId: string): Promise<{ success: boolean; message?: string }> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);

    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    const response = await fetch(`${apiBaseUrl}/v2/orders/${orderId}`, {
      method: 'DELETE',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Special handling for 404 errors
      if (response.status === 404) {
        return { success: false, message: `Order not found: ${orderId}` };
      } else {
        throw new Error(`Failed to cancel order: ${response.status} ${response.statusText} ${errorText}`);
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error in cancelOrder:', error);
    throw error;
  }
}

/**
 * Fetches news articles from Alpaca API for specified symbols.
 * @param {string} symbols - The symbols to fetch news for (comma-separated for multiple symbols, e.g. "AAPL,MSFT,GOOG")
 * @param {Object} params - Optional parameters for fetching news
 * @param {AlpacaAuth} params.auth - Optional Alpaca authentication details
 * @param {Date | string} params.start - Start date for fetching news (default is last 24 hours)
 * @param {Date | string} params.end - End date for fetching news (default is now)
 * @param {number} params.limit - Maximum number of articles to return (default is 10)
 * @param {'asc' | 'desc'} params.sort - Sorting order (default is descending)
 * @param {string} params.page_token - Token for pagination
 * @param {boolean} params.include_content - Whether to include content in the news articles (default is true)
 * @returns {Promise<{ news: SimpleNews[]; nextPageToken?: string }>} The fetched news articles.
 */
export async function fetchNews(
  symbols: string,
  params?: {
    auth?: AlpacaAuth;
    start?: Date | string;
    end?: Date | string;
    limit?: number;
    sort?: 'asc' | 'desc';
    page_token?: string;
    include_content?: boolean;
  },
): Promise<{ news: SimpleNews[]; nextPageToken?: string }> {
  // Initialize params with defaults if not provided
  const defaultParams = {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Default to last 24 hours
    end: new Date(),
    limit: 10,
    sort: 'desc' as const,
    page_token: null,
    include_content: true,
  };

  const mergedParams = { ...defaultParams, ...params };

  // Handle authentication
  let APIKey: string | undefined;
  let APISecret: string | undefined;

  if (mergedParams.auth) {
    // Try to authenticate with provided auth object
    if (mergedParams.auth.alpacaApiKey && mergedParams.auth.alpacaApiSecret) {
      APIKey = mergedParams.auth.alpacaApiKey;
      APISecret = mergedParams.auth.alpacaApiSecret;
    } else if (mergedParams.auth.adapticAccountId) {
      // Get shared Apollo client for connection pooling
      const client = await getSharedApolloClient();

      const alpacaAccount = (await adaptic.alpacaAccount.get({
        id: mergedParams.auth.adapticAccountId,
      } as types.AlpacaAccount, client)) as types.AlpacaAccount;

      if (!alpacaAccount || !alpacaAccount.APIKey || !alpacaAccount.APISecret) {
        throw new Error('Alpaca account not found or incomplete');
      }

      APIKey = alpacaAccount.APIKey;
      APISecret = alpacaAccount.APISecret;
    }
  } else {
    // Try to authenticate with environment variables
    APIKey = process.env.ALPACA_API_KEY;
    APISecret = process.env.ALPACA_SECRET_KEY;
  }

  // Throw error if no valid authentication is found
  if (!APIKey || !APISecret) {
    throw new Error('No valid Alpaca authentication found. Please provide either auth object or set ALPACA_API_KEY and ALPACA_API_SECRET environment variables.');
  }

  try {
    let newsArticles: SimpleNews[] = [];
    let pageToken = mergedParams.page_token;
    let hasMorePages = true;

    while (hasMorePages) {
      // Prepare query parameters
      const queryParams = new URLSearchParams({
        ...(mergedParams.start && { start: new Date(mergedParams.start).toISOString() }),
        ...(mergedParams.end && { end: new Date(mergedParams.end).toISOString() }),
        ...(symbols && { symbols: symbols }),
        ...(mergedParams.limit && { limit: mergedParams.limit.toString() }),
        ...(mergedParams.sort && { sort: mergedParams.sort }),
        ...(mergedParams.include_content !== undefined ? { include_content: mergedParams.include_content.toString() } : {}),
        ...(pageToken && { page_token: pageToken }),
      });

      const url = `https://data.alpaca.markets/v1beta1/news?${queryParams}`;
      logIfDebug(`Fetching news from: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'APCA-API-KEY-ID': APIKey,
          'APCA-API-SECRET-KEY': APISecret,
          'accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as NewsResponse;

      // Transform to SimpleNews format
      const transformedNews: SimpleNews[] = data.news.map((article) => ({
        symbols: article.symbols,
        title: article.headline,
        summary: cleanContent(article.summary),
        content: article.content ? cleanContent(article.content) : undefined,
        url: article.url,
        source: article.source,
        author: article.author,
        date: article.created_at,
        updatedDate: article.updated_at || article.created_at,
        sentiment: 0, // Default sentiment since it's not provided by the API
      }));

      newsArticles = newsArticles.concat(transformedNews);

      pageToken = data.next_page_token || null;
      hasMorePages = !!pageToken;

      logIfDebug(`Received ${data.news.length} news articles. More pages: ${hasMorePages}`);
    }

    // Trim results to respect the limit parameter based on sort order
    if (mergedParams.limit && newsArticles.length > mergedParams.limit) {
      // For ascending order, keep the most recent (last) articles
      // For descending order, keep the earliest (first) articles
      // This is because in ascending order, newer articles are at the end
      // In descending order, newer articles are at the beginning
      if (mergedParams.sort === 'asc') {
        newsArticles = newsArticles.slice(-mergedParams.limit);
      } else {
        newsArticles = newsArticles.slice(0, mergedParams.limit);
      }
    }

    // If sort is "asc" and limit is specified, return only the most recent articles
    if (mergedParams.sort === 'asc' && mergedParams.limit) {
      newsArticles = newsArticles.slice(-mergedParams.limit);
    }

    return {
      news: newsArticles,
      nextPageToken: pageToken || undefined,
    };
  } catch (error) {
    console.error('Error in fetchNews:', error);
    throw error;
  }
}

export interface FetchAccountDetailsProps {
  auth?: AlpacaAuth;
  accountId?: string;
  client?: ApolloClientType<NormalizedCacheObject>;
  alpacaAccount?: types.AlpacaAccount;
}
// Fetches account details from Alpaca API.
/**
 * Fetches account details from Alpaca API.
 * @param {FetchAccountDetailsProps} props - The properties for fetching account details.
 * @returns {Promise<AlpacaAccountDetails>} The account details.
 */

export async function fetchAccountDetails({ accountId, client, alpacaAccount, auth }: FetchAccountDetailsProps): Promise<AlpacaAccountDetails> {
  let alpacaAccountObj = alpacaAccount ? alpacaAccount : null;

  if (!alpacaAccountObj && auth) {
    const validatedAuth = await validateAuth(auth);
    alpacaAccountObj = {
      APIKey: validatedAuth.APIKey,
      APISecret: validatedAuth.APISecret,
      type: validatedAuth.type,
    } as types.AlpacaAccount;
  }

  if (!alpacaAccountObj) {
    try {
      // Use provided client or get the shared client
      const apolloClient = client || await getSharedApolloClient();

      alpacaAccountObj = (await adaptic.alpacaAccount.get({
        id: accountId,
      } as types.AlpacaAccount, apolloClient)) as types.AlpacaAccount;
    } catch (error) {
      console.error('[fetchAccountDetails] Error fetching Alpaca account:', error);
      throw error;
    }
  }

  if (!alpacaAccountObj || !alpacaAccountObj.APIKey || !alpacaAccountObj.APISecret) {
    throw new Error('[fetchAccountDetails] Alpaca account not found or incomplete');
  }

  const { APIKey, APISecret, type } = alpacaAccountObj;

  // Set the API URL based on the user's current mode ('PAPER' or 'LIVE')
  const apiUrl =
    type === 'PAPER' ? 'https://paper-api.alpaca.markets/v2/account' : 'https://api.alpaca.markets/v2/account';

  // Make GET request to Alpaca Markets API to fetch account details
  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch account details: ${response.statusText}`);
    }

    const data = await response.json();

    return data;
  } catch (error) {
    console.error('Error in fetchAccountDetails:', error);
    throw error;
  }
}



/**
 * Fetches portfolio history for one Alpaca account.
 * @param {FetchPortfolioHistoryProps} props - The properties for fetching portfolio history.
 * @returns {Promise<PortfolioHistoryResponse>} The portfolio history.
 */

/** Fetches portfolio history for one Alpaca account, as stored in Adaptic backend
*/
export async function fetchPortfolioHistory(
  { params,
    accountId,
    client,
    alpacaAccount }: FetchPortfolioHistoryProps
): Promise<PortfolioHistoryResponse> {

  let alpacaAccountObj = alpacaAccount ? alpacaAccount : null;

  if (!alpacaAccountObj) {
    try {
      // Use provided client or get the shared client
      const apolloClient = client || await getSharedApolloClient();

      alpacaAccountObj = (await adaptic.alpacaAccount.get({
        id: accountId,
      } as types.AlpacaAccount, apolloClient)) as types.AlpacaAccount;
    } catch (error) {
      console.error('[fetchPortfolioHistory] Error fetching Alpaca account:', error);
      throw error;
    }
  }

  if (!alpacaAccountObj || !alpacaAccountObj.APIKey || !alpacaAccountObj.APISecret) {
    throw new Error('[fetchPortfolioHistory] Alpaca account not found or incomplete');
  }

  const { APIKey, APISecret, type } = alpacaAccountObj;

  // Set the API base URL
  const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

  const apiUrl = `${apiBaseUrl}/v2/account/portfolio/history`;

  // Ensure that only two of 'start', 'end', and 'period' are specified
  const { start, end, period } = params;

  // Validate date formats
  if (start) {
    params.start = new Date(start).toISOString();
    // delete period if start is specified
    if (period) {
      delete params.period;
    }
  }
  if (end) {
    params.end = new Date(end).toISOString();
  }

  if (period === 'YTD') {
    params.period = '1A';
  }

  // Remove undefined parameters
  Object.keys(params).forEach(
    (key) => params[key as keyof typeof params] === undefined && delete params[key as keyof typeof params]
  );

  // Construct query string from params
  const queryString = new URLSearchParams(params as Record<string, string>).toString();
  const fullUrl = `${apiUrl}?${queryString}`;

  try {
    // Make GET request to Alpaca Markets API to fetch portfolio history
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch portfolio history: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = await response.json();

    return data;
  } catch (error) {
    console.error('[fetchPortfolioHistory] Error fetching portfolio history call to Alpaca:', error);
    throw error;
  }
}

/**
 * Fetches all positions for an Alpaca trading account.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @returns {Promise<AlpacaPosition[]>} The list of positions.
 */
export async function fetchAllPositions(auth: AlpacaAuth): Promise<AlpacaPosition[]> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);

    // Set the API base URL
    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    const apiUrl = `${apiBaseUrl}/v2/positions`;

    // Make GET request to Alpaca Markets API to fetch positions
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch positions: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaPosition[];
  } catch (error) {
    console.error('Error in fetchAllPositions:', error);
    throw error;
  }
}

/**
 * Fetches a specific position for an Alpaca account.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} symbolOrAssetId - The symbol or asset ID to fetch the position for.
 * @returns {Promise<{ position: AlpacaPosition | null; message?: string }>} The position details or null with message if not found.
 */
export async function fetchPosition(auth: AlpacaAuth, symbolOrAssetId: string): Promise<{ position: AlpacaPosition | null; message?: string }> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);

    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    const response = await fetch(`${apiBaseUrl}/v2/positions/${symbolOrAssetId}`, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Special handling for 404 errors
      if (response.status === 404) {
        return { position: null, message: `Position does not exist: ${symbolOrAssetId}` };
      } else {
        throw new Error(`Failed to fetch position: ${response.status} ${response.statusText} ${errorText}`);
      }
    }

    const position = (await response.json()) as AlpacaPosition;
    return { position };
  } catch (error) {
    console.error('Error in fetchPosition:', error);
    throw error;
  }
}

/**
 * Closes a specific position in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} symbolOrAssetId - The symbol or asset ID of the position to close.
 * @param {Object} [params] - Optional parameters for closing the position.
 * @param {number} [params.qty] - Quantity of shares to close (up to 9 decimal places).
 * @param {number} [params.percentage] - Percentage of position to close (0-100, up to 9 decimal places).
 * @param {boolean} [params.useLimitOrder] - Whether to use a limit order to close the position.
 * @param {boolean} [params.cancelOrders] - Whether to cancel open orders for the symbol before closing.
 * @param {number} [params.slippagePercent1] - Slippage percentage for limit orders (default: 0.1).
 * @param {boolean} [params.extendedHours] - Whether to enable extended hours trading (default: false).
 * @returns {Promise<AlpacaOrder>} The order created to close the position.
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
    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    // Default parameters
    const useLimitOrder = params?.useLimitOrder ?? false;
    const cancelOrders = params?.cancelOrders ?? true;
    const slippagePercent1 = params?.slippagePercent1 ?? 0.1;
    const extendedHours = params?.extendedHours ?? false;

    // Cancel open orders for this symbol if requested
    if (cancelOrders) {
      console.log(`Canceling open orders for ${symbolOrAssetId} before closing position`, {
        account: auth.adapticAccountId || 'direct',
        symbol: symbolOrAssetId
      });

      // Get all open orders
      const openOrders = await getOrders(auth, { status: 'open', symbols: [symbolOrAssetId]});

      // Cancel each order for this symbol
      for (const order of openOrders) {
        if (order.symbol === symbolOrAssetId) {
          await cancelOrder(auth, order.id);
        }
      }
    }

    if (useLimitOrder) {
      // Fetch position details to get quantity and side
      const { position } = await fetchPosition(auth, symbolOrAssetId);

      if (!position) {
        throw new Error(`Position not found for ${symbolOrAssetId}`);
      }

      // Construct global Alpaca Auth
      const alpacaAuth = {
        type: 'LIVE',
        alpacaApiKey: process.env.ALPACA_API_KEY,
        alpacaApiSecret: process.env.ALPACA_SECRET_KEY,
      } as AlpacaAuth;

      // Get latest quote for the symbol
      const quotesResponse = await getLatestQuotes(alpacaAuth, { symbols: [symbolOrAssetId] });
      const quote = quotesResponse.quotes[symbolOrAssetId];

      if (!quote) {
        throw new Error(`No quote available for ${symbolOrAssetId}`);
      }

      // Calculate quantity to close
      let qty = Math.abs(parseFloat(position.qty));
      if (params?.qty !== undefined) {
        qty = params.qty;
      } else if (params?.percentage !== undefined) {
        qty = Math.abs(parseFloat(position.qty)) * (params.percentage / 100);
      }

      const side = position.side === 'long' ? 'sell' : 'buy';
      const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';

      // Get the current price from the quote
      const currentPrice = side === 'sell' ? quote.bp : quote.ap; // Use bid for sells, ask for buys

      if (!currentPrice) {
        throw new Error(`No valid price available for ${symbolOrAssetId}`);
      }

      // Apply slippage
      const limitSlippage = slippagePercent1 / 100;
      const limitPrice = side === 'sell'
        ? roundPriceForAlpaca(currentPrice * (1 - limitSlippage)) // Sell slightly lower
        : roundPriceForAlpaca(currentPrice * (1 + limitSlippage)); // Buy slightly higher

      console.log(`Creating limit order to close ${symbolOrAssetId} position: ${side} ${qty} shares at ${limitPrice.toFixed(2)}`, {
        account: auth.adapticAccountId || 'direct',
        symbol: symbolOrAssetId
      });

      // Create limit order
      return await createLimitOrder(
        auth,
        {
          symbol: symbolOrAssetId,
          qty,
          side,
          limitPrice,
          position_intent: positionIntent,
          extended_hours: extendedHours
        }
      );
    } else {
      // Use the standard position closing API
      // Construct query parameters if provided
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
    console.error('Error in closePosition:', error);
    throw error;
  }
}

export async function makeRequest(
  auth: AlpacaAuth,
  params: {
    endpoint: string, method: string, body?: any, queryString?: string, apiBaseUrl?: string
  }): Promise<any> {

  const { endpoint, method, body, queryString, apiBaseUrl } = params;

  try {
    const apiBaseUrlInner = apiBaseUrl ? apiBaseUrl : auth.type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
    const { APIKey, APISecret } = await validateAuth(auth);
    if (!APIKey || !APISecret) {
      throw new Error('No valid Alpaca authentication found. Please provide either auth object or set ALPACA_API_KEY and ALPACA_API_SECRET environment variables.');
    }

    // Construct the full URL
    const url = `${apiBaseUrlInner}${endpoint}${queryString || ''}`;

    console.log(`Making ${method} request to ${endpoint}${queryString || ''}`, {
      account: auth.adapticAccountId || 'direct',
      source: 'AlpacaAPI'
    });

    // Prepare fetch options
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

    const response = await fetch(url, fetchOptions);

    // Handle 207 Multi-Status responses (used by closeAll positions)
    if (response.status === 207 || response.ok) {
      return await response.json();
    }

    // Handle errors
    const errorText = await response.text();
    console.error(`Alpaca API error (${response.status}): ${errorText}`, {
      account: auth.adapticAccountId || 'direct',
      source: 'AlpacaAPI',
      type: 'error'
    });
    throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
  } catch (err) {
    const error = err as Error;
    console.error(`Error in makeRequest: ${error.message}`, {
      source: 'AlpacaAPI',
      type: 'error'
    });
    throw error;
  }
}

/**
 * Create a limit order
 * @param symbol (string) - the symbol of the order
 * @param qty (number) - the quantity of the order
 * @param side (string) - the side of the order
 * @param limitPrice (number) - the limit price of the order
 * @param position_intent (string) - the position intent of the order
 * @param extended_hours (boolean) - whether the order is in extended hours
 * @param client_order_id (string) - the client order id of the order
 */
export async function createLimitOrder(
  auth: AlpacaAuth,
  params: {
    symbol: string,
    qty: number,
    side: 'buy' | 'sell',
    limitPrice: number,
    position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close',
    extended_hours: boolean,
    client_order_id?: string
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

  console.log(`Creating limit order for ${symbol}: ${side} ${qty} shares at ${limitPrice.toFixed(2)} (${position_intent})`, {
    account: auth.adapticAccountId || 'direct',
    symbol
  });

  const body: Record<string, any> = {
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

/**
 * Closes all positions in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {Object} [params] - Optional parameters for closing all positions.
 * @param {boolean} [params.cancelOrders] - If true, cancels all open orders before closing positions.
 * @param {boolean} [params.useLimitOrders] - If true, uses limit orders to close positions.
 * @returns {Promise<Array<{ symbol: string; status: number; body?: Order }>>} The status of each position closure attempt.
 */

export async function closeAllPositions(
  auth: AlpacaAuth,
  params: {
    cancel_orders?: boolean, useLimitOrders?: boolean, slippagePercent1?: number
  } = { cancel_orders: true, useLimitOrders: false, slippagePercent1: 0.1 }): Promise<Array<{ symbol: string; status: number; body?: AlpacaOrder }> | void> {

  const { cancel_orders, useLimitOrders, slippagePercent1 = 0.1 } = params;
  console.log(`Closing all positions${useLimitOrders ? ' using limit orders' : ''}${cancel_orders ? ' and canceling open orders' : ''}`, {
    account: auth.adapticAccountId || 'direct'
  });

  if (useLimitOrders) {
    // Get all positions
    const positions = await fetchAllPositions(auth);

    if (positions.length === 0) {
      console.log('No positions to close', {
        account: auth.adapticAccountId || 'direct'
      });
      return [];
    }

    console.log(`Found ${positions.length} positions to close`, {
      account: auth.adapticAccountId || 'direct'
    });

    // Construct global Alpaca Auth
    const alpacaAuth = {
      type: 'LIVE',
      alpacaApiKey: process.env.ALPACA_API_KEY,
      alpacaApiSecret: process.env.ALPACA_SECRET_KEY,
    } as AlpacaAuth;

    // Get latest quotes for all positions
    const symbols = positions.map(position => position.symbol);
    const quotesResponse = await getLatestQuotes(alpacaAuth, { symbols });

    const lengthOfQuotes = Object.keys(quotesResponse.quotes).length;
    if (lengthOfQuotes === 0) {
      console.error('No quotes available for positions, received 0 quotes', {
        account: auth.adapticAccountId || 'direct',
        type: 'error'
      });
      return [];
    }

    if (lengthOfQuotes !== positions.length) {
      console.warn(`Received ${lengthOfQuotes} quotes for ${positions.length} positions, expected ${positions.length} quotes`, {
        account: auth.adapticAccountId || 'direct',
        type: 'warn'
      });
      return [];
    }

    // Create limit orders to close each position
    for (const position of positions) {
      const quote = quotesResponse.quotes[position.symbol];
      if (!quote) {
        console.warn(`No quote available for ${position.symbol}, skipping limit order`, {
          account: auth.adapticAccountId || 'direct',
          symbol: position.symbol,
          type: 'warn'
        });
        continue;
      }

      const qty = Math.abs(parseFloat(position.qty));
      const side = position.side === 'long' ? 'sell' : 'buy';
      const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';

      // Get the current price from the quote
      const currentPrice = side === 'sell' ? quote.bp : quote.ap; // Use bid for sells, ask for buys

      if (!currentPrice) {
        console.warn(`No valid price available for ${position.symbol}, skipping limit order`, {
          account: auth.adapticAccountId || 'direct',
          symbol: position.symbol,
          type: 'warn'
        });
        continue;
      }

      // Apply slippage from config
      const limitSlippage = slippagePercent1 / 100;
      const limitPrice = side === 'sell'
        ? roundPriceForAlpaca(currentPrice * (1 - limitSlippage)) // Sell slightly lower
        : roundPriceForAlpaca(currentPrice * (1 + limitSlippage)); // Buy slightly higher

      console.log(`Creating limit order to close ${position.symbol} position: ${side} ${qty} shares at ${limitPrice.toFixed(2)}`, {
        account: auth.adapticAccountId || 'direct',
        symbol: position.symbol
      });

      await createLimitOrder(
        auth,
        {
          symbol: position.symbol,
          qty,
          side,
          limitPrice,
          position_intent: positionIntent,
          extended_hours: false // Set to false or true based on your requirement
        }
      );
    }
  } else {
    const response = await makeRequest(auth, {
      endpoint: '/v2/positions', method: 'DELETE', queryString: cancel_orders ? '?cancel_orders=true' : ''
    });
    return response;
  }
}

/**
 * Close all positions using limit orders during extended hours trading
 * @param cancelOrders Whether to cancel related orders (default: true)
 * @returns Promise that resolves when all positions are closed
 */

/**
 * Closes all positions in Alpaca using limit orders during extended hours trading.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {Object} [params] - Optional parameters for closing all positions.
 * @param {boolean} [params.cancelOrders] - If true, cancels all open orders before closing positions.
 * @returns {Promise<Array<{ symbol: string; status: number; body?: Order }>>} The status of each position closure attempt.
 */

export async function closeAllPositionsAfterHours(
  auth: AlpacaAuth,
  params: {
    cancel_orders?: boolean, slippagePercent1?: number
  } = { cancel_orders: true, slippagePercent1: 0.1 }): Promise<Array<{ symbol: string; status: number; body?: AlpacaOrder }> | void> {

  console.log('Closing all positions using limit orders during extended hours trading', {
    account: auth.adapticAccountId || 'direct'
  });

  const { cancel_orders, slippagePercent1 = 0.1 } = params;

  // Get all positions
  const positions = await fetchAllPositions(auth);

  if (positions.length === 0) {
    console.log('No positions to close', {
      account: auth.adapticAccountId || 'direct'
    });
    return;
  }

  console.log(`Found ${positions.length} positions to close`, {
    account: auth.adapticAccountId || 'direct'
  });

  if (cancel_orders) {
    await cancelAllOrders(auth);
    console.log('Cancelled all open orders', {
      account: auth.adapticAccountId || 'direct'
    });
  }
  // Construct global Alpaca Auth
  const alpacaAuth = {
    type: 'LIVE',
    alpacaApiKey: process.env.ALPACA_API_KEY,
    alpacaApiSecret: process.env.ALPACA_SECRET_KEY,
  } as AlpacaAuth;

  // Get latest quotes for all positions
  const symbols = positions.map(position => position.symbol);
  const quotesResponse = await getLatestQuotes(alpacaAuth, { symbols });

  // Create limit orders to close each position
  for (const position of positions) {
    const quote = quotesResponse.quotes[position.symbol];
    if (!quote) {
      console.warn(`No quote available for ${position.symbol}, skipping limit order`, {
        account: auth.adapticAccountId || 'direct',
        symbol: position.symbol,
        type: 'warn'
      });
      continue;
    }

    const qty = Math.abs(parseFloat(position.qty));
    const side = position.side === 'long' ? 'sell' : 'buy';
    const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';

    // Get the current price from the quote
    const currentPrice = side === 'sell' ? quote.bp : quote.ap; // Use bid for sells, ask for buys

    if (!currentPrice) {
      console.warn(`No valid price available for ${position.symbol}, skipping limit order`, {
        account: auth.adapticAccountId || 'direct',
        symbol: position.symbol,
        type: 'warn'
      });
      continue;
    }

    // Apply slippage from config
    const limitSlippage = slippagePercent1 / 100;

    const limitPrice = side === 'sell'
      ? roundPriceForAlpaca(currentPrice * (1 - limitSlippage)) // Sell slightly lower
      : roundPriceForAlpaca(currentPrice * (1 + limitSlippage)); // Buy slightly higher

    console.log(`Creating extended hours limit order to close ${position.symbol} position: ${side} ${qty} shares at ${limitPrice.toFixed(2)}`, {
      account: auth.adapticAccountId || 'direct',
      symbol: position.symbol
    });

    await createLimitOrder(
      auth,
      {
        symbol: position.symbol,
        qty,
        side,
        limitPrice,
        position_intent: positionIntent,
        extended_hours: true // Enable extended hours trading
      }
    );
  }

  console.log(`All positions closed: ${positions.map(p => p.symbol).join(', ')}`, {
    account: auth.adapticAccountId || 'direct'
  });
}

/**
  * Get the most recent quotes for requested symbols
  * @param symbols Array of stock symbols to query
  * @param feed Optional data source (sip/iex/delayed_sip)
  * @param currency Optional currency in ISO 4217 format
  * @returns Latest quote data for each symbol
  * @throws Error if request fails or rate limit exceeded
  */
export async function getLatestQuotes(auth: AlpacaAuth, params: { symbols: string[], feed?: DataFeed, currency?: string }): Promise<LatestQuotesResponse> {
  const DEFAULT_CURRENCY = 'USD';
  const DEFAULT_FEED = 'sip';

  const { symbols, feed, currency } = params;

  // Return empty response if symbols array is empty to avoid API error
  if (!symbols || symbols.length === 0) {
    console.warn('No symbols provided to getLatestQuotes, returning empty response', {
      type: 'warn'
    });
    return {
      quotes: {},
      currency: currency || DEFAULT_CURRENCY
    };
  }

  // For GET requests, we should use query parameters instead of body
  const queryParams = new URLSearchParams();
  queryParams.append('symbols', symbols.join(','));
  queryParams.append('feed', feed || DEFAULT_FEED);
  queryParams.append('currency', currency || DEFAULT_CURRENCY);

  return makeRequest(auth, {
    endpoint: '/v2/stocks/quotes/latest',
    method: 'GET',
    queryString: `?${queryParams.toString()}`,
    apiBaseUrl: 'https://data.alpaca.markets'
  });
}

/**
 * Retrieves the configuration for a specific Alpaca account.
 * @param {types.AlpacaAccount} account - The Alpaca account to retrieve the configuration for.
 * @returns {Promise<AccountConfiguration>} The account configuration.
 */

export async function getConfiguration(account: types.AlpacaAccount): Promise<AccountConfiguration> {
  try {
    if (!account) {
      throw new Error(`Account is missing.`);
    }

    const { APIKey, APISecret } = account;
    if (!APIKey || !APISecret) {
      throw new Error('User APIKey or APISecret is missing.');
    }

    const apiUrl = account.type === 'PAPER' ? 'https://paper-api.alpaca.markets/v2' : 'https://api.alpaca.markets/v2';

    // Get shared Apollo client for connection pooling
    const client = await getSharedApolloClient();

    // Parallel requests:
    const [alpacaResponse, freshAlpacaAccount] = await Promise.all([
      fetch(`${apiUrl}/account/configurations`, {
        method: 'GET',
        headers: {
          'APCA-API-KEY-ID': APIKey,
          'APCA-API-SECRET-KEY': APISecret,
          accept: 'application/json',
        },
      }),
      // Re-fetch this account from @adaptic/backend-legacy to get DB-level fields
      adaptic.alpacaAccount.get({ id: account.id } as types.AlpacaAccount, client) as Promise<types.AlpacaAccount>,
    ]);

    if (!alpacaResponse.ok) {
      throw new Error(`Failed to fetch account configuration: ${alpacaResponse.statusText}`);
    }
    if (!freshAlpacaAccount) {
      throw new Error('Failed to get Alpaca Account from @adaptic/backend-legacy.');
    }

    const dataFromAlpaca = (await alpacaResponse.json()) as AccountConfiguration;

    // Fetch allocation data if it exists
    const allocationData = freshAlpacaAccount.allocation || {
      stocks: 70,
      crypto: 30,
      etfs: 10
    };

    // Merge DB fields onto the returned object
    // (These are not part of Alpaca's config, but are stored in our DB)
    const combinedConfig: AccountConfiguration = {
      ...dataFromAlpaca,
      marketOpen: freshAlpacaAccount.marketOpen,
      realTime: freshAlpacaAccount.realTime,
      tradeAllocationPct: freshAlpacaAccount.tradeAllocationPct,
      minPercentageChange: freshAlpacaAccount.minPercentageChange,
      volumeThreshold: freshAlpacaAccount.volumeThreshold,

      // New fields
      cryptoTradingEnabled: freshAlpacaAccount.cryptoTradingEnabled ?? false,
      cryptoTradingPairs: freshAlpacaAccount.cryptoTradingPairs ?? [],
      cryptoTradeAllocationPct: freshAlpacaAccount.cryptoTradeAllocationPct ?? 5.0,
      allocation: allocationData,

      enablePortfolioTrailingStop: freshAlpacaAccount.enablePortfolioTrailingStop,
      portfolioTrailPercent: freshAlpacaAccount.portfolioTrailPercent,
      portfolioProfitThresholdPercent: freshAlpacaAccount.portfolioProfitThresholdPercent,
      reducedPortfolioTrailPercent: freshAlpacaAccount.reducedPortfolioTrailPercent,

      // Position Trailing Stop Service Fields
      defaultTrailingStopPercentage100: freshAlpacaAccount.defaultTrailingStopPercentage100 ?? 4.0,
      firstTrailReductionThreshold100: freshAlpacaAccount.firstTrailReductionThreshold100 ?? 2.0,
      secondTrailReductionThreshold100: freshAlpacaAccount.secondTrailReductionThreshold100 ?? 5.0,
      firstReducedTrailPercentage100: freshAlpacaAccount.firstReducedTrailPercentage100 ?? 1.0,
      secondReducedTrailPercentage100: freshAlpacaAccount.secondReducedTrailPercentage100 ?? 0.5,
      minimumPriceChangePercent100: freshAlpacaAccount.minimumPriceChangePercent100 ?? 0.5,
    };

    return combinedConfig;
  } catch (error) {
    console.error('Error in getConfiguration:', error);
    throw error;
  }
}

/**
 * Updates the configuration for a specific Alpaca account.
 * @param {types.User} user - The user making the update.
 * @param {types.AlpacaAccount} account - The Alpaca account to update.
 * @param {AccountConfiguration} updatedConfig - The updated configuration.
 * @returns {Promise<AccountConfiguration>} The updated account configuration.
 */

export async function updateConfiguration(
  user: types.User,
  account: types.AlpacaAccount,
  updatedConfig: AccountConfiguration
): Promise<AccountConfiguration> {
  try {
    if (!account) {
      throw new Error(`Account is missing.`);
    }

    const { APIKey, APISecret } = account;
    if (!APIKey || !APISecret) {
      throw new Error('User APIKey or APISecret is missing.');
    }

    const apiUrl = account.type === 'PAPER' ? 'https://paper-api.alpaca.markets/v2' : 'https://api.alpaca.markets/v2';

    // Prepare the config object for Alpaca by removing DB-only fields
    const configForAlpaca = { ...updatedConfig };

    // Remove DB-only fields from Alpaca API request
    delete configForAlpaca.marketOpen;
    delete configForAlpaca.realTime;
    delete configForAlpaca.tradeAllocationPct;
    delete configForAlpaca.minPercentageChange;
    delete configForAlpaca.volumeThreshold;

    // Remove new fields from Alpaca API request
    delete configForAlpaca.cryptoTradingEnabled;
    delete configForAlpaca.cryptoTradingPairs;
    delete configForAlpaca.cryptoTradeAllocationPct;
    delete configForAlpaca.allocation;

    delete configForAlpaca.enablePortfolioTrailingStop;
    delete configForAlpaca.portfolioTrailPercent;
    delete configForAlpaca.portfolioProfitThresholdPercent;
    delete configForAlpaca.reducedPortfolioTrailPercent;

    // Remove Position Trailing Stop Service fields from Alpaca API request
    delete configForAlpaca.defaultTrailingStopPercentage100;
    delete configForAlpaca.firstTrailReductionThreshold100;
    delete configForAlpaca.secondTrailReductionThreshold100;
    delete configForAlpaca.firstReducedTrailPercentage100;
    delete configForAlpaca.secondReducedTrailPercentage100;
    delete configForAlpaca.minimumPriceChangePercent100;

    // Make a PATCH request to Alpaca to update their side
    const alpacaUpdatePromise = fetch(`${apiUrl}/account/configurations`, {
      method: 'PATCH',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(configForAlpaca),
    });

    // Get shared Apollo client for connection pooling
    const client = await getSharedApolloClient();

    // Check if we need to update allocation
    let allocUpdatePromise: Promise<types.Allocation | null> = Promise.resolve(null);
    if (updatedConfig.allocation) {
      // If account already has an allocation, update it, otherwise create one
      if (account.allocation) {
        allocUpdatePromise = adaptic.allocation.update({
          id: account.allocation.id,
          alpacaAccount: {
            id: account.id,
          },
          alpacaAccountId: account.id,
          stocks: updatedConfig.allocation.stocks,
          crypto: updatedConfig.allocation.crypto,
          etfs: updatedConfig.allocation.etfs,
        } as types.Allocation, client);
      } else {
        allocUpdatePromise = adaptic.allocation.create({
          stocks: updatedConfig.allocation.stocks,
          crypto: updatedConfig.allocation.crypto,
          etfs: updatedConfig.allocation.etfs,
          alpacaAccount: {
            id: account.id,
          },
          alpacaAccountId: account.id
        } as types.Allocation, client);
      }
    }

    // Meanwhile, update the DB-based fields in @adaptic/backend-legacy
    const adapticUpdatePromise = adaptic.alpacaAccount.update({
      id: account.id,
      user: {
        id: user.id,
        name: user?.name,
      },
      configuration: updatedConfig,
      marketOpen: updatedConfig.marketOpen,
      realTime: updatedConfig.realTime,
      tradeAllocationPct: updatedConfig.tradeAllocationPct,
      minPercentageChange: updatedConfig.minPercentageChange,
      volumeThreshold: updatedConfig.volumeThreshold,

      // New fields
      cryptoTradingEnabled: updatedConfig.cryptoTradingEnabled,
      cryptoTradingPairs: updatedConfig.cryptoTradingPairs,
      cryptoTradeAllocationPct: updatedConfig.cryptoTradeAllocationPct,

      enablePortfolioTrailingStop: updatedConfig.enablePortfolioTrailingStop,
      portfolioTrailPercent: updatedConfig.portfolioTrailPercent,
      portfolioProfitThresholdPercent: updatedConfig.portfolioProfitThresholdPercent,
      reducedPortfolioTrailPercent: updatedConfig.reducedPortfolioTrailPercent,

      // Position Trailing Stop Service fields
      defaultTrailingStopPercentage100: updatedConfig.defaultTrailingStopPercentage100,
      firstTrailReductionThreshold100: updatedConfig.firstTrailReductionThreshold100,
      secondTrailReductionThreshold100: updatedConfig.secondTrailReductionThreshold100,
      firstReducedTrailPercentage100: updatedConfig.firstReducedTrailPercentage100,
      secondReducedTrailPercentage100: updatedConfig.secondReducedTrailPercentage100,
      minimumPriceChangePercent100: updatedConfig.minimumPriceChangePercent100,
    } as types.AlpacaAccount, client);

    const [alpacaResponse, updatedAlpacaAccount, updatedAllocation] = await Promise.all([
      alpacaUpdatePromise,
      adapticUpdatePromise,
      allocUpdatePromise
    ]);

    if (!alpacaResponse.ok) {
      console.error('Failed to update account configuration at Alpaca:', alpacaResponse.statusText);
      throw new Error(`Failed to update account config at Alpaca: ${alpacaResponse.statusText}`);
    }

    const alpacaData = (await alpacaResponse.json()) as AccountConfiguration;
    if (!updatedAlpacaAccount) {
      throw new Error('Failed to update Alpaca Account in @adaptic/backend-legacy.');
    }

    // Merge final data from Alpaca + local DB fields
    const finalConfig: AccountConfiguration = {
      ...alpacaData,
      marketOpen: updatedAlpacaAccount.marketOpen,
      realTime: updatedAlpacaAccount.realTime,
      tradeAllocationPct: updatedAlpacaAccount.tradeAllocationPct,
      minPercentageChange: updatedAlpacaAccount.minPercentageChange,
      volumeThreshold: updatedAlpacaAccount.volumeThreshold,

      // New fields
      cryptoTradingEnabled: updatedAlpacaAccount.cryptoTradingEnabled,
      cryptoTradingPairs: updatedAlpacaAccount.cryptoTradingPairs,
      cryptoTradeAllocationPct: updatedAlpacaAccount.cryptoTradeAllocationPct,
      allocation: updatedAllocation || updatedAlpacaAccount.allocation || updatedConfig.allocation,

      enablePortfolioTrailingStop: updatedAlpacaAccount.enablePortfolioTrailingStop,
      portfolioTrailPercent: updatedAlpacaAccount.portfolioTrailPercent,
      portfolioProfitThresholdPercent: updatedAlpacaAccount.portfolioProfitThresholdPercent,
      reducedPortfolioTrailPercent: updatedAlpacaAccount.reducedPortfolioTrailPercent,

      // Position Trailing Stop Service fields
      defaultTrailingStopPercentage100: updatedAlpacaAccount.defaultTrailingStopPercentage100,
      firstTrailReductionThreshold100: updatedAlpacaAccount.firstTrailReductionThreshold100,
      secondTrailReductionThreshold100: updatedAlpacaAccount.secondTrailReductionThreshold100,
      firstReducedTrailPercentage100: updatedAlpacaAccount.firstReducedTrailPercentage100,
      secondReducedTrailPercentage100: updatedAlpacaAccount.secondReducedTrailPercentage100,
      minimumPriceChangePercent100: updatedAlpacaAccount.minimumPriceChangePercent100,
    };

    return finalConfig;
  } catch (error) {
    console.error('Error in updateConfiguration:', error);
    throw error;
  }
}

export function cleanContent(htmlContent: string): string {
  // Remove <script> and <style> tags and their content
  let result = htmlContent.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove remaining HTML tags
  result = result.replace(/<[^>]+>/g, '');

  // Remove unnecessary '+' characters
  result = result.replace(/\+\s*/g, ' ');

  // Replace named entities with plain text equivalents
  result = result.split('&nbsp;').join(' ')
    .split('&amp;').join('&')
    .split('&#8217;').join("'")
    .split('&#8216;').join("'")
    .split('&#8220;').join('"')
    .split('&#8221;').join('"')
    .split('&#39;').join("'");

  // Decode hexadecimal numeric entities (e.g., &#x1f92f;)
  result = result.replace(/&#x([\da-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  // Decode decimal numeric entities (e.g., &#8220; if not already replaced)
  result = result.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));

  // Normalize whitespace and trim
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/**
 * Retrieves an asset from Alpaca by symbol or asset ID.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} symbolOrAssetId - The symbol or asset ID to retrieve.
 * @returns {Promise<Asset>} The requested asset.
 */
export async function getAsset(auth: AlpacaAuth, symbolOrAssetId: string): Promise<AlpacaAsset> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);

    const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

    // Use encodeURIComponent to handle special characters in symbols (e.g., BTC/USDT)
    const encodedSymbolOrAssetId = encodeURIComponent(symbolOrAssetId);

    const response = await fetch(`${apiBaseUrl}/v2/assets/${encodedSymbolOrAssetId}`, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get asset: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaAsset;
  } catch (error) {
    console.error('Error in getAsset:', error);
    throw error;
  }
}
