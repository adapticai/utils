/**
 * What the fallback chain does with an attempt that ends while it is still
 * queued for a rate token: a characterisation.
 *
 * The chain hands each attempt's signal to the provider guard, and the guard
 * hears it in its concurrency queue only. The rate queue does not hear it
 * unless a caller asks, and the chain does not ask. So an attempt whose budget
 * runs out, whose caller cancels, or which loses to a same-model attempt while
 * it is queued for a token stays queued. It is granted the token it was
 * waiting for when that token accrues, and only then is it refused, at the
 * concurrency gate, as a caller that has gone.
 *
 * These tests record that behaviour as it is: when each attempt settles, what
 * its record says, and what the bucket holds afterwards. They are not a
 * statement that it is right. The comment in the attempt runner says such an
 * attempt leaves the queue at once, and for the rate queue it does not. They
 * exist so that a change to the guard which altered any of it for the chain
 * would be seen, and so that a change made on purpose starts from a pinned
 * fact.
 *
 * @module __tests__/llm/client/rate-queue-budget
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import { ChainExhaustedError, executeChain } from "../../../llm/fallback-chain";
import type { ChainLeg } from "../../../llm/fallback-chain";
import { HedgeLoserError, classify, startAttempt } from "../../../llm/leg-attempt";
import { RateGuardTimeoutError, guardSnapshots, limitsFor, resetProviderGuards, withProviderGuards } from "../../../llm/rate-guard";
import { routeTable } from "../../../llm/route-table";
import type { ResolvedRoute } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { TEST_LEG_TIMEOUT_MS, makeRoute } from "./support/routes";
import { ScriptedTransport, answers, usageFor } from "./support/transports";

/** The alias the constructed chain stands in for. */
const ALIAS = "llm.extract";

/** The provider of the first leg: the one with the slowest refill in the limits config. */
const PACED_PROVIDER = "groq";

/** A provider with no entry in the limits config, so its guard starts with a full bucket. */
const FREE_PROVIDER = "provider-with-a-full-bucket";

/** Milliseconds in a minute, for turning a per-minute limit into a refill interval. */
const MS_PER_MINUTE = 60_000;

/** When the next rate token accrues on the paced provider's drained bucket. */
const TOKEN_ARRIVES_MS = MS_PER_MINUTE / limitsFor(PACED_PROVIDER).requests_per_minute;

/** When, short of its budget, an attempt is cancelled by its caller or by the chain. */
const CANCELLED_AT_MS = TEST_LEG_TIMEOUT_MS / 2;

/** One millisecond, the smallest step that can cross a timing boundary. */
const ONE_MS = 1;

/** What the concurrency gate says of a caller that had gone by the time it was reached. */
const REFUSED_AT_THE_GATE =
  `client-side concurrency guard for provider "${PACED_PROVIDER}" was left by its caller before it could admit ` +
  `the call (wait budget ${TEST_LEG_TIMEOUT_MS} ms). ` +
  "The provider was never contacted, so this says nothing about its health.";

/**
 * Spend every token the paced provider's bucket holds, in one instant.
 *
 * @returns When the bucket is empty.
 */
async function drainPacedBucket(): Promise<void> {
  const tokens = limitsFor(PACED_PROVIDER).requests_per_minute;
  for (let token = 0; token < tokens; token += 1) {
    await withProviderGuards(PACED_PROVIDER, () => Promise.resolve());
  }
}

/**
 * The paced provider's guard, as the rate guard reports it.
 *
 * @returns Its snapshot.
 */
function pacedGuard(): ReturnType<typeof guardSnapshots>[number] | undefined {
  return guardSnapshots().find((snapshot) => snapshot.provider === PACED_PROVIDER);
}

describe("an attempt that ends while it is queued for a rate token", () => {
  let breakers: CircuitBreakerRegistry;
  let primary: ResolvedRoute;
  let secondary: ResolvedRoute;
  let transport: ScriptedTransport;
  let legs: ChainLeg[];
  let startedAt: number;

  beforeEach(async () => {
    vi.useFakeTimers();
    resetProviderGuards();
    breakers = new CircuitBreakerRegistry(routeTable.defaults.circuit_breaker, () => Date.now());
    primary = makeRoute({ alias: ALIAS, role: "primary", providerName: PACED_PROVIDER });
    secondary = makeRoute({ alias: ALIAS, role: "secondary", providerName: FREE_PROVIDER });
    transport = new ScriptedTransport("gateway", (call) =>
      answers("secondary answer", usageFor(call.route, { completionTokens: 7 })),
    );
    legs = [primary, secondary].map((route) => ({ route, transport, params: {} }));
    // The attempt's budget ends before the next token accrues and long before
    // the guard's own wait would give up, so nothing but the token ends the wait.
    expect(TEST_LEG_TIMEOUT_MS).toBeLessThan(TOKEN_ARRIVES_MS);
    expect(TOKEN_ARRIVES_MS).toBeLessThan(limitsFor(PACED_PROVIDER).acquire_timeout_ms);
    await drainPacedBucket();
    startedAt = Date.now();
  });

  afterEach(() => {
    resetProviderGuards();
    vi.useRealTimers();
  });

  it("a leg whose budget runs out there is still unsettled at its budget, and the chain moves on only when the token arrives", async () => {
    let settledAtMs: number | undefined;
    const pending = executeChain<string>(ALIAS, {
      legs,
      content: "prompt",
      responseFormat: "text",
      breakers,
      now: () => Date.now(),
    }).finally(() => {
      settledAtMs = Date.now() - startedAt;
    });

    await vi.advanceTimersByTimeAsync(TEST_LEG_TIMEOUT_MS);
    expect(settledAtMs).toBeUndefined();
    expect(pacedGuard()?.rateQueueLength).toBe(1);
    expect(transport.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(TOKEN_ARRIVES_MS - TEST_LEG_TIMEOUT_MS - ONE_MS);
    expect(settledAtMs).toBeUndefined();
    await vi.advanceTimersByTimeAsync(ONE_MS);
    const outcome = await pending;

    expect(settledAtMs).toBe(TOKEN_ARRIVES_MS);
    expect(outcome.servedBy.routeKey).toBe(secondary.routeKey);
    expect(outcome.attempts.map((attempt) => attempt.outcome)).toEqual(["skipped", "ok"]);
    expect(outcome.attempts[0]).toMatchObject({
      routeKey: primary.routeKey,
      outcome: "skipped",
      failureClass: "rate_guard",
      durationMs: TOKEN_ARRIVES_MS,
      budgetMs: TEST_LEG_TIMEOUT_MS,
      reason: REFUSED_AT_THE_GATE,
    });
    expect(breakers.snapshot(primary.routeKey).consecutiveFailures).toBe(0);
    expect(transport.calls.map((call) => call.route.routeKey)).toEqual([secondary.routeKey]);
    // The token the leg waited for was granted to it, and is gone.
    expect(pacedGuard()).toMatchObject({ rateQueueLength: 0, availableTokens: 0, inFlight: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a call whose caller cancels there is settled when the token arrives, and the token is spent on it", async () => {
    const caller = new AbortController();
    let settledAtMs: number | undefined;
    const pending = rejection(
      executeChain<string>(ALIAS, {
        legs,
        content: "prompt",
        responseFormat: "text",
        breakers,
        callerSignal: caller.signal,
        now: () => Date.now(),
      }).finally(() => {
        settledAtMs = Date.now() - startedAt;
      }),
      ChainExhaustedError,
    );

    await vi.advanceTimersByTimeAsync(CANCELLED_AT_MS);
    caller.abort(new Error("the caller stopped waiting"));
    expect(pacedGuard()?.rateQueueLength).toBe(1);
    await vi.advanceTimersByTimeAsync(TOKEN_ARRIVES_MS - CANCELLED_AT_MS - ONE_MS);
    expect(settledAtMs).toBeUndefined();
    await vi.advanceTimersByTimeAsync(ONE_MS);
    const error = await pending;

    expect(settledAtMs).toBe(TOKEN_ARRIVES_MS);
    expect(error.attempts).toHaveLength(1);
    expect(error.attempts[0]).toMatchObject({
      routeKey: primary.routeKey,
      outcome: "skipped",
      failureClass: "caller_cancelled",
      reason: "caller cancelled",
      durationMs: TOKEN_ARRIVES_MS,
    });
    expect(breakers.snapshot(primary.routeKey).consecutiveFailures).toBe(0);
    expect(transport.calls).toHaveLength(0);
    expect(pacedGuard()).toMatchObject({ rateQueueLength: 0, availableTokens: 0, inFlight: 0 });
  });

  it("an attempt that loses to a same-model attempt there settles when the token arrives, refused at the concurrency gate", async () => {
    const lost = new HedgeLoserError(primary.routeKey);
    const handle = startAttempt<string>(
      legs[0],
      {},
      { content: "prompt", responseFormat: "text" },
      TEST_LEG_TIMEOUT_MS,
    );
    let settledAtMs: number | undefined;
    const raised = handle.promise.then(
      () => {
        throw new Error("the attempt answered; it should have been refused");
      },
      (error: unknown) => {
        settledAtMs = Date.now() - startedAt;
        return error;
      },
    );

    await vi.advanceTimersByTimeAsync(CANCELLED_AT_MS);
    handle.abort(lost);
    expect(pacedGuard()?.rateQueueLength).toBe(1);
    await vi.advanceTimersByTimeAsync(TOKEN_ARRIVES_MS - CANCELLED_AT_MS - ONE_MS);
    expect(settledAtMs).toBeUndefined();
    await vi.advanceTimersByTimeAsync(ONE_MS);
    const error = await raised;

    expect(settledAtMs).toBe(TOKEN_ARRIVES_MS);
    expect(error).toBeInstanceOf(RateGuardTimeoutError);
    expect(error).toMatchObject({ bound: "concurrency", abandoned: true, message: REFUSED_AT_THE_GATE });
    // The chain records the attempt by the reason it cancelled it for.
    expect(classify(handle.abortReason() ?? error, undefined)).toMatchObject({
      outcome: "skipped",
      failureClass: "hedge_loser",
      countsAgainstHealth: false,
    });
    expect(handle.timedOut()).toBe(true);
    expect(transport.calls).toHaveLength(0);
    expect(pacedGuard()).toMatchObject({ rateQueueLength: 0, availableTokens: 0, inFlight: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
