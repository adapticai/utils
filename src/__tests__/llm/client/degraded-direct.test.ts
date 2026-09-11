import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callLLMByAlias, configureLlmClient, llmBreakers } from "../../../llm/alias-client";
import { ChainExhaustedError } from "../../../llm/fallback-chain";
import { resolveChain } from "../../../llm/route-table";
import {
  DirectTransportRefusedError,
  createDirectTransport,
} from "../../../llm/transports/direct";
import {
  GatewayResponseError,
  GatewayUnreachableError,
} from "../../../llm/transports/gateway";
import type { LlmTransportRequest, ResolvedRoute } from "../../../llm/types";
import { CLOSED_PROVIDER, OPEN_PROVIDER, makeRoute } from "./support/routes";
import { ScriptedTransport, answers, fails, usageFor } from "./support/transports";

/** An alias whose chain has an open-tier head and a closed-tier incumbent. */
const ALIAS = "llm.extract";

/** Base URL the unreachable-gateway error names; never actually contacted. */
const GATEWAY_URL = "https://llm-gateway.invalid";

/** A gateway status that is a PROVIDER failure relayed by a healthy proxy. */
const RELAYED_BAD_GATEWAY = 502;

/** What the degraded direct path is scripted to answer. */
const DIRECT_ANSWER = "answered without the gateway";

/** What the gateway is scripted to answer when it is healthy. */
const GATEWAY_ANSWER = "answered through the gateway";

/**
 * A gateway that cannot be reached at all.
 *
 * @returns The error the transport raises when the proxy is gone.
 */
function unreachable(): GatewayUnreachableError {
  return new GatewayUnreachableError(GATEWAY_URL, new Error("connect ECONNREFUSED"));
}

/**
 * Build a transport request for a leg, for transports exercised in isolation.
 *
 * @param route The leg to execute.
 * @returns A minimal request.
 */
function requestFor(route: ResolvedRoute): LlmTransportRequest {
  return {
    route,
    content: "prompt",
    responseFormat: "text",
    params: {},
    signal: new AbortController().signal,
  };
}

describe("degraded direct path", () => {
  beforeEach(() => {
    // Configuration is process-wide, so it is re-established per test to keep
    // breaker state from one case leaking into the next.
    configureLlmClient({});
  });

  afterEach(() => {
    configureLlmClient({});
  });

  it("serves from the direct transport when the gateway itself is gone, and says it degraded", async () => {
    const gateway = new ScriptedTransport("gateway", () => fails(unreachable()));
    const direct = new ScriptedTransport("direct", (call) =>
      answers(DIRECT_ANSWER, usageFor(call.route)),
    );
    configureLlmClient({ gatewayTransport: gateway, directTransport: direct });

    const result = await callLLMByAlias<string>("prompt", "text", { alias: ALIAS });

    expect(result.response).toBe(DIRECT_ANSWER);
    expect(result.degraded).toBe(true);
    expect(result.servedBy.provider.tier).toBe("closed");
    expect(gateway.calls.length).toBeGreaterThan(0);
    expect(direct.calls).toHaveLength(1);
  });

  it("offers the direct transport closed-tier legs only", async () => {
    const chain = resolveChain(ALIAS);
    expect(chain.routes.some((route) => route.provider.tier !== "closed")).toBe(true);

    const gateway = new ScriptedTransport("gateway", () => fails(unreachable()));
    const direct = new ScriptedTransport("direct", (call) =>
      answers(DIRECT_ANSWER, usageFor(call.route)),
    );
    configureLlmClient({ gatewayTransport: gateway, directTransport: direct });

    await callLLMByAlias<string>("prompt", "text", { alias: ALIAS });

    expect(direct.calls.length).toBeGreaterThan(0);
    expect(direct.tiers).toEqual(direct.calls.map(() => "closed"));
    expect(direct.routeKeys).not.toContain(chain.routes[0].routeKey);
  });

  it("refuses an open-tier leg outright rather than widening under pressure", async () => {
    let resolverCalled = false;
    const direct = createDirectTransport({
      resolveCaller: async () => {
        resolverCalled = true;
        throw new Error("the caller must never be resolved for a refused leg");
      },
    });

    const openLeg = makeRoute({ alias: ALIAS, role: "primary", provider: OPEN_PROVIDER });
    await expect(direct.execute(requestFor(openLeg))).rejects.toBeInstanceOf(
      DirectTransportRefusedError,
    );
    await expect(direct.execute(requestFor(openLeg))).rejects.toThrow(/only a closed incumbent/);
    expect(resolverCalled).toBe(false);

    const unregistered = makeRoute({
      alias: ALIAS,
      role: "closed_incumbent",
      provider: CLOSED_PROVIDER,
      lumicModel: null,
    });
    await expect(direct.execute(requestFor(unregistered))).rejects.toBeInstanceOf(
      DirectTransportRefusedError,
    );
    expect(resolverCalled).toBe(false);
  });

  it("treats a provider error relayed BY the gateway as a normal chain event", async () => {
    const chain = resolveChain(ALIAS);
    const gateway = new ScriptedTransport("gateway", (call) =>
      call.route.provider.tier === "closed"
        ? answers(GATEWAY_ANSWER, usageFor(call.route))
        : fails(new GatewayResponseError(RELAYED_BAD_GATEWAY, "upstream provider overloaded")),
    );
    const direct = new ScriptedTransport("direct", (call) =>
      answers(DIRECT_ANSWER, usageFor(call.route)),
    );
    configureLlmClient({ gatewayTransport: gateway, directTransport: direct });

    const result = await callLLMByAlias<string>("prompt", "text", { alias: ALIAS });

    // A single flaky provider must not move every call onto the closed
    // incumbent by the degraded route, which reports none of the gateway's
    // budget, logging, or isolation guarantees.
    expect(result.degraded).toBe(false);
    expect(result.response).toBe(GATEWAY_ANSWER);
    expect(direct.calls).toHaveLength(0);
    expect(gateway.routeKeys).toEqual(chain.routes.map((route) => route.routeKey));
    // Derived from the chain rather than written out, so adding an open-weight
    // fallback leg to the alias does not read as a regression here. What the
    // case actually asserts is the SHAPE: every open leg is relayed the
    // provider error and the closed incumbent answers — not that the chain
    // happens to be two legs long.
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(
      chain.routes.map((route) => (route.provider.tier === "closed" ? "ok" : "error")),
    );
    // Anchors the shape: without an open leg to fail and a closed one to
    // answer, the expectation above would be satisfied vacuously.
    expect(chain.routes.filter((route) => route.provider.tier !== "closed").length).toBeGreaterThan(0);
    expect(chain.routes.filter((route) => route.provider.tier === "closed").length).toBe(1);
  });

  it("exhausts the chain rather than degrading when every leg is relayed a provider error", async () => {
    const gateway = new ScriptedTransport("gateway", () =>
      fails(new GatewayResponseError(RELAYED_BAD_GATEWAY, "upstream provider overloaded")),
    );
    const direct = new ScriptedTransport("direct", (call) =>
      answers(DIRECT_ANSWER, usageFor(call.route)),
    );
    configureLlmClient({ gatewayTransport: gateway, directTransport: direct });

    await expect(
      callLLMByAlias<string>("prompt", "text", { alias: ALIAS }),
    ).rejects.toBeInstanceOf(ChainExhaustedError);
    expect(direct.calls).toHaveLength(0);
  });

  it("counts a gateway outage against route health, and a refusal is not an answer", async () => {
    const gateway = new ScriptedTransport("gateway", () => fails(unreachable()));
    const direct = new ScriptedTransport("direct", () =>
      fails(new DirectTransportRefusedError("llm.extract#closed_incumbent", "test refusal")),
    );
    configureLlmClient({ gatewayTransport: gateway, directTransport: direct });

    await expect(
      callLLMByAlias<string>("prompt", "text", { alias: ALIAS }),
    ).rejects.toBeInstanceOf(ChainExhaustedError);

    const head = resolveChain(ALIAS).routes[0];
    expect(llmBreakers().snapshot(head.routeKey).consecutiveFailures).toBeGreaterThan(0);
  });
});
