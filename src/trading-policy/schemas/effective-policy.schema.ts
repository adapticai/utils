import { z } from "zod";
import { AutonomyMode, LlmProvider } from "../enums";
import { AutonomyPrefsSchema } from "./autonomy-prefs.schema";
import { AssetUniversePrefsSchema } from "./asset-universe-prefs.schema";
import { RiskBudgetPrefsSchema } from "./risk-budget-prefs.schema";
import { SignalConsumptionPrefsSchema } from "./signal-consumption-prefs.schema";
import { ExecutionPrefsSchema } from "./execution-prefs.schema";
import { PositionManagementPrefsSchema } from "./position-management-prefs.schema";
import { PortfolioConstructionPrefsSchema } from "./portfolio-construction-prefs.schema";
import { OverlayResponsePrefsSchema } from "./overlay-response-prefs.schema";
import { ModelPrefsSchema } from "./model-prefs.schema";
import { AuditNotificationPrefsSchema } from "./audit-notification-prefs.schema";

/**
 * Effective trading policy schema representing the fully-resolved policy
 * with all required fields populated. This is the runtime contract for the
 * trading engine -- every field is required (no optionals).
 */
export const EffectiveTradingPolicySchema = z.object({
  autonomyMode: z.nativeEnum(AutonomyMode),
  realtimeTradingEnabled: z.boolean(),
  paperTradingOnly: z.boolean(),
  killSwitchEnabled: z.boolean(),
  equitiesEnabled: z.boolean(),
  etfsEnabled: z.boolean(),
  cryptoEnabled: z.boolean(),
  optionsEnabled: z.boolean(),
  futuresEnabled: z.boolean(),
  forexEnabled: z.boolean(),
  shortingEnabled: z.boolean(),
  marginEnabled: z.boolean(),
  fractionalSharesEnabled: z.boolean(),
  maxBuyingPowerUtilPct: z.number(),
  cashFloorPct: z.number(),
  maxGrossExposurePct: z.number(),
  maxNetExposurePct: z.number(),
  maxLeverage: z.number(),
  maxSymbolConcentrationPct: z.number(),
  maxSectorConcentrationPct: z.number(),
  maxOpenPositions: z.number(),
  maxOpenOrders: z.number(),
  macroOverlayEnabled: z.boolean(),
  sectorOverlayEnabled: z.boolean(),
  volatilityOverlayEnabled: z.boolean(),
  liquidityStressOverlayEnabled: z.boolean(),
  blackSwanProtectionEnabled: z.boolean(),
  drawdownGuardianEnabled: z.boolean(),
  correlationSpikeProtectionEnabled: z.boolean(),
  newsEventRiskOverlayEnabled: z.boolean(),
  exchangeHealthOverlayEnabled: z.boolean(),
  dataQualitySentinelEnabled: z.boolean(),
  miniModelProvider: z.nativeEnum(LlmProvider).nullable(),
  miniModelId: z.string().nullable(),
  normalModelProvider: z.nativeEnum(LlmProvider).nullable(),
  normalModelId: z.string().nullable(),
  advancedModelProvider: z.nativeEnum(LlmProvider).nullable(),
  advancedModelId: z.string().nullable(),
  autonomyPrefs: AutonomyPrefsSchema,
  assetUniversePrefs: AssetUniversePrefsSchema,
  riskBudgetPrefs: RiskBudgetPrefsSchema,
  signalConsumptionPrefs: SignalConsumptionPrefsSchema,
  executionPrefs: ExecutionPrefsSchema,
  positionManagementPrefs: PositionManagementPrefsSchema,
  portfolioConstructionPrefs: PortfolioConstructionPrefsSchema,
  overlayResponsePrefs: OverlayResponsePrefsSchema,
  modelPrefs: ModelPrefsSchema,
  auditNotificationPrefs: AuditNotificationPrefsSchema,
});

/** Inferred TypeScript type for a fully-resolved effective trading policy. */
export type EffectiveTradingPolicy = z.infer<
  typeof EffectiveTradingPolicySchema
>;
