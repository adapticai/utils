import { types } from "@adaptic/backend-legacy";
import { EquityPoint, AlpacaPortfolioHistory } from "./types/index";
import { MarketTimeUtil } from "./market-time";
export declare const computeTotalFees: (trade: types.Trade) => Promise<number>;
/**
 * Rounds price based on value:
 * - For prices >= $1, rounds to nearest $0.01
 * - For prices < $1, rounds to nearest $0.0001
 */
export declare function roundStockPrice(price: number): number;
export declare function getEquityValues(equityData: EquityPoint[], portfolioHistory?: AlpacaPortfolioHistory, marketTimeUtil?: MarketTimeUtil, period?: string): {
    latestEquity: number;
    initialEquity: number;
    latestTimestamp?: undefined;
    initialTimestamp?: undefined;
    baseValueAsOf?: undefined;
    baseValue?: undefined;
} | {
    latestEquity: number;
    initialEquity: number;
    latestTimestamp: import("lightweight-charts").Time;
    initialTimestamp: import("lightweight-charts").Time;
    baseValueAsOf: string | undefined;
    baseValue: number | undefined;
};
//# sourceMappingURL=price-utils.d.ts.map