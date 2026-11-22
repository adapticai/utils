/**
 * Pins the borrow-state contract on every Alpaca asset read (TP-02, utils
 * limb): `borrow_status` is carried when Alpaca states a recognised value and
 * is absent otherwise — never defaulted to either member and never derived
 * from the legacy `easy_to_borrow` boolean — while a payload that already
 * matches the type comes back unchanged. Each reader is driven end to end
 * through a stubbed `fetch`, so the assertions bind the live read path and
 * not only the helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const warnSpy = vi.fn();

vi.mock("@adaptic/backend", () => ({
  default: { alpacaAccount: { get: vi.fn() } },
  types: {},
}));
vi.mock("../adaptic", () => ({ getSharedApolloClient: vi.fn() }));
vi.mock("../utils/auth-validator", () => ({
  validateAlpacaCredentials: vi.fn(),
}));
vi.mock("../logger", () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: warnSpy,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../misc-utils", () => ({ logIfDebug: vi.fn() }));
vi.mock("ws", () => ({
  default: class MockWebSocket {
    static readonly OPEN = 1;
  },
}));
vi.mock("../logging", () => ({ log: vi.fn() }));
vi.mock("../rate-limiter", () => ({
  rateLimiters: { alpaca: { acquire: (): Promise<void> => Promise.resolve() } },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getAsset as legacyGetAsset } from "../alpaca/legacy";
import { marketDataAPI } from "../alpaca-market-data-api";
import {
  normalizeAlpacaAsset,
  normalizeAlpacaAssets,
} from "../alpaca/asset-normalize";
import type { AlpacaAsset, AlpacaAuth } from "../types/alpaca-types";

const testAuth: AlpacaAuth = {
  alpacaApiKey: "test-api-key",
  alpacaApiSecret: "test-api-secret",
  type: "PAPER",
};

/** A payload shaped as Alpaca's current schema sends it: no `easy_to_borrow`. */
const CURRENT_SCHEMA_ASSET: AlpacaAsset = {
  id: "b0b6dd9d-8b9b-48a9-ba46-b9d54906e415",
  class: "us_equity",
  exchange: "NASDAQ",
  symbol: "AAPL",
  name: "Apple Inc. Common Stock",
  status: "active",
  tradable: true,
  marginable: true,
  shortable: true,
  fractionable: true,
  borrow_status: "hard_to_borrow",
  margin_requirement_long: "30",
  margin_requirement_short: "30",
};

/** A payload with no borrow statement at all (e.g. a crypto asset). */
const NO_BORROW_ASSET = {
  id: "c0b6dd9d-8b9b-48a9-ba46-b9d54906e416",
  class: "crypto",
  exchange: "CRYPTO",
  symbol: "BTC/USD",
  name: "Bitcoin / US Dollar",
  status: "active",
  tradable: true,
  marginable: false,
  shortable: false,
  fractionable: true,
};

/** Payloads consumers already handle: carrying the legacy boolean. */
const LEGACY_ETB_TRUE = {
  ...NO_BORROW_ASSET,
  class: "us_equity",
  exchange: "NYSE",
  symbol: "IBM",
  easy_to_borrow: true,
  cusip: "459200101",
  attributes: ["has_options"],
};
const LEGACY_ETB_FALSE = { ...LEGACY_ETB_TRUE, symbol: "GME", easy_to_borrow: false };

function legacyResponse(body: unknown): Record<string, unknown> {
  return { ok: true, json: () => Promise.resolve(body) };
}

function marketDataResponse(body: unknown): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
  };
}

type Reader = (body: unknown) => Promise<AlpacaAsset>;

const READERS: ReadonlyArray<[string, Reader]> = [
  [
    "legacy getAsset",
    async (body) => {
      mockFetch.mockResolvedValueOnce(legacyResponse(body));
      return legacyGetAsset(testAuth, "X");
    },
  ],
  [
    "marketDataAPI.getAsset",
    async (body) => {
      mockFetch.mockResolvedValueOnce(marketDataResponse(body));
      return marketDataAPI.getAsset("X");
    },
  ],
  [
    "marketDataAPI.getAssets",
    async (body) => {
      mockFetch.mockResolvedValueOnce(marketDataResponse([body]));
      const assets = await marketDataAPI.getAssets();
      expect(assets).toHaveLength(1);
      return assets[0] as AlpacaAsset;
    },
  ],
];

describe.each(READERS)("%s borrow state", (_name, read) => {
  beforeEach(() => {
    mockFetch.mockReset();
    warnSpy.mockReset();
  });

  it("leaves borrow_status absent when Alpaca does not state it", async () => {
    const asset = await read(NO_BORROW_ASSET);
    expect("borrow_status" in asset).toBe(false);
    expect(asset.borrow_status).toBeUndefined();
    expect("easy_to_borrow" in asset).toBe(false);
  });

  it("never derives borrow_status from the legacy easy_to_borrow boolean", async () => {
    const asset = await read(LEGACY_ETB_TRUE);
    expect("borrow_status" in asset).toBe(false);
    expect(asset.easy_to_borrow).toBe(true);
  });

  it("carries a stated borrow_status and margin_requirement_short through", async () => {
    const asset = await read(CURRENT_SCHEMA_ASSET);
    expect(asset.borrow_status).toBe("hard_to_borrow");
    expect(asset.margin_requirement_short).toBe("30");
    expect("easy_to_borrow" in asset).toBe(false);
  });

  it("drops an unrecognised borrow_status rather than passing it as a known state", async () => {
    const asset = await read({ ...NO_BORROW_ASSET, borrow_status: "locate_required" });
    expect("borrow_status" in asset).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["easy_to_borrow: true", LEGACY_ETB_TRUE],
    ["easy_to_borrow: false", LEGACY_ETB_FALSE],
    ["current schema", CURRENT_SCHEMA_ASSET],
  ])("returns an already-conforming payload unchanged (%s)", async (_label, body) => {
    const asset = await read(body);
    expect(asset).toStrictEqual(body);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("normalizeAlpacaAsset input guards", () => {
  it("refuses a payload that is not an object", () => {
    expect(() => normalizeAlpacaAsset(null)).toThrow(/not an object/);
    expect(() => normalizeAlpacaAsset("AAPL")).toThrow(/not an object/);
    expect(() => normalizeAlpacaAsset([])).toThrow(/not an object/);
  });

  it("refuses an assets body that is not an array", () => {
    expect(() => normalizeAlpacaAssets({ symbol: "AAPL" })).toThrow(/not an array/);
  });

  it("drops a non-boolean easy_to_borrow rather than coercing it", () => {
    warnSpy.mockReset();
    const asset = normalizeAlpacaAsset({ ...NO_BORROW_ASSET, easy_to_borrow: "true" });
    expect("easy_to_borrow" in asset).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
