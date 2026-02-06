/**
 * API credential validation utilities
 * Provides fast, synchronous validation of API credentials before making requests
 */

/**
 * Validates Alpaca API credentials
 * @param auth - Authentication object containing API key and secret
 * @throws {Error} If credentials are invalid or missing
 */
export function validateAlpacaCredentials(auth: {
  apiKey: string;
  apiSecret: string;
  isPaper?: boolean;
}): void {
  if (!auth.apiKey || typeof auth.apiKey !== 'string' || auth.apiKey.trim().length === 0) {
    throw new Error('Invalid Alpaca API key: must be a non-empty string');
  }

  if (!auth.apiSecret || typeof auth.apiSecret !== 'string' || auth.apiSecret.trim().length === 0) {
    throw new Error('Invalid Alpaca API secret: must be a non-empty string');
  }

  // Alpaca keys are typically 20+ characters
  if (auth.apiKey.length < 10) {
    throw new Error('Alpaca API key appears to be too short');
  }
}

/**
 * Validates Polygon API key
 * @param apiKey - Polygon API key
 * @throws {Error} If API key is invalid or missing
 */
export function validatePolygonApiKey(apiKey: string): void {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('Invalid Polygon API key: must be a non-empty string');
  }
}

/**
 * Validates Alpha Vantage API key
 * @param apiKey - Alpha Vantage API key
 * @throws {Error} If API key is invalid or missing
 */
export function validateAlphaVantageApiKey(apiKey: string): void {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('Invalid Alpha Vantage API key: must be a non-empty string');
  }
}
