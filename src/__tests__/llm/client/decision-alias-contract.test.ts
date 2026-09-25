import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callLLMByAlias, configureLlmClient } from "../../../llm/alias-client";
import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import { executeChain, legBudgetMs, sumUsage } from "../../../llm/fallback-chain";
import type { ChainLeg } from "../../../llm/fallback-chain";
import { normaliseParams } from "../../../llm/param-matrix";
import { createDirectTransport } from "../../../llm/transports/direct";
import { resetProviderGuards } from "../../../llm/rate-guard";
import { resolveChain, routeTable } from "../../../llm/route-table";
import type { LlmToolCall, LlmUsageRecord, ResolvedRoute } from "../../../llm/types";
import { CLOSED_PROVIDER, TEST_LEG_TIMEOUT_MS, makeRoute } from "./support/routes";
import { ScriptedTransport, answers, hangs, usageFor } from "./support/transports";

/** The hot-path alias the per-symbol decision call is served by today. */
const HOT_PATH_ALIAS = "llm.fast";

/** A constructed-chain alias for executor-level tests. */
const CHAIN_ALIAS = "llm.extract";

/** The hot-path class's per-leg route budget, read from the table itself. */
const HOT_PATH_LEG_MS = routeTable.defaults.request_timeout_ms["hot-path"];

/** The engine's governed decision deadline: three hot-path legs' worth. */
const DECISION_DEADLINE_MS = 3 * HOT_PATH_LEG_MS;

/** A caller deadline that ends part-way through the second leg. */
const PARTIAL_DEADLINE_MS = TEST_LEG_TIMEOUT_MS + TEST_LEG_TIMEOUT_MS / 2;

/** A tool definition; its contents are irrelevant to the routing layer. */
const DECISION_TOOL = {
  type: "function",
  function: { name: "generate_trade_signal", parameters: { type: "object", properties: {} } },
} as const;

/** A tool call a leg returns when it honours a mandatory tool choice. */
const TOOL_CALL: LlmToolCall = {
  id: "call-1",
  type: "function",
  function: { name: "generate_trade_signal", arguments: "{}" },
};

/** A model a proxy reports serving, distinct from every route model. */
const PROXY_SERVED_MODEL = "vendor/proxy-substituted-model";

/** Token counts used where a sum has to be checked. */
const PROMPT_A = 100;
const PROMPT_B = 250;

/**
 * Wrap routes as chain legs sharing one transport, with their normalised params.
 *
 * @param routes The legs.
 * @param transport The transport.
 * @param params Params every leg is sent.
 * @returns Prepared legs.
 */
function legsOf(
  routes: readonly ResolvedRoute[],
  transport: ScriptedTransport,
  params: Record<string, unknown> = {},
): ChainLeg[] {
  return routes.map((route) => ({ route, transport, params }));
}

describe("the caller's timeout is one deadline shared across the chain", () => {
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

  it("abandons a hanging primary at its route budget so the secondary answers inside the deadline", async () => {
    const gateway = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? hangs()
        : answers("secondary answer", usageFor(call.route, { completionTokens: 5 })),
    );
    configureLlmClient({ gatewayTransport: gateway, now: () => Date.now() });

    const pending = callLLMByAlias<string>("prompt", "text", {
      alias: HOT_PATH_ALIAS,
      timeoutMs: DECISION_DEADLINE_MS,
    });
    await vi.advanceTimersByTimeAsync(HOT_PATH_LEG_MS);
    const result = await pending;

    // Were the caller's deadline handed to every leg as its own budget, the
    // primary would hold the whole deadline and the secondary would never run.
    expect(result.servedBy.role).toBe("secondary");
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(["timeout", "ok"]);
    expect(result.attempts[0].budgetMs).toBe(HOT_PATH_LEG_MS);
    expect(result.attempts[0].durationMs).toBe(HOT_PATH_LEG_MS);
  });

  it("gives a later leg only what remains of the deadline and never dispatches a leg past it", async () => {
    const [primary, secondary, closed] = [
      makeRoute({ alias: CHAIN_ALIAS, role: "primary" }),
      makeRoute({ alias: CHAIN_ALIAS, role: "secondary" }),
      makeRoute({ alias: CHAIN_ALIAS, role: "closed_incumbent" }),
    ];
    const transport = new ScriptedTransport("gateway", () => hangs());
    const breakers = new CircuitBreakerRegistry(routeTable.defaults.circuit_breaker, () =>
      Date.now(),
    );

    const pending = executeChain<string>(CHAIN_ALIAS, {
      legs: legsOf([primary, secondary, closed], transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
      deadlineAtMs: Date.now() + PARTIAL_DEADLINE_MS,
      now: () => Date.now(),
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(PARTIAL_DEADLINE_MS);
    const error = (await pending) as { attempts: readonly { outcome: string; budgetMs?: number; reason?: string }[] };

    expect(error.attempts.map((attempt) => attempt.outcome)).toEqual([
      "timeout",
      "timeout",
      "skipped",
    ]);
    expect(error.attempts[0].budgetMs).toBe(TEST_LEG_TIMEOUT_MS);
    expect(error.attempts[1].budgetMs).toBe(PARTIAL_DEADLINE_MS - TEST_LEG_TIMEOUT_MS);
    expect(error.attempts[2].reason).toContain("deadline exhausted");
    // The third leg was recorded, never dispatched.
    expect(transport.routeKeys).toEqual([primary.routeKey, secondary.routeKey]);
  });

  it("never widens a leg past its route budget, however long the deadline", () => {
    expect(legBudgetMs(TEST_LEG_TIMEOUT_MS, Date.now() + DECISION_DEADLINE_MS, Date.now())).toBe(
      TEST_LEG_TIMEOUT_MS,
    );
    expect(legBudgetMs(TEST_LEG_TIMEOUT_MS, undefined, Date.now())).toBe(TEST_LEG_TIMEOUT_MS);
  });
});

describe("a mandatory tool choice reaches only a route measured to honour it", () => {
  const withTools = {
    alias: CHAIN_ALIAS,
    tools: [DECISION_TOOL],
    toolChoice: "required",
  } as const;

  it("sends tool_choice \"required\" to a route that declares it honours it", () => {
    const route = makeRoute({ params: { supports_tool_choice: true } });
    expect(normaliseParams(withTools, route, "text").tool_choice).toBe("required");
  });

  it("omits it on a route that ignores it or was never measured", () => {
    for (const params of [{ supports_tool_choice: false }, {}]) {
      const route = makeRoute({ params });
      expect("tool_choice" in normaliseParams(withTools, route, "text")).toBe(false);
    }
  });

  it("leaves a caller that names no tool choice byte-identical to before", () => {
    const route = makeRoute({ params: { supports_tool_choice: true } });
    const params = normaliseParams({ alias: CHAIN_ALIAS, tools: [DECISION_TOOL] }, route, "text");
    expect(params).toEqual({ tools: [DECISION_TOOL], parallel_tool_calls: false });
  });

  it("never sends \"auto\", the default once tools are present, nor a choice without tools", () => {
    const route = makeRoute({ params: { supports_tool_choice: true } });
    expect("tool_choice" in normaliseParams({ ...withTools, toolChoice: "auto" }, route, "text")).toBe(
      false,
    );
    expect(
      "tool_choice" in normaliseParams({ alias: CHAIN_ALIAS, toolChoice: "required" }, route, "text"),
    ).toBe(false);
  });

  it("fails a declared-honouring leg that answers in prose, without charging its breaker", async () => {
    const primary = makeRoute({ alias: CHAIN_ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: CHAIN_ALIAS, role: "secondary" });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? answers("prose instead of a tool call", usageFor(call.route))
        : answers("", usageFor(call.route), [TOOL_CALL]),
    );
    const breakers = new CircuitBreakerRegistry(routeTable.defaults.circuit_breaker, () =>
      Date.now(),
    );

    const outcome = await executeChain<string>(CHAIN_ALIAS, {
      legs: legsOf([primary, secondary], transport, { tool_choice: "required" }),
      content: "prompt",
      responseFormat: "text",
      breakers,
    });

    expect(outcome.servedBy.routeKey).toBe(secondary.routeKey);
    expect(outcome.attempts[0].outcome).toBe("error");
    expect(outcome.attempts[0].reason).toContain("supports_tool_choice");
    expect(breakers.snapshot(primary.routeKey).consecutiveFailures).toBe(0);
  });
});

describe("the served model and unreported usage stay visible", () => {
  beforeEach(() => configureLlmClient({}));
  afterEach(() => configureLlmClient({}));

  it("carries the provider-reported serving model onto the result and the attempt record", async () => {
    const gateway: ScriptedTransport = new ScriptedTransport("gateway", (call) =>
      answers("answer", usageFor(call.route)),
    );
    const reporting = {
      name: "gateway",
      execute: async <T,>(request: Parameters<ScriptedTransport["execute"]>[0]) => ({
        ...(await gateway.execute<T>(request)),
        servedModel: PROXY_SERVED_MODEL,
      }),
    };
    configureLlmClient({ gatewayTransport: reporting });

    const result = await callLLMByAlias<string>("prompt", "text", { alias: HOT_PATH_ALIAS });

    expect(result.servedModel).toBe(PROXY_SERVED_MODEL);
    expect(result.attempts.at(-1)?.servedModel).toBe(PROXY_SERVED_MODEL);
    // The table's credit for the leg is unchanged beside it.
    expect(result.servedBy.modelId).not.toBe(PROXY_SERVED_MODEL);
  });

  it("records a count the degraded path's client did not report as unknown, never zero", async () => {
    const direct = createDirectTransport({
      resolveCaller: async () => async <T,>() => ({ response: "answer" as unknown as T }),
    });
    const route = makeRoute({ role: "closed_incumbent", provider: CLOSED_PROVIDER });

    const result = await direct.execute<string>({
      route,
      content: "prompt",
      responseFormat: "text",
      params: {},
      signal: new AbortController().signal,
    });

    expect(result.usage.prompt_tokens).toBeNull();
    expect(result.usage.completion_tokens).toBeNull();
    expect(result.usage.cost).toBeNull();
    expect(result.servedModel).toBeNull();
  });

  it("makes a summed count unknown when any attempt did not report it", () => {
    const route = makeRoute();
    const reported = usageFor(route, { promptTokens: PROMPT_A, cost: 0.01 });
    const unreported: LlmUsageRecord = { ...usageFor(route), prompt_tokens: null, cost: null };

    expect(sumUsage(reported, usageFor(route, { promptTokens: PROMPT_B })).prompt_tokens).toBe(
      PROMPT_A + PROMPT_B,
    );
    const total = sumUsage(reported, unreported);
    expect(total.prompt_tokens).toBeNull();
    expect(total.cost).toBeNull();
    expect(total.completion_tokens).toBe(0);
  });
});

describe("llm.decide, the dedicated decision alias", () => {
  it("resolves to the advanced tier first, the current decision model second, the closed incumbent last", () => {
    const chain = resolveChain("llm.decide");

    expect(chain.routes.map((route) => [route.role, route.modelId])).toEqual([
      ["primary", "deepseek-ai/DeepSeek-V4-Pro"],
      ["secondary", "deepseek-ai/DeepSeek-V4-Flash"],
      ["closed_incumbent", "claude-haiku-4-5"],
    ]);
    // Hot-path legs, the budgets the decision call runs under today.
    expect(chain.routes.every((route) => route.timeoutMs === HOT_PATH_LEG_MS)).toBe(true);
  });

  it("sends a mandatory tool choice only to its closed incumbent, the one leg measured to honour it", () => {
    const sent = resolveChain("llm.decide").routes.map(
      (route) =>
        normaliseParams(
          { alias: "llm.decide", tools: [DECISION_TOOL], toolChoice: "required" },
          route,
          "text",
        ).tool_choice,
    );

    expect(sent).toEqual([undefined, undefined, "required"]);
  });

  it("on llm.fast, the live decision alias, sends it to the legs measured to honour it and omits it on the unmeasured primary", () => {
    const sent = resolveChain("llm.fast").routes.map((route) => [
      route.modelId,
      normaliseParams(
        { alias: "llm.fast", tools: [DECISION_TOOL], toolChoice: "required" },
        route,
        "text",
      ).tool_choice,
    ]);

    // gpt-oss-20b calls a fitting tool under a mandatory choice (llm-bench
    // probe, 2026-09-15); this DeepSeek-V4-Flash id has not been probed.
    expect(sent).toEqual([
      ["deepseek-ai/DeepSeek-V4-Flash", undefined],
      ["openai/gpt-oss-20b", "required"],
      ["claude-haiku-4-5", "required"],
    ]);
  });
});
