// performance-metrics.ts
import { getLogger } from "./logger";

import {
  fetchAccountDetails,
  fetchPortfolioHistory,
  makeRequest,
} from "./alpaca/legacy";
import { getStartAndEndTimestamps } from "./market-time";
import {
  PortfolioHistoryParams,
  PortfolioHistory,
  PortfolioHistoryResponse,
  BenchmarkBar,
  CalculateBetaResult,
  AlpacaAccountDetails,
  AlpacaAccountGetOptions,
  AlpacaAuth,
  TimeFrame,
} from "./types/alpaca-types";
import { Period, IntradayReporting } from "./types/market-time-types";
import { types } from "@adaptic/backend-legacy";
import adaptic from "@adaptic/backend-legacy";
import { getSharedApolloClient } from "./adaptic";
import {
  PerformanceMetrics,
  FetchPerformanceMetricsProps,
} from "./types/metrics-types";
import { getRiskFreeRate } from "./risk-free-rate";
import { marketDataAPI } from "./alpaca-market-data-api";

/**
 * Calculates the total return year-to-date (YTD) for a given portfolio history.
 * @param portfolioHistory - The portfolio history data containing equity values.
 * @returns A promise that resolves to a string representing the total return YTD in percentage format.
 */
async function calculateTotalReturnYTD(
  portfolioHistory: PortfolioHistoryResponse,
): Promise<string> {
  const equity = portfolioHistory.equity; // array of equity values

  if (!equity || !Array.isArray(equity) || equity.length < 2) {
    getLogger().warn("Not enough data to calculate total return.");
    return "N/A";
  }

  let startEquity = equity[0];
  const endEquity = equity[equity.length - 1];

  // Validate startEquity and endEquity
  if (typeof startEquity !== "number" || isNaN(startEquity)) {
    getLogger().warn("Invalid start equity value.");
    return "N/A";
  }

  // if startEquity is 0 or less, fetch the first non-zero value in the array
  if (startEquity <= 0) {
    for (let i = 1; i < equity.length; i++) {
      if (equity[i] > 0) {
        startEquity = equity[i];
        break;
      }
    }
  }

  if (typeof endEquity !== "number" || isNaN(endEquity)) {
    getLogger().warn("Invalid end equity value.");
  }

  // Calculate total return
  const totalReturn = ((endEquity - startEquity) / startEquity) * 100;

  return `${totalReturn.toFixed(2)}%`;
}

/**
 * Calculates the expense ratio for a given Alpaca account.
 * @param accountId - The ID of the Alpaca account.
 * @param client - The Apollo client instance.
 * @param alpacaAccount - The Alpaca account object.
 * @returns A promise that resolves to a string representing the expense ratio
 *   in percentage format, or "N/A" when the ratio cannot be computed honestly
 *   (missing account, fee-fetch failure, or non-positive/non-finite equity).
 */
export async function calculateExpenseRatio({
  accountId,
  client,
  alpacaAccount,
}: AlpacaAccountGetOptions): Promise<string> {
  if (!accountId && !alpacaAccount && !client) {
    getLogger().warn(
      "Missing account ID or client to calculate expense ratio.",
    );
    return "N/A";
  }

  const alpacaAccountId: string =
    accountId || (alpacaAccount && alpacaAccount.id) || "";
  let accountDetails: AlpacaAccountDetails | null;

  if (!alpacaAccountId) {
    getLogger().warn("Invalid account ID.");
    return "N/A";
  }

  if (alpacaAccount) {
    // Use Alpaca account object to get accountDetails
    accountDetails = (await fetchAccountDetails({
      alpacaAccount: alpacaAccount as types.AlpacaAccount,
    })) as AlpacaAccountDetails;

    if (!accountDetails) {
      getLogger().warn(
        "Failed to fetch account details inside calculateExpenseRatio.",
      );
      return "N/A";
    }
  } else {
    // Fetch account details using account ID and client
    accountDetails = (await fetchAccountDetails({
      accountId,
      client,
    })) as AlpacaAccountDetails;

    if (!accountDetails) {
      getLogger().warn(
        "Failed to fetch account details inside calculateExpenseRatio.",
      );
      return "N/A";
    }
  }

  // Validate equity. A drained or freshly-funded account reports equity "0"
  // (and a broken feed can yield NaN or a negative string); dividing by it
  // would fabricate "Infinity%"/"NaN%" — return the deliberate "N/A"
  // (unknown) instead, consistent with the fee-fetch failure path below.
  const equity = parseFloat(accountDetails.equity);
  if (!Number.isFinite(equity) || equity <= 0) {
    getLogger().warn(
      "Non-positive or non-finite equity value; cannot compute expense ratio.",
      { equity: accountDetails.equity },
    );
    return "N/A";
  }

  // Fetch the account's real trailing fee expenses from Alpaca account
  // activities. A genuine data-source failure yields "N/A" (unknown) rather
  // than a fabricated 0.00%.
  const auth: AlpacaAuth = {
    adapticAccountId: alpacaAccountId,
    alpacaApiKey: alpacaAccount?.APIKey,
    alpacaApiSecret: alpacaAccount?.APISecret,
  };

  let expenses: number;
  try {
    expenses = await fetchTrailingFeeExpenses(auth);
  } catch (error) {
    getLogger().warn(
      "Failed to fetch Alpaca account fee activities for expense ratio.",
      { error },
    );
    return "N/A";
  }

  // Calculate expense ratio (trailing fees as a percentage of current equity).
  const expenseRatio = (expenses / equity) * 100;

  return `${expenseRatio.toFixed(2)}%`;
}

/** Trailing window over which account fees are aggregated for the expense ratio. */
const EXPENSE_TRAILING_WINDOW_DAYS = 365;
/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Alpaca account-activity types that represent fees/regulatory charges. */
const FEE_ACTIVITY_TYPES = "FEE,REG,CFEE";
/** Page size for the paginated Alpaca account-activities endpoint. */
const ACTIVITIES_PAGE_SIZE = 100;
/** Hard cap on activity pages to bound pagination on unexpected responses. */
const ACTIVITIES_MAX_PAGES = 1000;

/**
 * A non-trade Alpaca account activity (e.g. a FEE/REG/CFEE entry). Only the
 * fields required to aggregate fees are modelled.
 */
interface AlpacaNonTradeActivity {
  id: string;
  activity_type: string;
  date?: string;
  net_amount?: string;
}

/**
 * Aggregates the account's fee/regulatory charges over the trailing window from
 * the Alpaca account-activities endpoint, following id-based pagination.
 * @param auth - Alpaca authentication (account id and/or direct API keys).
 * @returns Total fees in account currency (USD) as a positive number.
 */
export async function fetchTrailingFeeExpenses(
  auth: AlpacaAuth,
): Promise<number> {
  const after = new Date(
    Date.now() - EXPENSE_TRAILING_WINDOW_DAYS * MS_PER_DAY,
  ).toISOString();

  let total = 0;
  let pageToken: string | undefined;

  for (let page = 0; page < ACTIVITIES_MAX_PAGES; page++) {
    const queryParams = new URLSearchParams({
      activity_types: FEE_ACTIVITY_TYPES,
      after,
      page_size: String(ACTIVITIES_PAGE_SIZE),
    });
    if (pageToken) {
      queryParams.append("page_token", pageToken);
    }

    const activities = await makeRequest<AlpacaNonTradeActivity[]>(auth, {
      endpoint: "/account/activities",
      method: "GET",
      queryString: `?${queryParams.toString()}`,
    });

    if (!Array.isArray(activities) || activities.length === 0) {
      break;
    }

    for (const activity of activities) {
      const amount = parseFloat(activity.net_amount ?? "");
      if (Number.isFinite(amount)) {
        // Fee entries are debits (negative net_amount); accumulate magnitude.
        total += Math.abs(amount);
      }
    }

    if (activities.length < ACTIVITIES_PAGE_SIZE) {
      break;
    }
    pageToken = activities[activities.length - 1].id;
  }

  return total;
}

/**
 * Calculates the liquidity ratio for a given Alpaca account.
 * @param accountId - The ID of the Alpaca account.
 * @param client - The Apollo client instance.
 * @param alpacaAccount - The Alpaca account object.
 * @returns A promise that resolves to a string representing the liquidity ratio in the format "1:ratio".
 */
async function calculateLiquidityRatio({
  accountId,
  client,
  alpacaAccount,
}: AlpacaAccountGetOptions): Promise<string> {
  if (!accountId && !alpacaAccount && !client) {
    getLogger().warn(
      "Missing account ID or client to calculateLiquidityRatio.",
    );
    return "N/A";
  }

  const alpacaAccountId: string =
    accountId || (alpacaAccount && alpacaAccount.id) || "";
  let accountDetails: AlpacaAccountDetails | null;

  if (!alpacaAccountId) {
    getLogger().warn("Invalid account ID.");
    return "N/A";
  }

  if (alpacaAccount) {
    // Use Alpaca account object to get accountDetails
    accountDetails = (await fetchAccountDetails({
      alpacaAccount: alpacaAccount as types.AlpacaAccount,
    })) as AlpacaAccountDetails;

    if (!accountDetails) {
      getLogger().warn(
        "Failed to fetch account details inside calculateLiquidityRatio.",
      );
      return "N/A";
    }
  } else {
    // Fetch account details using account ID and client
    accountDetails = (await fetchAccountDetails({
      accountId,
      client,
    })) as AlpacaAccountDetails;

    if (!accountDetails) {
      getLogger().warn("Failed to fetch account details.");
      return "N/A";
    }
  }

  const cashBalance = parseFloat(accountDetails.cash);
  const equity = parseFloat(accountDetails.equity);
  const totalPositionsValue = equity - cashBalance;

  if (isNaN(cashBalance)) {
    getLogger().warn("Invalid cash balance.");
    return "N/A";
  }

  if (isNaN(equity)) {
    getLogger().warn("Invalid equity value.");
    return "N/A";
  }

  // Calculate total portfolio value
  const totalPortfolioValue = cashBalance + totalPositionsValue;

  if (totalPortfolioValue <= 0) {
    getLogger().warn("Total portfolio value is zero or negative.");
    return "N/A";
  }

  // Calculate liquidity ratio as Total Portfolio Value to Cash Balance
  const ratio = totalPortfolioValue / cashBalance;

  // Ensure the ratio is a finite number
  if (!isFinite(ratio)) {
    getLogger().warn(
      "Liquidity ratio calculation resulted in a non-finite number.",
    );
    return "N/A";
  }

  return `1:${ratio.toFixed(2)}`;
}

/**
 * Calculates the risk-adjusted return for a given portfolio history.
 * @param portfolioHistory - The portfolio history data containing profit/loss percentages.
 * @returns A promise that resolves to a string representing the risk-adjusted return.
 */
async function calculateRiskAdjustedReturn(
  portfolioHistory: PortfolioHistoryResponse,
): Promise<string> {
  const returns = portfolioHistory.profit_loss_pct; // Array of percentage returns in decimal form

  // Validate the returns array
  if (!returns || !Array.isArray(returns) || returns.length < 2) {
    getLogger().warn("No returns data available.");
    return "N/A";
  }

  // Filter out invalid returns
  const validReturns = returns.filter(
    (ret: number) => typeof ret === "number" && !isNaN(ret),
  );

  if (validReturns.length < 2) {
    getLogger().warn(
      "Not enough valid returns data to calculate risk-adjusted return.",
    );
    return "N/A";
  }

  // Calculate average daily return
  const avgDailyReturn =
    validReturns.reduce((sum: number, ret: number) => sum + ret, 0) /
    validReturns.length;

  // Calculate standard deviation of daily returns
  const mean = avgDailyReturn;
  const squaredDiffs = validReturns.map((ret: number) =>
    Math.pow(ret - mean, 2),
  );
  const variance =
    squaredDiffs.reduce((sum: number, diff: number) => sum + diff, 0) /
    (validReturns.length - 1);
  const stdDevDaily = Math.sqrt(variance);

  // Annualize average return and standard deviation
  const tradingDaysPerYear = 252;
  const avgAnnualReturn = avgDailyReturn * tradingDaysPerYear;
  const stdDevAnnual = stdDevDaily * Math.sqrt(tradingDaysPerYear);

  // Check for zero or non-finite standard deviation
  if (!isFinite(stdDevAnnual) || stdDevAnnual === 0) {
    getLogger().warn(
      "Standard deviation is zero or non-finite, cannot calculate Sharpe ratio.",
    );
    return "N/A";
  }

  // Fetch live annualized risk-free rate (3-month T-Bill), cached daily.
  // See src/risk-free-rate.ts for source + fallback behavior.
  const riskFreeRate = await getRiskFreeRate();

  // Calculate Sharpe Ratio
  const sharpeRatio = (avgAnnualReturn - riskFreeRate) / stdDevAnnual;

  if (!isFinite(sharpeRatio)) {
    getLogger().warn(
      "Sharpe ratio calculation resulted in a non-finite number.",
    );
    return "N/A";
  }

  // Return the Sharpe Ratio formatted to two decimal places
  return `${sharpeRatio.toFixed(2)}`;
}

/**
 * Retrieves the dividend yield for the portfolio.
 * @returns A promise that resolves to a string representing the dividend yield.
 */
async function getDividendYield(): Promise<string> {
  return "N/A";
}

/**
 * Cleans the portfolio equity data by replacing NaN and Infinity values with the last valid value.
 * @param equity - Array of portfolio equity values.
 * @returns Cleaned equity array.
 */
function interpolatePortfolioEquity(equity: number[]): number[] {
  const cleanedEquity: number[] = [];
  let lastValid = 0;

  for (let i = 0; i < equity.length; i++) {
    if (isFinite(equity[i])) {
      cleanedEquity.push(equity[i]);
      lastValid = equity[i];
    } else {
      getLogger().warn(
        `Invalid equity value at index ${i}: ${equity[i]}. Replacing with last valid value: ${lastValid}`,
      );
      cleanedEquity.push(lastValid);
    }
  }

  return cleanedEquity;
}

/**
 * Calculates the alpha, beta, and annualized Alpha of the portfolio compared to a benchmark.
 * @param portfolioHistory - The portfolio history data.
 * @param benchmarkBars - The historical price data of the benchmark.
 * @returns An object containing alpha, beta, and annualized alpha.
 */
export async function calculateAlphaAndBeta(
  portfolioHistory: PortfolioHistoryResponse,
  benchmarkBars: BenchmarkBar[],
): Promise<{
  alpha: string;
  alphaAnnualized: string;
  beta: string;
}> {
  if (!portfolioHistory || !benchmarkBars || benchmarkBars.length < 2) {
    getLogger().warn("Insufficient portfolio or benchmark data.", {
      portfolioHistory,
      benchmarkBars,
    });
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }

  let portfolioEquity = portfolioHistory.equity;
  let portfolioTimestamps = portfolioHistory.timestamp;

  if (
    !portfolioEquity ||
    !Array.isArray(portfolioEquity) ||
    portfolioEquity.length < 2 ||
    !portfolioTimestamps ||
    !Array.isArray(portfolioTimestamps) ||
    portfolioTimestamps.length !== portfolioEquity.length
  ) {
    getLogger().warn("Invalid or insufficient portfolio equity data.", {
      portfolioEquity,
      portfolioTimestamps,
    });
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }

  // **Trim initial zero equity values**
  const firstNonZeroIndex = portfolioEquity.findIndex((equity) => equity !== 0);
  if (firstNonZeroIndex === -1) {
    getLogger().warn("Portfolio equity contains only zeros.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }
  portfolioEquity = portfolioEquity.slice(firstNonZeroIndex);
  portfolioTimestamps = portfolioTimestamps.slice(firstNonZeroIndex);

  // **Convert portfolio timestamps from ISO strings to Unix milliseconds**
  portfolioTimestamps = portfolioTimestamps.map(
    (timestamp: number) => timestamp * 1000,
  );

  // **Normalize portfolio timestamps to midnight UTC**
  portfolioTimestamps = portfolioTimestamps.map((timestamp: number) =>
    getMidnightTimestamp(timestamp),
  );

  // **Clean the portfolio equity data**
  const cleanedPortfolioEquity = interpolatePortfolioEquity(portfolioEquity);

  // **Calculate portfolio returns with Unix millisecond timestamps**
  const portfolioReturnsWithDates = calculateDailyReturnsWithTimestamps(
    cleanedPortfolioEquity,
    portfolioTimestamps,
  );

  // **Process benchmark data**
  const benchmarkPrices = benchmarkBars.map((bar) => bar.c);
  let benchmarkTimestamps = benchmarkBars.map((bar) => bar.t);

  if (
    !benchmarkPrices ||
    !Array.isArray(benchmarkPrices) ||
    benchmarkPrices.length < 2 ||
    !benchmarkTimestamps ||
    !Array.isArray(benchmarkTimestamps) ||
    benchmarkTimestamps.length !== benchmarkPrices.length
  ) {
    getLogger().warn("Invalid or insufficient benchmark data.", {
      benchmarkPrices,
      benchmarkTimestamps,
    });
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }

  // **Convert benchmark timestamps from Unix seconds to Unix milliseconds**
  benchmarkTimestamps = benchmarkTimestamps.map(
    (timestamp: number) => timestamp * 1000,
  );

  // **Normalize benchmark timestamps to midnight UTC**
  benchmarkTimestamps = benchmarkTimestamps.map((timestamp: number) =>
    getMidnightTimestamp(timestamp),
  );

  // **Calculate benchmark returns with Unix millisecond timestamps**
  const benchmarkReturnsWithDates = calculateDailyReturnsWithTimestamps(
    benchmarkPrices,
    benchmarkTimestamps,
  );

  // **Align returns by timestamp and ensure returns are finite**
  const portfolioReturnsMap = new Map<number, number>();
  portfolioReturnsWithDates.forEach(({ timestamp, return: ret }) => {
    if (isFinite(ret)) {
      portfolioReturnsMap.set(timestamp, ret);
    } else {
      getLogger().warn(
        `Non-finite portfolio return on ${new Date(timestamp).toISOString()}: ${ret}. Skipping.`,
      );
    }
  });

  const benchmarkReturnsMap = new Map<number, number>();
  benchmarkReturnsWithDates.forEach(({ timestamp, return: ret }) => {
    if (isFinite(ret)) {
      benchmarkReturnsMap.set(timestamp, ret);
    } else {
      getLogger().warn(
        `Non-finite benchmark return on ${new Date(timestamp).toISOString()}: ${ret}. Skipping.`,
      );
    }
  });

  // **Find common timestamps**
  const commonTimestamps = [...portfolioReturnsMap.keys()].filter((timestamp) =>
    benchmarkReturnsMap.has(timestamp),
  );

  if (commonTimestamps.length < 2) {
    getLogger().warn("Not enough overlapping data to calculate alpha.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }

  // **Align returns**
  const alignedPortfolioReturns: number[] = [];
  const alignedBenchmarkReturns: number[] = [];

  for (const timestamp of commonTimestamps) {
    // commonTimestamps is the key intersection of both maps, so both lookups
    // are guaranteed present; the guard replaces a non-null assertion.
    const portfolioRet = portfolioReturnsMap.get(timestamp);
    const benchmarkRet = benchmarkReturnsMap.get(timestamp);
    if (portfolioRet === undefined || benchmarkRet === undefined) {
      continue;
    }

    if (isFinite(portfolioRet) && isFinite(benchmarkRet)) {
      alignedPortfolioReturns.push(portfolioRet);
      alignedBenchmarkReturns.push(benchmarkRet);
    } else {
      getLogger().warn(
        `Non-finite returns on ${new Date(timestamp).toISOString()}. Skipping.`,
      );
    }
  }

  const n = alignedPortfolioReturns.length;

  if (n === 0) {
    getLogger().warn("No valid aligned returns to calculate alpha.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }

  // **Calculate average returns**
  const portfolioAvgReturn =
    alignedPortfolioReturns.reduce((sum, ret) => sum + ret, 0) / n;
  const benchmarkAvgReturn =
    alignedBenchmarkReturns.reduce((sum, ret) => sum + ret, 0) / n;

  // **Calculate beta**
  const beta = calculateBetaFromReturns(
    alignedPortfolioReturns,
    alignedBenchmarkReturns,
  );

  if (!isFinite(beta.beta)) {
    getLogger().warn("Beta calculation resulted in a non-finite value.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }

  // **Calculate alpha**
  // Fetch live annualized risk-free rate (3-month T-Bill), cached daily.
  // See src/risk-free-rate.ts for source + fallback behavior.
  const riskFreeRateAnnual = await getRiskFreeRate();
  const tradingDaysPerYear = 252;
  const riskFreeRateDaily = riskFreeRateAnnual / tradingDaysPerYear;

  const alpha =
    portfolioAvgReturn -
    (riskFreeRateDaily + beta.beta * (benchmarkAvgReturn - riskFreeRateDaily));

  const alphaAnnualized = alpha * tradingDaysPerYear;

  if (!isFinite(alphaAnnualized)) {
    getLogger().warn("Alpha calculation resulted in a non-finite value.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }

  return {
    alpha: `${(alpha * 100).toFixed(2)}`,
    alphaAnnualized: `${(alphaAnnualized * 100).toFixed(2)}`,
    beta: `${(beta.beta * 100).toFixed(2)}`,
  };
}

// **Helper function to calculate daily returns with Unix millisecond timestamps**
function calculateDailyReturnsWithTimestamps(
  values: number[],
  timestamps: number[],
): { timestamp: number; return: number }[] {
  const returnsWithTimestamps: { timestamp: number; return: number }[] = [];

  for (let i = 1; i < values.length; i++) {
    const prevValue = values[i - 1];
    const currValue = values[i];
    const currTimestamp = timestamps[i];

    if (!isFinite(prevValue) || prevValue === 0) {
      // Avoid division by zero or invalid returns
      continue;
    }

    const ret = (currValue - prevValue) / prevValue;

    returnsWithTimestamps.push({ timestamp: currTimestamp, return: ret });
  }

  return returnsWithTimestamps;
}

// **Helper function to normalize timestamps to midnight UTC**
function getMidnightTimestamp(timestamp: number): number {
  const date = new Date(timestamp);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

interface DrawdownResult {
  maxDrawdownPercentage: string; // Maximum drawdown as formatted percentage
  maxDrawdownValue: number; // Actual value drop during max drawdown
  peakValue: number; // The peak value before the max drawdown
  troughValue: number; // The lowest value during max drawdown
  peakIndex: number; // Index where the peak occurred
  troughIndex: number; // Index where the trough occurred
  drawdownPeriod: number; // Number of periods from peak to trough
  recoveryIndex?: number; // Index where drawdown recovered (if it did)
  recoveryPeriod?: number; // Number of periods from trough to recovery
  currentDrawdownPercentage: string; // Current drawdown from last peak as percentage
}

/**
 * Calculates the Maximum Drawdown (MDD) and related metrics from an array of equity values.
 *
 * @param equity - An array of equity values (must contain at least one positive number)
 * @param options - Configuration options for the calculation
 * @returns Object containing drawdown metrics
 * @throws Will throw an error if the input is invalid
 */
export function calculateDrawdownMetrics(
  equity: number[],
  options: {
    decimals?: number;
    minimumDrawdown?: number;
  } = {},
): DrawdownResult {
  // Default options
  const decimals = options.decimals ?? 2;
  const minimumDrawdown = options.minimumDrawdown ?? 0;

  // Input validation
  if (!Array.isArray(equity) || equity.length === 0) {
    throw new TypeError("Equity data must be a non-empty array of numbers.");
  }

  // Pre-validate all equity values at once
  const validEquity = equity.map((value, index) => {
    if (typeof value !== "number" || isNaN(value)) {
      getLogger().warn(
        `Invalid equity value at index ${index}: ${value}. Using 0 instead.`,
      );
      return 0;
    }
    return value;
  });

  // Single-pass algorithm for efficiency
  let maxDrawdown = 0;
  let maxPeakIndex = 0;
  let maxTroughIndex = 0;
  let peakIndex = 0;
  let peakValue = validEquity[0];
  let _currentPeakIndex = 0;
  let currentPeakValue = validEquity[0];
  let recoveryIndex: number | undefined;

  // Main loop - O(n) complexity
  for (let i = 1; i < validEquity.length; i++) {
    const currentValue = validEquity[i];

    // Update peak if we have a new high
    if (currentValue >= peakValue) {
      peakValue = currentValue;
      peakIndex = i;
    } else {
      // Calculate drawdown from peak
      const drawdown =
        peakValue <= 0 ? 0 : (peakValue - currentValue) / peakValue;

      // Update max drawdown if current drawdown is greater
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxPeakIndex = peakIndex;
        maxTroughIndex = i;
        recoveryIndex = undefined;
      }

      // Check for recovery from max drawdown
      if (
        !recoveryIndex &&
        maxDrawdown > 0 &&
        currentValue >= validEquity[maxPeakIndex]
      ) {
        recoveryIndex = i;
      }
    }

    // Track current peak for current drawdown calculation
    if (currentValue >= currentPeakValue) {
      currentPeakValue = currentValue;
      _currentPeakIndex = i;
    }
  }

  // Calculate current drawdown
  const lastValue = validEquity[validEquity.length - 1];
  const currentDrawdown =
    currentPeakValue <= 0
      ? 0
      : (currentPeakValue - lastValue) / currentPeakValue;

  // Helper for percentage formatting
  const formatPercentage = (value: number): string => {
    const percentage = value * 100;
    return `${parseFloat(percentage.toFixed(decimals))}%`;
  };

  // If no drawdown meets minimum threshold, return default values
  if (maxDrawdown < minimumDrawdown) {
    return {
      maxDrawdownPercentage: "0%",
      maxDrawdownValue: 0,
      peakValue: validEquity[0],
      troughValue: validEquity[0],
      peakIndex: 0,
      troughIndex: 0,
      drawdownPeriod: 0,
      recoveryIndex: undefined,
      recoveryPeriod: undefined,
      currentDrawdownPercentage: formatPercentage(
        currentDrawdown >= minimumDrawdown ? currentDrawdown : 0,
      ),
    };
  }

  // Calculate periods
  const drawdownPeriod = maxTroughIndex - maxPeakIndex;
  const recoveryPeriod =
    recoveryIndex !== undefined ? recoveryIndex - maxTroughIndex : undefined;

  return {
    maxDrawdownPercentage: formatPercentage(maxDrawdown),
    maxDrawdownValue: validEquity[maxPeakIndex] - validEquity[maxTroughIndex],
    peakValue: validEquity[maxPeakIndex],
    troughValue: validEquity[maxTroughIndex],
    peakIndex: maxPeakIndex,
    troughIndex: maxTroughIndex,
    drawdownPeriod,
    recoveryIndex,
    recoveryPeriod,
    currentDrawdownPercentage: formatPercentage(
      currentDrawdown >= minimumDrawdown ? currentDrawdown : 0,
    ),
  };
}

/**
 * Simplified version that returns only the maximum drawdown percentage
 * For backward compatibility
 * @param equity - An array of equity values.
 * @param decimals - Number of decimal places for the percentage value.
 * @returns The maximum drawdown percentage as a string.
 */
export function calculateMaxDrawdown(
  equity: number[],
  decimals: number = 2,
): string {
  const result = calculateDrawdownMetrics(equity, { decimals });
  return result.maxDrawdownPercentage;
}

/**
 * Calculates daily log returns for an array of prices.
 * Log returns are preferred for statistical properties.
 * @param prices - Array of prices.
 * @returns Array of daily log returns.
 */
export function calculateDailyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const previous = prices[i - 1];
    const current = prices[i];

    if (!isFinite(previous) || !isFinite(current) || previous <= 0) {
      continue; // Skip invalid returns
    }

    const logReturn = Math.log(current / previous);
    returns.push(logReturn);
  }
  return returns;
}

/**
 * Aligns portfolio and benchmark returns based on matching dates.
 * @param portfolioHistory - The portfolio history data.
 * @param benchmarkBars - The historical price data of the benchmark.
 * @returns An object containing aligned returns arrays.
 */
export function alignReturnsByDate(
  portfolioHistory: PortfolioHistory,
  benchmarkBars: BenchmarkBar[],
): { alignedPortfolioReturns: number[]; alignedBenchmarkReturns: number[] } {
  const portfolioEquity = portfolioHistory.equity;
  let portfolioTimestamps = portfolioHistory.timestamp;

  const benchmarkPrices = benchmarkBars.map((bar) => bar.c);
  let benchmarkTimestamps = benchmarkBars.map((bar) => bar.t);

  // **Convert portfolio timestamps from ISO strings to Unix milliseconds**
  portfolioTimestamps = portfolioTimestamps.map(
    (timestamp: number) => timestamp * 1000,
  );

  // **Normalize portfolio timestamps to midnight UTC**
  portfolioTimestamps = portfolioTimestamps.map((timestamp: number) =>
    getMidnightTimestamp(timestamp),
  );

  // **Convert benchmark timestamps from Unix seconds to Unix milliseconds**
  benchmarkTimestamps = benchmarkTimestamps.map(
    (timestamp: number) => timestamp * 1000,
  );

  // **Normalize benchmark timestamps to midnight UTC**
  benchmarkTimestamps = benchmarkTimestamps.map((timestamp: number) =>
    getMidnightTimestamp(timestamp),
  );

  // Calculate log daily returns
  const portfolioReturns = calculateDailyReturns(portfolioEquity);
  const benchmarkReturns = calculateDailyReturns(benchmarkPrices);

  // Create maps of timestamp to return
  const portfolioReturnsMap = new Map<number, number>();
  for (let i = 1; i < portfolioTimestamps.length; i++) {
    const timestamp = portfolioTimestamps[i];
    const ret = portfolioReturns[i - 1];
    if (isFinite(ret)) {
      portfolioReturnsMap.set(timestamp, ret);
    }
  }

  const benchmarkReturnsMap = new Map<number, number>();
  for (let i = 1; i < benchmarkTimestamps.length; i++) {
    const timestamp = benchmarkTimestamps[i];
    const ret = benchmarkReturns[i - 1];
    if (isFinite(ret)) {
      benchmarkReturnsMap.set(timestamp, ret);
    }
  }

  // Find common timestamps
  const commonTimestamps = [...portfolioReturnsMap.keys()].filter((timestamp) =>
    benchmarkReturnsMap.has(timestamp),
  );

  if (commonTimestamps.length === 0) {
    getLogger().warn("No common dates found between portfolio and benchmark.");
    return {
      alignedPortfolioReturns: [],
      alignedBenchmarkReturns: [],
    };
  }

  // Extract aligned returns
  const alignedPortfolioReturns: number[] = [];
  const alignedBenchmarkReturns: number[] = [];

  for (const timestamp of commonTimestamps) {
    // commonTimestamps is the key intersection of both maps, so both lookups
    // are guaranteed present; the guard replaces a non-null assertion.
    const portfolioRet = portfolioReturnsMap.get(timestamp);
    const benchmarkRet = benchmarkReturnsMap.get(timestamp);
    if (portfolioRet === undefined || benchmarkRet === undefined) {
      continue;
    }

    alignedPortfolioReturns.push(portfolioRet);
    alignedBenchmarkReturns.push(benchmarkRet);
  }

  return { alignedPortfolioReturns, alignedBenchmarkReturns };
}

/**
 * Validates the portfolio history data.
 * @param portfolioHistory - The portfolio history data.
 * @throws Error if validation fails.
 */
function _validatePortfolioHistory(portfolioHistory: PortfolioHistory): void {
  const { equity, timestamp } = portfolioHistory;

  if (!equity || !Array.isArray(equity) || equity.length < 2) {
    throw new Error(
      "Invalid portfolio equity data: Must be an array with at least two elements.",
    );
  }

  if (
    !timestamp ||
    !Array.isArray(timestamp) ||
    timestamp.length !== equity.length
  ) {
    throw new Error(
      "Invalid portfolio timestamp data: Must be an array matching the length of equity.",
    );
  }

  for (let i = 0; i < equity.length; i++) {
    if (!isFinite(equity[i])) {
      throw new Error(
        `Invalid portfolio equity value at index ${i}: ${equity[i]}. Must be a finite number.`,
      );
    }

    if (!isValidUnixTimestamp(timestamp[i])) {
      throw new Error(
        `Invalid portfolio timestamp at index ${i}: ${timestamp[i]}. Must be a valid UNIX timestamp.`,
      );
    }
  }
}

/**
 * Validates the benchmark bars data.
 * @param benchmarkBars - Array of benchmark bar data.
 * @throws Error if validation fails.
 */
function _validateBenchmarkBars(benchmarkBars: BenchmarkBar[]): void {
  if (
    !benchmarkBars ||
    !Array.isArray(benchmarkBars) ||
    benchmarkBars.length < 2
  ) {
    throw new Error(
      "Invalid benchmark bars data: Must be an array with at least two elements.",
    );
  }

  benchmarkBars.forEach((bar, index) => {
    if (!isFinite(bar.c)) {
      throw new Error(
        `Invalid benchmark closing price at index ${index}: ${bar.c}. Must be a finite number.`,
      );
    }

    if (!isValidUnixTimestamp(bar.t)) {
      throw new Error(
        `Invalid benchmark timestamp at index ${index}: ${bar.t}. Must be a valid UNIX timestamp.`,
      );
    }
  });
}

/**
 * Checks if a number is a valid UNIX timestamp in milliseconds.
 * @param timestamp - The timestamp to validate.
 * @returns Boolean indicating validity.
 */
function isValidUnixTimestamp(timestamp: number): boolean {
  // UNIX timestamps in milliseconds are typically between 0 and some large future number, e.g., 32503680000000 (year 3000)
  return isFinite(timestamp) && timestamp > 0 && timestamp < 32503680000000;
}

/**
 * Calculates the beta of the portfolio compared to a benchmark.
 * @param portfolioReturns - Array of portfolio returns.
 * @param benchmarkReturns - Array of benchmark returns.
 * @returns An object containing beta and intermediate calculations.
 */
export function calculateBetaFromReturns(
  portfolioReturns: number[],
  benchmarkReturns: number[],
): CalculateBetaResult {
  const n = portfolioReturns.length;
  if (n === 0) {
    getLogger().warn("No returns to calculate beta.");
    return {
      beta: 0,
      covariance: 0,
      variance: 0,
      averagePortfolioReturn: 0,
      averageBenchmarkReturn: 0,
    };
  }

  // Calculate average returns
  const averagePortfolioReturn =
    portfolioReturns.reduce((sum, ret) => sum + ret, 0) / n;
  const averageBenchmarkReturn =
    benchmarkReturns.reduce((sum, ret) => sum + ret, 0) / n;

  // Calculate covariance and variance
  let covariance = 0;
  let variance = 0;

  for (let i = 0; i < n; i++) {
    const portfolioDiff = portfolioReturns[i] - averagePortfolioReturn;
    const benchmarkDiff = benchmarkReturns[i] - averageBenchmarkReturn;
    covariance += portfolioDiff * benchmarkDiff;
    variance += benchmarkDiff ** 2;
  }

  // Use sample (Bessel-corrected) estimators — divide by (n - 1), not n.
  // For n === 1 there is no degrees-of-freedom left; treat as zero variance
  // so beta falls through to the zero-variance guard below.
  const denom = n > 1 ? n - 1 : 1;
  covariance /= denom;
  variance /= denom;

  // Handle zero (or numerically-degenerate) variance. A constant benchmark
  // series can still produce a tiny nonzero variance because the computed
  // mean differs from the constant by an ulp; dividing covariance by that
  // rounding noise yields a meaningless beta. Treat any variance at or
  // below the summation noise floor — (n * eps * |mean|)^2, the square of
  // the worst-case naive-summation error — as zero. When the mean is
  // exactly 0 this reduces to the exact zero check.
  const varianceNoiseFloor =
    (n * Number.EPSILON * Math.abs(averageBenchmarkReturn)) ** 2;
  if (variance <= varianceNoiseFloor) {
    getLogger().warn(
      "Benchmark variance is zero or below the floating-point noise floor. Setting beta to 0.",
    );
    return {
      beta: 0,
      covariance,
      variance,
      averagePortfolioReturn,
      averageBenchmarkReturn,
    };
  }

  const beta = covariance / variance;

  return {
    beta,
    covariance,
    variance,
    averagePortfolioReturn,
    averageBenchmarkReturn,
  };
}

/**
 * Calculates the information ratio of the portfolio compared to a benchmark.
 * @param portfolioHistory - The portfolio history data.
 * @param benchmarkBars - The historical price data of the benchmark.
 * @returns Information ratio as a formatted string.
 */
export async function calculateInformationRatio(
  portfolioHistory: PortfolioHistoryResponse,
  benchmarkBars: BenchmarkBar[],
): Promise<string> {
  const portfolioEquity = portfolioHistory.equity;
  let portfolioTimestamps = portfolioHistory.timestamp;

  const benchmarkPrices = benchmarkBars.map((bar) => bar.c);
  let benchmarkTimestamps = benchmarkBars.map((bar) => bar.t);

  if (!portfolioEquity || portfolioEquity.length < 2) {
    getLogger().warn("No portfolio equity data available.");
    return "N/A";
  }

  // **Convert portfolio timestamps from Unix seconds to Unix milliseconds**
  portfolioTimestamps = portfolioTimestamps.map(
    (timestamp: number) => timestamp * 1000,
  );

  // **Normalize portfolio timestamps to midnight UTC**
  portfolioTimestamps = portfolioTimestamps.map((timestamp: number) =>
    getMidnightTimestamp(timestamp),
  );

  // **Convert benchmark timestamps from Unix seconds to Unix milliseconds**
  benchmarkTimestamps = benchmarkTimestamps.map(
    (timestamp: number) => timestamp * 1000,
  );

  // **Normalize benchmark timestamps to midnight UTC**
  benchmarkTimestamps = benchmarkTimestamps.map((timestamp: number) =>
    getMidnightTimestamp(timestamp),
  );

  // Calculate daily returns with timestamps
  const portfolioReturnsWithDates = calculateDailyReturnsWithTimestamps(
    portfolioEquity,
    portfolioTimestamps,
  );
  const benchmarkReturnsWithDates = calculateDailyReturnsWithTimestamps(
    benchmarkPrices,
    benchmarkTimestamps,
  );

  // Align returns by timestamp
  const portfolioReturnsMap = new Map<number, number>();
  portfolioReturnsWithDates.forEach(({ timestamp, return: ret }) => {
    if (isFinite(ret)) {
      portfolioReturnsMap.set(timestamp, ret);
    }
  });

  const benchmarkReturnsMap = new Map<number, number>();
  benchmarkReturnsWithDates.forEach(({ timestamp, return: ret }) => {
    if (isFinite(ret)) {
      benchmarkReturnsMap.set(timestamp, ret);
    }
  });

  // Find common timestamps
  const commonTimestamps = [...portfolioReturnsMap.keys()].filter((timestamp) =>
    benchmarkReturnsMap.has(timestamp),
  );

  if (commonTimestamps.length < 2) {
    getLogger().warn(
      "Not enough overlapping data to calculate information ratio.",
    );
    return "N/A";
  }

  // Extract aligned returns
  const activeReturns: number[] = [];

  for (const timestamp of commonTimestamps) {
    // commonTimestamps is the key intersection of both maps, so both lookups
    // are guaranteed present; the guard replaces a non-null assertion.
    const portfolioRet = portfolioReturnsMap.get(timestamp);
    const benchmarkRet = benchmarkReturnsMap.get(timestamp);
    if (portfolioRet === undefined || benchmarkRet === undefined) {
      continue;
    }

    activeReturns.push(portfolioRet - benchmarkRet);
  }

  const n = activeReturns.length;

  // Calculate average active return
  const avgActiveReturn = activeReturns.reduce((sum, ret) => sum + ret, 0) / n;

  // Calculate tracking error (standard deviation of active returns)
  const squaredDiffs = activeReturns.map((ret) =>
    Math.pow(ret - avgActiveReturn, 2),
  );
  const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / (n - 1);
  const trackingError = Math.sqrt(variance);

  // Check for zero tracking error
  if (!isFinite(trackingError) || trackingError === 0) {
    getLogger().warn(
      "Tracking error is zero or non-finite, cannot calculate information ratio.",
    );
    return "N/A";
  }

  // Calculate information ratio
  const informationRatio = avgActiveReturn / trackingError;

  if (!isFinite(informationRatio)) {
    getLogger().warn(
      "Information ratio calculation resulted in a non-finite number.",
    );
    return "N/A";
  }

  return informationRatio.toFixed(4);
}

/**
 * Maps a portfolio-history timeframe token to the Alpaca market-data
 * {@link TimeFrame} accepted by the historical-bars endpoint. Benchmark
 * comparison is daily by default when no timeframe is supplied.
 * @param timeframe - The portfolio-history timeframe token.
 * @returns The equivalent Alpaca market-data timeframe.
 */
function toAlpacaTimeFrame(
  timeframe: PortfolioHistoryParams["timeframe"],
): TimeFrame {
  switch (timeframe) {
    case "1Min":
      return "1Min";
    case "5Min":
      return "5Min";
    case "15Min":
      return "15Min";
    case "1H":
      return "1Hour";
    case "1D":
      return "1Day";
    default:
      return "1Day";
  }
}

/** Milliseconds per second, for RFC-3339 → Unix-second conversion. */
const MS_PER_SECOND = 1000;

/**
 * Fetches benchmark OHLCV bars from the wrapped Alpaca market-data vendor and
 * maps them into {@link BenchmarkBar}s (Unix-second timestamp + close price)
 * expected by the alpha/beta/information-ratio calculators.
 * @param request - Benchmark symbol, RFC-3339 start/end, and timeframe token.
 * @returns The benchmark bars, sorted ascending by time; empty if none.
 */
export async function fetchBenchmarkBars(request: {
  symbol: string;
  start: string;
  end: string;
  timeframe: PortfolioHistoryParams["timeframe"];
}): Promise<BenchmarkBar[]> {
  const { symbol, start, end, timeframe } = request;

  const response = await marketDataAPI.getHistoricalBars({
    symbols: [symbol],
    timeframe: toAlpacaTimeFrame(timeframe),
    start,
    end,
    sort: "asc",
  });

  const bars = response.bars[symbol];
  if (!Array.isArray(bars) || bars.length === 0) {
    return [];
  }

  return bars
    .map((bar) => ({
      t: Math.floor(new Date(bar.t).getTime() / MS_PER_SECOND),
      c: bar.c,
    }))
    .filter((bar) => Number.isFinite(bar.t) && Number.isFinite(bar.c));
}

/**
 * Fetches performance metrics for a given Alpaca account.
 * @param params - The parameters for fetching performance metrics.
 * @param client - The Apollo client instance.
 * @param accountId - The ID of the Alpaca account.
 * @param alpacaAccount - The Alpaca account object.
 * @returns A promise that resolves to an object containing various performance metrics.
 * @throws Will throw an error if required parameters are missing or if fetching fails.
 */
export async function fetchPerformanceMetrics({
  params,
  client,
  accountId,
  alpacaAccount,
}: FetchPerformanceMetricsProps): Promise<PerformanceMetrics> {
  // Default response for error cases
  const defaultMetrics: PerformanceMetrics = {
    totalReturnYTD: "N/A",
    alpha: "N/A",
    beta: "N/A",
    alphaAnnualized: "N/A",
    informationRatio: "N/A",
    riskAdjustedReturn: "N/A",
    liquidityRatio: "N/A",
    expenseRatio: "N/A",
    dividendYield: "N/A",
    maxDrawdown: "N/A",
  };

  try {
    // Validate required parameters
    if (!params) {
      throw new Error("Missing required parameters");
    }

    if (!params.timeframe || !params.period) {
      throw new Error("Missing required timeframe or period parameters");
    }

    // Obtain Alpaca account
    let alpacaAccountObj = alpacaAccount ? alpacaAccount : null;

    if (!alpacaAccountObj && accountId) {
      try {
        // Use provided client or get the shared client
        const apolloClient = client || (await getSharedApolloClient());

        alpacaAccountObj = (await adaptic.alpacaAccount.get(
          {
            id: accountId,
          } as types.AlpacaAccount,
          apolloClient,
        )) as types.AlpacaAccount;
      } catch (error) {
        getLogger().error(
          "[fetchPerformanceMetrics] Error fetching Alpaca account:",
          error,
        );
        throw new Error("Failed to retrieve Alpaca account details");
      }
    }

    // Validate Alpaca account
    if (
      !alpacaAccountObj ||
      !alpacaAccountObj.APIKey ||
      !alpacaAccountObj.APISecret
    ) {
      throw new Error("Alpaca account not found or credentials missing");
    }

    // Fetch portfolio history with structured error handling
    let portfolioHistory;
    try {
      portfolioHistory = await fetchPortfolioHistory({
        params: params as PortfolioHistoryParams,
        alpacaAccount: alpacaAccountObj as types.AlpacaAccount,
      });
    } catch (error) {
      getLogger().error(
        "[fetchPerformanceMetrics] Error fetching portfolio history:",
        error,
      );
      throw new Error("Failed to retrieve portfolio history data");
    }

    // Fetch benchmark data directly from the wrapped Alpaca market-data vendor.
    // (Previously this hit a relative "/api/market-data/historical-prices"
    // Next.js route that only resolves in a browser; in a Node/engine runtime
    // the relative fetch always threw, silently zeroing out alpha/beta/IR.)
    const benchmarkSymbol = "SPY";
    let benchmarkBars: BenchmarkBar[] = [];

    try {
      const { start, end } = getStartAndEndTimestamps({
        timezone: "America/New_York",
        period:
          params?.period === "YTD" || params?.period === "1A"
            ? "1Y"
            : params?.period
              ? (params?.period as Period)
              : "1Y",
        outputFormat: "iso",
        intraday_reporting: params?.intraday_reporting as IntradayReporting,
      });

      benchmarkBars = await fetchBenchmarkBars({
        symbol: benchmarkSymbol,
        start: String(start),
        end: String(end),
        timeframe: params.timeframe,
      });

      if (benchmarkBars.length === 0) {
        throw new Error("Received empty or invalid benchmark data");
      }
    } catch (error) {
      getLogger().error(
        "[fetchPerformanceMetrics] Error fetching benchmark data:",
        error,
      );
      // Continue with partial metrics calculation if possible
    }

    // Calculate metrics in parallel for performance
    const metrics = await Promise.allSettled([
      calculateTotalReturnYTD(portfolioHistory),
      calculateAlphaAndBeta(portfolioHistory, benchmarkBars),
      calculateInformationRatio(portfolioHistory, benchmarkBars),
      calculateRiskAdjustedReturn(portfolioHistory),
      calculateLiquidityRatio({
        alpacaAccount: alpacaAccountObj as types.AlpacaAccount,
      }),
      calculateExpenseRatio({
        alpacaAccount: alpacaAccountObj as types.AlpacaAccount,
      }),
      getDividendYield(),
      Promise.resolve(calculateMaxDrawdown(portfolioHistory.equity)),
    ]);

    // Extract results with error handling for each metric
    const result: PerformanceMetrics = { ...defaultMetrics };

    if (metrics[0].status === "fulfilled")
      result.totalReturnYTD = metrics[0].value;
    if (metrics[1].status === "fulfilled") {
      result.alpha = metrics[1].value.alpha;
      result.beta = metrics[1].value.beta;
      result.alphaAnnualized = metrics[1].value.alphaAnnualized;
    }
    if (metrics[2].status === "fulfilled")
      result.informationRatio = metrics[2].value;
    if (metrics[3].status === "fulfilled")
      result.riskAdjustedReturn = metrics[3].value;
    if (metrics[4].status === "fulfilled")
      result.liquidityRatio = metrics[4].value;
    if (metrics[5].status === "fulfilled")
      result.expenseRatio = metrics[5].value;
    if (metrics[6].status === "fulfilled")
      result.dividendYield = metrics[6].value;
    if (metrics[7].status === "fulfilled")
      result.maxDrawdown = metrics[7].value;

    return result;
  } catch (error) {
    getLogger().error("[fetchPerformanceMetrics] Error:", error);
    return defaultMetrics;
  }
}
