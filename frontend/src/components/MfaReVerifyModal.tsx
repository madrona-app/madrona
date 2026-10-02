import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ShieldCheck, X, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/apiClient';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { ModalPortal } from './ModalPortal';

interface MfaReVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Optional message explaining why MFA is required */
  reason?: string;
  /** Whether the MFA expired (stale) vs never verified */
  isStale?: boolean;
  /** How old the MFA verification is (in minutes) */
  mfaAgeMinutes?: number;
}

/**
 * Modal for re-verifying MFA for sensitive admin actions.
 *
 * Shows when an API call returns mfaRequired or mfaStale in the error response.
 * Prompts user to enter their TOTP code, calls /auth/mfa/reverify endpoint,
 * and on success refreshes the session tokens with fresh MFA timestamp.
 */
export function MfaReVerifyModal({
  isOpen,
  onClose,
  onSuccess,
  reason,
  isStale = false,
  mfaAgeMinutes,
}: MfaReVerifyModalProps) {
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'mfa-reverify-modal',
  });

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Small delay to ensure the modal is rendered
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCode('');
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (code.length !== 6 || !/^\d+$/.test(code)) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Call the MFA re-verification endpoint
      const result = await apiFetch('/auth/mfa/reverify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });

      // Store the new access token if returned
      if (result.access_token) {
        // The auth context will pick up the new token from the response
        // and update its state accordingly
      }

      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Invalid verification code. Please try again.');
        } else if (err.status === 429) {
          setError('Too many attempts. Please wait a moment and try again.');
        } else {
          setError(err.message || 'Verification failed. Please try again.');
        }
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [code, onSuccess]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow digits
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
    setError(null);
  };

  const formatTimeAgo = (minutes: number): string => {
    if (minutes < 60) {
      return `${Math.round(minutes)} minutes ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment dark:bg-forest rounded-lg max-w-md w-[90%] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-lichen dark:border-lichen flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-bark/10 dark:bg-bark/50">
              <ShieldCheck className="h-5 w-5 text-bark dark:text-bark" />
            </div>
            <h2
              id={titleId}
              className="m-0 text-lg font-semibold text-ink dark:text-stone font-serif"
            >
              Verify your identity
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg text-archive hover:text-archive dark:hover:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5">
            <p
              id={descriptionId}
              className="m-0 mb-4 text-sm text-archive dark:text-archive leading-relaxed font-serif"
            >
              {isStale && mfaAgeMinutes ? (
                <>
                  Your last verification was {formatTimeAgo(mfaAgeMinutes)}.
                  {' '}This action requires recent MFA verification.
                </>
              ) : (
                'This action requires multi-factor authentication.'
              )}
            </p>
            {reason && (
              <p className="m-0 mb-4 text-sm text-archive dark:text-archive font-serif">
                {reason}
              </p>
            )}

            <div>
              <label
                htmlFor="mfa-code"
                className="block text-sm font-medium text-ink dark:text-stone mb-1"
              >
                Verification code
              </label>
              <input
                ref={inputRef}
                type="text"
                id="mfa-code"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={handleCodeChange}
                disabled={isSubmitting}
                className="block w-full rounded-lg border border-stone dark:border-lichen py-2 px-3 text-ink dark:text-stone shadow-sm placeholder:text-archive dark:placeholder:text-archive focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark sm:text-sm bg-parchment dark:bg-forest disabled:opacity-50 disabled:cursor-not-allowed tracking-[0.5em] text-center font-mono text-lg"
                placeholder="000000"
              />
              <p className="mt-1 text-xs text-archive dark:text-archive">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-semantic-error/10 dark:bg-semantic-error/20 p-3">
                <AlertTriangle className="h-5 w-5 text-semantic-error dark:text-semantic-error flex-shrink-0" />
                <p className="text-sm text-semantic-error dark:text-semantic-error">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-lichen dark:border-lichen flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-stone dark:border-lichen rounded-lg bg-parchment dark:bg-forest text-sm font-serif text-ink dark:text-stone cursor-pointer hover:bg-stone/20 dark:hover:bg-forest transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || code.length !== 6}
              className="px-4 py-2 border-none rounded-lg text-sm font-serif text-parchment cursor-pointer transition-colors bg-bark hover:bg-bark/100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Verifying...' : 'Verify'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}

export default MfaReVerifyModal;
