import { beforeEach, describe, expect, it } from "vitest";

import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import { ChainExhaustedError, executeChain, sumUsage } from "../../../llm/fallback-chain";
import type { ChainLeg } from "../../../llm/fallback-chain";
import { routeTable } from "../../../llm/route-table";
import type { AliasAttemptRecord, LlmUsageRecord, ResolvedRoute } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { makeThreeLegChain } from "./support/routes";
import { ScriptedTransport, answers, fails, usageFor } from "./support/transports";

/** The alias these constructed chains stand in for. */
const ALIAS = "llm.extract";

/** Token counts the incumbent reports, chosen distinct so attribution is visible. */
const INCUMBENT_PROMPT_TOKENS = 120;

/** Completion tokens the incumbent reports. */
const INCUMBENT_COMPLETION_TOKENS = 45;

/** Cost the incumbent reports, in dollars. */
const INCUMBENT_COST = 0.0042;

/** Token counts the two failed legs would have reported had they answered. */
const PRIMARY_USAGE = { promptTokens: 10, completionTokens: 3, cost: 0.001 } as const;

/** Token counts for the second leg of the summation fixture. */
const SECONDARY_USAGE = { promptTokens: 20, completionTokens: 5, cost: 0.002 } as const;

/** The answer only the closed incumbent is scripted to give. */
const INCUMBENT_ANSWER = "answered by the retained closed vendor";

/** Digits of agreement required when comparing accumulated floating-point cost. */
const COST_PRECISION_DIGITS = 10;

/** Zero-valued usage, the identity the executor starts its accumulation from. */
const EMPTY_USAGE: LlmUsageRecord = {
  prompt_tokens: 0,
  completion_tokens: 0,
  provider: "none",
  model: "none",
  cost: 0,
};

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

describe("ordered fallback chain (PD-3)", () => {
  let breakers: CircuitBreakerRegistry;

  beforeEach(() => {
    breakers = new CircuitBreakerRegistry(routeTable.defaults.circuit_breaker);
  });

  it("walks past two failed legs and serves the closed incumbent's answer", async () => {
    const routes = makeThreeLegChain(ALIAS);
    const transport = new ScriptedTransport("gateway", (call) => {
      if (call.route.role === "closed_incumbent") {
        return answers(
          INCUMBENT_ANSWER,
          usageFor(call.route, {
            promptTokens: INCUMBENT_PROMPT_TOKENS,
            completionTokens: INCUMBENT_COMPLETION_TOKENS,
            cost: INCUMBENT_COST,
          }),
        );
      }
      return fails(new Error(`${call.route.role} provider returned 503`));
    });

    const outcome = await executeChain<string>(ALIAS, {
      legs: legsOf(routes, transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
    });

    expect(outcome.response.response).toBe(INCUMBENT_ANSWER);
    expect(outcome.servedBy.routeKey).toBe(routes[2].routeKey);
    expect(outcome.servedBy.provider.tier).toBe("closed");
    expect(transport.routeKeys).toEqual(routes.map((route) => route.routeKey));
  });

  it("records every leg in chain order with its own outcome", async () => {
    const routes = makeThreeLegChain(ALIAS);
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "closed_incumbent"
        ? answers(INCUMBENT_ANSWER, usageFor(call.route))
        : fails(new Error(`${call.route.role} provider returned 503`)),
    );

    const outcome = await executeChain<string>(ALIAS, {
      legs: legsOf(routes, transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
    });

    expect(outcome.attempts.map((attempt) => attempt.role)).toEqual([
      "primary",
      "secondary",
      "closed_incumbent",
    ]);
    expect(outcome.attempts.map((attempt) => attempt.outcome)).toEqual([
      "error",
      "error",
      "ok",
    ]);
    expect(outcome.attempts[0].reason).toContain("primary provider returned 503");
    expect(outcome.attempts[1].reason).toContain("secondary provider returned 503");
    expect(outcome.attempts[2].reason).toBeUndefined();
  });

  it("attributes usage to the leg that answered and invents nothing for the legs that did not", async () => {
    const routes = makeThreeLegChain(ALIAS);
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "closed_incumbent"
        ? answers(
            INCUMBENT_ANSWER,
            usageFor(call.route, {
              promptTokens: INCUMBENT_PROMPT_TOKENS,
              completionTokens: INCUMBENT_COMPLETION_TOKENS,
              cost: INCUMBENT_COST,
            }),
          )
        : fails(new Error("provider returned 503")),
    );

    const outcome = await executeChain<string>(ALIAS, {
      legs: legsOf(routes, transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
    });

    expect(outcome.totalUsage.prompt_tokens).toBe(INCUMBENT_PROMPT_TOKENS);
    expect(outcome.totalUsage.completion_tokens).toBe(INCUMBENT_COMPLETION_TOKENS);
    expect(outcome.totalUsage.cost).toBe(INCUMBENT_COST);
    expect(outcome.totalUsage.provider).toBe(routes[2].providerName);
    expect(outcome.totalUsage.model).toBe(routes[2].modelId);
    expect(outcome.response.usage.provider).toBe(routes[2].providerName);

    // A leg that never produced an answer produced no tokens either, and a
    // zeroed record would read as a measurement rather than an absence.
    expect(outcome.attempts[0].usage).toBeUndefined();
    expect(outcome.attempts[1].usage).toBeUndefined();
  });

  it("sums usage across every attempt while attributing to the answering leg", () => {
    const routes = makeThreeLegChain(ALIAS);
    const first = usageFor(routes[0], PRIMARY_USAGE);
    const second = usageFor(routes[1], SECONDARY_USAGE);
    const third = usageFor(routes[2], {
      promptTokens: INCUMBENT_PROMPT_TOKENS,
      completionTokens: INCUMBENT_COMPLETION_TOKENS,
      cost: INCUMBENT_COST,
    });

    const total = sumUsage(sumUsage(sumUsage(EMPTY_USAGE, first), second), third);

    // Charging only the successful attempt would understate spend by exactly
    // what the failures cost, which is the amount a fallback chain runs up.
    expect(total.prompt_tokens).toBe(
      PRIMARY_USAGE.promptTokens + SECONDARY_USAGE.promptTokens + INCUMBENT_PROMPT_TOKENS,
    );
    expect(total.completion_tokens).toBe(
      PRIMARY_USAGE.completionTokens +
        SECONDARY_USAGE.completionTokens +
        INCUMBENT_COMPLETION_TOKENS,
    );
    expect(total.cost).toBeCloseTo(
      PRIMARY_USAGE.cost + SECONDARY_USAGE.cost + INCUMBENT_COST,
      COST_PRECISION_DIGITS,
    );
    expect(total.provider).toBe(routes[2].providerName);
    expect(total.model).toBe(routes[2].modelId);
  });

  it("throws with every leg and its reason when the chain is exhausted, and returns no value", async () => {
    const routes = makeThreeLegChain(ALIAS);
    const transport = new ScriptedTransport("gateway", (call) =>
      fails(new Error(`${call.route.role} provider returned 503`)),
    );

    const attempt = executeChain<string>(ALIAS, {
      legs: legsOf(routes, transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
    });

    await expect(attempt).rejects.toBeInstanceOf(ChainExhaustedError);
    const error = await rejection(attempt, ChainExhaustedError);

    expect(error.alias).toBe(ALIAS);
    expect(error.attempts).toHaveLength(routes.length);
    for (const route of routes) {
      const record = error.attempts.find(
        (entry: AliasAttemptRecord) => entry.routeKey === route.routeKey,
      );
      expect(record, `no attempt recorded for ${route.routeKey}`).toBeDefined();
      expect(record?.outcome).toBe("error");
      expect(error.message).toContain(route.providerName);
      expect(error.message).toContain(`${route.role} provider returned 503`);
    }
    expect(transport.calls).toHaveLength(routes.length);
  });
});
