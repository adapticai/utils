import { z } from "zod";

/** Schema for trailing stop tightening rules that adjust stop distance at profit thresholds. */
const TrailingStopTighteningRuleSchema = z.object({
  profitThresholdPct: z.number().min(0),
  newTrailPct: z.number().min(0),
});

/**
 * Position management preferences schema (section 7.6).
 * Governs stop-loss methods, take-profit targets, scaling behavior,
 * holding period limits, and automatic position closure rules.
 *
 * The raw ZodObject variant (`PositionManagementPrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const PositionManagementPrefsObjectSchema = z.object({
  defaultStopLossMethod: z
    .enum(["fixed_percent", "atr_based", "structure_based", "trailing_stop"])
    .default("trailing_stop"),
  defaultStopLossPct: z.number().min(0).max(100).default(4),
  atrStopMultiplier: z.number().min(0).default(2),
  defaultTakeProfitMethod: z
    .enum(["fixed_percent", "atr_based", "risk_reward_ratio", "none"])
    .default("risk_reward_ratio"),
  defaultTakeProfitPct: z.number().min(0).max(100).default(3),
  defaultRiskRewardRatio: z.number().min(0).default(2),
  breakEvenStopEnabled: z.boolean().default(true),
  breakEvenTriggerPct: z.number().min(0).max(100).default(2),
  scaleInEnabled: z.boolean().default(false),
  scaleInMaxAdds: z.number().min(0).default(2),
  scaleOutEnabled: z.boolean().default(true),
  scaleOutTrimPct: z.number().min(0).max(100).default(50),
  scaleOutTriggerPct: z.number().min(0).max(100).default(5),
  maxHoldingPeriodMinutes: z.number().min(0).default(0),
  maxHoldingPeriodByAssetClass: z.record(z.string(), z.number()).default({}),
  dayTradeOnly: z.boolean().default(false),
  autoCloseBeforeEarnings: z.boolean().default(false),
  autoCloseBeforeClose: z.boolean().default(false),
  autoCloseBeforeCloseMinutes: z.number().min(0).default(5),
  autoCloseBeforeWeekend: z.boolean().default(false),
  addToWinnersAllowed: z.boolean().default(true),
  addToLosersAllowed: z.boolean().default(false),
  stopWideningAllowed: z.boolean().default(false),
  trailingStopTighteningEnabled: z.boolean().default(true),
  trailingStopTighteningRules: z
    .array(TrailingStopTighteningRuleSchema)
    .default([
      { profitThresholdPct: 3, newTrailPct: 2.0 },
      { profitThresholdPct: 6, newTrailPct: 1.5 },
      { profitThresholdPct: 10, newTrailPct: 1.0 },
    ]),
  portfolioStopOverridesPositionStops: z.boolean().default(false),
  doNotReenterAfterStopOutMinutes: z.number().min(0).default(30),
  doNotReenterAfterForcedCloseMinutes: z.number().min(0).default(60),
});

export const PositionManagementPrefsSchema =
  PositionManagementPrefsObjectSchema.default({});

/** Inferred TypeScript type for position management preferences. */
export type PositionManagementPrefs = z.infer<
  typeof PositionManagementPrefsSchema
>;
