import { PolygonPriceData } from './types';
import { BollingerBandsData, BollingerBandsParams } from './types';
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
export declare function calculateBollingerBands(priceData: PolygonPriceData[], { period, standardDeviations }?: BollingerBandsParams): BollingerBandsData[];
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
export declare function calculateEMA(priceData: PolygonPriceData[], { period, period2 }?: EMAParams): EMAData[];
import { FibonacciData, FibonacciParams } from './types';
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
export declare function calculateFibonacciLevels(priceData: PolygonPriceData[], { lookbackPeriod, retracementLevels, extensionLevels, reverseDirection, }?: FibonacciParams): FibonacciData[];
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
export declare function calculateMACD(priceData: PolygonPriceData[], { shortPeriod, longPeriod, signalPeriod }?: MACDParams): MACDData[];
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
export declare function calculateRSI(priceData: PolygonPriceData[], { period }?: RSIParams): RSIData[];
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
export declare function calculateStochasticOscillator(priceData: PolygonPriceData[], { lookbackPeriod, signalPeriod, smoothingFactor }?: StochasticParams): StochData[];
import { SupportResistanceData, SupportResistanceParams } from './types';
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
export declare function calculateSupportAndResistance(priceData: PolygonPriceData[], { maxLevels, lookbackPeriod }?: SupportResistanceParams): SupportResistanceData[];
//# sourceMappingURL=technical-analysis.d.ts.map