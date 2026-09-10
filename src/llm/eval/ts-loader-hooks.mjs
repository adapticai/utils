/**
 * Node module-customisation hooks that let the CI runner execute the eval
 * harness straight from its TypeScript sources.
 *
 * The harness is TypeScript because everything it decides is type-critical, but
 * the CI entry point has to be runnable with nothing but `node` — a gate that
 * required a bundle step would be a gate that silently graded a stale bundle,
 * and a gate that needed a new dependency would be a gate that could be blocked
 * by an install failure in the one job whose whole purpose is to keep bad
 * changes out.
 *
 * These hooks transpile only; they perform no type checking. That separation is
 * deliberate: type errors are caught by `tsc` in its own job, and a runner that
 * also typechecked would report a red gate for a reason that has nothing to do
 * with the models it is grading.
 *
 * @module llm/eval/ts-loader-hooks
 */

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** The TypeScript compiler, resolved from the utils package at initialisation. */
let typescript = null;

/** Suffixes tried when a relative specifier names no file directly. */
const EXTENSION_CANDIDATES = [".ts", "/index.ts"];

/**
 * Whether a URL names an existing regular file.
 *
 * A directory is deliberately not a hit: TypeScript sources import a folder by
 * its name and mean its `index.ts`, and treating the folder itself as resolved
 * is what turns that idiom into an unsupported-directory-import failure.
 *
 * @param {URL} url The URL to test.
 * @returns {boolean} Whether it names a regular file.
 */
function isFile(url) {
  const path = fileURLToPath(url);
  return existsSync(path) && statSync(path).isFile();
}

/**
 * Resolve the TypeScript compiler from the host package.
 *
 * @param {{ resolveFrom: string }} data The URL of a module in the package that owns the compiler.
 * @returns {void}
 */
export function initialize(data) {
  const require = createRequire(data.resolveFrom);
  typescript = require("typescript");
}

/**
 * Resolve extensionless relative specifiers to their TypeScript sources.
 *
 * @param {string} specifier The specifier being resolved.
 * @param {{ parentURL?: string }} context Resolution context.
 * @param {Function} nextResolve The next hook in the chain.
 * @returns {Promise<object>} The resolution result.
 */
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (isRelative && context.parentURL !== undefined) {
    const direct = new URL(specifier, context.parentURL);
    if (isFile(direct)) {
      if (direct.pathname.endsWith(".json")) {
        return { url: direct.href, format: "module", shortCircuit: true };
      }
    } else {
      for (const suffix of EXTENSION_CANDIDATES) {
        const candidate = new URL(`${specifier}${suffix}`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, format: "module", shortCircuit: true };
        }
      }
    }
  }
  return nextResolve(specifier, context);
}

/**
 * Transpile TypeScript sources, and expose JSON as a default-exporting module.
 *
 * @param {string} url The module URL being loaded.
 * @param {object} context Load context.
 * @param {Function} nextLoad The next hook in the chain.
 * @returns {Promise<object>} The load result.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) {
    if (typescript === null) {
      throw new Error("ts-loader-hooks: initialize() was not called with a resolveFrom URL");
    }
    const source = await readFile(fileURLToPath(url), "utf8");
    const transpiled = typescript.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        target: typescript.ScriptTarget.ES2022,
        module: typescript.ModuleKind.ESNext,
        isolatedModules: true,
      },
    });
    return { format: "module", source: transpiled.outputText, shortCircuit: true };
  }
  if (url.endsWith(".json")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${source};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
