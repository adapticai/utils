import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toUnixTimestamp,
  getTimeAgo,
  normalizeDate,
  calculateTimeRange,
  calculateDaysLeft,
  timeAgo,
  formatDate,
  formatDateToString,
  formatToUSEastern,
  unixTimetoUSEastern,
  timeDiffString,
} from '../time-utils';

describe('toUnixTimestamp', () => {
  it('should convert ISO string to unix timestamp in seconds', () => {
    const result = toUnixTimestamp('2025-01-01T00:00:00Z');
    expect(result).toBe(Math.floor(new Date('2025-01-01T00:00:00Z').getTime() / 1000));
  });

  it('should handle date-only string', () => {
    const result = toUnixTimestamp('2025-06-15');
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('should handle different date formats', () => {
    const result = toUnixTimestamp('January 1, 2025');
    expect(result).toBeGreaterThan(0);
  });

  it('should return NaN for invalid date string', () => {
    const result = toUnixTimestamp('not-a-date');
    expect(isNaN(result)).toBe(true);
  });

  it('should truncate milliseconds (floor)', () => {
    const result = toUnixTimestamp('2025-01-01T00:00:00.999Z');
    expect(result).toBe(Math.floor(new Date('2025-01-01T00:00:00.999Z').getTime() / 1000));
  });

  it('should handle epoch timestamp string', () => {
    const result = toUnixTimestamp('1970-01-01T00:00:00Z');
    expect(result).toBe(0);
  });
});

describe('getTimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "A few seconds ago" for recent timestamps', () => {
    const recent = new Date('2025-01-15T11:59:50Z').toISOString();
    expect(getTimeAgo(recent)).toBe('A few seconds ago');
  });

  it('should return minutes for timestamps within the hour', () => {
    const thirtyMinAgo = new Date('2025-01-15T11:30:00Z').toISOString();
    expect(getTimeAgo(thirtyMinAgo)).toBe('30 mins ago');
  });

  it('should return "1 min ago" for singular minute', () => {
    const oneMinAgo = new Date('2025-01-15T11:59:00Z').toISOString();
    expect(getTimeAgo(oneMinAgo)).toBe('1 min ago');
  });

  it('should return hours for timestamps within the day', () => {
    const twoHoursAgo = new Date('2025-01-15T10:00:00Z').toISOString();
    expect(getTimeAgo(twoHoursAgo)).toBe('2 hrs ago');
  });

  it('should return "1 hr ago" for singular hour', () => {
    const oneHourAgo = new Date('2025-01-15T11:00:00Z').toISOString();
    expect(getTimeAgo(oneHourAgo)).toBe('1 hr ago');
  });

  it('should return days for timestamps within the month', () => {
    const fiveDaysAgo = new Date('2025-01-10T12:00:00Z').toISOString();
    expect(getTimeAgo(fiveDaysAgo)).toBe('5 days ago');
  });

  it('should return "1 day ago" for singular day', () => {
    const oneDayAgo = new Date('2025-01-14T12:00:00Z').toISOString();
    expect(getTimeAgo(oneDayAgo)).toBe('1 day ago');
  });

  it('should return months for timestamps within the year', () => {
    const twoMonthsAgo = new Date('2024-11-15T12:00:00Z').toISOString();
    expect(getTimeAgo(twoMonthsAgo)).toBe('2 months ago');
  });

  it('should return "1 month ago" for singular month', () => {
    const oneMonthAgo = new Date('2024-12-15T12:00:00Z').toISOString();
    expect(getTimeAgo(oneMonthAgo)).toBe('1 month ago');
  });

  it('should return years for old timestamps', () => {
    const twoYearsAgo = new Date('2023-01-15T12:00:00Z').toISOString();
    expect(getTimeAgo(twoYearsAgo)).toBe('2 years ago');
  });

  it('should handle compact date format like "20240919T102005"', () => {
    // This is AlphaVantage format, should be parsed correctly
    const result = getTimeAgo('20240919T102005');
    expect(typeof result).toBe('string');
    expect(result).toMatch(/ago|seconds/);
  });
});

describe('normalizeDate', () => {
  it('should convert timestamp to YYYY-MM-DD format', () => {
    const timestamp = new Date('2025-03-15T12:30:00Z').getTime();
    expect(normalizeDate(timestamp)).toBe('2025-03-15');
  });

  it('should handle epoch (0)', () => {
    expect(normalizeDate(0)).toBe('1970-01-01');
  });

  it('should handle negative timestamp (before epoch)', () => {
    const result = normalizeDate(-86400000); // One day before epoch
    expect(result).toBe('1969-12-31');
  });

  it('should produce consistent format regardless of time', () => {
    const morning = new Date('2025-01-01T06:00:00Z').getTime();
    const evening = new Date('2025-01-01T18:00:00Z').getTime();

    expect(normalizeDate(morning)).toBe('2025-01-01');
    expect(normalizeDate(evening)).toBe('2025-01-01');
  });

  it('should handle millisecond precision timestamps', () => {
    const timestamp = 1735689600000; // 2025-01-01 00:00:00 UTC
    const result = normalizeDate(timestamp);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('calculateTimeRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should calculate 1 day range', () => {
    const result = calculateTimeRange('1d');
    expect(result).toBe('2025-06-14');
  });

  it('should calculate 3 day range', () => {
    const result = calculateTimeRange('3d');
    expect(result).toBe('2025-06-12');
  });

  it('should calculate 1 week range', () => {
    const result = calculateTimeRange('1w');
    expect(result).toBe('2025-06-08');
  });

  it('should calculate 1 month range', () => {
    const result = calculateTimeRange('1m');
    expect(result).toBe('2025-05-15');
  });

  it('should calculate 3 month range', () => {
    const result = calculateTimeRange('3m');
    expect(result).toBe('2025-03-15');
  });

  it('should calculate 1 year range', () => {
    const result = calculateTimeRange('1y');
    expect(result).toBe('2024-06-15');
  });

  it('should throw for invalid range', () => {
    expect(() => calculateTimeRange('5y')).toThrow('Invalid range: 5y');
  });

  it('should throw for empty string', () => {
    expect(() => calculateTimeRange('')).toThrow('Invalid range:');
  });

  it('should return date in YYYY-MM-DD format', () => {
    const result = calculateTimeRange('1d');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('calculateDaysLeft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should calculate days left for accounts created after cutoff', () => {
    // Cutoff is 2023-10-17, account created after
    vi.setSystemTime(new Date('2023-11-01T12:00:00Z'));
    const accountCreation = new Date('2023-10-20T00:00:00Z');
    const result = calculateDaysLeft(accountCreation);

    // 14 days from Oct 20 = Nov 3, current = Nov 1 at noon
    // diffInMilliseconds = (Nov 3 00:00 - Nov 1 12:00) = 1.5 days -> ceil = 2
    expect(result).toBe(2);
  });

  it('should use 30-day period for accounts before cutoff', () => {
    vi.setSystemTime(new Date('2023-10-20T00:00:00Z'));
    const accountCreation = new Date('2023-09-15T00:00:00Z');
    const result = calculateDaysLeft(accountCreation);

    // For pre-cutoff, date is set to Oct 1 + 30 = Oct 31
    // Current is Oct 20, so 11 days left
    expect(result).toBe(11);
  });

  it('should return negative values for expired periods', () => {
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const accountCreation = new Date('2023-11-01T00:00:00Z');
    const result = calculateDaysLeft(accountCreation);

    // 14 days from Nov 1 = Nov 15, current is Jan 1, so expired
    expect(result).toBeLessThan(0);
  });
});

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "Just now" for undefined input', () => {
    expect(timeAgo(undefined)).toBe('Just now');
  });

  it('should return "Just now" for very recent timestamps', () => {
    const recent = new Date('2025-06-15T11:59:30Z');
    expect(timeAgo(recent)).toBe('Just now');
  });

  it('should return formatted time for mid-range timestamps', () => {
    // 2 hours ago
    const twoHoursAgo = new Date('2025-06-15T10:00:00Z');
    const result = timeAgo(twoHoursAgo);
    expect(result).toMatch(/ago/);
  });

  it('should return formatted date for old timestamps (>23 hours)', () => {
    const yesterday = new Date('2025-06-14T00:00:00Z');
    const result = timeAgo(yesterday);

    // Should return formatted date like "Jun 14"
    expect(result).toMatch(/Jun/);
  });

  it('should include year for dates from different year', () => {
    const lastYear = new Date('2024-06-15T00:00:00Z');
    const result = timeAgo(lastYear);

    // Should include the year
    expect(result).toMatch(/2024/);
  });
});

describe('formatDate', () => {
  it('should format date string to human readable format', () => {
    const result = formatDate('2025-01-15');
    expect(result).toMatch(/January/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/2025/);
  });

  it('should format ISO date string', () => {
    const result = formatDate('2025-06-01T12:00:00Z');
    expect(result).toMatch(/June/);
    expect(result).toMatch(/1/);
  });

  it('should omit year for current year when updateDate is true', () => {
    const currentYear = new Date().getFullYear();
    const dateStr = `${currentYear}-03-15T00:00:00Z`;
    const result = formatDate(dateStr, true);

    // When updateDate is true and same year, year should be omitted
    expect(result).toMatch(/March/);
    expect(result).toMatch(/15/);
  });

  it('should include year for different year even with updateDate', () => {
    const result = formatDate('2020-03-15T00:00:00Z', true);

    expect(result).toMatch(/2020/);
  });
});

describe('formatDateToString', () => {
  it('should include weekday, month, day, year, and time', () => {
    const date = new Date('2025-01-15T14:30:45Z');
    const result = formatDateToString(date);

    // Should contain "at" separator between date and time
    expect(result).toContain(', at ');
    // Should have date components
    expect(result).toMatch(/\w+, \w+ \d+, \d{4}/);
    // Should have time in HH:MM:SS format
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('should use 24-hour time format', () => {
    const date = new Date('2025-01-15T23:45:00Z');
    const result = formatDateToString(date);

    // Should not contain AM/PM
    expect(result).not.toMatch(/AM|PM/i);
  });
});

describe('formatToUSEastern', () => {
  it('should format date in Eastern time', () => {
    const date = new Date('2025-01-15T17:00:00Z');
    const result = formatToUSEastern(date);

    // Should contain month, day, year and time
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/2025/);
  });

  it('should omit time when justDate is true', () => {
    const date = new Date('2025-01-15T17:00:00Z');
    const resultWithTime = formatToUSEastern(date);
    const resultDateOnly = formatToUSEastern(date, true);

    // Date-only should be shorter (no time component)
    expect(resultDateOnly.length).toBeLessThanOrEqual(resultWithTime.length);
  });

  it('should include AM/PM when time is shown', () => {
    const date = new Date('2025-01-15T17:00:00Z');
    const result = formatToUSEastern(date);

    expect(result).toMatch(/AM|PM/);
  });
});

describe('unixTimetoUSEastern', () => {
  it('should return date, timeString, and dateString', () => {
    const timestamp = new Date('2025-01-15T17:00:00Z').getTime();
    const result = unixTimetoUSEastern(timestamp);

    expect(result.date).toBeInstanceOf(Date);
    expect(typeof result.timeString).toBe('string');
    expect(typeof result.dateString).toBe('string');
  });

  it('should have dateString shorter than or equal to timeString', () => {
    const timestamp = new Date('2025-06-15T12:00:00Z').getTime();
    const result = unixTimetoUSEastern(timestamp);

    expect(result.dateString.length).toBeLessThanOrEqual(result.timeString.length);
  });

  it('should preserve the original timestamp in the date object', () => {
    const timestamp = 1705341600000;
    const result = unixTimetoUSEastern(timestamp);

    expect(result.date.getTime()).toBe(timestamp);
  });
});

describe('timeDiffString', () => {
  it('should format milliseconds to human readable string', () => {
    // 1 day, 2 hours, 30 minutes
    const ms = (24 * 60 + 2 * 60 + 30) * 60 * 1000;
    const result = timeDiffString(ms);

    expect(result).toBe('1 day, 2 hours, 30 minutes');
  });

  it('should handle singular forms', () => {
    // 1 day, 1 hour, 1 minute
    const ms = (24 * 60 + 60 + 1) * 60 * 1000;
    const result = timeDiffString(ms);

    expect(result).toBe('1 day, 1 hour, 1 minute');
  });

  it('should handle zero milliseconds', () => {
    const result = timeDiffString(0);
    expect(result).toBe('');
  });

  it('should handle only minutes', () => {
    const ms = 15 * 60 * 1000;
    const result = timeDiffString(ms);

    expect(result).toBe('15 minutes');
  });

  it('should handle only hours', () => {
    const ms = 3 * 60 * 60 * 1000;
    const result = timeDiffString(ms);

    expect(result).toBe('3 hours');
  });

  it('should handle only days', () => {
    const ms = 5 * 24 * 60 * 60 * 1000;
    const result = timeDiffString(ms);

    expect(result).toBe('5 days');
  });

  it('should handle days and hours without minutes', () => {
    const ms = (24 * 60 + 3 * 60) * 60 * 1000;
    const result = timeDiffString(ms);

    expect(result).toBe('1 day, 3 hours');
  });

  it('should handle less than a minute', () => {
    const result = timeDiffString(30000); // 30 seconds
    expect(result).toBe('');
  });

  it('should handle large durations', () => {
    const ms = 100 * 24 * 60 * 60 * 1000; // 100 days
    const result = timeDiffString(ms);

    expect(result).toBe('100 days');
  });

  it('should not show seconds', () => {
    const ms = 90 * 1000; // 90 seconds = 1 minute
    const result = timeDiffString(ms);

    expect(result).toBe('1 minute');
    expect(result).not.toMatch(/second/);
  });
});
