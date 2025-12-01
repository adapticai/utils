/**
 * Asset Allocation Algorithm Types
 *
 * Comprehensive type definitions for intelligent asset allocation
 * across multiple asset classes based on risk profile, market conditions,
 * and portfolio optimization principles.
 */
/**
 * Asset classes supported for allocation
 */
export type AllocationAssetClass = 'EQUITIES' | 'OPTIONS' | 'FUTURES' | 'ETF' | 'FOREX' | 'CRYPTO';
/**
 * Risk profile levels
 */
export type RiskProfile = 'CONSERVATIVE' | 'MODERATE_CONSERVATIVE' | 'MODERATE' | 'MODERATE_AGGRESSIVE' | 'AGGRESSIVE';
/**
 * Market condition states
 */
export type MarketCondition = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY' | 'CRISIS';
/**
 * User preferences for allocation
 */
export interface AllocationPreferences {
    /** Preferred asset classes (empty means all allowed) */
    preferredAssetClasses?: AllocationAssetClass[];
    /** Excluded asset classes */
    excludedAssetClasses?: AllocationAssetClass[];
    /** Minimum allocation per asset class (0-1) */
    minAllocationPerClass?: number;
    /** Maximum allocation per asset class (0-1) */
    maxAllocationPerClass?: number;
    /** Enable ESG/sustainable investing */
    esgFocused?: boolean;
    /** Target return (annualized %) */
    targetReturn?: number;
    /** Maximum acceptable drawdown (%) */
    maxDrawdown?: number;
    /** Rebalancing frequency in days */
    rebalancingFrequency?: number;
    /** Tax optimization enabled */
    taxOptimized?: boolean;
}
/**
 * Market condition metrics
 */
export interface MarketMetrics {
    /** VIX or volatility index level */
    volatilityIndex: number;
    /** Market trend direction */
    trendDirection: 'UP' | 'DOWN' | 'NEUTRAL';
    /** Market strength (0-100) */
    marketStrength: number;
    /** Fear & greed index (0-100) */
    sentimentScore: number;
    /** Interest rate environment */
    interestRateLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    /** Inflation rate (%) */
    inflationRate: number;
    /** Credit spread (basis points) */
    creditSpread: number;
    /** Economic cycle phase */
    economicPhase: 'EXPANSION' | 'PEAK' | 'CONTRACTION' | 'TROUGH';
}
/**
 * Asset class characteristics
 */
export interface AssetClassCharacteristics {
    /** Asset class identifier */
    assetClass: AllocationAssetClass;
    /** Historical volatility (annualized %) */
    volatility: number;
    /** Expected return (annualized %) */
    expectedReturn: number;
    /** Sharpe ratio */
    sharpeRatio: number;
    /** Maximum drawdown (%) */
    maxDrawdown: number;
    /** Liquidity score (0-100) */
    liquidityScore: number;
    /** Correlation with other asset classes */
    correlations: Map<AllocationAssetClass, number>;
    /** Current market cap or total value available */
    marketSize: number;
    /** Transaction costs (%) */
    transactionCost: number;
    /** Minimum investment required */
    minimumInvestment: number;
}
/**
 * Allocation constraint
 */
export interface AllocationConstraint {
    /** Constraint type */
    type: 'MIN_ALLOCATION' | 'MAX_ALLOCATION' | 'SECTOR_LIMIT' | 'LIQUIDITY_REQ' | 'CORRELATION_LIMIT' | 'CONCENTRATION_LIMIT';
    /** Asset class affected */
    assetClass?: AllocationAssetClass;
    /** Constraint value */
    value: number;
    /** Constraint priority (1=highest) */
    priority: number;
    /** Hard constraint (must be satisfied) or soft (preference) */
    hard: boolean;
}
/**
 * Allocation result for a single asset class
 */
export interface AssetAllocation {
    /** Asset class */
    assetClass: AllocationAssetClass;
    /** Allocation percentage (0-1) */
    allocation: number;
    /** Allocation amount in currency units */
    amount: number;
    /** Risk contribution to portfolio */
    riskContribution: number;
    /** Expected return contribution */
    returnContribution: number;
    /** Rationale for allocation */
    rationale: string;
    /** Confidence level (0-1) */
    confidence: number;
}
/**
 * Complete allocation recommendation
 */
export interface AllocationRecommendation {
    /** Unique recommendation ID */
    id: string;
    /** Individual asset allocations */
    allocations: AssetAllocation[];
    /** Total portfolio metrics */
    portfolioMetrics: PortfolioMetrics;
    /** Risk analysis */
    riskAnalysis: RiskAnalysis;
    /** Diversification metrics */
    diversification: DiversificationMetrics;
    /** Rebalancing recommendations */
    rebalancing?: RebalancingAction[];
    /** Allocation timestamp */
    timestamp: Date;
    /** Next rebalancing date */
    nextRebalancingDate: Date;
    /** Allocation methodology used */
    methodology: string;
    /** Warnings or caveats */
    warnings: string[];
}
/**
 * Portfolio-level metrics
 */
export interface PortfolioMetrics {
    /** Expected annual return (%) */
    expectedReturn: number;
    /** Expected volatility (%) */
    expectedVolatility: number;
    /** Sharpe ratio */
    sharpeRatio: number;
    /** Sortino ratio */
    sortinoRatio: number;
    /** Maximum drawdown (%) */
    maxDrawdown: number;
    /** Value at Risk 95% (%) */
    valueAtRisk95: number;
    /** Conditional VaR (Expected Shortfall) */
    conditionalVaR: number;
    /** Beta to market */
    beta: number;
    /** Alpha generation potential */
    alpha: number;
    /** Information ratio */
    informationRatio: number;
}
/**
 * Risk analysis breakdown
 */
export interface RiskAnalysis {
    /** Overall risk score (0-100) */
    riskScore: number;
    /** Risk level classification */
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    /** Systematic risk (market risk) */
    systematicRisk: number;
    /** Idiosyncratic risk (specific risk) */
    idiosyncraticRisk: number;
    /** Tail risk assessment */
    tailRisk: number;
    /** Liquidity risk score */
    liquidityRisk: number;
    /** Concentration risk */
    concentrationRisk: number;
    /** Currency risk */
    currencyRisk: number;
    /** Risk decomposition by asset class */
    riskDecomposition: Map<AllocationAssetClass, number>;
}
/**
 * Diversification metrics
 */
export interface DiversificationMetrics {
    /** Diversification ratio (higher is better) */
    diversificationRatio: number;
    /** Herfindahl-Hirschman Index (lower is better) */
    herfindahlIndex: number;
    /** Effective number of positions */
    effectiveNumberOfAssets: number;
    /** Average correlation between assets */
    averageCorrelation: number;
    /** Maximum pairwise correlation */
    maxPairwiseCorrelation: number;
    /** Correlation matrix */
    correlationMatrix: number[][];
    /** Asset class diversity score (0-100) */
    assetClassDiversity: number;
}
/**
 * Rebalancing action
 */
export interface RebalancingAction {
    /** Asset class to rebalance */
    assetClass: AllocationAssetClass;
    /** Current allocation */
    currentAllocation: number;
    /** Target allocation */
    targetAllocation: number;
    /** Action to take */
    action: 'BUY' | 'SELL' | 'HOLD';
    /** Amount to trade */
    tradeAmount: number;
    /** Priority (1=highest) */
    priority: number;
    /** Estimated cost */
    estimatedCost: number;
    /** Tax impact estimate */
    taxImpact?: number;
    /** Reason for rebalancing */
    reason: string;
}
/**
 * Allocation algorithm inputs
 */
export interface AllocationInput {
    /** User's risk profile */
    riskProfile?: RiskProfile;
    /** Current market conditions */
    marketConditions: MarketMetrics;
    /** Total account size */
    accountSize: number;
    /** Current positions (if any) */
    currentPositions?: Map<AllocationAssetClass, number>;
    /** User preferences */
    preferences?: AllocationPreferences;
    /** Asset class characteristics */
    assetCharacteristics: AssetClassCharacteristics[];
    /** Additional constraints */
    constraints?: AllocationConstraint[];
    /** Historical performance data (optional) */
    historicalData?: Map<AllocationAssetClass, HistoricalData>;
}
/**
 * Historical performance data
 */
export interface HistoricalData {
    /** Asset class */
    assetClass: AllocationAssetClass;
    /** Historical returns (time series) */
    returns: number[];
    /** Historical volatility measurements */
    volatilities: number[];
    /** Timestamps for data points */
    timestamps: Date[];
    /** Correlation history with other assets */
    correlationHistory?: Map<AllocationAssetClass, number[]>;
}
/**
 * Optimization objective
 */
export type OptimizationObjective = 'MAX_RETURN' | 'MIN_RISK' | 'MAX_SHARPE' | 'RISK_PARITY' | 'MAX_DIVERSIFICATION' | 'TARGET_RETURN' | 'TARGET_RISK';
/**
 * Allocation strategy configuration
 */
export interface AllocationStrategyConfig {
    /** Optimization objective */
    objective: OptimizationObjective;
    /** Risk-free rate for calculations */
    riskFreeRate: number;
    /** Rebalancing threshold (%) */
    rebalancingThreshold: number;
    /** Transaction cost model */
    transactionCostModel: 'FIXED' | 'PERCENTAGE' | 'TIERED';
    /** Tax consideration */
    taxRate?: number;
    /** Time horizon (years) */
    timeHorizon: number;
    /** Use leverage */
    allowLeverage: boolean;
    /** Maximum leverage ratio */
    maxLeverage?: number;
    /** Include alternative assets */
    includeAlternatives: boolean;
}
/**
 * Risk-adjusted allocation parameters
 */
export interface RiskAdjustedParameters {
    /** Conservative allocation bias */
    conservativeBias: number;
    /** Volatility scaling factor */
    volatilityScaling: number;
    /** Drawdown penalty weight */
    drawdownPenalty: number;
    /** Liquidity premium */
    liquidityPremium: number;
    /** Correlation penalty */
    correlationPenalty: number;
}
/**
 * Default risk profiles with typical allocations
 */
export interface DefaultRiskProfile {
    profile: RiskProfile;
    description: string;
    baseAllocations: Map<AllocationAssetClass, number>;
    maxVolatility: number;
    maxDrawdown: number;
    targetReturn: number;
    riskScore: number;
}
//# sourceMappingURL=asset-allocation-types.d.ts.map