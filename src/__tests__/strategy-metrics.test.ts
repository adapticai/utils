import { describe, expect, it } from "vitest";
import {
  calculateRollingExpectancy,
  calculateRollingHitRate,
  calculateRollingProfitFactor,
  calculateRollingSortino,
  calculateBacktestDivergenceZ,
} from "../strategy-metrics";
import { availableStatistic, sampleCohort } from "../sample-statistic";
import { measured } from "./support/statistic";

describe("calculateRollingExpectancy", () => {
  it("reports an under-filled window as insufficient samples, with what it had", () => {
    expect(calculateRollingExpectancy([10, 5], 20)).toMatchObject({
      available: false,
      reason: "insufficient_samples",
      requestedCount: 20,
      sampleCount: 2,
      coverage: 0.1,
    });
  });

  it("returns average of most-recent window", () => {
    const pnl = Array.from({ length: 30 }, (_, i) => i); // 0..29; last 20 = 10..29; avg = 19.5
    expect(measured(calculateRollingExpectancy(pnl, 20))).toBeCloseTo(19.5, 6);
  });

  it("carries the cohort the mean was taken over, not the length of the input", () => {
    const pnl = Array.from({ length: 30 }, (_, i) => i);
    expect(calculateRollingExpectancy(pnl, 20)).toMatchObject({
      available: true,
      requestedCount: 20,
      sampleCount: 20,
      coverage: 1,
    });
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
    expect(measured(calculateRollingHitRate(pnl, 20))).toBeCloseTo(13 / 20, 6);
  });

  it("reports the WINDOW as its cohort, not the length of the series handed to it", () => {
    // 30 trades offered, 10 measured. A hit-rate of 0.6 over 10 trades and the
    // same 0.6 over 30 are different claims, and a cohort that quietly reports
    // the input length instead of the window is the population/unit
    // substitution this type exists to block. The two counts must differ here
    // or the assertion cannot tell them apart.
    const pnl = Array.from({ length: 30 }, (_, i) => (i % 5 < 3 ? 1 : -1));
    const windowed = calculateRollingHitRate(pnl, 10);

    expect(measured(windowed)).toBeCloseTo(0.6, 6);
    expect(windowed).toMatchObject({
      available: true,
      sampleCount: 10,
      requestedCount: 10,
      coverage: 1,
    });
  });

  it("treats zero P&L as non-win (strict positive)", () => {
    expect(measured(calculateRollingHitRate([0, 0, 0, 1], 4))).toBeCloseTo(1 / 4, 6);
  });

  it("reports an under-filled window as insufficient samples", () => {
    expect(calculateRollingHitRate([1, 2], 20)).toMatchObject({
      available: false,
      reason: "insufficient_samples",
      requestedCount: 20,
      sampleCount: 2,
      coverage: 0.1,
    });
  });
});

describe("calculateRollingProfitFactor", () => {
  it("returns sum(wins) / |sum(losses)|", () => {
    const pnl = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 10 : -5));
    // 10 wins of 10 = 100; 10 losses of -5 = -50; pf = 100 / 50 = 2
    expect(measured(calculateRollingProfitFactor(pnl, 20))).toBeCloseTo(2, 6);
  });

  it("returns +Infinity when no losses but at least one win", () => {
    expect(
      measured(calculateRollingProfitFactor(Array.from({ length: 20 }, () => 5), 20)),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("reports an all-breakeven window as degenerate, not as a profit factor of 0", () => {
    // 0 / 0 is undefined. Returning 0 reads as "the worst possible profit
    // factor" to any threshold downstream, which is a measurement this window
    // never made.
    expect(
      calculateRollingProfitFactor(Array.from({ length: 20 }, () => 0), 20),
    ).toMatchObject({
      available: false,
      reason: "degenerate_population",
      sampleCount: 20,
      requestedCount: 20,
    });
  });

  it("reports an under-filled window as insufficient samples", () => {
    expect(calculateRollingProfitFactor([1, 2], 20)).toMatchObject({
      available: false,
      reason: "insufficient_samples",
      requestedCount: 20,
      sampleCount: 2,
    });
  });
});

describe("calculateRollingSortino", () => {
  it("reports an under-filled window as insufficient samples", () => {
    expect(calculateRollingSortino([0.01, 0.02], 20)).toMatchObject({
      available: false,
      reason: "insufficient_samples",
      requestedCount: 20,
      sampleCount: 2,
    });
  });

  it("delegates to risk-metrics Sortino for the rolling window", () => {
    // Mixed positive and negative returns
    const r = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.005));
    const s = calculateRollingSortino(r, 20);
    expect(s.available).toBe(true);
    expect(Number.isFinite(measured(s))).toBe(true);
    expect(measured(s)).toBeGreaterThan(0);
    expect(s).toMatchObject({ sampleCount: 20, requestedCount: 20, coverage: 1 });
  });
});

describe("calculateBacktestDivergenceZ", () => {
  const live = (value: number, n = 20) =>
    availableStatistic(value, sampleCohort(n, n));

  it("returns 0 when live equals backtest", () => {
    expect(measured(calculateBacktestDivergenceZ(live(0.1), 0.1, 0.01))).toBeCloseTo(0, 6);
  });
  it("returns positive Z when live > backtest", () => {
    expect(measured(calculateBacktestDivergenceZ(live(0.12), 0.1, 0.01))).toBeCloseTo(2, 6);
  });
  it("returns negative Z when live < backtest", () => {
    expect(measured(calculateBacktestDivergenceZ(live(0.08), 0.1, 0.01))).toBeCloseTo(-2, 6);
  });
  it("inherits the live cohort, so the z-score cannot be read without its n", () => {
    expect(calculateBacktestDivergenceZ(live(0.12, 7), 0.1, 0.01)).toMatchObject({
      available: true,
      sampleCount: 7,
      requestedCount: 7,
    });
  });
  it("propagates an unavailable live expectancy instead of inventing a z-score", () => {
    const unavailableLive = calculateRollingExpectancy([10, 5], 20);
    expect(calculateBacktestDivergenceZ(unavailableLive, 0.1, 0.01)).toMatchObject({
      available: false,
      reason: "insufficient_samples",
      requestedCount: 20,
      sampleCount: 2,
    });
  });
  it("throws on zero or negative stddev", () => {
    expect(() => calculateBacktestDivergenceZ(live(0.1), 0.1, 0)).toThrow(/stddev/);
    expect(() => calculateBacktestDivergenceZ(live(0.1), 0.1, -0.01)).toThrow(/stddev/);
  });
  it("throws on non-finite inputs", () => {
    expect(() => calculateBacktestDivergenceZ(live(NaN), 0.1, 0.01)).toThrow();
    expect(() => calculateBacktestDivergenceZ(live(0.1), Infinity, 0.01)).toThrow();
  });
});
