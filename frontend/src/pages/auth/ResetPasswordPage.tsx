import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../../lib/apiClient';
import AuthLayout, {
  AuthInput,
  AuthButton,
  AuthError,
  AuthLink,
  AuthFooter,
} from '../../components/AuthLayout';
import { logger } from '../../lib/logger';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  // Redirect if no token provided
  useEffect(() => {
    if (!token) {
      navigate('/forgot-password', { replace: true });
    }
  }, [token, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate passwords
    if (!password) {
      setError('Please enter a new password');
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
      await apiFetch('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });

      setIsSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setError('This reset link is invalid or has expired. Please request a new one.');
        } else if (err.status === 400) {
          const message = err.message || 'Invalid request';
          if (message.includes('already been used')) {
            setError('This reset link has already been used. Please request a new one.');
          } else if (message.includes('expired')) {
            setError('This reset link has expired. Please request a new one.');
          } else if (message.includes('8 characters')) {
            setError('Password must be at least 8 characters.');
          } else {
            setError(message);
          }
        } else {
          setError('Something went wrong. Please try again.');
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
      logger.error('Password reset confirm error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Success state
  if (isSuccess) {
    return (
      <AuthLayout title="Password reset!" subtitle="">
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
          <p className="text-archive mb-6">
            Your password has been successfully reset. You can now sign in with your new password.
          </p>
          <AuthLink href="/sign-in">Sign in</AuthLink>
        </div>
      </AuthLayout>
    );
  }

  // No token - redirect handled by useEffect
  if (!token) {
    return null;
  }

  return (
    <AuthLayout title="Set new password" subtitle="Enter your new password below.">
      <form onSubmit={handleSubmit} className="space-y-6">
        <AuthInput
          id="password"
          label="New password"
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
          label="Confirm new password"
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
          {isLoading ? 'Resetting password...' : 'Reset password'}
        </AuthButton>
      </form>

      <AuthFooter>
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </AuthFooter>
    </AuthLayout>
  );
}
