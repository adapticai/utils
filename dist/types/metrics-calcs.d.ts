import { Bar, BenchmarkBar } from "./types/alpaca-types";
import { types } from "@adaptic/backend-legacy";
import { CalculateBetaResult, TradeMetrics } from "./types";
export declare function calculateBetaFromReturns(portfolioReturns: number[], benchmarkReturns: number[]): CalculateBetaResult;
export default function fetchTradeMetrics(trade: types.Trade, tradeBars: Bar[], benchmarkBars: BenchmarkBar[]): Promise<TradeMetrics>;
//# sourceMappingURL=metrics-calcs.d.ts.map