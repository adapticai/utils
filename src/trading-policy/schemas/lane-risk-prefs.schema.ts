import { z } from "zod";

/**
 * Version of the `riskBudgetPrefs.laneRisk` sub-object this schema reads.
 * A later incompatible shape is a new exported schema, never an in-place edit.
 */
export const LANE_RISK_PREFS_SCHEMA_VERSION = 1 as const;

/**
 * A positive number no larger than `ceiling`.
 *
 * @param ceiling - The loosest value the engine's governed band admits.
 * @returns The bounded optional schema.
 */
function boundedPositive(ceiling: number): z.ZodOptional<z.ZodNumber> {
  return z.number().positive().max(ceiling).optional();
}

/**
 * A positive whole number no larger than `ceiling`.
 *
 * @param ceiling - The loosest value the engine's governed band admits.
 * @returns The bounded optional schema.
 */
function boundedCount(ceiling: number): z.ZodOptional<z.ZodNumber> {
  return z.number().int().positive().max(ceiling).optional();
}

/**
 * A drawdown response ladder: four fractions of the period's baseline equity at
 * which the lane risk authority moves to REDUCE, NO_NEW_ENTRIES, FLATTEN and
 * HALT. All four rungs are required together and must not descend, because a
 * ladder is one ordered object: a single rung on its own has no meaning, and a
 * descending ladder would skip a response the operator expects to see first.
 *
 * @param ceiling - The loosest rung value the engine's governed band admits.
 * @returns The ladder schema.
 */
function ladder(ceiling: number) {
  return z
    .object({
      reduceAt: z.number().positive().max(ceiling),
      noNewEntriesAt: z.number().positive().max(ceiling),
      flattenAt: z.number().positive().max(ceiling),
      haltAt: z.number().positive().max(ceiling),
    })
    .strict()
    .refine(
      (l) => l.reduceAt <= l.noNewEntriesAt && l.noNewEntriesAt <= l.flattenAt && l.flattenAt <= l.haltAt,
      { message: "ladder rungs must not descend: reduceAt <= noNewEntriesAt <= flattenAt <= haltAt" },
    );
}

/**
 * Per-account lane risk limits (`TradingPolicy.riskBudgetPrefs.laneRisk`).
 *
 * Each field is the account's ceiling on the governed `lanes.risk.*` row of the
 * same name. The engine takes the smaller of the two, so this sub-object can
 * only TIGHTEN a lane risk limit, never loosen it. Every field is optional and
 * default-free: an absent field stays absent, so it cannot pose as an operator
 * setting. Units: `*PctEquity` and ladder rungs are FRACTIONS of equity (0.01
 * is 1%), never percents; `*R` fields are multiples of the position's frozen
 * risk unit; the `ordersPer*` fields are orders per minute; the ratio is a
 * plain ratio. The ceilings are the loosest values of the engine's governed
 * bands. The engine computes the limits' version fingerprint itself, so this
 * sub-object carries no `version` field.
 *
 * `.strict()`: an unknown key is a parse failure, so a misspelt limit cannot be
 * silently dropped while the operator believes it applies.
 */
export const LaneRiskPrefsV1Schema = z
  .object({
    perTradeMaxLossR: boundedPositive(3),
    perTradeMaxLossPctEquity: boundedPositive(0.02),
    laneDailyMaxLossR: boundedPositive(10),
    laneDailyMaxLossPctEquity: boundedPositive(0.05),
    setupDailyMaxLossR: boundedPositive(20),
    clusterMaxOpenRiskPctEquity: boundedPositive(0.05),
    clusterMaxLanes: boundedCount(20),
    portfolioMaxOpenRiskPctEquity: boundedPositive(0.1),
    accountDailyDrawdown: ladder(0.15).optional(),
    accountWeeklyDrawdown: ladder(0.3).optional(),
    grossExposureMaxPctEquity: boundedPositive(4),
    netBetaRiskMaxPctEquity: boundedPositive(0.05),
    nameConcentrationMaxPctEquity: boundedPositive(0.5),
    ordersPerLanePerMin: boundedCount(30),
    ordersPerAccountPerMin: boundedCount(180),
    cancelToFillRatioMax: boundedPositive(20),
  })
  .strict();

/** The current `riskBudgetPrefs.laneRisk` schema. */
export const LaneRiskPrefsSchema = LaneRiskPrefsV1Schema;

/** Parsed `riskBudgetPrefs.laneRisk` limits. */
export type LaneRiskPrefs = z.infer<typeof LaneRiskPrefsSchema>;
