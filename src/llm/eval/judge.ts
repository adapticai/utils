/**
 * The pinned judge, and the guard that keeps it pinned.
 *
 * PD-6 states that the judge model is pinned and never auto-swapped. That is a
 * stronger requirement than "configured": a judge that could move would make
 * every gate it decided incomparable with the gates decided before the move,
 * because the scores either side of it were produced against different
 * standards. A migration programme whose bar drifts under it cannot demonstrate
 * anything.
 *
 * The pin is therefore recorded in TWO places that must agree — this module and
 * the route table — and a judged assertion refuses to run when they disagree.
 * The duplication is deliberate. A pin that lived only in the table would be
 * satisfied by any model the table happened to name, so changing the table
 * would silently change the standard; requiring both to move makes a judge swap
 * an explicit, reviewable act in the same change that re-baselines the sets.
 *
 * @module llm/eval/judge
 */

import { callLLMByAlias } from "../alias-client";
import { routeTable } from "../route-table";
import type {
  LlmAlias,
  LlmRouteTable,
  LlmValidationOutcome,
} from "../types";
import type { CandidateRun, GoldenSet, RecordedResult } from "./types";

/** Lowest score the judge rubric may return. */
export const JUDGE_SCORE_MIN = 0;

/** Highest score the judge rubric may return, matching the point scale the comparators use. */
export const JUDGE_SCORE_MAX = 100;

/** The identity a judged assertion requires the route table to resolve to. */
export interface PinnedJudgeIdentity {
  /** The only alias a judged assertion may be served by. */
  readonly alias: LlmAlias;
  /** The provider the judge route must name. */
  readonly provider: string;
  /** The exact model id the judge route must name. */
  readonly modelId: string;
}

/**
 * The pinned judge identity.
 *
 * This is the one place in the codebase where naming a vendor model string is
 * the requirement rather than a violation of it: PD-5 forbids model strings in
 * APPLICATION code so that routing stays in config, while PD-6 requires the
 * judge to be pinned so that grading stays comparable. Pinning by anything
 * looser — a family, a provider, "whatever the table says" — would not pin
 * anything.
 */
export const PINNED_JUDGE: PinnedJudgeIdentity = {
  alias: "llm.judge",
  provider: "deepinfra",
  modelId: "deepseek-ai/DeepSeek-V4-Pro",
};

/**
 * Thrown when a judged assertion is asked to run against a judge that is not
 * the pinned one.
 *
 * A refusal rather than a warning or a downgraded score: a judged gate decided
 * by an unknown judge looks exactly like a judged gate decided by the right
 * one, so the only safe outcome is to produce no verdict at all.
 */
export class JudgeNotPinnedError extends Error {
  /** The alias the caller tried to judge through. */
  public readonly alias: string;

  /**
   * @param alias The alias the caller tried to judge through.
   * @param detail What specifically failed the pin check.
   */
  public constructor(alias: string, detail: string) {
    super(
      `refusing to run a judged assertion through "${alias}": ${detail}. ` +
        "PD-6 pins the judge model; a judged gate decided by an unpinned judge grades one " +
        "model's output against another model's standard and certifies nothing.",
    );
    this.name = "JudgeNotPinnedError";
    this.alias = alias;
  }
}

/** The judge identity a route table actually resolves to. */
export interface ResolvedJudge {
  /** The alias that was verified. */
  readonly alias: LlmAlias;
  /** The provider the table names for it. */
  readonly provider: string;
  /** The model id the table names for it. */
  readonly modelId: string;
}

/**
 * Verify that an alias is the pinned judge, or refuse.
 *
 * @param alias The alias a judged assertion would be served by.
 * @param table The route table to verify against; defaults to the canonical one.
 * @returns The resolved judge identity when every pin condition holds.
 * @throws {JudgeNotPinnedError} When any pin condition fails.
 */
export function assertPinnedJudge(
  alias: LlmAlias,
  table: LlmRouteTable = routeTable,
): ResolvedJudge {
  if (alias !== PINNED_JUDGE.alias) {
    throw new JudgeNotPinnedError(
      alias,
      `only "${PINNED_JUDGE.alias}" may serve a judged assertion`,
    );
  }
  const definition = table.aliases[alias];
  if (definition === undefined) {
    throw new JudgeNotPinnedError(alias, "the route table does not define this alias");
  }
  if (definition.pinned !== true) {
    throw new JudgeNotPinnedError(alias, 'the route table does not mark it "pinned": true');
  }
  if (definition.eval_gate !== "none-pinned-judge") {
    throw new JudgeNotPinnedError(
      alias,
      `its eval_gate is "${definition.eval_gate}" rather than "none-pinned-judge"`,
    );
  }
  if (definition.routes.length !== 1) {
    throw new JudgeNotPinnedError(
      alias,
      `it has ${definition.routes.length} routes; a pinned judge carries exactly one and no ` +
        "fallback, because a judge that failed over would silently change the standard",
    );
  }
  const route = definition.routes[0];
  if (route === undefined) {
    throw new JudgeNotPinnedError(alias, "its single route is missing");
  }
  if (route.shadow_only === true) {
    throw new JudgeNotPinnedError(alias, "its route is shadow-only and is never served");
  }
  if (route.model_id_status !== "confirmed") {
    throw new JudgeNotPinnedError(
      alias,
      `its model id status is "${route.model_id_status}" rather than "confirmed"`,
    );
  }
  if (route.provider !== PINNED_JUDGE.provider || route.model_id !== PINNED_JUDGE.modelId) {
    throw new JudgeNotPinnedError(
      alias,
      `the table resolves it to ${route.provider}/${String(route.model_id)}, but the pin is ` +
        `${PINNED_JUDGE.provider}/${PINNED_JUDGE.modelId}; a judge swap must move the pin and ` +
        "re-baseline the golden sets in the same change",
    );
  }
  return { alias, provider: route.provider, modelId: route.model_id };
}

/** One case put to the judge. */
export interface JudgeRequest {
  /** The grading rubric, stated on the golden set rather than improvised per call. */
  readonly rubric: string;
  /** The original input the answer responds to. */
  readonly input: string;
  /** The reference answer. */
  readonly reference: string;
  /** The answer being graded. */
  readonly answer: string;
}

/**
 * Validate a judge reply into a score.
 *
 * @param raw The judge's parsed reply.
 * @returns The score, or the reason the reply was unusable.
 */
function validateJudgeReply(raw: unknown): LlmValidationOutcome<number> {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "judge reply was not a JSON object" };
  }
  const score = (raw as { score?: unknown }).score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return { ok: false, reason: 'judge reply had no finite numeric "score" field' };
  }
  if (score < JUDGE_SCORE_MIN || score > JUDGE_SCORE_MAX) {
    return {
      ok: false,
      reason: `judge score ${score} is outside ${JUDGE_SCORE_MIN}-${JUDGE_SCORE_MAX}`,
    };
  }
  return { ok: true, value: score };
}

/**
 * Score one answer with the pinned judge.
 *
 * The pin is verified before the call, not after, so a mis-pinned judge costs
 * nothing and produces nothing rather than producing a score that would have to
 * be retracted.
 *
 * @param request The case to grade.
 * @param options Overrides used by the harness's own pinning check.
 * @param options.alias The alias to judge through; only the pinned one is accepted.
 * @param options.table The route table to verify the pin against.
 * @returns The score, on the same 0-100 point scale the comparators use.
 * @throws {JudgeNotPinnedError} When the judge is not the pinned one.
 */
export async function scoreWithPinnedJudge(
  request: JudgeRequest,
  options: { alias?: LlmAlias; table?: LlmRouteTable } = {},
): Promise<number> {
  const alias = options.alias ?? PINNED_JUDGE.alias;
  assertPinnedJudge(alias, options.table ?? routeTable);

  const prompt = [
    request.rubric,
    "",
    `INPUT:\n${request.input}`,
    "",
    `REFERENCE ANSWER:\n${request.reference}`,
    "",
    `ANSWER UNDER TEST:\n${request.answer}`,
    "",
    `Reply with JSON only: {"score": <integer ${JUDGE_SCORE_MIN}-${JUDGE_SCORE_MAX}>}`,
  ].join("\n");

  const result = await callLLMByAlias<number>(prompt, "json", {
    alias,
    validate: validateJudgeReply,
  });
  return result.response;
}

/**
 * Fill in any missing judge scores on a candidate run, using the pinned judge.
 *
 * The pin is verified once before the first call rather than per case, so a
 * mis-pinned judge cannot grade part of a set before it is caught — a half-
 * graded set is worse than an ungraded one, because its mean looks like a
 * measurement.
 *
 * @param set The golden set being graded, which supplies the reference answers.
 * @param candidate The candidate run whose answers need scoring.
 * @param rubric The grading rubric, stated on the set rather than improvised.
 * @param options Overrides used by the harness's own pinning check.
 * @param options.alias The alias to judge through; only the pinned one is accepted.
 * @param options.table The route table to verify the pin against.
 * @returns A candidate run with a judge score on every case.
 * @throws {JudgeNotPinnedError} When the judge is not the pinned one.
 */
export async function scoreCandidateRun(
  set: GoldenSet,
  candidate: CandidateRun,
  rubric: string,
  options: { alias?: LlmAlias; table?: LlmRouteTable } = {},
): Promise<CandidateRun> {
  const alias = options.alias ?? PINNED_JUDGE.alias;
  assertPinnedJudge(alias, options.table ?? routeTable);

  const results: Record<string, RecordedResult> = {};
  for (const goldenCase of set.cases) {
    const recorded = candidate.results[goldenCase.id];
    if (recorded === undefined) {
      continue;
    }
    if (recorded.judge_score !== undefined) {
      results[goldenCase.id] = recorded;
      continue;
    }
    const score = await scoreWithPinnedJudge(
      {
        rubric,
        input: goldenCase.input,
        reference: renderForJudge(goldenCase.expected),
        answer: renderForJudge(recorded.raw),
      },
      options,
    );
    results[goldenCase.id] = { ...recorded, judge_score: score };
  }
  return { ...candidate, results };
}

/**
 * Render a value for the judge prompt.
 *
 * A string is passed through unchanged so a free-text answer reaches the judge
 * exactly as the call site produced it; anything else is serialised, because a
 * judge shown `[object Object]` grades the rendering rather than the answer.
 *
 * @param value The value to render.
 * @returns Its prompt representation.
 */
function renderForJudge(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
