/**
 * Wire and call types for typed decision models.
 *
 * A typed decision model is asked a bounded question about a piece of state and
 * answers with a probability distribution over the question's own options. It
 * writes no prose, so its contract is a shape rather than a prompt: a request
 * of `state`, `model` and `questions`, and one answer per question under the
 * key the caller chose.
 *
 * The wire types here follow the hosted contract field for field and add
 * nothing to it. A question has `type`, `instructions` and `criteria`, and the
 * three answer kinds differ in more than name: a yes/no answer is one number
 * and carries no vendor confidence at all, a choice carries a distribution over
 * the options, and a score carries an expected level, a legend and a
 * distribution keyed by level index. A consumer that wants one shape for all
 * three builds it from these; this layer never invents the missing field.
 *
 * An image travels the same way. It is listed once in the request's top-level
 * `assets` map under a reference string, and that reference is written wherever
 * the image belongs: in the state, in a question's instructions, or in the
 * criteria a question is judged against. The wire carries the reference and the
 * asset separately, so the same image used in three places is uploaded once and
 * read three times. A question that locates something in an image is a fourth
 * question kind, and its answer is four edges rather than a distribution: it is
 * kept apart from the three that return probabilities, because a consumer that
 * treated a box as a distribution would read a coordinate as a likelihood.
 *
 * A decision route is its own vocabulary. It is not a generative alias, and no
 * type here can be passed where an alias is expected, so a typed call can never
 * be routed through the generative chain's fallback, hedging or budgets.
 *
 * @module llm/decision/types
 */

import type { LlmUsageRecord } from "../types";
import type { DecisionImageFormat } from "./assets";
import type { DecisionFault } from "./errors";

/**
 * The decision routes a caller may name.
 *
 * `dm.hosted` and `dm.hosted.preview` are answered by a vendor over HTTP
 * through this package. They are two routes rather than one route with a
 * choice of model, because a route IS its pinned model together with the caps,
 * budget and price that model is served under: a caller that could name the
 * model would be able to move the answering model without a reviewed change to
 * the table. `dm.hosted.preview` is pinned to the vendor's newest release and
 * is the only route that admits a question locating something in an image.
 *
 * `dm.local` is declared here, so every consumer reads one table, and is
 * answered by the consumer's own process: this package never serves it.
 */
export const DECISION_ROUTES = ["dm.hosted", "dm.hosted.preview", "dm.local"] as const;

/** One decision route. See {@link DECISION_ROUTES}. */
export type DecisionRoute = (typeof DECISION_ROUTES)[number];

/** Any JSON value, as the wire carries structured state, instructions and criteria. */
export type DecisionJson = string | number | boolean | null | DecisionJsonArray | DecisionJsonObject;

/** A JSON array. */
export type DecisionJsonArray = readonly DecisionJson[];

/** A JSON object. */
export interface DecisionJsonObject {
  readonly [key: string]: DecisionJson;
}

/**
 * The content a question is asked about: plain text, or structured data.
 *
 * Never `null`. A state that could not be built is a request that must not be
 * sent, and admitting `null` here would let an absent state travel as a value
 * and come back with a distribution that describes nothing.
 */
export type DecisionState = string | DecisionJsonObject | DecisionJsonArray;

/** What a question asks, as text or as structured data naming fields of the state. */
export type DecisionInstructions = string | DecisionJsonObject | DecisionJsonArray;

/** The meaning of one option or one level, as text or as structured data. */
export type DecisionDescription = string | DecisionJsonObject | DecisionJsonArray;

/** What a yes and a no mean, for a yes/no question that needs them spelled out. */
export interface DecisionNoulCriteria {
  readonly true?: DecisionDescription;
  readonly false?: DecisionDescription;
}

/** A yes/no question. Its answer is the probability that the answer is yes. */
export interface DecisionNoulQuestion {
  readonly type: "noul";
  readonly instructions: DecisionInstructions;
  readonly criteria?: DecisionNoulCriteria;
}

/**
 * A question answered by one of a closed set of options.
 *
 * The keys of `criteria` ARE the options; there is no separate option list. A
 * key maps to the option's description, or to `null` when its name says enough.
 */
export interface DecisionChoiceQuestion {
  readonly type: "choice";
  readonly instructions: DecisionInstructions;
  readonly criteria: Readonly<Record<string, DecisionDescription | null>>;
}

/**
 * A question answered on an ordered scale.
 *
 * `criteria` is the scale itself: one description per level, lowest first. The
 * answer refers to a level by its zero-based position in this array.
 */
export interface DecisionScoreQuestion {
  readonly type: "score";
  readonly instructions: DecisionInstructions;
  readonly criteria: readonly DecisionDescription[];
}

/**
 * A question answered by where something is in an image.
 *
 * It takes no criteria: there is no set of options and no scale, only a target
 * named in the instructions and the image the target is in. The answer is
 * always a box, even when the target is absent, so a caller that needs to know
 * whether the thing is there at all asks a yes/no question beside it and reads
 * the box only when that answer says yes.
 *
 * Supported by the newest pinned model alone. A route whose model does not
 * serve it refuses the request here rather than at the vendor.
 */
export interface DecisionBoxQuestion {
  readonly type: "box";
  /** What to find, and in which image. It need not be phrased as a question. */
  readonly instructions: DecisionInstructions;
}

/** One question, discriminated on `type`. */
export type DecisionQuestion =
  | DecisionNoulQuestion
  | DecisionChoiceQuestion
  | DecisionScoreQuestion
  | DecisionBoxQuestion;

/** The four kinds of question, and so of answer. */
export type DecisionQuestionType = DecisionQuestion["type"];

/**
 * An image a caller hands the client, as bytes or as base64 text.
 *
 * The bytes form is the one to prefer: the client encodes it, so the encoding
 * cannot be wrong. The base64 form exists for a caller that already holds
 * encoded text, and the text it holds is normalised before it is checked — a
 * `data:` header and the line breaks a wrapping encoder adds both describe the
 * same bytes, and refusing them would be a complaint the caller cannot act on.
 *
 * `format` is what the caller believes the file is. It is never taken on trust:
 * the format is read from the file's own signature, and a declaration that
 * disagrees with the signature refuses the request. Leave it out and the
 * signature decides alone.
 */
export type DecisionImageAsset =
  | {
      readonly type?: "image";
      /** The image file's bytes. */
      readonly bytes: Uint8Array;
      readonly format?: DecisionImageFormat;
    }
  | {
      readonly type?: "image";
      /** The image file as base64 text, with or without a `data:` header. */
      readonly data_base64: string;
      readonly format?: DecisionImageFormat;
    };

/**
 * The images of a request, keyed by the reference each is written under.
 *
 * A reference is matched as plain text anywhere in the request's strings, so a
 * short one can match inside a longer word by accident. A value that cannot
 * occur in the request's own text — a fresh UUID per image per request is the
 * safest — is the caller's responsibility, and every reference must appear
 * somewhere or the request is refused.
 */
export type DecisionAssetMap = Readonly<Record<string, DecisionImageAsset>>;

/**
 * One image as the wire carries it.
 *
 * Always base64 with its format stated, because that is the only form this
 * package sends: the contract's multipart form would need a body this
 * transport does not build, and declaring a file part this package cannot
 * attach would produce a request the vendor refuses for a reason the caller
 * could not see.
 */
export interface DecisionWireAsset {
  readonly type: "image";
  readonly format: DecisionImageFormat;
  /** The file, base64-encoded in the contract's exact form. */
  readonly data_base64: string;
}

/**
 * The vendor surfaces that are off until a caller asks for each by name.
 *
 * The vendor calls these its danger zone and says in its own words that the
 * image and box surface is not ready for production. Neither is ever defaulted
 * on: a caller that sends an image without asking for images is refused here,
 * before anything is sent, rather than having the surface quietly enabled for
 * it.
 */
export interface DecisionDangerZone {
  /**
   * Turn on images and image-locating questions.
   *
   * The vendor's own words on what this enables, from its images page:
   * "Images and Box questions aren't yet up to our standards to call ready for
   * production, but we're excited for dreamers and builders to play with
   * them... accuracy will change as we update the models."
   */
  readonly images?: true;
  /**
   * Raise both context limits to the vendor's long-context ceiling.
   *
   * The vendor's own words, from its models page: long context "is slower and
   * less accurate than staying within the default limits, so turn it on only
   * for requests that need it."
   */
  readonly longContext?: true;
}

/**
 * The request body, in the order its fields are sent.
 *
 * `model` is a field of the wire and not of a caller's request: a caller names
 * a route, and the route's pinned model id is written here when the request is
 * encoded. A caller therefore has no way to ask for a model the route table
 * does not pin.
 */
export interface DecisionWireRequest {
  readonly state: DecisionState;
  readonly model: string;
  /** The request's images, keyed by reference. Absent when the request has none. */
  readonly assets?: Readonly<Record<string, DecisionWireAsset>>;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
}

/**
 * The answer to a yes/no question: the probability of yes, in [0, 1].
 *
 * It has no `confidence` field, because the contract defines none for this
 * kind. A confidence shown beside it would be a second statistic made up on
 * this side of the wire and read downstream as the vendor's.
 */
export interface DecisionNoulAnswer {
  readonly type: "noul";
  readonly noul: number;
}

/**
 * The answer to a choice.
 *
 * `confidence` is the vendor's own statistic over `probabilities`, carried
 * verbatim and never interpreted here: its formula is the vendor's, differs
 * between serving implementations, and is not a quantity a threshold can be
 * moved across.
 */
export interface DecisionChoiceAnswer {
  readonly type: "choice";
  /** The highest-probability option. */
  readonly choice: string;
  /** Every option mapped to its probability. */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

/**
 * The answer to a score.
 *
 * `score` is the probability-weighted level and can fall between two levels.
 * `legend` and `probabilities` are both keyed by the level's zero-based index
 * written as a string.
 */
export interface DecisionScoreAnswer {
  readonly type: "score";
  readonly score: number;
  /** Each level index mapped back to the description the request gave it. */
  readonly legend: Readonly<Record<string, DecisionDescription>>;
  /** Each level index mapped to its probability. */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

/**
 * The four edges of a box, each a fraction of the image's own size.
 *
 * Measured from the top-left corner: `left` and `right` are fractions of the
 * width, `top` and `bottom` of the height, so the same answer holds at any
 * size the image is drawn at.
 */
export interface DecisionBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * The answer to a question about where something is in an image.
 *
 * It is always a box. There is no answer meaning "not found", so a box says
 * where the target would be if it were there and nothing about whether it is.
 * `confidence` is the vendor's own statistic, carried verbatim.
 */
export interface DecisionBoxAnswer {
  readonly type: "box";
  readonly box: DecisionBox;
  readonly confidence: number;
}

/** One answer, discriminated on `type`. */
export type DecisionAnswer =
  | DecisionNoulAnswer
  | DecisionChoiceAnswer
  | DecisionScoreAnswer
  | DecisionBoxAnswer;

/**
 * Token usage as the response reports it.
 *
 * Both counts are optional because a response is not known to always carry
 * them. A count that is absent stays absent; pricing treats it as unknown.
 */
export interface DecisionWireUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
}

/**
 * The response body.
 *
 * `model` is the model that answered, which is not necessarily the one the
 * request named: a serving stack may substitute. It is therefore data to be
 * checked against the route's pin, never an echo to be trusted.
 */
export interface DecisionWireResponse {
  readonly model: string;
  /** One answer per question, under the key the request used. */
  readonly answers: Readonly<Record<string, DecisionAnswer>>;
  readonly usage?: DecisionWireUsage;
}

/** What a caller asks: the state, the images it refers to, and the questions about it. */
export interface DecisionRequest {
  readonly state: DecisionState;
  /**
   * The images the request's text refers to, keyed by reference.
   *
   * Leave it out for a request with no image. An empty map is not the same as
   * none and is refused, because it says an image was meant to be there.
   */
  readonly assets?: DecisionAssetMap;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
}

/** Options a caller passes alongside a request. */
export interface DecisionCallOptions {
  /**
   * The caller's deadline for the whole call, in milliseconds.
   *
   * It narrows the route's own budget and never widens it: a route's budget is
   * the longest this package will hold a caller for that route.
   */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Recorded on the attempt for tracing. Never sent to the vendor. */
  readonly correlationId?: string;
  /**
   * How far a distribution's sum may differ from one before the answer is
   * rejected.
   *
   * Absent means the sum is reported and not enforced. How tightly a vendor's
   * probabilities sum to one is unmeasured, so no tolerance is built in: a
   * constant chosen here would either reject honest answers or pass broken
   * ones, and the caller is the one who knows which it can afford.
   */
  readonly probabilitySumTolerance?: number;
  /**
   * The vendor surfaces this call opts in to, each named explicitly.
   *
   * Absent means neither is on, which is what every call that does not ask for
   * them gets. See {@link DecisionDangerZone} for what the vendor says about
   * each before it is turned on.
   */
  readonly dangerZone?: DecisionDangerZone;
}

/**
 * What only the caller-facing client measures about one attempt.
 *
 * Everything in an attempt record except how it ended. A measurement that was
 * never taken is `null`: a call refused before it queued has no queue time, and
 * one that never reached a vendor has no status. None of them is ever zero for
 * want of a reading.
 */
export interface DecisionAttemptMeasurement {
  readonly route: DecisionRoute;
  /** The provider the route declares, or `null` when the route did not resolve. */
  readonly provider: string | null;
  /** The model id the request named, or `null` when the route did not resolve. */
  readonly modelPin: string | null;
  /** The HTTP status received, or `null` when no response arrived. */
  readonly status: number | null;
  /** Time spent waiting for this package's own admission, in milliseconds. */
  readonly queueMs: number | null;
  /** Time from dispatch to settlement, in milliseconds, or `null` when never dispatched. */
  readonly durationMs: number | null;
  /** The budget the call ran under, in milliseconds. */
  readonly budgetMs: number | null;
  /** The vendor's retry hint, in milliseconds, or `null` when it gave none. */
  readonly retryAfterMs: number | null;
  readonly vendorRequestId: string | null;
  /** The model the vendor reports answered, or `null` when it reported none. */
  readonly servedModel: string | null;
  /** What the vendor billed, or `null` when nothing was read. */
  readonly usage: LlmUsageRecord | null;
  readonly correlationId: string | null;
}

/**
 * The record of an attempt that produced an answer.
 *
 * The fields a success cannot lack are narrowed to non-null, so a consumer
 * reading a result does not have to handle an absence that cannot occur.
 */
export interface DecisionAnsweredAttemptRecord extends DecisionAttemptMeasurement {
  readonly outcome: "ok";
  readonly fault: null;
  readonly provider: string;
  readonly modelPin: string;
  readonly status: number;
  readonly durationMs: number;
  readonly budgetMs: number;
  readonly servedModel: string;
  readonly usage: LlmUsageRecord;
}

/**
 * The record of an attempt that ended in a fault.
 *
 * Built only by the error it belongs to, never handed to it whole: every fact
 * the error states is written here from the error, and the vendor's request id
 * and reported model are carried as the same bounded excerpts an error carries.
 */
export interface DecisionFaultedAttemptRecord extends DecisionAttemptMeasurement {
  readonly outcome: "fault";
  readonly fault: DecisionFault;
}

/**
 * One attempt against one route.
 *
 * There is exactly one per call: nothing below the caller retries, hedges or
 * falls back, so the record is the whole account of what the call did.
 */
export type DecisionAttemptRecord = DecisionAnsweredAttemptRecord | DecisionFaultedAttemptRecord;

/** What a caller receives when a route answers. */
export interface DecisionCallResult {
  readonly route: DecisionRoute;
  /** The validated answers in wire shape, with distribution keys in the request's order. */
  readonly answers: Readonly<Record<string, DecisionAnswer>>;
  /**
   * The raw sum of each answer's distribution, by question id.
   *
   * `null` for a yes/no answer, which has no distribution to sum.
   */
  readonly probabilitySums: Readonly<Record<string, number | null>>;
  /** The model the vendor reports answered. */
  readonly servedModel: string;
  /** Token counts and cost; a count or cost the vendor did not report is `null`. */
  readonly usage: LlmUsageRecord;
  readonly vendorRequestId: string | null;
  readonly attempt: DecisionAnsweredAttemptRecord;
}
