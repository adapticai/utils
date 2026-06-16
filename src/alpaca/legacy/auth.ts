/**
 * Legacy Alpaca Authentication
 * Validates and resolves AlpacaAuth credentials for API calls.
 */
import { types } from "@adaptic/backend-legacy";
import adaptic from "@adaptic/backend-legacy";
import { getSharedApolloClient } from "../../adaptic";
import { AlpacaAuth } from "../../types/alpaca-types";
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
 * @throws Error if authentication details are missing or invalid
 */
export async function validateAuth(auth: AlpacaAuth): Promise<ValidatedAuth> {
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
    const client = await getSharedApolloClient();

    const alpacaAccount = (await adaptic.alpacaAccount.get(
      {
        id: auth.adapticAccountId,
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

  throw new Error(
    "Either adapticAccountId or both alpacaApiKey and alpacaApiSecret must be provided",
  );
}
