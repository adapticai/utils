import { AssetOverviewResponse } from './types';
import { type TokenProvider } from '@adaptic/backend-legacy';
export type { TokenProvider };
type ApolloClientType = any;
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
export declare const configureAuth: (provider: TokenProvider) => void;
/**
 * Check if Apollo auth has been configured.
 */
export declare const isAuthConfigured: () => boolean;
/**
 * Returns a shared Apollo client instance with connection pooling.
 * This should be used for all @adaptic/backend-legacy operations.
 *
 * @returns {Promise<ApolloClientType>} The shared Apollo client instance.
 */
export declare const getSharedApolloClient: () => Promise<ApolloClientType>;
/**
 * Fetches the asset overview for a given symbol from the Adaptic backend.
 *
 * @param {string} symbol - The symbol of the asset to fetch.
 * @returns {Promise<AssetOverviewResponse>} - A promise that resolves to the asset overview response.
 */
export declare const fetchAssetOverview: (symbol: string) => Promise<AssetOverviewResponse>;
//# sourceMappingURL=adaptic.d.ts.map