/**
 * U1 — the Alpaca wrapper must preserve the broker's `response.data` (the
 * numeric code `42210000` / `40310000` and message body) when it re-throws.
 *
 * Root cause of the 2026-08-20 broken-stop incident: the SDK sets `Error.message`
 * only to "Request failed with status code NNN" and puts the actual reason in
 * `error.response.data`. The trailing-stop modify path (`updateTrailingStop` →
 * `sdk.replaceOrder`) and the order wrappers reduced the caught error to
 * `error.message` and threw a fresh `Error`, dropping `response.data` — so the
 * engine could not tell a stale-order reject (`42210000`) from a benign race and
 * blind-failed the profit lock (the engine even reached for the now-undefined
 * `err.response.data` as a downstream workaround).
 *
 * These tests pin the Category-A restoration: the thrown message/type is
 * byte-identical (existing string-matching consumers unaffected), and the broker
 * code is now recoverable via `getAlpacaBrokerErrorCode`. The success path is a
 * strict no-op — the enrichment lives only inside `catch`.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../logging", () => ({ log: vi.fn() }));

import { updateTrailingStop } from "../alpaca/trading/trailing-stops";
import { getOrder, getOrders, replaceOrder } from "../alpaca/trading/orders";
import { getAlpacaBrokerErrorCode } from "../errors";
import { AlpacaClient } from "../alpaca/client";
import { AlpacaOrder } from "../types/alpaca-types";

/** Alpaca's stale-order-id reject in the SDK/axios error shape. */
function staleOrderReject(): Error {
  return Object.assign(new Error("Request failed with status code 422"), {
    response: {
      status: 422,
      data: {
        code: 42210000,
        message: "cannot replace order in pending_cancel status",
      },
    },
  });
}

/** A replacement order the broker would return on a successful replace. */
const REPLACEMENT_ORDER = {
  id: "new-order-id",
  client_order_id: "coid",
  status: "new",
  symbol: "AAPL",
  type: "trailing_stop",
} as unknown as AlpacaOrder;

/**
 * Builds a minimal fake client whose SDK `replaceOrder` either resolves the
 * replacement order or rejects with the supplied error. `executeWithRateLimit`
 * runs the operation directly (the wrappers under test add no retry semantics
 * of their own).
 */
function makeClient(replaceResult: AlpacaOrder | Error): AlpacaClient {
  const sdk = {
    replaceOrder: (): Promise<AlpacaOrder> =>
      replaceResult instanceof Error
        ? Promise.reject(replaceResult)
        : Promise.resolve(replaceResult),
  };
  return {
    getSDK: () => sdk,
    executeWithRateLimit: <T>(operation: () => Promise<T>): Promise<T> =>
      operation(),
  } as unknown as AlpacaClient;
}

describe("updateTrailingStop broker-code preservation (the 08-20 site)", () => {
  it("preserves the 42210000 code while keeping the message byte-identical", async () => {
    const client = makeClient(staleOrderReject());

    const thrown = await updateTrailingStop(client, "order-abc", {
      trailPercent: 1.5,
    }).then(
      () => {
        throw new Error("expected updateTrailingStop to reject");
      },
      (e: unknown) => e as Error,
    );

    // Existing string-matching consumers read the identical message + type.
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toBe(
      "Failed to update trailing stop order-abc: Request failed with status code 422",
    );
    // The restoration: the broker code is now recoverable, structurally.
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });

  it("is a strict no-op on the success path — one SDK call, exact order returned, nothing enriched", async () => {
    const replaceSpy = vi.fn().mockResolvedValue(REPLACEMENT_ORDER);
    const client = {
      getSDK: () => ({ replaceOrder: replaceSpy }),
      executeWithRateLimit: <T>(op: () => Promise<T>): Promise<T> => op(),
    } as unknown as AlpacaClient;

    const result = await updateTrailingStop(client, "order-abc", {
      trailPercent: 1.5,
    });

    expect(result).toBe(REPLACEMENT_ORDER);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    // Enrichment lives only in catch: the success return is not decorated.
    expect("brokerError" in (result as object)).toBe(false);
    expect("response" in (result as object)).toBe(false);
  });
});

describe("replaceOrder broker-code preservation", () => {
  it("preserves the 42210000 code on a 422 reject; message unchanged", async () => {
    const client = makeClient(staleOrderReject());

    const thrown = await replaceOrder(client, "order-xyz", {
      trail: "1.5",
    }).then(
      () => {
        throw new Error("expected replaceOrder to reject");
      },
      (e: unknown) => e as Error,
    );

    expect(thrown.message).toBe(
      "Order order-xyz cannot be replaced: order may already be filled or canceled",
    );
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });

  it("is a strict no-op on the success path — one SDK call, exact order returned, nothing enriched", async () => {
    const replaceSpy = vi.fn().mockResolvedValue(REPLACEMENT_ORDER);
    const client = {
      getSDK: () => ({ replaceOrder: replaceSpy }),
      executeWithRateLimit: <T>(op: () => Promise<T>): Promise<T> => op(),
    } as unknown as AlpacaClient;

    const result = await replaceOrder(client, "order-xyz", { trail: "1.5" });

    expect(result).toBe(REPLACEMENT_ORDER);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect("brokerError" in (result as object)).toBe(false);
    expect("response" in (result as object)).toBe(false);
  });
});

/**
 * Builds a client whose SDK method `name` rejects with `error`, so the read
 * wrappers' catch blocks can be exercised directly. `executeWithRateLimit` runs
 * the operation with no retry semantics of its own.
 */
function makeRejectingClient(name: string, error: Error): AlpacaClient {
  const sdk = { [name]: (): Promise<never> => Promise.reject(error) };
  return {
    getSDK: () => sdk,
    executeWithRateLimit: <T>(operation: () => Promise<T>): Promise<T> =>
      operation(),
  } as unknown as AlpacaClient;
}

/**
 * The read wrappers (getOrder / getOrders) also re-threw a fresh Error that
 * dropped `response.data`. These have live callers (getOrder ←
 * name-concentration-cap-stop-release-exec; getOrders ← the app account
 * context) and so must preserve the broker code the same way the mutating
 * wrappers do. The class `makeRequest` fetch seam and the legacy fetch seam are
 * covered in alpaca-trading-api.test.ts and alpaca-functions.test.ts.
 */
describe("read-wrapper broker-code preservation (getOrder / getOrders)", () => {
  it("getOrder preserves 42210000; message byte-identical", async () => {
    const client = makeRejectingClient("getOrder", staleOrderReject());

    const thrown = await getOrder(client, "order-abc").then(
      () => {
        throw new Error("expected getOrder to reject");
      },
      (e: unknown) => e as Error,
    );

    expect(thrown.message).toBe(
      "Failed to fetch order order-abc: Request failed with status code 422",
    );
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });

  it("getOrders preserves 42210000; message byte-identical", async () => {
    const client = makeRejectingClient("getOrders", staleOrderReject());

    const thrown = await getOrders(client, { status: "open" }).then(
      () => {
        throw new Error("expected getOrders to reject");
      },
      (e: unknown) => e as Error,
    );

    expect(thrown.message).toBe(
      "Failed to fetch orders: Request failed with status code 422",
    );
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });
});
