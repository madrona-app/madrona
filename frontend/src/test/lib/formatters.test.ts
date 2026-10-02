import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDateShort,
  formatDateLong,
  formatDateMonth,
  formatDateTime,
  formatTime,
  formatNumber,
  formatCurrency,
  formatRelativeTime,
} from '../../lib/formatters';

describe('formatters', () => {
  describe('formatDateShort', () => {
    it('returns em dash for null/undefined', () => {
      expect(formatDateShort(null)).toBe('—');
      expect(formatDateShort(undefined)).toBe('—');
      expect(formatDateShort('')).toBe('—');
    });

    it('formats a Date instance with en-US locale', () => {
      const d = new Date('2026-03-28T12:00:00Z');
      const result = formatDateShort(d, 'en-US');
      expect(result).toContain('2026');
      expect(result).toContain('Mar');
    });

    it('formats a string date with en-US locale', () => {
      const result = formatDateShort('2026-03-28T12:00:00Z', 'en-US');
      expect(result).toContain('2026');
      expect(result).toContain('Mar');
    });

    it('handles invalid date strings gracefully', () => {
      // Invalid Date returns "Invalid Date" from toLocaleDateString
      const result = formatDateShort('not-a-date', 'en-US');
      expect(typeof result).toBe('string');
    });
  });

  describe('formatDateLong', () => {
    it('returns em dash for null', () => {
      expect(formatDateLong(null)).toBe('—');
    });

    it('produces long month format with en-US', () => {
      const result = formatDateLong('2026-03-28T12:00:00Z', 'en-US');
      expect(result).toContain('March');
      expect(result).toContain('2026');
    });
  });

  describe('formatDateMonth', () => {
    it('returns em dash for null', () => {
      expect(formatDateMonth(null)).toBe('—');
    });

    it('formats month + year only', () => {
      const result = formatDateMonth('2026-03-28T12:00:00Z', 'en-US');
      expect(result).toContain('Mar');
      expect(result).toContain('2026');
      expect(result).not.toContain('28');
    });
  });

  describe('formatDateTime', () => {
    it('returns em dash for null', () => {
      expect(formatDateTime(null)).toBe('—');
    });

    it('formats date with time for en-US', () => {
      const result = formatDateTime('2026-03-28T14:30:00Z', 'en-US');
      expect(result).toContain('2026');
      expect(result).toMatch(/\d+:\d{2}/);
    });
  });

  describe('formatTime', () => {
    it('returns em dash for null', () => {
      expect(formatTime(null)).toBe('—');
    });

    it('formats just the time portion', () => {
      const result = formatTime('2026-03-28T14:30:00Z', 'en-US');
      expect(result).toMatch(/\d+:\d{2}/);
      // Should not include year
      expect(result).not.toContain('2026');
    });
  });

  describe('formatNumber', () => {
    it('returns em dash for null/undefined', () => {
      expect(formatNumber(null)).toBe('—');
      expect(formatNumber(undefined)).toBe('—');
    });

    it('formats zero', () => {
      expect(formatNumber(0, 'en-US')).toBe('0');
    });

    it('formats integer with thousands separator in en-US', () => {
      expect(formatNumber(1234, 'en-US')).toBe('1,234');
      expect(formatNumber(1000000, 'en-US')).toBe('1,000,000');
    });

    it('formats with different locale separators (de-DE uses period)', () => {
      const result = formatNumber(1234, 'de-DE');
      // de-DE uses '.' as thousands separator
      expect(result).toMatch(/1\.234|1\s234/);
    });

    it('formats negative numbers', () => {
      expect(formatNumber(-42, 'en-US')).toBe('-42');
    });
  });

  describe('formatCurrency', () => {
    it('returns em dash for null/undefined', () => {
      expect(formatCurrency(null)).toBe('—');
      expect(formatCurrency(undefined)).toBe('—');
    });

    it('formats USD by default', () => {
      const result = formatCurrency(1234.5, 'USD', 2, 'en-US');
      expect(result).toContain('$');
      expect(result).toContain('1,234.50');
    });

    it('formats with zero decimals', () => {
      const result = formatCurrency(1234, 'USD', 0, 'en-US');
      expect(result).toBe('$1,234');
    });

    it('formats different currencies', () => {
      const eur = formatCurrency(1234, 'EUR', 2, 'en-US');
      expect(eur).toContain('€');
    });

    it('handles zero', () => {
      const result = formatCurrency(0, 'USD', 2, 'en-US');
      expect(result).toBe('$0.00');
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-28T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "Never" for null/undefined', () => {
      expect(formatRelativeTime(null)).toBe('Never');
      expect(formatRelativeTime(undefined)).toBe('Never');
    });

    it('returns "Just now" for times within the last minute', () => {
      expect(formatRelativeTime('2026-03-28T11:59:30Z')).toBe('Just now');
    });

    it('returns "1 minute ago" singular', () => {
      expect(formatRelativeTime('2026-03-28T11:59:00Z')).toBe('1 minute ago');
    });

    it('returns "N minutes ago" plural', () => {
      expect(formatRelativeTime('2026-03-28T11:55:00Z')).toBe('5 minutes ago');
    });

    it('returns "1 hour ago" singular', () => {
      expect(formatRelativeTime('2026-03-28T11:00:00Z')).toBe('1 hour ago');
    });

    it('returns "N hours ago" plural', () => {
      expect(formatRelativeTime('2026-03-28T09:00:00Z')).toBe('3 hours ago');
    });

    it('returns "1 day ago" singular', () => {
      expect(formatRelativeTime('2026-03-27T12:00:00Z')).toBe('1 day ago');
    });

    it('returns "N days ago" plural', () => {
      expect(formatRelativeTime('2026-03-25T12:00:00Z')).toBe('3 days ago');
    });

    it('falls back to formatted date for times more than a week ago', () => {
      const result = formatRelativeTime('2026-03-01T12:00:00Z', 'en-US');
      expect(result).not.toContain('ago');
      expect(result).toContain('2026');
    });

    it('accepts Date objects', () => {
      const d = new Date('2026-03-28T11:30:00Z');
      expect(formatRelativeTime(d)).toBe('30 minutes ago');
    });
  });
});
