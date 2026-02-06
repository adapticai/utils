import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StampedeProtectedCache, CacheLoader, StampedeProtectedCacheOptions } from '../cache/stampede-protected-cache';

describe('StampedeProtectedCache', () => {
  let cache: StampedeProtectedCache<string>;
  let mockLoader: CacheLoader<string>;

  beforeEach(() => {
    const options: StampedeProtectedCacheOptions = {
      maxSize: 100,
      defaultTtl: 1000, // 1 second for faster testing
      staleWhileRevalidateTtl: 2000,
      minJitter: 0.9,
      maxJitter: 1.1,
      enableBackgroundRefresh: true,
    };
    cache = new StampedeProtectedCache<string>(options);
    mockLoader = vi.fn(async (key: string) => `value-${key}`);
  });

  describe('basic operations', () => {
    it('should load and cache a value on cache miss', async () => {
      const result = await cache.get('test-key', mockLoader);

      expect(result).toBe('value-test-key');
      expect(mockLoader).toHaveBeenCalledTimes(1);
      expect(mockLoader).toHaveBeenCalledWith('test-key');
    });

    it('should return cached value on subsequent calls (cache hit)', async () => {
      await cache.get('test-key', mockLoader);
      const result = await cache.get('test-key', mockLoader);

      expect(result).toBe('value-test-key');
      expect(mockLoader).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should handle multiple different keys', async () => {
      const result1 = await cache.get('key1', mockLoader);
      const result2 = await cache.get('key2', mockLoader);

      expect(result1).toBe('value-key1');
      expect(result2).toBe('value-key2');
      expect(mockLoader).toHaveBeenCalledTimes(2);
    });

    it('should manually set a value in cache', () => {
      cache.set('manual-key', 'manual-value');

      expect(cache.has('manual-key')).toBe(true);
    });

    it('should delete a value from cache', async () => {
      await cache.get('test-key', mockLoader);
      expect(cache.has('test-key')).toBe(true);

      const deleted = cache.delete('test-key');

      expect(deleted).toBe(true);
      expect(cache.has('test-key')).toBe(false);
    });

    it('should clear all values from cache', async () => {
      await cache.get('key1', mockLoader);
      await cache.get('key2', mockLoader);

      expect(cache.size).toBe(2);

      cache.clear();

      expect(cache.size).toBe(0);
    });
  });

  describe('cache statistics', () => {
    it('should track hits and misses correctly', async () => {
      const initialStats = cache.getStats();
      expect(initialStats.hits).toBe(0);
      expect(initialStats.misses).toBe(0);

      // First call is a miss
      await cache.get('test-key', mockLoader);
      let stats = cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Second call is a hit
      await cache.get('test-key', mockLoader);
      stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit ratio correctly', async () => {
      await cache.get('key1', mockLoader); // miss
      await cache.get('key1', mockLoader); // hit
      await cache.get('key1', mockLoader); // hit

      const stats = cache.getStats();
      expect(stats.totalGets).toBe(3);
      expect(stats.hitRatio).toBeCloseTo(0.666, 2);
    });

    it('should return cache size correctly', async () => {
      expect(cache.size).toBe(0);

      await cache.get('key1', mockLoader);
      expect(cache.size).toBe(1);

      await cache.get('key2', mockLoader);
      expect(cache.size).toBe(2);
    });

    it('should track cache keys', async () => {
      await cache.get('key1', mockLoader);
      await cache.get('key2', mockLoader);

      const keys = cache.keys();
      expect(keys).toHaveLength(2);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });

    it('should reset statistics', async () => {
      await cache.get('test-key', mockLoader);
      await cache.get('test-key', mockLoader);

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.totalGets).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('request coalescing', () => {
    it('should coalesce concurrent requests for the same key', async () => {
      const slowLoader: CacheLoader<string> = vi.fn(async (key: string) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return `value-${key}`;
      });

      // Fire off multiple concurrent requests
      const promises = [
        cache.get('test-key', slowLoader),
        cache.get('test-key', slowLoader),
        cache.get('test-key', slowLoader),
      ];

      const results = await Promise.all(promises);

      // All should return the same value
      expect(results).toEqual(['value-test-key', 'value-test-key', 'value-test-key']);
      // Loader should only be called once
      expect(slowLoader).toHaveBeenCalledTimes(1);

      // Check coalesced requests stat
      const stats = cache.getStats();
      expect(stats.coalescedRequests).toBe(2);
    });
  });

  describe('TTL and expiration', () => {
    it('should respect custom TTL parameter', async () => {
      const shortTtlCache = new StampedeProtectedCache<string>({
        maxSize: 100,
        defaultTtl: 5000, // 5 seconds default
      });

      // Use a very short custom TTL
      await shortTtlCache.get('test-key', mockLoader, 50); // 50ms TTL

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should be a miss now
      await shortTtlCache.get('test-key', mockLoader);

      expect(mockLoader).toHaveBeenCalledTimes(2);
    });

    it('should reload data after TTL expires', async () => {
      const veryShortTtlCache = new StampedeProtectedCache<string>({
        maxSize: 100,
        defaultTtl: 50, // 50ms
        staleWhileRevalidateTtl: 100,
        enableBackgroundRefresh: false, // Disable to test fresh fetch
      });

      await veryShortTtlCache.get('test-key', mockLoader);

      // Wait for TTL and stale TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      await veryShortTtlCache.get('test-key', mockLoader);

      expect(mockLoader).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should throw error when loader fails', async () => {
      const failingLoader: CacheLoader<string> = vi.fn(async () => {
        throw new Error('Load failed');
      });

      await expect(cache.get('test-key', failingLoader)).rejects.toThrow('Load failed');

      const stats = cache.getStats();
      expect(stats.refreshErrors).toBe(1);
    });

    it('should not cache failed loads', async () => {
      let callCount = 0;
      const intermittentLoader: CacheLoader<string> = vi.fn(async (key: string) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First call failed');
        }
        return `value-${key}`;
      });

      // First call should fail
      await expect(cache.get('test-key', intermittentLoader)).rejects.toThrow('First call failed');

      // Second call should succeed
      const result = await cache.get('test-key', intermittentLoader);
      expect(result).toBe('value-test-key');
      expect(intermittentLoader).toHaveBeenCalledTimes(2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used items when cache is full', async () => {
      const smallCache = new StampedeProtectedCache<string>({
        maxSize: 3,
        defaultTtl: 10000,
      });

      await smallCache.get('key1', mockLoader);
      await smallCache.get('key2', mockLoader);
      await smallCache.get('key3', mockLoader);

      expect(smallCache.size).toBe(3);

      // Adding a 4th item should evict key1
      await smallCache.get('key4', mockLoader);

      expect(smallCache.size).toBe(3);
      expect(smallCache.has('key1')).toBe(false);
      expect(smallCache.has('key4')).toBe(true);
    });
  });

  describe('invalidate method', () => {
    it('should invalidate a cache entry', async () => {
      await cache.get('test-key', mockLoader);
      expect(cache.has('test-key')).toBe(true);

      const invalidated = cache.invalidate('test-key');

      expect(invalidated).toBe(true);
      expect(cache.has('test-key')).toBe(false);
    });
  });

  describe('stale-while-revalidate', () => {
    it('should serve stale data and trigger background refresh', async () => {
      const staleCache = new StampedeProtectedCache<string>({
        maxSize: 100,
        defaultTtl: 50, // 50ms
        staleWhileRevalidateTtl: 200, // 200ms grace period
        enableBackgroundRefresh: true,
        minJitter: 1.0, // No jitter for predictable testing
        maxJitter: 1.0,
      });

      let loadCount = 0;
      const countingLoader: CacheLoader<string> = vi.fn(async (key: string) => {
        loadCount++;
        return `value-${key}-${loadCount}`;
      });

      // Initial load
      const result1 = await staleCache.get('test-key', countingLoader);
      expect(result1).toBe('value-test-key-1');

      // Wait for TTL to expire but still within stale TTL
      await new Promise((resolve) => setTimeout(resolve, 100));

      // This should serve stale data
      const result2 = await staleCache.get('test-key', countingLoader);
      expect(result2).toBe('value-test-key-1'); // Stale data

      const stats = staleCache.getStats();
      expect(stats.staleHits).toBeGreaterThanOrEqual(1);

      // Wait for background refresh to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Next call should have fresh data
      const result3 = await staleCache.get('test-key', countingLoader);
      expect(result3).toBe('value-test-key-2'); // Refreshed data
    });
  });
});

describe('StampedeProtectedCache with complex data types', () => {
  interface Position {
    symbol: string;
    quantity: number;
    avgPrice: number;
  }

  let cache: StampedeProtectedCache<Position[]>;
  let mockLoader: CacheLoader<Position[]>;

  beforeEach(() => {
    cache = new StampedeProtectedCache<Position[]>({
      maxSize: 50,
      defaultTtl: 1000,
    });

    mockLoader = vi.fn(async (accountId: string) => [
      { symbol: 'AAPL', quantity: 10, avgPrice: 150.0 },
      { symbol: 'GOOGL', quantity: 5, avgPrice: 2800.0 },
    ]);
  });

  it('should cache and retrieve complex objects', async () => {
    const positions = await cache.get('account123', mockLoader);

    expect(positions).toHaveLength(2);
    expect(positions[0].symbol).toBe('AAPL');
    expect(positions[1].symbol).toBe('GOOGL');
  });

  it('should handle empty arrays', async () => {
    const emptyLoader: CacheLoader<Position[]> = vi.fn(async () => []);

    const result = await cache.get('empty-account', emptyLoader);

    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });
});
