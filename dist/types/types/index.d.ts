import { Time } from "lightweight-charts";
export * from './alpaca-types';
export * from './market-time-types';
export * from './polygon-types';
export * from './polygon-indices-types';
export * from './alphavantage-types';
export * from './adaptic-types';
export * from './ta-types';
export * from './metrics-types';
export interface EquityPoint {
    time: Time;
    value: number;
}
export interface AlpacaPortfolioHistory {
    timestamp: number[];
    equity: number[];
    base_value: number;
    base_value_asof?: string;
    timeframe: string;
}
//# sourceMappingURL=index.d.ts.map