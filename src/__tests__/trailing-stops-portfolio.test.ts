/**
 * Pins portfolio-wide trailing stop coverage: every position in the book gets
 * a stop on the side that actually closes it, derived from the broker's signed
 * quantity. A position left unprotected because of the direction it happens to
 * hold is an unbounded loss, not a skipped row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logging", () => ({
  log: vi.fn(),
}));

import {
  ALPACA_MAX_TRAIL_PERCENT,
  createPortfolioTrailingStops,
} from "../alpaca/trading/trailing-stops";
import { AlpacaPosition } from "../types/alpaca-types";

/** The client surface `createPortfolioTrailingStops` actually consumes. */
type TrailingStopClient = Parameters<typeof createPortfolioTrailingStops>[0];

const getPositionsMock = vi.fn();
const createOrderMock = vi.fn();

const client = {
  getSDK: () => ({
    getPositions: getPositionsMock,
    createOrder: createOrderMock,
  }),
} as unknown as TrailingStopClient;

function position(symbol: string, qty: string): AlpacaPosition {
  return {
    asset_id: `asset-${symbol}`,
    symbol,
    exchange: "NASDAQ",
    asset_class: "us_equity",
    asset_marginable: true,
    qty,
    qty_available: qty,
    avg_entry_price: "100",
    side: parseFloat(qty) >= 0 ? "long" : "short",
    market_value: "100",
    cost_basis: "100",
    unrealized_pl: "0",
    unrealized_plpc: "0",
    unrealized_intraday_pl: "0",
    unrealized_intraday_plpc: "0",
    current_price: "100",
    lastday_price: "100",
    change_today: "0",
  };
}

/** The order params handed to the SDK for the nth submission. */
function submitted(callIndex: number): Record<string, unknown> {
  return createOrderMock.mock.calls[callIndex][0] as Record<string, unknown>;
}

describe("createPortfolioTrailingStops", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createOrderMock.mockImplementation((params: { symbol: string }) =>
      Promise.resolve({
        id: `order-${params.symbol}`,
        status: "new",
        hwm: null,
      }),
    );
  });

  it("protects a short position with a buy-side trail", async () => {
    getPositionsMock.mockResolvedValue([position("TSLA", "-50")]);

    const results = await createPortfolioTrailingStops(client, {
      trailPercent: 3,
    });

    expect(results.size).toBe(1);
    expect(createOrderMock).toHaveBeenCalledTimes(1);
    expect(submitted(0)).toMatchObject({
      symbol: "TSLA",
      side: "buy",
      qty: 50,
      type: "trailing_stop",
    });
  });

  it("protects a long position with a sell-side trail", async () => {
    getPositionsMock.mockResolvedValue([position("AAPL", "100")]);

    const results = await createPortfolioTrailingStops(client, {
      trailPercent: 3,
    });

    expect(results.size).toBe(1);
    expect(submitted(0)).toMatchObject({
      symbol: "AAPL",
      side: "sell",
      qty: 100,
      type: "trailing_stop",
    });
  });

  it("covers a mixed book, leaving neither side unprotected", async () => {
    getPositionsMock.mockResolvedValue([
      position("AAPL", "100"),
      position("TSLA", "-50"),
    ]);

    const results = await createPortfolioTrailingStops(client, {
      trailPercent: 3,
    });

    expect(results.size).toBe(2);
    expect(new Set([...results.keys()])).toEqual(new Set(["AAPL", "TSLA"]));
    expect(submitted(0)).toMatchObject({ symbol: "AAPL", side: "sell" });
    expect(submitted(1)).toMatchObject({ symbol: "TSLA", side: "buy" });
  });

  it("submits the absolute quantity for a short, never a negative one", async () => {
    getPositionsMock.mockResolvedValue([position("NVDA", "-25")]);

    await createPortfolioTrailingStops(client, { trailPercent: 2 });

    expect(submitted(0).qty).toBe(25);
  });

  it("skips a position whose quantity is not a usable number", async () => {
    getPositionsMock.mockResolvedValue([
      position("FLAT", "0"),
      position("JUNK", "not-a-number"),
    ]);

    const results = await createPortfolioTrailingStops(client, {
      trailPercent: 3,
    });

    expect(results.size).toBe(0);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("still honours the exclusion list on both sides of the book", async () => {
    getPositionsMock.mockResolvedValue([
      position("AAPL", "100"),
      position("TSLA", "-50"),
    ]);

    const results = await createPortfolioTrailingStops(client, {
      trailPercent: 3,
      excludeSymbols: ["TSLA"],
    });

    expect([...results.keys()]).toEqual(["AAPL"]);
  });

  it("keeps protecting the rest of the book when one submission fails", async () => {
    getPositionsMock.mockResolvedValue([
      position("AAPL", "100"),
      position("TSLA", "-50"),
    ]);
    createOrderMock.mockImplementationOnce(() =>
      Promise.reject(new Error("broker rejected")),
    );

    const results = await createPortfolioTrailingStops(client, {
      trailPercent: 3,
    });

    expect([...results.keys()]).toEqual(["TSLA"]);
  });

  it("rejects a trail percent above the broker ceiling before submitting anything", async () => {
    // A looser outer bound would let every per-position submission be
    // rejected downstream, leaving the whole book unprotected while the
    // summary reported only failures.
    getPositionsMock.mockResolvedValue([position("AAPL", "100")]);

    await expect(
      createPortfolioTrailingStops(client, {
        trailPercent: ALPACA_MAX_TRAIL_PERCENT + 5,
      }),
    ).rejects.toThrow(/cannot exceed 25/);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive trail percent", async () => {
    await expect(
      createPortfolioTrailingStops(client, { trailPercent: 0 }),
    ).rejects.toThrow(/greater than 0/);
  });
});
