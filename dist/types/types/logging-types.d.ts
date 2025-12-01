export type LogType = 'info' | 'warn' | 'error' | 'debug' | 'major' | 'table' | 'system' | 'cost';
export interface LogOptions {
    source?: string;
    type?: LogType;
    account?: string;
    metadata?: Record<string, any>;
    symbol?: string;
    logToFile?: boolean;
}
//# sourceMappingURL=logging-types.d.ts.map