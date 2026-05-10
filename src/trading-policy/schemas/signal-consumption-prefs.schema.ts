import { z } from "zod";

/** Schema for a named no-trade window (e.g., lunch hour, FOMC). */
const NoTradeWindowSchema = z.object({
  name: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  daysOfWeek: z.array(z.number().min(0).max(6)).default([]),
  enabled: z.boolean().default(true),
});

/** Schema for per-strategy priority assignment. */
const StrategyPriorityRuleSchema = z.object({
  strategy: z.string(),
  priority: z.number(),
});

/**
 * Signal consumption preferences schema (section 7.4).
 * Controls how incoming trade signals are filtered, throttled,
 * prioritized, and handled when conflicts arise.
 *
 * The raw ZodObject variant (`SignalConsumptionPrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const SignalConsumptionPrefsObjectSchema = z.object({
  enabledStrategies: z.array(z.string()).default([]),
  disabledStrategies: z.array(z.string()).default([]),
  // Slightly higher confidence floor (65 vs 60) reflecting the precision
  // demands of scalping — false positives compound rapidly at this cadence.
  minConfidenceByDefault: z.number().min(0).max(100).default(65),
  minConfidenceByAssetClass: z.record(z.string(), z.number()).default({}),
  minConfidenceByStrategy: z.record(z.string(), z.number()).default({}),
  // 1.3 R:R minimum — slightly tighter than the swing default (1.5) since
  // scalp trades have quicker resolution and tolerate marginally lower
  // expected R:R when win-rate is high.
  minExpectedRewardRiskRatio: z.number().min(0).default(1.3),
  minExpectedEdgePct: z.number().min(0).default(0),
  // 30s max signal age for scalping — anything older than that has likely
  // been re-priced out of edge. Previous default (300s) was swing-suitable.
  maxSignalAgeSeconds: z.number().min(0).default(30),
  // 5s post-entry cooldown — minimum churn protection while still allowing
  // rapid re-engagement if the setup persists.
  cooldownAfterEntrySeconds: z.number().min(0).default(5),
  cooldownAfterExitSeconds: z.number().min(0).default(120),
  // 30s post-stop-out cooldown (vs 300s) — fast re-entry allowed once the
  // setup re-presents.
  cooldownAfterStopOutSeconds: z.number().min(0).default(30),
  cooldownAfterFailedTradeSeconds: z.number().min(0).default(180),
  // 10s duplicate-signal window — prevents same-second signal dedup but
  // allows the same setup to trigger again within a minute.
  duplicateSignalSuppressionWindowSeconds: z.number().min(0).default(10),
  reversalHandlingPolicy: z
    .enum([
      "ignore_reversal",
      "close_only",
      "flatten_then_reverse",
      "allow_full_reversal",
    ])
    .default("close_only"),
  conflictHandlingOpenOrders: z
    .enum([
      "cancel_conflicting",
      "replace_existing",
      "keep_existing_skip",
      "escalate",
    ])
    .default("cancel_conflicting"),
  conflictHandlingOpposingPosition: z
    .enum(["reduce", "close", "flatten_then_reverse", "hold"])
    .default("close"),
  minConvictionDeltaToModify: z.number().min(0).max(100).default(10),
  strategyPriorityRules: z.array(StrategyPriorityRuleSchema).default([]),
  noTradeWindows: z.array(NoTradeWindowSchema).default([]),
  earningsBlackoutEnabled: z.boolean().default(false),
  earningsBlackoutHoursBefore: z.number().min(0).default(24),
  earningsBlackoutHoursAfter: z.number().min(0).default(2),

  /**
   * Minimum price movement % to qualify as a tradeable signal. Replaces legacy AlpacaAccount.minPercentageChange.
   * Tighter intraday move filter (15bps vs 50bps) — scalping captures
   * sub-percent moves that the swing-trading default would have ignored.
   */
  minPercentageChange: z.number().min(0).default(0.15),
  /**
   * Minimum average daily volume to qualify a symbol for trading. Replaces legacy AlpacaAccount.volumeThreshold.
   * Higher floor (100k vs 50k) — scalping requires consistent liquidity to
   * keep slippage within the tightened maxSlippageTolerancePct (0.3%).
   */
  volumeThreshold: z.number().min(0).default(100000),
});

export const SignalConsumptionPrefsSchema =
  SignalConsumptionPrefsObjectSchema.default({});

/** Inferred TypeScript type for signal consumption preferences. */
export type SignalConsumptionPrefs = z.infer<
  typeof SignalConsumptionPrefsSchema
>;
