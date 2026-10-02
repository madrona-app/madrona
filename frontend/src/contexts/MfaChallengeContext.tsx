import React, { createContext, useState, useCallback, useContext, useRef } from 'react';
import { MfaReVerifyModal } from '../components/MfaReVerifyModal';
import { ApiError } from '../lib/apiClient';

interface PendingRequest {
  /** Function to retry the original request after MFA verification */
  retry: () => Promise<unknown>;
  /** Function to resolve the original promise */
  resolve: (value: unknown) => void;
  /** Function to reject the original promise */
  reject: (error: unknown) => void;
  /** Optional reason for MFA requirement */
  reason?: string;
  /** Whether MFA is stale (expired) vs never verified */
  isStale?: boolean;
  /** How old the MFA verification is (minutes) */
  mfaAgeMinutes?: number;
}

interface MfaChallengeContextValue {
  /**
   * Wrap an async function to handle MFA challenges automatically.
   * If the function throws an MFA challenge error, the modal will be shown
   * and the function will be retried after successful verification.
   */
  withMfaChallenge: <T>(fn: () => Promise<T>, reason?: string) => Promise<T>;

  /**
   * Check if an error is an MFA challenge that should trigger re-verification.
   */
  isMfaChallengeError: (error: unknown) => boolean;

  /**
   * Manually trigger the MFA re-verification modal.
   * Returns a promise that resolves when MFA is verified, or rejects if cancelled.
   */
  requestMfaVerification: (options?: {
    reason?: string;
    isStale?: boolean;
    mfaAgeMinutes?: number;
  }) => Promise<void>;
}

const MfaChallengeContext = createContext<MfaChallengeContextValue | undefined>(undefined);

interface MfaChallengeProviderProps {
  children: React.ReactNode;
}

/**
 * MfaChallengeProvider - Handles MFA re-verification for sensitive operations.
 *
 * When an API call returns an MFA challenge (mfaRequired or mfaStale in error details),
 * this context can automatically show the re-verification modal and retry the request.
 *
 * Usage:
 * ```tsx
 * const { withMfaChallenge } = useMfaChallenge();
 *
 * const handleInviteUser = async () => {
 *   await withMfaChallenge(
 *     () => api.inviteUser(email, role),
 *     'Inviting a new user requires identity verification'
 *   );
 * };
 * ```
 */
export const MfaChallengeProvider: React.FC<MfaChallengeProviderProps> = ({ children }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalReason, setModalReason] = useState<string | undefined>();
  const [isStale, setIsStale] = useState(false);
  const [mfaAgeMinutes, setMfaAgeMinutes] = useState<number | undefined>();
  const pendingRequestRef = useRef<PendingRequest | null>(null);

  const isMfaChallengeError = useCallback((error: unknown): boolean => {
    if (error instanceof ApiError) {
      const details = error.details;
      if (details) {
        return details.mfaRequired === true || details.mfaStale === true;
      }
      // Also check status codes that might indicate MFA requirement
      if (error.status === 401 && error.message?.includes('MFA')) {
        return true;
      }
      if (error.status === 403 && error.message?.includes('MFA')) {
        return true;
      }
    }
    return false;
  }, []);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    // Reject the pending request if user cancels
    if (pendingRequestRef.current) {
      pendingRequestRef.current.reject(new Error('MFA verification cancelled'));
      pendingRequestRef.current = null;
    }
  }, []);

  const handleMfaSuccess = useCallback(async () => {
    setIsModalOpen(false);
    // Retry the original request
    if (pendingRequestRef.current) {
      const { retry, resolve, reject } = pendingRequestRef.current;
      pendingRequestRef.current = null;
      try {
        const result = await retry();
        resolve(result);
      } catch (err) {
        // If it fails again with MFA challenge, we'll show the modal again
        if (isMfaChallengeError(err)) {
          // This shouldn't happen if MFA was just verified, but handle it gracefully
          reject(err);
        } else {
          reject(err);
        }
      }
    }
  }, [isMfaChallengeError]);

  const requestMfaVerification = useCallback((options?: {
    reason?: string;
    isStale?: boolean;
    mfaAgeMinutes?: number;
  }): Promise<void> => {
    return new Promise((resolve, reject) => {
      setModalReason(options?.reason);
      setIsStale(options?.isStale || false);
      setMfaAgeMinutes(options?.mfaAgeMinutes);
      setIsModalOpen(true);

      // Store dummy pending request that just resolves on success
      pendingRequestRef.current = {
        retry: async () => {},
        resolve: () => resolve(),
        reject: (err) => reject(err),
        reason: options?.reason,
        isStale: options?.isStale,
        mfaAgeMinutes: options?.mfaAgeMinutes,
      };
    });
  }, []);

  const withMfaChallenge = useCallback(<T,>(
    fn: () => Promise<T>,
    reason?: string
  ): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      fn()
        .then(resolve)
        .catch((error) => {
          if (isMfaChallengeError(error)) {
            // Extract MFA details from error
            let stale = false;
            let ageMinutes: number | undefined;

            if (error instanceof ApiError && error.details) {
              stale = error.details.mfaStale === true;
              ageMinutes = error.details.mfaAgeMinutes;
            }

            // Store the pending request
            pendingRequestRef.current = {
              retry: fn as () => Promise<unknown>,
              resolve: resolve as (value: unknown) => void,
              reject,
              reason,
              isStale: stale,
              mfaAgeMinutes: ageMinutes,
            };

            // Show the modal
            setModalReason(reason);
            setIsStale(stale);
            setMfaAgeMinutes(ageMinutes);
            setIsModalOpen(true);
          } else {
            // Not an MFA challenge, propagate the error
            reject(error);
          }
        });
    });
  }, [isMfaChallengeError]);

  const value: MfaChallengeContextValue = {
    withMfaChallenge,
    isMfaChallengeError,
    requestMfaVerification,
  };

  return (
    <MfaChallengeContext.Provider value={value}>
      {children}
      <MfaReVerifyModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSuccess={handleMfaSuccess}
        reason={modalReason}
        isStale={isStale}
        mfaAgeMinutes={mfaAgeMinutes}
      />
    </MfaChallengeContext.Provider>
  );
};

/**
 * Hook to access MFA challenge handling functionality.
 */
export function useMfaChallenge(): MfaChallengeContextValue {
  const context = useContext(MfaChallengeContext);
  if (!context) {
    throw new Error('useMfaChallenge must be used within an MfaChallengeProvider');
  }
  return context;
}

export default MfaChallengeContext;
