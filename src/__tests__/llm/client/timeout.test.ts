import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import { ChainExhaustedError, executeChain } from "../../../llm/fallback-chain";
import type { ChainLeg } from "../../../llm/fallback-chain";
import { routeTable } from "../../../llm/route-table";
import type { AliasAttemptRecord, ResolvedRoute } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { TEST_LEG_TIMEOUT_MS, makeRoute } from "./support/routes";
import { ScriptedTransport, answers, hangs, usageFor } from "./support/transports";

/** The alias these constructed chains stand in for. */
const ALIAS = "llm.extract";

/** Legs in the constructed chain, so the bound on total wait has something to sum. */
const LEG_COUNT = 2;

/** One millisecond, the smallest step that can cross a timing boundary. */
const ONE_MS = 1;

/** A margin short of one leg's budget, used to prove the wait has not yet elapsed. */
const JUST_UNDER_MS = TEST_LEG_TIMEOUT_MS - ONE_MS;

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

describe("per-leg hard timeouts", () => {
  let breakers: CircuitBreakerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    breakers = new CircuitBreakerRegistry(
      routeTable.defaults.circuit_breaker,
      () => Date.now(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("abandons a leg that exceeds its budget and advances the chain", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? hangs()
        : answers("secondary answer", usageFor(call.route, { completionTokens: 7 })),
    );

    const pending = executeChain<string>(ALIAS, {
      legs: legsOf([primary, secondary], transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
      now: () => Date.now(),
    });

    await vi.advanceTimersByTimeAsync(TEST_LEG_TIMEOUT_MS);
    const outcome = await pending;

    expect(outcome.servedBy.routeKey).toBe(secondary.routeKey);
    expect(outcome.response.response).toBe("secondary answer");
    expect(outcome.attempts.map((attempt) => attempt.outcome)).toEqual(["timeout", "ok"]);
    expect(outcome.attempts[0].durationMs).toBe(TEST_LEG_TIMEOUT_MS);
    expect(outcome.attempts[0].reason).toContain(`${TEST_LEG_TIMEOUT_MS} ms budget`);
  });

  it("bounds the caller's total wait by the sum of the leg budgets", async () => {
    const routes = [
      makeRoute({ alias: ALIAS, role: "primary" }),
      makeRoute({ alias: ALIAS, role: "secondary" }),
    ];
    const transport = new ScriptedTransport("gateway", () => hangs());
    const startedAt = Date.now();

    let settled = false;
    const walk = executeChain<string>(ALIAS, {
      legs: legsOf(routes, transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
      now: () => Date.now(),
    });
    const pending = rejection(
      walk.finally(() => {
        settled = true;
      }),
      ChainExhaustedError,
    );

    // One full leg budget plus a margin: the first leg must have been abandoned
    // and the second must still be in flight, or the chain is not spending the
    // budget it declared.
    await vi.advanceTimersByTimeAsync(TEST_LEG_TIMEOUT_MS + JUST_UNDER_MS);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(ONE_MS);
    const error = await pending;

    expect(settled).toBe(true);
    expect(Date.now() - startedAt).toBe(TEST_LEG_TIMEOUT_MS * LEG_COUNT);
    expect(
      error.attempts.map((attempt: AliasAttemptRecord) => attempt.outcome),
    ).toEqual(["timeout", "timeout"]);
  });

  it("delivers the abort to the transport rather than merely giving up on it", async () => {
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const transport = new ScriptedTransport("gateway", () => hangs());

    const pending = executeChain<string>(ALIAS, {
      legs: legsOf([route], transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
      now: () => Date.now(),
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(TEST_LEG_TIMEOUT_MS);
    await pending;

    expect(transport.calls).toHaveLength(1);
    const observed = transport.calls[0].signal;
    expect(observed.aborted).toBe(true);
    expect(observed.reason).toBeInstanceOf(Error);
    if (observed.reason instanceof Error) {
      expect(observed.reason.message).toContain(route.routeKey);
    }
  });

  it("stops the walk on the caller's own abort without blaming the route", async () => {
    const routes = [
      makeRoute({ alias: ALIAS, role: "primary" }),
      makeRoute({ alias: ALIAS, role: "secondary" }),
    ];
    const transport = new ScriptedTransport("gateway", () => hangs());
    const caller = new AbortController();

    const pending = executeChain<string>(ALIAS, {
      legs: legsOf(routes, transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
      callerSignal: caller.signal,
      now: () => Date.now(),
    });
    const pendingError = rejection(pending, ChainExhaustedError);

    // Let the first leg reach the transport, then cancel while it is in flight.
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.calls).toHaveLength(1);
    caller.abort();
    const error = await pendingError;

    const { attempts } = error;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe("skipped");
    expect(attempts[0].reason).toBe("caller cancelled");

    // A cancelled request says nothing about the provider's health, so the
    // breaker must not have moved: otherwise a burst of user cancellations
    // would open a route that never failed.
    const snapshot = breakers.snapshot(routes[0].routeKey);
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.state).toBe("closed");
    expect(transport.calls).toHaveLength(1);
  });

  it("leaves no timer behind on the success path", async () => {
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const transport = new ScriptedTransport("gateway", (call) =>
      answers("done", usageFor(call.route)),
    );
    const before = vi.getTimerCount();

    await executeChain<string>(ALIAS, {
      legs: legsOf([route], transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
      now: () => Date.now(),
    });

    // A process that leaked one timer per LLM call would accumulate them at
    // exactly the rate it does useful work.
    expect(vi.getTimerCount()).toBe(before);
  });

  it("leaves no timer behind after a timeout or a caller abort", async () => {
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const transport = new ScriptedTransport("gateway", () => hangs());
    const before = vi.getTimerCount();

    const timedOut = executeChain<string>(ALIAS, {
      legs: legsOf([route], transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
      now: () => Date.now(),
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(TEST_LEG_TIMEOUT_MS);
    await timedOut;
    expect(vi.getTimerCount()).toBe(before);

    const caller = new AbortController();
    const cancelled = executeChain<string>(ALIAS, {
      legs: legsOf([route], transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
      callerSignal: caller.signal,
      now: () => Date.now(),
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    await cancelled;
    expect(vi.getTimerCount()).toBe(before);
  });
});
