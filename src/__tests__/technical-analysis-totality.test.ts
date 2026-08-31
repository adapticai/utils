import { describe, it, expect } from "vitest";

import {
  calculateRSI,
  calculateEMA,
  calculateMACD,
  calculateBollingerBands,
  calculateSupportAndResistance,
  calculateFibonacciLevels,
  calculateStochasticOscillator,
  roundToPriceScale,
} from "../technical-analysis";
import { MassivePriceData } from "../types";

/**
 * F7.4 (indicator totality) + F7.2 (price-scale rounding) for the
 * `@adaptic/utils` technical-analysis primitives.
 *
 * Two invariants pinned here, each mutation-proven:
 *
 *  F7.4 — no RSI value is `NaN`/`Infinity` on a degenerate window. A perfectly
 *         flat series drove the Wilder ratio to `0 / 0 = NaN` and shipped it as
 *         the RSI. Mutation: revert `rsiFromAverages` to
 *         `100 - 100 / (1 + avgGain / avgLoss)` → the flat cases go NaN → red.
 *
 *  F7.2 — price-scale outputs (Bollinger bands, EMA, MACD components) are
 *         rounded to a scale-appropriate precision, not a hardcoded 2dp that
 *         collapses a sub-penny price to `0.00`. Mutation: revert any
 *         `roundToPriceScale(x)` to `parseFloat(x.toFixed(2))` → the sub-penny
 *         cases collapse to 0 → red.
 */

function series(closes: readonly number[]): MassivePriceData[] {
  return closes.map((close, i) => ({
    symbol: "TEST",
    date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
    timeStamp: 1_700_000_000_000 + i * 86_400_000,
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    vol: 1_000_000,
    vwap: close,
    trades: 1000,
  }));
}

describe("F7.4 calculateRSI totality — no NaN/Inf on degenerate windows", () => {
  it("a perfectly flat window scores the neutral 50 (never NaN)", () => {
    const out = calculateRSI(series(Array.from({ length: 30 }, () => 5)), {
      period: 14,
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e) => Number.isFinite(e.rsi))).toBe(true);
    expect(out.every((e) => e.rsi === 50)).toBe(true);
  });

  it("a strictly rising window scores a finite 100", () => {
    const out = calculateRSI(
      series(Array.from({ length: 30 }, (_, i) => 100 + i)),
      { period: 14 },
    );
    expect(out.every((e) => Number.isFinite(e.rsi))).toBe(true);
    expect(out[out.length - 1].rsi).toBe(100);
  });

  it("a strictly falling window scores a finite 0", () => {
    const out = calculateRSI(
      series(Array.from({ length: 30 }, (_, i) => 100 - i)),
      { period: 14 },
    );
    expect(out.every((e) => Number.isFinite(e.rsi))).toBe(true);
    expect(out[out.length - 1].rsi).toBe(0);
  });

  it("a sub-penny flat window is still finite and neutral", () => {
    const out = calculateRSI(series(Array.from({ length: 30 }, () => 0.0003)), {
      period: 14,
    });
    expect(out.every((e) => Number.isFinite(e.rsi))).toBe(true);
    expect(out.every((e) => e.rsi === 50)).toBe(true);
  });
});

describe("F7.2 price-scale preservation — sub-penny prices are not flattened to 0.00", () => {
  it("Bollinger bands preserve a sub-penny price instead of collapsing to 0", () => {
    const out = calculateBollingerBands(
      series(Array.from({ length: 25 }, () => 0.0003)),
      { period: 20 },
    );
    const last = out[out.length - 1];
    expect(last.middle).toBeCloseTo(0.0003, 6);
    expect(last.middle).toBeGreaterThan(0);
    // Flat series → zero-width band, but at the correct (sub-penny) level.
    expect(last.upper).toBeCloseTo(0.0003, 6);
    expect(last.lower).toBeCloseTo(0.0003, 6);
  });

  it("EMA preserves a sub-penny price scale", () => {
    const out = calculateEMA(series(Array.from({ length: 25 }, () => 0.0003)), {
      period: 10,
      period2: 0,
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e) => Number.isFinite(e.ema))).toBe(true);
    expect(out[out.length - 1].ema).toBeCloseTo(0.0003, 6);
    expect(out[out.length - 1].ema).toBeGreaterThan(0);
  });

  it("MACD components on a low-priced name are not rounded away to 0", () => {
    // A gently trending sub-dollar name: EMA12 - EMA26 is a small but non-zero
    // number that a hardcoded 2dp round would flatten to exactly 0.
    const closes = Array.from({ length: 60 }, (_, i) => 0.02 + i * 0.0001);
    const out = calculateMACD(series(closes));
    expect(out.length).toBeGreaterThan(0);
    const anyNonZeroMacd = out.some((e) => e.macd !== 0);
    expect(anyNonZeroMacd).toBe(true);
    expect(out.every((e) => Number.isFinite(e.macd))).toBe(true);
  });
});

describe("roundToPriceScale — scale-aware quantisation", () => {
  it("keeps the conventional 2dp for prices at or above $1 (common-case parity)", () => {
    expect(roundToPriceScale(150.123456)).toBe(150.12);
    expect(roundToPriceScale(1.005)).toBe(1.0); // 1.005 → 1.00 at 2dp (float)
    expect(roundToPriceScale(4300.5)).toBe(4300.5);
  });

  it("preserves sub-dollar precision instead of flattening to 0.00", () => {
    expect(roundToPriceScale(0.0003)).toBeCloseTo(0.0003, 8);
    expect(roundToPriceScale(0.0003)).toBeGreaterThan(0);
    expect(roundToPriceScale(0.0000007)).toBeGreaterThan(0);
  });

  it("passes non-finite values through untouched (totality is the caller's job)", () => {
    expect(Number.isNaN(roundToPriceScale(Number.NaN))).toBe(true);
    expect(roundToPriceScale(Number.POSITIVE_INFINITY)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(roundToPriceScale(0)).toBe(0);
  });
});

/**
 * Builds bars from explicit OHLCV tuples so pivots, volumes and degenerate
 * values are exactly determined rather than incidental.
 */
function bars(
  rows: Array<{ h: number; l: number; c: number; v: number }>,
): MassivePriceData[] {
  return rows.map(({ h, l, c, v }, i) => ({
    symbol: "TEST",
    date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
    timeStamp: 1_700_000_000_000 + i * 86_400_000,
    open: c,
    high: h,
    low: l,
    close: c,
    vol: v,
    vwap: c,
    trades: 1000,
  }));
}

/** Close sequence with unambiguous alternating pivots at indices 2/8 (highs) and 5/11 (lows). */
const ZIGZAG = [
  100, 102, 104, 102, 100, 98, 100, 102, 104, 102, 100, 98, 100, 102, 104,
];
const PIVOT_INDICES = new Set([2, 5, 8, 11]);

/**
 * Every pivot lands on a zero-volume bar — halted, pre-market-thin or
 * synthetic warm-up bars all report `vol: 0`, and `vol` is a non-optional
 * number so zero is squarely in contract.
 */
const ZERO_VOLUME_PIVOTS = bars(
  ZIGZAG.map((c, i) => ({
    h: c + 1,
    l: c - 1,
    c,
    v: PIVOT_INDICES.has(i) ? 0 : 1_000_000,
  })),
);

/** A single bad tick prints a zero low, which is a zero *reference price*. */
const ZERO_LOW_TICK = bars(
  ZIGZAG.map((c, i) => ({
    h: c + 1,
    l: i === 5 ? 0 : c - 1,
    c,
    v: 1_000_000,
  })),
);

/** The window's first bar carries a zero close — the relative-volatility denominator. */
const ZERO_REFERENCE_CLOSE = bars(
  [0, 102, 104, 102, 100, 98, 100, 102, 104, 102, 100].map((c, i) => ({
    h: i === 0 ? 101 : c + 1,
    l: i === 0 ? 99 : c - 1,
    c,
    v: 1_000_000,
  })),
);

/** The same zigzag at a sub-penny scale: every price is well under $0.01. */
const SUB_PENNY = bars(
  ZIGZAG.map((c) => {
    const price = c * 0.000003;
    return { h: price * 1.01, l: price * 0.99, c: price, v: 1_000_000 };
  }),
);

/** A NORMAL window: finite, well-volumed, >= $1, with genuine alternating pivots. */
const NORMAL = bars(
  Array.from({ length: 30 }, (_, i) => {
    const base = 100 + Math.sin(i / 2) * 5 + i * 0.25;
    return {
      h: base + 1.5,
      l: base - 1.5,
      c: base,
      v: 1_000_000 + ((i * 37) % 11) * 50_000,
    };
  }),
);

describe("F7.4 calculateSupportAndResistance totality — a level is never NaN/Inf", () => {
  it("omits a level a zero-volume pivot cluster cannot support, rather than emitting NaN", () => {
    // Both outputs are volume-weighted, so a cluster with no volume divides
    // 0/0 and ships NaN into `price` and `strength`. A NaN level is worse than
    // no level: every comparison against NaN is false, so a stop placed off one
    // never triggers and the position is unprotected while looking protected.
    // MUTATION: restore the raw `sum(price*vol)/totalVolume` and
    // `sum(count*(vol/totalVolume))` in aggregatePivotCluster (drop the
    // `!(totalVolume > 0)` guard) -> NaN price/strength -> red.
    const out = calculateSupportAndResistance(ZERO_VOLUME_PIVOTS, {
      lookbackPeriod: 10,
    });

    expect(out.length).toBe(ZERO_VOLUME_PIVOTS.length);
    for (const row of out) {
      for (const level of row.levels) {
        expect(Number.isFinite(level.price)).toBe(true);
        expect(Number.isFinite(level.strength)).toBe(true);
      }
    }
    // Typed absence: `price`/`strength` are non-optional numbers, so the only
    // honest way to report an unevidenced level is to not report it.
    expect(out.every((row) => row.levels.length === 0)).toBe(true);
  });

  it("never emits a level at a zero price from a bad-tick pivot", () => {
    // A zero low divides the pivot-dedup ratio by zero (Infinity, so it never
    // merges) and then aggregates to a $0.00 "support" — a price no equity
    // trades at, which a consumer would happily place a stop against.
    // MUTATION: drop `curr.low > 0` from the low-pivot test -> a
    // {price: 0, type: "support"} level appears -> red.
    const out = calculateSupportAndResistance(ZERO_LOW_TICK, {
      lookbackPeriod: 10,
    });

    for (const row of out) {
      for (const level of row.levels) {
        expect(Number.isFinite(level.price)).toBe(true);
        expect(level.price).toBeGreaterThan(0);
      }
    }
  });

  it("keeps pivots distinct when the volatility reference close is zero", () => {
    // volatility = avgPriceChange / firstClose. A zero reference makes it
    // +Infinity, so `gap < sensitivity` is true for every pair and *all*
    // pivots collapse into whichever one was found first — one bogus level
    // standing in for the whole range.
    // MUTATION: restore `avgPriceChange / analysisWindow[0].close` -> the
    // separate 97 support and 105 resistance collapse to a single level -> red.
    const out = calculateSupportAndResistance(ZERO_REFERENCE_CLOSE, {
      lookbackPeriod: 10,
    });
    const last = out[out.length - 1];

    expect(last.levels.length).toBeGreaterThan(1);
    for (const level of last.levels) {
      expect(Number.isFinite(level.price)).toBe(true);
      expect(Number.isFinite(level.strength)).toBe(true);
    }
  });

  it("resolves the empty and single-bar windows without inventing a level", () => {
    // Regression cover for the degenerate window sizes. The single-bar case is
    // defense in depth: its 0/0 volatility is contained today because the pivot
    // scan cannot run on one bar, so this assertion is a totality guard rather
    // than an independent mutation proof.
    expect(calculateSupportAndResistance([], { lookbackPeriod: 10 })).toEqual(
      [],
    );

    const single = calculateSupportAndResistance([ZERO_VOLUME_PIVOTS[0]], {
      lookbackPeriod: 10,
    });
    expect(single.length).toBe(1);
    expect(single[0].levels).toEqual([]);
    expect(Number.isFinite(single[0].close)).toBe(true);
  });
});

describe("F7.2 price-scale preservation — support/resistance and Fibonacci", () => {
  it("preserves a sub-penny support/resistance level instead of collapsing it to 0.00", () => {
    // MUTATION: swap roundToPriceScale(avgPrice) back to
    // parseFloat(avgPrice.toFixed(2)) in aggregatePivotCluster -> every level
    // price becomes 0 -> red.
    const out = calculateSupportAndResistance(SUB_PENNY, {
      lookbackPeriod: 10,
    });
    const allLevels = out.flatMap((row) => row.levels);

    expect(allLevels.length).toBeGreaterThan(0);
    for (const level of allLevels) {
      expect(level.price).toBeGreaterThan(0);
      // The zigzag spans 0.000294 .. 0.000312 before the +-1% bar bounds.
      expect(level.price).toBeLessThan(0.001);
      expect(level.price).toBeGreaterThan(0.0001);
    }
  });

  it("preserves sub-penny Fibonacci levels instead of collapsing them to 0.00", () => {
    // MUTATION: swap either roundToPriceScale(price) back to
    // parseFloat(price.toFixed(2)) in calculateFibonacciLevels -> that limb's
    // prices become 0 -> red.
    const out = calculateFibonacciLevels(SUB_PENNY, { lookbackPeriod: 5 });
    const allLevels = out.flatMap((row) => row.levels ?? []);

    expect(allLevels.length).toBeGreaterThan(0);
    expect(allLevels.every((l) => Number.isFinite(l.price))).toBe(true);
    // Retracements sit inside the swing range, so every one of them is a live
    // sub-penny price that a flat 2dp round would have zeroed.
    const retracements = allLevels.filter((l) => l.type === "retracement");
    expect(retracements.length).toBeGreaterThan(0);
    expect(retracements.every((l) => l.price > 0)).toBe(true);
  });
});

describe("calculateStochasticOscillator — period parameters are validated, not divided by", () => {
  it("rejects a zero or fractional period instead of returning NaN readings", () => {
    // Each period is a divisor and a slice width; zero divides by zero and
    // yields NaN %K/%D, an oscillator reading that is neither true nor false.
    // MUTATION: delete the guard -> the smoothingFactor:0 call returns rows
    // whose slowK/slowD are NaN instead of throwing -> red.
    expect(() =>
      calculateStochasticOscillator(NORMAL, { smoothingFactor: 0 }),
    ).toThrow(/positive integers/);
    expect(() =>
      calculateStochasticOscillator(NORMAL, { signalPeriod: 0 }),
    ).toThrow(/positive integers/);
    expect(() =>
      calculateStochasticOscillator(NORMAL, { lookbackPeriod: 0 }),
    ).toThrow(/positive integers/);
    expect(() =>
      calculateStochasticOscillator(NORMAL, { smoothingFactor: 2.5 }),
    ).toThrow(/positive integers/);
  });

  it("accepts the documented defaults unchanged", () => {
    const out = calculateStochasticOscillator(NORMAL, { lookbackPeriod: 5 });
    expect(out.length).toBeGreaterThan(0);
    expect(
      out.every((e) => Number.isFinite(e.slowK) && Number.isFinite(e.slowD)),
    ).toBe(true);
  });
});

/**
 * NO-OP PROOF — a normal window (finite, well-volumed, >= $1) must produce
 * byte-identical output to the pre-guard implementation.
 *
 * The guards are all no-ops on such a window by construction, and the golden
 * strings below were minted by running the original unguarded implementation
 * over the exact `NORMAL` fixture used here. This is what makes the change a
 * strict repair of the degenerate partition rather than a recalibration: under
 * utils rule #7 the same function computes indicators for unit tests,
 * backtests, paper and live, so any movement on ordinary inputs is a
 * consumer-visible behavioural change.
 */
describe("no-op on normal windows — output byte-identical to the pre-guard implementation", () => {
  const GOLDEN_SUPPORT_RESISTANCE =
    '[{"date":"2025-01-01","levels":[],"close":100},{"date":"2025-01-02","levels":[],"close":102.64712769302102},{"date":"2025-01-03","levels":[],"close":104.70735492403948},{"date":"2025-01-04","levels":[],"close":105.73747493302027},{"date":"2025-01-05","levels":[{"price":107.24,"strength":1,"type":"resistance"}],"close":105.54648713412841},{"date":"2025-01-06","levels":[{"price":107.24,"strength":1,"type":"resistance"}],"close":104.24236072051978},{"date":"2025-01-07","levels":[{"price":107.24,"strength":1,"type":"resistance"}],"close":102.20560004029933},{"date":"2025-01-08","levels":[{"price":107.24,"strength":1,"type":"resistance"}],"close":99.9960838615519},{"date":"2025-01-09","levels":[{"price":107.24,"strength":1,"type":"resistance"}],"close":98.21598752346036},{"date":"2025-01-10","levels":[{"price":107.24,"strength":1,"type":"resistance"}],"close":97.36234941167451},{"date":"2025-01-11","levels":[{"price":95.86,"strength":1,"type":"support"},{"price":107.24,"strength":1,"type":"resistance"}],"close":97.70537862668431},{"date":"2025-01-12","levels":[{"price":95.86,"strength":1,"type":"support"},{"price":107.24,"strength":1,"type":"resistance"}],"close":99.22229837214805},{"date":"2025-01-13","levels":[{"price":95.86,"strength":1,"type":"support"},{"price":107.24,"strength":1,"type":"resistance"}],"close":101.60292250900537},{"date":"2025-01-14","levels":[{"price":95.86,"strength":1,"type":"support"}],"close":104.32559994043908},{"date":"2025-01-15","levels":[{"price":95.86,"strength":1,"type":"support"}],"close":106.78493299359394},{"date":"2025-01-16","levels":[{"price":95.86,"strength":1,"type":"support"}],"close":108.4399998838737},{"date":"2025-01-17","levels":[{"price":95.86,"strength":1,"type":"support"}],"close":108.94679123311691},{"date":"2025-01-18","levels":[{"price":95.86,"strength":1,"type":"support"},{"price":110.45,"strength":1,"type":"resistance"}],"close":108.24243556311745},{"date":"2025-01-19","levels":[{"price":95.86,"strength":1,"type":"support"},{"price":110.45,"strength":1,"type":"resistance"}],"close":106.56059242620879},{"date":"2025-01-20","levels":[{"price":110.45,"strength":1,"type":"resistance"}],"close":104.37424439769096},{"date":"2025-01-21","levels":[{"price":110.45,"strength":1,"type":"resistance"}],"close":102.27989444555315},{"date":"2025-01-22","levels":[{"price":110.45,"strength":1,"type":"resistance"}],"close":100.85152120014165},{"date":"2025-01-23","levels":[{"price":110.45,"strength":1,"type":"resistance"}],"close":100.50004896724649},{"date":"2025-01-24","levels":[{"price":99,"strength":1,"type":"support"},{"price":110.45,"strength":1,"type":"resistance"}],"close":101.37273912655786},{"date":"2025-01-25","levels":[{"price":99,"strength":1,"type":"support"},{"price":110.45,"strength":1,"type":"resistance"}],"close":103.31713540999783},{"date":"2025-01-26","levels":[{"price":99,"strength":1,"type":"support"},{"price":110.45,"strength":1,"type":"resistance"}],"close":105.91839051324399},{"date":"2025-01-27","levels":[{"price":99,"strength":1,"type":"support"}],"close":108.6008351841332},{"date":"2025-01-28","levels":[{"price":99,"strength":1,"type":"support"}],"close":110.7689221327581},{"date":"2025-01-01","levels":[{"price":99,"strength":1,"type":"support"}],"close":111.95303677847436},{"date":"2025-01-02","levels":[{"price":99,"strength":1,"type":"support"},{"price":113.45,"strength":1,"type":"resistance"}],"close":111.92447527762342}]';

  const GOLDEN_FIBONACCI_LAST_ROW_LEVELS =
    '[{"level":0.786,"price":99.9,"type":"retracement"},{"level":0.618,"price":102.79,"type":"retracement"},{"level":0.5,"price":104.83,"type":"retracement"},{"level":0.382,"price":106.86,"type":"retracement"},{"level":0.236,"price":109.38,"type":"retracement"},{"level":1.272,"price":118.14,"type":"extension"},{"level":1.618,"price":124.11,"type":"extension"},{"level":2.618,"price":141.36,"type":"extension"}]';

  it("support/resistance on a normal window is unchanged", () => {
    const out = calculateSupportAndResistance(NORMAL, {
      maxLevels: 5,
      lookbackPeriod: 10,
    });
    expect(JSON.stringify(out)).toBe(GOLDEN_SUPPORT_RESISTANCE);
  });

  it("Fibonacci levels on a normal window are unchanged", () => {
    const out = calculateFibonacciLevels(NORMAL, { lookbackPeriod: 20 });
    expect(JSON.stringify(out[out.length - 1].levels)).toBe(
      GOLDEN_FIBONACCI_LAST_ROW_LEVELS,
    );
  });

  it("the stochastic period guard leaves valid-parameter output unchanged", () => {
    const out = calculateStochasticOscillator(NORMAL, { lookbackPeriod: 5 });
    expect(out.length).toBe(22);
    expect(out[0].slowK).toBe(18.21);
    expect(out[0].slowD).toBe(33.34);
    expect(out[out.length - 1].slowK).toBe(86.03);
    expect(out[out.length - 1].slowD).toBe(86.24);
  });

  it("roundToPriceScale is exactly parseFloat(toFixed(2)) for every price at or above $1", () => {
    // This is what makes the F7.2 change a no-op above $1 for *all* inputs
    // rather than just the sampled ones. Deriving the branch as
    // Math.round(v * 100) / 100 instead breaks on exact half-cent ties, where
    // the float product lands on .5 but the decimal value sits below it.
    // MUTATION: restore `Math.round(value * 100) / 100` -> the tie cases below
    // return a cent high -> red.
    for (const tie of [1.045, 1.055, 1.065, 1.075, 2.675, 8.575, 1234.565]) {
      expect(roundToPriceScale(tie)).toBe(parseFloat(tie.toFixed(2)));
      expect(roundToPriceScale(-tie)).toBe(parseFloat((-tie).toFixed(2)));
    }

    // Deterministic sweep (LCG) so the property is pinned, not sampled by luck.
    let seed = 987654321;
    for (let i = 0; i < 200_000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const magnitude = 1 + (seed / 2147483648) * 9999;
      const value = i % 2 === 0 ? magnitude : -magnitude;
      expect(roundToPriceScale(value)).toBe(parseFloat(value.toFixed(2)));
    }
  });
});
