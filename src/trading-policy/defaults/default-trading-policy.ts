import { AutonomyMode } from "../enums";
import {
  EffectiveTradingPolicySchema,
  type EffectiveTradingPolicy,
} from "../schemas/effective-policy.schema";

/**
 * Conservative default trading policy used as the baseline when no
 * user-customized policy exists. All nested preference sub-objects are
 * passed as empty objects so Zod applies their field-level defaults.
 *
 * Key choices:
 * - Advisory-only autonomy (no autonomous execution)
 * - Real-time trading enabled
 * - Equities, ETFs, crypto, options, futures, and forex enabled
 * - No shorting or margin (user must opt-in)
 * - All protective overlays disabled (user must opt-in)
 * - No LLM providers pre-configured
 */
export const DEFAULT_TRADING_POLICY: EffectiveTradingPolicy =
  EffectiveTradingPolicySchema.parse({
    autonomyMode: AutonomyMode.ADVISORY_ONLY,
    realtimeTradingEnabled: true,
    paperTradingOnly: false,
    killSwitchEnabled: false,
    equitiesEnabled: true,
    etfsEnabled: true,
    cryptoEnabled: true,
    optionsEnabled: true,
    futuresEnabled: true,
    forexEnabled: true,
    shortingEnabled: false,
    marginEnabled: false,
    fractionalSharesEnabled: true,
    maxBuyingPowerUtilPct: 90,
    cashFloorPct: 10,
    maxGrossExposurePct: 100,
    maxNetExposurePct: 100,
    maxLeverage: 1,
    maxSymbolConcentrationPct: 15,
    maxSectorConcentrationPct: 30,
    maxOpenPositions: 20,
    maxOpenOrders: 50,
    macroOverlayEnabled: false,
    sectorOverlayEnabled: false,
    volatilityOverlayEnabled: false,
    liquidityStressOverlayEnabled: false,
    blackSwanProtectionEnabled: false,
    drawdownGuardianEnabled: false,
    correlationSpikeProtectionEnabled: false,
    newsEventRiskOverlayEnabled: false,
    exchangeHealthOverlayEnabled: false,
    dataQualitySentinelEnabled: false,
    miniModelProvider: null,
    miniModelId: null,
    normalModelProvider: null,
    normalModelId: null,
    advancedModelProvider: null,
    advancedModelId: null,
    autonomyPrefs: {},
    assetUniversePrefs: {},
    riskBudgetPrefs: {},
    signalConsumptionPrefs: {},
    executionPrefs: {},
    positionManagementPrefs: {},
    portfolioConstructionPrefs: {},
    overlayResponsePrefs: {},
    modelPrefs: {},
    auditNotificationPrefs: {},
  });
