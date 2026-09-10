import { beforeEach, describe, expect, it } from "vitest";

import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import { executeChain } from "../../../llm/fallback-chain";
import type { ChainLeg } from "../../../llm/fallback-chain";
import { resolveChain, routeKeyFor, routeTable } from "../../../llm/route-table";
import type { LlmBreakerDefaults, ResolvedRoute } from "../../../llm/types";
import { makeRoute } from "./support/routes";
import { ScriptedTransport, answers, usageFor } from "./support/transports";

/** The breaker tuning every route inherits from the route table. */
const BREAKER: LlmBreakerDefaults = routeTable.defaults.circuit_breaker;

/** The alias these constructed legs stand in for. */
const ALIAS = "llm.extract";

/** Wall-clock origin for the injected clock; any fixed value will do. */
const CLOCK_ORIGIN_MS = 1_700_000_000_000;

/** One millisecond, used to step just past a boundary the breaker tests. */
const ONE_MS = 1;

describe("per-route circuit breaker", () => {
  let nowMs: number;
  let breakers: CircuitBreakerRegistry;

  /**
   * The injected clock.
   *
   * @returns The current fake time in milliseconds.
   */
  const now = (): number => nowMs;

  beforeEach(() => {
    nowMs = CLOCK_ORIGIN_MS;
    breakers = new CircuitBreakerRegistry(BREAKER, now);
  });

  it("opens only after the configured number of consecutive failures", () => {
    const key = routeKeyFor(ALIAS, false, "primary");

    for (let failure = 1; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(key);
      expect(breakers.stateOf(key), `opened early at failure ${failure}`).toBe("closed");
      expect(breakers.allows(key)).toBe(true);
    }

    breakers.onFailure(key);
    expect(breakers.stateOf(key)).toBe("open");
    expect(breakers.allows(key)).toBe(false);
    expect(breakers.snapshot(key).consecutiveFailures).toBe(BREAKER.failure_threshold);
  });

  it("skips an open route without spending a network round trip on it", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    for (let failure = 0; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(primary.routeKey);
    }
    expect(breakers.stateOf(primary.routeKey)).toBe("open");

    const transport = new ScriptedTransport("gateway", (call) =>
      answers(`served by ${call.route.role}`, usageFor(call.route)),
    );
    const legs: ChainLeg[] = [primary, secondary].map((route: ResolvedRoute) => ({
      route,
      transport,
      params: {},
    }));

    const outcome = await executeChain<string>(ALIAS, {
      legs,
      content: "prompt",
      responseFormat: "text",
      breakers,
      now,
    });

    expect(outcome.attempts[0].outcome).toBe("breaker-open");
    expect(outcome.servedBy.routeKey).toBe(secondary.routeKey);
    // The point of the breaker is the round trip NOT taken.
    expect(transport.routeKeys).toEqual([secondary.routeKey]);
  });

  it("half-opens after the cooldown and admits only the configured probe budget", () => {
    const key = routeKeyFor(ALIAS, false, "primary");
    for (let failure = 0; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(key);
    }

    nowMs += BREAKER.cooldown_ms - ONE_MS;
    expect(breakers.stateOf(key)).toBe("open");
    expect(breakers.allows(key)).toBe(false);

    nowMs += ONE_MS;
    expect(breakers.stateOf(key)).toBe("half-open");

    for (let probe = 0; probe < BREAKER.half_open_probes; probe += 1) {
      expect(breakers.allows(key), `probe ${probe} was refused`).toBe(true);
      breakers.onAttemptStart(key);
    }
    // Releasing the whole queue the moment a cooldown expires is how a breaker
    // turns into a synchronised retry storm against a provider still recovering.
    expect(breakers.allows(key)).toBe(false);
    expect(breakers.snapshot(key).probesInFlight).toBe(BREAKER.half_open_probes);
  });

  it("re-opens on a single half-open failure, unlike a closed route", () => {
    const halfOpen = routeKeyFor(ALIAS, false, "primary");
    for (let failure = 0; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(halfOpen);
    }
    nowMs += BREAKER.cooldown_ms;
    expect(breakers.stateOf(halfOpen)).toBe("half-open");

    breakers.onAttemptStart(halfOpen);
    breakers.onFailure(halfOpen);
    expect(breakers.stateOf(halfOpen)).toBe("open");
    expect(breakers.snapshot(halfOpen).openedAtMs).toBe(nowMs);

    // The contrast is what makes "immediately" meaningful: from closed, one
    // failure is not enough, because the probe is the test and it had not run.
    const fresh = routeKeyFor(ALIAS, false, "secondary");
    breakers.onFailure(fresh);
    expect(breakers.stateOf(fresh)).toBe("closed");
  });

  it("closes on a single success", () => {
    const key = routeKeyFor(ALIAS, false, "primary");
    for (let failure = 0; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(key);
    }
    nowMs += BREAKER.cooldown_ms;
    breakers.onAttemptStart(key);

    breakers.onSuccess(key);

    expect(breakers.stateOf(key)).toBe("closed");
    expect(breakers.allows(key)).toBe(true);
    expect(breakers.snapshot(key).consecutiveFailures).toBe(0);
    expect(breakers.snapshot(key).probesInFlight).toBe(0);
  });

  it("confines an open breaker to its own route", () => {
    const tripped = routeKeyFor(ALIAS, false, "primary");
    const untouched = routeKeyFor(ALIAS, false, "closed_incumbent");
    for (let failure = 0; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(tripped);
    }

    expect(breakers.allows(tripped)).toBe(false);
    expect(breakers.allows(untouched)).toBe(true);
    expect(breakers.stateOf(untouched)).toBe("closed");
  });

  it("keys the isolated variant separately from the shared route (PD-9)", () => {
    const shared = routeKeyFor(ALIAS, false, "primary");
    const isolated = routeKeyFor(ALIAS, true, "primary");
    expect(isolated).not.toBe(shared);
    expect(resolveChain(ALIAS, { isolated: true }).routes[0].routeKey).toBe(isolated);

    for (let failure = 0; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(shared);
    }
    expect(breakers.allows(shared)).toBe(false);
    // Isolated traffic can neither trip nor be tripped by traffic on the other
    // side of the boundary, or the boundary is only a naming convention.
    expect(breakers.allows(isolated)).toBe(true);

    breakers.onSuccess(shared);
    for (let failure = 0; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(isolated);
    }
    expect(breakers.allows(isolated)).toBe(false);
    expect(breakers.allows(shared)).toBe(true);
  });
});
