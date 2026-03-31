import { z } from 'zod';

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
  minConfidenceByDefault: z.number().min(0).max(100).default(60),
  minConfidenceByAssetClass: z.record(z.string(), z.number()).default({}),
  minConfidenceByStrategy: z.record(z.string(), z.number()).default({}),
  minExpectedRewardRiskRatio: z.number().min(0).default(1.5),
  minExpectedEdgePct: z.number().min(0).default(0),
  maxSignalAgeSeconds: z.number().min(0).default(300),
  cooldownAfterEntrySeconds: z.number().min(0).default(60),
  cooldownAfterExitSeconds: z.number().min(0).default(120),
  cooldownAfterStopOutSeconds: z.number().min(0).default(300),
  cooldownAfterFailedTradeSeconds: z.number().min(0).default(180),
  duplicateSignalSuppressionWindowSeconds: z.number().min(0).default(300),
  reversalHandlingPolicy: z.enum([
    'ignore_reversal', 'close_only', 'flatten_then_reverse', 'allow_full_reversal',
  ]).default('close_only'),
  conflictHandlingOpenOrders: z.enum([
    'cancel_conflicting', 'replace_existing', 'keep_existing_skip', 'escalate',
  ]).default('cancel_conflicting'),
  conflictHandlingOpposingPosition: z.enum([
    'reduce', 'close', 'flatten_then_reverse', 'hold',
  ]).default('close'),
  minConvictionDeltaToModify: z.number().min(0).max(100).default(10),
  strategyPriorityRules: z.array(StrategyPriorityRuleSchema).default([]),
  noTradeWindows: z.array(NoTradeWindowSchema).default([]),
  earningsBlackoutEnabled: z.boolean().default(false),
  earningsBlackoutHoursBefore: z.number().min(0).default(24),
  earningsBlackoutHoursAfter: z.number().min(0).default(2),

  /** Minimum price movement % to qualify as a tradeable signal. Replaces legacy AlpacaAccount.minPercentageChange. */
  minPercentageChange: z.number().min(0).default(0.5),
  /** Minimum average daily volume to qualify a symbol for trading. Replaces legacy AlpacaAccount.volumeThreshold. */
  volumeThreshold: z.number().min(0).default(50000),
});

export const SignalConsumptionPrefsSchema = SignalConsumptionPrefsObjectSchema.default({});

/** Inferred TypeScript type for signal consumption preferences. */
export type SignalConsumptionPrefs = z.infer<typeof SignalConsumptionPrefsSchema>;
