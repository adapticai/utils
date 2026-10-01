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

/**
 * The same model served somewhere else: another provider, or another
 * deployment at the same provider.
 *
 * An equivalent is the only thing a leg may be retried or hedged on without
 * changing which model answers. It is admitted by the same rules as a leg — a
 * confirmed model id and a live provider account — so an equivalent that
 * cannot serve today is carried in the table without being reached.
 */
export interface LlmRouteEquivalent {
  readonly provider: string;
  readonly model_id: string | null;
  readonly model_id_status: LlmModelIdStatus;
  readonly model_id_source?: string | null;
  readonly lumic_model?: string | null;
  readonly params?: LlmRouteParams;
  readonly notes?: string;
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
  /**
   * The model this leg serves, independent of which provider hosts it.
   * Absent means the model id itself: two legs are the same model exactly when
   * their classes are equal.
   */
  readonly model_class?: string;
  /** The same model at other providers or deployments, reached before any different-model leg. */
  readonly equivalents?: readonly LlmRouteEquivalent[];
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
  /** How long a breaker tripped by a run containing any hard failure stays open. */
  readonly cooldown_ms: number;
  /**
   * How long a breaker tripped only by capacity signals (provider busy, 429,
   * 503, 529, leg timeout) stays open. Absent means `cooldown_ms`.
   */
  readonly capacity_cooldown_ms?: number;
  readonly half_open_probes: number;
  /**
   * Half-open probes as a fraction of the route's concurrency before it
   * opened. The probe budget is the larger of this and `half_open_probes`, so
   * a route that carried forty calls at once is not re-tested by one.
   * Absent means `half_open_probes` alone.
   */
  readonly probe_fraction?: number;
  /** Open on sustained slowness as well as on failures. Absent means failures only. */
  readonly latency_trip?: LlmLatencyTripDefaults;
}

/**
 * Tripping a breaker on latency rather than on failure.
 *
 * A route whose answers arrive, but arrive later than the caller can use, is
 * failing in every way that matters to a hot path while never producing an
 * error. The trip reads a quantile of attempt durations over fixed-size
 * windows and opens when M of the last N windows exceeded the latency class's
 * objective.
 */
export interface LlmLatencyTripDefaults {
  /**
   * Whether the trip is armed. Opening a breaker moves its traffic to the next
   * leg, which is usually a different model; arming it is therefore a routing
   * choice, not a pure latency mechanic, and it ships disarmed.
   */
  readonly enabled: boolean;
  /** Latency objective per latency class, in milliseconds. */
  readonly slo_ms: Readonly<Record<LlmLatencyClass, number>>;
  /** The quantile of a window compared against the objective, in (0, 1). */
  readonly quantile: number;
  /** Attempts per window. */
  readonly window_size: number;
  /** Windows over the objective, of the last `of_windows`, that open the breaker. */
  readonly trip_windows: number;
  readonly of_windows: number;
}

/**
 * Tail-latency controls for attempts on the SAME model.
 *
 * None of these selects a different model: they decide when a second attempt
 * on the same model starts, and how long one attempt may hold the caller's
 * deadline while a same-model alternative waits.
 */
export interface LlmHedgingDefaults {
  /** Extra same-model attempts one leg may start, equivalents and duplicates together. */
  readonly max_same_model_hedges: number;
  /** Healthy-latency quantile after which a hedge starts, in (0, 1). */
  readonly hedge_quantile: number;
  /** Healthy-latency quantile the per-attempt timeout scales, in (0, 1). */
  readonly timeout_quantile: number;
  /** Multiplier on the timeout quantile. */
  readonly k_timeout: number;
  /** Lower bound on a measured per-attempt timeout, in milliseconds. */
  readonly attempt_timeout_floor_ms: number;
  /**
   * Share of a leg's remaining budget one attempt may hold before a waiting
   * same-model equivalent is started beside it, in (0, 1].
   */
  readonly max_attempt_share: number;
  /**
   * Fraction of a provider guard's concurrency and rate capacity kept free:
   * a duplicate on the same provider is started only above it, so hedging
   * never takes the capacity first attempts need.
   */
  readonly duplicate_headroom_reserve: number;
  /** Healthy samples a (provider, model, prompt-size) cell needs before it is used. */
  readonly min_samples: number;
  /** Samples kept per cell. */
  readonly window_size: number;
  /** Samples older than this are discarded, in milliseconds. */
  readonly sample_max_age_ms: number;
  /** Ascending prompt-token boundaries splitting samples into size buckets. */
  readonly prompt_token_buckets: readonly number[];
}

/** Defaults every alias inherits. */
export interface LlmRouteDefaults {
  readonly request_timeout_ms: Readonly<Record<LlmLatencyClass, number>>;
  /**
   * Retries the GATEWAY makes within one leg (its rendered `num_retries`). The
   * client never retries within a leg; it hedges on the same model instead.
   */
  readonly retries_per_leg: number;
  readonly circuit_breaker: LlmBreakerDefaults;
  /** Same-model tail-latency controls. Absent means no hedging and route-budget timeouts. */
  readonly hedging?: LlmHedgingDefaults;
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
  /**
   * @deprecated Never read by the client, which does not retry within a leg;
   * the gateway's own retry count lives in the route table's defaults. No
   * longer populated by the resolver.
   */
  readonly retriesPerLeg?: number;
  /** The model this leg serves, independent of provider. Absent means `modelId`. */
  readonly modelClass?: string;
  /** Latency class of the alias, which selects the latency objective. */
  readonly latencyClass?: LlmLatencyClass;
  /** The same model at other live providers, in table order. */
  readonly equivalents?: readonly ResolvedRoute[];
}

/**
 * How a different-model leg may be used once the configured model's attempts
 * are spent.
 *
 * `allow` and `allow_record` both run it, and both record the relation on
 * every attempt; the distinction is the consumer's, which may alert or gate on
 * `allow_record`. `deny` never runs it: the call ends with a
 * `cross_model_denied` exhaustion, which a caller maps to no decision.
 */
export type LlmCrossModelPolicy = "allow" | "allow_record" | "deny";

/**
 * Whether an answer came from the configured model.
 *
 * `unknown` is a leg that should have been the configured model but whose
 * provider did not say which model answered: it is not asserted either way.
 */
export type LlmModelClassRelation = "same" | "different" | "unknown";

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

/**
 * Why the provider stopped generating, as it reported it.
 *
 * The named members are the values the OpenAI-compatible chat-completions
 * contract defines. `length` is the load-bearing one for a consumer: it means
 * the completion hit the request's output cap and was CUT, so a reply that
 * parses as absent or malformed is the caller's own cap rather than the model
 * declining — two states with opposite remedies.
 *
 * The union stays open to any other non-empty string because a gateway may
 * forward a provider-specific reason, and narrowing an unrecognized value to a
 * known member (or to `"other"`) would discard the only evidence of what
 * happened. Unreported is `null`, never a substituted default: a fabricated
 * `"stop"` would make a truncated call read as a clean one.
 */
export type LlmFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "function_call"
  | (string & Record<never, never>);

/**
 * The finish reasons the OpenAI-compatible contract defines.
 *
 * Exported so a consumer can tell a defined reason from a provider-specific one
 * without re-stating the list and drifting from it.
 */
export const KNOWN_LLM_FINISH_REASONS: readonly string[] = [
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "function_call",
];

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
  /** The provider the gateway reports as having served the answer, or `null`. */
  readonly servedProvider?: string | null;
  /**
   * Why the provider stopped generating, from the answering choice's
   * `finish_reason`, or `null` when it reported none.
   *
   * Carried because a consumer cannot otherwise distinguish a reply the model
   * chose to end from one the request's own output cap CUT. Those look identical
   * downstream — both arrive as an absent or unparseable answer — and they have
   * opposite remedies: raise the cap, or treat the model's answer as given.
   * {@link LlmFinishReason} documents why an unrecognized value passes through
   * verbatim and why absence stays `null`.
   */
  readonly finishReason?: LlmFinishReason | null;
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
  /** Whether the answer came from the configured model. See {@link LlmModelClassRelation}. */
  readonly modelClassRelation?: LlmModelClassRelation;
  /** Whether the answering attempt was a hedge rather than a leg's first attempt. */
  readonly hedged?: boolean;
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
  /** The provider that served, or was asked to serve, this attempt; `null` when unknown. */
  readonly servedProvider?: string | null;
  /** The model class the attempt was addressed to. */
  readonly modelClass?: string;
  /** Whether this attempt's model is the configured one. */
  readonly modelClassRelation?: LlmModelClassRelation;
  /** Whether this attempt was a same-model hedge rather than its leg's first attempt. */
  readonly hedged?: boolean;
  /** Zero-based dispatch order across the whole call. */
  readonly attemptIndex?: number;
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
  /**
   * Whether a different-model leg may answer once the configured model's
   * attempts are spent. Absent means `allow_record`, which is the chain's
   * historical behaviour.
   */
  readonly crossModelPolicy?: LlmCrossModelPolicy;
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
  /**
   * Decides whether a duplicate attempt on the same provider may start.
   * Defaults to the provider guard's headroom check; injectable for tests.
   */
  readonly duplicateAdmission?: (route: ResolvedRoute, reserveFraction: number) => boolean;
}
