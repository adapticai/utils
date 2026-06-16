import { describe, expect, it, vi } from "vitest";

// Mock all heavy transitive dependencies so vitest can import ../index
// without needing the full node_modules graph (ws, graphql-fields, etc.).
vi.mock("@adaptic/backend-legacy", () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
    allocation: { update: vi.fn(), create: vi.fn() },
  },
  types: {},
}));

vi.mock("../adaptic", () => ({
  fetchAssetOverview: vi.fn(),
  getSharedApolloClient: vi.fn(),
  configureAuth: vi.fn(),
  isAuthConfigured: vi.fn(),
  disconnectClient: vi.fn(),
}));

vi.mock("../alpaca-market-data-api", () => ({
  AlpacaMarketDataAPI: { getInstance: vi.fn() },
}));

vi.mock("../alpaca-trading-api", () => ({
  AlpacaTradingAPI: vi.fn(),
}));

vi.mock("../alpaca/legacy", () => ({
  createOrder: vi.fn(),
  createLimitOrder: vi.fn(),
  getOrder: vi.fn(),
  getOrders: vi.fn(),
  replaceOrder: vi.fn(),
  cancelOrder: vi.fn(),
  cancelAllOrders: vi.fn(),
  fetchPosition: vi.fn(),
  closePosition: vi.fn(),
  fetchAllPositions: vi.fn(),
  closeAllPositions: vi.fn(),
  closeAllPositionsAfterHours: vi.fn(),
  fetchAccountDetails: vi.fn(),
  fetchPortfolioHistory: vi.fn(),
  getConfiguration: vi.fn(),
  updateConfiguration: vi.fn(),
  getAsset: vi.fn(),
  getLatestQuotes: vi.fn(),
}));

vi.mock("../alpaca", () => ({
  alpaca: {
    createClient: vi.fn(),
    createClientFromEnv: vi.fn(),
    clearClientCache: vi.fn(),
    smartOrders: {},
    orders: {},
    positions: {},
    account: {},
    clock: {},
    quotes: {},
    bars: {},
    trades: {},
    news: {},
    options: {},
    crypto: {},
    streams: {},
  },
}));

vi.mock("../crypto", () => ({
  fetchBars: vi.fn(),
  fetchNews: vi.fn(),
  fetchLatestTrades: vi.fn(),
  fetchLatestQuotes: vi.fn(),
}));

vi.mock("../massive", () => ({
  fetchTickerInfo: vi.fn(),
  fetchGroupedDaily: vi.fn(),
  fetchLastTrade: vi.fn(),
  fetchLastQuote: vi.fn(),
  fetchTrades: vi.fn(),
  fetchPrices: vi.fn(),
  fetchPricesWithFreshness: vi.fn(),
  analyseMassivePriceData: vi.fn(),
  formatPriceData: vi.fn(),
  fetchDailyOpenClose: vi.fn(),
  getPreviousClose: vi.fn(),
}));

vi.mock("../massive-indices", () => ({
  fetchIndicesAggregates: vi.fn(),
  fetchIndicesPreviousClose: vi.fn(),
  fetchIndicesDailyOpenClose: vi.fn(),
  fetchIndicesSnapshot: vi.fn(),
  fetchUniversalSnapshot: vi.fn(),
  formatIndicesBarData: vi.fn(),
}));

vi.mock("../metrics-calcs", () => ({
  default: vi.fn(),
}));

vi.mock("../alphavantage", () => ({
  fetchQuote: vi.fn(),
  fetchTickerNews: vi.fn(),
  convertDateToYYYYMMDDTHHMM: vi.fn(),
  convertYYYYMMDDTHHMMSSToDate: vi.fn(),
}));

vi.mock("../risk-free-rate", () => ({
  DEFAULT_RISK_FREE_RATE: 0.05,
  RISK_FREE_RATE_TTL_MS: 86400000,
  getRiskFreeRate: vi.fn(),
  getRiskFreeRateWithProvenance: vi.fn(),
  getCachedRiskFreeRateSync: vi.fn(),
  getCachedRiskFreeRateSyncWithProvenance: vi.fn(),
  setRiskFreeRate: vi.fn(),
  resetRiskFreeRateCache: vi.fn(),
}));

import { adaptic, atr, volatility, risk, strategy } from "../index";

describe("namespace exports", () => {
  it("exports atr namespace via top-level export", () => {
    expect(typeof atr.calculateATR).toBe("function");
    expect(typeof atr.calculateATREMA).toBe("function");
    expect(typeof atr.calculateATRMultiTimespan).toBe("function");
  });

  it("exports atr namespace via adaptic object", () => {
    expect(typeof adaptic.atr.calculateATR).toBe("function");
  });

  it("exports volatility namespace via both paths", () => {
    expect(typeof volatility.calculateRealizedVolatility).toBe("function");
    expect(typeof volatility.calculateEWMAVolatility).toBe("function");
    expect(typeof volatility.detectVolatilityRegime).toBe("function");
    expect(typeof volatility.annualiseVolatility).toBe("function");
    expect(typeof adaptic.volatility.calculateRealizedVolatility).toBe("function");
  });

  it("exports risk namespace via both paths", () => {
    expect(typeof risk.calculateVaRHistorical).toBe("function");
    expect(typeof risk.calculateVaRParametric).toBe("function");
    expect(typeof risk.calculateExpectedShortfall).toBe("function");
    expect(typeof risk.calculateConditionalDrawdown).toBe("function");
    expect(typeof risk.calculateRollingDrawdown).toBe("function");
    expect(typeof risk.calculateSortino).toBe("function");
    expect(typeof risk.calculateCalmar).toBe("function");
    expect(typeof adaptic.risk.calculateVaRHistorical).toBe("function");
  });

  it("exports strategy namespace via both paths", () => {
    expect(typeof strategy.calculateRollingExpectancy).toBe("function");
    expect(typeof strategy.calculateRollingHitRate).toBe("function");
    expect(typeof strategy.calculateRollingProfitFactor).toBe("function");
    expect(typeof strategy.calculateRollingSortino).toBe("function");
    expect(typeof strategy.calculateBacktestDivergenceZ).toBe("function");
    expect(typeof adaptic.strategy.calculateRollingExpectancy).toBe("function");
  });
});
