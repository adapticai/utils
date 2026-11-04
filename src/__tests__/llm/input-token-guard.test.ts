/**
 * The INPUT-TOKEN bound: the bucket, its place in the series, and the estimate
 * it is debited by.
 *
 * The hosted decision vendor enforces two ceilings per second — one on requests
 * and one on input tokens — and refuses over either. Before this bound existed,
 * the client counted requests only, and the arithmetic in the limits entry shows
 * what that left open: at the request guard's 32 calls/second, single-image
 * reads bill 84% of the token ceiling and a two-image request crosses it at 19
 * calls/second while the request guard still admits 32.
 *
 * Three properties are asserted here, because the bound fails in three
 * unrelated ways and two of them fail silently.
 *
 *  - The BUCKET holds its two quantities honestly: the instant is bounded by the
 *    capacity, the sustained pace by the refill, a cost nothing could admit is
 *    refused as permanent rather than waited out, and a large request is paced
 *    rather than starved behind cheaper ones.
 *  - The SERIES binds: a call admitted on requests and refused on tokens is NOT
 *    dispatched and is raised as a typed refusal, and a call that states no
 *    estimate is refused on that ground rather than admitted on an unknown.
 *  - The ESTIMATE is formed from the request before dispatch, charges an image
 *    by its canvas rather than its file, refuses rather than silently omitting
 *    an image it cannot read, and is reconciled against what the vendor
 *    reported — with a vendor that reported nothing recorded as unreported and
 *    never as agreement.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeDecisionBase64 } from "../../llm/decision/assets";
import {
  decisionInputTokenDrift,
  estimateDecisionInputTokens,
  estimateImageInputTokens,
  recordDecisionInputTokenDrift,
  resetDecisionInputTokenDrift,
} from "../../llm/decision/input-size";
import type { DecisionWireRequest } from "../../llm/decision/types";
import { InputTokenBucket } from "../../llm/input-token-bucket";
import type { GuardSnapshot } from "../../llm/rate-guard";
import {
  RateGuardTimeoutError,
  RateGuardTokenBoundError,
  guardSnapshots,
  inputTokenBoundFor,
  limitsFor,
  resetProviderGuards,
  withProviderGuards,
} from "../../llm/rate-guard";

/** The hosted provider, the only entry that declares an input-token bound. */
const HOSTED = "typesafe";

/** A provider whose entry declares no input-token bound, so none is applied to it. */
const UNMETERED = "groq";

/** The canvas the image token anchor was measured at. */
const MEASURED_WIDTH_PX = 1024;

/** The canvas the image token anchor was measured at. */
const MEASURED_HEIGHT_PX = 768;

/** The input tokens the vendor billed for one image at that canvas. */
const MEASURED_IMAGE_TOKENS = 2632;

/** A share of the token capacity a burst of negligible calls cannot have spent. */
const MOSTLY_UNSPENT = 0.9;

/** The vendor's stated input-token ceiling, in tokens per second, which the sizing is held under. */
const VENDOR_INPUT_TOKENS_PER_SECOND = 100_000;

/** Milliseconds in one second, the window the vendor enforces over. */
const MS_PER_SECOND = 1000;

/** How long the sizing drive runs, in simulated milliseconds. */
const DRIVE_MS = 10_000;

/** How far the simulated clock moves between rounds of offers. */
const DRIVE_STEP_MS = 5;

/** Offers per round: far more than the bucket can take, so the bucket sets the rate. */
const OFFERS_PER_STEP = 40;

/** Enough microtask turns that an admitted call would have settled. */
const SETTLE_TURNS = 8;

/** A wait budget short enough to run in a test and long enough to be a wait. */
const SHORT_WAIT_MS = 20;

/** The prefix of an image the estimator decodes before falling back to the whole file. */
const CANVAS_PREFIX_BYTES = 64 * 1024;

/** Padding that puts the large test image well past the prefix. */
const LARGE_IMAGE_PAD_BYTES = 4 << 20;

/** Bytes one base64 group carries, which the prefix is rounded up to a whole number of. */
const BASE64_GROUP_BYTES = 3;

/** A clock a test owns, so the refill arithmetic is asserted rather than the machine's load. */
class TestClock {
  private ms = 1_000_000;

  /** @returns The current instant. */
  public now = (): number => this.ms;

  /** @returns The current instant, for a caller recording when something happened. */
  public nowMs(): number {
    return this.ms;
  }

  /**
   * @param ms Milliseconds to advance.
   * @returns void
   */
  public advance(ms: number): void {
    this.ms += ms;
  }
}

afterEach(() => {
  resetProviderGuards();
  resetDecisionInputTokenDrift();
  vi.useRealTimers();
});

describe("the input-token bucket", () => {
  it("debits what a call costs and holds the instant to its capacity", async () => {
    const clock = new TestClock();
    const bucket = new InputTokenBucket({ capacity: 100, refillPerSecond: 10, label: "t", now: clock.now });

    expect(await bucket.acquire(60, SHORT_WAIT_MS)).toEqual({ admitted: true });
    expect(bucket.available()).toBe(40);
    expect(await bucket.acquire(40, SHORT_WAIT_MS)).toEqual({ admitted: true });
    expect(bucket.available()).toBe(0);
  });

  it("refuses a cost above its capacity as permanent, without waiting", async () => {
    const clock = new TestClock();
    const bucket = new InputTokenBucket({ capacity: 100, refillPerSecond: 10, label: "t", now: clock.now });

    // The clock never moves, so nothing refills. A bucket that queued this
    // would spend the caller's whole budget to reach the same answer and would
    // hold every waiter behind it for that time.
    const refused = await bucket.acquire(101, SHORT_WAIT_MS);
    expect(refused).toEqual({ admitted: false, reason: "exceeds_capacity" });
    // And it took nothing: a refusal that debited would make the bucket pay
    // for a call that never happened.
    expect(bucket.available()).toBe(100);
  });

  it("paces a cost it cannot yet meet instead of refusing it", async () => {
    const clock = new TestClock();
    const bucket = new InputTokenBucket({ capacity: 100, refillPerSecond: 100, label: "t", now: clock.now });
    expect(await bucket.acquire(100, SHORT_WAIT_MS)).toEqual({ admitted: true });

    let settled: "admitted" | "refused" | "pending" = "pending";
    const queued = bucket.acquire(50, 10_000).then((outcome) => {
      settled = outcome.admitted ? "admitted" : "refused";
    });
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
      await Promise.resolve();
    }
    // Still the same instant, so an empty bucket must not have served it.
    expect(settled).toBe("pending");

    // Half a second accrues 50 tokens at this refill, which is exactly its cost.
    clock.advance(500);
    await vi.waitUntil(() => settled !== "pending", { timeout: 2000, interval: 5 });
    await queued;
    expect(settled).toBe("admitted");
  });

  it("reports a wait that ran out and a caller that left as different refusals", async () => {
    const clock = new TestClock();
    const bucket = new InputTokenBucket({ capacity: 100, refillPerSecond: 1, label: "t", now: clock.now });
    expect(await bucket.acquire(100, SHORT_WAIT_MS)).toEqual({ admitted: true });

    const waitedOut = await bucket.acquire(100, SHORT_WAIT_MS);
    expect(waitedOut).toEqual({ admitted: false, reason: "waited_out" });

    const controller = new AbortController();
    const leaving = bucket.acquire(100, 10_000, controller.signal);
    controller.abort();
    expect(await leaving).toEqual({ admitted: false, reason: "abandoned" });
  });

  it("serves waiters in arrival order, so a large request is paced and never starved", async () => {
    const clock = new TestClock();
    const bucket = new InputTokenBucket({ capacity: 100, refillPerSecond: 100, label: "t", now: clock.now });
    expect(await bucket.acquire(100, SHORT_WAIT_MS)).toEqual({ admitted: true });

    const order: string[] = [];
    const big = bucket.acquire(90, 10_000).then(() => order.push("big"));
    const small = bucket.acquire(5, 10_000).then(() => order.push("small"));

    // 50 tokens accrue: enough for the small one several times over, and not
    // enough for the large one. Served by cost rather than by arrival, the
    // small one would go now and the large one would never move under a stream
    // of cheap traffic.
    clock.advance(500);
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
      await Promise.resolve();
    }
    expect(order).toEqual([]);

    clock.advance(500);
    await vi.waitUntil(() => order.length === 2, { timeout: 2000, interval: 5 });
    await Promise.all([big, small]);
    expect(order).toEqual(["big", "small"]);
  });

  it("accrues nothing past its capacity, and nothing from a clock that went backwards", async () => {
    const clock = new TestClock();
    const bucket = new InputTokenBucket({ capacity: 100, refillPerSecond: 1000, label: "t", now: clock.now });
    expect(await bucket.acquire(100, SHORT_WAIT_MS)).toEqual({ admitted: true });

    // Ten seconds at this refill is 10,000 tokens, into a bucket that holds 100.
    clock.advance(10_000);
    expect(bucket.available()).toBe(100);

    expect(await bucket.acquire(100, SHORT_WAIT_MS)).toEqual({ admitted: true });
    clock.advance(-5_000);
    // A backwards clock earns nothing rather than draining what is held: the
    // elapsed interval is unknown, and no tokens is the fail-safe reading of it.
    expect(bucket.available()).toBe(0);
  });
});

describe("the shipped sizing, driven rather than asserted arithmetically", () => {
  const windowName =
    "no sliding one-second window admits more input tokens than the vendor's ceiling";
  it(windowName, async () => {
    const bound = inputTokenBoundFor(limitsFor(HOSTED));
    const capacity = bound?.capacity ?? 0;
    const refill = bound?.refillPerSecond ?? 0;
    expect(capacity).toBeGreaterThan(0);

    const clock = new TestClock();
    // Built exactly as the guard builds it, from the entry's own numbers, so
    // this measures the SIZING and not a bucket chosen for the test. The other
    // tests here prove the mechanism; this one proves the figures put into it
    // produce the share of the vendor's ceiling the entry claims.
    const bucket = new InputTokenBucket({
      capacity,
      refillPerSecond: refill,
      label: "sizing",
      now: clock.now,
    });

    // Single-image reads offered far faster than the bucket can take them, so
    // the bucket is the only thing setting the rate. A zero wait means each
    // offer is admitted in this instant or not at all.
    const admittedAtMs: number[] = [];
    for (let elapsed = 0; elapsed < DRIVE_MS; elapsed += DRIVE_STEP_MS) {
      for (let offer = 0; offer < OFFERS_PER_STEP; offer += 1) {
        const outcome = await bucket.acquire(MEASURED_IMAGE_TOKENS, 0);
        if (!outcome.admitted) {
          break;
        }
        admittedAtMs.push(clock.nowMs());
      }
      clock.advance(DRIVE_STEP_MS);
    }
    expect(admittedAtMs.length).toBeGreaterThan(0);

    let worstWindow = 0;
    for (const start of admittedAtMs) {
      const inWindow = admittedAtMs.filter((at) => at >= start && at < start + MS_PER_SECOND).length;
      worstWindow = Math.max(worstWindow, inWindow * MEASURED_IMAGE_TOKENS);
    }

    // The property the entry's note states, measured: a bucket holding C
    // refilled at R cannot admit more than C + R in any one second, and the
    // figures chosen put that under the vendor's ceiling with margin.
    expect(worstWindow).toBeLessThanOrEqual(capacity + refill);
    expect(worstWindow).toBeLessThan(VENDOR_INPUT_TOKENS_PER_SECOND);

    // Over a finite horizon the average is (C + horizon x R) / horizon, not R:
    // the first instant gets the whole bucket on top of the refill. Asserting
    // R alone would be wrong, and asserting nothing would miss a refill that
    // had drifted.
    const horizonSeconds = DRIVE_MS / MS_PER_SECOND;
    const admittedTokens = admittedAtMs.length * MEASURED_IMAGE_TOKENS;
    expect(admittedTokens).toBeLessThanOrEqual(capacity + refill * horizonSeconds);
  });
});

describe("the bound in the series", () => {
  it("declares the bound for the metered provider and none for the unmetered one", () => {
    const bound = inputTokenBoundFor(limitsFor(HOSTED));
    expect(bound).not.toBeNull();
    expect(bound?.capacity).toBeGreaterThan(0);
    expect(bound?.refillPerSecond).toBeGreaterThan(0);
    expect(inputTokenBoundFor(limitsFor(UNMETERED))).toBeNull();
  });

  it("refuses a call that states no estimate, and does not send it", async () => {
    let dispatched = 0;
    const error = await withProviderGuards(HOSTED, async () => {
      dispatched += 1;
      return "sent";
    }).then(
      () => null,
      (raised: unknown) => raised,
    );

    const refusal = error as RateGuardTokenBoundError;
    expect(refusal).toBeInstanceOf(RateGuardTokenBoundError);
    expect(refusal.fault).toBe("estimate_unavailable");
    expect(refusal.bound).toBe("token-rate");
    expect(refusal.inputTokens).toBeNull();
    // Never admitted on an unknown. An unmeasurable call is the one most
    // likely to be large, so admitting it turns the guard off where it matters.
    expect(dispatched).toBe(0);
  });

  it("refuses an estimate past the capacity as permanent, and does not send it", async () => {
    const capacity = inputTokenBoundFor(limitsFor(HOSTED))?.capacity ?? 0;
    let dispatched = 0;
    const error = await withProviderGuards(HOSTED, async () => {
      dispatched += 1;
      return "sent";
    }, undefined, { inputTokens: capacity + 1 }).then(
      () => null,
      (raised: unknown) => raised,
    );

    const refusal = error as RateGuardTokenBoundError;
    expect(refusal).toBeInstanceOf(RateGuardTokenBoundError);
    expect(refusal.fault).toBe("exceeds_capacity");
    expect(refusal.inputTokens).toBe(capacity + 1);
    expect(refusal.capacity).toBe(capacity);
    expect(dispatched).toBe(0);
  });

  const seriesName =
    "refuses a call the REQUEST bound admits and the token bound does not, as a typed capacity refusal";
  it(seriesName, async () => {
    const bound = inputTokenBoundFor(limitsFor(HOSTED));
    const capacity = bound?.capacity ?? 0;
    expect(capacity).toBeGreaterThan(0);

    // Held still, so everything below happens in ONE instant: a per-second
    // ceiling is a statement about an instant.
    vi.useFakeTimers();
    let dispatched = 0;
    // One call that spends the whole token capacity. The request bound has 32
    // permits and a bucket of 32, so it is nowhere near binding.
    await withProviderGuards(HOSTED, async () => {
      dispatched += 1;
      return "sent";
    }, undefined, { inputTokens: capacity });
    expect(dispatched).toBe(1);

    const requestsLeft = guardSnapshots().find(({ provider }) => provider === HOSTED)?.availableTokens ?? 0;
    // The request bound would admit the next call: it is the token bound, and
    // only the token bound, that refuses it.
    expect(requestsLeft).toBeGreaterThanOrEqual(1);

    const outcome = withProviderGuards(HOSTED, async () => {
      dispatched += 1;
      return "sent";
    }, limitsFor(HOSTED).acquire_timeout_ms, { inputTokens: capacity }).then(
      () => "admitted",
      (raised: unknown) => raised,
    );
    // The wait budget runs out. 250 ms accrues 4,000 tokens at this entry's
    // refill, nowhere near the 64,000 the call costs, so the refusal is the
    // bucket's and not a race.
    await vi.advanceTimersByTimeAsync(limitsFor(HOSTED).acquire_timeout_ms + 1);

    const refusal = (await outcome) as RateGuardTimeoutError;
    expect(refusal).toBeInstanceOf(RateGuardTimeoutError);
    expect(refusal.bound).toBe("token-rate");
    expect(refusal.abandoned).toBe(false);
    // Refused, not quietly sent and not quietly dropped.
    expect(dispatched).toBe(1);
  });

  const independenceName = "the two bounds are independent — either can bind with the other to spare";
  it(independenceName, async () => {
    const capacity = inputTokenBoundFor(limitsFor(HOSTED))?.capacity ?? 0;
    const burst = limitsFor(HOSTED).max_burst ?? 0;
    expect(capacity).toBeGreaterThan(0);
    expect(burst).toBeGreaterThan(0);
    vi.useFakeTimers();
    const snap = (): GuardSnapshot | undefined =>
      guardSnapshots().find(({ provider }) => provider === HOSTED);

    // One call spends the whole TOKEN budget and barely touches the requests.
    await withProviderGuards(HOSTED, async () => "ok", undefined, { inputTokens: capacity });
    expect(snap()?.availableTokens).toBeGreaterThanOrEqual(1);
    expect(snap()?.inputTokens?.available).toBeLessThan(1);

    resetProviderGuards();

    // And the converse: a full burst of negligible calls empties the REQUEST
    // bucket and leaves the token budget all but untouched. Two buckets that
    // were secretly one could not show both of these.
    for (let call = 0; call < burst; call += 1) {
      await withProviderGuards(HOSTED, async () => "ok", undefined, { inputTokens: 1 });
    }
    expect(snap()?.availableTokens).toBeLessThan(1);
    expect(snap()?.inputTokens?.available).toBeGreaterThan(capacity * MOSTLY_UNSPENT);
  });

  const costsNothingName = "a permanently-refused call spends nothing at all, not even a rate token";
  it(costsNothingName, async () => {
    const capacity = inputTokenBoundFor(limitsFor(HOSTED))?.capacity ?? 0;
    vi.useFakeTimers();
    const snap = (): GuardSnapshot | undefined =>
      guardSnapshots().find(({ provider }) => provider === HOSTED);

    // Prime the guard so there is a reading to compare, then hold the clock so
    // nothing refills and the comparison is of spending alone.
    await withProviderGuards(HOSTED, async () => "ok", undefined, { inputTokens: 1 });
    const requestsBefore = snap()?.availableTokens ?? Number.NaN;
    const tokensBefore = snap()?.inputTokens?.available ?? Number.NaN;
    expect(requestsBefore).toBeGreaterThan(0);

    // Neither of these could ever be admitted. Taking a rate token for them
    // would spend this client's pacing on calls that were never going to be
    // dispatched — and the rate token is taken FIRST, so the only way to
    // charge nothing is to resolve the permanent faults before it.
    for (const scope of [{ inputTokens: capacity + 1 }, {}]) {
      await withProviderGuards(HOSTED, async () => "sent", undefined, scope).then(
        () => expect.unreachable("a permanent fault must refuse"),
        () => undefined,
      );
    }

    expect(snap()?.availableTokens).toBe(requestsBefore);
    expect(snap()?.inputTokens?.available).toBe(tokensBefore);
  });

  it("leaves a provider that declares no token bound exactly as it was", async () => {
    // No estimate, and the call is served: the bound applies only where an
    // entry declares one, so every provider that declares none is unchanged.
    await expect(withProviderGuards(UNMETERED, async () => "served")).resolves.toBe("served");
  });

  it("reports the bound in the guard snapshot, and null where there is none", async () => {
    await withProviderGuards(HOSTED, async () => "served", undefined, { inputTokens: 1 });
    await withProviderGuards(UNMETERED, async () => "served");

    const hosted = guardSnapshots().find(({ provider }) => provider === HOSTED);
    const unmetered = guardSnapshots().find(({ provider }) => provider === UNMETERED);
    expect(hosted?.inputTokens?.capacity).toBe(inputTokenBoundFor(limitsFor(HOSTED))?.capacity);
    expect(hosted?.inputTokens?.refillBasis).toBe("conservative-default");
    expect(hosted?.inputTokens?.capacityBasis).toBe("published");
    // Not a zero. A reader seeing zeros could not tell an unguarded token
    // ceiling from a guarded one momentarily out of tokens.
    expect(unmetered?.inputTokens).toBeNull();
  });
});

/**
 * A PNG of a given canvas, with padding that changes the FILE size and not the
 * canvas.
 *
 * Only the signature and the IHDR chunk are read, so the rest is whatever makes
 * the file the size the test wants.
 *
 * @param widthPx The canvas width.
 * @param heightPx The canvas height.
 * @param padBytes Extra bytes appended after the header.
 * @returns The base64 the wire carries.
 */
function pngAt(widthPx: number, heightPx: number, padBytes = 0): string {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = new Uint8Array(8 + 4 + 4 + 4 + 13 + 4 + padBytes);
  ihdr.set(header, 0);
  const view = new DataView(ihdr.buffer);
  view.setUint32(8, 13);
  ihdr.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, widthPx);
  view.setUint32(20, heightPx);
  ihdr[24] = 8;
  ihdr[25] = 6;
  return encodeDecisionBase64(ihdr);
}

/**
 * A PNG whose header chunk sits PAST the prefix the estimator reads first.
 *
 * A large ancillary chunk is written before IHDR, so the canvas is readable
 * only from the whole file. It exists to exercise the fallback: the prefix
 * bound is a saving and must never be a correctness condition.
 *
 * @param widthPx The canvas width.
 * @param heightPx The canvas height.
 * @returns The base64 the wire carries.
 */
function pngBeyondPrefix(widthPx: number, heightPx: number): string {
  const LEAD = 80 * 1024;
  const bytes = new Uint8Array(8 + (12 + LEAD) + (12 + 13));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  // A private ancillary chunk: lower-case first letter, which a reader skips.
  view.setUint32(8, LEAD);
  bytes.set([0x74, 0x45, 0x58, 0x74], 12);
  const ihdrAt = 8 + 12 + LEAD;
  view.setUint32(ihdrAt, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], ihdrAt + 4);
  view.setUint32(ihdrAt + 8, widthPx);
  view.setUint32(ihdrAt + 12, heightPx);
  bytes[ihdrAt + 16] = 8;
  bytes[ihdrAt + 17] = 6;
  return encodeDecisionBase64(bytes);
}

/**
 * A wire request with the given assets.
 *
 * @param assets The images, keyed by reference.
 * @returns The body.
 */
function wireRequest(assets?: Record<string, { type: "image"; format: "png"; data_base64: string }>): DecisionWireRequest {
  return {
    state: { text: "the state this request carries" },
    model: "jev-1.13.0",
    ...(assets === undefined ? {} : { assets }),
    questions: { q: { type: "noul", instructions: "is it so?" } },
  } as unknown as DecisionWireRequest;
}

describe("the input-token estimate", () => {
  it("returns the measured figure at the measured canvas", () => {
    expect(estimateImageInputTokens(MEASURED_WIDTH_PX, MEASURED_HEIGHT_PX)).toBe(MEASURED_IMAGE_TOKENS);
    // And scales with the canvas, which is the one thing the measurement
    // established about the vendor's billing.
    expect(estimateImageInputTokens(MEASURED_WIDTH_PX * 2, MEASURED_HEIGHT_PX)).toBe(MEASURED_IMAGE_TOKENS * 2);
  });

  it("weighs a text-only request as text alone", () => {
    const reading = estimateDecisionInputTokens(wireRequest());
    expect(reading.estimated).toBe(true);
    if (!reading.estimated) {
      return;
    }
    expect(reading.imageCount).toBe(0);
    expect(reading.imageTokens).toBe(0);
    expect(reading.inputTokens).toBe(reading.textTokens);
    expect(reading.textTokens).toBeGreaterThan(0);
  });

  const canvasName = "charges an image by its canvas and not by its file, and never charges its base64 as text";
  it(canvasName, () => {
    const small = estimateDecisionInputTokens(
      wireRequest({ chart: { type: "image", format: "png", data_base64: pngAt(1024, 768) } }),
    );
    const padded = estimateDecisionInputTokens(
      wireRequest({ chart: { type: "image", format: "png", data_base64: pngAt(1024, 768, 40_000) } }),
    );
    expect(small.estimated && padded.estimated).toBe(true);
    if (!small.estimated || !padded.estimated) {
      return;
    }

    // The measured fact: a 25 KB chart and a 4 KB blank at one canvas were
    // billed the same count.
    expect(small.imageTokens).toBe(MEASURED_IMAGE_TOKENS);
    expect(padded.imageTokens).toBe(MEASURED_IMAGE_TOKENS);

    // And the payload is not counted a second time as text. Counted, 40 KB of
    // base64 would add about 13,000 tokens here and charge one image twice.
    expect(padded.textTokens).toBe(small.textTokens);
    expect(padded.inputTokens).toBe(small.inputTokens);
  });

  const prefixName =
    "reads the canvas from a bounded header prefix, giving the same answer as the whole file";
  it(prefixName, () => {
    // 4 MiB of padding after the header. The encoder has already decoded these
    // same bytes once; decoding them again to re-read a header near the front
    // is the whole cost this bound removes.
    const large = wireRequest({ chart: { type: "image", format: "png", data_base64: pngAt(1024, 768, LARGE_IMAGE_PAD_BYTES) } });
    const small = wireRequest({ chart: { type: "image", format: "png", data_base64: pngAt(1024, 768) } });

    const reading = estimateDecisionInputTokens(large);

    expect(reading.estimated).toBe(true);
    const baseline = estimateDecisionInputTokens(small);
    expect(baseline.estimated).toBe(true);
    if (!reading.estimated || !baseline.estimated) {
      return;
    }
    // Identical, because the header bytes are the same bytes either way.
    expect(reading.imageTokens).toBe(baseline.imageTokens);
    expect(reading.imageTokens).toBe(MEASURED_IMAGE_TOKENS);

    // And bounded, asserted on bytes rather than on a clock. A wall-clock
    // threshold measures the machine the test ran on — the first version of
    // this assertion passed here and failed in CI at 44 ms against a 40 ms
    // ceiling, which said nothing about the mechanism. The decoded size is
    // deterministic: the whole file is over 4 MiB and the prefix read must
    // decode a small bounded fraction of it.
    // The prefix is rounded UP to a whole base64 group, so the decoded size is
    // the bound plus at most one group's three bytes.
    expect(reading.imageBytesRead).toBeLessThanOrEqual(CANVAS_PREFIX_BYTES + BASE64_GROUP_BYTES);
    expect(reading.imageBytesRead).toBeLessThan(LARGE_IMAGE_PAD_BYTES / 8);
  });

  it("falls back to the whole file when the prefix does not carry the header", () => {
    // A PNG that pads its first chunk past the prefix, so the canvas is only
    // readable from the whole file. Correctness must not rest on the bound.
    const beyond = wireRequest({
      chart: { type: "image", format: "png", data_base64: pngBeyondPrefix(1024, 768) },
    });
    const reading = estimateDecisionInputTokens(beyond);
    expect(reading.estimated).toBe(true);
    if (!reading.estimated) {
      return;
    }
    expect(reading.imageTokens).toBe(MEASURED_IMAGE_TOKENS);
    // And it paid the full price to get there, which is what distinguishes the
    // fallback from a prefix read that happened to work.
    expect(reading.imageBytesRead).toBeGreaterThan(CANVAS_PREFIX_BYTES + BASE64_GROUP_BYTES);
  });

  it("refuses to estimate a request whose image it cannot read, rather than leaving it out", () => {
    const unreadable = estimateDecisionInputTokens(
      wireRequest({ chart: { type: "image", format: "png", data_base64: encodeDecisionBase64(new Uint8Array([1, 2, 3, 4])) } }),
    );
    expect(unreadable).toEqual({ estimated: false, defect: "image_unreadable" });

    // The silent alternative is the under-estimate most likely to breach the
    // ceiling: an estimate missing one image reads as a smaller request.
    const readable = estimateDecisionInputTokens(
      wireRequest({ chart: { type: "image", format: "png", data_base64: pngAt(1024, 768) } }),
    );
    expect(readable.estimated).toBe(true);
  });
});

describe("the estimate is reconciled against the vendor", () => {
  it("records the drift and the worst under-estimate", () => {
    recordDecisionInputTokenDrift(1000, 1000);
    recordDecisionInputTokenDrift(1000, 2500);
    const drift = decisionInputTokenDrift();

    expect(drift.samples).toBe(2);
    expect(drift.estimatedTotal).toBe(2000);
    expect(drift.reportedTotal).toBe(3500);
    expect(drift.underEstimates).toBe(1);
    // Above one means the guard has been debiting less than the vendor billed,
    // so its bucket has been holding a looser ceiling than it declares.
    expect(drift.worstReportedOverEstimated).toBe(2.5);
    expect(drift.unreported).toBe(0);
  });

  it("counts a call the vendor reported no count for as unreported, never as agreement", () => {
    recordDecisionInputTokenDrift(1000, null);
    const drift = decisionInputTokenDrift();

    expect(drift.unreported).toBe(1);
    // Not a sample, and not folded into the totals. Averaged in as agreement,
    // an endpoint that stopped reporting usage would read as an estimator in
    // perfect health.
    expect(drift.samples).toBe(0);
    expect(drift.estimatedTotal).toBe(0);
    expect(drift.reportedTotal).toBe(0);
    expect(drift.worstReportedOverEstimated).toBeNull();
  });
});
