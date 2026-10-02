import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, LayoutGrid, Lock } from 'lucide-react';

import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

/** Prefer the server's own message; the 409s here explain themselves. */
function toReadableError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = (err.details as Record<string, unknown> | undefined)?.message;
    if (typeof detail === 'string' && detail) return detail;
    if (err.message) return err.message;
  }
  return fallback;
}

interface OrgApplication {
  key: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  status: string;
  enabled: boolean;
  available: boolean;
  unavailable_reason: string | null;
  can_disable: boolean;
}

export default function OrganizationApplicationsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const auth = useAuth();

  const [apps, setApps] = useState<OrgApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await apiFetch<{ applications: OrgApplication[] }>(
        `/organizations/${orgId}/applications`,
      );
      setApps(res.applications ?? []);
      setError(null);
    } catch (err) {
      logger.error('Failed to load applications', err);
      setError(toReadableError(err, 'Could not load applications.'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (app: OrgApplication) => {
      if (!orgId) return;
      const next = !app.enabled;
      setBusyKey(app.key);
      setError(null);
      try {
        const updated = await apiFetch<OrgApplication>(
          `/organizations/${orgId}/applications/${app.key}`,
          { method: 'PUT', body: JSON.stringify({ enabled: next }) },
        );
        setApps((prev) => prev.map((a) => (a.key === app.key ? updated : a)));
        // Navigation, the app switcher and the route guards all read the
        // application list off /me, so it has to be refetched here or the
        // change only shows up after a reload.
        await auth.refreshMe();
      } catch (err) {
        logger.error('Failed to update application', err);
        setError(toReadableError(err, `Could not update ${app.display_name}.`));
      } finally {
        setBusyKey(null);
      }
    },
    [orgId, auth],
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <MadronaLoader />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-8 h-8 text-forest" />
          <h1 className="text-2xl font-semibold text-ink">Applications</h1>
        </div>
        <p className="text-sm text-archive mt-1">
          Choose which applications this organization uses. Turning one off
          removes it from navigation and blocks its pages; nothing is deleted,
          and turning it back on restores everything.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 bg-semantic-error/10 border border-semantic-error/30 text-semantic-error px-4 py-3 rounded-institutional text-sm"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <ul className="bg-parchment border border-lichen rounded-institutional divide-y divide-lichen">
        {apps.map((app) => {
          const comingSoon = app.status === 'coming_soon';
          const lockedOn = app.enabled && !app.can_disable;
          // Turning something OFF is always allowed (short of the locked and
          // last-app rules the server enforces). Only turning it ON is gated
          // on the deployment being able to serve it — otherwise an app that
          // got switched on before a provider was removed can never be
          // switched back off.
          const cannotEnable = !app.enabled && (!app.available || comingSoon);
          const disabled = cannotEnable || lockedOn || busyKey === app.key;
          // The stored setting can say "on" while the deployment cannot serve
          // it. Say so plainly rather than leaving a checked switch implying
          // the app works.
          const onButUnavailable = app.enabled && !app.available;

          return (
            <li key={app.key} className="px-6 py-4 flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-ink">{app.display_name}</span>
                  {comingSoon && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-stone text-accessible-gray">
                      Coming soon
                    </span>
                  )}
                  {lockedOn && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-stone text-accessible-gray">
                      <Lock className="w-3 h-3" aria-hidden="true" />
                      Required
                    </span>
                  )}
                  {onButUnavailable && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-semantic-warning/10 text-semantic-warning">
                      Unavailable
                    </span>
                  )}
                </div>
                {app.description && (
                  <p className="text-sm text-archive mt-1 max-w-3xl">{app.description}</p>
                )}
                {!app.available && app.unavailable_reason && (
                  <p className="text-sm text-semantic-warning mt-1 max-w-3xl">
                    {app.unavailable_reason}
                  </p>
                )}
                {lockedOn && (
                  <p className="text-sm text-archive mt-1">
                    Other applications reference its records, so it cannot be turned off.
                  </p>
                )}
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={app.enabled}
                aria-label={`${app.display_name} enabled`}
                disabled={disabled}
                onClick={() => toggle(app)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  app.enabled ? 'bg-azurite' : 'bg-stone'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-parchment transition-transform ${
                    app.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
