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
