// metric-calcs.ts
import { getLogger } from './logger';

import { Bar, BenchmarkBar } from "./types/alpaca-types";
import { computeTotalFees } from "./price-utils";
import { normalizeDate } from "./time-utils";
import { types } from "@adaptic/backend-legacy";
import { CalculateBetaResult, TradeMetrics } from "./types";
/**
 * Calculates daily returns from an array of closing prices
 * @param prices - Array of closing prices (numbers)
 * @returns Array of daily returns in decimal form (e.g. 0.05 for 5% return)
 * @example
 * const prices = [100, 105, 102, 110];
 * const returns = calculateDailyReturns(prices); // [0.05, -0.02857, 0.07843]
 */
function calculateDailyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const current = prices[i];
    if (isFinite(prev) && isFinite(current) && prev !== 0) {
      const dailyReturn = (current - prev) / prev;
      returns.push(dailyReturn);
    }
  }
  return returns;
}

/**
 * Aligns trade and benchmark returns by matching dates
 * @param tradeBars - Array of Bar objects containing trade price data
 * @param benchmarkBars - Array of BenchmarkBar objects containing benchmark price data
 * @returns Object containing aligned arrays of trade and benchmark returns
 * @example
 * const tradeBars = [{ c: 100, t: "2023-01-01T00:00:00Z" }, { c: 105, t: "2023-01-02T00:00:00Z" }];
 * const benchmarkBars = [{ c: 200, t: 1672531200 }, { c: 210, t: 1672617600 }];
 * const aligned = alignReturns(tradeBars, benchmarkBars);
 * // aligned = { alignedTradeReturns: [0.05], alignedBenchmarkReturns: [0.05] }
 * @throws Will log warnings if there are no matching dates between trade and benchmark data
 */
function alignReturns(tradeBars: Bar[], benchmarkBars: BenchmarkBar[]): {
  alignedTradeReturns: number[];
  alignedBenchmarkReturns: number[];
  alignedDates: string[];
} {
  // Normalize all dates to midnight UTC for consistent comparison
  const normalizeTimestamp = (timestamp: number | string): number => {
    let date: Date;

    if (typeof timestamp === 'string') {
      // Handle RFC-3339 format strings
      date = new Date(timestamp);
    } else {
      // Handle Unix timestamps (could be in seconds or milliseconds)
      date = new Date(timestamp * (timestamp < 10000000000 ? 1000 : 1));
    }

    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  };

  // Create maps with normalized dates as keys
  const tradeMap = new Map<number, { return: number, originalDate: string }>();
  const benchmarkMap = new Map<number, { return: number, originalDate: string }>();

  // Process trade data
  for (let i = 1; i < tradeBars.length; i++) {
    const prevBar = tradeBars[i - 1];
    const currBar = tradeBars[i];

    if (isFinite(prevBar.c) && isFinite(currBar.c) && prevBar.c !== 0) {
      const dailyReturn = (currBar.c - prevBar.c) / prevBar.c;
      const normalizedDate = normalizeTimestamp(currBar.t);
      const originalDate = typeof currBar.t === 'string'
        ? currBar.t
        : new Date(currBar.t * (currBar.t < 10000000000 ? 1000 : 1)).toISOString();
      tradeMap.set(normalizedDate, { return: dailyReturn, originalDate });
    }
  }

  // Process benchmark data
  for (let i = 1; i < benchmarkBars.length; i++) {
    const prevBar = benchmarkBars[i - 1];
    const currBar = benchmarkBars[i];

    if (isFinite(prevBar.c) && isFinite(currBar.c) && prevBar.c !== 0) {
      const dailyReturn = (currBar.c - prevBar.c) / prevBar.c;
      const normalizedDate = normalizeTimestamp(currBar.t);
      const originalDate = typeof currBar.t === 'string'
        ? currBar.t
        : new Date(currBar.t * (currBar.t < 10000000000 ? 1000 : 1)).toISOString();
      benchmarkMap.set(normalizedDate, { return: dailyReturn, originalDate });
    }
  }

  // Find common dates between datasets
  const commonDates = [...tradeMap.keys()].filter(date => benchmarkMap.has(date))
    .sort((a, b) => a - b);  // Ensure chronological order

  if (commonDates.length === 0) {
    getLogger().warn('No common dates found between trade and benchmark data');
    return { alignedTradeReturns: [], alignedBenchmarkReturns: [], alignedDates: [] };
  }

  // Extract aligned returns
  const alignedTradeReturns: number[] = [];
  const alignedBenchmarkReturns: number[] = [];
  const alignedDates: string[] = [];

  commonDates.forEach(date => {
    const tradeData = tradeMap.get(date)!;
    const benchmarkData = benchmarkMap.get(date)!;

    alignedTradeReturns.push(tradeData.return);
    alignedBenchmarkReturns.push(benchmarkData.return);
    alignedDates.push(tradeData.originalDate);
  });

  return { alignedTradeReturns, alignedBenchmarkReturns, alignedDates };
}

/*
* Calculate Beta from Returns
* @param portfolioReturns - Array of portfolio returns
* @param benchmarkReturns - Array of benchmark returns
* @returns Object containing beta, covariance, variance, and average returns
* @example
* const portfolioReturns = [0.05, -0.02, 0.03];
* const benchmarkReturns = [0.03, -0.01, 0.02];
* const beta = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);
* // beta = { beta: 1.5, covariance: 0.0005, variance: 0.0003, averagePortfolioReturn: 0.02, averageBenchmarkReturn: 0.02 }
* @throws Will log warnings if input data is invalid or insufficient
* @throws Will log warnings if benchmark variance is effectively zero
* @throws Will log warnings if beta calculation results in a non-finite value
* @throws Will log warnings if there are not enough valid data points for calculation
* @throws Will log warnings if benchmark variance is zero or non-finite
*/

export function calculateBetaFromReturns(portfolioReturns: number[], benchmarkReturns: number[]): CalculateBetaResult {
  // Input validation
  if (!Array.isArray(portfolioReturns) || !Array.isArray(benchmarkReturns) ||
    portfolioReturns.length !== benchmarkReturns.length || portfolioReturns.length < 2) {
    getLogger().warn('Invalid or insufficient return data for beta calculation');
    return {
      beta: 0,
      covariance: 0,
      variance: 0,
      averagePortfolioReturn: 0,
      averageBenchmarkReturn: 0,
    };
  }

  // Filter out any non-finite values before calculations
  const validIndices = [...Array(portfolioReturns.length).keys()].filter(
    i => isFinite(portfolioReturns[i]) && isFinite(benchmarkReturns[i])
  );

  if (validIndices.length < 2) {
    getLogger().warn('Not enough valid data points for beta calculation');
    return {
      beta: 0,
      covariance: 0,
      variance: 0,
      averagePortfolioReturn: 0,
      averageBenchmarkReturn: 0,
    };
  }

  // Use validated indices only
  const validPortfolioReturns = validIndices.map(i => portfolioReturns[i]);
  const validBenchmarkReturns = validIndices.map(i => benchmarkReturns[i]);

  // Calculate means
  const n = validIndices.length;
  const averagePortfolioReturn = validPortfolioReturns.reduce((sum, ret) => sum + ret, 0) / n;
  const averageBenchmarkReturn = validBenchmarkReturns.reduce((sum, ret) => sum + ret, 0) / n;

  // Calculate covariance and variance with Welford's online algorithm for numerical stability
  let covariance = 0;
  let variance = 0;
  let meanDeltaP = 0;
  let meanDeltaB = 0;

  for (let i = 0; i < n; i++) {
    const portfolioDiff = validPortfolioReturns[i] - averagePortfolioReturn;
    const benchmarkDiff = validBenchmarkReturns[i] - averageBenchmarkReturn;

    // Numerically stable covariance calculation
    meanDeltaP += (portfolioDiff - meanDeltaP) / (i + 1);
    meanDeltaB += (benchmarkDiff - meanDeltaB) / (i + 1);
    covariance += portfolioDiff * benchmarkDiff;
    variance += benchmarkDiff * benchmarkDiff;
  }

  // Finalize calculations
  covariance /= n;
  variance /= n;

  // Handle zero variance case
  if (Math.abs(variance) < 1e-10) {
    getLogger().warn('Benchmark variance is effectively zero. Setting beta to 0.');
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
 * Calculates position-aware returns taking into account position side
 * @param prices - Array of prices
 * @param isShort - Whether the position is a short position
 * @returns Array of position-appropriate returns
 */
function calculatePositionAwareReturns(prices: number[], isShort: boolean): number[] {
  const returns: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const current = prices[i];

    if (isFinite(prev) && isFinite(current) && prev !== 0) {
      // For shorts, we invert the return calculation
      const rawReturn = (current - prev) / prev;
      const positionReturn = isShort ? -rawReturn : rawReturn;
      returns.push(positionReturn);
    }
  }

  return returns;
}

/**
 * Calculates the total return for a position, respecting position direction
 * @param tradeBars - Array of price bars
 * @param isShort - Whether it's a short position
 * @returns Formatted total return string
 */
async function calculateProfitLoss(tradeBars: Bar[], isShort: boolean): Promise<string> {
  if (!tradeBars || tradeBars.length < 2) {
    getLogger().warn("Not enough data to calculate total return.");
    return "N/A";
  }

  const startPrice = tradeBars[0].c;
  const endPrice = tradeBars[tradeBars.length - 1].c;

  if (startPrice <= 0 || isNaN(startPrice) || isNaN(endPrice)) {
    getLogger().warn("Invalid price values for total return calculation.");
    return "N/A";
  }

  // For short positions, gains are made when price decreases
  let totalReturn: number;
  if (isShort) {
    totalReturn = ((startPrice - endPrice) / startPrice) * 100;
  } else {
    totalReturn = ((endPrice - startPrice) / startPrice) * 100;
  }

  return `${totalReturn.toFixed(2)}%`;
}

// Calculate Risk-Adjusted Return (Sharpe Ratio)
async function calculateRiskAdjustedReturn(tradeBars: Bar[]): Promise<string> {
  const returns = calculateDailyReturns(tradeBars.map(bar => bar.c));

  if (returns.length < 2) {
    getLogger().warn("No sufficient returns data to calculate Sharpe Ratio.");
    return "N/A";
  }

  // Calculate average daily return
  const avgDailyReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;

  // Calculate standard deviation of daily returns
  const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgDailyReturn, 2), 0) / (returns.length - 1);
  const stdDevDaily = Math.sqrt(variance);

  // Annualize average return and standard deviation
  const tradingDaysPerYear = 252;
  const avgAnnualReturn = avgDailyReturn * tradingDaysPerYear;
  const stdDevAnnual = stdDevDaily * Math.sqrt(tradingDaysPerYear);

  if (!isFinite(stdDevAnnual) || stdDevAnnual === 0) {
    getLogger().warn("Standard deviation is zero or non-finite, cannot calculate Sharpe ratio.");
    return "N/A";
  }

  // Assume a risk-free rate, e.g., 2%
  const riskFreeRate = 0.02; // Annual risk-free rate (2%)

  // Calculate Sharpe Ratio
  const sharpeRatio = (avgAnnualReturn - riskFreeRate) / stdDevAnnual;

  if (!isFinite(sharpeRatio)) {
    getLogger().warn("Sharpe ratio calculation resulted in a non-finite number.");
    return "N/A";
  }

  return `${sharpeRatio.toFixed(2)}`;
}

/**
 * Calculates alpha and beta with position direction awareness
 * @param tradeBars - Trade price data
 * @param benchmarkBars - Benchmark price data
 * @param isShort - Whether it's a short position
 */
async function calculateAlphaAndBeta(
  tradeBars: Bar[],
  benchmarkBars: BenchmarkBar[],
  isShort: boolean
): Promise<{
  alpha: string;
  alphaAnnualized: string;
  beta: string;
}> {
  // First align the data
  const { alignedTradeReturns: rawTradeReturns, alignedBenchmarkReturns } = alignReturns(tradeBars, benchmarkBars);

  if (rawTradeReturns.length === 0 || alignedBenchmarkReturns.length === 0) {
    getLogger().warn("No overlapping data to calculate Alpha.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A"
    };
  }

  // Adjust trade returns based on position type
  const alignedTradeReturns = isShort
    ? rawTradeReturns.map(ret => -ret)
    : rawTradeReturns;

  // Calculate beta with position-adjusted returns
  const beta = calculateBetaFromReturns(alignedTradeReturns, alignedBenchmarkReturns);

  if (!isFinite(beta.beta)) {
    getLogger().warn("Beta calculation resulted in a non-finite value.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A"
    }
  }

  // For short positions, the interpretation of beta changes
  // A positive beta on a short means the position moves with the market,
  // which is bad for a short. We invert it for consistency.
  const positionAwareBeta = isShort ? -beta.beta : beta.beta;

  const avgTradeReturn = alignedTradeReturns.reduce((sum, ret) => sum + ret, 0) / alignedTradeReturns.length;
  const avgBenchmarkReturn = alignedBenchmarkReturns.reduce((sum, ret) => sum + ret, 0) / alignedBenchmarkReturns.length;

  const riskFreeRateDaily = 0.02 / 252; // Assuming 2% annual risk-free rate

  // Alpha calculation adjusts based on position direction
  const alpha = avgTradeReturn - (riskFreeRateDaily + positionAwareBeta * (avgBenchmarkReturn - riskFreeRateDaily));
  const alphaAnnualized = alpha * 252;

  if (!isFinite(alphaAnnualized)) {
    getLogger().warn("Alpha calculation resulted in a non-finite value.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: positionAwareBeta.toFixed(4),
    }
  }

  return {
    alpha: alpha.toFixed(4),
    alphaAnnualized: alphaAnnualized.toFixed(4),
    beta: positionAwareBeta.toFixed(4),
  };
}

/**
 * Calculate Information Ratio with position type awareness
 */
async function calculateInformationRatio(
  tradeBars: Bar[],
  benchmarkBars: BenchmarkBar[],
  isShort: boolean
): Promise<string> {
  const { alignedTradeReturns: rawTradeReturns, alignedBenchmarkReturns } = alignReturns(tradeBars, benchmarkBars);

  if (rawTradeReturns.length === 0 || alignedBenchmarkReturns.length === 0) {
    getLogger().warn("No overlapping data to calculate Information Ratio.");
    return "N/A";
  }

  // Adjust returns for position type
  const alignedTradeReturns = isShort
    ? rawTradeReturns.map(ret => -ret)
    : rawTradeReturns;

  // For short positions, we invert the active return calculation
  // A short position outperforms when it goes down more than the benchmark goes up
  const activeReturns = isShort
    ? alignedTradeReturns.map((ret, idx) => ret - (-alignedBenchmarkReturns[idx]))
    : alignedTradeReturns.map((ret, idx) => ret - alignedBenchmarkReturns[idx]);

  const avgActiveReturn = activeReturns.reduce((sum, ret) => sum + ret, 0) / activeReturns.length;

  const variance = activeReturns.reduce((sum, ret) => sum + Math.pow(ret - avgActiveReturn, 2), 0) / (activeReturns.length - 1);
  const trackingError = Math.sqrt(variance);

  if (trackingError === 0 || !isFinite(trackingError)) {
    getLogger().warn("Tracking error is zero or non-finite, cannot calculate Information Ratio.");
    return "N/A";
  }

  const informationRatio = avgActiveReturn / trackingError;

  if (!isFinite(informationRatio)) {
    getLogger().warn("Information Ratio calculation resulted in a non-finite value.");
    return "N/A";
  }

  return informationRatio.toFixed(4);
}

/**
 * Calculate max drawdown taking position type into account
 * @param tradeBars - Array of price bars
 * @param isShort - Whether it's a short position
 */
async function calculateMaxDrawdown(tradeBars: Bar[], isShort: boolean): Promise<string> {
  if (!tradeBars || tradeBars.length === 0) {
    getLogger().warn("No trade bars data to calculate Max Drawdown.");
    return "N/A";
  }

  const equity = tradeBars.map(bar => bar.c);

  // For short positions, the drawdown happens when price increases
  // So we invert the prices for calculation purposes
  const positionAwareEquity = isShort
    ? equity.map(value => -value)
    : equity;

  let peak = positionAwareEquity[0];
  let maxDrawdown = 0;

  for (let i = 1; i < positionAwareEquity.length; i++) {
    if (positionAwareEquity[i] > peak) {
      peak = positionAwareEquity[i];
    } else {
      const drawdown = peak <= 0 ? 0 : (peak - positionAwareEquity[i]) / Math.abs(peak);
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  const drawdownPercentage = Math.min(maxDrawdown * 100, 100);
  return `${drawdownPercentage.toFixed(2)}%`;
}

async function calculateExpenseRatio(
  trade: types.Trade,
): Promise<string> {

  const totalFees = await computeTotalFees(trade);

  return totalFees ? `${totalFees.toFixed(2)}%` : "N/A";
}

// Main function to fetch and calculate all trade metrics for one trade object
export default async function fetchTradeMetrics(
  trade: types.Trade,
  tradeBars: Bar[],
  benchmarkBars: BenchmarkBar[],
): Promise<TradeMetrics> {

  const isShort = trade.actions?.find((a) => a.primary)?.type === "SELL" ? true : false;
  // Calculate metrics concurrently
  const [
    totalReturnYTD,
    { alpha, beta, alphaAnnualized },
    informationRatio,
    riskAdjustedReturn,
    expenseRatio,
    maxDrawdown,
  ] = await Promise.all([
    calculateProfitLoss(tradeBars, isShort),
    calculateAlphaAndBeta(tradeBars, benchmarkBars, isShort),
    calculateInformationRatio(tradeBars, benchmarkBars, isShort),
    calculateRiskAdjustedReturn(tradeBars),
    calculateExpenseRatio(trade),
    calculateMaxDrawdown(tradeBars, isShort),
  ]);

  return {
    totalReturnYTD,
    alpha, beta, alphaAnnualized,
    informationRatio,
    riskAdjustedReturn,
    expenseRatio,
    maxDrawdown,
    side: isShort ? 'short' : 'long'
  };
}
