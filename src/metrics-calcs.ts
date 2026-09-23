// metric-calcs.ts
import { getLogger } from "./logger";

import { Bar, BenchmarkBar } from "./types/alpaca-types";
import { computeTotalFees } from "./price-utils";
import { types } from "@adaptic/backend";
import { CalculateBetaResult, TradeMetrics } from "./types";
import {
  availableStatistic,
  sampleCohort,
  unavailableStatistic,
} from "./sample-statistic";
import { getRiskFreeRate } from "./risk-free-rate";
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
function alignReturns(
  tradeBars: Bar[],
  benchmarkBars: BenchmarkBar[],
): {
  alignedTradeReturns: number[];
  alignedBenchmarkReturns: number[];
  alignedDates: string[];
} {
  // Normalize all dates to midnight UTC for consistent comparison
  const normalizeTimestamp = (timestamp: number | string): number => {
    let date: Date;

    if (typeof timestamp === "string") {
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
  const tradeMap = new Map<number, { return: number; originalDate: string }>();
  const benchmarkMap = new Map<
    number,
    { return: number; originalDate: string }
  >();

  // Process trade data
  for (let i = 1; i < tradeBars.length; i++) {
    const prevBar = tradeBars[i - 1];
    const currBar = tradeBars[i];

    if (isFinite(prevBar.c) && isFinite(currBar.c) && prevBar.c !== 0) {
      const dailyReturn = (currBar.c - prevBar.c) / prevBar.c;
      const normalizedDate = normalizeTimestamp(currBar.t);
      const originalDate =
        typeof currBar.t === "string"
          ? currBar.t
          : new Date(
              currBar.t * (currBar.t < 10000000000 ? 1000 : 1),
            ).toISOString();
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
      const originalDate =
        typeof currBar.t === "string"
          ? currBar.t
          : new Date(
              currBar.t * (currBar.t < 10000000000 ? 1000 : 1),
            ).toISOString();
      benchmarkMap.set(normalizedDate, { return: dailyReturn, originalDate });
    }
  }

  // Find common dates between datasets
  const commonDates = [...tradeMap.keys()]
    .filter((date) => benchmarkMap.has(date))
    .sort((a, b) => a - b); // Ensure chronological order

  if (commonDates.length === 0) {
    getLogger().warn("No common dates found between trade and benchmark data");
    return {
      alignedTradeReturns: [],
      alignedBenchmarkReturns: [],
      alignedDates: [],
    };
  }

  // Extract aligned returns
  const alignedTradeReturns: number[] = [];
  const alignedBenchmarkReturns: number[] = [];
  const alignedDates: string[] = [];

  commonDates.forEach((date) => {
    const tradeData = tradeMap.get(date)!;
    const benchmarkData = benchmarkMap.get(date)!;

    alignedTradeReturns.push(tradeData.return);
    alignedBenchmarkReturns.push(benchmarkData.return);
    alignedDates.push(tradeData.originalDate);
  });

  return { alignedTradeReturns, alignedBenchmarkReturns, alignedDates };
}

/**
 * Beta of a portfolio against a benchmark, from paired period returns.
 *
 * Non-finite rows are dropped pairwise — a return that is `NaN` on either leg
 * cannot contribute to a covariance — and the count that survives is reported
 * as the cohort rather than discarded. That reporting is the point: silently
 * computing a beta on the 12 rows that happened to be clean, and returning it
 * with the same shape as a beta over all 900, is how a statistic measured on
 * one population gets applied to another.
 *
 * When beta cannot be computed the result is the unavailable branch, never a
 * numeric stand-in. A beta of `0` asserts that the portfolio does not move with
 * the market, which is a strong and consequential claim; emitting it to mean
 * "we could not tell" makes every alpha derived from it wrong by the whole
 * benchmark term.
 *
 * @param portfolioReturns - Portfolio period returns.
 * @param benchmarkReturns - Benchmark period returns, index-aligned to the portfolio.
 * @returns The beta components with their cohort, or a typed unavailable result.
 * @example
 * const result = calculateBetaFromReturns([0.05, -0.02, 0.03], [0.03, -0.01, 0.02]);
 * if (result.available) {
 *   // result.value.beta, alongside result.sampleCount and result.coverage
 * }
 */
export function calculateBetaFromReturns(
  portfolioReturns: number[],
  benchmarkReturns: number[],
): CalculateBetaResult {
  // A covariance is defined over PAIRS, so the offered cohort is the number of
  // index positions both series can supply. Ragged input is a caller defect
  // rather than a data condition, and it is reported as such instead of being
  // silently truncated to the shorter series.
  if (!Array.isArray(portfolioReturns) || !Array.isArray(benchmarkReturns)) {
    return unavailableStatistic(
      "invalid_input",
      "portfolioReturns and benchmarkReturns must both be arrays",
      sampleCohort(0, 0),
    );
  }
  const requestedCount = portfolioReturns.length;
  if (portfolioReturns.length !== benchmarkReturns.length) {
    return unavailableStatistic(
      "invalid_input",
      `series lengths differ: portfolio ${portfolioReturns.length}, benchmark ${benchmarkReturns.length}`,
      sampleCohort(requestedCount, 0),
    );
  }

  // Pairwise finiteness filter. Both legs must be usable for the pair to
  // contribute; keeping a pair on the strength of one leg would mix a real
  // observation with a fabricated one.
  const validIndices = [...Array(requestedCount).keys()].filter(
    (i) => isFinite(portfolioReturns[i]) && isFinite(benchmarkReturns[i]),
  );
  const cohort = sampleCohort(requestedCount, validIndices.length);

  // Bessel-corrected estimators need at least one degree of freedom, so two
  // usable pairs is the floor below which no sample variance exists.
  const MIN_PAIRS_FOR_SAMPLE_VARIANCE = 2;
  if (validIndices.length < MIN_PAIRS_FOR_SAMPLE_VARIANCE) {
    getLogger().warn(
      `Beta unavailable: ${validIndices.length} usable pairs of ${requestedCount} offered.`,
    );
    return unavailableStatistic(
      validIndices.length === 0 ? "no_usable_samples" : "insufficient_samples",
      `beta needs at least ${MIN_PAIRS_FOR_SAMPLE_VARIANCE} finite pairs; ${validIndices.length} of ${requestedCount} were usable`,
      cohort,
    );
  }

  const validPortfolioReturns = validIndices.map((i) => portfolioReturns[i]);
  const validBenchmarkReturns = validIndices.map((i) => benchmarkReturns[i]);

  const n = validIndices.length;
  const averagePortfolioReturn =
    validPortfolioReturns.reduce((sum, ret) => sum + ret, 0) / n;
  const averageBenchmarkReturn =
    validBenchmarkReturns.reduce((sum, ret) => sum + ret, 0) / n;

  let covariance = 0;
  let variance = 0;

  for (let i = 0; i < n; i++) {
    const portfolioDiff = validPortfolioReturns[i] - averagePortfolioReturn;
    const benchmarkDiff = validBenchmarkReturns[i] - averageBenchmarkReturn;
    covariance += portfolioDiff * benchmarkDiff;
    variance += benchmarkDiff * benchmarkDiff;
  }

  // Sample (Bessel-corrected) estimators — divide by (n - 1), not n. The guard
  // above ensures n >= 2, so (n - 1) is always safe.
  covariance /= n - 1;
  variance /= n - 1;

  // A benchmark that never moved has no variance to regress against, so beta is
  // undefined rather than zero. VARIANCE_NOISE_FLOOR absorbs the case where a
  // constant series still produces a tiny positive variance because the computed
  // mean differs from the constant by a rounding unit.
  const VARIANCE_NOISE_FLOOR = 1e-10;
  if (Math.abs(variance) < VARIANCE_NOISE_FLOOR) {
    getLogger().warn(
      "Beta unavailable: benchmark variance is effectively zero.",
    );
    return unavailableStatistic(
      "degenerate_population",
      `benchmark variance ${variance} is below the noise floor ${VARIANCE_NOISE_FLOOR}; beta is undefined`,
      cohort,
    );
  }

  return availableStatistic(
    {
      beta: covariance / variance,
      covariance,
      variance,
      averagePortfolioReturn,
      averageBenchmarkReturn,
    },
    cohort,
  );
}

/**
 * Calculates position-aware returns taking into account position side
 * @param prices - Array of prices
 * @param isShort - Whether the position is a short position
 * @returns Array of position-appropriate returns
 */
function _calculatePositionAwareReturns(
  prices: number[],
  isShort: boolean,
): number[] {
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
async function calculateProfitLoss(
  tradeBars: Bar[],
  isShort: boolean,
): Promise<string> {
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
  const returns = calculateDailyReturns(tradeBars.map((bar) => bar.c));

  if (returns.length < 2) {
    getLogger().warn("No sufficient returns data to calculate Sharpe Ratio.");
    return "N/A";
  }

  // Calculate average daily return
  const avgDailyReturn =
    returns.reduce((sum, ret) => sum + ret, 0) / returns.length;

  // Calculate standard deviation of daily returns
  const variance =
    returns.reduce((sum, ret) => sum + Math.pow(ret - avgDailyReturn, 2), 0) /
    (returns.length - 1);
  const stdDevDaily = Math.sqrt(variance);

  // Annualize average return and standard deviation
  const tradingDaysPerYear = 252;
  const avgAnnualReturn = avgDailyReturn * tradingDaysPerYear;
  const stdDevAnnual = stdDevDaily * Math.sqrt(tradingDaysPerYear);

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
  isShort: boolean,
): Promise<{
  alpha: string;
  alphaAnnualized: string;
  beta: string;
}> {
  // First align the data
  const { alignedTradeReturns: rawTradeReturns, alignedBenchmarkReturns } =
    alignReturns(tradeBars, benchmarkBars);

  if (rawTradeReturns.length === 0 || alignedBenchmarkReturns.length === 0) {
    getLogger().warn("No overlapping data to calculate Alpha.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }

  // Adjust trade returns based on position type
  const alignedTradeReturns = isShort
    ? rawTradeReturns.map((ret) => -ret)
    : rawTradeReturns;

  // Calculate beta with position-adjusted returns
  const beta = calculateBetaFromReturns(
    alignedTradeReturns,
    alignedBenchmarkReturns,
  );

  // Alpha is the return left over after the benchmark term, so an unknown beta
  // makes alpha unknown too. Substituting any number here — zero most of all —
  // would credit the whole benchmark move to the strategy.
  if (!beta.available) {
    getLogger().warn(
      `Alpha unavailable: beta could not be computed (${beta.reason}: ${beta.detail}).`,
    );
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }
  if (!isFinite(beta.value.beta)) {
    getLogger().warn("Beta calculation resulted in a non-finite value.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: "N/A",
    };
  }

  // For short positions, the interpretation of beta changes
  // A positive beta on a short means the position moves with the market,
  // which is bad for a short. We invert it for consistency.
  const positionAwareBeta = isShort ? -beta.value.beta : beta.value.beta;

  const avgTradeReturn =
    alignedTradeReturns.reduce((sum, ret) => sum + ret, 0) /
    alignedTradeReturns.length;
  const avgBenchmarkReturn =
    alignedBenchmarkReturns.reduce((sum, ret) => sum + ret, 0) /
    alignedBenchmarkReturns.length;

  // Fetch live annualized risk-free rate (3-month T-Bill), cached daily.
  // See src/risk-free-rate.ts for source + fallback behavior.
  const riskFreeRateAnnual = await getRiskFreeRate();
  const riskFreeRateDaily = riskFreeRateAnnual / 252;

  // Alpha calculation adjusts based on position direction
  const alpha =
    avgTradeReturn -
    (riskFreeRateDaily +
      positionAwareBeta * (avgBenchmarkReturn - riskFreeRateDaily));
  const alphaAnnualized = alpha * 252;

  if (!isFinite(alphaAnnualized)) {
    getLogger().warn("Alpha calculation resulted in a non-finite value.");
    return {
      alpha: "N/A",
      alphaAnnualized: "N/A",
      beta: positionAwareBeta.toFixed(4),
    };
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
  isShort: boolean,
): Promise<string> {
  const { alignedTradeReturns: rawTradeReturns, alignedBenchmarkReturns } =
    alignReturns(tradeBars, benchmarkBars);

  if (rawTradeReturns.length === 0 || alignedBenchmarkReturns.length === 0) {
    getLogger().warn("No overlapping data to calculate Information Ratio.");
    return "N/A";
  }

  // Adjust returns for position type
  const alignedTradeReturns = isShort
    ? rawTradeReturns.map((ret) => -ret)
    : rawTradeReturns;

  // For short positions, we invert the active return calculation
  // A short position outperforms when it goes down more than the benchmark goes up
  const activeReturns = isShort
    ? alignedTradeReturns.map((ret, idx) => ret - -alignedBenchmarkReturns[idx])
    : alignedTradeReturns.map((ret, idx) => ret - alignedBenchmarkReturns[idx]);

  const avgActiveReturn =
    activeReturns.reduce((sum, ret) => sum + ret, 0) / activeReturns.length;

  const variance =
    activeReturns.reduce(
      (sum, ret) => sum + Math.pow(ret - avgActiveReturn, 2),
      0,
    ) /
    (activeReturns.length - 1);
  const trackingError = Math.sqrt(variance);

  if (trackingError === 0 || !isFinite(trackingError)) {
    getLogger().warn(
      "Tracking error is zero or non-finite, cannot calculate Information Ratio.",
    );
    return "N/A";
  }

  const informationRatio = avgActiveReturn / trackingError;

  if (!isFinite(informationRatio)) {
    getLogger().warn(
      "Information Ratio calculation resulted in a non-finite value.",
    );
    return "N/A";
  }

  return informationRatio.toFixed(4);
}

/**
 * Calculate max drawdown taking position type into account
 * @param tradeBars - Array of price bars
 * @param isShort - Whether it's a short position
 */
export async function calculateMaxDrawdown(
  tradeBars: Bar[],
  isShort: boolean,
): Promise<string> {
  if (!tradeBars || tradeBars.length === 0) {
    getLogger().warn("No trade bars data to calculate Max Drawdown.");
    return "N/A";
  }

  const equity = tradeBars.map((bar) => bar.c);

  // For short positions, the drawdown happens when price increases
  // So we invert the prices for calculation purposes
  const positionAwareEquity = isShort ? equity.map((value) => -value) : equity;

  let peak = positionAwareEquity[0];
  let maxDrawdown = 0;

  for (let i = 1; i < positionAwareEquity.length; i++) {
    if (positionAwareEquity[i] > peak) {
      peak = positionAwareEquity[i];
    } else {
      // The short branch negates equity, so its peak is legitimately negative.
      // Scale the decline by the peak's magnitude — a sign test on the peak
      // would discard every drawdown on one side of the book.
      const denominator = Math.abs(peak);
      const drawdown =
        denominator === 0
          ? 0
          : (peak - positionAwareEquity[i]) / denominator;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }

  const drawdownPercentage = Math.min(maxDrawdown * 100, 100);
  return `${drawdownPercentage.toFixed(2)}%`;
}

async function calculateExpenseRatio(trade: types.Trade): Promise<string> {
  const totalFees = await computeTotalFees(trade);

  return totalFees ? `${totalFees.toFixed(2)}%` : "N/A";
}

/**
 * Resolves whether a trade is short from its primary action.
 *
 * Only an outright BUY or SELL fixes whether the position's P&L runs with or
 * against the price series. Option legs, exercises, cancels, adjustments and
 * hedges do not, and `trade.actions` itself is curated by backend-legacy
 * selection-set directives, so its absence is routine. Every one of those
 * cases leaves the direction genuinely unknown, and unknown is returned as
 * such — inferring a side would silently invert every direction-aware metric
 * computed from it.
 *
 * @param trade - Trade whose direction is being resolved
 * @returns `true` for a short, `false` for a long, `null` when unresolvable
 */
function resolveIsShort(trade: types.Trade): boolean | null {
  const primaryAction = trade.actions?.find((action) => action.primary);

  if (!primaryAction) {
    getLogger().warn(
      `Trade ${trade.id} has no primary action; position direction is unresolved.`,
    );
    return null;
  }

  switch (primaryAction.type) {
    case "SELL":
      return true;
    case "BUY":
      return false;
    default:
      getLogger().warn(
        `Trade ${trade.id} primary action type "${primaryAction.type}" does not determine a long/short direction.`,
      );
      return null;
  }
}

// Main function to fetch and calculate all trade metrics for one trade object
export default async function fetchTradeMetrics(
  trade: types.Trade,
  tradeBars: Bar[],
  benchmarkBars: BenchmarkBar[],
): Promise<TradeMetrics> {
  const isShort = resolveIsShort(trade);

  // The Sharpe ratio and the expense ratio do not invert on direction, so they
  // are started immediately and stay concurrent with everything below.
  const riskAdjustedReturnPromise = calculateRiskAdjustedReturn(tradeBars);
  const expenseRatioPromise = calculateExpenseRatio(trade);

  if (isShort === null) {
    // Every other metric inverts on direction. With the direction unknown
    // there is no value to report — only a sign-ambiguous one — so they are
    // reported as unavailable rather than resolved by assumption.
    const [riskAdjustedReturn, expenseRatio] = await Promise.all([
      riskAdjustedReturnPromise,
      expenseRatioPromise,
    ]);

    return {
      totalReturnYTD: "N/A",
      alpha: "N/A",
      beta: "N/A",
      alphaAnnualized: "N/A",
      informationRatio: "N/A",
      riskAdjustedReturn,
      expenseRatio,
      maxDrawdown: "N/A",
      side: "N/A",
    };
  }

  // Calculate metrics concurrently
  const [
    totalReturnYTD,
    { alpha, beta, alphaAnnualized },
    informationRatio,
    maxDrawdown,
    riskAdjustedReturn,
    expenseRatio,
  ] = await Promise.all([
    calculateProfitLoss(tradeBars, isShort),
    calculateAlphaAndBeta(tradeBars, benchmarkBars, isShort),
    calculateInformationRatio(tradeBars, benchmarkBars, isShort),
    calculateMaxDrawdown(tradeBars, isShort),
    riskAdjustedReturnPromise,
    expenseRatioPromise,
  ]);

  return {
    totalReturnYTD,
    alpha,
    beta,
    alphaAnnualized,
    informationRatio,
    riskAdjustedReturn,
    expenseRatio,
    maxDrawdown,
    side: isShort ? "short" : "long",
  };
}
