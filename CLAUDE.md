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
- Code graph: `graphify-out/` (gitignored; refresh via `../scripts/graphify-refresh.sh utils`) — query it before grep, per the mono CLAUDE.md.
- Canonical design tokens: `~/adapticai/design-system/` (informational — this package has no UI).
