/**
 * Whether a raised value exposes a secret, in any form a reader could meet it.
 *
 * An error is read in more ways than its message: it is turned to text, to
 * JSON, to an inspection dump by a logger, and its causes are followed. A
 * secret absent from the message and present in a cause is still exposed. So
 * the question is asked of every one of those forms at once.
 *
 * The answer is a boolean on purpose. An assertion that compared the texts
 * themselves would print them when it failed, and the text of a failing
 * assertion is exactly where the secret must not appear.
 *
 * @module __tests__/llm/client/support/exposure
 */

import { inspect } from "node:util";

/** How far into a value's own members and causes the search goes. */
const EXPOSURE_SEARCH_DEPTH = 8;

/**
 * A value as JSON, or empty text when it has no JSON form.
 *
 * @param value The value.
 * @returns Its JSON, or empty text.
 */
function jsonOf(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Every text a reader could get out of a value.
 *
 * Covers the value as a string, as JSON and as an inspection dump, and repeats
 * that for each of its own members, enumerable or not, which is where an
 * error keeps its message, its stack and its cause.
 *
 * @param value The raised value.
 * @returns The texts.
 */
export function textsOf(value: unknown): string[] {
  const texts: string[] = [];
  const seen = new Set<unknown>();
  const visit = (current: unknown, depth: number): void => {
    if (typeof current === "string") {
      texts.push(current);
      return;
    }
    if (typeof current !== "object" || current === null) {
      texts.push(String(current));
      return;
    }
    if (depth > EXPOSURE_SEARCH_DEPTH || seen.has(current)) {
      return;
    }
    seen.add(current);
    texts.push(String(current), jsonOf(current), inspect(current, { depth: EXPOSURE_SEARCH_DEPTH }));
    for (const name of Object.getOwnPropertyNames(current)) {
      visit((current as Record<string, unknown>)[name], depth + 1);
    }
  };
  visit(value, 0);
  return texts;
}

/**
 * Whether any form of a value holds any of the given secrets.
 *
 * @param value The raised value.
 * @param secrets The texts that must not appear.
 * @returns True when at least one of them appears somewhere.
 */
export function exposes(value: unknown, secrets: readonly string[]): boolean {
  const texts = textsOf(value);
  return secrets.some((secret) => texts.some((text) => text.includes(secret)));
}

/**
 * Whether a text is exactly the expected one.
 *
 * Asked as a boolean for the same reason as {@link exposes}: a failing
 * equality assertion prints the text it received, and the text a regression
 * would produce here is the one that holds the secret.
 *
 * @param actual The text under test, or whatever stands where it should be.
 * @param expected The text it must be.
 * @returns True when they are the same text.
 */
export function isExactly(actual: unknown, expected: string): boolean {
  return actual === expected;
}

/** What a call that must fail turned out to do. */
export type Raised = { readonly raised: true; readonly value: unknown } | { readonly raised: false };

/**
 * Await a call and report what it raised, whatever that is.
 *
 * A call may reject with a value that is not an error, `null` included, so the
 * outcome is reported as a record and not as the value alone.
 *
 * @param promise The call under test.
 * @returns What it raised, or that it resolved.
 */
export async function raisedBy(promise: Promise<unknown>): Promise<Raised> {
  try {
    await promise;
  } catch (error) {
    return { raised: true, value: error };
  }
  return { raised: false };
}
