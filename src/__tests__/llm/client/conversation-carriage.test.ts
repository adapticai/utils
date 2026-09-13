import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callLLMByAlias, configureLlmClient } from "../../../llm/alias-client";
import { ScriptedTransport, answers, usageFor } from "./support/transports";

/**
 * The alias path must carry the whole conversation, not just the last turn.
 *
 * `AliasCallOptions` has always declared `developerPrompt` and `context`, and the
 * engine has always populated both — the decision path explicitly splits "latest
 * user message" into `content` and "everything before it" into `context`. But
 * neither field was ever plumbed to a transport: `normaliseParams` produces only
 * provider BODY parameters (temperature, tools, response_format …) and never read
 * them, and both transports built their request from `params` alone.
 *
 * So every alias-routed call sent one bare user message. Not a shorter prompt — a
 * different question, asked of a model with no system instruction. On a
 * tool-carrying site that also means the hardening constraining WHICH tools may
 * fire was absent on precisely the routed path.
 *
 * It is silent by construction: both fields are optional, so dropping them still
 * produces a valid request and a plausible answer. Only an assertion on what the
 * transport actually received can see it.
 *
 * Mutation proof: remove `developerPrompt`/`context` from the execute() call in
 * fallback-chain.ts, or from either executeChain call in alias-client.ts, and the
 * first two tests here go red while the third stays green.
 */

const ALIAS = "llm.agentic" as const;

const SYSTEM = "You are constrained. Never call a tool the operator did not ask for.";

const HISTORY: readonly unknown[] = [
  { role: "user", content: "what is my exposure?" },
  { role: "assistant", content: "You are net long 3 names." },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "c1", type: "function", function: { name: "get_positions", arguments: "{}" } },
    ],
  },
  { role: "tool", tool_call_id: "c1", content: '[{"symbol":"AAPL"}]' },
];

describe("alias path — conversation carriage", () => {
  beforeEach(() => configureLlmClient({}));
  afterEach(() => configureLlmClient({}));

  it("delivers the developer prompt to the transport", async () => {
    const gateway = new ScriptedTransport("gateway", (call) =>
      answers("ack", usageFor(call.route)),
    );
    configureLlmClient({ gatewayTransport: gateway });

    await callLLMByAlias<string>("flatten AAPL", "text", {
      alias: ALIAS,
      developerPrompt: SYSTEM,
    });

    expect(gateway.calls.length).toBeGreaterThan(0);
    expect(gateway.calls[0].developerPrompt).toBe(SYSTEM);
  });

  it("delivers the full prior conversation, in order, including tool turns", async () => {
    const gateway = new ScriptedTransport("gateway", (call) =>
      answers("ack", usageFor(call.route)),
    );
    configureLlmClient({ gatewayTransport: gateway });

    await callLLMByAlias<string>("and now?", "text", {
      alias: ALIAS,
      developerPrompt: SYSTEM,
      context: HISTORY,
    });

    const got = gateway.calls[0].context;
    expect(got).toBeDefined();
    expect(got).toHaveLength(HISTORY.length);
    // Order is load-bearing: a tool result must still follow the call it answers.
    expect(got).toEqual(HISTORY);
  });

  it("omits both cleanly when the caller supplies neither", async () => {
    const gateway = new ScriptedTransport("gateway", (call) =>
      answers("ack", usageFor(call.route)),
    );
    configureLlmClient({ gatewayTransport: gateway });

    await callLLMByAlias<string>("hello", "text", { alias: ALIAS });

    expect(gateway.calls[0].developerPrompt).toBeUndefined();
    expect(gateway.calls[0].context).toBeUndefined();
  });
});
