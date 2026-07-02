import { describe, expect, it } from "vitest";

import {
  AdapticUtilsError,
  UnsupportedBrokerError,
} from "../errors";
import { isAlpacaBrokerCredentials } from "../types/broker-types";
import type {
  AlpacaBrokerCredentials,
  BrokerAuth,
  BrokerCredentials,
  BrokerageAccountType,
  BrokerageProvider,
} from "../types/broker-types";
import * as packageRoot from "../index";

describe("UnsupportedBrokerError", () => {
  it("carries the provider, code, service, and is never retryable", () => {
    const error = new UnsupportedBrokerError("IBKR");

    expect(error.provider).toBe("IBKR");
    expect(error.code).toBe("UNSUPPORTED_BROKER");
    expect(error.service).toBe("broker");
    expect(error.isRetryable).toBe(false);
    expect(error.name).toBe("UnsupportedBrokerError");
    expect(error.message).toContain("IBKR");
    expect(error.message).toContain("ALPACA");
  });

  it("is instanceof Error and AdapticUtilsError", () => {
    const error = new UnsupportedBrokerError("COINBASE");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AdapticUtilsError);
    expect(error).toBeInstanceOf(UnsupportedBrokerError);
  });

  it("preserves cause when provided", () => {
    const cause = new Error("original");
    const error = new UnsupportedBrokerError("IBKR", cause);

    expect(error.cause).toBe(cause);
  });

  it("is exported from the package root", () => {
    expect(packageRoot.UnsupportedBrokerError).toBe(UnsupportedBrokerError);
  });
});

describe("BrokerCredentials discriminated union", () => {
  const alpaca: BrokerCredentials = {
    provider: "ALPACA",
    apiKey: "key",
    apiSecret: "secret",
    type: "PAPER",
  };
  const ibkr: BrokerCredentials = {
    provider: "IBKR",
    accountId: "U1234567",
    type: "LIVE",
  };
  const coinbase: BrokerCredentials = {
    provider: "COINBASE",
    apiKey: "cb-key",
    apiSecret: "cb-secret",
    type: "LIVE",
  };

  it("narrows to the ALPACA arm via isAlpacaBrokerCredentials", () => {
    expect(isAlpacaBrokerCredentials(alpaca)).toBe(true);
    expect(isAlpacaBrokerCredentials(ibkr)).toBe(false);
    expect(isAlpacaBrokerCredentials(coinbase)).toBe(false);

    if (isAlpacaBrokerCredentials(alpaca)) {
      // Compile-time: narrowed arm exposes apiKey/apiSecret.
      const narrowed: AlpacaBrokerCredentials = alpaca;
      expect(narrowed.apiKey).toBe("key");
      expect(narrowed.apiSecret).toBe("secret");
    }
  });

  it("switch on provider is exhaustive over the union", () => {
    const providerOf = (credentials: BrokerCredentials): BrokerageProvider => {
      switch (credentials.provider) {
        case "ALPACA":
          return credentials.provider;
        case "IBKR":
          return credentials.provider;
        case "COINBASE":
          return credentials.provider;
      }
    };

    expect(providerOf(alpaca)).toBe("ALPACA");
    expect(providerOf(ibkr)).toBe("IBKR");
    expect(providerOf(coinbase)).toBe("COINBASE");
  });

  it("BrokerageAccountType is value-compatible with the Alpaca type field", () => {
    const paper: BrokerageAccountType = "PAPER";
    const live: BrokerageAccountType = "LIVE";
    // Compile-time round trip against the frozen Alpaca literal union.
    const alpacaType: "PAPER" | "LIVE" = paper;

    expect(alpacaType).toBe("PAPER");
    expect(live).toBe("LIVE");
  });
});

describe("BrokerAuth", () => {
  it("accepts brokerageAccountId-only, credentials-only, and combined forms", () => {
    const byId: BrokerAuth = { brokerageAccountId: "acc-1" };
    const inline: BrokerAuth = {
      credentials: {
        provider: "ALPACA",
        apiKey: "key",
        apiSecret: "secret",
        type: "PAPER",
      },
    };
    const combined: BrokerAuth = {
      brokerageAccountId: "acc-1",
      provider: "ALPACA",
      credentials: {
        provider: "ALPACA",
        apiKey: "key",
        apiSecret: "secret",
        type: "LIVE",
      },
    };

    expect(byId.brokerageAccountId).toBe("acc-1");
    expect(inline.credentials?.provider).toBe("ALPACA");
    expect(combined.provider).toBe("ALPACA");
  });
});
