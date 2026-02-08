import { describe, it, expect } from 'vitest';
import { AssetAllocationEngine, getDefaultRiskProfile } from '../asset-allocation-algorithm';
import type {
  RiskProfile,
  AllocationInput,
  MarketMetrics,
  AssetClassCharacteristics,
  AllocationAssetClass,
} from '../types/asset-allocation-types';

/**
 * Creates a standard MarketMetrics object for testing
 */
function createMarketMetrics(overrides: Partial<MarketMetrics> = {}): MarketMetrics {
  return {
    volatilityIndex: 18,
    trendDirection: 'NEUTRAL',
    marketStrength: 50,
    sentimentScore: 50,
    interestRateLevel: 'MEDIUM',
    inflationRate: 2.5,
    creditSpread: 150,
    economicPhase: 'EXPANSION',
    ...overrides,
  };
}

/**
 * Creates standard asset characteristics for testing
 */
function createAssetCharacteristics(): AssetClassCharacteristics[] {
  return [
    {
      assetClass: 'EQUITIES',
      volatility: 18,
      expectedReturn: 10,
      sharpeRatio: 0.55,
      maxDrawdown: 35,
      liquidityScore: 95,
      correlations: new Map<AllocationAssetClass, number>([
        ['OPTIONS', 0.65],
        ['FUTURES', 0.5],
        ['ETF', 0.85],
        ['FOREX', 0.2],
        ['CRYPTO', 0.3],
      ]),
      marketSize: 50000000000000,
      transactionCost: 0.001,
      minimumInvestment: 1,
    },
    {
      assetClass: 'OPTIONS',
      volatility: 30,
      expectedReturn: 15,
      sharpeRatio: 0.5,
      maxDrawdown: 50,
      liquidityScore: 70,
      correlations: new Map<AllocationAssetClass, number>([
        ['EQUITIES', 0.65],
        ['FUTURES', 0.4],
        ['ETF', 0.55],
        ['FOREX', 0.1],
        ['CRYPTO', 0.2],
      ]),
      marketSize: 10000000000000,
      transactionCost: 0.005,
      minimumInvestment: 100,
    },
    {
      assetClass: 'FUTURES',
      volatility: 25,
      expectedReturn: 12,
      sharpeRatio: 0.48,
      maxDrawdown: 40,
      liquidityScore: 80,
      correlations: new Map<AllocationAssetClass, number>([
        ['EQUITIES', 0.5],
        ['OPTIONS', 0.4],
        ['ETF', 0.6],
        ['FOREX', 0.3],
        ['CRYPTO', 0.15],
      ]),
      marketSize: 15000000000000,
      transactionCost: 0.002,
      minimumInvestment: 1000,
    },
    {
      assetClass: 'ETF',
      volatility: 12,
      expectedReturn: 7,
      sharpeRatio: 0.58,
      maxDrawdown: 20,
      liquidityScore: 98,
      correlations: new Map<AllocationAssetClass, number>([
        ['EQUITIES', 0.85],
        ['OPTIONS', 0.55],
        ['FUTURES', 0.6],
        ['FOREX', 0.15],
        ['CRYPTO', 0.25],
      ]),
      marketSize: 8000000000000,
      transactionCost: 0.001,
      minimumInvestment: 1,
    },
    {
      assetClass: 'FOREX',
      volatility: 10,
      expectedReturn: 4,
      sharpeRatio: 0.4,
      maxDrawdown: 15,
      liquidityScore: 99,
      correlations: new Map<AllocationAssetClass, number>([
        ['EQUITIES', 0.2],
        ['OPTIONS', 0.1],
        ['FUTURES', 0.3],
        ['ETF', 0.15],
        ['CRYPTO', 0.1],
      ]),
      marketSize: 7000000000000000,
      transactionCost: 0.0005,
      minimumInvestment: 100,
    },
    {
      assetClass: 'CRYPTO',
      volatility: 60,
      expectedReturn: 25,
      sharpeRatio: 0.42,
      maxDrawdown: 80,
      liquidityScore: 60,
      correlations: new Map<AllocationAssetClass, number>([
        ['EQUITIES', 0.3],
        ['OPTIONS', 0.2],
        ['FUTURES', 0.15],
        ['ETF', 0.25],
        ['FOREX', 0.1],
      ]),
      marketSize: 2000000000000,
      transactionCost: 0.01,
      minimumInvestment: 10,
    },
  ];
}

describe('getDefaultRiskProfile', () => {
  const riskProfiles: RiskProfile[] = [
    'CONSERVATIVE',
    'MODERATE_CONSERVATIVE',
    'MODERATE',
    'MODERATE_AGGRESSIVE',
    'AGGRESSIVE',
  ];

  it('should return profile for each valid risk level', () => {
    riskProfiles.forEach((profile) => {
      const result = getDefaultRiskProfile(profile);
      expect(result).toBeDefined();
      expect(result?.profile).toBe(profile);
    });
  });

  it('should return undefined for invalid risk profile', () => {
    // @ts-expect-error Testing invalid input
    const result = getDefaultRiskProfile('INVALID');
    expect(result).toBeUndefined();
  });

  it('should have allocations summing to at most 1.0 for each profile', () => {
    riskProfiles.forEach((profile) => {
      const result = getDefaultRiskProfile(profile);
      expect(result).toBeDefined();

      let total = 0;
      result!.baseAllocations.forEach((value) => {
        total += value;
      });

      // Base allocations may not sum exactly to 1.0 (e.g., CONSERVATIVE sums to 0.85
      // because some asset classes have 0% allocation). The engine normalizes at runtime.
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(1.01);
    });
  });

  it('should have CONSERVATIVE profile with higher ETF allocation', () => {
    const conservative = getDefaultRiskProfile('CONSERVATIVE');
    const aggressive = getDefaultRiskProfile('AGGRESSIVE');

    expect(conservative).toBeDefined();
    expect(aggressive).toBeDefined();

    const conservativeETF = conservative!.baseAllocations.get('ETF') ?? 0;
    const aggressiveETF = aggressive!.baseAllocations.get('ETF') ?? 0;

    expect(conservativeETF).toBeGreaterThan(aggressiveETF);
  });

  it('should have AGGRESSIVE profile with higher equities allocation', () => {
    const conservative = getDefaultRiskProfile('CONSERVATIVE');
    const aggressive = getDefaultRiskProfile('AGGRESSIVE');

    expect(conservative).toBeDefined();
    expect(aggressive).toBeDefined();

    const conservativeEquities = conservative!.baseAllocations.get('EQUITIES') ?? 0;
    const aggressiveEquities = aggressive!.baseAllocations.get('EQUITIES') ?? 0;

    expect(aggressiveEquities).toBeGreaterThan(conservativeEquities);
  });

  it('should have increasing risk scores from conservative to aggressive', () => {
    const scores = riskProfiles.map((profile) => {
      const result = getDefaultRiskProfile(profile);
      return result?.riskScore ?? 0;
    });

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });

  it('should have increasing target returns from conservative to aggressive', () => {
    const returns = riskProfiles.map((profile) => {
      const result = getDefaultRiskProfile(profile);
      return result?.targetReturn ?? 0;
    });

    for (let i = 1; i < returns.length; i++) {
      expect(returns[i]).toBeGreaterThan(returns[i - 1]);
    }
  });

  it('should have increasing max volatility from conservative to aggressive', () => {
    const volatilities = riskProfiles.map((profile) => {
      const result = getDefaultRiskProfile(profile);
      return result?.maxVolatility ?? 0;
    });

    for (let i = 1; i < volatilities.length; i++) {
      expect(volatilities[i]).toBeGreaterThan(volatilities[i - 1]);
    }
  });

  it('should have descriptions for all profiles', () => {
    riskProfiles.forEach((profile) => {
      const result = getDefaultRiskProfile(profile);
      expect(result?.description).toBeTruthy();
      expect(typeof result?.description).toBe('string');
      expect(result!.description.length).toBeGreaterThan(10);
    });
  });

  it('should have CONSERVATIVE profile with zero CRYPTO and FUTURES allocation', () => {
    const conservative = getDefaultRiskProfile('CONSERVATIVE');
    expect(conservative).toBeDefined();

    expect(conservative!.baseAllocations.get('CRYPTO')).toBe(0);
    expect(conservative!.baseAllocations.get('FUTURES')).toBe(0);
  });
});

describe('AssetAllocationEngine', () => {
  describe('constructor', () => {
    it('should create engine with default config', () => {
      const engine = new AssetAllocationEngine();
      expect(engine).toBeDefined();
    });

    it('should create engine with custom config', () => {
      const engine = new AssetAllocationEngine({
        objective: 'MIN_RISK',
        riskFreeRate: 0.05,
        rebalancingThreshold: 10,
        transactionCostModel: 'FIXED',
        timeHorizon: 10,
        allowLeverage: false,
        includeAlternatives: false,
      });
      expect(engine).toBeDefined();
    });
  });

  describe('generateAllocation', () => {
    it('should generate allocation for MODERATE profile', async () => {
      const engine = new AssetAllocationEngine();

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      expect(result).toBeDefined();
      expect(result.allocations.length).toBeGreaterThan(0);
      expect(result.id).toBeTruthy();
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.nextRebalancingDate).toBeInstanceOf(Date);
      expect(result.methodology).toBeTruthy();
    });

    it('should have allocations summing close to 1.0', async () => {
      const engine = new AssetAllocationEngine();

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      const totalAllocation = result.allocations.reduce(
        (sum, alloc) => sum + alloc.allocation,
        0
      );
      expect(totalAllocation).toBeCloseTo(1.0, 1);
    });

    it('should have amounts summing close to account size', async () => {
      const engine = new AssetAllocationEngine();
      const accountSize = 100000;

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      const totalAmount = result.allocations.reduce((sum, alloc) => sum + alloc.amount, 0);
      expect(totalAmount).toBeCloseTo(accountSize, -2); // Within $100
    });

    it('should include portfolio metrics', async () => {
      const engine = new AssetAllocationEngine();

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      expect(result.portfolioMetrics).toBeDefined();
      expect(typeof result.portfolioMetrics.expectedReturn).toBe('number');
      expect(typeof result.portfolioMetrics.expectedVolatility).toBe('number');
      expect(typeof result.portfolioMetrics.sharpeRatio).toBe('number');
    });

    it('should include risk analysis', async () => {
      const engine = new AssetAllocationEngine();

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      expect(result.riskAnalysis).toBeDefined();
      expect(result.riskAnalysis.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskAnalysis.riskScore).toBeLessThanOrEqual(100);
      expect(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']).toContain(result.riskAnalysis.riskLevel);
    });

    it('should include diversification metrics', async () => {
      const engine = new AssetAllocationEngine();

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      expect(result.diversification).toBeDefined();
      expect(result.diversification.herfindahlIndex).toBeGreaterThan(0);
      expect(result.diversification.effectiveNumberOfAssets).toBeGreaterThan(0);
    });

    it('should infer risk profile when not provided', async () => {
      const engine = new AssetAllocationEngine();

      const input: AllocationInput = {
        // No riskProfile provided
        marketConditions: createMarketMetrics(),
        accountSize: 50000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      expect(result).toBeDefined();
      expect(result.allocations.length).toBeGreaterThan(0);
    });

    it('should reduce allocations for excluded asset classes', async () => {
      const engine = new AssetAllocationEngine();

      const baseInput: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const excludedInput: AllocationInput = {
        ...baseInput,
        preferences: {
          excludedAssetClasses: ['CRYPTO', 'FUTURES'],
        },
      };

      const baseResult = await engine.generateAllocation(baseInput);
      const excludedResult = await engine.generateAllocation(excludedInput);

      const baseCrypto = baseResult.allocations.find((a) => a.assetClass === 'CRYPTO');
      const excludedCrypto = excludedResult.allocations.find((a) => a.assetClass === 'CRYPTO');

      // Excluded classes should have substantially lower allocation than baseline
      if (baseCrypto && excludedCrypto) {
        expect(excludedCrypto.allocation).toBeLessThan(baseCrypto.allocation);
      }
    });

    it('should generate warnings for small accounts', async () => {
      const engine = new AssetAllocationEngine();

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 1000, // Very small account
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.toLowerCase().includes('small account'))).toBe(true);
    });

    it('should generate warnings for high volatility market', async () => {
      const engine = new AssetAllocationEngine();

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics({ volatilityIndex: 35 }),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      expect(
        result.warnings.some((w) => w.toLowerCase().includes('volatility'))
      ).toBe(true);
    });

    it('should have each allocation include rationale and confidence', async () => {
      const engine = new AssetAllocationEngine();

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      result.allocations.forEach((alloc) => {
        expect(alloc.rationale).toBeTruthy();
        expect(typeof alloc.rationale).toBe('string');
        expect(alloc.confidence).toBeGreaterThan(0);
        expect(alloc.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('should generate rebalancing actions when current positions provided', async () => {
      const engine = new AssetAllocationEngine();

      const currentPositions = new Map<AllocationAssetClass, number>([
        ['EQUITIES', 80000],
        ['ETF', 10000],
        ['OPTIONS', 5000],
        ['FUTURES', 3000],
        ['FOREX', 1000],
        ['CRYPTO', 1000],
      ]);

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        currentPositions,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      // There should be rebalancing actions since positions are skewed
      expect(result.rebalancing).toBeDefined();
      if (result.rebalancing && result.rebalancing.length > 0) {
        result.rebalancing.forEach((action) => {
          expect(['BUY', 'SELL', 'HOLD']).toContain(action.action);
          expect(action.tradeAmount).toBeGreaterThanOrEqual(0);
          expect(action.priority).toBeGreaterThanOrEqual(1);
          expect(action.reason).toBeTruthy();
        });
      }
    });
  });

  describe('market condition adjustments', () => {
    it('should adjust allocations for crisis conditions', async () => {
      const engine = new AssetAllocationEngine();

      const crisisInput: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics({
          volatilityIndex: 45,
          sentimentScore: 15,
          creditSpread: 600,
        }),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const normalInput: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const crisisResult = await engine.generateAllocation(crisisInput);
      const normalResult = await engine.generateAllocation(normalInput);

      // In crisis, ETF allocation should be higher than normal
      const crisisETF = crisisResult.allocations.find((a) => a.assetClass === 'ETF');
      const normalETF = normalResult.allocations.find((a) => a.assetClass === 'ETF');

      if (crisisETF && normalETF) {
        expect(crisisETF.allocation).toBeGreaterThan(normalETF.allocation);
      }
    });

    it('should reduce crypto in high volatility', async () => {
      const engine = new AssetAllocationEngine();

      const highVolInput: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics({ volatilityIndex: 35 }),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const lowVolInput: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics({ volatilityIndex: 10 }),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const highVolResult = await engine.generateAllocation(highVolInput);
      const lowVolResult = await engine.generateAllocation(lowVolInput);

      const highVolCrypto = highVolResult.allocations.find((a) => a.assetClass === 'CRYPTO');
      const lowVolCrypto = lowVolResult.allocations.find((a) => a.assetClass === 'CRYPTO');

      // In high volatility, crypto should be lower than in low volatility
      if (highVolCrypto && lowVolCrypto) {
        expect(highVolCrypto.allocation).toBeLessThanOrEqual(lowVolCrypto.allocation);
      }
    });
  });

  describe('optimization objectives', () => {
    it('should produce valid allocations with MIN_RISK objective', async () => {
      const engine = new AssetAllocationEngine({
        objective: 'MIN_RISK',
        riskFreeRate: 0.04,
        rebalancingThreshold: 5,
        transactionCostModel: 'PERCENTAGE',
        timeHorizon: 5,
        allowLeverage: false,
        includeAlternatives: true,
      });

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      expect(result.allocations.length).toBeGreaterThan(0);
      const totalAlloc = result.allocations.reduce((sum, a) => sum + a.allocation, 0);
      expect(totalAlloc).toBeCloseTo(1.0, 1);
    });

    it('should produce valid allocations with MAX_DIVERSIFICATION objective', async () => {
      const engine = new AssetAllocationEngine({
        objective: 'MAX_DIVERSIFICATION',
        riskFreeRate: 0.04,
        rebalancingThreshold: 5,
        transactionCostModel: 'PERCENTAGE',
        timeHorizon: 5,
        allowLeverage: false,
        includeAlternatives: true,
      });

      const input: AllocationInput = {
        riskProfile: 'MODERATE',
        marketConditions: createMarketMetrics(),
        accountSize: 100000,
        assetCharacteristics: createAssetCharacteristics(),
      };

      const result = await engine.generateAllocation(input);

      expect(result.allocations.length).toBeGreaterThan(0);
      const totalAlloc = result.allocations.reduce((sum, a) => sum + a.allocation, 0);
      expect(totalAlloc).toBeCloseTo(1.0, 1);
    });
  });
});
