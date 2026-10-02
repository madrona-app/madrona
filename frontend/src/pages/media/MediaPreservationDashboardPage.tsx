import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  AlertTriangle,
  Server,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '../../lib/utils';
import { useOrganization } from '../../contexts/useOrganization';
import { useToast } from '../../contexts/ToastContext';
import {
  getFormatRiskSummary,
  getAtRiskMedia,
  getReplicationSummary,
  getPreservationPolicies,
  getActionPlans,
  approveActionPlan,
  cancelActionPlan,
  deactivatePreservationPolicy,
} from '../../lib/api/preservation';
import type {
  RiskLevel,
  PreservationPolicy,
  ReplicationSummary as ReplicationSummaryType,
} from '../../lib/api/preservation';
import { PolicyFormSlideOver } from '../../components/dam/PolicyFormSlideOver';
import { formatDateShort } from '@/lib/formatters';
import ConfirmDialog from '../../components/ConfirmDialog';
import { MadronaProgressBar } from '../../components/ui/MadronaLoader';

// ── Risk colors ────────────────────────────────────────────────────

const RISK_COLORS: Record<RiskLevel, string> = {
  critical: 'rgb(var(--color-semantic-error))',
  high: 'rgb(var(--color-semantic-warning))',
  moderate: 'rgb(var(--color-bark))',
  low: 'rgb(var(--color-semantic-success))',
  unknown: 'rgb(var(--color-archive))',
};

const RISK_BADGE_STYLES: Record<RiskLevel, string> = {
  critical: 'bg-semantic-error/10 text-semantic-error',
  high: 'bg-semantic-warning/10 text-semantic-warning',
  moderate: 'bg-bark/10 text-bark',
  low: 'bg-semantic-success/10 text-semantic-success',
  unknown: 'bg-stone text-archive',
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  retention: 'Retention',
  format_migration: 'Format Migration',
  normalization: 'Normalization',
  fixity_schedule: 'Fixity Schedule',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  migrate_format: 'Migrate Format',
  review_retention: 'Review Retention',
  delete: 'Delete',
  archive: 'Archive',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-semantic-warning/10 text-semantic-warning',
  approved: 'bg-semantic-success/10 text-semantic-success',
  in_progress: 'bg-semantic-info/10 text-semantic-info',
  completed: 'bg-semantic-success/10 text-semantic-success',
  failed: 'bg-semantic-error/10 text-semantic-error',
  cancelled: 'bg-stone text-archive',
};

// ── Helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return formatDateShort(iso);
}

// ── Page ───────────────────────────────────────────────────────────

export default function MediaPreservationDashboardPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;

  if (!organizationId) return null;

  return (
    <div className="max-w-5xl space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-forest/10 rounded-lg">
            <ShieldCheck size={24} className="text-forest" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Digital Preservation</h1>
            <p className="text-sm text-archive">
              OAIS-compliant format risk, fixity health, and preservation activity
            </p>
          </div>
        </div>
      </div>

      <FormatRiskSection organizationId={organizationId} />
      <ReplicationHealthSection organizationId={organizationId} />
      <AtRiskMediaSection organizationId={organizationId} />
      <PoliciesSection organizationId={organizationId} />
      <ActionPlansSection organizationId={organizationId} />
    </div>
  );
}

// ── Section A: Format Risk ─────────────────────────────────────────

function FormatRiskSection({ organizationId }: { organizationId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['preservation-format-risk', organizationId],
    queryFn: () => getFormatRiskSummary(organizationId),
    staleTime: 5 * 60_000,
  });

  // Aggregate counts by risk level for pie chart
  const chartData = useMemo(() => {
    if (!data?.formats.length) return [];
    const byLevel: Record<string, number> = {};
    for (const f of data.formats) {
      byLevel[f.risk_level] = (byLevel[f.risk_level] || 0) + f.count;
    }
    return Object.entries(byLevel).map(([level, count]) => ({
      name: level,
      value: count,
      color: RISK_COLORS[level as RiskLevel],
    }));
  }, [data]);

  return (
    <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
      <div className="px-6 py-4 border-b border-lichen">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-forest" />
          <h2 className="text-lg font-semibold text-ink">Format Risk Summary</h2>
        </div>
        <p className="text-sm text-archive mt-1">
          Distribution of media files by format obsolescence risk
        </p>
      </div>
      <div className="px-6 py-5">
        {isLoading && <LoadingSkeleton />}
        {error && <ErrorBanner message="Failed to load format risk data" />}
        {data && (
          chartData.length === 0 ? (
            <p className="text-sm text-archive">No format data available.</p>
          ) : (
            <div className="flex flex-col md:flex-row gap-6 items-center">
              <div className="w-48 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      dataKey="value"
                      stroke="none"
                    >
                      {chartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [String(value ?? 0), 'Files']}
                      contentStyle={{ borderRadius: 8, border: '1px solid #E4DCCB', fontSize: 13 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-archive">
                      <th className="pb-2 font-medium">Format</th>
                      <th className="pb-2 font-medium">PUID</th>
                      <th className="pb-2 font-medium">Risk</th>
                      <th className="pb-2 font-medium text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.formats.map((f, i) => (
                      <tr key={i} className="border-t border-lichen/50">
                        <td className="py-1.5 text-ink">{f.format_name}</td>
                        <td className="py-1.5 font-mono text-xs text-archive">{f.pronom_puid}</td>
                        <td className="py-1.5">
                          <RiskBadge level={f.risk_level} />
                        </td>
                        <td className="py-1.5 text-right text-ink">{f.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}

// ── Section B: Replication Health ──────────────────────────────────

function ReplicationHealthSection({ organizationId }: { organizationId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['preservation-replication', organizationId],
    queryFn: () => getReplicationSummary(organizationId),
    staleTime: 5 * 60_000,
  });

  return (
    <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
      <div className="px-6 py-4 border-b border-lichen">
        <div className="flex items-center gap-2">
          <Server size={18} className="text-forest" />
          <h2 className="text-lg font-semibold text-ink">Replication Health</h2>
        </div>
      </div>
      <div className="px-6 py-5">
        {isLoading && <LoadingSkeleton />}
        {error && <ErrorBanner message="Failed to load replication data" />}
        {data && <ReplicationContent data={data} />}
      </div>
    </section>
  );
}

function ReplicationContent({ data }: { data: ReplicationSummaryType }) {
  const coverage = Math.round(data.coverage_percent);
  const verStatus = data.by_verification_status;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Media" value={data.total_media} />
        <StatCard label="Replicated" value={data.replicated_media} />
        <StatCard label="Unreplicated" value={data.unreplicated_media} />
        <StatCard label="Coverage" value={`${coverage}%`} />
      </div>

      {/* Coverage bar */}
      <MadronaProgressBar value={coverage} label="Replication Coverage" />

      {/* Verification breakdown */}
      <div>
        <p className="text-xs text-archive mb-2">Verification Status</p>
        <div className="flex gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <CheckCircle size={14} className="text-semantic-success" />
            <span className="text-ink">{verStatus.verified || 0} verified</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={14} className="text-archive" />
            <span className="text-ink">{verStatus.unverified || 0} unverified</span>
          </span>
          {(verStatus.mismatch || 0) > 0 && (
            <span className="flex items-center gap-1.5">
              <XCircle size={14} className="text-semantic-error" />
              <span className="text-ink">{verStatus.mismatch} mismatch</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-4 bg-parchment rounded-lg border border-lichen">
      <p className="text-xs text-archive mb-1">{label}</p>
      <p className="text-xl font-semibold text-ink">{value}</p>
    </div>
  );
}

// ── Section C: At-Risk Media ───────────────────────────────────────

function AtRiskMediaSection({ organizationId }: { organizationId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['preservation-at-risk', organizationId],
    queryFn: () => getAtRiskMedia(organizationId, { limit: 25 }),
    staleTime: 5 * 60_000,
  });

  // Don't render if no at-risk media
  if (!isLoading && !error && (!data || data.total === 0)) return null;

  return (
    <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
      <div className="px-6 py-4 border-b border-lichen">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-semantic-warning" />
          <h2 className="text-lg font-semibold text-ink">At-Risk Media</h2>
          {data && (
            <span className="text-sm text-archive ml-auto">{data.total} files</span>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        {isLoading && <div className="px-6 py-5"><LoadingSkeleton /></div>}
        {error && <div className="px-6 py-5"><ErrorBanner message="Failed to load at-risk media" /></div>}
        {data && data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-archive border-b border-lichen">
                <th className="px-6 py-2 font-medium">Filename</th>
                <th className="px-3 py-2 font-medium">Format</th>
                <th className="px-3 py-2 font-medium">PUID</th>
                <th className="px-3 py-2 font-medium">Risk</th>
                <th className="px-3 py-2 font-medium text-right">Size</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.media_id} className="border-t border-lichen/50 hover:bg-stone/20">
                  <td className="px-6 py-2">
                    <Link
                      to={`/organizations/${organizationId}/media/${item.media_id}`}
                      className="text-bark hover:text-copper-dark"
                    >
                      {item.filename}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink">{item.format_name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-archive">{item.pronom_puid}</td>
                  <td className="px-3 py-2">
                    <RiskBadge level={item.format_risk_level} />
                  </td>
                  <td className="px-3 py-2 text-right text-ink">{formatBytes(item.file_size)}</td>
                  <td className="px-3 py-2 text-archive">{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── Section D: Policies ────────────────────────────────────────────

function PoliciesSection({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editPolicy, setEditPolicy] = useState<PreservationPolicy | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PreservationPolicy | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['preservation-policies', organizationId],
    queryFn: () => getPreservationPolicies(organizationId),
    staleTime: 5 * 60_000,
  });

  const deactivateMutation = useMutation({
    mutationFn: (policyId: string) => deactivatePreservationPolicy(organizationId, policyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preservation-policies', organizationId] });
      showToast({ type: 'success', title: 'Policy deactivated' });
      setDeactivateTarget(null);
    },
    onError: () => {
      showToast({ type: 'error', title: 'Failed to deactivate policy' });
      setDeactivateTarget(null);
    },
  });

  const handleOpenCreate = () => {
    setEditPolicy(null);
    setShowForm(true);
  };

  const handleOpenEdit = (policy: PreservationPolicy) => {
    setEditPolicy(policy);
    setShowForm(true);
  };

  return (
    <>
      <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">Preservation Policies</h2>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="btn-primary ml-auto px-3 py-1.5 text-xs inline-flex items-center gap-1.5"
            >
              <Plus size={14} />
              New Policy
            </button>
          </div>
        </div>
        <div className="px-6 py-5">
          {isLoading && <LoadingSkeleton />}
          {error && <ErrorBanner message="Failed to load policies" />}
          {data && (
            data.policies.length === 0 ? (
              <div className="text-center py-6">
                <FileText size={32} className="mx-auto text-archive/40 mb-2" />
                <p className="text-sm text-archive">No preservation policies configured.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.policies.map((policy) => (
                  <PolicyCard
                    key={policy.policy_id}
                    policy={policy}
                    onEdit={() => handleOpenEdit(policy)}
                    onDeactivate={() => setDeactivateTarget(policy)}
                  />
                ))}
              </div>
            )
          )}
        </div>
      </section>

      <PolicyFormSlideOver
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        organizationId={organizationId}
        policy={editPolicy}
      />

      <ConfirmDialog
        isOpen={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={() => {
          if (deactivateTarget) deactivateMutation.mutate(deactivateTarget.policy_id);
        }}
        title="Deactivate Policy"
        message={`Are you sure you want to deactivate "${deactivateTarget?.name}"? This will stop the policy from being evaluated against media.`}
        confirmText="Deactivate"
        confirmStyle="danger"
      />
    </>
  );
}

function PolicyCard({
  policy,
  onEdit,
  onDeactivate,
}: {
  policy: PreservationPolicy;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  return (
    <div className="p-3 rounded-lg border border-lichen">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-ink">{policy.name}</span>
        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-forest/10 text-forest">
          {POLICY_TYPE_LABELS[policy.policy_type] || policy.policy_type}
        </span>
        {policy.is_active ? (
          <span className="flex items-center gap-1 text-xs text-semantic-success">
            <CheckCircle size={12} /> Active
          </span>
        ) : (
          <span className="text-xs text-archive">Inactive</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-archive hover:text-ink hover:bg-stone rounded-institutional transition-colors"
            title="Edit policy"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDeactivate}
            className="p-1.5 text-archive hover:text-semantic-error hover:bg-semantic-error/10 rounded-institutional transition-colors"
            title="Deactivate policy"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {policy.description && (
        <p className="text-sm text-archive">{policy.description}</p>
      )}
    </div>
  );
}

// ── Section E: Action Plans ────────────────────────────────────────

function ActionPlansSection({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['preservation-action-plans', organizationId, 'pending'],
    queryFn: () => getActionPlans(organizationId, { status: 'pending' }),
    staleTime: 60_000,
  });

  const approveMutation = useMutation({
    mutationFn: (actionId: string) => approveActionPlan(organizationId, actionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preservation-action-plans'] });
      showToast({ type: 'success', title: 'Action plan approved' });
      setLoadingAction(null);
    },
    onError: () => {
      showToast({ type: 'error', title: 'Failed to approve action plan' });
      setLoadingAction(null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (actionId: string) => cancelActionPlan(organizationId, actionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['preservation-action-plans'] });
      showToast({ type: 'success', title: 'Action plan cancelled' });
      setLoadingAction(null);
    },
    onError: () => {
      showToast({ type: 'error', title: 'Failed to cancel action plan' });
      setLoadingAction(null);
    },
  });

  return (
    <section className="bg-parchment rounded-lg border border-lichen shadow-sm">
      <div className="px-6 py-4 border-b border-lichen">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-forest" />
          <h2 className="text-lg font-semibold text-ink">Pending Action Plans</h2>
          {data && data.total > 0 && (
            <span className="text-sm text-archive ml-auto">{data.total} pending</span>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        {isLoading && <div className="px-6 py-5"><LoadingSkeleton /></div>}
        {error && <div className="px-6 py-5"><ErrorBanner message="Failed to load action plans" /></div>}
        {data && (
          data.items.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <CheckCircle size={32} className="mx-auto text-semantic-success/40 mb-2" />
              <p className="text-sm text-archive">No pending action plans.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-archive border-b border-lichen">
                  <th className="px-6 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Scheduled</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((plan) => (
                  <tr key={plan.action_id} className="border-t border-lichen/50">
                    <td className="px-6 py-2.5 text-ink">
                      {ACTION_TYPE_LABELS[plan.action_type] || plan.action_type}
                    </td>
                    <td className="px-3 py-2.5 text-archive">
                      {plan.scheduled_for ? formatDate(plan.scheduled_for) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('inline-flex px-2 py-0.5 text-xs font-medium rounded-full', STATUS_STYLES[plan.status])}>
                        {plan.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            setLoadingAction(plan.action_id);
                            approveMutation.mutate(plan.action_id);
                          }}
                          disabled={loadingAction === plan.action_id}
                          className="px-2.5 py-1 text-xs font-medium rounded bg-semantic-success/10 text-semantic-success hover:bg-semantic-success/20 transition-colors disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            setLoadingAction(plan.action_id);
                            cancelMutation.mutate(plan.action_id);
                          }}
                          disabled={loadingAction === plan.action_id}
                          className="px-2.5 py-1 text-xs font-medium rounded bg-semantic-error/10 text-semantic-error hover:bg-semantic-error/20 transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </section>
  );
}

// ── Shared components ──────────────────────────────────────────────

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={cn('inline-flex px-2 py-0.5 text-xs font-medium rounded-full', RISK_BADGE_STYLES[level])}>
      {level}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 bg-stone/30 rounded w-3/4" />
      <div className="h-8 bg-stone/30 rounded w-1/2" />
      <div className="h-8 bg-stone/30 rounded w-2/3" />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg bg-semantic-error/10 text-semantic-error text-sm">
      <XCircle size={16} />
      {message}
    </div>
  );
}
