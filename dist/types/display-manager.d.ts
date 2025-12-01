import { LogOptions } from './types/logging-types';
export declare class DisplayManager {
    private static instance;
    private promptText;
    private constructor();
    static getInstance(): DisplayManager;
    setPrompt(prompt: string): void;
    /**
     * Logs a message while preserving the prompt at the bottom
     */
    log(message: string, options?: LogOptions): void;
    /**
     * Writes a log entry to a symbol-specific log file
     */
    private writeSymbolLog;
    /**
     * Writes a log entry to a generic log file when no symbol is provided
     */
    private writeGenericLog;
    private writePrompt;
    clearPrompt(): void;
    restorePrompt(): void;
}
//# sourceMappingURL=display-manager.d.ts.map