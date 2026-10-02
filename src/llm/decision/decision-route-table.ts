/**
 * Typed access to the decision-route table.
 *
 * The table is bundled rather than fetched, so which routes exist, who serves
 * each and whether each may be called is fixed by the release a consumer
 * installed. Opening a route is therefore a reviewed change to data and a
 * release, never something a running process can decide for itself.
 *
 * Three things are done here and nowhere else.
 *
 * The table is checked when it loads. A bound the schema cannot express (a rule
 * that spans two fields, or one that depends on which process serves the route)
 * is enforced in code, and a table that breaks one stops the module from
 * loading: the table can only change in a release, so a violation must stop
 * that release rather than run in it.
 *
 * Admission is decided. A route this package serves is callable only when its
 * model id is confirmed, its provider account is live, its contract was
 * confirmed by an authenticated call, and a base URL resolves. Each of those is
 * a fact declared in the table, so a route nobody has verified is refused with
 * the reason, and nothing downstream has to know why.
 *
 * A route is resolved for execution. Only an admitted route resolves, so the
 * caller receives every field a call needs or an error, never a partly
 * resolved route.
 *
 * @module llm/decision/decision-route-table
 */

import rawTable from "./decision-routes.json";
import { DecisionRouteUnavailableError } from "./errors";
import type {
  DecisionApiStyle,
  DecisionHostedProviderDeclaration,
  DecisionProviderDeclaration,
  DecisionRouteAdmission,
  DecisionRouteDeclaration,
  DecisionRouteTable,
  DecisionStateBudgetBasis,
  DecisionUtilsServedRouteDeclaration,
  ResolvedDecisionRoute,
} from "./route-types";
import { DECISION_ROUTES } from "./types";
import type { DecisionRoute } from "./types";

/**
 * The shortest budget a route may declare, in milliseconds.
 *
 * Below it no request to a model in another process can complete, so every
 * call would time out and the route's breaker would open on a budget nobody
 * could meet. It is far below the generative table's floor on purpose: a typed
 * call answers in a fraction of a second, and a floor sized for prose would
 * make its budget meaningless.
 */
export const DECISION_BUDGET_FLOOR_MS = 50;

/**
 * The longest budget a route may declare, in milliseconds.
 *
 * A typed call that has not answered by then is not going to be useful to a
 * caller that asked a bounded question, and a route that could hold one for
 * longer would hold the decision waiting on it.
 */
export const DECISION_BUDGET_CEILING_MS = 10_000;

/** A read-only view of an environment: variable NAME to value. */
export type DecisionRouteEnvironment = Readonly<Record<string, string | undefined>>;

/** Which process serves a route. */
type DecisionRouteServer = DecisionRouteDeclaration["served_by"];

/**
 * Who serves each route.
 *
 * A route's name states who answers it, and consumers branch on the name. A
 * table that declared the local route as served here would have this package
 * calling a vendor under a name every consumer reads as its own process.
 */
const ROUTE_SERVER: Readonly<Record<DecisionRoute, DecisionRouteServer>> = {
  "dm.hosted": "utils",
  "dm.local": "engine",
};

/** How the provider of a route is spoken to, by who serves the route. */
const SERVER_API_STYLE: Readonly<Record<DecisionRouteServer, DecisionApiStyle>> = {
  utils: "systemone",
  engine: "engine-judge",
};

/** Where a route's state-token ceiling comes from, by who serves the route. */
const SERVER_STATE_BUDGET_BASIS: Readonly<Record<DecisionRouteServer, DecisionStateBudgetBasis>> = {
  utils: "vendor-documented-ceiling",
  engine: "checkpoint-window",
};

/** The provider account statuses a table may declare. */
const ACCOUNT_STATUSES: readonly string[] = ["live", "pending-onboarding", "not-in-scope"];

/** The model id statuses a table may declare. */
const MODEL_ID_STATUSES: readonly string[] = ["confirmed", "pending-provider-confirmation"];

/** The ways a contract may have been established. */
const CONTRACT_EVIDENCE: readonly string[] = ["documentation", "authenticated-call"];

/** The fields only a provider reached over HTTP declares. */
const HOSTED_PROVIDER_FIELDS: readonly string[] = ["base_url", "base_url_env", "api_key_env", "secret_path"];

/**
 * A model name that follows a vendor's releases instead of naming one.
 *
 * A request sent to such a name is answered by whichever model the vendor
 * currently points it at, so the answering model changes with no change on
 * this side and no entry in any table.
 */
const MOVING_MODEL_NAME = /(?:latest|preview)$/i;

/** The name of an environment variable. */
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]*$/;

/** A calendar date, as the table writes one. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A full commit hash. */
const COMMIT_HASH = /^[0-9a-f]{40}$/;

/** A SHA-256 digest in hexadecimal. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The schemes a base URL may use. */
const BASE_URL_PROTOCOLS: readonly string[] = ["https:", "http:"];

/** The scheme a base URL written in the table must use: the key travels in a request header. */
const DECLARED_BASE_URL_PROTOCOL = "https:";

/** The fewest levels a score can have, so the smallest useful cap on them. */
const MIN_SCORE_LEVELS = 2;

/** The shortest breaker cooldown, in milliseconds: shorter and an open breaker protects nothing. */
const MIN_BREAKER_COOLDOWN_MS = 1_000;

/** The largest share of prior concurrency a half-open breaker may probe with. */
const MAX_PROBE_FRACTION = 0.5;

/** Trailing slashes of a URL, removed so a path is appended by one rule. */
const TRAILING_SLASHES = /\/+$/;

/**
 * Freeze a value and everything it holds.
 *
 * @param value The value to freeze.
 * @returns The same value, frozen at every depth.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const nested of Object.values(value) as unknown[]) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * The canonical decision-route table.
 *
 * Frozen at every depth. Whether a route may be called is read from this
 * object on every call, so a table that could be edited at runtime would let
 * one line of consumer code open a route that review had left closed.
 */
export const decisionRouteTable: DecisionRouteTable = deepFreeze(rawTable as unknown as DecisionRouteTable);

/**
 * Whether a value is an object with named fields.
 *
 * @param value The value.
 * @returns Whether it is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a whole number inside closed bounds.
 *
 * @param value The value.
 * @param min Lower bound, included.
 * @param max Upper bound, included.
 * @returns Whether it is an integer in range.
 */
function isIntegerIn(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Whether a value is a finite number that is not negative.
 *
 * @param value The value.
 * @returns Whether it is a usable price or fraction.
 */
function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Whether a value is a string with content.
 *
 * @param value The value.
 * @returns Whether it is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Whether a value is a string of a given form.
 *
 * @param value The value.
 * @param form The form it must have.
 * @returns Whether it is a string matching the form.
 */
function isStringOf(value: unknown, form: RegExp): value is string {
  return typeof value === "string" && form.test(value);
}

/**
 * Whether a name is one of the decision routes.
 *
 * @param name The name.
 * @returns Whether it is a route a caller may name.
 */
function isDecisionRoute(name: string): name is DecisionRoute {
  return (DECISION_ROUTES as readonly string[]).includes(name);
}

/**
 * Read an own field of an object, ignoring anything inherited.
 *
 * A name that comes from a caller or from data may be the name of something on
 * every object's prototype, which a plain index would return as if the table
 * had declared it.
 *
 * @param holder The object.
 * @param key The field's name.
 * @returns The field, or `undefined` when the object does not itself hold it.
 */
function ownField<Value>(holder: Readonly<Record<string, Value>>, key: string): Value | undefined {
  return Object.hasOwn(holder, key) ? holder[key] : undefined;
}

/**
 * Normalise a base URL, or say it is not one.
 *
 * @param text The URL as written.
 * @param protocols The schemes it may use.
 * @returns The URL without trailing slashes, or `null` when the text is not an
 * absolute URL in one of the schemes.
 */
function usableBaseUrl(text: string, protocols: readonly string[]): string | null {
  if (!URL.canParse(text)) {
    return null;
  }
  return protocols.includes(new URL(text).protocol) ? text.replace(TRAILING_SLASHES, "") : null;
}

/**
 * Violations in the breaker defaults.
 *
 * @param breaker The table's `defaults.circuit_breaker`, as parsed.
 * @returns One message per violation.
 */
function breakerViolations(breaker: unknown): string[] {
  const at = "defaults.circuit_breaker";
  if (!isRecord(breaker)) {
    return [`${at} must be an object`];
  }
  const violations: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) {
      violations.push(`${at}.${message}`);
    }
  };
  check(
    isIntegerIn(breaker.failure_threshold, 1, Number.MAX_SAFE_INTEGER),
    "failure_threshold must be a positive integer",
  );
  check(
    isIntegerIn(breaker.cooldown_ms, MIN_BREAKER_COOLDOWN_MS, Number.MAX_SAFE_INTEGER),
    `cooldown_ms must be an integer of at least ${MIN_BREAKER_COOLDOWN_MS}`,
  );
  check(
    breaker.capacity_cooldown_ms === undefined ||
      isIntegerIn(breaker.capacity_cooldown_ms, MIN_BREAKER_COOLDOWN_MS, Number.MAX_SAFE_INTEGER),
    `capacity_cooldown_ms must be an integer of at least ${MIN_BREAKER_COOLDOWN_MS}`,
  );
  check(
    isIntegerIn(breaker.half_open_probes, 1, Number.MAX_SAFE_INTEGER),
    "half_open_probes must be a positive integer",
  );
  check(
    breaker.probe_fraction === undefined ||
      (isNonNegativeFinite(breaker.probe_fraction) && breaker.probe_fraction <= MAX_PROBE_FRACTION),
    `probe_fraction must be in [0, ${MAX_PROBE_FRACTION}]`,
  );
  check(
    breaker.latency_trip === undefined,
    "latency_trip must be absent: its objectives are keyed by generative latency classes, " +
      "which a decision route does not have",
  );
  return violations;
}

/**
 * Violations in one provider declaration.
 *
 * @param name The provider's key in the table.
 * @param provider The declaration, as parsed.
 * @returns One message per violation.
 */
function providerViolations(name: string, provider: unknown): string[] {
  const at = `providers.${name}`;
  if (!isRecord(provider)) {
    return [`${at} must be an object`];
  }
  const violations: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) {
      violations.push(`${at}.${message}`);
    }
  };
  check(
    typeof provider.account_status === "string" && ACCOUNT_STATUSES.includes(provider.account_status),
    `account_status must be one of ${ACCOUNT_STATUSES.join(", ")}`,
  );
  if (provider.api_style === SERVER_API_STYLE.engine) {
    for (const field of HOSTED_PROVIDER_FIELDS) {
      check(
        !Object.hasOwn(provider, field),
        `${field} must be absent: this package never contacts a provider the consumer serves`,
      );
    }
    return violations;
  }
  if (provider.api_style !== SERVER_API_STYLE.utils) {
    check(false, `api_style must be "${SERVER_API_STYLE.utils}" or "${SERVER_API_STYLE.engine}"`);
    return violations;
  }
  check(isStringOf(provider.api_key_env, ENV_VAR_NAME), "api_key_env must be the NAME of an environment variable");
  check(isNonEmptyString(provider.secret_path), "secret_path must be a non-empty string");
  check(
    provider.base_url_env === null || isStringOf(provider.base_url_env, ENV_VAR_NAME),
    "base_url_env must be the NAME of an environment variable, or null",
  );
  check(
    provider.base_url === null ||
      (typeof provider.base_url === "string" &&
        usableBaseUrl(provider.base_url, [DECLARED_BASE_URL_PROTOCOL]) !== null),
    "base_url must be an absolute https URL, or null",
  );
  check(
    provider.base_url !== null || provider.base_url_env !== null,
    "base_url and base_url_env are both null, so no base URL could ever resolve",
  );
  return violations;
}

/**
 * Violations in a route's price anchor.
 *
 * @param at Where the route sits, for messages.
 * @param price The route's `price_per_mtok`, as parsed.
 * @returns One message per violation.
 */
function priceViolations(at: string, price: unknown): string[] {
  if (price === null) {
    return [];
  }
  if (!isRecord(price)) {
    return [`${at}.price_per_mtok must be a price anchor, or null for a route that bills nothing per token`];
  }
  const violations: string[] = [];
  if (!isNonNegativeFinite(price.input) || !isNonNegativeFinite(price.output)) {
    violations.push(`${at}.price_per_mtok.input and .output must be non-negative numbers`);
  }
  if (!isStringOf(price.as_of, ISO_DATE)) {
    violations.push(`${at}.price_per_mtok.as_of must be a date`);
  }
  return violations;
}

/**
 * Violations in the fields only a route this package serves declares.
 *
 * @param at Where the route sits, for messages.
 * @param route The declaration, as parsed.
 * @returns One message per violation.
 */
function utilsServedViolations(at: string, route: Readonly<Record<string, unknown>>): string[] {
  const violations: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) {
      violations.push(`${at}.${message}`);
    }
  };
  for (const field of ["version_pin", "expected_served_model"]) {
    const modelId = route[field];
    check(isNonEmptyString(modelId), `${field} must be a non-empty model id`);
    check(
      !isStringOf(modelId, MOVING_MODEL_NAME),
      `${field} must be a versioned model id: ${JSON.stringify(modelId)} ` +
        "is a name that moves with the vendor's releases",
    );
  }
  check(
    typeof route.model_id_status === "string" && MODEL_ID_STATUSES.includes(route.model_id_status),
    `model_id_status must be one of ${MODEL_ID_STATUSES.join(", ")}`,
  );
  check(
    typeof route.contract_evidence === "string" && CONTRACT_EVIDENCE.includes(route.contract_evidence),
    `contract_evidence must be one of ${CONTRACT_EVIDENCE.join(", ")}`,
  );
  check(
    route.contract_verified === null || isStringOf(route.contract_verified, ISO_DATE),
    "contract_verified must be a date, or null",
  );
  check(
    (route.contract_evidence === "authenticated-call") === (route.contract_verified !== null),
    "contract_evidence and contract_verified disagree: an authenticated call has a date, and documentation has none",
  );
  return violations;
}

/**
 * Violations in the fields only a route the consumer serves declares.
 *
 * @param at Where the route sits, for messages.
 * @param route The declaration, as parsed.
 * @returns One message per violation.
 */
function engineServedViolations(at: string, route: Readonly<Record<string, unknown>>): string[] {
  const violations: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) {
      violations.push(`${at}.${message}`);
    }
  };
  check(isNonEmptyString(route.checkpoint), "checkpoint must be a non-empty string");
  check(isNonEmptyString(route.package_version), "package_version must be a non-empty string");
  check(isStringOf(route.revision, COMMIT_HASH), "revision must be a full 40-character commit hash");

  const digests = route.artifact_sha256;
  if (route.pin_status === "pending-artifact-digests") {
    check(digests === null, "artifact_sha256 must be null while pin_status is pending-artifact-digests");
  } else if (route.pin_status === "pinned") {
    check(
      isRecord(digests) &&
        Object.keys(digests).length > 0 &&
        Object.values(digests).every((digest) => isStringOf(digest, SHA256_HEX)),
      "artifact_sha256 must map at least one artifact to a SHA-256 digest when pin_status is pinned",
    );
  } else {
    check(false, "pin_status must be pending-artifact-digests or pinned");
  }
  return violations;
}

/**
 * Violations in one route declaration.
 *
 * @param name The route.
 * @param route The declaration, as parsed.
 * @param providers The table's providers, as parsed.
 * @returns One message per violation.
 */
function routeViolations(
  name: DecisionRoute,
  route: unknown,
  providers: Readonly<Record<string, unknown>>,
): string[] {
  const at = `routes.${name}`;
  if (!isRecord(route)) {
    return [`${at} must be an object`];
  }
  const violations: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) {
      violations.push(`${at}.${message}`);
    }
  };
  const server = ROUTE_SERVER[name];
  check(
    route.served_by === server,
    `served_by must be "${server}": the route's name states who answers it, and consumers branch on the name`,
  );

  const provider = typeof route.provider === "string" ? ownField(providers, route.provider) : undefined;
  if (!isRecord(provider)) {
    check(false, `provider names ${JSON.stringify(route.provider)}, which is not a declared provider`);
  } else {
    check(
      provider.api_style === SERVER_API_STYLE[server],
      `provider must have api_style "${SERVER_API_STYLE[server]}" for a route served by ${server}`,
    );
  }

  check(route.response_kind === "typed-distribution", 'response_kind must be "typed-distribution"');
  check(
    isIntegerIn(route.budget_ms, DECISION_BUDGET_FLOOR_MS, DECISION_BUDGET_CEILING_MS),
    `budget_ms must be an integer in [${DECISION_BUDGET_FLOOR_MS}, ${DECISION_BUDGET_CEILING_MS}]`,
  );

  const caps = route.caps;
  if (!isRecord(caps)) {
    check(false, "caps must be an object");
  } else {
    check(isIntegerIn(caps.max_options, 1, Number.MAX_SAFE_INTEGER), "caps.max_options must be a positive integer");
    check(
      isIntegerIn(caps.max_score_levels, MIN_SCORE_LEVELS, Number.MAX_SAFE_INTEGER),
      `caps.max_score_levels must be an integer of at least ${MIN_SCORE_LEVELS}`,
    );
    check(
      caps.max_questions === null || isIntegerIn(caps.max_questions, 1, Number.MAX_SAFE_INTEGER),
      "caps.max_questions must be a positive integer, or null where no limit is published",
    );
  }

  check(
    isIntegerIn(route.max_state_tokens, 1, Number.MAX_SAFE_INTEGER),
    "max_state_tokens must be a positive integer",
  );
  check(
    route.max_state_tokens_basis === SERVER_STATE_BUDGET_BASIS[server],
    `max_state_tokens_basis must be "${SERVER_STATE_BUDGET_BASIS[server]}" for a route served by ${server}`,
  );
  violations.push(...priceViolations(at, route.price_per_mtok));
  violations.push(...(server === "utils" ? utilsServedViolations(at, route) : engineServedViolations(at, route)));
  return violations;
}

/**
 * Everything wrong with a decision-route table.
 *
 * The table is read as parsed data rather than trusted as its type: the type
 * is a claim about a JSON file, and this is where the claim is checked. Every
 * field a call later reads is checked here, so admission and resolution can
 * rely on the shape without guarding it again.
 *
 * @param table The table to check.
 * @returns One message per violation; empty when the table is sound.
 */
export function decisionRouteViolations(table: DecisionRouteTable): string[] {
  const root: unknown = table;
  if (!isRecord(root)) {
    return ["the table must be an object"];
  }
  const violations: string[] = [];
  violations.push(...breakerViolations(isRecord(root.defaults) ? root.defaults.circuit_breaker : undefined));

  const providers = isRecord(root.providers) ? root.providers : null;
  if (providers === null) {
    violations.push("providers must be an object");
  } else {
    for (const [name, provider] of Object.entries(providers)) {
      violations.push(...providerViolations(name, provider));
    }
  }

  const routes = root.routes;
  if (!isRecord(routes)) {
    violations.push("routes must be an object");
    return violations;
  }
  for (const name of Object.keys(routes)) {
    if (!isDecisionRoute(name)) {
      violations.push(
        `routes.${name} is not a decision route: a route is one of ${DECISION_ROUTES.join(", ")}, ` +
          "and a rule with no provider and no transport is not declared as one",
      );
    }
  }
  for (const route of DECISION_ROUTES) {
    if (!Object.hasOwn(routes, route)) {
      violations.push(`routes.${route} is missing: every consumer reads both routes from this table`);
      continue;
    }
    violations.push(...routeViolations(route, routes[route], providers ?? {}));
  }
  return violations;
}

{
  // Checked when the table loads: it is bundled, so a violation can only
  // arrive in a release, and it must stop that release rather than run in it.
  const violations = decisionRouteViolations(decisionRouteTable);
  if (violations.length > 0) {
    throw new Error(`decision route table is invalid: ${violations.join("; ")}`);
  }
}

/**
 * Every route the canonical table declares.
 *
 * @returns The route names, sorted for stable iteration.
 */
export function listDecisionRoutes(): DecisionRoute[] {
  return DECISION_ROUTES.filter((route) => Object.hasOwn(decisionRouteTable.routes, route)).sort();
}

/**
 * Read a route's declaration.
 *
 * A pure read with no admission check: a consumer that serves a route itself
 * reads the checkpoint, caps and budget it must honour from here, whether or
 * not this package would serve the route.
 *
 * @param route The route.
 * @param table The table to read; the canonical one unless a test supplies another.
 * @returns The route's declaration.
 * @throws {DecisionRouteUnavailableError} When the table declares no such route.
 */
export function decisionRouteDeclaration(
  route: DecisionRoute,
  table: DecisionRouteTable = decisionRouteTable,
): DecisionRouteDeclaration {
  const declaration = ownField(table.routes, route);
  if (declaration === undefined) {
    throw new DecisionRouteUnavailableError({
      route,
      code: "route_not_admitted",
      reason:
        "the decision route table declares no route of that name; " +
        `it declares ${Object.keys(table.routes).join(", ")}`,
    });
  }
  return declaration;
}

/** The outcome of admission, carrying what a resolved route is built from. */
type AdmissionOutcome =
  | {
      readonly admit: true;
      readonly route: DecisionUtilsServedRouteDeclaration;
      readonly provider: DecisionHostedProviderDeclaration;
      readonly baseUrl: string;
    }
  | Extract<DecisionRouteAdmission, { readonly admit: false }>;

/**
 * Refuse a route that this package could serve but may not call today.
 *
 * @param reason What about the route closes it.
 * @returns The refusal.
 */
function notAdmitted(reason: string): AdmissionOutcome {
  return { admit: false, code: "route_not_admitted", reason };
}

/**
 * The base URL a provider is called at, or why none resolves.
 *
 * The environment override wins over the declared URL. An override that is set
 * and unusable is a refusal rather than a fall back to the declared URL: the
 * operator who set it meant the traffic to go somewhere else, and sending it to
 * the default instead would be a silent change of destination. The override's
 * value is never quoted, because a URL can carry a credential.
 *
 * @param provider The provider.
 * @param env The environment to read the override from.
 * @returns The URL, or the reason there is none.
 */
function resolveBaseUrl(
  provider: DecisionHostedProviderDeclaration,
  env: DecisionRouteEnvironment,
): { readonly url: string } | { readonly url: null; readonly reason: string } {
  const overrideName = provider.base_url_env;
  const override = overrideName === null ? undefined : env[overrideName];
  if (overrideName !== null && override !== undefined && override.length > 0) {
    const url = usableBaseUrl(override, BASE_URL_PROTOCOLS);
    return url === null
      ? {
          url: null,
          reason: `base URL unresolved: ${overrideName} is set to something that is not an absolute http(s) URL`,
        }
      : { url };
  }
  if (provider.base_url === null) {
    return {
      url: null,
      reason:
        overrideName === null
          ? "base URL unresolved: the provider declares none"
          : `base URL unresolved: the provider declares none and ${overrideName} is unset`,
    };
  }
  const url = usableBaseUrl(provider.base_url, BASE_URL_PROTOCOLS);
  return url === null
    ? { url: null, reason: "base URL unresolved: the declared base URL is not an absolute URL" }
    : { url };
}

/**
 * Decide admission, keeping what the admitting branch established.
 *
 * The admitting branch hands back the narrowed route, the narrowed provider
 * and the resolved URL, so the resolver uses the very values admission checked
 * instead of reading them a second time.
 *
 * @param route The route's declaration.
 * @param provider The provider it names.
 * @param env The environment to read a base URL override from.
 * @returns The outcome.
 */
function admitRoute(
  route: DecisionRouteDeclaration,
  provider: DecisionProviderDeclaration,
  env: DecisionRouteEnvironment,
): AdmissionOutcome {
  if (route.served_by === "engine") {
    return {
      admit: false,
      code: "engine_served",
      reason: "the route is answered by the consumer's own process, and this package holds no transport for it",
    };
  }
  if (provider.api_style !== "systemone") {
    return notAdmitted(
      `provider ${route.provider} has api style "${provider.api_style}", which this package has no transport for`,
    );
  }
  if (route.model_id_status !== "confirmed") {
    return notAdmitted(
      `model id unconfirmed (${route.version_pin}); a pin is transcribed from the provider's model list, never guessed`,
    );
  }
  if (provider.account_status !== "live") {
    return notAdmitted(`provider account status is "${provider.account_status}"`);
  }
  if (route.contract_evidence !== "authenticated-call") {
    return notAdmitted(
      `contract evidence is "${route.contract_evidence}": the request, response and error shapes were read, ` +
        "and no authenticated call has confirmed them",
    );
  }
  const baseUrl = resolveBaseUrl(provider, env);
  if (baseUrl.url === null) {
    return notAdmitted(baseUrl.reason);
  }
  return { admit: true, route, provider, baseUrl: baseUrl.url };
}

/**
 * Whether a route may be called from this package, and if not, why.
 *
 * The order is the order of how fundamental the refusal is. A route the
 * consumer serves is refused first, with its own code, because that is a
 * statement about the design and never becomes true. The rest are facts that
 * onboarding changes, checked in the order onboarding establishes them: a
 * confirmed model id, a live account, a contract confirmed by an authenticated
 * call, and last a base URL, which depends on the environment the process
 * happens to run in.
 *
 * @param route The route's declaration.
 * @param provider The provider it names.
 * @param env The environment to read a base URL override from; the process's own by default.
 * @returns Admission, or the code and reason of the refusal.
 */
export function decisionRouteAdmission(
  route: DecisionRouteDeclaration,
  provider: DecisionProviderDeclaration,
  env: DecisionRouteEnvironment = process.env,
): DecisionRouteAdmission {
  const outcome = admitRoute(route, provider, env);
  return outcome.admit ? { admit: true } : outcome;
}

/**
 * Resolve a route for execution.
 *
 * Refuses before anything else is touched, so a closed route costs its caller
 * nothing: no request is encoded, no guard is entered and no vendor is
 * contacted.
 *
 * A table other than the canonical one is checked on every call, because it
 * was not checked when this module loaded and nothing stops it being edited
 * between calls. The canonical table is frozen and was checked once.
 *
 * @param route The route.
 * @param table The table to resolve against; the canonical one unless a test or a probe supplies another.
 * @param env The environment to read a base URL override from; the process's own by default.
 * @returns The resolved route.
 * @throws {DecisionRouteUnavailableError} When the route may not be called.
 */
export function resolveDecisionRoute(
  route: DecisionRoute,
  table: DecisionRouteTable = decisionRouteTable,
  env: DecisionRouteEnvironment = process.env,
): ResolvedDecisionRoute {
  if (table !== decisionRouteTable) {
    const violations = decisionRouteViolations(table);
    if (violations.length > 0) {
      throw new DecisionRouteUnavailableError({
        route,
        code: "route_not_admitted",
        reason: `the route table is invalid: ${violations.join("; ")}`,
      });
    }
  }
  const declaration = decisionRouteDeclaration(route, table);
  const provider = ownField(table.providers, declaration.provider);
  if (provider === undefined) {
    throw new DecisionRouteUnavailableError({
      route,
      code: "route_not_admitted",
      reason: `the route names provider ${declaration.provider}, which the table does not declare`,
    });
  }
  const outcome = admitRoute(declaration, provider, env);
  if (!outcome.admit) {
    throw new DecisionRouteUnavailableError({ route, code: outcome.code, reason: outcome.reason });
  }
  return {
    route,
    providerName: outcome.route.provider,
    provider: outcome.provider,
    modelPin: outcome.route.version_pin,
    expectedServedModel: outcome.route.expected_served_model,
    budgetMs: outcome.route.budget_ms,
    caps: {
      maxOptions: outcome.route.caps.max_options,
      maxScoreLevels: outcome.route.caps.max_score_levels,
      maxQuestions: outcome.route.caps.max_questions,
    },
    maxStateTokens: outcome.route.max_state_tokens,
    priceAnchor: outcome.route.price_per_mtok,
    apiKeyEnv: outcome.provider.api_key_env,
    baseUrl: outcome.baseUrl,
  };
}
