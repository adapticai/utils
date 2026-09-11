import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callLLMByAlias, configureLlmClient } from "../../../llm/alias-client";
import { listAliases, resolveChain } from "../../../llm/route-table";
import type { LlmAlias } from "../../../llm/types";

/**
 * The gateway name each leg is addressed by, across MORE THAN ONE alias.
 *
 * The gateway registers a chain's head under the bare alias and every other leg
 * under "<alias>.fallback.<role>". The client derives the same names, and a
 * mismatch does not surface as a failure: the gateway rejects the unknown name,
 * the fallback chain absorbs the rejection, and the call succeeds from the NEXT
 * leg. Traffic looks healthy while the alias quietly stops using the model it
 * was chosen for — so the only way to catch it is to assert the NAMES, not the
 * outcomes.
 *
 * Every case dispatches at least two different aliases through one client,
 * because the defect only appears from the second alias onward: the transport
 * is built once per process, and a chain captured at construction binds it to
 * whichever alias dispatched first.
 *
 * The real gateway transport is exercised — only `fetch` is stubbed — because
 * the naming lives inside that transport. Injecting a transport instead would
 * bypass the very code under test and pass unconditionally.
 *
 * @module __tests__/llm/client/gateway-model-naming
 */

/** Base URL the transport is pointed at; no request leaves the process. */
const GATEWAY_URL = "https://llm-gateway.invalid";

/** Env var the transport reads its key from, by NAME. */
const GATEWAY_KEY_ENV = "LLM_GATEWAY_KEY_FOR_NAMING_TEST";

/** Model names captured from each outgoing request body, in dispatch order. */
let addressed: string[] = [];

/** The real global fetch, restored after each case. */
const realFetch = globalThis.fetch;

/**
 * Stand in for the gateway: record the addressed model and answer trivially.
 *
 * @param _url Request URL, unused.
 * @param init Request init carrying the JSON body.
 * @returns A minimal OpenAI-shaped completion.
 */
async function recordingFetch(_url: unknown, init?: { body?: unknown }): Promise<Response> {
  const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
  addressed.push(String(body.model));
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Aliases with at least one servable leg. */
function servableAliases(): LlmAlias[] {
  return listAliases().filter((alias) => resolveChain(alias).routes.length > 0);
}

describe("gateway model naming across aliases", () => {
  beforeEach(() => {
    addressed = [];
    process.env[GATEWAY_KEY_ENV] = "test-gateway-key";
    globalThis.fetch = recordingFetch as unknown as typeof fetch;
    configureLlmClient({ gatewayBaseUrl: GATEWAY_URL, gatewayApiKeyEnv: GATEWAY_KEY_ENV });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env[GATEWAY_KEY_ENV];
    configureLlmClient({});
  });

  it("addresses each alias's own head by its bare alias name", async () => {
    const aliases = servableAliases();
    expect(aliases.length, "two servable aliases are needed for this to mean anything").toBeGreaterThan(1);
    const [first, second] = aliases;

    await callLLMByAlias("prompt", "text", { alias: first });
    await callLLMByAlias("prompt", "text", { alias: second });

    // Before the fix the second came back as "<second>.fallback.primary" — a
    // name the gateway does not register — while the first was correct, which
    // is exactly why the defect survived a smoke test on a single alias.
    expect(addressed).toEqual([first, second]);
  });

  it("never addresses any leg as .fallback.primary", async () => {
    for (const alias of servableAliases()) {
      await callLLMByAlias("prompt", "text", { alias });
    }

    // A primary leg is the head of its own chain, so it is addressed by the
    // bare alias and this suffix can never be correct for it. Quantified over
    // every alias rather than a sampled pair: the defect is positional, and a
    // sample would pass on whichever alias happened to dispatch first.
    const offenders = addressed.filter((name) => name.endsWith(".fallback.primary"));
    expect(offenders, `addressed by names the gateway does not register: ${offenders.join(", ")}`).toEqual([]);
  });

  it("addresses every dispatched name with one the gateway config registers", async () => {
    /** Every name the renderer publishes: the head bare, the rest by role. */
    const registered = new Set<string>();
    for (const alias of listAliases()) {
      resolveChain(alias).routes.forEach((route, index) => {
        registered.add(index === 0 ? alias : `${alias}.fallback.${route.role}`);
      });
    }

    for (const alias of servableAliases()) {
      await callLLMByAlias("prompt", "text", { alias });
    }

    expect(addressed.length).toBeGreaterThan(1);
    for (const name of addressed) {
      expect(registered.has(name), `"${name}" is not a name the gateway registers`).toBe(true);
    }
  });
});
