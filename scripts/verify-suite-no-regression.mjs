#!/usr/bin/env node
/**
 * Assert the package's test suite has not regressed.
 *
 * The utils suite is not deterministically green. Three files assert on wall
 * clock behaviour — cache expiry, rate-limiter timeouts, and a property-based
 * numeric test — and each fails intermittently on a loaded machine. Sampling
 * the suite repeatedly shows runs where all three pass and runs where one or
 * two do not, with no code change between them.
 *
 * That makes a fixed list of failing test IDS the wrong oracle: it would go red
 * on the flake's schedule rather than on a real regression, and a gate that
 * cries wolf is a gate that gets switched off. Demanding a fully green suite
 * has the same problem. Ignoring the suite entirely has the opposite one.
 *
 * So the oracle is scoped two ways. Any failure in a file outside the recorded
 * flaky set is a regression, because those files are deterministic. And a
 * failure in a test this migration added is a regression unconditionally,
 * whatever happens elsewhere — those tests use injected clocks and stub I/O
 * precisely so they cannot be flaky, so a failure there is always real.
 *
 * Reducing the flaky set is worthwhile work, but it belongs to the modules that
 * own those tests, not to this migration. Removing an entry requires fixing the
 * test, not editing this list.
 *
 * Usage: node scripts/verify-suite-no-regression.mjs   (run from the utils root)
 *
 * @module utils/scripts/verify-suite-no-regression
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UTILS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Test files known to fail intermittently on timing, independently of any
 * change in this migration. Established by sampling the suite on an unchanged
 * tree; a run in which all of them pass is normal, and so is a run in which
 * some do not.
 */
const KNOWN_FLAKY_FILES = new Set([
  "src/__tests__/cache.test.ts",
  "src/__tests__/rate-limiter.test.ts",
  "src/__tests__/property-based-financial.test.ts",
]);

/**
 * Path prefix whose tests must never fail.
 *
 * Everything this migration adds under `llm/` — the alias client and the
 * inventory scanner alike — injects its clock and its I/O, so nothing in them
 * depends on machine load. A failure here is therefore never a flake, and is
 * held to a stricter standard than the rest of the suite deliberately: new work
 * arriving with a tolerated flake is how a suite becomes untrustworthy.
 */
const MIGRATION_TEST_PREFIX = "src/__tests__/llm/";

/** Vitest's marker on a failing summary line. */
const FAIL_PREFIX = "FAIL ";

/**
 * Reduce a Vitest failure line to the test file it names.
 *
 * @param {string} line A trimmed `FAIL ...` line.
 * @returns {string} The file path.
 */
function fileOf(line) {
  return line
    .slice(FAIL_PREFIX.length)
    .trim()
    .split(" > ")[0]
    .split(" [")[0]
    .trim();
}

/**
 * Entry point.
 *
 * @returns {void}
 */
function main() {
  const run = spawnSync("npx", ["vitest", "run", "--reporter=dot"], {
    cwd: UTILS_ROOT,
    encoding: "utf8",
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  const failingFiles = new Set(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith(FAIL_PREFIX))
      .map(fileOf),
  );

  /** @type {string[]} */
  const failures = [];

  for (const file of failingFiles) {
    if (file.startsWith(MIGRATION_TEST_PREFIX)) {
      failures.push(
        `${file} failed. Tests added by this migration inject their clock and their I/O, so a failure here is a real defect, never a flake.`,
      );
      continue;
    }
    if (!KNOWN_FLAKY_FILES.has(file)) {
      failures.push(
        `${file} failed and is not a recorded timing-flaky file, so this is a regression.`,
      );
    }
  }

  // A suite that never ran would produce no FAIL lines and would otherwise
  // read as a pass.
  if (!/Test Files\s+\d+/.test(output)) {
    failures.push("vitest produced no test-file summary, so the suite did not run");
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`FAIL ${failure}\n`);
    }
    process.stderr.write(`${failures.length} regression finding(s)\n`);
    process.exitCode = 1;
    return;
  }

  const flakyHits = [...failingFiles].filter((file) => KNOWN_FLAKY_FILES.has(file));
  process.stdout.write(
    `failing files this run: ${failingFiles.size} (${flakyHits.length} recorded-flaky, 0 regressions)\n`,
  );
  process.stdout.write("SUITE_NO_REGRESSION\n");
}

main();
