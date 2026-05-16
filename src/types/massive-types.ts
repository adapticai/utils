/**
 * Freshness metadata attached to Massive responses so consumers can distinguish
 * real-time data ("OK") from delayed-feed data ("DELAYED", e.g. free-tier
 * plans). Producers should set this whenever they have observed the upstream
 * `status` field; consumers can branch on `status` to gate latency-sensitive
 * decisions (e.g. trade execution should refuse DELAYED quotes).
 *
 * DE-006: previously the DELAYED status was only emitted as a throttled INFO
 * log inside `fetchPrices`, which made it impossible for downstream callers to
 * tell whether a price was live or delayed. The flag is exposed on every
 * returned bar (and surfaced as the discriminator on {@link MassiveResult}).
 */
export interface MassiveFreshness {
  /** Upstream status as reported by the Massive API. */
  status: "OK" | "DELAYED";
  /** Wall-clock time the response was received by this process. */
  receivedAt: Date;
  /**
   * Best-effort time at which the upstream feed first started reporting
   * DELAYED. May be `null` when not known (the Massive HTTP API does not
   * currently return this; reserved for future enhancement).
   */
  delayedSince?: Date | null;
}

/**
 * Discriminated wrapper that lets new consumers branch on freshness without
 * inspecting the bar payload. Existing callers that consume
 * {@link MassivePriceData} arrays directly are unaffected — see
 * {@link MassivePriceData._freshness} for the non-breaking augmentation that
 * propagates the same information.
 */
export type MassiveResult<T> =
  | {
      status: "OK";
      data: T;
      receivedAt: Date;
    }
  | {
      status: "DELAYED";
      data: T;
      receivedAt: Date;
      delayedSince: Date | null;
    };

/**
 * Represents a unit of price data for a specific symbol on a given date.
 */
export type MassivePriceData = {
  /** The symbol of the asset. */
  symbol: string;
  /** The date of the price data. */
  date: string;
  /** The timestamp of the price data. */
  timeStamp: number;
  /** The opening price. */
  open: number;
  /** The highest price during the period. */
  high: number;
  /** The lowest price during the period. */
  low: number;
  /** The closing price. */
  close: number;
  /** The volume of trades. */
  vol: number;
  /** The volume-weighted average price. */
  vwap: number;
  /** The number of trades. */
  trades: number;
  /**
   * Optional freshness flag indicating whether the upstream feed reported the
   * data as live ("OK") or delayed ("DELAYED"). Present when the response
   * originated from an API endpoint that exposes a `status` field
   * (e.g. `fetchPrices`, `fetchGroupedDaily`). Absent for legacy/hand-built
   * fixtures and for endpoints that do not surface the status.
   *
   * @see MassiveFreshness
   */
  _freshness?: MassiveFreshness;
};

/**
 * Represents a quote for a specific asset.
 */
export type MassiveQuote = {
  /** The price of the asset. */
  price: number;
  /** The volume of the asset. */
  vol: number;
  /** The time of the quote. */
  time: Date;
};

/**
 * The Massive API response for grouped daily data.
 */
export type MassiveGroupedDailyResponse = {
  /** Indicates if the data is adjusted. */
  adjusted: boolean;
  /** The count of queries made. */
  queryCount: number;
  /** The request ID. */
  request_id: string;
  /** The count of results returned. */
  resultsCount: number;
  /** The status of the response. */
  status: string;
  /** The array of price data results. */
  results: MassivePriceData[];
};

/**
 * Represents raw price data from Massive.
 */
export interface RawMassivePriceData {
  /** The ticker symbol. */
  T: string;
  /** The closing price. */
  c: number;
  /** The highest price. */
  h: number;
  /** The lowest price. */
  l: number;
  /** The number of trades. */
  n: number;
  /** The opening price. */
  o: number;
  /** The timestamp. */
  t: number;
  /** The volume. */
  v: number;
  /** The volume-weighted average price. */
  vw: number;
}

/**
 * Represents information about a ticker including its name, market cap, and outstanding shares.
 */
export interface MassiveTickerInfo {
  /** Indicates if the ticker is active. */
  active: boolean;
  /** The name of the currency. */
  currency_name: string;
  /** The UTC time when the ticker was delisted, if applicable. */
  delisted_utc?: string;
  /** A description of the ticker. */
  description: string;
  /** The locale of the ticker. */
  locale: string;
  /** The market in which the ticker operates. */
  market: "stocks" | "crypto" | "indices" | "fx" | "otc";
  /** The market capitalization. */
  market_cap: number;
  /** The name of the ticker. */
  name: string;
  /** The primary exchange for the ticker. */
  primary_exchange: string;
  /** The number of shares outstanding. */
  share_class_shares_outstanding?: number | null;
  /** The ticker symbol. */
  ticker: string;
  /** The type of asset - CS, PFD, ETF, etc. */
  type: string;
}

/**
 * Represents the Massive API response for ticker information.
 */
export interface MassiveTickerResponse {
  /** The count of tickers returned. */
  count: number;
  /** The next URL for pagination, if applicable. */
  next_url: string | null;
  /** The request ID. */
  request_id: string;
  /** The array of ticker information results. */
  results: MassiveTickerInfo[];
  /** The status of the response. */
  status: string;
}

/**
 * Represents daily open and close data for a ticker for grouped daily data.
 */
export interface MassiveDailyOpenClose {
  /** The after-hours price, if applicable. */
  afterHours?: number;
  /** The closing price. */
  close: number;
  /** The date from which the data is taken. */
  from: string;
  /** The highest price during the day. */
  high: number;
  /** The lowest price during the day. */
  low: number;
  /** The opening price. */
  open: number;
  /** The pre-market price, if applicable. */
  preMarket?: number;
  /** The status of the market. */
  status: string;
  /** The symbol of the asset. */
  symbol: string;
  /** The volume of trades. */
  volume: number;
}

/**
 * Represents a trade in the Massive system.
 */
export interface MassiveTrade {
  /** The conditions of the trade. */
  conditions: number[];
  /** The correction status, if applicable. */
  correction?: number;
  /** The exchange where the trade occurred. */
  exchange: number;
  /** The unique identifier for the trade. */
  id: string;
  /** The timestamp of the participant. */
  participant_timestamp: number;
  /** The price of the trade. */
  price: number;
  /** The sequence number of the trade. */
  sequence_number: number;
  /** The timestamp from the SIP. */
  sip_timestamp: number;
  /** The size of the trade. */
  size: number;
  /** The tape number, if applicable. */
  tape?: number;
  /** The transfer ID, if applicable. */
  trf_id?: number;
  /** The timestamp of the transfer, if applicable. */
  trf_timestamp?: number;
}

/**
 * Represents an NBBO (National Best Bid and Offer) quote from Massive v3 API.
 */
export interface MassiveNBBOQuote {
  /** The ask price. */
  ask_price: number;
  /** The ask size (number of round lots). */
  ask_size: number;
  /** The ask exchange ID. */
  ask_exchange: number;
  /** The bid price. */
  bid_price: number;
  /** The bid size (number of round lots). */
  bid_size: number;
  /** The bid exchange ID. */
  bid_exchange: number;
  /** The conditions of the quote. */
  conditions?: number[];
  /** The timestamp from the SIP in nanoseconds. */
  sip_timestamp: number;
  /** The timestamp of the participant in nanoseconds. */
  participant_timestamp: number;
  /** The sequence number. */
  sequence_number: number;
  /** The tape number. */
  tape?: number;
}

/**
 * Processed quote data with computed spread metrics.
 */
export interface MassiveSpreadInfo {
  /** The bid price. */
  bid: number;
  /** The ask price. */
  ask: number;
  /** The spread in dollars (ask - bid). */
  spread: number;
  /** The spread as a percentage of the mid price. */
  spreadPercent: number;
  /** The mid price ((bid + ask) / 2). */
  midPrice: number;
  /** The bid size in round lots. */
  bidSize: number;
  /** The ask size in round lots. */
  askSize: number;
  /** The timestamp of the quote. */
  time: Date;
}

/**
 * Represents the base response structure from Massive.
 */
export interface MassiveBaseResponse {
  /** The status of the response. */
  status: string;
  /** The request ID. */
  request_id: string;
}

/**
 * Represents the response for trades from Massive.
 */
export interface MassiveTradesResponse extends MassiveBaseResponse {
  /** The status of the response, which should be 'OK'. */
  status: "OK";
  /** The next URL for pagination, if applicable. */
  next_url?: string;
  /** The array of trade results. */
  results: MassiveTrade[];
}

/**
 * Represents the response for quotes from Massive v3 API.
 */
export interface MassiveQuotesResponse extends MassiveBaseResponse {
  /** The status of the response, which should be 'OK'. */
  status: "OK";
  /** The next URL for pagination, if applicable. */
  next_url?: string;
  /** The array of NBBO quote results. */
  results: MassiveNBBOQuote[];
}

/**
 * Represents an error response from Massive.
 */
export interface MassiveErrorResponse extends MassiveBaseResponse {
  /** The status of the error response. */
  status: "ERROR" | "NOT_AUTHORIZED" | string;
  /** The error message. */
  message: string;
}
