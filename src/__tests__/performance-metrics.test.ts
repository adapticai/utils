import { describe, it, expect, vi } from 'vitest';

// Mock @adaptic/backend-legacy before importing the module under test.
// performance-metrics.ts has a top-level import of @adaptic/backend-legacy,
// which transitively requires graphql-fields (not installed in utils).
vi.mock('@adaptic/backend-legacy', () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
  },
  types: {},
}));

vi.mock('../alpaca/legacy', () => ({
  fetchAccountDetails: vi.fn(),
  fetchPortfolioHistory: vi.fn(),
}));

vi.mock('../adaptic', () => ({
  getSharedApolloClient: vi.fn(),
}));

import {
  calculateMaxDrawdown,
  calculateDrawdownMetrics,
  calculateDailyReturns,
  calculateBetaFromReturns,
  alignReturnsByDate,
} from '../performance-metrics';

describe('calculateDailyReturns', () => {
  it('should calculate log returns for simple price series', () => {
    const prices = [100, 110, 105, 115, 120];
    const returns = calculateDailyReturns(prices);

    expect(returns).toHaveLength(4);
    // log(110/100) = 0.0953
    expect(returns[0]).toBeCloseTo(Math.log(110 / 100), 6);
    // log(105/110) = -0.0465
    expect(returns[1]).toBeCloseTo(Math.log(105 / 110), 6);
    // log(115/105) = 0.0909
    expect(returns[2]).toBeCloseTo(Math.log(115 / 105), 6);
    // log(120/115) = 0.0426
    expect(returns[3]).toBeCloseTo(Math.log(120 / 115), 6);
  });

  it('should return empty array for single element', () => {
    const returns = calculateDailyReturns([100]);
    expect(returns).toEqual([]);
  });

  it('should return empty array for empty input', () => {
    const returns = calculateDailyReturns([]);
    expect(returns).toEqual([]);
  });

  it('should skip entries with zero previous price', () => {
    const prices = [0, 100, 110];
    const returns = calculateDailyReturns(prices);
    // First return (0 -> 100) should be skipped because prev is 0
    expect(returns).toHaveLength(1);
    expect(returns[0]).toBeCloseTo(Math.log(110 / 100), 6);
  });

  it('should skip entries with negative previous price', () => {
    const prices = [-5, 100, 110];
    const returns = calculateDailyReturns(prices);
    // -5 is invalid, should be skipped
    expect(returns).toHaveLength(1);
    expect(returns[0]).toBeCloseTo(Math.log(110 / 100), 6);
  });

  it('should skip NaN and Infinity values', () => {
    const prices = [100, NaN, 110, Infinity, 120];
    const returns = calculateDailyReturns(prices);
    // NaN and Infinity should be filtered out
    // 100 -> NaN: skipped (current invalid)
    // NaN -> 110: skipped (prev invalid)
    // 110 -> Infinity: skipped (current invalid)
    // Infinity -> 120: skipped (prev invalid)
    expect(returns).toHaveLength(0);
  });

  it('should handle all equal prices (returns of 0)', () => {
    const prices = [100, 100, 100, 100];
    const returns = calculateDailyReturns(prices);

    expect(returns).toHaveLength(3);
    returns.forEach((ret) => {
      expect(ret).toBe(0);
    });
  });

  it('should handle large price swings', () => {
    const prices = [100, 200, 50, 300];
    const returns = calculateDailyReturns(prices);

    expect(returns).toHaveLength(3);
    expect(returns[0]).toBeCloseTo(Math.log(2), 6); // 100 -> 200 = ln(2)
    expect(returns[1]).toBeCloseTo(Math.log(0.25), 6); // 200 -> 50 = ln(0.25)
    expect(returns[2]).toBeCloseTo(Math.log(6), 6); // 50 -> 300 = ln(6)
  });

  it('should produce small values for small price changes', () => {
    const prices = [100, 100.01, 100.02];
    const returns = calculateDailyReturns(prices);

    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.0001, 4);
  });
});

describe('calculateMaxDrawdown', () => {
  it('should return 0% for monotonically increasing equity', () => {
    const equity = [100, 110, 120, 130, 140];
    const result = calculateMaxDrawdown(equity);
    expect(result).toBe('0%');
  });

  it('should calculate drawdown for simple decline', () => {
    // Peak at 100, drops to 80, so drawdown = (100-80)/100 = 20%
    const equity = [100, 80];
    const result = calculateMaxDrawdown(equity);
    expect(result).toBe('20%');
  });

  it('should calculate drawdown correctly with recovery', () => {
    // Peak at 200, drops to 150, then recovers to 250
    const equity = [100, 150, 200, 150, 250];
    const result = calculateMaxDrawdown(equity);
    expect(result).toBe('25%'); // (200-150)/200 = 25%
  });

  it('should find the maximum drawdown among multiple drawdowns', () => {
    // First drawdown: 100 -> 90 = 10%
    // Second drawdown: 120 -> 84 = 30%
    const equity = [100, 90, 100, 120, 84, 130];
    const result = calculateMaxDrawdown(equity);
    expect(result).toBe('30%'); // 30% is the larger drawdown
  });

  it('should handle constant equity (no drawdown)', () => {
    const equity = [100, 100, 100, 100];
    const result = calculateMaxDrawdown(equity);
    expect(result).toBe('0%');
  });

  it('should handle single element equity', () => {
    const equity = [100];
    const result = calculateMaxDrawdown(equity);
    expect(result).toBe('0%');
  });

  it('should throw for empty array', () => {
    expect(() => calculateMaxDrawdown([])).toThrow('Equity data must be a non-empty array');
  });

  it('should respect custom decimal places', () => {
    const equity = [100, 66.67];
    const result = calculateMaxDrawdown(equity, 4);
    // (100 - 66.67) / 100 = 0.3333
    expect(result).toMatch(/^\d+\.\d{1,4}%$/);
  });

  it('should handle equity starting at zero', () => {
    const equity = [0, 100, 90];
    const result = calculateMaxDrawdown(equity);
    // Peak at 100, trough at 90, drawdown = 10%
    expect(result).toBe('10%');
  });
});

describe('calculateDrawdownMetrics', () => {
  it('should return detailed metrics for a drawdown', () => {
    const equity = [100, 150, 200, 150, 250];
    const result = calculateDrawdownMetrics(equity);

    expect(result.maxDrawdownPercentage).toBe('25%');
    expect(result.peakValue).toBe(200);
    expect(result.troughValue).toBe(150);
    expect(result.maxDrawdownValue).toBe(50);
    expect(result.peakIndex).toBe(2);
    expect(result.troughIndex).toBe(3);
    expect(result.drawdownPeriod).toBe(1);
  });

  it('should detect recovery', () => {
    // Use a series where recovery happens in the drawdown (else) branch,
    // not the peak-update branch. Peak=200 at index 2, trough=150 at index 3,
    // recovery at index 5 where value (210) >= equity[maxPeakIndex] (200)
    // and it enters the else branch because 210 is not >= current peakValue (220).
    const equity = [100, 150, 200, 150, 220, 210, 250];
    const result = calculateDrawdownMetrics(equity);

    expect(result.maxDrawdownPercentage).toBe('25%');
    // Recovery happens when value >= peak at maxPeakIndex AND we are in the else branch.
    // At index 4 (220), currentValue >= peakValue so peak updates to 220. No recovery check.
    // At index 5 (210), 210 < 220, enters else branch. 210 >= equity[2]=200? Yes -> recovery.
    expect(result.recoveryIndex).toBe(5);
  });

  it('should calculate current drawdown', () => {
    // Last value is below the peak
    const equity = [100, 200, 180];
    const result = calculateDrawdownMetrics(equity);

    expect(result.currentDrawdownPercentage).toBe('10%'); // (200-180)/200 = 10%
  });

  it('should return 0% current drawdown when at new high', () => {
    const equity = [100, 200, 250];
    const result = calculateDrawdownMetrics(equity);

    expect(result.currentDrawdownPercentage).toBe('0%');
  });

  it('should throw for non-array input', () => {
    // @ts-expect-error Testing invalid input
    expect(() => calculateDrawdownMetrics('not an array')).toThrow(
      'Equity data must be a non-empty array'
    );
  });

  it('should throw for empty array', () => {
    expect(() => calculateDrawdownMetrics([])).toThrow(
      'Equity data must be a non-empty array'
    );
  });

  it('should handle NaN values by replacing with 0', () => {
    const equity = [100, NaN, 80];
    const result = calculateDrawdownMetrics(equity);

    // NaN replaced with 0, so drawdown is 100%
    expect(result).toBeDefined();
    expect(result.maxDrawdownPercentage).not.toBe('0%');
  });

  it('should respect minimumDrawdown option', () => {
    const equity = [100, 99, 100];
    const result = calculateDrawdownMetrics(equity, { minimumDrawdown: 0.05 });

    // Drawdown is only 1%, which is below 5% threshold
    expect(result.maxDrawdownPercentage).toBe('0%');
  });

  it('should respect custom decimals option', () => {
    const equity = [100, 66.666];
    const result = calculateDrawdownMetrics(equity, { decimals: 3 });

    expect(result.maxDrawdownPercentage).toMatch(/\d+\.\d{1,3}%/);
  });
});

describe('calculateBetaFromReturns', () => {
  it('should return beta of 1 when portfolio matches benchmark', () => {
    const returns = [0.01, -0.02, 0.03, -0.01, 0.02];
    const result = calculateBetaFromReturns(returns, returns);

    expect(result.beta).toBeCloseTo(1.0, 6);
    expect(result.covariance).toBeCloseTo(result.variance, 6);
  });

  it('should return beta of 0 for uncorrelated returns', () => {
    // Perfectly uncorrelated: portfolio is constant, benchmark varies
    const portfolioReturns = [0, 0, 0, 0, 0];
    const benchmarkReturns = [0.01, -0.02, 0.03, -0.01, 0.02];
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);

    expect(result.beta).toBe(0);
  });

  it('should return beta > 1 for amplified returns', () => {
    const benchmarkReturns = [0.01, -0.02, 0.03, -0.01, 0.02];
    const portfolioReturns = benchmarkReturns.map((r) => r * 2); // 2x amplified
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);

    expect(result.beta).toBeCloseTo(2.0, 1);
  });

  it('should return negative beta for inversely correlated returns', () => {
    const benchmarkReturns = [0.01, -0.02, 0.03, -0.01, 0.02];
    const portfolioReturns = benchmarkReturns.map((r) => -r); // Inverse
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);

    expect(result.beta).toBeCloseTo(-1.0, 1);
  });

  it('should handle empty returns arrays', () => {
    const result = calculateBetaFromReturns([], []);

    expect(result.beta).toBe(0);
    expect(result.covariance).toBe(0);
    expect(result.variance).toBe(0);
  });

  it('should return near-zero beta when benchmark has near-zero variance', () => {
    // Note: Due to IEEE 754 floating-point, the sum of [0.05, 0.05, 0.05] / 3
    // is not exactly 0.05, so variance is not exactly 0. The function's
    // zero-variance guard (variance === 0) does not trigger.
    // Use integer values that divide cleanly to get true zero variance.
    const portfolioReturns = [1, -2, 3];
    const benchmarkReturns = [5, 5, 5]; // Constant benchmark, integer values
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);

    expect(result.beta).toBe(0);
    expect(result.variance).toBe(0);
  });

  it('should calculate correct average returns', () => {
    const portfolioReturns = [0.10, 0.20, 0.30];
    const benchmarkReturns = [0.05, 0.15, 0.25];
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);

    expect(result.averagePortfolioReturn).toBeCloseTo(0.20, 6);
    expect(result.averageBenchmarkReturn).toBeCloseTo(0.15, 6);
  });

  it('should calculate covariance correctly', () => {
    const portfolioReturns = [0.01, 0.02, 0.03];
    const benchmarkReturns = [0.01, 0.02, 0.03];
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);

    // For identical arrays, covariance should equal variance
    expect(result.covariance).toBeCloseTo(result.variance, 6);
  });
});

describe('alignReturnsByDate', () => {
  it('should align returns with matching timestamps', () => {
    const baseTimestamp = 1704067200; // Jan 1, 2024 in seconds
    const dayInSeconds = 86400;

    const portfolioHistory = {
      equity: [100, 110, 105, 115],
      timestamp: [
        baseTimestamp,
        baseTimestamp + dayInSeconds,
        baseTimestamp + dayInSeconds * 2,
        baseTimestamp + dayInSeconds * 3,
      ],
    };

    const benchmarkBars = [
      { c: 200, t: baseTimestamp },
      { c: 210, t: baseTimestamp + dayInSeconds },
      { c: 205, t: baseTimestamp + dayInSeconds * 2 },
      { c: 215, t: baseTimestamp + dayInSeconds * 3 },
    ];

    const result = alignReturnsByDate(portfolioHistory, benchmarkBars);

    expect(result.alignedPortfolioReturns.length).toBeGreaterThan(0);
    expect(result.alignedBenchmarkReturns.length).toBeGreaterThan(0);
    expect(result.alignedPortfolioReturns.length).toBe(
      result.alignedBenchmarkReturns.length
    );
  });

  it('should return empty arrays when no common dates exist', () => {
    const portfolioHistory = {
      equity: [100, 110],
      timestamp: [1000000, 1086400], // Very different timestamps
    };

    const benchmarkBars = [
      { c: 200, t: 9000000 },
      { c: 210, t: 9086400 },
    ];

    const result = alignReturnsByDate(portfolioHistory, benchmarkBars);

    expect(result.alignedPortfolioReturns).toEqual([]);
    expect(result.alignedBenchmarkReturns).toEqual([]);
  });

  it('should handle single data point (no returns possible)', () => {
    const portfolioHistory = {
      equity: [100],
      timestamp: [1704067200],
    };

    const benchmarkBars = [{ c: 200, t: 1704067200 }];

    const result = alignReturnsByDate(portfolioHistory, benchmarkBars);

    expect(result.alignedPortfolioReturns).toEqual([]);
    expect(result.alignedBenchmarkReturns).toEqual([]);
  });
});
