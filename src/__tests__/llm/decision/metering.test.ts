/**
 * Usage, cost and the retry hint of a decision call.
 *
 * Spend controls and a caller's back-off both read these numbers as
 * measurements. So the tests pin the one thing a measurement must never do:
 * turn an absence into a value. A count the vendor did not report, a price
 * nobody declared and a hint the vendor did not send each stay `null`, and a
 * zero appears only where a zero was reported or where the declared price makes
 * the term zero whatever the count.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  RETRY_AFTER_HEADER,
  RETRY_AFTER_MS_HEADER,
  decisionUsageOf,
  parseRetryAfterMs,
} from "../../../llm/decision/metering";
import type { DecisionUsageIdentity } from "../../../llm/decision/metering";
import type { LlmPriceAnchor } from "../../../llm/types";
import { loadDecisionFixture } from "./support/fixtures";

/** The provider and pinned model a route credits its usage to. */
const IDENTITY: DecisionUsageIdentity = { provider: "decision-vendor", model: "pinned-model-1.0.0" };

/** The date the anchors below are stamped with; no test reads it. */
const ANCHOR_DATE = "2026-10-01";

/** The vendor's published price: input charged per million tokens, output free. */
const DOCUMENTED_ANCHOR: LlmPriceAnchor = { input: 0.042, output: 0, as_of: ANCHOR_DATE };

/** An anchor that charges for output too, so the output term is observable. */
const OUTPUT_PRICED_ANCHOR: LlmPriceAnchor = { input: 0.042, output: 0.5, as_of: ANCHOR_DATE };

/** Token counts of the documented example response. */
const DOCUMENTED_INPUT_TOKENS = 318;
const DOCUMENTED_OUTPUT_TOKENS = 34;

/** 318 input tokens at 0.042 per million, output free. */
const DOCUMENTED_COST = 0.000013356;

/** 318 input tokens at 0.042 and 34 output tokens at 0.5, per million. */
const OUTPUT_PRICED_COST = 0.000030356;

/** Decimal places two costs must agree to; far finer than any priced difference here. */
const COST_DIGITS = 12;

/** The instant the retry-hint tests treat as now. */
const NOW_MS = Date.UTC(2026, 9, 1, 12, 0, 0);

/** Thirty seconds after {@link NOW_MS}, as a sender is required to write an HTTP date. */
const DATE_THIRTY_SECONDS_ON = "Thu, 01 Oct 2026 12:00:30 GMT";

/** One hour before {@link NOW_MS}. */
const DATE_AN_HOUR_AGO = "Thu, 01 Oct 2026 11:00:00 GMT";

const THIRTY_SECONDS_MS = 30_000;

/** A digit string too long to be a finite number. */
const OVERFLOWING_DIGITS = "9".repeat(400);

/**
 * Read the `usage` member of a fixture's body without trusting its shape.
 *
 * @param name The fixture's file name.
 * @returns Whatever the body holds under `usage`.
 */
function documentedUsage(name: string): unknown {
  const { envelope } = loadDecisionFixture(name, { allow: ["documented-verbatim"] });
  const body = envelope.body;
  if (typeof body !== "object" || body === null || !("usage" in body)) {
    throw new Error(`fixture ${name} has no usage to price`);
  }
  return body.usage;
}

/**
 * Response headers of a fixture, as a fetch response would expose them.
 *
 * @param name The fixture's file name.
 * @returns The headers.
 */
function syntheticHeaders(name: string): Headers {
  const { envelope } = loadDecisionFixture(name, { allow: ["synthetic-unobserved"] });
  return new Headers(envelope.headers ?? {});
}

describe("decisionUsageOf", () => {
  it("prices the documented example", () => {
    const usage = documentedUsage("response.choice.documented.json");

    const free = decisionUsageOf(usage, IDENTITY, DOCUMENTED_ANCHOR);
    expect(free.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
    expect(free.completion_tokens).toBe(DOCUMENTED_OUTPUT_TOKENS);
    expect(free.cost).toBeCloseTo(DOCUMENTED_COST, COST_DIGITS);

    // The output term is real: priced output moves the cost by exactly its share.
    const priced = decisionUsageOf(usage, IDENTITY, OUTPUT_PRICED_ANCHOR);
    expect(priced.cost).toBeCloseTo(OUTPUT_PRICED_COST, COST_DIGITS);
  });

  it("credits the usage to the route's provider and pinned model and invents no other field", () => {
    const record = decisionUsageOf({ input_tokens: 1, output_tokens: 1 }, IDENTITY, DOCUMENTED_ANCHOR);
    expect(Object.keys(record).sort()).toEqual(["completion_tokens", "cost", "model", "prompt_tokens", "provider"]);
    expect(record.provider).toBe(IDENTITY.provider);
    expect(record.model).toBe(IDENTITY.model);
  });

  it("an unreported count is null and so is the cost, never zero", () => {
    const unreadable: readonly unknown[] = [undefined, null, {}, "usage", 7, [318, 34]];
    for (const usage of unreadable) {
      const record = decisionUsageOf(usage, IDENTITY, OUTPUT_PRICED_ANCHOR);
      expect(record.prompt_tokens, `input of ${JSON.stringify(usage)}`).toBeNull();
      expect(record.completion_tokens, `output of ${JSON.stringify(usage)}`).toBeNull();
      expect(record.cost, `cost of ${JSON.stringify(usage)}`).toBeNull();
    }

    const notCounts: readonly unknown[] = ["318", Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, null, true];
    for (const bad of notCounts) {
      const badInput = decisionUsageOf({ input_tokens: bad, output_tokens: 34 }, IDENTITY, OUTPUT_PRICED_ANCHOR);
      expect(badInput.prompt_tokens, `input ${String(bad)}`).toBeNull();
      expect(badInput.completion_tokens).toBe(DOCUMENTED_OUTPUT_TOKENS);
      expect(badInput.cost, `cost with input ${String(bad)}`).toBeNull();

      const badOutput = decisionUsageOf({ input_tokens: 318, output_tokens: bad }, IDENTITY, OUTPUT_PRICED_ANCHOR);
      expect(badOutput.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
      expect(badOutput.completion_tokens, `output ${String(bad)}`).toBeNull();
      expect(badOutput.cost, `cost with output ${String(bad)}`).toBeNull();
    }
  });

  it("a reported zero is a measurement and stays zero", () => {
    const record = decisionUsageOf({ input_tokens: 0, output_tokens: 0 }, IDENTITY, OUTPUT_PRICED_ANCHOR);
    expect(record.prompt_tokens).toBe(0);
    expect(record.completion_tokens).toBe(0);
    expect(record.cost).toBe(0);
  });

  it("no anchor means unpriced", () => {
    const record = decisionUsageOf({ input_tokens: 318, output_tokens: 34 }, IDENTITY, null);
    expect(record.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
    expect(record.completion_tokens).toBe(DOCUMENTED_OUTPUT_TOKENS);
    expect(record.cost).toBeNull();
  });

  it("an anchor whose rate is not a price leaves the call unpriced", () => {
    const badRates: readonly number[] = [Number.NaN, -0.042, Number.POSITIVE_INFINITY];
    for (const rate of badRates) {
      const badInput: LlmPriceAnchor = { input: rate, output: 0, as_of: ANCHOR_DATE };
      const badOutput: LlmPriceAnchor = { input: 0.042, output: rate, as_of: ANCHOR_DATE };
      const usage = { input_tokens: 318, output_tokens: 34 };
      expect(decisionUsageOf(usage, IDENTITY, badInput).cost, `input rate ${rate}`).toBeNull();
      expect(decisionUsageOf(usage, IDENTITY, badOutput).cost, `output rate ${rate}`).toBeNull();
    }
  });

  it("a cost too large for a number to hold is unknown, never infinite", () => {
    // Each rate passes as a price and each count as a count; only their
    // product is past what a number holds.
    const absurdInput: LlmPriceAnchor = { input: Number.MAX_VALUE, output: 0, as_of: ANCHOR_DATE };
    const absurdOutput: LlmPriceAnchor = { input: 0.042, output: Number.MAX_VALUE, as_of: ANCHOR_DATE };
    const counts = { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: Number.MAX_SAFE_INTEGER };

    for (const anchor of [absurdInput, absurdOutput]) {
      const usage = decisionUsageOf(counts, IDENTITY, anchor);
      expect(usage.cost).toBeNull();
      // The counts were reported, and stay reported.
      expect(usage.prompt_tokens).toBe(Number.MAX_SAFE_INTEGER);
      expect(usage.completion_tokens).toBe(Number.MAX_SAFE_INTEGER);
    }
  });

  it("unreported output prices only when output is documented free", () => {
    const inputOnly = { input_tokens: 318 };

    const free = decisionUsageOf(inputOnly, IDENTITY, DOCUMENTED_ANCHOR);
    expect(free.completion_tokens).toBeNull();
    expect(free.cost).toBeCloseTo(DOCUMENTED_COST, COST_DIGITS);

    const priced = decisionUsageOf(inputOnly, IDENTITY, OUTPUT_PRICED_ANCHOR);
    expect(priced.completion_tokens).toBeNull();
    expect(priced.cost).toBeNull();
  });
});

describe("parseRetryAfterMs", () => {
  it("retry-after-ms is preferred; seconds and an HTTP date convert; absent is null", () => {
    // Preferred: both present, the millisecond header is the one read.
    expect(
      parseRetryAfterMs(new Headers({ [RETRY_AFTER_MS_HEADER]: "1500", [RETRY_AFTER_HEADER]: "30" }), NOW_MS),
    ).toBe(1_500);

    // Seconds, whole and fractional.
    expect(parseRetryAfterMs(new Headers({ [RETRY_AFTER_HEADER]: "30" }), NOW_MS)).toBe(THIRTY_SECONDS_MS);
    expect(parseRetryAfterMs(new Headers({ [RETRY_AFTER_HEADER]: "1.5" }), NOW_MS)).toBe(1_500);

    // An HTTP date, against the instant the caller passed.
    expect(parseRetryAfterMs(new Headers({ [RETRY_AFTER_HEADER]: DATE_THIRTY_SECONDS_ON }), NOW_MS)).toBe(
      THIRTY_SECONDS_MS,
    );
    expect(
      parseRetryAfterMs(new Headers({ [RETRY_AFTER_HEADER]: DATE_THIRTY_SECONDS_ON }), NOW_MS + THIRTY_SECONDS_MS),
    ).toBe(0);

    // Absent is null, and only a reported zero is zero.
    expect(parseRetryAfterMs(new Headers(), NOW_MS)).toBeNull();
    expect(parseRetryAfterMs(new Headers({ [RETRY_AFTER_MS_HEADER]: "0" }), NOW_MS)).toBe(0);
    expect(parseRetryAfterMs(new Headers({ [RETRY_AFTER_HEADER]: "0" }), NOW_MS)).toBe(0);
  });

  it("reads the headers the synthetic capacity fixtures carry", () => {
    expect(parseRetryAfterMs(syntheticHeaders("error.429.unobserved.json"), NOW_MS)).toBe(THIRTY_SECONDS_MS);
    expect(parseRetryAfterMs(syntheticHeaders("error.529.unobserved.json"), NOW_MS)).toBe(1_500);
  });

  it("header names are matched as a response reports them, whatever their case", () => {
    expect(parseRetryAfterMs(new Headers({ "Retry-After": "30" }), NOW_MS)).toBe(THIRTY_SECONDS_MS);
    expect(parseRetryAfterMs(new Headers({ "Retry-After-Ms": "250" }), NOW_MS)).toBe(250);
  });

  it("a negative, non-finite or unparseable value is null", () => {
    const unusable: readonly string[] = [
      "-5",
      "abc",
      "30 seconds",
      "1e3",
      "Infinity",
      "NaN",
      "0x10",
      OVERFLOWING_DIGITS,
      DATE_AN_HOUR_AGO,
      "Thu, 31 Feb 2026 12:00:30 GMT",
      "Thu, 01 Oct 2026 24:00:30 GMT",
      "2026-10-01T12:00:30Z",
      "Thursday, 01-Oct-26 12:00:30 GMT",
    ];
    for (const value of unusable) {
      expect(parseRetryAfterMs(new Headers({ [RETRY_AFTER_HEADER]: value }), NOW_MS), `retry-after ${value}`).toBeNull();
    }
    for (const value of ["-5", "abc", "1e3", "Infinity", OVERFLOWING_DIGITS, DATE_THIRTY_SECONDS_ON]) {
      expect(
        parseRetryAfterMs(new Headers({ [RETRY_AFTER_MS_HEADER]: value }), NOW_MS),
        `retry-after-ms ${value}`,
      ).toBeNull();
    }
    // An instant that is not a number yields no hint from a date either.
    expect(parseRetryAfterMs(new Headers({ [RETRY_AFTER_HEADER]: DATE_THIRTY_SECONDS_ON }), Number.NaN)).toBeNull();
  });

  it("an unusable millisecond header does not hide a usable hint in seconds", () => {
    expect(
      parseRetryAfterMs(new Headers({ [RETRY_AFTER_MS_HEADER]: "soon", [RETRY_AFTER_HEADER]: "30" }), NOW_MS),
    ).toBe(THIRTY_SECONDS_MS);
  });
});

describe("the metering module", () => {
  it("reads no clock and no environment", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../llm/decision/metering.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/Date\.now|new Date\(\s*\)|performance\.|process\./);
  });
});
