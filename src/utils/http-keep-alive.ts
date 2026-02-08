/**
 * HTTP connection pooling and keep-alive configuration.
 *
 * Node.js (>=20) uses undici as its built-in fetch implementation, which
 * automatically maintains an internal connection pool with keep-alive enabled
 * by default. This module provides:
 *
 * 1. Explicit documentation of the connection pooling behavior
 * 2. A configured HTTP Agent for use with node:http/node:https if needed
 * 3. Verification utilities to confirm keep-alive is active
 *
 * ## Connection Pooling Behavior
 *
 * **Native fetch (undici):** The global `fetch()` used throughout this package
 * uses Node.js built-in undici which maintains persistent connections by default.
 * Connections are kept alive and reused across requests to the same origin.
 * No additional configuration is needed for fetch-based API calls.
 *
 * **Alpaca SDK (@alpacahq/alpaca-trade-api):** The SDK uses its own internal
 * HTTP client with connection reuse. The SDK is configured through `AlpacaClient`
 * in `src/alpaca/client.ts` via the `createAlpacaClient()` factory which caches
 * client instances by API key + account type.
 *
 * **WebSocket connections:** Trading API and market data WebSocket connections
 * are long-lived persistent connections managed by `AlpacaTradingAPI` and
 * `AlpacaMarketDataAPI` respectively.
 *
 * ## API Client Summary
 *
 * | API Client | Transport | Keep-Alive | Connection Reuse |
 * |------------|-----------|------------|------------------|
 * | Alpaca Trading (direct) | fetch() | Built-in | Undici pool |
 * | Alpaca Market Data | fetch() | Built-in | Undici pool |
 * | Alpaca SDK | internal | Built-in | SDK managed |
 * | Polygon.io | fetch() via fetchWithRetry | Built-in | Undici pool |
 * | Alpha Vantage | fetch() | Built-in | Undici pool |
 * | WebSocket (Trading) | ws | Persistent | Long-lived |
 * | WebSocket (Market Data) | ws | Persistent | Long-lived |
 */

import http from 'http';
import https from 'https';

/**
 * Default keep-alive configuration values.
 * These are applied when creating explicit HTTP agents for non-fetch use cases.
 */
export const KEEP_ALIVE_DEFAULTS = {
  /** Enable keep-alive connections */
  keepAlive: true,
  /** Initial delay before sending keep-alive probes (in milliseconds) */
  keepAliveMsecs: 60000,
  /** Maximum number of sockets per host */
  maxSockets: 50,
  /** Maximum total number of sockets */
  maxTotalSockets: 256,
  /** Maximum number of free (idle) sockets per host */
  maxFreeSockets: 10,
  /** Socket timeout for idle connections (in milliseconds) */
  timeout: 60000,
} as const;

/**
 * Pre-configured HTTP agent with keep-alive enabled.
 * Use this when making requests through node:http (not needed for fetch).
 */
export const httpAgent = new http.Agent({
  keepAlive: KEEP_ALIVE_DEFAULTS.keepAlive,
  keepAliveMsecs: KEEP_ALIVE_DEFAULTS.keepAliveMsecs,
  maxSockets: KEEP_ALIVE_DEFAULTS.maxSockets,
  maxTotalSockets: KEEP_ALIVE_DEFAULTS.maxTotalSockets,
  maxFreeSockets: KEEP_ALIVE_DEFAULTS.maxFreeSockets,
  timeout: KEEP_ALIVE_DEFAULTS.timeout,
});

/**
 * Pre-configured HTTPS agent with keep-alive enabled.
 * Use this when making requests through node:https (not needed for fetch).
 */
export const httpsAgent = new https.Agent({
  keepAlive: KEEP_ALIVE_DEFAULTS.keepAlive,
  keepAliveMsecs: KEEP_ALIVE_DEFAULTS.keepAliveMsecs,
  maxSockets: KEEP_ALIVE_DEFAULTS.maxSockets,
  maxTotalSockets: KEEP_ALIVE_DEFAULTS.maxTotalSockets,
  maxFreeSockets: KEEP_ALIVE_DEFAULTS.maxFreeSockets,
  timeout: KEEP_ALIVE_DEFAULTS.timeout,
});

/**
 * Connection pool status information
 */
export interface ConnectionPoolStatus {
  /** Name of the HTTP agent */
  name: string;
  /** Whether keep-alive is enabled */
  keepAlive: boolean;
  /** Number of active sockets */
  activeSockets: number;
  /** Number of free (idle) sockets */
  freeSockets: number;
  /** Number of pending requests (waiting for a socket) */
  pendingRequests: number;
  /** Maximum sockets per host */
  maxSockets: number;
  /** Maximum free sockets per host */
  maxFreeSockets: number;
}

/**
 * Get the connection pool status for an HTTP/HTTPS agent.
 * Useful for monitoring and debugging connection reuse.
 *
 * @param agent - The HTTP/HTTPS agent to inspect
 * @param name - A human-readable name for the agent
 * @returns Connection pool status information
 */
export function getAgentPoolStatus(
  agent: http.Agent | https.Agent,
  name: string = 'default'
): ConnectionPoolStatus {
  const sockets = agent.sockets || {};
  const freeSockets = agent.freeSockets || {};
  const requests = agent.requests || {};

  const activeSockets = Object.values(sockets).reduce(
    (sum, arr) => sum + (arr ? arr.length : 0),
    0
  );
  const freeSocketCount = Object.values(freeSockets).reduce(
    (sum, arr) => sum + (arr ? arr.length : 0),
    0
  );
  const pendingRequests = Object.values(requests).reduce(
    (sum, arr) => sum + (arr ? arr.length : 0),
    0
  );

  return {
    name,
    keepAlive: (agent as http.Agent & { keepAlive?: boolean }).keepAlive ?? false,
    activeSockets,
    freeSockets: freeSocketCount,
    pendingRequests,
    maxSockets: agent.maxSockets,
    maxFreeSockets: agent.maxFreeSockets,
  };
}

/**
 * Verifies that keep-alive is properly configured for the Node.js built-in fetch.
 * Node.js >= 20 uses undici internally, which has keep-alive enabled by default.
 *
 * @returns Object indicating whether keep-alive is expected to be active
 */
export function verifyFetchKeepAlive(): {
  supported: boolean;
  nodeVersion: string;
  undiciBuiltIn: boolean;
  keepAliveExpected: boolean;
} {
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);

  // Node.js >= 18 has built-in fetch via undici
  // Node.js >= 20 has mature undici with connection pooling
  const undiciBuiltIn = majorVersion >= 18;
  const keepAliveExpected = majorVersion >= 18;

  return {
    supported: true,
    nodeVersion,
    undiciBuiltIn,
    keepAliveExpected,
  };
}
