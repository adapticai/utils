// Adaptic backend calls
import { getLogger } from './logger';
import { AssetOverviewResponse, AssetOverview } from './types';
import {
  getApolloClient,
  setTokenProvider,
  type TokenProvider,
} from '@adaptic/backend-legacy';
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from './http-timeout';

// Re-export TokenProvider type for consumers
export type { TokenProvider };

// Types for Apollo client without direct import
// NOTE: Using `any` here is intentional to avoid circular dependencies with @adaptic/backend-legacy
// The actual type is ApolloClient<NormalizedCacheObject> but we don't import it directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApolloClientType = any;

// Keep track of a single instance of Apollo client
let apolloClientInstance: ApolloClientType | null = null;

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
export const configureAuth = (provider: TokenProvider): void => {
  if (authConfigured) {
    getLogger().warn(
      '[adaptic] Auth provider already configured. Calling configureAuth again will reset the client.'
    );
  }
  setTokenProvider(provider);
  authConfigured = true;

  // Reset the cached client so it picks up the new auth on next request
  if (apolloClientInstance) {
    apolloClientInstance = null;
    getLogger().info('[adaptic] Apollo client reset due to auth configuration change');
  }
};

/**
 * Check if Apollo auth has been configured.
 */
export const isAuthConfigured = (): boolean => {
  return authConfigured;
};

/**
 * Returns a shared Apollo client instance with connection pooling.
 * This should be used for all @adaptic/backend-legacy operations.
 *
 * @returns {Promise<ApolloClientType>} The shared Apollo client instance.
 */
export const getSharedApolloClient = async (): Promise<ApolloClientType> => {
  if (!apolloClientInstance) {
    try {
      // Initialize the client once and reuse it across requests
      apolloClientInstance = await getApolloClient();
    } catch (error) {
      getLogger().error('Error initializing shared Apollo client:', error);
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
export const fetchAssetOverview = async (symbol: string): Promise<AssetOverviewResponse> => {
  if (!symbol) {
    return {
      asset: null,
      error: 'Symbol is required',
      success: false,
    };
  }

  try {
    const encodedSymbol = encodeURIComponent(symbol.trim().toUpperCase());
    const res = await fetch(`https://adaptic.ai/api/asset/overview?symbol=${encodedSymbol}`, {
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.GENERAL),
    });

    if (!res.ok) {
      const errorData = (await res.json()) as { error?: string };
      getLogger().error(`Failed to fetch asset data for ${symbol}:`, errorData);
      return {
        asset: null,
        error: errorData.error || `Failed to fetch asset data for ${symbol}`,
        success: false,
      };
    }

    const data = (await res.json()) as AssetOverviewResponse;

    if (!data.asset || !data.asset.id) {
      getLogger().error(`Invalid asset data received for ${symbol}:`, data);
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
    }, {} as AssetOverview);

    return {
      asset: {
        ...cleanedAsset,
        symbol: cleanedAsset.symbol || symbol,
      },
      error: null,
      success: true,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    getLogger().error(`Error fetching asset data for ${symbol}:`, errorMessage);
    return {
      asset: null,
      error: errorMessage,
      success: false,
    };
  }
};
