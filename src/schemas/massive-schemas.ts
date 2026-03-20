/**
 * Zod schemas for Massive.com API response validation.
 * Validates API responses against expected shapes to catch breaking API changes early.
 */
import { z } from "zod";

// ===== Raw Price Data Schemas =====

/** Schema for raw Massive price data (as returned from aggregates endpoint) */
export const RawMassivePriceDataSchema = z.object({
  T: z.string(),
  c: z.number(),
  h: z.number(),
  l: z.number(),
  n: z.number(),
  o: z.number(),
  t: z.number(),
  v: z.number(),
  vw: z.number(),
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
  market_cap: z.number().optional().default(0),
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
export const MassiveAggregatesResponseSchema = z.object({
  adjusted: z.boolean().optional(),
  next_url: z.string().optional(),
  queryCount: z.number().optional(),
  request_id: z.string(),
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
