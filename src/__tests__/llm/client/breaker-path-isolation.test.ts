/**
 * Isolation of the breaker's failure runs between the live path and a
 * measurement path.
 *
 * The property under test is a causal one, not a cosmetic one: a call whose
 * answer is discarded must not be able to decide which model serves a call
 * whose answer is acted on. Two halves make that true, and a test for either
 * alone would pass while the defect was live — failures must be charged to the
 * measurement's own run, AND admission must still read the live run so
 * measurement never piles onto a provider live traffic is already struggling
 * with.
 *
 * The live partition is asserted field by field against the behaviour that
 * predates the path dimension, because the whole value of a correction is lost
 * if it moves the thing it was not supposed to touch.
 *
 * @module __tests__/llm/client/breaker-path-isolation
 */

import { describe, expect, it } from "vitest";

import { CircuitBreakerRegistry, LIVE_BREAKER_PATH } from "../../../llm/circuit-breaker";
import type { BreakerSnapshot } from "../../../llm/circuit-breaker";
import { ChainExhaustedError, executeChain } from "../../../llm/fallback-chain";
import type { ChainLeg } from "../../../llm/fallback-chain";
import { routeTable } from "../../../llm/route-table";
import type { AliasAttemptRecord, LlmBreakerDefaults, ResolvedRoute } from "../../../llm/types";
import { rejection } from "./support/rejections";
import { makeRoute } from "./support/routes";
import { ScriptedTransport, answers, fails, usageFor } from "./support/transports";

/** The alias these constructed chains stand in for. */
const ALIAS = "llm.extract";

/** The live breaker tuning under test. */
const BREAKER: LlmBreakerDefaults = routeTable.defaults.circuit_breaker;

/** More consecutive failures than the live threshold, so a leak would show. */
const OVER_THRESHOLD = BREAKER.failure_threshold + 3;

/**
 * A burst of measurement failures far larger than any consumer's measurement
 * pool can hold in flight.
 *
 * The isolation must not rest on arithmetic. A consumer bounds how much
 * measurement traffic runs at once, but those bounds are the consumer's to
 * change — the engine's shared measurement pool is a governed row an operator
 * can widen to 32, beside a second pool of 4 — and nothing in this package can
 * see them. Were the live run's safety a matter of a pool staying under
 * `failure_threshold`, a single governed write would convert measurement into a
 * live-starvation path with no code review at all. The property asserted here is
 * therefore unconditional in the volume: no number of measurement failures opens
 * the live breaker.
 */
const UNBOUNDED_BURST = 100;

/** Concurrent attempts on one path, for the mixed-load differential. */
const TEN_CONCURRENT = 10;

/** The same total load carried entirely on the live path: the baseline arm. */
const TWENTY_CONCURRENT = TEN_CONCURRENT * 2;

/**
 * The probe budget twenty concurrent attempts earn: `max(half_open_probes,
 * ceil(probe_fraction x concurrencyAtOpen))`. Spelled out rather than recomputed
 * from the config, so a change to either constant is visible here rather than
 * silently tracked by the expectation.
 */
const BASELINE_PROBE_BUDGET = 2;

/** Seeds for the randomized live-load differential. */
const DIFFERENTIAL_SEEDS = 40;

/** Largest concurrent burst a seed may draw. */
const DIFFERENTIAL_MAX_STARTS = 40;

/** A fixed instant, so cooldown arithmetic is exact rather than wall-clock. */
const T0 = 1_000_000;

/**
 * A registry on a clock the test advances by hand.
 *
 * @returns The registry and its clock handle.
 */
function registryWithClock(): { breakers: CircuitBreakerRegistry; advance: (ms: number) => void } {
  let nowMs = T0;
  const breakers = new CircuitBreakerRegistry(BREAKER, () => nowMs);
  return {
    breakers,
    advance: (ms: number): void => {
      nowMs += ms;
    },
  };
}

/**
 * The breaker fields that existed before the path dimension, for the no-op
 * proof. Picked explicitly rather than deep-equalled whole, so the proof reads
 * as a statement about the pre-existing contract and runs unchanged against the
 * source that predates the new fields.
 *
 * @param snapshot The snapshot to reduce.
 * @returns Only the pre-existing fields.
 */
function legacyFields(snapshot: BreakerSnapshot): Omit<BreakerSnapshot, "path" | "opens"> {
  return {
    routeKey: snapshot.routeKey,
    state: snapshot.state,
    consecutiveFailures: snapshot.consecutiveFailures,
    openedAtMs: snapshot.openedAtMs,
    probesInFlight: snapshot.probesInFlight,
    failureKind: snapshot.failureKind,
    cooldownMs: snapshot.cooldownMs,
    openedByLatency: snapshot.openedByLatency,
    probeBudget: snapshot.probeBudget,
  };
}

/**
 * Wrap routes as chain legs sharing one transport.
 *
 * @param routes The legs, in chain order.
 * @param transport The transport to carry them.
 * @returns Prepared legs.
 */
function legsOf(routes: readonly ResolvedRoute[], transport: ScriptedTransport): ChainLeg[] {
  return routes.map((route) => ({ route, transport, params: {} }));
}

describe("breaker failure runs are isolated per traffic path", () => {
  it("does not advance the live route's failure run when a measurement path fails", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    shadow.onFailure(route.routeKey, "hard");

    expect(breakers.snapshot(route.routeKey).consecutiveFailures).toBe(0);
    expect(breakers.snapshotOnPath(route.routeKey, "shadow").consecutiveFailures).toBe(1);
  });

  it("does not open the live breaker after more measurement failures than its threshold", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < OVER_THRESHOLD; index += 1) {
      shadow.onFailure(route.routeKey, "hard");
    }

    expect(breakers.stateOf(route.routeKey)).toBe("closed");
    expect(breakers.allows(route.routeKey)).toBe(true);
    expect(breakers.snapshot(route.routeKey).consecutiveFailures).toBe(0);
    expect(breakers.snapshotOnPath(route.routeKey, "shadow").state).toBe("open");
  });

  it("refuses a measurement attempt while the live breaker is open", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    expect(breakers.stateOf(route.routeKey)).toBe("open");

    const shadow = breakers.forPath("shadow");
    expect(shadow.allows(route.routeKey)).toBe(false);
    expect(shadow.stateOf(route.routeKey)).toBe("open");
    expect(shadow.refusalReason(route.routeKey)).toBe("circuit breaker is open on the live path");
  });

  it("refuses a measurement attempt while the live breaker is half-open", () => {
    const { breakers, advance } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    advance(BREAKER.cooldown_ms);

    // A live call WOULD be admitted here: the half-open probe budget is what
    // decides whether live traffic may resume, and it is not spent on an answer
    // nobody reads.
    expect(breakers.allows(route.routeKey)).toBe(true);
    expect(breakers.stateOf(route.routeKey)).toBe("half-open");

    const shadow = breakers.forPath("shadow");
    expect(shadow.allows(route.routeKey)).toBe(false);
    expect(shadow.refusalReason(route.routeKey)).toBe(
      "circuit breaker is half-open on the live path",
    );
  });

  it("still refuses a measurement attempt once the measurement run has itself opened", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      shadow.onFailure(route.routeKey, "hard");
    }

    expect(breakers.stateOf(route.routeKey)).toBe("closed");
    expect(shadow.allows(route.routeKey)).toBe(false);
    expect(shadow.refusalReason(route.routeKey)).toBe("circuit breaker is open on the shadow path");
  });

  it("returns the live registry itself for the live path, so live admission cannot drift", () => {
    const { breakers } = registryWithClock();
    expect(breakers.forPath(LIVE_BREAKER_PATH)).toBe(breakers);
  });
});

describe("no volume of measurement failure can open a live breaker", () => {
  it("a burst larger than any measurement pool leaves the live route serving", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < UNBOUNDED_BURST; index += 1) {
      shadow.onFailure(route.routeKey, "hard");
    }

    expect(
      breakers.stateOf(route.routeKey),
      `${UNBOUNDED_BURST} measurement failures opened the LIVE breaker for ${route.routeKey}: ` +
        "measurement traffic can now exclude the model that serves live calls, " +
        "which is a live-starvation path, not a measurement artefact",
    ).toBe("closed");
    expect(
      breakers.allows(route.routeKey),
      "the live route is refused after measurement-only failures — live calls are being starved by traffic whose answers are discarded",
    ).toBe(true);
    expect(breakers.snapshot(route.routeKey).consecutiveFailures).toBe(0);
  });

  it("the identical burst on the live path does open it, so the test above is not vacuous", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });

    for (let index = 0; index < UNBOUNDED_BURST; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }

    // What the registry did with every failure, measurement or not, before the
    // path dimension existed: the burst above would have landed here.
    expect(breakers.stateOf(route.routeKey)).toBe("open");
    expect(breakers.allows(route.routeKey)).toBe(false);
    expect(breakers.snapshot(route.routeKey).consecutiveFailures).toBe(UNBOUNDED_BURST);
  });

  it("interleaving live and measurement failures advances only the live run", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    // One short of the threshold on the live run, then measurement failures
    // without limit. Before the path dimension these shared one counter, so
    // measurement supplied the failure that opened a live route — and the live
    // caller saw an exclusion it had not earned.
    for (let index = 0; index < BREAKER.failure_threshold - 1; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    for (let index = 0; index < UNBOUNDED_BURST; index += 1) {
      shadow.onFailure(route.routeKey, "hard");
    }

    expect(
      breakers.stateOf(route.routeKey),
      "measurement failures completed a live failure run: the live breaker opened on evidence from calls whose answers were discarded",
    ).toBe("closed");
    expect(breakers.snapshot(route.routeKey).consecutiveFailures).toBe(
      BREAKER.failure_threshold - 1,
    );
    expect(breakers.snapshotOnPath(route.routeKey, "shadow").consecutiveFailures).toBe(
      UNBOUNDED_BURST,
    );
  });
});

describe("the live route's concurrent-load accounting matches the single-key baseline", () => {
  /**
   * Drive a route to open after a burst of concurrent attempts, counting
   * `liveStarts` of them on the live path and `measurementStarts` through a
   * measurement view.
   *
   * The baseline is reproduced by counting EVERY start on the live path, which
   * is what the single-key registry did: before the path dimension a
   * measurement attempt called the live route's own `onAttemptStart`. The
   * failures are live in both arms, so the only difference between them is
   * which path the attempt starts were counted on — and the probe budget must
   * not be able to tell.
   *
   * @param liveStarts Attempts counted on the live path.
   * @param measurementStarts Attempts counted through the measurement view.
   * @returns The live route's snapshot once it has opened.
   */
  function budgetAfterBurst(liveStarts: number, measurementStarts: number): BreakerSnapshot {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < liveStarts; index += 1) {
      breakers.onAttemptStart(route.routeKey);
    }
    for (let index = 0; index < measurementStarts; index += 1) {
      shadow.onAttemptStart(route.routeKey);
    }
    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    return breakers.snapshot(route.routeKey);
  }

  it("a mixed live and measurement burst yields the single-key baseline probe budget", () => {
    const baseline = budgetAfterBurst(TWENTY_CONCURRENT, 0);
    const split = budgetAfterBurst(TEN_CONCURRENT, TEN_CONCURRENT);

    expect(baseline.probeBudget).toBe(BASELINE_PROBE_BUDGET);
    expect(
      split.probeBudget,
      "a measurement attempt no longer counts toward the live route's concurrent load, so its " +
        "half-open probe budget has shrunk: live traffic is re-tested on the route with fewer " +
        "probes and spends longer on the substitute model after a trip — the lockout is fixed " +
        "and recovery from it is slower",
    ).toBe(baseline.probeBudget);
    expect(split.state).toBe("open");
  });

  it("admits the second concurrent live probe the baseline admitted", () => {
    const { breakers, advance } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < TEN_CONCURRENT; index += 1) {
      breakers.onAttemptStart(route.routeKey);
      shadow.onAttemptStart(route.routeKey);
    }
    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    advance(BREAKER.cooldown_ms);
    expect(breakers.stateOf(route.routeKey)).toBe("half-open");

    // The first probe, then the SECOND concurrently with it.
    expect(breakers.allows(route.routeKey)).toBe(true);
    expect(breakers.onAttemptStart(route.routeKey)).toBe(true);
    expect(
      breakers.allows(route.routeKey),
      "the second concurrent half-open probe is refused: the recovering route is re-tested by " +
        "one probe where the baseline used two",
    ).toBe(true);
    expect(breakers.onAttemptStart(route.routeKey)).toBe(true);
    // And the budget is a bound, not unlimited.
    expect(breakers.allows(route.routeKey)).toBe(false);
  });

  it("matches the baseline probe budget over randomized start sequences", () => {
    for (let seed = 1; seed <= DIFFERENTIAL_SEEDS; seed += 1) {
      let state = seed;
      /**
       * A deterministic pseudo-random draw, so a disagreement is reproducible
       * from its seed rather than lost with the run.
       *
       * @param bound Exclusive upper bound.
       * @returns An integer in [0, bound).
       */
      const next = (bound: number): number => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state % bound;
      };
      const total = 1 + next(DIFFERENTIAL_MAX_STARTS);
      let measurementStarts = 0;
      for (let index = 0; index < total; index += 1) {
        measurementStarts += next(2);
      }

      const baseline = budgetAfterBurst(total, 0);
      const split = budgetAfterBurst(total - measurementStarts, measurementStarts);
      expect(
        split.probeBudget,
        `seed ${seed}: ${total} concurrent attempts, ${measurementStarts} of them measurement — ` +
          "the live probe budget diverged from the single-key baseline",
      ).toBe(baseline.probeBudget);
    }
  });

  it("a measurement attempt takes no live probe slot even while the live route is half-open", () => {
    const { breakers, advance } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    advance(BREAKER.cooldown_ms);
    expect(breakers.stateOf(route.routeKey)).toBe("half-open");

    // The view refuses here, but the start is called directly: nothing may
    // depend on the refusal having been consulted first, or a lost race would
    // strand a live probe slot and exclude the route for the life of the process.
    expect(shadow.onAttemptStart(route.routeKey)).toBe(false);

    expect(
      breakers.snapshot(route.routeKey).probesInFlight,
      "a measurement attempt took one of the live route's half-open probe slots — the slot is " +
        "returned to the measurement run, so the live route can never probe again",
    ).toBe(0);
    expect(breakers.allows(route.routeKey)).toBe(true);
    expect(breakers.onAttemptStart(route.routeKey)).toBe(true);

    shadow.onAttemptEnd(route.routeKey);
    expect(breakers.snapshot(route.routeKey).probesInFlight).toBe(1);
  });

  it("the restored live load still carries no measurement failure onto the live run", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < UNBOUNDED_BURST; index += 1) {
      shadow.onAttemptStart(route.routeKey);
      shadow.onFailure(route.routeKey, "hard");
      shadow.onAttemptEnd(route.routeKey);
    }

    expect(breakers.stateOf(route.routeKey)).toBe("closed");
    expect(breakers.snapshot(route.routeKey).consecutiveFailures).toBe(0);
    expect(breakers.snapshot(route.routeKey).opens).toBe(0);
    expect(breakers.snapshotOnPath(route.routeKey, "shadow").consecutiveFailures).toBe(
      UNBOUNDED_BURST,
    );
  });
});

describe("a breaker open is attributable to the path whose failures drove it", () => {
  it("names the path on every run and counts that path's opens", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });

    for (let index = 0; index < OVER_THRESHOLD; index += 1) {
      breakers.forPath("shadow").onFailure(route.routeKey, "hard");
    }
    breakers.onFailure(route.routeKey, "capacity");

    const all = breakers.snapshotAll();
    expect(all).toHaveLength(2);
    expect(all.map((snapshot) => snapshot.routeKey)).toEqual([route.routeKey, route.routeKey]);
    expect(all.map((snapshot) => snapshot.path)).toEqual(["live", "shadow"]);
    expect(all.map((snapshot) => snapshot.opens)).toEqual([0, 1]);
    expect(all.map((snapshot) => snapshot.state)).toEqual(["closed", "open"]);
    expect(all.map((snapshot) => snapshot.consecutiveFailures)).toEqual([1, OVER_THRESHOLD]);
  });

  it("keeps a path's open count after a success has discarded its failure run", () => {
    const { breakers } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });
    const shadow = breakers.forPath("shadow");

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      shadow.onFailure(route.routeKey, "hard");
    }
    shadow.onSuccess(route.routeKey);

    const snapshot = breakers.snapshotOnPath(route.routeKey, "shadow");
    expect(snapshot.state).toBe("closed");
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.opens).toBe(1);
  });
});

describe("the chain charges each call's failures to its own path", () => {
  it("walks a measurement call's chain without charging the live route", async () => {
    const { breakers } = registryWithClock();
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    const transport = new ScriptedTransport("gateway", () => fails(new Error("provider down")));

    for (let index = 0; index < OVER_THRESHOLD; index += 1) {
      await rejection(
        executeChain<string>(ALIAS, {
          legs: legsOf([primary, secondary], transport),
          content: "prompt",
          responseFormat: "text",
          breakers,
          breakerPath: "shadow",
        }),
        ChainExhaustedError,
      );
    }

    expect(breakers.stateOf(primary.routeKey)).toBe("closed");
    expect(breakers.snapshot(primary.routeKey).consecutiveFailures).toBe(0);
    expect(breakers.snapshotOnPath(primary.routeKey, "shadow").state).toBe("open");
  });

  it("refuses every leg of a measurement call while the live routes are open", async () => {
    const { breakers } = registryWithClock();
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    const transport = new ScriptedTransport("gateway", () =>
      answers("should never be reached", usageFor(primary)),
    );

    for (const route of [primary, secondary]) {
      for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
        breakers.onFailure(route.routeKey, "hard");
      }
    }

    const error = await rejection(
      executeChain<string>(ALIAS, {
        legs: legsOf([primary, secondary], transport),
        content: "prompt",
        responseFormat: "text",
        breakers,
        breakerPath: "shadow",
      }),
      ChainExhaustedError,
    );

    expect(transport.calls).toHaveLength(0);
    expect(error.attempts.map((attempt) => attempt.outcome)).toEqual([
      "breaker-open",
      "breaker-open",
    ]);
    expect(error.attempts.map((attempt) => attempt.reason)).toEqual([
      "circuit breaker is open on the live path",
      "circuit breaker is open on the live path",
    ]);
  });
});

describe("the live partition is unchanged", () => {
  it("records a live call's attempts exactly as it did before the path dimension", async () => {
    const { breakers } = registryWithClock();
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const secondary = makeRoute({ alias: ALIAS, role: "secondary" });
    const transport = new ScriptedTransport("gateway", (call) =>
      call.route.role === "primary"
        ? fails(new Error("provider down"))
        : answers("secondary answer", usageFor(call.route, { completionTokens: 7 })),
    );

    const outcome = await executeChain<string>(ALIAS, {
      legs: legsOf([primary, secondary], transport),
      content: "prompt",
      responseFormat: "text",
      breakers,
    });

    expect(outcome.servedBy.routeKey).toBe(secondary.routeKey);
    const shape = outcome.attempts.map(
      (attempt: AliasAttemptRecord): Pick<AliasAttemptRecord,
        "routeKey" | "role" | "outcome" | "failureClass" | "reason"
      > => ({
        routeKey: attempt.routeKey,
        role: attempt.role,
        outcome: attempt.outcome,
        failureClass: attempt.failureClass,
        reason: attempt.reason,
      }),
    );
    expect(shape).toEqual([
      {
        routeKey: primary.routeKey,
        role: "primary",
        outcome: "error",
        failureClass: "provider_error",
        reason: "provider down",
      },
      {
        routeKey: secondary.routeKey,
        role: "secondary",
        outcome: "ok",
        failureClass: undefined,
        reason: undefined,
      },
    ]);
    expect(legacyFields(breakers.snapshot(primary.routeKey))).toEqual({
      routeKey: primary.routeKey,
      state: "closed",
      consecutiveFailures: 1,
      openedAtMs: null,
      probesInFlight: 0,
      failureKind: "hard",
      cooldownMs: BREAKER.cooldown_ms,
      openedByLatency: false,
      probeBudget: BREAKER.half_open_probes,
    });
  });

  it("scales the half-open probe budget from concurrent live load exactly as before", () => {
    // Uses only the API that predates the path dimension — `onAttemptStart`,
    // `onAttemptEnd`, `onFailure` — so this assertion runs unchanged against the
    // source before the change and pins the peakInFlight -> concurrencyAtOpen ->
    // probeBudget arithmetic the measurement view now also writes into.
    const { breakers, advance } = registryWithClock();
    const route = makeRoute({ alias: ALIAS, role: "primary" });

    for (let index = 0; index < TWENTY_CONCURRENT; index += 1) {
      breakers.onAttemptStart(route.routeKey);
    }
    for (let index = 0; index < TWENTY_CONCURRENT; index += 1) {
      breakers.onAttemptEnd(route.routeKey);
    }
    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    // The high-water mark of concurrent load, not the load at the instant of
    // the open: a burst that drained a moment before the route failed is still
    // the traffic the route has to be re-tested for.
    expect(breakers.snapshot(route.routeKey).probeBudget).toBe(BASELINE_PROBE_BUDGET);

    // Opening re-bases the peak to the load still in flight at that instant, so
    // a LATER open does not inherit a burst that has since drained.
    advance(BREAKER.cooldown_ms);
    breakers.onSuccess(route.routeKey);
    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      breakers.onFailure(route.routeKey, "hard");
    }
    expect(breakers.snapshot(route.routeKey).probeBudget).toBe(BREAKER.half_open_probes);
  });

  it("still opens the live breaker on the live threshold, with the same reason text", async () => {
    const { breakers } = registryWithClock();
    const primary = makeRoute({ alias: ALIAS, role: "primary" });
    const transport = new ScriptedTransport("gateway", () => fails(new Error("provider down")));

    for (let index = 0; index < BREAKER.failure_threshold; index += 1) {
      await rejection(
        executeChain<string>(ALIAS, {
          legs: legsOf([primary], transport),
          content: "prompt",
          responseFormat: "text",
          breakers,
        }),
        ChainExhaustedError,
      );
    }

    expect(legacyFields(breakers.snapshot(primary.routeKey))).toEqual({
      routeKey: primary.routeKey,
      state: "open",
      consecutiveFailures: BREAKER.failure_threshold,
      openedAtMs: T0,
      probesInFlight: 0,
      failureKind: "hard",
      cooldownMs: BREAKER.cooldown_ms,
      openedByLatency: false,
      probeBudget: BREAKER.half_open_probes,
    });

    const error = await rejection(
      executeChain<string>(ALIAS, {
        legs: legsOf([primary], transport),
        content: "prompt",
        responseFormat: "text",
        breakers,
      }),
      ChainExhaustedError,
    );
    expect(error.attempts.map((attempt) => attempt.outcome)).toEqual(["breaker-open"]);
    expect(error.attempts[0].reason).toBe("circuit breaker is open");
    expect(transport.calls).toHaveLength(BREAKER.failure_threshold);
  });
});
