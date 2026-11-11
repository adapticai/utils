/**
 * The simplified news shape carries Alpaca's own article id.
 *
 * A consumer that joins a fetched article to a store keyed by the vendor's id
 * (the engine's news-sentiment score cache keys `alpaca:<id>:<symbol>`) can
 * only do so when the id survives the simplification. Without it the consumer
 * falls back to a key of its own, and that key matches no stored row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ws", () => ({
  default: class MockWebSocket {
    static readonly OPEN = 1;
  },
}));

vi.mock("../logging", () => ({
  log: vi.fn(),
}));

vi.mock("../rate-limiter", () => ({
  rateLimiters: {
    alpaca: {
      acquire: (): Promise<void> => Promise.resolve(),
    },
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { marketDataAPI } from "../alpaca-market-data-api";
import { articleIdOf } from "../alpaca/news-article-id";

/** One article as Alpaca's news endpoint returns it. */
function vendorArticle(id: number): Record<string, unknown> {
  return {
    id,
    author: "Desk",
    content: "",
    created_at: "2026-11-10T19:54:54Z",
    updated_at: "2026-11-10T19:55:10Z",
    headline: `Headline ${String(id)}`,
    source: "benzinga",
    summary: "Summary",
    url: `https://example.test/${String(id)}`,
    symbols: ["SPY", "AAPL"],
    images: [],
  };
}

describe("articleIdOf", () => {
  it("carries a whole-number vendor id", () => {
    expect(articleIdOf({ id: 63117154 })).toEqual({ id: 63117154 });
  });

  it("leaves the field absent for an id that is not a whole number", () => {
    for (const id of [undefined, null, "63117154", Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      const field = articleIdOf({ id });
      expect(field).toEqual({});
      expect(Object.hasOwn(field, "id")).toBe(false);
    }
  });
});

describe("AlpacaMarketDataAPI.fetchNews", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns every article with the vendor's own id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ news: [vendorArticle(63117154), vendorArticle(63113931)], next_page_token: null }),
    });

    const news = await marketDataAPI.fetchNews("SPY", { limit: 20 });

    expect(news.map((article) => article.id)).toEqual([63117154, 63113931]);
    expect(news[0]?.symbols).toEqual(["SPY", "AAPL"]);
  });
});
