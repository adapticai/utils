import { z } from 'zod';
import { AutonomyPrefsObjectSchema } from './autonomy-prefs.schema';
import { AssetUniversePrefsObjectSchema } from './asset-universe-prefs.schema';
import { RiskBudgetPrefsObjectSchema } from './risk-budget-prefs.schema';
import { SignalConsumptionPrefsObjectSchema } from './signal-consumption-prefs.schema';
import { ExecutionPrefsObjectSchema } from './execution-prefs.schema';
import { PositionManagementPrefsObjectSchema } from './position-management-prefs.schema';
import { PortfolioConstructionPrefsObjectSchema } from './portfolio-construction-prefs.schema';
import { OverlayResponsePrefsObjectSchema } from './overlay-response-prefs.schema';
import { ModelPrefsObjectSchema } from './model-prefs.schema';
import { AuditNotificationPrefsObjectSchema } from './audit-notification-prefs.schema';
import { AutonomyMode, LlmProvider } from '../enums';

/**
 * Policy mutation schema for partial updates to a trading policy.
 * All fields are optional to allow selective mutation of individual settings.
 * Uses `deepPartial()` on nested preference schemas so callers can update
 * a single leaf field without supplying the entire sub-object.
 * Uses `passthrough()` to allow additional fields for forward-compatibility.
 */
export const PolicyMutationSchema = z.object({
  autonomyMode: z.nativeEnum(AutonomyMode).optional(),
  realtimeTradingEnabled: z.boolean().optional(),
  paperTradingOnly: z.boolean().optional(),
  killSwitchEnabled: z.boolean().optional(),
  equitiesEnabled: z.boolean().optional(),
  etfsEnabled: z.boolean().optional(),
  cryptoEnabled: z.boolean().optional(),
  optionsEnabled: z.boolean().optional(),
  futuresEnabled: z.boolean().optional(),
  forexEnabled: z.boolean().optional(),
  shortingEnabled: z.boolean().optional(),
  marginEnabled: z.boolean().optional(),
  fractionalSharesEnabled: z.boolean().optional(),
  maxBuyingPowerUtilPct: z.number().optional(),
  cashFloorPct: z.number().optional(),
  maxGrossExposurePct: z.number().optional(),
  maxNetExposurePct: z.number().optional(),
  maxLeverage: z.number().optional(),
  maxSymbolConcentrationPct: z.number().optional(),
  maxSectorConcentrationPct: z.number().optional(),
  maxOpenPositions: z.number().optional(),
  maxOpenOrders: z.number().optional(),
  miniModelProvider: z.nativeEnum(LlmProvider).nullable().optional(),
  miniModelId: z.string().nullable().optional(),
  normalModelProvider: z.nativeEnum(LlmProvider).nullable().optional(),
  normalModelId: z.string().nullable().optional(),
  advancedModelProvider: z.nativeEnum(LlmProvider).nullable().optional(),
  advancedModelId: z.string().nullable().optional(),
  autonomyPrefs: AutonomyPrefsObjectSchema.deepPartial().optional(),
  assetUniversePrefs: AssetUniversePrefsObjectSchema.deepPartial().optional(),
  riskBudgetPrefs: RiskBudgetPrefsObjectSchema.deepPartial().optional(),
  signalConsumptionPrefs: SignalConsumptionPrefsObjectSchema.deepPartial().optional(),
  executionPrefs: ExecutionPrefsObjectSchema.deepPartial().optional(),
  positionManagementPrefs: PositionManagementPrefsObjectSchema.deepPartial().optional(),
  portfolioConstructionPrefs: PortfolioConstructionPrefsObjectSchema.deepPartial().optional(),
  overlayResponsePrefs: OverlayResponsePrefsObjectSchema.deepPartial().optional(),
  modelPrefs: ModelPrefsObjectSchema.deepPartial().optional(),
  auditNotificationPrefs: AuditNotificationPrefsObjectSchema.deepPartial().optional(),
}).passthrough();

/** Inferred TypeScript type for a policy mutation payload. */
export type PolicyMutation = z.infer<typeof PolicyMutationSchema>;
