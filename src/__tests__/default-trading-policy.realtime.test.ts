/**
 * The default trading policy stands in wherever an account's own policy row
 * was not read, so it must not grant the account permission to trade: its
 * `realtimeTradingEnabled` matches the backend column's default
 * (`TradingPolicy.realtimeTradingEnabled Boolean @default(false)`), and an
 * account trades only once its own row turns the switch on.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_TRADING_POLICY } from "../trading-policy/defaults/default-trading-policy";
import { EffectiveTradingPolicySchema } from "../trading-policy/schemas/effective-policy.schema";

describe("DEFAULT_TRADING_POLICY.realtimeTradingEnabled", () => {
  it("is false, the backend column's own default", () => {
    expect(DEFAULT_TRADING_POLICY.realtimeTradingEnabled).toBe(false);
  });

  it("is turned on only by an account layer that says so", () => {
    const merged = EffectiveTradingPolicySchema.parse({ ...structuredClone(DEFAULT_TRADING_POLICY), realtimeTradingEnabled: true });
    expect(merged.realtimeTradingEnabled).toBe(true);
    expect(EffectiveTradingPolicySchema.parse(structuredClone(DEFAULT_TRADING_POLICY)).realtimeTradingEnabled).toBe(false);
  });
});
