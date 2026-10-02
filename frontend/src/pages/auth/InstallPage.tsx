import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
 * First-run install.
 *
 * A fresh `docker compose up` has no account in it. Before this page existed
 * the only way in was `python -m seeds.bootstrap_admin --email … --password …`
 * in a shell on the server, which is a poor first five minutes and puts a
 * password in someone's shell history.
 *
 * Self-redirects to sign-in if the instance is already installed, so a stale
 * bookmark cannot present a form that will only ever 409.
 */
export default function InstallPage() {
  const [organizationName, setOrganizationName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [withDemoData, setWithDemoData] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [success, setSuccess] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await apiFetch<{ install_required: boolean }>('/install/status');
        if (cancelled) return;
        if (!status.install_required) {
          navigate('/sign-in', { replace: true });
          return;
        }
      } catch (err) {
        // Reachability is the backend's problem to report; show the form
        // rather than stranding the operator on a spinner.
        logger.error('Could not read install status', err);
      }
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await apiFetch('/install', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          organization_name: organizationName,
          display_name: displayName || undefined,
          with_demo_data: withDemoData,
        }),
      });
      setSuccess(true);
      setTimeout(() => navigate('/sign-in', { replace: true }), 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Could not complete the install. Check the backend logs.');
        logger.error('Install failed', err);
      }
      setIsLoading(false);
    }
  };

  if (checking) {
    return <AuthLayout title="Madrona" subtitle="Checking this instance…"><div /></AuthLayout>;
  }

  if (success) {
    return (
      <AuthLayout title="Madrona is ready" subtitle="">
        <div className="text-center">
          <p className="text-archive">
            Your organization and administrator account have been created. Taking you to sign in…
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set up Madrona"
      subtitle="Create your organization and the first administrator account."
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <AuthInput
          id="organizationName"
          label="Organization name"
          type="text"
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          placeholder="Museum of Somewhere"
          required
          disabled={isLoading}
          autoFocus
        />

        <AuthInput
          id="email"
          label="Your email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@museum.org"
          required
          disabled={isLoading}
          autoComplete="username"
        />

        <AuthInput
          id="displayName"
          label="Your name (optional)"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Alex Curator"
          disabled={isLoading}
          autoComplete="name"
        />

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

        {/* Sample records. Off by default — a museum standing up its own
            instance does not want a catalogue of someone else's objects, but
            an evaluator has nothing to look at without it. */}
        <div className="flex items-start gap-3">
          <input
            id="withDemoData"
            type="checkbox"
            checked={withDemoData}
            onChange={(e) => setWithDemoData(e.target.checked)}
            disabled={isLoading}
            className="mt-1 h-4 w-4 rounded border-archive/40 text-clay focus:ring-clay"
          />
          <label htmlFor="withDemoData" className="text-sm text-archive">
            <span className="font-medium text-ink">Add sample records</span>
            <span className="block">
              Objects, loans, exhibitions and condition reports drawn from
              open-access collections, so there is something to explore. You can
              delete them later.
            </span>
          </label>
        </div>

        {error && <AuthError message={error} />}

        <AuthButton type="submit" disabled={isLoading}>
          {isLoading ? (withDemoData ? 'Setting up and adding samples…' : 'Setting up…') : 'Create organization'}
        </AuthButton>
      </form>

      <AuthFooter>
        Already installed? <AuthLink href="/sign-in">Sign in</AuthLink>
      </AuthFooter>
    </AuthLayout>
  );
}
