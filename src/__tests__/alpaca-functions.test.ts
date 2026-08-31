import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing module under test
vi.mock("@adaptic/backend-legacy", () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
    allocation: { update: vi.fn(), create: vi.fn() },
  },
  types: {},
}));

vi.mock("../adaptic", () => ({
  getSharedApolloClient: vi.fn(),
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

vi.mock("../misc-utils", () => ({
  logIfDebug: vi.fn(),
}));

// Must mock fetch globally before imports
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  createOrder,
  getOrders,
  getOrder,
  cancelOrder,
  cancelAllOrders,
  replaceOrder,
  fetchAllPositions,
  fetchPosition,
  closePosition,
  fetchAccountDetails,
  getLatestQuotes,
  getAsset,
  cleanContent,
} from "../alpaca/legacy";
import { getAlpacaBrokerErrorCode, getAlpacaBrokerErrorDetail } from "../errors";
import { AlpacaAuth } from "../types/alpaca-types";

const testAuth: AlpacaAuth = {
  alpacaApiKey: "test-api-key",
  alpacaApiSecret: "test-api-secret",
  type: "PAPER",
};

describe("cleanContent", () => {
  it("should remove HTML tags", () => {
    const result = cleanContent("<p>Hello <b>world</b></p>");
    expect(result).toBe("Hello world");
  });

  it("should remove script tags and their content", () => {
    const result = cleanContent('Hello<script>alert("xss")</script>World');
    expect(result).toBe("HelloWorld");
  });

  it("should remove style tags and their content", () => {
    const result = cleanContent("Hello<style>.red{color:red}</style>World");
    expect(result).toBe("HelloWorld");
  });

  it("should decode HTML entities", () => {
    const result = cleanContent("AT&amp;T said &#8220;hello&#8221;");
    expect(result).toBe('AT&T said "hello"');
  });

  it("should decode hex entities", () => {
    const result = cleanContent("Price is &#x24;100");
    expect(result).toBe("Price is $100");
  });

  it("should normalize whitespace", () => {
    const result = cleanContent("  Hello   World  \n\n  Test  ");
    expect(result).toBe("Hello World Test");
  });

  it("should handle nbsp entities", () => {
    const result = cleanContent("Hello&nbsp;World");
    expect(result).toBe("Hello World");
  });

  it("should remove plus characters", () => {
    const result = cleanContent("Hello+ World");
    expect(result).toBe("Hello World");
  });

  it("should handle empty string", () => {
    const result = cleanContent("");
    expect(result).toBe("");
  });
});

describe("createOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create an order successfully", async () => {
    const mockOrder = {
      id: "order-123",
      symbol: "AAPL",
      qty: "10",
      side: "buy",
      type: "market",
      status: "accepted",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrder),
    });

    const result = await createOrder(testAuth, {
      symbol: "AAPL",
      qty: "10",
      side: "buy",
      type: "market",
      time_in_force: "day",
    });

    expect(result.id).toBe("order-123");
    expect(result.symbol).toBe("AAPL");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should throw on API error, preserving the broker code with a byte-identical message (legacy fetch seam)", async () => {
    // A coded 422 body: the legacy createOrder now throws via alpacaHttpError, so
    // the numeric code rides along on `.response` while the thrown message stays
    // byte-identical (existing "422" string-matching consumers are unaffected).
    const body = JSON.stringify({
      code: 40310000,
      message: "insufficient buying power",
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      text: () => Promise.resolve(body),
    });

    const thrown = await createOrder(testAuth, {
      symbol: "AAPL",
      qty: "10",
      side: "buy",
      type: "market",
      time_in_force: "day",
    }).then(
      () => {
        throw new Error("expected createOrder to reject");
      },
      (e: unknown) => e as Error,
    );

    expect(thrown.message).toBe(
      `Failed to create order: 422 Unprocessable Entity ${body}`,
    );
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(40310000);
  });
});

describe("getOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch orders successfully", async () => {
    const mockOrders = [
      {
        id: "order-1",
        symbol: "AAPL",
        status: "filled",
        submitted_at: "2025-01-10T10:00:00Z",
      },
      {
        id: "order-2",
        symbol: "MSFT",
        status: "filled",
        submitted_at: "2025-01-10T11:00:00Z",
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrders),
    });

    const result = await getOrders(testAuth, { status: "closed" });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("order-1");
  });

  it("should throw on API error, preserving the HTTP status with a byte-identical message (legacy fetch seam)", async () => {
    // A code-less auth body carries no numeric code, but the legacy getOrders now
    // throws via alpacaHttpError so the KNOWN 401 survives on `.response` (a status
    // is itself signal); the thrown message stays byte-identical.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: () => Promise.resolve("Invalid API key"),
    });

    const thrown = await getOrders(testAuth).then(
      () => {
        throw new Error("expected getOrders to reject");
      },
      (e: unknown) => e as Error,
    );

    expect(thrown.message).toBe(
      "Failed to get orders: 401 Unauthorized Invalid API key",
    );
    expect(getAlpacaBrokerErrorDetail(thrown)?.statusCode).toBe(401);
    expect(getAlpacaBrokerErrorCode(thrown)).toBeNull(); // code never fabricated
  });
});

describe("getOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch a specific order", async () => {
    const mockOrder = { id: "order-123", symbol: "AAPL", status: "filled" };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrder),
    });

    const result = await getOrder(testAuth, "order-123");
    expect(result.id).toBe("order-123");
  });
});

describe("cancelOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should cancel an order successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
    });

    const result = await cancelOrder(testAuth, "order-123");
    expect(result.success).toBe(true);
  });

  it("should return failure for 404 order", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("Order not found"),
    });

    const result = await cancelOrder(testAuth, "nonexistent");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Order not found");
  });

  it("should throw on non-404 errors, preserving the HTTP status with a byte-identical message (legacy fetch seam)", async () => {
    // The legacy cancelOrder now throws via alpacaHttpError on non-404 failures,
    // so the KNOWN 500 survives on `.response` while the message stays
    // byte-identical (the 404 branch keeps returning a soft failure, unchanged).
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("Server error"),
    });

    const thrown = await cancelOrder(testAuth, "order-123").then(
      () => {
        throw new Error("expected cancelOrder to reject");
      },
      (e: unknown) => e as Error,
    );

    expect(thrown.message).toBe(
      "Failed to cancel order: 500 Internal Server Error Server error",
    );
    expect(getAlpacaBrokerErrorDetail(thrown)?.statusCode).toBe(500);
  });
});

describe("cancelAllOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should cancel all orders", async () => {
    const mockResult = [{ id: "order-1", status: 200 }];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResult),
    });

    const result = await cancelAllOrders(testAuth);
    expect(result).toHaveLength(1);
  });
});

describe("replaceOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should replace an order successfully", async () => {
    const mockOrder = {
      id: "order-123",
      symbol: "AAPL",
      qty: "20",
      status: "accepted",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrder),
    });

    const result = await replaceOrder(testAuth, "order-123", { qty: "20" });
    expect(result.id).toBe("order-123");
  });

  it("preserves the broker code on a 422 reject via .response; message byte-identical (legacy fetch seam)", async () => {
    // `alpaca.orders.replace` is a raw-fetch seam; a plain Error dropped the
    // broker's response.data. The message is preserved verbatim (existing "422"
    // string-matching consumers unaffected) and the numeric code rides along.
    const body = JSON.stringify({
      code: 42210000,
      message: "cannot replace order in pending_cancel status",
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      text: () => Promise.resolve(body),
    });

    const thrown = await replaceOrder(testAuth, "order-123", { qty: "20" }).then(
      () => {
        throw new Error("expected replaceOrder to reject");
      },
      (e: unknown) => e as Error,
    );

    expect(thrown.message).toBe(
      `Failed to replace order: 422 Unprocessable Entity ${body}`,
    );
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
  });
});

describe("fetchAllPositions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch all positions", async () => {
    const mockPositions = [
      { symbol: "AAPL", qty: "10", side: "long", avg_entry_price: "150.00" },
      { symbol: "MSFT", qty: "5", side: "long", avg_entry_price: "400.00" },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPositions),
    });

    const result = await fetchAllPositions(testAuth);
    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe("AAPL");
  });
});

describe("closePosition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits the close DELETE with a timeout abort signal so exits can never hang indefinitely", async () => {
    const mockOrder = { id: "close-order-1", symbol: "AAPL", side: "sell" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockOrder),
    });

    const result = await closePosition(testAuth, "AAPL", {
      cancelOrders: false,
    });

    expect(result).toEqual(mockOrder);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/positions/AAPL");
    expect(init.method).toBe("DELETE");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns null for a 404 (position already closed) and still sends the signal", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("position does not exist"),
    });

    const result = await closePosition(testAuth, "AAPL", {
      cancelOrders: false,
    });

    expect(result).toBeNull();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("fetchPosition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch a specific position", async () => {
    const mockPosition = { symbol: "AAPL", qty: "10", side: "long" };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPosition),
    });

    const result = await fetchPosition(testAuth, "AAPL");
    expect(result.position?.symbol).toBe("AAPL");
  });

  it("should return null position for 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("Position not found"),
    });

    const result = await fetchPosition(testAuth, "INVALID");
    expect(result.position).toBeNull();
    expect(result.message).toContain("Position does not exist");
  });
});

describe("fetchAccountDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch account details", async () => {
    const mockAccount = {
      id: "account-123",
      account_number: "123456",
      buying_power: "50000",
      equity: "100000",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAccount),
    });

    const result = await fetchAccountDetails({ auth: testAuth });
    expect(result.id).toBe("account-123");
  });
});

describe("getLatestQuotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty response for empty symbols array", async () => {
    const result = await getLatestQuotes(testAuth, { symbols: [] });
    expect(result.quotes).toEqual({});
  });

  it("should fetch latest quotes for symbols", async () => {
    const mockResponse = {
      quotes: {
        AAPL: {
          ap: 151,
          as: 100,
          bp: 150.5,
          bs: 200,
          t: "2025-01-10T10:00:00Z",
        },
      },
      currency: "USD",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await getLatestQuotes(testAuth, { symbols: ["AAPL"] });
    expect(result.quotes).toHaveProperty("AAPL");
  });
});

describe("getAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch asset information", async () => {
    const mockAsset = {
      id: "asset-123",
      class: "us_equity",
      exchange: "NASDAQ",
      symbol: "AAPL",
      name: "Apple Inc.",
      status: "active",
      tradable: true,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAsset),
    });

    const result = await getAsset(testAuth, "AAPL");
    expect(result.symbol).toBe("AAPL");
    expect(result.name).toBe("Apple Inc.");
  });

  it("should handle special characters in symbol", async () => {
    const mockAsset = {
      id: "asset-456",
      class: "crypto",
      symbol: "BTC/USDT",
      name: "Bitcoin",
      status: "active",
      tradable: true,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockAsset),
    });

    const result = await getAsset(testAuth, "BTC/USDT");
    expect(result.symbol).toBe("BTC/USDT");

    // Verify the URL was properly encoded
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain("BTC%2FUSDT");
  });
});
