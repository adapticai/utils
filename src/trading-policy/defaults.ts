/**
 * Utils-tuned trading-policy defaults.
 *
 * Re-exports the canonical `TradingPolicyJson` shape from
 * `@adaptic/backend-legacy` (sub-project 2 Area A1) and provides a
 * scalping / short-horizon day-trading calibration as
 * `DEFAULT_TRADING_POLICY_UTILS_TUNED`. The canonical
 * `DEFAULT_TRADING_POLICY` exported by backend-legacy is the
 * lowest-precedence safe fallback consumed by `effectivePolicy()`;
 * the utils-tuned variant collapses the SR `EffectiveTradingPolicy`
 * tunings (per `feat/scalping-defaults-2026-05-10` on
 * `@adaptic/utils` `stable-release`) into the JSON-path locations
 * defined by the canonical shape.
 *
 * Calibration sources:
 *  - perTradeEquityPct=0.02, perTradeCryptoPct=0.02 — SR
 *    `perTradeEquityAllocationPct=2`, `perTradeCryptoAllocationPct=2`
 *  - equityWashTradeCooldownMs=5_000 — SR scalping cooldown vs the
 *    canonical 30_000 ms FINRA-5210 row-level fallback
 *  - scalping subgroup populated with the 12 SR W3-3 fields
 *  - assetClasses: equity+crypto+options enabled (SR baseline)
 *
 * Charter §2.4 fund-scope: all overrides expressed here are
 * fund-scope-safe (F2 allocation, F3 risk, F4 autonomy, F5 sentiment,
 * F7 backtest). No org-scope-only fields are set.
 *
 * @see TradingPolicyJson — canonical shape contract
 * @see effectivePolicy — precedence-ordered read-time merger
 */
import type { TradingPolicyJson } from "@adaptic/backend-legacy";

export type { TradingPolicyJson } from "@adaptic/backend-legacy";
export { DEFAULT_TRADING_POLICY } from "@adaptic/backend-legacy";

/**
 * Utils-tuned defaults for short-horizon day trading / scalping. Use as
 * a fund-level override (`Fund.tradingOverrides`) on funds that opt
 * into the scalping profile. Do NOT install at org level — the
 * canonical `DEFAULT_TRADING_POLICY` is the org-wide safe fallback.
 */
export const DEFAULT_TRADING_POLICY_UTILS_TUNED: TradingPolicyJson = {
  autonomy: {
    enableAutoEntry: false,
    enableAutoExit: false,
    enableAutoRebalance: false,
    requireHumanApprovalAboveNotional: 25_000,
  },
  risk: {
    maxPortfolioVarPct: 0.05,
    maxSinglePositionPct: 0.08,
    maxSectorExposurePct: 0.3,
    maxAssetClassPct: {
      equity: 0.95,
      crypto: 0.25,
      options: 0.2,
    },
    minBuyingPowerReservePct: 0.1,
  },
  allocation: {
    perTradeEquityPct: 0.02,
    perTradeCryptoPct: 0.02,
    perTradeOptionsPct: 0.01,
    autoAllocation: true,
  },
  scalping: {
    enableScalping: true,
    maxConcurrentScalps: 8,
    minHoldSeconds: 30,
    maxHoldSeconds: 1_800,
    profitTargetBps: 25,
    stopLossBps: 15,
    requireRSIConfirm: true,
    requireMACDConfirm: false,
    requireVolumeSurge: true,
    cooldownAfterLossMs: 60_000,
    cooldownAfterWinMs: 10_000,
    maxScalpsPerSession: 40,
  },
  compliance: {
    equityWashTradeCooldownMs: 5_000,
    restrictedTickerOverrides: [],
    requireAuditLogForAll: true,
  },
  assetClasses: {
    equity: true,
    crypto: true,
    options: true,
  },
  sentiment: {
    minSentimentScoreToEnter: -0.2,
    maxNegativeSentimentToHold: -0.6,
    requireRecentNews: false,
    newsLookbackMinutes: 30,
  },
  backtest: {
    defaultUniverse: [],
    defaultPeriodDays: 30,
  },
};

/**
 * Returns a frozen deep-copy of the utils-tuned defaults. Use this when
 * passing the defaults into mutable downstream code paths to guard
 * against accidental in-place mutation of the shared constant.
 */
export const getUtilsTunedTradingPolicy = (): TradingPolicyJson => {
  return Object.freeze(
    JSON.parse(JSON.stringify(DEFAULT_TRADING_POLICY_UTILS_TUNED)),
  ) as TradingPolicyJson;
};
