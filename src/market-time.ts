// market-time.ts
import { getLogger } from './logger';

import { set, isBefore, sub, add, startOfDay, endOfDay, format, differenceInMilliseconds } from 'date-fns';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import {
  Period,
  IntradayReporting,
  PeriodDates,
  MarketTimeParams,
  OutputFormat,
  MarketOpenCloseResult,
  MarketStatus,
  MarketTimesConfig,
} from './types/market-time-types';
import { marketHolidays, marketEarlyCloses } from './market-hours.js';

/**
 * Market times for NYSE
 * Regular market hours are 9:30am-4:00pm
 * Early market hours are 9:30am-10:00am (first 30 minutes)
 * Extended market hours are 4:00am to 9:30am and 4:00pm-8:00pm
 * On days before some holidays, the market closes early at 1:00pm
 * Early extended market hours are 1:00pm-5:00pm on early close days
 */
export const MARKET_TIMES: MarketTimesConfig = {
  TIMEZONE: 'America/New_York',
  PRE: { START: { HOUR: 4, MINUTE: 0, MINUTES: 240 }, END: { HOUR: 9, MINUTE: 30, MINUTES: 570 } },
  EARLY_MORNING: { START: { HOUR: 9, MINUTE: 30, MINUTES: 570 }, END: { HOUR: 10, MINUTE: 0, MINUTES: 600 } }, // early market trading
  EARLY_CLOSE_BEFORE_HOLIDAY: { START: { HOUR: 9, MINUTE: 30, MINUTES: 570 }, END: { HOUR: 13, MINUTE: 0, MINUTES: 780 } }, // early market trading end
  EARLY_EXTENDED_BEFORE_HOLIDAY: { START: { HOUR: 13, MINUTE: 0, MINUTES: 780 }, END: { HOUR: 17, MINUTE: 0, MINUTES: 1020 } }, // extended hours trading on early close days
  REGULAR: { START: { HOUR: 9, MINUTE: 30, MINUTES: 570 }, END: { HOUR: 16, MINUTE: 0, MINUTES: 960 } },
  EXTENDED: { START: { HOUR: 4, MINUTE: 0, MINUTES: 240 }, END: { HOUR: 20, MINUTE: 0, MINUTES: 1200 } },
};

/**
 * Utility class for handling market time-related operations
 */
export class MarketTimeUtil {
  private timezone: string;
  private intradayReporting: IntradayReporting;

  /**
   * Creates a new MarketTimeUtil instance
   * @param {string} [timezone='America/New_York'] - The timezone to use for market time calculations
   * @param {IntradayReporting} [intradayReporting='market_hours'] - The intraday reporting mode
   */
  constructor(timezone: string = MARKET_TIMES.TIMEZONE, intradayReporting: IntradayReporting = 'market_hours') {
    this.validateTimezone(timezone);
    this.timezone = timezone;
    this.intradayReporting = intradayReporting;
  }

  /**
   * Validates the provided timezone
   * @private
   * @param {string} timezone - The timezone to validate
   * @throws {Error} If the timezone is invalid
   */
  private validateTimezone(timezone: string): void {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch (error) {
      throw new Error(`Invalid timezone: ${timezone}`);
    }
  }

  private formatDate(date: Date, outputFormat: OutputFormat = 'iso'): string | number {
    switch (outputFormat) {
      case 'unix-seconds':
        return Math.floor(date.getTime() / 1000);
      case 'unix-ms':
        return date.getTime();
      case 'iso':
      default:
        // return with timezone offset
        return formatInTimeZone(date, this.timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")
    }
  }

  /**
   * Checks if a NY-zoned date falls on a weekend.
   * Expects a date already converted to market timezone via toZonedTime.
   * @param nyDate - Date in market timezone representation
   * @returns true if the date is Saturday or Sunday
   */
  private isWeekendZoned(nyDate: Date): boolean {
    const day = nyDate.getDay();
    return day === 0 || day === 6;
  }

  /**
   * Checks if a NY-zoned date falls on a market holiday.
   * Expects a date already converted to market timezone via toZonedTime.
   * @param nyDate - Date in market timezone representation
   * @returns true if the date is a holiday
   */
  private isHolidayZoned(nyDate: Date): boolean {
    const formattedDate = format(nyDate, 'yyyy-MM-dd');
    const yearHolidays = marketHolidays[nyDate.getFullYear()];

    for (const holiday in yearHolidays) {
      if (yearHolidays[holiday].date === formattedDate) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks if a NY-zoned date is an early close day.
   * Expects a date already converted to market timezone via toZonedTime.
   * @param nyDate - Date in market timezone representation
   * @returns true if the date is an early close day
   */
  private isEarlyCloseDayZoned(nyDate: Date): boolean {
    const formattedDate = format(nyDate, 'yyyy-MM-dd');
    const yearEarlyCloses = marketEarlyCloses[nyDate.getFullYear()];
    return yearEarlyCloses && yearEarlyCloses[formattedDate] !== undefined;
  }

  /**
   * Gets the early close time for a NY-zoned date.
   * Expects a date already converted to market timezone via toZonedTime.
   * @param nyDate - Date in market timezone representation
   * @returns The early close time in minutes from midnight, or null if not an early close day
   */
  private getEarlyCloseTimeZoned(nyDate: Date): number | null {
    const formattedDate = format(nyDate, 'yyyy-MM-dd');
    const yearEarlyCloses = marketEarlyCloses[nyDate.getFullYear()];

    if (yearEarlyCloses && yearEarlyCloses[formattedDate]) {
      const [hours, minutes] = yearEarlyCloses[formattedDate].time.split(':').map(Number);
      return hours * 60 + minutes;
    }
    return null;
  }

  /**
   * Checks if a NY-zoned date is a market day (not weekend, not holiday).
   * Expects a date already converted to market timezone via toZonedTime.
   * @param nyDate - Date in market timezone representation
   * @returns true if the date is a market day
   */
  private isMarketDayZoned(nyDate: Date): boolean {
    return !this.isWeekendZoned(nyDate) && !this.isHolidayZoned(nyDate);
  }

  /**
   * Check if a given date is an early close day.
   * Handles timezone conversion from any input date.
   * @param date - The date to check (any timezone)
   * @returns true if the date is an early close day
   */
  public isEarlyCloseDay(date: Date): boolean {
    const nyDate = toZonedTime(date, this.timezone);
    return this.isEarlyCloseDayZoned(nyDate);
  }

  /**
   * Get the early close time for a given date.
   * Handles timezone conversion from any input date.
   * @param date - The date to check (any timezone)
   * @returns The early close time in minutes from midnight, or null if there is no early close
   */
  public getEarlyCloseTime(date: Date): number | null {
    const nyDate = toZonedTime(date, this.timezone);
    return this.getEarlyCloseTimeZoned(nyDate);
  }

  /**
   * Check if a given date is a market day.
   * Handles timezone conversion from any input date.
   * @param date - The date to check (any timezone)
   * @returns true if the date is a market day, false otherwise
   */
  public isMarketDay(date: Date): boolean {
    const nyDate = toZonedTime(date, this.timezone);
    return this.isMarketDayZoned(nyDate);
  }

  /**
   * Check if a given date is within market hours.
   * Handles timezone conversion from any input date.
   * @param date - The date to check (any timezone)
   * @returns true if the date is within market hours, false otherwise
   */
  public isWithinMarketHours(date: Date): boolean {
    const nyDate = toZonedTime(date, this.timezone);
    return this.isWithinMarketHoursZoned(nyDate);
  }

  /**
   * Check if a NY-zoned date is within market hours.
   * Expects a date already converted to market timezone via toZonedTime.
   * @param nyDate - Date in market timezone representation
   * @returns true if the date is within market hours, false otherwise
   */
  private isWithinMarketHoursZoned(nyDate: Date): boolean {
    // Check for weekends and holidays first
    if (this.isWeekendZoned(nyDate) || this.isHolidayZoned(nyDate)) {
      return false;
    }

    const timeInMinutes = nyDate.getHours() * 60 + nyDate.getMinutes();

    // Check for early closure
    if (this.isEarlyCloseDayZoned(nyDate)) {
      const earlyCloseMinutes = this.getEarlyCloseTimeZoned(nyDate);
      if (earlyCloseMinutes !== null && timeInMinutes > earlyCloseMinutes) {
        return false;
      }
    }

    // Regular market hours logic
    let returner: boolean;
    switch (this.intradayReporting) {
      case 'extended_hours': {
        const extendedStartMinutes = MARKET_TIMES.EXTENDED.START.HOUR * 60 + MARKET_TIMES.EXTENDED.START.MINUTE;
        const extendedEndMinutes = MARKET_TIMES.EXTENDED.END.HOUR * 60 + MARKET_TIMES.EXTENDED.END.MINUTE;

        // Comprehensive handling of times crossing midnight
        const adjustedNyDate = timeInMinutes < extendedStartMinutes ? sub(nyDate, { days: 1 }) : nyDate;

        const adjustedTimeInMinutes = adjustedNyDate.getHours() * 60 + adjustedNyDate.getMinutes();

        returner = adjustedTimeInMinutes >= extendedStartMinutes && adjustedTimeInMinutes <= extendedEndMinutes;
        break;
      }
      case 'continuous':
        returner = true;
        break;
      default: {
        // market_hours
        const regularStartMinutes = MARKET_TIMES.REGULAR.START.HOUR * 60 + MARKET_TIMES.REGULAR.START.MINUTE;
        const regularEndMinutes = MARKET_TIMES.REGULAR.END.HOUR * 60 + MARKET_TIMES.REGULAR.END.MINUTE;
        returner = timeInMinutes >= regularStartMinutes && timeInMinutes <= regularEndMinutes;
        break;
      }
    }
    return returner;
  }

  /**
   * Check if a NY-zoned date is before market hours.
   * Expects a date already converted to market timezone via toZonedTime.
   * @param nyDate - Date in market timezone representation
   * @returns true if the date is before market hours, false otherwise
   */
  private isBeforeMarketHoursZoned(nyDate: Date): boolean {
    const timeInMinutes = nyDate.getHours() * 60 + nyDate.getMinutes();
    const startMinutes =
      this.intradayReporting === 'extended_hours'
        ? MARKET_TIMES.EXTENDED.START.HOUR * 60 + MARKET_TIMES.EXTENDED.START.MINUTE
        : MARKET_TIMES.REGULAR.START.HOUR * 60 + MARKET_TIMES.REGULAR.START.MINUTE;

    return timeInMinutes < startMinutes;
  }

  /**
   * Get the last trading date, i.e. the last date that was a market day
   * @param currentDate - The current date
   * @returns The last trading date
   */
  public getLastTradingDate(currentDate: Date = new Date()): Date {
    const nowET = toZonedTime(currentDate, this.timezone);

    const isMarketDayToday = this.isMarketDayZoned(nowET);

    const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
    const marketOpenMinutes = MARKET_TIMES.REGULAR.START.HOUR * 60 + MARKET_TIMES.REGULAR.START.MINUTE;

    if (isMarketDayToday && currentMinutes >= marketOpenMinutes) {
      // After market open on a market day, return today
      return nowET;
    } else {
      // Before market open, or not a market day, return previous trading day
      let lastTradingDate = sub(nowET, { days: 1 });
      while (!this.isMarketDayZoned(lastTradingDate)) {
        lastTradingDate = sub(lastTradingDate, { days: 1 });
      }
      return lastTradingDate;
    }
  }

  private getLastMarketDay(date: Date): Date {
    let currentDate = sub(date, { days: 1 });
    while (!this.isMarketDayZoned(currentDate)) {
      currentDate = sub(currentDate, { days: 1 });
    }
    return currentDate;
  }

  public getLastFullTradingDate(currentDate: Date = new Date()): Date {
    const nowET = toZonedTime(currentDate, this.timezone);

    // If today is a market day and we're after extended hours close
    // then return today since it's a completed trading day
    if (this.isMarketDayZoned(nowET)) {
      const timeInMinutes = nowET.getHours() * 60 + nowET.getMinutes();
      const extendedEndMinutes = MARKET_TIMES.EXTENDED.END.HOUR * 60 + MARKET_TIMES.EXTENDED.END.MINUTE;

      // Check if we're after market close (including extended hours)
      if (timeInMinutes >= extendedEndMinutes) {
        // Set to midnight ET while preserving the date
        return fromZonedTime(set(nowET, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }), this.timezone);
      }
    }

    // In all other cases (during trading hours, before market open, holidays, weekends),
    // we want the last completed trading day
    let lastFullDate = this.getLastMarketDay(nowET);

    // Set to midnight ET while preserving the date
    return fromZonedTime(set(lastFullDate, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }), this.timezone);
  }

  /**
   * Gets the next market day from a reference date
   * @param {Object} [options] - Options object
   * @param {Date} [options.referenceDate] - The reference date (defaults to current date)
   * @returns {Object} The next market day information
   * @property {Date} date - The date object (start of day in NY time)
   * @property {string} yyyymmdd - The date in YYYY-MM-DD format
   * @property {string} dateISOString - Full ISO date string
   */
  /**
   * Gets the next market day from a date already in market timezone.
   * @param nyDate - Date in market timezone representation
   * @returns The next market day in market timezone representation
   */
  private getNextMarketDayZoned(nyDate: Date): Date {
    let currentDate = add(nyDate, { days: 1 });
    while (!this.isMarketDayZoned(currentDate)) {
      currentDate = add(currentDate, { days: 1 });
    }
    return currentDate;
  }

  /**
   * Gets the next market day from a reference date.
   * Handles timezone conversion from any input date.
   * @param date - The reference date (any timezone)
   * @returns The next market day as a Date (note: internally represented in market timezone)
   */
  public getNextMarketDay(date: Date): Date {
    const nyDate = toZonedTime(date, this.timezone);
    return this.getNextMarketDayZoned(nyDate);
  }

  private getDayBoundaries(date: Date): { start: Date; end: Date } {
    let start: Date;
    let end: Date;

    switch (this.intradayReporting) {
      case 'extended_hours': {
        start = set(date, {
          hours: MARKET_TIMES.EXTENDED.START.HOUR,
          minutes: MARKET_TIMES.EXTENDED.START.MINUTE,
          seconds: 0,
          milliseconds: 0,
        });
        end = set(date, {
          hours: MARKET_TIMES.EXTENDED.END.HOUR,
          minutes: MARKET_TIMES.EXTENDED.END.MINUTE,
          seconds: 59,
          milliseconds: 999,
        });
        break;
      }
      case 'continuous': {
        start = startOfDay(date);
        end = endOfDay(date);
        break;
      }
      default: {
        // market_hours
        start = set(date, {
          hours: MARKET_TIMES.REGULAR.START.HOUR,
          minutes: MARKET_TIMES.REGULAR.START.MINUTE,
          seconds: 0,
          milliseconds: 0,
        });

        // Check for early close (date is already zoned)
        if (this.isEarlyCloseDayZoned(date)) {
          const earlyCloseMinutes = this.getEarlyCloseTimeZoned(date);
          if (earlyCloseMinutes !== null) {
            const earlyCloseHours = Math.floor(earlyCloseMinutes / 60);
            const earlyCloseMinutesRemainder = earlyCloseMinutes % 60;
            end = set(date, {
              hours: earlyCloseHours,
              minutes: earlyCloseMinutesRemainder,
              seconds: 59,
              milliseconds: 999,
            });
            break;
          }
        }

        end = set(date, {
          hours: MARKET_TIMES.REGULAR.END.HOUR,
          minutes: MARKET_TIMES.REGULAR.END.MINUTE,
          seconds: 59,
          milliseconds: 999,
        });
        break;
      }
    }

    return { start, end };
  }

  private calculatePeriodStartDate(endDate: Date, period: Period): Date {
    let startDate: Date;
    switch (period) {
      case 'YTD':
        startDate = set(endDate, { month: 0, date: 1 });
        break;
      case '1D':
        startDate = this.getLastMarketDay(endDate);
        break;
      case '3D':
        startDate = sub(endDate, { days: 3 });
        break;
      case '1W':
        startDate = sub(endDate, { weeks: 1 });
        break;
      case '2W':
        startDate = sub(endDate, { weeks: 2 });
        break;
      case '1M':
        startDate = sub(endDate, { months: 1 });
        break;
      case '3M':
        startDate = sub(endDate, { months: 3 });
        break;
      case '6M':
        startDate = sub(endDate, { months: 6 });
        break;
      case '1Y':
        startDate = sub(endDate, { years: 1 });
        break;
      default:
        throw new Error(`Invalid period: ${period}`);
    }

    while (!this.isMarketDayZoned(startDate)) {
      startDate = this.getNextMarketDayZoned(startDate);
    }

    return startDate;
  }

  public getMarketTimePeriod({
    period,
    end = new Date(),
    intraday_reporting,
    outputFormat = 'iso',
  }: MarketTimeParams): PeriodDates {
    if (!period) {
      throw new Error('Period is required');
    }
    if (intraday_reporting) {
      this.intradayReporting = intraday_reporting;
    }

    // Convert end date to specified timezone
    const zonedEndDate = toZonedTime(end, this.timezone);

    let startDate: Date;
    let endDate: Date;

    const isCurrentMarketDay = this.isMarketDayZoned(zonedEndDate);
    const isWithinHours = this.isWithinMarketHoursZoned(zonedEndDate);
    const isBeforeHours = this.isBeforeMarketHoursZoned(zonedEndDate);

    // First determine the end date based on current market conditions
    if (isCurrentMarketDay) {
      if (isBeforeHours) {
        // Case 1: Market day before open hours - use previous full trading day
        const lastMarketDay = this.getLastMarketDay(zonedEndDate);
        const { end: dayEnd } = this.getDayBoundaries(lastMarketDay);
        endDate = dayEnd;
      } else if (isWithinHours) {
        // Case 2: Market day during hours - use current time
        endDate = zonedEndDate;
      } else {
        // Case 3: Market day after close - use today's close
        const { end: dayEnd } = this.getDayBoundaries(zonedEndDate);
        endDate = dayEnd;
      }
    } else {
      // Case 4: Not a market day - use previous market day's close
      const lastMarketDay = this.getLastMarketDay(zonedEndDate);
      const { end: dayEnd } = this.getDayBoundaries(lastMarketDay);
      endDate = dayEnd;
    }

    // Now calculate the start date based on the period
    const periodStartDate = this.calculatePeriodStartDate(endDate, period);
    const { start: dayStart } = this.getDayBoundaries(periodStartDate);
    startDate = dayStart;

    // Convert boundaries back to UTC for final output
    const utcStart = fromZonedTime(startDate, this.timezone);
    const utcEnd = fromZonedTime(endDate, this.timezone);

    // Ensure start is not after end
    if (isBefore(utcEnd, utcStart)) {
      throw new Error('Start date cannot be after end date');
    }

    return {
      start: this.formatDate(utcStart, outputFormat),
      end: this.formatDate(utcEnd, outputFormat),
    };
  }

  public getMarketOpenClose(options: { date?: Date } = {}): MarketOpenCloseResult {
    const { date = new Date() } = options;
    const zonedDate = toZonedTime(date, this.timezone);

    // Check if market is closed for the day
    if (this.isWeekendZoned(zonedDate) || this.isHolidayZoned(zonedDate)) {
      return {
        marketOpen: false,
        open: null,
        close: null,
        openExt: null,
        closeExt: null,
      };
    }

    const dayStart = startOfDay(zonedDate);
    const regularOpenTime = MARKET_TIMES.REGULAR.START;
    let regularCloseTime = MARKET_TIMES.REGULAR.END;
    const extendedOpenTime = MARKET_TIMES.EXTENDED.START;
    let extendedCloseTime = MARKET_TIMES.EXTENDED.END;

    // Check for early close (zonedDate is already in market timezone)
    const isEarlyClose = this.isEarlyCloseDayZoned(zonedDate);
    if (isEarlyClose) {
      const earlyCloseMinutes = this.getEarlyCloseTimeZoned(zonedDate);
      if (earlyCloseMinutes !== null) {
        // For regular hours, use the early close time
        regularCloseTime = {
          HOUR: Math.floor(earlyCloseMinutes / 60),
          MINUTE: earlyCloseMinutes % 60,
          MINUTES: earlyCloseMinutes,
        };
        // For extended hours on early close days, close at 5:00 PM
        extendedCloseTime = {
          HOUR: 17 as typeof MARKET_TIMES.EXTENDED.END.HOUR,
          MINUTE: 0 as typeof MARKET_TIMES.EXTENDED.END.MINUTE,
          MINUTES: 1020,
        };
      }
    }

    const open = fromZonedTime(
      set(dayStart, { hours: regularOpenTime.HOUR, minutes: regularOpenTime.MINUTE }),
      this.timezone
    );
    const close = fromZonedTime(
      set(dayStart, { hours: regularCloseTime.HOUR, minutes: regularCloseTime.MINUTE }),
      this.timezone
    );
    const openExt = fromZonedTime(
      set(dayStart, { hours: extendedOpenTime.HOUR, minutes: extendedOpenTime.MINUTE }),
      this.timezone
    );
    const closeExt = fromZonedTime(
      set(dayStart, { hours: extendedCloseTime.HOUR, minutes: extendedCloseTime.MINUTE }),
      this.timezone
    );

    return {
      marketOpen: true,
      open,
      close,
      openExt,
      closeExt,
    };
  }
}

/**
 * Creates a new MarketTimeUtil instance
 * @param {string} [timezone] - The timezone to use for market time calculations
 * @param {IntradayReporting} [intraday_reporting] - The intraday reporting mode
 * @returns {MarketTimeUtil} A new MarketTimeUtil instance
 */
export function createMarketTimeUtil(timezone?: string, intraday_reporting?: IntradayReporting): MarketTimeUtil {
  return new MarketTimeUtil(timezone, intraday_reporting);
}

/**
 * Gets start and end timestamps for a given market time period
 * @param {MarketTimeParams} [params] - The market time parameters
 * @returns {PeriodDates} The start and end timestamps
 */
export function getStartAndEndTimestamps(params: MarketTimeParams = {}): PeriodDates {
  const util = createMarketTimeUtil(params.timezone, params.intraday_reporting);
  const effectiveParams = {
    ...params,
    end: params.referenceDate || params.end || new Date(),
  };
  return util.getMarketTimePeriod(effectiveParams);
}

/**
 * Gets the market open/close times for a given date
 * @param {Object} [options] - Options object
 * @param {Date} [options.date] - The date to check (defaults to current date)
 * @returns {MarketOpenCloseResult} The market open/close times
 */
export function getMarketOpenClose(options: { date?: Date } = {}): MarketOpenCloseResult {
  const marketTimeUtil = new MarketTimeUtil();
  return marketTimeUtil.getMarketOpenClose(options);
}

/**
 * Gets the start and end dates for a given market time period
 * @param {MarketTimeParams} [params] - The market time parameters
 * @returns {Object} The start and end dates
 * @property {Date} start - The start date
 * @property {Date} end - The end date
 */
export function getStartAndEndDates(params: MarketTimeParams = {}): { start: Date; end: Date } {
  const util = createMarketTimeUtil(params.timezone, params.intraday_reporting);
  const effectiveParams = {
    ...params,
    end: params.referenceDate || params.end || new Date(),
  };
  const { start, end } = util.getMarketTimePeriod(effectiveParams);

  // Ensure the returned values are Dates
  return {
    start: new Date(start),
    end: new Date(end),
  };
}

/**
 * Gets the last trading date in YYYY-MM-DD format
 * @returns {string} The last trading date in YYYY-MM-DD format
 */
export function getLastTradingDateYYYYMMDD(): string {
  const util = new MarketTimeUtil();
  const lastTradingDate = util.getLastTradingDate();
  return format(lastTradingDate, 'yyyy-MM-dd');
}

/**
 * Gets the last full trading date
 * @param {Date} [currentDate] - The current date (defaults to now)
 * @returns {Object} The last full trading date
 * @property {Date} date - The date object
 * @property {string} YYYYMMDD - The date in YYYY-MM-DD format
 */
export function getLastFullTradingDate(currentDate: Date = new Date()): { date: Date; YYYYMMDD: string } {
  const util = new MarketTimeUtil();
  const date = util.getLastFullTradingDate(currentDate);
  // Format the date in NY timezone to ensure consistency
  return {
    date,
    YYYYMMDD: formatInTimeZone(date, MARKET_TIMES.TIMEZONE, 'yyyy-MM-dd'),
  };
}

/**
 * Gets the next market day from a reference date
 * @param {Object} [options] - Options object
 * @param {Date} [options.referenceDate] - The reference date (defaults to current date)
 * @returns {Object} The next market day information
 * @property {Date} date - The date object (start of day in NY time)
 * @property {string} yyyymmdd - The date in YYYY-MM-DD format
 * @property {string} dateISOString - Full ISO date string
 */
export function getNextMarketDay({ referenceDate }: { referenceDate?: Date } = {}): {
  date: Date;
  yyyymmdd: string;
  dateISOString: string;
} {
  const util = new MarketTimeUtil();
  const startDate = referenceDate || new Date();
  // getNextMarketDay returns a date in NY-zoned representation
  const nextDateZoned = util.getNextMarketDay(startDate);

  // Convert zoned representation to start of day, then back to real UTC
  const startOfDayNY = startOfDay(nextDateZoned);
  const dateInET = fromZonedTime(startOfDayNY, MARKET_TIMES.TIMEZONE);

  return {
    date: dateInET,
    yyyymmdd: formatInTimeZone(dateInET, MARKET_TIMES.TIMEZONE, 'yyyy-MM-dd'),
    dateISOString: dateInET.toISOString()
  };
}

/**
 * Gets the current time in Eastern Time
 * @returns {Date} The current time in Eastern Time
 */
export const currentTimeET = (): Date => {
  return toZonedTime(new Date(), MARKET_TIMES.TIMEZONE);
};

/**
 * Gets a date in New York timezone, rezoned using date-fns-tz
 * @param {number|string|Date} time - The time to convert
 * @returns {Date} The date in New York timezone
 */
export function getDateInNY(time: number | string | { year: number; month: number; day: number }): Date {
  let date: Date;
  if (typeof time === 'number' || typeof time === 'string' || time instanceof Date) {
    // Assuming Unix timestamp in epoch milliseconds, string date, or Date object
    date = new Date(time);
  } else {
    // Assuming object with year, month, and day
    date = new Date(time.year, time.month - 1, time.day);
  }
  return toZonedTime(date, 'America/New_York');
}

/**
 * Gets the trading date in YYYY-MM-DD format for New York timezone, for grouping of data
 * @param {string|number|Date} time - The time to convert (string, unix timestamp in ms, or Date object)
 * @returns {string} The trading date in YYYY-MM-DD format
 */
export function getTradingDate(time: string | number | Date): string {
  let date: Date;
  if (typeof time === 'number') {
    // Assuming Unix timestamp in milliseconds
    date = new Date(time);
  } else if (typeof time === 'string') {
    date = new Date(time);
  } else {
    date = time;
  }
  
  // Convert to NY timezone and format as YYYY-MM-DD
  return formatInTimeZone(date, MARKET_TIMES.TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Returns the New York timezone offset based on whether daylight savings is active
 * @param dateString - The date string to check
 * @returns "-04:00" during daylight savings (EDT) or "-05:00" during standard time (EST)
 */
export const getNYTimeZone = (date?: Date): '-04:00' | '-05:00' => {
  if (!date) {
    date = new Date();
  }

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  });
  const parts = dtf.formatToParts(date);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value;
  // tz will be "GMT-5" or "GMT-4"
  if (!tz) {
    throw new Error('Could not determine New York offset');
  }
  // extract the -4 or -5 from the string
  const shortOffset = tz.replace('GMT', '');
  // return the correct offset
  if (shortOffset === '-4') {
    getLogger().info(
      `New York is on EDT; using -04:00. Full date: ${date.toLocaleString('en-US', {
        timeZone: 'America/New_York',
      })}, time zone part: ${tz}`
    );
    return '-04:00';
  } else if (shortOffset === '-5') {
    getLogger().info(
      `New York is on EST; using -05:00. Full date: ${date.toLocaleString('en-US', {
        timeZone: 'America/New_York',
      })}, time zone part: ${tz}`
    );
    return '-05:00';
  } else {
    throw new Error('Could not determine New York offset');
  }
};

/**
 * Gets the current market status
 * @param {Object} [options] - Options object
 * @param {Date} [options.date] - The date to check (defaults to current date)
 * @returns {MarketStatus} The current market status
 */
export function getMarketStatus(options: { date?: Date } = {}): MarketStatus {
  const util = new MarketTimeUtil();
  const now = options.date || new Date();
  const nyTime = toZonedTime(now, MARKET_TIMES.TIMEZONE);
  const isEarlyCloseDay = util.isEarlyCloseDay(now);

  const timeInMinutes = nyTime.getHours() * 60 + nyTime.getMinutes();
  const extendedStartMinutes = MARKET_TIMES.EXTENDED.START.MINUTES;
  const marketStartMinutes = MARKET_TIMES.REGULAR.START.MINUTES;
  const endOfEarlyMarketMinutes = MARKET_TIMES.EARLY_MORNING.END.MINUTES;
  const marketRegularCloseMinutes = isEarlyCloseDay
    ? MARKET_TIMES.EARLY_CLOSE_BEFORE_HOLIDAY.END.MINUTES
    : MARKET_TIMES.REGULAR.END.MINUTES;
  const extendedEndMinutes = isEarlyCloseDay
    ? MARKET_TIMES.EARLY_EXTENDED_BEFORE_HOLIDAY.END.MINUTES
    : MARKET_TIMES.EXTENDED.END.MINUTES;

  let status: MarketStatus['status'];
  let nextStatus: MarketStatus['nextStatus'];
  let nextStatusTime: Date;
  let marketPeriod: MarketStatus['marketPeriod'];

  const nextMarketDay = util.getNextMarketDay(now);

  // Determine current status and market period
  if (!util.isMarketDay(now)) {
    // Not a market day! market is closed
    marketPeriod = 'closed';
    status = 'closed';
    nextStatus = 'extended hours';
    // Find next market day and set to extended hours start time

    nextStatusTime = set(nextMarketDay, {
      hours: MARKET_TIMES.EXTENDED.START.HOUR,
      minutes: MARKET_TIMES.EXTENDED.START.MINUTE,
    });
  } // check if the market isn't in extended hours yet
  else if (timeInMinutes >= 0 && timeInMinutes < extendedStartMinutes) {
    marketPeriod = 'closed';
    status = 'closed';
    nextStatus = 'extended hours';
    nextStatusTime = set(nyTime, {
      hours: MARKET_TIMES.EXTENDED.START.HOUR,
      minutes: MARKET_TIMES.EXTENDED.START.MINUTE,
    });
    // check if we're in pre-market hours
  } else if (timeInMinutes >= extendedStartMinutes && timeInMinutes < marketStartMinutes) {
    marketPeriod = 'preMarket';
    status = 'extended hours';
    nextStatus = 'open';
    nextStatusTime = set(nyTime, {
      hours: MARKET_TIMES.REGULAR.START.HOUR,
      minutes: MARKET_TIMES.REGULAR.START.MINUTE,
    });
    // check if market is open
  } else if (timeInMinutes >= marketStartMinutes && timeInMinutes < marketRegularCloseMinutes) {
    status = 'open';
    nextStatus = 'extended hours';
    // market is open, but just check the marketPeriod - could be earlyMarket or regularMarket
    marketPeriod = timeInMinutes < MARKET_TIMES.EARLY_MORNING.END.MINUTES ? 'earlyMarket' : 'regularMarket';
    nextStatusTime = isEarlyCloseDay
      ? set(nyTime, {
        hours: MARKET_TIMES.EARLY_CLOSE_BEFORE_HOLIDAY.END.HOUR,
        minutes: MARKET_TIMES.EARLY_CLOSE_BEFORE_HOLIDAY.END.MINUTE,
      })
      : set(nyTime, {
        hours: MARKET_TIMES.REGULAR.END.HOUR,
        minutes: MARKET_TIMES.REGULAR.END.MINUTE,
      });
    // check if it's after-market extended hours
  } else if (timeInMinutes >= marketRegularCloseMinutes && timeInMinutes < extendedEndMinutes) {
    status = 'extended hours';
    nextStatus = 'closed';
    marketPeriod = 'afterMarket';
    nextStatusTime = isEarlyCloseDay
      ? set(nyTime, {
        hours: MARKET_TIMES.EARLY_EXTENDED_BEFORE_HOLIDAY.END.HOUR,
        minutes: MARKET_TIMES.EARLY_EXTENDED_BEFORE_HOLIDAY.END.MINUTE,
      })
      : set(nyTime, {
        hours: MARKET_TIMES.EXTENDED.END.HOUR,
        minutes: MARKET_TIMES.EXTENDED.END.MINUTE,
      });
    // otherwise, the market is closed
  } else {
    status = 'closed';
    nextStatus = 'extended hours';
    marketPeriod = 'closed';
    nextStatusTime = set(nextMarketDay, {
      hours: MARKET_TIMES.EXTENDED.START.HOUR,
      minutes: MARKET_TIMES.EXTENDED.START.MINUTE,
    });
  }
  const dateFormat = 'MMMM dd, yyyy, HH:mm:ss a';
  return {
    time: now,
    timeString: format(nyTime, dateFormat),
    status,
    nextStatus,
    marketPeriod,
    nextStatusTime: fromZonedTime(nextStatusTime, MARKET_TIMES.TIMEZONE),
    nextStatusTimeDifference: differenceInMilliseconds(nextStatusTime, nyTime),
    nextStatusTimeString: format(nextStatusTime, dateFormat),
  };
}
