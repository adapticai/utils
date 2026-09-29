import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isSameReportedModel,
  modelClassRelationOf,
} from "../../../llm/fallback-chain";
import {
  hasDuplicateHeadroom,
  limitsFor,
  resetProviderGuards,
  withProviderGuards,
} from "../../../llm/rate-guard";
import {
  EQUIVALENT_SEPARATOR,
  gatewayModelNameFor,
  resolveChain,
  routeTable,
  tailLatencyViolations,
} from "../../../llm/route-table";
import {
  SERVED_MODEL_HEADER,
  SERVED_PROVIDER_HEADER,
  createGatewayTransport,
  servedModelOf,
} from "../../../llm/transports/gateway";
import type { LlmRouteDefaults } from "../../../llm/types";
import { makeRoute } from "./support/routes";

/** Env var the transport reads its key from, by NAME. */
const GATEWAY_KEY_ENV = "LLM_GATEWAY_KEY_FOR_PROVENANCE_TEST";

/** The name the leg is addressed by, which a proxy may echo back as `model`. */
const ADDRESSED_AS = "llm.fast";

/** The upstream model the gateway says answered. */
const UPSTREAM_MODEL = "deepseek-ai/DeepSeek-V4-Flash";

/**
 * A gateway stand-in returning a fixed body and headers.
 *
 * @param bodyModel The body's `model`.
 * @param headers Extra response headers.
 * @returns A fetch implementation.
 */
function gatewayReturning(bodyModel: string, headers: Record<string, string> = {}): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        model: bodyModel,
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json", ...headers } },
    )) as unknown as typeof fetch;
}

/**
 * Execute one leg through the real gateway transport.
 *
 * @param fetchImpl The gateway stand-in.
 * @returns The transport response.
 */
async function executeThrough(fetchImpl: typeof fetch): Promise<{
  servedModel?: string | null;
  servedProvider?: string | null;
}> {
  const transport = createGatewayTransport({
    baseUrl: "https://llm-gateway.invalid",
    apiKeyEnv: GATEWAY_KEY_ENV,
    fetchImpl,
    modelNameFor: () => ADDRESSED_AS,
  });
  return transport.execute<string>({
    route: makeRoute({ alias: "llm.fast" }),
    content: "prompt",
    responseFormat: "text",
    params: {},
    signal: new AbortController().signal,
  });
}

describe("served-model provenance from the gateway", () => {
  beforeEach(() => {
    process.env[GATEWAY_KEY_ENV] = "test-gateway-key";
  });

  afterEach(() => {
    delete process.env[GATEWAY_KEY_ENV];
  });

  it("does not read the gateway's model-group echo as the model that answered", async () => {
    const response = await executeThrough(gatewayReturning(ADDRESSED_AS));
    expect(response.servedModel).toBeNull();
  });

  it("prefers the gateway's served-model header over the body", async () => {
    const response = await executeThrough(
      gatewayReturning(ADDRESSED_AS, {
        [SERVED_MODEL_HEADER]: UPSTREAM_MODEL,
        [SERVED_PROVIDER_HEADER]: "deepinfra",
      }),
    );
    expect(response.servedModel).toBe(UPSTREAM_MODEL);
    expect(response.servedProvider).toBe("deepinfra");
  });

  it("uses an upstream body model that is not the echo", () => {
    expect(servedModelOf(undefined, UPSTREAM_MODEL, ADDRESSED_AS)).toBe(UPSTREAM_MODEL);
    expect(servedModelOf(undefined, "", ADDRESSED_AS)).toBeNull();
  });
});

describe("model-class relation", () => {
  const primary = makeRoute({ alias: "llm.fast", role: "primary", modelId: UPSTREAM_MODEL });
  const configured = UPSTREAM_MODEL;

  it("is same only when the answer names the configured model", () => {
    expect(modelClassRelationOf(primary, configured, { outcome: "ok", servedModel: UPSTREAM_MODEL })).toBe(
      "same",
    );
    expect(
      modelClassRelationOf(primary, configured, { outcome: "ok", servedModel: "DeepSeek-V4-Flash" }),
    ).toBe("same");
  });

  it("is unknown when the configured model answered without saying so", () => {
    expect(modelClassRelationOf(primary, configured, { outcome: "ok", servedModel: null })).toBe("unknown");
  });

  it("is different for another model, reported or routed", () => {
    expect(
      modelClassRelationOf(primary, configured, { outcome: "ok", servedModel: "openai/gpt-oss-20b" }),
    ).toBe("different");
    const secondary = makeRoute({ alias: "llm.fast", role: "secondary", modelId: "openai/gpt-oss-20b" });
    expect(modelClassRelationOf(secondary, configured, { outcome: "timeout" })).toBe("different");
  });

  it("matches reported names with or without an organisation prefix, ignoring case", () => {
    expect(isSameReportedModel("deepseek-ai/deepseek-v4-flash", UPSTREAM_MODEL)).toBe(true);
    expect(isSameReportedModel("deepinfra/deepseek-ai/DeepSeek-V4-Flash", UPSTREAM_MODEL)).toBe(true);
    expect(isSameReportedModel("DeepSeek-V4-Pro", UPSTREAM_MODEL)).toBe(false);
  });
});

describe("route table: model class, equivalents and tail-latency bounds", () => {
  it("resolves every leg with its model class and latency class, and no dead retry field", () => {
    for (const route of resolveChain("llm.fast").routes) {
      expect(route.modelClass).toBe(route.modelId);
      expect(route.latencyClass).toBe("hot-path");
      expect(route.equivalents).toEqual([]);
      expect(route.retriesPerLeg).toBeUndefined();
    }
  });

  it("addresses an equivalent by its own gateway name", () => {
    const chain = resolveChain("llm.fast");
    const head = chain.routes[0];
    const equivalent = {
      ...head,
      providerName: "second-host",
      routeKey: `${head.routeKey}${EQUIVALENT_SEPARATOR}second-host`,
    };
    expect(gatewayModelNameFor(equivalent, chain)).toBe("llm.fast.equivalent.primary.second-host");
    expect(gatewayModelNameFor(head, chain)).toBe("llm.fast");
  });

  it("ships tail-latency defaults inside their bounds, with the latency trip disarmed", () => {
    expect(tailLatencyViolations(routeTable.defaults)).toEqual([]);
    expect(routeTable.defaults.circuit_breaker.latency_trip?.enabled).toBe(false);
  });

  it("rejects out-of-bounds tail-latency defaults", () => {
    const hedging = routeTable.defaults.hedging;
    if (hedging === undefined) {
      throw new Error("the shipped table must configure hedging");
    }
    const broken: LlmRouteDefaults = {
      ...routeTable.defaults,
      hedging: { ...hedging, hedge_quantile: 1, attempt_timeout_floor_ms: 0, prompt_token_buckets: [10, 5] },
      circuit_breaker: { ...routeTable.defaults.circuit_breaker, probe_fraction: 0.9 },
    };
    expect(tailLatencyViolations(broken).sort()).toEqual(
      [
        "circuit_breaker.probe_fraction must be in [0, 0.5]",
        "hedging.attempt_timeout_floor_ms must be at least 1000",
        "hedging.hedge_quantile must be in (0.5, 1)",
        "hedging.prompt_token_buckets must be positive and strictly ascending",
        "hedging.timeout_quantile must not be below hedging.hedge_quantile",
      ].sort(),
    );
  });
});

describe("duplicate headroom", () => {
  beforeEach(() => {
    resetProviderGuards();
  });

  afterEach(() => {
    resetProviderGuards();
  });

  it("admits a duplicate on an idle provider and refuses one that would eat the reserve", async () => {
    const provider = "anthropic";
    const model = "claude-haiku-4-5";
    const { max_concurrent: maxConcurrent } = limitsFor(provider, model);
    const reserve = 0.25;
    expect(hasDuplicateHeadroom(provider, model, reserve)).toBe(true);

    const releases: (() => void)[] = [];
    const held = maxConcurrent - Math.ceil(maxConcurrent * reserve);
    const calls = Array.from({ length: held }, () =>
      withProviderGuards(
        provider,
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
        undefined,
        { modelId: model },
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(hasDuplicateHeadroom(provider, model, reserve)).toBe(false);
    for (const release of releases) {
      release();
    }
    await Promise.all(calls);
    expect(hasDuplicateHeadroom(provider, model, reserve)).toBe(true);
  });
});
