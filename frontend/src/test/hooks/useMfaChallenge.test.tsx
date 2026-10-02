import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useMfaChallenge, MfaChallengeProvider } from '../../contexts/MfaChallengeContext';

// Mock the MfaReVerifyModal so it doesn't render real UI
vi.mock('../../components/MfaReVerifyModal', () => ({
  MfaReVerifyModal: ({ isOpen, onClose, onSuccess }: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
  }) => {
    // Store callbacks for testing
    if (isOpen) {
      (globalThis as Record<string, unknown>).__mfaOnClose = onClose;
      (globalThis as Record<string, unknown>).__mfaOnSuccess = onSuccess;
    }
    return null;
  },
}));

// Mock ApiError
vi.mock('../../lib/apiClient', () => {
  class ApiError extends Error {
    status: number;
    details: Record<string, unknown> | undefined;
    constructor(message: string, status: number, details?: Record<string, unknown>) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.details = details;
    }
  }
  return { ApiError };
});

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MfaChallengeProvider>
        {children}
      </MfaChallengeProvider>
    );
  };
}

describe('useMfaChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).__mfaOnClose;
    delete (globalThis as Record<string, unknown>).__mfaOnSuccess;
  });

  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useMfaChallenge());
    }).toThrow('useMfaChallenge must be used within an MfaChallengeProvider');
  });

  it('returns context methods', () => {
    const { result } = renderHook(() => useMfaChallenge(), {
      wrapper: createWrapper(),
    });

    expect(typeof result.current.withMfaChallenge).toBe('function');
    expect(typeof result.current.isMfaChallengeError).toBe('function');
    expect(typeof result.current.requestMfaVerification).toBe('function');
  });

  describe('isMfaChallengeError', () => {
    it('returns true for ApiError with mfaRequired', async () => {
      const { ApiError } = await import('../../lib/apiClient');
      const { result } = renderHook(() => useMfaChallenge(), {
        wrapper: createWrapper(),
      });

      const error = new ApiError('MFA required', 403, { mfaRequired: true });
      expect(result.current.isMfaChallengeError(error)).toBe(true);
    });

    it('returns true for ApiError with mfaStale', async () => {
      const { ApiError } = await import('../../lib/apiClient');
      const { result } = renderHook(() => useMfaChallenge(), {
        wrapper: createWrapper(),
      });

      const error = new ApiError('MFA stale', 403, { mfaStale: true });
      expect(result.current.isMfaChallengeError(error)).toBe(true);
    });

    it('returns false for non-MFA errors', () => {
      const { result } = renderHook(() => useMfaChallenge(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isMfaChallengeError(new Error('Generic error'))).toBe(false);
    });

    it('returns false for null/undefined', () => {
      const { result } = renderHook(() => useMfaChallenge(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isMfaChallengeError(null)).toBe(false);
      expect(result.current.isMfaChallengeError(undefined)).toBe(false);
    });
  });

  describe('withMfaChallenge', () => {
    it('resolves normally when fn succeeds without MFA', async () => {
      const { result } = renderHook(() => useMfaChallenge(), {
        wrapper: createWrapper(),
      });

      const fn = vi.fn().mockResolvedValue('success');

      let value: string | undefined;
      await act(async () => {
        value = await result.current.withMfaChallenge(fn);
      });

      expect(value).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('rejects with non-MFA errors', async () => {
      const { result } = renderHook(() => useMfaChallenge(), {
        wrapper: createWrapper(),
      });

      const fn = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        act(async () => {
          await result.current.withMfaChallenge(fn);
        })
      ).rejects.toThrow('Network error');
    });
  });
});
