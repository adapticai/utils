/**
 * Pins the fee/expense plumbing in performance-metrics (U01-utils-lib-08 +
 * test-gap): fetchTrailingFeeExpenses id-based pagination over
 * /account/activities, the calculateExpenseRatio zero/negative-equity guard
 * ("N/A", never "Infinity%"/"NaN%"), and fetchBenchmarkBars' RFC-3339 →
 * Unix-second mapping with non-finite row filtering.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@adaptic/backend-legacy", () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
  },
  types: {},
}));

const fetchAccountDetailsMock = vi.fn();
const makeRequestMock = vi.fn();
vi.mock("../alpaca/legacy", () => ({
  fetchAccountDetails: (...args: unknown[]) => fetchAccountDetailsMock(...args),
  fetchPortfolioHistory: vi.fn(),
  makeRequest: (...args: unknown[]) => makeRequestMock(...args),
}));

vi.mock("../adaptic", () => ({
  getSharedApolloClient: vi.fn(),
}));

const getHistoricalBarsMock = vi.fn();
vi.mock("../alpaca-market-data-api", () => ({
  marketDataAPI: {
    getHistoricalBars: (...args: unknown[]) => getHistoricalBarsMock(...args),
  },
}));

import {
  calculateExpenseRatio,
  fetchTrailingFeeExpenses,
  fetchBenchmarkBars,
} from "../performance-metrics";

/** Page size the implementation requests from /account/activities. */
const PAGE_SIZE = 100;

function feeActivity(id: string, netAmount: string): Record<string, string> {
  return { id, activity_type: "FEE", net_amount: netAmount };
}

describe("fetchTrailingFeeExpenses", () => {
  beforeEach(() => {
    makeRequestMock.mockReset();
  });

  it("sums |net_amount| across pages and cursors page_token from the last id of the prior page", async () => {
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) =>
      feeActivity(`act-${i}`, "-0.50"),
    );
    const partialPage = [feeActivity("act-final", "-2.25")];
    makeRequestMock
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(partialPage);

    const total = await fetchTrailingFeeExpenses({
      adapticAccountId: "acct-1",
    });

    expect(total).toBeCloseTo(PAGE_SIZE * 0.5 + 2.25, 10);
    expect(makeRequestMock).toHaveBeenCalledTimes(2);

    const secondCall = makeRequestMock.mock.calls[1][1] as {
      queryString: string;
    };
    expect(secondCall.queryString).toContain(
      `page_token=act-${PAGE_SIZE - 1}`,
    );
    expect(secondCall.queryString).toContain("activity_types=FEE%2CREG%2CCFEE");
  });

  it("stops at the first partial page and skips non-numeric net_amount rows", async () => {
    makeRequestMock.mockResolvedValueOnce([
      feeActivity("a", "-1.00"),
      { id: "b", activity_type: "FEE" },
      feeActivity("c", "not-a-number"),
    ]);

    const total = await fetchTrailingFeeExpenses({
      adapticAccountId: "acct-1",
    });

    expect(total).toBeCloseTo(1.0, 10);
    expect(makeRequestMock).toHaveBeenCalledTimes(1);
  });
});

describe("calculateExpenseRatio equity guard", () => {
  beforeEach(() => {
    fetchAccountDetailsMock.mockReset();
    makeRequestMock.mockReset();
  });

  it.each([["0"], ["-500"], ["not-a-number"]])(
    'returns "N/A" instead of dividing by equity %s',
    async (equity: string) => {
      fetchAccountDetailsMock.mockResolvedValueOnce({ equity });

      const ratio = await calculateExpenseRatio({ accountId: "acct-1" });

      expect(ratio).toBe("N/A");
      // The guard must fire before any fee fetch is attempted.
      expect(makeRequestMock).not.toHaveBeenCalled();
    },
  );

  it("computes the ratio for positive finite equity", async () => {
    fetchAccountDetailsMock.mockResolvedValueOnce({ equity: "100000" });
    makeRequestMock.mockResolvedValueOnce([feeActivity("a", "-250")]);

    const ratio = await calculateExpenseRatio({ accountId: "acct-1" });

    expect(ratio).toBe("0.25%");
  });
});

describe("fetchBenchmarkBars", () => {
  beforeEach(() => {
    getHistoricalBarsMock.mockReset();
  });

  it("maps RFC-3339 bar timestamps to Unix seconds and drops non-finite rows", async () => {
    getHistoricalBarsMock.mockResolvedValueOnce({
      bars: {
        SPY: [
          { t: "2026-08-06T14:30:00Z", c: 500.1 },
          { t: "not-a-date", c: 501.0 },
          { t: "2026-08-06T14:31:00Z", c: Number.NaN },
        ],
      },
    });

    const bars = await fetchBenchmarkBars({
      symbol: "SPY",
      start: "2026-08-06T14:30:00Z",
      end: "2026-08-06T21:00:00Z",
      timeframe: "1D",
    });

    expect(bars).toEqual([
      { t: Math.floor(Date.parse("2026-08-06T14:30:00Z") / 1000), c: 500.1 },
    ]);
  });

  it("returns an empty array when the vendor returns no bars for the symbol", async () => {
    getHistoricalBarsMock.mockResolvedValueOnce({ bars: {} });

    await expect(
      fetchBenchmarkBars({
        symbol: "SPY",
        start: "2026-08-06T14:30:00Z",
        end: "2026-08-06T21:00:00Z",
        timeframe: "1D",
      }),
    ).resolves.toEqual([]);
  });
});
