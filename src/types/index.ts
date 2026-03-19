import { Time } from "lightweight-charts";
export * from "./adaptic-types";
export * from "./alpaca-types";
export * from "./alphavantage-types";
export * from "./market-time-types";
export * from "./massive-indices-types";
export * from "./massive-types";
export * from "./metrics-types";
export * from "./ta-types";

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
