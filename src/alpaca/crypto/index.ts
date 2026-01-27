/**
 * Crypto Module Index
 * Exports all crypto trading and market data functions
 * Crypto trading is available 24/7 on Alpaca
 */

// Orders
export {
  CryptoOrderError,
  CryptoOrderParams,
  createCryptoOrder,
  createCryptoMarketOrder,
  createCryptoLimitOrder,
  createCryptoStopOrder,
  createCryptoStopLimitOrder,
  buyCryptoNotional,
  sellCryptoNotional,
  sellAllCrypto,
  getOpenCryptoOrders,
  cancelAllCryptoOrders,
  isCryptoPair,
} from './orders';

// Data
export {
  CryptoDataError,
  CryptoTrade,
  CryptoQuote,
  GetCryptoBarsParams,
  CryptoSnapshot,
  getCryptoBars,
  getLatestCryptoTrades,
  getLatestCryptoQuotes,
  getCryptoPrice,
  getCryptoSpread,
  getCryptoSnapshots,
  getCryptoTrades,
  getCryptoDailyPrices,
  getCrypto24HourChange,
  getSupportedCryptoPairs,
  getCryptoPairsByQuote,
  isSupportedCryptoPair,
  getPopularCryptoPairs,
  BTC_PAIRS,
  USDT_PAIRS,
  USDC_PAIRS,
  USD_PAIRS,
} from './data';

// Default exports as namespaces
import cryptoOrders from './orders';
import cryptoData from './data';

export const orders = cryptoOrders;
export const data = cryptoData;

export default {
  orders: cryptoOrders,
  data: cryptoData,
};
