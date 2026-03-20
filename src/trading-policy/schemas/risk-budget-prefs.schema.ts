import { z } from 'zod';

/**
 * Risk budget preferences schema (section 7.3).
 * Controls portfolio-level risk limits including concentration caps,
 * drawdown thresholds, loss limits, and exposure constraints.
 *
 * The raw ZodObject variant (`RiskBudgetPrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const RiskBudgetPrefsObjectSchema = z.object({
  maxMarginUtilPct: z.number().min(0).max(100).default(50),
  maxIssuerConcentrationPct: z.number().min(0).max(100).default(20),
  maxThemeConcentrationPct: z.number().min(0).max(100).default(25),
  maxAssetClassConcentrationPct: z.number().min(0).max(100).default(50),
  maxCountryConcentrationPct: z.number().min(0).max(100).default(40),
  maxCurrencyExposurePct: z.number().min(0).max(100).default(30),
  maxCorrelatedExposurePct: z.number().min(0).max(100).default(40),
  betaTarget: z.number().nullable().default(null),
  maxBeta: z.number().min(0).default(2),
  maxRiskPerTradePct: z.number().min(0).max(100).default(2),
  maxLossPerDayPct: z.number().min(0).max(100).default(5),
  maxLossPerWeekPct: z.number().min(0).max(100).default(10),
  maxLossPerMonthPct: z.number().min(0).max(100).default(15),
  maxDrawdownFromPeakPct: z.number().min(0).max(100).default(20),
  maxSimultaneousSignalsPerStrategy: z.number().min(0).default(5),
  maxAggregateHeatPct: z.number().min(0).max(100).default(80),
  overnightExposureCapPct: z.number().min(0).max(100).default(50),
  weekendExposureCapPct: z.number().min(0).max(100).default(30),
  eventRiskExposureCapPct: z.number().min(0).max(100).default(40),
  gapRiskSensitivity: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const RiskBudgetPrefsSchema = RiskBudgetPrefsObjectSchema.default({});

/** Inferred TypeScript type for risk budget preferences. */
export type RiskBudgetPrefs = z.infer<typeof RiskBudgetPrefsSchema>;
