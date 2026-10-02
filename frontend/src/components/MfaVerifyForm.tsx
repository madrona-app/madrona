import React, { useState, useRef, useEffect } from 'react';
import { ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { ApiError } from '../lib/apiClient';

export type MfaFactorType = 'totp' | 'sms' | 'email';

interface MfaVerifyFormProps {
  email: string;
  session: string;
  mfaType?: MfaFactorType;
  onSuccess: () => void;
  onCancel: () => void;
  onVerify: (email: string, code: string, session: string, mfaType: MfaFactorType) => Promise<void>;
}

/**
 * MFA verification form for entering a TOTP, SMS, or email code.
 * Displayed when login returns mfaRequired: true.
 */
export default function MfaVerifyForm({
  email,
  session,
  mfaType = 'totp',
  onSuccess,
  onCancel,
  onVerify,
}: MfaVerifyFormProps) {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus code input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle code input - only allow digits, auto-submit on 6 digits
  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (code.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await onVerify(email, code, session, mfaType);
      onSuccess();
    } catch (err) {
      // Detect session expiry vs wrong code
      const message = err instanceof ApiError ? err.message : '';
      if (message.toLowerCase().includes('session expired')) {
        setError('Your session has expired. Please sign in again.');
        // Reset to login after a short delay
        setTimeout(() => onCancel(), 3000);
      } else {
        setError('Invalid code. Please check and try again.');
      }
      setCode('');
      inputRef.current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  // Prompt copy varies by factor. Email subaddress is partially masked
  // so the user can confirm it's the right account without leaking the
  // full address back to anyone shoulder-surfing the screen.
  const maskedEmail = (() => {
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${'•'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
  })();

  const factorCopy: Record<MfaFactorType, { subtitle: string; hint: string }> = {
    totp: {
      subtitle: 'Enter the code from your authenticator app',
      hint: 'Open your authenticator app to view your code.',
    },
    sms: {
      subtitle: 'Enter the code sent to your phone',
      hint: "Didn't receive the code? Check your phone or try again.",
    },
    email: {
      subtitle: `Enter the code we sent to ${maskedEmail}`,
      hint: "Didn't get it? Check spam, or wait a moment and try again.",
    },
  };
  const { subtitle, hint } = factorCopy[mfaType];

  return (
    <div className="max-w-md w-full bg-parchment rounded-institutional shadow-archival-md border border-lichen p-8">
      <div className="text-center mb-6">
        <div className="mx-auto w-12 h-12 bg-bark/10 rounded-full flex items-center justify-center mb-4">
          <ShieldCheck className="w-6 h-6 text-bark" />
        </div>
        <h2 className="text-2xl font-bold text-ink mb-2">
          Two-factor authentication
        </h2>
        <p className="text-archive text-sm">{subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="mfa-code" className="block text-sm font-medium text-ink mb-2">
            Verification code
          </label>
          <input
            ref={inputRef}
            id="mfa-code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={code}
            onChange={handleCodeChange}
            className="w-full px-4 py-3 text-center text-2xl tracking-widest font-mono border border-lichen rounded-institutional focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-transparent"
            placeholder="000000"
            maxLength={6}
            disabled={isLoading}
            autoComplete="one-time-code"
            aria-label="6-digit verification code"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-semantic-error/10 border border-semantic-error/30 text-semantic-error px-4 py-3 rounded-institutional text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full bg-bark text-parchment py-2 px-4 rounded-institutional font-medium hover:bg-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify'
            )}
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full bg-parchment text-ink py-2 px-4 rounded-institutional font-medium border border-lichen hover:bg-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>

      <div className="mt-6 text-center space-y-2">
        <p className="text-xs text-archive">{hint}</p>
        {mfaType === 'totp' && (
          <p className="text-xs text-archive">
            <a
              href="/recover-mfa"
              className="text-bark hover:text-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 rounded"
            >
              Lost your authenticator?
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
