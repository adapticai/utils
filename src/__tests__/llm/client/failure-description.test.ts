import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_REMOVED,
  describeFailure,
  withoutCredential,
} from "../../../llm/transports/failure-description";
import { isExactly } from "./support/exposure";

/**
 * A credential-shaped value, assembled at runtime so no credential-shaped text
 * stands in the tree for a secret scan to stop on.
 */
const SENTINEL = ["sk", "test", "4b8e1d7c2a9f", "do-not-leak"].join("-");

/** A credential a JSON string has to escape: it holds a quote and a backslash. */
const ESCAPED_SENTINEL = ["sk", "test", '7c"1e\\9a', "do-not-leak"].join("-");

/** How many links of a chain of causes a description names. */
const DESCRIBED_LINKS = 4;

/**
 * A failure shaped the way the platform's HTTP client raises a refused
 * connection: a generic outer error whose cause carries the system code.
 *
 * @returns The failure.
 */
function refusedConnection(): Error {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" }),
  });
}

describe("describeFailure", () => {
  it("names a failure by class and system code, down its chain of causes", () => {
    expect(describeFailure(refusedConnection())).toBe("TypeError, caused by Error ECONNREFUSED");
  });

  it("holds no text from a failure's message, at any link", () => {
    const quoting = new TypeError(`Headers.append: "Bearer ${SENTINEL}" is an invalid header value.`, {
      cause: new Error(`refused ${SENTINEL}`),
    });

    const description = describeFailure(quoting);

    expect(isExactly(description, "TypeError, caused by Error")).toBe(true);
    expect(description.includes(SENTINEL)).toBe(false);
  });

  it("describes the failure the platform itself raises for an unsendable header without quoting it", () => {
    // The real failure, raised by the real header layer.
    let raised: unknown;
    try {
      new Headers().append("authorization", `Bearer ${SENTINEL}\nsecond-line`);
    } catch (error) {
      raised = error;
    }

    // Anti-vacuity: this runtime does quote the header in its message.
    expect(raised instanceof Error && raised.message.includes(SENTINEL)).toBe(true);
    expect(describeFailure(raised).includes(SENTINEL)).toBe(false);
  });

  it("prints a name or a code only when it is an identifier", () => {
    const freeText = Object.assign(new Error("x"), { name: `refused ${SENTINEL}`, code: `E ${SENTINEL}` });
    const numericCode = Object.assign(new Error("x"), { code: 404 });

    expect(isExactly(describeFailure(freeText), "an unnamed failure")).toBe(true);
    expect(describeFailure(numericCode)).toBe("Error");
  });

  it("says a thrown value is not an error instead of printing it", () => {
    expect(isExactly(describeFailure(`refused ${SENTINEL}`), "a thrown value that is not an error")).toBe(true);
    expect(describeFailure(undefined)).toBe("a thrown value that is not an error");
    expect(describeFailure(null)).toBe("a thrown value that is not an error");
    expect(describeFailure([new Error("x")])).toBe("a thrown value that is not an error");
  });

  it("stops after a bounded number of causes, so a chain that loops ends", () => {
    const looping = new Error("first");
    Object.assign(looping, { cause: new RangeError("second", { cause: looping }) });

    const links = describeFailure(looping).split(", caused by ");

    expect(links).toHaveLength(DESCRIBED_LINKS);
    expect(links).toEqual(["Error", "RangeError", "Error", "RangeError"]);
  });

  it("describes a failure whose members cannot be read, and raises nothing of its own", () => {
    const hostile = Object.defineProperties(
      {},
      {
        name: {
          get: (): string => {
            throw new RangeError(`name of ${SENTINEL}`);
          },
        },
        code: {
          get: (): string => {
            throw new RangeError(`code of ${SENTINEL}`);
          },
        },
        cause: {
          get: (): unknown => {
            throw new RangeError(`cause of ${SENTINEL}`);
          },
        },
      },
    );

    expect(isExactly(describeFailure(hostile), "an unnamed failure")).toBe(true);
  });
});

describe("withoutCredential", () => {
  it("replaces every occurrence of the credential", () => {
    const text = `key ${SENTINEL} was rejected; received ${SENTINEL}`;

    expect(
      isExactly(
        withoutCredential(text, SENTINEL),
        `key ${CREDENTIAL_REMOVED} was rejected; received ${CREDENTIAL_REMOVED}`,
      ),
    ).toBe(true);
  });

  it("returns text that does not hold the credential unchanged", () => {
    const text = '{"error":{"message":"invalid api key"}}';

    expect(isExactly(withoutCredential(text, SENTINEL), text)).toBe(true);
  });

  it("recognises the credential a header carried when the one read had whitespace around it", () => {
    // A header drops whitespace at its end, so the provider received, and can
    // only quote back, the credential without it.
    const read = `${SENTINEL}\r\n`;
    const text = `Received API Key = ${SENTINEL}.`;

    expect(isExactly(withoutCredential(text, read), `Received API Key = ${CREDENTIAL_REMOVED}.`)).toBe(true);
  });

  it("recognises the credential as a JSON string writes it", () => {
    const body = JSON.stringify({ error: { message: `no such key: ${ESCAPED_SENTINEL}` } });
    // Anti-vacuity: the verbatim credential is not in the body, so removing
    // only the verbatim form would leave the escaped one standing.
    expect(body.includes(ESCAPED_SENTINEL)).toBe(false);

    const cleaned = withoutCredential(body, ESCAPED_SENTINEL);

    expect(isExactly(cleaned, JSON.stringify({ error: { message: `no such key: ${CREDENTIAL_REMOVED}` } }))).toBe(true);
  });

  it("recognises the JSON form of the credential a header carried, when the one read had whitespace around it", () => {
    // Both at once: the provider received the credential without the line
    // break, and quotes it back inside JSON, where its quote and backslash
    // are escaped. Neither the form as read nor its own JSON form is in the body.
    const read = `${ESCAPED_SENTINEL}\r\n`;
    const body = JSON.stringify({ error: { message: `no such key: ${ESCAPED_SENTINEL}` } });
    expect(body.includes(read)).toBe(false);
    expect(body.includes(JSON.stringify(read).slice(1, -1))).toBe(false);
    expect(body.includes(ESCAPED_SENTINEL)).toBe(false);

    const cleaned = withoutCredential(body, read);

    expect(isExactly(cleaned, JSON.stringify({ error: { message: `no such key: ${CREDENTIAL_REMOVED}` } }))).toBe(true);
  });

  it("leaves text alone when no credential was read, or the one read is blank", () => {
    const text = "connection   refused";

    expect(withoutCredential(text, null)).toBe(text);
    expect(withoutCredential(text, "")).toBe(text);
    // A blank credential is not a secret; replacing it would rewrite the text's own spacing.
    expect(withoutCredential(text, "   ")).toBe(text);
  });
});
