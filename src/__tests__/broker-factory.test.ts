import { afterEach, describe, expect, it } from "vitest";

import {
  AlpacaClient,
  clearClientCache,
  createAlpacaClient,
} from "../alpaca/client";
import { createBrokerClient } from "../broker/factory";
import type { BrokerTradingClient } from "../broker/factory";
import { UnsupportedBrokerError } from "../errors";
import type { BrokerCredentials } from "../types/broker-types";

const ALPACA_CREDENTIALS: BrokerCredentials = {
  provider: "ALPACA",
  apiKey: "test-key",
  apiSecret: "test-secret",
  type: "PAPER",
};

describe("createBrokerClient", () => {
  afterEach(() => {
    clearClientCache();
  });

  it("returns an AlpacaClient satisfying BrokerTradingClient for ALPACA credentials", () => {
    const client = createBrokerClient(ALPACA_CREDENTIALS);

    expect(client).toBeInstanceOf(AlpacaClient);
    expect(client.isPaper()).toBe(true);
    expect(client.getConfig()).toMatchObject({
      apiKey: "test-key",
      apiSecret: "test-secret",
      accountType: "PAPER",
    });
    expect(typeof client.executeWithRateLimit).toBe("function");
    expect(typeof client.validateCredentials).toBe("function");
  });

  it("maps the credentials type onto accountType (LIVE)", () => {
    const client = createBrokerClient({
      ...ALPACA_CREDENTIALS,
      type: "LIVE",
    });

    expect(client.isPaper()).toBe(false);
    expect(client.getConfig().accountType).toBe("LIVE");
  });

  it("shares the provider-scoped connection pool with createAlpacaClient", () => {
    const viaBrokerFactory = createBrokerClient(ALPACA_CREDENTIALS);
    const viaAlpacaFactory = createAlpacaClient({
      apiKey: "test-key",
      apiSecret: "test-secret",
      accountType: "PAPER",
    });

    // Same provider + apiKey + accountType => same pooled instance.
    expect(viaBrokerFactory).toBe(viaAlpacaFactory);

    // Different accountType => distinct cache entry.
    const live = createBrokerClient({ ...ALPACA_CREDENTIALS, type: "LIVE" });
    expect(live).not.toBe(viaBrokerFactory);
  });

  it("returns the cached instance on repeated calls with identical credentials", () => {
    const first = createBrokerClient(ALPACA_CREDENTIALS);
    const second = createBrokerClient(ALPACA_CREDENTIALS);

    expect(second).toBe(first);

    clearClientCache();
    const third = createBrokerClient(ALPACA_CREDENTIALS);
    expect(third).not.toBe(first);
  });

  it("throws UnsupportedBrokerError for IBKR credentials", () => {
    const ibkr: BrokerCredentials = {
      provider: "IBKR",
      accountId: "U1234567",
      type: "PAPER",
    };

    expect(() => createBrokerClient(ibkr)).toThrow(UnsupportedBrokerError);
    try {
      createBrokerClient(ibkr);
      expect.unreachable("createBrokerClient must throw for IBKR");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedBrokerError);
      expect((error as UnsupportedBrokerError).provider).toBe("IBKR");
      expect((error as UnsupportedBrokerError).isRetryable).toBe(false);
    }
  });

  it("throws UnsupportedBrokerError for COINBASE credentials", () => {
    const coinbase: BrokerCredentials = {
      provider: "COINBASE",
      apiKey: "cb-key",
      apiSecret: "cb-secret",
      type: "LIVE",
    };

    expect(() => createBrokerClient(coinbase)).toThrow(UnsupportedBrokerError);
  });

  it("throws UnsupportedBrokerError for unknown provider strings from untyped callers", () => {
    const unknownProvider = {
      provider: "ROBINHOOD",
      apiKey: "x",
      apiSecret: "y",
      type: "PAPER",
    } as unknown as BrokerCredentials;

    try {
      createBrokerClient(unknownProvider);
      expect.unreachable("createBrokerClient must throw for unknown providers");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedBrokerError);
      expect((error as UnsupportedBrokerError).provider).toBe("ROBINHOOD");
    }
  });

  it("AlpacaClient structurally satisfies BrokerTradingClient (compile-time contract)", () => {
    const contract: BrokerTradingClient = createAlpacaClient({
      apiKey: "contract-key",
      apiSecret: "contract-secret",
      accountType: "PAPER",
    });

    expect(contract.isPaper()).toBe(true);
  });
});
// Package-root export identity is asserted in index.test.ts, which mocks
// the heavy transitive dependencies before importing ../index.
