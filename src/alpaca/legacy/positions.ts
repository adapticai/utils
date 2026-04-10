/**
 * Legacy Alpaca Position Functions
 * Position management using AlpacaAuth pattern with direct fetch calls.
 */
import {
  AlpacaAuth,
  AlpacaOrder,
  AlpacaPosition,
} from "../../types/alpaca-types";
import { validateAuth } from "./auth";
import {
  getOrders,
  cancelOrder,
  cancelAllOrders,
  createLimitOrder,
  makeRequest,
} from "./orders";
import { getLatestQuotes } from "./market-data";
import { roundPriceForAlpaca } from "./utils";
import { getTradingApiUrl } from "../../config/api-endpoints";
import { getLogger } from "../../logger";
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from "../../http-timeout";

/** Known quote currencies that signal a crypto pair when found as a suffix */
const CRYPTO_QUOTE_CURRENCIES = ["USD", "USDT", "USDC", "BTC"] as const;

/**
 * Detect whether a symbol looks like a crypto pair (e.g. "BTCUSD", "DOGEUSD",
 * "BTC/USD"). Equity tickers never end with these suffixes because Alpaca
 * equity symbols are plain tickers without a quote currency.
 */
function isCryptoSymbol(symbol: string): boolean {
  if (symbol.includes("/")) return true;
  const upper = symbol.toUpperCase();
  return CRYPTO_QUOTE_CURRENCIES.some((qc) => {
    if (!upper.endsWith(qc)) return false;
    const base = upper.slice(0, -qc.length);
    return base.length >= 2;
  });
}

/**
 * Fetches all positions for an Alpaca trading account.
 * @param auth - The authentication details for Alpaca
 * @returns The list of positions
 */
export async function fetchAllPositions(
  auth: AlpacaAuth,
): Promise<AlpacaPosition[]> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");
    const apiUrl = `${apiBaseUrl}/positions`;

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": APIKey,
        "APCA-API-SECRET-KEY": APISecret,
        "Content-Type": "application/json",
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch positions: ${response.status} ${response.statusText} ${errorText}`,
      );
    }

    return (await response.json()) as AlpacaPosition[];
  } catch (error) {
    getLogger().error("Error in fetchAllPositions:", error);
    throw error;
  }
}

/**
 * Fetches a specific position for an Alpaca account.
 * @param auth - The authentication details for Alpaca
 * @param symbolOrAssetId - The symbol or asset ID to fetch the position for
 * @returns The position details or null with message if not found
 */
export async function fetchPosition(
  auth: AlpacaAuth,
  symbolOrAssetId: string,
): Promise<{ position: AlpacaPosition | null; message?: string }> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");

    // Normalize crypto symbols for Alpaca API compatibility
    const normalizedSymbol = isCryptoSymbol(symbolOrAssetId)
      ? symbolOrAssetId.replace(/[-/]/g, "")
      : symbolOrAssetId;

    const response = await fetch(`${apiBaseUrl}/positions/${normalizedSymbol}`, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": APIKey,
        "APCA-API-SECRET-KEY": APISecret,
        "Content-Type": "application/json",
      },
      signal: createTimeoutSignal(DEFAULT_TIMEOUTS.ALPACA_API),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        return {
          position: null,
          message: `Position does not exist: ${symbolOrAssetId}`,
        };
      } else {
        throw new Error(
          `Failed to fetch position: ${response.status} ${response.statusText} ${errorText}`,
        );
      }
    }

    const position = (await response.json()) as AlpacaPosition;
    return { position };
  } catch (error) {
    getLogger().error("Error in fetchPosition:", error);
    throw error;
  }
}

/**
 * Closes a specific position in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param symbolOrAssetId - The symbol or asset ID of the position to close
 * @param params - Optional parameters for closing the position
 * @returns The order created to close the position
 */
export async function closePosition(
  auth: AlpacaAuth,
  symbolOrAssetId: string,
  params?: {
    qty?: number;
    percentage?: number;
    useLimitOrder?: boolean;
    cancelOrders?: boolean;
    slippagePercent1?: number;
    extendedHours?: boolean;
  },
): Promise<AlpacaOrder> {
  try {
    const { APIKey, APISecret, type } = await validateAuth(auth);
    const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");

    // Normalize crypto symbols for Alpaca API compatibility.
    // Alpaca positions endpoint rejects hyphenated format (e.g., "SOL-USD")
    // but accepts concatenated form (e.g., "SOLUSD").
    const normalizedSymbol = isCryptoSymbol(symbolOrAssetId)
      ? symbolOrAssetId.replace(/[-/]/g, "")
      : symbolOrAssetId;

    const useLimitOrder = params?.useLimitOrder ?? false;
    const cancelOrdersFlag = params?.cancelOrders ?? true;
    const slippagePercent1 = params?.slippagePercent1 ?? 0.1;
    const extendedHours = params?.extendedHours ?? false;

    // Cancel open orders for this symbol if requested
    if (cancelOrdersFlag) {
      getLogger().info(
        `Canceling open orders for ${normalizedSymbol} before closing position`,
        {
          account: auth.adapticAccountId || "direct",
          symbol: normalizedSymbol,
        },
      );

      // For crypto, Alpaca stores orders under "SOL/USD" (slash format) but the
      // symbols filter may not match across formats reliably. Fetch all open
      // orders without symbol filter and match client-side via normalization.
      const openOrders = isCryptoSymbol(symbolOrAssetId)
        ? await getOrders(auth, { status: "open" })
        : await getOrders(auth, { status: "open", symbols: [normalizedSymbol] });

      let cancelledCount = 0;
      for (const order of openOrders) {
        const orderSymbolNorm = order.symbol.replace(/[-/]/g, "");
        if (orderSymbolNorm === normalizedSymbol) {
          getLogger().info(
            `Cancelling order ${order.id} (${order.symbol}) for ${normalizedSymbol}`,
            { account: auth.adapticAccountId || "direct", symbol: normalizedSymbol },
          );
          await cancelOrder(auth, order.id);
          cancelledCount++;
        }
      }
      if (cancelledCount > 0) {
        getLogger().info(
          `Cancelled ${cancelledCount} open orders for ${normalizedSymbol}`,
          { account: auth.adapticAccountId || "direct", symbol: normalizedSymbol },
        );
      }
    }

    // Crypto positions cannot use limit orders with SIP quotes or time_in_force="day".
    // Use direct DELETE (market order) for crypto regardless of useLimitOrder flag.
    if (useLimitOrder && !isCryptoSymbol(symbolOrAssetId)) {
      // Attempt limit order closure; if quotes are unavailable (after-hours, IEX gaps),
      // fall back to market order (DELETE) so the position still gets closed.
      try {
        const { position } = await fetchPosition(auth, symbolOrAssetId);

        if (!position) {
          throw new Error(`Position not found for ${symbolOrAssetId}`);
        }

        // Use the passed auth for quote fetching so multi-account setups
        // use the correct credentials per account
        const quotesResponse = await getLatestQuotes(auth, {
          symbols: [symbolOrAssetId],
        });
        const quote = quotesResponse.quotes[symbolOrAssetId];

        if (!quote) {
          throw new Error(`No quote available for ${symbolOrAssetId}`);
        }

        let qty = Math.abs(parseFloat(position.qty));
        if (params?.qty !== undefined) {
          qty = params.qty;
        } else if (params?.percentage !== undefined) {
          qty = Math.abs(parseFloat(position.qty)) * (params.percentage / 100);
        }

        const side = position.side === "long" ? "sell" : "buy";
        const positionIntent = side === "sell" ? "sell_to_close" : "buy_to_close";
        const currentPrice = side === "sell" ? quote.bp : quote.ap;

        if (!currentPrice) {
          throw new Error(`No valid price available for ${symbolOrAssetId}`);
        }

        const limitSlippage = slippagePercent1 / 100;
        const limitPrice =
          side === "sell"
            ? roundPriceForAlpaca(currentPrice * (1 - limitSlippage))
            : roundPriceForAlpaca(currentPrice * (1 + limitSlippage));

        getLogger().info(
          `Creating limit order to close ${symbolOrAssetId} position: ${side} ${qty} shares at ${limitPrice.toFixed(2)}`,
          {
            account: auth.adapticAccountId || "direct",
            symbol: symbolOrAssetId,
          },
        );

        return await createLimitOrder(auth, {
          symbol: symbolOrAssetId,
          qty,
          side,
          limitPrice,
          position_intent: positionIntent,
          extended_hours: extendedHours,
        });
      } catch (limitOrderError) {
        // Quote unavailable or invalid price — fall back to market order (DELETE)
        // so the position still gets closed rather than leaving it open
        const errMsg = limitOrderError instanceof Error ? limitOrderError.message : String(limitOrderError);
        getLogger().warn(
          `Limit order closure failed for ${symbolOrAssetId} (${errMsg}), falling back to market order`,
          {
            account: auth.adapticAccountId || "direct",
            symbol: symbolOrAssetId,
            type: "warn",
          },
        );
        // Fall through to the DELETE (market order) path below
      }
    }

    // Market order (DELETE) path — used when limit orders are not requested,
    // for crypto symbols, or as a fallback when limit order quotes are unavailable
    if (isCryptoSymbol(symbolOrAssetId)) {
      getLogger().info(
        `Closing crypto position ${normalizedSymbol} via market order (DELETE endpoint)`,
        { account: auth.adapticAccountId || "direct", symbol: normalizedSymbol },
      );
    }
    const queryParams = new URLSearchParams();
    if (params?.qty !== undefined) {
      queryParams.append("qty", params.qty.toString());
    }
    if (params?.percentage !== undefined) {
      queryParams.append("percentage", params.percentage.toString());
    }

    const queryString = queryParams.toString();
    const url = `${apiBaseUrl}/positions/${encodeURIComponent(normalizedSymbol)}${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "APCA-API-KEY-ID": APIKey,
        "APCA-API-SECRET-KEY": APISecret,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to close position: ${response.status} ${response.statusText} ${errorText}`,
      );
    }

    return (await response.json()) as AlpacaOrder;
  } catch (error) {
    getLogger().error("Error in closePosition:", error);
    throw error;
  }
}

/**
 * Closes all positions in Alpaca.
 * @param auth - The authentication details for Alpaca
 * @param params - Optional parameters for closing all positions
 * @returns The status of each position closure attempt
 */
export async function closeAllPositions(
  auth: AlpacaAuth,
  params: {
    cancel_orders?: boolean;
    useLimitOrders?: boolean;
    slippagePercent1?: number;
  } = { cancel_orders: true, useLimitOrders: false, slippagePercent1: 0.1 },
): Promise<Array<{
  symbol: string;
  status: number;
  body?: AlpacaOrder;
}> | void> {
  const { cancel_orders, useLimitOrders, slippagePercent1 = 0.1 } = params;
  getLogger().info(
    `Closing all positions${useLimitOrders ? " using limit orders" : ""}${cancel_orders ? " and canceling open orders" : ""}`,
    {
      account: auth.adapticAccountId || "direct",
    },
  );

  if (useLimitOrders) {
    // Cancel all existing orders first when requested, to free up qty_available
    // for the limit close orders. Without this, existing trailing stops and
    // pending orders reduce qty_available, causing "insufficient qty" errors.
    if (cancel_orders) {
      try {
        await cancelAllOrders(auth);
        getLogger().info("Canceled all open orders before placing limit close orders", {
          account: auth.adapticAccountId || "direct",
        });
      } catch (cancelError) {
        getLogger().warn(
          `Failed to cancel orders before limit closure: ${cancelError instanceof Error ? cancelError.message : String(cancelError)}`,
          {
            account: auth.adapticAccountId || "direct",
            type: "warn",
          },
        );
        // Continue with closure attempt even if cancel failed
      }
    }

    const allPositions = await fetchAllPositions(auth);

    if (allPositions.length === 0) {
      getLogger().info("No positions to close", {
        account: auth.adapticAccountId || "direct",
      });
      return [];
    }

    // Separate crypto and equity positions — crypto cannot use SIP quotes or time_in_force="day"
    const equityPositions = allPositions.filter((p) => !isCryptoSymbol(p.symbol));
    const cryptoPositions = allPositions.filter((p) => isCryptoSymbol(p.symbol));

    getLogger().info(
      `Found ${allPositions.length} positions to close (${equityPositions.length} equity, ${cryptoPositions.length} crypto)`,
      { account: auth.adapticAccountId || "direct" },
    );

    // Close crypto positions via direct DELETE (market order) — no SIP quotes needed
    for (const position of cryptoPositions) {
      try {
        const { APIKey, APISecret, type } = await validateAuth(auth);
        const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");
        const url = `${apiBaseUrl}/positions/${encodeURIComponent(position.symbol)}`;
        const response = await fetch(url, {
          method: "DELETE",
          headers: {
            "APCA-API-KEY-ID": APIKey,
            "APCA-API-SECRET-KEY": APISecret,
          },
        });
        if (response.ok) {
          getLogger().info(`Closed crypto position ${position.symbol} via market order`, {
            account: auth.adapticAccountId || "direct",
            symbol: position.symbol,
          });
        } else {
          const errorText = await response.text();
          getLogger().warn(
            `Failed to close crypto position ${position.symbol}: ${response.status} ${errorText}`,
            { account: auth.adapticAccountId || "direct", symbol: position.symbol },
          );
        }
      } catch (cryptoError) {
        getLogger().warn(
          `Error closing crypto position ${position.symbol}: ${cryptoError instanceof Error ? cryptoError.message : String(cryptoError)}`,
          { account: auth.adapticAccountId || "direct", symbol: position.symbol },
        );
      }
    }

    // Close equity positions via limit orders with SIP quotes
    if (equityPositions.length === 0) {
      return [];
    }

    // Use the passed auth for quote fetching (not hardcoded env vars)
    // so multi-account setups use the correct credentials per account
    const symbols = equityPositions.map((position) => position.symbol);
    const quotesResponse = await getLatestQuotes(auth, { symbols });

    const lengthOfQuotes = Object.keys(quotesResponse.quotes).length;
    if (lengthOfQuotes === 0) {
      getLogger().error(
        "No quotes available for equity positions, received 0 quotes",
        {
          account: auth.adapticAccountId || "direct",
          type: "error",
        },
      );
      return [];
    }

    if (lengthOfQuotes !== equityPositions.length) {
      getLogger().warn(
        `Received ${lengthOfQuotes} quotes for ${equityPositions.length} equity positions, proceeding with available quotes`,
        {
          account: auth.adapticAccountId || "direct",
          type: "warn",
        },
      );
    }

    for (const position of equityPositions) {
      const quote = quotesResponse.quotes[position.symbol];
      if (!quote) {
        getLogger().warn(
          `No quote available for ${position.symbol}, skipping limit order`,
          {
            account: auth.adapticAccountId || "direct",
            symbol: position.symbol,
            type: "warn",
          },
        );
        continue;
      }

      const qty = Math.abs(parseFloat(position.qty));
      const side = position.side === "long" ? "sell" : "buy";
      const positionIntent = side === "sell" ? "sell_to_close" : "buy_to_close";
      const currentPrice = side === "sell" ? quote.bp : quote.ap;

      if (!currentPrice) {
        getLogger().warn(
          `No valid price available for ${position.symbol}, skipping limit order`,
          {
            account: auth.adapticAccountId || "direct",
            symbol: position.symbol,
            type: "warn",
          },
        );
        continue;
      }

      const limitSlippage = slippagePercent1 / 100;
      const limitPrice =
        side === "sell"
          ? roundPriceForAlpaca(currentPrice * (1 - limitSlippage))
          : roundPriceForAlpaca(currentPrice * (1 + limitSlippage));

      getLogger().info(
        `Creating limit order to close ${position.symbol} position: ${side} ${qty} shares at ${limitPrice.toFixed(2)}`,
        {
          account: auth.adapticAccountId || "direct",
          symbol: position.symbol,
        },
      );

      await createLimitOrder(auth, {
        symbol: position.symbol,
        qty,
        side,
        limitPrice,
        position_intent: positionIntent,
        extended_hours: false,
      });
    }
  } else {
    const response = await makeRequest<
      { symbol: string; status: number; body?: AlpacaOrder }[]
    >(auth, {
      endpoint: "/positions",
      method: "DELETE",
      queryString: cancel_orders ? "?cancel_orders=true" : "",
    });
    return response;
  }
}

/**
 * Closes all positions in Alpaca using limit orders during extended hours trading.
 * @param auth - The authentication details for Alpaca
 * @param params - Optional parameters for closing all positions
 * @returns The status of each position closure attempt
 */
export async function closeAllPositionsAfterHours(
  auth: AlpacaAuth,
  params: {
    cancel_orders?: boolean;
    slippagePercent1?: number;
  } = { cancel_orders: true, slippagePercent1: 0.1 },
): Promise<Array<{
  symbol: string;
  status: number;
  body?: AlpacaOrder;
}> | void> {
  getLogger().info(
    "Closing all positions using limit orders during extended hours trading",
    {
      account: auth.adapticAccountId || "direct",
    },
  );

  const { cancel_orders, slippagePercent1 = 0.1 } = params;

  const allPositions = await fetchAllPositions(auth);

  if (allPositions.length === 0) {
    getLogger().info("No positions to close", {
      account: auth.adapticAccountId || "direct",
    });
    return;
  }

  // Separate crypto and equity positions
  const equityPositions = allPositions.filter((p) => !isCryptoSymbol(p.symbol));
  const cryptoPositions = allPositions.filter((p) => isCryptoSymbol(p.symbol));

  getLogger().info(
    `Found ${allPositions.length} positions to close after hours (${equityPositions.length} equity, ${cryptoPositions.length} crypto)`,
    { account: auth.adapticAccountId || "direct" },
  );

  if (cancel_orders) {
    await cancelAllOrders(auth);
    getLogger().info("Cancelled all open orders", {
      account: auth.adapticAccountId || "direct",
    });
  }

  // Close crypto positions via direct DELETE (market order)
  for (const position of cryptoPositions) {
    try {
      const { APIKey, APISecret, type } = await validateAuth(auth);
      const apiBaseUrl = getTradingApiUrl(type as "PAPER" | "LIVE");
      const url = `${apiBaseUrl}/positions/${encodeURIComponent(position.symbol)}`;
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "APCA-API-KEY-ID": APIKey,
          "APCA-API-SECRET-KEY": APISecret,
        },
      });
      if (response.ok) {
        getLogger().info(`Closed crypto position ${position.symbol} via market order`, {
          account: auth.adapticAccountId || "direct",
          symbol: position.symbol,
        });
      } else {
        const errorText = await response.text();
        getLogger().warn(
          `Failed to close crypto position ${position.symbol}: ${response.status} ${errorText}`,
          { account: auth.adapticAccountId || "direct", symbol: position.symbol },
        );
      }
    } catch (cryptoError) {
      getLogger().warn(
        `Error closing crypto position ${position.symbol}: ${cryptoError instanceof Error ? cryptoError.message : String(cryptoError)}`,
        { account: auth.adapticAccountId || "direct", symbol: position.symbol },
      );
    }
  }

  if (equityPositions.length === 0) {
    return;
  }

  // Use the passed auth for quote fetching (not hardcoded env vars)
  // so multi-account setups use the correct credentials per account
  const symbols = equityPositions.map((position) => position.symbol);
  const quotesResponse = await getLatestQuotes(auth, { symbols });

  for (const position of equityPositions) {
    const quote = quotesResponse.quotes[position.symbol];
    if (!quote) {
      getLogger().warn(
        `No quote available for ${position.symbol}, skipping limit order`,
        {
          account: auth.adapticAccountId || "direct",
          symbol: position.symbol,
          type: "warn",
        },
      );
      continue;
    }

    const qty = Math.abs(parseFloat(position.qty));
    const side = position.side === "long" ? "sell" : "buy";
    const positionIntent = side === "sell" ? "sell_to_close" : "buy_to_close";
    const currentPrice = side === "sell" ? quote.bp : quote.ap;

    if (!currentPrice) {
      getLogger().warn(
        `No valid price available for ${position.symbol}, skipping limit order`,
        {
          account: auth.adapticAccountId || "direct",
          symbol: position.symbol,
          type: "warn",
        },
      );
      continue;
    }

    const limitSlippage = slippagePercent1 / 100;
    const limitPrice =
      side === "sell"
        ? roundPriceForAlpaca(currentPrice * (1 - limitSlippage))
        : roundPriceForAlpaca(currentPrice * (1 + limitSlippage));

    getLogger().info(
      `Creating extended hours limit order to close ${position.symbol} position: ${side} ${qty} shares at ${limitPrice.toFixed(2)}`,
      {
        account: auth.adapticAccountId || "direct",
        symbol: position.symbol,
      },
    );

    await createLimitOrder(auth, {
      symbol: position.symbol,
      qty,
      side,
      limitPrice,
      position_intent: positionIntent,
      extended_hours: true,
    });
  }

  getLogger().info(
    `All positions closed: ${allPositions.map((p: AlpacaPosition) => p.symbol).join(", ")}`,
    {
      account: auth.adapticAccountId || "direct",
    },
  );
}
