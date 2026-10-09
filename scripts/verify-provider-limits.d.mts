/**
 * Types for the exports of `verify-provider-limits.mjs`, which its tests import.
 *
 * @module utils/scripts/verify-provider-limits
 */

/** The sources the wiring check inspects. */
export interface WiringSources {
  /** Text of the leg attempt, which dispatches a generative leg to its transport. */
  readonly legAttempt: string;
  /** Text of the same-model group, which owns an attempt's breaker probe slot. */
  readonly hedge: string;
  /** Text of the rate and concurrency guards. */
  readonly guard: string;
  /** Text of every other production source under `src/llm`, keyed by package-relative path. */
  readonly others: Readonly<Record<string, string>>;
}

/** The files that own each guarded construct, relative to the package root. */
export declare const WIRING_FILES: Readonly<{
  legAttempt: string;
  hedge: string;
  guard: string;
}>;

/**
 * Read the sources the wiring check inspects.
 *
 * @param root The package root; defaults to the one the script sits in.
 * @returns The three owning files and every other production source under `src/llm`.
 */
export declare function readWiringSources(root?: string): WiringSources;

/**
 * Assert the guards are on the execution path, not merely present.
 *
 * @param sources The sources; the default reads the tree.
 * @returns One message per failed assertion, each naming the file it read.
 */
export declare function checkWiring(sources?: WiringSources): string[];
