/**
 * A measured statistic and the cohort it was measured on, carried as one
 * inseparable value.
 *
 * A ratio is meaningless without the population it was taken over: the same
 * `0.42` is a strong result on 2,000 trades and noise on five, and a `0.0`
 * returned because nothing could be computed is indistinguishable from a `0.0`
 * that was genuinely measured. Both confusions are the same error — a number
 * read apart from its unit and its cohort — and both have produced wrong
 * conclusions from correct arithmetic.
 *
 * This type removes the option. Every statistic shaped by a population carries
 * `sampleCount` (how many observations actually entered the computation) and
 * `coverage` (what fraction of the observations the caller offered were usable),
 * on BOTH branches: an unavailable statistic still reports how much data it
 * saw, because "we had nothing" and "we had 900 rows and still could not
 * compute it" are different facts with different responses.
 *
 * Absence is a branch of the union rather than a sentinel value. There is no
 * number a caller can read without first proving the statistic exists, which is
 * what keeps an unknown from silently becoming a zero on its way to a decision.
 *
 * @module sample-statistic
 */

/**
 * Why a statistic could not be computed from the observations offered.
 *
 * The distinctions are the point: a caller that cannot tell "too few rows" from
 * "the rows were unusable" from "the population is degenerate" cannot tell a
 * warm-up from a data outage from a genuinely constant series, and will treat
 * all three the same way.
 */
export type StatisticUnavailableReason =
  /** Fewer usable observations than the computation requires. */
  | "insufficient_samples"
  /** Observations were offered but none survived validation (non-finite, unpaired). */
  | "no_usable_samples"
  /** Enough usable observations, but the population cannot support the statistic
   *  (a zero-variance denominator, an undefined ratio). */
  | "degenerate_population"
  /** The request itself is malformed — mismatched series lengths, a non-positive window. */
  | "invalid_input";

/**
 * How many observations a statistic was actually computed from, against how
 * many the caller offered.
 *
 * `coverage` is the ratio that makes silent row-dropping visible: a function
 * that filters non-finite rows and reports only the surviving statistic hides
 * the size of what it discarded, and a statistic computed on 12% of the
 * requested window is a different claim from the same number computed on all
 * of it.
 */
export interface SampleCohort {
  /** Observations that entered the computation. Never negative. */
  readonly sampleCount: number;
  /** Observations the caller offered, or the window width the caller asked for. */
  readonly requestedCount: number;
  /** `sampleCount / requestedCount`, clamped to [0, 1]; `0` when nothing was requested. */
  readonly coverage: number;
}

/** A statistic that was computed, carrying the cohort it was computed on. */
export interface AvailableStatistic<T> extends SampleCohort {
  readonly available: true;
  /** The measured value. */
  readonly value: T;
}

/** A statistic that could not be computed, still carrying what data was seen. */
export interface UnavailableStatistic extends SampleCohort {
  readonly available: false;
  /** Which class of failure prevented the computation. */
  readonly reason: StatisticUnavailableReason;
  /** Human-readable specifics, for logs and error messages. Never parsed. */
  readonly detail: string;
}

/**
 * A statistic that either exists with its cohort, or does not exist and says
 * why — never a number standing in for an unknown.
 */
export type SampleStatistic<T> = AvailableStatistic<T> | UnavailableStatistic;

/**
 * Build the cohort descriptor for a computation.
 *
 * `coverage` is derived here rather than supplied, so it cannot drift from the
 * counts it claims to summarise. A zero request yields zero coverage: no
 * observations were asked for, so none were covered, and the alternative (`1`)
 * would report a vacuous computation as fully covered.
 *
 * @param requestedCount - Observations offered, or the window width requested.
 * @param sampleCount - Observations that entered the computation.
 * @returns The cohort descriptor with `coverage` derived from the two counts.
 * @throws When either count is negative or non-finite, which is a programming
 *         error rather than a data condition.
 */
export function sampleCohort(
  requestedCount: number,
  sampleCount: number,
): SampleCohort {
  if (!Number.isFinite(requestedCount) || requestedCount < 0) {
    throw new Error(
      `sampleCohort: requestedCount must be a non-negative finite number (got ${requestedCount})`,
    );
  }
  if (!Number.isFinite(sampleCount) || sampleCount < 0) {
    throw new Error(
      `sampleCohort: sampleCount must be a non-negative finite number (got ${sampleCount})`,
    );
  }
  const NOTHING_REQUESTED_COVERAGE = 0;
  const FULL_COVERAGE = 1;
  const coverage =
    requestedCount === 0
      ? NOTHING_REQUESTED_COVERAGE
      : Math.min(FULL_COVERAGE, sampleCount / requestedCount);
  return { sampleCount, requestedCount, coverage };
}

/**
 * Wrap a computed value with its cohort.
 *
 * @param value - The measured statistic.
 * @param cohort - The cohort it was measured on.
 * @returns The available branch of {@link SampleStatistic}.
 */
export function availableStatistic<T>(
  value: T,
  cohort: SampleCohort,
): AvailableStatistic<T> {
  return { available: true, value, ...cohort };
}

/**
 * Record that a statistic could not be computed, and what was seen instead.
 *
 * @param reason - Which class of failure prevented the computation.
 * @param detail - Specifics for logs; never machine-parsed.
 * @param cohort - What data was available when the attempt was abandoned.
 * @returns The unavailable branch of {@link SampleStatistic}.
 */
export function unavailableStatistic(
  reason: StatisticUnavailableReason,
  detail: string,
  cohort: SampleCohort,
): UnavailableStatistic {
  return { available: false, reason, detail, ...cohort };
}

/**
 * Narrow a statistic to its available branch.
 *
 * Exists so consumers in other packages can discriminate without restating the
 * predicate, and so the discriminant stays a single named concept if the shape
 * ever grows a third branch.
 *
 * @param statistic - The statistic to test.
 * @returns Whether the statistic carries a value.
 */
export function isAvailable<T>(
  statistic: SampleStatistic<T>,
): statistic is AvailableStatistic<T> {
  return statistic.available;
}
