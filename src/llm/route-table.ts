/**
 * Typed access to the canonical alias route table.
 *
 * The table is imported rather than fetched so an alias always resolves, even
 * when the gateway is unreachable. A client that could only learn its routes
 * from the gateway would have no way to fall back when the gateway itself is
 * the thing that failed, which would make the mandatory fallback chain of PD-3
 * conditional on the very component it exists to survive.
 *
 * Resolution is deliberately conservative in three ways. An unknown alias is an
 * error rather than a default, because a typo silently served by whichever
 * model happened to be configured is worse than a loud failure. A route whose
 * vendor model id is unconfirmed is excluded, because a guessed id fails at the
 * first live call rather than at review. And a shadow-only route is never
 * served, because a candidate that can answer a live request has stopped being
 * a candidate.
 *
 * @module llm/route-table
 */

import rawTable from "./alias-routes.json";
import type {
  LlmAlias,
  LlmAliasDefinition,
  LlmProvider,
  LlmRoute,
  LlmRouteTable,
  ResolvedRoute,
} from "./types";

/** Chain order, fixed by role rather than by authoring order in the file. */
const ROLE_ORDER: readonly string[] = ["primary", "secondary", "closed_incumbent"];

/** Suffix naming an alias's research-isolated variant (PD-9). */
export const ISOLATED_SUFFIX = ".isolated";

/**
 * The canonical route table.
 *
 * Exposed as a readonly view so a consumer can inspect routing without being
 * able to mutate it. A table that could be edited at runtime would let one
 * caller change every other caller's routing.
 */
export const routeTable: LlmRouteTable = rawTable as unknown as LlmRouteTable;

/**
 * Every alias the table defines.
 *
 * @returns The alias names, sorted for stable iteration.
 */
export function listAliases(): LlmAlias[] {
  return Object.keys(routeTable.aliases).sort() as LlmAlias[];
}

/**
 * Look up an alias definition.
 *
 * @param alias The alias to resolve.
 * @returns Its definition.
 * @throws When the alias is not defined by the route table.
 */
export function aliasDefinition(alias: LlmAlias): LlmAliasDefinition {
  const definition = routeTable.aliases[alias];
  if (definition === undefined) {
    throw new UnknownAliasError(alias, listAliases());
  }
  return definition;
}

/**
 * Look up a provider registry entry.
 *
 * @param name The provider key.
 * @returns Its registry entry.
 * @throws When the provider is not registered.
 */
export function providerEntry(name: string): LlmProvider {
  const provider = routeTable.providers[name];
  if (provider === undefined) {
    throw new Error(
      `route table names provider "${name}", which is not in the provider registry`,
    );
  }
  return provider;
}

/** Thrown when a caller names an alias the route table does not define. */
export class UnknownAliasError extends Error {
  /** The alias that was requested. */
  public readonly alias: string;

  /** The aliases that do exist, so the message is actionable. */
  public readonly known: readonly string[];

  /**
   * @param alias The unrecognised alias.
   * @param known The aliases the table defines.
   */
  public constructor(alias: string, known: readonly string[]) {
    super(
      `unknown LLM alias "${alias}". Known aliases: ${known.join(", ")}. ` +
        "Application code names aliases only; adding one is a change to the route table.",
    );
    this.name = "UnknownAliasError";
    this.alias = alias;
    this.known = known;
  }
}

/** Thrown when an alias exists but has no leg that can currently serve a caller. */
export class NoServableRouteError extends Error {
  /** The alias that could not be served. */
  public readonly alias: string;

  /** Why each of its legs was excluded, in chain order. */
  public readonly exclusions: readonly string[];

  /**
   * @param alias The alias.
   * @param exclusions Per-leg reasons, in chain order.
   */
  public constructor(alias: string, exclusions: readonly string[]) {
    super(
      `alias "${alias}" has no servable route. Legs excluded: ${exclusions.join("; ")}`,
    );
    this.name = "NoServableRouteError";
    this.alias = alias;
    this.exclusions = exclusions;
  }
}

/**
 * Order an alias's routes into the chain the client walks.
 *
 * @param definition The alias definition.
 * @returns Routes ordered primary -> secondary -> closed incumbent.
 */
export function orderedRoutes(definition: LlmAliasDefinition): LlmRoute[] {
  return [...definition.routes].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );
}

/**
 * Stable identity for one leg, used to key its circuit breaker and its metrics.
 *
 * Keyed by alias, isolation and role rather than by provider and model, because
 * the breaker guards a position in a chain: reverting an alias to a different
 * model at the same position should inherit that position's health rather than
 * start blind, and the isolated variant must never share a breaker with the
 * shared one.
 *
 * @param alias The alias.
 * @param isolated Whether this is the isolated variant.
 * @param role The leg's role.
 * @returns The route key.
 */
export function routeKeyFor(
  alias: LlmAlias,
  isolated: boolean,
  role: string,
): string {
  return `${alias}${isolated ? ISOLATED_SUFFIX : ""}#${role}`;
}

/** Why a leg was left out of a resolved chain. */
export interface RouteExclusion {
  readonly role: string;
  readonly provider: string;
  readonly reason: string;
}

/** A resolved chain, with the reasons any leg was excluded. */
export interface ResolvedChain {
  readonly alias: LlmAlias;
  readonly isolated: boolean;
  readonly routes: readonly ResolvedRoute[];
  readonly exclusions: readonly RouteExclusion[];
}

/**
 * Whether one route may serve, and if not, why.
 *
 * Extracted from the chain resolver rather than left inline so the admission
 * rules can be exercised directly. Inline, the only way to prove an exclusion
 * rule works was to point it at the live table and hope the table still
 * contained something excludable — which made the proof a statement about how
 * incomplete the routing policy happened to be that week, and turned finishing
 * the policy into a test failure. A rule worth enforcing has to be provable on
 * a route constructed to violate it.
 *
 * Order matters: shadow-only is checked before model-id confirmation because a
 * shadow leg is held back by policy regardless of whether its id is confirmed,
 * and reporting it as "unconfirmed" would misdescribe a deliberate choice as an
 * unfinished one.
 *
 * The admitting branch carries the confirmed model id rather than leaving the
 * caller to re-read it. The id is the very thing admission validated, so
 * handing it back is what lets the caller use it without a non-null assertion
 * re-stating a check that already happened.
 *
 * @param route The authored route.
 * @param provider The provider entry the route names.
 * @returns Admission with the confirmed model id, or the reason for exclusion.
 */
export function routeAdmission(
  route: LlmRoute,
  provider: LlmProvider,
): { admit: true; modelId: string } | { admit: false; reason: string } {
  if (route.shadow_only === true) {
    return {
      admit: false,
      reason: "shadow-only: configured and scored, never served to a caller",
    };
  }
  if (route.model_id_status !== "confirmed" || route.model_id === null) {
    return {
      admit: false,
      reason: `model id unconfirmed (${route.model_family}); it is transcribed from the provider console at onboarding, never guessed`,
    };
  }
  if (provider.account_status !== "live") {
    return {
      admit: false,
      reason: `provider account status is "${provider.account_status}"`,
    };
  }
  return { admit: true, modelId: route.model_id };
}

/**
 * Resolve an alias to the ordered chain of legs that can serve it today.
 *
 * Exclusions are returned rather than discarded so an exhausted chain can say
 * why each leg was unavailable. "No route available" without that detail sends
 * an operator to read config; with it, the answer is in the error.
 *
 * @param alias The alias to resolve.
 * @param options Resolution options.
 * @param options.isolated Route through the isolated variant (PD-9).
 * @param options.timeoutMsOverride Per-leg budget override, never wider than the caller's own deadline.
 * @returns The resolved chain.
 * @throws {UnknownAliasError} When the alias is not defined.
 */
export function resolveChain(
  alias: LlmAlias,
  options: { isolated?: boolean; timeoutMsOverride?: number } = {},
): ResolvedChain {
  const definition = aliasDefinition(alias);
  const isolated = options.isolated === true;

  if (isolated && !definition.isolation_capable) {
    throw new Error(
      `alias "${alias}" is not isolation-capable, so it has no isolated variant. ` +
        "PD-9 forbids serving isolated work from a shared route, so this fails rather than falling back.",
    );
  }

  const timeoutMs =
    options.timeoutMsOverride ??
    routeTable.defaults.request_timeout_ms[definition.latency_class];

  const resolved: ResolvedRoute[] = [];
  const exclusions: RouteExclusion[] = [];

  for (const route of orderedRoutes(definition)) {
    const provider = providerEntry(route.provider);
    const admission = routeAdmission(route, provider);

    if (!admission.admit) {
      exclusions.push({
        role: route.role,
        provider: route.provider,
        reason: admission.reason,
      });
      continue;
    }

    resolved.push({
      alias,
      isolated,
      role: route.role,
      providerName: route.provider,
      provider,
      modelId: admission.modelId,
      lumicModel: route.lumic_model ?? null,
      params: route.params ?? {},
      routeKey: routeKeyFor(alias, isolated, route.role),
      timeoutMs,
      retriesPerLeg: routeTable.defaults.retries_per_leg,
    });
  }

  return { alias, isolated, routes: resolved, exclusions };
}

/**
 * The permanent closed-incumbent leg of an alias (PD-11).
 *
 * Found by provider tier rather than by role, because an alias whose primary is
 * already a closed vendor has that primary as its revert target. Both shapes
 * therefore hold the same guarantee: there is always a configured route that
 * needs no new account and no code change to fall back to.
 *
 * @param chain A resolved chain.
 * @returns The closed leg, or undefined when none is currently servable.
 */
export function closedIncumbentLeg(chain: ResolvedChain): ResolvedRoute | undefined {
  return chain.routes.find((route) => route.provider.tier === "closed");
}

/**
 * The name the gateway knows a leg by.
 *
 * The head of a chain is addressed by the bare alias so a caller never learns a
 * leg name; every other leg carries the derived name the renderer gives it.
 * Keeping this derivation beside the resolver — rather than in the transport —
 * is what stops the client and the gateway config from disagreeing about a name.
 *
 * @param route The resolved leg.
 * @param chain The chain it belongs to.
 * @returns The gateway `model_name`.
 */
export function gatewayModelNameFor(
  route: ResolvedRoute,
  chain: ResolvedChain,
): string {
  const base = `${route.alias}${route.isolated ? ISOLATED_SUFFIX : ""}`;
  return chain.routes[0]?.routeKey === route.routeKey
    ? base
    : `${base}.fallback.${route.role}`;
}
