import { describe, it, expect } from "vitest";

import rawTable from "../../../llm/alias-routes.json";

/**
 * `model_family` is the human-facing name for a leg: it appears in operator
 * errors (`routeAdmission` reports "model id unconfirmed (<family>)"), in logs,
 * and in dashboards. For an OPEN-TIER leg it is the model's own name with
 * hyphens relaxed to spaces — so when it differs from the model id by case
 * alone, one of the two is simply wrong, and the wrong one is the copyable
 * string an operator sees.
 *
 * This matters more than cosmetics because provider model ids are
 * case-significant: `openai/gpt-oss-20B` is not a model DeepInfra serves. A
 * family name that disagrees with its own id teaches the wrong spelling to
 * whoever reads it next, and this table has already shipped two of them
 * (`gpt-oss-20B`, `Ling 3.0 Flash Fin`).
 *
 * Closed incumbents are deliberately exempt: their families are CLASS
 * descriptors ("Opus-class", "Haiku-class") that intentionally do not track a
 * single model id, so the comparison below never fires for them.
 */
interface RouteLeg {
  readonly role: string;
  readonly provider: string;
  readonly model_id: string | null;
  readonly model_family: string;
}

const table = rawTable as unknown as {
  aliases: Record<string, { routes: readonly RouteLeg[] }>;
};

function openLegs(): Array<{ alias: string; leg: RouteLeg }> {
  const out: Array<{ alias: string; leg: RouteLeg }> = [];
  for (const [alias, def] of Object.entries(table.aliases)) {
    for (const leg of def.routes) {
      if (leg.provider === "deepinfra" && typeof leg.model_id === "string") {
        out.push({ alias, leg });
      }
    }
  }
  return out;
}

describe("alias route table — model_family identity", () => {
  it("covers every open-tier leg, so the assertions below cannot pass vacuously", () => {
    expect(openLegs().length).toBeGreaterThan(0);
  });

  it("never disagrees with its own model id by case alone", () => {
    const mismatches = openLegs()
      .filter(({ leg }) => {
        const tail = leg.model_id!.split("/").pop() ?? "";
        const family = leg.model_family.replace(/ /g, "-");
        // Only legs whose family IS the model name are compared; a family that
        // is a genuinely different descriptive string is out of scope here.
        return tail.toLowerCase() === family.toLowerCase() && tail !== family;
      })
      .map(({ alias, leg }) => `${alias}/${leg.role}: id "${leg.model_id}" vs family "${leg.model_family}"`);

    expect(mismatches).toEqual([]);
  });

  it("keeps model_id and lumic_model byte-identical where both are present", () => {
    const drift = openLegs()
      .filter(({ leg }) => {
        const lumic = (leg as unknown as { lumic_model?: string }).lumic_model;
        return typeof lumic === "string" && lumic !== leg.model_id;
      })
      .map(({ alias, leg }) => `${alias}/${leg.role}`);

    expect(drift).toEqual([]);
  });
});
