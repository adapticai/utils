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

/** The vendor's own request ceiling, as the organisation's console states it, in requests per second. */
const VENDOR_REQUESTS_PER_SECOND = 80;

/** The vendor's own input-token ceiling, in tokens per second. It bounds a quantity this package does not count. */
const VENDOR_INPUT_TOKENS_PER_SECOND = 100_000;

/** The hosted entry's per-minute refill rate, which is NOT its bucket size and is NOT the vendor's figure. */
const HOSTED_REQUESTS_PER_MINUTE = 1920;

/** The hosted entry's bucket size: one second of its own refill, which is the client's own derating. */
const HOSTED_MAX_BURST = 32;

/** The hosted entry's permit count, held equal to the capacity so the bucket is the binding bound. */
const HOSTED_MAX_CONCURRENT = 32;

/** The hosted entry's input-token refill, in tokens per second. The client's own derate, not the vendor's figure. */
const HOSTED_INPUT_TOKENS_PER_SECOND = 16_000;

/**
 * The hosted entry's input-token capacity: the vendor's own 64k-per-request
 * context ceiling, so no request the VENDOR would accept is unservable here.
 */
const HOSTED_MAX_INPUT_TOKEN_BURST = 64_000;

/**
 * The fraction of the vendor's ceiling the entry's worst one-second window
 * reaches, on BOTH bounds. A bucket holding C refilled at R admits at most
 * C + R in any second, and both limbs are derated to this same share.
 */
const DERATED_SHARE_OF_VENDOR_CEILING = 0.8;

/** A token cost small enough that the request bound, not the token bound, is what binds a burst test. */
const NEGLIGIBLE_INPUT_TOKENS = 1;

/** One second, the unit the vendor enforces both of its ceilings in. */
const ONE_SECOND_MS = 1_000;

/** Offers held outstanding, above any one second's admissions, so the guard and never the supply sets the pace. */
const SATURATION_OUTSTANDING = 200;

/** How far the saturation loop advances the clock, in milliseconds. */
const SATURATION_HORIZON_MS = 3_000;

/** The clock step the saturation loop advances in, in milliseconds. */
const SATURATION_STEP_MS = 25;

/**
 * The vendor's documented per-request context ceiling, in tokens: "64k tokens
 * per request". The floor the input-token capacity is set at or above.
 */
const VENDOR_PER_REQUEST_TOKEN_CEILING = 64_000;

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

  it("states the hosted provider's numbers against the vendor ceiling it cites, derated and labelled as its own", () => {
    const limits = limitsFor("typesafe");

    // The ceiling is known and cited, so the entry's basis is published. None
    // of its numbers IS the ceiling, which is why each derated one carries its
    // own conservative-default label rather than inheriting this one.
    expect(limits.basis).toBe("published");
    expect(limits.source).toBeTruthy();
    expect(limits).toMatchObject({
      requests_per_minute: HOSTED_REQUESTS_PER_MINUTE,
      requests_per_minute_basis: "conservative-default",
      max_burst: HOSTED_MAX_BURST,
      max_burst_basis: "conservative-default",
      max_concurrent: HOSTED_MAX_CONCURRENT,
      acquire_timeout_ms: 250,
    });

    // The pace is a fraction of the cited ceiling, which a reader can check by
    // arithmetic against the source. A number at or above it would be the
    // ceiling itself, which no client should offer.
    expect(HOSTED_REQUESTS_PER_MINUTE / SECONDS_PER_MINUTE).toBeLessThan(VENDOR_REQUESTS_PER_SECOND);

    // The source states what was read and that it cannot be re-opened from
    // here, because the vendor publishes the figure only behind a login. A
    // source that cannot be followed must say so rather than read like a link.
    expect(limits.source).toContain(`${VENDOR_REQUESTS_PER_SECOND} requests/second`);
    expect(limits.source).toContain("Not a link");

    // The unit is the fact that survives every revision of the figures.
    expect(limits.note).toContain("Limits are measured in tokens per second and requests per second");
    expect(limits.note).toContain("the vendor enforces per SECOND");

    // An earlier revision cited figures to a page that does not carry them.
    // Naming that keeps the correction from being silently re-reverted by
    // whoever next reads the stale citation somewhere else.
    expect(limits.note).toContain("the citation was withdrawn");

    // The vendor's OTHER published unit is now bounded too, and the entry
    // states the arithmetic that holds it under the ceiling rather than only
    // the figures.
    // The SECOND bound, in the vendor's other unit, with the same provenance
    // discipline: the refill is the client's derate and says so, while the
    // capacity is the one figure here taken from the vendor.
    expect(limits).toMatchObject({
      input_tokens_per_second: HOSTED_INPUT_TOKENS_PER_SECOND,
      input_tokens_per_second_basis: "conservative-default",
      max_input_token_burst: HOSTED_MAX_INPUT_TOKEN_BURST,
      max_input_token_burst_basis: "published",
    });

    // The arithmetic the entry states, re-derived here rather than quoted: a
    // bucket holding C refilled at R admits at most C + R over any one second,
    // and that worst second is held to the same share of the vendor's ceiling
    // on BOTH bounds. An entry that drifted on either limb fails here.
    expect(HOSTED_MAX_INPUT_TOKEN_BURST + HOSTED_INPUT_TOKENS_PER_SECOND).toBe(
      VENDOR_INPUT_TOKENS_PER_SECOND * DERATED_SHARE_OF_VENDOR_CEILING,
    );
    expect(HOSTED_MAX_BURST + HOSTED_REQUESTS_PER_MINUTE / SECONDS_PER_MINUTE).toBe(
      VENDOR_REQUESTS_PER_SECOND * DERATED_SHARE_OF_VENDOR_CEILING,
    );

    // The capacity is at or above the largest request the VENDOR accepts, so
    // no vendor-legal request is permanently unservable by this client.
    expect(limits.max_input_token_burst).toBeGreaterThanOrEqual(VENDOR_PER_REQUEST_TOKEN_CEILING);

    expect(limits.note).toContain("THE TOKEN CEILING IS NOW GUARDED");
    expect(limits.note).toContain(`${VENDOR_INPUT_TOKENS_PER_SECOND.toLocaleString("en-US")} tokens/second`);

    // Raising the permit count is what enlarges the admit set, so the entry
    // says so in the place a reader deciding whether to roll it back will look.
    expect(limits.note).toContain("ENLARGES");
    expect(limits.note).toContain("ROLLBACK");
  });

  it("holds the permit count at the capacity, so the bucket is the bound that binds", () => {
    const limits = limitsFor("typesafe");

    // The bounds apply in series, each waiting only acquire_timeout_ms. Fewer
    // permits than the capacity makes the capacity unreachable rather than
    // redundant: the surplus of a burst waits a whole call for a permit, which
    // is longer than the timeout at the latency these routes measured.
    expect(limits.max_concurrent).toBeGreaterThanOrEqual(burstCapacityFor(limits));
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
        await withProviderGuards("typesafe", () => Promise.resolve(), undefined, {
          inputTokens: NEGLIGIBLE_INPUT_TOKENS,
        });
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
      const beyondCapacity = withProviderGuards("typesafe", () => Promise.resolve(), undefined, {
        inputTokens: NEGLIGIBLE_INPUT_TOKENS,
      }).then(
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

  const slidingName =
    "no sliding one-second window admits more requests than the vendor's ceiling";
  it(slidingName, async () => {
    // The request bound's worst second is pinned ARITHMETICALLY above, by
    // comparing two declared constants. That cannot catch a guard whose
    // implementation admits more than its own numbers imply, which is why the
    // token bound stopped asserting its arithmetic and started driving its
    // shipped bucket. This does the same for requests.
    //
    // A bucket starts full, so the most a sliding one-second window can admit
    // is its capacity PLUS one second of its refill. That sum, and not the
    // refill alone, is the quantity a ceiling enforced per second refuses.
    // Measuring it needs the offers to be REPLENISHED across the second: a
    // single offer may wait only `acquire_timeout_ms`, far less than a second,
    // so a saturating stream is the only thing that sees the refill arrive.
    const limits = limitsFor("typesafe");
    const admittedAtMs: number[] = [];
    let outstanding = 0;

    /**
     * Keep the guard saturated with offers that settle into the record.
     *
     * @returns Nothing; admissions are recorded in `admittedAtMs`.
     */
    const topUp = (): void => {
      while (outstanding < SATURATION_OUTSTANDING) {
        outstanding += 1;
        void withProviderGuards(
          "typesafe",
          () => {
            admittedAtMs.push(Date.now());
            return Promise.resolve();
          },
          undefined,
          { inputTokens: NEGLIGIBLE_INPUT_TOKENS },
        ).then(
          () => {
            outstanding -= 1;
          },
          () => {
            outstanding -= 1;
          },
        );
      }
    };

    vi.useFakeTimers();
    resetProviderGuards();
    try {
      topUp();
      for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
        await Promise.resolve();
      }
      // The cold instant is the capacity, counted out of the real guard.
      expect(admittedAtMs.length).toBe(limits.max_burst);

      for (let elapsed = 0; elapsed < SATURATION_HORIZON_MS; elapsed += SATURATION_STEP_MS) {
        await vi.advanceTimersByTimeAsync(SATURATION_STEP_MS);
        topUp();
      }

      // The window, over recorded admission times rather than over the
      // declared numbers. Half-open, so one admission is counted in one
      // window position only.
      let worstSecond = 0;
      for (const start of admittedAtMs) {
        const inWindow = admittedAtMs.filter(
          (at) => at >= start && at < start + ONE_SECOND_MS,
        ).length;
        worstSecond = Math.max(worstSecond, inWindow);
      }

      // The vendor's own bound: the only one a 429 is measured against.
      expect(worstSecond).toBeLessThan(VENDOR_REQUESTS_PER_SECOND);
      // And the derate this entry claims, as an upper bound on the measurement
      // rather than an equality: the refill accrues continuously while the
      // window slides over discrete admissions, so the exact count at the
      // boundary is an artefact of the step and the claim is the bound.
      expect(worstSecond).toBeLessThanOrEqual(
        VENDOR_REQUESTS_PER_SECOND * DERATED_SHARE_OF_VENDOR_CEILING,
      );
      // Bounded from BELOW too, or a guard that had seized up would satisfy
      // every assertion above. The capacity ADDS to the refill, so the worst
      // second strictly exceeds the refill alone -- which is exactly why
      // reading the refill against the ceiling understates the pace.
      expect(worstSecond).toBeGreaterThan(limits.requests_per_minute / SECONDS_PER_MINUTE);
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
      // And an input-token bound of its own, on the same ground: the token
      // ceiling is counted per model too, and a provider-wide bound does not
      // reach a model whose numbers replaced it.
      input_tokens_per_second: HOSTED_INPUT_TOKENS_PER_SECOND,
      input_tokens_per_second_basis: "conservative-default",
      max_input_token_burst: HOSTED_MAX_INPUT_TOKEN_BURST,
      max_input_token_burst_basis: "conservative-default",
      max_concurrent: HOSTED_MAX_CONCURRENT,
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
            input_tokens_per_second: HOSTED_INPUT_TOKENS_PER_SECOND,
            max_input_token_burst: HOSTED_MAX_INPUT_TOKEN_BURST,
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

  it("refuses a guarded decision provider that declares no input-token bound", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      for (const field of ["input_tokens_per_second", "max_input_token_burst"]) {
        Reflect.deleteProperty(limits.providers.typesafe, field);
      }
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(SUCCESS_TOKEN);
    // The vendor enforces two ceilings per second and refuses over either, so
    // a request-counting guard holds one of them twice. One failure per route
    // the provider serves, as with the burst capacity.
    for (const route of ["dm.hosted", "dm.hosted.preview"]) {
      expect(result.stderr).toContain(
        `FAIL typesafe: serves decision route ${route} but declares no input-token bound`,
      );
    }
    expect(result.stderr).toContain("2 failure(s)");
  });

  it("refuses an input-token bound declared by half", () => {
    // Either number alone reads as a token guard and behaves as none: a refill
    // with no capacity bounds only the average a per-second ceiling does not
    // enforce, and a capacity with no refill admits one bucketful for ever.
    for (const dropped of ["input_tokens_per_second", "max_input_token_burst"]) {
      const result = runVerifierOnEditedCopy(({ limits }) => {
        Reflect.deleteProperty(limits.providers.typesafe, dropped);
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `FAIL typesafe: declares ${dropped === "input_tokens_per_second" ? "max_input_token_burst" : "input_tokens_per_second"} without the other`,
      );
    }
  });

  it("refuses an input-token capacity below one second of its own refill", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      limits.providers.typesafe.max_input_token_burst = HOSTED_INPUT_TOKENS_PER_SECOND - 1;
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `FAIL typesafe: max_input_token_burst ${HOSTED_INPUT_TOKENS_PER_SECOND - 1} is below one second of input_tokens_per_second ${HOSTED_INPUT_TOKENS_PER_SECOND}`,
    );
  });

  it("refuses an input-token bound that calls itself published while citing no source", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      Object.assign(limits.providers.typesafe, {
        basis: "conservative-default",
        source: null,
        max_burst_basis: "conservative-default",
        input_tokens_per_second_basis: "published",
      });
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAIL typesafe: claims a published input_tokens_per_second but cites no source");
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

  it("refuses a burst capacity that calls itself published while citing no source", () => {
    const result = runVerifierOnEditedCopy(({ limits }) => {
      // The entry now cites a source, so the rule is only reachable from the
      // provenance it had before the ceiling was read: no source, a basis that
      // claims none, and a capacity labelled published on top of that.
      Object.assign(limits.providers.typesafe, {
        basis: "conservative-default",
        source: null,
        max_burst_basis: "published",
      });
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
