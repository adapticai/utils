/**
 * Scan-scope rules: what is a call site, what is noise, and what is a registry.
 *
 * Three outcomes are possible for a file, and the distinction matters to the
 * audit. Excluded files are noise (tests, build output). Registry files hold
 * vendor strings legitimately — a price table, a generated type union, the
 * route table itself — and are recorded with a reason rather than dropped,
 * because a silently dropped file is indistinguishable from a missed one.
 * Everything else is scanned.
 *
 * @module scripts/inventory/exclusions
 */

import type { RegistryRecord } from "./types";

/** Path segments whose presence anywhere in a path removes the file from scope. */
export const EXCLUDED_PATH_SEGMENTS: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".turbo",
  ".next",
  "__tests__",
  "__mocks__",
  "__fixtures__",
  "fixtures",
  "graphify-out",
  "_graveyard",
];

/** Repo-relative POSIX path prefixes that hold tests rather than production code. */
export const EXCLUDED_PATH_PREFIXES: readonly string[] = [
  "src/tests/",
  "src/test/",
  "tests/",
  "test/",
];

/** File-name suffixes that mark a test, a declaration, or a build artefact. */
export const EXCLUDED_FILE_SUFFIXES: readonly string[] = [
  ".test.ts",
  ".test.mts",
  ".test.js",
  ".test.mjs",
  ".spec.ts",
  ".spec.mts",
  ".spec.js",
  ".spec.mjs",
  ".d.ts",
  ".d.mts",
];

/** File extensions the scanner parses. */
export const SCANNED_FILE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
];

/**
 * The scanner's own sources.
 *
 * The detector tables necessarily contain every vendor model family and every
 * provider key name; scanning them would report the measuring instrument as a
 * call site. The prefix names one directory that holds nothing but the scanner,
 * so it stays tight as the core grows and cannot quietly widen to cover code
 * that is under audit.
 */
export const SELF_EXCLUDED_PREFIXES: readonly string[] = [
  "utils/scripts/inventory/",
];

/** The scanner entry point itself, excluded by identity. */
export const SELF_EXCLUDED_PATHS: readonly string[] = [
  "utils/scripts/scan-llm-inventory.mjs",
];

/**
 * Files that hold vendor model strings as data rather than as a call.
 *
 * Each entry names why the file is a registry. A registry is a lookup table the
 * migration re-points once; a call site is a place a decision is made. Treating
 * a registry as hundreds of call sites would drown the inventory in noise and
 * make the W1-02 classification pass unfalsifiable.
 */
export const REGISTRY_FILES: readonly RegistryRecord[] = [
  {
    path: "lumic-utils/src/types/openai-types.ts",
    reason:
      "Model registry: the SUPPORTED_MODELS / MODEL_ALIASES tables that every provider router resolves against. One table, re-pointed once, not a call site.",
  },
  {
    path: "lumic-utils/src/functions/llm-config.ts",
    reason:
      "Provider/model default configuration for the shared client. Holds vendor ids as configuration values, issues no call.",
  },
  {
    path: "engine/src/config/model-token-limits.ts",
    reason:
      "Per-model token-ceiling lookup table. Vendor ids are the table keys; the file makes no provider call.",
  },
  {
    path: "utils/src/llm/alias-routes.json",
    reason:
      "The alias route table itself. Vendor ids here are the authoring surface the migration exists to concentrate them into.",
  },
  {
    path: "backend-legacy/src/types/llm-configuration.ts",
    reason:
      "Generated type registry for the LlmConfiguration model. Vendor ids appear as a permitted-value union, not as a call.",
  },
];

/** Why a path was kept, skipped, or recorded as a registry. */
export type ScopeDecision =
  | { readonly kind: "scan" }
  | { readonly kind: "excluded"; readonly reason: string }
  | { readonly kind: "registry"; readonly reason: string };

const REGISTRY_BY_PATH: ReadonlyMap<string, string> = new Map(
  REGISTRY_FILES.map((entry) => [entry.path, entry.reason]),
);

/**
 * Decide how a single file is treated by the scan.
 *
 * Registry membership is checked before exclusion so that a registry inside an
 * otherwise-excluded location still surfaces in the `registries` array, and
 * exclusion is checked before scanning so noise never becomes a site.
 *
 * @param repo - Repository name the file belongs to.
 * @param repoRelativePath - POSIX path of the file, relative to the repo root.
 * @returns The scope decision, carrying a reason whenever the file is not scanned.
 */
export function classifyScope(
  repo: string,
  repoRelativePath: string,
): ScopeDecision {
  const qualified = `${repo}/${repoRelativePath}`;

  const registryReason = REGISTRY_BY_PATH.get(qualified);
  if (registryReason !== undefined) {
    return { kind: "registry", reason: registryReason };
  }

  const selfExcluded =
    SELF_EXCLUDED_PATHS.includes(qualified) ||
    SELF_EXCLUDED_PREFIXES.some((prefix) => qualified.startsWith(prefix));
  if (selfExcluded) {
    return {
      kind: "excluded",
      reason: "scanner's own detector tables",
    };
  }

  const segments = repoRelativePath.split("/");
  const excludedSegment = segments.find((segment) =>
    EXCLUDED_PATH_SEGMENTS.includes(segment),
  );
  if (excludedSegment !== undefined) {
    return {
      kind: "excluded",
      reason: `path segment "${excludedSegment}" is out of scope`,
    };
  }

  const prefix = EXCLUDED_PATH_PREFIXES.find((candidate) =>
    repoRelativePath.startsWith(candidate),
  );
  if (prefix !== undefined) {
    return { kind: "excluded", reason: `path prefix "${prefix}" holds tests` };
  }

  const suffix = EXCLUDED_FILE_SUFFIXES.find((candidate) =>
    repoRelativePath.endsWith(candidate),
  );
  if (suffix !== undefined) {
    return { kind: "excluded", reason: `file suffix "${suffix}" is not production code` };
  }

  const extension = SCANNED_FILE_EXTENSIONS.find((candidate) =>
    repoRelativePath.endsWith(candidate),
  );
  if (extension === undefined) {
    return { kind: "excluded", reason: "unparsed file extension" };
  }

  return { kind: "scan" };
}
