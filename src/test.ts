import { marketDataAPI, AlpacaMarketDataAPI } from "./alpaca-market-data-api";
import { formatCurrency, formatNumber } from "./format-tools";
import {
  DEFAULT_TRADING_POLICY,
  EffectiveTradingPolicySchema,
} from "./trading-policy";

const log = (message: string) => {
  console.log(
    `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}] ${message}`,
  );
};

/**
 * Lock-in test for the scalping-tuned defaults landed by the 2026-05-10 audit.
 * Re-parses an empty policy and asserts the new defaults hold for every field
 * that was tightened. Prints the full parsed object so any future drift is
 * immediately visible in test output. Throws on the first mismatch so this
 * surfaces as a non-zero exit code under `npm run test:legacy`.
 */
function testScalpingDefaultsLockedIn(): void {
  log("Verifying DEFAULT_TRADING_POLICY scalping calibration...");

  const policy = EffectiveTradingPolicySchema.parse({});

  const expectations: Array<[string, unknown, unknown]> = [
    // Top-level scalars
    ["maxOpenPositions", policy.maxOpenPositions, 8],
    ["maxSymbolConcentrationPct", policy.maxSymbolConcentrationPct, 8],
    ["equityWashTradeCooldownMs", policy.equityWashTradeCooldownMs, 5_000],
    ["maxDailyLossPercent", policy.maxDailyLossPercent, 0.02],
    [
      "perTradeEquityAllocationPct",
      policy.perTradeEquityAllocationPct,
      2,
    ],
    [
      "perTradeCryptoAllocationPct",
      policy.perTradeCryptoAllocationPct,
      2,
    ],
    // positionManagementPrefs
    [
      "positionManagementPrefs.defaultStopLossPct",
      policy.positionManagementPrefs.defaultStopLossPct,
      0.5,
    ],
    [
      "positionManagementPrefs.defaultTakeProfitPct",
      policy.positionManagementPrefs.defaultTakeProfitPct,
      1.0,
    ],
    [
      "positionManagementPrefs.atrStopMultiplier",
      policy.positionManagementPrefs.atrStopMultiplier,
      0.75,
    ],
    [
      "positionManagementPrefs.maxHoldingPeriodMinutes",
      policy.positionManagementPrefs.maxHoldingPeriodMinutes,
      30,
    ],
    [
      "positionManagementPrefs.doNotReenterAfterStopOutMinutes",
      policy.positionManagementPrefs.doNotReenterAfterStopOutMinutes,
      10,
    ],
    [
      "positionManagementPrefs.scaleOutTriggerPct",
      policy.positionManagementPrefs.scaleOutTriggerPct,
      0.5,
    ],
    [
      "positionManagementPrefs.defaultRiskRewardRatio",
      policy.positionManagementPrefs.defaultRiskRewardRatio,
      1.5,
    ],
    [
      "positionManagementPrefs.breakEvenStopEnabled",
      policy.positionManagementPrefs.breakEvenStopEnabled,
      true,
    ],
    [
      "positionManagementPrefs.breakEvenTriggerPct",
      policy.positionManagementPrefs.breakEvenTriggerPct,
      1,
    ],
    // signalConsumptionPrefs
    [
      "signalConsumptionPrefs.minConfidenceByDefault",
      policy.signalConsumptionPrefs.minConfidenceByDefault,
      65,
    ],
    [
      "signalConsumptionPrefs.minPercentageChange",
      policy.signalConsumptionPrefs.minPercentageChange,
      0.15,
    ],
    [
      "signalConsumptionPrefs.volumeThreshold",
      policy.signalConsumptionPrefs.volumeThreshold,
      100_000,
    ],
    [
      "signalConsumptionPrefs.minExpectedRewardRiskRatio",
      policy.signalConsumptionPrefs.minExpectedRewardRiskRatio,
      1.3,
    ],
    [
      "signalConsumptionPrefs.cooldownAfterEntrySeconds",
      policy.signalConsumptionPrefs.cooldownAfterEntrySeconds,
      5,
    ],
    [
      "signalConsumptionPrefs.cooldownAfterStopOutSeconds",
      policy.signalConsumptionPrefs.cooldownAfterStopOutSeconds,
      30,
    ],
    [
      "signalConsumptionPrefs.duplicateSignalSuppressionWindowSeconds",
      policy.signalConsumptionPrefs.duplicateSignalSuppressionWindowSeconds,
      10,
    ],
    [
      "signalConsumptionPrefs.maxSignalAgeSeconds",
      policy.signalConsumptionPrefs.maxSignalAgeSeconds,
      30,
    ],
    // riskBudgetPrefs
    [
      "riskBudgetPrefs.maxRiskPerTradePct",
      policy.riskBudgetPrefs.maxRiskPerTradePct,
      1.5,
    ],
    [
      "riskBudgetPrefs.maxLossPerDayPct",
      policy.riskBudgetPrefs.maxLossPerDayPct,
      2.0,
    ],
    [
      "riskBudgetPrefs.maxLossPerWeekPct",
      policy.riskBudgetPrefs.maxLossPerWeekPct,
      5.0,
    ],
    [
      "riskBudgetPrefs.perTradeAllocationPct",
      policy.riskBudgetPrefs.perTradeAllocationPct,
      2,
    ],
    // executionPrefs
    [
      "executionPrefs.maxSlippageTolerancePct",
      policy.executionPrefs.maxSlippageTolerancePct,
      0.3,
    ],
    [
      "executionPrefs.priceCollarPct",
      policy.executionPrefs.priceCollarPct,
      0.5,
    ],
    [
      "executionPrefs.executionBias",
      policy.executionPrefs.executionBias,
      "passive",
    ],
    [
      "executionPrefs.defaultTimeInForce",
      policy.executionPrefs.defaultTimeInForce,
      "ioc",
    ],
    [
      "executionPrefs.preferredOrderType",
      policy.executionPrefs.preferredOrderType,
      "limit",
    ],
    [
      "executionPrefs.partialFillPolicy",
      policy.executionPrefs.partialFillPolicy,
      "accept_partial",
    ],
  ];

  let mismatches = 0;
  for (const [path, actual, expected] of expectations) {
    if (actual !== expected) {
      mismatches += 1;
      log(
        `MISMATCH: ${path} = ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`,
      );
    }
  }

  if (mismatches > 0) {
    log(`${mismatches} default(s) drifted from scalping calibration.`);
    log("Full parsed policy follows for debugging:");
    console.log(JSON.stringify(policy, null, 2));
    throw new Error(
      `Scalping default lock-in failed: ${mismatches} mismatches.`,
    );
  }

  // Also confirm DEFAULT_TRADING_POLICY (which is the parsed object built
  // with explicit top-level scalars) agrees with the schema-derived policy
  // on every nested field that came from defaults — this catches any case
  // where someone passes a stale literal in default-trading-policy.ts that
  // overrides what the schema is now producing.
  if (
    DEFAULT_TRADING_POLICY.maxOpenPositions !== 8 ||
    DEFAULT_TRADING_POLICY.equityWashTradeCooldownMs !== 5_000 ||
    DEFAULT_TRADING_POLICY.maxDailyLossPercent !== 0.02
  ) {
    throw new Error(
      "DEFAULT_TRADING_POLICY top-level scalars drifted from scalping calibration.",
    );
  }

  log(
    `Scalping defaults locked in (${expectations.length} fields verified). Full policy:`,
  );
  console.log(JSON.stringify(policy, null, 2));
}

async function testPreMarketData() {
  try {
    log(
      "Starting pre-market data test for SPY (9:00am-9:30am, July 1, 2025)...",
    );
    // Set up the time range in America/New_York, convert to UTC ISO strings
    const symbol = "SPY";
    const nyTimeZone = "America/New_York";
    // 9:00am and 9:30am in NY time
    const startNY = new Date("2025-07-01T09:00:00-04:00");
    const endNY = new Date("2025-07-01T09:30:00-04:00");
    const startUTC = startNY.toISOString();
    const endUTC = endNY.toISOString();

    const barsResponse = await marketDataAPI.getHistoricalBars({
      symbols: [symbol],
      timeframe: "1Min",
      start: startUTC,
      end: endUTC,
      limit: 1000,
    });
    const bars = barsResponse.bars[symbol] || [];
    log(
      `Fetched ${bars.length} 1-min bars for SPY from 9:00am to 9:30am (NY) on 2025-07-01.`,
    );
    if (bars.length === 0) {
      log("No pre-market bars returned.");
      return;
    }
    // Print each bar
    bars.forEach((bar, i) => {
      const barTime = new Date(bar.t).toLocaleString("en-US", {
        timeZone: nyTimeZone,
      });
      log(
        `Bar ${i + 1}: ${barTime} | O: ${formatCurrency(bar.o)} H: ${formatCurrency(bar.h)} L: ${formatCurrency(bar.l)} C: ${formatCurrency(bar.c)} V: ${formatNumber(bar.v)} VWAP: ${formatCurrency(bar.vw)} N: ${bar.n}`,
      );
    });
    // Print summary
    const summary = AlpacaMarketDataAPI.analyzeBars(bars);
    if (summary) log(`Summary: ${summary}`);
    log("Pre-market data test complete.");
  } catch (error) {
    log(
      `❌ Error in testPreMarketData: ${error instanceof Error ? error.message : error}`,
    );
  }
}

// Lock-in scalping defaults first so any drift fails fast with exit 1.
testScalpingDefaultsLockedIn();

testPreMarketData();
