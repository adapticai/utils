/**
 * The decision codec: what is sent, and what is accepted back.
 *
 * A typed decision model returns numbers that a consumer acts on without a
 * human reading them, so the codec is the last place a wrong shape can be
 * caught. These tests pin both directions against the contract fixtures: the
 * request is the documented one byte for byte, and a response is accepted only
 * when it answers exactly the questions asked, in the shape the contract gives
 * each kind, over exactly the options the request offered.
 *
 * They also pin what the codec must never do. It invents no field (a yes/no
 * answer carries no confidence), repairs nothing (a distribution is never
 * renormalised and an unknown option is never dropped), holds no tolerance of
 * its own (the sum is reported, and enforced only at a value the caller
 * passes), and lets no absence travel as a value (a state that is `null`, or a
 * number with no JSON form inside one, is refused before anything is sent).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  decodeDecisionResponse,
  encodeDecisionRequest,
  resolveProbabilitySumTolerance,
} from "../../../llm/decision/codec";
import type { DecisionDecodeOptions, DecisionEncodeOptions } from "../../../llm/decision/codec";
import {
  DECISION_ERROR_BODY_EXCERPT,
  DecisionCallError,
  DecisionRequestInvalidError,
  DecisionResponseFormatError,
} from "../../../llm/decision/errors";
import type { DecisionRouteCaps } from "../../../llm/decision/route-types";
import type { DecisionAnswer, DecisionChoiceAnswer, DecisionRequest } from "../../../llm/decision/types";
import type { LlmUsageRecord } from "../../../llm/types";
import { loadDecisionFixture } from "./support/fixtures";
import type { DecisionEvidenceClass } from "./support/fixtures";

/** The limits the hosted contract documents: 255 options, 10 levels, no question limit. */
const HOSTED_CAPS: DecisionRouteCaps = { maxOptions: 255, maxScoreLevels: 10, maxQuestions: null };

/** The moving model name the documented request example sends. */
const DOCUMENTED_REQUEST_MODEL = "jev-latest";

/** The versioned model id the constructed request fixtures send and the response fixtures report. */
const PINNED_MODEL = "jev-1.13.0";

/** The state every request fixture carries. */
const STATE = "Help! My payouts have been failing for 3 days.";

/** The fewest levels the contract admits for a score. */
const MIN_SCORE_LEVELS = 2;

/** A tolerance tight enough to refuse a distribution that is three points short of one. */
const TIGHT_TOLERANCE = 0.001;

/** A tolerance loose enough to admit that same distribution. */
const LOOSE_TOLERANCE = 0.05;

/** Decimal places to which a float sum of exact-looking decimals is compared. */
const FLOAT_SUM_DIGITS = 12;

/** A distance too small to be a level apart and large enough to leave a bound. */
const JUST_OUTSIDE = 1e-9;

/** How deep a hostile legend entry nests: far deeper than a call stack can follow. */
const HOSTILE_NESTING_DEPTH = 200_000;

/** A question count well past any limit a route might state, for a route that states none. */
const MANY_QUESTIONS = 40;

/** Length of a vendor-supplied key far past the excerpt bound. */
const LONG_KEY_CHARS = 5_000;

/** Upper bound on a message built from two excerpts and the codec's own words. */
const MESSAGE_BOUND = 3 * DECISION_ERROR_BODY_EXCERPT;

/** The classes of fixture that reproduce the vendor's published words. */
const DOCUMENTED: readonly DecisionEvidenceClass[] = ["documented-verbatim"];

/** The classes of fixture whose shape is documented and whose values are ours. */
const CONSTRUCTED: readonly DecisionEvidenceClass[] = ["constructed-from-documented-fields"];

/** What the vendor billed for a response, as the transport would have read it. */
const BILLED_USAGE: LlmUsageRecord = {
  prompt_tokens: 318,
  completion_tokens: 34,
  provider: "decision-vendor",
  model: PINNED_MODEL,
  cost: null,
};

/**
 * The documented request, written here with every object's keys in the wrong
 * order.
 *
 * An encoder that passed its input through would reproduce this order, so the
 * byte-for-byte comparison against the fixture holds only when the encoder
 * imposes the documented one.
 */
const DOCUMENTED_CHOICE_REQUEST: DecisionRequest = {
  questions: {
    department: {
      criteria: {
        billing: "Payments, invoicing, refunds",
        technical: "Bugs, outages, integrations",
        sales: "Pricing, upgrades, new accounts",
      },
      instructions: "Which team should handle this?",
      type: "choice",
    },
  },
  state: STATE,
};

/** The constructed yes/no request, with its criteria written no-first. */
const CONSTRUCTED_NOUL_REQUEST: DecisionRequest = {
  questions: {
    payment_failure: {
      criteria: {
        false: "The message is about anything else",
        true: "The message describes a payment or payout that did not complete",
      },
      instructions: "Is the customer reporting a payment that failed?",
      type: "noul",
    },
  },
  state: STATE,
};

/** The four levels of the constructed score request, lowest first. */
const URGENCY_LEVELS: readonly string[] = [
  "No action is needed",
  "Can wait for the normal queue",
  "Needs attention today",
  "Blocks the customer right now",
];

/** The constructed score request. */
const CONSTRUCTED_SCORE_REQUEST: DecisionRequest = {
  questions: {
    urgency: {
      criteria: URGENCY_LEVELS,
      instructions: "How urgent is this request?",
      type: "score",
    },
  },
  state: STATE,
};

/** One request asking a question of each kind, in the order noul, choice, score. */
const TRIAGE_REQUEST: DecisionRequest = {
  state: STATE,
  questions: {
    payment_failure: CONSTRUCTED_NOUL_REQUEST.questions.payment_failure,
    department: DOCUMENTED_CHOICE_REQUEST.questions.department,
    urgency: CONSTRUCTED_SCORE_REQUEST.questions.urgency,
  },
};

/** A response body loose enough to be corrupted one field at a time. */
interface MutablePayload {
  model: unknown;
  answers: Record<string, Record<string, unknown>>;
  usage?: unknown;
}

/**
 * A well-formed answer to {@link TRIAGE_REQUEST}.
 *
 * The answers, and the keys of the choice's distribution, are deliberately in
 * a different order from the request's.
 *
 * @returns A fresh body, so one case's corruption cannot reach another.
 */
function validTriagePayload(): MutablePayload {
  return {
    model: PINNED_MODEL,
    answers: {
      urgency: {
        type: "score",
        score: 2.5,
        legend: { "0": URGENCY_LEVELS[0], "1": URGENCY_LEVELS[1], "2": URGENCY_LEVELS[2], "3": URGENCY_LEVELS[3] },
        probabilities: { "0": 0, "1": 0.125, "2": 0.25, "3": 0.625 },
        confidence: 0.5,
      },
      department: {
        type: "choice",
        choice: "billing",
        probabilities: { sales: 0, technical: 0.12, billing: 0.88 },
        confidence: 0.81,
      },
      payment_failure: { type: "noul", noul: 0.95 },
    },
    usage: { input_tokens: 318, output_tokens: 34 },
  };
}

/**
 * The body of a fixture, loaded under the evidence classes the caller names.
 *
 * @param name The fixture's file name.
 * @param allow The evidence classes the test is prepared to rely on.
 * @returns The fixture's body.
 */
function fixtureBody(name: string, allow: readonly DecisionEvidenceClass[]): unknown {
  return loadDecisionFixture(name, { allow }).envelope.body;
}

/**
 * Present a value that breaks the request type as a request.
 *
 * The type forbids these values and a caller written in plain JavaScript, or
 * one handing over a deserialised object, can still present them, which is why
 * the encoder checks at run time what the compiler checks for a typed caller.
 *
 * @param request The off-contract value.
 * @returns The same value, typed as a request.
 */
function offContract(request: unknown): DecisionRequest {
  return request as DecisionRequest;
}

/**
 * Present a value that breaks an options type as those options.
 *
 * @param options The off-contract value.
 * @returns The same value, typed as the options a call expects.
 */
function offOptions<T extends DecisionEncodeOptions | DecisionDecodeOptions>(options: unknown): T {
  return options as T;
}

/**
 * Run a function that is expected to throw, and return what it threw.
 *
 * @param run The function.
 * @returns The thrown value.
 * @throws When the function returns instead of throwing.
 */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw, and it returned");
}

/**
 * The message of a thrown value.
 *
 * @param error The thrown value.
 * @returns Its message.
 * @throws When the value is not an error.
 */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) {
    throw new Error("expected an error to have been thrown");
  }
  return error.message;
}

/**
 * Read a field of a parsed JSON object.
 *
 * @param value The parsed value.
 * @param name The field's name.
 * @returns The field's value.
 * @throws When the value is not an object.
 */
function fieldOf(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) {
    throw new Error(`expected an object holding ${name}`);
  }
  return Object.entries(value).find(([key]) => key === name)?.[1];
}

/**
 * Narrow a decoded answer to a choice.
 *
 * @param answer The decoded answer.
 * @returns The answer, as a choice.
 * @throws When it is of another kind.
 */
function asChoice(answer: DecisionAnswer): DecisionChoiceAnswer {
  if (answer.type !== "choice") {
    throw new Error(`expected a choice answer, and got a ${answer.type}`);
  }
  return answer;
}

/**
 * Freeze a value and everything it holds.
 *
 * @param value The value to freeze.
 * @returns The same value, frozen all the way down.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
  }
  return value;
}

/**
 * A choice question over a given number of generated options.
 *
 * @param count How many options the question offers.
 * @returns A request asking that one question.
 */
function choiceRequestWithOptions(count: number): DecisionRequest {
  const criteria = Object.fromEntries(Array.from({ length: count }, (_, index) => [`option_${index}`, null]));
  return { state: STATE, questions: { pick: { type: "choice", instructions: "Which one?", criteria } } };
}

/**
 * A score question over a given number of generated levels.
 *
 * @param count How many levels the scale has.
 * @returns A request asking that one question.
 */
function scoreRequestWithLevels(count: number): DecisionRequest {
  const criteria = Array.from({ length: count }, (_, index) => `level ${index}`);
  return { state: STATE, questions: { grade: { type: "score", instructions: "How much?", criteria } } };
}

/**
 * A request asking a given number of yes/no questions.
 *
 * @param count How many questions the request asks.
 * @returns The request.
 */
function requestWithQuestions(count: number): DecisionRequest {
  const questions = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `question_${index}`,
      { type: "noul" as const, instructions: "Is it so?" },
    ]),
  );
  return { state: STATE, questions };
}

/**
 * Assert that a request is refused before it is sent, at one field.
 *
 * @param request The request to encode.
 * @param fieldPath The field the refusal must name.
 * @param caps The route limits to encode under.
 */
function expectRequestRefused(
  request: DecisionRequest,
  fieldPath: string,
  caps: DecisionRouteCaps = HOSTED_CAPS,
): void {
  const error = thrownBy(() => encodeDecisionRequest(request, { model: PINNED_MODEL, caps }));
  expect(error).toBeInstanceOf(DecisionRequestInvalidError);
  expect(error).toMatchObject({
    fault: "schema",
    source: "request_validation",
    fieldPath,
    route: null,
    status: null,
    usage: null,
  });
}

/**
 * Assert that a response is rejected at one field, with the billed usage.
 *
 * @param payload The response body.
 * @param fieldPath The field the rejection must name.
 * @param request The request the body answers.
 */
function expectResponseRejected(payload: unknown, fieldPath: string, request: DecisionRequest = TRIAGE_REQUEST): void {
  const error = thrownBy(() => decodeDecisionResponse(payload, request, { billedUsage: BILLED_USAGE }));
  expect(error).toBeInstanceOf(DecisionResponseFormatError);
  expect(error).toMatchObject({ fault: "schema", fieldPath, route: null, status: null, vendorRequestId: null });
  expect(error).toHaveProperty("usage", BILLED_USAGE);
}

/** One way a response body can break the contract, and the field that must be named. */
interface ResponseViolation {
  readonly rule: string;
  readonly fieldPath: string;
  /** Corrupt a well-formed body, or replace it. */
  readonly corrupt: (payload: MutablePayload) => unknown;
}

/**
 * Build a violation that edits one field of a well-formed body in place.
 *
 * @param rule What the contract requires.
 * @param fieldPath The field the rejection must name.
 * @param edit The edit that breaks the rule.
 * @returns The violation.
 */
function violation(rule: string, fieldPath: string, edit: (payload: MutablePayload) => void): ResponseViolation {
  return {
    rule,
    fieldPath,
    corrupt: (payload) => {
      edit(payload);
      return payload;
    },
  };
}

/**
 * Every structural rule of a response, one row per way of breaking it.
 *
 * Each row breaks exactly one rule of an otherwise well-formed body, so a row
 * goes red when its own check is removed and for no other reason.
 */
const RESPONSE_VIOLATIONS: readonly ResponseViolation[] = [
  { rule: "the body is an object, not null", fieldPath: "$", corrupt: () => null },
  { rule: "the body is an object, not an array", fieldPath: "$", corrupt: () => [] },
  { rule: "the body is an object, not text", fieldPath: "$", corrupt: () => "billing" },
  violation("the answering model is reported", "model", (payload) => {
    delete payload.model;
  }),
  violation("the answering model is not empty", "model", (payload) => {
    payload.model = "";
  }),
  violation("the answering model is a string", "model", (payload) => {
    payload.model = 13;
  }),
  { rule: "answers are present", fieldPath: "answers", corrupt: ({ model }) => ({ model }) },
  { rule: "answers are an object", fieldPath: "answers", corrupt: ({ model }) => ({ model, answers: [] }) },
  violation("every question asked is answered", "answers.department", (payload) => {
    delete payload.answers.department;
  }),
  violation("no question is answered that was not asked", "answers.unasked", (payload) => {
    payload.answers.unasked = { type: "noul", noul: 0.5 };
  }),
  violation(
    "an answer under a name every object inherits is still one nobody asked for",
    "answers.constructor",
    (payload) => {
      Object.defineProperty(payload.answers, "constructor", {
        value: { type: "noul", noul: 0.5 },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    },
  ),
  {
    rule: "an answer is an object",
    fieldPath: "answers.department",
    corrupt: ({ model, answers }) => ({ model, answers: { ...answers, department: "billing" } }),
  },
  violation("an answer is of its question's kind", "answers.payment_failure.type", (payload) => {
    payload.answers.payment_failure.type = "choice";
  }),
  violation("an answer states its kind", "answers.urgency.type", (payload) => {
    delete payload.answers.urgency.type;
  }),
  violation("a yes/no answer is a number", "answers.payment_failure.noul", (payload) => {
    payload.answers.payment_failure.noul = "0.95";
  }),
  violation("a yes/no answer is present", "answers.payment_failure.noul", (payload) => {
    delete payload.answers.payment_failure.noul;
  }),
  violation("a yes/no answer is finite", "answers.payment_failure.noul", (payload) => {
    payload.answers.payment_failure.noul = Number.NaN;
  }),
  violation("a yes/no answer is at most one", "answers.payment_failure.noul", (payload) => {
    payload.answers.payment_failure.noul = 1.2;
  }),
  violation("a yes/no answer is at least zero", "answers.payment_failure.noul", (payload) => {
    payload.answers.payment_failure.noul = -0.1;
  }),
  violation("a choice is one of the options offered", "answers.department.choice", (payload) => {
    payload.answers.department.choice = "refunds";
  }),
  violation("a choice is an option, not a name every object inherits", "answers.department.choice", (payload) => {
    payload.answers.department.choice = "toString";
  }),
  violation("a choice is a string", "answers.department.choice", (payload) => {
    payload.answers.department.choice = 0;
  }),
  violation("a choice's distribution is an object", "answers.department.probabilities", (payload) => {
    payload.answers.department.probabilities = [0.88, 0.12, 0];
  }),
  violation("every option has a probability", "answers.department.probabilities.sales", (payload) => {
    payload.answers.department.probabilities = { billing: 0.88, technical: 0.12 };
  }),
  violation("nothing but an option has a probability", "answers.department.probabilities.refunds", (payload) => {
    payload.answers.department.probabilities = { billing: 0.88, technical: 0.12, sales: 0, refunds: 0 };
  }),
  violation("a probability is a number", "answers.department.probabilities.billing", (payload) => {
    payload.answers.department.probabilities = { billing: "0.88", technical: 0.12, sales: 0 };
  }),
  violation("a probability is finite", "answers.department.probabilities.technical", (payload) => {
    payload.answers.department.probabilities = { billing: 0.88, technical: Number.NaN, sales: 0 };
  }),
  violation("a probability is at most one", "answers.department.probabilities.billing", (payload) => {
    payload.answers.department.probabilities = { billing: 1.5, technical: 0.12, sales: 0 };
  }),
  violation("a probability is at least zero", "answers.department.probabilities.sales", (payload) => {
    payload.answers.department.probabilities = { billing: 0.88, technical: 0.12, sales: -0.01 };
  }),
  violation("the choice has the highest probability", "answers.department.choice", (payload) => {
    payload.answers.department.choice = "technical";
  }),
  violation("a choice carries the vendor's confidence", "answers.department.confidence", (payload) => {
    delete payload.answers.department.confidence;
  }),
  violation("a choice's confidence is a number", "answers.department.confidence", (payload) => {
    payload.answers.department.confidence = "0.81";
  }),
  violation("a choice's confidence is finite", "answers.department.confidence", (payload) => {
    payload.answers.department.confidence = Number.POSITIVE_INFINITY;
  }),
  violation("a score is a number", "answers.urgency.score", (payload) => {
    payload.answers.urgency.score = null;
  }),
  violation("a score is finite", "answers.urgency.score", (payload) => {
    payload.answers.urgency.score = Number.NaN;
  }),
  violation("a score is at least zero", "answers.urgency.score", (payload) => {
    payload.answers.urgency.score = -JUST_OUTSIDE;
  }),
  violation("a score is at most the number of levels", "answers.urgency.score", (payload) => {
    payload.answers.urgency.score = URGENCY_LEVELS.length + JUST_OUTSIDE;
  }),
  violation("a score's distribution is an object", "answers.urgency.probabilities", (payload) => {
    delete payload.answers.urgency.probabilities;
  }),
  violation("every level has a probability", "answers.urgency.probabilities.3", (payload) => {
    payload.answers.urgency.probabilities = { "0": 0, "1": 0.375, "2": 0.625 };
  }),
  violation("nothing but a level has a probability", "answers.urgency.probabilities.4", (payload) => {
    payload.answers.urgency.probabilities = { "0": 0, "1": 0.125, "2": 0.25, "3": 0.625, "4": 0 };
  }),
  violation(
    "a level is keyed by its index, not by a padded form of it",
    "answers.urgency.probabilities.03",
    (payload) => {
      payload.answers.urgency.probabilities = { "0": 0, "1": 0.125, "2": 0.25, "03": 0.625 };
    },
  ),
  violation("a level's probability is in range", "answers.urgency.probabilities.2", (payload) => {
    payload.answers.urgency.probabilities = { "0": 0, "1": 0.125, "2": 1.25, "3": 0.625 };
  }),
  violation("a score's legend is an object", "answers.urgency.legend", (payload) => {
    payload.answers.urgency.legend = URGENCY_LEVELS;
  }),
  violation("every level is in the legend", "answers.urgency.legend.3", (payload) => {
    payload.answers.urgency.legend = { "0": URGENCY_LEVELS[0], "1": URGENCY_LEVELS[1], "2": URGENCY_LEVELS[2] };
  }),
  violation("nothing but a level is in the legend", "answers.urgency.legend.4", (payload) => {
    payload.answers.urgency.legend = { "0": "a", "1": "b", "2": "c", "3": "d", "4": "e" };
  }),
  violation("a legend entry is a description", "answers.urgency.legend.1", (payload) => {
    payload.answers.urgency.legend = { "0": "a", "1": null, "2": "c", "3": "d" };
  }),
  violation("a score carries the vendor's confidence", "answers.urgency.confidence", (payload) => {
    delete payload.answers.urgency.confidence;
  }),
  violation("a score's confidence is finite", "answers.urgency.confidence", (payload) => {
    payload.answers.urgency.confidence = Number.NaN;
  }),
];

/** One way a request can break the contract or a route's limits. */
interface RequestViolation {
  readonly rule: string;
  readonly fieldPath: string;
  readonly request: DecisionRequest;
  readonly caps?: DecisionRouteCaps;
}

/** A state holding one object twice, which is legal JSON, and never itself. */
const SHARED_FEATURES = { momentum: 0.4 };

/**
 * A state that contains itself.
 *
 * @returns The state.
 */
function cyclicState(): unknown {
  const state: Record<string, unknown> = { symbol: "ABC" };
  state.self = state;
  return state;
}

/** The yes/no question the request rows reuse. */
const PLAIN_NOUL = { type: "noul", instructions: "Is it so?" } as const;

/**
 * The limits a request is held to before it is sent: the route's, at their
 * documented values, and the two the contract states for every route.
 */
const LIMIT_VIOLATIONS: readonly RequestViolation[] = [
  {
    rule: "256 options exceed a 255-option route",
    fieldPath: "questions.pick.criteria",
    request: choiceRequestWithOptions(HOSTED_CAPS.maxOptions + 1),
  },
  {
    rule: "one level is not a scale",
    fieldPath: "questions.grade.criteria",
    request: scoreRequestWithLevels(MIN_SCORE_LEVELS - 1),
  },
  {
    rule: "11 levels exceed a 10-level route",
    fieldPath: "questions.grade.criteria",
    request: scoreRequestWithLevels(HOSTED_CAPS.maxScoreLevels + 1),
  },
  { rule: "a request asks at least one question", fieldPath: "questions", request: { state: STATE, questions: {} } },
  {
    rule: "three questions exceed a two-question route",
    fieldPath: "questions",
    request: requestWithQuestions(3),
    caps: { ...HOSTED_CAPS, maxQuestions: 2 },
  },
  {
    rule: "a limit that is not a number admits nothing",
    fieldPath: "questions.pick.criteria",
    request: choiceRequestWithOptions(1),
    caps: { ...HOSTED_CAPS, maxOptions: Number.NaN },
  },
  {
    rule: "a level limit that is not a number admits nothing",
    fieldPath: "questions.grade.criteria",
    request: scoreRequestWithLevels(MIN_SCORE_LEVELS),
    caps: { ...HOSTED_CAPS, maxScoreLevels: Number.NaN },
  },
  {
    rule: "a question limit that is not a number admits nothing",
    fieldPath: "questions",
    request: requestWithQuestions(1),
    caps: { ...HOSTED_CAPS, maxQuestions: Number.NaN },
  },
  {
    rule: "the state is never null",
    fieldPath: "state",
    request: offContract({ state: null, questions: { q: PLAIN_NOUL } }),
  },
];

/** Every other shape the wire contract requires of a request, one row per way of breaking it. */
const SHAPE_VIOLATIONS: readonly RequestViolation[] = [
  {
    rule: "the state is present",
    fieldPath: "state",
    request: offContract({ questions: { q: PLAIN_NOUL } }),
  },
  {
    rule: "the state is not a bare number",
    fieldPath: "state",
    request: offContract({ state: 42, questions: { q: PLAIN_NOUL } }),
  },
  {
    rule: "the state is not a bare boolean",
    fieldPath: "state",
    request: offContract({ state: true, questions: { q: PLAIN_NOUL } }),
  },
  {
    rule: "a number in the state has a JSON form",
    fieldPath: "state.features.momentum",
    request: { state: { features: { momentum: Number.NaN } }, questions: { q: PLAIN_NOUL } },
  },
  {
    rule: "an element of the state has a JSON form",
    fieldPath: "state.bars[1].close",
    request: {
      state: { bars: [{ close: 1 }, { close: Number.POSITIVE_INFINITY }] },
      questions: { q: PLAIN_NOUL },
    },
  },
  {
    rule: "a field of the state is a value, not an absence",
    fieldPath: "state.spread",
    request: offContract({ state: { spread: undefined }, questions: { q: PLAIN_NOUL } }),
  },
  {
    rule: "the state holds data, not an object that serialises as something else",
    fieldPath: "state.asOf",
    request: offContract({ state: { asOf: new Date(0) }, questions: { q: PLAIN_NOUL } }),
  },
  {
    rule: "an integer too wide for a number has no JSON form",
    fieldPath: "state.volume",
    request: offContract({ state: { volume: BigInt(10) }, questions: { q: PLAIN_NOUL } }),
  },
  {
    rule: "the state holds no list that writes itself as something else",
    fieldPath: "state.bars",
    request: offContract({
      state: { bars: Object.assign([1, 2], { toJSON: () => "REPLACED" }) },
      questions: { q: PLAIN_NOUL },
    }),
  },
  {
    rule: "the state does not contain itself",
    fieldPath: "state.self",
    request: offContract({ state: cyclicState(), questions: { q: PLAIN_NOUL } }),
  },
  {
    rule: "questions are a map",
    fieldPath: "questions",
    request: offContract({ state: STATE, questions: [PLAIN_NOUL] }),
  },
  {
    rule: "a question is an object",
    fieldPath: "questions.q",
    request: offContract({ state: STATE, questions: { q: "Is it so?" } }),
  },
  {
    rule: "a question is of a known kind",
    fieldPath: "questions.q.type",
    request: offContract({ state: STATE, questions: { q: { type: "rank", instructions: "Order these" } } }),
  },
  {
    rule: "instructions are required",
    fieldPath: "questions.q.instructions",
    request: offContract({ state: STATE, questions: { q: { type: "noul" } } }),
  },
  {
    rule: "instructions are not null",
    fieldPath: "questions.q.instructions",
    request: offContract({ state: STATE, questions: { q: { type: "noul", instructions: null } } }),
  },
  {
    rule: "a yes/no question describes only yes and no",
    fieldPath: "questions.q.criteria.maybe",
    request: offContract({
      state: STATE,
      questions: { q: { type: "noul", instructions: "Is it so?", criteria: { true: "yes", maybe: "perhaps" } } },
    }),
  },
  {
    rule: "a yes/no question's criteria are an object",
    fieldPath: "questions.q.criteria",
    request: offContract({
      state: STATE,
      questions: { q: { type: "noul", instructions: "Is it so?", criteria: ["yes", "no"] } },
    }),
  },
  {
    rule: "a yes/no description is not null",
    fieldPath: "questions.q.criteria.false",
    request: offContract({
      state: STATE,
      questions: { q: { type: "noul", instructions: "Is it so?", criteria: { false: null } } },
    }),
  },
  {
    rule: "a choice has criteria",
    fieldPath: "questions.q.criteria",
    request: offContract({ state: STATE, questions: { q: { type: "choice", instructions: "Which one?" } } }),
  },
  {
    rule: "a choice offers at least one option",
    fieldPath: "questions.q.criteria",
    request: { state: STATE, questions: { q: { type: "choice", instructions: "Which one?", criteria: {} } } },
  },
  {
    rule: "an option's description is text, structured data or null",
    fieldPath: "questions.q.criteria.billing",
    request: offContract({
      state: STATE,
      questions: { q: { type: "choice", instructions: "Which one?", criteria: { billing: 7, sales: null } } },
    }),
  },
  {
    rule: "a score's criteria are an array",
    fieldPath: "questions.q.criteria",
    request: offContract({
      state: STATE,
      questions: { q: { type: "score", instructions: "How much?", criteria: { "0": "low", "1": "high" } } },
    }),
  },
  {
    rule: "a level's description is not null",
    fieldPath: "questions.q.criteria[1]",
    request: offContract({
      state: STATE,
      questions: { q: { type: "score", instructions: "How much?", criteria: ["low", null, "high"] } },
    }),
  },
  {
    rule: "the request is an object",
    fieldPath: "$",
    request: offContract(null),
  },
];

/** One place a source file names another module. */
interface ModuleReference {
  readonly specifier: string;
  /** True when the reference is erased at compile time and loads nothing. */
  readonly typeOnly: boolean;
}

/** What a source file reaches outside itself. */
interface OutwardSurface {
  /** Every module the file names, in source order, in whatever form it names it. */
  readonly references: readonly ModuleReference[];
  /** Every use of a name that reads the clock, the environment, the network or randomness. */
  readonly ambientNames: readonly string[];
}

/**
 * The names through which code reads something other than its arguments: the
 * clock, the locale, the process, the network, a random source, or the global
 * object and the module loader, through which all of those are reachable.
 */
const AMBIENT_NAMES: ReadonlySet<string> = new Set([
  "Date",
  "Intl",
  "Temporal",
  "performance",
  "process",
  "globalThis",
  "setTimeout",
  "setInterval",
  "fetch",
  "crypto",
  "random",
  "require",
]);

/**
 * The text of a module specifier.
 *
 * @param node The specifier as written.
 * @returns The module it names, or its source text when it is not a literal.
 */
function specifierOf(node: ts.Node): string {
  return ts.isStringLiteralLike(node) ? node.text : node.getText();
}

/**
 * Read what a source file reaches outside itself, from its syntax tree.
 *
 * The tree is read and not the text, so a reference is found in whatever form
 * it is written: an import with or without bindings, a re-export, an
 * `import =`, a call to `import()`, an `import("…")` type, in either quote
 * style and with or without a semicolon. Comments are not part of the tree,
 * so a name mentioned in prose is not a use of it.
 *
 * @param source The file's text.
 * @returns The modules it names and the ambient names it uses.
 */
function outwardSurface(source: string): OutwardSurface {
  const file = ts.createSourceFile("subject.ts", source, ts.ScriptTarget.Latest, true);
  const references: ModuleReference[] = [];
  const ambientNames: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      references.push({
        specifier: specifierOf(node.moduleSpecifier),
        typeOnly: node.importClause?.isTypeOnly === true,
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      references.push({ specifier: specifierOf(node.moduleSpecifier), typeOnly: node.isTypeOnly });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      references.push({ specifier: specifierOf(node.moduleReference.expression), typeOnly: node.isTypeOnly });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      references.push({ specifier: node.arguments.map(specifierOf).join(", "), typeOnly: false });
    } else if (ts.isImportTypeNode(node)) {
      references.push({
        specifier: ts.isLiteralTypeNode(node.argument) ? specifierOf(node.argument.literal) : node.argument.getText(),
        typeOnly: true,
      });
    } else if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && AMBIENT_NAMES.has(node.text)) {
      ambientNames.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { references, ambientNames };
}

/** One form in which a file can reach outside itself, and what must be read from it. */
interface OutwardForm extends OutwardSurface {
  readonly form: string;
  readonly source: string;
}

/**
 * Every form the import-surface test must not be blind to, each as a file of
 * its own.
 *
 * The test that reads the codec's surface is only as good as the reading, so
 * the reading is pinned here against sources that are known to reach out.
 */
const OUTWARD_FORMS: readonly OutwardForm[] = [
  {
    form: "an import with bindings",
    source: 'import { a } from "../a";',
    references: [{ specifier: "../a", typeOnly: false }],
    ambientNames: [],
  },
  {
    form: "a type-only import",
    source: 'import type { A } from "../a";',
    references: [{ specifier: "../a", typeOnly: true }],
    ambientNames: [],
  },
  {
    form: "an import that binds a type beside a value loads the module",
    source: 'import { type A, b } from "../a";',
    references: [{ specifier: "../a", typeOnly: false }],
    ambientNames: [],
  },
  {
    form: "an import with no bindings, run for its effects",
    source: 'import "../a";',
    references: [{ specifier: "../a", typeOnly: false }],
    ambientNames: [],
  },
  {
    form: "a re-export",
    source: 'export { a } from "../a";',
    references: [{ specifier: "../a", typeOnly: false }],
    ambientNames: [],
  },
  {
    form: "a re-export of everything",
    source: 'export * from "../a";',
    references: [{ specifier: "../a", typeOnly: false }],
    ambientNames: [],
  },
  {
    form: "a type-only re-export",
    source: 'export type { A } from "../a";',
    references: [{ specifier: "../a", typeOnly: true }],
    ambientNames: [],
  },
  {
    form: "single quotes and no semicolon",
    source: "import { a } from '../a'\nexport { b } from '../b'",
    references: [
      { specifier: "../a", typeOnly: false },
      { specifier: "../b", typeOnly: false },
    ],
    ambientNames: [],
  },
  {
    form: "an import inside a function, loaded when it runs",
    source: 'async function load(): Promise<unknown> {\n  return import("../a");\n}',
    references: [{ specifier: "../a", typeOnly: false }],
    ambientNames: [],
  },
  {
    form: "an import assignment, and the loader it calls",
    source: 'import a = require("../a");',
    references: [{ specifier: "../a", typeOnly: false }],
    ambientNames: [],
  },
  {
    form: "a call to the loader",
    source: 'const a: unknown = require("../a");',
    references: [],
    ambientNames: ["require"],
  },
  {
    form: "a type named by its module",
    source: 'type A = import("../a").A;',
    references: [{ specifier: "../a", typeOnly: true }],
    ambientNames: [],
  },
  {
    form: "the clock, read directly",
    source: "const now = Date.now();",
    references: [],
    ambientNames: ["Date"],
  },
  {
    form: "the clock and the locale, read through a formatter",
    source: "const now = new Intl.DateTimeFormat().format();",
    references: [],
    ambientNames: ["Intl"],
  },
  {
    form: "the clock, read through the calendar API",
    source: "const now = Temporal.Now.instant();",
    references: [],
    ambientNames: ["Temporal"],
  },
  {
    form: "randomness, named as a member or as a key",
    source: 'const a = Math.random();\nconst b = Math["random"]();\nconst { random } = Math;',
    references: [],
    ambientNames: ["random", "random", "random"],
  },
  {
    form: "a name in a comment is not a use of it",
    source: "/** Reads no Date and no process. */\n// import \"../a\";\nconst a = 1;",
    references: [],
    ambientNames: [],
  },
];

describe("encodeDecisionRequest", () => {
  it("encodes the documented Choice request byte for byte", () => {
    const documented = fixtureBody("request.choice.documented.json", DOCUMENTED);

    const wire = encodeDecisionRequest(DOCUMENTED_CHOICE_REQUEST, {
      model: DOCUMENTED_REQUEST_MODEL,
      caps: HOSTED_CAPS,
    });

    expect(JSON.stringify(wire)).toBe(JSON.stringify(documented));
  });

  it("encodes the constructed yes/no and score requests byte for byte", () => {
    const options = { model: PINNED_MODEL, caps: HOSTED_CAPS };

    expect(JSON.stringify(encodeDecisionRequest(CONSTRUCTED_NOUL_REQUEST, options))).toBe(
      JSON.stringify(fixtureBody("request.noul.constructed.json", CONSTRUCTED)),
    );
    expect(JSON.stringify(encodeDecisionRequest(CONSTRUCTED_SCORE_REQUEST, options))).toBe(
      JSON.stringify(fixtureBody("request.score.constructed.json", CONSTRUCTED)),
    );
  });

  describe("request caps are enforced before any call", () => {
    for (const { rule, fieldPath, request, caps } of LIMIT_VIOLATIONS) {
      it(rule, () => {
        expectRequestRefused(request, fieldPath, caps);
      });
    }
  });

  describe("a request that breaks the wire contract is refused at the field that breaks it", () => {
    for (const { rule, fieldPath, request, caps } of SHAPE_VIOLATIONS) {
      it(rule, () => {
        expectRequestRefused(request, fieldPath, caps);
      });
    }
  });

  it("admits a request at each limit, and any number of questions on a route that states no limit", () => {
    const options = { model: PINNED_MODEL, caps: HOSTED_CAPS };

    expect(
      Object.keys(encodeDecisionRequest(choiceRequestWithOptions(HOSTED_CAPS.maxOptions), options).questions.pick),
    ).toEqual(["type", "instructions", "criteria"]);
    expect(
      encodeDecisionRequest(scoreRequestWithLevels(MIN_SCORE_LEVELS), options).questions.grade.criteria,
    ).toHaveLength(MIN_SCORE_LEVELS);
    expect(
      encodeDecisionRequest(scoreRequestWithLevels(HOSTED_CAPS.maxScoreLevels), options).questions.grade.criteria,
    ).toHaveLength(HOSTED_CAPS.maxScoreLevels);
    expect(Object.keys(encodeDecisionRequest(requestWithQuestions(MANY_QUESTIONS), options).questions)).toHaveLength(
      MANY_QUESTIONS,
    );
    expect(
      Object.keys(
        encodeDecisionRequest(requestWithQuestions(2), { ...options, caps: { ...HOSTED_CAPS, maxQuestions: 2 } })
          .questions,
      ),
    ).toHaveLength(2);
  });

  it("refuses a model id that is empty, because a request must name the route's pin", () => {
    const error = thrownBy(() => encodeDecisionRequest(DOCUMENTED_CHOICE_REQUEST, { model: "", caps: HOSTED_CAPS }));

    expect(error).toBeInstanceOf(DecisionRequestInvalidError);
    expect(error).toMatchObject({ fault: "schema", source: "request_validation", fieldPath: "model" });
  });

  it("refuses to encode without its route's limits, at the option that is missing", () => {
    for (const [options, fieldPath] of [
      [{ model: PINNED_MODEL }, "options.caps"],
      [{ model: PINNED_MODEL, caps: null }, "options.caps"],
      [null, "options"],
      [undefined, "options"],
    ] as const) {
      const error = thrownBy(() =>
        encodeDecisionRequest(DOCUMENTED_CHOICE_REQUEST, offOptions<DecisionEncodeOptions>(options)),
      );

      expect(error).toBeInstanceOf(DecisionRequestInvalidError);
      expect(error).toMatchObject({ fault: "schema", source: "request_validation", fieldPath });
    }
  });

  it("sends a yes/no question with no criteria as type and instructions alone", () => {
    const bare = encodeDecisionRequest(
      { state: STATE, questions: { q: PLAIN_NOUL, r: { ...PLAIN_NOUL, criteria: {} } } },
      { model: PINNED_MODEL, caps: HOSTED_CAPS },
    );

    expect(Object.keys(bare.questions.q)).toEqual(["type", "instructions"]);
    expect(Object.keys(bare.questions.r)).toEqual(["type", "instructions"]);
  });

  it("carries structured state, instructions and descriptions, and one object held twice", () => {
    const request: DecisionRequest = {
      state: {
        symbol: "ABC",
        now: SHARED_FEATURES,
        prior: SHARED_FEATURES,
        bars: [
          [1, 2],
          [3, 4],
        ],
        halted: false,
      },
      questions: {
        regime: {
          type: "choice",
          instructions: { compare: ["`now`", "`prior`"] },
          criteria: { same: null, changed: { means: "`now` differs from `prior`" } },
        },
      },
    };

    const wire = encodeDecisionRequest(request, { model: PINNED_MODEL, caps: HOSTED_CAPS });

    expect(JSON.stringify(wire)).toBe(
      JSON.stringify({ state: request.state, model: PINNED_MODEL, questions: request.questions }),
    );
  });

  it("sends only the fields the wire defines", () => {
    const annotated = offContract({
      state: STATE,
      model: "a-model-the-caller-chose",
      questions: { q: { ...PLAIN_NOUL, scope: "market", options: ["yes", "no"] } },
    });

    const wire = encodeDecisionRequest(annotated, { model: PINNED_MODEL, caps: HOSTED_CAPS });

    expect(JSON.stringify(wire)).toBe(
      JSON.stringify({ state: STATE, model: PINNED_MODEL, questions: { q: PLAIN_NOUL } }),
    );
  });
});

describe("decodeDecisionResponse", () => {
  it("decodes the documented Choice response", () => {
    const documented = fixtureBody("response.choice.documented.json", DOCUMENTED);

    const decoded = decodeDecisionResponse(documented, DOCUMENTED_CHOICE_REQUEST);

    expect(decoded).toStrictEqual({
      model: PINNED_MODEL,
      answers: {
        department: {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.88, technical: 0.12, sales: 0 },
          confidence: 0.81,
        },
      },
      probabilitySums: { department: expect.closeTo(1, FLOAT_SUM_DIGITS) },
    });
    expect(JSON.stringify(decoded.answers)).toBe(JSON.stringify(fieldOf(documented, "answers")));
  });

  it("a Noul answer has no confidence and none is invented", () => {
    const decoded = decodeDecisionResponse(
      fixtureBody("response.noul.constructed.json", CONSTRUCTED),
      CONSTRUCTED_NOUL_REQUEST,
    );
    const answer = decoded.answers.payment_failure;

    expect("confidence" in answer).toBe(false);
    expect(answer).toStrictEqual({ type: "noul", noul: 0.95 });
    expect(Object.keys(answer)).toEqual(["type", "noul"]);
    expect(decoded.probabilitySums).toStrictEqual({ payment_failure: null });
  });

  it("carries only the fields the contract defines for an answer's kind", () => {
    const payload = validTriagePayload();
    payload.answers.payment_failure.confidence = 0.9;
    payload.answers.department.answer_confidence = 0.4;

    const decoded = decodeDecisionResponse(payload, TRIAGE_REQUEST);

    expect(Object.keys(decoded.answers.payment_failure)).toEqual(["type", "noul"]);
    expect(Object.keys(decoded.answers.department)).toEqual(["type", "choice", "probabilities", "confidence"]);
  });

  it("decodes the constructed Score response", () => {
    const decoded = decodeDecisionResponse(
      fixtureBody("response.score.constructed.json", CONSTRUCTED),
      CONSTRUCTED_SCORE_REQUEST,
    );

    expect(decoded).toStrictEqual({
      model: PINNED_MODEL,
      answers: {
        urgency: {
          type: "score",
          score: 2.5,
          legend: {
            "0": URGENCY_LEVELS[0],
            "1": URGENCY_LEVELS[1],
            "2": URGENCY_LEVELS[2],
            "3": URGENCY_LEVELS[3],
          },
          probabilities: { "0": 0, "1": 0.125, "2": 0.25, "3": 0.625 },
          confidence: 0.5,
        },
      },
      probabilitySums: { urgency: 1 },
    });
    expect(Object.keys(decoded.answers.urgency)).toEqual(["type", "score", "legend", "probabilities", "confidence"]);
  });

  it("decodes a compatible server's body: its own model name, its own confidence, and fields the contract lacks", () => {
    const decoded = decodeDecisionResponse(
      fixtureBody("response.laya-serve-shape.constructed.json", CONSTRUCTED),
      DOCUMENTED_CHOICE_REQUEST,
    );

    expect(decoded.model).toBe("english");
    expect(decoded.answers.department).toMatchObject({ choice: "billing", confidence: 0.67 });
    expect(Object.keys(decoded)).toEqual(["model", "answers", "probabilitySums"]);
  });

  it("accepts a well-formed answer to a question of each kind", () => {
    const decoded = decodeDecisionResponse(validTriagePayload(), TRIAGE_REQUEST);

    expect(Object.keys(decoded.answers)).toEqual(["payment_failure", "department", "urgency"]);
    expect(Object.keys(decoded.probabilitySums)).toEqual(["payment_failure", "department", "urgency"]);
    expect(decoded.probabilitySums).toStrictEqual({
      payment_failure: null,
      department: expect.closeTo(1, FLOAT_SUM_DIGITS),
      urgency: 1,
    });
  });

  describe("each structural violation is rejected with its field path", () => {
    for (const { rule, fieldPath, corrupt } of RESPONSE_VIOLATIONS) {
      it(rule, () => {
        expectResponseRejected(corrupt(validTriagePayload()), fieldPath);
      });
    }
  });

  it("admits a tie for the highest probability, whichever tied option is named", () => {
    for (const choice of ["billing", "technical"]) {
      const payload = validTriagePayload();
      payload.answers.department.choice = choice;
      payload.answers.department.probabilities = { billing: 0.5, technical: 0.5, sales: 0 };

      const decoded = decodeDecisionResponse(payload, TRIAGE_REQUEST);

      expect(decoded.answers.department).toMatchObject({ choice });
    }
  });

  it("admits both ends of the range: a certain yes and a certain choice", () => {
    const payload = validTriagePayload();
    payload.answers.payment_failure.noul = 1;
    payload.answers.department.probabilities = { billing: 1, technical: 0, sales: 0 };

    const decoded = decodeDecisionResponse(payload, TRIAGE_REQUEST, { probabilitySumTolerance: 0 });

    expect(decoded.answers.payment_failure).toStrictEqual({ type: "noul", noul: 1 });
    expect(decoded.probabilitySums.department).toBe(1);
  });

  it("admits a score at either end of its scale: zero and the number of levels", () => {
    for (const score of [0, URGENCY_LEVELS.length]) {
      const payload = validTriagePayload();
      payload.answers.urgency.score = score;

      const decoded = decodeDecisionResponse(payload, TRIAGE_REQUEST);

      expect(decoded.answers.urgency).toMatchObject({ type: "score", score });
    }
  });

  it("holds a score to its scale and does not re-derive it from the distribution", () => {
    const payload = validTriagePayload();
    payload.answers.urgency.score = 0;
    payload.answers.urgency.probabilities = { "0": 0, "1": 0, "2": 0, "3": 1 };

    const decoded = decodeDecisionResponse(payload, TRIAGE_REQUEST);

    expect(decoded.answers.urgency).toMatchObject({
      type: "score",
      score: 0,
      probabilities: { "0": 0, "1": 0, "2": 0, "3": 1 },
    });
  });

  it("treats an id or an option that spells an inherited name as data, never as a lookup on the prototype", () => {
    const request = offContract(
      JSON.parse(
        '{"state":"s","questions":{"__proto__":{"type":"noul","instructions":"Is it so?"},' +
          '"pick":{"type":"choice","instructions":"Which one?","criteria":{"constructor":null,"toString":null}}}}',
      ),
    );
    const answered: unknown = JSON.parse(
      '{"model":"m","answers":{"__proto__":{"type":"noul","noul":0.5},"pick":{"type":"choice",' +
        '"choice":"toString","probabilities":{"toString":0.75,"constructor":0.25},"confidence":0.5}}}',
    );
    const unanswered: unknown = JSON.parse(
      '{"model":"m","answers":{"pick":{"type":"choice","choice":"toString",' +
        '"probabilities":{"toString":0.75,"constructor":0.25},"confidence":0.5}}}',
    );

    const wire = encodeDecisionRequest(request, { model: PINNED_MODEL, caps: HOSTED_CAPS });
    const decoded = decodeDecisionResponse(answered, request);

    expect(Object.keys(wire.questions)).toEqual(["__proto__", "pick"]);
    expect(JSON.stringify(wire)).toContain('"__proto__":{"type":"noul","instructions":"Is it so?"}');
    expect(Object.keys(decoded.answers)).toEqual(["__proto__", "pick"]);
    expect(Object.getOwnPropertyDescriptor(decoded.answers, "__proto__")?.value).toStrictEqual({
      type: "noul",
      noul: 0.5,
    });
    expect(asChoice(decoded.answers.pick).probabilities).toStrictEqual({ constructor: 0.25, toString: 0.75 });
    expectResponseRejected(unanswered, "answers.__proto__", request);
  });

  it("probability key order is canonical", () => {
    const requestOrder = Object.keys(DOCUMENTED_CHOICE_REQUEST.questions.department.criteria ?? {});
    const decodedFrom = (probabilities: Record<string, number>): ReturnType<typeof decodeDecisionResponse> =>
      decodeDecisionResponse(
        {
          model: PINNED_MODEL,
          answers: { department: { type: "choice", choice: "sales", probabilities, confidence: 0.55 } },
        },
        DOCUMENTED_CHOICE_REQUEST,
      );

    const first = decodedFrom({ sales: 0.7, technical: 0.2, billing: 0.1 });
    const second = decodedFrom({ technical: 0.2, billing: 0.1, sales: 0.7 });

    expect(requestOrder).toEqual(["billing", "technical", "sales"]);
    expect(Object.keys(asChoice(first.answers.department).probabilities)).toEqual(requestOrder);
    expect(Object.keys(asChoice(second.answers.department).probabilities)).toEqual(requestOrder);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.probabilitySums.department).toBe(second.probabilitySums.department);
  });

  it("the sum is reported and enforced only at the caller's tolerance", () => {
    const short = (): MutablePayload => {
      const payload = validTriagePayload();
      payload.answers.department.probabilities = { billing: 0.85, technical: 0.12, sales: 0 };
      return payload;
    };

    const unenforced = decodeDecisionResponse(short(), TRIAGE_REQUEST);
    expect(unenforced.probabilitySums.department).toBeCloseTo(0.97, FLOAT_SUM_DIGITS);
    expect(unenforced.answers.department).toMatchObject({
      probabilities: { billing: 0.85, technical: 0.12, sales: 0 },
    });

    const refused = thrownBy(() =>
      decodeDecisionResponse(short(), TRIAGE_REQUEST, { probabilitySumTolerance: TIGHT_TOLERANCE }),
    );
    expect(refused).toBeInstanceOf(DecisionResponseFormatError);
    expect(refused).toMatchObject({ fault: "schema", fieldPath: "answers.department.probabilities" });

    const admitted = decodeDecisionResponse(short(), TRIAGE_REQUEST, { probabilitySumTolerance: LOOSE_TOLERANCE });
    expect(admitted.probabilitySums.department).toBeCloseTo(0.97, FLOAT_SUM_DIGITS);
  });

  it("enforces the tolerance on a score's distribution too, and admits an exact sum at a tolerance of zero", () => {
    const exact = decodeDecisionResponse(validTriagePayload(), TRIAGE_REQUEST, { probabilitySumTolerance: 0 });
    expect(exact.probabilitySums.urgency).toBe(1);

    const short = validTriagePayload();
    short.answers.urgency.probabilities = { "0": 0, "1": 0.125, "2": 0.25, "3": 0.5 };
    const refused = thrownBy(() =>
      decodeDecisionResponse(short, TRIAGE_REQUEST, { probabilitySumTolerance: TIGHT_TOLERANCE }),
    );
    expect(refused).toBeInstanceOf(DecisionResponseFormatError);
    expect(refused).toMatchObject({ fieldPath: "answers.urgency.probabilities" });
  });

  it("reports a score distribution's sum as it is when no tolerance is passed", () => {
    const short = validTriagePayload();
    short.answers.urgency.probabilities = { "0": 0, "1": 0.125, "2": 0.25, "3": 0.5 };

    const decoded = decodeDecisionResponse(short, TRIAGE_REQUEST);

    expect(decoded.probabilitySums.urgency).toBe(0.875);
  });

  it("a tolerance of zero refuses a sum that float addition leaves one step from one", () => {
    const thirds = (): MutablePayload => {
      const payload = validTriagePayload();
      payload.answers.department.probabilities = { billing: 0.6, technical: 0.3, sales: 0.1 };
      return payload;
    };

    const reported = decodeDecisionResponse(thirds(), TRIAGE_REQUEST).probabilitySums.department;
    expect(reported).not.toBe(1);
    expect(reported).toBeCloseTo(1, FLOAT_SUM_DIGITS);

    const refused = thrownBy(() => decodeDecisionResponse(thirds(), TRIAGE_REQUEST, { probabilitySumTolerance: 0 }));
    expect(refused).toBeInstanceOf(DecisionResponseFormatError);
    expect(refused).toMatchObject({ fieldPath: "answers.department.probabilities" });
  });

  it("refuses decode options that are not an object, before it reads the response", () => {
    const error = thrownBy(() =>
      decodeDecisionResponse(validTriagePayload(), TRIAGE_REQUEST, offOptions<DecisionDecodeOptions>(null)),
    );

    expect(error).toBeInstanceOf(DecisionRequestInvalidError);
    expect(error).toMatchObject({ fault: "schema", source: "request_validation", fieldPath: "options" });
  });

  it.each([Number.NaN, -TIGHT_TOLERANCE, Number.POSITIVE_INFINITY])(
    "refuses a tolerance of %s instead of quietly enforcing nothing",
    (tolerance) => {
      const error = thrownBy(() =>
        decodeDecisionResponse(validTriagePayload(), TRIAGE_REQUEST, { probabilitySumTolerance: tolerance }),
      );

      expect(error).toBeInstanceOf(DecisionRequestInvalidError);
      expect(error).toMatchObject({
        fault: "schema",
        source: "request_validation",
        fieldPath: "options.probabilitySumTolerance",
      });
      expect(thrownBy(() => resolveProbabilitySumTolerance(tolerance))).toBeInstanceOf(DecisionRequestInvalidError);
    },
  );

  it("reads an absent tolerance as no enforcement and a stated one as itself", () => {
    expect(resolveProbabilitySumTolerance(undefined)).toBeNull();
    expect(resolveProbabilitySumTolerance(0)).toBe(0);
    expect(resolveProbabilitySumTolerance(TIGHT_TOLERANCE)).toBe(TIGHT_TOLERANCE);
  });

  it("decodes only against a request that could have been sent", () => {
    const unsendable = offContract({ state: STATE, questions: { q: { type: "rank", instructions: "Order these" } } });
    const payload = { model: PINNED_MODEL, answers: { q: { type: "rank", rank: ["a", "b"] } } };

    for (const [request, fieldPath] of [
      [unsendable, "questions.q.type"],
      [offContract({ state: STATE, questions: {} }), "questions"],
      [offContract(undefined), "$"],
    ] as const) {
      const error = thrownBy(() => decodeDecisionResponse(payload, request));

      expect(error).toBeInstanceOf(DecisionRequestInvalidError);
      expect(error).toMatchObject({ fault: "schema", source: "request_validation", fieldPath });
    }
  });

  it("a format error carries the usage the vendor billed", () => {
    const malformed = validTriagePayload();
    delete malformed.answers.department.confidence;

    const billed = thrownBy(() => decodeDecisionResponse(malformed, TRIAGE_REQUEST, { billedUsage: BILLED_USAGE }));
    expect(billed).toBeInstanceOf(DecisionResponseFormatError);
    expect(billed).toHaveProperty("usage", BILLED_USAGE);

    const unread = thrownBy(() => decodeDecisionResponse(malformed, TRIAGE_REQUEST));
    expect(unread).toBeInstanceOf(DecisionResponseFormatError);
    expect(unread).toHaveProperty("usage", null);

    const short = validTriagePayload();
    short.answers.department.probabilities = { billing: 0.85, technical: 0.12, sales: 0 };
    const overTolerance = thrownBy(() =>
      decodeDecisionResponse(short, TRIAGE_REQUEST, {
        billedUsage: BILLED_USAGE,
        probabilitySumTolerance: TIGHT_TOLERANCE,
      }),
    );
    expect(overTolerance).toBeInstanceOf(DecisionResponseFormatError);
    expect(overTolerance).toHaveProperty("usage", BILLED_USAGE);
  });

  it("carries a key the vendor sent only as a bounded, printable excerpt", () => {
    const hostile = `line one\nline two‮${"k".repeat(LONG_KEY_CHARS)}`;
    const payload = validTriagePayload();
    payload.answers.department.probabilities = { billing: 0.88, technical: 0.12, sales: 0, [hostile]: 0 };

    const error = thrownBy(() => decodeDecisionResponse(payload, TRIAGE_REQUEST, { billedUsage: BILLED_USAGE }));

    expect(error).toBeInstanceOf(DecisionResponseFormatError);
    const carried = Object.values(Object(error)).filter((value): value is string => typeof value === "string");
    expect(carried.length).toBeGreaterThan(0);
    for (const text of carried) {
      expect(text.length).toBeLessThanOrEqual(DECISION_ERROR_BODY_EXCERPT);
      expect(text).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    }
    expect(messageOf(error).length).toBeLessThanOrEqual(MESSAGE_BOUND);
    expect(messageOf(error)).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });

  it("refuses a legend entry nested deeper than any call stack without failing some other way", () => {
    let nested: unknown = Number.NaN;
    for (let level = 0; level < HOSTILE_NESTING_DEPTH; level++) {
      nested = [nested];
    }
    const payload = validTriagePayload();
    payload.answers.urgency.legend = { "0": "a", "1": "b", "2": nested, "3": "d" };

    const error = thrownBy(() => decodeDecisionResponse(payload, TRIAGE_REQUEST));

    expect(error).toBeInstanceOf(DecisionResponseFormatError);
    expect(fieldOf(error, "fieldPath")).toMatch(/^answers\.urgency\.legend\.2\[0\]\[0\]/);
  });
});

describe("the codec as a whole", () => {
  it("every rejection is a decision call error with the schema fault", () => {
    const refusedRequest = thrownBy(() =>
      encodeDecisionRequest(offContract({ state: null, questions: {} }), { model: PINNED_MODEL, caps: HOSTED_CAPS }),
    );
    const rejectedResponse = thrownBy(() => decodeDecisionResponse(null, TRIAGE_REQUEST));

    for (const error of [refusedRequest, rejectedResponse]) {
      expect(error).toBeInstanceOf(DecisionCallError);
      expect(Object.keys(Object(error))).toContain("fault");
      expect(error).toHaveProperty("fault", "schema");
    }
  });

  it("changes nothing it is given and answers the same way twice", () => {
    const request = deepFreeze(structuredClone(TRIAGE_REQUEST));
    const payload = deepFreeze(validTriagePayload());
    const caps = deepFreeze({ ...HOSTED_CAPS });

    const wire = encodeDecisionRequest(request, { model: PINNED_MODEL, caps });
    const decoded = decodeDecisionResponse(payload, request, { billedUsage: deepFreeze({ ...BILLED_USAGE }) });

    expect(JSON.stringify(encodeDecisionRequest(request, { model: PINNED_MODEL, caps }))).toBe(JSON.stringify(wire));
    expect(JSON.stringify(decodeDecisionResponse(payload, request))).toBe(JSON.stringify(decoded));
    expect(Object.keys(wire)).toEqual(["state", "model", "questions"]);
  });

  it("imports only the decision contract and reads no clock, environment or randomness", () => {
    const source = readFileSync(fileURLToPath(new URL("../../../llm/decision/codec.ts", import.meta.url)), "utf8");

    const { references, ambientNames } = outwardSurface(source);

    expect(references.map(({ specifier }) => specifier).sort()).toEqual([
      "../types",
      "./errors",
      "./route-types",
      "./types",
    ]);
    expect(references.filter(({ typeOnly }) => !typeOnly).map(({ specifier }) => specifier)).toEqual(["./errors"]);
    expect(ambientNames).toEqual([]);
  });

  describe("the outward-surface reading sees every way a module reaches outside itself", () => {
    for (const { form, source, references, ambientNames } of OUTWARD_FORMS) {
      it(form, () => {
        expect(outwardSurface(source)).toStrictEqual({ references, ambientNames });
      });
    }
  });
});
