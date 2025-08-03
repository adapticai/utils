// price-utils.ts

import adaptic, { enums, types } from "@adaptic/backend-legacy";
import { EquityPoint, AlpacaPortfolioHistory } from "./types/index";
import { getDateInNY, MarketTimeUtil } from "./market-time";
import { getOrder } from "./alpaca-functions";




const calculateFees = async (action: types.Action, trade: types.Trade, alpacaAccount: types.AlpacaAccount): Promise<number> => {
  let fee = 0;

  const alpacaOrderId = action.alpacaOrderId;

  if (!alpacaOrderId) return fee;

  const order = await getOrder({
    adapticAccountId: trade.alpacaAccountId,
    alpacaApiKey: alpacaAccount.APIKey,
    alpacaApiSecret: alpacaAccount.APISecret,
  },
    alpacaOrderId,
  );
  if (!order) return fee;

  const assetType =
    ("STOCK" as enums.AssetType.STOCK);

  const qty = Number(order.qty) || 0;
  const notional = order.notional || 0;
  const filledPrice =
    Number(order.filled_avg_price || order.limit_price || order.stop_price) || 0;

  // Determine trade value
  const tradeValue = qty ? qty * filledPrice : notional;

  let perContractFee = 0;
  let baseCommission = 0;
  let commissionFee = 0;
  let regulatoryFee = 0;

  switch (assetType) {
    case "STOCK" as enums.AssetType.STOCK:
    // case "ETF" as enums.AssetType.ETF:
    //   commissionFee =
    //     (tradeValue * FEE_CONFIG.SHARES_COMMISSION_PERCENTAGE) / 100;
    //   regulatoryFee =
    //     (tradeValue * FEE_CONFIG.REGULATORY_FEES_PERCENTAGE) / 100;
    //   fee = commissionFee + regulatoryFee;
    //   break;

    // case "OPTION" as enums.AssetType.OPTION:
    //   perContractFee = qty * FEE_CONFIG.OPTIONS_PER_CONTRACT_FEE;
    //   baseCommission = FEE_CONFIG.OPTIONS_BASE_COMMISSION;
    //   fee = perContractFee + baseCommission;
    //   break;

    // case "CRYPTOCURRENCY" as enums.AssetType.CRYPTOCURRENCY:
    //   fee = (tradeValue * FEE_CONFIG.CRYPTO_TRANSACTION_PERCENTAGE) / 100;
    //   break;

    // case "FUTURE" as enums.AssetType.FUTURE:
    //   // Sum of all futures fees
    //   fee = 0.85 + 0.85 + 0.25 + 0.02 + 0.01 + 0.3 + 0.01;
    //   break;

    default:
      fee = 0;
      break;
  }

  return fee;
};

export const computeTotalFees = async (trade: types.Trade): Promise<number> => {
  let totalFees = 0;

  // fetch alpaca account details using adaptic.alpacaAccount.get({id: trade.alpacaAccountId})
  const alpacaAccount = (await adaptic.alpacaAccount.get({
    id: trade.alpacaAccountId,
  } as types.AlpacaAccount)) as types.AlpacaAccount;

  if (!alpacaAccount) return totalFees;

  const feePromises = trade?.actions?.map((action: types.Action) => calculateFees(action, trade, alpacaAccount));
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
  period?: string
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
      if (period === '1D') {
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
      if (period && ['YTD', '1Y', '3M', '6M'].includes(period) && portfolioHistory?.base_value) {
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
      case '1D':
        // For 1D, use the first valid market hours point
        initialEquity = Number(validData[0].value);
        break;

      case 'YTD':
      case '1Y':
      case '3M':
      case '6M':
        // For longer periods, prefer base_value if available and valid
        if (portfolioHistory?.base_value &&
          portfolioHistory.base_value > 0 &&
          portfolioHistory.base_value_asof) {
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
    latestEquity: Number(latestPoint.valueOf),
    initialEquity,
    latestTimestamp: validData[validData.length - 1].time,
    initialTimestamp: validData[0].time,
    baseValueAsOf: portfolioHistory?.base_value_asof,
    baseValue: portfolioHistory?.base_value,
  };
}
