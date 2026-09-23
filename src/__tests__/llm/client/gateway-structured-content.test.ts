/**
 * Tests for how the gateway transport reads a model's answer to a JSON request.
 *
 * A provider with no schema-less JSON mode (Anthropic, behind the gateway)
 * receives only the prompt's instructions for a `json` request, and a model
 * following them commonly wraps the object in one markdown fence. The object
 * inside is the model's answer, so exactly one enclosing fence is removed; the
 * assertions below pin both halves of that rule — the fenced answer is read,
 * and every answer whose meaning would have to be GUESSED still fails.
 *
 * The no-op partition is asserted separately: every answer that parsed before
 * the unwrapping existed must yield exactly what a plain `JSON.parse` yields.
 *
 * @module __tests__/llm/client/gateway-structured-content
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LlmResponseFormatError } from "../../../llm/structured-content";
import { createGatewayTransport } from "../../../llm/transports/gateway";
import type { LlmTransport, LlmTransportRequest } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { makeRoute } from "./support/routes";

/** Env var the gateway transport reads its key from, by NAME. */
const GATEWAY_KEY_ENV = "LLM_GATEWAY_API_KEY";

/** A non-credential placeholder; the stubbed fetch never leaves the process. */
const PLACEHOLDER_KEY = "placeholder-gateway-key-for-tests";

/** Base URL the transport is pointed at. */
const GATEWAY_URL = "https://llm-gateway.invalid";

/** Token counts the stubbed provider bills, distinct so a test can see them carried. */
const BILLED_PROMPT_TOKENS = 1_200;
const BILLED_COMPLETION_TOKENS = 180;
const BILLED_COST_USD = 0.0021;

/** The object every well-formed answer below encodes. */
const SENTIMENT = { sentiment: "BULLISH", score: 0.7, drivers: ["breadth", "rates"] };

/** The same object as compact JSON text. */
const SENTIMENT_JSON = JSON.stringify(SENTIMENT);

/** A strict schema request, the other structured format the transport serves. */
const SCHEMA_FORMAT: LlmTransportRequest["responseFormat"] = {
  type: "json_schema",
  schema: { type: "object", properties: { sentiment: { type: "string" } } },
};

/**
 * A gateway transport whose stubbed provider answers with the given content.
 *
 * @param content The message content the model "returned".
 * @returns The transport.
 */
function answering(content: string): LlmTransport {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: {
          prompt_tokens: BILLED_PROMPT_TOKENS,
          completion_tokens: BILLED_COMPLETION_TOKENS,
          response_cost: BILLED_COST_USD,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  return createGatewayTransport({
    baseUrl: GATEWAY_URL,
    apiKeyEnv: GATEWAY_KEY_ENV,
    fetchImpl,
    modelNameFor: (request: LlmTransportRequest) => request.route.alias,
  });
}

/**
 * A transport request for one leg.
 *
 * @param responseFormat The shape the caller asked for.
 * @returns The request.
 */
function requestFor(
  responseFormat: LlmTransportRequest["responseFormat"],
): LlmTransportRequest {
  return {
    route: makeRoute({ alias: "llm.fast", role: "closed_incumbent" }),
    content: "Return the market sentiment as JSON.",
    responseFormat,
    params: {},
    signal: new AbortController().signal,
  };
}

/**
 * Read one answer through the transport.
 *
 * @param content What the model returned.
 * @param responseFormat What the caller asked for.
 * @returns The interpreted response.
 */
async function read(
  content: string,
  responseFormat: LlmTransportRequest["responseFormat"] = "json",
): Promise<unknown> {
  const result = await answering(content).execute<unknown>(requestFor(responseFormat));
  return result.response;
}

describe("gateway transport: structured answers", () => {
  let previousKey: string | undefined;

  beforeEach(() => {
    previousKey = process.env[GATEWAY_KEY_ENV];
    process.env[GATEWAY_KEY_ENV] = PLACEHOLDER_KEY;
  });

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env[GATEWAY_KEY_ENV];
    } else {
      process.env[GATEWAY_KEY_ENV] = previousKey;
    }
  });

  describe("an answer inside exactly one enclosing fence is read", () => {
    it("reads JSON inside a ```json fence — the shape the incumbent Haiku leg returns", async () => {
      expect(await read("```json\n" + JSON.stringify(SENTIMENT, null, 2) + "\n```")).toEqual(SENTIMENT);
    });

    it("reads JSON inside a bare ``` fence", async () => {
      expect(await read("```\n" + SENTIMENT_JSON + "\n```")).toEqual(SENTIMENT);
    });

    it("tolerates surrounding whitespace, an upper-case label and CRLF line endings", async () => {
      expect(await read("  \n```JSON \r\n" + SENTIMENT_JSON + "\r\n```\n  ")).toEqual(SENTIMENT);
    });

    it("reads the fenced body of a strict-schema request the same way", async () => {
      expect(await read("```json\n" + SENTIMENT_JSON + "\n```", SCHEMA_FORMAT)).toEqual(SENTIMENT);
    });
  });

  describe("an answer that was already JSON reads exactly as before", () => {
    const alreadyJson: readonly string[] = [
      SENTIMENT_JSON,
      JSON.stringify(SENTIMENT, null, 2),
      "  \n" + SENTIMENT_JSON + "\n  ",
      "[1, 2, 3]",
      '"a bare string"',
      "42",
      "true",
      "null",
      '{"code": "```js\\nconsole.log(1)\\n```"}',
    ];

    for (const content of alreadyJson) {
      it(`reads ${JSON.stringify(content).slice(0, 48)} identically to JSON.parse`, async () => {
        expect(await read(content)).toEqual(JSON.parse(content));
      });
    }
  });

  describe("an answer whose meaning would have to be guessed still fails", () => {
    const guessRequired: readonly (readonly [string, string])[] = [
      ["a fence around content that is not JSON", "```json\nsentiment: bullish\n```"],
      ["prose alone", "Sure! The market looks bullish today."],
      ["prose before the fence", "Here is the analysis:\n```json\n" + SENTIMENT_JSON + "\n```"],
      ["prose after the fence", "```json\n" + SENTIMENT_JSON + "\n```\nLet me know if you need more."],
      [
        "two fenced blocks",
        "```json\n" + SENTIMENT_JSON + "\n```\n\n```json\n" + SENTIMENT_JSON + "\n```",
      ],
      ["a fence that never closes (a truncated answer)", "```json\n" + SENTIMENT_JSON.slice(0, 20)],
      ["a fence declaring another language", "```python\n" + SENTIMENT_JSON + "\n```"],
      ["an empty fence", "```json\n```"],
    ];

    for (const [label, content] of guessRequired) {
      it(`rejects ${label}`, async () => {
        const error = await rejection(read(content), LlmResponseFormatError);
        expect(error.message).toMatch(/not valid JSON for a json request/);
      });
    }

    it("says when the failed content was inside a fence, so an operator knows what was attempted", async () => {
      const error = await rejection(read("```json\nnot json\n```"), LlmResponseFormatError);
      expect(error.fenced).toBe(true);
      expect(error.message).toContain("inside one enclosing markdown fence");
    });
  });

  it("returns a fenced answer untouched when the caller asked for text", async () => {
    const fenced = "```json\n" + SENTIMENT_JSON + "\n```";
    expect(await read(fenced, "text")).toBe(fenced);
  });

  it("carries what the provider billed on a failure, so a failed attempt is never reported as free", async () => {
    const error = await rejection(read("I could not decide."), LlmResponseFormatError);
    expect(error.usage.prompt_tokens).toBe(BILLED_PROMPT_TOKENS);
    expect(error.usage.completion_tokens).toBe(BILLED_COMPLETION_TOKENS);
    expect(error.usage.cost).toBe(BILLED_COST_USD);
  });
});
