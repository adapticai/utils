/**
 * Pins the `client_order_id` provenance contract on the order verbs: a call
 * carrying a `lineage` submits an id decodable back to its `tradeIntentId` and
 * `attempt` and records `clientOrderIdSource: "lineage"`; an explicit id records
 * `"explicit"`; with neither, the id is the UNCHANGED one-way SHA-256 default
 * and records `"derived"`. The source is readable on the returned order without
 * altering the order's serialized broker payload.
 */
import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ws", () => ({
  default: class MockWebSocket {
    static readonly OPEN = 1;
  },
}));

vi.mock("../logging", () => ({
  log: vi.fn(),
}));

vi.mock("../alpaca-market-data-api", () => ({
  marketDataAPI: {},
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { AlpacaTradingAPI } from "../alpaca-trading-api";
import { MAX_CLIENT_ORDER_ID_LENGTH } from "../alpaca/trading/orders";
import {
  decodeLineageClientOrderId,
  encodeLineageClientOrderId,
  LINEAGE_CLIENT_ORDER_ID_PREFIX,
} from "../client-order-lineage";
import { DuplicateClientOrderIdError, ValidationError } from "../errors";
import type {
  AlpacaCredentials,
  AlpacaOrderWithClientOrderIdSource,
  ClientOrderLineage,
} from "../types/alpaca-types";

const testCredentials: AlpacaCredentials = {
  accountName: "test-account",
  apiKey: "test-api-key-123",
  apiSecret: "test-api-secret-123",
  type: "PAPER",
  orderType: "market",
  engine: "adaptic",
};

const FIXED_NOW = new Date("2026-09-13T15:00:00.000Z");

/** Derivation window from the implementation (5 minutes). */
const WINDOW_MS = 300_000;

/** A realistic intent id: the engine keys trade intents by UUID. */
const TRADE_INTENT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const BROKER_ORDER = { id: "broker-order-1", status: "new", symbol: "AAPL" };

/**
 * Independently recomputes the derived default id — account, 5-minute bucket,
 * then the verb's derive parts, `|`-joined, SHA-256, first 32 hex chars behind
 * the `adaptic-` prefix. Any change to the hash, its material, or its
 * truncation diverges from this.
 */
function expectedDerivedId(
  parts: ReadonlyArray<string | number | boolean | undefined>,
): string {
  const bucket = Math.floor(FIXED_NOW.getTime() / WINDOW_MS);
  const material = [
    testCredentials.accountName,
    bucket,
    ...parts.map((part) => (part === undefined ? "" : String(part))),
  ].join("|");
  const digest = createHash("sha256")
    .update(material)
    .digest("hex")
    .slice(0, 32);
  return `adaptic-${digest}`;
}

function jsonResponse(data: unknown): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(data),
  };
}

function duplicate422Response(): Record<string, unknown> {
  return {
    ok: false,
    status: 422,
    headers: new Headers({ "content-type": "application/json" }),
    text: () =>
      Promise.resolve('{"message":"client order id must be unique"}'),
  };
}

function sentClientOrderId(callIndex: number): string {
  const init = mockFetch.mock.calls[callIndex]?.[1] as { body: string };
  const body = JSON.parse(init.body) as { client_order_id: string };
  return body.client_order_id;
}

describe("client-order-id-source-recorded", () => {
  let api: AlpacaTradingAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    mockFetch.mockReset();
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse({ ...BROKER_ORDER })),
    );
    api = new AlpacaTradingAPI(testCredentials);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("without lineage or an explicit id, submits the unchanged SHA-256 default and records 'derived'", async () => {
    const order = await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");

    expect(sentClientOrderId(0)).toBe(
      expectedDerivedId(["market", "AAPL", "buy", "buy_to_open", 10]),
    );
    expect(order.clientOrderIdSource).toBe("derived");
  });

  it("with a lineage, submits a decodable id carrying the tradeIntentId and attempt and records 'lineage'", async () => {
    const lineage: ClientOrderLineage = {
      tradeIntentId: TRADE_INTENT_ID,
      attempt: 2,
    };
    const order = await api.createMarketOrder(
      "AAPL",
      10,
      "buy",
      "buy_to_open",
      undefined,
      undefined,
      lineage,
    );

    const submitted = sentClientOrderId(0);
    expect(submitted.startsWith(LINEAGE_CLIENT_ORDER_ID_PREFIX)).toBe(true);
    expect(submitted.length).toBeLessThanOrEqual(MAX_CLIENT_ORDER_ID_LENGTH);
    expect(decodeLineageClientOrderId(submitted)).toEqual(lineage);
    expect(submitted).not.toBe(
      expectedDerivedId(["market", "AAPL", "buy", "buy_to_open", 10]),
    );
    expect(order.clientOrderIdSource).toBe("lineage");
  });

  it("a lineage without an attempt decodes back with no attempt rather than a fabricated one", async () => {
    await api.createMarketOrder(
      "AAPL",
      10,
      "buy",
      "buy_to_open",
      undefined,
      undefined,
      { tradeIntentId: TRADE_INTENT_ID },
    );

    const decoded = decodeLineageClientOrderId(sentClientOrderId(0));
    expect(decoded).toEqual({ tradeIntentId: TRADE_INTENT_ID });
    expect(decoded && "attempt" in decoded).toBe(false);
  });

  it("an explicit id passes through verbatim and records 'explicit'", async () => {
    const order = await api.createMarketOrder(
      "AAPL",
      10,
      "buy",
      "buy_to_open",
      "caller-id-1",
    );

    expect(sentClientOrderId(0)).toBe("caller-id-1");
    expect(order.clientOrderIdSource).toBe("explicit");
  });

  it("every order verb accepts a lineage and records the source on its result", async () => {
    const lineage: ClientOrderLineage = {
      tradeIntentId: TRADE_INTENT_ID,
      attempt: 0,
    };
    const verbs: Array<
      [string, () => Promise<AlpacaOrderWithClientOrderIdSource>]
    > = [
      [
        "createMarketOrder",
        () =>
          api.createMarketOrder(
            "AAPL",
            1,
            "buy",
            "buy_to_open",
            undefined,
            undefined,
            lineage,
          ),
      ],
      [
        "createLimitOrder",
        () =>
          api.createLimitOrder(
            "AAPL",
            1,
            "buy",
            100,
            "buy_to_open",
            false,
            undefined,
            undefined,
            lineage,
          ),
      ],
      [
        "createTrailingStop",
        () =>
          api.createTrailingStop(
            "AAPL",
            1,
            "sell",
            1.5,
            "sell_to_close",
            undefined,
            undefined,
            lineage,
          ),
      ],
      [
        "createOptionOrder",
        () =>
          api.createOptionOrder(
            "AAPL260918C00200000",
            1,
            "buy",
            "buy_to_open",
            "market",
            undefined,
            undefined,
            undefined,
            lineage,
          ),
      ],
      [
        "createMultiLegOptionOrder",
        () =>
          api.createMultiLegOptionOrder(
            [
              {
                symbol: "AAPL260918C00200000",
                side: "buy",
                ratio_qty: "1",
                position_intent: "buy_to_open",
              },
              {
                symbol: "AAPL260918C00210000",
                side: "sell",
                ratio_qty: "1",
                position_intent: "sell_to_open",
              },
            ],
            1,
            "market",
            undefined,
            undefined,
            undefined,
            lineage,
          ),
      ],
      [
        "createEquitiesTrade",
        () =>
          api.createEquitiesTrade(
            { symbol: "AAPL", qty: 1, side: "buy" },
            { lineage },
          ),
      ],
    ];

    for (const [index, [name, place]] of verbs.entries()) {
      const order = await place();
      expect({ name, source: order.clientOrderIdSource }).toEqual({
        name,
        source: "lineage",
      });
      expect({ name, decoded: decodeLineageClientOrderId(sentClientOrderId(index)) }).toEqual({
        name,
        decoded: lineage,
      });
    }
  });

  it("records the source without altering the serialized broker payload", async () => {
    const order = await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");

    expect(order.clientOrderIdSource).toBe("derived");
    expect(Object.keys(order)).not.toContain("clientOrderIdSource");
    expect(JSON.stringify(order)).toBe(JSON.stringify(BROKER_ORDER));
    expect(order).toEqual(BROKER_ORDER);
  });

  it("refuses an order given both an explicit id and a lineage, before any broker call", async () => {
    await expect(
      api.createMarketOrder(
        "AAPL",
        10,
        "buy",
        "buy_to_open",
        "caller-id-1",
        undefined,
        { tradeIntentId: TRADE_INTENT_ID },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each<[string, ClientOrderLineage]>([
    ["a blank tradeIntentId", { tradeIntentId: "" }],
    ["a tradeIntentId containing the ':' separator", { tradeIntentId: "a:b" }],
    ["a tradeIntentId with characters Alpaca rejects", { tradeIntentId: "a b" }],
    ["a negative attempt", { tradeIntentId: TRADE_INTENT_ID, attempt: -1 }],
    ["a fractional attempt", { tradeIntentId: TRADE_INTENT_ID, attempt: 1.5 }],
    [
      "an id over Alpaca's 128-character client_order_id limit",
      { tradeIntentId: "x".repeat(MAX_CLIENT_ORDER_ID_LENGTH) },
    ],
  ])("refuses %s before any broker call", async (_label, lineage) => {
    await expect(
      api.createMarketOrder(
        "AAPL",
        10,
        "buy",
        "buy_to_open",
        undefined,
        undefined,
        lineage,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a duplicate lineage id surfaces the typed error without the derived-id recovery lookup or salted resubmit", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(duplicate422Response());

    const attempt = api.createMarketOrder(
      "AAPL",
      10,
      "buy",
      "buy_to_open",
      undefined,
      undefined,
      { tradeIntentId: TRADE_INTENT_ID, attempt: 1 },
    );

    await expect(attempt).rejects.toBeInstanceOf(DuplicateClientOrderIdError);
    await expect(attempt).rejects.toMatchObject({ wasDerived: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("the idempotent return of a live derived-id duplicate still reports 'derived'", async () => {
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(duplicate422Response())
      .mockResolvedValueOnce(
        jsonResponse({ id: "existing-1", status: "accepted" }),
      );

    const order = await api.createMarketOrder("AAPL", 10, "buy", "buy_to_open");

    expect(order.id).toBe("existing-1");
    expect(order.clientOrderIdSource).toBe("derived");
  });

  describe("lineage codec", () => {
    it.each<ClientOrderLineage>([
      { tradeIntentId: TRADE_INTENT_ID },
      { tradeIntentId: TRADE_INTENT_ID, attempt: 0 },
      { tradeIntentId: "intent_42.A-b", attempt: 17 },
    ])("round-trips %o", (lineage) => {
      expect(decodeLineageClientOrderId(encodeLineageClientOrderId(lineage))).toEqual(
        lineage,
      );
    });

    it.each([
      ["a derived default id", expectedDerivedId(["market", "AAPL"])],
      ["an engine-style explicit id", `${TRADE_INTENT_ID}:3`],
      ["a lineage prefix with a non-numeric attempt", `${LINEAGE_CLIENT_ORDER_ID_PREFIX}abc:x`],
      ["a lineage prefix with a leading-zero attempt", `${LINEAGE_CLIENT_ORDER_ID_PREFIX}abc:01`],
      ["a lineage prefix with an empty intent", `${LINEAGE_CLIENT_ORDER_ID_PREFIX}:3`],
      ["a lineage prefix with too many segments", `${LINEAGE_CLIENT_ORDER_ID_PREFIX}a:1:2`],
    ])("decodes %s as not-a-lineage (null)", (_label, clientOrderId) => {
      expect(decodeLineageClientOrderId(clientOrderId)).toBeNull();
    });
  });
});
