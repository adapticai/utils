/**
 * Configurable logger interface compatible with Pino and other logging libraries.
 * Provides structured logging with context support.
 */

export interface Logger {
  error(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  debug(message: string, context?: unknown): void;
}

/**
 * Normalizes context to a format suitable for logging.
 * Handles various types including primitives, objects, and errors.
 */
function normalizeContext(context: unknown): Record<string, unknown> | undefined {
  if (context === undefined || context === null) {
    return undefined;
  }

  if (typeof context === 'object' && context !== null) {
    // Handle Error objects
    if (context instanceof Error) {
      return {
        error: {
          message: context.message,
          name: context.name,
          stack: context.stack,
        },
      };
    }

    // Already an object, return as-is
    return context as Record<string, unknown>;
  }

  // Primitive types - wrap in object
  return { value: context };
}

/**
 * Default logger implementation that uses console for backward compatibility.
 * Formats messages in a simple readable format.
 */
const defaultLogger: Logger = {
  error: (msg, ctx) => console.error(msg, normalizeContext(ctx) || ''),
  warn: (msg, ctx) => console.warn(msg, normalizeContext(ctx) || ''),
  info: (msg, ctx) => console.info(msg, normalizeContext(ctx) || ''),
  debug: (msg, ctx) => console.debug(msg, normalizeContext(ctx) || ''),
};

let currentLogger: Logger = defaultLogger;

/**
 * Sets a custom logger implementation.
 * Call this to integrate with Pino or other logging libraries.
 *
 * @param logger - The logger implementation to use
 *
 * @example
 * ```typescript
 * import pino from 'pino';
 * import { setLogger } from '@adaptic/utils';
 *
 * const pinoLogger = pino();
 *
 * setLogger({
 *   error: (msg, ctx) => pinoLogger.error(ctx, msg),
 *   warn: (msg, ctx) => pinoLogger.warn(ctx, msg),
 *   info: (msg, ctx) => pinoLogger.info(ctx, msg),
 *   debug: (msg, ctx) => pinoLogger.debug(ctx, msg),
 * });
 * ```
 */
export function setLogger(logger: Logger): void {
  currentLogger = logger;
}

/**
 * Gets the current logger instance.
 * Use this to log messages throughout the application.
 *
 * @returns The current logger instance
 *
 * @example
 * ```typescript
 * import { getLogger } from '@adaptic/utils';
 *
 * const logger = getLogger();
 * logger.error('Operation failed', { userId: 123, operation: 'createOrder' });
 * logger.warn('Rate limit approaching', { remaining: 10 });
 * logger.info('Order created', { orderId: 'abc123', symbol: 'AAPL' });
 * logger.debug('Cache hit', { key: 'user:123' });
 * ```
 */
export function getLogger(): Logger {
  return currentLogger;
}

/**
 * Resets the logger to the default console-based implementation.
 * Useful for testing or cleanup.
 */
export function resetLogger(): void {
  currentLogger = defaultLogger;
}
