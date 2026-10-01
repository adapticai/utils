import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callLLMByAlias, configureLlmClient, llmLatencyTracker } from "../../../llm/alias-client";
import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import {
  ChainExhaustedError,
  LlmDeadlineExceededError,
  executeChain,
} from "../../../llm/fallback-chain";
import type { ChainExecution, ChainLeg } from "../../../llm/fallback-chain";
import { sameModelPolicyFrom } from "../../../llm/hedge";
import type { SameModelPolicy } from "../../../llm/hedge";
import { LegLatencyTracker, estimatePromptTokens } from "../../../llm/leg-latency-tracker";
import { resetProviderGuards } from "../../../llm/rate-guard";
import { EQUIVALENT_SEPARATOR, resolveChain, routeTable } from "../../../llm/route-table";
import { GatewayResponseError, GatewayUnreachableError } from "../../../llm/transports/gateway";
import type {
  AliasAttemptRecord,
  LlmHedgeRefusals,
  LlmHedgingDefaults,
  LlmTransport,
  LlmTransportResponse,
  ResolvedRoute,
} from "../../../llm/types";
import { rejection } from "./support/rejections";
import { AGGREGATOR_PROVIDER, CLOSED_PROVIDER, makeRoute } from "./support/routes";
import {
  ScriptedTransport,
  answers,
  answersAfter,
  fails,
  failsAfter,
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
  transport: LlmTransport,
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

/**
 * The route table's own hedging defaults, so the floor under test is the
 * deployed one rather than a value chosen for the test.
 *
 * @returns The defaults.
 */
function deployedHedging(): LlmHedgingDefaults {
  const hedging = routeTable.defaults.hedging;
  if (hedging === undefined) {
    throw new Error("the route table configures no hedging, so no attempt floor applies");
  }
  return hedging;
}

/** The table's hedging defaults. */
const DEPLOYED_HEDGING = deployedHedging();

/** The deployed same-model policy, attempt floor included. */
const DEPLOYED_POLICY: SameModelPolicy = sameModelPolicyFrom(DEPLOYED_HEDGING);

/** The deployed attempt floor. */
const FLOOR_MS = DEPLOYED_POLICY.attemptTimeoutFloorMs;

/**
 * A prompt the size of the per-symbol decision call (about 11.5k tokens at the
 * tracker's estimate), so samples and lookups share its prompt-size bucket.
 */
const DECISION_PROMPT = "x".repeat(46_000);

/** The healthy p90 measured on the decision call: 1.5 s short of its 30 s leg. */
const LATE_P90_MS = 28_500;

/** A healthy p90 that leaves a duplicate more than the floor. */
const HEALTHY_P90_MS = 10_000;

/** How long the duplicate in the no-op partition takes to answer. */
const DUPLICATE_ANSWER_MS = 6_000;

/** When a measured attempt timeout fires with less than the floor left. */
const LATE_SUPERSEDE_MS = 27_000;

/** When the original attempt that was not superseded answers. */
const ORIGINAL_ANSWERS_MS = 29_000;

/** When a fast failure arrives with less than the floor left. */
const LATE_FAILURE_MS = 27_000;

/** No attempt refused on any leg. */
const NO_REFUSALS: LlmHedgeRefusals = { primary: 0, secondary: 0, closed_incumbent: 0 };

/**
 * The attempt records of the no-op partition, captured by running the same
 * scenario against the executor before the attempt floor existed. A duplicate
 * with at least the floor to run must be recorded exactly as it was then.
 */
const PRE_FLOOR_NOOP_RECORDS: readonly AliasAttemptRecord[] = [
  {
    routeKey: "llm.fast#primary",
    role: "primary",
    provider: "Test Open Host",
    modelId: "model-primary",
    durationMs: 6000,
    budgetMs: 20000,
    outcome: "ok",
    servedModel: null,
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      provider: "Test Open Host",
      model: "model-primary",
      cost: 0,
    },
    servedProvider: "Test Open Host",
    modelClass: "model-primary",
    modelClassRelation: "unknown",
    hedged: true,
    attemptIndex: 1,
  },
  {
    routeKey: "llm.fast#primary",
    role: "primary",
    provider: "Test Open Host",
    modelId: "model-primary",
    durationMs: 16000,
    budgetMs: 30000,
    outcome: "skipped",
    reason: "route llm.fast#primary was cancelled: a same-model attempt answered first",
    servedProvider: "Test Open Host",
    modelClass: "model-primary",
    modelClassRelation: "same",
    hedged: false,
    attemptIndex: 0,
  },
];

/**
 * Record healthy samples for one route's model at the decision prompt's size,
 * using the table's own window sizing and prompt-size buckets.
 *
 * @param tracker The tracker to warm.
 * @param route The route whose model is warmed.
 * @param sampleMs The healthy latency every sample records.
 * @returns The same tracker.
 */
function warmDecisionCell(
  tracker: LegLatencyTracker,
  route: ResolvedRoute,
  sampleMs: number,
): LegLatencyTracker {
  const tokens = estimatePromptTokens([DECISION_PROMPT]);
  for (let index = 0; index < DEPLOYED_HEDGING.min_samples; index += 1) {
    tracker.record(route.providerName, route.modelId, tokens, sampleMs);
  }
  return tracker;
}

/**
 * A tracker sized as deployed, warmed for one route at the decision prompt's size.
 *
 * @param route The route whose model is warmed.
 * @param sampleMs The healthy latency every sample records.
 * @returns The tracker.
 */
function decisionTracker(route: ResolvedRoute, sampleMs: number): LegLatencyTracker {
  const tracker = new LegLatencyTracker(
    {
      minSamples: DEPLOYED_HEDGING.min_samples,
      windowSize: DEPLOYED_HEDGING.window_size,
      sampleMaxAgeMs: DEPLOYED_HEDGING.sample_max_age_ms,
      promptTokenBuckets: DEPLOYED_HEDGING.prompt_token_buckets,
    },
    () => Date.now(),
  );
  return warmDecisionCell(tracker, route, sampleMs);
}

/**
 * A transport whose attempts settle on their own schedule, whatever their
 * signal says — as a real connection can, after the chain has given up on it.
 * It holds an attempt open across instants a double that honours its signal
 * never reaches.
 */
class SettlesOnItsOwnTransport implements LlmTransport {
  public readonly name = "settles-on-its-own";

  /** How many attempts were dispatched. */
  public calls = 0;

  private readonly failAfterMs: number;

  /**
   * @param failAfterMs When each attempt fails, from its start.
   */
  public constructor(failAfterMs: number) {
    this.failAfterMs = failAfterMs;
  }

  /**
   * Dispatch one attempt, ignoring its signal.
   *
   * @returns An answer that never comes: the attempt fails on its own schedule.
   */
  public execute<T>(): Promise<LlmTransportResponse<T>> {
    this.calls += 1;
    return new Promise<LlmTransportResponse<T>>((_resolve, reject) => {
      setTimeout(() => reject(new Error("upstream closed the connection")), this.failAfterMs);
    });
  }
}

describe("attempt floor: no same-model attempt starts that cannot answer", () => {
  let breakers: CircuitBreakerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    breakers = new CircuitBreakerRegistry(BREAKER, () => Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the decision prompt into the table's 8k-32k token bucket", () => {
    const tracker = decisionTracker(makeRoute({ alias: ALIAS }), HEALTHY_P90_MS);
    const tokens = estimatePromptTokens([DECISION_PROMPT]);
    expect(tokens).toBeGreaterThanOrEqual(8_000);
    expect(tokens).toBeLessThan(32_000);
    expect(tracker.bucketOf(tokens)).toBe(tracker.bucketOf(8_000));
    expect(FLOOR_MS).toBe(5_000);
  });

  it("starts no duplicate at a hedge point that leaves less than the floor, and counts the refusal", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const transport = new ScriptedTransport("gateway", () => hangs());

    const pending = rejection(
      run(legsOf(transport, [{ route: primary }]), breakers, {
        content: DECISION_PROMPT,
        hedging: DEPLOYED_POLICY,
        latency: decisionTracker(primary, LATE_P90_MS),
        admitDuplicate: () => true,
      }),
      ChainExhaustedError,
    );
    await vi.advanceTimersByTimeAsync(LATE_P90_MS);
    // The hedge point has passed with 1.5 s of the leg left, and nothing started.
    expect(transport.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(HOT_PATH_BUDGET_MS - LATE_P90_MS);
    const error = await pending;

    expect(transport.calls).toHaveLength(1);
    expect(error.attempts.map((attempt) => attempt.outcome)).toEqual(["timeout"]);
    expect(error.hedgesRefusedBelowFloor).toEqual({ ...NO_REFUSALS, primary: 1 });
  });

  it("carries the refusal on the answer of a chain that a later leg served", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const secondary = makeRoute({
      alias: ALIAS,
      role: "secondary",
      provider: CLOSED_PROVIDER,
      timeoutMs: HOT_PATH_BUDGET_MS,
    });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary" ? hangs() : answers("secondary answer", usageFor(call.route)),
    );

    const pending = run(legsOf(transport, [{ route: primary }, { route: secondary }]), breakers, {
      content: DECISION_PROMPT,
      hedging: DEPLOYED_POLICY,
      latency: decisionTracker(primary, LATE_P90_MS),
      admitDuplicate: () => true,
    });
    await vi.advanceTimersByTimeAsync(HOT_PATH_BUDGET_MS);
    const outcome = await pending;

    expect(transport.routeKeys).toEqual([primary.routeKey, secondary.routeKey]);
    expect(outcome.servedBy.routeKey).toBe(secondary.routeKey);
    expect(outcome.hedgesRefusedBelowFloor).toEqual({ ...NO_REFUSALS, primary: 1 });
  });

  it("files a refusal under the role of the leg it belonged to", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary", timeoutMs: HOT_PATH_BUDGET_MS });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? fails(new GatewayResponseError(BAD_GATEWAY, "upstream down"))
        : hangs(),
    );

    const pending = rejection(
      run(legsOf(transport, [{ route: primary }, { route: secondary }]), breakers, {
        content: DECISION_PROMPT,
        hedging: DEPLOYED_POLICY,
        latency: decisionTracker(secondary, LATE_P90_MS),
        admitDuplicate: () => true,
      }),
      ChainExhaustedError,
    );
    await vi.advanceTimersByTimeAsync(HOT_PATH_BUDGET_MS);
    const error = await pending;

    expect(transport.routeKeys).toEqual([primary.routeKey, secondary.routeKey]);
    expect(error.hedgesRefusedBelowFloor).toEqual({ ...NO_REFUSALS, secondary: 1 });
  });

  it("leaves a duplicate with at least the floor to run exactly as before: same start, same records", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const transport = new ScriptedTransport(
      "gateway",
      byOrder([
        () => hangs(),
        (call) => answersAfter(DUPLICATE_ANSWER_MS, "duplicate answer", usageFor(call.route)),
      ]),
    );

    const pending = run(legsOf(transport, [{ route: primary }]), breakers, {
      content: DECISION_PROMPT,
      hedging: DEPLOYED_POLICY,
      latency: decisionTracker(primary, HEALTHY_P90_MS),
      admitDuplicate: () => true,
    });
    await vi.advanceTimersByTimeAsync(HEALTHY_P90_MS - 1);
    expect(transport.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(DUPLICATE_ANSWER_MS);
    const outcome = await pending;

    expect(outcome.response.response).toBe("duplicate answer");
    expect(outcome.attempts).toStrictEqual(PRE_FLOOR_NOOP_RECORDS);
    expect(outcome.hedgesRefusedBelowFloor).toEqual(NO_REFUSALS);
  });

  it("keeps a slow attempt running when its measured timeout finds only a candidate below the floor", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const transport = new ScriptedTransport(
      "gateway",
      byOrder([(call) => answersAfter(ORIGINAL_ANSWERS_MS, "original answer", usageFor(call.route))]),
    );
    // Headroom for a duplicate appears only at the measured timeout, so the
    // hedge point starts nothing and supersede() is the one mechanism that could.
    const startedAt = Date.now();
    const admitDuplicate = (): boolean => Date.now() - startedAt >= LATE_SUPERSEDE_MS;

    const pending = run(legsOf(transport, [{ route: primary }]), breakers, {
      content: DECISION_PROMPT,
      hedging: DEPLOYED_POLICY,
      // Every sample equal, so the measured timeout is exactly k x this.
      latency: decisionTracker(primary, LATE_SUPERSEDE_MS / DEPLOYED_POLICY.kTimeout),
      admitDuplicate,
    });
    await vi.advanceTimersByTimeAsync(LATE_SUPERSEDE_MS);
    expect(transport.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(ORIGINAL_ANSWERS_MS - LATE_SUPERSEDE_MS);
    const outcome = await pending;

    expect(outcome.response.response).toBe("original answer");
    expect(transport.calls).toHaveLength(1);
    expect(
      outcome.attempts.map((attempt) => [attempt.outcome, attempt.attemptIndex, attempt.durationMs]),
    ).toEqual([["ok", 0, ORIGINAL_ANSWERS_MS]]);
    expect(outcome.hedgesRefusedBelowFloor).toEqual({ ...NO_REFUSALS, primary: 1 });
  });

  it("starts no same-model equivalent after a fast failure below the floor, and moves to the next leg", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const equivalent = equivalentOf(primary, "second-host");
    const secondary = makeRoute({
      alias: ALIAS,
      role: "secondary",
      provider: CLOSED_PROVIDER,
      timeoutMs: HOT_PATH_BUDGET_MS,
    });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.routeKey === primary.routeKey
        ? failsAfter(LATE_FAILURE_MS, new GatewayResponseError(BAD_GATEWAY, "upstream down"))
        : answers("next leg", usageFor(call.route)),
    );

    const pending = run(
      legsOf(transport, [{ route: primary, equivalents: [equivalent] }, { route: secondary }]),
      breakers,
      {
        content: DECISION_PROMPT,
        // One attempt may hold the whole budget, so the deadline reservation
        // starts nothing and the fast-failure path is the one under test.
        hedging: { ...DEPLOYED_POLICY, maxAttemptShare: 1 },
        latency: coldTracker(),
      },
    );
    await vi.advanceTimersByTimeAsync(LATE_FAILURE_MS);
    const outcome = await pending;

    expect(transport.routeKeys).toEqual([primary.routeKey, secondary.routeKey]);
    expect(outcome.servedBy.routeKey).toBe(secondary.routeKey);
    expect(outcome.hedgesRefusedBelowFloor).toEqual({ ...NO_REFUSALS, primary: 1 });
  });

  it("still dispatches a leg's first attempt when the leg's whole budget is below the floor", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const shortBudgetMs = FLOOR_MS / 2;
    const answersAtMs = shortBudgetMs / 2;
    const transport = new ScriptedTransport(
      "gateway",
      byOrder([(call) => answersAfter(answersAtMs, "first attempt", usageFor(call.route))]),
    );

    const pending = run(legsOf(transport, [{ route: primary }]), breakers, {
      content: DECISION_PROMPT,
      hedging: DEPLOYED_POLICY,
      // The hedge point falls before the answer, inside a budget below the floor.
      latency: decisionTracker(primary, answersAtMs / 2),
      admitDuplicate: () => true,
      deadlineAtMs: Date.now() + shortBudgetMs,
    });
    await vi.advanceTimersByTimeAsync(answersAtMs);
    const outcome = await pending;

    expect(outcome.response.response).toBe("first attempt");
    expect(transport.calls).toHaveLength(1);
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]).toMatchObject({
      outcome: "ok",
      attemptIndex: 0,
      hedged: false,
      budgetMs: shortBudgetMs,
    });
    expect(outcome.hedgesRefusedBelowFloor).toEqual({ ...NO_REFUSALS, primary: 1 });
  });

  it("counts nothing when the attempt answers before a late hedge point", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const answersAtMs = LATE_P90_MS - 1;
    const transport = new ScriptedTransport(
      "gateway",
      byOrder([(call) => answersAfter(answersAtMs, "in time", usageFor(call.route))]),
    );

    const pending = run(legsOf(transport, [{ route: primary }]), breakers, {
      content: DECISION_PROMPT,
      hedging: DEPLOYED_POLICY,
      latency: decisionTracker(primary, LATE_P90_MS),
      admitDuplicate: () => true,
    });
    await vi.advanceTimersByTimeAsync(answersAtMs);
    const outcome = await pending;

    expect(outcome.response.response).toBe("in time");
    expect(outcome.hedgesRefusedBelowFloor).toEqual(NO_REFUSALS);
  });

  it("counts no refusal for a duplicate the fast-failure path would never have started", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const transport = new ScriptedTransport("gateway", () =>
      failsAfter(LATE_FAILURE_MS, new GatewayResponseError(BAD_GATEWAY, "upstream down")),
    );

    const pending = rejection(
      run(legsOf(transport, [{ route: primary }]), breakers, {
        content: DECISION_PROMPT,
        hedging: DEPLOYED_POLICY,
        latency: decisionTracker(primary, LATE_P90_MS),
        admitDuplicate: () => true,
      }),
      ChainExhaustedError,
    );
    await vi.advanceTimersByTimeAsync(LATE_FAILURE_MS);
    const error = await pending;

    expect(transport.calls).toHaveLength(1);
    expect(error.hedgesRefusedBelowFloor).toEqual(NO_REFUSALS);
  });

  it("counts no refusal once the caller has gone, whose attempts could not start anyway", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const transport = new SettlesOnItsOwnTransport(HOT_PATH_BUDGET_MS - 1);
    const caller = new AbortController();
    const callerLeavesAtMs = LATE_P90_MS - FLOOR_MS;

    const pending = rejection(
      run(legsOf(transport, [{ route: primary }]), breakers, {
        content: DECISION_PROMPT,
        hedging: DEPLOYED_POLICY,
        latency: decisionTracker(primary, LATE_P90_MS),
        admitDuplicate: () => true,
        callerSignal: caller.signal,
      }),
      ChainExhaustedError,
    );
    await vi.advanceTimersByTimeAsync(callerLeavesAtMs);
    caller.abort(new Error("caller left"));
    // The hedge point passes while the abandoned attempt is still settling.
    await vi.advanceTimersByTimeAsync(HOT_PATH_BUDGET_MS - 1 - callerLeavesAtMs);
    const error = await pending;

    expect(transport.calls).toBe(1);
    expect(error.hedgesRefusedBelowFloor).toEqual(NO_REFUSALS);
  });

  it("counts no refusal at a hedge point that falls on the leg's end", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: HOT_PATH_BUDGET_MS });
    const transport = new SettlesOnItsOwnTransport(HOT_PATH_BUDGET_MS + 1);

    const pending = rejection(
      run(legsOf(transport, [{ route: primary }]), breakers, {
        content: DECISION_PROMPT,
        hedging: DEPLOYED_POLICY,
        latency: decisionTracker(primary, HOT_PATH_BUDGET_MS),
        admitDuplicate: () => true,
      }),
      ChainExhaustedError,
    );
    await vi.advanceTimersByTimeAsync(HOT_PATH_BUDGET_MS + 1);
    const error = await pending;

    expect(transport.calls).toBe(1);
    expect(error.hedgesRefusedBelowFloor).toEqual(NO_REFUSALS);
  });
});

describe("attempt floor through the alias client", () => {
  /** The whole-call deadline the engine gives a decision call: three legs' worth. */
  const DECISION_DEADLINE_MS = 3 * HOT_PATH_BUDGET_MS;

  beforeEach(() => {
    vi.useFakeTimers();
    resetProviderGuards();
    configureLlmClient({});
  });

  afterEach(() => {
    configureLlmClient({});
    resetProviderGuards();
    vi.useRealTimers();
  });

  /**
   * Warm the client's own tracker for the configured head of the hot-path chain.
   *
   * @returns The chain's primary and secondary routes.
   */
  function warmHotPathPrimary(): { primary: ResolvedRoute; secondary: ResolvedRoute } {
    const [primary, secondary] = resolveChain(ALIAS).routes;
    const tracker = llmLatencyTracker();
    if (tracker === undefined) {
      throw new Error("the client built no latency tracker although the table configures hedging");
    }
    warmDecisionCell(tracker, primary, LATE_P90_MS);
    return { primary, secondary };
  }

  it("reports the refused duplicate on the answer, by the role of the leg it belonged to", async () => {
    const gateway = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary" ? hangs() : answers("secondary answer", usageFor(call.route)),
    );
    configureLlmClient({ gatewayTransport: gateway, now: () => Date.now(), duplicateAdmission: () => true });
    const { primary, secondary } = warmHotPathPrimary();

    const pending = callLLMByAlias<string>(DECISION_PROMPT, "text", {
      alias: ALIAS,
      timeoutMs: DECISION_DEADLINE_MS,
    });
    await vi.advanceTimersByTimeAsync(HOT_PATH_BUDGET_MS);
    const result = await pending;

    expect(gateway.routeKeys).toEqual([primary.routeKey, secondary.routeKey]);
    expect(result.hedgesRefusedBelowFloor).toEqual({ ...NO_REFUSALS, primary: 1 });
  });

  it("adds the refusals of a validation retry to those of the first run", async () => {
    const gateway = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? hangs()
        : answers(call.index < 2 ? "rejected" : "accepted", usageFor(call.route)),
    );
    configureLlmClient({ gatewayTransport: gateway, now: () => Date.now(), duplicateAdmission: () => true });
    warmHotPathPrimary();

    const pending = callLLMByAlias<string>(DECISION_PROMPT, "text", {
      alias: ALIAS,
      timeoutMs: DECISION_DEADLINE_MS,
      validate: (raw) =>
        raw === "accepted" ? { ok: true, value: raw } : { ok: false, reason: "not the accepted payload" },
    });
    await vi.advanceTimersByTimeAsync(2 * HOT_PATH_BUDGET_MS);
    const result = await pending;

    expect(result.response).toBe("accepted");
    expect(result.hedgesRefusedBelowFloor).toEqual({ ...NO_REFUSALS, primary: 2 });
  });

  it("keeps the refusals of a gateway run that ended in an outage when the direct path answers", async () => {
    const gateway = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? failsAfter(LATE_P90_MS + 1, new GatewayUnreachableError("https://llm-gateway.invalid", "connection reset"))
        : fails(new GatewayUnreachableError("https://llm-gateway.invalid", "connection reset")),
    );
    const direct = new ScriptedTransport("direct", (call) => answers("direct answer", usageFor(call.route)));
    configureLlmClient({
      gatewayTransport: gateway,
      directTransport: direct,
      now: () => Date.now(),
      duplicateAdmission: () => true,
    });
    warmHotPathPrimary();

    const pending = callLLMByAlias<string>(DECISION_PROMPT, "text", {
      alias: ALIAS,
      timeoutMs: DECISION_DEADLINE_MS,
    });
    await vi.advanceTimersByTimeAsync(LATE_P90_MS + 1);
    const result = await pending;

    expect(result.degraded).toBe(true);
    expect(result.response).toBe("direct answer");
    expect(result.hedgesRefusedBelowFloor).toEqual({ ...NO_REFUSALS, primary: 1 });
  });
});
