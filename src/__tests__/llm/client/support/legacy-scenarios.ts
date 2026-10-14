/**
 * Chain scenarios whose attempt sequences were captured from the serial
 * executor before hedging existed.
 *
 * The hedged executor must reproduce them exactly whenever it has no latency
 * evidence and no same-model equivalent to reach for: those are the conditions
 * a fresh process starts in, and a routing change that happened merely because
 * the process restarted would be a change nobody chose.
 *
 * @module __tests__/llm/client/support/legacy-scenarios
 */

import { CircuitBreakerRegistry } from "../../../../llm/circuit-breaker";
import { ChainExhaustedError, executeChain } from "../../../../llm/fallback-chain";
import type { ChainExecution, ChainLeg } from "../../../../llm/fallback-chain";
import { GatewayResponseError } from "../../../../llm/transports/gateway";
import type { AliasAttemptRecord, ResolvedRoute } from "../../../../llm/types";
import { TEST_LEG_TIMEOUT_MS, makeThreeLegChain } from "./routes";
import { ScriptedTransport, answers, fails, hangs, usageFor } from "./transports";
import type { LegBehaviour, ScriptedCall } from "./transports";

/** Breaker tuning for the scenarios: two failures open a route. */
const SCENARIO_BREAKER = {
  failure_threshold: 2,
  cooldown_ms: 60_000,
  capacity_cooldown_ms: 15_000,
  half_open_probes: 1,
} as const;

/** HTTP status a relayed provider outage arrives with. */
const BAD_GATEWAY = 502;

/** HTTP status a malformed request arrives with. */
const BAD_REQUEST = 400;

/** A deadline shorter than one leg's route budget. */
const SHORT_DEADLINE_MS = TEST_LEG_TIMEOUT_MS / 2;

/** One scenario: how each leg behaves, and the call's deadline. */
export interface LegacyScenario {
  readonly name: string;
  readonly plan: (call: ScriptedCall) => LegBehaviour;
  readonly deadlineMs?: number;
  /** Route keys whose breakers are opened before the call. */
  readonly preOpened?: readonly string[];
}

/** The fields the serial executor recorded, in the order it recorded them. */
export type LegacyAttemptFields = Pick<
  AliasAttemptRecord,
  "routeKey" | "role" | "provider" | "modelId" | "outcome" | "durationMs" | "budgetMs" | "reason"
>;

/** What one scenario produced. */
export interface LegacyObservation {
  readonly calls: readonly string[];
  readonly attempts: readonly LegacyAttemptFields[];
  readonly servedBy: string | null;
  readonly threw: string | null;
  /** Whether what was thrown is a chain exhaustion (of any subclass). */
  readonly exhausted: boolean;
}

/**
 * Behaviour by role.
 *
 * @param byRole What each role does.
 * @returns A plan.
 */
function byRole(
  byRole: Partial<Record<ResolvedRoute["role"], (route: ResolvedRoute) => LegBehaviour>>,
): (call: ScriptedCall) => LegBehaviour {
  return (call) => {
    const behaviour = byRole[call.route.role];
    return behaviour === undefined ? hangs() : behaviour(call.route);
  };
}

/** The scenarios, covering every way the serial walk advances or stops. */
export const LEGACY_SCENARIOS: readonly LegacyScenario[] = [
  {
    name: "primary answers",
    plan: byRole({ primary: (route) => answers("p", usageFor(route)) }),
  },
  {
    name: "primary times out, secondary answers",
    plan: byRole({
      primary: () => hangs(),
      secondary: (route) => answers("s", usageFor(route)),
    }),
  },
  {
    name: "primary relays an outage, secondary malformed, incumbent answers",
    plan: byRole({
      primary: () => fails(new GatewayResponseError(BAD_GATEWAY, "upstream down")),
      secondary: () => fails(new GatewayResponseError(BAD_REQUEST, "bad request")),
      closed_incumbent: (route) => answers("c", usageFor(route)),
    }),
  },
  {
    name: "every leg times out",
    plan: () => hangs(),
  },
  {
    name: "deadline shorter than one leg",
    plan: () => hangs(),
    deadlineMs: SHORT_DEADLINE_MS,
  },
  {
    name: "primary breaker already open",
    plan: byRole({ secondary: (route) => answers("s", usageFor(route)) }),
    preOpened: ["llm.extract#primary"],
  },
];

/** Settle-and-advance hook, so the caller owns the fake clock. */
export type AdvanceClock = (ms: number) => Promise<void>;

/**
 * Run one scenario through the executor and project what the serial executor
 * recorded.
 *
 * @param scenario The scenario.
 * @param advance Advances the fake clock.
 * @param extra Execution fields layered on top (the hedging configuration).
 * @returns The observation.
 */
export async function observeScenario(
  scenario: LegacyScenario,
  advance: AdvanceClock,
  extra: Partial<ChainExecution> = {},
): Promise<LegacyObservation> {
  const routes = makeThreeLegChain();
  const transport = new ScriptedTransport("gateway", scenario.plan);
  const breakers = new CircuitBreakerRegistry(SCENARIO_BREAKER, () => Date.now());
  for (const key of scenario.preOpened ?? []) {
    breakers.onFailure(key, "hard");
    breakers.onFailure(key, "hard");
  }
  const legs: ChainLeg[] = routes.map((route) => ({ route, transport, params: {} }));
  const settled = executeChain<string>("llm.extract", {
    legs,
    content: "prompt",
    responseFormat: "text",
    breakers,
    now: () => Date.now(),
    ...(scenario.deadlineMs === undefined ? {} : { deadlineAtMs: Date.now() + scenario.deadlineMs }),
    ...extra,
  }).then(
    (outcome) => ({
      attempts: outcome.attempts,
      servedBy: outcome.servedBy.routeKey,
      threw: null,
      exhausted: false,
    }),
    (error: unknown) => ({
      attempts: (error as { attempts?: readonly AliasAttemptRecord[] }).attempts ?? [],
      servedBy: null,
      threw: error instanceof Error ? error.name : String(error),
      exhausted: error instanceof ChainExhaustedError,
    }),
  );
  await advance(TEST_LEG_TIMEOUT_MS * routes.length);
  const result = await settled;
  return {
    calls: transport.routeKeys,
    servedBy: result.servedBy,
    threw: result.threw,
    exhausted: result.exhausted,
    attempts: result.attempts.map(
      (attempt): LegacyAttemptFields => ({
        routeKey: attempt.routeKey,
        role: attempt.role,
        provider: attempt.provider,
        modelId: attempt.modelId,
        outcome: attempt.outcome,
        durationMs: attempt.durationMs,
        budgetMs: attempt.budgetMs,
        reason: attempt.reason,
      }),
    ),
  };
}
