// src/alpaca/trading/index.ts
// Trading module exports

export {
  createBracketOrder,
  createProtectiveBracket,
  createExecutorFromTradingAPI,
  BracketOrderParams,
  BracketOrderResult,
  BracketOrderExecutor,
  ProtectiveBracketParams,
} from './bracket-orders';

export { default as bracketOrders } from './bracket-orders';

// Account management exports
export {
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
  TradingEligibility,
  BuyingPowerBreakdown,
  PDTStatus,
  DailyReturn,
  PeriodPerformance,
  EquityCurvePoint,
} from './account';

export { default as account } from './account';

// Order utilities exports
export {
  // Query functions
  getOrdersBySymbol,
  getOpenOrders as getOpenOrdersQuery,
  getFilledOrders,
  getOrderHistory,
  getAllOrders,
  waitForOrderFill,
  // Status check functions
  isOrderFillable,
  isOrderFilled,
  isOrderTerminal as isOrderTerminalStatus,
  isOrderOpen,
  // Value calculation
  calculateOrderValue,
  calculateTotalFilledValue,
  // Formatting
  formatOrderSummary,
  formatOrderForLog,
  roundPriceForAlpaca,
  roundPriceForAlpacaNumber,
  // Grouping and filtering
  groupOrdersBySymbol,
  groupOrdersByStatus,
  filterOrdersByDateRange,
  sortOrdersByDate,
  // Types
  GetAllOrdersParams,
  GetFilledOrdersParams,
  GetOrderHistoryParams,
  OrderHistoryResult,
  WaitForOrderFillParams,
  WaitForOrderFillResult,
  OrderSummary,
} from './order-utils';

export { default as orderUtils } from './order-utils';

// Trailing stops exports
export {
  createTrailingStop,
  updateTrailingStop,
  getTrailingStopHWM,
  cancelTrailingStop,
  createPortfolioTrailingStops,
  getOpenTrailingStops,
  hasActiveTrailingStop,
  cancelTrailingStopsForSymbol,
  TrailingStopParams,
  TrailingStopHWMResult,
  PortfolioTrailingStopParams,
  TrailingStopValidationError,
} from './trailing-stops';

export { default as trailingStops } from './trailing-stops';

// OCO (One-Cancels-Other) order exports
export {
  createOCOOrder,
  cancelOCOOrder,
  getOCOOrderStatus,
  protectLongPosition,
  protectShortPosition,
  OCOOrderParams,
  OCOOrderResult,
} from './oco-orders';

export { default as ocoOrders } from './oco-orders';

// OTO (One-Triggers-Other) order exports
export {
  createOTOOrder,
  cancelOTOOrder,
  getOTOOrderStatus,
  buyWithStopLoss,
  buyWithTrailingStop,
  limitBuyWithTakeProfit,
  shortWithStopLoss,
  entryWithPercentStopLoss,
  OTOOrderParams,
  OTOOrderResult,
  DependentOrderConfig,
  DependentOrderType,
} from './oto-orders';

export { default as otoOrders } from './oto-orders';
