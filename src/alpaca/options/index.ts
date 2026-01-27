/**
 * Options Trading Module
 * Provides functionality for options contracts, orders, strategies, and market data
 */

// Contracts exports
export {
  // Core API functions
  getOptionContracts,
  getOptionContract,
  getOptionChain,
  getExpirationDates,
  getStrikePrices,
  findATMOptions,
  getGroupedOptionChain,
  findOptionsByDelta,
  findNearestExpiration,

  // Utility functions
  parseOCCSymbol,
  buildOCCSymbol,
  isContractTradable,
  getDaysToExpiration,
  isExpiringWithin,
} from './contracts';

export type {
  GetOptionChainParams,
  ATMOptionsResult,
  GroupedOptionChain,
} from './contracts';

export { default as contracts } from './contracts';

// Orders exports
export {
  // Single-leg orders
  createOptionOrder,
  buyToOpen,
  sellToClose,
  sellToOpen,
  buyToClose,

  // Multi-leg orders
  validateMultiLegOrder,
  createMultiLegOptionOrder,
  createVerticalSpread,
  createIronCondor,
  createStraddle,
  createStrangle,

  // Position management
  closeOptionPosition,
  closeAllOptionPositions,
  exerciseOption,

  // Order status helpers
  isOptionOrderTerminal,
  isOptionOrderCancelable,
} from './orders';

export type {
  SingleLegOptionOrderParams,
  CloseOptionPositionParams,
  CloseAllOptionsResult,
  ExerciseOptionParams,
  MultiLegValidationResult,
} from './orders';

export { default as orders } from './orders';

// Strategies exports (advanced parameter-based strategy builders)
export {
  buildOptionSymbol,
  createVerticalSpread as createVerticalSpreadAdvanced,
  createIronCondor as createIronCondorAdvanced,
  createStraddle as createStraddleAdvanced,
  createCoveredCall,
  rollOptionPosition,
  createStrangle as createStrangleAdvanced,
  createButterflySpread,
  OptionStrategyError,
} from './strategies';

export type {
  VerticalSpreadParams,
  IronCondorParams,
  StraddleParams,
  CoveredCallParams,
  RollPositionParams,
  StrangleParams,
  ButterflySpreadParams,
} from './strategies';

export { default as strategies } from './strategies';

// Data exports (options market data)
export {
  getOptionsChain,
  getLatestOptionsQuotes,
  getLatestOptionsTrades,
  getOptionsSnapshots,
  getHistoricalOptionsBars,
  approximateImpliedVolatility,
  calculateMoneyness,
  findATMStrikes,
  calculatePutCallRatio,
  extractGreeks,
  filterByExpiration,
  filterByStrike,
  filterByType,
  getOptionSpread,
  hasGoodLiquidity,
  OptionsDataError,
} from './data';

export type {
  OptionsFeed,
  GetHistoricalOptionsBarsParams,
} from './data';

export { default as data } from './data';
