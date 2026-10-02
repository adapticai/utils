/**
 * The hosted typed-decision transport.
 *
 * The transport is the only code in this package that speaks to the vendor, so
 * these tests pin what a caller relies on it for: that it makes one request and
 * only one, that a failing status means the same thing whatever body came with
 * it, that an answer is handed back exactly as the vendor gave it, that an
 * abort comes back as the reason the caller aborted with, and that the key
 * cannot be read out of anything it raises.
 *
 * No request leaves the process. Vendor behaviour is replayed from the contract
 * fixtures, each loaded under the class of evidence it rests on, and the clock
 * is injected, so nothing here waits on real time.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DECISION_ERROR_BODY_EXCERPT,
  DecisionCallError,
  DecisionCredentialError,
  DecisionRequestInvalidError,
  DecisionResponseFormatError,
  DecisionTransportError,
} from "../../../llm/decision/errors";
import type { DecisionFault } from "../../../llm/decision/errors";
import type { ResolvedDecisionRoute } from "../../../llm/decision/route-types";
import {
  SYSTEMONE_PATH,
  VENDOR_REQUEST_ID_HEADER,
  createSystemOneTransport,
  decisionFaultForStatus,
} from "../../../llm/decision/transports/systemone";
import type {
  DecisionStatusFault,
  SystemOneFetch,
  SystemOneFetchResponse,
  SystemOneTransport,
} from "../../../llm/decision/transports/systemone";
import type { DecisionJson, DecisionWireRequest } from "../../../llm/decision/types";
import {
  createDecisionFetchDouble,
  decisionResponse,
  decisionResponseFromFixture,
  unreadableDecisionResponse,
} from "./support/fetch-double";
import type { DecisionFetchDouble, DecisionFetchScript, RecordedDecisionFetch } from "./support/fetch-double";
import { loadDecisionFixture } from "./support/fixtures";

/** Env-var NAME the test route reads its key from. */
const KEY_ENV = "DECISION_TRANSPORT_TEST_KEY";

/**
 * A recognisable stand-in for the key, searched for in everything raised.
 *
 * Assembled at runtime so that no credential-shaped literal sits in the tree
 * for a secret scan to trip over.
 */
const SENTINEL_KEY = ["dk", "test", "4b8e1f0a7c2d9e63", "do-not-leak"].join("-");

/** A second key, to show the variable is read again on every call. */
const ROTATED_KEY = ["dk", "test", "rotated", "0d5a"].join("-");

/**
 * A key made only of letters and digits, so that it has the form of a
 * failure's class name or system code and would be printed as one.
 */
const IDENTIFIER_KEY = ["dk", "Test", "9f3c5a7e1b2d4068", "DoNotLeak"].join("");

/** What follows the key in a value that is not a usable key. It must not appear in an error either. */
const AFTER_THE_KEY = ["after", "the", "key", "7e2d"].join("-");

/** A key a JSON string has to escape: it holds a quote and a backslash. */
const ESCAPED_KEY = ["dk", "test", '6f"3a\\8c', "do-not-leak"].join("-");

/** What the transport leaves where it took the key out of text it did not write. */
const KEY_REMOVED = "[credential removed]";

/** The scheme the key is sent under, as it would be quoted with the key. */
const BEARER = "Bearer ";

/** Base URL of the test route; reserved, so it can never resolve. */
const BASE_URL = "https://decision-vendor.invalid";

/** The provider and model pin the test route declares. */
const PROVIDER = "decision-vendor";
const MODEL_PIN = "pinned-model-1.0.0";

/** A model a vendor reports answering with that is not the route's pin. */
const SUBSTITUTED_MODEL = "pinned-model-1.1.0";

/** A vendor request id, in the form the observed response header carries one. */
const REQUEST_ID = "req_0123456789abcdef0123456789abcdef";

/** The instant the injected clock starts at. */
const NOW_MS = Date.UTC(2026, 9, 1, 12, 0, 0);

/** How long the scripted vendor takes to answer, on the injected clock. */
const VENDOR_LATENCY_MS = 137;

/** How long the scripted vendor takes before it answers with a retry date, on the injected clock. */
const LATENCY_BEFORE_A_HINT_MS = 5_000;

/** The retry hint the tests send, in seconds and in the milliseconds it means. */
const RETRY_AFTER_SECONDS = "30";
const RETRY_AFTER_MS = 30_000;

/** The status the tests replay a documented success under; the reference quotes none. */
const OK = 200;

/** The statuses whose bodies nobody has observed. */
const UNOBSERVED_BODY_STATUSES: readonly number[] = [401, 422, 429, 529];

/** The range of statuses the table is checked over, and the answers inside it. */
const FIRST_STATUS = 100;
const LAST_STATUS = 599;
const FIRST_SUCCESS = 200;
const LAST_SUCCESS = 299;

/** Token counts and cost of the documented example at the test route's price. */
const DOCUMENTED_INPUT_TOKENS = 318;
const DOCUMENTED_OUTPUT_TOKENS = 34;
const DOCUMENTED_COST = 0.000013356;
const COST_DIGITS = 12;

/** Length of a header value far past the excerpt bound. */
const LONG_HEADER_CHARS = 5_000;

/** How much of a key lies inside the excerpt's bound when the rest lies past it. */
const KEY_CHARS_INSIDE_THE_BOUND = 12;

/** How deep a raised error is printed when it is searched for the key. */
const INSPECT_DEPTH = 8;

/** The route every test calls, as the route table's loader would resolve one. */
const ROUTE: ResolvedDecisionRoute = {
  route: "dm.hosted",
  providerName: PROVIDER,
  provider: {
    api_style: "systemone",
    base_url: BASE_URL,
    base_url_env: null,
    api_key_env: KEY_ENV,
    secret_path: "test/decision-vendor",
    account_status: "live",
  },
  modelPin: MODEL_PIN,
  expectedServedModel: MODEL_PIN,
  budgetMs: 1_500,
  caps: { maxOptions: 255, maxScoreLevels: 10, maxQuestions: null },
  maxStateTokens: 32_000,
  priceAnchor: { input: 0.042, output: 0, as_of: "2026-10-01" },
  apiKeyEnv: KEY_ENV,
  baseUrl: BASE_URL,
};

/** An encoded request, as the codec would hand one over. */
const WIRE_REQUEST: DecisionWireRequest = {
  state: "Help! My payouts have been failing for 3 days.",
  model: MODEL_PIN,
  questions: {
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: { billing: "Payments, invoicing, refunds", technical: null },
    },
  },
};

/** What a status should mean, written from the contract's table and not from the module. */
interface ExpectedStatusFault {
  readonly fault: DecisionFault;
  readonly retryable: boolean;
  readonly breakerKind: "capacity" | "hard" | null;
}

/**
 * The fault the contract's table gives a status.
 *
 * @param status A status that is not an answer.
 * @returns The fault, whether a retry could help, and how a breaker counts it.
 */
function expectedFaultFor(status: number): ExpectedStatusFault {
  if (status === 401 || status === 403) {
    return { fault: "credential", retryable: false, breakerKind: null };
  }
  if (status === 422) {
    return { fault: "schema", retryable: false, breakerKind: null };
  }
  if (status === 408 || status === 429 || status === 503 || status === 529) {
    return { fault: "transport", retryable: true, breakerKind: "capacity" };
  }
  if (status >= 500 && status <= 599) {
    return { fault: "transport", retryable: true, breakerKind: "hard" };
  }
  return { fault: "transport", retryable: false, breakerKind: "hard" };
}

/** A transport over a scripted HTTP call, with the clock it reads. */
interface Harness {
  readonly transport: SystemOneTransport;
  readonly double: DecisionFetchDouble;
  /** Move the injected clock forward. */
  readonly advance: (ms: number) => void;
}

/**
 * Build a transport over a scripted HTTP call and an injected clock.
 *
 * @param script What the scripted call does with each request.
 * @returns The transport, the recorded requests and the clock's control.
 */
function harnessOver(script: DecisionFetchScript): Harness {
  let nowMs = NOW_MS;
  const double = createDecisionFetchDouble(script);
  return {
    transport: createSystemOneTransport({ fetchImpl: double.fetchImpl, now: () => nowMs }),
    double,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

/**
 * Whether a text is exactly the expected one.
 *
 * Asked as a boolean, so that an assertion which fails prints neither text:
 * the one a regression would produce here is the one that holds the key.
 *
 * @param actual The text under test, or whatever stands where it should be.
 * @param expected The text it must be.
 * @returns True when they are the same text.
 */
function isExactly(actual: unknown, expected: string): boolean {
  return actual === expected;
}

/**
 * Make one call on the test route.
 *
 * @param transport The transport.
 * @param signal The abort signal; one that never aborts when omitted.
 * @returns The transport's promise.
 */
function call(transport: SystemOneTransport, signal: AbortSignal = new AbortController().signal) {
  return transport.execute({ route: ROUTE, body: WIRE_REQUEST, signal });
}

/**
 * The value a promise rejects with.
 *
 * @param promise The promise.
 * @returns What it rejected with.
 * @throws When it resolves, because a failure that resolves is the defect.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("the call resolved; it should have rejected");
}

/**
 * The reason a signal was aborted with.
 *
 * @param signal The signal.
 * @returns Its reason, untyped, exactly as the platform holds it.
 */
function reasonOf(signal: AbortSignal): unknown {
  return signal.reason;
}

/**
 * Whether anything a reader of a raised value could see holds a piece of text.
 *
 * @param raised The raised value.
 * @param needle The text looked for.
 * @returns True when some rendering of the value holds it.
 */
function showsText(raised: unknown, needle: string): boolean {
  return everyTextOf(raised).some((text) => text.includes(needle));
}

/**
 * Narrow a value to an instance of a class, failing the test when it is not one.
 *
 * @param value The value.
 * @param type The class.
 * @returns The value, typed.
 */
function asInstance<T>(value: unknown, type: abstract new (...args: never[]) => T): T {
  if (!(value instanceof type)) {
    throw new Error(`expected ${type.name}, got ${inspect(value, { depth: 1 })}`);
  }
  return value;
}

/**
 * Narrow a value to one of this package's decision errors.
 *
 * Separate from {@link asInstance} because the base class cannot be
 * constructed from outside, so it does not fit a constructor-typed parameter.
 *
 * @param value The value.
 * @returns The value, typed.
 */
function asCallError(value: unknown): DecisionCallError {
  if (!(value instanceof DecisionCallError)) {
    throw new Error(`expected a decision error, got ${inspect(value, { depth: 1 })}`);
  }
  return value;
}

/**
 * Everything a reader of a raised error could see, as text.
 *
 * @param error The raised value.
 * @returns Its message, string form, stack, JSON form and a deep print of
 *   every own property, hidden ones included.
 */
function everyTextOf(error: unknown): readonly string[] {
  const texts = [String(error), inspect(error, { depth: INSPECT_DEPTH, showHidden: true })];
  const json: unknown = JSON.stringify(error);
  if (typeof json === "string") {
    texts.push(json);
  }
  if (error instanceof Error) {
    texts.push(error.message, error.stack ?? "");
    for (const name of Object.getOwnPropertyNames(error)) {
      texts.push(inspect(Object.getOwnPropertyDescriptor(error, name)?.value, { depth: INSPECT_DEPTH }));
    }
  }
  return texts;
}

/**
 * Every source file under a directory, recursively.
 *
 * @param dir The directory.
 * @returns Absolute paths of the `.ts` files in it.
 */
function sourcesUnder(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourcesUnder(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("the hosted decision transport", () => {
  let previousKey: string | undefined;

  beforeEach(() => {
    previousKey = process.env[KEY_ENV];
    process.env[KEY_ENV] = SENTINEL_KEY;
  });

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env[KEY_ENV];
    } else {
      process.env[KEY_ENV] = previousKey;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * The documented success, as a response.
   *
   * @param headers Headers to send with it.
   * @returns The response.
   */
  function documentedSuccess(headers: Readonly<Record<string, string>> = {}): SystemOneFetchResponse {
    const { envelope } = loadDecisionFixture("response.choice.documented.json", { allow: ["documented-verbatim"] });
    return decisionResponseFromFixture(envelope, OK, headers);
  }

  it("makes exactly one POST to the systemone path with bearer auth, JSON headers, redirects refused and the caller's signal", async () => {
    const { transport, double } = harnessOver(() => documentedSuccess());
    const controller = new AbortController();

    await call(transport, controller.signal);

    expect(double.calls).toHaveLength(1);
    const [sent] = double.calls;
    expect(sent.url).toBe(`${BASE_URL}${SYSTEMONE_PATH}`);
    expect(SYSTEMONE_PATH).toBe("/v1/systemone");
    expect(sent.method).toBe("POST");
    // The whole header set: nothing the contract does not document is sent.
    expect(sent.headers).toEqual({
      authorization: `Bearer ${SENTINEL_KEY}`,
      "content-type": "application/json",
      accept: "application/json",
    });
    expect(sent.redirect).toBe("error");
    expect(sent.signal).toBe(controller.signal);
    // The encoded request is sent as given, with nothing added and nothing reordered.
    expect(sent.body).toBe(JSON.stringify(WIRE_REQUEST));
  });

  it("joins the path to a base URL written with a trailing slash", async () => {
    const { transport, double } = harnessOver(() => documentedSuccess());
    await transport.execute({
      route: { ...ROUTE, baseUrl: `${BASE_URL}/` },
      body: WIRE_REQUEST,
      signal: new AbortController().signal,
    });
    expect(double.calls[0].url).toBe(`${BASE_URL}${SYSTEMONE_PATH}`);
  });

  it("reads the key by name on every call", async () => {
    const { transport, double } = harnessOver(() => documentedSuccess());

    await call(transport);
    process.env[KEY_ENV] = ROTATED_KEY;
    await call(transport);

    expect(double.calls.map((sent) => sent.headers.authorization)).toEqual([
      `Bearer ${SENTINEL_KEY}`,
      `Bearer ${ROTATED_KEY}`,
    ]);
  });

  it("an unset key is a credential fault and no request leaves", async () => {
    const { transport, double } = harnessOver(() => documentedSuccess());

    const unset: readonly (string | undefined)[] = [undefined, "", "   ", "\t\n"];
    for (const value of unset) {
      if (value === undefined) {
        delete process.env[KEY_ENV];
      } else {
        process.env[KEY_ENV] = value;
      }
      const error = asInstance(await rejectionOf(call(transport)), DecisionCredentialError);
      expect(error.fault).toBe("credential");
      expect(error.source).toBe("key_unset");
      expect(error.apiKeyEnv).toBe(KEY_ENV);
      expect(error.route).toBe(ROUTE.route);
      expect(error.status).toBeNull();
    }
    expect(double.calls).toHaveLength(0);
  });

  it("a key that cannot be sent as a credential is a credential fault and no request is made", async () => {
    // Counted where the transport calls it: the scripted call below builds a
    // real request first, so a key the runtime refuses would never be recorded
    // by it, whether or not the transport tried to send one.
    let handedToHttp = 0;
    const double = createDecisionFetchDouble(() => documentedSuccess());
    const transport = createSystemOneTransport({
      fetchImpl: (url, init) => {
        handedToHttp += 1;
        return double.fetchImpl(url, init);
      },
      now: () => NOW_MS,
    });

    const unusable: readonly string[] = [
      `${SENTINEL_KEY}\n${AFTER_THE_KEY}`,
      `${SENTINEL_KEY}\r\n${AFTER_THE_KEY}`,
      `${SENTINEL_KEY} ${AFTER_THE_KEY}`,
      `${SENTINEL_KEY}\t${AFTER_THE_KEY}`,
      `${SENTINEL_KEY}\u0001${AFTER_THE_KEY}`,
      `${SENTINEL_KEY}\u007f${AFTER_THE_KEY}`,
      `${SENTINEL_KEY}\u00e9${AFTER_THE_KEY}`,
      `${SENTINEL_KEY}\u201d${AFTER_THE_KEY}`,
      `  ${SENTINEL_KEY}\n${AFTER_THE_KEY}\n`,
    ];
    for (const [index, value] of unusable.entries()) {
      process.env[KEY_ENV] = value;
      // Whatever the signal's state: the refusal is made before a request exists.
      for (const signal of [new AbortController().signal, AbortSignal.abort()]) {
        const where = `value ${index}, signal ${signal.aborted ? "aborted" : "live"}`;
        const error = asInstance(await rejectionOf(call(transport, signal)), DecisionCredentialError);
        expect(error.fault, where).toBe("credential");
        expect(error.source, where).toBe("key_unusable");
        expect(error.apiKeyEnv, where).toBe(KEY_ENV);
        expect(error.route, where).toBe(ROUTE.route);
        expect(error.status, where).toBeNull();
        expect(error.retryAfterMs, where).toBeNull();
        expect(error.bodyExcerpt, where).toBeNull();
        expect(showsText(error, SENTINEL_KEY), `${where}: the error carried the key`).toBe(false);
        expect(showsText(error, AFTER_THE_KEY), `${where}: the error carried the value`).toBe(false);
        expect(
          isExactly(
            error.message,
            `${KEY_ENV} holds a value that cannot be sent as a credential, so decision route ${ROUTE.route} ` +
              "cannot be authenticated against; no request was made",
          ),
          where,
        ).toBe(true);
      }
    }
    expect(handedToHttp).toBe(0);
    expect(double.calls).toHaveLength(0);

    // Every character a credential can be made of is sent, so nothing usable is refused.
    const visible = Array.from({ length: 0x7e - 0x21 + 1 }, (_unused, offset) => String.fromCharCode(0x21 + offset)).join("");
    process.env[KEY_ENV] = visible;
    await call(transport);
    expect(handedToHttp).toBe(1);
    expect(double.calls[0].headers.authorization === `${BEARER}${visible}`).toBe(true);
  });

  it("sends a key without the whitespace around it", async () => {
    const { transport, double } = harnessOver(() => documentedSuccess());
    process.env[KEY_ENV] = `  ${SENTINEL_KEY}\n`;
    await call(transport);
    expect(double.calls[0].headers.authorization).toBe(`Bearer ${SENTINEL_KEY}`);
  });

  it("every status from 100 to 599 outside 2xx maps as the table says, in one request", async () => {
    let checked = 0;
    for (let status = FIRST_STATUS; status <= LAST_STATUS; status += 1) {
      if (status >= FIRST_SUCCESS && status <= LAST_SUCCESS) {
        continue;
      }
      checked += 1;
      const expected = expectedFaultFor(status);
      const { transport, double } = harnessOver(() =>
        decisionResponse(status, "{}", { "retry-after": RETRY_AFTER_SECONDS }),
      );

      const error = asCallError(await rejectionOf(call(transport)));

      expect(double.calls, `requests for ${status}`).toHaveLength(1);
      expect(error.fault, `fault for ${status}`).toBe(expected.fault);
      expect(error.status, `status carried for ${status}`).toBe(status);
      expect(error.route).toBe(ROUTE.route);
      // A hint is carried only where a retry could help.
      expect(error.retryAfterMs, `retry hint for ${status}`).toBe(expected.retryable ? RETRY_AFTER_MS : null);
      if (expected.fault === "credential") {
        expect(asInstance(error, DecisionCredentialError).source).toBe("vendor_rejected");
      } else if (expected.fault === "schema") {
        expect(asInstance(error, DecisionRequestInvalidError).source).toBe("vendor_rejected");
      } else {
        const transportError = asInstance(error, DecisionTransportError);
        expect(transportError.source).toBe("status");
        expect(transportError.retryable, `retryable for ${status}`).toBe(expected.retryable);
      }
      const classified: DecisionStatusFault | null = decisionFaultForStatus(status);
      expect(classified, `table row for ${status}`).toEqual(expected);
    }
    expect(checked).toBe(LAST_STATUS - FIRST_STATUS + 1 - (LAST_SUCCESS - FIRST_SUCCESS + 1));
  });

  it("only a status in the success range is an answer", () => {
    for (let status = FIRST_SUCCESS; status <= LAST_SUCCESS; status += 1) {
      expect(decisionFaultForStatus(status), `status ${status}`).toBeNull();
    }
    const notStatuses: readonly number[] = [0, -1, 99, 600, 999, 200.5, Number.NaN, Number.POSITIVE_INFINITY];
    for (const status of notStatuses) {
      expect(decisionFaultForStatus(status), `status ${status}`).toEqual({
        fault: "transport",
        retryable: false,
        breakerKind: "hard",
      });
    }
  });

  it("the observed 403 is a credential fault with the vendor's error type and request id", async () => {
    const { envelope } = loadDecisionFixture("error.403-missing-key.observed.json", {
      allow: ["observed-unauthenticated"],
    });
    const { transport, double } = harnessOver(() => decisionResponseFromFixture(envelope, OK));

    const error = asInstance(await rejectionOf(call(transport)), DecisionCredentialError);

    expect(double.calls).toHaveLength(1);
    expect(error.fault).toBe("credential");
    expect(error.source).toBe("vendor_rejected");
    expect(error.status).toBe(403);
    expect(error.vendorErrorType).toBe("authentication_error");
    expect(error.vendorRequestId).toBe("req_01a0f845558d7b29bb19a4723e315da0");
    expect(error.bodyExcerpt).toBe(JSON.stringify(envelope.body));
    expect(error.apiKeyEnv).toBeNull();
    expect(error.retryAfterMs).toBeNull();
    expect(error.usage).toBeNull();
  });

  it("the observed 405 is a transport fault a retry cannot help, with no error type read out of its body", async () => {
    const { envelope } = loadDecisionFixture("error.405-method-not-allowed.observed.json", {
      allow: ["observed-unauthenticated"],
    });
    const { transport } = harnessOver(() => decisionResponseFromFixture(envelope, OK));

    const error = asInstance(await rejectionOf(call(transport)), DecisionTransportError);

    expect(error.status).toBe(405);
    expect(error.retryable).toBe(false);
    expect(error.vendorErrorType).toBeNull();
    expect(error.vendorRequestId).toBeNull();
  });

  it("the fault never depends on an unobserved body", async () => {
    const syntheticBodies = UNOBSERVED_BODY_STATUSES.map((status) =>
      JSON.stringify(
        loadDecisionFixture(`error.${status}.unobserved.json`, { allow: ["synthetic-unobserved"] }).envelope.body,
      ),
    );
    // Bodies that hold no error type in the one observed place: the synthetic
    // fixture of every status (so each status is also sent the others' words),
    // nothing, text that is not JSON, the six shapes the vendor's own client
    // tolerates, and near misses of the observed shape.
    const bodiesWithoutType: readonly string[] = [
      ...syntheticBodies,
      "",
      "<html><body>upstream error: invalid api key, rate limit exceeded</body></html>",
      JSON.stringify({ error: "Unauthorized: invalid api key" }),
      JSON.stringify({ error: { message: "rate limit exceeded", type: "rate_limit_error" } }),
      JSON.stringify({ message: "validation failed" }),
      JSON.stringify({ detail: "overloaded" }),
      JSON.stringify({ detail: { message: "Must supply an API key!" } }),
      JSON.stringify({ detail: [{ loc: ["body", "questions"], msg: "Field required" }] }),
      JSON.stringify({ detail: { error_type: "authentication_error" } }),
      JSON.stringify({ detail: { error_type: "authentication_error", message: "x", extra: 1 } }),
      JSON.stringify({ detail: { error_type: 7, message: "x" } }),
      JSON.stringify({ detail: { error_type: "", message: "x" } }),
      JSON.stringify({ detail: { error_type: "authentication_error", message: "x" }, error_type: "other" }),
      JSON.stringify([{ detail: { error_type: "authentication_error", message: "x" } }]),
    ];
    const observedShape = JSON.stringify({ detail: { error_type: "rate_limit_error", message: "slow down" } });

    for (const status of UNOBSERVED_BODY_STATUSES) {
      const expected = expectedFaultFor(status);
      for (const body of [...bodiesWithoutType, observedShape]) {
        const { transport, double } = harnessOver(() => decisionResponse(status, body));

        const error = asCallError(await rejectionOf(call(transport)));

        const where = `status ${status} with body ${body}`;
        expect(double.calls, where).toHaveLength(1);
        expect(error.fault, where).toBe(expected.fault);
        expect(error.status, where).toBe(status);
        const carried = error instanceof DecisionTransportError ? error : null;
        expect(carried === null ? expected.retryable : carried.retryable, where).toBe(expected.retryable);
        const typed = asInstance<DecisionCredentialError | DecisionRequestInvalidError | DecisionTransportError>(
          error,
          expected.fault === "credential"
            ? DecisionCredentialError
            : expected.fault === "schema"
              ? DecisionRequestInvalidError
              : DecisionTransportError,
        );
        expect(typed.vendorErrorType, where).toBe(body === observedShape ? "rate_limit_error" : null);
        expect(typed.bodyExcerpt, where).toBe(body);
      }
    }
  });

  it("a failing status whose body cannot be read is still the fault its status names", async () => {
    const { transport, double } = harnessOver(() =>
      unreadableDecisionResponse(401, new Error("socket hang up"), { [VENDOR_REQUEST_ID_HEADER]: REQUEST_ID }),
    );

    const error = asInstance(await rejectionOf(call(transport)), DecisionCredentialError);

    expect(double.calls).toHaveLength(1);
    expect(error.status).toBe(401);
    expect(error.bodyExcerpt).toBe("");
    expect(error.vendorRequestId).toBe(REQUEST_ID);

    // The same holds when the read was cut by the caller's own abort: the
    // status had already arrived, and it is the status that is reported.
    const controller = new AbortController();
    const cut = harnessOver(() => {
      controller.abort();
      return unreadableDecisionResponse(529, new DOMException("This operation was aborted", "AbortError"), {
        "retry-after-ms": "1500",
      });
    });
    const overloaded = asInstance(await rejectionOf(call(cut.transport, controller.signal)), DecisionTransportError);
    expect(overloaded.status).toBe(529);
    expect(overloaded.retryable).toBe(true);
    expect(overloaded.retryAfterMs).toBe(1_500);
  });

  it("a 429 with retry-after 30 settles at once and returns the hint", async () => {
    const { envelope } = loadDecisionFixture("error.429.unobserved.json", { allow: ["synthetic-unobserved"] });
    let requests = 0;
    // A plain scripted call: under fake timers nothing here may depend on one.
    const fetchImpl: SystemOneFetch = () => {
      requests += 1;
      return Promise.resolve(decisionResponseFromFixture(envelope, OK));
    };
    vi.useFakeTimers();
    const transport = createSystemOneTransport({ fetchImpl, now: () => NOW_MS });

    const pending = Symbol("pending");
    let outcome: unknown = pending;
    void call(transport).then(
      (value) => {
        outcome = value;
      },
      (error: unknown) => {
        outcome = error;
      },
    );
    // Run whatever is ready without moving time forward.
    await vi.advanceTimersByTimeAsync(0);

    const error = asInstance(outcome, DecisionTransportError);
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(RETRY_AFTER_MS);
    expect(requests).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("measures a retry hint written as a date against the injected clock", async () => {
    const { transport } = harnessOver(() => decisionResponse(503, "", { "retry-after": "Thu, 01 Oct 2026 12:00:30 GMT" }));
    const error = asInstance(await rejectionOf(call(transport)), DecisionTransportError);
    expect(error.retryAfterMs).toBe(RETRY_AFTER_MS);
  });

  it("measures a retry date against the instant the answer arrived, not the instant the call was sent", async () => {
    const harness = harnessOver(() => {
      harness.advance(LATENCY_BEFORE_A_HINT_MS);
      return decisionResponse(503, "", { "retry-after": "Thu, 01 Oct 2026 12:00:30 GMT" });
    });

    const error = asInstance(await rejectionOf(call(harness.transport)), DecisionTransportError);

    // The wait the vendor asked for is what is left of it when its answer is read.
    expect(error.retryAfterMs).toBe(RETRY_AFTER_MS - LATENCY_BEFORE_A_HINT_MS);
  });

  it("a request id header that is blank is no request id", async () => {
    for (const blank of ["", " ", "\t "]) {
      const answered = harnessOver(() => documentedSuccess({ [VENDOR_REQUEST_ID_HEADER]: blank }));
      expect((await call(answered.transport)).vendorRequestId, `answer, header ${JSON.stringify(blank)}`).toBeNull();

      const failed = harnessOver(() => decisionResponse(529, "", { [VENDOR_REQUEST_ID_HEADER]: blank }));
      const error = asInstance(await rejectionOf(call(failed.transport)), DecisionTransportError);
      expect(error.vendorRequestId, `failure, header ${JSON.stringify(blank)}`).toBeNull();
    }
  });

  it("an abort rejects with the signal's own reason and a network failure is a transport fault", async () => {
    // Aborted while the request is in flight. The platform's call rejects with
    // the signal's reason, and that very object is what the caller gets back.
    const inFlight = new AbortController();
    const aborted = harnessOver(() => {
      inFlight.abort();
      return Promise.reject<SystemOneFetchResponse>(reasonOf(inFlight.signal));
    });
    const raised = await rejectionOf(call(aborted.transport, inFlight.signal));
    expect(raised).toBe(reasonOf(inFlight.signal));
    expect(raised).toBeInstanceOf(DOMException);
    expect(raised).not.toBeInstanceOf(DecisionCallError);

    // A reason the caller chose comes back as the caller gave it, whatever the
    // HTTP layer raised of its own: that is how a caller tells its own deadline
    // from a vendor failure.
    const deadline = new Error("the caller's own deadline");
    const timed = new AbortController();
    const late = harnessOver(() => {
      timed.abort(deadline);
      throw new DOMException("This operation was aborted", "AbortError");
    });
    expect(await rejectionOf(call(late.transport, timed.signal))).toBe(deadline);

    // Aborted while an answer's body is being read.
    const midBody = new AbortController();
    const cut = harnessOver(() => {
      midBody.abort();
      return unreadableDecisionResponse(OK, new DOMException("This operation was aborted", "AbortError"));
    });
    const cutRaised = await rejectionOf(call(cut.transport, midBody.signal));
    expect(cutRaised).toBe(reasonOf(midBody.signal));
    expect(cutRaised).not.toBeInstanceOf(DecisionCallError);

    // The connection failed, and nobody aborted.
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" }),
    });
    const down = harnessOver(() => {
      throw refused;
    });
    const networkError = asInstance(await rejectionOf(call(down.transport)), DecisionTransportError);
    expect(down.double.calls).toHaveLength(1);
    expect(networkError.fault).toBe("transport");
    expect(networkError.source).toBe("network");
    expect(networkError.status).toBeNull();
    expect(networkError.retryable).toBe(true);
    expect(networkError.retryAfterMs).toBeNull();
    expect(networkError.bodyExcerpt).toBeNull();
    expect(networkError.route).toBe(ROUTE.route);
    // The failure is named by class and system code, and its message is not quoted.
    expect(networkError.message).toContain("TypeError");
    expect(networkError.message).toContain("ECONNREFUSED");
    expect(networkError.message).not.toContain("10.0.0.1");

    // An answer's body that stops arriving is a failure to get the answer.
    const dropped = harnessOver(() => unreadableDecisionResponse(OK, new Error("terminated")));
    const droppedError = asInstance(await rejectionOf(call(dropped.transport)), DecisionTransportError);
    expect(droppedError.source).toBe("network");
    expect(droppedError.status).toBeNull();

    // A thrown value that is not an error is still this package's fault class.
    const odd = harnessOver(() => Promise.reject<SystemOneFetchResponse>("connection reset"));
    const oddError = asInstance(await rejectionOf(call(odd.transport)), DecisionTransportError);
    expect(oddError.source).toBe("network");
    expect(oddError.message).not.toContain("connection reset");
  });

  it("names a network failure only by an identifier, and by nothing when it has none", async () => {
    // A name and a code that are free text are another layer's words, like a message.
    const worded = harnessOver(() => {
      throw Object.assign(new Error("request failed"), { name: "the request was refused", code: "see the log" });
    });
    const wordedError = asInstance(await rejectionOf(call(worded.transport)), DecisionTransportError);
    expect(wordedError.message).toBe(`decision route ${ROUTE.route} could not be reached: an unnamed failure`);

    // A failure whose members cannot even be read is described all the same:
    // what is raised is this package's fault, never the failure of describing one.
    const unreadable = harnessOver(() => {
      throw Object.defineProperties(
        {},
        {
          name: {
            get: (): string => {
              throw new RangeError("the name cannot be read");
            },
          },
          code: {
            get: (): string => {
              throw new RangeError("the code cannot be read");
            },
          },
          cause: {
            get: (): unknown => {
              throw new RangeError("the cause cannot be read");
            },
          },
        },
      );
    });
    const unreadableError = asInstance(await rejectionOf(call(unreadable.transport)), DecisionTransportError);
    expect(unreadableError.source).toBe("network");
    expect(unreadableError.retryable).toBe(true);
    expect(unreadableError.message).toBe(`decision route ${ROUTE.route} could not be reached: an unnamed failure`);
  });

  it("an abort with a null reason rejects with null, not with what the HTTP layer threw", async () => {
    const controller = new AbortController();
    const { transport, double } = harnessOver((sent) => {
      controller.abort(null);
      throw new TypeError(`request failed; headers were ${JSON.stringify(sent.headers)}`);
    });

    let raised: unknown = "the call resolved";
    try {
      await call(transport, controller.signal);
    } catch (error) {
      raised = error;
    }

    expect(double.calls).toHaveLength(1);
    expect(reasonOf(controller.signal)).toBeNull();
    expect(raised === null).toBe(true);
  });

  it("over the platform's own HTTP call an abort is the signal's reason, the object that call itself raises", async () => {
    // The request is aborted before it is made, so nothing leaves the process.
    const signal = AbortSignal.abort();

    // What the platform's call raises for an aborted request is the reason itself.
    const platformRaised = await rejectionOf(
      fetch(`${BASE_URL}${SYSTEMONE_PATH}`, { method: "POST", body: JSON.stringify(WIRE_REQUEST), signal }),
    );
    expect(platformRaised).toBe(reasonOf(signal));

    // So raising the reason hands a caller of the platform's call the same
    // object that rethrowing the platform's error would.
    const transport = createSystemOneTransport();
    expect(await rejectionOf(call(transport, signal))).toBe(platformRaised);
  });

  it("a success returns the vendor's answering model, request id, usage and the undecoded payload", async () => {
    const { envelope } = loadDecisionFixture("response.choice.documented.json", { allow: ["documented-verbatim"] });
    const harness = harnessOver(() => {
      harness.advance(VENDOR_LATENCY_MS);
      return decisionResponseFromFixture(envelope, OK, { [VENDOR_REQUEST_ID_HEADER]: REQUEST_ID });
    });

    const result = await call(harness.transport);

    expect(harness.double.calls).toHaveLength(1);
    expect(result.payload).toEqual(envelope.body);
    // The fixture answers under its own model id, which is not the route's pin:
    // what comes back is what the vendor said, never what the request named.
    expect(result.servedModel).toBe("jev-1.13.0");
    expect(result.servedModel).not.toBe(ROUTE.modelPin);
    expect(result.vendorRequestId).toBe(REQUEST_ID);
    expect(result.status).toBe(OK);
    expect(result.durationMs).toBe(VENDOR_LATENCY_MS);
    expect(result.usage.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
    expect(result.usage.completion_tokens).toBe(DOCUMENTED_OUTPUT_TOKENS);
    expect(result.usage.provider).toBe(PROVIDER);
    expect(result.usage.model).toBe(MODEL_PIN);
    expect(result.usage.cost).toBeCloseTo(DOCUMENTED_COST, COST_DIGITS);
  });

  it("returns whichever model answered, in full, and does not validate the answers", async () => {
    const answers: DecisionJson = "not an answer map";
    for (const servedModel of [MODEL_PIN, SUBSTITUTED_MODEL, "jev-1.14.0", ` ${MODEL_PIN}`, "m".repeat(LONG_HEADER_CHARS)]) {
      const { transport } = harnessOver(() => decisionResponse(OK, JSON.stringify({ model: servedModel, answers })));
      const result = await call(transport);
      expect(result.servedModel).toBe(servedModel);
      expect(result.payload).toEqual({ model: servedModel, answers });
    }
  });

  it("a success that reports no usage and no request id has null counts, a null cost and a null id", async () => {
    const { envelope } = loadDecisionFixture("response.laya-serve-shape.constructed.json", {
      allow: ["constructed-from-documented-fields"],
    });
    const { transport } = harnessOver(() => decisionResponseFromFixture(envelope, OK));

    const result = await call(transport);

    expect(result.servedModel).toBe("english");
    // Fields this layer has no name for stay in the payload for the decoder to judge.
    expect(result.payload).toEqual(envelope.body);
    expect(result.usage).toEqual({
      prompt_tokens: null,
      completion_tokens: null,
      provider: PROVIDER,
      model: MODEL_PIN,
      cost: null,
    });
    expect(result.vendorRequestId).toBeNull();
  });

  it("carries the vendor's request id as a bounded, printable excerpt", async () => {
    const hostile = `req_\u001b[31m${"x".repeat(LONG_HEADER_CHARS)}`;
    const { transport } = harnessOver(() => documentedSuccess({ [VENDOR_REQUEST_ID_HEADER]: hostile }));

    const result = await call(transport);

    expect(result.vendorRequestId).not.toBeNull();
    expect(result.vendorRequestId).toHaveLength(DECISION_ERROR_BODY_EXCERPT);
    expect(result.vendorRequestId).toMatch(/^req_�\[31mx+$/);
  });

  it("a 2xx that is not JSON, or names no model, is a schema fault with its field path", async () => {
    const notObjects: readonly string[] = ["", "<html>ok</html>", "[]", "null", '"text"', "7", '{"model": '];
    for (const body of notObjects) {
      const { transport, double } = harnessOver(() => decisionResponse(OK, body, { [VENDOR_REQUEST_ID_HEADER]: REQUEST_ID }));
      const error = asInstance(await rejectionOf(call(transport)), DecisionResponseFormatError);
      expect(double.calls, `body ${body}`).toHaveLength(1);
      expect(error.fault).toBe("schema");
      expect(error.fieldPath, `body ${body}`).toBe("$");
      expect(error.status).toBe(OK);
      expect(error.vendorRequestId).toBe(REQUEST_ID);
      // Nothing was read from a body that could not be, so nothing is claimed.
      expect(error.usage, `body ${body}`).toBeNull();
    }

    const billed = { input_tokens: DOCUMENTED_INPUT_TOKENS, output_tokens: DOCUMENTED_OUTPUT_TOKENS };
    const noModel: readonly unknown[] = [
      { answers: {}, usage: billed },
      { model: "", answers: {}, usage: billed },
      { model: "   ", answers: {}, usage: billed },
      { model: 7, answers: {}, usage: billed },
      { model: null, answers: {}, usage: billed },
      { model: [MODEL_PIN], answers: {}, usage: billed },
    ];
    for (const body of noModel) {
      const { transport } = harnessOver(() => decisionResponse(OK, JSON.stringify(body)));
      const error = asInstance(await rejectionOf(call(transport)), DecisionResponseFormatError);
      const where = `body ${JSON.stringify(body)}`;
      expect(error.fault, where).toBe("schema");
      expect(error.fieldPath, where).toBe("model");
      expect(error.status, where).toBe(OK);
      // The vendor billed for the answer it sent, usable or not.
      expect(error.usage?.prompt_tokens, where).toBe(DOCUMENTED_INPUT_TOKENS);
      expect(error.usage?.completion_tokens, where).toBe(DOCUMENTED_OUTPUT_TOKENS);
      expect(error.usage?.cost, where).toBeCloseTo(DOCUMENTED_COST, COST_DIGITS);
    }
  });

  it("a request that cannot be written as JSON is refused before any request leaves", async () => {
    const { transport, double } = harnessOver(() => documentedSuccess());
    const loop: { [key: string]: DecisionJson } = {};
    loop.self = loop;

    const error = asInstance(
      await rejectionOf(transport.execute({ route: ROUTE, body: { ...WIRE_REQUEST, state: loop }, signal: new AbortController().signal })),
      DecisionRequestInvalidError,
    );

    expect(error.source).toBe("request_validation");
    expect(error.fieldPath).toBe("$");
    expect(double.calls).toHaveLength(0);
  });

  it("the key appears in no error", async () => {
    const raised: unknown[] = [];
    const sentAuthorizations: string[] = [];
    /**
     * Make one call that must fail, and keep what it raised.
     *
     * @param script What the scripted call does.
     */
    const fail = async (script: DecisionFetchScript): Promise<void> => {
      const { transport, double } = harnessOver(script);
      raised.push(await rejectionOf(call(transport)));
      sentAuthorizations.push(...double.calls.map((sent) => sent.headers.authorization));
    };

    for (const status of [401, 403, 404, 422, 429, 500, 529]) {
      await fail(() => decisionResponse(status, JSON.stringify({ detail: "rejected" }), { "retry-after": "1" }));
    }
    await fail(() => decisionResponse(OK, "not json"));
    await fail(() => decisionResponse(OK, JSON.stringify({ answers: {} })));
    // A lower layer that quotes the request it failed on, as a runtime does.
    await fail((sent) => {
      throw new TypeError(`request failed; headers were ${JSON.stringify(sent.headers)}`);
    });
    await fail((sent) => {
      throw Object.assign(new Error("fetch failed"), { cause: new Error(sent.headers.authorization) });
    });
    await fail((sent) => unreadableDecisionResponse(OK, new Error(`reset while sending ${sent.headers.authorization}`)));

    // Anti-vacuity: every one of those calls really did send the key.
    expect(sentAuthorizations).toHaveLength(raised.length);
    for (const authorization of sentAuthorizations) {
      expect(authorization).toBe(`Bearer ${SENTINEL_KEY}`);
    }

    // A key the runtime cannot put in a header: the runtime refuses the request
    // and quotes the header, key included, in its own error.
    const unsendable = `${SENTINEL_KEY}\nsecond-line`;
    let runtimeMessage = "";
    try {
      new Request(BASE_URL, { headers: { authorization: `Bearer ${unsendable}` } });
    } catch (error) {
      runtimeMessage = String(error);
    }
    expect(runtimeMessage, "the runtime did not quote the header, so this case proves nothing").toContain(SENTINEL_KEY);
    process.env[KEY_ENV] = unsendable;
    const refused = harnessOver(() => documentedSuccess());
    raised.push(await rejectionOf(call(refused.transport)));
    expect(refused.double.calls).toHaveLength(0);

    // The caller's abort opens no way round. Whatever the HTTP layer raised as
    // the signal aborted is dropped, and the signal's own reason is raised.
    const abortedCalls: { readonly raised: unknown; readonly signal: AbortSignal; readonly where: string }[] = [];
    /**
     * Make one call whose HTTP layer fails, quoting the key, as the caller aborts.
     *
     * @param where The case, for a failure message.
     * @param layerFailure What the HTTP layer does, given the request and a way to abort the call.
     */
    const failAsAborted = async (
      where: string,
      layerFailure: (sent: RecordedDecisionFetch, abort: () => void) => SystemOneFetchResponse,
    ): Promise<void> => {
      const controller = new AbortController();
      const layerRaised: unknown[] = [];
      const { transport } = harnessOver((sent) => {
        try {
          const response = layerFailure(sent, () => controller.abort());
          return {
            ...response,
            text: () =>
              response.text().catch((error: unknown) => {
                layerRaised.push(error);
                throw error;
              }),
          };
        } catch (error) {
          layerRaised.push(error);
          throw error;
        }
      });
      abortedCalls.push({ raised: await rejectionOf(call(transport, controller.signal)), signal: controller.signal, where });
      // Anti-vacuity: the HTTP layer really did raise something holding the key.
      expect(layerRaised, where).toHaveLength(1);
      expect(showsText(layerRaised[0], SENTINEL_KEY), `${where}: the layer's failure did not hold the key`).toBe(true);
      expect(controller.signal.aborted, where).toBe(true);
    };

    process.env[KEY_ENV] = SENTINEL_KEY;
    await failAsAborted("a failure quoting the headers", (sent, abort) => {
      abort();
      throw new TypeError(`request failed; headers were ${JSON.stringify(sent.headers)}`);
    });
    await failAsAborted("a failure with the form of an abort, quoting the header", (sent, abort) => {
      abort();
      throw new DOMException(`aborted while sending ${sent.headers.authorization}`, "AbortError");
    });
    await failAsAborted("a failure with the form of a timeout, holding the header as its cause", (sent, abort) => {
      abort();
      throw Object.assign(new DOMException("The operation timed out", "TimeoutError"), {
        cause: new Error(sent.headers.authorization),
      });
    });
    await failAsAborted("an answer's body cut short, quoting the header", (sent, abort) => {
      abort();
      return unreadableDecisionResponse(OK, new Error(`reset while sending ${sent.headers.authorization}`));
    });

    // An abort as the platform's call reports one: it rejects with the reason
    // itself, so the reason is the one value of another layer's that does come
    // back, and it comes back as the caller made it.
    const reported = new AbortController();
    const asPlatform = harnessOver(() => {
      reported.abort();
      return Promise.reject<SystemOneFetchResponse>(reasonOf(reported.signal));
    });
    abortedCalls.push({
      raised: await rejectionOf(call(asPlatform.transport, reported.signal)),
      signal: reported.signal,
      where: "an abort reported with the reason itself, over the double",
    });
    expect(asPlatform.double.calls.map((sent) => sent.headers.authorization)).toEqual([`${BEARER}${SENTINEL_KEY}`]);
    const abortedBeforeSending = AbortSignal.abort();
    abortedCalls.push({
      raised: await rejectionOf(call(createSystemOneTransport(), abortedBeforeSending)),
      signal: abortedBeforeSending,
      where: "an aborted call over the platform's own call",
    });

    // The key the runtime cannot send, on a call the caller has already
    // aborted. It is refused before a request exists, so the runtime, which
    // would refuse the request before it looked at the signal, is never asked.
    process.env[KEY_ENV] = unsendable;
    const preAborted = AbortSignal.abort();
    const overDouble = harnessOver(() => documentedSuccess());
    raised.push(await rejectionOf(call(overDouble.transport, preAborted)));
    expect(overDouble.double.calls).toHaveLength(0);
    raised.push(await rejectionOf(call(createSystemOneTransport(), preAborted)));
    for (const refusal of raised.slice(-3)) {
      expect(asInstance(refusal, DecisionCredentialError).source).toBe("key_unusable");
    }

    for (const { raised: abortRaised, signal, where } of abortedCalls) {
      expect(showsText(abortRaised, SENTINEL_KEY), `${where}: the raised value carried the key`).toBe(false);
      expect(abortRaised, where).toBe(reasonOf(signal));
    }

    for (const error of raised) {
      const typed = asCallError(error);
      const completed = typed.withAttempt({
        route: ROUTE.route,
        provider: PROVIDER,
        modelPin: MODEL_PIN,
        status: null,
        queueMs: 0,
        durationMs: VENDOR_LATENCY_MS,
        budgetMs: ROUTE.budgetMs,
        retryAfterMs: null,
        vendorRequestId: null,
        servedModel: null,
        usage: null,
        correlationId: null,
      });
      for (const text of everyTextOf(completed)) {
        expect(text, `${typed.name} carried the key`).not.toContain(SENTINEL_KEY);
      }
    }
  });

  it("a vendor or a lower layer that hands the key back does not put it in an error", async () => {
    const authorization = `${BEARER}${SENTINEL_KEY}`;
    const echo = JSON.stringify({
      detail: { error_type: "authentication_error", message: `Invalid credential: ${authorization}. ${SENTINEL_KEY}` },
    });
    const echoWithoutKey = echo.split(SENTINEL_KEY).join(KEY_REMOVED);
    expect(echoWithoutKey).not.toBe(echo);

    // Every kind of failing status, with the key quoted twice in the body and
    // once in the vendor's request id.
    for (const status of [401, 403, 404, 422, 429, 500, 529]) {
      const where = `status ${status}`;
      const { transport, double } = harnessOver(() =>
        decisionResponse(status, echo, { [VENDOR_REQUEST_ID_HEADER]: `req-${SENTINEL_KEY}` }),
      );
      const error = asCallError(await rejectionOf(call(transport)));
      expect(double.calls.map((sent) => sent.headers.authorization), where).toEqual([authorization]);
      expect(showsText(error, SENTINEL_KEY), `${where}: ${error.name} carried the key`).toBe(false);
      // Everything else the vendor said is kept, and still read.
      expect(error, where).toMatchObject({
        status,
        bodyExcerpt: echoWithoutKey,
        vendorErrorType: "authentication_error",
        vendorRequestId: `req-${KEY_REMOVED}`,
      });
    }

    // A key that begins inside the excerpt and ends past it is taken out whole,
    // not cut to a prefix by the excerpt's bound.
    const straddling = `${"x".repeat(DECISION_ERROR_BODY_EXCERPT - KEY_CHARS_INSIDE_THE_BOUND)}${SENTINEL_KEY} and more`;
    const cut = harnessOver(() => decisionResponse(401, straddling));
    const cutError = asInstance(await rejectionOf(call(cut.transport)), DecisionCredentialError);
    expect(cutError.bodyExcerpt).toHaveLength(DECISION_ERROR_BODY_EXCERPT);
    expect(showsText(cutError, SENTINEL_KEY.slice(0, KEY_CHARS_INSIDE_THE_BOUND))).toBe(false);

    // An answer whose request id quotes the key: on the fault raised for an
    // unusable answer, and on the answer handed back.
    const unusable = harnessOver(() => decisionResponse(OK, "not json", { [VENDOR_REQUEST_ID_HEADER]: authorization }));
    const formatError = asInstance(await rejectionOf(call(unusable.transport)), DecisionResponseFormatError);
    expect(formatError.vendorRequestId).toBe(`${BEARER}${KEY_REMOVED}`);
    expect(showsText(formatError, SENTINEL_KEY)).toBe(false);
    const answered = harnessOver(() => documentedSuccess({ [VENDOR_REQUEST_ID_HEADER]: authorization }));
    expect((await call(answered.transport)).vendorRequestId).toBe(`${BEARER}${KEY_REMOVED}`);

    // A key a JSON body has to escape is quoted there in its escaped form, and
    // is taken out in that form too.
    process.env[KEY_ENV] = ESCAPED_KEY;
    const escapedEcho = JSON.stringify({ detail: `no such key: ${ESCAPED_KEY}` });
    expect(escapedEcho.includes(ESCAPED_KEY), "the body holds the key verbatim, so this case proves nothing").toBe(false);
    const escaped = harnessOver(() => decisionResponse(401, escapedEcho));
    const escapedError = asInstance(await rejectionOf(call(escaped.transport)), DecisionCredentialError);
    expect(escaped.double.calls.map((sent) => sent.headers.authorization === `${BEARER}${ESCAPED_KEY}`)).toEqual([true]);
    expect(isExactly(escapedError.bodyExcerpt, JSON.stringify({ detail: `no such key: ${KEY_REMOVED}` }))).toBe(true);
    expect(showsText(escapedError, JSON.stringify(ESCAPED_KEY).slice(1, -1))).toBe(false);

    // A lower layer that names its failure, or codes it, with the key itself.
    process.env[KEY_ENV] = IDENTIFIER_KEY;
    for (const field of ["name", "code"]) {
      const named = harnessOver((sent) => {
        throw Object.assign(new Error("request failed"), { [field]: sent.headers.authorization.slice(BEARER.length) });
      });
      const networkError = asInstance(await rejectionOf(call(named.transport)), DecisionTransportError);
      expect(named.double.calls.map((sent) => sent.headers.authorization), field).toEqual([`${BEARER}${IDENTIFIER_KEY}`]);
      expect(showsText(networkError, IDENTIFIER_KEY), `the failure's ${field} carried the key`).toBe(false);
      expect(networkError.message, field).toContain(KEY_REMOVED);
    }
  });

  it("uses the platform's own HTTP call when none is injected, resolved when the call is made", async () => {
    // The compiler is the oracle for the first half: the platform's function
    // must satisfy the narrow shape the transport declares.
    const platformCall: SystemOneFetch = fetch;
    expect(typeof platformCall).toBe("function");

    const transport = createSystemOneTransport();
    const double = createDecisionFetchDouble(() => documentedSuccess());
    vi.stubGlobal("fetch", double.fetchImpl);

    const result = await call(transport);

    expect(double.calls).toHaveLength(1);
    expect(result.servedModel).toBe("jev-1.13.0");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("the decision sources", () => {
  const decisionDir = fileURLToPath(new URL("../../../llm/decision/", import.meta.url));

  it("hold one HTTP call site, and the transport names no vendor host and no model", () => {
    const callSites = sourcesUnder(decisionDir).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.includes("fetch("))
        .map((line) => `${path}: ${line.trim()}`),
    );
    expect(callSites).toHaveLength(1);
    expect(callSites[0]).toContain("transports/systemone.ts");

    const transportSource = readFileSync(join(decisionDir, "transports", "systemone.ts"), "utf8");
    expect(transportSource).not.toMatch(/https?:\/\//);
    expect(transportSource).not.toMatch(/\bjev\b|jev-|typesafe\.ai/i);
  });
});
