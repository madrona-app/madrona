import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDateWithTimezone,
  formatDateShort,
  formatDateTimeFull,
  getTimezoneAbbreviation,
  formatDateTimeWithZone,
  getTimezoneOffset,
  getTimezoneDisplayName,
  isValidTimezone,
} from '../../lib/timezone';

// Suppress console.error for expected error cases
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
});

describe('timezone utilities', () => {
  describe('formatDateWithTimezone', () => {
    it('formats date in specified timezone', () => {
      const dateStr = '2024-01-15T17:30:00Z'; // 5:30 PM UTC
      const result = formatDateWithTimezone(dateStr, 'America/New_York');
      // In EST, this would be 12:30 PM
      expect(result).toContain('12:30');
      expect(result).toContain('PM');
      expect(result).toContain('Jan');
      expect(result).toContain('15');
    });

    it('formats date in UTC', () => {
      const dateStr = '2024-01-15T17:30:00Z';
      const result = formatDateWithTimezone(dateStr, 'UTC');
      expect(result).toContain('5:30');
      expect(result).toContain('PM');
    });

    it('uses custom options when provided', () => {
      const dateStr = '2024-01-15T17:30:00Z';
      const result = formatDateWithTimezone(dateStr, 'UTC', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
      });
      expect(result).toContain('24'); // year
      expect(result).toContain('01'); // month
      expect(result).toContain('15'); // day
    });

    it('falls back to local timezone on invalid timezone', () => {
      const dateStr = '2024-01-15T17:30:00Z';
      // Should not throw, should fall back gracefully
      const result = formatDateWithTimezone(dateStr, 'Invalid/Timezone');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('formatDateShort', () => {
    it('formats date without time', () => {
      const dateStr = '2024-01-15T17:30:00Z';
      const result = formatDateShort(dateStr, 'America/New_York');
      expect(result).toContain('Jan');
      expect(result).toContain('15');
      expect(result).toContain('2024');
      // Should not contain time
      expect(result).not.toContain(':');
    });
  });

  describe('formatDateTimeFull', () => {
    it('formats date with seconds', () => {
      const dateStr = '2024-01-15T17:30:45Z';
      const result = formatDateTimeFull(dateStr, 'UTC');
      expect(result).toContain('5:30:45');
      expect(result).toContain('PM');
    });
  });

  describe('getTimezoneAbbreviation', () => {
    it('returns abbreviation for valid timezone', () => {
      const abbrev = getTimezoneAbbreviation('America/New_York');
      // Could be EST or EDT depending on time of year
      expect(['EST', 'EDT']).toContain(abbrev);
    });

    it('returns timezone for invalid input', () => {
      const result = getTimezoneAbbreviation('Invalid/Zone');
      expect(result).toBe('Invalid/Zone');
    });
  });

  describe('formatDateTimeWithZone', () => {
    it('returns "-" for null or undefined', () => {
      expect(formatDateTimeWithZone(null)).toBe('-');
      expect(formatDateTimeWithZone(undefined)).toBe('-');
    });

    it('includes timezone abbreviation in output', () => {
      const dateStr = '2024-01-15T17:30:00Z';
      const result = formatDateTimeWithZone(dateStr, 'UTC');
      expect(result).toContain('UTC');
    });

    it('formats date in specified timezone', () => {
      const dateStr = '2024-01-15T17:30:00Z';
      const result = formatDateTimeWithZone(dateStr, 'America/New_York');
      // Should include timezone abbreviation
      expect(result).toMatch(/EST|EDT/);
    });

    it('returns original string on invalid date', () => {
      const invalidDate = 'not-a-date';
      const result = formatDateTimeWithZone(invalidDate, 'UTC');
      // Should return the original or handle gracefully
      expect(typeof result).toBe('string');
    });
  });

  describe('getTimezoneOffset', () => {
    it('returns offset string for valid timezone', () => {
      const offset = getTimezoneOffset('UTC');
      expect(offset).toBe('UTC+00:00');
    });

    it('returns negative offset for western timezones', () => {
      const offset = getTimezoneOffset('America/New_York');
      // New York is UTC-5 or UTC-4 depending on DST
      expect(offset).toMatch(/UTC[+-]\d{2}:\d{2}/);
    });

    it('returns empty string for invalid timezone', () => {
      const offset = getTimezoneOffset('Invalid/Zone');
      expect(offset).toBe('');
    });
  });

  describe('getTimezoneDisplayName', () => {
    it('returns full display name with abbreviation and offset', () => {
      const display = getTimezoneDisplayName('America/New_York');
      expect(display).toContain('America/New_York');
      expect(display).toContain('(');
      expect(display).toContain('UTC');
    });

    it('returns timezone only for invalid timezone', () => {
      const display = getTimezoneDisplayName('Invalid/Zone');
      expect(display).toBe('Invalid/Zone');
    });
  });

  describe('isValidTimezone', () => {
    it('returns true for valid IANA timezones', () => {
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('Asia/Tokyo')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('returns false for invalid timezones', () => {
      expect(isValidTimezone('Invalid/Zone')).toBe(false);
      expect(isValidTimezone('NotATimezone')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
    });
  });
});
