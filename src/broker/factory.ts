/**
 * Broker Client Factory
 *
 * Provider-agnostic entry point for broker trading clients (SP2 multi-broker
 * seam). Strictly ADDITIVE: `createAlpacaClient`, `createAlpacaTradingAPI`,
 * and `createAlpacaMarketDataAPI` remain the canonical Alpaca factories and
 * are unchanged. Only ALPACA is implemented — all other providers throw a
 * typed {@link UnsupportedBrokerError}.
 *
 * @module @adaptic/utils/broker
 */
import { createAlpacaClient } from "../alpaca/client";
import { UnsupportedBrokerError } from "../errors";
import type {
  BrokerCredentials,
  BrokerageAccountType,
} from "../types/broker-types";

/**
 * Provider-agnostic view of a broker client's configuration.
 *
 * Structural subset of `AlpacaClientConfig` so the existing `AlpacaClient`
 * satisfies it without modification; future providers must expose at least
 * this surface.
 */
export interface BrokerClientConfig {
  /** API key for the brokerage. */
  apiKey: string;
  /** API secret for the brokerage. */
  apiSecret: string;
  /** Trading mode — selects paper vs live routing at the broker. */
  accountType: BrokerageAccountType;
}

/**
 * Provider-agnostic result of a broker credential validation round trip.
 *
 * Structural subset of the Alpaca `ValidatedCredentials` shape.
 */
export interface BrokerValidatedCredentials extends BrokerClientConfig {
  /** Broker-side account id. */
  accountId: string;
  /** Broker-side account number. */
  accountNumber: string;
  /** True when the credentials authenticated successfully. */
  isValid: boolean;
}

/**
 * Minimal provider-agnostic trading-client contract.
 *
 * This is exactly the surface the existing `AlpacaClient` already satisfies
 * (structurally) — rate-limited execution, paper/live introspection, config
 * access, and credential validation. Engine-side broker adapters should
 * depend on this interface rather than on `AlpacaClient` directly so IBKR /
 * COINBASE clients can slot in without call-site changes.
 */
export interface BrokerTradingClient {
  /**
   * Execute a broker SDK operation with rate limiting and retry.
   *
   * @param operation - Async function that calls the broker SDK
   * @param label - Human-readable label for logging
   * @returns Result of the operation
   */
  executeWithRateLimit<T>(
    operation: () => Promise<T>,
    label: string,
  ): Promise<T>;
  /** Check if the client is in paper-trading mode. */
  isPaper(): boolean;
  /** Get the client's configuration. */
  getConfig(): BrokerClientConfig;
  /** Validate credentials by fetching account info from the broker. */
  validateCredentials(): Promise<BrokerValidatedCredentials>;
}

/**
 * Create (or reuse from cache) a broker trading client for the given
 * credentials.
 *
 * ALPACA delegates to `createAlpacaClient`, whose connection-pool cache key
 * is provider-scoped (`ALPACA-<apiKey>-<accountType>`), so a future
 * provider reusing an identical apiKey string can never collide with an
 * Alpaca client. All other providers — including unknown provider strings
 * from untyped callers — throw {@link UnsupportedBrokerError}.
 *
 * @param credentials - Discriminated broker credentials union
 * @returns A provider-appropriate {@link BrokerTradingClient}
 * @throws UnsupportedBrokerError for any provider other than ALPACA
 */
export function createBrokerClient(
  credentials: BrokerCredentials,
): BrokerTradingClient {
  switch (credentials.provider) {
    case "ALPACA":
      return createAlpacaClient({
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        accountType: credentials.type,
      });
    case "IBKR":
    case "COINBASE":
      throw new UnsupportedBrokerError(credentials.provider);
  }

  // Unreachable for typed callers (the switch above is exhaustive), but
  // untyped runtime callers may pass an unrecognised provider string —
  // fail fast with the same typed error rather than undefined behaviour.
  throw new UnsupportedBrokerError(
    String((credentials as { provider?: unknown }).provider),
  );
}
