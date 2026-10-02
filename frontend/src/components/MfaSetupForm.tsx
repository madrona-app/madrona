import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, AlertCircle, Loader2, Copy, CheckCircle } from 'lucide-react';
import { MadronaLoader } from './ui/MadronaLoader';

interface MfaSetupFormProps {
  email: string;
  session: string;
  onSuccess: () => void;
  onCancel: () => void;
  onSetupStart: (email: string, session: string) => Promise<{ secret: string; otpauthUrl: string; session: string }>;
  onSetupVerify: (email: string, code: string, session: string) => Promise<void>;
}

/**
 * MFA setup form for enrolling TOTP authenticator.
 * Shows QR code for scanning and manual secret entry option.
 */
export default function MfaSetupForm({
  email,
  session,
  onSuccess,
  onCancel,
  onSetupStart,
  onSetupVerify,
}: MfaSetupFormProps) {
  const [step, setStep] = useState<'loading' | 'scan' | 'verify' | 'complete'>('loading');
  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [currentSession, setCurrentSession] = useState(session);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Start MFA setup on mount
  useEffect(() => {
    const startSetup = async () => {
      try {
        const result = await onSetupStart(email, session);
        setSecret(result.secret);
        setOtpauthUrl(result.otpauthUrl);
        setCurrentSession(result.session);
        setStep('scan');
      } catch {
        setError('Failed to start MFA setup. Please try again.');
        setStep('scan'); // Show error state
      }
    };

    startSetup();
  }, [email, session, onSetupStart]);

  // Auto-focus code input when entering verify step
  useEffect(() => {
    if (step === 'verify') {
      inputRef.current?.focus();
    }
  }, [step]);

  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = secret;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
    setError(null);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();

    if (code.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await onSetupVerify(email, code, currentSession);
      setStep('complete');
    } catch {
      setError('Invalid code. Please check your authenticator app and try again.');
      setCode('');
      inputRef.current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (step === 'loading') {
    return (
      <div className="max-w-md w-full bg-parchment rounded-institutional shadow-archival-md border border-lichen p-8">
        <MadronaLoader />
      </div>
    );
  }

  // Complete state - prompt to re-login
  if (step === 'complete') {
    return (
      <div className="max-w-md w-full bg-parchment rounded-institutional shadow-archival-md border border-lichen p-8">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 bg-semantic-success/20 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="w-6 h-6 text-semantic-success" />
          </div>
          <h2 className="text-2xl font-bold text-ink mb-2">
            MFA Setup Complete
          </h2>
          <p className="text-archive text-sm">
            Two-factor authentication has been enabled for your account.
            You'll need to enter a code from your authenticator app each time you sign in.
          </p>
        </div>

        <button
          onClick={onSuccess}
          className="w-full bg-bark text-parchment py-2 px-4 rounded-institutional font-medium hover:bg-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          Continue to Sign In
        </button>
      </div>
    );
  }

  // Scan QR code step
  if (step === 'scan') {
    return (
      <div className="max-w-md w-full bg-parchment rounded-institutional shadow-archival-md border border-lichen p-8">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 bg-bark/10 rounded-full flex items-center justify-center mb-4">
            <ShieldCheck className="w-6 h-6 text-bark" />
          </div>
          <h2 className="text-2xl font-bold text-ink mb-2">
            Set Up Authenticator
          </h2>
          <p className="text-archive text-sm">
            Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-semantic-error/10 border border-semantic-error/30 text-semantic-error px-4 py-3 rounded-institutional text-sm mb-6">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* QR Code - using a simple img tag with QR code API */}
        {otpauthUrl && (
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-parchment border-2 border-lichen rounded-institutional">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`}
                alt="QR Code for authenticator app"
                width={200}
                height={200}
                className="block"
              />
            </div>
          </div>
        )}

        {/* Manual entry toggle */}
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowManualEntry(!showManualEntry)}
            className="text-sm text-bark hover:text-bark/80 underline"
          >
            {showManualEntry ? 'Hide manual entry key' : "Can't scan? Enter key manually"}
          </button>

          {showManualEntry && secret && (
            <div className="mt-3 p-3 bg-stone/30 rounded-institutional">
              <p className="text-xs text-archive mb-1">Manual entry key:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm bg-parchment px-2 py-1 rounded-institutional border border-lichen break-all">
                  {secret}
                </code>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="p-1.5 text-archive hover:text-ink hover:bg-stone/50 rounded-institutional"
                  aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
                >
                  {copied ? (
                    <CheckCircle className="w-4 h-4 text-semantic-success" aria-hidden="true" />
                  ) : (
                    <Copy className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setStep('verify')}
            disabled={!secret}
            className="w-full bg-bark text-parchment py-2 px-4 rounded-institutional font-medium hover:bg-copper-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            I've scanned the code
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="w-full bg-parchment text-ink py-2 px-4 rounded-institutional font-medium border border-lichen hover:bg-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Verify code step
  return (
    <div className="max-w-md w-full bg-parchment rounded-institutional shadow-archival-md border border-lichen p-8">
      <div className="text-center mb-6">
        <div className="mx-auto w-12 h-12 bg-bark/10 rounded-full flex items-center justify-center mb-4">
          <ShieldCheck className="w-6 h-6 text-bark" />
        </div>
        <h2 className="text-2xl font-bold text-ink mb-2">
          Verify Setup
        </h2>
        <p className="text-archive text-sm">
          Enter the 6-digit code from your authenticator app to complete setup
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-6">
        <div>
          <label htmlFor="setup-code" className="block text-sm font-medium text-ink mb-2">
            Verification code
          </label>
          <input
            ref={inputRef}
            id="setup-code"
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
              'Verify & Enable MFA'
            )}
          </button>

          <button
            type="button"
            onClick={() => setStep('scan')}
            disabled={isLoading}
            className="w-full bg-parchment text-ink py-2 px-4 rounded-institutional font-medium border border-lichen hover:bg-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
