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
  apiKey: string;
  apiSecret: string;
  type: string;
}

/**
 * Resolves AlpacaAuth into validated API credentials.
 * Supports authentication via adapticAccountId or direct API key/secret.
 * @param auth - The authentication details for Alpaca
 * @returns Validated authentication credentials
 * @throws Error if authentication details are missing or invalid
 */
export async function validateAuth(auth: AlpacaAuth): Promise<ValidatedAuth> {
  if (auth.adapticAccountId) {
    const client = await getSharedApolloClient();

    const brokerageAccount = (await adaptic.brokerageAccount.get(
      {
        id: auth.adapticAccountId,
      } as types.BrokerageAccount,
      client,
    )) as types.BrokerageAccount;

    if (!brokerageAccount || !brokerageAccount.apiKey || !brokerageAccount.apiSecret) {
      throw new Error("Alpaca account not found or incomplete");
    }

    validateAlpacaCredentials({
      apiKey: brokerageAccount.apiKey,
      apiSecret: brokerageAccount.apiSecret,
      isPaper: brokerageAccount.type === "PAPER",
    });

    return {
      apiKey: brokerageAccount.apiKey,
      apiSecret: brokerageAccount.apiSecret,
      type: brokerageAccount.type,
    };
  } else if (auth.alpacaApiKey && auth.alpacaApiSecret) {
    const accountType = auth.type || "PAPER";

    validateAlpacaCredentials({
      apiKey: auth.alpacaApiKey,
      apiSecret: auth.alpacaApiSecret,
      isPaper: accountType === "PAPER",
    });

    return {
      apiKey: auth.alpacaApiKey,
      apiSecret: auth.alpacaApiSecret,
      type: accountType,
    };
  }

  throw new Error(
    "Either adapticAccountId or both alpacaApiKey and alpacaApiSecret must be provided",
  );
}
