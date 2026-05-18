/**
 * VaR, Expected Shortfall (CVaR), conditional drawdown, rolling drawdown, Sortino, Calmar.
 *
 * Convention: VaR and ES are returned as the actual quantile value (typically negative
 * for losses). Drawdowns from `calculateConditionalDrawdown` are returned as non-negative
 * magnitudes (e.g., 0.05 = 5% drawdown). Drawdowns from `calculateRollingDrawdown` are
 * non-positive (e.g., -0.05 = 5% below rolling peak, 0 = at or above peak).
 *
 * All public functions reject non-finite inputs (NaN, Infinity) by throwing. Callers
 * must pre-validate or filter their inputs.
 */

function assertAlpha(alpha: number): void {
  if (!(alpha > 0 && alpha < 1)) {
    throw new Error(`alpha must be in (0,1), got ${alpha}`);
  }
}

function assertFiniteArray(name: string, arr: number[]): void {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) {
      throw new Error(`${name}: input contains non-finite value at index ${i}: ${arr[i]}`);
    }
  }
}

/**
 * Historical-bootstrap VaR at confidence `alpha`.
 * E.g., alpha=0.95 returns the 5%-quantile of returns (the loss at the 5th percentile).
 *
 * @returns The quantile value (typically negative), or null on empty input.
 */
export function calculateVaRHistorical(
  returns: number[],
  alpha: number,
): number | null {
  assertAlpha(alpha);
  if (returns.length === 0) return null;
  assertFiniteArray("calculateVaRHistorical", returns);
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor((1 - alpha) * sorted.length) - 1);
  return sorted[idx];
}

/**
 * Gaussian parametric VaR: μ + zα·σ where zα is the (1-alpha) standard-normal quantile.
 *
 * @returns The Gaussian quantile, or null when fewer than 2 samples.
 */
export function calculateVaRParametric(
  returns: number[],
  alpha: number,
): number | null {
  assertAlpha(alpha);
  if (returns.length < 2) return null;
  assertFiniteArray("calculateVaRParametric", returns);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const sigma = Math.sqrt(variance);
  const z = inverseStdNormal(1 - alpha);
  return mean + z * sigma;
}

/**
 * Expected Shortfall (Conditional VaR): average of returns below the (1-alpha) quantile.
 *
 * @returns The mean tail return (typically negative), or null on empty input.
 */
export function calculateExpectedShortfall(
  returns: number[],
  alpha: number,
): number | null {
  assertAlpha(alpha);
  if (returns.length === 0) return null;
  assertFiniteArray("calculateExpectedShortfall", returns);
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor((1 - alpha) * sorted.length));
  const tail = sorted.slice(0, cutoff);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

/**
 * Conditional Drawdown at Risk (CDaR): average of drawdowns in the worst (1-alpha) tail.
 * Drawdowns are computed as (peak - equity) / peak so they are non-negative.
 *
 * @returns A non-negative magnitude (0 = no drawdowns), or null for fewer than 2 samples.
 */
export function calculateConditionalDrawdown(
  equity: number[],
  alpha: number,
): number | null {
  assertAlpha(alpha);
  if (equity.length < 2) return null;
  assertFiniteArray("calculateConditionalDrawdown", equity);
  let peak = equity[0];
  const drawdowns: number[] = [];
  for (const e of equity) {
    if (e > peak) peak = e;
    drawdowns.push(peak > 0 ? (peak - e) / peak : 0);
  }
  if (drawdowns.every((d) => d === 0)) return 0;
  const sorted = [...drawdowns].sort((a, b) => b - a); // descending (worst first)
  const cutoff = Math.max(1, Math.floor((1 - alpha) * sorted.length));
  const tail = sorted.slice(0, cutoff);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

/**
 * Rolling-window drawdown series: for each index, drawdown = (current - rollingPeak) / rollingPeak.
 * Non-positive values; 0 when at or above the rolling peak. Window measured in samples.
 *
 * @returns An array the same length as `equity`.
 */
export function calculateRollingDrawdown(
  equity: number[],
  windowSize: number,
): number[] {
  if (windowSize < 1 || !Number.isInteger(windowSize)) {
    throw new Error("calculateRollingDrawdown: windowSize must be a positive integer");
  }
  assertFiniteArray("calculateRollingDrawdown", equity);
  return equity.map((_, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const slice = equity.slice(start, i + 1);
    const peak = Math.max(...slice);
    return peak > 0 ? (equity[i] - peak) / peak : 0;
  });
}

/**
 * Sortino ratio: (mean excess return) / downside deviation.
 * Returns +Infinity when there are no downside returns.
 * Returns null when fewer than 2 samples.
 */
export function calculateSortino(
  returns: number[],
  riskFreeRate: number,
): number | null {
  if (returns.length < 2) return null;
  assertFiniteArray("calculateSortino", returns);
  const excess = returns.map((r) => r - riskFreeRate);
  const meanExcess = excess.reduce((a, b) => a + b, 0) / excess.length;
  const downside = excess.filter((r) => r < 0);
  if (downside.length === 0) return Number.POSITIVE_INFINITY;
  const dd = Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / downside.length);
  return meanExcess / dd;
}

/**
 * Calmar ratio: CAGR / |max drawdown|.
 *
 * @returns null when there is no drawdown (division by zero), fewer than 2 samples,
 *          or `equity[0] <= 0` (CAGR undefined).
 */
export function calculateCalmar(equity: number[], periodsPerYear: number): number | null {
  if (equity.length < 2) return null;
  if (equity[0] <= 0) return null;
  if (periodsPerYear <= 0) {
    throw new Error("calculateCalmar: periodsPerYear must be > 0");
  }
  assertFiniteArray("calculateCalmar", equity);
  const total = equity[equity.length - 1] / equity[0];
  const years = (equity.length - 1) / periodsPerYear;
  const cagr = years > 0 ? Math.pow(total, 1 / years) - 1 : 0;

  let peak = equity[0];
  let maxDd = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = peak > 0 ? (peak - e) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd === 0 ? null : cagr / maxDd;
}

/**
 * Beasley-Springer-Moro approximation of the inverse standard normal CDF.
 * Accurate to ~1e-9 across the full domain; sufficient for VaR work.
 */
function inverseStdNormal(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be in (0,1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
             3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
         ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
