/**
 * The typed cause on an attempt record.
 *
 * `outcome` says how an attempt ended in five coarse words and `reason` says
 * why in prose. A consumer that needs to tell a credential rejection from a
 * full queue from an unparseable answer had only the prose to read, and prose
 * is not a contract. `failureClass` is: one member of a closed list per cause,
 * set by the code that knows the cause, at every place a record is produced.
 *
 * These tests pin three things: each cause maps to exactly one class; every
 * producer of a record stamps it; and adding the class moved none of the
 * fields a breaker, a hedge or an existing consumer already reads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callLLMByAlias, configureLlmClient } from "../../../llm/alias-client";
import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import type { BreakerFailureKind } from "../../../llm/circuit-breaker";
import { ChainExhaustedError, LlmDeadlineExceededError, executeChain } from "../../../llm/fallback-chain";
import type { ChainExecution, ChainLeg } from "../../../llm/fallback-chain";
import type { SameModelPolicy } from "../../../llm/hedge";
import { LLM_ATTEMPT_FAILURE_CLASSES } from "../../../llm";
import type { LlmAttemptFailureClass } from "../../../llm";
import {
  AttemptSupersededError,
  HedgeLoserError,
  LegTimeoutError,
  classify,
} from "../../../llm/leg-attempt";
import { LegLatencyTracker, estimatePromptTokens } from "../../../llm/leg-latency-tracker";
import { ToolChoiceIgnoredError, UnsupportedCapabilityError } from "../../../llm/param-matrix";
import {
  RateGuardTimeoutError,
  limitsFor,
  resetProviderGuards,
  withProviderGuards,
} from "../../../llm/rate-guard";
import { resolveChain } from "../../../llm/route-table";
import { LlmResponseFormatError } from "../../../llm/structured-content";
import { GatewayResponseError, GatewayUnreachableError } from "../../../llm/transports/gateway";
import type { AliasAttemptRecord, ResolvedRoute } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { CLOSED_PROVIDER, makeRoute } from "./support/routes";
import { ScriptedTransport, answers, fails, hangs, usageFor } from "./support/transports";
import type { LegBehaviour, ScriptedCall } from "./support/transports";

vi.mock("../../../llm/route-table", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../llm/route-table")>();
  return { ...actual, resolveChain: vi.fn(actual.resolveChain) };
});

/** The alias the constructed chains stand in for. */
const ALIAS = "llm.fast";

/** The prompt every call sends, so the latency bucket is known. */
const PROMPT = "prompt";

/** A leg budget the fake clock can run out by hand. */
const LEG_BUDGET_MS = 1_000;

/** Healthy latency the tracker is warmed with. */
const HEALTHY_MS = 100;

/** Samples a latency cell needs before it is used. */
const MIN_SAMPLES = 5;

/** A provider with a client-side guard small enough to saturate in a test. */
const GUARDED_PROVIDER = "groq";

/** Budget of a leg that is refused by its guard; the refusal takes this long in real time. */
const GUARD_REFUSAL_BUDGET_MS = 50;

/** HTTP statuses the classification reads by number. */
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const INTERNAL_ERROR = 500;
const SERVICE_UNAVAILABLE = 503;

/** Breaker tuning: one failure opens a route, so an open breaker is one call away. */
const BREAKER = {
  failure_threshold: 1,
  cooldown_ms: 60_000,
  capacity_cooldown_ms: 15_000,
  half_open_probes: 1,
} as const;

/** Same-model policy; the floor is zero so the measured timeout is exact. */
const POLICY: SameModelPolicy = {
  maxExtraAttempts: 1,
  hedgeQuantile: 0.9,
  timeoutQuantile: 0.99,
  kTimeout: 3,
  attemptTimeoutFloorMs: 0,
  maxAttemptShare: 0.5,
  duplicateReserve: 0.25,
};

/** A route to build route-carrying errors from. */
const ROUTE = makeRoute({ alias: ALIAS, role: "primary" });

/** A signal whose caller has already stopped waiting. */
function cancelledSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

/**
 * A gateway-unreachable error raised by a different copy of the client: same
 * name, no shared prototype. A consumer's own transport is in this position.
 */
class ForeignGatewayUnreachableError extends Error {
  public constructor() {
    super("LLM gateway at https://other.invalid is unreachable: fetch failed");
    this.name = "GatewayUnreachableError";
  }
}

/** The fields of a classification that existed before the typed class. */
interface LegacyFields {
  readonly outcome: AliasAttemptRecord["outcome"];
  readonly reason: string;
  readonly countsAgainstHealth: boolean;
  readonly failureKind: BreakerFailureKind;
}

/** One cause `classify` accepts, with the class it must yield and the fields it must not move. */
interface ClassifyRow {
  readonly cause: string;
  readonly error: unknown;
  readonly callerSignal?: AbortSignal;
  readonly failureClass: LlmAttemptFailureClass;
  readonly legacy: LegacyFields;
}

const FORMAT_ERROR = new LlmResponseFormatError(
  "json",
  usageFor(ROUTE),
  false,
  new SyntaxError("Unexpected token 'h'"),
);
const SUPERSEDED = new AttemptSupersededError(ROUTE.routeKey, 300);
const HEDGE_LOSER = new HedgeLoserError(ROUTE.routeKey);
const LEG_TIMEOUT = new LegTimeoutError(ROUTE.routeKey, LEG_BUDGET_MS);
const UNSUPPORTED = new UnsupportedCapabilityError(ROUTE, "json_schema");
const TOOL_CHOICE_IGNORED = new ToolChoiceIgnoredError(ROUTE, usageFor(ROUTE), null);
const RATE_GUARD = new RateGuardTimeoutError(GUARDED_PROVIDER, "concurrency", GUARD_REFUSAL_BUDGET_MS);
const UNREACHABLE = new GatewayUnreachableError("https://gateway.invalid", new Error("fetch failed"));

/**
 * Every cause `classify` distinguishes. The legacy fields are transcribed from
 * the classification as it stood before the class existed.
 */
const CLASSIFY_ROWS: readonly ClassifyRow[] = [
  {
    cause: "the caller stopped waiting",
    error: new Error("anything at all"),
    callerSignal: cancelledSignal(),
    failureClass: "caller_cancelled",
    legacy: { outcome: "skipped", reason: "caller cancelled", countsAgainstHealth: false, failureKind: "hard" },
  },
  {
    cause: "an attempt replaced after its measured timeout",
    error: SUPERSEDED,
    failureClass: "superseded",
    legacy: { outcome: "timeout", reason: SUPERSEDED.message, countsAgainstHealth: false, failureKind: "capacity" },
  },
  {
    cause: "an attempt beaten by a same-model attempt",
    error: HEDGE_LOSER,
    failureClass: "hedge_loser",
    legacy: { outcome: "skipped", reason: HEDGE_LOSER.message, countsAgainstHealth: false, failureKind: "capacity" },
  },
  {
    cause: "a leg that ran out its budget",
    error: LEG_TIMEOUT,
    failureClass: "leg_timeout",
    legacy: { outcome: "timeout", reason: LEG_TIMEOUT.message, countsAgainstHealth: true, failureKind: "capacity" },
  },
  {
    cause: "a leg that cannot serve the request",
    error: UNSUPPORTED,
    failureClass: "unsupported_capability",
    legacy: { outcome: "skipped", reason: UNSUPPORTED.message, countsAgainstHealth: false, failureKind: "hard" },
  },
  {
    cause: "a mandatory tool call answered in prose",
    error: TOOL_CHOICE_IGNORED,
    failureClass: "tool_choice_ignored",
    legacy: { outcome: "error", reason: TOOL_CHOICE_IGNORED.message, countsAgainstHealth: false, failureKind: "hard" },
  },
  {
    cause: "the client's own guard refusing admission",
    error: RATE_GUARD,
    failureClass: "rate_guard",
    legacy: { outcome: "skipped", reason: RATE_GUARD.message, countsAgainstHealth: false, failureKind: "hard" },
  },
  {
    cause: "a transport reporting its request aborted",
    error: new Error("This operation was aborted"),
    failureClass: "leg_timeout",
    legacy: {
      outcome: "timeout",
      reason: "aborted: This operation was aborted",
      countsAgainstHealth: true,
      failureKind: "capacity",
    },
  },
  {
    cause: "an answer that does not parse",
    error: FORMAT_ERROR,
    failureClass: "response_format",
    legacy: { outcome: "error", reason: FORMAT_ERROR.message, countsAgainstHealth: true, failureKind: "hard" },
  },
  {
    cause: "a rejected credential (401)",
    error: new GatewayResponseError(UNAUTHORIZED, "invalid api key"),
    failureClass: "credential",
    legacy: {
      outcome: "error",
      reason: "LLM gateway returned 401: invalid api key",
      countsAgainstHealth: true,
      failureKind: "hard",
    },
  },
  {
    cause: "a refused credential (403)",
    error: new GatewayResponseError(FORBIDDEN, "key lacks access to this model"),
    failureClass: "credential",
    legacy: {
      outcome: "error",
      reason: "LLM gateway returned 403: key lacks access to this model",
      countsAgainstHealth: true,
      failureKind: "hard",
    },
  },
  {
    cause: "a provider that is full, by status",
    error: new GatewayResponseError(SERVICE_UNAVAILABLE, "upstream unavailable"),
    failureClass: "capacity",
    legacy: {
      outcome: "error",
      reason: "LLM gateway returned 503: upstream unavailable",
      countsAgainstHealth: true,
      failureKind: "capacity",
    },
  },
  {
    cause: "a provider that is full, by its wording",
    error: new Error("Model busy, retry later"),
    failureClass: "capacity",
    legacy: { outcome: "error", reason: "Model busy, retry later", countsAgainstHealth: true, failureKind: "capacity" },
  },
  {
    cause: "an unreachable gateway",
    error: UNREACHABLE,
    failureClass: "gateway_unreachable",
    legacy: { outcome: "error", reason: UNREACHABLE.message, countsAgainstHealth: true, failureKind: "hard" },
  },
  {
    cause: "an unreachable gateway raised by another copy of the client",
    error: new ForeignGatewayUnreachableError(),
    failureClass: "gateway_unreachable",
    legacy: {
      outcome: "error",
      reason: "LLM gateway at https://other.invalid is unreachable: fetch failed",
      countsAgainstHealth: true,
      failureKind: "hard",
    },
  },
  {
    cause: "a provider failure that is none of the above",
    error: new GatewayResponseError(INTERNAL_ERROR, "boom"),
    failureClass: "provider_error",
    legacy: {
      outcome: "error",
      reason: "LLM gateway returned 500: boom",
      countsAgainstHealth: true,
      failureKind: "hard",
    },
  },
  {
    cause: "a thrown value that is not an Error",
    error: "boom",
    failureClass: "provider_error",
    legacy: { outcome: "error", reason: "boom", countsAgainstHealth: true, failureKind: "hard" },
  },
];

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
 * Wrap routes as legs on one transport.
 *
 * @param transport The transport.
 * @param routes The legs, in chain order.
 * @returns Prepared legs.
 */
function legsOf(transport: ScriptedTransport, routes: readonly ResolvedRoute[]): ChainLeg[] {
  return routes.map((route) => ({ route, transport, params: {} }));
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
  extra: Partial<ChainExecution> = {},
): ReturnType<typeof executeChain<string>> {
  return executeChain<string>(ALIAS, {
    legs,
    content: PROMPT,
    responseFormat: "text",
    breakers,
    now: () => Date.now(),
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

/**
 * The typed class of each attempt, in order.
 *
 * @param attempts The attempt record.
 * @returns One class per attempt; undefined where the record carries none.
 */
function classesOf(attempts: readonly AliasAttemptRecord[]): (LlmAttemptFailureClass | undefined)[] {
  return attempts.map((attempt) => attempt.failureClass);
}

/**
 * The outcome and prose of each attempt, in order.
 *
 * @param attempts The attempt record.
 * @returns The two fields a consumer read before the class existed.
 */
function legacyOf(
  attempts: readonly AliasAttemptRecord[],
): { outcome: AliasAttemptRecord["outcome"]; reason: string | undefined }[] {
  return attempts.map((attempt) => ({ outcome: attempt.outcome, reason: attempt.reason }));
}

describe("classify: one typed class per cause", () => {
  it.each(CLASSIFY_ROWS)("$cause is $failureClass", ({ error, callerSignal, failureClass }) => {
    expect(classify(error, callerSignal).failureClass).toBe(failureClass);
  });

  it("reads an unparseable answer by its type, whatever words the answer contained", () => {
    // A parser quotes the content it choked on, so a model's own words reach
    // the message. The class is the error's type, not what the model said.
    const quoted = new LlmResponseFormatError(
      "json",
      usageFor(ROUTE),
      false,
      new SyntaxError(`Unexpected token 'a', "abort the order" is not valid JSON`),
    );
    const overloaded = new LlmResponseFormatError(
      "json",
      usageFor(ROUTE),
      false,
      new SyntaxError(`Unexpected token 'T', "The model is overloaded" is not valid JSON`),
    );

    expect(classify(quoted, undefined).failureClass).toBe("response_format");
    expect(classify(overloaded, undefined).failureClass).toBe("response_format");
  });

  it("reads an unreachable gateway by its name before the wording of what it wrapped", () => {
    // The gateway was never reached, so nothing behind it said it was full;
    // the words are the local connection error's.
    const wrapped = new GatewayUnreachableError(
      "https://gateway.invalid",
      new Error("connection pool is at capacity"),
    );

    expect(classify(wrapped, undefined).failureClass).toBe("gateway_unreachable");
  });

  it("reads a credential rejection from a numeric status only", () => {
    const numeric = Object.assign(new Error("denied"), { status: UNAUTHORIZED });
    const textual = Object.assign(new Error("denied"), { status: String(UNAUTHORIZED) });

    // A rejected key is a rejected key whatever the body goes on to say.
    const worded = new GatewayResponseError(UNAUTHORIZED, "rate limit tier unavailable for this key");

    expect(classify(numeric, undefined).failureClass).toBe("credential");
    expect(classify(textual, undefined).failureClass).toBe("provider_error");
    expect(classify(worded, undefined).failureClass).toBe("credential");
  });
});

describe("classify: the fields that predate the class are unmoved", () => {
  it.each(CLASSIFY_ROWS)("$cause keeps its outcome, reason, health verdict and cooldown", (row) => {
    const { failureClass: _failureClass, ...legacy } = classify(row.error, row.callerSignal);
    expect(legacy).toEqual(row.legacy);
  });
});

describe("every producer stamps the attempt record", () => {
  let breakers: CircuitBreakerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    breakers = new CircuitBreakerRegistry(BREAKER, () => Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
    resetProviderGuards();
    configureLlmClient({});
    vi.mocked(resolveChain).mockClear();
  });

  it("classes each failed leg of a walk: an unparseable answer, then a full provider", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? fails(FORMAT_ERROR)
        : fails(new GatewayResponseError(SERVICE_UNAVAILABLE, "upstream unavailable")),
    );

    const error = await rejection(run(legsOf(transport, [primary, secondary]), breakers), ChainExhaustedError);

    expect(classesOf(error.attempts)).toEqual(["response_format", "capacity"]);
    expect(legacyOf(error.attempts)).toEqual([
      { outcome: "error", reason: FORMAT_ERROR.message },
      { outcome: "error", reason: "LLM gateway returned 503: upstream unavailable" },
    ]);
  });

  it("classes a rejected credential", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const transport = new ScriptedTransport("gateway", () =>
      fails(new GatewayResponseError(UNAUTHORIZED, "invalid api key")),
    );

    const error = await rejection(run(legsOf(transport, [primary]), breakers), ChainExhaustedError);

    expect(classesOf(error.attempts)).toEqual(["credential"]);
    expect(legacyOf(error.attempts)).toEqual([
      { outcome: "error", reason: "LLM gateway returned 401: invalid api key" },
    ]);
  });

  it("classes a different-model leg the caller's policy denied", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary", provider: CLOSED_PROVIDER });
    const transport = new ScriptedTransport("gateway", () =>
      fails(new GatewayResponseError(INTERNAL_ERROR, "boom")),
    );

    const error = await rejection(
      run(legsOf(transport, [primary, secondary]), breakers, { crossModelPolicy: "deny" }),
      ChainExhaustedError,
    );

    expect(error.reason).toBe("cross_model_denied");
    expect(classesOf(error.attempts)).toEqual(["provider_error", "cross_model_denied"]);
    expect(legacyOf(error.attempts)[1]).toEqual({
      outcome: "skipped",
      reason:
        "cross-model leg denied by policy: configured model is model-primary, this leg serves model-secondary",
    });
  });

  it("classes a leg that cannot serve the request", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    const unsupported = new UnsupportedCapabilityError(primary, "json_schema");
    const transport = new ScriptedTransport("gateway", (call) => answers("served", usageFor(call.route)));

    const outcome = await run(
      [
        { route: primary, transport, params: unsupported },
        { route: secondary, transport, params: {} },
      ],
      breakers,
    );

    expect(classesOf(outcome.attempts)).toEqual(["unsupported_capability", undefined]);
    expect(legacyOf(outcome.attempts)).toEqual([
      { outcome: "skipped", reason: unsupported.message },
      { outcome: "ok", reason: undefined },
    ]);
  });

  it("classes a leg whose breaker is open", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    breakers.onFailure(primary.routeKey);
    const transport = new ScriptedTransport("gateway", () => hangs());

    const error = await rejection(run(legsOf(transport, [primary]), breakers), ChainExhaustedError);

    expect(transport.calls).toHaveLength(0);
    expect(classesOf(error.attempts)).toEqual(["breaker_open"]);
    expect(legacyOf(error.attempts)).toEqual([
      { outcome: "breaker-open", reason: "circuit breaker is open" },
    ]);
  });

  it("classes a leg that ran out its budget, and the leg the spent deadline never reached", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary", timeoutMs: LEG_BUDGET_MS });
    const transport = new ScriptedTransport("gateway", () => hangs());
    const deadlineMs = LEG_BUDGET_MS / 2;

    const pending = rejection(
      run(legsOf(transport, [primary, secondary]), breakers, { deadlineAtMs: Date.now() + deadlineMs }),
      LlmDeadlineExceededError,
    );
    await vi.advanceTimersByTimeAsync(deadlineMs);
    const error = await pending;

    expect(classesOf(error.attempts)).toEqual(["leg_timeout", "deadline_spent"]);
    expect(legacyOf(error.attempts)).toEqual([
      { outcome: "timeout", reason: `route ${primary.routeKey} exceeded its ${deadlineMs} ms budget` },
      { outcome: "skipped", reason: "caller deadline exhausted before this leg" },
    ]);
  });

  it("classes an attempt the caller cancelled", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const transport = new ScriptedTransport("gateway", () => hangs());
    const caller = new AbortController();

    const pending = rejection(
      run(legsOf(transport, [primary]), breakers, { callerSignal: caller.signal }),
      ChainExhaustedError,
    );
    await vi.advanceTimersByTimeAsync(0);
    caller.abort();
    const error = await pending;

    expect(classesOf(error.attempts)).toEqual(["caller_cancelled"]);
    expect(legacyOf(error.attempts)).toEqual([{ outcome: "skipped", reason: "caller cancelled" }]);
  });

  it("classes a hedge's loser, and leaves the winner without a class", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const transport = new ScriptedTransport(
      "gateway",
      byOrder([() => hangs(), (call) => answers("hedged answer", usageFor(call.route))]),
    );

    const pending = run(legsOf(transport, [primary]), breakers, {
      hedging: POLICY,
      latency: warmTracker(primary),
      admitDuplicate: () => true,
    });
    await vi.advanceTimersByTimeAsync(HEALTHY_MS);
    const outcome = await pending;

    const winner = outcome.attempts.find((attempt) => attempt.outcome === "ok");
    const loser = outcome.attempts.find((attempt) => attempt.attemptIndex === 0);
    expect(loser?.failureClass).toBe("hedge_loser");
    expect(loser?.outcome).toBe("skipped");
    expect(loser?.reason).toBe(`route ${primary.routeKey} was cancelled: a same-model attempt answered first`);
    expect(winner).toBeDefined();
    expect(winner !== undefined && "failureClass" in winner).toBe(false);
  });

  it("classes an attempt replaced after its measured timeout", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary", timeoutMs: LEG_BUDGET_MS });
    const measuredMs = POLICY.kTimeout * HEALTHY_MS;
    const transport = new ScriptedTransport(
      "gateway",
      byOrder([() => hangs(), (call) => answers("replacement", usageFor(call.route))]),
    );
    // Headroom appears only once the hedge point has passed, so the measured
    // timeout is the only mechanism that can start the replacement.
    const startedAt = Date.now();
    const pending = run(legsOf(transport, [primary]), breakers, {
      hedging: POLICY,
      latency: warmTracker(primary),
      admitDuplicate: () => Date.now() - startedAt >= measuredMs,
    });
    await vi.advanceTimersByTimeAsync(measuredMs);
    const outcome = await pending;

    const superseded = outcome.attempts.find((attempt) => attempt.attemptIndex === 0);
    expect(superseded?.failureClass).toBe("superseded");
    expect(superseded?.outcome).toBe("timeout");
    expect(superseded?.reason).toBe(
      `route ${primary.routeKey} exceeded its measured ${measuredMs} ms attempt timeout and was ` +
        "superseded by a same-model attempt",
    );
  });

  it("classes a leg the client's own guard refused", async () => {
    vi.useRealTimers();
    resetProviderGuards();
    const primary = makeRoute({
      alias: ALIAS,
      role: "primary",
      providerName: GUARDED_PROVIDER,
      timeoutMs: GUARD_REFUSAL_BUDGET_MS,
    });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    let releaseHeld: () => void = () => undefined;
    const heldOpen = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    const saturating = Array.from({ length: limitsFor(GUARDED_PROVIDER).max_concurrent }, () =>
      withProviderGuards(GUARDED_PROVIDER, async () => {
        await heldOpen;
      }),
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const transport = new ScriptedTransport("gateway", (call) => answers("served", usageFor(call.route)));

    const outcome = await run(legsOf(transport, [primary, secondary]), breakers);

    expect(classesOf(outcome.attempts)).toEqual(["rate_guard", undefined]);
    expect(outcome.attempts[0].outcome).toBe("skipped");
    expect(outcome.attempts[0].reason).toContain("The provider was never contacted");
    expect(transport.routeKeys).toEqual([secondary.routeKey]);

    releaseHeld();
    await Promise.all(saturating);
  });

  it("classes every leg of an alias with no servable route", async () => {
    vi.mocked(resolveChain).mockReturnValueOnce({
      alias: ALIAS,
      isolated: false,
      routes: [],
      exclusions: [
        { role: "primary", provider: "open-host", reason: 'provider account status is "pending"' },
        { role: "closed_incumbent", provider: "closed-vendor", reason: "shadow-only: configured and scored, never served to a caller" },
      ],
    });

    const error = await rejection(callLLMByAlias(PROMPT, "text", { alias: ALIAS }), ChainExhaustedError);

    expect(classesOf(error.attempts)).toEqual(["unresolvable_route", "unresolvable_route"]);
    expect(legacyOf(error.attempts)).toEqual([
      { outcome: "skipped", reason: 'provider account status is "pending"' },
      { outcome: "skipped", reason: "shadow-only: configured and scored, never served to a caller" },
    ]);
    expect(error.attempts.map((attempt) => attempt.routeKey)).toEqual([
      `${ALIAS}#primary`,
      `${ALIAS}#closed_incumbent`,
    ]);
  });

  it("puts no class on an attempt that answered", async () => {
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const transport = new ScriptedTransport("gateway", (call) => answers("served", usageFor(call.route)));

    const outcome = await run(legsOf(transport, [primary]), breakers);

    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0].outcome).toBe("ok");
    expect("failureClass" in outcome.attempts[0]).toBe(false);
  });
});

describe("the exported list is the union", () => {
  it("names every member of the type, once", () => {
    // Keyed by the type: a member added to or removed from the union without
    // the same change here does not compile, and the runtime list is then held
    // to these keys.
    const everyClass: Record<LlmAttemptFailureClass, true> = {
      leg_timeout: true,
      superseded: true,
      hedge_loser: true,
      caller_cancelled: true,
      deadline_spent: true,
      cross_model_denied: true,
      unsupported_capability: true,
      breaker_open: true,
      rate_guard: true,
      unresolvable_route: true,
      response_format: true,
      tool_choice_ignored: true,
      credential: true,
      capacity: true,
      gateway_unreachable: true,
      provider_error: true,
    };

    expect([...LLM_ATTEMPT_FAILURE_CLASSES].sort()).toEqual(Object.keys(everyClass).sort());
    expect(new Set(LLM_ATTEMPT_FAILURE_CLASSES).size).toBe(LLM_ATTEMPT_FAILURE_CLASSES.length);
  });

  it("has a producer for every member", () => {
    const fromClassify = CLASSIFY_ROWS.map((row) => row.failureClass);
    // Legs that are never dispatched are classed where the walk decides not to
    // dispatch them, which the producer tests above drive one by one.
    const undispatched: readonly LlmAttemptFailureClass[] = [
      "deadline_spent",
      "cross_model_denied",
      "breaker_open",
      "unresolvable_route",
    ];

    expect(new Set([...fromClassify, ...undispatched])).toEqual(new Set(LLM_ATTEMPT_FAILURE_CLASSES));
  });
});
