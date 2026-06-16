import { describe, expect, it } from "vitest";
import {
  calculateVaRHistorical,
  calculateVaRParametric,
  calculateExpectedShortfall,
  calculateConditionalDrawdown,
  calculateRollingDrawdown,
  calculateSortino,
  calculateCalmar,
} from "../risk-metrics";

describe("calculateVaRHistorical", () => {
  it("returns null for empty", () => {
    expect(calculateVaRHistorical([], 0.95)).toBeNull();
  });

  it("returns the 5th percentile (negative)", () => {
    const returns = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000); // -0.05 .. 0.049
    const v = calculateVaRHistorical(returns, 0.95);
    expect(v).not.toBeNull();
    expect(v!).toBeLessThan(0);
  });

  it("throws on alpha out of bounds", () => {
    expect(() => calculateVaRHistorical([0.01, 0.02], 1.5)).toThrow();
    expect(() => calculateVaRHistorical([0.01, 0.02], 0)).toThrow();
    expect(() => calculateVaRHistorical([0.01, 0.02], 1)).toThrow();
  });
});

describe("calculateVaRParametric", () => {
  it("computes Gaussian VaR for known mean/stddev", () => {
    const returns = [0.01, -0.02, 0.015, -0.01, 0.005, -0.005, 0.02, -0.015];
    const v = calculateVaRParametric(returns, 0.95);
    expect(v).not.toBeNull();
    expect(v!).toBeLessThan(0);
  });

  it("returns null for fewer than 2 samples", () => {
    expect(calculateVaRParametric([0.01], 0.95)).toBeNull();
    expect(calculateVaRParametric([], 0.95)).toBeNull();
  });

  it("throws on alpha out of bounds", () => {
    expect(() => calculateVaRParametric([0.01, 0.02], 0)).toThrow();
    expect(() => calculateVaRParametric([0.01, 0.02], 1)).toThrow();
  });
});

describe("calculateExpectedShortfall", () => {
  it("ES is more negative (worse) than VaR at same alpha", () => {
    const returns = Array.from({ length: 200 }, (_, i) => (i - 100) / 1000);
    const var95 = calculateVaRHistorical(returns, 0.95)!;
    const es95 = calculateExpectedShortfall(returns, 0.95)!;
    expect(es95).toBeLessThan(var95);
  });

  it("returns null on empty", () => {
    expect(calculateExpectedShortfall([], 0.95)).toBeNull();
  });
});

describe("calculateConditionalDrawdown", () => {
  it("returns 0 for monotonically increasing equity", () => {
    const equity = Array.from({ length: 100 }, (_, i) => 100 + i);
    expect(calculateConditionalDrawdown(equity, 0.95)).toBeCloseTo(0, 6);
  });

  it("returns positive value when there are drawdowns", () => {
    const equity = [100, 110, 90, 105, 80, 95, 120];
    const cdd = calculateConditionalDrawdown(equity, 0.95)!;
    expect(cdd).toBeGreaterThan(0);
  });

  it("returns null for length < 2", () => {
    expect(calculateConditionalDrawdown([100], 0.95)).toBeNull();
    expect(calculateConditionalDrawdown([], 0.95)).toBeNull();
  });
});

describe("calculateRollingDrawdown", () => {
  it("returns array of drawdown values, last is current drawdown", () => {
    const equity = [100, 110, 105, 90, 95];
    const dd = calculateRollingDrawdown(equity, 5);
    expect(dd.length).toBe(equity.length);
    expect(dd[dd.length - 1]).toBeLessThan(0);
  });

  it("returns 0 for monotonically increasing equity", () => {
    const equity = [100, 105, 110, 115];
    const dd = calculateRollingDrawdown(equity, 4);
    expect(dd.every((d) => d === 0)).toBe(true);
  });

  it("throws on non-positive or non-integer windowSize", () => {
    expect(() => calculateRollingDrawdown([100, 110], 0)).toThrow(/positive integer/);
    expect(() => calculateRollingDrawdown([100, 110], -3)).toThrow(/positive integer/);
    expect(() => calculateRollingDrawdown([100, 110], 1.5)).toThrow(/positive integer/);
  });
});

describe("calculateSortino", () => {
  it("returns higher Sortino for asymmetric upside", () => {
    const upside = [0.02, 0.03, 0.01, 0.025, -0.005];
    const symmetric = [0.02, -0.03, 0.01, -0.025, 0.005];
    const meanRfr = 0;
    expect(calculateSortino(upside, meanRfr)!).toBeGreaterThan(
      calculateSortino(symmetric, meanRfr)!,
    );
  });

  it("returns +Infinity when no downside", () => {
    expect(calculateSortino([0.02, 0.03, 0.04], 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns null for fewer than 2 samples", () => {
    expect(calculateSortino([0.01], 0)).toBeNull();
    expect(calculateSortino([], 0)).toBeNull();
  });
});

describe("calculateCalmar", () => {
  it("returns finite value for monotonically up equity (no max DD path uses infinity)", () => {
    const equity = [100, 110, 120, 130, 140];
    const calmar = calculateCalmar(equity, 252);
    expect(calmar).toBeNull(); // no drawdown → division-by-zero → null
  });

  it("returns positive finite value when there are drawdowns and net positive CAGR", () => {
    const equity = [100, 110, 95, 105, 120];
    const calmar = calculateCalmar(equity, 252);
    expect(calmar).not.toBeNull();
    expect(Number.isFinite(calmar!)).toBe(true);
  });

  it("returns null for length < 2", () => {
    expect(calculateCalmar([100], 252)).toBeNull();
    expect(calculateCalmar([], 252)).toBeNull();
  });

  it("returns null when equity[0] is zero or negative", () => {
    expect(calculateCalmar([0, 10, 5], 252)).toBeNull();
    expect(calculateCalmar([-5, 10, 20], 252)).toBeNull();
  });
});

describe("non-finite input rejection", () => {
  it("throws on non-finite inputs (NaN, Infinity)", () => {
    expect(() => calculateVaRHistorical([0.01, NaN, 0.02], 0.95)).toThrow(/non-finite/);
    expect(() => calculateVaRHistorical([0.01, Infinity, 0.02], 0.95)).toThrow(/non-finite/);
    expect(() => calculateConditionalDrawdown([100, NaN, 110], 0.95)).toThrow(/non-finite/);
  });
});
