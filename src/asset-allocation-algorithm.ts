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

import {
  AllocationAssetClass,
  RiskProfile,
  MarketCondition,
  AllocationInput,
  AllocationRecommendation,
  AssetAllocation,
  PortfolioMetrics,
  RiskAnalysis,
  DiversificationMetrics,
  RebalancingAction,
  AllocationStrategyConfig,
  OptimizationObjective,
  AssetClassCharacteristics,
  MarketMetrics,
  AllocationPreferences,
  AllocationConstraint,
  DefaultRiskProfile,
  RiskAdjustedParameters
} from './types/asset-allocation-types';

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
export class AssetAllocationEngine {
  private readonly defaultConfig: AllocationStrategyConfig = {
    objective: 'MAX_SHARPE',
    riskFreeRate: 0.04, // 4% risk-free rate
    rebalancingThreshold: 5, // 5% drift threshold
    transactionCostModel: 'PERCENTAGE',
    timeHorizon: 5, // 5 year horizon
    allowLeverage: false,
    includeAlternatives: true
  };

  /**
   * Default risk profiles with typical asset class allocations
   */
  private readonly defaultRiskProfiles: Map<RiskProfile, DefaultRiskProfile> = new Map([
    [
      'CONSERVATIVE',
      {
        profile: 'CONSERVATIVE',
        description: 'Capital preservation focused with minimal volatility',
        baseAllocations: new Map<AllocationAssetClass, number>([
          ['EQUITIES', 0.20],
          ['OPTIONS', 0.05],
          ['FUTURES', 0.00],
          ['ETF', 0.50],
          ['FOREX', 0.10],
          ['CRYPTO', 0.00]
        ]),
        maxVolatility: 8,
        maxDrawdown: 10,
        targetReturn: 5,
        riskScore: 20
      }
    ],
    [
      'MODERATE_CONSERVATIVE',
      {
        profile: 'MODERATE_CONSERVATIVE',
        description: 'Income focused with moderate growth potential',
        baseAllocations: new Map<AllocationAssetClass, number>([
          ['EQUITIES', 0.30],
          ['OPTIONS', 0.10],
          ['FUTURES', 0.05],
          ['ETF', 0.40],
          ['FOREX', 0.10],
          ['CRYPTO', 0.05]
        ]),
        maxVolatility: 12,
        maxDrawdown: 15,
        targetReturn: 7,
        riskScore: 35
      }
    ],
    [
      'MODERATE',
      {
        profile: 'MODERATE',
        description: 'Balanced growth and income with managed volatility',
        baseAllocations: new Map<AllocationAssetClass, number>([
          ['EQUITIES', 0.40],
          ['OPTIONS', 0.15],
          ['FUTURES', 0.10],
          ['ETF', 0.25],
          ['FOREX', 0.05],
          ['CRYPTO', 0.05]
        ]),
        maxVolatility: 15,
        maxDrawdown: 20,
        targetReturn: 10,
        riskScore: 50
      }
    ],
    [
      'MODERATE_AGGRESSIVE',
      {
        profile: 'MODERATE_AGGRESSIVE',
        description: 'Growth focused with higher volatility tolerance',
        baseAllocations: new Map<AllocationAssetClass, number>([
          ['EQUITIES', 0.50],
          ['OPTIONS', 0.20],
          ['FUTURES', 0.10],
          ['ETF', 0.10],
          ['FOREX', 0.05],
          ['CRYPTO', 0.05]
        ]),
        maxVolatility: 20,
        maxDrawdown: 25,
        targetReturn: 13,
        riskScore: 70
      }
    ],
    [
      'AGGRESSIVE',
      {
        profile: 'AGGRESSIVE',
        description: 'Maximum growth with high volatility acceptance',
        baseAllocations: new Map<AllocationAssetClass, number>([
          ['EQUITIES', 0.45],
          ['OPTIONS', 0.25],
          ['FUTURES', 0.15],
          ['ETF', 0.05],
          ['FOREX', 0.05],
          ['CRYPTO', 0.05]
        ]),
        maxVolatility: 30,
        maxDrawdown: 35,
        targetReturn: 18,
        riskScore: 85
      }
    ]
  ]);

  constructor(private config: AllocationStrategyConfig = {} as AllocationStrategyConfig) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Generate optimal asset allocation recommendation
   */
  public async generateAllocation(input: AllocationInput): Promise<AllocationRecommendation> {
    // Step 1: Determine risk profile if not provided
    const riskProfile = input.riskProfile || this.inferRiskProfile(input);

    // Step 2: Assess market conditions
    const marketCondition = this.assessMarketCondition(input.marketConditions);

    // Step 3: Get base allocations from risk profile
    const baseAllocations = this.getBaseAllocations(riskProfile);

    // Step 4: Adjust allocations based on market conditions
    const marketAdjustedAllocations = this.adjustForMarketConditions(
      baseAllocations,
      marketCondition,
      input.marketConditions
    );

    // Step 5: Apply user preferences and constraints
    const constrainedAllocations = this.applyConstraints(
      marketAdjustedAllocations,
      input.preferences,
      input.constraints,
      input.assetCharacteristics
    );

    // Step 6: Optimize allocations using selected objective
    const optimizedAllocations = this.optimizeAllocations(
      constrainedAllocations,
      input.assetCharacteristics,
      input.accountSize,
      riskProfile
    );

    // Step 7: Calculate portfolio metrics
    const portfolioMetrics = this.calculatePortfolioMetrics(
      optimizedAllocations,
      input.assetCharacteristics
    );

    // Step 8: Perform risk analysis
    const riskAnalysis = this.performRiskAnalysis(
      optimizedAllocations,
      input.assetCharacteristics,
      riskProfile
    );

    // Step 9: Calculate diversification metrics
    const diversification = this.calculateDiversification(
      optimizedAllocations,
      input.assetCharacteristics
    );

    // Step 10: Generate rebalancing recommendations if current positions exist
    const rebalancing = input.currentPositions
      ? this.generateRebalancingActions(
          input.currentPositions,
          optimizedAllocations,
          input.accountSize
        )
      : undefined;

    // Step 11: Build allocation recommendation
    const recommendation: AllocationRecommendation = {
      id: this.generateRecommendationId(),
      allocations: this.buildAssetAllocations(
        optimizedAllocations,
        input.accountSize,
        input.assetCharacteristics,
        portfolioMetrics,
        riskProfile
      ),
      portfolioMetrics,
      riskAnalysis,
      diversification,
      rebalancing,
      timestamp: new Date(),
      nextRebalancingDate: this.calculateNextRebalancingDate(
        input.preferences?.rebalancingFrequency
      ),
      methodology: this.getMethodologyDescription(this.config.objective, riskProfile),
      warnings: this.generateWarnings(optimizedAllocations, riskAnalysis, input)
    };

    return recommendation;
  }

  /**
   * Infer risk profile from account characteristics
   */
  private inferRiskProfile(input: AllocationInput): RiskProfile {
    let riskScore = 50; // Start at moderate

    // Adjust based on account size
    if (input.accountSize < 10000) {
      riskScore -= 10; // Smaller accounts tend to be more conservative
    } else if (input.accountSize > 100000) {
      riskScore += 10; // Larger accounts can take more risk
    }

    // Adjust based on preferences
    if (input.preferences?.maxDrawdown) {
      if (input.preferences.maxDrawdown < 15) riskScore -= 15;
      else if (input.preferences.maxDrawdown > 25) riskScore += 15;
    }

    if (input.preferences?.targetReturn) {
      if (input.preferences.targetReturn < 6) riskScore -= 10;
      else if (input.preferences.targetReturn > 12) riskScore += 10;
    }

    // Adjust based on excluded asset classes (conservative if many excluded)
    if (input.preferences?.excludedAssetClasses) {
      riskScore -= input.preferences.excludedAssetClasses.length * 5;
    }

    // Map score to profile
    if (riskScore < 30) return 'CONSERVATIVE';
    if (riskScore < 45) return 'MODERATE_CONSERVATIVE';
    if (riskScore < 60) return 'MODERATE';
    if (riskScore < 75) return 'MODERATE_AGGRESSIVE';
    return 'AGGRESSIVE';
  }

  /**
   * Assess current market condition
   */
  private assessMarketCondition(metrics: MarketMetrics): MarketCondition {
    // High volatility check
    if (metrics.volatilityIndex > 30) {
      return 'HIGH_VOLATILITY';
    }

    // Low volatility check
    if (metrics.volatilityIndex < 12) {
      return 'LOW_VOLATILITY';
    }

    // Crisis detection
    if (
      metrics.volatilityIndex > 40 ||
      metrics.sentimentScore < 20 ||
      metrics.creditSpread > 500
    ) {
      return 'CRISIS';
    }

    // Bull market
    if (
      metrics.trendDirection === 'UP' &&
      metrics.marketStrength > 60 &&
      metrics.sentimentScore > 60
    ) {
      return 'BULL';
    }

    // Bear market
    if (
      metrics.trendDirection === 'DOWN' &&
      metrics.marketStrength < 40 &&
      metrics.sentimentScore < 40
    ) {
      return 'BEAR';
    }

    // Default to sideways
    return 'SIDEWAYS';
  }

  /**
   * Get base allocations from risk profile
   */
  private getBaseAllocations(riskProfile: RiskProfile): Map<AllocationAssetClass, number> {
    const profile = this.defaultRiskProfiles.get(riskProfile);
    if (!profile) {
      throw new Error(`Unknown risk profile: ${riskProfile}`);
    }
    return new Map(profile.baseAllocations);
  }

  /**
   * Adjust allocations based on market conditions
   */
  private adjustForMarketConditions(
    baseAllocations: Map<AllocationAssetClass, number>,
    condition: MarketCondition,
    metrics: MarketMetrics
  ): Map<AllocationAssetClass, number> {
    const adjusted = new Map(baseAllocations);

    switch (condition) {
      case 'CRISIS':
        // Shift to defensive assets
        this.scaleAllocation(adjusted, 'EQUITIES', 0.5);
        this.scaleAllocation(adjusted, 'OPTIONS', 0.3);
        this.scaleAllocation(adjusted, 'FUTURES', 0.2);
        this.scaleAllocation(adjusted, 'ETF', 1.5);
        this.scaleAllocation(adjusted, 'CRYPTO', 0.1);
        break;

      case 'HIGH_VOLATILITY':
        // Reduce volatile assets
        this.scaleAllocation(adjusted, 'OPTIONS', 0.7);
        this.scaleAllocation(adjusted, 'FUTURES', 0.7);
        this.scaleAllocation(adjusted, 'CRYPTO', 0.5);
        this.scaleAllocation(adjusted, 'ETF', 1.2);
        break;

      case 'LOW_VOLATILITY':
        // Can take more risk
        this.scaleAllocation(adjusted, 'EQUITIES', 1.1);
        this.scaleAllocation(adjusted, 'OPTIONS', 1.2);
        this.scaleAllocation(adjusted, 'CRYPTO', 1.3);
        break;

      case 'BULL':
        // Increase growth assets
        this.scaleAllocation(adjusted, 'EQUITIES', 1.2);
        this.scaleAllocation(adjusted, 'OPTIONS', 1.1);
        this.scaleAllocation(adjusted, 'CRYPTO', 1.2);
        this.scaleAllocation(adjusted, 'ETF', 0.9);
        break;

      case 'BEAR':
        // Defensive positioning
        this.scaleAllocation(adjusted, 'EQUITIES', 0.7);
        this.scaleAllocation(adjusted, 'OPTIONS', 0.8);
        this.scaleAllocation(adjusted, 'CRYPTO', 0.6);
        this.scaleAllocation(adjusted, 'ETF', 1.3);
        this.scaleAllocation(adjusted, 'FOREX', 1.2);
        break;

      case 'SIDEWAYS':
        // Favor income and options strategies
        this.scaleAllocation(adjusted, 'OPTIONS', 1.2);
        this.scaleAllocation(adjusted, 'EQUITIES', 0.95);
        break;
    }

    // Additional adjustments based on specific metrics
    if (metrics.inflationRate > 4) {
      // High inflation - favor real assets
      this.scaleAllocation(adjusted, 'CRYPTO', 1.1);
      this.scaleAllocation(adjusted, 'ETF', 0.9);
    }

    if (metrics.interestRateLevel === 'HIGH') {
      // High rates - favor fixed income and reduce growth
      this.scaleAllocation(adjusted, 'EQUITIES', 0.9);
      this.scaleAllocation(adjusted, 'ETF', 1.1);
    }

    // Normalize to sum to 1.0
    return this.normalizeAllocations(adjusted);
  }

  /**
   * Scale allocation for a specific asset class
   */
  private scaleAllocation(
    allocations: Map<AllocationAssetClass, number>,
    assetClass: AllocationAssetClass,
    scaleFactor: number
  ): void {
    const current = allocations.get(assetClass) || 0;
    allocations.set(assetClass, current * scaleFactor);
  }

  /**
   * Normalize allocations to sum to 1.0
   */
  private normalizeAllocations(allocations: Map<AllocationAssetClass, number>): Map<AllocationAssetClass, number> {
    const total = Array.from(allocations.values()).reduce((sum, val) => sum + val, 0);

    if (total === 0) {
      // Equal weight if all zeros
      const assetCount = allocations.size;
      allocations.forEach((_, key) => allocations.set(key, 1 / assetCount));
      return allocations;
    }

    const normalized = new Map<AllocationAssetClass, number>();
    allocations.forEach((value, key) => {
      normalized.set(key, value / total);
    });

    return normalized;
  }

  /**
   * Apply user constraints and preferences
   */
  private applyConstraints(
    allocations: Map<AllocationAssetClass, number>,
    preferences?: AllocationPreferences,
    constraints?: AllocationConstraint[],
    characteristics?: AssetClassCharacteristics[]
  ): Map<AllocationAssetClass, number> {
    const constrained = new Map(allocations);

    // Apply exclusions
    if (preferences?.excludedAssetClasses) {
      preferences.excludedAssetClasses.forEach(asset => {
        constrained.set(asset, 0);
      });
    }

    // Apply preferred asset classes
    if (preferences?.preferredAssetClasses && preferences.preferredAssetClasses.length > 0) {
      // Zero out non-preferred assets
      constrained.forEach((_, asset) => {
        if (!preferences.preferredAssetClasses!.includes(asset)) {
          constrained.set(asset, 0);
        }
      });
    }

    // Apply min/max per class
    if (preferences?.minAllocationPerClass !== undefined) {
      constrained.forEach((value, asset) => {
        if (value > 0 && value < preferences.minAllocationPerClass!) {
          constrained.set(asset, preferences.minAllocationPerClass!);
        }
      });
    }

    if (preferences?.maxAllocationPerClass !== undefined) {
      constrained.forEach((value, asset) => {
        if (value > preferences.maxAllocationPerClass!) {
          constrained.set(asset, preferences.maxAllocationPerClass!);
        }
      });
    }

    // Apply specific constraints
    if (constraints) {
      constraints.forEach(constraint => {
        if (constraint.assetClass) {
          const current = constrained.get(constraint.assetClass) || 0;

          switch (constraint.type) {
            case 'MIN_ALLOCATION':
              if (current < constraint.value && constraint.hard) {
                constrained.set(constraint.assetClass, constraint.value);
              }
              break;

            case 'MAX_ALLOCATION':
              if (current > constraint.value) {
                constrained.set(constraint.assetClass, constraint.value);
              }
              break;
          }
        }
      });
    }

    // Re-normalize after constraint application
    return this.normalizeAllocations(constrained);
  }

  /**
   * Optimize allocations using specified objective
   */
  private optimizeAllocations(
    allocations: Map<AllocationAssetClass, number>,
    characteristics: AssetClassCharacteristics[],
    accountSize: number,
    riskProfile: RiskProfile
  ): Map<AllocationAssetClass, number> {
    const charMap = new Map(characteristics.map(c => [c.assetClass, c]));

    switch (this.config.objective) {
      case 'MAX_SHARPE':
        return this.maximizeSharpeRatio(allocations, charMap);

      case 'MIN_RISK':
        return this.minimizeRisk(allocations, charMap);

      case 'MAX_RETURN':
        return this.maximizeReturn(allocations, charMap, riskProfile);

      case 'RISK_PARITY':
        return this.riskParityAllocation(allocations, charMap);

      case 'MAX_DIVERSIFICATION':
        return this.maximizeDiversification(allocations, charMap);

      default:
        return allocations;
    }
  }

  /**
   * Maximize Sharpe ratio allocation
   */
  private maximizeSharpeRatio(
    allocations: Map<AllocationAssetClass, number>,
    characteristics: Map<AllocationAssetClass, AssetClassCharacteristics>
  ): Map<AllocationAssetClass, number> {
    const optimized = new Map<AllocationAssetClass, number>();

    // Calculate excess returns (return - risk-free rate)
    const excessReturns = new Map<AllocationAssetClass, number>();
    allocations.forEach((_, asset) => {
      const char = characteristics.get(asset);
      if (char) {
        const excessReturn = char.expectedReturn - this.config.riskFreeRate * 100;
        excessReturns.set(asset, excessReturn);
      }
    });

    // Weight by Sharpe ratio (simplified)
    let totalSharpe = 0;
    const sharpeRatios = new Map<AllocationAssetClass, number>();

    allocations.forEach((_, asset) => {
      const char = characteristics.get(asset);
      if (char && char.volatility > 0) {
        const sharpe = (excessReturns.get(asset) || 0) / char.volatility;
        sharpeRatios.set(asset, Math.max(0, sharpe)); // Only positive sharpe
        totalSharpe += Math.max(0, sharpe);
      }
    });

    // Allocate proportional to Sharpe ratio
    if (totalSharpe > 0) {
      sharpeRatios.forEach((sharpe, asset) => {
        optimized.set(asset, sharpe / totalSharpe);
      });
    } else {
      // Fall back to equal weight
      const count = allocations.size;
      allocations.forEach((_, asset) => {
        optimized.set(asset, 1 / count);
      });
    }

    // Blend with original allocations (50/50 blend)
    const blended = new Map<AllocationAssetClass, number>();
    allocations.forEach((originalWeight, asset) => {
      const optimizedWeight = optimized.get(asset) || 0;
      blended.set(asset, 0.5 * originalWeight + 0.5 * optimizedWeight);
    });

    return this.normalizeAllocations(blended);
  }

  /**
   * Minimize portfolio risk
   */
  private minimizeRisk(
    allocations: Map<AllocationAssetClass, number>,
    characteristics: Map<AllocationAssetClass, AssetClassCharacteristics>
  ): Map<AllocationAssetClass, number> {
    const optimized = new Map<AllocationAssetClass, number>();

    // Weight inversely to volatility
    let totalInvVol = 0;
    const invVolatilities = new Map<AllocationAssetClass, number>();

    allocations.forEach((_, asset) => {
      const char = characteristics.get(asset);
      if (char && char.volatility > 0) {
        const invVol = 1 / char.volatility;
        invVolatilities.set(asset, invVol);
        totalInvVol += invVol;
      }
    });

    // Allocate proportional to inverse volatility
    if (totalInvVol > 0) {
      invVolatilities.forEach((invVol, asset) => {
        optimized.set(asset, invVol / totalInvVol);
      });
    } else {
      const count = allocations.size;
      allocations.forEach((_, asset) => {
        optimized.set(asset, 1 / count);
      });
    }

    // Blend with original
    const blended = new Map<AllocationAssetClass, number>();
    allocations.forEach((originalWeight, asset) => {
      const optimizedWeight = optimized.get(asset) || 0;
      blended.set(asset, 0.6 * optimizedWeight + 0.4 * originalWeight);
    });

    return this.normalizeAllocations(blended);
  }

  /**
   * Maximize expected return
   */
  private maximizeReturn(
    allocations: Map<AllocationAssetClass, number>,
    characteristics: Map<AllocationAssetClass, AssetClassCharacteristics>,
    riskProfile: RiskProfile
  ): Map<AllocationAssetClass, number> {
    const profile = this.defaultRiskProfiles.get(riskProfile);
    if (!profile) return allocations;

    const optimized = new Map<AllocationAssetClass, number>();

    // Weight by expected return, but cap by volatility constraint
    let totalAdjustedReturn = 0;
    const adjustedReturns = new Map<AllocationAssetClass, number>();

    allocations.forEach((_, asset) => {
      const char = characteristics.get(asset);
      if (char) {
        // Penalize high volatility assets
        const volatilityPenalty = char.volatility > profile.maxVolatility
          ? 0.5
          : 1.0;

        const adjustedReturn = char.expectedReturn * volatilityPenalty;
        adjustedReturns.set(asset, Math.max(0, adjustedReturn));
        totalAdjustedReturn += Math.max(0, adjustedReturn);
      }
    });

    // Allocate proportional to adjusted returns
    if (totalAdjustedReturn > 0) {
      adjustedReturns.forEach((adjReturn, asset) => {
        optimized.set(asset, adjReturn / totalAdjustedReturn);
      });
    } else {
      const count = allocations.size;
      allocations.forEach((_, asset) => {
        optimized.set(asset, 1 / count);
      });
    }

    // Blend with original
    const blended = new Map<AllocationAssetClass, number>();
    allocations.forEach((originalWeight, asset) => {
      const optimizedWeight = optimized.get(asset) || 0;
      blended.set(asset, 0.5 * optimizedWeight + 0.5 * originalWeight);
    });

    return this.normalizeAllocations(blended);
  }

  /**
   * Risk parity allocation (equal risk contribution)
   */
  private riskParityAllocation(
    allocations: Map<AllocationAssetClass, number>,
    characteristics: Map<AllocationAssetClass, AssetClassCharacteristics>
  ): Map<AllocationAssetClass, number> {
    // Simplified risk parity: weight inversely to volatility
    return this.minimizeRisk(allocations, characteristics);
  }

  /**
   * Maximize diversification
   */
  private maximizeDiversification(
    allocations: Map<AllocationAssetClass, number>,
    characteristics: Map<AllocationAssetClass, AssetClassCharacteristics>
  ): Map<AllocationAssetClass, number> {
    const optimized = new Map<AllocationAssetClass, number>();

    // Calculate average correlation for each asset
    const avgCorrelations = new Map<AllocationAssetClass, number>();

    allocations.forEach((_, asset) => {
      const char = characteristics.get(asset);
      if (char && char.correlations) {
        let sumCorr = 0;
        let count = 0;

        char.correlations.forEach((corr, _) => {
          sumCorr += Math.abs(corr);
          count++;
        });

        const avgCorr = count > 0 ? sumCorr / count : 0.5;
        avgCorrelations.set(asset, avgCorr);
      }
    });

    // Weight inversely to average correlation
    let totalInvCorr = 0;
    const invCorrelations = new Map<AllocationAssetClass, number>();

    avgCorrelations.forEach((avgCorr, asset) => {
      const invCorr = 1 / (0.1 + avgCorr); // Add small constant to avoid division by zero
      invCorrelations.set(asset, invCorr);
      totalInvCorr += invCorr;
    });

    // Allocate proportional to inverse correlation
    if (totalInvCorr > 0) {
      invCorrelations.forEach((invCorr, asset) => {
        optimized.set(asset, invCorr / totalInvCorr);
      });
    } else {
      const count = allocations.size;
      allocations.forEach((_, asset) => {
        optimized.set(asset, 1 / count);
      });
    }

    // Blend with original
    const blended = new Map<AllocationAssetClass, number>();
    allocations.forEach((originalWeight, asset) => {
      const optimizedWeight = optimized.get(asset) || 0;
      blended.set(asset, 0.5 * optimizedWeight + 0.5 * originalWeight);
    });

    return this.normalizeAllocations(blended);
  }

  /**
   * Calculate comprehensive portfolio metrics
   */
  private calculatePortfolioMetrics(
    allocations: Map<AllocationAssetClass, number>,
    characteristics: AssetClassCharacteristics[]
  ): PortfolioMetrics {
    const charMap = new Map(characteristics.map(c => [c.assetClass, c]));

    let expectedReturn = 0;
    let portfolioVariance = 0;

    // Calculate expected return
    allocations.forEach((weight, asset) => {
      const char = charMap.get(asset);
      if (char) {
        expectedReturn += weight * char.expectedReturn;
      }
    });

    // Calculate portfolio variance (simplified - assumes correlations)
    const assetList = Array.from(allocations.keys());
    for (let i = 0; i < assetList.length; i++) {
      for (let j = 0; j < assetList.length; j++) {
        const asset1 = assetList[i];
        const asset2 = assetList[j];
        const w1 = allocations.get(asset1) || 0;
        const w2 = allocations.get(asset2) || 0;
        const char1 = charMap.get(asset1);
        const char2 = charMap.get(asset2);

        if (char1 && char2) {
          const vol1 = char1.volatility / 100; // Convert from percentage
          const vol2 = char2.volatility / 100;

          let correlation = 1.0;
          if (i !== j) {
            correlation = char1.correlations?.get(asset2) ?? 0.3; // Default correlation
          }

          portfolioVariance += w1 * w2 * vol1 * vol2 * correlation;
        }
      }
    }

    const expectedVolatility = Math.sqrt(portfolioVariance) * 100; // Convert to percentage

    // Calculate Sharpe ratio
    const excessReturn = expectedReturn - this.config.riskFreeRate * 100;
    const sharpeRatio = expectedVolatility > 0 ? excessReturn / expectedVolatility : 0;

    // Calculate Sortino ratio (simplified - using volatility as proxy)
    const downsideDeviation = expectedVolatility * 0.7; // Rough approximation
    const sortinoRatio = downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;

    // Estimate maximum drawdown (rough approximation)
    const maxDrawdown = expectedVolatility * 1.5;

    // VaR and CVaR (parametric approach, 95% confidence)
    const valueAtRisk95 = 1.645 * expectedVolatility;
    const conditionalVaR = 2.063 * expectedVolatility; // 95% CVaR

    // Beta and Alpha (simplified)
    const beta = 1.0; // Assume market beta for now
    const alpha = expectedReturn - (this.config.riskFreeRate * 100 + beta * 6); // Assume 6% market risk premium

    // Information ratio
    const trackingError = expectedVolatility * 0.5;
    const informationRatio = trackingError > 0 ? alpha / trackingError : 0;

    return {
      expectedReturn,
      expectedVolatility,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      valueAtRisk95,
      conditionalVaR,
      beta,
      alpha,
      informationRatio
    };
  }

  /**
   * Perform comprehensive risk analysis
   */
  private performRiskAnalysis(
    allocations: Map<AllocationAssetClass, number>,
    characteristics: AssetClassCharacteristics[],
    riskProfile: RiskProfile
  ): RiskAnalysis {
    const charMap = new Map(characteristics.map(c => [c.assetClass, c]));
    const profile = this.defaultRiskProfiles.get(riskProfile)!;

    // Calculate portfolio volatility
    let totalVolatility = 0;
    allocations.forEach((weight, asset) => {
      const char = charMap.get(asset);
      if (char) {
        totalVolatility += weight * char.volatility;
      }
    });

    // Risk score (0-100)
    const riskScore = Math.min(100, (totalVolatility / profile.maxVolatility) * 100);

    // Risk level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    if (riskScore < 40) riskLevel = 'LOW';
    else if (riskScore < 60) riskLevel = 'MEDIUM';
    else if (riskScore < 80) riskLevel = 'HIGH';
    else riskLevel = 'EXTREME';

    // Systematic vs idiosyncratic risk (simplified)
    const systematicRisk = totalVolatility * 0.7; // 70% systematic
    const idiosyncraticRisk = totalVolatility * 0.3; // 30% idiosyncratic

    // Tail risk (simplified - higher volatility = higher tail risk)
    const tailRisk = totalVolatility * 1.2;

    // Liquidity risk
    let liquidityRisk = 0;
    allocations.forEach((weight, asset) => {
      const char = charMap.get(asset);
      if (char) {
        liquidityRisk += weight * (100 - char.liquidityScore);
      }
    });

    // Concentration risk (HHI)
    let hhi = 0;
    allocations.forEach(weight => {
      hhi += weight * weight;
    });
    const concentrationRisk = hhi * 100;

    // Currency risk (simplified)
    const forexWeight = allocations.get('FOREX') || 0;
    const cryptoWeight = allocations.get('CRYPTO') || 0;
    const currencyRisk = (forexWeight + cryptoWeight) * 50;

    // Risk decomposition by asset class
    const riskDecomposition = new Map<AllocationAssetClass, number>();
    let totalRiskContribution = 0;

    allocations.forEach((weight, asset) => {
      const char = charMap.get(asset);
      if (char) {
        const riskContribution = weight * char.volatility;
        riskDecomposition.set(asset, riskContribution);
        totalRiskContribution += riskContribution;
      }
    });

    // Normalize risk contributions
    if (totalRiskContribution > 0) {
      riskDecomposition.forEach((contrib, asset) => {
        riskDecomposition.set(asset, (contrib / totalRiskContribution) * 100);
      });
    }

    return {
      riskScore,
      riskLevel,
      systematicRisk,
      idiosyncraticRisk,
      tailRisk,
      liquidityRisk,
      concentrationRisk,
      currencyRisk,
      riskDecomposition
    };
  }

  /**
   * Calculate diversification metrics
   */
  private calculateDiversification(
    allocations: Map<AllocationAssetClass, number>,
    characteristics: AssetClassCharacteristics[]
  ): DiversificationMetrics {
    const charMap = new Map(characteristics.map(c => [c.assetClass, c]));

    // Herfindahl-Hirschman Index (concentration measure)
    let hhi = 0;
    allocations.forEach(weight => {
      hhi += weight * weight;
    });

    // Effective number of assets
    const effectiveNumberOfAssets = hhi > 0 ? 1 / hhi : allocations.size;

    // Average correlation
    let sumCorrelations = 0;
    let correlationCount = 0;
    let maxCorr = 0;

    const assetList = Array.from(allocations.keys());
    for (let i = 0; i < assetList.length; i++) {
      for (let j = i + 1; j < assetList.length; j++) {
        const asset1 = assetList[i];
        const asset2 = assetList[j];
        const char1 = charMap.get(asset1);

        if (char1?.correlations) {
          const corr = Math.abs(char1.correlations.get(asset2) ?? 0.3);
          sumCorrelations += corr;
          correlationCount++;
          maxCorr = Math.max(maxCorr, corr);
        }
      }
    }

    const averageCorrelation = correlationCount > 0 ? sumCorrelations / correlationCount : 0;

    // Diversification ratio (weighted average vol / portfolio vol)
    let weightedAvgVol = 0;
    let portfolioVar = 0;

    allocations.forEach((weight, asset) => {
      const char = charMap.get(asset);
      if (char) {
        weightedAvgVol += weight * char.volatility;
      }
    });

    // Calculate portfolio variance
    for (let i = 0; i < assetList.length; i++) {
      for (let j = 0; j < assetList.length; j++) {
        const asset1 = assetList[i];
        const asset2 = assetList[j];
        const w1 = allocations.get(asset1) || 0;
        const w2 = allocations.get(asset2) || 0;
        const char1 = charMap.get(asset1);
        const char2 = charMap.get(asset2);

        if (char1 && char2) {
          const vol1 = char1.volatility / 100;
          const vol2 = char2.volatility / 100;
          const corr = i === j ? 1.0 : (char1.correlations?.get(asset2) ?? 0.3);
          portfolioVar += w1 * w2 * vol1 * vol2 * corr;
        }
      }
    }

    const portfolioVol = Math.sqrt(portfolioVar) * 100;
    const diversificationRatio = portfolioVol > 0 ? weightedAvgVol / portfolioVol : 1;

    // Asset class diversity score (based on number of asset classes used)
    const nonZeroAllocations = Array.from(allocations.values()).filter(w => w > 0.01).length;
    const totalAssetClasses = allocations.size;
    const assetClassDiversity = (nonZeroAllocations / totalAssetClasses) * 100;

    // Build correlation matrix
    const correlationMatrix: number[][] = [];
    for (let i = 0; i < assetList.length; i++) {
      correlationMatrix[i] = [];
      for (let j = 0; j < assetList.length; j++) {
        if (i === j) {
          correlationMatrix[i][j] = 1.0;
        } else {
          const char1 = charMap.get(assetList[i]);
          const corr = char1?.correlations?.get(assetList[j]) ?? 0.3;
          correlationMatrix[i][j] = corr;
        }
      }
    }

    return {
      diversificationRatio,
      herfindahlIndex: hhi,
      effectiveNumberOfAssets,
      averageCorrelation,
      maxPairwiseCorrelation: maxCorr,
      correlationMatrix,
      assetClassDiversity
    };
  }

  /**
   * Generate rebalancing actions
   */
  private generateRebalancingActions(
    currentPositions: Map<AllocationAssetClass, number>,
    targetAllocations: Map<AllocationAssetClass, number>,
    accountSize: number
  ): RebalancingAction[] {
    const actions: RebalancingAction[] = [];

    // Calculate current total value
    let currentTotal = 0;
    currentPositions.forEach(amount => {
      currentTotal += amount;
    });

    // Generate actions for each asset class
    targetAllocations.forEach((targetWeight, asset) => {
      const currentAmount = currentPositions.get(asset) || 0;
      const currentWeight = currentTotal > 0 ? currentAmount / currentTotal : 0;
      const targetAmount = accountSize * targetWeight;

      const drift = Math.abs(currentWeight - targetWeight);

      // Only rebalance if drift exceeds threshold
      if (drift > this.config.rebalancingThreshold / 100) {
        const tradeDelta = targetAmount - currentAmount;

        actions.push({
          assetClass: asset,
          currentAllocation: currentWeight,
          targetAllocation: targetWeight,
          action: tradeDelta > 0 ? 'BUY' : 'SELL',
          tradeAmount: Math.abs(tradeDelta),
          priority: drift > 0.15 ? 1 : drift > 0.10 ? 2 : 3,
          estimatedCost: Math.abs(tradeDelta) * 0.001, // 0.1% transaction cost
          reason: `Drift of ${(drift * 100).toFixed(2)}% exceeds threshold`
        });
      }
    });

    // Sort by priority
    actions.sort((a, b) => a.priority - b.priority);

    return actions;
  }

  /**
   * Build detailed asset allocations
   */
  private buildAssetAllocations(
    allocations: Map<AllocationAssetClass, number>,
    accountSize: number,
    characteristics: AssetClassCharacteristics[],
    portfolioMetrics: PortfolioMetrics,
    riskProfile: RiskProfile
  ): AssetAllocation[] {
    const charMap = new Map(characteristics.map(c => [c.assetClass, c]));
    const assetAllocations: AssetAllocation[] = [];

    allocations.forEach((weight, asset) => {
      if (weight > 0.001) { // Only include meaningful allocations
        const char = charMap.get(asset);
        const amount = accountSize * weight;

        // Calculate risk contribution
        const assetVol = char?.volatility || 0;
        const portfolioVol = portfolioMetrics.expectedVolatility;
        const riskContribution = portfolioVol > 0 ? (weight * assetVol) / portfolioVol : 0;

        // Calculate return contribution
        const assetReturn = char?.expectedReturn || 0;
        const returnContribution = weight * assetReturn;

        // Generate rationale
        const rationale = this.generateAllocationRationale(
          asset,
          weight,
          char,
          riskProfile
        );

        // Calculate confidence (based on data quality and market conditions)
        const confidence = char ? Math.min(0.95, 0.7 + (char.liquidityScore / 200)) : 0.5;

        assetAllocations.push({
          assetClass: asset,
          allocation: weight,
          amount,
          riskContribution,
          returnContribution,
          rationale,
          confidence
        });
      }
    });

    // Sort by allocation size
    assetAllocations.sort((a, b) => b.allocation - a.allocation);

    return assetAllocations;
  }

  /**
   * Generate rationale for asset allocation
   */
  private generateAllocationRationale(
    asset: AllocationAssetClass,
    weight: number,
    characteristics: AssetClassCharacteristics | undefined,
    riskProfile: RiskProfile
  ): string {
    if (!characteristics) {
      return `${(weight * 100).toFixed(1)}% allocated to ${asset}`;
    }

    const reasons: string[] = [];

    // Add size description
    if (weight > 0.3) {
      reasons.push('Core holding');
    } else if (weight > 0.15) {
      reasons.push('Significant position');
    } else if (weight > 0.05) {
      reasons.push('Moderate allocation');
    } else {
      reasons.push('Tactical allocation');
    }

    // Add characteristic-based reasoning
    if (characteristics.sharpeRatio > 1.5) {
      reasons.push('strong risk-adjusted returns');
    }

    if (characteristics.volatility < 15) {
      reasons.push('low volatility');
    } else if (characteristics.volatility > 25) {
      reasons.push('high growth potential');
    }

    if (characteristics.liquidityScore > 80) {
      reasons.push('high liquidity');
    }

    // Add risk profile context
    if (riskProfile === 'CONSERVATIVE' && asset === 'ETF') {
      reasons.push('diversification and stability');
    } else if (riskProfile === 'AGGRESSIVE' && asset === 'OPTIONS') {
      reasons.push('leveraged growth opportunities');
    }

    return `${(weight * 100).toFixed(1)}% allocation - ${reasons.join(', ')}`;
  }

  /**
   * Calculate next rebalancing date
   */
  private calculateNextRebalancingDate(frequencyDays?: number): Date {
    const days = frequencyDays || 90; // Default to quarterly
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + days);
    return nextDate;
  }

  /**
   * Get methodology description
   */
  private getMethodologyDescription(
    objective: OptimizationObjective,
    riskProfile: RiskProfile
  ): string {
    const descriptions: Record<OptimizationObjective, string> = {
      MAX_SHARPE: 'Sharpe ratio maximization with risk-adjusted return optimization',
      MIN_RISK: 'Minimum variance optimization prioritizing capital preservation',
      MAX_RETURN: 'Return maximization within risk tolerance constraints',
      RISK_PARITY: 'Equal risk contribution across asset classes',
      MAX_DIVERSIFICATION: 'Correlation-based diversification maximization',
      TARGET_RETURN: 'Target return achievement with minimum required risk',
      TARGET_RISK: 'Target risk level with maximum potential return'
    };

    return `${descriptions[objective]} tailored for ${riskProfile} risk profile`;
  }

  /**
   * Generate warnings based on allocation
   */
  private generateWarnings(
    allocations: Map<AllocationAssetClass, number>,
    riskAnalysis: RiskAnalysis,
    input: AllocationInput
  ): string[] {
    const warnings: string[] = [];

    // High risk warning
    if (riskAnalysis.riskLevel === 'HIGH' || riskAnalysis.riskLevel === 'EXTREME') {
      warnings.push(
        `Portfolio risk level is ${riskAnalysis.riskLevel}. Consider reducing exposure to volatile assets.`
      );
    }

    // Concentration warning
    if (riskAnalysis.concentrationRisk > 40) {
      warnings.push(
        'High concentration detected. Portfolio may benefit from additional diversification.'
      );
    }

    // Liquidity warning
    if (riskAnalysis.liquidityRisk > 30) {
      warnings.push(
        'Some positions may have limited liquidity. Consider exit strategies in advance.'
      );
    }

    // Small account warning
    if (input.accountSize < 5000) {
      warnings.push(
        'Small account size may limit diversification. Consider focusing on ETFs for broader exposure.'
      );
    }

    // High volatility market warning
    if (input.marketConditions.volatilityIndex > 25) {
      warnings.push(
        'Market volatility is elevated. Consider maintaining higher cash reserves.'
      );
    }

    // Crypto allocation warning
    const cryptoAlloc = allocations.get('CRYPTO') || 0;
    if (cryptoAlloc > 0.15) {
      warnings.push(
        'Cryptocurrency allocation exceeds 15%. Be aware of high volatility and regulatory risks.'
      );
    }

    // Options allocation warning
    const optionsAlloc = allocations.get('OPTIONS') || 0;
    if (optionsAlloc > 0.25) {
      warnings.push(
        'Options allocation is significant. Ensure adequate knowledge and risk management.'
      );
    }

    return warnings;
  }

  /**
   * Generate unique recommendation ID
   */
  private generateRecommendationId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `alloc_${timestamp}_${random}`;
  }
}

/**
 * Convenience function to generate allocation with default settings
 */
export async function generateOptimalAllocation(
  input: AllocationInput,
  config?: Partial<AllocationStrategyConfig>
): Promise<AllocationRecommendation> {
  const engine = new AssetAllocationEngine(config as AllocationStrategyConfig);
  return engine.generateAllocation(input);
}

/**
 * Convenience function to get default risk profile characteristics
 */
export function getDefaultRiskProfile(profile: RiskProfile): DefaultRiskProfile | undefined {
  const engine = new AssetAllocationEngine();
  return (engine as any).defaultRiskProfiles.get(profile);
}
