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

## Build/Test Commands

- Build: `npm run build`
- Clean: `npm run clean`
- Test: `npm run test`
- Single test: First build with `npm run build`, then run with `node dist/path/to/your/test.js`

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
