/**
 * Pins the trailing-stop replace-unit contract. Alpaca's replace `trail` field
 * is unitless and the broker reads it in the resting order's unit, so a dollar
 * distance sent to a percent-trail order must be converted (never looser than
 * `live ∓ distance`), a percent sent to a dollar-trail order is refused, and an
 * order whose unit cannot be read is refused without a replace.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../logging", () => ({
  log: vi.fn(),
}));

import { updateTrailingStop } from "../trailing-stops";
import { TrailUnitConversionRefusedError, resolveReplaceTrail } from "../trail-unit";

type TrailingStopClient = Parameters<typeof updateTrailingStop>[0];

const getOrderMock = vi.fn();
const replaceOrderMock = vi.fn();

const client = {
  getSDK: () => ({
    getOrder: getOrderMock,
    replaceOrder: replaceOrderMock,
  }),
} as unknown as TrailingStopClient;

interface RestingOrderShape {
  trail_percent: string | null;
  trail_price: string | null;
  hwm: string | null;
  stop_price: string | null;
  side: "buy" | "sell";
}

function resting(shape: RestingOrderShape): Record<string, unknown> {
  return { id: "ord-1", type: "trailing_stop", status: "new", ...shape };
}

/** The `trail` value handed to the broker replace. */
function sentTrail(): string {
  expect(replaceOrderMock).toHaveBeenCalledTimes(1);
  const [orderId, params] = replaceOrderMock.mock.calls[0] as [string, Record<string, string>];
  expect(orderId).toBe("ord-1");
  return params.trail;
}

async function refusal(promise: Promise<unknown>): Promise<TrailUnitConversionRefusedError> {
  const outcome = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(TrailUnitConversionRefusedError);
  return outcome as TrailUnitConversionRefusedError;
}

describe("updateTrailingStop replace-unit contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaceOrderMock.mockResolvedValue({ id: "ord-2", replaces: "ord-1" });
  });

  it("(a) converts a dollar distance on a percent-trail long order to a percent, not dollars-as-percent", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "2.3", trail_price: null, hwm: "963.54", stop_price: "941.38", side: "sell" }),
    );

    await updateTrailingStop(client, "ord-1", { trailPrice: 19.26 });

    const trail = sentTrail();
    expect(trail).toBe("1.99");
    expect(trail).not.toBe("19.26");
  });

  it("(a2) a LITE-shaped floor ($22.28 off 963.54) lands at 2.31%, not a 22.28% trail", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "2.3", trail_price: null, hwm: "963.54", stop_price: "941.38", side: "sell" }),
    );

    await updateTrailingStop(client, "ord-1", { trailPrice: 963.54 - 941.26 });

    expect(sentTrail()).toBe("2.31");
  });

  it("(b) converts a short's dollar distance against max(hwm, stop_price), never looser than live + D", async () => {
    const live = 90;
    const distance = 2;
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "3", trail_price: null, hwm: "88", stop_price: "92.5", side: "buy" }),
    );

    await updateTrailingStop(client, "ord-1", { trailPrice: distance });

    const pct = Number(sentTrail());
    // ref = stop_price 92.5 (above the trough HWM), so pct = floor(2/92.5 %).
    expect(pct).toBe(2.16);
    const impliedStop = live * (1 + pct / 100);
    expect(impliedStop).toBeLessThanOrEqual(live + distance);
  });

  it("(c) refuses a conversion above the broker's 25% cap, sending no replace", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "5", trail_price: null, hwm: "120", stop_price: "114", side: "sell" }),
    );

    const error = await refusal(updateTrailingStop(client, "ord-1", { trailPrice: 31.33 }));

    expect(error.reason).toBe("converted_percent_out_of_range");
    expect(error.orderId).toBe("ord-1");
    expect(error.ref).toBe(120);
    expect(error.pct).toBeGreaterThan(25);
    expect(replaceOrderMock).not.toHaveBeenCalled();
  });

  it("(c2) refuses a conversion below the 0.1% floor, sending no replace", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "1", trail_price: null, hwm: "90", stop_price: "89.1", side: "sell" }),
    );

    const error = await refusal(updateTrailingStop(client, "ord-1", { trailPrice: 0.05 }));

    expect(error.reason).toBe("converted_percent_out_of_range");
    expect(error.pct).toBeLessThan(0.1);
    expect(replaceOrderMock).not.toHaveBeenCalled();
  });

  it("(c2a) the default-path refusal says whether the opt-in clamp would have sent it", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "1", trail_price: null, hwm: "90", stop_price: "89.1", side: "sell" }),
    );

    const error = await refusal(updateTrailingStop(client, "ord-1", { trailPrice: 0.081 }));

    expect(error.reason).toBe("converted_percent_out_of_range");
    expect(error.pct).toBe(0.09);
    expect(error.subFloorClampEligible).toBe(true);
    expect(replaceOrderMock).not.toHaveBeenCalled();
  });

  it("(c3) opted in, a tightening conversion below the 0.1% floor is sent AT the floor", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "1", trail_price: null, hwm: "90", stop_price: "89.1", side: "sell" }),
    );

    await updateTrailingStop(client, "ord-1", { trailPrice: 0.081 }, { subFloorClamp: true });

    expect(sentTrail()).toBe("0.10");
  });

  it("(c3b) opted in, the clamp reports the percent the caller's distance converted to", () => {
    const resolved = resolveReplaceTrail(
      "ord-1",
      { trail_percent: "1", trail_price: null, hwm: "90", stop_price: "89.1" },
      { trailPrice: 0.081 },
      { subFloorClamp: true },
    );

    expect(resolved).toStrictEqual({ trail: "0.10", unit: "percent", referencePrice: 90, clampedFromPercent: 0.09 });
  });

  it("(c3c) opted in, an order already trailing at the floor is still refused (the clamp would not tighten it)", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "0.1", trail_price: null, hwm: "90", stop_price: "89.91", side: "sell" }),
    );

    const error = await refusal(updateTrailingStop(client, "ord-1", { trailPrice: 0.05 }, { subFloorClamp: true }));

    expect(error.reason).toBe("converted_percent_out_of_range");
    expect(error.subFloorClampEligible).toBe(false);
    expect(replaceOrderMock).not.toHaveBeenCalled();
  });

  it("(c3d) opted in, a non-positive distance is never clamped", () => {
    expect(() =>
      resolveReplaceTrail(
        "ord-1",
        { trail_percent: "1", trail_price: null, hwm: "90", stop_price: "89.1" },
        { trailPrice: 0 },
        { subFloorClamp: true },
      ),
    ).toThrow(TrailUnitConversionRefusedError);
  });

  it("(c3e) no-op: an in-range conversion resolves to the identical object with the option off or on", () => {
    const order = { trail_percent: "2.3", trail_price: null, hwm: "963.54", stop_price: "941.38" };
    const expected = { trail: "1.99", unit: "percent", referencePrice: 963.54 };

    expect(resolveReplaceTrail("ord-1", order, { trailPrice: 19.26 })).toStrictEqual(expected);
    expect(resolveReplaceTrail("ord-1", order, { trailPrice: 19.26 }, { subFloorClamp: false })).toStrictEqual(expected);
    expect(resolveReplaceTrail("ord-1", order, { trailPrice: 19.26 }, { subFloorClamp: true })).toStrictEqual(expected);
  });

  it("(d) no-op: a dollar distance on a dollar-trail order is sent byte-identical to the prior path", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: null, trail_price: "4.5", hwm: "963.54", stop_price: "959.04", side: "sell" }),
    );
    const trailPrice = 19.26;

    await updateTrailingStop(client, "ord-1", { trailPrice });

    // Prior path: `replaceParams.trail = updates.trailPrice.toString()`.
    expect(sentTrail()).toBe(trailPrice.toString());
    expect(replaceOrderMock.mock.calls[0][1]).toEqual({ trail: "19.26" });
  });

  it("(d2) no-op: a percent on a percent-trail order is sent byte-identical to the prior path", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "2.3", trail_price: null, hwm: "100", stop_price: "97.7", side: "sell" }),
    );

    await updateTrailingStop(client, "ord-1", { trailPercent: 1.5 });

    expect(replaceOrderMock.mock.calls[0][1]).toEqual({ trail: (1.5).toString() });
  });

  it("(e) refuses when the resting order carries no unit, sending no replace", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: null, trail_price: null, hwm: "100", stop_price: "97", side: "sell" }),
    );

    const error = await refusal(updateTrailingStop(client, "ord-1", { trailPrice: 2 }));

    expect(error.reason).toBe("unit_unknown");
    expect(replaceOrderMock).not.toHaveBeenCalled();
  });

  it("(e2) refuses a percent-order conversion with no finite hwm or stop_price, never defaulting ref", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: "2", trail_price: null, hwm: null, stop_price: "NaN", side: "sell" }),
    );

    const error = await refusal(updateTrailingStop(client, "ord-1", { trailPrice: 2 }));

    expect(error.reason).toBe("reference_unavailable");
    expect(error.ref).toBeNull();
    expect(replaceOrderMock).not.toHaveBeenCalled();
  });

  it("(f) mirror: refuses a percent sent to a dollar-trail order rather than storing it as dollars", async () => {
    getOrderMock.mockResolvedValue(
      resting({ trail_percent: null, trail_price: "4.5", hwm: "963.54", stop_price: "959.04", side: "sell" }),
    );

    const error = await refusal(updateTrailingStop(client, "ord-1", { trailPercent: 2.3 }));

    expect(error.reason).toBe("percent_on_price_order");
    expect(replaceOrderMock).not.toHaveBeenCalled();
  });

  it("propagates an order-read failure without replacing", async () => {
    getOrderMock.mockRejectedValue(new Error("Request failed with status code 404"));

    await expect(updateTrailingStop(client, "ord-1", { trailPrice: 2 })).rejects.toThrow(
      /Failed to read trailing stop ord-1 before update/,
    );
    expect(replaceOrderMock).not.toHaveBeenCalled();
  });
});
