/**
 * Per-strategy rolling metrics and backtest-divergence z-score.
 *
 * Conventions:
 * - tradePnls / tradeReturns is an array of per-trade realised P&L or return
 *   (positive = win, negative = loss, zero = breakeven).
 * - Every statistic here is a ratio or a mean over a WINDOW, so every one is
 *   returned as a {@link SampleStatistic}: the value cannot be read without the
 *   `sampleCount` it was taken over and the `coverage` of the window that was
 *   asked for. A hit-rate is a different claim on 5 trades than on 500, and a
 *   window that could only be half-filled is a different cohort from a full
 *   one — a caller holding a bare number can tell neither apart.
 * - A window that cannot support the statistic returns the unavailable branch
 *   with a reason, never a numeric stand-in. Zero is a measurement.
 * - All public functions reject non-finite inputs (NaN, Infinity) by throwing.
 *   Callers must pre-validate or filter their inputs.
 */

import { calculateSortino } from "./risk-metrics";
import {
  availableStatistic,
  sampleCohort,
  unavailableStatistic,
  type SampleStatistic,
} from "./sample-statistic";

function assertWindowSize(name: string, windowSize: number): void {
  if (windowSize < 1 || !Number.isInteger(windowSize)) {
    throw new Error(`${name}: windowSize must be a positive integer`);
  }
}

function assertFiniteArray(name: string, arr: number[]): void {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) {
      throw new Error(`${name}: input contains non-finite value at index ${i}: ${arr[i]}`);
    }
  }
}

/**
 * Report a window that holds fewer trades than it asked for.
 *
 * Shared so every rolling function describes a short window the same way — the
 * cohort is `(requested = windowSize, sampled = what exists)`, which is the
 * pair a caller needs to distinguish a warm-up from a data gap.
 *
 * @param name - The calling function, for the detail string.
 * @param available - Trades actually present.
 * @param windowSize - Trades the window asked for.
 * @returns The unavailable branch describing the short window.
 */
function insufficientWindow(
  name: string,
  available: number,
  windowSize: number,
): SampleStatistic<never> {
  return unavailableStatistic(
    "insufficient_samples",
    `${name}: window of ${windowSize} requested, only ${available} trades available`,
    sampleCohort(windowSize, available),
  );
}

/**
 * Rolling expectancy: mean P&L over the most-recent `windowSize` trades.
 *
 * @param tradePnls - Array of per-trade realised P&L values.
 * @param windowSize - Number of most-recent trades to include. Must be a positive integer.
 * @returns Mean P&L of the last `windowSize` trades with its cohort, or a typed
 *          unavailable result when fewer than `windowSize` trades exist.
 * @throws When `windowSize` is not a positive integer or any input is non-finite.
 */
export function calculateRollingExpectancy(
  tradePnls: number[],
  windowSize: number,
): SampleStatistic<number> {
  assertWindowSize("calculateRollingExpectancy", windowSize);
  if (tradePnls.length < windowSize) {
    return insufficientWindow(
      "calculateRollingExpectancy",
      tradePnls.length,
      windowSize,
    );
  }
  assertFiniteArray("calculateRollingExpectancy", tradePnls);
  const slice = tradePnls.slice(-windowSize);
  return availableStatistic(
    slice.reduce((a, b) => a + b, 0) / windowSize,
    sampleCohort(windowSize, windowSize),
  );
}

/**
 * Rolling hit-rate: fraction of strictly-positive P&L trades in the most-recent
 * `windowSize` trades. Zero P&L counts as non-win.
 *
 * @param tradePnls - Array of per-trade realised P&L values.
 * @param windowSize - Number of most-recent trades to include. Must be a positive integer.
 * @returns Fraction of winning trades in the window with its cohort, or a typed
 *          unavailable result when fewer than `windowSize` trades exist.
 * @throws When `windowSize` is not a positive integer or any input is non-finite.
 */
export function calculateRollingHitRate(
  tradePnls: number[],
  windowSize: number,
): SampleStatistic<number> {
  assertWindowSize("calculateRollingHitRate", windowSize);
  if (tradePnls.length < windowSize) {
    return insufficientWindow(
      "calculateRollingHitRate",
      tradePnls.length,
      windowSize,
    );
  }
  assertFiniteArray("calculateRollingHitRate", tradePnls);
  const slice = tradePnls.slice(-windowSize);
  const wins = slice.filter((p) => p > 0).length;
  return availableStatistic(
    wins / windowSize,
    sampleCohort(windowSize, windowSize),
  );
}

/**
 * Rolling profit factor: sum(wins) / |sum(losses)| over the most-recent `windowSize` trades.
 *
 * Edge cases:
 * - no losses and at least one win → +Infinity (an unbounded but real ratio)
 * - no wins and no losses (all zeros) → unavailable: `0 / 0` is undefined, and a
 *   window of breakeven trades has no profit factor rather than a profit factor
 *   of zero
 * - fewer than windowSize trades → unavailable
 *
 * @param tradePnls - Array of per-trade realised P&L values.
 * @param windowSize - Number of most-recent trades to include. Must be a positive integer.
 * @returns Profit factor for the rolling window with its cohort, or a typed
 *          unavailable result.
 * @throws When `windowSize` is not a positive integer or any input is non-finite.
 */
export function calculateRollingProfitFactor(
  tradePnls: number[],
  windowSize: number,
): SampleStatistic<number> {
  assertWindowSize("calculateRollingProfitFactor", windowSize);
  if (tradePnls.length < windowSize) {
    return insufficientWindow(
      "calculateRollingProfitFactor",
      tradePnls.length,
      windowSize,
    );
  }
  assertFiniteArray("calculateRollingProfitFactor", tradePnls);
  const cohort = sampleCohort(windowSize, windowSize);
  const slice = tradePnls.slice(-windowSize);
  const wins = slice.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const losses = slice.filter((p) => p < 0).reduce((a, b) => a + Math.abs(b), 0);
  if (losses === 0) {
    if (wins > 0) {
      return availableStatistic(Number.POSITIVE_INFINITY, cohort);
    }
    return unavailableStatistic(
      "degenerate_population",
      `calculateRollingProfitFactor: window of ${windowSize} contains neither wins nor losses; the ratio is undefined`,
      cohort,
    );
  }
  return availableStatistic(wins / losses, cohort);
}

/**
 * Rolling Sortino: delegate to `calculateSortino` over the most-recent `windowSize` returns.
 *
 * @param tradeReturns - Array of per-trade return values.
 * @param windowSize - Number of most-recent trades to include. Must be a positive integer.
 * @param riskFreeRate - Risk-free rate to subtract from returns (default 0).
 * @returns Sortino ratio for the rolling window with its cohort, or a typed
 *          unavailable result.
 * @throws When `windowSize` is not a positive integer or any input is non-finite.
 */
export function calculateRollingSortino(
  tradeReturns: number[],
  windowSize: number,
  riskFreeRate = 0,
): SampleStatistic<number> {
  assertWindowSize("calculateRollingSortino", windowSize);
  if (tradeReturns.length < windowSize) {
    return insufficientWindow(
      "calculateRollingSortino",
      tradeReturns.length,
      windowSize,
    );
  }
  assertFiniteArray("calculateRollingSortino", tradeReturns);
  const cohort = sampleCohort(windowSize, windowSize);
  const sortino = calculateSortino(tradeReturns.slice(-windowSize), riskFreeRate);
  if (sortino === null) {
    // `calculateSortino` returns null only for a window it cannot form a
    // dispersion over — fewer than two samples. That is a property of the
    // window, so it is reported as one rather than as a ratio of zero.
    return unavailableStatistic(
      "insufficient_samples",
      `calculateRollingSortino: window of ${windowSize} cannot support a dispersion estimate`,
      cohort,
    );
  }
  return availableStatistic(sortino, cohort);
}

/**
 * Z-score of live-expectancy vs backtest-expectancy, scaled by the backtest stddev.
 * Positive Z = live outperforming; negative Z = live underperforming.
 *
 * The live expectancy is taken as a {@link SampleStatistic} rather than a bare
 * number so the z-score inherits the cohort it was actually derived from. A
 * z-score is a statement about how surprising a sample mean is, and how
 * surprising it is depends entirely on how many trades produced it — quoting
 * the z alone is the exact substitution this type exists to block. An
 * unavailable live expectancy yields an unavailable z, because there is no
 * mean to compare.
 *
 * @param liveExpectancy - Mean P&L per trade in the live window, with its cohort.
 * @param backtestExpectancy - Mean P&L per trade from the calibration backtest.
 * @param backtestStddev - Stddev of per-trade P&L in the backtest. Must be > 0.
 * @returns Z-score measuring live-vs-backtest divergence, carrying the live cohort.
 * @throws When the backtest inputs are non-finite or `backtestStddev` is not positive.
 */
export function calculateBacktestDivergenceZ(
  liveExpectancy: SampleStatistic<number>,
  backtestExpectancy: number,
  backtestStddev: number,
): SampleStatistic<number> {
  if (!Number.isFinite(backtestExpectancy) || !Number.isFinite(backtestStddev)) {
    throw new Error("calculateBacktestDivergenceZ: inputs must be finite numbers");
  }
  if (backtestStddev <= 0) {
    throw new Error("calculateBacktestDivergenceZ: stddev must be > 0");
  }
  if (!liveExpectancy.available) {
    return unavailableStatistic(
      liveExpectancy.reason,
      `calculateBacktestDivergenceZ: live expectancy unavailable (${liveExpectancy.detail})`,
      sampleCohort(liveExpectancy.requestedCount, liveExpectancy.sampleCount),
    );
  }
  if (!Number.isFinite(liveExpectancy.value)) {
    throw new Error("calculateBacktestDivergenceZ: inputs must be finite numbers");
  }
  return availableStatistic(
    (liveExpectancy.value - backtestExpectancy) / backtestStddev,
    sampleCohort(liveExpectancy.requestedCount, liveExpectancy.sampleCount),
  );
}
