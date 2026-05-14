# Utils Port — Area U1 (Trading-Policy Defaults) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `utils`'s `DEFAULT_TRADING_POLICY` constant and related trading-policy module exports with the canonical `TradingPolicyJson` shape published by sub-project 2 (`@adaptic/backend-legacy@next`). Migrate the ~12 SR-side trading-policy commits (scalping defaults, equityWashTradeCooldownMs, perTradeEquityAllocationPct, broker compliance fields, signal thresholds, quantModelWeight) into the new JSON shape's path-addressed locations. Update every utils export and internal consumer to read from JSON paths (e.g. `policy.allocation.perTradeEquityPct`) instead of the old flat SR layout (`policy.tradeAllocationPct`).

**Architecture:** TDD throughout. Pin `@adaptic/backend-legacy@next`. Each constant + helper is built test-first against the imported `TradingPolicyJson` interface — schema correctness is enforced at the type level. The plan is small (one area, ~12 commits to port) so executes in a single chunk; subsequent utils areas (U2–U7) get their own plans.

**Tech Stack:** TypeScript 5.8, Rollup (dual ESM+CJS), Vitest. The `@adaptic/utils` package is published via Rollup; verify both `dist/index.mjs` and `dist/index.cjs` carry the new exports.

**Spec reference:** [`docs/superpowers/specs/2026-05-14-utils-port-design.md`](../specs/2026-05-14-utils-port-design.md) §4.1.

---

## File Structure (planned)

### Files to create

| Path                                        | Responsibility                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tests/trading-policy-defaults.test.ts` | Round-trip assertion: `DEFAULT_TRADING_POLICY` parses cleanly into `TradingPolicyJson`; all SR field tunings preserved at correct JSON paths. |

### Files to modify

| Path                                                                                            | Modification                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/trading-policy/defaults.ts` (or wherever `DEFAULT_TRADING_POLICY` lives — locate via grep) | Replace flat SR shape with `TradingPolicyJson` shape; migrate all SR tunings to JSON paths.                                                                          |
| `src/trading-policy/*.ts` (any helper that reads the flat shape)                                | Path-address reads (`policy.allocation.perTradeEquityPct` instead of `policy.tradeAllocationPct`).                                                                   |
| `src/index.ts`                                                                                  | Re-export `TradingPolicyJson` and `DEFAULT_TRADING_POLICY` (passthrough from backend-legacy, plus the utils-tuned defaults as `DEFAULT_TRADING_POLICY_UTILS_TUNED`). |
| `package.json`                                                                                  | Bump `@adaptic/backend-legacy` to `"next"`.                                                                                                                          |

---

## Pre-flight gates

- [ ] **Gate U-G1: `@adaptic/backend-legacy@1.0.0-port.1` is live on `@next`** — confirm via `npm view @adaptic/backend-legacy dist-tags`. If sub-project 2 Area A1 has not landed, U1 cannot start.

- [ ] **Gate U-G2: `port/trading-policy` branch cut from `main`**:
  ```bash
  cd ~/adapticai/utils && git checkout main && git pull && git checkout -b port/trading-policy
  ```

---

## Task 1: Pin `@adaptic/backend-legacy@next`

- [ ] **Step 1: Update `package.json`**

```diff
 "dependencies": {
-  "@adaptic/backend-legacy": "0.0.96X",
+  "@adaptic/backend-legacy": "next",
   ...
 }
```

- [ ] **Step 2: Install + capture lock**

Run: `yarn install` (utils uses npm? confirm with `cat package.json | grep packageManager`; substitute `npm install` if so).

- [ ] **Step 3: Verify the type import works**

Add a temporary scratch file `src/scratch-policy-import.ts`:

```typescript
import type { TradingPolicyJson } from "@adaptic/backend-legacy";
const _: TradingPolicyJson = {};
export { _ };
```

Run: `npx tsc --noEmit src/scratch-policy-import.ts`
Expected: 0 errors.

Delete the scratch file: (clean up before commit).

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock package-lock.json
git commit -m "chore(deps): pin @adaptic/backend-legacy to @next dist-tag (utils U1)"
```

---

## Task 2: Locate the current `DEFAULT_TRADING_POLICY` and audit consumers

- [ ] **Step 1: Find the constant**

Run: `grep -rln "DEFAULT_TRADING_POLICY" src/`
Expected: identifies the file (typically `src/trading-policy/defaults.ts` or similar).

- [ ] **Step 2: Find every consumer**

Run: `grep -rln "DEFAULT_TRADING_POLICY\|tradeAllocationPct\|cryptoTradeAllocationPct\|equityWashTradeCooldownMs\|enableScalping" src/`

Record the list in this plan's PR description as "U1 audit footprint".

- [ ] **Step 3: Capture the SR-side current shape** for comparison

Run: `cd ~/adapticai/utils && git show origin/stable-release:src/trading-policy/defaults.ts > /tmp/sr-defaults.ts`

Read both versions side-by-side; identify every field on SR not yet on main's shape.

---

## Task 3: Write failing tests

**Files:**

- Create: `src/tests/trading-policy-defaults.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/tests/trading-policy-defaults.test.ts
import { describe, it, expect } from "vitest";
import type { TradingPolicyJson } from "@adaptic/backend-legacy";
import { DEFAULT_TRADING_POLICY } from "../trading-policy/defaults";

describe("DEFAULT_TRADING_POLICY (utils-tuned)", () => {
  it("conforms to TradingPolicyJson shape", () => {
    // Type-only assertion: this line fails to compile if shape diverges
    const _typed: Required<TradingPolicyJson> = DEFAULT_TRADING_POLICY;
    expect(_typed).toBeDefined();
  });

  it("encodes scalping defaults tuned for short-horizon day trading (SR commit 074a505)", () => {
    expect(DEFAULT_TRADING_POLICY.scalping?.enableScalping).toBe(true);
    expect(DEFAULT_TRADING_POLICY.scalping?.minHoldSeconds).toBeGreaterThan(0);
    expect(DEFAULT_TRADING_POLICY.scalping?.maxHoldSeconds).toBeGreaterThan(
      DEFAULT_TRADING_POLICY.scalping!.minHoldSeconds!,
    );
    expect(DEFAULT_TRADING_POLICY.scalping?.profitTargetBps).toBeGreaterThan(0);
    expect(DEFAULT_TRADING_POLICY.scalping?.stopLossBps).toBeGreaterThan(0);
  });

  it("surfaces equityWashTradeCooldownMs (FINRA 5210, SR commit 82cb633)", () => {
    expect(
      DEFAULT_TRADING_POLICY.compliance?.equityWashTradeCooldownMs,
    ).toBeGreaterThan(0);
  });

  it("surfaces per-trade allocation percentages at canonical paths (SR commit 883e2a9)", () => {
    expect(
      DEFAULT_TRADING_POLICY.allocation?.perTradeEquityPct,
    ).toBeGreaterThan(0);
    expect(
      DEFAULT_TRADING_POLICY.allocation?.perTradeCryptoPct,
    ).toBeGreaterThan(0);
  });

  it("enables all asset classes by default (SR commit 97c0814)", () => {
    expect(DEFAULT_TRADING_POLICY.assetClasses?.equity).toBe(true);
    expect(DEFAULT_TRADING_POLICY.assetClasses?.crypto).toBe(true);
    expect(DEFAULT_TRADING_POLICY.assetClasses?.options).toBe(true);
  });

  it("does NOT carry the SR-flat field names anymore (mapping rule applied)", () => {
    const flat = DEFAULT_TRADING_POLICY as unknown as Record<string, unknown>;
    expect(flat.tradeAllocationPct).toBeUndefined();
    expect(flat.cryptoTradeAllocationPct).toBeUndefined();
    expect(flat.equityWashTradeCooldownMs).toBeUndefined();
  });

  it("extends without losing required keys (Required<TradingPolicyJson>)", () => {
    // Lists every top-level group that must be defined for Required<> shape
    expect(DEFAULT_TRADING_POLICY.autonomy).toBeDefined();
    expect(DEFAULT_TRADING_POLICY.risk).toBeDefined();
    expect(DEFAULT_TRADING_POLICY.allocation).toBeDefined();
    expect(DEFAULT_TRADING_POLICY.scalping).toBeDefined();
    expect(DEFAULT_TRADING_POLICY.compliance).toBeDefined();
    expect(DEFAULT_TRADING_POLICY.assetClasses).toBeDefined();
    expect(DEFAULT_TRADING_POLICY.sentiment).toBeDefined();
    expect(DEFAULT_TRADING_POLICY.backtest).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run src/tests/trading-policy-defaults.test.ts`
Expected: tests fail because `DEFAULT_TRADING_POLICY` on `main` is still flat-shaped (or because the file doesn't yet conform to `TradingPolicyJson`).

---

## Task 4: Migrate `DEFAULT_TRADING_POLICY` to the JSON shape

**Files:**

- Modify: `src/trading-policy/defaults.ts` (or path identified in Task 2)

- [ ] **Step 1: Replace the constant with the JSON-shape version**

Apply the full mapping using the canonical `TradingPolicyJson` interface from `@adaptic/backend-legacy`, incorporating every SR-side tuning:

```typescript
// src/trading-policy/defaults.ts
import type { TradingPolicyJson } from "@adaptic/backend-legacy";

/**
 * Canonical fund-scope-ready default trading policy, utils-tuned for
 * short-horizon day trading. Consumed by sub-project 6 (engine) at fund
 * onboarding and by sub-project 7 (platform) as the initial fund-setup
 * wizard default.
 *
 * Aligned with TradingPolicyJson published by @adaptic/backend-legacy@next.
 * SR field tunings are migrated to their canonical JSON paths per
 * charter §2.4 mapping rules. Per-trade allocation pct, scalping config,
 * FINRA wash-trade cooldown, and broker compliance fields all live here.
 */
export const DEFAULT_TRADING_POLICY: Required<TradingPolicyJson> = {
  autonomy: {
    enableAutoEntry: true,
    enableAutoExit: true,
    enableAutoRebalance: false,
    requireHumanApprovalAboveNotional: 250_000,
  },
  risk: {
    maxPortfolioVarPct: 0.05,
    maxSinglePositionPct: 0.1,
    maxSectorExposurePct: 0.3,
    maxAssetClassPct: { equity: 1.0, crypto: 0.25, options: 0.2 },
    minBuyingPowerReservePct: 0.05,
  },
  allocation: {
    perTradeEquityPct: 0.05, // SR commit 883e2a9
    perTradeCryptoPct: 0.05, // SR commit 3cd7e79 (wider crypto)
    perTradeOptionsPct: 0.02,
    autoAllocation: true,
  },
  scalping: {
    // SR commit 074a505
    enableScalping: true,
    maxConcurrentScalps: 5,
    minHoldSeconds: 30,
    maxHoldSeconds: 900,
    profitTargetBps: 25,
    stopLossBps: 15,
    requireRSIConfirm: true,
    requireMACDConfirm: false,
    requireVolumeSurge: true,
    cooldownAfterLossMs: 60_000,
    cooldownAfterWinMs: 30_000,
    maxScalpsPerSession: 20,
  },
  compliance: {
    equityWashTradeCooldownMs: 31 * 24 * 60 * 60 * 1000, // SR commit 82cb633 (FINRA 5210, 31d)
    restrictedTickerOverrides: [],
    requireAuditLogForAll: true,
  },
  assetClasses: { equity: true, crypto: true, options: true }, // SR commit 97c0814
  sentiment: {
    minSentimentScoreToEnter: 0.2,
    maxNegativeSentimentToHold: -0.5,
    requireRecentNews: false,
    newsLookbackMinutes: 240,
  },
  backtest: {
    defaultUniverse: [],
    defaultPeriodDays: 30,
    defaultStrategyId: "",
  },
  runtime: {
    enginePersonalityProfile: "balanced",
    signalRoutingRules: null,
    manualOverrideAllowlist: [],
    riskOverrideJustifications: [],
    enableShadowMode: false,
    experimentBucket: null,
  },
};
```

- [ ] **Step 2: Run the tests, verify pass**

Run: `npx vitest run src/tests/trading-policy-defaults.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/trading-policy/defaults.ts src/tests/trading-policy-defaults.test.ts
git commit -m "feat(trading-policy): align DEFAULT_TRADING_POLICY to TradingPolicyJson shape"
```

---

## Task 5: Update internal consumers reading the flat shape

For each file flagged in Task 2's Step 2 audit:

- [ ] **Step 1: Pick the next file from the audit list**

- [ ] **Step 2: Rewrite reads to path-address through the JSON shape**

Example transformations:

| SR-flat read                       | JSON-path read                                 |
| ---------------------------------- | ---------------------------------------------- |
| `policy.tradeAllocationPct`        | `policy.allocation?.perTradeEquityPct`         |
| `policy.cryptoTradeAllocationPct`  | `policy.allocation?.perTradeCryptoPct`         |
| `policy.enableScalping`            | `policy.scalping?.enableScalping`              |
| `policy.equityWashTradeCooldownMs` | `policy.compliance?.equityWashTradeCooldownMs` |

When a consumer needs a guaranteed-defined value, do **not** add a local default — call the `effectivePolicy()` helper from `@adaptic/backend-legacy` instead. That's the single source of precedence.

- [ ] **Step 3: Run the file's existing tests; verify they still pass**

If a test references the old flat field, port the test in the same commit.

- [ ] **Step 4: Commit per file**

```bash
git add <file> <file's test>
git commit -m "refactor(trading-policy): consume <file> via TradingPolicyJson paths"
```

Repeat for every audited consumer. Typical count: 5–10 files.

---

## Task 6: Re-export the type + tuned default from the package root

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Add exports**

```typescript
// src/index.ts (additions)
export type { TradingPolicyJson } from "@adaptic/backend-legacy";
export { DEFAULT_TRADING_POLICY } from "./trading-policy/defaults";
```

(Re-exporting the type from backend-legacy gives utils consumers a single import path: `import type { TradingPolicyJson } from '@adaptic/utils'`.)

- [ ] **Step 2: Run `npm run build`**

Expected: clean Rollup output. Both `dist/index.mjs` and `dist/index.cjs` carry the new exports.

- [ ] **Step 3: Smoke-test consumption**

Inspect the generated `dist/index.d.ts` and confirm `DEFAULT_TRADING_POLICY` and `TradingPolicyJson` are exported.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(api): re-export TradingPolicyJson and DEFAULT_TRADING_POLICY from package root"
```

---

## Task 7: Final validation

- [ ] **Step 1: Run `npm run build`** — Expected: clean.
- [ ] **Step 2: Run `npm run lint`** — 0 errors.
- [ ] **Step 3: Run `npx tsc --noEmit`** — 0 errors.
- [ ] **Step 4: Run `npm test`** — all 461 existing + new tests pass.

---

## Task 8: Publish `@next`

- [ ] **Step 1: Bump version**

```bash
npm version 0.1.0-port.1 --no-git-tag-version
```

(Use `0.1.0-port.1` since utils is on the `0.0.x` line; the port-N suffix tracks port cycles per charter §5.1.)

- [ ] **Step 2: Publish**

```bash
npm publish --tag next --access public
```

- [ ] **Step 3: Verify**

```bash
npm view @adaptic/utils dist-tags
```

Expected: `next: 0.1.0-port.1`.

- [ ] **Step 4: Commit version bump**

```bash
git add package.json
git commit -m "chore(release): publish 0.1.0-port.1 to @next (utils U1)"
```

---

## Task 9: Open PR + reviewer sign-off

- [ ] **Step 1: Push**

```bash
git push -u origin port/trading-policy
```

- [ ] **Step 2: Open PR `port(utils/trading-policy): U1 align DEFAULT_TRADING_POLICY to TradingPolicyJson shape`**

PR body must reference:

- Parent spec §4.1.
- Charter §2 mapping rules.
- The audited consumer list from Task 2.

- [ ] **Step 3: Reviewer sign-off (human, not agent)**

---

## Task 10: Squash-merge to `main`

- [ ] Squash with message `port(utils/trading-policy): U1 align DEFAULT_TRADING_POLICY to TradingPolicyJson (Refs: <SR commits>)`.
- [ ] Verify `engine-main-canary` rebuilds (consumes `@adaptic/utils@next`).

---

## Done criteria

U1 is complete when:

1. Tasks 1–10 above checked off.
2. `@adaptic/utils@0.1.0-port.1` published to `@next`.
3. CI green on `main`.
4. `integration-contract-validator` reports no breakage against engine + platform main.

---

## Post-U1 plans (next)

After U1 squash-merges to `main`, U2–U7 are planned as separate documents:

- `2026-05-14-utils-U2-alpaca-api.md` — Alpaca API improvements (~35 commits).
- `2026-05-14-utils-U3-alpaca-marketdata.md` — Alpaca market-data WS + feed fallback (~12 commits).
- `2026-05-14-utils-U4-massive-rate-retry.md` — Massive + rate-limiter + retry (~20 commits).
- `2026-05-14-utils-U5-perf-metrics.md` — Bessel variance, live risk-free rate (~6 commits).
- `2026-05-14-utils-U6-logging.md` — Pino integration (~10 commits).
- `2026-05-14-utils-U7-lint.md` — Institutional-grade ESLint sweep (~5 commits).
