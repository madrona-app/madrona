import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTimezone } from '../../hooks/useTimezone';

// Mock useAuth
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../hooks/useAuth';

describe('useTimezone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('timezone value', () => {
    it('returns user timezone when available', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: '1', email: 'test@test.com', timezone: 'Europe/London' },
        isLoading: false,
        isAuthenticated: true,
        mfaChallenge: null,
        isLoaded: true,
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        checkAuth: vi.fn(),
      } as ReturnType<typeof useAuth>);

      const { result } = renderHook(() => useTimezone());

      expect(result.current.timezone).toBe('Europe/London');
    });

    it('returns default timezone when user has no timezone', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: '1', email: 'test@test.com' },
        isLoading: false,
        isAuthenticated: true,
        mfaChallenge: null,
        isLoaded: true,
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        checkAuth: vi.fn(),
      } as ReturnType<typeof useAuth>);

      const { result } = renderHook(() => useTimezone());

      expect(result.current.timezone).toBe('America/New_York');
    });

    it('returns default timezone when user is null', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        mfaChallenge: null,
        isLoaded: true,
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        checkAuth: vi.fn(),
      } as ReturnType<typeof useAuth>);

      const { result } = renderHook(() => useTimezone());

      expect(result.current.timezone).toBe('America/New_York');
    });
  });

  describe('isLoading', () => {
    it('returns true when auth is loading', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        isLoading: true,
        isAuthenticated: false,
        mfaChallenge: null,
        isLoaded: false,
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        checkAuth: vi.fn(),
      } as ReturnType<typeof useAuth>);

      const { result } = renderHook(() => useTimezone());

      expect(result.current.isLoading).toBe(true);
    });

    it('returns false when auth is not loading', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: '1', email: 'test@test.com' },
        isLoading: false,
        isAuthenticated: true,
        mfaChallenge: null,
        isLoaded: true,
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        checkAuth: vi.fn(),
      } as ReturnType<typeof useAuth>);

      const { result } = renderHook(() => useTimezone());

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('error', () => {
    it('always returns null', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: '1', email: 'test@test.com' },
        isLoading: false,
        isAuthenticated: true,
        mfaChallenge: null,
        isLoaded: true,
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        checkAuth: vi.fn(),
      } as ReturnType<typeof useAuth>);

      const { result } = renderHook(() => useTimezone());

      expect(result.current.error).toBeNull();
    });
  });

  describe('different timezones', () => {
    const timezones = [
      'America/Los_Angeles',
      'America/Chicago',
      'UTC',
      'Asia/Tokyo',
      'Australia/Sydney',
    ];

    it.each(timezones)('correctly returns %s when set', (tz) => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: '1', email: 'test@test.com', timezone: tz },
        isLoading: false,
        isAuthenticated: true,
        mfaChallenge: null,
        isLoaded: true,
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        checkAuth: vi.fn(),
      } as ReturnType<typeof useAuth>);

      const { result } = renderHook(() => useTimezone());

      expect(result.current.timezone).toBe(tz);
    });
  });
});
