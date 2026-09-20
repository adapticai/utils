/**
 * Zod schemas for Massive.com API response validation.
 * Validates API responses against expected shapes to catch breaking API changes early.
 */
import { z } from "zod";

// ===== Raw Price Data Schemas =====

/**
 * Raw bar as the aggregates endpoints return it.
 *
 * Only OHLC, volume and timestamp are guaranteed. `T` names the ticker and is
 * carried by the grouped-daily endpoint, which returns many symbols in one
 * payload, but not by single-ticker aggregates, where the symbol is on the
 * envelope instead. `vw` and `n` are derived statistics the vendor omits for
 * bars with too little activity to compute them. Requiring any of the three
 * would reject payloads that are entirely valid.
 */
export const RawMassivePriceDataSchema = z.object({
  T: z.string().optional(),
  c: z.number(),
  h: z.number(),
  l: z.number(),
  n: z.number().optional(),
  o: z.number(),
  t: z.number(),
  v: z.number(),
  vw: z.number().optional(),
});

// ===== Ticker Info Schemas =====

/** Schema for Massive ticker info response */
export const MassiveTickerInfoSchema = z.object({
  active: z.boolean(),
  currency_name: z.string(),
  delisted_utc: z.string().optional(),
  description: z.string().optional().default("No description available"),
  locale: z.string(),
  market: z.enum(["stocks", "crypto", "indices", "fx", "otc"]),
  // Nullable rather than defaulted: a market cap is a measured quantity, and a
  // missing one coerced to 0 is indistinguishable from a genuine reading.
  market_cap: z.number().nullish(),
  name: z.string(),
  primary_exchange: z.string(),
  share_class_shares_outstanding: z.number().nullable().optional(),
  ticker: z.string(),
  type: z.string(),
});

/** Schema for the wrapper around ticker details API response */
export const MassiveTickerDetailsResponseSchema = z.object({
  results: MassiveTickerInfoSchema,
  status: z.string(),
  request_id: z.string(),
});

// ===== Grouped Daily Schemas =====

/** Schema for Massive grouped daily response */
export const MassiveGroupedDailyResponseSchema = z.object({
  adjusted: z.boolean(),
  queryCount: z.number(),
  request_id: z.string(),
  resultsCount: z.number(),
  status: z.string(),
  results: z.array(RawMassivePriceDataSchema),
});

// ===== Daily Open Close Schemas =====

/** Schema for Massive daily open close response */
export const MassiveDailyOpenCloseSchema = z.object({
  afterHours: z.number().optional(),
  close: z.number(),
  from: z.string(),
  high: z.number(),
  low: z.number(),
  open: z.number(),
  preMarket: z.number().optional(),
  status: z.string(),
  symbol: z.string(),
  volume: z.number(),
});

// ===== Trade Schemas =====

/** Schema for a single Massive trade */
export const MassiveTradeSchema = z.object({
  conditions: z.array(z.number()),
  correction: z.number().optional(),
  exchange: z.number(),
  id: z.string(),
  participant_timestamp: z.number(),
  price: z.number(),
  sequence_number: z.number(),
  sip_timestamp: z.number(),
  size: z.number(),
  tape: z.number().optional(),
  trf_id: z.number().optional(),
  trf_timestamp: z.number().optional(),
});

/** Schema for Massive trades response */
export const MassiveTradesResponseSchema = z.object({
  status: z.literal("OK"),
  request_id: z.string(),
  next_url: z.string().optional(),
  results: z.array(MassiveTradeSchema),
});

// ===== Last Trade Schemas =====

/** Schema for Massive last trade response (v3 format - returns array of trades) */
export const MassiveLastTradeResponseSchema = z.object({
  status: z.string(),
  request_id: z.string(),
  results: z
    .array(
      z.object({
        conditions: z.array(z.number()).optional(),
        correction: z.number().optional(),
        exchange: z.number(),
        id: z.string(),
        participant_timestamp: z.number(),
        price: z.number(),
        sequence_number: z.number(),
        sip_timestamp: z.number(),
        size: z.number(),
        tape: z.number().optional(),
        trf_id: z.number().optional(),
        trf_timestamp: z.number().optional(),
      }),
    )
    .min(1),
});

// ===== Aggregates (Bars) Schemas =====

/** Schema for Massive aggregates (bars) response */
/**
 * Single-ticker aggregates envelope.
 *
 * Only `status` and the bars are load-bearing: the aggregates path reads
 * neither `request_id` nor the counts, and requiring a field no consumer
 * depends on would report drift that cannot affect anything — noise that
 * teaches an operator to ignore the signal. The grouped-daily schema does
 * require `request_id`, because that path copies it into its own result.
 */
export const MassiveAggregatesResponseSchema = z.object({
  adjusted: z.boolean().optional(),
  next_url: z.string().optional(),
  queryCount: z.number().optional(),
  request_id: z.string().optional(),
  results: z.array(RawMassivePriceDataSchema).optional(),
  resultsCount: z.number().optional(),
  status: z.string(),
  ticker: z.string().optional(),
});

// ===== Error Response Schema =====

/** Schema for Massive error response */
export const MassiveErrorResponseSchema = z.object({
  status: z.string(),
  request_id: z.string(),
  message: z.string(),
});
