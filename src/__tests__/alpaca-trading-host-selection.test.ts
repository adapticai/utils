/**
 * The trading host a client addresses is decided by the ACCOUNT, never by a
 * process-level declaration.
 *
 * An Alpaca key authenticates against exactly one trading host: a paper-class
 * key is accepted by `paper-api.alpaca.markets` and rejected by
 * `api.alpaca.markets`. `AlpacaAccount.type` is the authoritative statement of
 * which host an account lives on; `ALPACA_ACCOUNT_TYPE` is only a declaration
 * about the process credential. A trading client that reads the host from the
 * environment addresses the wrong host whenever the two disagree, and the
 * failure surfaces as an opaque HTTP 401 at the call site rather than at the
 * point the host was chosen.
 *
 * Every case below is asserted in BOTH polarities — a PAPER account under a
 * LIVE declaration and a LIVE account under a PAPER one. A one-way assertion
 * passes against a client that simply hardcodes one host, which is exactly
 * the defect being excluded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `legacy/auth` reaches the backend package for the account-id lane; this
// suite only exercises the inline-credential lane, where the account's own
// `type` decides the host.
vi.mock("@adaptic/backend", () => ({
  default: { alpacaAccount: { get: vi.fn() } },
  types: {},
}));
vi.mock("../adaptic", () => ({
  getSharedApolloClient: vi.fn().mockResolvedValue({}),
}));

import {
  clearClientCache,
  createAlpacaClient,
  createClientFromEnv,
} from "../alpaca/client";
import { validateAuth } from "../alpaca/legacy/auth";
import { TRADING_API, type AccountType } from "../config/api-endpoints";
import { ValidationError } from "../errors";

const originalEnv = { ...process.env };

beforeEach(() => {
  clearClientCache();
  process.env.ALPACA_API_KEY = "PKTESTKEYTESTKEY1234";
  process.env.ALPACA_API_SECRET = "test-secret-not-a-real-credential";
});

afterEach(() => {
  clearClientCache();
  process.env = { ...originalEnv };
});

describe("createClientFromEnv — the host comes from the account, the credential from the process", () => {
  it("addresses the PAPER host for a PAPER account even when the process declares LIVE", () => {
    process.env.ALPACA_ACCOUNT_TYPE = "LIVE";
    const client = createClientFromEnv("PAPER");
    expect(client.getApiBaseUrl()).toBe(TRADING_API.PAPER);
    expect(client.isPaper()).toBe(true);
  });

  it("addresses the LIVE host for a LIVE account even when the process declares PAPER", () => {
    process.env.ALPACA_ACCOUNT_TYPE = "PAPER";
    const client = createClientFromEnv("LIVE");
    expect(client.getApiBaseUrl()).toBe(TRADING_API.LIVE);
    expect(client.isPaper()).toBe(false);
  });

  it("resolves the same host whether the declaration is absent, agreeing, or contradicting", () => {
    const resolved = new Set<string>();
    for (const declared of ["LIVE", "PAPER", undefined]) {
      clearClientCache();
      if (declared === undefined) {
        delete process.env.ALPACA_ACCOUNT_TYPE;
      } else {
        process.env.ALPACA_ACCOUNT_TYPE = declared;
      }
      resolved.add(createClientFromEnv("PAPER").getApiBaseUrl());
    }
    expect([...resolved]).toEqual([TRADING_API.PAPER]);
  });

  it("fails closed with a named error rather than guessing a host", () => {
    process.env.ALPACA_ACCOUNT_TYPE = "LIVE";
    expect(() =>
      createClientFromEnv(undefined as unknown as AccountType),
    ).toThrow(ValidationError);
    expect(() => createClientFromEnv("paper" as AccountType)).toThrow(
      /must be "PAPER" or "LIVE"/,
    );
  });

  it("fails closed when the process credential is absent", () => {
    delete process.env.ALPACA_API_KEY;
    delete process.env.ALPACA_API_SECRET;
    delete process.env.ALPACA_SECRET_KEY;
    expect(() => createClientFromEnv("PAPER")).toThrow(ValidationError);
  });
});

describe("createAlpacaClient — the explicit path, pinned in both polarities", () => {
  it("ignores the process declaration entirely", () => {
    process.env.ALPACA_ACCOUNT_TYPE = "LIVE";
    expect(
      createAlpacaClient({
        apiKey: "PKA",
        apiSecret: "s",
        accountType: "PAPER",
      }).getApiBaseUrl(),
    ).toBe(TRADING_API.PAPER);
    expect(
      createAlpacaClient({
        apiKey: "AKA",
        apiSecret: "s",
        accountType: "LIVE",
      }).getApiBaseUrl(),
    ).toBe(TRADING_API.LIVE);
  });
});

describe("validateAuth — an account's own type survives a contradicting declaration", () => {
  it("returns the account's type, not the process declaration, in both polarities", async () => {
    process.env.ALPACA_ACCOUNT_TYPE = "LIVE";
    await expect(
      validateAuth({
        alpacaApiKey: "PKTESTKEYTESTKEY1234",
        alpacaApiSecret: "test-secret-not-a-real-credential",
        type: "PAPER",
      }),
    ).resolves.toMatchObject({ type: "PAPER" });

    process.env.ALPACA_ACCOUNT_TYPE = "PAPER";
    await expect(
      validateAuth({
        alpacaApiKey: "AKTESTKEYTESTKEY1234",
        alpacaApiSecret: "test-secret-not-a-real-credential",
        type: "LIVE",
      }),
    ).resolves.toMatchObject({ type: "LIVE" });
  });
});
