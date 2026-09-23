/**
 * Test-side accessors for {@link SampleStatistic} results.
 *
 * The union deliberately has no way to read a value without first proving the
 * statistic exists. These helpers keep that proof in one place so assertions
 * stay about the arithmetic, and so a test that expected a measurement and got
 * an absence fails on that fact rather than on a downstream `undefined`.
 */

import type { SampleStatistic } from "../../sample-statistic";

/**
 * The measured value, or a failure naming why there was none.
 *
 * @param statistic - The result under test.
 * @returns The measured value.
 * @throws When the statistic is the unavailable branch.
 */
export function measured<T>(statistic: SampleStatistic<T>): T {
  if (!statistic.available) {
    throw new Error(
      `expected an available statistic, got ${statistic.reason}: ${statistic.detail}`,
    );
  }
  return statistic.value;
}
