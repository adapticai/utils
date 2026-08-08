/**
 * Load-timeout guard on the single-flight pin (2026-07-19 port of the
 * engine-local fix behind the 2026-07-17 decision-pipeline hang): a loader
 * that never settles must not pin its key forever — the pin is evicted at
 * loadTimeoutMs, the caller receives a typed rejection, and the next caller
 * retries with a fresh loader.
 */
import { describe, it, expect, vi } from "vitest";

import { StampedeProtectedCache } from "../cache/stampede-protected-cache";

describe("StampedeProtectedCache load timeout", () => {
  it("rejects at loadTimeoutMs, evicts the pin, and lets the next caller retry fresh", async () => {
    const cache = new StampedeProtectedCache<string>({
      maxSize: 10,
      defaultTtl: 60_000,
      loadTimeoutMs: 50,
    });
    const hungLoader = vi.fn(
      () => new Promise<string>(() => undefined), // never settles
    );

    await expect(cache.get("k", hungLoader)).rejects.toThrow(/timed out after 50ms/);
    expect(cache.getStats().loadTimeouts).toBe(1);

    // The pin must be gone: a fresh, healthy loader must be invoked (not
    // coalesced onto the hung promise).
    const healthyLoader = vi.fn(async () => "recovered");
    await expect(cache.get("k", healthyLoader)).resolves.toBe("recovered");
    expect(healthyLoader).toHaveBeenCalledTimes(1);
  });

  it("discards an abandoned loader's late value instead of overwriting fresher retry data", async () => {
    const cache = new StampedeProtectedCache<string>({
      maxSize: 10,
      defaultTtl: 60_000,
      loadTimeoutMs: 50,
    });

    // Loader A hangs past the ceiling, then resolves a STALE value later.
    let resolveHungLoader: (value: string) => void = () => undefined;
    const hungLoader = () =>
      new Promise<string>((resolve) => {
        resolveHungLoader = resolve;
      });

    await expect(cache.get("k", hungLoader)).rejects.toThrow(/timed out/);

    // Retry (loader B) caches fresh data after the timeout evicted the pin.
    await expect(cache.get("k", async () => "fresh")).resolves.toBe("fresh");

    // Loader A finally resolves; its late value must be discarded.
    resolveHungLoader("stale");
    await new Promise((resolve) => setImmediate(resolve));

    await expect(cache.get("k", async () => "reload")).resolves.toBe("fresh");
  });

  it("rejects a non-positive or non-finite loadTimeoutMs at construction", () => {
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () =>
          new StampedeProtectedCache<string>({
            maxSize: 10,
            defaultTtl: 60_000,
            loadTimeoutMs: invalid,
          }),
      ).toThrow(RangeError);
    }
  });

  it("does not time out a loader that settles within the ceiling", async () => {
    const cache = new StampedeProtectedCache<string>({
      maxSize: 10,
      defaultTtl: 60_000,
      loadTimeoutMs: 1_000,
    });
    await expect(cache.get("k", async () => "ok")).resolves.toBe("ok");
    expect(cache.getStats().loadTimeouts).toBe(0);
  });
});

describe("onEvent observability hook", () => {
  it("emits hit/miss/coalesced/load_timeout and never lets a throwing observer break the path", async () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      const cache = new StampedeProtectedCache<string>({
        maxSize: 10,
        defaultTtl: 60_000,
        loadTimeoutMs: 1_000,
        enableBackgroundRefresh: false,
        onEvent: (event, key) => {
          events.push(`${event}:${key}`);
          throw new Error("observer boom — must be swallowed");
        },
      });
      await expect(cache.get("k", () => Promise.resolve("v"))).resolves.toBe(
        "v",
      );
      await expect(cache.get("k", () => Promise.resolve("v2"))).resolves.toBe(
        "v",
      );
      const never = () => new Promise<string>(() => undefined);
      const a = cache.get("wedge", never);
      const b = cache.get("wedge", never);
      const aAssert = expect(a).rejects.toThrow(/timed out/);
      const bAssert = expect(b).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(1_001);
      await Promise.all([aAssert, bAssert]);
      expect(events).toContain("miss:k");
      expect(events).toContain("hit:k");
      expect(events).toContain("coalesced:wedge");
      expect(events).toContain("load_timeout:wedge");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("peek", () => {
  it("returns fresh values without loading and undefined for absent/expired keys", async () => {
    vi.useFakeTimers();
    try {
      const cache = new StampedeProtectedCache<string>({
        maxSize: 10,
        defaultTtl: 1_000,
        enableBackgroundRefresh: false,
      });
      expect(cache.peek("k")).toBeUndefined();
      cache.set("k", "v");
      expect(cache.peek("k")).toBe("v");
      await vi.advanceTimersByTimeAsync(1_500);
      expect(cache.peek("k")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
