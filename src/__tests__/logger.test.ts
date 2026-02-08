import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setLogger, getLogger, resetLogger } from '../logger';
import type { Logger } from '../logger';

describe('Logger', () => {
  beforeEach(() => {
    resetLogger();
  });

  describe('getLogger', () => {
    it('should return a logger instance', () => {
      const logger = getLogger();

      expect(logger).toBeDefined();
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should return the default logger initially', () => {
      const logger = getLogger();

      // Default logger should not throw when called
      expect(() => logger.info('test message')).not.toThrow();
    });
  });

  describe('setLogger', () => {
    it('should replace the default logger', () => {
      const mockLogger: Logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      };

      setLogger(mockLogger);

      const logger = getLogger();
      logger.info('test message');

      expect(mockLogger.info).toHaveBeenCalledWith('test message');
    });

    it('should pass context to custom logger', () => {
      const mockLogger: Logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      };

      setLogger(mockLogger);

      const context = { userId: 123 };
      const logger = getLogger();
      logger.info('test message', context);

      expect(mockLogger.info).toHaveBeenCalledWith('test message', context);
    });

    it('should call correct log level methods', () => {
      const mockLogger: Logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      };

      setLogger(mockLogger);
      const logger = getLogger();

      logger.error('error msg');
      logger.warn('warn msg');
      logger.info('info msg');
      logger.debug('debug msg');

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetLogger', () => {
    it('should restore the default logger', () => {
      const mockLogger: Logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      };

      setLogger(mockLogger);
      resetLogger();

      const logger = getLogger();
      logger.info('after reset');

      // Mock should not be called after reset
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should not throw when called multiple times', () => {
      expect(() => {
        resetLogger();
        resetLogger();
        resetLogger();
      }).not.toThrow();
    });
  });

  describe('default logger behavior', () => {
    it('should handle string context', () => {
      const logger = getLogger();
      expect(() => logger.info('test', 'context string')).not.toThrow();
    });

    it('should handle object context', () => {
      const logger = getLogger();
      expect(() => logger.info('test', { key: 'value' })).not.toThrow();
    });

    it('should handle Error context', () => {
      const logger = getLogger();
      const error = new Error('test error');
      expect(() => logger.error('test', error)).not.toThrow();
    });

    it('should handle undefined context', () => {
      const logger = getLogger();
      expect(() => logger.info('test', undefined)).not.toThrow();
    });

    it('should handle null context', () => {
      const logger = getLogger();
      expect(() => logger.info('test', null)).not.toThrow();
    });

    it('should handle numeric context', () => {
      const logger = getLogger();
      expect(() => logger.info('test', 42)).not.toThrow();
    });

    it('should handle no context argument', () => {
      const logger = getLogger();
      expect(() => logger.info('test')).not.toThrow();
    });
  });
});
