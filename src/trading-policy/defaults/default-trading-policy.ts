import { AutonomyMode } from "../enums";
import {
  EffectiveTradingPolicySchema,
  type EffectiveTradingPolicy,
} from "../schemas/effective-policy.schema";

/**
 * Default trading policy used as the baseline when no user-customized policy
 * exists. Calibrated for short-horizon day trading / HFT-microstructuring /
 * scalping (intraday holds, 5-min-bar-sized stops, fast cooldowns) per the
 * 2026-05-10 audit, replacing the previous swing-trading calibration.
 *
 * All nested preference sub-objects are passed as empty objects so Zod applies
 * their field-level defaults (which are themselves tuned for scalping in their
 * respective schema files).
 *
 * Key choices:
 * - Advisory-only autonomy (no autonomous execution)
 * - Real-time trading enabled
 * - Equities, ETFs, crypto, options, futures, and forex enabled
 * - No shorting or margin (user must opt-in)
 * - All protective overlays disabled (user must opt-in)
 * - No LLM providers pre-configured
 * - Tighter per-trade allocation (2% vs 5%) and concurrency (8 positions vs 20)
 *   reflecting the increased turnover and decreased per-position conviction
 *   characteristic of scalping
 * - Faster equity wash-trade cooldown (5s vs 30s) — FINRA Rule 5210 governs
 *   opposing-side wash trades; same-side intraday re-entry can be much faster
 * - Tighter daily-loss circuit breaker (2% vs 3%) reflecting that scalping
 *   strategies should fail fast rather than burn the day's risk budget on
 *   one bad regime
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
    maxSymbolConcentrationPct: 8,
    maxSectorConcentrationPct: 30,
    maxOpenPositions: 8,
    maxOpenOrders: 50,
    perTradeEquityAllocationPct: 2,
    perTradeCryptoAllocationPct: 2,
    // 5s same-side intraday re-entry cooldown for scalping. FINRA Rule 5210
    // governs opposing-side wash trades; same-side rapid re-entry off the
    // same setup is permitted within tighter bounds suited to 5-min-bar
    // strategies. Backend-legacy `TradingPolicy.equityWashTradeCooldownMs`
    // default of 30_000 ms remains the canonical row-level fallback for
    // accounts that have not opted into the scalping profile.
    equityWashTradeCooldownMs: 5_000,
    // 2% daily loss cap: tighter than the engine's 3% defaultRiskConfig
    // because scalping strategies should fail fast — three bad regimes at 3%
    // each is a 9% intraday burn before the kill-switch fires.
    maxDailyLossPercent: 0.02,
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
