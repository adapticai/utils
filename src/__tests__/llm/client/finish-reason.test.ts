import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDirectTransport } from "../../../llm/transports/direct";
import { createGatewayTransport } from "../../../llm/transports/gateway";
import { KNOWN_LLM_FINISH_REASONS } from "../../../llm/types";
import { CLOSED_PROVIDER, makeRoute } from "./support/routes";

/**
 * The provider's finish reason, carried to the consumer.
 *
 * A consumer cannot otherwise tell a reply the model CHOSE to end from one the
 * request's own output cap CUT: both arrive downstream as an absent or
 * unparseable answer, and they have opposite remedies. The engine's compact
 * decision contract caps output at 1024 tokens and is enforcing in production,
 * so `length` is the difference between "the model declined" and "we truncated
 * it ourselves".
 *
 * The invariant these tests exist for is that ABSENCE SURVIVES. A substituted
 * `"stop"` would make a truncated call read as a clean one — the silent-failure
 * shape this package forbids — so an unreported reason must arrive as `null`.
 */

/** Env var the gateway transport reads its key from, by NAME. */
const GATEWAY_KEY_ENV = "LLM_GATEWAY_KEY_FOR_FINISH_REASON_TEST";

/** The name the leg is addressed by. */
const ADDRESSED_AS = "llm.fast";

/**
 * A gateway stand-in whose answering choice carries the given finish reason.
 *
 * @param finishReason The choice's `finish_reason`; omitted entirely when
 *   `undefined`, which is how a provider that reports none behaves.
 * @returns A fetch implementation.
 */
function gatewayFinishing(finishReason?: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        model: ADDRESSED_AS,
        choices: [
          {
            message: { content: "ok" },
            ...(finishReason === undefined ? {} : { finish_reason: finishReason }),
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

/**
 * Execute one leg through the real gateway transport.
 *
 * @param fetchImpl The gateway stand-in.
 * @returns The transport response.
 */
async function throughGateway(
  fetchImpl: typeof fetch,
): Promise<{ finishReason?: string | null }> {
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

/**
 * Execute one leg through the real direct transport against a stub incumbent.
 *
 * @param finishReason What the incumbent reports, if anything.
 * @returns The transport response.
 */
async function throughDirect(
  finishReason?: unknown,
): Promise<{ finishReason?: string | null }> {
  const transport = createDirectTransport({
    resolveCaller: async () =>
      (async () => ({
        response: "ok" as never,
        usage: { prompt_tokens: 1, completion_tokens: 1, model: "incumbent-model" },
        ...(finishReason === undefined ? {} : { finish_reason: finishReason }),
      })) as never,
  });
  return transport.execute<string>({
    // The direct transport refuses any provider that is not closed-tier, so a
    // degraded call can never promote an open route past its evaluation gates.
    route: makeRoute({
      alias: "llm.fast",
      provider: CLOSED_PROVIDER,
      lumicModel: "incumbent-model",
    }),
    content: "prompt",
    responseFormat: "text",
    params: {},
    signal: new AbortController().signal,
  });
}

describe("provider finish reason", () => {
  beforeEach(() => {
    process.env[GATEWAY_KEY_ENV] = "test-gateway-key";
  });

  afterEach(() => {
    delete process.env[GATEWAY_KEY_ENV];
  });

  it("carries `length` off the answering choice, which is the truncation signal", async () => {
    const response = await throughGateway(gatewayFinishing("length"));
    expect(response.finishReason).toBe("length");
  });

  it("carries every reason the OpenAI-compatible contract defines", async () => {
    for (const reason of KNOWN_LLM_FINISH_REASONS) {
      const response = await throughGateway(gatewayFinishing(reason));
      expect(response.finishReason).toBe(reason);
    }
  });

  it("passes an unrecognized provider reason through verbatim", async () => {
    // Narrowing an unknown value to a known member would discard the only
    // evidence of what the provider actually did.
    const response = await throughGateway(gatewayFinishing("model_length_exceeded"));
    expect(response.finishReason).toBe("model_length_exceeded");
  });

  it("reports null when the provider reports none, never a substituted reason", async () => {
    const response = await throughGateway(gatewayFinishing(undefined));
    expect(response.finishReason).toBeNull();
    // The specific failure being foreclosed: absence must not become "stop".
    expect(response.finishReason).not.toBe("stop");
  });

  it("reports null for a present-but-unusable value rather than passing junk on", async () => {
    for (const junk of ["", "   ", 7, true, null, {}]) {
      const response = await throughGateway(gatewayFinishing(junk));
      expect(response.finishReason).toBeNull();
    }
  });

  it("reads the reason off the SAME choice that produced the answer", async () => {
    // A second choice carrying a different reason must not be mistaken for the
    // answering one.
    const twoChoices = (async () =>
      new Response(
        JSON.stringify({
          model: ADDRESSED_AS,
          choices: [
            { message: { content: "answer" }, finish_reason: "length" },
            { message: { content: "other" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const response = await throughGateway(twoChoices);
    expect(response.finishReason).toBe("length");
  });

  it("every constructing transport sets the field — the degraded path included", async () => {
    // The negative assertion this suite turns on: a transport that OMITS the
    // field leaves `finishReason` undefined, which is indistinguishable from
    // "the provider said nothing" at a consumer that only checks for null.
    // Both transports must therefore always set it.
    const gateway = await throughGateway(gatewayFinishing("length"));
    const direct = await throughDirect("length");
    for (const response of [gateway, direct]) {
      expect(Object.prototype.hasOwnProperty.call(response, "finishReason")).toBe(true);
      expect(response.finishReason).toBe("length");
    }
    // And each still sets it when the reason is absent.
    const gatewaySilent = await throughGateway(gatewayFinishing(undefined));
    const directSilent = await throughDirect(undefined);
    for (const response of [gatewaySilent, directSilent]) {
      expect(Object.prototype.hasOwnProperty.call(response, "finishReason")).toBe(true);
      expect(response.finishReason).toBeNull();
    }
  });
});
