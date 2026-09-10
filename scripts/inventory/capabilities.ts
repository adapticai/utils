/**
 * Capability detection and the single adapter-necessity predicate.
 *
 * Migration doc Section 3 names five signals that force a provider adapter
 * before a site can be mapped. They are gathered here, behind one named
 * predicate, so the rule is stated once: a reviewer (and gate G5) can assert
 * that each individual signal drives `needs_adapter`, which is impossible when
 * the same disjunction is re-typed at three call sites.
 *
 * @module scripts/inventory/capabilities
 */

import {
  CACHE_CONTROL_MARKERS,
  CONTEXT_WINDOW_ADAPTER_THRESHOLD_TOKENS,
  CONTEXT_WINDOW_PROPERTY_NAMES,
  JSON_SCHEMA_MARKERS,
  PROVIDER_STREAMING_MARKERS,
  STREAMING_MARKERS,
  STRICT_MARKER,
  TOOL_USE_MARKERS,
  VISION_MARKERS,
} from "./detector-config";
import type { AdapterSignals, CapabilityFeature } from "./types";

/**
 * Syntactic facts harvested from one source file.
 *
 * Capability detection reads facts rather than raw text so that a marker word
 * appearing inside a comment or an unrelated prose string cannot register: only
 * identifiers, property names, string literals and literal-valued properties
 * that the parser actually produced are considered.
 */
export interface SourceMarkers {
  /** Property names appearing in object literals, interfaces, and member accesses. */
  readonly propertyNames: ReadonlySet<string>;
  /** Identifier names appearing anywhere in the file. */
  readonly identifiers: ReadonlySet<string>;
  /** String-literal contents appearing anywhere in the file. */
  readonly stringLiterals: ReadonlySet<string>;
  /** Property names whose initialiser is the literal `true`. */
  readonly trueValuedProperties: ReadonlySet<string>;
  /** Property names whose initialiser is a numeric literal, keyed to the largest such value. */
  readonly numericProperties: ReadonlyMap<string, number>;
}

/** An empty marker set, for fixtures and for files that parse to nothing. */
export function emptySourceMarkers(): SourceMarkers {
  return {
    propertyNames: new Set<string>(),
    identifiers: new Set<string>(),
    stringLiterals: new Set<string>(),
    trueValuedProperties: new Set<string>(),
    numericProperties: new Map<string, number>(),
  };
}

function hasAnyMarker(
  markers: SourceMarkers,
  candidates: readonly string[],
): boolean {
  return candidates.some(
    (candidate) =>
      markers.propertyNames.has(candidate) ||
      markers.identifiers.has(candidate) ||
      markers.stringLiterals.has(candidate),
  );
}

/**
 * Detect the five schema capability flags for one file.
 *
 * Streaming is special-cased: a property literally named `stream` is only
 * evidence when it is set to `true`, because `stream` is a common name for
 * unrelated things, whereas the vendor-shaped chunk types are unambiguous.
 *
 * @param markers - Syntactic facts from the file.
 * @returns The detected capability flags, sorted for stable output.
 */
export function detectFeatures(
  markers: SourceMarkers,
): readonly CapabilityFeature[] {
  const features: CapabilityFeature[] = [];

  if (hasAnyMarker(markers, TOOL_USE_MARKERS)) {
    features.push("tool_use");
  }
  if (hasAnyMarker(markers, JSON_SCHEMA_MARKERS)) {
    features.push("json_schema");
  }

  const namedStreamingMarkers = STREAMING_MARKERS.filter(
    (marker) => marker !== "stream",
  );
  const streams =
    markers.trueValuedProperties.has("stream") ||
    hasAnyMarker(markers, namedStreamingMarkers) ||
    hasAnyMarker(markers, PROVIDER_STREAMING_MARKERS);
  if (streams) {
    features.push("streaming");
  }

  if (hasAnyMarker(markers, VISION_MARKERS)) {
    features.push("vision");
  }
  if (hasAnyMarker(markers, CACHE_CONTROL_MARKERS)) {
    features.push("cache_control");
  }

  return features.sort();
}

/**
 * Detect the five Section-3 adapter-forcing signals for one file.
 *
 * `strict_json_schema` requires both a JSON-schema response format and an
 * explicit `strict: true`: a schema-shaped format that providers accept loosely
 * is portable, while strict enforcement is not uniformly implemented.
 * `context_over_threshold` reads a declared context size rather than guessing
 * one, so a site is only flagged when the code itself states the requirement.
 *
 * @param markers - Syntactic facts from the file.
 * @param features - Capability flags already detected for the same file.
 * @returns The adapter-forcing signals.
 */
export function detectAdapterSignals(
  markers: SourceMarkers,
  features: readonly CapabilityFeature[],
): AdapterSignals {
  const declaredContext = CONTEXT_WINDOW_PROPERTY_NAMES.map(
    (name) => markers.numericProperties.get(name) ?? 0,
  );
  const largestDeclaredContext = declaredContext.reduce(
    (largest, candidate) => (candidate > largest ? candidate : largest),
    0,
  );

  return {
    cache_control: features.includes("cache_control"),
    strict_json_schema:
      features.includes("json_schema") &&
      markers.trueValuedProperties.has(STRICT_MARKER),
    vision: features.includes("vision"),
    context_over_threshold:
      largestDeclaredContext > CONTEXT_WINDOW_ADAPTER_THRESHOLD_TOKENS,
    provider_specific_streaming:
      features.includes("streaming") &&
      hasAnyMarker(markers, PROVIDER_STREAMING_MARKERS),
  };
}

/**
 * The Section-3 signals, in the order the migration doc states them.
 *
 * Exported so a gate can enumerate them and prove each one independently drives
 * {@link needsAdapter}, rather than trusting that the disjunction below covers
 * the list.
 */
export const ADAPTER_FORCING_SIGNALS: readonly (keyof AdapterSignals)[] = [
  "cache_control",
  "strict_json_schema",
  "vision",
  "context_over_threshold",
  "provider_specific_streaming",
];

/**
 * The single adapter-necessity predicate.
 *
 * A site needs an adapter when any Section-3 signal is present. Stated as one
 * fold over {@link ADAPTER_FORCING_SIGNALS} so that adding a signal to the list
 * automatically extends the predicate and the gate that checks it.
 *
 * @param signals - Adapter-forcing signals for the site.
 * @returns True when the site cannot be served portably without an adapter.
 */
export function needsAdapter(signals: AdapterSignals): boolean {
  return ADAPTER_FORCING_SIGNALS.some((signal) => signals[signal]);
}
