import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import { MfaChallengeProvider, useMfaChallenge } from '../../contexts/MfaChallengeContext';
import { ApiError } from '../../lib/apiClient';

// MfaReVerifyModal renders into a portal and pulls in apiClient — stub it out.
vi.mock('../../components/MfaReVerifyModal', () => ({
  MfaReVerifyModal: ({
    isOpen,
    onClose,
    onSuccess,
    reason,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    reason?: string;
  }) =>
    isOpen ? (
      <div data-testid="mfa-modal">
        <span data-testid="mfa-reason">{reason || ''}</span>
        <button onClick={onClose}>cancel</button>
        <button onClick={onSuccess}>verify</button>
      </div>
    ) : null,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <MfaChallengeProvider>{children}</MfaChallengeProvider>;
}

describe('MfaChallengeContext', () => {
  describe('isMfaChallengeError', () => {
    it('returns true for ApiError with mfaRequired', () => {
      const { result } = renderHook(() => useMfaChallenge(), { wrapper });
      const err = new ApiError('need mfa', 401, undefined, { mfaRequired: true });
      expect(result.current.isMfaChallengeError(err)).toBe(true);
    });

    it('returns true for ApiError with mfaStale', () => {
      const { result } = renderHook(() => useMfaChallenge(), { wrapper });
      const err = new ApiError('stale mfa', 403, undefined, { mfaStale: true });
      expect(result.current.isMfaChallengeError(err)).toBe(true);
    });

    it('returns true for 401 with MFA in message', () => {
      const { result } = renderHook(() => useMfaChallenge(), { wrapper });
      const err = new ApiError('MFA required for this action', 401);
      expect(result.current.isMfaChallengeError(err)).toBe(true);
    });

    it('returns false for non-MFA ApiError', () => {
      const { result } = renderHook(() => useMfaChallenge(), { wrapper });
      const err = new ApiError('forbidden', 403);
      expect(result.current.isMfaChallengeError(err)).toBe(false);
    });

    it('returns false for non-API errors', () => {
      const { result } = renderHook(() => useMfaChallenge(), { wrapper });
      expect(result.current.isMfaChallengeError(new Error('boom'))).toBe(false);
      expect(result.current.isMfaChallengeError('oops')).toBe(false);
    });
  });

  describe('withMfaChallenge', () => {
    it('passes through successful results', async () => {
      const { result } = renderHook(() => useMfaChallenge(), { wrapper });
      const fn = vi.fn().mockResolvedValue('ok');

      let value: string | undefined;
      await act(async () => {
        value = await result.current.withMfaChallenge(fn);
      });
      expect(value).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-MFA errors', async () => {
      const { result } = renderHook(() => useMfaChallenge(), { wrapper });
      const fn = vi.fn().mockRejectedValue(new Error('plain error'));

      await act(async () => {
        await expect(result.current.withMfaChallenge(fn)).rejects.toThrow('plain error');
      });
    });

    it('shows the modal on MFA challenge error', async () => {
      function Consumer() {
        const { withMfaChallenge } = useMfaChallenge();
        const trigger = async () => {
          try {
            await withMfaChallenge(
              () => Promise.reject(new ApiError('mfa needed', 401, undefined, { mfaRequired: true })),
              'Sensitive action',
            );
          } catch {
            // expected — user cancels
          }
        };
        return <button onClick={trigger}>do</button>;
      }
      render(
        <MfaChallengeProvider>
          <Consumer />
        </MfaChallengeProvider>
      );
      await act(async () => {
        screen.getByText('do').click();
      });
      expect(screen.getByTestId('mfa-modal')).toBeInTheDocument();
      expect(screen.getByTestId('mfa-reason')).toHaveTextContent('Sensitive action');
    });

    it('retries the request after MFA success', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(
          new ApiError('mfa needed', 401, undefined, { mfaRequired: true })
        )
        .mockResolvedValueOnce('success');

      let resolved: string | undefined;
      function Consumer() {
        const { withMfaChallenge } = useMfaChallenge();
        const trigger = async () => {
          resolved = await withMfaChallenge(fn);
        };
        return <button onClick={trigger}>do</button>;
      }
      render(
        <MfaChallengeProvider>
          <Consumer />
        </MfaChallengeProvider>
      );

      await act(async () => {
        screen.getByText('do').click();
      });

      // Modal should be open
      expect(screen.getByTestId('mfa-modal')).toBeInTheDocument();

      // Simulate verify success
      await act(async () => {
        screen.getByText('verify').click();
      });

      expect(fn).toHaveBeenCalledTimes(2);
      expect(resolved).toBe('success');
    });

    it('rejects when user cancels the modal', async () => {
      let rejected: unknown;
      function Consumer() {
        const { withMfaChallenge } = useMfaChallenge();
        const trigger = async () => {
          try {
            await withMfaChallenge(
              () => Promise.reject(new ApiError('mfa', 401, undefined, { mfaRequired: true })),
            );
          } catch (err) {
            rejected = err;
          }
        };
        return <button onClick={trigger}>do</button>;
      }
      render(
        <MfaChallengeProvider>
          <Consumer />
        </MfaChallengeProvider>
      );

      await act(async () => {
        screen.getByText('do').click();
      });
      await act(async () => {
        screen.getByText('cancel').click();
      });

      expect(rejected).toBeInstanceOf(Error);
      expect((rejected as Error).message).toMatch(/cancel/i);
    });
  });

  describe('requestMfaVerification', () => {
    it('shows the modal and resolves on success', async () => {
      let resolved = false;
      function Consumer() {
        const { requestMfaVerification } = useMfaChallenge();
        const trigger = async () => {
          await requestMfaVerification({ reason: 'Test reason' });
          resolved = true;
        };
        return <button onClick={trigger}>do</button>;
      }
      render(
        <MfaChallengeProvider>
          <Consumer />
        </MfaChallengeProvider>
      );

      await act(async () => {
        screen.getByText('do').click();
      });
      expect(screen.getByTestId('mfa-modal')).toBeInTheDocument();
      expect(screen.getByTestId('mfa-reason')).toHaveTextContent('Test reason');

      await act(async () => {
        screen.getByText('verify').click();
      });

      expect(resolved).toBe(true);
    });
  });

  describe('useMfaChallenge outside provider', () => {
    it('throws an error', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderHook(() => useMfaChallenge())).toThrow(
        /useMfaChallenge must be used within an MfaChallengeProvider/
      );
      spy.mockRestore();
    });
  });
});
