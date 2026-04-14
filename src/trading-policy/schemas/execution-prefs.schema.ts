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
  defaultTimeInForce: z.enum(["day", "gtc", "ioc", "fok"]).default("day"),
  executionBias: z
    .enum(["passive", "neutral", "aggressive"])
    .default("neutral"),
  maxSlippageTolerancePct: z.number().min(0).max(100).default(1.0),
  priceCollarEnabled: z.boolean().default(true),
  priceCollarPct: z.number().min(0).default(2),
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
