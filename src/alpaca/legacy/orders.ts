/**
 * Legacy Alpaca Order Functions
 * Order management using AlpacaAuth pattern with direct fetch calls.
 */
import {
  AlpacaAuth,
  AlpacaOrder,
  CreateOrderParams,
  GetOrdersParams,
  ReplaceOrderParams,
} from "../../types/alpaca-types";
import { validateAuth } from "./auth";
import { getTradingApiUrl } from "../../config/api-endpoints";
import { getLogger } from "../../logger";
import { isTransientNetworkError } from "../../utils/retry";
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from "../../http-timeout";
import {
  alpacaHttpError,
  AlpacaApiError,
  isPendingCancelRejection,
  PendingCancelError,
} from "../../errors";

const PAGINATION_DELAY_MS = 300;
const ORDER_CHUNK_SIZE = 500;

/**
 * Hard ceiling on the {@link getOrders} paging walk.
 *
 * The walk is driven by a timestamp cursor that must strictly narrow on every
 * iteration, and both ways it can fail to do so are caught explicitly below.
 * This is the backstop for a vendor behaviour we have not anticipated: it
 * bounds the loop in wall-clock terms rather than letting a reconciliation
 * cycle hang on the broker. At `ORDER_CHUNK_SIZE` per page it admits 100k
 * orders, far beyond any account we run.
 */
const MAX_ORDER_PAGES = 200;

/**
 * Most orders Alpaca can fold into ONE top-level entry of a `nested: true`
 * response: the parent plus its two protective legs. Alpaca nests at most one
 * level, so this is the arity bound, not a guess at typical shape.
 */
const MAX_ORDERS_PER_TOP_LEVEL_ENTRY = 3;

/**
 * Shortest top-level array that could still be a server page capped at
 * `ORDER_CHUNK_SIZE`. `limit` caps what the server counts; what we receive is
 * the top-level array, and under `nested: true` those differ. Anything at
 * least this long has to be treated as possibly capped; anything shorter
 * cannot be, however the server counted.
 */
const MIN_PAGE_LENGTH_POSSIBLY_CAPPED = Math.ceil(
  ORDER_CHUNK_SIZE / MAX_ORDERS_PER_TOP_LEVEL_ENTRY,
);

/**
 * Makes a generic authenticated request to the Alpaca API.
 * @param auth - The authentication details for Alpaca
 * @param params - Request parameters including endpoint, method, body, queryString, and apiBaseUrl
 * @returns The parsed JSON response
 * @throws Error if the request fails
 */
export async function makeRequest<T = unknown>(
  auth: AlpacaAuth,
  params: {
    endpoint: string;
    method: string;
    body?: Record<string, unknown> | CreateOrderParams;
    queryString?: string;
    apiBaseUrl?: string;
  },
): Promise<T> {
  const { endpoint, method, body, queryString, apiBaseUrl } = params;

  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrlInner = apiBaseUrl
      ? apiBaseUrl
      : getTradingApiUrl(type as "PAPER" | "LIVE");
    if (!APIKey || !APISecret) {
      throw new Error(
        "No valid Alpaca authentication found. Please provide either auth object or set ALPACA_API_KEY and ALPACA_API_SECRET environment variables.",
      );
    }

    const url = `${apiBaseUrlInner}${endpoint}${queryString || ""}`;

    getLogger().info(
      `Making ${method} request to ${endpoint}${queryString || ""}`,
      {
        account: auth.adapticAccountId || "direct",
        source: "AlpacaAPI",
      },
    );

    const fetchOptions: RequestInit = {
      method,
      headers: {
        "APCA-API-KEY-ID": APIKey,
        "APCA-API-SECRET-KEY": APISecret,
      },
    };

    // Only add Content-Type and body for non-GET/HEAD requests that have a body
    if (body && method !== "GET" && method !== "HEAD") {
      fetchOptions.headers = {
        ...fetchOptions.headers,
        "Content-Type": "application/json",
      };
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, {
      ...fetchOptions,
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    // Handle 207 Multi-Status responses (used by closeAll positions)
    if (response.status === 207 || response.ok) {
      return (await response.json()) as T;
    }

    const errorText = await response.text();
    getLogger().error(`Alpaca API error (${response.status}): ${errorText}`, {
      account: auth.adapticAccountId || "direct",
      source: "AlpacaAPI",
      type: "error",
    });
    throw alpacaHttpError(
      `Alpaca API error (${response.status}): ${errorText}`,
      response.status,
      errorText,
    );
  } catch (err) {
    const error = err as Error;
    getLogger().error(`Error in makeRequest: ${error.message}`, {
      source: "AlpacaAPI",
      type: "error",
    });
    throw error;
  }
}

/**
 * Creates a new order in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param params - The parameters for creating the order
 * @returns The created order
 */
export async function createOrder(
  auth: AlpacaAuth,
  params: CreateOrderParams,
): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");

    const response = await fetch(`${apiBaseUrl}/orders`, {
      method: "POST",
      headers: {
        "APCA-API-KEY-ID": APIKey,
        "APCA-API-SECRET-KEY": APISecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw alpacaHttpError(
        `Failed to create order: ${response.status} ${response.statusText} ${errorText}`,
        response.status,
        errorText,
      );
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    getLogger().error("Error in createOrder:", error);
    throw error;
  }
}

/**
 * Retrieves a list of orders from Alpaca with automatic pagination.
 *
 * ## Why termination is not "the page came back short"
 *
 * Until 2026-10-20 this walk stopped as soon as a page returned fewer than
 * `ORDER_CHUNK_SIZE` top-level orders. That treats the top-level array length
 * as what the server capped, which `nested: true` breaks: Alpaca returns each
 * parent order with its legs inside it, so one entry can stand for several
 * orders counted against `limit`, a full server page surfaces as a short
 * array, and the walk stops early. The caller then holds a truncated order
 * pool indistinguishable from a complete one, and on the reconciliation path
 * "no broker order exists for this trade" is what closes a live position.
 *
 * So the walk ends on a page that yields **no order we have not already seen**
 * — an empty page, or (because `until` is inclusive) only the boundary order
 * coming back again. Length is consulted only through
 * {@link MIN_PAGE_LENGTH_POSSIBLY_CAPPED}, which is a bound on what nesting
 * can hide rather than a claim that a short page means the end.
 *
 * NOT established: whether Alpaca really counts nested legs against `limit`.
 * The only direct evidence is a fake broker that encodes it that way. The fix
 * does not rest on it — a termination that assumes an undocumented vendor
 * guarantee is wrong on its own terms, and this one holds under either
 * answer.
 *
 * ## Why it can throw rather than return what it has
 *
 * The cursor is `until`, moved to the oldest `submitted_at` on each page, and
 * the window has to narrow or the next request repeats this one. Two things
 * stop it narrowing: `ORDER_CHUNK_SIZE` or more orders sharing a single
 * `submitted_at`, and orders arriving with no `submitted_at` to move to. In
 * both cases there is more history behind the cursor that this query shape
 * cannot reach. Returning the partial set would reintroduce exactly the silent
 * truncation above, so the read fails instead and the caller fails closed
 * (utils engineering rule 3) rather than trading on a short pool.
 *
 * Note that the cursor only walks backwards, so `direction: "asc"` is not a
 * supported way to page a result set larger than one chunk: it surfaces as a
 * stalled cursor rather than as silently missing orders.
 *
 * @param auth - The authentication details for Alpaca
 * @param params - The parameters for fetching orders
 * @returns Every order matching `params`, de-duplicated by order id
 * @throws {AlpacaApiError} `ORDER_PAGINATION_STALLED`,
 *   `ORDER_PAGINATION_NO_CURSOR` or `ORDER_PAGINATION_UNBOUNDED` when the walk
 *   cannot reach the whole result set. Never returns a partial set silently.
 */
export async function getOrders(
  auth: AlpacaAuth,
  params: GetOrdersParams = {},
): Promise<AlpacaOrder[]> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");

    const allOrders: AlpacaOrder[] = [];
    const seenOrderIds = new Set<string>();
    let currentUntil = params.until ? params.until : new Date().toISOString();

    // Parsed alongside the string form: the cursor is SENT as the vendor's own
    // timestamp (so no sub-millisecond precision is dropped from the query)
    // but COMPARED numerically, because ISO-8601 strings of differing
    // fractional precision do not order lexicographically.
    let currentUntilMs = Date.parse(currentUntil);
    if (Number.isNaN(currentUntilMs)) {
      throw new AlpacaApiError(
        `getOrders received an unparseable \`until\`: ${JSON.stringify(params.until)}`,
        "ORDER_PAGINATION_NO_CURSOR",
      );
    }

    for (let page = 1; ; page++) {
      if (page > MAX_ORDER_PAGES) {
        throw new AlpacaApiError(
          `getOrders exceeded ${MAX_ORDER_PAGES} pages with the cursor at ${currentUntil} (${allOrders.length} orders read); refusing to return a partial order set`,
          "ORDER_PAGINATION_UNBOUNDED",
        );
      }

      const queryParams = new URLSearchParams();
      if (params.status) queryParams.append("status", params.status);
      queryParams.append("limit", ORDER_CHUNK_SIZE.toString());
      if (params.after) queryParams.append("after", params.after);
      queryParams.append("until", currentUntil);
      if (params.direction) queryParams.append("direction", params.direction);
      if (params.nested) queryParams.append("nested", params.nested.toString());
      if (params.symbols)
        queryParams.append("symbols", params.symbols.join(","));
      if (params.side) queryParams.append("side", params.side);

      const response = await fetch(`${apiBaseUrl}/orders?${queryParams}`, {
        method: "GET",
        headers: {
          "APCA-API-KEY-ID": APIKey,
          "APCA-API-SECRET-KEY": APISecret,
        },
        signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw alpacaHttpError(
          `Failed to get orders: ${response.status} ${response.statusText} ${errorText}`,
          response.status,
          errorText,
        );
      }

      const orders = (await response.json()) as AlpacaOrder[];

      // The oldest order on the page is the next cursor. Taken as a minimum
      // rather than as the last element, which would assume the vendor's
      // default descending order and silently invert under `direction: "asc"`.
      let oldestSubmittedAt: string | undefined;
      let oldestMs = Number.POSITIVE_INFINITY;
      let unseenOnThisPage = 0;

      for (const order of orders) {
        if (order.submitted_at) {
          const submittedMs = Date.parse(order.submitted_at);
          if (!Number.isNaN(submittedMs) && submittedMs < oldestMs) {
            oldestMs = submittedMs;
            oldestSubmittedAt = order.submitted_at;
          }
        }
        if (seenOrderIds.has(order.id)) continue;
        seenOrderIds.add(order.id);
        allOrders.push(order);
        unseenOnThisPage++;
      }

      // History exhausted. Either the page was empty, or everything on it was
      // already in hand because `until` is inclusive and re-serves the
      // boundary order.
      if (unseenOnThisPage === 0) break;

      // Too short to be a capped page however the server counted it, so this
      // is the end of the window. The only use of page length here, and a
      // bound on what nesting can hide rather than the old "short means done".
      if (orders.length < MIN_PAGE_LENGTH_POSSIBLY_CAPPED) break;

      // Past this point there IS more history and the cursor has to move.
      if (oldestSubmittedAt === undefined) {
        throw new AlpacaApiError(
          `getOrders cannot page past ${currentUntil}: ${unseenOnThisPage} new order(s) on this page carry no usable submitted_at, so the cursor cannot advance`,
          "ORDER_PAGINATION_NO_CURSOR",
        );
      }

      if (oldestMs >= currentUntilMs) {
        throw new AlpacaApiError(
          `getOrders cannot page past ${currentUntil}: ${unseenOnThisPage} new order(s) sit at or after the cursor, so the window cannot narrow`,
          "ORDER_PAGINATION_STALLED",
        );
      }

      currentUntil = oldestSubmittedAt;
      currentUntilMs = oldestMs;
      await new Promise((resolve) => setTimeout(resolve, PAGINATION_DELAY_MS));
    }

    return allOrders;
  } catch (error) {
    const isTransient = isTransientNetworkError(error);
    const errMsg = error instanceof Error ? error.message : String(error);
    const logMeta = {
      source: "AlpacaLegacy.getOrders",
      error: errMsg,
      ...(isTransient
        ? {
            transient: true,
            recoveryHint: "Upstream caller should retry on next cycle",
          }
        : {}),
    };
    // Transient network errors (fetch timeouts, ECONNRESET) are
    // recoverable; log at WARN. Non-transient failures (4xx/auth)
    // stay at ERROR. Previous call also passed the raw Error as the
    // second argument, which Pino treats as context not as `err`,
    // producing empty `err` fields in production logs — fix by
    // serializing to an explicit string message.
    if (isTransient) {
      getLogger().warn(`Error in getOrders: ${errMsg}`, logMeta);
    } else {
      getLogger().error(`Error in getOrders: ${errMsg}`, logMeta);
    }
    throw error;
  }
}

/**
 * Cancels all orders in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @returns The list of canceled orders with their statuses
 */
export async function cancelAllOrders(
  auth: AlpacaAuth,
): Promise<{ id: string; status: number }[]> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");

    const response = await fetch(`${apiBaseUrl}/orders`, {
      method: "DELETE",
      headers: {
        "APCA-API-KEY-ID": APIKey,
        "APCA-API-SECRET-KEY": APISecret,
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw alpacaHttpError(
        `Failed to cancel orders: ${response.status} ${response.statusText} ${errorText}`,
        response.status,
        errorText,
      );
    }

    return (await response.json()) as { id: string; status: number }[];
  } catch (error) {
    getLogger().error("Error in cancelAllOrders:", error);
    throw error;
  }
}

/**
 * Retrieves a specific order from Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param orderId - The ID of the order to retrieve
 * @param nested - Whether to include nested details
 * @returns The requested order
 */
export async function getOrder(
  auth: AlpacaAuth,
  orderId: string,
  nested?: boolean,
): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");

    const queryParams = new URLSearchParams();
    if (nested) queryParams.append("nested", "true");

    const response = await fetch(
      `${apiBaseUrl}/orders/${orderId}?${queryParams}`,
      {
        method: "GET",
        headers: {
          "APCA-API-KEY-ID": APIKey,
          "APCA-API-SECRET-KEY": APISecret,
        },
        signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw alpacaHttpError(
        `Failed to get order: ${response.status} ${response.statusText} ${errorText}`,
        response.status,
        errorText,
      );
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    getLogger().error("Error in getOrder:", error);
    throw error;
  }
}

/**
 * Replaces an existing order in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param orderId - The ID of the order to replace
 * @param params - The parameters for replacing the order
 * @returns The updated order
 */
export async function replaceOrder(
  auth: AlpacaAuth,
  orderId: string,
  params: ReplaceOrderParams,
): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");

    const response = await fetch(`${apiBaseUrl}/orders/${orderId}`, {
      method: "PATCH",
      headers: {
        "APCA-API-KEY-ID": APIKey,
        "APCA-API-SECRET-KEY": APISecret,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(params),
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw alpacaHttpError(
        `Failed to replace order: ${response.status} ${response.statusText} ${errorText}`,
        response.status,
        errorText,
      );
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    getLogger().error("Error in replaceOrder:", error);
    throw error;
  }
}

/**
 * Cancels a specific order in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param orderId - The ID of the order to cancel
 * @returns Success status and optional message if order not found
 * @throws PendingCancelError if the broker already holds the order in
 *   `pending_cancel` (the order is dying; never cancel it again). The message
 *   is the same "Failed to cancel order: ..." text as any other refusal.
 */
export async function cancelOrder(
  auth: AlpacaAuth,
  orderId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");

    const response = await fetch(`${apiBaseUrl}/orders/${orderId}`, {
      method: "DELETE",
      headers: {
        "APCA-API-KEY-ID": APIKey,
        "APCA-API-SECRET-KEY": APISecret,
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        return { success: false, message: `Order not found: ${orderId}` };
      } else {
        const httpError = alpacaHttpError(
          `Failed to cancel order: ${response.status} ${response.statusText} ${errorText}`,
          response.status,
          errorText,
        );
        // A cancel the broker already accepted: the order is dying, not kept,
        // and a second DELETE only returns the same 422.
        if (isPendingCancelRejection(httpError)) {
          throw new PendingCancelError(httpError.message, orderId, httpError);
        }
        throw httpError;
      }
    }

    return { success: true };
  } catch (error) {
    getLogger().error("Error in cancelOrder:", error);
    throw error;
  }
}

/**
 * Creates a limit order in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param params - Order parameters including symbol, qty, side, limitPrice, position_intent, extended_hours
 * @returns The created limit order
 */
export async function createLimitOrder(
  auth: AlpacaAuth,
  params: {
    symbol: string;
    qty: number;
    side: "buy" | "sell";
    limitPrice: number;
    position_intent:
      | "buy_to_open"
      | "buy_to_close"
      | "sell_to_open"
      | "sell_to_close";
    extended_hours: boolean;
    client_order_id?: string;
    time_in_force?: "day" | "gtc" | "ioc" | "fok";
  } = {
    symbol: "",
    qty: 0,
    side: "buy",
    limitPrice: 0,
    position_intent: "buy_to_open",
    extended_hours: false,
    client_order_id: undefined,
    time_in_force: undefined,
  },
): Promise<AlpacaOrder> {
  const {
    symbol,
    qty,
    side,
    limitPrice,
    position_intent,
    extended_hours,
    client_order_id,
    time_in_force,
  } = params;

  const effectiveTimeInForce = time_in_force ?? "day";

  getLogger().info(
    `Creating limit order for ${symbol}: ${side} ${qty} shares at ${limitPrice.toFixed(2)} (${position_intent}, tif=${effectiveTimeInForce})`,
    {
      account: auth.adapticAccountId || "direct",
      symbol,
    },
  );

  const body: Record<string, unknown> = {
    symbol,
    qty: Math.abs(qty),
    side,
    position_intent,
    type: "limit",
    limit_price: limitPrice.toString(),
    time_in_force: effectiveTimeInForce,
    order_class: "simple",
    extended_hours,
  };
  if (client_order_id !== undefined) {
    body.client_order_id = client_order_id;
  }

  return makeRequest(auth, {
    endpoint: "/orders",
    method: "POST",
    body,
  });
}
