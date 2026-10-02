import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../lib/apiClient';
import AuthLayout, {
  AuthInput,
  AuthButton,
  AuthError,
  AuthLink,
  AuthFooter,
} from '../../components/AuthLayout';
import { logger } from '../../lib/logger';

/**
 * Self-service "lost your authenticator" recovery.
 *
 * Without a token: request mode — enter email, we send a recovery link.
 * With ?token: confirm mode — enter the account password to remove the
 * current authenticator, then sign in and enrol a new one.
 */
export default function RecoverMfaPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await apiFetch('/auth/mfa/recovery/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      // Always show success (no account enumeration).
      setRequestSent(true);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      logger.error('MFA recovery request error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Please enter your password');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await apiFetch('/auth/mfa/recovery/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setConfirmed(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Incorrect password. Please try again.');
        } else if (err.status === 404) {
          setError('This recovery link is invalid. Please request a new one.');
        } else if (err.status === 400) {
          const message = err.message || '';
          if (message.includes('already been used')) {
            setError('This recovery link has already been used. Please request a new one.');
          } else if (message.includes('expired')) {
            setError('This recovery link has expired. Please request a new one.');
          } else {
            setError(message || 'Invalid request.');
          }
        } else {
          setError('Something went wrong. Please try again.');
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
      logger.error('MFA recovery confirm error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Confirm success — authenticator removed.
  if (confirmed) {
    return (
      <AuthLayout title="Authenticator removed" subtitle="">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-semantic-success/20 mb-4">
            <svg className="h-6 w-6 text-semantic-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-archive mb-6">
            Your authenticator has been removed. Sign in with your password, then set up a
            new authenticator from your security settings.
          </p>
          <AuthLink href="/sign-in">Sign in</AuthLink>
        </div>
      </AuthLayout>
    );
  }

  // Request sent — check email.
  if (requestSent) {
    return (
      <AuthLayout title="Check your email" subtitle="">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-semantic-success/20 mb-4">
            <svg className="h-6 w-6 text-semantic-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-archive mb-6">
            If an account exists for <span className="font-medium text-ink">{email}</span>, we've sent
            instructions to recover access.
          </p>
          <p className="text-sm text-archive mb-6">
            The link will expire in 1 hour. If you don't see the email, check your spam folder.
          </p>
          <AuthLink href="/sign-in">Back to sign in</AuthLink>
        </div>
      </AuthLayout>
    );
  }

  // Confirm mode — token present, ask for password.
  if (token) {
    return (
      <AuthLayout
        title="Recover account access"
        subtitle="Enter your password to remove your current authenticator. You'll set up a new one after signing in."
      >
        <form onSubmit={handleConfirm} className="space-y-6">
          <AuthInput
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your account password"
            required
            disabled={isLoading}
            autoComplete="current-password"
            autoFocus
          />

          {error && <AuthError message={error} />}

          <AuthButton type="submit" disabled={isLoading}>
            {isLoading ? 'Removing authenticator...' : 'Remove authenticator'}
          </AuthButton>
        </form>

        <AuthFooter>
          <AuthLink href="/sign-in">Back to sign in</AuthLink>
        </AuthFooter>
      </AuthLayout>
    );
  }

  // Request mode — no token, ask for email.
  return (
    <AuthLayout
      title="Lost your authenticator?"
      subtitle="Enter your email and we'll send you a link to recover access to your account."
    >
      <form onSubmit={handleRequest} className="space-y-6">
        <AuthInput
          id="email"
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          disabled={isLoading}
          autoComplete="email"
          autoFocus
        />

        {error && <AuthError message={error} />}

        <AuthButton type="submit" disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send recovery link'}
        </AuthButton>
      </form>

      <AuthFooter>
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </AuthFooter>
    </AuthLayout>
  );
}
