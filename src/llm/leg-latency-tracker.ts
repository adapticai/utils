/**
 * Rolling healthy-latency evidence per (provider, model), split by prompt size.
 *
 * The chain's timeouts and hedge points are only as good as its idea of how
 * long a healthy answer takes. A flat route budget encodes no such idea: it
 * treats a thirty-second wait on a model whose healthy answers arrive in four
 * the same as a thirty-second wait on one that needs twenty-five. This tracker
 * supplies the measured alternative.
 *
 * It is keyed by provider and model rather than by alias and role, because
 * health is a property of the model at its host: the same model reached as one
 * alias's primary and another alias's secondary is one population, and
 * splitting it would halve the evidence each side sees. Samples are split by
 * prompt size, because generation time grows with input and a model that
 * struggles on large prompts would otherwise have its large-prompt tail hidden
 * by a crowd of small, fast calls.
 *
 * Only healthy (answered) attempts are recorded. A timeout says the answer
 * took at least the budget, not how long it took, and folding it in would pull
 * the quantiles toward whatever budget happened to be configured.
 *
 * Unknown stays unknown: a cell with fewer than the minimum samples answers
 * `null`, and every consumer treats `null` as "no evidence", never as a value.
 *
 * @module llm/leg-latency-tracker
 */

/** How the tracker is sized. */
export interface LatencyTrackerConfig {
  /** Samples a cell needs before a quantile is reported. */
  readonly minSamples: number;
  /** Samples kept per cell; the oldest is dropped first. */
  readonly windowSize: number;
  /** Samples older than this are discarded, in milliseconds. */
  readonly sampleMaxAgeMs: number;
  /** Ascending prompt-token boundaries; `n` boundaries make `n + 1` buckets. */
  readonly promptTokenBuckets: readonly number[];
}

/** Characters per token used to size a prompt before the provider has counted it. */
const CHARS_PER_TOKEN = 4;

/** The bucket used when a prompt's size could not be estimated. */
const UNKNOWN_BUCKET = "unknown";

/** One healthy latency observation. */
interface LatencySample {
  readonly atMs: number;
  readonly durationMs: number;
}

/**
 * Estimate a prompt's size in tokens from its serialised length.
 *
 * Only used to choose a size bucket, and the same estimate is applied when a
 * sample is recorded and when it is looked up, so its bias cancels. Content
 * that cannot be serialised yields `null` rather than a guessed size.
 *
 * @param parts The prompt, developer instruction and prior turns.
 * @returns The estimated token count, or null.
 */
export function estimatePromptTokens(parts: readonly unknown[]): number | null {
  let characters = 0;
  for (const part of parts) {
    if (part === undefined) {
      continue;
    }
    if (typeof part === "string") {
      characters += part.length;
      continue;
    }
    try {
      const serialised = JSON.stringify(part);
      if (typeof serialised !== "string") {
        return null;
      }
      characters += serialised.length;
    } catch {
      // A circular or otherwise unserialisable part has no knowable size; the
      // caller files its latency under the unknown bucket rather than a guess.
      return null;
    }
  }
  return Math.ceil(characters / CHARS_PER_TOKEN);
}

/**
 * The nearest-rank quantile of a sorted sample.
 *
 * @param sorted Ascending values; must be non-empty.
 * @param q The quantile, in (0, 1).
 * @returns The value at that rank.
 */
export function nearestRank(sorted: readonly number[], q: number): number {
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[rank - 1];
}

/**
 * Per-process healthy-latency windows.
 */
export class LegLatencyTracker {
  private readonly cells = new Map<string, LatencySample[]>();

  private readonly config: LatencyTrackerConfig;

  private readonly now: () => number;

  /**
   * @param config Window sizing and prompt-size buckets.
   * @param now Clock, injected so ageing is testable without waiting.
   */
  public constructor(config: LatencyTrackerConfig, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  /**
   * The size bucket a prompt falls in.
   *
   * @param promptTokens Estimated prompt tokens, or null when unknown.
   * @returns The bucket label.
   */
  public bucketOf(promptTokens: number | null): string {
    if (promptTokens === null || !Number.isFinite(promptTokens)) {
      return UNKNOWN_BUCKET;
    }
    const index = this.config.promptTokenBuckets.findIndex((edge) => promptTokens < edge);
    return String(index === -1 ? this.config.promptTokenBuckets.length : index);
  }

  /**
   * Record one healthy (answered) attempt.
   *
   * @param provider The provider that answered.
   * @param modelId The model it answered with.
   * @param promptTokens Estimated prompt tokens, or null.
   * @param durationMs How long the answer took.
   * @returns void
   */
  public record(
    provider: string,
    modelId: string,
    promptTokens: number | null,
    durationMs: number,
  ): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    const key = this.cellKey(provider, modelId, promptTokens);
    const samples = this.fresh(key);
    samples.push({ atMs: this.now(), durationMs });
    while (samples.length > this.config.windowSize) {
      samples.shift();
    }
    this.cells.set(key, samples);
  }

  /**
   * A healthy-latency quantile, or null without enough evidence.
   *
   * @param provider The provider.
   * @param modelId The model.
   * @param promptTokens Estimated prompt tokens, or null.
   * @param q The quantile, in (0, 1).
   * @returns The quantile in milliseconds, or null.
   */
  public quantile(
    provider: string,
    modelId: string,
    promptTokens: number | null,
    q: number,
  ): number | null {
    const samples = this.fresh(this.cellKey(provider, modelId, promptTokens));
    if (samples.length < this.config.minSamples) {
      return null;
    }
    const sorted = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    return nearestRank(sorted, q);
  }

  /**
   * How many fresh samples a cell holds.
   *
   * @param provider The provider.
   * @param modelId The model.
   * @param promptTokens Estimated prompt tokens, or null.
   * @returns The count.
   */
  public sampleCount(provider: string, modelId: string, promptTokens: number | null): number {
    return this.fresh(this.cellKey(provider, modelId, promptTokens)).length;
  }

  /**
   * Discard all evidence.
   *
   * @returns void
   */
  public reset(): void {
    this.cells.clear();
  }

  /**
   * @param provider The provider.
   * @param modelId The model.
   * @param promptTokens Estimated prompt tokens, or null.
   * @returns The cell key.
   */
  private cellKey(provider: string, modelId: string, promptTokens: number | null): string {
    return `${provider}/${modelId}@${this.bucketOf(promptTokens)}`;
  }

  /**
   * A cell's samples with the stale ones removed.
   *
   * @param key The cell key.
   * @returns The fresh samples (the stored array, pruned in place).
   */
  private fresh(key: string): LatencySample[] {
    const samples = this.cells.get(key) ?? [];
    const oldest = this.now() - this.config.sampleMaxAgeMs;
    while (samples.length > 0 && samples[0].atMs < oldest) {
      samples.shift();
    }
    return samples;
  }
}
