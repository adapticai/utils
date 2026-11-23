import { z } from "zod";

/**
 * Version of the `TradingPolicy.intradayLanePrefs` document this schema reads.
 *
 * A stored document may carry it as `version: 1`, or omit it and still be read
 * as version 1. A future incompatible shape is a new exported schema that
 * REQUIRES its own version literal, so a version-1 document can never parse
 * as the later shape by accident.
 */
export const INTRADAY_LANE_PREFS_SCHEMA_VERSION = 1 as const;

/** Upper bound of the per-lane entry cap: well above any intraday lane's plausible trades in one session. */
const MAX_PER_LANE_TRADES_PER_DAY = 50;
/** Upper bound of concurrently armed lanes for one account. */
const MAX_CONCURRENT_LANES = 16;
/** Upper bound of the entry-cutoff margin: one full regular session (390 minutes). */
const MAX_ENTRY_CUTOFF_BEFORE_OVERNIGHT_SELECTION_MIN = 390;

/**
 * Per-lane entry cap: flat-to-position crossings per (account, symbol, session)
 * a lane may open. A positive integer; zero is not a cap, it is "not armed".
 */
const perLaneTradesPerDay = z
  .number()
  .int()
  .min(1)
  .max(MAX_PER_LANE_TRADES_PER_DAY);

/**
 * Fields both arms share. Every numeric field is bounded and optional with no
 * default, so an absent value stays absent and the engine applies its governed
 * row rather than a schema-invented number.
 */
const sharedFields = {
  version: z.literal(INTRADAY_LANE_PREFS_SCHEMA_VERSION).optional(),
  /** How many lanes may be live at once for this account. */
  maxConcurrentLanes: z.number().int().min(1).max(MAX_CONCURRENT_LANES).optional(),
  /**
   * Minutes before the overnight selection time at which lanes stop opening
   * new entries, so that cutoff <= selection < flatten < overnight entry.
   */
  entryCutoffBeforeOvernightSelectionMin: z
    .number()
    .int()
    .min(0)
    .max(MAX_ENTRY_CUTOFF_BEFORE_OVERNIGHT_SELECTION_MIN)
    .optional(),
} as const;

/** The account has not opted in. The cap may be recorded but arms nothing. */
export const IntradayLanePrefsDisarmedV1Schema = z
  .object({
    armed: z.literal(false),
    perLaneTradesPerDay: perLaneTradesPerDay.optional(),
    ...sharedFields,
  })
  .strict();

/**
 * The account has opted in. The per-lane entry cap is REQUIRED here: an armed
 * document without one fails to parse, and a document that fails to parse is
 * read by the engine as UNKNOWN, which disarms. So an absent cap refuses to arm.
 */
export const IntradayLanePrefsArmedV1Schema = z
  .object({
    armed: z.literal(true),
    perLaneTradesPerDay,
    ...sharedFields,
  })
  .strict();

/**
 * Strict schema for `TradingPolicy.intradayLanePrefs`, the single carrier of an
 * account's multi-lane intraday opt-in and its per-lane caps.
 *
 * - `armed` must be present: `{}` fails, `{ armed: false }` parses.
 * - Unknown keys are rejected on both arms (`.strict()`), so a misspelt cap is a
 *   parse failure rather than a silently ignored setting.
 * - Every numeric field is bounded; an out-of-band value is a parse failure.
 *
 * It is deliberately NOT part of `EffectiveTradingPolicySchema`: the column is
 * read by its own reader, and a malformed lane document must disarm the lanes,
 * never fail the whole account's policy.
 *
 * Re-entry cooldowns are not carried here; they reuse the existing
 * TradingPolicy cooldown columns. Lane risk limits are carried by
 * `riskBudgetPrefs.laneRisk`.
 */
export const IntradayLanePrefsV1Schema = z.discriminatedUnion("armed", [
  IntradayLanePrefsDisarmedV1Schema,
  IntradayLanePrefsArmedV1Schema,
]);

/** The current `intradayLanePrefs` schema (version {@link INTRADAY_LANE_PREFS_SCHEMA_VERSION}). */
export const IntradayLanePrefsSchema = IntradayLanePrefsV1Schema;

/** A parsed `TradingPolicy.intradayLanePrefs` document; `armed: true` implies a cap. */
export type IntradayLanePrefs = z.infer<typeof IntradayLanePrefsSchema>;
