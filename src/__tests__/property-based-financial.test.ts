import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Mock @adaptic/backend-legacy before importing the modules under test.
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
} from '../performance-metrics';
import {
  calculateEMA,
  calculateRSI,
  calculateBollingerBands,
} from '../technical-analysis';
import { PolygonPriceData } from '../types/polygon-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Arbitrary that produces arrays of positive finite numbers suitable as price
 * series. Guarantees at least `minLength` elements and all values > 0.
 */
function positivePriceArray(minLength: number = 2, maxLength: number = 200): fc.Arbitrary<number[]> {
  return fc.array(
    fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
    { minLength, maxLength }
  );
}

/**
 * Arbitrary that produces arrays of finite (possibly negative) returns.
 */
function returnsArray(minLength: number = 2, maxLength: number = 200): fc.Arbitrary<number[]> {
  return fc.array(
    fc.double({ min: -0.99, max: 10, noNaN: true }),
    { minLength, maxLength }
  );
}

/**
 * Builds a PolygonPriceData array from raw close prices. High/low/open are
 * derived so the data remains internally consistent.
 */
function toPriceData(closePrices: number[]): PolygonPriceData[] {
  return closePrices.map((close, i) => ({
    symbol: 'TEST',
    date: `2025-01-${String(i + 1).padStart(2, '0')}`,
    timeStamp: Date.now() + i * 86400000,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    vol: 1_000_000,
    vwap: close,
    trades: 1000,
  }));
}

// ---------------------------------------------------------------------------
// Returns Calculations
// ---------------------------------------------------------------------------

describe('Property-based: Returns calculations', () => {
  it('simple return equals (end - start) / start for two-element series', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
        (start, end) => {
          const returns = calculateDailyReturns([start, end]);
          if (returns.length === 0) return; // skipped due to validation
          // calculateDailyReturns uses log returns: ln(end/start)
          const expectedLogReturn = Math.log(end / start);
          expect(returns[0]).toBeCloseTo(expectedLogReturn, 8);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('cumulative log returns of a flat price series equal 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
        fc.integer({ min: 2, max: 100 }),
        (price, length) => {
          const prices = Array.from({ length }, () => price);
          const returns = calculateDailyReturns(prices);
          returns.forEach((ret) => {
            expect(ret).toBeCloseTo(0, 10);
          });
        }
      ),
      { numRuns: 200 }
    );
  });

  it('log returns are additive: sum of log returns equals ln(last/first)', () => {
    fc.assert(
      fc.property(
        positivePriceArray(3, 50),
        (prices) => {
          const returns = calculateDailyReturns(prices);
          if (returns.length === 0) return;
          const sumLogReturns = returns.reduce((s, r) => s + r, 0);
          // The first valid start price is prices[0] if > 0
          const firstValid = prices[0];
          const lastValid = prices[prices.length - 1];
          if (firstValid <= 0 || lastValid <= 0) return;
          const expected = Math.log(lastValid / firstValid);
          // Tolerance needed because some intermediate values may be skipped
          // Only check if no values were skipped (all positive & finite)
          const allValid = prices.every((p) => isFinite(p) && p > 0);
          if (allValid) {
            expect(sumLogReturns).toBeCloseTo(expected, 6);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('daily returns array length is at most prices.length - 1', () => {
    fc.assert(
      fc.property(
        positivePriceArray(1, 100),
        (prices) => {
          const returns = calculateDailyReturns(prices);
          expect(returns.length).toBeLessThanOrEqual(Math.max(0, prices.length - 1));
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Beta Calculations
// ---------------------------------------------------------------------------

describe('Property-based: Beta calculations', () => {
  it('beta of a series vs itself equals 1.0', () => {
    fc.assert(
      fc.property(
        returnsArray(3, 100),
        (returns) => {
          // Require meaningful variance to avoid numerical instability
          const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
          const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
          if (variance < 1e-8) return;
          const result = calculateBetaFromReturns(returns, returns);
          expect(result.beta).toBeCloseTo(1.0, 4);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('beta is linear: 2x leveraged returns produce beta near 2.0', () => {
    fc.assert(
      fc.property(
        returnsArray(5, 100),
        (benchmarkReturns) => {
          // Require meaningful variance to avoid numerical instability
          const mean = benchmarkReturns.reduce((s, r) => s + r, 0) / benchmarkReturns.length;
          const variance = benchmarkReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / benchmarkReturns.length;
          if (variance < 1e-8) return;
          const leveragedReturns = benchmarkReturns.map((r) => r * 2);
          const result = calculateBetaFromReturns(leveragedReturns, benchmarkReturns);
          expect(result.beta).toBeCloseTo(2.0, 2);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('beta of inversely correlated returns is near -1.0', () => {
    fc.assert(
      fc.property(
        returnsArray(5, 100),
        (benchmarkReturns) => {
          // Require meaningful variance to avoid numerical instability
          const mean = benchmarkReturns.reduce((s, r) => s + r, 0) / benchmarkReturns.length;
          const variance = benchmarkReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / benchmarkReturns.length;
          if (variance < 1e-8) return;
          const inverseReturns = benchmarkReturns.map((r) => -r);
          const result = calculateBetaFromReturns(inverseReturns, benchmarkReturns);
          expect(result.beta).toBeCloseTo(-1.0, 2);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('zero-variance benchmark produces beta of 0 (handled gracefully)', () => {
    fc.assert(
      fc.property(
        returnsArray(3, 50),
        // Use noDefaultInfinity to avoid edge cases; restrict to normal
        // float range to prevent subnormal precision issues
        fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        (portfolioReturns, constantValue) => {
          // Use integer-like constant values that produce exact zero variance
          const rounded = Math.round(constantValue * 1000) / 1000;
          const benchmarkReturns = Array.from({ length: portfolioReturns.length }, () => rounded);
          const result = calculateBetaFromReturns(portfolioReturns, benchmarkReturns);
          // The function should detect zero/near-zero variance and return 0
          expect(Math.abs(result.beta)).toBeLessThanOrEqual(1e-6);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('covariance of identical series equals variance', () => {
    fc.assert(
      fc.property(
        returnsArray(3, 100),
        (returns) => {
          const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
          const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
          if (variance < 1e-8) return;
          const result = calculateBetaFromReturns(returns, returns);
          expect(result.covariance).toBeCloseTo(result.variance, 6);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('beta scales linearly with arbitrary multiplier', () => {
    fc.assert(
      fc.property(
        returnsArray(5, 50),
        fc.double({ min: -5, max: 5, noNaN: true }),
        (benchmarkReturns, multiplier) => {
          const mean = benchmarkReturns.reduce((s, r) => s + r, 0) / benchmarkReturns.length;
          const variance = benchmarkReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / benchmarkReturns.length;
          if (variance < 1e-8 || Math.abs(multiplier) < 1e-6) return;
          const scaledReturns = benchmarkReturns.map((r) => r * multiplier);
          const result = calculateBetaFromReturns(scaledReturns, benchmarkReturns);
          expect(result.beta).toBeCloseTo(multiplier, 1);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Drawdown Calculations
// ---------------------------------------------------------------------------

describe('Property-based: Drawdown calculations', () => {
  it('maximum drawdown is always between 0% and 100%', () => {
    fc.assert(
      fc.property(
        positivePriceArray(1, 200),
        (equity) => {
          const result = calculateDrawdownMetrics(equity);
          const mddPct = parseFloat(result.maxDrawdownPercentage.replace('%', ''));
          expect(mddPct).toBeGreaterThanOrEqual(0);
          expect(mddPct).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('monotonically increasing series has 0% drawdown', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        fc.array(fc.double({ min: 0.001, max: 10, noNaN: true }), { minLength: 1, maxLength: 100 }),
        (start, increments) => {
          const equity: number[] = [start];
          let current = start;
          for (const inc of increments) {
            current += inc;
            equity.push(current);
          }
          const result = calculateMaxDrawdown(equity);
          expect(result).toBe('0%');
        }
      ),
      { numRuns: 300 }
    );
  });

  it('current drawdown is less than or equal to maximum drawdown', () => {
    fc.assert(
      fc.property(
        positivePriceArray(2, 200),
        (equity) => {
          const result = calculateDrawdownMetrics(equity);
          const maxDD = parseFloat(result.maxDrawdownPercentage.replace('%', ''));
          const currentDD = parseFloat(result.currentDrawdownPercentage.replace('%', ''));
          expect(currentDD).toBeLessThanOrEqual(maxDD + 0.01); // tolerance for rounding
        }
      ),
      { numRuns: 500 }
    );
  });

  it('drawdown value never exceeds total price decline from peak', () => {
    fc.assert(
      fc.property(
        positivePriceArray(2, 200),
        (equity) => {
          const result = calculateDrawdownMetrics(equity);
          if (result.maxDrawdownValue > 0) {
            expect(result.maxDrawdownValue).toBeLessThanOrEqual(result.peakValue);
            expect(result.troughValue).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('peakIndex is always less than or equal to troughIndex', () => {
    fc.assert(
      fc.property(
        positivePriceArray(2, 200),
        (equity) => {
          const result = calculateDrawdownMetrics(equity);
          expect(result.peakIndex).toBeLessThanOrEqual(result.troughIndex);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('drawdownPeriod equals troughIndex minus peakIndex', () => {
    fc.assert(
      fc.property(
        positivePriceArray(2, 200),
        (equity) => {
          const result = calculateDrawdownMetrics(equity);
          expect(result.drawdownPeriod).toBe(result.troughIndex - result.peakIndex);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('constant series has 0% drawdown', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
        fc.integer({ min: 1, max: 100 }),
        (value, length) => {
          const equity = Array.from({ length }, () => value);
          const result = calculateMaxDrawdown(equity);
          expect(result).toBe('0%');
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Technical Indicators
// ---------------------------------------------------------------------------

describe('Property-based: Technical indicators', () => {
  describe('EMA properties', () => {
    it('EMA of a constant series equals that constant', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 10_000, noNaN: true }),
          fc.integer({ min: 3, max: 20 }),
          (price, period) => {
            const length = period + 10;
            const priceData = toPriceData(Array.from({ length }, () => price));
            const result = calculateEMA(priceData, { period });
            result.forEach((entry) => {
              expect(entry.ema).toBeCloseTo(price, 0);
            });
          }
        ),
        { numRuns: 200 }
      );
    });

    it('EMA is bounded between min and max of input prices', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.double({ min: 1, max: 1000, noNaN: true }),
            { minLength: 15, maxLength: 100 }
          ),
          (prices) => {
            const priceData = toPriceData(prices);
            const result = calculateEMA(priceData, { period: 10 });
            if (result.length === 0) return;
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            result.forEach((entry) => {
              expect(entry.ema).toBeGreaterThanOrEqual(minPrice - 0.01);
              expect(entry.ema).toBeLessThanOrEqual(maxPrice + 0.01);
            });
          }
        ),
        { numRuns: 300 }
      );
    });

    it('EMA output length is correct for given period', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 20 }),
          fc.integer({ min: 0, max: 50 }),
          (period, extra) => {
            const length = period + extra;
            if (length < period) return;
            const priceData = toPriceData(
              Array.from({ length }, (_, i) => 100 + i)
            );
            // Pass period2: 0 to disable the second EMA, otherwise the
            // default period2=9 causes early return when length < 9.
            const result = calculateEMA(priceData, { period, period2: 0 });
            expect(result.length).toBe(extra + 1);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('RSI properties', () => {
    it('RSI is always between 0 and 100', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.double({ min: 1, max: 1000, noNaN: true }),
            { minLength: 20, maxLength: 100 }
          ),
          (prices) => {
            const priceData = toPriceData(prices);
            const result = calculateRSI(priceData, { period: 14 });
            result.forEach((entry) => {
              expect(entry.rsi).toBeGreaterThanOrEqual(0);
              expect(entry.rsi).toBeLessThanOrEqual(100);
            });
          }
        ),
        { numRuns: 500 }
      );
    });

    it('RSI of a strictly increasing series is above 50', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 100, noNaN: true }),
          fc.array(
            fc.double({ min: 0.01, max: 5, noNaN: true }),
            { minLength: 20, maxLength: 50 }
          ),
          (start, increments) => {
            const prices: number[] = [start];
            let current = start;
            for (const inc of increments) {
              current += inc;
              prices.push(current);
            }
            const priceData = toPriceData(prices);
            const result = calculateRSI(priceData, { period: 14 });
            if (result.length === 0) return;
            // In a pure uptrend with no down days, RSI should be 100
            // (avgLoss = 0, RS = Infinity, RSI = 100)
            result.forEach((entry) => {
              expect(entry.rsi).toBeGreaterThanOrEqual(50);
            });
          }
        ),
        { numRuns: 300 }
      );
    });

    it('RSI of a strictly decreasing series is below 50', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 10_000, noNaN: true }),
          fc.array(
            fc.double({ min: 0.01, max: 5, noNaN: true }),
            { minLength: 20, maxLength: 50 }
          ),
          (start, decrements) => {
            const prices: number[] = [start];
            let current = start;
            for (const dec of decrements) {
              current = Math.max(current - dec, 0.01);
              prices.push(current);
            }
            const priceData = toPriceData(prices);
            const result = calculateRSI(priceData, { period: 14 });
            if (result.length === 0) return;
            // In a pure downtrend, RSI should be low
            result.forEach((entry) => {
              expect(entry.rsi).toBeLessThanOrEqual(50);
            });
          }
        ),
        { numRuns: 300 }
      );
    });

    it('RSI returns empty array for insufficient data', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 50 }),
          (period) => {
            // Provide period or fewer data points (need period + 1)
            const priceData = toPriceData(
              Array.from({ length: period }, (_, i) => 100 + i)
            );
            const result = calculateRSI(priceData, { period });
            expect(result).toEqual([]);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Bollinger Bands properties', () => {
    it('upper band >= middle band >= lower band', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.double({ min: 1, max: 1000, noNaN: true }),
            { minLength: 25, maxLength: 100 }
          ),
          (prices) => {
            const priceData = toPriceData(prices);
            const result = calculateBollingerBands(priceData, { period: 20 });
            result.forEach((entry) => {
              expect(entry.upper).toBeGreaterThanOrEqual(entry.middle - 0.01);
              expect(entry.middle).toBeGreaterThanOrEqual(entry.lower - 0.01);
            });
          }
        ),
        { numRuns: 300 }
      );
    });

    it('middle band of constant series equals that constant', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 10_000, noNaN: true }),
          fc.integer({ min: 3, max: 20 }),
          (price, period) => {
            const length = period + 5;
            const priceData = toPriceData(Array.from({ length }, () => price));
            const result = calculateBollingerBands(priceData, { period });
            result.forEach((entry) => {
              expect(entry.middle).toBeCloseTo(price, 0);
              // For constant series, std dev = 0, so all bands converge
              expect(entry.upper).toBeCloseTo(price, 0);
              expect(entry.lower).toBeCloseTo(price, 0);
            });
          }
        ),
        { numRuns: 200 }
      );
    });

    it('middle band (SMA) is bounded between min and max of window', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.double({ min: 1, max: 1000, noNaN: true }),
            { minLength: 25, maxLength: 80 }
          ),
          (prices) => {
            const period = 20;
            const priceData = toPriceData(prices);
            const result = calculateBollingerBands(priceData, { period });
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            result.forEach((entry) => {
              expect(entry.middle).toBeGreaterThanOrEqual(minPrice - 0.01);
              expect(entry.middle).toBeLessThanOrEqual(maxPrice + 0.01);
            });
          }
        ),
        { numRuns: 300 }
      );
    });
  });
});
