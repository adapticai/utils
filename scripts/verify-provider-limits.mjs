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
const DECISION_ROUTES_PATH = join(UTILS_ROOT, "src/llm/decision/decision-routes.json");
const CHAIN_PATH = join(UTILS_ROOT, "src/llm/fallback-chain.ts");
const GUARD_PATH = join(UTILS_ROOT, "src/llm/rate-guard.ts");

/** A rate ceiling at or below this is treated as suspiciously permissive to have been guessed. */
const MIN_SENSIBLE_RPM = 1;

/**
 * Assert the limits config is complete and honestly labelled.
 *
 * Complete is judged against both route tables: every provider the generative
 * alias table registers, and every provider of a decision route this package
 * serves, has an entry; and no decision route can queue in a guard for longer
 * than the route's own budget.
 *
 * @returns {string[]} Failures.
 */
function checkConfig() {
  /** @type {string[]} */
  const failures = [];
  const limits = JSON.parse(readFileSync(LIMITS_PATH, "utf8"));
  const routes = JSON.parse(readFileSync(ROUTES_PATH, "utf8"));
  const decisionRoutes = JSON.parse(readFileSync(DECISION_ROUTES_PATH, "utf8"));

  // The decision routes this package serves itself are the only ones its
  // guards ever hold. A route the consumer serves in its own process is
  // declared in the same table and never passes through a guard here.
  const guardedDecisionRoutes = Object.entries(decisionRoutes.routes ?? {}).filter(
    ([, route]) => route.served_by === "utils",
  );
  const guardedDecisionProviders = new Set(guardedDecisionRoutes.map(([, route]) => route.provider));

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

  // A per-model override is a separate limit decision and carries the same
  // burden of proof as a provider entry. It is only enforceable where the
  // provider keeps one guard per model, and only meaningful for a model the
  // route table actually sends to that provider.
  for (const [providerName, entry] of Object.entries(limits.providers ?? {})) {
    if (entry.models === undefined) {
      continue;
    }
    if (entry.scope !== "model") {
      failures.push(
        `${providerName}: carries per-model overrides but its scope is not "model", so one provider-wide guard would ignore them`,
      );
    }
    const routedModels = new Set();
    for (const alias of Object.values(routes.aliases ?? {})) {
      for (const route of alias.routes ?? []) {
        if (route.provider === providerName && typeof route.model_id === "string") {
          routedModels.add(route.model_id);
        }
      }
    }
    for (const [, route] of guardedDecisionRoutes) {
      if (route.provider === providerName && typeof route.version_pin === "string") {
        routedModels.add(route.version_pin);
      }
    }
    for (const [modelId, override] of Object.entries(entry.models)) {
      const name = `${providerName}/${modelId}`;
      if (override.basis !== "published" && override.basis !== "conservative-default") {
        failures.push(`${name}: basis must be "published" or "conservative-default", got ${JSON.stringify(override.basis)}`);
      }
      if (override.basis === "published" && (typeof override.source !== "string" || override.source.length === 0)) {
        failures.push(`${name}: claims a published ceiling but cites no source`);
      }
      for (const field of ["requests_per_minute", "max_concurrent", "acquire_timeout_ms"]) {
        if (typeof override[field] !== "number" || override[field] < MIN_SENSIBLE_RPM) {
          failures.push(`${name}: ${field} must be a positive number`);
        }
      }
      if (typeof override.note !== "string" || override.note.length === 0) {
        failures.push(`${name}: an override must say why this model runs at different numbers from its siblings`);
      }
      if (!routedModels.has(modelId)) {
        failures.push(`${name}: overrides a model no route sends to ${providerName}, so it binds nothing`);
      }
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

  // The same holds for a decision route this package serves: its provider is
  // reached through the same guards, and without an entry of its own it would
  // queue for the package default, which is many times a typed call's budget.
  for (const [routeName, route] of guardedDecisionRoutes) {
    const entry = limits.providers?.[route.provider];
    if (entry === undefined) {
      failures.push(
        `${route.provider}: serves decision route ${routeName} but is absent from the limits config, so it would run on defaults without anyone deciding that`,
      );
      continue;
    }
    // The rate wait is bounded by the entry's own timeout and by nothing the
    // caller passes, so a timeout longer than the route's budget lets a call
    // sit in this package's queue past the point its answer could still be used.
    const override = entry.scope === "model" ? entry.models?.[route.version_pin] : undefined;
    const acquireTimeoutMs = (override ?? entry).acquire_timeout_ms;
    if (typeof acquireTimeoutMs === "number" && acquireTimeoutMs > route.budget_ms) {
      failures.push(
        `${route.provider}: acquire_timeout_ms ${acquireTimeoutMs} exceeds the ${route.budget_ms} ms budget of decision route ${routeName}, so a call could queue here for longer than it is allowed to take`,
      );
    }
  }

  // A provider is registered when either table declares it. One that only a
  // consumer-served decision route names is registered and still unguarded:
  // this package never calls it, so a limit written for it would bind nothing.
  for (const providerName of Object.keys(limits.providers ?? {})) {
    const inAliasTable = routes.providers[providerName] !== undefined;
    const inDecisionTable = decisionRoutes.providers?.[providerName] !== undefined;
    if (!inAliasTable && !inDecisionTable) {
      failures.push(`${providerName}: has limits but is not a registered provider`);
    } else if (!inAliasTable && !guardedDecisionProviders.has(providerName)) {
      failures.push(
        `${providerName}: has limits but this package never guards it: only a decision route the consumer serves names it, so the entry binds nothing`,
      );
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
