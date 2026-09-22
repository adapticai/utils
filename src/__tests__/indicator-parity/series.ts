/**
 * The adversarial bar series the prefix-parity golden master is recorded over.
 *
 * Every value here is produced by integer arithmetic scaled by an exact power
 * of two, so each close is exactly representable as a double and the series is
 * byte-identical on every platform and every engine version. A fixture whose
 * inputs drift is not a golden master; it is a slow-moving flake.
 *
 * The four shapes are chosen for what they do to a RECURSION, not for realism:
 * a constant series drives every difference-based indicator onto its `0 / 0`
 * branch, a jump series makes the warm-up window decide the answer, and the
 * non-finite series ask whether a corrupted bar propagates loudly or is
 * silently absorbed into a plausible number.
 */

import type { MassivePriceData } from "../../types/massive-types";

/**
 * One bar of the synthetic series.
 *
 * This is the production bar type, not a local stand-in: an indicator that
 * silently started reading a field the harness does not populate would be
 * caught by the compiler here rather than by a wrong number in a fixture. The
 * `date` carries the bar's index (`d<index>`) so an emitted value can be traced
 * back to the bar that produced it.
 */
export type ParityBar = MassivePriceData;

/** Identifier of one adversarial series. */
export type ParitySeriesId = "flat" | "gaps" | "nan" | "inf";

/** Bars in the longest series recorded. Prefixes are taken from its front. */
export const SERIES_LENGTH = 60;

/** Shortest prefix recorded. Below this no indicator under test emits anything. */
export const MIN_PREFIX = 5;

/** Every close in the `flat` series. A constant tape has zero true range and zero momentum. */
const FLAT_LEVEL = 100;

/** Bars between the upward jumps in the `gaps` series. */
const GAP_PERIOD = 19;

/** Size of the upward jump, in price units. Large relative to the drift, so a
 *  warm-up window that straddles one is dominated by it. */
const GAP_UP = 12;

/** Size of the downward jump, in price units. */
const GAP_DOWN = 8;

/** Offset within each gap period at which the downward jump lands. */
const GAP_DOWN_OFFSET = 9;

/** Indices carrying `NaN` in the `nan` series: one inside a short warm-up
 *  window, two after it, so both sides of the seeding boundary are exercised. */
const NAN_INDICES: readonly number[] = [3, 23, 41];

/**
 * Indices carrying `+Infinity` / `-Infinity` in the `inf` series.
 *
 * Bar 13 is placed deliberately: it falls inside the window that the default
 * EMA configuration's warm-up skips (bars 9 through 19 for `{period: 20,
 * period2: 9}`). That is what turns a shifted number into a visibly WRONG one —
 * an indicator that reports a clean finite value for a bar whose own lookback
 * contained an infinity has not merely lost precision, it has hidden a
 * corrupted feed.
 */
const POSITIVE_INF_INDEX = 13;
const NEGATIVE_INF_INDEX = 37;

/**
 * The clean drifting base the `nan` and `inf` series are built from.
 *
 * `(i * 37) % 23` cycles through the residues without repeating for the length
 * of the series, so consecutive closes move both up and down; dividing by 8 and
 * 4 keeps every value on an exact binary fraction.
 *
 * @param index - Bar index.
 * @returns The close for that bar.
 */
function baseClose(index: number): number {
  return FLAT_LEVEL + ((index * 37) % 23) / 8 + index / 4;
}

/**
 * The `gaps` close series: the drifting base plus accumulated step jumps.
 *
 * @param index - Bar index.
 * @returns The close for that bar.
 */
function gapClose(index: number): number {
  let level = baseClose(index);
  for (let i = 1; i <= index; i++) {
    if (i % GAP_PERIOD === 0) level += GAP_UP;
    if (i % GAP_PERIOD === GAP_DOWN_OFFSET) level -= GAP_DOWN;
  }
  return level;
}

/**
 * Closes for one adversarial series.
 *
 * @param id - Which series to build.
 * @returns `SERIES_LENGTH` closes.
 */
function closesFor(id: ParitySeriesId): number[] {
  const closes: number[] = [];
  for (let i = 0; i < SERIES_LENGTH; i++) {
    switch (id) {
      case "flat":
        closes.push(FLAT_LEVEL);
        break;
      case "gaps":
        closes.push(gapClose(i));
        break;
      case "nan":
        closes.push(NAN_INDICES.includes(i) ? Number.NaN : baseClose(i));
        break;
      case "inf":
        if (i === POSITIVE_INF_INDEX) closes.push(Number.POSITIVE_INFINITY);
        else if (i === NEGATIVE_INF_INDEX) closes.push(Number.NEGATIVE_INFINITY);
        else closes.push(baseClose(i));
        break;
    }
  }
  return closes;
}

/**
 * Build the full bar series for one adversarial shape.
 *
 * High and low are derived from the close by exact eighths, so a corrupted
 * close corrupts the whole bar — which is what a corrupted feed actually does,
 * and what makes the true-range recursions see the same defect the close-based
 * ones see.
 *
 * @param id - Which series to build.
 * @returns `SERIES_LENGTH` bars.
 */
export function buildSeries(id: ParitySeriesId): ParityBar[] {
  const HIGH_STEPS = 5;
  const LOW_STEPS = 3;
  const EIGHTH = 8;
  // Fields no indicator under test reads are still populated deterministically:
  // a fixture whose inputs vary is not a golden master.
  const BASE_TIMESTAMP_MS = 1_700_000_000_000;
  const BAR_INTERVAL_MS = 60_000;
  const THIRDS = 3;
  return closesFor(id).map((close, i) => {
    const high = close + ((i % HIGH_STEPS) + 1) / EIGHTH;
    const low = close - ((i % LOW_STEPS) + 1) / EIGHTH;
    return {
      symbol: "PARITY",
      date: `d${i}`,
      timeStamp: BASE_TIMESTAMP_MS + i * BAR_INTERVAL_MS,
      open: close,
      high,
      low,
      close,
      vol: 1000 + i,
      vwap: (high + low + close) / THIRDS,
      trades: 10 + i,
    };
  });
}

/** Every adversarial series, in recording order. */
export const PARITY_SERIES_IDS: readonly ParitySeriesId[] = [
  "flat",
  "gaps",
  "nan",
  "inf",
];

/**
 * Every prefix length recorded, shortest first.
 *
 * @returns Lengths from {@link MIN_PREFIX} through {@link SERIES_LENGTH}.
 */
export function prefixLengths(): number[] {
  const lengths: number[] = [];
  for (let k = MIN_PREFIX; k <= SERIES_LENGTH; k++) lengths.push(k);
  return lengths;
}

/**
 * Simple period returns from a close series, used by the volatility recursion.
 *
 * A zero prior close would make the return undefined; none of these series
 * contains one, and the guard states that rather than silently substituting a
 * value if a future series ever does.
 *
 * @param closes - The close series.
 * @returns `closes.length - 1` returns.
 * @throws When a prior close is exactly zero.
 */
export function simpleReturns(closes: readonly number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prior = closes[i - 1];
    if (prior === 0) {
      throw new Error(`simpleReturns: prior close at index ${i - 1} is zero`);
    }
    returns.push((closes[i] - prior) / prior);
  }
  return returns;
}
