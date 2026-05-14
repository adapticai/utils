# Utils Port — Sub-Project 4 Design Spec

**Parent charter:** `~/adapticai/docs/superpowers/specs/2026-05-14-stable-release-to-main-program-charter.md`
**Repo:** `~/adapticai/utils/` (branch `main`)
**Author:** Eli Rosenberg (via Claude Opus 4.7)
**Date:** 2026-05-14
**Status:** Draft → pending review
**Publishes:** `@adaptic/utils` to npm `@next` dist-tag during the port.

---

## 0. TL;DR

`utils` is the financial-library layer (Alpaca / Massive market-data wrappers, performance metrics, technical indicators, rate-limiting, trading-policy defaults). SR is 184 commits ahead of `main` over a ~5-month divergence (Dec 2025 → May 2026). Of those, ~60 are CI bumps; ~124 are substantive: improvements to Alpaca API behavior (crypto symbol normalization, trailing-stop validation, position cancellation), Massive market-data corrections (DELAYED status propagation, NaN bug fix), rate-limiter / retry / abort-error classification, performance-metrics correctness (Bessel-corrected variance, live risk-free-rate for Sharpe), Pino logging integration, and trading-policy defaults aligned with the new JSON shape from sub-project 2. The charter §2 mapping work in this repo is light: utils does not own the `AlpacaAccount`/`BrokerageAccount` schema; its broker-API surface is identifier-agnostic (functions take `apiKey/apiSecret/account-id` tuples, not `alpacaAccountId` FKs). The principal alignment work is updating `DEFAULT_TRADING_POLICY` and related constants to match the `TradingPolicyJson` shape published by sub-project 2.

---

## 1. Inheritance from charter

All charter rules apply. §2 mapping touches this repo in three narrow places:

1. **Trading-policy constants** (`src/trading-policy/**`) — `DEFAULT_TRADING_POLICY` constant aligns to the `TradingPolicyJson` interface from `@adaptic/backend-legacy/types/trading-policy`. Currently the constant exports a flatter SR-style shape.
2. **Type imports** — any place utils imports `AlpacaAccount` from `@adaptic/backend-legacy` becomes `BrokerageAccount`. (Survey expected to be ~5 import sites.)
3. **Function names referencing `alpacaAccount`** in JSDoc or variable names — mechanical rename per charter §2.1.

Broker-API surface (functions that talk to Alpaca/Massive HTTP/WS) is untouched: these take credentials/account-tokens directly and don't know about the Adaptic data-model layer.

---

## 2. SR-only commit inventory

```
$ cd ~/adapticai/utils
$ git log origin/main..origin/stable-release --oneline | wc -l
184
```

- ~60 are `ci:` version-bump publishes (not ported; this port produces its own `@next` cadence).
- ~124 substantive commits cluster into 6 areas (§3).

Full substantive list is committed as `~/adapticai/utils/docs/superpowers/specs/appendices/2026-05-14-utils-sr-substantive-commits.txt` at kickoff (§9).

---

## 3. Area grouping

| # | Area | Commits | Branch | Depends on |
|---|------|---------|--------|------------|
| U1 | Trading-policy defaults aligned to `TradingPolicyJson` (charter §4.2) | ~12 | `port/trading-policy` | sub-project 2 publishes `@next` |
| U2 | Alpaca API improvements (positions, trailing-stops, crypto symbol normalization) | ~35 | `port/alpaca-api` | — |
| U3 | Alpaca market-data WebSocket + feed-fallback (IEX/SIP) | ~12 | `port/alpaca-marketdata` | U2 |
| U4 | Massive market-data + rate-limiter + retry classification | ~20 | `port/massive-rate-retry` | — (independent) |
| U5 | Performance metrics correctness (Bessel variance, live risk-free rate) | ~6 | `port/perf-metrics` | — (independent) |
| U6 | Pino logging integration + log-level demotion of transient errors | ~10 | `port/logging` | — (independent) |
| U7 | ESLint institutional-grade + lint-fix sweep | ~5 | `port/lint` | U1–U6 (lint runs after substantive porting) |

Areas U2, U4, U5, U6 are independent of each other and of U1; they can run in parallel via worktrees. U3 depends on U2 (shared Alpaca client code). U7 runs last.

---

## 4. Work per area

### 4.1 U1 — Trading-policy defaults

The SR commits introduced:

- `feat(trading-policy): tune defaults for short-horizon day trading / scalping` (074a505)
- `feat(trading-policy): surface equityWashTradeCooldownMs and maxDailyLossPercent` (82cb633)
- `feat(trading-policy): add canonical top-level perTradeEquityAllocationPct / perTradeCryptoAllocationPct` (883e2a9)
- `feat: update trading policy defaults for crypto — wider trailing stops, market orders, crypto enabled` (3cd7e79)
- `fix(trading-policy): enable all asset classes in DEFAULT_TRADING_POLICY` (97c0814)
- `feat: add broker compliance and signal threshold fields to trading policy schemas` (b16ad78)
- `feat: add quantModelWeight to modelPrefs schema` (5d818dc)

Port action:

1. Open `src/trading-policy/defaults.ts` (or wherever `DEFAULT_TRADING_POLICY` lives on main). Replace the current shape with the `TradingPolicyJson` shape imported from `@adaptic/backend-legacy/types/trading-policy`.
2. Migrate all SR field tunings (scalping defaults, wash-trade cooldown, per-trade allocation pcts, broker-compliance fields, signal thresholds, `quantModelWeight`) into the corresponding JSON paths.
3. Any utils-only helper that read flat SR shape (e.g. `policy.tradeAllocationPct`) gets renamed to read the JSON path (`policy.allocation.perTradeEquityPct`).
4. Re-export `DEFAULT_TRADING_POLICY` as the canonical fund-scope-ready default for downstream consumers (engine, platform onboarding).

### 4.2 U2 — Alpaca API improvements

Mechanical port of ~35 SR commits. Highlights:

- `fix(positions): normalize crypto symbols for Alpaca API compatibility` (54eff40) and related crypto-symbol fixes (905d030, 87bee5c, 23bdf2c) — port directly; Alpaca API behavior hasn't changed since SR.
- `fix(positions): verify order cancellation before closing position` (7fe5d95) — race-condition fix; port.
- `fix(alpaca/trailing-stops): tighten trailPercent validator to Alpaca's 25% cap` (bdd284b) — port.
- `fix(alpaca-api): return AlpacaOrder from createTrailingStop and updateTrailingStop` (872460b) — port (API surface change).
- `fix(positions): fallback to market order when limit order quotes unavailable` (01de619) — port.
- `fix(quotes): add SIP-to-IEX fallback for free-tier accounts` (813d7d0) — port.
- `fix(alpaca): handle crypto positions correctly in closePosition and closeAllPositions` (162b330) — port.
- `fix(positions): use passed auth instead of hardcoded env vars for quote fetching` (13f9aac) — port; aligns with charter no-hardcoded-secrets rule.

No charter §2 mapping needed — all functions take `(apiKey, apiSecret, account-id-string)` arguments, never an Adaptic `AlpacaAccount` entity.

### 4.3 U3 — Alpaca market-data WebSocket + feed fallback

- `fix(alpaca-market-data): default feed to iex, add ALPACA_MARKET_DATA_FEED env override` (a9c9163)
- `fix(alpaca-market-data): distinguish CONNECTING state from broken WS states in sendSubscription` (db4f1d0)
- `fix(alpaca-market-data): gate makeRequest through shared alpaca token bucket` (675d2fc)
- `fix(stable): iex feed fallback + in-memory cache for historical prices` — partial, the historical-prices cache lands here.

Port directly. Verify the env-var `ALPACA_MARKET_DATA_FEED` is documented in the repo's README and CLAUDE.md.

### 4.4 U4 — Massive + rate-limiter + retry

- `fix(massive): DE-006 propagate DELAYED status into return shape` (d519fb2) — port; engine and platform consume `Quote.status` to display feed staleness.
- `fix(rate-limits): align with actual plan tiers (1000/min Alpaca, unlimited Massive)` (d0a943f)
- `fix(api): wire rate limiters, retry, and timeouts into all Massive + Alpaca calls` (64c0bb2)
- `feat(retry): classify AbortError/TimeoutError/Node+undici codes + cause chain` (c28c040)
- `fix: handle 404 position errors gracefully, normalize crypto symbols for Massive API` (34863bc)
- `fix(price-utils): DE-005 NaN bug from un-invoked valueOf reference` (f1e6a73)
- `fix: add request deduplication to fetchLastTrade preventing thundering herd` (aa71e00)

Port directly. The retry classifier is shared with engine via `@adaptic/utils` exports.

### 4.5 U5 — Performance metrics correctness

- `fix(metrics): use Bessel-corrected (n-1) sample variance for beta` (fc7d20f) — correctness fix; port.
- `fix(metrics): fetch live risk-free rate for Sharpe/alpha (no more 2% hardcode)` (13bfa04) — port.
- `fix(risk-free-rate): DE-029 surface provenance of risk-free rate` (35a383c) — port.

These are pure mathematical/data-quality fixes; no mapping touch.

### 4.6 U6 — Pino logging integration

- `fix(logging): route log() through injected Pino logger when wired (Wave 51)` (4317907) — port; aligns with engine's logger.
- `fix(stable): drop manual [DEBUG][LEVEL] message prefixes from logIfDebug` (8c36f68) — port.
- `fix(logs): demote transient errors in legacy getOrders too` (8de98c3) — port.
- `fix(logs): demote transient network errors to WARN in utils` (bb4a5e8) — port.

### 4.7 U7 — ESLint institutional-grade

- `chore: add institutional-grade ESLint config (previously missing)` (4ee3eef) — port.
- `fix: resolve all 254 lint errors for institutional-grade type safety` (7298a45) — port last; runs after U1–U6 because those changes will introduce new lint fixups.

### 4.8 Backend-legacy dependency bump

Replace `@adaptic/backend-legacy: <pinned>` with `@adaptic/backend-legacy: next` in `package.json` per charter §5.1. Pinned-back at Freeze.

---

## 5. Publish coordination

Per charter §5:

1. After each area's squash-merge to `main`, run `npm version <0.x.y-port.N>` and `npm publish --tag next`.
2. Downstream consumers (engine, platform, app marketing site) consume `@next`.
3. Emergency SR hotfix during port: dual-tag (charter §5.1).

---

## 6. Per-repo parity bar (instantiates charter §6.1)

1. All 7 areas merged to `main` with full test coverage of touched modules.
2. CI green: `npm run build`, `npm test` (461 tests must pass), ESLint 0 errors.
3. `@adaptic/utils@<port.7>` published to `@next`.
4. `integration-contract-validator` reports no breakage against engine + platform main.
5. Per-area human reviewer sign-off.

---

## 7. Tests to port + add

- All 461 existing main tests must continue to pass.
- SR added crypto-symbol-normalization tests and retry-classifier tests — port these.
- New tests for `DEFAULT_TRADING_POLICY` shape alignment with `TradingPolicyJson` (round-trip test: `TradingPolicyJson.parse(DEFAULT_TRADING_POLICY)` succeeds).

---

## 8. Open questions & assumptions

### 8.1 Assumptions

- **U-A1.** `@adaptic/backend-legacy@next` publishes the `TradingPolicyJson` type as expected (sub-project 2 §4.2 contract).
- **U-A2.** Engine and platform consume `DEFAULT_TRADING_POLICY` as the seed for new fund/brokerage account onboarding — confirmed with sub-project 6 (platform) at its kickoff.
- **U-A3.** No SR commit introduces a `utils`-side schema (this repo has no Prisma schema).

### 8.2 Deferred

- Whether to promote any of the broker-compliance fields from `TradingPolicyJson.compliance` to a typed enum (currently free-string). Decision deferred to sub-project 6's UI work.

---

## 9. Execution kickoff checklist

When this spec is approved and execution starts:

1. Generate `docs/superpowers/specs/appendices/2026-05-14-utils-sr-substantive-commits.txt`.
2. Open all 7 `port/<area>` branches from `main`.
3. Open tracking issue `Sub-project 4: utils stable-release → main port`.

---

## 10. Glossary

See parent charter §11. No additional terms.
