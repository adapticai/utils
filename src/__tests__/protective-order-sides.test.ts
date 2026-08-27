/**
 * Pins the side handling on the protective order helpers: the entry direction
 * must be stated by the caller rather than defaulted, and a protective bracket
 * must be constructible — and correctly validated — for a short as well as a
 * long. Both helpers compute every price off the side, so a substituted one
 * places the protection on the wrong side of the position.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logging", () => ({
  log: vi.fn(),
}));

import { log } from "../logging";
import { entryWithPercentStopLoss } from "../alpaca/trading/oto-orders";
import {
  createProtectiveBracket,
  ProtectiveBracketParams,
} from "../alpaca/trading/bracket-orders";
import { AlpacaOrder, OrderSide } from "../types/alpaca-types";

/** The client surface `entryWithPercentStopLoss` actually consumes. */
type OTOClient = Parameters<typeof entryWithPercentStopLoss>[0];

const createOrderMock = vi.fn();

const otoClient = {
  getSDK: () => ({ createOrder: createOrderMock }),
} as unknown as OTOClient;

const bracketExecutor = {
  createOrder: (params: unknown) =>
    createOrderMock(params) as Promise<AlpacaOrder>,
};

/** The order request handed downstream for the nth submission. */
function submitted(callIndex: number): Record<string, unknown> {
  return createOrderMock.mock.calls[callIndex][0] as Record<string, unknown>;
}

function warnings(): string[] {
  return vi
    .mocked(log)
    .mock.calls.filter((call) => call[1]?.type === "warn")
    .map((call) => call[0]);
}

function bracketParams(
  side: OrderSide,
  takeProfitPrice: number,
  stopPrice: number,
): ProtectiveBracketParams {
  return {
    symbol: "TSLA",
    qty: 50,
    side,
    takeProfit: { limitPrice: takeProfitPrice },
    stopLoss: { stopPrice },
    timeInForce: "gtc",
  };
}

describe("entryWithPercentStopLoss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createOrderMock.mockResolvedValue({
      id: "parent-order",
      status: "new",
      legs: [{ id: "stop-leg", type: "stop" }],
    });
  });

  it("refuses to open a position when no side is supplied", async () => {
    // Every price below is computed off `side`. Without one the direction is
    // unknown, and an entry is not a safe thing to guess at.
    await expect(
      entryWithPercentStopLoss(
        otoClient,
        "AAPL",
        100,
        150,
        3,
        undefined as unknown as OrderSide,
      ),
    ).rejects.toThrow(/requires an explicit side/);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("refuses a side that is neither buy nor sell", async () => {
    await expect(
      entryWithPercentStopLoss(
        otoClient,
        "AAPL",
        100,
        150,
        3,
        "long" as unknown as OrderSide,
      ),
    ).rejects.toThrow(/requires an explicit side/);
  });

  it("places a long's stop below the entry", async () => {
    await entryWithPercentStopLoss(otoClient, "AAPL", 100, 150, 3, "buy");

    expect(submitted(0)).toMatchObject({ side: "buy" });
    expect(submitted(0).stop_loss).toMatchObject({ stop_price: "145.5" });
  });

  it("places a short's stop above the entry, the same distance away", async () => {
    await entryWithPercentStopLoss(otoClient, "GOOGL", 10, 150, 3, "sell");

    expect(submitted(0)).toMatchObject({ side: "sell" });
    expect(submitted(0).stop_loss).toMatchObject({ stop_price: "154.5" });
  });
});

describe("createProtectiveBracket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createOrderMock.mockResolvedValue({
      id: "bracket-order",
      status: "new",
      legs: [{ id: "stop-leg", type: "stop" }],
    });
  });

  it("protects a short position with a buy-side bracket", async () => {
    await createProtectiveBracket(bracketExecutor, bracketParams("buy", 200, 260));

    expect(submitted(0)).toMatchObject({
      symbol: "TSLA",
      side: "buy",
      order_class: "oco",
      limit_price: "200",
    });
    expect(submitted(0).stop_loss).toMatchObject({ stop_price: "260" });
  });

  it("protects a long position with a sell-side bracket", async () => {
    await createProtectiveBracket(
      bracketExecutor,
      bracketParams("sell", 260, 200),
    );

    expect(submitted(0)).toMatchObject({ side: "sell", limit_price: "260" });
    expect(submitted(0).stop_loss).toMatchObject({ stop_price: "200" });
  });

  it("accepts a correctly ordered short bracket without warning", async () => {
    // Buying to close a short takes profit below and stops above. Judged by
    // the long's ordering this would look inverted; it is not.
    await createProtectiveBracket(bracketExecutor, bracketParams("buy", 200, 260));

    expect(warnings()).toEqual([]);
  });

  it("warns when a short bracket's take profit sits above its stop", async () => {
    await createProtectiveBracket(bracketExecutor, bracketParams("buy", 260, 200));

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/lower than stop loss price/);
  });

  it("warns when a long bracket's take profit sits below its stop", async () => {
    await createProtectiveBracket(
      bracketExecutor,
      bracketParams("sell", 200, 260),
    );

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/higher than stop loss price/);
  });

  it("accepts a correctly ordered long bracket without warning", async () => {
    await createProtectiveBracket(
      bracketExecutor,
      bracketParams("sell", 260, 200),
    );

    expect(warnings()).toEqual([]);
  });

  it("refuses a bracket with no side", async () => {
    await expect(
      createProtectiveBracket(
        bracketExecutor,
        bracketParams(undefined as unknown as OrderSide, 260, 200),
      ),
    ).rejects.toThrow(/requires a side of 'buy' or 'sell'/);
    expect(createOrderMock).not.toHaveBeenCalled();
  });
});
