/**
 * Legacy Alpaca API Functions
 * Re-exports all legacy functions that use the AlpacaAuth pattern
 * with direct fetch calls (as opposed to the SDK-based AlpacaClient pattern).
 *
 * @module @adaptic/utils/alpaca/legacy
 */

// Auth
export { validateAuth, type ValidatedAuth } from './auth';

// Utility functions
export { roundPriceForAlpaca, cleanContent } from './utils';

// Order functions
export {
  makeRequest,
  createOrder,
  getOrders,
  cancelAllOrders,
  getOrder,
  replaceOrder,
  cancelOrder,
  createLimitOrder,
} from './orders';

// Position functions
export {
  fetchAllPositions,
  fetchPosition,
  closePosition,
  closeAllPositions,
  closeAllPositionsAfterHours,
} from './positions';

// Account functions
export {
  fetchAccountDetails,
  fetchPortfolioHistory,
  getConfiguration,
  updateConfiguration,
} from './account';

// Market data functions
export {
  getLatestQuotes,
  fetchNews,
} from './market-data';

// Asset functions
export { getAsset } from './assets';
