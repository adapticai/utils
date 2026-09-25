/**
 * Degraded direct transport: the path used when the gateway itself is gone.
 *
 * Routing every call through one proxy concentrates a great deal of value — one
 * place to swap a model, one place to bound spend, one place to see cost. It
 * also concentrates risk: without this path, a gateway outage would take every
 * LLM call in the system down at once, which is a worse failure than any of the
 * provider outages the gateway exists to survive.
 *
 * Two constraints keep this a safety net rather than a second routing policy.
 * It serves CLOSED-tier legs only, so the degraded path can never be the thing
 * that silently promotes an open-weight model past its evaluation gates. And it
 * resolves the model from the same route table the gateway is rendered from, so
 * degraded traffic reaches the same model the gateway would have chosen.
 *
 * The provider SDK is reached through an injected caller, resolved lazily. A
 * static import would make `@adaptic/utils` load a provider SDK for every
 * consumer, including those that never make an LLM call, and would harden a
 * package cycle that is currently only a declaration.
 *
 * @module llm/transports/direct
 */

import type {
  LlmTransport,
  LlmTransportRequest,
  LlmTransportResponse,
  LlmUsageRecord,
} from "../types";

/** Usage as the incumbent client reports it; every field is optional there. */
export interface DirectCallerUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly reasoning_tokens?: number;
  readonly cached_tokens?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly cost?: number;
}

/**
 * The provider-calling function this transport delegates to.
 *
 * Shaped to match the incumbent `lumic.llm.call` signature so the engine can
 * register its existing client with no adapter, and so the degraded path
 * inherits behaviour that is already exercised in production rather than a
 * second implementation that is only exercised during an outage.
 */
export type DirectCaller = <T>(
  content: string | readonly unknown[],
  responseFormat: unknown,
  options: Record<string, unknown>,
) => Promise<{
  response: T;
  usage?: DirectCallerUsage;
  tool_calls?: unknown;
}>;

/** Configuration for the direct transport. */
export interface DirectTransportConfig {
  /**
   * Resolves the provider-calling function.
   *
   * Async and called per use so a consumer that never degrades never loads a
   * provider SDK, and so a consumer that cannot load one fails at the moment it
   * would have degraded rather than at import.
   */
  readonly resolveCaller: () => Promise<DirectCaller>;
}

/**
 * Thrown when the degraded path is asked to serve a leg it must not serve.
 *
 * Refusing loudly rather than serving the leg anyway is the point: the whole
 * value of restricting this path is lost if it quietly widens under pressure,
 * and pressure is exactly when it runs.
 */
export class DirectTransportRefusedError extends Error {
  /**
   * @param routeKey The leg that was refused.
   * @param reason Why it cannot be served directly.
   */
  public constructor(routeKey: string, reason: string) {
    super(
      `the degraded direct transport refuses route ${routeKey}: ${reason}. ` +
        "It exists so a gateway outage does not stop every LLM call, not as a second routing policy.",
    );
    this.name = "DirectTransportRefusedError";
  }
}

/**
 * Build the degraded direct transport.
 *
 * @param config Transport configuration.
 * @returns A transport that reaches a closed-tier provider without the gateway.
 */
export function createDirectTransport(
  config: DirectTransportConfig,
): LlmTransport {
  return {
    name: "direct",
    async execute<T>(
      request: LlmTransportRequest,
    ): Promise<LlmTransportResponse<T>> {
      const { route } = request;

      if (route.provider.tier !== "closed") {
        throw new DirectTransportRefusedError(
          route.routeKey,
          `provider "${route.providerName}" is ${route.provider.tier}-tier; only a closed incumbent may be served without the gateway, so a degraded call can never promote an open route past its evaluation gates`,
        );
      }
      if (route.lumicModel === null) {
        throw new DirectTransportRefusedError(
          route.routeKey,
          "the route names no lumic_model, so there is no registered model to call directly",
        );
      }

      const call = await config.resolveCaller();
      // `developerPrompt` and `context` are named options on lumic's own call
      // surface, not body parameters, so they are forwarded explicitly rather
      // than through `request.params` — which transports send verbatim and which
      // therefore never carried them.
      const result = await call<T>(request.content, request.responseFormat, {
        ...request.params,
        ...(request.developerPrompt !== undefined
          ? { developerPrompt: request.developerPrompt }
          : {}),
        ...(request.context !== undefined ? { context: request.context } : {}),
        model: route.lumicModel,
        signal: request.signal,
        timeout: route.timeoutMs,
      });

      return {
        response: result.response,
        usage: readUsage(result.usage, request),
        tool_calls: Array.isArray(result.tool_calls)
          ? (result.tool_calls as LlmTransportResponse<T>["tool_calls"])
          : undefined,
        // The incumbent client reports the model it resolved; unreported stays null.
        servedModel:
          typeof result.usage?.model === "string" && result.usage.model !== ""
            ? result.usage.model
            : null,
      };
    },
  };
}

/**
 * Normalise the incumbent client's usage shape.
 *
 * A missing count is `null` rather than zero or an estimate, for the same
 * reason as on the gateway path: an invented token count — zero included —
 * flows straight into the budget accounting the spend controls depend on.
 *
 * @param usage The incumbent client's usage, if any.
 * @param request The request it answers.
 * @returns The normalised usage record.
 */
function readUsage(
  usage: DirectCallerUsage | undefined,
  request: LlmTransportRequest,
): LlmUsageRecord {
  return {
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    reasoning_tokens: usage?.reasoning_tokens,
    cached_tokens: usage?.cached_tokens,
    provider: usage?.provider ?? request.route.providerName,
    model: usage?.model ?? request.route.modelId,
    cost: usage?.cost ?? null,
  };
}

/**
 * Package providing the default provider client, resolved at runtime.
 *
 * Assembled rather than written as a literal so the module specifier is opaque
 * to the compiler and the bundler. That is not a trick to dodge a type error:
 * this package is genuinely OPTIONAL. The stable lineage of `@adaptic/utils`
 * does not depend on `@adaptic/lumic-utils` at all, the transport is injectable
 * precisely so a consumer can supply its own, and the default exists only as a
 * convenience for consumers that already have it installed. A static specifier
 * would assert a dependency that does not exist and would harden the
 * utils/lumic-utils package cycle from a declaration into a build-time fact.
 */
const DEFAULT_PROVIDER_CLIENT_PACKAGE = ["@adaptic", "lumic-utils"].join("/");

/**
 * The default caller: the incumbent client in `@adaptic/lumic-utils`.
 *
 * Resolved with a dynamic import so this module has no load-time dependency on
 * that package. When it cannot be loaded the failure names the degraded path
 * explicitly, because "cannot find module" during an outage is otherwise a
 * confusing second mystery on top of the first — and a consumer that does not
 * ship that package is expected to register its own transport rather than to
 * discover this at the moment the gateway fails.
 *
 * @returns The provider-calling function.
 */
export async function resolveDefaultDirectCaller(): Promise<DirectCaller> {
  try {
    const lumic = (await import(
      /* @vite-ignore */ DEFAULT_PROVIDER_CLIENT_PACKAGE
    )) as unknown as {
      lumic?: { llm?: { call?: DirectCaller } };
    };
    const call = lumic.lumic?.llm?.call;
    if (typeof call !== "function") {
      throw new Error(`${DEFAULT_PROVIDER_CLIENT_PACKAGE} exposes no lumic.llm.call`);
    }
    return call;
  } catch (error) {
    throw new Error(
      "the degraded direct transport could not load its provider client: " +
        `${error instanceof Error ? error.message : String(error)}. ` +
        "Register a direct transport explicitly via configureLlmClient() where the default is unavailable.",
    );
  }
}
