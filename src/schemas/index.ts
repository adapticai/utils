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
    ValidationResponseError, safeValidateResponse, validateResponse, type ValidateResponseOptions, type ValidationResult
} from "./validate-response";

// Alpaca schemas
export {
    AlpacaAccountDetailsSchema, AlpacaBarSchema, AlpacaCryptoBarsResponseSchema, AlpacaHistoricalBarsResponseSchema,
    AlpacaLatestBarsResponseSchema, AlpacaLatestQuotesResponseSchema, AlpacaLatestTradesResponseSchema,
    AlpacaNewsArticleSchema,
    AlpacaNewsResponseSchema, AlpacaOrderSchema,
    AlpacaOrdersArraySchema, AlpacaPortfolioHistoryResponseSchema, AlpacaPositionSchema,
    AlpacaPositionsArraySchema, AlpacaQuoteSchema, AlpacaTradeSchema
} from "./alpaca-schemas";

// Polygon schemas
export {
    PolygonAggregatesResponseSchema, PolygonDailyOpenCloseSchema, PolygonErrorResponseSchema, PolygonGroupedDailyResponseSchema, PolygonLastTradeResponseSchema, PolygonTickerDetailsResponseSchema, PolygonTickerInfoSchema, PolygonTradeSchema,
    PolygonTradesResponseSchema, RawPolygonPriceDataSchema
} from "./massive-schemas";

// Alpha Vantage schemas
export {
    AVNewsArticleSchema,
    AVNewsResponseSchema, AlphaVantageQuoteResponseSchema
} from "./alphavantage-schemas";
