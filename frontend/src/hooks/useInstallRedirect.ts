import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

/**
 * Send the visitor to /install when this instance has never been set up.
 *
 * A fresh `docker compose up` has no account in it, and nobody arriving at a
 * new install knows the wizard's URL. Sign-in is where they land, so sign-in
 * is what has to redirect them — but the check is a concern of its own rather
 * than part of signing in, which is why it lives here: a page can opt in with
 * one line, and a page's own tests can stub it without reasoning about an
 * extra request their mocks did not expect.
 *
 * Failures are deliberately swallowed. If the check cannot run — backend down,
 * or an older build without the route — the sign-in form is still the correct
 * thing to show.
 */
export function useInstallRedirect(enabled: boolean = true): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        const status = await apiFetch<{ install_required: boolean }>('/install/status');
        if (!cancelled && status.install_required) {
          navigate('/install', { replace: true });
        }
      } catch {
        // Nothing to do: showing sign-in is the right fallback.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, navigate]);
}
