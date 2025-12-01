import { ApolloClientType, NormalizedCacheObject } from '@adaptic/backend-legacy';
import { PortfolioHistoryParams } from './alpaca-types';
import { types } from '@adaptic/backend-legacy';
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
    side: string;
}
//# sourceMappingURL=metrics-types.d.ts.map