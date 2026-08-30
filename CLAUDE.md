# CLAUDE.md — @adaptic/utils

Financial-calculation library and the vendor boundary: pure metrics/TA/money math plus the Alpaca / Polygon / Alpha Vantage clients and market-time utilities where errors, ids, units, timestamps, and staleness get normalized. Consumed **pinned** (`0.0.x`) by `engine` and `backend-legacy`, so a hidden clock, a silent `?? 0`, or a leaked Alpaca quirk here becomes a defect inside their decision core. The root `~/adapticai/CLAUDE.md` loads alongside this file and carries the shared standards (ownership doctrine, code standards, delivery bar, trading doctrines, publish chain, GitNexus/Graphify usage); this file adds only what is utils-specific.

## Branch & lineage (deltas to the root model)

- **All new work lands on `stable-release`** (`0.0.x`, `@stable`). `master` (`0.1.x`, `@latest`) is touched only to intentionally patch the legacy external line.
- The branches have diverged: `stable-release` carries trading-policy, ATR/risk/volatility/strategy primitives, multi-broker crypto, and production hardening absent from `master`. Audit and refactor against `stable-release` unless explicitly working the legacy line.
- **Never merge `master`/`main` into `stable-release`** — the `lineage-guard` GitHub workflow enforces the observable signatures of that failure; the `53cca09` cross-lineage merge is the cautionary case.

## Commands

```bash
npm run build && npm run lint && npm test
# single ad-hoc check: this is a Rollup single-entry bundle (everything re-exports
# through src/index.ts) — you cannot compile/run arbitrary TS files. Either add a
# call in src/test.ts and `npm run test`, or build then `node dist/path/to/file.js`.
```

Lint: PRs target 0 errors. The standing warnings are `@alpacahq/alpaca-trade-api` SDK type-gap legacy (`no-unsafe-*` family) — never add to them; burn down opportunistically by declaring strict local types in `src/types/`.

## Engineering rules (utils register — generic rules live in `../docs/ENGINEERING_DOCTRINE.md` and the root file)

1. Calculations are pure functions of explicit inputs — no hidden `Date.now()`, internal fetch, or mutable global config. Pass `now` into market-time/expiry logic so consumers' backtests and replays reproduce.
2. This is the vendor boundary: vendor error shapes, id casing, units, timestamps, and staleness are normalized **here**; no vendor semantic leaks inward. The Alpaca `422/42210000` stale-order-id reject surfaces as a typed, terminal outcome — never swallowed.
3. Unknown stays unknown: no `?? 0` on a measured price/quantity/equity; absence fails closed at the consumer, never resolves to a value that trades.
4. `resolveBrokerCredentials` (`src/alpaca/legacy/auth.ts`) is the **single** backend-coupled seam in this package — keep it that way (SP2 below).
5. utils sits on engine hot paths (per-bar TA, quote normalization): benchmark hot-path changes before/after. LRU / ring-buffer / rolling-window mutation is legitimate behind a value-semantic API.
6. utils owns the broker/API types (`AlpacaPosition`, `AlpacaOrder`, …): strong money/risk/order types, discriminated unions over optional-field bags.
7. **Calculation parity.** The same function runs in consumers' unit / backtest / paper / live paths. A refactor that moves a metric, indicator value, or normalized number is a behavioral, consumer-visible change — call it out, test it, and it never bypasses the engine's shadow-first graduation downstream.
8. `typeStrings` stay deterministic and schema-governed (`TYPESTRING.*` directives in the backend-legacy schema); fields on `adaptic.*` results are curated by `GQL.*` comments there (mechanics in the root file).
9. Money-math and normalization invariants get fast, deterministic, mutation-proven tests; when touching the fragile SDK type-gap surface in `src/alpaca/`, leave it better typed.

## SP2 sequencing rule (multi-broker credential indirection)

The `AlpacaAccount` → `BrokerageAccount` backend indirection lands by changing **exactly one function** — `resolveBrokerCredentials` — in this strict order:

1. backend-legacy publishes a `stable` (`0.0.x`) version exporting `BrokerageAccount` (`adaptic.brokerageAccount.*` + `types.BrokerageAccount`). Verify against the **published `.d.ts`**, not a schema branch — field casing (`APIKey`/`APISecret`) must match.
2. utils bumps its `@adaptic/backend-legacy` dependency and switches the helper (`alpacaAccount.get` → `brokerageAccount.get`) inside `resolveBrokerCredentials` only.
3. utils publishes the next `0.0.x` from `stable-release`.
4. engine bumps its `@adaptic/utils` pin in a coordinated PR.

Never reference `brokerageAccount` / `types.BrokerageAccount` anywhere in this package before step 1 completes — premature references against a pinned backend-legacy lacking the model are exactly what broke the `53cca09` merge.

## Publish mechanics (stable-release)

`.github/workflows/auto-publish-npm.yml` publishes on any push touching `src/**`, root `*.json`/`*.ts`/`*.mjs`, or `types/**`. CI derives the version itself (reads the `stable` dist-tag, increments the patch; falls back to `0.0.900`), publishes `--tag stable`, and **pushes a `ci: bump version` commit back to `stable-release` — pull after every publish before continuing work.** Never hand-race that bump. Markdown/docs and workflow-file changes do not trigger a publish. Pushes to `master` publish the legacy `0.1.x` as `latest` via the reusable `adapticai/workflows` publish. Cross-repo propagation follows the root's sequential chain; do not publish on guard `DIRTY_TREE` / `WRONG_BRANCH` / `AHEAD_BEHIND` / `NO_UPSTREAM`, and confirm the publish landed on npm before updating consumers.

## Codebase graph

Single-entry Rollup bundling makes grep noisy here — the graph traces a symbol to its module and callers without a build: `graphify query "<q>" --graph graphify-out/graph.json`; refresh via `../scripts/graphify-refresh.sh utils`. Usage and caveats in the root file.

---

Keep this file to utils deltas only — shared rules live in the root file; no point-in-time counts (warning tallies, node counts) — they rot.
