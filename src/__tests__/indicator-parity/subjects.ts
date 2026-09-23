/**
 * The inventory of recursive indicators under prefix-parity protection.
 *
 * "Recursive" here means the value at bar N is computed from the indicator's
 * own value at bar N-1. That property is what makes these functions sensitive
 * to how much history they are handed: a restart that refills a short buffer
 * seeds the recursion somewhere else, and the value that comes out is a
 * different number with the same name. Window statistics (Bollinger,
 * Stochastic, realized volatility) recompute from scratch over a fixed slice
 * and are deliberately out of scope.
 *
 * Each subject exposes the production call and the independent reference call
 * in one shape — bar index plus named components — so the two can be compared
 * row for row.
 *
 * The output QUANTISER is shared with production on purpose. `roundToPriceScale`
 * and the RSI's two-decimal rounding are presentation decisions the production
 * module states explicitly; reproducing them in the reference keeps the
 * comparison about the recursion rather than about display precision, which is
 * the part a warm-up defect actually corrupts.
 */

import { calculateATR, calculateATREMA, calculateATRMultiTimespan } from "../../atr";
import {
  calculateEMA,
  calculateMACD,
  calculateRSI,
  roundToPriceScale,
} from "../../technical-analysis";
import { calculateEWMAVolatility } from "../../volatility";
import {
  referenceAtr,
  referenceEma,
  referenceEwmaVolatility,
  referenceMacd,
  referenceRsi,
} from "./reference";
import type { IndicatorEntry } from "./record";
import { simpleReturns, type ParityBar } from "./series";

/** Decimal places the RSI is published at, mirroring `calculateRSI`. */
const RSI_DECIMALS = 2;

/** Decay factor for the EWMA volatility subject — the RiskMetrics daily default. */
const EWMA_LAMBDA = 0.94;

/** Recover the bar index an emitted entry describes from its `d<index>` date. */
function barIndexOf(date: string): number {
  const index = Number.parseInt(date.slice(1), 10);
  if (!Number.isInteger(index)) {
    throw new Error(`indicator-parity: unparseable entry date "${date}"`);
  }
  return index;
}

/** Apply the RSI's published precision. */
function quantiseRsi(value: number): number {
  return Number.parseFloat(value.toFixed(RSI_DECIMALS));
}

/** Non-null entries of a bar-indexed series, in the common entry shape. */
function seriesEntries(
  values: readonly (number | null)[],
  component: string,
  quantise?: (value: number) => number,
): IndicatorEntry[] {
  const entries: IndicatorEntry[] = [];
  values.forEach((value, barIndex) => {
    if (value === null) return;
    entries.push({
      barIndex,
      components: { [component]: quantise === undefined ? value : quantise(value) },
    });
  });
  return entries;
}

/** A single scalar reading attributed to the last bar of the prefix. */
function scalarEntry(
  value: number | null,
  barIndex: number,
  component: string,
): IndicatorEntry[] {
  if (value === null) return [];
  return [{ barIndex, components: { [component]: value } }];
}

/** One indicator configuration, with both implementations of it. */
export interface ParitySubject {
  /** Stable id used by the fixture and the deviation inventory. */
  readonly id: string;
  /** What this configuration is and why it is recorded. */
  readonly description: string;
  /**
   * Whether the call emits one entry per bar (true) or only the newest value
   * (false).
   *
   * Only a bar-indexed series can be checked for prefix parity positionally: a
   * scalar call attributes its single reading to whatever the last bar of the
   * prefix happens to be, so its entry list shifts with the prefix by design.
   * Scalar subjects are checked instead against the series primitive they
   * delegate to.
   */
  readonly emitsSeries: boolean;
  /** The production call. May throw; a throw is part of the record. */
  readonly production: (bars: readonly ParityBar[]) => IndicatorEntry[];
  /** The independent reference call. May throw. */
  readonly reference: (bars: readonly ParityBar[]) => IndicatorEntry[];
}

/**
 * Every recursive indicator configuration recorded by the golden master.
 *
 * Both a defect-free configuration and the defaults consumers actually use are
 * recorded for the EMA and MACD families, because the warm-up defect only
 * appears when one period is shorter than the other — recording only the clean
 * configuration would leave the live one unprotected.
 */
export const PARITY_SUBJECTS: readonly ParitySubject[] = [
  {
    id: "ema-5-single",
    emitsSeries: true,
    description:
      "EMA(5) with the second series disabled — the configuration in which the primary EMA is seeded and smoothed without interference.",
    production: (bars) =>
      calculateEMA([...bars], { period: 5, period2: 0 }).map((entry) => ({
        barIndex: barIndexOf(entry.date),
        components: { ema: entry.ema },
      })),
    reference: (bars) =>
      seriesEntries(
        referenceEma(bars.map((b) => b.close), 5),
        "ema",
        roundToPriceScale,
      ),
  },
  {
    id: "ema-20-9",
    emitsSeries: true,
    description:
      "EMA with the library defaults {period: 20, period2: 9} — the dual-series configuration every default caller gets.",
    production: (bars) =>
      calculateEMA([...bars], { period: 20, period2: 9 }).map((entry) => ({
        barIndex: barIndexOf(entry.date),
        components: { ema: entry.ema, ema2: entry.ema2 ?? null },
      })),
    reference: (bars) => {
      const closes = bars.map((b) => b.close);
      const slow = referenceEma(closes, 20);
      const fast = referenceEma(closes, 9);
      const entries: IndicatorEntry[] = [];
      slow.forEach((value, barIndex) => {
        if (value === null) return;
        const fastValue = fast[barIndex];
        entries.push({
          barIndex,
          components: {
            ema: roundToPriceScale(value),
            ema2: fastValue === null ? null : roundToPriceScale(fastValue),
          },
        });
      });
      return entries;
    },
  },
  {
    id: "macd-12-26-9",
    emitsSeries: true,
    description: "MACD with the library defaults (12, 26, 9).",
    production: (bars) =>
      calculateMACD([...bars], {
        shortPeriod: 12,
        longPeriod: 26,
        signalPeriod: 9,
      }).map((entry) => ({
        barIndex: barIndexOf(entry.date),
        components: {
          macd: entry.macd,
          signal: entry.signal,
          histogram: entry.histogram,
        },
      })),
    reference: (bars) =>
      referenceMacd(bars.map((b) => b.close), 12, 26, 9).map((entry) => ({
        barIndex: entry.barIndex,
        components: {
          macd: roundToPriceScale(entry.macd),
          signal: roundToPriceScale(entry.signal),
          histogram: roundToPriceScale(entry.histogram),
        },
      })),
  },
  {
    id: "macd-3-6-3",
    emitsSeries: true,
    description:
      "MACD with fast intraday parameters (3, 6, 3) — periods below the EMA's default second period, where the warm-up interference appears.",
    production: (bars) =>
      calculateMACD([...bars], {
        shortPeriod: 3,
        longPeriod: 6,
        signalPeriod: 3,
      }).map((entry) => ({
        barIndex: barIndexOf(entry.date),
        components: {
          macd: entry.macd,
          signal: entry.signal,
          histogram: entry.histogram,
        },
      })),
    reference: (bars) =>
      referenceMacd(bars.map((b) => b.close), 3, 6, 3).map((entry) => ({
        barIndex: entry.barIndex,
        components: {
          macd: roundToPriceScale(entry.macd),
          signal: roundToPriceScale(entry.signal),
          histogram: roundToPriceScale(entry.histogram),
        },
      })),
  },
  {
    id: "rsi-5",
    emitsSeries: true,
    description: "Wilder RSI(5) — short enough to emit inside every recorded prefix.",
    production: (bars) =>
      calculateRSI([...bars], { period: 5 }).map((entry) => ({
        barIndex: barIndexOf(entry.date),
        components: { rsi: entry.rsi },
      })),
    reference: (bars) =>
      seriesEntries(referenceRsi(bars.map((b) => b.close), 5), "rsi", quantiseRsi),
  },
  {
    id: "rsi-14",
    emitsSeries: true,
    description: "Wilder RSI at the library default period of 14.",
    production: (bars) =>
      calculateRSI([...bars], { period: 14 }).map((entry) => ({
        barIndex: barIndexOf(entry.date),
        components: { rsi: entry.rsi },
      })),
    reference: (bars) =>
      seriesEntries(referenceRsi(bars.map((b) => b.close), 14), "rsi", quantiseRsi),
  },
  {
    id: "atr-5-scalar",
    emitsSeries: false,
    description: "Wilder ATR(5) reduced to the single most-recent value.",
    production: (bars) =>
      scalarEntry(
        calculateATR(
          bars.map((b) => b.high),
          bars.map((b) => b.low),
          bars.map((b) => b.close),
          5,
        ),
        bars.length - 1,
        "atr",
      ),
    reference: (bars) => {
      const series = referenceAtr(
        bars.map((b) => b.high),
        bars.map((b) => b.low),
        bars.map((b) => b.close),
        5,
      );
      return scalarEntry(series[series.length - 1] ?? null, bars.length - 1, "atr");
    },
  },
  {
    id: "atr-5-series",
    emitsSeries: true,
    description: "Wilder ATR(5) as a per-bar series.",
    production: (bars) =>
      seriesEntries(
        calculateATREMA(
          bars.map((b) => b.high),
          bars.map((b) => b.low),
          bars.map((b) => b.close),
          5,
        ),
        "atr",
      ),
    reference: (bars) =>
      seriesEntries(
        referenceAtr(
          bars.map((b) => b.high),
          bars.map((b) => b.low),
          bars.map((b) => b.close),
          5,
        ),
        "atr",
      ),
  },
  {
    id: "atr-5-multitimespan",
    emitsSeries: false,
    description:
      "The timespan-tagged ATR wrapper — recorded so the wrapper cannot drift from the primitive it delegates to.",
    production: (bars) =>
      scalarEntry(
        calculateATRMultiTimespan(
          bars.map((b) => ({ high: b.high, low: b.low, close: b.close })),
          5,
        ),
        bars.length - 1,
        "atr",
      ),
    reference: (bars) => {
      const series = referenceAtr(
        bars.map((b) => b.high),
        bars.map((b) => b.low),
        bars.map((b) => b.close),
        5,
      );
      return scalarEntry(series[series.length - 1] ?? null, bars.length - 1, "atr");
    },
  },
  {
    id: "ewma-volatility-094",
    emitsSeries: false,
    description:
      "RiskMetrics EWMA volatility at lambda 0.94 over simple returns of the close series.",
    production: (bars) =>
      scalarEntry(
        calculateEWMAVolatility(simpleReturns(bars.map((b) => b.close)), EWMA_LAMBDA),
        bars.length - 1,
        "volatility",
      ),
    reference: (bars) =>
      scalarEntry(
        referenceEwmaVolatility(
          simpleReturns(bars.map((b) => b.close)),
          EWMA_LAMBDA,
        ),
        bars.length - 1,
        "volatility",
      ),
  },
];
