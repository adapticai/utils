/**
 * Intelligent Asset Allocation Algorithm
 *
 * Determines optimal asset allocation across multiple asset classes based on:
 * - User risk profile
 * - Market conditions
 * - Account size
 * - User preferences
 * - Modern Portfolio Theory principles
 * - Risk-adjusted returns
 * - Diversification optimization
 */
import { RiskProfile, AllocationInput, AllocationRecommendation, AllocationStrategyConfig, DefaultRiskProfile } from './types/asset-allocation-types';
/**
 * Asset Allocation Engine
 *
 * Implements sophisticated portfolio optimization using:
 * - Mean-variance optimization
 * - Risk parity approach
 * - Black-Litterman model influences
 * - Correlation-based diversification
 * - Dynamic risk adjustment
 */
export declare class AssetAllocationEngine {
    private config;
    private readonly defaultConfig;
    /**
     * Default risk profiles with typical asset class allocations
     */
    private readonly defaultRiskProfiles;
    constructor(config?: AllocationStrategyConfig);
    /**
     * Generate optimal asset allocation recommendation
     */
    generateAllocation(input: AllocationInput): Promise<AllocationRecommendation>;
    /**
     * Infer risk profile from account characteristics
     */
    private inferRiskProfile;
    /**
     * Assess current market condition
     */
    private assessMarketCondition;
    /**
     * Get base allocations from risk profile
     */
    private getBaseAllocations;
    /**
     * Adjust allocations based on market conditions
     */
    private adjustForMarketConditions;
    /**
     * Scale allocation for a specific asset class
     */
    private scaleAllocation;
    /**
     * Normalize allocations to sum to 1.0
     */
    private normalizeAllocations;
    /**
     * Apply user constraints and preferences
     */
    private applyConstraints;
    /**
     * Optimize allocations using specified objective
     */
    private optimizeAllocations;
    /**
     * Maximize Sharpe ratio allocation
     */
    private maximizeSharpeRatio;
    /**
     * Minimize portfolio risk
     */
    private minimizeRisk;
    /**
     * Maximize expected return
     */
    private maximizeReturn;
    /**
     * Risk parity allocation (equal risk contribution)
     */
    private riskParityAllocation;
    /**
     * Maximize diversification
     */
    private maximizeDiversification;
    /**
     * Calculate comprehensive portfolio metrics
     */
    private calculatePortfolioMetrics;
    /**
     * Perform comprehensive risk analysis
     */
    private performRiskAnalysis;
    /**
     * Calculate diversification metrics
     */
    private calculateDiversification;
    /**
     * Generate rebalancing actions
     */
    private generateRebalancingActions;
    /**
     * Build detailed asset allocations
     */
    private buildAssetAllocations;
    /**
     * Generate rationale for asset allocation
     */
    private generateAllocationRationale;
    /**
     * Calculate next rebalancing date
     */
    private calculateNextRebalancingDate;
    /**
     * Get methodology description
     */
    private getMethodologyDescription;
    /**
     * Generate warnings based on allocation
     */
    private generateWarnings;
    /**
     * Generate unique recommendation ID
     */
    private generateRecommendationId;
}
/**
 * Convenience function to generate allocation with default settings
 */
export declare function generateOptimalAllocation(input: AllocationInput, config?: Partial<AllocationStrategyConfig>): Promise<AllocationRecommendation>;
/**
 * Convenience function to get default risk profile characteristics
 */
export declare function getDefaultRiskProfile(profile: RiskProfile): DefaultRiskProfile | undefined;
//# sourceMappingURL=asset-allocation-algorithm.d.ts.map