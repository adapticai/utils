/**
 * What each provider guard admits in ONE INSTANT, and what it costs.
 *
 * A token bucket has two independent quantities: the rate tokens are replaced
 * at, and the number the bucket holds. Read from one number they are not two
 * bounds but one, and the one they are is the long-run average — which permits
 * any burst, because a bucket sized at its own refill period starts full. A
 * provider enforcing its ceiling over a shorter window than the client paces
 * over refuses that burst however correct the minute's average is.
 *
 * Four properties are pinned here, because a capacity can fail in four
 * unrelated directions.
 *
 * It must BOUND the instant: every entry declares a capacity below its own
 * per-minute allowance, and a cold guard admits that many calls and no more
 * before the clock moves. A per-second ceiling is a claim about an instant, so
 * every burst below runs on a FROZEN clock; nothing refills while it is held,
 * and every call admitted is admitted in one instant.
 *
 * It must not THROTTLE: a capacity is a measurement and the thing measured is
 * the demand the live path puts on the guard in one instant. A cohort of
 * per-symbol trading decisions paced behind a bucket is latency on a path
 * where a late answer is a wrong answer, so the capacity is asserted to admit
 * the demand recorded beside it, and to admit at least what the concurrency
 * ceiling can hold at once.
 *
 * It must PACE rather than refuse: the bound is a bucket a call queues on, not
 * a predicate that rejects it, so one token's refill falls inside the guard's
 * own wait and the cost of capacity is latency and not decisions.
 *
 * And it must leave the hedge reserve satisfiable: that reserve is a fraction
 * of the capacity, and a reserve nothing can satisfy is a prohibition.
 *
 * @module __tests__/llm/rate-guard-burst-capacity
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  burstCapacityFor,
  guardSnapshots,
  hasDuplicateHeadroom,
  limitsFor,
  resetProviderGuards,
  withProviderGuards,
} from "../../llm/rate-guard";
import type { ProviderLimits } from "../../llm/rate-guard";
import { resolveChain, routeTable } from "../../llm/route-table";

/** Seconds in a minute, converting a per-minute refill to the per-second pace a vendor may enforce in. */
const SECONDS_PER_MINUTE = 60;

/** Milliseconds in a minute, for turning a per-minute refill into one token's wait. */
const MS_PER_MINUTE = 60_000;

/** Enough microtask turns for an admitted call to have settled, so a still-pending one was genuinely not admitted. */
const SETTLE_TURNS = 8;

/** How long one provider answer is held, so a permit returns while the bucket is still refilling. */
const CALL_DURATION_MS = 2_000;

/** The hot-path leg budget a caller passes, which bounds its wait for a permit but not for a token. */
const LEG_BUDGET_MS = 30_000;

/** A provider name no entry claims, so its guard runs on the defaults block. */
const UNREGISTERED_PROVIDER = "a-provider-with-no-entry";

/** The alias the engine's per-symbol trading decision is served by. */
const DECISION_ALIAS = "llm.fast";

/** One guard, named by the entry whose numbers it runs on. */
interface GuardUnderTest {
  /** The entry this guard reads, for a failure to name. */
  readonly entry: string;
  readonly provider: string;
  /** The model, for a provider whose limits apply per model. */
  readonly modelId?: string;
  /** The numbers the entry is expected to hold, so a change to one is read here first. */
  readonly expected: {
    readonly requestsPerMinute: number;
    readonly capacity: number;
    readonly maxConcurrent: number;
    readonly measuredDemand: number;
    readonly vendorCeiling: number | null;
  };
}

/**
 * Every guard a provider entry governs, with the numbers that entry declares.
 *
 * The numbers are restated rather than read from the file, so that changing one
 * is a decision taken in front of this list and its reasons rather than a
 * silent edit to a JSON value.
 */
const GUARDS: readonly GuardUnderTest[] = [
  {
    entry: "defaults",
    provider: UNREGISTERED_PROVIDER,
    expected: { requestsPerMinute: 120, capacity: 12, maxConcurrent: 12, measuredDemand: 0, vendorCeiling: null },
  },
  {
    entry: "anthropic",
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    expected: { requestsPerMinute: 120, capacity: 12, maxConcurrent: 12, measuredDemand: 0, vendorCeiling: null },
  },
  {
    entry: "anthropic/claude-haiku-4-5",
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    expected: { requestsPerMinute: 300, capacity: 100, maxConcurrent: 48, measuredDemand: 100, vendorCeiling: null },
  },
  {
    entry: "openai",
    provider: "openai",
    expected: { requestsPerMinute: 120, capacity: 12, maxConcurrent: 12, measuredDemand: 0, vendorCeiling: null },
  },
  {
    entry: "deepseek",
    provider: "deepseek",
    expected: { requestsPerMinute: 120, capacity: 12, maxConcurrent: 12, measuredDemand: 0, vendorCeiling: null },
  },
  {
    entry: "deepinfra",
    provider: "deepinfra",
    modelId: "deepseek-ai/DeepSeek-V4-Flash",
    expected: { requestsPerMinute: 240, capacity: 200, maxConcurrent: 200, measuredDemand: 100, vendorCeiling: 200 },
  },
  {
    entry: "fireworks",
    provider: "fireworks",
    expected: { requestsPerMinute: 120, capacity: 12, maxConcurrent: 12, measuredDemand: 0, vendorCeiling: null },
  },
  {
    entry: "zai",
    provider: "zai",
    expected: { requestsPerMinute: 120, capacity: 12, maxConcurrent: 12, measuredDemand: 0, vendorCeiling: null },
  },
  {
    entry: "groq",
    provider: "groq",
    expected: { requestsPerMinute: 30, capacity: 2, maxConcurrent: 2, measuredDemand: 0, vendorCeiling: null },
  },
  {
    entry: "openrouter",
    provider: "openrouter",
    expected: { requestsPerMinute: 30, capacity: 2, maxConcurrent: 2, measuredDemand: 0, vendorCeiling: null },
  },
  {
    entry: "typesafe",
    provider: "typesafe",
    expected: { requestsPerMinute: 600, capacity: 10, maxConcurrent: 8, measuredDemand: 0, vendorCeiling: null },
  },
];

/** A call held open until the test releases it, as a real request is held by the provider. */
interface HeldCall {
  /** Settles when the call ends, however it ended. */
  readonly settled: Promise<void>;
  /** Ends the call, as a provider's answer would. */
  readonly release: () => void;
  /** Whether the guard admitted it, so a paced call is distinguishable from an admitted one. */
  readonly admitted: () => boolean;
}

afterEach(() => {
  resetProviderGuards();
  vi.useRealTimers();
});

/**
 * The scope a call addresses, which decides the guard it is held by.
 *
 * @param modelId The model, for a provider whose limits apply per model.
 * @returns The scope to pass the guard.
 */
function scopeFor(modelId: string | undefined): { modelId?: string } {
  return modelId === undefined ? {} : { modelId };
}

/**
 * The guard's own account of itself.
 *
 * @param provider The provider key.
 * @param modelId The model, for a per-model guard.
 * @returns Its snapshot, or undefined before any call reached it.
 */
function snapshotOf(
  provider: string,
  modelId?: string,
): ReturnType<typeof guardSnapshots>[number] | undefined {
  return guardSnapshots().find((entry) => entry.provider === provider && entry.modelId === modelId);
}

/**
 * Start one call under a guard and hold it in flight.
 *
 * A call that is held open is what makes a paced call visible: an admitted one
 * stays in flight where a paced one has not begun.
 *
 * @param provider The provider key.
 * @param modelId The model, for a per-model guard.
 * @returns The call's handle.
 */
function hold(provider: string, modelId?: string): HeldCall {
  let release: () => void = () => undefined;
  let admitted = false;
  const settled = withProviderGuards(
    provider,
    () => {
      admitted = true;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    undefined,
    scopeFor(modelId),
  );
  return {
    settled,
    release: () => {
      release();
    },
    admitted: () => admitted,
  };
}

/**
 * Let every admitted call reach its body, with the clock held still.
 *
 * @returns Resolves once the pending microtasks have run.
 */
async function settleMicrotasks(): Promise<void> {
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    await Promise.resolve();
  }
}

describe("the capacity each provider entry declares", () => {
  it("states a bucket size below its own per-minute allowance, with the demand and the ceiling it was set from", () => {
    for (const guard of GUARDS) {
      const limits: ProviderLimits = limitsFor(guard.provider, guard.modelId);
      const where = guard.entry;

      expect(limits.requests_per_minute, where).toBe(guard.expected.requestsPerMinute);
      expect(limits.max_concurrent, where).toBe(guard.expected.maxConcurrent);
      expect(limits.max_burst, where).toBe(guard.expected.capacity);
      expect(burstCapacityFor(limits), where).toBe(guard.expected.capacity);

      // The two quantities are distinct in the data and not only in the code
      // that reads it. Equal, the entry would be back to bounding the average
      // alone, which is the defect and not a tighter statement of it.
      expect(burstCapacityFor(limits), where).toBeLessThan(limits.requests_per_minute);

      // A capacity is a measurement, so the figures it was measured against are
      // recorded beside it: the demand it has to admit, and the vendor's own
      // bound on an instant where the vendor publishes one.
      expect(limits.max_burst_measured_demand, where).toBe(guard.expected.measuredDemand);
      expect(limits.max_burst_vendor_ceiling, where).toBe(guard.expected.vendorCeiling);
      expect(limits.max_burst_source, where).toBeTruthy();
      expect(limits.max_burst_basis, where).toBeDefined();

      if (guard.expected.vendorCeiling !== null) {
        expect(burstCapacityFor(limits), where).toBeLessThanOrEqual(guard.expected.vendorCeiling);
        // A ceiling read across units bounds something other than it appears
        // to, so the unit it was published in is stated with it.
        expect(limits.max_burst_vendor_ceiling_unit, where).toBeTruthy();
        expect(limits.source, where).toBeTruthy();
      }
    }
  });

  it("never binds before the concurrency ceiling, nor below the demand it was sized for", () => {
    for (const guard of GUARDS) {
      const limits = limitsFor(guard.provider, guard.modelId);
      const capacity = burstCapacityFor(limits);
      const where = guard.entry;

      // A bucket tighter than the concurrency ceiling paces calls that ceiling
      // admits. On an entry whose concurrency was sized against measured
      // starvation of the live decision path, that is a throttle on that path
      // reached by convention rather than by measurement.
      expect(capacity, where).toBeGreaterThanOrEqual(limits.max_concurrent);

      // And the whole demand, not the part of it the concurrency ceiling can
      // hold at once. The ceiling does not discharge the capacity's duty: the
      // overflow past a permit is served as calls complete and waits only its
      // caller's own budget, while the overflow past a TOKEN waits for a
      // refill bounded by acquire_timeout_ms with no fallback behind it. A
      // capacity clamped to the concurrency ceiling therefore refuses part of
      // the demand it records, which the divert below measures.
      expect(capacity, where).toBeGreaterThanOrEqual(limits.max_burst_measured_demand ?? 0);
    }
  });

  it("costs latency and not decisions: one token's refill falls inside the guard's own wait", () => {
    for (const guard of GUARDS) {
      const limits = limitsFor(guard.provider, guard.modelId);
      const oneTokenMs = MS_PER_MINUTE / limits.requests_per_minute;

      // The bound is a bucket a call QUEUES on, not a predicate that rejects
      // it, so the over-limit call runs late rather than being lost — but only
      // while a token can arrive before the guard gives up on the wait.
      expect(oneTokenMs, guard.entry).toBeLessThanOrEqual(limits.acquire_timeout_ms);
    }
  });

  it("leaves the duplicate-hedge reserve satisfiable on an idle guard", () => {
    const reserve = routeTable.defaults.hedging?.duplicate_headroom_reserve;
    expect(reserve).toBeGreaterThan(0);

    for (const guard of GUARDS) {
      // The reserve is a fraction of the capacity, so a capacity smaller than
      // the reserve would refuse every hedge at every level of business
      // including an idle one. A reserve nothing can satisfy is a prohibition
      // wearing a reserve's name.
      expect(
        hasDuplicateHeadroom(guard.provider, guard.modelId ?? "", reserve ?? 0),
        guard.entry,
      ).toBe(true);
    }
  });
});

describe("a COLD guard, in one instant", () => {
  for (const guard of GUARDS) {
    it(`admits no more than ${guard.entry}'s capacity, and paces the next call`, async () => {
      const limits = limitsFor(guard.provider, guard.modelId);
      const capacity = burstCapacityFor(limits);

      // The clock is held still for the whole burst, so nothing refills and
      // every call admitted below is admitted in ONE instant.
      vi.useFakeTimers();
      resetProviderGuards();

      let admitted = 0;
      while (admitted < capacity) {
        await withProviderGuards(
          guard.provider,
          () => Promise.resolve(),
          undefined,
          scopeFor(guard.modelId),
        );
        admitted += 1;
      }
      expect(admitted).toBe(capacity);

      // The bucket is empty, and it was the capacity that emptied it rather
      // than the per-minute allowance: were the two still conflated, every
      // token between the capacity and the allowance would stand here.
      expect(snapshotOf(guard.provider, guard.modelId)?.availableTokens).toBeLessThan(1);
      expect(capacity).toBeLessThan(limits.requests_per_minute);

      // One more call in the SAME instant. It must not be admitted, and the
      // assertion is that it has not settled: a guard still holding the
      // minute's allowance would resolve it here without the clock moving.
      let settled: "admitted" | "refused" | "pending" = "pending";
      const beyondCapacity = withProviderGuards(
        guard.provider,
        () => Promise.resolve(),
        undefined,
        scopeFor(guard.modelId),
      ).then(
        () => {
          settled = "admitted";
        },
        () => {
          settled = "refused";
        },
      );
      await settleMicrotasks();
      expect(settled).toBe("pending");

      // Moving the clock to the guard's own wait admits it. That is the
      // difference the capacity makes: the call is PACED, not refused.
      await vi.advanceTimersByTimeAsync(limits.acquire_timeout_ms);
      await beyondCapacity;
      expect(settled).toBe("admitted");
    });
  }
});

describe("the whole demand an entry records, arriving at once", () => {
  it("is measured on at least one entry whose demand outruns its concurrency ceiling", () => {
    // Without such an entry every divert below would be admitted by permits
    // alone and never reach the rate queue whose expiry loses the call, so the
    // suite would pass against the clamp it exists to refuse.
    const reachesTheRateQueue = GUARDS.filter(
      (guard) => guard.expected.measuredDemand > guard.expected.maxConcurrent,
    );
    expect(reachesTheRateQueue.length).toBeGreaterThan(0);
  });

  for (const guard of GUARDS.filter((candidate) => candidate.expected.measuredDemand > 0)) {
    it(`loses none of ${guard.entry}'s ${guard.expected.measuredDemand} calls`, async () => {
      const limits = limitsFor(guard.provider, guard.modelId);
      const demand = limits.max_burst_measured_demand ?? 0;

      expect(demand).toBe(guard.expected.measuredDemand);

      vi.useFakeTimers();
      resetProviderGuards();

      let served = 0;
      let refused = 0;
      const calls = Array.from({ length: demand }, () =>
        withProviderGuards(
          guard.provider,
          async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, CALL_DURATION_MS));
            served += 1;
          },
          LEG_BUDGET_MS,
          scopeFor(guard.modelId),
        ).catch(() => {
          refused += 1;
        }),
      );

      await vi.advanceTimersByTimeAsync(LEG_BUDGET_MS + CALL_DURATION_MS);
      await Promise.all(calls);

      // Every call ANSWERED. A refusal here is a lost decision, not a late one:
      // the rate queue has no fallback behind it, so the caller that outlasts
      // acquire_timeout_ms returns nothing at all.
      expect(served, guard.entry).toBe(demand);
      expect(refused, guard.entry).toBe(0);
    });
  }
});

describe("a full cold-start cohort on the live decision path", () => {
  it("is not paced: every per-symbol decision of the cohort is admitted in one instant", async () => {
    // The guard this cohort lands on is the one the engine's per-symbol
    // decision reaches: the primary leg of the hot-path alias.
    const primary = resolveChain(DECISION_ALIAS).routes[0];
    expect(primary?.role).toBe("primary");
    const provider = primary?.providerName ?? "";
    const modelId = primary?.modelId;

    const limits = limitsFor(provider, modelId);
    const capacity = burstCapacityFor(limits);
    const cohort = limits.max_burst_measured_demand ?? 0;

    // The cohort is the demand recorded on the entry: the most per-symbol
    // decisions the engine's own bounds can put on this guard at once. It has
    // to be a figure a refill-rate convention would have paced, or this test
    // could pass against the very throttle it exists to refuse.
    expect(cohort).toBeGreaterThan(limits.requests_per_minute / SECONDS_PER_MINUTE);

    vi.useFakeTimers();
    resetProviderGuards();

    const calls = Array.from({ length: cohort }, () => hold(provider, modelId));
    await settleMicrotasks();

    // Every one of them is running, with the clock never having moved: none
    // waited for a token, and none waited for a permit.
    expect(calls.filter((call) => call.admitted())).toHaveLength(cohort);
    expect(snapshotOf(provider, modelId)).toMatchObject({
      inFlight: cohort,
      rateQueueLength: 0,
      concurrencyQueueLength: 0,
      availableTokens: capacity - cohort,
      burstCapacity: capacity,
    });

    // And the capacity is what admitted them, with room left: a capacity at
    // the per-second refill of 4 would have admitted four of this cohort and
    // paced the other ninety-six, which is latency charged to a trading
    // decision to bound a burst the vendor does not measure.
    expect(cohort).toBeLessThanOrEqual(capacity);
    expect(cohort).toBeLessThanOrEqual(limits.max_concurrent);

    for (const call of calls) {
      call.release();
    }
    await Promise.all(calls.map((call) => call.settled));
    expect(snapshotOf(provider, modelId)?.inFlight).toBe(0);
  });
});
