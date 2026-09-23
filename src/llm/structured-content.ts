/**
 * Interpretation of a model's answer to a structured (JSON) request.
 *
 * A JSON request is a promise about the answer's SHAPE, and providers keep it
 * in different ways. An OpenAI-compatible host given `json_object` constrains
 * its decoder, so its answer is bare JSON. A provider with no schema-less JSON
 * mode — Anthropic, reached through the gateway, supports structured output
 * only against a caller-supplied schema — receives nothing but the prompt's
 * instructions for a `json` request, and a model following them commonly
 * returns the object inside one markdown code fence. The fence is presentation,
 * not content: the object inside it is the answer the model gave.
 *
 * So exactly ONE enclosing fence is removed before parsing, and nothing else is
 * forgiven. Prose before or after the fence, two fenced blocks, a fence that
 * never closes (a truncated answer), and a fence declaring another language all
 * still fail. Each of those is an answer whose meaning a parser would have to
 * guess, and a guessed object is a decision made on data no model produced.
 *
 * Content that is not fenced is parsed exactly as it always was: JSON cannot
 * begin with a backtick, so every answer that parsed before this unwrapping
 * existed takes the same path and yields the same value.
 *
 * @module llm/structured-content
 */

import type { LlmResponseFormat, LlmUsageRecord } from "./types";

/** A response format that promises structured content. */
export type StructuredResponseFormat = Exclude<LlmResponseFormat, "text">;

/**
 * One markdown fence enclosing the whole answer: an opening line of three
 * backticks, optionally labelled `json`, then the body, then three closing
 * backticks, with nothing but whitespace outside them. The body is anchored at
 * both ends, so an answer holding two fenced blocks captures the text between
 * them and fails to parse instead of yielding either block.
 */
const SINGLE_ENCLOSING_JSON_FENCE = /^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```\s*$/i;

/**
 * Thrown when a provider answered a structured request with content that does
 * not parse.
 *
 * Carries the usage the provider billed for that answer. The tokens were spent
 * whether or not the content parsed, and a chain that dropped them would report
 * a failed attempt as free — understating spend by exactly the calls that went
 * wrong.
 */
export class LlmResponseFormatError extends Error {
  /** The format the caller asked for. */
  public readonly responseFormat: "json" | "json_schema";

  /** What the provider billed for the answer that did not parse. */
  public readonly usage: LlmUsageRecord;

  /** Whether the answer sat inside one enclosing fence that was removed before parsing. */
  public readonly fenced: boolean;

  /**
   * @param responseFormat The format the caller asked for.
   * @param usage What the provider billed for the answer.
   * @param fenced Whether one enclosing fence was removed before parsing.
   * @param cause The parser's own complaint.
   */
  public constructor(
    responseFormat: "json" | "json_schema",
    usage: LlmUsageRecord,
    fenced: boolean,
    cause: unknown,
  ) {
    super(
      `LLM returned content that is not valid JSON for a ${responseFormat} request` +
        (fenced ? " (inside one enclosing markdown fence)" : "") +
        `: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "LlmResponseFormatError";
    this.responseFormat = responseFormat;
    this.usage = usage;
    this.fenced = fenced;
  }
}

/**
 * The body of the one markdown fence that encloses an answer, if exactly one does.
 *
 * @param text The model's answer.
 * @returns The fenced body, or null when the answer is not wholly one fenced block.
 */
export function unwrapSingleJsonFence(text: string): string | null {
  const match = SINGLE_ENCLOSING_JSON_FENCE.exec(text);
  return match === null ? null : match[1];
}

/**
 * Parse a model's answer to a structured request.
 *
 * A JSON format that does not parse is an error, not an empty object. Returning
 * a default here would hand the caller a well-typed value that means nothing,
 * and the failure would surface much later as a decision made on absent data.
 *
 * @param content The raw content of the model's message.
 * @param responseFormat The structured format the caller asked for.
 * @param usage What the provider billed for this answer, carried on failure.
 * @returns The parsed value.
 * @throws {LlmResponseFormatError} When the content is not JSON, fenced or not.
 */
export function parseStructuredContent<T>(
  content: unknown,
  responseFormat: StructuredResponseFormat,
  usage: LlmUsageRecord,
): T {
  const text = typeof content === "string" ? content : "";
  const fencedBody = unwrapSingleJsonFence(text);
  try {
    return JSON.parse(fencedBody ?? text) as T;
  } catch (error) {
    throw new LlmResponseFormatError(
      typeof responseFormat === "string" ? responseFormat : "json_schema",
      usage,
      fencedBody !== null,
      error,
    );
  }
}
