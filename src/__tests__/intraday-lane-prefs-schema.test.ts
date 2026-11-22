import { describe, it, expect } from "vitest";
import {
  INTRADAY_LANE_PREFS_SCHEMA_VERSION,
  IntradayLanePrefsSchema,
  LaneSizingPrefsSchema,
  RiskBudgetPrefsSchema,
  EffectiveTradingPolicySchema,
  PolicyMutationSchema,
} from "../trading-policy/schemas";
import * as tradingPolicy from "../trading-policy";
import { DEFAULT_TRADING_POLICY } from "../trading-policy/defaults/default-trading-policy";

const ARMED = { armed: true, perLaneTradesPerDay: 3 } as const;

describe("IntradayLanePrefsSchema: armed must be explicit", () => {
  it("fails on {}", () => {
    expect(IntradayLanePrefsSchema.safeParse({}).success).toBe(false);
  });

  it("parses { armed: false } as disarmed", () => {
    expect(IntradayLanePrefsSchema.parse({ armed: false })).toEqual({ armed: false });
  });

  it("fails on null, a string armed and a non-object", () => {
    expect(IntradayLanePrefsSchema.safeParse(null).success).toBe(false);
    expect(IntradayLanePrefsSchema.safeParse({ armed: "true", perLaneTradesPerDay: 3 }).success).toBe(false);
    expect(IntradayLanePrefsSchema.safeParse("armed").success).toBe(false);
  });
});

describe("IntradayLanePrefsSchema: an absent cap refuses to arm", () => {
  it("fails on { armed: true } without perLaneTradesPerDay", () => {
    expect(IntradayLanePrefsSchema.safeParse({ armed: true }).success).toBe(false);
  });

  it("parses an armed document with a cap, and the type carries it", () => {
    const parsed = IntradayLanePrefsSchema.parse(ARMED);
    expect(parsed).toEqual(ARMED);
    if (parsed.armed) {
      const cap: number = parsed.perLaneTradesPerDay;
      expect(cap).toBe(3);
    }
  });

  it("parses a disarmed document that records a cap", () => {
    expect(IntradayLanePrefsSchema.parse({ armed: false, perLaneTradesPerDay: 3 })).toEqual({
      armed: false,
      perLaneTradesPerDay: 3,
    });
  });

  it("parses a full version-1 document", () => {
    const full = {
      version: INTRADAY_LANE_PREFS_SCHEMA_VERSION,
      armed: true,
      perLaneTradesPerDay: 2,
      maxConcurrentLanes: 4,
      entryCutoffBeforeOvernightSelectionMin: 15,
    };
    expect(IntradayLanePrefsSchema.parse(full)).toEqual(full);
  });

  it("fails on another version", () => {
    expect(IntradayLanePrefsSchema.safeParse({ ...ARMED, version: 2 }).success).toBe(false);
  });
});

describe("IntradayLanePrefsSchema: unknown keys are rejected on both arms", () => {
  it("rejects an unknown key on the armed arm", () => {
    expect(IntradayLanePrefsSchema.safeParse({ ...ARMED, perLaneTradesPerDya: 3 }).success).toBe(false);
  });

  it("rejects an unknown key on the disarmed arm", () => {
    expect(IntradayLanePrefsSchema.safeParse({ armed: false, unexpected: 1 }).success).toBe(false);
  });

  it("rejects the dropped reentryCooldownSec field", () => {
    expect(IntradayLanePrefsSchema.safeParse({ ...ARMED, reentryCooldownSec: 60 }).success).toBe(false);
  });

  it("rejects laneRisk, which this version does not carry", () => {
    expect(IntradayLanePrefsSchema.safeParse({ ...ARMED, laneRisk: {} }).success).toBe(false);
  });
});

describe("IntradayLanePrefsSchema: out-of-band values are rejected", () => {
  const outOfBand: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["cap 0", { perLaneTradesPerDay: 0 }],
    ["cap 51", { perLaneTradesPerDay: 51 }],
    ["cap fractional", { perLaneTradesPerDay: 2.5 }],
    ["cap negative", { perLaneTradesPerDay: -1 }],
    ["cap NaN", { perLaneTradesPerDay: Number.NaN }],
    ["cap Infinity", { perLaneTradesPerDay: Number.POSITIVE_INFINITY }],
    ["cap string", { perLaneTradesPerDay: "3" }],
    ["concurrent 0", { maxConcurrentLanes: 0 }],
    ["concurrent 17", { maxConcurrentLanes: 17 }],
    ["concurrent fractional", { maxConcurrentLanes: 1.5 }],
    ["cutoff -1", { entryCutoffBeforeOvernightSelectionMin: -1 }],
    ["cutoff 391", { entryCutoffBeforeOvernightSelectionMin: 391 }],
    ["cutoff fractional", { entryCutoffBeforeOvernightSelectionMin: 1.5 }],
  ];
  for (const [label, patch] of outOfBand) {
    it(`rejects ${label} when armed`, () => {
      expect(IntradayLanePrefsSchema.safeParse({ ...ARMED, ...patch }).success).toBe(false);
    });
    it(`rejects ${label} when disarmed`, () => {
      expect(IntradayLanePrefsSchema.safeParse({ armed: false, ...patch }).success).toBe(false);
    });
  }

  it("accepts the band edges", () => {
    for (const doc of [
      { armed: true, perLaneTradesPerDay: 1, maxConcurrentLanes: 1, entryCutoffBeforeOvernightSelectionMin: 0 },
      { armed: true, perLaneTradesPerDay: 50, maxConcurrentLanes: 16, entryCutoffBeforeOvernightSelectionMin: 390 },
    ]) {
      expect(IntradayLanePrefsSchema.safeParse(doc).success).toBe(true);
    }
  });
});

describe("LaneSizingPrefsSchema", () => {
  it("parses {} to {} with no invented defaults", () => {
    expect(LaneSizingPrefsSchema.parse({})).toEqual({});
  });

  it("parses fractions inside the band, including every governed row's seed", () => {
    const seeds = {
      maxRiskPerTradeFraction: 0.0025,
      maxMinuteVolumeParticipation: 0.02,
      maxAdvParticipation: 0.002,
      maxKellyFraction: 0.25,
      maxKellyCapMultipleOfFlat: 1,
    };
    expect(LaneSizingPrefsSchema.parse(seeds)).toEqual(seeds);
  });

  it("rejects an unknown key", () => {
    expect(LaneSizingPrefsSchema.safeParse({ maxRiskPerTradePct: 1.5 }).success).toBe(false);
  });

  const outOfBand: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["risk 0", { maxRiskPerTradeFraction: 0 }],
    ["risk as a percent", { maxRiskPerTradeFraction: 1.5 }],
    ["risk above 2%", { maxRiskPerTradeFraction: 0.021 }],
    ["minute participation 0", { maxMinuteVolumeParticipation: 0 }],
    ["minute participation 0.26", { maxMinuteVolumeParticipation: 0.26 }],
    ["adv participation 0.051", { maxAdvParticipation: 0.051 }],
    ["kelly fraction 1.01", { maxKellyFraction: 1.01 }],
    ["kelly fraction -0.1", { maxKellyFraction: -0.1 }],
    ["kelly cap 1.5", { maxKellyCapMultipleOfFlat: 1.5 }],
    ["kelly cap NaN", { maxKellyCapMultipleOfFlat: Number.NaN }],
  ];
  for (const [label, doc] of outOfBand) {
    it(`rejects ${label}`, () => {
      expect(LaneSizingPrefsSchema.safeParse(doc).success).toBe(false);
    });
  }
});

describe("riskBudgetPrefs.laneSizing is carried without changing existing policies", () => {
  it("RiskBudgetPrefsSchema output for {} has no laneSizing key", () => {
    expect("laneSizing" in RiskBudgetPrefsSchema.parse({})).toBe(false);
  });

  it("the default policy parses with no laneSizing key", () => {
    const parsed = EffectiveTradingPolicySchema.parse(structuredClone(DEFAULT_TRADING_POLICY));
    expect("laneSizing" in parsed.riskBudgetPrefs).toBe(false);
    expect(parsed).not.toHaveProperty("intradayLanePrefs");
  });

  it("carries a set laneSizing through the effective policy (it is not stripped)", () => {
    const policy = structuredClone(DEFAULT_TRADING_POLICY);
    const parsed = EffectiveTradingPolicySchema.parse({
      ...policy,
      riskBudgetPrefs: { laneSizing: { maxRiskPerTradeFraction: 0.002 } },
    });
    expect(parsed.riskBudgetPrefs.laneSizing).toEqual({ maxRiskPerTradeFraction: 0.002 });
  });

  it("rejects an unknown key inside riskBudgetPrefs.laneSizing", () => {
    expect(
      RiskBudgetPrefsSchema.safeParse({ laneSizing: { maxRiskPerTradeFractoin: 0.002 } }).success,
    ).toBe(false);
  });

  it("the effective policy strips an intradayLanePrefs column rather than parsing it", () => {
    const parsed = EffectiveTradingPolicySchema.parse({
      ...structuredClone(DEFAULT_TRADING_POLICY),
      intradayLanePrefs: { anything: "goes" },
    });
    expect(parsed).not.toHaveProperty("intradayLanePrefs");
  });

  it("a policy mutation can set one laneSizing leaf", () => {
    const parsed = PolicyMutationSchema.parse({
      riskBudgetPrefs: { laneSizing: { maxAdvParticipation: 0.001 } },
    });
    expect(parsed.riskBudgetPrefs?.laneSizing).toEqual({ maxAdvParticipation: 0.001 });
  });
});

describe("package surface", () => {
  it("exposes the schemas through the trading-policy module src/index.ts re-exports as tradingPolicy", () => {
    expect(tradingPolicy.IntradayLanePrefsSchema).toBe(IntradayLanePrefsSchema);
    expect(tradingPolicy.LaneSizingPrefsSchema).toBe(LaneSizingPrefsSchema);
    expect(tradingPolicy.INTRADAY_LANE_PREFS_SCHEMA_VERSION).toBe(1);
  });
});
