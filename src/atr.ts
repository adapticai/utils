/**
 * Wilder ATR + EWMA-smoothed + multi-timespan variants.
 *
 * All functions are pure: same inputs → same output, no I/O, no time-dependence.
 */

export interface AtrBar {
  high: number;
  low: number;
  close: number;
  timespan?: "minute" | "hour" | "day";
}

/**
 * Classic Wilder ATR (single value).
 * @returns ATR for the most recent `period` bars, or null when insufficient bars.
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number | null {
  if (period < 1 || !Number.isInteger(period)) {
    throw new Error("ATR: period must be a positive integer");
  }
  if (highs.length !== lows.length || highs.length !== closes.length) {
    throw new Error("ATR: highs, lows, closes must have equal length");
  }
  if (highs.length < period + 1) return null;

  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }

  // Wilder smoothing: first ATR = simple mean of first `period` TRs
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/**
 * Returns the EWMA-smoothed ATR series (one ATR per bar, leading nulls until `period` bars).
 */
export function calculateATREMA(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): Array<number | null> {
  if (period < 1 || !Number.isInteger(period)) {
    throw new Error("ATR: period must be a positive integer");
  }
  if (highs.length !== lows.length || highs.length !== closes.length) {
    throw new Error("ATREMA: highs, lows, closes must have equal length");
  }
  const out: Array<number | null> = highs.map(() => null);
  if (highs.length < period + 1) return out;

  // Index 0 is a placeholder so trs[i] aligns with bar i (i >= 1); TR is undefined for the first bar (no prior close).
  const trs: number[] = [0];
  for (let i = 1; i < highs.length; i++) {
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }

  let atr = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = atr;
  for (let i = period + 1; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    out[i] = atr;
  }
  return out;
}

/**
 * Wrapper that accepts AtrBar[] (timespan-tagged); identical math, the timespan tag is
 * carried through for consumer-side logic only.
 *
 * @param bars - All bars must share the same timespan; the tag is metadata only
 *               and is not validated. Mixed-timespan input produces a meaningless ATR.
 * @param period - Wilder lookback period (positive integer).
 */
export function calculateATRMultiTimespan(
  bars: AtrBar[],
  period: number,
): number | null {
  return calculateATR(
    bars.map((b) => b.high),
    bars.map((b) => b.low),
    bars.map((b) => b.close),
    period,
  );
}
