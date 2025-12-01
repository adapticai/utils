/**
 * Types for Polygon Indices API
 */
/**
 * Base response interface for Polygon API responses
 */
export interface PolygonIndicesBaseResponse {
    /** The status of the response. */
    status: string;
    /** The request ID. */
    request_id: string;
}
/**
 * Error response from Polygon Indices API
 */
export interface PolygonIndicesErrorResponse extends PolygonIndicesBaseResponse {
    /** The status of the error response. */
    status: 'ERROR' | 'NOT_AUTHORIZED' | string;
    /** The error message. */
    message: string;
}
/**
 * Represents a single bar/aggregate data point for an index
 */
export interface PolygonIndicesBar {
    /** The close value for the index in the given time period. */
    c: number;
    /** The highest value for the index in the given time period. */
    h: number;
    /** The lowest value for the index in the given time period. */
    l: number;
    /** The open value for the index in the given time period. */
    o: number;
    /** The Unix Msec timestamp for the start of the aggregate window. */
    t: number;
}
/**
 * Response for the aggregates (bars) endpoint
 */
export interface PolygonIndicesAggregatesResponse extends PolygonIndicesBaseResponse {
    /** The ticker symbol of the index. */
    ticker: string;
    /** The number of aggregates used to generate the response. */
    queryCount: number;
    /** The total number of results for this request. */
    resultsCount?: number;
    /** The count of results returned. */
    count?: number;
    /** The array of aggregate results. */
    results: PolygonIndicesBar[];
}
/**
 * Represents a previous close result for an index
 */
export interface PolygonIndicesPrevCloseResult {
    /** The ticker symbol. */
    T: string;
    /** The close value for the index in the given time period. */
    c: number;
    /** The highest value for the index in the given time period. */
    h: number;
    /** The lowest value for the index in the given time period. */
    l: number;
    /** The open value for the index in the given time period. */
    o: number;
    /** The Unix Msec timestamp for the start of the aggregate window. */
    t: number;
}
/**
 * Response for the previous close endpoint
 */
export interface PolygonIndicesPrevCloseResponse extends PolygonIndicesBaseResponse {
    /** The ticker symbol of the index. */
    ticker: string;
    /** The number of aggregates used to generate the response. */
    queryCount: number;
    /** The total number of results for this request. */
    resultsCount: number;
    /** The array of previous close results. */
    results: PolygonIndicesPrevCloseResult[];
}
/**
 * Response for the daily open/close endpoint
 */
export interface PolygonIndicesDailyOpenCloseResponse {
    /** The after-hours value of the index, if available. */
    afterHours?: number;
    /** The close value for the index. */
    close: number;
    /** The date of the data in ISO format. */
    from: string;
    /** The highest value for the index during the day. */
    high: number;
    /** The lowest value for the index during the day. */
    low: number;
    /** The open value for the index. */
    open: number;
    /** The pre-market value of the index, if available. */
    preMarket?: number;
    /** The status of the response. */
    status: string;
    /** The ticker symbol of the index. */
    symbol: string;
}
/**
 * Represents a session data for an index in the snapshot
 */
export interface PolygonIndicesSession {
    /** The value of the change for the index from the previous trading day. */
    change: number;
    /** The percent of the change for the index from the previous trading day. */
    change_percent: number;
    /** The closing value for the index of the day. */
    close: number;
    /** The highest value for the index of the day. */
    high: number;
    /** The lowest value for the index of the day. */
    low: number;
    /** The open value for the index of the day. */
    open: number;
    /** The closing value for the index of previous trading day. */
    previous_close: number;
}
/**
 * Represents a single index result in the snapshot response
 */
export interface PolygonIndicesSnapshotResult {
    /** The nanosecond timestamp of when this information was updated. */
    last_updated?: number;
    /** The market status for the market that trades this index. */
    market_status?: string;
    /** Name of the index. */
    name?: string;
    /** Session data for the index. */
    session?: PolygonIndicesSession;
    /** Ticker of the index. */
    ticker: string;
    /** The time relevance of the data. */
    timeframe?: 'DELAYED' | 'REAL-TIME';
    /** The type of the asset. */
    type?: 'indices';
    /** Value of the index. */
    value?: number;
    /** Error message if there was an issue with this ticker. */
    error?: string;
    /** Error message details. */
    message?: string;
}
/**
 * Response for the indices snapshot endpoint
 */
export interface PolygonIndicesSnapshotResponse extends PolygonIndicesBaseResponse {
    /** URL for the next page of results, if available. */
    next_url?: string;
    /** The array of index snapshot results. */
    results: PolygonIndicesSnapshotResult[];
}
/**
 * Parameters for fetching aggregates (bars) for an index
 */
export interface PolygonIndicesAggregatesParams {
    /** The ticker symbol of the index. */
    indicesTicker: string;
    /** The size of the timespan multiplier. */
    multiplier: number;
    /** The size of the time window (minute, hour, day, week, month, quarter, year). */
    timespan: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
    /** The start of the aggregate time window (YYYY-MM-DD or millisecond timestamp). */
    from: string | number;
    /** The end of the aggregate time window (YYYY-MM-DD or millisecond timestamp). */
    to: string | number;
    /** Sort the results by timestamp (asc or desc). */
    sort?: 'asc' | 'desc';
    /** Limits the number of base aggregates queried. */
    limit?: number;
}
/**
 * Parameters for fetching indices snapshot
 */
export interface PolygonIndicesSnapshotParams {
    /** Comma separated list of tickers. */
    tickers?: string[];
    /** Order results based on the sort field. */
    order?: 'asc' | 'desc';
    /** Limit the number of results returned. */
    limit?: number;
    /** Sort field used for ordering. */
    sort?: string;
}
//# sourceMappingURL=polygon-indices-types.d.ts.map