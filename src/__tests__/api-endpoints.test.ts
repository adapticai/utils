import { describe, it, expect } from 'vitest';
import {
  TRADING_API,
  MARKET_DATA_API,
  WEBSOCKET_STREAMS,
  getTradingApiUrl,
  getTradingWebSocketUrl,
  getStockStreamUrl,
  getOptionsStreamUrl,
  getCryptoStreamUrl,
} from '../config/api-endpoints';

describe('TRADING_API constants', () => {
  it('should have PAPER URL pointing to paper API', () => {
    expect(TRADING_API.PAPER).toBe('https://paper-api.alpaca.markets/v2');
  });

  it('should have LIVE URL pointing to production API', () => {
    expect(TRADING_API.LIVE).toBe('https://api.alpaca.markets/v2');
  });

  it('should use HTTPS for both environments', () => {
    expect(TRADING_API.PAPER).toMatch(/^https:\/\//);
    expect(TRADING_API.LIVE).toMatch(/^https:\/\//);
  });

  it('should use v2 for both environments', () => {
    expect(TRADING_API.PAPER).toContain('/v2');
    expect(TRADING_API.LIVE).toContain('/v2');
  });
});

describe('MARKET_DATA_API constants', () => {
  it('should have STOCKS endpoint at v2', () => {
    expect(MARKET_DATA_API.STOCKS).toBe('https://data.alpaca.markets/v2');
  });

  it('should have CRYPTO endpoint at v1beta3', () => {
    expect(MARKET_DATA_API.CRYPTO).toBe('https://data.alpaca.markets/v1beta3');
  });

  it('should have OPTIONS endpoint at v1beta1', () => {
    expect(MARKET_DATA_API.OPTIONS).toBe('https://data.alpaca.markets/v1beta1');
  });

  it('should have NEWS endpoint at v1beta1', () => {
    expect(MARKET_DATA_API.NEWS).toBe('https://data.alpaca.markets/v1beta1');
  });

  it('should all use data.alpaca.markets base URL', () => {
    Object.values(MARKET_DATA_API).forEach((url) => {
      expect(url).toContain('data.alpaca.markets');
    });
  });
});

describe('WEBSOCKET_STREAMS constants', () => {
  it('should have trading streams for PAPER and LIVE', () => {
    expect(WEBSOCKET_STREAMS.TRADING.PAPER).toMatch(/^wss:\/\//);
    expect(WEBSOCKET_STREAMS.TRADING.LIVE).toMatch(/^wss:\/\//);
  });

  it('should have stock streams for PRODUCTION and TEST', () => {
    expect(WEBSOCKET_STREAMS.STOCKS.PRODUCTION).toMatch(/^wss:\/\//);
    expect(WEBSOCKET_STREAMS.STOCKS.TEST).toMatch(/^wss:\/\//);
  });

  it('should have options streams for PRODUCTION and SANDBOX', () => {
    expect(WEBSOCKET_STREAMS.OPTIONS.PRODUCTION).toMatch(/^wss:\/\//);
    expect(WEBSOCKET_STREAMS.OPTIONS.SANDBOX).toMatch(/^wss:\/\//);
  });

  it('should have crypto streams for PRODUCTION and SANDBOX', () => {
    expect(WEBSOCKET_STREAMS.CRYPTO.PRODUCTION).toMatch(/^wss:\/\//);
    expect(WEBSOCKET_STREAMS.CRYPTO.SANDBOX).toMatch(/^wss:\/\//);
  });

  it('should use wss protocol for all streams', () => {
    const allUrls = [
      WEBSOCKET_STREAMS.TRADING.PAPER,
      WEBSOCKET_STREAMS.TRADING.LIVE,
      WEBSOCKET_STREAMS.STOCKS.PRODUCTION,
      WEBSOCKET_STREAMS.STOCKS.TEST,
      WEBSOCKET_STREAMS.OPTIONS.PRODUCTION,
      WEBSOCKET_STREAMS.OPTIONS.SANDBOX,
      WEBSOCKET_STREAMS.CRYPTO.PRODUCTION,
      WEBSOCKET_STREAMS.CRYPTO.SANDBOX,
    ];

    allUrls.forEach((url) => {
      expect(url).toMatch(/^wss:\/\//);
    });
  });

  it('should sandbox URLs contain sandbox in the hostname', () => {
    expect(WEBSOCKET_STREAMS.OPTIONS.SANDBOX).toContain('sandbox');
    expect(WEBSOCKET_STREAMS.CRYPTO.SANDBOX).toContain('sandbox');
  });
});

describe('getTradingApiUrl', () => {
  it('should return paper URL for PAPER account type', () => {
    expect(getTradingApiUrl('PAPER')).toBe(TRADING_API.PAPER);
  });

  it('should return live URL for LIVE account type', () => {
    expect(getTradingApiUrl('LIVE')).toBe(TRADING_API.LIVE);
  });
});

describe('getTradingWebSocketUrl', () => {
  it('should return paper WS URL for PAPER account type', () => {
    expect(getTradingWebSocketUrl('PAPER')).toBe(WEBSOCKET_STREAMS.TRADING.PAPER);
  });

  it('should return live WS URL for LIVE account type', () => {
    expect(getTradingWebSocketUrl('LIVE')).toBe(WEBSOCKET_STREAMS.TRADING.LIVE);
  });
});

describe('getStockStreamUrl', () => {
  it('should return production URL by default', () => {
    expect(getStockStreamUrl()).toBe(WEBSOCKET_STREAMS.STOCKS.PRODUCTION);
  });

  it('should return production URL for PRODUCTION mode', () => {
    expect(getStockStreamUrl('PRODUCTION')).toBe(WEBSOCKET_STREAMS.STOCKS.PRODUCTION);
  });

  it('should return test URL for TEST mode', () => {
    expect(getStockStreamUrl('TEST')).toBe(WEBSOCKET_STREAMS.STOCKS.TEST);
  });
});

describe('getOptionsStreamUrl', () => {
  it('should return production URL by default', () => {
    expect(getOptionsStreamUrl()).toBe(WEBSOCKET_STREAMS.OPTIONS.PRODUCTION);
  });

  it('should return production URL for PRODUCTION mode', () => {
    expect(getOptionsStreamUrl('PRODUCTION')).toBe(WEBSOCKET_STREAMS.OPTIONS.PRODUCTION);
  });

  it('should return sandbox URL for SANDBOX mode', () => {
    expect(getOptionsStreamUrl('SANDBOX')).toBe(WEBSOCKET_STREAMS.OPTIONS.SANDBOX);
  });
});

describe('getCryptoStreamUrl', () => {
  it('should return production URL by default', () => {
    expect(getCryptoStreamUrl()).toBe(WEBSOCKET_STREAMS.CRYPTO.PRODUCTION);
  });

  it('should return production URL for PRODUCTION mode', () => {
    expect(getCryptoStreamUrl('PRODUCTION')).toBe(WEBSOCKET_STREAMS.CRYPTO.PRODUCTION);
  });

  it('should return sandbox URL for SANDBOX mode', () => {
    expect(getCryptoStreamUrl('SANDBOX')).toBe(WEBSOCKET_STREAMS.CRYPTO.SANDBOX);
  });
});
