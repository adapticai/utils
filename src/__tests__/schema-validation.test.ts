import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger before imports
vi.mock('../logger', () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  AlpacaAccountDetailsSchema,
  AlpacaPositionSchema,
  AlpacaPositionsArraySchema,
  AlpacaOrderSchema,
  AlpacaOrdersArraySchema,
  AlpacaBarSchema,
  AlpacaHistoricalBarsResponseSchema,
  AlpacaLatestBarsResponseSchema,
  AlpacaQuoteSchema,
  AlpacaLatestQuotesResponseSchema,
  AlpacaTradeSchema,
  AlpacaLatestTradesResponseSchema,
  AlpacaNewsArticleSchema,
  AlpacaNewsResponseSchema,
  AlpacaPortfolioHistoryResponseSchema,
  AlpacaCryptoBarsResponseSchema,
} from '../schemas/alpaca-schemas';

import {
  RawPolygonPriceDataSchema,
  PolygonTickerInfoSchema,
  PolygonGroupedDailyResponseSchema,
  PolygonDailyOpenCloseSchema,
  PolygonTradeSchema,
  PolygonTradesResponseSchema,
  PolygonLastTradeResponseSchema,
  PolygonAggregatesResponseSchema,
  PolygonErrorResponseSchema,
} from '../schemas/polygon-schemas';

import {
  AlphaVantageQuoteResponseSchema,
  AVNewsArticleSchema,
  AVNewsResponseSchema,
} from '../schemas/alphavantage-schemas';

import {
  validateResponse,
  safeValidateResponse,
  ValidationResponseError,
} from '../schemas/validate-response';

// ===== Test Data Fixtures =====

const validAlpacaAccount = {
  id: 'acc-123',
  account_number: '12345678',
  status: 'ACTIVE',
  currency: 'USD',
  cash: '10000.00',
  portfolio_value: '50000.00',
  non_marginable_buying_power: '10000.00',
  accrued_fees: '0.00',
  pending_transfer_in: '0.00',
  pending_transfer_out: '0.00',
  pattern_day_trader: false,
  trade_suspended_by_user: false,
  trading_blocked: false,
  transfers_blocked: false,
  account_blocked: false,
  created_at: '2024-01-01T00:00:00Z',
  shorting_enabled: true,
  long_market_value: '40000.00',
  short_market_value: '0.00',
  equity: '50000.00',
  last_equity: '49500.00',
  multiplier: '4',
  buying_power: '200000.00',
  initial_margin: '20000.00',
  maintenance_margin: '15000.00',
  sma: '50000.00',
  daytrade_count: 2,
  balance_asof: '2024-01-15',
  last_maintenance_margin: '15000.00',
  daytrading_buying_power: '200000.00',
  regt_buying_power: '80000.00',
  options_buying_power: '10000.00',
  options_approved_level: 2,
  options_trading_level: 2,
  intraday_adjustments: '0.00',
  pending_reg_taf_fees: '0.00',
};

const validAlpacaPosition = {
  asset_id: 'asset-123',
  symbol: 'AAPL',
  exchange: 'NASDAQ',
  asset_class: 'us_equity',
  asset_marginable: true,
  qty: '10',
  qty_available: '10',
  avg_entry_price: '150.00',
  side: 'long',
  market_value: '1550.00',
  cost_basis: '1500.00',
  unrealized_pl: '50.00',
  unrealized_plpc: '0.0333',
  unrealized_intraday_pl: '10.00',
  unrealized_intraday_plpc: '0.0065',
  current_price: '155.00',
  lastday_price: '154.50',
  change_today: '0.003236',
};

const validAlpacaOrder = {
  id: 'order-123',
  client_order_id: 'client-123',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:01Z',
  submitted_at: '2024-01-15T10:00:00Z',
  filled_at: null,
  expired_at: null,
  canceled_at: null,
  failed_at: null,
  replaced_at: null,
  replaced_by: null,
  replaces: null,
  asset_id: 'asset-123',
  symbol: 'AAPL',
  asset_class: 'us_equity',
  notional: null,
  qty: '10',
  filled_qty: '0',
  filled_avg_price: null,
  order_class: 'simple',
  type: 'limit',
  side: 'buy',
  time_in_force: 'day',
  limit_price: '150.00',
  stop_price: null,
  trail_price: null,
  trail_percent: null,
  hwm: null,
  position_intent: 'buy_to_open',
  status: 'new',
  extended_hours: false,
  legs: null,
};

const validAlpacaBar = {
  t: '2024-01-15T14:30:00Z',
  o: 150.0,
  h: 155.0,
  l: 149.5,
  c: 154.0,
  v: 1000000,
  n: 5000,
  vw: 152.5,
};

const validAlpacaQuote = {
  t: '2024-01-15T14:30:00.123456Z',
  ap: 155.01,
  as: 100,
  ax: 'Q',
  bp: 155.0,
  bs: 200,
  bx: 'P',
  c: ['R'],
  z: 'C',
};

const validAlpacaTrade = {
  t: '2024-01-15T14:30:00.123456Z',
  p: 155.0,
  s: 100,
  x: 'Q',
  i: 12345,
  z: 'C',
  c: ['@'],
};

const validAlpacaNewsArticle = {
  id: 1,
  author: 'John Doe',
  content: 'Full article content here.',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  headline: 'AAPL Hits New High',
  source: 'Reuters',
  summary: 'Apple stock reached a new all-time high.',
  url: 'https://example.com/news/1',
  symbols: ['AAPL'],
  images: [{ size: 'large', url: 'https://example.com/image.jpg' }],
};

// ===== Alpaca Schema Tests =====

describe('Alpaca Schemas', () => {
  describe('AlpacaAccountDetailsSchema', () => {
    it('should validate a correct account response', () => {
      const result = AlpacaAccountDetailsSchema.safeParse(validAlpacaAccount);
      expect(result.success).toBe(true);
    });

    it('should reject account with missing required fields', () => {
      const { id, ...incomplete } = validAlpacaAccount;
      const result = AlpacaAccountDetailsSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
    });

    it('should reject account with invalid status', () => {
      const result = AlpacaAccountDetailsSchema.safeParse({
        ...validAlpacaAccount,
        status: 'INVALID_STATUS',
      });
      expect(result.success).toBe(false);
    });

    it('should reject account with wrong multiplier', () => {
      const result = AlpacaAccountDetailsSchema.safeParse({
        ...validAlpacaAccount,
        multiplier: '3',
      });
      expect(result.success).toBe(false);
    });

    it('should reject account with non-integer daytrade count', () => {
      const result = AlpacaAccountDetailsSchema.safeParse({
        ...validAlpacaAccount,
        daytrade_count: 2.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AlpacaPositionSchema', () => {
    it('should validate a correct position response', () => {
      const result = AlpacaPositionSchema.safeParse(validAlpacaPosition);
      expect(result.success).toBe(true);
    });

    it('should reject position with invalid side', () => {
      const result = AlpacaPositionSchema.safeParse({
        ...validAlpacaPosition,
        side: 'neutral',
      });
      expect(result.success).toBe(false);
    });

    it('should validate an array of positions', () => {
      const result = AlpacaPositionsArraySchema.safeParse([
        validAlpacaPosition,
        { ...validAlpacaPosition, symbol: 'MSFT' },
      ]);
      expect(result.success).toBe(true);
    });

    it('should validate empty positions array', () => {
      const result = AlpacaPositionsArraySchema.safeParse([]);
      expect(result.success).toBe(true);
    });
  });

  describe('AlpacaOrderSchema', () => {
    it('should validate a correct order response', () => {
      const result = AlpacaOrderSchema.safeParse(validAlpacaOrder);
      expect(result.success).toBe(true);
    });

    it('should validate an order with nested legs', () => {
      const bracketOrder = {
        ...validAlpacaOrder,
        order_class: 'bracket',
        legs: [
          { ...validAlpacaOrder, id: 'leg-1', type: 'stop', side: 'sell' },
          { ...validAlpacaOrder, id: 'leg-2', type: 'limit', side: 'sell' },
        ],
      };
      const result = AlpacaOrderSchema.safeParse(bracketOrder);
      expect(result.success).toBe(true);
    });

    it('should validate all order statuses', () => {
      const statuses = [
        'new', 'partially_filled', 'filled', 'done_for_day',
        'canceled', 'expired', 'replaced', 'pending_cancel',
        'pending_replace', 'accepted', 'pending_new',
      ];
      for (const status of statuses) {
        const result = AlpacaOrderSchema.safeParse({
          ...validAlpacaOrder,
          status,
        });
        expect(result.success).toBe(true);
      }
    });

    it('should reject order with invalid status', () => {
      const result = AlpacaOrderSchema.safeParse({
        ...validAlpacaOrder,
        status: 'unknown_status',
      });
      expect(result.success).toBe(false);
    });

    it('should validate an orders array', () => {
      const result = AlpacaOrdersArraySchema.safeParse([
        validAlpacaOrder,
        { ...validAlpacaOrder, id: 'order-456' },
      ]);
      expect(result.success).toBe(true);
    });
  });

  describe('AlpacaBarSchema', () => {
    it('should validate a correct bar', () => {
      const result = AlpacaBarSchema.safeParse(validAlpacaBar);
      expect(result.success).toBe(true);
    });

    it('should reject bar with missing volume', () => {
      const { v, ...incomplete } = validAlpacaBar;
      const result = AlpacaBarSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
    });

    it('should reject bar with string prices', () => {
      const result = AlpacaBarSchema.safeParse({
        ...validAlpacaBar,
        o: '150.00',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AlpacaHistoricalBarsResponseSchema', () => {
    it('should validate a complete historical bars response', () => {
      const response = {
        bars: { AAPL: [validAlpacaBar], MSFT: [validAlpacaBar] },
        next_page_token: 'abc123',
        currency: 'USD',
      };
      const result = AlpacaHistoricalBarsResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should validate response with null next_page_token', () => {
      const response = {
        bars: { AAPL: [validAlpacaBar] },
        next_page_token: null,
      };
      const result = AlpacaHistoricalBarsResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe('AlpacaQuoteSchema', () => {
    it('should validate a correct quote', () => {
      const result = AlpacaQuoteSchema.safeParse(validAlpacaQuote);
      expect(result.success).toBe(true);
    });

    it('should reject quote with missing conditions', () => {
      const { c, ...incomplete } = validAlpacaQuote;
      const result = AlpacaQuoteSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
    });
  });

  describe('AlpacaLatestQuotesResponseSchema', () => {
    it('should validate a complete latest quotes response', () => {
      const response = {
        quotes: { AAPL: validAlpacaQuote },
        currency: 'USD',
      };
      const result = AlpacaLatestQuotesResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe('AlpacaTradeSchema', () => {
    it('should validate a correct trade', () => {
      const result = AlpacaTradeSchema.safeParse(validAlpacaTrade);
      expect(result.success).toBe(true);
    });
  });

  describe('AlpacaNewsArticleSchema', () => {
    it('should validate a correct news article', () => {
      const result = AlpacaNewsArticleSchema.safeParse(validAlpacaNewsArticle);
      expect(result.success).toBe(true);
    });

    it('should validate news with multiple images', () => {
      const result = AlpacaNewsArticleSchema.safeParse({
        ...validAlpacaNewsArticle,
        images: [
          { size: 'large', url: 'https://example.com/large.jpg' },
          { size: 'small', url: 'https://example.com/small.jpg' },
          { size: 'thumb', url: 'https://example.com/thumb.jpg' },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('AlpacaNewsResponseSchema', () => {
    it('should validate a complete news response', () => {
      const response = {
        news: [validAlpacaNewsArticle],
        next_page_token: 'token123',
      };
      const result = AlpacaNewsResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should validate news response with no next page', () => {
      const response = {
        news: [],
        next_page_token: null,
      };
      const result = AlpacaNewsResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe('AlpacaPortfolioHistoryResponseSchema', () => {
    it('should validate a portfolio history response', () => {
      const response = {
        timestamp: [1705315200, 1705401600],
        equity: [50000, 51000],
        profit_loss: [0, 1000],
        profit_loss_pct: [0, 0.02],
        base_value: 50000,
      };
      const result = AlpacaPortfolioHistoryResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe('AlpacaCryptoBarsResponseSchema', () => {
    it('should validate a crypto bars response', () => {
      const response = {
        bars: {
          'BTC/USD': [{
            t: '2024-01-15T14:30:00Z',
            o: 42000.0,
            h: 42500.0,
            l: 41800.0,
            c: 42300.0,
            v: 1000.5,
            n: 5000,
            vw: 42100.0,
          }],
        },
        next_page_token: null,
      };
      const result = AlpacaCryptoBarsResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });
});

// ===== Polygon Schema Tests =====

describe('Polygon Schemas', () => {
  describe('RawPolygonPriceDataSchema', () => {
    it('should validate raw price data', () => {
      const data = {
        T: 'AAPL',
        c: 150.0,
        h: 155.0,
        l: 149.0,
        n: 5000,
        o: 151.0,
        t: 1705315200000,
        v: 1000000,
        vw: 152.0,
      };
      const result = RawPolygonPriceDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject data with missing fields', () => {
      const result = RawPolygonPriceDataSchema.safeParse({
        T: 'AAPL',
        c: 150.0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PolygonTickerInfoSchema', () => {
    it('should validate ticker info', () => {
      const data = {
        active: true,
        currency_name: 'United States Dollar',
        description: 'Apple Inc.',
        locale: 'us',
        market: 'stocks',
        market_cap: 3000000000000,
        name: 'Apple Inc.',
        primary_exchange: 'XNAS',
        share_class_shares_outstanding: 15000000000,
        ticker: 'AAPL',
        type: 'CS',
      };
      const result = PolygonTickerInfoSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate ticker info with null shares outstanding', () => {
      const data = {
        active: true,
        currency_name: 'USD',
        locale: 'us',
        market: 'stocks',
        name: 'Test Corp',
        primary_exchange: 'XNAS',
        share_class_shares_outstanding: null,
        ticker: 'TEST',
        type: 'CS',
      };
      const result = PolygonTickerInfoSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid market type', () => {
      const data = {
        active: true,
        currency_name: 'USD',
        locale: 'us',
        market: 'invalid_market',
        name: 'Test',
        primary_exchange: 'XNAS',
        ticker: 'TEST',
        type: 'CS',
      };
      const result = PolygonTickerInfoSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('PolygonGroupedDailyResponseSchema', () => {
    it('should validate grouped daily response', () => {
      const data = {
        adjusted: true,
        queryCount: 1,
        request_id: 'req-123',
        resultsCount: 1,
        status: 'OK',
        results: [{
          T: 'AAPL', c: 150, h: 155, l: 149, n: 5000, o: 151, t: 1705315200000, v: 1000000, vw: 152,
        }],
      };
      const result = PolygonGroupedDailyResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('PolygonDailyOpenCloseSchema', () => {
    it('should validate daily open close data', () => {
      const data = {
        afterHours: 150.5,
        close: 150.0,
        from: '2024-01-15',
        high: 155.0,
        low: 149.0,
        open: 151.0,
        preMarket: 149.5,
        status: 'OK',
        symbol: 'AAPL',
        volume: 1000000,
      };
      const result = PolygonDailyOpenCloseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate without optional afterHours/preMarket', () => {
      const data = {
        close: 150.0,
        from: '2024-01-15',
        high: 155.0,
        low: 149.0,
        open: 151.0,
        status: 'OK',
        symbol: 'AAPL',
        volume: 1000000,
      };
      const result = PolygonDailyOpenCloseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('PolygonTradesResponseSchema', () => {
    it('should validate trades response', () => {
      const data = {
        status: 'OK',
        request_id: 'req-123',
        results: [{
          conditions: [1, 2],
          exchange: 11,
          id: 'trade-1',
          participant_timestamp: 1705315200000000000,
          price: 150.0,
          sequence_number: 1,
          sip_timestamp: 1705315200000000000,
          size: 100,
        }],
      };
      const result = PolygonTradesResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('PolygonErrorResponseSchema', () => {
    it('should validate error response', () => {
      const data = {
        status: 'ERROR',
        request_id: 'req-123',
        message: 'Not found',
      };
      const result = PolygonErrorResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });
});

// ===== Alpha Vantage Schema Tests =====

describe('Alpha Vantage Schemas', () => {
  describe('AlphaVantageQuoteResponseSchema', () => {
    it('should validate a quote response', () => {
      const data = {
        'Global Quote': {
          '01. symbol': 'AAPL',
          '02. open': '150.00',
          '03. high': '155.00',
          '04. low': '149.00',
          '05. price': '154.00',
        },
      };
      const result = AlphaVantageQuoteResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject quote without required symbol field', () => {
      const data = {
        'Global Quote': {
          '02. open': '150.00',
        },
      };
      const result = AlphaVantageQuoteResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('AVNewsArticleSchema', () => {
    it('should validate a news article', () => {
      const data = {
        title: 'Test News',
        url: 'https://example.com',
        time_published: '20240115T100000',
        authors: ['Author 1'],
        summary: 'A test article.',
        banner_image: 'https://example.com/image.jpg',
        source: 'Test Source',
        category_within_source: 'Technology',
        source_domain: 'example.com',
        topics: [{ topic: 'Technology', relevance_score: '0.95' }],
        overall_sentiment_score: 0.5,
        overall_sentiment_label: 'Somewhat-Bullish',
        ticker_sentiment: [{
          ticker: 'AAPL',
          relevance_score: '0.95',
          ticker_sentiment_score: '0.5',
          ticker_sentiment_label: 'Somewhat-Bullish',
        }],
      };
      const result = AVNewsArticleSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate article with null category', () => {
      const data = {
        title: 'Test',
        url: 'https://example.com',
        time_published: '20240115T100000',
        authors: [],
        summary: 'Summary',
        banner_image: '',
        source: 'Source',
        category_within_source: null,
        source_domain: 'example.com',
        topics: [],
        overall_sentiment_score: 0,
        overall_sentiment_label: 'Neutral',
        ticker_sentiment: [],
      };
      const result = AVNewsArticleSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('AVNewsResponseSchema', () => {
    it('should validate a news response', () => {
      const data = {
        items: 5,
        sentiment_score_definition: 'definition',
        relevance_score_definition: 'definition',
        feed: [],
      };
      const result = AVNewsResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate response with string items count', () => {
      const data = {
        items: '5',
        sentiment_score_definition: 'definition',
        relevance_score_definition: 'definition',
        feed: [],
      };
      const result = AVNewsResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });
});

// ===== validateResponse Tests =====

describe('validateResponse', () => {
  it('should return validated data on success', () => {
    const result = validateResponse(validAlpacaBar, AlpacaBarSchema);
    expect(result).toEqual(validAlpacaBar);
  });

  it('should return original data on failure in non-strict mode', () => {
    const invalidBar = { ...validAlpacaBar, o: 'not-a-number' };
    const result = validateResponse(invalidBar, AlpacaBarSchema, {
      label: 'test',
    });
    // In non-strict mode, returns the original data
    expect(result).toEqual(invalidBar);
  });

  it('should throw ValidationResponseError in strict mode on failure', () => {
    const invalidBar = { ...validAlpacaBar, o: 'not-a-number' };
    expect(() => {
      validateResponse(invalidBar, AlpacaBarSchema, {
        strict: true,
        label: 'test',
      });
    }).toThrow(ValidationResponseError);
  });

  it('should include issues in ValidationResponseError', () => {
    const invalidBar = { ...validAlpacaBar, o: 'not-a-number' };
    try {
      validateResponse(invalidBar, AlpacaBarSchema, {
        strict: true,
        label: 'test',
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationResponseError);
      const validationError = error as ValidationResponseError;
      expect(validationError.issues.length).toBeGreaterThan(0);
      expect(validationError.originalData).toEqual(invalidBar);
    }
  });

  it('should use default label when none provided', () => {
    const result = validateResponse(validAlpacaBar, AlpacaBarSchema);
    expect(result).toEqual(validAlpacaBar);
  });
});

// ===== safeValidateResponse Tests =====

describe('safeValidateResponse', () => {
  it('should return success result for valid data', () => {
    const result = safeValidateResponse(validAlpacaBar, AlpacaBarSchema);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(validAlpacaBar);
    expect(result.errors).toBeUndefined();
  });

  it('should return failure result for invalid data', () => {
    const invalidBar = { t: '2024-01-15', o: 'not-a-number' };
    const result = safeValidateResponse(invalidBar, AlpacaBarSchema);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('should return original data in failure result', () => {
    const invalidBar = { partial: true };
    const result = safeValidateResponse(invalidBar, AlpacaBarSchema);
    expect(result.success).toBe(false);
    expect(result.data).toEqual(invalidBar);
  });

  it('should validate complex nested structures', () => {
    const response = {
      bars: { AAPL: [validAlpacaBar, validAlpacaBar] },
      next_page_token: 'next-token',
      currency: 'USD',
    };
    const result = safeValidateResponse(response, AlpacaHistoricalBarsResponseSchema);
    expect(result.success).toBe(true);
  });

  it('should catch nested validation errors', () => {
    const response = {
      bars: { AAPL: [{ t: '2024-01-15', o: 'bad-price' }] },
      next_page_token: null,
    };
    const result = safeValidateResponse(response, AlpacaHistoricalBarsResponseSchema);
    expect(result.success).toBe(false);
  });
});
