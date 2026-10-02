import { useState, useEffect, useRef } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

interface TimelineStep {
  step: string;
  status: string; // pending | running | completed | failed
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

interface JobDetail {
  job_id: string;
  status: string; // pending | running | completed | failed
  organization_id: string | null;
  organization_slug: string | null;
  admin_user_id: string | null;
  current_step: string | null;
  error_message: string | null;
  error_step: string | null;
  retry_count: number | null;
  max_retries: number | null;
  // steps is keyed by step name; values include the step's result dict.
  // Typed loosely because the result shape varies by step.
  steps: Record<string, { status: string; result?: Record<string, unknown>; error?: string }> | null;
  timeline: TimelineStep[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
}

const POLL_INTERVAL_MS = 3000;

// Human-readable labels for each saga step. Falls back to the raw key
// for steps not in the map (e.g. future additions in phase 2/3).
const STEP_LABELS: Record<string, string> = {
  validate_input: 'Validate input',
  create_organization: 'Create organization',
  enable_applications: 'Enable applications',
  create_admin_user: 'Create admin user',
  create_cognito_user: 'Create Cognito user',
  send_welcome_email: 'Send welcome email',
  seed_reference_data: 'Seed reference data',
  seed_collections_met: 'Seed Met Museum collections',
  seed_collections_smithsonian: 'Seed Smithsonian collections',
  seed_collections_rijks: 'Seed Rijksmuseum collections',
  seed_procedures_acquisitions: 'Seed acquisition records',
  seed_procedures_loans: 'Seed loan records (in + out)',
  seed_procedures_exhibitions: 'Seed exhibition records',
  seed_procedures_conservation: 'Seed conservation treatments',
  seed_procedures_condition_reports: 'Seed condition reports',
};

function StepIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return <CheckCircle2 className="w-5 h-5 text-semantic-success" aria-label="completed" />;
  }
  if (status === 'running') {
    return <Loader2 className="w-5 h-5 text-bark animate-spin" aria-label="running" />;
  }
  if (status === 'failed') {
    return <AlertCircle className="w-5 h-5 text-semantic-error" aria-label="failed" />;
  }
  return <Circle className="w-5 h-5 text-archive" aria-label="pending" />;
}

function formatResult(result?: Record<string, unknown>): string | null {
  if (!result) return null;
  // Skip purely-skipped steps quietly.
  if (result.skipped === true) {
    const reason = typeof result.reason === 'string' ? result.reason : 'skipped';
    return `Skipped — ${reason}`;
  }
  // Build a compact key=value summary of numeric counters in the result.
  // Phase 1b seeders return shapes like {departments_created, locations_created,
  // contacts_created} or {objects_added_this_run, images_uploaded, errors}.
  const counters = Object.entries(result)
    .filter(([k, v]) =>
      typeof v === 'number' &&
      !['errors_total'].includes(k) &&
      !k.startsWith('_'),
    )
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');
  return counters || null;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export default function ProvisioningJobDetailPage() {
  // Mounted under the admin app at /admin/provision-jobs/:jobId — there is
  // no orgId segment in the route. (The earlier route lived under the main
  // app and required `orgId`, which produced /organizations/undefined/...
  // when navigated from the admin shell.)
  const { jobId } = useParams<{ jobId: string }>();
  const { user, applications, activeOrganizationId } = useAuth();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Per-step rerun tracking — null when no rerun is in-flight, else the
  // step_key of the step being rerun. Used to disable that single row's
  // button without freezing the whole timeline.
  const [rerunningStep, setRerunningStep] = useState<string | null>(null);

  // Use a ref so the polling closure always sees the latest status without
  // needing job in the deps (which would cause re-mounting the timer every
  // poll).
  const statusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const data = await apiFetch<JobDetail>(`/platform/provision/${jobId}`);
        if (cancelled) return;
        setJob(data);
        statusRef.current = data.status;
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        logger.error('Failed to load provisioning job:', err);
        setError(err instanceof Error ? err.message : 'Failed to load job');
        setLoading(false);
      }
    };

    fetchOnce();

    // Poll while the saga is still running. Stop when terminal.
    const interval = setInterval(() => {
      if (statusRef.current === 'completed' || statusRef.current === 'failed') {
        return; // leave the interval alive, but no-op; cleanup happens on unmount.
      }
      fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  const handleRetry = async () => {
    if (!jobId) return;
    setRetrying(true);
    setError(null);
    try {
      await apiFetch(`/platform/provision/${jobId}/retry`, { method: 'PUT' });
      // Refresh once; the saga is back in running state and the poller
      // will pick up further updates.
      const data = await apiFetch<JobDetail>(`/platform/provision/${jobId}`);
      setJob(data);
      statusRef.current = data.status;
    } catch (err) {
      logger.error('Retry failed:', err);
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const handleRerunStep = async (stepKey: string) => {
    if (!jobId) return;
    const label = STEP_LABELS[stepKey] || stepKey;
    const ok = window.confirm(
      `Re-run "${label}" and every later step?\n\n` +
      `This resets each affected step to pending and re-dispatches the saga. ` +
      `Earlier completed steps stay as-is. Existing seeded data is not deleted; ` +
      `seeders are idempotent and will skip rows that already exist.`,
    );
    if (!ok) return;
    setRerunningStep(stepKey);
    setError(null);
    try {
      await apiFetch(
        `/platform/provision/${jobId}/steps/${encodeURIComponent(stepKey)}/rerun`,
        { method: 'POST' },
      );
      const data = await apiFetch<JobDetail>(`/platform/provision/${jobId}`);
      setJob(data);
      statusRef.current = data.status;
    } catch (err) {
      logger.error('Rerun step failed:', err);
      setError(err instanceof Error ? err.message : 'Rerun failed');
    } finally {
      setRerunningStep(null);
    }
  };

  const handleCancel = async () => {
    if (!jobId || !job) return;
    // Different confirm text depending on what the call will do.
    const isReset = job.status === 'failed';
    const message = isReset
      ? 'Reset the retry counter on this failed job so you can hit Retry again? Status stays failed.'
      : 'Cancel this provisioning job? The saga exits at the next step boundary; a worker mid-step (e.g., seeding Met Museum collections) may take several minutes to notice. You can hit Retry afterwards.';
    const ok = window.confirm(message);
    if (!ok) return;
    setCancelling(true);
    setError(null);
    try {
      await apiFetch(`/platform/provision/${jobId}/cancel`, { method: 'POST' });
      const data = await apiFetch<JobDetail>(`/platform/provision/${jobId}`);
      setJob(data);
      statusRef.current = data.status;
    } catch (err) {
      logger.error('Cancel failed:', err);
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  // Auth gate (matches the convention in OrganizationsPage).
  if (!user) {
    return <Navigate to="/signin" replace />;
  }
  if (user && !user.is_platform_admin) {
    return <Navigate to={activeOrganizationId ? getDefaultLandingPath(activeOrganizationId, applications) : '/'} replace />;
  }

  if (loading) {
    return (
      <div className="p-6">
        <MadronaLoader />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-6">
        <div className="bg-semantic-error/10 border border-semantic-error/20 rounded-lg p-4 text-semantic-error">
          {error || 'Job not found'}
        </div>
      </div>
    );
  }

  const isTerminal = job.status === 'completed' || job.status === 'failed';
  const statusBadge = (() => {
    if (job.status === 'completed') {
      return 'bg-semantic-success/10 text-semantic-success';
    }
    if (job.status === 'failed') {
      return 'bg-semantic-error/10 text-semantic-error';
    }
    return 'bg-semantic-info/10 text-semantic-info';
  })();

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Breadcrumb back to org list */}
      <div className="flex items-center justify-between">
        <Link
          to="/organizations"
          className="inline-flex items-center gap-2 text-sm text-bark hover:text-copper-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to organizations
        </Link>
        {!isTerminal && (
          <div className="inline-flex items-center gap-2 text-sm text-archive">
            <Loader2 className="w-4 h-4 animate-spin" />
            Polling every {POLL_INTERVAL_MS / 1000}s
          </div>
        )}
      </div>

      {/* Header */}
      <div className="bg-parchment-warm rounded-lg border border-lichen p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-copper" />
              <h1 className="text-xl font-semibold text-ink">
                Sandbox Provisioning
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-archive">
              <span>
                <span className="text-ink/60">Slug:</span>{' '}
                <span className="font-mono text-ink">
                  {job.organization_slug || '—'}
                </span>
              </span>
              <span>
                <span className="text-ink/60">Job:</span>{' '}
                <span className="font-mono text-ink">{job.job_id.slice(0, 12)}…</span>
              </span>
              {job.retry_count !== null && job.retry_count > 0 && (
                <span>
                  <span className="text-ink/60">Retry:</span> {job.retry_count}/
                  {job.max_retries ?? '?'}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${statusBadge}`}
            >
              {job.status === 'running' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {job.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5" />}
              {job.status === 'failed' && <AlertCircle className="w-3.5 h-3.5" />}
              {job.status}
            </span>
            {(!isTerminal || job.status === 'failed') && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="btn-tertiary inline-flex items-center gap-2 text-sm disabled:opacity-50"
                aria-label={job.status === 'failed' ? 'Reset retry counter' : 'Cancel provisioning job'}
              >
                {cancelling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                {job.status === 'failed' ? 'Reset retries' : 'Cancel'}
              </button>
            )}
          </div>
        </div>

        {/* Failure block + retry */}
        {job.status === 'failed' && (
          <div className="mt-4 bg-semantic-error/5 border border-semantic-error/20 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-semantic-error mb-1">
                  Failed at: {STEP_LABELS[job.error_step ?? ''] || job.error_step}
                </div>
                <div className="text-sm text-ink/80 break-words">
                  {job.error_message}
                </div>
              </div>
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying}
                className="btn-primary inline-flex items-center gap-2 px-4 py-2 disabled:opacity-50"
              >
                {retrying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Retry
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step timeline */}
      <div className="bg-parchment rounded-lg border border-lichen overflow-hidden">
        <div className="px-6 py-3 border-b border-lichen text-sm font-medium text-ink">
          Steps
        </div>
        <ul className="divide-y divide-lichen">
          {job.timeline.map((step) => {
            const label = STEP_LABELS[step.step] || step.step;
            const result = job.steps?.[step.step]?.result;
            const summary = formatResult(result);
            // Rerun is meaningful only on terminal job states. While the
            // job is running, allowing rerun would race with the worker.
            const canRerun = job.status === 'completed' || job.status === 'failed';
            const isThisRerunning = rerunningStep === step.step;
            return (
              <li key={step.step} className="px-6 py-3 flex items-start gap-3">
                <StepIcon status={step.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-ink">{label}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      {step.duration_ms !== null && (
                        <span className="inline-flex items-center gap-1 text-xs text-archive">
                          <Clock className="w-3 h-3" />
                          {formatDuration(step.duration_ms)}
                        </span>
                      )}
                      {canRerun && (
                        <button
                          type="button"
                          onClick={() => handleRerunStep(step.step)}
                          disabled={isThisRerunning || rerunningStep !== null}
                          className="inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label={`Rerun "${label}" and later steps`}
                          title="Rerun this step and every step after it"
                        >
                          {isThisRerunning ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Rerun from here
                        </button>
                      )}
                    </div>
                  </div>
                  {summary && (
                    <div className="text-xs text-archive mt-1 break-words">
                      {summary}
                    </div>
                  )}
                  {step.error && (
                    <div className="text-xs text-semantic-error mt-1 break-words">
                      {step.error}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Success footer with link to the new org */}
      {job.status === 'completed' && job.organization_id && (
        <div className="bg-semantic-success/5 border border-semantic-success/20 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-semantic-success" />
            <span className="font-medium text-ink">Sandbox ready</span>
          </div>
          <p className="text-sm text-ink/80 mb-4">
            The org is provisioned and seed data is in place. The admin will get
            a Cognito invite at the address you provided.
          </p>
          <Link
            to="/organizations"
            className="inline-flex items-center gap-2 btn-secondary px-4 py-2"
          >
            View all organizations
          </Link>
        </div>
      )}
    </div>
  );
}
