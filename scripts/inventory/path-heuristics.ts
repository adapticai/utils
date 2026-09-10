/**
 * Path-based classification of a call site's latency budget and blast radius.
 *
 * The scanner cannot read intent, but location in this codebase is a strong
 * and inspectable proxy: signal emission and order lifecycle live under known
 * roots, monitoring and cost governance under others, backtest and CLI under
 * others again. The table below is the whole of that judgement, expressed as
 * data so a reviewer can disagree with one row rather than re-read a walker.
 *
 * The classification is deliberately conservative: a path no rule matches is
 * emitted as `hot-path` / `trading-adjacent`. An unclassified site that is in
 * fact trading-adjacent must never be silently downgraded, because the
 * downgrade is what would let it skip the strictest eval gate.
 *
 * @module scripts/inventory/path-heuristics
 */

import type { Criticality, LatencyClass } from "./types";

/**
 * Version of this table, emitted with every inventory document.
 *
 * The W1-02 agent classification pass overrides these values per site; it can
 * only report what it overrode if the artefact states which table produced the
 * prior value. Bump on any change to {@link PATH_HEURISTIC_RULES} or to the
 * conservative default.
 */
export const HEURISTICS_VERSION = "1.0.0";

/** One ordered classification rule. The first matching rule wins. */
export interface PathHeuristicRule {
  /** Stable identifier for the rule, quotable in a review. */
  readonly id: string;
  /** Repository the rule applies to, or `"*"` for every repository. */
  readonly repo: string;
  /** Repo-relative path fragments; the rule matches when any one is present. */
  readonly pathContains: readonly string[];
  /** Latency budget assigned by this rule. */
  readonly latencyClass: LatencyClass;
  /** Blast radius assigned by this rule. */
  readonly criticality: Criticality;
  /** Why this location carries this classification. */
  readonly rationale: string;
}

/**
 * The classification table, evaluated top to bottom.
 *
 * Order encodes precedence: a backtest simulator under a trading service is
 * still a backtest, so the offline rules are stated before the trading ones.
 */
export const PATH_HEURISTIC_RULES: readonly PathHeuristicRule[] = [
  {
    id: "offline-backtest",
    repo: "*",
    pathContains: ["/backtest/", "src/backtest/", "/simulators/", "/replay/"],
    latencyClass: "batch",
    criticality: "internal",
    rationale:
      "Backtest and replay code runs against recorded data with no live order consequence, and has no interactive latency budget.",
  },
  {
    id: "offline-cli-and-scripts",
    repo: "*",
    pathContains: ["src/cli/", "scripts/", "/tools/"],
    latencyClass: "batch",
    criticality: "internal",
    rationale:
      "Operator-invoked entry points run out of band; a slow run costs time, not a fill.",
  },
  {
    id: "ops-observability",
    repo: "*",
    pathContains: [
      "/monitoring/",
      "/telemetry/",
      "/observability/",
      "/health/",
      "/metrics/",
    ],
    latencyClass: "background",
    criticality: "ops",
    rationale:
      "Instrumentation observes the system. A degraded call here loses visibility, not capital.",
  },
  {
    id: "ops-cost-governance",
    repo: "*",
    pathContains: ["/cost-governance/", "/load-shed/", "/security/"],
    latencyClass: "background",
    criticality: "ops",
    rationale:
      "Spend and admission control protect the estate rather than choosing a position.",
  },
  {
    id: "trading-decision-path",
    repo: "*",
    pathContains: [
      "/signal-monitoring/",
      "/signal-pre-analysis/",
      "/signals/",
      "/account-pipeline/",
      "/trading-core/",
      "/exit-framework/",
      "/trade-horizon/",
      "/risk/",
      "/threshold-governance/",
      "/resilience/",
      "/llm-tools/",
    ],
    latencyClass: "hot-path",
    criticality: "trading-adjacent",
    rationale:
      "Signal formation, account decisions, exits and the resilience wrapper around them sit inside a decision cycle: latency here delays or degrades an order.",
  },
  {
    id: "shared-llm-client",
    repo: "lumic-utils",
    pathContains: ["src/functions/llm-", "src/llm-tools.ts", "src/index.ts"],
    latencyClass: "hot-path",
    criticality: "trading-adjacent",
    rationale:
      "The shared client serves every caller including the trading decision path, so it inherits the strictest budget of any of them.",
  },
];

/** Result of classifying a path. */
export interface PathClassification {
  /** Latency budget class. */
  readonly latencyClass: LatencyClass;
  /** Blast-radius class. */
  readonly criticality: Criticality;
  /** Rule id that decided it, or `"conservative-default"`. */
  readonly ruleId: string;
}

/**
 * The value used when no rule matches.
 *
 * Deliberately the strictest pair available. Absence of a rule is absence of
 * knowledge, and unknown trading exposure is treated as exposure.
 */
export const CONSERVATIVE_DEFAULT: PathClassification = {
  latencyClass: "hot-path",
  criticality: "trading-adjacent",
  ruleId: "conservative-default",
};

/**
 * Classify a file path into a latency class and criticality.
 *
 * @param repo - Repository name the file belongs to.
 * @param repoRelativePath - POSIX path of the file, relative to the repo root.
 * @returns The first matching rule's classification, else {@link CONSERVATIVE_DEFAULT}.
 */
export function classifyPath(
  repo: string,
  repoRelativePath: string,
): PathClassification {
  const normalized = `/${repoRelativePath}`;
  for (const rule of PATH_HEURISTIC_RULES) {
    if (rule.repo !== "*" && rule.repo !== repo) {
      continue;
    }
    const matched = rule.pathContains.some((fragment) =>
      normalized.includes(fragment.startsWith("/") ? fragment : `/${fragment}`),
    );
    if (matched) {
      return {
        latencyClass: rule.latencyClass,
        criticality: rule.criticality,
        ruleId: rule.id,
      };
    }
  }
  return CONSERVATIVE_DEFAULT;
}
