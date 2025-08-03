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
  reverseDirection?: boolean; // true for downtrend, false for uptrend
}

export interface FibonacciLevel {
  level: number;
  price: number;
  type: 'retracement' | 'extension';
}

export interface FibonacciData {
  date: string;
  levels?: FibonacciLevel[];
  swingHigh?: number;
  swingLow?: number;
  trend?: 'uptrend' | 'downtrend';
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
  type: 'support' | 'resistance';
}

export interface SupportResistanceData {
  date: string;
  levels: SupportResistanceLevel[];
  close: number;
}