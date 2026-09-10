import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callLLMByAlias, configureLlmClient, llmBreakers } from "../../../llm/alias-client";
import { resolveChain } from "../../../llm/route-table";
import {
  SchemaRetryExhaustedError,
  buildRetryPrompt,
  callWithValidation,
} from "../../../llm/schema-retry";
import type { LlmTransportResponse, LlmValidationOutcome } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { makeRoute } from "./support/routes";
import { ScriptedTransport, answers, usageFor } from "./support/transports";

/** An alias whose chain has more than one leg, so "did not advance" is observable. */
const ALIAS = "llm.extract";

/** The caller's prompt, distinctive enough to find inside the retry prompt. */
const ORIGINAL_PROMPT = "Extract the ticker from: Apple beat estimates.";

/** What the validator says about the first, malformed payload. */
const FIRST_REJECTION = "missing required property \"symbol\"";

/** What the validator says about a second, still-malformed payload. */
const SECOND_REJECTION = "\"symbol\" must be a string, received number";

/** Prompt tokens the first attempt reports. */
const FIRST_PROMPT_TOKENS = 30;

/** Prompt tokens the second attempt reports. */
const SECOND_PROMPT_TOKENS = 90;

/** Completion tokens each attempt reports. */
const COMPLETION_TOKENS = 12;

/** The payload that satisfies the validator. */
const VALID_PAYLOAD = { symbol: "AAPL" } as const;

/** The payload that does not. */
const INVALID_PAYLOAD = { ticker: "AAPL" } as const;

/** The shape a rescued payload has. */
interface ExtractedSymbol {
  readonly symbol: string;
}

/**
 * Accept only a payload carrying a string `symbol`.
 *
 * @param raw The model's payload.
 * @returns The validation outcome, carrying the value only on the branch that earned it.
 */
function validateSymbol(raw: unknown): LlmValidationOutcome<ExtractedSymbol> {
  if (typeof raw === "object" && raw !== null && "symbol" in raw) {
    const { symbol } = raw;
    if (typeof symbol === "string") {
      return { ok: true, value: { symbol } };
    }
  }
  return { ok: false, reason: FIRST_REJECTION };
}

/**
 * Build a transport response around a payload.
 *
 * @param payload The model's payload.
 * @param promptTokens Prompt tokens to report.
 * @returns The transport response.
 */
function responseWith(
  payload: unknown,
  promptTokens: number,
): LlmTransportResponse<unknown> {
  return {
    response: payload,
    usage: usageFor(makeRoute({ alias: ALIAS }), {
      promptTokens,
      completionTokens: COMPLETION_TOKENS,
    }),
  };
}

describe("bounded validate-and-retry", () => {
  beforeEach(() => {
    configureLlmClient({});
  });

  afterEach(() => {
    configureLlmClient({});
  });

  it("re-prompts exactly once, feeding back both the prompt and the rejection", async () => {
    const prompts: string[] = [];

    const outcome = await callWithValidation<ExtractedSymbol>({
      prompt: ORIGINAL_PROMPT,
      validate: validateSymbol,
      call: async (prompt) => {
        prompts.push(prompt);
        return responseWith(
          prompts.length === 1 ? INVALID_PAYLOAD : VALID_PAYLOAD,
          prompts.length === 1 ? FIRST_PROMPT_TOKENS : SECOND_PROMPT_TOKENS,
        );
      },
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toBe(ORIGINAL_PROMPT);
    // A model told only "fix the error" regenerates from scratch and reproduces
    // the same mistake, so the retry carries the prompt, the payload, and the
    // validator's own words.
    expect(prompts[1]).toContain(ORIGINAL_PROMPT);
    expect(prompts[1]).toContain(FIRST_REJECTION);
    expect(prompts[1]).toContain(JSON.stringify(INVALID_PAYLOAD.ticker));
    expect(outcome.value).toEqual(VALID_PAYLOAD);
  });

  it("reports two attempts and usage summed over both when the retry rescues the call", async () => {
    let call = 0;

    const outcome = await callWithValidation<ExtractedSymbol>({
      prompt: ORIGINAL_PROMPT,
      validate: validateSymbol,
      call: async () => {
        call += 1;
        return responseWith(
          call === 1 ? INVALID_PAYLOAD : VALID_PAYLOAD,
          call === 1 ? FIRST_PROMPT_TOKENS : SECOND_PROMPT_TOKENS,
        );
      },
    });

    expect(outcome.attempts).toBe(2);
    // The rejected attempt was billed too; charging only the rescue would
    // understate spend by exactly what the failure cost.
    expect(outcome.totalUsage.prompt_tokens).toBe(FIRST_PROMPT_TOKENS + SECOND_PROMPT_TOKENS);
    expect(outcome.totalUsage.completion_tokens).toBe(COMPLETION_TOKENS * 2);
  });

  it("throws with both rejections and no value when the retry also fails", async () => {
    let call = 0;
    const attempt = callWithValidation<ExtractedSymbol>({
      prompt: ORIGINAL_PROMPT,
      validate: (raw: unknown): LlmValidationOutcome<ExtractedSymbol> => {
        const outcome = validateSymbol(raw);
        return outcome.ok
          ? outcome
          : { ok: false, reason: call === 1 ? FIRST_REJECTION : SECOND_REJECTION };
      },
      call: async () => {
        call += 1;
        return responseWith(INVALID_PAYLOAD, FIRST_PROMPT_TOKENS);
      },
    });

    await expect(attempt).rejects.toBeInstanceOf(SchemaRetryExhaustedError);
    const error = await rejection(attempt, SchemaRetryExhaustedError);

    expect(call).toBe(2);
    expect(error.firstReason).toBe(FIRST_REJECTION);
    expect(error.secondReason).toBe(SECOND_REJECTION);
    expect(error.message).toContain(FIRST_REJECTION);
    expect(error.message).toContain(SECOND_REJECTION);
    expect(error.totalUsage.prompt_tokens).toBe(FIRST_PROMPT_TOKENS * 2);
  });

  it("keeps the retry on the SAME leg and off the breaker", async () => {
    const chain = resolveChain(ALIAS);
    expect(chain.routes.length).toBeGreaterThan(1);

    let call = 0;
    const gateway = new ScriptedTransport("gateway", (scripted) => {
      call += 1;
      return answers(
        call === 1 ? INVALID_PAYLOAD : VALID_PAYLOAD,
        usageFor(scripted.route, { promptTokens: FIRST_PROMPT_TOKENS }),
      );
    });
    const direct = new ScriptedTransport("direct", (scripted) =>
      answers(VALID_PAYLOAD, usageFor(scripted.route)),
    );
    configureLlmClient({ gatewayTransport: gateway, directTransport: direct });

    const result = await callLLMByAlias<ExtractedSymbol>(ORIGINAL_PROMPT, "json", {
      alias: ALIAS,
      validate: validateSymbol,
    });

    expect(result.response).toEqual(VALID_PAYLOAD);
    // A payload that fails validation is evidence about the PROMPT, not about
    // the provider: the next leg would receive the same prompt and be no
    // likelier to satisfy it.
    expect(gateway.routeKeys).toEqual([chain.routes[0].routeKey, chain.routes[0].routeKey]);
    expect(direct.calls).toHaveLength(0);
    expect(llmBreakers().snapshot(chain.routes[0].routeKey).consecutiveFailures).toBe(0);
    expect(llmBreakers().stateOf(chain.routes[0].routeKey)).toBe("closed");
  });

  it("builds a retry prompt that shows the model what it actually produced", () => {
    const prompt = buildRetryPrompt(ORIGINAL_PROMPT, INVALID_PAYLOAD, FIRST_REJECTION);

    expect(prompt).toContain(ORIGINAL_PROMPT);
    expect(prompt).toContain(FIRST_REJECTION);
    expect(prompt).toContain("rejected by a schema validator");
  });
});
