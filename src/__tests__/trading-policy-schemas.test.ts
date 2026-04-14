import { describe, it, expect } from "vitest";
import {
  AutonomyPrefsSchema,
  AssetUniversePrefsSchema,
  RiskBudgetPrefsSchema,
  SignalConsumptionPrefsSchema,
  ExecutionPrefsSchema,
  PositionManagementPrefsSchema,
  PortfolioConstructionPrefsSchema,
  OverlayResponsePrefsSchema,
  ModelPrefsSchema,
  AuditNotificationPrefsSchema,
  PolicyMutationSchema,
  EffectiveTradingPolicySchema,
} from "../trading-policy/schemas";
import { DEFAULT_TRADING_POLICY } from "../trading-policy/defaults/default-trading-policy";
import {
  AutonomyMode,
  OverlayType,
  LlmProvider,
} from "../trading-policy/enums";

describe("AutonomyPrefsSchema", () => {
  it("accepts empty object and applies defaults", () => {
    const result = AutonomyPrefsSchema.parse({});
    expect(result.autoPauseOnIncident).toBe(true);
    expect(result.autoPauseOnBlackSwan).toBe(true);
    expect(result.requireHumanApprovalFor.reversals).toBe(false);
    expect(result.requireHumanApprovalFor.shortSales).toBe(true);
    expect(result.allowedSessions.regular).toBe(true);
    expect(result.allowedSessions.premarket).toBe(false);
  });

  it("accepts partial overrides", () => {
    const result = AutonomyPrefsSchema.parse({
      autoPauseOnIncident: false,
      requireHumanApprovalFor: { reversals: true },
    });
    expect(result.autoPauseOnIncident).toBe(false);
    expect(result.requireHumanApprovalFor.reversals).toBe(true);
    expect(result.requireHumanApprovalFor.shortSales).toBe(true);
  });

  it("rejects invalid types", () => {
    expect(() =>
      AutonomyPrefsSchema.parse({ autoPauseOnIncident: "yes" }),
    ).toThrow();
  });

  it("applies defaults for nested requireHumanApprovalFor fields", () => {
    const result = AutonomyPrefsSchema.parse({});
    expect(result.requireHumanApprovalFor.firstTradeInSymbol).toBe(false);
    expect(result.requireHumanApprovalFor.leverageIncreases).toBe(true);
    expect(result.requireHumanApprovalFor.concentratedPositions).toBe(true);
    expect(result.requireHumanApprovalFor.largeNotionalOrders).toBe(true);
    expect(result.requireHumanApprovalFor.largeNotionalThreshold).toBe(50000);
    expect(result.requireHumanApprovalFor.portfolioLiquidation).toBe(true);
    expect(result.requireHumanApprovalFor.closeAllOrdersAndPositions).toBe(
      true,
    );
    expect(result.requireHumanApprovalFor.policyMutations).toBe(true);
    expect(result.requireHumanApprovalFor.advancedModelEscalations).toBe(false);
  });

  it("applies defaults for allowedSessions", () => {
    const result = AutonomyPrefsSchema.parse({});
    expect(result.allowedSessions.afterHours).toBe(false);
    expect(result.allowedSessions.overnight).toBe(false);
    expect(result.allowedSessions.weekends).toBe(false);
  });

  it("applies defaults for auto-pause thresholds", () => {
    const result = AutonomyPrefsSchema.parse({});
    expect(result.excessSlippageThresholdPct).toBe(2);
    expect(result.modelConfidenceCollapseThreshold).toBe(30);
    expect(result.autoPauseOnExcessSlippage).toBe(false);
    expect(result.autoPauseOnModelConfidenceCollapse).toBe(false);
  });

  it("rejects out-of-range slippage threshold", () => {
    expect(() =>
      AutonomyPrefsSchema.parse({ excessSlippageThresholdPct: -1 }),
    ).toThrow();
    expect(() =>
      AutonomyPrefsSchema.parse({ excessSlippageThresholdPct: 101 }),
    ).toThrow();
  });
});

describe("AssetUniversePrefsSchema", () => {
  it("accepts empty object and applies defaults", () => {
    const result = AssetUniversePrefsSchema.parse({});
    expect(result.equitiesDirection).toBe("long_only");
    expect(result.cryptoSpotOnly).toBe(true);
    expect(result.leveragedEtfsEnabled).toBe(false);
    expect(result.deniedSymbols).toEqual([]);
  });

  it("accepts string arrays", () => {
    const result = AssetUniversePrefsSchema.parse({
      deniedSymbols: ["MEME1", "MEME2"],
      allowedSectors: ["Technology"],
    });
    expect(result.deniedSymbols).toEqual(["MEME1", "MEME2"]);
    expect(result.allowedSectors).toEqual(["Technology"]);
  });

  it("validates direction enum", () => {
    expect(() =>
      AssetUniversePrefsSchema.parse({ equitiesDirection: "yolo" }),
    ).toThrow();
  });

  it("applies defaults for all direction fields", () => {
    const result = AssetUniversePrefsSchema.parse({});
    expect(result.etfsDirection).toBe("long_only");
    expect(result.cryptoDirection).toBe("long_only");
    expect(result.optionsDirection).toBe("long_only");
  });

  it("accepts market_neutral for equities", () => {
    const result = AssetUniversePrefsSchema.parse({
      equitiesDirection: "market_neutral",
    });
    expect(result.equitiesDirection).toBe("market_neutral");
  });

  it("applies defaults for liquidity filters", () => {
    const result = AssetUniversePrefsSchema.parse({});
    expect(result.minMarketCapMillions).toBe(0);
    expect(result.minAvgDailyVolume).toBe(0);
    expect(result.minPrice).toBe(0);
    expect(result.maxPrice).toBe(0);
    expect(result.maxSpreadPct).toBe(0);
    expect(result.minLiquidityScore).toBe(0);
  });

  it("applies defaults for product flags", () => {
    const result = AssetUniversePrefsSchema.parse({});
    expect(result.inverseEtfsEnabled).toBe(false);
    expect(result.memeStocksEnabled).toBe(false);
    expect(result.ipoParticipationEnabled).toBe(false);
    expect(result.borrowAvailabilityRequired).toBe(true);
    expect(result.maxBorrowFeePct).toBe(5);
  });

  it("rejects negative minMarketCapMillions", () => {
    expect(() =>
      AssetUniversePrefsSchema.parse({ minMarketCapMillions: -10 }),
    ).toThrow();
  });
});

describe("RiskBudgetPrefsSchema", () => {
  it("accepts empty object and applies defaults", () => {
    const result = RiskBudgetPrefsSchema.parse({});
    expect(result.maxMarginUtilPct).toBe(50);
    expect(result.maxRiskPerTradePct).toBe(2);
    expect(result.maxDrawdownFromPeakPct).toBe(20);
    expect(result.gapRiskSensitivity).toBe("medium");
  });

  it("rejects out-of-range percentages", () => {
    expect(() =>
      RiskBudgetPrefsSchema.parse({ maxMarginUtilPct: 150 }),
    ).toThrow();
    expect(() =>
      RiskBudgetPrefsSchema.parse({ maxRiskPerTradePct: -5 }),
    ).toThrow();
  });

  it("applies defaults for concentration limits", () => {
    const result = RiskBudgetPrefsSchema.parse({});
    expect(result.maxIssuerConcentrationPct).toBe(20);
    expect(result.maxThemeConcentrationPct).toBe(25);
    expect(result.maxAssetClassConcentrationPct).toBe(50);
    expect(result.maxCountryConcentrationPct).toBe(40);
    expect(result.maxCurrencyExposurePct).toBe(30);
    expect(result.maxCorrelatedExposurePct).toBe(40);
  });

  it("applies defaults for loss limits", () => {
    const result = RiskBudgetPrefsSchema.parse({});
    expect(result.maxLossPerDayPct).toBe(5);
    expect(result.maxLossPerWeekPct).toBe(10);
    expect(result.maxLossPerMonthPct).toBe(15);
  });

  it("applies defaults for exposure caps", () => {
    const result = RiskBudgetPrefsSchema.parse({});
    expect(result.overnightExposureCapPct).toBe(50);
    expect(result.weekendExposureCapPct).toBe(30);
    expect(result.eventRiskExposureCapPct).toBe(40);
  });

  it("allows betaTarget to be null", () => {
    const result = RiskBudgetPrefsSchema.parse({});
    expect(result.betaTarget).toBeNull();
  });

  it("allows betaTarget to be a number", () => {
    const result = RiskBudgetPrefsSchema.parse({ betaTarget: 1.0 });
    expect(result.betaTarget).toBe(1.0);
  });

  it("validates gapRiskSensitivity enum", () => {
    expect(() =>
      RiskBudgetPrefsSchema.parse({ gapRiskSensitivity: "extreme" }),
    ).toThrow();
  });
});

describe("SignalConsumptionPrefsSchema", () => {
  it("accepts empty object and applies defaults", () => {
    const result = SignalConsumptionPrefsSchema.parse({});
    expect(result.minConfidenceByDefault).toBe(60);
    expect(result.reversalHandlingPolicy).toBe("close_only");
    expect(result.conflictHandlingOpenOrders).toBe("cancel_conflicting");
    expect(result.noTradeWindows).toEqual([]);
  });

  it("accepts no-trade window configuration", () => {
    const result = SignalConsumptionPrefsSchema.parse({
      noTradeWindows: [{ name: "Lunch", startTime: "12:00", endTime: "13:00" }],
    });
    expect(result.noTradeWindows).toHaveLength(1);
    expect(result.noTradeWindows[0].name).toBe("Lunch");
    expect(result.noTradeWindows[0].enabled).toBe(true);
    expect(result.noTradeWindows[0].daysOfWeek).toEqual([]);
  });

  it("validates reversal policy enum", () => {
    expect(() =>
      SignalConsumptionPrefsSchema.parse({ reversalHandlingPolicy: "yolo" }),
    ).toThrow();
  });

  it("applies defaults for cooldown timers", () => {
    const result = SignalConsumptionPrefsSchema.parse({});
    expect(result.cooldownAfterEntrySeconds).toBe(60);
    expect(result.cooldownAfterExitSeconds).toBe(120);
    expect(result.cooldownAfterStopOutSeconds).toBe(300);
    expect(result.cooldownAfterFailedTradeSeconds).toBe(180);
    expect(result.duplicateSignalSuppressionWindowSeconds).toBe(300);
  });

  it("applies defaults for confidence and reward filters", () => {
    const result = SignalConsumptionPrefsSchema.parse({});
    expect(result.minExpectedRewardRiskRatio).toBe(1.5);
    expect(result.minExpectedEdgePct).toBe(0);
    expect(result.maxSignalAgeSeconds).toBe(300);
    expect(result.minConvictionDeltaToModify).toBe(10);
  });

  it("applies defaults for earnings blackout", () => {
    const result = SignalConsumptionPrefsSchema.parse({});
    expect(result.earningsBlackoutEnabled).toBe(false);
    expect(result.earningsBlackoutHoursBefore).toBe(24);
    expect(result.earningsBlackoutHoursAfter).toBe(2);
  });

  it("accepts strategy priority rules", () => {
    const result = SignalConsumptionPrefsSchema.parse({
      strategyPriorityRules: [
        { strategy: "momentum", priority: 1 },
        { strategy: "mean_reversion", priority: 2 },
      ],
    });
    expect(result.strategyPriorityRules).toHaveLength(2);
    expect(result.strategyPriorityRules[0].strategy).toBe("momentum");
  });

  it("validates conflict handling enum", () => {
    expect(() =>
      SignalConsumptionPrefsSchema.parse({
        conflictHandlingOpenOrders: "invalid",
      }),
    ).toThrow();
  });

  it("accepts record-based confidence overrides", () => {
    const result = SignalConsumptionPrefsSchema.parse({
      minConfidenceByAssetClass: { equity: 70, crypto: 80 },
      minConfidenceByStrategy: { momentum: 65 },
    });
    expect(result.minConfidenceByAssetClass["equity"]).toBe(70);
    expect(result.minConfidenceByStrategy["momentum"]).toBe(65);
  });
});

describe("ExecutionPrefsSchema", () => {
  it("accepts empty object and applies defaults", () => {
    const result = ExecutionPrefsSchema.parse({});
    expect(result.preferredOrderType).toBe("limit");
    expect(result.defaultTimeInForce).toBe("day");
    expect(result.executionBias).toBe("neutral");
    expect(result.maxSlippageTolerancePct).toBe(1.0);
    expect(result.failureBehavior).toBe("fail_safe");
  });

  it("validates order type enum", () => {
    expect(() =>
      ExecutionPrefsSchema.parse({ preferredOrderType: "twap" }),
    ).toThrow();
  });

  it("applies defaults for allowed order types", () => {
    const result = ExecutionPrefsSchema.parse({});
    expect(result.allowedOrderTypes).toEqual([
      "market",
      "limit",
      "stop",
      "trailing_stop",
    ]);
  });

  it("applies defaults for price collar settings", () => {
    const result = ExecutionPrefsSchema.parse({});
    expect(result.priceCollarEnabled).toBe(true);
    expect(result.priceCollarPct).toBe(2);
  });

  it("applies defaults for reprice settings", () => {
    const result = ExecutionPrefsSchema.parse({});
    expect(result.repriceEnabled).toBe(false);
    expect(result.repriceMaxAttempts).toBe(3);
    expect(result.repriceIntervalSeconds).toBe(30);
    expect(result.cancelReplaceTimeoutSeconds).toBe(60);
  });

  it("applies defaults for sizing and rounding", () => {
    const result = ExecutionPrefsSchema.parse({});
    expect(result.sizingMethod).toBe("notional");
    expect(result.lotRoundingBehavior).toBe("round_down");
  });

  it("applies defaults for session behavior", () => {
    const result = ExecutionPrefsSchema.parse({});
    expect(result.afterHoursExecutionBehavior).toBe("limit_only");
    expect(result.partialFillPolicy).toBe("accept_partial");
  });

  it("rejects invalid time in force", () => {
    expect(() =>
      ExecutionPrefsSchema.parse({ defaultTimeInForce: "until_cancelled" }),
    ).toThrow();
  });

  it("accepts custom slippage tolerance", () => {
    const result = ExecutionPrefsSchema.parse({ maxSlippageTolerancePct: 1.5 });
    expect(result.maxSlippageTolerancePct).toBe(1.5);
  });

  it("rejects negative slippage tolerance", () => {
    expect(() =>
      ExecutionPrefsSchema.parse({ maxSlippageTolerancePct: -0.5 }),
    ).toThrow();
  });
});

describe("PositionManagementPrefsSchema", () => {
  it("accepts empty object and applies defaults", () => {
    const result = PositionManagementPrefsSchema.parse({});
    expect(result.defaultStopLossMethod).toBe("trailing_stop");
    expect(result.scaleInEnabled).toBe(false);
    expect(result.trailingStopTighteningRules).toHaveLength(3);
    expect(result.trailingStopTighteningRules[0].profitThresholdPct).toBe(3);
  });
});

describe("PortfolioConstructionPrefsSchema", () => {
  it("accepts empty object and applies defaults", () => {
    const result = PortfolioConstructionPrefsSchema.parse({});
    expect(result.driftThresholdPct).toBe(5);
    expect(result.autonomousRebalancing).toBe(false);
    expect(result.portfolioCircuitBreakerEnabled).toBe(true);
  });
});

describe("OverlayResponsePrefsSchema", () => {
  it("accepts empty object", () => {
    const result = OverlayResponsePrefsSchema.parse({});
    expect(result.overlayResponses).toEqual({});
  });

  it("accepts a valid overlay type config", () => {
    const result = OverlayResponsePrefsSchema.parse({
      overlayResponses: {
        [OverlayType.BLACK_SWAN]: {
          pauseRealtimeTrading: true,
          cancelAllOpenOrders: true,
        },
      },
    });
    expect(
      result.overlayResponses[OverlayType.BLACK_SWAN]?.pauseRealtimeTrading,
    ).toBe(true);
  });
});

describe("ModelPrefsSchema", () => {
  it("accepts empty object and applies defaults", () => {
    const result = ModelPrefsSchema.parse({});
    expect(result.maxCostPerDayUsd).toBe(10);
    expect(result.latencyTargetMs).toBe(5000);
    expect(result.toolUsePermissionsByTier.advanced?.writeTools).toBe(true);
    expect(result.toolUsePermissionsByTier.mini?.writeTools).toBe(false);
  });
});

describe("AuditNotificationPrefsSchema", () => {
  it("accepts empty object and applies defaults", () => {
    const result = AuditNotificationPrefsSchema.parse({});
    expect(result.notifyOnAutonomousActions).toBe(true);
    expect(result.auditDetailLevel).toBe("standard");
    expect(result.retainDecisionArtifactsDays).toBe(90);
  });
});

describe("PolicyMutationSchema", () => {
  it("accepts empty object", () => {
    const result = PolicyMutationSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts partial policy fields", () => {
    const result = PolicyMutationSchema.parse({
      realtimeTradingEnabled: false,
      riskBudgetPrefs: { maxLossPerDayPct: 2 },
    });
    expect(result.realtimeTradingEnabled).toBe(false);
  });

  it("accepts model provider fields", () => {
    const result = PolicyMutationSchema.parse({
      miniModelProvider: LlmProvider.ANTHROPIC,
      miniModelId: "claude-sonnet-4-6",
    });
    expect(result.miniModelProvider).toBe("ANTHROPIC");
  });
});

describe("EffectiveTradingPolicySchema", () => {
  it("validates a full effective policy", () => {
    const result = EffectiveTradingPolicySchema.safeParse(
      DEFAULT_TRADING_POLICY,
    );
    expect(result.success).toBe(true);
  });
});

describe("DEFAULT_TRADING_POLICY", () => {
  it("has conservative defaults", () => {
    expect(DEFAULT_TRADING_POLICY.autonomyMode).toBe(
      AutonomyMode.ADVISORY_ONLY,
    );
    expect(DEFAULT_TRADING_POLICY.realtimeTradingEnabled).toBe(true);
    expect(DEFAULT_TRADING_POLICY.shortingEnabled).toBe(false);
    expect(DEFAULT_TRADING_POLICY.cryptoEnabled).toBe(true);
    expect(DEFAULT_TRADING_POLICY.miniModelProvider).toBeNull();
  });

  it("has fully expanded nested defaults", () => {
    expect(DEFAULT_TRADING_POLICY.autonomyPrefs.autoPauseOnIncident).toBe(true);
    expect(DEFAULT_TRADING_POLICY.executionPrefs.preferredOrderType).toBe(
      "limit",
    );
    expect(DEFAULT_TRADING_POLICY.riskBudgetPrefs.maxDrawdownFromPeakPct).toBe(
      20,
    );
  });
});
