/**
 * Legacy Alpaca Account Functions
 * Account details, portfolio history, and configuration management
 * using AlpacaAuth pattern with direct fetch calls.
 */
import { types } from '@adaptic/backend-legacy';
import adaptic from '@adaptic/backend-legacy';
import { getSharedApolloClient } from '../../adaptic';
import {
  AlpacaAccountDetails,
  AccountConfiguration,
  FetchAccountDetailsProps,
  FetchPortfolioHistoryProps,
  PortfolioHistoryResponse,
  AlpacaAccountWithAllocation,
} from '../../types/alpaca-types';
import { validateAuth } from './auth';
import { getTradingApiUrl } from '../../config/api-endpoints';
import { getLogger } from '../../logger';
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from '../../http-timeout';

/**
 * Fetches account details from Alpaca API.
 * @param props - The properties for fetching account details
 * @returns The account details
 */
export async function fetchAccountDetails({ accountId, client, alpacaAccount, auth }: FetchAccountDetailsProps): Promise<AlpacaAccountDetails> {
  let alpacaAccountObj = alpacaAccount ? alpacaAccount : null;

  if (!alpacaAccountObj && auth) {
    const validatedAuth = await validateAuth(auth);
    alpacaAccountObj = {
      APIKey: validatedAuth.APIKey,
      APISecret: validatedAuth.APISecret,
      type: validatedAuth.type,
    } as types.AlpacaAccount;
  }

  if (!alpacaAccountObj) {
    try {
      const apolloClient = client || await getSharedApolloClient();

      alpacaAccountObj = (await adaptic.alpacaAccount.get({
        id: accountId,
      } as types.AlpacaAccount, apolloClient)) as types.AlpacaAccount;
    } catch (error) {
      getLogger().error('[fetchAccountDetails] Error fetching Alpaca account:', error);
      throw error;
    }
  }

  if (!alpacaAccountObj || !alpacaAccountObj.APIKey || !alpacaAccountObj.APISecret) {
    throw new Error('[fetchAccountDetails] Alpaca account not found or incomplete');
  }

  const { APIKey, APISecret, type } = alpacaAccountObj;
  const apiUrl = `${getTradingApiUrl(type as 'PAPER' | 'LIVE')}/account`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch account details: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    getLogger().error('Error in fetchAccountDetails:', error);
    throw error;
  }
}

/**
 * Fetches portfolio history for one Alpaca account, as stored in Adaptic backend.
 * @param props - The properties for fetching portfolio history
 * @returns The portfolio history
 */
export async function fetchPortfolioHistory(
  { params, accountId, client, alpacaAccount }: FetchPortfolioHistoryProps
): Promise<PortfolioHistoryResponse> {
  let alpacaAccountObj = alpacaAccount ? alpacaAccount : null;

  if (!alpacaAccountObj) {
    try {
      const apolloClient = client || await getSharedApolloClient();

      alpacaAccountObj = (await adaptic.alpacaAccount.get({
        id: accountId,
      } as types.AlpacaAccount, apolloClient)) as types.AlpacaAccount;
    } catch (error) {
      getLogger().error('[fetchPortfolioHistory] Error fetching Alpaca account:', error);
      throw error;
    }
  }

  if (!alpacaAccountObj || !alpacaAccountObj.APIKey || !alpacaAccountObj.APISecret) {
    throw new Error('[fetchPortfolioHistory] Alpaca account not found or incomplete');
  }

  const { APIKey, APISecret, type } = alpacaAccountObj;
  const apiBaseUrl = getTradingApiUrl(type as 'PAPER' | 'LIVE');
  const apiUrl = `${apiBaseUrl}/v2/account/portfolio/history`;

  const { start, end, period } = params;

  // Validate date formats
  if (start) {
    params.start = new Date(start).toISOString();
    if (period) {
      delete params.period;
    }
  }
  if (end) {
    params.end = new Date(end).toISOString();
  }

  if (period === 'YTD') {
    params.period = '1A';
  }

  // Remove undefined parameters
  Object.keys(params).forEach(
    (key) => params[key as keyof typeof params] === undefined && delete params[key as keyof typeof params]
  );

  const queryString = new URLSearchParams(params as Record<string, string>).toString();
  const fullUrl = `${apiUrl}?${queryString}`;

  try {
    const response = await fetch(fullUrl, {
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
      throw new Error(`Failed to fetch portfolio history: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    getLogger().error('[fetchPortfolioHistory] Error fetching portfolio history call to Alpaca:', error);
    throw error;
  }
}

/**
 * Retrieves the configuration for a specific Alpaca account.
 * @param account - The Alpaca account to retrieve the configuration for
 * @returns The account configuration
 */
export async function getConfiguration(account: types.AlpacaAccount): Promise<AccountConfiguration> {
  try {
    if (!account) {
      throw new Error(`Account is missing.`);
    }

    const { APIKey, APISecret } = account;
    if (!APIKey || !APISecret) {
      throw new Error('User APIKey or APISecret is missing.');
    }

    const apiUrl = getTradingApiUrl(account.type as 'PAPER' | 'LIVE');
    const client = await getSharedApolloClient();

    const [alpacaResponse, freshAlpacaAccount] = await Promise.all([
      fetch(`${apiUrl}/account/configurations`, {
        method: 'GET',
        headers: {
          'APCA-API-KEY-ID': APIKey,
          'APCA-API-SECRET-KEY': APISecret,
          accept: 'application/json',
        },
      }),
      adaptic.alpacaAccount.get({ id: account.id } as types.AlpacaAccount, client) as Promise<types.AlpacaAccount>,
    ]);

    if (!alpacaResponse.ok) {
      throw new Error(`Failed to fetch account configuration: ${alpacaResponse.statusText}`);
    }
    if (!freshAlpacaAccount) {
      throw new Error('Failed to get Alpaca Account from @adaptic/backend-legacy.');
    }

    const dataFromAlpaca = (await alpacaResponse.json()) as AccountConfiguration;

    const accountWithAllocation = freshAlpacaAccount as types.AlpacaAccount & AlpacaAccountWithAllocation;
    const allocationData = accountWithAllocation.allocation || {
      stocks: 70,
      options: 0,
      futures: 0,
      etfs: 10,
      forex: 0,
      crypto: 20
    };

    const combinedConfig: AccountConfiguration = {
      ...dataFromAlpaca,
      marketOpen: freshAlpacaAccount.marketOpen,
      realTime: freshAlpacaAccount.realTime,
      tradeAllocationPct: freshAlpacaAccount.tradeAllocationPct,
      minPercentageChange: freshAlpacaAccount.minPercentageChange,
      volumeThreshold: freshAlpacaAccount.volumeThreshold,

      cryptoTradingEnabled: freshAlpacaAccount.cryptoTradingEnabled ?? false,
      cryptoTradingPairs: freshAlpacaAccount.cryptoTradingPairs ?? [],
      cryptoTradeAllocationPct: freshAlpacaAccount.cryptoTradeAllocationPct ?? 5.0,
      autoAllocation: accountWithAllocation.autoAllocation ?? false,
      allocation: allocationData,

      enablePortfolioTrailingStop: freshAlpacaAccount.enablePortfolioTrailingStop,
      portfolioTrailPercent: freshAlpacaAccount.portfolioTrailPercent,
      portfolioProfitThresholdPercent: freshAlpacaAccount.portfolioProfitThresholdPercent,
      reducedPortfolioTrailPercent: freshAlpacaAccount.reducedPortfolioTrailPercent,

      defaultTrailingStopPercentage100: freshAlpacaAccount.defaultTrailingStopPercentage100 ?? 4.0,
      firstTrailReductionThreshold100: freshAlpacaAccount.firstTrailReductionThreshold100 ?? 2.0,
      secondTrailReductionThreshold100: freshAlpacaAccount.secondTrailReductionThreshold100 ?? 5.0,
      firstReducedTrailPercentage100: freshAlpacaAccount.firstReducedTrailPercentage100 ?? 1.0,
      secondReducedTrailPercentage100: freshAlpacaAccount.secondReducedTrailPercentage100 ?? 0.5,
      minimumPriceChangePercent100: freshAlpacaAccount.minimumPriceChangePercent100 ?? 0.5,
    };

    return combinedConfig;
  } catch (error) {
    getLogger().error('Error in getConfiguration:', error);
    throw error;
  }
}

/**
 * Updates the configuration for a specific Alpaca account.
 * @param user - The user making the update
 * @param account - The Alpaca account to update
 * @param updatedConfig - The updated configuration
 * @returns The updated account configuration
 */
export async function updateConfiguration(
  user: types.User,
  account: types.AlpacaAccount,
  updatedConfig: AccountConfiguration
): Promise<AccountConfiguration> {
  try {
    if (!account) {
      throw new Error(`Account is missing.`);
    }

    const { APIKey, APISecret } = account;
    if (!APIKey || !APISecret) {
      throw new Error('User APIKey or APISecret is missing.');
    }

    const apiUrl = getTradingApiUrl(account.type as 'PAPER' | 'LIVE');

    // Prepare the config object for Alpaca by removing DB-only fields
    const configForAlpaca = { ...updatedConfig };

    delete configForAlpaca.marketOpen;
    delete configForAlpaca.realTime;
    delete configForAlpaca.tradeAllocationPct;
    delete configForAlpaca.minPercentageChange;
    delete configForAlpaca.volumeThreshold;

    delete configForAlpaca.cryptoTradingEnabled;
    delete configForAlpaca.cryptoTradingPairs;
    delete configForAlpaca.cryptoTradeAllocationPct;
    delete configForAlpaca.autoAllocation;
    delete configForAlpaca.allocation;

    delete configForAlpaca.enablePortfolioTrailingStop;
    delete configForAlpaca.portfolioTrailPercent;
    delete configForAlpaca.portfolioProfitThresholdPercent;
    delete configForAlpaca.reducedPortfolioTrailPercent;

    delete configForAlpaca.defaultTrailingStopPercentage100;
    delete configForAlpaca.firstTrailReductionThreshold100;
    delete configForAlpaca.secondTrailReductionThreshold100;
    delete configForAlpaca.firstReducedTrailPercentage100;
    delete configForAlpaca.secondReducedTrailPercentage100;
    delete configForAlpaca.minimumPriceChangePercent100;

    const alpacaUpdatePromise = fetch(`${apiUrl}/account/configurations`, {
      method: 'PATCH',
      headers: {
        'APCA-API-KEY-ID': APIKey,
        'APCA-API-SECRET-KEY': APISecret,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(configForAlpaca),
    });

    const client = await getSharedApolloClient();

    let allocUpdatePromise: Promise<types.Allocation | null> = Promise.resolve(null);
    if (updatedConfig.allocation) {
      const totalAllocation =
        (updatedConfig.allocation.stocks ?? 0) +
        (updatedConfig.allocation.options ?? 0) +
        (updatedConfig.allocation.futures ?? 0) +
        (updatedConfig.allocation.etfs ?? 0) +
        (updatedConfig.allocation.forex ?? 0) +
        (updatedConfig.allocation.crypto ?? 0);

      if (Math.abs(totalAllocation - 100) > 0.01) {
        throw new Error(`Allocation percentages must sum to 100%. Current total: ${totalAllocation}%`);
      }

      if (account.allocation) {
        allocUpdatePromise = adaptic.allocation.update({
          id: account.allocation.id,
          alpacaAccount: {
            id: account.id,
          },
          alpacaAccountId: account.id,
          stocks: updatedConfig.allocation.stocks ?? 0,
          options: updatedConfig.allocation.options ?? 0,
          futures: updatedConfig.allocation.futures ?? 0,
          etfs: updatedConfig.allocation.etfs ?? 0,
          forex: updatedConfig.allocation.forex ?? 0,
          crypto: updatedConfig.allocation.crypto ?? 0,
        }, client);
      } else {
        allocUpdatePromise = adaptic.allocation.create({
          stocks: updatedConfig.allocation.stocks ?? 0,
          options: updatedConfig.allocation.options ?? 0,
          futures: updatedConfig.allocation.futures ?? 0,
          etfs: updatedConfig.allocation.etfs ?? 0,
          forex: updatedConfig.allocation.forex ?? 0,
          crypto: updatedConfig.allocation.crypto ?? 0,
          alpacaAccount: {
            id: account.id,
          },
          alpacaAccountId: account.id
        }, client);
      }
    }

    const adapticUpdatePromise = adaptic.alpacaAccount.update({
      id: account.id,
      user: {
        id: user.id,
        name: user?.name,
      },
      configuration: updatedConfig,
      marketOpen: updatedConfig.marketOpen,
      realTime: updatedConfig.realTime,
      tradeAllocationPct: updatedConfig.tradeAllocationPct,
      minPercentageChange: updatedConfig.minPercentageChange,
      volumeThreshold: updatedConfig.volumeThreshold,

      cryptoTradingEnabled: updatedConfig.cryptoTradingEnabled,
      cryptoTradingPairs: updatedConfig.cryptoTradingPairs,
      cryptoTradeAllocationPct: updatedConfig.cryptoTradeAllocationPct,
      autoAllocation: updatedConfig.autoAllocation,

      enablePortfolioTrailingStop: updatedConfig.enablePortfolioTrailingStop,
      portfolioTrailPercent: updatedConfig.portfolioTrailPercent,
      portfolioProfitThresholdPercent: updatedConfig.portfolioProfitThresholdPercent,
      reducedPortfolioTrailPercent: updatedConfig.reducedPortfolioTrailPercent,

      defaultTrailingStopPercentage100: updatedConfig.defaultTrailingStopPercentage100,
      firstTrailReductionThreshold100: updatedConfig.firstTrailReductionThreshold100,
      secondTrailReductionThreshold100: updatedConfig.secondTrailReductionThreshold100,
      firstReducedTrailPercentage100: updatedConfig.firstReducedTrailPercentage100,
      secondReducedTrailPercentage100: updatedConfig.secondReducedTrailPercentage100,
      minimumPriceChangePercent100: updatedConfig.minimumPriceChangePercent100,
    }, client);

    const [alpacaResponse, updatedAlpacaAccount, updatedAllocation] = await Promise.all([
      alpacaUpdatePromise,
      adapticUpdatePromise,
      allocUpdatePromise
    ]);

    getLogger().info('=== PROMISE.ALL RESULTS ===');
    getLogger().info('updatedAllocation from Promise.all:', updatedAllocation);
    getLogger().info('updatedAllocation fields:', {
      stocks: updatedAllocation?.stocks,
      options: updatedAllocation?.options,
      futures: updatedAllocation?.futures,
      etfs: updatedAllocation?.etfs,
      forex: updatedAllocation?.forex,
      crypto: updatedAllocation?.crypto,
    });

    if (!alpacaResponse.ok) {
      getLogger().error('Failed to update account configuration at Alpaca:', alpacaResponse.statusText);
      throw new Error(`Failed to update account config at Alpaca: ${alpacaResponse.statusText}`);
    }

    const alpacaData = (await alpacaResponse.json()) as AccountConfiguration;
    if (!updatedAlpacaAccount) {
      throw new Error('Failed to update Alpaca Account in @adaptic/backend-legacy.');
    }

    const updatedAccountWithAllocation = updatedAlpacaAccount as types.AlpacaAccount & AlpacaAccountWithAllocation;
    const selectedAllocation = updatedConfig.allocation || updatedAllocation || updatedAccountWithAllocation.allocation;

    getLogger().info('=== ALLOCATION DEBUG (will be removed after fix verified) ===');
    getLogger().info('Using updatedConfig.allocation (validated input):', updatedConfig.allocation);
    getLogger().info('Ignoring potentially stale updatedAllocation:', updatedAllocation);
    getLogger().info('Final allocation:', selectedAllocation);

    const finalConfig: AccountConfiguration = {
      ...alpacaData,
      marketOpen: updatedAlpacaAccount.marketOpen,
      realTime: updatedAlpacaAccount.realTime,
      tradeAllocationPct: updatedAlpacaAccount.tradeAllocationPct,
      minPercentageChange: updatedAlpacaAccount.minPercentageChange,
      volumeThreshold: updatedAlpacaAccount.volumeThreshold,

      cryptoTradingEnabled: updatedAlpacaAccount.cryptoTradingEnabled,
      cryptoTradingPairs: updatedAlpacaAccount.cryptoTradingPairs,
      cryptoTradeAllocationPct: updatedAlpacaAccount.cryptoTradeAllocationPct,
      autoAllocation: updatedAccountWithAllocation.autoAllocation,
      allocation: selectedAllocation,

      enablePortfolioTrailingStop: updatedAlpacaAccount.enablePortfolioTrailingStop,
      portfolioTrailPercent: updatedAlpacaAccount.portfolioTrailPercent,
      portfolioProfitThresholdPercent: updatedAlpacaAccount.portfolioProfitThresholdPercent,
      reducedPortfolioTrailPercent: updatedAlpacaAccount.reducedPortfolioTrailPercent,

      defaultTrailingStopPercentage100: updatedAlpacaAccount.defaultTrailingStopPercentage100,
      firstTrailReductionThreshold100: updatedAlpacaAccount.firstTrailReductionThreshold100,
      secondTrailReductionThreshold100: updatedAlpacaAccount.secondTrailReductionThreshold100,
      firstReducedTrailPercentage100: updatedAlpacaAccount.firstReducedTrailPercentage100,
      secondReducedTrailPercentage100: updatedAlpacaAccount.secondReducedTrailPercentage100,
      minimumPriceChangePercent100: updatedAlpacaAccount.minimumPriceChangePercent100,
    };

    return finalConfig;
  } catch (error) {
    getLogger().error('Error in updateConfiguration:', error);
    throw error;
  }
}
