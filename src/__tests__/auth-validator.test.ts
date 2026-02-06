import { describe, it, expect } from 'vitest';
import {
  validateAlpacaCredentials,
  validatePolygonApiKey,
  validateAlphaVantageApiKey,
} from '../utils/auth-validator';

describe('Auth Validator', () => {
  describe('validateAlpacaCredentials', () => {
    it('should pass for valid credentials', () => {
      expect(() =>
        validateAlpacaCredentials({
          apiKey: 'VALID_API_KEY_12345',
          apiSecret: 'VALID_SECRET_KEY_12345',
          isPaper: true,
        })
      ).not.toThrow();
    });

    it('should throw for empty apiKey', () => {
      expect(() =>
        validateAlpacaCredentials({
          apiKey: '',
          apiSecret: 'VALID_SECRET_KEY',
          isPaper: true,
        })
      ).toThrow('Invalid Alpaca API key: must be a non-empty string');
    });

    it('should throw for empty apiSecret', () => {
      expect(() =>
        validateAlpacaCredentials({
          apiKey: 'VALID_API_KEY',
          apiSecret: '',
          isPaper: true,
        })
      ).toThrow('Invalid Alpaca API secret: must be a non-empty string');
    });

    it('should throw for short apiKey', () => {
      expect(() =>
        validateAlpacaCredentials({
          apiKey: 'SHORT',
          apiSecret: 'VALID_SECRET_KEY',
          isPaper: true,
        })
      ).toThrow('Alpaca API key appears to be too short');
    });

    it('should throw for whitespace-only apiKey', () => {
      expect(() =>
        validateAlpacaCredentials({
          apiKey: '   ',
          apiSecret: 'VALID_SECRET_KEY',
          isPaper: true,
        })
      ).toThrow('Invalid Alpaca API key: must be a non-empty string');
    });
  });

  describe('validatePolygonApiKey', () => {
    it('should pass for valid API key', () => {
      expect(() => validatePolygonApiKey('VALID_POLYGON_KEY')).not.toThrow();
    });

    it('should throw for empty API key', () => {
      expect(() => validatePolygonApiKey('')).toThrow('Invalid Polygon API key: must be a non-empty string');
    });

    it('should throw for whitespace-only API key', () => {
      expect(() => validatePolygonApiKey('   ')).toThrow('Invalid Polygon API key: must be a non-empty string');
    });
  });

  describe('validateAlphaVantageApiKey', () => {
    it('should pass for valid API key', () => {
      expect(() => validateAlphaVantageApiKey('VALID_AV_KEY')).not.toThrow();
    });

    it('should throw for empty API key', () => {
      expect(() => validateAlphaVantageApiKey('')).toThrow(
        'Invalid Alpha Vantage API key: must be a non-empty string'
      );
    });

    it('should throw for whitespace-only API key', () => {
      expect(() => validateAlphaVantageApiKey('   ')).toThrow(
        'Invalid Alpha Vantage API key: must be a non-empty string'
      );
    });
  });
});
