import { describe, expect, it } from "vitest";
import {
  calculateRollingExpectancy,
  calculateRollingHitRate,
  calculateRollingProfitFactor,
  calculateRollingSortino,
  calculateBacktestDivergenceZ,
} from "../strategy-metrics";

describe("calculateRollingExpectancy", () => {
  it("returns null when fewer than window trades", () => {
    expect(calculateRollingExpectancy([10, 5], 20)).toBeNull();
  });

  it("returns average of most-recent window", () => {
    const pnl = Array.from({ length: 30 }, (_, i) => i); // 0..29; last 20 = 10..29; avg = 19.5
    expect(calculateRollingExpectancy(pnl, 20)).toBeCloseTo(19.5, 6);
  });

  it("throws on non-positive or non-integer windowSize", () => {
    expect(() => calculateRollingExpectancy([1, 2, 3], 0)).toThrow(/positive integer/);
    expect(() => calculateRollingExpectancy([1, 2, 3], -1)).toThrow(/positive integer/);
    expect(() => calculateRollingExpectancy([1, 2, 3], 1.5)).toThrow(/positive integer/);
  });

  it("throws on non-finite inputs", () => {
    expect(() => calculateRollingExpectancy([1, NaN, 3], 2)).toThrow(/non-finite/);
    expect(() => calculateRollingExpectancy([1, Infinity, 3], 2)).toThrow(/non-finite/);
  });
});

describe("calculateRollingHitRate", () => {
  it("computes wins / total in window", () => {
    const pnl = [10, 5, 8, 3, 7, 2, 6, 1, 5, 4, 3, 2, 1, -10, -9, -8, -7, -6, -5, -4];
    expect(calculateRollingHitRate(pnl, 20)).toBeCloseTo(13 / 20, 6);
  });

  it("treats zero P&L as non-win (strict positive)", () => {
    expect(calculateRollingHitRate([0, 0, 0, 1], 4)).toBeCloseTo(1 / 4, 6);
  });

  it("returns null when fewer than window trades", () => {
    expect(calculateRollingHitRate([1, 2], 20)).toBeNull();
  });
});

describe("calculateRollingProfitFactor", () => {
  it("returns sum(wins) / |sum(losses)|", () => {
    const pnl = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 10 : -5));
    // 10 wins of 10 = 100; 10 losses of -5 = -50; pf = 100 / 50 = 2
    expect(calculateRollingProfitFactor(pnl, 20)).toBeCloseTo(2, 6);
  });

  it("returns +Infinity when no losses but at least one win", () => {
    expect(calculateRollingProfitFactor(Array.from({ length: 20 }, () => 5), 20))
      .toBe(Number.POSITIVE_INFINITY);
  });

  it("returns 0 when no wins and no losses (all zeros)", () => {
    expect(calculateRollingProfitFactor(Array.from({ length: 20 }, () => 0), 20)).toBe(0);
  });

  it("returns null when fewer than window trades", () => {
    expect(calculateRollingProfitFactor([1, 2], 20)).toBeNull();
  });
});

describe("calculateRollingSortino", () => {
  it("returns null when fewer than window samples", () => {
    expect(calculateRollingSortino([0.01, 0.02], 20)).toBeNull();
  });

  it("delegates to risk-metrics Sortino for the rolling window", () => {
    // Mixed positive and negative returns
    const r = Array.from({ length: 30 }, (_, i) => ((i % 2 === 0) ? 0.01 : -0.005));
    const s = calculateRollingSortino(r, 20);
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!)).toBe(true);
    expect(s!).toBeGreaterThan(0);
  });
});

describe("calculateBacktestDivergenceZ", () => {
  it("returns 0 when live equals backtest", () => {
    expect(calculateBacktestDivergenceZ(0.1, 0.1, 0.01)).toBeCloseTo(0, 6);
  });
  it("returns positive Z when live > backtest", () => {
    expect(calculateBacktestDivergenceZ(0.12, 0.1, 0.01)).toBeCloseTo(2, 6);
  });
  it("returns negative Z when live < backtest", () => {
    expect(calculateBacktestDivergenceZ(0.08, 0.1, 0.01)).toBeCloseTo(-2, 6);
  });
  it("throws on zero or negative stddev", () => {
    expect(() => calculateBacktestDivergenceZ(0.1, 0.1, 0)).toThrow(/stddev/);
    expect(() => calculateBacktestDivergenceZ(0.1, 0.1, -0.01)).toThrow(/stddev/);
  });
  it("throws on non-finite inputs", () => {
    expect(() => calculateBacktestDivergenceZ(NaN, 0.1, 0.01)).toThrow();
    expect(() => calculateBacktestDivergenceZ(0.1, Infinity, 0.01)).toThrow();
  });
});
