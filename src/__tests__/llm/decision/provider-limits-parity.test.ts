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

import { afterEach, describe, expect, it, vi } from "vitest";

import { decisionRouteTable } from "../../../llm/decision/decision-route-table";
import type { DecisionUtilsServedRouteDeclaration } from "../../../llm/decision/route-types";
import {
  burstCapacityFor,
  guardSnapshots,
  limitsFor,
  limitsInventory,
  resetProviderGuards,
  withProviderGuards,
} from "../../../llm/rate-guard";

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

/** Seconds in a minute, converting the entry's per-minute refill to the per-second pace the vendor enforces in. */
const SECONDS_PER_MINUTE = 60;

/** The hosted entry's per-minute refill rate, which is NOT its bucket size. */
const HOSTED_REQUESTS_PER_MINUTE = 600;

/** The hosted entry's bucket size: one second of its own refill, the tightest bound derivable with no vendor figure. */
const HOSTED_MAX_BURST = 10;

/** Enough microtask turns for an admitted call to have settled, so a still-pending one was genuinely not admitted. */
const SETTLE_TURNS = 8;

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
    expect(served.map(({ name }) => name)).toEqual(["dm.hosted", "dm.hosted.preview"]);

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

  it("states the hosted provider's numbers as a conservative default, citing no figure it cannot source", () => {
    const limits = limitsFor("typesafe");
    expect(limits.basis).toBe("conservative-default");
    expect(limits.source).toBeNull();
    expect(limits).toMatchObject({
      requests_per_minute: HOSTED_REQUESTS_PER_MINUTE,
      max_burst: HOSTED_MAX_BURST,
      max_burst_basis: "conservative-default",
      max_concurrent: 8,
      acquire_timeout_ms: 250,
    });

    // The vendor publishes the UNIT it enforces in and no figure for either
    // bound, so the entry rests on the unit alone. A figure would have to come
    // with a source, and a number that cannot be sourced is a guess whichever
    // confident label it is given.
    expect(limits.note).toContain("THE VENDOR PUBLISHES NO NUMBER");
    expect(limits.note).toContain("Limits are measured in tokens per second and requests per second");
    expect(limits.note).toContain("the UNIT: the vendor enforces per SECOND");

    // An earlier revision cited figures to a page that does not carry them.
    // Naming that keeps the correction from being silently re-reverted by
    // whoever next reads the stale citation somewhere else.
    expect(limits.note).toContain("the citation is not verifiable and the figures are not carried");

    // The vendor's other published unit is not guarded here at all, and an
    // entry that bounds one of two bounds says which one it leaves open.
    expect(limits.note).toContain("No token-per-second bound is enforced here");
  });

  it("holds the hosted burst capacity to one second of its own refill", () => {
    const limits = limitsFor("typesafe");

    // The vendor enforces per second, so a bucket is safe at one second of the
    // pace the entry has already chosen whatever the vendor's own figure turns
    // out to be: a client cannot exceed, in any instant, a rate it sustains.
    // This is the one bound derivable with no vendor number to read.
    expect(limits.max_burst).toBe(limits.requests_per_minute / SECONDS_PER_MINUTE);

    // The two quantities are distinct in the data, not just in the code that
    // reads it. Equal, the entry would be back to bounding only the average.
    expect(limits.max_burst).toBeLessThan(limits.requests_per_minute);
    expect(burstCapacityFor(limits)).toBe(HOSTED_MAX_BURST);
  });

  const coldStart =
    "a COLD hosted guard admits no more than its capacity in one instant, and paces the next call";
  it(coldStart, async () => {
    const limits = limitsFor("typesafe");
    const capacity = HOSTED_MAX_BURST;
    expect(limits.max_burst).toBe(capacity);

    const tokensLeft = (): number =>
      guardSnapshots().find(({ provider }) => provider === "typesafe")?.availableTokens ?? Number.NaN;

    // The clock is held still for the whole burst, so nothing refills and every
    // call admitted below is admitted in ONE instant. A per-second ceiling is a
    // statement about an instant, so only a frozen clock can test it.
    vi.useFakeTimers();
    resetProviderGuards();
    try {
      let admitted = 0;
      while (admitted < capacity) {
        await withProviderGuards("typesafe", () => Promise.resolve());
        admitted += 1;
      }
      expect(admitted).toBe(capacity);

      // The bucket is now empty, and it was the capacity that emptied it rather
      // than the per-minute allowance: were the two still conflated there would
      // be a further 590 tokens standing here.
      expect(tokensLeft()).toBeLessThan(1);
      expect(capacity).toBeLessThan(limits.requests_per_minute);

      // One more call in the SAME instant. It must not be admitted, and the
      // assertion is that it has not settled: a guard that still held the
      // minute's allowance would resolve it here without the clock moving.
      let settled: "admitted" | "refused" | "pending" = "pending";
      const beyondCapacity = withProviderGuards("typesafe", () => Promise.resolve()).then(
        () => {
          settled = "admitted";
        },
        () => {
          settled = "refused";
        },
      );
      for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
        await Promise.resolve();
      }
      expect(settled).toBe("pending");

      // Moving the clock by one token's worth of refill admits it. That is the
      // difference the capacity makes: the call is PACED rather than refused,
      // so the bound costs latency and not decisions.
      await vi.advanceTimersByTimeAsync(limits.acquire_timeout_ms);
      await beyondCapacity;
      expect(settled).toBe("admitted");
    } finally {
      resetProviderGuards();
      vi.useRealTimers();
    }
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
    // One failure per route the provider serves: the provider is shared, so
    // removing its entry leaves both hosted routes running on defaults.
    for (const route of ["dm.hosted", "dm.hosted.preview"]) {
      expect(result.stderr).toContain(
        `FAIL typesafe: serves decision route ${route} but is absent from the limits config`,
      );
    }
    expect(result.stderr).toContain("2 failure(s)");
  });

  it("refuses a queue timeout longer than the route's budget", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      limits.providers.typesafe.acquire_timeout_ms = PACKAGE_DEFAULT_ACQUIRE_TIMEOUT_MS;
    });
    expect(result.status).toBe(1);
    for (const route of ["dm.hosted", "dm.hosted.preview"]) {
      expect(result.stderr).toContain(
        `FAIL typesafe: acquire_timeout_ms 15000 exceeds the 1500 ms budget of decision route ${route}`,
      );
    }
    expect(result.stderr).toContain("2 failure(s)");

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
      requests_per_minute: HOSTED_REQUESTS_PER_MINUTE,
      // The override replaces the provider's numbers wholesale, so it states a
      // capacity of its own: the provider's does not reach a model whose
      // numbers it no longer governs.
      max_burst: HOSTED_MAX_BURST,
      max_burst_basis: "conservative-default",
      max_burst_measured_demand: 0,
      max_burst_vendor_ceiling: null,
      max_burst_source: "One second of this override's own refill, the bound derivable where the vendor publishes the unit and no figure.",
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
    // The override is scoped to the pinned model of the first hosted route, so
    // only that route's calls wait on it and only it fails.
    expect(slow.stderr).toContain(
      "FAIL typesafe: acquire_timeout_ms 15000 exceeds the 1500 ms budget of decision route dm.hosted,",
    );
    expect(slow.stderr).toContain("1 failure(s)");
  });

  it("refuses a guarded decision provider that declares no burst capacity", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      Reflect.deleteProperty(limits.providers.typesafe, "max_burst");
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(SUCCESS_TOKEN);
    // One failure per route the provider serves: without a capacity every route
    // naming it is admitted with its burst unbounded, not just the first.
    for (const route of ["dm.hosted", "dm.hosted.preview"]) {
      expect(result.stderr).toContain(
        `FAIL typesafe: serves decision route ${route} but declares no max_burst, so a cold guard admits its whole per-minute allowance of ${HOSTED_REQUESTS_PER_MINUTE} in one instant`,
      );
    }
    expect(result.stderr).toContain("2 failure(s)");
  });

  it("refuses a per-model override that drops the capacity the provider declared", () => {
    const pin = utilsServedRoutes()[0].route.version_pin;
    const result = runVerifierOnEditedCopy(({ limits }) => {
      Object.assign(limits.providers.typesafe, {
        scope: "model",
        scope_source: "https://docs.example.com/rate-limits",
        models: {
          [pin]: {
            basis: "conservative-default",
            requests_per_minute: HOSTED_REQUESTS_PER_MINUTE,
            max_concurrent: 8,
            acquire_timeout_ms: 250,
            source: null,
            note: "An override that states a rate and no capacity.",
          },
        },
      });
    });
    // The provider's own capacity is still declared, and still does not reach
    // this model: an override is read instead of the entry, not alongside it.
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `FAIL typesafe/${pin}: serves decision route dm.hosted but declares no max_burst`,
    );
    expect(result.stderr).toContain("1 failure(s)");
  });

  it("refuses a burst capacity the refill rate could never fill", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      limits.providers.typesafe.max_burst = HOSTED_REQUESTS_PER_MINUTE + 1;
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `FAIL typesafe: max_burst ${HOSTED_REQUESTS_PER_MINUTE + 1} exceeds requests_per_minute ${HOSTED_REQUESTS_PER_MINUTE}, so the refill never fills it and it bounds no burst`,
    );
    expect(result.stderr).toContain("1 failure(s)");
  });

  it("refuses a burst capacity that states no provenance of its own", () => {
    const basisless = runVerifierOnEditedCopy(({ limits }) => {
      Reflect.deleteProperty(limits.providers.typesafe, "max_burst_basis");
    });
    expect(basisless.status).toBe(1);
    expect(basisless.stderr).toContain(
      "FAIL typesafe: declares max_burst but no max_burst_basis, so the capacity's provenance is inherited from a different quantity",
    );

    // A label is not a provenance. The capacity names the measurement it came
    // from, because a capacity nobody can trace is a guess that throttles
    // whatever the guard serves.
    const sourceless = runVerifierOnEditedCopy(({ limits }) => {
      Reflect.deleteProperty(limits.providers.typesafe, "max_burst_source");
    });
    expect(sourceless.status).toBe(1);
    expect(sourceless.stderr).toContain(
      "FAIL typesafe: declares max_burst but says nothing about where the number came from",
    );
  });

  it("refuses a burst capacity with no demand and no vendor ceiling to judge it against", () => {
    const demandless = runVerifierOnEditedCopy(({ limits }) => {
      Reflect.deleteProperty(limits.providers.typesafe, "max_burst_measured_demand");
    });
    expect(demandless.status).toBe(1);
    expect(demandless.stderr).toContain(
      "FAIL typesafe: declares max_burst but no measured instantaneous demand to judge it against",
    );

    // Null is a real answer for a vendor that publishes no bound on an instant,
    // and absent is not: an unstated ceiling is indistinguishable from an
    // unread one.
    const ceilingless = runVerifierOnEditedCopy(({ limits }) => {
      Reflect.deleteProperty(limits.providers.typesafe, "max_burst_vendor_ceiling");
    });
    expect(ceilingless.status).toBe(1);
    expect(ceilingless.stderr).toContain(
      "FAIL typesafe: declares max_burst but does not say what the vendor publishes for one instant",
    );
  });

  it("refuses a capacity below the demand it was sized for, or below its own concurrency ceiling", () => {
    const throttle = runVerifierOnEditedCopy(({ limits }) => {
      Object.assign(limits.providers.typesafe, {
        max_burst: 1,
        max_burst_measured_demand: 4,
      });
    });
    expect(throttle.status).toBe(1);
    // Both bounds are reported, because a capacity set below them fails each
    // for its own reason: it sends the demand's overflow to the rate queue,
    // where the wait expires into a refusal instead of being cleared by a
    // completing call, and it paces calls the concurrency bound admits.
    expect(throttle.stderr).toContain(
      "FAIL typesafe: max_burst 1 is below the 4 calls measured demand puts on this guard in one instant, so that demand's overflow queues for a refill bounded by acquire_timeout_ms alone instead of for a permit a completing call returns, and a call outlasting that wait is refused rather than paced",
    );
    expect(throttle.stderr).toContain(
      "FAIL typesafe: max_burst 1 is below max_concurrent 8, so the bucket paces calls the concurrency bound admits; only a published capacity may sit below it",
    );
  });

  it("refuses a demand no capacity could satisfy under the vendor's published ceiling", () => {
    // A demand above a PUBLISHED instantaneous ceiling is a conflict with the
    // vendor, not a number to choose between here: every capacity either paces
    // the demand or exceeds what the vendor admits, so the verifier refuses the
    // entry rather than letting one of the two be picked silently.
    const unsatisfiable = runVerifierOnEditedCopy(({ limits }) => {
      Object.assign(limits.providers.typesafe, {
        max_burst_measured_demand: HOSTED_MAX_BURST + 1,
        max_burst_vendor_ceiling: HOSTED_MAX_BURST,
        max_burst_vendor_ceiling_unit: "requests per second",
        source: "https://docs.example.com/rate-limits",
      });
    });
    expect(unsatisfiable.status).toBe(1);
    expect(unsatisfiable.stderr).toContain(
      `FAIL typesafe: measured demand ${HOSTED_MAX_BURST + 1} exceeds the vendor's published ${HOSTED_MAX_BURST} for one instant`,
    );
  });

  it("refuses a vendor ceiling the capacity exceeds, or one cited without its unit", () => {
    const overCeiling = runVerifierOnEditedCopy(({ limits }) => {
      Object.assign(limits.providers.typesafe, {
        max_burst_vendor_ceiling: HOSTED_MAX_BURST - 1,
        max_burst_vendor_ceiling_unit: "requests per second",
        source: "https://docs.example.com/rate-limits",
      });
    });
    expect(overCeiling.status).toBe(1);
    expect(overCeiling.stderr).toContain(
      `FAIL typesafe: max_burst ${HOSTED_MAX_BURST} exceeds the vendor's published ${HOSTED_MAX_BURST - 1} for one instant`,
    );

    // A figure read across units bounds something other than it appears to, so
    // a cited ceiling states the unit it was published in and where it was read.
    const unitless = runVerifierOnEditedCopy(({ limits }) => {
      Object.assign(limits.providers.typesafe, { max_burst_vendor_ceiling: HOSTED_MAX_BURST });
    });
    expect(unitless.status).toBe(1);
    expect(unitless.stderr).toContain(
      "FAIL typesafe: cites a vendor ceiling without the unit it was published in",
    );
    expect(unitless.stderr).toContain(
      "FAIL typesafe: cites a vendor ceiling for one instant but no source to read it from",
    );
  });

  it("refuses a burst capacity that calls itself published while citing no source", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      limits.providers.typesafe.max_burst_basis = "published";
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAIL typesafe: claims a published burst capacity but cites no source");

    // And the label itself must be one of the two the file defines, so a third
    // word cannot pass as provenance.
    const invented = runVerifierOnEditedCopy(({ limits }) => {
      limits.providers.typesafe.max_burst_basis = "measured";
    });
    expect(invented.status).toBe(1);
    expect(invented.stderr).toContain(
      'FAIL typesafe: max_burst_basis must be "published" or "conservative-default", got "measured"',
    );
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
