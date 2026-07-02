/**
 * Legacy Alpaca Authentication
 * Validates and resolves AlpacaAuth credentials for API calls.
 */
import { types } from "@adaptic/backend-legacy";
import adaptic from "@adaptic/backend-legacy";
import { getSharedApolloClient } from "../../adaptic";
import { UnsupportedBrokerError } from "../../errors";
import { AlpacaAuth } from "../../types/alpaca-types";
import { BrokerageProvider } from "../../types/broker-types";
import { validateAlpacaCredentials } from "../../utils/auth-validator";

/**
 * Validated authentication credentials ready for API calls.
 */
export interface ValidatedAuth {
  APIKey: string;
  APISecret: string;
  type: string;
}

/**
 * Resolves AlpacaAuth into validated API credentials.
 *
 * Credential precedence (broker connectivity must never depend on the CRUD
 * backend when the caller already holds valid broker credentials):
 *
 * 1. **Inline credentials** — when BOTH `alpacaApiKey` and `alpacaApiSecret`
 *    are present and non-empty AND the account `type` is known (either
 *    `auth.type` is set, or there is no `adapticAccountId` to resolve it
 *    from, in which case `type` defaults to `"PAPER"`), the inline values
 *    are used directly with NO backend round trip. This keeps broker
 *    exits/cancels possible when backend-legacy is degraded and removes
 *    the per-call GraphQL credential refetch from the exit path.
 * 2. **adapticAccountId lookup** — used only when inline credentials are
 *    absent/empty, or when inline credentials lack an explicit `type` and
 *    an `adapticAccountId` is available to resolve the authoritative
 *    PAPER/LIVE type (a wrong type would route requests to the wrong
 *    Alpaca host). The lookup is a no-cache GraphQL round trip to
 *    backend-legacy via `adaptic.alpacaAccount.get`.
 *
 * @param auth - The authentication details for Alpaca
 * @returns Validated authentication credentials
 * @throws UnsupportedBrokerError if `auth.provider` is set to a non-ALPACA provider
 * @throws Error if authentication details are missing or invalid
 */
export async function validateAuth(auth: AlpacaAuth): Promise<ValidatedAuth> {
  // Multi-broker guard (SP2): this seam only resolves Alpaca credentials.
  // `auth.provider` is typed as "ALPACA" on AlpacaAuth, but untyped callers
  // (or future BrokerAuth adapters) may pass other providers at runtime —
  // fail fast with a typed error instead of silently hitting Alpaca hosts.
  const requestedProvider: BrokerageProvider | undefined = auth.provider;
  if (requestedProvider !== undefined && requestedProvider !== "ALPACA") {
    throw new UnsupportedBrokerError(requestedProvider);
  }

  const inlineKey =
    auth.alpacaApiKey && auth.alpacaApiKey.trim().length > 0
      ? auth.alpacaApiKey
      : undefined;
  const inlineSecret =
    auth.alpacaApiSecret && auth.alpacaApiSecret.trim().length > 0
      ? auth.alpacaApiSecret
      : undefined;

  // Prefer inline credentials whenever the account type is unambiguous:
  // either the caller supplied it, or there is no adapticAccountId to
  // resolve the authoritative type from anyway.
  if (inlineKey && inlineSecret && (auth.type || !auth.adapticAccountId)) {
    const accountType = auth.type || "PAPER";

    validateAlpacaCredentials({
      apiKey: inlineKey,
      apiSecret: inlineSecret,
      isPaper: accountType === "PAPER",
    });

    return {
      APIKey: inlineKey,
      APISecret: inlineSecret,
      type: accountType,
    };
  }

  if (auth.adapticAccountId) {
    return resolveBrokerCredentials(auth.adapticAccountId);
  }

  throw new Error(
    "Either adapticAccountId or both alpacaApiKey and alpacaApiSecret must be provided",
  );
}

/**
 * Resolves broker credentials for a backend brokerage-account id.
 *
 * This is the SINGLE backend-coupled credential lookup in this package —
 * every account-id-based credential resolution must flow through here so
 * that backend model changes touch exactly one function.
 *
 * SP2 transition note: today the id is an `AlpacaAccount.id` resolved via
 * `adaptic.alpacaAccount.get`. When backend-legacy publishes the
 * `BrokerageAccount` model (backfilled with `id = AlpacaAccount.id`, so the
 * id space is identical), the switch to `adaptic.brokerageAccount.get`
 * happens INSIDE this function only, following the sequencing rule in
 * CLAUDE.md ("Multi-Broker Sequencing Rule"): backend-legacy publishes →
 * utils bumps the dependency and switches this helper → utils publishes →
 * engine bumps its pin. Do not reference `brokerageAccount` anywhere in
 * this package before the pinned backend-legacy version exports it.
 *
 * The lookup is a no-cache GraphQL round trip to backend-legacy; callers
 * holding inline credentials should never reach it (see `validateAuth`
 * precedence).
 *
 * @param brokerageAccountId - Backend brokerage-account id (currently the AlpacaAccount id)
 * @returns Validated authentication credentials
 * @throws Error if the account is not found or its credentials are incomplete
 */
export async function resolveBrokerCredentials(
  brokerageAccountId: string,
): Promise<ValidatedAuth> {
  const client = await getSharedApolloClient();

  const alpacaAccount = (await adaptic.alpacaAccount.get(
    {
      id: brokerageAccountId,
    } as types.AlpacaAccount,
    client,
  )) as types.AlpacaAccount;

  if (!alpacaAccount || !alpacaAccount.APIKey || !alpacaAccount.APISecret) {
    throw new Error("Alpaca account not found or incomplete");
  }

  validateAlpacaCredentials({
    apiKey: alpacaAccount.APIKey,
    apiSecret: alpacaAccount.APISecret,
    isPaper: alpacaAccount.type === "PAPER",
  });

  return {
    APIKey: alpacaAccount.APIKey,
    APISecret: alpacaAccount.APISecret,
    type: alpacaAccount.type,
  };
}
