/**
 * Pins the per-asset-class transaction-cost model in price-utils
 * (U01-utils-lib-06 test gap): equity sell-side SEC+TAF, options
 * OCC+ORF+SEC-on-principal+TAF, crypto tier-1 taker bps, the dollar-notional
 * fallback for fractional orders, and the honest-zero paths (no order id, no
 * order, nothing filled).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@adaptic/backend-legacy", () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
  },
  types: {},
}));

const getOrderMock = vi.fn();
vi.mock("../alpaca/legacy", () => ({
  getOrder: (...args: unknown[]) => getOrderMock(...args),
}));

vi.mock("../adaptic", () => ({
  getSharedApolloClient: vi.fn(),
}));

import { types } from "@adaptic/backend-legacy";
import { calculateFees } from "../price-utils";

/** Published fee-schedule rates the model must reproduce. */
const SEC_FEE_PER_USD = 8.0 / 1_000_000;
const TAF_EQUITY_PER_SHARE = 0.000166;
const OCC_PER_CONTRACT = 0.02;
const ORF_PER_CONTRACT = 0.02685;
const TAF_OPTIONS_PER_CONTRACT = 0.00279;
const CRYPTO_TIER1_TAKER_BPS = 25;

const action = { alpacaOrderId: "order-1" } as unknown as types.Action;
const actionWithoutOrder = {
  alpacaOrderId: null,
} as unknown as types.Action;
const trade = { alpacaAccountId: "acct-1" } as unknown as types.Trade;
const account = {
  APIKey: "k",
  APISecret: "s",
} as unknown as types.AlpacaAccount;

describe("calculateFees", () => {
  beforeEach(() => {
    getOrderMock.mockReset();
  });

  it("charges SEC + TAF on an equity sell of 100 shares at $50", async () => {
    getOrderMock.mockResolvedValueOnce({
      asset_class: "us_equity",
      side: "sell",
      filled_qty: "100",
      filled_avg_price: "50",
    });

    const fee = await calculateFees(action, trade, account);

    const notional = 100 * 50;
    const expected =
      notional * SEC_FEE_PER_USD +
      Math.min(100 * TAF_EQUITY_PER_SHARE, 8.3);
    expect(fee).toBeCloseTo(expected, 10);
  });

  it("charges zero on an equity buy", async () => {
    getOrderMock.mockResolvedValueOnce({
      asset_class: "us_equity",
      side: "buy",
      filled_qty: "100",
      filled_avg_price: "50",
    });

    await expect(calculateFees(action, trade, account)).resolves.toBe(0);
  });

  it("charges OCC + ORF + SEC-on-principal + TAF on an option sell of 3 contracts at $1.25", async () => {
    getOrderMock.mockResolvedValueOnce({
      asset_class: "us_option",
      side: "sell",
      filled_qty: "3",
      filled_avg_price: "1.25",
    });

    const fee = await calculateFees(action, trade, account);

    const premiumNotional = 3 * 1.25;
    const expected =
      Math.min(3 * OCC_PER_CONTRACT, 55) +
      3 * ORF_PER_CONTRACT +
      premiumNotional * 100 * SEC_FEE_PER_USD +
      Math.min(3 * TAF_OPTIONS_PER_CONTRACT, 8.3);
    expect(fee).toBeCloseTo(expected, 10);
  });

  it("charges tier-1 taker bps of notional on a crypto market order", async () => {
    getOrderMock.mockResolvedValueOnce({
      asset_class: "crypto",
      side: "buy",
      filled_qty: "2",
      filled_avg_price: "100",
    });

    const fee = await calculateFees(action, trade, account);

    expect(fee).toBeCloseTo((200 * CRYPTO_TIER1_TAKER_BPS) / 10_000, 10);
  });

  it("falls back to the order's dollar notional when filled_qty is 0 (fractional order)", async () => {
    getOrderMock.mockResolvedValueOnce({
      asset_class: "us_equity",
      side: "sell",
      filled_qty: "0",
      filled_avg_price: null,
      notional: "1000",
    });

    const fee = await calculateFees(action, trade, account);

    // SEC applies to the notional; TAF is per-share and no shares are known.
    expect(fee).toBeCloseTo(1000 * SEC_FEE_PER_USD, 10);
  });

  it("returns 0 when the action has no linked order id", async () => {
    await expect(
      calculateFees(actionWithoutOrder, trade, account),
    ).resolves.toBe(0);
    expect(getOrderMock).not.toHaveBeenCalled();
  });

  it("returns 0 when the order cannot be found or nothing filled", async () => {
    getOrderMock.mockResolvedValueOnce(null);
    await expect(calculateFees(action, trade, account)).resolves.toBe(0);

    getOrderMock.mockResolvedValueOnce({
      asset_class: "us_equity",
      side: "sell",
      filled_qty: "0",
      filled_avg_price: null,
    });
    await expect(calculateFees(action, trade, account)).resolves.toBe(0);
  });
});
