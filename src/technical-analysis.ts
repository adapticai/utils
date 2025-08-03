import { PolygonPriceData } from './types';
import { BollingerBandsData, BollingerBandsParams } from './types';
import { logIfDebug } from './misc-utils';

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
  priceData: PolygonPriceData[],
  { period = 20, standardDeviations = 2 }: BollingerBandsParams = {}
): BollingerBandsData[] {
  if (priceData.length < period) {
    logIfDebug(`Insufficient data for Bollinger Bands calculation: required periods: ${period}, but only received ${priceData.length} periods of data`);
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
    const variance = squaredDifferences.reduce((acc, val) => acc + val, 0) / period;
    const standardDeviation = Math.sqrt(variance);

    // Calculate bands
    const upperBand = sma + standardDeviation * standardDeviations;
    const lowerBand = sma - standardDeviation * standardDeviations;

    result.push({
      date: priceData[i].date,
      middle: parseFloat(sma.toFixed(2)),
      upper: parseFloat(upperBand.toFixed(2)),
      lower: parseFloat(lowerBand.toFixed(2)),
      close: priceData[i].close,
    });
  }

  // logIfDebug(`Calculated Bollinger Bands for ${result.length} periods`);
  return result;
}

import { EMAParams } from './types';

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
export function calculateEMA(priceData: PolygonPriceData[], { period = 20, period2 = 9 }: EMAParams = {}): EMAData[] {
  if (priceData.length < period || (period2 && priceData.length < period2)) {
    logIfDebug(`Insufficient data for EMA calculation: required periods: ${period}, ${period2}, but only received ${priceData.length} periods of data`);
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
    ema: parseFloat(prevEMA.toFixed(2)),
    close: priceData[Math.max(period, period2 || 0) - 1].close,
  };
  if (period2) {
    firstEntry.ema2 = parseFloat(prevEMA2!.toFixed(2));
  }
  result.push(firstEntry);

  // Calculate EMA for remaining periods
  for (let i = Math.max(period, period2 || 0); i < priceData.length; i++) {
    const currentClose = priceData[i].close;
    const currentEMA = (currentClose - prevEMA) * multiplier + prevEMA;
    prevEMA = currentEMA;

    const entry: EMAData = {
      date: priceData[i].date,
      ema: parseFloat(currentEMA.toFixed(2)),
      close: currentClose,
    };

    if (period2) {
      const currentEMA2: number = (currentClose - prevEMA2!) * multiplier2 + prevEMA2!;
      prevEMA2 = currentEMA2;
      entry.ema2 = parseFloat(currentEMA2.toFixed(2));
    }

    result.push(entry);
  }

  // logIfDebug(`Calculated EMA for ${result.length} periods`);
  return result;
}

import { FibonacciData, FibonacciParams, FibonacciLevel } from './types';

/**
 * Calculates Fibonacci retracement and extension levels based on price data.
 * Fibonacci levels are used to identify potential support and resistance levels.
 * 
 * @param priceData - An array of price data objects containing high and low prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.lookbackPeriod - The number of periods to look back for swing high/low (default is 20).
 * @param params.retracementLevels - An array of retracement levels to calculate (default is [0.236, 0.382, 0.5, 0.618, 0.786]).
 * @param params.extensionLevels - An array of extension levels to calculate (default is [1.272, 1.618, 2.618]).
 * @param params.reverseDirection - A boolean indicating if the trend is reversed (default is false).
 * @returns An array of FibonacciData objects containing the calculated levels.
 */
export function calculateFibonacciLevels(
  priceData: PolygonPriceData[],
  {
    lookbackPeriod = 20,
    retracementLevels = [0.236, 0.382, 0.5, 0.618, 0.786],
    extensionLevels = [1.272, 1.618, 2.618],
    reverseDirection = false,
  }: FibonacciParams = {}
): FibonacciData[] {
  const result: FibonacciData[] = [];

  for (let i = 0; i < priceData.length; i++) {
    const periodSlice = priceData.slice(Math.max(0, i - lookbackPeriod + 1), i + 1);
    const swingHigh = Math.max(...periodSlice.map((d) => d.high));
    const swingLow = Math.min(...periodSlice.map((d) => d.low));
    const priceRange = swingHigh - swingLow;

    const trend = reverseDirection ? 'downtrend' : 'uptrend';
    let levels: FibonacciLevel[] = [];

    if (priceRange > 0) {
      // Calculate retracement levels
      retracementLevels.forEach((level) => {
        const price = reverseDirection ? swingLow + priceRange * level : swingHigh - priceRange * level;

        levels.push({
          level,
          price: parseFloat(price.toFixed(2)),
          type: 'retracement',
        });
      });

      // Calculate extension levels
      extensionLevels.forEach((level) => {
        const price = reverseDirection
          ? swingHigh - priceRange * (level - 1) // For downtrend
          : swingHigh + priceRange * (level - 1); // For uptrend

        levels.push({
          level,
          price: parseFloat(price.toFixed(2)),
          type: 'extension',
        });
      });

      // Sort levels by price
      levels.sort((a, b) => (reverseDirection ? b.price - a.price : a.price - b.price));
    } else {
      logIfDebug(`Price range is zero on date ${priceData[i].date}; no levels calculated.`);
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

  // logIfDebug(`Calculated Fibonacci levels for ${result.length} periods`);
  return result;
}

import { MACDData, MACDParams, EMAData } from './types';

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
  priceData: PolygonPriceData[],
  { shortPeriod = 12, longPeriod = 26, signalPeriod = 9 }: MACDParams = {}
): MACDData[] {
  if (priceData.length < longPeriod + signalPeriod) {
    logIfDebug(`Insufficient data for MACD calculation: required periods: ${longPeriod + signalPeriod}, but only received ${priceData.length} periods of data`);
    return [];
  }

  const emaShort = calculateEMA(priceData, { period: shortPeriod });
  const emaLong = calculateEMA(priceData, { period: longPeriod });

  // Align EMAs by trimming the beginning of emaShort to match emaLong length
  if (emaShort.length < emaLong.length) {
    logIfDebug('Short EMA length is less than Long EMA length for MACD calculation');
    return [];
  }

  const emaShortAligned = emaShort.slice(emaShort.length - emaLong.length);
  const macdLine: number[] = emaShortAligned.map((short: EMAData, i: number) => short.ema - emaLong[i].ema);

  // Calculate Signal Line (EMA of MACD Line)
  const signalLine: number[] = [];
  const histogram: number[] = [];
  const result: MACDData[] = [];

  if (macdLine.length < signalPeriod) {
    logIfDebug(`Insufficient MACD data for Signal Line calculation: required periods: ${signalPeriod}, but only received ${macdLine.length} periods of data`);
    return [];
  }

  const signalMultiplier = 2 / (signalPeriod + 1);
  let signalEMA = macdLine.slice(0, signalPeriod).reduce((sum, val) => sum + val, 0) / signalPeriod;
  signalLine.push(signalEMA);

  for (let i = signalPeriod; i < macdLine.length; i++) {
    const macdValue = macdLine[i];
    signalEMA = (macdValue - signalEMA) * signalMultiplier + signalEMA;
    signalLine.push(signalEMA);

    const hist = macdValue - signalEMA;
    histogram.push(hist);

    result.push({
      date: emaLong[i].date, // Use emaLong's date for alignment
      macd: parseFloat(macdValue.toFixed(2)),
      signal: parseFloat(signalEMA.toFixed(2)),
      histogram: parseFloat(hist.toFixed(2)),
      close: emaLong[i].close,
    });
  }

  // logIfDebug(`Calculated MACD for ${result.length} periods`);
  return result;
}

import { RSIData, RSIParams } from './types';

/**
 * Calculates the Relative Strength Index (RSI) for a given set of price data.
 * RSI is a momentum oscillator that measures the speed and change of price movements.
 * 
 * @param priceData - An array of price data objects containing closing prices.
 * @param params - An object containing optional parameters for the calculation.
 * @param params.period - The number of periods to use for the RSI (default is 14).
 * @returns An array of RSIData objects containing the calculated RSI values.
 */
export function calculateRSI(priceData: PolygonPriceData[], { period = 14 }: RSIParams = {}): RSIData[] {
  if (priceData.length < period + 1) {
    logIfDebug(`Insufficient data for RSI calculation: required periods: ${period + 1}, but only received ${priceData.length} periods of data`);
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

  // Calculate RSI for the first period
  let rs = avgGain / avgLoss;
  let rsi = 100 - 100 / (1 + rs);

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

    rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);

    result.push({
      date: priceData[i].date,
      rsi: parseFloat(rsi.toFixed(2)),
      close: priceData[i].close,
    });
  }

  // logIfDebug(`Calculated RSI for ${result.length} periods`);
  return result;
}

import { StochData, StochasticParams } from './types';

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
  priceData: PolygonPriceData[],
  { lookbackPeriod = 5, signalPeriod = 3, smoothingFactor = 3 }: StochasticParams = {}
): StochData[] {
  if (priceData.length < lookbackPeriod) {
    logIfDebug(`Insufficient data for Stochastic Oscillator calculation: required periods: ${lookbackPeriod}, but only received ${priceData.length} periods of data`);
    return [];
  }

  const kValues: number[] = [];
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

    const k = highestHigh === lowestLow ? 0 : ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    kValues.push(k);
    kSum += k;

    if (kValues.length > smoothingFactor) kSum -= kValues[kValues.length - smoothingFactor - 1];
    const smoothedK = kSum / Math.min(kValues.length, smoothingFactor);

    dSum += smoothedK;
    if (kValues.length > smoothingFactor + signalPeriod - 1)
      dSum -= kValues[kValues.length - smoothingFactor - signalPeriod];
    const smoothedD = dSum / Math.min(kValues.length - smoothingFactor + 1, signalPeriod);

    if (kValues.length >= smoothingFactor + signalPeriod - 1) {
      result.push({
        date: priceData[i].date,
        slowK: parseFloat(smoothedK.toFixed(2)),
        slowD: parseFloat(smoothedD.toFixed(2)),
        close: currentClose,
      });
    }
  }

  // logIfDebug(`Calculated Stochastic Oscillator for ${result.length} periods`);
  return result;
}

import { SupportResistanceData, SupportResistanceParams, SupportResistanceLevel } from './types';

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
  priceData: PolygonPriceData[],
  { maxLevels = 5, lookbackPeriod = 10 }: SupportResistanceParams = {}
): SupportResistanceData[] {
  const result: SupportResistanceData[] = [];

  for (let i = 0; i < priceData.length; i++) {
    const startIdx = Math.max(0, i - lookbackPeriod);
    const analysisWindow = priceData.slice(startIdx, i + 1);

    const pivotPoints: { price: number; count: number; volume: number }[] = [];

    // **Compute Volatility Metrics**
    const priceChanges = analysisWindow.slice(1).map((bar, idx) => Math.abs(bar.close - analysisWindow[idx].close));
    const avgPriceChange = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
    const volatility = avgPriceChange / analysisWindow[0].close; // Relative volatility

    // **Adjust Sensitivity and minGapBetweenLevels Dynamically**
    const sensitivity = volatility * 2; // Adjust the multiplier as needed
    const minGapBetweenLevels = volatility * 100; // Convert to percentage

    // Analyze each point in window for pivot status
    for (let j = 1; j < analysisWindow.length - 1; j++) {
      const curr = analysisWindow[j];
      const prevBar = analysisWindow[j - 1];
      const nextBar = analysisWindow[j + 1];

      // Check for high pivot
      if (curr.high > prevBar.high && curr.high > nextBar.high) {
        const existingPivot = pivotPoints.find((p) => Math.abs(p.price - curr.high) / curr.high < sensitivity);
        if (existingPivot) {
          existingPivot.count++;
          existingPivot.volume += curr.vol; // **Include Volume**
        } else {
          pivotPoints.push({ price: curr.high, count: 1, volume: curr.vol });
        }
      }

      // Check for low pivot
      if (curr.low < prevBar.low && curr.low < nextBar.low) {
        const existingPivot = pivotPoints.find((p) => Math.abs(p.price - curr.low) / curr.low < sensitivity);
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
    let currentGroup: { price: number; count: number; volume: number }[] = [];
    for (let j = 0; j < pivotPoints.length; j++) {
      if (currentGroup.length === 0) {
        currentGroup.push(pivotPoints[j]);
      } else {
        const lastPrice = currentGroup[currentGroup.length - 1].price;
        if ((Math.abs(pivotPoints[j].price - lastPrice) / lastPrice) * 100 <= minGapBetweenLevels) {
          currentGroup.push(pivotPoints[j]);
        } else {
          // Process current group
          if (currentGroup.length > 0) {
            const totalVolume = currentGroup.reduce((sum, p) => sum + p.volume, 0);
            const avgPrice = currentGroup.reduce((sum, p) => sum + p.price * p.volume, 0) / totalVolume;
            const totalStrength = currentGroup.reduce((sum, p) => sum + p.count * (p.volume / totalVolume), 0);

            levels.push({
              price: parseFloat(avgPrice.toFixed(2)),
              strength: parseFloat(totalStrength.toFixed(2)),
              type: avgPrice > currentPrice ? 'resistance' : 'support',
            });
          }
          currentGroup = [pivotPoints[j]];
        }
      }
    }

    // Process final group
    if (currentGroup.length > 0) {
      const totalVolume = currentGroup.reduce((sum, p) => sum + p.volume, 0);
      const avgPrice = currentGroup.reduce((sum, p) => sum + p.price * p.volume, 0) / totalVolume;
      const totalStrength = currentGroup.reduce((sum, p) => sum + p.count * (p.volume / totalVolume), 0);

      levels.push({
        price: parseFloat(avgPrice.toFixed(2)),
        strength: parseFloat(totalStrength.toFixed(2)),
        type: avgPrice > currentPrice ? 'resistance' : 'support',
      });
    }

    // Sort by strength and limit
    const finalLevels = levels.sort((a, b) => b.strength - a.strength).slice(0, maxLevels);

    result.push({
      date: priceData[i].date,
      levels: finalLevels,
      close: currentPrice,
    });
  }

  logIfDebug(
    `Found ${result.reduce((sum, r) => sum + r.levels.length, 0)} support/resistance levels across ${
      result.length
    } periods`
  );
  return result;
}
