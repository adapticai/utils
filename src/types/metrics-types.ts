import {
  ApolloClientType,
  NormalizedCacheObject,
} from "@adaptic/backend-legacy";
import { PortfolioHistoryParams } from "./alpaca-types";
import { types } from "@adaptic/backend-legacy";

export interface FetchPerformanceMetricsProps {
  params?: PortfolioHistoryParams;
  client?: ApolloClientType<NormalizedCacheObject>;
  accountId?: string;
  alpacaAccount?: Partial<types.AlpacaAccount>;
}

export interface PerformanceMetrics {
  totalReturnYTD: string;
  alpha: string;
  beta: string;
  alphaAnnualized: string;
  informationRatio: string;
  riskAdjustedReturn: string;
  liquidityRatio: string;
  expenseRatio: string;
  dividendYield: string;
  maxDrawdown: string;
}

export interface TradeMetrics {
  totalReturnYTD: string;
  alpha: string;
  beta: string;
  alphaAnnualized: string;
  informationRatio: string;
  riskAdjustedReturn: string;
  expenseRatio: string;
  maxDrawdown: string;
  /**
   * Position direction the direction-aware metrics were computed under.
   * `"N/A"` when the trade's primary action does not resolve to a long or a
   * short — in that case every direction-aware metric above is `"N/A"` too,
   * because their sign would otherwise be an assumption rather than a
   * measurement.
   */
  side: "long" | "short" | "N/A";
}
