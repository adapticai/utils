import { describe, it, expect, vi } from "vitest";

// Mock @adaptic/backend-legacy before importing the module under test.
// price-utils.ts has a top-level import of @adaptic/backend-legacy.
vi.mock("@adaptic/backend-legacy", () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
  },
  enums: {
    AssetType: { STOCK: "STOCK" },
  },
  types: {},
}));

vi.mock("../alpaca/legacy", () => ({
  getOrder: vi.fn(),
}));

import { getEquityValues, roundStockPrice } from "../price-utils";
import type { EquityPoint } from "../types";
import type { Time } from "lightweight-charts";

describe("roundStockPrice", () => {
  it("should round prices >= $1 to nearest cent", () => {
    expect(roundStockPrice(10.456)).toBe(10.46);
  });

  it("should round prices >= $1 down correctly", () => {
    expect(roundStockPrice(10.454)).toBe(10.45);
  });

  it("should round exactly $1 to cents", () => {
    // Note: 1.005 * 100 = 100.49999... in IEEE 754 floating point, so Math.round gives 100
    expect(roundStockPrice(1.005)).toBe(1.0);
    expect(roundStockPrice(1.006)).toBe(1.01);
  });

  it("should round prices < $1 to nearest $0.0001", () => {
    expect(roundStockPrice(0.12345)).toBe(0.1235);
  });

  it("should round small prices < $1 down correctly", () => {
    expect(roundStockPrice(0.12344)).toBe(0.1234);
  });

  it("should handle exact penny values", () => {
    expect(roundStockPrice(10.0)).toBe(10.0);
  });

  it("should handle zero", () => {
    expect(roundStockPrice(0)).toBe(0);
  });

  it("should handle negative prices", () => {
    // For negative prices >= 1 in absolute value, the function uses
    // Math.round(price * 100) / 100. Since -5.456 >= 1 is false,
    // it falls into the sub-dollar path: Math.round(-5.456 * 10000) / 10000
    expect(roundStockPrice(-5.456)).toBe(-5.456);
    // Negative values are edge cases; the function is designed for positive prices
  });

  it("should handle very small sub-penny prices", () => {
    // 0.00015 * 10000 = 1.5, Math.round(1.5) = 2, result = 0.0002
    // However, floating point: 0.00015 * 10000 = 1.4999... so Math.round gives 1
    expect(roundStockPrice(0.00015)).toBe(0.0001);
    expect(roundStockPrice(0.00016)).toBe(0.0002);
  });

  it("should handle prices just below $1", () => {
    expect(roundStockPrice(0.99999)).toBe(1.0);
  });

  it("should handle whole dollar amounts", () => {
    expect(roundStockPrice(100)).toBe(100);
  });

  it("should handle very large prices", () => {
    expect(roundStockPrice(5000.999)).toBe(5001.0);
  });

  it("should handle penny stocks at exact thresholds", () => {
    expect(roundStockPrice(0.5)).toBe(0.5);
    expect(roundStockPrice(0.50005)).toBe(0.5001);
  });

  it("should handle boundary at exactly $1", () => {
    // At exactly $1, should round to cents (price >= 1)
    expect(roundStockPrice(1.0)).toBe(1.0);
    expect(roundStockPrice(1.001)).toBe(1.0);
    expect(roundStockPrice(1.006)).toBe(1.01);
    // Note: 1.015 * 100 = 101.49999... in IEEE 754, so Math.round gives 101
    expect(roundStockPrice(1.015)).toBe(1.01);
    expect(roundStockPrice(1.016)).toBe(1.02);
  });
});

describe("getEquityValues — DE-005 regression", () => {
  /**
   * Builds a representative `EquityPoint[]` series with monotonically
   * increasing UTC-second timestamps and known values. The resulting last
   * value is the canonical answer for `latestEquity` so the regression test
   * pins exact behaviour.
   */
  function buildEquitySeries(
    values: number[],
    startEpochSeconds = 1_736_510_400, // 2025-01-10T12:00Z, arbitrary
  ): EquityPoint[] {
    return values.map((value, idx) => ({
      // Lightweight-charts `Time` accepts a UTC epoch-second `number`.
      time: (startEpochSeconds + idx * 60) as Time,
      value,
    }));
  }

  it("returns a finite latestEquity (regression for un-invoked valueOf bug)", () => {
    const series = buildEquitySeries([100_000, 100_500, 101_000, 101_750]);

    const result = getEquityValues(series);

    // Before the DE-005 fix, this expression read `Number(latestPoint.valueOf)`,
    // which evaluated to NaN. We assert finiteness explicitly so a regression
    // would be caught even if a future change reintroduced a similar bug.
    expect(Number.isFinite(result.latestEquity)).toBe(true);
    expect(Number.isNaN(result.latestEquity)).toBe(false);
  });

  it("returns the actual latest value, not NaN", () => {
    const series = buildEquitySeries([100_000, 100_500, 101_000, 101_750]);

    const result = getEquityValues(series);

    // The known last value of the series.
    expect(result.latestEquity).toBe(101_750);
  });

  it("returns the first value as initialEquity for an unspecified period", () => {
    const series = buildEquitySeries([100_000, 100_500, 101_000, 101_750]);

    const result = getEquityValues(series);

    expect(result.initialEquity).toBe(100_000);
  });

  it("returns latestTimestamp matching the last point's time", () => {
    const series = buildEquitySeries([1, 2, 3]);

    const result = getEquityValues(series);

    expect(result.latestTimestamp).toBe(series[series.length - 1].time);
  });

  it("handles a single-point series without producing NaN", () => {
    const series = buildEquitySeries([42_000]);

    const result = getEquityValues(series);

    expect(Number.isFinite(result.latestEquity)).toBe(true);
    expect(result.latestEquity).toBe(42_000);
  });

  it("returns 0/0 for an empty series (existing behaviour preserved)", () => {
    const result = getEquityValues([]);

    expect(result.latestEquity).toBe(0);
    expect(result.initialEquity).toBe(0);
  });

  it("filters NaN/Infinity values from the input series", () => {
    const series: EquityPoint[] = [
      { time: 1_736_510_400 as Time, value: 100_000 },
      { time: 1_736_510_460 as Time, value: Number.NaN },
      { time: 1_736_510_520 as Time, value: Number.POSITIVE_INFINITY },
      { time: 1_736_510_580 as Time, value: 101_500 },
    ];

    const result = getEquityValues(series);

    expect(Number.isFinite(result.latestEquity)).toBe(true);
    expect(result.latestEquity).toBe(101_500);
  });
});
