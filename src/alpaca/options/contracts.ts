/**
 * Options Contracts Module
 * Query and analyze option contracts
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';
import {
  OptionContract,
  OptionType,
  GetOptionContractsParams,
  OptionContractsResponse,
} from '../../types/alpaca-types';

const LOG_SOURCE = 'OptionsContracts';

/**
 * Internal logging helper with consistent source
 */
const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: LOG_SOURCE });
};

// ============================================================================
// Types
// ============================================================================

/**
 * Parameters for getting option chain
 */
export interface GetOptionChainParams {
  /** Filter by expiration date (YYYY-MM-DD format) */
  expirationDate?: string;
  /** Filter by strike price range */
  strikePrice?: {
    min?: number;
    max?: number;
  };
  /** Filter by option type (call or put) */
  type?: OptionType;
}

/**
 * ATM options result containing both call and put
 */
export interface ATMOptionsResult {
  /** ATM call option if found */
  call: OptionContract | null;
  /** ATM put option if found */
  put: OptionContract | null;
  /** The strike price used for ATM determination */
  strikePrice: number;
  /** Current underlying price used for determination */
  underlyingPrice: number;
}

/**
 * Options chain grouped by expiration and strike
 */
export interface GroupedOptionChain {
  /** The underlying symbol */
  underlying: string;
  /** Chain grouped by expiration date */
  byExpiration: {
    [expirationDate: string]: {
      /** Calls at each strike */
      calls: { [strike: string]: OptionContract };
      /** Puts at each strike */
      puts: { [strike: string]: OptionContract };
    };
  };
  /** All available expiration dates */
  expirations: string[];
  /** All available strike prices */
  strikes: number[];
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get option contracts for an underlying symbol with filters
 *
 * @param client - The AlpacaClient instance
 * @param params - Query parameters for filtering contracts
 * @returns Array of option contracts matching the criteria
 * @throws Error if API request fails
 *
 * @example
 * // Get all AAPL option contracts
 * const contracts = await getOptionContracts(client, {
 *   underlying_symbols: ['AAPL'],
 * });
 *
 * @example
 * // Get AAPL calls expiring in the next 30 days
 * const today = new Date();
 * const thirtyDaysOut = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
 * const contracts = await getOptionContracts(client, {
 *   underlying_symbols: ['AAPL'],
 *   type: 'call',
 *   expiration_date_gte: today.toISOString().split('T')[0],
 *   expiration_date_lte: thirtyDaysOut.toISOString().split('T')[0],
 * });
 */
export async function getOptionContracts(
  client: AlpacaClient,
  params: GetOptionContractsParams
): Promise<OptionContract[]> {
  const symbols = params.underlying_symbols.join(', ');
  log(`Fetching option contracts for: ${symbols}`, {
    type: 'debug',
    metadata: { params },
  });

  try {
    const allContracts: OptionContract[] = [];
    let pageToken: string | undefined;

    // Handle pagination
    do {
      const queryParts: string[] = [
        `underlying_symbols=${params.underlying_symbols.join(',')}`,
      ];

      if (params.expiration_date_gte) queryParts.push(`expiration_date_gte=${params.expiration_date_gte}`);
      if (params.expiration_date_lte) queryParts.push(`expiration_date_lte=${params.expiration_date_lte}`);
      if (params.strike_price_gte) queryParts.push(`strike_price_gte=${params.strike_price_gte}`);
      if (params.strike_price_lte) queryParts.push(`strike_price_lte=${params.strike_price_lte}`);
      if (params.type) queryParts.push(`type=${params.type}`);
      if (params.status) queryParts.push(`status=${params.status}`);
      if (params.limit) queryParts.push(`limit=${params.limit}`);
      if (pageToken) queryParts.push(`page_token=${pageToken}`);

      const endpoint = `/options/contracts?${queryParts.join('&')}`;
      const response = await client.makeRequest<OptionContractsResponse>(endpoint);

      if (response.option_contracts && Array.isArray(response.option_contracts)) {
        allContracts.push(...response.option_contracts);
      }

      pageToken = response.page_token;

      // Break if we have a limit and reached it
      if (params.limit && allContracts.length >= params.limit) {
        break;
      }
    } while (pageToken);

    log(`Retrieved ${allContracts.length} option contracts for ${symbols}`, {
      type: 'info',
      metadata: { count: allContracts.length },
    });

    return allContracts;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch option contracts for ${symbols}: ${errorMessage}`, {
      type: 'error',
      metadata: { params },
    });
    throw new Error(`Failed to fetch option contracts: ${errorMessage}`);
  }
}

/**
 * Get a specific option contract by symbol or ID
 *
 * @param client - The AlpacaClient instance
 * @param symbolOrId - Option contract symbol (e.g., AAPL230120C00150000) or contract ID
 * @returns The option contract details
 * @throws Error if contract not found or API request fails
 *
 * @example
 * // Get contract by OCC symbol
 * const contract = await getOptionContract(client, 'AAPL230120C00150000');
 *
 * @example
 * // Get contract by ID
 * const contract = await getOptionContract(client, 'contract-uuid-here');
 */
export async function getOptionContract(
  client: AlpacaClient,
  symbolOrId: string
): Promise<OptionContract> {
  log(`Fetching option contract: ${symbolOrId}`, { type: 'debug' });

  try {
    const endpoint = `/options/contracts/${encodeURIComponent(symbolOrId)}`;
    const contract = await client.makeRequest<OptionContract>(endpoint);

    log(`Retrieved option contract: ${contract.symbol}`, {
      type: 'info',
      symbol: contract.underlying_symbol,
      metadata: {
        type: contract.type,
        strike: contract.strike_price,
        expiration: contract.expiration_date,
      },
    });

    return contract;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      log(`Option contract not found: ${symbolOrId}`, { type: 'warn' });
      throw new Error(`Option contract not found: ${symbolOrId}`);
    }

    log(`Failed to fetch option contract ${symbolOrId}: ${errorMessage}`, { type: 'error' });
    throw new Error(`Failed to fetch option contract: ${errorMessage}`);
  }
}

/**
 * Get option chain for a symbol with optional filters
 *
 * @param client - The AlpacaClient instance
 * @param underlying - The underlying symbol (e.g., 'AAPL')
 * @param params - Optional filter parameters
 * @returns Array of option contracts in the chain
 *
 * @example
 * // Get full option chain for AAPL
 * const chain = await getOptionChain(client, 'AAPL');
 *
 * @example
 * // Get AAPL puts at specific strike range
 * const chain = await getOptionChain(client, 'AAPL', {
 *   type: 'put',
 *   strikePrice: { min: 140, max: 160 },
 * });
 */
export async function getOptionChain(
  client: AlpacaClient,
  underlying: string,
  params?: GetOptionChainParams
): Promise<OptionContract[]> {
  log(`Fetching option chain for ${underlying}`, {
    type: 'debug',
    symbol: underlying,
    metadata: { params },
  });

  const queryParams: GetOptionContractsParams = {
    underlying_symbols: [underlying],
    status: 'active',
  };

  // Apply filters
  if (params?.expirationDate) {
    queryParams.expiration_date_gte = params.expirationDate;
    queryParams.expiration_date_lte = params.expirationDate;
  }

  if (params?.strikePrice) {
    if (params.strikePrice.min !== undefined) {
      queryParams.strike_price_gte = String(params.strikePrice.min);
    }
    if (params.strikePrice.max !== undefined) {
      queryParams.strike_price_lte = String(params.strikePrice.max);
    }
  }

  if (params?.type) {
    queryParams.type = params.type;
  }

  const contracts = await getOptionContracts(client, queryParams);

  log(`Retrieved ${contracts.length} contracts in option chain for ${underlying}`, {
    type: 'info',
    symbol: underlying,
  });

  return contracts;
}

/**
 * Get available expiration dates for an underlying symbol
 *
 * @param client - The AlpacaClient instance
 * @param underlying - The underlying symbol (e.g., 'AAPL')
 * @returns Sorted array of expiration dates (YYYY-MM-DD format)
 *
 * @example
 * const expirations = await getExpirationDates(client, 'AAPL');
 * console.log(`Next expiration: ${expirations[0]}`);
 */
export async function getExpirationDates(
  client: AlpacaClient,
  underlying: string
): Promise<string[]> {
  log(`Fetching expiration dates for ${underlying}`, {
    type: 'debug',
    symbol: underlying,
  });

  try {
    // Get all active contracts for the underlying
    const contracts = await getOptionContracts(client, {
      underlying_symbols: [underlying],
      status: 'active',
    });

    // Extract unique expiration dates
    const expirationSet = new Set<string>();
    contracts.forEach((contract) => {
      expirationSet.add(contract.expiration_date);
    });

    // Sort dates chronologically
    const expirations = Array.from(expirationSet).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );

    log(`Found ${expirations.length} expiration dates for ${underlying}`, {
      type: 'info',
      symbol: underlying,
      metadata: { count: expirations.length, nearest: expirations[0] },
    });

    return expirations;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch expiration dates for ${underlying}: ${errorMessage}`, {
      type: 'error',
      symbol: underlying,
    });
    throw new Error(`Failed to fetch expiration dates: ${errorMessage}`);
  }
}

/**
 * Get available strike prices for an underlying at a specific expiration
 *
 * @param client - The AlpacaClient instance
 * @param underlying - The underlying symbol
 * @param expirationDate - The expiration date (YYYY-MM-DD format)
 * @returns Sorted array of available strike prices
 *
 * @example
 * const strikes = await getStrikePrices(client, 'AAPL', '2024-01-19');
 */
export async function getStrikePrices(
  client: AlpacaClient,
  underlying: string,
  expirationDate: string
): Promise<number[]> {
  log(`Fetching strike prices for ${underlying} expiring ${expirationDate}`, {
    type: 'debug',
    symbol: underlying,
  });

  try {
    const contracts = await getOptionChain(client, underlying, { expirationDate });

    // Extract unique strikes
    const strikeSet = new Set<number>();
    contracts.forEach((contract) => {
      const strike = parseFloat(contract.strike_price);
      if (!isNaN(strike)) {
        strikeSet.add(strike);
      }
    });

    // Sort strikes numerically
    const strikes = Array.from(strikeSet).sort((a, b) => a - b);

    log(`Found ${strikes.length} strike prices for ${underlying} at ${expirationDate}`, {
      type: 'info',
      symbol: underlying,
      metadata: { count: strikes.length },
    });

    return strikes;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch strike prices: ${errorMessage}`, {
      type: 'error',
      symbol: underlying,
    });
    throw new Error(`Failed to fetch strike prices: ${errorMessage}`);
  }
}

/**
 * Find ATM (at-the-money) options for an underlying
 * Returns both call and put options at the strike price closest to current price
 *
 * @param client - The AlpacaClient instance
 * @param underlying - The underlying symbol
 * @param expirationDate - The expiration date (YYYY-MM-DD format)
 * @param currentPrice - Current price of the underlying (required to determine ATM)
 * @param type - Optional filter to return only call or put
 * @returns ATM options result with call and/or put contracts
 *
 * @example
 * // Get both ATM call and put
 * const atm = await findATMOptions(client, 'AAPL', '2024-01-19', 175.50);
 * console.log(`ATM Call: ${atm.call?.symbol}`);
 * console.log(`ATM Put: ${atm.put?.symbol}`);
 *
 * @example
 * // Get only ATM call
 * const atm = await findATMOptions(client, 'AAPL', '2024-01-19', 175.50, 'call');
 */
export async function findATMOptions(
  client: AlpacaClient,
  underlying: string,
  expirationDate: string,
  currentPrice: number,
  type?: OptionType
): Promise<ATMOptionsResult> {
  log(`Finding ATM options for ${underlying} at $${currentPrice.toFixed(2)}`, {
    type: 'debug',
    symbol: underlying,
    metadata: { expirationDate, currentPrice, type },
  });

  try {
    // Get option chain for the expiration
    const contracts = await getOptionChain(client, underlying, {
      expirationDate,
      type,
    });

    if (contracts.length === 0) {
      log(`No contracts found for ${underlying} at ${expirationDate}`, {
        type: 'warn',
        symbol: underlying,
      });
      return {
        call: null,
        put: null,
        strikePrice: currentPrice,
        underlyingPrice: currentPrice,
      };
    }

    // Find the strike price closest to current price
    const strikes = new Set<number>();
    contracts.forEach((c) => {
      const strike = parseFloat(c.strike_price);
      if (!isNaN(strike)) {
        strikes.add(strike);
      }
    });

    const sortedStrikes = Array.from(strikes).sort((a, b) => a - b);
    let atmStrike = sortedStrikes[0];
    let minDiff = Math.abs(sortedStrikes[0] - currentPrice);

    for (const strike of sortedStrikes) {
      const diff = Math.abs(strike - currentPrice);
      if (diff < minDiff) {
        minDiff = diff;
        atmStrike = strike;
      }
    }

    // Find call and put at ATM strike
    let call: OptionContract | null = null;
    let put: OptionContract | null = null;

    for (const contract of contracts) {
      const strike = parseFloat(contract.strike_price);
      if (strike === atmStrike) {
        if (contract.type === 'call') {
          call = contract;
        } else if (contract.type === 'put') {
          put = contract;
        }
      }
    }

    log(`Found ATM options at strike $${atmStrike.toFixed(2)}`, {
      type: 'info',
      symbol: underlying,
      metadata: {
        atmStrike,
        hasCall: !!call,
        hasPut: !!put,
        priceDiff: (atmStrike - currentPrice).toFixed(2),
      },
    });

    return {
      call,
      put,
      strikePrice: atmStrike,
      underlyingPrice: currentPrice,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to find ATM options for ${underlying}: ${errorMessage}`, {
      type: 'error',
      symbol: underlying,
    });
    throw new Error(`Failed to find ATM options: ${errorMessage}`);
  }
}

/**
 * Get grouped option chain organized by expiration and strike
 *
 * @param client - The AlpacaClient instance
 * @param underlying - The underlying symbol
 * @param expirationDates - Optional array of expiration dates to include
 * @returns Grouped option chain structure
 *
 * @example
 * const chain = await getGroupedOptionChain(client, 'AAPL');
 * // Access calls at specific expiration and strike
 * const call = chain.byExpiration['2024-01-19'].calls['175'];
 */
export async function getGroupedOptionChain(
  client: AlpacaClient,
  underlying: string,
  expirationDates?: string[]
): Promise<GroupedOptionChain> {
  log(`Fetching grouped option chain for ${underlying}`, {
    type: 'debug',
    symbol: underlying,
  });

  try {
    // Get all active contracts
    const contracts = await getOptionContracts(client, {
      underlying_symbols: [underlying],
      status: 'active',
    });

    // Initialize result structure
    const result: GroupedOptionChain = {
      underlying,
      byExpiration: {},
      expirations: [],
      strikes: [],
    };

    const expirationSet = new Set<string>();
    const strikeSet = new Set<number>();

    // Group contracts
    for (const contract of contracts) {
      const expiration = contract.expiration_date;
      const strike = parseFloat(contract.strike_price);

      // Filter by expiration if specified
      if (expirationDates && !expirationDates.includes(expiration)) {
        continue;
      }

      // Track unique values
      expirationSet.add(expiration);
      if (!isNaN(strike)) {
        strikeSet.add(strike);
      }

      // Initialize expiration bucket if needed
      if (!result.byExpiration[expiration]) {
        result.byExpiration[expiration] = {
          calls: {},
          puts: {},
        };
      }

      // Add to appropriate bucket
      const strikeKey = strike.toString();
      if (contract.type === 'call') {
        result.byExpiration[expiration].calls[strikeKey] = contract;
      } else if (contract.type === 'put') {
        result.byExpiration[expiration].puts[strikeKey] = contract;
      }
    }

    // Sort and assign arrays
    result.expirations = Array.from(expirationSet).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );
    result.strikes = Array.from(strikeSet).sort((a, b) => a - b);

    log(`Grouped ${contracts.length} contracts: ${result.expirations.length} expirations, ${result.strikes.length} strikes`, {
      type: 'info',
      symbol: underlying,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to get grouped option chain for ${underlying}: ${errorMessage}`, {
      type: 'error',
      symbol: underlying,
    });
    throw new Error(`Failed to get grouped option chain: ${errorMessage}`);
  }
}

/**
 * Find options contracts within a delta range (approximated by strike distance from current price)
 *
 * @param client - The AlpacaClient instance
 * @param underlying - The underlying symbol
 * @param expirationDate - The expiration date
 * @param currentPrice - Current price of the underlying
 * @param targetDeltaPercent - Target delta as percentage of current price (e.g., 5 for 5%)
 * @param type - Option type (call or put)
 * @returns Array of contracts within the delta range
 *
 * @example
 * // Find calls approximately 5% OTM
 * const otmCalls = await findOptionsByDelta(client, 'AAPL', '2024-01-19', 175, 5, 'call');
 */
export async function findOptionsByDelta(
  client: AlpacaClient,
  underlying: string,
  expirationDate: string,
  currentPrice: number,
  targetDeltaPercent: number,
  type: OptionType
): Promise<OptionContract[]> {
  log(`Finding ${type} options for ${underlying} at ~${targetDeltaPercent}% OTM`, {
    type: 'debug',
    symbol: underlying,
  });

  try {
    const contracts = await getOptionChain(client, underlying, {
      expirationDate,
      type,
    });

    // Calculate target strike based on delta approximation
    // For calls: OTM is above current price
    // For puts: OTM is below current price
    const deltaOffset = (targetDeltaPercent / 100) * currentPrice;
    const targetStrike = type === 'call'
      ? currentPrice + deltaOffset
      : currentPrice - deltaOffset;

    // Find contracts near the target strike (within 2.5% tolerance)
    const tolerance = currentPrice * 0.025;
    const filtered = contracts.filter((contract) => {
      const strike = parseFloat(contract.strike_price);
      return Math.abs(strike - targetStrike) <= tolerance;
    });

    // Sort by distance from target
    filtered.sort((a, b) => {
      const aDist = Math.abs(parseFloat(a.strike_price) - targetStrike);
      const bDist = Math.abs(parseFloat(b.strike_price) - targetStrike);
      return aDist - bDist;
    });

    log(`Found ${filtered.length} ${type} options near target delta`, {
      type: 'info',
      symbol: underlying,
      metadata: { targetStrike: targetStrike.toFixed(2), contracts: filtered.length },
    });

    return filtered;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to find options by delta: ${errorMessage}`, {
      type: 'error',
      symbol: underlying,
    });
    throw new Error(`Failed to find options by delta: ${errorMessage}`);
  }
}

/**
 * Find the nearest expiration date to a target number of days out
 *
 * @param client - The AlpacaClient instance
 * @param underlying - The underlying symbol
 * @param targetDays - Target number of days to expiration
 * @returns The nearest available expiration date
 *
 * @example
 * // Find expiration closest to 30 days out
 * const expiration = await findNearestExpiration(client, 'AAPL', 30);
 */
export async function findNearestExpiration(
  client: AlpacaClient,
  underlying: string,
  targetDays: number
): Promise<string> {
  log(`Finding expiration nearest to ${targetDays} days for ${underlying}`, {
    type: 'debug',
    symbol: underlying,
  });

  try {
    const expirations = await getExpirationDates(client, underlying);

    if (expirations.length === 0) {
      throw new Error(`No expiration dates available for ${underlying}`);
    }

    const now = new Date();
    const targetDate = new Date(now.getTime() + targetDays * 24 * 60 * 60 * 1000);
    const targetTime = targetDate.getTime();

    let nearestExpiration = expirations[0];
    let minDiff = Math.abs(new Date(expirations[0]).getTime() - targetTime);

    for (const exp of expirations) {
      const expTime = new Date(exp).getTime();
      const diff = Math.abs(expTime - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        nearestExpiration = exp;
      }
    }

    const actualDays = Math.round((new Date(nearestExpiration).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    log(`Found nearest expiration: ${nearestExpiration} (${actualDays} days)`, {
      type: 'info',
      symbol: underlying,
      metadata: { targetDays, actualDays, expiration: nearestExpiration },
    });

    return nearestExpiration;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to find nearest expiration: ${errorMessage}`, {
      type: 'error',
      symbol: underlying,
    });
    throw new Error(`Failed to find nearest expiration: ${errorMessage}`);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse OCC option symbol to extract components
 *
 * @param occSymbol - OCC option symbol (e.g., AAPL230120C00150000)
 * @returns Parsed symbol components
 *
 * @example
 * const parsed = parseOCCSymbol('AAPL230120C00150000');
 * // Returns: { underlying: 'AAPL', expiration: '2023-01-20', type: 'call', strike: 150 }
 */
export function parseOCCSymbol(occSymbol: string): {
  underlying: string;
  expiration: string;
  type: OptionType;
  strike: number;
} | null {
  // OCC format: SYMBOL + YYMMDD + C/P + STRIKE (8 digits, strike * 1000)
  // Example: AAPL230120C00150000 = AAPL Jan 20 2023 $150 Call

  // Find where the date portion starts (last 15 characters are date+type+strike)
  if (occSymbol.length < 15) {
    log(`Invalid OCC symbol format: ${occSymbol}`, { type: 'warn' });
    return null;
  }

  const suffixStart = occSymbol.length - 15;
  const underlying = occSymbol.substring(0, suffixStart);
  const suffix = occSymbol.substring(suffixStart);

  // Parse date (YYMMDD)
  const year = '20' + suffix.substring(0, 2);
  const month = suffix.substring(2, 4);
  const day = suffix.substring(4, 6);
  const expiration = `${year}-${month}-${day}`;

  // Parse type
  const typeChar = suffix.charAt(6);
  const type: OptionType = typeChar === 'C' ? 'call' : 'put';

  // Parse strike (8 digits, last 3 are decimal)
  const strikeStr = suffix.substring(7);
  const strike = parseInt(strikeStr, 10) / 1000;

  return { underlying, expiration, type, strike };
}

/**
 * Build OCC option symbol from components
 *
 * @param underlying - The underlying symbol
 * @param expiration - Expiration date (YYYY-MM-DD format)
 * @param type - Option type (call or put)
 * @param strike - Strike price
 * @returns OCC-formatted option symbol
 *
 * @example
 * const symbol = buildOCCSymbol('AAPL', '2023-01-20', 'call', 150);
 * // Returns: 'AAPL230120C00150000'
 */
export function buildOCCSymbol(
  underlying: string,
  expiration: string,
  type: OptionType,
  strike: number
): string {
  // Parse date
  const [year, month, day] = expiration.split('-');
  const dateStr = year.slice(2) + month + day;

  // Type character
  const typeChar = type === 'call' ? 'C' : 'P';

  // Strike (multiply by 1000 and pad to 8 digits)
  const strikeInt = Math.round(strike * 1000);
  const strikeStr = strikeInt.toString().padStart(8, '0');

  return `${underlying}${dateStr}${typeChar}${strikeStr}`;
}

/**
 * Check if an option contract is tradable
 *
 * @param contract - The option contract to check
 * @returns True if the contract is active and tradable
 */
export function isContractTradable(contract: OptionContract): boolean {
  return contract.status === 'active' && contract.tradable === true;
}

/**
 * Calculate days to expiration for a contract
 *
 * @param contract - The option contract
 * @returns Number of calendar days until expiration
 */
export function getDaysToExpiration(contract: OptionContract): number {
  const now = new Date();
  const expiration = new Date(contract.expiration_date);
  const diffMs = expiration.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * Check if a contract is expiring within N days
 *
 * @param contract - The option contract
 * @param days - Number of days threshold
 * @returns True if contract expires within the specified days
 */
export function isExpiringWithin(contract: OptionContract, days: number): boolean {
  return getDaysToExpiration(contract) <= days;
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  // Core API functions
  getOptionContracts,
  getOptionContract,
  getOptionChain,
  getExpirationDates,
  getStrikePrices,
  findATMOptions,
  getGroupedOptionChain,
  findOptionsByDelta,
  findNearestExpiration,

  // Utility functions
  parseOCCSymbol,
  buildOCCSymbol,
  isContractTradable,
  getDaysToExpiration,
  isExpiringWithin,
};
