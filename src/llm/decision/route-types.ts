/**
 * Types of the decision-route table.
 *
 * The table declares which typed decision routes exist, who serves each, which
 * model each is pinned to, and how far the contract behind it has actually been
 * verified. It is separate from the generative alias table on purpose: an alias
 * route is chat-shaped, has a fallback chain and a one-second budget floor, and
 * none of that describes a call that returns a distribution in a fraction of a
 * second from exactly one model.
 *
 * Two things about a route are declared as data rather than assumed in code,
 * because code that assumed them would be asserting something nobody measured:
 * whether the provider account exists (`account_status`), and whether the
 * contract was confirmed by a real authenticated call or only read from
 * documentation (`contract_evidence`). A route is reachable only when both say
 * so.
 *
 * @module llm/decision/route-types
 */

import type { LlmAccountStatus, LlmBreakerDefaults, LlmModelIdStatus, LlmPriceAnchor } from "../types";
import type { DecisionUnavailableCode } from "./errors";
import type { DecisionRoute } from "./types";

/**
 * How a provider is spoken to.
 *
 * `systemone` is the hosted typed-decision HTTP contract. `engine-judge` is a
 * model the consumer runs in a process of its own; this package declares it and
 * holds no transport for it.
 */
export type DecisionApiStyle = "systemone" | "engine-judge";

/**
 * How the contract behind a route was established.
 *
 * `documentation` means the shapes were read from the vendor's published
 * reference and never exercised with a credential. `authenticated-call` means
 * one real call confirmed them. Only the second admits a route: an error body
 * or a status code that was read rather than observed is a hypothesis.
 */
export type DecisionContractEvidence = "documentation" | "authenticated-call";

/** What a route returns. Every decision route returns per-question distributions. */
export type DecisionResponseKind = "typed-distribution";

/**
 * Where a route's state-token ceiling comes from.
 *
 * `vendor-documented-ceiling` is an upper bound a vendor publishes, not a
 * target. `checkpoint-window` is the share of a local checkpoint's context
 * window left for state once the question and its options are placed.
 */
export type DecisionStateBudgetBasis = "vendor-documented-ceiling" | "checkpoint-window";

/**
 * Whether a locally served checkpoint's artifacts are pinned by digest.
 *
 * `pending-artifact-digests` says no digest has been recorded, so the artifact
 * map is `null`. It is stated rather than left to an empty map, because a
 * digest written without a measurement would pin nothing while reading as a pin.
 */
export type DecisionArtifactPinStatus = "pending-artifact-digests" | "pinned";

/** A provider reached over the hosted typed-decision HTTP contract. */
export interface DecisionHostedProviderDeclaration {
  readonly api_style: "systemone";
  readonly display_name?: string;
  /** The provider's base URL, or `null` when only the environment supplies one. */
  readonly base_url: string | null;
  /** Env-var NAME that overrides `base_url`, or `null` when none does. */
  readonly base_url_env: string | null;
  /** Env-var NAME holding the key. Never the key itself. */
  readonly api_key_env: string;
  /** Where the key lives in the secrets manager. */
  readonly secret_path: string;
  readonly account_status: LlmAccountStatus;
  readonly docs_url?: string;
  readonly notes?: string;
}

/**
 * A model the consumer serves itself.
 *
 * It has no URL and no key name here: this package never contacts it, so there
 * is nothing for it to address or authenticate.
 */
export interface DecisionEngineJudgeProviderDeclaration {
  readonly api_style: "engine-judge";
  readonly display_name?: string;
  readonly account_status: LlmAccountStatus;
  readonly notes?: string;
}

/** One provider, discriminated on `api_style`. */
export type DecisionProviderDeclaration = DecisionHostedProviderDeclaration | DecisionEngineJudgeProviderDeclaration;

/**
 * The request-size limits a route declares.
 *
 * `max_questions` is `null` where the provider publishes no per-request
 * question limit: an unpublished limit is not a limit of zero or of one.
 */
export interface DecisionRouteCapsDeclaration {
  readonly max_options: number;
  readonly max_score_levels: number;
  readonly max_questions: number | null;
}

/** What every route declares, whoever serves it. */
interface DecisionRouteDeclarationCommon {
  /** Key of the provider in the table's `providers`. */
  readonly provider: string;
  readonly response_kind: DecisionResponseKind;
  /**
   * The longest one call on this route may take, in milliseconds.
   *
   * A ceiling, not an operating point: a consumer's own deadline narrows it.
   */
  readonly budget_ms: number;
  readonly caps: DecisionRouteCapsDeclaration;
  /**
   * The most tokens of state the route accepts.
   *
   * A state over it is refused by whoever counts tokens for the route. It is
   * never truncated to fit, because a truncated state is a different question.
   */
  readonly max_state_tokens: number;
  readonly max_state_tokens_basis: DecisionStateBudgetBasis;
  /** The price anchor, or `null` for a route that bills nothing per token. */
  readonly price_per_mtok: LlmPriceAnchor | null;
  readonly notes?: string;
}

/** A route this package serves over HTTP. */
export interface DecisionUtilsServedRouteDeclaration extends DecisionRouteDeclarationCommon {
  readonly served_by: "utils";
  /**
   * The model id written into every request.
   *
   * A versioned id, never a moving name: a name that follows the vendor's
   * latest release changes the answering model with no change on this side.
   */
  readonly version_pin: string;
  /** The model id a response must report. Any other answering model is a fault. */
  readonly expected_served_model: string;
  readonly model_id_status: LlmModelIdStatus;
  readonly model_id_source?: string | null;
  readonly contract_evidence: DecisionContractEvidence;
  /** The date an authenticated call confirmed the contract, or `null` when none has. */
  readonly contract_verified: string | null;
}

/** A route the consumer serves in its own process. */
export interface DecisionEngineServedRouteDeclaration extends DecisionRouteDeclarationCommon {
  readonly served_by: "engine";
  /** The checkpoint's name. */
  readonly checkpoint: string;
  /** The version of the serving package the checkpoint is loaded with. */
  readonly package_version: string;
  /** The checkpoint's source revision, as a full commit hash. */
  readonly revision: string;
  /** File name to SHA-256 for each artifact, or `null` while none is recorded. */
  readonly artifact_sha256: Readonly<Record<string, string>> | null;
  readonly pin_status: DecisionArtifactPinStatus;
}

/** One route, discriminated on `served_by`. */
export type DecisionRouteDeclaration = DecisionUtilsServedRouteDeclaration | DecisionEngineServedRouteDeclaration;

/** Defaults every decision route inherits. */
export interface DecisionRouteDefaults {
  /** Tuning for the decision client's own breakers, which share nothing with the generative client's. */
  readonly circuit_breaker: LlmBreakerDefaults;
}

/**
 * The decision-route table.
 *
 * `routes` is keyed by string, as parsed JSON is. That every key is a
 * {@link DecisionRoute}, and that every route is present, is established by the
 * table's load-time check and not by this type.
 */
export interface DecisionRouteTable {
  readonly schema_version: number;
  readonly policy_source: string;
  readonly revised?: string;
  readonly defaults: DecisionRouteDefaults;
  readonly providers: Readonly<Record<string, DecisionProviderDeclaration>>;
  readonly routes: Readonly<Record<string, DecisionRouteDeclaration>>;
}

/** A route's request-size limits, as the encoder reads them. */
export interface DecisionRouteCaps {
  readonly maxOptions: number;
  readonly maxScoreLevels: number;
  /** `null` where the route declares no per-request question limit. */
  readonly maxQuestions: number | null;
}

/**
 * Whether a route may be called from this package, and why not when it may not.
 *
 * A refusal carries the code the caller's error will carry, so the reason a
 * route is closed is decided once, where the table is read.
 */
export type DecisionRouteAdmission =
  | { readonly admit: true }
  | {
      readonly admit: false;
      readonly code: Exclude<DecisionUnavailableCode, "breaker_open">;
      readonly reason: string;
    };

/**
 * A route resolved for execution.
 *
 * Only a route this package serves and admits resolves, so every field a call
 * needs is present: there is no partly resolved route to guard against.
 */
export interface ResolvedDecisionRoute {
  readonly route: DecisionRoute;
  readonly providerName: string;
  readonly provider: DecisionHostedProviderDeclaration;
  /** The model id written into the request. */
  readonly modelPin: string;
  /** The model id a response must report. */
  readonly expectedServedModel: string;
  readonly budgetMs: number;
  readonly caps: DecisionRouteCaps;
  readonly maxStateTokens: number;
  readonly priceAnchor: LlmPriceAnchor | null;
  /** Env-var NAME holding the key. Never the key itself. */
  readonly apiKeyEnv: string;
  /** The base URL to call, with the environment override applied. */
  readonly baseUrl: string;
}
