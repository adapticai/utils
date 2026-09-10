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
 * Usage: node scripts/verify-llm-client-build.mjs   (run from the utils root)
 *
 * @module utils/scripts/verify-llm-client-build
 */

import { readFileSync, statSync, existsSync } from "node:fs";
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
 * Entry point.
 *
 * @returns {void}
 */
function main() {
  /** @type {string[]} */
  const failures = [];

  if (!existsSync(LLM_DIR)) {
    failures.push("src/llm does not exist");
    report(failures);
    return;
  }

  const sources = listReachableSources(join(LLM_DIR, "index.ts"));
  if (sources.length < 2) {
    failures.push("the client barrel reaches fewer than two modules, so it is not wired up");
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

  report(failures);
}

/**
 * Print failures or the success token.
 *
 * @param {string[]} failures Collected failures.
 * @returns {void}
 */
function report(failures) {
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`FAIL ${failure}\n`);
    }
    process.stderr.write(`${failures.length} failure(s)\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("LLM_CLIENT_BUILD_OK\n");
}

main();
