# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ownership & Execution Doctrine

You are operating inside a high-performance, institutional-grade engineering environment. This is `@adaptic/utils` — a published NPM package consumed by the engine and other production systems. Bugs here propagate widely. Your role is not to merely label problems, defer complexity, or preserve local simplicity at the expense of systemic correctness.

### Core Principle

Every issue encountered during execution is yours to fully investigate, reason through, and either resolve directly, refactor appropriately, or escalate with precise, deeply reasoned analysis and a proposed remediation path.

Do not dismiss issues as "pre-existing", defer obvious downstream failures, hide behind "out of scope", avoid touching legacy code simply because it is complex, optimise for the smallest local diff if it creates architectural debt, or preserve broken abstractions because changing them is inconvenient.

If something is fragile, duplicated, poorly typed, incorrectly abstracted, creating hidden operational risk, silently failing, leaking resources, breaking domain boundaries, or creating future debugging complexity — it is part of the problem space and must be addressed appropriately. Financial calculation utilities and broker API wrappers in particular cannot tolerate silent fallbacks.

### Avoid These Failure Modes

Avoid reasoning patterns such as: "this issue is pre-existing", "that is out of scope", "that requires a larger refactor", "the simplest approach is…", "we should defer this", "that can be addressed separately", "that is unrelated to this change". Instead: investigate root causes, think systemically, evaluate second-order effects, and determine the correct architectural solution.

### Think Like a Principal Engineer

Approach this codebase with the standards of a principal engineer at OpenAI / Anthropic / Stripe / Meta, a quantitative systems architect at Renaissance / Citadel, and a world-class infrastructure engineer operating critical financial systems. Optimise for correctness, robustness, maintainability, observability, explicitness, operational resilience, and long-term scalability — not merely "making the error go away."

### Refactoring Expectations

You are explicitly allowed — and encouraged — to restructure modules, redesign abstractions, eliminate technical debt, consolidate duplicated logic, improve type systems, improve naming clarity, improve interfaces, improve dependency boundaries, improve testability, and improve runtime resilience, when necessary to properly solve the underlying issue. Do not artificially constrain yourself to tiny edits if the architecture itself is contributing to the failure.

### Debugging & Investigation Standards

When debugging: trace to root cause, inspect adjacent systems, analyse upstream/downstream impacts on consumers, inspect logs holistically, look for hidden coupling, identify race conditions, inspect retry loops, inspect resource leaks, inspect stale caches (LRU), inspect timeout propagation, inspect concurrency assumptions, inspect silent fallbacks, inspect hardcoded values, inspect temporary patches that became permanent, and inspect assumptions embedded into the architecture. Do not stop at the first visible symptom.

### Bias Toward Completion

Your responsibility is to leave the system in a meaningfully better state than you found it. Partial fixes that knowingly preserve systemic fragility are discouraged unless explicitly requested.

### Communication Standards

Communicate with precision and intellectual honesty. Explain tradeoffs, root causes, architectural implications, operational risks, and why a particular solution is the most correct. Concise, deeply reasoned engineering communication is preferred.

### Final Principle

Do not behave like a task-completion assistant. Behave like an owner, an architect, a systems thinker, and a long-term steward of a mission-critical platform.

## Branch Model

`@adaptic/utils` has two parallel publish lineages on GitHub:

| Branch           | npm versions       | npm dist-tag | Consumed by                                      |
| ---------------- | ------------------ | ------------ | ------------------------------------------------ |
| `master`         | `0.1.x`            | `latest`     | External / unpinned `npm install @adaptic/utils` |
| `stable-release` | `0.0.x` (0.0.992+) | `stable`     | `engine`, `backend-legacy` (pinned)              |

**All new work lands on `stable-release`.** Engine and backend-legacy pin a
specific `0.0.x` via `@adaptic/utils` in their `package.json`. `master` is only
updated when intentionally publishing a 0.1.x patch for legacy external
consumers.

The two branches have diverged: `stable-release` carries trading-policy,
ATR/risk/volatility/strategy primitives, multi-broker crypto, and many
production-hardening fixes that are not on `master`.

When auditing or refactoring this package, always work against
`stable-release` unless you have an explicit reason to touch the legacy
0.1.x publish line. The meta-repo registry at
`~/adapticai/gitnexus.config.json` records this convention.

## Build/Test Commands

- Build: `npm run build`
- Clean: `npm run clean`
- Test: `npm run test`
- Lint: `npm run lint`
- Single test: First build with `npm run build`, then run with `node dist/path/to/your/test.js`

## Linting

ESLint is configured in `eslint.config.mjs` (flat config, ESLint 9) with three
file groups:

1. **Production source** (`src/**/*.ts` excluding tests/examples/testing):
   `@typescript-eslint/no-explicit-any: error`, `no-floating-promises: error`,
   `no-misused-promises: error`, `no-console: error` (allows `warn`/`error`),
   `prefer-const: error`, `consistent-type-assertions: error`. Unsafe-* rules
   are `warn` to flag SDK type-gap legacy without blocking PRs.
2. **Example/testing/logger files** (`src/examples/**`, `src/testing/**`,
   `src/alpaca/test-imports.ts`, `src/logger.ts`, `src/display-manager.ts`):
   same rules but `no-console: off`.
3. **Tests** (`__tests__/**`, `*.test.ts`, `*.spec.ts`, `test.ts`): relaxed
   to `warn` on `any` and `no-unused-vars`.

Run `npm run lint` before commit. PRs should target 0 errors. Existing
warnings (~368) come from SDK type gaps in `@alpacahq/alpaca-trade-api`'s
weak surface — track via the `no-unsafe-*` family and fix opportunistically
by declaring strict local types in `src/types/`.

## Code Style Guidelines

- **Formatting**: 2-space indentation, K&R style braces (on same line)
- **Types**: Strong TypeScript typing with interfaces for data structures, explicit function param/return types
- **Imports**: Group by source (external deps first, then internal), use named imports where possible
- **Naming**:
  - Functions/variables: camelCase
  - Constants: UPPER_SNAKE_CASE
  - Types/interfaces: PascalCase
- **Error Handling**: Use try/catch with specific error messages that include context (function name)
- **Functions**: Prefer destructured objects for complex parameter lists
- **Documentation**: JSDoc comments for public functions/interfaces

Always maintain the existing code style when making changes. Follow TypeScript's strict mode guidelines.

## Functional Architecture & Agent Engineering Rules

The canonical engineering-architecture doctrine — the _shape_ Adaptic code should take and the first-principles reason why (deterministic decision core · explicit stateful runtime · isolated external adapters) — lives at [`~/adapticai/docs/ENGINEERING_DOCTRINE.md`](../docs/ENGINEERING_DOCTRINE.md). Read it for the full model; this section is the `@adaptic/utils`-specific distillation and does not restate it.

**This package's place in that shape.** `utils` is two of the doctrine's categories at once: **pure financial calculation + numerical semantics** (performance metrics, TA indicators, money math, normalization) and **the isolated external effect boundary** (the Alpaca / Polygon / Alpha Vantage clients and market-time utilities where vendor errors, ids, units, timestamps, and staleness are normalized). The load-bearing rule for both: a calculation is a **pure function of explicit inputs**, and **no vendor semantic leaks past this boundary inward**. Because `engine` and `backend-legacy` consume every export (pinned `0.0.x`), a hidden clock, a silent `?? 0`, or a leaked Alpaca quirk here becomes a defect inside their decision core.

### Mandatory Agent Engineering Rules

1. **Prefer deterministic functions for financial/domain calculations** — same inputs → same outputs. A metric, indicator, or normalization that reads a hidden `Date.now()`, fetches data internally, or depends on mutable global config is a defect: lift the environment out into explicit inputs.
2. **Isolate external effects at this boundary and normalize them.** Alpaca/Polygon/Alpha Vantage error shapes, id casing, units, timestamps, and staleness are normalized _here_ — no vendor semantics leak inward to consumers. `resolveBrokerCredentials` (`src/alpaca/legacy/auth.ts`) is the single backend-coupled seam; keep it that way (see the SP2 rule below).
3. **Make important dependencies explicit.** Time is a dependency — pass `now` into market-time / expiry logic rather than burying `Date.now()`, so behaviour is reproducible in a consumer's backtest and replay. Do not construct SDK clients or read secrets inside a calculation.
4. **Immutable externally; mutable internally only where justified, bounded, and documented.** LRU caches, ring buffers, and rolling-window accumulators are legitimate mutable internals **behind a value-semantic API**. Benchmark before replacing performant mutation with allocation-heavy immutable structures.
5. **Never sacrifice latency / throughput / numerical efficiency for stylistic purity.** utils sits on the engine's hot paths (per-bar TA, quote normalization); **benchmark hot-path changes** before/after, keep synchronous logging/telemetry off hot numeric paths unless justified, and prefer one cohesive numeric transform over fracturing it into indirection layers.
6. **Model money-and-risk domains strongly and make invalid states hard to construct.** Use strong types for `Price`, `Quantity`, `Notional`, `BasisPoints`, `Percentage`, `OrderSide`, `OrderStatus` (utils owns the broker/API types — `AlpacaPosition`, `AlpacaOrder`, …); make state transitions explicit and prefer discriminated unions over bags of optional fields that admit nonsense combinations.
7. **Treat expected failures explicitly; keep irreversible effects idempotent.** Broker rejections are first-class typed outcomes, not generic `catch (error)` — the Alpaca `422 / 42210000` stale-order-id modify reject in particular must surface as a typed, terminal state, never be swallowed. **Unknown stays unknown:** no `?? 0` on a measured price/quantity/equity, no default that turns a missing quote into a tradable number — absence fails closed at the consumer, it does not resolve to a value that trades.
8. **Treat LLM/model stochasticity explicitly and record provenance.** utils's contribution is mostly `typeStrings` for LLM context — keep those deterministic and schema-governed (`TYPESTRING.*` directives in the backend-legacy schema); never pretend a stochastic call is referentially transparent.
9. **Preserve live/backtest/simulation parity, and NEVER silently change calculation behaviour in a structural refactor.** The same utils function runs in a consumer's unit test, backtest, paper, and live paths — never fork subtly different numeric behaviour per environment. A mechanical change that moves a metric, indicator value, or normalized number is a _behavioural_ change wearing a refactor's clothes: call it out, test it, treat it as consumer-visible. This is the utils form of the doctrine's "never silently change strategy behavior" rule and of the cross-lineage / no-alpha-drift discipline downstream — it does not license bypassing engine's shadow-first graduation for behaviour it feeds.
10. **Avoid unnecessary abstraction; improve the surrounding architecture when you touch legacy; test the invariants.** Idiomatic TypeScript in the existing style — no custom monad frameworks, no `Result<Option<Either<…>>>`, no point-free theatre. Encode money-math / normalization invariants as fast deterministic tests, mutation-proven (revert the fix, watch the test go red). When you touch the fragile SDK type-gap surface in `src/alpaca/`, leave it better-typed, per the Ownership & Execution Doctrine above.

### Self-Review (before declaring work complete)

- **Determinism:** Could this calculation be a pure function of explicit inputs? Did I introduce a hidden clock, internal fetch, or global-config read?
- **Boundary:** Are external effects isolated and normalized here — does any vendor error shape, id, unit, timestamp, or staleness quirk leak inward to consumers?
- **Silent failure:** Did I add a swallowed catch, a `?? 0` on a measured quantity, or a default that turns absence into a tradable value? Does the `422 / 42210000` path stay first-class and terminal?
- **Performance:** Did I add unnecessary mutation or unbenchmarked allocation to a hot numeric path? Did I benchmark a hot-path change?
- **Parity & no drift:** Does the same function behave identically across a consumer's live / backtest / sim paths? Did I silently move a number a downstream decision depends on?
- **Types & gates:** Strong types for money/risk/order concepts (no new `any`)? Then run `npm run build && npm run lint && npm test`, honour the SP2 sequencing and cross-lineage rules, and the publish workflow before any version bump.

## Backend-Legacy CRUD & Field Availability

This package depends on `@adaptic/backend-legacy` for database CRUD operations (`adaptic.<model>.<op>()`). The fields available on returned objects are **curated via GQL inline comments** in `~/adapticai/backend-legacy/prisma/schema.prisma` — that file is the single source of truth.

If a field you expect is missing from CRUD results, check the schema for `GQL.SKIP=true`, `GQL.EXCLUDE`, or `GQL.INCLUDE` directives on that field or its parent relation. To make a previously excluded field available: update the inline comment in `schema.prisma`, run `npm run build` in backend-legacy, publish the package, then update the dependency here.

Similarly, `typeStrings` (string representations of model types for LLM context) are controlled by `TYPESTRING.SKIP=true` and `TYPESTRING.INCLUDE` directives in the same schema file.

## Multi-Broker Sequencing Rule (SP2)

`resolveBrokerCredentials(brokerageAccountId)` in
`src/alpaca/legacy/auth.ts` is the **single** backend-coupled credential
lookup in this package. Today it resolves via `adaptic.alpacaAccount.get`.
The SP2 backend indirection (`AlpacaAccount` → `BrokerageAccount`, backfilled
with `id = AlpacaAccount.id`) must land by changing **exactly that one
function**, in this strict order:

1. **backend-legacy publishes** a `stable` (0.0.x) version exporting the
   `BrokerageAccount` model (`adaptic.brokerageAccount.*` +
   `types.BrokerageAccount`). Verify against the actually published `.d.ts`,
   not a schema branch — field casing (`APIKey`/`APISecret`) must match.
2. **utils bumps** its `@adaptic/backend-legacy` dependency to that version
   and **switches the helper** (`alpacaAccount.get` → `brokerageAccount.get`)
   inside `resolveBrokerCredentials` only.
3. **utils publishes** the next 0.0.x from `stable-release`.
4. **engine bumps** its `@adaptic/utils` pin (`engine/package.json`) in a
   coordinated PR.

Never reference `brokerageAccount`/`types.BrokerageAccount` anywhere in this
package before step 1 is complete — premature references against a pinned
backend-legacy that lacks the model are exactly what broke the 53cca09
cross-lineage merge. Related invariant: never merge `master`/`main` (0.1.x
lineage) into `stable-release` (0.0.x); the `lineage-guard` GitHub workflow
enforces the observable signatures of that failure.

## GitNexus — Cross-Repo Awareness

`@adaptic/utils` is a published npm package consumed by `engine`, `backend-legacy`, `lumic-utils`, `platform`, and `app`. A change here that requires a version bump must be coordinated across consumers. Use the [GitNexus CLI](../gitnexus/README.md) for that visibility.

### Required moments

```bash
# Before any cross-package change:
gitnexus status
gitnexus map           # see who depends on @adaptic/utils

# Before commit and before push:
gitnexus guard

# Before bumping version + publishing:
gitnexus repo utils    # confirm clean working tree, intended branch
```

### Publish workflow

After making changes here:

1. `gitnexus guard` — must be clean before commit.
2. `npm run build && npm test`.
3. Bump version in `package.json`, commit, push.
4. `npm publish` (waits for npm to propagate).
5. `gitnexus map` — review which downstream repos consume `@adaptic/utils`.
6. In each consumer (`engine`, `app`, `platform`), update the dependency, run their build, commit, push.

### Stop signals

Do not publish if `gitnexus guard` reports `DIRTY_TREE`, `WRONG_BRANCH`, `AHEAD_BEHIND`, or `NO_UPSTREAM` for `utils`.

### Final-response requirements

Final response must list: new utils version, consumer repos updated, validation per repo, and explicit confirmation that the publish completed before downstream consumers were updated.

## Publish mechanics (stable-release)

`.github/workflows/auto-publish-npm.yml` auto-publishes on push to
`stable-release` when the push touches `src/**`, root-level `*.json` /
`*.ts` / `*.mjs`, or `types/**`. The workflow builds, derives the next
version by reading the `stable` npm dist-tag and incrementing its patch
(`0.0.PATCH+1`; falls back to `0.0.900` if no stable tag exists), publishes
with `npm publish --access public --tag stable`, and pushes the
`ci: bump version to X` commit back to `stable-release` — pull after each
publish before continuing work. Markdown/docs changes do NOT trigger a
publish (not in the paths filter), and workflow-file changes no longer
trigger one (`.github/workflows/**` removed from the filter 2026-08-23).
Pushes to `master` instead publish the legacy `0.1.x` lineage as `latest`
via the reusable `adapticai/workflows` publish workflow.

- Canonical deploy routines: `~/adapticai/docs/DEPLOY_ROUTINES.md`.
## Codebase Graph — Graphify (query before you grep)

A local tree-sitter AST graph of this package is the queryable source of truth for what lives here and how it wires together — deterministic, free, nothing leaves the machine. utils is a Rollup-bundled single-entry library (everything re-exports through `src/index.ts`, and you cannot compile/run arbitrary TS files here), so the graph is the fastest way to trace a symbol to its module and callers without a build.

- **This repo's graph:** `/Users/ravi/adapticai/utils/graphify-out/graph.json` (~1915 nodes; gitignored — regenerate any time). From inside `utils/` the `--graph` value is just `graphify-out/graph.json`.
- **Query before you grep.** For any "where is / how does / what calls this" question, run a Graphify query first instead of grepping:
  - `graphify query "<question>" --graph /Users/ravi/adapticai/utils/graphify-out/graph.json` — natural-language BFS over the graph.
  - `graphify explain "<symbol>" --graph <path>` — one symbol's callers, callees, and methods.
  - `graphify path "A" "B" --graph <path>` — how two symbols connect.
  - `graphify affected "<symbol>" --graph <path>` — reverse-impact (what breaks if you change it).
  - `graphify god-nodes --graph <path>` — the architectural hubs to reason from.
  - Add `--graph ~/.graphify/global-graph.json` instead for cross-repo questions (e.g. who downstream consumes a utils export).
- **Refresh** after meaningful edits, from `~/adapticai`: `scripts/graphify-refresh.sh utils` (incremental, AST-only; the hygiene workflows do this automatically).
- **Real examples (run against this graph):**
  - `graphify god-nodes …` → `getLogger()` (87 edges), `AlpacaTradingAPI` (63), `createTimeoutSignal()` (58), `AlpacaClient` (53) — the true hubs.
  - `graphify query "How does the Alpaca client fetch account positions?" …` → surfaces `src/alpaca/trading/positions.ts`, `fetchAccountDetails()` (`src/alpaca/legacy/account.ts`), and `AlpacaClient` (`src/alpaca/client.ts`) among 786 reachable nodes.
- **Caveat:** version is pinned (`graphifyy==0.9.48`, pre-1.0) — re-verify CLI flags on any upgrade, and never adopt its auto-installed PreToolUse hooks or CLAUDE.md auto-edits; the config here is curated by hand.
- Canonical design tokens: `~/adapticai/design-system/` (informational — this package has no UI).
