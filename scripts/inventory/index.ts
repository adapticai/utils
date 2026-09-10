/**
 * Public surface of the LLM inventory detector library (backlog W1-01).
 *
 * Deliberately outside `src/`. Everything under `src/` is compiled into the
 * published `@adaptic/utils` package and emits a declaration into
 * `dist/types/`, so a detector module that statically imports `typescript` —
 * a devDependency — would ask every consumer of a financial-utilities library
 * to resolve the TypeScript compiler API through this package's own
 * declarations. Build-time audit tooling belongs beside the script that runs
 * it, not in the published API surface.
 *
 * @module scripts/inventory
 */

export type {
  AdapterSignals,
  AnchorKind,
  CapabilityFeature,
  Criticality,
  DetectedAnchor,
  DetectorConfig,
  FileScanResult,
  InventoryDocument,
  InventorySite,
  LatencyClass,
  MonthlyTokens,
  RegistryRecord,
  SiteStatus,
} from "./types";

export {
  ADAPTER_FORCING_SIGNALS,
  detectAdapterSignals,
  detectFeatures,
  emptySourceMarkers,
  needsAdapter,
} from "./capabilities";
export type { SourceMarkers } from "./capabilities";

export {
  BASELINE_PROVIDER_KEY_ENV_VARS,
  buildDetectorConfig,
  CONTEXT_WINDOW_ADAPTER_THRESHOLD_TOKENS,
  LLM_CALL_EXPRESSIONS,
  LLM_SURFACE_SYMBOLS,
  LUMIC_LLM_ENTRY_SYMBOLS,
  LUMIC_MODULE,
  MODEL_LITERAL_PATTERNS,
  NON_MODEL_TRAILING_SEGMENTS,
  SDK_CONSTRUCTORS,
  UNQUALIFIED_LLM_CALL_NAMES,
  VENDOR_SDK_MODULES,
  WRAPPER_SYMBOLS,
} from "./detector-config";

export {
  classifyScope,
  EXCLUDED_FILE_SUFFIXES,
  EXCLUDED_PATH_PREFIXES,
  EXCLUDED_PATH_SEGMENTS,
  REGISTRY_FILES,
  SCANNED_FILE_EXTENSIONS,
  SELF_EXCLUDED_PATHS,
  SELF_EXCLUDED_PREFIXES,
} from "./exclusions";
export type { ScopeDecision } from "./exclusions";

export {
  CONSERVATIVE_DEFAULT,
  classifyPath,
  HEURISTICS_VERSION,
  PATH_HEURISTIC_RULES,
} from "./path-heuristics";
export type { PathClassification, PathHeuristicRule } from "./path-heuristics";

export { isVendorModelLiteral, isVendorSdkModule, scanSource } from "./detectors";
export type { ScanSourceInput } from "./detectors";

export { buildSitesForFile, sortSites } from "./build-sites";

export { validateAgainstSchema } from "./schema-validator";
export type { JsonSchema, JsonValue } from "./schema-validator";
