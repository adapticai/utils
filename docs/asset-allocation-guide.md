# Asset Allocation Algorithm Guide

## Overview

The Asset Allocation Algorithm is a sophisticated portfolio optimization engine that determines optimal asset allocation across multiple asset classes including:

- **Equities** (Stocks)
- **Options Contracts**
- **Futures**
- **ETFs**
- **FOREX**
- **Crypto**

The algorithm balances risk and return based on:
- User risk profile
- Market conditions
- Account size
- User preferences
- Modern Portfolio Theory principles
- Correlation analysis
- Liquidity requirements

## Key Features

### 1. **Risk-Based Allocation**
- 5 risk profiles: Conservative, Moderate Conservative, Moderate, Moderate Aggressive, Aggressive
- Dynamic risk adjustment based on market conditions
- Automatic risk inference from account characteristics

### 2. **Market-Aware Optimization**
- Adapts to market conditions (Bull, Bear, Sideways, High Volatility, Crisis)
- Considers volatility indices, market trends, and sentiment
- Inflation and interest rate adjustments

### 3. **Multiple Optimization Objectives**
- Maximum Sharpe Ratio
- Minimum Risk (Variance)
- Maximum Return
- Risk Parity (Equal Risk Contribution)
- Maximum Diversification

### 4. **Comprehensive Risk Analysis**
- Value at Risk (VaR)
- Conditional VaR (Expected Shortfall)
- Maximum Drawdown estimation
- Liquidity risk assessment
- Concentration risk measurement
- Correlation analysis

### 5. **Diversification Metrics**
- Herfindahl-Hirschman Index
- Effective number of assets
- Correlation matrix
- Diversification ratio

## Usage Examples

### Basic Usage

```typescript
import {
  generateOptimalAllocation,
  AssetClass,
  RiskProfile,
  AllocationInput,
  AssetClassCharacteristics
} from '@adaptic/utils';

// Define asset characteristics
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
  }
];

// Define market conditions
const marketMetrics = {
  volatilityIndex: 18.5, // VIX level
  trendDirection: 'UP' as const,
  marketStrength: 65,
  sentimentScore: 58,
  interestRateLevel: 'MEDIUM' as const,
  inflationRate: 3.2,
  creditSpread: 250,
  economicPhase: 'EXPANSION' as const
};

// Create allocation input
const input: AllocationInput = {
  riskProfile: 'MODERATE',
  marketConditions: marketMetrics,
  accountSize: 100000,
  assetCharacteristics,
  preferences: {
    maxDrawdown: 20,
    targetReturn: 10,
    rebalancingFrequency: 90
  }
};

// Generate allocation
const recommendation = await generateOptimalAllocation(input);

console.log('Allocation Recommendation:');
console.log('Expected Return:', recommendation.portfolioMetrics.expectedReturn.toFixed(2) + '%');
console.log('Expected Volatility:', recommendation.portfolioMetrics.expectedVolatility.toFixed(2) + '%');
console.log('Sharpe Ratio:', recommendation.portfolioMetrics.sharpeRatio.toFixed(2));
console.log('\nAsset Allocations:');
recommendation.allocations.forEach(alloc => {
  console.log(`${alloc.assetClass}: ${(alloc.allocation * 100).toFixed(1)}% ($${alloc.amount.toFixed(0)})`);
  console.log(`  Rationale: ${alloc.rationale}`);
});
```

### Advanced Usage with Custom Constraints

```typescript
import {
  AssetAllocationEngine,
  AllocationInput,
  AllocationConstraint,
  OptimizationObjective
} from '@adaptic/utils';

// Define custom constraints
const constraints: AllocationConstraint[] = [
  {
    type: 'MAX_ALLOCATION',
    assetClass: 'CRYPTO',
    value: 0.10, // Max 10% in crypto
    priority: 1,
    hard: true
  },
  {
    type: 'MIN_ALLOCATION',
    assetClass: 'ETF',
    value: 0.30, // Min 30% in ETFs
    priority: 1,
    hard: true
  }
];

// Configure custom optimization
const config = {
  objective: 'MAX_SHARPE' as OptimizationObjective,
  riskFreeRate: 0.045,
  rebalancingThreshold: 3,
  transactionCostModel: 'PERCENTAGE' as const,
  timeHorizon: 10,
  allowLeverage: false,
  includeAlternatives: true
};

const engine = new AssetAllocationEngine(config);

const input: AllocationInput = {
  riskProfile: 'MODERATE_AGGRESSIVE',
  marketConditions: marketMetrics,
  accountSize: 500000,
  assetCharacteristics,
  constraints,
  preferences: {
    excludedAssetClasses: [], // No exclusions
    maxAllocationPerClass: 0.40, // Max 40% per asset class
    esgFocused: false,
    taxOptimized: true
  }
};

const recommendation = await engine.generateAllocation(input);
```

### Rebalancing Existing Portfolio

```typescript
// Define current positions
const currentPositions = new Map<AssetClass, number>([
  ['EQUITIES', 45000],
  ['OPTIONS', 15000],
  ['ETF', 30000],
  ['CRYPTO', 5000],
  ['FUTURES', 5000]
]);

const input: AllocationInput = {
  riskProfile: 'MODERATE',
  marketConditions: marketMetrics,
  accountSize: 100000,
  currentPositions, // Include current positions
  assetCharacteristics,
  preferences: {
    rebalancingFrequency: 30 // Rebalance monthly
  }
};

const recommendation = await generateOptimalAllocation(input);

// Check rebalancing recommendations
if (recommendation.rebalancing && recommendation.rebalancing.length > 0) {
  console.log('\nRebalancing Actions:');
  recommendation.rebalancing.forEach(action => {
    console.log(`${action.action} ${action.assetClass}:`);
    console.log(`  Current: ${(action.currentAllocation * 100).toFixed(1)}%`);
    console.log(`  Target: ${(action.targetAllocation * 100).toFixed(1)}%`);
    console.log(`  Trade Amount: $${action.tradeAmount.toFixed(2)}`);
    console.log(`  Priority: ${action.priority}`);
    console.log(`  Reason: ${action.reason}`);
  });
}
```

### Risk Profile Analysis

```typescript
import { getDefaultRiskProfile, RiskProfile } from '@adaptic/utils';

// Examine different risk profiles
const profiles: RiskProfile[] = [
  'CONSERVATIVE',
  'MODERATE_CONSERVATIVE',
  'MODERATE',
  'MODERATE_AGGRESSIVE',
  'AGGRESSIVE'
];

profiles.forEach(profile => {
  const defaults = getDefaultRiskProfile(profile);
  if (defaults) {
    console.log(`\n${profile}:`);
    console.log(`  Description: ${defaults.description}`);
    console.log(`  Max Volatility: ${defaults.maxVolatility}%`);
    console.log(`  Max Drawdown: ${defaults.maxDrawdown}%`);
    console.log(`  Target Return: ${defaults.targetReturn}%`);
    console.log(`  Risk Score: ${defaults.riskScore}`);
    console.log('  Base Allocations:');
    defaults.baseAllocations.forEach((allocation, assetClass) => {
      console.log(`    ${assetClass}: ${(allocation * 100).toFixed(1)}%`);
    });
  }
});
```

## Optimization Objectives

### 1. Maximum Sharpe Ratio (MAX_SHARPE)
Maximizes risk-adjusted returns. Best for balanced risk-return profiles.

**When to use:**
- Default choice for most investors
- Seeking optimal balance of risk and return
- Long-term wealth accumulation

### 2. Minimum Risk (MIN_RISK)
Minimizes portfolio volatility. Best for risk-averse investors.

**When to use:**
- Capital preservation is priority
- Low risk tolerance
- Near-term liquidity needs

### 3. Maximum Return (MAX_RETURN)
Maximizes expected returns within risk constraints.

**When to use:**
- Higher risk tolerance
- Long investment horizon
- Growth-focused objectives

### 4. Risk Parity (RISK_PARITY)
Equal risk contribution from each asset class.

**When to use:**
- Seeking balanced risk exposure
- Diversification across uncorrelated assets
- All-weather portfolio approach

### 5. Maximum Diversification (MAX_DIVERSIFICATION)
Maximizes portfolio diversification based on correlations.

**When to use:**
- Minimizing systematic risk
- Avoiding concentration
- Uncertain market environment

## Risk Profiles

### Conservative
- **Risk Score:** 20
- **Max Volatility:** 8%
- **Max Drawdown:** 10%
- **Target Return:** 5%
- **Typical Allocation:** 50% ETF, 20% Equities, 10% FOREX, 15% Options/Other

### Moderate Conservative
- **Risk Score:** 35
- **Max Volatility:** 12%
- **Max Drawdown:** 15%
- **Target Return:** 7%
- **Typical Allocation:** 40% ETF, 30% Equities, 10% FOREX, 20% Options/Other

### Moderate
- **Risk Score:** 50
- **Max Volatility:** 15%
- **Max Drawdown:** 20%
- **Target Return:** 10%
- **Typical Allocation:** 40% Equities, 25% ETF, 15% Options, 20% Other

### Moderate Aggressive
- **Risk Score:** 70
- **Max Volatility:** 20%
- **Max Drawdown:** 25%
- **Target Return:** 13%
- **Typical Allocation:** 50% Equities, 20% Options, 10% ETF, 20% Other

### Aggressive
- **Risk Score:** 85
- **Max Volatility:** 30%
- **Max Drawdown:** 35%
- **Target Return:** 18%
- **Typical Allocation:** 45% Equities, 25% Options, 15% Futures, 15% Other

## Market Condition Adjustments

### Bull Market
- Increase allocation to equities, options, and crypto
- Reduce defensive positions (ETFs)
- Higher growth orientation

### Bear Market
- Increase ETF and FOREX allocations
- Reduce equities, options, and crypto
- Defensive positioning

### High Volatility
- Reduce options, futures, and crypto
- Increase ETFs and stable assets
- Risk mitigation focus

### Low Volatility
- Can increase risk-seeking assets
- Options and crypto allocations increase
- Growth opportunities

### Crisis
- Maximum defensive positioning
- Heavy ETF allocation
- Minimal crypto and options
- Capital preservation mode

## Portfolio Metrics Explained

### Sharpe Ratio
Risk-adjusted return metric. Higher is better.
- **> 1.0:** Excellent
- **0.5 - 1.0:** Good
- **< 0.5:** Poor

### Sortino Ratio
Like Sharpe but only penalizes downside volatility.

### Maximum Drawdown
Largest peak-to-trough decline. Lower is better.

### Value at Risk (VaR)
Worst expected loss at 95% confidence level.

### Conditional VaR
Average loss beyond VaR threshold (tail risk).

### Beta
Sensitivity to market movements (1.0 = market).

### Alpha
Excess return beyond market risk premium.

### Information Ratio
Active return per unit of tracking error.

## Best Practices

### 1. **Regular Rebalancing**
- Set appropriate rebalancing frequency (quarterly recommended)
- Don't over-rebalance (transaction costs)
- Consider tax implications

### 2. **Monitor Risk Metrics**
- Review risk level regularly
- Adjust as risk tolerance changes
- Watch concentration risk

### 3. **Account Size Considerations**
- Small accounts (<$10,000): Focus on ETFs
- Medium accounts ($10,000-$100,000): Diversify across 3-4 asset classes
- Large accounts (>$100,000): Full diversification possible

### 4. **Market Condition Awareness**
- Review allocation during major market shifts
- Don't panic - systematic approach
- Consider tactical adjustments

### 5. **Constraint Management**
- Use hard constraints sparingly
- Soft constraints provide flexibility
- Balance preferences with optimization

## Common Warnings

### High Risk Level
Portfolio volatility exceeds target. Consider:
- Reducing options/crypto exposure
- Increasing ETF allocation
- Moving to more conservative profile

### High Concentration
Few assets dominate portfolio. Consider:
- Adding more asset classes
- Reducing position sizes
- Improving diversification

### Liquidity Risk
Some positions may be illiquid. Consider:
- Exit strategies
- Reducing illiquid asset allocation
- Maintaining cash reserves

### Small Account Size
Limited diversification possible. Consider:
- ETF-focused approach
- Gradual position building
- Fractional shares

## Integration Examples

### With Risk Management System

```typescript
import { generateOptimalAllocation } from '@adaptic/utils';

// Monitor and adjust allocation
async function monitorPortfolioRisk(
  currentPositions: Map<AssetClass, number>,
  accountSize: number
) {
  const recommendation = await generateOptimalAllocation({
    marketConditions: await fetchCurrentMarketMetrics(),
    accountSize,
    currentPositions,
    assetCharacteristics: await fetchAssetCharacteristics(),
    preferences: {
      maxDrawdown: 20,
      rebalancingFrequency: 30
    }
  });

  // Check if risk exceeds threshold
  if (recommendation.riskAnalysis.riskLevel === 'HIGH' ||
      recommendation.riskAnalysis.riskLevel === 'EXTREME') {
    // Trigger risk reduction
    await implementRebalancing(recommendation.rebalancing);
  }

  return recommendation;
}
```

### With Automated Trading

```typescript
import { generateOptimalAllocation } from '@adaptic/utils';
import { executeOrder } from './trading-api';

async function autoRebalance(
  currentPositions: Map<AssetClass, number>,
  accountSize: number
) {
  const recommendation = await generateOptimalAllocation({
    marketConditions: await fetchCurrentMarketMetrics(),
    accountSize,
    currentPositions,
    assetCharacteristics: await fetchAssetCharacteristics()
  });

  if (recommendation.rebalancing) {
    for (const action of recommendation.rebalancing) {
      if (action.priority <= 2) { // High priority only
        await executeOrder({
          assetClass: action.assetClass,
          action: action.action,
          amount: action.tradeAmount
        });
      }
    }
  }
}
```

## Performance Considerations

### Optimization Speed
- Algorithm runs in O(n²) for n asset classes
- Typical execution: <100ms for 6 asset classes
- Can handle real-time rebalancing

### Memory Usage
- Lightweight implementation
- Correlation matrices: O(n²) memory
- Suitable for edge devices

### Accuracy
- Simplified covariance calculation
- Parametric VaR estimation
- Consider full backtesting for validation

## Limitations

1. **Historical Data Dependency**
   - Assumes historical relationships persist
   - Black swan events not fully modeled

2. **Simplified Correlation Model**
   - Static correlations
   - Dynamic correlation changes not captured

3. **Transaction Costs**
   - Simplified cost model
   - Real costs may vary

4. **Tax Considerations**
   - Basic tax optimization
   - Consult tax professional for specifics

5. **Market Impact**
   - Assumes price-taker
   - Large orders may impact prices

## References

- Modern Portfolio Theory (Markowitz, 1952)
- Black-Litterman Model (1992)
- Risk Parity Approach (Dalio)
- Sharpe Ratio (Sharpe, 1966)
- Value at Risk (VaR) methodology

## Support

For questions or issues, please refer to:
- Package documentation
- Example implementations
- Issue tracker
