import { describe, expect, it } from "vitest";

import {
  UnknownAliasError,
  aliasDefinition,
  closedIncumbentLeg,
  gatewayModelNameFor,
  listAliases,
  orderedRoutes,
  providerEntry,
  resolveChain,
  routeAdmission,
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

/**
 * A route that every admission rule admits.
 *
 * Taken from the shipped table rather than invented so the baseline is a shape
 * the resolver really sees, then spread-and-overridden per case. Each exclusion
 * case then differs from an admitted route in exactly one field, which is what
 * makes the case attribute the refusal to that field and nothing else.
 *
 * @returns A servable route definition.
 */
function servableRoute(): LlmRoute {
  const route = aliasDefinition(MULTI_LEG_ALIAS).routes.find(
    (candidate) => candidate.model_id_status === "confirmed" && candidate.shadow_only !== true,
  );
  if (route === undefined) {
    throw new Error("the shipped table has no servable route to build cases from");
  }
  return route;
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

  it("excludes every route whose model id is unconfirmed, and says so in exclusions", () => {
    // Quantified over every alias rather than pinned to one, and asserting the
    // RULE rather than a count. An earlier form required llm.reason to hold at
    // least one unconfirmed leg, which made the test a statement about how much
    // of W3 happened to be done that day: confirming those model ids from the
    // vendors' public catalogues broke it without changing any behaviour. A
    // test that goes red when the work it describes makes progress is measuring
    // the wrong thing.
    for (const alias of listAliases()) {
      const chain = resolveChain(alias);
      const unconfirmed = aliasDefinition(alias).routes.filter(
        (route) => route.model_id_status !== "confirmed",
      );

      for (const route of unconfirmed) {
        expect(
          chain.routes.some((resolved) => resolved.role === route.role),
          `${alias}#${route.role} has an unconfirmed model id but reached the serving chain`,
        ).toBe(false);
        const exclusion = chain.exclusions.find((entry) => entry.role === route.role);
        expect(exclusion, `no exclusion recorded for ${alias}#${route.role}`).toBeDefined();
        expect(exclusion?.reason).toContain("model id unconfirmed");
      }
    }
  });

  it("excludes a route for each reason the admission rules define", () => {
    // Proven on routes built to violate each rule, not on whatever the live
    // table happens to still get wrong. The earlier form counted exclusions in
    // the shipped table and required the total to exceed zero, which meant the
    // test passed only while the routing policy was unfinished and went red the
    // moment every leg became confirmed and servable — punishing exactly the
    // work it was written to support. The same reasoning the unconfirmed-id
    // rule above already records, applied one level up.
    const liveProvider = providerEntry(aliasDefinition(MULTI_LEG_ALIAS).routes[0].provider);

    const shadow = routeAdmission({ ...servableRoute(), shadow_only: true }, liveProvider);
    expect(shadow.admit).toBe(false);
    expect(shadow.admit ? "" : shadow.reason).toContain("shadow-only");

    const unconfirmed = routeAdmission(
      { ...servableRoute(), model_id_status: "pending-provider-confirmation" },
      liveProvider,
    );
    expect(unconfirmed.admit).toBe(false);
    expect(unconfirmed.admit ? "" : unconfirmed.reason).toContain("model id unconfirmed");

    const nullId = routeAdmission({ ...servableRoute(), model_id: null }, liveProvider);
    expect(nullId.admit).toBe(false);
    expect(nullId.admit ? "" : nullId.reason).toContain("model id unconfirmed");

    const dormant = routeAdmission(servableRoute(), {
      ...liveProvider,
      account_status: "pending-onboarding",
    });
    expect(dormant.admit).toBe(false);
    expect(dormant.admit ? "" : dormant.reason).toContain("account status");

    // The positive control. Without it every assertion above would still pass
    // against an implementation that refused everything.
    const admitted = routeAdmission(servableRoute(), liveProvider);
    expect(admitted.admit).toBe(true);
    expect(admitted.admit ? admitted.modelId : null).toBe(servableRoute().model_id);
  });

  it("records a reason for every exclusion the live table produces", () => {
    for (const alias of listAliases()) {
      for (const exclusion of resolveChain(alias).exclusions) {
        expect(
          exclusion.reason.length,
          `${alias}#${exclusion.role} excluded with no reason`,
        ).toBeGreaterThan(0);
      }
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

    // The shipped table carries no shadow-only leg today: the three role slots
    // an alias has are spent on a primary, an open-weight fallback and the
    // closed revert target, and a serving chain that can actually fail over is
    // worth more than an evaluation slot. The rule above is therefore
    // quantified over a set that may be empty, and the constructed-route test
    // above is what proves the machinery still works.
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

  it("finds a closed-tier revert target for every unpinned alias (PD-11)", () => {
    // PD-11 keeps a configured way back on every alias that can fail over. A
    // PINNED alias is the deliberate exception, and the exception is required
    // rather than tolerated: PD-6 forbids the judge a fallback leg outright,
    // because a judge that failed over would grade one model's output against
    // another model's standard and silently invalidate every gate it had
    // decided. Its way back is a reviewed re-pin — moving PINNED_JUDGE and the
    // table together and re-baselining the sets — which is a stronger control
    // than an automatic revert, not a weaker one. Asserting PD-11 over pinned
    // aliases too would force the judge to carry the very leg PD-6 bans, so
    // the two directives are asserted separately below rather than one of them
    // being quietly dropped.
    const pinned: string[] = [];

    for (const alias of listAliases()) {
      if (aliasDefinition(alias).pinned === true) {
        pinned.push(alias);
        continue;
      }
      const leg = closedIncumbentLeg(resolveChain(alias));
      expect(leg, `alias ${alias} has no servable closed incumbent`).toBeDefined();
      expect(leg?.provider.tier).toBe("closed");
    }

    // The exemption must not be able to swallow the rule. If every alias were
    // pinned the loop above would assert nothing at all.
    expect(
      pinned.length,
      "every alias is pinned, so PD-11 was never actually checked",
    ).toBeLessThan(listAliases().length);
  });

  it("gives a pinned alias exactly one leg and no fallback (PD-6)", () => {
    const pinned = listAliases().filter((alias) => aliasDefinition(alias).pinned === true);
    expect(pinned.length, "no alias is pinned, so PD-6 proved nothing").toBeGreaterThan(0);

    for (const alias of pinned) {
      const chain = resolveChain(alias);
      expect(
        chain.routes.length,
        `pinned alias ${alias} has ${chain.routes.length} servable legs; PD-6 allows exactly one`,
      ).toBe(1);
    }
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
