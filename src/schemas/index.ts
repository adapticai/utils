/**
 * API Response Validation Schemas
 *
 * Zod schemas for validating API responses from Alpaca, Massive, and Alpha Vantage.
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
export { safeValidateResponse, validateResponse, ValidationResponseError, type ValidateResponseOptions, type ValidationResult } from "./validate-response";

// Alpaca schemas
export {
  AlpacaAccountDetailsSchema, AlpacaBarSchema, AlpacaCryptoBarsResponseSchema, AlpacaHistoricalBarsResponseSchema,
  AlpacaLatestBarsResponseSchema, AlpacaLatestQuotesResponseSchema, AlpacaLatestTradesResponseSchema,
  AlpacaNewsArticleSchema,
  AlpacaNewsResponseSchema, AlpacaOrdersArraySchema, AlpacaOrderSchema, AlpacaPortfolioHistoryResponseSchema, AlpacaPositionsArraySchema, AlpacaPositionSchema, AlpacaQuoteSchema, AlpacaTradeSchema
} from "./alpaca-schemas";

// Massive schemas
export {
  MassiveAggregatesResponseSchema, MassiveDailyOpenCloseSchema, MassiveErrorResponseSchema, MassiveGroupedDailyResponseSchema, MassiveLastTradeResponseSchema, MassiveTickerDetailsResponseSchema, MassiveTickerInfoSchema, MassiveTradeSchema,
  MassiveTradesResponseSchema, RawMassivePriceDataSchema
} from "./massive-schemas";

// Alpha Vantage schemas
export {
  AlphaVantageQuoteResponseSchema, AVNewsArticleSchema,
  AVNewsResponseSchema
} from "./alphavantage-schemas";
