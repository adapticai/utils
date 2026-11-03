/**
 * API credential validation utilities
 * Provides fast, synchronous validation of API credentials before making requests
 */

/**
 * Validates Alpaca API credentials — their PRESENCE and shape, nothing more.
 *
 * It takes no account type and no paper/live flag, and must not acquire one.
 * Whether a key belongs to the paper or the live trading host is not
 * derivable from the key string — the `PK`/`AK` prefix is a vendor
 * convention, not a contract — so that question is answered only by
 * presenting the key to a host and reading the response, which is a network
 * measurement rather than a synchronous shape check.
 *
 * A parameter this function accepted but no branch read would be worse than
 * its absence: at every call site it reads as a check that is happening, so
 * it conceals the very gap it appears to close.
 *
 * @param auth - Authentication object containing API key and secret
 * @param options - Validation options
 * @param options.throwOnMissing - If false, missing credentials will log a warning instead of throwing (default: true)
 * @throws {Error} If credentials are invalid (when throwOnMissing is true)
 * @returns {boolean} True if credentials are valid, false if missing (when throwOnMissing is false)
 */
export function validateAlpacaCredentials(
  auth: {
    apiKey?: string;
    apiSecret?: string;
  },
  options: { throwOnMissing?: boolean } = { throwOnMissing: true },
): boolean {
  const { throwOnMissing = true } = options;

  // Check for missing or empty API key
  if (
    !auth.apiKey ||
    typeof auth.apiKey !== "string" ||
    auth.apiKey.trim().length === 0
  ) {
    if (throwOnMissing) {
      throw new Error("Invalid Alpaca API key: must be a non-empty string");
    }
    console.warn(
      "[AlpacaAPI] API key not configured. Market data features will be unavailable.",
    );
    return false;
  }

  // Check for missing or empty API secret
  if (
    !auth.apiSecret ||
    typeof auth.apiSecret !== "string" ||
    auth.apiSecret.trim().length === 0
  ) {
    if (throwOnMissing) {
      throw new Error("Invalid Alpaca API secret: must be a non-empty string");
    }
    console.warn(
      "[AlpacaAPI] API secret not configured. Market data features will be unavailable.",
    );
    return false;
  }

  // Alpaca keys are typically 20+ characters
  if (auth.apiKey.length < 10) {
    if (throwOnMissing) {
      throw new Error("Alpaca API key appears to be too short");
    }
    console.warn("[AlpacaAPI] API key appears to be too short.");
    return false;
  }

  return true;
}

/**
 * Validates Massive API key
 * @param apiKey - Massive API key
 * @throws {Error} If API key is invalid or missing
 */
export function validateMassiveApiKey(apiKey: string): void {
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("Invalid Massive API key: must be a non-empty string");
  }
}

/**
 * Validates Alpha Vantage API key
 * @param apiKey - Alpha Vantage API key
 * @throws {Error} If API key is invalid or missing
 */
export function validateAlphaVantageApiKey(apiKey: string): void {
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error(
      "Invalid Alpha Vantage API key: must be a non-empty string",
    );
  }
}
