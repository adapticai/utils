/**
 * Every alias keeps a servable revert target, named in the vendor's current
 * generation, at the price the table declares.
 *
 * The `closed_incumbent` is the one leg the chain is never supposed to need, so
 * it is the one leg whose decay is invisible. Three distinct ways it rots, each
 * silent and each checked here.
 *
 * It can be left on a superseded model. A revert that lands on a model two
 * generations behind the one the challengers were compared against reverts to
 * less capability than the comparison priced, and nothing in the chain notices
 * because the leg is only reached when everything above it is already out.
 *
 * It can name a model the provider client cannot resolve. The direct transport
 * passes `lumic_model` to `@adaptic/lumic-utils`, whose registry THROWS on an
 * unregistered id rather than substituting a default. An unregistered incumbent
 * is therefore not a slower or dearer answer but no answer at all — the chain's
 * last leg fails on every call, exactly when it is the only leg left. The
 * registry is a different package on a different release train, so the id here
 * can only be as current as the one registered there, and a table that ran
 * ahead of it would be a table of guesses.
 *
 * And it can carry a parameter the model rejects. From Opus 4.7 / Sonnet 5
 * onward Anthropic removed `temperature`, `top_p` and `top_k` from its models:
 * the parameter's mere presence is an HTTP 400, not a value conflict. A leg that
 * declares support for a knob the model refuses turns the revert target into a
 * hard error for any caller who passes one.
 *
 * Checked against the vendor's generation rather than against whatever the file
 * currently says, so a table left behind by a release fails here instead of at
 * the first revert.
 */

import { describe, expect, it } from "vitest";

import { aliasDefinition, closedIncumbentLeg, listAliases, resolveChain } from "../../llm/route-table";
import type { LlmAlias, LlmRoute } from "../../llm/types";

/**
 * Anthropic model ids retired by a later generation.
 *
 * Listed as what must NOT appear rather than as what must, so adding the next
 * generation's id is not blocked by this test while leaving a stale one is
 * caught by it.
 */
const SUPERSEDED_ANTHROPIC_MODEL_IDS: ReadonlySet<string> = new Set([
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-fable-5",
]);

/**
 * Anthropic ids registered in `@adaptic/lumic-utils` SUPPORTED_MODELS, which is
 * what the direct transport resolves `lumic_model` against. Transcribed from
 * that registry, so an id this package invents fails here rather than at the
 * first live call.
 */
const REGISTERED_ANTHROPIC_MODEL_IDS: ReadonlySet<string> = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-4-5",
  ...SUPERSEDED_ANTHROPIC_MODEL_IDS,
]);

/**
 * The provider registry's own name for Anthropic, as the route table's provider
 * entry spells it. Matched on `lumic_provider` rather than on the table's
 * provider key, because it is the provider client's registry that constrains
 * which ids resolve, and that is the field naming it.
 */
const ANTHROPIC_LUMIC_PROVIDER = "anthropic";

/** Published USD per million tokens, read from the vendor's pricing table 2026-10-06. */
const PUBLISHED_USD_PER_MTOK: ReadonlyMap<string, { input: number; output: number }> = new Map([
  ["claude-fable-5-1", { input: 10, output: 50 }],
  ["claude-opus-5-5", { input: 4, output: 20 }],
  ["claude-sonnet-5-5", { input: 2, output: 10 }],
  ["claude-haiku-4-5", { input: 1, output: 5 }],
]);

/** The incumbent of each alias that declares one, resolved through the chain. */
function incumbents(): Array<{ alias: string; modelId: string }> {
  const out: Array<{ alias: string; modelId: string }> = [];
  for (const alias of listAliases()) {
    const leg = closedIncumbentLeg(resolveChain(alias));
    if (leg !== undefined) {
      out.push({ alias, modelId: leg.modelId });
    }
  }
  return out;
}

/**
 * The incumbent each alias AUTHORS, read from the table rather than the chain.
 *
 * Price is a property of the authored route and is not carried onto a resolved
 * leg, and an authored leg that the resolver drops is the very thing the
 * servability check is looking for — both need the table, not the chain.
 */
function authoredIncumbents(): Array<{ alias: LlmAlias; route: LlmRoute }> {
  const out: Array<{ alias: LlmAlias; route: LlmRoute }> = [];
  for (const alias of listAliases()) {
    for (const route of aliasDefinition(alias).routes) {
      if (route.role === "closed_incumbent") {
        out.push({ alias, route });
      }
    }
  }
  return out;
}

describe("the closed incumbent of every alias is a current, callable revert target", () => {
  it("names no Anthropic model that a later generation superseded", () => {
    const stale = incumbents()
      .filter((i) => SUPERSEDED_ANTHROPIC_MODEL_IDS.has(i.modelId))
      .map((i) => `${i.alias} -> ${i.modelId}`);

    // Named rather than counted: the useful output is WHICH alias is behind.
    expect(stale).toEqual([]);
  });

  it("names only ids the provider registry can resolve, on both model_id and lumic_model", () => {
    const unresolvable: string[] = [];
    for (const alias of listAliases()) {
      const leg = closedIncumbentLeg(resolveChain(alias));
      if (leg === undefined || leg.provider.lumic_provider !== ANTHROPIC_LUMIC_PROVIDER) continue;
      if (!REGISTERED_ANTHROPIC_MODEL_IDS.has(leg.modelId)) {
        unresolvable.push(`${alias} model_id ${leg.modelId}`);
      }
      if (leg.lumicModel === null || !REGISTERED_ANTHROPIC_MODEL_IDS.has(leg.lumicModel)) {
        unresolvable.push(`${alias} lumic_model ${String(leg.lumicModel)}`);
      }
    }

    expect(unresolvable).toEqual([]);
  });

  it("declares no temperature support on an Anthropic model that rejects the parameter", () => {
    const forwarding: string[] = [];
    for (const alias of listAliases()) {
      const leg = closedIncumbentLeg(resolveChain(alias));
      if (leg === undefined || leg.provider.lumic_provider !== ANTHROPIC_LUMIC_PROVIDER) continue;
      // Haiku 4.5 is the one current Anthropic model that still accepts the knob.
      if (leg.modelId === "claude-haiku-4-5") continue;
      if (leg.params.supports_temperature !== false) {
        forwarding.push(`${alias} -> ${leg.modelId}`);
      }
    }

    expect(forwarding).toEqual([]);
  });

  it("prices each incumbent at the vendor's published rate", () => {
    const mispriced: string[] = [];
    for (const { alias, route } of authoredIncumbents()) {
      const published = PUBLISHED_USD_PER_MTOK.get(route.model_id ?? "");
      if (published === undefined) continue;
      const declared = route.price_per_mtok;
      if (declared === undefined) {
        mispriced.push(`${alias} -> ${String(route.model_id)} declares no price`);
        continue;
      }
      if (declared.input !== published.input || declared.output !== published.output) {
        mispriced.push(
          `${alias} -> ${String(route.model_id)}: declared ${declared.input}/${declared.output}, ` +
            `published ${published.input}/${published.output}`,
        );
      }
    }

    expect(mispriced).toEqual([]);
  });

  it("keeps a servable incumbent on every alias that declares one", () => {
    // A leg excluded for an unconfirmed model id disappears from the chain
    // silently, which is how a table edit can delete a revert target without
    // deleting a line.
    const lost: string[] = [];
    for (const { alias } of authoredIncumbents()) {
      const chain = resolveChain(alias);
      if (closedIncumbentLeg(chain) !== undefined) continue;
      const why = chain.exclusions
        .filter((exclusion) => exclusion.role === "closed_incumbent")
        .map((exclusion) => exclusion.reason);
      lost.push(`${alias}: ${why.length > 0 ? why.join("; ") : "absent from the chain, with no reason given"}`);
    }

    expect(lost).toEqual([]);
  });
});
