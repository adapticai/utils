/**
 * Usage, cost and the retry hint of a decision call.
 *
 * Three readings a decision call reports about itself, each taken from what a
 * vendor sent and none of them trusted to be there: the tokens it billed, what
 * those tokens cost at the route's declared price, and how long the vendor
 * asked a caller to wait before trying again.
 *
 * One rule governs all three. A reading that was not taken is `null`, never
 * zero. A zero token count reads as a free call and a zero cost can never trip
 * a spend limit, and a zero retry hint tells a caller to try again at once, so
 * each default would be acted on as a measurement nobody made.
 *
 * Everything here is a pure function of its arguments. The instant a date is
 * measured against is passed in by the caller, so the same inputs always give
 * the same answer and nothing here needs a clock to be tested.
 *
 * @module llm/decision/metering
 */

import type { LlmPriceAnchor, LlmUsageRecord } from "../types";

/** The number of tokens a price anchor's rates are quoted per. */
const TOKENS_PER_PRICED_UNIT = 1_000_000;

/** Milliseconds in one second. */
const MS_PER_SECOND = 1_000;

/**
 * Response header carrying a retry delay in milliseconds.
 *
 * Read first: it states the delay in the unit this package reports, with no
 * conversion and no dependence on the two clocks agreeing.
 */
export const RETRY_AFTER_MS_HEADER = "retry-after-ms";

/** Response header carrying a retry delay as seconds, or as the date to retry at. */
export const RETRY_AFTER_HEADER = "retry-after";

/** Month names of an HTTP date, in calendar order. */
const HTTP_DATE_MONTHS: readonly string[] = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The fixed-length HTTP date, such as `Sun, 06 Nov 1994 08:49:37 GMT`.
 *
 * The one form a sender is required to generate. The two obsolete forms are
 * not read: one has a two-digit year whose century is a guess, and a hint that
 * has to be guessed at is reported as no hint.
 */
const HTTP_FIXED_DATE = new RegExp(
  `^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\\d{2}) (${HTTP_DATE_MONTHS.join("|")}) (\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$`,
);

/** A non-negative decimal number with no sign, exponent or unit. */
const PLAIN_DECIMAL = /^\d+(?:\.\d+)?$/;

/** Who a route credits its usage to. */
export interface DecisionUsageIdentity {
  /** The provider the route declares. */
  readonly provider: string;
  /** The model id the route pins, which is the model the request named. */
  readonly model: string;
}

/**
 * The part of a response's headers the retry hint is read from.
 *
 * A fetch response's `Headers` satisfies it, and matches names whatever their
 * case.
 */
export interface DecisionRetryHeaders {
  /**
   * @param name The header's name.
   * @returns The header's value, or `null` when the response carries none.
   */
  get(name: string): string | null;
}

/**
 * Whether a value is a plain object whose members can be read.
 *
 * @param value The value to test.
 * @returns True when it is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A reported token count, or `null` when what was reported is not a count.
 *
 * A count is a whole number of tokens, zero or more, that a number can hold
 * exactly. Text, a fraction, a negative and a non-finite value are each a
 * response that did not state a count, and are not coerced into one.
 *
 * @param value The raw value.
 * @returns The count, or `null`.
 */
function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Whether a declared rate can price anything.
 *
 * @param rate A rate from a price anchor.
 * @returns True when it is a finite number that is zero or more.
 */
function isRate(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0;
}

/**
 * What one side of a call cost, in the anchor's currency times the priced unit.
 *
 * A side declared free costs nothing whatever its count, so an unreported
 * count does not make it unknown. A side that is charged for costs an unknown
 * amount when its count was not reported.
 *
 * @param tokens The reported count, or `null`.
 * @param rate The declared rate for that side.
 * @returns The side's cost before the per-unit division, or `null` when unknown.
 */
function sideCost(tokens: number | null, rate: number): number | null {
  if (rate === 0) {
    return 0;
  }
  return tokens === null ? null : tokens * rate;
}

/**
 * The cost of a call at a route's declared price.
 *
 * @param inputTokens The reported input count, or `null`.
 * @param outputTokens The reported output count, or `null`.
 * @param anchor The route's price anchor, or `null` when it declares none.
 * @returns The cost, or `null` when any term of it is unknown, or when the
 *   terms are known and their sum is past what a number can hold: an infinite
 *   cost is not an amount, and a spend limit compared against it is not a limit.
 */
function costOf(inputTokens: number | null, outputTokens: number | null, anchor: LlmPriceAnchor | null): number | null {
  if (anchor === null || inputTokens === null || !isRate(anchor.input) || !isRate(anchor.output)) {
    return null;
  }
  const outputCost = sideCost(outputTokens, anchor.output);
  if (outputCost === null) {
    return null;
  }
  const cost = (inputTokens * anchor.input + outputCost) / TOKENS_PER_PRICED_UNIT;
  return Number.isFinite(cost) ? cost : null;
}

/**
 * Build the usage record of a decision call from what the response reported.
 *
 * The usage block is taken as untyped data: it is read before the response is
 * validated, so that a response rejected for its shape still reports what it
 * billed.
 *
 * The cost is known only when every term of it is: the route declares a price,
 * the input count was reported, and the output count was reported or output is
 * declared free. The input count is required even where the input rate is
 * zero, because a call whose size is unknown has not been metered. In every
 * other case the cost is `null`.
 *
 * @param wireUsage The response's `usage` member, whatever it holds.
 * @param identity The provider and pinned model the usage is credited to.
 * @param anchor The route's price anchor, or `null` when it declares none.
 * @returns The usage record.
 */
export function decisionUsageOf(
  wireUsage: unknown,
  identity: DecisionUsageIdentity,
  anchor: LlmPriceAnchor | null,
): LlmUsageRecord {
  const reported = isRecord(wireUsage) ? wireUsage : {};
  const inputTokens = countOrNull(reported.input_tokens);
  const outputTokens = countOrNull(reported.output_tokens);
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    provider: identity.provider,
    model: identity.model,
    cost: costOf(inputTokens, outputTokens, anchor),
  };
}

/**
 * A header's value as a plain non-negative number, or `null`.
 *
 * @param raw The header's value, or `null` when it is absent.
 * @returns The number, or `null` when absent, not a plain decimal, or not finite.
 */
function plainDecimalOrNull(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const text = raw.trim();
  if (!PLAIN_DECIMAL.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * The instant a fixed-length HTTP date names, in milliseconds since the epoch.
 *
 * @param text The header's value.
 * @returns The instant, or `null` when the text is not such a date or names a
 *   day or time that does not exist.
 */
function httpDateMs(text: string): number | null {
  const match = HTTP_FIXED_DATE.exec(text);
  if (match === null) {
    return null;
  }
  const day = Number(match[1]);
  const month = HTTP_DATE_MONTHS.indexOf(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const instant = Date.UTC(year, month, day, hour, minute, second);
  // A field out of range rolls over into the next unit instead of failing, so
  // the fields are read back: a date that names no real instant differs.
  const readBack = new Date(instant);
  const exists =
    readBack.getUTCFullYear() === year &&
    readBack.getUTCMonth() === month &&
    readBack.getUTCDate() === day &&
    readBack.getUTCHours() === hour &&
    readBack.getUTCMinutes() === minute &&
    readBack.getUTCSeconds() === second;
  return exists ? instant : null;
}

/**
 * A delay in milliseconds, or `null` when it is not a usable delay.
 *
 * @param delayMs The delay.
 * @returns The delay when it is finite and zero or more, else `null`.
 */
function delayOrNull(delayMs: number): number | null {
  return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : null;
}

/**
 * Read a vendor's retry hint from a response's headers.
 *
 * The millisecond header is read first. When it is absent or unusable, the
 * standard header is read as a number of seconds, or as the date to retry at,
 * measured against the instant the caller passes. A header that holds no
 * usable delay does not hide the other one.
 *
 * The result is `null` when no header gave a usable delay: none was sent, the
 * value is not a plain number or a date, or the date is already past. It is
 * zero only when the vendor wrote a zero or named this very instant. The hint
 * is returned for the caller to weigh and is never slept on in this package.
 *
 * @param headers The response's headers.
 * @param nowMs The instant to measure a date against, in milliseconds since the epoch.
 * @returns The delay the vendor asked for, in milliseconds, or `null`.
 */
export function parseRetryAfterMs(headers: DecisionRetryHeaders, nowMs: number): number | null {
  const statedMs = plainDecimalOrNull(headers.get(RETRY_AFTER_MS_HEADER));
  if (statedMs !== null) {
    return statedMs;
  }
  const raw = headers.get(RETRY_AFTER_HEADER);
  if (raw === null) {
    return null;
  }
  const seconds = plainDecimalOrNull(raw);
  if (seconds !== null) {
    return delayOrNull(seconds * MS_PER_SECOND);
  }
  const retryAt = httpDateMs(raw.trim());
  return retryAt === null ? null : delayOrNull(retryAt - nowMs);
}
