/**
 * The decision contract probe: what it sends, and what it keeps of a response.
 *
 * The hosted decision contract was read from a vendor's reference and has never
 * been exercised with a credential. The probe is the first authenticated call:
 * an operator runs it once an account exists, and what it reports is the
 * evidence a route's contract is declared confirmed on.
 *
 * Two things are decided here, both as pure functions, so each can be checked
 * with no network.
 *
 * What is sent. One request per question kind, each the example the contract
 * fixtures hold, addressed to the route's pinned model and written by the same
 * encoder a production call uses. And one request that encoder refuses, a
 * choice with its instructions taken out, because the body a vendor rejects a
 * request with is documented by name only and can be seen no other way.
 * Nothing else is ever sent: no request built to find a limit and no content
 * written to steer the model. The vendor's terms forbid testing its service
 * for weaknesses, and confirming a contract needs neither.
 *
 * What is kept. A response is a vendor's text, and the probe's report is a file
 * an operator attaches to a review. So an observation holds numbers and
 * classifications this package defines, and nothing a vendor wrote: the
 * status, which of a closed list of shapes the body has, how long the body is,
 * and the NAMES of the headers it carried out of a short list. It never holds
 * a body, the value of a header, or anything of the request, which is where
 * the key is.
 *
 * @module scripts/decision-probe/probe-plan
 */

import { encodeDecisionRequest } from "../../src/llm/decision/codec";
import { RETRY_AFTER_HEADER, RETRY_AFTER_MS_HEADER } from "../../src/llm/decision/metering";
import type { DecisionRouteCaps } from "../../src/llm/decision/route-types";
import { VENDOR_REQUEST_ID_HEADER } from "../../src/llm/decision/transports/systemone";
import type { DecisionJsonObject, DecisionRequest, DecisionWireRequest } from "../../src/llm/decision/types";

/** The question kinds the contract defines, each of which the probe asks once per sample. */
export const PROBE_ANSWERABLE_SHAPES = ["choice", "noul", "score"] as const;

/** One request shape a vendor is expected to answer. */
export type ProbeAnswerableShape = (typeof PROBE_ANSWERABLE_SHAPES)[number];

/** The request shape a vendor is expected to refuse: a choice that carries no instructions. */
export const PROBE_REFUSAL_SHAPE = "choice_without_instructions";

/** One request shape the probe sends. */
export type ProbeShape = ProbeAnswerableShape | typeof PROBE_REFUSAL_SHAPE;

/** How many times each answerable shape is asked unless the operator says otherwise. */
export const PROBE_DEFAULT_SAMPLES = 1;

/**
 * The most times one shape may be asked in a run.
 *
 * Enough to state a 99th percentile and to ask whether a hundred identical
 * requests return identical answers, which is the largest sample any question
 * about this contract calls for. A run is a measurement, never a load.
 */
export const PROBE_MAX_SAMPLES = 100;

/** The state every probe request is asked about: the one the vendor's own example uses. */
const PROBE_STATE = "Help! My payouts have been failing for 3 days.";

/** The options of the vendor's own example of a choice, each with its description. */
const CHOICE_CRITERIA: Readonly<Record<string, string>> = {
  billing: "Payments, invoicing, refunds",
  technical: "Bugs, outages, integrations",
  sales: "Pricing, upgrades, new accounts",
};

/**
 * The request asked for each answerable shape.
 *
 * The choice is the one example the vendor's reference quotes. The reference
 * quotes none for the other two kinds, so they are the ones the contract
 * fixtures assemble from its field tables, about the same state.
 */
const ANSWERABLE_REQUESTS: Readonly<Record<ProbeAnswerableShape, DecisionRequest>> = {
  choice: {
    state: PROBE_STATE,
    questions: {
      department: { type: "choice", instructions: "Which team should handle this?", criteria: CHOICE_CRITERIA },
    },
  },
  noul: {
    state: PROBE_STATE,
    questions: {
      payment_failure: {
        type: "noul",
        instructions: "Is the customer reporting a payment that failed?",
        criteria: {
          true: "The message describes a payment or payout that did not complete",
          false: "The message is about anything else",
        },
      },
    },
  },
  score: {
    state: PROBE_STATE,
    questions: {
      urgency: {
        type: "score",
        instructions: "How urgent is this request?",
        criteria: [
          "No action is needed",
          "Can wait for the normal queue",
          "Needs attention today",
          "Blocks the customer right now",
        ],
      },
    },
  },
};

/** A request a vendor is expected to answer. */
export interface ProbeAnswerableRequest {
  readonly expect: "answer";
  readonly shape: ProbeAnswerableShape;
  /** What is asked, as a caller writes it. An answer is decoded against this. */
  readonly request: DecisionRequest;
  /** The body sent: the request as the production encoder writes it for the route. */
  readonly body: DecisionWireRequest;
}

/** A request a vendor is expected to refuse. */
export interface ProbeRefusedRequest {
  readonly expect: "refusal";
  readonly shape: typeof PROBE_REFUSAL_SHAPE;
  /**
   * The body sent. Typed as plain JSON and not as a wire request, because it
   * is not one: the wire type requires the field this body leaves out.
   */
  readonly body: DecisionJsonObject;
}

/** One request of the plan. */
export type ProbeRequest = ProbeAnswerableRequest | ProbeRefusedRequest;

/** What a plan is built for: the model a route pins and the limits it declares. */
export interface ProbePlanTarget {
  readonly modelPin: string;
  readonly caps: DecisionRouteCaps;
}

/** How a plan is varied. */
export interface ProbePlanOptions {
  /** How many times each answerable shape is asked. One unless given. */
  readonly samples?: number;
  /** Whether the request a vendor is expected to refuse is sent. It is unless this is `false`. */
  readonly includeRefusal?: boolean;
}

/** What a run sends, and in what order. */
export interface ProbePlan {
  /** How many times each answerable shape is asked. */
  readonly samples: number;
  /** The distinct requests: one per answerable shape, then the refused one when it is sent. */
  readonly requests: readonly ProbeRequest[];
  /**
   * Every call of the run, in the order it is made.
   *
   * The answerable shapes are asked in turn, so that a vendor whose latency
   * drifts during a run drifts under every shape alike. The refused request
   * is made once and last: its body is what is wanted from it, it has no
   * latency worth a sample, and a vendor that answers an invalid request
   * slowly must not sit between two timed calls.
   */
  readonly dispatches: readonly ProbeRequest[];
}

/** Thrown when a plan is asked for that the probe will not send. */
export class ProbePlanError extends Error {
  /**
   * @param message What about the plan is refused.
   */
  public constructor(message: string) {
    super(message);
    this.name = "ProbePlanError";
  }
}

/**
 * Build the plan of a run.
 *
 * With no options the plan is four calls: the three answerable shapes once
 * each, then the refused request. More samples repeat the answerable shapes
 * and nothing else.
 *
 * @param target The model the route pins and the limits it declares.
 * @param options The number of samples, and whether the refused request is sent.
 * @returns The plan.
 * @throws {ProbePlanError} When the number of samples is not a whole number
 *   from one to {@link PROBE_MAX_SAMPLES}.
 */
export function buildProbePlan(target: ProbePlanTarget, options: ProbePlanOptions = {}): ProbePlan {
  const samples = options.samples ?? PROBE_DEFAULT_SAMPLES;
  if (!Number.isInteger(samples) || samples < 1 || samples > PROBE_MAX_SAMPLES) {
    throw new ProbePlanError(
      `each shape is asked a whole number of times from 1 to ${PROBE_MAX_SAMPLES}; ` +
        "a run is a measurement and never a load",
    );
  }
  const answerable = PROBE_ANSWERABLE_SHAPES.map((shape): ProbeAnswerableRequest => {
    const request = ANSWERABLE_REQUESTS[shape];
    return {
      expect: "answer",
      shape,
      request,
      body: encodeDecisionRequest(request, { model: target.modelPin, caps: target.caps }),
    };
  });
  const refused: ProbeRefusedRequest[] =
    options.includeRefusal === false
      ? []
      : [
          {
            expect: "refusal",
            shape: PROBE_REFUSAL_SHAPE,
            body: {
              state: PROBE_STATE,
              model: target.modelPin,
              questions: { department: { type: "choice", criteria: CHOICE_CRITERIA } },
            },
          },
        ];
  return {
    samples,
    requests: [...answerable, ...refused],
    dispatches: [...Array.from({ length: samples }, () => answerable).flat(), ...refused],
  };
}

/**
 * The response headers whose presence an observation records.
 *
 * The media type of the body, the vendor's id for the request, and the two
 * forms a retry hint is sent in.
 */
export const PROBE_RECORDED_HEADERS: readonly string[] = [
  "content-type",
  VENDOR_REQUEST_ID_HEADER,
  RETRY_AFTER_HEADER,
  RETRY_AFTER_MS_HEADER,
];

/**
 * What the name of a rate-limit header begins with.
 *
 * A vendor's reference names no such header on an answer and none has been
 * seen, so the probe records the name of any header that begins this way.
 */
export const PROBE_RECORDED_HEADER_PREFIX = "x-ratelimit";

/**
 * The form a header name must have to be written down.
 *
 * A name comes from the vendor as much as a value does. One made of lower-case
 * letters, digits and dashes and of ordinary length is a name; anything else is
 * counted and not written.
 */
const PLAIN_HEADER_NAME = /^[a-z0-9-]{1,64}$/;

/**
 * The shapes a response body is sorted into.
 *
 * - `unreadable`: the body could not be read.
 * - `empty`: no body, or only whitespace.
 * - `not_json`: text that is not JSON.
 * - `answers`: an object naming a model and holding answers, as a success does.
 * - `detail_error_type_message`: the one failure body ever observed, an object
 *   holding only `detail`, which holds only a text `error_type` and `message`.
 * - `detail_message`, `detail_string`, `detail_list_loc_msg`, `error_string`,
 *   `error_message`, `message`: the other shapes the vendor's own client reads
 *   a failure from.
 * - `other_json`: JSON of any other shape.
 */
export const PROBE_BODY_SHAPES = [
  "unreadable",
  "empty",
  "not_json",
  "answers",
  "detail_error_type_message",
  "detail_message",
  "detail_string",
  "detail_list_loc_msg",
  "error_string",
  "error_message",
  "message",
  "other_json",
] as const;

/** One shape of a response body. See {@link PROBE_BODY_SHAPES}. */
export type ProbeBodyShape = (typeof PROBE_BODY_SHAPES)[number];

/** The headers of a response, as far as an observation reads them. A fetch response's own satisfy it. */
export interface ProbeResponseHeaders {
  /**
   * @param visit Called once per header with its value and its name.
   */
  forEach(visit: (value: string, name: string) => void): void;
}

/** What an observation is made from: a response, and nothing of the request that drew it. */
export interface ProbeObservedResponse {
  readonly status: number;
  readonly headers: ProbeResponseHeaders;
  /** The whole body as text, or `null` when it could not be read. */
  readonly body: string | null;
}

/** What the probe keeps of one response. */
export interface ProbeObservation {
  readonly status: number;
  /** The names of the recorded headers the response carried, sorted. Never a value. */
  readonly headersPresent: readonly string[];
  /** How many rate-limit headers had a name that is not written down. */
  readonly headerNamesWithheld: number;
  /** Which of the closed list of shapes the body has. */
  readonly bodyShape: ProbeBodyShape;
  /** The length of the body in characters, or `null` when it could not be read. */
  readonly bodyCharacters: number | null;
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
 * Whether an object's keys are exactly the ones given.
 *
 * @param record The object.
 * @param keys The keys it must hold, and no others.
 * @returns True when the two sets are equal.
 */
function hasExactlyKeys(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

/**
 * Sort the `detail` member of a failure body into a shape.
 *
 * @param body The parsed body, which holds a `detail`.
 * @returns The shape, or `null` when `detail` has none of the known ones.
 */
function shapeOfDetail(body: Readonly<Record<string, unknown>>): ProbeBodyShape | null {
  const detail = body.detail;
  if (typeof detail === "string") {
    return "detail_string";
  }
  if (Array.isArray(detail)) {
    const entries: readonly unknown[] = detail;
    const located = (entry: unknown): boolean =>
      isRecord(entry) && Object.hasOwn(entry, "loc") && typeof entry.msg === "string";
    return entries.length > 0 && entries.every(located) ? "detail_list_loc_msg" : null;
  }
  if (!isRecord(detail) || typeof detail.message !== "string") {
    return null;
  }
  const observed =
    hasExactlyKeys(body, ["detail"]) &&
    hasExactlyKeys(detail, ["error_type", "message"]) &&
    typeof detail.error_type === "string" &&
    detail.error_type !== "";
  return observed ? "detail_error_type_message" : "detail_message";
}

/**
 * Sort a response body into one of the closed list of shapes.
 *
 * Only the structure is read. The result names a shape this package defines
 * and carries no text of the body, so it can be written where the body cannot.
 *
 * @param body The body as text.
 * @returns The shape.
 */
export function describeProbeBody(body: string): ProbeBodyShape {
  if (body.trim() === "") {
    return "empty";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "not_json";
  }
  if (!isRecord(parsed)) {
    return "other_json";
  }
  if (typeof parsed.model === "string" && isRecord(parsed.answers)) {
    return "answers";
  }
  if (Object.hasOwn(parsed, "detail")) {
    return shapeOfDetail(parsed) ?? "other_json";
  }
  if (typeof parsed.error === "string") {
    return "error_string";
  }
  if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
    return "error_message";
  }
  if (typeof parsed.message === "string") {
    return "message";
  }
  return "other_json";
}

/**
 * Record what the probe keeps of a response.
 *
 * The argument is a response and only a response. Nothing of the request can
 * reach an observation, because nothing of the request is handed to this
 * function.
 *
 * @param response The status, the headers and the body of a response.
 * @returns The observation: a status, header names, and the body's shape and length.
 */
export function recordObservation(response: ProbeObservedResponse): ProbeObservation {
  const present = new Set<string>();
  let headerNamesWithheld = 0;
  response.headers.forEach((_value, name) => {
    const lower = name.toLowerCase();
    if (PROBE_RECORDED_HEADERS.includes(lower)) {
      present.add(lower);
    } else if (lower.startsWith(PROBE_RECORDED_HEADER_PREFIX)) {
      if (PLAIN_HEADER_NAME.test(lower)) {
        present.add(lower);
      } else {
        headerNamesWithheld += 1;
      }
    }
  });
  return {
    status: response.status,
    headersPresent: [...present].sort(),
    headerNamesWithheld,
    bodyShape: response.body === null ? "unreadable" : describeProbeBody(response.body),
    bodyCharacters: response.body === null ? null : response.body.length,
  };
}
