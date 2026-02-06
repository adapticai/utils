/**
 * Account Management Module
 * Handles account details, configuration, and portfolio history
 */
import { AlpacaClient } from '../client';
import { log as baseLog } from '../../logging';
import {
  AlpacaAccountDetails,
  AccountConfiguration,
  PortfolioHistoryParams,
  PortfolioHistoryResponse,
} from '../../types/alpaca-types';

const log = (message: string, options: { type?: 'info' | 'warn' | 'error' | 'debug' } = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'Account' });
};

/**
 * Trading eligibility status for an account
 */
export interface TradingEligibility {
  canTrade: boolean;
  reasons: string[];
  buyingPower: number;
  dayTradeCount: number;
  isPatternDayTrader: boolean;
}

/**
 * Buying power breakdown across different asset classes
 */
export interface BuyingPowerBreakdown {
  cash: number;
  equity: number;
  dayTradingBuyingPower: number;
  regtBuyingPower: number;
  optionsBuyingPower: number;
  cryptoBuyingPower: number;
}

/**
 * Pattern Day Trader (PDT) status information
 */
export interface PDTStatus {
  isPatternDayTrader: boolean;
  dayTradeCount: number;
  dayTradesRemaining: number;
  canDayTrade: boolean;
}

/**
 * Daily return information
 */
export interface DailyReturn {
  date: Date;
  equity: number;
  profitLoss: number;
  profitLossPct: number;
  dailyReturn: number;
}

/**
 * Period performance metrics
 */
export interface PeriodPerformance {
  startDate: Date;
  endDate: Date;
  startingEquity: number;
  endingEquity: number;
  totalReturn: number;
  totalReturnPct: number;
  averageDailyReturn: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number | null;
  volatility: number;
  winningDays: number;
  losingDays: number;
  winRate: number;
}

/**
 * Equity curve data point
 */
export interface EquityCurvePoint {
  timestamp: Date;
  equity: number;
  profitLoss: number;
  profitLossPct: number;
  cumulativeReturn: number;
}

/**
 * Get account details from Alpaca
 * @param client - AlpacaClient instance
 * @returns Promise resolving to account details
 */
export async function getAccountDetails(client: AlpacaClient): Promise<AlpacaAccountDetails> {
  log('Fetching account details');
  try {
    const sdk = client.getSDK();
    const account = await sdk.getAccount();
    log(`Account details fetched successfully for account ${account.account_number}`);
    return account as AlpacaAccountDetails;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch account details: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get account configuration from Alpaca
 * @param client - AlpacaClient instance
 * @returns Promise resolving to account configuration
 */
export async function getAccountConfiguration(client: AlpacaClient): Promise<AccountConfiguration> {
  log('Fetching account configuration');
  try {
    const sdk = client.getSDK();
    const config = await sdk.getAccountConfigurations();
    log('Account configuration fetched successfully');
    return config as AccountConfiguration;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch account configuration: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Update account configuration on Alpaca
 * @param client - AlpacaClient instance
 * @param config - Partial configuration to update
 * @returns Promise resolving to updated account configuration
 */
export async function updateAccountConfiguration(
  client: AlpacaClient,
  config: Partial<AccountConfiguration>
): Promise<AccountConfiguration> {
  log('Updating account configuration');
  try {
    const sdk = client.getSDK();
    const updatedConfig = await sdk.updateAccountConfigurations(config);
    log('Account configuration updated successfully');
    return updatedConfig as AccountConfiguration;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to update account configuration: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get portfolio history from Alpaca
 * @param client - AlpacaClient instance
 * @param params - Parameters for portfolio history request
 * @returns Promise resolving to portfolio history response
 */
export async function getPortfolioHistory(
  client: AlpacaClient,
  params: PortfolioHistoryParams
): Promise<PortfolioHistoryResponse> {
  log(`Fetching portfolio history with period: ${params.period || 'default'}, timeframe: ${params.timeframe || 'default'}`);
  try {
    const sdk = client.getSDK();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const history = await sdk.getPortfolioHistory(params);
    log(`Portfolio history fetched successfully with ${history.equity?.length || 0} data points`);
    return history as PortfolioHistoryResponse;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch portfolio history: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Check if account is eligible for trading
 * @param client - AlpacaClient instance
 * @returns Promise resolving to trading eligibility status
 */
export async function checkTradingEligibility(client: AlpacaClient): Promise<TradingEligibility> {
  log('Checking trading eligibility');
  try {
    const account = await getAccountDetails(client);
    const reasons: string[] = [];
    let canTrade = true;

    // Check various blocking conditions
    if (account.trading_blocked) {
      canTrade = false;
      reasons.push('Trading is blocked on this account');
    }

    if (account.account_blocked) {
      canTrade = false;
      reasons.push('Account is blocked');
    }

    if (account.trade_suspended_by_user) {
      canTrade = false;
      reasons.push('Trading is suspended by user');
    }

    if (account.status !== 'ACTIVE') {
      canTrade = false;
      reasons.push(`Account status is ${account.status}, not ACTIVE`);
    }

    const buyingPower = parseFloat(account.buying_power);
    if (buyingPower <= 0) {
      canTrade = false;
      reasons.push('No buying power available');
    }

    // Check PDT restrictions for accounts under $25k
    const equity = parseFloat(account.equity);
    if (account.pattern_day_trader && equity < 25000) {
      reasons.push('Pattern day trader with equity below $25,000 - day trading restricted');
    }

    const eligibility: TradingEligibility = {
      canTrade,
      reasons,
      buyingPower,
      dayTradeCount: account.daytrade_count,
      isPatternDayTrader: account.pattern_day_trader,
    };

    log(`Trading eligibility check complete: canTrade=${canTrade}${reasons.length > 0 ? `, reasons: ${reasons.join('; ')}` : ''}`);
    return eligibility;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to check trading eligibility: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get buying power breakdown for different asset classes
 * @param client - AlpacaClient instance
 * @returns Promise resolving to buying power breakdown
 */
export async function getBuyingPower(client: AlpacaClient): Promise<BuyingPowerBreakdown> {
  log('Fetching buying power breakdown');
  try {
    const account = await getAccountDetails(client);

    const breakdown: BuyingPowerBreakdown = {
      cash: parseFloat(account.cash),
      equity: parseFloat(account.equity),
      dayTradingBuyingPower: parseFloat(account.daytrading_buying_power),
      regtBuyingPower: parseFloat(account.regt_buying_power),
      optionsBuyingPower: parseFloat(account.options_buying_power),
      // Crypto buying power is typically equal to cash for spot trading
      cryptoBuyingPower: parseFloat(account.cash),
    };

    log(`Buying power breakdown: cash=$${breakdown.cash.toFixed(2)}, dayTrading=$${breakdown.dayTradingBuyingPower.toFixed(2)}, regT=$${breakdown.regtBuyingPower.toFixed(2)}`);
    return breakdown;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch buying power: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get options trading level for the account
 * @param client - AlpacaClient instance
 * @returns Promise resolving to options trading level (0-3)
 */
export async function getOptionsTradingLevel(client: AlpacaClient): Promise<0 | 1 | 2 | 3> {
  log('Fetching options trading level');
  try {
    const account = await getAccountDetails(client);
    const level = account.options_trading_level || 0;
    log(`Options trading level: ${level}`);
    return level as 0 | 1 | 2 | 3;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch options trading level: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get Pattern Day Trader (PDT) status
 * @param client - AlpacaClient instance
 * @returns Promise resolving to PDT status
 */
export async function getPDTStatus(client: AlpacaClient): Promise<PDTStatus> {
  log('Fetching PDT status');
  try {
    const account = await getAccountDetails(client);
    const equity = parseFloat(account.equity);
    const isPDT = account.pattern_day_trader;
    const dayTradeCount = account.daytrade_count;

    // Non-PDT accounts are limited to 3 day trades in a 5-day rolling period
    // PDT accounts with $25k+ equity have no day trade limit
    let dayTradesRemaining: number;
    let canDayTrade: boolean;

    if (isPDT) {
      if (equity >= 25000) {
        // PDT with sufficient equity - unlimited day trades
        dayTradesRemaining = Infinity;
        canDayTrade = true;
      } else {
        // PDT with insufficient equity - restricted
        dayTradesRemaining = 0;
        canDayTrade = false;
      }
    } else {
      // Non-PDT - limited to 3 day trades per 5-day period
      dayTradesRemaining = Math.max(0, 3 - dayTradeCount);
      canDayTrade = dayTradesRemaining > 0;
    }

    const status: PDTStatus = {
      isPatternDayTrader: isPDT,
      dayTradeCount,
      dayTradesRemaining: dayTradesRemaining === Infinity ? -1 : dayTradesRemaining, // Use -1 for unlimited
      canDayTrade,
    };

    log(`PDT status: isPDT=${isPDT}, dayTradeCount=${dayTradeCount}, remaining=${dayTradesRemaining === Infinity ? 'unlimited' : dayTradesRemaining}`);
    return status;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to fetch PDT status: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

// ==================== Portfolio History Utilities ====================

/**
 * Get daily returns from portfolio history
 * @param client - AlpacaClient instance
 * @param period - Period to fetch (e.g., '1W', '1M', '3M', '1A')
 * @returns Promise resolving to array of daily returns
 */
export async function getDailyReturns(client: AlpacaClient, period: string = '1M'): Promise<DailyReturn[]> {
  log(`Calculating daily returns for period: ${period}`);
  try {
    const history = await getPortfolioHistory(client, {
      period,
      timeframe: '1D',
    });

    if (!history.timestamp || !history.equity || history.timestamp.length === 0) {
      log('No portfolio history data available', { type: 'warn' });
      return [];
    }

    const dailyReturns: DailyReturn[] = [];

    for (let i = 0; i < history.timestamp.length; i++) {
      const timestamp = history.timestamp[i];
      const equity = history.equity[i];
      const profitLoss = history.profit_loss?.[i] || 0;
      const profitLossPct = history.profit_loss_pct?.[i] || 0;

      // Calculate daily return (percentage change from previous day)
      let dailyReturn = 0;
      if (i > 0 && history.equity[i - 1] !== 0) {
        dailyReturn = ((equity - history.equity[i - 1]) / history.equity[i - 1]) * 100;
      }

      dailyReturns.push({
        date: new Date(timestamp * 1000),
        equity,
        profitLoss,
        profitLossPct: profitLossPct * 100, // Convert to percentage
        dailyReturn,
      });
    }

    log(`Calculated ${dailyReturns.length} daily returns`);
    return dailyReturns;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to calculate daily returns: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Calculate period performance metrics
 * @param client - AlpacaClient instance
 * @param period - Period to analyze (e.g., '1W', '1M', '3M', '1A')
 * @returns Promise resolving to period performance metrics
 */
export async function calculatePeriodPerformance(
  client: AlpacaClient,
  period: string = '1M'
): Promise<PeriodPerformance> {
  log(`Calculating period performance for: ${period}`);
  try {
    const dailyReturns = await getDailyReturns(client, period);

    if (dailyReturns.length < 2) {
      throw new Error('Insufficient data points for performance calculation');
    }

    const startingEquity = dailyReturns[0].equity;
    const endingEquity = dailyReturns[dailyReturns.length - 1].equity;
    const totalReturn = endingEquity - startingEquity;
    const totalReturnPct = ((endingEquity - startingEquity) / startingEquity) * 100;

    // Calculate average daily return
    const returns = dailyReturns.map((d) => d.dailyReturn).filter((r) => !isNaN(r));
    const averageDailyReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;

    // Calculate max drawdown
    let peak = dailyReturns[0].equity;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;

    for (const day of dailyReturns) {
      if (day.equity > peak) {
        peak = day.equity;
      }
      const drawdown = peak - day.equity;
      const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPct = drawdownPct;
      }
    }

    // Calculate volatility (standard deviation of daily returns)
    const variance =
      returns.length > 1
        ? returns.reduce((sum, r) => sum + Math.pow(r - averageDailyReturn, 2), 0) / (returns.length - 1)
        : 0;
    const volatility = Math.sqrt(variance);

    // Calculate Sharpe Ratio (assuming risk-free rate of 0 for simplicity)
    // Annualized: (avg daily return * 252) / (volatility * sqrt(252))
    let sharpeRatio: number | null = null;
    if (volatility > 0) {
      const annualizedReturn = averageDailyReturn * 252;
      const annualizedVolatility = volatility * Math.sqrt(252);
      sharpeRatio = annualizedReturn / annualizedVolatility;
    }

    // Count winning and losing days
    const winningDays = returns.filter((r) => r > 0).length;
    const losingDays = returns.filter((r) => r < 0).length;
    const winRate = returns.length > 0 ? (winningDays / returns.length) * 100 : 0;

    const performance: PeriodPerformance = {
      startDate: dailyReturns[0].date,
      endDate: dailyReturns[dailyReturns.length - 1].date,
      startingEquity,
      endingEquity,
      totalReturn,
      totalReturnPct,
      averageDailyReturn,
      maxDrawdown,
      maxDrawdownPct,
      sharpeRatio,
      volatility,
      winningDays,
      losingDays,
      winRate,
    };

    log(`Period performance: totalReturn=${totalReturnPct.toFixed(2)}%, maxDrawdown=${maxDrawdownPct.toFixed(2)}%, sharpe=${sharpeRatio?.toFixed(2) || 'N/A'}`);
    return performance;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to calculate period performance: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get equity curve data
 * @param client - AlpacaClient instance
 * @param params - Portfolio history parameters
 * @returns Promise resolving to equity curve data points
 */
export async function getEquityCurve(
  client: AlpacaClient,
  params: PortfolioHistoryParams = { period: '1M', timeframe: '1D' }
): Promise<EquityCurvePoint[]> {
  log(`Fetching equity curve with period: ${params.period || 'default'}`);
  try {
    const history = await getPortfolioHistory(client, params);

    if (!history.timestamp || !history.equity || history.timestamp.length === 0) {
      log('No portfolio history data available for equity curve', { type: 'warn' });
      return [];
    }

    const baseValue = history.base_value || history.equity[0];
    const curve: EquityCurvePoint[] = [];

    for (let i = 0; i < history.timestamp.length; i++) {
      const timestamp = history.timestamp[i];
      const equity = history.equity[i];
      const profitLoss = history.profit_loss?.[i] || 0;
      const profitLossPct = history.profit_loss_pct?.[i] || 0;

      // Calculate cumulative return from base value
      const cumulativeReturn = baseValue > 0 ? ((equity - baseValue) / baseValue) * 100 : 0;

      curve.push({
        timestamp: new Date(timestamp * 1000),
        equity,
        profitLoss,
        profitLossPct: profitLossPct * 100, // Convert to percentage
        cumulativeReturn,
      });
    }

    log(`Generated equity curve with ${curve.length} data points`);
    return curve;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to get equity curve: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get account equity and cash summary
 * @param client - AlpacaClient instance
 * @returns Promise resolving to account summary
 */
export async function getAccountSummary(client: AlpacaClient): Promise<{
  equity: number;
  cash: number;
  portfolioValue: number;
  longMarketValue: number;
  shortMarketValue: number;
  lastEquity: number;
  todayProfitLoss: number;
  todayProfitLossPct: number;
}> {
  log('Fetching account summary');
  try {
    const account = await getAccountDetails(client);

    const equity = parseFloat(account.equity);
    const lastEquity = parseFloat(account.last_equity);
    const todayProfitLoss = equity - lastEquity;
    const todayProfitLossPct = lastEquity > 0 ? (todayProfitLoss / lastEquity) * 100 : 0;

    const summary = {
      equity,
      cash: parseFloat(account.cash),
      portfolioValue: parseFloat(account.portfolio_value),
      longMarketValue: parseFloat(account.long_market_value),
      shortMarketValue: parseFloat(account.short_market_value),
      lastEquity,
      todayProfitLoss,
      todayProfitLossPct,
    };

    log(`Account summary: equity=$${summary.equity.toFixed(2)}, cash=$${summary.cash.toFixed(2)}, todayP/L=${summary.todayProfitLossPct.toFixed(2)}%`);
    return summary;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to get account summary: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Check if account is a margin account
 * @param client - AlpacaClient instance
 * @returns Promise resolving to boolean indicating margin status
 */
export async function isMarginAccount(client: AlpacaClient): Promise<boolean> {
  log('Checking margin account status');
  try {
    const account = await getAccountDetails(client);
    // Multiplier > 1 indicates margin account
    const isMargin = account.multiplier !== '1';
    log(`Margin account: ${isMargin} (multiplier: ${account.multiplier})`);
    return isMargin;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to check margin account status: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

/**
 * Get margin information for the account
 * @param client - AlpacaClient instance
 * @returns Promise resolving to margin information
 */
export async function getMarginInfo(client: AlpacaClient): Promise<{
  multiplier: string;
  initialMargin: number;
  maintenanceMargin: number;
  lastMaintenanceMargin: number;
  sma: number;
  marginCallAmount: number;
}> {
  log('Fetching margin information');
  try {
    const account = await getAccountDetails(client);

    const initialMargin = parseFloat(account.initial_margin);
    const maintenanceMargin = parseFloat(account.maintenance_margin);
    const equity = parseFloat(account.equity);

    // Calculate margin call amount if applicable
    const marginCallAmount = Math.max(0, maintenanceMargin - equity);

    const marginInfo = {
      multiplier: account.multiplier,
      initialMargin,
      maintenanceMargin,
      lastMaintenanceMargin: parseFloat(account.last_maintenance_margin),
      sma: parseFloat(account.sma),
      marginCallAmount,
    };

    log(`Margin info: multiplier=${marginInfo.multiplier}, initialMargin=$${marginInfo.initialMargin.toFixed(2)}, maintenanceMargin=$${marginInfo.maintenanceMargin.toFixed(2)}`);
    return marginInfo;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to get margin information: ${errorMessage}`, { type: 'error' });
    throw error;
  }
}

export default {
  getAccountDetails,
  getAccountConfiguration,
  updateAccountConfiguration,
  getPortfolioHistory,
  checkTradingEligibility,
  getBuyingPower,
  getOptionsTradingLevel,
  getPDTStatus,
  getDailyReturns,
  calculatePeriodPerformance,
  getEquityCurve,
  getAccountSummary,
  isMarginAccount,
  getMarginInfo,
};
