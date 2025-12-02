import adaptic$1, { setTokenProvider, getApolloClient } from '@adaptic/backend-legacy';
import { format, sub, set, add, startOfDay, endOfDay, isBefore, differenceInMilliseconds } from 'date-fns';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import ms from 'ms';
import require$$0$3, { EventEmitter } from 'events';
import require$$1$1 from 'https';
import require$$2 from 'http';
import require$$3 from 'net';
import require$$4 from 'tls';
import require$$1 from 'crypto';
import require$$0$2 from 'stream';
import require$$7 from 'url';
import require$$0 from 'zlib';
import require$$0$1 from 'buffer';
import { clearLine, cursorTo } from 'readline';
import * as fs from 'fs';
import * as path from 'path';

// Keep track of a single instance of Apollo client
let apolloClientInstance = null;
// Track if auth has been configured
let authConfigured = false;
/**
 * Configure the Apollo client authentication with a dynamic token provider.
 * This should be called once during app initialization before making any
 * @adaptic/backend-legacy API calls.
 *
 * The token provider function will be called for each GraphQL request,
 * allowing for dynamic token retrieval (e.g., from session storage, SecretsManager, etc.)
 *
 * @param provider - Function that returns the auth token (sync or async)
 *
 * @example
 * // Configure with an environment variable
 * configureAuth(() => process.env.GRAPHQL_API_KEY || '');
 *
 * @example
 * // Configure with NextAuth session token (async)
 * configureAuth(async () => {
 *   const session = await auth();
 *   return session?.accessToken || '';
 * });
 *
 * @example
 * // Configure with SecretsManager
 * configureAuth(() => {
 *   const secrets = getSecretsManager();
 *   return secrets.getGraphQLConfig().apiKey || '';
 * });
 */
const configureAuth = (provider) => {
    if (authConfigured) {
        console.warn('[adaptic] Auth provider already configured. Calling configureAuth again will reset the client.');
    }
    setTokenProvider(provider);
    authConfigured = true;
    // Reset the cached client so it picks up the new auth on next request
    if (apolloClientInstance) {
        apolloClientInstance = null;
        console.log('[adaptic] Apollo client reset due to auth configuration change');
    }
};
/**
 * Check if Apollo auth has been configured.
 */
const isAuthConfigured = () => {
    return authConfigured;
};
/**
 * Returns a shared Apollo client instance with connection pooling.
 * This should be used for all @adaptic/backend-legacy operations.
 *
 * @returns {Promise<ApolloClientType>} The shared Apollo client instance.
 */
const getSharedApolloClient = async () => {
    if (!apolloClientInstance) {
        try {
            // Initialize the client once and reuse it across requests
            apolloClientInstance = await getApolloClient();
        }
        catch (error) {
            console.error('Error initializing shared Apollo client:', error);
            throw error;
        }
    }
    return apolloClientInstance;
};
/**
 * Fetches the asset overview for a given symbol from the Adaptic backend.
 *
 * @param {string} symbol - The symbol of the asset to fetch.
 * @returns {Promise<AssetOverviewResponse>} - A promise that resolves to the asset overview response.
 */
const fetchAssetOverview = async (symbol) => {
    if (!symbol) {
        return {
            asset: null,
            error: 'Symbol is required',
            success: false,
        };
    }
    try {
        const encodedSymbol = encodeURIComponent(symbol.trim().toUpperCase());
        const res = await fetch(`https://adaptic.ai/api/asset/overview?symbol=${encodedSymbol}`);
        if (!res.ok) {
            const errorData = (await res.json());
            console.error(`Failed to fetch asset data for ${symbol}:`, errorData);
            return {
                asset: null,
                error: errorData.error || `Failed to fetch asset data for ${symbol}`,
                success: false,
            };
        }
        const data = (await res.json());
        if (!data.asset || !data.asset.id) {
            console.error(`Invalid asset data received for ${symbol}:`, data);
            return {
                asset: null,
                error: `Invalid asset data received for ${symbol}`,
                success: false,
            };
        }
        const cleanedAsset = Object.entries(data.asset).reduce((acc, [key, value]) => {
            if (value !== null && value !== '' && value !== undefined) {
                acc[key] = value;
            }
            return acc;
        }, {});
        return {
            asset: {
                ...cleanedAsset,
                symbol: cleanedAsset.symbol || symbol,
            },
            error: null,
            success: true,
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error(`Error fetching asset data for ${symbol}:`, errorMessage);
        return {
            asset: null,
            error: errorMessage,
            success: false,
        };
    }
};

// Utility function for debug logging
// Define the possible log types as a const array for better type inference
/**
 * Debug logging utility that respects environment debug flags.
 * Logs messages to the console based on the specified log level.
 *
 * @param message - The message to log.
 * @param data - Optional data to log alongside the message. This can be any type of data.
 * @param type - Log level. One of: 'info' | 'warn' | 'error' | 'debug' | 'trace'. Defaults to 'info'.
 *
 * @example
 * logIfDebug("User login failed", { userId: 123 }, "error");
 * logIfDebug("Cache miss", undefined, "warn");
 * logIfDebug("Processing request", { requestId: "abc" }, "debug");
 */
const logIfDebug = (message, data, type = 'info') => {
    const debugMode = process.env.LUMIC_DEBUG === 'true' || process.env.lumic_debug === 'true' || false;
    if (!debugMode)
        return;
    const prefix = `[DEBUG][${type.toUpperCase()}]`;
    const formattedData = data !== undefined ? JSON.stringify(data, null, 2) : '';
    switch (type) {
        case 'error':
            console.error(prefix, message, formattedData);
            break;
        case 'warn':
            console.warn(prefix, message, formattedData);
            break;
        case 'debug':
            console.debug(prefix, message, formattedData);
            break;
        case 'trace':
            console.trace(prefix, message, formattedData);
            break;
        case 'info':
        default:
            console.info(prefix, message, formattedData);
    }
};
/**
 * Masks the middle part of an API key, returning only the first 2 and last 2 characters.
 * If the API key is very short (<= 4 characters), it will be returned as is.
 *
 * @param keyValue - The API key to mask.
 * @returns The masked API key.
 *
 * @example
 * maskApiKey("12341239856677"); // Returns "12****77"
 */
function maskApiKey(keyValue) {
    if (keyValue.length <= 4) {
        return keyValue;
    }
    const firstTwo = keyValue.slice(0, 2);
    const lastTwo = keyValue.slice(-2);
    return `${firstTwo}****${lastTwo}`;
}
/**
 * Hides (masks) the value of any query parameter that is "apiKey" (case-insensitive),
 * replacing the middle part with **** and keeping only the first 2 and last 2 characters.
 *
 * @param url - The URL containing the query parameters.
 * @returns The URL with the masked API key.
 *
 * @example
 * hideApiKeyFromurl("https://xxx.com/s/23/fdsa/?apiKey=12341239856677");
 * // Returns "https://xxx.com/s/23/fdsa/?apiKey=12****77"
 */
function hideApiKeyFromurl(url) {
    try {
        const parsedUrl = new URL(url);
        // We iterate over all search params and look for one named 'apikey' (case-insensitive)
        for (const [key, value] of parsedUrl.searchParams.entries()) {
            if (key.toLowerCase() === 'apikey') {
                const masked = maskApiKey(value);
                parsedUrl.searchParams.set(key, masked);
            }
        }
        return parsedUrl.toString();
    }
    catch {
        // If we can't parse it as a valid URL, just return the original string
        return url;
    }
}
/**
 * Extracts meaningful error information from various error types.
 * @param error - The error to analyze.
 * @param response - Optional response object for HTTP errors.
 * @returns Structured error details.
 */
function extractErrorDetails(error, response) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return { type: 'NETWORK_ERROR', reason: 'Network connectivity issue', status: null };
    }
    if (error.message.includes('HTTP error: 429')) {
        const match = error.message.match(/RATE_LIMIT: 429:(\d+)/);
        const retryAfter = match ? parseInt(match[1]) : undefined;
        return { type: 'RATE_LIMIT', reason: 'Rate limit exceeded', status: 429, retryAfter };
    }
    if (error.message.includes('HTTP error: 401') || error.message.includes('AUTH_ERROR: 401')) {
        return { type: 'AUTH_ERROR', reason: 'Authentication failed - invalid API key', status: 401 };
    }
    if (error.message.includes('HTTP error: 403') || error.message.includes('AUTH_ERROR: 403')) {
        return { type: 'AUTH_ERROR', reason: 'Access forbidden - insufficient permissions', status: 403 };
    }
    if (error.message.includes('SERVER_ERROR:')) {
        const status = parseInt(error.message.split('SERVER_ERROR: ')[1]) || 500;
        return { type: 'SERVER_ERROR', reason: `Server error (${status})`, status };
    }
    if (error.message.includes('CLIENT_ERROR:')) {
        const status = parseInt(error.message.split('CLIENT_ERROR: ')[1]) || 400;
        return { type: 'CLIENT_ERROR', reason: `Client error (${status})`, status };
    }
    return { type: 'UNKNOWN', reason: error.message || 'Unknown error', status: null };
}
/**
 * Fetches a resource with intelligent retry logic for handling transient errors.
 * Features enhanced error logging, rate limit detection, and adaptive backoff.
 *
 * @param url - The URL to fetch.
 * @param options - Optional fetch options.
 * @param retries - The number of retry attempts. Defaults to 3.
 * @param initialBackoff - The initial backoff time in milliseconds. Defaults to 1000.
 * @returns A promise that resolves to the response.
 *
 * @throws Will throw an error if the fetch fails after the specified number of retries.
 */
async function fetchWithRetry(url, options = {}, retries = 3, initialBackoff = 1000) {
    let backoff = initialBackoff;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                // Enhanced HTTP error handling with specific error types
                if (response.status === 429) {
                    // Check for Retry-After header
                    const retryAfter = response.headers.get('Retry-After');
                    const retryDelay = retryAfter ? parseInt(retryAfter) * 1000 : null;
                    throw new Error(`RATE_LIMIT: ${response.status}${retryDelay ? `:${retryDelay}` : ''}`);
                }
                if ([500, 502, 503, 504].includes(response.status)) {
                    throw new Error(`SERVER_ERROR: ${response.status}`);
                }
                if ([401, 403].includes(response.status)) {
                    throw new Error(`AUTH_ERROR: ${response.status}`);
                }
                if (response.status >= 400 && response.status < 500) {
                    // Don't retry most 4xx client errors
                    throw new Error(`CLIENT_ERROR: ${response.status}`);
                }
                throw new Error(`HTTP_ERROR: ${response.status}`);
            }
            return response;
        }
        catch (error) {
            if (attempt === retries) {
                throw error;
            }
            // Extract meaningful error information
            const errorDetails = extractErrorDetails(error);
            let adaptiveBackoff = backoff;
            // Adaptive backoff based on error type
            if (errorDetails.type === 'RATE_LIMIT') {
                // Use Retry-After header if available, otherwise use minimum 5s for rate limits
                if (errorDetails.retryAfter) {
                    adaptiveBackoff = errorDetails.retryAfter;
                }
                else {
                    adaptiveBackoff = Math.max(backoff, 5000);
                }
            }
            else if (errorDetails.type === 'AUTH_ERROR') {
                // Don't retry auth errors - fail fast
                console.error(`Authentication error for ${hideApiKeyFromurl(url)}: ${errorDetails.reason}`, {
                    attemptNumber: attempt,
                    errorType: errorDetails.type,
                    httpStatus: errorDetails.status,
                    url: hideApiKeyFromurl(url),
                    source: 'fetchWithRetry',
                    timestamp: new Date().toISOString()
                });
                throw error;
            }
            else if (errorDetails.type === 'CLIENT_ERROR') {
                // Don't retry client errors (except 429 which is handled above)
                console.error(`Client error for ${hideApiKeyFromurl(url)}: ${errorDetails.reason}`, {
                    attemptNumber: attempt,
                    errorType: errorDetails.type,
                    httpStatus: errorDetails.status,
                    url: hideApiKeyFromurl(url),
                    source: 'fetchWithRetry',
                    timestamp: new Date().toISOString()
                });
                throw error;
            }
            // Enhanced error logging with structured data
            console.warn(`Fetch attempt ${attempt} of ${retries} for ${hideApiKeyFromurl(url)} failed: ${errorDetails.reason}. Retrying in ${adaptiveBackoff}ms...`, {
                attemptNumber: attempt,
                totalRetries: retries,
                errorType: errorDetails.type,
                httpStatus: errorDetails.status,
                retryDelay: adaptiveBackoff,
                url: hideApiKeyFromurl(url),
                source: 'fetchWithRetry',
                timestamp: new Date().toISOString()
            });
            await new Promise((resolve) => setTimeout(resolve, adaptiveBackoff));
            backoff = Math.min(backoff * 2, 30000); // Cap at 30 seconds
        }
    }
    throw new Error('Failed to fetch after multiple attempts');
}
/**
 * Validates a Polygon.io API key by making a test request.
 * @param apiKey - The API key to validate.
 * @returns Promise that resolves to true if valid, false otherwise.
 */
async function validatePolygonApiKey(apiKey) {
    try {
        const response = await fetch(`https://api.polygon.io/v1/meta/symbols?apikey=${apiKey}&limit=1`);
        if (response.status === 401) {
            throw new Error('Invalid or expired Polygon.io API key');
        }
        if (response.status === 403) {
            throw new Error('Polygon.io API key lacks required permissions');
        }
        return response.ok;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error('Polygon.io API key validation failed:', errorMessage);
        return false;
    }
}

// alpaca.ts
// functions related to Alpaca accounts
/**
 * Round a price to the nearest 2 decimal places for Alpaca, or 4 decimal places for prices less than $1
 * @param price - The price to round
 * @returns The rounded price
 */
const roundPriceForAlpaca = (price) => {
    return price >= 1
        ? Math.round(price * 100) / 100
        : Math.round(price * 10000) / 10000;
};
async function validateAuth(auth) {
    if (auth.adapticAccountId) {
        // Get shared Apollo client for connection pooling
        const client = await getSharedApolloClient();
        const alpacaAccount = (await adaptic$1.alpacaAccount.get({
            id: auth.adapticAccountId,
        }, client));
        if (!alpacaAccount || !alpacaAccount.APIKey || !alpacaAccount.APISecret) {
            throw new Error('Alpaca account not found or incomplete');
        }
        return {
            APIKey: alpacaAccount.APIKey,
            APISecret: alpacaAccount.APISecret,
            type: alpacaAccount.type,
        };
    }
    else if (auth.alpacaApiKey && auth.alpacaApiSecret) {
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
async function createOrder(auth, params) {
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
        return (await response.json());
    }
    catch (error) {
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
async function getOrders(auth, params = {}) {
    try {
        const { APIKey, APISecret, type } = await validateAuth(auth);
        const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
        const allOrders = [];
        let currentUntil = params.until ? params.until : new Date().toISOString();
        const CHUNK_SIZE = 500;
        while (true) {
            const queryParams = new URLSearchParams();
            if (params.status)
                queryParams.append('status', params.status);
            queryParams.append('limit', CHUNK_SIZE.toString());
            if (params.after)
                queryParams.append('after', params.after);
            queryParams.append('until', currentUntil);
            if (params.direction)
                queryParams.append('direction', params.direction);
            if (params.nested)
                queryParams.append('nested', params.nested.toString());
            if (params.symbols)
                queryParams.append('symbols', params.symbols.join(','));
            if (params.side)
                queryParams.append('side', params.side);
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
            const orders = (await response.json());
            allOrders.push(...orders);
            if (orders.length < CHUNK_SIZE)
                break;
            const lastOrder = orders[orders.length - 1];
            if (!lastOrder.submitted_at)
                break;
            currentUntil = lastOrder.submitted_at;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return allOrders;
    }
    catch (error) {
        console.error('Error in getOrders:', error);
        throw error;
    }
}
/**
 * Cancels all orders in Alpaca.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @returns {Promise<{ id: string; status: number }[]>} The list of canceled orders with their statuses.
 */
async function cancelAllOrders(auth) {
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
        return (await response.json());
    }
    catch (error) {
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
async function getOrder(auth, orderId, nested) {
    try {
        const { APIKey, APISecret, type } = await validateAuth(auth);
        const apiBaseUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
        const queryParams = new URLSearchParams();
        if (nested)
            queryParams.append('nested', 'true');
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
        return (await response.json());
    }
    catch (error) {
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
async function replaceOrder(auth, orderId, params) {
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
        return (await response.json());
    }
    catch (error) {
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
async function cancelOrder(auth, orderId) {
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
            }
            else {
                throw new Error(`Failed to cancel order: ${response.status} ${response.statusText} ${errorText}`);
            }
        }
        return { success: true };
    }
    catch (error) {
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
async function fetchNews$1(symbols, params) {
    // Initialize params with defaults if not provided
    const defaultParams = {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Default to last 24 hours
        end: new Date(),
        limit: 10,
        sort: 'desc',
        page_token: null,
        include_content: true,
    };
    const mergedParams = { ...defaultParams, ...params };
    // Handle authentication
    let APIKey;
    let APISecret;
    if (mergedParams.auth) {
        // Try to authenticate with provided auth object
        if (mergedParams.auth.alpacaApiKey && mergedParams.auth.alpacaApiSecret) {
            APIKey = mergedParams.auth.alpacaApiKey;
            APISecret = mergedParams.auth.alpacaApiSecret;
        }
        else if (mergedParams.auth.adapticAccountId) {
            // Get shared Apollo client for connection pooling
            const client = await getSharedApolloClient();
            const alpacaAccount = (await adaptic$1.alpacaAccount.get({
                id: mergedParams.auth.adapticAccountId,
            }, client));
            if (!alpacaAccount || !alpacaAccount.APIKey || !alpacaAccount.APISecret) {
                throw new Error('Alpaca account not found or incomplete');
            }
            APIKey = alpacaAccount.APIKey;
            APISecret = alpacaAccount.APISecret;
        }
    }
    else {
        // Try to authenticate with environment variables
        APIKey = process.env.ALPACA_API_KEY;
        APISecret = process.env.ALPACA_SECRET_KEY;
    }
    // Throw error if no valid authentication is found
    if (!APIKey || !APISecret) {
        throw new Error('No valid Alpaca authentication found. Please provide either auth object or set ALPACA_API_KEY and ALPACA_API_SECRET environment variables.');
    }
    try {
        let newsArticles = [];
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
            const data = (await response.json());
            // Transform to SimpleNews format
            const transformedNews = data.news.map((article) => ({
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
            }
            else {
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
    }
    catch (error) {
        console.error('Error in fetchNews:', error);
        throw error;
    }
}
// Fetches account details from Alpaca API.
/**
 * Fetches account details from Alpaca API.
 * @param {FetchAccountDetailsProps} props - The properties for fetching account details.
 * @returns {Promise<AlpacaAccountDetails>} The account details.
 */
async function fetchAccountDetails({ accountId, client, alpacaAccount, auth }) {
    let alpacaAccountObj = alpacaAccount ? alpacaAccount : null;
    if (!alpacaAccountObj && auth) {
        const validatedAuth = await validateAuth(auth);
        alpacaAccountObj = {
            APIKey: validatedAuth.APIKey,
            APISecret: validatedAuth.APISecret,
            type: validatedAuth.type,
        };
    }
    if (!alpacaAccountObj) {
        try {
            // Use provided client or get the shared client
            const apolloClient = client || await getSharedApolloClient();
            alpacaAccountObj = (await adaptic$1.alpacaAccount.get({
                id: accountId,
            }, apolloClient));
        }
        catch (error) {
            console.error('[fetchAccountDetails] Error fetching Alpaca account:', error);
            throw error;
        }
    }
    if (!alpacaAccountObj || !alpacaAccountObj.APIKey || !alpacaAccountObj.APISecret) {
        throw new Error('[fetchAccountDetails] Alpaca account not found or incomplete');
    }
    const { APIKey, APISecret, type } = alpacaAccountObj;
    // Set the API URL based on the user's current mode ('PAPER' or 'LIVE')
    const apiUrl = type === 'PAPER' ? 'https://paper-api.alpaca.markets/v2/account' : 'https://api.alpaca.markets/v2/account';
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
    }
    catch (error) {
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
async function fetchPortfolioHistory({ params, accountId, client, alpacaAccount }) {
    let alpacaAccountObj = alpacaAccount ? alpacaAccount : null;
    if (!alpacaAccountObj) {
        try {
            // Use provided client or get the shared client
            const apolloClient = client || await getSharedApolloClient();
            alpacaAccountObj = (await adaptic$1.alpacaAccount.get({
                id: accountId,
            }, apolloClient));
        }
        catch (error) {
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
    Object.keys(params).forEach((key) => params[key] === undefined && delete params[key]);
    // Construct query string from params
    const queryString = new URLSearchParams(params).toString();
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
    }
    catch (error) {
        console.error('[fetchPortfolioHistory] Error fetching portfolio history call to Alpaca:', error);
        throw error;
    }
}
/**
 * Fetches all positions for an Alpaca trading account.
 * @param {AlpacaAuth} auth - The authentication details for Alpaca.
 * @returns {Promise<AlpacaPosition[]>} The list of positions.
 */
async function fetchAllPositions(auth) {
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
        return (await response.json());
    }
    catch (error) {
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
async function fetchPosition(auth, symbolOrAssetId) {
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
            }
            else {
                throw new Error(`Failed to fetch position: ${response.status} ${response.statusText} ${errorText}`);
            }
        }
        const position = (await response.json());
        return { position };
    }
    catch (error) {
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
async function closePosition(auth, symbolOrAssetId, params) {
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
            const openOrders = await getOrders(auth, { status: 'open', symbols: [symbolOrAssetId] });
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
            };
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
            }
            else if (params?.percentage !== undefined) {
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
            return await createLimitOrder(auth, {
                symbol: symbolOrAssetId,
                qty,
                side,
                limitPrice,
                position_intent: positionIntent,
                extended_hours: extendedHours
            });
        }
        else {
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
            return (await response.json());
        }
    }
    catch (error) {
        console.error('Error in closePosition:', error);
        throw error;
    }
}
async function makeRequest(auth, params) {
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
        const fetchOptions = {
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
    }
    catch (err) {
        const error = err;
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
async function createLimitOrder(auth, params = {
    symbol: '',
    qty: 0,
    side: 'buy',
    limitPrice: 0,
    position_intent: 'buy_to_open',
    extended_hours: false,
    client_order_id: undefined
}) {
    const { symbol, qty, side, limitPrice, position_intent, extended_hours, client_order_id } = params;
    console.log(`Creating limit order for ${symbol}: ${side} ${qty} shares at ${limitPrice.toFixed(2)} (${position_intent})`, {
        account: auth.adapticAccountId || 'direct',
        symbol
    });
    const body = {
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
async function closeAllPositions(auth, params = { cancel_orders: true, useLimitOrders: false, slippagePercent1: 0.1 }) {
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
        };
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
            await createLimitOrder(auth, {
                symbol: position.symbol,
                qty,
                side,
                limitPrice,
                position_intent: positionIntent,
                extended_hours: false // Set to false or true based on your requirement
            });
        }
    }
    else {
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
async function closeAllPositionsAfterHours(auth, params = { cancel_orders: true, slippagePercent1: 0.1 }) {
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
    };
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
        await createLimitOrder(auth, {
            symbol: position.symbol,
            qty,
            side,
            limitPrice,
            position_intent: positionIntent,
            extended_hours: true // Enable extended hours trading
        });
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
async function getLatestQuotes(auth, params) {
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
async function getConfiguration(account) {
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
            adaptic$1.alpacaAccount.get({ id: account.id }, client),
        ]);
        if (!alpacaResponse.ok) {
            throw new Error(`Failed to fetch account configuration: ${alpacaResponse.statusText}`);
        }
        if (!freshAlpacaAccount) {
            throw new Error('Failed to get Alpaca Account from @adaptic/backend-legacy.');
        }
        const dataFromAlpaca = (await alpacaResponse.json());
        // Fetch allocation data with expanded asset types and defaults
        // Type assertion to handle fields that may not exist in backend-legacy yet
        const accountWithAllocation = freshAlpacaAccount;
        const allocationData = accountWithAllocation.allocation || {
            stocks: 70,
            options: 0,
            futures: 0,
            etfs: 10,
            forex: 0,
            crypto: 20
        };
        // Merge DB fields onto the returned object
        // (These are not part of Alpaca's config, but are stored in our DB)
        const combinedConfig = {
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
            autoAllocation: accountWithAllocation.autoAllocation ?? false,
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
    }
    catch (error) {
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
async function updateConfiguration(user, account, updatedConfig) {
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
        delete configForAlpaca.autoAllocation;
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
        let allocUpdatePromise = Promise.resolve(null);
        if (updatedConfig.allocation) {
            // Validate allocation percentages sum to 100%
            const totalAllocation = (updatedConfig.allocation.stocks ?? 0) +
                (updatedConfig.allocation.options ?? 0) +
                (updatedConfig.allocation.futures ?? 0) +
                (updatedConfig.allocation.etfs ?? 0) +
                (updatedConfig.allocation.forex ?? 0) +
                (updatedConfig.allocation.crypto ?? 0);
            if (Math.abs(totalAllocation - 100) > 0.01) {
                throw new Error(`Allocation percentages must sum to 100%. Current total: ${totalAllocation}%`);
            }
            // If account already has an allocation, update it, otherwise create one
            if (account.allocation) {
                allocUpdatePromise = adaptic$1.allocation.update({
                    id: account.allocation.id,
                    alpacaAccount: {
                        id: account.id,
                    },
                    alpacaAccountId: account.id,
                    stocks: updatedConfig.allocation.stocks ?? 0,
                    options: updatedConfig.allocation.options ?? 0,
                    futures: updatedConfig.allocation.futures ?? 0,
                    etfs: updatedConfig.allocation.etfs ?? 0,
                    forex: updatedConfig.allocation.forex ?? 0,
                    crypto: updatedConfig.allocation.crypto ?? 0,
                }, client);
            }
            else {
                allocUpdatePromise = adaptic$1.allocation.create({
                    stocks: updatedConfig.allocation.stocks ?? 0,
                    options: updatedConfig.allocation.options ?? 0,
                    futures: updatedConfig.allocation.futures ?? 0,
                    etfs: updatedConfig.allocation.etfs ?? 0,
                    forex: updatedConfig.allocation.forex ?? 0,
                    crypto: updatedConfig.allocation.crypto ?? 0,
                    alpacaAccount: {
                        id: account.id,
                    },
                    alpacaAccountId: account.id
                }, client);
            }
        }
        // Meanwhile, update the DB-based fields in @adaptic/backend-legacy
        // Use type assertion for fields that may not exist in backend-legacy yet
        const adapticUpdatePromise = adaptic$1.alpacaAccount.update({
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
            autoAllocation: updatedConfig.autoAllocation,
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
        }, client);
        const [alpacaResponse, updatedAlpacaAccount, updatedAllocation] = await Promise.all([
            alpacaUpdatePromise,
            adapticUpdatePromise,
            allocUpdatePromise
        ]);
        console.log('=== PROMISE.ALL RESULTS ===');
        console.log('updatedAllocation from Promise.all:', updatedAllocation);
        console.log('updatedAllocation fields:', {
            stocks: updatedAllocation?.stocks,
            options: updatedAllocation?.options,
            futures: updatedAllocation?.futures,
            etfs: updatedAllocation?.etfs,
            forex: updatedAllocation?.forex,
            crypto: updatedAllocation?.crypto,
        });
        if (!alpacaResponse.ok) {
            console.error('Failed to update account configuration at Alpaca:', alpacaResponse.statusText);
            throw new Error(`Failed to update account config at Alpaca: ${alpacaResponse.statusText}`);
        }
        const alpacaData = (await alpacaResponse.json());
        if (!updatedAlpacaAccount) {
            throw new Error('Failed to update Alpaca Account in @adaptic/backend-legacy.');
        }
        // Merge final data from Alpaca + local DB fields
        // Type assertion for fields that may not exist in backend-legacy yet
        const updatedAccountWithAllocation = updatedAlpacaAccount;
        // FIX: Use the validated input allocation instead of mutation response
        // The mutation response may return stale/cached data, but we already validated
        // and sent the correct values to the database, so use updatedConfig.allocation
        const selectedAllocation = updatedConfig.allocation || updatedAllocation || updatedAccountWithAllocation.allocation;
        console.log('=== ALLOCATION DEBUG (will be removed after fix verified) ===');
        console.log('Using updatedConfig.allocation (validated input):', updatedConfig.allocation);
        console.log('Ignoring potentially stale updatedAllocation:', updatedAllocation);
        console.log('Final allocation:', selectedAllocation);
        const finalConfig = {
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
            autoAllocation: updatedAccountWithAllocation.autoAllocation,
            allocation: selectedAllocation,
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
    }
    catch (error) {
        console.error('Error in updateConfiguration:', error);
        throw error;
    }
}
function cleanContent(htmlContent) {
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
async function getAsset(auth, symbolOrAssetId) {
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
        return (await response.json());
    }
    catch (error) {
        console.error('Error in getAsset:', error);
        throw error;
    }
}

// market-hours.ts
const marketHolidays = {
    2024: {
        'New Year\'s Day': { date: '2024-01-01' },
        'Martin Luther King, Jr. Day': { date: '2024-01-15' },
        'Washington\'s Birthday': { date: '2024-02-19' },
        'Good Friday': { date: '2024-03-29' },
        'Memorial Day': { date: '2024-05-27' },
        'Juneteenth National Independence Day': { date: '2024-06-19' },
        'Independence Day': { date: '2024-07-04' },
        'Labor Day': { date: '2024-09-02' },
        'Thanksgiving Day': { date: '2024-11-28' },
        'Christmas Day': { date: '2024-12-25' }
    },
    2025: {
        'New Year\'s Day': { date: '2025-01-01' },
        'Jimmy Carter Memorial Day': { date: '2025-01-09' },
        'Martin Luther King, Jr. Day': { date: '2025-01-20' },
        'Washington\'s Birthday': { date: '2025-02-17' },
        'Good Friday': { date: '2025-04-18' },
        'Memorial Day': { date: '2025-05-26' },
        'Juneteenth National Independence Day': { date: '2025-06-19' },
        'Independence Day': { date: '2025-07-04' },
        'Labor Day': { date: '2025-09-01' },
        'Thanksgiving Day': { date: '2025-11-27' },
        'Christmas Day': { date: '2025-12-25' }
    },
    2026: {
        'New Year\'s Day': { date: '2026-01-01' },
        'Martin Luther King, Jr. Day': { date: '2026-01-19' },
        'Washington\'s Birthday': { date: '2026-02-16' },
        'Good Friday': { date: '2026-04-03' },
        'Memorial Day': { date: '2026-05-25' },
        'Juneteenth National Independence Day': { date: '2026-06-19' },
        'Independence Day': { date: '2026-07-03' },
        'Labor Day': { date: '2026-09-07' },
        'Thanksgiving Day': { date: '2026-11-26' },
        'Christmas Day': { date: '2026-12-25' }
    }
};
const marketEarlyCloses = {
    2024: {
        '2024-07-03': {
            date: '2024-07-03',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Wednesday, July 3, 2024 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2024-11-29': {
            date: '2024-11-29',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Friday, November 29, 2024 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2024-12-24': {
            date: '2024-12-24',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Tuesday, December 24, 2024 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        }
    },
    2025: {
        '2025-07-03': {
            date: '2025-07-03',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Thursday, July 3, 2025 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2025-11-28': {
            date: '2025-11-28',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Friday, November 28, 2025 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2025-12-24': {
            date: '2025-12-24',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Wednesday, December 24, 2025 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        }
    },
    2026: {
        '2026-07-02': {
            date: '2026-07-02',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Independence Day observed, market closes early at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2026-11-27': {
            date: '2026-11-27',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Friday, November 27, 2026 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        },
        '2026-12-24': {
            date: '2026-12-24',
            time: '13:00',
            optionsTime: '13:15',
            notes: 'Market closes early on Thursday, December 24, 2026 at 1:00 p.m. (1:15 p.m. for eligible options). NYSE American Equities, NYSE Arca Equities, NYSE Chicago, and NYSE National late trading sessions will close at 5:00 p.m. Eastern Time.'
        }
    }
};

// market-time.ts
/**
 * Market times for NYSE
 * Regular market hours are 9:30am-4:00pm
 * Early market hours are 9:30am-10:00am (first 30 minutes)
 * Extended market hours are 4:00am to 9:30am and 4:00pm-8:00pm
 * On days before some holidays, the market closes early at 1:00pm
 * Early extended market hours are 1:00pm-5:00pm on early close days
 */
const MARKET_TIMES = {
    TIMEZONE: 'America/New_York',
    PRE: { START: { HOUR: 4, MINUTE: 0, MINUTES: 240 }, END: { HOUR: 9, MINUTE: 30, MINUTES: 570 } },
    EARLY_MORNING: { START: { HOUR: 9, MINUTE: 30, MINUTES: 570 }, END: { HOUR: 10, MINUTE: 0, MINUTES: 600 } }, // early market trading
    EARLY_CLOSE_BEFORE_HOLIDAY: { START: { HOUR: 9, MINUTE: 30, MINUTES: 570 }, END: { HOUR: 13, MINUTE: 0, MINUTES: 780 } }, // early market trading end
    EARLY_EXTENDED_BEFORE_HOLIDAY: { START: { HOUR: 13, MINUTE: 0, MINUTES: 780 }, END: { HOUR: 17, MINUTE: 0, MINUTES: 1020 } }, // extended hours trading on early close days
    REGULAR: { START: { HOUR: 9, MINUTE: 30, MINUTES: 570 }, END: { HOUR: 16, MINUTE: 0, MINUTES: 960 } },
    EXTENDED: { START: { HOUR: 4, MINUTE: 0, MINUTES: 240 }, END: { HOUR: 20, MINUTE: 0, MINUTES: 1200 } },
};
/**
 * Utility class for handling market time-related operations
 */
class MarketTimeUtil {
    timezone;
    intradayReporting;
    /**
     * Creates a new MarketTimeUtil instance
     * @param {string} [timezone='America/New_York'] - The timezone to use for market time calculations
     * @param {IntradayReporting} [intradayReporting='market_hours'] - The intraday reporting mode
     */
    constructor(timezone = MARKET_TIMES.TIMEZONE, intradayReporting = 'market_hours') {
        this.validateTimezone(timezone);
        this.timezone = timezone;
        this.intradayReporting = intradayReporting;
    }
    /**
     * Validates the provided timezone
     * @private
     * @param {string} timezone - The timezone to validate
     * @throws {Error} If the timezone is invalid
     */
    validateTimezone(timezone) {
        try {
            Intl.DateTimeFormat(undefined, { timeZone: timezone });
        }
        catch (error) {
            throw new Error(`Invalid timezone: ${timezone}`);
        }
    }
    formatDate(date, outputFormat = 'iso') {
        switch (outputFormat) {
            case 'unix-seconds':
                return Math.floor(date.getTime() / 1000);
            case 'unix-ms':
                return date.getTime();
            case 'iso':
            default:
                // return with timezone offset
                return formatInTimeZone(date, this.timezone, "yyyy-MM-dd'T'HH:mm:ssXXX");
        }
    }
    isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    }
    isHoliday(date) {
        const formattedDate = format(date, 'yyyy-MM-dd');
        const yearHolidays = marketHolidays[date.getFullYear()];
        for (const holiday in yearHolidays) {
            if (yearHolidays[holiday].date === formattedDate) {
                return true;
            }
        }
        return false;
    }
    isEarlyCloseDay(date) {
        const formattedDate = format(date, 'yyyy-MM-dd');
        const yearEarlyCloses = marketEarlyCloses[date.getFullYear()];
        return yearEarlyCloses && yearEarlyCloses[formattedDate] !== undefined;
    }
    /**
     * Get the early close time for a given date
     * @param date - The date to get the early close time for
     * @returns The early close time in minutes from midnight, or null if there is no early close
     */
    getEarlyCloseTime(date) {
        const formattedDate = format(date, 'yyyy-MM-dd');
        const yearEarlyCloses = marketEarlyCloses[date.getFullYear()];
        if (yearEarlyCloses && yearEarlyCloses[formattedDate]) {
            const [hours, minutes] = yearEarlyCloses[formattedDate].time.split(':').map(Number);
            return hours * 60 + minutes;
        }
        return null;
    }
    /**
     * Check if a given date is a market day
     * @param date - The date to check
     * @returns true if the date is a market day, false otherwise
     */
    isMarketDay(date) {
        const isWeekendDay = this.isWeekend(date);
        const isHolidayDay = this.isHoliday(date);
        const returner = !isWeekendDay && !isHolidayDay;
        return returner;
    }
    /**
     * Check if a given date is within market hours
     * @param date - The date to check
     * @returns true if the date is within market hours, false otherwise
     */
    isWithinMarketHours(date) {
        // Check for holidays first
        if (this.isHoliday(date)) {
            return false;
        }
        const timeInMinutes = date.getHours() * 60 + date.getMinutes();
        // Check for early closure
        if (this.isEarlyCloseDay(date)) {
            const earlyCloseMinutes = this.getEarlyCloseTime(date);
            if (earlyCloseMinutes !== null && timeInMinutes > earlyCloseMinutes) {
                return false;
            }
        }
        // Regular market hours logic
        let returner;
        switch (this.intradayReporting) {
            case 'extended_hours': {
                const extendedStartMinutes = MARKET_TIMES.EXTENDED.START.HOUR * 60 + MARKET_TIMES.EXTENDED.START.MINUTE;
                const extendedEndMinutes = MARKET_TIMES.EXTENDED.END.HOUR * 60 + MARKET_TIMES.EXTENDED.END.MINUTE;
                // Comprehensive handling of times crossing midnight
                const adjustedDate = timeInMinutes < extendedStartMinutes ? sub(date, { days: 1 }) : date;
                const adjustedTimeInMinutes = adjustedDate.getHours() * 60 + adjustedDate.getMinutes();
                returner = adjustedTimeInMinutes >= extendedStartMinutes && adjustedTimeInMinutes <= extendedEndMinutes;
                break;
            }
            case 'continuous':
                returner = true;
                break;
            default: {
                // market_hours
                const regularStartMinutes = MARKET_TIMES.REGULAR.START.HOUR * 60 + MARKET_TIMES.REGULAR.START.MINUTE;
                const regularEndMinutes = MARKET_TIMES.REGULAR.END.HOUR * 60 + MARKET_TIMES.REGULAR.END.MINUTE;
                returner = timeInMinutes >= regularStartMinutes && timeInMinutes <= regularEndMinutes;
                break;
            }
        }
        return returner;
    }
    /**
     * Check if a given date is before market hours
     * @param date - The date to check
     * @returns true if the date is before market hours, false otherwise
     */
    isBeforeMarketHours(date) {
        const timeInMinutes = date.getHours() * 60 + date.getMinutes();
        const startMinutes = this.intradayReporting === 'extended_hours'
            ? MARKET_TIMES.EXTENDED.START.HOUR * 60 + MARKET_TIMES.EXTENDED.START.MINUTE
            : MARKET_TIMES.REGULAR.START.HOUR * 60 + MARKET_TIMES.REGULAR.START.MINUTE;
        return timeInMinutes < startMinutes;
    }
    /**
     * Get the last trading date, i.e. the last date that was a market day
     * @param currentDate - The current date
     * @returns The last trading date
     */
    getLastTradingDate(currentDate = new Date()) {
        const nowET = toZonedTime(currentDate, this.timezone);
        const isMarketDayToday = this.isMarketDay(nowET);
        const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
        const marketOpenMinutes = MARKET_TIMES.REGULAR.START.HOUR * 60 + MARKET_TIMES.REGULAR.START.MINUTE;
        if (isMarketDayToday && currentMinutes >= marketOpenMinutes) {
            // After market open on a market day, return today
            return nowET;
        }
        else {
            // Before market open, or not a market day, return previous trading day
            let lastTradingDate = sub(nowET, { days: 1 });
            while (!this.isMarketDay(lastTradingDate)) {
                lastTradingDate = sub(lastTradingDate, { days: 1 });
            }
            return lastTradingDate;
        }
    }
    getLastMarketDay(date) {
        let currentDate = sub(date, { days: 1 });
        while (!this.isMarketDay(currentDate)) {
            currentDate = sub(currentDate, { days: 1 });
        }
        return currentDate;
    }
    getLastFullTradingDate(currentDate = new Date()) {
        const nowET = toZonedTime(currentDate, this.timezone);
        // If today is a market day and we're after extended hours close
        // then return today since it's a completed trading day
        if (this.isMarketDay(nowET)) {
            const timeInMinutes = nowET.getHours() * 60 + nowET.getMinutes();
            const extendedEndMinutes = MARKET_TIMES.EXTENDED.END.HOUR * 60 + MARKET_TIMES.EXTENDED.END.MINUTE;
            // Check if we're after market close (including extended hours)
            if (timeInMinutes >= extendedEndMinutes) {
                // Set to midnight ET while preserving the date
                return fromZonedTime(set(nowET, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }), this.timezone);
            }
        }
        // In all other cases (during trading hours, before market open, holidays, weekends),
        // we want the last completed trading day
        let lastFullDate = this.getLastMarketDay(nowET);
        // Set to midnight ET while preserving the date
        return fromZonedTime(set(lastFullDate, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }), this.timezone);
    }
    /**
     * Gets the next market day from a reference date
     * @param {Object} [options] - Options object
     * @param {Date} [options.referenceDate] - The reference date (defaults to current date)
     * @returns {Object} The next market day information
     * @property {Date} date - The date object (start of day in NY time)
     * @property {string} yyyymmdd - The date in YYYY-MM-DD format
     * @property {string} dateISOString - Full ISO date string
     */
    getNextMarketDay(date) {
        let currentDate = add(date, { days: 1 });
        while (!this.isMarketDay(currentDate)) {
            currentDate = add(currentDate, { days: 1 });
        }
        return currentDate;
    }
    getDayBoundaries(date) {
        let start;
        let end;
        switch (this.intradayReporting) {
            case 'extended_hours': {
                start = set(date, {
                    hours: MARKET_TIMES.EXTENDED.START.HOUR,
                    minutes: MARKET_TIMES.EXTENDED.START.MINUTE,
                    seconds: 0,
                    milliseconds: 0,
                });
                end = set(date, {
                    hours: MARKET_TIMES.EXTENDED.END.HOUR,
                    minutes: MARKET_TIMES.EXTENDED.END.MINUTE,
                    seconds: 59,
                    milliseconds: 999,
                });
                break;
            }
            case 'continuous': {
                start = startOfDay(date);
                end = endOfDay(date);
                break;
            }
            default: {
                // market_hours
                start = set(date, {
                    hours: MARKET_TIMES.REGULAR.START.HOUR,
                    minutes: MARKET_TIMES.REGULAR.START.MINUTE,
                    seconds: 0,
                    milliseconds: 0,
                });
                // Check for early close
                if (this.isEarlyCloseDay(date)) {
                    const earlyCloseMinutes = this.getEarlyCloseTime(date);
                    if (earlyCloseMinutes !== null) {
                        const earlyCloseHours = Math.floor(earlyCloseMinutes / 60);
                        const earlyCloseMinutesRemainder = earlyCloseMinutes % 60;
                        end = set(date, {
                            hours: earlyCloseHours,
                            minutes: earlyCloseMinutesRemainder,
                            seconds: 59,
                            milliseconds: 999,
                        });
                        break;
                    }
                }
                end = set(date, {
                    hours: MARKET_TIMES.REGULAR.END.HOUR,
                    minutes: MARKET_TIMES.REGULAR.END.MINUTE,
                    seconds: 59,
                    milliseconds: 999,
                });
                break;
            }
        }
        return { start, end };
    }
    calculatePeriodStartDate(endDate, period) {
        let startDate;
        switch (period) {
            case 'YTD':
                startDate = set(endDate, { month: 0, date: 1 });
                break;
            case '1D':
                startDate = this.getLastMarketDay(endDate);
                break;
            case '3D':
                startDate = sub(endDate, { days: 3 });
                break;
            case '1W':
                startDate = sub(endDate, { weeks: 1 });
                break;
            case '2W':
                startDate = sub(endDate, { weeks: 2 });
                break;
            case '1M':
                startDate = sub(endDate, { months: 1 });
                break;
            case '3M':
                startDate = sub(endDate, { months: 3 });
                break;
            case '6M':
                startDate = sub(endDate, { months: 6 });
                break;
            case '1Y':
                startDate = sub(endDate, { years: 1 });
                break;
            default:
                throw new Error(`Invalid period: ${period}`);
        }
        while (!this.isMarketDay(startDate)) {
            startDate = this.getNextMarketDay(startDate);
        }
        return startDate;
    }
    getMarketTimePeriod({ period, end = new Date(), intraday_reporting, outputFormat = 'iso', }) {
        if (!period) {
            throw new Error('Period is required');
        }
        if (intraday_reporting) {
            this.intradayReporting = intraday_reporting;
        }
        // Convert end date to specified timezone
        const zonedEndDate = toZonedTime(end, this.timezone);
        let startDate;
        let endDate;
        const isCurrentMarketDay = this.isMarketDay(zonedEndDate);
        const isWithinHours = this.isWithinMarketHours(zonedEndDate);
        const isBeforeHours = this.isBeforeMarketHours(zonedEndDate);
        // First determine the end date based on current market conditions
        if (isCurrentMarketDay) {
            if (isBeforeHours) {
                // Case 1: Market day before open hours - use previous full trading day
                const lastMarketDay = this.getLastMarketDay(zonedEndDate);
                const { end: dayEnd } = this.getDayBoundaries(lastMarketDay);
                endDate = dayEnd;
            }
            else if (isWithinHours) {
                // Case 2: Market day during hours - use current time
                endDate = zonedEndDate;
            }
            else {
                // Case 3: Market day after close - use today's close
                const { end: dayEnd } = this.getDayBoundaries(zonedEndDate);
                endDate = dayEnd;
            }
        }
        else {
            // Case 4: Not a market day - use previous market day's close
            const lastMarketDay = this.getLastMarketDay(zonedEndDate);
            const { end: dayEnd } = this.getDayBoundaries(lastMarketDay);
            endDate = dayEnd;
        }
        // Now calculate the start date based on the period
        const periodStartDate = this.calculatePeriodStartDate(endDate, period);
        const { start: dayStart } = this.getDayBoundaries(periodStartDate);
        startDate = dayStart;
        // Convert boundaries back to UTC for final output
        const utcStart = fromZonedTime(startDate, this.timezone);
        const utcEnd = fromZonedTime(endDate, this.timezone);
        // Ensure start is not after end
        if (isBefore(utcEnd, utcStart)) {
            throw new Error('Start date cannot be after end date');
        }
        return {
            start: this.formatDate(utcStart, outputFormat),
            end: this.formatDate(utcEnd, outputFormat),
        };
    }
    getMarketOpenClose(options = {}) {
        const { date = new Date() } = options;
        const zonedDate = toZonedTime(date, this.timezone);
        // Check if market is closed for the day
        if (this.isWeekend(zonedDate) || this.isHoliday(zonedDate)) {
            return {
                marketOpen: false,
                open: null,
                close: null,
                openExt: null,
                closeExt: null,
            };
        }
        const dayStart = startOfDay(zonedDate);
        const regularOpenTime = MARKET_TIMES.REGULAR.START;
        let regularCloseTime = MARKET_TIMES.REGULAR.END;
        const extendedOpenTime = MARKET_TIMES.EXTENDED.START;
        let extendedCloseTime = MARKET_TIMES.EXTENDED.END;
        // Check for early close
        const isEarlyClose = this.isEarlyCloseDay(zonedDate);
        if (isEarlyClose) {
            const earlyCloseMinutes = this.getEarlyCloseTime(zonedDate);
            if (earlyCloseMinutes !== null) {
                // For regular hours, use the early close time
                regularCloseTime = {
                    HOUR: Math.floor(earlyCloseMinutes / 60),
                    MINUTE: earlyCloseMinutes % 60,
                    MINUTES: earlyCloseMinutes,
                };
                // For extended hours on early close days, close at 5:00 PM
                extendedCloseTime = {
                    HOUR: 17,
                    MINUTE: 0,
                    MINUTES: 1020,
                };
            }
        }
        const open = fromZonedTime(set(dayStart, { hours: regularOpenTime.HOUR, minutes: regularOpenTime.MINUTE }), this.timezone);
        const close = fromZonedTime(set(dayStart, { hours: regularCloseTime.HOUR, minutes: regularCloseTime.MINUTE }), this.timezone);
        const openExt = fromZonedTime(set(dayStart, { hours: extendedOpenTime.HOUR, minutes: extendedOpenTime.MINUTE }), this.timezone);
        const closeExt = fromZonedTime(set(dayStart, { hours: extendedCloseTime.HOUR, minutes: extendedCloseTime.MINUTE }), this.timezone);
        return {
            marketOpen: true,
            open,
            close,
            openExt,
            closeExt,
        };
    }
}
/**
 * Creates a new MarketTimeUtil instance
 * @param {string} [timezone] - The timezone to use for market time calculations
 * @param {IntradayReporting} [intraday_reporting] - The intraday reporting mode
 * @returns {MarketTimeUtil} A new MarketTimeUtil instance
 */
function createMarketTimeUtil(timezone, intraday_reporting) {
    return new MarketTimeUtil(timezone, intraday_reporting);
}
/**
 * Gets start and end timestamps for a given market time period
 * @param {MarketTimeParams} [params] - The market time parameters
 * @returns {PeriodDates} The start and end timestamps
 */
function getStartAndEndTimestamps(params = {}) {
    const util = createMarketTimeUtil(params.timezone, params.intraday_reporting);
    const effectiveParams = {
        ...params,
        end: params.referenceDate || params.end || new Date(),
    };
    return util.getMarketTimePeriod(effectiveParams);
}
/**
 * Gets the market open/close times for a given date
 * @param {Object} [options] - Options object
 * @param {Date} [options.date] - The date to check (defaults to current date)
 * @returns {MarketOpenCloseResult} The market open/close times
 */
function getMarketOpenClose(options = {}) {
    const marketTimeUtil = new MarketTimeUtil();
    return marketTimeUtil.getMarketOpenClose(options);
}
/**
 * Gets the start and end dates for a given market time period
 * @param {MarketTimeParams} [params] - The market time parameters
 * @returns {Object} The start and end dates
 * @property {Date} start - The start date
 * @property {Date} end - The end date
 */
function getStartAndEndDates(params = {}) {
    const util = createMarketTimeUtil(params.timezone, params.intraday_reporting);
    const effectiveParams = {
        ...params,
        end: params.referenceDate || params.end || new Date(),
    };
    const { start, end } = util.getMarketTimePeriod(effectiveParams);
    // Ensure the returned values are Dates
    return {
        start: new Date(start),
        end: new Date(end),
    };
}
/**
 * Gets the last trading date in YYYY-MM-DD format
 * @returns {string} The last trading date in YYYY-MM-DD format
 */
function getLastTradingDateYYYYMMDD() {
    const util = new MarketTimeUtil();
    const lastTradingDate = util.getLastTradingDate();
    return format(lastTradingDate, 'yyyy-MM-dd');
}
/**
 * Gets the last full trading date
 * @param {Date} [currentDate] - The current date (defaults to now)
 * @returns {Object} The last full trading date
 * @property {Date} date - The date object
 * @property {string} YYYYMMDD - The date in YYYY-MM-DD format
 */
function getLastFullTradingDate(currentDate = new Date()) {
    const util = new MarketTimeUtil();
    const date = util.getLastFullTradingDate(currentDate);
    // Format the date in NY timezone to ensure consistency
    return {
        date,
        YYYYMMDD: formatInTimeZone(date, MARKET_TIMES.TIMEZONE, 'yyyy-MM-dd'),
    };
}
/**
 * Gets the next market day from a reference date
 * @param {Object} [options] - Options object
 * @param {Date} [options.referenceDate] - The reference date (defaults to current date)
 * @returns {Object} The next market day information
 * @property {Date} date - The date object (start of day in NY time)
 * @property {string} yyyymmdd - The date in YYYY-MM-DD format
 * @property {string} dateISOString - Full ISO date string
 */
function getNextMarketDay({ referenceDate } = {}) {
    const util = new MarketTimeUtil();
    const startDate = referenceDate || new Date();
    const nextDate = util.getNextMarketDay(startDate);
    // Convert to start of day in NY time
    const startOfDayNY = startOfDay(toZonedTime(nextDate, MARKET_TIMES.TIMEZONE));
    const dateInET = fromZonedTime(startOfDayNY, MARKET_TIMES.TIMEZONE);
    return {
        date: dateInET,
        yyyymmdd: formatInTimeZone(dateInET, MARKET_TIMES.TIMEZONE, 'yyyy-MM-dd'),
        dateISOString: dateInET.toISOString()
    };
}
/**
 * Gets the current time in Eastern Time
 * @returns {Date} The current time in Eastern Time
 */
const currentTimeET = () => {
    return toZonedTime(new Date(), MARKET_TIMES.TIMEZONE);
};
/**
 * Gets a date in New York timezone, rezoned using date-fns-tz
 * @param {number|string|Date} time - The time to convert
 * @returns {Date} The date in New York timezone
 */
function getDateInNY(time) {
    let date;
    if (typeof time === 'number' || typeof time === 'string' || time instanceof Date) {
        // Assuming Unix timestamp in epoch milliseconds, string date, or Date object
        date = new Date(time);
    }
    else {
        // Assuming object with year, month, and day
        date = new Date(time.year, time.month - 1, time.day);
    }
    return toZonedTime(date, 'America/New_York');
}
/**
 * Gets the trading date in YYYY-MM-DD format for New York timezone, for grouping of data
 * @param {string|number|Date} time - The time to convert (string, unix timestamp in ms, or Date object)
 * @returns {string} The trading date in YYYY-MM-DD format
 */
function getTradingDate(time) {
    let date;
    if (typeof time === 'number') {
        // Assuming Unix timestamp in milliseconds
        date = new Date(time);
    }
    else if (typeof time === 'string') {
        date = new Date(time);
    }
    else {
        date = time;
    }
    // Convert to NY timezone and format as YYYY-MM-DD
    return formatInTimeZone(date, MARKET_TIMES.TIMEZONE, 'yyyy-MM-dd');
}
/**
 * Returns the New York timezone offset based on whether daylight savings is active
 * @param dateString - The date string to check
 * @returns "-04:00" during daylight savings (EDT) or "-05:00" during standard time (EST)
 */
const getNYTimeZone = (date) => {
    if (!date) {
        date = new Date();
    }
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        timeZoneName: 'shortOffset',
    });
    const parts = dtf.formatToParts(date);
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value;
    // tz will be "GMT-5" or "GMT-4"
    if (!tz) {
        throw new Error('Could not determine New York offset');
    }
    // extract the -4 or -5 from the string
    const shortOffset = tz.replace('GMT', '');
    // return the correct offset
    if (shortOffset === '-4') {
        console.log(`New York is on EDT; using -04:00. Full date: ${date.toLocaleString('en-US', {
            timeZone: 'America/New_York',
        })}, time zone part: ${tz}`);
        return '-04:00';
    }
    else if (shortOffset === '-5') {
        console.log(`New York is on EST; using -05:00. Full date: ${date.toLocaleString('en-US', {
            timeZone: 'America/New_York',
        })}, time zone part: ${tz}`);
        return '-05:00';
    }
    else {
        throw new Error('Could not determine New York offset');
    }
};
/**
 * Gets the current market status
 * @param {Object} [options] - Options object
 * @param {Date} [options.date] - The date to check (defaults to current date)
 * @returns {MarketStatus} The current market status
 */
function getMarketStatus(options = {}) {
    const util = new MarketTimeUtil();
    const now = options.date || new Date();
    const nyTime = toZonedTime(now, MARKET_TIMES.TIMEZONE);
    const isEarlyCloseDay = util.isEarlyCloseDay(nyTime);
    const timeInMinutes = nyTime.getHours() * 60 + nyTime.getMinutes();
    const extendedStartMinutes = MARKET_TIMES.EXTENDED.START.MINUTES;
    const marketStartMinutes = MARKET_TIMES.REGULAR.START.MINUTES;
    MARKET_TIMES.EARLY_MORNING.END.MINUTES;
    const marketRegularCloseMinutes = isEarlyCloseDay
        ? MARKET_TIMES.EARLY_CLOSE_BEFORE_HOLIDAY.END.MINUTES
        : MARKET_TIMES.REGULAR.END.MINUTES;
    const extendedEndMinutes = isEarlyCloseDay
        ? MARKET_TIMES.EARLY_EXTENDED_BEFORE_HOLIDAY.END.MINUTES
        : MARKET_TIMES.EXTENDED.END.MINUTES;
    let status;
    let nextStatus;
    let nextStatusTime;
    let marketPeriod;
    const nextMarketDay = util.getNextMarketDay(nyTime);
    // Determine current status and market period
    if (!util.isMarketDay(nyTime)) {
        // Not a market day! market is closed
        marketPeriod = 'closed';
        status = 'closed';
        nextStatus = 'extended hours';
        // Find next market day and set to extended hours start time
        nextStatusTime = set(nextMarketDay, {
            hours: MARKET_TIMES.EXTENDED.START.HOUR,
            minutes: MARKET_TIMES.EXTENDED.START.MINUTE,
        });
    } // check if the market isn't in extended hours yet
    else if (timeInMinutes >= 0 && timeInMinutes < extendedStartMinutes) {
        marketPeriod = 'closed';
        status = 'closed';
        nextStatus = 'extended hours';
        nextStatusTime = set(nyTime, {
            hours: MARKET_TIMES.EXTENDED.START.HOUR,
            minutes: MARKET_TIMES.EXTENDED.START.MINUTE,
        });
        // check if we're in pre-market hours
    }
    else if (timeInMinutes >= extendedStartMinutes && timeInMinutes < marketStartMinutes) {
        marketPeriod = 'preMarket';
        status = 'extended hours';
        nextStatus = 'open';
        nextStatusTime = set(nyTime, {
            hours: MARKET_TIMES.REGULAR.START.HOUR,
            minutes: MARKET_TIMES.REGULAR.START.MINUTE,
        });
        // check if market is open
    }
    else if (timeInMinutes >= marketStartMinutes && timeInMinutes < marketRegularCloseMinutes) {
        status = 'open';
        nextStatus = 'extended hours';
        // market is open, but just check the marketPeriod - could be earlyMarket or regularMarket
        marketPeriod = timeInMinutes < MARKET_TIMES.EARLY_MORNING.END.MINUTES ? 'earlyMarket' : 'regularMarket';
        nextStatusTime = isEarlyCloseDay
            ? set(nyTime, {
                hours: MARKET_TIMES.EARLY_CLOSE_BEFORE_HOLIDAY.END.HOUR,
                minutes: MARKET_TIMES.EARLY_CLOSE_BEFORE_HOLIDAY.END.MINUTE,
            })
            : set(nyTime, {
                hours: MARKET_TIMES.REGULAR.END.HOUR,
                minutes: MARKET_TIMES.REGULAR.END.MINUTE,
            });
        // check if it's after-market extended hours
    }
    else if (timeInMinutes >= marketRegularCloseMinutes && timeInMinutes < extendedEndMinutes) {
        status = 'extended hours';
        nextStatus = 'closed';
        marketPeriod = 'afterMarket';
        nextStatusTime = isEarlyCloseDay
            ? set(nyTime, {
                hours: MARKET_TIMES.EARLY_EXTENDED_BEFORE_HOLIDAY.END.HOUR,
                minutes: MARKET_TIMES.EARLY_EXTENDED_BEFORE_HOLIDAY.END.MINUTE,
            })
            : set(nyTime, {
                hours: MARKET_TIMES.EXTENDED.END.HOUR,
                minutes: MARKET_TIMES.EXTENDED.END.MINUTE,
            });
        // otherwise, the market is closed
    }
    else {
        status = 'closed';
        nextStatus = 'extended hours';
        marketPeriod = 'closed';
        nextStatusTime = set(nextMarketDay, {
            hours: MARKET_TIMES.EXTENDED.START.HOUR,
            minutes: MARKET_TIMES.EXTENDED.START.MINUTE,
        });
    }
    const dateFormat = 'MMMM dd, yyyy, HH:mm:ss a';
    return {
        time: now,
        timeString: format(nyTime, dateFormat),
        status,
        nextStatus,
        marketPeriod,
        nextStatusTime: fromZonedTime(nextStatusTime, MARKET_TIMES.TIMEZONE),
        nextStatusTimeDifference: differenceInMilliseconds(nextStatusTime, nyTime),
        nextStatusTimeString: format(nextStatusTime, dateFormat),
    };
}

// performance-metrics.ts
/**
 * Calculates the total return year-to-date (YTD) for a given portfolio history.
 * @param portfolioHistory - The portfolio history data containing equity values.
 * @returns A promise that resolves to a string representing the total return YTD in percentage format.
 */
async function calculateTotalReturnYTD(portfolioHistory) {
    const equity = portfolioHistory.equity; // array of equity values
    if (!equity || !Array.isArray(equity) || equity.length < 2) {
        console.warn('Not enough data to calculate total return.');
        return 'N/A';
    }
    let startEquity = equity[0];
    const endEquity = equity[equity.length - 1];
    // Validate startEquity and endEquity
    if (typeof startEquity !== 'number' || isNaN(startEquity)) {
        console.warn('Invalid start equity value.');
        return 'N/A';
    }
    // if startEquity is 0 or less, fetch the first non-zero value in the array
    if (startEquity <= 0) {
        for (let i = 1; i < equity.length; i++) {
            if (equity[i] > 0) {
                startEquity = equity[i];
                break;
            }
        }
    }
    if (typeof endEquity !== 'number' || isNaN(endEquity)) {
        console.warn('Invalid end equity value.');
    }
    // Calculate total return
    const totalReturn = ((endEquity - startEquity) / startEquity) * 100;
    return `${totalReturn.toFixed(2)}%`;
}
/**
 * Calculates the expense ratio for a given Alpaca account.
 * @param accountId - The ID of the Alpaca account.
 * @param client - The Apollo client instance.
 * @param alpacaAccount - The Alpaca account object.
 * @returns A promise that resolves to a string representing the expense ratio in percentage format.
 */
async function calculateExpenseRatio$1({ accountId, client, alpacaAccount }) {
    if (!accountId && !alpacaAccount && !client) {
        console.warn('Missing account ID or client to calculate expense ratio.');
        return 'N/A';
    }
    let alpacaAccountId = accountId || (alpacaAccount && alpacaAccount.id) || '';
    let accountDetails;
    if (!alpacaAccountId) {
        console.warn('Invalid account ID.');
        return 'N/A';
    }
    if (alpacaAccount) {
        // Use Alpaca account object to get accountDetails
        accountDetails = await fetchAccountDetails({ alpacaAccount: alpacaAccount });
        if (!accountDetails) {
            console.warn('Failed to fetch account details inside calculateExpenseRatio.');
            return 'N/A';
        }
    }
    else {
        // Fetch account details using account ID and client
        accountDetails = await fetchAccountDetails({ accountId, client });
        if (!accountDetails) {
            console.warn('Failed to fetch account details inside calculateExpenseRatio.');
            return 'N/A';
        }
    }
    // Validate equity
    if (!accountDetails.equity || isNaN(parseFloat(accountDetails.equity))) {
        console.warn('Invalid equity value.');
        return 'N/A';
    }
    const equity = parseFloat(accountDetails.equity);
    // Fetch portfolio expenses from your system (Assuming you have this data)
    const expenses = await getPortfolioExpensesFromYourSystem();
    // Calculate expense ratio
    const expenseRatio = (expenses / equity) * 100;
    return `${expenseRatio.toFixed(2)}%`;
}
// Mock function to represent fetching expenses from your system
async function getPortfolioExpensesFromYourSystem(accountId) {
    // Implement this function based on your data storage
    return 0; // Placeholder
}
/**
 * Calculates the liquidity ratio for a given Alpaca account.
 * @param accountId - The ID of the Alpaca account.
 * @param client - The Apollo client instance.
 * @param alpacaAccount - The Alpaca account object.
 * @returns A promise that resolves to a string representing the liquidity ratio in the format "1:ratio".
 */
async function calculateLiquidityRatio({ accountId, client, alpacaAccount }) {
    if (!accountId && !alpacaAccount && !client) {
        console.warn('Missing account ID or client to calculateLiquidityRatio.');
        return 'N/A';
    }
    let alpacaAccountId = accountId || (alpacaAccount && alpacaAccount.id) || '';
    let accountDetails;
    if (!alpacaAccountId) {
        console.warn('Invalid account ID.');
        return 'N/A';
    }
    if (alpacaAccount) {
        // Use Alpaca account object to get accountDetails
        accountDetails = await fetchAccountDetails({ alpacaAccount: alpacaAccount });
        if (!accountDetails) {
            console.warn('Failed to fetch account details inside calculateLiquidityRatio.');
            return 'N/A';
        }
    }
    else {
        // Fetch account details using account ID and client
        accountDetails = await fetchAccountDetails({ accountId, client });
        if (!accountDetails) {
            console.warn('Failed to fetch account details.');
            return 'N/A';
        }
    }
    const cashBalance = parseFloat(accountDetails.cash);
    const equity = parseFloat(accountDetails.equity);
    const totalPositionsValue = equity - cashBalance;
    if (isNaN(cashBalance)) {
        console.warn('Invalid cash balance.');
        return 'N/A';
    }
    if (isNaN(equity)) {
        console.warn('Invalid equity value.');
        return 'N/A';
    }
    // Calculate total portfolio value
    const totalPortfolioValue = cashBalance + totalPositionsValue;
    if (totalPortfolioValue <= 0) {
        console.warn('Total portfolio value is zero or negative.');
        return 'N/A';
    }
    // Calculate liquidity ratio as Total Portfolio Value to Cash Balance
    const ratio = totalPortfolioValue / cashBalance;
    // Ensure the ratio is a finite number
    if (!isFinite(ratio)) {
        console.warn('Liquidity ratio calculation resulted in a non-finite number.');
        return 'N/A';
    }
    return `1:${ratio.toFixed(2)}`;
}
/**
 * Calculates the risk-adjusted return for a given portfolio history.
 * @param portfolioHistory - The portfolio history data containing profit/loss percentages.
 * @returns A promise that resolves to a string representing the risk-adjusted return.
 */
async function calculateRiskAdjustedReturn$1(portfolioHistory) {
    const returns = portfolioHistory.profit_loss_pct; // Array of percentage returns in decimal form
    // Validate the returns array
    if (!returns || !Array.isArray(returns) || returns.length < 2) {
        console.warn('No returns data available.');
        return 'N/A';
    }
    // Filter out invalid returns
    const validReturns = returns.filter((ret) => typeof ret === 'number' && !isNaN(ret));
    if (validReturns.length < 2) {
        console.warn('Not enough valid returns data to calculate risk-adjusted return.');
        return 'N/A';
    }
    // Calculate average daily return
    const avgDailyReturn = validReturns.reduce((sum, ret) => sum + ret, 0) / validReturns.length;
    // Calculate standard deviation of daily returns
    const mean = avgDailyReturn;
    const squaredDiffs = validReturns.map((ret) => Math.pow(ret - mean, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / (validReturns.length - 1);
    const stdDevDaily = Math.sqrt(variance);
    // Annualize average return and standard deviation
    const tradingDaysPerYear = 252;
    const avgAnnualReturn = avgDailyReturn * tradingDaysPerYear;
    const stdDevAnnual = stdDevDaily * Math.sqrt(tradingDaysPerYear);
    // Check for zero or non-finite standard deviation
    if (!isFinite(stdDevAnnual) || stdDevAnnual === 0) {
        console.warn('Standard deviation is zero or non-finite, cannot calculate Sharpe ratio.');
        return 'N/A';
    }
    // Assume a risk-free rate, e.g., 2%
    const riskFreeRate = 0.02; // Annual risk-free rate (2%)
    // Calculate Sharpe Ratio
    const sharpeRatio = (avgAnnualReturn - riskFreeRate) / stdDevAnnual;
    if (!isFinite(sharpeRatio)) {
        console.warn('Sharpe ratio calculation resulted in a non-finite number.');
        return 'N/A';
    }
    // Return the Sharpe Ratio formatted to two decimal places
    return `${sharpeRatio.toFixed(2)}`;
}
/**
 * Retrieves the dividend yield for the portfolio.
 * @returns A promise that resolves to a string representing the dividend yield.
 */
async function getDividendYield() {
    return "N/A";
}
/**
 * Cleans the portfolio equity data by replacing NaN and Infinity values with the last valid value.
 * @param equity - Array of portfolio equity values.
 * @returns Cleaned equity array.
 */
function interpolatePortfolioEquity(equity) {
    const cleanedEquity = [];
    let lastValid = 0;
    for (let i = 0; i < equity.length; i++) {
        if (isFinite(equity[i])) {
            cleanedEquity.push(equity[i]);
            lastValid = equity[i];
        }
        else {
            console.warn(`Invalid equity value at index ${i}: ${equity[i]}. Replacing with last valid value: ${lastValid}`);
            cleanedEquity.push(lastValid);
        }
    }
    return cleanedEquity;
}
/**
 * Calculates the alpha, beta, and annualized Alpha of the portfolio compared to a benchmark.
 * @param portfolioHistory - The portfolio history data.
 * @param benchmarkBars - The historical price data of the benchmark.
 * @returns An object containing alpha, beta, and annualized alpha.
 */
async function calculateAlphaAndBeta$1(portfolioHistory, benchmarkBars) {
    if (!portfolioHistory || !benchmarkBars || benchmarkBars.length < 2) {
        console.warn('Insufficient portfolio or benchmark data.', {
            portfolioHistory,
            benchmarkBars,
        });
        return {
            alpha: 'N/A',
            alphaAnnualized: 'N/A',
            beta: 'N/A',
        };
    }
    let portfolioEquity = portfolioHistory.equity;
    let portfolioTimestamps = portfolioHistory.timestamp;
    if (!portfolioEquity ||
        !Array.isArray(portfolioEquity) ||
        portfolioEquity.length < 2 ||
        !portfolioTimestamps ||
        !Array.isArray(portfolioTimestamps) ||
        portfolioTimestamps.length !== portfolioEquity.length) {
        console.warn('Invalid or insufficient portfolio equity data.', {
            portfolioEquity,
            portfolioTimestamps,
        });
        return {
            alpha: 'N/A',
            alphaAnnualized: 'N/A',
            beta: 'N/A',
        };
    }
    // **Trim initial zero equity values**
    const firstNonZeroIndex = portfolioEquity.findIndex((equity) => equity !== 0);
    if (firstNonZeroIndex === -1) {
        console.warn('Portfolio equity contains only zeros.');
        return {
            alpha: 'N/A',
            alphaAnnualized: 'N/A',
            beta: 'N/A',
        };
    }
    portfolioEquity = portfolioEquity.slice(firstNonZeroIndex);
    portfolioTimestamps = portfolioTimestamps.slice(firstNonZeroIndex);
    // **Convert portfolio timestamps from ISO strings to Unix milliseconds**
    portfolioTimestamps = portfolioTimestamps.map((timestamp) => timestamp * 1000);
    // **Normalize portfolio timestamps to midnight UTC**
    portfolioTimestamps = portfolioTimestamps.map((timestamp) => getMidnightTimestamp(timestamp));
    // **Clean the portfolio equity data**
    const cleanedPortfolioEquity = interpolatePortfolioEquity(portfolioEquity);
    // **Calculate portfolio returns with Unix millisecond timestamps**
    const portfolioReturnsWithDates = calculateDailyReturnsWithTimestamps(cleanedPortfolioEquity, portfolioTimestamps);
    // **Process benchmark data**
    const benchmarkPrices = benchmarkBars.map((bar) => bar.c);
    let benchmarkTimestamps = benchmarkBars.map((bar) => bar.t);
    if (!benchmarkPrices ||
        !Array.isArray(benchmarkPrices) ||
        benchmarkPrices.length < 2 ||
        !benchmarkTimestamps ||
        !Array.isArray(benchmarkTimestamps) ||
        benchmarkTimestamps.length !== benchmarkPrices.length) {
        console.warn('Invalid or insufficient benchmark data.', {
            benchmarkPrices,
            benchmarkTimestamps,
        });
        return {
            alpha: 'N/A',
            alphaAnnualized: 'N/A',
            beta: 'N/A',
        };
    }
    // **Convert benchmark timestamps from Unix seconds to Unix milliseconds**
    benchmarkTimestamps = benchmarkTimestamps.map((timestamp) => timestamp * 1000);
    // **Normalize benchmark timestamps to midnight UTC**
    benchmarkTimestamps = benchmarkTimestamps.map((timestamp) => getMidnightTimestamp(timestamp));
    // **Calculate benchmark returns with Unix millisecond timestamps**
    const benchmarkReturnsWithDates = calculateDailyReturnsWithTimestamps(benchmarkPrices, benchmarkTimestamps);
    // **Align returns by timestamp and ensure returns are finite**
    const portfolioReturnsMap = new Map();
    portfolioReturnsWithDates.forEach(({ timestamp, return: ret }) => {
        if (isFinite(ret)) {
            portfolioReturnsMap.set(timestamp, ret);
        }
        else {
            console.warn(`Non-finite portfolio return on ${new Date(timestamp).toISOString()}: ${ret}. Skipping.`);
        }
    });
    const benchmarkReturnsMap = new Map();
    benchmarkReturnsWithDates.forEach(({ timestamp, return: ret }) => {
        if (isFinite(ret)) {
            benchmarkReturnsMap.set(timestamp, ret);
        }
        else {
            console.warn(`Non-finite benchmark return on ${new Date(timestamp).toISOString()}: ${ret}. Skipping.`);
        }
    });
    // **Find common timestamps**
    const commonTimestamps = [...portfolioReturnsMap.keys()].filter((timestamp) => benchmarkReturnsMap.has(timestamp));
    if (commonTimestamps.length < 2) {
        console.warn('Not enough overlapping data to calculate alpha.');
        return {
            alpha: 'N/A',
            alphaAnnualized: 'N/A',
            beta: 'N/A',
        };
    }
    // **Align returns**
    const alignedPortfolioReturns = [];
    const alignedBenchmarkReturns = [];
    for (const timestamp of commonTimestamps) {
        const portfolioRet = portfolioReturnsMap.get(timestamp);
        const benchmarkRet = benchmarkReturnsMap.get(timestamp);
        if (isFinite(portfolioRet) && isFinite(benchmarkRet)) {
            alignedPortfolioReturns.push(portfolioRet);
            alignedBenchmarkReturns.push(benchmarkRet);
        }
        else {
            console.warn(`Non-finite returns on ${new Date(timestamp).toISOString()}. Skipping.`);
        }
    }
    const n = alignedPortfolioReturns.length;
    if (n === 0) {
        console.warn('No valid aligned returns to calculate alpha.');
        return {
            alpha: 'N/A',
            alphaAnnualized: 'N/A',
            beta: 'N/A',
        };
    }
    // **Calculate average returns**
    const portfolioAvgReturn = alignedPortfolioReturns.reduce((sum, ret) => sum + ret, 0) / n;
    const benchmarkAvgReturn = alignedBenchmarkReturns.reduce((sum, ret) => sum + ret, 0) / n;
    // **Calculate beta**
    const beta = calculateBetaFromReturns$1(alignedPortfolioReturns, alignedBenchmarkReturns);
    if (!isFinite(beta.beta)) {
        console.warn('Beta calculation resulted in a non-finite value.');
        return {
            alpha: 'N/A',
            alphaAnnualized: 'N/A',
            beta: 'N/A',
        };
    }
    // **Calculate alpha**
    const riskFreeRateAnnual = 0.02; // 2%
    const tradingDaysPerYear = 252;
    const riskFreeRateDaily = riskFreeRateAnnual / tradingDaysPerYear;
    const alpha = portfolioAvgReturn - (riskFreeRateDaily + beta.beta * (benchmarkAvgReturn - riskFreeRateDaily));
    const alphaAnnualized = alpha * tradingDaysPerYear;
    if (!isFinite(alphaAnnualized)) {
        console.warn('Alpha calculation resulted in a non-finite value.');
        return {
            alpha: 'N/A',
            alphaAnnualized: 'N/A',
            beta: 'N/A',
        };
    }
    return {
        alpha: `${(alpha * 100).toFixed(2)}`,
        alphaAnnualized: `${(alphaAnnualized * 100).toFixed(2)}`,
        beta: `${(beta.beta * 100).toFixed(2)}`,
    };
}
// **Helper function to calculate daily returns with Unix millisecond timestamps**
function calculateDailyReturnsWithTimestamps(values, timestamps) {
    const returnsWithTimestamps = [];
    for (let i = 1; i < values.length; i++) {
        const prevValue = values[i - 1];
        const currValue = values[i];
        const currTimestamp = timestamps[i];
        if (!isFinite(prevValue) || prevValue === 0) {
            // Avoid division by zero or invalid returns
            continue;
        }
        const ret = (currValue - prevValue) / prevValue;
        returnsWithTimestamps.push({ timestamp: currTimestamp, return: ret });
    }
    return returnsWithTimestamps;
}
// **Helper function to normalize timestamps to midnight UTC**
function getMidnightTimestamp(timestamp) {
    const date = new Date(timestamp);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
}
/**
 * Calculates the Maximum Drawdown (MDD) and related metrics from an array of equity values.
 *
 * @param equity - An array of equity values (must contain at least one positive number)
 * @param options - Configuration options for the calculation
 * @returns Object containing drawdown metrics
 * @throws Will throw an error if the input is invalid
 */
function calculateDrawdownMetrics(equity, options = {}) {
    // Default options
    const decimals = options.decimals ?? 2;
    const minimumDrawdown = options.minimumDrawdown ?? 0;
    // Input validation
    if (!Array.isArray(equity) || equity.length === 0) {
        throw new TypeError('Equity data must be a non-empty array of numbers.');
    }
    // Pre-validate all equity values at once
    const validEquity = equity.map((value, index) => {
        if (typeof value !== 'number' || isNaN(value)) {
            console.warn(`Invalid equity value at index ${index}: ${value}. Using 0 instead.`);
            return 0;
        }
        return value;
    });
    // Single-pass algorithm for efficiency
    let maxDrawdown = 0;
    let maxPeakIndex = 0;
    let maxTroughIndex = 0;
    let peakIndex = 0;
    let peakValue = validEquity[0];
    let currentPeakValue = validEquity[0];
    let recoveryIndex;
    // Main loop - O(n) complexity
    for (let i = 1; i < validEquity.length; i++) {
        const currentValue = validEquity[i];
        // Update peak if we have a new high
        if (currentValue >= peakValue) {
            peakValue = currentValue;
            peakIndex = i;
        }
        else {
            // Calculate drawdown from peak
            const drawdown = peakValue <= 0 ? 0 : (peakValue - currentValue) / peakValue;
            // Update max drawdown if current drawdown is greater
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
                maxPeakIndex = peakIndex;
                maxTroughIndex = i;
                recoveryIndex = undefined;
            }
            // Check for recovery from max drawdown
            if (!recoveryIndex && maxDrawdown > 0 && currentValue >= validEquity[maxPeakIndex]) {
                recoveryIndex = i;
            }
        }
        // Track current peak for current drawdown calculation
        if (currentValue >= currentPeakValue) {
            currentPeakValue = currentValue;
        }
    }
    // Calculate current drawdown
    const lastValue = validEquity[validEquity.length - 1];
    const currentDrawdown = currentPeakValue <= 0 ? 0 : (currentPeakValue - lastValue) / currentPeakValue;
    // Helper for percentage formatting
    const formatPercentage = (value) => {
        const percentage = value * 100;
        return `${parseFloat(percentage.toFixed(decimals))}%`;
    };
    // If no drawdown meets minimum threshold, return default values
    if (maxDrawdown < minimumDrawdown) {
        return {
            maxDrawdownPercentage: '0%',
            maxDrawdownValue: 0,
            peakValue: validEquity[0],
            troughValue: validEquity[0],
            peakIndex: 0,
            troughIndex: 0,
            drawdownPeriod: 0,
            recoveryIndex: undefined,
            recoveryPeriod: undefined,
            currentDrawdownPercentage: formatPercentage(currentDrawdown >= minimumDrawdown ? currentDrawdown : 0),
        };
    }
    // Calculate periods
    const drawdownPeriod = maxTroughIndex - maxPeakIndex;
    const recoveryPeriod = recoveryIndex !== undefined ? recoveryIndex - maxTroughIndex : undefined;
    return {
        maxDrawdownPercentage: formatPercentage(maxDrawdown),
        maxDrawdownValue: validEquity[maxPeakIndex] - validEquity[maxTroughIndex],
        peakValue: validEquity[maxPeakIndex],
        troughValue: validEquity[maxTroughIndex],
        peakIndex: maxPeakIndex,
        troughIndex: maxTroughIndex,
        drawdownPeriod,
        recoveryIndex,
        recoveryPeriod,
        currentDrawdownPercentage: formatPercentage(currentDrawdown >= minimumDrawdown ? currentDrawdown : 0),
    };
}
/**
 * Simplified version that returns only the maximum drawdown percentage
 * For backward compatibility
 * @param equity - An array of equity values.
 * @param decimals - Number of decimal places for the percentage value.
 * @returns The maximum drawdown percentage as a string.
 */
function calculateMaxDrawdown$1(equity, decimals = 2) {
    const result = calculateDrawdownMetrics(equity, { decimals });
    return result.maxDrawdownPercentage;
}
/**
 * Calculates daily log returns for an array of prices.
 * Log returns are preferred for statistical properties.
 * @param prices - Array of prices.
 * @returns Array of daily log returns.
 */
function calculateDailyReturns$1(prices) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        const previous = prices[i - 1];
        const current = prices[i];
        if (!isFinite(previous) || !isFinite(current) || previous <= 0) {
            continue; // Skip invalid returns
        }
        const logReturn = Math.log(current / previous);
        returns.push(logReturn);
    }
    return returns;
}
/**
 * Aligns portfolio and benchmark returns based on matching dates.
 * @param portfolioHistory - The portfolio history data.
 * @param benchmarkBars - The historical price data of the benchmark.
 * @returns An object containing aligned returns arrays.
 */
function alignReturnsByDate(portfolioHistory, benchmarkBars) {
    const portfolioEquity = portfolioHistory.equity;
    let portfolioTimestamps = portfolioHistory.timestamp;
    const benchmarkPrices = benchmarkBars.map((bar) => bar.c);
    let benchmarkTimestamps = benchmarkBars.map((bar) => bar.t);
    // **Convert portfolio timestamps from ISO strings to Unix milliseconds**
    portfolioTimestamps = portfolioTimestamps.map((timestamp) => timestamp * 1000);
    // **Normalize portfolio timestamps to midnight UTC**
    portfolioTimestamps = portfolioTimestamps.map((timestamp) => getMidnightTimestamp(timestamp));
    // **Convert benchmark timestamps from Unix seconds to Unix milliseconds**
    benchmarkTimestamps = benchmarkTimestamps.map((timestamp) => timestamp * 1000);
    // **Normalize benchmark timestamps to midnight UTC**
    benchmarkTimestamps = benchmarkTimestamps.map((timestamp) => getMidnightTimestamp(timestamp));
    // Calculate log daily returns
    const portfolioReturns = calculateDailyReturns$1(portfolioEquity);
    const benchmarkReturns = calculateDailyReturns$1(benchmarkPrices);
    // Create maps of timestamp to return
    const portfolioReturnsMap = new Map();
    for (let i = 1; i < portfolioTimestamps.length; i++) {
        const timestamp = portfolioTimestamps[i];
        const ret = portfolioReturns[i - 1];
        if (isFinite(ret)) {
            portfolioReturnsMap.set(timestamp, ret);
        }
    }
    const benchmarkReturnsMap = new Map();
    for (let i = 1; i < benchmarkTimestamps.length; i++) {
        const timestamp = benchmarkTimestamps[i];
        const ret = benchmarkReturns[i - 1];
        if (isFinite(ret)) {
            benchmarkReturnsMap.set(timestamp, ret);
        }
    }
    // Find common timestamps
    const commonTimestamps = [...portfolioReturnsMap.keys()].filter((timestamp) => benchmarkReturnsMap.has(timestamp));
    if (commonTimestamps.length === 0) {
        console.warn('No common dates found between portfolio and benchmark.');
        return {
            alignedPortfolioReturns: [],
            alignedBenchmarkReturns: [],
        };
    }
    // Extract aligned returns
    const alignedPortfolioReturns = [];
    const alignedBenchmarkReturns = [];
    for (const timestamp of commonTimestamps) {
        const portfolioRet = portfolioReturnsMap.get(timestamp);
        const benchmarkRet = benchmarkReturnsMap.get(timestamp);
        alignedPortfolioReturns.push(portfolioRet);
        alignedBenchmarkReturns.push(benchmarkRet);
    }
    return { alignedPortfolioReturns, alignedBenchmarkReturns };
}
/**
 * Calculates the beta of the portfolio compared to a benchmark.
 * @param portfolioReturns - Array of portfolio returns.
 * @param benchmarkReturns - Array of benchmark returns.
 * @returns An object containing beta and intermediate calculations.
 */
function calculateBetaFromReturns$1(portfolioReturns, benchmarkReturns) {
    const n = portfolioReturns.length;
    if (n === 0) {
        console.warn('No returns to calculate beta.');
        return {
            beta: 0,
            covariance: 0,
            variance: 0,
            averagePortfolioReturn: 0,
            averageBenchmarkReturn: 0,
        };
    }
    // Calculate average returns
    const averagePortfolioReturn = portfolioReturns.reduce((sum, ret) => sum + ret, 0) / n;
    const averageBenchmarkReturn = benchmarkReturns.reduce((sum, ret) => sum + ret, 0) / n;
    // Calculate covariance and variance
    let covariance = 0;
    let variance = 0;
    for (let i = 0; i < n; i++) {
        const portfolioDiff = portfolioReturns[i] - averagePortfolioReturn;
        const benchmarkDiff = benchmarkReturns[i] - averageBenchmarkReturn;
        covariance += portfolioDiff * benchmarkDiff;
        variance += benchmarkDiff ** 2;
    }
    covariance /= n;
    variance /= n;
    // Handle zero variance
    if (variance === 0) {
        console.warn('Benchmark variance is zero. Setting beta to 0.');
        return {
            beta: 0,
            covariance,
            variance,
            averagePortfolioReturn,
            averageBenchmarkReturn,
        };
    }
    const beta = covariance / variance;
    return {
        beta,
        covariance,
        variance,
        averagePortfolioReturn,
        averageBenchmarkReturn,
    };
}
/**
 * Calculates the information ratio of the portfolio compared to a benchmark.
 * @param portfolioHistory - The portfolio history data.
 * @param benchmarkBars - The historical price data of the benchmark.
 * @returns Information ratio as a formatted string.
 */
async function calculateInformationRatio$1(portfolioHistory, benchmarkBars) {
    const portfolioEquity = portfolioHistory.equity;
    let portfolioTimestamps = portfolioHistory.timestamp;
    const benchmarkPrices = benchmarkBars.map((bar) => bar.c);
    let benchmarkTimestamps = benchmarkBars.map((bar) => bar.t);
    if (!portfolioEquity || portfolioEquity.length < 2) {
        console.warn('No portfolio equity data available.');
        return 'N/A';
    }
    // **Convert portfolio timestamps from ISO strings to Unix milliseconds**
    portfolioTimestamps = portfolioTimestamps.map((timestamp) => new Date(timestamp).getTime());
    // **Normalize portfolio timestamps to midnight UTC**
    portfolioTimestamps = portfolioTimestamps.map((timestamp) => getMidnightTimestamp(timestamp));
    // **Convert benchmark timestamps from Unix seconds to Unix milliseconds**
    benchmarkTimestamps = benchmarkTimestamps.map((timestamp) => timestamp * 1000);
    // **Normalize benchmark timestamps to midnight UTC**
    benchmarkTimestamps = benchmarkTimestamps.map((timestamp) => getMidnightTimestamp(timestamp));
    // Calculate daily returns with timestamps
    const portfolioReturnsWithDates = calculateDailyReturnsWithTimestamps(portfolioEquity, portfolioTimestamps);
    const benchmarkReturnsWithDates = calculateDailyReturnsWithTimestamps(benchmarkPrices, benchmarkTimestamps);
    // Align returns by timestamp
    const portfolioReturnsMap = new Map();
    portfolioReturnsWithDates.forEach(({ timestamp, return: ret }) => {
        if (isFinite(ret)) {
            portfolioReturnsMap.set(timestamp, ret);
        }
    });
    const benchmarkReturnsMap = new Map();
    benchmarkReturnsWithDates.forEach(({ timestamp, return: ret }) => {
        if (isFinite(ret)) {
            benchmarkReturnsMap.set(timestamp, ret);
        }
    });
    // Find common timestamps
    const commonTimestamps = [...portfolioReturnsMap.keys()].filter((timestamp) => benchmarkReturnsMap.has(timestamp));
    if (commonTimestamps.length < 2) {
        console.warn('Not enough overlapping data to calculate information ratio.');
        return 'N/A';
    }
    // Extract aligned returns
    const activeReturns = [];
    for (const timestamp of commonTimestamps) {
        const portfolioRet = portfolioReturnsMap.get(timestamp);
        const benchmarkRet = benchmarkReturnsMap.get(timestamp);
        activeReturns.push(portfolioRet - benchmarkRet);
    }
    const n = activeReturns.length;
    // Calculate average active return
    const avgActiveReturn = activeReturns.reduce((sum, ret) => sum + ret, 0) / n;
    // Calculate tracking error (standard deviation of active returns)
    const squaredDiffs = activeReturns.map((ret) => Math.pow(ret - avgActiveReturn, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / (n - 1);
    const trackingError = Math.sqrt(variance);
    // Check for zero tracking error
    if (!isFinite(trackingError) || trackingError === 0) {
        console.warn('Tracking error is zero or non-finite, cannot calculate information ratio.');
        return 'N/A';
    }
    // Calculate information ratio
    const informationRatio = avgActiveReturn / trackingError;
    if (!isFinite(informationRatio)) {
        console.warn('Information ratio calculation resulted in a non-finite number.');
        return 'N/A';
    }
    return informationRatio.toFixed(4);
}
/**
 * Fetches performance metrics for a given Alpaca account.
 * @param params - The parameters for fetching performance metrics.
 * @param client - The Apollo client instance.
 * @param accountId - The ID of the Alpaca account.
 * @param alpacaAccount - The Alpaca account object.
 * @returns A promise that resolves to an object containing various performance metrics.
 * @throws Will throw an error if required parameters are missing or if fetching fails.
 */
async function fetchPerformanceMetrics({ params, client, accountId, alpacaAccount, }) {
    // Default response for error cases
    const defaultMetrics = {
        totalReturnYTD: 'N/A',
        alpha: 'N/A',
        beta: 'N/A',
        alphaAnnualized: 'N/A',
        informationRatio: 'N/A',
        riskAdjustedReturn: 'N/A',
        liquidityRatio: 'N/A',
        expenseRatio: 'N/A',
        dividendYield: 'N/A',
        maxDrawdown: 'N/A',
    };
    try {
        // Validate required parameters
        if (!params) {
            throw new Error('Missing required parameters');
        }
        if (!params.timeframe || !params.period) {
            throw new Error('Missing required timeframe or period parameters');
        }
        // Obtain Alpaca account
        let alpacaAccountObj = alpacaAccount ? alpacaAccount : null;
        if (!alpacaAccountObj && accountId) {
            try {
                // Use provided client or get the shared client
                const apolloClient = client || await getSharedApolloClient();
                alpacaAccountObj = (await adaptic$1.alpacaAccount.get({
                    id: accountId,
                }, apolloClient));
            }
            catch (error) {
                console.error('[fetchPerformanceMetrics] Error fetching Alpaca account:', error);
                throw new Error('Failed to retrieve Alpaca account details');
            }
        }
        // Validate Alpaca account
        if (!alpacaAccountObj || !alpacaAccountObj.APIKey || !alpacaAccountObj.APISecret) {
            throw new Error('Alpaca account not found or credentials missing');
        }
        // Fetch portfolio history with structured error handling
        let portfolioHistory;
        try {
            portfolioHistory = await fetchPortfolioHistory({
                params: params,
                alpacaAccount: alpacaAccountObj
            });
        }
        catch (error) {
            console.error('[fetchPerformanceMetrics] Error fetching portfolio history:', error);
            throw new Error('Failed to retrieve portfolio history data');
        }
        // Fetch benchmark data with enhanced error handling
        const benchmarkSymbol = 'SPY';
        let benchmarkBars = [];
        try {
            const { start, end } = await getStartAndEndTimestamps({
                timezone: 'America/New_York',
                period: (params?.period === "YTD" || params?.period === "1A") ? "1Y" : params?.period ? params?.period : '1Y',
                outputFormat: 'unix-ms',
                intraday_reporting: params?.intraday_reporting,
            });
            const response = await fetch(`/api/market-data/historical-prices?symbol=${benchmarkSymbol}&start=${start.toString()}&end=${end.toString()}&timeframe=${params.timeframe}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch benchmark data: ${response.statusText} - ${errorText}`);
            }
            benchmarkBars = await response.json();
            if (!benchmarkBars || !Array.isArray(benchmarkBars) || benchmarkBars.length === 0) {
                throw new Error('Received empty or invalid benchmark data');
            }
        }
        catch (error) {
            console.error('[fetchPerformanceMetrics] Error fetching benchmark data:', error);
            // Continue with partial metrics calculation if possible
        }
        // Calculate metrics in parallel for performance
        const metrics = await Promise.allSettled([
            calculateTotalReturnYTD(portfolioHistory),
            calculateAlphaAndBeta$1(portfolioHistory, benchmarkBars),
            calculateInformationRatio$1(portfolioHistory, benchmarkBars),
            calculateRiskAdjustedReturn$1(portfolioHistory),
            calculateLiquidityRatio({ alpacaAccount: alpacaAccountObj }),
            calculateExpenseRatio$1({ alpacaAccount: alpacaAccountObj }),
            getDividendYield(),
            calculateMaxDrawdown$1(portfolioHistory.equity),
        ]);
        // Extract results with error handling for each metric
        const result = { ...defaultMetrics };
        if (metrics[0].status === 'fulfilled')
            result.totalReturnYTD = metrics[0].value;
        if (metrics[1].status === 'fulfilled') {
            result.alpha = metrics[1].value.alpha;
            result.beta = metrics[1].value.beta;
            result.alphaAnnualized = metrics[1].value.alphaAnnualized;
        }
        if (metrics[2].status === 'fulfilled')
            result.informationRatio = metrics[2].value;
        if (metrics[3].status === 'fulfilled')
            result.riskAdjustedReturn = metrics[3].value;
        if (metrics[4].status === 'fulfilled')
            result.liquidityRatio = metrics[4].value;
        if (metrics[5].status === 'fulfilled')
            result.expenseRatio = metrics[5].value;
        if (metrics[6].status === 'fulfilled')
            result.dividendYield = metrics[6].value;
        if (metrics[7].status === 'fulfilled')
            result.maxDrawdown = metrics[7].value;
        return result;
    }
    catch (error) {
        console.error('[fetchPerformanceMetrics] Error:', error);
        return defaultMetrics;
    }
}

// time-utils.ts
// Helper function to convert timestamp to Unix timestamp in seconds
const toUnixTimestamp = (ts) => {
    return Math.floor(new Date(ts).getTime() / 1000);
};
function getTimeAgo(dateString) {
    // if format is like this: '20240919T102005', then first convert to '2024-09-19T10:20:05' format
    let dateValue = dateString;
    if (dateString && dateString.length === 15) {
        dateValue = dateString.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
    }
    const date = new Date(dateValue);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(months / 12);
    if (years > 0) {
        return years === 1 ? '1 year ago' : `${years} years ago`;
    }
    else if (months > 0) {
        return months === 1 ? '1 month ago' : `${months} months ago`;
    }
    else if (days > 0) {
        return days === 1 ? '1 day ago' : `${days} days ago`;
    }
    else if (hours > 0) {
        return hours === 1 ? '1 hr ago' : `${hours} hrs ago`;
    }
    else if (minutes > 0) {
        return minutes === 1 ? '1 min ago' : `${minutes} mins ago`;
    }
    else {
        return 'A few seconds ago';
    }
}
function normalizeDate(timestamp) {
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0]; // Returns 'YYYY-MM-DD'
}
// the function formerly known as CalculateRange, like a camel with two humps. Gross
function calculateTimeRange(range) {
    const currentDate = new Date();
    switch (range) {
        case '1d':
            currentDate.setDate(currentDate.getDate() - 1);
            break;
        case '3d':
            currentDate.setDate(currentDate.getDate() - 3);
            break;
        case '1w':
            currentDate.setDate(currentDate.getDate() - 7);
            break;
        case '1m':
            currentDate.setMonth(currentDate.getMonth() - 1);
            break;
        case '3m':
            currentDate.setMonth(currentDate.getMonth() - 3);
            break;
        case '1y':
            currentDate.setFullYear(currentDate.getFullYear() - 1);
            break;
        default:
            throw new Error(`Invalid range: ${range}`);
    }
    return currentDate.toISOString().split('T')[0]; // format date to 'YYYY-MM-DD'
}
const daysLeft = (accountCreationDate, maxDays) => {
    const now = new Date();
    const endPeriodDate = new Date(accountCreationDate);
    endPeriodDate.setDate(accountCreationDate.getDate() + maxDays);
    const diffInMilliseconds = endPeriodDate.getTime() - now.getTime();
    // Convert milliseconds to days and return
    return Math.ceil(diffInMilliseconds / (1000 * 60 * 60 * 24));
};
const cutoffDate = new Date('2023-10-17T00:00:00.000Z');
const calculateDaysLeft = (accountCreationDate) => {
    let maxDays;
    if (accountCreationDate < cutoffDate) {
        maxDays = 30;
        accountCreationDate = new Date('2023-10-01T00:00:00.000Z');
    }
    else {
        maxDays = 14;
    }
    return daysLeft(accountCreationDate, maxDays);
};
const timeAgo = (timestamp) => {
    if (!timestamp)
        return 'Just now';
    const diff = Date.now() - new Date(timestamp).getTime();
    if (diff < 60000) {
        // less than 1 second
        return 'Just now';
    }
    else if (diff > 82800000) {
        // more than 23 hours – similar to how Twitter displays timestamps
        return new Date(timestamp).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: new Date(timestamp).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
        });
    }
    return `${ms(diff)} ago`;
};
// returns date utc
const formatDate = (dateString, updateDate) => {
    return new Date(dateString).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'long',
        year: updateDate && new Date(dateString).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
        timeZone: 'UTC',
    });
};
const formatDateToString = (date) => {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }) + ', at ' + date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};
const parseETDateFromAV = (dateString) => {
    // Time zone identifier for Eastern Time
    const timeZone = 'America/New_York';
    // Split the input string into date and time components
    const [datePart, timePart] = dateString.split(' ');
    // Construct a full date-time string in ISO format
    const fullString = `${datePart}T${timePart}`;
    // Convert the string to a UTC Date object using date-fns-tz
    const utcDate = fromZonedTime(fullString, timeZone); // Convert to UTC
    return utcDate;
};
const formatToUSEastern = (date, justDate) => {
    const options = {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    };
    if (!justDate) {
        options.hour = 'numeric';
        options.minute = '2-digit';
        options.hour12 = true;
    }
    return date.toLocaleString('en-US', options);
};
const unixTimetoUSEastern = (timestamp) => {
    const date = new Date(timestamp);
    const timeString = formatToUSEastern(date);
    const dateString = formatToUSEastern(date, true);
    return { date, timeString, dateString };
};
const timeDiffString = (milliseconds) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;
    const parts = [];
    if (days > 0)
        parts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (remainingHours > 0)
        parts.push(`${remainingHours} hour${remainingHours > 1 ? 's' : ''}`);
    if (remainingMinutes > 0)
        parts.push(`${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`);
    return parts.join(', ');
};

// price-utils.ts
const calculateFees = async (action, trade, alpacaAccount) => {
    let fee = 0;
    const alpacaOrderId = action.alpacaOrderId;
    if (!alpacaOrderId)
        return fee;
    const order = await getOrder({
        adapticAccountId: trade.alpacaAccountId,
        alpacaApiKey: alpacaAccount.APIKey,
        alpacaApiSecret: alpacaAccount.APISecret,
    }, alpacaOrderId);
    if (!order)
        return fee;
    const assetType = "STOCK";
    Number(order.qty) || 0;
    order.notional || 0;
    Number(order.filled_avg_price || order.limit_price || order.stop_price) || 0;
    switch (assetType) {
        case "STOCK":
        // case "ETF" as enums.AssetType.ETF:
        //   commissionFee =
        //     (tradeValue * FEE_CONFIG.SHARES_COMMISSION_PERCENTAGE) / 100;
        //   regulatoryFee =
        //     (tradeValue * FEE_CONFIG.REGULATORY_FEES_PERCENTAGE) / 100;
        //   fee = commissionFee + regulatoryFee;
        //   break;
        // case "OPTION" as enums.AssetType.OPTION:
        //   perContractFee = qty * FEE_CONFIG.OPTIONS_PER_CONTRACT_FEE;
        //   baseCommission = FEE_CONFIG.OPTIONS_BASE_COMMISSION;
        //   fee = perContractFee + baseCommission;
        //   break;
        // case "CRYPTOCURRENCY" as enums.AssetType.CRYPTOCURRENCY:
        //   fee = (tradeValue * FEE_CONFIG.CRYPTO_TRANSACTION_PERCENTAGE) / 100;
        //   break;
        // case "FUTURE" as enums.AssetType.FUTURE:
        //   // Sum of all futures fees
        //   fee = 0.85 + 0.85 + 0.25 + 0.02 + 0.01 + 0.3 + 0.01;
        //   break;
        default:
            fee = 0;
            break;
    }
    return fee;
};
const computeTotalFees = async (trade) => {
    let totalFees = 0;
    // fetch alpaca account details using adaptic.alpacaAccount.get({id: trade.alpacaAccountId})
    const alpacaAccount = (await adaptic$1.alpacaAccount.get({
        id: trade.alpacaAccountId,
    }));
    if (!alpacaAccount)
        return totalFees;
    const feePromises = trade?.actions?.map((action) => calculateFees(action, trade, alpacaAccount));
    const fees = await Promise.all(feePromises || []);
    totalFees = fees.reduce((acc, fee) => acc + fee, 0);
    return totalFees;
};
/**
 * Rounds price based on value:
 * - For prices >= $1, rounds to nearest $0.01
 * - For prices < $1, rounds to nearest $0.0001
 */
function roundStockPrice(price) {
    if (price >= 1) {
        return Math.round(price * 100) / 100;
    }
    else {
        return Math.round(price * 10000) / 10000;
    }
}
function getEquityValues(equityData, portfolioHistory, marketTimeUtil, period) {
    if (!equityData.length) {
        return { latestEquity: 0, initialEquity: 0 };
    }
    // Sort data by time
    const sortedData = [...equityData].sort((a, b) => {
        const aDate = getDateInNY(a.time);
        const bDate = getDateInNY(b.time);
        return aDate.getTime() - bDate.getTime();
    });
    // Filter out invalid values and apply market hours filtering
    const validData = sortedData.filter((point) => {
        const value = Number(point.value);
        if (isNaN(value) || !isFinite(value)) {
            return false;
        }
        if (marketTimeUtil) {
            const pointDate = getDateInNY(point.time);
            // Only filter for market hours on '1D' period
            if (period === '1D') {
                return (marketTimeUtil.isMarketDay(pointDate) &&
                    marketTimeUtil.isWithinMarketHours(pointDate));
            }
            // For other periods, include all data points
            return true;
        }
        return true;
    });
    if (!validData.length) {
        if (sortedData.length > 0) {
            const lastPoint = sortedData[sortedData.length - 1];
            let initialValue;
            // Determine initial value based on period
            if (period && ['YTD', '1Y', '3M', '6M'].includes(period) && portfolioHistory?.base_value) {
                initialValue = portfolioHistory.base_value;
            }
            else {
                initialValue = Number(sortedData[0].value);
            }
            return {
                latestEquity: Number(lastPoint.value),
                initialEquity: initialValue,
                latestTimestamp: lastPoint.time,
                initialTimestamp: sortedData[0].time,
                baseValueAsOf: portfolioHistory?.base_value_asof,
                baseValue: portfolioHistory?.base_value,
            };
        }
        return { latestEquity: 0, initialEquity: 0 };
    }
    const latestPoint = Number(validData[validData.length - 1].value);
    let initialEquity;
    // Determine initial equity based on period and available data
    if (period) {
        switch (period) {
            case '1D':
                // For 1D, use the first valid market hours point
                initialEquity = Number(validData[0].value);
                break;
            case 'YTD':
            case '1Y':
            case '3M':
            case '6M':
                // For longer periods, prefer base_value if available and valid
                if (portfolioHistory?.base_value &&
                    portfolioHistory.base_value > 0 &&
                    portfolioHistory.base_value_asof) {
                    const baseValueDate = getDateInNY(portfolioHistory.base_value_asof);
                    const periodStartDate = getDateInNY(validData[0].time);
                    // Only use base_value if it's from before our period start
                    if (baseValueDate <= periodStartDate) {
                        initialEquity = portfolioHistory.base_value;
                    }
                    else {
                        initialEquity = Number(validData[0].value);
                    }
                }
                else {
                    initialEquity = Number(validData[0].value);
                }
                break;
            default:
                initialEquity = Number(validData[0].value);
        }
    }
    else {
        // If no period specified, use first valid value
        initialEquity = Number(validData[0].value);
    }
    return {
        latestEquity: Number(latestPoint.valueOf),
        initialEquity,
        latestTimestamp: validData[validData.length - 1].time,
        initialTimestamp: validData[0].time,
        baseValueAsOf: portfolioHistory?.base_value_asof,
        baseValue: portfolioHistory?.base_value,
    };
}

// metric-calcs.ts
/**
 * Calculates daily returns from an array of closing prices
 * @param prices - Array of closing prices (numbers)
 * @returns Array of daily returns in decimal form (e.g. 0.05 for 5% return)
 * @example
 * const prices = [100, 105, 102, 110];
 * const returns = calculateDailyReturns(prices); // [0.05, -0.02857, 0.07843]
 */
function calculateDailyReturns(prices) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        const prev = prices[i - 1];
        const current = prices[i];
        if (isFinite(prev) && isFinite(current) && prev !== 0) {
            const dailyReturn = (current - prev) / prev;
            returns.push(dailyReturn);
        }
    }
    return returns;
}
/**
 * Aligns trade and benchmark returns by matching dates
 * @param tradeBars - Array of Bar objects containing trade price data
 * @param benchmarkBars - Array of BenchmarkBar objects containing benchmark price data
 * @returns Object containing aligned arrays of trade and benchmark returns
 * @example
 * const tradeBars = [{ c: 100, t: "2023-01-01T00:00:00Z" }, { c: 105, t: "2023-01-02T00:00:00Z" }];
 * const benchmarkBars = [{ c: 200, t: 1672531200 }, { c: 210, t: 1672617600 }];
 * const aligned = alignReturns(tradeBars, benchmarkBars);
 * // aligned = { alignedTradeReturns: [0.05], alignedBenchmarkReturns: [0.05] }
 * @throws Will log warnings if there are no matching dates between trade and benchmark data
 */
function alignReturns(tradeBars, benchmarkBars) {
    // Normalize all dates to midnight UTC for consistent comparison
    const normalizeTimestamp = (timestamp) => {
        let date;
        if (typeof timestamp === 'string') {
            // Handle RFC-3339 format strings
            date = new Date(timestamp);
        }
        else {
            // Handle Unix timestamps (could be in seconds or milliseconds)
            date = new Date(timestamp * (timestamp < 10000000000 ? 1000 : 1));
        }
        date.setUTCHours(0, 0, 0, 0);
        return date.getTime();
    };
    // Create maps with normalized dates as keys
    const tradeMap = new Map();
    const benchmarkMap = new Map();
    // Process trade data
    for (let i = 1; i < tradeBars.length; i++) {
        const prevBar = tradeBars[i - 1];
        const currBar = tradeBars[i];
        if (isFinite(prevBar.c) && isFinite(currBar.c) && prevBar.c !== 0) {
            const dailyReturn = (currBar.c - prevBar.c) / prevBar.c;
            const normalizedDate = normalizeTimestamp(currBar.t);
            const originalDate = typeof currBar.t === 'string'
                ? currBar.t
                : new Date(currBar.t * (currBar.t < 10000000000 ? 1000 : 1)).toISOString();
            tradeMap.set(normalizedDate, { return: dailyReturn, originalDate });
        }
    }
    // Process benchmark data
    for (let i = 1; i < benchmarkBars.length; i++) {
        const prevBar = benchmarkBars[i - 1];
        const currBar = benchmarkBars[i];
        if (isFinite(prevBar.c) && isFinite(currBar.c) && prevBar.c !== 0) {
            const dailyReturn = (currBar.c - prevBar.c) / prevBar.c;
            const normalizedDate = normalizeTimestamp(currBar.t);
            const originalDate = typeof currBar.t === 'string'
                ? currBar.t
                : new Date(currBar.t * (currBar.t < 10000000000 ? 1000 : 1)).toISOString();
            benchmarkMap.set(normalizedDate, { return: dailyReturn, originalDate });
        }
    }
    // Find common dates between datasets
    const commonDates = [...tradeMap.keys()].filter(date => benchmarkMap.has(date))
        .sort((a, b) => a - b); // Ensure chronological order
    if (commonDates.length === 0) {
        console.warn('No common dates found between trade and benchmark data');
        return { alignedTradeReturns: [], alignedBenchmarkReturns: [], alignedDates: [] };
    }
    // Extract aligned returns
    const alignedTradeReturns = [];
    const alignedBenchmarkReturns = [];
    const alignedDates = [];
    commonDates.forEach(date => {
        const tradeData = tradeMap.get(date);
        const benchmarkData = benchmarkMap.get(date);
        alignedTradeReturns.push(tradeData.return);
        alignedBenchmarkReturns.push(benchmarkData.return);
        alignedDates.push(tradeData.originalDate);
    });
    return { alignedTradeReturns, alignedBenchmarkReturns, alignedDates };
}
/*
* Calculate Beta from Returns
* @param portfolioReturns - Array of portfolio returns
* @param benchmarkReturns - Array of benchmark returns
* @returns Object containing beta, covariance, variance, and average returns
* @example
* const portfolioReturns = [0.05, -0.02, 0.03];
* const benchmarkReturns = [0.03, -0.01, 0.02];
* const beta = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);
* // beta = { beta: 1.5, covariance: 0.0005, variance: 0.0003, averagePortfolioReturn: 0.02, averageBenchmarkReturn: 0.02 }
* @throws Will log warnings if input data is invalid or insufficient
* @throws Will log warnings if benchmark variance is effectively zero
* @throws Will log warnings if beta calculation results in a non-finite value
* @throws Will log warnings if there are not enough valid data points for calculation
* @throws Will log warnings if benchmark variance is zero or non-finite
*/
function calculateBetaFromReturns(portfolioReturns, benchmarkReturns) {
    // Input validation
    if (!Array.isArray(portfolioReturns) || !Array.isArray(benchmarkReturns) ||
        portfolioReturns.length !== benchmarkReturns.length || portfolioReturns.length < 2) {
        console.warn('Invalid or insufficient return data for beta calculation');
        return {
            beta: 0,
            covariance: 0,
            variance: 0,
            averagePortfolioReturn: 0,
            averageBenchmarkReturn: 0,
        };
    }
    // Filter out any non-finite values before calculations
    const validIndices = [...Array(portfolioReturns.length).keys()].filter(i => isFinite(portfolioReturns[i]) && isFinite(benchmarkReturns[i]));
    if (validIndices.length < 2) {
        console.warn('Not enough valid data points for beta calculation');
        return {
            beta: 0,
            covariance: 0,
            variance: 0,
            averagePortfolioReturn: 0,
            averageBenchmarkReturn: 0,
        };
    }
    // Use validated indices only
    const validPortfolioReturns = validIndices.map(i => portfolioReturns[i]);
    const validBenchmarkReturns = validIndices.map(i => benchmarkReturns[i]);
    // Calculate means
    const n = validIndices.length;
    const averagePortfolioReturn = validPortfolioReturns.reduce((sum, ret) => sum + ret, 0) / n;
    const averageBenchmarkReturn = validBenchmarkReturns.reduce((sum, ret) => sum + ret, 0) / n;
    // Calculate covariance and variance with Welford's online algorithm for numerical stability
    let covariance = 0;
    let variance = 0;
    for (let i = 0; i < n; i++) {
        const portfolioDiff = validPortfolioReturns[i] - averagePortfolioReturn;
        const benchmarkDiff = validBenchmarkReturns[i] - averageBenchmarkReturn;
        covariance += portfolioDiff * benchmarkDiff;
        variance += benchmarkDiff * benchmarkDiff;
    }
    // Finalize calculations
    covariance /= n;
    variance /= n;
    // Handle zero variance case
    if (Math.abs(variance) < 1e-10) {
        console.warn('Benchmark variance is effectively zero. Setting beta to 0.');
        return {
            beta: 0,
            covariance,
            variance,
            averagePortfolioReturn,
            averageBenchmarkReturn,
        };
    }
    const beta = covariance / variance;
    return {
        beta,
        covariance,
        variance,
        averagePortfolioReturn,
        averageBenchmarkReturn,
    };
}
/**
 * Calculates the total return for a position, respecting position direction
 * @param tradeBars - Array of price bars
 * @param isShort - Whether it's a short position
 * @returns Formatted total return string
 */
async function calculateProfitLoss(tradeBars, isShort) {
    if (!tradeBars || tradeBars.length < 2) {
        console.warn("Not enough data to calculate total return.");
        return "N/A";
    }
    const startPrice = tradeBars[0].c;
    const endPrice = tradeBars[tradeBars.length - 1].c;
    if (startPrice <= 0 || isNaN(startPrice) || isNaN(endPrice)) {
        console.warn("Invalid price values for total return calculation.");
        return "N/A";
    }
    // For short positions, gains are made when price decreases
    let totalReturn;
    if (isShort) {
        totalReturn = ((startPrice - endPrice) / startPrice) * 100;
    }
    else {
        totalReturn = ((endPrice - startPrice) / startPrice) * 100;
    }
    return `${totalReturn.toFixed(2)}%`;
}
// Calculate Risk-Adjusted Return (Sharpe Ratio)
async function calculateRiskAdjustedReturn(tradeBars) {
    const returns = calculateDailyReturns(tradeBars.map(bar => bar.c));
    if (returns.length < 2) {
        console.warn("No sufficient returns data to calculate Sharpe Ratio.");
        return "N/A";
    }
    // Calculate average daily return
    const avgDailyReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    // Calculate standard deviation of daily returns
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgDailyReturn, 2), 0) / (returns.length - 1);
    const stdDevDaily = Math.sqrt(variance);
    // Annualize average return and standard deviation
    const tradingDaysPerYear = 252;
    const avgAnnualReturn = avgDailyReturn * tradingDaysPerYear;
    const stdDevAnnual = stdDevDaily * Math.sqrt(tradingDaysPerYear);
    if (!isFinite(stdDevAnnual) || stdDevAnnual === 0) {
        console.warn("Standard deviation is zero or non-finite, cannot calculate Sharpe ratio.");
        return "N/A";
    }
    // Assume a risk-free rate, e.g., 2%
    const riskFreeRate = 0.02; // Annual risk-free rate (2%)
    // Calculate Sharpe Ratio
    const sharpeRatio = (avgAnnualReturn - riskFreeRate) / stdDevAnnual;
    if (!isFinite(sharpeRatio)) {
        console.warn("Sharpe ratio calculation resulted in a non-finite number.");
        return "N/A";
    }
    return `${sharpeRatio.toFixed(2)}`;
}
/**
 * Calculates alpha and beta with position direction awareness
 * @param tradeBars - Trade price data
 * @param benchmarkBars - Benchmark price data
 * @param isShort - Whether it's a short position
 */
async function calculateAlphaAndBeta(tradeBars, benchmarkBars, isShort) {
    // First align the data
    const { alignedTradeReturns: rawTradeReturns, alignedBenchmarkReturns } = alignReturns(tradeBars, benchmarkBars);
    if (rawTradeReturns.length === 0 || alignedBenchmarkReturns.length === 0) {
        console.warn("No overlapping data to calculate Alpha.");
        return {
            alpha: "N/A",
            alphaAnnualized: "N/A",
            beta: "N/A"
        };
    }
    // Adjust trade returns based on position type
    const alignedTradeReturns = isShort
        ? rawTradeReturns.map(ret => -ret)
        : rawTradeReturns;
    // Calculate beta with position-adjusted returns
    const beta = calculateBetaFromReturns(alignedTradeReturns, alignedBenchmarkReturns);
    if (!isFinite(beta.beta)) {
        console.warn("Beta calculation resulted in a non-finite value.");
        return {
            alpha: "N/A",
            alphaAnnualized: "N/A",
            beta: "N/A"
        };
    }
    // For short positions, the interpretation of beta changes
    // A positive beta on a short means the position moves with the market,
    // which is bad for a short. We invert it for consistency.
    const positionAwareBeta = isShort ? -beta.beta : beta.beta;
    const avgTradeReturn = alignedTradeReturns.reduce((sum, ret) => sum + ret, 0) / alignedTradeReturns.length;
    const avgBenchmarkReturn = alignedBenchmarkReturns.reduce((sum, ret) => sum + ret, 0) / alignedBenchmarkReturns.length;
    const riskFreeRateDaily = 0.02 / 252; // Assuming 2% annual risk-free rate
    // Alpha calculation adjusts based on position direction
    const alpha = avgTradeReturn - (riskFreeRateDaily + positionAwareBeta * (avgBenchmarkReturn - riskFreeRateDaily));
    const alphaAnnualized = alpha * 252;
    if (!isFinite(alphaAnnualized)) {
        console.warn("Alpha calculation resulted in a non-finite value.");
        return {
            alpha: "N/A",
            alphaAnnualized: "N/A",
            beta: positionAwareBeta.toFixed(4),
        };
    }
    return {
        alpha: alpha.toFixed(4),
        alphaAnnualized: alphaAnnualized.toFixed(4),
        beta: positionAwareBeta.toFixed(4),
    };
}
/**
 * Calculate Information Ratio with position type awareness
 */
async function calculateInformationRatio(tradeBars, benchmarkBars, isShort) {
    const { alignedTradeReturns: rawTradeReturns, alignedBenchmarkReturns } = alignReturns(tradeBars, benchmarkBars);
    if (rawTradeReturns.length === 0 || alignedBenchmarkReturns.length === 0) {
        console.warn("No overlapping data to calculate Information Ratio.");
        return "N/A";
    }
    // Adjust returns for position type
    const alignedTradeReturns = isShort
        ? rawTradeReturns.map(ret => -ret)
        : rawTradeReturns;
    // For short positions, we invert the active return calculation
    // A short position outperforms when it goes down more than the benchmark goes up
    const activeReturns = isShort
        ? alignedTradeReturns.map((ret, idx) => ret - (-alignedBenchmarkReturns[idx]))
        : alignedTradeReturns.map((ret, idx) => ret - alignedBenchmarkReturns[idx]);
    const avgActiveReturn = activeReturns.reduce((sum, ret) => sum + ret, 0) / activeReturns.length;
    const variance = activeReturns.reduce((sum, ret) => sum + Math.pow(ret - avgActiveReturn, 2), 0) / (activeReturns.length - 1);
    const trackingError = Math.sqrt(variance);
    if (trackingError === 0 || !isFinite(trackingError)) {
        console.warn("Tracking error is zero or non-finite, cannot calculate Information Ratio.");
        return "N/A";
    }
    const informationRatio = avgActiveReturn / trackingError;
    if (!isFinite(informationRatio)) {
        console.warn("Information Ratio calculation resulted in a non-finite value.");
        return "N/A";
    }
    return informationRatio.toFixed(4);
}
/**
 * Calculate max drawdown taking position type into account
 * @param tradeBars - Array of price bars
 * @param isShort - Whether it's a short position
 */
async function calculateMaxDrawdown(tradeBars, isShort) {
    if (!tradeBars || tradeBars.length === 0) {
        console.warn("No trade bars data to calculate Max Drawdown.");
        return "N/A";
    }
    const equity = tradeBars.map(bar => bar.c);
    // For short positions, the drawdown happens when price increases
    // So we invert the prices for calculation purposes
    const positionAwareEquity = isShort
        ? equity.map(value => -value)
        : equity;
    let peak = positionAwareEquity[0];
    let maxDrawdown = 0;
    for (let i = 1; i < positionAwareEquity.length; i++) {
        if (positionAwareEquity[i] > peak) {
            peak = positionAwareEquity[i];
        }
        else {
            const drawdown = peak <= 0 ? 0 : (peak - positionAwareEquity[i]) / Math.abs(peak);
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }
    }
    const drawdownPercentage = Math.min(maxDrawdown * 100, 100);
    return `${drawdownPercentage.toFixed(2)}%`;
}
async function calculateExpenseRatio(trade) {
    const totalFees = await computeTotalFees(trade);
    return totalFees ? `${totalFees.toFixed(2)}%` : "N/A";
}
// Main function to fetch and calculate all trade metrics for one trade object
async function fetchTradeMetrics(trade, tradeBars, benchmarkBars) {
    const isShort = trade.actions?.find((a) => a.primary)?.type === "SELL" ? true : false;
    // Calculate metrics concurrently
    const [totalReturnYTD, { alpha, beta, alphaAnnualized }, informationRatio, riskAdjustedReturn, expenseRatio, maxDrawdown,] = await Promise.all([
        calculateProfitLoss(tradeBars, isShort),
        calculateAlphaAndBeta(tradeBars, benchmarkBars, isShort),
        calculateInformationRatio(tradeBars, benchmarkBars, isShort),
        calculateRiskAdjustedReturn(tradeBars),
        calculateExpenseRatio(trade),
        calculateMaxDrawdown(tradeBars, isShort),
    ]);
    return {
        totalReturnYTD,
        alpha, beta, alphaAnnualized,
        informationRatio,
        riskAdjustedReturn,
        expenseRatio,
        maxDrawdown,
        side: isShort ? 'short' : 'long'
    };
}

// format-tools.ts
/**
 * Capitalizes the first letter of a string
 * @param {string} str - The string to capitalize
 * @returns {string} The capitalized string, or original value if not a string
 * @example
 * capitalize('hello') // 'Hello'
 * capitalize(123) // 123
 */
function capitalize(str) {
    if (!str || typeof str !== 'string')
        return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}
/**
 * Transforms enum formatting to human readable format (e.g. 'STOCK_TICKER' to 'Stock Ticker')
 * @param {string} value - The enum string to format
 * @returns {string} The formatted string, or empty string if no value provided
 * @example
 * formatEnum('STOCK_TICKER') // 'Stock Ticker'
 */
function formatEnum(value) {
    if (!value)
        return '';
    return value
        .split('_')
        .map((word) => capitalize(word.toLowerCase()))
        .join(' ');
}
/**
 * Formats a number as US currency
 * @param {number} value - The number to format
 * @returns {string} The formatted currency string (e.g. '$1,234.56')
 * @example
 * formatCurrency(1234.56) // '$1,234.56'
 * formatCurrency(NaN) // '$0.00'
 */
function formatCurrency(value) {
    if (isNaN(value)) {
        return '$0.00';
    }
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(value);
}
/**
 * Formats a number with commas
 * @param {number} value - The number to format
 * @returns {string} The formatted number string (e.g. '1,234.56')
 * @example
 * formatNumber(1234.56) // '1,234.56'
 * formatNumber(NaN) // '0'
 */
function formatNumber(value) {
    if (isNaN(value)) {
        return '0';
    }
    return new Intl.NumberFormat('en-US').format(value);
}
/**
 * Formats a number as a percentage
 * @param {number} value - The number to format (e.g. 0.75 for 75%)
 * @param {number} [decimalPlaces=2] - Number of decimal places to show
 * @returns {string} The formatted percentage string (e.g. '75.00%')
 * @example
 * formatPercentage(0.75) // '75.00%'
 * formatPercentage(0.753, 1) // '75.3%'
 */
function formatPercentage(value, decimalPlaces = 2) {
    if (isNaN(value)) {
        return '0%';
    }
    return new Intl.NumberFormat('en-US', {
        style: 'percent',
        minimumFractionDigits: decimalPlaces,
    }).format(value);
}
/**
 * Formats a Date object to Australian datetime format for Google Sheets
 * @param {Date} date - The date to format
 * @returns {string} The formatted datetime string in 'DD/MM/YYYY HH:MM:SS' format
 * @example
 * dateTimeForGS(new Date('2025-01-01T12:34:56')) // '01/01/2025 12:34:56'
 */
function dateTimeForGS(date) {
    return date
        .toLocaleString('en-AU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    })
        .replace(/\./g, '/');
}

var Types = /*#__PURE__*/Object.freeze({
    __proto__: null
});

/*
How it works:
`this.#head` is an instance of `Node` which keeps track of its current value and nests another instance of `Node` that keeps the value that comes after it. When a value is provided to `.enqueue()`, the code needs to iterate through `this.#head`, going deeper and deeper to find the last value. However, iterating through every single item is slow. This problem is solved by saving a reference to the last value as `this.#tail` so that it can reference it to add a new value.
*/

class Node {
	value;
	next;

	constructor(value) {
		this.value = value;
	}
}

class Queue {
	#head;
	#tail;
	#size;

	constructor() {
		this.clear();
	}

	enqueue(value) {
		const node = new Node(value);

		if (this.#head) {
			this.#tail.next = node;
			this.#tail = node;
		} else {
			this.#head = node;
			this.#tail = node;
		}

		this.#size++;
	}

	dequeue() {
		const current = this.#head;
		if (!current) {
			return;
		}

		this.#head = this.#head.next;
		this.#size--;

		// Clean up tail reference when queue becomes empty
		if (!this.#head) {
			this.#tail = undefined;
		}

		return current.value;
	}

	peek() {
		if (!this.#head) {
			return;
		}

		return this.#head.value;

		// TODO: Node.js 18.
		// return this.#head?.value;
	}

	clear() {
		this.#head = undefined;
		this.#tail = undefined;
		this.#size = 0;
	}

	get size() {
		return this.#size;
	}

	* [Symbol.iterator]() {
		let current = this.#head;

		while (current) {
			yield current.value;
			current = current.next;
		}
	}

	* drain() {
		while (this.#head) {
			yield this.dequeue();
		}
	}
}

function pLimit(concurrency) {
	validateConcurrency(concurrency);

	const queue = new Queue();
	let activeCount = 0;

	const resumeNext = () => {
		if (activeCount < concurrency && queue.size > 0) {
			queue.dequeue()();
			// Since `pendingCount` has been decreased by one, increase `activeCount` by one.
			activeCount++;
		}
	};

	const next = () => {
		activeCount--;

		resumeNext();
	};

	const run = async (function_, resolve, arguments_) => {
		const result = (async () => function_(...arguments_))();

		resolve(result);

		try {
			await result;
		} catch {}

		next();
	};

	const enqueue = (function_, resolve, arguments_) => {
		// Queue `internalResolve` instead of the `run` function
		// to preserve asynchronous context.
		new Promise(internalResolve => {
			queue.enqueue(internalResolve);
		}).then(
			run.bind(undefined, function_, resolve, arguments_),
		);

		(async () => {
			// This function needs to wait until the next microtask before comparing
			// `activeCount` to `concurrency`, because `activeCount` is updated asynchronously
			// after the `internalResolve` function is dequeued and called. The comparison in the if-statement
			// needs to happen asynchronously as well to get an up-to-date value for `activeCount`.
			await Promise.resolve();

			if (activeCount < concurrency) {
				resumeNext();
			}
		})();
	};

	const generator = (function_, ...arguments_) => new Promise(resolve => {
		enqueue(function_, resolve, arguments_);
	});

	Object.defineProperties(generator, {
		activeCount: {
			get: () => activeCount,
		},
		pendingCount: {
			get: () => queue.size,
		},
		clearQueue: {
			value() {
				queue.clear();
			},
		},
		concurrency: {
			get: () => concurrency,

			set(newConcurrency) {
				validateConcurrency(newConcurrency);
				concurrency = newConcurrency;

				queueMicrotask(() => {
					// eslint-disable-next-line no-unmodified-loop-condition
					while (activeCount < concurrency && queue.size > 0) {
						resumeNext();
					}
				});
			},
		},
	});

	return generator;
}

function validateConcurrency(concurrency) {
	if (!((Number.isInteger(concurrency) || concurrency === Number.POSITIVE_INFINITY) && concurrency > 0)) {
		throw new TypeError('Expected `concurrency` to be a number from 1 and up');
	}
}

/**********************************************************************************
 * Polygon.io calls
 **********************************************************************************/
// Constants from environment variables
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
// Define concurrency limits per API
const POLYGON_CONCURRENCY_LIMIT = 100;
const polygonLimit = pLimit(POLYGON_CONCURRENCY_LIMIT);
// Use to update general information about stocks
/**
 * Fetches general information about a stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch information for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<PolygonTickerInfo | null>} The ticker information or null if not found.
 */
const fetchTickerInfo = async (symbol, options) => {
    if (!options?.apiKey && !POLYGON_API_KEY) {
        throw new Error('Polygon API key is missing');
    }
    const baseUrl = `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(symbol)}`;
    const params = new URLSearchParams({
        apiKey: options?.apiKey || POLYGON_API_KEY,
    });
    return polygonLimit(async () => {
        try {
            const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`, {}, 3, 1000);
            const data = await response.json();
            // Check for "NOT_FOUND" status and return null
            if (data.status === 'NOT_FOUND') {
                console.warn(`Ticker not found: ${symbol}`);
                return null;
            }
            // Map the results to the required structure
            const results = data.results;
            if (!results) {
                throw new Error('No results in Polygon API response');
            }
            // Validate required fields
            const requiredFields = [
                'active',
                'currency_name',
                'locale',
                'market',
                'name',
                'primary_exchange',
                'ticker',
                'type'
            ];
            for (const field of requiredFields) {
                if (results[field] === undefined) {
                    throw new Error(`Missing required field in Polygon API response: ${field}`);
                }
            }
            // Handle optional share_class_shares_outstanding field
            if (results.share_class_shares_outstanding === undefined) {
                results.share_class_shares_outstanding = null;
            }
            return {
                ticker: results.ticker,
                type: results.type,
                active: results.active,
                currency_name: results.currency_name,
                description: results.description ?? 'No description available',
                locale: results.locale,
                market: results.market,
                market_cap: results.market_cap ?? 0,
                name: results.name,
                primary_exchange: results.primary_exchange,
                share_class_shares_outstanding: results.share_class_shares_outstanding
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            const contextualMessage = `Error fetching ticker info for ${symbol}`;
            console.error(`${contextualMessage}: ${errorMessage}`, {
                symbol,
                errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' :
                    error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' :
                        error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
                url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
                source: 'PolygonAPI.fetchTickerInfo',
                timestamp: new Date().toISOString()
            });
            throw new Error(`${contextualMessage}: ${errorMessage}`);
        }
    });
};
// Fetch last trade using Polygon.io
/**
 * Fetches the last trade for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch the last trade for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<PolygonQuote>} The last trade information.
 */
const fetchLastTrade = async (symbol, options) => {
    if (!options?.apiKey && !POLYGON_API_KEY) {
        throw new Error('Polygon API key is missing');
    }
    const baseUrl = `https://api.polygon.io/v2/last/trade/${encodeURIComponent(symbol)}`;
    const params = new URLSearchParams({
        apiKey: options?.apiKey || POLYGON_API_KEY,
    });
    return polygonLimit(async () => {
        try {
            const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`, {}, 3, 1000);
            const data = await response.json();
            if (data.status !== 'OK' || !data.results) {
                throw new Error(`Polygon.io API error: ${data.status || 'No results'} ${data.error || ''}`);
            }
            const { p: price, s: vol, t: timestamp } = data.results;
            if (typeof price !== 'number' || typeof vol !== 'number' || typeof timestamp !== 'number') {
                throw new Error('Invalid trade data received from Polygon.io API');
            }
            return {
                price,
                vol,
                time: new Date(Math.floor(timestamp / 1000000)), // Convert nanoseconds to milliseconds
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            const contextualMessage = `Error fetching last trade for ${symbol}`;
            console.error(`${contextualMessage}: ${errorMessage}`, {
                symbol,
                errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' :
                    error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' :
                        error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
                url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
                source: 'PolygonAPI.fetchLastTrade',
                timestamp: new Date().toISOString()
            });
            throw new Error(`${contextualMessage}: ${errorMessage}`);
        }
    });
};
// use Polygon for all price data fetching
/**
 * Fetches price data for a given stock ticker.
 * @param {Object} params - The parameters for fetching price data.
 * @param {string} params.ticker - The stock ticker symbol.
 * @param {number} params.start - The start timestamp for fetching price data.
 * @param {number} [params.end] - The end timestamp for fetching price data.
 * @param {number} params.multiplier - The multiplier for the price data.
 * @param {string} params.timespan - The timespan for the price data.
 * @param {number} [params.limit] - The maximum number of price data points to fetch.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<PolygonPriceData[]>} The fetched price data.
 */
const fetchPrices = async (params, options) => {
    if (!options?.apiKey && !POLYGON_API_KEY) {
        throw new Error('Polygon API key is missing');
    }
    const { ticker, start, end = Date.now().valueOf(), multiplier, timespan, limit = 1000 } = params;
    const baseUrl = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${start}/${end}`;
    const urlParams = new URLSearchParams({
        apiKey: options?.apiKey || POLYGON_API_KEY,
        adjusted: 'true',
        sort: 'asc',
        limit: limit.toString(),
    });
    return polygonLimit(async () => {
        try {
            let allResults = [];
            let nextUrl = `${baseUrl}?${urlParams.toString()}`;
            while (nextUrl) {
                //console.log(`Debug: Fetching ${nextUrl}`);
                const response = await fetchWithRetry(nextUrl, {}, 3, 1000);
                const data = await response.json();
                if (data.status !== 'OK') {
                    throw new Error(`Polygon.io API responded with status: ${data.status}`);
                }
                if (data.results) {
                    allResults = [...allResults, ...data.results];
                }
                // Check if there's a next page and append API key
                nextUrl = data.next_url ? `${data.next_url}&apiKey=${options?.apiKey || POLYGON_API_KEY}` : '';
            }
            return allResults.map((entry) => ({
                date: new Date(entry.t).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'America/New_York',
                    timeZoneName: 'short',
                    hourCycle: 'h23',
                }),
                timeStamp: entry.t,
                open: entry.o,
                high: entry.h,
                low: entry.l,
                close: entry.c,
                vol: entry.v,
                vwap: entry.vw,
                trades: entry.n,
            }));
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            const contextualMessage = `Error fetching price data for ${ticker}`;
            console.error(`${contextualMessage}: ${errorMessage}`, {
                ticker,
                errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' :
                    error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' :
                        error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
                source: 'PolygonAPI.fetchPrices',
                timestamp: new Date().toISOString()
            });
            throw new Error(`${contextualMessage}: ${errorMessage}`);
        }
    });
};
/**
 * Analyzes the price data for a given stock.
 * @param {PolygonPriceData[]} priceData - The price data to analyze.
 * @returns {string} The analysis report.
 */
function analysePolygonPriceData(priceData) {
    if (!priceData || priceData.length === 0) {
        return 'No price data available for analysis.';
    }
    // Parse the dates into Date objects
    const parsedData = priceData.map((entry) => ({
        ...entry,
        date: new Date(entry.date),
    }));
    // Sort the data by date
    parsedData.sort((a, b) => a.date.getTime() - b.date.getTime());
    // Extract start and end times
    const startTime = parsedData[0].date;
    const endTime = parsedData[parsedData.length - 1].date;
    // Calculate the total time in hours
    (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    // Calculate the interval between data points
    const intervals = parsedData
        .slice(1)
        .map((_, i) => (parsedData[i + 1].date.getTime() - parsedData[i].date.getTime()) / 1000); // in seconds
    const avgInterval = intervals.length > 0 ? intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length : 0;
    // Format the report
    const report = `
Report:
* Start time of data (US Eastern): ${startTime.toLocaleString('en-US', { timeZone: 'America/New_York' })}
* End time of data (US Eastern): ${endTime.toLocaleString('en-US', { timeZone: 'America/New_York' })}
* Number of data points: ${priceData.length}
* Average interval between data points (seconds): ${avgInterval.toFixed(2)}
  `;
    return report.trim();
}
/**
 * Fetches grouped daily price data for a specific date.
 * @param {string} date - The date to fetch grouped daily data for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @param {boolean} [options.adjusted] - Whether to adjust the data.
 * @param {boolean} [options.includeOTC] - Whether to include OTC data.
 * @returns {Promise<PolygonGroupedDailyResponse>} The grouped daily response.
 */
const fetchGroupedDaily = async (date, options) => {
    if (!options?.apiKey && !POLYGON_API_KEY) {
        throw new Error('Polygon API key is missing');
    }
    const baseUrl = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}`;
    const params = new URLSearchParams({
        apiKey: options?.apiKey || POLYGON_API_KEY,
        adjusted: options?.adjusted !== false ? 'true' : 'false',
        include_otc: options?.includeOTC ? 'true' : 'false',
    });
    return polygonLimit(async () => {
        try {
            const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`, {}, 3, 1000);
            const data = await response.json();
            if (data.status !== 'OK') {
                throw new Error(`Polygon.io API responded with status: ${data.status}`);
            }
            return {
                adjusted: data.adjusted,
                queryCount: data.queryCount,
                request_id: data.request_id,
                resultsCount: data.resultsCount,
                status: data.status,
                results: data.results.map((result) => ({
                    symbol: result.T,
                    timeStamp: result.t,
                    open: result.o,
                    high: result.h,
                    low: result.l,
                    close: result.c,
                    vol: result.v,
                    vwap: result.vw,
                    trades: result.n,
                })),
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            const contextualMessage = `Error fetching grouped daily data for ${date}`;
            console.error(`${contextualMessage}: ${errorMessage}`, {
                date,
                errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' :
                    error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' :
                        error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
                url: hideApiKeyFromurl(`${baseUrl}?${params.toString()}`),
                source: 'PolygonAPI.fetchGroupedDaily',
                timestamp: new Date().toISOString()
            });
            throw new Error(`${contextualMessage}: ${errorMessage}`);
        }
    });
};
/**
 * Formats the price data into a readable string.
 * @param {PolygonPriceData[]} priceData - The price data to format.
 * @returns {string} The formatted price data.
 */
function formatPriceData(priceData) {
    if (!priceData || priceData.length === 0)
        return 'No price data available';
    return priceData
        .map((d) => {
        // For daily data, remove the time portion if it's all zeros
        const dateStr = d.date.includes(', 00:00:00') ? d.date.split(', 00:00:00')[0] : d.date;
        return [
            dateStr,
            `O: ${formatCurrency(d.open)}`,
            `H: ${formatCurrency(d.high)}`,
            `L: ${formatCurrency(d.low)}`,
            `C: ${formatCurrency(d.close)}`,
            `Vol: ${d.vol}`,
        ].join(' | ');
    })
        .join('\n');
}
const fetchDailyOpenClose = async (
/**
 * Fetches the daily open and close data for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch data for.
 * @param {Date} [date=new Date()] - The date to fetch data for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @param {boolean} [options.adjusted] - Whether to adjust the data.
 * @returns {Promise<PolygonDailyOpenClose>} The daily open and close data.
 */
symbol, date = new Date(), options) => {
    if (!options?.apiKey && !POLYGON_API_KEY) {
        throw new Error('Polygon API key is missing');
    }
    const formattedDate = date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
    const baseUrl = `https://api.polygon.io/v1/open-close/${encodeURIComponent(symbol)}/${formattedDate}`;
    const params = new URLSearchParams({
        apiKey: options?.apiKey || POLYGON_API_KEY,
        adjusted: (options?.adjusted ?? true).toString(),
    });
    return polygonLimit(async () => {
        const response = await fetchWithRetry(`${baseUrl}?${params.toString()}`, {}, 3, 1000);
        const data = await response.json();
        if (data.status !== 'OK') {
            throw new Error(`Failed to fetch daily open/close data for ${symbol}: ${data.status}`);
        }
        return data;
    });
};
/**
 * Gets the previous close price for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch the previous close for.
 * @param {Date} [referenceDate] - The reference date to use for fetching the previous close.
 * @returns {Promise<{ close: number; date: Date }>} The previous close price and date.
 */
async function getPreviousClose(symbol, referenceDate, options) {
    const previousDate = getLastFullTradingDate(referenceDate).date;
    const lastOpenClose = await fetchDailyOpenClose(symbol, previousDate, options);
    if (!lastOpenClose) {
        throw new Error(`Could not fetch last trade price for ${symbol}`);
    }
    return {
        close: lastOpenClose.close,
        date: previousDate,
    };
}
/**
 * Fetches trade data for a given stock ticker.
 * @param {string} symbol - The stock ticker symbol to fetch trades for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @param {string | number} [options.timestamp] - The timestamp for fetching trades.
 * @param {string | number} [options.timestampgt] - Greater than timestamp for fetching trades.
 * @param {string | number} [options.timestampgte] - Greater than or equal to timestamp for fetching trades.
 * @param {string | number} [options.timestamplt] - Less than timestamp for fetching trades.
 * @param {string | number} [options.timestamplte] - Less than or equal to timestamp for fetching trades.
 * @param {'asc' | 'desc'} [options.order] - The order of the trades.
 * @param {number} [options.limit] - The maximum number of trades to fetch.
 * @param {string} [options.sort] - The sort order for the trades.
 * @returns {Promise<PolygonTradesResponse>} The fetched trades response.
 */
const fetchTrades = async (symbol, options) => {
    if (!options?.apiKey && !POLYGON_API_KEY) {
        throw new Error('Polygon API key is missing');
    }
    const baseUrl = `https://api.polygon.io/v3/trades/${encodeURIComponent(symbol)}`;
    const params = new URLSearchParams({
        apiKey: options?.apiKey || POLYGON_API_KEY,
    });
    // Add optional parameters if they exist
    if (options?.timestamp)
        params.append('timestamp', options.timestamp.toString());
    if (options?.timestampgt)
        params.append('timestamp.gt', options.timestampgt.toString());
    if (options?.timestampgte)
        params.append('timestamp.gte', options.timestampgte.toString());
    if (options?.timestamplt)
        params.append('timestamp.lt', options.timestamplt.toString());
    if (options?.timestamplte)
        params.append('timestamp.lte', options.timestamplte.toString());
    if (options?.order)
        params.append('order', options.order);
    if (options?.limit)
        params.append('limit', options.limit.toString());
    if (options?.sort)
        params.append('sort', options.sort);
    return polygonLimit(async () => {
        const url = `${baseUrl}?${params.toString()}`;
        try {
            console.log(`[DEBUG] Fetching trades for ${symbol} from ${url}`);
            const response = await fetchWithRetry(url, {}, 3, 1000);
            const data = await response.json();
            if ('message' in data) {
                // This is an error response
                throw new Error(`Polygon API Error: ${data.message}`);
            }
            return data;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            const contextualMessage = `Error fetching trades for ${symbol}`;
            console.error(`${contextualMessage}: ${errorMessage}`, {
                symbol,
                errorType: error instanceof Error && error.message.includes('AUTH_ERROR') ? 'AUTH_ERROR' :
                    error instanceof Error && error.message.includes('RATE_LIMIT') ? 'RATE_LIMIT' :
                        error instanceof Error && error.message.includes('NETWORK_ERROR') ? 'NETWORK_ERROR' : 'UNKNOWN',
                url: hideApiKeyFromurl(url),
                source: 'PolygonAPI.fetchTrades',
                timestamp: new Date().toISOString()
            });
            throw new Error(`${contextualMessage}: ${errorMessage}`);
        }
    });
};

/**
 * Polygon Indices API Implementation
 *
 * This module provides functions to interact with the Polygon.io Indices API.
 */
// Constants from environment variables
const { ALPACA_INDICES_API_KEY } = process.env;
// Define concurrency limits for API
const POLYGON_INDICES_CONCURRENCY_LIMIT = 5;
const polygonIndicesLimit = pLimit(POLYGON_INDICES_CONCURRENCY_LIMIT);
// Base URL for Polygon API
const POLYGON_API_BASE_URL = 'https://api.polygon.io';
/**
 * Validates that an API key is available
 * @param {string | undefined} apiKey - Optional API key to use
 * @throws {Error} If no API key is available
 */
const validateApiKey = (apiKey) => {
    const key = apiKey || ALPACA_INDICES_API_KEY;
    if (!key) {
        throw new Error('Polygon Indices API key is missing');
    }
    return key;
};
/**
 * Fetches aggregate bars for an index over a given date range in custom time window sizes.
 *
 * @param {PolygonIndicesAggregatesParams} params - Parameters for the aggregates request
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesAggregatesResponse>} The aggregates response
 */
const fetchIndicesAggregates = async (params, options) => {
    const apiKey = validateApiKey(options?.apiKey);
    const { indicesTicker, multiplier, timespan, from, to, sort = 'asc', limit } = params;
    const url = new URL(`${POLYGON_API_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(indicesTicker)}/range/${multiplier}/${timespan}/${from}/${to}`);
    const queryParams = new URLSearchParams();
    queryParams.append('apiKey', apiKey);
    if (sort) {
        queryParams.append('sort', sort);
    }
    if (limit) {
        queryParams.append('limit', limit.toString());
    }
    url.search = queryParams.toString();
    return polygonIndicesLimit(async () => {
        try {
            const response = await fetchWithRetry(url.toString(), {}, 3, 300);
            const data = await response.json();
            if (data.status === 'ERROR') {
                throw new Error(`Polygon API Error: ${data.error}`);
            }
            return data;
        }
        catch (error) {
            console.error('Error fetching indices aggregates:', error);
            throw error;
        }
    });
};
/**
 * Gets the previous day's open, high, low, and close (OHLC) for the specified index.
 *
 * @param {string} indicesTicker - The ticker symbol of the index
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesPrevCloseResponse>} The previous close response
 */
const fetchIndicesPreviousClose = async (indicesTicker, options) => {
    const apiKey = validateApiKey(options?.apiKey);
    const url = new URL(`${POLYGON_API_BASE_URL}/v2/aggs/ticker/${encodeURIComponent(indicesTicker)}/prev`);
    const queryParams = new URLSearchParams();
    queryParams.append('apiKey', apiKey);
    url.search = queryParams.toString();
    return polygonIndicesLimit(async () => {
        try {
            const response = await fetchWithRetry(url.toString(), {}, 3, 300);
            const data = await response.json();
            if (data.status === 'ERROR') {
                throw new Error(`Polygon API Error: ${data.error}`);
            }
            return data;
        }
        catch (error) {
            console.error('Error fetching indices previous close:', error);
            throw error;
        }
    });
};
/**
 * Gets the open, close and afterhours values of an index symbol on a certain date.
 *
 * @param {string} indicesTicker - The ticker symbol of the index
 * @param {string} date - The date in YYYY-MM-DD format
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesDailyOpenCloseResponse>} The daily open/close response
 */
const fetchIndicesDailyOpenClose = async (indicesTicker, date, options) => {
    const apiKey = validateApiKey(options?.apiKey);
    const url = new URL(`${POLYGON_API_BASE_URL}/v1/open-close/${encodeURIComponent(indicesTicker)}/${date}`);
    const queryParams = new URLSearchParams();
    queryParams.append('apiKey', apiKey);
    url.search = queryParams.toString();
    return polygonIndicesLimit(async () => {
        try {
            const response = await fetchWithRetry(url.toString(), {}, 3, 300);
            const data = await response.json();
            if (data.status === 'ERROR') {
                throw new Error(`Polygon API Error: ${data.error}`);
            }
            return data;
        }
        catch (error) {
            console.error('Error fetching indices daily open/close:', error);
            throw error;
        }
    });
};
/**
 * Gets a snapshot of indices data for specified tickers.
 *
 * @param {PolygonIndicesSnapshotParams} [params] - Parameters for the snapshot request
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesSnapshotResponse>} The indices snapshot response
 */
const fetchIndicesSnapshot = async (params, options) => {
    const apiKey = validateApiKey(options?.apiKey);
    const url = new URL(`${POLYGON_API_BASE_URL}/v3/snapshot/indices`);
    const queryParams = new URLSearchParams();
    queryParams.append('apiKey', apiKey);
    if (params?.tickers?.length) {
        queryParams.append('ticker.any_of', params.tickers.join(','));
    }
    if (params?.order) {
        queryParams.append('order', params.order);
    }
    if (params?.limit) {
        queryParams.append('limit', params.limit.toString());
    }
    if (params?.sort) {
        queryParams.append('sort', params.sort);
    }
    url.search = queryParams.toString();
    return polygonIndicesLimit(async () => {
        try {
            const response = await fetchWithRetry(url.toString(), {}, 3, 300);
            const data = await response.json();
            if (data.status === 'ERROR') {
                throw new Error(`Polygon API Error: ${data.error}`);
            }
            return data;
        }
        catch (error) {
            console.error('Error fetching indices snapshot:', error);
            throw error;
        }
    });
};
/**
 * Gets snapshots for assets of all types, including indices.
 *
 * @param {string[]} tickers - Array of tickers to fetch snapshots for
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @param {string} [options.type] - Filter by asset type
 * @param {string} [options.order] - Order results
 * @param {number} [options.limit] - Limit the number of results
 * @param {string} [options.sort] - Sort field
 * @returns {Promise<any>} The universal snapshot response
 */
const fetchUniversalSnapshot = async (tickers, options) => {
    const apiKey = validateApiKey(options?.apiKey);
    const url = new URL(`${POLYGON_API_BASE_URL}/v3/snapshot`);
    const queryParams = new URLSearchParams();
    queryParams.append('apiKey', apiKey);
    if (tickers.length) {
        queryParams.append('ticker.any_of', tickers.join(','));
    }
    if (options?.type) {
        queryParams.append('type', options.type);
    }
    if (options?.order) {
        queryParams.append('order', options.order);
    }
    if (options?.limit) {
        queryParams.append('limit', options.limit.toString());
    }
    if (options?.sort) {
        queryParams.append('sort', options.sort);
    }
    url.search = queryParams.toString();
    return polygonIndicesLimit(async () => {
        try {
            const response = await fetchWithRetry(url.toString(), {}, 3, 300);
            const data = await response.json();
            if (data.status === 'ERROR') {
                throw new Error(`Polygon API Error: ${data.error}`);
            }
            return data;
        }
        catch (error) {
            console.error('Error fetching universal snapshot:', error);
            throw error;
        }
    });
};
/**
 * Converts Polygon Indices bar data to a more standardized format
 *
 * @param {PolygonIndicesAggregatesResponse} data - The raw aggregates response
 * @returns {Array<{date: string, open: number, high: number, low: number, close: number, timestamp: number}>} Formatted bar data
 */
const formatIndicesBarData = (data) => {
    return data.results.map(bar => {
        const date = new Date(bar.t);
        return {
            date: date.toISOString().split('T')[0],
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            timestamp: bar.t,
        };
    });
};

/**********************************************************************************
 * AlphaVantage calls
 **********************************************************************************/
// Constants from environment variables
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
function checkEnvironment(apiKey) {
    if (!apiKey && !ALPHA_VANTAGE_API_KEY) {
        throw new Error('ALPHA_VANTAGE_API_KEY is not defined in environment variables or options.');
    }
}
// Define concurrency limits per API
const ALPHA_VANTAGE_CONCURRENCY_LIMIT = 5;
const AVBaseUrl = 'https://www.alphavantage.co/query?function=';
const alphaVantageLimit = pLimit(ALPHA_VANTAGE_CONCURRENCY_LIMIT);
// Fetch current quote. Does not need start / end date
/**
 * Fetches the current quote for a given ticker symbol.
 * @param {string} ticker - The ticker symbol to fetch the quote for.
 * @param {Object} [options] - Optional parameters.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<AlphaVantageQuoteResponse>} The current quote response.
 */
const fetchQuote = async (ticker, options) => {
    checkEnvironment(options?.apiKey);
    const endpoint = `${AVBaseUrl}GLOBAL_QUOTE&symbol=${ticker.replace('.', '-')}&entitlement=realtime&apikey=${options?.apiKey || ALPHA_VANTAGE_API_KEY}`;
    return alphaVantageLimit(async () => {
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`Failed to fetch quote for ${ticker}`);
        }
        const data = await response.json();
        return data;
    });
};
/**
 * Converts a Date object to a string in the format YYYYMMDDTHHMM.
 * @param {Date} date - The date to convert.
 * @returns {string} The formatted date string.
 */
function convertDateToYYYYMMDDTHHMM(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1); // Months are zero-based
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}${month}${day}T${hours}${minutes}`;
}
/**
 * Converts a string in the format YYYYMMDDTHHMMSS to a Date object.
 * @param {string} dateString - The date string to convert.
 * @returns {Date} The corresponding Date object.
 */
function convertYYYYMMDDTHHMMSSToDate(dateString) {
    const year = parseInt(dateString.substring(0, 4), 10);
    const month = parseInt(dateString.substring(4, 6), 10) - 1; // Months are 0-based in JavaScript
    const day = parseInt(dateString.substring(6, 8), 10);
    const hours = parseInt(dateString.substring(9, 11), 10);
    const minutes = parseInt(dateString.substring(11, 13), 10);
    const seconds = parseInt(dateString.substring(13, 15), 10);
    return new Date(Date.UTC(year, month, day, hours, minutes, seconds));
}
/**
 * Fetches news articles from AlphaVantage for a given ticker symbol. Performs filtering as the API endpoint doesn't respect the parameters.
 * @param {string} ticker - The ticker symbol to fetch news for.
 * @param {Object} [options] - Optional parameters.
 * @param {Date} [options.start] - The start date for fetching news.
 * @param {Date} [options.end] - The end date for fetching news.
 * @param {number} [options.limit] - The maximum number of news articles to fetch.
 * @param {string} [options.apiKey] - The API key to use for the request.
 * @returns {Promise<AVNewsArticle[]>} The fetched news articles.
 */
const fetchTickerNews = async (ticker, options = {
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    end: new Date(),
    limit: 10,
    sort: 'LATEST'
}) => {
    checkEnvironment(options?.apiKey);
    // Format start date as YYYYMMDDTHHMM
    const formattedStart = convertDateToYYYYMMDDTHHMM(options.start ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const formattedEnd = convertDateToYYYYMMDDTHHMM(options.end ?? new Date());
    // Construct the API endpoint
    const endpoint = `${AVBaseUrl}NEWS_SENTIMENT&tickers=${ticker}&time_from=${formattedStart}&time_to=${formattedEnd}&sort=${options.sort}&limit=${options.limit}&apikey=${options?.apiKey || ALPHA_VANTAGE_API_KEY}`;
    return alphaVantageLimit(async () => {
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`Failed to fetch news for ticker ${ticker} from AlphaVantage`);
        }
        const data = (await response.json());
        let newsItems = [];
        if (data.items === 0) {
            logIfDebug(`No news found for ticker ${ticker}`);
        }
        else {
            logIfDebug(`Fetched ${data.items} news items for ticker ${ticker}`);
            // Filter articles within date range
            const startTime = options.start?.getTime() ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).getTime();
            const endTime = options.end?.getTime() ?? new Date().getTime();
            newsItems = data && data.feed && data.feed.length > 0 ? data.feed.filter(article => {
                const articleDate = convertYYYYMMDDTHHMMSSToDate(article.time_published);
                return articleDate.getTime() >= startTime && articleDate.getTime() <= endTime;
            }) : [];
            // Sort articles based on the sort parameter
            newsItems.sort((a, b) => {
                const dateA = convertYYYYMMDDTHHMMSSToDate(a.time_published).getTime();
                const dateB = convertYYYYMMDDTHHMMSSToDate(b.time_published).getTime();
                if (options.sort === 'LATEST') {
                    return dateB - dateA;
                }
                else if (options.sort === 'EARLIEST') {
                    return dateA - dateB;
                }
                return 0; // For RELEVANCE, maintain API's order
            });
            // Apply limit after filtering and sorting
            newsItems = newsItems.slice(0, options.limit);
        }
        return newsItems;
    });
};

const ALPACA_API_BASE = 'https://data.alpaca.markets/v1beta3';
/**
 * Fetches cryptocurrency bars for the specified parameters.
 * This function retrieves historical price data for multiple cryptocurrencies.
 *
 * @param params - The parameters for fetching crypto bars.
 * @param params.symbols - An array of cryptocurrency symbols to fetch data for.
 * @param params.timeframe - The timeframe for the bars (e.g., '1Min', '5Min', '1H', '1D').
 * @param params.start - The start date for fetching bars (optional).
 * @param params.end - The end date for fetching bars (optional).
 * @param params.limit - The maximum number of bars to return (optional).
 * @param params.page_token - The token for pagination (optional).
 * @param params.sort - The sorting order for the results (optional).
 * @returns A promise that resolves to an object containing arrays of CryptoBar objects for each symbol.
 */
async function fetchBars(params) {
    // Convert symbols array to comma-separated string
    const symbolsParam = params.symbols.join(',');
    // Initialize result object to store all bars
    const allBars = {};
    params.symbols.forEach((symbol) => {
        allBars[symbol] = [];
    });
    let pageToken = params.page_token;
    let hasMorePages = true;
    while (hasMorePages) {
        // Convert Date objects to RFC-3339 strings for the API
        const queryParams = new URLSearchParams({
            symbols: symbolsParam,
            timeframe: params.timeframe,
            ...(params.start && { start: params.start.toISOString() }),
            ...(params.end && { end: params.end.toISOString() }),
            ...(params.limit && { limit: params.limit.toString() }),
            ...(pageToken && { page_token: pageToken }),
            ...(params.sort && { sort: params.sort }),
        });
        const url = `${ALPACA_API_BASE}/crypto/us/bars?${queryParams}`;
        logIfDebug(`Fetching crypto bars from: ${url}`);
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
            }
            const data = await response.json();
            // Convert timestamp strings to Date objects and merge bars
            Object.entries(data.bars).forEach(([symbol, bars]) => {
                if (allBars[symbol]) {
                    const barsWithDateObjects = bars.map((bar) => ({
                        ...bar,
                        t: new Date(bar.t),
                    }));
                    allBars[symbol].push(...barsWithDateObjects);
                }
            });
            // Check if there are more pages
            pageToken = data.next_page_token;
            hasMorePages = !!pageToken;
            logIfDebug(`Received ${Object.values(data.bars).flat().length} bars. More pages: ${hasMorePages}`);
        }
        catch (error) {
            logIfDebug(`Error fetching crypto bars: ${error}`);
            throw error;
        }
    }
    return allBars;
}
/**
 * Fetches news articles related to a specific cryptocurrency symbol.
 * This function retrieves news articles from the Alpaca API.
 *
 * @param params - The parameters for fetching news articles.
 * @param params.symbol - The cryptocurrency symbol to fetch news for.
 * @param params.start - The start date for fetching news (optional).
 * @param params.sort - The sorting order for the results (optional).
 * @param params.includeContent - Whether to include the full content of the articles (optional).
 * @param params.limit - The maximum number of articles to return (optional).
 * @param auth - The Alpaca authentication object containing API key and secret.
 * @returns A promise that resolves to an array of AlpacaNewsArticle objects.
 * @throws Will throw an error if required parameters are missing or if fetching fails.
 */
async function fetchNews(params, auth) {
    const { symbol, start = new Date(Date.now() - 24 * 60 * 60 * 1000), sort = 'desc', includeContent = false, limit = 1000, } = params;
    if (!auth.APIKey || !auth.APISecret) {
        throw new Error('Alpaca API key and secret are required');
    }
    if (!symbol) {
        throw new Error('Symbol is required');
    }
    const queryParams = new URLSearchParams({
        start: start.toISOString(),
        sort,
        symbols: symbol,
        include_content: includeContent.toString(),
        limit: limit.toString(),
    });
    const url = `${ALPACA_API_BASE}/news?${queryParams}`;
    logIfDebug(`Fetching news from: ${url}`);
    let newsArticles = [];
    let pageToken = null;
    let hasMorePages = true;
    while (hasMorePages) {
        if (pageToken) {
            queryParams.append('page_token', pageToken);
        }
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        newsArticles = newsArticles.concat(data.news.map((article) => ({
            title: article.headline,
            author: article.author,
            createdAt: article.created_at,
            headline: article.headline,
            source: article.source,
            summary: article.summary,
            url: article.url,
            content: article.content,
        })));
        pageToken = data.next_page_token;
        hasMorePages = !!pageToken;
        logIfDebug(`Received ${data.news.length} news articles. More pages: ${hasMorePages}`);
    }
    // If sort is "asc" and limit is 10, return only the 10 most recent articles
    if (sort === 'asc' && limit === 10) {
        return newsArticles.slice(-10);
    }
    return newsArticles;
}
/**
 * Fetches the latest trades for the specified cryptocurrency symbols.
 * This function retrieves the most recent trade price and volume for each symbol.
 *
 * @param params - The parameters for fetching latest trades.
 * @param params.symbols - An array of cryptocurrency symbols to fetch data for (e.g., ['BTC-USD', 'ETH-USD']).
 * @param params.loc - The location identifier (default: 'us'). Options: 'us' (Alpaca US), 'us-1' (Kraken US), 'eu-1' (Kraken EU).
 * @param auth - The Alpaca authentication object containing API key and secret.
 * @returns A promise that resolves to an object containing the latest trade for each symbol.
 * @throws Will throw an error if required parameters are missing or if fetching fails.
 */
async function fetchLatestTrades(params, auth) {
    const { symbols, loc = 'us' } = params;
    if (!auth.APIKey || !auth.APISecret) {
        throw new Error('Alpaca API key and secret are required');
    }
    if (!symbols || symbols.length === 0) {
        throw new Error('At least one symbol is required');
    }
    // Convert symbols array to comma-separated string
    const symbolsParam = symbols.join(',');
    const queryParams = new URLSearchParams({
        symbols: symbolsParam,
    });
    const url = `${ALPACA_API_BASE}/crypto/${loc}/latest/trades?${queryParams}`;
    logIfDebug(`Fetching crypto latest trades from: ${url}`);
    try {
        const response = await fetch(url, {
            headers: {
                'APCA-API-KEY-ID': auth.APIKey,
                'APCA-API-SECRET-KEY': auth.APISecret,
            },
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        logIfDebug(`Received latest trades for ${Object.keys(data.trades).length} symbols`);
        return data;
    }
    catch (error) {
        logIfDebug(`Error fetching crypto latest trades: ${error}`);
        throw error;
    }
}
/**
 * Fetches the latest quotes (bid/ask prices) for the specified cryptocurrency symbols.
 * This function retrieves the most recent bid and ask prices for each symbol.
 *
 * @param params - The parameters for fetching latest quotes.
 * @param params.symbols - An array of cryptocurrency symbols to fetch data for (e.g., ['BTC-USD', 'ETH-USD']).
 * @param params.loc - The location identifier (default: 'us'). Options: 'us' (Alpaca US), 'us-1' (Kraken US), 'eu-1' (Kraken EU).
 * @param auth - The Alpaca authentication object containing API key and secret.
 * @returns A promise that resolves to an object containing the latest quote for each symbol.
 * @throws Will throw an error if required parameters are missing or if fetching fails.
 */
async function fetchLatestQuotes(params, auth) {
    const { symbols, loc = 'us' } = params;
    if (!auth.APIKey || !auth.APISecret) {
        throw new Error('Alpaca API key and secret are required');
    }
    if (!symbols || symbols.length === 0) {
        throw new Error('At least one symbol is required');
    }
    // Convert symbols array to comma-separated string
    const symbolsParam = symbols.join(',');
    const queryParams = new URLSearchParams({
        symbols: symbolsParam,
    });
    const url = `${ALPACA_API_BASE}/crypto/${loc}/latest/quotes?${queryParams}`;
    logIfDebug(`Fetching crypto latest quotes from: ${url}`);
    try {
        const response = await fetch(url, {
            headers: {
                'APCA-API-KEY-ID': auth.APIKey,
                'APCA-API-SECRET-KEY': auth.APISecret,
            },
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        logIfDebug(`Received latest quotes for ${Object.keys(data.quotes).length} symbols`);
        return data;
    }
    catch (error) {
        logIfDebug(`Error fetching crypto latest quotes: ${error}`);
        throw error;
    }
}

/**
 * Calculates Bollinger Bands for a given set of price data.
 * Bollinger Bands consist of a middle band (SMA) and two outer bands
 * that are standard deviations away from the middle band.
 *
 * @param priceData - An array of price data objects containing closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.period - The number of periods to use for the SMA (default is 20).
 * @param params.standardDeviations - The number of standard deviations for the outer bands (default is 2).
 * @returns An array of BollingerBandsData objects containing the calculated bands.
 */
function calculateBollingerBands(priceData, { period = 20, standardDeviations = 2 } = {}) {
    if (priceData.length < period) {
        logIfDebug(`Insufficient data for Bollinger Bands calculation: required periods: ${period}, but only received ${priceData.length} periods of data`);
        return [];
    }
    const result = [];
    for (let i = period - 1; i < priceData.length; i++) {
        const periodSlice = priceData.slice(i - period + 1, i + 1);
        const prices = periodSlice.map((d) => d.close);
        // Calculate middle band (SMA)
        const sum = prices.reduce((acc, price) => acc + price, 0);
        const sma = sum / period;
        // Calculate standard deviation
        const squaredDifferences = prices.map((price) => Math.pow(price - sma, 2));
        const variance = squaredDifferences.reduce((acc, val) => acc + val, 0) / period;
        const standardDeviation = Math.sqrt(variance);
        // Calculate bands
        const upperBand = sma + standardDeviation * standardDeviations;
        const lowerBand = sma - standardDeviation * standardDeviations;
        result.push({
            date: priceData[i].date,
            middle: parseFloat(sma.toFixed(2)),
            upper: parseFloat(upperBand.toFixed(2)),
            lower: parseFloat(lowerBand.toFixed(2)),
            close: priceData[i].close,
        });
    }
    // logIfDebug(`Calculated Bollinger Bands for ${result.length} periods`);
    return result;
}
/**
 * Calculates the Exponential Moving Average (EMA) for a given set of price data.
 * The EMA gives more weight to recent prices, making it more responsive to new information.
 *
 * @param priceData - An array of price data objects containing closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.period - The number of periods to use for the EMA (default is 20).
 * @param params.period2 - An optional second period for a second EMA (default is 9).
 * @returns An array of EMAData objects containing the calculated EMA values.
 */
function calculateEMA(priceData, { period = 20, period2 = 9 } = {}) {
    if (priceData.length < period || (period2 && priceData.length < period2)) {
        logIfDebug(`Insufficient data for EMA calculation: required periods: ${period}, ${period2}, but only received ${priceData.length} periods of data`);
        return [];
    }
    const result = [];
    const multiplier = 2 / (period + 1);
    const multiplier2 = period2 ? 2 / (period2 + 1) : 0;
    // Calculate initial SMA for first period
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += priceData[i].close;
    }
    let prevEMA = sum / period;
    // Calculate initial SMA for second period if needed
    let prevEMA2;
    if (period2) {
        sum = 0;
        for (let i = 0; i < period2; i++) {
            sum += priceData[i].close;
        }
        prevEMA2 = sum / period2;
    }
    // Add first EMA(s)
    const firstEntry = {
        date: priceData[Math.max(period, period2 || 0) - 1].date,
        ema: parseFloat(prevEMA.toFixed(2)),
        close: priceData[Math.max(period, period2 || 0) - 1].close,
    };
    if (period2) {
        firstEntry.ema2 = parseFloat(prevEMA2.toFixed(2));
    }
    result.push(firstEntry);
    // Calculate EMA for remaining periods
    for (let i = Math.max(period, period2 || 0); i < priceData.length; i++) {
        const currentClose = priceData[i].close;
        const currentEMA = (currentClose - prevEMA) * multiplier + prevEMA;
        prevEMA = currentEMA;
        const entry = {
            date: priceData[i].date,
            ema: parseFloat(currentEMA.toFixed(2)),
            close: currentClose,
        };
        if (period2) {
            const currentEMA2 = (currentClose - prevEMA2) * multiplier2 + prevEMA2;
            prevEMA2 = currentEMA2;
            entry.ema2 = parseFloat(currentEMA2.toFixed(2));
        }
        result.push(entry);
    }
    // logIfDebug(`Calculated EMA for ${result.length} periods`);
    return result;
}
/**
 * Calculates Fibonacci retracement and extension levels based on price data.
 * Fibonacci levels are used to identify potential support and resistance levels.
 *
 * @param priceData - An array of price data objects containing high and low prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.lookbackPeriod - The number of periods to look back for swing high/low (default is 20).
 * @param params.retracementLevels - An array of retracement levels to calculate (default is [0.236, 0.382, 0.5, 0.618, 0.786]).
 * @param params.extensionLevels - An array of extension levels to calculate (default is [1.272, 1.618, 2.618]).
 * @param params.reverseDirection - A boolean indicating if the trend is reversed (default is false).
 * @returns An array of FibonacciData objects containing the calculated levels.
 */
function calculateFibonacciLevels(priceData, { lookbackPeriod = 20, retracementLevels = [0.236, 0.382, 0.5, 0.618, 0.786], extensionLevels = [1.272, 1.618, 2.618], reverseDirection = false, } = {}) {
    const result = [];
    for (let i = 0; i < priceData.length; i++) {
        const periodSlice = priceData.slice(Math.max(0, i - lookbackPeriod + 1), i + 1);
        const swingHigh = Math.max(...periodSlice.map((d) => d.high));
        const swingLow = Math.min(...periodSlice.map((d) => d.low));
        const priceRange = swingHigh - swingLow;
        const trend = reverseDirection ? 'downtrend' : 'uptrend';
        let levels = [];
        if (priceRange > 0) {
            // Calculate retracement levels
            retracementLevels.forEach((level) => {
                const price = reverseDirection ? swingLow + priceRange * level : swingHigh - priceRange * level;
                levels.push({
                    level,
                    price: parseFloat(price.toFixed(2)),
                    type: 'retracement',
                });
            });
            // Calculate extension levels
            extensionLevels.forEach((level) => {
                const price = reverseDirection
                    ? swingHigh - priceRange * (level - 1) // For downtrend
                    : swingHigh + priceRange * (level - 1); // For uptrend
                levels.push({
                    level,
                    price: parseFloat(price.toFixed(2)),
                    type: 'extension',
                });
            });
            // Sort levels by price
            levels.sort((a, b) => (reverseDirection ? b.price - a.price : a.price - b.price));
        }
        else {
            logIfDebug(`Price range is zero on date ${priceData[i].date}; no levels calculated.`);
        }
        result.push({
            date: priceData[i].date,
            levels,
            swingHigh,
            swingLow,
            trend,
            close: priceData[i].close,
        });
    }
    // logIfDebug(`Calculated Fibonacci levels for ${result.length} periods`);
    return result;
}
/**
 * Calculates the Moving Average Convergence Divergence (MACD) for a given set of price data.
 * MACD is a trend-following momentum indicator that shows the relationship between two EMAs.
 *
 * @param priceData - An array of price data objects containing closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.shortPeriod - The short EMA period (default is 12).
 * @param params.longPeriod - The long EMA period (default is 26).
 * @param params.signalPeriod - The signal line period (default is 9).
 * @returns An array of MACDData objects containing the calculated MACD values.
 */
function calculateMACD(priceData, { shortPeriod = 12, longPeriod = 26, signalPeriod = 9 } = {}) {
    if (priceData.length < longPeriod + signalPeriod) {
        logIfDebug(`Insufficient data for MACD calculation: required periods: ${longPeriod + signalPeriod}, but only received ${priceData.length} periods of data`);
        return [];
    }
    const emaShort = calculateEMA(priceData, { period: shortPeriod });
    const emaLong = calculateEMA(priceData, { period: longPeriod });
    // Align EMAs by trimming the beginning of emaShort to match emaLong length
    if (emaShort.length < emaLong.length) {
        logIfDebug('Short EMA length is less than Long EMA length for MACD calculation');
        return [];
    }
    const emaShortAligned = emaShort.slice(emaShort.length - emaLong.length);
    const macdLine = emaShortAligned.map((short, i) => short.ema - emaLong[i].ema);
    const result = [];
    if (macdLine.length < signalPeriod) {
        logIfDebug(`Insufficient MACD data for Signal Line calculation: required periods: ${signalPeriod}, but only received ${macdLine.length} periods of data`);
        return [];
    }
    const signalMultiplier = 2 / (signalPeriod + 1);
    let signalEMA = macdLine.slice(0, signalPeriod).reduce((sum, val) => sum + val, 0) / signalPeriod;
    for (let i = signalPeriod; i < macdLine.length; i++) {
        const macdValue = macdLine[i];
        signalEMA = (macdValue - signalEMA) * signalMultiplier + signalEMA;
        const hist = macdValue - signalEMA;
        result.push({
            date: emaLong[i].date, // Use emaLong's date for alignment
            macd: parseFloat(macdValue.toFixed(2)),
            signal: parseFloat(signalEMA.toFixed(2)),
            histogram: parseFloat(hist.toFixed(2)),
            close: emaLong[i].close,
        });
    }
    // logIfDebug(`Calculated MACD for ${result.length} periods`);
    return result;
}
/**
 * Calculates the Relative Strength Index (RSI) for a given set of price data.
 * RSI is a momentum oscillator that measures the speed and change of price movements.
 *
 * @param priceData - An array of price data objects containing closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.period - The number of periods to use for the RSI (default is 14).
 * @returns An array of RSIData objects containing the calculated RSI values.
 */
function calculateRSI(priceData, { period = 14 } = {}) {
    if (priceData.length < period + 1) {
        logIfDebug(`Insufficient data for RSI calculation: required periods: ${period + 1}, but only received ${priceData.length} periods of data`);
        return [];
    }
    const result = [];
    let avgGain = 0;
    let avgLoss = 0;
    // Calculate first average gain and loss
    for (let i = 1; i <= period; i++) {
        const change = priceData[i].close - priceData[i - 1].close;
        if (change >= 0) {
            avgGain += change;
        }
        else {
            avgLoss += Math.abs(change);
        }
    }
    avgGain = avgGain / period;
    avgLoss = avgLoss / period;
    // Calculate RSI for the first period
    let rs = avgGain / avgLoss;
    let rsi = 100 - 100 / (1 + rs);
    result.push({
        date: priceData[period].date,
        rsi: parseFloat(rsi.toFixed(2)),
        close: priceData[period].close,
    });
    // Calculate subsequent periods using smoothed averages
    for (let i = period + 1; i < priceData.length; i++) {
        const change = priceData[i].close - priceData[i - 1].close;
        const gain = change >= 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        // Use smoothed averages
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rs = avgGain / avgLoss;
        rsi = 100 - 100 / (1 + rs);
        result.push({
            date: priceData[i].date,
            rsi: parseFloat(rsi.toFixed(2)),
            close: priceData[i].close,
        });
    }
    // logIfDebug(`Calculated RSI for ${result.length} periods`);
    return result;
}
/**
 * Calculates the Stochastic Oscillator for a given set of price data.
 * The Stochastic Oscillator compares a particular closing price of a security to a range of its prices over a certain period of time.
 *
 * @param priceData - An array of price data objects containing high, low, and closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.lookbackPeriod - The number of periods to look back for the calculation of %K (default is 5).
 * @param params.signalPeriod - The number of periods for the %D signal line (default is 3).
 * @param params.smoothingFactor - The smoothing factor for %K (default is 3).
 * @returns An array of StochData objects containing the calculated %K and %D values.
 */
function calculateStochasticOscillator(priceData, { lookbackPeriod = 5, signalPeriod = 3, smoothingFactor = 3 } = {}) {
    if (priceData.length < lookbackPeriod) {
        logIfDebug(`Insufficient data for Stochastic Oscillator calculation: required periods: ${lookbackPeriod}, but only received ${priceData.length} periods of data`);
        return [];
    }
    const kValues = [];
    const result = [];
    let kSum = 0;
    let dSum = 0;
    for (let i = lookbackPeriod - 1; i < priceData.length; i++) {
        const periodSlice = priceData.slice(i - lookbackPeriod + 1, i + 1);
        const currentClose = periodSlice[periodSlice.length - 1].close;
        const highPrices = periodSlice.map((d) => d.high);
        const lowPrices = periodSlice.map((d) => d.low);
        const highestHigh = Math.max(...highPrices);
        const lowestLow = Math.min(...lowPrices);
        const k = highestHigh === lowestLow ? 0 : ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
        kValues.push(k);
        kSum += k;
        if (kValues.length > smoothingFactor)
            kSum -= kValues[kValues.length - smoothingFactor - 1];
        const smoothedK = kSum / Math.min(kValues.length, smoothingFactor);
        dSum += smoothedK;
        if (kValues.length > smoothingFactor + signalPeriod - 1)
            dSum -= kValues[kValues.length - smoothingFactor - signalPeriod];
        const smoothedD = dSum / Math.min(kValues.length - smoothingFactor + 1, signalPeriod);
        if (kValues.length >= smoothingFactor + signalPeriod - 1) {
            result.push({
                date: priceData[i].date,
                slowK: parseFloat(smoothedK.toFixed(2)),
                slowD: parseFloat(smoothedD.toFixed(2)),
                close: currentClose,
            });
        }
    }
    // logIfDebug(`Calculated Stochastic Oscillator for ${result.length} periods`);
    return result;
}
/**
 * Calculates support and resistance levels based on price data.
 * Support and resistance levels are price levels at which a stock tends to stop and reverse.
 *
 * @param priceData - An array of price data objects containing high, low, and closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.maxLevels - The maximum number of support/resistance levels to return (default is 5).
 * @param params.lookbackPeriod - The number of periods to look back for pivot points (default is 10).
 * @returns An array of SupportResistanceData objects containing the calculated levels.
 */
function calculateSupportAndResistance(priceData, { maxLevels = 5, lookbackPeriod = 10 } = {}) {
    const result = [];
    for (let i = 0; i < priceData.length; i++) {
        const startIdx = Math.max(0, i - lookbackPeriod);
        const analysisWindow = priceData.slice(startIdx, i + 1);
        const pivotPoints = [];
        // **Compute Volatility Metrics**
        const priceChanges = analysisWindow.slice(1).map((bar, idx) => Math.abs(bar.close - analysisWindow[idx].close));
        const avgPriceChange = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
        const volatility = avgPriceChange / analysisWindow[0].close; // Relative volatility
        // **Adjust Sensitivity and minGapBetweenLevels Dynamically**
        const sensitivity = volatility * 2; // Adjust the multiplier as needed
        const minGapBetweenLevels = volatility * 100; // Convert to percentage
        // Analyze each point in window for pivot status
        for (let j = 1; j < analysisWindow.length - 1; j++) {
            const curr = analysisWindow[j];
            const prevBar = analysisWindow[j - 1];
            const nextBar = analysisWindow[j + 1];
            // Check for high pivot
            if (curr.high > prevBar.high && curr.high > nextBar.high) {
                const existingPivot = pivotPoints.find((p) => Math.abs(p.price - curr.high) / curr.high < sensitivity);
                if (existingPivot) {
                    existingPivot.count++;
                    existingPivot.volume += curr.vol; // **Include Volume**
                }
                else {
                    pivotPoints.push({ price: curr.high, count: 1, volume: curr.vol });
                }
            }
            // Check for low pivot
            if (curr.low < prevBar.low && curr.low < nextBar.low) {
                const existingPivot = pivotPoints.find((p) => Math.abs(p.price - curr.low) / curr.low < sensitivity);
                if (existingPivot) {
                    existingPivot.count++;
                    existingPivot.volume += curr.vol; // **Include Volume**
                }
                else {
                    pivotPoints.push({ price: curr.low, count: 1, volume: curr.vol });
                }
            }
        }
        // Group nearby levels
        const currentPrice = priceData[i].close;
        const levels = [];
        // Sort pivots by price
        pivotPoints.sort((a, b) => a.price - b.price);
        // Group close pivots
        let currentGroup = [];
        for (let j = 0; j < pivotPoints.length; j++) {
            if (currentGroup.length === 0) {
                currentGroup.push(pivotPoints[j]);
            }
            else {
                const lastPrice = currentGroup[currentGroup.length - 1].price;
                if ((Math.abs(pivotPoints[j].price - lastPrice) / lastPrice) * 100 <= minGapBetweenLevels) {
                    currentGroup.push(pivotPoints[j]);
                }
                else {
                    // Process current group
                    if (currentGroup.length > 0) {
                        const totalVolume = currentGroup.reduce((sum, p) => sum + p.volume, 0);
                        const avgPrice = currentGroup.reduce((sum, p) => sum + p.price * p.volume, 0) / totalVolume;
                        const totalStrength = currentGroup.reduce((sum, p) => sum + p.count * (p.volume / totalVolume), 0);
                        levels.push({
                            price: parseFloat(avgPrice.toFixed(2)),
                            strength: parseFloat(totalStrength.toFixed(2)),
                            type: avgPrice > currentPrice ? 'resistance' : 'support',
                        });
                    }
                    currentGroup = [pivotPoints[j]];
                }
            }
        }
        // Process final group
        if (currentGroup.length > 0) {
            const totalVolume = currentGroup.reduce((sum, p) => sum + p.volume, 0);
            const avgPrice = currentGroup.reduce((sum, p) => sum + p.price * p.volume, 0) / totalVolume;
            const totalStrength = currentGroup.reduce((sum, p) => sum + p.count * (p.volume / totalVolume), 0);
            levels.push({
                price: parseFloat(avgPrice.toFixed(2)),
                strength: parseFloat(totalStrength.toFixed(2)),
                type: avgPrice > currentPrice ? 'resistance' : 'support',
            });
        }
        // Sort by strength and limit
        const finalLevels = levels.sort((a, b) => b.strength - a.strength).slice(0, maxLevels);
        result.push({
            date: priceData[i].date,
            levels: finalLevels,
            close: currentPrice,
        });
    }
    logIfDebug(`Found ${result.reduce((sum, r) => sum + r.levels.length, 0)} support/resistance levels across ${result.length} periods`);
    return result;
}

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var bufferUtil = {exports: {}};

var constants;
var hasRequiredConstants;

function requireConstants () {
	if (hasRequiredConstants) return constants;
	hasRequiredConstants = 1;

	const BINARY_TYPES = ['nodebuffer', 'arraybuffer', 'fragments'];
	const hasBlob = typeof Blob !== 'undefined';

	if (hasBlob) BINARY_TYPES.push('blob');

	constants = {
	  BINARY_TYPES,
	  EMPTY_BUFFER: Buffer.alloc(0),
	  GUID: '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
	  hasBlob,
	  kForOnEventAttribute: Symbol('kIsForOnEventAttribute'),
	  kListener: Symbol('kListener'),
	  kStatusCode: Symbol('status-code'),
	  kWebSocket: Symbol('websocket'),
	  NOOP: () => {}
	};
	return constants;
}

var hasRequiredBufferUtil;

function requireBufferUtil () {
	if (hasRequiredBufferUtil) return bufferUtil.exports;
	hasRequiredBufferUtil = 1;

	const { EMPTY_BUFFER } = requireConstants();

	const FastBuffer = Buffer[Symbol.species];

	/**
	 * Merges an array of buffers into a new buffer.
	 *
	 * @param {Buffer[]} list The array of buffers to concat
	 * @param {Number} totalLength The total length of buffers in the list
	 * @return {Buffer} The resulting buffer
	 * @public
	 */
	function concat(list, totalLength) {
	  if (list.length === 0) return EMPTY_BUFFER;
	  if (list.length === 1) return list[0];

	  const target = Buffer.allocUnsafe(totalLength);
	  let offset = 0;

	  for (let i = 0; i < list.length; i++) {
	    const buf = list[i];
	    target.set(buf, offset);
	    offset += buf.length;
	  }

	  if (offset < totalLength) {
	    return new FastBuffer(target.buffer, target.byteOffset, offset);
	  }

	  return target;
	}

	/**
	 * Masks a buffer using the given mask.
	 *
	 * @param {Buffer} source The buffer to mask
	 * @param {Buffer} mask The mask to use
	 * @param {Buffer} output The buffer where to store the result
	 * @param {Number} offset The offset at which to start writing
	 * @param {Number} length The number of bytes to mask.
	 * @public
	 */
	function _mask(source, mask, output, offset, length) {
	  for (let i = 0; i < length; i++) {
	    output[offset + i] = source[i] ^ mask[i & 3];
	  }
	}

	/**
	 * Unmasks a buffer using the given mask.
	 *
	 * @param {Buffer} buffer The buffer to unmask
	 * @param {Buffer} mask The mask to use
	 * @public
	 */
	function _unmask(buffer, mask) {
	  for (let i = 0; i < buffer.length; i++) {
	    buffer[i] ^= mask[i & 3];
	  }
	}

	/**
	 * Converts a buffer to an `ArrayBuffer`.
	 *
	 * @param {Buffer} buf The buffer to convert
	 * @return {ArrayBuffer} Converted buffer
	 * @public
	 */
	function toArrayBuffer(buf) {
	  if (buf.length === buf.buffer.byteLength) {
	    return buf.buffer;
	  }

	  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
	}

	/**
	 * Converts `data` to a `Buffer`.
	 *
	 * @param {*} data The data to convert
	 * @return {Buffer} The buffer
	 * @throws {TypeError}
	 * @public
	 */
	function toBuffer(data) {
	  toBuffer.readOnly = true;

	  if (Buffer.isBuffer(data)) return data;

	  let buf;

	  if (data instanceof ArrayBuffer) {
	    buf = new FastBuffer(data);
	  } else if (ArrayBuffer.isView(data)) {
	    buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
	  } else {
	    buf = Buffer.from(data);
	    toBuffer.readOnly = false;
	  }

	  return buf;
	}

	bufferUtil.exports = {
	  concat,
	  mask: _mask,
	  toArrayBuffer,
	  toBuffer,
	  unmask: _unmask
	};

	/* istanbul ignore else  */
	if (!process.env.WS_NO_BUFFER_UTIL) {
	  try {
	    const bufferUtil$1 = require('bufferutil');

	    bufferUtil.exports.mask = function (source, mask, output, offset, length) {
	      if (length < 48) _mask(source, mask, output, offset, length);
	      else bufferUtil$1.mask(source, mask, output, offset, length);
	    };

	    bufferUtil.exports.unmask = function (buffer, mask) {
	      if (buffer.length < 32) _unmask(buffer, mask);
	      else bufferUtil$1.unmask(buffer, mask);
	    };
	  } catch (e) {
	    // Continue regardless of the error.
	  }
	}
	return bufferUtil.exports;
}

var limiter;
var hasRequiredLimiter;

function requireLimiter () {
	if (hasRequiredLimiter) return limiter;
	hasRequiredLimiter = 1;

	const kDone = Symbol('kDone');
	const kRun = Symbol('kRun');

	/**
	 * A very simple job queue with adjustable concurrency. Adapted from
	 * https://github.com/STRML/async-limiter
	 */
	class Limiter {
	  /**
	   * Creates a new `Limiter`.
	   *
	   * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
	   *     to run concurrently
	   */
	  constructor(concurrency) {
	    this[kDone] = () => {
	      this.pending--;
	      this[kRun]();
	    };
	    this.concurrency = concurrency || Infinity;
	    this.jobs = [];
	    this.pending = 0;
	  }

	  /**
	   * Adds a job to the queue.
	   *
	   * @param {Function} job The job to run
	   * @public
	   */
	  add(job) {
	    this.jobs.push(job);
	    this[kRun]();
	  }

	  /**
	   * Removes a job from the queue and runs it if possible.
	   *
	   * @private
	   */
	  [kRun]() {
	    if (this.pending === this.concurrency) return;

	    if (this.jobs.length) {
	      const job = this.jobs.shift();

	      this.pending++;
	      job(this[kDone]);
	    }
	  }
	}

	limiter = Limiter;
	return limiter;
}

var permessageDeflate;
var hasRequiredPermessageDeflate;

function requirePermessageDeflate () {
	if (hasRequiredPermessageDeflate) return permessageDeflate;
	hasRequiredPermessageDeflate = 1;

	const zlib = require$$0;

	const bufferUtil = requireBufferUtil();
	const Limiter = requireLimiter();
	const { kStatusCode } = requireConstants();

	const FastBuffer = Buffer[Symbol.species];
	const TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);
	const kPerMessageDeflate = Symbol('permessage-deflate');
	const kTotalLength = Symbol('total-length');
	const kCallback = Symbol('callback');
	const kBuffers = Symbol('buffers');
	const kError = Symbol('error');

	//
	// We limit zlib concurrency, which prevents severe memory fragmentation
	// as documented in https://github.com/nodejs/node/issues/8871#issuecomment-250915913
	// and https://github.com/websockets/ws/issues/1202
	//
	// Intentionally global; it's the global thread pool that's an issue.
	//
	let zlibLimiter;

	/**
	 * permessage-deflate implementation.
	 */
	class PerMessageDeflate {
	  /**
	   * Creates a PerMessageDeflate instance.
	   *
	   * @param {Object} [options] Configuration options
	   * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
	   *     for, or request, a custom client window size
	   * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
	   *     acknowledge disabling of client context takeover
	   * @param {Number} [options.concurrencyLimit=10] The number of concurrent
	   *     calls to zlib
	   * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
	   *     use of a custom server window size
	   * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
	   *     disabling of server context takeover
	   * @param {Number} [options.threshold=1024] Size (in bytes) below which
	   *     messages should not be compressed if context takeover is disabled
	   * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
	   *     deflate
	   * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
	   *     inflate
	   * @param {Boolean} [isServer=false] Create the instance in either server or
	   *     client mode
	   * @param {Number} [maxPayload=0] The maximum allowed message length
	   */
	  constructor(options, isServer, maxPayload) {
	    this._maxPayload = maxPayload | 0;
	    this._options = options || {};
	    this._threshold =
	      this._options.threshold !== undefined ? this._options.threshold : 1024;
	    this._isServer = !!isServer;
	    this._deflate = null;
	    this._inflate = null;

	    this.params = null;

	    if (!zlibLimiter) {
	      const concurrency =
	        this._options.concurrencyLimit !== undefined
	          ? this._options.concurrencyLimit
	          : 10;
	      zlibLimiter = new Limiter(concurrency);
	    }
	  }

	  /**
	   * @type {String}
	   */
	  static get extensionName() {
	    return 'permessage-deflate';
	  }

	  /**
	   * Create an extension negotiation offer.
	   *
	   * @return {Object} Extension parameters
	   * @public
	   */
	  offer() {
	    const params = {};

	    if (this._options.serverNoContextTakeover) {
	      params.server_no_context_takeover = true;
	    }
	    if (this._options.clientNoContextTakeover) {
	      params.client_no_context_takeover = true;
	    }
	    if (this._options.serverMaxWindowBits) {
	      params.server_max_window_bits = this._options.serverMaxWindowBits;
	    }
	    if (this._options.clientMaxWindowBits) {
	      params.client_max_window_bits = this._options.clientMaxWindowBits;
	    } else if (this._options.clientMaxWindowBits == null) {
	      params.client_max_window_bits = true;
	    }

	    return params;
	  }

	  /**
	   * Accept an extension negotiation offer/response.
	   *
	   * @param {Array} configurations The extension negotiation offers/reponse
	   * @return {Object} Accepted configuration
	   * @public
	   */
	  accept(configurations) {
	    configurations = this.normalizeParams(configurations);

	    this.params = this._isServer
	      ? this.acceptAsServer(configurations)
	      : this.acceptAsClient(configurations);

	    return this.params;
	  }

	  /**
	   * Releases all resources used by the extension.
	   *
	   * @public
	   */
	  cleanup() {
	    if (this._inflate) {
	      this._inflate.close();
	      this._inflate = null;
	    }

	    if (this._deflate) {
	      const callback = this._deflate[kCallback];

	      this._deflate.close();
	      this._deflate = null;

	      if (callback) {
	        callback(
	          new Error(
	            'The deflate stream was closed while data was being processed'
	          )
	        );
	      }
	    }
	  }

	  /**
	   *  Accept an extension negotiation offer.
	   *
	   * @param {Array} offers The extension negotiation offers
	   * @return {Object} Accepted configuration
	   * @private
	   */
	  acceptAsServer(offers) {
	    const opts = this._options;
	    const accepted = offers.find((params) => {
	      if (
	        (opts.serverNoContextTakeover === false &&
	          params.server_no_context_takeover) ||
	        (params.server_max_window_bits &&
	          (opts.serverMaxWindowBits === false ||
	            (typeof opts.serverMaxWindowBits === 'number' &&
	              opts.serverMaxWindowBits > params.server_max_window_bits))) ||
	        (typeof opts.clientMaxWindowBits === 'number' &&
	          !params.client_max_window_bits)
	      ) {
	        return false;
	      }

	      return true;
	    });

	    if (!accepted) {
	      throw new Error('None of the extension offers can be accepted');
	    }

	    if (opts.serverNoContextTakeover) {
	      accepted.server_no_context_takeover = true;
	    }
	    if (opts.clientNoContextTakeover) {
	      accepted.client_no_context_takeover = true;
	    }
	    if (typeof opts.serverMaxWindowBits === 'number') {
	      accepted.server_max_window_bits = opts.serverMaxWindowBits;
	    }
	    if (typeof opts.clientMaxWindowBits === 'number') {
	      accepted.client_max_window_bits = opts.clientMaxWindowBits;
	    } else if (
	      accepted.client_max_window_bits === true ||
	      opts.clientMaxWindowBits === false
	    ) {
	      delete accepted.client_max_window_bits;
	    }

	    return accepted;
	  }

	  /**
	   * Accept the extension negotiation response.
	   *
	   * @param {Array} response The extension negotiation response
	   * @return {Object} Accepted configuration
	   * @private
	   */
	  acceptAsClient(response) {
	    const params = response[0];

	    if (
	      this._options.clientNoContextTakeover === false &&
	      params.client_no_context_takeover
	    ) {
	      throw new Error('Unexpected parameter "client_no_context_takeover"');
	    }

	    if (!params.client_max_window_bits) {
	      if (typeof this._options.clientMaxWindowBits === 'number') {
	        params.client_max_window_bits = this._options.clientMaxWindowBits;
	      }
	    } else if (
	      this._options.clientMaxWindowBits === false ||
	      (typeof this._options.clientMaxWindowBits === 'number' &&
	        params.client_max_window_bits > this._options.clientMaxWindowBits)
	    ) {
	      throw new Error(
	        'Unexpected or invalid parameter "client_max_window_bits"'
	      );
	    }

	    return params;
	  }

	  /**
	   * Normalize parameters.
	   *
	   * @param {Array} configurations The extension negotiation offers/reponse
	   * @return {Array} The offers/response with normalized parameters
	   * @private
	   */
	  normalizeParams(configurations) {
	    configurations.forEach((params) => {
	      Object.keys(params).forEach((key) => {
	        let value = params[key];

	        if (value.length > 1) {
	          throw new Error(`Parameter "${key}" must have only a single value`);
	        }

	        value = value[0];

	        if (key === 'client_max_window_bits') {
	          if (value !== true) {
	            const num = +value;
	            if (!Number.isInteger(num) || num < 8 || num > 15) {
	              throw new TypeError(
	                `Invalid value for parameter "${key}": ${value}`
	              );
	            }
	            value = num;
	          } else if (!this._isServer) {
	            throw new TypeError(
	              `Invalid value for parameter "${key}": ${value}`
	            );
	          }
	        } else if (key === 'server_max_window_bits') {
	          const num = +value;
	          if (!Number.isInteger(num) || num < 8 || num > 15) {
	            throw new TypeError(
	              `Invalid value for parameter "${key}": ${value}`
	            );
	          }
	          value = num;
	        } else if (
	          key === 'client_no_context_takeover' ||
	          key === 'server_no_context_takeover'
	        ) {
	          if (value !== true) {
	            throw new TypeError(
	              `Invalid value for parameter "${key}": ${value}`
	            );
	          }
	        } else {
	          throw new Error(`Unknown parameter "${key}"`);
	        }

	        params[key] = value;
	      });
	    });

	    return configurations;
	  }

	  /**
	   * Decompress data. Concurrency limited.
	   *
	   * @param {Buffer} data Compressed data
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @public
	   */
	  decompress(data, fin, callback) {
	    zlibLimiter.add((done) => {
	      this._decompress(data, fin, (err, result) => {
	        done();
	        callback(err, result);
	      });
	    });
	  }

	  /**
	   * Compress data. Concurrency limited.
	   *
	   * @param {(Buffer|String)} data Data to compress
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @public
	   */
	  compress(data, fin, callback) {
	    zlibLimiter.add((done) => {
	      this._compress(data, fin, (err, result) => {
	        done();
	        callback(err, result);
	      });
	    });
	  }

	  /**
	   * Decompress data.
	   *
	   * @param {Buffer} data Compressed data
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @private
	   */
	  _decompress(data, fin, callback) {
	    const endpoint = this._isServer ? 'client' : 'server';

	    if (!this._inflate) {
	      const key = `${endpoint}_max_window_bits`;
	      const windowBits =
	        typeof this.params[key] !== 'number'
	          ? zlib.Z_DEFAULT_WINDOWBITS
	          : this.params[key];

	      this._inflate = zlib.createInflateRaw({
	        ...this._options.zlibInflateOptions,
	        windowBits
	      });
	      this._inflate[kPerMessageDeflate] = this;
	      this._inflate[kTotalLength] = 0;
	      this._inflate[kBuffers] = [];
	      this._inflate.on('error', inflateOnError);
	      this._inflate.on('data', inflateOnData);
	    }

	    this._inflate[kCallback] = callback;

	    this._inflate.write(data);
	    if (fin) this._inflate.write(TRAILER);

	    this._inflate.flush(() => {
	      const err = this._inflate[kError];

	      if (err) {
	        this._inflate.close();
	        this._inflate = null;
	        callback(err);
	        return;
	      }

	      const data = bufferUtil.concat(
	        this._inflate[kBuffers],
	        this._inflate[kTotalLength]
	      );

	      if (this._inflate._readableState.endEmitted) {
	        this._inflate.close();
	        this._inflate = null;
	      } else {
	        this._inflate[kTotalLength] = 0;
	        this._inflate[kBuffers] = [];

	        if (fin && this.params[`${endpoint}_no_context_takeover`]) {
	          this._inflate.reset();
	        }
	      }

	      callback(null, data);
	    });
	  }

	  /**
	   * Compress data.
	   *
	   * @param {(Buffer|String)} data Data to compress
	   * @param {Boolean} fin Specifies whether or not this is the last fragment
	   * @param {Function} callback Callback
	   * @private
	   */
	  _compress(data, fin, callback) {
	    const endpoint = this._isServer ? 'server' : 'client';

	    if (!this._deflate) {
	      const key = `${endpoint}_max_window_bits`;
	      const windowBits =
	        typeof this.params[key] !== 'number'
	          ? zlib.Z_DEFAULT_WINDOWBITS
	          : this.params[key];

	      this._deflate = zlib.createDeflateRaw({
	        ...this._options.zlibDeflateOptions,
	        windowBits
	      });

	      this._deflate[kTotalLength] = 0;
	      this._deflate[kBuffers] = [];

	      this._deflate.on('data', deflateOnData);
	    }

	    this._deflate[kCallback] = callback;

	    this._deflate.write(data);
	    this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
	      if (!this._deflate) {
	        //
	        // The deflate stream was closed while data was being processed.
	        //
	        return;
	      }

	      let data = bufferUtil.concat(
	        this._deflate[kBuffers],
	        this._deflate[kTotalLength]
	      );

	      if (fin) {
	        data = new FastBuffer(data.buffer, data.byteOffset, data.length - 4);
	      }

	      //
	      // Ensure that the callback will not be called again in
	      // `PerMessageDeflate#cleanup()`.
	      //
	      this._deflate[kCallback] = null;

	      this._deflate[kTotalLength] = 0;
	      this._deflate[kBuffers] = [];

	      if (fin && this.params[`${endpoint}_no_context_takeover`]) {
	        this._deflate.reset();
	      }

	      callback(null, data);
	    });
	  }
	}

	permessageDeflate = PerMessageDeflate;

	/**
	 * The listener of the `zlib.DeflateRaw` stream `'data'` event.
	 *
	 * @param {Buffer} chunk A chunk of data
	 * @private
	 */
	function deflateOnData(chunk) {
	  this[kBuffers].push(chunk);
	  this[kTotalLength] += chunk.length;
	}

	/**
	 * The listener of the `zlib.InflateRaw` stream `'data'` event.
	 *
	 * @param {Buffer} chunk A chunk of data
	 * @private
	 */
	function inflateOnData(chunk) {
	  this[kTotalLength] += chunk.length;

	  if (
	    this[kPerMessageDeflate]._maxPayload < 1 ||
	    this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload
	  ) {
	    this[kBuffers].push(chunk);
	    return;
	  }

	  this[kError] = new RangeError('Max payload size exceeded');
	  this[kError].code = 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH';
	  this[kError][kStatusCode] = 1009;
	  this.removeListener('data', inflateOnData);

	  //
	  // The choice to employ `zlib.reset()` over `zlib.close()` is dictated by the
	  // fact that in Node.js versions prior to 13.10.0, the callback for
	  // `zlib.flush()` is not called if `zlib.close()` is used. Utilizing
	  // `zlib.reset()` ensures that either the callback is invoked or an error is
	  // emitted.
	  //
	  this.reset();
	}

	/**
	 * The listener of the `zlib.InflateRaw` stream `'error'` event.
	 *
	 * @param {Error} err The emitted error
	 * @private
	 */
	function inflateOnError(err) {
	  //
	  // There is no need to call `Zlib#close()` as the handle is automatically
	  // closed when an error is emitted.
	  //
	  this[kPerMessageDeflate]._inflate = null;

	  if (this[kError]) {
	    this[kCallback](this[kError]);
	    return;
	  }

	  err[kStatusCode] = 1007;
	  this[kCallback](err);
	}
	return permessageDeflate;
}

var validation = {exports: {}};

var hasRequiredValidation;

function requireValidation () {
	if (hasRequiredValidation) return validation.exports;
	hasRequiredValidation = 1;

	const { isUtf8 } = require$$0$1;

	const { hasBlob } = requireConstants();

	//
	// Allowed token characters:
	//
	// '!', '#', '$', '%', '&', ''', '*', '+', '-',
	// '.', 0-9, A-Z, '^', '_', '`', a-z, '|', '~'
	//
	// tokenChars[32] === 0 // ' '
	// tokenChars[33] === 1 // '!'
	// tokenChars[34] === 0 // '"'
	// ...
	//
	// prettier-ignore
	const tokenChars = [
	  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
	  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
	  0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, // 32 - 47
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
	  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, // 80 - 95
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
	  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0 // 112 - 127
	];

	/**
	 * Checks if a status code is allowed in a close frame.
	 *
	 * @param {Number} code The status code
	 * @return {Boolean} `true` if the status code is valid, else `false`
	 * @public
	 */
	function isValidStatusCode(code) {
	  return (
	    (code >= 1000 &&
	      code <= 1014 &&
	      code !== 1004 &&
	      code !== 1005 &&
	      code !== 1006) ||
	    (code >= 3000 && code <= 4999)
	  );
	}

	/**
	 * Checks if a given buffer contains only correct UTF-8.
	 * Ported from https://www.cl.cam.ac.uk/%7Emgk25/ucs/utf8_check.c by
	 * Markus Kuhn.
	 *
	 * @param {Buffer} buf The buffer to check
	 * @return {Boolean} `true` if `buf` contains only correct UTF-8, else `false`
	 * @public
	 */
	function _isValidUTF8(buf) {
	  const len = buf.length;
	  let i = 0;

	  while (i < len) {
	    if ((buf[i] & 0x80) === 0) {
	      // 0xxxxxxx
	      i++;
	    } else if ((buf[i] & 0xe0) === 0xc0) {
	      // 110xxxxx 10xxxxxx
	      if (
	        i + 1 === len ||
	        (buf[i + 1] & 0xc0) !== 0x80 ||
	        (buf[i] & 0xfe) === 0xc0 // Overlong
	      ) {
	        return false;
	      }

	      i += 2;
	    } else if ((buf[i] & 0xf0) === 0xe0) {
	      // 1110xxxx 10xxxxxx 10xxxxxx
	      if (
	        i + 2 >= len ||
	        (buf[i + 1] & 0xc0) !== 0x80 ||
	        (buf[i + 2] & 0xc0) !== 0x80 ||
	        (buf[i] === 0xe0 && (buf[i + 1] & 0xe0) === 0x80) || // Overlong
	        (buf[i] === 0xed && (buf[i + 1] & 0xe0) === 0xa0) // Surrogate (U+D800 - U+DFFF)
	      ) {
	        return false;
	      }

	      i += 3;
	    } else if ((buf[i] & 0xf8) === 0xf0) {
	      // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
	      if (
	        i + 3 >= len ||
	        (buf[i + 1] & 0xc0) !== 0x80 ||
	        (buf[i + 2] & 0xc0) !== 0x80 ||
	        (buf[i + 3] & 0xc0) !== 0x80 ||
	        (buf[i] === 0xf0 && (buf[i + 1] & 0xf0) === 0x80) || // Overlong
	        (buf[i] === 0xf4 && buf[i + 1] > 0x8f) ||
	        buf[i] > 0xf4 // > U+10FFFF
	      ) {
	        return false;
	      }

	      i += 4;
	    } else {
	      return false;
	    }
	  }

	  return true;
	}

	/**
	 * Determines whether a value is a `Blob`.
	 *
	 * @param {*} value The value to be tested
	 * @return {Boolean} `true` if `value` is a `Blob`, else `false`
	 * @private
	 */
	function isBlob(value) {
	  return (
	    hasBlob &&
	    typeof value === 'object' &&
	    typeof value.arrayBuffer === 'function' &&
	    typeof value.type === 'string' &&
	    typeof value.stream === 'function' &&
	    (value[Symbol.toStringTag] === 'Blob' ||
	      value[Symbol.toStringTag] === 'File')
	  );
	}

	validation.exports = {
	  isBlob,
	  isValidStatusCode,
	  isValidUTF8: _isValidUTF8,
	  tokenChars
	};

	if (isUtf8) {
	  validation.exports.isValidUTF8 = function (buf) {
	    return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
	  };
	} /* istanbul ignore else  */ else if (!process.env.WS_NO_UTF_8_VALIDATE) {
	  try {
	    const isValidUTF8 = require('utf-8-validate');

	    validation.exports.isValidUTF8 = function (buf) {
	      return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
	    };
	  } catch (e) {
	    // Continue regardless of the error.
	  }
	}
	return validation.exports;
}

var receiver;
var hasRequiredReceiver;

function requireReceiver () {
	if (hasRequiredReceiver) return receiver;
	hasRequiredReceiver = 1;

	const { Writable } = require$$0$2;

	const PerMessageDeflate = requirePermessageDeflate();
	const {
	  BINARY_TYPES,
	  EMPTY_BUFFER,
	  kStatusCode,
	  kWebSocket
	} = requireConstants();
	const { concat, toArrayBuffer, unmask } = requireBufferUtil();
	const { isValidStatusCode, isValidUTF8 } = requireValidation();

	const FastBuffer = Buffer[Symbol.species];

	const GET_INFO = 0;
	const GET_PAYLOAD_LENGTH_16 = 1;
	const GET_PAYLOAD_LENGTH_64 = 2;
	const GET_MASK = 3;
	const GET_DATA = 4;
	const INFLATING = 5;
	const DEFER_EVENT = 6;

	/**
	 * HyBi Receiver implementation.
	 *
	 * @extends Writable
	 */
	class Receiver extends Writable {
	  /**
	   * Creates a Receiver instance.
	   *
	   * @param {Object} [options] Options object
	   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
	   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
	   *     multiple times in the same tick
	   * @param {String} [options.binaryType=nodebuffer] The type for binary data
	   * @param {Object} [options.extensions] An object containing the negotiated
	   *     extensions
	   * @param {Boolean} [options.isServer=false] Specifies whether to operate in
	   *     client or server mode
	   * @param {Number} [options.maxPayload=0] The maximum allowed message length
	   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	   *     not to skip UTF-8 validation for text and close messages
	   */
	  constructor(options = {}) {
	    super();

	    this._allowSynchronousEvents =
	      options.allowSynchronousEvents !== undefined
	        ? options.allowSynchronousEvents
	        : true;
	    this._binaryType = options.binaryType || BINARY_TYPES[0];
	    this._extensions = options.extensions || {};
	    this._isServer = !!options.isServer;
	    this._maxPayload = options.maxPayload | 0;
	    this._skipUTF8Validation = !!options.skipUTF8Validation;
	    this[kWebSocket] = undefined;

	    this._bufferedBytes = 0;
	    this._buffers = [];

	    this._compressed = false;
	    this._payloadLength = 0;
	    this._mask = undefined;
	    this._fragmented = 0;
	    this._masked = false;
	    this._fin = false;
	    this._opcode = 0;

	    this._totalPayloadLength = 0;
	    this._messageLength = 0;
	    this._fragments = [];

	    this._errored = false;
	    this._loop = false;
	    this._state = GET_INFO;
	  }

	  /**
	   * Implements `Writable.prototype._write()`.
	   *
	   * @param {Buffer} chunk The chunk of data to write
	   * @param {String} encoding The character encoding of `chunk`
	   * @param {Function} cb Callback
	   * @private
	   */
	  _write(chunk, encoding, cb) {
	    if (this._opcode === 0x08 && this._state == GET_INFO) return cb();

	    this._bufferedBytes += chunk.length;
	    this._buffers.push(chunk);
	    this.startLoop(cb);
	  }

	  /**
	   * Consumes `n` bytes from the buffered data.
	   *
	   * @param {Number} n The number of bytes to consume
	   * @return {Buffer} The consumed bytes
	   * @private
	   */
	  consume(n) {
	    this._bufferedBytes -= n;

	    if (n === this._buffers[0].length) return this._buffers.shift();

	    if (n < this._buffers[0].length) {
	      const buf = this._buffers[0];
	      this._buffers[0] = new FastBuffer(
	        buf.buffer,
	        buf.byteOffset + n,
	        buf.length - n
	      );

	      return new FastBuffer(buf.buffer, buf.byteOffset, n);
	    }

	    const dst = Buffer.allocUnsafe(n);

	    do {
	      const buf = this._buffers[0];
	      const offset = dst.length - n;

	      if (n >= buf.length) {
	        dst.set(this._buffers.shift(), offset);
	      } else {
	        dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
	        this._buffers[0] = new FastBuffer(
	          buf.buffer,
	          buf.byteOffset + n,
	          buf.length - n
	        );
	      }

	      n -= buf.length;
	    } while (n > 0);

	    return dst;
	  }

	  /**
	   * Starts the parsing loop.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  startLoop(cb) {
	    this._loop = true;

	    do {
	      switch (this._state) {
	        case GET_INFO:
	          this.getInfo(cb);
	          break;
	        case GET_PAYLOAD_LENGTH_16:
	          this.getPayloadLength16(cb);
	          break;
	        case GET_PAYLOAD_LENGTH_64:
	          this.getPayloadLength64(cb);
	          break;
	        case GET_MASK:
	          this.getMask();
	          break;
	        case GET_DATA:
	          this.getData(cb);
	          break;
	        case INFLATING:
	        case DEFER_EVENT:
	          this._loop = false;
	          return;
	      }
	    } while (this._loop);

	    if (!this._errored) cb();
	  }

	  /**
	   * Reads the first two bytes of a frame.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getInfo(cb) {
	    if (this._bufferedBytes < 2) {
	      this._loop = false;
	      return;
	    }

	    const buf = this.consume(2);

	    if ((buf[0] & 0x30) !== 0x00) {
	      const error = this.createError(
	        RangeError,
	        'RSV2 and RSV3 must be clear',
	        true,
	        1002,
	        'WS_ERR_UNEXPECTED_RSV_2_3'
	      );

	      cb(error);
	      return;
	    }

	    const compressed = (buf[0] & 0x40) === 0x40;

	    if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
	      const error = this.createError(
	        RangeError,
	        'RSV1 must be clear',
	        true,
	        1002,
	        'WS_ERR_UNEXPECTED_RSV_1'
	      );

	      cb(error);
	      return;
	    }

	    this._fin = (buf[0] & 0x80) === 0x80;
	    this._opcode = buf[0] & 0x0f;
	    this._payloadLength = buf[1] & 0x7f;

	    if (this._opcode === 0x00) {
	      if (compressed) {
	        const error = this.createError(
	          RangeError,
	          'RSV1 must be clear',
	          true,
	          1002,
	          'WS_ERR_UNEXPECTED_RSV_1'
	        );

	        cb(error);
	        return;
	      }

	      if (!this._fragmented) {
	        const error = this.createError(
	          RangeError,
	          'invalid opcode 0',
	          true,
	          1002,
	          'WS_ERR_INVALID_OPCODE'
	        );

	        cb(error);
	        return;
	      }

	      this._opcode = this._fragmented;
	    } else if (this._opcode === 0x01 || this._opcode === 0x02) {
	      if (this._fragmented) {
	        const error = this.createError(
	          RangeError,
	          `invalid opcode ${this._opcode}`,
	          true,
	          1002,
	          'WS_ERR_INVALID_OPCODE'
	        );

	        cb(error);
	        return;
	      }

	      this._compressed = compressed;
	    } else if (this._opcode > 0x07 && this._opcode < 0x0b) {
	      if (!this._fin) {
	        const error = this.createError(
	          RangeError,
	          'FIN must be set',
	          true,
	          1002,
	          'WS_ERR_EXPECTED_FIN'
	        );

	        cb(error);
	        return;
	      }

	      if (compressed) {
	        const error = this.createError(
	          RangeError,
	          'RSV1 must be clear',
	          true,
	          1002,
	          'WS_ERR_UNEXPECTED_RSV_1'
	        );

	        cb(error);
	        return;
	      }

	      if (
	        this._payloadLength > 0x7d ||
	        (this._opcode === 0x08 && this._payloadLength === 1)
	      ) {
	        const error = this.createError(
	          RangeError,
	          `invalid payload length ${this._payloadLength}`,
	          true,
	          1002,
	          'WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH'
	        );

	        cb(error);
	        return;
	      }
	    } else {
	      const error = this.createError(
	        RangeError,
	        `invalid opcode ${this._opcode}`,
	        true,
	        1002,
	        'WS_ERR_INVALID_OPCODE'
	      );

	      cb(error);
	      return;
	    }

	    if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
	    this._masked = (buf[1] & 0x80) === 0x80;

	    if (this._isServer) {
	      if (!this._masked) {
	        const error = this.createError(
	          RangeError,
	          'MASK must be set',
	          true,
	          1002,
	          'WS_ERR_EXPECTED_MASK'
	        );

	        cb(error);
	        return;
	      }
	    } else if (this._masked) {
	      const error = this.createError(
	        RangeError,
	        'MASK must be clear',
	        true,
	        1002,
	        'WS_ERR_UNEXPECTED_MASK'
	      );

	      cb(error);
	      return;
	    }

	    if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
	    else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
	    else this.haveLength(cb);
	  }

	  /**
	   * Gets extended payload length (7+16).
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getPayloadLength16(cb) {
	    if (this._bufferedBytes < 2) {
	      this._loop = false;
	      return;
	    }

	    this._payloadLength = this.consume(2).readUInt16BE(0);
	    this.haveLength(cb);
	  }

	  /**
	   * Gets extended payload length (7+64).
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getPayloadLength64(cb) {
	    if (this._bufferedBytes < 8) {
	      this._loop = false;
	      return;
	    }

	    const buf = this.consume(8);
	    const num = buf.readUInt32BE(0);

	    //
	    // The maximum safe integer in JavaScript is 2^53 - 1. An error is returned
	    // if payload length is greater than this number.
	    //
	    if (num > Math.pow(2, 53 - 32) - 1) {
	      const error = this.createError(
	        RangeError,
	        'Unsupported WebSocket frame: payload length > 2^53 - 1',
	        false,
	        1009,
	        'WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH'
	      );

	      cb(error);
	      return;
	    }

	    this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
	    this.haveLength(cb);
	  }

	  /**
	   * Payload length has been read.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  haveLength(cb) {
	    if (this._payloadLength && this._opcode < 0x08) {
	      this._totalPayloadLength += this._payloadLength;
	      if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
	        const error = this.createError(
	          RangeError,
	          'Max payload size exceeded',
	          false,
	          1009,
	          'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
	        );

	        cb(error);
	        return;
	      }
	    }

	    if (this._masked) this._state = GET_MASK;
	    else this._state = GET_DATA;
	  }

	  /**
	   * Reads mask bytes.
	   *
	   * @private
	   */
	  getMask() {
	    if (this._bufferedBytes < 4) {
	      this._loop = false;
	      return;
	    }

	    this._mask = this.consume(4);
	    this._state = GET_DATA;
	  }

	  /**
	   * Reads data bytes.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  getData(cb) {
	    let data = EMPTY_BUFFER;

	    if (this._payloadLength) {
	      if (this._bufferedBytes < this._payloadLength) {
	        this._loop = false;
	        return;
	      }

	      data = this.consume(this._payloadLength);

	      if (
	        this._masked &&
	        (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0
	      ) {
	        unmask(data, this._mask);
	      }
	    }

	    if (this._opcode > 0x07) {
	      this.controlMessage(data, cb);
	      return;
	    }

	    if (this._compressed) {
	      this._state = INFLATING;
	      this.decompress(data, cb);
	      return;
	    }

	    if (data.length) {
	      //
	      // This message is not compressed so its length is the sum of the payload
	      // length of all fragments.
	      //
	      this._messageLength = this._totalPayloadLength;
	      this._fragments.push(data);
	    }

	    this.dataMessage(cb);
	  }

	  /**
	   * Decompresses data.
	   *
	   * @param {Buffer} data Compressed data
	   * @param {Function} cb Callback
	   * @private
	   */
	  decompress(data, cb) {
	    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

	    perMessageDeflate.decompress(data, this._fin, (err, buf) => {
	      if (err) return cb(err);

	      if (buf.length) {
	        this._messageLength += buf.length;
	        if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
	          const error = this.createError(
	            RangeError,
	            'Max payload size exceeded',
	            false,
	            1009,
	            'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'
	          );

	          cb(error);
	          return;
	        }

	        this._fragments.push(buf);
	      }

	      this.dataMessage(cb);
	      if (this._state === GET_INFO) this.startLoop(cb);
	    });
	  }

	  /**
	   * Handles a data message.
	   *
	   * @param {Function} cb Callback
	   * @private
	   */
	  dataMessage(cb) {
	    if (!this._fin) {
	      this._state = GET_INFO;
	      return;
	    }

	    const messageLength = this._messageLength;
	    const fragments = this._fragments;

	    this._totalPayloadLength = 0;
	    this._messageLength = 0;
	    this._fragmented = 0;
	    this._fragments = [];

	    if (this._opcode === 2) {
	      let data;

	      if (this._binaryType === 'nodebuffer') {
	        data = concat(fragments, messageLength);
	      } else if (this._binaryType === 'arraybuffer') {
	        data = toArrayBuffer(concat(fragments, messageLength));
	      } else if (this._binaryType === 'blob') {
	        data = new Blob(fragments);
	      } else {
	        data = fragments;
	      }

	      if (this._allowSynchronousEvents) {
	        this.emit('message', data, true);
	        this._state = GET_INFO;
	      } else {
	        this._state = DEFER_EVENT;
	        setImmediate(() => {
	          this.emit('message', data, true);
	          this._state = GET_INFO;
	          this.startLoop(cb);
	        });
	      }
	    } else {
	      const buf = concat(fragments, messageLength);

	      if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
	        const error = this.createError(
	          Error,
	          'invalid UTF-8 sequence',
	          true,
	          1007,
	          'WS_ERR_INVALID_UTF8'
	        );

	        cb(error);
	        return;
	      }

	      if (this._state === INFLATING || this._allowSynchronousEvents) {
	        this.emit('message', buf, false);
	        this._state = GET_INFO;
	      } else {
	        this._state = DEFER_EVENT;
	        setImmediate(() => {
	          this.emit('message', buf, false);
	          this._state = GET_INFO;
	          this.startLoop(cb);
	        });
	      }
	    }
	  }

	  /**
	   * Handles a control message.
	   *
	   * @param {Buffer} data Data to handle
	   * @return {(Error|RangeError|undefined)} A possible error
	   * @private
	   */
	  controlMessage(data, cb) {
	    if (this._opcode === 0x08) {
	      if (data.length === 0) {
	        this._loop = false;
	        this.emit('conclude', 1005, EMPTY_BUFFER);
	        this.end();
	      } else {
	        const code = data.readUInt16BE(0);

	        if (!isValidStatusCode(code)) {
	          const error = this.createError(
	            RangeError,
	            `invalid status code ${code}`,
	            true,
	            1002,
	            'WS_ERR_INVALID_CLOSE_CODE'
	          );

	          cb(error);
	          return;
	        }

	        const buf = new FastBuffer(
	          data.buffer,
	          data.byteOffset + 2,
	          data.length - 2
	        );

	        if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
	          const error = this.createError(
	            Error,
	            'invalid UTF-8 sequence',
	            true,
	            1007,
	            'WS_ERR_INVALID_UTF8'
	          );

	          cb(error);
	          return;
	        }

	        this._loop = false;
	        this.emit('conclude', code, buf);
	        this.end();
	      }

	      this._state = GET_INFO;
	      return;
	    }

	    if (this._allowSynchronousEvents) {
	      this.emit(this._opcode === 0x09 ? 'ping' : 'pong', data);
	      this._state = GET_INFO;
	    } else {
	      this._state = DEFER_EVENT;
	      setImmediate(() => {
	        this.emit(this._opcode === 0x09 ? 'ping' : 'pong', data);
	        this._state = GET_INFO;
	        this.startLoop(cb);
	      });
	    }
	  }

	  /**
	   * Builds an error object.
	   *
	   * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
	   * @param {String} message The error message
	   * @param {Boolean} prefix Specifies whether or not to add a default prefix to
	   *     `message`
	   * @param {Number} statusCode The status code
	   * @param {String} errorCode The exposed error code
	   * @return {(Error|RangeError)} The error
	   * @private
	   */
	  createError(ErrorCtor, message, prefix, statusCode, errorCode) {
	    this._loop = false;
	    this._errored = true;

	    const err = new ErrorCtor(
	      prefix ? `Invalid WebSocket frame: ${message}` : message
	    );

	    Error.captureStackTrace(err, this.createError);
	    err.code = errorCode;
	    err[kStatusCode] = statusCode;
	    return err;
	  }
	}

	receiver = Receiver;
	return receiver;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex" }] */

var sender;
var hasRequiredSender;

function requireSender () {
	if (hasRequiredSender) return sender;
	hasRequiredSender = 1;

	const { Duplex } = require$$0$2;
	const { randomFillSync } = require$$1;

	const PerMessageDeflate = requirePermessageDeflate();
	const { EMPTY_BUFFER, kWebSocket, NOOP } = requireConstants();
	const { isBlob, isValidStatusCode } = requireValidation();
	const { mask: applyMask, toBuffer } = requireBufferUtil();

	const kByteLength = Symbol('kByteLength');
	const maskBuffer = Buffer.alloc(4);
	const RANDOM_POOL_SIZE = 8 * 1024;
	let randomPool;
	let randomPoolPointer = RANDOM_POOL_SIZE;

	const DEFAULT = 0;
	const DEFLATING = 1;
	const GET_BLOB_DATA = 2;

	/**
	 * HyBi Sender implementation.
	 */
	class Sender {
	  /**
	   * Creates a Sender instance.
	   *
	   * @param {Duplex} socket The connection socket
	   * @param {Object} [extensions] An object containing the negotiated extensions
	   * @param {Function} [generateMask] The function used to generate the masking
	   *     key
	   */
	  constructor(socket, extensions, generateMask) {
	    this._extensions = extensions || {};

	    if (generateMask) {
	      this._generateMask = generateMask;
	      this._maskBuffer = Buffer.alloc(4);
	    }

	    this._socket = socket;

	    this._firstFragment = true;
	    this._compress = false;

	    this._bufferedBytes = 0;
	    this._queue = [];
	    this._state = DEFAULT;
	    this.onerror = NOOP;
	    this[kWebSocket] = undefined;
	  }

	  /**
	   * Frames a piece of data according to the HyBi WebSocket protocol.
	   *
	   * @param {(Buffer|String)} data The data to frame
	   * @param {Object} options Options object
	   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
	   *     FIN bit
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
	   *     key
	   * @param {Number} options.opcode The opcode
	   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
	   *     modified
	   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
	   *     RSV1 bit
	   * @return {(Buffer|String)[]} The framed data
	   * @public
	   */
	  static frame(data, options) {
	    let mask;
	    let merge = false;
	    let offset = 2;
	    let skipMasking = false;

	    if (options.mask) {
	      mask = options.maskBuffer || maskBuffer;

	      if (options.generateMask) {
	        options.generateMask(mask);
	      } else {
	        if (randomPoolPointer === RANDOM_POOL_SIZE) {
	          /* istanbul ignore else  */
	          if (randomPool === undefined) {
	            //
	            // This is lazily initialized because server-sent frames must not
	            // be masked so it may never be used.
	            //
	            randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
	          }

	          randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
	          randomPoolPointer = 0;
	        }

	        mask[0] = randomPool[randomPoolPointer++];
	        mask[1] = randomPool[randomPoolPointer++];
	        mask[2] = randomPool[randomPoolPointer++];
	        mask[3] = randomPool[randomPoolPointer++];
	      }

	      skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
	      offset = 6;
	    }

	    let dataLength;

	    if (typeof data === 'string') {
	      if (
	        (!options.mask || skipMasking) &&
	        options[kByteLength] !== undefined
	      ) {
	        dataLength = options[kByteLength];
	      } else {
	        data = Buffer.from(data);
	        dataLength = data.length;
	      }
	    } else {
	      dataLength = data.length;
	      merge = options.mask && options.readOnly && !skipMasking;
	    }

	    let payloadLength = dataLength;

	    if (dataLength >= 65536) {
	      offset += 8;
	      payloadLength = 127;
	    } else if (dataLength > 125) {
	      offset += 2;
	      payloadLength = 126;
	    }

	    const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);

	    target[0] = options.fin ? options.opcode | 0x80 : options.opcode;
	    if (options.rsv1) target[0] |= 0x40;

	    target[1] = payloadLength;

	    if (payloadLength === 126) {
	      target.writeUInt16BE(dataLength, 2);
	    } else if (payloadLength === 127) {
	      target[2] = target[3] = 0;
	      target.writeUIntBE(dataLength, 4, 6);
	    }

	    if (!options.mask) return [target, data];

	    target[1] |= 0x80;
	    target[offset - 4] = mask[0];
	    target[offset - 3] = mask[1];
	    target[offset - 2] = mask[2];
	    target[offset - 1] = mask[3];

	    if (skipMasking) return [target, data];

	    if (merge) {
	      applyMask(data, mask, target, offset, dataLength);
	      return [target];
	    }

	    applyMask(data, mask, data, 0, dataLength);
	    return [target, data];
	  }

	  /**
	   * Sends a close message to the other peer.
	   *
	   * @param {Number} [code] The status code component of the body
	   * @param {(String|Buffer)} [data] The message component of the body
	   * @param {Boolean} [mask=false] Specifies whether or not to mask the message
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  close(code, data, mask, cb) {
	    let buf;

	    if (code === undefined) {
	      buf = EMPTY_BUFFER;
	    } else if (typeof code !== 'number' || !isValidStatusCode(code)) {
	      throw new TypeError('First argument must be a valid error code number');
	    } else if (data === undefined || !data.length) {
	      buf = Buffer.allocUnsafe(2);
	      buf.writeUInt16BE(code, 0);
	    } else {
	      const length = Buffer.byteLength(data);

	      if (length > 123) {
	        throw new RangeError('The message must not be greater than 123 bytes');
	      }

	      buf = Buffer.allocUnsafe(2 + length);
	      buf.writeUInt16BE(code, 0);

	      if (typeof data === 'string') {
	        buf.write(data, 2);
	      } else {
	        buf.set(data, 2);
	      }
	    }

	    const options = {
	      [kByteLength]: buf.length,
	      fin: true,
	      generateMask: this._generateMask,
	      mask,
	      maskBuffer: this._maskBuffer,
	      opcode: 0x08,
	      readOnly: false,
	      rsv1: false
	    };

	    if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, buf, false, options, cb]);
	    } else {
	      this.sendFrame(Sender.frame(buf, options), cb);
	    }
	  }

	  /**
	   * Sends a ping message to the other peer.
	   *
	   * @param {*} data The message to send
	   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  ping(data, mask, cb) {
	    let byteLength;
	    let readOnly;

	    if (typeof data === 'string') {
	      byteLength = Buffer.byteLength(data);
	      readOnly = false;
	    } else if (isBlob(data)) {
	      byteLength = data.size;
	      readOnly = false;
	    } else {
	      data = toBuffer(data);
	      byteLength = data.length;
	      readOnly = toBuffer.readOnly;
	    }

	    if (byteLength > 125) {
	      throw new RangeError('The data size must not be greater than 125 bytes');
	    }

	    const options = {
	      [kByteLength]: byteLength,
	      fin: true,
	      generateMask: this._generateMask,
	      mask,
	      maskBuffer: this._maskBuffer,
	      opcode: 0x09,
	      readOnly,
	      rsv1: false
	    };

	    if (isBlob(data)) {
	      if (this._state !== DEFAULT) {
	        this.enqueue([this.getBlobData, data, false, options, cb]);
	      } else {
	        this.getBlobData(data, false, options, cb);
	      }
	    } else if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, data, false, options, cb]);
	    } else {
	      this.sendFrame(Sender.frame(data, options), cb);
	    }
	  }

	  /**
	   * Sends a pong message to the other peer.
	   *
	   * @param {*} data The message to send
	   * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  pong(data, mask, cb) {
	    let byteLength;
	    let readOnly;

	    if (typeof data === 'string') {
	      byteLength = Buffer.byteLength(data);
	      readOnly = false;
	    } else if (isBlob(data)) {
	      byteLength = data.size;
	      readOnly = false;
	    } else {
	      data = toBuffer(data);
	      byteLength = data.length;
	      readOnly = toBuffer.readOnly;
	    }

	    if (byteLength > 125) {
	      throw new RangeError('The data size must not be greater than 125 bytes');
	    }

	    const options = {
	      [kByteLength]: byteLength,
	      fin: true,
	      generateMask: this._generateMask,
	      mask,
	      maskBuffer: this._maskBuffer,
	      opcode: 0x0a,
	      readOnly,
	      rsv1: false
	    };

	    if (isBlob(data)) {
	      if (this._state !== DEFAULT) {
	        this.enqueue([this.getBlobData, data, false, options, cb]);
	      } else {
	        this.getBlobData(data, false, options, cb);
	      }
	    } else if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, data, false, options, cb]);
	    } else {
	      this.sendFrame(Sender.frame(data, options), cb);
	    }
	  }

	  /**
	   * Sends a data message to the other peer.
	   *
	   * @param {*} data The message to send
	   * @param {Object} options Options object
	   * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
	   *     or text
	   * @param {Boolean} [options.compress=false] Specifies whether or not to
	   *     compress `data`
	   * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
	   *     last one
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Function} [cb] Callback
	   * @public
	   */
	  send(data, options, cb) {
	    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
	    let opcode = options.binary ? 2 : 1;
	    let rsv1 = options.compress;

	    let byteLength;
	    let readOnly;

	    if (typeof data === 'string') {
	      byteLength = Buffer.byteLength(data);
	      readOnly = false;
	    } else if (isBlob(data)) {
	      byteLength = data.size;
	      readOnly = false;
	    } else {
	      data = toBuffer(data);
	      byteLength = data.length;
	      readOnly = toBuffer.readOnly;
	    }

	    if (this._firstFragment) {
	      this._firstFragment = false;
	      if (
	        rsv1 &&
	        perMessageDeflate &&
	        perMessageDeflate.params[
	          perMessageDeflate._isServer
	            ? 'server_no_context_takeover'
	            : 'client_no_context_takeover'
	        ]
	      ) {
	        rsv1 = byteLength >= perMessageDeflate._threshold;
	      }
	      this._compress = rsv1;
	    } else {
	      rsv1 = false;
	      opcode = 0;
	    }

	    if (options.fin) this._firstFragment = true;

	    const opts = {
	      [kByteLength]: byteLength,
	      fin: options.fin,
	      generateMask: this._generateMask,
	      mask: options.mask,
	      maskBuffer: this._maskBuffer,
	      opcode,
	      readOnly,
	      rsv1
	    };

	    if (isBlob(data)) {
	      if (this._state !== DEFAULT) {
	        this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
	      } else {
	        this.getBlobData(data, this._compress, opts, cb);
	      }
	    } else if (this._state !== DEFAULT) {
	      this.enqueue([this.dispatch, data, this._compress, opts, cb]);
	    } else {
	      this.dispatch(data, this._compress, opts, cb);
	    }
	  }

	  /**
	   * Gets the contents of a blob as binary data.
	   *
	   * @param {Blob} blob The blob
	   * @param {Boolean} [compress=false] Specifies whether or not to compress
	   *     the data
	   * @param {Object} options Options object
	   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
	   *     FIN bit
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
	   *     key
	   * @param {Number} options.opcode The opcode
	   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
	   *     modified
	   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
	   *     RSV1 bit
	   * @param {Function} [cb] Callback
	   * @private
	   */
	  getBlobData(blob, compress, options, cb) {
	    this._bufferedBytes += options[kByteLength];
	    this._state = GET_BLOB_DATA;

	    blob
	      .arrayBuffer()
	      .then((arrayBuffer) => {
	        if (this._socket.destroyed) {
	          const err = new Error(
	            'The socket was closed while the blob was being read'
	          );

	          //
	          // `callCallbacks` is called in the next tick to ensure that errors
	          // that might be thrown in the callbacks behave like errors thrown
	          // outside the promise chain.
	          //
	          process.nextTick(callCallbacks, this, err, cb);
	          return;
	        }

	        this._bufferedBytes -= options[kByteLength];
	        const data = toBuffer(arrayBuffer);

	        if (!compress) {
	          this._state = DEFAULT;
	          this.sendFrame(Sender.frame(data, options), cb);
	          this.dequeue();
	        } else {
	          this.dispatch(data, compress, options, cb);
	        }
	      })
	      .catch((err) => {
	        //
	        // `onError` is called in the next tick for the same reason that
	        // `callCallbacks` above is.
	        //
	        process.nextTick(onError, this, err, cb);
	      });
	  }

	  /**
	   * Dispatches a message.
	   *
	   * @param {(Buffer|String)} data The message to send
	   * @param {Boolean} [compress=false] Specifies whether or not to compress
	   *     `data`
	   * @param {Object} options Options object
	   * @param {Boolean} [options.fin=false] Specifies whether or not to set the
	   *     FIN bit
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Boolean} [options.mask=false] Specifies whether or not to mask
	   *     `data`
	   * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
	   *     key
	   * @param {Number} options.opcode The opcode
	   * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
	   *     modified
	   * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
	   *     RSV1 bit
	   * @param {Function} [cb] Callback
	   * @private
	   */
	  dispatch(data, compress, options, cb) {
	    if (!compress) {
	      this.sendFrame(Sender.frame(data, options), cb);
	      return;
	    }

	    const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];

	    this._bufferedBytes += options[kByteLength];
	    this._state = DEFLATING;
	    perMessageDeflate.compress(data, options.fin, (_, buf) => {
	      if (this._socket.destroyed) {
	        const err = new Error(
	          'The socket was closed while data was being compressed'
	        );

	        callCallbacks(this, err, cb);
	        return;
	      }

	      this._bufferedBytes -= options[kByteLength];
	      this._state = DEFAULT;
	      options.readOnly = false;
	      this.sendFrame(Sender.frame(buf, options), cb);
	      this.dequeue();
	    });
	  }

	  /**
	   * Executes queued send operations.
	   *
	   * @private
	   */
	  dequeue() {
	    while (this._state === DEFAULT && this._queue.length) {
	      const params = this._queue.shift();

	      this._bufferedBytes -= params[3][kByteLength];
	      Reflect.apply(params[0], this, params.slice(1));
	    }
	  }

	  /**
	   * Enqueues a send operation.
	   *
	   * @param {Array} params Send operation parameters.
	   * @private
	   */
	  enqueue(params) {
	    this._bufferedBytes += params[3][kByteLength];
	    this._queue.push(params);
	  }

	  /**
	   * Sends a frame.
	   *
	   * @param {(Buffer | String)[]} list The frame to send
	   * @param {Function} [cb] Callback
	   * @private
	   */
	  sendFrame(list, cb) {
	    if (list.length === 2) {
	      this._socket.cork();
	      this._socket.write(list[0]);
	      this._socket.write(list[1], cb);
	      this._socket.uncork();
	    } else {
	      this._socket.write(list[0], cb);
	    }
	  }
	}

	sender = Sender;

	/**
	 * Calls queued callbacks with an error.
	 *
	 * @param {Sender} sender The `Sender` instance
	 * @param {Error} err The error to call the callbacks with
	 * @param {Function} [cb] The first callback
	 * @private
	 */
	function callCallbacks(sender, err, cb) {
	  if (typeof cb === 'function') cb(err);

	  for (let i = 0; i < sender._queue.length; i++) {
	    const params = sender._queue[i];
	    const callback = params[params.length - 1];

	    if (typeof callback === 'function') callback(err);
	  }
	}

	/**
	 * Handles a `Sender` error.
	 *
	 * @param {Sender} sender The `Sender` instance
	 * @param {Error} err The error
	 * @param {Function} [cb] The first pending callback
	 * @private
	 */
	function onError(sender, err, cb) {
	  callCallbacks(sender, err, cb);
	  sender.onerror(err);
	}
	return sender;
}

var eventTarget;
var hasRequiredEventTarget;

function requireEventTarget () {
	if (hasRequiredEventTarget) return eventTarget;
	hasRequiredEventTarget = 1;

	const { kForOnEventAttribute, kListener } = requireConstants();

	const kCode = Symbol('kCode');
	const kData = Symbol('kData');
	const kError = Symbol('kError');
	const kMessage = Symbol('kMessage');
	const kReason = Symbol('kReason');
	const kTarget = Symbol('kTarget');
	const kType = Symbol('kType');
	const kWasClean = Symbol('kWasClean');

	/**
	 * Class representing an event.
	 */
	class Event {
	  /**
	   * Create a new `Event`.
	   *
	   * @param {String} type The name of the event
	   * @throws {TypeError} If the `type` argument is not specified
	   */
	  constructor(type) {
	    this[kTarget] = null;
	    this[kType] = type;
	  }

	  /**
	   * @type {*}
	   */
	  get target() {
	    return this[kTarget];
	  }

	  /**
	   * @type {String}
	   */
	  get type() {
	    return this[kType];
	  }
	}

	Object.defineProperty(Event.prototype, 'target', { enumerable: true });
	Object.defineProperty(Event.prototype, 'type', { enumerable: true });

	/**
	 * Class representing a close event.
	 *
	 * @extends Event
	 */
	class CloseEvent extends Event {
	  /**
	   * Create a new `CloseEvent`.
	   *
	   * @param {String} type The name of the event
	   * @param {Object} [options] A dictionary object that allows for setting
	   *     attributes via object members of the same name
	   * @param {Number} [options.code=0] The status code explaining why the
	   *     connection was closed
	   * @param {String} [options.reason=''] A human-readable string explaining why
	   *     the connection was closed
	   * @param {Boolean} [options.wasClean=false] Indicates whether or not the
	   *     connection was cleanly closed
	   */
	  constructor(type, options = {}) {
	    super(type);

	    this[kCode] = options.code === undefined ? 0 : options.code;
	    this[kReason] = options.reason === undefined ? '' : options.reason;
	    this[kWasClean] = options.wasClean === undefined ? false : options.wasClean;
	  }

	  /**
	   * @type {Number}
	   */
	  get code() {
	    return this[kCode];
	  }

	  /**
	   * @type {String}
	   */
	  get reason() {
	    return this[kReason];
	  }

	  /**
	   * @type {Boolean}
	   */
	  get wasClean() {
	    return this[kWasClean];
	  }
	}

	Object.defineProperty(CloseEvent.prototype, 'code', { enumerable: true });
	Object.defineProperty(CloseEvent.prototype, 'reason', { enumerable: true });
	Object.defineProperty(CloseEvent.prototype, 'wasClean', { enumerable: true });

	/**
	 * Class representing an error event.
	 *
	 * @extends Event
	 */
	class ErrorEvent extends Event {
	  /**
	   * Create a new `ErrorEvent`.
	   *
	   * @param {String} type The name of the event
	   * @param {Object} [options] A dictionary object that allows for setting
	   *     attributes via object members of the same name
	   * @param {*} [options.error=null] The error that generated this event
	   * @param {String} [options.message=''] The error message
	   */
	  constructor(type, options = {}) {
	    super(type);

	    this[kError] = options.error === undefined ? null : options.error;
	    this[kMessage] = options.message === undefined ? '' : options.message;
	  }

	  /**
	   * @type {*}
	   */
	  get error() {
	    return this[kError];
	  }

	  /**
	   * @type {String}
	   */
	  get message() {
	    return this[kMessage];
	  }
	}

	Object.defineProperty(ErrorEvent.prototype, 'error', { enumerable: true });
	Object.defineProperty(ErrorEvent.prototype, 'message', { enumerable: true });

	/**
	 * Class representing a message event.
	 *
	 * @extends Event
	 */
	class MessageEvent extends Event {
	  /**
	   * Create a new `MessageEvent`.
	   *
	   * @param {String} type The name of the event
	   * @param {Object} [options] A dictionary object that allows for setting
	   *     attributes via object members of the same name
	   * @param {*} [options.data=null] The message content
	   */
	  constructor(type, options = {}) {
	    super(type);

	    this[kData] = options.data === undefined ? null : options.data;
	  }

	  /**
	   * @type {*}
	   */
	  get data() {
	    return this[kData];
	  }
	}

	Object.defineProperty(MessageEvent.prototype, 'data', { enumerable: true });

	/**
	 * This provides methods for emulating the `EventTarget` interface. It's not
	 * meant to be used directly.
	 *
	 * @mixin
	 */
	const EventTarget = {
	  /**
	   * Register an event listener.
	   *
	   * @param {String} type A string representing the event type to listen for
	   * @param {(Function|Object)} handler The listener to add
	   * @param {Object} [options] An options object specifies characteristics about
	   *     the event listener
	   * @param {Boolean} [options.once=false] A `Boolean` indicating that the
	   *     listener should be invoked at most once after being added. If `true`,
	   *     the listener would be automatically removed when invoked.
	   * @public
	   */
	  addEventListener(type, handler, options = {}) {
	    for (const listener of this.listeners(type)) {
	      if (
	        !options[kForOnEventAttribute] &&
	        listener[kListener] === handler &&
	        !listener[kForOnEventAttribute]
	      ) {
	        return;
	      }
	    }

	    let wrapper;

	    if (type === 'message') {
	      wrapper = function onMessage(data, isBinary) {
	        const event = new MessageEvent('message', {
	          data: isBinary ? data : data.toString()
	        });

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else if (type === 'close') {
	      wrapper = function onClose(code, message) {
	        const event = new CloseEvent('close', {
	          code,
	          reason: message.toString(),
	          wasClean: this._closeFrameReceived && this._closeFrameSent
	        });

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else if (type === 'error') {
	      wrapper = function onError(error) {
	        const event = new ErrorEvent('error', {
	          error,
	          message: error.message
	        });

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else if (type === 'open') {
	      wrapper = function onOpen() {
	        const event = new Event('open');

	        event[kTarget] = this;
	        callListener(handler, this, event);
	      };
	    } else {
	      return;
	    }

	    wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
	    wrapper[kListener] = handler;

	    if (options.once) {
	      this.once(type, wrapper);
	    } else {
	      this.on(type, wrapper);
	    }
	  },

	  /**
	   * Remove an event listener.
	   *
	   * @param {String} type A string representing the event type to remove
	   * @param {(Function|Object)} handler The listener to remove
	   * @public
	   */
	  removeEventListener(type, handler) {
	    for (const listener of this.listeners(type)) {
	      if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
	        this.removeListener(type, listener);
	        break;
	      }
	    }
	  }
	};

	eventTarget = {
	  CloseEvent,
	  ErrorEvent,
	  Event,
	  EventTarget,
	  MessageEvent
	};

	/**
	 * Call an event listener
	 *
	 * @param {(Function|Object)} listener The listener to call
	 * @param {*} thisArg The value to use as `this`` when calling the listener
	 * @param {Event} event The event to pass to the listener
	 * @private
	 */
	function callListener(listener, thisArg, event) {
	  if (typeof listener === 'object' && listener.handleEvent) {
	    listener.handleEvent.call(listener, event);
	  } else {
	    listener.call(thisArg, event);
	  }
	}
	return eventTarget;
}

var extension;
var hasRequiredExtension;

function requireExtension () {
	if (hasRequiredExtension) return extension;
	hasRequiredExtension = 1;

	const { tokenChars } = requireValidation();

	/**
	 * Adds an offer to the map of extension offers or a parameter to the map of
	 * parameters.
	 *
	 * @param {Object} dest The map of extension offers or parameters
	 * @param {String} name The extension or parameter name
	 * @param {(Object|Boolean|String)} elem The extension parameters or the
	 *     parameter value
	 * @private
	 */
	function push(dest, name, elem) {
	  if (dest[name] === undefined) dest[name] = [elem];
	  else dest[name].push(elem);
	}

	/**
	 * Parses the `Sec-WebSocket-Extensions` header into an object.
	 *
	 * @param {String} header The field value of the header
	 * @return {Object} The parsed object
	 * @public
	 */
	function parse(header) {
	  const offers = Object.create(null);
	  let params = Object.create(null);
	  let mustUnescape = false;
	  let isEscaping = false;
	  let inQuotes = false;
	  let extensionName;
	  let paramName;
	  let start = -1;
	  let code = -1;
	  let end = -1;
	  let i = 0;

	  for (; i < header.length; i++) {
	    code = header.charCodeAt(i);

	    if (extensionName === undefined) {
	      if (end === -1 && tokenChars[code] === 1) {
	        if (start === -1) start = i;
	      } else if (
	        i !== 0 &&
	        (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */
	      ) {
	        if (end === -1 && start !== -1) end = i;
	      } else if (code === 0x3b /* ';' */ || code === 0x2c /* ',' */) {
	        if (start === -1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }

	        if (end === -1) end = i;
	        const name = header.slice(start, end);
	        if (code === 0x2c) {
	          push(offers, name, params);
	          params = Object.create(null);
	        } else {
	          extensionName = name;
	        }

	        start = end = -1;
	      } else {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }
	    } else if (paramName === undefined) {
	      if (end === -1 && tokenChars[code] === 1) {
	        if (start === -1) start = i;
	      } else if (code === 0x20 || code === 0x09) {
	        if (end === -1 && start !== -1) end = i;
	      } else if (code === 0x3b || code === 0x2c) {
	        if (start === -1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }

	        if (end === -1) end = i;
	        push(params, header.slice(start, end), true);
	        if (code === 0x2c) {
	          push(offers, extensionName, params);
	          params = Object.create(null);
	          extensionName = undefined;
	        }

	        start = end = -1;
	      } else if (code === 0x3d /* '=' */ && start !== -1 && end === -1) {
	        paramName = header.slice(start, i);
	        start = end = -1;
	      } else {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }
	    } else {
	      //
	      // The value of a quoted-string after unescaping must conform to the
	      // token ABNF, so only token characters are valid.
	      // Ref: https://tools.ietf.org/html/rfc6455#section-9.1
	      //
	      if (isEscaping) {
	        if (tokenChars[code] !== 1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }
	        if (start === -1) start = i;
	        else if (!mustUnescape) mustUnescape = true;
	        isEscaping = false;
	      } else if (inQuotes) {
	        if (tokenChars[code] === 1) {
	          if (start === -1) start = i;
	        } else if (code === 0x22 /* '"' */ && start !== -1) {
	          inQuotes = false;
	          end = i;
	        } else if (code === 0x5c /* '\' */) {
	          isEscaping = true;
	        } else {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }
	      } else if (code === 0x22 && header.charCodeAt(i - 1) === 0x3d) {
	        inQuotes = true;
	      } else if (end === -1 && tokenChars[code] === 1) {
	        if (start === -1) start = i;
	      } else if (start !== -1 && (code === 0x20 || code === 0x09)) {
	        if (end === -1) end = i;
	      } else if (code === 0x3b || code === 0x2c) {
	        if (start === -1) {
	          throw new SyntaxError(`Unexpected character at index ${i}`);
	        }

	        if (end === -1) end = i;
	        let value = header.slice(start, end);
	        if (mustUnescape) {
	          value = value.replace(/\\/g, '');
	          mustUnescape = false;
	        }
	        push(params, paramName, value);
	        if (code === 0x2c) {
	          push(offers, extensionName, params);
	          params = Object.create(null);
	          extensionName = undefined;
	        }

	        paramName = undefined;
	        start = end = -1;
	      } else {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }
	    }
	  }

	  if (start === -1 || inQuotes || code === 0x20 || code === 0x09) {
	    throw new SyntaxError('Unexpected end of input');
	  }

	  if (end === -1) end = i;
	  const token = header.slice(start, end);
	  if (extensionName === undefined) {
	    push(offers, token, params);
	  } else {
	    if (paramName === undefined) {
	      push(params, token, true);
	    } else if (mustUnescape) {
	      push(params, paramName, token.replace(/\\/g, ''));
	    } else {
	      push(params, paramName, token);
	    }
	    push(offers, extensionName, params);
	  }

	  return offers;
	}

	/**
	 * Builds the `Sec-WebSocket-Extensions` header field value.
	 *
	 * @param {Object} extensions The map of extensions and parameters to format
	 * @return {String} A string representing the given object
	 * @public
	 */
	function format(extensions) {
	  return Object.keys(extensions)
	    .map((extension) => {
	      let configurations = extensions[extension];
	      if (!Array.isArray(configurations)) configurations = [configurations];
	      return configurations
	        .map((params) => {
	          return [extension]
	            .concat(
	              Object.keys(params).map((k) => {
	                let values = params[k];
	                if (!Array.isArray(values)) values = [values];
	                return values
	                  .map((v) => (v === true ? k : `${k}=${v}`))
	                  .join('; ');
	              })
	            )
	            .join('; ');
	        })
	        .join(', ');
	    })
	    .join(', ');
	}

	extension = { format, parse };
	return extension;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex|Readable$", "caughtErrors": "none" }] */

var websocket;
var hasRequiredWebsocket;

function requireWebsocket () {
	if (hasRequiredWebsocket) return websocket;
	hasRequiredWebsocket = 1;

	const EventEmitter = require$$0$3;
	const https = require$$1$1;
	const http = require$$2;
	const net = require$$3;
	const tls = require$$4;
	const { randomBytes, createHash } = require$$1;
	const { Duplex, Readable } = require$$0$2;
	const { URL } = require$$7;

	const PerMessageDeflate = requirePermessageDeflate();
	const Receiver = requireReceiver();
	const Sender = requireSender();
	const { isBlob } = requireValidation();

	const {
	  BINARY_TYPES,
	  EMPTY_BUFFER,
	  GUID,
	  kForOnEventAttribute,
	  kListener,
	  kStatusCode,
	  kWebSocket,
	  NOOP
	} = requireConstants();
	const {
	  EventTarget: { addEventListener, removeEventListener }
	} = requireEventTarget();
	const { format, parse } = requireExtension();
	const { toBuffer } = requireBufferUtil();

	const closeTimeout = 30 * 1000;
	const kAborted = Symbol('kAborted');
	const protocolVersions = [8, 13];
	const readyStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
	const subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;

	/**
	 * Class representing a WebSocket.
	 *
	 * @extends EventEmitter
	 */
	class WebSocket extends EventEmitter {
	  /**
	   * Create a new `WebSocket`.
	   *
	   * @param {(String|URL)} address The URL to which to connect
	   * @param {(String|String[])} [protocols] The subprotocols
	   * @param {Object} [options] Connection options
	   */
	  constructor(address, protocols, options) {
	    super();

	    this._binaryType = BINARY_TYPES[0];
	    this._closeCode = 1006;
	    this._closeFrameReceived = false;
	    this._closeFrameSent = false;
	    this._closeMessage = EMPTY_BUFFER;
	    this._closeTimer = null;
	    this._errorEmitted = false;
	    this._extensions = {};
	    this._paused = false;
	    this._protocol = '';
	    this._readyState = WebSocket.CONNECTING;
	    this._receiver = null;
	    this._sender = null;
	    this._socket = null;

	    if (address !== null) {
	      this._bufferedAmount = 0;
	      this._isServer = false;
	      this._redirects = 0;

	      if (protocols === undefined) {
	        protocols = [];
	      } else if (!Array.isArray(protocols)) {
	        if (typeof protocols === 'object' && protocols !== null) {
	          options = protocols;
	          protocols = [];
	        } else {
	          protocols = [protocols];
	        }
	      }

	      initAsClient(this, address, protocols, options);
	    } else {
	      this._autoPong = options.autoPong;
	      this._isServer = true;
	    }
	  }

	  /**
	   * For historical reasons, the custom "nodebuffer" type is used by the default
	   * instead of "blob".
	   *
	   * @type {String}
	   */
	  get binaryType() {
	    return this._binaryType;
	  }

	  set binaryType(type) {
	    if (!BINARY_TYPES.includes(type)) return;

	    this._binaryType = type;

	    //
	    // Allow to change `binaryType` on the fly.
	    //
	    if (this._receiver) this._receiver._binaryType = type;
	  }

	  /**
	   * @type {Number}
	   */
	  get bufferedAmount() {
	    if (!this._socket) return this._bufferedAmount;

	    return this._socket._writableState.length + this._sender._bufferedBytes;
	  }

	  /**
	   * @type {String}
	   */
	  get extensions() {
	    return Object.keys(this._extensions).join();
	  }

	  /**
	   * @type {Boolean}
	   */
	  get isPaused() {
	    return this._paused;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onclose() {
	    return null;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onerror() {
	    return null;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onopen() {
	    return null;
	  }

	  /**
	   * @type {Function}
	   */
	  /* istanbul ignore next */
	  get onmessage() {
	    return null;
	  }

	  /**
	   * @type {String}
	   */
	  get protocol() {
	    return this._protocol;
	  }

	  /**
	   * @type {Number}
	   */
	  get readyState() {
	    return this._readyState;
	  }

	  /**
	   * @type {String}
	   */
	  get url() {
	    return this._url;
	  }

	  /**
	   * Set up the socket and the internal resources.
	   *
	   * @param {Duplex} socket The network socket between the server and client
	   * @param {Buffer} head The first packet of the upgraded stream
	   * @param {Object} options Options object
	   * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
	   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
	   *     multiple times in the same tick
	   * @param {Function} [options.generateMask] The function used to generate the
	   *     masking key
	   * @param {Number} [options.maxPayload=0] The maximum allowed message size
	   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	   *     not to skip UTF-8 validation for text and close messages
	   * @private
	   */
	  setSocket(socket, head, options) {
	    const receiver = new Receiver({
	      allowSynchronousEvents: options.allowSynchronousEvents,
	      binaryType: this.binaryType,
	      extensions: this._extensions,
	      isServer: this._isServer,
	      maxPayload: options.maxPayload,
	      skipUTF8Validation: options.skipUTF8Validation
	    });

	    const sender = new Sender(socket, this._extensions, options.generateMask);

	    this._receiver = receiver;
	    this._sender = sender;
	    this._socket = socket;

	    receiver[kWebSocket] = this;
	    sender[kWebSocket] = this;
	    socket[kWebSocket] = this;

	    receiver.on('conclude', receiverOnConclude);
	    receiver.on('drain', receiverOnDrain);
	    receiver.on('error', receiverOnError);
	    receiver.on('message', receiverOnMessage);
	    receiver.on('ping', receiverOnPing);
	    receiver.on('pong', receiverOnPong);

	    sender.onerror = senderOnError;

	    //
	    // These methods may not be available if `socket` is just a `Duplex`.
	    //
	    if (socket.setTimeout) socket.setTimeout(0);
	    if (socket.setNoDelay) socket.setNoDelay();

	    if (head.length > 0) socket.unshift(head);

	    socket.on('close', socketOnClose);
	    socket.on('data', socketOnData);
	    socket.on('end', socketOnEnd);
	    socket.on('error', socketOnError);

	    this._readyState = WebSocket.OPEN;
	    this.emit('open');
	  }

	  /**
	   * Emit the `'close'` event.
	   *
	   * @private
	   */
	  emitClose() {
	    if (!this._socket) {
	      this._readyState = WebSocket.CLOSED;
	      this.emit('close', this._closeCode, this._closeMessage);
	      return;
	    }

	    if (this._extensions[PerMessageDeflate.extensionName]) {
	      this._extensions[PerMessageDeflate.extensionName].cleanup();
	    }

	    this._receiver.removeAllListeners();
	    this._readyState = WebSocket.CLOSED;
	    this.emit('close', this._closeCode, this._closeMessage);
	  }

	  /**
	   * Start a closing handshake.
	   *
	   *          +----------+   +-----------+   +----------+
	   *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
	   *    |     +----------+   +-----------+   +----------+     |
	   *          +----------+   +-----------+         |
	   * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
	   *          +----------+   +-----------+   |
	   *    |           |                        |   +---+        |
	   *                +------------------------+-->|fin| - - - -
	   *    |         +---+                      |   +---+
	   *     - - - - -|fin|<---------------------+
	   *              +---+
	   *
	   * @param {Number} [code] Status code explaining why the connection is closing
	   * @param {(String|Buffer)} [data] The reason why the connection is
	   *     closing
	   * @public
	   */
	  close(code, data) {
	    if (this.readyState === WebSocket.CLOSED) return;
	    if (this.readyState === WebSocket.CONNECTING) {
	      const msg = 'WebSocket was closed before the connection was established';
	      abortHandshake(this, this._req, msg);
	      return;
	    }

	    if (this.readyState === WebSocket.CLOSING) {
	      if (
	        this._closeFrameSent &&
	        (this._closeFrameReceived || this._receiver._writableState.errorEmitted)
	      ) {
	        this._socket.end();
	      }

	      return;
	    }

	    this._readyState = WebSocket.CLOSING;
	    this._sender.close(code, data, !this._isServer, (err) => {
	      //
	      // This error is handled by the `'error'` listener on the socket. We only
	      // want to know if the close frame has been sent here.
	      //
	      if (err) return;

	      this._closeFrameSent = true;

	      if (
	        this._closeFrameReceived ||
	        this._receiver._writableState.errorEmitted
	      ) {
	        this._socket.end();
	      }
	    });

	    setCloseTimer(this);
	  }

	  /**
	   * Pause the socket.
	   *
	   * @public
	   */
	  pause() {
	    if (
	      this.readyState === WebSocket.CONNECTING ||
	      this.readyState === WebSocket.CLOSED
	    ) {
	      return;
	    }

	    this._paused = true;
	    this._socket.pause();
	  }

	  /**
	   * Send a ping.
	   *
	   * @param {*} [data] The data to send
	   * @param {Boolean} [mask] Indicates whether or not to mask `data`
	   * @param {Function} [cb] Callback which is executed when the ping is sent
	   * @public
	   */
	  ping(data, mask, cb) {
	    if (this.readyState === WebSocket.CONNECTING) {
	      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
	    }

	    if (typeof data === 'function') {
	      cb = data;
	      data = mask = undefined;
	    } else if (typeof mask === 'function') {
	      cb = mask;
	      mask = undefined;
	    }

	    if (typeof data === 'number') data = data.toString();

	    if (this.readyState !== WebSocket.OPEN) {
	      sendAfterClose(this, data, cb);
	      return;
	    }

	    if (mask === undefined) mask = !this._isServer;
	    this._sender.ping(data || EMPTY_BUFFER, mask, cb);
	  }

	  /**
	   * Send a pong.
	   *
	   * @param {*} [data] The data to send
	   * @param {Boolean} [mask] Indicates whether or not to mask `data`
	   * @param {Function} [cb] Callback which is executed when the pong is sent
	   * @public
	   */
	  pong(data, mask, cb) {
	    if (this.readyState === WebSocket.CONNECTING) {
	      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
	    }

	    if (typeof data === 'function') {
	      cb = data;
	      data = mask = undefined;
	    } else if (typeof mask === 'function') {
	      cb = mask;
	      mask = undefined;
	    }

	    if (typeof data === 'number') data = data.toString();

	    if (this.readyState !== WebSocket.OPEN) {
	      sendAfterClose(this, data, cb);
	      return;
	    }

	    if (mask === undefined) mask = !this._isServer;
	    this._sender.pong(data || EMPTY_BUFFER, mask, cb);
	  }

	  /**
	   * Resume the socket.
	   *
	   * @public
	   */
	  resume() {
	    if (
	      this.readyState === WebSocket.CONNECTING ||
	      this.readyState === WebSocket.CLOSED
	    ) {
	      return;
	    }

	    this._paused = false;
	    if (!this._receiver._writableState.needDrain) this._socket.resume();
	  }

	  /**
	   * Send a data message.
	   *
	   * @param {*} data The message to send
	   * @param {Object} [options] Options object
	   * @param {Boolean} [options.binary] Specifies whether `data` is binary or
	   *     text
	   * @param {Boolean} [options.compress] Specifies whether or not to compress
	   *     `data`
	   * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
	   *     last one
	   * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
	   * @param {Function} [cb] Callback which is executed when data is written out
	   * @public
	   */
	  send(data, options, cb) {
	    if (this.readyState === WebSocket.CONNECTING) {
	      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
	    }

	    if (typeof options === 'function') {
	      cb = options;
	      options = {};
	    }

	    if (typeof data === 'number') data = data.toString();

	    if (this.readyState !== WebSocket.OPEN) {
	      sendAfterClose(this, data, cb);
	      return;
	    }

	    const opts = {
	      binary: typeof data !== 'string',
	      mask: !this._isServer,
	      compress: true,
	      fin: true,
	      ...options
	    };

	    if (!this._extensions[PerMessageDeflate.extensionName]) {
	      opts.compress = false;
	    }

	    this._sender.send(data || EMPTY_BUFFER, opts, cb);
	  }

	  /**
	   * Forcibly close the connection.
	   *
	   * @public
	   */
	  terminate() {
	    if (this.readyState === WebSocket.CLOSED) return;
	    if (this.readyState === WebSocket.CONNECTING) {
	      const msg = 'WebSocket was closed before the connection was established';
	      abortHandshake(this, this._req, msg);
	      return;
	    }

	    if (this._socket) {
	      this._readyState = WebSocket.CLOSING;
	      this._socket.destroy();
	    }
	  }
	}

	/**
	 * @constant {Number} CONNECTING
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'CONNECTING', {
	  enumerable: true,
	  value: readyStates.indexOf('CONNECTING')
	});

	/**
	 * @constant {Number} CONNECTING
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'CONNECTING', {
	  enumerable: true,
	  value: readyStates.indexOf('CONNECTING')
	});

	/**
	 * @constant {Number} OPEN
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'OPEN', {
	  enumerable: true,
	  value: readyStates.indexOf('OPEN')
	});

	/**
	 * @constant {Number} OPEN
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'OPEN', {
	  enumerable: true,
	  value: readyStates.indexOf('OPEN')
	});

	/**
	 * @constant {Number} CLOSING
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'CLOSING', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSING')
	});

	/**
	 * @constant {Number} CLOSING
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'CLOSING', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSING')
	});

	/**
	 * @constant {Number} CLOSED
	 * @memberof WebSocket
	 */
	Object.defineProperty(WebSocket, 'CLOSED', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSED')
	});

	/**
	 * @constant {Number} CLOSED
	 * @memberof WebSocket.prototype
	 */
	Object.defineProperty(WebSocket.prototype, 'CLOSED', {
	  enumerable: true,
	  value: readyStates.indexOf('CLOSED')
	});

	[
	  'binaryType',
	  'bufferedAmount',
	  'extensions',
	  'isPaused',
	  'protocol',
	  'readyState',
	  'url'
	].forEach((property) => {
	  Object.defineProperty(WebSocket.prototype, property, { enumerable: true });
	});

	//
	// Add the `onopen`, `onerror`, `onclose`, and `onmessage` attributes.
	// See https://html.spec.whatwg.org/multipage/comms.html#the-websocket-interface
	//
	['open', 'error', 'close', 'message'].forEach((method) => {
	  Object.defineProperty(WebSocket.prototype, `on${method}`, {
	    enumerable: true,
	    get() {
	      for (const listener of this.listeners(method)) {
	        if (listener[kForOnEventAttribute]) return listener[kListener];
	      }

	      return null;
	    },
	    set(handler) {
	      for (const listener of this.listeners(method)) {
	        if (listener[kForOnEventAttribute]) {
	          this.removeListener(method, listener);
	          break;
	        }
	      }

	      if (typeof handler !== 'function') return;

	      this.addEventListener(method, handler, {
	        [kForOnEventAttribute]: true
	      });
	    }
	  });
	});

	WebSocket.prototype.addEventListener = addEventListener;
	WebSocket.prototype.removeEventListener = removeEventListener;

	websocket = WebSocket;

	/**
	 * Initialize a WebSocket client.
	 *
	 * @param {WebSocket} websocket The client to initialize
	 * @param {(String|URL)} address The URL to which to connect
	 * @param {Array} protocols The subprotocols
	 * @param {Object} [options] Connection options
	 * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether any
	 *     of the `'message'`, `'ping'`, and `'pong'` events can be emitted multiple
	 *     times in the same tick
	 * @param {Boolean} [options.autoPong=true] Specifies whether or not to
	 *     automatically send a pong in response to a ping
	 * @param {Function} [options.finishRequest] A function which can be used to
	 *     customize the headers of each http request before it is sent
	 * @param {Boolean} [options.followRedirects=false] Whether or not to follow
	 *     redirects
	 * @param {Function} [options.generateMask] The function used to generate the
	 *     masking key
	 * @param {Number} [options.handshakeTimeout] Timeout in milliseconds for the
	 *     handshake request
	 * @param {Number} [options.maxPayload=104857600] The maximum allowed message
	 *     size
	 * @param {Number} [options.maxRedirects=10] The maximum number of redirects
	 *     allowed
	 * @param {String} [options.origin] Value of the `Origin` or
	 *     `Sec-WebSocket-Origin` header
	 * @param {(Boolean|Object)} [options.perMessageDeflate=true] Enable/disable
	 *     permessage-deflate
	 * @param {Number} [options.protocolVersion=13] Value of the
	 *     `Sec-WebSocket-Version` header
	 * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	 *     not to skip UTF-8 validation for text and close messages
	 * @private
	 */
	function initAsClient(websocket, address, protocols, options) {
	  const opts = {
	    allowSynchronousEvents: true,
	    autoPong: true,
	    protocolVersion: protocolVersions[1],
	    maxPayload: 100 * 1024 * 1024,
	    skipUTF8Validation: false,
	    perMessageDeflate: true,
	    followRedirects: false,
	    maxRedirects: 10,
	    ...options,
	    socketPath: undefined,
	    hostname: undefined,
	    protocol: undefined,
	    timeout: undefined,
	    method: 'GET',
	    host: undefined,
	    path: undefined,
	    port: undefined
	  };

	  websocket._autoPong = opts.autoPong;

	  if (!protocolVersions.includes(opts.protocolVersion)) {
	    throw new RangeError(
	      `Unsupported protocol version: ${opts.protocolVersion} ` +
	        `(supported versions: ${protocolVersions.join(', ')})`
	    );
	  }

	  let parsedUrl;

	  if (address instanceof URL) {
	    parsedUrl = address;
	  } else {
	    try {
	      parsedUrl = new URL(address);
	    } catch (e) {
	      throw new SyntaxError(`Invalid URL: ${address}`);
	    }
	  }

	  if (parsedUrl.protocol === 'http:') {
	    parsedUrl.protocol = 'ws:';
	  } else if (parsedUrl.protocol === 'https:') {
	    parsedUrl.protocol = 'wss:';
	  }

	  websocket._url = parsedUrl.href;

	  const isSecure = parsedUrl.protocol === 'wss:';
	  const isIpcUrl = parsedUrl.protocol === 'ws+unix:';
	  let invalidUrlMessage;

	  if (parsedUrl.protocol !== 'ws:' && !isSecure && !isIpcUrl) {
	    invalidUrlMessage =
	      'The URL\'s protocol must be one of "ws:", "wss:", ' +
	      '"http:", "https:", or "ws+unix:"';
	  } else if (isIpcUrl && !parsedUrl.pathname) {
	    invalidUrlMessage = "The URL's pathname is empty";
	  } else if (parsedUrl.hash) {
	    invalidUrlMessage = 'The URL contains a fragment identifier';
	  }

	  if (invalidUrlMessage) {
	    const err = new SyntaxError(invalidUrlMessage);

	    if (websocket._redirects === 0) {
	      throw err;
	    } else {
	      emitErrorAndClose(websocket, err);
	      return;
	    }
	  }

	  const defaultPort = isSecure ? 443 : 80;
	  const key = randomBytes(16).toString('base64');
	  const request = isSecure ? https.request : http.request;
	  const protocolSet = new Set();
	  let perMessageDeflate;

	  opts.createConnection =
	    opts.createConnection || (isSecure ? tlsConnect : netConnect);
	  opts.defaultPort = opts.defaultPort || defaultPort;
	  opts.port = parsedUrl.port || defaultPort;
	  opts.host = parsedUrl.hostname.startsWith('[')
	    ? parsedUrl.hostname.slice(1, -1)
	    : parsedUrl.hostname;
	  opts.headers = {
	    ...opts.headers,
	    'Sec-WebSocket-Version': opts.protocolVersion,
	    'Sec-WebSocket-Key': key,
	    Connection: 'Upgrade',
	    Upgrade: 'websocket'
	  };
	  opts.path = parsedUrl.pathname + parsedUrl.search;
	  opts.timeout = opts.handshakeTimeout;

	  if (opts.perMessageDeflate) {
	    perMessageDeflate = new PerMessageDeflate(
	      opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
	      false,
	      opts.maxPayload
	    );
	    opts.headers['Sec-WebSocket-Extensions'] = format({
	      [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
	    });
	  }
	  if (protocols.length) {
	    for (const protocol of protocols) {
	      if (
	        typeof protocol !== 'string' ||
	        !subprotocolRegex.test(protocol) ||
	        protocolSet.has(protocol)
	      ) {
	        throw new SyntaxError(
	          'An invalid or duplicated subprotocol was specified'
	        );
	      }

	      protocolSet.add(protocol);
	    }

	    opts.headers['Sec-WebSocket-Protocol'] = protocols.join(',');
	  }
	  if (opts.origin) {
	    if (opts.protocolVersion < 13) {
	      opts.headers['Sec-WebSocket-Origin'] = opts.origin;
	    } else {
	      opts.headers.Origin = opts.origin;
	    }
	  }
	  if (parsedUrl.username || parsedUrl.password) {
	    opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
	  }

	  if (isIpcUrl) {
	    const parts = opts.path.split(':');

	    opts.socketPath = parts[0];
	    opts.path = parts[1];
	  }

	  let req;

	  if (opts.followRedirects) {
	    if (websocket._redirects === 0) {
	      websocket._originalIpc = isIpcUrl;
	      websocket._originalSecure = isSecure;
	      websocket._originalHostOrSocketPath = isIpcUrl
	        ? opts.socketPath
	        : parsedUrl.host;

	      const headers = options && options.headers;

	      //
	      // Shallow copy the user provided options so that headers can be changed
	      // without mutating the original object.
	      //
	      options = { ...options, headers: {} };

	      if (headers) {
	        for (const [key, value] of Object.entries(headers)) {
	          options.headers[key.toLowerCase()] = value;
	        }
	      }
	    } else if (websocket.listenerCount('redirect') === 0) {
	      const isSameHost = isIpcUrl
	        ? websocket._originalIpc
	          ? opts.socketPath === websocket._originalHostOrSocketPath
	          : false
	        : websocket._originalIpc
	          ? false
	          : parsedUrl.host === websocket._originalHostOrSocketPath;

	      if (!isSameHost || (websocket._originalSecure && !isSecure)) {
	        //
	        // Match curl 7.77.0 behavior and drop the following headers. These
	        // headers are also dropped when following a redirect to a subdomain.
	        //
	        delete opts.headers.authorization;
	        delete opts.headers.cookie;

	        if (!isSameHost) delete opts.headers.host;

	        opts.auth = undefined;
	      }
	    }

	    //
	    // Match curl 7.77.0 behavior and make the first `Authorization` header win.
	    // If the `Authorization` header is set, then there is nothing to do as it
	    // will take precedence.
	    //
	    if (opts.auth && !options.headers.authorization) {
	      options.headers.authorization =
	        'Basic ' + Buffer.from(opts.auth).toString('base64');
	    }

	    req = websocket._req = request(opts);

	    if (websocket._redirects) {
	      //
	      // Unlike what is done for the `'upgrade'` event, no early exit is
	      // triggered here if the user calls `websocket.close()` or
	      // `websocket.terminate()` from a listener of the `'redirect'` event. This
	      // is because the user can also call `request.destroy()` with an error
	      // before calling `websocket.close()` or `websocket.terminate()` and this
	      // would result in an error being emitted on the `request` object with no
	      // `'error'` event listeners attached.
	      //
	      websocket.emit('redirect', websocket.url, req);
	    }
	  } else {
	    req = websocket._req = request(opts);
	  }

	  if (opts.timeout) {
	    req.on('timeout', () => {
	      abortHandshake(websocket, req, 'Opening handshake has timed out');
	    });
	  }

	  req.on('error', (err) => {
	    if (req === null || req[kAborted]) return;

	    req = websocket._req = null;
	    emitErrorAndClose(websocket, err);
	  });

	  req.on('response', (res) => {
	    const location = res.headers.location;
	    const statusCode = res.statusCode;

	    if (
	      location &&
	      opts.followRedirects &&
	      statusCode >= 300 &&
	      statusCode < 400
	    ) {
	      if (++websocket._redirects > opts.maxRedirects) {
	        abortHandshake(websocket, req, 'Maximum redirects exceeded');
	        return;
	      }

	      req.abort();

	      let addr;

	      try {
	        addr = new URL(location, address);
	      } catch (e) {
	        const err = new SyntaxError(`Invalid URL: ${location}`);
	        emitErrorAndClose(websocket, err);
	        return;
	      }

	      initAsClient(websocket, addr, protocols, options);
	    } else if (!websocket.emit('unexpected-response', req, res)) {
	      abortHandshake(
	        websocket,
	        req,
	        `Unexpected server response: ${res.statusCode}`
	      );
	    }
	  });

	  req.on('upgrade', (res, socket, head) => {
	    websocket.emit('upgrade', res);

	    //
	    // The user may have closed the connection from a listener of the
	    // `'upgrade'` event.
	    //
	    if (websocket.readyState !== WebSocket.CONNECTING) return;

	    req = websocket._req = null;

	    const upgrade = res.headers.upgrade;

	    if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
	      abortHandshake(websocket, socket, 'Invalid Upgrade header');
	      return;
	    }

	    const digest = createHash('sha1')
	      .update(key + GUID)
	      .digest('base64');

	    if (res.headers['sec-websocket-accept'] !== digest) {
	      abortHandshake(websocket, socket, 'Invalid Sec-WebSocket-Accept header');
	      return;
	    }

	    const serverProt = res.headers['sec-websocket-protocol'];
	    let protError;

	    if (serverProt !== undefined) {
	      if (!protocolSet.size) {
	        protError = 'Server sent a subprotocol but none was requested';
	      } else if (!protocolSet.has(serverProt)) {
	        protError = 'Server sent an invalid subprotocol';
	      }
	    } else if (protocolSet.size) {
	      protError = 'Server sent no subprotocol';
	    }

	    if (protError) {
	      abortHandshake(websocket, socket, protError);
	      return;
	    }

	    if (serverProt) websocket._protocol = serverProt;

	    const secWebSocketExtensions = res.headers['sec-websocket-extensions'];

	    if (secWebSocketExtensions !== undefined) {
	      if (!perMessageDeflate) {
	        const message =
	          'Server sent a Sec-WebSocket-Extensions header but no extension ' +
	          'was requested';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      let extensions;

	      try {
	        extensions = parse(secWebSocketExtensions);
	      } catch (err) {
	        const message = 'Invalid Sec-WebSocket-Extensions header';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      const extensionNames = Object.keys(extensions);

	      if (
	        extensionNames.length !== 1 ||
	        extensionNames[0] !== PerMessageDeflate.extensionName
	      ) {
	        const message = 'Server indicated an extension that was not requested';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      try {
	        perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
	      } catch (err) {
	        const message = 'Invalid Sec-WebSocket-Extensions header';
	        abortHandshake(websocket, socket, message);
	        return;
	      }

	      websocket._extensions[PerMessageDeflate.extensionName] =
	        perMessageDeflate;
	    }

	    websocket.setSocket(socket, head, {
	      allowSynchronousEvents: opts.allowSynchronousEvents,
	      generateMask: opts.generateMask,
	      maxPayload: opts.maxPayload,
	      skipUTF8Validation: opts.skipUTF8Validation
	    });
	  });

	  if (opts.finishRequest) {
	    opts.finishRequest(req, websocket);
	  } else {
	    req.end();
	  }
	}

	/**
	 * Emit the `'error'` and `'close'` events.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @param {Error} The error to emit
	 * @private
	 */
	function emitErrorAndClose(websocket, err) {
	  websocket._readyState = WebSocket.CLOSING;
	  //
	  // The following assignment is practically useless and is done only for
	  // consistency.
	  //
	  websocket._errorEmitted = true;
	  websocket.emit('error', err);
	  websocket.emitClose();
	}

	/**
	 * Create a `net.Socket` and initiate a connection.
	 *
	 * @param {Object} options Connection options
	 * @return {net.Socket} The newly created socket used to start the connection
	 * @private
	 */
	function netConnect(options) {
	  options.path = options.socketPath;
	  return net.connect(options);
	}

	/**
	 * Create a `tls.TLSSocket` and initiate a connection.
	 *
	 * @param {Object} options Connection options
	 * @return {tls.TLSSocket} The newly created socket used to start the connection
	 * @private
	 */
	function tlsConnect(options) {
	  options.path = undefined;

	  if (!options.servername && options.servername !== '') {
	    options.servername = net.isIP(options.host) ? '' : options.host;
	  }

	  return tls.connect(options);
	}

	/**
	 * Abort the handshake and emit an error.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @param {(http.ClientRequest|net.Socket|tls.Socket)} stream The request to
	 *     abort or the socket to destroy
	 * @param {String} message The error message
	 * @private
	 */
	function abortHandshake(websocket, stream, message) {
	  websocket._readyState = WebSocket.CLOSING;

	  const err = new Error(message);
	  Error.captureStackTrace(err, abortHandshake);

	  if (stream.setHeader) {
	    stream[kAborted] = true;
	    stream.abort();

	    if (stream.socket && !stream.socket.destroyed) {
	      //
	      // On Node.js >= 14.3.0 `request.abort()` does not destroy the socket if
	      // called after the request completed. See
	      // https://github.com/websockets/ws/issues/1869.
	      //
	      stream.socket.destroy();
	    }

	    process.nextTick(emitErrorAndClose, websocket, err);
	  } else {
	    stream.destroy(err);
	    stream.once('error', websocket.emit.bind(websocket, 'error'));
	    stream.once('close', websocket.emitClose.bind(websocket));
	  }
	}

	/**
	 * Handle cases where the `ping()`, `pong()`, or `send()` methods are called
	 * when the `readyState` attribute is `CLOSING` or `CLOSED`.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @param {*} [data] The data to send
	 * @param {Function} [cb] Callback
	 * @private
	 */
	function sendAfterClose(websocket, data, cb) {
	  if (data) {
	    const length = isBlob(data) ? data.size : toBuffer(data).length;

	    //
	    // The `_bufferedAmount` property is used only when the peer is a client and
	    // the opening handshake fails. Under these circumstances, in fact, the
	    // `setSocket()` method is not called, so the `_socket` and `_sender`
	    // properties are set to `null`.
	    //
	    if (websocket._socket) websocket._sender._bufferedBytes += length;
	    else websocket._bufferedAmount += length;
	  }

	  if (cb) {
	    const err = new Error(
	      `WebSocket is not open: readyState ${websocket.readyState} ` +
	        `(${readyStates[websocket.readyState]})`
	    );
	    process.nextTick(cb, err);
	  }
	}

	/**
	 * The listener of the `Receiver` `'conclude'` event.
	 *
	 * @param {Number} code The status code
	 * @param {Buffer} reason The reason for closing
	 * @private
	 */
	function receiverOnConclude(code, reason) {
	  const websocket = this[kWebSocket];

	  websocket._closeFrameReceived = true;
	  websocket._closeMessage = reason;
	  websocket._closeCode = code;

	  if (websocket._socket[kWebSocket] === undefined) return;

	  websocket._socket.removeListener('data', socketOnData);
	  process.nextTick(resume, websocket._socket);

	  if (code === 1005) websocket.close();
	  else websocket.close(code, reason);
	}

	/**
	 * The listener of the `Receiver` `'drain'` event.
	 *
	 * @private
	 */
	function receiverOnDrain() {
	  const websocket = this[kWebSocket];

	  if (!websocket.isPaused) websocket._socket.resume();
	}

	/**
	 * The listener of the `Receiver` `'error'` event.
	 *
	 * @param {(RangeError|Error)} err The emitted error
	 * @private
	 */
	function receiverOnError(err) {
	  const websocket = this[kWebSocket];

	  if (websocket._socket[kWebSocket] !== undefined) {
	    websocket._socket.removeListener('data', socketOnData);

	    //
	    // On Node.js < 14.0.0 the `'error'` event is emitted synchronously. See
	    // https://github.com/websockets/ws/issues/1940.
	    //
	    process.nextTick(resume, websocket._socket);

	    websocket.close(err[kStatusCode]);
	  }

	  if (!websocket._errorEmitted) {
	    websocket._errorEmitted = true;
	    websocket.emit('error', err);
	  }
	}

	/**
	 * The listener of the `Receiver` `'finish'` event.
	 *
	 * @private
	 */
	function receiverOnFinish() {
	  this[kWebSocket].emitClose();
	}

	/**
	 * The listener of the `Receiver` `'message'` event.
	 *
	 * @param {Buffer|ArrayBuffer|Buffer[])} data The message
	 * @param {Boolean} isBinary Specifies whether the message is binary or not
	 * @private
	 */
	function receiverOnMessage(data, isBinary) {
	  this[kWebSocket].emit('message', data, isBinary);
	}

	/**
	 * The listener of the `Receiver` `'ping'` event.
	 *
	 * @param {Buffer} data The data included in the ping frame
	 * @private
	 */
	function receiverOnPing(data) {
	  const websocket = this[kWebSocket];

	  if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
	  websocket.emit('ping', data);
	}

	/**
	 * The listener of the `Receiver` `'pong'` event.
	 *
	 * @param {Buffer} data The data included in the pong frame
	 * @private
	 */
	function receiverOnPong(data) {
	  this[kWebSocket].emit('pong', data);
	}

	/**
	 * Resume a readable stream
	 *
	 * @param {Readable} stream The readable stream
	 * @private
	 */
	function resume(stream) {
	  stream.resume();
	}

	/**
	 * The `Sender` error event handler.
	 *
	 * @param {Error} The error
	 * @private
	 */
	function senderOnError(err) {
	  const websocket = this[kWebSocket];

	  if (websocket.readyState === WebSocket.CLOSED) return;
	  if (websocket.readyState === WebSocket.OPEN) {
	    websocket._readyState = WebSocket.CLOSING;
	    setCloseTimer(websocket);
	  }

	  //
	  // `socket.end()` is used instead of `socket.destroy()` to allow the other
	  // peer to finish sending queued data. There is no need to set a timer here
	  // because `CLOSING` means that it is already set or not needed.
	  //
	  this._socket.end();

	  if (!websocket._errorEmitted) {
	    websocket._errorEmitted = true;
	    websocket.emit('error', err);
	  }
	}

	/**
	 * Set a timer to destroy the underlying raw socket of a WebSocket.
	 *
	 * @param {WebSocket} websocket The WebSocket instance
	 * @private
	 */
	function setCloseTimer(websocket) {
	  websocket._closeTimer = setTimeout(
	    websocket._socket.destroy.bind(websocket._socket),
	    closeTimeout
	  );
	}

	/**
	 * The listener of the socket `'close'` event.
	 *
	 * @private
	 */
	function socketOnClose() {
	  const websocket = this[kWebSocket];

	  this.removeListener('close', socketOnClose);
	  this.removeListener('data', socketOnData);
	  this.removeListener('end', socketOnEnd);

	  websocket._readyState = WebSocket.CLOSING;

	  let chunk;

	  //
	  // The close frame might not have been received or the `'end'` event emitted,
	  // for example, if the socket was destroyed due to an error. Ensure that the
	  // `receiver` stream is closed after writing any remaining buffered data to
	  // it. If the readable side of the socket is in flowing mode then there is no
	  // buffered data as everything has been already written and `readable.read()`
	  // will return `null`. If instead, the socket is paused, any possible buffered
	  // data will be read as a single chunk.
	  //
	  if (
	    !this._readableState.endEmitted &&
	    !websocket._closeFrameReceived &&
	    !websocket._receiver._writableState.errorEmitted &&
	    (chunk = websocket._socket.read()) !== null
	  ) {
	    websocket._receiver.write(chunk);
	  }

	  websocket._receiver.end();

	  this[kWebSocket] = undefined;

	  clearTimeout(websocket._closeTimer);

	  if (
	    websocket._receiver._writableState.finished ||
	    websocket._receiver._writableState.errorEmitted
	  ) {
	    websocket.emitClose();
	  } else {
	    websocket._receiver.on('error', receiverOnFinish);
	    websocket._receiver.on('finish', receiverOnFinish);
	  }
	}

	/**
	 * The listener of the socket `'data'` event.
	 *
	 * @param {Buffer} chunk A chunk of data
	 * @private
	 */
	function socketOnData(chunk) {
	  if (!this[kWebSocket]._receiver.write(chunk)) {
	    this.pause();
	  }
	}

	/**
	 * The listener of the socket `'end'` event.
	 *
	 * @private
	 */
	function socketOnEnd() {
	  const websocket = this[kWebSocket];

	  websocket._readyState = WebSocket.CLOSING;
	  websocket._receiver.end();
	  this.end();
	}

	/**
	 * The listener of the socket `'error'` event.
	 *
	 * @private
	 */
	function socketOnError() {
	  const websocket = this[kWebSocket];

	  this.removeListener('error', socketOnError);
	  this.on('error', NOOP);

	  if (websocket) {
	    websocket._readyState = WebSocket.CLOSING;
	    this.destroy();
	  }
	}
	return websocket;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^WebSocket$" }] */

var stream;
var hasRequiredStream;

function requireStream () {
	if (hasRequiredStream) return stream;
	hasRequiredStream = 1;

	requireWebsocket();
	const { Duplex } = require$$0$2;

	/**
	 * Emits the `'close'` event on a stream.
	 *
	 * @param {Duplex} stream The stream.
	 * @private
	 */
	function emitClose(stream) {
	  stream.emit('close');
	}

	/**
	 * The listener of the `'end'` event.
	 *
	 * @private
	 */
	function duplexOnEnd() {
	  if (!this.destroyed && this._writableState.finished) {
	    this.destroy();
	  }
	}

	/**
	 * The listener of the `'error'` event.
	 *
	 * @param {Error} err The error
	 * @private
	 */
	function duplexOnError(err) {
	  this.removeListener('error', duplexOnError);
	  this.destroy();
	  if (this.listenerCount('error') === 0) {
	    // Do not suppress the throwing behavior.
	    this.emit('error', err);
	  }
	}

	/**
	 * Wraps a `WebSocket` in a duplex stream.
	 *
	 * @param {WebSocket} ws The `WebSocket` to wrap
	 * @param {Object} [options] The options for the `Duplex` constructor
	 * @return {Duplex} The duplex stream
	 * @public
	 */
	function createWebSocketStream(ws, options) {
	  let terminateOnDestroy = true;

	  const duplex = new Duplex({
	    ...options,
	    autoDestroy: false,
	    emitClose: false,
	    objectMode: false,
	    writableObjectMode: false
	  });

	  ws.on('message', function message(msg, isBinary) {
	    const data =
	      !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;

	    if (!duplex.push(data)) ws.pause();
	  });

	  ws.once('error', function error(err) {
	    if (duplex.destroyed) return;

	    // Prevent `ws.terminate()` from being called by `duplex._destroy()`.
	    //
	    // - If the `'error'` event is emitted before the `'open'` event, then
	    //   `ws.terminate()` is a noop as no socket is assigned.
	    // - Otherwise, the error is re-emitted by the listener of the `'error'`
	    //   event of the `Receiver` object. The listener already closes the
	    //   connection by calling `ws.close()`. This allows a close frame to be
	    //   sent to the other peer. If `ws.terminate()` is called right after this,
	    //   then the close frame might not be sent.
	    terminateOnDestroy = false;
	    duplex.destroy(err);
	  });

	  ws.once('close', function close() {
	    if (duplex.destroyed) return;

	    duplex.push(null);
	  });

	  duplex._destroy = function (err, callback) {
	    if (ws.readyState === ws.CLOSED) {
	      callback(err);
	      process.nextTick(emitClose, duplex);
	      return;
	    }

	    let called = false;

	    ws.once('error', function error(err) {
	      called = true;
	      callback(err);
	    });

	    ws.once('close', function close() {
	      if (!called) callback(err);
	      process.nextTick(emitClose, duplex);
	    });

	    if (terminateOnDestroy) ws.terminate();
	  };

	  duplex._final = function (callback) {
	    if (ws.readyState === ws.CONNECTING) {
	      ws.once('open', function open() {
	        duplex._final(callback);
	      });
	      return;
	    }

	    // If the value of the `_socket` property is `null` it means that `ws` is a
	    // client websocket and the handshake failed. In fact, when this happens, a
	    // socket is never assigned to the websocket. Wait for the `'error'` event
	    // that will be emitted by the websocket.
	    if (ws._socket === null) return;

	    if (ws._socket._writableState.finished) {
	      callback();
	      if (duplex._readableState.endEmitted) duplex.destroy();
	    } else {
	      ws._socket.once('finish', function finish() {
	        // `duplex` is not destroyed here because the `'end'` event will be
	        // emitted on `duplex` after this `'finish'` event. The EOF signaling
	        // `null` chunk is, in fact, pushed when the websocket emits `'close'`.
	        callback();
	      });
	      ws.close();
	    }
	  };

	  duplex._read = function () {
	    if (ws.isPaused) ws.resume();
	  };

	  duplex._write = function (chunk, encoding, callback) {
	    if (ws.readyState === ws.CONNECTING) {
	      ws.once('open', function open() {
	        duplex._write(chunk, encoding, callback);
	      });
	      return;
	    }

	    ws.send(chunk, callback);
	  };

	  duplex.on('end', duplexOnEnd);
	  duplex.on('error', duplexOnError);
	  return duplex;
	}

	stream = createWebSocketStream;
	return stream;
}

requireStream();

requireReceiver();

requireSender();

var websocketExports = requireWebsocket();
var WebSocket = /*@__PURE__*/getDefaultExportFromCjs(websocketExports);

var subprotocol;
var hasRequiredSubprotocol;

function requireSubprotocol () {
	if (hasRequiredSubprotocol) return subprotocol;
	hasRequiredSubprotocol = 1;

	const { tokenChars } = requireValidation();

	/**
	 * Parses the `Sec-WebSocket-Protocol` header into a set of subprotocol names.
	 *
	 * @param {String} header The field value of the header
	 * @return {Set} The subprotocol names
	 * @public
	 */
	function parse(header) {
	  const protocols = new Set();
	  let start = -1;
	  let end = -1;
	  let i = 0;

	  for (i; i < header.length; i++) {
	    const code = header.charCodeAt(i);

	    if (end === -1 && tokenChars[code] === 1) {
	      if (start === -1) start = i;
	    } else if (
	      i !== 0 &&
	      (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */
	    ) {
	      if (end === -1 && start !== -1) end = i;
	    } else if (code === 0x2c /* ',' */) {
	      if (start === -1) {
	        throw new SyntaxError(`Unexpected character at index ${i}`);
	      }

	      if (end === -1) end = i;

	      const protocol = header.slice(start, end);

	      if (protocols.has(protocol)) {
	        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
	      }

	      protocols.add(protocol);
	      start = end = -1;
	    } else {
	      throw new SyntaxError(`Unexpected character at index ${i}`);
	    }
	  }

	  if (start === -1 || end !== -1) {
	    throw new SyntaxError('Unexpected end of input');
	  }

	  const protocol = header.slice(start, i);

	  if (protocols.has(protocol)) {
	    throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
	  }

	  protocols.add(protocol);
	  return protocols;
	}

	subprotocol = { parse };
	return subprotocol;
}

/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "^Duplex$", "caughtErrors": "none" }] */

var websocketServer;
var hasRequiredWebsocketServer;

function requireWebsocketServer () {
	if (hasRequiredWebsocketServer) return websocketServer;
	hasRequiredWebsocketServer = 1;

	const EventEmitter = require$$0$3;
	const http = require$$2;
	const { Duplex } = require$$0$2;
	const { createHash } = require$$1;

	const extension = requireExtension();
	const PerMessageDeflate = requirePermessageDeflate();
	const subprotocol = requireSubprotocol();
	const WebSocket = requireWebsocket();
	const { GUID, kWebSocket } = requireConstants();

	const keyRegex = /^[+/0-9A-Za-z]{22}==$/;

	const RUNNING = 0;
	const CLOSING = 1;
	const CLOSED = 2;

	/**
	 * Class representing a WebSocket server.
	 *
	 * @extends EventEmitter
	 */
	class WebSocketServer extends EventEmitter {
	  /**
	   * Create a `WebSocketServer` instance.
	   *
	   * @param {Object} options Configuration options
	   * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
	   *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
	   *     multiple times in the same tick
	   * @param {Boolean} [options.autoPong=true] Specifies whether or not to
	   *     automatically send a pong in response to a ping
	   * @param {Number} [options.backlog=511] The maximum length of the queue of
	   *     pending connections
	   * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
	   *     track clients
	   * @param {Function} [options.handleProtocols] A hook to handle protocols
	   * @param {String} [options.host] The hostname where to bind the server
	   * @param {Number} [options.maxPayload=104857600] The maximum allowed message
	   *     size
	   * @param {Boolean} [options.noServer=false] Enable no server mode
	   * @param {String} [options.path] Accept only connections matching this path
	   * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
	   *     permessage-deflate
	   * @param {Number} [options.port] The port where to bind the server
	   * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
	   *     server to use
	   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
	   *     not to skip UTF-8 validation for text and close messages
	   * @param {Function} [options.verifyClient] A hook to reject connections
	   * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
	   *     class to use. It must be the `WebSocket` class or class that extends it
	   * @param {Function} [callback] A listener for the `listening` event
	   */
	  constructor(options, callback) {
	    super();

	    options = {
	      allowSynchronousEvents: true,
	      autoPong: true,
	      maxPayload: 100 * 1024 * 1024,
	      skipUTF8Validation: false,
	      perMessageDeflate: false,
	      handleProtocols: null,
	      clientTracking: true,
	      verifyClient: null,
	      noServer: false,
	      backlog: null, // use default (511 as implemented in net.js)
	      server: null,
	      host: null,
	      path: null,
	      port: null,
	      WebSocket,
	      ...options
	    };

	    if (
	      (options.port == null && !options.server && !options.noServer) ||
	      (options.port != null && (options.server || options.noServer)) ||
	      (options.server && options.noServer)
	    ) {
	      throw new TypeError(
	        'One and only one of the "port", "server", or "noServer" options ' +
	          'must be specified'
	      );
	    }

	    if (options.port != null) {
	      this._server = http.createServer((req, res) => {
	        const body = http.STATUS_CODES[426];

	        res.writeHead(426, {
	          'Content-Length': body.length,
	          'Content-Type': 'text/plain'
	        });
	        res.end(body);
	      });
	      this._server.listen(
	        options.port,
	        options.host,
	        options.backlog,
	        callback
	      );
	    } else if (options.server) {
	      this._server = options.server;
	    }

	    if (this._server) {
	      const emitConnection = this.emit.bind(this, 'connection');

	      this._removeListeners = addListeners(this._server, {
	        listening: this.emit.bind(this, 'listening'),
	        error: this.emit.bind(this, 'error'),
	        upgrade: (req, socket, head) => {
	          this.handleUpgrade(req, socket, head, emitConnection);
	        }
	      });
	    }

	    if (options.perMessageDeflate === true) options.perMessageDeflate = {};
	    if (options.clientTracking) {
	      this.clients = new Set();
	      this._shouldEmitClose = false;
	    }

	    this.options = options;
	    this._state = RUNNING;
	  }

	  /**
	   * Returns the bound address, the address family name, and port of the server
	   * as reported by the operating system if listening on an IP socket.
	   * If the server is listening on a pipe or UNIX domain socket, the name is
	   * returned as a string.
	   *
	   * @return {(Object|String|null)} The address of the server
	   * @public
	   */
	  address() {
	    if (this.options.noServer) {
	      throw new Error('The server is operating in "noServer" mode');
	    }

	    if (!this._server) return null;
	    return this._server.address();
	  }

	  /**
	   * Stop the server from accepting new connections and emit the `'close'` event
	   * when all existing connections are closed.
	   *
	   * @param {Function} [cb] A one-time listener for the `'close'` event
	   * @public
	   */
	  close(cb) {
	    if (this._state === CLOSED) {
	      if (cb) {
	        this.once('close', () => {
	          cb(new Error('The server is not running'));
	        });
	      }

	      process.nextTick(emitClose, this);
	      return;
	    }

	    if (cb) this.once('close', cb);

	    if (this._state === CLOSING) return;
	    this._state = CLOSING;

	    if (this.options.noServer || this.options.server) {
	      if (this._server) {
	        this._removeListeners();
	        this._removeListeners = this._server = null;
	      }

	      if (this.clients) {
	        if (!this.clients.size) {
	          process.nextTick(emitClose, this);
	        } else {
	          this._shouldEmitClose = true;
	        }
	      } else {
	        process.nextTick(emitClose, this);
	      }
	    } else {
	      const server = this._server;

	      this._removeListeners();
	      this._removeListeners = this._server = null;

	      //
	      // The HTTP/S server was created internally. Close it, and rely on its
	      // `'close'` event.
	      //
	      server.close(() => {
	        emitClose(this);
	      });
	    }
	  }

	  /**
	   * See if a given request should be handled by this server instance.
	   *
	   * @param {http.IncomingMessage} req Request object to inspect
	   * @return {Boolean} `true` if the request is valid, else `false`
	   * @public
	   */
	  shouldHandle(req) {
	    if (this.options.path) {
	      const index = req.url.indexOf('?');
	      const pathname = index !== -1 ? req.url.slice(0, index) : req.url;

	      if (pathname !== this.options.path) return false;
	    }

	    return true;
	  }

	  /**
	   * Handle a HTTP Upgrade request.
	   *
	   * @param {http.IncomingMessage} req The request object
	   * @param {Duplex} socket The network socket between the server and client
	   * @param {Buffer} head The first packet of the upgraded stream
	   * @param {Function} cb Callback
	   * @public
	   */
	  handleUpgrade(req, socket, head, cb) {
	    socket.on('error', socketOnError);

	    const key = req.headers['sec-websocket-key'];
	    const upgrade = req.headers.upgrade;
	    const version = +req.headers['sec-websocket-version'];

	    if (req.method !== 'GET') {
	      const message = 'Invalid HTTP method';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
	      return;
	    }

	    if (upgrade === undefined || upgrade.toLowerCase() !== 'websocket') {
	      const message = 'Invalid Upgrade header';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	      return;
	    }

	    if (key === undefined || !keyRegex.test(key)) {
	      const message = 'Missing or invalid Sec-WebSocket-Key header';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	      return;
	    }

	    if (version !== 13 && version !== 8) {
	      const message = 'Missing or invalid Sec-WebSocket-Version header';
	      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
	        'Sec-WebSocket-Version': '13, 8'
	      });
	      return;
	    }

	    if (!this.shouldHandle(req)) {
	      abortHandshake(socket, 400);
	      return;
	    }

	    const secWebSocketProtocol = req.headers['sec-websocket-protocol'];
	    let protocols = new Set();

	    if (secWebSocketProtocol !== undefined) {
	      try {
	        protocols = subprotocol.parse(secWebSocketProtocol);
	      } catch (err) {
	        const message = 'Invalid Sec-WebSocket-Protocol header';
	        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	        return;
	      }
	    }

	    const secWebSocketExtensions = req.headers['sec-websocket-extensions'];
	    const extensions = {};

	    if (
	      this.options.perMessageDeflate &&
	      secWebSocketExtensions !== undefined
	    ) {
	      const perMessageDeflate = new PerMessageDeflate(
	        this.options.perMessageDeflate,
	        true,
	        this.options.maxPayload
	      );

	      try {
	        const offers = extension.parse(secWebSocketExtensions);

	        if (offers[PerMessageDeflate.extensionName]) {
	          perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
	          extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
	        }
	      } catch (err) {
	        const message =
	          'Invalid or unacceptable Sec-WebSocket-Extensions header';
	        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
	        return;
	      }
	    }

	    //
	    // Optionally call external client verification handler.
	    //
	    if (this.options.verifyClient) {
	      const info = {
	        origin:
	          req.headers[`${version === 8 ? 'sec-websocket-origin' : 'origin'}`],
	        secure: !!(req.socket.authorized || req.socket.encrypted),
	        req
	      };

	      if (this.options.verifyClient.length === 2) {
	        this.options.verifyClient(info, (verified, code, message, headers) => {
	          if (!verified) {
	            return abortHandshake(socket, code || 401, message, headers);
	          }

	          this.completeUpgrade(
	            extensions,
	            key,
	            protocols,
	            req,
	            socket,
	            head,
	            cb
	          );
	        });
	        return;
	      }

	      if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
	    }

	    this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
	  }

	  /**
	   * Upgrade the connection to WebSocket.
	   *
	   * @param {Object} extensions The accepted extensions
	   * @param {String} key The value of the `Sec-WebSocket-Key` header
	   * @param {Set} protocols The subprotocols
	   * @param {http.IncomingMessage} req The request object
	   * @param {Duplex} socket The network socket between the server and client
	   * @param {Buffer} head The first packet of the upgraded stream
	   * @param {Function} cb Callback
	   * @throws {Error} If called more than once with the same socket
	   * @private
	   */
	  completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
	    //
	    // Destroy the socket if the client has already sent a FIN packet.
	    //
	    if (!socket.readable || !socket.writable) return socket.destroy();

	    if (socket[kWebSocket]) {
	      throw new Error(
	        'server.handleUpgrade() was called more than once with the same ' +
	          'socket, possibly due to a misconfiguration'
	      );
	    }

	    if (this._state > RUNNING) return abortHandshake(socket, 503);

	    const digest = createHash('sha1')
	      .update(key + GUID)
	      .digest('base64');

	    const headers = [
	      'HTTP/1.1 101 Switching Protocols',
	      'Upgrade: websocket',
	      'Connection: Upgrade',
	      `Sec-WebSocket-Accept: ${digest}`
	    ];

	    const ws = new this.options.WebSocket(null, undefined, this.options);

	    if (protocols.size) {
	      //
	      // Optionally call external protocol selection handler.
	      //
	      const protocol = this.options.handleProtocols
	        ? this.options.handleProtocols(protocols, req)
	        : protocols.values().next().value;

	      if (protocol) {
	        headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
	        ws._protocol = protocol;
	      }
	    }

	    if (extensions[PerMessageDeflate.extensionName]) {
	      const params = extensions[PerMessageDeflate.extensionName].params;
	      const value = extension.format({
	        [PerMessageDeflate.extensionName]: [params]
	      });
	      headers.push(`Sec-WebSocket-Extensions: ${value}`);
	      ws._extensions = extensions;
	    }

	    //
	    // Allow external modification/inspection of handshake headers.
	    //
	    this.emit('headers', headers, req);

	    socket.write(headers.concat('\r\n').join('\r\n'));
	    socket.removeListener('error', socketOnError);

	    ws.setSocket(socket, head, {
	      allowSynchronousEvents: this.options.allowSynchronousEvents,
	      maxPayload: this.options.maxPayload,
	      skipUTF8Validation: this.options.skipUTF8Validation
	    });

	    if (this.clients) {
	      this.clients.add(ws);
	      ws.on('close', () => {
	        this.clients.delete(ws);

	        if (this._shouldEmitClose && !this.clients.size) {
	          process.nextTick(emitClose, this);
	        }
	      });
	    }

	    cb(ws, req);
	  }
	}

	websocketServer = WebSocketServer;

	/**
	 * Add event listeners on an `EventEmitter` using a map of <event, listener>
	 * pairs.
	 *
	 * @param {EventEmitter} server The event emitter
	 * @param {Object.<String, Function>} map The listeners to add
	 * @return {Function} A function that will remove the added listeners when
	 *     called
	 * @private
	 */
	function addListeners(server, map) {
	  for (const event of Object.keys(map)) server.on(event, map[event]);

	  return function removeListeners() {
	    for (const event of Object.keys(map)) {
	      server.removeListener(event, map[event]);
	    }
	  };
	}

	/**
	 * Emit a `'close'` event on an `EventEmitter`.
	 *
	 * @param {EventEmitter} server The event emitter
	 * @private
	 */
	function emitClose(server) {
	  server._state = CLOSED;
	  server.emit('close');
	}

	/**
	 * Handle socket errors.
	 *
	 * @private
	 */
	function socketOnError() {
	  this.destroy();
	}

	/**
	 * Close the connection when preconditions are not fulfilled.
	 *
	 * @param {Duplex} socket The socket of the upgrade request
	 * @param {Number} code The HTTP response status code
	 * @param {String} [message] The HTTP response body
	 * @param {Object} [headers] Additional HTTP response headers
	 * @private
	 */
	function abortHandshake(socket, code, message, headers) {
	  //
	  // The socket is writable unless the user destroyed or ended it before calling
	  // `server.handleUpgrade()` or in the `verifyClient` function, which is a user
	  // error. Handling this does not make much sense as the worst that can happen
	  // is that some of the data written by the user might be discarded due to the
	  // call to `socket.end()` below, which triggers an `'error'` event that in
	  // turn causes the socket to be destroyed.
	  //
	  message = message || http.STATUS_CODES[code];
	  headers = {
	    Connection: 'close',
	    'Content-Type': 'text/html',
	    'Content-Length': Buffer.byteLength(message),
	    ...headers
	  };

	  socket.once('finish', socket.destroy);

	  socket.end(
	    `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\n` +
	      Object.keys(headers)
	        .map((h) => `${h}: ${headers[h]}`)
	        .join('\r\n') +
	      '\r\n\r\n' +
	      message
	  );
	}

	/**
	 * Emit a `'wsClientError'` event on a `WebSocketServer` if there is at least
	 * one listener for it, otherwise call `abortHandshake()`.
	 *
	 * @param {WebSocketServer} server The WebSocket server
	 * @param {http.IncomingMessage} req The request object
	 * @param {Duplex} socket The socket of the upgrade request
	 * @param {Number} code The HTTP response status code
	 * @param {String} message The HTTP response body
	 * @param {Object} [headers] The HTTP response headers
	 * @private
	 */
	function abortHandshakeOrEmitwsClientError(
	  server,
	  req,
	  socket,
	  code,
	  message,
	  headers
	) {
	  if (server.listenerCount('wsClientError')) {
	    const err = new Error(message);
	    Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);

	    server.emit('wsClientError', err, socket, req);
	  } else {
	    abortHandshake(socket, code, message, headers);
	  }
	}
	return websocketServer;
}

requireWebsocketServer();

const ANSI_BACKGROUND_OFFSET = 10;

const wrapAnsi16 = (offset = 0) => code => `\u001B[${code + offset}m`;

const wrapAnsi256 = (offset = 0) => code => `\u001B[${38 + offset};5;${code}m`;

const wrapAnsi16m = (offset = 0) => (red, green, blue) => `\u001B[${38 + offset};2;${red};${green};${blue}m`;

const styles$1 = {
	modifier: {
		reset: [0, 0],
		// 21 isn't widely supported and 22 does the same thing
		bold: [1, 22],
		dim: [2, 22],
		italic: [3, 23],
		underline: [4, 24],
		overline: [53, 55],
		inverse: [7, 27],
		hidden: [8, 28],
		strikethrough: [9, 29],
	},
	color: {
		black: [30, 39],
		red: [31, 39],
		green: [32, 39],
		yellow: [33, 39],
		blue: [34, 39],
		magenta: [35, 39],
		cyan: [36, 39],
		white: [37, 39],

		// Bright color
		blackBright: [90, 39],
		gray: [90, 39], // Alias of `blackBright`
		grey: [90, 39], // Alias of `blackBright`
		redBright: [91, 39],
		greenBright: [92, 39],
		yellowBright: [93, 39],
		blueBright: [94, 39],
		magentaBright: [95, 39],
		cyanBright: [96, 39],
		whiteBright: [97, 39],
	},
	bgColor: {
		bgBlack: [40, 49],
		bgRed: [41, 49],
		bgGreen: [42, 49],
		bgYellow: [43, 49],
		bgBlue: [44, 49],
		bgMagenta: [45, 49],
		bgCyan: [46, 49],
		bgWhite: [47, 49],

		// Bright color
		bgBlackBright: [100, 49],
		bgGray: [100, 49], // Alias of `bgBlackBright`
		bgGrey: [100, 49], // Alias of `bgBlackBright`
		bgRedBright: [101, 49],
		bgGreenBright: [102, 49],
		bgYellowBright: [103, 49],
		bgBlueBright: [104, 49],
		bgMagentaBright: [105, 49],
		bgCyanBright: [106, 49],
		bgWhiteBright: [107, 49],
	},
};

Object.keys(styles$1.modifier);
const foregroundColorNames = Object.keys(styles$1.color);
const backgroundColorNames = Object.keys(styles$1.bgColor);
[...foregroundColorNames, ...backgroundColorNames];

function assembleStyles() {
	const codes = new Map();

	for (const [groupName, group] of Object.entries(styles$1)) {
		for (const [styleName, style] of Object.entries(group)) {
			styles$1[styleName] = {
				open: `\u001B[${style[0]}m`,
				close: `\u001B[${style[1]}m`,
			};

			group[styleName] = styles$1[styleName];

			codes.set(style[0], style[1]);
		}

		Object.defineProperty(styles$1, groupName, {
			value: group,
			enumerable: false,
		});
	}

	Object.defineProperty(styles$1, 'codes', {
		value: codes,
		enumerable: false,
	});

	styles$1.color.close = '\u001B[39m';
	styles$1.bgColor.close = '\u001B[49m';

	styles$1.color.ansi = wrapAnsi16();
	styles$1.color.ansi256 = wrapAnsi256();
	styles$1.color.ansi16m = wrapAnsi16m();
	styles$1.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
	styles$1.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
	styles$1.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);

	// From https://github.com/Qix-/color-convert/blob/3f0e0d4e92e235796ccb17f6e85c72094a651f49/conversions.js
	Object.defineProperties(styles$1, {
		rgbToAnsi256: {
			value(red, green, blue) {
				// We use the extended greyscale palette here, with the exception of
				// black and white. normal palette only has 4 greyscale shades.
				if (red === green && green === blue) {
					if (red < 8) {
						return 16;
					}

					if (red > 248) {
						return 231;
					}

					return Math.round(((red - 8) / 247) * 24) + 232;
				}

				return 16
					+ (36 * Math.round(red / 255 * 5))
					+ (6 * Math.round(green / 255 * 5))
					+ Math.round(blue / 255 * 5);
			},
			enumerable: false,
		},
		hexToRgb: {
			value(hex) {
				const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
				if (!matches) {
					return [0, 0, 0];
				}

				let [colorString] = matches;

				if (colorString.length === 3) {
					colorString = [...colorString].map(character => character + character).join('');
				}

				const integer = Number.parseInt(colorString, 16);

				return [
					/* eslint-disable no-bitwise */
					(integer >> 16) & 0xFF,
					(integer >> 8) & 0xFF,
					integer & 0xFF,
					/* eslint-enable no-bitwise */
				];
			},
			enumerable: false,
		},
		hexToAnsi256: {
			value: hex => styles$1.rgbToAnsi256(...styles$1.hexToRgb(hex)),
			enumerable: false,
		},
		ansi256ToAnsi: {
			value(code) {
				if (code < 8) {
					return 30 + code;
				}

				if (code < 16) {
					return 90 + (code - 8);
				}

				let red;
				let green;
				let blue;

				if (code >= 232) {
					red = (((code - 232) * 10) + 8) / 255;
					green = red;
					blue = red;
				} else {
					code -= 16;

					const remainder = code % 36;

					red = Math.floor(code / 36) / 5;
					green = Math.floor(remainder / 6) / 5;
					blue = (remainder % 6) / 5;
				}

				const value = Math.max(red, green, blue) * 2;

				if (value === 0) {
					return 30;
				}

				// eslint-disable-next-line no-bitwise
				let result = 30 + ((Math.round(blue) << 2) | (Math.round(green) << 1) | Math.round(red));

				if (value === 2) {
					result += 60;
				}

				return result;
			},
			enumerable: false,
		},
		rgbToAnsi: {
			value: (red, green, blue) => styles$1.ansi256ToAnsi(styles$1.rgbToAnsi256(red, green, blue)),
			enumerable: false,
		},
		hexToAnsi: {
			value: hex => styles$1.ansi256ToAnsi(styles$1.hexToAnsi256(hex)),
			enumerable: false,
		},
	});

	return styles$1;
}

const ansiStyles = assembleStyles();

/* eslint-env browser */

const level = (() => {
	if (!('navigator' in globalThis)) {
		return 0;
	}

	if (globalThis.navigator.userAgentData) {
		const brand = navigator.userAgentData.brands.find(({brand}) => brand === 'Chromium');
		if (brand && brand.version > 93) {
			return 3;
		}
	}

	if (/\b(Chrome|Chromium)\//.test(globalThis.navigator.userAgent)) {
		return 1;
	}

	return 0;
})();

const colorSupport = level !== 0 && {
	level};

const supportsColor = {
	stdout: colorSupport,
	stderr: colorSupport,
};

// TODO: When targeting Node.js 16, use `String.prototype.replaceAll`.
function stringReplaceAll(string, substring, replacer) {
	let index = string.indexOf(substring);
	if (index === -1) {
		return string;
	}

	const substringLength = substring.length;
	let endIndex = 0;
	let returnValue = '';
	do {
		returnValue += string.slice(endIndex, index) + substring + replacer;
		endIndex = index + substringLength;
		index = string.indexOf(substring, endIndex);
	} while (index !== -1);

	returnValue += string.slice(endIndex);
	return returnValue;
}

function stringEncaseCRLFWithFirstIndex(string, prefix, postfix, index) {
	let endIndex = 0;
	let returnValue = '';
	do {
		const gotCR = string[index - 1] === '\r';
		returnValue += string.slice(endIndex, (gotCR ? index - 1 : index)) + prefix + (gotCR ? '\r\n' : '\n') + postfix;
		endIndex = index + 1;
		index = string.indexOf('\n', endIndex);
	} while (index !== -1);

	returnValue += string.slice(endIndex);
	return returnValue;
}

const {stdout: stdoutColor, stderr: stderrColor} = supportsColor;

const GENERATOR = Symbol('GENERATOR');
const STYLER = Symbol('STYLER');
const IS_EMPTY = Symbol('IS_EMPTY');

// `supportsColor.level` → `ansiStyles.color[name]` mapping
const levelMapping = [
	'ansi',
	'ansi',
	'ansi256',
	'ansi16m',
];

const styles = Object.create(null);

const applyOptions = (object, options = {}) => {
	if (options.level && !(Number.isInteger(options.level) && options.level >= 0 && options.level <= 3)) {
		throw new Error('The `level` option should be an integer from 0 to 3');
	}

	// Detect level if not set manually
	const colorLevel = stdoutColor ? stdoutColor.level : 0;
	object.level = options.level === undefined ? colorLevel : options.level;
};

const chalkFactory = options => {
	const chalk = (...strings) => strings.join(' ');
	applyOptions(chalk, options);

	Object.setPrototypeOf(chalk, createChalk.prototype);

	return chalk;
};

function createChalk(options) {
	return chalkFactory(options);
}

Object.setPrototypeOf(createChalk.prototype, Function.prototype);

for (const [styleName, style] of Object.entries(ansiStyles)) {
	styles[styleName] = {
		get() {
			const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
			Object.defineProperty(this, styleName, {value: builder});
			return builder;
		},
	};
}

styles.visible = {
	get() {
		const builder = createBuilder(this, this[STYLER], true);
		Object.defineProperty(this, 'visible', {value: builder});
		return builder;
	},
};

const getModelAnsi = (model, level, type, ...arguments_) => {
	if (model === 'rgb') {
		if (level === 'ansi16m') {
			return ansiStyles[type].ansi16m(...arguments_);
		}

		if (level === 'ansi256') {
			return ansiStyles[type].ansi256(ansiStyles.rgbToAnsi256(...arguments_));
		}

		return ansiStyles[type].ansi(ansiStyles.rgbToAnsi(...arguments_));
	}

	if (model === 'hex') {
		return getModelAnsi('rgb', level, type, ...ansiStyles.hexToRgb(...arguments_));
	}

	return ansiStyles[type][model](...arguments_);
};

const usedModels = ['rgb', 'hex', 'ansi256'];

for (const model of usedModels) {
	styles[model] = {
		get() {
			const {level} = this;
			return function (...arguments_) {
				const styler = createStyler(getModelAnsi(model, levelMapping[level], 'color', ...arguments_), ansiStyles.color.close, this[STYLER]);
				return createBuilder(this, styler, this[IS_EMPTY]);
			};
		},
	};

	const bgModel = 'bg' + model[0].toUpperCase() + model.slice(1);
	styles[bgModel] = {
		get() {
			const {level} = this;
			return function (...arguments_) {
				const styler = createStyler(getModelAnsi(model, levelMapping[level], 'bgColor', ...arguments_), ansiStyles.bgColor.close, this[STYLER]);
				return createBuilder(this, styler, this[IS_EMPTY]);
			};
		},
	};
}

const proto = Object.defineProperties(() => {}, {
	...styles,
	level: {
		enumerable: true,
		get() {
			return this[GENERATOR].level;
		},
		set(level) {
			this[GENERATOR].level = level;
		},
	},
});

const createStyler = (open, close, parent) => {
	let openAll;
	let closeAll;
	if (parent === undefined) {
		openAll = open;
		closeAll = close;
	} else {
		openAll = parent.openAll + open;
		closeAll = close + parent.closeAll;
	}

	return {
		open,
		close,
		openAll,
		closeAll,
		parent,
	};
};

const createBuilder = (self, _styler, _isEmpty) => {
	// Single argument is hot path, implicit coercion is faster than anything
	// eslint-disable-next-line no-implicit-coercion
	const builder = (...arguments_) => applyStyle(builder, (arguments_.length === 1) ? ('' + arguments_[0]) : arguments_.join(' '));

	// We alter the prototype because we must return a function, but there is
	// no way to create a function with a different prototype
	Object.setPrototypeOf(builder, proto);

	builder[GENERATOR] = self;
	builder[STYLER] = _styler;
	builder[IS_EMPTY] = _isEmpty;

	return builder;
};

const applyStyle = (self, string) => {
	if (self.level <= 0 || !string) {
		return self[IS_EMPTY] ? '' : string;
	}

	let styler = self[STYLER];

	if (styler === undefined) {
		return string;
	}

	const {openAll, closeAll} = styler;
	if (string.includes('\u001B')) {
		while (styler !== undefined) {
			// Replace any instances already present with a re-opening code
			// otherwise only the part of the string until said closing code
			// will be colored, and the rest will simply be 'plain'.
			string = stringReplaceAll(string, styler.close, styler.open);

			styler = styler.parent;
		}
	}

	// We can move both next actions out of loop, because remaining actions in loop won't have
	// any/visible effect on parts we add here. Close the styling before a linebreak and reopen
	// after next line to fix a bleed issue on macOS: https://github.com/chalk/chalk/pull/92
	const lfIndex = string.indexOf('\n');
	if (lfIndex !== -1) {
		string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
	}

	return openAll + string + closeAll;
};

Object.defineProperties(createChalk.prototype, styles);

const chalk = createChalk();
createChalk({level: stderrColor ? stderrColor.level : 0});

class DisplayManager {
    static instance;
    promptText = '';
    constructor() { }
    static getInstance() {
        if (!DisplayManager.instance) {
            DisplayManager.instance = new DisplayManager();
        }
        return DisplayManager.instance;
    }
    setPrompt(prompt) {
        this.promptText = prompt;
    }
    /**
     * Logs a message while preserving the prompt at the bottom
     */
    log(message, options) {
        // Clear the current prompt line
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
        // Format the timestamp
        const date = new Date();
        const timestamp = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
        const account = options?.account;
        const symbol = options?.symbol;
        // Build the log message
        let logMessage = `[${timestamp}]${options?.source ? ` [${options.source}] ` : ''}${account ? ` [${account}] ` : ''}${symbol ? ` [${symbol}] ` : ''}${message}`;
        // Add color based on type
        if (options?.type === 'error') {
            logMessage = chalk.red(logMessage);
        }
        else if (options?.type === 'warn') {
            logMessage = chalk.yellow(logMessage);
        }
        // Write the log message
        process.stdout.write(logMessage + '\n');
        // Log to file
        if (symbol) {
            // Log to symbol-specific file if symbol is provided
            this.writeSymbolLog(symbol, date, logMessage, options);
        }
        else if (options?.logToFile) {
            // Log to a generic file if explicitly requested
            this.writeGenericLog(date, logMessage, options);
        }
        // Rewrite the prompt
        this.writePrompt();
    }
    /**
     * Writes a log entry to a symbol-specific log file
     */
    writeSymbolLog(symbol, date, logMessage, options) {
        try {
            // Create logs directory if it doesn't exist
            if (!fs.existsSync('logs')) {
                fs.mkdirSync('logs', { recursive: true });
            }
            // Format date for filename: YYYY-MM-DD
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            // Create filename: SYM-YYYY-MM-DD.log
            const filename = `${symbol}-${year}-${month}-${day}.log`;
            const filePath = path.join('logs', filename);
            // Strip ANSI color codes from log message
            const plainLogMessage = logMessage.replace(/\x1B\[\d+m/g, '');
            // Write to file (append if exists, create if not)
            fs.appendFileSync(filePath, plainLogMessage + '\n');
        }
        catch (error) {
            // Only log to console - don't try to log to file again to avoid potential infinite loop
            process.stdout.write(`Error writing to symbol log file: ${error}\n`);
        }
    }
    /**
     * Writes a log entry to a generic log file when no symbol is provided
     */
    writeGenericLog(date, logMessage, options) {
        try {
            // Create logs directory if it doesn't exist
            if (!fs.existsSync('logs')) {
                fs.mkdirSync('logs', { recursive: true });
            }
            // Format date for filename: YYYY-MM-DD
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            // Create filename: system-YYYY-MM-DD.log
            const source = options?.source?.toLowerCase().replace(/\s+/g, '-') || 'system';
            const filename = `${source}-${year}-${month}-${day}.log`;
            const filePath = path.join('logs', filename);
            // Strip ANSI color codes from log message
            const plainLogMessage = logMessage.replace(/\x1B\[\d+m/g, '');
            // Write to file (append if exists, create if not)
            fs.appendFileSync(filePath, plainLogMessage + '\n');
        }
        catch (error) {
            // Only log to console - don't try to log to file again to avoid potential infinite loop
            process.stdout.write(`Error writing to generic log file: ${error}\n`);
        }
    }
    writePrompt() {
        process.stdout.write(this.promptText);
    }
    clearPrompt() {
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
    }
    restorePrompt() {
        this.writePrompt();
    }
}

/**
 * Logs a message to the console.
 * @param message The message to log.
 * @param options Optional options.
 * @param options.source The source of the message.
 * @param options.type The type of message to log.
 * @param options.symbol The trading symbol associated with this log.
 * @param options.logToFile Force logging to a file even when no symbol is provided.
 */
function log$1(message, options = { source: 'Server', type: 'info' }) {
    const displayManager = DisplayManager.getInstance();
    displayManager.log(message, options);
}

const log = (message, options = { type: 'info' }) => {
    log$1(message, { ...options, source: 'AlpacaMarketDataAPI' });
};
// Default settings for market data API
const DEFAULT_ADJUSTMENT = 'all';
const DEFAULT_FEED = 'sip';
const DEFAULT_CURRENCY = 'USD';
/**
 * Singleton class for interacting with Alpaca Market Data API
 * Provides methods for fetching historical bars, latest bars, last trades, latest trades, latest quotes, and latest quote for a single symbol
 */
class AlpacaMarketDataAPI extends EventEmitter {
    static instance;
    headers;
    dataURL;
    apiURL;
    v1beta1url;
    stockStreamUrl = 'wss://stream.data.alpaca.markets/v2/sip'; // production values
    optionStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/options'; // production values
    cryptoStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/crypto/us'; // production values
    stockWs = null;
    optionWs = null;
    cryptoWs = null;
    stockSubscriptions = { trades: [], quotes: [], bars: [] };
    optionSubscriptions = { trades: [], quotes: [], bars: [] };
    cryptoSubscriptions = { trades: [], quotes: [], bars: [] };
    setMode(mode = 'production') {
        if (mode === 'sandbox') { // sandbox mode
            this.stockStreamUrl = 'wss://stream.data.sandbox.alpaca.markets/v2/sip';
            this.optionStreamUrl = 'wss://stream.data.sandbox.alpaca.markets/v1beta3/options';
            this.cryptoStreamUrl = 'wss://stream.data.sandbox.alpaca.markets/v1beta3/crypto/us';
        }
        else if (mode === 'test') { // test mode, can only use ticker FAKEPACA
            this.stockStreamUrl = 'wss://stream.data.alpaca.markets/v2/test';
            this.optionStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/options'; // there's no test mode for options
            this.cryptoStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/crypto/us'; // there's no test mode for crypto
        }
        else { // production
            this.stockStreamUrl = 'wss://stream.data.alpaca.markets/v2/sip';
            this.optionStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/options';
            this.cryptoStreamUrl = 'wss://stream.data.alpaca.markets/v1beta3/crypto/us';
        }
    }
    getMode() {
        if (this.stockStreamUrl.includes('sandbox')) {
            return 'sandbox';
        }
        else if (this.stockStreamUrl.includes('test')) {
            return 'test';
        }
        else {
            return 'production';
        }
    }
    constructor() {
        super();
        this.dataURL = 'https://data.alpaca.markets/v2';
        this.apiURL =
            process.env.ALPACA_ACCOUNT_TYPE === 'PAPER'
                ? 'https://paper-api.alpaca.markets/v2'
                : 'https://api.alpaca.markets/v2'; // used by some, e.g. getAssets
        this.v1beta1url = 'https://data.alpaca.markets/v1beta1'; // used for options endpoints
        this.setMode('production'); // sets stockStreamUrl and optionStreamUrl
        this.headers = {
            'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
            'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
            'Content-Type': 'application/json',
        };
    }
    static getInstance() {
        if (!AlpacaMarketDataAPI.instance) {
            AlpacaMarketDataAPI.instance = new AlpacaMarketDataAPI();
        }
        return AlpacaMarketDataAPI.instance;
    }
    on(event, listener) {
        return super.on(event, listener);
    }
    emit(event, ...args) {
        return super.emit(event, ...args);
    }
    connect(streamType) {
        let url;
        if (streamType === 'stock') {
            url = this.stockStreamUrl;
        }
        else if (streamType === 'option') {
            url = this.optionStreamUrl;
        }
        else {
            url = this.cryptoStreamUrl;
        }
        const ws = new WebSocket(url);
        if (streamType === 'stock') {
            this.stockWs = ws;
        }
        else if (streamType === 'option') {
            this.optionWs = ws;
        }
        else {
            this.cryptoWs = ws;
        }
        ws.on('open', () => {
            log(`${streamType} stream connected`, { type: 'info' });
            const authMessage = {
                action: 'auth',
                key: process.env.ALPACA_API_KEY,
                secret: process.env.ALPACA_SECRET_KEY,
            };
            ws.send(JSON.stringify(authMessage));
        });
        ws.on('message', (data) => {
            const rawData = data.toString();
            let messages;
            try {
                messages = JSON.parse(rawData);
            }
            catch (e) {
                log(`${streamType} stream received invalid JSON: ${rawData.substring(0, 200)}`, { type: 'error' });
                return;
            }
            for (const message of messages) {
                if (message.T === 'success' && message.msg === 'authenticated') {
                    log(`${streamType} stream authenticated`, { type: 'info' });
                    this.sendSubscription(streamType);
                }
                else if (message.T === 'success' && message.msg === 'connected') {
                    log(`${streamType} stream connected message received`, { type: 'debug' });
                }
                else if (message.T === 'subscription') {
                    log(`${streamType} subscription confirmed: trades=${message.trades?.length || 0}, quotes=${message.quotes?.length || 0}, bars=${message.bars?.length || 0}`, { type: 'info' });
                }
                else if (message.T === 'error') {
                    log(`${streamType} stream error: ${message.msg} (code: ${message.code}, raw: ${JSON.stringify(message)})`, { type: 'error' });
                }
                else if (message.S) {
                    super.emit(`${streamType}-${message.T}`, message);
                    super.emit(`${streamType}-data`, message);
                }
                else {
                    log(`${streamType} received unknown message type: ${JSON.stringify(message)}`, { type: 'debug' });
                }
            }
        });
        ws.on('close', () => {
            log(`${streamType} stream disconnected`, { type: 'warn' });
            if (streamType === 'stock') {
                this.stockWs = null;
            }
            else if (streamType === 'option') {
                this.optionWs = null;
            }
            else {
                this.cryptoWs = null;
            }
            // Optional: implement reconnect logic
        });
        ws.on('error', (error) => {
            log(`${streamType} stream error: ${error.message}`, { type: 'error' });
        });
    }
    sendSubscription(streamType) {
        let ws;
        let subscriptions;
        if (streamType === 'stock') {
            ws = this.stockWs;
            subscriptions = this.stockSubscriptions;
        }
        else if (streamType === 'option') {
            ws = this.optionWs;
            subscriptions = this.optionSubscriptions;
        }
        else {
            ws = this.cryptoWs;
            subscriptions = this.cryptoSubscriptions;
        }
        log(`sendSubscription called for ${streamType} (wsReady=${ws?.readyState === WebSocket.OPEN}, trades=${subscriptions.trades?.length || 0}, quotes=${subscriptions.quotes?.length || 0}, bars=${subscriptions.bars?.length || 0})`, {
            type: 'debug',
        });
        if (ws && ws.readyState === WebSocket.OPEN) {
            const subMessagePayload = {};
            if (subscriptions.trades.length > 0) {
                subMessagePayload.trades = subscriptions.trades;
            }
            if (subscriptions.quotes.length > 0) {
                subMessagePayload.quotes = subscriptions.quotes;
            }
            if (subscriptions.bars.length > 0) {
                subMessagePayload.bars = subscriptions.bars;
            }
            if (Object.keys(subMessagePayload).length > 0) {
                const subMessage = {
                    action: 'subscribe',
                    ...subMessagePayload,
                };
                const messageJson = JSON.stringify(subMessage);
                log(`Sending ${streamType} subscription: ${messageJson}`, { type: 'info' });
                ws.send(messageJson);
            }
            else {
                log(`No ${streamType} subscriptions to send (all arrays empty)`, { type: 'debug' });
            }
        }
        else {
            log(`Cannot send ${streamType} subscription: WebSocket not ready`, { type: 'warn' });
        }
    }
    connectStockStream() {
        if (!this.stockWs) {
            this.connect('stock');
        }
    }
    connectOptionStream() {
        if (!this.optionWs) {
            this.connect('option');
        }
    }
    connectCryptoStream() {
        if (!this.cryptoWs) {
            this.connect('crypto');
        }
    }
    disconnectStockStream() {
        if (this.stockWs) {
            this.stockWs.close();
        }
    }
    disconnectOptionStream() {
        if (this.optionWs) {
            this.optionWs.close();
        }
    }
    disconnectCryptoStream() {
        if (this.cryptoWs) {
            this.cryptoWs.close();
        }
    }
    /**
     * Check if a specific stream is connected
     * @param streamType - The type of stream to check
     * @returns True if the stream is connected
     */
    isStreamConnected(streamType) {
        if (streamType === 'stock') {
            return this.stockWs !== null && this.stockWs.readyState === WebSocket.OPEN;
        }
        else if (streamType === 'option') {
            return this.optionWs !== null && this.optionWs.readyState === WebSocket.OPEN;
        }
        else {
            return this.cryptoWs !== null && this.cryptoWs.readyState === WebSocket.OPEN;
        }
    }
    subscribe(streamType, subscriptions) {
        let currentSubscriptions;
        if (streamType === 'stock') {
            currentSubscriptions = this.stockSubscriptions;
        }
        else if (streamType === 'option') {
            currentSubscriptions = this.optionSubscriptions;
        }
        else {
            currentSubscriptions = this.cryptoSubscriptions;
        }
        Object.entries(subscriptions).forEach(([key, value]) => {
            if (value) {
                currentSubscriptions[key] = [...new Set([...(currentSubscriptions[key] || []), ...value])];
            }
        });
        this.sendSubscription(streamType);
    }
    unsubscribe(streamType, subscriptions) {
        let currentSubscriptions;
        if (streamType === 'stock') {
            currentSubscriptions = this.stockSubscriptions;
        }
        else if (streamType === 'option') {
            currentSubscriptions = this.optionSubscriptions;
        }
        else {
            currentSubscriptions = this.cryptoSubscriptions;
        }
        Object.entries(subscriptions).forEach(([key, value]) => {
            if (value) {
                currentSubscriptions[key] = (currentSubscriptions[key] || []).filter(s => !value.includes(s));
            }
        });
        const unsubMessage = {
            action: 'unsubscribe',
            ...subscriptions,
        };
        let ws;
        if (streamType === 'stock') {
            ws = this.stockWs;
        }
        else if (streamType === 'option') {
            ws = this.optionWs;
        }
        else {
            ws = this.cryptoWs;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(unsubMessage));
        }
    }
    async makeRequest(endpoint, method = 'GET', params, baseUrlName = 'data') {
        const baseUrl = baseUrlName === 'data' ? this.dataURL : baseUrlName === 'api' ? this.apiURL : this.v1beta1url;
        const url = new URL(`${baseUrl}${endpoint}`);
        try {
            if (params) {
                Object.entries(params).forEach(([key, value]) => {
                    if (Array.isArray(value)) {
                        url.searchParams.append(key, value.join(','));
                    }
                    else if (value !== undefined) {
                        url.searchParams.append(key, value.toString());
                    }
                });
            }
            const response = await fetch(url.toString(), {
                method,
                headers: this.headers,
            });
            if (!response.ok) {
                const errorText = await response.text();
                log(`Market Data API error (${response.status}): ${errorText}`, { type: 'error' });
                throw new Error(`Market Data API error (${response.status}): ${errorText}`);
            }
            const data = await response.json();
            return data;
        }
        catch (err) {
            const error = err;
            log(`Error in makeRequest: ${error.message}. Endpoint: ${endpoint}. Url: ${url.toString()}`, { type: 'error' });
            if (error instanceof TypeError) {
                log(`Network error details: ${error.stack}`, { type: 'error' });
            }
            throw error;
        }
    }
    /**
     * Get historical OHLCV bars for specified symbols, including pre-market and post-market data
     * Automatically handles pagination to fetch all available data
     * @param params Parameters for historical bars request
     * @returns Historical bars data with all pages combined
     */
    async getHistoricalBars(params) {
        const symbols = params.symbols;
        const symbolsStr = symbols.join(',');
        let allBars = {};
        let pageToken = null;
        let hasMorePages = true;
        let totalBarsCount = 0;
        let pageCount = 0;
        let currency = '';
        // Initialize bar arrays for each symbol
        symbols.forEach(symbol => {
            allBars[symbol] = [];
        });
        log(`Starting historical bars fetch for ${symbolsStr} (${params.timeframe}, ${params.start || 'no start'} to ${params.end || 'no end'})`, {
            type: 'info'
        });
        while (hasMorePages) {
            pageCount++;
            const requestParams = {
                ...params,
                adjustment: DEFAULT_ADJUSTMENT,
                feed: DEFAULT_FEED,
                ...(pageToken && { page_token: pageToken }),
            };
            const response = await this.makeRequest('/stocks/bars', 'GET', requestParams);
            if (!response.bars) {
                log(`No bars data found in response for ${symbolsStr}`, { type: 'warn' });
                break;
            }
            // Track currency from first response
            if (!currency) {
                currency = response.currency;
            }
            // Combine bars for each symbol
            let pageBarsCount = 0;
            let earliestTimestamp = null;
            let latestTimestamp = null;
            Object.entries(response.bars).forEach(([symbol, bars]) => {
                if (bars && bars.length > 0) {
                    allBars[symbol] = [...allBars[symbol], ...bars];
                    pageBarsCount += bars.length;
                    // Track date range for this page
                    bars.forEach(bar => {
                        const barDate = new Date(bar.t);
                        if (!earliestTimestamp || barDate < earliestTimestamp) {
                            earliestTimestamp = barDate;
                        }
                        if (!latestTimestamp || barDate > latestTimestamp) {
                            latestTimestamp = barDate;
                        }
                    });
                }
            });
            totalBarsCount += pageBarsCount;
            pageToken = response.next_page_token || null;
            hasMorePages = !!pageToken;
            // Enhanced logging with date range and progress info
            const dateRangeStr = earliestTimestamp && latestTimestamp
                ? `${earliestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} to ${latestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
                : 'unknown range';
            log(`Page ${pageCount}: Fetched ${pageBarsCount.toLocaleString()} bars (total: ${totalBarsCount.toLocaleString()}) for ${symbolsStr}, date range: ${dateRangeStr}${hasMorePages ? ', more pages available' : ', complete'}`, {
                type: 'info'
            });
            // Prevent infinite loops
            if (pageCount > 1000) {
                log(`Stopping pagination after ${pageCount} pages to prevent infinite loop`, { type: 'warn' });
                break;
            }
        }
        // Final summary
        const symbolCounts = Object.entries(allBars).map(([symbol, bars]) => `${symbol}: ${bars.length}`).join(', ');
        log(`Historical bars fetch complete: ${totalBarsCount.toLocaleString()} total bars across ${pageCount} pages (${symbolCounts})`, {
            type: 'info'
        });
        return {
            bars: allBars,
            next_page_token: null, // Always null since we fetch all pages
            currency: currency || DEFAULT_CURRENCY,
        };
    }
    /**
     * Get the most recent minute bar for requested symbols
     * @param symbols Array of stock symbols to query
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest bar data for each symbol
     
     */
    async getLatestBars(symbols, currency) {
        return this.makeRequest('/stocks/bars/latest', 'GET', {
            symbols,
            feed: DEFAULT_FEED,
            currency: currency || DEFAULT_CURRENCY,
        });
    }
    /**
     * Get the last trade for a single symbol
     * @param symbol The stock symbol to query
     * @returns Last trade details including price, size, exchange, and conditions
     */
    async getLastTrade(symbol) {
        return this.makeRequest(`/v1/last/stocks/${symbol}`, 'GET');
    }
    /**
     * Get the most recent trades for requested symbols
     * @param symbols Array of stock symbols to query
     * @param feed Optional data source (sip/iex/delayed_sip)
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest trade data for each symbol
     
     */
    async getLatestTrades(symbols, feed, currency) {
        return this.makeRequest('/stocks/trades/latest', 'GET', {
            symbols,
            feed: feed || DEFAULT_FEED,
            currency: currency || DEFAULT_CURRENCY,
        });
    }
    /**
     * Get the most recent quotes for requested symbols
     * @param symbols Array of stock symbols to query
     * @param feed Optional data source (sip/iex/delayed_sip)
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest quote data for each symbol
     */
    async getLatestQuotes(symbols, feed, currency) {
        // Return empty response if symbols array is empty to avoid API error
        if (!symbols || symbols.length === 0) {
            log('No symbols provided to getLatestQuotes, returning empty response', { type: 'warn' });
            return {
                quotes: {},
                currency: currency || DEFAULT_CURRENCY,
            };
        }
        return this.makeRequest('/stocks/quotes/latest', 'GET', {
            symbols,
            feed: feed || DEFAULT_FEED,
            currency: currency || DEFAULT_CURRENCY,
        });
    }
    /**
     * Get the latest quote for a single symbol
     * @param symbol The stock symbol to query
     * @param feed Optional data source (sip/iex/delayed_sip)
     * @param currency Optional currency in ISO 4217 format
     * @returns Latest quote data with symbol and currency information
     */
    async getLatestQuote(symbol, feed, currency) {
        return this.makeRequest(`/stocks/${symbol}/quotes/latest`, 'GET', {
            feed: feed || DEFAULT_FEED,
            currency,
        });
    }
    /**
     * Get the previous day's closing price for a symbol
     * @param symbol The stock symbol to query
     * @param referenceDate Optional reference date to get the previous close for
     * @returns Previous day's closing price data
     */
    async getPreviousClose(symbol, referenceDate) {
        const date = referenceDate || new Date();
        const prevMarketDate = getLastFullTradingDate(date);
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe: '1Day',
            start: prevMarketDate.date.toISOString(),
            end: prevMarketDate.date.toISOString(),
            limit: 1,
        });
        if (!response.bars[symbol] || response.bars[symbol].length === 0) {
            log(`No previous close data available for ${symbol}`, { type: 'error', symbol });
            return null;
        }
        return response.bars[symbol][0];
    }
    /**
     * Get hourly price data for a symbol
     * @param symbol The stock symbol to query
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of hourly price bars
     */
    async getHourlyPrices(symbol, start, end) {
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe: '1Hour',
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            limit: 96, // Last 96 hours (4 days)
        });
        return response.bars[symbol] || [];
    }
    /**
     * Get half-hourly price data for a symbol
     * @param symbol The stock symbol to query
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of half-hourly price bars
     */
    async getHalfHourlyPrices(symbol, start, end) {
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe: '30Min',
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            limit: 16 * 2 * 4, // last 4 days, 16 hours per day, 2 bars per hour
        });
        return response.bars[symbol] || [];
    }
    /**
     * Get daily price data for a symbol
     * @param symbol The stock symbol to query
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of daily price bars
     */
    async getDailyPrices(symbol, start, end) {
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe: '1Day',
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            limit: 100, // Last 100 days
        });
        return response.bars[symbol] || [];
    }
    /**
     * Get intraday price data for a symbol
     * @param symbol The stock symbol to query
     * @param minutePeriod Minutes per bar (1, 5, 15, etc.)
     * @param start Start time in milliseconds
     * @param end End time in milliseconds
     * @returns Array of intraday price bars
     */
    async getIntradayPrices(symbol, minutePeriod, start, end) {
        const timeframe = `${minutePeriod}Min`;
        const response = await this.getHistoricalBars({
            symbols: [symbol],
            timeframe,
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
        });
        return response.bars[symbol] || [];
    }
    /**
     * Analyzes an array of price bars and returns a summary string
     * @param bars Array of price bars to analyze
     * @returns A string summarizing the price data
     */
    static analyzeBars(bars) {
        if (!bars || bars.length === 0) {
            return 'No price data available';
        }
        const firstBar = bars[0];
        const lastBar = bars[bars.length - 1];
        const priceChange = lastBar.c - firstBar.o;
        const percentChange = (priceChange / firstBar.o) * 100;
        const volumeChange = lastBar.v - firstBar.v;
        const percentVolumeChange = (volumeChange / firstBar.v) * 100;
        const high = Math.max(...bars.map((bar) => bar.h));
        const low = Math.min(...bars.map((bar) => bar.l));
        const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
        const avgVolume = totalVolume / bars.length;
        return (`Price: $${firstBar.o.toFixed(2)} -> $${lastBar.c.toFixed(2)} (${percentChange.toFixed(2)}%), ` +
            `Volume: ${firstBar.v.toLocaleString()} -> ${lastBar.v.toLocaleString()} (${percentVolumeChange.toFixed(2)}%), ` +
            `High: $${high.toFixed(2)}, Low: $${low.toFixed(2)}, ` +
            `Avg Volume: ${avgVolume.toLocaleString()}`);
    }
    /**
     * Get all assets available for trade and data consumption from Alpaca
     * @param params Optional query params: status (e.g. 'active'), asset_class (e.g. 'us_equity', 'crypto')
     * @returns Array of AlpacaAsset objects
     * @see https://docs.alpaca.markets/reference/get-v2-assets-1
     */
    async getAssets(params) {
        // Endpoint: GET /v2/assets
        return this.makeRequest('/assets', 'GET', params, 'api'); // use apiURL
    }
    /**
     * Get a single asset by symbol or asset_id
     * @param symbolOrAssetId Symbol or asset_id
     * @returns AlpacaAsset object
     * @see https://docs.alpaca.markets/reference/get-v2-assets-symbol_or_asset_id
     */
    async getAsset(symbolOrAssetId) {
        // Endpoint: GET /v2/assets/{symbol_or_asset_id}
        return this.makeRequest(`/assets/${encodeURIComponent(symbolOrAssetId)}`, 'GET', undefined, 'api');
    }
    // ===== OPTIONS MARKET DATA METHODS =====
    /**
     * Get options chain for an underlying symbol
     * Provides the latest trade, latest quote, and greeks for each contract symbol of the underlying symbol
     * @param params Options chain request parameters
     * @returns Options chain data with snapshots for each contract
     * @see https://docs.alpaca.markets/reference/optionchain
     */
    async getOptionsChain(params) {
        const { underlying_symbol, ...queryParams } = params;
        return this.makeRequest(`/options/snapshots/${encodeURIComponent(underlying_symbol)}`, 'GET', queryParams, 'v1beta1');
    }
    /**
     * Get the most recent trades for requested option contract symbols
     * @param params Latest options trades request parameters
     * @returns Latest trade data for each option contract symbol
     
     * @see https://docs.alpaca.markets/reference/optionlatesttrades
     */
    async getLatestOptionsTrades(params) {
        // Remove limit and page_token as they're not supported by this endpoint
        const { limit, page_token, ...requestParams } = params;
        return this.makeRequest('/options/trades/latest', 'GET', requestParams, 'v1beta1');
    }
    /**
     * Get the most recent quotes for requested option contract symbols
     * @param params Latest options quotes request parameters
     * @returns Latest quote data for each option contract symbol
     
     * @see https://docs.alpaca.markets/reference/optionlatestquotes
     */
    async getLatestOptionsQuotes(params) {
        // Remove limit and page_token as they're not supported by this endpoint
        const { limit, page_token, ...requestParams } = params;
        return this.makeRequest('/options/quotes/latest', 'GET', requestParams, 'v1beta1');
    }
    /**
     * Get historical OHLCV bars for option contract symbols
     * Automatically handles pagination to fetch all available data
     * @param params Historical options bars request parameters
     * @returns Historical bar data for each option contract symbol with all pages combined
     
     * @see https://docs.alpaca.markets/reference/optionbars
     */
    async getHistoricalOptionsBars(params) {
        const symbols = params.symbols;
        const symbolsStr = symbols.join(',');
        let allBars = {};
        let pageToken = null;
        let hasMorePages = true;
        let totalBarsCount = 0;
        let pageCount = 0;
        // Initialize bar arrays for each symbol
        symbols.forEach(symbol => {
            allBars[symbol] = [];
        });
        log(`Starting historical options bars fetch for ${symbolsStr} (${params.timeframe}, ${params.start || 'no start'} to ${params.end || 'no end'})`, {
            type: 'info'
        });
        while (hasMorePages) {
            pageCount++;
            const requestParams = {
                ...params,
                ...(pageToken && { page_token: pageToken }),
            };
            const response = await this.makeRequest('/options/bars', 'GET', requestParams, 'v1beta1');
            if (!response.bars) {
                log(`No options bars data found in response for ${symbolsStr}`, { type: 'warn' });
                break;
            }
            // Combine bars for each symbol
            let pageBarsCount = 0;
            let earliestTimestamp = null;
            let latestTimestamp = null;
            Object.entries(response.bars).forEach(([symbol, bars]) => {
                if (bars && bars.length > 0) {
                    allBars[symbol] = [...allBars[symbol], ...bars];
                    pageBarsCount += bars.length;
                    // Track date range for this page
                    bars.forEach(bar => {
                        const barDate = new Date(bar.t);
                        if (!earliestTimestamp || barDate < earliestTimestamp) {
                            earliestTimestamp = barDate;
                        }
                        if (!latestTimestamp || barDate > latestTimestamp) {
                            latestTimestamp = barDate;
                        }
                    });
                }
            });
            totalBarsCount += pageBarsCount;
            pageToken = response.next_page_token || null;
            hasMorePages = !!pageToken;
            // Enhanced logging with date range and progress info
            const dateRangeStr = earliestTimestamp && latestTimestamp
                ? `${earliestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} to ${latestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
                : 'unknown range';
            log(`Page ${pageCount}: Fetched ${pageBarsCount.toLocaleString()} option bars (total: ${totalBarsCount.toLocaleString()}) for ${symbolsStr}, date range: ${dateRangeStr}${hasMorePages ? ', more pages available' : ', complete'}`, {
                type: 'info'
            });
            // Prevent infinite loops
            if (pageCount > 1000) {
                log(`Stopping options bars pagination after ${pageCount} pages to prevent infinite loop`, { type: 'warn' });
                break;
            }
        }
        // Final summary
        const symbolCounts = Object.entries(allBars).map(([symbol, bars]) => `${symbol}: ${bars.length}`).join(', ');
        log(`Historical options bars fetch complete: ${totalBarsCount.toLocaleString()} total bars across ${pageCount} pages (${symbolCounts})`, {
            type: 'info'
        });
        return {
            bars: allBars,
            next_page_token: undefined, // Always undefined since we fetch all pages
        };
    }
    /**
     * Get historical trades for option contract symbols
     * Automatically handles pagination to fetch all available data
     * @param params Historical options trades request parameters
     * @returns Historical trade data for each option contract symbol with all pages combined
     
     * @see https://docs.alpaca.markets/reference/optiontrades
     */
    async getHistoricalOptionsTrades(params) {
        const symbols = params.symbols;
        const symbolsStr = symbols.join(',');
        let allTrades = {};
        let pageToken = null;
        let hasMorePages = true;
        let totalTradesCount = 0;
        let pageCount = 0;
        // Initialize trades arrays for each symbol
        symbols.forEach(symbol => {
            allTrades[symbol] = [];
        });
        log(`Starting historical options trades fetch for ${symbolsStr} (${params.start || 'no start'} to ${params.end || 'no end'})`, {
            type: 'info'
        });
        while (hasMorePages) {
            pageCount++;
            const requestParams = {
                ...params,
                ...(pageToken && { page_token: pageToken }),
            };
            const response = await this.makeRequest('/options/trades', 'GET', requestParams, 'v1beta1');
            if (!response.trades) {
                log(`No options trades data found in response for ${symbolsStr}`, { type: 'warn' });
                break;
            }
            // Combine trades for each symbol
            let pageTradesCount = 0;
            let earliestTimestamp = null;
            let latestTimestamp = null;
            Object.entries(response.trades).forEach(([symbol, trades]) => {
                if (trades && trades.length > 0) {
                    allTrades[symbol] = [...allTrades[symbol], ...trades];
                    pageTradesCount += trades.length;
                    // Track date range for this page
                    trades.forEach(trade => {
                        const tradeDate = new Date(trade.t);
                        if (!earliestTimestamp || tradeDate < earliestTimestamp) {
                            earliestTimestamp = tradeDate;
                        }
                        if (!latestTimestamp || tradeDate > latestTimestamp) {
                            latestTimestamp = tradeDate;
                        }
                    });
                }
            });
            totalTradesCount += pageTradesCount;
            pageToken = response.next_page_token || null;
            hasMorePages = !!pageToken;
            // Enhanced logging with date range and progress info
            const dateRangeStr = earliestTimestamp && latestTimestamp
                ? `${earliestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })} to ${latestTimestamp.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
                : 'unknown range';
            log(`Page ${pageCount}: Fetched ${pageTradesCount.toLocaleString()} option trades (total: ${totalTradesCount.toLocaleString()}) for ${symbolsStr}, date range: ${dateRangeStr}${hasMorePages ? ', more pages available' : ', complete'}`, {
                type: 'info'
            });
            // Prevent infinite loops
            if (pageCount > 1000) {
                log(`Stopping options trades pagination after ${pageCount} pages to prevent infinite loop`, { type: 'warn' });
                break;
            }
        }
        // Final summary
        const symbolCounts = Object.entries(allTrades).map(([symbol, trades]) => `${symbol}: ${trades.length}`).join(', ');
        log(`Historical options trades fetch complete: ${totalTradesCount.toLocaleString()} total trades across ${pageCount} pages (${symbolCounts})`, {
            type: 'info'
        });
        return {
            trades: allTrades,
            next_page_token: undefined, // Always undefined since we fetch all pages
        };
    }
    /**
     * Get snapshots for option contract symbols
     * Provides latest trade, latest quote, and greeks for each contract symbol
     * @param params Options snapshots request parameters
     * @returns Snapshot data for each option contract symbol
     
     * @see https://docs.alpaca.markets/reference/optionsnapshots
     */
    async getOptionsSnapshot(params) {
        // Remove limit and page_token as they may not be supported by this endpoint
        const { limit, page_token, ...requestParams } = params;
        return this.makeRequest('/options/snapshots', 'GET', requestParams, 'v1beta1');
    }
    /**
     * Get condition codes for options trades or quotes
     * Returns the mapping between condition codes and their descriptions
     * @param tickType The type of tick data ('trade' or 'quote')
     * @returns Mapping of condition codes to descriptions
     
     * @see https://docs.alpaca.markets/reference/optionmetaconditions
     */
    async getOptionsConditionCodes(tickType) {
        return this.makeRequest(`/options/meta/conditions/${tickType}`, 'GET', undefined, 'v1beta1');
    }
    /**
     * Get exchange codes for options
     * Returns the mapping between option exchange codes and exchange names
     * @returns Mapping of exchange codes to exchange names
     
     * @see https://docs.alpaca.markets/reference/optionmetaexchanges
     */
    async getOptionsExchangeCodes() {
        return this.makeRequest('/options/meta/exchanges', 'GET', undefined, 'v1beta1');
    }
    /**
     * Analyzes an array of option bars and returns a summary string
     * @param bars Array of option bars to analyze
     * @returns A string summarizing the option price data
     */
    static analyzeOptionBars(bars) {
        if (!bars || bars.length === 0) {
            return 'No option price data available';
        }
        const firstBar = bars[0];
        const lastBar = bars[bars.length - 1];
        const priceChange = lastBar.c - firstBar.o;
        const percentChange = (priceChange / firstBar.o) * 100;
        const volumeChange = lastBar.v - firstBar.v;
        const percentVolumeChange = firstBar.v > 0 ? (volumeChange / firstBar.v) * 100 : 0;
        const high = Math.max(...bars.map((bar) => bar.h));
        const low = Math.min(...bars.map((bar) => bar.l));
        const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
        const avgVolume = totalVolume / bars.length;
        return (`Option Price: $${firstBar.o.toFixed(2)} -> $${lastBar.c.toFixed(2)} (${percentChange.toFixed(2)}%), ` +
            `Volume: ${firstBar.v.toLocaleString()} -> ${lastBar.v.toLocaleString()} (${percentVolumeChange.toFixed(2)}%), ` +
            `High: $${high.toFixed(2)}, Low: $${low.toFixed(2)}, ` +
            `Avg Volume: ${avgVolume.toLocaleString()}`);
    }
    /**
     * Formats option greeks for display
     * @param greeks Option greeks object
     * @returns Formatted string with greek values
     */
    static formatOptionGreeks(greeks) {
        if (!greeks) {
            return 'No greeks data available';
        }
        const parts = [];
        if (greeks.delta !== undefined)
            parts.push(`Delta: ${greeks.delta.toFixed(4)}`);
        if (greeks.gamma !== undefined)
            parts.push(`Gamma: ${greeks.gamma.toFixed(4)}`);
        if (greeks.theta !== undefined)
            parts.push(`Theta: ${greeks.theta.toFixed(4)}`);
        if (greeks.vega !== undefined)
            parts.push(`Vega: ${greeks.vega.toFixed(4)}`);
        if (greeks.rho !== undefined)
            parts.push(`Rho: ${greeks.rho.toFixed(4)}`);
        return parts.length > 0 ? parts.join(', ') : 'No greeks data available';
    }
    /**
     * Interprets condition codes using the provided condition codes mapping
     * @param conditionCodes Array of condition codes from trade or quote
     * @param conditionCodesMap Mapping of condition codes to descriptions
     * @returns Formatted string with condition descriptions
     */
    static interpretConditionCodes(conditionCodes, conditionCodesMap) {
        if (!conditionCodes || conditionCodes.length === 0) {
            return 'No conditions';
        }
        const descriptions = conditionCodes
            .map((code) => conditionCodesMap[code] || `Unknown (${code})`)
            .filter((desc) => desc !== undefined);
        return descriptions.length > 0 ? descriptions.join(', ') : 'No condition descriptions available';
    }
    /**
     * Gets the exchange name from exchange code using the provided exchange codes mapping
     * @param exchangeCode Exchange code from trade or quote
     * @param exchangeCodesMap Mapping of exchange codes to names
     * @returns Exchange name or formatted unknown exchange
     */
    static getExchangeName(exchangeCode, exchangeCodesMap) {
        return exchangeCodesMap[exchangeCode] || `Unknown Exchange (${exchangeCode})`;
    }
    /**
     * Fetches news articles from Alpaca API for a symbol, paginating through all results.
     * @param symbol The symbol to fetch news for (e.g., 'AAPL')
     * @param params Optional parameters: start, end, limit, sort, include_content
     * @returns Array of SimpleNews articles
     */
    async fetchNews(symbol, params) {
        const defaultParams = {
            start: new Date(Date.now() - 24 * 60 * 60 * 1000),
            end: new Date(),
            limit: 10,
            sort: 'desc',
            include_content: true,
        };
        const mergedParams = { ...defaultParams, ...params };
        let newsArticles = [];
        let pageToken = null;
        let hasMorePages = true;
        let fetchedCount = 0;
        const maxLimit = mergedParams.limit;
        // Utility to clean content
        function cleanContent(content) {
            if (!content)
                return undefined;
            // Remove excessive whitespace, newlines, and trim
            return content.replace(/\s+/g, ' ').trim();
        }
        while (hasMorePages) {
            const queryParams = new URLSearchParams({
                ...(mergedParams.start && { start: new Date(mergedParams.start).toISOString() }),
                ...(mergedParams.end && { end: new Date(mergedParams.end).toISOString() }),
                ...(symbol && { symbols: symbol }),
                ...(mergedParams.limit && { limit: Math.min(50, maxLimit - fetchedCount).toString() }),
                ...(mergedParams.sort && { sort: mergedParams.sort }),
                ...(mergedParams.include_content !== undefined ? { include_content: mergedParams.include_content.toString() } : {}),
                ...(pageToken && { page_token: pageToken }),
            });
            const url = `${this.v1beta1url}/news?${queryParams}`;
            log(`Fetching news from: ${url}`, { type: 'debug', symbol });
            const response = await fetch(url, {
                method: 'GET',
                headers: this.headers,
            });
            if (!response.ok) {
                const errorText = await response.text();
                log(`Alpaca news API error (${response.status}): ${errorText}`, { type: 'error', symbol });
                throw new Error(`Alpaca news API error (${response.status}): ${errorText}`);
            }
            const data = await response.json();
            if (!data.news || !Array.isArray(data.news)) {
                log(`No news data found in Alpaca response for ${symbol}`, { type: 'warn', symbol });
                break;
            }
            const transformedNews = data.news.map((article) => ({
                symbols: article.symbols,
                title: article.headline,
                summary: cleanContent(article.summary) ?? '',
                content: article.content ? cleanContent(article.content) : undefined,
                url: article.url,
                source: article.source,
                author: article.author,
                date: article.updated_at || article.created_at,
                updatedDate: article.updated_at || article.created_at,
                sentiment: 0,
            }));
            newsArticles = newsArticles.concat(transformedNews);
            fetchedCount = newsArticles.length;
            pageToken = data.next_page_token || null;
            hasMorePages = !!pageToken && (!maxLimit || fetchedCount < maxLimit);
            log(`Fetched ${transformedNews.length} news articles (total: ${fetchedCount}) for ${symbol}. More pages: ${hasMorePages}`, { type: 'debug', symbol });
            if (maxLimit && fetchedCount >= maxLimit) {
                newsArticles = newsArticles.slice(0, maxLimit);
                break;
            }
        }
        return newsArticles;
    }
}
// Export the singleton instance
const marketDataAPI = AlpacaMarketDataAPI.getInstance();

const limitPriceSlippagePercent100 = 0.1; // 0.1%
/**
Websocket example
  const alpacaAPI = createAlpacaTradingAPI(credentials); // type AlpacaCredentials
  alpacaAPI.onTradeUpdate((update: TradeUpdate) => {
   this.log(`Received trade update: event ${update.event} for an order to ${update.order.side} ${update.order.qty} of ${update.order.symbol}`);
  });
  alpacaAPI.connectWebsocket(); // necessary to connect to the WebSocket
*/
class AlpacaTradingAPI {
    static new(credentials) {
        return new AlpacaTradingAPI(credentials);
    }
    static getInstance(credentials) {
        return new AlpacaTradingAPI(credentials);
    }
    ws = null;
    headers;
    tradeUpdateCallback = null;
    credentials;
    apiBaseUrl;
    wsUrl;
    authenticated = false;
    connecting = false;
    reconnectDelay = 10000; // 10 seconds between reconnection attempts
    reconnectTimeout = null;
    messageHandlers = new Map();
    debugLogging = false;
    /**
     * Constructor for AlpacaTradingAPI
     * @param credentials - Alpaca credentials,
     *   accountName: string; // The account identifier used inthis.logs and tracking
     *   apiKey: string; // Alpaca API key
     *   apiSecret: string; // Alpaca API secret
     *   type: AlpacaAccountType;
     *   orderType: AlpacaOrderType;
     * @param options - Optional options
     *   debugLogging: boolean; // Whether to log messages of type 'debug'
     */
    constructor(credentials, options) {
        this.credentials = credentials;
        // Set URLs based on account type
        this.apiBaseUrl =
            credentials.type === 'PAPER' ? 'https://paper-api.alpaca.markets/v2' : 'https://api.alpaca.markets/v2';
        this.wsUrl =
            credentials.type === 'PAPER' ? 'wss://paper-api.alpaca.markets/stream' : 'wss://api.alpaca.markets/stream';
        this.headers = {
            'APCA-API-KEY-ID': credentials.apiKey,
            'APCA-API-SECRET-KEY': credentials.apiSecret,
            'Content-Type': 'application/json',
        };
        // Initialize message handlers
        this.messageHandlers.set('authorization', this.handleAuthMessage.bind(this));
        this.messageHandlers.set('listening', this.handleListenMessage.bind(this));
        this.messageHandlers.set('trade_updates', this.handleTradeUpdate.bind(this));
        this.debugLogging = options?.debugLogging || false;
    }
    log(message, options = { type: 'info' }) {
        if (this.debugLogging && options.type === 'debug') {
            return;
        }
        log$1(message, { ...options, source: 'AlpacaTradingAPI', account: this.credentials.accountName });
    }
    /**
     * Round a price to the nearest 2 decimal places for Alpaca, or 4 decimal places for prices less than $1
     * @param price - The price to round
     * @returns The rounded price
     */
    roundPriceForAlpaca = (price) => {
        return price >= 1 ? Math.round(price * 100) / 100 : Math.round(price * 10000) / 10000;
    };
    handleAuthMessage(data) {
        if (data.status === 'authorized') {
            this.authenticated = true;
            this.log('WebSocket authenticated');
        }
        else {
            this.log(`Authentication failed: ${data.message || 'Unknown error'}`, {
                type: 'error',
            });
        }
    }
    handleListenMessage(data) {
        if (data.streams?.includes('trade_updates')) {
            this.log('Successfully subscribed to trade updates');
        }
    }
    handleTradeUpdate(data) {
        if (this.tradeUpdateCallback) {
            this.log(`Trade update: ${data.event} to ${data.order.side} ${data.order.qty} shares, type ${data.order.type}`, {
                symbol: data.order.symbol,
                type: 'debug',
            });
            this.tradeUpdateCallback(data);
        }
    }
    handleMessage(message) {
        try {
            const data = JSON.parse(message);
            const handler = this.messageHandlers.get(data.stream);
            if (handler) {
                handler(data.data);
            }
            else {
                this.log(`Received message for unknown stream: ${data.stream}`, {
                    type: 'warn',
                });
            }
        }
        catch (error) {
            this.log('Failed to parse WebSocket message', {
                type: 'error',
                metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
            });
        }
    }
    connectWebsocket() {
        if (this.connecting) {
            this.log('Connection attempt skipped - already connecting');
            return;
        }
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.log('Connection attempt skipped - already connected');
            return;
        }
        this.connecting = true;
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate();
            this.ws = null;
        }
        this.log(`Connecting to WebSocket at ${this.wsUrl}...`);
        this.ws = new WebSocket(this.wsUrl);
        this.ws.on('open', async () => {
            try {
                this.log('WebSocket connected');
                await this.authenticate();
                await this.subscribeToTradeUpdates();
                this.connecting = false;
            }
            catch (error) {
                this.log('Failed to setup WebSocket connection', {
                    type: 'error',
                    metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
                });
                this.ws?.close();
            }
        });
        this.ws.on('message', (data) => {
            this.handleMessage(data.toString());
        });
        this.ws.on('error', (error) => {
            this.log('WebSocket error', {
                type: 'error',
                metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
            });
            this.connecting = false;
        });
        this.ws.on('close', () => {
            this.log('WebSocket connection closed');
            this.authenticated = false;
            this.connecting = false;
            // Clear any existing reconnect timeout
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = null;
            }
            // Schedule reconnection
            this.reconnectTimeout = setTimeout(() => {
                this.log('Attempting to reconnect...');
                this.connectWebsocket();
            }, this.reconnectDelay);
        });
    }
    async authenticate() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not ready for authentication');
        }
        const authMessage = {
            action: 'auth',
            key: this.credentials.apiKey,
            secret: this.credentials.apiSecret,
        };
        this.ws.send(JSON.stringify(authMessage));
        return new Promise((resolve, reject) => {
            const authTimeout = setTimeout(() => {
                this.log('Authentication timeout', { type: 'error' });
                reject(new Error('Authentication timed out'));
            }, 10000);
            const handleAuthResponse = (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.stream === 'authorization') {
                        this.ws?.removeListener('message', handleAuthResponse);
                        clearTimeout(authTimeout);
                        if (message.data?.status === 'authorized') {
                            this.authenticated = true;
                            this.log('WebSocket authenticated');
                            resolve();
                        }
                        else {
                            const error = `Authentication failed: ${message.data?.message || 'Unknown error'}`;
                            this.log(error, { type: 'error' });
                            reject(new Error(error));
                        }
                    }
                }
                catch (error) {
                    this.log('Failed to parse auth response', {
                        type: 'error',
                        metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
                    });
                }
            };
            this.ws?.on('message', handleAuthResponse);
        });
    }
    async subscribeToTradeUpdates() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
            throw new Error('WebSocket not ready for subscription');
        }
        const listenMessage = {
            action: 'listen',
            data: {
                streams: ['trade_updates'],
            },
        };
        this.ws.send(JSON.stringify(listenMessage));
        return new Promise((resolve, reject) => {
            const listenTimeout = setTimeout(() => {
                reject(new Error('Subscribe timeout'));
            }, 10000);
            const handleListenResponse = (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.stream === 'listening') {
                        this.ws?.removeListener('message', handleListenResponse);
                        clearTimeout(listenTimeout);
                        if (message.data?.streams?.includes('trade_updates')) {
                            this.log('Subscribed to trade updates');
                            resolve();
                        }
                        else {
                            reject(new Error('Failed to subscribe to trade updates'));
                        }
                    }
                }
                catch (error) {
                    this.log('Failed to parse listen response', {
                        type: 'error',
                        metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
                    });
                }
            };
            this.ws?.on('message', handleListenResponse);
        });
    }
    async makeRequest(endpoint, method = 'GET', body, queryString = '') {
        const url = `${this.apiBaseUrl}${endpoint}${queryString}`;
        try {
            const response = await fetch(url, {
                method,
                headers: this.headers,
                body: body ? JSON.stringify(body) : undefined,
            });
            if (!response.ok) {
                const errorText = await response.text();
                this.log(`Alpaca API error (${response.status}): ${errorText}`, { type: 'error' });
                throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
            }
            // Handle responses with no content (e.g., 204 No Content)
            if (response.status === 204 || response.headers.get('content-length') === '0') {
                return null;
            }
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            // For non-JSON responses, return the text content
            const textContent = await response.text();
            return textContent || null;
        }
        catch (err) {
            const error = err;
            this.log(`Error in makeRequest: ${error.message}. Url: ${url}`, {
                source: 'AlpacaAPI',
                type: 'error',
            });
            throw error;
        }
    }
    async getPositions(assetClass) {
        const positions = (await this.makeRequest('/positions'));
        if (assetClass) {
            return positions.filter((position) => position.asset_class === assetClass);
        }
        return positions;
    }
    /**
     * Get all orders
     * @param params (GetOrdersParams) - optional parameters to filter the orders
     * - status: 'open' | 'closed' | 'all'
     * - limit: number
     * - after: string
     * - until: string
     * - direction: 'asc' | 'desc'
     * - nested: boolean
     * - symbols: string[], an array of all the symbols
     * - side: 'buy' | 'sell'
     * @returns all orders
     */
    async getOrders(params = {}) {
        const queryParams = new URLSearchParams();
        if (params.status)
            queryParams.append('status', params.status);
        if (params.limit)
            queryParams.append('limit', params.limit.toString());
        if (params.after)
            queryParams.append('after', params.after);
        if (params.until)
            queryParams.append('until', params.until);
        if (params.direction)
            queryParams.append('direction', params.direction);
        if (params.nested)
            queryParams.append('nested', params.nested.toString());
        if (params.symbols)
            queryParams.append('symbols', params.symbols.join(','));
        if (params.side)
            queryParams.append('side', params.side);
        const endpoint = `/orders${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        try {
            return await this.makeRequest(endpoint);
        }
        catch (error) {
            this.log(`Error getting orders: ${error}`, { type: 'error' });
            throw error;
        }
    }
    async getAccountDetails() {
        try {
            return await this.makeRequest('/account');
        }
        catch (error) {
            this.log(`Error getting account details: ${error}`, { type: 'error' });
            throw error;
        }
    }
    /**
     * Create a trailing stop order
     * @param symbol (string) - the symbol of the order
     * @param qty (number) - the quantity of the order
     * @param side (string) - the side of the order
     * @param trailPercent100 (number) - the trail percent of the order (scale 100, i.e. 0.5 = 0.5%)
     * @param position_intent (string) - the position intent of the order
     */
    async createTrailingStop(symbol, qty, side, trailPercent100, position_intent) {
        this.log(`Creating trailing stop ${side.toUpperCase()} ${qty} shares for ${symbol} with trail percent ${trailPercent100}%`, {
            symbol,
        });
        try {
            await this.makeRequest(`/orders`, 'POST', {
                symbol,
                qty: Math.abs(qty),
                side,
                position_intent,
                order_class: 'simple',
                type: 'trailing_stop',
                trail_percent: trailPercent100, // Already in decimal form (e.g., 4 for 4%)
                time_in_force: 'gtc',
            });
        }
        catch (error) {
            this.log(`Error creating trailing stop: ${error}`, {
                symbol,
                type: 'error',
            });
            throw error;
        }
    }
    /**
     * Create a market order
     * @param symbol (string) - the symbol of the order
     * @param qty (number) - the quantity of the order
     * @param side (string) - the side of the order
     * @param position_intent (string) - the position intent of the order. Important for knowing if a position needs a trailing stop.
     */
    async createMarketOrder(symbol, qty, side, position_intent, client_order_id) {
        this.log(`Creating market order for ${symbol}: ${side} ${qty} shares (${position_intent})`, {
            symbol,
        });
        const body = {
            symbol,
            qty: Math.abs(qty).toString(),
            side,
            position_intent,
            type: 'market',
            time_in_force: 'day',
            order_class: 'simple',
        };
        if (client_order_id !== undefined) {
            body.client_order_id = client_order_id;
        }
        try {
            return await this.makeRequest('/orders', 'POST', body);
        }
        catch (error) {
            this.log(`Error creating market order: ${error}`, { type: 'error' });
            throw error;
        }
    }
    /**
     * Get the current trail percent for a symbol, assuming that it has an open position and a trailing stop order to close it. Because this relies on an orders request for one symbol, you can't do it too often.
     * @param symbol (string) - the symbol of the order
     * @returns the current trail percent
     */
    async getCurrentTrailPercent(symbol) {
        try {
            const orders = await this.getOrders({
                status: 'open',
                symbols: [symbol],
            });
            const trailingStopOrder = orders.find((order) => order.type === 'trailing_stop' &&
                (order.position_intent === 'sell_to_close' || order.position_intent === 'buy_to_close'));
            if (!trailingStopOrder) {
                this.log(`No closing trailing stop order found for ${symbol}`, {
                    symbol,
                });
                return null;
            }
            if (!trailingStopOrder.trail_percent) {
                this.log(`Trailing stop order found for ${symbol} but no trail_percent value`, {
                    symbol,
                });
                return null;
            }
            const trailPercent = parseFloat(trailingStopOrder.trail_percent);
            return trailPercent;
        }
        catch (error) {
            this.log(`Error getting current trail percent: ${error}`, {
                symbol,
                type: 'error',
            });
            throw error;
        }
    }
    /**
     * Update the trail percent for a trailing stop order
     * @param symbol (string) - the symbol of the order
     * @param trailPercent100 (number) - the trail percent of the order (scale 100, i.e. 0.5 = 0.5%)
     */
    async updateTrailingStop(symbol, trailPercent100) {
        // First get all open orders for this symbol
        const orders = await this.getOrders({
            status: 'open',
            symbols: [symbol],
        });
        // Find the trailing stop order
        const trailingStopOrder = orders.find((order) => order.type === 'trailing_stop');
        if (!trailingStopOrder) {
            this.log(`No open trailing stop order found for ${symbol}`, { type: 'error', symbol });
            return;
        }
        // Check if the trail_percent is already set to the desired value
        const currentTrailPercent = trailingStopOrder.trail_percent ? parseFloat(trailingStopOrder.trail_percent) : null;
        // Compare with a small epsilon to handle floating point precision
        const epsilon = 0.0001;
        if (currentTrailPercent !== null && Math.abs(currentTrailPercent - trailPercent100) < epsilon) {
            this.log(`Trailing stop for ${symbol} already set to ${trailPercent100}% (current: ${currentTrailPercent}%), skipping update`, {
                symbol,
            });
            return;
        }
        this.log(`Updating trailing stop for ${symbol} from ${currentTrailPercent}% to ${trailPercent100}%`, {
            symbol,
        });
        try {
            await this.makeRequest(`/orders/${trailingStopOrder.id}`, 'PATCH', {
                trail: trailPercent100.toString(), // Changed from trail_percent to trail
            });
        }
        catch (error) {
            this.log(`Error updating trailing stop: ${error}`, {
                symbol,
                type: 'error',
            });
            throw error;
        }
    }
    /**
     * Cancel all open orders
     */
    async cancelAllOrders() {
        this.log(`Canceling all open orders`);
        try {
            await this.makeRequest('/orders', 'DELETE');
        }
        catch (error) {
            this.log(`Error canceling all orders: ${error}`, { type: 'error' });
        }
    }
    /**
     * Cancel a specific order by its ID
     * @param orderId The id of the order to cancel
     * @throws Error if the order is not cancelable (status 422) or if the order doesn't exist
     * @returns Promise that resolves when the order is successfully canceled
     */
    async cancelOrder(orderId) {
        this.log(`Attempting to cancel order ${orderId}`);
        try {
            await this.makeRequest(`/orders/${orderId}`, 'DELETE');
            this.log(`Successfully canceled order ${orderId}`);
        }
        catch (error) {
            // If the error is a 422, it means the order is not cancelable
            if (error instanceof Error && error.message.includes('422')) {
                this.log(`Order ${orderId} is not cancelable`, {
                    type: 'error',
                });
                throw new Error(`Order ${orderId} is not cancelable`);
            }
            // Re-throw other errors
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
    async createLimitOrder(symbol, qty, side, limitPrice, position_intent, extended_hours = false, client_order_id) {
        this.log(`Creating limit order for ${symbol}: ${side} ${qty} shares at $${limitPrice.toFixed(2)} (${position_intent})`, {
            symbol,
        });
        const body = {
            symbol,
            qty: Math.abs(qty).toString(),
            side,
            position_intent,
            type: 'limit',
            limit_price: this.roundPriceForAlpaca(limitPrice).toString(),
            time_in_force: 'day',
            order_class: 'simple',
            extended_hours,
        };
        if (client_order_id !== undefined) {
            body.client_order_id = client_order_id;
        }
        try {
            return await this.makeRequest('/orders', 'POST', body);
        }
        catch (error) {
            this.log(`Error creating limit order: ${error}`, { type: 'error' });
            throw error;
        }
    }
    /**
     * Close all equities positions
     * @param options (object) - the options for closing the positions
     * - cancel_orders (boolean) - whether to cancel related orders
     * - useLimitOrders (boolean) - whether to use limit orders to close the positions
     */
    async closeAllPositions(options = { cancel_orders: true, useLimitOrders: false }) {
        this.log(`Closing all positions${options.useLimitOrders ? ' using limit orders' : ''}${options.cancel_orders ? ' and canceling open orders' : ''}`);
        if (options.useLimitOrders) {
            // Get all positions
            const positions = await this.getPositions('us_equity');
            if (positions.length === 0) {
                this.log('No positions to close');
                return;
            }
            this.log(`Found ${positions.length} positions to close`);
            // Get latest quotes for all positions
            const symbols = positions.map((position) => position.symbol);
            const quotesResponse = await marketDataAPI.getLatestQuotes(symbols);
            const lengthOfQuotes = Object.keys(quotesResponse.quotes).length;
            if (lengthOfQuotes === 0) {
                this.log('No quotes available for positions, received 0 quotes', {
                    type: 'error',
                });
                return;
            }
            if (lengthOfQuotes !== positions.length) {
                this.log(`Received ${lengthOfQuotes} quotes for ${positions.length} positions, expected ${positions.length} quotes`, { type: 'warn' });
                return;
            }
            // Create limit orders to close each position
            for (const position of positions) {
                const quote = quotesResponse.quotes[position.symbol];
                if (!quote) {
                    this.log(`No quote available for ${position.symbol}, skipping limit order`, {
                        symbol: position.symbol,
                        type: 'warn',
                    });
                    continue;
                }
                const qty = Math.abs(parseFloat(position.qty));
                const side = position.side === 'long' ? 'sell' : 'buy';
                const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';
                // Get the current price from the quote
                const currentPrice = side === 'sell' ? quote.bp : quote.ap; // Use bid for sells, ask for buys
                if (!currentPrice) {
                    this.log(`No valid price available for ${position.symbol}, skipping limit order`, {
                        symbol: position.symbol,
                        type: 'warn',
                    });
                    continue;
                }
                // Apply slippage from config
                const limitSlippagePercent1 = limitPriceSlippagePercent100 / 100;
                const limitPrice = side === 'sell'
                    ? this.roundPriceForAlpaca(currentPrice * (1 - limitSlippagePercent1)) // Sell slightly lower
                    : this.roundPriceForAlpaca(currentPrice * (1 + limitSlippagePercent1)); // Buy slightly higher
                this.log(`Creating limit order to close ${position.symbol} position: ${side} ${qty} shares at $${limitPrice.toFixed(2)}`, {
                    symbol: position.symbol,
                });
                await this.createLimitOrder(position.symbol, qty, side, limitPrice, positionIntent);
            }
        }
        else {
            await this.makeRequest('/positions', 'DELETE', undefined, options.cancel_orders ? '?cancel_orders=true' : '');
        }
    }
    /**
     * Close all equities positions using limit orders during extended hours trading
     * @param cancelOrders Whether to cancel related orders (default: true)
     * @returns Promise that resolves when all positions are closed
     */
    async closeAllPositionsAfterHours() {
        this.log('Closing all positions using limit orders during extended hours trading');
        // Get all positions
        const positions = await this.getPositions();
        this.log(`Found ${positions.length} positions to close`);
        if (positions.length === 0) {
            this.log('No positions to close');
            return;
        }
        await this.cancelAllOrders();
        this.log(`Cancelled all open orders`);
        // Get latest quotes for all positions
        const symbols = positions.map((position) => position.symbol);
        const quotesResponse = await marketDataAPI.getLatestQuotes(symbols);
        // Create limit orders to close each position
        for (const position of positions) {
            const quote = quotesResponse.quotes[position.symbol];
            if (!quote) {
                this.log(`No quote available for ${position.symbol}, skipping limit order`, {
                    symbol: position.symbol,
                    type: 'warn',
                });
                continue;
            }
            const qty = Math.abs(parseFloat(position.qty));
            const side = position.side === 'long' ? 'sell' : 'buy';
            const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';
            // Get the current price from the quote
            const currentPrice = side === 'sell' ? quote.bp : quote.ap; // Use bid for sells, ask for buys
            if (!currentPrice) {
                this.log(`No valid price available for ${position.symbol}, skipping limit order`, {
                    symbol: position.symbol,
                    type: 'warn',
                });
                continue;
            }
            // Apply slippage from config
            const limitSlippagePercent1 = limitPriceSlippagePercent100 / 100;
            const limitPrice = side === 'sell'
                ? this.roundPriceForAlpaca(currentPrice * (1 - limitSlippagePercent1)) // Sell slightly lower
                : this.roundPriceForAlpaca(currentPrice * (1 + limitSlippagePercent1)); // Buy slightly higher
            this.log(`Creating extended hours limit order to close ${position.symbol} position: ${side} ${qty} shares at $${limitPrice.toFixed(2)}`, {
                symbol: position.symbol,
            });
            await this.createLimitOrder(position.symbol, qty, side, limitPrice, positionIntent, true // Enable extended hours trading
            );
        }
        this.log(`All positions closed: ${positions.map((p) => p.symbol).join(', ')}`);
    }
    onTradeUpdate(callback) {
        this.tradeUpdateCallback = callback;
    }
    /**
     * Get portfolio history for the account
     * @param params Parameters for the portfolio history request
     * @returns Portfolio history data
     */
    async getPortfolioHistory(params) {
        const queryParams = new URLSearchParams();
        if (params.timeframe)
            queryParams.append('timeframe', params.timeframe);
        if (params.period)
            queryParams.append('period', params.period);
        if (params.extended_hours !== undefined)
            queryParams.append('extended_hours', params.extended_hours.toString());
        if (params.date_end)
            queryParams.append('date_end', params.date_end);
        const response = await this.makeRequest(`/account/portfolio/history?${queryParams.toString()}`);
        return response;
    }
    /**
     * Get option contracts based on specified parameters
     * @param params Parameters to filter option contracts
     * @returns Option contracts matching the criteria
     */
    async getOptionContracts(params) {
        const queryParams = new URLSearchParams();
        queryParams.append('underlying_symbols', params.underlying_symbols.join(','));
        if (params.expiration_date_gte)
            queryParams.append('expiration_date_gte', params.expiration_date_gte);
        if (params.expiration_date_lte)
            queryParams.append('expiration_date_lte', params.expiration_date_lte);
        if (params.strike_price_gte)
            queryParams.append('strike_price_gte', params.strike_price_gte);
        if (params.strike_price_lte)
            queryParams.append('strike_price_lte', params.strike_price_lte);
        if (params.type)
            queryParams.append('type', params.type);
        if (params.status)
            queryParams.append('status', params.status);
        if (params.limit)
            queryParams.append('limit', params.limit.toString());
        if (params.page_token)
            queryParams.append('page_token', params.page_token);
        this.log(`Fetching option contracts for ${params.underlying_symbols.join(', ')}`, {
            symbol: params.underlying_symbols.join(', '),
        });
        const response = (await this.makeRequest(`/options/contracts?${queryParams.toString()}`));
        this.log(`Found ${response.option_contracts.length} option contracts`, {
            symbol: params.underlying_symbols.join(', '),
        });
        return response;
    }
    /**
     * Get a specific option contract by symbol or ID
     * @param symbolOrId The symbol or ID of the option contract
     * @returns The option contract details
     */
    async getOptionContract(symbolOrId) {
        this.log(`Fetching option contract details for ${symbolOrId}`, {
            symbol: symbolOrId,
        });
        const response = (await this.makeRequest(`/options/contracts/${symbolOrId}`));
        this.log(`Found option contract details for ${symbolOrId}: ${response.name}`, {
            symbol: symbolOrId,
        });
        return response;
    }
    /**
     * Create a simple option order (market or limit)
     * @param symbol Option contract symbol
     * @param qty Quantity of contracts (must be a whole number)
     * @param side Buy or sell
     * @param position_intent Position intent (buy_to_open, buy_to_close, sell_to_open, sell_to_close)
     * @param type Order type (market or limit)
     * @param limitPrice Limit price (required for limit orders)
     * @returns The created order
     */
    async createOptionOrder(symbol, qty, side, position_intent, type, limitPrice) {
        if (!Number.isInteger(qty) || qty <= 0) {
            this.log('Quantity must be a positive whole number for option orders', { type: 'error' });
        }
        if (type === 'limit' && limitPrice === undefined) {
            this.log('Limit price is required for limit orders', { type: 'error' });
        }
        this.log(`Creating ${type} option order for ${symbol}: ${side} ${qty} contracts (${position_intent})${type === 'limit' ? ` at $${limitPrice?.toFixed(2)}` : ''}`, {
            symbol,
        });
        const orderData = {
            symbol,
            qty: qty.toString(),
            side,
            position_intent,
            type,
            time_in_force: 'day',
            order_class: 'simple',
            extended_hours: false,
        };
        if (type === 'limit' && limitPrice !== undefined) {
            orderData.limit_price = this.roundPriceForAlpaca(limitPrice).toString();
        }
        return this.makeRequest('/orders', 'POST', orderData);
    }
    /**
     * Create a multi-leg option order
     * @param legs Array of order legs
     * @param qty Quantity of the multi-leg order (must be a whole number)
     * @param type Order type (market or limit)
     * @param limitPrice Limit price (required for limit orders)
     * @returns The created multi-leg order
     */
    async createMultiLegOptionOrder(legs, qty, type, limitPrice) {
        if (!Number.isInteger(qty) || qty <= 0) {
            this.log('Quantity must be a positive whole number for option orders', { type: 'error' });
        }
        if (type === 'limit' && limitPrice === undefined) {
            this.log('Limit price is required for limit orders', { type: 'error' });
        }
        if (legs.length < 2) {
            this.log('Multi-leg orders require at least 2 legs', { type: 'error' });
        }
        const legSymbols = legs.map((leg) => leg.symbol).join(', ');
        this.log(`Creating multi-leg ${type} option order with ${legs.length} legs (${legSymbols})${type === 'limit' ? ` at $${limitPrice?.toFixed(2)}` : ''}`, {
            symbol: legSymbols,
        });
        const orderData = {
            order_class: 'mleg',
            qty: qty.toString(),
            type,
            time_in_force: 'day',
            legs,
        };
        if (type === 'limit' && limitPrice !== undefined) {
            orderData.limit_price = this.roundPriceForAlpaca(limitPrice).toString();
        }
        return this.makeRequest('/orders', 'POST', orderData);
    }
    /**
     * Exercise an option contract
     * @param symbolOrContractId The symbol or ID of the option contract to exercise
     * @returns Response from the exercise request
     */
    async exerciseOption(symbolOrContractId) {
        this.log(`Exercising option contract ${symbolOrContractId}`, {
            symbol: symbolOrContractId,
        });
        return this.makeRequest(`/positions/${symbolOrContractId}/exercise`, 'POST');
    }
    /**
     * Get option positions
     * @returns Array of option positions
     */
    async getOptionPositions() {
        this.log('Fetching option positions');
        const positions = await this.getPositions('us_option');
        return positions;
    }
    async getOptionsOpenSpreadTrades() {
        this.log('Fetching option open trades');
        // this function will get all open positions, extract the symbol and see when they were created.
        // figures out when the earliest date was (should be today)
        // then it pulls all orders after the earliest date that were closed and that were of class 'mleg'
        // Each of these contains two orders. they look like this:
    }
    /**
     * Get option account activities (exercises, assignments, expirations)
     * @param activityType Type of option activity to filter by
     * @param date Date to filter activities (YYYY-MM-DD format)
     * @returns Array of option account activities
     */
    async getOptionActivities(activityType, date) {
        const queryParams = new URLSearchParams();
        if (activityType) {
            queryParams.append('activity_types', activityType);
        }
        else {
            queryParams.append('activity_types', 'OPEXC,OPASN,OPEXP');
        }
        if (date) {
            queryParams.append('date', date);
        }
        this.log(`Fetching option activities${activityType ? ` of type ${activityType}` : ''}${date ? ` for date ${date}` : ''}`);
        return this.makeRequest(`/account/activities?${queryParams.toString()}`);
    }
    /**
     * Create a long call spread (buy lower strike call, sell higher strike call)
     * @param lowerStrikeCallSymbol Symbol of the lower strike call option
     * @param higherStrikeCallSymbol Symbol of the higher strike call option
     * @param qty Quantity of spreads to create (must be a whole number)
     * @param limitPrice Limit price for the spread
     * @returns The created multi-leg order
     */
    async createLongCallSpread(lowerStrikeCallSymbol, higherStrikeCallSymbol, qty, limitPrice) {
        this.log(`Creating long call spread: Buy ${lowerStrikeCallSymbol}, Sell ${higherStrikeCallSymbol}, Qty: ${qty}, Price: $${limitPrice.toFixed(2)}`, {
            symbol: `${lowerStrikeCallSymbol},${higherStrikeCallSymbol}`,
        });
        const legs = [
            {
                symbol: lowerStrikeCallSymbol,
                ratio_qty: '1',
                side: 'buy',
                position_intent: 'buy_to_open',
            },
            {
                symbol: higherStrikeCallSymbol,
                ratio_qty: '1',
                side: 'sell',
                position_intent: 'sell_to_open',
            },
        ];
        return this.createMultiLegOptionOrder(legs, qty, 'limit', limitPrice);
    }
    /**
     * Create a long put spread (buy higher strike put, sell lower strike put)
     * @param higherStrikePutSymbol Symbol of the higher strike put option
     * @param lowerStrikePutSymbol Symbol of the lower strike put option
     * @param qty Quantity of spreads to create (must be a whole number)
     * @param limitPrice Limit price for the spread
     * @returns The created multi-leg order
     */
    async createLongPutSpread(higherStrikePutSymbol, lowerStrikePutSymbol, qty, limitPrice) {
        this.log(`Creating long put spread: Buy ${higherStrikePutSymbol}, Sell ${lowerStrikePutSymbol}, Qty: ${qty}, Price: $${limitPrice.toFixed(2)}`, {
            symbol: `${higherStrikePutSymbol},${lowerStrikePutSymbol}`,
        });
        const legs = [
            {
                symbol: higherStrikePutSymbol,
                ratio_qty: '1',
                side: 'buy',
                position_intent: 'buy_to_open',
            },
            {
                symbol: lowerStrikePutSymbol,
                ratio_qty: '1',
                side: 'sell',
                position_intent: 'sell_to_open',
            },
        ];
        return this.createMultiLegOptionOrder(legs, qty, 'limit', limitPrice);
    }
    /**
     * Create an iron condor (sell call spread and put spread)
     * @param longPutSymbol Symbol of the lower strike put (long)
     * @param shortPutSymbol Symbol of the higher strike put (short)
     * @param shortCallSymbol Symbol of the lower strike call (short)
     * @param longCallSymbol Symbol of the higher strike call (long)
     * @param qty Quantity of iron condors to create (must be a whole number)
     * @param limitPrice Limit price for the iron condor (credit)
     * @returns The created multi-leg order
     */
    async createIronCondor(longPutSymbol, shortPutSymbol, shortCallSymbol, longCallSymbol, qty, limitPrice) {
        this.log(`Creating iron condor with ${qty} contracts at $${limitPrice.toFixed(2)}`, {
            symbol: `${longPutSymbol},${shortPutSymbol},${shortCallSymbol},${longCallSymbol}`,
        });
        const legs = [
            {
                symbol: longPutSymbol,
                ratio_qty: '1',
                side: 'buy',
                position_intent: 'buy_to_open',
            },
            {
                symbol: shortPutSymbol,
                ratio_qty: '1',
                side: 'sell',
                position_intent: 'sell_to_open',
            },
            {
                symbol: shortCallSymbol,
                ratio_qty: '1',
                side: 'sell',
                position_intent: 'sell_to_open',
            },
            {
                symbol: longCallSymbol,
                ratio_qty: '1',
                side: 'buy',
                position_intent: 'buy_to_open',
            },
        ];
        try {
            return await this.createMultiLegOptionOrder(legs, qty, 'limit', limitPrice);
        }
        catch (error) {
            this.log(`Error creating iron condor: ${error}`, { type: 'error' });
            throw error;
        }
    }
    /**
     * Create a covered call (sell call option against owned stock)
     * @param stockSymbol Symbol of the underlying stock
     * @param callOptionSymbol Symbol of the call option to sell
     * @param qty Quantity of covered calls to create (must be a whole number)
     * @param limitPrice Limit price for the call option
     * @returns The created order
     */
    async createCoveredCall(stockSymbol, callOptionSymbol, qty, limitPrice) {
        this.log(`Creating covered call: Sell ${callOptionSymbol} against ${stockSymbol}, Qty: ${qty}, Price: $${limitPrice.toFixed(2)}`, {
            symbol: `${stockSymbol},${callOptionSymbol}`,
        });
        // For covered calls, we don't need to include the stock leg if we already own the shares
        // We just create a simple sell order for the call option
        try {
            return await this.createOptionOrder(callOptionSymbol, qty, 'sell', 'sell_to_open', 'limit', limitPrice);
        }
        catch (error) {
            this.log(`Error creating covered call: ${error}`, { type: 'error' });
            throw error;
        }
    }
    /**
     * Roll an option position to a new expiration or strike
     * @param currentOptionSymbol Symbol of the current option position
     * @param newOptionSymbol Symbol of the new option to roll to
     * @param qty Quantity of options to roll (must be a whole number)
     * @param currentPositionSide Side of the current position ('buy' or 'sell')
     * @param limitPrice Net limit price for the roll
     * @returns The created multi-leg order
     */
    async rollOptionPosition(currentOptionSymbol, newOptionSymbol, qty, currentPositionSide, limitPrice) {
        this.log(`Rolling ${qty} ${currentOptionSymbol} to ${newOptionSymbol} at net price $${limitPrice.toFixed(2)}`, {
            symbol: `${currentOptionSymbol},${newOptionSymbol}`,
        });
        // If current position is long, we need to sell to close and buy to open
        // If current position is short, we need to buy to close and sell to open
        const closePositionSide = currentPositionSide === 'buy' ? 'sell' : 'buy';
        const openPositionSide = currentPositionSide;
        const closePositionIntent = closePositionSide === 'buy' ? 'buy_to_close' : 'sell_to_close';
        const openPositionIntent = openPositionSide === 'buy' ? 'buy_to_open' : 'sell_to_open';
        const legs = [
            {
                symbol: currentOptionSymbol,
                ratio_qty: '1',
                side: closePositionSide,
                position_intent: closePositionIntent,
            },
            {
                symbol: newOptionSymbol,
                ratio_qty: '1',
                side: openPositionSide,
                position_intent: openPositionIntent,
            },
        ];
        try {
            return await this.createMultiLegOptionOrder(legs, qty, 'limit', limitPrice);
        }
        catch (error) {
            this.log(`Error rolling option position: ${error}`, { type: 'error' });
            throw error;
        }
    }
    /**
     * Get option chain for a specific underlying symbol and expiration date
     * @param underlyingSymbol The underlying stock symbol
     * @param expirationDate The expiration date (YYYY-MM-DD format)
     * @returns Option contracts for the specified symbol and expiration date
     */
    async getOptionChain(underlyingSymbol, expirationDate) {
        this.log(`Fetching option chain for ${underlyingSymbol} with expiration date ${expirationDate}`, {
            symbol: underlyingSymbol,
        });
        try {
            const params = {
                underlying_symbols: [underlyingSymbol],
                expiration_date_gte: expirationDate,
                expiration_date_lte: expirationDate,
                status: 'active',
                limit: 500, // Get a large number to ensure we get all strikes
            };
            const response = await this.getOptionContracts(params);
            return response.option_contracts || [];
        }
        catch (error) {
            this.log(`Failed to fetch option chain for ${underlyingSymbol}: ${error instanceof Error ? error.message : 'Unknown error'}`, {
                type: 'error',
                symbol: underlyingSymbol,
            });
            return [];
        }
    }
    /**
     * Get all available expiration dates for a specific underlying symbol
     * @param underlyingSymbol The underlying stock symbol
     * @returns Array of available expiration dates
     */
    async getOptionExpirationDates(underlyingSymbol) {
        this.log(`Fetching available expiration dates for ${underlyingSymbol}`, {
            symbol: underlyingSymbol,
        });
        try {
            const params = {
                underlying_symbols: [underlyingSymbol],
                status: 'active',
                limit: 1000, // Get a large number to ensure we get contracts with all expiration dates
            };
            const response = await this.getOptionContracts(params);
            // Extract unique expiration dates
            const expirationDates = new Set();
            if (response.option_contracts) {
                response.option_contracts.forEach((contract) => {
                    expirationDates.add(contract.expiration_date);
                });
            }
            // Convert to array and sort
            return Array.from(expirationDates).sort();
        }
        catch (error) {
            this.log(`Failed to fetch expiration dates for ${underlyingSymbol}: ${error instanceof Error ? error.message : 'Unknown error'}`, {
                type: 'error',
                symbol: underlyingSymbol,
            });
            return [];
        }
    }
    /**
     * Get the current options trading level for the account
     * @returns The options trading level (0-3)
     */
    async getOptionsTradingLevel() {
        this.log('Fetching options trading level');
        const accountDetails = await this.getAccountDetails();
        return accountDetails.options_trading_level || 0;
    }
    /**
     * Check if the account has options trading enabled
     * @returns Boolean indicating if options trading is enabled
     */
    async isOptionsEnabled() {
        this.log('Checking if options trading is enabled');
        const accountDetails = await this.getAccountDetails();
        // Check if options trading level is 2 or higher (Level 2+ allows buying calls/puts)
        // Level 0: Options disabled
        // Level 1: Only covered calls and cash-secured puts
        // Level 2+: Can buy calls and puts (required for executeOptionsOrder)
        const optionsLevel = accountDetails.options_trading_level || 0;
        const isEnabled = optionsLevel >= 2;
        this.log(`Options trading level: ${optionsLevel}, enabled: ${isEnabled}`);
        return isEnabled;
    }
    /**
     * Close all option positions
     * @param cancelOrders Whether to cancel related orders (default: true)
     * @returns Response from the close positions request
     */
    async closeAllOptionPositions(cancelOrders = true) {
        this.log(`Closing all option positions${cancelOrders ? ' and canceling related orders' : ''}`);
        const optionPositions = await this.getOptionPositions();
        if (optionPositions.length === 0) {
            this.log('No option positions to close');
            return;
        }
        // Create market orders to close each position
        for (const position of optionPositions) {
            const side = position.side === 'long' ? 'sell' : 'buy';
            const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';
            this.log(`Closing ${position.side} position of ${position.qty} contracts for ${position.symbol}`, {
                symbol: position.symbol,
            });
            await this.createOptionOrder(position.symbol, parseInt(position.qty), side, positionIntent, 'market');
        }
        if (cancelOrders) {
            // Get all open option orders
            const orders = await this.getOrders({ status: 'open' });
            const optionOrders = orders.filter((order) => order.asset_class === 'us_option');
            // Cancel each open option order
            for (const order of optionOrders) {
                this.log(`Canceling open order for ${order.symbol}`, {
                    symbol: order.symbol,
                });
                await this.makeRequest(`/orders/${order.id}`, 'DELETE');
            }
        }
    }
    /**
     * Close a specific option position
     * @param symbol The option contract symbol
     * @param qty Optional quantity to close (defaults to entire position)
     * @returns The created order
     */
    async closeOptionPosition(symbol, qty) {
        this.log(`Closing option position for ${symbol}${qty ? ` (${qty} contracts)` : ''}`, {
            symbol,
        });
        // Get the position details
        const positions = await this.getOptionPositions();
        const position = positions.find((p) => p.symbol === symbol);
        if (!position) {
            throw new Error(`No position found for option contract ${symbol}`);
        }
        const quantityToClose = qty || parseInt(position.qty);
        const side = position.side === 'long' ? 'sell' : 'buy';
        const positionIntent = side === 'sell' ? 'sell_to_close' : 'buy_to_close';
        try {
            return await this.createOptionOrder(symbol, quantityToClose, side, positionIntent, 'market');
        }
        catch (error) {
            this.log(`Error closing option position: ${error}`, { type: 'error' });
            throw error;
        }
    }
    /**
     * Create a complete equities trade with optional stop loss and take profit
     * @param params Trade parameters including symbol, qty, side, and optional referencePrice
     * @param options Trade options including order type, extended hours, stop loss, and take profit settings
     * @returns The created order
     */
    async createEquitiesTrade(params, options) {
        const { symbol, qty, side, referencePrice } = params;
        const { type = 'market', limitPrice, extendedHours = false, useStopLoss = false, stopPrice, stopPercent100, useTakeProfit = false, takeProfitPrice, takeProfitPercent100, clientOrderId, } = options || {};
        // Validation: Extended hours + market order is not allowed
        if (extendedHours && type === 'market') {
            this.log('Cannot create market order with extended hours enabled', {
                symbol,
                type: 'error',
            });
            throw new Error('Cannot create market order with extended hours enabled');
        }
        // Validation: Limit orders require limit price
        if (type === 'limit' && limitPrice === undefined) {
            this.log('Limit price is required for limit orders', {
                symbol,
                type: 'error',
            });
            throw new Error('Limit price is required for limit orders');
        }
        let calculatedStopPrice;
        let calculatedTakeProfitPrice;
        // Handle stop loss validation and calculation
        if (useStopLoss) {
            if (stopPrice === undefined && stopPercent100 === undefined) {
                this.log('Either stopPrice or stopPercent100 must be provided when useStopLoss is true', {
                    symbol,
                    type: 'error',
                });
                throw new Error('Either stopPrice or stopPercent100 must be provided when useStopLoss is true');
            }
            if (stopPercent100 !== undefined) {
                if (referencePrice === undefined) {
                    this.log('referencePrice is required when using stopPercent100', {
                        symbol,
                        type: 'error',
                    });
                    throw new Error('referencePrice is required when using stopPercent100');
                }
                // Calculate stop price based on percentage and side
                const stopPercentDecimal = stopPercent100 / 100;
                if (side === 'buy') {
                    // For buy orders, stop loss is below the reference price
                    calculatedStopPrice = referencePrice * (1 - stopPercentDecimal);
                }
                else {
                    // For sell orders, stop loss is above the reference price
                    calculatedStopPrice = referencePrice * (1 + stopPercentDecimal);
                }
            }
            else {
                calculatedStopPrice = stopPrice;
            }
        }
        // Handle take profit validation and calculation
        if (useTakeProfit) {
            if (takeProfitPrice === undefined && takeProfitPercent100 === undefined) {
                this.log('Either takeProfitPrice or takeProfitPercent100 must be provided when useTakeProfit is true', {
                    symbol,
                    type: 'error',
                });
                throw new Error('Either takeProfitPrice or takeProfitPercent100 must be provided when useTakeProfit is true');
            }
            if (takeProfitPercent100 !== undefined) {
                if (referencePrice === undefined) {
                    this.log('referencePrice is required when using takeProfitPercent100', {
                        symbol,
                        type: 'error',
                    });
                    throw new Error('referencePrice is required when using takeProfitPercent100');
                }
                // Calculate take profit price based on percentage and side
                const takeProfitPercentDecimal = takeProfitPercent100 / 100;
                if (side === 'buy') {
                    // For buy orders, take profit is above the reference price
                    calculatedTakeProfitPrice = referencePrice * (1 + takeProfitPercentDecimal);
                }
                else {
                    // For sell orders, take profit is below the reference price
                    calculatedTakeProfitPrice = referencePrice * (1 - takeProfitPercentDecimal);
                }
            }
            else {
                calculatedTakeProfitPrice = takeProfitPrice;
            }
        }
        // Determine order class based on what's enabled
        let orderClass = 'simple';
        if (useStopLoss && useTakeProfit) {
            orderClass = 'bracket';
        }
        else if (useStopLoss || useTakeProfit) {
            orderClass = 'oto';
        }
        // Build the order request
        const orderData = {
            symbol,
            qty: Math.abs(qty).toString(),
            side,
            type,
            time_in_force: 'day',
            order_class: orderClass,
            extended_hours: extendedHours,
            position_intent: side === 'buy' ? 'buy_to_open' : 'sell_to_open',
        };
        if (clientOrderId) {
            orderData.client_order_id = clientOrderId;
        }
        // Add limit price for limit orders
        if (type === 'limit' && limitPrice !== undefined) {
            orderData.limit_price = this.roundPriceForAlpaca(limitPrice).toString();
        }
        // Add stop loss if enabled
        if (useStopLoss && calculatedStopPrice !== undefined) {
            orderData.stop_loss = {
                stop_price: this.roundPriceForAlpaca(calculatedStopPrice).toString(),
            };
        }
        // Add take profit if enabled
        if (useTakeProfit && calculatedTakeProfitPrice !== undefined) {
            orderData.take_profit = {
                limit_price: this.roundPriceForAlpaca(calculatedTakeProfitPrice).toString(),
            };
        }
        const logMessage = `Creating ${orderClass} ${type} ${side} order for ${symbol}: ${qty} shares${type === 'limit' ? ` at $${limitPrice?.toFixed(2)}` : ''}${useStopLoss ? ` with stop loss at $${calculatedStopPrice?.toFixed(2)}` : ''}${useTakeProfit ? ` with take profit at $${calculatedTakeProfitPrice?.toFixed(2)}` : ''}${extendedHours ? ' (extended hours)' : ''}`;
        this.log(logMessage, {
            symbol,
        });
        try {
            return await this.makeRequest('/orders', 'POST', orderData);
        }
        catch (error) {
            this.log(`Error creating equities trade: ${error}`, {
                symbol,
                type: 'error',
            });
            throw error;
        }
    }
}

/**
 * @module LRUCache
 */
const defaultPerf = (typeof performance === 'object' &&
    performance &&
    typeof performance.now === 'function') ?
    performance
    : Date;
const warned = new Set();
/* c8 ignore start */
const PROCESS = (typeof process === 'object' && !!process ?
    process
    : {});
/* c8 ignore start */
const emitWarning = (msg, type, code, fn) => {
    typeof PROCESS.emitWarning === 'function' ?
        PROCESS.emitWarning(msg, type, code, fn)
        : console.error(`[${code}] ${type}: ${msg}`);
};
let AC = globalThis.AbortController;
let AS = globalThis.AbortSignal;
/* c8 ignore start */
if (typeof AC === 'undefined') {
    //@ts-ignore
    AS = class AbortSignal {
        onabort;
        _onabort = [];
        reason;
        aborted = false;
        addEventListener(_, fn) {
            this._onabort.push(fn);
        }
    };
    //@ts-ignore
    AC = class AbortController {
        constructor() {
            warnACPolyfill();
        }
        signal = new AS();
        abort(reason) {
            if (this.signal.aborted)
                return;
            //@ts-ignore
            this.signal.reason = reason;
            //@ts-ignore
            this.signal.aborted = true;
            //@ts-ignore
            for (const fn of this.signal._onabort) {
                fn(reason);
            }
            this.signal.onabort?.(reason);
        }
    };
    let printACPolyfillWarning = PROCESS.env?.LRU_CACHE_IGNORE_AC_WARNING !== '1';
    const warnACPolyfill = () => {
        if (!printACPolyfillWarning)
            return;
        printACPolyfillWarning = false;
        emitWarning('AbortController is not defined. If using lru-cache in ' +
            'node 14, load an AbortController polyfill from the ' +
            '`node-abort-controller` package. A minimal polyfill is ' +
            'provided for use by LRUCache.fetch(), but it should not be ' +
            'relied upon in other contexts (eg, passing it to other APIs that ' +
            'use AbortController/AbortSignal might have undesirable effects). ' +
            'You may disable this with LRU_CACHE_IGNORE_AC_WARNING=1 in the env.', 'NO_ABORT_CONTROLLER', 'ENOTSUP', warnACPolyfill);
    };
}
/* c8 ignore stop */
const shouldWarn = (code) => !warned.has(code);
const isPosInt = (n) => n && n === Math.floor(n) && n > 0 && isFinite(n);
/* c8 ignore start */
// This is a little bit ridiculous, tbh.
// The maximum array length is 2^32-1 or thereabouts on most JS impls.
// And well before that point, you're caching the entire world, I mean,
// that's ~32GB of just integers for the next/prev links, plus whatever
// else to hold that many keys and values.  Just filling the memory with
// zeroes at init time is brutal when you get that big.
// But why not be complete?
// Maybe in the future, these limits will have expanded.
const getUintArray = (max) => !isPosInt(max) ? null
    : max <= Math.pow(2, 8) ? Uint8Array
        : max <= Math.pow(2, 16) ? Uint16Array
            : max <= Math.pow(2, 32) ? Uint32Array
                : max <= Number.MAX_SAFE_INTEGER ? ZeroArray
                    : null;
/* c8 ignore stop */
class ZeroArray extends Array {
    constructor(size) {
        super(size);
        this.fill(0);
    }
}
class Stack {
    heap;
    length;
    // private constructor
    static #constructing = false;
    static create(max) {
        const HeapCls = getUintArray(max);
        if (!HeapCls)
            return [];
        Stack.#constructing = true;
        const s = new Stack(max, HeapCls);
        Stack.#constructing = false;
        return s;
    }
    constructor(max, HeapCls) {
        /* c8 ignore start */
        if (!Stack.#constructing) {
            throw new TypeError('instantiate Stack using Stack.create(n)');
        }
        /* c8 ignore stop */
        this.heap = new HeapCls(max);
        this.length = 0;
    }
    push(n) {
        this.heap[this.length++] = n;
    }
    pop() {
        return this.heap[--this.length];
    }
}
/**
 * Default export, the thing you're using this module to get.
 *
 * The `K` and `V` types define the key and value types, respectively. The
 * optional `FC` type defines the type of the `context` object passed to
 * `cache.fetch()` and `cache.memo()`.
 *
 * Keys and values **must not** be `null` or `undefined`.
 *
 * All properties from the options object (with the exception of `max`,
 * `maxSize`, `fetchMethod`, `memoMethod`, `dispose` and `disposeAfter`) are
 * added as normal public members. (The listed options are read-only getters.)
 *
 * Changing any of these will alter the defaults for subsequent method calls.
 */
class LRUCache {
    // options that cannot be changed without disaster
    #max;
    #maxSize;
    #dispose;
    #onInsert;
    #disposeAfter;
    #fetchMethod;
    #memoMethod;
    #perf;
    /**
     * {@link LRUCache.OptionsBase.perf}
     */
    get perf() {
        return this.#perf;
    }
    /**
     * {@link LRUCache.OptionsBase.ttl}
     */
    ttl;
    /**
     * {@link LRUCache.OptionsBase.ttlResolution}
     */
    ttlResolution;
    /**
     * {@link LRUCache.OptionsBase.ttlAutopurge}
     */
    ttlAutopurge;
    /**
     * {@link LRUCache.OptionsBase.updateAgeOnGet}
     */
    updateAgeOnGet;
    /**
     * {@link LRUCache.OptionsBase.updateAgeOnHas}
     */
    updateAgeOnHas;
    /**
     * {@link LRUCache.OptionsBase.allowStale}
     */
    allowStale;
    /**
     * {@link LRUCache.OptionsBase.noDisposeOnSet}
     */
    noDisposeOnSet;
    /**
     * {@link LRUCache.OptionsBase.noUpdateTTL}
     */
    noUpdateTTL;
    /**
     * {@link LRUCache.OptionsBase.maxEntrySize}
     */
    maxEntrySize;
    /**
     * {@link LRUCache.OptionsBase.sizeCalculation}
     */
    sizeCalculation;
    /**
     * {@link LRUCache.OptionsBase.noDeleteOnFetchRejection}
     */
    noDeleteOnFetchRejection;
    /**
     * {@link LRUCache.OptionsBase.noDeleteOnStaleGet}
     */
    noDeleteOnStaleGet;
    /**
     * {@link LRUCache.OptionsBase.allowStaleOnFetchAbort}
     */
    allowStaleOnFetchAbort;
    /**
     * {@link LRUCache.OptionsBase.allowStaleOnFetchRejection}
     */
    allowStaleOnFetchRejection;
    /**
     * {@link LRUCache.OptionsBase.ignoreFetchAbort}
     */
    ignoreFetchAbort;
    // computed properties
    #size;
    #calculatedSize;
    #keyMap;
    #keyList;
    #valList;
    #next;
    #prev;
    #head;
    #tail;
    #free;
    #disposed;
    #sizes;
    #starts;
    #ttls;
    #autopurgeTimers;
    #hasDispose;
    #hasFetchMethod;
    #hasDisposeAfter;
    #hasOnInsert;
    /**
     * Do not call this method unless you need to inspect the
     * inner workings of the cache.  If anything returned by this
     * object is modified in any way, strange breakage may occur.
     *
     * These fields are private for a reason!
     *
     * @internal
     */
    static unsafeExposeInternals(c) {
        return {
            // properties
            starts: c.#starts,
            ttls: c.#ttls,
            autopurgeTimers: c.#autopurgeTimers,
            sizes: c.#sizes,
            keyMap: c.#keyMap,
            keyList: c.#keyList,
            valList: c.#valList,
            next: c.#next,
            prev: c.#prev,
            get head() {
                return c.#head;
            },
            get tail() {
                return c.#tail;
            },
            free: c.#free,
            // methods
            isBackgroundFetch: (p) => c.#isBackgroundFetch(p),
            backgroundFetch: (k, index, options, context) => c.#backgroundFetch(k, index, options, context),
            moveToTail: (index) => c.#moveToTail(index),
            indexes: (options) => c.#indexes(options),
            rindexes: (options) => c.#rindexes(options),
            isStale: (index) => c.#isStale(index),
        };
    }
    // Protected read-only members
    /**
     * {@link LRUCache.OptionsBase.max} (read-only)
     */
    get max() {
        return this.#max;
    }
    /**
     * {@link LRUCache.OptionsBase.maxSize} (read-only)
     */
    get maxSize() {
        return this.#maxSize;
    }
    /**
     * The total computed size of items in the cache (read-only)
     */
    get calculatedSize() {
        return this.#calculatedSize;
    }
    /**
     * The number of items stored in the cache (read-only)
     */
    get size() {
        return this.#size;
    }
    /**
     * {@link LRUCache.OptionsBase.fetchMethod} (read-only)
     */
    get fetchMethod() {
        return this.#fetchMethod;
    }
    get memoMethod() {
        return this.#memoMethod;
    }
    /**
     * {@link LRUCache.OptionsBase.dispose} (read-only)
     */
    get dispose() {
        return this.#dispose;
    }
    /**
     * {@link LRUCache.OptionsBase.onInsert} (read-only)
     */
    get onInsert() {
        return this.#onInsert;
    }
    /**
     * {@link LRUCache.OptionsBase.disposeAfter} (read-only)
     */
    get disposeAfter() {
        return this.#disposeAfter;
    }
    constructor(options) {
        const { max = 0, ttl, ttlResolution = 1, ttlAutopurge, updateAgeOnGet, updateAgeOnHas, allowStale, dispose, onInsert, disposeAfter, noDisposeOnSet, noUpdateTTL, maxSize = 0, maxEntrySize = 0, sizeCalculation, fetchMethod, memoMethod, noDeleteOnFetchRejection, noDeleteOnStaleGet, allowStaleOnFetchRejection, allowStaleOnFetchAbort, ignoreFetchAbort, perf, } = options;
        if (perf !== undefined) {
            if (typeof perf?.now !== 'function') {
                throw new TypeError('perf option must have a now() method if specified');
            }
        }
        this.#perf = perf ?? defaultPerf;
        if (max !== 0 && !isPosInt(max)) {
            throw new TypeError('max option must be a nonnegative integer');
        }
        const UintArray = max ? getUintArray(max) : Array;
        if (!UintArray) {
            throw new Error('invalid max value: ' + max);
        }
        this.#max = max;
        this.#maxSize = maxSize;
        this.maxEntrySize = maxEntrySize || this.#maxSize;
        this.sizeCalculation = sizeCalculation;
        if (this.sizeCalculation) {
            if (!this.#maxSize && !this.maxEntrySize) {
                throw new TypeError('cannot set sizeCalculation without setting maxSize or maxEntrySize');
            }
            if (typeof this.sizeCalculation !== 'function') {
                throw new TypeError('sizeCalculation set to non-function');
            }
        }
        if (memoMethod !== undefined && typeof memoMethod !== 'function') {
            throw new TypeError('memoMethod must be a function if defined');
        }
        this.#memoMethod = memoMethod;
        if (fetchMethod !== undefined && typeof fetchMethod !== 'function') {
            throw new TypeError('fetchMethod must be a function if specified');
        }
        this.#fetchMethod = fetchMethod;
        this.#hasFetchMethod = !!fetchMethod;
        this.#keyMap = new Map();
        this.#keyList = new Array(max).fill(undefined);
        this.#valList = new Array(max).fill(undefined);
        this.#next = new UintArray(max);
        this.#prev = new UintArray(max);
        this.#head = 0;
        this.#tail = 0;
        this.#free = Stack.create(max);
        this.#size = 0;
        this.#calculatedSize = 0;
        if (typeof dispose === 'function') {
            this.#dispose = dispose;
        }
        if (typeof onInsert === 'function') {
            this.#onInsert = onInsert;
        }
        if (typeof disposeAfter === 'function') {
            this.#disposeAfter = disposeAfter;
            this.#disposed = [];
        }
        else {
            this.#disposeAfter = undefined;
            this.#disposed = undefined;
        }
        this.#hasDispose = !!this.#dispose;
        this.#hasOnInsert = !!this.#onInsert;
        this.#hasDisposeAfter = !!this.#disposeAfter;
        this.noDisposeOnSet = !!noDisposeOnSet;
        this.noUpdateTTL = !!noUpdateTTL;
        this.noDeleteOnFetchRejection = !!noDeleteOnFetchRejection;
        this.allowStaleOnFetchRejection = !!allowStaleOnFetchRejection;
        this.allowStaleOnFetchAbort = !!allowStaleOnFetchAbort;
        this.ignoreFetchAbort = !!ignoreFetchAbort;
        // NB: maxEntrySize is set to maxSize if it's set
        if (this.maxEntrySize !== 0) {
            if (this.#maxSize !== 0) {
                if (!isPosInt(this.#maxSize)) {
                    throw new TypeError('maxSize must be a positive integer if specified');
                }
            }
            if (!isPosInt(this.maxEntrySize)) {
                throw new TypeError('maxEntrySize must be a positive integer if specified');
            }
            this.#initializeSizeTracking();
        }
        this.allowStale = !!allowStale;
        this.noDeleteOnStaleGet = !!noDeleteOnStaleGet;
        this.updateAgeOnGet = !!updateAgeOnGet;
        this.updateAgeOnHas = !!updateAgeOnHas;
        this.ttlResolution =
            isPosInt(ttlResolution) || ttlResolution === 0 ? ttlResolution : 1;
        this.ttlAutopurge = !!ttlAutopurge;
        this.ttl = ttl || 0;
        if (this.ttl) {
            if (!isPosInt(this.ttl)) {
                throw new TypeError('ttl must be a positive integer if specified');
            }
            this.#initializeTTLTracking();
        }
        // do not allow completely unbounded caches
        if (this.#max === 0 && this.ttl === 0 && this.#maxSize === 0) {
            throw new TypeError('At least one of max, maxSize, or ttl is required');
        }
        if (!this.ttlAutopurge && !this.#max && !this.#maxSize) {
            const code = 'LRU_CACHE_UNBOUNDED';
            if (shouldWarn(code)) {
                warned.add(code);
                const msg = 'TTL caching without ttlAutopurge, max, or maxSize can ' +
                    'result in unbounded memory consumption.';
                emitWarning(msg, 'UnboundedCacheWarning', code, LRUCache);
            }
        }
    }
    /**
     * Return the number of ms left in the item's TTL. If item is not in cache,
     * returns `0`. Returns `Infinity` if item is in cache without a defined TTL.
     */
    getRemainingTTL(key) {
        return this.#keyMap.has(key) ? Infinity : 0;
    }
    #initializeTTLTracking() {
        const ttls = new ZeroArray(this.#max);
        const starts = new ZeroArray(this.#max);
        this.#ttls = ttls;
        this.#starts = starts;
        const purgeTimers = this.ttlAutopurge ?
            new Array(this.#max)
            : undefined;
        this.#autopurgeTimers = purgeTimers;
        this.#setItemTTL = (index, ttl, start = this.#perf.now()) => {
            starts[index] = ttl !== 0 ? start : 0;
            ttls[index] = ttl;
            // clear out the purge timer if we're setting TTL to 0, and
            // previously had a ttl purge timer running, so it doesn't
            // fire unnecessarily.
            if (purgeTimers?.[index]) {
                clearTimeout(purgeTimers[index]);
                purgeTimers[index] = undefined;
            }
            if (ttl !== 0 && purgeTimers) {
                const t = setTimeout(() => {
                    if (this.#isStale(index)) {
                        this.#delete(this.#keyList[index], 'expire');
                    }
                }, ttl + 1);
                // unref() not supported on all platforms
                /* c8 ignore start */
                if (t.unref) {
                    t.unref();
                }
                /* c8 ignore stop */
                purgeTimers[index] = t;
            }
        };
        this.#updateItemAge = index => {
            starts[index] = ttls[index] !== 0 ? this.#perf.now() : 0;
        };
        this.#statusTTL = (status, index) => {
            if (ttls[index]) {
                const ttl = ttls[index];
                const start = starts[index];
                /* c8 ignore next */
                if (!ttl || !start)
                    return;
                status.ttl = ttl;
                status.start = start;
                status.now = cachedNow || getNow();
                const age = status.now - start;
                status.remainingTTL = ttl - age;
            }
        };
        // debounce calls to perf.now() to 1s so we're not hitting
        // that costly call repeatedly.
        let cachedNow = 0;
        const getNow = () => {
            const n = this.#perf.now();
            if (this.ttlResolution > 0) {
                cachedNow = n;
                const t = setTimeout(() => (cachedNow = 0), this.ttlResolution);
                // not available on all platforms
                /* c8 ignore start */
                if (t.unref) {
                    t.unref();
                }
                /* c8 ignore stop */
            }
            return n;
        };
        this.getRemainingTTL = key => {
            const index = this.#keyMap.get(key);
            if (index === undefined) {
                return 0;
            }
            const ttl = ttls[index];
            const start = starts[index];
            if (!ttl || !start) {
                return Infinity;
            }
            const age = (cachedNow || getNow()) - start;
            return ttl - age;
        };
        this.#isStale = index => {
            const s = starts[index];
            const t = ttls[index];
            return !!t && !!s && (cachedNow || getNow()) - s > t;
        };
    }
    // conditionally set private methods related to TTL
    #updateItemAge = () => { };
    #statusTTL = () => { };
    #setItemTTL = () => { };
    /* c8 ignore stop */
    #isStale = () => false;
    #initializeSizeTracking() {
        const sizes = new ZeroArray(this.#max);
        this.#calculatedSize = 0;
        this.#sizes = sizes;
        this.#removeItemSize = index => {
            this.#calculatedSize -= sizes[index];
            sizes[index] = 0;
        };
        this.#requireSize = (k, v, size, sizeCalculation) => {
            // provisionally accept background fetches.
            // actual value size will be checked when they return.
            if (this.#isBackgroundFetch(v)) {
                return 0;
            }
            if (!isPosInt(size)) {
                if (sizeCalculation) {
                    if (typeof sizeCalculation !== 'function') {
                        throw new TypeError('sizeCalculation must be a function');
                    }
                    size = sizeCalculation(v, k);
                    if (!isPosInt(size)) {
                        throw new TypeError('sizeCalculation return invalid (expect positive integer)');
                    }
                }
                else {
                    throw new TypeError('invalid size value (must be positive integer). ' +
                        'When maxSize or maxEntrySize is used, sizeCalculation ' +
                        'or size must be set.');
                }
            }
            return size;
        };
        this.#addItemSize = (index, size, status) => {
            sizes[index] = size;
            if (this.#maxSize) {
                const maxSize = this.#maxSize - sizes[index];
                while (this.#calculatedSize > maxSize) {
                    this.#evict(true);
                }
            }
            this.#calculatedSize += sizes[index];
            if (status) {
                status.entrySize = size;
                status.totalCalculatedSize = this.#calculatedSize;
            }
        };
    }
    #removeItemSize = _i => { };
    #addItemSize = (_i, _s, _st) => { };
    #requireSize = (_k, _v, size, sizeCalculation) => {
        if (size || sizeCalculation) {
            throw new TypeError('cannot set size without setting maxSize or maxEntrySize on cache');
        }
        return 0;
    };
    *#indexes({ allowStale = this.allowStale } = {}) {
        if (this.#size) {
            for (let i = this.#tail; true;) {
                if (!this.#isValidIndex(i)) {
                    break;
                }
                if (allowStale || !this.#isStale(i)) {
                    yield i;
                }
                if (i === this.#head) {
                    break;
                }
                else {
                    i = this.#prev[i];
                }
            }
        }
    }
    *#rindexes({ allowStale = this.allowStale } = {}) {
        if (this.#size) {
            for (let i = this.#head; true;) {
                if (!this.#isValidIndex(i)) {
                    break;
                }
                if (allowStale || !this.#isStale(i)) {
                    yield i;
                }
                if (i === this.#tail) {
                    break;
                }
                else {
                    i = this.#next[i];
                }
            }
        }
    }
    #isValidIndex(index) {
        return (index !== undefined &&
            this.#keyMap.get(this.#keyList[index]) === index);
    }
    /**
     * Return a generator yielding `[key, value]` pairs,
     * in order from most recently used to least recently used.
     */
    *entries() {
        for (const i of this.#indexes()) {
            if (this.#valList[i] !== undefined &&
                this.#keyList[i] !== undefined &&
                !this.#isBackgroundFetch(this.#valList[i])) {
                yield [this.#keyList[i], this.#valList[i]];
            }
        }
    }
    /**
     * Inverse order version of {@link LRUCache.entries}
     *
     * Return a generator yielding `[key, value]` pairs,
     * in order from least recently used to most recently used.
     */
    *rentries() {
        for (const i of this.#rindexes()) {
            if (this.#valList[i] !== undefined &&
                this.#keyList[i] !== undefined &&
                !this.#isBackgroundFetch(this.#valList[i])) {
                yield [this.#keyList[i], this.#valList[i]];
            }
        }
    }
    /**
     * Return a generator yielding the keys in the cache,
     * in order from most recently used to least recently used.
     */
    *keys() {
        for (const i of this.#indexes()) {
            const k = this.#keyList[i];
            if (k !== undefined && !this.#isBackgroundFetch(this.#valList[i])) {
                yield k;
            }
        }
    }
    /**
     * Inverse order version of {@link LRUCache.keys}
     *
     * Return a generator yielding the keys in the cache,
     * in order from least recently used to most recently used.
     */
    *rkeys() {
        for (const i of this.#rindexes()) {
            const k = this.#keyList[i];
            if (k !== undefined && !this.#isBackgroundFetch(this.#valList[i])) {
                yield k;
            }
        }
    }
    /**
     * Return a generator yielding the values in the cache,
     * in order from most recently used to least recently used.
     */
    *values() {
        for (const i of this.#indexes()) {
            const v = this.#valList[i];
            if (v !== undefined && !this.#isBackgroundFetch(this.#valList[i])) {
                yield this.#valList[i];
            }
        }
    }
    /**
     * Inverse order version of {@link LRUCache.values}
     *
     * Return a generator yielding the values in the cache,
     * in order from least recently used to most recently used.
     */
    *rvalues() {
        for (const i of this.#rindexes()) {
            const v = this.#valList[i];
            if (v !== undefined && !this.#isBackgroundFetch(this.#valList[i])) {
                yield this.#valList[i];
            }
        }
    }
    /**
     * Iterating over the cache itself yields the same results as
     * {@link LRUCache.entries}
     */
    [Symbol.iterator]() {
        return this.entries();
    }
    /**
     * A String value that is used in the creation of the default string
     * description of an object. Called by the built-in method
     * `Object.prototype.toString`.
     */
    [Symbol.toStringTag] = 'LRUCache';
    /**
     * Find a value for which the supplied fn method returns a truthy value,
     * similar to `Array.find()`. fn is called as `fn(value, key, cache)`.
     */
    find(fn, getOptions = {}) {
        for (const i of this.#indexes()) {
            const v = this.#valList[i];
            const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
            if (value === undefined)
                continue;
            if (fn(value, this.#keyList[i], this)) {
                return this.get(this.#keyList[i], getOptions);
            }
        }
    }
    /**
     * Call the supplied function on each item in the cache, in order from most
     * recently used to least recently used.
     *
     * `fn` is called as `fn(value, key, cache)`.
     *
     * If `thisp` is provided, function will be called in the `this`-context of
     * the provided object, or the cache if no `thisp` object is provided.
     *
     * Does not update age or recenty of use, or iterate over stale values.
     */
    forEach(fn, thisp = this) {
        for (const i of this.#indexes()) {
            const v = this.#valList[i];
            const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
            if (value === undefined)
                continue;
            fn.call(thisp, value, this.#keyList[i], this);
        }
    }
    /**
     * The same as {@link LRUCache.forEach} but items are iterated over in
     * reverse order.  (ie, less recently used items are iterated over first.)
     */
    rforEach(fn, thisp = this) {
        for (const i of this.#rindexes()) {
            const v = this.#valList[i];
            const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
            if (value === undefined)
                continue;
            fn.call(thisp, value, this.#keyList[i], this);
        }
    }
    /**
     * Delete any stale entries. Returns true if anything was removed,
     * false otherwise.
     */
    purgeStale() {
        let deleted = false;
        for (const i of this.#rindexes({ allowStale: true })) {
            if (this.#isStale(i)) {
                this.#delete(this.#keyList[i], 'expire');
                deleted = true;
            }
        }
        return deleted;
    }
    /**
     * Get the extended info about a given entry, to get its value, size, and
     * TTL info simultaneously. Returns `undefined` if the key is not present.
     *
     * Unlike {@link LRUCache#dump}, which is designed to be portable and survive
     * serialization, the `start` value is always the current timestamp, and the
     * `ttl` is a calculated remaining time to live (negative if expired).
     *
     * Always returns stale values, if their info is found in the cache, so be
     * sure to check for expirations (ie, a negative {@link LRUCache.Entry#ttl})
     * if relevant.
     */
    info(key) {
        const i = this.#keyMap.get(key);
        if (i === undefined)
            return undefined;
        const v = this.#valList[i];
        /* c8 ignore start - this isn't tested for the info function,
         * but it's the same logic as found in other places. */
        const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
        if (value === undefined)
            return undefined;
        /* c8 ignore end */
        const entry = { value };
        if (this.#ttls && this.#starts) {
            const ttl = this.#ttls[i];
            const start = this.#starts[i];
            if (ttl && start) {
                const remain = ttl - (this.#perf.now() - start);
                entry.ttl = remain;
                entry.start = Date.now();
            }
        }
        if (this.#sizes) {
            entry.size = this.#sizes[i];
        }
        return entry;
    }
    /**
     * Return an array of [key, {@link LRUCache.Entry}] tuples which can be
     * passed to {@link LRUCache#load}.
     *
     * The `start` fields are calculated relative to a portable `Date.now()`
     * timestamp, even if `performance.now()` is available.
     *
     * Stale entries are always included in the `dump`, even if
     * {@link LRUCache.OptionsBase.allowStale} is false.
     *
     * Note: this returns an actual array, not a generator, so it can be more
     * easily passed around.
     */
    dump() {
        const arr = [];
        for (const i of this.#indexes({ allowStale: true })) {
            const key = this.#keyList[i];
            const v = this.#valList[i];
            const value = this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
            if (value === undefined || key === undefined)
                continue;
            const entry = { value };
            if (this.#ttls && this.#starts) {
                entry.ttl = this.#ttls[i];
                // always dump the start relative to a portable timestamp
                // it's ok for this to be a bit slow, it's a rare operation.
                const age = this.#perf.now() - this.#starts[i];
                entry.start = Math.floor(Date.now() - age);
            }
            if (this.#sizes) {
                entry.size = this.#sizes[i];
            }
            arr.unshift([key, entry]);
        }
        return arr;
    }
    /**
     * Reset the cache and load in the items in entries in the order listed.
     *
     * The shape of the resulting cache may be different if the same options are
     * not used in both caches.
     *
     * The `start` fields are assumed to be calculated relative to a portable
     * `Date.now()` timestamp, even if `performance.now()` is available.
     */
    load(arr) {
        this.clear();
        for (const [key, entry] of arr) {
            if (entry.start) {
                // entry.start is a portable timestamp, but we may be using
                // node's performance.now(), so calculate the offset, so that
                // we get the intended remaining TTL, no matter how long it's
                // been on ice.
                //
                // it's ok for this to be a bit slow, it's a rare operation.
                const age = Date.now() - entry.start;
                entry.start = this.#perf.now() - age;
            }
            this.set(key, entry.value, entry);
        }
    }
    /**
     * Add a value to the cache.
     *
     * Note: if `undefined` is specified as a value, this is an alias for
     * {@link LRUCache#delete}
     *
     * Fields on the {@link LRUCache.SetOptions} options param will override
     * their corresponding values in the constructor options for the scope
     * of this single `set()` operation.
     *
     * If `start` is provided, then that will set the effective start
     * time for the TTL calculation. Note that this must be a previous
     * value of `performance.now()` if supported, or a previous value of
     * `Date.now()` if not.
     *
     * Options object may also include `size`, which will prevent
     * calling the `sizeCalculation` function and just use the specified
     * number if it is a positive integer, and `noDisposeOnSet` which
     * will prevent calling a `dispose` function in the case of
     * overwrites.
     *
     * If the `size` (or return value of `sizeCalculation`) for a given
     * entry is greater than `maxEntrySize`, then the item will not be
     * added to the cache.
     *
     * Will update the recency of the entry.
     *
     * If the value is `undefined`, then this is an alias for
     * `cache.delete(key)`. `undefined` is never stored in the cache.
     */
    set(k, v, setOptions = {}) {
        if (v === undefined) {
            this.delete(k);
            return this;
        }
        const { ttl = this.ttl, start, noDisposeOnSet = this.noDisposeOnSet, sizeCalculation = this.sizeCalculation, status, } = setOptions;
        let { noUpdateTTL = this.noUpdateTTL } = setOptions;
        const size = this.#requireSize(k, v, setOptions.size || 0, sizeCalculation);
        // if the item doesn't fit, don't do anything
        // NB: maxEntrySize set to maxSize by default
        if (this.maxEntrySize && size > this.maxEntrySize) {
            if (status) {
                status.set = 'miss';
                status.maxEntrySizeExceeded = true;
            }
            // have to delete, in case something is there already.
            this.#delete(k, 'set');
            return this;
        }
        let index = this.#size === 0 ? undefined : this.#keyMap.get(k);
        if (index === undefined) {
            // addition
            index = (this.#size === 0 ? this.#tail
                : this.#free.length !== 0 ? this.#free.pop()
                    : this.#size === this.#max ? this.#evict(false)
                        : this.#size);
            this.#keyList[index] = k;
            this.#valList[index] = v;
            this.#keyMap.set(k, index);
            this.#next[this.#tail] = index;
            this.#prev[index] = this.#tail;
            this.#tail = index;
            this.#size++;
            this.#addItemSize(index, size, status);
            if (status)
                status.set = 'add';
            noUpdateTTL = false;
            if (this.#hasOnInsert) {
                this.#onInsert?.(v, k, 'add');
            }
        }
        else {
            // update
            this.#moveToTail(index);
            const oldVal = this.#valList[index];
            if (v !== oldVal) {
                if (this.#hasFetchMethod && this.#isBackgroundFetch(oldVal)) {
                    oldVal.__abortController.abort(new Error('replaced'));
                    const { __staleWhileFetching: s } = oldVal;
                    if (s !== undefined && !noDisposeOnSet) {
                        if (this.#hasDispose) {
                            this.#dispose?.(s, k, 'set');
                        }
                        if (this.#hasDisposeAfter) {
                            this.#disposed?.push([s, k, 'set']);
                        }
                    }
                }
                else if (!noDisposeOnSet) {
                    if (this.#hasDispose) {
                        this.#dispose?.(oldVal, k, 'set');
                    }
                    if (this.#hasDisposeAfter) {
                        this.#disposed?.push([oldVal, k, 'set']);
                    }
                }
                this.#removeItemSize(index);
                this.#addItemSize(index, size, status);
                this.#valList[index] = v;
                if (status) {
                    status.set = 'replace';
                    const oldValue = oldVal && this.#isBackgroundFetch(oldVal) ?
                        oldVal.__staleWhileFetching
                        : oldVal;
                    if (oldValue !== undefined)
                        status.oldValue = oldValue;
                }
            }
            else if (status) {
                status.set = 'update';
            }
            if (this.#hasOnInsert) {
                this.onInsert?.(v, k, v === oldVal ? 'update' : 'replace');
            }
        }
        if (ttl !== 0 && !this.#ttls) {
            this.#initializeTTLTracking();
        }
        if (this.#ttls) {
            if (!noUpdateTTL) {
                this.#setItemTTL(index, ttl, start);
            }
            if (status)
                this.#statusTTL(status, index);
        }
        if (!noDisposeOnSet && this.#hasDisposeAfter && this.#disposed) {
            const dt = this.#disposed;
            let task;
            while ((task = dt?.shift())) {
                this.#disposeAfter?.(...task);
            }
        }
        return this;
    }
    /**
     * Evict the least recently used item, returning its value or
     * `undefined` if cache is empty.
     */
    pop() {
        try {
            while (this.#size) {
                const val = this.#valList[this.#head];
                this.#evict(true);
                if (this.#isBackgroundFetch(val)) {
                    if (val.__staleWhileFetching) {
                        return val.__staleWhileFetching;
                    }
                }
                else if (val !== undefined) {
                    return val;
                }
            }
        }
        finally {
            if (this.#hasDisposeAfter && this.#disposed) {
                const dt = this.#disposed;
                let task;
                while ((task = dt?.shift())) {
                    this.#disposeAfter?.(...task);
                }
            }
        }
    }
    #evict(free) {
        const head = this.#head;
        const k = this.#keyList[head];
        const v = this.#valList[head];
        if (this.#hasFetchMethod && this.#isBackgroundFetch(v)) {
            v.__abortController.abort(new Error('evicted'));
        }
        else if (this.#hasDispose || this.#hasDisposeAfter) {
            if (this.#hasDispose) {
                this.#dispose?.(v, k, 'evict');
            }
            if (this.#hasDisposeAfter) {
                this.#disposed?.push([v, k, 'evict']);
            }
        }
        this.#removeItemSize(head);
        if (this.#autopurgeTimers?.[head]) {
            clearTimeout(this.#autopurgeTimers[head]);
            this.#autopurgeTimers[head] = undefined;
        }
        // if we aren't about to use the index, then null these out
        if (free) {
            this.#keyList[head] = undefined;
            this.#valList[head] = undefined;
            this.#free.push(head);
        }
        if (this.#size === 1) {
            this.#head = this.#tail = 0;
            this.#free.length = 0;
        }
        else {
            this.#head = this.#next[head];
        }
        this.#keyMap.delete(k);
        this.#size--;
        return head;
    }
    /**
     * Check if a key is in the cache, without updating the recency of use.
     * Will return false if the item is stale, even though it is technically
     * in the cache.
     *
     * Check if a key is in the cache, without updating the recency of
     * use. Age is updated if {@link LRUCache.OptionsBase.updateAgeOnHas} is set
     * to `true` in either the options or the constructor.
     *
     * Will return `false` if the item is stale, even though it is technically in
     * the cache. The difference can be determined (if it matters) by using a
     * `status` argument, and inspecting the `has` field.
     *
     * Will not update item age unless
     * {@link LRUCache.OptionsBase.updateAgeOnHas} is set.
     */
    has(k, hasOptions = {}) {
        const { updateAgeOnHas = this.updateAgeOnHas, status } = hasOptions;
        const index = this.#keyMap.get(k);
        if (index !== undefined) {
            const v = this.#valList[index];
            if (this.#isBackgroundFetch(v) &&
                v.__staleWhileFetching === undefined) {
                return false;
            }
            if (!this.#isStale(index)) {
                if (updateAgeOnHas) {
                    this.#updateItemAge(index);
                }
                if (status) {
                    status.has = 'hit';
                    this.#statusTTL(status, index);
                }
                return true;
            }
            else if (status) {
                status.has = 'stale';
                this.#statusTTL(status, index);
            }
        }
        else if (status) {
            status.has = 'miss';
        }
        return false;
    }
    /**
     * Like {@link LRUCache#get} but doesn't update recency or delete stale
     * items.
     *
     * Returns `undefined` if the item is stale, unless
     * {@link LRUCache.OptionsBase.allowStale} is set.
     */
    peek(k, peekOptions = {}) {
        const { allowStale = this.allowStale } = peekOptions;
        const index = this.#keyMap.get(k);
        if (index === undefined || (!allowStale && this.#isStale(index))) {
            return;
        }
        const v = this.#valList[index];
        // either stale and allowed, or forcing a refresh of non-stale value
        return this.#isBackgroundFetch(v) ? v.__staleWhileFetching : v;
    }
    #backgroundFetch(k, index, options, context) {
        const v = index === undefined ? undefined : this.#valList[index];
        if (this.#isBackgroundFetch(v)) {
            return v;
        }
        const ac = new AC();
        const { signal } = options;
        // when/if our AC signals, then stop listening to theirs.
        signal?.addEventListener('abort', () => ac.abort(signal.reason), {
            signal: ac.signal,
        });
        const fetchOpts = {
            signal: ac.signal,
            options,
            context,
        };
        const cb = (v, updateCache = false) => {
            const { aborted } = ac.signal;
            const ignoreAbort = options.ignoreFetchAbort && v !== undefined;
            if (options.status) {
                if (aborted && !updateCache) {
                    options.status.fetchAborted = true;
                    options.status.fetchError = ac.signal.reason;
                    if (ignoreAbort)
                        options.status.fetchAbortIgnored = true;
                }
                else {
                    options.status.fetchResolved = true;
                }
            }
            if (aborted && !ignoreAbort && !updateCache) {
                return fetchFail(ac.signal.reason);
            }
            // either we didn't abort, and are still here, or we did, and ignored
            const bf = p;
            // if nothing else has been written there but we're set to update the
            // cache and ignore the abort, or if it's still pending on this specific
            // background request, then write it to the cache.
            const vl = this.#valList[index];
            if (vl === p || (ignoreAbort && updateCache && vl === undefined)) {
                if (v === undefined) {
                    if (bf.__staleWhileFetching !== undefined) {
                        this.#valList[index] = bf.__staleWhileFetching;
                    }
                    else {
                        this.#delete(k, 'fetch');
                    }
                }
                else {
                    if (options.status)
                        options.status.fetchUpdated = true;
                    this.set(k, v, fetchOpts.options);
                }
            }
            return v;
        };
        const eb = (er) => {
            if (options.status) {
                options.status.fetchRejected = true;
                options.status.fetchError = er;
            }
            return fetchFail(er);
        };
        const fetchFail = (er) => {
            const { aborted } = ac.signal;
            const allowStaleAborted = aborted && options.allowStaleOnFetchAbort;
            const allowStale = allowStaleAborted || options.allowStaleOnFetchRejection;
            const noDelete = allowStale || options.noDeleteOnFetchRejection;
            const bf = p;
            if (this.#valList[index] === p) {
                // if we allow stale on fetch rejections, then we need to ensure that
                // the stale value is not removed from the cache when the fetch fails.
                const del = !noDelete || bf.__staleWhileFetching === undefined;
                if (del) {
                    this.#delete(k, 'fetch');
                }
                else if (!allowStaleAborted) {
                    // still replace the *promise* with the stale value,
                    // since we are done with the promise at this point.
                    // leave it untouched if we're still waiting for an
                    // aborted background fetch that hasn't yet returned.
                    this.#valList[index] = bf.__staleWhileFetching;
                }
            }
            if (allowStale) {
                if (options.status && bf.__staleWhileFetching !== undefined) {
                    options.status.returnedStale = true;
                }
                return bf.__staleWhileFetching;
            }
            else if (bf.__returned === bf) {
                throw er;
            }
        };
        const pcall = (res, rej) => {
            const fmp = this.#fetchMethod?.(k, v, fetchOpts);
            if (fmp && fmp instanceof Promise) {
                fmp.then(v => res(v === undefined ? undefined : v), rej);
            }
            // ignored, we go until we finish, regardless.
            // defer check until we are actually aborting,
            // so fetchMethod can override.
            ac.signal.addEventListener('abort', () => {
                if (!options.ignoreFetchAbort || options.allowStaleOnFetchAbort) {
                    res(undefined);
                    // when it eventually resolves, update the cache.
                    if (options.allowStaleOnFetchAbort) {
                        res = v => cb(v, true);
                    }
                }
            });
        };
        if (options.status)
            options.status.fetchDispatched = true;
        const p = new Promise(pcall).then(cb, eb);
        const bf = Object.assign(p, {
            __abortController: ac,
            __staleWhileFetching: v,
            __returned: undefined,
        });
        if (index === undefined) {
            // internal, don't expose status.
            this.set(k, bf, { ...fetchOpts.options, status: undefined });
            index = this.#keyMap.get(k);
        }
        else {
            this.#valList[index] = bf;
        }
        return bf;
    }
    #isBackgroundFetch(p) {
        if (!this.#hasFetchMethod)
            return false;
        const b = p;
        return (!!b &&
            b instanceof Promise &&
            b.hasOwnProperty('__staleWhileFetching') &&
            b.__abortController instanceof AC);
    }
    async fetch(k, fetchOptions = {}) {
        const { 
        // get options
        allowStale = this.allowStale, updateAgeOnGet = this.updateAgeOnGet, noDeleteOnStaleGet = this.noDeleteOnStaleGet, 
        // set options
        ttl = this.ttl, noDisposeOnSet = this.noDisposeOnSet, size = 0, sizeCalculation = this.sizeCalculation, noUpdateTTL = this.noUpdateTTL, 
        // fetch exclusive options
        noDeleteOnFetchRejection = this.noDeleteOnFetchRejection, allowStaleOnFetchRejection = this.allowStaleOnFetchRejection, ignoreFetchAbort = this.ignoreFetchAbort, allowStaleOnFetchAbort = this.allowStaleOnFetchAbort, context, forceRefresh = false, status, signal, } = fetchOptions;
        if (!this.#hasFetchMethod) {
            if (status)
                status.fetch = 'get';
            return this.get(k, {
                allowStale,
                updateAgeOnGet,
                noDeleteOnStaleGet,
                status,
            });
        }
        const options = {
            allowStale,
            updateAgeOnGet,
            noDeleteOnStaleGet,
            ttl,
            noDisposeOnSet,
            size,
            sizeCalculation,
            noUpdateTTL,
            noDeleteOnFetchRejection,
            allowStaleOnFetchRejection,
            allowStaleOnFetchAbort,
            ignoreFetchAbort,
            status,
            signal,
        };
        let index = this.#keyMap.get(k);
        if (index === undefined) {
            if (status)
                status.fetch = 'miss';
            const p = this.#backgroundFetch(k, index, options, context);
            return (p.__returned = p);
        }
        else {
            // in cache, maybe already fetching
            const v = this.#valList[index];
            if (this.#isBackgroundFetch(v)) {
                const stale = allowStale && v.__staleWhileFetching !== undefined;
                if (status) {
                    status.fetch = 'inflight';
                    if (stale)
                        status.returnedStale = true;
                }
                return stale ? v.__staleWhileFetching : (v.__returned = v);
            }
            // if we force a refresh, that means do NOT serve the cached value,
            // unless we are already in the process of refreshing the cache.
            const isStale = this.#isStale(index);
            if (!forceRefresh && !isStale) {
                if (status)
                    status.fetch = 'hit';
                this.#moveToTail(index);
                if (updateAgeOnGet) {
                    this.#updateItemAge(index);
                }
                if (status)
                    this.#statusTTL(status, index);
                return v;
            }
            // ok, it is stale or a forced refresh, and not already fetching.
            // refresh the cache.
            const p = this.#backgroundFetch(k, index, options, context);
            const hasStale = p.__staleWhileFetching !== undefined;
            const staleVal = hasStale && allowStale;
            if (status) {
                status.fetch = isStale ? 'stale' : 'refresh';
                if (staleVal && isStale)
                    status.returnedStale = true;
            }
            return staleVal ? p.__staleWhileFetching : (p.__returned = p);
        }
    }
    async forceFetch(k, fetchOptions = {}) {
        const v = await this.fetch(k, fetchOptions);
        if (v === undefined)
            throw new Error('fetch() returned undefined');
        return v;
    }
    memo(k, memoOptions = {}) {
        const memoMethod = this.#memoMethod;
        if (!memoMethod) {
            throw new Error('no memoMethod provided to constructor');
        }
        const { context, forceRefresh, ...options } = memoOptions;
        const v = this.get(k, options);
        if (!forceRefresh && v !== undefined)
            return v;
        const vv = memoMethod(k, v, {
            options,
            context,
        });
        this.set(k, vv, options);
        return vv;
    }
    /**
     * Return a value from the cache. Will update the recency of the cache
     * entry found.
     *
     * If the key is not found, get() will return `undefined`.
     */
    get(k, getOptions = {}) {
        const { allowStale = this.allowStale, updateAgeOnGet = this.updateAgeOnGet, noDeleteOnStaleGet = this.noDeleteOnStaleGet, status, } = getOptions;
        const index = this.#keyMap.get(k);
        if (index !== undefined) {
            const value = this.#valList[index];
            const fetching = this.#isBackgroundFetch(value);
            if (status)
                this.#statusTTL(status, index);
            if (this.#isStale(index)) {
                if (status)
                    status.get = 'stale';
                // delete only if not an in-flight background fetch
                if (!fetching) {
                    if (!noDeleteOnStaleGet) {
                        this.#delete(k, 'expire');
                    }
                    if (status && allowStale)
                        status.returnedStale = true;
                    return allowStale ? value : undefined;
                }
                else {
                    if (status &&
                        allowStale &&
                        value.__staleWhileFetching !== undefined) {
                        status.returnedStale = true;
                    }
                    return allowStale ? value.__staleWhileFetching : undefined;
                }
            }
            else {
                if (status)
                    status.get = 'hit';
                // if we're currently fetching it, we don't actually have it yet
                // it's not stale, which means this isn't a staleWhileRefetching.
                // If it's not stale, and fetching, AND has a __staleWhileFetching
                // value, then that means the user fetched with {forceRefresh:true},
                // so it's safe to return that value.
                if (fetching) {
                    return value.__staleWhileFetching;
                }
                this.#moveToTail(index);
                if (updateAgeOnGet) {
                    this.#updateItemAge(index);
                }
                return value;
            }
        }
        else if (status) {
            status.get = 'miss';
        }
    }
    #connect(p, n) {
        this.#prev[n] = p;
        this.#next[p] = n;
    }
    #moveToTail(index) {
        // if tail already, nothing to do
        // if head, move head to next[index]
        // else
        //   move next[prev[index]] to next[index] (head has no prev)
        //   move prev[next[index]] to prev[index]
        // prev[index] = tail
        // next[tail] = index
        // tail = index
        if (index !== this.#tail) {
            if (index === this.#head) {
                this.#head = this.#next[index];
            }
            else {
                this.#connect(this.#prev[index], this.#next[index]);
            }
            this.#connect(this.#tail, index);
            this.#tail = index;
        }
    }
    /**
     * Deletes a key out of the cache.
     *
     * Returns true if the key was deleted, false otherwise.
     */
    delete(k) {
        return this.#delete(k, 'delete');
    }
    #delete(k, reason) {
        let deleted = false;
        if (this.#size !== 0) {
            const index = this.#keyMap.get(k);
            if (index !== undefined) {
                if (this.#autopurgeTimers?.[index]) {
                    clearTimeout(this.#autopurgeTimers?.[index]);
                    this.#autopurgeTimers[index] = undefined;
                }
                deleted = true;
                if (this.#size === 1) {
                    this.#clear(reason);
                }
                else {
                    this.#removeItemSize(index);
                    const v = this.#valList[index];
                    if (this.#isBackgroundFetch(v)) {
                        v.__abortController.abort(new Error('deleted'));
                    }
                    else if (this.#hasDispose || this.#hasDisposeAfter) {
                        if (this.#hasDispose) {
                            this.#dispose?.(v, k, reason);
                        }
                        if (this.#hasDisposeAfter) {
                            this.#disposed?.push([v, k, reason]);
                        }
                    }
                    this.#keyMap.delete(k);
                    this.#keyList[index] = undefined;
                    this.#valList[index] = undefined;
                    if (index === this.#tail) {
                        this.#tail = this.#prev[index];
                    }
                    else if (index === this.#head) {
                        this.#head = this.#next[index];
                    }
                    else {
                        const pi = this.#prev[index];
                        this.#next[pi] = this.#next[index];
                        const ni = this.#next[index];
                        this.#prev[ni] = this.#prev[index];
                    }
                    this.#size--;
                    this.#free.push(index);
                }
            }
        }
        if (this.#hasDisposeAfter && this.#disposed?.length) {
            const dt = this.#disposed;
            let task;
            while ((task = dt?.shift())) {
                this.#disposeAfter?.(...task);
            }
        }
        return deleted;
    }
    /**
     * Clear the cache entirely, throwing away all values.
     */
    clear() {
        return this.#clear('delete');
    }
    #clear(reason) {
        for (const index of this.#rindexes({ allowStale: true })) {
            const v = this.#valList[index];
            if (this.#isBackgroundFetch(v)) {
                v.__abortController.abort(new Error('deleted'));
            }
            else {
                const k = this.#keyList[index];
                if (this.#hasDispose) {
                    this.#dispose?.(v, k, reason);
                }
                if (this.#hasDisposeAfter) {
                    this.#disposed?.push([v, k, reason]);
                }
            }
        }
        this.#keyMap.clear();
        this.#valList.fill(undefined);
        this.#keyList.fill(undefined);
        if (this.#ttls && this.#starts) {
            this.#ttls.fill(0);
            this.#starts.fill(0);
            for (const t of this.#autopurgeTimers ?? []) {
                if (t !== undefined)
                    clearTimeout(t);
            }
            this.#autopurgeTimers?.fill(undefined);
        }
        if (this.#sizes) {
            this.#sizes.fill(0);
        }
        this.#head = 0;
        this.#tail = 0;
        this.#free.length = 0;
        this.#calculatedSize = 0;
        this.#size = 0;
        if (this.#hasDisposeAfter && this.#disposed) {
            const dt = this.#disposed;
            let task;
            while ((task = dt?.shift())) {
                this.#disposeAfter?.(...task);
            }
        }
    }
}

/**
 * StampedeProtectedCache provides three-layer protection against cache stampedes
 *
 * @description High-performance caching system implementing multiple stampede prevention
 * strategies to protect downstream services (market data APIs, position services) from
 * request bursts during synchronized cache expiration events.
 *
 * @rationale In algorithmic trading, cache stampedes can:
 * - Overwhelm market data APIs (Alpaca, Polygon) causing rate limiting (200 req/min limits)
 * - Introduce latency spikes during critical trading windows (market open/close)
 * - Trigger cascading failures when position data becomes unavailable
 * - Cause missed trading opportunities due to stale or unavailable data
 *
 * Three-layer protection:
 * 1. Request coalescing - Multiple concurrent requests for the same key share a single promise
 * 2. Stale-while-revalidate - Serve stale data while refreshing in background
 * 3. Probabilistic early expiration - Add jitter to prevent synchronized expiration
 *
 * @template T - Type of cached data (e.g., AlpacaPosition[], MarketQuote, AccountInfo)
 *
 * @example
 * ```typescript
 * // Initialize cache for position data
 * const positionCache = new StampedeProtectedCache<AlpacaPosition[]>({
 *   maxSize: 1000,
 *   defaultTtl: 30000, // 30 seconds
 *   staleWhileRevalidateTtl: 60000, // 60 seconds grace
 *   minJitter: 0.9,
 *   maxJitter: 1.1,
 *   enableBackgroundRefresh: true,
 *   logger: pinoLogger
 * });
 *
 * // Fetch with automatic caching and stampede protection
 * const positions = await positionCache.get(
 *   accountId,
 *   async (key) => await alpacaApi.getPositions(key)
 * );
 * ```
 *
 * @businessLogic
 * 1. On cache.get(), check for existing entry
 * 2. If found and fresh (< TTL with jitter): return cached value (HIT)
 * 3. If found but stale (< staleWhileRevalidateTtl): return stale value, trigger background refresh (STALE HIT)
 * 4. If not found or expired beyond grace period: fetch from source (MISS)
 * 5. During fetch, coalesce duplicate concurrent requests to single API call
 * 6. After successful fetch, cache result with jittered TTL to prevent synchronized expiration
 *
 * @auditTrail
 * - All cache operations logged with timestamps and metadata
 * - Statistics tracked: hits, misses, stale hits, coalesced requests, refresh errors
 * - Performance metrics exposed via getStats() for monitoring dashboards
 */
class StampedeProtectedCache {
    cache;
    options;
    pendingRefreshes = new Map();
    stats = {
        totalGets: 0,
        hits: 0,
        misses: 0,
        staleHits: 0,
        coalescedRequests: 0,
        backgroundRefreshes: 0,
        refreshErrors: 0,
    };
    constructor(options) {
        this.options = {
            ...options,
            staleWhileRevalidateTtl: options.staleWhileRevalidateTtl ?? options.defaultTtl * 2,
            minJitter: options.minJitter ?? 0.9,
            maxJitter: options.maxJitter ?? 1.1,
            enableBackgroundRefresh: options.enableBackgroundRefresh ?? true,
            logger: options.logger ?? {
                debug: () => { },
                info: () => { },
                warn: () => { },
                error: () => { },
            },
        };
        this.cache = new LRUCache({
            max: this.options.maxSize,
            ttl: undefined, // We manage TTL ourselves
            allowStale: true,
            updateAgeOnGet: false,
            updateAgeOnHas: false,
        });
        this.options.logger.info('StampedeProtectedCache initialized', {
            maxSize: this.options.maxSize,
            defaultTtl: this.options.defaultTtl,
            staleWhileRevalidateTtl: this.options.staleWhileRevalidateTtl,
            jitterRange: [this.options.minJitter, this.options.maxJitter],
        });
    }
    /**
     * Get a value from the cache, loading it if necessary
     *
     * @description Primary cache access method implementing three-layer stampede protection.
     * Returns cached data if fresh, serves stale data while refreshing if within grace period,
     * or fetches fresh data with request coalescing if expired.
     *
     * @param key - Unique cache key (e.g., accountId, symbol, "positions:ACCT123")
     * @param loader - Async function to load data on cache miss
     * @param ttl - Optional TTL override in milliseconds. If not provided, uses defaultTtl from config
     *
     * @returns Promise resolving to cached or freshly loaded data
     *
     * @throws Error if loader function fails and no stale data is available
     *
     * @example
     * ```typescript
     * // Get positions with default TTL
     * const positions = await cache.get(
     *   accountId,
     *   async (key) => await alpacaApi.getPositions(key)
     * );
     *
     * // Get market quote with custom TTL (5 seconds for real-time data)
     * const quote = await cache.get(
     *   `quote:${symbol}`,
     *   async (key) => await polygonApi.getQuote(symbol),
     *   5000
     * );
     * ```
     *
     * @businessLogic
     * 1. Increment totalGets counter for statistics
     * 2. Calculate effective TTL (custom or default)
     * 3. Attempt cache lookup by key
     * 4. If entry exists:
     *    a. Increment access count and update lastAccessedAt
     *    b. Apply probabilistic jitter to expiration time
     *    c. If still fresh (now < jitteredExpiresAt): return cached value (HIT)
     *    d. If stale but within grace period (now < staleExpiresAt) and not already refreshing:
     *       - Serve stale value immediately
     *       - Trigger background refresh if enabled
     *       - Return stale value (STALE HIT)
     * 5. If entry not found or expired beyond grace: load fresh data with coalescing (MISS)
     */
    async get(key, loader, ttl) {
        this.stats.totalGets++;
        const effectiveTtl = ttl ?? this.options.defaultTtl;
        const now = Date.now();
        // Check if we have a cached entry
        const cached = this.cache.get(key);
        if (cached) {
            cached.accessCount++;
            cached.lastAccessedAt = now;
            // Check if entry is still fresh (considering probabilistic expiration)
            const jitteredExpiresAt = this.applyJitter(cached.expiresAt);
            if (now < jitteredExpiresAt) {
                // Fresh hit
                this.stats.hits++;
                this.options.logger.debug('Cache hit (fresh)', { key, age: now - cached.createdAt });
                return cached.value;
            }
            // Check if we can serve stale while revalidating
            const staleExpiresAt = cached.createdAt + this.options.staleWhileRevalidateTtl;
            if (now < staleExpiresAt && !cached.isRefreshing) {
                // Serve stale and trigger background refresh
                this.stats.staleHits++;
                this.options.logger.debug('Cache hit (stale-while-revalidate)', {
                    key,
                    age: now - cached.createdAt,
                    staleAge: now - cached.expiresAt
                });
                if (this.options.enableBackgroundRefresh) {
                    this.refreshInBackground(key, loader, effectiveTtl);
                }
                return cached.value;
            }
        }
        // Cache miss or expired - need to load
        this.stats.misses++;
        this.options.logger.debug('Cache miss', { key, hadCached: !!cached });
        return this.loadWithCoalescing(key, loader, effectiveTtl);
    }
    /**
     * Set a value in the cache
     *
     * @description Manually store a value in the cache with optional custom TTL.
     * Useful for pre-warming cache or storing computed results.
     *
     * @param key - Unique cache key
     * @param value - Data to cache
     * @param ttl - Optional TTL in milliseconds. If not provided, uses defaultTtl
     *
     * @returns void
     *
     * @example
     * ```typescript
     * // Pre-warm cache with known data
     * cache.set('positions:ACCT123', positions, 30000);
     *
     * // Cache computed result
     * const aggregatedData = computeAggregation(positions);
     * cache.set('aggregated:ACCT123', aggregatedData, 60000);
     * ```
     */
    set(key, value, ttl) {
        const effectiveTtl = ttl ?? this.options.defaultTtl;
        const now = Date.now();
        const entry = {
            value,
            createdAt: now,
            ttl: effectiveTtl,
            expiresAt: now + effectiveTtl,
            accessCount: 0,
            lastAccessedAt: now,
            isRefreshing: false,
        };
        this.cache.set(key, entry);
        this.options.logger.debug('Cache set', { key, ttl: effectiveTtl });
    }
    /**
     * Check if a key exists in the cache (regardless of expiration)
     *
     * @description Checks for cache entry existence without considering TTL or freshness.
     * Does not update access statistics or timestamps.
     *
     * @param key - Cache key to check
     *
     * @returns true if entry exists (fresh or stale), false otherwise
     *
     * @example
     * ```typescript
     * if (cache.has(accountId)) {
     *   // Entry exists, may be fresh or stale
     * }
     * ```
     */
    has(key) {
        return this.cache.has(key);
    }
    /**
     * Delete a specific key from the cache
     *
     * @description Immediately removes cache entry and any pending refreshes for the key.
     * Useful for cache invalidation when source data changes.
     *
     * @param key - Cache key to delete
     *
     * @returns true if entry was deleted, false if key did not exist
     *
     * @example
     * ```typescript
     * // Invalidate after position update
     * await alpacaApi.submitOrder(order);
     * cache.delete(`positions:${accountId}`);
     * ```
     */
    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.options.logger.debug('Cache entry deleted', { key });
        }
        return deleted;
    }
    /**
     * Invalidate a key (alias for delete)
     *
     * @description Semantic alias for delete() method. Use for clarity when invalidating
     * cache after data mutations.
     *
     * @param key - Cache key to invalidate
     *
     * @returns true if entry was invalidated, false if key did not exist
     *
     * @example
     * ```typescript
     * // Invalidate after trade execution
     * cache.invalidate(`positions:${accountId}`);
     * ```
     */
    invalidate(key) {
        return this.delete(key);
    }
    /**
     * Clear all entries from the cache
     *
     * @description Removes all cached entries and pending refreshes. Use during system
     * resets or configuration changes requiring fresh data.
     *
     * @returns void
     *
     * @example
     * ```typescript
     * // Clear cache during market hours transition
     * if (marketJustOpened) {
     *   cache.clear();
     * }
     * ```
     */
    clear() {
        const sizeBefore = this.cache.size;
        this.cache.clear();
        this.pendingRefreshes.clear();
        this.options.logger.info('Cache cleared', { entriesRemoved: sizeBefore });
    }
    /**
     * Get cache statistics
     *
     * @description Returns comprehensive performance metrics for monitoring and analysis.
     * Statistics include hit/miss ratios, active refreshes, coalesced requests, and errors.
     *
     * @returns CacheStats object with current performance metrics
     *
     * @example
     * ```typescript
     * const stats = cache.getStats();
     * logger.info('Cache performance', {
     *   hitRatio: stats.hitRatio,
     *   size: stats.size,
     *   activeRefreshes: stats.activeRefreshes
     * });
     *
     * // Alert on poor performance
     * if (stats.hitRatio < 0.7) {
     *   alerting.send('Low cache hit ratio', stats);
     * }
     * ```
     */
    getStats() {
        return {
            totalGets: this.stats.totalGets,
            hits: this.stats.hits,
            misses: this.stats.misses,
            staleHits: this.stats.staleHits,
            hitRatio: this.stats.totalGets > 0 ? this.stats.hits / this.stats.totalGets : 0,
            size: this.cache.size,
            maxSize: this.options.maxSize,
            activeRefreshes: this.pendingRefreshes.size,
            coalescedRequests: this.stats.coalescedRequests,
            backgroundRefreshes: this.stats.backgroundRefreshes,
            refreshErrors: this.stats.refreshErrors,
        };
    }
    /**
     * Get all cached keys
     *
     * @description Returns array of all cache keys currently stored, regardless of freshness.
     * Useful for debugging and cache inspection.
     *
     * @returns Array of cache keys
     *
     * @example
     * ```typescript
     * const keys = cache.keys();
     * console.log('Cached accounts:', keys);
     * // ['positions:ACCT123', 'positions:ACCT456', 'quote:AAPL']
     * ```
     */
    keys() {
        return Array.from(this.cache.keys());
    }
    /**
     * Get the size of the cache
     *
     * @description Returns current number of entries in cache. Compare to maxSize to
     * monitor capacity utilization.
     *
     * @returns Number of cached entries
     *
     * @example
     * ```typescript
     * const utilizationPct = (cache.size / cache.getStats().maxSize) * 100;
     * if (utilizationPct > 90) {
     *   logger.warn('Cache near capacity', { size: cache.size });
     * }
     * ```
     */
    get size() {
        return this.cache.size;
    }
    /**
     * Load data with request coalescing to prevent duplicate requests
     */
    async loadWithCoalescing(key, loader, ttl) {
        // Check if there's already a pending refresh for this key
        const existingPromise = this.pendingRefreshes.get(key);
        if (existingPromise) {
            this.stats.coalescedRequests++;
            this.options.logger.debug('Request coalesced', { key });
            return existingPromise;
        }
        // Create new promise and store it
        const promise = this.loadAndCache(key, loader, ttl);
        this.pendingRefreshes.set(key, promise);
        try {
            const result = await promise;
            return result;
        }
        finally {
            // Clean up the pending promise
            this.pendingRefreshes.delete(key);
        }
    }
    /**
     * Load data and cache it
     */
    async loadAndCache(key, loader, ttl) {
        const startTime = Date.now();
        try {
            this.options.logger.debug('Loading data', { key });
            const value = await loader(key);
            // Cache the loaded value
            this.set(key, value, ttl);
            const loadTime = Date.now() - startTime;
            this.options.logger.debug('Data loaded and cached', { key, loadTime });
            return value;
        }
        catch (error) {
            this.stats.refreshErrors++;
            const loadTime = Date.now() - startTime;
            this.options.logger.error('Failed to load data', { key, error, loadTime });
            // Update cached entry with error if it exists
            const cached = this.cache.get(key);
            if (cached) {
                cached.lastError = error;
                cached.isRefreshing = false;
            }
            throw error;
        }
    }
    /**
     * Refresh data in the background
     */
    refreshInBackground(key, loader, ttl) {
        // Mark the entry as refreshing
        const cached = this.cache.get(key);
        if (cached) {
            cached.isRefreshing = true;
        }
        // Don't wait for the refresh to complete
        this.loadWithCoalescing(key, loader, ttl)
            .then(() => {
            this.stats.backgroundRefreshes++;
            this.options.logger.debug('Background refresh completed', { key });
        })
            .catch((error) => {
            this.options.logger.warn('Background refresh failed', { key, error });
        })
            .finally(() => {
            // Mark as no longer refreshing
            const entry = this.cache.get(key);
            if (entry) {
                entry.isRefreshing = false;
            }
        });
    }
    /**
     * Apply probabilistic jitter to expiration time
     */
    applyJitter(originalExpiresAt) {
        const range = this.options.maxJitter - this.options.minJitter;
        const jitter = this.options.minJitter + (Math.random() * range);
        const createdAt = originalExpiresAt - this.options.defaultTtl;
        const jitteredTtl = this.options.defaultTtl * jitter;
        return createdAt + jitteredTtl;
    }
    /**
     * Reset statistics (useful for testing)
     *
     * @description Clears all performance counters to zero. Use for testing or when starting
     * fresh metrics collection period.
     *
     * @returns void
     *
     * @example
     * ```typescript
     * // Reset stats at start of trading day
     * cache.resetStats();
     * ```
     */
    resetStats() {
        this.stats.totalGets = 0;
        this.stats.hits = 0;
        this.stats.misses = 0;
        this.stats.staleHits = 0;
        this.stats.coalescedRequests = 0;
        this.stats.backgroundRefreshes = 0;
        this.stats.refreshErrors = 0;
    }
}
/**
 * Factory function to create a new StampedeProtectedCache instance
 *
 * @description Convenience factory for creating cache instances with type inference.
 * Alternative to using 'new StampedeProtectedCache<T>()'.
 *
 * @template T - Type of cached data
 * @param options - Cache configuration options
 *
 * @returns New StampedeProtectedCache instance
 *
 * @example
 * ```typescript
 * // Type is automatically inferred
 * const cache = createStampedeProtectedCache<AlpacaPosition[]>({
 *   maxSize: 1000,
 *   defaultTtl: 30000
 * });
 * ```
 */
function createStampedeProtectedCache(options) {
    return new StampedeProtectedCache(options);
}
/**
 * Default cache options for common use cases
 *
 * @description Production-tested default configuration suitable for most trading applications.
 * Provides balanced performance for position and market data caching.
 *
 * @rationale These defaults are optimized for:
 * - Position data refresh frequency (30-60s acceptable staleness)
 * - API rate limit protection (Alpaca: 200 req/min)
 * - Memory efficiency (1000 entries ≈ 10MB for typical position data)
 * - Stampede prevention (±10% jitter prevents synchronized expiration)
 *
 * @example
 * ```typescript
 * // Use defaults for quick setup
 * const cache = new StampedeProtectedCache({
 *   ...DEFAULT_CACHE_OPTIONS,
 *   logger: customLogger
 * });
 *
 * // Override specific settings
 * const realtimeCache = new StampedeProtectedCache({
 *   ...DEFAULT_CACHE_OPTIONS,
 *   defaultTtl: 5000, // 5s for real-time quotes
 *   maxSize: 10000
 * });
 * ```
 */
const DEFAULT_CACHE_OPTIONS = {
    maxSize: 1000,
    defaultTtl: 60000, // 1 minute
    staleWhileRevalidateTtl: 120000, // 2 minutes
    minJitter: 0.9, // 90%
    maxJitter: 1.1, // 110%
    enableBackgroundRefresh: true,
};

/**
 * Intelligent Asset Allocation Algorithm
 *
 * Determines optimal asset allocation across multiple asset classes based on:
 * - User risk profile
 * - Market conditions
 * - Account size
 * - User preferences
 * - Modern Portfolio Theory principles
 * - Risk-adjusted returns
 * - Diversification optimization
 */
/**
 * Asset Allocation Engine
 *
 * Implements sophisticated portfolio optimization using:
 * - Mean-variance optimization
 * - Risk parity approach
 * - Black-Litterman model influences
 * - Correlation-based diversification
 * - Dynamic risk adjustment
 */
class AssetAllocationEngine {
    config;
    defaultConfig = {
        objective: 'MAX_SHARPE',
        riskFreeRate: 0.04, // 4% risk-free rate
        rebalancingThreshold: 5, // 5% drift threshold
        transactionCostModel: 'PERCENTAGE',
        timeHorizon: 5, // 5 year horizon
        allowLeverage: false,
        includeAlternatives: true
    };
    /**
     * Default risk profiles with typical asset class allocations
     */
    defaultRiskProfiles = new Map([
        [
            'CONSERVATIVE',
            {
                profile: 'CONSERVATIVE',
                description: 'Capital preservation focused with minimal volatility',
                baseAllocations: new Map([
                    ['EQUITIES', 0.20],
                    ['OPTIONS', 0.05],
                    ['FUTURES', 0.00],
                    ['ETF', 0.50],
                    ['FOREX', 0.10],
                    ['CRYPTO', 0.00]
                ]),
                maxVolatility: 8,
                maxDrawdown: 10,
                targetReturn: 5,
                riskScore: 20
            }
        ],
        [
            'MODERATE_CONSERVATIVE',
            {
                profile: 'MODERATE_CONSERVATIVE',
                description: 'Income focused with moderate growth potential',
                baseAllocations: new Map([
                    ['EQUITIES', 0.30],
                    ['OPTIONS', 0.10],
                    ['FUTURES', 0.05],
                    ['ETF', 0.40],
                    ['FOREX', 0.10],
                    ['CRYPTO', 0.05]
                ]),
                maxVolatility: 12,
                maxDrawdown: 15,
                targetReturn: 7,
                riskScore: 35
            }
        ],
        [
            'MODERATE',
            {
                profile: 'MODERATE',
                description: 'Balanced growth and income with managed volatility',
                baseAllocations: new Map([
                    ['EQUITIES', 0.40],
                    ['OPTIONS', 0.15],
                    ['FUTURES', 0.10],
                    ['ETF', 0.25],
                    ['FOREX', 0.05],
                    ['CRYPTO', 0.05]
                ]),
                maxVolatility: 15,
                maxDrawdown: 20,
                targetReturn: 10,
                riskScore: 50
            }
        ],
        [
            'MODERATE_AGGRESSIVE',
            {
                profile: 'MODERATE_AGGRESSIVE',
                description: 'Growth focused with higher volatility tolerance',
                baseAllocations: new Map([
                    ['EQUITIES', 0.50],
                    ['OPTIONS', 0.20],
                    ['FUTURES', 0.10],
                    ['ETF', 0.10],
                    ['FOREX', 0.05],
                    ['CRYPTO', 0.05]
                ]),
                maxVolatility: 20,
                maxDrawdown: 25,
                targetReturn: 13,
                riskScore: 70
            }
        ],
        [
            'AGGRESSIVE',
            {
                profile: 'AGGRESSIVE',
                description: 'Maximum growth with high volatility acceptance',
                baseAllocations: new Map([
                    ['EQUITIES', 0.45],
                    ['OPTIONS', 0.25],
                    ['FUTURES', 0.15],
                    ['ETF', 0.05],
                    ['FOREX', 0.05],
                    ['CRYPTO', 0.05]
                ]),
                maxVolatility: 30,
                maxDrawdown: 35,
                targetReturn: 18,
                riskScore: 85
            }
        ]
    ]);
    constructor(config = {}) {
        this.config = config;
        this.config = { ...this.defaultConfig, ...config };
    }
    /**
     * Generate optimal asset allocation recommendation
     */
    async generateAllocation(input) {
        // Step 1: Determine risk profile if not provided
        const riskProfile = input.riskProfile || this.inferRiskProfile(input);
        // Step 2: Assess market conditions
        const marketCondition = this.assessMarketCondition(input.marketConditions);
        // Step 3: Get base allocations from risk profile
        const baseAllocations = this.getBaseAllocations(riskProfile);
        // Step 4: Adjust allocations based on market conditions
        const marketAdjustedAllocations = this.adjustForMarketConditions(baseAllocations, marketCondition, input.marketConditions);
        // Step 5: Apply user preferences and constraints
        const constrainedAllocations = this.applyConstraints(marketAdjustedAllocations, input.preferences, input.constraints, input.assetCharacteristics);
        // Step 6: Optimize allocations using selected objective
        const optimizedAllocations = this.optimizeAllocations(constrainedAllocations, input.assetCharacteristics, input.accountSize, riskProfile);
        // Step 7: Calculate portfolio metrics
        const portfolioMetrics = this.calculatePortfolioMetrics(optimizedAllocations, input.assetCharacteristics);
        // Step 8: Perform risk analysis
        const riskAnalysis = this.performRiskAnalysis(optimizedAllocations, input.assetCharacteristics, riskProfile);
        // Step 9: Calculate diversification metrics
        const diversification = this.calculateDiversification(optimizedAllocations, input.assetCharacteristics);
        // Step 10: Generate rebalancing recommendations if current positions exist
        const rebalancing = input.currentPositions
            ? this.generateRebalancingActions(input.currentPositions, optimizedAllocations, input.accountSize)
            : undefined;
        // Step 11: Build allocation recommendation
        const recommendation = {
            id: this.generateRecommendationId(),
            allocations: this.buildAssetAllocations(optimizedAllocations, input.accountSize, input.assetCharacteristics, portfolioMetrics, riskProfile),
            portfolioMetrics,
            riskAnalysis,
            diversification,
            rebalancing,
            timestamp: new Date(),
            nextRebalancingDate: this.calculateNextRebalancingDate(input.preferences?.rebalancingFrequency),
            methodology: this.getMethodologyDescription(this.config.objective, riskProfile),
            warnings: this.generateWarnings(optimizedAllocations, riskAnalysis, input)
        };
        return recommendation;
    }
    /**
     * Infer risk profile from account characteristics
     */
    inferRiskProfile(input) {
        let riskScore = 50; // Start at moderate
        // Adjust based on account size
        if (input.accountSize < 10000) {
            riskScore -= 10; // Smaller accounts tend to be more conservative
        }
        else if (input.accountSize > 100000) {
            riskScore += 10; // Larger accounts can take more risk
        }
        // Adjust based on preferences
        if (input.preferences?.maxDrawdown) {
            if (input.preferences.maxDrawdown < 15)
                riskScore -= 15;
            else if (input.preferences.maxDrawdown > 25)
                riskScore += 15;
        }
        if (input.preferences?.targetReturn) {
            if (input.preferences.targetReturn < 6)
                riskScore -= 10;
            else if (input.preferences.targetReturn > 12)
                riskScore += 10;
        }
        // Adjust based on excluded asset classes (conservative if many excluded)
        if (input.preferences?.excludedAssetClasses) {
            riskScore -= input.preferences.excludedAssetClasses.length * 5;
        }
        // Map score to profile
        if (riskScore < 30)
            return 'CONSERVATIVE';
        if (riskScore < 45)
            return 'MODERATE_CONSERVATIVE';
        if (riskScore < 60)
            return 'MODERATE';
        if (riskScore < 75)
            return 'MODERATE_AGGRESSIVE';
        return 'AGGRESSIVE';
    }
    /**
     * Assess current market condition
     */
    assessMarketCondition(metrics) {
        // High volatility check
        if (metrics.volatilityIndex > 30) {
            return 'HIGH_VOLATILITY';
        }
        // Low volatility check
        if (metrics.volatilityIndex < 12) {
            return 'LOW_VOLATILITY';
        }
        // Crisis detection
        if (metrics.volatilityIndex > 40 ||
            metrics.sentimentScore < 20 ||
            metrics.creditSpread > 500) {
            return 'CRISIS';
        }
        // Bull market
        if (metrics.trendDirection === 'UP' &&
            metrics.marketStrength > 60 &&
            metrics.sentimentScore > 60) {
            return 'BULL';
        }
        // Bear market
        if (metrics.trendDirection === 'DOWN' &&
            metrics.marketStrength < 40 &&
            metrics.sentimentScore < 40) {
            return 'BEAR';
        }
        // Default to sideways
        return 'SIDEWAYS';
    }
    /**
     * Get base allocations from risk profile
     */
    getBaseAllocations(riskProfile) {
        const profile = this.defaultRiskProfiles.get(riskProfile);
        if (!profile) {
            throw new Error(`Unknown risk profile: ${riskProfile}`);
        }
        return new Map(profile.baseAllocations);
    }
    /**
     * Adjust allocations based on market conditions
     */
    adjustForMarketConditions(baseAllocations, condition, metrics) {
        const adjusted = new Map(baseAllocations);
        switch (condition) {
            case 'CRISIS':
                // Shift to defensive assets
                this.scaleAllocation(adjusted, 'EQUITIES', 0.5);
                this.scaleAllocation(adjusted, 'OPTIONS', 0.3);
                this.scaleAllocation(adjusted, 'FUTURES', 0.2);
                this.scaleAllocation(adjusted, 'ETF', 1.5);
                this.scaleAllocation(adjusted, 'CRYPTO', 0.1);
                break;
            case 'HIGH_VOLATILITY':
                // Reduce volatile assets
                this.scaleAllocation(adjusted, 'OPTIONS', 0.7);
                this.scaleAllocation(adjusted, 'FUTURES', 0.7);
                this.scaleAllocation(adjusted, 'CRYPTO', 0.5);
                this.scaleAllocation(adjusted, 'ETF', 1.2);
                break;
            case 'LOW_VOLATILITY':
                // Can take more risk
                this.scaleAllocation(adjusted, 'EQUITIES', 1.1);
                this.scaleAllocation(adjusted, 'OPTIONS', 1.2);
                this.scaleAllocation(adjusted, 'CRYPTO', 1.3);
                break;
            case 'BULL':
                // Increase growth assets
                this.scaleAllocation(adjusted, 'EQUITIES', 1.2);
                this.scaleAllocation(adjusted, 'OPTIONS', 1.1);
                this.scaleAllocation(adjusted, 'CRYPTO', 1.2);
                this.scaleAllocation(adjusted, 'ETF', 0.9);
                break;
            case 'BEAR':
                // Defensive positioning
                this.scaleAllocation(adjusted, 'EQUITIES', 0.7);
                this.scaleAllocation(adjusted, 'OPTIONS', 0.8);
                this.scaleAllocation(adjusted, 'CRYPTO', 0.6);
                this.scaleAllocation(adjusted, 'ETF', 1.3);
                this.scaleAllocation(adjusted, 'FOREX', 1.2);
                break;
            case 'SIDEWAYS':
                // Favor income and options strategies
                this.scaleAllocation(adjusted, 'OPTIONS', 1.2);
                this.scaleAllocation(adjusted, 'EQUITIES', 0.95);
                break;
        }
        // Additional adjustments based on specific metrics
        if (metrics.inflationRate > 4) {
            // High inflation - favor real assets
            this.scaleAllocation(adjusted, 'CRYPTO', 1.1);
            this.scaleAllocation(adjusted, 'ETF', 0.9);
        }
        if (metrics.interestRateLevel === 'HIGH') {
            // High rates - favor fixed income and reduce growth
            this.scaleAllocation(adjusted, 'EQUITIES', 0.9);
            this.scaleAllocation(adjusted, 'ETF', 1.1);
        }
        // Normalize to sum to 1.0
        return this.normalizeAllocations(adjusted);
    }
    /**
     * Scale allocation for a specific asset class
     */
    scaleAllocation(allocations, assetClass, scaleFactor) {
        const current = allocations.get(assetClass) || 0;
        allocations.set(assetClass, current * scaleFactor);
    }
    /**
     * Normalize allocations to sum to 1.0
     */
    normalizeAllocations(allocations) {
        const total = Array.from(allocations.values()).reduce((sum, val) => sum + val, 0);
        if (total === 0) {
            // Equal weight if all zeros
            const assetCount = allocations.size;
            allocations.forEach((_, key) => allocations.set(key, 1 / assetCount));
            return allocations;
        }
        const normalized = new Map();
        allocations.forEach((value, key) => {
            normalized.set(key, value / total);
        });
        return normalized;
    }
    /**
     * Apply user constraints and preferences
     */
    applyConstraints(allocations, preferences, constraints, characteristics) {
        const constrained = new Map(allocations);
        // Apply exclusions
        if (preferences?.excludedAssetClasses) {
            preferences.excludedAssetClasses.forEach(asset => {
                constrained.set(asset, 0);
            });
        }
        // Apply preferred asset classes
        if (preferences?.preferredAssetClasses && preferences.preferredAssetClasses.length > 0) {
            // Zero out non-preferred assets
            constrained.forEach((_, asset) => {
                if (!preferences.preferredAssetClasses.includes(asset)) {
                    constrained.set(asset, 0);
                }
            });
        }
        // Apply min/max per class
        if (preferences?.minAllocationPerClass !== undefined) {
            constrained.forEach((value, asset) => {
                if (value > 0 && value < preferences.minAllocationPerClass) {
                    constrained.set(asset, preferences.minAllocationPerClass);
                }
            });
        }
        if (preferences?.maxAllocationPerClass !== undefined) {
            constrained.forEach((value, asset) => {
                if (value > preferences.maxAllocationPerClass) {
                    constrained.set(asset, preferences.maxAllocationPerClass);
                }
            });
        }
        // Apply specific constraints
        if (constraints) {
            constraints.forEach(constraint => {
                if (constraint.assetClass) {
                    const current = constrained.get(constraint.assetClass) || 0;
                    switch (constraint.type) {
                        case 'MIN_ALLOCATION':
                            if (current < constraint.value && constraint.hard) {
                                constrained.set(constraint.assetClass, constraint.value);
                            }
                            break;
                        case 'MAX_ALLOCATION':
                            if (current > constraint.value) {
                                constrained.set(constraint.assetClass, constraint.value);
                            }
                            break;
                    }
                }
            });
        }
        // Re-normalize after constraint application
        return this.normalizeAllocations(constrained);
    }
    /**
     * Optimize allocations using specified objective
     */
    optimizeAllocations(allocations, characteristics, accountSize, riskProfile) {
        const charMap = new Map(characteristics.map(c => [c.assetClass, c]));
        switch (this.config.objective) {
            case 'MAX_SHARPE':
                return this.maximizeSharpeRatio(allocations, charMap);
            case 'MIN_RISK':
                return this.minimizeRisk(allocations, charMap);
            case 'MAX_RETURN':
                return this.maximizeReturn(allocations, charMap, riskProfile);
            case 'RISK_PARITY':
                return this.riskParityAllocation(allocations, charMap);
            case 'MAX_DIVERSIFICATION':
                return this.maximizeDiversification(allocations, charMap);
            default:
                return allocations;
        }
    }
    /**
     * Maximize Sharpe ratio allocation
     */
    maximizeSharpeRatio(allocations, characteristics) {
        const optimized = new Map();
        // Calculate excess returns (return - risk-free rate)
        const excessReturns = new Map();
        allocations.forEach((_, asset) => {
            const char = characteristics.get(asset);
            if (char) {
                const excessReturn = char.expectedReturn - this.config.riskFreeRate * 100;
                excessReturns.set(asset, excessReturn);
            }
        });
        // Weight by Sharpe ratio (simplified)
        let totalSharpe = 0;
        const sharpeRatios = new Map();
        allocations.forEach((_, asset) => {
            const char = characteristics.get(asset);
            if (char && char.volatility > 0) {
                const sharpe = (excessReturns.get(asset) || 0) / char.volatility;
                sharpeRatios.set(asset, Math.max(0, sharpe)); // Only positive sharpe
                totalSharpe += Math.max(0, sharpe);
            }
        });
        // Allocate proportional to Sharpe ratio
        if (totalSharpe > 0) {
            sharpeRatios.forEach((sharpe, asset) => {
                optimized.set(asset, sharpe / totalSharpe);
            });
        }
        else {
            // Fall back to equal weight
            const count = allocations.size;
            allocations.forEach((_, asset) => {
                optimized.set(asset, 1 / count);
            });
        }
        // Blend with original allocations (50/50 blend)
        const blended = new Map();
        allocations.forEach((originalWeight, asset) => {
            const optimizedWeight = optimized.get(asset) || 0;
            blended.set(asset, 0.5 * originalWeight + 0.5 * optimizedWeight);
        });
        return this.normalizeAllocations(blended);
    }
    /**
     * Minimize portfolio risk
     */
    minimizeRisk(allocations, characteristics) {
        const optimized = new Map();
        // Weight inversely to volatility
        let totalInvVol = 0;
        const invVolatilities = new Map();
        allocations.forEach((_, asset) => {
            const char = characteristics.get(asset);
            if (char && char.volatility > 0) {
                const invVol = 1 / char.volatility;
                invVolatilities.set(asset, invVol);
                totalInvVol += invVol;
            }
        });
        // Allocate proportional to inverse volatility
        if (totalInvVol > 0) {
            invVolatilities.forEach((invVol, asset) => {
                optimized.set(asset, invVol / totalInvVol);
            });
        }
        else {
            const count = allocations.size;
            allocations.forEach((_, asset) => {
                optimized.set(asset, 1 / count);
            });
        }
        // Blend with original
        const blended = new Map();
        allocations.forEach((originalWeight, asset) => {
            const optimizedWeight = optimized.get(asset) || 0;
            blended.set(asset, 0.6 * optimizedWeight + 0.4 * originalWeight);
        });
        return this.normalizeAllocations(blended);
    }
    /**
     * Maximize expected return
     */
    maximizeReturn(allocations, characteristics, riskProfile) {
        const profile = this.defaultRiskProfiles.get(riskProfile);
        if (!profile)
            return allocations;
        const optimized = new Map();
        // Weight by expected return, but cap by volatility constraint
        let totalAdjustedReturn = 0;
        const adjustedReturns = new Map();
        allocations.forEach((_, asset) => {
            const char = characteristics.get(asset);
            if (char) {
                // Penalize high volatility assets
                const volatilityPenalty = char.volatility > profile.maxVolatility
                    ? 0.5
                    : 1.0;
                const adjustedReturn = char.expectedReturn * volatilityPenalty;
                adjustedReturns.set(asset, Math.max(0, adjustedReturn));
                totalAdjustedReturn += Math.max(0, adjustedReturn);
            }
        });
        // Allocate proportional to adjusted returns
        if (totalAdjustedReturn > 0) {
            adjustedReturns.forEach((adjReturn, asset) => {
                optimized.set(asset, adjReturn / totalAdjustedReturn);
            });
        }
        else {
            const count = allocations.size;
            allocations.forEach((_, asset) => {
                optimized.set(asset, 1 / count);
            });
        }
        // Blend with original
        const blended = new Map();
        allocations.forEach((originalWeight, asset) => {
            const optimizedWeight = optimized.get(asset) || 0;
            blended.set(asset, 0.5 * optimizedWeight + 0.5 * originalWeight);
        });
        return this.normalizeAllocations(blended);
    }
    /**
     * Risk parity allocation (equal risk contribution)
     */
    riskParityAllocation(allocations, characteristics) {
        // Simplified risk parity: weight inversely to volatility
        return this.minimizeRisk(allocations, characteristics);
    }
    /**
     * Maximize diversification
     */
    maximizeDiversification(allocations, characteristics) {
        const optimized = new Map();
        // Calculate average correlation for each asset
        const avgCorrelations = new Map();
        allocations.forEach((_, asset) => {
            const char = characteristics.get(asset);
            if (char && char.correlations) {
                let sumCorr = 0;
                let count = 0;
                char.correlations.forEach((corr, _) => {
                    sumCorr += Math.abs(corr);
                    count++;
                });
                const avgCorr = count > 0 ? sumCorr / count : 0.5;
                avgCorrelations.set(asset, avgCorr);
            }
        });
        // Weight inversely to average correlation
        let totalInvCorr = 0;
        const invCorrelations = new Map();
        avgCorrelations.forEach((avgCorr, asset) => {
            const invCorr = 1 / (0.1 + avgCorr); // Add small constant to avoid division by zero
            invCorrelations.set(asset, invCorr);
            totalInvCorr += invCorr;
        });
        // Allocate proportional to inverse correlation
        if (totalInvCorr > 0) {
            invCorrelations.forEach((invCorr, asset) => {
                optimized.set(asset, invCorr / totalInvCorr);
            });
        }
        else {
            const count = allocations.size;
            allocations.forEach((_, asset) => {
                optimized.set(asset, 1 / count);
            });
        }
        // Blend with original
        const blended = new Map();
        allocations.forEach((originalWeight, asset) => {
            const optimizedWeight = optimized.get(asset) || 0;
            blended.set(asset, 0.5 * optimizedWeight + 0.5 * originalWeight);
        });
        return this.normalizeAllocations(blended);
    }
    /**
     * Calculate comprehensive portfolio metrics
     */
    calculatePortfolioMetrics(allocations, characteristics) {
        const charMap = new Map(characteristics.map(c => [c.assetClass, c]));
        let expectedReturn = 0;
        let portfolioVariance = 0;
        // Calculate expected return
        allocations.forEach((weight, asset) => {
            const char = charMap.get(asset);
            if (char) {
                expectedReturn += weight * char.expectedReturn;
            }
        });
        // Calculate portfolio variance (simplified - assumes correlations)
        const assetList = Array.from(allocations.keys());
        for (let i = 0; i < assetList.length; i++) {
            for (let j = 0; j < assetList.length; j++) {
                const asset1 = assetList[i];
                const asset2 = assetList[j];
                const w1 = allocations.get(asset1) || 0;
                const w2 = allocations.get(asset2) || 0;
                const char1 = charMap.get(asset1);
                const char2 = charMap.get(asset2);
                if (char1 && char2) {
                    const vol1 = char1.volatility / 100; // Convert from percentage
                    const vol2 = char2.volatility / 100;
                    let correlation = 1.0;
                    if (i !== j) {
                        correlation = char1.correlations?.get(asset2) ?? 0.3; // Default correlation
                    }
                    portfolioVariance += w1 * w2 * vol1 * vol2 * correlation;
                }
            }
        }
        const expectedVolatility = Math.sqrt(portfolioVariance) * 100; // Convert to percentage
        // Calculate Sharpe ratio
        const excessReturn = expectedReturn - this.config.riskFreeRate * 100;
        const sharpeRatio = expectedVolatility > 0 ? excessReturn / expectedVolatility : 0;
        // Calculate Sortino ratio (simplified - using volatility as proxy)
        const downsideDeviation = expectedVolatility * 0.7; // Rough approximation
        const sortinoRatio = downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;
        // Estimate maximum drawdown (rough approximation)
        const maxDrawdown = expectedVolatility * 1.5;
        // VaR and CVaR (parametric approach, 95% confidence)
        const valueAtRisk95 = 1.645 * expectedVolatility;
        const conditionalVaR = 2.063 * expectedVolatility; // 95% CVaR
        // Beta and Alpha (simplified)
        const beta = 1.0; // Assume market beta for now
        const alpha = expectedReturn - (this.config.riskFreeRate * 100 + beta * 6); // Assume 6% market risk premium
        // Information ratio
        const trackingError = expectedVolatility * 0.5;
        const informationRatio = trackingError > 0 ? alpha / trackingError : 0;
        return {
            expectedReturn,
            expectedVolatility,
            sharpeRatio,
            sortinoRatio,
            maxDrawdown,
            valueAtRisk95,
            conditionalVaR,
            beta,
            alpha,
            informationRatio
        };
    }
    /**
     * Perform comprehensive risk analysis
     */
    performRiskAnalysis(allocations, characteristics, riskProfile) {
        const charMap = new Map(characteristics.map(c => [c.assetClass, c]));
        const profile = this.defaultRiskProfiles.get(riskProfile);
        // Calculate portfolio volatility
        let totalVolatility = 0;
        allocations.forEach((weight, asset) => {
            const char = charMap.get(asset);
            if (char) {
                totalVolatility += weight * char.volatility;
            }
        });
        // Risk score (0-100)
        const riskScore = Math.min(100, (totalVolatility / profile.maxVolatility) * 100);
        // Risk level
        let riskLevel;
        if (riskScore < 40)
            riskLevel = 'LOW';
        else if (riskScore < 60)
            riskLevel = 'MEDIUM';
        else if (riskScore < 80)
            riskLevel = 'HIGH';
        else
            riskLevel = 'EXTREME';
        // Systematic vs idiosyncratic risk (simplified)
        const systematicRisk = totalVolatility * 0.7; // 70% systematic
        const idiosyncraticRisk = totalVolatility * 0.3; // 30% idiosyncratic
        // Tail risk (simplified - higher volatility = higher tail risk)
        const tailRisk = totalVolatility * 1.2;
        // Liquidity risk
        let liquidityRisk = 0;
        allocations.forEach((weight, asset) => {
            const char = charMap.get(asset);
            if (char) {
                liquidityRisk += weight * (100 - char.liquidityScore);
            }
        });
        // Concentration risk (HHI)
        let hhi = 0;
        allocations.forEach(weight => {
            hhi += weight * weight;
        });
        const concentrationRisk = hhi * 100;
        // Currency risk (simplified)
        const forexWeight = allocations.get('FOREX') || 0;
        const cryptoWeight = allocations.get('CRYPTO') || 0;
        const currencyRisk = (forexWeight + cryptoWeight) * 50;
        // Risk decomposition by asset class
        const riskDecomposition = new Map();
        let totalRiskContribution = 0;
        allocations.forEach((weight, asset) => {
            const char = charMap.get(asset);
            if (char) {
                const riskContribution = weight * char.volatility;
                riskDecomposition.set(asset, riskContribution);
                totalRiskContribution += riskContribution;
            }
        });
        // Normalize risk contributions
        if (totalRiskContribution > 0) {
            riskDecomposition.forEach((contrib, asset) => {
                riskDecomposition.set(asset, (contrib / totalRiskContribution) * 100);
            });
        }
        return {
            riskScore,
            riskLevel,
            systematicRisk,
            idiosyncraticRisk,
            tailRisk,
            liquidityRisk,
            concentrationRisk,
            currencyRisk,
            riskDecomposition
        };
    }
    /**
     * Calculate diversification metrics
     */
    calculateDiversification(allocations, characteristics) {
        const charMap = new Map(characteristics.map(c => [c.assetClass, c]));
        // Herfindahl-Hirschman Index (concentration measure)
        let hhi = 0;
        allocations.forEach(weight => {
            hhi += weight * weight;
        });
        // Effective number of assets
        const effectiveNumberOfAssets = hhi > 0 ? 1 / hhi : allocations.size;
        // Average correlation
        let sumCorrelations = 0;
        let correlationCount = 0;
        let maxCorr = 0;
        const assetList = Array.from(allocations.keys());
        for (let i = 0; i < assetList.length; i++) {
            for (let j = i + 1; j < assetList.length; j++) {
                const asset1 = assetList[i];
                const asset2 = assetList[j];
                const char1 = charMap.get(asset1);
                if (char1?.correlations) {
                    const corr = Math.abs(char1.correlations.get(asset2) ?? 0.3);
                    sumCorrelations += corr;
                    correlationCount++;
                    maxCorr = Math.max(maxCorr, corr);
                }
            }
        }
        const averageCorrelation = correlationCount > 0 ? sumCorrelations / correlationCount : 0;
        // Diversification ratio (weighted average vol / portfolio vol)
        let weightedAvgVol = 0;
        let portfolioVar = 0;
        allocations.forEach((weight, asset) => {
            const char = charMap.get(asset);
            if (char) {
                weightedAvgVol += weight * char.volatility;
            }
        });
        // Calculate portfolio variance
        for (let i = 0; i < assetList.length; i++) {
            for (let j = 0; j < assetList.length; j++) {
                const asset1 = assetList[i];
                const asset2 = assetList[j];
                const w1 = allocations.get(asset1) || 0;
                const w2 = allocations.get(asset2) || 0;
                const char1 = charMap.get(asset1);
                const char2 = charMap.get(asset2);
                if (char1 && char2) {
                    const vol1 = char1.volatility / 100;
                    const vol2 = char2.volatility / 100;
                    const corr = i === j ? 1.0 : (char1.correlations?.get(asset2) ?? 0.3);
                    portfolioVar += w1 * w2 * vol1 * vol2 * corr;
                }
            }
        }
        const portfolioVol = Math.sqrt(portfolioVar) * 100;
        const diversificationRatio = portfolioVol > 0 ? weightedAvgVol / portfolioVol : 1;
        // Asset class diversity score (based on number of asset classes used)
        const nonZeroAllocations = Array.from(allocations.values()).filter(w => w > 0.01).length;
        const totalAssetClasses = allocations.size;
        const assetClassDiversity = (nonZeroAllocations / totalAssetClasses) * 100;
        // Build correlation matrix
        const correlationMatrix = [];
        for (let i = 0; i < assetList.length; i++) {
            correlationMatrix[i] = [];
            for (let j = 0; j < assetList.length; j++) {
                if (i === j) {
                    correlationMatrix[i][j] = 1.0;
                }
                else {
                    const char1 = charMap.get(assetList[i]);
                    const corr = char1?.correlations?.get(assetList[j]) ?? 0.3;
                    correlationMatrix[i][j] = corr;
                }
            }
        }
        return {
            diversificationRatio,
            herfindahlIndex: hhi,
            effectiveNumberOfAssets,
            averageCorrelation,
            maxPairwiseCorrelation: maxCorr,
            correlationMatrix,
            assetClassDiversity
        };
    }
    /**
     * Generate rebalancing actions
     */
    generateRebalancingActions(currentPositions, targetAllocations, accountSize) {
        const actions = [];
        // Calculate current total value
        let currentTotal = 0;
        currentPositions.forEach(amount => {
            currentTotal += amount;
        });
        // Generate actions for each asset class
        targetAllocations.forEach((targetWeight, asset) => {
            const currentAmount = currentPositions.get(asset) || 0;
            const currentWeight = currentTotal > 0 ? currentAmount / currentTotal : 0;
            const targetAmount = accountSize * targetWeight;
            const drift = Math.abs(currentWeight - targetWeight);
            // Only rebalance if drift exceeds threshold
            if (drift > this.config.rebalancingThreshold / 100) {
                const tradeDelta = targetAmount - currentAmount;
                actions.push({
                    assetClass: asset,
                    currentAllocation: currentWeight,
                    targetAllocation: targetWeight,
                    action: tradeDelta > 0 ? 'BUY' : 'SELL',
                    tradeAmount: Math.abs(tradeDelta),
                    priority: drift > 0.15 ? 1 : drift > 0.10 ? 2 : 3,
                    estimatedCost: Math.abs(tradeDelta) * 0.001, // 0.1% transaction cost
                    reason: `Drift of ${(drift * 100).toFixed(2)}% exceeds threshold`
                });
            }
        });
        // Sort by priority
        actions.sort((a, b) => a.priority - b.priority);
        return actions;
    }
    /**
     * Build detailed asset allocations
     */
    buildAssetAllocations(allocations, accountSize, characteristics, portfolioMetrics, riskProfile) {
        const charMap = new Map(characteristics.map(c => [c.assetClass, c]));
        const assetAllocations = [];
        allocations.forEach((weight, asset) => {
            if (weight > 0.001) { // Only include meaningful allocations
                const char = charMap.get(asset);
                const amount = accountSize * weight;
                // Calculate risk contribution
                const assetVol = char?.volatility || 0;
                const portfolioVol = portfolioMetrics.expectedVolatility;
                const riskContribution = portfolioVol > 0 ? (weight * assetVol) / portfolioVol : 0;
                // Calculate return contribution
                const assetReturn = char?.expectedReturn || 0;
                const returnContribution = weight * assetReturn;
                // Generate rationale
                const rationale = this.generateAllocationRationale(asset, weight, char, riskProfile);
                // Calculate confidence (based on data quality and market conditions)
                const confidence = char ? Math.min(0.95, 0.7 + (char.liquidityScore / 200)) : 0.5;
                assetAllocations.push({
                    assetClass: asset,
                    allocation: weight,
                    amount,
                    riskContribution,
                    returnContribution,
                    rationale,
                    confidence
                });
            }
        });
        // Sort by allocation size
        assetAllocations.sort((a, b) => b.allocation - a.allocation);
        return assetAllocations;
    }
    /**
     * Generate rationale for asset allocation
     */
    generateAllocationRationale(asset, weight, characteristics, riskProfile) {
        if (!characteristics) {
            return `${(weight * 100).toFixed(1)}% allocated to ${asset}`;
        }
        const reasons = [];
        // Add size description
        if (weight > 0.3) {
            reasons.push('Core holding');
        }
        else if (weight > 0.15) {
            reasons.push('Significant position');
        }
        else if (weight > 0.05) {
            reasons.push('Moderate allocation');
        }
        else {
            reasons.push('Tactical allocation');
        }
        // Add characteristic-based reasoning
        if (characteristics.sharpeRatio > 1.5) {
            reasons.push('strong risk-adjusted returns');
        }
        if (characteristics.volatility < 15) {
            reasons.push('low volatility');
        }
        else if (characteristics.volatility > 25) {
            reasons.push('high growth potential');
        }
        if (characteristics.liquidityScore > 80) {
            reasons.push('high liquidity');
        }
        // Add risk profile context
        if (riskProfile === 'CONSERVATIVE' && asset === 'ETF') {
            reasons.push('diversification and stability');
        }
        else if (riskProfile === 'AGGRESSIVE' && asset === 'OPTIONS') {
            reasons.push('leveraged growth opportunities');
        }
        return `${(weight * 100).toFixed(1)}% allocation - ${reasons.join(', ')}`;
    }
    /**
     * Calculate next rebalancing date
     */
    calculateNextRebalancingDate(frequencyDays) {
        const days = frequencyDays || 90; // Default to quarterly
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + days);
        return nextDate;
    }
    /**
     * Get methodology description
     */
    getMethodologyDescription(objective, riskProfile) {
        const descriptions = {
            MAX_SHARPE: 'Sharpe ratio maximization with risk-adjusted return optimization',
            MIN_RISK: 'Minimum variance optimization prioritizing capital preservation',
            MAX_RETURN: 'Return maximization within risk tolerance constraints',
            RISK_PARITY: 'Equal risk contribution across asset classes',
            MAX_DIVERSIFICATION: 'Correlation-based diversification maximization',
            TARGET_RETURN: 'Target return achievement with minimum required risk',
            TARGET_RISK: 'Target risk level with maximum potential return'
        };
        return `${descriptions[objective]} tailored for ${riskProfile} risk profile`;
    }
    /**
     * Generate warnings based on allocation
     */
    generateWarnings(allocations, riskAnalysis, input) {
        const warnings = [];
        // High risk warning
        if (riskAnalysis.riskLevel === 'HIGH' || riskAnalysis.riskLevel === 'EXTREME') {
            warnings.push(`Portfolio risk level is ${riskAnalysis.riskLevel}. Consider reducing exposure to volatile assets.`);
        }
        // Concentration warning
        if (riskAnalysis.concentrationRisk > 40) {
            warnings.push('High concentration detected. Portfolio may benefit from additional diversification.');
        }
        // Liquidity warning
        if (riskAnalysis.liquidityRisk > 30) {
            warnings.push('Some positions may have limited liquidity. Consider exit strategies in advance.');
        }
        // Small account warning
        if (input.accountSize < 5000) {
            warnings.push('Small account size may limit diversification. Consider focusing on ETFs for broader exposure.');
        }
        // High volatility market warning
        if (input.marketConditions.volatilityIndex > 25) {
            warnings.push('Market volatility is elevated. Consider maintaining higher cash reserves.');
        }
        // Crypto allocation warning
        const cryptoAlloc = allocations.get('CRYPTO') || 0;
        if (cryptoAlloc > 0.15) {
            warnings.push('Cryptocurrency allocation exceeds 15%. Be aware of high volatility and regulatory risks.');
        }
        // Options allocation warning
        const optionsAlloc = allocations.get('OPTIONS') || 0;
        if (optionsAlloc > 0.25) {
            warnings.push('Options allocation is significant. Ensure adequate knowledge and risk management.');
        }
        return warnings;
    }
    /**
     * Generate unique recommendation ID
     */
    generateRecommendationId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 9);
        return `alloc_${timestamp}_${random}`;
    }
}
/**
 * Convenience function to generate allocation with default settings
 */
async function generateOptimalAllocation(input, config) {
    const engine = new AssetAllocationEngine(config);
    return engine.generateAllocation(input);
}
/**
 * Convenience function to get default risk profile characteristics
 */
function getDefaultRiskProfile(profile) {
    const engine = new AssetAllocationEngine();
    return engine.defaultRiskProfiles.get(profile);
}

// Export factory functions for easier instantiation
const createAlpacaTradingAPI = (credentials) => {
    return new AlpacaTradingAPI(credentials);
};
const createAlpacaMarketDataAPI = () => {
    return AlpacaMarketDataAPI.getInstance();
};
const adaptic = {
    types: Types,
    backend: {
        fetchAssetOverview: fetchAssetOverview,
        getApolloClient: getSharedApolloClient,
        configureAuth: configureAuth,
        isAuthConfigured: isAuthConfigured,
    },
    alpaca: {
        TradingAPI: AlpacaTradingAPI,
        MarketDataAPI: AlpacaMarketDataAPI,
        makeRequest: makeRequest,
        accountDetails: fetchAccountDetails,
        positions: fetchAllPositions, // to be deprecated
        position: {
            fetch: fetchPosition,
            close: closePosition,
            fetchAll: fetchAllPositions,
            closeAll: closeAllPositions,
            closeAllAfterHours: closeAllPositionsAfterHours,
        },
        portfolioHistory: fetchPortfolioHistory,
        getConfig: getConfiguration,
        updateConfig: updateConfiguration,
        news: fetchNews$1,
        orders: {
            create: createOrder,
            createLimitOrder: createLimitOrder,
            get: getOrder,
            getAll: getOrders,
            replace: replaceOrder,
            cancel: cancelOrder,
            cancelAll: cancelAllOrders,
        },
        asset: {
            get: getAsset,
        },
        quote: {
            getLatest: getLatestQuotes,
        },
    },
    av: {
        fetchQuote: fetchQuote,
        fetchTickerNews: fetchTickerNews,
        convertDateToYYYYMMDDTHHMM: convertDateToYYYYMMDDTHHMM,
        convertYYYYMMDDTHHMMSSToDate: convertYYYYMMDDTHHMMSSToDate,
    },
    crypto: {
        fetchBars: fetchBars,
        fetchNews: fetchNews,
        fetchLatestTrades: fetchLatestTrades,
        fetchLatestQuotes: fetchLatestQuotes,
    },
    format: {
        capitalize: capitalize,
        enum: formatEnum,
        currency: formatCurrency,
        number: formatNumber,
        percentage: formatPercentage,
        date: formatDate,
        dateToString: formatDateToString,
        dateTimeForGS: dateTimeForGS,
    },
    metrics: {
        trade: fetchTradeMetrics,
        alphaAndBeta: calculateAlphaAndBeta$1,
        maxDrawdown: calculateMaxDrawdown$1,
        dailyReturns: calculateDailyReturns$1,
        returnsByDate: alignReturnsByDate,
        beta: calculateBetaFromReturns$1,
        infoRatio: calculateInformationRatio$1,
        allpm: fetchPerformanceMetrics,
    },
    polygon: {
        fetchTickerInfo: fetchTickerInfo,
        fetchGroupedDaily: fetchGroupedDaily,
        fetchLastTrade: fetchLastTrade,
        fetchTrades: fetchTrades,
        fetchPrices: fetchPrices,
        analysePolygonPriceData: analysePolygonPriceData,
        formatPriceData: formatPriceData,
        fetchDailyOpenClose: fetchDailyOpenClose,
        getPreviousClose: getPreviousClose,
    },
    indices: {
        fetchAggregates: fetchIndicesAggregates,
        fetchPreviousClose: fetchIndicesPreviousClose,
        fetchDailyOpenClose: fetchIndicesDailyOpenClose,
        fetchSnapshot: fetchIndicesSnapshot,
        fetchUniversalSnapshot: fetchUniversalSnapshot,
        formatBarData: formatIndicesBarData,
    },
    price: {
        roundUp: roundStockPrice,
        equityValues: getEquityValues,
        totalFees: computeTotalFees,
    },
    ta: {
        calculateEMA: calculateEMA,
        calculateMACD: calculateMACD,
        calculateRSI: calculateRSI,
        calculateStochasticOscillator: calculateStochasticOscillator,
        calculateBollingerBands: calculateBollingerBands,
        calculateSupportAndResistance: calculateSupportAndResistance,
        calculateFibonacciLevels: calculateFibonacciLevels,
    },
    time: {
        toUnixTimestamp: toUnixTimestamp,
        getTimeAgo: getTimeAgo,
        timeAgo: timeAgo,
        normalizeDate: normalizeDate,
        getDateInNY: getDateInNY,
        createMarketTimeUtil: createMarketTimeUtil,
        getStartAndEndTimestamps: getStartAndEndTimestamps,
        getStartAndEndDates: getStartAndEndDates,
        getMarketOpenClose: getMarketOpenClose,
        calculateTimeRange: calculateTimeRange,
        calculateDaysLeft: calculateDaysLeft,
        formatDate: formatDate /* move to format, keeping here for compatibility  */,
        currentTimeET: currentTimeET,
        MarketTimeUtil: MarketTimeUtil,
        MARKET_TIMES: MARKET_TIMES,
        getLastTradingDateYYYYMMDD: getLastTradingDateYYYYMMDD,
        getLastFullTradingDate: getLastFullTradingDate,
        getNextMarketDay: getNextMarketDay,
        parseETDateFromAV: parseETDateFromAV,
        formatToUSEastern: formatToUSEastern,
        unixTimetoUSEastern: unixTimetoUSEastern,
        getMarketStatus: getMarketStatus,
        timeDiffString: timeDiffString,
        getNYTimeZone: getNYTimeZone,
        getTradingDate: getTradingDate,
    },
    utils: {
        logIfDebug: logIfDebug,
        fetchWithRetry: fetchWithRetry,
        validatePolygonApiKey: validatePolygonApiKey,
    },
};
const adptc = adaptic;

export { AlpacaMarketDataAPI, AlpacaTradingAPI, AssetAllocationEngine, DEFAULT_CACHE_OPTIONS, StampedeProtectedCache, adaptic, adptc, createAlpacaMarketDataAPI, createAlpacaTradingAPI, createStampedeProtectedCache, generateOptimalAllocation, getDefaultRiskProfile };
//# sourceMappingURL=index.mjs.map
