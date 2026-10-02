/**
 * The typed errors a decision call rejects with.
 *
 * A consumer in another package decides what to do with a failed decision call
 * from one literal, `fault`, read off the error as data. It cannot use
 * `instanceof`: two installed copies of this package have two distinct classes
 * of the same name. So the tests pin the three things that literal depends on:
 * every class carries exactly one member of the closed vocabulary, the member
 * is an own enumerable property that survives a structural read, and vendor
 * text carried on an error is bounded.
 */

import { describe, expect, it } from "vitest";

import {
  DECISION_ERROR_BODY_EXCERPT,
  DECISION_FAULTS,
  DECISION_UNAVAILABLE_CODES,
  DecisionAdmissionError,
  DecisionCallError,
  DecisionCredentialError,
  DecisionRequestInvalidError,
  DecisionResponseFormatError,
  DecisionRouteMismatchError,
  DecisionRouteUnavailableError,
  DecisionTimeoutError,
  DecisionTransportError,
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
    ]);
    expect(ERROR_CASES).toHaveLength(8);
    expect(new Set(ERROR_CASES.map((row) => row.className)).size).toBe(8);

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
    expect(mismatch.servedModel).toBe(body);
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

  it("an unmeasured field is null and never a number", () => {
    const admission = new DecisionAdmissionError({ route: ROUTE, source: "route_budget", budgetMs: BUDGET_MS });
    expect(admission.status).toBeNull();
    expect(admission.retryAfterMs).toBeNull();
    expect(admission.vendorRequestId).toBeNull();
    expect(admission.usage).toBeNull();
    expect(admission.attempt).toBeNull();

    // An error raised below the client names no route until the client, which
    // alone knows it, completes the error.
    const invalid = new DecisionRequestInvalidError({
      source: "request_validation",
      fieldPath: "state",
      reason: "state is null",
    });
    expect(invalid.route).toBeNull();
    expect(invalid.status).toBeNull();
    expect(invalid.bodyExcerpt).toBeNull();

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

  it("completing an error attaches an attempt that cannot disagree with it", () => {
    for (const row of ERROR_CASES) {
      const error = row.build();
      const before = {
        status: error.status,
        retryAfterMs: error.retryAfterMs,
        vendorRequestId: error.vendorRequestId,
        usage: error.usage,
      };
      const completed = error.withAttempt(MEASURED);

      expect(completed, row.className).toBe(error);
      const attempt = error.attempt;
      expect(attempt, row.className).not.toBeNull();
      if (attempt === null) {
        continue;
      }
      expect(attempt.outcome, row.className).toBe("fault");
      expect(attempt.fault, row.className).toBe(row.fault);

      // The client names the route; it is the only layer that knows it.
      expect(error.route, row.className).toBe(MEASURED.route);
      expect(attempt.route, row.className).toBe(MEASURED.route);

      // What the raising layer saw wins; what it could not see is taken from
      // the client's measurement. Either way the error and its record agree.
      expect(error.status, row.className).toBe(before.status ?? MEASURED.status);
      expect(error.retryAfterMs, row.className).toBe(before.retryAfterMs ?? MEASURED.retryAfterMs);
      expect(error.vendorRequestId, row.className).toBe(before.vendorRequestId ?? MEASURED.vendorRequestId);
      expect(error.usage, row.className).toEqual(before.usage ?? MEASURED.usage);
      expect(attempt.status, row.className).toBe(error.status);
      expect(attempt.retryAfterMs, row.className).toBe(error.retryAfterMs);
      expect(attempt.vendorRequestId, row.className).toBe(error.vendorRequestId);
      expect(attempt.usage, row.className).toEqual(error.usage);

      // What only the client measures is carried through untouched.
      expect(attempt.provider, row.className).toBe(MEASURED.provider);
      expect(attempt.modelPin, row.className).toBe(MEASURED.modelPin);
      expect(attempt.queueMs, row.className).toBe(MEASURED.queueMs);
      expect(attempt.durationMs, row.className).toBe(MEASURED.durationMs);
      expect(attempt.budgetMs, row.className).toBe(MEASURED.budgetMs);
      expect(attempt.servedModel, row.className).toBe(MEASURED.servedModel);
      expect(attempt.correlationId, row.className).toBe(MEASURED.correlationId);

      expect(Object.keys(error), row.className).toContain("attempt");
      expect(error.fault, row.className).toBe(row.fault);
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
  });
});
