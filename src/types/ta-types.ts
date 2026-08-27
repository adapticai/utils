export interface BollingerBandsParams {
  period?: number;
  standardDeviations?: number;
}

export interface BollingerBandsData {
  date: string;
  middle: number;
  upper: number;
  lower: number;
  close: number;
}

export interface EMAParams {
  period?: number;
  period2?: number;
}

export interface EMAData {
  date: string;
  ema: number;
  ema2?: number;
  close: number;
}

export interface MACDParams {
  shortPeriod?: number;
  longPeriod?: number;
  signalPeriod?: number;
}

export interface MACDData {
  date: string;
  macd: number;
  signal: number;
  histogram: number;
  close: number;
}

export interface FibonacciParams {
  lookbackPeriod?: number;
  retracementLevels?: number[];
  extensionLevels?: number[];
  /**
   * Forces the leg direction: true for a downtrend, false for an uptrend.
   * Omit it to derive the direction per bar from the swing window.
   */
  reverseDirection?: boolean;
}

export interface FibonacciLevel {
  level: number;
  price: number;
  type: "retracement" | "extension";
}

export interface FibonacciData {
  date: string;
  levels?: FibonacciLevel[];
  swingHigh?: number;
  swingLow?: number;
  /**
   * Direction of the swing leg the levels are anchored to. `null` when the
   * window resolves no leg, in which case `levels` is empty — a label that was
   * never measured is not reported as one.
   */
  trend?: "uptrend" | "downtrend" | null;
  close: number;
}

export interface RSIParams {
  period?: number;
}

export interface RSIData {
  date: string;
  rsi: number;
  close: number;
}
export interface StochasticParams {
  lookbackPeriod?: number;
  signalPeriod?: number;
  smoothingFactor?: number;
}

export interface StochData {
  date: string;
  slowK: number;
  slowD: number;
  close: number;
}

export interface SupportResistanceParams {
  windowSize?: number;
  sensitivity?: number;
  minGapBetweenLevels?: number;
  maxLevels?: number;
  lookbackPeriod?: number; // Period to analyze for support/resistance
}

export interface SupportResistanceLevel {
  price: number;
  strength: number;
  type: "support" | "resistance";
}

export interface SupportResistanceData {
  date: string;
  levels: SupportResistanceLevel[];
  close: number;
}
