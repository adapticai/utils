#!/usr/bin/env node
/**
 * Regenerate the recursive-indicator prefix-parity golden master (W1-1).
 *
 * The fixture records, for every recursive indicator and every adversarial
 * series, what the indicator emits when fed each growing prefix of that series
 * — and, beside it, what an INDEPENDENT reference implementation written from
 * the indicator's definition emits for the same input. Recording both is the
 * point: a golden master taken from current output alone promotes whatever is
 * broken today to the specification, and does so invisibly.
 *
 * Every place the two disagree must be declared in `DECLARED_DEVIATIONS`
 * (src/__tests__/indicator-parity/record.ts) with its mechanism. Running this
 * script does not silence an undeclared disagreement; the test still fails on
 * it. Regeneration is for when the recorded SURFACE changes — a new indicator,
 * a new series, a changed prefix range — not for when a value changes.
 *
 * Usage:
 *   node scripts/generate-indicator-parity-fixture.mjs           write the fixture
 *   node scripts/generate-indicator-parity-fixture.mjs --check   exit non-zero if stale
 *
 * @module scripts/generate-indicator-parity-fixture
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Exit code for a stale fixture under `--check`. */
const EXIT_STALE = 1;

/** Exit code for a usage error, kept distinct from a stale fixture. */
const EXIT_USAGE = 2;

/** The utils package root, derived from this file's location. */
const UTILS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Load the parity harness straight from its TypeScript sources.
 *
 * Reading source rather than a build artefact keeps the fixture honest about
 * which code produced it: a bundle can be stale, and a stale generator records
 * yesterday's indicators under today's name.
 *
 * @returns {Promise<object>} The generator module.
 */
async function loadGenerator() {
  const hooks = join(UTILS_ROOT, "src", "llm", "eval", "ts-loader-hooks.mjs");
  if (!existsSync(hooks)) {
    throw new Error(`the TypeScript loader hooks are missing at ${hooks}`);
  }
  register(pathToFileURL(hooks).href, import.meta.url, {
    data: { resolveFrom: pathToFileURL(join(UTILS_ROOT, "package.json")).href },
  });
  return import(
    pathToFileURL(
      join(UTILS_ROOT, "src", "__tests__", "indicator-parity", "generate.ts"),
    ).href
  );
}

/**
 * Summarise which (subject, series) pairs disagree with the reference.
 *
 * @param {object} fixture The freshly built fixture.
 * @returns {string[]} One line per deviating pair.
 */
function deviationSummary(fixture) {
  const lines = [];
  for (const track of fixture.tracks) {
    const deviating = track.points.filter((point) => point.deviates);
    if (deviating.length === 0) continue;
    const prefixes = deviating.map((point) => point.prefix);
    lines.push(
      `  ${track.subjectId} / ${track.seriesId}: ${deviating.length} of ${track.points.length} prefixes disagree ` +
        `(prefix ${prefixes[0]}..${prefixes[prefixes.length - 1]})`,
    );
  }
  return lines;
}

/**
 * Entry point.
 *
 * @returns {Promise<void>} Resolves once the fixture is written or checked.
 */
async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    console.error(`unknown argument(s): ${unknown.join(", ")}`);
    process.exitCode = EXIT_USAGE;
    return;
  }

  const generator = await loadGenerator();
  const fixture = generator.buildFixture();
  const serialised = generator.serialiseFixture(fixture);
  const target = join(UTILS_ROOT, generator.FIXTURE_PATH_FROM_PACKAGE_ROOT);

  const summary = deviationSummary(fixture);
  if (summary.length > 0) {
    console.log(
      "Production disagrees with the independent reference on these pairs.\n" +
        "Each one must be declared in DECLARED_DEVIATIONS with its mechanism:",
    );
    for (const line of summary) console.log(line);
  } else {
    console.log("Production agrees with the independent reference everywhere.");
  }

  if (checkOnly) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current === serialised) {
      console.log(`fixture is current: ${generator.FIXTURE_PATH_FROM_PACKAGE_ROOT}`);
      return;
    }
    console.error(
      `fixture is STALE: ${generator.FIXTURE_PATH_FROM_PACKAGE_ROOT}\n` +
        "run `node scripts/generate-indicator-parity-fixture.mjs` and review the diff",
    );
    process.exitCode = EXIT_STALE;
    return;
  }

  writeFileSync(target, serialised, "utf8");
  console.log(
    `wrote ${fixture.tracks.length} tracks to ${generator.FIXTURE_PATH_FROM_PACKAGE_ROOT}`,
  );
}

await main();
