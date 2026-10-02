import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import AuthLayout, {
  AuthInput,
  AuthButton,
  AuthError,
  AuthLink,
  AuthFooter,
} from '../../components/AuthLayout';
import { logger } from '../../lib/logger';

export default function ActivateAccountPage() {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const navigate = useNavigate();
  const auth = useAuth();
  const token = searchParams.get('token');

  // Redirect if already authenticated
  useEffect(() => {
    if (auth.isAuthenticated && !auth.isLoading) {
      navigate('/', { replace: true });
    }
  }, [auth.isAuthenticated, auth.isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      setError('No activation token provided');
      return;
    }

    if (!password) {
      setError('Please enter a password');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await apiFetch('/auth/activate', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });

      setSuccess(true);

      // Refresh auth context to get user data
      await auth.refreshMe();

      // Show success message briefly then redirect
      setTimeout(() => {
        navigate('/', { replace: true });
      }, 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
      logger.error('Activation error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Invalid activation link" subtitle="">
        <div className="text-center">
          <p className="text-archive mb-6">
            The activation link is missing or invalid. Please check your email for the correct link.
          </p>
          <AuthLink href="/sign-in">Back to sign in</AuthLink>
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title="Account activated!" subtitle="">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-semantic-success/20 mb-4">
            <svg
              className="h-6 w-6 text-semantic-success"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <p className="text-archive">
            Your account has been successfully activated. Redirecting to your dashboard...
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Activate your account"
      subtitle="Set a password to activate your Madrona account."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <AuthInput
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          required
          disabled={isLoading}
          autoComplete="new-password"
          autoFocus
        />

        <AuthInput
          id="confirmPassword"
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your password"
          required
          disabled={isLoading}
          autoComplete="new-password"
        />

        {error && <AuthError message={error} />}

        <AuthButton type="submit" disabled={isLoading}>
          {isLoading ? 'Activating...' : 'Activate account'}
        </AuthButton>
      </form>

      <AuthFooter>
        Already have an account? <AuthLink href="/sign-in">Sign in</AuthLink>
      </AuthFooter>
    </AuthLayout>
  );
}
