import { describe, it, expect } from 'vitest';
import {
  AdapticUtilsError,
  AlpacaApiError,
  PolygonApiError,
  AlphaVantageError,
  TimeoutError,
  ValidationError,
  AuthenticationError,
  HttpClientError,
  HttpServerError,
  RateLimitError,
  WebSocketError,
  NetworkError,
  DataFormatError,
} from '../errors';

describe('AdapticUtilsError', () => {
  it('should create error with all properties', () => {
    const error = new AdapticUtilsError('Test error', 'TEST_CODE', 'test-service', true);

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.service).toBe('test-service');
    expect(error.isRetryable).toBe(true);
    expect(error.name).toBe('AdapticUtilsError');
  });

  it('should default isRetryable to false', () => {
    const error = new AdapticUtilsError('Test', 'CODE', 'service');

    expect(error.isRetryable).toBe(false);
  });

  it('should be instanceof Error', () => {
    const error = new AdapticUtilsError('Test', 'CODE', 'service');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AdapticUtilsError);
  });

  it('should preserve cause when provided', () => {
    const cause = new Error('Original error');
    const error = new AdapticUtilsError('Wrapper', 'CODE', 'service', false, cause);

    expect(error.cause).toBe(cause);
  });

  it('should have a stack trace', () => {
    const error = new AdapticUtilsError('Test', 'CODE', 'service');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('AdapticUtilsError');
  });
});

describe('AlpacaApiError', () => {
  it('should create with service set to alpaca', () => {
    const error = new AlpacaApiError('Alpaca error', 'ALPACA_ERR', 400);

    expect(error.service).toBe('alpaca');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('AlpacaApiError');
  });

  it('should be retryable for 429 status', () => {
    const error = new AlpacaApiError('Rate limited', 'RATE_LIMIT', 429);

    expect(error.isRetryable).toBe(true);
  });

  it('should be retryable for 500 status', () => {
    const error = new AlpacaApiError('Server error', 'SERVER_ERR', 500);

    expect(error.isRetryable).toBe(true);
  });

  it('should be retryable for 503 status', () => {
    const error = new AlpacaApiError('Service unavailable', 'UNAVAILABLE', 503);

    expect(error.isRetryable).toBe(true);
  });

  it('should not be retryable for 400 status', () => {
    const error = new AlpacaApiError('Bad request', 'BAD_REQ', 400);

    expect(error.isRetryable).toBe(false);
  });

  it('should not be retryable for 401 status', () => {
    const error = new AlpacaApiError('Unauthorized', 'UNAUTH', 401);

    expect(error.isRetryable).toBe(false);
  });

  it('should not be retryable for undefined status', () => {
    const error = new AlpacaApiError('Unknown', 'UNKNOWN');

    expect(error.isRetryable).toBe(false);
    expect(error.statusCode).toBeUndefined();
  });

  it('should be instanceof AdapticUtilsError', () => {
    const error = new AlpacaApiError('Test', 'CODE', 200);

    expect(error).toBeInstanceOf(AdapticUtilsError);
    expect(error).toBeInstanceOf(AlpacaApiError);
  });
});

describe('PolygonApiError', () => {
  it('should set service to polygon', () => {
    const error = new PolygonApiError('Polygon error', 'POLY_ERR', 400);

    expect(error.service).toBe('polygon');
    expect(error.name).toBe('PolygonApiError');
  });

  it('should be retryable for 429', () => {
    const error = new PolygonApiError('Rate limited', 'RATE_LIMIT', 429);

    expect(error.isRetryable).toBe(true);
  });

  it('should not be retryable for 404', () => {
    const error = new PolygonApiError('Not found', 'NOT_FOUND', 404);

    expect(error.isRetryable).toBe(false);
  });
});

describe('AlphaVantageError', () => {
  it('should set service to alphavantage', () => {
    const error = new AlphaVantageError('AV error', 'AV_ERR', 400);

    expect(error.service).toBe('alphavantage');
    expect(error.name).toBe('AlphaVantageError');
  });

  it('should be retryable for server errors (5xx)', () => {
    const error = new AlphaVantageError('Server error', 'SERVER_ERR', 502);

    expect(error.isRetryable).toBe(true);
  });
});

describe('TimeoutError', () => {
  it('should always be retryable', () => {
    const error = new TimeoutError('Request timed out', 'alpaca', 30000);

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe('TIMEOUT');
    expect(error.timeoutMs).toBe(30000);
    expect(error.name).toBe('TimeoutError');
  });

  it('should set the service correctly', () => {
    const error = new TimeoutError('Timeout', 'polygon', 5000);

    expect(error.service).toBe('polygon');
  });
});

describe('ValidationError', () => {
  it('should never be retryable', () => {
    const error = new ValidationError('Invalid input', 'alpaca', 'symbol');

    expect(error.isRetryable).toBe(false);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.invalidField).toBe('symbol');
    expect(error.name).toBe('ValidationError');
  });

  it('should work without invalidField', () => {
    const error = new ValidationError('Invalid', 'test');

    expect(error.invalidField).toBeUndefined();
  });
});

describe('AuthenticationError', () => {
  it('should never be retryable', () => {
    const error = new AuthenticationError('Unauthorized', 'alpaca', 401);

    expect(error.isRetryable).toBe(false);
    expect(error.code).toBe('AUTH_ERROR');
    expect(error.statusCode).toBe(401);
    expect(error.name).toBe('AuthenticationError');
  });
});

describe('HttpClientError', () => {
  it('should not be retryable', () => {
    const error = new HttpClientError('Bad request', 'polygon', 400);

    expect(error.isRetryable).toBe(false);
    expect(error.code).toBe('CLIENT_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('HttpClientError');
  });
});

describe('HttpServerError', () => {
  it('should always be retryable', () => {
    const error = new HttpServerError('Server error', 'alpaca', 500);

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('HttpServerError');
  });
});

describe('RateLimitError', () => {
  it('should always be retryable', () => {
    const error = new RateLimitError('Rate limited', 'polygon', 5000);

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe('RATE_LIMIT');
    expect(error.retryAfterMs).toBe(5000);
    expect(error.name).toBe('RateLimitError');
  });

  it('should work without retryAfterMs', () => {
    const error = new RateLimitError('Rate limited', 'test');

    expect(error.retryAfterMs).toBeUndefined();
    expect(error.isRetryable).toBe(true);
  });
});

describe('WebSocketError', () => {
  it('should default to retryable', () => {
    const error = new WebSocketError('WS error', 'alpaca');

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe('WEBSOCKET_ERROR');
    expect(error.name).toBe('WebSocketError');
  });

  it('should allow non-retryable configuration', () => {
    const error = new WebSocketError('WS auth error', 'alpaca', false);

    expect(error.isRetryable).toBe(false);
  });
});

describe('NetworkError', () => {
  it('should always be retryable', () => {
    const error = new NetworkError('DNS failure', 'polygon');

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.name).toBe('NetworkError');
  });
});

describe('DataFormatError', () => {
  it('should not be retryable', () => {
    const error = new DataFormatError('Invalid JSON', 'alpaca');

    expect(error.isRetryable).toBe(false);
    expect(error.code).toBe('DATA_FORMAT_ERROR');
    expect(error.name).toBe('DataFormatError');
  });
});

describe('Error hierarchy', () => {
  it('should all be instanceof Error', () => {
    const errors = [
      new AlpacaApiError('test', 'CODE', 400),
      new PolygonApiError('test', 'CODE', 400),
      new AlphaVantageError('test', 'CODE', 400),
      new TimeoutError('test', 'service', 1000),
      new ValidationError('test', 'service'),
      new AuthenticationError('test', 'service', 401),
      new HttpClientError('test', 'service', 400),
      new HttpServerError('test', 'service', 500),
      new RateLimitError('test', 'service'),
      new WebSocketError('test', 'service'),
      new NetworkError('test', 'service'),
      new DataFormatError('test', 'service'),
    ];

    errors.forEach((error) => {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AdapticUtilsError);
    });
  });

  it('each error should have a unique name', () => {
    const names = [
      new AlpacaApiError('test', 'CODE').name,
      new PolygonApiError('test', 'CODE').name,
      new AlphaVantageError('test', 'CODE').name,
      new TimeoutError('test', 'service', 1000).name,
      new ValidationError('test', 'service').name,
      new AuthenticationError('test', 'service').name,
      new HttpClientError('test', 'service', 400).name,
      new HttpServerError('test', 'service', 500).name,
      new RateLimitError('test', 'service').name,
      new WebSocketError('test', 'service').name,
      new NetworkError('test', 'service').name,
      new DataFormatError('test', 'service').name,
    ];

    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
