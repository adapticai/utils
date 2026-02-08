/**
 * Zod schemas for Polygon.io API response validation.
 * Validates API responses against expected shapes to catch breaking API changes early.
 */
import { z } from 'zod';

// ===== Raw Price Data Schemas =====

/** Schema for raw Polygon price data (as returned from aggregates endpoint) */
export const RawPolygonPriceDataSchema = z.object({
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

/** Schema for Polygon ticker info response */
export const PolygonTickerInfoSchema = z.object({
  active: z.boolean(),
  currency_name: z.string(),
  delisted_utc: z.string().optional(),
  description: z.string().optional().default('No description available'),
  locale: z.string(),
  market: z.enum(['stocks', 'crypto', 'indices', 'fx', 'otc']),
  market_cap: z.number().optional().default(0),
  name: z.string(),
  primary_exchange: z.string(),
  share_class_shares_outstanding: z.number().nullable().optional(),
  ticker: z.string(),
  type: z.string(),
});

/** Schema for the wrapper around ticker details API response */
export const PolygonTickerDetailsResponseSchema = z.object({
  results: PolygonTickerInfoSchema,
  status: z.string(),
  request_id: z.string(),
});

// ===== Grouped Daily Schemas =====

/** Schema for Polygon grouped daily response */
export const PolygonGroupedDailyResponseSchema = z.object({
  adjusted: z.boolean(),
  queryCount: z.number(),
  request_id: z.string(),
  resultsCount: z.number(),
  status: z.string(),
  results: z.array(RawPolygonPriceDataSchema),
});

// ===== Daily Open Close Schemas =====

/** Schema for Polygon daily open close response */
export const PolygonDailyOpenCloseSchema = z.object({
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

/** Schema for a single Polygon trade */
export const PolygonTradeSchema = z.object({
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

/** Schema for Polygon trades response */
export const PolygonTradesResponseSchema = z.object({
  status: z.literal('OK'),
  request_id: z.string(),
  next_url: z.string().optional(),
  results: z.array(PolygonTradeSchema),
});

// ===== Last Trade Schemas =====

/** Schema for Polygon last trade response */
export const PolygonLastTradeResponseSchema = z.object({
  status: z.string(),
  request_id: z.string(),
  results: z.object({
    T: z.string(),
    p: z.number(),
    s: z.number(),
    t: z.number(),
    c: z.array(z.number()).optional(),
    e: z.number().optional(),
    i: z.string().optional(),
    q: z.number().optional(),
    x: z.number().optional(),
    z: z.number().optional(),
  }),
});

// ===== Aggregates (Bars) Schemas =====

/** Schema for Polygon aggregates (bars) response */
export const PolygonAggregatesResponseSchema = z.object({
  adjusted: z.boolean().optional(),
  next_url: z.string().optional(),
  queryCount: z.number().optional(),
  request_id: z.string(),
  results: z.array(RawPolygonPriceDataSchema).optional(),
  resultsCount: z.number().optional(),
  status: z.string(),
  ticker: z.string().optional(),
});

// ===== Error Response Schema =====

/** Schema for Polygon error response */
export const PolygonErrorResponseSchema = z.object({
  status: z.string(),
  request_id: z.string(),
  message: z.string(),
});
