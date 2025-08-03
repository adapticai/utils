import { DisplayManager } from './display-manager';
import { LogOptions } from './types/logging-types';

/**
 * Logs a message to the console.
 * @param message The message to log.
 * @param options Optional options.
 * @param options.source The source of the message.
 * @param options.type The type of message to log.
 * @param options.symbol The trading symbol associated with this log.
 * @param options.logToFile Force logging to a file even when no symbol is provided.
 */
export function log(message: string, options: LogOptions = { source: 'Server', type: 'info' }): void {
  const displayManager = DisplayManager.getInstance();
  displayManager.log(message, options);
}
