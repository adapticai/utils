/**
 * Per-strategy rolling metrics and backtest-divergence z-score.
 *
 * Conventions:
 * - tradePnls / tradeReturns is an array of per-trade realised P&L or return
 *   (positive = win, negative = loss, zero = breakeven).
 * - All "rolling*" functions return null when fewer than `windowSize` trades exist.
 * - All public functions reject non-finite inputs (NaN, Infinity) by throwing.
 *   Callers must pre-validate or filter their inputs.
 */

import { calculateSortino } from "./risk-metrics";

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
 * Rolling expectancy: mean P&L over the most-recent `windowSize` trades.
 *
 * @param tradePnls - Array of per-trade realised P&L values.
 * @param windowSize - Number of most-recent trades to include. Must be a positive integer.
 * @returns Mean P&L of the last `windowSize` trades, or null when fewer than `windowSize` exist.
 * @throws When `windowSize` is not a positive integer or any input is non-finite.
 */
export function calculateRollingExpectancy(
  tradePnls: number[],
  windowSize: number,
): number | null {
  assertWindowSize("calculateRollingExpectancy", windowSize);
  if (tradePnls.length < windowSize) return null;
  assertFiniteArray("calculateRollingExpectancy", tradePnls);
  const slice = tradePnls.slice(-windowSize);
  return slice.reduce((a, b) => a + b, 0) / windowSize;
}

/**
 * Rolling hit-rate: fraction of strictly-positive P&L trades in the most-recent
 * `windowSize` trades. Zero P&L counts as non-win.
 *
 * @param tradePnls - Array of per-trade realised P&L values.
 * @param windowSize - Number of most-recent trades to include. Must be a positive integer.
 * @returns Fraction of winning trades in the window, or null when fewer than `windowSize` exist.
 * @throws When `windowSize` is not a positive integer or any input is non-finite.
 */
export function calculateRollingHitRate(
  tradePnls: number[],
  windowSize: number,
): number | null {
  assertWindowSize("calculateRollingHitRate", windowSize);
  if (tradePnls.length < windowSize) return null;
  assertFiniteArray("calculateRollingHitRate", tradePnls);
  const slice = tradePnls.slice(-windowSize);
  const wins = slice.filter((p) => p > 0).length;
  return wins / windowSize;
}

/**
 * Rolling profit factor: sum(wins) / |sum(losses)| over the most-recent `windowSize` trades.
 *
 * Edge cases:
 * - no losses and at least one win → +Infinity
 * - no wins and no losses (all zeros) → 0
 * - fewer than windowSize trades → null
 *
 * @param tradePnls - Array of per-trade realised P&L values.
 * @param windowSize - Number of most-recent trades to include. Must be a positive integer.
 * @returns Profit factor for the rolling window, or null when fewer than `windowSize` exist.
 * @throws When `windowSize` is not a positive integer or any input is non-finite.
 */
export function calculateRollingProfitFactor(
  tradePnls: number[],
  windowSize: number,
): number | null {
  assertWindowSize("calculateRollingProfitFactor", windowSize);
  if (tradePnls.length < windowSize) return null;
  assertFiniteArray("calculateRollingProfitFactor", tradePnls);
  const slice = tradePnls.slice(-windowSize);
  const wins = slice.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const losses = slice.filter((p) => p < 0).reduce((a, b) => a + Math.abs(b), 0);
  if (losses === 0) return wins > 0 ? Number.POSITIVE_INFINITY : 0;
  return wins / losses;
}

/**
 * Rolling Sortino: delegate to `calculateSortino` over the most-recent `windowSize` returns.
 *
 * @param tradeReturns - Array of per-trade return values.
 * @param windowSize - Number of most-recent trades to include. Must be a positive integer.
 * @param riskFreeRate - Risk-free rate to subtract from returns (default 0).
 * @returns Sortino ratio for the rolling window, or null when fewer than `windowSize` exist.
 * @throws When `windowSize` is not a positive integer or any input is non-finite.
 */
export function calculateRollingSortino(
  tradeReturns: number[],
  windowSize: number,
  riskFreeRate = 0,
): number | null {
  assertWindowSize("calculateRollingSortino", windowSize);
  if (tradeReturns.length < windowSize) return null;
  assertFiniteArray("calculateRollingSortino", tradeReturns);
  return calculateSortino(tradeReturns.slice(-windowSize), riskFreeRate);
}

/**
 * Z-score of live-expectancy vs backtest-expectancy, scaled by the backtest stddev.
 * Positive Z = live outperforming; negative Z = live underperforming.
 *
 * @param liveExpectancy - Mean P&L per trade in the live window.
 * @param backtestExpectancy - Mean P&L per trade from the calibration backtest.
 * @param backtestStddev - Stddev of per-trade P&L in the backtest. Must be > 0.
 * @returns Z-score measuring divergence between live and backtest performance.
 * @throws When any input is non-finite or `backtestStddev` is not positive.
 */
export function calculateBacktestDivergenceZ(
  liveExpectancy: number,
  backtestExpectancy: number,
  backtestStddev: number,
): number {
  if (!Number.isFinite(liveExpectancy) || !Number.isFinite(backtestExpectancy) || !Number.isFinite(backtestStddev)) {
    throw new Error("calculateBacktestDivergenceZ: inputs must be finite numbers");
  }
  if (backtestStddev <= 0) {
    throw new Error("calculateBacktestDivergenceZ: stddev must be > 0");
  }
  return (liveExpectancy - backtestExpectancy) / backtestStddev;
}
