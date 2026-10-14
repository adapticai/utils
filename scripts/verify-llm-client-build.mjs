#!/usr/bin/env node
/**
 * Assert the alias LLM client builds, typechecks, is reachable from the package
 * root, and adds no runtime dependency.
 *
 * The last of those is the one that needs a gate. `@adaptic/utils` is consumed
 * by the engine, and a module that pulled a provider SDK into the package's
 * import graph would load that SDK in every consumer — including the many that
 * never make an LLM call — and would harden the utils/lumic-utils package cycle
 * from a declaration into a load-time fact. The degraded transport therefore
 * reaches its provider client through a dynamic import behind an injectable
 * resolver, and this check is what stops that from quietly regressing to a
 * static import.
 *
 * The typed decision client hangs off the same barrel by one re-export line.
 * Every gate here reads only what the barrel reaches, so without that line the
 * decision sources would be checked by nothing and exported to nobody while the
 * check still passed. The modules a consumer's decision call runs through are
 * therefore named, and the check fails when the barrel does not reach one.
 *
 * The published types are checked as built. A test-support module is part of
 * the compiler's program but not of the package, and a declaration emitted for
 * one would be published as if it were API.
 *
 * Usage (run from the utils root, after `npm run build`):
 *   node scripts/verify-llm-client-build.mjs               every check
 *   node scripts/verify-llm-client-build.mjs reachability  the source checks
 *     only: what the barrel reaches and what those sources may contain. It
 *     runs no compiler and reads no build output, so a test can run it.
 *
 * @module utils/scripts/verify-llm-client-build
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const UTILS_ROOT = resolve(HERE, "..");
const LLM_DIR = join(UTILS_ROOT, "src/llm");

/**
 * Packages the client may reference at module scope.
 *
 * Empty by design. Everything the client needs comes from the standard library,
 * the route-table JSON, or an injected transport, which is what lets a consumer
 * import the package without paying for an LLM stack it does not use.
 */
const ALLOWED_STATIC_PACKAGE_IMPORTS = new Set([]);

/**
 * Sources the barrel must reach, relative to the utils root.
 *
 * The decision barrel, and the modules a decision call runs through: the
 * client, the codec, the route table and the hosted transport. The transport
 * is reached through the client and is exported by nothing; it is listed
 * because it is the one module that speaks to a vendor, so it is the one whose
 * imports and contents most need the gates below.
 */
const REQUIRED_REACHABLE = [
  "src/llm/decision/index.ts",
  "src/llm/decision/decision-client.ts",
  "src/llm/decision/codec.ts",
  "src/llm/decision/decision-route-table.ts",
  "src/llm/decision/transports/systemone.ts",
];

/** The mode that runs the source checks alone. */
const REACHABILITY_MODE = "reachability";

/** What the script prints when every check of the mode it ran passed. */
const SUCCESS_TOKEN = { full: "LLM_CLIENT_BUILD_OK", [REACHABILITY_MODE]: "LLM_CLIENT_REACHABILITY_OK" };

/** The built declarations, relative to the utils root. */
const BUILT_TYPES = "dist/types";

/** Declarations that must be in the build: the package's entry and the decision barrel's. */
const REQUIRED_BUILT_TYPES = ["dist/types/index.d.ts", "dist/types/llm/decision/index.d.ts"];

/** The built ES module, and a name it must define for the decision client to be in the bundle. */
const BUILT_MODULE = "dist/index.mjs";
const BUNDLED_CLIENT_NAME = "callDecisionModel";

/** A path segment or a file name that marks a source as test-only. */
const TEST_ONLY_PATH = /(?:^|\/)__tests__(?:\/|$)|\.test\.d\.ts(?:\.map)?$/;

/**
 * Every source reachable from the client's barrel, followed transitively.
 *
 * Reachability is the right question rather than "every file under src/llm",
 * because it is exactly the set a consumer can pull in by importing the
 * package. A build-time tool that happens to live nearby but is exported by
 * nothing costs a consumer nothing; a module the barrel re-exports costs every
 * consumer whatever it imports.
 *
 * @param {string} entry Absolute path of the barrel.
 * @returns {string[]} Absolute paths, sorted.
 */
function listReachableSources(entry) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const queue = [entry];
  const specifierPattern = /(?:^|\n)\s*(?:import|export)\s(?:type\s)?[^;]*?from\s+["']([^"']+)["']/g;

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const text = readFileSync(current, "utf8");
    for (const match of text.matchAll(specifierPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) {
        continue;
      }
      const base = resolve(dirname(current), specifier);
      for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return [...seen].sort();
}

/**
 * Every file under a directory, recursively.
 *
 * @param {string} dir Absolute path of the directory.
 * @returns {string[]} Paths relative to the utils root, sorted.
 */
function listFilesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? listFilesUnder(path) : [relative(UTILS_ROOT, path)];
    })
    .sort();
}

/**
 * Check the build output: the declarations a consumer needs are there, none
 * was emitted for a test-only source, and the decision client is in the bundle.
 *
 * @param {string[]} failures Collected failures, appended to.
 * @returns {void}
 */
function checkBuildOutput(failures) {
  const missing = REQUIRED_BUILT_TYPES.filter((file) => !existsSync(join(UTILS_ROOT, file)));
  for (const file of missing) {
    failures.push(`${file} does not exist; run the build first, and if it ran, the barrel is not in the published types`);
  }
  if (!existsSync(join(UTILS_ROOT, BUILT_TYPES))) {
    return;
  }
  const testOnly = listFilesUnder(join(UTILS_ROOT, BUILT_TYPES)).filter((file) => TEST_ONLY_PATH.test(file));
  if (testOnly.length > 0) {
    failures.push(
      `${testOnly.length} declaration file(s) of test-only sources are in the published types, the first being ${testOnly[0]}; ` +
        "the build must exclude test sources from the compiler's program, not only from the bundle",
    );
  }
  const builtModule = join(UTILS_ROOT, BUILT_MODULE);
  if (!existsSync(builtModule)) {
    failures.push(`${BUILT_MODULE} does not exist; run the build first`);
  } else if (!readFileSync(builtModule, "utf8").includes(BUNDLED_CLIENT_NAME)) {
    failures.push(`${BUILT_MODULE} does not define ${BUNDLED_CLIENT_NAME}, so the decision client is not in the bundle`);
  }
}

/**
 * Entry point.
 *
 * @returns {void}
 */
function main() {
  /** @type {string[]} */
  const failures = [];
  const mode = process.argv[2] ?? "full";
  if (mode !== "full" && mode !== REACHABILITY_MODE) {
    process.stderr.write(`FAIL unknown mode "${mode}"; run with no argument, or with "${REACHABILITY_MODE}"\n`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(LLM_DIR)) {
    failures.push("src/llm does not exist");
    report(failures, mode);
    return;
  }

  const sources = listReachableSources(join(LLM_DIR, "index.ts"));
  if (sources.length < 2) {
    failures.push("the client barrel reaches fewer than two modules, so it is not wired up");
  }
  const reached = new Set(sources.map((file) => relative(UTILS_ROOT, file)));
  for (const required of REQUIRED_REACHABLE) {
    if (!reached.has(required)) {
      failures.push(
        `${required} is not reachable from src/llm/index.ts, so it is checked by nothing here and exported to no consumer`,
      );
    }
  }

  // A static import of a bare package specifier would enter the package's
  // import graph. A dynamic import() would not, so only the static form is
  // rejected here.
  const staticImport = /^\s*import\s(?:type\s)?[^;]*?from\s+["']([^"']+)["']/gm;
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    const rel = relative(UTILS_ROOT, file);

    for (const match of text.matchAll(staticImport)) {
      const specifier = match[1];
      const isRelative = specifier.startsWith(".") || specifier.startsWith("/");
      const isNodeBuiltin = specifier.startsWith("node:");
      if (isRelative || isNodeBuiltin) {
        continue;
      }
      if (!ALLOWED_STATIC_PACKAGE_IMPORTS.has(specifier)) {
        failures.push(
          `${rel} statically imports "${specifier}"; the client must add no runtime dependency, so a provider client is reached through a dynamic import behind an injectable resolver`,
        );
      }
    }

    for (const banned of ["@ts-ignore", "@ts-expect-error", "eslint-disable"]) {
      if (text.includes(banned)) {
        failures.push(`${rel} contains a banned suppression: ${banned}`);
      }
    }
    if (/\bas any\b|:\s*any\b/.test(text)) {
      failures.push(`${rel} uses the any type`);
    }
    if (/^\s*console\.(log|debug|info)\(/m.test(text)) {
      failures.push(`${rel} writes to the console; production code logs through the injected logger`);
    }
    if (/\b(TODO|FIXME)\b/.test(text)) {
      failures.push(`${rel} contains a TODO or FIXME marker`);
    }
  }

  // The client must be reachable from the package root: a consumer forced to
  // deep-import is a consumer that can just as easily import something below
  // the client and bypass its controls entirely.
  const barrel = readFileSync(join(UTILS_ROOT, "src/index.ts"), "utf8");
  if (!/export \* from "\.\/llm"/.test(barrel)) {
    failures.push("src/index.ts does not re-export ./llm, so the client is not reachable from the package root");
  }

  if (mode === REACHABILITY_MODE) {
    report(failures, mode);
    return;
  }

  const typecheck = spawnSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
    cwd: UTILS_ROOT,
    encoding: "utf8",
  });
  const reachable = new Set(sources.map((file) => relative(UTILS_ROOT, file)));
  const llmErrors = (typecheck.stdout ?? "")
    .split("\n")
    .filter((line) => {
      const path = line.split("(")[0];
      return path === "src/index.ts" || reachable.has(path);
    });
  if (llmErrors.length > 0) {
    failures.push(`typecheck reports ${llmErrors.length} error(s) in the client:\n  ${llmErrors.join("\n  ")}`);
  }

  checkBuildOutput(failures);

  report(failures, mode);
}

/**
 * Print failures or the success token.
 *
 * @param {string[]} failures Collected failures.
 * @param {"full" | "reachability"} mode The mode that ran.
 * @returns {void}
 */
function report(failures, mode) {
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`FAIL ${failure}\n`);
    }
    process.stderr.write(`${failures.length} failure(s)\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${SUCCESS_TOKEN[mode]}\n`);
}

main();
