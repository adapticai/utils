/**
 * Multi-broker foundation types
 *
 * Provider-agnostic brokerage types for the org → fund → brokerageAccount →
 * broker alignment (SP2). These are strictly ADDITIVE: the existing
 * Alpaca-specific types (`AlpacaAuth`, `AlpacaCredentials`,
 * `AlpacaClientConfig`) remain the canonical shapes consumed by the engine
 * and are unchanged. New provider-aware call sites should prefer these
 * types; only ALPACA is implemented today — IBKR and COINBASE arms are
 * typed placeholders that resolve to `UnsupportedBrokerError` at runtime.
 *
 * @module @adaptic/utils/types/broker-types
 */

/**
 * Supported brokerage providers.
 *
 * Mirrors the backend-legacy `BrokerageProvider` enum (SP2 schema).
 * Only `ALPACA` has a working integration; `IBKR` and `COINBASE` are
 * reserved identifiers so that discriminated unions and persistence layers
 * can be built ahead of their implementations.
 */
export type BrokerageProvider = "ALPACA" | "IBKR" | "COINBASE";

/**
 * Brokerage account trading mode.
 *
 * Mirrors the backend-legacy `BrokerageAccountType` enum (SP2 schema) and is
 * value-compatible with the existing Alpaca `type` field (`"PAPER" | "LIVE"`).
 */
export type BrokerageAccountType = "PAPER" | "LIVE";

/**
 * Credentials for an Alpaca brokerage account.
 *
 * The only implemented arm of {@link BrokerCredentials}. Field values map
 * 1:1 onto the existing `AlpacaClientConfig` (`apiKey`, `apiSecret`,
 * `accountType`) consumed by `createAlpacaClient`.
 */
export interface AlpacaBrokerCredentials {
  /** Discriminant: Alpaca Markets. */
  provider: "ALPACA";
  /** Alpaca API key ID (APCA-API-KEY-ID). */
  apiKey: string;
  /** Alpaca API secret key (APCA-API-SECRET-KEY). */
  apiSecret: string;
  /** Trading mode — selects the paper vs live Alpaca host. */
  type: BrokerageAccountType;
}

/**
 * Credentials for an Interactive Brokers account.
 *
 * Typed placeholder — NOT implemented. Passing this arm to any runtime
 * factory (e.g. `createBrokerClient`) throws {@link UnsupportedBrokerError}.
 */
export interface IbkrBrokerCredentials {
  /** Discriminant: Interactive Brokers. */
  provider: "IBKR";
  /** IBKR account identifier (e.g. U1234567). */
  accountId: string;
  /** Trading mode — paper vs live IBKR session. */
  type: BrokerageAccountType;
}

/**
 * Credentials for a Coinbase account.
 *
 * Typed placeholder — NOT implemented. Passing this arm to any runtime
 * factory (e.g. `createBrokerClient`) throws {@link UnsupportedBrokerError}.
 */
export interface CoinbaseBrokerCredentials {
  /** Discriminant: Coinbase. */
  provider: "COINBASE";
  /** Coinbase API key. */
  apiKey: string;
  /** Coinbase API secret. */
  apiSecret: string;
  /** Trading mode — sandbox (PAPER) vs production (LIVE). */
  type: BrokerageAccountType;
}

/**
 * Discriminated union of per-provider brokerage credentials, keyed on
 * `provider`. Narrow with a `switch (credentials.provider)` — the compiler
 * enforces exhaustiveness when new providers are added.
 */
export type BrokerCredentials =
  | AlpacaBrokerCredentials
  | IbkrBrokerCredentials
  | CoinbaseBrokerCredentials;

/**
 * Provider-agnostic authentication input for broker operations.
 *
 * The multi-broker analogue of the legacy `AlpacaAuth` shape: callers supply
 * EITHER a `brokerageAccountId` (backend-resolved credentials) OR inline
 * `credentials`, optionally asserting the expected `provider`. Resolution
 * precedence matches `validateAuth`: inline credentials are preferred and
 * the backend lookup is the fallback.
 */
export interface BrokerAuth {
  /**
   * Backend brokerage-account id used to resolve credentials via
   * backend-legacy. During SP2 transition this is the `AlpacaAccount.id`
   * (backfilled 1:1 as `BrokerageAccount.id`).
   */
  brokerageAccountId?: string;
  /** Expected provider; a mismatch with resolved credentials must throw. */
  provider?: BrokerageProvider;
  /** Inline credentials — used with precedence over the backend lookup. */
  credentials?: BrokerCredentials;
}

/**
 * Type guard narrowing {@link BrokerCredentials} to the implemented
 * ALPACA arm.
 *
 * @param credentials - Any broker credentials union member
 * @returns True when the credentials belong to the ALPACA provider
 */
export function isAlpacaBrokerCredentials(
  credentials: BrokerCredentials,
): credentials is AlpacaBrokerCredentials {
  return credentials.provider === "ALPACA";
}
