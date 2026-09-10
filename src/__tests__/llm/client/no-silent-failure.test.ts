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
 */
const SENTINEL_KEY = "sk-test-9f2c4e7a1b6d8e0f-do-not-leak";

/** Base URL the transport is pointed at; no request ever leaves the process. */
const GATEWAY_URL = "https://llm-gateway.invalid";

/** A gateway status that is a provider failure relayed by a healthy proxy. */
const RELAYED_BAD_GATEWAY = 502;

/** A gateway status meaning the caller's own credentials were rejected. */
const UNAUTHORIZED = 401;

/** The answer a healthy leg gives while reporting no usage block at all. */
const ANSWER_WITHOUT_USAGE = "the model still answered";

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

  it("reports zero counts for a missing usage block, and still surfaces the real answer", async () => {
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
    // An estimated token count flows straight into the budget accounting the
    // spend controls are built on; a budget computed from invented numbers is
    // worse than one that knows it is missing a call.
    expect(result.usage.prompt_tokens).toBe(0);
    expect(result.usage.completion_tokens).toBe(0);
    expect(result.usage.cost).toBe(0);
    expect(result.usage.reasoning_tokens).toBeUndefined();
    expect(result.usage.cached_tokens).toBeUndefined();
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
