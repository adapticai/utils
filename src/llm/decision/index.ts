/**
 * Public surface of the typed decision client.
 *
 * Everything a consumer needs to ask a typed decision model is here: the
 * client, the route table every consumer reads, the codec a consumer that
 * serves a route itself encodes and validates with, the fault vocabulary and
 * the types.
 *
 * What reaches a vendor without the client is deliberately not. The hosted
 * transport is the only code in this package that speaks to the vendor, and it
 * neither checks admission nor holds a breaker, a guard or a budget; exported,
 * it would let a call site reach the vendor on a route the table leaves closed.
 * Its types are exported, because wiring the client for a test needs them. The
 * function that builds it is not.
 *
 * Each name is listed, never re-exported wholesale, so that adding one to this
 * surface is a line someone wrote and reviewed.
 *
 * @module llm/decision
 */

export { callDecisionModel, configureDecisionClient, decisionBreakerKey, decisionBreakers } from "./decision-client";
export type { DecisionClientConfig } from "./decision-client";

export {
  decisionRouteAdmission,
  decisionRouteDeclaration,
  decisionRouteTable,
  decisionRouteViolations,
  listDecisionRoutes,
} from "./decision-route-table";
export type { DecisionRouteEnvironment } from "./decision-route-table";

export { decodeDecisionResponse, encodeDecisionRequest } from "./codec";
export type { DecisionDecodeOptions, DecisionEncodeOptions, DecodedDecisionResponse } from "./codec";

export { decisionUsageOf } from "./metering";
export type { DecisionUsageIdentity } from "./metering";

export {
  DECISION_CLIENT_FAULT_STAGES,
  DECISION_FAULTS,
  DECISION_UNAVAILABLE_CODES,
  DecisionAdmissionError,
  DecisionCallError,
  DecisionClientFaultError,
  DecisionCredentialError,
  DecisionRequestInvalidError,
  DecisionResponseFormatError,
  DecisionRouteMismatchError,
  DecisionRouteUnavailableError,
  DecisionTimeoutError,
  DecisionTransportError,
} from "./errors";
export type {
  DecisionAdmissionDetails,
  DecisionAdmissionSource,
  DecisionClientFaultDetails,
  DecisionClientFaultStage,
  DecisionCredentialDetails,
  DecisionFault,
  DecisionRequestInvalidDetails,
  DecisionResponseFormatDetails,
  DecisionRouteMismatchDetails,
  DecisionRouteUnavailableDetails,
  DecisionTimeoutDetails,
  DecisionTimeoutSource,
  DecisionTransportDetails,
  DecisionUnavailableCode,
} from "./errors";

export type {
  DecisionApiStyle,
  DecisionArtifactPinStatus,
  DecisionContractEvidence,
  DecisionEngineJudgeProviderDeclaration,
  DecisionEngineServedRouteDeclaration,
  DecisionHostedProviderDeclaration,
  DecisionProviderDeclaration,
  DecisionResponseKind,
  DecisionRouteAdmission,
  DecisionRouteCaps,
  DecisionRouteCapsDeclaration,
  DecisionRouteDeclaration,
  DecisionRouteDefaults,
  DecisionRouteTable,
  DecisionStateBudgetBasis,
  DecisionUtilsServedRouteDeclaration,
  ResolvedDecisionRoute,
} from "./route-types";

export type { SystemOneTransport, SystemOneTransportRequest, SystemOneTransportResult } from "./transports/systemone";

export { DECISION_ROUTES } from "./types";
export type {
  DecisionAnswer,
  DecisionAnsweredAttemptRecord,
  DecisionAttemptMeasurement,
  DecisionAttemptRecord,
  DecisionCallOptions,
  DecisionCallResult,
  DecisionChoiceAnswer,
  DecisionChoiceQuestion,
  DecisionDescription,
  DecisionFaultedAttemptRecord,
  DecisionInstructions,
  DecisionJson,
  DecisionJsonArray,
  DecisionJsonObject,
  DecisionNoulAnswer,
  DecisionNoulCriteria,
  DecisionNoulQuestion,
  DecisionQuestion,
  DecisionQuestionType,
  DecisionRequest,
  DecisionRoute,
  DecisionScoreAnswer,
  DecisionScoreQuestion,
  DecisionState,
  DecisionWireRequest,
  DecisionWireResponse,
  DecisionWireUsage,
} from "./types";
