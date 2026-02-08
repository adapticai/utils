/**
 * Legacy Alpaca Authentication
 * Validates and resolves AlpacaAuth credentials for API calls.
 */
import { types } from '@adaptic/backend-legacy';
import adaptic from '@adaptic/backend-legacy';
import { getSharedApolloClient } from '../../adaptic';
import { AlpacaAuth } from '../../types/alpaca-types';
import { validateAlpacaCredentials } from '../../utils/auth-validator';

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
 * Supports authentication via adapticAccountId or direct API key/secret.
 * @param auth - The authentication details for Alpaca
 * @returns Validated authentication credentials
 * @throws Error if authentication details are missing or invalid
 */
export async function validateAuth(auth: AlpacaAuth): Promise<ValidatedAuth> {
  if (auth.adapticAccountId) {
    const client = await getSharedApolloClient();

    const alpacaAccount = (await adaptic.alpacaAccount.get({
      id: auth.adapticAccountId,
    } as types.AlpacaAccount, client)) as types.AlpacaAccount;

    if (!alpacaAccount || !alpacaAccount.APIKey || !alpacaAccount.APISecret) {
      throw new Error('Alpaca account not found or incomplete');
    }

    validateAlpacaCredentials({
      apiKey: alpacaAccount.APIKey,
      apiSecret: alpacaAccount.APISecret,
      isPaper: alpacaAccount.type === 'PAPER',
    });

    return {
      APIKey: alpacaAccount.APIKey,
      APISecret: alpacaAccount.APISecret,
      type: alpacaAccount.type,
    };
  } else if (auth.alpacaApiKey && auth.alpacaApiSecret) {
    const accountType = auth.type || 'PAPER';

    validateAlpacaCredentials({
      apiKey: auth.alpacaApiKey,
      apiSecret: auth.alpacaApiSecret,
      isPaper: accountType === 'PAPER',
    });

    return {
      APIKey: auth.alpacaApiKey,
      APISecret: auth.alpacaApiSecret,
      type: accountType,
    };
  }

  throw new Error('Either adapticAccountId or both alpacaApiKey and alpacaApiSecret must be provided');
}
