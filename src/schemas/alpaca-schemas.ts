/**
 * Zod schemas for Alpaca API response validation.
 * Validates API responses against expected shapes to catch breaking API changes early.
 */
import { z } from 'zod';

// ===== Account Schemas =====

/** Schema for Alpaca account status values */
const AlpacaAccountStatusSchema = z.enum([
  'ONBOARDING',
  'SUBMISSION_FAILED',
  'SUBMITTED',
  'ACCOUNT_UPDATED',
  'APPROVAL_PENDING',
  'ACTIVE',
  'REJECTED',
]);

/** Schema for Alpaca account details response */
export const AlpacaAccountDetailsSchema = z.object({
  id: z.string(),
  account_number: z.string(),
  status: AlpacaAccountStatusSchema,
  currency: z.string(),
  cash: z.string(),
  portfolio_value: z.string(),
  non_marginable_buying_power: z.string(),
  accrued_fees: z.string(),
  pending_transfer_in: z.string(),
  pending_transfer_out: z.string(),
  pattern_day_trader: z.boolean(),
  trade_suspended_by_user: z.boolean(),
  trading_blocked: z.boolean(),
  transfers_blocked: z.boolean(),
  account_blocked: z.boolean(),
  created_at: z.string(),
  shorting_enabled: z.boolean(),
  long_market_value: z.string(),
  short_market_value: z.string(),
  equity: z.string(),
  last_equity: z.string(),
  multiplier: z.enum(['1', '2', '4']),
  buying_power: z.string(),
  initial_margin: z.string(),
  maintenance_margin: z.string(),
  sma: z.string(),
  daytrade_count: z.number().int(),
  balance_asof: z.string(),
  last_maintenance_margin: z.string(),
  daytrading_buying_power: z.string(),
  regt_buying_power: z.string(),
  options_buying_power: z.string(),
  options_approved_level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  options_trading_level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  intraday_adjustments: z.string(),
  pending_reg_taf_fees: z.string(),
});

// ===== Position Schemas =====

/** Schema for Alpaca position response */
export const AlpacaPositionSchema = z.object({
  asset_id: z.string(),
  symbol: z.string(),
  exchange: z.string(),
  asset_class: z.string(),
  asset_marginable: z.boolean(),
  qty: z.string(),
  qty_available: z.string(),
  avg_entry_price: z.string(),
  side: z.enum(['long', 'short']),
  market_value: z.string(),
  cost_basis: z.string(),
  unrealized_pl: z.string(),
  unrealized_plpc: z.string(),
  unrealized_intraday_pl: z.string(),
  unrealized_intraday_plpc: z.string(),
  current_price: z.string(),
  lastday_price: z.string(),
  change_today: z.string(),
});

/** Schema for an array of Alpaca positions */
export const AlpacaPositionsArraySchema = z.array(AlpacaPositionSchema);

// ===== Order Schemas =====

/** Schema for order side */
const OrderSideSchema = z.enum(['buy', 'sell']);

/** Schema for order type */
const OrderTypeSchema = z.enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop']);

/** Schema for time in force */
const TimeInForceSchema = z.enum(['day', 'gtc', 'opg', 'cls', 'ioc', 'fok']);

/** Schema for order class */
const OrderClassSchema = z.enum(['simple', 'oco', 'oto', 'bracket', 'mleg']);

/** Schema for order status */
const OrderStatusSchema = z.enum([
  'new',
  'partially_filled',
  'filled',
  'done_for_day',
  'canceled',
  'expired',
  'replaced',
  'pending_cancel',
  'pending_replace',
  'accepted',
  'pending_new',
  'accepted_for_bidding',
  'stopped',
  'rejected',
  'suspended',
  'calculated',
]);

/** Schema for asset class */
const AssetClassSchema = z.enum(['us_equity', 'us_option', 'crypto']);

/** Schema for position intent */
const PositionIntentSchema = z.enum([
  'buy_to_open',
  'buy_to_close',
  'sell_to_open',
  'sell_to_close',
]);

/** Schema for Alpaca order response */
export const AlpacaOrderSchema: z.ZodType = z.object({
  id: z.string(),
  client_order_id: z.string(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  submitted_at: z.string().nullable(),
  filled_at: z.string().nullable(),
  expired_at: z.string().nullable(),
  canceled_at: z.string().nullable(),
  failed_at: z.string().nullable(),
  replaced_at: z.string().nullable(),
  replaced_by: z.string().nullable(),
  replaces: z.string().nullable(),
  asset_id: z.string(),
  symbol: z.string(),
  asset_class: AssetClassSchema,
  notional: z.string().nullable(),
  qty: z.string().nullable(),
  filled_qty: z.string(),
  filled_avg_price: z.string().nullable(),
  order_class: OrderClassSchema,
  type: OrderTypeSchema,
  side: OrderSideSchema,
  time_in_force: TimeInForceSchema,
  limit_price: z.string().nullable(),
  stop_price: z.string().nullable(),
  trail_price: z.string().nullable(),
  trail_percent: z.string().nullable(),
  hwm: z.string().nullable(),
  position_intent: PositionIntentSchema.nullable(),
  status: OrderStatusSchema,
  extended_hours: z.boolean(),
  legs: z.lazy(() => z.array(AlpacaOrderSchema)).nullable(),
});

/** Schema for an array of Alpaca orders */
export const AlpacaOrdersArraySchema = z.array(AlpacaOrderSchema);

// ===== Bar (OHLCV) Schemas =====

/** Schema for a single price bar (OHLCV) */
export const AlpacaBarSchema = z.object({
  t: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
  n: z.number(),
  vw: z.number(),
});

/** Schema for historical bars response */
export const AlpacaHistoricalBarsResponseSchema = z.object({
  bars: z.record(z.string(), z.array(AlpacaBarSchema)),
  next_page_token: z.string().nullable(),
  currency: z.string().optional(),
});

/** Schema for latest bars response */
export const AlpacaLatestBarsResponseSchema = z.object({
  bars: z.record(z.string(), AlpacaBarSchema),
  currency: z.string().optional(),
});

// ===== Quote Schemas =====

/** Schema for a single quote */
export const AlpacaQuoteSchema = z.object({
  t: z.string(),
  ap: z.number(),
  as: z.number(),
  ax: z.string(),
  bp: z.number(),
  bs: z.number(),
  bx: z.string(),
  c: z.array(z.string()),
  z: z.string(),
});

/** Schema for latest quotes response */
export const AlpacaLatestQuotesResponseSchema = z.object({
  quotes: z.record(z.string(), AlpacaQuoteSchema),
  currency: z.string(),
});

// ===== Trade Schemas =====

/** Schema for a single trade */
export const AlpacaTradeSchema = z.object({
  t: z.string(),
  p: z.number(),
  s: z.number(),
  x: z.string(),
  i: z.number(),
  z: z.string(),
  c: z.array(z.string()),
});

/** Schema for latest trades response */
export const AlpacaLatestTradesResponseSchema = z.object({
  trades: z.record(z.string(), AlpacaTradeSchema),
  currency: z.string(),
});

// ===== News Schemas =====

/** Schema for a news image */
const NewsImageSchema = z.object({
  size: z.enum(['large', 'small', 'thumb']),
  url: z.string(),
});

/** Schema for a news article */
export const AlpacaNewsArticleSchema = z.object({
  id: z.number(),
  author: z.string(),
  content: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  headline: z.string(),
  source: z.string(),
  summary: z.string(),
  url: z.string(),
  symbols: z.array(z.string()),
  images: z.array(NewsImageSchema),
});

/** Schema for news response */
export const AlpacaNewsResponseSchema = z.object({
  news: z.array(AlpacaNewsArticleSchema),
  next_page_token: z.string().optional().nullable(),
});

// ===== Portfolio History Schemas =====

/** Schema for portfolio history response */
export const AlpacaPortfolioHistoryResponseSchema = z.object({
  timestamp: z.array(z.number()),
  equity: z.array(z.number()),
  profit_loss: z.array(z.number()),
  profit_loss_pct: z.array(z.number()),
  base_value: z.number(),
  base_value_asof: z.string().optional(),
});

// ===== Crypto Schemas =====

/** Schema for crypto bars response */
export const AlpacaCryptoBarsResponseSchema = z.object({
  bars: z.record(z.string(), z.array(z.object({
    t: z.union([z.string(), z.date()]),
    o: z.number(),
    h: z.number(),
    l: z.number(),
    c: z.number(),
    v: z.number(),
    n: z.number(),
    vw: z.number(),
  }))),
  next_page_token: z.string().optional().nullable(),
});
