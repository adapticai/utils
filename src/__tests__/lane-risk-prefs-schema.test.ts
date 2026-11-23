import { describe, it, expect } from "vitest";
import {
  LANE_RISK_PREFS_SCHEMA_VERSION,
  LaneRiskPrefsSchema,
  RiskBudgetPrefsSchema,
  EffectiveTradingPolicySchema,
  PolicyMutationSchema,
} from "../trading-policy/schemas";
import { DEFAULT_TRADING_POLICY } from "../trading-policy/defaults/default-trading-policy";

const DAILY = { reduceAt: 0.01, noNewEntriesAt: 0.015, flattenAt: 0.02, haltAt: 0.03 } as const;
const WEEKLY = { reduceAt: 0.02, noNewEntriesAt: 0.03, flattenAt: 0.04, haltAt: 0.05 } as const;

/** Every field set, at the engine's governed seed values. */
const FULL = {
  perTradeMaxLossR: 1.5,
  perTradeMaxLossPctEquity: 0.005,
  laneDailyMaxLossR: 3,
  laneDailyMaxLossPctEquity: 0.01,
  setupDailyMaxLossR: 5,
  clusterMaxOpenRiskPctEquity: 0.0075,
  clusterMaxLanes: 3,
  portfolioMaxOpenRiskPctEquity: 0.02,
  accountDailyDrawdown: DAILY,
  accountWeeklyDrawdown: WEEKLY,
  grossExposureMaxPctEquity: 1,
  netBetaRiskMaxPctEquity: 0.01,
  nameConcentrationMaxPctEquity: 0.1,
  ordersPerLanePerMin: 10,
  ordersPerAccountPerMin: 120,
  cancelToFillRatioMax: 5,
} as const;

describe("LaneRiskPrefsSchema", () => {
  it("is version 1", () => {
    expect(LANE_RISK_PREFS_SCHEMA_VERSION).toBe(1);
  });

  it("parses {} to {} with no invented defaults", () => {
    expect(LaneRiskPrefsSchema.parse({})).toEqual({});
  });

  it("parses every field at the governed seeds unchanged", () => {
    expect(LaneRiskPrefsSchema.parse(FULL)).toEqual(FULL);
  });

  it("rejects an unknown key, including a misspelling and a version field", () => {
    expect(LaneRiskPrefsSchema.safeParse({ perTradeMaxLosR: 1 }).success).toBe(false);
    expect(LaneRiskPrefsSchema.safeParse({ version: "1" }).success).toBe(false);
  });

  const outOfBand: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["a zero limit", { perTradeMaxLossR: 0 }],
    ["a negative limit", { laneDailyMaxLossPctEquity: -0.01 }],
    ["a percent where a fraction is meant", { perTradeMaxLossPctEquity: 0.5 }],
    ["NaN", { netBetaRiskMaxPctEquity: Number.NaN }],
    ["Infinity", { grossExposureMaxPctEquity: Number.POSITIVE_INFINITY }],
    ["a string", { cancelToFillRatioMax: "5" }],
    ["a fractional count", { clusterMaxLanes: 2.5 }],
    ["an order rate past the broker ceiling less headroom", { ordersPerAccountPerMin: 181 }],
    ["a gross ceiling past 4x", { grossExposureMaxPctEquity: 4.01 }],
  ];
  for (const [label, patch] of outOfBand) {
    it(`rejects ${label}`, () => {
      expect(LaneRiskPrefsSchema.safeParse(patch).success).toBe(false);
    });
  }

  it("rejects a descending ladder and a ladder with a missing rung", () => {
    expect(
      LaneRiskPrefsSchema.safeParse({ accountDailyDrawdown: { ...DAILY, flattenAt: 0.012 } }).success,
    ).toBe(false);
    const { haltAt: _omitted, ...threeRungs } = DAILY;
    expect(LaneRiskPrefsSchema.safeParse({ accountDailyDrawdown: threeRungs }).success).toBe(false);
    expect(
      LaneRiskPrefsSchema.safeParse({ accountWeeklyDrawdown: { ...WEEKLY, extra: 1 } }).success,
    ).toBe(false);
  });

  it("accepts a ladder with equal rungs", () => {
    const flat = { reduceAt: 0.02, noNewEntriesAt: 0.02, flattenAt: 0.02, haltAt: 0.02 };
    expect(LaneRiskPrefsSchema.safeParse({ accountDailyDrawdown: flat }).success).toBe(true);
  });
});

describe("riskBudgetPrefs.laneRisk", () => {
  it("is absent when unset, so a policy without it parses exactly as before", () => {
    const parsed = RiskBudgetPrefsSchema.parse({});
    expect("laneRisk" in parsed).toBe(false);
    expect(EffectiveTradingPolicySchema.parse(DEFAULT_TRADING_POLICY).riskBudgetPrefs.laneRisk).toBeUndefined();
  });

  it("is carried through the effective policy when set", () => {
    const parsed = EffectiveTradingPolicySchema.parse({
      ...DEFAULT_TRADING_POLICY,
      riskBudgetPrefs: { ...DEFAULT_TRADING_POLICY.riskBudgetPrefs, laneRisk: FULL },
    });
    expect(parsed.riskBudgetPrefs.laneRisk).toEqual(FULL);
  });

  it("fails the effective policy on a malformed laneRisk rather than dropping it", () => {
    const result = EffectiveTradingPolicySchema.safeParse({
      ...DEFAULT_TRADING_POLICY,
      riskBudgetPrefs: { ...DEFAULT_TRADING_POLICY.riskBudgetPrefs, laneRisk: { perTradeMaxLossR: 0 } },
    });
    expect(result.success).toBe(false);
  });

  it("a mutation may set one scalar, but never a partial ladder or an unknown key", () => {
    expect(
      PolicyMutationSchema.safeParse({ riskBudgetPrefs: { laneRisk: { perTradeMaxLossR: 1.2 } } }).success,
    ).toBe(true);
    expect(
      PolicyMutationSchema.safeParse({
        riskBudgetPrefs: { laneRisk: { accountDailyDrawdown: { haltAt: 0.02 } } },
      }).success,
    ).toBe(false);
    expect(
      PolicyMutationSchema.safeParse({
        riskBudgetPrefs: { laneRisk: { accountDailyDrawdown: { ...DAILY, flattenAt: 0.012 } } },
      }).success,
    ).toBe(false);
    expect(
      PolicyMutationSchema.safeParse({ riskBudgetPrefs: { laneRisk: { perTradeMaxLosR: 1 } } }).success,
    ).toBe(false);
  });
});
