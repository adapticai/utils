/**
 * Pins direction handling in metrics-calcs: max drawdown must measure a short's
 * adverse excursion rather than discard it, and a trade whose direction cannot
 * be resolved must report its direction-aware metrics as unavailable rather
 * than resolve them as a long.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@adaptic/backend-legacy", () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
  },
  types: {},
}));

const computeTotalFeesMock = vi.fn();
vi.mock("../price-utils", () => ({
  computeTotalFees: (...args: unknown[]) => computeTotalFeesMock(...args),
}));

const getRiskFreeRateMock = vi.fn();
vi.mock("../risk-free-rate", () => ({
  getRiskFreeRate: (...args: unknown[]) => getRiskFreeRateMock(...args),
}));

import fetchTradeMetrics, { calculateMaxDrawdown } from "../metrics-calcs";
import { types } from "@adaptic/backend-legacy";
import { Bar, BenchmarkBar } from "../types/alpaca-types";

/** Closing prices whose long drawdown and short drawdown are both non-trivial. */
const RISING_THEN_FADING = [100, 110, 125, 150, 140];

function tradeBars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    t: `2025-01-${String(i + 2).padStart(2, "0")}T00:00:00Z`,
    o: close,
    h: close,
    l: close,
    c: close,
    v: 1_000_000,
    n: 100,
    vw: close,
  }));
}

function benchmarkBars(closes: number[]): BenchmarkBar[] {
  return closes.map((close, i) => ({
    t: Date.parse(`2025-01-${String(i + 2).padStart(2, "0")}T00:00:00Z`) / 1000,
    c: close,
  }));
}

function tradeWithActions(
  actions: Array<{ primary: boolean; type: string }> | undefined,
): types.Trade {
  return {
    id: "trade-under-test",
    alpacaAccountId: "account-under-test",
    actions,
  } as unknown as types.Trade;
}

describe("calculateMaxDrawdown", () => {
  it("measures a short's drawdown instead of collapsing it to zero", async () => {
    // The short branch negates equity, so its running peak is negative. A
    // sign test on that peak discards every decline; the magnitude does not.
    // Peak -100 to trough -150 is a 50% adverse excursion for the short.
    await expect(calculateMaxDrawdown(tradeBars(RISING_THEN_FADING), true)).resolves.toBe(
      "50.00%",
    );
  });

  it("still measures a long's drawdown from its running peak", async () => {
    // Peak 150 down to 140 is 6.67% — the long limb is unchanged.
    await expect(
      calculateMaxDrawdown(tradeBars(RISING_THEN_FADING), false),
    ).resolves.toBe("6.67%");
  });

  it("tracks the short's running best price rather than freezing on the first bar", async () => {
    // Negated equity makes the running peak the lowest price seen so far, so
    // the drawdown is the worst rise off that low: 100 -> 110 is 10%. Only a
    // magnitude-scaled denominator lets that peak advance at all.
    await expect(
      calculateMaxDrawdown(tradeBars([150, 140, 125, 100, 110]), true),
    ).resolves.toBe("10.00%");
  });

  it("measures each side's decline off its own favourable extreme", async () => {
    // The two sides are mirrored in construction but not in denominator: a
    // short's favourable extreme is the lowest price (100) and a long's is the
    // highest (150), so the same 50-point adverse move is 50% against the
    // short and 33.33% against the long. Both are real; neither is zero.
    const series = tradeBars([100, 110, 125, 150, 140]);
    const descending = tradeBars([150, 140, 125, 100, 110]);

    await expect(calculateMaxDrawdown(series, true)).resolves.toBe("50.00%");
    await expect(calculateMaxDrawdown(descending, false)).resolves.toBe(
      "33.33%",
    );
  });

  it("returns zero rather than dividing when the peak is exactly zero", async () => {
    await expect(calculateMaxDrawdown(tradeBars([0, -5, -10]), false)).resolves.toBe(
      "0.00%",
    );
  });

  it("reports N/A when there are no bars to measure", async () => {
    await expect(calculateMaxDrawdown([], true)).resolves.toBe("N/A");
  });
});

describe("fetchTradeMetrics direction resolution", () => {
  const bars = tradeBars(RISING_THEN_FADING);
  const benchmark = benchmarkBars([200, 205, 210, 215, 212]);

  beforeEach(() => {
    vi.clearAllMocks();
    computeTotalFeesMock.mockResolvedValue(1.5);
    getRiskFreeRateMock.mockResolvedValue(0.04);
  });

  it("resolves a primary SELL as short", async () => {
    const metrics = await fetchTradeMetrics(
      tradeWithActions([{ primary: true, type: "SELL" }]),
      bars,
      benchmark,
    );

    expect(metrics.side).toBe("short");
    // A short in this rising series lost: the return carries the short's sign.
    expect(metrics.totalReturnYTD).toBe("-40.00%");
    expect(metrics.maxDrawdown).toBe("50.00%");
  });

  it("resolves a primary BUY as long", async () => {
    const metrics = await fetchTradeMetrics(
      tradeWithActions([{ primary: true, type: "BUY" }]),
      bars,
      benchmark,
    );

    expect(metrics.side).toBe("long");
    expect(metrics.totalReturnYTD).toBe("40.00%");
    expect(metrics.maxDrawdown).toBe("6.67%");
  });

  it("reports N/A rather than long when actions are absent", async () => {
    // `trade.actions` is curated by backend-legacy selection-set directives,
    // so its absence is routine — and must never be read as a direction.
    const metrics = await fetchTradeMetrics(
      tradeWithActions(undefined),
      bars,
      benchmark,
    );

    expect(metrics.side).toBe("N/A");
    expect(metrics.totalReturnYTD).toBe("N/A");
    expect(metrics.alpha).toBe("N/A");
    expect(metrics.beta).toBe("N/A");
    expect(metrics.alphaAnnualized).toBe("N/A");
    expect(metrics.informationRatio).toBe("N/A");
    expect(metrics.maxDrawdown).toBe("N/A");
  });

  it("reports N/A when no action is flagged primary", async () => {
    const metrics = await fetchTradeMetrics(
      tradeWithActions([
        { primary: false, type: "BUY" },
        { primary: false, type: "SELL" },
      ]),
      bars,
      benchmark,
    );

    expect(metrics.side).toBe("N/A");
    expect(metrics.totalReturnYTD).toBe("N/A");
  });

  it("reports N/A for an action type that fixes no long/short direction", async () => {
    const metrics = await fetchTradeMetrics(
      tradeWithActions([{ primary: true, type: "HEDGE" }]),
      bars,
      benchmark,
    );

    expect(metrics.side).toBe("N/A");
    expect(metrics.totalReturnYTD).toBe("N/A");
  });

  it("still reports the direction-agnostic metrics when direction is unresolved", async () => {
    // Fees and the Sharpe ratio do not invert on direction, so withholding
    // them would discard measurements that were never in doubt.
    const metrics = await fetchTradeMetrics(
      tradeWithActions(undefined),
      bars,
      benchmark,
    );

    expect(metrics.expenseRatio).toBe("1.50%");
    expect(metrics.riskAdjustedReturn).not.toBe("N/A");
  });
});
