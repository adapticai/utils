import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callLLMByAlias, configureLlmClient } from "../../../llm/alias-client";
import { ChainExhaustedError } from "../../../llm/fallback-chain";
import { resolveChain } from "../../../llm/route-table";
import {
  GatewayResponseError,
  createGatewayTransport,
} from "../../../llm/transports/gateway";
import type { LlmTransport, LlmTransportRequest } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { makeRoute } from "./support/routes";
import { ScriptedTransport, fails } from "./support/transports";

/** An alias whose chain has more than one leg, so "every leg" is a real claim. */
const ALIAS = "llm.extract";

/** Env var the gateway transport reads its key from, by NAME. */
const GATEWAY_KEY_ENV = "LLM_GATEWAY_API_KEY";

/** An env var deliberately left unset, to exercise the unprovisioned-key path. */
const UNSET_KEY_ENV = "LLM_GATEWAY_API_KEY_ABSENT_FOR_TEST";

/**
 * A credential-shaped value planted in the environment.
 *
 * Distinctive enough that a substring search for it cannot match anything the
 * module legitimately says, so any hit is a genuine leak rather than a
 * coincidence.
 *
 * Assembled at runtime rather than written as a literal. The repo-wide secret
 * scan reads source text and cannot tell a test's sentinel from a real key, and
 * the right answer to that is to keep credential-shaped text out of the tree
 * rather than to teach the scanner exceptions — an exception list is how a
 * scanner stops catching the thing it exists to catch.
 */
const SENTINEL_KEY = ["sk", "test", "9f2c4e7a1b6d8e0f", "do-not-leak"].join("-");

/** Base URL the transport is pointed at; no request ever leaves the process. */
const GATEWAY_URL = "https://llm-gateway.invalid";

/** A gateway status that is a provider failure relayed by a healthy proxy. */
const RELAYED_BAD_GATEWAY = 502;

/** A gateway status meaning the caller's own credentials were rejected. */
const UNAUTHORIZED = 401;

/** The answer a healthy leg gives while reporting no usage block at all. */
const ANSWER_WITHOUT_USAGE = "the model still answered";

/** A model the proxy reports serving, distinct from any fixture route model. */
const SERVED_BY_PROXY_FALLBACK = "vendor/fallback-model-served-by-proxy";

/** A proxy deployment id, as the LiteLLM proxy reports it in a header. */
const DEPLOYMENT_ID = "deployment-7f3a";

/** Cost the proxy reports in its header, in USD. */
const HEADER_COST_USD = 0.0042;

/** Token counts a reporting provider returns. */
const PROMPT_TOKENS = 1200;
const COMPLETION_TOKENS = 80;

/** Headers the transport actually sent, captured to prove the key was read. */
interface CapturedRequest {
  authorization: string | null;
}

/**
 * Build a gateway transport over a stubbed fetch.
 *
 * @param respond Produces the response (or throws) for each request.
 * @param captured Receives the outgoing authorization header.
 * @param apiKeyEnv Env-var NAME the transport should read.
 * @returns The transport.
 */
function gatewayOver(
  respond: () => Response,
  captured: CapturedRequest,
  apiKeyEnv: string = GATEWAY_KEY_ENV,
): LlmTransport {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    captured.authorization = headers.get("authorization");
    return respond();
  };
  return createGatewayTransport({
    baseUrl: GATEWAY_URL,
    apiKeyEnv,
    fetchImpl,
    modelNameFor: (request: LlmTransportRequest) => request.route.alias,
  });
}

/**
 * Build a transport request for a leg.
 *
 * @param responseFormat The shape the caller asked for.
 * @returns A minimal request.
 */
function requestFor(
  responseFormat: LlmTransportRequest["responseFormat"],
): LlmTransportRequest {
  return {
    route: makeRoute({ alias: ALIAS }),
    content: "prompt",
    responseFormat,
    params: {},
    signal: new AbortController().signal,
  };
}

describe("no silent failure anywhere in the module", () => {
  let previousKey: string | undefined;

  beforeEach(() => {
    previousKey = process.env[GATEWAY_KEY_ENV];
    process.env[GATEWAY_KEY_ENV] = SENTINEL_KEY;
    delete process.env[UNSET_KEY_ENV];
    configureLlmClient({});
  });

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env[GATEWAY_KEY_ENV];
    } else {
      process.env[GATEWAY_KEY_ENV] = previousKey;
    }
    configureLlmClient({});
  });

  it("throws an exhausted-chain error naming every leg and its reason, returning no value", async () => {
    const chain = resolveChain(ALIAS);
    const gateway = new ScriptedTransport("gateway", (call) =>
      fails(
        new GatewayResponseError(
          RELAYED_BAD_GATEWAY,
          `upstream ${call.route.role} refused the request`,
        ),
      ),
    );
    const direct = new ScriptedTransport("direct", (call) =>
      fails(new Error(`direct path also failed for ${call.route.role}`)),
    );
    configureLlmClient({ gatewayTransport: gateway, directTransport: direct });

    const attempt = callLLMByAlias<string>("prompt", "text", { alias: ALIAS });
    await expect(attempt).rejects.toBeInstanceOf(ChainExhaustedError);

    const error = await rejection(attempt, ChainExhaustedError);
    expect(error.attempts).toHaveLength(chain.routes.length);
    for (const route of chain.routes) {
      expect(error.message).toContain(route.role);
      expect(error.message).toContain(route.providerName);
      expect(error.message).toContain(`upstream ${route.role} refused the request`);
    }
  });

  it("throws rather than yielding an empty object when a JSON answer does not parse", async () => {
    const captured: CapturedRequest = { authorization: null };
    const transport = gatewayOver(
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Sure! Here you go:" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      captured,
    );

    // A default here would hand the caller a well-typed value that means
    // nothing, and the failure would surface later as a decision made on
    // absent data.
    await expect(transport.execute(requestFor("json"))).rejects.toThrow(/not valid JSON/);
  });

  it("reports a missing usage block as unknown (null), never zero, and still surfaces the real answer", async () => {
    const captured: CapturedRequest = { authorization: null };
    const transport = gatewayOver(
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: ANSWER_WITHOUT_USAGE } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      captured,
    );

    const result = await transport.execute<string>(requestFor("text"));

    expect(result.response).toBe(ANSWER_WITHOUT_USAGE);
    // An estimated token count — zero included — flows straight into the
    // budget accounting the spend controls are built on, where a zero reads as
    // a free call; unknown must stay unknown to the consumer.
    expect(result.usage.prompt_tokens).toBeNull();
    expect(result.usage.completion_tokens).toBeNull();
    expect(result.usage.cost).toBeNull();
    expect(result.usage.reasoning_tokens).toBeUndefined();
    expect(result.usage.cached_tokens).toBeUndefined();
    // Nor is a serving model invented when the body names none.
    expect(result.servedModel).toBeNull();
    expect(result.servedDeploymentId).toBeNull();
  });

  it("keeps a reported zero as zero: only an absent count is unknown", async () => {
    const captured: CapturedRequest = { authorization: null };
    const transport = gatewayOver(
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: ANSWER_WITHOUT_USAGE } }],
            usage: { prompt_tokens: 0, completion_tokens: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      captured,
    );

    const result = await transport.execute<string>(requestFor("text"));

    expect(result.usage.prompt_tokens).toBe(0);
    expect(result.usage.completion_tokens).toBe(0);
    expect(result.usage.cost).toBeNull();
  });

  it("reads the served model from the body and the cost and deployment from the proxy's headers", async () => {
    const captured: CapturedRequest = { authorization: null };
    const transport = gatewayOver(
      () =>
        new Response(
          JSON.stringify({
            model: SERVED_BY_PROXY_FALLBACK,
            choices: [{ message: { content: ANSWER_WITHOUT_USAGE } }],
            usage: { prompt_tokens: PROMPT_TOKENS, completion_tokens: COMPLETION_TOKENS },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-litellm-response-cost": String(HEADER_COST_USD),
              "x-litellm-model-id": DEPLOYMENT_ID,
            },
          },
        ),
      captured,
    );

    const result = await transport.execute<string>(requestFor("text"));

    // The leg's route model stays the table's credit; the model that actually
    // answered is reported beside it, so a proxy-side substitution is visible.
    expect(result.usage.model).not.toBe(SERVED_BY_PROXY_FALLBACK);
    expect(result.servedModel).toBe(SERVED_BY_PROXY_FALLBACK);
    expect(result.servedDeploymentId).toBe(DEPLOYMENT_ID);
    expect(result.usage.prompt_tokens).toBe(PROMPT_TOKENS);
    expect(result.usage.completion_tokens).toBe(COMPLETION_TOKENS);
    expect(result.usage.cost).toBe(HEADER_COST_USD);
  });

  it("names the unset environment variable when the gateway key is not provisioned", async () => {
    const captured: CapturedRequest = { authorization: null };
    const transport = gatewayOver(
      () => new Response("{}", { status: 200 }),
      captured,
      UNSET_KEY_ENV,
    );

    await expect(transport.execute(requestFor("text"))).rejects.toThrow(UNSET_KEY_ENV);
    // The request must never have been sent unauthenticated.
    expect(captured.authorization).toBeNull();
  });

  it("never puts the credential it read into any message it raises", async () => {
    const messages: string[] = [];

    const networkCaptured: CapturedRequest = { authorization: null };
    const networkDown = gatewayOver(
      () => {
        throw new Error("connect ECONNREFUSED 10.0.0.1:443");
      },
      networkCaptured,
    );
    await networkDown.execute(requestFor("text")).catch((error: unknown) => {
      messages.push(String(error), JSON.stringify(error));
    });
    // Anti-vacuity: the transport really did read and send the key, so a leak
    // was possible and its absence below is a property of the module.
    expect(networkCaptured.authorization).toBe(`Bearer ${SENTINEL_KEY}`);

    const rejectedCaptured: CapturedRequest = { authorization: null };
    const rejected = gatewayOver(
      () =>
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: UNAUTHORIZED,
        }),
      rejectedCaptured,
    );
    await rejected.execute(requestFor("text")).catch((error: unknown) => {
      messages.push(String(error), JSON.stringify(error));
    });

    const unparseableCaptured: CapturedRequest = { authorization: null };
    const unparseable = gatewayOver(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "nope" } }] }), {
          status: 200,
        }),
      unparseableCaptured,
    );
    await unparseable.execute(requestFor("json")).catch((error: unknown) => {
      messages.push(String(error), JSON.stringify(error));
    });

    configureLlmClient({
      gatewayTransport: networkDown,
      // The degraded path fails too, so the credential is exposed to every
      // message the client raises on the way out, not just the gateway's.
      directTransport: new ScriptedTransport("direct", () =>
        fails(new Error("degraded path unavailable")),
      ),
    });
    await callLLMByAlias<string>("prompt", "text", { alias: ALIAS }).catch(
      (error: unknown) => {
        messages.push(String(error), JSON.stringify(error));
        if (error instanceof ChainExhaustedError) {
          for (const attempt of error.attempts) {
            messages.push(attempt.reason ?? "");
          }
        }
      },
    );

    // Every failure shape actually ran, so the sweep below has something to sweep.
    expect(messages.some((message) => message.includes("is unreachable"))).toBe(true);
    expect(messages.some((message) => message.includes("not valid JSON"))).toBe(true);
    expect(
      messages.some((message) => message.includes("exhausted its fallback chain")),
    ).toBe(true);
    for (const message of messages) {
      expect(message, "a raised message carried the gateway credential").not.toContain(
        SENTINEL_KEY,
      );
    }
  });
});
