import { describe, expect, it } from "vitest";

import {
  LegLatencyTracker,
  estimatePromptTokens,
  nearestRank,
} from "../../../llm/leg-latency-tracker";

/** Samples a cell needs before it reports. */
const MIN_SAMPLES = 5;

/** Prompt-size boundary between the small and large buckets. */
const BUCKET_EDGE = 1_000;

/** A prompt well inside the small bucket. */
const SMALL_PROMPT = 10;

/** A prompt well inside the large bucket. */
const LARGE_PROMPT = 5_000;

/** How long samples stay fresh. */
const MAX_AGE_MS = 60_000;

/**
 * A tracker on a hand-driven clock.
 *
 * @returns The tracker and a way to move its clock.
 */
function trackerWithClock(): { tracker: LegLatencyTracker; advance: (ms: number) => void } {
  let nowMs = 0;
  const tracker = new LegLatencyTracker(
    {
      minSamples: MIN_SAMPLES,
      windowSize: 10,
      sampleMaxAgeMs: MAX_AGE_MS,
      promptTokenBuckets: [BUCKET_EDGE],
    },
    () => nowMs,
  );
  return {
    tracker,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("leg latency tracker", () => {
  it("reports unknown, not a default, until a cell has the minimum samples", () => {
    const { tracker } = trackerWithClock();
    for (let index = 0; index < MIN_SAMPLES - 1; index += 1) {
      tracker.record("host", "model", SMALL_PROMPT, 100);
    }
    expect(tracker.quantile("host", "model", SMALL_PROMPT, 0.9)).toBeNull();

    tracker.record("host", "model", SMALL_PROMPT, 100);
    expect(tracker.quantile("host", "model", SMALL_PROMPT, 0.9)).toBe(100);
  });

  it("keys evidence by provider and model, so every alias reaching the model shares it", () => {
    const { tracker } = trackerWithClock();
    for (let index = 0; index < MIN_SAMPLES; index += 1) {
      tracker.record("host", "model", SMALL_PROMPT, 200);
    }
    expect(tracker.quantile("host", "model", SMALL_PROMPT, 0.5)).toBe(200);
    expect(tracker.quantile("other-host", "model", SMALL_PROMPT, 0.5)).toBeNull();
    expect(tracker.quantile("host", "other-model", SMALL_PROMPT, 0.5)).toBeNull();
  });

  it("keeps large-prompt latency apart from small-prompt latency", () => {
    const { tracker } = trackerWithClock();
    for (let index = 0; index < MIN_SAMPLES; index += 1) {
      tracker.record("host", "model", SMALL_PROMPT, 100);
      tracker.record("host", "model", LARGE_PROMPT, 900);
    }
    expect(tracker.quantile("host", "model", SMALL_PROMPT, 0.9)).toBe(100);
    expect(tracker.quantile("host", "model", LARGE_PROMPT, 0.9)).toBe(900);
    expect(tracker.bucketOf(null)).toBe("unknown");
  });

  it("discards samples older than the maximum age", () => {
    const { tracker, advance } = trackerWithClock();
    for (let index = 0; index < MIN_SAMPLES; index += 1) {
      tracker.record("host", "model", SMALL_PROMPT, 100);
    }
    advance(MAX_AGE_MS + 1);
    expect(tracker.quantile("host", "model", SMALL_PROMPT, 0.9)).toBeNull();
    expect(tracker.sampleCount("host", "model", SMALL_PROMPT)).toBe(0);
  });

  it("ignores durations that are not finite and non-negative", () => {
    const { tracker } = trackerWithClock();
    tracker.record("host", "model", SMALL_PROMPT, Number.NaN);
    tracker.record("host", "model", SMALL_PROMPT, -1);
    expect(tracker.sampleCount("host", "model", SMALL_PROMPT)).toBe(0);
  });

  it("uses the nearest-rank quantile", () => {
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.99)).toBe(10);
  });

  it("sizes a prompt by its serialised length, and an unserialisable one as unknown", () => {
    expect(estimatePromptTokens(["abcd", "efgh"])).toBe(2);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(estimatePromptTokens(["abcd", [circular]])).toBeNull();
  });
});
