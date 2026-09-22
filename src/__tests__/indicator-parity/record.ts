/**
 * The golden-master record shape, its JSON codec, and the inventory of places
 * where production is KNOWN to disagree with the independent reference.
 *
 * The deviation inventory is the mechanism that keeps this fixture honest. A
 * golden master recorded from current output silently promotes every live
 * defect to a specification; recording production AND an independent reference,
 * and requiring every disagreement between them to be declared here with its
 * mechanism, means a new disagreement fails the suite instead of being
 * absorbed. Removing an entry from this list is how a fix gets proven.
 */

import type { ParitySeriesId } from "./series";

/**
 * A number as stored in JSON. `NaN` and the infinities have no JSON literal, so
 * they are tagged strings; every other value is the double itself, which
 * `JSON.stringify` round-trips exactly.
 */
export type EncodedNumber = number | "NaN" | "Infinity" | "-Infinity";

/** Encode a number for storage. */
export function encodeNumber(value: number): EncodedNumber {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  return value;
}

/** Decode a stored number. */
export function decodeNumber(value: EncodedNumber): number {
  if (value === "NaN") return Number.NaN;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  return value;
}

/**
 * One emitted indicator reading: which bar it describes, and each component it
 * carries. `null` marks a component the indicator did not produce for that bar.
 */
export interface IndicatorEntry {
  readonly barIndex: number;
  readonly components: Readonly<Record<string, number | null>>;
}

/**
 * What an indicator did when fed one prefix.
 *
 * `count` and `firstBarIndex` pin the SHAPE of the warm-up — how many values
 * came out and which bar the first one describes — which is precisely what a
 * restart-shaped history corrupts. `tail` pins the newest value, the one a live
 * consumer reads. Recording the tail at every prefix length from the shortest
 * upward covers every value the indicator ever emits, with no redundancy.
 */
export interface Reading {
  readonly count: number;
  readonly firstBarIndex: number | null;
  readonly tailBarIndex: number | null;
  readonly tail: Readonly<Record<string, EncodedNumber | null>> | null;
}

/**
 * The outcome of one invocation. A throw is recorded as tightly as a value:
 * "this input must raise" is part of the contract, and an implementation that
 * quietly starts returning a number instead has changed its contract.
 */
export type Outcome =
  | { readonly kind: "reading"; readonly reading: Reading }
  | { readonly kind: "throws"; readonly message: string };

/**
 * Production and reference outcomes for one (subject, series, prefix).
 *
 * `reference` is stored ONLY when it differs from `production`. Agreement is
 * the common case and storing it twice would bury the disagreements — which
 * are the rows a reviewer needs to see — under thousands of identical lines.
 * An absent `reference` means "identical to production", and `deviates` states
 * which case this is so the file can be read without inferring it.
 */
export interface ParityPoint {
  readonly prefix: number;
  readonly production: Outcome;
  /** Present only when it differs from `production`; every such row must be declared below. */
  readonly reference?: Outcome;
  /** True exactly when `reference` is present. */
  readonly deviates: boolean;
}

/**
 * The reference outcome for a point, reconstructing the agreement case.
 *
 * @param point - The recorded point.
 * @returns What the independent reference produced.
 */
export function referenceOf(point: ParityPoint): Outcome {
  return point.reference ?? point.production;
}

/** Every recorded point for one subject on one series. */
export interface ParityTrack {
  readonly subjectId: string;
  readonly seriesId: ParitySeriesId;
  readonly points: readonly ParityPoint[];
}

/** The whole golden master. */
export interface ParityFixture {
  /** Bumped when the record SHAPE changes, so a stale fixture fails loudly. */
  readonly formatVersion: number;
  readonly seriesLength: number;
  readonly tracks: readonly ParityTrack[];
}

/** Current record shape. */
export const FIXTURE_FORMAT_VERSION = 1;

/**
 * A known, mechanism-explained disagreement between production and the
 * reference. Each entry is a live defect this harness has pinned rather than
 * hidden.
 */
export interface DeclaredDeviation {
  readonly subjectId: string;
  readonly seriesIds: readonly ParitySeriesId[];
  /** Stable id, quotable in a report or a follow-up item. */
  readonly finding: string;
  /** What the implementation does differently, and why that is wrong. */
  readonly mechanism: string;
}

/**
 * Every disagreement this repository knows about, with its mechanism.
 *
 * An undeclared disagreement fails the suite. A declared one that stops
 * occurring also fails it, so a fix cannot land without deleting its entry —
 * the list cannot rot in either direction.
 */
export const DECLARED_DEVIATIONS: readonly DeclaredDeviation[] = [
  {
    subjectId: "ema-20-9",
    seriesIds: ["gaps", "inf"],
    finding: "EMA-WARMUP-SKIP",
    mechanism:
      "calculateEMA starts BOTH recursions at Math.max(period, period2), so the " +
      "shorter period loses every smoothing step between its own warm-up end and " +
      "the longer one's, and its first emitted value is dated to the longer " +
      "series' bar. With the default {period: 20, period2: 9} the ema2 column is " +
      "a 9-period EMA seeded on bars 0-8 and then jumped straight to bar 20, " +
      "skipping eleven updates. On the `inf` series the consequence is sharper " +
      "than a shifted number: bar 13 carries +Infinity, the skipped window hides " +
      "it, and ema2 reports a clean finite value for a bar whose own lookback " +
      "contained an infinity. Whichever period is shorter is the affected one — " +
      "with any period below 9 it is the PRIMARY ema, because period2 defaults to 9.",
  },
  {
    subjectId: "macd-3-6-3",
    seriesIds: ["flat", "gaps", "nan", "inf"],
    finding: "MACD-INHERITS-EMA-WARMUP-SKIP",
    mechanism:
      "calculateMACD calls calculateEMA without passing period2, so the default " +
      "period2 = 9 applies and inflates the warm-up of any period below 9. With " +
      "fast parameters both price EMAs are seeded correctly and then jumped to " +
      "bar 8, which starts the emitted MACD three bars late and changes every " +
      "value until the recursion re-converges. It shows on the flat series too, " +
      "where the values are all zero and only the COUNT and first bar differ — " +
      "the shape of the warm-up is corrupted independently of the arithmetic.",
  },
  {
    subjectId: "macd-12-26-9",
    seriesIds: ["gaps"],
    finding: "MACD-LINE-BUILT-FROM-ROUNDED-EMAS",
    mechanism:
      "calculateMACD subtracts the PUBLISHED EMA fields, which calculateEMA has " +
      "already passed through roundToPriceScale. The MACD line is therefore a " +
      "difference of two 2-decimal-quantised numbers rather than of the EMAs " +
      "themselves, and that error then seeds and feeds the signal-line " +
      "recursion. Measured on this series the MACD line is off by up to " +
      "0.00905 against the same calculation from unrounded EMAs. Quantisation " +
      "that large is not cosmetic on a histogram whose zero-crossing is the " +
      "signal: on deterministic $50-scale series the published histogram takes " +
      "the OPPOSITE SIGN from the unrounded calculation (for example a published " +
      "-0.0044427 where the true value is +0.00109197). Rounding belongs on the " +
      "value that is published, not on an intermediate another recursion consumes.",
  },
  {
    subjectId: "rsi-5",
    seriesIds: ["nan", "inf"],
    finding: "RSI-ABSORBS-NONFINITE-BAR",
    mechanism:
      "calculateRSI classifies a change with `change >= 0 ? change : 0` and " +
      "`change < 0 ? |change| : 0`, and a non-finite change fails both tests, so " +
      "a corrupted bar is silently counted as a zero-change bar. Where the " +
      "corruption does reach the averages, rsiFromAverages maps the resulting " +
      "non-finite ratio to the neutral 50. Either way a corrupted feed yields a " +
      "confident-looking reading instead of an unknown, and it never recovers: " +
      "once an average is NaN every later bar reads 50 regardless of the tape.",
  },
  {
    subjectId: "rsi-14",
    seriesIds: ["nan", "inf"],
    finding: "RSI-ABSORBS-NONFINITE-BAR",
    mechanism:
      "Same mechanism as rsi-5, recorded at the default period so the finding is " +
      "pinned on the configuration consumers actually use.",
  },
];

/**
 * Whether a disagreement on this (subject, series) pair has been declared.
 *
 * @param subjectId - The indicator configuration under test.
 * @param seriesId - The adversarial series.
 * @returns The declaration, or `undefined` when the pair is undeclared.
 */
export function declaredDeviationFor(
  subjectId: string,
  seriesId: ParitySeriesId,
): DeclaredDeviation | undefined {
  return DECLARED_DEVIATIONS.find(
    (d) => d.subjectId === subjectId && d.seriesIds.includes(seriesId),
  );
}

/**
 * Reduce a list of emitted entries to the recorded {@link Reading}.
 *
 * @param entries - Everything the indicator emitted for this prefix.
 * @returns The shape-plus-tail summary stored in the fixture.
 */
export function toReading(entries: readonly IndicatorEntry[]): Reading {
  if (entries.length === 0) {
    return { count: 0, firstBarIndex: null, tailBarIndex: null, tail: null };
  }
  const last = entries[entries.length - 1];
  const tail: Record<string, EncodedNumber | null> = {};
  for (const [key, value] of Object.entries(last.components)) {
    tail[key] = value === null ? null : encodeNumber(value);
  }
  return {
    count: entries.length,
    firstBarIndex: entries[0].barIndex,
    tailBarIndex: last.barIndex,
    tail,
  };
}

/**
 * Whether two outcomes are identical, comparing `NaN` as equal to itself.
 *
 * `NaN !== NaN` would make every corrupted-series record permanently unequal to
 * itself, which would turn the most important rows in this fixture into noise.
 *
 * @param a - First outcome.
 * @param b - Second outcome.
 * @returns Whether they describe the same result.
 */
export function outcomesEqual(a: Outcome, b: Outcome): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "throws" && b.kind === "throws") return a.message === b.message;
  if (a.kind !== "reading" || b.kind !== "reading") return false;
  const x = a.reading;
  const y = b.reading;
  if (x.count !== y.count) return false;
  if (x.firstBarIndex !== y.firstBarIndex) return false;
  if (x.tailBarIndex !== y.tailBarIndex) return false;
  if ((x.tail === null) !== (y.tail === null)) return false;
  if (x.tail === null || y.tail === null) return true;
  const keys = new Set([...Object.keys(x.tail), ...Object.keys(y.tail)]);
  for (const key of keys) {
    const xv = x.tail[key];
    const yv = y.tail[key];
    if (xv === undefined || yv === undefined) return false;
    if (xv === null || yv === null) {
      if (xv !== yv) return false;
      continue;
    }
    if (!Object.is(decodeNumber(xv), decodeNumber(yv))) return false;
  }
  return true;
}
