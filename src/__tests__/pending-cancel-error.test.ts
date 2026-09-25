/**
 * A DELETE on an order the broker already holds in `pending_cancel` is refused
 * with HTTP 422, code 42210000, reason "order pending cancel". That answer
 * means the order is being torn down: it is not live protection and a second
 * DELETE only returns the same 422. Both cancel seams (the `AlpacaTradingAPI`
 * class on raw `fetch`, and the SDK-backed `cancelOrder` helper) must surface
 * it as a typed {@link PendingCancelError}, distinct from a plain "not
 * cancelable" 422, while keeping the thrown message byte-identical for
 * consumers that still match on it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ws", () => ({
  default: class MockWebSocket {
    static readonly OPEN = 1;
  },
}));
vi.mock("../logging", () => ({ log: vi.fn() }));
vi.mock("../alpaca-market-data-api", () => ({ marketDataAPI: {} }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { AlpacaTradingAPI } from "../alpaca-trading-api";
import { cancelOrder } from "../alpaca/trading/orders";
import { AlpacaClient } from "../alpaca/client";
import {
  AlpacaApiError,
  PENDING_CANCEL_ERROR_CODE,
  PendingCancelError,
  getAlpacaBrokerErrorCode,
  isPendingCancelRejection,
} from "../errors";
import { AlpacaCredentials } from "../types/alpaca-types";

const credentials: AlpacaCredentials = {
  accountName: "test-account",
  apiKey: "test-api-key-123",
  apiSecret: "test-api-secret-123",
  type: "PAPER",
  orderType: "market",
  engine: "adaptic",
};

const PENDING_CANCEL_BODY = JSON.stringify({
  code: 42210000,
  message: "order pending cancel",
});
const NOT_CANCELABLE_BODY = JSON.stringify({
  code: 42210000,
  message: "order is not cancelable",
});

function errorResponse(status: number, body: string) {
  return { ok: false, status, text: () => Promise.resolve(body) };
}

async function rejectionOf(work: Promise<unknown>): Promise<Error> {
  return work.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e as Error,
  );
}

/** The SDK/axios error shape Alpaca's client throws. */
function sdkRejection(message: string): Error {
  return Object.assign(new Error("Request failed with status code 422"), {
    response: { status: 422, data: { code: 42210000, message } },
  });
}

function sdkClient(error: Error): AlpacaClient {
  return {
    getSDK: () => ({ cancelOrder: () => Promise.reject(error) }),
    executeWithRateLimit: <T>(operation: () => Promise<T>): Promise<T> =>
      operation(),
  } as unknown as AlpacaClient;
}

describe("AlpacaTradingAPI.cancelOrder (fetch seam)", () => {
  let api: AlpacaTradingAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new AlpacaTradingAPI(credentials);
  });

  it("types a 422 'order pending cancel' as PendingCancelError, message byte-identical", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(422, PENDING_CANCEL_BODY));

    const thrown = await rejectionOf(api.cancelOrder("leg-1"));

    expect(thrown).toBeInstanceOf(PendingCancelError);
    expect(thrown).toBeInstanceOf(AlpacaApiError);
    const typed = thrown as PendingCancelError;
    expect(typed.message).toBe("Order leg-1 is not cancelable");
    expect(typed.code).toBe(PENDING_CANCEL_ERROR_CODE);
    expect(typed.orderId).toBe("leg-1");
    expect(typed.statusCode).toBe(422);
    expect(typed.isRetryable).toBe(false);
    expect(getAlpacaBrokerErrorCode(typed)).toBe(42210000);
    expect(typed.brokerError?.brokerMessage).toBe("order pending cancel");
    expect(isPendingCancelRejection(typed)).toBe(true);
  });

  it("leaves a plain 'not cancelable' 422 untyped (no-op on that partition)", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(422, NOT_CANCELABLE_BODY));

    const thrown = await rejectionOf(api.cancelOrder("leg-2"));

    expect(thrown).not.toBeInstanceOf(PendingCancelError);
    expect(thrown.message).toBe("Order leg-2 is not cancelable");
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
    expect(isPendingCancelRejection(thrown)).toBe(false);
  });

  it("re-throws a 404 unchanged", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, "order not found"));

    const thrown = await rejectionOf(api.cancelOrder("gone-1"));

    expect(thrown).not.toBeInstanceOf(PendingCancelError);
    expect(thrown.message).toBe("Alpaca API error (404): order not found");
  });
});

describe("cancelOrder (SDK seam)", () => {
  it("types a 422 'order pending cancel' as PendingCancelError, message byte-identical", async () => {
    const thrown = await rejectionOf(
      cancelOrder(sdkClient(sdkRejection("order pending cancel")), "leg-3"),
    );

    expect(thrown).toBeInstanceOf(PendingCancelError);
    expect(thrown.message).toBe("Order leg-3 is not cancelable");
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });

  it("leaves a plain 'not cancelable' 422 untyped", async () => {
    const thrown = await rejectionOf(
      cancelOrder(sdkClient(sdkRejection("order is not cancelable")), "leg-4"),
    );

    expect(thrown).not.toBeInstanceOf(PendingCancelError);
    expect(thrown.message).toBe("Order leg-4 is not cancelable");
  });
});

describe("isPendingCancelRejection", () => {
  it("reads the reason through a wrapper's cause chain", () => {
    const wrapped = Object.assign(new Error("outer"), {
      cause: sdkRejection("order pending cancel"),
    });
    expect(isPendingCancelRejection(wrapped)).toBe(true);
  });

  it("accepts the underscore spelling Alpaca uses in replace refusals", () => {
    expect(
      isPendingCancelRejection(
        sdkRejection("cannot replace order in pending_cancel status"),
      ),
    ).toBe(true);
  });

  it("never reads a 422 with no reason text as pending cancel", () => {
    const bare = Object.assign(new Error("Request failed with status code 422"), {
      response: { status: 422, data: { code: 42210000 } },
    });
    expect(isPendingCancelRejection(bare)).toBe(false);
  });

  it("ignores a non-broker error and non-error values", () => {
    expect(isPendingCancelRejection(new Error("pending cancel"))).toBe(false);
    expect(isPendingCancelRejection(undefined)).toBe(false);
    expect(isPendingCancelRejection("order pending cancel")).toBe(false);
  });
});
