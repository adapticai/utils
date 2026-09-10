/**
 * Route fixtures for the alias-client test suite.
 *
 * The canonical route table is the product's routing policy, not a test
 * fixture: most of its open-weight legs are deliberately unconfirmed today, and
 * no leg declares a missing capability. Exercising a three-leg walk, or a
 * provider that rejects a sampling parameter, therefore needs routes built
 * here. They are built from the same public `ResolvedRoute` shape the resolver
 * emits, so a change to that shape breaks these fixtures rather than letting
 * them drift into describing a chain the client can no longer produce.
 *
 * @module __tests__/llm/client/support/routes
 */

import { routeKeyFor } from "../../../../llm/route-table";
import type {
  LlmAlias,
  LlmProvider,
  LlmRouteParams,
  LlmRouteRole,
  ResolvedRoute,
} from "../../../../llm/types";

/** Per-leg budget used wherever a test needs a timeout it can drive by hand. */
export const TEST_LEG_TIMEOUT_MS = 1_000;

/** Retry budget carried on fixture routes; the chain itself does the retrying. */
export const TEST_RETRIES_PER_LEG = 1;

/** An open-weight host: an OpenAI-compatible wire format the degraded path must refuse. */
export const OPEN_PROVIDER: LlmProvider = {
  display_name: "Test Open Host",
  tier: "open",
  api_style: "openai-compatible",
  base_url: "https://open.invalid/v1",
  base_url_env: null,
  api_key_env: "TEST_OPEN_API_KEY",
  secret_path: "test/open",
  account_status: "live",
  docs_url: "https://open.invalid/docs",
};

/** A retained closed vendor speaking the Anthropic wire format (PD-11). */
export const CLOSED_PROVIDER: LlmProvider = {
  display_name: "Test Closed Vendor",
  tier: "closed",
  api_style: "anthropic",
  base_url: "https://closed.invalid",
  base_url_env: null,
  api_key_env: "TEST_CLOSED_API_KEY",
  secret_path: "test/closed",
  account_status: "live",
  lumic_provider: "test-closed",
  docs_url: "https://closed.invalid/docs",
};

/** An aggregator backstop, used where a third tier value has to be distinguishable. */
export const AGGREGATOR_PROVIDER: LlmProvider = {
  display_name: "Test Aggregator",
  tier: "aggregator",
  api_style: "openai-compatible",
  base_url: "https://aggregator.invalid/v1",
  base_url_env: null,
  api_key_env: "TEST_AGGREGATOR_API_KEY",
  secret_path: "test/aggregator",
  account_status: "live",
  docs_url: "https://aggregator.invalid/docs",
};

/** Fields a fixture route may override; everything else takes a serving default. */
export interface RouteOverrides {
  readonly alias?: LlmAlias;
  readonly isolated?: boolean;
  readonly role?: LlmRouteRole;
  readonly provider?: LlmProvider;
  readonly providerName?: string;
  readonly modelId?: string;
  readonly lumicModel?: string | null;
  readonly params?: LlmRouteParams;
  readonly timeoutMs?: number;
}

/**
 * Build one resolved leg.
 *
 * The route key is derived through the production `routeKeyFor` rather than
 * spelled out, so a fixture and the breaker registry can never disagree about
 * which leg a key names.
 *
 * @param overrides Fields to set; the rest take serving defaults.
 * @returns A resolved leg ready to hand to the chain executor.
 */
export function makeRoute(overrides: RouteOverrides = {}): ResolvedRoute {
  const alias = overrides.alias ?? "llm.extract";
  const isolated = overrides.isolated ?? false;
  const role = overrides.role ?? "primary";
  const provider = overrides.provider ?? OPEN_PROVIDER;
  return {
    alias,
    isolated,
    role,
    providerName: overrides.providerName ?? provider.display_name,
    provider,
    modelId: overrides.modelId ?? `model-${role}`,
    lumicModel: overrides.lumicModel === undefined ? "test-closed-model" : overrides.lumicModel,
    params: overrides.params ?? {},
    routeKey: routeKeyFor(alias, isolated, role),
    timeoutMs: overrides.timeoutMs ?? TEST_LEG_TIMEOUT_MS,
    retriesPerLeg: TEST_RETRIES_PER_LEG,
  };
}

/**
 * Build a full primary -> secondary -> closed-incumbent chain.
 *
 * @param alias The alias the legs belong to.
 * @returns The three legs in chain order.
 */
export function makeThreeLegChain(alias: LlmAlias = "llm.extract"): ResolvedRoute[] {
  return [
    makeRoute({ alias, role: "primary", provider: OPEN_PROVIDER, providerName: "open-primary" }),
    makeRoute({
      alias,
      role: "secondary",
      provider: AGGREGATOR_PROVIDER,
      providerName: "aggregator-secondary",
    }),
    makeRoute({
      alias,
      role: "closed_incumbent",
      provider: CLOSED_PROVIDER,
      providerName: "closed-incumbent",
    }),
  ];
}

/**
 * Name an alias the type union deliberately forbids.
 *
 * `LlmAlias` is a closed union precisely so a mistyped alias cannot compile,
 * which leaves the resolver's runtime guard unreachable from well-typed code.
 * Reaching it requires one deliberate widening; it is confined here so the
 * assertion appears once rather than at each call site that tests the guard.
 *
 * @param name The alias name to pass through.
 * @returns The same name, typed as an alias.
 */
export function asAlias(name: string): LlmAlias {
  return name as LlmAlias;
}
