/**
 * Polygon Indices API Implementation
 *
 * This module provides functions to interact with the Polygon.io Indices API.
 */
import { PolygonIndicesAggregatesParams, PolygonIndicesAggregatesResponse, PolygonIndicesPrevCloseResponse, PolygonIndicesDailyOpenCloseResponse, PolygonIndicesSnapshotParams, PolygonIndicesSnapshotResponse } from './types';
/**
 * Fetches aggregate bars for an index over a given date range in custom time window sizes.
 *
 * @param {PolygonIndicesAggregatesParams} params - Parameters for the aggregates request
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesAggregatesResponse>} The aggregates response
 */
export declare const fetchIndicesAggregates: (params: PolygonIndicesAggregatesParams, options?: {
    apiKey?: string;
}) => Promise<PolygonIndicesAggregatesResponse>;
/**
 * Gets the previous day's open, high, low, and close (OHLC) for the specified index.
 *
 * @param {string} indicesTicker - The ticker symbol of the index
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesPrevCloseResponse>} The previous close response
 */
export declare const fetchIndicesPreviousClose: (indicesTicker: string, options?: {
    apiKey?: string;
}) => Promise<PolygonIndicesPrevCloseResponse>;
/**
 * Gets the open, close and afterhours values of an index symbol on a certain date.
 *
 * @param {string} indicesTicker - The ticker symbol of the index
 * @param {string} date - The date in YYYY-MM-DD format
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesDailyOpenCloseResponse>} The daily open/close response
 */
export declare const fetchIndicesDailyOpenClose: (indicesTicker: string, date: string, options?: {
    apiKey?: string;
}) => Promise<PolygonIndicesDailyOpenCloseResponse>;
/**
 * Gets a snapshot of indices data for specified tickers.
 *
 * @param {PolygonIndicesSnapshotParams} [params] - Parameters for the snapshot request
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @returns {Promise<PolygonIndicesSnapshotResponse>} The indices snapshot response
 */
export declare const fetchIndicesSnapshot: (params?: PolygonIndicesSnapshotParams, options?: {
    apiKey?: string;
}) => Promise<PolygonIndicesSnapshotResponse>;
/**
 * Gets snapshots for assets of all types, including indices.
 *
 * @param {string[]} tickers - Array of tickers to fetch snapshots for
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.apiKey] - API key to use for the request
 * @param {string} [options.type] - Filter by asset type
 * @param {string} [options.order] - Order results
 * @param {number} [options.limit] - Limit the number of results
 * @param {string} [options.sort] - Sort field
 * @returns {Promise<any>} The universal snapshot response
 */
export declare const fetchUniversalSnapshot: (tickers: string[], options?: {
    apiKey?: string;
    type?: string;
    order?: string;
    limit?: number;
    sort?: string;
}) => Promise<any>;
/**
 * Converts Polygon Indices bar data to a more standardized format
 *
 * @param {PolygonIndicesAggregatesResponse} data - The raw aggregates response
 * @returns {Array<{date: string, open: number, high: number, low: number, close: number, timestamp: number}>} Formatted bar data
 */
export declare const formatIndicesBarData: (data: PolygonIndicesAggregatesResponse) => Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    timestamp: number;
}>;
//# sourceMappingURL=polygon-indices.d.ts.map