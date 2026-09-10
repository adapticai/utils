/**
 * Coverage of the harness itself.
 *
 * A gate is only worth its CI minutes if every assertion it claims to enforce
 * has been demonstrated to fire in both directions. "Implemented" is not the
 * bar — a comparator that always returns `pass` is implemented. The bar is
 * EXECUTED EVIDENCE: for each assertion, a fixture that this run graded as
 * passing and a fixture that this run graded as failing.
 *
 * The route table is the other half of the question. An alias whose eval gate
 * maps to no assertion bundle is an alias nothing grades, and it would sail
 * through a migration unmeasured, so the coverage check reads the table rather
 * than a list someone maintained by hand.
 *
 * @module llm/eval/coverage
 */

import { routeTable } from "../route-table";
import type { LlmRouteTable } from "../types";
import { COMPARATORS, EVAL_GATE_ASSERTIONS } from "./comparators";
import { assertPinnedJudge } from "./judge";
import type { EvalAssertion, EvalGate, EvalStatus } from "./types";

/** Assertions a run actually demonstrated, in each direction. */
export interface ObservedAssertions {
  /** Assertions this run graded as passing on at least one fixture. */
  readonly green: readonly EvalAssertion[];
  /** Assertions this run graded as failing on at least one fixture. */
  readonly red: readonly EvalAssertion[];
}

/** The outcome of the coverage check. */
export interface CoverageReport {
  /** Assertions required by at least one eval gate in the route table. */
  readonly required: readonly EvalAssertion[];
  /** Everything missing; empty is the only passing state. */
  readonly problems: readonly string[];
  /** PASSED only when nothing is missing. */
  readonly status: EvalStatus;
}

/**
 * Which assertions the route table's aliases actually require.
 *
 * @param table The route table to read.
 * @returns The required assertions, sorted, and any alias whose gate is unmapped.
 */
function requiredAssertions(table: LlmRouteTable): {
  assertions: EvalAssertion[];
  unmapped: string[];
} {
  const assertions = new Set<EvalAssertion>();
  const unmapped: string[] = [];
  for (const [alias, definition] of Object.entries(table.aliases)) {
    const gate = definition.eval_gate as EvalGate;
    const bundle = EVAL_GATE_ASSERTIONS[gate] as readonly EvalAssertion[] | undefined;
    if (bundle === undefined) {
      unmapped.push(`alias ${alias} declares eval_gate "${gate}", which maps to no assertion bundle`);
      continue;
    }
    for (const assertion of bundle) {
      assertions.add(assertion);
    }
  }
  return { assertions: [...assertions].sort(), unmapped };
}

/**
 * Check that every assertion the route table requires is implemented and was
 * demonstrated in both directions by this run.
 *
 * @param observed Assertions this run graded as passing and as failing.
 * @param table The route table to read; defaults to the canonical one.
 * @returns The coverage report.
 */
export function computeCoverage(
  observed: ObservedAssertions,
  table: LlmRouteTable = routeTable,
): CoverageReport {
  const { assertions, unmapped } = requiredAssertions(table);
  const problems: string[] = [...unmapped];

  for (const assertion of assertions) {
    if (COMPARATORS[assertion] === undefined) {
      problems.push(`assertion "${assertion}" has no registered comparator`);
      continue;
    }
    if (!observed.green.includes(assertion)) {
      problems.push(
        `assertion "${assertion}" was never demonstrated PASSING: an assertion with no green fixture ` +
          "has not been shown to admit a good candidate",
      );
    }
    if (!observed.red.includes(assertion)) {
      problems.push(
        `assertion "${assertion}" was never demonstrated FAILING: an assertion that cannot be seen to ` +
          "fail certifies nothing when it passes",
      );
    }
  }

  // The pinned-judge alias is graded by no comparator by design, so its
  // coverage is the pin guard succeeding against the live table. Without this
  // arm, the one alias with the strictest contract would be the one alias the
  // coverage check said nothing about.
  try {
    assertPinnedJudge("llm.judge", table);
  } catch (error) {
    problems.push(
      `the pinned-judge alias is not covered: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    required: assertions,
    problems,
    status: problems.length === 0 ? "PASSED" : "FAILED",
  };
}
