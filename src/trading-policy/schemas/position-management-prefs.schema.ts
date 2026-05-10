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
  // 50bps stop sized for 5-min bar scalp profiles (audit 2026-05-10).
  defaultStopLossPct: z.number().min(0).max(100).default(0.5),
  // 0.75x ATR multiplier — tighter than the previous 2x to keep ATR-based
  // stops aligned with sub-percent intraday move ranges.
  atrStopMultiplier: z.number().min(0).default(0.75),
  defaultTakeProfitMethod: z
    .enum(["fixed_percent", "atr_based", "risk_reward_ratio", "none"])
    .default("risk_reward_ratio"),
  // 100bps take-profit pairs with the 50bps stop at a 2:1 R:R via the
  // explicit defaultRiskRewardRatio below; both serve different code paths
  // (fixed-percent vs ratio-derived TP).
  defaultTakeProfitPct: z.number().min(0).max(100).default(1.0),
  defaultRiskRewardRatio: z.number().min(0).default(1.5),
  breakEvenStopEnabled: z.boolean().default(true),
  // Move stop to break-even after 1% of profit (vs 2%) — tighter to match
  // scalping cadence.
  breakEvenTriggerPct: z.number().min(0).max(100).default(1),
  scaleInEnabled: z.boolean().default(false),
  scaleInMaxAdds: z.number().min(0).default(2),
  scaleOutEnabled: z.boolean().default(true),
  scaleOutTrimPct: z.number().min(0).max(100).default(50),
  // Trim 50% at +0.5% — much earlier than the previous 5% for scalping.
  scaleOutTriggerPct: z.number().min(0).max(100).default(0.5),
  // Hard 30-min intraday hold cap. Previous default of 0 (unlimited) is
  // wrong for scalping where stale positions accumulate undefined risk.
  maxHoldingPeriodMinutes: z.number().min(0).default(30),
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
  // 10-min stop-out cooldown (vs 30) — fast re-entry permitted once the
  // adverse regime resolves.
  doNotReenterAfterStopOutMinutes: z.number().min(0).default(10),
  doNotReenterAfterForcedCloseMinutes: z.number().min(0).default(60),
});

export const PositionManagementPrefsSchema =
  PositionManagementPrefsObjectSchema.default({});

/** Inferred TypeScript type for position management preferences. */
export type PositionManagementPrefs = z.infer<
  typeof PositionManagementPrefsSchema
>;
