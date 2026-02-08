import { describe, it, expect } from 'vitest';
import {
  withTimeout,
  createTimeoutSignal,
  getTimeout,
  DEFAULT_TIMEOUTS,
} from '../http-timeout';

describe('DEFAULT_TIMEOUTS', () => {
  it('should have ALPACA_API timeout defined', () => {
    expect(typeof DEFAULT_TIMEOUTS.ALPACA_API).toBe('number');
    expect(DEFAULT_TIMEOUTS.ALPACA_API).toBeGreaterThan(0);
  });

  it('should have POLYGON_API timeout defined', () => {
    expect(typeof DEFAULT_TIMEOUTS.POLYGON_API).toBe('number');
    expect(DEFAULT_TIMEOUTS.POLYGON_API).toBeGreaterThan(0);
  });

  it('should have ALPHA_VANTAGE timeout defined', () => {
    expect(typeof DEFAULT_TIMEOUTS.ALPHA_VANTAGE).toBe('number');
    expect(DEFAULT_TIMEOUTS.ALPHA_VANTAGE).toBeGreaterThan(0);
  });

  it('should have GENERAL timeout defined', () => {
    expect(typeof DEFAULT_TIMEOUTS.GENERAL).toBe('number');
    expect(DEFAULT_TIMEOUTS.GENERAL).toBeGreaterThan(0);
  });

  it('should default to 30000ms when env vars are not set', () => {
    // Default values should be 30000 unless overridden by env
    expect(DEFAULT_TIMEOUTS.ALPACA_API).toBe(30000);
    expect(DEFAULT_TIMEOUTS.POLYGON_API).toBe(30000);
    expect(DEFAULT_TIMEOUTS.ALPHA_VANTAGE).toBe(30000);
    expect(DEFAULT_TIMEOUTS.GENERAL).toBe(30000);
  });
});

describe('withTimeout', () => {
  it('should resolve when promise completes before timeout', async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 10);
    });

    const result = await withTimeout(fastPromise, 1000, 'test');

    expect(result).toBe('done');
  });

  it('should reject when promise exceeds timeout', async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 5000);
    });

    await expect(withTimeout(slowPromise, 50, 'slow-request')).rejects.toThrow(
      /timeout.*50ms.*slow-request/i
    );
  });

  it('should preserve the resolved value type', async () => {
    const numPromise = Promise.resolve(42);
    const result = await withTimeout(numPromise, 1000, 'test');

    expect(result).toBe(42);
    expect(typeof result).toBe('number');
  });

  it('should preserve the original rejection when promise rejects before timeout', async () => {
    const failingPromise = Promise.reject(new Error('Original error'));

    await expect(withTimeout(failingPromise, 1000, 'test')).rejects.toThrow('Original error');
  });

  it('should include label in timeout error message', async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 5000);
    });

    await expect(withTimeout(slowPromise, 50, 'MyAPI.fetchData')).rejects.toThrow(
      'MyAPI.fetchData'
    );
  });

  it('should include timeout duration in error message', async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 5000);
    });

    await expect(withTimeout(slowPromise, 100, 'test')).rejects.toThrow('100ms');
  });

  it('should handle immediately resolving promise', async () => {
    const result = await withTimeout(Promise.resolve('instant'), 1000, 'test');

    expect(result).toBe('instant');
  });

  it('should handle immediately rejecting promise', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('instant fail')), 1000, 'test')
    ).rejects.toThrow('instant fail');
  });
});

describe('createTimeoutSignal', () => {
  it('should return an AbortSignal', () => {
    const signal = createTimeoutSignal(5000);

    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('should not be aborted initially for long timeout', () => {
    const signal = createTimeoutSignal(60000);

    expect(signal.aborted).toBe(false);
  });

  it('should abort after specified time', async () => {
    const signal = createTimeoutSignal(50);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(signal.aborted).toBe(true);
  });
});

describe('getTimeout', () => {
  it('should return ALPACA_API timeout', () => {
    expect(getTimeout('ALPACA_API')).toBe(DEFAULT_TIMEOUTS.ALPACA_API);
  });

  it('should return POLYGON_API timeout', () => {
    expect(getTimeout('POLYGON_API')).toBe(DEFAULT_TIMEOUTS.POLYGON_API);
  });

  it('should return ALPHA_VANTAGE timeout', () => {
    expect(getTimeout('ALPHA_VANTAGE')).toBe(DEFAULT_TIMEOUTS.ALPHA_VANTAGE);
  });

  it('should return GENERAL timeout', () => {
    expect(getTimeout('GENERAL')).toBe(DEFAULT_TIMEOUTS.GENERAL);
  });
});
