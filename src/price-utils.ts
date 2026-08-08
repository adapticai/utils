// price-utils.ts

import adaptic, { types } from "@adaptic/backend-legacy";
import { EquityPoint, AlpacaPortfolioHistory } from "./types/index";
import { getDateInNY, MarketTimeUtil } from "./market-time";
import { getOrder } from "./alpaca/legacy";
import { getSharedApolloClient } from "./adaptic";

// ---------------------------------------------------------------------------
// Transaction-cost (fee) model
//
// Alpaca's REST order object does not expose the realized per-order fee, so the
// transaction cost is reconstructed from the published fee schedules, branching
// on the order's ACTUAL asset class (never a hardcoded STOCK). Every rate is a
// named constant sourced from Alpaca / SEC / FINRA public schedules (2024-2025)
// so it can be audited and updated in one place.
// ---------------------------------------------------------------------------

/** Basis points in one whole unit (1 = 10,000 bps). */
const BPS_PER_UNIT = 10_000;

/** Shares represented by one US listed option contract. */
const OPTIONS_CONTRACT_MULTIPLIER = 100;

/**
 * SEC Section 31 fee, charged on the principal of SELL orders for equities and
 * options. FY2024+ rate: USD 8.00 per USD 1,000,000 of principal.
 */
const SEC_SECTION31_FEE_PER_USD = 8.0 / 1_000_000;

/** FINRA Trading Activity Fee (TAF) for equity sells: USD per share sold. */
const FINRA_TAF_EQUITY_PER_SHARE = 0.000166;

/** FINRA TAF for option sells: USD per contract sold. */
const FINRA_TAF_OPTIONS_PER_CONTRACT = 0.00279;

/** FINRA TAF is capped per trade regardless of size. */
const FINRA_TAF_MAX_PER_TRADE = 8.3;

/** OCC clearing fee per option contract, capped per trade. */
const OCC_CLEARING_FEE_PER_CONTRACT = 0.02;
const OCC_CLEARING_FEE_MAX_PER_TRADE = 55.0;

/**
 * Options Regulatory Fee (ORF) pass-through, charged on both sides, USD per
 * contract. Published, exchange-set pass-through rate.
 */
const OPTIONS_REGULATORY_FEE_PER_CONTRACT = 0.02685;

/**
 * Alpaca crypto TAKER fee schedule as `[minTrailing30dVolumeUsd, takerBps]`,
 * ordered ascending by volume threshold. Market orders are takers; absent a
 * known trailing-30-day volume we conservatively select the tier-1 (highest)
 * taker rate. Source: Alpaca Crypto fee schedule.
 */
const ALPACA_CRYPTO_TAKER_FEE_TIERS_BPS: ReadonlyArray<
  readonly [number, number]
> = [
  [0, 25],
  [100_000, 22],
  [500_000, 20],
  [1_000_000, 18],
  [10_000_000, 15],
  [25_000_000, 13],
  [50_000_000, 12],
  [100_000_000, 10],
];

/**
 * Resolve the applicable Alpaca crypto taker fee (in bps) for a trailing
 * 30-day USD volume. Defaults to the tier-1 rate when the volume is unknown.
 * @param trailing30dVolumeUsd - Trailing 30-day traded notional in USD.
 * @returns The taker fee in basis points.
 */
function resolveCryptoTakerBps(trailing30dVolumeUsd: number): number {
  let bps = ALPACA_CRYPTO_TAKER_FEE_TIERS_BPS[0][1];
  for (const [threshold, tierBps] of ALPACA_CRYPTO_TAKER_FEE_TIERS_BPS) {
    if (trailing30dVolumeUsd >= threshold) {
      bps = tierBps;
    } else {
      break;
    }
  }
  return bps;
}

/**
 * Computes the realized transaction cost (fees + regulatory charges) for the
 * Alpaca order backing a single {@link types.Action}, branching on the order's
 * actual asset class. Returns 0 only when there is genuinely no order to price
 * (no linked order id, order not found, or nothing filled) — never as a
 * fabricated success.
 * @param action - The action whose linked Alpaca order should be priced.
 * @param trade - The parent trade (supplies the Alpaca account id).
 * @param alpacaAccount - The Alpaca account supplying broker credentials.
 * @returns The total fee in account currency (USD).
 */
export const calculateFees = async (
  action: types.Action,
  trade: types.Trade,
  alpacaAccount: types.AlpacaAccount,
): Promise<number> => {
  const alpacaOrderId = action.alpacaOrderId;
  if (!alpacaOrderId) return 0;

  const order = await getOrder(
    {
      adapticAccountId: trade.alpacaAccountId,
      alpacaApiKey: alpacaAccount.APIKey,
      alpacaApiSecret: alpacaAccount.APISecret,
    },
    alpacaOrderId,
  );
  if (!order) return 0;

  const filledQty = Number(order.filled_qty) || 0;
  const filledPrice =
    Number(order.filled_avg_price ?? order.limit_price ?? order.stop_price) ||
    0;

  // Realized notional prefers the actual fill (qty * avg price); it falls back
  // to the order's notional field for dollar-notional (fractional) orders.
  const notional =
    filledQty > 0 && filledPrice > 0
      ? filledQty * filledPrice
      : Number(order.notional ?? 0) || 0;

  if (notional <= 0) return 0;

  const isSell = order.side === "sell";

  switch (order.asset_class) {
    case "crypto": {
      // Crypto fees are bps of notional. Without a known 30-day volume we use
      // the conservative tier-1 taker rate.
      const takerBps = resolveCryptoTakerBps(0);
      return (notional * takerBps) / BPS_PER_UNIT;
    }

    case "us_option": {
      const contracts = filledQty > 0 ? filledQty : Number(order.qty) || 0;
      const occFee = Math.min(
        contracts * OCC_CLEARING_FEE_PER_CONTRACT,
        OCC_CLEARING_FEE_MAX_PER_TRADE,
      );
      const orfFee = contracts * OPTIONS_REGULATORY_FEE_PER_CONTRACT;
      let fee = occFee + orfFee;

      if (isSell) {
        // Option premium is quoted per share; SEC fee applies to the full
        // principal (premium * contract multiplier).
        const optionPrincipal = notional * OPTIONS_CONTRACT_MULTIPLIER;
        const secFee = optionPrincipal * SEC_SECTION31_FEE_PER_USD;
        const taf = Math.min(
          contracts * FINRA_TAF_OPTIONS_PER_CONTRACT,
          FINRA_TAF_MAX_PER_TRADE,
        );
        fee += secFee + taf;
      }

      return fee;
    }

    case "us_equity":
    default: {
      // Alpaca charges USD 0 commission on US equities; only sell-side
      // regulatory charges (SEC Section 31 + FINRA TAF) apply.
      if (!isSell) return 0;
      const secFee = notional * SEC_SECTION31_FEE_PER_USD;
      const taf = Math.min(
        filledQty * FINRA_TAF_EQUITY_PER_SHARE,
        FINRA_TAF_MAX_PER_TRADE,
      );
      return secFee + taf;
    }
  }
};

export const computeTotalFees = async (trade: types.Trade): Promise<number> => {
  let totalFees = 0;

  // Use the shared singleton Apollo client to avoid creating orphaned connections
  const client = await getSharedApolloClient();
  const alpacaAccount = (await adaptic.alpacaAccount.get(
    {
      id: trade.alpacaAccountId,
    } as types.AlpacaAccount,
    client,
  )) as types.AlpacaAccount;

  if (!alpacaAccount) return totalFees;

  const feePromises = trade?.actions?.map((action: types.Action) =>
    calculateFees(action, trade, alpacaAccount),
  );
  const fees = await Promise.all(feePromises || []);
  totalFees = fees.reduce((acc, fee) => acc + fee, 0);

  return totalFees;
};

/**
 * Rounds price based on value:
 * - For prices >= $1, rounds to nearest $0.01
 * - For prices < $1, rounds to nearest $0.0001
 */
export function roundStockPrice(price: number): number {
  if (price >= 1) {
    return Math.round(price * 100) / 100;
  } else {
    return Math.round(price * 10000) / 10000;
  }
}

export function getEquityValues(
  equityData: EquityPoint[],
  portfolioHistory?: AlpacaPortfolioHistory,
  marketTimeUtil?: MarketTimeUtil,
  period?: string,
) {
  if (!equityData.length) {
    return { latestEquity: 0, initialEquity: 0 };
  }

  // Sort data by time
  const sortedData = [...equityData].sort((a, b) => {
    const aDate = getDateInNY(a.time);
    const bDate = getDateInNY(b.time);
    return aDate.getTime() - bDate.getTime();
  });

  // Filter out invalid values and apply market hours filtering
  const validData = sortedData.filter((point) => {
    const value = Number(point.value);
    if (isNaN(value) || !isFinite(value)) {
      return false;
    }

    if (marketTimeUtil) {
      const pointDate = getDateInNY(point.time);

      // Only filter for market hours on '1D' period
      if (period === "1D") {
        return (
          marketTimeUtil.isMarketDay(pointDate) &&
          marketTimeUtil.isWithinMarketHours(pointDate)
        );
      }

      // For other periods, include all data points
      return true;
    }

    return true;
  });

  if (!validData.length) {
    if (sortedData.length > 0) {
      const lastPoint = sortedData[sortedData.length - 1];
      let initialValue: number;

      // Determine initial value based on period
      if (
        period &&
        ["YTD", "1Y", "3M", "6M"].includes(period) &&
        portfolioHistory?.base_value
      ) {
        initialValue = portfolioHistory.base_value;
      } else {
        initialValue = Number(sortedData[0].value);
      }

      return {
        latestEquity: Number(lastPoint.value),
        initialEquity: initialValue,
        latestTimestamp: lastPoint.time,
        initialTimestamp: sortedData[0].time,
        baseValueAsOf: portfolioHistory?.base_value_asof,
        baseValue: portfolioHistory?.base_value,
      };
    }
    return { latestEquity: 0, initialEquity: 0 };
  }

  const latestPoint = Number(validData[validData.length - 1].value);

  let initialEquity: number;

  // Determine initial equity based on period and available data
  if (period) {
    switch (period) {
      case "1D":
        // For 1D, use the first valid market hours point
        initialEquity = Number(validData[0].value);
        break;

      case "YTD":
      case "1Y":
      case "3M":
      case "6M":
        // For longer periods, prefer base_value if available and valid
        if (
          portfolioHistory?.base_value &&
          portfolioHistory.base_value > 0 &&
          portfolioHistory.base_value_asof
        ) {
          const baseValueDate = getDateInNY(portfolioHistory.base_value_asof);
          const periodStartDate = getDateInNY(validData[0].time);

          // Only use base_value if it's from before our period start
          if (baseValueDate <= periodStartDate) {
            initialEquity = portfolioHistory.base_value;
          } else {
            initialEquity = Number(validData[0].value);
          }
        } else {
          initialEquity = Number(validData[0].value);
        }
        break;

      default:
        initialEquity = Number(validData[0].value);
    }
  } else {
    // If no period specified, use first valid value
    initialEquity = Number(validData[0].value);
  }

  return {
    // DE-005: previously `Number(latestPoint.valueOf)`, which read the
    // un-invoked function reference and silently returned NaN. `latestPoint`
    // is already a number (see line above; sourced from `point.value` which
    // is typed `number` in EquityPoint), so use it directly.
    latestEquity: latestPoint,
    initialEquity,
    latestTimestamp: validData[validData.length - 1].time,
    initialTimestamp: validData[0].time,
    baseValueAsOf: portfolioHistory?.base_value_asof,
    baseValue: portfolioHistory?.base_value,
  };
}
