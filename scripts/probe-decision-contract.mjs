#!/usr/bin/env node
/**
 * The decision contract probe: the first authenticated calls to a hosted
 * decision route, made by an operator, by hand.
 *
 * The hosted decision contract in this package was read from a vendor's
 * reference and has never been exercised with a key, so the route table
 * declares it unconfirmed and the package refuses to call it. This command is
 * how that changes. An operator with an account and a key runs it once, and
 * its report is the evidence the route's contract is declared confirmed on and
 * the measurement the provider's limits are re-derived from.
 *
 * With no arguments it is a dry run: it prints what it would send and sends
 * nothing. To send, it must be given the route, the exact number of calls it
 * will make, and a directory for its report:
 *
 *   node scripts/probe-decision-contract.mjs
 *   node scripts/probe-decision-contract.mjs --route dm.hosted --samples 20
 *   node scripts/probe-decision-contract.mjs --execute --route dm.hosted \
 *     --acknowledge-real-calls 4 --out <dir>
 *   node scripts/probe-decision-contract.mjs --help
 *
 * The key is read from the environment variable the route's provider names,
 * and is never written or printed. The report holds counts, timings and model
 * ids; it holds no response body and no header's value.
 *
 * Exit status: 0 for a dry run or a run that confirmed the contract, 1 for a
 * run that did not, 2 for a command refused before any call.
 *
 * The command itself is the TypeScript beside this file. This file only
 * arranges for plain `node` to load it from source, so the probe runs the
 * same codec, route table and transport a production call does, as they are in
 * the tree and not as some earlier build left them.
 *
 * @module scripts/probe-decision-contract
 */

import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The utils package root, derived from this file's location. */
const UTILS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

register(pathToFileURL(join(UTILS_ROOT, "src", "llm", "eval", "ts-loader-hooks.mjs")).href, import.meta.url, {
  data: { resolveFrom: pathToFileURL(join(UTILS_ROOT, "package.json")).href },
});

const { runProbeCli, systemProbeCliDeps } = await import(
  pathToFileURL(join(UTILS_ROOT, "scripts", "decision-probe", "probe-cli.ts")).href
);

process.exitCode = await runProbeCli(process.argv.slice(2), systemProbeCliDeps());
