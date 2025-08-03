export type Period = "1D" | "3D" | "1W" | "2W" | "1M" | "3M" | "6M" | "1Y" | "YTD";

export type Timeframe = "1Min" | "5Min" | "15Min" | "1H" | "1D";

export type IntradayReporting = 'market_hours' | 'extended_hours' | 'continuous';

export interface PeriodDates {
  start: string | number;
  end: string | number;
}

export interface MarketTimeParams {
  period?: Period;
  start?: Date;
  end?: Date;
  referenceDate?: Date;
  timezone?: string;
  intraday_reporting?: IntradayReporting;
  outputFormat?: OutputFormat;
}

export type OutputFormat = 'iso' | 'unix-seconds' | 'unix-ms';

export interface MarketOpenCloseResult {
  marketOpen: boolean;
  open: Date | null;
  close: Date | null;
  openExt: Date | null;
  closeExt: Date | null;
}

export type MarketStatusName = 'closed' | 'extended hours' | 'open' | 'unknown';
export type MarketPeriodName = 'preMarket' | 'earlyMarket' | 'regularMarket' | 'afterMarket' | 'closed' | 'unknown';

export interface MarketStatus {
  time: Date;
  timeString: string;
  status: MarketStatusName;
  nextStatus: MarketStatusName;
  marketPeriod: MarketPeriodName;
  nextStatusTime: Date;
  nextStatusTimeDifference: number;
  nextStatusTimeString: string;
}

interface HM {
  START: {
    HOUR: number;
    MINUTE: number;
    MINUTES: number; // minutes from midnight
  };
  END: {
    HOUR: number;
    MINUTE: number;
    MINUTES: number; // minutes from midnight
  };
}

export interface MarketTimesConfig {
  TIMEZONE: string;
  PRE: HM;
  EARLY_MORNING: HM;
  EARLY_CLOSE_BEFORE_HOLIDAY: HM;
  EARLY_EXTENDED_BEFORE_HOLIDAY: HM;
  REGULAR: HM;
  EXTENDED: HM;
}