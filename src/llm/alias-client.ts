/**
 * The alias-resolving LLM client.
 *
 * This is the only supported way to reach a language model from application
 * code. Its signature mirrors the incumbent client's — content, response
 * format, options — so migrating a call site is replacing a model string with
 * an alias, and nothing else. That similarity is the point: a migration that
 * required rewriting call sites would be a migration that stalls half-done,
 * leaving some calls inside the timeout, breaker and fallback controls and
 * some outside them, which is worse than either end state.
 *
 * There is deliberately no way to name a model. PD-5 makes vendor strings a CI
 * failure in application code, and an option that accepted one would let a call
 * site opt out of the routing policy without anyone noticing.
 *
 * Every call gets, in order: alias resolution against the canonical route
 * table, per-provider parameter normalisation, a hard per-leg timeout, a
 * per-route circuit breaker, an ordered fallback chain ending at the closed
 * incumbent, and — where the caller supplies a validator — one schema-feedback
 * retry ahead of the chain. None of them is optional, because a control that a
 * caller can switch off is a control that will be off on the call that needed
 * it.
 *
 * @module llm/alias-client
 */

import { CircuitBreakerRegistry } from "./circuit-breaker";
import { ChainExhaustedError, executeChain } from "./fallback-chain";
import type { ChainLeg } from "./fallback-chain";
import { UnsupportedCapabilityError, normaliseParams } from "./param-matrix";
import { gatewayModelNameFor, resolveChain, routeTable } from "./route-table";
import type { ResolvedChain } from "./route-table";
import { callWithValidation } from "./schema-retry";
import {
  createDirectTransport,
  resolveDefaultDirectCaller,
} from "./transports/direct";
import { GatewayUnreachableError, createGatewayTransport } from "./transports/gateway";
import type {
  AliasAttemptRecord,
  AliasCallOptions,
  AliasCallResult,
  LlmAlias,
  LlmClientConfig,
  LlmResponseFormat,
  LlmTransport,
  LlmTransportResponse,
} from "./types";

/** Env var naming the gateway's base URL. */
const GATEWAY_BASE_URL_ENV = "LLM_GATEWAY_BASE_URL";

/** Env var NAME holding the gateway key. The key itself is never read here. */
const DEFAULT_GATEWAY_KEY_ENV = "LLM_GATEWAY_API_KEY";

/** Process-wide breaker registry, so route health is shared across call sites. */
let breakers = new CircuitBreakerRegistry(
  routeTable.defaults.circuit_breaker,
);

/** Active runtime wiring. */
let config: LlmClientConfig = {};

/** Lazily built transports, rebuilt whenever configuration changes. */
let gatewayTransport: LlmTransport | null = null;
let directTransport: LlmTransport | null = null;

/**
 * Wire the client.
 *
 * Called once at process start. Transports are injectable so a consumer can
 * supply its own instrumented client, and so tests can exercise the chain
 * without a network — a fallback chain that could only be observed against live
 * providers would in practice never be observed at all.
 *
 * @param next Runtime wiring; unspecified fields fall back to the environment.
 * @returns void
 */
export function configureLlmClient(next: LlmClientConfig): void {
  config = { ...next };
  gatewayTransport = null;
  directTransport = null;
  breakers = new CircuitBreakerRegistry(
    routeTable.defaults.circuit_breaker,
    next.now,
  );
}

/**
 * Inspect route health.
 *
 * @returns The live breaker registry.
 */
export function llmBreakers(): CircuitBreakerRegistry {
  return breakers;
}

/**
 * Resolve the gateway transport, building it on first use.
 *
 * @param chain The chain being served, used to derive each leg's gateway name.
 * @returns The transport, or null when no gateway is configured.
 */
function gatewayFor(chain: ResolvedChain): LlmTransport | null {
  if (config.gatewayTransport !== undefined) {
    return config.gatewayTransport;
  }
  const baseUrl = config.gatewayBaseUrl ?? process.env[GATEWAY_BASE_URL_ENV];
  if (baseUrl === undefined || baseUrl.length === 0) {
    return null;
  }
  if (gatewayTransport === null) {
    gatewayTransport = createGatewayTransport({
      baseUrl,
      apiKeyEnv: config.gatewayApiKeyEnv ?? DEFAULT_GATEWAY_KEY_ENV,
      // The chain is re-resolved from the request's own route rather than
      // captured from the caller above. The transport is cached for the life of
      // the process, so a captured chain would bind every later alias to
      // whichever alias happened to dispatch first: its head leg would never
      // match, would be addressed as "<alias>.fallback.primary" — a name the
      // gateway does not register — and the 400 would be absorbed by the
      // fallback chain. The call still succeeds, from the SECONDARY leg, which
      // is why this reads as healthy traffic while every alias but one quietly
      // stops using the model it was chosen for.
      modelNameFor: (request) =>
        gatewayModelNameFor(
          request.route,
          resolveChain(request.route.alias, { isolated: request.route.isolated }),
        ),
    });
  }
  return gatewayTransport;
}

/**
 * Resolve the degraded direct transport, building it on first use.
 *
 * @returns The transport.
 */
function directFor(): LlmTransport {
  if (config.directTransport !== undefined) {
    return config.directTransport;
  }
  if (directTransport === null) {
    directTransport = createDirectTransport({
      resolveCaller: resolveDefaultDirectCaller,
    });
  }
  return directTransport;
}

/**
 * Prepare each leg, normalising parameters up front.
 *
 * Normalisation happens before the walk rather than inside it so a capability
 * mismatch is known without spending a network round trip on it, and so a leg
 * that cannot serve the request is recorded as skipped rather than counted
 * against the provider's health.
 *
 * @param chain The resolved chain.
 * @param options The caller's options.
 * @param responseFormat The requested response shape.
 * @param transport The transport to carry every leg.
 * @returns Prepared legs, in chain order.
 */
function prepareLegs(
  chain: ResolvedChain,
  options: AliasCallOptions,
  responseFormat: LlmResponseFormat,
  transport: LlmTransport,
): ChainLeg[] {
  return chain.routes.map((route) => {
    try {
      return {
        route,
        transport,
        params: normaliseParams(options, route, responseFormat),
      };
    } catch (error) {
      if (error instanceof UnsupportedCapabilityError) {
        return { route, transport, params: error };
      }
      throw error;
    }
  });
}

/**
 * Call a language model by semantic alias.
 *
 * @param content The prompt, or multi-part content for a vision-capable route.
 * @param responseFormat The response shape. Defaults to plain text.
 * @param options Call options; `alias` is required and there is no model option.
 * @returns The answer, with the routing decision and full attempt record attached.
 * @throws {UnknownAliasError} When the alias is not in the route table.
 * @throws {ChainExhaustedError} When no leg produced an answer.
 * @throws {SchemaRetryExhaustedError} When a validated payload failed twice.
 */
export async function callLLMByAlias<T = unknown>(
  content: string | readonly unknown[],
  responseFormat: LlmResponseFormat = "text",
  options: AliasCallOptions<T>,
): Promise<AliasCallResult<T>> {
  const chain = resolveChain(options.alias, {
    isolated: options.isolated,
    timeoutMsOverride: options.timeoutMs,
  });

  if (chain.routes.length === 0) {
    // Nothing is servable. The exclusions say why each leg was unavailable,
    // which is the difference between an operator reading config and an
    // operator reading the error.
    throw new ChainExhaustedError(
      options.alias,
      chain.exclusions.map(
        (exclusion): AliasAttemptRecord => ({
          routeKey: `${options.alias}#${exclusion.role}`,
          role: exclusion.role as AliasAttemptRecord["role"],
          provider: exclusion.provider,
          modelId: "(unresolved)",
          outcome: "skipped",
          durationMs: 0,
          reason: exclusion.reason,
        }),
      ),
      {
        prompt_tokens: 0,
        completion_tokens: 0,
        provider: "none",
        model: "none",
        cost: 0,
      },
    );
  }

  const gateway = gatewayFor(chain);
  const attemptLog: AliasAttemptRecord[] = [];

  /**
   * Run the chain, falling back from the gateway to the degraded direct path
   * only when the gateway itself is unreachable.
   *
   * @param prompt The prompt for this attempt.
   * @returns The transport response and the routing facts about it.
   */
  const runOnce = async (
    prompt: string | readonly unknown[],
  ): Promise<{
    response: LlmTransportResponse<unknown>;
    servedBy: ChainLeg["route"];
    attempts: readonly AliasAttemptRecord[];
    totalUsage: AliasCallResult<T>["totalUsage"];
    degraded: boolean;
  }> => {
    const boundContent = prompt;
    if (gateway !== null) {
      try {
        const outcome = await executeChain<unknown>(options.alias, {
          legs: prepareLegs(chain, options, responseFormat, gateway),
          content: boundContent,
          responseFormat,
          breakers,
          correlationId: options.correlationId,
          callerSignal: options.signal,
          now: config.now,
          onAttempt: (record) => attemptLog.push(record),
        });
        return { ...outcome, degraded: false };
      } catch (error) {
        if (!isGatewayOutage(error)) {
          throw error;
        }
        // The proxy is gone, not a provider behind it. Walking the chain again
        // through the gateway would repeat the same failure on every leg, so
        // the degraded path takes over — restricted to the closed incumbent.
      }
    }

    const direct = directFor();
    const closedLegs = chain.routes.filter((route) => route.provider.tier === "closed");
    if (closedLegs.length === 0) {
      throw new ChainExhaustedError(options.alias, attemptLog, {
        prompt_tokens: 0,
        completion_tokens: 0,
        provider: "none",
        model: "none",
        cost: 0,
      });
    }
    const outcome = await executeChain<unknown>(options.alias, {
      legs: prepareLegs(
        { ...chain, routes: closedLegs },
        options,
        responseFormat,
        direct,
      ),
      content: boundContent,
      responseFormat,
      breakers,
      correlationId: options.correlationId,
      callerSignal: options.signal,
      now: config.now,
      onAttempt: (record) => attemptLog.push(record),
    });
    return { ...outcome, degraded: true };
  };

  if (options.validate === undefined) {
    const outcome = await runOnce(content);
    return {
      response: outcome.response.response as T,
      usage: outcome.response.usage,
      tool_calls: outcome.response.tool_calls,
      servedBy: outcome.servedBy,
      attempts: attemptLog,
      degraded: outcome.degraded,
      totalUsage: outcome.totalUsage,
    };
  }

  // A validator is only meaningful against a text prompt, because the retry has
  // to be able to append the validator's complaint to it.
  if (typeof content !== "string") {
    throw new Error(
      "a validator requires a string prompt: the feedback retry appends the validator's rejection to the original prompt",
    );
  }

  let lastRouting: {
    servedBy: ChainLeg["route"];
    degraded: boolean;
    totalUsage: AliasCallResult<T>["totalUsage"];
  } | null = null;

  const validated = await callWithValidation<T>({
    prompt: content,
    validate: options.validate,
    call: async (prompt) => {
      const outcome = await runOnce(prompt);
      lastRouting = {
        servedBy: outcome.servedBy,
        degraded: outcome.degraded,
        totalUsage: outcome.totalUsage,
      };
      return outcome.response;
    },
  });

  if (lastRouting === null) {
    throw new Error("validated call completed without recording a routing decision");
  }
  const routing: {
    servedBy: ChainLeg["route"];
    degraded: boolean;
    totalUsage: AliasCallResult<T>["totalUsage"];
  } = lastRouting;

  return {
    response: validated.value,
    usage: validated.response.usage,
    tool_calls: validated.response.tool_calls,
    servedBy: routing.servedBy,
    attempts: attemptLog,
    degraded: routing.degraded,
    totalUsage: validated.totalUsage,
  };
}

/**
 * Whether an error means the gateway itself is gone.
 *
 * Only a transport-level failure to reach the proxy qualifies. A provider error
 * relayed BY the proxy is a normal chain event and must not trigger the
 * degraded path, or a single flaky provider would quietly move every call onto
 * the closed incumbent — a fallback the routing policy reserves for last.
 *
 * @param error The error to classify.
 * @returns Whether the gateway is unreachable.
 */
function isGatewayOutage(error: unknown): boolean {
  if (error instanceof GatewayUnreachableError) {
    return true;
  }
  if (error instanceof ChainExhaustedError) {
    return (
      error.attempts.length > 0 &&
      error.attempts.every((attempt) =>
        attempt.reason === undefined
          ? false
          : attempt.reason.includes("is unreachable"),
      )
    );
  }
  return false;
}

/**
 * The aliases application code may name.
 *
 * @returns The alias names, sorted.
 */
export function llmAliases(): LlmAlias[] {
  return Object.keys(routeTable.aliases).sort() as LlmAlias[];
}
