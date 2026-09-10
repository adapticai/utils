/**
 * Type surface for the LLM call-site inventory (backlog W1-01).
 *
 * The inventory is the audit artefact the whole provider migration is planned
 * against: every place application code can reach a language model, described
 * in one machine-checkable shape. Types live in their own module so the
 * emitted document, the detectors that build it, and the tests that police it
 * all agree on one definition rather than three drifting ones.
 *
 * @module scripts/inventory/types
 */

/** Latency budget class a call site operates under (migration doc Section 4). */
export type LatencyClass = "hot-path" | "background" | "batch";

/** Blast-radius class of a call site (migration doc Section 4). */
export type Criticality = "trading-adjacent" | "ops" | "internal";

/**
 * The five capability flags the inventory schema records per site.
 *
 * These describe what the site asks of a provider. They are not the same set
 * as the adapter-forcing signals: `tool_use` is portable across providers,
 * whereas `cache_control` is not, so capability and adapter necessity are
 * modelled separately (see {@link AdapterSignals}).
 */
export type CapabilityFeature =
  | "tool_use"
  | "json_schema"
  | "streaming"
  | "vision"
  | "cache_control";

/** Inventory site lifecycle state. A freshly scanned site is always `discovered`. */
export type SiteStatus = "discovered";

/** Monthly token volume for a site. Zeroed by the scanner; joined from billing exports at W1-03. */
export interface MonthlyTokens {
  /** Input tokens per month. */
  readonly in: number;
  /** Output tokens per month. */
  readonly out: number;
}

/**
 * One inventory site, in exactly the authoritative Section-4 shape.
 *
 * `model_current` is `null` when the site reaches a model without naming a
 * vendor literal (the model arrives from config or a caller). Absence is
 * recorded as absence: inventing a default here would silently assert a route
 * that no code performs.
 */
export interface InventorySite {
  /** Stable identifier: `<repo>/<repo-relative path>#L<line>`. */
  readonly site_id: string;
  /** Vendor model literal named at this site, or `null` when the site names none. */
  readonly model_current: string | null;
  /** Capability flags detected at this site, sorted for stable output. */
  readonly features: readonly CapabilityFeature[];
  /** Latency budget class, from the path-heuristic table. */
  readonly latency_class: LatencyClass;
  /** Blast-radius class, from the path-heuristic table. */
  readonly criticality: Criticality;
  /** Monthly token volume. Always zero from the scanner — it cannot know this. */
  readonly monthly_tokens: MonthlyTokens;
  /** Semantic alias the site already names, or `null` when it names none. */
  readonly alias: string | null;
  /** True when a Section-3 adapter-forcing signal is present. */
  readonly needs_adapter: boolean;
  /** Eval-gate spec. Always `null` from the scanner; assigned at W2-01. */
  readonly eval_gate: null;
  /** Lifecycle state. Always `discovered` from the scanner. */
  readonly status: SiteStatus;
}

/**
 * Signals that force a provider adapter, per migration doc Section 3.
 *
 * Kept distinct from {@link CapabilityFeature} because adapter necessity is a
 * question about provider portability, not about what the call does. Two of
 * these (context size, provider-specific streaming) are not capabilities the
 * schema records at all.
 */
export interface AdapterSignals {
  /** Site uses provider prompt-cache breakpoints (`cache_control` and friends). */
  readonly cache_control: boolean;
  /** Site asks for a strict (schema-enforced) JSON response format. */
  readonly strict_json_schema: boolean;
  /** Site sends image content parts. */
  readonly vision: boolean;
  /** Site declares a context window above the portability threshold. */
  readonly context_over_threshold: boolean;
  /** Site consumes a vendor-shaped streaming envelope rather than a normalised one. */
  readonly provider_specific_streaming: boolean;
}

/** Why a file or line was picked up, retained for triage rather than emitted in the schema. */
export type AnchorKind =
  | "sdk_import"
  | "lumic_entry_import"
  | "wrapper_import"
  | "llm_call"
  | "sdk_construction"
  | "model_literal"
  | "provider_key_env"
  | "alias_usage";

/** One detected anchor: a single line that proves the file reaches a model. */
export interface DetectedAnchor {
  /** 1-based line number of the anchor. */
  readonly line: number;
  /** What kind of evidence this anchor is. */
  readonly kind: AnchorKind;
  /** Human-readable evidence (symbol, module specifier, or literal). */
  readonly detail: string;
  /** Vendor model literal carried by this anchor, when it is one. */
  readonly modelLiteral: string | null;
  /** Semantic alias carried by this anchor, when it is one. */
  readonly alias: string | null;
}

/** Everything the detectors learned about one source file. */
export interface FileScanResult {
  /** Repository name (`engine`, `utils`, `lumic-utils`, `backend-legacy`). */
  readonly repo: string;
  /** Repo-relative POSIX path of the file. */
  readonly path: string;
  /** Anchors found, sorted by line then kind. */
  readonly anchors: readonly DetectedAnchor[];
  /** Capability flags for the file, sorted. */
  readonly features: readonly CapabilityFeature[];
  /** Adapter-forcing signals for the file. */
  readonly adapterSignals: AdapterSignals;
}

/** Detector inputs that vary with the route table rather than being hard-coded. */
export interface DetectorConfig {
  /** Provider API-key environment-variable names to treat as anchors. */
  readonly providerKeyEnvVars: readonly string[];
  /** Semantic alias names to treat as anchors. */
  readonly aliasNames: readonly string[];
}

/** A file recorded as a registry rather than a call site. */
export interface RegistryRecord {
  /** Repo-qualified POSIX path. */
  readonly path: string;
  /** Why the file legitimately holds vendor strings without being a call site. */
  readonly reason: string;
}

/** The emitted inventory document. */
export interface InventoryDocument {
  /** Schema revision of this document shape. */
  readonly schema_version: number;
  /**
   * Version of the path-heuristic table used for `latency_class` / `criticality`.
   * Recorded so the W1-02 classification pass can tell what it is overriding.
   */
  readonly heuristics_version: string;
  /** Relative path of the generator, so a stale artefact is traceable to its producer. */
  readonly generator: string;
  /** Repositories scanned, sorted. */
  readonly repos: readonly string[];
  /** Discovered call sites, sorted by `site_id`. */
  readonly sites: readonly InventorySite[];
  /** Files excluded as registries, sorted by path. */
  readonly registries: readonly RegistryRecord[];
}
