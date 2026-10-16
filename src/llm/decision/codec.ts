/**
 * The decision codec: the request as it is sent, and the response as it is
 * accepted.
 *
 * Both directions are pure functions of their arguments. Neither reads a clock,
 * the environment or the network, so the same request encodes to the same
 * bytes wherever it runs, and a recorded response decodes in a test exactly as
 * it did on the wire.
 *
 * Encoding writes the request in the contract's own field order and refuses
 * what must not be sent: a state that is absent, a value with no JSON form
 * (which a serialiser would quietly turn into `null`, so the model would be
 * asked about a number nobody measured), a question the wire has no shape for,
 * or more options, levels or questions than the route admits. A refusal here
 * costs nothing: no request has left.
 *
 * Decoding accepts a response only when it answers exactly the questions that
 * were asked, each in the shape its kind has, over exactly the options or
 * levels the request offered. A response that fails is rejected whole. Nothing
 * is repaired: no unknown option is dropped, no distribution renormalised, no
 * missing field defaulted, because each of those would hand the caller a
 * well-typed value that no model produced. Nothing is added either: a yes/no
 * answer has no confidence on the wire and has none here.
 *
 * How closely a distribution sums to one is reported and not judged. The codec
 * holds no tolerance of its own; a caller that can afford to refuse an answer
 * passes the tolerance it refuses at.
 *
 * An error raised here names no route, status or request id, because the codec
 * knows none of them. The caller-facing client completes it.
 *
 * @module llm/decision/codec
 */

import type { LlmUsageRecord } from "../types";
import {
  DECISION_IMAGE_FORMATS,
  DECISION_IMAGE_LIMITS,
  decodeDecisionBase64,
  encodeDecisionBase64,
  formatsAgree,
  isDecisionImageFormat,
  isStrictDecisionBase64,
  measureDecisionImage,
  normaliseDecisionBase64,
  utf8ByteLength,
} from "./assets";
import type { DecisionImageFormat, DecisionImageMeasurement } from "./assets";
import { DecisionImagesNotEnabledError, DecisionRequestInvalidError, DecisionResponseFormatError } from "./errors";
import type { DecisionRequestViolation } from "./errors";
import type { DecisionRouteCaps } from "./route-types";
import type {
  DecisionAnswer,
  DecisionBox,
  DecisionChoiceQuestion,
  DecisionDangerZone,
  DecisionDescription,
  DecisionJsonArray,
  DecisionJsonObject,
  DecisionNoulCriteria,
  DecisionQuestion,
  DecisionRequest,
  DecisionScoreQuestion,
  DecisionWireAsset,
  DecisionWireRequest,
} from "./types";

/**
 * The fewest levels a score may have.
 *
 * A property of the wire contract and not of a route: a scale of one level
 * orders nothing.
 */
const MIN_SCORE_LEVELS = 2;

/** The path that names a request or a response body itself, not a field of it. */
const ROOT_PATH = "$";

/** The least value a probability may take. */
const PROBABILITY_MIN = 0;

/** The greatest value a probability may take. */
const PROBABILITY_MAX = 1;

/** What the probabilities of a distribution sum to when they are exact. */
const DISTRIBUTION_TOTAL = 1;

/**
 * The least value a score may take.
 *
 * A score is a probability-weighted level, so it lies between the lowest and
 * the highest level number. Levels are numbered from zero or from one, and the
 * lowest either numbering reaches is zero.
 */
const SCORE_MIN = 0;

/** The name of the method a serialiser calls on a value to have it write itself. */
const SELF_SERIALISER = "toJSON";

/**
 * The edges a box answer carries, in the order they are read.
 *
 * Each is a fraction of the image's own width or height, so each is held to the
 * same range a probability is: from zero to one, both ends admitted.
 */
const BOX_EDGES: readonly string[] = ["top", "bottom", "left", "right"];

/** How a request is encoded. */
export interface DecisionEncodeOptions {
  /** The model id written into the request: the pin of the route being called. */
  readonly model: string;
  /** The request-size limits of the route being called. */
  readonly caps: DecisionRouteCaps;
  /**
   * The vendor surfaces the call opted in to.
   *
   * Absent means neither is on. A request carrying an image or an
   * image-locating question without the image opt-in is refused: the surface is
   * never turned on for a caller that did not name it.
   */
  readonly dangerZone?: DecisionDangerZone;
}

/** How a response is decoded. */
export interface DecisionDecodeOptions {
  /**
   * How far a distribution's sum may differ from one before the response is
   * rejected. Absent means the sum is reported and not enforced.
   *
   * Zero is not "exact": probabilities that sum to one on paper are added as
   * floats, and the sum can land one rounding step away. A caller that means
   * "sums to one" passes a tolerance wider than that step.
   */
  readonly probabilitySumTolerance?: number;
  /**
   * What the vendor billed for the response, when the caller has read it.
   *
   * It is carried on a rejection, so an answer that was paid for and could not
   * be used is not reported as free. Absent or `null` means nothing was read,
   * and the rejection then says so with `null`, never with zero counts.
   */
  readonly billedUsage?: LlmUsageRecord | null;
}

/** A validated response. */
export interface DecodedDecisionResponse {
  /**
   * The model the response reports answered, whole.
   *
   * It is what the response says and nothing more: whether it is the model the
   * route pins is the caller's comparison to make.
   */
  readonly model: string;
  /**
   * One answer per question, in the request's question order, each holding the
   * fields the contract defines for its kind with distribution keys in the
   * request's option order.
   *
   * A `score` and a `confidence` are the vendor's own statistics, carried as
   * stated. A score is held to its scale and a confidence to being a finite
   * number; neither is recomputed from `probabilities` or compared with them,
   * so either can disagree with the distribution beside it. A consumer that
   * needs a value it can defend computes it from `probabilities`.
   */
  readonly answers: Readonly<Record<string, DecisionAnswer>>;
  /**
   * The raw sum of each answer's distribution, by question id, added in the
   * request's option order so the same distribution always reports the same
   * sum. `null` for a yes/no answer, which has no distribution.
   */
  readonly probabilitySums: Readonly<Record<string, number | null>>;
}

/** An object of string keys, as a JSON parser produces and an object literal builds. */
type PlainObject = Readonly<Record<string, unknown>>;

/** Text or structured data: the shape of a state, of instructions and of a description. */
type Structured = string | DecisionJsonObject | DecisionJsonArray;

/** Builds the error for one offending field. Each direction has its own. */
type Raise = (fieldPath: string, reason: string) => Error;

/** One value reached while walking a tree, with the way back to the root. */
interface JsonVisit {
  readonly value: unknown;
  readonly parent: JsonVisit | null;
  /** How this value is addressed from its parent, such as `.close` or `[3]`. */
  readonly segment: string;
}

/** One step of a walk: a value to examine, or a container whose contents are all examined. */
type JsonStep =
  | { readonly leave: false; readonly visit: JsonVisit }
  | { readonly leave: true; readonly container: object };

/** The first thing in a tree that has no JSON form, and where it is. */
interface JsonDefect {
  /** The path from the root of the tree, empty for the root itself. */
  readonly path: string;
  readonly reason: string;
}

/** One decoded answer and the sum of its distribution. */
interface DecodedAnswer {
  readonly answer: DecisionAnswer;
  readonly probabilitySum: number | null;
}

/** What decoding an answer needs beyond the answer itself. */
interface DecodeContext {
  /** The caller's tolerance, or `null` when the sum is not enforced. */
  readonly tolerance: number | null;
  readonly malformed: Raise;
}

/**
 * Whether a value is a plain object.
 *
 * An instance of a class is not one: a serialiser writes it as whatever its
 * own conversion returns, which need not resemble the fields it holds.
 *
 * @param value The value to test.
 * @returns True for an object whose prototype is the plain one or none.
 */
function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether a value is an array.
 *
 * @param value The value to test.
 * @returns True for an array, typed with elements that are still unknown.
 */
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Read a field an object holds itself.
 *
 * A key that comes from data, such as a question id or an option, can spell the
 * name of something every object inherits. A plain read would then return the
 * inherited thing where the data holds nothing, so a missing answer could be
 * read as present. This reads only what the object itself holds.
 *
 * @param record The object to read from.
 * @param key The field's name.
 * @returns The field's value, or `undefined` when the object does not hold it.
 */
function ownValue(record: PlainObject, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/**
 * Say what kind of thing a value is, without quoting it.
 *
 * A reason describes a value by kind because the value itself may be a
 * vendor's text of unbounded size.
 *
 * @param value The value to describe.
 * @returns A short phrase naming its kind.
 */
function kindOf(value: unknown): string {
  if (value === undefined) {
    return "absent";
  }
  if (value === null) {
    return "null";
  }
  if (isList(value)) {
    return "an array";
  }
  if (isPlainObject(value)) {
    return "an object";
  }
  if (typeof value === "object") {
    return "an object that is not plain data";
  }
  return `a ${typeof value}`;
}

/**
 * The path of a visited value from the root of its tree.
 *
 * Assembled only for the one value a walk reports, so a walk costs no path
 * building for the values that are sound.
 *
 * @param visit The visited value.
 * @returns Its path, empty for the root.
 */
function pathOf(visit: JsonVisit): string {
  const segments: string[] = [];
  for (let at: JsonVisit | null = visit; at !== null; at = at.parent) {
    segments.push(at.segment);
  }
  return segments.reverse().join("");
}

/**
 * Find the first value in a tree that JSON cannot carry.
 *
 * JSON carries strings, booleans, `null`, finite numbers, arrays and plain
 * objects. A serialiser handed anything else does not fail: it writes `null`
 * for a number that is not finite, omits an absent field, and writes a class
 * instance as something other than its fields. Each of those changes the data
 * without a trace, so the tree is checked before it is serialised.
 *
 * The walk keeps its own stack, so a tree nested deeper than the call stack is
 * examined like any other, and it tracks the containers it is inside, so a
 * tree that contains itself is reported and not followed for ever. One object
 * held in two places is not a cycle and is admitted.
 *
 * A container that carries its own conversion is refused as well: a serialiser
 * writes what the conversion returns, which is not what was examined here.
 *
 * @param root The tree to examine.
 * @returns The first defect in document order, or `null` when there is none.
 */
function findJsonDefect(root: unknown): JsonDefect | null {
  const open = new Set<object>();
  const steps: JsonStep[] = [{ leave: false, visit: { value: root, parent: null, segment: "" } }];
  for (let step = steps.pop(); step !== undefined; step = steps.pop()) {
    if (step.leave) {
      open.delete(step.container);
      continue;
    }
    const { visit } = step;
    const { value } = visit;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return { path: pathOf(visit), reason: "is a number that is not finite, which has no JSON form" };
      }
      continue;
    }
    if (typeof value === "string" || typeof value === "boolean" || value === null) {
      continue;
    }
    if (typeof value !== "object" || !(isList(value) || isPlainObject(value))) {
      return { path: pathOf(visit), reason: `is ${kindOf(value)}, which has no JSON form` };
    }
    if (open.has(value)) {
      return { path: pathOf(visit), reason: "contains itself, which has no JSON form" };
    }
    if (typeof Reflect.get(value, SELF_SERIALISER) === "function") {
      return { path: pathOf(visit), reason: "writes itself as something else when serialised, so is not plain data" };
    }
    open.add(value);
    steps.push({ leave: true, container: value });
    if (isList(value)) {
      for (let index = value.length - 1; index >= 0; index--) {
        steps.push({ leave: false, visit: { value: value[index], parent: visit, segment: `[${index}]` } });
      }
    } else {
      const keys = Object.keys(value);
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index];
        steps.push({ leave: false, visit: { value: value[key], parent: visit, segment: `.${key}` } });
      }
    }
  }
  return null;
}

/**
 * Require a value to be text or structured data that JSON can carry.
 *
 * @param value The value to check.
 * @param fieldPath Where the value sits, for the error.
 * @param raise Builds the error of the direction being checked.
 * @throws What `raise` builds, naming the value or the first thing inside it
 *   that JSON cannot carry.
 */
function assertStructured(value: unknown, fieldPath: string, raise: Raise): asserts value is Structured {
  if (typeof value !== "string" && !isList(value) && !isPlainObject(value)) {
    throw raise(fieldPath, `must be a string, an object or an array, and is ${kindOf(value)}`);
  }
  const defect = findJsonDefect(value);
  if (defect !== null) {
    throw raise(`${fieldPath}${defect.path}`, defect.reason);
  }
}

/**
 * Build the error for a request that must not be sent.
 *
 * @param fieldPath The offending field.
 * @param reason What is wrong with it.
 * @returns The error, naming no route.
 */
function invalidRequest(fieldPath: string, reason: string): DecisionRequestInvalidError {
  return new DecisionRequestInvalidError({ source: "request_validation", fieldPath, reason });
}

/**
 * Build the error for a request that breaks one named rule of the contract.
 *
 * The code travels with the error, so a caller branches on the rule rather
 * than on the wording of a message.
 *
 * @param violation The rule that was broken.
 * @param fieldPath The offending field.
 * @param reason What is wrong with it.
 * @returns The error, naming no route.
 */
function violatesRule(
  violation: DecisionRequestViolation,
  fieldPath: string,
  reason: string,
): DecisionRequestInvalidError {
  return new DecisionRequestInvalidError({ source: "request_validation", fieldPath, reason, violation });
}

/**
 * Require a call's options to be an object.
 *
 * The type requires it of a typed caller. A caller that passes nothing, or
 * `null`, is told so in the codec's own error and not by a failed property
 * read, so every refusal the codec makes is one a caller can classify.
 *
 * @param options The options as passed.
 * @throws DecisionRequestInvalidError when they are not an object.
 */
function assertOptions(options: unknown): asserts options is object {
  if (typeof options !== "object" || options === null) {
    throw invalidRequest("options", `a call's options must be an object, and are ${kindOf(options)}`);
  }
}

/**
 * Read a request as the object it must be.
 *
 * @param request The caller's request.
 * @returns The request's fields, still unchecked.
 * @throws DecisionRequestInvalidError when the request is not an object.
 */
function fieldsOfRequest(request: unknown): PlainObject {
  if (!isPlainObject(request)) {
    throw invalidRequest(ROOT_PATH, `a request must be an object, and is ${kindOf(request)}`);
  }
  return request;
}

/**
 * Read one optional description of a yes/no question.
 *
 * @param value The description, or `undefined` when none is given.
 * @param fieldPath Where it sits, for the error.
 * @returns The description, or `undefined` when none is given.
 */
function readOptionalDescription(value: unknown, fieldPath: string): DecisionDescription | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertStructured(value, fieldPath, invalidRequest);
  return value;
}

/**
 * Read the criteria of a yes/no question.
 *
 * Only a yes and a no can be described, and they are written yes first.
 * Criteria that describe neither are not sent: the field is optional on the
 * wire, and an empty object says nothing its absence does not.
 *
 * @param raw The caller's criteria, or `undefined` when there are none.
 * @param fieldPath Where they sit, for the error.
 * @returns The criteria to send, or `null` when there is nothing to send.
 */
function readNoulCriteria(raw: unknown, fieldPath: string): DecisionNoulCriteria | null {
  if (raw === undefined) {
    return null;
  }
  if (!isPlainObject(raw)) {
    throw invalidRequest(fieldPath, `must be an object describing true and false, and is ${kindOf(raw)}`);
  }
  for (const key of Object.keys(raw)) {
    if (key !== "true" && key !== "false") {
      throw invalidRequest(`${fieldPath}.${key}`, "a yes/no question describes only true and false");
    }
  }
  const yes = readOptionalDescription(ownValue(raw, "true"), `${fieldPath}.true`);
  const no = readOptionalDescription(ownValue(raw, "false"), `${fieldPath}.false`);
  if (yes === undefined && no === undefined) {
    return null;
  }
  return { ...(yes === undefined ? {} : { true: yes }), ...(no === undefined ? {} : { false: no }) };
}

/**
 * Read the criteria of a choice: the map whose keys are its options.
 *
 * A limit is compared so that a limit which is not a number admits nothing.
 *
 * @param raw The caller's criteria.
 * @param fieldPath Where they sit, for the error.
 * @param caps The route's limits, or `null` to apply only the contract's own.
 * @returns The options, each with its description or `null`.
 */
function readChoiceCriteria(
  raw: unknown,
  fieldPath: string,
  caps: DecisionRouteCaps | null,
): DecisionChoiceQuestion["criteria"] {
  if (!isPlainObject(raw)) {
    throw invalidRequest(fieldPath, `a choice needs an object whose keys are its options, and has ${kindOf(raw)}`);
  }
  const options = Object.keys(raw);
  if (options.length === 0) {
    throw invalidRequest(fieldPath, "a choice needs at least one option");
  }
  if (caps !== null && !(options.length <= caps.maxOptions)) {
    throw invalidRequest(fieldPath, `${options.length} options exceed the route's limit of ${caps.maxOptions}`);
  }
  return Object.fromEntries(
    options.map((option): [string, DecisionDescription | null] => {
      const description = raw[option];
      if (description === null) {
        return [option, null];
      }
      assertStructured(description, `${fieldPath}.${option}`, invalidRequest);
      return [option, description];
    }),
  );
}

/**
 * Read the criteria of a score: its levels, lowest first.
 *
 * @param raw The caller's criteria.
 * @param fieldPath Where they sit, for the error.
 * @param caps The route's limits, or `null` to apply only the contract's own.
 * @returns The level descriptions, in order.
 */
function readScoreCriteria(
  raw: unknown,
  fieldPath: string,
  caps: DecisionRouteCaps | null,
): DecisionScoreQuestion["criteria"] {
  if (!isList(raw)) {
    throw invalidRequest(fieldPath, `a score needs an ordered array of level descriptions, and has ${kindOf(raw)}`);
  }
  if (raw.length < MIN_SCORE_LEVELS) {
    throw invalidRequest(fieldPath, `a score needs at least ${MIN_SCORE_LEVELS} levels, and has ${raw.length}`);
  }
  if (caps !== null && !(raw.length <= caps.maxScoreLevels)) {
    throw invalidRequest(fieldPath, `${raw.length} levels exceed the route's limit of ${caps.maxScoreLevels}`);
  }
  return Array.from(raw, (level, index): DecisionDescription => {
    assertStructured(level, `${fieldPath}[${index}]`, invalidRequest);
    return level;
  });
}

/**
 * Read one question and rebuild it with the wire's fields in the wire's order.
 *
 * Only `type`, `instructions` and `criteria` are carried. A field the wire does
 * not define is the caller's own annotation and is not sent.
 *
 * @param raw The caller's question.
 * @param fieldPath Where it sits, for the error.
 * @param caps The route's limits, or `null` to apply only the contract's own.
 * @returns The question as it is sent.
 */
function readQuestion(raw: unknown, fieldPath: string, caps: DecisionRouteCaps | null): DecisionQuestion {
  if (!isPlainObject(raw)) {
    throw invalidRequest(fieldPath, `a question must be an object, and is ${kindOf(raw)}`);
  }
  const { type, instructions } = raw;
  if (type !== "noul" && type !== "choice" && type !== "score" && type !== "box") {
    throw invalidRequest(`${fieldPath}.type`, "a question's type must be noul, choice, score or box");
  }
  assertStructured(instructions, `${fieldPath}.instructions`, invalidRequest);
  const criteriaPath = `${fieldPath}.criteria`;
  switch (type) {
    case "noul": {
      const criteria = readNoulCriteria(raw.criteria, criteriaPath);
      return criteria === null ? { type, instructions } : { type, instructions, criteria };
    }
    case "choice":
      return { type, instructions, criteria: readChoiceCriteria(raw.criteria, criteriaPath, caps) };
    case "score":
      return { type, instructions, criteria: readScoreCriteria(raw.criteria, criteriaPath, caps) };
    case "box": {
      // The route's own model decides this, not the contract: the older pinned
      // model serves every other kind and not this one, so a box sent to it
      // would be refused by the vendor after the call was paid for. `caps` is
      // null only when a response is being decoded against the request that
      // was already sent, where the question's admissibility is settled.
      if (caps !== null && !caps.box) {
        throw violatesRule(
          "box_unsupported_by_route",
          `${fieldPath}.type`,
          "a question locating something in an image is served only by the route pinned to the newer model",
        );
      }
      if (raw.criteria !== undefined) {
        throw invalidRequest(criteriaPath, "a question locating something in an image takes no criteria");
      }
      return { type, instructions };
    }
  }
}

/**
 * Read the questions of a request.
 *
 * Both directions read them through here, so a response is decoded against
 * questions that passed the same checks the request was sent under and never
 * against a shape that was only assumed.
 *
 * @param raw The request's question map.
 * @param caps The route's limits, or `null` to apply only the contract's own.
 * @returns The questions as they are sent, in the caller's order.
 */
function readQuestions(raw: unknown, caps: DecisionRouteCaps | null): Readonly<Record<string, DecisionQuestion>> {
  if (!isPlainObject(raw)) {
    throw invalidRequest(
      "questions",
      `must be an object mapping each question id to its question, and is ${kindOf(raw)}`,
    );
  }
  const ids = Object.keys(raw);
  if (ids.length === 0) {
    throw invalidRequest("questions", "a request must ask at least one question");
  }
  if (caps !== null && caps.maxQuestions !== null && !(ids.length <= caps.maxQuestions)) {
    throw invalidRequest("questions", `${ids.length} questions exceed the route's limit of ${caps.maxQuestions}`);
  }
  return Object.fromEntries(
    ids.map((id): [string, DecisionQuestion] => [id, readQuestion(raw[id], `questions.${id}`, caps)]),
  );
}

/** One image as it is sent, with what was measured about the file it came from. */
interface ReadAsset {
  readonly wire: DecisionWireAsset;
  readonly measurement: DecisionImageMeasurement;
}

/**
 * Read one image into the form it is sent in, measuring the file itself.
 *
 * The bytes come either from the caller directly or from decoding the base64
 * it passed, and every check below is made against those bytes rather than
 * against what the caller said about them. The format is the file's own
 * signature; a declared format that disagrees refuses the request, because a
 * PNG labelled `jpg` is a file the vendor rejects as damaged and the caller
 * would read that as an outage. A file whose header cannot be read is not a
 * file of zero pixels: it is unreadable, and it is refused as that.
 *
 * @param raw The caller's asset.
 * @param fieldPath Where it sits, for the error.
 * @returns The wire asset and the measurement behind it.
 * @throws DecisionRequestInvalidError, carrying the rule's own code, for every
 *   shape and limit an image can break.
 */
function readAsset(raw: unknown, fieldPath: string): ReadAsset {
  if (!isPlainObject(raw)) {
    throw violatesRule("asset_not_object", fieldPath, `an image must be an object, and is ${kindOf(raw)}`);
  }
  const { type } = raw;
  if (type !== undefined && type !== "image") {
    throw invalidRequest(`${fieldPath}.type`, 'an asset\'s type, when it is given, is "image"');
  }
  const raw_format = raw.format;
  if (raw_format !== undefined && !isDecisionImageFormat(raw_format)) {
    throw invalidRequest(
      `${fieldPath}.format`,
      `a format, when it is given, is one of ${DECISION_IMAGE_FORMATS.join(", ")}`,
    );
  }
  const declared: DecisionImageFormat | undefined = raw_format;
  const hasBytes = raw.bytes !== undefined;
  const hasText = raw.data_base64 !== undefined;
  if (hasBytes && hasText) {
    throw violatesRule(
      "asset_source_ambiguous",
      fieldPath,
      "an image is given once, as bytes or as base64 text, and this one is given as both",
    );
  }
  if (!hasBytes && !hasText) {
    throw violatesRule("asset_source_missing", fieldPath, "an image needs its bytes or its base64 text");
  }

  let bytes: Uint8Array;
  let text: string;
  if (hasBytes) {
    const given = raw.bytes;
    if (!(given instanceof Uint8Array)) {
      throw violatesRule("asset_source_missing", `${fieldPath}.bytes`, `must be a Uint8Array, and is ${kindOf(given)}`);
    }
    bytes = given;
    text = encodeDecisionBase64(given);
  } else {
    const given = raw.data_base64;
    if (typeof given !== "string") {
      throw violatesRule(
        "asset_base64_malformed",
        `${fieldPath}.data_base64`,
        `must be base64 text, and is ${kindOf(given)}`,
      );
    }
    text = normaliseDecisionBase64(given);
    if (text.length === 0 || !isStrictDecisionBase64(text)) {
      throw violatesRule(
        "asset_base64_malformed",
        `${fieldPath}.data_base64`,
        "must be base64 in the standard alphabet, padded with = to a whole group of four",
      );
    }
    bytes = decodeDecisionBase64(text);
  }

  const reading = measureDecisionImage(bytes);
  if (!reading.measured) {
    const reason: Readonly<Record<typeof reading.defect, [DecisionRequestViolation, string]>> = {
      image_format_unknown: ["asset_format_unknown", "is neither a PNG nor a JPEG"],
      image_animated: ["asset_animated", "is an animated PNG, and only a still image is accepted"],
      image_header_unreadable: [
        "asset_header_unreadable",
        "has a header its size cannot be read from: it is damaged, cut short, or not the format it opens as",
      ],
    };
    const [violation, said] = reason[reading.defect];
    throw violatesRule(violation, fieldPath, `the image ${said}`);
  }
  const measurement = reading.measurement;
  if (declared !== undefined && !formatsAgree(declared, measurement.format)) {
    throw violatesRule(
      "asset_format_mismatch",
      `${fieldPath}.format`,
      `is ${declared} and the file's own signature says it is ${measurement.format}`,
    );
  }
  const { minSidePx, maxSidePx, minTotalPx, maxTotalPx, maxImageBytes } = DECISION_IMAGE_LIMITS;
  const { widthPx, heightPx, byteLength } = measurement;
  const smallest = Math.min(widthPx, heightPx);
  const largest = Math.max(widthPx, heightPx);
  if (smallest < minSidePx) {
    throw violatesRule(
      "asset_side_too_small",
      fieldPath,
      `the image is ${widthPx} by ${heightPx} and every side is at least ${minSidePx} pixels`,
    );
  }
  if (largest > maxSidePx) {
    throw violatesRule(
      "asset_side_too_large",
      fieldPath,
      `the image is ${widthPx} by ${heightPx} and no side is over ${maxSidePx} pixels`,
    );
  }
  const totalPx = widthPx * heightPx;
  if (totalPx < minTotalPx) {
    throw violatesRule(
      "asset_pixels_too_few",
      fieldPath,
      `the image holds ${totalPx} pixels and at least ${minTotalPx} are needed`,
    );
  }
  if (totalPx > maxTotalPx) {
    throw violatesRule(
      "asset_pixels_too_many",
      fieldPath,
      `the image holds ${totalPx} pixels and no more than ${maxTotalPx} are accepted`,
    );
  }
  if (byteLength > maxImageBytes) {
    throw violatesRule(
      "asset_file_too_large",
      fieldPath,
      `the image file is ${byteLength} bytes and no more than ${maxImageBytes} are accepted`,
    );
  }
  return { wire: { type: "image", format: measurement.format, data_base64: text }, measurement };
}

/**
 * Read the request's images, and hold the references to their own limits.
 *
 * A reference is matched as plain text, so an empty or blank one would match
 * everywhere; the contract refuses both and so does this. The byte lengths are
 * the contract's own, counted as UTF-8 because that is what is sent.
 *
 * @param raw The caller's asset map, or `undefined` when the request has none.
 * @param fieldPath Where it sits, for the error.
 * @returns The assets read, or `null` when the request has none.
 * @throws DecisionRequestInvalidError, carrying the rule's own code.
 */
function readAssets(raw: unknown, fieldPath: string): Readonly<Record<string, ReadAsset>> | null {
  if (raw === undefined) {
    return null;
  }
  if (!isPlainObject(raw)) {
    throw violatesRule(
      "asset_not_object",
      fieldPath,
      `must be an object mapping each reference to its image, and is ${kindOf(raw)}`,
    );
  }
  const references = Object.keys(raw);
  if (references.length === 0) {
    // An empty map is not the same as none: it says an image was meant to be
    // here, and a request that silently went without it would be answered
    // about a state the caller never sent.
    throw violatesRule("asset_map_empty", fieldPath, "holds no image; leave it out for a request that has none");
  }
  let referencesBytes = 0;
  for (const reference of references) {
    if (reference.trim() === "") {
      throw violatesRule("reference_blank", `${fieldPath}.${reference}`, "a reference cannot be empty or only whitespace");
    }
    const bytes = utf8ByteLength(reference);
    if (bytes > DECISION_IMAGE_LIMITS.maxReferenceBytes) {
      throw violatesRule(
        "reference_too_long",
        `${fieldPath}.${reference}`,
        `a reference is at most ${DECISION_IMAGE_LIMITS.maxReferenceBytes} bytes of UTF-8, and this one is ${bytes}`,
      );
    }
    referencesBytes += bytes;
  }
  if (referencesBytes > DECISION_IMAGE_LIMITS.maxReferencesBytes) {
    throw violatesRule(
      "references_too_long",
      fieldPath,
      `the references are ${referencesBytes} bytes of UTF-8 together and at most ` +
        `${DECISION_IMAGE_LIMITS.maxReferencesBytes} are accepted`,
    );
  }
  return Object.fromEntries(
    references.map((reference): [string, ReadAsset] => [reference, readAsset(raw[reference], `${fieldPath}.${reference}`)]),
  );
}

/**
 * Count how often each reference stands in the strings of a request.
 *
 * Only string VALUES are read. An object key is never replaced by its image,
 * so a Choice option named after a reference stays text and must not be
 * counted as a use. Within one string the references are matched left to
 * right and never overlap, which is the contract's own rule; the longest
 * match at a position wins, so the count does not depend on the order the
 * caller wrote the asset map in.
 *
 * @param root The request as it is sent, without its asset map.
 * @param references The references to look for.
 * @returns How many times each reference stands in the request.
 */
function countReferenceUses(root: unknown, references: readonly string[]): Readonly<Record<string, number>> {
  const uses = new Map<string, number>(references.map((reference): [string, number] => [reference, 0]));
  const longestFirst = [...references].sort((left, right) => right.length - left.length || (left < right ? -1 : 1));
  const countIn = (text: string): void => {
    let at = 0;
    while (at < text.length) {
      const found = longestFirst.find((reference) => text.startsWith(reference, at));
      if (found === undefined) {
        at += 1;
        continue;
      }
      uses.set(found, (uses.get(found) ?? 0) + 1);
      at += found.length;
    }
  };
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      countIn(value);
      return;
    }
    if (isList(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (isPlainObject(value)) {
      for (const key of Object.keys(value)) {
        walk(value[key]);
      }
    }
  };
  walk(root);
  return Object.fromEntries(uses);
}

/**
 * Hold a request with images to the limits that span the whole of it.
 *
 * Four rules are checked here because none of them is a property of one image.
 * Every asset must be referenced, or the vendor refuses the request. The
 * distinct images have a combined ceiling. The body that is sent has one. And
 * the request as the model reads it, with every reference replaced by its
 * image, has one: each use adds the image again, so one large image used four
 * times is four times its size.
 *
 * The expanded reading counts the images alone. The text, the questions and
 * the structure add to the vendor's figure and are not counted, so this check
 * refuses a request that is certainly over the limit and never refuses one it
 * cannot show to be: a request that passes here can still be refused by the
 * vendor, as the status that says so.
 *
 * @param body The request as it is sent, assets included.
 * @param assets The assets read, with their measurements.
 * @throws DecisionRequestInvalidError, carrying the rule's own code.
 */
function assertRequestWithinLimits(body: DecisionWireRequest, assets: Readonly<Record<string, ReadAsset>>): void {
  const references = Object.keys(assets);
  const { assets: _sent, ...withoutAssets } = body;
  const uses = countReferenceUses(withoutAssets, references);
  for (const reference of references) {
    if (uses[reference] === 0) {
      throw violatesRule(
        "asset_unreferenced",
        `assets.${reference}`,
        "is referenced nowhere in the state, the instructions or the criteria",
      );
    }
  }
  const combinedBytes = references.reduce((total, reference) => total + assets[reference].measurement.byteLength, 0);
  if (combinedBytes > DECISION_IMAGE_LIMITS.maxCombinedImageBytes) {
    throw violatesRule(
      "assets_combined_too_large",
      "assets",
      `the images are ${combinedBytes} bytes together and at most ` +
        `${DECISION_IMAGE_LIMITS.maxCombinedImageBytes} are accepted`,
    );
  }
  const expandedBytes = references.reduce(
    (total, reference) => total + uses[reference] * assets[reference].measurement.byteLength,
    0,
  );
  if (expandedBytes > DECISION_IMAGE_LIMITS.maxExpandedRequestBytes) {
    throw violatesRule(
      "expanded_request_too_large",
      "assets",
      `the images come to ${expandedBytes} bytes once every reference is replaced by the image it stands for, ` +
        `and at most ${DECISION_IMAGE_LIMITS.maxExpandedRequestBytes} are accepted`,
    );
  }
}

/**
 * Hold the body that is sent to the contract's own size limit.
 *
 * Measured as the UTF-8 bytes of the text that goes on the wire, because the
 * limit counts bytes and every character outside ASCII is more than one.
 * Applied to every request, with images or without: a state of text alone can
 * reach the limit too.
 *
 * @param body The request as it is sent.
 * @throws DecisionRequestInvalidError when the body is over the limit, and when
 *   it cannot be written at all.
 */
function assertBodyWithinLimit(body: DecisionWireRequest): void {
  let text: string | undefined;
  try {
    text = JSON.stringify(body);
  } catch {
    text = undefined;
  }
  if (typeof text !== "string") {
    throw invalidRequest(ROOT_PATH, "the request cannot be written as JSON");
  }
  const bytes = utf8ByteLength(text);
  if (bytes > DECISION_IMAGE_LIMITS.maxRequestBodyBytes) {
    throw violatesRule(
      "request_body_too_large",
      ROOT_PATH,
      `the request body is ${bytes} bytes of UTF-8 and at most ` +
        `${DECISION_IMAGE_LIMITS.maxRequestBodyBytes} are accepted`,
    );
  }
}

/**
 * Require the image surface to have been asked for, when the request needs it.
 *
 * The vendor's surface is off by default and it says so in its own words: the
 * image and box surface is not yet ready for production. So a request that
 * carries an image, or a question that locates something in one, is refused
 * here unless the call named the surface. The alternative — turning the header
 * on because the request happens to need it — would enable a surface its own
 * vendor calls unready on behalf of a caller who never read that sentence.
 *
 * It is asked before an image is read, and that order matters twice. It is the
 * one request fault a caller can clear by its own act, so it is the useful
 * thing to be told; and reading an image means decoding and measuring every
 * byte of it, which is work spent on a request that was never going to be sent.
 *
 * The presence of the `assets` field is what counts, not what it holds: a
 * caller that wrote the field meant to send an image, and an empty map or a
 * malformed one is still a request that needs the surface.
 *
 * @param hasAssets Whether the request carries an `assets` field at all.
 * @param questions The questions as they are sent.
 * @param dangerZone What the call opted in to.
 * @throws {DecisionImagesNotEnabledError} When the surface is needed and was
 *   not asked for, naming the first field that needs it.
 */
function assertImagesAsked(
  hasAssets: boolean,
  questions: Readonly<Record<string, DecisionQuestion>>,
  dangerZone: DecisionDangerZone | undefined,
): void {
  const boxIds = Object.keys(questions).filter((id) => questions[id].type === "box");
  if ((!hasAssets && boxIds.length === 0) || dangerZone?.images === true) {
    return;
  }
  throw new DecisionImagesNotEnabledError({
    source: "request_validation",
    fieldPath: hasAssets ? "assets" : `questions.${boxIds[0]}`,
  });
}

/**
 * Require a question that locates something in an image to have one to look in.
 *
 * The contract states it: such a question "needs an image in the request".
 * Without one it would be answered with four edges of nothing, and a box is
 * always four edges, so the emptiness would not show in the answer.
 *
 * @param assets The assets read, or `null` when the request has none.
 * @param questions The questions as they are sent.
 * @throws DecisionRequestInvalidError when a box question has no image to look in.
 */
function assertBoxHasImage(
  assets: Readonly<Record<string, ReadAsset>> | null,
  questions: Readonly<Record<string, DecisionQuestion>>,
): void {
  if (assets !== null) {
    return;
  }
  const boxId = Object.keys(questions).find((id) => questions[id].type === "box");
  if (boxId !== undefined) {
    throw violatesRule(
      "box_needs_image",
      `questions.${boxId}`,
      "a question locating something in an image needs an image in the request",
    );
  }
}

/**
 * Encode a caller's request as the body that is sent.
 *
 * The body has its fields in the contract's order: `state`, `model`,
 * `questions`, and inside a question `type`, `instructions`, `criteria`. The
 * model id is the route's and never the caller's.
 *
 * @param request The state, and the questions about it.
 * @param options The model id to write and the route's limits.
 * @returns The request body.
 * An image is listed once in `assets` under the reference that stands for it
 * in the request's text. Each one is measured from its own bytes before
 * anything is sent, and held to every limit the contract states: the format,
 * the sides, the area, the file's size, the images' combined size, the size of
 * the request once each reference is replaced by its image, and the size of
 * the body. A request this package knows the vendor will refuse never leaves,
 * and each refusal carries the code of the rule it broke.
 *
 * @throws DecisionRequestInvalidError, naming the offending field, when the
 *   options or the route's limits are absent; when the state is not text or
 *   structured data; when anything in the state, the instructions or a
 *   description has no JSON form; when no question is asked; when a question
 *   has no instructions or is of no known kind; when a yes/no question
 *   describes anything but true and false; when a choice offers no option; when
 *   a score has fewer than two levels; when a question locating something in an
 *   image carries criteria, is sent to a route whose model does not serve it,
 *   or has no image to look in; when the options, levels or questions exceed
 *   the route's limits; or when an image, a reference or the request as a whole
 *   breaks one of the contract's size rules, in which case the error carries
 *   that rule's code.
 * @throws {DecisionImagesNotEnabledError} When the request carries an image or
 *   a question locating something in one and the call did not ask for the
 *   vendor's image surface.
 */
export function encodeDecisionRequest(request: DecisionRequest, options: DecisionEncodeOptions): DecisionWireRequest {
  assertOptions(options);
  const { model, caps, dangerZone } = options;
  if (typeof model !== "string" || model.length === 0) {
    throw invalidRequest("model", "a request must name the model its route pins");
  }
  if (typeof caps !== "object" || caps === null) {
    throw invalidRequest("options.caps", `a request is encoded under its route's limits, and they are ${kindOf(caps)}`);
  }
  if (dangerZone !== undefined && (typeof dangerZone !== "object" || dangerZone === null)) {
    throw invalidRequest(
      "options.dangerZone",
      `the surfaces a call opts in to are an object, and are ${kindOf(dangerZone)}`,
    );
  }
  const fields = fieldsOfRequest(request);
  const { state } = fields;
  assertStructured(state, "state", invalidRequest);
  const questions = readQuestions(fields.questions, caps);
  // Asked before an image is read: it is the fault a caller can clear by its
  // own act, and reading an image is work spent on a request that is refused.
  assertImagesAsked(Object.hasOwn(fields, "assets") && fields.assets !== undefined, questions, dangerZone);
  const assets = readAssets(fields.assets, "assets");
  assertBoxHasImage(assets, questions);
  const body: DecisionWireRequest =
    assets === null
      ? { state, model, questions }
      : {
          state,
          model,
          assets: Object.fromEntries(
            Object.keys(assets).map((reference): [string, DecisionWireAsset] => [reference, assets[reference].wire]),
          ),
          questions,
        };
  if (assets !== null) {
    assertRequestWithinLimits(body, assets);
  }
  assertBodyWithinLimit(body);
  return body;
}

/**
 * Read the tolerance a caller wants a distribution's sum held to.
 *
 * A tolerance that is not a finite number of zero or more is refused. Compared
 * against, it would admit every sum, so the caller would have asked for a check
 * and silently received none.
 *
 * A caller that dispatches a paid call can run this before dispatch, so a bad
 * tolerance is refused before anything is spent.
 *
 * @param tolerance The caller's tolerance, or `undefined` when it gave none.
 * @returns The tolerance, or `null` when the sum is to be reported and not enforced.
 * @throws DecisionRequestInvalidError when a tolerance is given and is unusable.
 */
export function resolveProbabilitySumTolerance(tolerance: number | undefined): number | null {
  if (tolerance === undefined) {
    return null;
  }
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
    throw invalidRequest(
      "options.probabilitySumTolerance",
      "a tolerance must be a finite number of zero or more; leave it out to have the sum reported and not enforced",
    );
  }
  return tolerance;
}

/**
 * Read a number that must be finite.
 *
 * @param value The value to read.
 * @param fieldPath Where it sits, for the error.
 * @param malformed Builds the rejection.
 * @returns The number.
 */
function readFinite(value: unknown, fieldPath: string, malformed: Raise): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw malformed(fieldPath, `must be a finite number, and is ${kindOf(value)}`);
  }
  return value;
}

/**
 * Read a probability.
 *
 * @param value The value to read.
 * @param fieldPath Where it sits, for the error.
 * @param malformed Builds the rejection.
 * @returns The probability, from zero to one.
 */
function readProbability(value: unknown, fieldPath: string, malformed: Raise): number {
  const probability = readFinite(value, fieldPath, malformed);
  if (probability < PROBABILITY_MIN || probability > PROBABILITY_MAX) {
    throw malformed(fieldPath, `a probability lies from ${PROBABILITY_MIN} to ${PROBABILITY_MAX}`);
  }
  return probability;
}

/**
 * Read a map that must hold exactly a given set of keys, and rebuild it in the
 * given order.
 *
 * The order a vendor writes a map in varies from call to call. Rebuilding it
 * in the request's order makes two answers with the same content structurally
 * identical, so a consumer may compare or hash them.
 *
 * @param raw The map as received.
 * @param keys The keys it must hold, in the order to rebuild it in.
 * @param fieldPath Where it sits, for the error.
 * @param malformed Builds the rejection.
 * @param readValue Reads one value of the map.
 * @returns The map, holding exactly `keys` in their order.
 */
function readExactMap<T>(
  raw: unknown,
  keys: readonly string[],
  fieldPath: string,
  malformed: Raise,
  readValue: (value: unknown, valuePath: string, malformed: Raise) => T,
): Readonly<Record<string, T>> {
  if (!isPlainObject(raw)) {
    throw malformed(fieldPath, `must be an object with one entry per option or level, and is ${kindOf(raw)}`);
  }
  const expected = new Set(keys);
  for (const key of Object.keys(raw)) {
    if (!expected.has(key)) {
      throw malformed(`${fieldPath}.${key}`, "is not an option or a level of the question");
    }
  }
  return Object.fromEntries(
    keys.map((key): [string, T] => [key, readValue(ownValue(raw, key), `${fieldPath}.${key}`, malformed)]),
  );
}

/**
 * Read a distribution over a given set of keys, and its sum.
 *
 * The sum is added in the order of `keys`, so it does not depend on the order
 * the vendor wrote the map in. It is compared with one only when the caller
 * passed a tolerance.
 *
 * @param raw The distribution as received.
 * @param keys The options or levels it must cover, in the request's order.
 * @param fieldPath Where it sits, for the error.
 * @param context The caller's tolerance and the rejection builder.
 * @returns The distribution in the request's order, and its raw sum.
 */
function readDistribution(
  raw: unknown,
  keys: readonly string[],
  fieldPath: string,
  context: DecodeContext,
): { readonly probabilities: Readonly<Record<string, number>>; readonly sum: number } {
  const probabilities = readExactMap(raw, keys, fieldPath, context.malformed, readProbability);
  const sum = keys.reduce((total, key) => total + probabilities[key], 0);
  if (context.tolerance !== null && Math.abs(sum - DISTRIBUTION_TOTAL) > context.tolerance) {
    throw context.malformed(
      fieldPath,
      `the probabilities sum to ${sum}, further from ${DISTRIBUTION_TOTAL} than the caller's tolerance of ` +
        `${context.tolerance}`,
    );
  }
  return { probabilities, sum };
}

/**
 * Read one legend entry: a level's description as the vendor returned it.
 *
 * @param value The entry.
 * @param fieldPath Where it sits, for the error.
 * @param malformed Builds the rejection.
 * @returns The description.
 */
function readLegendEntry(value: unknown, fieldPath: string, malformed: Raise): DecisionDescription {
  assertStructured(value, fieldPath, malformed);
  return value;
}

/**
 * Decode the answer to a choice.
 *
 * The named option must be one the request offered and must have the highest
 * probability. A tie is admitted with either tied option named: which of two
 * equal options a vendor names is not specified, and neither is wrong.
 *
 * @param raw The answer as received.
 * @param question The question it answers.
 * @param fieldPath Where the answer sits, for the error.
 * @param context The caller's tolerance and the rejection builder.
 * @returns The answer and the sum of its distribution.
 */
function decodeChoice(
  raw: PlainObject,
  question: DecisionChoiceQuestion,
  fieldPath: string,
  context: DecodeContext,
): DecodedAnswer {
  const options = Object.keys(question.criteria);
  const { choice } = raw;
  if (typeof choice !== "string" || !Object.hasOwn(question.criteria, choice)) {
    throw context.malformed(`${fieldPath}.choice`, "must name one of the options the question offered");
  }
  const { probabilities, sum } = readDistribution(raw.probabilities, options, `${fieldPath}.probabilities`, context);
  const chosen = probabilities[choice];
  if (options.some((option) => probabilities[option] > chosen)) {
    throw context.malformed(`${fieldPath}.choice`, "names an option that does not have the highest probability");
  }
  const confidence = readFinite(raw.confidence, `${fieldPath}.confidence`, context.malformed);
  return { answer: { type: "choice", choice, probabilities, confidence }, probabilitySum: sum };
}

/**
 * Decode the answer to a score.
 *
 * The legend and the distribution must each be keyed by exactly the level
 * indexes of the request, written as strings from zero.
 *
 * The score is a probability-weighted level and may fall between two, so it is
 * held to the span every numbering of the levels shares: zero, the lowest level
 * when they are numbered from zero, to the number of levels, the highest when
 * they are numbered from one. Both ends are admitted. A value outside that span
 * is one no weighting of the levels can produce under either numbering.
 *
 * Nothing narrower is checked. The score and the confidence are the vendor's
 * own statistics: neither is recomputed from the distribution or compared with
 * it, because how the vendor numbers the levels it weighs and how it derives
 * its confidence are its own and are not stated by the contract. A check that
 * the score agrees with the distribution would enforce a relation nobody
 * published. A consumer that needs a value it can defend computes it from
 * `probabilities`.
 *
 * @param raw The answer as received.
 * @param question The question it answers.
 * @param fieldPath Where the answer sits, for the error.
 * @param context The caller's tolerance and the rejection builder.
 * @returns The answer and the sum of its distribution.
 */
function decodeScore(
  raw: PlainObject,
  question: DecisionScoreQuestion,
  fieldPath: string,
  context: DecodeContext,
): DecodedAnswer {
  const levels = question.criteria.map((_, index) => String(index));
  const score = readFinite(raw.score, `${fieldPath}.score`, context.malformed);
  if (score < SCORE_MIN || score > levels.length) {
    throw context.malformed(
      `${fieldPath}.score`,
      `a score over ${levels.length} levels lies from ${SCORE_MIN} to ${levels.length}`,
    );
  }
  const legend = readExactMap(raw.legend, levels, `${fieldPath}.legend`, context.malformed, readLegendEntry);
  const { probabilities, sum } = readDistribution(raw.probabilities, levels, `${fieldPath}.probabilities`, context);
  const confidence = readFinite(raw.confidence, `${fieldPath}.confidence`, context.malformed);
  return { answer: { type: "score", score, legend, probabilities, confidence }, probabilitySum: sum };
}

/**
 * Decode the answer to a question about where something is in an image.
 *
 * Each edge is a fraction of the image's own size, so each lies from zero to
 * one; and a box encloses something, so its left edge is left of its right and
 * its top above its bottom. Both are properties of what a box IS, and an answer
 * that breaks either is not a box however well-formed its fields are: a
 * consumer would multiply the edges by the image's size and crop a rectangle of
 * negative width.
 *
 * It carries no distribution, so there is no sum to report.
 *
 * @param raw The answer as received.
 * @param fieldPath Where the answer sits, for the error.
 * @param context The rejection builder.
 * @returns The answer, with no distribution sum.
 */
function decodeBox(raw: PlainObject, fieldPath: string, context: DecodeContext): DecodedAnswer {
  const boxPath = `${fieldPath}.box`;
  const { box } = raw;
  if (!isPlainObject(box)) {
    throw context.malformed(boxPath, `must be an object holding the four edges, and is ${kindOf(box)}`);
  }
  const edges = BOX_EDGES.map((edge): [string, number] => [
    edge,
    readProbability(box[edge], `${boxPath}.${edge}`, context.malformed),
  ]);
  const read: Readonly<Record<string, number>> = Object.fromEntries(edges);
  if (!(read.left < read.right)) {
    throw context.malformed(boxPath, "the left edge must lie left of the right edge");
  }
  if (!(read.top < read.bottom)) {
    throw context.malformed(boxPath, "the top edge must lie above the bottom edge");
  }
  const confidence = readFinite(raw.confidence, `${fieldPath}.confidence`, context.malformed);
  const decoded: DecisionBox = { top: read.top, bottom: read.bottom, left: read.left, right: read.right };
  return { answer: { type: "box", box: decoded, confidence }, probabilitySum: null };
}

/**
 * Decode one answer against the question it answers.
 *
 * The answer is rebuilt from the fields the contract defines for its kind and
 * nothing else, so a yes/no answer never gains a confidence and a field a
 * serving stack adds of its own is not passed on as if the contract held it.
 *
 * @param raw The answer as received.
 * @param question The question it answers.
 * @param fieldPath Where the answer sits, for the error.
 * @param context The caller's tolerance and the rejection builder.
 * @returns The answer and the sum of its distribution, `null` for a yes/no.
 */
function decodeAnswer(
  raw: unknown,
  question: DecisionQuestion,
  fieldPath: string,
  context: DecodeContext,
): DecodedAnswer {
  if (!isPlainObject(raw)) {
    throw context.malformed(fieldPath, `an answer must be an object, and is ${kindOf(raw)}`);
  }
  if (raw.type !== question.type) {
    throw context.malformed(`${fieldPath}.type`, `the question is a ${question.type} and the answer is not`);
  }
  switch (question.type) {
    case "noul": {
      const noul = readProbability(raw.noul, `${fieldPath}.noul`, context.malformed);
      return { answer: { type: "noul", noul }, probabilitySum: null };
    }
    case "choice":
      return decodeChoice(raw, question, fieldPath, context);
    case "score":
      return decodeScore(raw, question, fieldPath, context);
    case "box":
      return decodeBox(raw, fieldPath, context);
  }
}

/**
 * Validate a response body against the request it answers.
 *
 * @param payload The parsed response body.
 * @param request The request the body answers.
 * @param options The caller's tolerance for a distribution's sum, and what the
 *   vendor billed for the response.
 * @returns The answering model, the answers and each distribution's sum.
 * @throws DecisionResponseFormatError, naming the offending field and carrying
 *   the billed usage, when the body is not an object; when it reports no model;
 *   when it does not answer exactly the questions asked; when an answer is of
 *   another kind than its question; when a yes/no answer or a probability is
 *   not a finite number from zero to one; when a distribution or a legend does
 *   not cover exactly the request's options or levels; when a choice names an
 *   option that was not offered or does not have the highest probability; when
 *   a score is not a finite number from zero to the number of levels; when a
 *   box is not an object of four edges, each from zero to one, whose left edge
 *   lies left of its right and whose top lies above its bottom; when a
 *   confidence is not a finite number; or when a distribution's sum is further
 *   from one than a tolerance the caller passed.
 * @throws DecisionRequestInvalidError when the options are not an object, the
 *   tolerance is unusable, or the request is not one that could have been sent.
 */
export function decodeDecisionResponse(
  payload: unknown,
  request: DecisionRequest,
  options: DecisionDecodeOptions = {},
): DecodedDecisionResponse {
  assertOptions(options);
  const tolerance = resolveProbabilitySumTolerance(options.probabilitySumTolerance);
  const questions = readQuestions(fieldsOfRequest(request).questions, null);
  const usage = options.billedUsage ?? null;
  const malformed: Raise = (fieldPath, reason) =>
    new DecisionResponseFormatError({ fieldPath, reason, status: null, usage, vendorRequestId: null });

  if (!isPlainObject(payload)) {
    throw malformed(ROOT_PATH, `a response body must be an object, and is ${kindOf(payload)}`);
  }
  const { model, answers } = payload;
  if (typeof model !== "string" || model.length === 0) {
    throw malformed("model", "a response must report the model that answered");
  }
  if (!isPlainObject(answers)) {
    throw malformed("answers", `must be an object with one answer per question, and is ${kindOf(answers)}`);
  }
  for (const id of Object.keys(answers)) {
    if (!Object.hasOwn(questions, id)) {
      throw malformed(`answers.${id}`, "answers a question the request did not ask");
    }
  }
  const context: DecodeContext = { tolerance, malformed };
  const decoded = Object.keys(questions).map((id): [string, DecodedAnswer] => [
    id,
    decodeAnswer(ownValue(answers, id), questions[id], `answers.${id}`, context),
  ]);
  return {
    model,
    answers: Object.fromEntries(decoded.map(([id, { answer }]): [string, DecisionAnswer] => [id, answer])),
    probabilitySums: Object.fromEntries(
      decoded.map(([id, { probabilitySum }]): [string, number | null] => [id, probabilitySum]),
    ),
  };
}
