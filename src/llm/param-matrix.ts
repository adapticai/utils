/**
 * Parameter normalisation across providers.
 *
 * A caller passes one option bag and the chain may serve it from any of three
 * providers, so the same request has to be expressible to all of them. Vendors
 * disagree about more than spelling: some reject a sampling parameter they do
 * not support with a hard 400 rather than ignoring it, some name the output
 * cap differently, and reasoning models take an effort knob that non-reasoning
 * models refuse. Left unnormalised, a fallback would fail on the leg it fell
 * back to — turning the mechanism that exists to survive an outage into a
 * second way to fail.
 *
 * The rule throughout is that an unsupported parameter is OMITTED, never sent
 * with a default. Sending a default asserts a value the caller did not choose;
 * omitting it lets the provider apply its own, which is what "unsupported"
 * actually means.
 *
 * @module llm/param-matrix
 */

import type {
  AliasCallOptions,
  LlmResponseFormat,
  ResolvedRoute,
} from "./types";

/**
 * Providers that name the output cap `max_tokens` rather than
 * `max_completion_tokens`.
 *
 * The split is a wire-format fact about each API, so it is recorded as data
 * next to the translation that uses it rather than inferred from a version
 * number that will move.
 */
const MAX_TOKENS_PARAM_BY_API_STYLE: Readonly<Record<string, string>> = {
  anthropic: "max_tokens",
  "openai-compatible": "max_completion_tokens",
};

/** The response-format key an OpenAI-compatible provider expects. */
const RESPONSE_FORMAT_KEY = "response_format";

/**
 * Normalise a caller's options into the exact parameter set one leg accepts.
 *
 * @param options The caller's options.
 * @param route The leg the request is being prepared for.
 * @param responseFormat The response shape the caller asked for.
 * @returns Parameters ready to send verbatim.
 */
export function normaliseParams(
  options: AliasCallOptions,
  route: ResolvedRoute,
  responseFormat: LlmResponseFormat,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const capabilities = route.params;

  // Temperature. A model that accepts only its default value returns a hard
  // error for the parameter's mere presence, so support is checked before the
  // caller's preference is consulted at all.
  const temperature = options.temperature ?? capabilities.temperature ?? undefined;
  if (capabilities.supports_temperature !== false && typeof temperature === "number") {
    params.temperature = temperature;
  }

  // Output cap. The caller's value wins where present; the route's declared cap
  // is the ceiling, because exceeding it is a provider error rather than a
  // larger answer.
  const routeCap = capabilities.max_output_tokens ?? undefined;
  const requested = options.maxOutputTokens ?? routeCap;
  if (typeof requested === "number") {
    const capped = typeof routeCap === "number" ? Math.min(requested, routeCap) : requested;
    const key = MAX_TOKENS_PARAM_BY_API_STYLE[route.provider.api_style] ?? "max_tokens";
    params[key] = capped;
  }

  // Reasoning effort is meaningful only where the route declares it, and is
  // dropped elsewhere rather than translated into a temperature.
  const effort = options.reasoningEffort ?? capabilities.reasoning_effort ?? undefined;
  if (typeof effort === "string" && capabilities.reasoning_effort !== undefined) {
    params.reasoning_effort = effort;
  }

  const format = normaliseResponseFormat(responseFormat, route);
  if (format !== undefined) {
    params[RESPONSE_FORMAT_KEY] = format;
  }

  if (options.tools !== undefined && options.tools.length > 0) {
    if (capabilities.supports_tools === false) {
      throw new UnsupportedCapabilityError(route, "tools");
    }
    params.tools = [...options.tools];
    // Parallel tool calls are off by default: a decision path that fans out
    // tool calls concurrently reorders its own effects, and ordering is part
    // of the meaning of a sequence of trading actions.
    params.parallel_tool_calls = false;
  }

  if (options.metadata !== undefined) {
    params.metadata = { ...options.metadata };
  }

  return params;
}

/**
 * Translate the requested response shape into the parameter a route accepts.
 *
 * A strict JSON schema is a real capability, not a formatting preference: a
 * route that cannot enforce one would return prose where the caller's parser
 * expects an object. Rather than silently degrading to free JSON — which fails
 * later, further from the cause — a route without the capability refuses the
 * request so the chain advances to one that has it.
 *
 * @param responseFormat What the caller asked for.
 * @param route The leg being prepared.
 * @returns The provider-facing value, or undefined for plain text.
 */
function normaliseResponseFormat(
  responseFormat: LlmResponseFormat,
  route: ResolvedRoute,
): unknown {
  if (responseFormat === "text") {
    return undefined;
  }
  if (responseFormat === "json") {
    return { type: "json_object" };
  }
  if (route.params.supports_json_schema === false) {
    throw new UnsupportedCapabilityError(route, "json_schema");
  }
  return {
    type: "json_schema",
    json_schema: {
      name: "structured_response",
      strict: true,
      schema: responseFormat.schema,
    },
  };
}

/**
 * Thrown when a leg cannot honour a capability the caller requires.
 *
 * A distinct type rather than a generic error, because the chain treats it
 * differently from a provider outage: the leg is not broken, it is simply the
 * wrong leg for this request, and no retry against it will help.
 */
export class UnsupportedCapabilityError extends Error {
  /** The leg that cannot serve the request. */
  public readonly routeKey: string;

  /** The capability it lacks. */
  public readonly capability: string;

  /**
   * @param route The leg.
   * @param capability The missing capability.
   */
  public constructor(route: ResolvedRoute, capability: string) {
    super(
      `route ${route.routeKey} (${route.providerName}/${route.modelId}) does not support ${capability}; ` +
        "the chain advances rather than degrading the request, so the caller's contract is never silently weakened",
    );
    this.name = "UnsupportedCapabilityError";
    this.routeKey = route.routeKey;
    this.capability = capability;
  }
}

/**
 * Whether a leg can serve a request needing the given capabilities at all.
 *
 * Used to skip a leg before spending a network round trip on it. Checking
 * up front rather than reacting to the provider's rejection keeps a
 * capability mismatch from consuming the caller's latency budget.
 *
 * @param route The leg.
 * @param needs Capabilities the request requires.
 * @returns Whether the leg is a candidate.
 */
export function routeSupports(
  route: ResolvedRoute,
  needs: {
    readonly tools?: boolean;
    readonly jsonSchema?: boolean;
    readonly vision?: boolean;
    readonly cacheControl?: boolean;
  },
): boolean {
  if (needs.tools === true && route.params.supports_tools === false) {
    return false;
  }
  if (needs.jsonSchema === true && route.params.supports_json_schema === false) {
    return false;
  }
  if (needs.vision === true && route.params.supports_vision !== true) {
    return false;
  }
  if (needs.cacheControl === true && route.params.supports_cache_control !== true) {
    return false;
  }
  return true;
}
