import { PortfolioHistory, BenchmarkBar, CalculateBetaResult } from './types/alpaca-types';
import { PerformanceMetrics, FetchPerformanceMetricsProps } from './types/metrics-types';
/**
 * Calculates the alpha, beta, and annualized Alpha of the portfolio compared to a benchmark.
 * @param portfolioHistory - The portfolio history data.
 * @param benchmarkBars - The historical price data of the benchmark.
 * @returns An object containing alpha, beta, and annualized alpha.
 */
export declare function calculateAlphaAndBeta(portfolioHistory: any, benchmarkBars: any[]): Promise<{
    alpha: string;
    alphaAnnualized: string;
    beta: string;
}>;
interface DrawdownResult {
    maxDrawdownPercentage: string;
    maxDrawdownValue: number;
    peakValue: number;
    troughValue: number;
    peakIndex: number;
    troughIndex: number;
    drawdownPeriod: number;
    recoveryIndex?: number;
    recoveryPeriod?: number;
    currentDrawdownPercentage: string;
}
/**
 * Calculates the Maximum Drawdown (MDD) and related metrics from an array of equity values.
 *
 * @param equity - An array of equity values (must contain at least one positive number)
 * @param options - Configuration options for the calculation
 * @returns Object containing drawdown metrics
 * @throws Will throw an error if the input is invalid
 */
export declare function calculateDrawdownMetrics(equity: number[], options?: {
    decimals?: number;
    minimumDrawdown?: number;
}): DrawdownResult;
/**
 * Simplified version that returns only the maximum drawdown percentage
 * For backward compatibility
 * @param equity - An array of equity values.
 * @param decimals - Number of decimal places for the percentage value.
 * @returns The maximum drawdown percentage as a string.
 */
export declare function calculateMaxDrawdown(equity: number[], decimals?: number): string;
/**
 * Calculates daily log returns for an array of prices.
 * Log returns are preferred for statistical properties.
 * @param prices - Array of prices.
 * @returns Array of daily log returns.
 */
export declare function calculateDailyReturns(prices: number[]): number[];
/**
 * Aligns portfolio and benchmark returns based on matching dates.
 * @param portfolioHistory - The portfolio history data.
 * @param benchmarkBars - The historical price data of the benchmark.
 * @returns An object containing aligned returns arrays.
 */
export declare function alignReturnsByDate(portfolioHistory: PortfolioHistory, benchmarkBars: BenchmarkBar[]): {
    alignedPortfolioReturns: number[];
    alignedBenchmarkReturns: number[];
};
/**
 * Calculates the beta of the portfolio compared to a benchmark.
 * @param portfolioReturns - Array of portfolio returns.
 * @param benchmarkReturns - Array of benchmark returns.
 * @returns An object containing beta and intermediate calculations.
 */
export declare function calculateBetaFromReturns(portfolioReturns: number[], benchmarkReturns: number[]): CalculateBetaResult;
/**
 * Calculates the information ratio of the portfolio compared to a benchmark.
 * @param portfolioHistory - The portfolio history data.
 * @param benchmarkBars - The historical price data of the benchmark.
 * @returns Information ratio as a formatted string.
 */
export declare function calculateInformationRatio(portfolioHistory: any, benchmarkBars: any[]): Promise<string>;
/**
 * Fetches performance metrics for a given Alpaca account.
 * @param params - The parameters for fetching performance metrics.
 * @param client - The Apollo client instance.
 * @param accountId - The ID of the Alpaca account.
 * @param alpacaAccount - The Alpaca account object.
 * @returns A promise that resolves to an object containing various performance metrics.
 * @throws Will throw an error if required parameters are missing or if fetching fails.
 */
export declare function fetchPerformanceMetrics({ params, client, accountId, alpacaAccount, }: FetchPerformanceMetricsProps): Promise<PerformanceMetrics>;
export {};
//# sourceMappingURL=performance-metrics.d.ts.map