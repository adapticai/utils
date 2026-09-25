/**
 * The legacy AlpacaAuth cancel seam (`alpaca.orders.cancel`, used by the engine
 * for protective-leg teardown) must type a 422 "order pending cancel" as a
 * {@link PendingCancelError} exactly like the class and SDK seams do, keep its
 * thrown message byte-identical, and leave every other refusal untyped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@adaptic/backend", () => ({
  default: { alpacaAccount: { get: vi.fn() } },
  types: {},
}));
vi.mock("../adaptic", () => ({
  getSharedApolloClient: vi.fn().mockResolvedValue({}),
}));
vi.mock("../utils/auth-validator", () => ({
  validateAlpacaCredentials: vi.fn(),
}));
vi.mock("../logger", () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { cancelOrder } from "../alpaca/legacy/orders";
import {
  PENDING_CANCEL_ERROR_CODE,
  PendingCancelError,
  getAlpacaBrokerErrorCode,
  isPendingCancelRejection,
} from "../errors";
import type { AlpacaAuth } from "../types/alpaca-types";

const auth: AlpacaAuth = {
  alpacaApiKey: "k",
  alpacaApiSecret: "s",
  type: "PAPER",
};

function errorResponse(status: number, statusText: string, body: string) {
  return {
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(body),
  };
}

async function rejectionOf(work: Promise<unknown>): Promise<Error> {
  return work.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e as Error,
  );
}

describe("legacy cancelOrder (AlpacaAuth seam)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("types a 422 'order pending cancel' as PendingCancelError with the same message", async () => {
    const body = JSON.stringify({ code: 42210000, message: "order pending cancel" });
    mockFetch.mockResolvedValueOnce(errorResponse(422, "Unprocessable Entity", body));

    const thrown = await rejectionOf(cancelOrder(auth, "leg-9"));

    expect(thrown).toBeInstanceOf(PendingCancelError);
    const typed = thrown as PendingCancelError;
    expect(typed.message).toBe(
      `Failed to cancel order: 422 Unprocessable Entity ${body}`,
    );
    expect(typed.code).toBe(PENDING_CANCEL_ERROR_CODE);
    expect(typed.orderId).toBe("leg-9");
    expect(getAlpacaBrokerErrorCode(typed)).toBe(42210000);
    expect(isPendingCancelRejection(typed)).toBe(true);
  });

  it("leaves a 422 'order is not cancelable' untyped, byte-identical to before", async () => {
    const body = JSON.stringify({ code: 42210000, message: "order is not cancelable" });
    mockFetch.mockResolvedValueOnce(errorResponse(422, "Unprocessable Entity", body));

    const thrown = await rejectionOf(cancelOrder(auth, "leg-10"));

    expect(thrown).not.toBeInstanceOf(PendingCancelError);
    expect(thrown.message).toBe(
      `Failed to cancel order: 422 Unprocessable Entity ${body}`,
    );
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });

  it("still answers a 404 as not found without throwing", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, "Not Found", "order not found"));

    await expect(cancelOrder(auth, "gone-9")).resolves.toEqual({
      success: false,
      message: "Order not found: gone-9",
    });
  });
});
