import { describe, expect, it } from "vitest";
import { calculateATR, calculateATREMA, calculateATRMultiTimespan } from "../atr";

describe("calculateATR (Wilder)", () => {
  it("returns null when insufficient bars", () => {
    expect(calculateATR([1, 2], [1, 2], [1, 2], 14)).toBeNull();
  });

  it("computes ATR for a known sequence", () => {
    const highs = [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18, 17, 19, 20];
    const lows = [8, 9, 10, 9, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18];
    const closes = [9, 10, 11, 10, 12, 13, 12, 14, 15, 14, 16, 17, 16, 18, 19];
    const atr = calculateATR(highs, lows, closes, 14);
    expect(atr).not.toBeNull();
    expect(atr!).toBeCloseTo(2.29, 2);
  });

  it("throws on mismatched array lengths", () => {
    expect(() => calculateATR([1, 2, 3], [1, 2], [1, 2, 3], 14)).toThrow(/length/i);
  });

  it("throws on non-positive or non-integer period", () => {
    expect(() => calculateATR([1, 2, 3], [1, 2, 3], [1, 2, 3], 0)).toThrow(/positive integer/i);
    expect(() => calculateATR([1, 2, 3], [1, 2, 3], [1, 2, 3], -1)).toThrow(/positive integer/i);
    expect(() => calculateATR([1, 2, 3], [1, 2, 3], [1, 2, 3], 1.5)).toThrow(/positive integer/i);
  });
});

describe("calculateATREMA", () => {
  it("returns EWMA-smoothed ATR series", () => {
    const highs = Array.from({ length: 30 }, (_, i) => 10 + i);
    const lows = Array.from({ length: 30 }, (_, i) => 8 + i);
    const closes = Array.from({ length: 30 }, (_, i) => 9 + i);
    const series = calculateATREMA(highs, lows, closes, 14);
    expect(series.length).toBe(highs.length);
    expect(series.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(series.slice(14).every((v) => v !== null && v! > 0)).toBe(true);
  });
});

describe("calculateATRMultiTimespan", () => {
  it("supports minute / hour / day timespans with same math", () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({
      high: 10 + i, low: 8 + i, close: 9 + i, timespan: "hour" as const,
    }));
    const atr = calculateATRMultiTimespan(bars, 14);
    expect(atr).not.toBeNull();
  });
});
