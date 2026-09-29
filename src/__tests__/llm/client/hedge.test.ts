import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import {
  ChainExhaustedError,
  LlmDeadlineExceededError,
  executeChain,
} from "../../../llm/fallback-chain";
import type { ChainExecution, ChainLeg } from "../../../llm/fallback-chain";
import type { SameModelPolicy } from "../../../llm/hedge";
import { LegLatencyTracker, estimatePromptTokens } from "../../../llm/leg-latency-tracker";
import { EQUIVALENT_SEPARATOR } from "../../../llm/route-table";
import { GatewayResponseError } from "../../../llm/transports/gateway";
import type { ResolvedRoute } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { AGGREGATOR_PROVIDER, CLOSED_PROVIDER, makeRoute } from "./support/routes";
import {
  ScriptedTransport,
  answers,
  answersAfter,
  fails,
  hangs,
  usageFor,
} from "./support/transports";
import type { LegBehaviour, ScriptedCall } from "./support/transports";

/** The alias the constructed chains stand in for. */
const ALIAS = "llm.fast";

/** The prompt every call sends, so the latency bucket is known. */
const PROMPT = "prompt";

/** A leg budget long enough that hedging, not the budget, decides the outcome. */
const LEG_BUDGET_MS = 1_000;

/** Healthy latency the tracker is warmed with. */
const HEALTHY_MS = 100;

/** Samples a cell needs before it is used. */
const MIN_SAMPLES = 5;

/** A Tier-C style whole-call deadline shorter than the leg's route budget. */
const TIER_C_DEADLINE_MS = 20_000;

/** The route budget that, unhedged, would consume the whole Tier-C deadline. */
const HOT_PATH_BUDGET_MS = 30_000;

/** HTTP status of a relayed provider outage. */
const BAD_GATEWAY = 502;

/** Breaker tuning for these tests. */
const BREAKER = {
  failure_threshold: 3,
  cooldown_ms: 60_000,
  capacity_cooldown_ms: 15_000,
  half_open_probes: 1,
} as const;

/** Same-model policy under test; the floor is zero so measured timeouts are exact. */
const POLICY: SameModelPolicy = {
  maxExtraAttempts: 1,
  hedgeQuantile: 0.9,
  timeoutQuantile: 0.99,
  kTimeout: 3,
  attemptTimeoutFloorMs: 0,
  maxAttemptShare: 0.5,
  duplicateReserve: 0.25,
};

/**
 * The same model at another provider.
 *
 * @param leg The leg it is equivalent to.
 * @param providerName The other provider.
 * @returns The equivalent's route.
 */
function equivalentOf(leg: ResolvedRoute, providerName: string): ResolvedRoute {
  return {
    ...leg,
    provider: AGGREGATOR_PROVIDER,
    providerName,
    routeKey: `${leg.routeKey}${EQUIVALENT_SEPARATOR}${providerName}`,
    modelClass: leg.modelClass ?? leg.modelId,
  };
}

/**
 * A tracker warmed with healthy samples for one route's model.
 *
 * @param route The route whose model is warmed.
 * @returns The tracker.
 */
function warmTracker(route: ResolvedRoute): LegLatencyTracker {
  const tracker = new LegLatencyTracker(
    { minSamples: MIN_SAMPLES, windowSize: 50, sampleMaxAgeMs: 600_000, promptTokenBuckets: [1_000] },
    () => Date.now(),
  );
  const tokens = estimatePromptTokens([PROMPT]);
  for (let index = 0; index < MIN_SAMPLES; index += 1) {
    tracker.record(route.providerName, route.modelId, tokens, HEALTHY_MS);
  }
  return tracker;
}

/**
 * A cold tracker, with no evidence at all.
 *
 * @returns The tracker.
 */
function coldTracker(): LegLatencyTracker {
  return new LegLatencyTracker(
    { minSamples: MIN_SAMPLES, windowSize: 50, sampleMaxAgeMs: 600_000, promptTokenBuckets: [1_000] },
    () => Date.now(),
  );
}

/**
 * Wrap routes as legs on one transport.
 *
 * @param transport The transport.
 * @param routes Each leg with its equivalents.
 * @returns Prepared legs.
 */
function legsOf(
  transport: ScriptedTransport,
  routes: readonly { route: ResolvedRoute; equivalents?: readonly ResolvedRoute[] }[],
): ChainLeg[] {
  return routes.map(({ route, equivalents }) => ({
    route,
    transport,
    params: {},
    equivalents: (equivalents ?? []).map((equivalent) => ({ route: equivalent, transport, params: {} })),
  }));
}

/**
 * Start a call.
 *
 * @param legs The legs.
 * @param breakers The breakers.
 * @param extra Execution fields to add.
 * @returns The pending outcome.
 */
function run(
  legs: readonly ChainLeg[],
  breakers: CircuitBreakerRegistry,
  extra: Partial<ChainExecution>,
): ReturnType<typeof executeChain<string>> {
  return executeChain<string>(ALIAS, {
    legs,
    content: PROMPT,
    responseFormat: "text",
    breakers,
    now: () => Date.now(),
    hedging: POLICY,
    ...extra,
  });
}

/**
 * A plan that runs each invocation's behaviour by its order.
 *
 * @param behaviours One behaviour per invocation, by index.
 * @returns The plan.
 */
function byOrder(
  behaviours: readonly ((call: ScriptedCall) => LegBehaviour)[],
): (call: ScriptedCall) => LegBehaviour {
  return (call) => (behaviours[call.index] ?? (() => hangs()))(call);
}

describe("same-model hedging", () => {
  let breakers: CircuitBreakerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    breakers = new CircuitBreakerRegistry(BREAKER, () => Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a same-model hedge after the healthy p90, and the first valid answer wins", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const transport = new ScriptedTransport(
      "gateway",
      byOrder([() => hangs(), (call) => answers("hedged answer", usageFor(call.route))]),
    );

    const startedAt = Date.now();
    const pending = run(legsOf(transport, [{ route: primary }]), breakers, {
      latency: warmTracker(primary),
      admitDuplicate: () => true,
    });

    await vi.advanceTimersByTimeAsync(HEALTHY_MS - 1);
    expect(transport.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await pending;

    expect(transport.routeKeys).toEqual([primary.routeKey, primary.routeKey]);
    expect(outcome.response.response).toBe("hedged answer");
    expect(outcome.hedged).toBe(true);
    const ok = outcome.attempts.find((attempt) => attempt.outcome === "ok");
    expect(ok?.hedged).toBe(true);
    expect(ok?.attemptIndex).toBe(1);
    expect(Date.now() - startedAt).toBe(HEALTHY_MS);
  });

  it("cancels the losing attempt through its own AbortSignal and never charges its breaker", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const transport = new ScriptedTransport(
      "gateway",
      byOrder([() => hangs(), (call) => answers("hedged answer", usageFor(call.route))]),
    );

    const pending = run(legsOf(transport, [{ route: primary }]), breakers, {
      latency: warmTracker(primary),
      admitDuplicate: () => true,
    });
    await vi.advanceTimersByTimeAsync(HEALTHY_MS);
    const outcome = await pending;

    const loserSignal = transport.calls[0].signal;
    expect(loserSignal.aborted).toBe(true);
    expect(loserSignal.reason).toBeInstanceOf(Error);
    expect((loserSignal.reason as Error).name).toBe("HedgeLoserError");
    const loser = outcome.attempts.find((attempt) => attempt.attemptIndex === 0);
    expect(loser?.outcome).toBe("skipped");
    expect(loser?.reason).toContain("answered first");
    expect(breakers.snapshot(primary.routeKey).consecutiveFailures).toBe(0);
    // The loser's late rejection must not add a record after the call returned.
    const recorded = outcome.attempts.length;
    await vi.advanceTimersByTimeAsync(LEG_BUDGET_MS);
    expect(outcome.attempts).toHaveLength(recorded);
  });

  it("charges the breaker once when a leg's attempts all reach its end together", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const transport = new ScriptedTransport("gateway", () => hangs());

    const pending = rejection(
      run(legsOf(transport, [{ route: primary }]), breakers, {
        latency: warmTracker(primary),
        admitDuplicate: () => true,
        // A measured timeout at the leg budget cannot fire first, so both
        // attempts are still running when the leg ends.
        hedging: { ...POLICY, kTimeout: LEG_BUDGET_MS / HEALTHY_MS },
      }),
      ChainExhaustedError,
    );
    await vi.advanceTimersByTimeAsync(LEG_BUDGET_MS);
    const error = await pending;

    expect(transport.calls).toHaveLength(2);
    expect(error.attempts.every((attempt) => attempt.reason?.includes("budget") === true)).toBe(true);
    expect(error.attempts.map((attempt) => attempt.outcome)).toEqual(["timeout", "timeout"]);
    // One leg, one verdict: hedging must not turn a slow leg into a faster trip.
    expect(breakers.snapshot(primary.routeKey).consecutiveFailures).toBe(1);
  });

  it("does not duplicate onto a provider without headroom", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const transport = new ScriptedTransport("gateway", () => hangs());

    const pending = rejection(
      run(legsOf(transport, [{ route: primary }]), breakers, {
        latency: warmTracker(primary),
        admitDuplicate: () => false,
      }),
      ChainExhaustedError,
    );
    await vi.advanceTimersByTimeAsync(LEG_BUDGET_MS);
    await pending;

    expect(transport.calls).toHaveLength(1);
  });

  it("replaces an attempt past its measured timeout only when a same-model alternative can take over", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const measuredMs = POLICY.kTimeout * HEALTHY_MS;
    const transport = new ScriptedTransport(
      "gateway",
      byOrder([() => hangs(), (call) => answers("replacement", usageFor(call.route))]),
    );
    // Headroom appears only after the hedge point has passed, so the only
    // mechanism that can start the replacement is the measured timeout.
    const startedAt = Date.now();
    const admitDuplicate = (): boolean => Date.now() - startedAt >= measuredMs;

    const pending = run(legsOf(transport, [{ route: primary }]), breakers, {
      latency: warmTracker(primary),
      admitDuplicate,
    });
    await vi.advanceTimersByTimeAsync(measuredMs);
    const outcome = await pending;

    expect(outcome.response.response).toBe("replacement");
    const superseded = outcome.attempts.find((attempt) => attempt.attemptIndex === 0);
    expect(superseded?.outcome).toBe("timeout");
    expect(superseded?.reason).toContain("superseded");
    expect(superseded?.durationMs).toBe(measuredMs);
    // The measured timeout is the chain's own impatience, not provider ill-health.
    expect(breakers.snapshot(primary.routeKey).consecutiveFailures).toBe(0);
  });

  it("lets a slow attempt run to the leg budget when no same-model alternative exists", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const slowMs = POLICY.kTimeout * HEALTHY_MS * 2;
    const transport = new ScriptedTransport("gateway", (call) =>
      answersAfter(slowMs, "slow but right", usageFor(call.route)),
    );

    const pending = run(legsOf(transport, [{ route: primary }]), breakers, {
      latency: warmTracker(primary),
      admitDuplicate: () => false,
    });
    await vi.advanceTimersByTimeAsync(slowMs);
    const outcome = await pending;

    expect(outcome.response.response).toBe("slow but right");
    expect(transport.calls).toHaveLength(1);
    expect(outcome.attempts.map((attempt) => attempt.outcome)).toEqual(["ok"]);
  });
});

describe("deadline reservation for a same-model equivalent", () => {
  let breakers: CircuitBreakerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    breakers = new CircuitBreakerRegistry(BREAKER, () => Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reaches a same-model equivalent within a 20s deadline behind a slow 30s primary", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const equivalent = equivalentOf(primary, "second-host");
    const secondary = makeRoute({
      alias: ALIAS,
      role: "secondary",
      provider: CLOSED_PROVIDER,
      timeoutMs: HOT_PATH_BUDGET_MS,
    });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.routeKey === equivalent.routeKey
        ? answers("same model, other host", usageFor(call.route))
        : hangs(),
    );

    const pending = run(
      legsOf(transport, [{ route: primary, equivalents: [equivalent] }, { route: secondary }]),
      breakers,
      { latency: coldTracker(), deadlineAtMs: Date.now() + TIER_C_DEADLINE_MS },
    );
    await vi.advanceTimersByTimeAsync(TIER_C_DEADLINE_MS * POLICY.maxAttemptShare);
    const outcome = await pending;

    expect(outcome.servedBy.routeKey).toBe(equivalent.routeKey);
    expect(outcome.response.response).toBe("same model, other host");
    expect(outcome.modelClassRelation).not.toBe("different");
    expect(transport.routeKeys).not.toContain(secondary.routeKey);
  });

  it("fails over to a same-model equivalent at once when the primary host errors", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const equivalent = equivalentOf(primary, "second-host");
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.routeKey === equivalent.routeKey
        ? answers("same model, other host", usageFor(call.route))
        : fails(new GatewayResponseError(BAD_GATEWAY, "upstream down")),
    );

    const startedAt = Date.now();
    const outcome = await run(
      legsOf(transport, [{ route: primary, equivalents: [equivalent] }]),
      breakers,
      { latency: coldTracker() },
    );

    expect(outcome.servedBy.routeKey).toBe(equivalent.routeKey);
    expect(Date.now() - startedAt).toBe(0);
    expect(outcome.hedged).toBe(true);
  });
});

describe("cross-model policy", () => {
  let breakers: CircuitBreakerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    breakers = new CircuitBreakerRegistry(BREAKER, () => Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never runs a different-model leg under deny, and says so in the error", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary", provider: CLOSED_PROVIDER });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? fails(new GatewayResponseError(BAD_GATEWAY, "upstream down"))
        : answers("different model", usageFor(call.route)),
    );

    const error = await rejection(
      run(legsOf(transport, [{ route: primary }, { route: secondary }]), breakers, {
        crossModelPolicy: "deny",
      }),
      ChainExhaustedError,
    );

    expect(error.reason).toBe("cross_model_denied");
    expect(transport.routeKeys).toEqual([primary.routeKey]);
    const denied = error.attempts.find((attempt) => attempt.routeKey === secondary.routeKey);
    expect(denied?.outcome).toBe("skipped");
    expect(denied?.modelClassRelation).toBe("different");
  });

  it("runs the different-model leg under the default and records the relation", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary", provider: CLOSED_PROVIDER });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? fails(new GatewayResponseError(BAD_GATEWAY, "upstream down"))
        : answers("different model", usageFor(call.route)),
    );

    const outcome = await run(legsOf(transport, [{ route: primary }, { route: secondary }]), breakers, {});

    expect(outcome.servedBy.routeKey).toBe(secondary.routeKey);
    expect(outcome.modelClassRelation).toBe("different");
  });
});

describe("typed deadline outcome", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws LlmDeadlineExceededError, still a ChainExhaustedError, when the deadline runs out", async () => {
    const breakers = new CircuitBreakerRegistry(BREAKER, () => Date.now());
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary", timeoutMs: LEG_BUDGET_MS });
    const transport = new ScriptedTransport("gateway", () => hangs());
    const deadlineMs = LEG_BUDGET_MS / 2;

    const pending = rejection(
      run(legsOf(transport, [{ route: primary }, { route: secondary }]), breakers, {
        deadlineAtMs: Date.now() + deadlineMs,
      }),
      LlmDeadlineExceededError,
    );
    await vi.advanceTimersByTimeAsync(deadlineMs);
    const error = await pending;

    expect(error).toBeInstanceOf(ChainExhaustedError);
    expect(error.kind).toBe("deadline_exceeded");
    expect(error.reason).toBe("deadline_exceeded");
    expect(error.deadlineMs).toBe(deadlineMs);
    expect(error.lastModelClass).toBe(primary.modelId);
    expect(error.attempts.map((attempt) => attempt.outcome)).toEqual(["timeout", "skipped"]);
  });

  it("keeps plain exhaustion when every leg failed inside the deadline", async () => {
    const breakers = new CircuitBreakerRegistry(BREAKER, () => Date.now());
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const transport = new ScriptedTransport("gateway", () =>
      fails(new GatewayResponseError(BAD_GATEWAY, "upstream down")),
    );

    const error = await rejection(
      run(legsOf(transport, [{ route: primary }]), breakers, {
        deadlineAtMs: Date.now() + LEG_BUDGET_MS,
      }),
      ChainExhaustedError,
    );

    expect(error).not.toBeInstanceOf(LlmDeadlineExceededError);
    expect(error.reason).toBe("exhausted");
  });
});
