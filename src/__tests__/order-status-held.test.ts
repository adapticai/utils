/**
 * Pins Alpaca's `held` order status through every place this package names
 * order statuses: the `OrderStatus` union, the runtime order schema, and the
 * open/fillable/terminal helpers.
 *
 * A held order is a conditional leg resting at the broker — the stop-loss of a
 * bracket or OTO before its trigger. It is the position's protection. A schema
 * that rejects it makes a protected position's order book unreadable, and a
 * helper that calls it neither open nor terminal reports the protection as
 * absent.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../logging", () => ({
  log: vi.fn(),
}));

import {
  isOrderFillable,
  isOrderOpen,
  isOrderTerminal,
} from "../alpaca/trading/order-utils";
import { AlpacaOrderSchema } from "../schemas/alpaca-schemas";
import type { AlpacaOrder, OrderStatus } from "../types/alpaca-types";

/** The status under test, typed through the union so a union without it fails to compile. */
const HELD: OrderStatus = "held";

/** A bracket stop-loss leg as Alpaca returns it while its parent is still working. */
const heldStopLeg = {
  id: "leg-stop-1",
  client_order_id: "client-leg-stop-1",
  created_at: "2026-09-23T13:30:00Z",
  updated_at: "2026-09-23T13:30:00Z",
  submitted_at: "2026-09-23T13:30:00Z",
  filled_at: null,
  expired_at: null,
  canceled_at: null,
  failed_at: null,
  replaced_at: null,
  replaced_by: null,
  replaces: null,
  asset_id: "asset-1",
  symbol: "XLE",
  asset_class: "us_equity",
  notional: null,
  qty: "1145",
  filled_qty: "0",
  filled_avg_price: null,
  order_class: "bracket",
  type: "stop",
  side: "sell",
  time_in_force: "gtc",
  limit_price: null,
  stop_price: "88.10",
  trail_price: null,
  trail_percent: null,
  hwm: null,
  position_intent: "sell_to_close",
  status: HELD,
  extended_hours: false,
  legs: null,
};

describe("Alpaca's held order status", () => {
  it("is accepted by the runtime order schema, alone and as a bracket leg", () => {
    expect(AlpacaOrderSchema.safeParse(heldStopLeg).success).toBe(true);

    const bracketParent = {
      ...heldStopLeg,
      id: "parent-1",
      type: "limit",
      side: "buy",
      limit_price: "90.00",
      stop_price: null,
      position_intent: "buy_to_open",
      status: "new",
      legs: [heldStopLeg],
    };
    expect(AlpacaOrderSchema.safeParse(bracketParent).success).toBe(true);
  });

  it("still rejects a status Alpaca does not send", () => {
    expect(AlpacaOrderSchema.safeParse({ ...heldStopLeg, status: "hold" }).success).toBe(false);
  });

  it("counts as an open, fillable, non-terminal order", () => {
    const order = heldStopLeg as unknown as AlpacaOrder;
    expect(isOrderOpen(order)).toBe(true);
    expect(isOrderFillable(order)).toBe(true);
    expect(isOrderTerminal(order)).toBe(false);
  });
});
