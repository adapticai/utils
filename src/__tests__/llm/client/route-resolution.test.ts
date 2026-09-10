import { describe, expect, it } from "vitest";

import {
  UnknownAliasError,
  aliasDefinition,
  closedIncumbentLeg,
  gatewayModelNameFor,
  listAliases,
  orderedRoutes,
  resolveChain,
  routeKeyFor,
  routeTable,
} from "../../../llm/route-table";
import type { LlmAliasDefinition, LlmRoute, LlmRouteRole } from "../../../llm/types";
import { asAlias } from "./support/routes";

/** Chain order the resolver must impose regardless of how the file is authored. */
const ROLE_ORDER: readonly LlmRouteRole[] = ["primary", "secondary", "closed_incumbent"];

/** An alias whose chain has more than one servable leg today. */
const MULTI_LEG_ALIAS = "llm.extract" as const;

/** An alias whose closed incumbent is its own primary (PD-11's other shape). */
const CLOSED_PRIMARY_ALIAS = "llm.agentic" as const;

/** An alias the route table deliberately marks not isolation-capable. */
const SHARED_ONLY_ALIAS = "llm.fast" as const;

/**
 * Build a route definition whose authoring order is the reverse of chain order.
 *
 * Every alias in the shipped table happens to be authored in role order, so a
 * resolver that simply preserved file order would pass against it. Reversing
 * the authoring order is what makes the ordering assertion able to fail.
 *
 * @returns A definition whose routes are authored closed-incumbent first.
 */
function reverseAuthoredDefinition(): LlmAliasDefinition {
  const source = aliasDefinition(MULTI_LEG_ALIAS);
  const byRole = new Map<LlmRouteRole, LlmRoute>(
    source.routes.map((route) => [route.role, route]),
  );
  const routes = [...ROLE_ORDER]
    .reverse()
    .map((role) => byRole.get(role))
    .filter((route): route is LlmRoute => route !== undefined);
  return { ...source, routes };
}

describe("alias route resolution", () => {
  it("resolves every alias in the table to a non-empty chain ordered by role", () => {
    const aliases = listAliases();
    expect(aliases.length).toBeGreaterThan(0);

    for (const alias of aliases) {
      const chain = resolveChain(alias);
      expect(chain.routes.length, `alias ${alias} has no servable leg`).toBeGreaterThan(0);

      const positions = chain.routes.map((route) => ROLE_ORDER.indexOf(route.role));
      expect(positions, `alias ${alias} resolved out of role order`).toEqual(
        [...positions].sort((a, b) => a - b),
      );
      expect(positions.every((position) => position >= 0)).toBe(true);
    }
  });

  it("orders by ROLE rather than by authoring order in the file", () => {
    const authored = reverseAuthoredDefinition();
    expect(authored.routes.map((route) => route.role)).toEqual([
      "closed_incumbent",
      "secondary",
      "primary",
    ]);

    expect(orderedRoutes(authored).map((route) => route.role)).toEqual([
      "primary",
      "secondary",
      "closed_incumbent",
    ]);
  });

  it("throws UnknownAliasError naming the known aliases rather than defaulting", () => {
    const attempt = (): unknown => resolveChain(asAlias("llm.reasonn"));

    expect(attempt).toThrow(UnknownAliasError);
    try {
      attempt();
      expect.unreachable("an unknown alias must not resolve");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownAliasError);
      const failure = error as UnknownAliasError;
      expect(failure.alias).toBe("llm.reasonn");
      for (const known of listAliases()) {
        expect(failure.message).toContain(known);
      }
    }
  });

  it("excludes a route whose model id is unconfirmed, and says so in exclusions", () => {
    const chain = resolveChain("llm.reason");
    const unconfirmed = aliasDefinition("llm.reason").routes.filter(
      (route) => route.model_id_status !== "confirmed",
    );
    expect(unconfirmed.length).toBeGreaterThan(0);

    for (const route of unconfirmed) {
      expect(chain.routes.some((resolved) => resolved.role === route.role)).toBe(false);
      const exclusion = chain.exclusions.find((entry) => entry.role === route.role);
      expect(exclusion, `no exclusion recorded for ${route.role}`).toBeDefined();
      expect(exclusion?.reason).toContain("model id unconfirmed");
    }
  });

  it("never serves a shadow-only route, and records why it was held back", () => {
    for (const alias of listAliases()) {
      const chain = resolveChain(alias);
      const shadowRoles = aliasDefinition(alias)
        .routes.filter((route) => route.shadow_only === true)
        .map((route) => route.role);

      for (const role of shadowRoles) {
        expect(
          chain.routes.some((route) => route.role === role),
          `${alias}#${role} is shadow-only but reached the serving chain`,
        ).toBe(false);
        const exclusion = chain.exclusions.find((entry) => entry.role === role);
        expect(exclusion?.reason).toContain("shadow-only");
      }
    }

    // The guard is only meaningful if the table actually carries such a route.
    expect(
      aliasDefinition(CLOSED_PRIMARY_ALIAS).routes.some((route) => route.shadow_only === true),
    ).toBe(true);
  });

  it("refuses isolation on an alias that has no isolated variant (PD-9)", () => {
    expect(aliasDefinition(SHARED_ONLY_ALIAS).isolation_capable).toBe(false);
    expect(() => resolveChain(SHARED_ONLY_ALIAS, { isolated: true })).toThrow(
      /not isolation-capable/,
    );
  });

  it("keys an isolated chain separately from the shared one", () => {
    expect(aliasDefinition(MULTI_LEG_ALIAS).isolation_capable).toBe(true);
    const shared = resolveChain(MULTI_LEG_ALIAS);
    const isolated = resolveChain(MULTI_LEG_ALIAS, { isolated: true });

    expect(isolated.routes.map((route) => route.routeKey)).not.toEqual(
      shared.routes.map((route) => route.routeKey),
    );
    expect(isolated.routes[0].routeKey).toBe(
      routeKeyFor(MULTI_LEG_ALIAS, true, "primary"),
    );
  });

  it("finds a closed-tier revert target for every alias (PD-11)", () => {
    for (const alias of listAliases()) {
      const leg = closedIncumbentLeg(resolveChain(alias));
      expect(leg, `alias ${alias} has no servable closed incumbent`).toBeDefined();
      expect(leg?.provider.tier).toBe("closed");
    }

    const agenticLeg = closedIncumbentLeg(resolveChain(CLOSED_PRIMARY_ALIAS));
    expect(agenticLeg?.role).toBe("primary");
  });

  it("names the chain head by the bare alias and every other leg by its role", () => {
    const chain = resolveChain(MULTI_LEG_ALIAS);
    expect(chain.routes.length).toBeGreaterThan(1);

    const [head, ...rest] = chain.routes;
    expect(gatewayModelNameFor(head, chain)).toBe(MULTI_LEG_ALIAS);
    for (const leg of rest) {
      expect(gatewayModelNameFor(leg, chain)).toBe(
        `${MULTI_LEG_ALIAS}.fallback.${leg.role}`,
      );
    }

    const isolated = resolveChain(MULTI_LEG_ALIAS, { isolated: true });
    expect(gatewayModelNameFor(isolated.routes[0], isolated)).toBe(
      `${MULTI_LEG_ALIAS}.isolated`,
    );
  });

  it("exposes per-leg budgets taken from the alias's latency class", () => {
    for (const alias of listAliases()) {
      const chain = resolveChain(alias);
      const expected =
        routeTable.defaults.request_timeout_ms[aliasDefinition(alias).latency_class];
      for (const route of chain.routes) {
        expect(route.timeoutMs).toBe(expected);
      }
    }
  });
});
