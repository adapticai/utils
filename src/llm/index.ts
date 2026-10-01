/**
 * Public surface of the alias-resolving LLM client.
 *
 * Everything a consumer needs to make an LLM call is here, and everything it
 * needs to make one WITHOUT the timeout, breaker and fallback controls is
 * deliberately not. The client is the only exported way to reach a model, so a
 * call site cannot bypass the routing policy by importing something lower down.
 *
 * @module llm
 */

export {
  callLLMByAlias,
  configureLlmClient,
  llmAliases,
  llmBreakers,
  llmLatencyTracker,
} from "./alias-client";

export {
  ChainExhaustedError,
  LlmDeadlineExceededError,
  isSameReportedModel,
  legBudgetMs,
  modelClassOf,
  modelClassRelationOf,
  sumUsage,
} from "./fallback-chain";
export type { ChainExhaustionReason } from "./fallback-chain";

export { LegLatencyTracker, estimatePromptTokens } from "./leg-latency-tracker";
export type { LatencyTrackerConfig } from "./leg-latency-tracker";
export type { AliasAttemptRecord } from "./types";

export {
  EQUIVALENT_SEPARATOR,
  NoServableRouteError,
  UnknownAliasError,
  closedIncumbentLeg,
  gatewayModelNameFor,
  listAliases,
  orderedRoutes,
  resolveChain,
  routeKeyFor,
  routeTable,
  tailLatencyViolations,
} from "./route-table";
export type { ResolvedChain, RouteExclusion } from "./route-table";

export {
  ToolChoiceIgnoredError,
  UnsupportedCapabilityError,
  assertToolChoiceHonoured,
  normaliseParams,
  routeSupports,
} from "./param-matrix";

export {
  RateGuardTimeoutError,
  guardSnapshots,
  hasDuplicateHeadroom,
  limitsFor,
  limitsInventory,
  resetProviderGuards,
  withProviderGuards,
} from "./rate-guard";
export type {
  GuardCallScope,
  GuardSnapshot,
  ModelLimitOverride,
  ProviderLimitBasis,
  ProviderLimitScope,
  ProviderLimits,
} from "./rate-guard";

export { LlmResponseFormatError } from "./structured-content";
export type { StructuredResponseFormat } from "./structured-content";

export { CircuitBreakerRegistry } from "./circuit-breaker";
export type { BreakerFailureKind, BreakerSnapshot, BreakerState } from "./circuit-breaker";

export { SchemaRetryExhaustedError, buildRetryPrompt, callWithValidation } from "./schema-retry";
export type { ValidatedOutcome } from "./schema-retry";

export {
  StreamProviderError,
  StreamTruncatedError,
  collectStream,
  normaliseAnthropicStream,
  normaliseOpenAiStream,
  normaliseStream,
} from "./streaming";
export type { StreamChunk } from "./streaming";

export {
  GatewayResponseError,
  GatewayUnreachableError,
  SERVED_MODEL_HEADER,
  SERVED_PROVIDER_HEADER,
  createGatewayTransport,
  servedModelOf,
} from "./transports/gateway";
export type { GatewayTransportConfig } from "./transports/gateway";

export {
  DirectTransportRefusedError,
  createDirectTransport,
  resolveDefaultDirectCaller,
} from "./transports/direct";
export type {
  DirectCaller,
  DirectCallerUsage,
  DirectTransportConfig,
} from "./transports/direct";

export type {
  AliasCallOptions,
  AliasCallResult,
  LlmAlias,
  LlmAliasBudget,
  LlmAliasDefinition,
  LlmClientConfig,
  LlmCriticality,
  LlmCrossModelPolicy,
  LlmHedgeRefusals,
  LlmHedgingDefaults,
  LlmLatencyClass,
  LlmLatencyTripDefaults,
  LlmModelClassRelation,
  LlmModelIdStatus,
  LlmOpenItem,
  LlmPriceAnchor,
  LlmProvider,
  LlmProviderTier,
  LlmResponseFormat,
  LlmRoute,
  LlmRouteDefaults,
  LlmRouteEquivalent,
  LlmRouteParams,
  LlmRouteRole,
  LlmRouteTable,
  LlmToolCall,
  LlmToolChoice,
  LlmTransport,
  LlmTransportRequest,
  LlmTransportResponse,
  LlmUsageRecord,
  LlmValidationOutcome,
  ResolvedRoute,
} from "./types";
