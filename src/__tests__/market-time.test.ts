import { describe, it, expect, beforeEach } from 'vitest';
import { MarketTimeUtil, MARKET_TIMES, getMarketStatus, getNextMarketDay } from '../market-time';
import { set } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

describe('MarketTimeUtil', () => {
  let util: MarketTimeUtil;

  beforeEach(() => {
    util = new MarketTimeUtil();
  });

  describe('isMarketDay', () => {
    it('should return true for a regular weekday (not a holiday)', () => {
      // Tuesday, January 7, 2025
      const date = new Date('2025-01-07T12:00:00-05:00');
      expect(util.isMarketDay(date)).toBe(true);
    });

    it('should return false for Saturday', () => {
      // Saturday, January 4, 2025
      const date = new Date('2025-01-04T12:00:00-05:00');
      expect(util.isMarketDay(date)).toBe(false);
    });

    it('should return false for Sunday', () => {
      // Sunday, January 5, 2025
      const date = new Date('2025-01-05T12:00:00-05:00');
      expect(util.isMarketDay(date)).toBe(false);
    });

    it('should return false for New Year\'s Day 2025', () => {
      // Wednesday, January 1, 2025 (New Year's Day)
      const date = new Date('2025-01-01T12:00:00-05:00');
      expect(util.isMarketDay(date)).toBe(false);
    });
  });

  describe('isEarlyCloseDay', () => {
    it('should return true for day before Independence Day 2025', () => {
      // Thursday, July 3, 2025 (early close before July 4th)
      const date = new Date('2025-07-03T12:00:00-04:00');
      expect(util.isEarlyCloseDay(date)).toBe(true);
    });

    it('should return false for a regular trading day', () => {
      const date = new Date('2025-01-07T12:00:00-05:00');
      expect(util.isEarlyCloseDay(date)).toBe(false);
    });
  });

  describe('getEarlyCloseTime', () => {
    it('should return 780 minutes (1:00 PM) for day before Independence Day', () => {
      const date = new Date('2025-07-03T12:00:00-04:00');
      const closeTime = util.getEarlyCloseTime(date);
      expect(closeTime).toBe(780); // 13 hours * 60 minutes = 780 minutes
    });

    it('should return null for a regular trading day', () => {
      const date = new Date('2025-01-07T12:00:00-05:00');
      const closeTime = util.getEarlyCloseTime(date);
      expect(closeTime).toBe(null);
    });
  });

  describe('isWithinMarketHours', () => {
    it('should return true during regular market hours (10:00 AM)', () => {
      const date = new Date('2025-01-07T10:00:00-05:00');
      expect(util.isWithinMarketHours(date)).toBe(true);
    });

    it('should return true at market open (9:30 AM)', () => {
      const date = new Date('2025-01-07T09:30:00-05:00');
      expect(util.isWithinMarketHours(date)).toBe(true);
    });

    it('should return true just before market close (3:59 PM)', () => {
      const date = new Date('2025-01-07T15:59:00-05:00');
      expect(util.isWithinMarketHours(date)).toBe(true);
    });

    it('should return false before market open (9:00 AM)', () => {
      const date = new Date('2025-01-07T09:00:00-05:00');
      expect(util.isWithinMarketHours(date)).toBe(false);
    });

    it('should return false after market close (4:30 PM)', () => {
      const date = new Date('2025-01-07T16:30:00-05:00');
      expect(util.isWithinMarketHours(date)).toBe(false);
    });

    it('should return false on holidays', () => {
      const date = new Date('2025-01-01T12:00:00-05:00');
      expect(util.isWithinMarketHours(date)).toBe(false);
    });

    it('should return false on weekends', () => {
      const date = new Date('2025-01-04T12:00:00-05:00');
      expect(util.isWithinMarketHours(date)).toBe(false);
    });
  });

  describe('getLastTradingDate', () => {
    it('should return today if it is a market day after market open', () => {
      // Tuesday, January 7, 2025 at 10:00 AM
      const date = new Date('2025-01-07T10:00:00-05:00');
      const lastTradingDate = util.getLastTradingDate(date);
      const expectedDate = toZonedTime(date, MARKET_TIMES.TIMEZONE);
      expect(lastTradingDate.getDate()).toBe(expectedDate.getDate());
    });

    it('should return previous trading day if before market open', () => {
      // Tuesday, January 7, 2025 at 9:00 AM (before open)
      const date = new Date('2025-01-07T09:00:00-05:00');
      const lastTradingDate = util.getLastTradingDate(date);
      // Should return Monday, January 6, 2025
      expect(lastTradingDate.getDate()).toBe(6);
    });

    it('should skip weekends when finding last trading date', () => {
      // Monday, January 6, 2025 at 9:00 AM
      const date = new Date('2025-01-06T09:00:00-05:00');
      const lastTradingDate = util.getLastTradingDate(date);
      // Should return Friday, January 3, 2025
      expect(lastTradingDate.getDate()).toBe(3);
    });
  });

  describe('getNextMarketDay', () => {
    it('should return next weekday when called on Friday', () => {
      // Friday, January 3, 2025
      const date = new Date('2025-01-03T12:00:00-05:00');
      const nextDay = util.getNextMarketDay(date);
      // Should return Monday, January 6, 2025
      expect(nextDay.getDate()).toBe(6);
      expect(nextDay.getMonth()).toBe(0); // January
    });

    it('should skip holidays when finding next market day', () => {
      // Tuesday, December 31, 2024
      const date = new Date('2024-12-31T12:00:00-05:00');
      const nextDay = util.getNextMarketDay(date);
      // Should skip January 1, 2025 (holiday) and return January 2, 2025
      expect(nextDay.getDate()).toBe(2);
      expect(nextDay.getMonth()).toBe(0); // January
      expect(nextDay.getFullYear()).toBe(2025);
    });
  });

  describe('getMarketOpenClose', () => {
    it('should return correct times for a regular market day', () => {
      const date = new Date('2025-01-07T12:00:00-05:00');
      const result = util.getMarketOpenClose({ date });

      expect(result.marketOpen).toBe(true);
      expect(result.open).toBeDefined();
      expect(result.close).toBeDefined();
      expect(result.openExt).toBeDefined();
      expect(result.closeExt).toBeDefined();

      // Verify regular hours: 9:30 AM - 4:00 PM
      const nyDate = toZonedTime(date, MARKET_TIMES.TIMEZONE);
      const open = toZonedTime(result.open!, MARKET_TIMES.TIMEZONE);
      const close = toZonedTime(result.close!, MARKET_TIMES.TIMEZONE);

      expect(open.getHours()).toBe(9);
      expect(open.getMinutes()).toBe(30);
      expect(close.getHours()).toBe(16);
      expect(close.getMinutes()).toBe(0);
    });

    it('should return marketOpen: false for weekends', () => {
      const date = new Date('2025-01-04T12:00:00-05:00'); // Saturday
      const result = util.getMarketOpenClose({ date });

      expect(result.marketOpen).toBe(false);
      expect(result.open).toBe(null);
      expect(result.close).toBe(null);
      expect(result.openExt).toBe(null);
      expect(result.closeExt).toBe(null);
    });

    it('should return early close time for early close days', () => {
      const date = new Date('2025-07-03T12:00:00-04:00'); // Day before July 4th
      const result = util.getMarketOpenClose({ date });

      expect(result.marketOpen).toBe(true);
      const close = toZonedTime(result.close!, MARKET_TIMES.TIMEZONE);
      expect(close.getHours()).toBe(13); // 1:00 PM
      expect(close.getMinutes()).toBe(0);
    });
  });

  describe('getMarketTimePeriod', () => {
    it('should calculate 1D period correctly', () => {
      const date = new Date('2025-01-07T15:00:00-05:00'); // Tuesday 3:00 PM
      const result = util.getMarketTimePeriod({
        period: '1D',
        end: date,
      });

      expect(result.start).toBeDefined();
      expect(result.end).toBeDefined();
      expect(new Date(result.start)).toBeInstanceOf(Date);
      expect(new Date(result.end)).toBeInstanceOf(Date);
    });

    it('should calculate 1W period correctly', () => {
      const date = new Date('2025-01-07T15:00:00-05:00');
      const result = util.getMarketTimePeriod({
        period: '1W',
        end: date,
      });

      const startDate = new Date(result.start);
      const endDate = new Date(result.end);

      expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
    });

    it('should throw error if period is not provided', () => {
      expect(() => {
        util.getMarketTimePeriod({});
      }).toThrow('Period is required');
    });
  });
});

describe('getMarketStatus', () => {
  it('should return "open" during regular market hours', () => {
    const date = new Date('2025-01-07T10:00:00-05:00'); // Tuesday 10:00 AM
    const status = getMarketStatus({ date });

    expect(status.status).toBe('open');
    expect(status.marketPeriod).toBe('regularMarket');
  });

  it('should return "extended hours" during pre-market', () => {
    const date = new Date('2025-01-07T07:00:00-05:00'); // Tuesday 7:00 AM
    const status = getMarketStatus({ date });

    expect(status.status).toBe('extended hours');
    expect(status.marketPeriod).toBe('preMarket');
  });

  it('should return "closed" on weekends', () => {
    const date = new Date('2025-01-04T12:00:00-05:00'); // Saturday
    const status = getMarketStatus({ date });

    expect(status.status).toBe('closed');
    expect(status.marketPeriod).toBe('closed');
  });

  it('should return "early market" during first 30 minutes', () => {
    const date = new Date('2025-01-07T09:45:00-05:00'); // Tuesday 9:45 AM
    const status = getMarketStatus({ date });

    expect(status.status).toBe('open');
    expect(status.marketPeriod).toBe('earlyMarket');
  });
});

describe('getNextMarketDay function', () => {
  it('should return next market day with correct format', () => {
    const referenceDate = new Date('2025-01-03T12:00:00-05:00'); // Friday
    const result = getNextMarketDay({ referenceDate });

    expect(result.date).toBeInstanceOf(Date);
    expect(result.yyyymmdd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.dateISOString).toBeDefined();
    expect(result.yyyymmdd).toBe('2025-01-06'); // Monday
  });
});
