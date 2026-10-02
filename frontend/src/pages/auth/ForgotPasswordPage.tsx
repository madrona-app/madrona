import { useState } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import AuthLayout, {
  AuthInput,
  AuthButton,
  AuthError,
  AuthLink,
  AuthFooter,
} from '../../components/AuthLayout';
import { logger } from '../../lib/logger';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await apiFetch('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      // Always show success message (even if email doesn't exist)
      // to prevent email enumeration
      setIsSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setError('Please enter a valid email address.');
        } else {
          setError('Something went wrong. Please try again.');
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
      logger.error('Password reset request error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Success state - email sent
  if (isSubmitted) {
    return (
      <AuthLayout title="Check your email" subtitle="">
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
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-archive mb-6">
            If an account exists for <span className="font-medium text-ink">{email}</span>, we've sent
            instructions to reset your password.
          </p>
          <p className="text-sm text-archive mb-6">
            The link will expire in 1 hour. If you don't see the email, check your spam folder.
          </p>
          <AuthLink href="/sign-in">Back to sign in</AuthLink>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Forgot password?"
      subtitle="Enter your email and we'll send you a link to reset your password."
    >
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
          autoFocus
        />

        {error && <AuthError message={error} />}

        <AuthButton type="submit" disabled={isLoading}>
          {isLoading ? 'Sending...' : 'Send reset link'}
        </AuthButton>
      </form>

      <AuthFooter>
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </AuthFooter>
    </AuthLayout>
  );
}
