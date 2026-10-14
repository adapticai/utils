/**
 * The typed errors a decision call rejects with.
 *
 * A consumer in another package decides what to do with a failed decision call
 * from one literal, `fault`, read off the error as data. It cannot use
 * `instanceof`: two installed copies of this package have two distinct classes
 * of the same name. So the tests pin what that literal depends on: every class
 * carries exactly one member of the closed vocabulary, and the member is an own
 * enumerable property that survives a structural read.
 *
 * They also pin what a journal row written from an error depends on. Text that
 * came from outside this package is a bounded excerpt with no control
 * characters wherever an error or its attempt record carries it, a value nobody
 * measured is `null` however the error was built, and an attempt record states
 * no fact differently from the error it belongs to.
 */

import { describe, expect, it } from "vitest";

import {
  DECISION_ERROR_BODY_EXCERPT,
  DECISION_CLIENT_FAULT_STAGES,
  DECISION_FAULTS,
  DECISION_UNAVAILABLE_CODES,
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
import type { DecisionFault } from "../../../llm/decision/errors";
import type { DecisionRouteAdmission, DecisionRouteTable } from "../../../llm/decision/route-types";
import { DECISION_ROUTES } from "../../../llm/decision/types";
import type { DecisionAttemptMeasurement } from "../../../llm/decision/types";
import type { LlmUsageRecord } from "../../../llm/types";

/** The route the constructed errors name. */
const ROUTE = "dm.hosted";

/** A provider name, as a route table would declare it. */
const PROVIDER = "decision-vendor";

/** A model pin, as a route table would declare it. */
const MODEL_PIN = "pinned-model-1.0.0";

/** A model a vendor reports answering with that is not the pin. */
const OTHER_MODEL = "pinned-model-1.1.0";

/** A vendor request id, in the form a response header carries one. */
const REQUEST_ID = "req_0123456789abcdef";

/** The budget a route gives one call, in milliseconds. */
const BUDGET_MS = 1_500;

/** A retry hint a vendor returned, in milliseconds. */
const RETRY_AFTER_MS = 30_000;

/** Length of a vendor body far past the excerpt bound. */
const LONG_BODY_CHARS = 5_000;

/**
 * A character the composed messages never use themselves, so every occurrence
 * in a message is body text and can be counted.
 */
const BODY_FILL = "§";

/**
 * What an excerpt never carries: control characters, invisible format
 * characters (direction overrides, zero-width marks), line and paragraph
 * separators, and unpaired surrogates. Written here independently of the
 * module, so the test does not inherit the module's idea of the set.
 */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;

/** What stands where an excerpt dropped a character. */
const REPLACEMENT = "\uFFFD";

/**
 * One of each kind of character an excerpt must not carry: a NUL, the three
 * line controls, a terminal colour sequence, DEL, a C1 control, the line and
 * paragraph separators, a right-to-left override, a zero-width space, a byte
 * order mark and an unpaired surrogate.
 */
const HOSTILE_PREFIX = "\u0000\n\r\t\u001b[31m\u007f\u0085\u2028\u2029\u202e\u200b\ufeff\ud83d";

/** Text as an untrusted peer could send it: unprintable characters, then far more than the bound. */
const HOSTILE_TEXT = HOSTILE_PREFIX + BODY_FILL.repeat(LONG_BODY_CHARS);

/** How many filler characters one excerpt of {@link HOSTILE_TEXT} holds. */
const HOSTILE_EXCERPT_FILL = DECISION_ERROR_BODY_EXCERPT - HOSTILE_PREFIX.length;

/** What a vendor billed for an answer that was then rejected. */
const BILLED_USAGE: LlmUsageRecord = {
  prompt_tokens: 318,
  completion_tokens: 34,
  provider: PROVIDER,
  model: MODEL_PIN,
  cost: 0.000013356,
};

/** One row of the class table: how to build the error and what it must say. */
interface ErrorCase {
  readonly className: string;
  readonly fault: DecisionFault;
  readonly build: () => DecisionCallError;
}

/** Every error class, built the way its raiser builds it. */
const ERROR_CASES: readonly ErrorCase[] = [
  {
    className: "DecisionRouteUnavailableError",
    fault: "unavailable",
    build: () =>
      new DecisionRouteUnavailableError({
        route: ROUTE,
        code: "route_not_admitted",
        reason: "provider account is pending-onboarding",
      }),
  },
  {
    className: "DecisionRequestInvalidError",
    fault: "schema",
    build: () =>
      new DecisionRequestInvalidError({
        source: "request_validation",
        fieldPath: "questions.department.criteria",
        reason: "a choice needs at least one option",
      }),
  },
  {
    className: "DecisionAdmissionError",
    fault: "admission",
    build: () => new DecisionAdmissionError({ route: ROUTE, source: "provider_guard", budgetMs: BUDGET_MS }),
  },
  {
    className: "DecisionCredentialError",
    fault: "credential",
    build: () => new DecisionCredentialError({ source: "key_unset", apiKeyEnv: "DECISION_VENDOR_API_KEY" }),
  },
  {
    className: "DecisionTransportError",
    fault: "transport",
    build: () =>
      new DecisionTransportError({
        source: "status",
        status: 529,
        retryable: true,
        retryAfterMs: RETRY_AFTER_MS,
        body: "overloaded",
        vendorErrorType: null,
        vendorRequestId: REQUEST_ID,
      }),
  },
  {
    className: "DecisionTimeoutError",
    fault: "timeout",
    build: () => new DecisionTimeoutError({ route: ROUTE, source: "route_budget", budgetMs: BUDGET_MS }),
  },
  {
    className: "DecisionResponseFormatError",
    fault: "schema",
    build: () =>
      new DecisionResponseFormatError({
        fieldPath: "answers.department.probabilities",
        reason: "keys differ from the requested options",
        status: 200,
        usage: BILLED_USAGE,
        vendorRequestId: REQUEST_ID,
      }),
  },
  {
    className: "DecisionRouteMismatchError",
    fault: "route_mismatch",
    build: () =>
      new DecisionRouteMismatchError({
        route: ROUTE,
        expectedServedModel: MODEL_PIN,
        servedModel: OTHER_MODEL,
        status: 200,
        usage: BILLED_USAGE,
        vendorRequestId: REQUEST_ID,
      }),
  },
  {
    className: "DecisionClientFaultError",
    fault: "internal",
    build: () =>
      new DecisionClientFaultError({ route: ROUTE, stage: "admitting", description: "TypeError ERR_INVALID_STATE" }),
  },
];

/** What only the client measures about an attempt that ended in a fault. */
const MEASURED: DecisionAttemptMeasurement = {
  route: ROUTE,
  provider: PROVIDER,
  modelPin: MODEL_PIN,
  status: 200,
  queueMs: 3,
  durationMs: 412,
  budgetMs: BUDGET_MS,
  retryAfterMs: null,
  vendorRequestId: REQUEST_ID,
  servedModel: MODEL_PIN,
  usage: BILLED_USAGE,
  correlationId: "cycle-7:ABC",
};

/** A second usage record, equal to {@link BILLED_USAGE} in no field a comparison could confuse. */
const MEASURED_USAGE: LlmUsageRecord = {
  prompt_tokens: 7,
  completion_tokens: 1,
  provider: PROVIDER,
  model: MODEL_PIN,
  cost: null,
};

/**
 * A measurement that differs from what every constructed error states, in every
 * fact an error can state. An attempt record that took a fact from here when
 * its error states the same fact would be caught disagreeing with it.
 */
const DISAGREEING: DecisionAttemptMeasurement = {
  route: "dm.local",
  provider: "measured-provider",
  modelPin: "measured-pin-9.9.9",
  status: 418,
  queueMs: 5,
  durationMs: 77,
  budgetMs: 700,
  retryAfterMs: 7,
  vendorRequestId: "req_measured",
  servedModel: "measured-model-9.9.9",
  usage: MEASURED_USAGE,
  correlationId: "cycle-8:XYZ",
};

/** A measurement in which nothing that can go unmeasured was measured. */
const UNMEASURED: DecisionAttemptMeasurement = {
  route: ROUTE,
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
  correlationId: null,
};

/** The facts every error and its attempt record both state. */
const BASE_SHARED_FACTS: readonly string[] = ["fault", "route", "status", "retryAfterMs", "vendorRequestId", "usage"];

/** The facts a class states beyond the base that its attempt record states too. */
const CLASS_SHARED_FACTS: Readonly<Record<string, readonly string[]>> = {
  DecisionAdmissionError: ["budgetMs"],
  DecisionTimeoutError: ["budgetMs"],
  DecisionRouteMismatchError: ["servedModel"],
};

/** One way to build an error from inputs in which everything that can be absent is. */
interface AbsentCase {
  readonly label: string;
  readonly build: () => DecisionCallError;
  /** The own fields that must read `null`, before the error is completed and after. */
  readonly nullFields: readonly string[];
}

/**
 * Every construction path, given `null` wherever its inputs admit one. The
 * fields listed are the ones the path either hard-codes as absent or passes
 * through from an absent input; both must reach the consumer as `null`.
 */
const ABSENT_CASES: readonly AbsentCase[] = [
  {
    label: "unavailable",
    build: () => new DecisionRouteUnavailableError({ route: ROUTE, code: "breaker_open", reason: "open" }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage"],
  },
  {
    label: "request refused here",
    build: () =>
      new DecisionRequestInvalidError({ source: "request_validation", fieldPath: "state", reason: "state is null" }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage", "bodyExcerpt", "vendorErrorType"],
  },
  {
    label: "request refused by the vendor",
    build: () =>
      new DecisionRequestInvalidError({
        source: "vendor_rejected",
        status: 422,
        body: "",
        vendorErrorType: null,
        vendorRequestId: null,
      }),
    nullFields: ["retryAfterMs", "vendorRequestId", "usage", "fieldPath", "vendorErrorType"],
  },
  {
    label: "admission",
    build: () => new DecisionAdmissionError({ route: ROUTE, source: "route_budget", budgetMs: BUDGET_MS }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage"],
  },
  {
    label: "key unset",
    build: () => new DecisionCredentialError({ source: "key_unset", apiKeyEnv: "DECISION_VENDOR_API_KEY" }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage", "bodyExcerpt", "vendorErrorType"],
  },
  {
    label: "key unusable",
    build: () => new DecisionCredentialError({ source: "key_unusable", apiKeyEnv: "DECISION_VENDOR_API_KEY" }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage", "bodyExcerpt", "vendorErrorType"],
  },
  {
    label: "key rejected by the vendor",
    build: () =>
      new DecisionCredentialError({
        source: "vendor_rejected",
        status: 401,
        body: "",
        vendorErrorType: null,
        vendorRequestId: null,
      }),
    nullFields: ["retryAfterMs", "vendorRequestId", "usage", "apiKeyEnv", "vendorErrorType"],
  },
  {
    label: "failing status with no retry hint",
    build: () =>
      new DecisionTransportError({
        source: "status",
        status: 529,
        retryable: true,
        retryAfterMs: null,
        body: "",
        vendorErrorType: null,
        vendorRequestId: null,
      }),
    nullFields: ["retryAfterMs", "vendorRequestId", "usage", "vendorErrorType"],
  },
  {
    label: "network failure",
    build: () => new DecisionTransportError({ source: "network", retryable: true, detail: "socket hang up" }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage", "bodyExcerpt", "vendorErrorType"],
  },
  {
    label: "timeout",
    build: () => new DecisionTimeoutError({ route: ROUTE, source: "route_budget", budgetMs: BUDGET_MS }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage"],
  },
  {
    label: "malformed answer",
    build: () =>
      new DecisionResponseFormatError({
        fieldPath: "$",
        reason: "not an object",
        status: null,
        usage: null,
        vendorRequestId: null,
      }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage"],
  },
  {
    label: "route mismatch",
    build: () =>
      new DecisionRouteMismatchError({
        route: ROUTE,
        expectedServedModel: MODEL_PIN,
        servedModel: OTHER_MODEL,
        status: null,
        usage: null,
        vendorRequestId: null,
      }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage"],
  },
  {
    label: "client fault",
    build: () => new DecisionClientFaultError({ route: ROUTE, stage: "recording", description: "RangeError" }),
    nullFields: ["status", "retryAfterMs", "vendorRequestId", "usage"],
  },
];

/** One way to build an error from text an untrusted peer controls. */
interface HostileCase {
  readonly label: string;
  /** Builds the error with `text` in every input that carries text from outside this package. */
  readonly build: (text: string) => DecisionCallError;
  /** How many of the error's own fields carry an excerpt of the text. */
  readonly carried: number;
  /** How many excerpts of the text its message quotes. */
  readonly quoted: number;
  /**
   * How many fields carry an excerpt once the error is completed with a
   * measurement whose request id and served model are the text too: the
   * attempt record's two, and the error's own request id where the raising
   * layer read none.
   */
  readonly carriedOnceCompleted: number;
}

/** Every construction path that accepts text from a vendor, a lower layer or a route table. */
const HOSTILE_CASES: readonly HostileCase[] = [
  {
    label: "unavailable",
    build: (text) => new DecisionRouteUnavailableError({ route: ROUTE, code: "route_not_admitted", reason: text }),
    carried: 1,
    quoted: 1,
    carriedOnceCompleted: 4,
  },
  {
    label: "request refused here",
    build: (text) => new DecisionRequestInvalidError({ source: "request_validation", fieldPath: text, reason: text }),
    carried: 1,
    quoted: 2,
    carriedOnceCompleted: 4,
  },
  {
    label: "request refused by the vendor",
    build: (text) =>
      new DecisionRequestInvalidError({
        source: "vendor_rejected",
        status: 422,
        body: text,
        vendorErrorType: text,
        vendorRequestId: text,
      }),
    carried: 3,
    quoted: 1,
    carriedOnceCompleted: 5,
  },
  {
    label: "admission",
    build: () => new DecisionAdmissionError({ route: ROUTE, source: "provider_guard", budgetMs: BUDGET_MS }),
    carried: 0,
    quoted: 0,
    carriedOnceCompleted: 3,
  },
  {
    // The variable's name is this package's own, from the route table, and is
    // carried as given; no text from outside reaches either key path.
    label: "key unset",
    build: () => new DecisionCredentialError({ source: "key_unset", apiKeyEnv: "DECISION_VENDOR_API_KEY" }),
    carried: 0,
    quoted: 0,
    carriedOnceCompleted: 3,
  },
  {
    label: "key unusable",
    build: () => new DecisionCredentialError({ source: "key_unusable", apiKeyEnv: "DECISION_VENDOR_API_KEY" }),
    carried: 0,
    quoted: 0,
    carriedOnceCompleted: 3,
  },
  {
    label: "key rejected by the vendor",
    build: (text) =>
      new DecisionCredentialError({
        source: "vendor_rejected",
        status: 403,
        body: text,
        vendorErrorType: text,
        vendorRequestId: text,
      }),
    carried: 3,
    quoted: 1,
    carriedOnceCompleted: 5,
  },
  {
    label: "failing status",
    build: (text) =>
      new DecisionTransportError({
        source: "status",
        status: 500,
        retryable: true,
        retryAfterMs: null,
        body: text,
        vendorErrorType: text,
        vendorRequestId: text,
      }),
    carried: 3,
    quoted: 1,
    carriedOnceCompleted: 5,
  },
  {
    label: "network failure",
    build: (text) => new DecisionTransportError({ source: "network", retryable: true, detail: text }),
    carried: 0,
    quoted: 1,
    carriedOnceCompleted: 3,
  },
  {
    label: "timeout",
    build: () => new DecisionTimeoutError({ route: ROUTE, source: "route_budget", budgetMs: BUDGET_MS }),
    carried: 0,
    quoted: 0,
    carriedOnceCompleted: 3,
  },
  {
    label: "malformed answer",
    build: (text) =>
      new DecisionResponseFormatError({
        fieldPath: text,
        reason: text,
        status: 200,
        usage: BILLED_USAGE,
        vendorRequestId: text,
      }),
    carried: 2,
    quoted: 2,
    carriedOnceCompleted: 4,
  },
  {
    label: "route mismatch",
    build: (text) =>
      new DecisionRouteMismatchError({
        route: ROUTE,
        expectedServedModel: MODEL_PIN,
        servedModel: text,
        status: 200,
        usage: BILLED_USAGE,
        vendorRequestId: text,
      }),
    carried: 2,
    quoted: 1,
    carriedOnceCompleted: 4,
  },
  {
    // A description is built from identifiers a runtime assigns, and is still
    // bounded like any text this package did not write.
    label: "client fault",
    build: (text) => new DecisionClientFaultError({ route: ROUTE, stage: "resolving", description: text }),
    carried: 1,
    quoted: 1,
    carriedOnceCompleted: 4,
  },
];

/**
 * Every construction path, as a row of the class table: each path of
 * {@link ABSENT_CASES} beside the one {@link ERROR_CASES} builds per class. A
 * rule stated for every error is checked over these, so a path added to a
 * class is held to it without being added in a third place.
 */
const CONSTRUCTION_PATHS: readonly ErrorCase[] = [
  ...ERROR_CASES,
  ...ABSENT_CASES.map((row): ErrorCase => {
    const built = row.build();
    return { className: `${built.name} (${row.label})`, fault: built.fault, build: row.build };
  }),
];

/**
 * A route table in the shape the package declares: one route this package
 * serves over HTTP and one the consumer serves itself.
 */
const ROUTE_TABLE: DecisionRouteTable = {
  schema_version: 1,
  policy_source: "test",
  defaults: {
    circuit_breaker: { failure_threshold: 5, cooldown_ms: 60_000, capacity_cooldown_ms: 15_000, half_open_probes: 1 },
  },
  providers: {
    [PROVIDER]: {
      api_style: "systemone",
      base_url: "https://decision-vendor.invalid",
      base_url_env: "DECISION_VENDOR_BASE_URL",
      api_key_env: "DECISION_VENDOR_API_KEY",
      secret_path: "llm/decision-vendor/apiKey",
      account_status: "pending-onboarding",
    },
    "engine-judge": { api_style: "engine-judge", account_status: "pending-onboarding" },
  },
  routes: {
    "dm.hosted": {
      provider: PROVIDER,
      served_by: "utils",
      response_kind: "typed-distribution",
      version_pin: MODEL_PIN,
      expected_served_model: MODEL_PIN,
      model_id_status: "confirmed",
      contract_evidence: "documentation",
      contract_verified: null,
      budget_ms: BUDGET_MS,
      caps: { max_options: 255, max_score_levels: 10, max_questions: null },
      max_state_tokens: 32_000,
      max_state_tokens_basis: "vendor-documented-ceiling",
      price_per_mtok: { input: 0.042, output: 0, as_of: "2026-10-01" },
    },
    "dm.local": {
      provider: "engine-judge",
      served_by: "engine",
      response_kind: "typed-distribution",
      checkpoint: "english",
      package_version: "0.3.22",
      revision: "0123456789abcdef0123456789abcdef01234567",
      artifact_sha256: null,
      pin_status: "pending-artifact-digests",
      budget_ms: 1_000,
      caps: { max_options: 20, max_score_levels: 32, max_questions: 64 },
      max_state_tokens: 320,
      max_state_tokens_basis: "checkpoint-window",
      price_per_mtok: null,
    },
  },
};

/**
 * Count occurrences of one character.
 *
 * @param text The text to search.
 * @param character The single character to count.
 * @returns How many times it occurs.
 */
function countOf(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * Read an object's own enumerable properties, which is all a consumer holding
 * another copy of the package, or a serialised error, can read.
 *
 * @param value The error, attempt record or measurement.
 * @returns Its own enumerable properties by name.
 */
function ownFacts(value: object): Readonly<Record<string, unknown>> {
  return { ...value };
}

/**
 * Collect every string a parsed JSON value holds, at any depth.
 *
 * @param value The parsed value.
 * @returns Each string value found. Object keys are not values and are not collected.
 */
function stringsIn(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const members: readonly unknown[] = Object.values(value);
  return members.flatMap(stringsIn);
}

/**
 * Assert that an error, serialised the way a journal or a log serialises it,
 * carries text from outside this package only as bounded, printable excerpts.
 *
 * @param error The error under test.
 * @param carried How many serialised fields should hold an excerpt of {@link HOSTILE_TEXT}.
 * @param quoted How many excerpts of it the message should quote.
 * @param label Names the case in a failure.
 */
function expectOnlyExcerpts(error: DecisionCallError, carried: number, quoted: number, label: string): void {
  const serialised = JSON.stringify(error);
  const parsed: unknown = JSON.parse(serialised);
  for (const text of [...stringsIn(parsed), error.message]) {
    expect(UNPRINTABLE.test(text), `${label}: ${JSON.stringify(text.slice(0, 40))}`).toBe(false);
  }
  for (const text of stringsIn(parsed)) {
    expect(text.length, `${label}: ${JSON.stringify(text.slice(0, 40))}`).toBeLessThanOrEqual(
      DECISION_ERROR_BODY_EXCERPT,
    );
  }
  expect(countOf(serialised, BODY_FILL), `${label}: serialised`).toBe(carried * HOSTILE_EXCERPT_FILL);
  expect(countOf(error.message, BODY_FILL), `${label}: message`).toBe(quoted * HOSTILE_EXCERPT_FILL);
}

describe("decision call errors", () => {
  it("every error class carries exactly one fault from the closed vocabulary", () => {
    expect([...DECISION_FAULTS]).toEqual([
      "timeout",
      "admission",
      "transport",
      "schema",
      "credential",
      "route_mismatch",
      "unavailable",
      "internal",
    ]);
    expect(ERROR_CASES).toHaveLength(9);
    expect(new Set(ERROR_CASES.map((row) => row.className)).size).toBe(9);

    for (const row of ERROR_CASES) {
      const error = row.build();
      expect(error, row.className).toBeInstanceOf(DecisionCallError);
      expect(error, row.className).toBeInstanceOf(Error);
      expect(error.name, row.className).toBe(row.className);
      expect(error.constructor.name, row.className).toBe(row.className);
      expect(error.fault, row.className).toBe(row.fault);
      expect(DECISION_FAULTS, row.className).toContain(error.fault);
      expect(error.message.length, row.className).toBeGreaterThan(0);
    }

    // Every member of the vocabulary is produced by some class, so the list
    // holds no fault a consumer could wait for and never receive.
    expect(new Set(ERROR_CASES.map((row) => row.build().fault))).toEqual(new Set(DECISION_FAULTS));
  });

  it("the fault is an own enumerable property", () => {
    for (const row of ERROR_CASES) {
      const error = row.build();
      const keys = Object.keys(error);
      for (const field of ["fault", "route", "status", "retryAfterMs", "vendorRequestId", "usage", "attempt"]) {
        expect(keys, `${row.className}.${field}`).toContain(field);
      }
      // The structural read a consumer in another package copy performs.
      const structural: { readonly fault?: unknown } = { ...error };
      expect(structural.fault, row.className).toBe(row.fault);
      const serialised: unknown = JSON.parse(JSON.stringify(error));
      expect(serialised, row.className).toMatchObject({ fault: row.fault });
    }
  });

  it("a body excerpt is bounded", () => {
    expect(DECISION_ERROR_BODY_EXCERPT).toBe(400);
    const body = BODY_FILL.repeat(LONG_BODY_CHARS);

    const bodied = [
      new DecisionCredentialError({
        source: "vendor_rejected",
        status: 403,
        body,
        vendorErrorType: "authentication_error",
        vendorRequestId: REQUEST_ID,
      }),
      new DecisionRequestInvalidError({
        source: "vendor_rejected",
        status: 422,
        body,
        vendorErrorType: null,
        vendorRequestId: REQUEST_ID,
      }),
      new DecisionTransportError({
        source: "status",
        status: 500,
        retryable: true,
        retryAfterMs: null,
        body,
        vendorErrorType: null,
        vendorRequestId: null,
      }),
    ];
    for (const error of bodied) {
      expect(error.bodyExcerpt, error.name).toBe(BODY_FILL.repeat(DECISION_ERROR_BODY_EXCERPT));
      expect(countOf(error.message, BODY_FILL), error.name).toBe(DECISION_ERROR_BODY_EXCERPT);
      expect(countOf(JSON.stringify(error), BODY_FILL), error.name).toBe(DECISION_ERROR_BODY_EXCERPT);
    }

    // Free text that reaches a message from below the client is bounded by the
    // same rule: a network failure's detail, a validation reason that may quote
    // a vendor key, and the model name a vendor reports.
    const network = new DecisionTransportError({ source: "network", retryable: true, detail: body });
    expect(network.bodyExcerpt).toBeNull();
    expect(countOf(network.message, BODY_FILL)).toBe(DECISION_ERROR_BODY_EXCERPT);

    const format = new DecisionResponseFormatError({
      fieldPath: "answers",
      reason: body,
      status: 200,
      usage: null,
      vendorRequestId: null,
    });
    expect(countOf(format.message, BODY_FILL)).toBe(DECISION_ERROR_BODY_EXCERPT);

    const mismatch = new DecisionRouteMismatchError({
      route: ROUTE,
      expectedServedModel: MODEL_PIN,
      servedModel: body,
      status: 200,
      usage: null,
      vendorRequestId: null,
    });
    expect(mismatch.servedModel).toBe(BODY_FILL.repeat(DECISION_ERROR_BODY_EXCERPT));
    expect(countOf(mismatch.message, BODY_FILL)).toBe(DECISION_ERROR_BODY_EXCERPT);

    // A body shorter than the bound is carried whole, and an absent one is
    // absent rather than an empty string.
    const short = new DecisionCredentialError({
      source: "vendor_rejected",
      status: 401,
      body: "denied",
      vendorErrorType: null,
      vendorRequestId: null,
    });
    expect(short.bodyExcerpt).toBe("denied");
    const unset = new DecisionCredentialError({ source: "key_unset", apiKeyEnv: "DECISION_VENDOR_API_KEY" });
    expect(unset.bodyExcerpt).toBeNull();
    expect(unset.status).toBeNull();
  });

  it("an excerpt holds no control character and no more than the bound", () => {
    expect(UNPRINTABLE.test(HOSTILE_PREFIX)).toBe(true);
    expect(HOSTILE_EXCERPT_FILL).toBeGreaterThan(0);

    // Each dropped character leaves one mark where it stood, so the shape of
    // what came back stays readable, and what is printable is left alone.
    expect(decisionErrorExcerpt("a\u0000b\nc\u001b[31md\u202ee")).toBe(
      `a${REPLACEMENT}b${REPLACEMENT}c${REPLACEMENT}[31md${REPLACEMENT}e`,
    );
    expect(decisionErrorExcerpt("req_01a0f845 \u00e9\u{1F600} {\"detail\":\"x\"}")).toBe(
      "req_01a0f845 \u00e9\u{1F600} {\"detail\":\"x\"}",
    );
    expect(decisionErrorExcerpt("")).toBe("");

    // A character the bound cuts in half is dropped, not left as half of one.
    const cut = decisionErrorExcerpt(`${"x".repeat(DECISION_ERROR_BODY_EXCERPT - 1)}\u{1F600}`);
    expect(cut).toBe(`${"x".repeat(DECISION_ERROR_BODY_EXCERPT - 1)}${REPLACEMENT}`);

    const excerpt = decisionErrorExcerpt(HOSTILE_TEXT);
    expect(excerpt).toHaveLength(DECISION_ERROR_BODY_EXCERPT);
    expect(UNPRINTABLE.test(excerpt)).toBe(false);
    expect(countOf(excerpt, BODY_FILL)).toBe(HOSTILE_EXCERPT_FILL);
  });

  it("every string an error or its attempt carries from outside this package is such an excerpt", () => {
    for (const row of HOSTILE_CASES) {
      const raised = row.build(HOSTILE_TEXT);
      expectOnlyExcerpts(raised, row.carried, row.quoted, `${row.label}, as raised`);

      // The client's measurement holds a vendor header and a vendor body field
      // of its own, and both reach the attempt record.
      const completed = row
        .build(HOSTILE_TEXT)
        .withAttempt({ ...MEASURED, vendorRequestId: HOSTILE_TEXT, servedModel: HOSTILE_TEXT });
      expectOnlyExcerpts(completed, row.carriedOnceCompleted, row.quoted, `${row.label}, completed`);
    }

    // Well-formed vendor values are carried exactly as they arrived: the
    // excerpt changes only what is oversized or unprintable.
    const ordinary = new DecisionTransportError({
      source: "status",
      status: 529,
      retryable: true,
      retryAfterMs: null,
      body: "{\"detail\":\"overloaded\"}",
      vendorErrorType: "overloaded_error",
      vendorRequestId: REQUEST_ID,
    }).withAttempt({ ...MEASURED, servedModel: OTHER_MODEL });
    expect(ordinary.bodyExcerpt).toBe("{\"detail\":\"overloaded\"}");
    expect(ordinary.vendorErrorType).toBe("overloaded_error");
    expect(ordinary.vendorRequestId).toBe(REQUEST_ID);
    expect(ordinary.attempt?.vendorRequestId).toBe(REQUEST_ID);
    expect(ordinary.attempt?.servedModel).toBe(OTHER_MODEL);
  });

  it("an unmeasured field is null and never a number", () => {
    const unmeasured = ownFacts(UNMEASURED);

    for (const row of ABSENT_CASES) {
      const error = row.build();
      const raised = ownFacts(error);
      expect(raised.attempt, row.label).toBeNull();
      for (const field of row.nullFields) {
        expect(raised[field], `${row.label}.${field}, as raised`).toBeNull();
      }

      // Completing the error with a measurement that measured nothing adds no
      // value either: the error keeps its nulls, and the attempt record holds
      // a value only where the error itself states that fact.
      error.withAttempt(UNMEASURED);
      const completed = ownFacts(error);
      for (const field of row.nullFields) {
        expect(completed[field], `${row.label}.${field}, completed`).toBeNull();
      }
      const attempt = error.attempt;
      expect(attempt, row.label).not.toBeNull();
      if (attempt === null) {
        continue;
      }
      const recorded = ownFacts(attempt);
      for (const fact of Object.keys(unmeasured)) {
        if (fact === "route") {
          continue;
        }
        expect(recorded[fact], `${row.label}.attempt.${fact}`).toEqual(completed[fact] ?? null);
      }
    }

    // An error raised below the client names no route until the client, which
    // alone knows it, completes the error.
    const invalid = new DecisionRequestInvalidError({
      source: "request_validation",
      fieldPath: "state",
      reason: "state is null",
    });
    expect(invalid.route).toBeNull();

    // Absent and zero are different readings and neither becomes the other: a
    // vendor that says "retry now" is carried as zero, and a zero the raising
    // layer read is not replaced by the client's measurement.
    const retryNow = new DecisionTransportError({
      source: "status",
      status: 429,
      retryable: true,
      retryAfterMs: 0,
      body: "",
      vendorErrorType: null,
      vendorRequestId: null,
    });
    expect(retryNow.retryAfterMs).toBe(0);
    retryNow.withAttempt({ ...MEASURED, retryAfterMs: RETRY_AFTER_MS, queueMs: 0, durationMs: 0 });
    expect(retryNow.retryAfterMs).toBe(0);
    expect(retryNow.attempt?.retryAfterMs).toBe(0);
    expect(retryNow.attempt?.queueMs).toBe(0);
    expect(retryNow.attempt?.durationMs).toBe(0);

    const hinted = new DecisionTransportError({
      source: "status",
      status: 429,
      retryable: true,
      retryAfterMs: RETRY_AFTER_MS,
      body: "",
      vendorErrorType: null,
      vendorRequestId: null,
    });
    expect(hinted.retryAfterMs).toBe(RETRY_AFTER_MS);
    expect(hinted.retryable).toBe(true);
    expect(hinted.status).toBe(429);
  });

  it("each class states why it was raised in a closed field of its own", () => {
    expect([...DECISION_UNAVAILABLE_CODES]).toEqual(["route_not_admitted", "engine_served", "breaker_open"]);
    for (const code of DECISION_UNAVAILABLE_CODES) {
      const error = new DecisionRouteUnavailableError({ route: "dm.local", code, reason: "stated" });
      expect(error.code).toBe(code);
      expect(error.reason).toBe("stated");
      expect(error.route).toBe("dm.local");
      expect(error.message).toContain(code);
    }

    const unset = new DecisionCredentialError({ source: "key_unset", apiKeyEnv: "DECISION_VENDOR_API_KEY" });
    expect(unset.source).toBe("key_unset");
    expect(unset.apiKeyEnv).toBe("DECISION_VENDOR_API_KEY");
    expect(unset.message).toContain("DECISION_VENDOR_API_KEY");
    // Word for word what an unset key has always said.
    expect(unset.message).toBe(
      "DECISION_VENDOR_API_KEY is unset, so a decision route cannot be authenticated against; no request was made",
    );

    const unusable = new DecisionCredentialError({
      source: "key_unusable",
      route: ROUTE,
      apiKeyEnv: "DECISION_VENDOR_API_KEY",
    });
    expect(unusable.source).toBe("key_unusable");
    expect(unusable.fault).toBe("credential");
    expect(unusable.apiKeyEnv).toBe("DECISION_VENDOR_API_KEY");
    expect(unusable.route).toBe(ROUTE);
    expect(unusable.status).toBeNull();
    expect(unusable.bodyExcerpt).toBeNull();
    // It names the variable and says that nothing was sent; it does not say
    // the variable is unset, which would send an operator to the wrong fix.
    expect(unusable.message).toBe(
      `DECISION_VENDOR_API_KEY holds a value that cannot be sent as a credential, so decision route ${ROUTE} ` +
        "cannot be authenticated against; no request was made",
    );
    expect(unusable.message).not.toContain("unset");

    const rejected = new DecisionCredentialError({
      source: "vendor_rejected",
      status: 403,
      body: "{}",
      vendorErrorType: "authentication_error",
      vendorRequestId: REQUEST_ID,
    });
    expect(rejected.source).toBe("vendor_rejected");
    expect(rejected.apiKeyEnv).toBeNull();
    expect(rejected.status).toBe(403);
    expect(rejected.vendorErrorType).toBe("authentication_error");
    expect(rejected.vendorRequestId).toBe(REQUEST_ID);

    const vendorInvalid = new DecisionRequestInvalidError({
      source: "vendor_rejected",
      status: 422,
      body: "{}",
      vendorErrorType: null,
      vendorRequestId: REQUEST_ID,
    });
    expect(vendorInvalid.source).toBe("vendor_rejected");
    expect(vendorInvalid.fieldPath).toBeNull();
    expect(vendorInvalid.status).toBe(422);

    const network = new DecisionTransportError({ source: "network", retryable: true, detail: "socket hang up" });
    expect(network.source).toBe("network");
    expect(network.status).toBeNull();
    expect(network.retryable).toBe(true);
    expect(network.retryAfterMs).toBeNull();
    expect(network.vendorErrorType).toBeNull();
    const refused = new DecisionTransportError({ source: "network", retryable: false, detail: "refused" });
    expect(refused.retryable).toBe(false);

    const callerAbort = new DecisionTimeoutError({ route: ROUTE, source: "caller_signal", budgetMs: BUDGET_MS });
    expect(callerAbort.source).toBe("caller_signal");
    expect(callerAbort.budgetMs).toBe(BUDGET_MS);

    const format = new DecisionResponseFormatError({
      fieldPath: "answers.tone.confidence",
      reason: "not a finite number",
      status: 200,
      usage: BILLED_USAGE,
      vendorRequestId: REQUEST_ID,
    });
    expect(format.fieldPath).toBe("answers.tone.confidence");
    expect(format.usage).toEqual(BILLED_USAGE);
    expect(format.message).toContain("answers.tone.confidence");

    const mismatch = new DecisionRouteMismatchError({
      route: ROUTE,
      expectedServedModel: MODEL_PIN,
      servedModel: OTHER_MODEL,
      status: 200,
      usage: BILLED_USAGE,
      vendorRequestId: REQUEST_ID,
    });
    expect(mismatch.expectedServedModel).toBe(MODEL_PIN);
    expect(mismatch.servedModel).toBe(OTHER_MODEL);
    expect(mismatch.usage).toEqual(BILLED_USAGE);

    // A failure of the client's own machinery says at which stage, by what
    // class of failure, and that it is not the vendor's and not worth retrying.
    expect([...DECISION_CLIENT_FAULT_STAGES]).toEqual(["resolving", "admitting", "recording"]);
    const stageWords: Readonly<Record<(typeof DECISION_CLIENT_FAULT_STAGES)[number], string>> = {
      resolving: "while resolving the route",
      admitting: "before any request was made",
      recording: "while recording how the call ended",
    };
    for (const stage of DECISION_CLIENT_FAULT_STAGES) {
      const defect = new DecisionClientFaultError({ route: ROUTE, stage, description: "TypeError, caused by Error EPIPE" });
      expect(defect.fault).toBe("internal");
      expect(defect.stage).toBe(stage);
      expect(defect.description).toBe("TypeError, caused by Error EPIPE");
      expect(defect.retryable).toBe(false);
      expect(defect.route).toBe(ROUTE);
      expect(defect.status).toBeNull();
      expect(defect.message).toBe(
        `The decision client failed ${stageWords[stage]} on decision route ${ROUTE}: ` +
          "it raised TypeError, caused by Error EPIPE. " +
          "This is a defect of the client or of what it was wired with, and says nothing about the vendor",
      );
      expect(Object.keys(defect)).toEqual(expect.arrayContaining(["fault", "stage", "description", "retryable"]));
    }
    // It is not the transport fault: a consumer counting the vendor's failures
    // by fault or by class does not count this one.
    const defect = new DecisionClientFaultError({ route: ROUTE, stage: "admitting", description: "TypeError" });
    expect(defect).not.toBeInstanceOf(DecisionTransportError);
    expect(defect.fault).not.toBe("transport");
  });

  it("a route is declared in one of two shapes, and a refused route maps onto the unavailable error", () => {
    expect([...DECISION_ROUTES]).toEqual(["dm.hosted", "dm.local"]);
    expect(Object.keys(ROUTE_TABLE.routes).sort()).toEqual([...DECISION_ROUTES].sort());

    for (const route of DECISION_ROUTES) {
      const declaration = ROUTE_TABLE.routes[route];
      const provider = ROUTE_TABLE.providers[declaration.provider];
      if (declaration.served_by === "utils") {
        // Served here: pinned to a model id, with the state of its evidence declared.
        expect(declaration.version_pin).toBe(declaration.expected_served_model);
        expect(declaration.contract_evidence).toBe("documentation");
        expect(provider.api_style).toBe("systemone");
        expect("checkpoint" in declaration).toBe(false);
      } else {
        // Served by the consumer: pinned to a checkpoint, with no key and no URL here.
        expect(declaration.artifact_sha256).toBeNull();
        expect(declaration.pin_status).toBe("pending-artifact-digests");
        expect(provider.api_style).toBe("engine-judge");
        expect("api_key_env" in provider).toBe(false);
        expect("version_pin" in declaration).toBe(false);
      }
    }

    // The code an admission refusal carries is one the error accepts as it is,
    // so the reason a route is closed is decided once and never re-worded.
    const refusals: readonly DecisionRouteAdmission[] = [
      { admit: false, code: "engine_served", reason: "dm.local is served by the consumer's own process" },
      { admit: false, code: "route_not_admitted", reason: "provider account is pending-onboarding" },
      { admit: true },
    ];
    const raised = refusals.flatMap((admission) =>
      admission.admit
        ? []
        : [new DecisionRouteUnavailableError({ route: "dm.local", code: admission.code, reason: admission.reason })],
    );
    expect(raised.map((error) => error.code)).toEqual(["engine_served", "route_not_admitted"]);
    expect(raised.every((error) => error.fault === "unavailable")).toBe(true);
    expect(raised[1].message).toContain("pending-onboarding");
  });

  it("the tables of construction paths name the same paths", () => {
    // A path present in one table and missing from another is held to one
    // rule and not the other, so the tables are compared by name.
    const absent = ABSENT_CASES.map((row) => row.label);
    const hostile = HOSTILE_CASES.map((row) => row.label);
    expect(new Set(absent).size).toBe(absent.length);
    expect(new Set(hostile).size).toBe(hostile.length);
    // The two tables name one path differently where it reads differently:
    // what is absent there is the retry hint, and what is untrusted is the body.
    const renamed = new Map([["failing status with no retry hint", "failing status"]]);
    expect([...absent.map((label) => renamed.get(label) ?? label)].sort()).toEqual([...hostile].sort());
    expect(CONSTRUCTION_PATHS).toHaveLength(ERROR_CASES.length + ABSENT_CASES.length);

    // Every source a credential error can state is built by some row.
    const credentialSources = ABSENT_CASES.map((row) => row.build())
      .filter((error): error is DecisionCredentialError => error instanceof DecisionCredentialError)
      .map((error) => error.source);
    expect([...credentialSources].sort()).toEqual(["key_unset", "key_unusable", "vendor_rejected"]);
  });

  it("completing an error attaches an attempt that cannot disagree with it", () => {
    for (const measured of [DISAGREEING, UNMEASURED]) {
      const measuredFacts = ownFacts(measured);
      for (const row of CONSTRUCTION_PATHS) {
        const error = row.build();
        const stated = ownFacts(error);
        const message = error.message;

        expect(error.withAttempt(measured), row.className).toBe(error);
        const attempt = error.attempt;
        expect(attempt, row.className).not.toBeNull();
        if (attempt === null) {
          continue;
        }
        expect(attempt.outcome, row.className).toBe("fault");
        expect(error.fault, row.className).toBe(row.fault);
        expect(error.message, row.className).toBe(message);
        expect(Object.keys(error), row.className).toContain("attempt");

        const completed = ownFacts(error);
        const shared: string[] = [];
        for (const [fact, recorded] of Object.entries(attempt)) {
          if (fact === "outcome") {
            continue;
          }
          const label = `${row.className}.${fact}`;
          // One rule for every fact: what the raising layer stated stands, and
          // the client's measurement fills only what that layer left unstated.
          expect(recorded, label).toEqual(stated[fact] ?? measuredFacts[fact]);
          if (fact in completed) {
            shared.push(fact);
            expect(completed[fact], label).toEqual(recorded);
          }
        }
        // The comparison above is over the facts both carry; naming them here
        // keeps it from passing on an empty intersection.
        const expectedShared = [...BASE_SHARED_FACTS, ...(CLASS_SHARED_FACTS[error.name] ?? [])];
        expect([...shared].sort(), row.className).toEqual([...expectedShared].sort());
      }
    }

    // A status the transport read is not overwritten by the client's view.
    const overloaded = new DecisionTransportError({
      source: "status",
      status: 529,
      retryable: true,
      retryAfterMs: RETRY_AFTER_MS,
      body: "",
      vendorErrorType: null,
      vendorRequestId: null,
    }).withAttempt({ ...MEASURED, status: 200, retryAfterMs: 1, usage: null });
    expect(overloaded.status).toBe(529);
    expect(overloaded.retryAfterMs).toBe(RETRY_AFTER_MS);
    expect(overloaded.attempt?.status).toBe(529);
    expect(overloaded.attempt?.retryAfterMs).toBe(RETRY_AFTER_MS);
    expect(overloaded.usage).toBeNull();
    expect(overloaded.attempt?.usage).toBeNull();

    // The one fault whose whole content is that another model answered records
    // that model, whether the client measured the pin or nothing at all.
    for (const servedModel of [MODEL_PIN, null]) {
      const substituted = new DecisionRouteMismatchError({
        route: ROUTE,
        expectedServedModel: MODEL_PIN,
        servedModel: OTHER_MODEL,
        status: 200,
        usage: BILLED_USAGE,
        vendorRequestId: REQUEST_ID,
      }).withAttempt({ ...MEASURED, servedModel });
      expect(substituted.attempt?.servedModel).toBe(OTHER_MODEL);
      expect(substituted.servedModel).toBe(OTHER_MODEL);
    }

    // A message is written when the error is raised, from the budget and the
    // route it was raised with, so the record keeps those and not a later view.
    const narrowed = { ...MEASURED, route: "dm.local", budgetMs: 700 } as const;
    const timedOut = new DecisionTimeoutError({ route: ROUTE, source: "route_budget", budgetMs: BUDGET_MS });
    timedOut.withAttempt(narrowed);
    expect(timedOut.message).toContain(`${BUDGET_MS} ms`);
    expect(timedOut.message).toContain(ROUTE);
    expect(timedOut.attempt?.budgetMs).toBe(BUDGET_MS);
    expect(timedOut.attempt?.route).toBe(ROUTE);
    expect(timedOut.route).toBe(ROUTE);
    const refused = new DecisionAdmissionError({ route: ROUTE, source: "provider_guard", budgetMs: BUDGET_MS });
    refused.withAttempt({ ...MEASURED, budgetMs: null });
    expect(refused.message).toContain(`${BUDGET_MS} ms`);
    expect(refused.attempt?.budgetMs).toBe(BUDGET_MS);
  });
});
