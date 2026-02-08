import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing module under test
vi.mock('../misc-utils', () => ({
  fetchWithRetry: vi.fn(),
  hideApiKeyFromurl: vi.fn((url: string) => url.replace(/apiKey=[^&]+/, 'apiKey=***')),
  logIfDebug: vi.fn(),
  validatePolygonApiKey: vi.fn(),
}));

vi.mock('../utils/auth-validator', () => ({
  validatePolygonApiKey: vi.fn(),
}));

vi.mock('../logger', () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../market-time', () => ({
  getLastFullTradingDate: vi.fn(() => ({
    date: new Date('2025-01-10'),
    isToday: false,
  })),
}));

vi.mock('../format-tools', () => ({
  formatCurrency: vi.fn((n: number) => `$${n.toFixed(2)}`),
}));

import {
  analysePolygonPriceData,
  formatPriceData,
  fetchTickerInfo,
  fetchLastTrade,
  fetchPrices,
  fetchGroupedDaily,
  fetchDailyOpenClose,
  getPreviousClose,
  fetchTrades,
} from '../polygon';
import { fetchWithRetry } from '../misc-utils';
import { PolygonPriceData } from '../types';

const mockFetchWithRetry = vi.mocked(fetchWithRetry);

describe('analysePolygonPriceData', () => {
  it('should return no data message for empty array', () => {
    const result = analysePolygonPriceData([]);
    expect(result).toBe('No price data available for analysis.');
  });

  it('should return no data message for null-like input', () => {
    const result = analysePolygonPriceData(null as unknown as PolygonPriceData[]);
    expect(result).toBe('No price data available for analysis.');
  });

  it('should generate a report for valid price data', () => {
    const priceData: PolygonPriceData[] = [
      {
        symbol: 'AAPL',
        date: '2025-01-10T10:00:00',
        timeStamp: 1736510400000,
        open: 150,
        high: 155,
        low: 149,
        close: 153,
        vol: 10000,
        vwap: 152,
        trades: 500,
      },
      {
        symbol: 'AAPL',
        date: '2025-01-10T11:00:00',
        timeStamp: 1736514000000,
        open: 153,
        high: 157,
        low: 152,
        close: 156,
        vol: 12000,
        vwap: 155,
        trades: 600,
      },
    ];

    const result = analysePolygonPriceData(priceData);
    expect(result).toContain('Report:');
    expect(result).toContain('Number of data points: 2');
    expect(result).toContain('Average interval between data points (seconds)');
  });

  it('should handle single data point', () => {
    const priceData: PolygonPriceData[] = [
      {
        symbol: 'MSFT',
        date: '2025-01-10T10:00:00',
        timeStamp: 1736510400000,
        open: 400,
        high: 410,
        low: 395,
        close: 405,
        vol: 5000,
        vwap: 403,
        trades: 200,
      },
    ];

    const result = analysePolygonPriceData(priceData);
    expect(result).toContain('Number of data points: 1');
    expect(result).toContain('Average interval between data points (seconds): 0.00');
  });
});

describe('formatPriceData', () => {
  it('should return no data message for empty array', () => {
    expect(formatPriceData([])).toBe('No price data available');
  });

  it('should return no data message for null-like input', () => {
    expect(formatPriceData(null as unknown as PolygonPriceData[])).toBe('No price data available');
  });

  it('should format price data correctly', () => {
    const priceData: PolygonPriceData[] = [
      {
        symbol: 'AAPL',
        date: 'Jan 10, 2025, 10:00:00 EST',
        timeStamp: 1736510400000,
        open: 150.5,
        high: 155.25,
        low: 149.0,
        close: 153.75,
        vol: 10000,
        vwap: 152,
        trades: 500,
      },
    ];

    const result = formatPriceData(priceData);
    expect(result).toContain('Jan 10, 2025');
    expect(result).toContain('O: $150.50');
    expect(result).toContain('H: $155.25');
    expect(result).toContain('L: $149.00');
    expect(result).toContain('C: $153.75');
    expect(result).toContain('Vol: 10000');
  });

  it('should strip midnight time from daily data', () => {
    const priceData: PolygonPriceData[] = [
      {
        symbol: 'AAPL',
        date: 'Jan 10, 2025, 00:00:00 EST',
        timeStamp: 1736510400000,
        open: 150,
        high: 155,
        low: 149,
        close: 153,
        vol: 10000,
        vwap: 152,
        trades: 500,
      },
    ];

    const result = formatPriceData(priceData);
    expect(result).toContain('Jan 10, 2025');
    expect(result).not.toContain('00:00:00');
  });
});

describe('fetchTickerInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw if no API key is available', async () => {
    // Mock process.env to not have POLYGON_API_KEY
    const originalEnv = process.env.POLYGON_API_KEY;
    delete process.env.POLYGON_API_KEY;

    await expect(fetchTickerInfo('AAPL')).rejects.toThrow('Polygon API key is missing');

    process.env.POLYGON_API_KEY = originalEnv;
  });

  it('should return ticker info for valid symbol', async () => {
    const mockResponse = {
      status: 'OK',
      results: {
        ticker: 'AAPL',
        type: 'CS',
        active: true,
        currency_name: 'usd',
        description: 'Apple Inc.',
        locale: 'us',
        market: 'stocks',
        market_cap: 3000000000000,
        name: 'Apple Inc.',
        primary_exchange: 'XNAS',
        share_class_shares_outstanding: 15000000000,
      },
    };

    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await fetchTickerInfo('AAPL', { apiKey: 'test-key' });

    expect(result).not.toBeNull();
    expect(result?.ticker).toBe('AAPL');
    expect(result?.name).toBe('Apple Inc.');
    expect(result?.active).toBe(true);
    expect(result?.market_cap).toBe(3000000000000);
  });

  it('should return null for NOT_FOUND status', async () => {
    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve({ status: 'NOT_FOUND' }),
    } as Response);

    const result = await fetchTickerInfo('INVALID', { apiKey: 'test-key' });
    expect(result).toBeNull();
  });

  it('should throw if results are missing required fields', async () => {
    const mockResponse = {
      status: 'OK',
      results: {
        ticker: 'AAPL',
        // Missing other required fields
      },
    };

    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    } as Response);

    await expect(fetchTickerInfo('AAPL', { apiKey: 'test-key' })).rejects.toThrow(
      'Missing required field in Polygon API response'
    );
  });
});

describe('fetchLastTrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw if no API key is available', async () => {
    const originalEnv = process.env.POLYGON_API_KEY;
    delete process.env.POLYGON_API_KEY;

    await expect(fetchLastTrade('AAPL')).rejects.toThrow('Polygon API key is missing');

    process.env.POLYGON_API_KEY = originalEnv;
  });

  it('should return last trade data', async () => {
    const timestamp = Date.now() * 1000000; // nanoseconds
    const mockResponse = {
      status: 'OK',
      results: {
        p: 150.25,
        s: 100,
        t: timestamp,
      },
    };

    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await fetchLastTrade('AAPL', { apiKey: 'test-key' });

    expect(result.price).toBe(150.25);
    expect(result.vol).toBe(100);
    expect(result.time).toBeInstanceOf(Date);
  });

  it('should throw if status is not OK', async () => {
    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve({ status: 'ERROR', error: 'Not found' }),
    } as Response);

    await expect(fetchLastTrade('INVALID', { apiKey: 'test-key' })).rejects.toThrow(
      'Polygon.io API error'
    );
  });

  it('should throw if trade data has invalid types', async () => {
    mockFetchWithRetry.mockResolvedValue({
      json: () =>
        Promise.resolve({
          status: 'OK',
          results: { p: 'not-a-number', s: 100, t: 123 },
        }),
    } as Response);

    await expect(fetchLastTrade('AAPL', { apiKey: 'test-key' })).rejects.toThrow(
      'Invalid trade data'
    );
  });
});

describe('fetchPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw if no API key is available', async () => {
    const originalEnv = process.env.POLYGON_API_KEY;
    delete process.env.POLYGON_API_KEY;

    await expect(
      fetchPrices({ ticker: 'AAPL', start: 1000, multiplier: 1, timespan: 'day' })
    ).rejects.toThrow('Polygon API key is missing');

    process.env.POLYGON_API_KEY = originalEnv;
  });

  it('should return mapped price data', async () => {
    const mockResponse = {
      status: 'OK',
      results: [
        {
          T: 'AAPL',
          o: 150,
          h: 155,
          l: 149,
          c: 153,
          v: 10000,
          vw: 152,
          n: 500,
          t: 1736510400000,
        },
      ],
    };

    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await fetchPrices(
      { ticker: 'AAPL', start: 1736424000000, multiplier: 1, timespan: 'day' },
      { apiKey: 'test-key' }
    );

    expect(result).toHaveLength(1);
    expect(result[0].open).toBe(150);
    expect(result[0].high).toBe(155);
    expect(result[0].low).toBe(149);
    expect(result[0].close).toBe(153);
    expect(result[0].vol).toBe(10000);
  });

  it('should handle pagination', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            status: 'OK',
            results: [{ T: 'AAPL', o: 150, h: 155, l: 149, c: 153, v: 10000, vw: 152, n: 500, t: 1000 }],
            next_url: 'https://api.polygon.io/v2/aggs/next',
          }),
      } as Response)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            status: 'OK',
            results: [{ T: 'AAPL', o: 153, h: 158, l: 152, c: 157, v: 12000, vw: 155, n: 600, t: 2000 }],
          }),
      } as Response);

    const result = await fetchPrices(
      { ticker: 'AAPL', start: 1000, multiplier: 1, timespan: 'day' },
      { apiKey: 'test-key' }
    );

    expect(result).toHaveLength(2);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2);
  });
});

describe('fetchGroupedDaily', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw if no API key is available', async () => {
    const originalEnv = process.env.POLYGON_API_KEY;
    delete process.env.POLYGON_API_KEY;

    await expect(fetchGroupedDaily('2025-01-10')).rejects.toThrow('Polygon API key is missing');

    process.env.POLYGON_API_KEY = originalEnv;
  });

  it('should return grouped daily data', async () => {
    const mockResponse = {
      status: 'OK',
      adjusted: true,
      queryCount: 1,
      request_id: 'req-123',
      resultsCount: 1,
      results: [
        { T: 'AAPL', o: 150, h: 155, l: 149, c: 153, v: 10000, vw: 152, n: 500, t: 1736510400000 },
      ],
    };

    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await fetchGroupedDaily('2025-01-10', { apiKey: 'test-key' });

    expect(result.status).toBe('OK');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].open).toBe(150);
  });
});

describe('fetchDailyOpenClose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return daily open close data', async () => {
    const mockResponse = {
      status: 'OK',
      from: '2025-01-10',
      symbol: 'AAPL',
      open: 150,
      high: 155,
      low: 149,
      close: 153,
      volume: 10000,
    };

    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await fetchDailyOpenClose('AAPL', new Date('2025-01-10'), {
      apiKey: 'test-key',
    });

    expect(result.close).toBe(153);
    expect(result.open).toBe(150);
  });

  it('should throw on non-OK status', async () => {
    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve({ status: 'NOT_FOUND' }),
    } as Response);

    await expect(
      fetchDailyOpenClose('INVALID', new Date('2025-01-10'), { apiKey: 'test-key' })
    ).rejects.toThrow('Failed to fetch daily open/close data');
  });
});

describe('getPreviousClose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return previous close price and date', async () => {
    const mockResponse = {
      status: 'OK',
      from: '2025-01-10',
      symbol: 'AAPL',
      open: 150,
      high: 155,
      low: 149,
      close: 153,
      volume: 10000,
    };

    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await getPreviousClose('AAPL', undefined, { apiKey: 'test-key' });

    expect(result.close).toBe(153);
    expect(result.date).toBeInstanceOf(Date);
  });
});

describe('fetchTrades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw if no API key is available', async () => {
    const originalEnv = process.env.POLYGON_API_KEY;
    delete process.env.POLYGON_API_KEY;

    await expect(fetchTrades('AAPL')).rejects.toThrow('Polygon API key is missing');

    process.env.POLYGON_API_KEY = originalEnv;
  });

  it('should return trades response', async () => {
    const mockResponse = {
      status: 'OK',
      request_id: 'req-123',
      results: [
        {
          conditions: [12, 37],
          exchange: 4,
          id: '1',
          participant_timestamp: 1736510400000000000,
          price: 150.25,
          sequence_number: 1,
          sip_timestamp: 1736510400000000000,
          size: 100,
        },
      ],
    };

    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await fetchTrades('AAPL', { apiKey: 'test-key' });

    expect(result.status).toBe('OK');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].price).toBe(150.25);
  });

  it('should throw on error response', async () => {
    mockFetchWithRetry.mockResolvedValue({
      json: () =>
        Promise.resolve({
          status: 'NOT_AUTHORIZED',
          request_id: 'req-123',
          message: 'Not authorized',
        }),
    } as Response);

    await expect(fetchTrades('AAPL', { apiKey: 'bad-key' })).rejects.toThrow(
      'Polygon API Error: Not authorized'
    );
  });
});
