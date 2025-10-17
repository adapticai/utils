import { LRUCache } from 'lru-cache';


/**
 * Cache entry with metadata for stale-while-revalidate and probabilistic expiration
 *
 * @description Represents a single cached item with comprehensive metadata for cache stampede
 * prevention, including access tracking, expiration management, and refresh state monitoring.
 *
 * @rationale In high-frequency trading systems, cache stampedes can cause request bursts that
 * overwhelm market data APIs (Alpaca, Polygon) during periods of synchronized expiration,
 * leading to rate limiting and missed trading opportunities.
 *
 * @example
 * ```typescript
 * const entry: CacheEntry<MarketData> = {
 *   value: { price: 150.25, volume: 1000000 },
 *   createdAt: Date.now(),
 *   ttl: 60000,
 *   expiresAt: Date.now() + 60000,
 *   accessCount: 0,
 *   lastAccessedAt: Date.now(),
 *   isRefreshing: false
 * };
 * ```
 */
export interface CacheEntry<T> {
  /**
   * The cached value of type T
   * @description Stores the actual data retrieved from the source (e.g., market prices, positions)
   */
  value: T;

  /**
   * Timestamp when the entry was created (milliseconds since epoch)
   * @description Used to calculate entry age and determine if stale-while-revalidate is applicable
   */
  createdAt: number;

  /**
   * Time-to-live in milliseconds
   * @description Duration for which the entry is considered fresh. Range: 1000ms - 3600000ms (1s - 1hr)
   */
  ttl: number;

  /**
   * Timestamp when entry expires (createdAt + ttl)
   * @description Pre-calculated expiration timestamp for performance optimization
   */
  expiresAt: number;

  /**
   * Number of times this entry has been accessed
   * @description Tracks usage frequency for LRU eviction and performance analysis
   */
  accessCount: number;

  /**
   * Last access timestamp (milliseconds since epoch)
   * @description Used for cache statistics and to determine recently used entries
   */
  lastAccessedAt: number;

  /**
   * Whether this entry is currently being refreshed
   * @description Prevents duplicate refresh requests during stale-while-revalidate scenarios
   */
  isRefreshing: boolean;

  /**
   * Error that occurred during last refresh attempt
   * @description Stores error context for debugging failed market data fetches or API errors
   */
  lastError?: Error;
}

/**
 * Options for configuring the StampedeProtectedCache
 *
 * @description Configuration interface for initializing a stampede-protected cache with custom
 * TTL, size limits, jitter settings, and background refresh behavior.
 *
 * @rationale Trading systems require fine-tuned cache parameters to balance data freshness
 * with API rate limits. Different data types (positions vs quotes) have different staleness
 * tolerances and update frequencies.
 *
 * @example
 * ```typescript
 * const positionCacheOptions: StampedeProtectedCacheOptions = {
 *   maxSize: 1000,
 *   defaultTtl: 30000, // 30s for position data
 *   staleWhileRevalidateTtl: 60000, // 60s grace period
 *   minJitter: 0.9,
 *   maxJitter: 1.1,
 *   enableBackgroundRefresh: true,
 *   logger: pinoLogger
 * };
 * ```
 */
export interface StampedeProtectedCacheOptions {
  /**
   * Maximum number of entries in the cache
   * @description LRU eviction limit. Range: 10 - 100000. Recommended: 1000 for position data, 10000 for market data
   */
  maxSize: number;

  /**
   * Default TTL in milliseconds
   * @description How long entries remain fresh. Range: 1000ms - 3600000ms. Recommended: 30000ms (30s) for positions, 5000ms (5s) for quotes
   */
  defaultTtl: number;

  /**
   * Grace period for stale-while-revalidate in milliseconds
   * @description Extended TTL for serving stale data during refresh. Default: 2x defaultTtl. Range: defaultTtl - 600000ms
   */
  staleWhileRevalidateTtl?: number;

  /**
   * Minimum jitter percentage (e.g., 0.9 for 90%)
   * @description Lower bound of random TTL variance to prevent synchronized expiration. Range: 0.5 - 1.0. Default: 0.9
   */
  minJitter?: number;

  /**
   * Maximum jitter percentage (e.g., 1.1 for 110%)
   * @description Upper bound of random TTL variance. Range: 1.0 - 1.5. Default: 1.1
   */
  maxJitter?: number;

  /**
   * Whether to enable background refresh
   * @description If true, stale data is served while refreshing asynchronously. Default: true. Recommended for trading systems
   */
  enableBackgroundRefresh?: boolean;

  /**
   * Logger implementation for cache operations
   * @description Structured logger for debugging cache hits, misses, refreshes, and errors
   */
  logger?: {
    debug: (message: string, meta?: Record<string, unknown>) => void;
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Statistics for monitoring cache performance
 *
 * @description Comprehensive metrics for cache performance analysis, hit rate monitoring,
 * and identifying potential issues like stampedes or excessive misses.
 *
 * @rationale Trading systems require real-time performance monitoring to detect cache
 * degradation that could impact order execution latency or market data freshness.
 *
 * @example
 * ```typescript
 * const stats = cache.getStats();
 * if (stats.hitRatio < 0.8) {
 *   logger.warn('Low cache hit ratio', { hitRatio: stats.hitRatio });
 * }
 * if (stats.refreshErrors > 0) {
 *   logger.error('Cache refresh errors detected', { errors: stats.refreshErrors });
 * }
 * ```
 */
export interface CacheStats {
  /**
   * Total number of get operations
   * @description Cumulative count of all cache.get() calls since initialization or last reset
   */
  totalGets: number;

  /**
   * Number of cache hits
   * @description Count of fresh cache entries served without fetching from source
   */
  hits: number;

  /**
   * Number of cache misses
   * @description Count of requests requiring data fetch from source (API call)
   */
  misses: number;

  /**
   * Number of stale hits (served while revalidating)
   * @description Count of expired entries served during background refresh
   */
  staleHits: number;

  /**
   * Hit ratio (hits / totalGets)
   * @description Cache effectiveness metric. Range: 0.0 - 1.0. Target: >0.8 for optimal performance
   */
  hitRatio: number;

  /**
   * Current cache size
   * @description Number of entries currently stored in cache
   */
  size: number;

  /**
   * Maximum cache size
   * @description LRU eviction threshold from configuration
   */
  maxSize: number;

  /**
   * Number of entries currently being refreshed
   * @description Active background refresh operations (useful for detecting stuck refreshes)
   */
  activeRefreshes: number;

  /**
   * Number of coalesced requests
   * @description Count of duplicate simultaneous requests merged into single fetch (stampede prevention metric)
   */
  coalescedRequests: number;

  /**
   * Number of background refreshes performed
   * @description Count of successful stale-while-revalidate operations
   */
  backgroundRefreshes: number;

  /**
   * Number of errors during refresh
   * @description Count of failed data fetch attempts (API errors, timeouts, rate limits)
   */
  refreshErrors: number;
}

/**
 * Cache loader function type
 *
 * @description Function signature for loading data from source when cache miss occurs.
 * Should implement data fetching logic (API calls, database queries, etc.).
 *
 * @param key - Unique identifier for the data to load
 * @returns Promise resolving to the loaded data
 *
 * @throws Error if data fetch fails (network error, API error, timeout, rate limit)
 *
 * @example
 * ```typescript
 * const positionLoader: CacheLoader<AlpacaPosition[]> = async (accountId: string) => {
 *   const response = await alpacaApi.getPositions(accountId);
 *   return response.positions;
 * };
 * ```
 */
export type CacheLoader<T> = (key: string) => Promise<T>;

/**
 * StampedeProtectedCache provides three-layer protection against cache stampedes
 *
 * @description High-performance caching system implementing multiple stampede prevention
 * strategies to protect downstream services (market data APIs, position services) from
 * request bursts during synchronized cache expiration events.
 *
 * @rationale In algorithmic trading, cache stampedes can:
 * - Overwhelm market data APIs (Alpaca, Polygon) causing rate limiting (200 req/min limits)
 * - Introduce latency spikes during critical trading windows (market open/close)
 * - Trigger cascading failures when position data becomes unavailable
 * - Cause missed trading opportunities due to stale or unavailable data
 *
 * Three-layer protection:
 * 1. Request coalescing - Multiple concurrent requests for the same key share a single promise
 * 2. Stale-while-revalidate - Serve stale data while refreshing in background
 * 3. Probabilistic early expiration - Add jitter to prevent synchronized expiration
 *
 * @template T - Type of cached data (e.g., AlpacaPosition[], MarketQuote, AccountInfo)
 *
 * @example
 * ```typescript
 * // Initialize cache for position data
 * const positionCache = new StampedeProtectedCache<AlpacaPosition[]>({
 *   maxSize: 1000,
 *   defaultTtl: 30000, // 30 seconds
 *   staleWhileRevalidateTtl: 60000, // 60 seconds grace
 *   minJitter: 0.9,
 *   maxJitter: 1.1,
 *   enableBackgroundRefresh: true,
 *   logger: pinoLogger
 * });
 *
 * // Fetch with automatic caching and stampede protection
 * const positions = await positionCache.get(
 *   accountId,
 *   async (key) => await alpacaApi.getPositions(key)
 * );
 * ```
 *
 * @businessLogic
 * 1. On cache.get(), check for existing entry
 * 2. If found and fresh (< TTL with jitter): return cached value (HIT)
 * 3. If found but stale (< staleWhileRevalidateTtl): return stale value, trigger background refresh (STALE HIT)
 * 4. If not found or expired beyond grace period: fetch from source (MISS)
 * 5. During fetch, coalesce duplicate concurrent requests to single API call
 * 6. After successful fetch, cache result with jittered TTL to prevent synchronized expiration
 *
 * @auditTrail
 * - All cache operations logged with timestamps and metadata
 * - Statistics tracked: hits, misses, stale hits, coalesced requests, refresh errors
 * - Performance metrics exposed via getStats() for monitoring dashboards
 */
export class StampedeProtectedCache<T> {
  private readonly cache: LRUCache<string, CacheEntry<T>>;
  private readonly options: Required<StampedeProtectedCacheOptions>;
  private readonly pendingRefreshes = new Map<string, Promise<T>>();
  private readonly stats = {
    totalGets: 0,
    hits: 0,
    misses: 0,
    staleHits: 0,
    coalescedRequests: 0,
    backgroundRefreshes: 0,
    refreshErrors: 0,
  };

  constructor(options: StampedeProtectedCacheOptions) {
    this.options = {
      ...options,
      staleWhileRevalidateTtl: options.staleWhileRevalidateTtl ?? options.defaultTtl * 2,
      minJitter: options.minJitter ?? 0.9,
      maxJitter: options.maxJitter ?? 1.1,
      enableBackgroundRefresh: options.enableBackgroundRefresh ?? true,
      logger: options.logger ?? {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    this.cache = new LRUCache<string, CacheEntry<T>>({
      max: this.options.maxSize,
      ttl: undefined, // We manage TTL ourselves
      allowStale: true,
      updateAgeOnGet: false,
      updateAgeOnHas: false,
    });

    this.options.logger.info('StampedeProtectedCache initialized', {
      maxSize: this.options.maxSize,
      defaultTtl: this.options.defaultTtl,
      staleWhileRevalidateTtl: this.options.staleWhileRevalidateTtl,
      jitterRange: [this.options.minJitter, this.options.maxJitter],
    });
  }

  /**
   * Get a value from the cache, loading it if necessary
   *
   * @description Primary cache access method implementing three-layer stampede protection.
   * Returns cached data if fresh, serves stale data while refreshing if within grace period,
   * or fetches fresh data with request coalescing if expired.
   *
   * @param key - Unique cache key (e.g., accountId, symbol, "positions:ACCT123")
   * @param loader - Async function to load data on cache miss
   * @param ttl - Optional TTL override in milliseconds. If not provided, uses defaultTtl from config
   *
   * @returns Promise resolving to cached or freshly loaded data
   *
   * @throws Error if loader function fails and no stale data is available
   *
   * @example
   * ```typescript
   * // Get positions with default TTL
   * const positions = await cache.get(
   *   accountId,
   *   async (key) => await alpacaApi.getPositions(key)
   * );
   *
   * // Get market quote with custom TTL (5 seconds for real-time data)
   * const quote = await cache.get(
   *   `quote:${symbol}`,
   *   async (key) => await polygonApi.getQuote(symbol),
   *   5000
   * );
   * ```
   *
   * @businessLogic
   * 1. Increment totalGets counter for statistics
   * 2. Calculate effective TTL (custom or default)
   * 3. Attempt cache lookup by key
   * 4. If entry exists:
   *    a. Increment access count and update lastAccessedAt
   *    b. Apply probabilistic jitter to expiration time
   *    c. If still fresh (now < jitteredExpiresAt): return cached value (HIT)
   *    d. If stale but within grace period (now < staleExpiresAt) and not already refreshing:
   *       - Serve stale value immediately
   *       - Trigger background refresh if enabled
   *       - Return stale value (STALE HIT)
   * 5. If entry not found or expired beyond grace: load fresh data with coalescing (MISS)
   */
  async get(key: string, loader: CacheLoader<T>, ttl?: number): Promise<T> {
    this.stats.totalGets++;
    const effectiveTtl = ttl ?? this.options.defaultTtl;
    const now = Date.now();

    // Check if we have a cached entry
    const cached = this.cache.get(key);

    if (cached) {
      cached.accessCount++;
      cached.lastAccessedAt = now;

      // Check if entry is still fresh (considering probabilistic expiration)
      const jitteredExpiresAt = this.applyJitter(cached.expiresAt);

      if (now < jitteredExpiresAt) {
        // Fresh hit
        this.stats.hits++;
        this.options.logger.debug('Cache hit (fresh)', { key, age: now - cached.createdAt });
        return cached.value;
      }

      // Check if we can serve stale while revalidating
      const staleExpiresAt = cached.createdAt + this.options.staleWhileRevalidateTtl;

      if (now < staleExpiresAt && !cached.isRefreshing) {
        // Serve stale and trigger background refresh
        this.stats.staleHits++;
        this.options.logger.debug('Cache hit (stale-while-revalidate)', {
          key,
          age: now - cached.createdAt,
          staleAge: now - cached.expiresAt
        });

        if (this.options.enableBackgroundRefresh) {
          this.refreshInBackground(key, loader, effectiveTtl);
        }

        return cached.value;
      }
    }

    // Cache miss or expired - need to load
    this.stats.misses++;
    this.options.logger.debug('Cache miss', { key, hadCached: !!cached });

    return this.loadWithCoalescing(key, loader, effectiveTtl);
  }

  /**
   * Set a value in the cache
   *
   * @description Manually store a value in the cache with optional custom TTL.
   * Useful for pre-warming cache or storing computed results.
   *
   * @param key - Unique cache key
   * @param value - Data to cache
   * @param ttl - Optional TTL in milliseconds. If not provided, uses defaultTtl
   *
   * @returns void
   *
   * @example
   * ```typescript
   * // Pre-warm cache with known data
   * cache.set('positions:ACCT123', positions, 30000);
   *
   * // Cache computed result
   * const aggregatedData = computeAggregation(positions);
   * cache.set('aggregated:ACCT123', aggregatedData, 60000);
   * ```
   */
  set(key: string, value: T, ttl?: number): void {
    const effectiveTtl = ttl ?? this.options.defaultTtl;
    const now = Date.now();

    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      ttl: effectiveTtl,
      expiresAt: now + effectiveTtl,
      accessCount: 0,
      lastAccessedAt: now,
      isRefreshing: false,
    };

    this.cache.set(key, entry);
    this.options.logger.debug('Cache set', { key, ttl: effectiveTtl });
  }

  /**
   * Check if a key exists in the cache (regardless of expiration)
   *
   * @description Checks for cache entry existence without considering TTL or freshness.
   * Does not update access statistics or timestamps.
   *
   * @param key - Cache key to check
   *
   * @returns true if entry exists (fresh or stale), false otherwise
   *
   * @example
   * ```typescript
   * if (cache.has(accountId)) {
   *   // Entry exists, may be fresh or stale
   * }
   * ```
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a specific key from the cache
   *
   * @description Immediately removes cache entry and any pending refreshes for the key.
   * Useful for cache invalidation when source data changes.
   *
   * @param key - Cache key to delete
   *
   * @returns true if entry was deleted, false if key did not exist
   *
   * @example
   * ```typescript
   * // Invalidate after position update
   * await alpacaApi.submitOrder(order);
   * cache.delete(`positions:${accountId}`);
   * ```
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.options.logger.debug('Cache entry deleted', { key });
    }
    return deleted;
  }

  /**
   * Invalidate a key (alias for delete)
   *
   * @description Semantic alias for delete() method. Use for clarity when invalidating
   * cache after data mutations.
   *
   * @param key - Cache key to invalidate
   *
   * @returns true if entry was invalidated, false if key did not exist
   *
   * @example
   * ```typescript
   * // Invalidate after trade execution
   * cache.invalidate(`positions:${accountId}`);
   * ```
   */
  invalidate(key: string): boolean {
    return this.delete(key);
  }

  /**
   * Clear all entries from the cache
   *
   * @description Removes all cached entries and pending refreshes. Use during system
   * resets or configuration changes requiring fresh data.
   *
   * @returns void
   *
   * @example
   * ```typescript
   * // Clear cache during market hours transition
   * if (marketJustOpened) {
   *   cache.clear();
   * }
   * ```
   */
  clear(): void {
    const sizeBefore = this.cache.size;
    this.cache.clear();
    this.pendingRefreshes.clear();
    this.options.logger.info('Cache cleared', { entriesRemoved: sizeBefore });
  }

  /**
   * Get cache statistics
   *
   * @description Returns comprehensive performance metrics for monitoring and analysis.
   * Statistics include hit/miss ratios, active refreshes, coalesced requests, and errors.
   *
   * @returns CacheStats object with current performance metrics
   *
   * @example
   * ```typescript
   * const stats = cache.getStats();
   * logger.info('Cache performance', {
   *   hitRatio: stats.hitRatio,
   *   size: stats.size,
   *   activeRefreshes: stats.activeRefreshes
   * });
   *
   * // Alert on poor performance
   * if (stats.hitRatio < 0.7) {
   *   alerting.send('Low cache hit ratio', stats);
   * }
   * ```
   */
  getStats(): CacheStats {
    return {
      totalGets: this.stats.totalGets,
      hits: this.stats.hits,
      misses: this.stats.misses,
      staleHits: this.stats.staleHits,
      hitRatio: this.stats.totalGets > 0 ? this.stats.hits / this.stats.totalGets : 0,
      size: this.cache.size,
      maxSize: this.options.maxSize,
      activeRefreshes: this.pendingRefreshes.size,
      coalescedRequests: this.stats.coalescedRequests,
      backgroundRefreshes: this.stats.backgroundRefreshes,
      refreshErrors: this.stats.refreshErrors,
    };
  }

  /**
   * Get all cached keys
   *
   * @description Returns array of all cache keys currently stored, regardless of freshness.
   * Useful for debugging and cache inspection.
   *
   * @returns Array of cache keys
   *
   * @example
   * ```typescript
   * const keys = cache.keys();
   * console.log('Cached accounts:', keys);
   * // ['positions:ACCT123', 'positions:ACCT456', 'quote:AAPL']
   * ```
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get the size of the cache
   *
   * @description Returns current number of entries in cache. Compare to maxSize to
   * monitor capacity utilization.
   *
   * @returns Number of cached entries
   *
   * @example
   * ```typescript
   * const utilizationPct = (cache.size / cache.getStats().maxSize) * 100;
   * if (utilizationPct > 90) {
   *   logger.warn('Cache near capacity', { size: cache.size });
   * }
   * ```
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Load data with request coalescing to prevent duplicate requests
   */
  private async loadWithCoalescing(key: string, loader: CacheLoader<T>, ttl: number): Promise<T> {
    // Check if there's already a pending refresh for this key
    const existingPromise = this.pendingRefreshes.get(key);
    if (existingPromise) {
      this.stats.coalescedRequests++;
      this.options.logger.debug('Request coalesced', { key });
      return existingPromise;
    }

    // Create new promise and store it
    const promise = this.loadAndCache(key, loader, ttl);
    this.pendingRefreshes.set(key, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up the pending promise
      this.pendingRefreshes.delete(key);
    }
  }

  /**
   * Load data and cache it
   */
  private async loadAndCache(key: string, loader: CacheLoader<T>, ttl: number): Promise<T> {
    const startTime = Date.now();

    try {
      this.options.logger.debug('Loading data', { key });
      const value = await loader(key);

      // Cache the loaded value
      this.set(key, value, ttl);

      const loadTime = Date.now() - startTime;
      this.options.logger.debug('Data loaded and cached', { key, loadTime });

      return value;
    } catch (error) {
      this.stats.refreshErrors++;
      const loadTime = Date.now() - startTime;
      this.options.logger.error('Failed to load data', { key, error, loadTime });

      // Update cached entry with error if it exists
      const cached = this.cache.get(key);
      if (cached) {
        cached.lastError = error as Error;
        cached.isRefreshing = false;
      }

      throw error;
    }
  }

  /**
   * Refresh data in the background
   */
  private refreshInBackground(key: string, loader: CacheLoader<T>, ttl: number): void {
    // Mark the entry as refreshing
    const cached = this.cache.get(key);
    if (cached) {
      cached.isRefreshing = true;
    }

    // Don't wait for the refresh to complete
    this.loadWithCoalescing(key, loader, ttl)
      .then(() => {
        this.stats.backgroundRefreshes++;
        this.options.logger.debug('Background refresh completed', { key });
      })
      .catch((error) => {
        this.options.logger.warn('Background refresh failed', { key, error });
      })
      .finally(() => {
        // Mark as no longer refreshing
        const entry = this.cache.get(key);
        if (entry) {
          entry.isRefreshing = false;
        }
      });
  }

  /**
   * Apply probabilistic jitter to expiration time
   */
  private applyJitter(originalExpiresAt: number): number {
    const range = this.options.maxJitter - this.options.minJitter;
    const jitter = this.options.minJitter + (Math.random() * range);
    const createdAt = originalExpiresAt - this.options.defaultTtl;
    const jitteredTtl = this.options.defaultTtl * jitter;
    return createdAt + jitteredTtl;
  }

  /**
   * Reset statistics (useful for testing)
   *
   * @description Clears all performance counters to zero. Use for testing or when starting
   * fresh metrics collection period.
   *
   * @returns void
   *
   * @example
   * ```typescript
   * // Reset stats at start of trading day
   * cache.resetStats();
   * ```
   */
  resetStats(): void {
    this.stats.totalGets = 0;
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.staleHits = 0;
    this.stats.coalescedRequests = 0;
    this.stats.backgroundRefreshes = 0;
    this.stats.refreshErrors = 0;
  }
}

/**
 * Factory function to create a new StampedeProtectedCache instance
 *
 * @description Convenience factory for creating cache instances with type inference.
 * Alternative to using 'new StampedeProtectedCache<T>()'.
 *
 * @template T - Type of cached data
 * @param options - Cache configuration options
 *
 * @returns New StampedeProtectedCache instance
 *
 * @example
 * ```typescript
 * // Type is automatically inferred
 * const cache = createStampedeProtectedCache<AlpacaPosition[]>({
 *   maxSize: 1000,
 *   defaultTtl: 30000
 * });
 * ```
 */
export function createStampedeProtectedCache<T>(
  options: StampedeProtectedCacheOptions
): StampedeProtectedCache<T> {
  return new StampedeProtectedCache<T>(options);
}

/**
 * Default cache options for common use cases
 *
 * @description Production-tested default configuration suitable for most trading applications.
 * Provides balanced performance for position and market data caching.
 *
 * @rationale These defaults are optimized for:
 * - Position data refresh frequency (30-60s acceptable staleness)
 * - API rate limit protection (Alpaca: 200 req/min)
 * - Memory efficiency (1000 entries ≈ 10MB for typical position data)
 * - Stampede prevention (±10% jitter prevents synchronized expiration)
 *
 * @example
 * ```typescript
 * // Use defaults for quick setup
 * const cache = new StampedeProtectedCache({
 *   ...DEFAULT_CACHE_OPTIONS,
 *   logger: customLogger
 * });
 *
 * // Override specific settings
 * const realtimeCache = new StampedeProtectedCache({
 *   ...DEFAULT_CACHE_OPTIONS,
 *   defaultTtl: 5000, // 5s for real-time quotes
 *   maxSize: 10000
 * });
 * ```
 */
export const DEFAULT_CACHE_OPTIONS: StampedeProtectedCacheOptions = {
  maxSize: 1000,
  defaultTtl: 60000, // 1 minute
  staleWhileRevalidateTtl: 120000, // 2 minutes
  minJitter: 0.9, // 90%
  maxJitter: 1.1, // 110%
  enableBackgroundRefresh: true,
};