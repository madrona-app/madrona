import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatRelativeTime,
  formatDuration,
  getStatusLabel,
  isTerminalStatus,
  getStatusColor,
} from '../../lib/utils';

describe('utils', () => {
  describe('formatRelativeTime', () => {
    beforeEach(() => {
      // Mock Date.now() to have consistent test results
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "Never" for null or undefined', () => {
      expect(formatRelativeTime(null)).toBe('Never');
      expect(formatRelativeTime(undefined)).toBe('Never');
    });

    it('returns "Just now" for timestamps less than 60 seconds ago', () => {
      expect(formatRelativeTime('2024-01-15T11:59:30Z')).toBe('Just now');
      expect(formatRelativeTime('2024-01-15T11:59:50Z')).toBe('Just now');
    });

    it('returns minutes ago for timestamps less than 1 hour ago', () => {
      expect(formatRelativeTime('2024-01-15T11:59:00Z')).toBe('1 minute ago');
      expect(formatRelativeTime('2024-01-15T11:55:00Z')).toBe('5 minutes ago');
      expect(formatRelativeTime('2024-01-15T11:30:00Z')).toBe('30 minutes ago');
    });

    it('returns hours ago for timestamps less than 24 hours ago', () => {
      expect(formatRelativeTime('2024-01-15T11:00:00Z')).toBe('1 hour ago');
      expect(formatRelativeTime('2024-01-15T06:00:00Z')).toBe('6 hours ago');
      expect(formatRelativeTime('2024-01-14T13:00:00Z')).toBe('23 hours ago');
    });

    it('returns days ago for timestamps less than 7 days ago', () => {
      expect(formatRelativeTime('2024-01-14T12:00:00Z')).toBe('1 day ago');
      expect(formatRelativeTime('2024-01-12T12:00:00Z')).toBe('3 days ago');
      expect(formatRelativeTime('2024-01-09T12:00:00Z')).toBe('6 days ago');
    });

    it('returns formatted date for timestamps more than 7 days ago', () => {
      const result = formatRelativeTime('2024-01-01T12:00:00Z');
      // Should return a locale date string - just check it's not a relative time
      expect(result).not.toContain('ago');
      expect(result).not.toBe('Just now');
    });
  });

  describe('formatDuration', () => {
    it('returns "—" for null or undefined', () => {
      expect(formatDuration(null)).toBe('—');
      expect(formatDuration(undefined)).toBe('—');
      expect(formatDuration(0)).toBe('—');
    });

    it('formats seconds correctly', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(30000)).toBe('30s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('formats minutes and seconds correctly', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(120000)).toBe('2m 0s');
      expect(formatDuration(3599000)).toBe('59m 59s');
    });

    it('formats hours and minutes correctly', () => {
      expect(formatDuration(3600000)).toBe('1h 0m');
      expect(formatDuration(5400000)).toBe('1h 30m');
      expect(formatDuration(7200000)).toBe('2h 0m');
      expect(formatDuration(7260000)).toBe('2h 1m');
    });
  });

  describe('getStatusLabel', () => {
    it('returns "All set" for success', () => {
      expect(getStatusLabel('success')).toBe('All set');
    });

    it('returns "Syncing…" for running and publishing', () => {
      expect(getStatusLabel('running')).toBe('Syncing…');
      expect(getStatusLabel('publishing')).toBe('Syncing…');
    });

    it('returns "Needs attention" for failed statuses', () => {
      expect(getStatusLabel('failed')).toBe('Needs attention');
      expect(getStatusLabel('failed_publish')).toBe('Needs attention');
      expect(getStatusLabel('failed_finalize')).toBe('Needs attention');
    });

    it('returns "Queued" for pending and queued', () => {
      expect(getStatusLabel('pending')).toBe('Queued');
      expect(getStatusLabel('queued')).toBe('Queued');
    });

    it('returns "Completed with warnings" for warning', () => {
      expect(getStatusLabel('warning')).toBe('Completed with warnings');
    });

    it('returns "Canceled" for canceled', () => {
      expect(getStatusLabel('canceled')).toBe('Canceled');
    });

    it('returns original status for unknown statuses', () => {
      expect(getStatusLabel('unknown')).toBe('unknown');
      expect(getStatusLabel('custom_status')).toBe('custom_status');
    });
  });

  describe('isTerminalStatus', () => {
    it('returns true for terminal statuses', () => {
      expect(isTerminalStatus('success')).toBe(true);
      expect(isTerminalStatus('failed')).toBe(true);
      expect(isTerminalStatus('failed_publish')).toBe(true);
      expect(isTerminalStatus('failed_finalize')).toBe(true);
      expect(isTerminalStatus('warning')).toBe(true);
      expect(isTerminalStatus('canceled')).toBe(true);
    });

    it('returns false for non-terminal statuses', () => {
      expect(isTerminalStatus('running')).toBe(false);
      expect(isTerminalStatus('pending')).toBe(false);
      expect(isTerminalStatus('queued')).toBe(false);
      expect(isTerminalStatus('publishing')).toBe(false);
    });
  });

  describe('getStatusColor', () => {
    it('returns "green" for success', () => {
      expect(getStatusColor('success')).toBe('green');
    });

    it('returns "blue" for running statuses', () => {
      expect(getStatusColor('running')).toBe('blue');
      expect(getStatusColor('publishing')).toBe('blue');
      expect(getStatusColor('pending')).toBe('blue');
      expect(getStatusColor('queued')).toBe('blue');
    });

    it('returns "red" for failed statuses', () => {
      expect(getStatusColor('failed')).toBe('red');
      expect(getStatusColor('failed_publish')).toBe('red');
      expect(getStatusColor('failed_finalize')).toBe('red');
    });

    it('returns "yellow" for warning', () => {
      expect(getStatusColor('warning')).toBe('yellow');
    });

    it('returns "gray" for canceled', () => {
      expect(getStatusColor('canceled')).toBe('gray');
    });

    it('returns "gray" for unknown statuses', () => {
      expect(getStatusColor('unknown')).toBe('gray');
    });
  });
});
