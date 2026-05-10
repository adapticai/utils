import { z } from "zod";

const OrderTypeEnum = z.enum([
  "market",
  "limit",
  "stop",
  "stop_limit",
  "trailing_stop",
]);

/**
 * Execution preferences schema (section 7.5).
 * Governs order routing behavior including order types, time-in-force,
 * slippage tolerance, price collars, partial fill handling, and failure modes.
 *
 * The raw ZodObject variant (`ExecutionPrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const ExecutionPrefsObjectSchema = z.object({
  allowedOrderTypes: z
    .array(OrderTypeEnum)
    .default(["market", "limit", "stop", "trailing_stop"]),
  preferredOrderType: OrderTypeEnum.default("limit"),
  preferredOrderTypeByAssetClass: z
    .record(z.string(), z.string())
    .default({ crypto: "market" }),
  // IOC default (immediate-or-cancel) for scalping — orders that don't
  // fill instantly should be killed, not parked on the book where they
  // accumulate stale-price risk.
  defaultTimeInForce: z.enum(["day", "gtc", "ioc", "fok"]).default("ioc"),
  // Passive bias — scalping captures spread by posting on the book rather
  // than paying it. Aggressive crossings are reserved for risk-off / unwind.
  executionBias: z
    .enum(["passive", "neutral", "aggressive"])
    .default("passive"),
  // 30bps slippage tolerance (vs 100bps) — must be tighter than scalping
  // edge magnitudes (typically ~50-100bps) to preserve PnL.
  maxSlippageTolerancePct: z.number().min(0).max(100).default(0.3),
  priceCollarEnabled: z.boolean().default(true),
  // 50bps price collar (vs 200bps) — same logic as slippage tolerance:
  // collar must sit inside the edge magnitude.
  priceCollarPct: z.number().min(0).default(0.5),
  repriceEnabled: z.boolean().default(false),
  repriceMaxAttempts: z.number().min(0).default(3),
  repriceIntervalSeconds: z.number().min(0).default(30),
  cancelReplaceTimeoutSeconds: z.number().min(0).default(60),
  partialFillPolicy: z
    .enum(["accept_partial", "cancel_remainder", "replace_to_fill"])
    .default("accept_partial"),
  sizingMethod: z.enum(["notional", "quantity"]).default("notional"),
  lotRoundingBehavior: z
    .enum(["round_down", "round_nearest", "round_up"])
    .default("round_down"),
  afterHoursExecutionBehavior: z
    .enum(["limit_only", "no_execution", "normal"])
    .default("limit_only"),
  failureBehavior: z.enum(["fail_safe", "fail_open"]).default("fail_safe"),
});

export const ExecutionPrefsSchema = ExecutionPrefsObjectSchema.default({});

/** Inferred TypeScript type for execution preferences. */
export type ExecutionPrefs = z.infer<typeof ExecutionPrefsSchema>;
