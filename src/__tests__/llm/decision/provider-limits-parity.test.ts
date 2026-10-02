/**
 * The limits config and the decision-route table agree.
 *
 * A decision route this package serves is held by the same rate and
 * concurrency guards as a generative leg, and those guards read their numbers
 * from the limits config by provider name. Two things follow that nothing else
 * checks. A provider with no entry of its own silently runs on the package
 * defaults, which were sized for calls a hundred times longer. And the guard's
 * rate wait is bounded by the entry's own timeout, whatever budget the caller
 * passes, so an entry whose timeout exceeds the route's budget lets a typed
 * call sit in this package's queue for longer than the whole call may take.
 *
 * The same rules are enforced by `scripts/verify-provider-limits.mjs`. It is
 * run here against the tree as it is, which is what puts it on the test
 * command, and against copies of the tree that break one rule each, so each
 * rule is shown to fail the script for its own reason.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { decisionRouteTable } from "../../../llm/decision/decision-route-table";
import type { DecisionUtilsServedRouteDeclaration } from "../../../llm/decision/route-types";
import { limitsFor, limitsInventory } from "../../../llm/rate-guard";

/** The package root, which the verifier resolves its inputs against. */
const UTILS_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The verifier, relative to the package root. */
const VERIFIER = "scripts/verify-provider-limits.mjs";

/** The limits config, relative to the package root. */
const LIMITS = "src/llm/provider-limits.json";

/** The decision-route table, relative to the package root. */
const DECISION_ROUTES = "src/llm/decision/decision-routes.json";

/** Every file the verifier's config check reads, and the verifier itself. */
const VERIFIER_INPUTS: readonly string[] = [VERIFIER, LIMITS, "src/llm/alias-routes.json", DECISION_ROUTES];

/** What the verifier prints when the config is sound. */
const SUCCESS_TOKEN = "PROVIDER_LIMITS_OK";

/** The package default queue timeout, which is what an unregistered provider would wait for. */
const PACKAGE_DEFAULT_ACQUIRE_TIMEOUT_MS = 15_000;

/** Longest the verifier may run before the test gives up on it, in milliseconds. */
const VERIFIER_TIMEOUT_MS = 30_000;

/** A parsed JSON document a test edits field by field. */
type EditableJson = Record<string, Record<string, Record<string, unknown>>>;

/** Temporary trees made by a test, removed after it. */
const temporaryTrees: string[] = [];

afterEach(() => {
  for (const tree of temporaryTrees.splice(0)) {
    rmSync(tree, { recursive: true, force: true });
  }
});

/**
 * The decision routes this package serves, with their names.
 *
 * @returns Each utils-served route of the canonical table.
 */
function utilsServedRoutes(): { name: string; route: DecisionUtilsServedRouteDeclaration }[] {
  const served: { name: string; route: DecisionUtilsServedRouteDeclaration }[] = [];
  for (const [name, route] of Object.entries(decisionRouteTable.routes)) {
    if (route.served_by === "utils") {
      served.push({ name, route });
    }
  }
  return served;
}

/**
 * Run the verifier's config check in a package root.
 *
 * @param root The root holding the verifier and its inputs.
 * @returns The exit status and what the verifier wrote.
 */
function runVerifier(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(root, VERIFIER)], {
    cwd: root,
    encoding: "utf8",
    timeout: VERIFIER_TIMEOUT_MS,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Run the verifier on a copy of the tree with one thing changed.
 *
 * The verifier resolves its inputs against its own location, so a copy of it
 * beside copies of its inputs reads the copies.
 *
 * @param edit Changes the copied limits config and decision-route table in place.
 * @returns The exit status and what the verifier wrote.
 */
function runVerifierOnEditedCopy(
  edit: (documents: { limits: EditableJson; decisionRoutes: EditableJson }) => void,
): { status: number | null; stdout: string; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), "provider-limits-parity-"));
  temporaryTrees.push(root);
  for (const file of VERIFIER_INPUTS) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(UTILS_ROOT, file), join(root, file));
  }
  const documents = {
    limits: JSON.parse(readFileSync(join(root, LIMITS), "utf8")) as EditableJson,
    decisionRoutes: JSON.parse(readFileSync(join(root, DECISION_ROUTES), "utf8")) as EditableJson,
  };
  edit(documents);
  writeFileSync(join(root, LIMITS), JSON.stringify(documents.limits));
  writeFileSync(join(root, DECISION_ROUTES), JSON.stringify(documents.decisionRoutes));
  return runVerifier(root);
}

describe("limits for the decision providers", () => {
  it("every utils-served decision provider has its own limits entry", () => {
    const served = utilsServedRoutes();
    expect(served.map(({ name }) => name)).toEqual(["dm.hosted"]);

    const registered = limitsInventory().map(({ provider }) => provider);
    expect(registered).toContain("typesafe");
    for (const { route } of served) {
      expect(registered).toContain(route.provider);
    }
  });

  it("the client's queue cannot outlast a route's budget", () => {
    for (const { name, route } of utilsServedRoutes()) {
      const limits = limitsFor(route.provider, route.version_pin);
      expect(limits.acquire_timeout_ms, name).toBeLessThanOrEqual(route.budget_ms);
      expect(limits.acquire_timeout_ms, name).toBeLessThan(PACKAGE_DEFAULT_ACQUIRE_TIMEOUT_MS);
    }
    // The default this entry exists to keep the route off.
    expect(limitsFor("a-provider-with-no-entry").acquire_timeout_ms).toBe(PACKAGE_DEFAULT_ACQUIRE_TIMEOUT_MS);
  });

  it("states the hosted provider's numbers as a conservative default, below the published ceiling", () => {
    const limits = limitsFor("typesafe");
    expect(limits.basis).toBe("conservative-default");
    expect(limits.source).toBeNull();
    expect(limits).toMatchObject({ requests_per_minute: 600, max_concurrent: 8, acquire_timeout_ms: 250 });
    expect(limits.note).toContain("40 requests per second");
    expect(limits.note).toContain("can change without notice");
  });

  it("gives the consumer-served provider no entry, because nothing here guards it", () => {
    const registered = limitsInventory().map(({ provider }) => provider);
    for (const route of Object.values(decisionRouteTable.routes)) {
      if (route.served_by === "engine") {
        expect(registered).not.toContain(route.provider);
      }
    }
  });
});

describe("the limits verifier", () => {
  it("the limits verifier accepts the tree", () => {
    const result = runVerifier(UTILS_ROOT);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(SUCCESS_TOKEN);
    expect(result.status).toBe(0);
  });

  it("accepts an unchanged copy of the tree, so a refusal below is the edit's doing", () => {
    const result = runVerifierOnEditedCopy(() => undefined);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(SUCCESS_TOKEN);
    expect(result.status).toBe(0);
  });

  it("refuses a utils-served decision provider with no limits entry", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      Reflect.deleteProperty(limits.providers, "typesafe");
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(SUCCESS_TOKEN);
    expect(result.stderr).toContain(
      "FAIL typesafe: serves decision route dm.hosted but is absent from the limits config",
    );
    expect(result.stderr).toContain("1 failure(s)");
  });

  it("refuses a queue timeout longer than the route's budget", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      limits.providers.typesafe.acquire_timeout_ms = PACKAGE_DEFAULT_ACQUIRE_TIMEOUT_MS;
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "FAIL typesafe: acquire_timeout_ms 15000 exceeds the 1500 ms budget of decision route dm.hosted",
    );
    expect(result.stderr).toContain("1 failure(s)");

    // The bound is the route's budget, so tightening the route alone trips it too.
    const tightened = runVerifierOnEditedCopy(({ decisionRoutes }) => {
      decisionRoutes.routes["dm.hosted"].budget_ms = 200;
    });
    expect(tightened.status).toBe(1);
    expect(tightened.stderr).toContain(
      "FAIL typesafe: acquire_timeout_ms 250 exceeds the 200 ms budget of decision route dm.hosted",
    );
  });

  it("reads a per-model override for the pinned model as the route's limits", () => {
    const pin = utilsServedRoutes()[0].route.version_pin;
    const overrideFor = (acquireTimeoutMs: number): Record<string, unknown> => ({
      basis: "conservative-default",
      requests_per_minute: 600,
      max_concurrent: 8,
      acquire_timeout_ms: acquireTimeoutMs,
      source: null,
      note: "The pinned model runs at numbers of its own.",
    });
    const scopePerModel = (limits: EditableJson, acquireTimeoutMs: number): void => {
      Object.assign(limits.providers.typesafe, {
        scope: "model",
        scope_source: "https://docs.example.com/rate-limits",
        models: { [pin]: overrideFor(acquireTimeoutMs) },
      });
    };

    // The pin is a model a route sends to the provider, so an override for it binds something.
    const accepted = runVerifierOnEditedCopy(({ limits }) => scopePerModel(limits, 250));
    expect(accepted.stderr).toBe("");
    expect(accepted.status).toBe(0);

    // The override, not the provider entry, is what the pinned model's calls wait on.
    const slow = runVerifierOnEditedCopy(({ limits }) => scopePerModel(limits, PACKAGE_DEFAULT_ACQUIRE_TIMEOUT_MS));
    expect(slow.status).toBe(1);
    expect(slow.stderr).toContain(
      "FAIL typesafe: acquire_timeout_ms 15000 exceeds the 1500 ms budget of decision route dm.hosted",
    );
    expect(slow.stderr).toContain("1 failure(s)");
  });

  it("refuses limits for a provider this package never guards, and for one no table declares", () => {
    const unguarded = runVerifierOnEditedCopy(({ limits }) => {
      limits.providers["engine-judge"] = structuredClone(limits.providers.typesafe);
    });
    expect(unguarded.status).toBe(1);
    expect(unguarded.stderr).toContain("FAIL engine-judge: has limits but this package never guards it");
    expect(unguarded.stderr).toContain("1 failure(s)");

    const unregistered = runVerifierOnEditedCopy(({ limits }) => {
      limits.providers.nobody = structuredClone(limits.providers.typesafe);
    });
    expect(unregistered.status).toBe(1);
    expect(unregistered.stderr).toContain("FAIL nobody: has limits but is not a registered provider");
    expect(unregistered.stderr).toContain("1 failure(s)");
  });
});
