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
  LlmTransportResponse,
  LlmUsageRecord,
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

/** The tool-choice key, in the OpenAI-compatible vocabulary the gateway speaks. */
export const TOOL_CHOICE_KEY = "tool_choice";

/** The mandatory tool-choice value: the answer must be a tool call. */
const TOOL_CHOICE_REQUIRED = "required";

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
    const toolChoice = normaliseToolChoice(options.toolChoice, route);
    if (toolChoice !== undefined) {
      params[TOOL_CHOICE_KEY] = toolChoice;
    }
  }

  if (options.metadata !== undefined) {
    params.metadata = { ...options.metadata };
  }

  return params;
}

/**
 * Translate the caller's tool-choice policy into the value one leg is sent.
 *
 * `"auto"` is every provider's default once tools are present, so it is never
 * sent. `"required"` is sent only to a route MEASURED to honour it: serving
 * stacks accept the parameter and silently answer in prose anyway, so sending
 * it to an unmeasured route would assert a constraint nobody checked. Omitting
 * it there leaves that leg exactly as it was, with the caller's own validation
 * as the guard.
 *
 * @param toolChoice The caller's policy, if any.
 * @param route The leg being prepared.
 * @returns The value to send, or undefined to omit the parameter.
 */
function normaliseToolChoice(
  toolChoice: AliasCallOptions["toolChoice"],
  route: ResolvedRoute,
): string | undefined {
  if (toolChoice !== TOOL_CHOICE_REQUIRED) {
    return undefined;
  }
  return route.params.supports_tool_choice === true ? TOOL_CHOICE_REQUIRED : undefined;
}

/**
 * Fail a leg that was sent a mandatory tool choice and answered without a tool call.
 *
 * The parameter is sent only to a route declared to honour it, so an answer
 * with no tool call means the declaration no longer holds for this leg — a
 * serving-stack upgrade can drop the constraint without an error. Returning
 * that answer would hand a caller prose where it demanded an action; failing
 * the leg lets the chain advance and names the broken declaration.
 *
 * @param route The leg that answered.
 * @param params The parameters it was sent.
 * @param response The leg's answer: its tool calls, and the usage and serving
 *   model the error carries so the leg's spend and attribution are not lost.
 * @throws {ToolChoiceIgnoredError} When a mandatory choice produced no tool call.
 */
export function assertToolChoiceHonoured(
  route: ResolvedRoute,
  params: Readonly<Record<string, unknown>>,
  response: Pick<LlmTransportResponse<unknown>, "tool_calls" | "usage" | "servedModel">,
): void {
  if (params[TOOL_CHOICE_KEY] !== TOOL_CHOICE_REQUIRED) {
    return;
  }
  if (response.tool_calls !== undefined && response.tool_calls.length > 0) {
    return;
  }
  throw new ToolChoiceIgnoredError(route, response.usage, response.servedModel ?? null);
}

/**
 * Thrown when a route declared to honour a mandatory tool choice answered
 * without a tool call.
 *
 * Distinct from a provider outage: the route answered, but not in the form it
 * is declared to guarantee. The chain advances, and the route's health is not
 * charged, because the fault is in the declaration, not in availability. The
 * provider still billed for the answer, so the error carries the leg's usage:
 * the spend belongs in the chain's total whether or not a later leg serves.
 */
export class ToolChoiceIgnoredError extends Error {
  /** The leg that ignored the choice. */
  public readonly routeKey: string;

  /** What the provider billed for the answer that carried no tool call. */
  public readonly usage: LlmUsageRecord;

  /** The model the provider reports as having answered, or `null` when unreported. */
  public readonly servedModel: string | null;

  /**
   * @param route The leg.
   * @param usage What the provider billed for the answer.
   * @param servedModel The provider-reported serving model, or `null`.
   */
  public constructor(route: ResolvedRoute, usage: LlmUsageRecord, servedModel: string | null) {
    super(
      `route ${route.routeKey} (${route.providerName}/${route.modelId}) was sent tool_choice "required" ` +
        "and answered without a tool call; its supports_tool_choice declaration no longer holds",
    );
    this.name = "ToolChoiceIgnoredError";
    this.routeKey = route.routeKey;
    this.usage = usage;
    this.servedModel = servedModel;
  }
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
