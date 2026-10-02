import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../lib/apiClient';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { X, Eye, EyeOff, AlertCircle, CheckCircle, Loader2, ShieldCheck } from 'lucide-react';
import { ModalPortal } from './ModalPortal';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MfaState {
  required: boolean;
  session: string;
  challengeType: string;
}

export default function ChangePasswordModal({
  isOpen,
  onClose,
}: ChangePasswordModalProps) {
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'change-password',
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [mfaState, setMfaState] = useState<MfaState | null>(null);

  const mfaInputRef = useRef<HTMLInputElement>(null);

  // Focus MFA input when MFA step is shown
  useEffect(() => {
    if (mfaState?.required) {
      mfaInputRef.current?.focus();
    }
  }, [mfaState?.required]);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setMfaCode('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setError(null);
    setSuccess(false);
    setMfaState(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Initial password change request
  const changePasswordMutation = useMutation({
    mutationFn: async (data: { current_password: string; new_password: string }) => {
      return apiFetch<{ message?: string; mfaRequired?: boolean; session?: string; challengeType?: string }>(
        '/auth/password/change',
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
    },
    onSuccess: (response) => {
      if (response.mfaRequired && response.session) {
        // MFA required - show MFA input
        setMfaState({
          required: true,
          session: response.session,
          challengeType: response.challengeType || 'SOFTWARE_TOKEN_MFA',
        });
        setError(null);
      } else {
        // Password changed successfully
        setSuccess(true);
        setError(null);
        setTimeout(() => {
          handleClose();
        }, 2000);
      }
    },
    onError: (err: ApiError) => {
      setError(err.message || 'Failed to change password');
    },
  });

  // MFA verification for password change
  const mfaVerifyMutation = useMutation({
    mutationFn: async (data: {
      session: string;
      mfa_code: string;
      current_password: string;
      new_password: string;
    }) => {
      return apiFetch('/auth/password/change/mfa', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      setSuccess(true);
      setError(null);
      setTimeout(() => {
        handleClose();
      }, 2000);
    },
    onError: (err: ApiError) => {
      setError(err.message || 'MFA verification failed');
      setMfaCode('');
      mfaInputRef.current?.focus();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!currentPassword) {
      setError('Please enter your current password');
      return;
    }

    if (!newPassword) {
      setError('Please enter a new password');
      return;
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (currentPassword === newPassword) {
      setError('New password must be different from current password');
      return;
    }

    changePasswordMutation.mutate({
      current_password: currentPassword,
      new_password: newPassword,
    });
  };

  const handleMfaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!mfaCode || mfaCode.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    if (!mfaState?.session) {
      setError('MFA session expired. Please try again.');
      setMfaState(null);
      return;
    }

    mfaVerifyMutation.mutate({
      session: mfaState.session,
      mfa_code: mfaCode,
      current_password: currentPassword,
      new_password: newPassword,
    });
  };

  const handleMfaCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setMfaCode(value);
    setError(null);
  };

  const isLoading = changePasswordMutation.isPending || mfaVerifyMutation.isPending;

  if (!isOpen) return null;

  // MFA verification step
  if (mfaState?.required && !success) {
    return (
      <ModalPortal>
      { }
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
        onClick={handleClose}
      >
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          ref={modalRef}
          className="bg-parchment rounded-lg shadow-xl w-full max-w-[500px] max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
          {...getModalAriaProps(titleId, descriptionId)}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
            <h2 id={titleId} className="m-0 text-lg font-semibold text-ink">
              Verify Your Identity
            </h2>
            <button
              onClick={handleClose}
              className="p-2 text-archive hover:text-ink transition-colors"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <form onSubmit={handleMfaSubmit}>
            <div className="p-6 space-y-4">
              <div className="text-center mb-4">
                <div className="mx-auto w-12 h-12 bg-bark/10 rounded-full flex items-center justify-center mb-3">
                  <ShieldCheck className="w-6 h-6 text-bark" />
                </div>
                <p id={descriptionId} className="text-sm text-archive">
                  Enter the 6-digit code from your authenticator app to confirm the password change.
                </p>
              </div>

              <div>
                <label
                  htmlFor="mfa-code"
                  className="block text-sm font-medium text-ink mb-1"
                >
                  Verification code
                </label>
                <input
                  ref={mfaInputRef}
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={mfaCode}
                  onChange={handleMfaCodeChange}
                  disabled={isLoading}
                  className="w-full px-4 py-3 text-center text-2xl tracking-widest font-mono border border-lichen rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark disabled:bg-stone/30 disabled:cursor-not-allowed"
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="one-time-code"
                  aria-label="6-digit verification code"
                />
              </div>

              {/* Error Message */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm">
                  <AlertCircle size={18} className="text-semantic-error flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-semantic-error">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setMfaState(null)}
                disabled={isLoading}
                className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm text-ink hover:bg-stone/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isLoading || mfaCode.length !== 6}
                className="px-4 py-2 bg-bark text-parchment rounded-sm text-sm hover:bg-bark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify & Change Password'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
      </ModalPortal>
    );
  }

  // Password entry step
  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={handleClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-[500px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        {...getModalAriaProps(titleId, descriptionId)}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <h2 id={titleId} className="m-0 text-lg font-semibold text-ink">
            Change Password
          </h2>
          <button
            onClick={handleClose}
            className="p-2 text-archive hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <p id={descriptionId} className="text-sm text-archive mb-4">
              Enter your current password and choose a new password.
            </p>

            {/* Current Password */}
            <div>
              <label
                htmlFor="current-password"
                className="block text-sm font-medium text-ink mb-1"
              >
                Current password
              </label>
              <div className="relative">
                <input
                  id="current-password"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={isLoading || success}
                  className="w-full px-3 py-2 pr-10 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark disabled:bg-stone/30 disabled:cursor-not-allowed"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-archive hover:text-ink"
                  aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div>
              <label
                htmlFor="new-password"
                className="block text-sm font-medium text-ink mb-1"
              >
                New password
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={isLoading || success}
                  className="w-full px-3 py-2 pr-10 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark disabled:bg-stone/30 disabled:cursor-not-allowed"
                  autoComplete="new-password"
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-archive hover:text-ink"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="mt-1 text-xs text-archive">
                Must be at least 8 characters
              </p>
            </div>

            {/* Confirm New Password */}
            <div>
              <label
                htmlFor="confirm-password"
                className="block text-sm font-medium text-ink mb-1"
              >
                Confirm new password
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading || success}
                  className="w-full px-3 py-2 pr-10 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark disabled:bg-stone/30 disabled:cursor-not-allowed"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-archive hover:text-ink"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm">
                <AlertCircle size={18} className="text-semantic-error flex-shrink-0 mt-0.5" />
                <p className="text-sm text-semantic-error">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="flex items-start gap-2 p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-sm">
                <CheckCircle size={18} className="text-semantic-success flex-shrink-0 mt-0.5" />
                <p className="text-sm text-semantic-success">
                  Password changed successfully!
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm text-ink hover:bg-stone/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || success}
              className="px-4 py-2 bg-bark text-parchment rounded-sm text-sm hover:bg-bark/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Checking...
                </>
              ) : success ? (
                'Done'
              ) : (
                'Change Password'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  );
}
