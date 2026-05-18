import { describe, expect, it } from "vitest";
import {
  calculateRealizedVolatility,
  calculateEWMAVolatility,
  detectVolatilityRegime,
  annualiseVolatility,
} from "../volatility";

describe("calculateRealizedVolatility", () => {
  it("returns null for insufficient samples", () => {
    expect(calculateRealizedVolatility([0.01], 20)).toBeNull();
  });

  it("computes stddev of returns over window", () => {
    const returns = Array.from({ length: 30 }, () => 0.01); // zero variance
    expect(calculateRealizedVolatility(returns, 20)).toBeCloseTo(0, 9);
  });

  it("returns positive value for noisy returns", () => {
    const returns = [0.01, -0.02, 0.015, -0.01, 0.005, -0.005, 0.02, -0.015,
                     0.01, -0.01, 0.012, -0.018, 0.014, -0.011, 0.009, -0.013,
                     0.008, -0.007, 0.016, -0.014, 0.011, -0.009];
    const v = calculateRealizedVolatility(returns, 20);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0);
    expect(v!).toBeCloseTo(0.012563103873938497, 4);
  });

  it("throws on non-integer or window < 2", () => {
    expect(() => calculateRealizedVolatility([0.01, 0.02, 0.03], 1)).toThrow(/integer >= 2/);
    expect(() => calculateRealizedVolatility([0.01, 0.02, 0.03], 0)).toThrow(/integer >= 2/);
    expect(() => calculateRealizedVolatility([0.01, 0.02, 0.03], -5)).toThrow(/integer >= 2/);
    expect(() => calculateRealizedVolatility([0.01, 0.02, 0.03], 1.5)).toThrow(/integer >= 2/);
  });
});

describe("calculateEWMAVolatility", () => {
  it("returns null on empty", () => {
    expect(calculateEWMAVolatility([], 0.94)).toBeNull();
  });

  it("returns finite positive value for non-trivial returns", () => {
    const returns = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.01);
    const v = calculateEWMAVolatility(returns, 0.94);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0);
    expect(Number.isFinite(v!)).toBe(true);
  });

  it("throws on lambda outside (0,1)", () => {
    expect(() => calculateEWMAVolatility([0.01, 0.02], 0)).toThrow();
    expect(() => calculateEWMAVolatility([0.01, 0.02], 1)).toThrow();
    expect(() => calculateEWMAVolatility([0.01, 0.02], -0.5)).toThrow();
  });

  it("returns |r[0]| for single-element input (seed only)", () => {
    expect(calculateEWMAVolatility([0.03], 0.94)).toBeCloseTo(0.03, 9);
    expect(calculateEWMAVolatility([-0.05], 0.94)).toBeCloseTo(0.05, 9);
  });
});

describe("detectVolatilityRegime", () => {
  it("classifies calm vol", () => {
    expect(detectVolatilityRegime(0.005, { calmMax: 0.01, elevatedMax: 0.025, crisisMin: 0.04 }))
      .toBe("calm");
  });

  it("classifies crisis", () => {
    expect(detectVolatilityRegime(0.06, { calmMax: 0.01, elevatedMax: 0.025, crisisMin: 0.04 }))
      .toBe("crisis");
  });

  it("classifies normal", () => {
    expect(detectVolatilityRegime(0.015, { calmMax: 0.01, elevatedMax: 0.025, crisisMin: 0.04 }))
      .toBe("normal");
  });

  it("classifies elevated", () => {
    expect(detectVolatilityRegime(0.03, { calmMax: 0.01, elevatedMax: 0.025, crisisMin: 0.04 }))
      .toBe("elevated");
  });

  it("throws on bands not strictly ordered", () => {
    expect(() => detectVolatilityRegime(0.01, { calmMax: 0.03, elevatedMax: 0.02, crisisMin: 0.05 }))
      .toThrow(/calmMax < elevatedMax < crisisMin/);
    expect(() => detectVolatilityRegime(0.01, { calmMax: 0.01, elevatedMax: 0.02, crisisMin: 0.02 }))
      .toThrow(/calmMax < elevatedMax < crisisMin/);
  });
});

describe("annualiseVolatility", () => {
  it("scales daily vol by sqrt(252)", () => {
    expect(annualiseVolatility(0.01, "daily")).toBeCloseTo(0.01 * Math.sqrt(252), 6);
  });
  it("scales hourly vol by sqrt(252*6.5)", () => {
    expect(annualiseVolatility(0.005, "hourly")).toBeCloseTo(0.005 * Math.sqrt(252 * 6.5), 6);
  });
  it("scales minute vol by sqrt(252*6.5*60)", () => {
    expect(annualiseVolatility(0.001, "minute")).toBeCloseTo(0.001 * Math.sqrt(252 * 6.5 * 60), 6);
  });
});
