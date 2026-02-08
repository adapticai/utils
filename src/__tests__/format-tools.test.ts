import { describe, it, expect } from 'vitest';
import {
  capitalize,
  formatEnum,
  formatCurrency,
  formatNumber,
  formatPercentage,
  dateTimeForGS,
} from '../format-tools';

describe('capitalize', () => {
  it('should capitalize first letter of a lowercase string', () => {
    expect(capitalize('hello')).toBe('Hello');
  });

  it('should return same string if already capitalized', () => {
    expect(capitalize('Hello')).toBe('Hello');
  });

  it('should handle single character string', () => {
    expect(capitalize('a')).toBe('A');
  });

  it('should handle already uppercase string', () => {
    expect(capitalize('HELLO')).toBe('HELLO');
  });

  it('should return empty string unchanged', () => {
    expect(capitalize('')).toBe('');
  });

  it('should return undefined/null input unchanged', () => {
    // @ts-expect-error Testing null input
    expect(capitalize(null)).toBeNull();
    // @ts-expect-error Testing undefined input
    expect(capitalize(undefined)).toBeUndefined();
  });

  it('should handle strings with leading spaces', () => {
    expect(capitalize(' hello')).toBe(' hello');
  });

  it('should handle strings with numbers', () => {
    expect(capitalize('123abc')).toBe('123abc');
  });

  it('should handle strings with special characters', () => {
    expect(capitalize('!hello')).toBe('!hello');
  });

  it('should handle multi-word strings (only first letter)', () => {
    expect(capitalize('hello world')).toBe('Hello world');
  });
});

describe('formatEnum', () => {
  it('should convert SCREAMING_SNAKE_CASE to Title Case', () => {
    expect(formatEnum('STOCK_TICKER')).toBe('Stock Ticker');
  });

  it('should handle single word', () => {
    expect(formatEnum('STOCK')).toBe('Stock');
  });

  it('should handle multiple underscores', () => {
    expect(formatEnum('VERY_LONG_ENUM_VALUE')).toBe('Very Long Enum Value');
  });

  it('should return empty string for empty input', () => {
    expect(formatEnum('')).toBe('');
  });

  it('should return empty string for undefined-like input', () => {
    // @ts-expect-error Testing falsy input
    expect(formatEnum(null)).toBe('');
    // @ts-expect-error Testing falsy input
    expect(formatEnum(undefined)).toBe('');
  });

  it('should handle lowercase input', () => {
    expect(formatEnum('hello_world')).toBe('Hello World');
  });

  it('should handle mixed case input', () => {
    expect(formatEnum('HeLLo_WoRLd')).toBe('Hello World');
  });

  it('should handle single underscore-separated letters', () => {
    expect(formatEnum('A_B_C')).toBe('A B C');
  });

  it('should handle trailing underscore', () => {
    expect(formatEnum('HELLO_')).toBe('Hello ');
  });

  it('should handle leading underscore', () => {
    expect(formatEnum('_HELLO')).toBe(' Hello');
  });
});

describe('formatCurrency', () => {
  it('should format positive amounts with dollar sign', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('should format zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('should format negative amounts', () => {
    const result = formatCurrency(-1234.56);
    // Different implementations may use different minus signs
    expect(result).toMatch(/[-−]?\$1,234\.56/);
  });

  it('should return $0.00 for NaN', () => {
    expect(formatCurrency(NaN)).toBe('$0.00');
  });

  it('should format large numbers with commas', () => {
    expect(formatCurrency(1000000)).toBe('$1,000,000.00');
  });

  it('should format small decimals', () => {
    expect(formatCurrency(0.01)).toBe('$0.01');
  });

  it('should handle very small amounts', () => {
    expect(formatCurrency(0.001)).toBe('$0.00');
  });

  it('should format whole numbers with .00', () => {
    expect(formatCurrency(100)).toBe('$100.00');
  });

  it('should handle single decimal place by rounding', () => {
    expect(formatCurrency(99.5)).toBe('$99.50');
  });

  it('should handle three decimal places by rounding', () => {
    expect(formatCurrency(99.999)).toBe('$100.00');
  });
});

describe('formatNumber', () => {
  it('should format integers with commas', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('should format zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('should return "0" for NaN', () => {
    expect(formatNumber(NaN)).toBe('0');
  });

  it('should format decimals', () => {
    const result = formatNumber(1234.56);
    expect(result).toMatch(/1,234\.56/);
  });

  it('should format negative numbers', () => {
    const result = formatNumber(-1234);
    expect(result).toMatch(/[-−]1,234/);
  });

  it('should handle small numbers without commas', () => {
    expect(formatNumber(999)).toBe('999');
  });

  it('should handle very large numbers', () => {
    const result = formatNumber(1000000000);
    expect(result).toBe('1,000,000,000');
  });
});

describe('formatPercentage', () => {
  it('should format decimal as percentage', () => {
    expect(formatPercentage(0.75)).toBe('75.00%');
  });

  it('should format zero', () => {
    expect(formatPercentage(0)).toBe('0.00%');
  });

  it('should return "0%" for NaN', () => {
    expect(formatPercentage(NaN)).toBe('0%');
  });

  it('should format 100% correctly', () => {
    expect(formatPercentage(1)).toBe('100.00%');
  });

  it('should handle values greater than 100%', () => {
    expect(formatPercentage(1.5)).toBe('150.00%');
  });

  it('should respect custom decimal places', () => {
    expect(formatPercentage(0.753, 1)).toBe('75.3%');
  });

  it('should handle zero decimal places', () => {
    expect(formatPercentage(0.753, 0)).toBe('75%');
  });

  it('should handle negative percentages', () => {
    const result = formatPercentage(-0.25);
    expect(result).toMatch(/[-−]25\.00%/);
  });

  it('should format small percentages', () => {
    expect(formatPercentage(0.001)).toBe('0.10%');
  });

  it('should format very small percentages with precision', () => {
    expect(formatPercentage(0.0001, 4)).toBe('0.0100%');
  });
});

describe('dateTimeForGS', () => {
  it('should format date in Australian format for Google Sheets', () => {
    // Use a fixed date to avoid timezone issues in test
    const date = new Date('2025-01-15T12:34:56Z');
    const result = dateTimeForGS(date);

    // Should contain DD/MM/YYYY and HH:MM:SS
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('should format midnight correctly', () => {
    const date = new Date('2025-06-01T00:00:00Z');
    const result = dateTimeForGS(date);

    // Should still produce valid format
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('should handle end of year date', () => {
    const date = new Date('2025-12-31T23:59:59Z');
    const result = dateTimeForGS(date);

    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
