import { logIfDebug } from "./misc-utils";
import {
  BollingerBandsData,
  BollingerBandsParams,
  MassivePriceData,
} from "./types";

/**
 * Round a PRICE-scale indicator output to a precision derived from its own
 * magnitude, rather than a hardcoded 2 decimal places.
 *
 * A flat `toFixed(2)` silently destroys every sub-penny price — a $0.0003
 * microcap's bands collapse to `0.00`, and a MACD histogram of a low-priced
 * name rounds to nothing (F7.2). Precision must scale with the price: values at
 * or above $1 keep the conventional 2dp, while sub-dollar values keep ~4
 * significant figures so the number survives its own scale. Non-finite inputs
 * pass through untouched — totality of the underlying value is the caller's
 * responsibility, this helper only quantises.
 *
 * The `>= $1` branch delegates to `toFixed(2)` rather than re-deriving it as
 * `Math.round(value * 100) / 100`. The two disagree wherever the intermediate
 * `value * 100` rounds onto an exact `.5` that the decimal value sits just
 * below (`1.045` → `1.05` vs `1.04`), which would make this helper shift
 * ordinary dollar prices by a cent — a behaviour change well outside repairing
 * sub-penny collapse. Delegating keeps the common case byte-identical to the
 * historical output by construction, which matters because the same function
 * computes indicators for unit tests, backtests, paper and live.
 *
 * @param value - A price-scale indicator output (band, EMA, MACD component).
 * @returns The value rounded to a scale-appropriate precision.
 */
export function roundToPriceScale(value: number): number {
  if (!Number.isFinite(value)) return value;
  const abs = Math.abs(value);
  if (abs === 0) return 0;
  if (abs >= 1) return parseFloat(value.toFixed(2));
  // Sub-dollar: decimals = leading zeros after the point + 4 significant figures,
  // capped so the factor stays within safe-integer range.
  const decimals = Math.min(12, Math.ceil(-Math.log10(abs)) + 4);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Relative Strength Index from average gain / average loss, total on the
 * degenerate flat window.
 *
 * When a window has no losses the Wilder ratio `avgGain / avgLoss` is
 * `+Infinity` (→ RSI 100); on a perfectly flat window it is `0 / 0 = NaN`,
 * which the naive formula propagates straight into the output. A flat window
 * carries no momentum, so its RSI is the neutral 50 — never NaN. This mirrors
 * the engine's live RSI guards (a constant series scores neutral, an all-gains
 * series scores 100).
 *
 * @param avgGain - Average gain over the period (>= 0).
 * @param avgLoss - Average loss over the period (>= 0).
 * @returns RSI in [0, 100]; 50 for a flat window, 100 for an all-gains window.
 */
function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Number.isFinite(rsi) ? rsi : 50;
}

/**
 * Calculates Bollinger Bands for a given set of price data.
 * Bollinger Bands consist of a middle band (SMA) and two outer bands
 * that are standard deviations away from the middle band.
 *
 * @param priceData - An array of price data objects containing closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.period - The number of periods to use for the SMA (default is 20).
 * @param params.standardDeviations - The number of standard deviations for the outer bands (default is 2).
 * @returns An array of BollingerBandsData objects containing the calculated bands.
 */
export function calculateBollingerBands(
  priceData: MassivePriceData[],
  { period = 20, standardDeviations = 2 }: BollingerBandsParams = {},
): BollingerBandsData[] {
  if (priceData.length < period) {
    logIfDebug(
      `Insufficient data for Bollinger Bands calculation: required periods: ${period}, but only received ${priceData.length} periods of data`,
    );
    return [];
  }

  const result: BollingerBandsData[] = [];

  for (let i = period - 1; i < priceData.length; i++) {
    const periodSlice = priceData.slice(i - period + 1, i + 1);
    const prices = periodSlice.map((d) => d.close);

    // Calculate middle band (SMA)
    const sum = prices.reduce((acc, price) => acc + price, 0);
    const sma = sum / period;

    // Calculate standard deviation
    const squaredDifferences = prices.map((price) => Math.pow(price - sma, 2));
    const variance =
      squaredDifferences.reduce((acc, val) => acc + val, 0) / period;
    const standardDeviation = Math.sqrt(variance);

    // Calculate bands
    const upperBand = sma + standardDeviation * standardDeviations;
    const lowerBand = sma - standardDeviation * standardDeviations;

    result.push({
      date: priceData[i].date,
      middle: roundToPriceScale(sma),
      upper: roundToPriceScale(upperBand),
      lower: roundToPriceScale(lowerBand),
      close: priceData[i].close,
    });
  }

  return result;
}

import { EMAParams } from "./types";

/**
 * Calculates the Exponential Moving Average (EMA) for a given set of price data.
 * The EMA gives more weight to recent prices, making it more responsive to new information.
 *
 * @param priceData - An array of price data objects containing closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.period - The number of periods to use for the EMA (default is 20).
 * @param params.period2 - An optional second period for a second EMA (default is 9).
 * @returns An array of EMAData objects containing the calculated EMA values.
 */
export function calculateEMA(
  priceData: MassivePriceData[],
  { period = 20, period2 = 9 }: EMAParams = {},
): EMAData[] {
  if (priceData.length < period || (period2 && priceData.length < period2)) {
    logIfDebug(
      `Insufficient data for EMA calculation: required periods: ${period}, ${period2}, but only received ${priceData.length} periods of data`,
    );
    return [];
  }

  const result: EMAData[] = [];
  const multiplier = 2 / (period + 1);
  const multiplier2 = period2 ? 2 / (period2 + 1) : 0;

  // Calculate initial SMA for first period
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += priceData[i].close;
  }
  let prevEMA = sum / period;

  // Calculate initial SMA for second period if needed
  let prevEMA2;
  if (period2) {
    sum = 0;
    for (let i = 0; i < period2; i++) {
      sum += priceData[i].close;
    }
    prevEMA2 = sum / period2;
  }

  // Add first EMA(s)
  const firstEntry: EMAData = {
    date: priceData[Math.max(period, period2 || 0) - 1].date,
    ema: roundToPriceScale(prevEMA),
    close: priceData[Math.max(period, period2 || 0) - 1].close,
  };
  if (period2) {
    firstEntry.ema2 = roundToPriceScale(prevEMA2!);
  }
  result.push(firstEntry);

  // Calculate EMA for remaining periods
  for (let i = Math.max(period, period2 || 0); i < priceData.length; i++) {
    const currentClose = priceData[i].close;
    const currentEMA = (currentClose - prevEMA) * multiplier + prevEMA;
    prevEMA = currentEMA;

    const entry: EMAData = {
      date: priceData[i].date,
      ema: roundToPriceScale(currentEMA),
      close: currentClose,
    };

    if (period2) {
      const currentEMA2: number =
        (currentClose - prevEMA2!) * multiplier2 + prevEMA2!;
      prevEMA2 = currentEMA2;
      entry.ema2 = roundToPriceScale(currentEMA2);
    }

    result.push(entry);
  }

  return result;
}

import { FibonacciData, FibonacciLevel, FibonacciParams } from "./types";

/**
 * The swing extremes of a lookback window and the direction of its latest leg.
 */
interface SwingWindow {
  /** Highest high in the window. */
  swingHigh: number;
  /** Lowest low in the window. */
  swingLow: number;
  /** Direction of the most recent leg, or null when the window resolves none. */
  trend: "uptrend" | "downtrend" | null;
}

/**
 * Locates a window's swing extremes and derives the direction of its most
 * recent leg from the order in which those extremes print.
 *
 * A Fibonacci construction is anchored to the latest leg: an up-leg runs swing
 * low to swing high, a down-leg swing high to swing low. Whichever extreme
 * prints last therefore identifies the leg, which makes the direction a
 * measurement of the window rather than a caller's assumption. When both
 * extremes land on the same bar the window contains no leg and the direction
 * is genuinely indeterminate.
 *
 * @param window - The lookback slice to analyse.
 * @returns The window's swing extremes and derived leg direction.
 */
function analyzeSwingWindow(window: MassivePriceData[]): SwingWindow {
  let swingHigh = -Infinity;
  let swingLow = Infinity;
  let highIndex = -1;
  let lowIndex = -1;

  // `>=` / `<=` keep the most recent occurrence of each extreme, which is the
  // one the current leg is measured from.
  for (let i = 0; i < window.length; i++) {
    if (window[i].high >= swingHigh) {
      swingHigh = window[i].high;
      highIndex = i;
    }
    if (window[i].low <= swingLow) {
      swingLow = window[i].low;
      lowIndex = i;
    }
  }

  return {
    swingHigh,
    swingLow,
    trend: highIndex === lowIndex ? null : highIndex > lowIndex ? "uptrend" : "downtrend",
  };
}

/**
 * Calculates Fibonacci retracement and extension levels based on price data.
 * Fibonacci levels are used to identify potential support and resistance levels.
 *
 * @param priceData - An array of price data objects containing high and low prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.lookbackPeriod - The number of periods to look back for swing high/low (default is 20).
 * @param params.retracementLevels - An array of retracement levels to calculate (default is [0.236, 0.382, 0.5, 0.618, 0.786]).
 * @param params.extensionLevels - An array of extension levels to calculate (default is [1.272, 1.618, 2.618]).
 * @param params.reverseDirection - Forces the leg direction: `true` for a downtrend, `false` for an uptrend. Omit it to derive the direction per bar from the swing window.
 * @returns An array of FibonacciData objects containing the calculated levels.
 */
export function calculateFibonacciLevels(
  priceData: MassivePriceData[],
  {
    lookbackPeriod = 20,
    retracementLevels = [0.236, 0.382, 0.5, 0.618, 0.786],
    extensionLevels = [1.272, 1.618, 2.618],
    reverseDirection,
  }: FibonacciParams = {},
): FibonacciData[] {
  const result: FibonacciData[] = [];

  for (let i = 0; i < priceData.length; i++) {
    const periodSlice = priceData.slice(
      Math.max(0, i - lookbackPeriod + 1),
      i + 1,
    );
    const { swingHigh, swingLow, trend: derivedTrend } =
      analyzeSwingWindow(periodSlice);
    const priceRange = swingHigh - swingLow;

    // An explicit `reverseDirection` is the caller stating the leg it is
    // measuring; absent that, the leg is read off the window itself.
    const trend =
      reverseDirection === undefined
        ? derivedTrend
        : reverseDirection
          ? "downtrend"
          : "uptrend";
    const levels: FibonacciLevel[] = [];

    if (priceRange > 0 && trend !== null) {
      const isDowntrend = trend === "downtrend";

      // Calculate retracement levels
      retracementLevels.forEach((level) => {
        const price = isDowntrend
          ? swingLow + priceRange * level
          : swingHigh - priceRange * level;

        levels.push({
          level,
          price: roundToPriceScale(price),
          type: "retracement",
        });
      });

      // Calculate extension levels — each is projected beyond the leg's
      // terminal extreme: past the swing low for a down-leg, past the swing
      // high for an up-leg. Anchoring both to the same extreme would place one
      // side's targets a full swing range away from where the leg is running.
      extensionLevels.forEach((level) => {
        const price = isDowntrend
          ? swingLow - priceRange * (level - 1) // For downtrend
          : swingHigh + priceRange * (level - 1); // For uptrend

        levels.push({
          level,
          price: roundToPriceScale(price),
          type: "extension",
        });
      });

      // Sort levels by price
      levels.sort((a, b) =>
        isDowntrend ? b.price - a.price : a.price - b.price,
      );
    } else if (trend === null) {
      logIfDebug(
        `Swing high and low fall on the same bar on date ${priceData[i].date}; trend is indeterminate and no levels calculated.`,
      );
    } else {
      logIfDebug(
        `Price range is zero on date ${priceData[i].date}; no levels calculated.`,
      );
    }

    result.push({
      date: priceData[i].date,
      levels,
      swingHigh,
      swingLow,
      trend,
      close: priceData[i].close,
    });
  }

  return result;
}

import { EMAData, MACDData, MACDParams } from "./types";

/**
 * Calculates the Moving Average Convergence Divergence (MACD) for a given set of price data.
 * MACD is a trend-following momentum indicator that shows the relationship between two EMAs.
 *
 * @param priceData - An array of price data objects containing closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.shortPeriod - The short EMA period (default is 12).
 * @param params.longPeriod - The long EMA period (default is 26).
 * @param params.signalPeriod - The signal line period (default is 9).
 * @returns An array of MACDData objects containing the calculated MACD values.
 */
export function calculateMACD(
  priceData: MassivePriceData[],
  { shortPeriod = 12, longPeriod = 26, signalPeriod = 9 }: MACDParams = {},
): MACDData[] {
  if (priceData.length < longPeriod + signalPeriod) {
    logIfDebug(
      `Insufficient data for MACD calculation: required periods: ${longPeriod + signalPeriod}, but only received ${priceData.length} periods of data`,
    );
    return [];
  }

  const emaShort = calculateEMA(priceData, { period: shortPeriod });
  const emaLong = calculateEMA(priceData, { period: longPeriod });

  // Align EMAs by trimming the beginning of emaShort to match emaLong length
  if (emaShort.length < emaLong.length) {
    logIfDebug(
      "Short EMA length is less than Long EMA length for MACD calculation",
    );
    return [];
  }

  const emaShortAligned = emaShort.slice(emaShort.length - emaLong.length);
  const macdLine: number[] = emaShortAligned.map(
    (short: EMAData, i: number) => short.ema - emaLong[i].ema,
  );

  // Calculate Signal Line (EMA of MACD Line)
  const signalLine: number[] = [];
  const histogram: number[] = [];
  const result: MACDData[] = [];

  if (macdLine.length < signalPeriod) {
    logIfDebug(
      `Insufficient MACD data for Signal Line calculation: required periods: ${signalPeriod}, but only received ${macdLine.length} periods of data`,
    );
    return [];
  }

  const signalMultiplier = 2 / (signalPeriod + 1);
  let signalEMA =
    macdLine.slice(0, signalPeriod).reduce((sum, val) => sum + val, 0) /
    signalPeriod;
  signalLine.push(signalEMA);

  for (let i = signalPeriod; i < macdLine.length; i++) {
    const macdValue = macdLine[i];
    signalEMA = (macdValue - signalEMA) * signalMultiplier + signalEMA;
    signalLine.push(signalEMA);

    const hist = macdValue - signalEMA;
    histogram.push(hist);

    result.push({
      date: emaLong[i].date, // Use emaLong's date for alignment
      macd: roundToPriceScale(macdValue),
      signal: roundToPriceScale(signalEMA),
      histogram: roundToPriceScale(hist),
      close: emaLong[i].close,
    });
  }

  return result;
}

import { RSIData, RSIParams } from "./types";

/**
 * Calculates the Relative Strength Index (RSI) for a given set of price data.
 * RSI is a momentum oscillator that measures the speed and change of price movements.
 *
 * @param priceData - An array of price data objects containing closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.period - The number of periods to use for the RSI (default is 14).
 * @returns An array of RSIData objects containing the calculated RSI values.
 */
export function calculateRSI(
  priceData: MassivePriceData[],
  { period = 14 }: RSIParams = {},
): RSIData[] {
  if (priceData.length < period + 1) {
    logIfDebug(
      `Insufficient data for RSI calculation: required periods: ${period + 1}, but only received ${priceData.length} periods of data`,
    );
    return [];
  }

  const result: RSIData[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Calculate first average gain and loss
  for (let i = 1; i <= period; i++) {
    const change = priceData[i].close - priceData[i - 1].close;
    if (change >= 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }

  avgGain = avgGain / period;
  avgLoss = avgLoss / period;

  // Calculate RSI for the first period (total on a flat window — see
  // rsiFromAverages: a constant series scores the neutral 50, never NaN).
  let rsi = rsiFromAverages(avgGain, avgLoss);

  result.push({
    date: priceData[period].date,
    rsi: parseFloat(rsi.toFixed(2)),
    close: priceData[period].close,
  });

  // Calculate subsequent periods using smoothed averages
  for (let i = period + 1; i < priceData.length; i++) {
    const change = priceData[i].close - priceData[i - 1].close;
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    // Use smoothed averages
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi = rsiFromAverages(avgGain, avgLoss);

    result.push({
      date: priceData[i].date,
      rsi: parseFloat(rsi.toFixed(2)),
      close: priceData[i].close,
    });
  }

  return result;
}

import { StochData, StochasticParams } from "./types";

/**
 * Calculates the Stochastic Oscillator for a given set of price data.
 * The Stochastic Oscillator compares a particular closing price of a security to a range of its prices over a certain period of time.
 *
 * @param priceData - An array of price data objects containing high, low, and closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.lookbackPeriod - The number of periods to look back for the calculation of %K (default is 5).
 * @param params.signalPeriod - The number of periods for the %D signal line (default is 3).
 * @param params.smoothingFactor - The smoothing factor for %K (default is 3).
 * @returns An array of StochData objects containing the calculated %K and %D values.
 */
export function calculateStochasticOscillator(
  priceData: MassivePriceData[],
  {
    lookbackPeriod = 5,
    signalPeriod = 3,
    smoothingFactor = 3,
  }: StochasticParams = {},
): StochData[] {
  // Each period is a divisor (`kSum / min(len, smoothingFactor)`) and a slice
  // width. A zero or fractional period therefore divides by zero or slices an
  // empty window, producing NaN/Infinity %K and %D — an oscillator reading that
  // is never true and never false. The periods are caller-supplied constants
  // rather than market data, so an invalid one is a programming error and is
  // reported as such, matching the ATR and volatility primitives.
  if (
    !Number.isInteger(lookbackPeriod) ||
    lookbackPeriod < 1 ||
    !Number.isInteger(signalPeriod) ||
    signalPeriod < 1 ||
    !Number.isInteger(smoothingFactor) ||
    smoothingFactor < 1
  ) {
    throw new Error(
      "calculateStochasticOscillator: lookbackPeriod, signalPeriod and smoothingFactor must be positive integers",
    );
  }

  if (priceData.length < lookbackPeriod) {
    logIfDebug(
      `Insufficient data for Stochastic Oscillator calculation: required periods: ${lookbackPeriod}, but only received ${priceData.length} periods of data`,
    );
    return [];
  }

  const kValues: number[] = [];
  const smoothedKValues: number[] = [];
  const result: StochData[] = [];
  let kSum = 0;
  let dSum = 0;

  for (let i = lookbackPeriod - 1; i < priceData.length; i++) {
    const periodSlice = priceData.slice(i - lookbackPeriod + 1, i + 1);
    const currentClose = periodSlice[periodSlice.length - 1].close;

    const highPrices = periodSlice.map((d) => d.high);
    const lowPrices = periodSlice.map((d) => d.low);
    const highestHigh = Math.max(...highPrices);
    const lowestLow = Math.min(...lowPrices);

    const k =
      highestHigh === lowestLow
        ? 0
        : ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    kValues.push(k);
    kSum += k;

    if (kValues.length > smoothingFactor)
      kSum -= kValues[kValues.length - smoothingFactor - 1];
    const smoothedK = kSum / Math.min(kValues.length, smoothingFactor);
    smoothedKValues.push(smoothedK);

    dSum += smoothedK;
    if (smoothedKValues.length > signalPeriod)
      dSum -= smoothedKValues[smoothedKValues.length - signalPeriod - 1];
    const smoothedD = dSum / Math.min(smoothedKValues.length, signalPeriod);

    if (kValues.length >= smoothingFactor + signalPeriod - 1) {
      result.push({
        date: priceData[i].date,
        slowK: parseFloat(smoothedK.toFixed(2)),
        slowD: parseFloat(smoothedD.toFixed(2)),
        close: currentClose,
      });
    }
  }

  return result;
}

import {
  SupportResistanceData,
  SupportResistanceLevel,
  SupportResistanceParams,
} from "./types";

/**
 * A price level candidate accumulated by the pivot scan, before nearby
 * candidates are collapsed into a single reported level.
 */
interface PivotPoint {
  /** The pivot's price. */
  price: number;
  /** How many pivots have merged into this candidate. */
  count: number;
  /** Total volume transacted across the merged pivots. */
  volume: number;
}

/**
 * Collapses a cluster of nearby pivots into one volume-weighted level, or
 * reports that the cluster evidences no level at all.
 *
 * Both outputs are volume-weighted: the price is the volume-weighted mean of
 * the cluster's pivots, and the strength is the pivot count weighted by each
 * pivot's share of cluster volume. That weighting is undefined when the cluster
 * transacted no volume — `0 / 0` makes both NaN. A NaN level is strictly worse
 * than no level: every comparison against NaN is false, so a stop or target
 * placed off one is silently never triggered, leaving the position unprotected
 * while appearing protected.
 *
 * Zero cluster volume is a real market state rather than corrupt input — halted,
 * pre-market-thin and synthetic warm-up bars all report it. A support or
 * resistance level means price transacted enough there to turn the market, so a
 * cluster with no volume has not evidenced one. `SupportResistanceLevel` types
 * both fields as non-optional numbers, which leaves omitting the level as the
 * only honest way to say so.
 *
 * @param cluster - The nearby pivots to collapse into a single level.
 * @param currentPrice - The bar's close, which classifies the level's side.
 * @returns The aggregated level, or null when the cluster evidences none.
 */
function aggregatePivotCluster(
  cluster: readonly PivotPoint[],
  currentPrice: number,
): SupportResistanceLevel | null {
  const totalVolume = cluster.reduce((sum, p) => sum + p.volume, 0);
  // Negated `> 0` so NaN and negative totals are rejected alongside zero: no
  // volume weighting survives any of them.
  if (!(totalVolume > 0)) return null;

  const avgPrice =
    cluster.reduce((sum, p) => sum + p.price * p.volume, 0) / totalVolume;
  const strength = cluster.reduce(
    (sum, p) => sum + p.count * (p.volume / totalVolume),
    0,
  );
  if (!Number.isFinite(avgPrice) || !Number.isFinite(strength)) return null;

  return {
    // The level is a price, so its precision follows the price's magnitude
    // (F7.2). Strength is a count-weighted score rather than a price and keeps
    // the conventional 2dp.
    price: roundToPriceScale(avgPrice),
    strength: parseFloat(strength.toFixed(2)),
    type: avgPrice > currentPrice ? "resistance" : "support",
  };
}

/**
 * Calculates support and resistance levels based on price data.
 * Support and resistance levels are price levels at which a stock tends to stop and reverse.
 *
 * @param priceData - An array of price data objects containing high, low, and closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.maxLevels - The maximum number of support/resistance levels to return (default is 5).
 * @param params.lookbackPeriod - The number of periods to look back for pivot points (default is 10).
 * @returns An array of SupportResistanceData objects containing the calculated levels.
 */
export function calculateSupportAndResistance(
  priceData: MassivePriceData[],
  { maxLevels = 5, lookbackPeriod = 10 }: SupportResistanceParams = {},
): SupportResistanceData[] {
  const result: SupportResistanceData[] = [];

  for (let i = 0; i < priceData.length; i++) {
    const startIdx = Math.max(0, i - lookbackPeriod);
    const analysisWindow = priceData.slice(startIdx, i + 1);

    const pivotPoints: PivotPoint[] = [];

    // **Compute Volatility Metrics**
    const priceChanges = analysisWindow
      .slice(1)
      .map((bar, idx) => Math.abs(bar.close - analysisWindow[idx].close));
    // A single-bar window produces no price changes to average, and a
    // non-positive reference close cannot scale one — `0 / 0` and `x / 0` make
    // the relative volatility NaN or Infinity. Volatility is the sole input to
    // both the pivot sensitivity and the level-grouping gap below, so a
    // non-finite value silently disables every comparison that depends on it
    // (each is false against NaN). Unmeasurable volatility resolves to zero,
    // under which each pivot stands as its own level instead of being merged on
    // a meaningless ratio.
    const referenceClose = analysisWindow[0].close;
    const avgPriceChange =
      priceChanges.length > 0
        ? priceChanges.reduce((sum, change) => sum + change, 0) /
          priceChanges.length
        : 0;
    const volatility =
      referenceClose > 0 && Number.isFinite(avgPriceChange)
        ? avgPriceChange / referenceClose
        : 0; // Relative volatility

    // **Adjust Sensitivity and minGapBetweenLevels Dynamically**
    const sensitivity = volatility * 2; // Adjust the multiplier as needed
    const minGapBetweenLevels = volatility * 100; // Convert to percentage

    // Analyze each point in window for pivot status
    for (let j = 1; j < analysisWindow.length - 1; j++) {
      const curr = analysisWindow[j];
      const prevBar = analysisWindow[j - 1];
      const nextBar = analysisWindow[j + 1];

      // A pivot is matched against existing candidates by a *relative* gap
      // measured against its own price, so a non-positive reference price makes
      // that ratio meaningless: zero divides to NaN or Infinity (which never
      // compares below the sensitivity, so the pivot never merges), and a
      // negative price inverts the comparison (so everything merges). A bar
      // without a positive high or low carries no tradeable level either way.

      // Check for high pivot
      if (
        curr.high > 0 &&
        curr.high > prevBar.high &&
        curr.high > nextBar.high
      ) {
        const existingPivot = pivotPoints.find(
          (p) => Math.abs(p.price - curr.high) / curr.high < sensitivity,
        );
        if (existingPivot) {
          existingPivot.count++;
          existingPivot.volume += curr.vol; // **Include Volume**
        } else {
          pivotPoints.push({ price: curr.high, count: 1, volume: curr.vol });
        }
      }

      // Check for low pivot
      if (curr.low > 0 && curr.low < prevBar.low && curr.low < nextBar.low) {
        const existingPivot = pivotPoints.find(
          (p) => Math.abs(p.price - curr.low) / curr.low < sensitivity,
        );
        if (existingPivot) {
          existingPivot.count++;
          existingPivot.volume += curr.vol; // **Include Volume**
        } else {
          pivotPoints.push({ price: curr.low, count: 1, volume: curr.vol });
        }
      }
    }

    // Group nearby levels
    const currentPrice = priceData[i].close;
    const levels: SupportResistanceLevel[] = [];

    // Sort pivots by price
    pivotPoints.sort((a, b) => a.price - b.price);

    // Group close pivots
    let currentGroup: PivotPoint[] = [];
    for (let j = 0; j < pivotPoints.length; j++) {
      if (currentGroup.length === 0) {
        currentGroup.push(pivotPoints[j]);
      } else {
        const lastPrice = currentGroup[currentGroup.length - 1].price;
        if (
          (Math.abs(pivotPoints[j].price - lastPrice) / lastPrice) * 100 <=
          minGapBetweenLevels
        ) {
          currentGroup.push(pivotPoints[j]);
        } else {
          // Process current group
          const level = aggregatePivotCluster(currentGroup, currentPrice);
          if (level) levels.push(level);
          currentGroup = [pivotPoints[j]];
        }
      }
    }

    // Process final group
    const finalGroupLevel = aggregatePivotCluster(currentGroup, currentPrice);
    if (finalGroupLevel) levels.push(finalGroupLevel);

    // Sort by strength and limit
    const finalLevels = levels
      .sort((a, b) => b.strength - a.strength)
      .slice(0, maxLevels);

    result.push({
      date: priceData[i].date,
      levels: finalLevels,
      close: currentPrice,
    });
  }

  logIfDebug(
    `Found ${result.reduce((sum, r) => sum + r.levels.length, 0)} support/resistance levels across ${
      result.length
    } periods`,
  );
  return result;
}
