/**
 * One model id has one price.
 *
 * `price_per_mtok` is declared PER LEG, but a price is a property of the MODEL,
 * not of the alias that reaches it. Nothing in the schema stops the same model id
 * carrying two different anchors on two legs, and when it does, every consumer
 * that indexes price by model id resolves the contradiction by iteration order —
 * silently, and differently depending on which alias the table happens to list
 * last.
 *
 * It was live. `claude-opus-4-7` carried the Opus-tier rate (5/25) on
 * `llm.reason` and the `claude-fable-5` rate (10/50) on `llm.agentic` — a 2x
 * spread on the model that is the `closed_incumbent` revert target of both
 * aliases. The declared cost of reverting therefore depended on which alias a
 * reader looked at, in a comparison whose whole purpose includes pricing that
 * revert.
 *
 * This is the guard that makes the class of defect unrepeatable rather than
 * fixed once. It asserts coherence across the whole table, so a future leg that
 * re-prices an existing model fails here instead of in a cost column nobody
 * cross-checks.
 */

import { describe, expect, it } from "vitest";
import routeTable from "../../llm/alias-routes.json";

/** Every leg in the table, flattened with the alias it belongs to. */
function legs(): Array<{
  alias: string;
  modelId: string;
  input: number;
  output: number;
}> {
  const out: Array<{ alias: string; modelId: string; input: number; output: number }> = [];
  const aliases = (routeTable as { aliases?: Record<string, unknown> }).aliases ?? {};
  for (const [alias, cfg] of Object.entries(aliases)) {
    const routes = (cfg as { routes?: unknown[] }).routes ?? [];
    for (const route of routes) {
      const r = route as {
        model_id?: unknown;
        price_per_mtok?: { input?: unknown; output?: unknown };
      };
      const price = r.price_per_mtok;
      if (typeof r.model_id !== "string" || price === undefined) continue;
      if (typeof price.input !== "number" || typeof price.output !== "number") continue;
      out.push({ alias, modelId: r.model_id, input: price.input, output: price.output });
    }
  }
  return out;
}

describe("alias-routes.json prices each model id coherently", () => {
  it("declares at most one price per model id across every alias", () => {
    const byModel = new Map<string, Map<string, string[]>>();
    for (const leg of legs()) {
      const key = `${leg.input}/${leg.output}`;
      const seen = byModel.get(leg.modelId) ?? new Map<string, string[]>();
      seen.set(key, [...(seen.get(key) ?? []), leg.alias]);
      byModel.set(leg.modelId, seen);
    }

    const contradictions = [...byModel.entries()]
      .filter(([, prices]) => prices.size > 1)
      .map(
        ([modelId, prices]) =>
          `${modelId}: ${[...prices.entries()]
            .map(([price, aliases]) => `${price} on ${aliases.join("+")}`)
            .join(" vs ")}`,
      );

    // Named in the failure message rather than counted, because the useful
    // output here is WHICH model and WHICH aliases disagree.
    expect(contradictions).toEqual([]);
  });

  it("finds a price for the closed_incumbent of every alias that declares one", () => {
    // The revert target is the leg whose cost matters most and the one most
    // easily left unpriced, since it is the leg nobody expects to serve.
    const priced = new Set(legs().map((l) => l.modelId));
    const aliases = (routeTable as { aliases?: Record<string, unknown> }).aliases ?? {};
    const unpricedIncumbents: string[] = [];

    for (const [alias, cfg] of Object.entries(aliases)) {
      const routes = ((cfg as { routes?: unknown[] }).routes ?? []) as Array<{
        role?: unknown;
        model_id?: unknown;
      }>;
      for (const route of routes) {
        if (route.role !== "closed_incumbent") continue;
        if (typeof route.model_id === "string" && !priced.has(route.model_id)) {
          unpricedIncumbents.push(`${alias} -> ${route.model_id}`);
        }
      }
    }

    expect(unpricedIncumbents).toEqual([]);
  });
});
