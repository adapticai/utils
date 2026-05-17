import { z } from "zod";

/**
 * Schema for conditions that require explicit human approval before execution.
 * Each flag controls whether a specific trade type needs manual sign-off.
 */
export const RequireHumanApprovalSchema = z
  .object({
    firstTradeInSymbol: z.boolean().default(false),
    reversals: z.boolean().default(false),
    shortSales: z.boolean().default(true),
    leverageIncreases: z.boolean().default(true),
    overnightHolds: z.boolean().default(false),
    afterHoursTrades: z.boolean().default(false),
    cryptoTrades: z.boolean().default(false),
    concentratedPositions: z.boolean().default(true),
    largeNotionalOrders: z.boolean().default(true),
    largeNotionalThreshold: z.number().min(0).default(50000),
    portfolioLiquidation: z.boolean().default(true),
    closeAllOrdersAndPositions: z.boolean().default(true),
    policyMutations: z.boolean().default(true),
    advancedModelEscalations: z.boolean().default(false),
  })
  .default({});

/**
 * Schema for allowed trading session windows.
 * Controls which market sessions the system may trade during.
 */
export const AllowedSessionsSchema = z
  .object({
    premarket: z.boolean().default(false),
    regular: z.boolean().default(true),
    afterHours: z.boolean().default(false),
    overnight: z.boolean().default(false),
    weekends: z.boolean().default(false),
  })
  .default({});

/**
 * Autonomy preferences schema (section 7.1).
 * Governs the level of automated decision-making, human approval gates,
 * auto-pause triggers, and allowed trading sessions.
 *
 * The raw ZodObject variant (`AutonomyPrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const AutonomyPrefsObjectSchema = z.object({
  requireHumanApprovalFor: RequireHumanApprovalSchema,
  autoPauseOnIncident: z.boolean().default(true),
  autoPauseOnBlackSwan: z.boolean().default(true),
  autoPauseOnBrokerDegradation: z.boolean().default(true),
  autoPauseOnDataQualityIssues: z.boolean().default(true),
  autoPauseOnExcessSlippage: z.boolean().default(false),
  excessSlippageThresholdPct: z.number().min(0).max(100).default(2),
  autoPauseOnDrawdownBreach: z.boolean().default(true),
  autoPauseOnModelConfidenceCollapse: z.boolean().default(false),
  modelConfidenceCollapseThreshold: z.number().min(0).max(100).default(30),
  allowedSessions: AllowedSessionsSchema,
});

export const AutonomyPrefsSchema = AutonomyPrefsObjectSchema.default({});

/** Inferred TypeScript type for autonomy preferences. */
export type AutonomyPrefs = z.infer<typeof AutonomyPrefsSchema>;
