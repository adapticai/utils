/**
 * How a transport speaks about a failure it did not cause, without repeating it.
 *
 * A request to a model provider carries a credential in a header. The layers
 * below a transport write their own failure messages, and a layer that refuses
 * a request it could not build quotes the part it refused: for a credential
 * that cannot be carried in a header, that part is the credential. A provider
 * that rejects a request may likewise quote back what it was sent. An error is
 * read far from where it was raised (an attempt record, a log line, a journal
 * row), so text taken from either source would carry the credential to every
 * one of those places.
 *
 * Two rules follow, and this module is their one implementation. A failure of
 * a lower layer is named by its class and its system code, which a runtime
 * assigns, and never by its message, which it writes freely. And text a
 * provider answered with has the credential taken out before it is put on an
 * error.
 *
 * @module llm/transports/failure-description
 */

/** How many links of a failure's chain of causes are described. */
const FAILURE_CAUSE_DEPTH = 4;

/**
 * What a failure's class name or system code looks like.
 *
 * Anything else found in those fields is not printed, so a description is made
 * only of identifiers a runtime assigns.
 */
const FAILURE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** What a link of the chain is called when it has no printable class name. */
const UNNAMED_FAILURE = "an unnamed failure";

/** What a thrown value is called when it is not an object at all. */
const NOT_AN_ERROR = "a thrown value that is not an error";

/** What joins one link of the chain to the one that caused it. */
const CAUSE_SEPARATOR = ", caused by ";

/** What stands where a credential was, in text this package did not write. */
export const CREDENTIAL_REMOVED = "[credential removed]";

/**
 * Whether a value is an object whose members can be read.
 *
 * @param value The value to test.
 * @returns True when it is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read one member of a thrown value.
 *
 * A thrown value is not this package's object, and a member of it may be an
 * accessor that throws. A member that cannot be read is treated as absent: the
 * failure being described has already happened, and a second one raised while
 * describing it would replace an error this package wrote with a raw one.
 *
 * @param holder The thrown value, or one of its causes.
 * @param member The member to read.
 * @returns The member's value, or `undefined` when it is absent or unreadable.
 */
function readMember(holder: Readonly<Record<string, unknown>>, member: "name" | "code" | "cause"): unknown {
  try {
    return holder[member];
  } catch {
    return undefined;
  }
}

/**
 * A printable identifier, or `null`.
 *
 * @param value A failure's `name` or `code`.
 * @returns The value when it is a short identifier, else `null`.
 */
function identifierOrNull(value: unknown): string | null {
  return typeof value === "string" && FAILURE_IDENTIFIER.test(value) ? value : null;
}

/**
 * Describe a failure of a lower layer without quoting it.
 *
 * Built from the class name and the system code of the failure and of each of
 * its causes, and never from a message. The chain of causes is followed for a
 * bounded number of links, so a chain that loops back on itself ends.
 *
 * @param error Whatever the lower layer threw.
 * @returns A description that names the failure and holds no text from it.
 */
export function describeFailure(error: unknown): string {
  const links: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < FAILURE_CAUSE_DEPTH && isRecord(current); depth += 1) {
    const name = identifierOrNull(readMember(current, "name")) ?? UNNAMED_FAILURE;
    const code = identifierOrNull(readMember(current, "code"));
    links.push(code === null ? name : `${name} ${code}`);
    current = readMember(current, "cause");
  }
  return links.length === 0 ? NOT_AN_ERROR : links.join(CAUSE_SEPARATOR);
}

/**
 * The forms in which a credential can stand in text that quotes it.
 *
 * As it was read; without the whitespace around it, which a header does not
 * carry and a provider therefore never received; and each of those as a JSON
 * string writes it, because a provider's answer is usually JSON and a quote or
 * a backslash inside the credential is escaped there. A credential that is
 * nothing but whitespace has no form: it is not a secret, and replacing it
 * would rewrite every run of blanks in the text.
 *
 * @param credential The credential a request was sent with.
 * @returns Its forms, longest first, none of them blank.
 */
function credentialForms(credential: string): readonly string[] {
  const carried = credential.trim();
  if (carried.length === 0) {
    return [];
  }
  const forms = new Set<string>();
  for (const form of [credential, carried]) {
    forms.add(form);
    forms.add(JSON.stringify(form).slice(1, -1));
  }
  return [...forms].sort((left, right) => right.length - left.length);
}

/**
 * Take a credential out of text this package did not write.
 *
 * Every occurrence is replaced, and the replacement is done on the whole text
 * before any of it is cut to an excerpt, so a credential lying across an
 * excerpt's bound is removed whole and not cut to a prefix. Text that does not
 * hold the credential is returned unchanged. A credential handed back altered
 * (masked, hashed or re-encoded) is not recognised.
 *
 * @param text Text from a provider or from a lower layer.
 * @param credential The credential the request was sent with, or `null` when
 *   none was read.
 * @returns The text with the credential replaced wherever it stood.
 */
export function withoutCredential(text: string, credential: string | null): string {
  if (credential === null) {
    return text;
  }
  let cleaned = text;
  for (const form of credentialForms(credential)) {
    cleaned = cleaned.split(form).join(CREDENTIAL_REMOVED);
  }
  return cleaned;
}
