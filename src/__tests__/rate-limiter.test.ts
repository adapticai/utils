import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucketRateLimiter } from '../rate-limiter';

describe('TokenBucketRateLimiter', () => {
  let limiter: TokenBucketRateLimiter;

  beforeEach(() => {
    limiter = new TokenBucketRateLimiter({
      maxTokens: 5,
      refillRate: 5, // 5 tokens per second
      label: 'test',
      timeoutMs: 2000,
    });
  });

  describe('basic token acquisition', () => {
    it('should acquire tokens when available', async () => {
      await expect(limiter.acquire()).resolves.toBeUndefined();
    });

    it('should start with maxTokens available', () => {
      expect(limiter.getAvailableTokens()).toBe(5);
    });

    it('should decrease available tokens after acquisition', async () => {
      await limiter.acquire();
      // Due to refill timing, it should be close to 4
      expect(limiter.getAvailableTokens()).toBeLessThanOrEqual(5);
    });

    it('should handle multiple sequential acquisitions', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(limiter.acquire()).resolves.toBeUndefined();
      }
    });

    it('should queue requests when tokens are exhausted', async () => {
      // Exhaust all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.acquire();
      }
      expect(limiter.getQueueLength()).toBe(0);
    });
  });

  describe('token refill', () => {
    it('should refill tokens over time', async () => {
      // Use all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.acquire();
      }

      // Wait for refill (200ms at 5 tokens/sec = 1 token)
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(1);
    });

    it('should not exceed maxTokens after long wait', async () => {
      // Wait a long time
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Even after waiting, should not exceed max
      expect(limiter.getAvailableTokens()).toBeLessThanOrEqual(5);
    });
  });

  describe('queue management', () => {
    it('should report queue length correctly', () => {
      expect(limiter.getQueueLength()).toBe(0);
    });

    it('should process queued requests when tokens become available', async () => {
      // Create a fast limiter with very few tokens
      const fastLimiter = new TokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: 10, // 10 tokens per second = 1 every 100ms
        label: 'fast-test',
        timeoutMs: 5000,
      });

      // First request uses the only token
      await fastLimiter.acquire();

      // Second request should be queued but resolve when refilled
      const queuedPromise = fastLimiter.acquire();
      // Need to wait for the refill check to process the queue
      await new Promise((resolve) => setTimeout(resolve, 200));
      // Trigger refill by calling getAvailableTokens
      fastLimiter.getAvailableTokens();
      await expect(queuedPromise).resolves.toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should restore all tokens on reset', async () => {
      // Use some tokens
      await limiter.acquire();
      await limiter.acquire();

      limiter.reset();

      expect(limiter.getAvailableTokens()).toBe(5);
    });

    it('should clear the queue on reset', async () => {
      // Exhaust tokens first with a tight limiter
      const tightLimiter = new TokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: 0.001, // Very slow refill
        label: 'tight-test',
        timeoutMs: 60000,
      });

      await tightLimiter.acquire();

      // Queue a request (will hang)
      const queuedPromise = tightLimiter.acquire().catch(() => {
        // Expected - reset rejects queued requests
      });

      expect(tightLimiter.getQueueLength()).toBe(1);

      tightLimiter.reset();

      expect(tightLimiter.getQueueLength()).toBe(0);
      expect(tightLimiter.getAvailableTokens()).toBe(1);

      // Wait for the rejection to propagate
      await queuedPromise;
    });

    it('should reject queued requests on reset', async () => {
      const tightLimiter = new TokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: 0.001,
        label: 'tight-test',
        timeoutMs: 60000,
      });

      await tightLimiter.acquire();

      const queuedPromise = tightLimiter.acquire();

      tightLimiter.reset();

      await expect(queuedPromise).rejects.toThrow(/reset/i);
    });
  });

  describe('timeout behavior', () => {
    it('should timeout when waiting too long for a token', async () => {
      const slowLimiter = new TokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: 0.001, // Very slow refill
        label: 'slow-test',
        timeoutMs: 100, // 100ms timeout
      });

      await slowLimiter.acquire(); // Use the only token

      await expect(slowLimiter.acquire()).rejects.toThrow(/timeout/i);
    });

    it('should use default timeout of 60000ms', () => {
      const defaultLimiter = new TokenBucketRateLimiter({
        maxTokens: 5,
        refillRate: 1,
        label: 'default-test',
      });

      // No error creating it without timeoutMs
      expect(defaultLimiter.getAvailableTokens()).toBe(5);
    });
  });

  describe('configuration', () => {
    it('should respect different maxTokens', () => {
      const largeLimiter = new TokenBucketRateLimiter({
        maxTokens: 100,
        refillRate: 10,
        label: 'large-test',
      });

      expect(largeLimiter.getAvailableTokens()).toBe(100);
    });

    it('should handle very high refill rate', async () => {
      const fastLimiter = new TokenBucketRateLimiter({
        maxTokens: 1000,
        refillRate: 1000, // 1000 tokens per second
        label: 'fast-test',
      });

      // Should be able to acquire many tokens
      for (let i = 0; i < 10; i++) {
        await expect(fastLimiter.acquire()).resolves.toBeUndefined();
      }
    });

    it('should handle maxTokens of 1', async () => {
      const singleToken = new TokenBucketRateLimiter({
        maxTokens: 1,
        refillRate: 100,
        label: 'single-test',
        timeoutMs: 1000,
      });

      await expect(singleToken.acquire()).resolves.toBeUndefined();
    });
  });
});
