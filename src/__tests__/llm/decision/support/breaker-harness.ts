/**
 * The decision client wired for breaker tests.
 *
 * The real hosted transport runs over a scripted HTTP call, on a table whose
 * hosted route is admitted, under a faked clock. The breaker's cooldowns and
 * the call's budget timer both read that one clock, so a test moves time by
 * hand and nothing sleeps.
 *
 * A step of a breaker test is recorded as plain data: how the call ended and
 * the breaker's state on each path afterwards. A sequence of steps is then
 * compared whole, so two runs that differ in any transition, any timing or
 * any refusal text differ as values.
 *
 * It lives with the tests and is never bundled.
 */

import { inspect } from "node:util";

import { vi } from "vitest";

import type { BreakerSnapshot } from "../../../../llm/circuit-breaker";
import {
  callDecisionModel,
  configureDecisionClient,
  decisionBreakerKey,
  decisionBreakers,
} from "../../../../llm/decision/decision-client";
import { DecisionCallError, DecisionRouteUnavailableError } from "../../../../llm/decision/errors";
import { createSystemOneTransport } from "../../../../llm/decision/transports/systemone";
import type { SystemOneFetchResponse } from "../../../../llm/decision/transports/systemone";
import type {
  DecisionCallOptions,
  DecisionCallResult,
  DecisionQuestion,
  DecisionRequest,
  DecisionState,
} from "../../../../llm/decision/types";
import { resetProviderGuards } from "../../../../llm/rate-guard";
import { createDecisionFetchDouble, decisionResponse } from "./fetch-double";
import type { DecisionFetchDouble, DecisionFetchScript, RecordedDecisionFetch } from "./fetch-double";
import { loadDecisionFixture } from "./fixtures";
import { HOSTED_ROUTE, admittedDecisionRouteTable, hostedProviderOf, hostedRouteOf } from "./routes";
import type { DeepMutable } from "./routes";
import type { DecisionRouteTable } from "../../../../llm/decision/route-types";

/** The instant the faked clock starts at. Every recorded time is relative to it. */
export const BREAKER_T0_MS = Date.UTC(2026, 10, 23, 15, 0, 0);

/** The status the tests replay a documented success under; the reference quotes none. */
const OK = 200;

/** The vendor being full: a capacity status the transport counts as such. */
export const UNAVAILABLE = 503;

/** The vendor failing: a server status the transport counts as a hard failure. */
export const SERVER_ERROR = 500;

/**
 * A recognisable stand-in for the key.
 *
 * Assembled at runtime so that no credential-shaped literal sits in the tree.
 */
const TEST_KEY = ["dk", "test", "breaker-path", "do-not-leak"].join("-");

/** The key a route's breaker is held under, for the hosted route. */
export const HOSTED_BREAKER_KEY = decisionBreakerKey(HOSTED_ROUTE);

/**
 * The documented request: its state and questions.
 *
 * @returns The request, without the wire's model field, which a caller never supplies.
 */
export function documentedRequest(): DecisionRequest {
  const { envelope } = loadDecisionFixture("request.choice.documented.json", { allow: ["documented-verbatim"] });
  const body = structuredClone(envelope.body) as Record<string, unknown>;
  return { state: body.state as DecisionState, questions: body.questions as Record<string, DecisionQuestion> };
}

/**
 * The documented answer, reported by the model the hosted route pins.
 *
 * @returns A successful response carrying it.
 */
export function documentedAnswer(): SystemOneFetchResponse {
  const { envelope } = loadDecisionFixture("response.choice.documented.json", { allow: ["documented-verbatim"] });
  const body = {
    ...(structuredClone(envelope.body) as Record<string, unknown>),
    model: hostedRouteOf(admittedDecisionRouteTable()).expected_served_model,
  };
  return decisionResponse(OK, JSON.stringify(body));
}

/**
 * A vendor error with a JSON body, as constructed rather than observed.
 *
 * @param status The HTTP status.
 * @returns The response.
 */
export function vendorError(status: number): SystemOneFetchResponse {
  return decisionResponse(status, JSON.stringify({ error: `status ${status}` }), {
    "content-type": "application/json",
  });
}

/**
 * An HTTP call that never answers and ends only when its signal aborts, as
 * the platform's own does.
 *
 * @param call The recorded request.
 * @returns A promise that rejects with the signal's reason and never resolves.
 */
export function hangingFetch(call: RecordedDecisionFetch): Promise<never> {
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

/** The wired client. */
export interface BreakerHarness {
  /** The requests that reached the scripted HTTP call. */
  readonly double: DecisionFetchDouble;
  /** The hosted route's budget, in milliseconds. */
  readonly budgetMs: number;
  /** The table's breaker tuning. */
  readonly breaker: DecisionRouteTable["defaults"]["circuit_breaker"];
}

/**
 * Wire the client under a faked clock.
 *
 * Fakes the clock first, so the breaker registry the wiring builds reads the
 * faked one, then stubs the key and clears the provider guards.
 *
 * @param script What the scripted HTTP call does with each request.
 * @param edit A change to the admitted table, for a test that tunes the breaker.
 * @returns The harness.
 */
export function wireBreakerHarness(
  script: DecisionFetchScript,
  edit: (table: DeepMutable<DecisionRouteTable>) => void = () => undefined,
): BreakerHarness {
  vi.useFakeTimers({ now: BREAKER_T0_MS });
  const table = admittedDecisionRouteTable();
  edit(table);
  vi.stubEnv(hostedProviderOf(table).api_key_env, TEST_KEY);
  const baseUrlEnv = hostedProviderOf(table).base_url_env;
  if (baseUrlEnv !== null) {
    vi.stubEnv(baseUrlEnv, undefined);
  }
  resetProviderGuards();
  const double = createDecisionFetchDouble(script);
  const now = (): number => Date.now();
  configureDecisionClient({
    routeTable: table,
    transport: createSystemOneTransport({ fetchImpl: double.fetchImpl, now }),
    now,
  });
  return { double, budgetMs: hostedRouteOf(table).budget_ms, breaker: table.defaults.circuit_breaker };
}

/**
 * Undo {@link wireBreakerHarness}.
 *
 * @returns void
 */
export function unwireBreakerHarness(): void {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetProviderGuards();
  configureDecisionClient();
}

/** The breaker fields a step records, with its time relative to {@link BREAKER_T0_MS}. */
export interface RunState {
  readonly state: BreakerSnapshot["state"];
  readonly consecutiveFailures: number;
  readonly openedAtMs: number | null;
  readonly failureKind: BreakerSnapshot["failureKind"];
  readonly cooldownMs: number;
  readonly probesInFlight: number;
  readonly probeBudget: number;
  readonly opens: number;
}

/**
 * One breaker run, as a step records it.
 *
 * @param snapshot The run's snapshot.
 * @returns Its fields, with the open time made relative to the start.
 */
export function runStateOf(snapshot: BreakerSnapshot): RunState {
  return {
    state: snapshot.state,
    consecutiveFailures: snapshot.consecutiveFailures,
    openedAtMs: snapshot.openedAtMs === null ? null : snapshot.openedAtMs - BREAKER_T0_MS,
    failureKind: snapshot.failureKind,
    cooldownMs: snapshot.cooldownMs,
    probesInFlight: snapshot.probesInFlight,
    probeBudget: snapshot.probeBudget,
    opens: snapshot.opens,
  };
}

/**
 * The hosted route's live run, read by its route key as every consumer reads it.
 *
 * @returns The run.
 */
export function liveRun(): RunState {
  return runStateOf(decisionBreakers().snapshot(HOSTED_BREAKER_KEY));
}

/**
 * The hosted route's shadow run.
 *
 * @returns The run.
 */
export function shadowRun(): RunState {
  return runStateOf(decisionBreakers().snapshotOnPath(HOSTED_BREAKER_KEY, "shadow"));
}

/**
 * Every run the registry holds.
 *
 * @returns Each as `route@path`, in the registry's own order.
 */
export function registryRuns(): string[] {
  return decisionBreakers()
    .snapshotAll()
    .map(({ routeKey, path }) => `${routeKey}@${path}`);
}

/** How a call ended, as a step records it. */
export interface CallOutcome {
  /** `ok`, or the rejection's fault. */
  readonly outcome: string;
  /** For a breaker refusal, the reason the caller is given; otherwise `null`. */
  readonly refusal: string | null;
}

/**
 * Settle a call and describe how it ended.
 *
 * @param call The client's promise.
 * @returns Its outcome.
 * @throws When it rejects with anything but a decision error, which is a defect.
 */
export async function outcomeOf(call: Promise<DecisionCallResult>): Promise<CallOutcome> {
  try {
    await call;
    return { outcome: "ok", refusal: null };
  } catch (error) {
    if (!(error instanceof DecisionCallError)) {
      throw new Error(`expected a decision error, got ${inspect(error, { depth: 1 })}`);
    }
    return {
      outcome: error.fault,
      refusal: error instanceof DecisionRouteUnavailableError && error.code === "breaker_open" ? error.reason : null,
    };
  }
}

/**
 * Ask the documented question on the hosted route.
 *
 * @param options The call's options.
 * @returns The client's promise.
 */
export function askHosted(options?: DecisionCallOptions): Promise<DecisionCallResult> {
  return callDecisionModel(HOSTED_ROUTE, documentedRequest(), options);
}
