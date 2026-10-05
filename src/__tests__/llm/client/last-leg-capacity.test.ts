/**
 * Pins the llm.fast last-leg capacity fix of 2026-09-28.
 *
 * Two engine-side amplifiers turned a DeepInfra capacity blip into chain
 * exhaustion: a breaker that excluded a merely busy leg for a full minute,
 * pushing all of the alias's traffic onto the closed incumbent, and an
 * incumbent guard (claude-haiku-4-5) that admitted only 12 calls with a
 * 15000 ms admit wait against a 30000 ms leg budget. These tests hold the new
 * numbers and the new breaker behaviour in place, and hold the healthy routing
 * of the alias exactly where it was.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import { executeChain, isCapacitySignal } from "../../../llm/fallback-chain";
import type { ChainLeg } from "../../../llm/fallback-chain";
import {
  RateGuardTimeoutError,
  guardSnapshots,
  limitsFor,
  resetProviderGuards,
  withProviderGuards,
} from "../../../llm/rate-guard";
import { routeTable } from "../../../llm/route-table";
import type { LlmBreakerDefaults } from "../../../llm/types";
import { makeRoute } from "./support/routes";
import { ScriptedTransport, fails, hangs } from "./support/transports";

/** The closed incumbent of llm.fast, llm.decide and llm.extract. */
const HAIKU = "claude-haiku-4-5";

/**
 * An Anthropic model that is not overridden and must keep the provider numbers.
 *
 * Named from the table so the "not overridden" half of this contract is tested
 * against a model the chain actually reaches. The per-model override exists for
 * the incumbent of a hot-path alias, which absorbs that alias's whole load when
 * every leg above it is out; a background alias's incumbent has a leg budget
 * three times longer and keeps the provider numbers.
 */
const BACKGROUND_INCUMBENT = "claude-sonnet-5-5";

/** Numbers this change sets for the incumbent. */
const HAIKU_MAX_CONCURRENT = 48;
const HAIKU_RPM = 300;
const HAIKU_ACQUIRE_TIMEOUT_MS = 10_000;

/** Anthropic provider numbers, unchanged. */
const ANTHROPIC_MAX_CONCURRENT = 12;
const ANTHROPIC_RPM = 120;
const ANTHROPIC_ACQUIRE_TIMEOUT_MS = 15_000;

/** Lowest standard Anthropic tier's per-model RPM, as cited in provider-limits.json. */
const LOWEST_STANDARD_TIER_RPM = 1_000;

/** Minimum share of the hot-path leg budget an admitted incumbent call must keep. */
const MIN_CALL_BUDGET_MS = 20_000;

/** Breaker windows this change sets. */
const HARD_COOLDOWN_MS = 60_000;
const CAPACITY_COOLDOWN_MS = 15_000;

/** Wall-clock origin for the injected clock. */
const CLOCK_ORIGIN_MS = 1_700_000_000_000;

/** One millisecond, to step just short of a boundary. */
const ONE_MS = 1;

/** A queue wait short enough that a refusal comes back at once. */
const SHORT_WAIT_MS = 20;

/** A leg budget short enough to observe a real timeout quickly. */
const SHORT_LEG_MS = 20;

/**
 * Wait one macrotask, so queued guard waiters settle.
 *
 * @returns A promise that resolves on the next macrotask.
 */
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Hold `count` permits on a guard until released.
 *
 * @param provider The provider.
 * @param modelId The model.
 * @param count How many calls to hold in flight.
 * @returns A release function and the held calls.
 */
function saturate(
  provider: string,
  modelId: string,
  count: number,
): { release: () => void; held: Promise<unknown>[] } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = Array.from({ length: count }, () =>
    withProviderGuards(provider, () => gate, undefined, { modelId }),
  );
  return { release, held };
}

describe("llm.fast closed-incumbent capacity", () => {
  afterEach(() => {
    resetProviderGuards();
  });

  describe("limits", () => {
    it("runs claude-haiku-4-5 at the raised incumbent numbers, still labelled a conservative default", () => {
      const limits = limitsFor("anthropic", HAIKU);
      expect(limits.max_concurrent).toBe(HAIKU_MAX_CONCURRENT);
      expect(limits.requests_per_minute).toBe(HAIKU_RPM);
      expect(limits.acquire_timeout_ms).toBe(HAIKU_ACQUIRE_TIMEOUT_MS);
      expect(limits.basis).toBe("conservative-default");
      expect(limits.scope).toBe("model");
      expect(limits.note ?? "").toMatch(/2026-09-28/);
    });

    it("stays well under the lowest standard Anthropic tier's per-model ceiling", () => {
      expect(limitsFor("anthropic", HAIKU).requests_per_minute).toBeLessThan(
        LOWEST_STANDARD_TIER_RPM / 3,
      );
    });

    it("leaves an admitted incumbent call at least 20 s of the hot-path leg budget", () => {
      const hotPathBudgetMs = routeTable.defaults.request_timeout_ms["hot-path"];
      expect(hotPathBudgetMs - limitsFor("anthropic", HAIKU).acquire_timeout_ms).toBeGreaterThanOrEqual(
        MIN_CALL_BUDGET_MS,
      );
    });

    it("keeps every other Anthropic model, and the provider itself, on the provider numbers", () => {
      for (const limits of [limitsFor("anthropic", BACKGROUND_INCUMBENT), limitsFor("anthropic")]) {
        expect(limits.max_concurrent).toBe(ANTHROPIC_MAX_CONCURRENT);
        expect(limits.requests_per_minute).toBe(ANTHROPIC_RPM);
        expect(limits.acquire_timeout_ms).toBe(ANTHROPIC_ACQUIRE_TIMEOUT_MS);
      }
    });

    it("never applies a per-model override to a provider guarded as a whole", () => {
      expect(limitsFor("groq", HAIKU)).toBe(limitsFor("groq"));
    });
  });

  describe("guard", () => {
    it("admits 48 concurrent incumbent calls and refuses the 49th", async () => {
      const { release, held } = saturate("anthropic", HAIKU, HAIKU_MAX_CONCURRENT);
      await nextMacrotask();

      const snapshot = guardSnapshots().find((guard) => guard.key === `anthropic/${HAIKU}`);
      expect(snapshot?.inFlight).toBe(HAIKU_MAX_CONCURRENT);
      expect(snapshot?.maxConcurrent).toBe(HAIKU_MAX_CONCURRENT);
      expect(snapshot?.requestsPerMinute).toBe(HAIKU_RPM);

      const overflow = await withProviderGuards(
        "anthropic",
        async () => "served",
        SHORT_WAIT_MS,
        { modelId: HAIKU },
      ).catch((error: unknown) => error);
      expect(overflow).toBeInstanceOf(RateGuardTimeoutError);

      release();
      await Promise.all(held);
    });

    it("still holds a non-overridden Anthropic model to 12", async () => {
      const { release, held } = saturate("anthropic", BACKGROUND_INCUMBENT, ANTHROPIC_MAX_CONCURRENT);
      await nextMacrotask();

      const overflow = await withProviderGuards(
        "anthropic",
        async () => "served",
        SHORT_WAIT_MS,
        { modelId: BACKGROUND_INCUMBENT },
      ).catch((error: unknown) => error);
      expect(overflow).toBeInstanceOf(RateGuardTimeoutError);

      release();
      await Promise.all(held);
    });
  });

  describe("healthy routing", () => {
    it("leaves which model answers llm.fast untouched", () => {
      const routes = routeTable.aliases["llm.fast"].routes.map((route) => [
        route.role,
        route.provider,
        route.model_id,
      ]);
      expect(routes).toEqual([
        ["primary", "deepinfra", "deepseek-ai/DeepSeek-V4-Flash"],
        ["secondary", "deepinfra", "openai/gpt-oss-20b"],
        ["closed_incumbent", "anthropic", HAIKU],
      ]);
    });

    it("keeps the breaker threshold, the hard cooldown and the probe budget", () => {
      const breaker = routeTable.defaults.circuit_breaker;
      expect(breaker.failure_threshold).toBe(5);
      expect(breaker.cooldown_ms).toBe(HARD_COOLDOWN_MS);
      expect(breaker.capacity_cooldown_ms).toBe(CAPACITY_COOLDOWN_MS);
      expect(breaker.half_open_probes).toBe(1);
    });
  });
});

describe("circuit breaker: capacity vs hard cooldown", () => {
  const BREAKER: LlmBreakerDefaults = routeTable.defaults.circuit_breaker;
  const KEY = "llm.fast:shared:primary";
  let nowMs: number;
  let breakers: CircuitBreakerRegistry;

  /**
   * The injected clock.
   *
   * @returns The fake time.
   */
  const now = (): number => nowMs;

  /**
   * Record `threshold` failures of one kind.
   *
   * @param kind The failure kind.
   * @returns void
   */
  const trip = (kind: "capacity" | "hard"): void => {
    for (let failure = 0; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(KEY, kind);
    }
  };

  beforeEach(() => {
    nowMs = CLOCK_ORIGIN_MS;
    breakers = new CircuitBreakerRegistry(BREAKER, now);
  });

  it("re-admits a probe 15 s after a run of capacity failures, not 60 s", () => {
    trip("capacity");
    expect(breakers.stateOf(KEY)).toBe("open");
    expect(breakers.snapshot(KEY).failureKind).toBe("capacity");
    expect(breakers.snapshot(KEY).cooldownMs).toBe(CAPACITY_COOLDOWN_MS);

    nowMs += CAPACITY_COOLDOWN_MS - ONE_MS;
    expect(breakers.allows(KEY)).toBe(false);
    nowMs += ONE_MS;
    expect(breakers.stateOf(KEY)).toBe("half-open");
    expect(breakers.allows(KEY)).toBe(true);
  });

  it("admits one probe at a time while half-open, and a success closes it", () => {
    trip("capacity");
    nowMs += CAPACITY_COOLDOWN_MS;
    expect(breakers.onAttemptStart(KEY)).toBe(true);
    expect(breakers.allows(KEY)).toBe(false);
    breakers.onSuccess(KEY);
    expect(breakers.stateOf(KEY)).toBe("closed");
    expect(breakers.snapshot(KEY).failureKind).toBeNull();
  });

  it("re-opens for the capacity window when a capacity probe fails", () => {
    trip("capacity");
    nowMs += CAPACITY_COOLDOWN_MS;
    breakers.onAttemptStart(KEY);
    breakers.onFailure(KEY, "capacity");
    expect(breakers.stateOf(KEY)).toBe("open");
    nowMs += CAPACITY_COOLDOWN_MS;
    expect(breakers.stateOf(KEY)).toBe("half-open");
  });

  it("keeps the full 60 s window for a run of hard failures", () => {
    trip("hard");
    expect(breakers.snapshot(KEY).failureKind).toBe("hard");
    nowMs += CAPACITY_COOLDOWN_MS;
    expect(breakers.stateOf(KEY)).toBe("open");
    nowMs += HARD_COOLDOWN_MS - CAPACITY_COOLDOWN_MS - ONE_MS;
    expect(breakers.stateOf(KEY)).toBe("open");
    nowMs += ONE_MS;
    expect(breakers.stateOf(KEY)).toBe("half-open");
  });

  it("reads a run with any hard failure as hard", () => {
    for (let failure = 1; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(KEY, "capacity");
    }
    breakers.onFailure(KEY, "hard");
    nowMs += CAPACITY_COOLDOWN_MS;
    expect(breakers.stateOf(KEY)).toBe("open");
    expect(breakers.snapshot(KEY).cooldownMs).toBe(HARD_COOLDOWN_MS);
  });

  it("treats a failure reported without a kind as hard", () => {
    for (let failure = 0; failure < BREAKER.failure_threshold; failure += 1) {
      breakers.onFailure(KEY);
    }
    expect(breakers.snapshot(KEY).cooldownMs).toBe(HARD_COOLDOWN_MS);
  });

  it("falls back to cooldown_ms when no capacity window is configured, and never lets it exceed cooldown_ms", () => {
    const legacy = new CircuitBreakerRegistry(
      { failure_threshold: 1, cooldown_ms: HARD_COOLDOWN_MS, half_open_probes: 1 },
      now,
    );
    legacy.onFailure(KEY, "capacity");
    expect(legacy.snapshot(KEY).cooldownMs).toBe(HARD_COOLDOWN_MS);

    const inverted = new CircuitBreakerRegistry(
      {
        failure_threshold: 1,
        cooldown_ms: CAPACITY_COOLDOWN_MS,
        capacity_cooldown_ms: HARD_COOLDOWN_MS,
        half_open_probes: 1,
      },
      now,
    );
    inverted.onFailure(KEY, "capacity");
    expect(inverted.snapshot(KEY).cooldownMs).toBe(CAPACITY_COOLDOWN_MS);
  });
});

describe("chain classification of capacity signals", () => {
  /** Opens on the first failure, so one call shows which window it earned. */
  const ONE_STRIKE: LlmBreakerDefaults = {
    failure_threshold: 1,
    cooldown_ms: HARD_COOLDOWN_MS,
    capacity_cooldown_ms: CAPACITY_COOLDOWN_MS,
    half_open_probes: 1,
  };

  afterEach(() => {
    resetProviderGuards();
  });

  /**
   * Run a one-leg chain whose leg behaves as scripted, and report the kind the
   * breaker recorded.
   *
   * @param behaviour What the leg does.
   * @returns The breaker's recorded failure kind.
   */
  async function kindAfter(
    behaviour: ReturnType<typeof fails> | ReturnType<typeof hangs>,
  ): Promise<string | null> {
    const breakers = new CircuitBreakerRegistry(ONE_STRIKE);
    const route = makeRoute({ alias: "llm.fast", role: "primary", timeoutMs: SHORT_LEG_MS });
    const transport = new ScriptedTransport("gateway", () => behaviour);
    const legs: ChainLeg[] = [{ route, transport, params: {} }];
    await executeChain<string>("llm.fast", {
      legs,
      content: "prompt",
      responseFormat: "text",
      breakers,
    }).catch(() => undefined);
    return breakers.snapshot(route.routeKey).failureKind;
  }

  /**
   * An error carrying an HTTP status, as the gateway transport raises.
   *
   * @param status The status.
   * @param body The body excerpt.
   * @returns The error.
   */
  function statusError(status: number, body: string): Error {
    return Object.assign(new Error(`LLM gateway returned ${status}: ${body}`), { status });
  }

  it("reads DeepInfra's 'Model busy, retry later' as capacity", async () => {
    expect(await kindAfter(fails(new Error("Model busy, retry later")))).toBe("capacity");
  });

  it("reads 429, 503 and 529 as capacity", async () => {
    for (const status of [429, 503, 529]) {
      expect(await kindAfter(fails(statusError(status, "{}")))).toBe("capacity");
    }
  });

  it("reads a leg timeout as capacity", async () => {
    expect(await kindAfter(hangs())).toBe("capacity");
  });

  it("reads a rejected credential or a malformed request as hard", async () => {
    expect(await kindAfter(fails(statusError(401, "invalid x-api-key")))).toBe("hard");
    expect(await kindAfter(fails(statusError(400, "bad request")))).toBe("hard");
    expect(await kindAfter(fails(new Error("ECONNREFUSED")))).toBe("hard");
  });

  it("recognises capacity signals by status or wording", () => {
    expect(isCapacitySignal({ status: 529 }, "")).toBe(true);
    expect(isCapacitySignal(new Error("x"), "Overloaded")).toBe(true);
    expect(isCapacitySignal(new Error("x"), "Too Many Requests")).toBe(true);
    expect(isCapacitySignal({ status: 500 }, "internal error")).toBe(false);
    expect(isCapacitySignal(new Error("x"), "unsupported capability: vision")).toBe(false);
  });
});
