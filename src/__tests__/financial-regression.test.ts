import { describe, it, expect, vi } from 'vitest';

// Mock @adaptic/backend-legacy before importing the modules under test.
vi.mock('@adaptic/backend-legacy', () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
  },
  types: {},
}));

vi.mock('../alpaca-functions', () => ({
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
} from '../performance-metrics';
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
} from '../technical-analysis';
import { PolygonPriceData } from '../types/polygon-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a PolygonPriceData array from raw close prices.
 */
function toPriceData(closePrices: number[]): PolygonPriceData[] {
  return closePrices.map((close, i) => ({
    symbol: 'TEST',
    date: `2025-01-${String(i + 1).padStart(2, '0')}`,
    timeStamp: 1735689600000 + i * 86400000, // 2025-01-01 + i days
    open: close,
    high: close + 1,
    low: Math.max(close - 1, 0.01),
    close,
    vol: 1_000_000,
    vwap: close,
    trades: 1000,
  }));
}

// ---------------------------------------------------------------------------
// Beta Regression Tests Against Known Data
// ---------------------------------------------------------------------------

describe('Regression: Beta calculation against known values', () => {
  it('should compute beta = 1.0 for market vs itself (SPY vs SPY)', () => {
    // Simulated SPY daily returns over 10 days
    const spyReturns = [0.0012, -0.0045, 0.0078, -0.0023, 0.0056, -0.0011, 0.0034, -0.0067, 0.0089, -0.0015];
    const result = calculateBetaFromReturns(spyReturns, spyReturns);
    expect(result.beta).toBeCloseTo(1.0, 10);
  });

  it('should compute beta near 1.5 for a high-beta portfolio', () => {
    // Benchmark returns (simulating SPY)
    const benchmarkReturns = [0.01, -0.005, 0.008, -0.003, 0.012, -0.007, 0.006, -0.004, 0.009, -0.002];
    // Portfolio that moves 1.5x the benchmark
    const portfolioReturns = benchmarkReturns.map((r) => r * 1.5);
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);
    expect(result.beta).toBeCloseTo(1.5, 4);
  });

  it('should compute beta near 0.5 for a defensive portfolio', () => {
    const benchmarkReturns = [0.01, -0.005, 0.008, -0.003, 0.012, -0.007, 0.006, -0.004, 0.009, -0.002];
    const portfolioReturns = benchmarkReturns.map((r) => r * 0.5);
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);
    expect(result.beta).toBeCloseTo(0.5, 4);
  });

  it('should compute beta near -0.8 for an inversely correlated portfolio', () => {
    const benchmarkReturns = [0.01, -0.005, 0.008, -0.003, 0.012, -0.007, 0.006, -0.004, 0.009, -0.002];
    const portfolioReturns = benchmarkReturns.map((r) => r * -0.8);
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);
    expect(result.beta).toBeCloseTo(-0.8, 4);
  });

  it('should handle beta with offset (alpha-generating) portfolio', () => {
    // Portfolio = 1.2 * benchmark + 0.001 (daily alpha)
    // Beta should still be 1.2 because alpha is a constant offset
    const benchmarkReturns = [0.01, -0.005, 0.008, -0.003, 0.012, -0.007, 0.006, -0.004, 0.009, -0.002];
    const portfolioReturns = benchmarkReturns.map((r) => r * 1.2 + 0.001);
    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);
    // Adding constant alpha does not change beta
    expect(result.beta).toBeCloseTo(1.2, 4);
  });

  it('should compute correct covariance and variance manually', () => {
    const portfolioReturns = [0.05, -0.02, 0.03];
    const benchmarkReturns = [0.03, -0.01, 0.02];

    const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);

    // Manual calculation:
    // avgP = (0.05 - 0.02 + 0.03) / 3 = 0.02
    // avgB = (0.03 - 0.01 + 0.02) / 3 = 0.013333...
    const avgP = 0.02;
    const avgB = (0.03 - 0.01 + 0.02) / 3;

    expect(result.averagePortfolioReturn).toBeCloseTo(avgP, 10);
    expect(result.averageBenchmarkReturn).toBeCloseTo(avgB, 10);

    // Covariance = sum((Pi - avgP) * (Bi - avgB)) / n
    const cov =
      ((0.05 - avgP) * (0.03 - avgB) +
        (-0.02 - avgP) * (-0.01 - avgB) +
        (0.03 - avgP) * (0.02 - avgB)) /
      3;
    expect(result.covariance).toBeCloseTo(cov, 10);

    // Variance = sum((Bi - avgB)^2) / n
    const variance =
      ((0.03 - avgB) ** 2 + (-0.01 - avgB) ** 2 + (0.02 - avgB) ** 2) / 3;
    expect(result.variance).toBeCloseTo(variance, 10);

    // Beta = cov / var
    expect(result.beta).toBeCloseTo(cov / variance, 10);
  });
});

// ---------------------------------------------------------------------------
// Drawdown Regression Tests Against Known Scenarios
// ---------------------------------------------------------------------------

describe('Regression: Drawdown against known historical patterns', () => {
  it('should detect 2008-style crash pattern (50% drawdown)', () => {
    // Simulated equity curve resembling a 50% crash
    const equity = [
      100, 102, 105, 108, 110, 107, 100, 90,
      80, 70, 60, 55, 52, 55, 60, 65,
      70, 75, 80, 90, 100, 110,
    ];
    const result = calculateDrawdownMetrics(equity);
    // Peak at 110 (index 4), trough at 52 (index 12)
    // Drawdown = (110 - 52) / 110 = 52.73%
    expect(result.peakValue).toBe(110);
    expect(result.troughValue).toBe(52);
    const mdd = parseFloat(result.maxDrawdownPercentage.replace('%', ''));
    expect(mdd).toBeCloseTo(52.73, 1);
    expect(result.peakIndex).toBe(4);
    expect(result.troughIndex).toBe(12);
  });

  it('should detect V-shaped recovery with exact metrics', () => {
    const equity = [100, 120, 140, 160, 120, 100, 80, 100, 120, 140, 160, 180];
    const result = calculateDrawdownMetrics(equity);
    // Peak at 160 (index 3), trough at 80 (index 6)
    // Drawdown = (160 - 80) / 160 = 50%
    expect(result.maxDrawdownPercentage).toBe('50%');
    expect(result.peakValue).toBe(160);
    expect(result.troughValue).toBe(80);
    expect(result.maxDrawdownValue).toBe(80);
    expect(result.drawdownPeriod).toBe(3);
  });

  it('should detect multiple drawdowns and report the maximum', () => {
    // First drawdown: 100 -> 90 = 10%
    // Second drawdown: 110 -> 77 = 30%
    // Third drawdown: 120 -> 108 = 10%
    const equity = [100, 90, 100, 110, 77, 100, 120, 108, 130];
    const result = calculateDrawdownMetrics(equity);
    expect(result.maxDrawdownPercentage).toBe('30%');
    expect(result.peakValue).toBe(110);
    expect(result.troughValue).toBe(77);
  });

  it('should compute 0% drawdown for bull market (no decline)', () => {
    const equity = [100, 105, 110, 115, 120, 125, 130, 140, 150];
    const result = calculateMaxDrawdown(equity);
    expect(result).toBe('0%');
  });

  it('should compute current drawdown correctly when not yet recovered', () => {
    const equity = [100, 120, 140, 130, 120]; // Still below peak
    const result = calculateDrawdownMetrics(equity);
    // Current drawdown: peak = 140, current = 120
    // (140 - 120) / 140 = 14.29%
    const currentDD = parseFloat(result.currentDrawdownPercentage.replace('%', ''));
    expect(currentDD).toBeCloseTo(14.29, 1);
  });

  it('should compute 0% current drawdown when at all-time high', () => {
    const equity = [100, 110, 105, 115, 120];
    const result = calculateDrawdownMetrics(equity);
    expect(result.currentDrawdownPercentage).toBe('0%');
  });
});

// ---------------------------------------------------------------------------
// SMA / EMA Regression Tests Against Manual Calculations
// ---------------------------------------------------------------------------

describe('Regression: SMA and EMA against manual calculations', () => {
  it('EMA initial value equals SMA of first N periods', () => {
    // Period 5, prices: 10, 11, 12, 13, 14, 15, 16, 17, 18, 19
    const prices = Array.from({ length: 10 }, (_, i) => 10 + i);
    const priceData = toPriceData(prices);
    const result = calculateEMA(priceData, { period: 5 });

    // SMA of first 5 = (10 + 11 + 12 + 13 + 14) / 5 = 12.0
    expect(result[0].ema).toBe(12.0);
  });

  it('EMA with known multiplier matches hand calculation', () => {
    // Period 5: multiplier = 2 / (5 + 1) = 1/3
    const prices = [10, 11, 12, 13, 14, 15]; // 6 data points
    const priceData = toPriceData(prices);
    // Explicitly set period2: 0 to disable the second EMA (default period2=9
    // would cause insufficient data for 6-element input).
    const result = calculateEMA(priceData, { period: 5, period2: 0 });

    // SMA of first 5: (10 + 11 + 12 + 13 + 14) / 5 = 12.0
    const sma5 = 12.0;
    const multiplier = 2 / (5 + 1); // 1/3

    // EMA at index 5 (price = 15):
    // EMA = (15 - 12) * (1/3) + 12 = 1 + 12 = 13
    const expectedEMA = (15 - sma5) * multiplier + sma5;

    expect(result.length).toBe(2);
    expect(result[0].ema).toBe(12.0);
    expect(result[1].ema).toBeCloseTo(expectedEMA, 2);
  });

  it('Bollinger middle band equals SMA for known data', () => {
    // 25 data points, period 5 for easier manual verification
    const prices = [10, 12, 11, 13, 14, 15, 13, 16, 17, 14];
    const priceData = toPriceData(prices);
    const result = calculateBollingerBands(priceData, { period: 5 });

    // First SMA (indices 0-4): (10 + 12 + 11 + 13 + 14) / 5 = 12.0
    expect(result[0].middle).toBeCloseTo(12.0, 2);

    // Second SMA (indices 1-5): (12 + 11 + 13 + 14 + 15) / 5 = 13.0
    expect(result[1].middle).toBeCloseTo(13.0, 2);

    // Third SMA (indices 2-6): (11 + 13 + 14 + 15 + 13) / 5 = 13.2
    expect(result[2].middle).toBeCloseTo(13.2, 2);
  });

  it('Bollinger bandwidth matches manual std dev calculation', () => {
    // Use constant prices to verify std dev = 0
    const prices = Array.from({ length: 10 }, () => 50);
    const priceData = toPriceData(prices);
    const result = calculateBollingerBands(priceData, { period: 5, standardDeviations: 2 });

    result.forEach((entry) => {
      expect(entry.middle).toBe(50);
      expect(entry.upper).toBe(50); // std dev = 0
      expect(entry.lower).toBe(50);
    });
  });

  it('Bollinger std dev matches hand calculation for known series', () => {
    // Prices: [10, 12, 14, 16, 18], SMA = 14
    // Deviations: [-4, -2, 0, 2, 4]
    // Variance (population) = (16+4+0+4+16)/5 = 8
    // StdDev = sqrt(8) = 2.828...
    // Upper (2 std devs) = 14 + 2 * 2.828 = 19.66
    // Lower (2 std devs) = 14 - 2 * 2.828 = 8.34
    const prices = [10, 12, 14, 16, 18];
    const priceData = toPriceData(prices);
    const result = calculateBollingerBands(priceData, { period: 5, standardDeviations: 2 });

    expect(result.length).toBe(1);
    expect(result[0].middle).toBeCloseTo(14.0, 2);
    expect(result[0].upper).toBeCloseTo(19.66, 1);
    expect(result[0].lower).toBeCloseTo(8.34, 1);
  });
});

// ---------------------------------------------------------------------------
// RSI Regression Tests
// ---------------------------------------------------------------------------

describe('Regression: RSI against manual calculations', () => {
  it('RSI of all-up series equals 100', () => {
    // Strictly increasing: every day is a gain, no losses
    const prices = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    const priceData = toPriceData(prices);
    const result = calculateRSI(priceData, { period: 14 });

    result.forEach((entry) => {
      expect(entry.rsi).toBe(100);
    });
  });

  it('RSI of all-down series equals 0', () => {
    // Strictly decreasing: every day is a loss, no gains
    const prices = Array.from({ length: 20 }, (_, i) => 200 - i * 2);
    const priceData = toPriceData(prices);
    const result = calculateRSI(priceData, { period: 14 });

    result.forEach((entry) => {
      expect(entry.rsi).toBe(0);
    });
  });

  it('RSI first value matches manual Wilder calculation', () => {
    // Prices: [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
    //          46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41,
    //          46.22, 45.64]
    // This is a well-known RSI example (Wilder's smoothing, period 14)
    const prices = [
      44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42,
      45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    const priceData = toPriceData(prices);
    const result = calculateRSI(priceData, { period: 14 });

    // Manual calculation for first RSI value:
    // Gains:   0, 0.34, 0, 0, 0.72, 0.50, 0.27, 0.32, 0.42, 0.24, 0, 0.14, 0, 0.67
    // Losses:  0, 0,   0.25, 0.48, 0, 0, 0, 0, 0, 0, 0.19, 0, 0.42, 0
    // Sum gains = 0.34 + 0.72 + 0.50 + 0.27 + 0.32 + 0.42 + 0.24 + 0.14 + 0.67 = 3.62
    // Sum losses = 0.25 + 0.48 + 0.19 + 0.42 = 1.34
    // AvgGain = 3.62 / 14 = 0.25857
    // AvgLoss = 1.34 / 14 = 0.09571
    // RS = 0.25857 / 0.09571 = 2.7016
    // RSI = 100 - 100/(1+2.7016) = 72.98
    expect(result.length).toBe(1);
    expect(result[0].rsi).toBeCloseTo(72.98, 0);
  });
});

// ---------------------------------------------------------------------------
// Daily Returns Regression Tests
// ---------------------------------------------------------------------------

describe('Regression: Daily log returns', () => {
  it('log return of doubling price equals ln(2)', () => {
    const prices = [100, 200];
    const returns = calculateDailyReturns(prices);
    expect(returns[0]).toBeCloseTo(Math.LN2, 10);
  });

  it('log return of halving price equals -ln(2)', () => {
    const prices = [200, 100];
    const returns = calculateDailyReturns(prices);
    expect(returns[0]).toBeCloseTo(-Math.LN2, 10);
  });

  it('sum of log returns over round trip equals 0', () => {
    // Go from 100 to 200 then back to 100: ln(2) + ln(0.5) = 0
    const prices = [100, 200, 100];
    const returns = calculateDailyReturns(prices);
    const total = returns.reduce((s, r) => s + r, 0);
    expect(total).toBeCloseTo(0, 10);
  });

  it('log returns match manual calculation for known series', () => {
    const prices = [100, 105, 102, 110, 108];
    const returns = calculateDailyReturns(prices);

    expect(returns.length).toBe(4);
    expect(returns[0]).toBeCloseTo(Math.log(105 / 100), 10);
    expect(returns[1]).toBeCloseTo(Math.log(102 / 105), 10);
    expect(returns[2]).toBeCloseTo(Math.log(110 / 102), 10);
    expect(returns[3]).toBeCloseTo(Math.log(108 / 110), 10);
  });

  it('cumulative log return equals ln(final/initial) for clean series', () => {
    const prices = [50, 55, 60, 58, 65, 70, 68, 75];
    const returns = calculateDailyReturns(prices);
    const cumulative = returns.reduce((s, r) => s + r, 0);
    expect(cumulative).toBeCloseTo(Math.log(75 / 50), 10);
  });
});

// ---------------------------------------------------------------------------
// MACD Regression Tests
// ---------------------------------------------------------------------------

describe('Regression: MACD against known structure', () => {
  it('MACD histogram equals MACD line minus signal line', () => {
    // Generate enough data for MACD (need 26 + 9 = 35 minimum)
    const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const priceData = toPriceData(prices);
    const result = calculateMACD(priceData);

    result.forEach((entry) => {
      const expectedHistogram = entry.macd - entry.signal;
      expect(entry.histogram).toBeCloseTo(expectedHistogram, 1);
    });
  });

  it('MACD returns empty for insufficient data', () => {
    const priceData = toPriceData(Array.from({ length: 30 }, (_, i) => 100 + i));
    const result = calculateMACD(priceData);
    expect(result).toEqual([]);
  });

  it('MACD is positive when short EMA > long EMA (uptrend)', () => {
    // Strong uptrend: short EMA should respond faster and be above long EMA
    const prices = Array.from({ length: 50 }, (_, i) => 100 + i * 3);
    const priceData = toPriceData(prices);
    const result = calculateMACD(priceData);

    if (result.length > 0) {
      // In a strong linear uptrend, the last few MACD values should be positive
      const lastFew = result.slice(-3);
      lastFew.forEach((entry) => {
        expect(entry.macd).toBeGreaterThan(0);
      });
    }
  });
});
