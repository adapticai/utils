/**
 * Asset Allocation Algorithm - Example Usage
 *
 * Demonstrates practical usage of the asset allocation engine
 * with real-world scenarios and best practices.
 */

import {
  generateOptimalAllocation,
  AssetAllocationEngine,
  getDefaultRiskProfile,
  type AllocationInput,
  type AssetClassCharacteristics,
  type MarketMetrics,
  type RiskProfile,
  type AllocationConstraint,
  type OptimizationObjective,
  type AllocationAssetClass
} from '../index';

/**
 * Example 1: Basic Conservative Portfolio for Retirement
 */
export async function conservativeRetirementPortfolio() {
  console.log('=== Conservative Retirement Portfolio ===\n');

  const assetCharacteristics: AssetClassCharacteristics[] = [
    {
      assetClass: 'EQUITIES',
      volatility: 18.5,
      expectedReturn: 10.2,
      sharpeRatio: 0.55,
      maxDrawdown: 22,
      liquidityScore: 90,
      correlations: new Map([
        ['OPTIONS', 0.7],
        ['ETF', 0.85],
        ['FUTURES', 0.6],
        ['FOREX', 0.3],
        ['CRYPTO', 0.4]
      ]),
      marketSize: 50000000000,
      transactionCost: 0.001,
      minimumInvestment: 1
    },
    {
      assetClass: 'ETF',
      volatility: 12.0,
      expectedReturn: 8.5,
      sharpeRatio: 0.71,
      maxDrawdown: 15,
      liquidityScore: 95,
      correlations: new Map([
        ['EQUITIES', 0.85],
        ['OPTIONS', 0.6],
        ['FUTURES', 0.5],
        ['FOREX', 0.3],
        ['CRYPTO', 0.25]
      ]),
      marketSize: 80000000000,
      transactionCost: 0.0005,
      minimumInvestment: 1
    },
    {
      assetClass: 'OPTIONS',
      volatility: 35.0,
      expectedReturn: 15.5,
      sharpeRatio: 0.44,
      maxDrawdown: 40,
      liquidityScore: 75,
      correlations: new Map([
        ['EQUITIES', 0.7],
        ['ETF', 0.6],
        ['FUTURES', 0.5],
        ['FOREX', 0.2],
        ['CRYPTO', 0.3]
      ]),
      marketSize: 10000000000,
      transactionCost: 0.005,
      minimumInvestment: 100
    },
    {
      assetClass: 'FOREX',
      volatility: 10.0,
      expectedReturn: 6.5,
      sharpeRatio: 0.65,
      maxDrawdown: 12,
      liquidityScore: 98,
      correlations: new Map([
        ['EQUITIES', 0.3],
        ['OPTIONS', 0.2],
        ['ETF', 0.3],
        ['FUTURES', 0.4],
        ['CRYPTO', 0.2]
      ]),
      marketSize: 100000000000,
      transactionCost: 0.0002,
      minimumInvestment: 1
    },
    {
      assetClass: 'CRYPTO',
      volatility: 65.0,
      expectedReturn: 25.0,
      sharpeRatio: 0.38,
      maxDrawdown: 70,
      liquidityScore: 60,
      correlations: new Map([
        ['EQUITIES', 0.4],
        ['OPTIONS', 0.3],
        ['ETF', 0.25],
        ['FUTURES', 0.35],
        ['FOREX', 0.2]
      ]),
      marketSize: 2000000000,
      transactionCost: 0.01,
      minimumInvestment: 10
    },
    {
      assetClass: 'FUTURES',
      volatility: 28.0,
      expectedReturn: 12.0,
      sharpeRatio: 0.43,
      maxDrawdown: 35,
      liquidityScore: 85,
      correlations: new Map([
        ['EQUITIES', 0.6],
        ['OPTIONS', 0.5],
        ['ETF', 0.5],
        ['FOREX', 0.4],
        ['CRYPTO', 0.35]
      ]),
      marketSize: 15000000000,
      transactionCost: 0.002,
      minimumInvestment: 100
    }
  ];

  const marketMetrics: MarketMetrics = {
    volatilityIndex: 15.0, // Low volatility
    trendDirection: 'UP',
    marketStrength: 55,
    sentimentScore: 60,
    interestRateLevel: 'MEDIUM',
    inflationRate: 2.8,
    creditSpread: 200,
    economicPhase: 'EXPANSION'
  };

  const input: AllocationInput = {
    riskProfile: 'CONSERVATIVE',
    marketConditions: marketMetrics,
    accountSize: 250000, // $250k retirement account
    assetCharacteristics,
    preferences: {
      excludedAssetClasses: ['CRYPTO'], // No crypto for conservative
      maxDrawdown: 10,
      targetReturn: 5,
      rebalancingFrequency: 90 // Quarterly
    }
  };

  const recommendation = await generateOptimalAllocation(input);

  console.log('Portfolio Metrics:');
  console.log(`  Expected Return: ${recommendation.portfolioMetrics.expectedReturn.toFixed(2)}%`);
  console.log(`  Expected Volatility: ${recommendation.portfolioMetrics.expectedVolatility.toFixed(2)}%`);
  console.log(`  Sharpe Ratio: ${recommendation.portfolioMetrics.sharpeRatio.toFixed(2)}`);
  console.log(`  Max Drawdown: ${recommendation.portfolioMetrics.maxDrawdown.toFixed(2)}%`);
  console.log(`  Risk Level: ${recommendation.riskAnalysis.riskLevel}`);

  console.log('\nAsset Allocations:');
  recommendation.allocations.forEach(alloc => {
    console.log(`  ${alloc.assetClass}:`);
    console.log(`    Allocation: ${(alloc.allocation * 100).toFixed(1)}%`);
    console.log(`    Amount: $${alloc.amount.toFixed(2)}`);
    console.log(`    Rationale: ${alloc.rationale}`);
  });

  if (recommendation.warnings.length > 0) {
    console.log('\nWarnings:');
    recommendation.warnings.forEach(warning => console.log(`  - ${warning}`));
  }

  return recommendation;
}

/**
 * Example 2: Aggressive Growth Portfolio for Young Investor
 */
export async function aggressiveGrowthPortfolio() {
  console.log('\n=== Aggressive Growth Portfolio ===\n');

  const assetCharacteristics: AssetClassCharacteristics[] = getStandardAssetCharacteristics();

  const marketMetrics: MarketMetrics = {
    volatilityIndex: 22.0, // Moderate volatility
    trendDirection: 'UP',
    marketStrength: 70,
    sentimentScore: 65,
    interestRateLevel: 'LOW',
    inflationRate: 3.5,
    creditSpread: 180,
    economicPhase: 'EXPANSION'
  };

  const input: AllocationInput = {
    riskProfile: 'AGGRESSIVE',
    marketConditions: marketMetrics,
    accountSize: 50000, // $50k for young investor
    assetCharacteristics,
    preferences: {
      targetReturn: 18,
      maxDrawdown: 35,
      rebalancingFrequency: 30 // Monthly
    }
  };

  const config = {
    objective: 'MAX_RETURN' as OptimizationObjective,
    riskFreeRate: 0.04,
    rebalancingThreshold: 5,
    transactionCostModel: 'PERCENTAGE' as const,
    timeHorizon: 20,
    allowLeverage: false,
    includeAlternatives: true
  };

  const engine = new AssetAllocationEngine(config);
  const recommendation = await engine.generateAllocation(input);

  printRecommendation(recommendation);

  return recommendation;
}

/**
 * Example 3: Rebalancing an Existing Portfolio
 */
export async function rebalancePortfolio() {
  console.log('\n=== Portfolio Rebalancing Example ===\n');

  const currentPositions = new Map<AllocationAssetClass, number>([
    ['EQUITIES', 45000],
    ['OPTIONS', 20000],
    ['ETF', 25000],
    ['CRYPTO', 8000],
    ['FUTURES', 2000]
  ]);

  const totalValue = Array.from(currentPositions.values()).reduce((sum, val) => sum + val, 0);

  console.log('Current Portfolio:');
  currentPositions.forEach((amount, asset) => {
    const percentage = (amount / totalValue) * 100;
    console.log(`  ${asset}: $${amount.toFixed(2)} (${percentage.toFixed(1)}%)`);
  });
  console.log(`  Total: $${totalValue.toFixed(2)}\n`);

  const assetCharacteristics: AssetClassCharacteristics[] = getStandardAssetCharacteristics();

  const marketMetrics: MarketMetrics = {
    volatilityIndex: 28.0, // High volatility - time to rebalance
    trendDirection: 'NEUTRAL',
    marketStrength: 45,
    sentimentScore: 42,
    interestRateLevel: 'MEDIUM',
    inflationRate: 4.2,
    creditSpread: 320,
    economicPhase: 'PEAK'
  };

  const input: AllocationInput = {
    riskProfile: 'MODERATE',
    marketConditions: marketMetrics,
    accountSize: totalValue,
    currentPositions,
    assetCharacteristics,
    preferences: {
      maxDrawdown: 20,
      rebalancingFrequency: 30
    }
  };

  const recommendation = await generateOptimalAllocation(input);

  console.log('Target Portfolio:');
  recommendation.allocations.forEach(alloc => {
    console.log(`  ${alloc.assetClass}: $${alloc.amount.toFixed(2)} (${(alloc.allocation * 100).toFixed(1)}%)`);
  });

  if (recommendation.rebalancing && recommendation.rebalancing.length > 0) {
    console.log('\nRebalancing Actions Required:');
    recommendation.rebalancing.forEach(action => {
      const drift = Math.abs(action.currentAllocation - action.targetAllocation) * 100;
      console.log(`  ${action.assetClass}:`);
      console.log(`    Action: ${action.action}`);
      console.log(`    Current: ${(action.currentAllocation * 100).toFixed(1)}%`);
      console.log(`    Target: ${(action.targetAllocation * 100).toFixed(1)}%`);
      console.log(`    Drift: ${drift.toFixed(1)}%`);
      console.log(`    Trade Amount: $${action.tradeAmount.toFixed(2)}`);
      console.log(`    Priority: ${action.priority}`);
      console.log(`    Estimated Cost: $${action.estimatedCost.toFixed(2)}`);
    });
  } else {
    console.log('\nNo rebalancing needed - portfolio is within threshold.');
  }

  return recommendation;
}

/**
 * Example 4: Crisis Mode Allocation
 */
export async function crisisModePortfolio() {
  console.log('\n=== Crisis Mode Portfolio ===\n');

  const assetCharacteristics: AssetClassCharacteristics[] = getStandardAssetCharacteristics();

  const marketMetrics: MarketMetrics = {
    volatilityIndex: 45.0, // Very high volatility
    trendDirection: 'DOWN',
    marketStrength: 25,
    sentimentScore: 15, // Extreme fear
    interestRateLevel: 'LOW',
    inflationRate: 5.5,
    creditSpread: 650, // High credit stress
    economicPhase: 'CONTRACTION'
  };

  const input: AllocationInput = {
    riskProfile: 'MODERATE', // Even moderate profile becomes defensive in crisis
    marketConditions: marketMetrics,
    accountSize: 100000,
    assetCharacteristics,
    preferences: {
      maxDrawdown: 15, // Tight drawdown control
      rebalancingFrequency: 7 // Weekly in crisis
    }
  };

  const config = {
    objective: 'MIN_RISK' as OptimizationObjective,
    riskFreeRate: 0.03,
    rebalancingThreshold: 3, // Tighter threshold
    transactionCostModel: 'PERCENTAGE' as const,
    timeHorizon: 1, // Short horizon
    allowLeverage: false,
    includeAlternatives: false
  };

  const engine = new AssetAllocationEngine(config);
  const recommendation = await engine.generateAllocation(input);

  console.log('Market Conditions:');
  console.log(`  Volatility Index: ${marketMetrics.volatilityIndex}`);
  console.log(`  Market Strength: ${marketMetrics.marketStrength}`);
  console.log(`  Sentiment: ${marketMetrics.sentimentScore}`);
  console.log(`  Credit Spread: ${marketMetrics.creditSpread} bps\n`);

  printRecommendation(recommendation);

  console.log('\nCrisis Strategy Notes:');
  console.log('  - Heavy allocation to defensive assets (ETF, FOREX)');
  console.log('  - Minimal exposure to volatile assets (Crypto, Options)');
  console.log('  - Focus on capital preservation');
  console.log('  - Higher cash reserves recommended');
  console.log('  - More frequent rebalancing');

  return recommendation;
}

/**
 * Example 5: Risk Parity Portfolio
 */
export async function riskParityPortfolio() {
  console.log('\n=== Risk Parity Portfolio ===\n');

  const assetCharacteristics: AssetClassCharacteristics[] = getStandardAssetCharacteristics();

  const marketMetrics: MarketMetrics = {
    volatilityIndex: 18.0,
    trendDirection: 'NEUTRAL',
    marketStrength: 50,
    sentimentScore: 50,
    interestRateLevel: 'MEDIUM',
    inflationRate: 3.0,
    creditSpread: 250,
    economicPhase: 'EXPANSION'
  };

  const input: AllocationInput = {
    marketConditions: marketMetrics,
    accountSize: 200000,
    assetCharacteristics
  };

  const config = {
    objective: 'RISK_PARITY' as OptimizationObjective,
    riskFreeRate: 0.04,
    rebalancingThreshold: 5,
    transactionCostModel: 'PERCENTAGE' as const,
    timeHorizon: 10,
    allowLeverage: false,
    includeAlternatives: true
  };

  const engine = new AssetAllocationEngine(config);
  const recommendation = await engine.generateAllocation(input);

  console.log('Risk Parity Approach:');
  console.log('  - Equal risk contribution from each asset class');
  console.log('  - Diversification across uncorrelated assets');
  console.log('  - All-weather portfolio design\n');

  printRecommendation(recommendation);

  console.log('\nRisk Decomposition:');
  recommendation.riskAnalysis.riskDecomposition.forEach((contribution, asset) => {
    console.log(`  ${asset}: ${contribution.toFixed(1)}% of total risk`);
  });

  return recommendation;
}

/**
 * Example 6: Small Account Allocation
 */
export async function smallAccountPortfolio() {
  console.log('\n=== Small Account Portfolio ($5,000) ===\n');

  const assetCharacteristics: AssetClassCharacteristics[] = getStandardAssetCharacteristics();

  const marketMetrics: MarketMetrics = {
    volatilityIndex: 20.0,
    trendDirection: 'UP',
    marketStrength: 60,
    sentimentScore: 55,
    interestRateLevel: 'MEDIUM',
    inflationRate: 3.2,
    creditSpread: 230,
    economicPhase: 'EXPANSION'
  };

  const input: AllocationInput = {
    riskProfile: 'MODERATE',
    marketConditions: marketMetrics,
    accountSize: 5000, // Small account
    assetCharacteristics,
    preferences: {
      // Focus on ETFs for better diversification with small capital
      preferredAssetClasses: ['ETF', 'EQUITIES', 'CRYPTO'],
      minAllocationPerClass: 0.15,
      rebalancingFrequency: 90
    }
  };

  const recommendation = await generateOptimalAllocation(input);

  printRecommendation(recommendation);

  console.log('\nSmall Account Strategy:');
  console.log('  - Focus on low-minimum-investment assets');
  console.log('  - ETFs provide instant diversification');
  console.log('  - Minimize transaction costs');
  console.log('  - Consider fractional shares');

  return recommendation;
}

/**
 * Helper: Get standard asset characteristics
 */
function getStandardAssetCharacteristics(): AssetClassCharacteristics[] {
  return [
    {
      assetClass: 'EQUITIES',
      volatility: 18.5,
      expectedReturn: 10.2,
      sharpeRatio: 0.55,
      maxDrawdown: 22,
      liquidityScore: 90,
      correlations: new Map([
        ['OPTIONS', 0.7],
        ['ETF', 0.85],
        ['FUTURES', 0.6],
        ['FOREX', 0.3],
        ['CRYPTO', 0.4]
      ]),
      marketSize: 50000000000,
      transactionCost: 0.001,
      minimumInvestment: 1
    },
    {
      assetClass: 'OPTIONS',
      volatility: 35.0,
      expectedReturn: 15.5,
      sharpeRatio: 0.44,
      maxDrawdown: 40,
      liquidityScore: 75,
      correlations: new Map([
        ['EQUITIES', 0.7],
        ['ETF', 0.6],
        ['FUTURES', 0.5],
        ['FOREX', 0.2],
        ['CRYPTO', 0.3]
      ]),
      marketSize: 10000000000,
      transactionCost: 0.005,
      minimumInvestment: 100
    },
    {
      assetClass: 'FUTURES',
      volatility: 28.0,
      expectedReturn: 12.0,
      sharpeRatio: 0.43,
      maxDrawdown: 35,
      liquidityScore: 85,
      correlations: new Map([
        ['EQUITIES', 0.6],
        ['OPTIONS', 0.5],
        ['ETF', 0.5],
        ['FOREX', 0.4],
        ['CRYPTO', 0.35]
      ]),
      marketSize: 15000000000,
      transactionCost: 0.002,
      minimumInvestment: 100
    },
    {
      assetClass: 'ETF',
      volatility: 12.0,
      expectedReturn: 8.5,
      sharpeRatio: 0.71,
      maxDrawdown: 15,
      liquidityScore: 95,
      correlations: new Map([
        ['EQUITIES', 0.85],
        ['OPTIONS', 0.6],
        ['FUTURES', 0.5],
        ['FOREX', 0.3],
        ['CRYPTO', 0.25]
      ]),
      marketSize: 80000000000,
      transactionCost: 0.0005,
      minimumInvestment: 1
    },
    {
      assetClass: 'FOREX',
      volatility: 10.0,
      expectedReturn: 6.5,
      sharpeRatio: 0.65,
      maxDrawdown: 12,
      liquidityScore: 98,
      correlations: new Map([
        ['EQUITIES', 0.3],
        ['OPTIONS', 0.2],
        ['ETF', 0.3],
        ['FUTURES', 0.4],
        ['CRYPTO', 0.2]
      ]),
      marketSize: 100000000000,
      transactionCost: 0.0002,
      minimumInvestment: 1
    },
    {
      assetClass: 'CRYPTO',
      volatility: 65.0,
      expectedReturn: 25.0,
      sharpeRatio: 0.38,
      maxDrawdown: 70,
      liquidityScore: 60,
      correlations: new Map([
        ['EQUITIES', 0.4],
        ['OPTIONS', 0.3],
        ['ETF', 0.25],
        ['FUTURES', 0.35],
        ['FOREX', 0.2]
      ]),
      marketSize: 2000000000,
      transactionCost: 0.01,
      minimumInvestment: 10
    }
  ];
}

/**
 * Helper: Print recommendation in formatted way
 */
function printRecommendation(recommendation: any): void {
  console.log('Portfolio Metrics:');
  console.log(`  Expected Return: ${recommendation.portfolioMetrics.expectedReturn.toFixed(2)}%`);
  console.log(`  Expected Volatility: ${recommendation.portfolioMetrics.expectedVolatility.toFixed(2)}%`);
  console.log(`  Sharpe Ratio: ${recommendation.portfolioMetrics.sharpeRatio.toFixed(2)}`);
  console.log(`  Sortino Ratio: ${recommendation.portfolioMetrics.sortinoRatio.toFixed(2)}`);
  console.log(`  Max Drawdown: ${recommendation.portfolioMetrics.maxDrawdown.toFixed(2)}%`);
  console.log(`  VaR (95%): ${recommendation.portfolioMetrics.valueAtRisk95.toFixed(2)}%`);
  console.log(`  Risk Level: ${recommendation.riskAnalysis.riskLevel}`);

  console.log('\nAsset Allocations:');
  recommendation.allocations.forEach((alloc: any) => {
    console.log(`  ${alloc.assetClass}:`);
    console.log(`    Allocation: ${(alloc.allocation * 100).toFixed(1)}%`);
    console.log(`    Amount: $${alloc.amount.toFixed(2)}`);
    console.log(`    Risk Contribution: ${(alloc.riskContribution * 100).toFixed(1)}%`);
    console.log(`    Return Contribution: ${alloc.returnContribution.toFixed(2)}%`);
  });

  console.log('\nDiversification Metrics:');
  console.log(`  Diversification Ratio: ${recommendation.diversification.diversificationRatio.toFixed(2)}`);
  console.log(`  Effective Assets: ${recommendation.diversification.effectiveNumberOfAssets.toFixed(1)}`);
  console.log(`  Average Correlation: ${recommendation.diversification.averageCorrelation.toFixed(2)}`);
  console.log(`  Asset Class Diversity: ${recommendation.diversification.assetClassDiversity.toFixed(1)}%`);

  if (recommendation.warnings.length > 0) {
    console.log('\nWarnings:');
    recommendation.warnings.forEach((warning: string) => console.log(`  - ${warning}`));
  }
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  await conservativeRetirementPortfolio();
  await aggressiveGrowthPortfolio();
  await rebalancePortfolio();
  await crisisModePortfolio();
  await riskParityPortfolio();
  await smallAccountPortfolio();
}

// If running directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}
