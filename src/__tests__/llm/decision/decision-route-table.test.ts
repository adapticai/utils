/**
 * The decision-route table and its loader.
 *
 * The table is where a typed decision route is opened or kept shut, so the
 * tests pin the properties that decide that. The canonical hosted route is
 * refused today and says why; the local route is declared and never served
 * from here; a table that breaks a bound does not load; and a route that does
 * resolve carries exactly what the table declares, with the environment's base
 * URL winning over the declared one.
 *
 * The test named "the canonical hosted route is not admitted today" is the
 * package's off-contract. It goes red when the canonical table's onboarding
 * fields are changed, which makes opening the hosted route a deliberate act
 * that edits this file too.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DECISION_BUDGET_CEILING_MS,
  DECISION_BUDGET_FLOOR_MS,
  decisionRouteAdmission,
  decisionRouteDeclaration,
  decisionRouteTable,
  decisionRouteViolations,
  listDecisionRoutes,
  resolveDecisionRoute,
} from "../../../llm/decision/decision-route-table";
import decisionRoutesSchema from "../../../llm/decision/decision-routes.schema.json";
import { DecisionCallError, DecisionRouteUnavailableError } from "../../../llm/decision/errors";
import type { DecisionRouteTable, ResolvedDecisionRoute } from "../../../llm/decision/route-types";
import { DECISION_ROUTES } from "../../../llm/decision/types";
import type { DecisionRoute } from "../../../llm/decision/types";
import { routeTable } from "../../../llm/route-table";
import { validateAgainstSchema } from "../support/json-schema-subset";

import {
  HOSTED_ROUTE,
  LOCAL_ROUTE,
  TEST_CONTRACT_VERIFIED,
  admittedDecisionRouteTable,
  editableDecisionRouteTable,
  hostedProviderOf,
  hostedRouteOf,
  localRouteOf,
} from "./support/routes";
import type { DeepMutable } from "./support/routes";

/** An environment in which no variable is set. */
const EMPTY_ENV: Readonly<Record<string, string | undefined>> = {};

/** A base URL an operator might point the hosted route at instead of the vendor's. */
const OVERRIDE_BASE_URL = "https://decision-proxy.internal.example";

/** A budget below the generative table's one-second floor, which a typed route must be able to declare. */
const SUB_SECOND_BUDGET_MS = 300;

/** A SHA-256 digest of the right form that no artifact was ever measured to have. */
const INVENTED_DIGEST = "a".repeat(64);

/**
 * Resolve a route and return the refusal it is expected to end in.
 *
 * @param route The route.
 * @param table The table to resolve against.
 * @param env The environment to resolve in.
 * @returns The refusal.
 * @throws When the route resolves, or fails with anything but a refusal.
 */
function refusalOf(
  route: DecisionRoute,
  table: DecisionRouteTable,
  env: Readonly<Record<string, string | undefined>> = EMPTY_ENV,
): DecisionRouteUnavailableError {
  try {
    resolveDecisionRoute(route, table, env);
  } catch (error) {
    if (error instanceof DecisionRouteUnavailableError) {
      return error;
    }
    throw error;
  }
  throw new Error(`${route} resolved, and a refusal was expected`);
}

/**
 * The violations of a table that differs from the admitted one in one edit.
 *
 * @param edit The edit.
 * @returns The violations the loader reports for the edited table.
 */
function violationsAfter(edit: (table: DeepMutable<DecisionRouteTable>) => void): string[] {
  const table = admittedDecisionRouteTable();
  edit(table);
  return decisionRouteViolations(table);
}

/**
 * Every model id the generative alias table sends a request to.
 *
 * @returns The ids, from legs and from their same-model equivalents.
 */
function aliasTableModelIds(): Set<string> {
  const ids = new Set<string>();
  for (const alias of Object.values(routeTable.aliases)) {
    for (const route of alias.routes) {
      for (const leg of [route, ...(route.equivalents ?? [])]) {
        if (leg.model_id !== null) {
          ids.add(leg.model_id);
        }
      }
    }
  }
  return ids;
}

describe("the canonical decision-route table", () => {
  it("declares exactly dm.hosted and dm.local", () => {
    expect(listDecisionRoutes()).toEqual(["dm.hosted", "dm.local"]);
    expect(Object.keys(decisionRouteTable.routes).sort()).toEqual([...DECISION_ROUTES].sort());

    const withBaseline = violationsAfter((table) => {
      table.routes["dm.baseline"] = structuredClone(localRouteOf(table));
    });
    expect(withBaseline).toHaveLength(1);
    expect(withBaseline[0]).toContain("routes.dm.baseline is not a decision route");

    const withoutLocal = violationsAfter((table) => {
      delete table.routes[LOCAL_ROUTE];
    });
    expect(withoutLocal).toEqual([expect.stringContaining("routes.dm.local is missing")]);
  });

  it("loads with no violation, and the admitted test table has none either", () => {
    expect(decisionRouteViolations(decisionRouteTable)).toEqual([]);
    expect(decisionRouteViolations(admittedDecisionRouteTable())).toEqual([]);
  });

  it("is frozen at every depth, so a route cannot be opened at runtime", () => {
    const table = decisionRouteTable as DeepMutable<DecisionRouteTable>;
    expect(() => {
      hostedProviderOf(table).account_status = "live";
    }).toThrow(TypeError);
    expect(() => {
      hostedRouteOf(table).contract_evidence = "authenticated-call";
    }).toThrow(TypeError);
    expect(() => {
      table.routes["dm.baseline"] = structuredClone(localRouteOf(table));
    }).toThrow(TypeError);
    expect(() => {
      hostedRouteOf(table).caps.max_options = 1;
    }).toThrow(TypeError);
    expect(hostedProviderOf(decisionRouteTable).account_status).toBe("pending-onboarding");
  });

  it("the canonical hosted route is not admitted today, and says why", () => {
    const refusal = refusalOf(HOSTED_ROUTE, decisionRouteTable);
    expect(refusal.fault).toBe("unavailable");
    expect(refusal.code).toBe("route_not_admitted");
    expect(refusal.reason).toContain("pending-onboarding");
    expect(refusal.route).toBe(HOSTED_ROUTE);

    // The same refusal through the default arguments a production caller uses.
    expect(() => resolveDecisionRoute(HOSTED_ROUTE)).toThrow(DecisionRouteUnavailableError);

    const hosted = hostedRouteOf(decisionRouteTable);
    expect(hostedProviderOf(decisionRouteTable).account_status).toBe("pending-onboarding");
    expect(hosted.contract_evidence).toBe("documentation");
    expect(hosted.contract_verified).toBeNull();
  });

  it("dm.local is declared and never served by this package", () => {
    const local = decisionRouteDeclaration(LOCAL_ROUTE);
    expect(local.served_by).toBe("engine");

    for (const table of [decisionRouteTable, admittedDecisionRouteTable()]) {
      const refusal = refusalOf(LOCAL_ROUTE, table);
      expect(refusal.fault).toBe("unavailable");
      expect(refusal.code).toBe("engine_served");
    }

    // Opening the consumer's own provider account does not make this package serve the route.
    const live = admittedDecisionRouteTable();
    live.providers[localRouteOf(live).provider].account_status = "live";
    expect(refusalOf(LOCAL_ROUTE, live).code).toBe("engine_served");
  });

  it("the local route declares no artifact digests and says so", () => {
    const local = localRouteOf(decisionRouteTable);
    expect(local.artifact_sha256).toBeNull();
    expect(local.pin_status).toBe("pending-artifact-digests");
    expect(local.revision).toMatch(/^[0-9a-f]{40}$/);

    // A digest map and a status that says none is recorded contradict each other.
    const invented = violationsAfter((table) => {
      localRouteOf(table).artifact_sha256 = { "model.safetensors": INVENTED_DIGEST };
    });
    expect(invented).toEqual([expect.stringContaining("artifact_sha256 must be null while pin_status is")]);

    // A status that claims a pin needs digests to exist and to be digests.
    const pinnedWithout = violationsAfter((table) => {
      localRouteOf(table).pin_status = "pinned";
    });
    expect(pinnedWithout).toEqual([expect.stringContaining("artifact_sha256 must map at least one artifact")]);
    const pinnedMalformed = violationsAfter((table) => {
      const local = localRouteOf(table);
      local.pin_status = "pinned";
      local.artifact_sha256 = { "model.safetensors": "not-a-digest" };
    });
    expect(pinnedMalformed).toEqual([expect.stringContaining("artifact_sha256 must map at least one artifact")]);
    const pinned = violationsAfter((table) => {
      const local = localRouteOf(table);
      local.pin_status = "pinned";
      local.artifact_sha256 = { "model.safetensors": INVENTED_DIGEST };
    });
    expect(pinned).toEqual([]);
  });

  it("one model id, one price, and no id shared with the alias table", () => {
    const hosted = hostedRouteOf(decisionRouteTable);
    const priced = new Map<string, Set<string>>();
    for (const route of Object.values(decisionRouteTable.routes)) {
      if (route.served_by !== "utils" || route.price_per_mtok === null) {
        continue;
      }
      const price = `${route.price_per_mtok.input}/${route.price_per_mtok.output}`;
      priced.set(route.version_pin, (priced.get(route.version_pin) ?? new Set<string>()).add(price));
    }
    expect([...priced.keys()]).toEqual([hosted.version_pin]);
    for (const prices of priced.values()) {
      expect(prices.size).toBe(1);
    }

    const generative = aliasTableModelIds();
    expect(generative.size).toBeGreaterThan(0);
    expect(generative.has(hosted.version_pin)).toBe(false);
    expect(generative.has(hosted.expected_served_model)).toBe(false);
    expect(generative.has(localRouteOf(decisionRouteTable).checkpoint)).toBe(false);
    for (const provider of Object.keys(decisionRouteTable.providers)) {
      expect(Object.keys(routeTable.providers)).not.toContain(provider);
    }
  });

  it("names every free parameter in the notes of the route that carries it", () => {
    const hostedNotes = hostedRouteOf(decisionRouteTable).notes ?? "";
    for (const parameter of ["budget_ms 1500", "max_state_tokens 32000", "defaults.circuit_breaker"]) {
      expect(hostedNotes).toContain(parameter);
    }
    expect(hostedNotes).toContain("free parameters");
    const localNotes = localRouteOf(decisionRouteTable).notes ?? "";
    expect(localNotes).toContain("budget_ms 1000 is a free parameter");
  });
});

describe("load-time violations", () => {
  afterEach(() => {
    vi.doUnmock("../../../llm/decision/decision-routes.json");
    vi.resetModules();
  });

  it("a hosted pin is a versioned id, never an alias", () => {
    for (const movingName of ["jev-latest", "jev-preview", "JEV-LATEST"]) {
      const pinned = violationsAfter((table) => {
        hostedRouteOf(table).version_pin = movingName;
      });
      expect(pinned).toEqual([expect.stringContaining("routes.dm.hosted.version_pin must be a versioned model id")]);

      const expected = violationsAfter((table) => {
        hostedRouteOf(table).expected_served_model = movingName;
      });
      expect(expected).toEqual([
        expect.stringContaining("routes.dm.hosted.expected_served_model must be a versioned model id"),
      ]);
    }
    expect(
      violationsAfter((table) => {
        hostedRouteOf(table).version_pin = "";
      }),
    ).toEqual([expect.stringContaining("version_pin must be a non-empty model id")]);
  });

  it("a budget below 50 ms or above 10,000 ms is a load-time violation, and a sub-second budget is admitted", () => {
    expect(DECISION_BUDGET_FLOOR_MS).toBe(50);
    expect(DECISION_BUDGET_CEILING_MS).toBe(10_000);

    for (const route of [HOSTED_ROUTE, LOCAL_ROUTE]) {
      for (const budget of [DECISION_BUDGET_FLOOR_MS - 1, DECISION_BUDGET_CEILING_MS + 1, 0, -1, 300.5]) {
        const violations = violationsAfter((table) => {
          table.routes[route].budget_ms = budget;
        });
        expect(violations).toEqual([`routes.${route}.budget_ms must be an integer in [50, 10000]`]);
      }
      for (const budget of [DECISION_BUDGET_FLOOR_MS, SUB_SECOND_BUDGET_MS, DECISION_BUDGET_CEILING_MS]) {
        const table = admittedDecisionRouteTable();
        table.routes[route].budget_ms = budget;
        expect(decisionRouteViolations(table)).toEqual([]);
        expect(validateAgainstSchema(table, decisionRoutesSchema)).toEqual([]);
      }
    }

    const table = admittedDecisionRouteTable();
    hostedRouteOf(table).budget_ms = SUB_SECOND_BUDGET_MS;
    expect(resolveDecisionRoute(HOSTED_ROUTE, table, EMPTY_ENV).budgetMs).toBe(SUB_SECOND_BUDGET_MS);
  });

  it("the loader refuses to load a table that violates a bound", async () => {
    const table = editableDecisionRouteTable();
    hostedRouteOf(table).budget_ms = DECISION_BUDGET_CEILING_MS + 1;
    vi.resetModules();
    vi.doMock("../../../llm/decision/decision-routes.json", () => ({ default: table }));
    await expect(import("../../../llm/decision/decision-route-table")).rejects.toThrow(
      "decision route table is invalid: routes.dm.hosted.budget_ms must be an integer in [50, 10000]",
    );

    // The same import succeeds on the table as shipped, so the rejection is the bound's doing.
    const shipped = editableDecisionRouteTable();
    vi.resetModules();
    vi.doMock("../../../llm/decision/decision-routes.json", () => ({ default: shipped }));
    await expect(import("../../../llm/decision/decision-route-table")).resolves.toBeDefined();
  });

  it("each rule that spans two fields is enforced, one violation per broken rule", () => {
    const cases: readonly {
      readonly name: string;
      readonly edit: (table: DeepMutable<DecisionRouteTable>) => void;
      readonly violation: string;
    }[] = [
      {
        name: "the local route declared as served here",
        edit: (table) => {
          Object.assign(localRouteOf(table), { served_by: "utils" });
        },
        violation: 'routes.dm.local.served_by must be "engine"',
      },
      {
        name: "a route naming an undeclared provider",
        edit: (table) => {
          hostedRouteOf(table).provider = "nobody";
        },
        violation: 'routes.dm.hosted.provider names "nobody", which is not a declared provider',
      },
      {
        name: "a route naming a property every object inherits as its provider",
        edit: (table) => {
          hostedRouteOf(table).provider = "constructor";
        },
        violation: 'routes.dm.hosted.provider names "constructor", which is not a declared provider',
      },
      {
        name: "a hosted route naming the consumer's provider",
        edit: (table) => {
          hostedRouteOf(table).provider = localRouteOf(table).provider;
        },
        violation: 'routes.dm.hosted.provider must have api_style "systemone"',
      },
      {
        name: "an authenticated call with no date",
        edit: (table) => {
          hostedRouteOf(table).contract_verified = null;
        },
        violation: "routes.dm.hosted.contract_evidence and contract_verified disagree",
      },
      {
        name: "documentation with a date",
        edit: (table) => {
          hostedRouteOf(table).contract_evidence = "documentation";
        },
        violation: "routes.dm.hosted.contract_evidence and contract_verified disagree",
      },
      {
        name: "a hosted state ceiling claimed as a checkpoint window",
        edit: (table) => {
          hostedRouteOf(table).max_state_tokens_basis = "checkpoint-window";
        },
        violation: 'routes.dm.hosted.max_state_tokens_basis must be "vendor-documented-ceiling"',
      },
      {
        name: "a score cap no score could satisfy",
        edit: (table) => {
          hostedRouteOf(table).caps.max_score_levels = 1;
        },
        violation: "routes.dm.hosted.caps.max_score_levels must be an integer of at least 2",
      },
      {
        name: "a question cap of zero",
        edit: (table) => {
          localRouteOf(table).caps.max_questions = 0;
        },
        violation: "routes.dm.local.caps.max_questions must be a positive integer, or null",
      },
      {
        name: "a negative price",
        edit: (table) => {
          hostedRouteOf(table).price_per_mtok = { input: -0.042, output: 0, as_of: "2026-10-01" };
        },
        violation: "routes.dm.hosted.price_per_mtok.input and .output must be non-negative numbers",
      },
      {
        name: "a revision that is not a full commit hash",
        edit: (table) => {
          localRouteOf(table).revision = "55cf4c4e";
        },
        violation: "routes.dm.local.revision must be a full 40-character commit hash",
      },
      {
        name: "a key value where a key variable's name belongs",
        edit: (table) => {
          hostedProviderOf(table).api_key_env = "sk-not-a-variable-name";
        },
        violation: "providers.typesafe.api_key_env must be the NAME of an environment variable",
      },
      {
        name: "a declared base URL in cleartext",
        edit: (table) => {
          hostedProviderOf(table).base_url = "http://api.example.com";
        },
        violation: "providers.typesafe.base_url must be an absolute https URL, or null",
      },
      {
        name: "a hosted provider with no way to resolve a base URL",
        edit: (table) => {
          const provider = hostedProviderOf(table);
          provider.base_url = null;
          provider.base_url_env = null;
        },
        violation: "providers.typesafe.base_url and base_url_env are both null",
      },
      {
        name: "a URL on a provider this package never contacts",
        edit: (table) => {
          Object.assign(table.providers[localRouteOf(table).provider], { base_url: OVERRIDE_BASE_URL });
        },
        violation: "providers.engine-judge.base_url must be absent",
      },
      {
        name: "a latency trip, whose objectives a decision route has no classes for",
        edit: (table) => {
          Object.assign(table.defaults.circuit_breaker, { latency_trip: { enabled: false } });
        },
        violation: "defaults.circuit_breaker.latency_trip must be absent",
      },
      {
        name: "a breaker that opens on no failures",
        edit: (table) => {
          table.defaults.circuit_breaker.failure_threshold = 0;
        },
        violation: "defaults.circuit_breaker.failure_threshold must be a positive integer",
      },
    ];
    for (const { name, edit, violation } of cases) {
      const violations = violationsAfter(edit);
      expect(violations, name).toHaveLength(1);
      expect(violations[0], name).toContain(violation);
    }
  });
});

describe("admission", () => {
  it("a live account with documentation-only evidence is still refused", () => {
    const table = editableDecisionRouteTable();
    hostedProviderOf(table).account_status = "live";

    const refusal = refusalOf(HOSTED_ROUTE, table);
    expect(refusal.code).toBe("route_not_admitted");
    expect(refusal.reason).toContain('contract evidence is "documentation"');

    const admission = decisionRouteAdmission(hostedRouteOf(table), hostedProviderOf(table), EMPTY_ENV);
    expect(admission).toEqual({
      admit: false,
      code: "route_not_admitted",
      reason: expect.stringContaining("no authenticated call has confirmed them"),
    });
  });

  it("refuses in a fixed order, so the reason names the first thing onboarding has not done", () => {
    // Everything closed at once: each fix below reveals the next refusal.
    const table = admittedDecisionRouteTable();
    const route = hostedRouteOf(table);
    const provider = hostedProviderOf(table);
    route.model_id_status = "pending-provider-confirmation";
    provider.account_status = "pending-onboarding";
    route.contract_evidence = "documentation";
    route.contract_verified = null;
    provider.base_url = null;

    const reasonNow = (): string => {
      const admission = decisionRouteAdmission(route, provider, EMPTY_ENV);
      if (admission.admit) {
        throw new Error("the route was admitted, and a refusal was expected");
      }
      expect(admission.code).toBe("route_not_admitted");
      return admission.reason;
    };

    expect(reasonNow()).toContain("model id unconfirmed");
    route.model_id_status = "confirmed";
    expect(reasonNow()).toBe('provider account status is "pending-onboarding"');
    provider.account_status = "not-in-scope";
    expect(reasonNow()).toBe('provider account status is "not-in-scope"');
    provider.account_status = "live";
    expect(reasonNow()).toContain('contract evidence is "documentation"');
    route.contract_evidence = "authenticated-call";
    route.contract_verified = TEST_CONTRACT_VERIFIED;
    expect(reasonNow()).toBe("base URL unresolved: the provider declares none and TYPESAFE_BASE_URL is unset");
    provider.base_url = OVERRIDE_BASE_URL;
    expect(decisionRouteAdmission(route, provider, EMPTY_ENV)).toEqual({ admit: true });
  });

  it("the consumer-served refusal comes before every other", () => {
    const table = editableDecisionRouteTable();
    const admission = decisionRouteAdmission(localRouteOf(table), hostedProviderOf(table), EMPTY_ENV);
    expect(admission).toEqual({ admit: false, code: "engine_served", reason: expect.any(String) });
  });

  it("a base URL override that is set and unusable is a refusal, never a fall back to the declared URL", () => {
    const table = admittedDecisionRouteTable();
    const overrideName = hostedProviderOf(table).base_url_env;
    if (overrideName === null) {
      throw new Error("the hosted provider declares no base URL override variable");
    }
    for (const unusable of ["not-a-url-7f3a", "api.example.com", "ftp://files.example.com", "/v1/systemone"]) {
      const refusal = refusalOf(HOSTED_ROUTE, table, { [overrideName]: unusable });
      expect(refusal.code).toBe("route_not_admitted");
      expect(refusal.reason).toBe(
        `base URL unresolved: ${overrideName} is set to something that is not an absolute http(s) URL`,
      );
      expect(refusal.message).not.toContain(unusable);
    }
  });

  it("a table that breaks a rule is refused when it is handed to the resolver", () => {
    const table = admittedDecisionRouteTable();
    hostedRouteOf(table).version_pin = "jev-latest";
    const refusal = refusalOf(HOSTED_ROUTE, table);
    expect(refusal.code).toBe("route_not_admitted");
    expect(refusal.reason).toContain("the route table is invalid");
    expect(refusal.reason).toContain("version_pin must be a versioned model id");
  });

  it("a name that is not a route is refused with a typed error, whatever every object inherits", () => {
    for (const name of ["dm.baseline", "constructor", "__proto__", "toString"]) {
      const route = name as DecisionRoute;
      for (const read of [
        (): unknown => decisionRouteDeclaration(route),
        (): unknown => resolveDecisionRoute(route, decisionRouteTable, EMPTY_ENV),
        (): unknown => resolveDecisionRoute(route, admittedDecisionRouteTable(), EMPTY_ENV),
      ]) {
        let thrown: unknown = null;
        try {
          read();
        } catch (error) {
          thrown = error;
        }
        expect(thrown, name).toBeInstanceOf(DecisionCallError);
        expect(thrown, name).toMatchObject({ fault: "unavailable", code: "route_not_admitted" });
      }
    }
  });
});

describe("resolution", () => {
  const resolvesEverything =
    "an admitted route resolves its pin, expected served model, budget, caps, price and base URL, " +
    "and the environment override wins";
  it(resolvesEverything, () => {
    const table = admittedDecisionRouteTable();
    const hosted = hostedRouteOf(table);
    const provider = hostedProviderOf(table);
    const overrideName = provider.base_url_env;
    if (overrideName === null || provider.base_url === null) {
      throw new Error("the hosted provider declares no base URL or no override variable");
    }

    const resolved: ResolvedDecisionRoute = resolveDecisionRoute(HOSTED_ROUTE, table, EMPTY_ENV);
    expect(resolved).toEqual({
      route: "dm.hosted",
      providerName: "typesafe",
      provider,
      modelPin: "jev-1.13.0",
      expectedServedModel: "jev-1.13.0",
      budgetMs: 1500,
      caps: { maxOptions: 255, maxScoreLevels: 10, maxQuestions: null },
      maxStateTokens: 32000,
      priceAnchor: {
        input: 0.042,
        output: 0,
        as_of: "2026-10-01",
        source: "https://docs.typesafe.ai/models.md",
      },
      apiKeyEnv: "TYPESAFE_API_KEY",
      baseUrl: "https://api.typesafe.ai",
    });
    // What resolved is what the table declares, read once.
    expect(resolved.modelPin).toBe(hosted.version_pin);
    expect(resolved.expectedServedModel).toBe(hosted.expected_served_model);
    expect(resolved.baseUrl).toBe(provider.base_url);

    const overridden = resolveDecisionRoute(HOSTED_ROUTE, table, { [overrideName]: OVERRIDE_BASE_URL });
    expect(overridden.baseUrl).toBe(OVERRIDE_BASE_URL);
    expect({ ...overridden, baseUrl: resolved.baseUrl }).toEqual(resolved);

    // An override that is set and empty is no override.
    expect(resolveDecisionRoute(HOSTED_ROUTE, table, { [overrideName]: "" }).baseUrl).toBe(provider.base_url);

    // A provider with no declared URL resolves from the environment alone.
    provider.base_url = null;
    expect(resolveDecisionRoute(HOSTED_ROUTE, table, { [overrideName]: OVERRIDE_BASE_URL }).baseUrl).toBe(
      OVERRIDE_BASE_URL,
    );
  });

  it("a base URL is handed over without trailing slashes, so a path is appended by one rule", () => {
    const table = admittedDecisionRouteTable();
    const overrideName = hostedProviderOf(table).base_url_env;
    if (overrideName === null) {
      throw new Error("the hosted provider declares no base URL override variable");
    }
    const resolved = resolveDecisionRoute(HOSTED_ROUTE, table, { [overrideName]: `${OVERRIDE_BASE_URL}//` });
    expect(resolved.baseUrl).toBe(OVERRIDE_BASE_URL);
    const local = resolveDecisionRoute(HOSTED_ROUTE, table, { [overrideName]: "http://127.0.0.1:8787/" });
    expect(local.baseUrl).toBe("http://127.0.0.1:8787");
  });

  it("reads the base URL override from the process environment by default", () => {
    const table = admittedDecisionRouteTable();
    const overrideName = hostedProviderOf(table).base_url_env;
    if (overrideName === null) {
      throw new Error("the hosted provider declares no base URL override variable");
    }
    vi.stubEnv(overrideName, OVERRIDE_BASE_URL);
    try {
      expect(resolveDecisionRoute(HOSTED_ROUTE, table).baseUrl).toBe(OVERRIDE_BASE_URL);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
