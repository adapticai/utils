import { z } from "zod";

/** Schema for tactical allocation band constraints around a target weight. */
const TacticalBandSchema = z.object({
  target: z.number(),
  minPct: z.number(),
  maxPct: z.number(),
});

/** Schema for strategy sleeve budget allocation tracking. */
const StrategySleeveBudgetSchema = z.object({
  maxAllocationPct: z.number(),
  currentAllocationPct: z.number().default(0),
});

/** Schema for defensive cash escalation trigger conditions. */
const DefensiveCashRuleSchema = z.object({
  triggerCondition: z.string(),
  targetCashPct: z.number(),
});

/**
 * Portfolio construction preferences schema (section 7.7).
 * Governs asset allocation targets, rebalancing triggers, weighting methods,
 * cash management, portfolio-level stops, and forced deleveraging rules.
 *
 * The raw ZodObject variant (`PortfolioConstructionPrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const PortfolioConstructionPrefsObjectSchema = z.object({
  targetAllocationByAssetClass: z.record(z.string(), z.number()).default({}),
  tacticalAllocationBands: z.record(z.string(), TacticalBandSchema).default({}),
  driftThresholdPct: z.number().min(0).max(100).default(5),
  rebalanceTrigger: z
    .enum(["threshold", "calendar", "both"])
    .default("threshold"),
  rebalanceFrequencyDays: z.number().min(0).default(30),
  autonomousRebalancing: z.boolean().default(false),
  rebalanceDuringRiskOff: z.boolean().default(false),
  maxTurnoverPerRebalancePct: z.number().min(0).max(100).default(20),
  preferredWeighting: z
    .enum([
      "equal_weight",
      "risk_based",
      "conviction_weighted",
      "target_allocation",
    ])
    .default("equal_weight"),
  strategySleeveBudgets: z
    .record(z.string(), StrategySleeveBudgetSchema)
    .default({}),
  cashTargetPct: z.number().min(0).max(100).default(10),
  defensiveCashEscalationEnabled: z.boolean().default(false),
  defensiveCashEscalationRules: z.array(DefensiveCashRuleSchema).default([]),
  hedgeOverlayEnabled: z.boolean().default(false),
  autonomousPortfolioTrailingStop: z.boolean().default(false),
  portfolioTrailingStopPct: z.number().min(0).max(100).default(5),
  portfolioCircuitBreakerEnabled: z.boolean().default(true),
  portfolioCircuitBreakerDrawdownPct: z.number().min(0).max(100).default(10),
  equityCurveStopEnabled: z.boolean().default(false),
  equityCurveStopLookbackDays: z.number().min(0).default(20),
  forcedDeleveragingEnabled: z.boolean().default(true),
  forcedDeleveragingTriggerDrawdownPct: z.number().min(0).max(100).default(15),
  forcedDeleveragingTargetExposurePct: z.number().min(0).max(100).default(50),
});

export const PortfolioConstructionPrefsSchema =
  PortfolioConstructionPrefsObjectSchema.default({});

/** Inferred TypeScript type for portfolio construction preferences. */
export type PortfolioConstructionPrefs = z.infer<
  typeof PortfolioConstructionPrefsSchema
>;
