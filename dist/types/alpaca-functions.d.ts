import { types } from '@adaptic/backend-legacy';
import { AccountConfiguration, AlpacaPosition, SimpleNews, CreateOrderParams, GetOrdersParams, AlpacaOrder, ReplaceOrderParams, AlpacaAuth, AlpacaAccountDetails, PortfolioHistoryResponse, FetchPortfolioHistoryProps, AlpacaAsset, DataFeed, LatestQuotesResponse } from './types/alpaca-types';
import { ApolloClientType, NormalizedCacheObject } from '@adaptic/backend-legacy';
/**
 * Creates a new order in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {CreateOrderParams} params - The parameters for creating the order.
 * @returns {Promise<Order>} The created order.
 */
export declare function createOrder(auth: AlpacaAuth, params: CreateOrderParams): Promise<AlpacaOrder>;
/**
 * Retrieves a list of orders from Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {GetOrdersParams} [params={}] - The parameters for fetching orders.
 * @returns {Promise<AlpacaOrder[]>} The list of orders.
 */
export declare function getOrders(auth: AlpacaAuth, params?: GetOrdersParams): Promise<AlpacaOrder[]>;
/**
 * Cancels all orders in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @returns {Promise<{ id: string; status: number }[]>} The list of canceled orders with their statuses.
 */
export declare function cancelAllOrders(auth: AlpacaAuth): Promise<{
    id: string;
    status: number;
}[]>;
/**
 * Retrieves a specific order from Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} orderId - The ID of the order to retrieve.
 * @param {boolean} [nested] - Whether to include nested details.
 * @returns {Promise<Order>} The requested order.
 */
export declare function getOrder(auth: AlpacaAuth, orderId: string, nested?: boolean): Promise<AlpacaOrder>;
/**
 * Replaces an existing order in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} orderId - The ID of the order to replace.
 * @param {ReplaceOrderParams} params - The parameters for replacing the order.
 * @returns {Promise<Order>} The updated order.
 */
export declare function replaceOrder(auth: AlpacaAuth, orderId: string, params: ReplaceOrderParams): Promise<AlpacaOrder>;
/**
 * Cancels a specific order in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} orderId - The ID of the order to cancel.
 * @returns {Promise<{ success: boolean; message?: string }>} - Success status and optional message if order not found.
 */
export declare function cancelOrder(auth: AlpacaAuth, orderId: string): Promise<{
    success: boolean;
    message?: string;
}>;
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
export declare function fetchNews(symbols: string, params?: {
    auth?: AlpacaAuth;
    start?: Date | string;
    end?: Date | string;
    limit?: number;
    sort?: 'asc' | 'desc';
    page_token?: string;
    include_content?: boolean;
}): Promise<{
    news: SimpleNews[];
    nextPageToken?: string;
}>;
export interface FetchAccountDetailsProps {
    auth?: AlpacaAuth;
    accountId?: string;
    client?: ApolloClientType<NormalizedCacheObject>;
    alpacaAccount?: types.AlpacaAccount;
}
/**
 * Fetches account details from Alpaca API.
 * @param {FetchAccountDetailsProps} props - The properties for fetching account details.
 * @returns {Promise<AlpacaAccountDetails>} The account details.
 */
export declare function fetchAccountDetails({ accountId, client, alpacaAccount, auth }: FetchAccountDetailsProps): Promise<AlpacaAccountDetails>;
/**
 * Fetches portfolio history for one Alpaca account.
 * @param {FetchPortfolioHistoryProps} props - The properties for fetching portfolio history.
 * @returns {Promise<PortfolioHistoryResponse>} The portfolio history.
 */
/** Fetches portfolio history for one Alpaca account, as stored in Adaptic backend
*/
export declare function fetchPortfolioHistory({ params, accountId, client, alpacaAccount }: FetchPortfolioHistoryProps): Promise<PortfolioHistoryResponse>;
/**
 * Fetches all positions for an Alpaca trading account.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @returns {Promise<AlpacaPosition[]>} The list of positions.
 */
export declare function fetchAllPositions(auth: AlpacaAuth): Promise<AlpacaPosition[]>;
/**
 * Fetches a specific position for an Alpaca account.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} symbolOrAssetId - The symbol or asset ID to fetch the position for.
 * @returns {Promise<{ position: AlpacaPosition | null; message?: string }>} The position details or null with message if not found.
 */
export declare function fetchPosition(auth: AlpacaAuth, symbolOrAssetId: string): Promise<{
    position: AlpacaPosition | null;
    message?: string;
}>;
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
export declare function closePosition(auth: AlpacaAuth, symbolOrAssetId: string, params?: {
    qty?: number;
    percentage?: number;
    useLimitOrder?: boolean;
    cancelOrders?: boolean;
    slippagePercent1?: number;
    extendedHours?: boolean;
}): Promise<AlpacaOrder>;
export declare function makeRequest(auth: AlpacaAuth, params: {
    endpoint: string;
    method: string;
    body?: any;
    queryString?: string;
    apiBaseUrl?: string;
}): Promise<any>;
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
export declare function createLimitOrder(auth: AlpacaAuth, params?: {
    symbol: string;
    qty: number;
    side: 'buy' | 'sell';
    limitPrice: number;
    position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
    extended_hours: boolean;
    client_order_id?: string;
}): Promise<AlpacaOrder>;
/**
 * Closes all positions in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {Object} [params] - Optional parameters for closing all positions.
 * @param {boolean} [params.cancelOrders] - If true, cancels all open orders before closing positions.
 * @param {boolean} [params.useLimitOrders] - If true, uses limit orders to close positions.
 * @returns {Promise<Array<{ symbol: string; status: number; body?: Order }>>} The status of each position closure attempt.
 */
export declare function closeAllPositions(auth: AlpacaAuth, params?: {
    cancel_orders?: boolean;
    useLimitOrders?: boolean;
    slippagePercent1?: number;
}): Promise<Array<{
    symbol: string;
    status: number;
    body?: AlpacaOrder;
}> | void>;
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
export declare function closeAllPositionsAfterHours(auth: AlpacaAuth, params?: {
    cancel_orders?: boolean;
    slippagePercent1?: number;
}): Promise<Array<{
    symbol: string;
    status: number;
    body?: AlpacaOrder;
}> | void>;
/**
  * Get the most recent quotes for requested symbols
  * @param symbols Array of stock symbols to query
  * @param feed Optional data source (sip/iex/delayed_sip)
  * @param currency Optional currency in ISO 4217 format
  * @returns Latest quote data for each symbol
  * @throws Error if request fails or rate limit exceeded
  */
export declare function getLatestQuotes(auth: AlpacaAuth, params: {
    symbols: string[];
    feed?: DataFeed;
    currency?: string;
}): Promise<LatestQuotesResponse>;
/**
 * Retrieves the configuration for a specific Alpaca account.
 * @param {types.AlpacaAccount} account - The Alpaca account to retrieve the configuration for.
 * @returns {Promise<AccountConfiguration>} The account configuration.
 */
export declare function getConfiguration(account: types.AlpacaAccount): Promise<AccountConfiguration>;
/**
 * Updates the configuration for a specific Alpaca account.
 * @param {types.User} user - The user making the update.
 * @param {types.AlpacaAccount} account - The Alpaca account to update.
 * @param {AccountConfiguration} updatedConfig - The updated configuration.
 * @returns {Promise<AccountConfiguration>} The updated account configuration.
 */
export declare function updateConfiguration(user: types.User, account: types.AlpacaAccount, updatedConfig: AccountConfiguration): Promise<AccountConfiguration>;
export declare function cleanContent(htmlContent: string): string;
/**
 * Retrieves an asset from Alpaca by symbol or asset ID.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @param {string} symbolOrAssetId - The symbol or asset ID to retrieve.
 * @returns {Promise<Asset>} The requested asset.
 */
export declare function getAsset(auth: AlpacaAuth, symbolOrAssetId: string): Promise<AlpacaAsset>;
//# sourceMappingURL=alpaca-functions.d.ts.map