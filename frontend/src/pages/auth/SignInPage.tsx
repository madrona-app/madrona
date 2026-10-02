import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import MfaVerifyForm from '../../components/MfaVerifyForm';
import MfaSetupForm from '../../components/MfaSetupForm';
import AuthLayout, {
  AuthInput,
  AuthButton,
  AuthError,
  AuthSuccess,
  AuthLink,
} from '../../components/AuthLayout';
import { logger } from '../../lib/logger';
import { safeRedirect } from '../../lib/safeRedirect';
import { useInstallRedirect } from '../../hooks/useInstallRedirect';

// MFA flow states
type MfaState =
  | { type: 'none' }
  | { type: 'verify'; email: string; session: string; mfaType: 'totp' | 'sms' | 'email' }
  | { type: 'setup'; email: string; session: string };

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaState, setMfaState] = useState<MfaState>({ type: 'none' });

  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();

  // Resolve the post-login destination. Two possible sources:
  //   1. URL ?redirect= (set by nginx when an unauthenticated request hit a
  //      gated path like /admin or /docs/) — user-controllable, must validate.
  //   2. navigation state .from.pathname (set by in-app RequireAuth) — same
  //      origin by construction but routed through safeRedirect anyway as
  //      defense in depth.
  const queryRedirect = new URLSearchParams(location.search).get('redirect');
  const stateFrom = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const from = safeRedirect(queryRedirect ?? stateFrom);

  // Destinations served by a different HTML entry than the main SPA (the
  // platform-admin app at /admin, static /docs/). React Router can't reach
  // them — navigate() would dead-end on the catch-all NotFoundPage — so they
  // need a full page load. `from` is already same-origin via safeRedirect.
  const goTo = useCallback(
    (dest: string) => {
      if (dest.startsWith('/admin') || dest.startsWith('/docs')) {
        window.location.replace(dest);
      } else {
        navigate(dest, { replace: true });
      }
    },
    [navigate],
  );

  // If already authenticated, redirect to intended destination
  useEffect(() => {
    if (auth.isAuthenticated && !auth.isLoading) {
      goTo(from);
    }
  }, [auth.isAuthenticated, auth.isLoading, goTo, from]);

  // A fresh install has nobody to sign in as — send them to the wizard.
  useInstallRedirect(!auth.isAuthenticated && !auth.isLoading);

  // Complete login after MFA verification
  const completeLogin = async () => {
    await auth.refreshMe();

    // Redirect to intended destination or flow overview
    if (from !== '/') {
      goTo(from);
    } else if (auth.activeOrganizationId) {
      navigate(`/organizations/${auth.activeOrganizationId}`, { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError('Please enter your email and password');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Call login endpoint
      const response = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      // Check for MFA required
      if (response.mfaRequired) {
        setMfaState({
          type: 'verify',
          email: email.toLowerCase().trim(),
          session: response.session,
          mfaType: (response.mfaType as 'totp' | 'sms' | 'email') || 'totp',
        });
        return;
      }

      // Check for MFA setup required (admin users without MFA)
      if (response.mfaSetupRequired) {
        setMfaState({
          type: 'setup',
          email: email.toLowerCase().trim(),
          session: response.session,
        });
        return;
      }

      // Normal login success - the server has set the HttpOnly cookie
      await completeLogin();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Invalid email or password. Please try again.');
        } else if (err.status === 400) {
          setError('Please enter a valid email and password.');
        } else if (err.status === 404) {
          setError('No account found with this email. Please sign up first.');
        } else {
          setError('Unable to sign in. Please try again.');
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
      logger.error('Login error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // MFA verification handler — mfaType selects which Cognito challenge
  // the backend responds to (totp → SOFTWARE_TOKEN_MFA, sms → SMS_MFA,
  // email → EMAIL_OTP). Backend defaults to "totp" if absent, which is
  // why the prior version (no mfaType) worked for authenticator-app
  // users but would 401 on every email-MFA login.
  const handleMfaVerify = async (
    email: string,
    code: string,
    session: string,
    mfaType: 'totp' | 'sms' | 'email',
  ) => {
    const response = await apiFetch('/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, session, mfaType }),
    });
    return response;
  };

  // MFA setup start handler
  const handleMfaSetupStart = async (email: string, session: string) => {
    const response = await apiFetch('/auth/mfa/setup/start', {
      method: 'POST',
      body: JSON.stringify({ email, session }),
    });
    return response;
  };

  // MFA setup verify handler
  const handleMfaSetupVerify = async (email: string, code: string, session: string) => {
    const response = await apiFetch('/auth/mfa/setup/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, session }),
    });
    return response;
  };

  // Cancel MFA flow and return to login
  const handleMfaCancel = () => {
    setMfaState({ type: 'none' });
    setPassword(''); // Clear password for security
    setError(null);
  };

  // MFA setup complete - user needs to re-login to complete auth
  const handleMfaSetupComplete = () => {
    setMfaState({ type: 'none' });
    setPassword('');
    setError(null);
    // Show success message prompting re-login
    setError('MFA setup complete. Please sign in again with your new authenticator code.');
  };

  // Don't render form if already authenticated
  if (auth.isAuthenticated && !auth.isLoading) {
    return null;
  }

  // Render MFA verify form
  if (mfaState.type === 'verify') {
    return (
      <div className="min-h-screen bg-stone/40 flex items-center justify-center px-4">
        <MfaVerifyForm
          email={mfaState.email}
          session={mfaState.session}
          mfaType={mfaState.mfaType}
          onSuccess={completeLogin}
          onCancel={handleMfaCancel}
          onVerify={handleMfaVerify}
        />
      </div>
    );
  }

  // Render MFA setup form
  if (mfaState.type === 'setup') {
    return (
      <div className="min-h-screen bg-stone/40 flex items-center justify-center px-4">
        <MfaSetupForm
          email={mfaState.email}
          session={mfaState.session}
          onSuccess={handleMfaSetupComplete}
          onCancel={handleMfaCancel}
          onSetupStart={handleMfaSetupStart}
          onSetupVerify={handleMfaSetupVerify}
        />
      </div>
    );
  }

  // Check if we have a success message (after MFA setup)
  const isSuccessMessage = error?.includes('MFA setup complete');

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your account">
      <form onSubmit={handleSubmit} className="space-y-6">
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
        />

        <AuthInput
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          required
          disabled={isLoading}
          autoComplete="current-password"
        />

        <div className="flex justify-end">
          <AuthLink href="/forgot-password" className="text-sm">
            Forgot password?
          </AuthLink>
        </div>

        {error && (
          isSuccessMessage ? (
            <AuthSuccess message={error} />
          ) : (
            <AuthError message={error} />
          )
        )}

        <AuthButton type="submit" disabled={isLoading}>
          {isLoading ? 'Signing in...' : 'Sign in'}
        </AuthButton>
      </form>

    </AuthLayout>
  );
}
