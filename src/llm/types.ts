/**
 * Public types for the alias-resolving LLM client.
 *
 * Application code names a semantic alias and never a vendor model string, so
 * these types deliberately give a caller no way to express "use this model".
 * That is the whole point of the layer: a model swap has to be a change to the
 * route table, and a type that accepted a model id would let a call site opt
 * out of the routing policy without anyone noticing.
 *
 * @module llm/types
 */

/**
 * The semantic aliases application code may name.
 *
 * A union rather than a bare string, so a call site that names an alias the
 * route table does not define fails to compile instead of failing at runtime
 * against whichever provider the gateway happened to have configured.
 */
export type LlmAlias =
  | "llm.reason"
  | "llm.agentic"
  | "llm.fast"
  | "llm.extract"
  | "llm.judge"
  | "llm.decide";

/** How urgently a caller needs an answer, which fixes the per-leg timeout budget. */
export type LlmLatencyClass = "hot-path" | "background" | "batch";

/** What a call is for, which fixes how conservatively a failure is handled. */
export type LlmCriticality = "trading-adjacent" | "ops" | "internal";

/** Position of a route in its alias's fallback chain. */
export type LlmRouteRole = "primary" | "secondary" | "closed_incumbent";

/** Whether a provider is an open-weight host, a retained closed vendor, or an aggregator. */
export type LlmProviderTier = "open" | "closed" | "aggregator";

/** Whether a provider account is usable today. */
export type LlmAccountStatus = "live" | "pending-onboarding" | "not-in-scope";

/** Whether a vendor model id was transcribed from a source or is still unknown. */
export type LlmModelIdStatus = "confirmed" | "pending-provider-confirmation";

/** Response shape a caller asks for, mirroring the incumbent client's vocabulary. */
export type LlmResponseFormat =
  | "text"
  | "json"
  | {
      readonly type: "json_schema";
      readonly schema: {
        readonly type: "object";
        readonly properties: Record<string, unknown>;
        readonly required?: readonly string[];
      };
    };

/** Capability and sampling declarations for one route. */
export interface LlmRouteParams {
  readonly temperature?: number | null;
  readonly max_output_tokens?: number | null;
  readonly reasoning_effort?: "low" | "medium" | "high" | null;
  readonly supports_temperature?: boolean;
  readonly supports_json_schema?: boolean;
  readonly supports_tools?: boolean;
  readonly supports_cache_control?: boolean;
  readonly supports_vision?: boolean;
  /**
   * Whether the route is MEASURED to honour a mandatory `tool_choice`
   * (`"required"`): the provider returns a tool call rather than prose.
   *
   * Only `true` licenses sending the parameter. Serving stacks accept the
   * parameter and silently ignore it, answering in prose with no error, so an
   * unmeasured route is treated as not honouring it and the parameter is
   * omitted: a caller that relies on the constraint must still validate the
   * answer, and a declared-but-ignored constraint is detected, never assumed.
   */
  readonly supports_tool_choice?: boolean;
  readonly context_window?: number;
}

/** A dated price anchor for one route, used to project spend against a budget. */
export interface LlmPriceAnchor {
  readonly input: number;
  readonly output: number;
  readonly as_of: string;
  readonly source?: string;
}

/** One leg of an alias's fallback chain. */
export interface LlmRoute {
  readonly role: LlmRouteRole;
  readonly provider: string;
  readonly model_id: string | null;
  readonly model_id_status: LlmModelIdStatus;
  readonly model_id_source?: string | null;
  readonly model_family: string;
  readonly lumic_model?: string | null;
  readonly params?: LlmRouteParams;
  readonly price_per_mtok?: LlmPriceAnchor;
  readonly shadow_only?: boolean;
  readonly notes?: string;
}

/** A provider account the chain can reach. */
export interface LlmProvider {
  readonly display_name: string;
  readonly tier: LlmProviderTier;
  readonly api_style: "openai-compatible" | "anthropic";
  readonly base_url: string | null;
  readonly base_url_env: string | null;
  readonly api_key_env: string;
  readonly secret_path: string;
  readonly account_status: LlmAccountStatus;
  readonly lumic_provider?: string | null;
  readonly published_rpm?: number | null;
  readonly published_tpm?: number | null;
  readonly limits_source?: string | null;
  readonly docs_url: string;
  readonly notes?: string;
}

/** Spend bound for one alias at the gateway layer. */
export interface LlmAliasBudget {
  readonly basis: "provisional-pre-baseline" | "measured";
  readonly monthly_usd: number;
  readonly alert_pct: readonly number[];
}

/** One alias's complete routing definition. */
export interface LlmAliasDefinition {
  readonly workload: string;
  readonly latency_class: LlmLatencyClass;
  readonly criticality: LlmCriticality;
  readonly isolation_capable: boolean;
  readonly pinned?: boolean;
  readonly eval_gate:
    | "structured-output"
    | "free-text-judge"
    | "tool-call"
    | "none-pinned-judge";
  readonly policy_note?: string;
  readonly budget: LlmAliasBudget;
  readonly routes: readonly LlmRoute[];
}

/** Circuit-breaker tuning shared by every route. */
export interface LlmBreakerDefaults {
  readonly failure_threshold: number;
  readonly cooldown_ms: number;
  readonly half_open_probes: number;
}

/** Defaults every alias inherits. */
export interface LlmRouteDefaults {
  readonly request_timeout_ms: Readonly<Record<LlmLatencyClass, number>>;
  readonly retries_per_leg: number;
  readonly circuit_breaker: LlmBreakerDefaults;
}

/** A routing question the table cannot settle on its own authority. */
export interface LlmOpenItem {
  readonly id: string;
  readonly question: string;
  readonly blocks: string;
  readonly owner: string;
}

/** The canonical alias route table. */
export interface LlmRouteTable {
  readonly schema_version: number;
  readonly policy_source: string;
  readonly revised?: string;
  readonly defaults: LlmRouteDefaults;
  readonly providers: Readonly<Record<string, LlmProvider>>;
  readonly aliases: Readonly<Record<string, LlmAliasDefinition>>;
  readonly open_items?: readonly LlmOpenItem[];
}

/** A route resolved for execution, with its provider and effective budget attached. */
export interface ResolvedRoute {
  readonly alias: LlmAlias;
  readonly isolated: boolean;
  readonly role: LlmRouteRole;
  readonly providerName: string;
  readonly provider: LlmProvider;
  readonly modelId: string;
  readonly lumicModel: string | null;
  readonly params: LlmRouteParams;
  /** Stable identity of this leg, used to key its circuit breaker and its metrics. */
  readonly routeKey: string;
  readonly timeoutMs: number;
  readonly retriesPerLeg: number;
}

/**
 * Token accounting for one attempt, mirroring the incumbent client's shape.
 *
 * A count or cost the provider did not report is `null`, never zero. A zero
 * reads as "this call was free", flows into spend and token budgets, and can
 * never trip them; `null` says the number is missing, so a consumer has to
 * decide what an unmeasured call means instead of inheriting a fabricated one.
 */
export interface LlmUsageRecord {
  readonly prompt_tokens: number | null;
  readonly completion_tokens: number | null;
  readonly reasoning_tokens?: number;
  readonly cached_tokens?: number;
  readonly provider: string;
  /** The model the route table credits for the leg (its `model_id`). */
  readonly model: string;
  readonly cost: number | null;
}

/** A tool call the model asked for. */
export interface LlmToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

/** The envelope a transport returns. */
export interface LlmTransportResponse<T> {
  readonly response: T;
  readonly usage: LlmUsageRecord;
  readonly tool_calls?: readonly LlmToolCall[];
  /**
   * The model the provider reports as having produced the answer (the
   * response body's `model`), or `null` when it reported none.
   *
   * Distinct from {@link LlmUsageRecord.model}, which is the model the route
   * table credits for the leg. A proxy with a fallback of its own can answer
   * one leg from a different model, and only this field can show it.
   */
  readonly servedModel?: string | null;
  /** The proxy's deployment id for the answer (`x-litellm-model-id`), or `null`. */
  readonly servedDeploymentId?: string | null;
}

/** What the caller receives, with the routing decision attached for attribution. */
export interface AliasCallResult<T> extends LlmTransportResponse<T> {
  /** The leg that produced the answer. */
  readonly servedBy: ResolvedRoute;
  /** Legs tried and rejected before this one, in order, with the reason each failed. */
  readonly attempts: readonly AliasAttemptRecord[];
  /** Whether the answer came from the degraded direct transport rather than the gateway. */
  readonly degraded: boolean;
  /** Usage summed across every attempt, so budget accounting counts what was actually spent. */
  readonly totalUsage: LlmUsageRecord;
  /**
   * The model the provider reports as having produced the answer, or `null`
   * when it reported none; absent on a result built by a consumer's own double.
   * See {@link LlmTransportResponse.servedModel}.
   */
  readonly servedModel?: string | null;
}

/** One attempt against one leg. */
export interface AliasAttemptRecord {
  readonly routeKey: string;
  readonly role: LlmRouteRole;
  readonly provider: string;
  readonly modelId: string;
  readonly outcome: "ok" | "error" | "timeout" | "breaker-open" | "skipped";
  readonly durationMs: number;
  /**
   * The budget this leg was given: its route budget, cut to what remained of
   * the caller's deadline. Absent on a leg that was never dispatched.
   */
  readonly budgetMs?: number;
  /** Provider-reported serving model of an answered leg; `null` when unreported. */
  readonly servedModel?: string | null;
  readonly reason?: string;
  readonly usage?: LlmUsageRecord;
}

/**
 * A caller's tool-choice policy.
 *
 * `"auto"` lets the model answer in prose or call a tool; `"required"` asks
 * for exactly a tool call. `"required"` is sent only to a route that declares
 * {@link LlmRouteParams.supports_tool_choice}; elsewhere it is omitted, and on
 * a route that declares it but answers without a tool call the leg fails.
 */
export type LlmToolChoice = "auto" | "required";

/**
 * Outcome of validating a structured payload.
 *
 * A discriminated union rather than a boolean plus an out-parameter, so a
 * validator cannot report success while leaving the value unnarrowed — the type
 * system carries the rescued payload only on the branch that earned it.
 */
export type LlmValidationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * Options a caller passes alongside the prompt.
 *
 * Generic in the validated payload so a caller's validator and the call's
 * result type are the same `T` by construction. Without the parameter the
 * client would need a cast to connect them, and a cast at that seam is exactly
 * where a validator could silently be applied to the wrong shape.
 */
export interface AliasCallOptions<T = unknown> {
  /** The semantic alias to serve this call. Required; there is no model option by design. */
  readonly alias: LlmAlias;
  /**
   * Route through the alias's research-isolated variant (PD-9).
   *
   * Isolation is requested explicitly rather than inferred, because a boundary
   * that depends on a caller being correctly classified elsewhere is a boundary
   * that breaks quietly when the classification drifts.
   */
  readonly isolated?: boolean;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly reasoningEffort?: "low" | "medium" | "high";
  readonly tools?: readonly unknown[];
  /** Tool-choice policy for a tool-carrying call. See {@link LlmToolChoice}. */
  readonly toolChoice?: LlmToolChoice;
  readonly developerPrompt?: string;
  readonly context?: readonly unknown[];
  readonly metadata?: Readonly<Record<string, string>>;
  /**
   * The caller's whole-call deadline, in milliseconds, shared by every leg.
   *
   * Each leg runs for its route budget or for what remains of this deadline,
   * whichever is shorter, so a slow primary can no longer consume the whole
   * deadline and leave the fallback legs unreachable. It never widens a leg
   * past its route budget. Absent, each leg runs for its route budget.
   */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * Validator for a structured payload. Supplying it enables the single
   * feedback retry before the chain advances.
   */
  readonly validate?: (raw: unknown) => LlmValidationOutcome<T>;
  /** Correlation id carried into transport metadata for cross-system tracing. */
  readonly correlationId?: string;
}

/** A transport that can execute one resolved route. */
export interface LlmTransport {
  readonly name: string;
  /**
   * Execute one leg.
   *
   * @param request Everything the leg needs, already normalised for its provider.
   * @returns The provider's answer.
   */
  execute<T>(request: LlmTransportRequest): Promise<LlmTransportResponse<T>>;
}

/** A single normalised leg execution. */
export interface LlmTransportRequest {
  readonly route: ResolvedRoute;
  readonly content: string | readonly unknown[];
  readonly responseFormat: LlmResponseFormat;
  /** Provider-normalised parameters. A transport sends these verbatim. */
  readonly params: Readonly<Record<string, unknown>>;
  /**
   * System/developer instruction that must precede the conversation.
   *
   * Carried separately from {@link params} because it is not a body parameter:
   * every transport has to turn it into a message, and the message shape differs
   * per provider. A transport that ignores it sends an UNPROMPTED model — which
   * on a tool-carrying call site means the hardening that constrains which tools
   * may fire is simply absent.
   */
  readonly developerPrompt?: string;
  /**
   * Prior turns of the conversation, in provider message shape, that must sit
   * between the developer prompt and `content`.
   *
   * Also not a body parameter, and not optional in effect: a caller that splits
   * "latest user message" into `content` and "everything before it" into context
   * is handing the model its entire memory here. Dropping it does not degrade
   * the answer, it changes the question.
   */
  readonly context?: readonly unknown[];
  readonly signal: AbortSignal;
  readonly correlationId?: string;
}

/** Runtime wiring for the client. */
export interface LlmClientConfig {
  /** Base URL of the gateway. Absent means the gateway leg is unavailable. */
  readonly gatewayBaseUrl?: string;
  /** Env-var NAME holding the gateway key. Never the key itself. */
  readonly gatewayApiKeyEnv?: string;
  /** Transport used while the gateway is reachable. */
  readonly gatewayTransport?: LlmTransport;
  /**
   * Transport used when the gateway itself is unreachable.
   *
   * Kept injectable so the client has no load-time dependency on a provider
   * SDK. A gateway that is a single point of failure would trade one outage
   * mode for a worse one, so this path exists; restricting it to closed-tier
   * legs is what keeps it a safety net rather than a second routing policy.
   */
  readonly directTransport?: LlmTransport;
  /** Clock, injected so timeout and breaker behaviour is testable without waiting. */
  readonly now?: () => number;
}
