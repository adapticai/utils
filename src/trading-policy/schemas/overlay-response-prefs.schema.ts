import { z } from "zod";
import { OverlayType } from "../enums";

/** Schema for the response configuration applied when a specific overlay type activates. */
const OverlayResponseConfigSchema = z.object({
  pauseRealtimeTrading: z.boolean().default(false),
  pauseNewEntriesOnly: z.boolean().default(false),
  cancelAllOpenOrders: z.boolean().default(false),
  tightenStops: z.boolean().default(false),
  tightenStopsByPct: z.number().min(0).max(100).default(50),
  reduceRiskBudgets: z.boolean().default(false),
  reduceRiskBudgetsByPct: z.number().min(0).max(100).default(50),
  rebalanceToTargetAllocation: z.boolean().default(false),
  raiseCash: z.boolean().default(false),
  raiseCashTargetPct: z.number().min(0).max(100).default(30),
  unwindSpecificSectors: z.array(z.string()).default([]),
  unwindSpecificAssetClasses: z.array(z.string()).default([]),
  closeAllPositions: z.boolean().default(false),
  switchToManualApproval: z.boolean().default(false),
  downgradeExecutionAggressiveness: z.boolean().default(false),
  switchModelTier: z.string().nullable().default(null),
  extendCooldowns: z.boolean().default(false),
  extendCooldownMultiplier: z.number().min(1).default(2),
});

/**
 * Overlay response preferences schema (section 7.8).
 * Maps overlay types to specific response configurations that modify
 * trading behavior when protective overlays are triggered.
 *
 * The raw ZodObject variant (`OverlayResponsePrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const OverlayResponsePrefsObjectSchema = z.object({
  overlayResponses: z
    .record(z.nativeEnum(OverlayType), OverlayResponseConfigSchema)
    .default({}),
});

export const OverlayResponsePrefsSchema =
  OverlayResponsePrefsObjectSchema.default({});

/** Inferred TypeScript type for overlay response preferences. */
export type OverlayResponsePrefs = z.infer<typeof OverlayResponsePrefsSchema>;
