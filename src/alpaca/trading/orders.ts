/**
 * Alpaca Order Management Module
 * Provides functions for creating, managing, and canceling orders using the official SDK
 */
import { createHash, randomUUID } from "node:crypto";
import { AlpacaClient } from "../client";
import { DuplicateClientOrderIdError, enrichAlpacaError } from "../../errors";
import { classifyRetryError } from "../../utils/retry";
import { log as baseLog } from "../../logging";
import { LogOptions } from "../../types/logging-types";
import {
  AlpacaOrder,
  AlpacaSDKOrderParams,
  CreateOrderParams,
  GetOrdersParams,
  ReplaceOrderParams,
  OrderStatus,
  SDKGetOrdersParams,
} from "../../types/alpaca-types";

const LOG_SOURCE = "AlpacaOrders";

/**
 * Internal logging helper with consistent source
 */
const log = (message: string, options: LogOptions = { type: "info" }) => {
  baseLog(message, { ...options, source: LOG_SOURCE });
};

/**
 * Response from cancel all orders operation
 */
export interface CancelAllOrdersResponse {
  /** Number of orders successfully canceled */
  canceled: number;
  /** Order IDs that failed to cancel */
  failed: string[];
}

/**
 * Maximum length Alpaca accepts for a `client_order_id`.
 */
export const MAX_CLIENT_ORDER_ID_LENGTH = 128;

/**
 * Characters Alpaca does **not** accept inside a `client_order_id`. Anything
 * matching is rewritten before submission.
 */
const UNSAFE_CLIENT_ORDER_ID_CHARS = /[^A-Za-z0-9._:-]/g;

/**
 * Hex characters of the SHA-256 digest appended when an idempotency key had to
 * be rewritten (unsafe characters or over-length). 16 hex chars = 64 bits,
 * which keeps two keys that sanitise to the same head distinguishable.
 */
const CLIENT_ORDER_ID_DIGEST_LENGTH = 16;

/** Separator between the sanitised head and the digest tag. */
const CLIENT_ORDER_ID_DIGEST_SEPARATOR = "-";

/** HTTP status Alpaca uses for a duplicate `client_order_id`. */
const DUPLICATE_CLIENT_ORDER_ID_STATUS = 422;

/** HTTP status Alpaca returns when no order carries the given id. */
const ORDER_NOT_FOUND_STATUS = 404;

/**
 * Matches Alpaca's duplicate-idempotency-key rejection text. Alpaca has used
 * both "client_order_id must be unique" and "client order id must be unique"
 * across API revisions, so the separator is matched loosely.
 */
const DUPLICATE_CLIENT_ORDER_ID_PATTERN =
  /client[\s_-]?order[\s_-]?id must be unique/i;

/**
 * Order statuses in which a previously-submitted order can never execute. A
 * duplicate colliding with an order in one of these states is NOT an idempotent
 * success — the caller asked for an order that cannot exist under that id, so
 * the typed duplicate error is raised instead of a silent resubmission.
 */
const TERMINAL_DEAD_ORDER_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "expired",
  "rejected",
  "replaced",
  "done_for_day",
]);

/**
 * The idempotency contract every order submission should satisfy.
 *
 * Without it, `AlpacaClient.executeWithRateLimit`'s automatic retry re-sends a
 * POST that may already have landed broker-side — an ECONNRESET after the order
 * was accepted doubles a live position (F-0035). The key makes the submission
 * idempotent at the broker: the same key always produces the same
 * `client_order_id`, and Alpaca rejects the second POST instead of filling it.
 *
 * A caller-supplied key is the only thing that makes a *caller-level* retry
 * (a fresh `createOrder` call for the same logical order) safe. The
 * transitional overload that accepts no key buys transport-retry idempotency
 * only — see {@link createOrder}.
 */
export interface OrderIdempotency {
  /**
   * Identity of the **logical** order, supplied by the caller. Two submissions
   * carrying the same key are the same order and must never both fill; a
   * genuinely new order needs a new key. The engine's convention is the
   * originating `trade.id` (`client_order_id === trade.id`), which
   * {@link deriveClientOrderId} preserves verbatim.
   */
  idempotencyKey: string;
}

/** {@link CreateOrderParams} plus the mandatory idempotency key. */
export type IdempotentCreateOrderParams = CreateOrderParams & OrderIdempotency;

/**
 * {@link CreateOrderParams} with the idempotency key **optional** — the shape
 * the transitional (deprecated) `createOrder` overload accepts.
 *
 * This exists only because `createOrder` is published public API with callers
 * that supply no order identity (`options/strategies.ts` in this package, owned
 * by B-0061; `tool-execution-engine.ts` in the engine). Requiring the key
 * outright broke their compilation. Every such caller is expected to migrate to
 * {@link IdempotentCreateOrderParams}; see {@link createOrder} for exactly what
 * an omitted key does and does not guarantee.
 */
export type OptionallyIdempotentCreateOrderParams = CreateOrderParams &
  Partial<OrderIdempotency>;

/**
 * Prefix marking a `client_order_id` this module minted because the caller
 * supplied no identity of its own. It makes the un-migrated call sites
 * greppable broker-side and in fill telemetry, and it can never collide with
 * the engine's `trade.id` convention.
 */
const GENERATED_IDEMPOTENCY_KEY_PREFIX = "adptc-auto";

/**
 * Mints a per-submission idempotency key for a caller that supplied none.
 *
 * The key is a fresh random UUID, so it is unique to **this call** and is held
 * constant for the whole of it — which is precisely what makes the transport
 * retry inside {@link AlpacaClient.executeWithRateLimit} idempotent: a POST
 * that already landed is refused broker-side on the re-send instead of filling
 * twice (F-0035). It deliberately carries no other meaning. It is **not**
 * derived from the order's contents or from the clock, because either would
 * claim a de-duplication across separate calls that a generated key cannot
 * honestly provide: content-derived keys would silently swallow a legitimate
 * repeat order, and clock-derived keys would de-duplicate or not depending on
 * which side of a bucket boundary the second call fell.
 *
 * @returns A broker-safe, unique key for a single submission.
 */
function generateSubmissionIdempotencyKey(): string {
  return `${GENERATED_IDEMPOTENCY_KEY_PREFIX}-${randomUUID()}`;
}

/**
 * Validates a caller-supplied idempotency key.
 * @param idempotencyKey - The key to validate.
 * @returns The trimmed key.
 * @throws Error when the key is empty or whitespace-only.
 */
function requireIdempotencyKey(idempotencyKey: string): string {
  const key = idempotencyKey.trim();
  if (key.length === 0) {
    throw new Error(
      "Order submission requires a non-empty idempotency key identifying the logical order",
    );
  }
  return key;
}

/**
 * Derives the broker-side `client_order_id` from a caller-supplied idempotency
 * key. Deterministic: the same key always yields the same id, so a retry of the
 * same logical order collides broker-side instead of creating a second order.
 *
 * A key that is already broker-safe is used **verbatim**, which preserves the
 * engine's `client_order_id === trade.id` convention (and keeps every
 * reconciliation path that joins on `trade.id` working). A key needing
 * sanitisation or truncation is rewritten and tagged with a SHA-256 digest of
 * the original, so two distinct keys can never collapse onto one id.
 *
 * @param idempotencyKey - Identity of the logical order.
 * @returns An Alpaca-safe, length-bounded `client_order_id`.
 * @throws Error when the key is empty or whitespace-only.
 */
export function deriveClientOrderId(idempotencyKey: string): string {
  const key = requireIdempotencyKey(idempotencyKey);
  const sanitized = key.replace(UNSAFE_CLIENT_ORDER_ID_CHARS, "-");

  if (sanitized === key && key.length <= MAX_CLIENT_ORDER_ID_LENGTH) {
    return key;
  }

  const digest = createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, CLIENT_ORDER_ID_DIGEST_LENGTH);
  const headLength =
    MAX_CLIENT_ORDER_ID_LENGTH -
    digest.length -
    CLIENT_ORDER_ID_DIGEST_SEPARATOR.length;

  return `${sanitized.slice(0, headLength)}${CLIENT_ORDER_ID_DIGEST_SEPARATOR}${digest}`;
}

/**
 * Validates a `client_order_id` a caller supplied **explicitly**, instead of
 * letting it be derived from the idempotency key.
 *
 * An explicit id bypasses {@link deriveClientOrderId}, so it must satisfy the
 * same broker contract on its own: non-empty, within Alpaca's length bound, and
 * free of characters Alpaca rejects. A blank or malformed id is refused here
 * rather than submitted — a submission the broker ignores or rejects leaves the
 * POST non-idempotent, which is the F-0035 failure this contract exists to
 * close. It is never silently rewritten: rewriting a caller-chosen id would
 * break every reconciliation path that joins on it.
 *
 * @param clientOrderId - The explicitly supplied broker id.
 * @returns The id, unchanged.
 * @throws Error when the id is blank, over-length, or contains characters
 *   Alpaca does not accept.
 */
function requireExplicitClientOrderId(clientOrderId: string): string {
  if (clientOrderId.trim().length === 0) {
    throw new Error(
      "Order submission was given a blank client_order_id; supply a non-empty id or omit it and let the idempotency key derive one",
    );
  }
  if (clientOrderId.length > MAX_CLIENT_ORDER_ID_LENGTH) {
    throw new Error(
      `Order submission client_order_id exceeds Alpaca's ${MAX_CLIENT_ORDER_ID_LENGTH}-character limit (${clientOrderId.length})`,
    );
  }
  if (clientOrderId.replace(UNSAFE_CLIENT_ORDER_ID_CHARS, "-") !== clientOrderId) {
    throw new Error(
      `Order submission client_order_id "${clientOrderId}" contains characters Alpaca does not accept`,
    );
  }
  return clientOrderId;
}

/**
 * Renders everything the broker said about a rejection: the error message plus
 * the vendor payload, which is where Alpaca puts the actual reason (the SDK's
 * own message is only "Request failed with status code NNN").
 *
 * @param error - The thrown value.
 * @returns A single human-readable description.
 */
function describeRejection(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof error !== "object" || error === null) {
    return message;
  }
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) {
    return message;
  }
  const data = (response as { data?: unknown }).data;
  if (data === undefined || data === null) {
    return message;
  }
  const rendered = typeof data === "string" ? data : JSON.stringify(data);
  return `${message}: ${rendered}`;
}

/**
 * Whether a rejection is Alpaca's duplicate-`client_order_id` refusal — decided
 * from the typed HTTP status plus the vendor payload, never from a status-shaped
 * number found loose in the text.
 *
 * @param error - The thrown value.
 * @returns true when the broker refused the order as a duplicate.
 */
function isDuplicateClientOrderIdRejection(error: unknown): boolean {
  if (classifyRetryError(error).status !== DUPLICATE_CLIENT_ORDER_ID_STATUS) {
    return false;
  }
  return DUPLICATE_CLIENT_ORDER_ID_PATTERN.test(describeRejection(error));
}

/**
 * Looks up an order by its `client_order_id`.
 *
 * @param client - The AlpacaClient instance
 * @param clientOrderId - The idempotency key the order was submitted with
 * @returns The order, or null when the broker holds no order for that id
 * @throws The underlying error when the lookup fails for any reason other than
 *   "not found" — an unverifiable lookup must never be read as "no order".
 *
 * @example
 * const existing = await getOrderByClientOrderId(client, trade.id);
 */
export async function getOrderByClientOrderId(
  client: AlpacaClient,
  clientOrderId: string,
): Promise<AlpacaOrder | null> {
  try {
    const sdk = client.getSDK();
    return await client.executeWithRateLimit<AlpacaOrder>(
      () => sdk.getOrderByClientId(clientOrderId) as Promise<AlpacaOrder>,
      `getOrderByClientOrderId ${clientOrderId}`,
    );
  } catch (error) {
    if (classifyRetryError(error).status === ORDER_NOT_FOUND_STATUS) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolves a duplicate-`client_order_id` rejection **without ever issuing a
 * second POST**.
 *
 * - Colliding order live or filled → returned as idempotent success. This is
 *   the retry-after-network-failure case the key exists to de-duplicate.
 * - Colliding order terminally dead, absent, or unverifiable → typed
 *   {@link DuplicateClientOrderIdError}. Fails **closed**: the 422 proves an
 *   order with this id exists, so resubmitting could double-fill.
 *
 * @param client - The AlpacaClient instance
 * @param clientOrderId - The id the broker refused as a duplicate
 * @param symbol - Symbol, for log attribution
 * @param cause - The original duplicate rejection
 * @returns The already-submitted order when it is live or filled
 */
async function resolveDuplicateSubmission(
  client: AlpacaClient,
  clientOrderId: string,
  symbol: string,
  cause: unknown,
): Promise<AlpacaOrder> {
  let existing: AlpacaOrder | null;
  try {
    existing = await getOrderByClientOrderId(client, clientOrderId);
  } catch (lookupError) {
    const reason =
      lookupError instanceof Error ? lookupError.message : String(lookupError);
    log(
      `Duplicate-order lookup failed for ${clientOrderId}; failing closed (no resubmit): ${reason}`,
      { type: "error", symbol, metadata: { clientOrderId } },
    );
    // The typed error represents the ORIGINAL duplicate rejection, so its broker
    // payload must come from `cause` (the 422), not from the lookup failure.
    // Chain the lookup error ahead of the original 422 (and carry the 422's
    // normalized detail onto it) so both are diagnosable and
    // getAlpacaBrokerErrorCode still resolves the duplicate code.
    throw new DuplicateClientOrderIdError(
      `Duplicate client_order_id "${clientOrderId}" rejected by Alpaca and the existing-order lookup failed; refusing to resubmit (possible live duplicate)`,
      clientOrderId,
      false,
      enrichAlpacaError(
        lookupError instanceof Error ? lookupError : new Error(reason),
        cause,
      ),
    );
  }

  if (existing && !TERMINAL_DEAD_ORDER_STATUSES.has(existing.status)) {
    log(
      `client_order_id ${clientOrderId} already submitted (status=${existing.status}); returning existing order ${existing.id} as idempotent success`,
      {
        type: "warn",
        symbol,
        metadata: {
          outcome: "idempotent_return",
          clientOrderId,
          orderId: existing.id,
          status: existing.status,
        },
      },
    );
    return existing;
  }

  throw new DuplicateClientOrderIdError(
    existing
      ? `Duplicate client_order_id "${clientOrderId}" collided with a terminal (${existing.status}) order; a new logical order needs a new idempotency key`
      : `Duplicate client_order_id "${clientOrderId}" rejected by Alpaca but no order carries that id; refusing to resubmit`,
    clientOrderId,
    false,
    cause,
  );
}

/**
 * Creates a new order using the Alpaca SDK.
 * Supports market, limit, stop, and stop_limit order types.
 *
 * Every submission carries a `client_order_id`, so the retry the underlying
 * client performs on transient network failure can never fill the same order
 * twice: the re-sent POST is refused broker-side and the order that landed is
 * returned (F-0035).
 *
 * Where that id comes from, in precedence order:
 *
 * 1. an explicit `params.client_order_id` — validated (non-empty, length- and
 *    charset-safe) and used verbatim, never blanked, never silently rewritten;
 * 2. `params.idempotencyKey` — the identity of the **logical** order, from
 *    which {@link deriveClientOrderId} derives the id deterministically, so a
 *    resubmission of the same logical order collides at the broker instead of
 *    creating a second position;
 * 3. neither — a key is minted for this submission alone. **This is the
 *    deprecated path.** It closes the transport-retry double-fill and nothing
 *    more: two `createOrder` calls for the same logical order are two distinct
 *    ids and therefore two live orders. It exists because published callers
 *    that carry no order identity would otherwise fail to compile, it logs a
 *    warning with `outcome: "generated_idempotency_key"` on every submission,
 *    and it is removed once those callers pass their own identity.
 *
 * @param client - The AlpacaClient instance
 * @param params - Order parameters (symbol, qty, side, type, time_in_force);
 *   supply `idempotencyKey` (or an explicit `client_order_id`) to get
 *   caller-level idempotency rather than transport-level only
 * @returns The created order, or the already-submitted order when the broker
 *   refused the submission as a duplicate of a live/filled order
 * @throws DuplicateClientOrderIdError when the id collides with an order that
 *   cannot be treated as this submission's success
 * @throws Error when a supplied idempotency key is blank, when an explicitly
 *   supplied `client_order_id` is blank/over-length/unsafe, or if order
 *   creation fails
 *
 * @example
 * // Create a market order, keyed on the originating trade
 * const order = await createOrder(client, {
 *   symbol: 'AAPL',
 *   qty: '10',
 *   side: 'buy',
 *   type: 'market',
 *   time_in_force: 'day',
 *   idempotencyKey: trade.id,
 * });
 *
 * @example
 * // Create a limit order
 * const order = await createOrder(client, {
 *   symbol: 'AAPL',
 *   qty: '10',
 *   side: 'buy',
 *   type: 'limit',
 *   limit_price: '150.00',
 *   time_in_force: 'gtc',
 *   idempotencyKey: `${trade.id}-limit`,
 * });
 */
export async function createOrder(
  client: AlpacaClient,
  params: OptionallyIdempotentCreateOrderParams,
): Promise<AlpacaOrder> {
  const { idempotencyKey, ...orderParams } = params;
  // A key that is present must be well-formed even when an explicit
  // `client_order_id` would have won: a blank key is a caller defect, not a
  // silent fall-through to some other identity.
  const suppliedKey =
    idempotencyKey === undefined ? null : requireIdempotencyKey(idempotencyKey);
  const isGeneratedKey =
    suppliedKey === null && orderParams.client_order_id === undefined;
  // `??` would let `client_order_id: ""` through: the broker would then mint its
  // own id and the submission would be non-idempotent again despite a valid key
  // having been supplied. An explicit id is validated, never defaulted past.
  const clientOrderId =
    orderParams.client_order_id === undefined
      ? deriveClientOrderId(suppliedKey ?? generateSubmissionIdempotencyKey())
      : requireExplicitClientOrderId(orderParams.client_order_id);
  const submission: CreateOrderParams = {
    ...orderParams,
    client_order_id: clientOrderId,
  };

  const { symbol, qty, side, type } = submission;
  if (isGeneratedKey) {
    log(
      `Order submitted with no caller idempotency key; minted ${clientOrderId} for this submission only — the transport retry is de-duplicated, a caller-level resubmission is NOT`,
      {
        type: "warn",
        symbol,
        metadata: { outcome: "generated_idempotency_key", clientOrderId },
      },
    );
  }
  log(
    `Creating ${type} order: ${side} ${qty || submission.notional} ${symbol} (client_order_id=${clientOrderId})`,
    {
      type: "info",
      symbol,
    },
  );

  try {
    const sdk = client.getSDK();
    const order = (await client.executeWithRateLimit(
      () => sdk.createOrder(submission),
      `createOrder ${symbol}`,
    )) as AlpacaOrder;

    log(`Order created successfully: ${order.id}`, {
      type: "info",
      symbol,
      metadata: {
        orderId: order.id,
        clientOrderId,
        status: order.status,
        type: order.type,
        side: order.side,
      },
    });

    return order;
  } catch (error) {
    if (isDuplicateClientOrderIdRejection(error)) {
      return await resolveDuplicateSubmission(
        client,
        clientOrderId,
        symbol,
        error,
      );
    }

    const errorMessage = describeRejection(error);
    log(`Failed to create order for ${symbol}: ${errorMessage}`, {
      type: "error",
      symbol,
      metadata: { params: submission },
    });
    throw enrichAlpacaError(
      new Error(
        `Failed to create ${type} order for ${symbol}: ${errorMessage}`,
      ),
      error,
    );
  }
}

/**
 * Retrieves a specific order by its ID.
 *
 * @param client - The AlpacaClient instance
 * @param orderId - The unique identifier of the order
 * @returns The order object if found
 * @throws Error if order is not found or request fails
 *
 * @example
 * const order = await getOrder(client, 'order-uuid-here');
 * console.log(`Order status: ${order.status}`);
 */
export async function getOrder(
  client: AlpacaClient,
  orderId: string,
): Promise<AlpacaOrder> {
  log(`Fetching order: ${orderId}`, { type: "debug" });

  try {
    const sdk = client.getSDK();
    const order = await client.executeWithRateLimit(
      () => sdk.getOrder(orderId),
      `getOrder ${orderId}`,
    );

    log(`Order retrieved: ${orderId} (${order.status})`, {
      type: "debug",
      symbol: order.symbol,
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`Failed to fetch order ${orderId}: ${errorMessage}`, { type: "error" });
    throw enrichAlpacaError(
      new Error(`Failed to fetch order ${orderId}: ${errorMessage}`),
      error,
    );
  }
}

/**
 * Retrieves all orders matching the specified filters.
 *
 * @param client - The AlpacaClient instance
 * @param params - Optional filter parameters
 * @param params.status - Filter by order status: 'open', 'closed', or 'all'
 * @param params.limit - Maximum number of orders to return (default: 50, max: 500)
 * @param params.after - Filter orders created after this timestamp (RFC-3339 format)
 * @param params.until - Filter orders created before this timestamp (RFC-3339 format)
 * @param params.direction - Sort direction: 'asc' or 'desc' (default: 'desc')
 * @param params.nested - Include nested orders (for bracket orders)
 * @param params.symbols - Filter by specific symbols
 * @param params.side - Filter by order side: 'buy' or 'sell'
 * @returns Array of orders matching the filters
 *
 * @example
 * // Get all open orders
 * const openOrders = await getOrders(client, { status: 'open' });
 *
 * @example
 * // Get recent orders for specific symbols
 * const orders = await getOrders(client, {
 *   symbols: ['AAPL', 'GOOGL'],
 *   limit: 100,
 * });
 */
export async function getOrders(
  client: AlpacaClient,
  params: GetOrdersParams = {},
): Promise<AlpacaOrder[]> {
  const filterDescription = params.status || "all";
  log(`Fetching orders (status: ${filterDescription})`, { type: "debug" });

  try {
    const sdk = client.getSDK();

    // Build query parameters for the SDK
    const queryParams: SDKGetOrdersParams = {};
    if (params.status) queryParams.status = params.status;
    if (params.limit) queryParams.limit = params.limit;
    if (params.after) queryParams.after = params.after;
    if (params.until) queryParams.until = params.until;
    if (params.direction) queryParams.direction = params.direction;
    if (params.nested !== undefined) queryParams.nested = params.nested;
    if (params.symbols && params.symbols.length > 0) {
      queryParams.symbols = params.symbols.join(",");
    }
    if (params.side) queryParams.side = params.side;

    const orders = await client.executeWithRateLimit(
      () => sdk.getOrders(queryParams as unknown as AlpacaSDKOrderParams),
      "getOrders",
    );

    log(`Retrieved ${orders.length} orders`, {
      type: "debug",
      metadata: { count: orders.length, status: filterDescription },
    });

    return orders as AlpacaOrder[];
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`Failed to fetch orders: ${errorMessage}`, { type: "error" });
    throw enrichAlpacaError(
      new Error(`Failed to fetch orders: ${errorMessage}`),
      error,
    );
  }
}

/**
 * Cancels a specific order by its ID.
 * Only orders that are 'new', 'partially_filled', or 'accepted' can be canceled.
 *
 * @param client - The AlpacaClient instance
 * @param orderId - The unique identifier of the order to cancel
 * @throws Error if order cannot be canceled (e.g., already filled or canceled)
 *
 * @example
 * await cancelOrder(client, 'order-uuid-here');
 * console.log('Order canceled successfully');
 */
export async function cancelOrder(
  client: AlpacaClient,
  orderId: string,
): Promise<void> {
  log(`Canceling order: ${orderId}`, { type: "info" });

  try {
    const sdk = client.getSDK();
    await client.executeWithRateLimit(
      () => sdk.cancelOrder(orderId),
      "cancelOrder",
    );

    log(`Order canceled successfully: ${orderId}`, { type: "info" });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Check for specific error conditions
    if (
      errorMessage.includes("422") ||
      errorMessage.includes("not cancelable")
    ) {
      log(
        `Order ${orderId} is not cancelable (may already be filled or canceled)`,
        {
          type: "warn",
        },
      );
      throw enrichAlpacaError(
        new Error(`Order ${orderId} is not cancelable`),
        error,
      );
    }

    if (errorMessage.includes("404") || errorMessage.includes("not found")) {
      log(`Order ${orderId} not found`, { type: "error" });
      throw enrichAlpacaError(new Error(`Order ${orderId} not found`), error);
    }

    log(`Failed to cancel order ${orderId}: ${errorMessage}`, {
      type: "error",
    });
    throw enrichAlpacaError(
      new Error(`Failed to cancel order ${orderId}: ${errorMessage}`),
      error,
    );
  }
}

/**
 * Cancels all open orders.
 * This operation is atomic - if any cancellation fails, the function continues
 * with remaining orders and returns information about failures.
 *
 * @param client - The AlpacaClient instance
 * @returns Object containing count of canceled orders and any failures
 *
 * @example
 * const result = await cancelAllOrders(client);
 * console.log(`Canceled ${result.canceled} orders`);
 * if (result.failed.length > 0) {
 *   console.log(`Failed to cancel: ${result.failed.join(', ')}`);
 * }
 */
export async function cancelAllOrders(
  client: AlpacaClient,
): Promise<CancelAllOrdersResponse> {
  log("Canceling all open orders", { type: "info" });

  try {
    const sdk = client.getSDK();
    const result = await client.executeWithRateLimit(
      () => sdk.cancelAllOrders(),
      "cancelAllOrders",
    );

    // The SDK returns an array of canceled order statuses
    const canceled = Array.isArray(result) ? result.length : 0;
    const failed: string[] = [];

    // Check for any failures in the response
    if (Array.isArray(result)) {
      result.forEach((item: { id?: string; status?: number }) => {
        if (item.status && item.status >= 400 && item.id) {
          failed.push(item.id);
        }
      });
    }

    log(
      `Canceled ${canceled} orders${failed.length > 0 ? `, ${failed.length} failed` : ""}`,
      {
        type: "info",
        metadata: { canceled, failed: failed.length },
      },
    );

    return { canceled, failed };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`Failed to cancel all orders: ${errorMessage}`, { type: "error" });
    throw enrichAlpacaError(
      new Error(`Failed to cancel all orders: ${errorMessage}`),
      error,
    );
  }
}

/**
 * Replaces (modifies) an existing order with new parameters.
 * Only pending orders can be replaced. The order must not be filled.
 *
 * Common use cases:
 * - Update the quantity of an order
 * - Change the limit price
 * - Adjust the stop price
 * - Update trailing stop parameters
 *
 * @param client - The AlpacaClient instance
 * @param orderId - The unique identifier of the order to replace
 * @param params - New order parameters (qty, limit_price, stop_price, trail, time_in_force, client_order_id)
 * @returns The new order object that replaces the original
 * @throws Error if order cannot be replaced
 *
 * @example
 * // Update limit price
 * const newOrder = await replaceOrder(client, 'order-id', {
 *   limit_price: '155.00',
 * });
 *
 * @example
 * // Update quantity and price
 * const newOrder = await replaceOrder(client, 'order-id', {
 *   qty: '20',
 *   limit_price: '152.50',
 * });
 */
export async function replaceOrder(
  client: AlpacaClient,
  orderId: string,
  params: ReplaceOrderParams,
): Promise<AlpacaOrder> {
  const updateDescription = Object.keys(params).join(", ");
  log(`Replacing order ${orderId} (updating: ${updateDescription})`, {
    type: "info",
  });

  try {
    const sdk = client.getSDK();
    const newOrder = await client.executeWithRateLimit(
      () => sdk.replaceOrder(orderId, params),
      "replaceOrder",
    );

    log(`Order replaced successfully: ${orderId} -> ${newOrder.id}`, {
      type: "info",
      symbol: newOrder.symbol,
      metadata: {
        oldOrderId: orderId,
        newOrderId: newOrder.id,
        status: newOrder.status,
      },
    });

    return newOrder as AlpacaOrder;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Check for specific error conditions
    if (errorMessage.includes("422")) {
      log(`Order ${orderId} cannot be replaced (may already be filled)`, {
        type: "error",
      });
      throw enrichAlpacaError(
        new Error(
          `Order ${orderId} cannot be replaced: order may already be filled or canceled`,
        ),
        error,
      );
    }

    if (errorMessage.includes("404")) {
      log(`Order ${orderId} not found`, { type: "error" });
      throw enrichAlpacaError(new Error(`Order ${orderId} not found`), error);
    }

    log(`Failed to replace order ${orderId}: ${errorMessage}`, {
      type: "error",
    });
    throw enrichAlpacaError(
      new Error(`Failed to replace order ${orderId}: ${errorMessage}`),
      error,
    );
  }
}

/**
 * Convenience function to get all open orders.
 *
 * @param client - The AlpacaClient instance
 * @param symbols - Optional array of symbols to filter by
 * @returns Array of open orders
 *
 * @example
 * const openOrders = await getOpenOrders(client);
 * console.log(`Found ${openOrders.length} open orders`);
 */
export async function getOpenOrders(
  client: AlpacaClient,
  symbols?: string[],
): Promise<AlpacaOrder[]> {
  return getOrders(client, { status: "open", symbols });
}

/**
 * Convenience function to check if an order is in a terminal state.
 * Terminal states are: filled, canceled, expired, rejected
 *
 * @param status - The order status to check
 * @returns True if the order is in a terminal state
 *
 * @example
 * const order = await getOrder(client, 'order-id');
 * if (isOrderTerminal(order.status)) {
 *   console.log('Order is complete');
 * }
 */
export function isOrderTerminal(status: OrderStatus): boolean {
  const terminalStates: OrderStatus[] = [
    "filled",
    "canceled",
    "expired",
    "rejected",
  ];
  return terminalStates.includes(status);
}

/**
 * Convenience function to check if an order can be canceled.
 * Orders can be canceled if they are: new, partially_filled, accepted, pending_new
 *
 * @param status - The order status to check
 * @returns True if the order can be canceled
 *
 * @example
 * const order = await getOrder(client, 'order-id');
 * if (isOrderCancelable(order.status)) {
 *   await cancelOrder(client, order.id);
 * }
 */
export function isOrderCancelable(status: OrderStatus): boolean {
  const cancelableStates: OrderStatus[] = [
    "new",
    "partially_filled",
    "accepted",
    "pending_new",
  ];
  return cancelableStates.includes(status);
}

/**
 * Gets an order by client order ID.
 * Useful when you need to track orders using your own identifiers.
 *
 * @param client - The AlpacaClient instance
 * @param clientOrderId - Your custom order identifier
 * @returns The order if found
 * @throws Error if order is not found
 *
 * @example
 * const order = await getOrderByClientId(client, 'my-custom-order-123');
 */
export async function getOrderByClientId(
  client: AlpacaClient,
  clientOrderId: string,
): Promise<AlpacaOrder> {
  log(`Fetching order by client_order_id: ${clientOrderId}`, { type: "debug" });

  try {
    const sdk = client.getSDK();
    const order = await client.executeWithRateLimit(
      () => sdk.getOrderByClientId(clientOrderId),
      "getOrderByClientId",
    );

    log(`Order retrieved by client_order_id: ${clientOrderId} -> ${order.id}`, {
      type: "debug",
      symbol: order.symbol,
    });

    return order as AlpacaOrder;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(
      `Failed to fetch order by client_order_id ${clientOrderId}: ${errorMessage}`,
      {
        type: "error",
      },
    );
    throw enrichAlpacaError(
      new Error(
        `Failed to fetch order by client_order_id ${clientOrderId}: ${errorMessage}`,
      ),
      error,
    );
  }
}
