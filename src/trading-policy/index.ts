/**
 * Trading-policy module: canonical `TradingPolicyJson` shape and
 * utils-tuned defaults for short-horizon day trading / scalping,
 * plus the SR-ported schema-based `EffectiveTradingPolicy` surface.
 *
 * Two surfaces coexist for backwards compatibility:
 *  - `./defaults` (legacy) — `DEFAULT_TRADING_POLICY_UTILS_TUNED`,
 *    `getUtilsTunedTradingPolicy`, `TradingPolicyJson`. Used by
 *    consumers that pre-date the SR refactor.
 *  - `./schemas` + `./defaults/default-trading-policy` (SR-ported) —
 *    Zod-validated `EffectiveTradingPolicy` with `AutonomyMode`,
 *    `OverlayType`, and 12+ sub-preference schemas. Used by the
 *    fund-policy editor and engine `effectivePolicy()`.
 */
export * from "./defaults";
export * from "./enums";
export * from "./schemas";
export { DEFAULT_TRADING_POLICY as DEFAULT_TRADING_POLICY_SCHEMA_BASED } from "./defaults/default-trading-policy";
