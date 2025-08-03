import chalk from 'chalk';
import { clearLine, cursorTo, moveCursor } from 'readline';
import { LogOptions } from './types/logging-types';
import * as fs from 'fs';
import * as path from 'path';

export class DisplayManager {
  private static instance: DisplayManager;
  private promptText: string = '';

  private constructor() {}

  public static getInstance(): DisplayManager {
    if (!DisplayManager.instance) {
      DisplayManager.instance = new DisplayManager();
    }
    return DisplayManager.instance;
  }

  public setPrompt(prompt: string): void {
    this.promptText = prompt;
  }

  /**
   * Logs a message while preserving the prompt at the bottom
   */
  public log(message: string, options?: LogOptions): void {
    // Clear the current prompt line
    clearLine(process.stdout, 0);
    cursorTo(process.stdout, 0);

    // Format the timestamp
    const date = new Date();
    const timestamp = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const account = options?.account;
    const symbol = options?.symbol;
    
    // Build the log message
    let logMessage = `[${timestamp}]${options?.source ? ` [${options.source}] ` : ''}${account ? ` [${account}] ` : ''}${symbol ? ` [${symbol}] ` : ''}${message}`;

    // Add color based on type
    if (options?.type === 'error') {
      logMessage = chalk.red(logMessage);
    } else if (options?.type === 'warn') {
      logMessage = chalk.yellow(logMessage);
    }

    // Write the log message
    process.stdout.write(logMessage + '\n');

    // Log to file
    if (symbol) {
      // Log to symbol-specific file if symbol is provided
      this.writeSymbolLog(symbol, date, logMessage, options);
    } else if (options?.logToFile) {
      // Log to a generic file if explicitly requested
      this.writeGenericLog(date, logMessage, options);
    }

    // Rewrite the prompt
    this.writePrompt();
  }

  /**
   * Writes a log entry to a symbol-specific log file
   */
  private writeSymbolLog(symbol: string, date: Date, logMessage: string, options?: LogOptions): void {
    try {
      // Create logs directory if it doesn't exist
      if (!fs.existsSync('logs')) {
        fs.mkdirSync('logs', { recursive: true });
      }

      // Format date for filename: YYYY-MM-DD
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      // Create filename: SYM-YYYY-MM-DD.log
      const filename = `${symbol}-${year}-${month}-${day}.log`;
      const filePath = path.join('logs', filename);
      
      // Strip ANSI color codes from log message
      const plainLogMessage = logMessage.replace(/\x1B\[\d+m/g, '');
      
      // Write to file (append if exists, create if not)
      fs.appendFileSync(filePath, plainLogMessage + '\n');
    } catch (error) {
      // Only log to console - don't try to log to file again to avoid potential infinite loop
      process.stdout.write(`Error writing to symbol log file: ${error}\n`);
    }
  }

  /**
   * Writes a log entry to a generic log file when no symbol is provided
   */
  private writeGenericLog(date: Date, logMessage: string, options?: LogOptions): void {
    try {
      // Create logs directory if it doesn't exist
      if (!fs.existsSync('logs')) {
        fs.mkdirSync('logs', { recursive: true });
      }

      // Format date for filename: YYYY-MM-DD
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      // Create filename: system-YYYY-MM-DD.log
      const source = options?.source?.toLowerCase().replace(/\s+/g, '-') || 'system';
      const filename = `${source}-${year}-${month}-${day}.log`;
      const filePath = path.join('logs', filename);
      
      // Strip ANSI color codes from log message
      const plainLogMessage = logMessage.replace(/\x1B\[\d+m/g, '');
      
      // Write to file (append if exists, create if not)
      fs.appendFileSync(filePath, plainLogMessage + '\n');
    } catch (error) {
      // Only log to console - don't try to log to file again to avoid potential infinite loop
      process.stdout.write(`Error writing to generic log file: ${error}\n`);
    }
  }

  private writePrompt(): void {
    process.stdout.write(this.promptText);
  }

  public clearPrompt(): void {
    clearLine(process.stdout, 0);
    cursorTo(process.stdout, 0);
  }

  public restorePrompt(): void {
    this.writePrompt();
  }
} 