/**
 * Builds the prefix-parity golden master by running BOTH the production
 * indicators and the independent references over every (series, prefix) pair.
 *
 * The fixture is never generated from production alone. Each point carries the
 * reference outcome beside the production outcome and a `deviates` flag, so a
 * disagreement is recorded as a disagreement rather than silently becoming the
 * expected answer — which is the failure mode a golden master most easily
 * introduces.
 *
 * Generation and verification share this module, so the record can never be
 * produced by a different code path from the one that checks it.
 */

import {
  FIXTURE_FORMAT_VERSION,
  outcomesEqual,
  toReading,
  type Outcome,
  type ParityFixture,
  type ParityPoint,
  type ParityTrack,
} from "./record";
import {
  PARITY_SERIES_IDS,
  SERIES_LENGTH,
  buildSeries,
  prefixLengths,
  type ParityBar,
  type ParitySeriesId,
} from "./series";
import { PARITY_SUBJECTS, type ParitySubject } from "./subjects";

/**
 * Run one implementation and capture what it did, value or throw alike.
 *
 * A thrown error is a first-class recorded outcome. "This input must raise" is
 * a contract, and an implementation that quietly begins returning a number for
 * a malformed request has changed that contract just as surely as one that
 * changes a value.
 *
 * @param invoke - The implementation to run.
 * @param bars - The prefix to run it over.
 * @returns The outcome, as stored in the fixture.
 */
export function captureOutcome(
  invoke: (bars: readonly ParityBar[]) => ReturnType<ParitySubject["production"]>,
  bars: readonly ParityBar[],
): Outcome {
  try {
    return { kind: "reading", reading: toReading(invoke(bars)) };
  } catch (error) {
    return {
      kind: "throws",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Record one subject against one series, at every prefix length.
 *
 * @param subject - The indicator configuration.
 * @param seriesId - The adversarial series.
 * @returns The recorded track.
 */
export function buildTrack(
  subject: ParitySubject,
  seriesId: ParitySeriesId,
): ParityTrack {
  const bars = buildSeries(seriesId);
  const points: ParityPoint[] = prefixLengths().map((prefix) => {
    const prefixBars = bars.slice(0, prefix);
    const production = captureOutcome(subject.production, prefixBars);
    const reference = captureOutcome(subject.reference, prefixBars);
    const deviates = !outcomesEqual(production, reference);
    return deviates
      ? { prefix, production, reference, deviates }
      : { prefix, production, deviates };
  });
  return { subjectId: subject.id, seriesId, points };
}

/**
 * Build the whole golden master from the current tree.
 *
 * @returns The fixture, ready to serialise or to compare against the stored one.
 */
export function buildFixture(): ParityFixture {
  const tracks: ParityTrack[] = [];
  for (const subject of PARITY_SUBJECTS) {
    for (const seriesId of PARITY_SERIES_IDS) {
      tracks.push(buildTrack(subject, seriesId));
    }
  }
  return {
    formatVersion: FIXTURE_FORMAT_VERSION,
    seriesLength: SERIES_LENGTH,
    tracks,
  };
}

/**
 * Where the golden master lives, relative to the package root.
 *
 * Declared once so the generator and the test cannot drift onto two different
 * files — a check that reads a fixture nobody writes passes forever.
 */
export const FIXTURE_PATH_FROM_PACKAGE_ROOT =
  "src/__tests__/fixtures/indicator-prefix-parity.json";

/**
 * Serialise the fixture the way it is stored on disk.
 *
 * One recorded point per line, hand-assembled rather than handed to
 * `JSON.stringify(..., 2)`. Fully indented output runs to tens of thousands of
 * lines for the same data, which makes a diff unreadable and a review
 * impossible — and an unreviewable golden master is a golden master nobody
 * checks. The output is still ordinary JSON.
 *
 * @param fixture - The fixture to serialise.
 * @returns JSON with one point per line and a trailing newline.
 */
export function serialiseFixture(fixture: ParityFixture): string {
  const lines: string[] = [
    "{",
    `  "formatVersion": ${fixture.formatVersion},`,
    `  "seriesLength": ${fixture.seriesLength},`,
    '  "tracks": [',
  ];
  fixture.tracks.forEach((track, trackIndex) => {
    const trackComma = trackIndex === fixture.tracks.length - 1 ? "" : ",";
    lines.push("    {");
    lines.push(`      "subjectId": ${JSON.stringify(track.subjectId)},`);
    lines.push(`      "seriesId": ${JSON.stringify(track.seriesId)},`);
    lines.push('      "points": [');
    track.points.forEach((point, pointIndex) => {
      const pointComma = pointIndex === track.points.length - 1 ? "" : ",";
      lines.push(`        ${JSON.stringify(point)}${pointComma}`);
    });
    lines.push("      ]");
    lines.push(`    }${trackComma}`);
  });
  lines.push("  ]");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}
