import { describe, it, expect, vi } from 'vitest';

// Mock @adaptic/backend-legacy before importing the module under test.
// price-utils.ts has a top-level import of @adaptic/backend-legacy.
vi.mock('@adaptic/backend-legacy', () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
  },
  enums: {
    AssetType: { STOCK: 'STOCK' },
  },
  types: {},
}));

vi.mock('../alpaca/legacy', () => ({
  getOrder: vi.fn(),
}));

import { roundStockPrice } from '../price-utils';

describe('roundStockPrice', () => {
  it('should round prices >= $1 to nearest cent', () => {
    expect(roundStockPrice(10.456)).toBe(10.46);
  });

  it('should round prices >= $1 down correctly', () => {
    expect(roundStockPrice(10.454)).toBe(10.45);
  });

  it('should round exactly $1 to cents', () => {
    // Note: 1.005 * 100 = 100.49999... in IEEE 754 floating point, so Math.round gives 100
    expect(roundStockPrice(1.005)).toBe(1.0);
    expect(roundStockPrice(1.006)).toBe(1.01);
  });

  it('should round prices < $1 to nearest $0.0001', () => {
    expect(roundStockPrice(0.12345)).toBe(0.1235);
  });

  it('should round small prices < $1 down correctly', () => {
    expect(roundStockPrice(0.12344)).toBe(0.1234);
  });

  it('should handle exact penny values', () => {
    expect(roundStockPrice(10.00)).toBe(10.00);
  });

  it('should handle zero', () => {
    expect(roundStockPrice(0)).toBe(0);
  });

  it('should handle negative prices', () => {
    // For negative prices >= 1 in absolute value, the function uses
    // Math.round(price * 100) / 100. Since -5.456 >= 1 is false,
    // it falls into the sub-dollar path: Math.round(-5.456 * 10000) / 10000
    expect(roundStockPrice(-5.456)).toBe(-5.456);
    // Negative values are edge cases; the function is designed for positive prices
  });

  it('should handle very small sub-penny prices', () => {
    // 0.00015 * 10000 = 1.5, Math.round(1.5) = 2, result = 0.0002
    // However, floating point: 0.00015 * 10000 = 1.4999... so Math.round gives 1
    expect(roundStockPrice(0.00015)).toBe(0.0001);
    expect(roundStockPrice(0.00016)).toBe(0.0002);
  });

  it('should handle prices just below $1', () => {
    expect(roundStockPrice(0.99999)).toBe(1.0);
  });

  it('should handle whole dollar amounts', () => {
    expect(roundStockPrice(100)).toBe(100);
  });

  it('should handle very large prices', () => {
    expect(roundStockPrice(5000.999)).toBe(5001.00);
  });

  it('should handle penny stocks at exact thresholds', () => {
    expect(roundStockPrice(0.5)).toBe(0.5);
    expect(roundStockPrice(0.50005)).toBe(0.5001);
  });

  it('should handle boundary at exactly $1', () => {
    // At exactly $1, should round to cents (price >= 1)
    expect(roundStockPrice(1.0)).toBe(1.0);
    expect(roundStockPrice(1.001)).toBe(1.0);
    expect(roundStockPrice(1.006)).toBe(1.01);
    // Note: 1.015 * 100 = 101.49999... in IEEE 754, so Math.round gives 101
    expect(roundStockPrice(1.015)).toBe(1.01);
    expect(roundStockPrice(1.016)).toBe(1.02);
  });
});
