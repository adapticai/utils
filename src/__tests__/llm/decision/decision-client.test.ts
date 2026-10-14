/**
 * The decision client.
 *
 * The client is the only exported way to ask a typed decision model, so these
 * tests pin what a caller relies on it for: that a route nobody has opened is
 * refused before anything is touched, that a call is one attempt and never
 * more, that an answer from any model but the pinned one is refused before its
 * body is read, that a call cannot outlive its budget in this package's own
 * queue or at the vendor, that the breaker measures the vendor and nothing
 * else and shares nothing with the generative client's, and that every way a
 * call can fail reaches the caller as a rejection of a known class with the
 * record of the attempt attached.
 *
 * No request leaves the process. Most tests run the real hosted transport over
 * a scripted HTTP call, so what is asserted about a request is what would have
 * gone on the wire; the tests about waiting run a scripted transport and a
 * faked clock, so nothing here sleeps on real time.
 */

import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { llmBreakers } from "../../../llm/alias-client";
import * as codec from "../../../llm/decision/codec";
import { decodeDecisionResponse } from "../../../llm/decision/codec";
import {
  callDecisionModel,
  configureDecisionClient,
  decisionBreakerKey,
  decisionBreakers,
} from "../../../llm/decision/decision-client";
import { resolveDecisionRoute } from "../../../llm/decision/decision-route-table";
import {
  DECISION_ERROR_BODY_EXCERPT,
  DECISION_FAULTS,
  DecisionAdmissionError,
  DecisionCallError,
  DecisionClientFaultError,
  DecisionCredentialError,
  DecisionRequestInvalidError,
  DecisionResponseFormatError,
  DecisionRouteMismatchError,
  DecisionRouteUnavailableError,
  DecisionTimeoutError,
  DecisionTransportError,
  decisionErrorExcerpt,
} from "../../../llm/decision/errors";
import type { ResolvedDecisionRoute } from "../../../llm/decision/route-types";
import { VENDOR_REQUEST_ID_HEADER, createSystemOneTransport } from "../../../llm/decision/transports/systemone";
import type { SystemOneFetchResponse } from "../../../llm/decision/transports/systemone";
import type {
  DecisionCallOptions,
  DecisionCallResult,
  DecisionQuestion,
  DecisionRequest,
  DecisionState,
} from "../../../llm/decision/types";
import * as rateGuard from "../../../llm/rate-guard";
import { RateGuardTimeoutError, guardSnapshots, resetProviderGuards, withProviderGuards } from "../../../llm/rate-guard";
import { routeTable } from "../../../llm/route-table";
import { createDecisionFetchDouble, decisionResponse, decisionResponseFromFixture } from "./support/fetch-double";
import type { DecisionFetchDouble, DecisionFetchScript, RecordedDecisionFetch } from "./support/fetch-double";
import { loadDecisionFixture } from "./support/fixtures";
import type { DecisionEvidenceClass } from "./support/fixtures";
import {
  HOSTED_ROUTE,
  LOCAL_ROUTE,
  admittedDecisionRouteTable,
  hostedProviderOf,
  hostedRouteOf,
} from "./support/routes";
import { createDecisionTransportDouble, heldUntilAborted, scriptedAnswer } from "./support/transport-double";
import type { DecisionDispatchScript, DecisionTransportDouble } from "./support/transport-double";

/**
 * A recognisable stand-in for the key, searched for in everything raised.
 *
 * Assembled at runtime so that no credential-shaped literal sits in the tree
 * for a secret scan to trip over.
 */
const SENTINEL_KEY = ["dk", "test", "7a1c9e4f0b3d2685", "do-not-leak"].join("-");

/** A key a JSON string has to escape: it holds a quote and a backslash. */
const ESCAPED_KEY = ["dk", "test", '5e"2b\\9d', "do-not-leak"].join("-");

/** What the client leaves where it took the key out of text it did not write. */
const KEY_REMOVED = "[credential removed]";

/** How much of a key lies inside the excerpt's bound when the rest lies past it. */
const KEY_CHARS_INSIDE_THE_BOUND = 12;

/** A vendor request id, in the form the observed response header carries one. */
const REQUEST_ID = "req_0123456789abcdef0123456789abcdef";

/** A caller's own id for a call. */
const CORRELATION_ID = "decision-test-correlation-1";

/** The status the tests replay a documented success under; the reference quotes none. */
const OK = 200;

/** Token counts and cost of the documented example at the route's declared price. */
const DOCUMENTED_INPUT_TOKENS = 318;
const DOCUMENTED_OUTPUT_TOKENS = 34;
const DOCUMENTED_COST = 0.000013356;
const COST_DIGITS = 12;

/** How long the scripted vendor takes to answer, on the injected clock. */
const VENDOR_LATENCY_MS = 137;

/** The instant the injected clock starts at. */
const NOW_MS = Date.UTC(2026, 9, 1, 12, 0, 0);

/** Models a vendor could report answering with that are not the route's pin. */
const SUBSTITUTED_MODELS: readonly string[] = ["english", "typesafe/jev-1.13-20260917", "jev-1.14.0"];

/** An id a vendor could report for a pinned model that is not the pin itself: the pin with its build date. */
const DATED_SERVED_MODEL = "jev-1.13.0-20260917";

/** How many consecutive faults that say nothing about the vendor's health are replayed. */
const HEALTH_NEUTRAL_FAULTS = 10;

/** Caller deadlines against the route's budget: one inside it, one far past it. */
const NARROWING_TIMEOUT_MS = 300;
const WIDENING_TIMEOUT_MS = 5_000;

/** A caller deadline shorter than the wait for the next rate token. */
const SHORTER_THAN_A_REFILL_MS = 50;

/** A caller deadline that outlasts two rate refills and not the third. */
const QUEUED_BUDGET_MS = 200;

/** How many callers are queued ahead, so that no token frees inside {@link QUEUED_BUDGET_MS}. */
const WAITERS_AHEAD = 2;

/** How many microtask turns after a call starts the abort sweep reaches. */
const ABORT_SWEEP_TURNS = 12;

/** How deep a raised error is printed when it is searched for the key. */
const INSPECT_DEPTH = 8;

/** Length of a vendor request id far past the excerpt bound. */
const LONG_ID_CHARS = 5_000;

/** How deep a state is nested to be deeper than a serialiser's call stack can follow. */
const NESTING_PAST_THE_CALL_STACK = 200_000;

/** A breaker cooldown shorter than the route's budget, so a call can outlast it. */
const SHORT_COOLDOWN_MS = 1_000;

/** The share of prior concurrency a half-open breaker may probe with, in the table that sets one. */
const PROBE_FRACTION = 0.5;

/** A marker for a promise that has not settled. */
const PENDING = Symbol("pending");

/** How long the hosted provider's bucket takes to accrue one token, at its configured rate. */
const RATE_REFILL_INTERVAL_MS = 100;

/** How many refills an emptied bucket is left to accrue before it is counted. */
const REFILLS_COUNTED = 2;

/**
 * Text standing for what a failure's own message could quote: the request it
 * failed on. Searched for in everything raised, like the key.
 */
const QUOTED_REQUEST_TEXT = "REQUEST-TEXT-IN-A-FAILURE-MESSAGE";

/** What a call is recorded under when the value given as its route is not text. */
const UNNAMED_ROUTE = "(not a route name)";

/**
 * A fixture's body, loaded under the evidence classes the caller relies on.
 *
 * @param name The fixture's file name.
 * @param allow The evidence classes the test is prepared to rest on.
 * @returns The body, as an object.
 */
function fixtureBody(name: string, allow: readonly DecisionEvidenceClass[]): Record<string, unknown> {
  const { envelope } = loadDecisionFixture(name, { allow });
  if (typeof envelope.body !== "object" || envelope.body === null || Array.isArray(envelope.body)) {
    throw new Error(`fixture ${name} has no object body`);
  }
  return structuredClone(envelope.body) as Record<string, unknown>;
}

/**
 * The caller's request a request fixture describes: its state and questions.
 *
 * @param name The fixture's file name.
 * @param allow The evidence classes the test is prepared to rest on.
 * @returns The request, without the wire's model field, which a caller never supplies.
 */
function requestFrom(name: string, allow: readonly DecisionEvidenceClass[]): DecisionRequest {
  const body = fixtureBody(name, allow);
  return {
    state: body.state as DecisionState,
    questions: body.questions as Record<string, DecisionQuestion>,
  };
}

/** The documented request and the documented answer to it. */
const CHOICE_REQUEST = (): DecisionRequest => requestFrom("request.choice.documented.json", ["documented-verbatim"]);
const CHOICE_ANSWER = (): Record<string, unknown> =>
  fixtureBody("response.choice.documented.json", ["documented-verbatim"]);

/**
 * The documented answer, reported as coming from another model.
 *
 * @param model The model the body says answered.
 * @returns The body.
 */
function answerFrom(model: string): Record<string, unknown> {
  return { ...CHOICE_ANSWER(), model };
}

/**
 * A successful response carrying a body.
 *
 * @param body The response body.
 * @param headers The response headers.
 * @returns The response.
 */
function answering(body: unknown, headers: Readonly<Record<string, string>> = {}): SystemOneFetchResponse {
  return decisionResponse(OK, JSON.stringify(body), headers);
}

/**
 * The response an error fixture describes.
 *
 * @param name The fixture's file name.
 * @param allow The evidence classes the test is prepared to rest on.
 * @returns The response.
 */
function failingWith(name: string, allow: readonly DecisionEvidenceClass[]): SystemOneFetchResponse {
  return decisionResponseFromFixture(loadDecisionFixture(name, { allow }).envelope, OK);
}

/**
 * The fault the hosted transport raises when the vendor itself fails.
 *
 * @returns The fault, as the transport would raise it for a 500.
 */
function serverFailure(): DecisionTransportError {
  return new DecisionTransportError({
    source: "status",
    route: HOSTED_ROUTE,
    status: 500,
    retryable: true,
    retryAfterMs: null,
    body: "",
    vendorErrorType: null,
    vendorRequestId: null,
  });
}

/**
 * An HTTP call that never answers and ends only when its signal aborts, as the
 * platform's own does.
 *
 * @param call The recorded request.
 * @returns A promise that rejects with the signal's reason and never resolves.
 */
function hangingFetch(call: RecordedDecisionFetch): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    call.signal.addEventListener(
      "abort",
      () => {
        const reason: unknown = call.signal.reason;
        reject(reason);
      },
      { once: true },
    );
  });
}

/** The client wired over the real transport and a scripted HTTP call. */
interface FetchHarness {
  readonly double: DecisionFetchDouble;
  readonly route: ResolvedDecisionRoute;
  /** Move the injected clock forward. */
  readonly advance: (ms: number) => void;
}

/**
 * Wire the client to the real hosted transport over a scripted HTTP call, on
 * a table whose hosted route is admitted, with an injected clock.
 *
 * @param script What the scripted HTTP call does with each request.
 * @returns The recorded requests, the resolved route and the clock's control.
 */
function clientOverFetch(script: DecisionFetchScript): FetchHarness {
  let nowMs = NOW_MS;
  const now = (): number => nowMs;
  const table = admittedDecisionRouteTable();
  const double = createDecisionFetchDouble(script);
  configureDecisionClient({
    routeTable: table,
    transport: createSystemOneTransport({ fetchImpl: double.fetchImpl, now }),
    now,
  });
  return {
    double,
    route: resolveDecisionRoute(HOSTED_ROUTE, table),
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

/** The client wired over a scripted transport. */
interface TransportHarness {
  readonly double: DecisionTransportDouble;
  readonly route: ResolvedDecisionRoute;
}

/**
 * Wire the client to a scripted transport on a table whose hosted route is
 * admitted. The clock is the process's own, which a test may fake.
 *
 * @param script What the scripted transport does with each invocation.
 * @returns The recorded invocations and the resolved route.
 */
function clientOverTransport(script: DecisionDispatchScript): TransportHarness {
  const table = admittedDecisionRouteTable();
  const double = createDecisionTransportDouble(script);
  configureDecisionClient({ routeTable: table, transport: double.transport });
  return { double, route: resolveDecisionRoute(HOSTED_ROUTE, table) };
}

/**
 * Ask the documented question on the hosted route.
 *
 * @param options The call's options.
 * @returns The client's promise.
 */
function ask(options?: DecisionCallOptions): Promise<DecisionCallResult> {
  return callDecisionModel(HOSTED_ROUTE, CHOICE_REQUEST(), options);
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
 * Watch a promise without waiting on it.
 *
 * @param promise The promise.
 * @returns A reader of its outcome: {@link PENDING} until it settles, then the
 *   value or the rejection.
 */
function watch(promise: Promise<unknown>): () => unknown {
  let outcome: unknown = PENDING;
  promise.then(
    (value) => {
      outcome = value;
    },
    (error: unknown) => {
      outcome = error;
    },
  );
  return () => outcome;
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
 * @returns Its string form, a deep print of it, its JSON form, its message and
 *   stack, and a deep print of every own property.
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
 * Whether anything a reader of a raised value could see holds a piece of text.
 *
 * Asked as a boolean, so that an assertion which fails prints no text: the one
 * a regression would produce here is the one that holds the key.
 *
 * @param raised The raised value.
 * @param needle The text looked for.
 * @returns True when some rendering of the value holds it.
 */
function showsText(raised: unknown, needle: string): boolean {
  return everyTextOf(raised).some((text) => text.includes(needle));
}

/**
 * Let every promise that is ready run, without moving a faked clock.
 *
 * @returns When the ready work has run.
 */
async function settleReadyWork(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/**
 * The hosted provider's guard, as the rate guard reports it.
 *
 * @param provider The provider's name.
 * @returns Its snapshot, or `undefined` when no call has reached the guard.
 */
function guardOf(provider: string): ReturnType<typeof guardSnapshots>[number] | undefined {
  return guardSnapshots().find((snapshot) => snapshot.provider === provider);
}

/**
 * Spend every token the provider's rate bucket holds, in one instant.
 *
 * @param provider The provider's name.
 * @returns When the bucket is empty.
 */
async function drainRateBucket(provider: string): Promise<void> {
  do {
    await withProviderGuards(provider, () => Promise.resolve());
  } while ((guardOf(provider)?.availableTokens ?? 0) >= 1);
}

describe("the decision client", () => {
  /** The canonical table's hosted provider: its name and the variables it reads. */
  const provider = hostedRouteOf(admittedDecisionRouteTable()).provider;
  const { api_key_env: keyEnv, base_url_env: baseUrlEnv } = hostedProviderOf(admittedDecisionRouteTable());
  const breakerKey = decisionBreakerKey(HOSTED_ROUTE);

  beforeEach(() => {
    vi.stubEnv(keyEnv, SENTINEL_KEY);
    if (baseUrlEnv !== null) {
      vi.stubEnv(baseUrlEnv, undefined);
    }
    resetProviderGuards();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetProviderGuards();
    configureDecisionClient();
  });

  describe("an answer", () => {
    it("answers through one leg and returns answers, sums, served model, usage, request id and the attempt", async () => {
      const harness = clientOverFetch(() => {
        harness.advance(VENDOR_LATENCY_MS);
        return answering(CHOICE_ANSWER(), { [VENDOR_REQUEST_ID_HEADER]: REQUEST_ID });
      });

      const result = await ask({ correlationId: CORRELATION_ID });

      expect(harness.double.calls).toHaveLength(1);
      expect(JSON.parse(harness.double.calls[0].body)).toEqual({
        ...CHOICE_REQUEST(),
        model: harness.route.modelPin,
      });
      expect(Object.keys(JSON.parse(harness.double.calls[0].body) as object)).toEqual(["state", "model", "questions"]);

      expect(result.route).toBe(HOSTED_ROUTE);
      expect(result.answers).toEqual({
        department: {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.88, technical: 0.12, sales: 0 },
          confidence: 0.81,
        },
      });
      expect(result.probabilitySums.department).toBeCloseTo(1, COST_DIGITS);
      expect(result.servedModel).toBe(harness.route.expectedServedModel);
      expect(result.usage.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
      expect(result.usage.completion_tokens).toBe(DOCUMENTED_OUTPUT_TOKENS);
      expect(result.usage.provider).toBe(provider);
      expect(result.usage.model).toBe(harness.route.modelPin);
      expect(result.usage.cost).toBeCloseTo(DOCUMENTED_COST, COST_DIGITS);
      expect(result.vendorRequestId).toBe(REQUEST_ID);

      expect(result.attempt).toEqual({
        route: HOSTED_ROUTE,
        provider,
        modelPin: harness.route.modelPin,
        status: OK,
        queueMs: 0,
        durationMs: VENDOR_LATENCY_MS,
        budgetMs: harness.route.budgetMs,
        retryAfterMs: null,
        vendorRequestId: REQUEST_ID,
        servedModel: harness.route.expectedServedModel,
        usage: result.usage,
        correlationId: CORRELATION_ID,
        outcome: "ok",
        fault: null,
      });
    });

    it("dispatches through the hosted transport when none is injected", async () => {
      const table = admittedDecisionRouteTable();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify(CHOICE_ANSWER()), { status: OK, headers: { [VENDOR_REQUEST_ID_HEADER]: REQUEST_ID } }),
          ),
        );
      configureDecisionClient({ routeTable: table });

      const result = await ask();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${hostedProviderOf(table).base_url}/v1/systemone`);
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      const sentHeaders = new Headers(init?.headers);
      expect(sentHeaders.get("authorization") === `Bearer ${SENTINEL_KEY}`).toBe(true);
      expect(JSON.parse(String(init?.body))).toEqual({
        ...CHOICE_REQUEST(),
        model: hostedRouteOf(table).version_pin,
      });
      expect(result.answers.department.type).toBe("choice");
      expect(result.vendorRequestId).toBe(REQUEST_ID);
    });

    it("answers a yes/no, a choice and a score in one request, in the order they were asked", async () => {
      const noul = requestFrom("request.noul.constructed.json", ["constructed-from-documented-fields"]);
      const score = requestFrom("request.score.constructed.json", ["constructed-from-documented-fields"]);
      const request: DecisionRequest = {
        state: CHOICE_REQUEST().state,
        questions: { ...noul.questions, ...CHOICE_REQUEST().questions, ...score.questions },
      };
      const answerBodies = [
        fixtureBody("response.score.constructed.json", ["constructed-from-documented-fields"]),
        CHOICE_ANSWER(),
        fixtureBody("response.noul.constructed.json", ["constructed-from-documented-fields"]),
      ];
      const harness = clientOverFetch(() =>
        answering({
          ...CHOICE_ANSWER(),
          answers: Object.assign({}, ...answerBodies.map((body) => body.answers as object)) as unknown,
        }),
      );

      const result = await callDecisionModel(HOSTED_ROUTE, request);

      expect(harness.double.calls).toHaveLength(1);
      expect(Object.keys(result.answers)).toEqual(["payment_failure", "department", "urgency"]);
      expect(result.answers.payment_failure).toEqual({ type: "noul", noul: 0.95 });
      expect("confidence" in result.answers.payment_failure).toBe(false);
      expect(result.probabilitySums.payment_failure).toBeNull();
      expect(result.probabilitySums.urgency).toBe(1);
      expect(result.answers.urgency.type).toBe("score");
    });

    it("reports a distribution's sum raw and enforces it only at the caller's tolerance", async () => {
      const short = {
        ...CHOICE_ANSWER(),
        answers: {
          department: {
            type: "choice",
            choice: "billing",
            probabilities: { billing: 0.85, technical: 0.12, sales: 0 },
            confidence: 0.81,
          },
        },
      };
      const harness = clientOverFetch(() => answering(short));

      const reported = await ask();
      expect(reported.probabilitySums.department).toBeCloseTo(0.97, COST_DIGITS);

      const error = asInstance(await rejectionOf(ask({ probabilitySumTolerance: 0.001 })), DecisionResponseFormatError);
      expect(error.fault).toBe("schema");
      expect(error.fieldPath).toBe("answers.department.probabilities");
      expect(error.route).toBe(HOSTED_ROUTE);
      expect(error.status).toBe(OK);
      expect(error.usage?.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
      expect(error.attempt?.servedModel).toBe(harness.route.expectedServedModel);
      expect(harness.double.calls).toHaveLength(2);
    });

    it("carries the vendor's request id on an answered attempt as a bounded, printable excerpt", async () => {
      const rawId = `re\u0007q_${"f".repeat(LONG_ID_CHARS)}`;
      const harness = clientOverTransport((call) =>
        scriptedAnswer(call.route, CHOICE_ANSWER(), { vendorRequestId: rawId }),
      );

      const result = await ask();

      expect(harness.double.calls).toHaveLength(1);
      expect(result.vendorRequestId).toBe(decisionErrorExcerpt(rawId));
      expect(result.vendorRequestId).toHaveLength(DECISION_ERROR_BODY_EXCERPT);
      expect(result.vendorRequestId).not.toContain("\u0007");
      expect(result.attempt.vendorRequestId).toBe(result.vendorRequestId);
    });
  });

  describe("one attempt", () => {
    it("one attempt: a 529 is surfaced, not retried", async () => {
      const harness = clientOverFetch(() => failingWith("error.529.unobserved.json", ["synthetic-unobserved"]));

      const error = asInstance(await rejectionOf(ask({ correlationId: CORRELATION_ID })), DecisionTransportError);

      expect(harness.double.calls).toHaveLength(1);
      expect(error.fault).toBe("transport");
      expect(error.status).toBe(529);
      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBe(1_500);
      expect(error.attempt).toMatchObject({
        outcome: "fault",
        fault: "transport",
        route: HOSTED_ROUTE,
        provider,
        modelPin: harness.route.modelPin,
        status: 529,
        retryAfterMs: 1_500,
        budgetMs: harness.route.budgetMs,
        queueMs: 0,
        durationMs: 0,
        servedModel: null,
        usage: null,
        correlationId: CORRELATION_ID,
      });
    });
  });

  describe("the answering model", () => {
    it("an answering model other than the pin is a route mismatch, decided before the body is trusted", async () => {
      for (const served of SUBSTITUTED_MODELS) {
        const harness = clientOverFetch(() => answering(answerFrom(served), { [VENDOR_REQUEST_ID_HEADER]: REQUEST_ID }));

        const error = asInstance(await rejectionOf(ask()), DecisionRouteMismatchError);

        expect(error.fault).toBe("route_mismatch");
        expect(error.expectedServedModel).toBe(harness.route.expectedServedModel);
        expect(error.servedModel).toBe(served);
        expect(error.status).toBe(OK);
        expect(error.vendorRequestId).toBe(REQUEST_ID);
        expect(error.usage?.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
        expect(error.usage?.completion_tokens).toBe(DOCUMENTED_OUTPUT_TOKENS);
        expect(error.usage?.cost).toBeCloseTo(DOCUMENTED_COST, COST_DIGITS);
        expect(error.attempt?.servedModel).toBe(served);
        expect(error.attempt?.fault).toBe("route_mismatch");
        expect(harness.double.calls).toHaveLength(1);
      }
    });

    it("refuses a mismatching answer as a mismatch even when its answers are malformed", async () => {
      clientOverFetch(() => answering({ ...answerFrom(SUBSTITUTED_MODELS[2]), answers: "not an answer map" }));

      const error = asCallError(await rejectionOf(ask()));

      expect(error).toBeInstanceOf(DecisionRouteMismatchError);
      expect(error.fault).toBe("route_mismatch");
    });

    it("compares the whole id: a pin with anything after it, or in another case, is another model", async () => {
      const pin = resolveDecisionRoute(HOSTED_ROUTE, admittedDecisionRouteTable()).expectedServedModel;
      const beyondTheExcerpt = `${pin}${"-".repeat(DECISION_ERROR_BODY_EXCERPT)}x`;
      for (const served of [`${pin}\n`, `${pin} `, pin.toUpperCase(), beyondTheExcerpt]) {
        clientOverFetch(() => answering(answerFrom(served)));
        expect(asCallError(await rejectionOf(ask())).fault).toBe("route_mismatch");
      }
    });

    it("asks for the pin and accepts only the id the route expects served, where the two differ", async () => {
      const table = admittedDecisionRouteTable();
      const pin = hostedRouteOf(table).version_pin;
      hostedRouteOf(table).expected_served_model = DATED_SERVED_MODEL;
      expect(DATED_SERVED_MODEL).not.toBe(pin);
      const served: string[] = [];
      const double = createDecisionFetchDouble(() => answering(answerFrom(served[served.length - 1])));
      configureDecisionClient({ routeTable: table, transport: createSystemOneTransport({ fetchImpl: double.fetchImpl }) });

      served.push(DATED_SERVED_MODEL);
      const result = await ask();
      expect((JSON.parse(double.calls[0].body) as { model: unknown }).model).toBe(pin);
      expect(result.servedModel).toBe(DATED_SERVED_MODEL);
      expect(result.attempt).toMatchObject({ modelPin: pin, servedModel: DATED_SERVED_MODEL });

      served.push(pin);
      const mismatch = asInstance(await rejectionOf(ask()), DecisionRouteMismatchError);
      expect(mismatch.expectedServedModel).toBe(DATED_SERVED_MODEL);
      expect(mismatch.servedModel).toBe(pin);
      expect(mismatch.attempt?.modelPin).toBe(pin);
      expect(double.calls).toHaveLength(2);
    });

    it("leaves an answer from the pin exactly as the decode alone gives it", async () => {
      clientOverFetch(() => answering(CHOICE_ANSWER()));

      const result = await ask();

      const decoded = decodeDecisionResponse(CHOICE_ANSWER(), CHOICE_REQUEST());
      expect(result.answers).toEqual(decoded.answers);
      expect(result.probabilitySums).toEqual(decoded.probabilitySums);
      expect(result.servedModel).toBe(decoded.model);
      expect(JSON.stringify(result.answers)).toBe(JSON.stringify(decoded.answers));
    });
  });

  describe("the breaker", () => {
    it("the decision breaker is its own namespace", async () => {
      const generativeBefore = llmBreakers().snapshotAll();
      const threshold = admittedDecisionRouteTable().defaults.circuit_breaker.failure_threshold;
      const harness = clientOverFetch(() => failingWith("error.500.unobserved.json", ["synthetic-unobserved"]));

      for (let failure = 0; failure < threshold; failure += 1) {
        expect(asCallError(await rejectionOf(ask())).fault).toBe("transport");
      }
      expect(harness.double.calls).toHaveLength(threshold);
      expect(decisionBreakers().stateOf(breakerKey)).toBe("open");
      expect(breakerKey).toBe("decision:dm.hosted");

      const refused = asInstance(await rejectionOf(ask()), DecisionRouteUnavailableError);
      expect(refused.fault).toBe("unavailable");
      expect(refused.code).toBe("breaker_open");
      expect(refused.reason).toContain(`opened after ${threshold} consecutive failure(s)`);
      expect(refused.attempt).toMatchObject({ provider, queueMs: null, durationMs: null, status: null });
      expect(harness.double.calls).toHaveLength(threshold);

      expect(decisionBreakers()).not.toBe(llmBreakers());
      expect(llmBreakers().snapshotAll()).toEqual(generativeBefore);
      expect(llmBreakers().snapshotAll().some(({ routeKey }) => routeKey.startsWith("decision:"))).toBe(false);
      expect(decisionBreakers().snapshotAll().map(({ routeKey }) => routeKey)).toEqual([breakerKey]);
    });

    it("leaves the decision route allowed when a generative route opens", () => {
      clientOverFetch(() => answering(CHOICE_ANSWER()));
      const generativeKey = "llm.test.generative-route";
      try {
        for (let failure = 0; failure < routeTable.defaults.circuit_breaker.failure_threshold; failure += 1) {
          llmBreakers().onFailure(generativeKey);
        }
        expect(llmBreakers().stateOf(generativeKey)).toBe("open");
        expect(decisionBreakers().allows(breakerKey)).toBe(true);
        expect(decisionBreakers().snapshotAll()).toEqual([]);
      } finally {
        llmBreakers().reset();
      }
    });

    it("credential, schema and mismatch faults do not open the breaker", async () => {
      const neutral: readonly (() => SystemOneFetchResponse)[] = [
        () => failingWith("error.403-missing-key.observed.json", ["observed-unauthenticated"]),
        () => failingWith("error.422.unobserved.json", ["synthetic-unobserved"]),
        () => answering(answerFrom(SUBSTITUTED_MODELS[0])),
        () => answering({ ...CHOICE_ANSWER(), answers: {} }),
      ];
      const expectedFaults = ["credential", "schema", "route_mismatch", "schema"];
      const harness = clientOverFetch((_call, index) =>
        index < HEALTH_NEUTRAL_FAULTS ? neutral[index % neutral.length]() : answering(CHOICE_ANSWER()),
      );

      for (let index = 0; index < HEALTH_NEUTRAL_FAULTS; index += 1) {
        const error = asCallError(await rejectionOf(ask()));
        expect(error.fault).toBe(expectedFaults[index % expectedFaults.length]);
        expect(decisionBreakers().snapshot(breakerKey).consecutiveFailures).toBe(0);
      }

      const result = await ask();
      expect(result.answers.department.type).toBe("choice");
      expect(harness.double.calls).toHaveLength(HEALTH_NEUTRAL_FAULTS + 1);
      expect(decisionBreakers().stateOf(breakerKey)).toBe("closed");
    });

    it("counts a vendor that is full as capacity and a vendor that failed or cannot be reached as hard", async () => {
      const responses: readonly (() => SystemOneFetchResponse)[] = [
        () => failingWith("error.529.unobserved.json", ["synthetic-unobserved"]),
        () => failingWith("error.429.unobserved.json", ["synthetic-unobserved"]),
      ];
      clientOverFetch((_call, index) => responses[index]());
      await rejectionOf(ask());
      await rejectionOf(ask());
      expect(decisionBreakers().snapshot(breakerKey)).toMatchObject({ consecutiveFailures: 2, failureKind: "capacity" });

      clientOverFetch(() => {
        throw new TypeError("fetch failed");
      });
      const unreachable = asInstance(await rejectionOf(ask()), DecisionTransportError);
      expect(unreachable.source).toBe("network");
      expect(decisionBreakers().snapshot(breakerKey)).toMatchObject({ consecutiveFailures: 1, failureKind: "hard" });
    });

    it("gives no verdict on the vendor when no request was made", async () => {
      vi.stubEnv(keyEnv, "");
      const harness = clientOverFetch(() => answering(CHOICE_ANSWER()));
      const threshold = admittedDecisionRouteTable().defaults.circuit_breaker.failure_threshold;

      for (let call = 0; call <= threshold; call += 1) {
        const error = asInstance(await rejectionOf(ask()), DecisionCredentialError);
        expect(error.source).toBe("key_unset");
      }

      expect(harness.double.calls).toHaveLength(0);
      expect(decisionBreakers().snapshotAll()).toEqual([]);
    });

    it("returns no probe slot from an attempt that never held one", async () => {
      vi.useFakeTimers();
      const table = admittedDecisionRouteTable();
      table.defaults.circuit_breaker.cooldown_ms = SHORT_COOLDOWN_MS;
      table.defaults.circuit_breaker.capacity_cooldown_ms = SHORT_COOLDOWN_MS;
      const threshold = table.defaults.circuit_breaker.failure_threshold;
      const double = createDecisionTransportDouble((call) => {
        if (call.index >= 1 && call.index <= threshold) {
          throw serverFailure();
        }
        return heldUntilAborted(call);
      });
      configureDecisionClient({ routeTable: table, transport: double.transport });

      // In flight before the route opens, so it holds no probe slot.
      const early = new AbortController();
      const earlyOutcome = watch(ask({ signal: early.signal }));
      await settleReadyWork();
      expect(double.calls).toHaveLength(1);
      for (let failure = 0; failure < threshold; failure += 1) {
        await rejectionOf(ask());
      }
      expect(decisionBreakers().stateOf(breakerKey)).toBe("open");
      vi.advanceTimersByTime(SHORT_COOLDOWN_MS);

      const probe = new AbortController();
      const probeOutcome = watch(ask({ signal: probe.signal }));
      await settleReadyWork();
      expect(decisionBreakers().snapshot(breakerKey).probesInFlight).toBe(1);

      early.abort();
      await settleReadyWork();
      expect(asInstance(earlyOutcome(), DecisionTimeoutError).source).toBe("caller_signal");
      expect(decisionBreakers().snapshot(breakerKey).probesInFlight).toBe(1);
      expect(asInstance(await rejectionOf(ask()), DecisionRouteUnavailableError).code).toBe("breaker_open");

      probe.abort();
      await settleReadyWork();
      expect(asInstance(probeOutcome(), DecisionTimeoutError).source).toBe("caller_signal");
      expect(decisionBreakers().snapshot(breakerKey).probesInFlight).toBe(0);
    });

    it("counts an attempt as in flight only until it ends", async () => {
      const table = admittedDecisionRouteTable();
      table.defaults.circuit_breaker.probe_fraction = PROBE_FRACTION;
      const threshold = table.defaults.circuit_breaker.failure_threshold;
      const double = createDecisionTransportDouble(() => {
        throw serverFailure();
      });
      configureDecisionClient({ routeTable: table, transport: double.transport });

      for (let failure = 0; failure < threshold; failure += 1) {
        await rejectionOf(ask());
      }

      // The calls ran one at a time, so the route never carried more than one at once.
      expect(decisionBreakers().stateOf(breakerKey)).toBe("open");
      expect(decisionBreakers().snapshot(breakerKey).probeBudget).toBe(table.defaults.circuit_breaker.half_open_probes);
    });

    it("a guard refusal on a half-open route returns the probe slot", async () => {
      vi.useFakeTimers();
      const breaker = admittedDecisionRouteTable().defaults.circuit_breaker;
      const harness = clientOverTransport((call) => {
        if (call.index < breaker.failure_threshold) {
          throw serverFailure();
        }
        return scriptedAnswer(call.route, CHOICE_ANSWER());
      });
      for (let failure = 0; failure < breaker.failure_threshold; failure += 1) {
        await rejectionOf(ask());
      }
      expect(decisionBreakers().stateOf(breakerKey)).toBe("open");
      vi.advanceTimersByTime(breaker.cooldown_ms);
      expect(decisionBreakers().stateOf(breakerKey)).toBe("half-open");

      // Every concurrency permit is held by other traffic, so the probe cannot be dispatched.
      const releases: (() => void)[] = [];
      const held: Promise<void>[] = [];
      const permits = guardOf(provider)?.maxConcurrent ?? 0;
      expect(permits).toBeGreaterThan(0);
      for (let permit = 0; permit < permits; permit += 1) {
        held.push(
          withProviderGuards(
            provider,
            () =>
              new Promise<void>((resolve) => {
                releases.push(resolve);
              }),
          ),
        );
      }
      await settleReadyWork();
      expect(guardOf(provider)?.inFlight).toBe(permits);

      const probe = watch(ask());
      await vi.advanceTimersByTimeAsync(harness.route.budgetMs);
      const refused = asInstance(probe(), DecisionAdmissionError);
      expect(refused.fault).toBe("admission");
      expect(refused.source).toBe("provider_guard");
      expect(harness.double.calls).toHaveLength(breaker.failure_threshold);
      expect(decisionBreakers().snapshot(breakerKey).probesInFlight).toBe(0);

      for (const release of releases) {
        release();
      }
      await Promise.all(held);

      const result = await ask();
      expect(result.answers.department.type).toBe("choice");
      expect(harness.double.calls).toHaveLength(breaker.failure_threshold + 1);
      expect(decisionBreakers().stateOf(breakerKey)).toBe("closed");
    });
  });

  describe("the budget", () => {
    it("the budget bounds the client's own rate queue", async () => {
      vi.useFakeTimers();
      const harness = clientOverTransport((call) => scriptedAnswer(call.route, CHOICE_ANSWER()));
      await drainRateBucket(provider);
      const ahead: Promise<void>[] = [];
      for (let waiter = 0; waiter < WAITERS_AHEAD; waiter += 1) {
        ahead.push(withProviderGuards(provider, () => Promise.resolve()));
      }

      const outcome = watch(ask({ timeoutMs: QUEUED_BUDGET_MS }));
      await vi.advanceTimersByTimeAsync(QUEUED_BUDGET_MS - 1);
      expect(outcome()).toBe(PENDING);
      await vi.advanceTimersByTimeAsync(1);

      const error = asInstance(outcome(), DecisionAdmissionError);
      expect(error.fault).toBe("admission");
      expect(error.source).toBe("route_budget");
      expect(error.budgetMs).toBe(QUEUED_BUDGET_MS);
      expect(error.attempt).toMatchObject({ queueMs: QUEUED_BUDGET_MS, durationMs: null, status: null });
      expect(harness.double.calls).toHaveLength(0);
      expect(decisionBreakers().snapshotAll()).toEqual([]);

      await vi.advanceTimersByTimeAsync(harness.route.budgetMs);
      await Promise.all(ahead);
      expect(harness.double.calls).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a call that ends while queued for a rate token leaves the queue and takes no token", async () => {
      vi.useFakeTimers();
      const harness = clientOverTransport((call) => scriptedAnswer(call.route, CHOICE_ANSWER()));
      expect(RATE_REFILL_INTERVAL_MS).toBeGreaterThan(SHORTER_THAN_A_REFILL_MS);

      /**
       * Empty the bucket and let it refill, with or without a call that
       * queues for a token and runs out of budget first.
       *
       * @param withAbandonedCall Whether such a call is made.
       * @returns The tokens the bucket holds after the refills.
       */
      const tokensAfterRefills = async (withAbandonedCall: boolean): Promise<number | undefined> => {
        resetProviderGuards();
        await drainRateBucket(provider);
        if (withAbandonedCall) {
          const outcome = watch(ask({ timeoutMs: SHORTER_THAN_A_REFILL_MS }));
          await settleReadyWork();
          expect(guardOf(provider)?.rateQueueLength).toBe(1);
          await vi.advanceTimersByTimeAsync(SHORTER_THAN_A_REFILL_MS);
          const error = asInstance(outcome(), DecisionAdmissionError);
          expect(error.source).toBe("route_budget");
          expect(guardOf(provider)?.rateQueueLength).toBe(0);
        } else {
          await vi.advanceTimersByTimeAsync(SHORTER_THAN_A_REFILL_MS);
        }
        await vi.advanceTimersByTimeAsync(RATE_REFILL_INTERVAL_MS * REFILLS_COUNTED);
        return guardOf(provider)?.availableTokens;
      };

      const afterAbandonedCall = await tokensAfterRefills(true);
      const untouched = await tokensAfterRefills(false);

      expect(untouched).toBe(REFILLS_COUNTED);
      expect(afterAbandonedCall).toBe(untouched);
      expect(guardOf(provider)?.inFlight ?? 0).toBe(0);
      expect(harness.double.calls).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("takes a caller that leaves out of the rate queue at once", async () => {
      vi.useFakeTimers();
      const harness = clientOverTransport((call) => scriptedAnswer(call.route, CHOICE_ANSWER()));
      await drainRateBucket(provider);
      const caller = new AbortController();
      const outcome = watch(ask({ signal: caller.signal }));
      await settleReadyWork();
      expect(guardOf(provider)?.rateQueueLength).toBe(1);

      caller.abort();

      expect(guardOf(provider)?.rateQueueLength).toBe(0);
      await settleReadyWork();
      expect(asInstance(outcome(), DecisionAdmissionError).source).toBe("caller_signal");
      expect(harness.double.calls).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("takes an abandoned caller out of the concurrency queue at once", async () => {
      const harness = clientOverTransport((call) => scriptedAnswer(call.route, CHOICE_ANSWER()));
      const releases: (() => void)[] = [];
      const held: Promise<void>[] = [];
      await withProviderGuards(provider, () => Promise.resolve());
      const permits = guardOf(provider)?.maxConcurrent ?? 0;
      for (let permit = 0; permit < permits; permit += 1) {
        held.push(
          withProviderGuards(
            provider,
            () =>
              new Promise<void>((resolve) => {
                releases.push(resolve);
              }),
          ),
        );
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(guardOf(provider)?.inFlight).toBe(permits);

      const caller = new AbortController();
      const pending = rejectionOf(ask({ signal: caller.signal }));
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(guardOf(provider)?.concurrencyQueueLength).toBe(1);

      caller.abort();
      expect(guardOf(provider)?.concurrencyQueueLength).toBe(0);
      const error = asInstance(await pending, DecisionAdmissionError);
      expect(error.source).toBe("caller_signal");

      for (const release of releases) {
        release();
      }
      await Promise.all(held);
      expect(harness.double.calls).toHaveLength(0);
    });

    it("a dispatched call that outlives its budget is a timeout and its transport signal is aborted", async () => {
      vi.useFakeTimers();
      const harness = clientOverTransport(heldUntilAborted);

      const outcome = watch(ask());
      await vi.advanceTimersByTimeAsync(harness.route.budgetMs - 1);
      expect(outcome()).toBe(PENDING);
      expect(harness.double.calls).toHaveLength(1);
      expect(harness.double.calls[0].signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const error = asInstance(outcome(), DecisionTimeoutError);
      expect(error.fault).toBe("timeout");
      expect(error.source).toBe("route_budget");
      expect(error.budgetMs).toBe(harness.route.budgetMs);
      expect(error.attempt).toMatchObject({
        outcome: "fault",
        fault: "timeout",
        queueMs: 0,
        durationMs: harness.route.budgetMs,
        budgetMs: harness.route.budgetMs,
        status: null,
      });
      expect(harness.double.calls[0].signal.aborted).toBe(true);
      expect(harness.double.calls[0].signal.reason).toBe(error);
      expect(decisionBreakers().snapshot(breakerKey)).toMatchObject({ consecutiveFailures: 1, failureKind: "capacity" });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("the caller's timeout narrows the route budget and never widens it", async () => {
      vi.useFakeTimers();
      const harness = clientOverTransport(heldUntilAborted);
      expect(NARROWING_TIMEOUT_MS).toBeLessThan(harness.route.budgetMs);
      expect(WIDENING_TIMEOUT_MS).toBeGreaterThan(harness.route.budgetMs);

      const narrowed = watch(ask({ timeoutMs: NARROWING_TIMEOUT_MS }));
      await vi.advanceTimersByTimeAsync(NARROWING_TIMEOUT_MS - 1);
      expect(narrowed()).toBe(PENDING);
      await vi.advanceTimersByTimeAsync(1);
      expect(asInstance(narrowed(), DecisionTimeoutError).budgetMs).toBe(NARROWING_TIMEOUT_MS);

      const held = watch(ask({ timeoutMs: WIDENING_TIMEOUT_MS }));
      await vi.advanceTimersByTimeAsync(harness.route.budgetMs - 1);
      expect(held()).toBe(PENDING);
      await vi.advanceTimersByTimeAsync(1);
      expect(asInstance(held(), DecisionTimeoutError).budgetMs).toBe(harness.route.budgetMs);

      const unbounded = watch(ask({ timeoutMs: Number.POSITIVE_INFINITY }));
      await vi.advanceTimersByTimeAsync(harness.route.budgetMs);
      expect(asInstance(unbounded(), DecisionTimeoutError).budgetMs).toBe(harness.route.budgetMs);
    });

    it("refuses a deadline that has already passed before anything is charged", async () => {
      const harness = clientOverTransport((call) => scriptedAnswer(call.route, CHOICE_ANSWER()));

      for (const timeoutMs of [0, -1, Number.NEGATIVE_INFINITY]) {
        const error = asInstance(await rejectionOf(ask({ timeoutMs })), DecisionAdmissionError);
        expect(error.fault).toBe("admission");
        expect(error.source).toBe("route_budget");
        expect(error.budgetMs).toBe(0);
        expect(error.attempt).toMatchObject({ queueMs: null, durationMs: null, budgetMs: 0 });
      }

      expect(harness.double.calls).toHaveLength(0);
      expect(guardSnapshots()).toEqual([]);
      expect(decisionBreakers().snapshotAll()).toEqual([]);
    });

    it("a caller abort is a timeout from the caller's signal and is not charged to the breaker", async () => {
      const threshold = admittedDecisionRouteTable().defaults.circuit_breaker.failure_threshold;
      const harness = clientOverTransport((call) =>
        call.index <= threshold ? heldUntilAborted(call) : scriptedAnswer(call.route, CHOICE_ANSWER()),
      );

      for (let call = 0; call <= threshold; call += 1) {
        const caller = new AbortController();
        const pending = rejectionOf(ask({ signal: caller.signal }));
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        expect(harness.double.calls).toHaveLength(call + 1);
        caller.abort();

        const error = asInstance(await pending, DecisionTimeoutError);
        expect(error.fault).toBe("timeout");
        expect(error.source).toBe("caller_signal");
        expect(harness.double.calls[call].signal.aborted).toBe(true);
        expect(decisionBreakers().snapshot(breakerKey).consecutiveFailures).toBe(0);
      }

      const result = await ask();
      expect(result.answers.department.type).toBe("choice");
      expect(harness.double.calls).toHaveLength(threshold + 2);
    });

    it("ends a call at the real transport with the very error the caller receives", async () => {
      const harness = clientOverFetch(hangingFetch);
      const caller = new AbortController();
      const pending = rejectionOf(ask({ signal: caller.signal }));
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(harness.double.calls).toHaveLength(1);
      expect(harness.double.calls[0].signal.aborted).toBe(false);
      caller.abort();

      const error = asInstance(await pending, DecisionTimeoutError);

      expect(error.source).toBe("caller_signal");
      expect(harness.double.calls[0].signal.aborted).toBe(true);
      expect(harness.double.calls[0].signal.reason).toBe(error);
      expect(harness.double.calls).toHaveLength(1);
    });

    it("refuses a call whose caller has already gone, before anything is charged", async () => {
      const harness = clientOverTransport((call) => scriptedAnswer(call.route, CHOICE_ANSWER()));
      const caller = new AbortController();
      caller.abort();

      const error = asInstance(await rejectionOf(ask({ signal: caller.signal })), DecisionAdmissionError);

      expect(error.source).toBe("caller_signal");
      expect(harness.double.calls).toHaveLength(0);
      expect(guardSnapshots()).toEqual([]);
    });

    it("never dispatches on a signal that has already aborted, whenever the caller leaves", async () => {
      const outcomes = new Set<string>();
      for (let turns = 0; turns <= ABORT_SWEEP_TURNS; turns += 1) {
        resetProviderGuards();
        const harness = clientOverTransport(heldUntilAborted);
        const caller = new AbortController();
        const pending = rejectionOf(ask({ signal: caller.signal }));
        for (let turn = 0; turn < turns; turn += 1) {
          await Promise.resolve();
        }
        caller.abort();

        const error = asCallError(await pending);
        outcomes.add(error.fault);
        expect(harness.double.calls.filter((call) => call.abortedAtDispatch)).toEqual([]);
        expect(harness.double.calls).toHaveLength(error.fault === "timeout" ? 1 : 0);
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        expect(harness.double.calls.filter((call) => call.abortedAtDispatch)).toEqual([]);
        expect(guardOf(provider)?.inFlight ?? 0).toBe(0);
      }
      // The sweep straddles the moment of dispatch, so both sides of it were exercised.
      expect([...outcomes].sort()).toEqual(["admission", "timeout"]);
    });

    it("always clears its timer and its listener on the caller's signal", async () => {
      vi.useFakeTimers();
      const scripts: readonly DecisionDispatchScript[] = [
        (call) => scriptedAnswer(call.route, CHOICE_ANSWER()),
        () => {
          throw new Error("the transport failed");
        },
      ];
      for (const script of scripts) {
        clientOverTransport(script);
        const caller = new AbortController();
        const added = vi.spyOn(caller.signal, "addEventListener");
        const removed = vi.spyOn(caller.signal, "removeEventListener");

        const outcome = watch(ask({ signal: caller.signal }));
        await settleReadyWork();

        expect(outcome()).not.toBe(PENDING);
        expect(vi.getTimerCount()).toBe(0);
        expect(added).toHaveBeenCalledTimes(1);
        expect(removed).toHaveBeenCalledTimes(1);
        expect(removed.mock.calls[0][0]).toBe("abort");
        expect(removed.mock.calls[0][1]).toBe(added.mock.calls[0][1]);
      }
    });
  });

  describe("what is sent", () => {
    it("fixes what is sent when the call is made: a later change to the request cannot reach the wire", async () => {
      const harness = clientOverFetch(() => answering(CHOICE_ANSWER()));
      const state = { message: "Help! My payouts have been failing for 3 days.", attempts: [1, 2, 3] };
      const criteria: Record<string, string | null> = { ...(CHOICE_REQUEST().questions.department.criteria as object) };
      const questions: Record<string, DecisionQuestion> = {
        department: { type: "choice", instructions: "Which team should handle this?", criteria },
      };
      const asSent = JSON.stringify({ state, model: harness.route.modelPin, questions });

      const pending = callDecisionModel(HOSTED_ROUTE, { state, questions });
      state.message = "changed after the call was made";
      state.attempts.push(4);
      criteria.legal = "added after the call was made";
      questions.late = { type: "noul", instructions: "Was this question asked?" };
      const result = await pending;

      expect(harness.double.calls).toHaveLength(1);
      expect(harness.double.calls[0].body).toBe(asSent);
      expect(Object.keys(result.answers)).toEqual(["department"]);
    });

    it("reads each value of a request once, so what is sent is what was checked", async () => {
      const harness = clientOverFetch(() => answering(CHOICE_ANSWER()));
      let reads = 0;
      const state = {
        get price(): number {
          reads += 1;
          return reads === 1 ? 101.5 : Number.NaN;
        },
      };

      await callDecisionModel(HOSTED_ROUTE, { state, questions: CHOICE_REQUEST().questions });

      expect(reads).toBe(1);
      expect((JSON.parse(harness.double.calls[0].body) as { state: unknown }).state).toEqual({ price: 101.5 });
    });

    it("refuses a request that must not be sent before any guard is charged, and names the route", async () => {
      const harness = clientOverFetch(() => answering(CHOICE_ANSWER()));
      const absentState = { state: null, questions: CHOICE_REQUEST().questions } as unknown as DecisionRequest;
      const unmeasured: DecisionRequest = { state: { price: Number.NaN }, questions: CHOICE_REQUEST().questions };
      const tooManyOptions: DecisionRequest = {
        state: "state",
        questions: {
          wide: {
            type: "choice",
            instructions: "Which?",
            criteria: Object.fromEntries(
              Array.from({ length: harness.route.caps.maxOptions + 1 }, (_, option) => [`option-${option}`, null]),
            ),
          },
        },
      };
      const expected: readonly (readonly [DecisionRequest, string])[] = [
        [undefined as unknown as DecisionRequest, "$"],
        [absentState, "state"],
        [unmeasured, "state.price"],
        [tooManyOptions, "questions.wide.criteria"],
      ];

      for (const [request, fieldPath] of expected) {
        const error = asInstance(await rejectionOf(callDecisionModel(HOSTED_ROUTE, request)), DecisionRequestInvalidError);
        expect(error.fault).toBe("schema");
        expect(error.source).toBe("request_validation");
        expect(error.fieldPath).toBe(fieldPath);
        expect(error.route).toBe(HOSTED_ROUTE);
        expect(error.attempt).toMatchObject({ provider, modelPin: harness.route.modelPin, queueMs: null });
      }

      expect(harness.double.calls).toHaveLength(0);
      expect(guardSnapshots()).toEqual([]);
      expect(decisionBreakers().snapshotAll()).toEqual([]);
    });

    it("refuses a request too deep to be written before any guard is charged", async () => {
      const harness = clientOverFetch(() => answering(CHOICE_ANSWER()));
      let nested: Record<string, unknown> = { leaf: true };
      for (let depth = 0; depth < NESTING_PAST_THE_CALL_STACK; depth += 1) {
        nested = { nested };
      }
      const request = { state: nested, questions: CHOICE_REQUEST().questions } as unknown as DecisionRequest;

      const error = asInstance(await rejectionOf(callDecisionModel(HOSTED_ROUTE, request)), DecisionRequestInvalidError);

      expect(error.source).toBe("request_validation");
      expect(error.fieldPath).toBe("$");
      expect(harness.double.calls).toHaveLength(0);
      expect(guardSnapshots()).toEqual([]);
    });

    it("refuses options it cannot honour before anything is spent", async () => {
      const harness = clientOverFetch(() => answering(CHOICE_ANSWER()));
      const unusable: readonly (readonly [unknown, string])[] = [
        [null, "options"],
        [{ timeoutMs: Number.NaN }, "options.timeoutMs"],
        [{ timeoutMs: "300" }, "options.timeoutMs"],
        [{ probabilitySumTolerance: -1 }, "options.probabilitySumTolerance"],
        [{ signal: { aborted: false } }, "options.signal"],
        [{ signal: Object.create(AbortSignal.prototype) as unknown }, "options.signal"],
        [{ correlationId: 7 }, "options.correlationId"],
      ];

      for (const [options, fieldPath] of unusable) {
        const error = asInstance(
          await rejectionOf(callDecisionModel(HOSTED_ROUTE, CHOICE_REQUEST(), options as DecisionCallOptions)),
          DecisionRequestInvalidError,
        );
        expect(error.fieldPath).toBe(fieldPath);
        expect(error.route).toBe(HOSTED_ROUTE);
      }

      expect(harness.double.calls).toHaveLength(0);
      expect(guardSnapshots()).toEqual([]);
    });
  });

  describe("the key", () => {
    it("keeps the key out of a mismatch and out of a rejected answer, whole or cut by the excerpt's bound", async () => {
      const cutByTheBound = (lead: number): string =>
        `${"m".repeat(DECISION_ERROR_BODY_EXCERPT - lead - KEY_CHARS_INSIDE_THE_BOUND)}${SENTINEL_KEY}`;
      const bodies: readonly Record<string, unknown>[] = [
        answerFrom(SENTINEL_KEY),
        answerFrom(`Bearer ${SENTINEL_KEY}`),
        answerFrom(cutByTheBound(0)),
        { ...CHOICE_ANSWER(), answers: { [SENTINEL_KEY]: { type: "noul", noul: 0.5 } } },
        { ...CHOICE_ANSWER(), answers: { [cutByTheBound("answers.".length)]: { type: "noul", noul: 0.5 } } },
        {
          ...CHOICE_ANSWER(),
          answers: {
            department: {
              type: "choice",
              choice: "billing",
              probabilities: { billing: 0.88, technical: 0.12, sales: 0, [SENTINEL_KEY]: 0 },
              confidence: 0.81,
            },
          },
        },
      ];

      for (const body of bodies) {
        clientOverFetch(() => answering(body, { [VENDOR_REQUEST_ID_HEADER]: `req_${SENTINEL_KEY}` }));

        const error = asCallError(await rejectionOf(ask()));

        expect(["route_mismatch", "schema"]).toContain(error.fault);
        expect(showsText(error, SENTINEL_KEY)).toBe(false);
        expect(showsText(error, SENTINEL_KEY.slice(0, KEY_CHARS_INSIDE_THE_BOUND))).toBe(false);
        expect(showsText(error.attempt, SENTINEL_KEY.slice(0, KEY_CHARS_INSIDE_THE_BOUND))).toBe(false);
      }
    });

    it("says where the key stood, so a reader can see the vendor quoted it", async () => {
      clientOverFetch(() => answering(answerFrom(SENTINEL_KEY)));
      const mismatch = asInstance(await rejectionOf(ask()), DecisionRouteMismatchError);
      expect(mismatch.servedModel).toBe(KEY_REMOVED);
      expect(mismatch.attempt?.servedModel).toBe(KEY_REMOVED);

      clientOverFetch(() =>
        answering({ ...CHOICE_ANSWER(), answers: { [SENTINEL_KEY]: { type: "noul", noul: 0.5 } } }),
      );
      const malformed = asInstance(await rejectionOf(ask()), DecisionResponseFormatError);
      expect(malformed.fieldPath).toBe(`answers.${KEY_REMOVED}`);
      expect(malformed.usage?.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
      expect(malformed.status).toBe(OK);
    });

    it("recognises a key in the form a JSON string writes it", async () => {
      vi.stubEnv(keyEnv, ESCAPED_KEY);
      const asJson = JSON.stringify(ESCAPED_KEY).slice(1, -1);
      expect(asJson).not.toBe(ESCAPED_KEY);
      clientOverFetch(() => answering(answerFrom(`quoted ${asJson} and plain ${ESCAPED_KEY}`)));

      const error = asInstance(await rejectionOf(ask()), DecisionRouteMismatchError);

      expect(error.servedModel).toBe(`quoted ${KEY_REMOVED} and plain ${KEY_REMOVED}`);
      expect(showsText(error, ESCAPED_KEY)).toBe(false);
      expect(showsText(error, asJson)).toBe(false);
    });

    it("keeps the key out of an answered attempt's request id", async () => {
      clientOverTransport((call) =>
        scriptedAnswer(call.route, CHOICE_ANSWER(), { vendorRequestId: `req_${SENTINEL_KEY}` }),
      );

      const result = await ask();

      expect(result.vendorRequestId).toBe(`req_${KEY_REMOVED}`);
      expect(result.attempt.vendorRequestId).toBe(`req_${KEY_REMOVED}`);
    });
  });

  describe("failing closed", () => {
    it("the canonical routes fail closed", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const double = createDecisionTransportDouble((call) => scriptedAnswer(call.route, CHOICE_ANSWER()));
      configureDecisionClient({ transport: double.transport });

      const hosted = asInstance(
        await rejectionOf(callDecisionModel(HOSTED_ROUTE, CHOICE_REQUEST(), { correlationId: CORRELATION_ID })),
        DecisionRouteUnavailableError,
      );
      expect(hosted.fault).toBe("unavailable");
      expect(hosted.code).toBe("route_not_admitted");
      expect(hosted.reason).toContain("pending-onboarding");
      expect(hosted.attempt).toEqual({
        route: HOSTED_ROUTE,
        provider: null,
        modelPin: null,
        status: null,
        queueMs: null,
        durationMs: null,
        budgetMs: null,
        retryAfterMs: null,
        vendorRequestId: null,
        servedModel: null,
        usage: null,
        correlationId: CORRELATION_ID,
        outcome: "fault",
        fault: "unavailable",
      });

      const local = asInstance(
        await rejectionOf(callDecisionModel(LOCAL_ROUTE, CHOICE_REQUEST())),
        DecisionRouteUnavailableError,
      );
      expect(local.fault).toBe("unavailable");
      expect(local.code).toBe("engine_served");

      expect(double.calls).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(guardSnapshots()).toEqual([]);
      expect(decisionBreakers().snapshotAll()).toEqual([]);
    });

    it("refuses a closed route before it looks at the request or the options", async () => {
      const double = createDecisionTransportDouble((call) => scriptedAnswer(call.route, CHOICE_ANSWER()));
      configureDecisionClient({ transport: double.transport });
      const nothing = undefined as unknown as DecisionRequest;
      const unusable = null as unknown as DecisionCallOptions;

      for (const route of [HOSTED_ROUTE, LOCAL_ROUTE]) {
        expect(asCallError(await rejectionOf(callDecisionModel(route, nothing, unusable))).fault).toBe("unavailable");
      }
      expect(double.calls).toHaveLength(0);
    });

    it("refuses a name that is not a route, whatever it spells", async () => {
      clientOverTransport((call) => scriptedAnswer(call.route, CHOICE_ANSWER()));

      for (const name of ["dm.baseline", "toString", "__proto__", ""]) {
        const error = asInstance(
          await rejectionOf(callDecisionModel(name as typeof HOSTED_ROUTE, CHOICE_REQUEST())),
          DecisionRouteUnavailableError,
        );
        expect(error.code).toBe("route_not_admitted");
      }
    });

    it("refuses to be configured with a table that breaks a rule, and keeps the wiring it had", async () => {
      const harness = clientOverFetch(() => answering(CHOICE_ANSWER()));
      const broken = admittedDecisionRouteTable();
      hostedRouteOf(broken).budget_ms = 1;

      expect(() => configureDecisionClient({ routeTable: broken })).toThrow(/decision route table is invalid/);

      const result = await ask();
      expect(result.route).toBe(HOSTED_ROUTE);
      expect(harness.double.calls).toHaveLength(1);
    });

    it("no failure resolves", async () => {
      const fromTheTransport: readonly DecisionDispatchScript[] = [
        () => {
          throw new Error("an error that is not a decision fault");
        },
        () => {
          throw new TypeError("a programming error below the client");
        },
        () => Promise.reject(new RateGuardTimeoutError("another-provider", "rate", 1)),
        () => Promise.reject("a thrown string" as unknown as Error),
        () => Promise.reject(null as unknown as Error),
        () =>
          Promise.reject(
            new DecisionTransportError({ source: "network", retryable: true, detail: "TypeError, caused by Error" }),
          ),
        (call) => ({ ...scriptedAnswer(call.route, CHOICE_ANSWER()), payload: {} }),
        (call) => ({ ...scriptedAnswer(call.route, CHOICE_ANSWER()), payload: { model: 7, answers: null } }),
      ];
      const fromTheVendor: readonly DecisionFetchScript[] = [
        () => {
          throw new TypeError("fetch failed");
        },
        () => decisionResponse(OK, "<html>not json</html>"),
        () => decisionResponse(OK, JSON.stringify({ answers: {} })),
        () => decisionResponse(OK, JSON.stringify([])),
        () => decisionResponse(204, ""),
        () => decisionResponse(302, ""),
        () => decisionResponse(418, "teapot"),
        () => failingWith("error.401.unobserved.json", ["synthetic-unobserved"]),
        () => failingWith("error.403-missing-key.observed.json", ["observed-unauthenticated"]),
        () => failingWith("error.422.unobserved.json", ["synthetic-unobserved"]),
        () => failingWith("error.429.unobserved.json", ["synthetic-unobserved"]),
        () => failingWith("error.500.unobserved.json", ["synthetic-unobserved"]),
        () => failingWith("error.529.unobserved.json", ["synthetic-unobserved"]),
        () => answering(answerFrom(SUBSTITUTED_MODELS[1])),
        () => answering({ ...CHOICE_ANSWER(), answers: {} }),
        () => answering({ ...CHOICE_ANSWER(), answers: { department: { type: "noul", noul: 0.5 } } }),
      ];
      const failures: Promise<DecisionCallResult>[] = [];
      for (const script of fromTheTransport) {
        clientOverTransport(script);
        failures.push(ask());
        await rejectionOf(failures[failures.length - 1]);
      }
      for (const script of fromTheVendor) {
        clientOverFetch(script);
        failures.push(ask());
        await rejectionOf(failures[failures.length - 1]);
      }

      expect(failures).toHaveLength(fromTheTransport.length + fromTheVendor.length);
      for (const failure of failures) {
        const error = asCallError(await rejectionOf(failure));
        expect(DECISION_FAULTS).toContain(error.fault);
        expect(error.route).toBe(HOSTED_ROUTE);
        expect(error.attempt?.outcome).toBe("fault");
        expect(error.attempt?.fault).toBe(error.fault);
        expect(error.attempt?.route).toBe(HOSTED_ROUTE);
        expect(Object.keys(error)).toContain("fault");
      }
    });

    it("files a failure it cannot name under transport, without quoting it", async () => {
      clientOverTransport(() => {
        throw new Error(`a lower layer quoted Bearer ${SENTINEL_KEY}`);
      });

      const error = asInstance(await rejectionOf(ask()), DecisionTransportError);

      expect(error.source).toBe("network");
      expect(error.retryable).toBe(false);
      expect(error.status).toBeNull();
      expect(error.message).toContain("the transport raised a failure that is not a decision fault: Error");
      expect(showsText(error, SENTINEL_KEY)).toBe(false);
      expect(decisionBreakers().snapshot(breakerKey)).toMatchObject({ consecutiveFailures: 1, failureKind: "hard" });
    });
  });

  describe("every rejection is a decision error", () => {
    /** What a row of the table expects of the rejection it produced. */
    interface RejectionRow {
      /** Where the failure came from. */
      readonly source: string;
      /** Wire the client, make the call, and return what it rejected with. */
      readonly reject: () => Promise<unknown>;
      readonly fault: (typeof DECISION_FAULTS)[number];
      readonly type: abstract new (...args: never[]) => DecisionCallError;
      /** How many times the transport was invoked. */
      readonly dispatches: number;
      /** What the breaker holds against the route afterwards. */
      readonly consecutiveFailures: number;
      /** Text the message must hold: the stage, and the failure's class and code. */
      readonly says: readonly string[];
      /** Whether the call failed before the route's provider was known. */
      readonly providerUnknown?: boolean;
      /** Anything else the row pins. */
      readonly also?: (error: DecisionCallError) => void;
    }

    /** The scripted transport of the row being run. */
    let dispatched: DecisionTransportDouble;

    /**
     * Wire the client over a scripted transport on the admitted table.
     *
     * @param script What the transport does when invoked.
     * @param wiring The clock, when the row injects one.
     * @returns void
     */
    const wire = (script: DecisionDispatchScript, wiring: { now?: () => number } = {}): void => {
      dispatched = createDecisionTransportDouble(script);
      configureDecisionClient({ routeTable: admittedDecisionRouteTable(), transport: dispatched.transport, ...wiring });
    };

    /** A transport that answers the documented question. */
    const answers: DecisionDispatchScript = (call) => scriptedAnswer(call.route, CHOICE_ANSWER());

    /**
     * A failure of a class this package does not own, whose message quotes a request.
     *
     * @param type The class to raise.
     * @param code A system code to carry, when the row wants one.
     * @returns The failure.
     */
    const foreignFailure = (type: new (message: string) => Error, code?: string): Error => {
      const failure = new type(`refused ${QUOTED_REQUEST_TEXT}`);
      return code === undefined ? failure : Object.assign(failure, { code });
    };

    /**
     * Make a call with the given arguments and return what it rejected with.
     *
     * @param route The value passed as the route.
     * @param request The value passed as the request.
     * @param options The value passed as the options.
     * @returns The rejection.
     */
    const rejected = (route: unknown, request: unknown, options?: unknown): Promise<unknown> =>
      rejectionOf(
        callDecisionModel(route as typeof HOSTED_ROUTE, request as DecisionRequest, options as DecisionCallOptions),
      );

    const rows: readonly RejectionRow[] = [
      {
        source: "a member of the caller's request that throws when read",
        reject: () => {
          wire(answers);
          const request = {
            get state(): DecisionState {
              throw foreignFailure(Error);
            },
            questions: CHOICE_REQUEST().questions,
          };
          return rejected(HOSTED_ROUTE, request);
        },
        fault: "schema",
        type: DecisionRequestInvalidError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["invalid at $", "the request could not be read: reading it raised Error"],
        also: (error) => {
          expect(asInstance(error, DecisionRequestInvalidError).source).toBe("request_validation");
          expect(guardSnapshots()).toEqual([]);
        },
      },
      {
        source: "a request that refuses to list its members",
        reject: () => {
          wire(answers);
          const request = new Proxy(CHOICE_REQUEST(), {
            ownKeys: () => {
              throw foreignFailure(TypeError);
            },
          });
          return rejected(HOSTED_ROUTE, request);
        },
        fault: "schema",
        type: DecisionRequestInvalidError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["invalid at $", "reading it raised TypeError"],
      },
      {
        source: "the codec, raising a failure of no decision class while encoding",
        reject: () => {
          wire(answers);
          vi.spyOn(codec, "encodeDecisionRequest").mockImplementation(() => {
            throw foreignFailure(RangeError);
          });
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "schema",
        type: DecisionRequestInvalidError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["invalid at $", "reading it raised RangeError"],
      },
      {
        source: "an option that throws when read",
        reject: () => {
          wire(answers);
          const options = {
            get correlationId(): string {
              throw foreignFailure(Error);
            },
          };
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST(), options);
        },
        fault: "schema",
        type: DecisionRequestInvalidError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["invalid at options", "the options could not be read: reading them raised Error"],
        also: (error) => {
          expect(error.attempt?.correlationId).toBeNull();
          expect(guardSnapshots()).toEqual([]);
        },
      },
      {
        source: "a deadline that throws when read",
        reject: () => {
          wire(answers);
          const options = {
            get timeoutMs(): number {
              throw foreignFailure(RangeError);
            },
          };
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST(), options);
        },
        fault: "schema",
        type: DecisionRequestInvalidError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["invalid at options", "reading them raised RangeError"],
      },
      {
        source: "an option that throws when read, on a route that is closed",
        reject: () => {
          dispatched = createDecisionTransportDouble(answers);
          configureDecisionClient({ transport: dispatched.transport });
          const options = {
            get correlationId(): string {
              throw foreignFailure(Error);
            },
          };
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST(), options);
        },
        fault: "unavailable",
        type: DecisionRouteUnavailableError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["route_not_admitted", "pending-onboarding"],
      },
      {
        source: "a route that is a symbol",
        reject: () => {
          wire(answers);
          return rejected(Symbol(QUOTED_REQUEST_TEXT), CHOICE_REQUEST());
        },
        fault: "unavailable",
        type: DecisionRouteUnavailableError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["route_not_admitted", UNNAMED_ROUTE],
        also: (error) => {
          expect(error.attempt?.route).toBe(UNNAMED_ROUTE);
        },
      },
      {
        source: "a route that is an object which cannot be written as text",
        reject: () => {
          wire(answers);
          const route = {
            toString: (): string => {
              throw foreignFailure(Error);
            },
          };
          return rejected(route, CHOICE_REQUEST());
        },
        fault: "unavailable",
        type: DecisionRouteUnavailableError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["route_not_admitted", UNNAMED_ROUTE],
      },
      {
        source: "an injected route table that throws when it is read",
        reject: () => {
          dispatched = createDecisionTransportDouble(answers);
          let unreadable = false;
          const table = new Proxy(admittedDecisionRouteTable(), {
            get: (target, key, receiver): unknown => {
              if (unreadable) {
                throw foreignFailure(TypeError);
              }
              return Reflect.get(target, key, receiver);
            },
          });
          configureDecisionClient({ routeTable: table, transport: dispatched.transport });
          unreadable = true;
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "internal",
        type: DecisionClientFaultError,
        dispatches: 0,
        consecutiveFailures: 0,
        providerUnknown: true,
        says: [`The decision client failed while resolving the route on decision route ${HOSTED_ROUTE}: it raised TypeError.`],
        also: (error) => {
          expect(asInstance(error, DecisionClientFaultError).stage).toBe("resolving");
          expect(guardSnapshots()).toEqual([]);
        },
      },
      {
        source: "an injected clock that throws",
        reject: () => {
          wire(answers, {
            now: () => {
              throw foreignFailure(TypeError);
            },
          });
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "internal",
        type: DecisionClientFaultError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: [`The decision client failed before any request was made on decision route ${HOSTED_ROUTE}: it raised TypeError.`],
        also: (error) => {
          const defect = asInstance(error, DecisionClientFaultError);
          expect(defect.stage).toBe("admitting");
          expect(defect.description).toBe("TypeError");
          expect(defect.retryable).toBe(false);
          expect(error.attempt).toMatchObject({ status: null, durationMs: null, fault: "internal" });
        },
      },
      {
        source: "an injected clock that throws once the vendor has answered",
        reject: () => {
          let clockBroken = false;
          wire(
            (call) => {
              clockBroken = true;
              return scriptedAnswer(call.route, CHOICE_ANSWER(), { vendorRequestId: REQUEST_ID });
            },
            {
              now: () => {
                if (clockBroken) {
                  throw foreignFailure(TypeError);
                }
                return NOW_MS;
              },
            },
          );
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "internal",
        type: DecisionClientFaultError,
        dispatches: 1,
        consecutiveFailures: 0,
        says: ["The decision client failed while recording how the call ended", "it raised TypeError."],
        also: (error) => {
          expect(asInstance(error, DecisionClientFaultError).stage).toBe("recording");
          expect(error).not.toBeInstanceOf(DecisionTransportError);
          // The vendor answered and billed, and the record of the attempt says so.
          expect(error.status).toBe(OK);
          expect(error.vendorRequestId).toBe(REQUEST_ID);
          expect(error.usage?.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
          expect(error.attempt).toMatchObject({ status: OK, vendorRequestId: REQUEST_ID, fault: "internal" });
          expect(error.attempt?.usage?.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
          expect(error.attempt?.servedModel).toBe(hostedRouteOf(admittedDecisionRouteTable()).expected_served_model);
        },
      },
      {
        source: "the breaker registry, raising while it is asked whether the route may be called",
        reject: () => {
          wire(answers);
          vi.spyOn(decisionBreakers(), "allows").mockImplementation(() => {
            throw foreignFailure(RangeError, "ERR_OUT_OF_RANGE");
          });
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "internal",
        type: DecisionClientFaultError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["failed before any request was made", "it raised RangeError ERR_OUT_OF_RANGE."],
        also: (error) => {
          expect(asInstance(error, DecisionClientFaultError).stage).toBe("admitting");
        },
      },
      {
        source: "the guards, raising a failure that is not a refusal",
        reject: () => {
          wire(answers);
          vi.spyOn(rateGuard, "withProviderGuards").mockRejectedValue(foreignFailure(RangeError));
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "internal",
        type: DecisionClientFaultError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["failed before any request was made", "it raised RangeError."],
        also: (error) => {
          expect(asInstance(error, DecisionClientFaultError).stage).toBe("admitting");
          // The wait was measured, on the system clock, and no request was dispatched.
          expect(error.attempt).toMatchObject({ queueMs: expect.any(Number), durationMs: null });
        },
      },
      {
        source: "the guards, refusing the call",
        reject: () => {
          wire(answers);
          vi.spyOn(rateGuard, "withProviderGuards").mockRejectedValue(new RateGuardTimeoutError(provider, "rate", 1));
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "admission",
        type: DecisionAdmissionError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["provider_guard", "the vendor was never contacted"],
      },
      {
        source: "the transport, throwing an error of no decision class",
        reject: () => {
          wire(() => {
            throw foreignFailure(Error);
          });
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "transport",
        type: DecisionTransportError,
        dispatches: 1,
        consecutiveFailures: 1,
        says: ["the transport raised a failure that is not a decision fault: Error"],
      },
      {
        source: "the transport, rejecting with a coded error that has a cause",
        reject: () => {
          wire(() =>
            Promise.reject(
              Object.assign(foreignFailure(TypeError, "UND_ERR_SOCKET"), { cause: foreignFailure(Error, "ECONNRESET") }),
            ),
          );
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "transport",
        type: DecisionTransportError,
        dispatches: 1,
        consecutiveFailures: 1,
        says: ["not a decision fault: TypeError UND_ERR_SOCKET, caused by Error ECONNRESET"],
      },
      {
        source: "the transport, rejecting with text",
        reject: () => {
          wire(() => Promise.reject(QUOTED_REQUEST_TEXT as unknown as Error));
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "transport",
        type: DecisionTransportError,
        dispatches: 1,
        consecutiveFailures: 1,
        says: ["not a decision fault: a thrown value that is not an error"],
      },
      {
        source: "the transport, rejecting with null",
        reject: () => {
          wire(() => Promise.reject(null as unknown as Error));
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "transport",
        type: DecisionTransportError,
        dispatches: 1,
        consecutiveFailures: 1,
        says: ["not a decision fault: a thrown value that is not an error"],
      },
      {
        source: "the transport, rejecting with nothing",
        reject: () => {
          wire(() => Promise.reject(undefined as unknown as Error));
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "transport",
        type: DecisionTransportError,
        dispatches: 1,
        consecutiveFailures: 1,
        says: ["not a decision fault: a thrown value that is not an error"],
      },
      {
        source: "the transport, rejecting with a value whose name and code cannot be read or printed",
        reject: () => {
          wire(() =>
            Promise.reject({
              get name(): string {
                throw foreignFailure(Error);
              },
              code: `E ${QUOTED_REQUEST_TEXT}`,
            } as unknown as Error),
          );
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "transport",
        type: DecisionTransportError,
        dispatches: 1,
        consecutiveFailures: 1,
        says: ["not a decision fault: an unnamed failure"],
      },
      {
        source: "the transport, rejecting with a failure named after the key",
        reject: () => {
          const key = "Kd7a1c9e4f0b3d2685Test";
          vi.stubEnv(keyEnv, key);
          wire(() => Promise.reject(Object.assign(new Error("refused"), { name: key })));
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST()).then((error) => {
            expect(showsText(error, key)).toBe(false);
            return error;
          });
        },
        fault: "transport",
        type: DecisionTransportError,
        dispatches: 1,
        consecutiveFailures: 1,
        says: [`not a decision fault: ${KEY_REMOVED}`],
      },
      {
        source: "the transport, rejecting with another guard's refusal",
        reject: () => {
          wire(() => Promise.reject(new RateGuardTimeoutError("another-provider", "rate", 1)));
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "transport",
        type: DecisionTransportError,
        dispatches: 1,
        consecutiveFailures: 1,
        says: ["not a decision fault: RateGuardTimeoutError"],
      },
      {
        source: "the transport, resolving with no result",
        reject: () => {
          wire(() => undefined as unknown as ReturnType<typeof scriptedAnswer>);
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "schema",
        type: DecisionResponseFormatError,
        dispatches: 1,
        consecutiveFailures: 0,
        says: ["fails validation at $", "the answer could not be read: reading it raised TypeError"],
        also: (error) => {
          // The call was timed on the system clock; nothing about an answer was recorded.
          expect(error.attempt).toMatchObject({ status: null, usage: null, queueMs: expect.any(Number) });
        },
      },
      {
        source: "the transport, resolving with a result whose body throws when read",
        reject: () => {
          wire((call) => ({
            ...scriptedAnswer(call.route, CHOICE_ANSWER()),
            get payload(): Readonly<Record<string, unknown>> {
              throw foreignFailure(Error);
            },
          }));
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "schema",
        type: DecisionResponseFormatError,
        dispatches: 1,
        consecutiveFailures: 0,
        says: ["fails validation at $", "reading it raised Error"],
        also: (error) => {
          // The answer arrived and was billed, and the rejection says so.
          expect(error.status).toBe(OK);
          expect(error.usage?.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
          expect(error.attempt?.usage?.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
        },
      },
      {
        source: "the codec, raising a failure of no decision class while decoding",
        reject: () => {
          wire(answers);
          vi.spyOn(codec, "decodeDecisionResponse").mockImplementation(() => {
            throw foreignFailure(RangeError);
          });
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "schema",
        type: DecisionResponseFormatError,
        dispatches: 1,
        consecutiveFailures: 0,
        says: ["fails validation at $", "reading it raised RangeError"],
        also: (error) => {
          expect(error.status).toBe(OK);
          expect(error.usage?.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
        },
      },
      {
        source: "the breaker registry, raising while it is told of an answer",
        reject: () => {
          wire(answers);
          vi.spyOn(decisionBreakers(), "onSuccess").mockImplementation(() => {
            throw foreignFailure(TypeError);
          });
          const ended = vi.spyOn(decisionBreakers(), "onAttemptEnd");
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST()).then((error) => {
            expect(ended).toHaveBeenCalledTimes(1);
            return error;
          });
        },
        fault: "internal",
        type: DecisionClientFaultError,
        dispatches: 1,
        consecutiveFailures: 0,
        says: ["The decision client failed while recording how the call ended", "it raised TypeError."],
        also: (error) => {
          expect(asInstance(error, DecisionClientFaultError).stage).toBe("recording");
          // The vendor answered and billed; the record of the attempt keeps both.
          expect(error.status).toBe(OK);
          expect(error.attempt?.usage?.prompt_tokens).toBe(DOCUMENTED_INPUT_TOKENS);
        },
      },
      {
        source: "the breaker registry, raising while it is told of a failure",
        reject: () => {
          wire(() => {
            throw serverFailure();
          });
          vi.spyOn(decisionBreakers(), "onFailure").mockImplementation(() => {
            throw foreignFailure(TypeError);
          });
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST());
        },
        fault: "internal",
        type: DecisionClientFaultError,
        dispatches: 1,
        consecutiveFailures: 0,
        says: ["failed while recording how the call ended", "it raised TypeError."],
        also: (error) => {
          expect(asInstance(error, DecisionClientFaultError).stage).toBe("recording");
        },
      },
      {
        source: "the caller, aborting a dispatched call with a reason of its own",
        reject: async () => {
          wire(heldUntilAborted);
          const caller = new AbortController();
          const reason = { said: QUOTED_REQUEST_TEXT };
          const pending = rejected(HOSTED_ROUTE, CHOICE_REQUEST(), { signal: caller.signal });
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
          caller.abort(reason);
          const error = await pending;
          expect(error).not.toBe(reason);
          expect(dispatched.calls[0].signal.reason).toBe(error);
          return error;
        },
        fault: "timeout",
        type: DecisionTimeoutError,
        dispatches: 1,
        consecutiveFailures: 0,
        says: ["was aborted by the caller's signal after dispatch"],
        also: (error) => {
          expect(asInstance(error, DecisionTimeoutError).source).toBe("caller_signal");
          expect(error.cause).toBeUndefined();
        },
      },
      {
        source: "the caller, already gone, with no reason at all",
        reject: () => {
          wire(answers);
          const caller = new AbortController();
          caller.abort(null);
          return rejected(HOSTED_ROUTE, CHOICE_REQUEST(), { signal: caller.signal });
        },
        fault: "admission",
        type: DecisionAdmissionError,
        dispatches: 0,
        consecutiveFailures: 0,
        says: ["caller_signal", "the vendor was never contacted"],
        also: (error) => {
          expect(error.cause).toBeUndefined();
        },
      },
    ];

    it.each(rows)("gives $source a fault and the record of the attempt", async (row) => {
      const raised = await row.reject();

      const error = asInstance(asCallError(raised), row.type);
      expect(error.fault).toBe(row.fault);
      expect(DECISION_FAULTS).toContain(error.fault);
      expect(Object.keys(error)).toContain("fault");
      expect(error.attempt?.outcome).toBe("fault");
      expect(error.attempt?.fault).toBe(error.fault);
      expect(error.attempt?.route).toBe(error.route);
      const providerUnknown = error.fault === "unavailable" || row.providerUnknown === true;
      expect(error.attempt?.provider ?? null).toBe(providerUnknown ? null : provider);
      // A defect on this side is never the vendor's fault, by class or by name.
      if (error.fault === "internal") {
        expect(error).not.toBeInstanceOf(DecisionTransportError);
      }
      for (const text of row.says) {
        expect(error.message).toContain(text);
      }
      row.also?.(error);
      // A failure is described by its class and code. Its own words, which
      // can quote the request, appear nowhere on what is raised.
      expect(showsText(error, QUOTED_REQUEST_TEXT)).toBe(false);
      expect(showsText(error, SENTINEL_KEY)).toBe(false);
      expect(dispatched.calls).toHaveLength(row.dispatches);
      vi.restoreAllMocks();
      expect(decisionBreakers().snapshot(breakerKey).consecutiveFailures).toBe(row.consecutiveFailures);
      expect(guardOf(provider)?.inFlight ?? 0).toBe(0);
    });

    it("never rejects with the reason a caller aborted with, whatever that reason is", async () => {
      const reasons: readonly unknown[] = [
        new Error(QUOTED_REQUEST_TEXT),
        new DOMException(QUOTED_REQUEST_TEXT, "AbortError"),
        QUOTED_REQUEST_TEXT,
        { said: QUOTED_REQUEST_TEXT },
        null,
        undefined,
      ];
      for (const reason of reasons) {
        const harness = clientOverTransport(heldUntilAborted);
        const caller = new AbortController();
        const pending = rejectionOf(ask({ signal: caller.signal }));
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        caller.abort(reason);

        const error = asInstance(await pending, DecisionTimeoutError);

        expect(error.source).toBe("caller_signal");
        expect(error.fault).toBe("timeout");
        expect(error.cause).toBeUndefined();
        expect(error.attempt).toMatchObject({ outcome: "fault", fault: "timeout", route: HOSTED_ROUTE });
        expect(showsText(error, QUOTED_REQUEST_TEXT)).toBe(false);
        // The transport is ended with the error the caller receives, and that
        // is the one object both hold: the caller's own reason is neither.
        expect(harness.double.calls[0].signal.reason).toBe(error);
        expect(error === reason).toBe(false);
        expect(decisionBreakers().snapshot(breakerKey).consecutiveFailures).toBe(0);
      }
    });

    it("reads each option once, so the deadline that runs is the deadline that was checked", async () => {
      vi.useFakeTimers();
      const harness = clientOverTransport(heldUntilAborted);
      let reads = 0;
      const options = {
        get timeoutMs(): number {
          reads += 1;
          return reads === 1 ? NARROWING_TIMEOUT_MS : Number.NaN;
        },
      };

      const outcome = watch(ask(options));
      await vi.advanceTimersByTimeAsync(NARROWING_TIMEOUT_MS - 1);
      expect(outcome()).toBe(PENDING);
      await vi.advanceTimersByTimeAsync(1);

      expect(reads).toBe(1);
      expect(asInstance(outcome(), DecisionTimeoutError).budgetMs).toBe(NARROWING_TIMEOUT_MS);
      expect(harness.double.calls).toHaveLength(1);
    });

    /** Ways telling the breaker how a call ended can fail while the call holds a half-open route's one probe. */
    const recordingFailures: readonly {
      readonly label: string;
      readonly outcome: "fails" | "answers";
      readonly breaks: (registry: ReturnType<typeof decisionBreakers>, breakClock: (broken: boolean) => void) => void;
    }[] = [
      {
        label: "the clock fails while the breaker is told of a failure",
        outcome: "fails",
        breaks: (registry, breakClock) => {
          const tell = registry.onFailure.bind(registry);
          vi.spyOn(registry, "onFailure").mockImplementation((key, kind) => {
            breakClock(true);
            try {
              tell(key, kind);
            } finally {
              breakClock(false);
            }
          });
        },
      },
      {
        label: "the breaker raises while it is told of a failure",
        outcome: "fails",
        breaks: (registry) => {
          vi.spyOn(registry, "onFailure").mockImplementation(() => {
            throw new RangeError("the breaker could not be told");
          });
        },
      },
      {
        label: "the breaker raises while it is told of an answer",
        outcome: "answers",
        breaks: (registry) => {
          vi.spyOn(registry, "onSuccess").mockImplementation(() => {
            throw new RangeError("the breaker could not be told");
          });
        },
      },
    ];

    it.each(recordingFailures)(
      "gives back a half-open route's probe slot when $label, so the route admits a new probe afterwards",
      async ({ outcome, breaks }) => {
        const table = admittedDecisionRouteTable();
        const breaker = table.defaults.circuit_breaker;
        expect(breaker.half_open_probes).toBe(1);
        let nowMs = NOW_MS;
        let clockBroken = false;
        let probing = false;
        const double = createDecisionTransportDouble((call) => {
          if (call.index < breaker.failure_threshold || (probing && outcome === "fails")) {
            throw serverFailure();
          }
          return scriptedAnswer(call.route, CHOICE_ANSWER());
        });
        configureDecisionClient({
          routeTable: table,
          transport: double.transport,
          now: () => {
            if (clockBroken) {
              throw new TypeError("the clock failed");
            }
            return nowMs;
          },
        });
        for (let failure = 0; failure < breaker.failure_threshold; failure += 1) {
          await rejectionOf(ask());
        }
        nowMs += breaker.cooldown_ms;
        expect(decisionBreakers().stateOf(breakerKey)).toBe("half-open");

        probing = true;
        breaks(decisionBreakers(), (broken) => {
          clockBroken = broken;
        });
        const failed = asInstance(await rejectionOf(ask()), DecisionClientFaultError);
        expect(failed.stage).toBe("recording");
        expect(double.calls).toHaveLength(breaker.failure_threshold + 1);
        vi.restoreAllMocks();
        probing = false;

        expect(decisionBreakers().snapshot(breakerKey).probesInFlight).toBe(0);
        // The route is not shut: a later call is admitted, and once the cooldown
        // that a counted failure re-opens has run, the probe it makes is let through.
        nowMs += breaker.cooldown_ms;
        const result = await ask();
        expect(result.answers.department.type).toBe("choice");
        expect(double.calls).toHaveLength(breaker.failure_threshold + 2);
      },
    );

    it("gives back the probe slot of an attempt that fails before it is dispatched", async () => {
      vi.useFakeTimers();
      const table = admittedDecisionRouteTable();
      const breaker = table.defaults.circuit_breaker;
      let clockBroken = false;
      const double = createDecisionTransportDouble((call) => {
        if (call.index < breaker.failure_threshold) {
          throw serverFailure();
        }
        return scriptedAnswer(call.route, CHOICE_ANSWER());
      });
      configureDecisionClient({
        routeTable: table,
        transport: double.transport,
        now: () => {
          if (clockBroken) {
            throw new TypeError("the clock failed");
          }
          return Date.now();
        },
      });
      for (let failure = 0; failure < breaker.failure_threshold; failure += 1) {
        await rejectionOf(ask());
      }
      expect(decisionBreakers().stateOf(breakerKey)).toBe("open");
      vi.advanceTimersByTime(breaker.cooldown_ms);
      expect(decisionBreakers().stateOf(breakerKey)).toBe("half-open");

      // The clock fails once the attempt has taken the route's one probe slot.
      const registry = decisionBreakers();
      const startAttempt = registry.onAttemptStart.bind(registry);
      const started = vi.spyOn(registry, "onAttemptStart").mockImplementation((key) => {
        const holdsProbe = startAttempt(key);
        clockBroken = true;
        return holdsProbe;
      });
      const failed = asInstance(await rejectionOf(ask()), DecisionClientFaultError);
      expect(started).toHaveReturnedWith(true);
      expect(failed.stage).toBe("admitting");
      expect(failed.message).toContain("failed before any request was made");
      clockBroken = false;
      started.mockRestore();

      expect(decisionBreakers().snapshot(breakerKey).probesInFlight).toBe(0);
      expect(double.calls).toHaveLength(breaker.failure_threshold);
      const result = await ask();
      expect(result.answers.department.type).toBe("choice");
      expect(decisionBreakers().stateOf(breakerKey)).toBe("closed");
    });
  });
});
