/**
 * Assembly of detector output into inventory sites.
 *
 * A site is one line of one file: the finest granularity the Section-4
 * `site_id` shape can express, and the granularity at which the W4 codemods
 * will actually edit. Anchors landing on the same line describe one site, so
 * they are merged rather than emitted as duplicates.
 *
 * @module scripts/inventory/build-sites
 */

import { needsAdapter } from "./capabilities";
import { classifyPath } from "./path-heuristics";
import type { FileScanResult, InventorySite } from "./types";

/** Token volumes are unknowable from source; they are joined from billing exports at W1-03. */
const UNKNOWN_MONTHLY_TOKENS = { in: 0, out: 0 } as const;

/**
 * Turn one file's detector output into inventory sites.
 *
 * `model_current` and `alias` are only populated from evidence present on the
 * site's own line. When a site reaches a model without naming one, the field
 * stays `null`: attributing the file's only other literal to it would assert a
 * route that no code performs, and a fabricated value in an audit artefact is
 * worse than a stated gap.
 *
 * @param result - Detector output for one file.
 * @returns One site per anchored line, ordered by line number.
 */
export function buildSitesForFile(
  result: FileScanResult,
): readonly InventorySite[] {
  if (result.anchors.length === 0) {
    return [];
  }

  const classification = classifyPath(result.repo, result.path);
  const adapterRequired = needsAdapter(result.adapterSignals);

  const byLine = new Map<number, InventorySite>();
  for (const anchor of result.anchors) {
    const existing = byLine.get(anchor.line);
    const modelCurrent = existing?.model_current ?? anchor.modelLiteral;
    const alias = existing?.alias ?? anchor.alias;
    byLine.set(anchor.line, {
      site_id: `${result.repo}/${result.path}#L${anchor.line}`,
      model_current: modelCurrent,
      features: result.features,
      latency_class: classification.latencyClass,
      criticality: classification.criticality,
      monthly_tokens: { ...UNKNOWN_MONTHLY_TOKENS },
      alias,
      needs_adapter: adapterRequired,
      eval_gate: null,
      status: "discovered",
    });
  }

  return [...byLine.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, site]) => site);
}

/**
 * Order sites deterministically.
 *
 * Sorted by repository, then path, then line as a NUMBER. A lexicographic sort
 * of `site_id` would place `#L10` before `#L2`, which is stable but reads as
 * corrupt to anyone diffing the artefact by hand.
 *
 * @param sites - Sites in any order.
 * @returns A new array in canonical order.
 */
export function sortSites(
  sites: readonly InventorySite[],
): readonly InventorySite[] {
  const key = (site: InventorySite): { file: string; line: number } => {
    const hash = site.site_id.lastIndexOf("#L");
    return {
      file: site.site_id.slice(0, hash),
      line: Number(site.site_id.slice(hash + 2)),
    };
  };
  return [...sites].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    return a.file.localeCompare(b.file) || a.line - b.line;
  });
}
