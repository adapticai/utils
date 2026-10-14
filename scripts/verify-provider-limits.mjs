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
 * bounds nothing. So the `wiring` mode asserts, against the files that own each
 * construct, that a leg reaches its transport only through the guards, that a
 * guard timeout is not counted against provider health, that the guard bounds
 * its queue and returns its permit, and that no other source dispatches to a
 * transport around them.
 *
 * Usage: node scripts/verify-provider-limits.mjs [wiring]   (from the utils root)
 *
 * Imported, the module runs nothing; `checkWiring` and `readWiringSources` are
 * exported so the wiring assertions can be exercised against altered sources.
 *
 * @module utils/scripts/verify-provider-limits
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const UTILS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIMITS_PATH = join(UTILS_ROOT, "src/llm/provider-limits.json");
const ROUTES_PATH = join(UTILS_ROOT, "src/llm/alias-routes.json");
const DECISION_ROUTES_PATH = join(UTILS_ROOT, "src/llm/decision/decision-routes.json");

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
 * The files that own each guarded construct, relative to the package root.
 *
 * The leg attempt dispatches a generative leg to its transport and classifies
 * how the attempt ended; the same-model group owns the breaker probe slot an
 * attempt may hold; the guard module owns the queue bound and the permit. The
 * chain executor reaches transports only through the group and the attempt.
 */
export const WIRING_FILES = Object.freeze({
  legAttempt: "src/llm/leg-attempt.ts",
  hedge: "src/llm/hedge.ts",
  guard: "src/llm/rate-guard.ts",
});

/**
 * The directory the transports and every caller that dispatches to one live
 * under, relative to the package root. Every production source here is swept
 * for a dispatch that bypasses the guards.
 */
const LLM_SOURCE_DIR = "src/llm";

/** The transport interface's one dispatch method. */
const DISPATCH_METHOD = "execute";

/** The guard every dispatch must pass through. */
const GUARD_FUNCTION = "withProviderGuards";

/** Argument positions of `withProviderGuards(provider, call, maxWaitMs, scope)`. */
const GUARD_THUNK_ARGUMENT = 1;
const GUARD_SCOPE_ARGUMENT = 3;

const requireFromHere = createRequire(import.meta.url);

/**
 * The TypeScript compiler, loaded only by the wiring mode.
 *
 * The wiring assertions read syntax, not text, so a name mentioned in a
 * comment or an import satisfies nothing. The config mode needs no parser and
 * runs without the package's dependencies installed.
 *
 * @returns {typeof import("typescript")} The compiler API.
 */
function loadTypeScript() {
  return requireFromHere("typescript");
}

/**
 * @typedef {object} WiringSources
 * @property {string} legAttempt Text of the leg attempt.
 * @property {string} hedge Text of the same-model group.
 * @property {string} guard Text of the rate and concurrency guards.
 * @property {Readonly<Record<string, string>>} others Text of every other
 *   production source under `src/llm`, keyed by package-relative path.
 */

/**
 * List the production TypeScript sources under a directory, tests excluded.
 *
 * @param {string} dir Absolute directory.
 * @returns {string[]} Absolute paths, sorted.
 */
function listSources(dir) {
  /** @type {string[]} */
  const paths = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") {
        paths.push(...listSources(path));
      }
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !/\.(test|spec)\.ts$/.test(entry.name)
    ) {
      paths.push(path);
    }
  }
  return paths.sort();
}

/**
 * Read the sources the wiring check inspects.
 *
 * @param {string} [root] The package root.
 * @returns {WiringSources} The three owning files and every other production source under `src/llm`.
 */
export function readWiringSources(root = UTILS_ROOT) {
  const named = new Set(Object.values(WIRING_FILES));
  /** @type {Record<string, string>} */
  const others = {};
  for (const path of listSources(join(root, LLM_SOURCE_DIR))) {
    const packagePath = relative(root, path).split(sep).join("/");
    if (!named.has(packagePath)) {
      others[packagePath] = readFileSync(path, "utf8");
    }
  }
  return {
    legAttempt: readFileSync(join(root, WIRING_FILES.legAttempt), "utf8"),
    hedge: readFileSync(join(root, WIRING_FILES.hedge), "utf8"),
    guard: readFileSync(join(root, WIRING_FILES.guard), "utf8"),
    others,
  };
}

/**
 * Every node under `root` the predicate accepts, in source order.
 *
 * @param {typeof import("typescript")} ts The compiler API.
 * @param {import("typescript").Node} root Where to search.
 * @param {(node: import("typescript").Node) => boolean} predicate The test.
 * @returns {import("typescript").Node[]} The matches.
 */
function collect(ts, root, predicate) {
  /** @type {import("typescript").Node[]} */
  const found = [];
  const visit = (/** @type {import("typescript").Node} */ node) => {
    if (predicate(node)) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * Whether a node is a call to a free function of the given name.
 *
 * @param {typeof import("typescript")} ts The compiler API.
 * @param {import("typescript").Node} node The node.
 * @param {string} name The function name.
 * @returns {node is import("typescript").CallExpression} Whether it is.
 */
function isCallTo(ts, node, name) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}

/**
 * Whether a node is a call to a method of the given name, on any receiver.
 *
 * @param {typeof import("typescript")} ts The compiler API.
 * @param {import("typescript").Node} node The node.
 * @param {string} name The method name.
 * @returns {node is import("typescript").CallExpression} Whether it is.
 */
function isMethodCall(ts, node, name) {
  return (
    ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name
  );
}

/**
 * Whether `inner` lies within `outer`'s source range.
 *
 * @param {import("typescript").Node} outer The container.
 * @param {import("typescript").Node} inner The candidate.
 * @returns {boolean} Whether it does.
 */
function within(outer, inner) {
  return inner.pos >= outer.pos && inner.end <= outer.end;
}

/**
 * One parsed source and its guard calls.
 *
 * @typedef {object} ParsedSource
 * @property {import("typescript").SourceFile} file The syntax tree.
 * @property {import("typescript").CallExpression[]} guardCalls Every call to `withProviderGuards`.
 * @property {import("typescript").Node[]} guardedBodies The function bodies those calls run as their admitted work.
 */

/**
 * Parse a source and find what its guard calls run.
 *
 * A guard call's work is its second argument. Inline, that is the function
 * itself. Named, it is the in-file function of that name, and only when every
 * other reference to the name is also a guard call's work: a function the
 * file also calls directly reaches its transport unguarded on that path.
 *
 * @param {typeof import("typescript")} ts The compiler API.
 * @param {string} path Package-relative path, for the parser.
 * @param {string} text The source.
 * @returns {ParsedSource} The parse.
 */
function parseSource(ts, path, text) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const guardCalls = /** @type {import("typescript").CallExpression[]} */ (
    collect(ts, file, (node) => isCallTo(ts, node, GUARD_FUNCTION))
  );

  /** @type {Map<string, import("typescript").Node>} */
  const functionsByName = new Map();
  for (const node of collect(ts, file, () => true)) {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      functionsByName.set(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      functionsByName.set(node.name.text, node.initializer);
    }
  }
  const thunks = new Set(guardCalls.map((call) => call.arguments[GUARD_THUNK_ARGUMENT]).filter(Boolean));

  /** @type {import("typescript").Node[]} */
  const guardedBodies = [];
  for (const thunk of thunks) {
    if (ts.isArrowFunction(thunk) || ts.isFunctionExpression(thunk)) {
      guardedBodies.push(thunk);
      continue;
    }
    if (!ts.isIdentifier(thunk)) {
      continue;
    }
    const target = functionsByName.get(thunk.text);
    if (target === undefined) {
      continue;
    }
    const declarationName = ts.isFunctionDeclaration(target) ? target.name : target.parent.name;
    const references = collect(
      ts,
      file,
      (node) => ts.isIdentifier(node) && node.text === thunk.text && node !== declarationName,
    );
    if (references.every((reference) => thunks.has(reference))) {
      guardedBodies.push(target);
    }
  }
  return { file, guardCalls, guardedBodies };
}

/**
 * The calls in a parsed source that dispatch to a transport outside every guard.
 *
 * @param {typeof import("typescript")} ts The compiler API.
 * @param {ParsedSource} parsed The parse.
 * @returns {{ dispatches: number, unguardedLines: number[] }} How many dispatches, and the lines of the unguarded ones.
 */
function dispatchesOutsideGuards(ts, parsed) {
  const dispatches = collect(ts, parsed.file, (node) => isMethodCall(ts, node, DISPATCH_METHOD));
  const unguardedLines = dispatches
    .filter((dispatch) => !parsed.guardedBodies.some((body) => within(body, dispatch)))
    .map((dispatch) => parsed.file.getLineAndCharacterOfPosition(dispatch.getStart(parsed.file)).line + 1);
  return { dispatches: dispatches.length, unguardedLines };
}

/**
 * The source text of a property of a guard call's scope argument.
 *
 * @param {typeof import("typescript")} ts The compiler API.
 * @param {import("typescript").SourceFile} file The file the call is in.
 * @param {import("typescript").CallExpression} call The guard call.
 * @param {string} name The property.
 * @returns {string | undefined} The initializer's text, or undefined when the scope is not a literal naming it.
 */
function scopeProperty(ts, file, call, name) {
  const scope = call.arguments[GUARD_SCOPE_ARGUMENT];
  if (scope === undefined || !ts.isObjectLiteralExpression(scope)) {
    return undefined;
  }
  for (const property of scope.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText(file) === name) {
      return property.initializer.getText(file);
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
      return name;
    }
  }
  return undefined;
}

/**
 * What a node's truth value implies about the truth of a test inside it: the
 * test's value whenever the node is truthy, and whenever it is falsy, or null
 * where the node's value implies nothing about the test.
 *
 * @typedef {{ whenTrue: boolean | null, whenFalse: boolean | null }} Implication
 */

/**
 * The `if` whose condition implies a test is true, read through the operators
 * between them, or undefined when there is no such `if`.
 *
 * A branch is the guard-timeout branch only when it runs for guard timeouts
 * alone. Finding the test somewhere in the condition is not enough: under a
 * `!` the branch runs for every other error, and beside an `||` it also runs
 * for whatever the other operand admits. So the implication is carried up from
 * the test: a parenthesis keeps it, a `!` swaps its two halves, an `&&` keeps
 * only what its truth implies (both operands hold), an `||` keeps only what its
 * falsity implies (neither holds), and any other construct implies nothing.
 *
 * @param {typeof import("typescript")} ts The compiler API.
 * @param {import("typescript").Node} test The test.
 * @returns {import("typescript").IfStatement | undefined} The `if` whose then-branch runs only when the test holds.
 */
function ifImplyingTest(ts, test) {
  /** @type {Implication} */
  let implication = { whenTrue: true, whenFalse: false };
  let child = test;
  let node = test.parent;
  while (node !== undefined) {
    if (ts.isIfStatement(node) && node.expression === child) {
      return implication.whenTrue === true ? node : undefined;
    }
    if (ts.isParenthesizedExpression(node)) {
      // A parenthesis changes nothing about what its value implies.
    } else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      implication = { whenTrue: implication.whenFalse, whenFalse: implication.whenTrue };
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      implication = { whenTrue: implication.whenTrue, whenFalse: null };
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      implication = { whenTrue: null, whenFalse: implication.whenFalse };
    } else {
      return undefined;
    }
    child = node;
    node = node.parent;
  }
  return undefined;
}

/**
 * Whether every `countsAgainstHealth` a guard-timeout branch sets is `false`.
 *
 * Only a then-branch that runs for guard timeouts alone counts
 * ({@link ifImplyingTest}): a negated or widened condition sends real provider
 * errors down the branch that spares health, and guard timeouts down the one
 * that charges it.
 *
 * @param {typeof import("typescript")} ts The compiler API.
 * @param {import("typescript").Node[]} timeoutTests The `instanceof RateGuardTimeoutError` tests.
 * @returns {boolean} True when at least one branch sets it and none sets anything but `false`.
 */
function guardTimeoutSparesHealth(ts, timeoutTests) {
  /** @type {import("typescript").Node[]} */
  const verdicts = [];
  for (const test of timeoutTests) {
    const node = ifImplyingTest(ts, test);
    if (node === undefined) {
      continue;
    }
    for (const property of collect(
      ts,
      node.thenStatement,
      (candidate) =>
        ts.isPropertyAssignment(candidate) &&
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === "countsAgainstHealth",
    )) {
      verdicts.push(/** @type {import("typescript").PropertyAssignment} */ (property).initializer);
    }
  }
  return verdicts.length > 0 && verdicts.every((verdict) => verdict.kind === ts.SyntaxKind.FalseKeyword);
}

/**
 * Assert the guards are on the execution path, not merely present.
 *
 * Each assertion reads the file that owns the construct it describes and names
 * that file in its failure, so a refactor that moves a construct fails here
 * with the file it left rather than passing on a stale one. Assertions read
 * syntax: a name in a comment or an import satisfies nothing. Besides the
 * owning files, every other production source under `src/llm` is swept for a
 * transport dispatch outside a guard, so a new dispatch site is held to the
 * same rule wherever it is written.
 *
 * @param {WiringSources} [sources] The sources; the default reads the tree.
 * @returns {string[]} Failures.
 */
export function checkWiring(sources = readWiringSources()) {
  const ts = loadTypeScript();
  /** @type {string[]} */
  const failures = [];
  const { legAttempt: legPath, hedge: hedgePath, guard: guardPath } = WIRING_FILES;

  const leg = parseSource(ts, legPath, sources.legAttempt);
  const legGuarded = leg.guardCalls.length > 0;
  if (!legGuarded) {
    failures.push(
      `${legPath}: the leg attempt does not call withProviderGuards, so a leg can reach a transport unbounded — the guard would exist without guarding anything`,
    );
  } else {
    const legDispatch = dispatchesOutsideGuards(ts, leg);
    if (legDispatch.dispatches === 0 || legDispatch.unguardedLines.length > 0) {
      failures.push(
        `${legPath}: withProviderGuards does not wrap the transport call itself${
          legDispatch.dispatches === 0
            ? " (no transport dispatch found)"
            : ` (unguarded dispatch at line ${legDispatch.unguardedLines.join(", ")})`
        }`,
      );
    }
  }

  const timeoutTests = collect(
    ts,
    leg.file,
    (node) =>
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      ts.isIdentifier(node.right) &&
      node.right.text === "RateGuardTimeoutError",
  );
  if (timeoutTests.length === 0) {
    failures.push(
      `${legPath}: the leg attempt does not classify a guard timeout, so the client's own pacing would be counted against provider health and could open a breaker on a healthy route`,
    );
  } else if (!guardTimeoutSparesHealth(ts, timeoutTests)) {
    failures.push(`${legPath}: a guard timeout is counted against provider health; the provider was never contacted`);
  }

  const guard = parseSource(ts, guardPath, sources.guard);
  const guardFunction = collect(
    ts,
    guard.file,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === GUARD_FUNCTION,
  )[0];
  const boundsQueue =
    guardFunction !== undefined &&
    collect(
      ts,
      guardFunction,
      (node) =>
        isMethodCall(ts, node, "min") &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Math" &&
        node.arguments[0] !== undefined &&
        ts.isIdentifier(node.arguments[0]) &&
        node.arguments[0].text === "maxWaitMs",
    ).length > 0;
  if (!boundsQueue) {
    failures.push(
      `${guardPath}: withProviderGuards does not bound queue time by the caller's budget, so a caller could spend its whole deadline queuing and never reach the fallback chain`,
    );
  }
  const releasesAlways =
    guardFunction !== undefined &&
    collect(
      ts,
      guardFunction,
      (node) =>
        ts.isTryStatement(node) &&
        node.finallyBlock !== undefined &&
        collect(ts, node.finallyBlock, (inner) => isCallTo(ts, inner, "release")).length > 0,
    ).length > 0;
  if (!releasesAlways) {
    failures.push(
      `${guardPath}: the concurrency permit is not released on every path; failures would shrink the limit permanently`,
    );
  }

  if (legGuarded) {
    if (!leg.guardCalls.every((call) => scopeProperty(ts, leg.file, call, "modelId") === "leg.route.modelId")) {
      failures.push(
        `${legPath}: the leg attempt does not tell the guard which model a leg addresses, so a per-model scope in the limits config is never applied and every model of a provider shares one guard`,
      );
    }
    if (!leg.guardCalls.every((call) => scopeProperty(ts, leg.file, call, "signal") === "controller.signal")) {
      failures.push(
        `${legPath}: the leg attempt does not hand the leg's signal to the guard, so a leg whose budget or caller is gone keeps its place in the queue until the wait budget runs out`,
      );
    }
  }

  const hedge = parseSource(ts, hedgePath, sources.hedge);
  if (collect(ts, hedge.file, (node) => isMethodCall(ts, node, "onAttemptAbandoned")).length === 0) {
    failures.push(
      `${hedgePath}: the same-model group never returns a half-open probe slot for an attempt that ended without a verdict, so one refused probe wedges its route shut`,
    );
  }

  const swept = [
    [hedgePath, hedge],
    [guardPath, guard],
    ...Object.entries(sources.others).map(([path, text]) => [path, parseSource(ts, path, text)]),
  ];
  for (const [path, parsed] of swept) {
    for (const line of dispatchesOutsideGuards(ts, parsed).unguardedLines) {
      failures.push(
        `${path}:${line}: dispatches to a transport outside withProviderGuards, so that call is held by no rate or concurrency limit`,
      );
    }
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
 * Whether this module is the program node was asked to run, rather than an
 * import. Importing the module, as its tests do, must run no check and set no
 * exit code.
 *
 * @returns {boolean} Whether it is.
 */
function isEntryPoint() {
  const invoked = process.argv[1];
  return (
    invoked !== undefined &&
    existsSync(invoked) &&
    realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url))
  );
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

if (isEntryPoint()) {
  main();
}
