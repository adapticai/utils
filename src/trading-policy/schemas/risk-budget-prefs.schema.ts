import { z } from "zod";

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
  // Tighter per-trade risk (1.5% vs 2%) for scalping — high turnover means
  // many small risks compound; per-trade ceiling must be lower than the
  // swing default to keep daily VAR bounded.
  maxRiskPerTradePct: z.number().min(0).max(100).default(1.5),
  // 2% daily loss circuit breaker (vs 5%) — tighter to fail fast when the
  // regime turns against the scalping strategy.
  maxLossPerDayPct: z.number().min(0).max(100).default(2.0),
  // 5% weekly loss cap (vs 10%) — proportional to the daily reduction.
  maxLossPerWeekPct: z.number().min(0).max(100).default(5.0),
  maxLossPerMonthPct: z.number().min(0).max(100).default(15),
  maxDrawdownFromPeakPct: z.number().min(0).max(100).default(20),
  maxSimultaneousSignalsPerStrategy: z.number().min(0).default(5),
  maxAggregateHeatPct: z.number().min(0).max(100).default(80),
  overnightExposureCapPct: z.number().min(0).max(100).default(50),
  weekendExposureCapPct: z.number().min(0).max(100).default(30),
  eventRiskExposureCapPct: z.number().min(0).max(100).default(40),
  gapRiskSensitivity: z.enum(["low", "medium", "high"]).default("medium"),

  /**
   * Per-trade equity allocation as % of account equity. Replaces legacy AlpacaAccount.tradeAllocationPct.
   * Smaller per-trade size (2% vs 5%) for scalping — shorter holds + higher
   * concurrency demand smaller per-position bets.
   */
  perTradeAllocationPct: z.number().min(0).max(100).default(2),
  /** Per-trade crypto allocation as % of account equity. Replaces legacy AlpacaAccount.cryptoTradeAllocationPct. */
  perTradeCryptoAllocationPct: z.number().min(0).max(100).default(5),

  /** Alpaca day-trading buying power check enforcement. Synced to Alpaca API. */
  dtbpCheck: z.enum(["both", "entry", "exit"]).default("both"),
  /** Alpaca pattern day trader rule enforcement. Synced to Alpaca API. */
  pdtCheck: z.enum(["both", "entry", "exit"]).default("both"),
  /** Strict PDT enforcement — block all violations without exception. Synced to Alpaca API. */
  ptpNoExceptionEntry: z.boolean().default(false),
});

export const RiskBudgetPrefsSchema = RiskBudgetPrefsObjectSchema.default({});

/** Inferred TypeScript type for risk budget preferences. */
export type RiskBudgetPrefs = z.infer<typeof RiskBudgetPrefsSchema>;
