import React, { useState, useEffect, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import {
  ProvisioningJobListResponseSchema,
  type ProvisioningJobOut,
} from '../../lib/schemas/generated';

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'running', label: 'Running' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const PAGE_SIZE = 25;
// Auto-refresh while at least one job on the visible page is in-flight.
const POLL_INTERVAL_MS = 5000;

function StatusBadge({ status }: { status: string }) {
  // Map status → semantic color. Mirrors ProvisioningJobDetailPage's
  // step-icon palette so both pages read consistently.
  const tones: Record<string, string> = {
    completed: 'bg-semantic-success/10 text-semantic-success',
    running: 'bg-bark/10 text-bark',
    pending: 'bg-stone/40 text-archive',
    failed: 'bg-semantic-error/10 text-semantic-error',
    cancelled: 'bg-stone/40 text-archive',
  };
  const tone = tones[status] ?? 'bg-stone/40 text-archive';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {status === 'running' && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
      {status === 'completed' && <CheckCircle2 className="w-3 h-3" aria-hidden="true" />}
      {status === 'failed' && <AlertCircle className="w-3 h-3" aria-hidden="true" />}
      {(status === 'pending' || status === 'cancelled') && <Clock className="w-3 h-3" aria-hidden="true" />}
      {status}
    </span>
  );
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ProvisioningJobsListPage() {
  const { user, applications: _applications } = useAuth();
  void _applications;

  const [jobs, setJobs] = useState<ProvisioningJobOut[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [offset, setOffset] = useState(0);
  // Per-row "cancel in flight" tracker so we can disable just that row's
  // button without locking the whole table.
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadJobs = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (search) params.set('search', search);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    try {
      const raw = await apiFetch(`/platform/provision/jobs?${params.toString()}`, { signal });
      const parsed = ProvisioningJobListResponseSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn('ProvisioningJobsListPage: response shape mismatch', parsed.error.format());
        // Best-effort fallback: trust server, just cast.
        const data = raw as { items?: ProvisioningJobOut[]; total?: number };
        setJobs(data.items ?? []);
        setTotal(data.total ?? 0);
      } else {
        setJobs(parsed.data.items);
        setTotal(parsed.data.total);
      }
      setError(null);
    } catch (err) {
      if (signal?.aborted) return;
      logger.error('Failed to load provisioning jobs', err);
      setError(err instanceof Error ? err.message : 'Failed to load provisioning jobs');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, offset]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadJobs(controller.signal);
    return () => controller.abort();
  }, [loadJobs]);

  // Poll while any visible job is in-flight (pending or running). Stops
  // automatically once everything settles.
  useEffect(() => {
    const hasInflight = jobs.some((j) => j.status === 'pending' || j.status === 'running');
    if (!hasInflight) return;
    const id = window.setInterval(() => {
      loadJobs();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [jobs, loadJobs]);

  if (!user) return <Navigate to="/signin" replace />;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setOffset(0);
  };

  const handleStatusChange = (key: string) => {
    setStatusFilter(key);
    setOffset(0);
  };

  const handleCancel = async (job: ProvisioningJobOut) => {
    const isReset = job.status === 'failed';
    const ok = window.confirm(
      isReset
        ? 'Reset the retry counter on this failed job? Status stays failed; you can hit Retry afterwards.'
        : 'Cancel this provisioning job? The saga exits at the next step boundary. You can hit Retry from the detail page afterwards.',
    );
    if (!ok) return;
    const jobId = job.job_id;
    setCancellingId(jobId);
    try {
      await apiFetch(`/platform/provision/${jobId}/cancel`, { method: 'POST' });
      await loadJobs();
    } catch (err) {
      logger.error('Cancel failed', err);
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancellingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-bark" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-ink">Provisioning Jobs</h1>
          </div>
          <p className="text-archive mt-1">
            Org-provisioning saga history. Click a row for the timeline + retry controls.
          </p>
        </div>
        <button
          onClick={() => loadJobs()}
          className="btn-tertiary flex items-center gap-2"
          aria-label="Refresh"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Filter chips + search */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map(({ key, label }) => {
            const active = statusFilter === key;
            return (
              <button
                key={key || 'all'}
                role="tab"
                aria-selected={active}
                onClick={() => handleStatusChange(key)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  active
                    ? 'bg-forest text-parchment'
                    : 'bg-parchment-warm border border-lichen text-ink hover:bg-stone'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSearchSubmit} className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-archive"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by slug…"
              aria-label="Search by slug"
              className="pl-8 pr-3 py-1.5 rounded-md border border-lichen bg-parchment text-ink text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1 focus-visible:outline-none"
            />
          </div>
          {(search || searchInput) && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setOffset(0);
              }}
              className="text-sm text-archive hover:text-ink"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 flex justify-center">
          <MadronaLoader />
        </div>
      ) : error ? (
        <div className="rounded-md border border-semantic-error/20 bg-semantic-error/10 p-4 text-semantic-error">
          {error}
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-md border border-dashed border-lichen p-8 text-center">
          <p className="text-archive">No provisioning jobs match these filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-lichen bg-parchment-warm">
          <table className="w-full text-sm">
            <thead className="bg-parchment border-b border-lichen text-archive">
              <tr>
                <th className="text-left font-medium px-4 py-2">Org</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-left font-medium px-4 py-2">Step</th>
                <th className="text-left font-medium px-4 py-2">Started</th>
                <th className="text-left font-medium px-4 py-2">Retries</th>
                <th className="text-left font-medium px-4 py-2 sr-only">Open</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.job_id} className="border-b border-lichen last:border-b-0 hover:bg-stone/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">
                      {job.organization_slug ?? '(slug pending)'}
                    </div>
                    <div className="text-xs text-archive truncate max-w-xs">{job.admin_email ?? ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                    {job.status === 'failed' && job.error_step && (
                      <div className="text-xs text-semantic-error mt-1">at {job.error_step}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {job.status === 'running' && job.current_step
                      ? job.current_step
                      : job.status === 'completed'
                        ? '—'
                        : (job.current_step ?? '—')}
                  </td>
                  <td className="px-4 py-3 text-ink" title={job.started_at ?? job.created_at ?? ''}>
                    {formatRelative(job.started_at ?? job.created_at)}
                  </td>
                  <td className="px-4 py-3 text-ink">{job.retry_count ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-3">
                      {(job.status === 'pending' || job.status === 'running' || job.status === 'failed') && (
                        <button
                          type="button"
                          onClick={() => handleCancel(job)}
                          disabled={cancellingId === job.job_id}
                          className="inline-flex items-center gap-1 text-archive hover:text-semantic-error text-sm font-medium disabled:opacity-50"
                          aria-label={
                            job.status === 'failed'
                              ? `Reset retries on job ${job.organization_slug ?? job.job_id}`
                              : `Cancel job ${job.organization_slug ?? job.job_id}`
                          }
                        >
                          {cancellingId === job.job_id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                          {job.status === 'failed' ? 'Reset' : 'Cancel'}
                        </button>
                      )}
                      <Link
                        to={`/provision-jobs/${job.job_id}`}
                        className="text-bark hover:text-copper-dark text-sm font-medium"
                      >
                        Open →
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-archive">
          <span>
            Page {currentPage} of {totalPages} · {total} jobs total
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="btn-tertiary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="btn-tertiary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
