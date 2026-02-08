import { describe, it, expect } from 'vitest';
import { hideApiKeyFromurl } from '../misc-utils';

describe('hideApiKeyFromurl', () => {
  it('should mask apiKey parameter in URL', () => {
    const url = 'https://api.example.com/data?apiKey=12341239856677';
    const result = hideApiKeyFromurl(url);

    expect(result).toContain('apiKey=12****77');
    expect(result).not.toContain('12341239856677');
  });

  it('should handle case-insensitive apiKey', () => {
    const url = 'https://api.example.com/data?APIKEY=12341239856677';
    // The function checks for case-insensitive 'apikey'
    const result = hideApiKeyFromurl(url);

    // The key match is case-insensitive, but it preserves the original parameter name
    expect(result).not.toContain('12341239856677');
  });

  it('should preserve other query parameters', () => {
    const url = 'https://api.example.com/data?symbol=AAPL&apiKey=12341239856677&limit=10';
    const result = hideApiKeyFromurl(url);

    expect(result).toContain('symbol=AAPL');
    expect(result).toContain('limit=10');
    expect(result).not.toContain('12341239856677');
  });

  it('should handle URL without apiKey parameter', () => {
    const url = 'https://api.example.com/data?symbol=AAPL';
    const result = hideApiKeyFromurl(url);

    expect(result).toContain('symbol=AAPL');
  });

  it('should handle short API key (<= 4 characters)', () => {
    const url = 'https://api.example.com/data?apiKey=AB';
    const result = hideApiKeyFromurl(url);

    expect(result).toContain('apiKey=AB');
  });

  it('should handle URL with no query parameters', () => {
    const url = 'https://api.example.com/data';
    const result = hideApiKeyFromurl(url);

    expect(result).toBe('https://api.example.com/data');
  });

  it('should return original string for invalid URL', () => {
    const url = 'not-a-valid-url';
    const result = hideApiKeyFromurl(url);

    expect(result).toBe('not-a-valid-url');
  });

  it('should handle URL with empty apiKey value', () => {
    const url = 'https://api.example.com/data?apiKey=';
    const result = hideApiKeyFromurl(url);

    expect(result).toContain('apiKey=');
  });

  it('should handle URL with path segments', () => {
    const url = 'https://api.example.com/v1/stocks/AAPL?apiKey=ABCDEFGHIJ123456';
    const result = hideApiKeyFromurl(url);

    expect(result).toContain('/v1/stocks/AAPL');
    expect(result).not.toContain('ABCDEFGHIJ123456');
    expect(result).toContain('AB****56');
  });

  it('should handle exactly 4 character apiKey', () => {
    const url = 'https://api.example.com?apiKey=ABCD';
    const result = hideApiKeyFromurl(url);

    // Keys <= 4 chars are returned as-is
    expect(result).toContain('apiKey=ABCD');
  });

  it('should handle 5 character apiKey (masking applied)', () => {
    const url = 'https://api.example.com?apiKey=ABCDE';
    const result = hideApiKeyFromurl(url);

    // Should mask: AB****DE
    expect(result).toContain('AB****DE');
  });
});
