/**
 * Legacy Alpaca Asset Functions
 * Asset retrieval using AlpacaAuth pattern with direct fetch calls.
 */
import {
  AlpacaAuth,
  AlpacaAsset,
} from '../../types/alpaca-types';
import { validateAuth } from './auth';
import { getTradingApiUrl } from '../../config/api-endpoints';
import { getLogger } from '../../logger';
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from '../../http-timeout';

/**
 * Retrieves an asset from Alpaca by symbol or asset ID.
 * @param auth - The authentication details for Alpaca
 * @param symbolOrAssetId - The symbol or asset ID to retrieve
 * @returns The requested asset
 */
export async function getAsset(auth: AlpacaAuth, symbolOrAssetId: string): Promise<AlpacaAsset> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');

    // Use encodeURIComponent to handle special characters in symbols (e.g., BTC/USDT)
    const encodedSymbolOrAssetId = encodeURIComponent(symbolOrAssetId);

    const response = await fetch(`${apiBaseUrl}/v2/assets/${encodedSymbolOrAssetId}`, {
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
      throw new Error(`Failed to get asset: ${response.status} ${response.statusText} ${errorText}`);
    }

    return (await response.json()) as AlpacaAsset;
  } catch (error) {
    getLogger().error('Error in getAsset:', error);
    throw error;
  }
}
