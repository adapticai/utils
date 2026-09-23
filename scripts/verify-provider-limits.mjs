#!/usr/bin/env node
/**
 * Assert the per-provider rate and concurrency limits are honestly stated and
 * actually applied.
 *
 * Two properties, because a limits config can fail in two unrelated ways and
 * both fail quietly.
 *
 * The first is honesty. A conservative guess and a transcribed provider ceiling
 * look identical in config and behave identically — right up until traffic
 * grows past the guess, at which point one of them was a documented decision
 * and the other was nobody's. Requiring a `basis`, and a source link whenever
 * the basis claims to be published, keeps the two distinguishable.
 *
 * The second is wiring. A guard that exists but is not on the path is the
 * built-but-never-wired failure: it reviews well, tests well in isolation, and
 * bounds nothing. So this also asserts that the chain executor reaches every
 * transport through the guards, and that a guard timeout is not counted against
 * provider health.
 *
 * Usage: node scripts/verify-provider-limits.mjs [wiring]   (from the utils root)
 *
 * @module utils/scripts/verify-provider-limits
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UTILS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIMITS_PATH = join(UTILS_ROOT, "src/llm/provider-limits.json");
const ROUTES_PATH = join(UTILS_ROOT, "src/llm/alias-routes.json");
const CHAIN_PATH = join(UTILS_ROOT, "src/llm/fallback-chain.ts");
const GUARD_PATH = join(UTILS_ROOT, "src/llm/rate-guard.ts");

/** A rate ceiling at or below this is treated as suspiciously permissive to have been guessed. */
const MIN_SENSIBLE_RPM = 1;

/**
 * Assert the limits config is complete and honestly labelled.
 *
 * @returns {string[]} Failures.
 */
function checkConfig() {
  /** @type {string[]} */
  const failures = [];
  const limits = JSON.parse(readFileSync(LIMITS_PATH, "utf8"));
  const routes = JSON.parse(readFileSync(ROUTES_PATH, "utf8"));

  if (limits.defaults === undefined) {
    failures.push("no defaults block: an unregistered provider would run unbounded");
    return failures;
  }

  const entries = [["defaults", limits.defaults], ...Object.entries(limits.providers ?? {})];

  for (const [name, entry] of entries) {
    if (entry.basis !== "published" && entry.basis !== "conservative-default") {
      failures.push(`${name}: basis must be "published" or "conservative-default", got ${JSON.stringify(entry.basis)}`);
    }
    if (entry.basis === "published" && (typeof entry.source !== "string" || entry.source.length === 0)) {
      failures.push(
        `${name}: claims a published ceiling but cites no source, so it is a guess wearing a more confident label`,
      );
    }
    for (const field of ["requests_per_minute", "max_concurrent", "acquire_timeout_ms"]) {
      if (typeof entry[field] !== "number" || entry[field] < MIN_SENSIBLE_RPM) {
        failures.push(`${name}: ${field} must be a positive number`);
      }
    }
    // The unit a limit applies in is a claim about the provider, held to the
    // same standard as a number: a per-model scope multiplies the client's
    // total admission by the number of models, so an unsourced one is a guess
    // that loosens every guard at once.
    if (entry.scope !== undefined && entry.scope !== "provider" && entry.scope !== "model") {
      failures.push(`${name}: scope must be "provider" or "model", got ${JSON.stringify(entry.scope)}`);
    }
    const scopeSourced =
      (entry.basis === "published" && typeof entry.source === "string" && entry.source.length > 0) ||
      (typeof entry.scope_source === "string" && entry.scope_source.length > 0);
    if (entry.scope === "model" && !scopeSourced) {
      failures.push(
        `${name}: claims its provider enforces limits per model but cites no source for that unit (source or scope_source)`,
      );
    }
    if (
      entry.requests_per_minute_basis !== undefined &&
      entry.requests_per_minute_basis !== "published" &&
      entry.requests_per_minute_basis !== "conservative-default"
    ) {
      failures.push(
        `${name}: requests_per_minute_basis must be "published" or "conservative-default", got ${JSON.stringify(entry.requests_per_minute_basis)}`,
      );
    }
    if (
      entry.requests_per_minute_basis === "published" &&
      (typeof entry.source !== "string" || entry.source.length === 0)
    ) {
      failures.push(`${name}: claims a published per-minute ceiling but cites no source`);
    }
  }

  // Every provider the router can reach must have a limit, or the first call to
  // a newly onboarded provider is the unbounded one.
  for (const providerName of Object.keys(routes.providers)) {
    if (limits.providers?.[providerName] === undefined) {
      failures.push(
        `${providerName}: present in the route table but absent from the limits config, so it would run on defaults without anyone deciding that`,
      );
    }
  }

  for (const providerName of Object.keys(limits.providers ?? {})) {
    if (routes.providers[providerName] === undefined) {
      failures.push(`${providerName}: has limits but is not a registered provider`);
    }
  }

  return failures;
}

/**
 * Assert the guards are on the execution path, not merely present.
 *
 * @returns {string[]} Failures.
 */
function checkWiring() {
  /** @type {string[]} */
  const failures = [];
  const chain = readFileSync(CHAIN_PATH, "utf8");
  const guard = readFileSync(GUARD_PATH, "utf8");

  if (!chain.includes("withProviderGuards")) {
    failures.push(
      "the chain executor does not call withProviderGuards, so a leg can reach a transport unbounded — the guard would exist without guarding anything",
    );
  }
  if (!/withProviderGuards\([\s\S]{0,400}?transport\.execute/.test(chain)) {
    failures.push("withProviderGuards does not wrap the transport call itself");
  }
  if (!chain.includes("RateGuardTimeoutError")) {
    failures.push(
      "the chain does not classify a guard timeout, so the client's own pacing would be counted against provider health and could open a breaker on a healthy route",
    );
  }
  if (!/RateGuardTimeoutError[\s\S]{0,300}?countsAgainstHealth: false/.test(chain)) {
    failures.push("a guard timeout is counted against provider health; the provider was never contacted");
  }
  if (!guard.includes("Math.min(maxWaitMs")) {
    failures.push(
      "the guard does not bound queue time by the caller's budget, so a caller could spend its whole deadline queuing and never reach the fallback chain",
    );
  }
  if (!/finally\s*\{[\s\S]{0,400}?release\(\);/.test(guard)) {
    failures.push("the concurrency permit is not released on every path; failures would shrink the limit permanently");
  }
  if (!/withProviderGuards\([\s\S]{0,800}?modelId: leg\.route\.modelId/.test(chain)) {
    failures.push(
      "the chain does not tell the guard which model a leg addresses, so a per-model scope in the limits config is never applied and every model of a provider shares one guard",
    );
  }
  if (!/withProviderGuards\([\s\S]{0,800}?signal: controller\.signal \}/.test(chain)) {
    failures.push(
      "the chain does not hand the leg's signal to the guard, so a leg whose budget or caller is gone keeps its place in the queue until the wait budget runs out",
    );
  }
  if (!chain.includes("onAttemptAbandoned")) {
    failures.push(
      "the chain never returns a half-open probe slot for an attempt that ended without a verdict, so one refused probe wedges its route shut",
    );
  }

  return failures;
}

/**
 * Print failures or the success token.
 *
 * @param {string[]} failures Collected failures.
 * @param {string} token Success token.
 * @returns {void}
 */
function report(failures, token) {
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`FAIL ${failure}\n`);
    }
    process.stderr.write(`${failures.length} failure(s)\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${token}\n`);
}

/**
 * Entry point.
 *
 * @returns {void}
 */
function main() {
  if (process.argv[2] === "wiring") {
    report(checkWiring(), "PROVIDER_LIMITS_WIRED");
    return;
  }
  report(checkConfig(), "PROVIDER_LIMITS_OK");
}

main();
