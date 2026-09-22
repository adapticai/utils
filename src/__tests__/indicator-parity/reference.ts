/**
 * Independent reference implementations of the recursive indicators.
 *
 * These are written from each indicator's DEFINITION, not from the production
 * code, and exist so the golden master is anchored to something outside the
 * implementation it is meant to protect. A fixture generated from current
 * output pins today's defects as the specification; a fixture checked against
 * an independent derivation turns a defect into a visible, enumerated
 * disagreement instead.
 *
 * Every function here applies the recurrence to the numbers it is given and
 * nothing else. In particular it does NOT special-case non-finite input: if a
 * bar is `NaN`, the recurrence carries `NaN` forward, because that is what the
 * arithmetic says. Where production returns a plausible number from the same
 * input, the disagreement is the finding.
 *
 * Each series is returned indexed by BAR, with `null` before the warm-up ends,
 * so a value can always be traced to the bar that produced it.
 */

/**
 * Exponential moving average, seeded with the simple mean of the first
 * `period` values and smoothed thereafter by `2 / (period + 1)`.
 *
 * @param values - The input series.
 * @param period - Lookback; must be a positive integer.
 * @returns One entry per input index; `null` before index `period - 1`.
 */
export function referenceEma(
  values: readonly number[],
  period: number,
): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length < period) return out;
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
    out[i] = ema;
  }
  return out;
}

/** One MACD reading, tied to the bar that produced it. */
export interface ReferenceMacdEntry {
  /** Index of the bar this reading describes. */
  readonly barIndex: number;
  /** Fast EMA minus slow EMA. */
  readonly macd: number;
  /** EMA of the MACD line over `signalPeriod`. */
  readonly signal: number;
  /** `macd - signal`. */
  readonly histogram: number;
}

/**
 * MACD from two EMAs of the closes plus an EMA of their difference.
 *
 * The signal line is seeded with the simple mean of the first `signalPeriod`
 * MACD values, which is the same seeding rule the two price EMAs use — the
 * definition is one rule applied three times, not three rules.
 *
 * @param closes - Close series.
 * @param shortPeriod - Fast EMA lookback.
 * @param longPeriod - Slow EMA lookback.
 * @param signalPeriod - Signal EMA lookback.
 * @returns One entry per bar that has a signal value; empty when the series is too short.
 */
export function referenceMacd(
  closes: readonly number[],
  shortPeriod: number,
  longPeriod: number,
  signalPeriod: number,
): ReferenceMacdEntry[] {
  const fast = referenceEma(closes, shortPeriod);
  const slow = referenceEma(closes, longPeriod);

  // The MACD line begins where the SLOW EMA begins; before that the difference
  // has only one of its two terms.
  const firstMacdBar = longPeriod - 1;
  if (closes.length <= firstMacdBar) return [];
  const line: number[] = [];
  for (let i = firstMacdBar; i < closes.length; i++) {
    const f = fast[i];
    const s = slow[i];
    if (f === null || s === null) return [];
    line.push(f - s);
  }
  if (line.length < signalPeriod) return [];

  const multiplier = 2 / (signalPeriod + 1);
  let signal = line.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
  const out: ReferenceMacdEntry[] = [];
  for (let i = signalPeriod; i < line.length; i++) {
    signal = (line[i] - signal) * multiplier + signal;
    out.push({
      barIndex: firstMacdBar + i,
      macd: line[i],
      signal,
      histogram: line[i] - signal,
    });
  }
  return out;
}

/**
 * Wilder's Relative Strength Index.
 *
 * The totality rule — a window with no losses scores 100, a window with neither
 * gains nor losses scores the neutral 50 — is taken from the production
 * module's own stated contract rather than invented here, since the textbook
 * formula leaves `0 / 0` undefined. That makes agreement on the FLAT series
 * weaker evidence than agreement on the drifting ones: it confirms the
 * documented rule is implemented, not that the rule is the only correct one.
 *
 * Non-finite changes are carried forward as non-finite. A bar the feed
 * corrupted is not a bar with zero change.
 *
 * @param closes - Close series.
 * @param period - Wilder lookback.
 * @returns One entry per bar; `null` before index `period`.
 */
export function referenceRsi(
  closes: readonly number[],
  period: number,
): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (closes.length < period + 1) return out;

  const NEUTRAL = 50;
  const MAXIMUM = 100;
  const rsiOf = (avgGain: number, avgLoss: number): number => {
    if (avgLoss === 0) return avgGain === 0 ? NEUTRAL : MAXIMUM;
    return MAXIMUM - MAXIMUM / (1 + avgGain / avgLoss);
  };

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum += Math.abs(change);
    // A non-finite change taints both averages: it is neither a gain of zero
    // nor a loss of zero, and pretending otherwise is the silent absorption
    // this reference exists to expose.
    if (!Number.isFinite(change)) {
      gainSum = Number.NaN;
      lossSum = Number.NaN;
    }
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiOf(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Number.isFinite(change) ? Math.max(change, 0) : Number.NaN;
    const loss = Number.isFinite(change) ? Math.max(-change, 0) : Number.NaN;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiOf(avgGain, avgLoss);
  }
  return out;
}

/**
 * True range of bar `i` against the prior close.
 *
 * @param highs - High series.
 * @param lows - Low series.
 * @param closes - Close series.
 * @param i - Bar index; must be at least 1.
 * @returns The true range at that bar.
 */
function trueRange(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  i: number,
): number {
  return Math.max(
    highs[i] - lows[i],
    Math.abs(highs[i] - closes[i - 1]),
    Math.abs(lows[i] - closes[i - 1]),
  );
}

/**
 * Wilder's Average True Range, seeded with the simple mean of the first
 * `period` true ranges and smoothed by `(prior * (period - 1) + tr) / period`.
 *
 * @param highs - High series.
 * @param lows - Low series.
 * @param closes - Close series.
 * @param period - Wilder lookback.
 * @returns One entry per bar; `null` before index `period` (the first bar has no prior close).
 */
export function referenceAtr(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period: number,
): (number | null)[] {
  const out: (number | null)[] = highs.map(() => null);
  if (highs.length < period + 1) return out;

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRange(highs, lows, closes, i);
  let atr = sum / period;
  out[period] = atr;
  for (let i = period + 1; i < highs.length; i++) {
    atr = (atr * (period - 1) + trueRange(highs, lows, closes, i)) / period;
    out[i] = atr;
  }
  return out;
}

/**
 * RiskMetrics-style EWMA volatility: the square root of a variance seeded with
 * the first squared return and decayed by `lambda` thereafter.
 *
 * @param returns - Period returns.
 * @param lambda - Decay factor in (0, 1).
 * @returns The EWMA standard deviation, or `null` on empty input.
 */
export function referenceEwmaVolatility(
  returns: readonly number[],
  lambda: number,
): number | null {
  if (returns.length === 0) return null;
  let variance = returns[0] ** 2;
  for (let i = 1; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * returns[i] ** 2;
  }
  return Math.sqrt(variance);
}
