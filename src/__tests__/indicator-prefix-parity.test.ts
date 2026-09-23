/**
 * Recursive-indicator prefix-parity golden master (QuantDinger port, W1-1).
 *
 * Recursive indicators — the EMA and Wilder families — compute bar N from
 * their own value at bar N-1. That makes them sensitive to how much history
 * they are handed, in a way that is invisible at the call site: the same
 * function, the same symbol and the same period produce a different number
 * after a restart refills a short buffer than they do mid-session. This repo's
 * two most expensive indicator defects were both of that shape — a cold-start
 * warm-up and a feature vector that was 125 exact zeros because the buffers
 * that fed it never filled.
 *
 * The harness answers three questions, with no market data and no network:
 *
 *   1. CAUSALITY — does the value at bar i depend on any bar after i? A
 *      left-anchored recursion must give the same answer for bar i whether it
 *      was fed 20 bars or 60, and a violation is look-ahead.
 *   2. CORRECTNESS — does the implementation agree with an INDEPENDENT
 *      reference written from the indicator's definition? Where it does not,
 *      the disagreement must be declared with its mechanism. An undeclared one
 *      fails this suite.
 *   3. STABILITY — does the recorded value at every prefix length still hold?
 *
 * The fixture is regenerated with `node scripts/generate-indicator-parity-fixture.mjs`.
 */

import { describe, expect, it } from "vitest";
import {
  buildTrack,
  captureOutcome,
  FIXTURE_PATH_FROM_PACKAGE_ROOT,
} from "./indicator-parity/generate";
import {
  DECLARED_DEVIATIONS,
  declaredDeviationFor,
  outcomesEqual,
  referenceOf,
  toReading,
  type IndicatorEntry,
  type ParityFixture,
} from "./indicator-parity/record";
import {
  referenceAtr,
  referenceEma,
  referenceEwmaVolatility,
  referenceRsi,
} from "./indicator-parity/reference";
import {
  buildSeries,
  PARITY_SERIES_IDS,
  prefixLengths,
  SERIES_LENGTH,
} from "./indicator-parity/series";
import { PARITY_SUBJECTS } from "./indicator-parity/subjects";
import { calculateATR, calculateATREMA } from "../atr";
import { calculateEWMAVolatility } from "../volatility";
import storedFixture from "./fixtures/indicator-prefix-parity.json";

const fixture = storedFixture as unknown as ParityFixture;

/** Locate a recorded track, failing loudly when the fixture is missing rows. */
function trackFor(subjectId: string, seriesId: string) {
  const track = fixture.tracks.find(
    (candidate) => candidate.subjectId === subjectId && candidate.seriesId === seriesId,
  );
  if (track === undefined) {
    throw new Error(
      `fixture has no track for ${subjectId}/${seriesId}; regenerate ${FIXTURE_PATH_FROM_PACKAGE_ROOT}`,
    );
  }
  return track;
}

/** Whether two entry lists describe the same readings, treating NaN as equal to itself. */
function entriesEqual(a: readonly IndicatorEntry[], b: readonly IndicatorEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].barIndex !== b[i].barIndex) return false;
    const keys = new Set([
      ...Object.keys(a[i].components),
      ...Object.keys(b[i].components),
    ]);
    for (const key of keys) {
      if (!Object.is(a[i].components[key], b[i].components[key])) return false;
    }
  }
  return true;
}

describe("indicator prefix parity: fixture covers the whole matrix", () => {
  it("records every subject against every series", () => {
    const expectedTracks = PARITY_SUBJECTS.length * PARITY_SERIES_IDS.length;
    expect(fixture.tracks).toHaveLength(expectedTracks);
    expect(fixture.seriesLength).toBe(SERIES_LENGTH);
    for (const subject of PARITY_SUBJECTS) {
      for (const seriesId of PARITY_SERIES_IDS) {
        expect(trackFor(subject.id, seriesId).points).toHaveLength(
          prefixLengths().length,
        );
      }
    }
  });
});

describe.each(PARITY_SUBJECTS.map((subject) => [subject.id, subject] as const))(
  "indicator prefix parity: %s",
  (_id, subject) => {
    it.each(PARITY_SERIES_IDS)(
      "reproduces the recorded outcome at every prefix of the %s series",
      (seriesId) => {
        const bars = buildSeries(seriesId);
        const recorded = trackFor(subject.id, seriesId);
        for (const point of recorded.points) {
          const prefixBars = bars.slice(0, point.prefix);
          const production = captureOutcome(subject.production, prefixBars);
          const reference = captureOutcome(subject.reference, prefixBars);
          expect(
            outcomesEqual(production, point.production),
            `${subject.id}/${seriesId} prefix ${point.prefix}: production drifted from the record`,
          ).toBe(true);
          expect(
            outcomesEqual(reference, referenceOf(point)),
            `${subject.id}/${seriesId} prefix ${point.prefix}: the independent reference drifted from the record`,
          ).toBe(true);
        }
      },
    );

    it.each(PARITY_SERIES_IDS)(
      "agrees with the independent reference on the %s series, or the disagreement is declared",
      (seriesId) => {
        const declaration = declaredDeviationFor(subject.id, seriesId);
        const recorded = trackFor(subject.id, seriesId);
        const deviating = recorded.points.filter((point) => point.deviates);
        if (declaration === undefined) {
          expect(
            deviating.map((point) => point.prefix),
            `${subject.id}/${seriesId} disagrees with the independently derived value at these prefixes. ` +
              "Either the implementation is wrong, or the disagreement is real and must be declared " +
              "in DECLARED_DEVIATIONS with its mechanism. It must not be absorbed into the fixture.",
          ).toEqual([]);
          return;
        }
        expect(
          deviating.length,
          `${subject.id}/${seriesId} declares deviation ${declaration.finding} but no longer deviates — ` +
            "delete the declaration if this was fixed",
        ).toBeGreaterThan(0);
      },
    );

    if (subject.emitsSeries) {
      it.each(PARITY_SERIES_IDS)(
        "is causal on the %s series: no value at bar i depends on any bar after i",
        (seriesId) => {
          const bars = buildSeries(seriesId);
          const full = subject.production(bars);
          for (const prefix of prefixLengths()) {
            const partial = subject.production(bars.slice(0, prefix));
            expect(
              entriesEqual(partial, full.slice(0, partial.length)),
              `${subject.id}/${seriesId}: the ${prefix}-bar prefix disagrees with the full series ` +
                "on bars they share — the recursion is reading ahead",
            ).toBe(true);
          }
        },
      );
    }
  },
);

describe("indicator prefix parity: the declared-deviation list cannot rot", () => {
  it("names only subjects and series that exist", () => {
    const subjectIds = new Set(PARITY_SUBJECTS.map((subject) => subject.id));
    for (const declaration of DECLARED_DEVIATIONS) {
      expect(subjectIds.has(declaration.subjectId)).toBe(true);
      for (const seriesId of declaration.seriesIds) {
        expect(PARITY_SERIES_IDS).toContain(seriesId);
      }
      expect(declaration.mechanism.length).toBeGreaterThan(0);
    }
  });

  it("matches the deviations the fixture actually records", () => {
    const recordedPairs = fixture.tracks
      .filter((track) => track.points.some((point) => point.deviates))
      .map((track) => `${track.subjectId}/${track.seriesId}`)
      .sort();
    const declaredPairs = DECLARED_DEVIATIONS.flatMap((declaration) =>
      declaration.seriesIds.map((seriesId) => `${declaration.subjectId}/${seriesId}`),
    ).sort();
    expect(recordedPairs).toEqual(declaredPairs);
  });
});

describe("indicator prefix parity: the scalar calls agree with the series primitive", () => {
  it.each(PARITY_SERIES_IDS)(
    "calculateATR over a %s prefix equals calculateATREMA at that prefix's last bar",
    (seriesId) => {
      const bars = buildSeries(seriesId);
      for (const prefix of prefixLengths()) {
        const slice = bars.slice(0, prefix);
        const highs = slice.map((b) => b.high);
        const lows = slice.map((b) => b.low);
        const closes = slice.map((b) => b.close);
        const scalar = calculateATR(highs, lows, closes, 5);
        const series = calculateATREMA(highs, lows, closes, 5);
        expect(
          Object.is(scalar, series[series.length - 1]),
          `ATR(5) scalar and series disagree at prefix ${prefix} of ${seriesId}`,
        ).toBe(true);
      }
    },
  );
});

describe("indicator prefix parity: typed failures are pinned as tightly as values", () => {
  it("records a throw as a first-class outcome", () => {
    const outcome = captureOutcome(() => {
      throw new Error("boom");
    }, []);
    expect(outcome).toEqual({ kind: "throws", message: "boom" });
  });

  it("rejects a non-integer or non-positive ATR period", () => {
    expect(() => calculateATR([1, 2], [0, 1], [1, 2], 0)).toThrow(
      "ATR: period must be a positive integer",
    );
    expect(() => calculateATR([1, 2], [0, 1], [1, 2], 1.5)).toThrow(
      "ATR: period must be a positive integer",
    );
    expect(() => calculateATREMA([1, 2], [0, 1], [1, 2], 0)).toThrow(
      "ATR: period must be a positive integer",
    );
  });

  it("rejects ragged high/low/close series", () => {
    expect(() => calculateATR([1, 2, 3], [0, 1], [1, 2, 3], 2)).toThrow(
      "ATR: highs, lows, closes must have equal length",
    );
    expect(() => calculateATREMA([1, 2, 3], [0, 1], [1, 2, 3], 2)).toThrow(
      "ATREMA: highs, lows, closes must have equal length",
    );
  });

  it("rejects an EWMA decay factor outside (0, 1)", () => {
    expect(() => calculateEWMAVolatility([0.01], 0)).toThrow(
      "calculateEWMAVolatility: lambda must be in (0,1)",
    );
    expect(() => calculateEWMAVolatility([0.01], 1)).toThrow(
      "calculateEWMAVolatility: lambda must be in (0,1)",
    );
  });

  it("returns a typed insufficient-data result rather than a fabricated value", () => {
    // Wilder ATR needs period + 1 bars: the first bar has no prior close.
    expect(calculateATR([1, 2, 3], [0, 1, 2], [1, 2, 3], 5)).toBeNull();
    expect(calculateATREMA([1, 2, 3], [0, 1, 2], [1, 2, 3], 5)).toEqual([
      null,
      null,
      null,
    ]);
    expect(calculateEWMAVolatility([], 0.94)).toBeNull();
  });
});

describe("indicator prefix parity: the reference implementations match hand arithmetic", () => {
  it("seeds the EMA with the simple mean and then applies 2/(period+1)", () => {
    // closes 10, 20, 30, 40  with period 3.
    // seed at bar 2 = (10 + 20 + 30) / 3 = 20.
    // bar 3 = (40 - 20) * 2/4 + 20 = 30.
    expect(referenceEma([10, 20, 30, 40], 3)).toEqual([null, null, 20, 30]);
  });

  it("seeds Wilder ATR with the mean true range and then smooths by (n-1)/n", () => {
    // Four bars, each high-low = 2, and no gaps, so every true range is 2.
    // seed at bar 2 = (2 + 2) / 2 = 2; bar 3 = (2 * 1 + 2) / 2 = 2.
    const highs = [11, 11, 11, 11];
    const lows = [9, 9, 9, 9];
    const closes = [10, 10, 10, 10];
    expect(referenceAtr(highs, lows, closes, 2)).toEqual([null, null, 2, 2]);
  });

  it("computes the Wilder RSI from the average gain and loss", () => {
    // closes 10, 11, 10, 11 with period 2.
    // warm-up over bars 1..2: gain 1, loss 1 -> avgGain 0.5, avgLoss 0.5,
    // RS = 1, RSI = 100 - 100/2 = 50.
    // bar 3: change +1 -> avgGain = (0.5 * 1 + 1) / 2 = 0.75,
    //                     avgLoss = (0.5 * 1 + 0) / 2 = 0.25,
    // RS = 3, RSI = 100 - 100/4 = 75.
    expect(referenceRsi([10, 11, 10, 11], 2)).toEqual([null, null, 50, 75]);
  });

  it("seeds the EWMA variance with the first squared return and decays it", () => {
    // returns 0.1, 0.2 with lambda 0.5.
    // variance = 0.5 * 0.01 + 0.5 * 0.04 = 0.025; sqrt = 0.15811388300841897.
    const volatility = referenceEwmaVolatility([0.1, 0.2], 0.5);
    expect(volatility).not.toBeNull();
    expect(volatility ?? 0).toBeCloseTo(Math.sqrt(0.025), 15);
  });
});

describe("indicator prefix parity: the harness regenerates deterministically", () => {
  it("rebuilds a track byte-identically to the stored one", () => {
    const subject = PARITY_SUBJECTS[0];
    const rebuilt = buildTrack(subject, "gaps");
    expect(JSON.stringify(rebuilt)).toEqual(
      JSON.stringify(trackFor(subject.id, "gaps")),
    );
  });

  it("summarises an empty emission as a zero-count reading, never as a value", () => {
    expect(toReading([])).toEqual({
      count: 0,
      firstBarIndex: null,
      tailBarIndex: null,
      tail: null,
    });
  });
});
