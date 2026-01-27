/**
 * Test imports file
 * Verifies that all Alpaca module exports compile correctly
 */

import {
  // Client
  createAlpacaClient,
  AlpacaClient,
  AlpacaClientConfig,
  createClientFromEnv,
  clearClientCache,

  // Trading - Bracket Orders
  createBracketOrder,
  createProtectiveBracket,

  // Trading - OCO Orders
  createOCOOrder,
  cancelOCOOrder,
  getOCOOrderStatus,

  // Trading - OTO Orders
  createOTOOrder,
  cancelOTOOrder,
  getOTOOrderStatus,
  buyWithStopLoss,

  // Trading - Trailing Stops
  createTrailingStop,
  updateTrailingStop,
  getTrailingStopHWM,

  // Trading - Account
  getAccountDetails,
  getAccountConfiguration,
  getPortfolioHistory,

  // Trading - Order Utils (use the renamed exports)
  getAllOrders,
  getOrdersBySymbol,
  getFilledOrders,

  // Market Data - Quotes
  getLatestQuote,
  getLatestQuotes,
  getSpread,
  hasStockLiquidity,

  // Market Data - Bars
  getBars,
  getLatestBars,
  getDailyPrices,

  // Market Data - Trades
  getLatestTrade,
  getLatestTrades,
  getCurrentPrice,

  // Market Data - News
  getNews,
  getLatestNews,
  searchNews,

  // Options - Contracts
  getOptionContracts,
  getOptionContract,
  getOptionChain,
  parseOCCSymbol,
  buildOCCSymbol,

  // Options - Orders
  createOptionOrder,
  buyToOpen,
  sellToClose,
  createVerticalSpread,

  // Options - Strategies
  createCoveredCall,
  createButterflySpread,

  // Options - Data
  getOptionsChain,
  getLatestOptionsQuotes,
  hasOptionLiquidity,

  // Crypto - Orders
  createCryptoOrder,
  createCryptoMarketOrder,
  buyCryptoNotional,

  // Crypto - Data
  getCryptoBars,
  getCryptoPrice,
  getLatestCryptoQuotes,

  // Streams
  createStreamManager,

  // Namespace
  alpaca,
} from './index';

// Verify types compile
const testTypes = async () => {
  // Test client creation
  const client = createAlpacaClient({
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    accountType: 'PAPER',
  });

  console.log('Client created:', client.isPaper());

  // Test that namespace is available
  console.log('Alpaca namespace available:', typeof alpaca);
  console.log('Alpaca orders available:', typeof alpaca.orders);
  console.log('Alpaca smartOrders available:', typeof alpaca.smartOrders);
  console.log('Alpaca quotes available:', typeof alpaca.quotes);
  console.log('Alpaca options available:', typeof alpaca.options);
  console.log('Alpaca crypto available:', typeof alpaca.crypto);
  console.log('Alpaca streams available:', typeof alpaca.streams);

  // Test stream factory is available
  console.log('createStreamManager available:', typeof createStreamManager);

  console.log('\nImport verification passed');
};

// Export for testing
export { testTypes };
