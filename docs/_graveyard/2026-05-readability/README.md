# 2026-05 Readability Graveyard

Snapshot archive of top-level implementation diaries and stale architecture
docs that were polluting the repo root. Created 2026-05-22 during the
agentic-readability cleanup pass on `stable-release`.

## Why archived, not deleted

These files have value as historical record (what was done, when, why),
but they were not load-bearing for current development:

- Implementation-summary diaries (`*_SUMMARY.md`, `VERIFICATION.md`) describe
  past refactors that have long since landed.
- `ARCHITECTURE.md` (1,764 lines, v0.0.382) was superseded by `docs/ARCHITECTURE.md`
  (286 lines, kept current).
- `CURRENT-ARCHITECTURE.md` and `TARGET-STATE-ARCHITECTURE.md` were point-in-time
  snapshots (2026-02-08) — all P0/P1/P2 items in the latter are marked RESOLVED.
- `VITEST_SETUP.md` documented an install step (`npm install -D vitest`) that is
  long complete; vitest is now a normal devDependency.
- `test.ts.archive` is the pre-refactor `src/test.ts` saved during the
  migration to the modular `alpaca/` SDK paths.

Git history retains the full version of each file; the archive here is a
convenience for direct readers.

## Contents

| File                                          | Last meaningful date | Reason |
| --------------------------------------------- | -------------------- | ------ |
| `ARCHITECTURE.md`                             | 2025-12-06 (v0.0.382) | Stale; replaced by `docs/ARCHITECTURE.md` |
| `ASSET_ALLOCATION_IMPLEMENTATION.md`          | 2026-02-26            | Implementation diary; see `docs/asset-allocation-guide.md` |
| `CURRENT-ARCHITECTURE.md`                     | 2026-02-08            | Point-in-time snapshot |
| `LOGGER_MIGRATION_SUMMARY.md`                 | 2026-02-06            | Migration to `alpaca/legacy/` complete |
| `REFACTORING_SUMMARY.md`                      | 2026-02-06            | Same shape as above |
| `TARGET-STATE-ARCHITECTURE.md`                | 2026-02-08            | All items marked RESOLVED |
| `TIMEOUT_COVERAGE.md`                         | 2026-02-06            | Belongs inline on `DEFAULT_TIMEOUTS` |
| `TIMEOUT_IMPLEMENTATION.md`                   | 2026-02-06            | Duplicate of TIMEOUT_COVERAGE.md |
| `TYPE_SAFETY_SUMMARY.md`                      | 2026-02-06            | Claims contradicted by current source |
| `VALIDATION_SUMMARY.md`                       | 2026-02-06            | Validation utilities self-documented |
| `VERIFICATION.md`                             | 2026-02-06            | One-time verification log |
| `VITEST_SETUP.md`                             | 2026-02-26            | Setup is done; see `docs/TESTING_STRATEGY.md` |
| `test.ts.archive`                             | 2026-02-26            | Pre-refactor scratch test file |

## What replaces these

- Current architecture: `docs/ARCHITECTURE.md`
- Conventions: `docs/CONVENTIONS.md`
- Agent rules: `docs/AGENT_RULES.md`
- Testing: `docs/TESTING_STRATEGY.md`
- Asset allocation: `docs/asset-allocation-guide.md`
- Debugging: `docs/DEBUGGING_PLAYBOOK.md`
- PR checklist: `docs/PR_CHECKLIST.md`
- Repo map: `docs/REPO_MAP.md`
