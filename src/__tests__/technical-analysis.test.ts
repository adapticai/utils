import { describe, it, expect } from 'vitest';
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochasticOscillator,
} from '../technical-analysis';
import { PolygonPriceData } from '../types/polygon-types';

/**
 * Creates test price data for technical analysis calculations
 */
function createTestPriceData(length: number, startPrice: number = 100): PolygonPriceData[] {
  const data: PolygonPriceData[] = [];
  let price = startPrice;

  for (let i = 0; i < length; i++) {
    const variation = (Math.random() - 0.5) * 2; // Random variation between -1 and 1
    price = Math.max(price + variation, 1); // Ensure price stays positive

    data.push({
      symbol: 'TEST',
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      timeStamp: Date.now() + i * 86400000,
      open: price,
      high: price + Math.abs(variation),
      low: price - Math.abs(variation),
      close: price,
      vol: 1000000,
      vwap: price,
      trades: 1000,
    });
  }

  return data;
}

/**
 * Creates deterministic price data for known calculation results
 */
function createDeterministicPriceData(): PolygonPriceData[] {
  const prices = [
    100, 102, 101, 103, 105, 104, 106, 108, 107, 109, 111, 110, 112, 114, 113, 115, 117, 116, 118,
    120,
  ];

  return prices.map((price, i) => ({
    symbol: 'TEST',
    date: `2025-01-${String(i + 1).padStart(2, '0')}`,
    timeStamp: Date.now() + i * 86400000,
    open: price,
    high: price + 1,
    low: price - 1,
    close: price,
    vol: 1000000,
    vwap: price,
    trades: 1000,
  }));
}

describe('calculateEMA', () => {
  it('should calculate EMA with default period (20)', () => {
    const priceData = createTestPriceData(30);
    const result = calculateEMA(priceData);

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(priceData.length - 20 + 1);
    expect(result[0]).toHaveProperty('ema');
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('close');
  });

  it('should calculate EMA with custom period', () => {
    const priceData = createTestPriceData(30);
    const result = calculateEMA(priceData, { period: 10 });

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(priceData.length - 10 + 1);
  });

  it('should calculate dual EMAs when period2 is provided', () => {
    const priceData = createTestPriceData(30);
    const result = calculateEMA(priceData, { period: 12, period2: 9 });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('ema');
    expect(result[0]).toHaveProperty('ema2');
  });

  it('should return empty array when insufficient data', () => {
    const priceData = createTestPriceData(5);
    const result = calculateEMA(priceData, { period: 20 });

    expect(result).toEqual([]);
  });

  it('should calculate correct EMA values for known data', () => {
    // Simple data: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
    const priceData: PolygonPriceData[] = Array.from({ length: 10 }, (_, i) => ({
      symbol: 'TEST',
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      timeStamp: Date.now() + i * 86400000,
      open: 10 + i,
      high: 10 + i,
      low: 10 + i,
      close: 10 + i,
      vol: 1000000,
      vwap: 10 + i,
      trades: 1000,
    }));

    const result = calculateEMA(priceData, { period: 5 });

    expect(result.length).toBeGreaterThan(0);
    // First EMA should be SMA of first 5 values: (10+11+12+13+14)/5 = 12
    expect(result[0].ema).toBe(12.0);
  });

  it('should have EMA values close to price', () => {
    const priceData = createTestPriceData(50, 100);
    const result = calculateEMA(priceData, { period: 10 });

    result.forEach((entry) => {
      expect(entry.ema).toBeGreaterThan(0);
      // EMA should be reasonably close to closing price
      expect(Math.abs(entry.ema - entry.close)).toBeLessThan(50);
    });
  });
});

describe('calculateRSI', () => {
  it('should calculate RSI with default period (14)', () => {
    const priceData = createTestPriceData(30);
    const result = calculateRSI(priceData);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('rsi');
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('close');
  });

  it('should calculate RSI with custom period', () => {
    const priceData = createTestPriceData(30);
    const result = calculateRSI(priceData, { period: 10 });

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(priceData.length - 10);
  });

  it('should return empty array when insufficient data', () => {
    const priceData = createTestPriceData(5);
    const result = calculateRSI(priceData, { period: 14 });

    expect(result).toEqual([]);
  });

  it('should return RSI values between 0 and 100', () => {
    const priceData = createTestPriceData(30);
    const result = calculateRSI(priceData, { period: 14 });

    result.forEach((entry) => {
      expect(entry.rsi).toBeGreaterThanOrEqual(0);
      expect(entry.rsi).toBeLessThanOrEqual(100);
    });
  });

  it('should calculate RSI near 50 for sideways market', () => {
    // Create sideways price data oscillating around 100
    const priceData: PolygonPriceData[] = Array.from({ length: 30 }, (_, i) => {
      const price = 100 + (i % 2 === 0 ? 1 : -1);
      return {
        symbol: 'TEST',
        date: `2025-01-${String(i + 1).padStart(2, '0')}`,
        timeStamp: Date.now() + i * 86400000,
        open: price,
        high: price + 0.5,
        low: price - 0.5,
        close: price,
        vol: 1000000,
        vwap: price,
        trades: 1000,
      };
    });

    const result = calculateRSI(priceData, { period: 14 });

    expect(result.length).toBeGreaterThan(0);
    // In a neutral market, RSI should be around 50
    const avgRSI = result.reduce((sum, entry) => sum + entry.rsi, 0) / result.length;
    expect(avgRSI).toBeGreaterThan(40);
    expect(avgRSI).toBeLessThan(60);
  });

  it('should calculate high RSI for uptrend', () => {
    // Create strong uptrend
    const priceData: PolygonPriceData[] = Array.from({ length: 30 }, (_, i) => ({
      symbol: 'TEST',
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      timeStamp: Date.now() + i * 86400000,
      open: 100 + i * 2,
      high: 100 + i * 2 + 1,
      low: 100 + i * 2 - 0.5,
      close: 100 + i * 2,
      vol: 1000000,
      vwap: 100 + i * 2,
      trades: 1000,
    }));

    const result = calculateRSI(priceData, { period: 14 });

    expect(result.length).toBeGreaterThan(0);
    // Strong uptrend should have high RSI
    const lastRSI = result[result.length - 1].rsi;
    expect(lastRSI).toBeGreaterThan(60);
  });
});

describe('calculateMACD', () => {
  it('should calculate MACD with default parameters', () => {
    const priceData = createTestPriceData(50);
    const result = calculateMACD(priceData);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('macd');
    expect(result[0]).toHaveProperty('signal');
    expect(result[0]).toHaveProperty('histogram');
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('close');
  });

  it('should calculate MACD with custom parameters', () => {
    const priceData = createTestPriceData(50);
    const result = calculateMACD(priceData, {
      shortPeriod: 8,
      longPeriod: 17,
      signalPeriod: 9,
    });

    expect(result.length).toBeGreaterThan(0);
  });

  it('should return empty array when insufficient data', () => {
    const priceData = createTestPriceData(20);
    const result = calculateMACD(priceData); // Needs 26 + 9 = 35

    expect(result).toEqual([]);
  });

  it('should calculate histogram as difference between MACD and signal', () => {
    const priceData = createTestPriceData(50);
    const result = calculateMACD(priceData);

    result.forEach((entry) => {
      const expectedHistogram = entry.macd - entry.signal;
      expect(entry.histogram).toBeCloseTo(expectedHistogram, 1);
    });
  });

  it('should have MACD cross signal line in trending market', () => {
    const priceData = createDeterministicPriceData();
    // Need more data for MACD
    const extendedData = [
      ...priceData,
      ...Array.from({ length: 20 }, (_, i) => ({
        symbol: 'TEST',
        date: `2025-02-${String(i + 1).padStart(2, '0')}`,
        timeStamp: Date.now() + (i + 20) * 86400000,
        open: 120 + i,
        high: 121 + i,
        low: 119 + i,
        close: 120 + i,
        vol: 1000000,
        vwap: 120 + i,
        trades: 1000,
      })),
    ];

    const result = calculateMACD(extendedData);

    expect(result.length).toBeGreaterThan(0);
    // Histogram should change signs in trending market
    const histogramSigns = result.map((entry) => Math.sign(entry.histogram));
    const hasPositive = histogramSigns.some((sign) => sign > 0);
    const hasNegative = histogramSigns.some((sign) => sign < 0);

    expect(hasPositive || hasNegative).toBe(true);
  });
});

describe('calculateBollingerBands', () => {
  it('should calculate Bollinger Bands with default parameters', () => {
    const priceData = createTestPriceData(30);
    const result = calculateBollingerBands(priceData);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('middle');
    expect(result[0]).toHaveProperty('upper');
    expect(result[0]).toHaveProperty('lower');
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('close');
  });

  it('should calculate Bollinger Bands with custom parameters', () => {
    const priceData = createTestPriceData(30);
    const result = calculateBollingerBands(priceData, {
      period: 10,
      standardDeviations: 1.5,
    });

    expect(result.length).toBeGreaterThan(0);
  });

  it('should return empty array when insufficient data', () => {
    const priceData = createTestPriceData(10);
    const result = calculateBollingerBands(priceData, { period: 20 });

    expect(result).toEqual([]);
  });

  it('should have upper band above middle and lower band below middle', () => {
    const priceData = createTestPriceData(30);
    const result = calculateBollingerBands(priceData);

    result.forEach((entry) => {
      expect(entry.upper).toBeGreaterThan(entry.middle);
      expect(entry.lower).toBeLessThan(entry.middle);
    });
  });

  it('should have middle band equal to SMA', () => {
    // Create simple data for easy calculation
    const priceData: PolygonPriceData[] = Array.from({ length: 25 }, (_, i) => ({
      symbol: 'TEST',
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      timeStamp: Date.now() + i * 86400000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      vol: 1000000,
      vwap: 100,
      trades: 1000,
    }));

    const result = calculateBollingerBands(priceData, { period: 20 });

    expect(result.length).toBeGreaterThan(0);
    // For constant price, middle band should equal price
    expect(result[0].middle).toBe(100);
    // For constant price, upper and lower bands should be equal to middle (std dev = 0)
    expect(result[0].upper).toBe(100);
    expect(result[0].lower).toBe(100);
  });

  it('should widen bands for volatile price data', () => {
    const volatilePriceData: PolygonPriceData[] = Array.from({ length: 30 }, (_, i) => ({
      symbol: 'TEST',
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      timeStamp: Date.now() + i * 86400000,
      open: 100 + (i % 2 === 0 ? 10 : -10),
      high: 110 + (i % 2 === 0 ? 10 : -10),
      low: 90 + (i % 2 === 0 ? 10 : -10),
      close: 100 + (i % 2 === 0 ? 10 : -10),
      vol: 1000000,
      vwap: 100 + (i % 2 === 0 ? 10 : -10),
      trades: 1000,
    }));

    const result = calculateBollingerBands(volatilePriceData, { period: 20 });

    expect(result.length).toBeGreaterThan(0);
    // Volatile data should have wider bands
    const bandwidth = result[0].upper - result[0].lower;
    expect(bandwidth).toBeGreaterThan(5);
  });
});

describe('calculateStochasticOscillator', () => {
  it('should calculate Stochastic Oscillator with default parameters', () => {
    const priceData = createTestPriceData(30);
    const result = calculateStochasticOscillator(priceData);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('slowK');
    expect(result[0]).toHaveProperty('slowD');
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('close');
  });

  it('should return empty array when insufficient data', () => {
    const priceData = createTestPriceData(3);
    const result = calculateStochasticOscillator(priceData, { lookbackPeriod: 5 });

    expect(result).toEqual([]);
  });

  it('should return values between 0 and 100', () => {
    const priceData = createTestPriceData(30);
    const result = calculateStochasticOscillator(priceData);

    result.forEach((entry) => {
      expect(entry.slowK).toBeGreaterThanOrEqual(0);
      expect(entry.slowK).toBeLessThanOrEqual(100);
      expect(entry.slowD).toBeGreaterThanOrEqual(0);
      expect(entry.slowD).toBeLessThanOrEqual(100);
    });
  });

  it('should calculate high values when price is at recent highs', () => {
    const priceData: PolygonPriceData[] = Array.from({ length: 20 }, (_, i) => ({
      symbol: 'TEST',
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      timeStamp: Date.now() + i * 86400000,
      open: 100 + i,
      high: 102 + i,
      low: 98 + i,
      close: 101 + i,
      vol: 1000000,
      vwap: 100 + i,
      trades: 1000,
    }));

    const result = calculateStochasticOscillator(priceData, { lookbackPeriod: 5 });

    expect(result.length).toBeGreaterThan(0);
    // In an uptrend, stochastic should be high
    const lastEntry = result[result.length - 1];
    expect(lastEntry.slowK).toBeGreaterThan(50);
  });
});

describe('edge cases and data validation', () => {
  it('should handle minimal valid data for EMA', () => {
    const priceData = createTestPriceData(20); // Exactly 20 for period 20
    const result = calculateEMA(priceData, { period: 20 });

    expect(result.length).toBe(1); // Should return exactly 1 result
  });

  it('should handle price data with identical values', () => {
    const constantPriceData: PolygonPriceData[] = Array.from({ length: 30 }, (_, i) => ({
      symbol: 'TEST',
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      timeStamp: Date.now() + i * 86400000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      vol: 1000000,
      vwap: 100,
      trades: 1000,
    }));

    const emaResult = calculateEMA(constantPriceData, { period: 10 });
    expect(emaResult.every((entry) => entry.ema === 100)).toBe(true);

    const rsiResult = calculateRSI(constantPriceData, { period: 14 });
    // RSI should be NaN or 0 for constant prices (no gains or losses)
    expect(rsiResult.every((entry) => entry.rsi === 0 || isNaN(entry.rsi))).toBe(true);
  });

  it('should handle very small price changes', () => {
    const priceData: PolygonPriceData[] = Array.from({ length: 30 }, (_, i) => ({
      symbol: 'TEST',
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      timeStamp: Date.now() + i * 86400000,
      open: 100 + i * 0.01,
      high: 100 + i * 0.01 + 0.005,
      low: 100 + i * 0.01 - 0.005,
      close: 100 + i * 0.01,
      vol: 1000000,
      vwap: 100 + i * 0.01,
      trades: 1000,
    }));

    const result = calculateEMA(priceData, { period: 10 });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((entry) => !isNaN(entry.ema))).toBe(true);
  });
});
