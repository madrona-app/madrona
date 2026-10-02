import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';

import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import type { MfaFactors } from '../../contexts/AuthContext';
import { logger } from '../../lib/logger';

type FactorKey = 'totp' | 'sms' | 'email';

interface FactorDescriptor {
  key: FactorKey;
  label: string;
  description: string;
  icon: typeof ShieldCheck;
}

const FACTOR_ROWS: FactorDescriptor[] = [
  {
    key: 'totp',
    label: 'Authenticator app',
    description: 'Time-based code from an app like Google Authenticator or 1Password.',
    icon: ShieldCheck,
  },
  {
    key: 'email',
    label: 'Email',
    description: 'Code emailed to your account address. Required for offline backup access.',
    icon: Mail,
  },
  {
    key: 'sms',
    label: 'SMS',
    description: 'Text-message code. Not currently enabled platform-wide.',
    icon: Smartphone,
  },
];

type SetupStage = 'idle' | 'awaiting-code' | 'verifying';

export default function AccountSecurityPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  const [factors, setFactors] = useState<MfaFactors | null>(auth.user?.mfa_factors ?? null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);

  // Email-MFA enrollment flow state.
  const [setupStage, setSetupStage] = useState<SetupStage>('idle');
  const [setupCode, setSetupCode] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [busyFactor, setBusyFactor] = useState<FactorKey | null>(null);

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      navigate('/sign-in', { replace: true });
    }
  }, [auth.isAuthenticated, auth.isLoading, navigate]);

  useEffect(() => {
    setFactors(auth.user?.mfa_factors ?? null);
  }, [auth.user]);

  const enrolled = useMemo(
    () => ({
      totp: factors?.totp ?? false,
      sms: factors?.sms ?? false,
      email: factors?.email ?? false,
    }),
    [factors],
  );
  const preferred = factors?.preferred ?? null;

  // AUTH_PROVIDER=local has no MFA provider at all. Offer nothing rather
  // than enrolment controls whose endpoints answer 501.
  const mfaAvailable = auth.user?.mfa_available !== false;

  const enrolledCount = (enrolled.totp ? 1 : 0) + (enrolled.sms ? 1 : 0) + (enrolled.email ? 1 : 0);

  const handleEmailEnrollStart = async () => {
    setSetupError(null);
    setBusyFactor('email');
    try {
      await apiFetch('/auth/mfa/email/setup/start', { method: 'POST' });
      setSetupStage('awaiting-code');
      setSetupCode('');
    } catch (err) {
      logger.error('email mfa start failed', err);
      setSetupError(toReadableError(err, 'Could not send the confirmation code. Try again.'));
    } finally {
      setBusyFactor(null);
    }
  };

  const handleEmailEnrollVerify = async () => {
    setSetupError(null);
    if (setupCode.length !== 6) {
      setSetupError('Enter the 6-digit code from your inbox.');
      return;
    }
    setSetupStage('verifying');
    try {
      await apiFetch('/auth/mfa/email/setup/verify', {
        method: 'POST',
        body: JSON.stringify({ code: setupCode }),
      });
      await auth.refreshMe();
      setSetupStage('idle');
      setSetupCode('');
      setGlobalSuccess('Email two-factor authentication is enabled.');
    } catch (err) {
      logger.error('email mfa verify failed', err);
      setSetupError(toReadableError(err, 'Incorrect or expired code. Request a new one.'));
      setSetupStage('awaiting-code');
    }
  };

  const handleEmailDisable = async () => {
    setGlobalError(null);
    setBusyFactor('email');
    try {
      await apiFetch('/auth/mfa/email', { method: 'DELETE' });
      await auth.refreshMe();
      setGlobalSuccess('Email two-factor authentication is disabled.');
    } catch (err) {
      logger.error('email mfa disable failed', err);
      setGlobalError(toReadableError(err, 'Could not disable email two-factor.'));
    } finally {
      setBusyFactor(null);
    }
  };

  const handleSetPreferred = async (target: FactorKey) => {
    if (!enrolled[target]) return;
    if (preferred === target) return;
    setGlobalError(null);
    setBusyFactor(target);
    try {
      await apiFetch('/me/mfa-preferences', {
        method: 'PUT',
        body: JSON.stringify({ preferred: target }),
      });
      await auth.refreshMe();
      setGlobalSuccess(`Preferred two-factor set to ${labelFor(target)}.`);
    } catch (err) {
      logger.error('set preferred mfa failed', err);
      setGlobalError(toReadableError(err, 'Could not update preferred factor.'));
    } finally {
      setBusyFactor(null);
    }
  };

  if (auth.isLoading) {
    return (
      <div className="min-h-screen bg-stone/40 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-bark" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone/40 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-ink mb-1">Account security</h1>
          <p className="text-sm text-archive">
            Manage how you prove your identity when signing in.
          </p>
        </div>

        {globalSuccess && (
          <div className="mb-4 flex items-center gap-2 bg-semantic-success/10 border border-semantic-success/30 text-semantic-success px-4 py-3 rounded-institutional text-sm">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{globalSuccess}</span>
          </div>
        )}
        {globalError && (
          <div className="mb-4 flex items-center gap-2 bg-semantic-error/10 border border-semantic-error/30 text-semantic-error px-4 py-3 rounded-institutional text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{globalError}</span>
          </div>
        )}

        {!mfaAvailable && (
          <section className="bg-parchment border border-lichen rounded-institutional shadow-archival-sm">
            <header className="px-6 py-4 border-b border-lichen">
              <h2 className="text-lg font-semibold text-ink">Two-factor authentication</h2>
            </header>
            <div className="px-6 py-5 text-sm text-archive">
              <p>
                This deployment authenticates with local passwords, which do not
                support a second factor. Two-factor authentication is available
                when the server is configured against an identity provider.
              </p>
              <p className="mt-2">
                Ask your administrator to see the{' '}
                <span className="font-medium text-ink">Authentication</span>{' '}
                section of the project README for the options.
              </p>
            </div>
          </section>
        )}

        {mfaAvailable && (
        <section className="bg-parchment border border-lichen rounded-institutional shadow-archival-sm">
          <header className="px-6 py-4 border-b border-lichen">
            <h2 className="text-lg font-semibold text-ink">Two-factor authentication</h2>
            <p className="text-sm text-archive mt-1">
              {enrolledCount > 0
                ? `${enrolledCount} factor${enrolledCount === 1 ? '' : 's'} enrolled.`
                : 'No second factor enrolled yet.'}
            </p>
          </header>

          <ul className="divide-y divide-lichen">
            {FACTOR_ROWS.map((row) => {
              const Icon = row.icon;
              const isEnrolled = enrolled[row.key];
              const isPreferred = preferred === row.key;
              const factorBusy = busyFactor === row.key;
              return (
                <li key={row.key} className="px-6 py-4 flex items-start gap-4">
                  <div className="mt-1">
                    <Icon className="w-5 h-5 text-bark" aria-hidden="true" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-ink">{row.label}</span>
                      {isEnrolled && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-semantic-success/10 text-semantic-success">
                          Enrolled
                        </span>
                      )}
                      {isPreferred && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-azurite/10 text-azurite">
                          Preferred
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-archive mt-1">{row.description}</p>

                    {row.key === 'email' && renderEmailControls({
                      isEnrolled,
                      isPreferred,
                      setupStage,
                      setupCode,
                      setupError,
                      factorBusy,
                      onStart: handleEmailEnrollStart,
                      onVerify: handleEmailEnrollVerify,
                      onCancel: () => {
                        setSetupStage('idle');
                        setSetupCode('');
                        setSetupError(null);
                      },
                      onDisable: handleEmailDisable,
                      onMakePreferred: () => handleSetPreferred('email'),
                      onCodeChange: setSetupCode,
                    })}

                    {row.key === 'totp' && isEnrolled && !isPreferred && (
                      <button
                        type="button"
                        onClick={() => handleSetPreferred('totp')}
                        disabled={factorBusy}
                        className="mt-3 text-sm font-medium text-bark hover:text-copper-dark disabled:opacity-50"
                      >
                        Make preferred
                      </button>
                    )}
                    {row.key === 'totp' && !isEnrolled && (
                      <p className="text-xs text-archive mt-2">
                        Enroll an authenticator at sign-in. The setup prompt appears the next time
                        you log in if your role requires MFA.
                      </p>
                    )}
                    {row.key === 'sms' && !isEnrolled && (
                      <p className="text-xs text-archive mt-2">
                        SMS isn't available in this environment yet.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        )}
      </div>
    </div>
  );
}

interface EmailControlProps {
  isEnrolled: boolean;
  isPreferred: boolean;
  setupStage: SetupStage;
  setupCode: string;
  setupError: string | null;
  factorBusy: boolean;
  onStart: () => void;
  onVerify: () => void;
  onCancel: () => void;
  onDisable: () => void;
  onMakePreferred: () => void;
  onCodeChange: (value: string) => void;
}

function renderEmailControls(props: EmailControlProps) {
  const {
    isEnrolled, isPreferred,
    setupStage, setupCode, setupError, factorBusy,
    onStart, onVerify, onCancel, onDisable, onMakePreferred, onCodeChange,
  } = props;

  if (isEnrolled) {
    return (
      <div className="mt-3 flex flex-wrap gap-3">
        {!isPreferred && (
          <button
            type="button"
            onClick={onMakePreferred}
            disabled={factorBusy}
            className="text-sm font-medium text-bark hover:text-copper-dark disabled:opacity-50"
          >
            Make preferred
          </button>
        )}
        <button
          type="button"
          onClick={onDisable}
          disabled={factorBusy}
          className="text-sm font-medium text-semantic-error hover:text-semantic-error/80 disabled:opacity-50"
        >
          {factorBusy ? 'Disabling…' : 'Disable'}
        </button>
      </div>
    );
  }

  if (setupStage === 'idle') {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={onStart}
          disabled={factorBusy}
          className="btn-primary text-sm"
        >
          {factorBusy ? 'Sending code…' : 'Set up email two-factor'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <label className="block text-sm font-medium text-ink" htmlFor="email-mfa-code">
        Enter the 6-digit code we emailed you
      </label>
      <input
        id="email-mfa-code"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="one-time-code"
        value={setupCode}
        onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="w-full max-w-[12rem] px-3 py-2 text-center text-lg tracking-widest font-mono border border-lichen rounded-institutional focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        placeholder="000000"
        disabled={setupStage === 'verifying'}
      />
      {setupError && (
        <div className="flex items-center gap-2 text-sm text-semantic-error">
          <AlertCircle className="w-4 h-4" />
          <span>{setupError}</span>
        </div>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onVerify}
          disabled={setupStage === 'verifying' || setupCode.length !== 6}
          className="btn-primary text-sm"
        >
          {setupStage === 'verifying' ? 'Verifying…' : 'Verify and enable'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={setupStage === 'verifying'}
          className="btn-secondary text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function labelFor(key: FactorKey): string {
  switch (key) {
    case 'totp':  return 'authenticator app';
    case 'sms':   return 'SMS';
    case 'email': return 'email';
  }
}

function toReadableError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = (err.details as Record<string, unknown> | undefined)?.message;
    if (typeof detail === 'string' && detail) return detail;
    if (err.message) return err.message;
  }
  return fallback;
}
