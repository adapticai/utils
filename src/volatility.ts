/**
 * Realized and EWMA volatility + regime classifier + annualisation helper.
 * All functions pure.
 */

/**
 * Volatility regime categorisation: calm (quiet markets), normal (regular trading),
 * elevated (above-average volatility), crisis (panic/stress regime).
 */
export type VolatilityRegime = "calm" | "normal" | "elevated" | "crisis";

/**
 * Threshold bands for classifying a volatility value into a {@link VolatilityRegime}.
 *
 * Invariant: `calmMax < elevatedMax < crisisMin` (enforced at runtime by
 * {@link detectVolatilityRegime}).
 */
export interface RegimeBands {
  /** Volatility at or below this is "calm". */
  calmMax: number;
  /** Volatility at or above this (but below crisisMin) is "elevated". */
  elevatedMax: number;
  /** Volatility at or above this is "crisis". */
  crisisMin: number;
}

/**
 * Sample standard deviation (Bessel-corrected) of returns over the most recent
 * `window` samples.
 * @returns null when fewer than `window` samples.
 */
export function calculateRealizedVolatility(
  returns: number[],
  window: number,
): number | null {
  if (window < 2 || !Number.isInteger(window)) {
    throw new Error("calculateRealizedVolatility: window must be an integer >= 2");
  }
  if (returns.length < window) return null;
  const slice = returns.slice(-window);
  const mean = slice.reduce((a, b) => a + b, 0) / window;
  const variance =
    slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (window - 1);
  return Math.sqrt(variance);
}

/**
 * EWMA volatility (RiskMetrics-style). λ ∈ (0,1); higher = longer memory.
 * Default usage: λ = 0.94 for daily returns.
 *
 * For a single-element input, the function returns `|returns[0]|` (the seed)
 * since no smoothing iterations are possible.
 *
 * @param returns - Period returns (e.g., log returns or simple returns).
 * @param lambda - Decay factor in (0,1).
 * @returns EWMA standard deviation, or null on empty input.
 * @throws when `lambda` is outside (0,1).
 */
export function calculateEWMAVolatility(
  returns: number[],
  lambda: number,
): number | null {
  if (lambda <= 0 || lambda >= 1) {
    throw new Error("calculateEWMAVolatility: lambda must be in (0,1)");
  }
  if (returns.length === 0) return null;
  let variance = returns[0] ** 2;
  for (let i = 1; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * returns[i] ** 2;
  }
  return Math.sqrt(variance);
}

/**
 * Classify a volatility value into one of four regimes.
 *
 * Bands are checked in the order: crisis (≥crisisMin) → elevated (≥elevatedMax)
 * → calm (≤calmMax) → normal (otherwise).
 *
 * @throws when bands are not strictly ordered (calmMax < elevatedMax < crisisMin).
 */
export function detectVolatilityRegime(
  volatility: number,
  bands: RegimeBands,
): VolatilityRegime {
  if (!(bands.calmMax < bands.elevatedMax && bands.elevatedMax < bands.crisisMin)) {
    throw new Error(
      `detectVolatilityRegime: bands must satisfy calmMax < elevatedMax < crisisMin (got ${JSON.stringify(bands)})`,
    );
  }
  if (volatility >= bands.crisisMin) return "crisis";
  if (volatility >= bands.elevatedMax) return "elevated";
  if (volatility <= bands.calmMax) return "calm";
  return "normal";
}

/**
 * Annualise a volatility computed at the given cadence by multiplying by
 * the square root of the periods per year.
 *
 * - daily   → sqrt(252)              (252 trading days per year)
 * - hourly  → sqrt(252 × 6.5)        (6.5 RTH hours per trading day)
 * - minute  → sqrt(252 × 6.5 × 60)   (60 minutes per RTH hour)
 *
 * @param volatility - Per-period volatility (stddev).
 * @param cadence - The cadence at which `volatility` was sampled.
 * @returns The annualised volatility.
 */
export function annualiseVolatility(
  volatility: number,
  cadence: "daily" | "hourly" | "minute",
): number {
  switch (cadence) {
    case "daily":  return volatility * Math.sqrt(252);
    case "hourly": return volatility * Math.sqrt(252 * 6.5);
    case "minute": return volatility * Math.sqrt(252 * 6.5 * 60);
  }
}
