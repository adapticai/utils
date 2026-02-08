/**
 * API Response Validation Schemas
 *
 * Zod schemas for validating API responses from Alpaca, Polygon, and Alpha Vantage.
 * Use these schemas with `validateResponse()` to catch breaking API changes early.
 *
 * @example
 * ```typescript
 * import { validateResponse, AlpacaAccountDetailsSchema } from '@adaptic/utils';
 *
 * const rawData = await fetchAccountFromAPI();
 * const validated = validateResponse(rawData, AlpacaAccountDetailsSchema, {
 *   label: 'AlpacaAPI.getAccount',
 * });
 * ```
 */

// Validation utilities
export {
  validateResponse,
  safeValidateResponse,
  ValidationResponseError,
  type ValidationResult,
  type ValidateResponseOptions,
} from './validate-response';

// Alpaca schemas
export {
  AlpacaAccountDetailsSchema,
  AlpacaPositionSchema,
  AlpacaPositionsArraySchema,
  AlpacaOrderSchema,
  AlpacaOrdersArraySchema,
  AlpacaBarSchema,
  AlpacaHistoricalBarsResponseSchema,
  AlpacaLatestBarsResponseSchema,
  AlpacaQuoteSchema,
  AlpacaLatestQuotesResponseSchema,
  AlpacaTradeSchema,
  AlpacaLatestTradesResponseSchema,
  AlpacaNewsArticleSchema,
  AlpacaNewsResponseSchema,
  AlpacaPortfolioHistoryResponseSchema,
  AlpacaCryptoBarsResponseSchema,
} from './alpaca-schemas';

// Polygon schemas
export {
  RawPolygonPriceDataSchema,
  PolygonTickerInfoSchema,
  PolygonTickerDetailsResponseSchema,
  PolygonGroupedDailyResponseSchema,
  PolygonDailyOpenCloseSchema,
  PolygonTradeSchema,
  PolygonTradesResponseSchema,
  PolygonLastTradeResponseSchema,
  PolygonAggregatesResponseSchema,
  PolygonErrorResponseSchema,
} from './polygon-schemas';

// Alpha Vantage schemas
export {
  AlphaVantageQuoteResponseSchema,
  AVNewsArticleSchema,
  AVNewsResponseSchema,
} from './alphavantage-schemas';
