import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing module under test
vi.mock("@adaptic/backend-legacy", () => ({
  default: {
    alpacaAccount: { get: vi.fn() },
  },
  types: {},
}));

vi.mock("../adaptic", () => ({
  getSharedApolloClient: vi.fn().mockResolvedValue({}),
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

import adaptic from "@adaptic/backend-legacy";
import {
  resolveBrokerCredentials,
  validateAuth,
} from "../alpaca/legacy/auth";
import { UnsupportedBrokerError } from "../errors";
import type { AlpacaAuth } from "../types/alpaca-types";

const mockAccountGet = vi.mocked(adaptic.alpacaAccount.get);

describe("validateAuth credential precedence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountGet.mockResolvedValue({
      id: "acc-1",
      APIKey: "backend-key",
      APISecret: "backend-secret",
      type: "LIVE",
    } as never);
  });

  it("prefers inline credentials over adapticAccountId when key, secret, and type are all present (no backend round trip)", async () => {
    const result = await validateAuth({
      adapticAccountId: "acc-1",
      alpacaApiKey: "inline-key",
      alpacaApiSecret: "inline-secret",
      type: "LIVE",
    });

    expect(result).toEqual({
      APIKey: "inline-key",
      APISecret: "inline-secret",
      type: "LIVE",
    });
    expect(mockAccountGet).not.toHaveBeenCalled();
  });

  it("uses inline credentials with PAPER default when type and adapticAccountId are both absent", async () => {
    const result = await validateAuth({
      alpacaApiKey: "inline-key",
      alpacaApiSecret: "inline-secret",
    });

    expect(result).toEqual({
      APIKey: "inline-key",
      APISecret: "inline-secret",
      type: "PAPER",
    });
    expect(mockAccountGet).not.toHaveBeenCalled();
  });

  it("falls back to the adapticAccountId lookup when inline credentials lack a type and the authoritative type is resolvable", async () => {
    const result = await validateAuth({
      adapticAccountId: "acc-1",
      alpacaApiKey: "inline-key",
      alpacaApiSecret: "inline-secret",
    });

    expect(result).toEqual({
      APIKey: "backend-key",
      APISecret: "backend-secret",
      type: "LIVE",
    });
    expect(mockAccountGet).toHaveBeenCalledTimes(1);
  });

  it("falls back to the adapticAccountId lookup when inline credentials are empty strings", async () => {
    const result = await validateAuth({
      adapticAccountId: "acc-1",
      alpacaApiKey: "",
      alpacaApiSecret: "  ",
      type: "LIVE",
    });

    expect(result).toEqual({
      APIKey: "backend-key",
      APISecret: "backend-secret",
      type: "LIVE",
    });
    expect(mockAccountGet).toHaveBeenCalledTimes(1);
  });

  it("falls back to the adapticAccountId lookup when only the key (not the secret) is inline", async () => {
    const result = await validateAuth({
      adapticAccountId: "acc-1",
      alpacaApiKey: "inline-key",
      type: "LIVE",
    });

    expect(result.APIKey).toBe("backend-key");
    expect(mockAccountGet).toHaveBeenCalledTimes(1);
  });

  it("resolves credentials via adapticAccountId alone", async () => {
    const result = await validateAuth({ adapticAccountId: "acc-1" });

    expect(result).toEqual({
      APIKey: "backend-key",
      APISecret: "backend-secret",
      type: "LIVE",
    });
    expect(mockAccountGet).toHaveBeenCalledTimes(1);
  });

  it("throws when the backend account record is incomplete", async () => {
    mockAccountGet.mockResolvedValue({
      id: "acc-1",
      APIKey: null,
      APISecret: null,
      type: "PAPER",
    } as never);

    await expect(validateAuth({ adapticAccountId: "acc-1" })).rejects.toThrow(
      "Alpaca account not found or incomplete",
    );
  });

  it("throws when neither inline credentials nor adapticAccountId are provided", async () => {
    await expect(validateAuth({})).rejects.toThrow(
      "Either adapticAccountId or both alpacaApiKey and alpacaApiSecret must be provided",
    );
  });
});

describe("validateAuth provider guard (multi-broker seam)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountGet.mockResolvedValue({
      id: "acc-1",
      APIKey: "backend-key",
      APISecret: "backend-secret",
      type: "LIVE",
    } as never);
  });

  it("throws UnsupportedBrokerError for a non-ALPACA provider even with valid inline credentials, without any backend round trip", async () => {
    const auth = {
      provider: "IBKR",
      adapticAccountId: "acc-1",
      alpacaApiKey: "inline-key",
      alpacaApiSecret: "inline-secret",
      type: "LIVE",
    } as unknown as AlpacaAuth;

    await expect(validateAuth(auth)).rejects.toThrow(UnsupportedBrokerError);
    await expect(validateAuth(auth)).rejects.toMatchObject({
      provider: "IBKR",
      code: "UNSUPPORTED_BROKER",
      isRetryable: false,
    });
    expect(mockAccountGet).not.toHaveBeenCalled();
  });

  it("throws UnsupportedBrokerError for COINBASE before attempting the adapticAccountId lookup", async () => {
    const auth = {
      provider: "COINBASE",
      adapticAccountId: "acc-1",
    } as unknown as AlpacaAuth;

    await expect(validateAuth(auth)).rejects.toThrow(UnsupportedBrokerError);
    expect(mockAccountGet).not.toHaveBeenCalled();
  });

  it("accepts an explicit ALPACA provider and resolves credentials normally", async () => {
    const result = await validateAuth({
      provider: "ALPACA",
      alpacaApiKey: "inline-key",
      alpacaApiSecret: "inline-secret",
      type: "PAPER",
    });

    expect(result).toEqual({
      APIKey: "inline-key",
      APISecret: "inline-secret",
      type: "PAPER",
    });
    expect(mockAccountGet).not.toHaveBeenCalled();
  });

  it("U-7 precedence regression: explicit ALPACA provider does not alter inline-credentials precedence over adapticAccountId (no backend round trip)", async () => {
    const result = await validateAuth({
      provider: "ALPACA",
      adapticAccountId: "acc-1",
      alpacaApiKey: "inline-key",
      alpacaApiSecret: "inline-secret",
      type: "LIVE",
    });

    expect(result).toEqual({
      APIKey: "inline-key",
      APISecret: "inline-secret",
      type: "LIVE",
    });
    expect(mockAccountGet).not.toHaveBeenCalled();
  });

  it("U-7 precedence regression: with provider set, inline credentials lacking a type still defer to the authoritative backend type", async () => {
    const result = await validateAuth({
      provider: "ALPACA",
      adapticAccountId: "acc-1",
      alpacaApiKey: "inline-key",
      alpacaApiSecret: "inline-secret",
    });

    expect(result).toEqual({
      APIKey: "backend-key",
      APISecret: "backend-secret",
      type: "LIVE",
    });
    expect(mockAccountGet).toHaveBeenCalledTimes(1);
  });
});

describe("resolveBrokerCredentials (single backend-coupled lookup)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountGet.mockResolvedValue({
      id: "acc-1",
      APIKey: "backend-key",
      APISecret: "backend-secret",
      type: "LIVE",
    } as never);
  });

  it("resolves credentials for a brokerage-account id via the backend", async () => {
    const result = await resolveBrokerCredentials("acc-1");

    expect(result).toEqual({
      APIKey: "backend-key",
      APISecret: "backend-secret",
      type: "LIVE",
    });
    expect(mockAccountGet).toHaveBeenCalledTimes(1);
    expect(mockAccountGet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "acc-1" }),
      expect.anything(),
    );
  });

  it("throws when the backend account record is missing or incomplete", async () => {
    mockAccountGet.mockResolvedValue({
      id: "acc-1",
      APIKey: null,
      APISecret: null,
      type: "PAPER",
    } as never);

    await expect(resolveBrokerCredentials("acc-1")).rejects.toThrow(
      "Alpaca account not found or incomplete",
    );
  });

  it("is the delegation target of validateAuth's adapticAccountId fallback (same result shape)", async () => {
    const viaValidateAuth = await validateAuth({ adapticAccountId: "acc-1" });
    const direct = await resolveBrokerCredentials("acc-1");

    expect(viaValidateAuth).toEqual(direct);
    expect(mockAccountGet).toHaveBeenCalledTimes(2);
  });
});
