import { IntradayReporting, PeriodDates, MarketTimeParams, MarketOpenCloseResult, MarketStatus, MarketTimesConfig } from './types/market-time-types';
/**
 * Market times for NYSE
 * Regular market hours are 9:30am-4:00pm
 * Early market hours are 9:30am-10:00am (first 30 minutes)
 * Extended market hours are 4:00am to 9:30am and 4:00pm-8:00pm
 * On days before some holidays, the market closes early at 1:00pm
 * Early extended market hours are 1:00pm-5:00pm on early close days
 */
export declare const MARKET_TIMES: MarketTimesConfig;
/**
 * Utility class for handling market time-related operations
 */
export declare class MarketTimeUtil {
    private timezone;
    private intradayReporting;
    /**
     * Creates a new MarketTimeUtil instance
     * @param {string} [timezone='America/New_York'] - The timezone to use for market time calculations
     * @param {IntradayReporting} [intradayReporting='market_hours'] - The intraday reporting mode
     */
    constructor(timezone?: string, intradayReporting?: IntradayReporting);
    /**
     * Validates the provided timezone
     * @private
     * @param {string} timezone - The timezone to validate
     * @throws {Error} If the timezone is invalid
     */
    private validateTimezone;
    private formatDate;
    private isWeekend;
    private isHoliday;
    isEarlyCloseDay(date: Date): boolean;
    /**
     * Get the early close time for a given date
     * @param date - The date to get the early close time for
     * @returns The early close time in minutes from midnight, or null if there is no early close
     */
    getEarlyCloseTime(date: Date): number | null;
    /**
     * Check if a given date is a market day
     * @param date - The date to check
     * @returns true if the date is a market day, false otherwise
     */
    isMarketDay(date: Date): boolean;
    /**
     * Check if a given date is within market hours
     * @param date - The date to check
     * @returns true if the date is within market hours, false otherwise
     */
    isWithinMarketHours(date: Date): boolean;
    /**
     * Check if a given date is before market hours
     * @param date - The date to check
     * @returns true if the date is before market hours, false otherwise
     */
    private isBeforeMarketHours;
    /**
     * Get the last trading date, i.e. the last date that was a market day
     * @param currentDate - The current date
     * @returns The last trading date
     */
    getLastTradingDate(currentDate?: Date): Date;
    private getLastMarketDay;
    getLastFullTradingDate(currentDate?: Date): Date;
    /**
     * Gets the next market day from a reference date
     * @param {Object} [options] - Options object
     * @param {Date} [options.referenceDate] - The reference date (defaults to current date)
     * @returns {Object} The next market day information
     * @property {Date} date - The date object (start of day in NY time)
     * @property {string} yyyymmdd - The date in YYYY-MM-DD format
     * @property {string} dateISOString - Full ISO date string
     */
    getNextMarketDay(date: Date): Date;
    private getDayBoundaries;
    private calculatePeriodStartDate;
    getMarketTimePeriod({ period, end, intraday_reporting, outputFormat, }: MarketTimeParams): PeriodDates;
    getMarketOpenClose(options?: {
        date?: Date;
    }): MarketOpenCloseResult;
}
/**
 * Creates a new MarketTimeUtil instance
 * @param {string} [timezone] - The timezone to use for market time calculations
 * @param {IntradayReporting} [intraday_reporting] - The intraday reporting mode
 * @returns {MarketTimeUtil} A new MarketTimeUtil instance
 */
export declare function createMarketTimeUtil(timezone?: string, intraday_reporting?: IntradayReporting): MarketTimeUtil;
/**
 * Gets start and end timestamps for a given market time period
 * @param {MarketTimeParams} [params] - The market time parameters
 * @returns {PeriodDates} The start and end timestamps
 */
export declare function getStartAndEndTimestamps(params?: MarketTimeParams): PeriodDates;
/**
 * Gets the market open/close times for a given date
 * @param {Object} [options] - Options object
 * @param {Date} [options.date] - The date to check (defaults to current date)
 * @returns {MarketOpenCloseResult} The market open/close times
 */
export declare function getMarketOpenClose(options?: {
    date?: Date;
}): MarketOpenCloseResult;
/**
 * Gets the start and end dates for a given market time period
 * @param {MarketTimeParams} [params] - The market time parameters
 * @returns {Object} The start and end dates
 * @property {Date} start - The start date
 * @property {Date} end - The end date
 */
export declare function getStartAndEndDates(params?: MarketTimeParams): {
    start: Date;
    end: Date;
};
/**
 * Gets the last trading date in YYYY-MM-DD format
 * @returns {string} The last trading date in YYYY-MM-DD format
 */
export declare function getLastTradingDateYYYYMMDD(): string;
/**
 * Gets the last full trading date
 * @param {Date} [currentDate] - The current date (defaults to now)
 * @returns {Object} The last full trading date
 * @property {Date} date - The date object
 * @property {string} YYYYMMDD - The date in YYYY-MM-DD format
 */
export declare function getLastFullTradingDate(currentDate?: Date): {
    date: Date;
    YYYYMMDD: string;
};
/**
 * Gets the next market day from a reference date
 * @param {Object} [options] - Options object
 * @param {Date} [options.referenceDate] - The reference date (defaults to current date)
 * @returns {Object} The next market day information
 * @property {Date} date - The date object (start of day in NY time)
 * @property {string} yyyymmdd - The date in YYYY-MM-DD format
 * @property {string} dateISOString - Full ISO date string
 */
export declare function getNextMarketDay({ referenceDate }?: {
    referenceDate?: Date;
}): {
    date: Date;
    yyyymmdd: string;
    dateISOString: string;
};
/**
 * Gets the current time in Eastern Time
 * @returns {Date} The current time in Eastern Time
 */
export declare const currentTimeET: () => Date;
/**
 * Gets a date in New York timezone, rezoned using date-fns-tz
 * @param {number|string|Date} time - The time to convert
 * @returns {Date} The date in New York timezone
 */
export declare function getDateInNY(time: number | string | {
    year: number;
    month: number;
    day: number;
}): Date;
/**
 * Gets the trading date in YYYY-MM-DD format for New York timezone, for grouping of data
 * @param {string|number|Date} time - The time to convert (string, unix timestamp in ms, or Date object)
 * @returns {string} The trading date in YYYY-MM-DD format
 */
export declare function getTradingDate(time: string | number | Date): string;
/**
 * Returns the New York timezone offset based on whether daylight savings is active
 * @param dateString - The date string to check
 * @returns "-04:00" during daylight savings (EDT) or "-05:00" during standard time (EST)
 */
export declare const getNYTimeZone: (date?: Date) => "-04:00" | "-05:00";
/**
 * Gets the current market status
 * @param {Object} [options] - Options object
 * @param {Date} [options.date] - The date to check (defaults to current date)
 * @returns {MarketStatus} The current market status
 */
export declare function getMarketStatus(options?: {
    date?: Date;
}): MarketStatus;
//# sourceMappingURL=market-time.d.ts.map