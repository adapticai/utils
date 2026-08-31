import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { log as baseLog } from "./logging";
import { marketDataAPI } from "./alpaca-market-data-api";
import {
  AlpacaAccountDetails,
  AlpacaCredentials,
  AlpacaPosition,
  AlpacaQuote,
  AssetClass,
  GetOptionContractsParams,
  GetOrdersParams,
  LatestQuotesResponse,
  OptionAccountActivity,
  OptionContract,
  OptionContractsResponse,
  AlpacaOrder,
  OrderLeg,
  TradeUpdate,
  CreateOrderParams,
  CreateMultiLegOrderParams,
  AlpacaWebSocketMessage,
  AlpacaAuthMessage,
  AlpacaListenMessage,
  ExerciseOptionResponse,
} from "./types/alpaca-types";
import { LogOptions } from "./types/logging-types";
import {
  getTradingApiUrl,
  getTradingWebSocketUrl,
} from "./config/api-endpoints";
import { validateAlpacaCredentials } from "./utils/auth-validator";
import {
  alpacaHttpError,
  DuplicateClientOrderIdError,
  enrichAlpacaError,
} from "./errors";
import { isTransientNetworkError } from "./utils/retry";
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from "./http-timeout";

const limitPriceSlippagePercent100 = 0.1; // 0.1%

/**
 * Alpaca's maximum page size for GET /orders — also our explicit default.
 * Alpaca's silent server-side default is 50, which truncates order
 * visibility on protective-stop / qty-reservation paths; we never let it
 * apply (mirrors ORDER_CHUNK_SIZE in src/alpaca/legacy/orders.ts).
 */
const ORDER_PAGE_LIMIT = 500;

/** Delay between order pagination pages to stay clear of rate limits. */
const ORDER_PAGINATION_DELAY_MS = 300;

/**
 * HTTP status at or above which a Multi-Status (207) sub-result is a failure.
 * Alpaca's bulk `DELETE /orders` and `DELETE /positions` endpoints return a 207
 * envelope whose top-level status is 2xx even when individual orders/positions
 * failed to cancel or close; each element carries its own per-item HTTP status.
 * Treating >= 300 as a failure lets the engine failsafe see partial failures
 * instead of recording a false success.
 */
const HTTP_STATUS_MIN_ERROR = 300;

/**
 * Prefix applied to engine-derived `client_order_id` idempotency keys so they
 * are visibly attributable in Alpaca's dashboard and can never collide with a
 * caller-supplied identifier.
 */
const CLIENT_ORDER_ID_PREFIX = "adaptic-";

/**
 * Number of leading hex characters of the SHA-256 digest retained in a derived
 * `client_order_id`. 32 hex chars = 128 bits of entropy (collision-negligible),
 * and keeps the full id (prefix + digest = 40 chars) within Alpaca's identifier
 * length limit.
 */
const CLIENT_ORDER_ID_HASH_LENGTH = 32;

/**
 * Idempotency window (ms) used when deriving a default `client_order_id`.
 *
 * A client request timeout followed by an automatic retry re-submits the SAME
 * logical order. Deriving the id from the order's semantic parameters plus the
 * current time-window bucket makes Alpaca reject the retried duplicate
 * (`client_order_id must be unique`) instead of double-filling. The window is
 * deliberately much larger than the 30s Alpaca request timeout so a full
 * timeout+retry sequence lands in the same bucket, while a genuinely new but
 * otherwise-identical order placed in a later window still receives a distinct
 * id.
 *
 * This derived default is a best-effort safety net; the guaranteed-idempotent
 * path is for the caller to pass an explicit `clientOrderId` tied to the
 * originating signal/decision id (which also permits legitimately-repeated
 * identical orders inside a single window). Callers that intentionally repeat
 * an identical order inside one window without managing explicit ids can pass
 * an `idempotencyNonce` (e.g. an attempt counter or signal id) instead — the
 * nonce is folded into the derived id, so each distinct nonce yields a
 * distinct id while a timeout+retry of the SAME attempt still collides
 * broker-side as intended.
 *
 * When a DERIVED id is 422-rejected as a duplicate, {@link
 * AlpacaTradingAPI.postOrderWithIdempotencyRecovery} recovers instead of
 * failing the caller: if the previously-submitted order is still live (or
 * filled) it is returned as idempotent success; if it is terminally dead
 * (canceled/expired/rejected) the order is resubmitted exactly once with a
 * fresh random salt. Caller-SUPPLIED ids are never recovered — they surface a
 * typed {@link DuplicateClientOrderIdError} so the caller can distinguish a
 * duplicate from a genuine rejection.
 */
const CLIENT_ORDER_ID_WINDOW_MS = 300_000;

/**
 * Matches Alpaca's 422 duplicate-idempotency-key rejection message. Alpaca has
 * used both "client_order_id must be unique" and "client order id must be
 * unique" across API revisions, so separators are matched loosely.
 */
const DUPLICATE_CLIENT_ORDER_ID_PATTERN =
  /client[\s_-]?order[\s_-]?id must be unique/i;

/** HTTP status Alpaca uses for duplicate `client_order_id` rejections. */
const DUPLICATE_CLIENT_ORDER_ID_STATUS = 422;

/**
 * Order statuses in which a previously-submitted order can never execute.
 * A derived-id duplicate colliding with an order in one of these states is a
 * legitimate NEW order (e.g. cancel-then-recreate of an identical trailing
 * stop) and is resubmitted with a fresh salt; any other status means the
 * original order is live or executed, so it is returned as idempotent success.
 */
const TERMINAL_DEAD_ORDER_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "expired",
  "rejected",
  "replaced",
  "done_for_day",
]);

/** 
Websocket example
  const alpacaAPI = createAlpacaTradingAPI(credentials); // type AlpacaCredentials
  alpacaAPI.onTradeUpdate((update: TradeUpdate) => {
   this.log(`Received trade update: event ${update.event} for an order to ${update.order.side} ${update.order.qty} of ${update.order.symbol}`);
  });
  alpacaAPI.connectWebsocket(); // necessary to connect to the WebSocket
*/

export class AlpacaTradingAPI {
  static new(credentials: AlpacaCredentials): AlpacaTradingAPI {
    return new AlpacaTradingAPI(credentials) as AlpacaTradingAPI;
  }

  static getInstance(credentials: AlpacaCredentials): AlpacaTradingAPI {
    return new AlpacaTradingAPI(credentials) as AlpacaTradingAPI;
  }

  private ws: WebSocket | null = null;
  private headers: Record<string, string>;
  private tradeUpdateCallback: ((update: TradeUpdate) => void) | null = null;
  private credentials: AlpacaCredentials;
  private apiBaseUrl: string;
  private wsUrl: string;
  private authenticated = false;
  private connecting = false;
  private reconnectDelay = 10000; // 10 seconds between reconnection attempts
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private messageHandlers: Map<
    string,
    (data: AlpacaWebSocketMessage["data"]) => void
  > = new Map();
  private debugLogging = false;

  /**
   * Constructor for AlpacaTradingAPI
   * @param credentials - Alpaca credentials,
   *   accountName: string; // The account identifier used inthis.logs and tracking
   *   apiKey: string; // Alpaca API key
   *   apiSecret: string; // Alpaca API secret
   *   type: AlpacaAccountType;
   *   orderType: AlpacaOrderType;
   * @param options - Optional options
   *   debugLogging: boolean; // Whether to log messages of type 'debug'
   */
  constructor(
    credentials: AlpacaCredentials,
    options?: { debugLogging?: boolean },
  ) {
    // Validate credentials before doing anything else
    validateAlpacaCredentials({
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      isPaper: credentials.type === "PAPER",
    });

    this.credentials = credentials;

    // Set URLs based on account type
    this.apiBaseUrl = getTradingApiUrl(credentials.type);

    this.wsUrl = getTradingWebSocketUrl(credentials.type);

    this.headers = {
      "APCA-API-KEY-ID": credentials.apiKey,
      "APCA-API-SECRET-KEY": credentials.apiSecret,
      "Content-Type": "application/json",
    };

    // Initialize message handlers
    this.messageHandlers.set(
      "authorization",
      this.handleAuthMessage.bind(this) as (
        data: AlpacaWebSocketMessage["data"],
      ) => void,
    );
    this.messageHandlers.set(
      "listening",
      this.handleListenMessage.bind(this) as (
        data: AlpacaWebSocketMessage["data"],
      ) => void,
    );
    this.messageHandlers.set(
      "trade_updates",
      this.handleTradeUpdate.bind(this) as (
        data: AlpacaWebSocketMessage["data"],
      ) => void,
    );

    this.debugLogging = options?.debugLogging || false;
  }

  private log(message: string, options: LogOptions = { type: "info" }): void {
    if (this.debugLogging && options.type === "debug") {
      return;
    }
    baseLog(message, {
      ...options,
      source: "AlpacaTradingAPI",
      account: this.credentials.accountName,
    });
  }

  /**
   * Round a price to the nearest 2 decimal places for Alpaca, or 4 decimal places for prices less than $1
   * @param price - The price to round
   * @returns The rounded price
   */
  private roundPriceForAlpaca = (price: number): number => {
    return price >= 1
      ? Math.round(price * 100) / 100
      : Math.round(price * 10000) / 10000;
  };

  /**
   * Derive a deterministic `client_order_id` from an order's semantic
   * parameters so that a client-timeout-triggered retry re-submits the SAME id
   * and Alpaca rejects the duplicate broker-side instead of double-filling.
   *
   * The id is stable for identical parameters within a single
   * {@link CLIENT_ORDER_ID_WINDOW_MS} bucket and scoped per account. Callers
   * that must place genuinely distinct yet otherwise-identical orders should
   * pass an explicit `clientOrderId` rather than relying on this default.
   *
   * @param parts - Ordered, stringifiable components uniquely describing the
   *   order (e.g. order kind, symbol, side, quantity, price, intent).
   * @returns An Alpaca-safe `client_order_id` (prefix + truncated SHA-256 hex).
   */
  private deriveClientOrderId(
    parts: ReadonlyArray<string | number | boolean | undefined>,
  ): string {
    const windowBucket = Math.floor(Date.now() / CLIENT_ORDER_ID_WINDOW_MS);
    const material = [
      this.credentials.accountName,
      windowBucket,
      ...parts.map((part) => (part === undefined ? "" : String(part))),
    ].join("|");
    const digest = createHash("sha256")
      .update(material)
      .digest("hex")
      .slice(0, CLIENT_ORDER_ID_HASH_LENGTH);
    return `${CLIENT_ORDER_ID_PREFIX}${digest}`;
  }

  /**
   * Running count of derived-id duplicate collisions resolved by returning the
   * already-submitted order. Emitted in log metadata so operators can see the
   * idempotency net firing.
   */
  private idempotentDuplicateReturns = 0;

  /**
   * Running count of derived-id duplicate collisions resolved by resubmitting
   * once with a fresh random salt (the colliding order was terminally dead).
   */
  private saltedDuplicateResubmits = 0;

  /**
   * Whether an error thrown by {@link makeRequest} is Alpaca's 422
   * duplicate-`client_order_id` rejection.
   * @param error - The error thrown by the order POST.
   * @returns true when the error is a duplicate-idempotency-key rejection.
   */
  private isDuplicateClientOrderIdRejection(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
      error.message.includes(`(${DUPLICATE_CLIENT_ORDER_ID_STATUS})`) &&
      DUPLICATE_CLIENT_ORDER_ID_PATTERN.test(error.message)
    );
  }

  /**
   * Look up an order by its `client_order_id` (Alpaca
   * `GET /orders:by_client_order_id`).
   * @param clientOrderId - The idempotency key the order was submitted with.
   * @returns The order, or null when no order exists for the id (404).
   */
  async getOrderByClientOrderId(
    clientOrderId: string,
  ): Promise<AlpacaOrder | null> {
    try {
      return await this.makeRequest<AlpacaOrder>(
        "/orders:by_client_order_id",
        "GET",
        undefined,
        `?client_order_id=${encodeURIComponent(clientOrderId)}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("(404)")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * POST an order body with duplicate-`client_order_id` recovery.
   *
   * Sets `client_order_id` (explicit id wins; otherwise derived from
   * `deriveParts`), submits, and on Alpaca's 422 duplicate rejection:
   *
   * - **Caller-supplied id**: throws a typed
   *   {@link DuplicateClientOrderIdError} — the caller owns idempotency
   *   semantics and must decide whether the duplicate is success or a bug.
   * - **Derived id, colliding order live/filled**: returns the existing order
   *   as idempotent success (this is the timeout+retry case the derived id
   *   exists to de-duplicate).
   * - **Derived id, colliding order terminally dead** (canceled / expired /
   *   rejected — e.g. cancel-then-recreate of an identical trailing stop):
   *   resubmits exactly once with a fresh random salt so the legitimate new
   *   order is not blocked. A second duplicate rejection throws the typed
   *   error.
   * - **Derived id, status lookup fails**: fails CLOSED with the typed error —
   *   the colliding order may be live, so resubmitting could double-fill; the
   *   caller's next cycle retries when the lookup can succeed.
   *
   * Both recovery outcomes increment log-visible counters.
   *
   * @param body - The order payload (its `client_order_id` is set here).
   * @param options - Idempotency inputs: optional explicit id and the derive
   *   parts used both for the default id and for the salted resubmit.
   * @returns The created (or pre-existing, on idempotent recovery) order.
   */
  private async postOrderWithIdempotencyRecovery(
    body: CreateOrderParams | CreateMultiLegOrderParams,
    options: {
      explicitClientOrderId?: string;
      deriveParts: ReadonlyArray<string | number | boolean | undefined>;
      logSymbol?: string;
    },
  ): Promise<AlpacaOrder> {
    const derived = options.explicitClientOrderId === undefined;
    const clientOrderId =
      options.explicitClientOrderId ??
      this.deriveClientOrderId(options.deriveParts);
    body.client_order_id = clientOrderId;

    const requestBody = body as unknown as Record<string, unknown>;
    try {
      return await this.makeRequest<AlpacaOrder>("/orders", "POST", requestBody);
    } catch (error) {
      if (!this.isDuplicateClientOrderIdRejection(error)) {
        throw error;
      }
      if (!derived) {
        throw new DuplicateClientOrderIdError(
          `Duplicate client_order_id "${clientOrderId}" rejected by Alpaca (caller-supplied id)`,
          clientOrderId,
          false,
          error,
        );
      }

      let existing: AlpacaOrder | null = null;
      try {
        existing = await this.getOrderByClientOrderId(clientOrderId);
      } catch (lookupError) {
        // Fail CLOSED: the 422 proves an order with this id exists, but its
        // status is unverifiable. Resubmitting here could double-fill a live
        // order (the timeout+retry case), which is strictly worse than the
        // caller retrying on its next cycle — by then the lookup will resolve.
        this.log(
          `Duplicate-order lookup failed for ${clientOrderId}; failing closed (no resubmit) to avoid a possible double order: ${
            lookupError instanceof Error
              ? lookupError.message
              : String(lookupError)
          }`,
          { symbol: options.logSymbol, type: "error" },
        );
        throw new DuplicateClientOrderIdError(
          `Duplicate client_order_id "${clientOrderId}" rejected by Alpaca and the existing-order lookup failed; refusing to resubmit (possible live duplicate)`,
          clientOrderId,
          true,
          lookupError,
        );
      }

      if (existing && !TERMINAL_DEAD_ORDER_STATUSES.has(existing.status)) {
        this.idempotentDuplicateReturns++;
        this.log(
          `Derived client_order_id ${clientOrderId} already submitted (status=${existing.status}); returning existing order ${existing.id} as idempotent success`,
          {
            symbol: options.logSymbol,
            type: "warn",
            metadata: {
              outcome: "idempotent_return",
              idempotentDuplicateReturns: this.idempotentDuplicateReturns,
            },
          },
        );
        return existing;
      }

      const saltedId = this.deriveClientOrderId([
        ...options.deriveParts,
        "resubmit",
        randomUUID(),
      ]);
      this.saltedDuplicateResubmits++;
      this.log(
        `Derived client_order_id ${clientOrderId} collided with a ${
          existing ? `terminal (${existing.status})` : "missing"
        } order; resubmitting once with fresh salt ${saltedId}`,
        {
          symbol: options.logSymbol,
          type: "warn",
          metadata: {
            outcome: "salted_resubmit",
            saltedDuplicateResubmits: this.saltedDuplicateResubmits,
          },
        },
      );
      body.client_order_id = saltedId;
      try {
        return await this.makeRequest<AlpacaOrder>(
          "/orders",
          "POST",
          requestBody,
        );
      } catch (resubmitError) {
        if (this.isDuplicateClientOrderIdRejection(resubmitError)) {
          throw new DuplicateClientOrderIdError(
            `Salted resubmit of duplicate client_order_id "${clientOrderId}" was itself rejected as a duplicate ("${saltedId}")`,
            saltedId,
            true,
            resubmitError,
          );
        }
        throw resubmitError;
      }
    }
  }

  /**
   * Collect the human-readable failure entries from a bulk Multi-Status (207)
   * response body (`DELETE /orders`, `DELETE /positions`). Each element carries
   * its own per-item HTTP status; any element with status >=
   * {@link HTTP_STATUS_MIN_ERROR} is a failure the caller must be able to see.
   *
   * @param entries - Parsed 207 response array.
   * @returns One `"<identifier>:<status>"` string per failed entry.
   */
  private collectMultiStatusFailures(
    entries: ReadonlyArray<{ id?: string; symbol?: string; status?: number }>,
  ): string[] {
    return entries
      .filter(
        (entry) =>
          typeof entry.status === "number" &&
          entry.status >= HTTP_STATUS_MIN_ERROR,
      )
      .map((entry) => `${entry.symbol ?? entry.id ?? "unknown"}:${entry.status}`);
  }

  /**
   * Flatten a single position with a marketable limit order, deriving the
   * closing side, intent, and slippage-adjusted limit price from the latest
   * quote. Throws when no usable quote/price is available for the symbol so the
   * caller can record a per-position failure via {@link Promise.allSettled}
   * without aborting the flatten of the remaining positions.
   *
   * @param position - The position to close.
   * @param quotesResponse - Latest quotes keyed by symbol.
   * @param extendedHours - Whether the closing order is an extended-hours order.
   */
  private async closePositionWithLimitOrder(
    position: AlpacaPosition,
    quotesResponse: LatestQuotesResponse,
    extendedHours: boolean,
  ): Promise<void> {
    const quote: AlpacaQuote | undefined =
      quotesResponse.quotes[position.symbol];
    if (!quote) {
      throw new Error(`No quote available for ${position.symbol}`);
    }

    const qty = Math.abs(parseFloat(position.qty));
    const side = position.side === "long" ? "sell" : "buy";
    const positionIntent = side === "sell" ? "sell_to_close" : "buy_to_close";

    // Use bid for sells, ask for buys.
    const currentPrice = side === "sell" ? quote.bp : quote.ap;
    if (!currentPrice) {
      throw new Error(`No valid price available for ${position.symbol}`);
    }

    const limitSlippagePercent1 = limitPriceSlippagePercent100 / 100;
    const limitPrice =
      side === "sell"
        ? this.roundPriceForAlpaca(currentPrice * (1 - limitSlippagePercent1)) // Sell slightly lower
        : this.roundPriceForAlpaca(currentPrice * (1 + limitSlippagePercent1)); // Buy slightly higher

    this.log(
      `Creating ${extendedHours ? "extended hours " : ""}limit order to close ${
        position.symbol
      } position: ${side} ${qty} shares at $${limitPrice.toFixed(2)}`,
      {
        symbol: position.symbol,
      },
    );

    await this.createLimitOrder(
      position.symbol,
      qty,
      side,
      limitPrice,
      positionIntent,
      extendedHours,
    );
  }

  /**
   * Flatten every supplied position independently and surface an aggregate
   * failure if any could not be closed. Positions are attempted concurrently
   * with {@link Promise.allSettled} so a data gap or broker rejection on one
   * symbol never silently prevents the others from being flattened.
   *
   * @param positions - Positions to flatten.
   * @param extendedHours - Whether the closing orders are extended-hours orders.
   * @throws Error listing every symbol that failed to flatten.
   */
  private async flattenPositionsWithLimitOrders(
    positions: AlpacaPosition[],
    extendedHours: boolean,
  ): Promise<void> {
    const symbols = positions.map((position) => position.symbol);
    const quotesResponse = await marketDataAPI.getLatestQuotes(symbols);

    const results = await Promise.allSettled(
      positions.map((position) =>
        this.closePositionWithLimitOrder(
          position,
          quotesResponse,
          extendedHours,
        ),
      ),
    );

    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const symbol = positions[index]?.symbol ?? "unknown";
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        failures.push(`${symbol}: ${reason}`);
        this.log(`Failed to close position ${symbol}: ${reason}`, {
          symbol,
          type: "error",
        });
      }
    });

    if (failures.length > 0) {
      throw new Error(
        `Failed to close ${failures.length} of ${positions.length} positions: ${failures.join(
          "; ",
        )}`,
      );
    }

    this.log(`All positions closed: ${symbols.join(", ")}`);
  }

  private handleAuthMessage(data: AlpacaAuthMessage["data"]): void {
    if (data.status === "authorized") {
      this.authenticated = true;
      this.log("WebSocket authenticated");
    } else {
      this.log(`Authentication failed: ${data.message || "Unknown error"}`, {
        type: "error",
      });
    }
  }

  private handleListenMessage(data: AlpacaListenMessage["data"]): void {
    if (data.streams?.includes("trade_updates")) {
      this.log("Successfully subscribed to trade updates");
    }
  }

  private handleTradeUpdate(data: TradeUpdate): void {
    if (this.tradeUpdateCallback) {
      this.log(
        `Trade update: ${data.event} to ${data.order.side} ${data.order.qty} shares, type ${data.order.type}`,
        {
          symbol: data.order.symbol,
          type: "debug",
        },
      );
      this.tradeUpdateCallback(data);
    }
  }

  private handleMessage(message: string): void {
    try {
      const data = JSON.parse(message) as AlpacaWebSocketMessage;
      const handler = this.messageHandlers.get(data.stream);

      if (handler) {
        handler(data.data);
      } else {
        this.log(`Received message for unknown stream: ${data.stream}`, {
          type: "warn",
        });
      }
    } catch (error) {
      this.log("Failed to parse WebSocket message", {
        type: "error",
        metadata: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  }

  connectWebsocket(): void {
    if (this.connecting) {
      this.log("Connection attempt skipped - already connecting");
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.log("Connection attempt skipped - already connected");
      return;
    }

    this.connecting = true;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }

    this.log(`Connecting to WebSocket at ${this.wsUrl}...`);

    this.ws = new WebSocket(this.wsUrl);

    this.ws.on("open", async () => {
      try {
        this.log("WebSocket connected");
        await this.authenticate();
        await this.subscribeToTradeUpdates();
        this.connecting = false;
      } catch (error) {
        this.log("Failed to setup WebSocket connection", {
          type: "error",
          metadata: {
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
        this.ws?.close();
      }
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on("error", (error) => {
      this.log("WebSocket error", {
        type: "error",
        metadata: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
      this.connecting = false;
    });

    this.ws.on("close", () => {
      this.log("WebSocket connection closed");
      this.authenticated = false;
      this.connecting = false;

      // Clear any existing reconnect timeout
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      // Schedule reconnection
      this.reconnectTimeout = setTimeout(() => {
        this.log("Attempting to reconnect...");
        this.connectWebsocket();
      }, this.reconnectDelay);
    });
  }

  private async authenticate(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not ready for authentication");
    }

    const authMessage = {
      action: "auth",
      key: this.credentials.apiKey,
      secret: this.credentials.apiSecret,
    };

    this.ws.send(JSON.stringify(authMessage));

    return new Promise((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        this.log("Authentication timeout", { type: "error" });
        reject(new Error("Authentication timed out"));
      }, 10000);

      const handleAuthResponse = (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as {
            stream?: string;
            data?: { status?: string; message?: string };
          };
          if (message.stream === "authorization") {
            this.ws?.removeListener("message", handleAuthResponse);
            clearTimeout(authTimeout);

            if (message.data?.status === "authorized") {
              this.authenticated = true;
              this.log("WebSocket authenticated");
              resolve();
            } else {
              const error = `Authentication failed: ${message.data?.message || "Unknown error"}`;
              this.log(error, { type: "error" });
              reject(new Error(error));
            }
          }
        } catch (error) {
          this.log("Failed to parse auth response", {
            type: "error",
            metadata: {
              error: error instanceof Error ? error.message : "Unknown error",
            },
          });
        }
      };

      this.ws?.on("message", handleAuthResponse);
    });
  }

  private async subscribeToTradeUpdates(): Promise<void> {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      !this.authenticated
    ) {
      throw new Error("WebSocket not ready for subscription");
    }

    const listenMessage = {
      action: "listen",
      data: {
        streams: ["trade_updates"],
      },
    };

    this.ws.send(JSON.stringify(listenMessage));

    return new Promise((resolve, reject) => {
      const listenTimeout = setTimeout(() => {
        reject(new Error("Subscribe timeout"));
      }, 10000);

      const handleListenResponse = (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as {
            stream?: string;
            data?: { streams?: string[] };
          };
          if (message.stream === "listening") {
            this.ws?.removeListener("message", handleListenResponse);
            clearTimeout(listenTimeout);

            if (message.data?.streams?.includes("trade_updates")) {
              this.log("Subscribed to trade updates");
              resolve();
            } else {
              reject(new Error("Failed to subscribe to trade updates"));
            }
          }
        } catch (error) {
          this.log("Failed to parse listen response", {
            type: "error",
            metadata: {
              error: error instanceof Error ? error.message : "Unknown error",
            },
          });
        }
      };

      this.ws?.on("message", handleListenResponse);
    });
  }

  private async makeRequest<T = unknown>(
    endpoint: string,
    method: string = "GET",
    body?: Record<string, unknown> | CreateOrderParams,
    queryString: string = "",
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${endpoint}${queryString}`;
    try {
      const response = await fetch(url, {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.log(`Alpaca API error (${response.status}): ${errorText}`, {
          type: "error",
        });
        // Additive broker-error preservation: the message is byte-identical
        // (existing "422"/"42210000" string-matching consumers are unaffected),
        // and the verbatim status + body ride along as a typed `.response` so
        // getAlpacaBrokerErrorCode resolves the numeric code on this fetch seam —
        // the dominant percent-trailing-stop tighten path and the 08-20 defect
        // site, where a plain Error dropped the broker's response.data.
        throw alpacaHttpError(
          `Alpaca API error (${response.status}): ${errorText}`,
          response.status,
          errorText,
        );
      }

      // Handle responses with no content (e.g., 204 No Content)
      if (
        response.status === 204 ||
        response.headers.get("content-length") === "0"
      ) {
        return null as T;
      }

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        return (await response.json()) as T;
      }

      // For non-JSON responses, return the text content
      const textContent = await response.text();
      return (textContent || null) as T;
    } catch (err) {
      const error = err as Error;
      const isTransient = isTransientNetworkError(err);
      // Transient fetch failures (timeouts, connection resets, undici
      // aborts) are recoverable at the caller's next cycle; log at WARN
      // and annotate for observability filters. Non-transient errors
      // (4xx/auth/schema) stay at ERROR for operator attention.
      this.log(`Error in makeRequest: ${error.message}. Url: ${url}`, {
        source: "AlpacaAPI",
        type: isTransient ? "warn" : "error",
        metadata: isTransient
          ? {
              transient: true,
              recoveryHint: "Upstream caller should retry on next cycle",
            }
          : undefined,
      });
      throw error;
    }
  }

  async getPositions(assetClass?: AssetClass): Promise<AlpacaPosition[]> {
    const positions = (await this.makeRequest(
      "/positions",
    )) as AlpacaPosition[];
    if (assetClass) {
      return positions.filter(
        (position) => position.asset_class === assetClass,
      );
    }
    return positions;
  }

  /**
   * Get all orders, with explicit paging.
   *
   * When `params.limit` is provided it is treated as a caller-controlled cap
   * and a single request is made (preserves the previous contract for
   * callers that run their own page walks, e.g. phantom-order lookup).
   *
   * When `limit` is omitted, Alpaca's silent server-side default of 50
   * records is NOT allowed to apply — that default truncated open-order
   * visibility on protective-stop and qty-reservation paths. Instead the
   * API maximum (500) is requested explicitly and, whenever a full page
   * comes back, the result is paginated with a `submitted_at` cursor walk
   * (`until` for desc — the default — or `after` for asc) until a short
   * page indicates the window is exhausted. Pages are deduplicated by
   * order id so same-timestamp boundary orders can never be double
   * counted, and the walk terminates if a full page yields no new orders.
   *
   * @param params (GetOrdersParams) - optional parameters to filter the orders
   * - status: 'open' | 'closed' | 'all'
   * - limit: number — caller-controlled cap; disables pagination
   * - after: string
   * - until: string
   * - direction: 'asc' | 'desc'
   * - nested: boolean
   * - symbols: string[], an array of all the symbols
   * - side: 'buy' | 'sell'
   * @returns all orders
   */
  async getOrders(params: GetOrdersParams = {}): Promise<AlpacaOrder[]> {
    if (params.limit !== undefined) {
      return this.fetchOrdersPage(params, params.limit);
    }

    const isAsc = params.direction === "asc";
    const allOrders: AlpacaOrder[] = [];
    const seenOrderIds = new Set<string>();
    // Moving cursor: `until` walks backwards for desc (the default),
    // `after` walks forwards for asc. Both are exclusive on Alpaca's side.
    let cursor = isAsc ? params.after : params.until;

    while (true) {
      const pageParams: GetOrdersParams = {
        ...params,
        ...(isAsc ? { after: cursor } : { until: cursor }),
      };
      const page = await this.fetchOrdersPage(pageParams, ORDER_PAGE_LIMIT);

      let addedCount = 0;
      for (const order of page) {
        if (!seenOrderIds.has(order.id)) {
          seenOrderIds.add(order.id);
          allOrders.push(order);
          addedCount++;
        }
      }

      // Short page = window exhausted (same termination as legacy getOrders).
      if (page.length < ORDER_PAGE_LIMIT) break;

      const lastOrder = page[page.length - 1];
      // No usable cursor, or a full page of already-seen orders (cursor not
      // advancing): stop rather than risk an unbounded walk.
      if (!lastOrder.submitted_at || addedCount === 0) break;
      cursor = lastOrder.submitted_at;

      await new Promise((resolve) =>
        setTimeout(resolve, ORDER_PAGINATION_DELAY_MS),
      );
    }

    return allOrders;
  }

  /**
   * Issues a single GET /orders request with an explicit `limit` so
   * Alpaca's silent 50-record server default can never apply.
   * @param params - order filter parameters (limit is supplied separately)
   * @param limit - explicit page size to request
   * @returns one page of orders
   */
  private async fetchOrdersPage(
    params: GetOrdersParams,
    limit: number,
  ): Promise<AlpacaOrder[]> {
    const queryParams = new URLSearchParams();

    if (params.status) queryParams.append("status", params.status);
    queryParams.append("limit", limit.toString());
    if (params.after) queryParams.append("after", params.after);
    if (params.until) queryParams.append("until", params.until);
    if (params.direction) queryParams.append("direction", params.direction);
    if (params.nested) queryParams.append("nested", params.nested.toString());
    if (params.symbols) queryParams.append("symbols", params.symbols.join(","));
    if (params.side) queryParams.append("side", params.side);

    const endpoint = `/orders?${queryParams.toString()}`;
    try {
      const orders = await this.makeRequest<AlpacaOrder[]>(endpoint);
      return orders ?? [];
    } catch (error) {
      this.log(`Error getting orders: ${error}`, { type: "error" });
      throw error;
    }
  }

  async getAccountDetails(): Promise<AlpacaAccountDetails> {
    try {
      return await this.makeRequest("/account");
    } catch (error) {
      this.log(`Error getting account details: ${error}`, { type: "error" });
      throw error;
    }
  }

  /**
   * Create a trailing stop order
   * @param symbol (string) - the symbol of the order
   * @param qty (number) - the quantity of the order
   * @param side (string) - the side of the order
   * @param trailPercent100 (number) - the trail percent of the order (scale 100, i.e. 0.5 = 0.5%)
   * @param position_intent (string) - the position intent of the order
   * @param clientOrderId - Optional explicit idempotency key; when supplied it
   *   is used verbatim and duplicate rejections surface as
   *   {@link DuplicateClientOrderIdError}.
   * @param idempotencyNonce - Optional attempt/signal discriminator folded into
   *   the derived idempotency key so an intentionally-repeated identical order
   *   inside one derivation window receives a distinct id.
   * @returns The created AlpacaOrder with order ID and details
   */
  async createTrailingStop(
    symbol: string,
    qty: number,
    side: "buy" | "sell",
    trailPercent100: number,
    position_intent:
      | "buy_to_open"
      | "buy_to_close"
      | "sell_to_open"
      | "sell_to_close",
    clientOrderId?: string,
    idempotencyNonce?: string | number,
  ): Promise<AlpacaOrder> {
    this.log(
      `Creating trailing stop ${side.toUpperCase()} ${qty} shares for ${symbol} with trail percent ${trailPercent100}%`,
      {
        symbol,
      },
    );

    const body: CreateOrderParams = {
      symbol,
      qty: Math.abs(qty).toString(),
      side,
      position_intent,
      order_class: "simple",
      type: "trailing_stop",
      trail_percent: trailPercent100.toString(), // Already in decimal form (e.g., 4 for 4%)
      time_in_force: "gtc",
    };

    try {
      const order = await this.postOrderWithIdempotencyRecovery(body, {
        explicitClientOrderId: clientOrderId,
        deriveParts: [
          "trailing_stop",
          symbol,
          side,
          position_intent,
          Math.abs(qty),
          trailPercent100,
          ...(idempotencyNonce !== undefined ? [String(idempotencyNonce)] : []),
        ],
        logSymbol: symbol,
      });
      this.log(
        `Trailing stop order created for ${symbol}: orderId=${order.id}, trailPercent=${trailPercent100}%`,
        { symbol },
      );
      return order;
    } catch (error) {
      this.log(`Error creating trailing stop: ${error}`, {
        symbol,
        type: "error",
      });
      throw error;
    }
  }

  /**
   * Create a market order
   * @param symbol (string) - the symbol of the order
   * @param qty (number) - the quantity of the order
   * @param side (string) - the side of the order
   * @param position_intent (string) - the position intent of the order. Important for knowing if a position needs a trailing stop.
   * @param client_order_id - Optional explicit idempotency key; duplicate
   *   rejections of an explicit id surface as
   *   {@link DuplicateClientOrderIdError}.
   * @param idempotencyNonce - Optional attempt/signal discriminator folded into
   *   the derived idempotency key so an intentionally-repeated identical order
   *   inside one derivation window receives a distinct id.
   */
  async createMarketOrder(
    symbol: string,
    qty: number,
    side: "buy" | "sell",
    position_intent:
      | "buy_to_open"
      | "buy_to_close"
      | "sell_to_open"
      | "sell_to_close",
    client_order_id?: string,
    idempotencyNonce?: string | number,
  ): Promise<AlpacaOrder> {
    this.log(
      `Creating market order for ${symbol}: ${side} ${qty} shares (${position_intent})`,
      {
        symbol,
      },
    );

    const body: CreateOrderParams = {
      symbol,
      qty: Math.abs(qty).toString(),
      side,
      position_intent,
      type: "market",
      time_in_force: "day",
      order_class: "simple",
    };
    try {
      return await this.postOrderWithIdempotencyRecovery(body, {
        explicitClientOrderId: client_order_id,
        deriveParts: [
          "market",
          symbol,
          side,
          position_intent,
          Math.abs(qty),
          ...(idempotencyNonce !== undefined ? [String(idempotencyNonce)] : []),
        ],
        logSymbol: symbol,
      });
    } catch (error) {
      this.log(`Error creating market order: ${error}`, { type: "error" });
      throw error;
    }
  }

  /**
   * Get the current trail percent for a symbol, assuming that it has an open position and a trailing stop order to close it. Because this relies on an orders request for one symbol, you can't do it too often.
   * @param symbol (string) - the symbol of the order
   * @returns the current trail percent
   */
  async getCurrentTrailPercent(symbol: string): Promise<number | null> {
    try {
      const orders = await this.getOrders({
        status: "open",
        symbols: [symbol],
      });

      const trailingStopOrder = orders.find(
        (order) =>
          order.type === "trailing_stop" &&
          (order.position_intent === "sell_to_close" ||
            order.position_intent === "buy_to_close"),
      );

      if (!trailingStopOrder) {
        this.log(`No closing trailing stop order found for ${symbol}`, {
          symbol,
        });
        return null;
      }

      if (!trailingStopOrder.trail_percent) {
        this.log(
          `Trailing stop order found for ${symbol} but no trail_percent value`,
          {
            symbol,
          },
        );
        return null;
      }

      const trailPercent = parseFloat(trailingStopOrder.trail_percent);
      return trailPercent;
    } catch (error) {
      this.log(`Error getting current trail percent: ${error}`, {
        symbol,
        type: "error",
      });
      throw error;
    }
  }

  /**
   * Update the trail percent for a trailing stop order
   * @param symbol (string) - the symbol of the order
   * @param trailPercent100 (number) - the trail percent of the order (scale 100, i.e. 0.5 = 0.5%)
   * @returns The updated/replaced order from Alpaca, or null if no order found or no update needed
   */
  async updateTrailingStop(
    symbol: string,
    trailPercent100: number,
  ): Promise<AlpacaOrder | null> {
    // First get all open orders for this symbol
    const orders = await this.getOrders({
      status: "open",
      symbols: [symbol],
    });

    // Find the trailing stop order
    const trailingStopOrder = orders.find(
      (order) => order.type === "trailing_stop",
    );

    if (!trailingStopOrder) {
      this.log(`No open trailing stop order found for ${symbol}`, {
        type: "error",
        symbol,
      });
      return null;
    }

    // Check if the trail_percent is already set to the desired value
    const currentTrailPercent = trailingStopOrder.trail_percent
      ? parseFloat(trailingStopOrder.trail_percent)
      : null;

    // Compare with a small epsilon to handle floating point precision
    const epsilon = 0.0001;
    if (
      currentTrailPercent !== null &&
      Math.abs(currentTrailPercent - trailPercent100) < epsilon
    ) {
      this.log(
        `Trailing stop for ${symbol} already set to ${trailPercent100}% (current: ${currentTrailPercent}%), skipping update`,
        {
          symbol,
        },
      );
      return null;
    }

    const originalOrderId = trailingStopOrder.id;
    this.log(
      `Updating trailing stop for ${symbol} from ${currentTrailPercent}% to ${trailPercent100}% (orderId=${originalOrderId})`,
      {
        symbol,
      },
    );

    try {
      const updatedOrder = await this.makeRequest<AlpacaOrder>(
        `/orders/${trailingStopOrder.id}`,
        "PATCH",
        {
          trail: trailPercent100.toString(),
        },
      );
      // Log the replacement: Alpaca replaces orders on PATCH, so new ID is returned
      this.log(
        `Trailing stop updated for ${symbol}: newOrderId=${updatedOrder.id}, replaces=${updatedOrder.replaces || originalOrderId}`,
        { symbol },
      );
      return updatedOrder;
    } catch (error) {
      this.log(`Error updating trailing stop: ${error}`, {
        symbol,
        type: "error",
      });
      throw error;
    }
  }

  /**
   * Cancel all open orders.
   *
   * Alpaca's bulk cancel returns a 207 Multi-Status body whose top-level status
   * is 2xx even when individual orders failed to cancel; this method inspects
   * the per-order statuses and throws if any order could not be canceled, so a
   * caller acting as a live-stop failsafe cannot record success while orders
   * remain live. Transport/HTTP errors propagate unchanged (matching the
   * throw-on-failure contract of {@link cancelOrder}).
   *
   * @throws Error if the bulk cancel request fails or any individual order
   *   could not be canceled.
   */
  async cancelAllOrders(): Promise<void> {
    this.log(`Canceling all open orders`);
    const results = await this.makeRequest<
      Array<{ id?: string; status?: number }> | null
    >("/orders", "DELETE");

    if (!Array.isArray(results)) {
      return;
    }

    const failures = this.collectMultiStatusFailures(results);
    if (failures.length > 0) {
      const detail = failures.join(", ");
      this.log(
        `Error canceling all orders: ${failures.length}/${results.length} orders failed to cancel (${detail})`,
        { type: "error" },
      );
      throw new Error(
        `Failed to cancel ${failures.length} of ${results.length} orders: ${detail}`,
      );
    }

    this.log(`Successfully canceled ${results.length} open orders`);
  }

  /**
   * Cancel a specific order by its ID
   * @param orderId The id of the order to cancel
   * @throws Error if the order is not cancelable (status 422) or if the order doesn't exist
   * @returns Promise that resolves when the order is successfully canceled
   */
  async cancelOrder(orderId: string): Promise<void> {
    this.log(`Attempting to cancel order ${orderId}`);

    try {
      await this.makeRequest(`/orders/${orderId}`, "DELETE");
      this.log(`Successfully canceled order ${orderId}`);
    } catch (error) {
      // If the error is a 422, it means the order is not cancelable
      if (error instanceof Error && error.message.includes("422")) {
        this.log(`Order ${orderId} is not cancelable`, {
          type: "error",
        });
        // Re-message stays byte-identical; the broker payload from makeRequest's
        // `.response` is carried onto the new error so the numeric code survives
        // this wrapper instead of being dropped at the re-throw.
        throw enrichAlpacaError(
          new Error(`Order ${orderId} is not cancelable`),
          error,
        );
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Create a limit order
   * @param symbol (string) - the symbol of the order
   * @param qty (number) - the quantity of the order
   * @param side (string) - the side of the order
   * @param limitPrice (number) - the limit price of the order
   * @param position_intent (string) - the position intent of the order
   * @param extended_hours (boolean) - whether the order is in extended hours
   * @param client_order_id - Optional explicit idempotency key; duplicate
   *   rejections of an explicit id surface as
   *   {@link DuplicateClientOrderIdError}.
   * @param idempotencyNonce - Optional attempt/signal discriminator folded into
   *   the derived idempotency key so an intentionally-repeated identical order
   *   inside one derivation window receives a distinct id.
   */
  async createLimitOrder(
    symbol: string,
    qty: number,
    side: "buy" | "sell",
    limitPrice: number,
    position_intent:
      | "buy_to_open"
      | "buy_to_close"
      | "sell_to_open"
      | "sell_to_close",
    extended_hours: boolean = false,
    client_order_id?: string,
    idempotencyNonce?: string | number,
  ): Promise<AlpacaOrder> {
    this.log(
      `Creating limit order for ${symbol}: ${side} ${qty} shares at $${limitPrice.toFixed(2)} (${position_intent})`,
      {
        symbol,
      },
    );

    const body: CreateOrderParams = {
      symbol,
      qty: Math.abs(qty).toString(),
      side,
      position_intent,
      type: "limit",
      limit_price: this.roundPriceForAlpaca(limitPrice).toString(),
      time_in_force: "day",
      order_class: "simple",
      extended_hours,
    };
    try {
      return await this.postOrderWithIdempotencyRecovery(body, {
        explicitClientOrderId: client_order_id,
        deriveParts: [
          "limit",
          symbol,
          side,
          position_intent,
          Math.abs(qty),
          this.roundPriceForAlpaca(limitPrice),
          extended_hours,
          ...(idempotencyNonce !== undefined ? [String(idempotencyNonce)] : []),
        ],
        logSymbol: symbol,
      });
    } catch (error) {
      this.log(`Error creating limit order: ${error}`, { type: "error" });
      throw error;
    }
  }

  /**
   * Close all equities positions
   * @param options (object) - the options for closing the positions
   * - cancel_orders (boolean) - whether to cancel related orders
   * - useLimitOrders (boolean) - whether to use limit orders to close the positions
   */
  async closeAllPositions(
    options: { cancel_orders: boolean; useLimitOrders: boolean } = {
      cancel_orders: true,
      useLimitOrders: false,
    },
  ): Promise<void> {
    this.log(
      `Closing all positions${options.useLimitOrders ? " using limit orders" : ""}${
        options.cancel_orders ? " and canceling open orders" : ""
      }`,
    );

    if (options.useLimitOrders) {
      // Get all positions
      const positions = await this.getPositions("us_equity");

      if (positions.length === 0) {
        this.log("No positions to close");
        return;
      }

      this.log(`Found ${positions.length} positions to close`);

      // Flatten each position independently. A missing quote or broker
      // rejection on one symbol must never abort the flatten of the others; any
      // per-position failure is surfaced as an aggregate error.
      await this.flattenPositionsWithLimitOrders(positions, false);
    } else {
      const results = await this.makeRequest<
        Array<{ symbol?: string; status?: number }> | null
      >(
        "/positions",
        "DELETE",
        undefined,
        options.cancel_orders ? "?cancel_orders=true" : "",
      );

      if (Array.isArray(results)) {
        const failures = this.collectMultiStatusFailures(results);
        if (failures.length > 0) {
          const detail = failures.join(", ");
          this.log(
            `Error closing all positions: ${failures.length}/${results.length} positions failed to close (${detail})`,
            { type: "error" },
          );
          throw new Error(
            `Failed to close ${failures.length} of ${results.length} positions: ${detail}`,
          );
        }
      }
    }
  }

  /**
   * Close all equities positions using limit orders during extended hours trading
   * @param cancelOrders Whether to cancel related orders (default: true)
   * @returns Promise that resolves when all positions are closed
   */
  async closeAllPositionsAfterHours(): Promise<void> {
    this.log(
      "Closing all positions using limit orders during extended hours trading",
    );

    // Get all positions
    const positions = await this.getPositions();
    this.log(`Found ${positions.length} positions to close`);

    if (positions.length === 0) {
      this.log("No positions to close");
      return;
    }

    // Cancelling stale open orders is secondary to the primary failsafe goal of
    // flattening positions. A cancel failure is logged but must not abort the
    // flatten, otherwise a single un-cancelable order would leave every position
    // open. The flatten step below surfaces its own aggregate failure.
    try {
      await this.cancelAllOrders();
      this.log(`Cancelled all open orders`);
    } catch (error) {
      this.log(
        `Proceeding to flatten despite cancelAllOrders failure: ${error instanceof Error ? error.message : String(error)}`,
        { type: "error" },
      );
    }

    // Flatten each position independently with extended-hours limit orders. A
    // missing quote or broker rejection on one symbol must never silently leave
    // the remaining positions open; per-position failures are surfaced as an
    // aggregate error.
    await this.flattenPositionsWithLimitOrders(positions, true);
  }

  onTradeUpdate(callback: (update: TradeUpdate) => void): void {
    this.tradeUpdateCallback = callback;
  }

  /**
   * Get portfolio history for the account
   * @param params Parameters for the portfolio history request
   * @returns Portfolio history data
   */
  async getPortfolioHistory(params: {
    timeframe?: "1Min" | "5Min" | "15Min" | "1H" | "1D";
    period?: string;
    extended_hours?: boolean;
    date_end?: string;
  }): Promise<{
    timestamp: number[];
    equity: number[];
    profit_loss: number[];
    profit_loss_pct: number[];
    base_value: number;
    timeframe: string;
  }> {
    const queryParams = new URLSearchParams();
    if (params.timeframe) queryParams.append("timeframe", params.timeframe);
    if (params.period) queryParams.append("period", params.period);
    if (params.extended_hours !== undefined)
      queryParams.append("extended_hours", params.extended_hours.toString());
    if (params.date_end) queryParams.append("date_end", params.date_end);

    const response = await this.makeRequest(
      `/account/portfolio/history?${queryParams.toString()}`,
    );
    return response as {
      timestamp: number[];
      equity: number[];
      profit_loss: number[];
      profit_loss_pct: number[];
      base_value: number;
      timeframe: string;
    };
  }

  /**
   * Get option contracts based on specified parameters
   * @param params Parameters to filter option contracts
   * @returns Option contracts matching the criteria
   */
  async getOptionContracts(
    params: GetOptionContractsParams,
  ): Promise<OptionContractsResponse> {
    const queryParams = new URLSearchParams();

    queryParams.append(
      "underlying_symbols",
      params.underlying_symbols.join(","),
    );

    if (params.expiration_date_gte)
      queryParams.append("expiration_date_gte", params.expiration_date_gte);
    if (params.expiration_date_lte)
      queryParams.append("expiration_date_lte", params.expiration_date_lte);
    if (params.strike_price_gte)
      queryParams.append("strike_price_gte", params.strike_price_gte);
    if (params.strike_price_lte)
      queryParams.append("strike_price_lte", params.strike_price_lte);
    if (params.type) queryParams.append("type", params.type);
    if (params.status) queryParams.append("status", params.status);
    if (params.limit) queryParams.append("limit", params.limit.toString());
    if (params.page_token) queryParams.append("page_token", params.page_token);

    this.log(
      `Fetching option contracts for ${params.underlying_symbols.join(", ")}`,
      {
        symbol: params.underlying_symbols.join(", "),
      },
    );

    const response = (await this.makeRequest(
      `/options/contracts?${queryParams.toString()}`,
    )) as OptionContractsResponse;
    this.log(`Found ${response.option_contracts.length} option contracts`, {
      symbol: params.underlying_symbols.join(", "),
    });
    return response;
  }

  /**
   * Get a specific option contract by symbol or ID
   * @param symbolOrId The symbol or ID of the option contract
   * @returns The option contract details
   */
  async getOptionContract(symbolOrId: string): Promise<OptionContract> {
    this.log(`Fetching option contract details for ${symbolOrId}`, {
      symbol: symbolOrId,
    });
    const response = (await this.makeRequest(
      `/options/contracts/${symbolOrId}`,
    )) as OptionContract;
    this.log(
      `Found option contract details for ${symbolOrId}: ${response.name}`,
      {
        symbol: symbolOrId,
      },
    );
    return response;
  }

  /**
   * Create a simple option order (market or limit)
   * @param symbol Option contract symbol
   * @param qty Quantity of contracts (must be a whole number)
   * @param side Buy or sell
   * @param position_intent Position intent (buy_to_open, buy_to_close, sell_to_open, sell_to_close)
   * @param type Order type (market or limit)
   * @param limitPrice Limit price (required for limit orders)
   * @param clientOrderId Optional idempotency key; a deterministic one is
   *   derived from the order parameters when omitted so a client-timeout retry
   *   is de-duplicated broker-side. Duplicate rejections of an explicit id
   *   surface as {@link DuplicateClientOrderIdError}.
   * @param idempotencyNonce Optional attempt/signal discriminator folded into
   *   the derived idempotency key so an intentionally-repeated identical order
   *   inside one derivation window receives a distinct id.
   * @returns The created order
   */
  async createOptionOrder(
    symbol: string,
    qty: number,
    side: "buy" | "sell",
    position_intent:
      | "buy_to_open"
      | "buy_to_close"
      | "sell_to_open"
      | "sell_to_close",
    type: "market" | "limit",
    limitPrice?: number,
    clientOrderId?: string,
    idempotencyNonce?: string | number,
  ): Promise<AlpacaOrder> {
    if (!Number.isInteger(qty) || qty <= 0) {
      this.log("Quantity must be a positive whole number for option orders", {
        type: "error",
      });
    }

    if (type === "limit" && limitPrice === undefined) {
      this.log("Limit price is required for limit orders", { type: "error" });
    }

    this.log(
      `Creating ${type} option order for ${symbol}: ${side} ${qty} contracts (${position_intent})${
        type === "limit" ? ` at $${limitPrice?.toFixed(2)}` : ""
      }`,
      {
        symbol,
      },
    );

    const orderData: CreateOrderParams = {
      symbol,
      qty: qty.toString(),
      side,
      position_intent,
      type,
      time_in_force: "day",
      order_class: "simple",
      extended_hours: false,
    };

    if (type === "limit" && limitPrice !== undefined) {
      orderData.limit_price = this.roundPriceForAlpaca(limitPrice).toString();
    }

    return this.postOrderWithIdempotencyRecovery(orderData, {
      explicitClientOrderId: clientOrderId,
      deriveParts: [
        "option",
        type,
        symbol,
        side,
        position_intent,
        qty,
        type === "limit" && limitPrice !== undefined
          ? this.roundPriceForAlpaca(limitPrice)
          : undefined,
        ...(idempotencyNonce !== undefined ? [String(idempotencyNonce)] : []),
      ],
      logSymbol: symbol,
    });
  }

  /**
   * Create a multi-leg option order
   * @param legs Array of order legs
   * @param qty Quantity of the multi-leg order (must be a whole number)
   * @param type Order type (market or limit)
   * @param limitPrice Limit price (required for limit orders)
   * @param clientOrderId Optional idempotency key; a deterministic one is
   *   derived from the legs and order parameters when omitted so a
   *   client-timeout retry is de-duplicated broker-side. Duplicate rejections
   *   of an explicit id surface as {@link DuplicateClientOrderIdError}.
   * @param idempotencyNonce Optional attempt/signal discriminator folded into
   *   the derived idempotency key so an intentionally-repeated identical order
   *   inside one derivation window receives a distinct id.
   * @returns The created multi-leg order
   */
  async createMultiLegOptionOrder(
    legs: OrderLeg[],
    qty: number,
    type: "market" | "limit",
    limitPrice?: number,
    clientOrderId?: string,
    idempotencyNonce?: string | number,
  ): Promise<AlpacaOrder> {
    if (!Number.isInteger(qty) || qty <= 0) {
      this.log("Quantity must be a positive whole number for option orders", {
        type: "error",
      });
    }

    if (type === "limit" && limitPrice === undefined) {
      this.log("Limit price is required for limit orders", { type: "error" });
    }

    if (legs.length < 2) {
      this.log("Multi-leg orders require at least 2 legs", { type: "error" });
    }

    const legSymbols = legs.map((leg) => leg.symbol).join(", ");
    this.log(
      `Creating multi-leg ${type} option order with ${legs.length} legs (${legSymbols})${
        type === "limit" ? ` at $${limitPrice?.toFixed(2)}` : ""
      }`,
      {
        symbol: legSymbols,
      },
    );

    const orderData: CreateMultiLegOrderParams = {
      order_class: "mleg",
      qty: qty.toString(),
      type,
      time_in_force: "day",
      legs,
    };

    if (type === "limit" && limitPrice !== undefined) {
      orderData.limit_price = this.roundPriceForAlpaca(limitPrice).toString();
    }

    return this.postOrderWithIdempotencyRecovery(orderData, {
      explicitClientOrderId: clientOrderId,
      deriveParts: [
        "mleg",
        type,
        qty,
        type === "limit" && limitPrice !== undefined
          ? this.roundPriceForAlpaca(limitPrice)
          : undefined,
        ...legs.map(
          (leg) =>
            `${leg.symbol}:${leg.side}:${leg.ratio_qty}:${leg.position_intent}`,
        ),
        ...(idempotencyNonce !== undefined ? [String(idempotencyNonce)] : []),
      ],
      logSymbol: legSymbols,
    });
  }

  /**
   * Exercise an option contract
   * @param symbolOrContractId The symbol or ID of the option contract to exercise
   * @returns Response from the exercise request
   */
  async exerciseOption(
    symbolOrContractId: string,
  ): Promise<ExerciseOptionResponse> {
    this.log(`Exercising option contract ${symbolOrContractId}`, {
      symbol: symbolOrContractId,
    });
    return this.makeRequest<ExerciseOptionResponse>(
      `/positions/${symbolOrContractId}/exercise`,
      "POST",
    );
  }

  /**
   * Get option positions
   * @returns Array of option positions
   */
  async getOptionPositions(): Promise<AlpacaPosition[]> {
    this.log("Fetching option positions");
    const positions = await this.getPositions("us_option");
    return positions;
  }

  async getOptionsOpenSpreadTrades(): Promise<void> {
    this.log("Fetching option open trades");
    // this function will get all open positions, extract the symbol and see when they were created.
    // figures out when the earliest date was (should be today)
    // then it pulls all orders after the earliest date that were closed and that were of class 'mleg'
    // Each of these contains two orders. they look like this:
  }

  /**
   * Get option account activities (exercises, assignments, expirations)
   * @param activityType Type of option activity to filter by
   * @param date Date to filter activities (YYYY-MM-DD format)
   * @returns Array of option account activities
   */
  async getOptionActivities(
    activityType?: "OPEXC" | "OPASN" | "OPEXP",
    date?: string,
  ): Promise<OptionAccountActivity[]> {
    const queryParams = new URLSearchParams();

    if (activityType) {
      queryParams.append("activity_types", activityType);
    } else {
      queryParams.append("activity_types", "OPEXC,OPASN,OPEXP");
    }

    if (date) {
      queryParams.append("date", date);
    }

    this.log(
      `Fetching option activities${activityType ? ` of type ${activityType}` : ""}${date ? ` for date ${date}` : ""}`,
    );

    return this.makeRequest(`/account/activities?${queryParams.toString()}`);
  }

  /**
   * Create a long call spread (buy lower strike call, sell higher strike call)
   * @param lowerStrikeCallSymbol Symbol of the lower strike call option
   * @param higherStrikeCallSymbol Symbol of the higher strike call option
   * @param qty Quantity of spreads to create (must be a whole number)
   * @param limitPrice Limit price for the spread
   * @returns The created multi-leg order
   */
  async createLongCallSpread(
    lowerStrikeCallSymbol: string,
    higherStrikeCallSymbol: string,
    qty: number,
    limitPrice: number,
  ): Promise<AlpacaOrder> {
    this.log(
      `Creating long call spread: Buy ${lowerStrikeCallSymbol}, Sell ${higherStrikeCallSymbol}, Qty: ${qty}, Price: $${limitPrice.toFixed(
        2,
      )}`,
      {
        symbol: `${lowerStrikeCallSymbol},${higherStrikeCallSymbol}`,
      },
    );

    const legs: OrderLeg[] = [
      {
        symbol: lowerStrikeCallSymbol,
        ratio_qty: "1",
        side: "buy",
        position_intent: "buy_to_open",
      },
      {
        symbol: higherStrikeCallSymbol,
        ratio_qty: "1",
        side: "sell",
        position_intent: "sell_to_open",
      },
    ];

    return this.createMultiLegOptionOrder(legs, qty, "limit", limitPrice);
  }

  /**
   * Create a long put spread (buy higher strike put, sell lower strike put)
   * @param higherStrikePutSymbol Symbol of the higher strike put option
   * @param lowerStrikePutSymbol Symbol of the lower strike put option
   * @param qty Quantity of spreads to create (must be a whole number)
   * @param limitPrice Limit price for the spread
   * @returns The created multi-leg order
   */
  async createLongPutSpread(
    higherStrikePutSymbol: string,
    lowerStrikePutSymbol: string,
    qty: number,
    limitPrice: number,
  ): Promise<AlpacaOrder> {
    this.log(
      `Creating long put spread: Buy ${higherStrikePutSymbol}, Sell ${lowerStrikePutSymbol}, Qty: ${qty}, Price: $${limitPrice.toFixed(
        2,
      )}`,
      {
        symbol: `${higherStrikePutSymbol},${lowerStrikePutSymbol}`,
      },
    );

    const legs: OrderLeg[] = [
      {
        symbol: higherStrikePutSymbol,
        ratio_qty: "1",
        side: "buy",
        position_intent: "buy_to_open",
      },
      {
        symbol: lowerStrikePutSymbol,
        ratio_qty: "1",
        side: "sell",
        position_intent: "sell_to_open",
      },
    ];

    return this.createMultiLegOptionOrder(legs, qty, "limit", limitPrice);
  }

  /**
   * Create an iron condor (sell call spread and put spread)
   * @param longPutSymbol Symbol of the lower strike put (long)
   * @param shortPutSymbol Symbol of the higher strike put (short)
   * @param shortCallSymbol Symbol of the lower strike call (short)
   * @param longCallSymbol Symbol of the higher strike call (long)
   * @param qty Quantity of iron condors to create (must be a whole number)
   * @param limitPrice Limit price for the iron condor (credit)
   * @returns The created multi-leg order
   */
  async createIronCondor(
    longPutSymbol: string,
    shortPutSymbol: string,
    shortCallSymbol: string,
    longCallSymbol: string,
    qty: number,
    limitPrice: number,
  ): Promise<AlpacaOrder> {
    this.log(
      `Creating iron condor with ${qty} contracts at $${limitPrice.toFixed(2)}`,
      {
        symbol: `${longPutSymbol},${shortPutSymbol},${shortCallSymbol},${longCallSymbol}`,
      },
    );

    const legs: OrderLeg[] = [
      {
        symbol: longPutSymbol,
        ratio_qty: "1",
        side: "buy",
        position_intent: "buy_to_open",
      },
      {
        symbol: shortPutSymbol,
        ratio_qty: "1",
        side: "sell",
        position_intent: "sell_to_open",
      },
      {
        symbol: shortCallSymbol,
        ratio_qty: "1",
        side: "sell",
        position_intent: "sell_to_open",
      },
      {
        symbol: longCallSymbol,
        ratio_qty: "1",
        side: "buy",
        position_intent: "buy_to_open",
      },
    ];

    try {
      return await this.createMultiLegOptionOrder(
        legs,
        qty,
        "limit",
        limitPrice,
      );
    } catch (error) {
      this.log(`Error creating iron condor: ${error}`, { type: "error" });
      throw error;
    }
  }

  /**
   * Create a covered call (sell call option against owned stock)
   * @param stockSymbol Symbol of the underlying stock
   * @param callOptionSymbol Symbol of the call option to sell
   * @param qty Quantity of covered calls to create (must be a whole number)
   * @param limitPrice Limit price for the call option
   * @returns The created order
   */
  async createCoveredCall(
    stockSymbol: string,
    callOptionSymbol: string,
    qty: number,
    limitPrice: number,
  ): Promise<AlpacaOrder> {
    this.log(
      `Creating covered call: Sell ${callOptionSymbol} against ${stockSymbol}, Qty: ${qty}, Price: $${limitPrice.toFixed(
        2,
      )}`,
      {
        symbol: `${stockSymbol},${callOptionSymbol}`,
      },
    );

    // For covered calls, we don't need to include the stock leg if we already own the shares
    // We just create a simple sell order for the call option
    try {
      return await this.createOptionOrder(
        callOptionSymbol,
        qty,
        "sell",
        "sell_to_open",
        "limit",
        limitPrice,
      );
    } catch (error) {
      this.log(`Error creating covered call: ${error}`, { type: "error" });
      throw error;
    }
  }

  /**
   * Roll an option position to a new expiration or strike
   * @param currentOptionSymbol Symbol of the current option position
   * @param newOptionSymbol Symbol of the new option to roll to
   * @param qty Quantity of options to roll (must be a whole number)
   * @param currentPositionSide Side of the current position ('buy' or 'sell')
   * @param limitPrice Net limit price for the roll
   * @returns The created multi-leg order
   */
  async rollOptionPosition(
    currentOptionSymbol: string,
    newOptionSymbol: string,
    qty: number,
    currentPositionSide: "buy" | "sell",
    limitPrice: number,
  ): Promise<AlpacaOrder> {
    this.log(
      `Rolling ${qty} ${currentOptionSymbol} to ${newOptionSymbol} at net price $${limitPrice.toFixed(2)}`,
      {
        symbol: `${currentOptionSymbol},${newOptionSymbol}`,
      },
    );

    // If current position is long, we need to sell to close and buy to open
    // If current position is short, we need to buy to close and sell to open
    const closePositionSide = currentPositionSide === "buy" ? "sell" : "buy";
    const openPositionSide = currentPositionSide;

    const closePositionIntent =
      closePositionSide === "buy" ? "buy_to_close" : "sell_to_close";
    const openPositionIntent =
      openPositionSide === "buy" ? "buy_to_open" : "sell_to_open";

    const legs: OrderLeg[] = [
      {
        symbol: currentOptionSymbol,
        ratio_qty: "1",
        side: closePositionSide,
        position_intent: closePositionIntent,
      },
      {
        symbol: newOptionSymbol,
        ratio_qty: "1",
        side: openPositionSide,
        position_intent: openPositionIntent,
      },
    ];

    try {
      return await this.createMultiLegOptionOrder(
        legs,
        qty,
        "limit",
        limitPrice,
      );
    } catch (error) {
      this.log(`Error rolling option position: ${error}`, { type: "error" });
      throw error;
    }
  }

  /**
   * Get option chain for a specific underlying symbol and expiration date
   * @param underlyingSymbol The underlying stock symbol
   * @param expirationDate The expiration date (YYYY-MM-DD format)
   * @returns Option contracts for the specified symbol and expiration date
   */
  async getOptionChain(
    underlyingSymbol: string,
    expirationDate: string,
  ): Promise<OptionContract[]> {
    this.log(
      `Fetching option chain for ${underlyingSymbol} with expiration date ${expirationDate}`,
      {
        symbol: underlyingSymbol,
      },
    );

    try {
      const params: GetOptionContractsParams = {
        underlying_symbols: [underlyingSymbol],
        expiration_date_gte: expirationDate,
        expiration_date_lte: expirationDate,
        status: "active",
        limit: 500, // Get a large number to ensure we get all strikes
      };

      const response = await this.getOptionContracts(params);
      return response.option_contracts || [];
    } catch (error) {
      this.log(
        `Failed to fetch option chain for ${underlyingSymbol}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        {
          type: "error",
          symbol: underlyingSymbol,
        },
      );
      return [];
    }
  }

  /**
   * Get all available expiration dates for a specific underlying symbol
   * @param underlyingSymbol The underlying stock symbol
   * @returns Array of available expiration dates
   */
  async getOptionExpirationDates(underlyingSymbol: string): Promise<string[]> {
    this.log(`Fetching available expiration dates for ${underlyingSymbol}`, {
      symbol: underlyingSymbol,
    });

    try {
      const params: GetOptionContractsParams = {
        underlying_symbols: [underlyingSymbol],
        status: "active",
        limit: 1000, // Get a large number to ensure we get contracts with all expiration dates
      };

      const response = await this.getOptionContracts(params);

      // Extract unique expiration dates
      const expirationDates = new Set<string>();
      if (response.option_contracts) {
        response.option_contracts.forEach((contract) => {
          expirationDates.add(contract.expiration_date);
        });
      }

      // Convert to array and sort
      return Array.from(expirationDates).sort();
    } catch (error) {
      this.log(
        `Failed to fetch expiration dates for ${underlyingSymbol}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        {
          type: "error",
          symbol: underlyingSymbol,
        },
      );
      return [];
    }
  }

  /**
   * Get the current options trading level for the account
   * @returns The options trading level (0-3)
   */
  async getOptionsTradingLevel(): Promise<number> {
    this.log("Fetching options trading level");

    const accountDetails = await this.getAccountDetails();
    return accountDetails.options_trading_level || 0;
  }

  /**
   * Check if the account has options trading enabled
   * @returns Boolean indicating if options trading is enabled
   */
  async isOptionsEnabled(): Promise<boolean> {
    this.log("Checking if options trading is enabled");

    const accountDetails = await this.getAccountDetails();

    // Check if options trading level is 2 or higher (Level 2+ allows buying calls/puts)
    // Level 0: Options disabled
    // Level 1: Only covered calls and cash-secured puts
    // Level 2+: Can buy calls and puts (required for executeOptionsOrder)
    const optionsLevel = accountDetails.options_trading_level || 0;
    const isEnabled = optionsLevel >= 2;

    this.log(`Options trading level: ${optionsLevel}, enabled: ${isEnabled}`);

    return isEnabled;
  }

  /**
   * Close all option positions
   * @param cancelOrders Whether to cancel related orders (default: true)
   * @returns Response from the close positions request
   */
  async closeAllOptionPositions(cancelOrders: boolean = true): Promise<void> {
    this.log(
      `Closing all option positions${cancelOrders ? " and canceling related orders" : ""}`,
    );

    const optionPositions = await this.getOptionPositions();

    if (optionPositions.length === 0) {
      this.log("No option positions to close");
      return;
    }

    // Create market orders to close each position
    for (const position of optionPositions) {
      const side = position.side === "long" ? "sell" : "buy";
      const positionIntent = side === "sell" ? "sell_to_close" : "buy_to_close";

      this.log(
        `Closing ${position.side} position of ${position.qty} contracts for ${position.symbol}`,
        {
          symbol: position.symbol,
        },
      );

      await this.createOptionOrder(
        position.symbol,
        parseInt(position.qty),
        side,
        positionIntent,
        "market",
      );
    }

    if (cancelOrders) {
      // Get all open option orders
      const orders = await this.getOrders({ status: "open" });
      const optionOrders = orders.filter(
        (order) => order.asset_class === "us_option",
      );

      // Cancel each open option order
      for (const order of optionOrders) {
        this.log(`Canceling open order for ${order.symbol}`, {
          symbol: order.symbol,
        });
        await this.makeRequest(`/orders/${order.id}`, "DELETE");
      }
    }
  }

  /**
   * Close a specific option position
   * @param symbol The option contract symbol
   * @param qty Optional quantity to close (defaults to entire position)
   * @returns The created order
   */
  async closeOptionPosition(
    symbol: string,
    qty?: number,
  ): Promise<AlpacaOrder> {
    this.log(
      `Closing option position for ${symbol}${qty ? ` (${qty} contracts)` : ""}`,
      {
        symbol,
      },
    );

    // Get the position details
    const positions = await this.getOptionPositions();
    const position = positions.find((p) => p.symbol === symbol);

    if (!position) {
      throw new Error(`No position found for option contract ${symbol}`);
    }

    const quantityToClose = qty || parseInt(position.qty);
    const side = position.side === "long" ? "sell" : "buy";
    const positionIntent = side === "sell" ? "sell_to_close" : "buy_to_close";

    try {
      return await this.createOptionOrder(
        symbol,
        quantityToClose,
        side,
        positionIntent,
        "market",
      );
    } catch (error) {
      this.log(`Error closing option position: ${error}`, { type: "error" });
      throw error;
    }
  }

  /**
   * Create a complete equities trade with optional stop loss and take profit
   * @param params Trade parameters including symbol, qty, side, and optional referencePrice
   * @param options Trade options including order type, extended hours, stop loss, and take profit settings
   * @returns The created order
   */
  async createEquitiesTrade(
    params: {
      symbol: string;
      qty: number;
      side: "buy" | "sell";
      referencePrice?: number;
    },
    options?: {
      type?: "market" | "limit";
      limitPrice?: number;
      extendedHours?: boolean;
      useStopLoss?: boolean;
      stopPrice?: number;
      stopPercent100?: number;
      useTakeProfit?: boolean;
      takeProfitPrice?: number;
      takeProfitPercent100?: number;
      clientOrderId?: string;
      /**
       * Attempt/signal discriminator folded into the derived idempotency key
       * so an intentionally-repeated identical order inside one derivation
       * window receives a distinct id.
       */
      idempotencyNonce?: string | number;
    },
  ): Promise<AlpacaOrder> {
    const { symbol, qty, side, referencePrice } = params;
    const {
      type = "market",
      limitPrice,
      extendedHours = false,
      useStopLoss = false,
      stopPrice,
      stopPercent100,
      useTakeProfit = false,
      takeProfitPrice,
      takeProfitPercent100,
      clientOrderId,
      idempotencyNonce,
    } = options || {};

    // Validation: Extended hours + market order is not allowed
    if (extendedHours && type === "market") {
      this.log("Cannot create market order with extended hours enabled", {
        symbol,
        type: "error",
      });
      throw new Error("Cannot create market order with extended hours enabled");
    }

    // Validation: Limit orders require limit price
    if (type === "limit" && limitPrice === undefined) {
      this.log("Limit price is required for limit orders", {
        symbol,
        type: "error",
      });
      throw new Error("Limit price is required for limit orders");
    }

    let calculatedStopPrice: number | undefined;
    let calculatedTakeProfitPrice: number | undefined;

    // Handle stop loss validation and calculation
    if (useStopLoss) {
      if (stopPrice === undefined && stopPercent100 === undefined) {
        this.log(
          "Either stopPrice or stopPercent100 must be provided when useStopLoss is true",
          {
            symbol,
            type: "error",
          },
        );
        throw new Error(
          "Either stopPrice or stopPercent100 must be provided when useStopLoss is true",
        );
      }

      if (stopPercent100 !== undefined) {
        if (referencePrice === undefined) {
          this.log("referencePrice is required when using stopPercent100", {
            symbol,
            type: "error",
          });
          throw new Error(
            "referencePrice is required when using stopPercent100",
          );
        }

        // Calculate stop price based on percentage and side
        const stopPercentDecimal = stopPercent100 / 100;
        if (side === "buy") {
          // For buy orders, stop loss is below the reference price
          calculatedStopPrice = referencePrice * (1 - stopPercentDecimal);
        } else {
          // For sell orders, stop loss is above the reference price
          calculatedStopPrice = referencePrice * (1 + stopPercentDecimal);
        }
      } else {
        calculatedStopPrice = stopPrice;
      }
    }

    // Handle take profit validation and calculation
    if (useTakeProfit) {
      if (takeProfitPrice === undefined && takeProfitPercent100 === undefined) {
        this.log(
          "Either takeProfitPrice or takeProfitPercent100 must be provided when useTakeProfit is true",
          {
            symbol,
            type: "error",
          },
        );
        throw new Error(
          "Either takeProfitPrice or takeProfitPercent100 must be provided when useTakeProfit is true",
        );
      }

      if (takeProfitPercent100 !== undefined) {
        if (referencePrice === undefined) {
          this.log(
            "referencePrice is required when using takeProfitPercent100",
            {
              symbol,
              type: "error",
            },
          );
          throw new Error(
            "referencePrice is required when using takeProfitPercent100",
          );
        }

        // Calculate take profit price based on percentage and side
        const takeProfitPercentDecimal = takeProfitPercent100 / 100;
        if (side === "buy") {
          // For buy orders, take profit is above the reference price
          calculatedTakeProfitPrice =
            referencePrice * (1 + takeProfitPercentDecimal);
        } else {
          // For sell orders, take profit is below the reference price
          calculatedTakeProfitPrice =
            referencePrice * (1 - takeProfitPercentDecimal);
        }
      } else {
        calculatedTakeProfitPrice = takeProfitPrice;
      }
    }

    // Determine order class based on what's enabled
    let orderClass: "simple" | "oto" | "bracket" = "simple";
    if (useStopLoss && useTakeProfit) {
      orderClass = "bracket";
    } else if (useStopLoss || useTakeProfit) {
      orderClass = "oto";
    }

    // Build the order request
    const orderData: CreateOrderParams = {
      symbol,
      qty: Math.abs(qty).toString(),
      side,
      type,
      time_in_force: "day",
      order_class: orderClass,
      extended_hours: extendedHours,
      position_intent: side === "buy" ? "buy_to_open" : "sell_to_open",
    };

    const deriveParts: ReadonlyArray<string | number | boolean | undefined> = [
      "equities",
      orderClass,
      type,
      symbol,
      side,
      Math.abs(qty),
      type === "limit" && limitPrice !== undefined
        ? this.roundPriceForAlpaca(limitPrice)
        : undefined,
      extendedHours,
      useStopLoss && calculatedStopPrice !== undefined
        ? this.roundPriceForAlpaca(calculatedStopPrice)
        : undefined,
      useTakeProfit && calculatedTakeProfitPrice !== undefined
        ? this.roundPriceForAlpaca(calculatedTakeProfitPrice)
        : undefined,
      ...(idempotencyNonce !== undefined ? [String(idempotencyNonce)] : []),
    ];

    // Add limit price for limit orders
    if (type === "limit" && limitPrice !== undefined) {
      orderData.limit_price = this.roundPriceForAlpaca(limitPrice).toString();
    }

    // Add stop loss if enabled
    if (useStopLoss && calculatedStopPrice !== undefined) {
      orderData.stop_loss = {
        stop_price: this.roundPriceForAlpaca(calculatedStopPrice).toString(),
      };
    }

    // Add take profit if enabled
    if (useTakeProfit && calculatedTakeProfitPrice !== undefined) {
      orderData.take_profit = {
        limit_price: this.roundPriceForAlpaca(
          calculatedTakeProfitPrice,
        ).toString(),
      };
    }

    const logMessage = `Creating ${orderClass} ${type} ${side} order for ${symbol}: ${qty} shares${
      type === "limit" ? ` at $${limitPrice?.toFixed(2)}` : ""
    }${useStopLoss ? ` with stop loss at $${calculatedStopPrice?.toFixed(2)}` : ""}${
      useTakeProfit
        ? ` with take profit at $${calculatedTakeProfitPrice?.toFixed(2)}`
        : ""
    }${extendedHours ? " (extended hours)" : ""}`;

    this.log(logMessage, {
      symbol,
    });

    try {
      return await this.postOrderWithIdempotencyRecovery(orderData, {
        explicitClientOrderId: clientOrderId,
        deriveParts,
        logSymbol: symbol,
      });
    } catch (error) {
      this.log(`Error creating equities trade: ${error}`, {
        symbol,
        type: "error",
      });
      throw error;
    }
  }
}
