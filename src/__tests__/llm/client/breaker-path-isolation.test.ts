/**
 * Isolation of the breaker's failure runs between the live path and a
 * measurement path.
 *
 * The property under test is a causal one, not a cosmetic one: a call whose
 * answer is discarded must not be able to decide which model serves a call
 * whose answer is acted on. Two halves make that true, and a test for either
 * alone would pass while the defect was live — failures must be charged to the
 * measurement's own run, AND admission must still read the live run so
 * measurement never piles onto a provider live traffic is already struggling
 * with.
 *
 * The live partition is asserted field by field against the behaviour that
 * predates the path dimension, because the whole value of a correction is lost
 * if it moves the thing it was not supposed to touch.
 *
 * @module __tests__/llm/client/breaker-path-isolation
 */

import { describe, expect, it } from "vitest";

import { CircuitBreakerRegistry, LIVE_BREAKER_PATH } from "../../../llm/circuit-breaker";
import type { BreakerSnapshot } from "../../../llm/circuit-breaker";
import { ChainExhaustedError, executeChain } from "../../../llm/fallback-chain";
import type { ChainLeg } from "../../../llm/fallback-chain";
import { routeTable } from "../../../llm/route-table";
import type { AliasAttemptRecord, LlmBreakerDefaults, ResolvedRoute } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { makeRoute } from "./support/routes";
import { ScriptedTransport, answers, fails, usageFor } from "./support/transports";

/** The alias these constructed chains stand in for. */
const ALIAS = "llm.extract";

/** The live breaker tuning under test. */
const BREAKER: LlmBreakerDefaults = routeTable.defaults.circuit_breaker;

/** More consecutive failures than the live threshold, so a leak would show. */
const OVER_THRESHOLD = BREAKER.failure_threshold + 3;

/** A fixed instant, so cooldown arithmetic is exact rather than wall-clock. */
const T0 = 1_000_000;

/**
 * A registry on a clock the test advances by hand.
 *
 * @returns The registry and its clock handle.
 */
function registryWithClock(): { breakers: CircuitBreakerRegistry; advance: (ms: number) => void } {
  let nowMs = T0;
  const breakers = new CircuitBreakerRegistry(BREAKER, () => nowMs);
  return {
    breakers,
    advance: (ms: number): void => {
      nowMs += ms;
    },
  };
}

/**
 * The breaker fields that existed before the path dimension, for the no-op
 * proof. Picked explicitly rather than deep-equalled whole, so the proof reads
 * as a statement about the pre-existing contract and runs unchanged against the
 * source that predates the new fields.
 *
 * @param snapshot The snapshot to reduce.
 * @returns Only the pre-existing fields.
 */
function legacyFields(snapshot: BreakerSnapshot): Omit<BreakerSnapshot, "path" | "opens"> {
  return {
    routeKey: snapshot.routeKey,
    state: snapshot.state,
    consecutiveFailures: snapshot.consecutiveFailures,
    openedAtMs: snapshot.openedAtMs,
    probesInFlight: snapshot.probesInFlight,
    failureKind: snapshot.failureKind,
    cooldownMs: snapshot.cooldownMs,
    openedByLatency: snapshot.openedByLatency,
    probeBudget: snapshot.probeBudget,
  };
}

/**
 * Wrap routes as chain legs sharing one transport.
 *
 * @param routes The legs, in chain order.
 * @param transport The transport to carry them.
 * @returns Prepared legs.
 */
function legsOf(routes: readonly ResolvedRoute[], transport: ScriptedTransport): ChainLeg[] {
  return routes.map((route) => ({ route, transport, params: {} }));
}

describe("breaker failure runs are isolated per traffic path", () => {
  it("does not advance the live route's failure run when a measurement path fails", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    shadow.onFailure(route.routeKey, "hard");

    expect(breakers.snapshot(route.routeKey).consecutiveFailures).toBe(0);
    expect(breakers.snapshotOnPath(route.routeKey, "shadow").consecutiveFailures).toBe(1);
  });

  it("does not open the live breaker after more measurement failures than its threshold", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < OVER_THRESHOLD; index += 1) {
      shadow.onFailure(route.routeKey, "hard");
    }

    expect(breakers.stateOf(route.routeKey)).toBe("closed");
    expect(breakers.allows(route.routeKey)).toBe(true);
    expect(breakers.snapshot(route.routeKey).consecutiveFailures).toBe(0);
    expect(breakers.snapshotOnPath(route.routeKey, "shadow").state).toBe("open");
  });

  it("refuses a measurement attempt while the live breaker is open", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    expect(breakers.stateOf(route.routeKey)).toBe("open");

    const shadow = breakers.forPath("shadow");
    expect(shadow.allows(route.routeKey)).toBe(false);
    expect(shadow.stateOf(route.routeKey)).toBe("open");
    expect(shadow.refusalReason(route.routeKey)).toBe("circuit breaker is open on the live path");
  });

  it("refuses a measurement attempt while the live breaker is half-open", () => {
    const { breakers, advance } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    advance(BREAKER.cooldown_ms);

    // A live call WOULD be admitted here: the half-open probe budget is what
    // decides whether live traffic may resume, and it is not spent on an answer
    // nobody reads.
    expect(breakers.allows(route.routeKey)).toBe(true);
    expect(breakers.stateOf(route.routeKey)).toBe("half-open");

    const shadow = breakers.forPath("shadow");
    expect(shadow.allows(route.routeKey)).toBe(false);
    expect(shadow.refusalReason(route.routeKey)).toBe(
      "circuit breaker is half-open on the live path",
    );
  });

  it("still refuses a measurement attempt once the measurement run has itself opened", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      shadow.onFailure(route.routeKey, "hard");
    }

    expect(breakers.stateOf(route.routeKey)).toBe("closed");
    expect(shadow.allows(route.routeKey)).toBe(false);
    expect(shadow.refusalReason(route.routeKey)).toBe("circuit breaker is open on the shadow path");
  });

  it("returns the live registry itself for the live path, so live admission cannot drift", () => {
    const { breakers } = registryWithClock();
    expect(breakers.forPath(LIVE_BREAKER_PATH)).toBe(breakers);
  });
});

describe("a breaker open is attributable to the path whose failures drove it", () => {
  it("names the path on every run and counts that path's opens", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });

    for (let index = 0; index < OVER_THRESHOLD; index += 1) {
      breakers.forPath("shadow").onFailure(route.routeKey, "hard");
    }
    breakers.onFailure(route.routeKey, "capacity");

    const all = breakers.snapshotAll();
    expect(all).toHaveLength(2);
    expect(all.map((snapshot) => snapshot.routeKey)).toEqual([route.routeKey, route.routeKey]);
    expect(all.map((snapshot) => snapshot.path)).toEqual(["live", "shadow"]);
    expect(all.map((snapshot) => snapshot.opens)).toEqual([0, 1]);
    expect(all.map((snapshot) => snapshot.state)).toEqual(["closed", "open"]);
    expect(all.map((snapshot) => snapshot.consecutiveFailures)).toEqual([1, OVER_THRESHOLD]);
  });

  it("keeps a path's open count after a success has discarded its failure run", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      shadow.onFailure(route.routeKey, "hard");
    }
    shadow.onSuccess(route.routeKey);

    const snapshot = breakers.snapshotOnPath(route.routeKey, "shadow");
    expect(snapshot.state).toBe("closed");
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.opens).toBe(1);
  });
});

describe("the chain charges each call's failures to its own path", () => {
  it("walks a measurement call's chain without charging the live route", async () => {
    const { breakers } = registryWithClock();
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    const transport = new ScriptedTransport("gateway", () => fails(new Error("provider down")));

    for (let index = 0; index < OVER_THRESHOLD; index += 1) {
      await rejection(
        executeChain<string>(ALIAS, {
          legs: legsOf([primary, secondary], transport),
          content: "prompt",
          responseFormat: "text",
          breakers,
          breakerPath: "shadow",
        }),
        ChainExhaustedError,
      );
    }

    expect(breakers.stateOf(primary.routeKey)).toBe("closed");
    expect(breakers.snapshot(primary.routeKey).consecutiveFailures).toBe(0);
    expect(breakers.snapshotOnPath(primary.routeKey, "shadow").state).toBe("open");
  });

  it("refuses every leg of a measurement call while the live routes are open", async () => {
    const { breakers } = registryWithClock();
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    const transport = new ScriptedTransport("gateway", () =>
      answers("should never be reached", usageFor(primary)),
    );

    for (const route of [primary, secondary]) {
      for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
        breakers.onFailure(route.routeKey, "hard");
      }
    }

    const error = await rejection(
      executeChain<string>(ALIAS, {
        legs: legsOf([primary, secondary], transport),
        content: "prompt",
        responseFormat: "text",
        breakers,
        breakerPath: "shadow",
      }),
      ChainExhaustedError,
    );

    expect(transport.calls).toHaveLength(0);
    expect(error.attempts.map((attempt) => attempt.outcome)).toEqual([
      "breaker-open",
      "breaker-open",
    ]);
    expect(error.attempts.map((attempt) => attempt.reason)).toEqual([
      "circuit breaker is open on the live path",
      "circuit breaker is open on the live path",
    ]);
  });
});

describe("the live partition is unchanged", () => {
  it("records a live call's attempts exactly as it did before the path dimension", async () => {
    const { breakers } = registryWithClock();
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? fails(new Error("provider down"))
        : answers("secondary answer", usageFor(call.route, { completionTokens: 7 })),
    );

    const outcome = await executeChain<string>(ALIAS, {
      legs: legsOf([primary, secondary], transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
    });

    expect(outcome.servedBy.routeKey).toBe(secondary.routeKey);
    const shape = outcome.attempts.map(
      (attempt: AliasAttemptRecord): Pick<AliasAttemptRecord,
        "routeKey" | "role" | "outcome" | "failureClass" | "reason"
      > => ({
        routeKey: attempt.routeKey,
        role: attempt.role,
        outcome: attempt.outcome,
        failureClass: attempt.failureClass,
        reason: attempt.reason,
      }),
    );
    expect(shape).toEqual([
      {
        routeKey: primary.routeKey,
        role: "primary",
        outcome: "error",
        failureClass: "provider_error",
        reason: "provider down",
      },
      {
        routeKey: secondary.routeKey,
        role: "secondary",
        outcome: "ok",
        failureClass: undefined,
        reason: undefined,
      },
    ]);
    expect(legacyFields(breakers.snapshot(primary.routeKey))).toEqual({
      routeKey: primary.routeKey,
      state: "closed",
      consecutiveFailures: 1,
      openedAtMs: null,
      probesInFlight: 0,
      failureKind: "hard",
      cooldownMs: BREAKER.cooldown_ms,
      openedByLatency: false,
      probeBudget: BREAKER.half_open_probes,
    });
  });

  it("still opens the live breaker on the live threshold, with the same reason text", async () => {
    const { breakers } = registryWithClock();
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const transport = new ScriptedTransport("gateway", () => fails(new Error("provider down")));

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      await rejection(
        executeChain<string>(ALIAS, {
          legs: legsOf([primary], transport),
          content: "prompt",
          responseFormat: "text",
          breakers,
        }),
        ChainExhaustedError,
      );
    }

    expect(legacyFields(breakers.snapshot(primary.routeKey))).toEqual({
      routeKey: primary.routeKey,
      state: "open",
      consecutiveFailures: BREAKER.failure_threshold,
      openedAtMs: T0,
      probesInFlight: 0,
      failureKind: "hard",
      cooldownMs: BREAKER.cooldown_ms,
      openedByLatency: false,
      probeBudget: BREAKER.half_open_probes,
    });

    const error = await rejection(
      executeChain<string>(ALIAS, {
        legs: legsOf([primary], transport),
        content: "prompt",
        responseFormat: "text",
        breakers,
      }),
      ChainExhaustedError,
    );
    expect(error.attempts.map((attempt) => attempt.outcome)).toEqual(["breaker-open"]);
    expect(error.attempts[0].reason).toBe("circuit breaker is open");
    expect(transport.calls).toHaveLength(BREAKER.failure_threshold);
  });
});
