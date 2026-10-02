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
 * A decision route is its own vocabulary. It is not a generative alias, and no
 * type here can be passed where an alias is expected, so a typed call can never
 * be routed through the generative chain's fallback, hedging or budgets.
 *
 * @module llm/decision/types
 */

import type { LlmUsageRecord } from "../types";
import type { DecisionFault } from "./errors";

/**
 * The decision routes a caller may name.
 *
 * `dm.hosted` is answered by a vendor over HTTP through this package.
 * `dm.local` is declared here, so every consumer reads one table, and is
 * answered by the consumer's own process: this package never serves it.
 */
export const DECISION_ROUTES = ["dm.hosted", "dm.local"] as const;

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

/** One question, discriminated on `type`. */
export type DecisionQuestion = DecisionNoulQuestion | DecisionChoiceQuestion | DecisionScoreQuestion;

/** The three kinds of question, and so of answer. */
export type DecisionQuestionType = DecisionQuestion["type"];

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

/** One answer, discriminated on `type`. */
export type DecisionAnswer = DecisionNoulAnswer | DecisionChoiceAnswer | DecisionScoreAnswer;

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

/** What a caller asks: the state, and the questions about it keyed by the caller's ids. */
export interface DecisionRequest {
  readonly state: DecisionState;
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
