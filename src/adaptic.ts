// Adaptic backend calls
import { AssetOverviewResponse, AssetOverview } from './types';
import { getApolloClient } from '@adaptic/backend-legacy';

// Types for Apollo client without direct import
type ApolloClientType = any; // This avoids direct import from @adaptic/backend-legacy

// Keep track of a single instance of Apollo client
let apolloClientInstance: ApolloClientType | null = null;

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
    const res = await fetch(`https://adaptic.ai/api/asset/overview?symbol=${encodedSymbol}`);

    if (!res.ok) {
      const errorData = (await res.json()) as { error?: string };
      console.error(`Failed to fetch asset data for ${symbol}:`, errorData);
      return {
        asset: null,
        error: errorData.error || `Failed to fetch asset data for ${symbol}`,
        success: false,
      };
    }

    const data = (await res.json()) as AssetOverviewResponse;

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
    console.error(`Error fetching asset data for ${symbol}:`, errorMessage);
    return {
      asset: null,
      error: errorMessage,
      success: false,
    };
  }
};
