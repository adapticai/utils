import { z } from "zod";

/**
 * Version of the `riskBudgetPrefs.laneSizing` sub-object this schema reads.
 * A later incompatible shape is a new exported schema, never an in-place edit.
 */
export const LANE_SIZING_PREFS_SCHEMA_VERSION = 1 as const;

/** Upper bound of the per-trade risk fraction of equity (2%). */
const MAX_RISK_PER_TRADE_FRACTION = 0.02;
/** Upper bound of the share of the time-of-day median minute volume one order may take. */
const MAX_MINUTE_VOLUME_PARTICIPATION = 0.25;
/** Upper bound of the share of average daily volume one position may take. */
const MAX_ADV_PARTICIPATION = 0.05;
/** Upper bound of the fractional-Kelly multiplier. */
const MAX_KELLY_FRACTION = 1;
/** Upper bound of the Kelly cap as a multiple of flat R. */
const MAX_KELLY_CAP_MULTIPLE_OF_FLAT = 1;

/**
 * Per-account lane sizing limits (`TradingPolicy.riskBudgetPrefs.laneSizing`).
 *
 * Every field is a FRACTION (never a percent), optional and default-free: an
 * absent field stays absent so it cannot pose as an operator setting. Each one
 * is the account's ceiling on the governed `lane.sizing.*` row of the same
 * meaning; the engine takes the smaller of the two, so this sub-object can only
 * tighten lane sizing, never loosen it.
 *
 * `.strict()`: an unknown key is a parse failure, so a misspelt limit cannot be
 * silently dropped while the operator believes it applies.
 */
export const LaneSizingPrefsV1Schema = z
  .object({
    /** Ceiling on `lane.sizing.riskPerTradeFraction.v1`: R as a fraction of equity. */
    maxRiskPerTradeFraction: z
      .number()
      .positive()
      .max(MAX_RISK_PER_TRADE_FRACTION)
      .optional(),
    /** Ceiling on `lane.sizing.minuteVolumeParticipationMax.v1`. */
    maxMinuteVolumeParticipation: z
      .number()
      .positive()
      .max(MAX_MINUTE_VOLUME_PARTICIPATION)
      .optional(),
    /** Ceiling on `lane.sizing.advParticipationMax.v1`. */
    maxAdvParticipation: z
      .number()
      .positive()
      .max(MAX_ADV_PARTICIPATION)
      .optional(),
    /** Ceiling on `lane.sizing.kelly.fraction.v1`. */
    maxKellyFraction: z.number().min(0).max(MAX_KELLY_FRACTION).optional(),
    /** Ceiling on `lane.sizing.kelly.capMultipleOfFlat.v1`; 1 keeps Kelly shrink-only. */
    maxKellyCapMultipleOfFlat: z
      .number()
      .min(0)
      .max(MAX_KELLY_CAP_MULTIPLE_OF_FLAT)
      .optional(),
  })
  .strict();

/** The current `riskBudgetPrefs.laneSizing` schema. */
export const LaneSizingPrefsSchema = LaneSizingPrefsV1Schema;

/** Parsed `riskBudgetPrefs.laneSizing` limits. */
export type LaneSizingPrefs = z.infer<typeof LaneSizingPrefsSchema>;
