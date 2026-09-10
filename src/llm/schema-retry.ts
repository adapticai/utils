/**
 * Bounded validate-and-retry for structured output.
 *
 * A model asked for a schema-shaped answer sometimes returns something close
 * but wrong. Feeding the validator's own complaint back once fixes most of
 * those, because the model can see precisely what it got wrong. A second retry
 * almost never helps: if the model is still wrong after being told exactly what
 * was wrong, it is persistently wrong for this prompt, and further attempts
 * spend budget and latency to arrive at the same place.
 *
 * The retry lives ahead of the fallback chain rather than inside it. A payload
 * that fails validation is evidence about the PROMPT, not about the provider's
 * health, so it must not open a circuit breaker or advance to the next leg —
 * the next leg would receive the same prompt and be no likelier to satisfy it.
 *
 * Exhaustion throws. Returning a partial or defaulted object would hand the
 * caller a well-typed value that no model ever produced, and the resulting
 * decision would be made on invented data with nothing to show it.
 *
 * @module llm/schema-retry
 */

import { sumUsage } from "./fallback-chain";
import type {
  LlmTransportResponse,
  LlmUsageRecord,
  LlmValidationOutcome,
} from "./types";

/** Attempts allowed: the first, plus exactly one feedback retry. */
const MAX_ATTEMPTS = 2;

/** Characters of an invalid payload echoed back to the model. */
const PAYLOAD_EXCERPT = 2000;

/** One validated attempt's result. */
export interface ValidatedOutcome<T> {
  readonly value: T;
  readonly attempts: 1 | 2;
  readonly response: LlmTransportResponse<unknown>;
  readonly totalUsage: LlmUsageRecord;
}

/**
 * Thrown when both attempts failed validation.
 *
 * Carries both rejection reasons, because the pair is what distinguishes a
 * flaky answer from a prompt the model cannot satisfy: two different complaints
 * suggest instability, while the same complaint twice points at the prompt or
 * the schema.
 */
export class SchemaRetryExhaustedError extends Error {
  /** Why the first attempt was rejected. */
  public readonly firstReason: string;

  /** Why the retry was rejected. */
  public readonly secondReason: string;

  /** Usage spent across both attempts, so the spend is still accounted for. */
  public readonly totalUsage: LlmUsageRecord;

  /**
   * @param firstReason Validator's complaint about attempt one.
   * @param secondReason Validator's complaint about attempt two.
   * @param totalUsage Usage across both attempts.
   */
  public constructor(
    firstReason: string,
    secondReason: string,
    totalUsage: LlmUsageRecord,
  ) {
    super(
      "LLM structured output failed validation twice. " +
        `First: ${firstReason}. After feedback: ${secondReason}. ` +
        "No value is returned: a defaulted object would be data no model produced.",
    );
    this.name = "SchemaRetryExhaustedError";
    this.firstReason = firstReason;
    this.secondReason = secondReason;
    this.totalUsage = totalUsage;
  }
}

/**
 * Build the retry prompt.
 *
 * The rejected payload is echoed back alongside the complaint, because a model
 * asked to "fix the error" without seeing what it produced will usually
 * regenerate from scratch and reproduce the same mistake.
 *
 * @param originalPrompt The prompt that produced the invalid payload.
 * @param rejected The payload that failed.
 * @param reason The validator's complaint.
 * @returns The retry prompt.
 */
export function buildRetryPrompt(
  originalPrompt: string,
  rejected: unknown,
  reason: string,
): string {
  const excerpt =
    typeof rejected === "string"
      ? rejected
      : JSON.stringify(rejected, null, 2) ?? String(rejected);
  return [
    originalPrompt,
    "",
    "Your previous response was rejected by a schema validator.",
    "",
    "Previous response:",
    excerpt.slice(0, PAYLOAD_EXCERPT),
    "",
    `Validator rejection: ${reason}`,
    "",
    "Return a corrected response that satisfies the schema. Return only the corrected response.",
  ].join("\n");
}

/**
 * Run a call with one validator-feedback retry.
 *
 * @param options Retry options.
 * @param options.prompt The original prompt.
 * @param options.validate Validator applied to each attempt's payload.
 * @param options.call Executes one attempt with the given prompt.
 * @returns The validated value with combined usage.
 * @throws {SchemaRetryExhaustedError} When both attempts fail validation.
 */
export async function callWithValidation<T>(options: {
  readonly prompt: string;
  readonly validate: (raw: unknown) => LlmValidationOutcome<T>;
  readonly call: (prompt: string) => Promise<LlmTransportResponse<unknown>>;
}): Promise<ValidatedOutcome<T>> {
  const first = await options.call(options.prompt);
  const firstOutcome = options.validate(first.response);
  if (firstOutcome.ok) {
    return {
      value: firstOutcome.value,
      attempts: 1,
      response: first,
      totalUsage: first.usage,
    };
  }

  const retryPrompt = buildRetryPrompt(
    options.prompt,
    first.response,
    firstOutcome.reason,
  );
  const second = await options.call(retryPrompt);
  const combined = sumUsage(first.usage, second.usage);
  const secondOutcome = options.validate(second.response);

  if (secondOutcome.ok) {
    return {
      value: secondOutcome.value,
      attempts: MAX_ATTEMPTS,
      response: second,
      totalUsage: combined,
    };
  }

  throw new SchemaRetryExhaustedError(
    firstOutcome.reason,
    secondOutcome.reason,
    combined,
  );
}
