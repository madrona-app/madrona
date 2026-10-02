/**
 * ExecutionDashboard - Operational readiness overview for exhibitions
 *
 * Displays aggregated metrics with drill-through to resolve issues:
 * - Checklist completion % and blocked tasks
 * - Overdue info requests
 * - Upcoming shipment dates
 * - Loans missing agreements/documents
 * - Budget delta (estimated vs actual)
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency, formatDateShort } from '../../lib/formatters';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Truck,
  FileText,
  DollarSign,
  RefreshCw,
  ChevronRight,
  XCircle,
  AlertCircle,
} from 'lucide-react';

interface ExecutionDashboardProps {
  organizationId: string;
  exhibitionId: string;
}

interface DashboardData {
  exhibition: {
    exhibition_id: string;
    title: string;
    status: string;
    planned_start_date: string | null;
    planned_end_date: string | null;
  };
  checklist: {
    total: number;
    completed: number;
    blocked: number;
    overdue: number;
    completion_pct: number;
  };
  info_requests: {
    total: number;
    overdue: number;
    missing_required: number;
  };
  shipments: {
    total: number;
    in_transit: number;
    delayed: number;
    upcoming: Array<{
      shipment_id: string;
      shipment_number: string;
      direction: string;
      carrier: string;
      ship_date: string | null;
      expected_arrival: string | null;
    }>;
    upcoming_count: number;
  };
  loans: {
    total: number;
    active: number;
    missing_agreements: number;
    missing_insurance: number;
  };
  budget: {
    estimated_total: number;
    actual_total: number;
    delta: number;
    variance_pct: number;
    currency: string;
    line_count: number;
  };
  generated_at: string;
}

export default function ExecutionDashboard({
  organizationId,
  exhibitionId,
}: ExecutionDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/execution-dashboard`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to load dashboard');
      }

      const dashboardData = await response.json();
      setData(dashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [organizationId, exhibitionId]);

  const fmtCurrency = (amount: number, currency: string) =>
    formatCurrency(amount, currency, 0);

  const fmtDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return formatDateShort(dateStr);
  };

  if (loading) {
    return (
      <div className="bg-parchment rounded-lg shadow-sm border border-fog p-6">
        <div className="flex items-center justify-center gap-2 text-ink/60">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading execution dashboard...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-parchment rounded-lg shadow-sm border border-fog p-6">
        <div className="flex items-center gap-2 text-semantic-error">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
          <button
            onClick={fetchDashboard}
            className="ml-auto text-sm text-forest hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const baseUrl = `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}`;

  return (
    <div className="bg-parchment rounded-lg shadow-sm border border-fog overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-fog bg-mist flex items-center justify-between">
        <h3 className="font-medium text-ink">Execution Overview</h3>
        <button
          onClick={fetchDashboard}
          className="text-ink/60 hover:text-ink transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Checklist Card */}
        <MetricCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          title="Tasks"
          linkTo={`${baseUrl}/checklists`}
          status={
            data.checklist.blocked > 0
              ? 'warning'
              : data.checklist.completion_pct >= 100
              ? 'success'
              : 'neutral'
          }
        >
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink">
              {data.checklist.completion_pct}%
            </span>
            <span className="text-sm text-ink/60">complete</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm">
            {data.checklist.blocked > 0 && (
              <span className="flex items-center gap-1 text-semantic-warning">
                <XCircle className="w-3.5 h-3.5" />
                {data.checklist.blocked} blocked
              </span>
            )}
            {data.checklist.overdue > 0 && (
              <span className="flex items-center gap-1 text-semantic-error">
                <Clock className="w-3.5 h-3.5" />
                {data.checklist.overdue} overdue
              </span>
            )}
            {data.checklist.blocked === 0 && data.checklist.overdue === 0 && (
              <span className="text-ink/50">
                {data.checklist.completed}/{data.checklist.total} tasks done
              </span>
            )}
          </div>
        </MetricCard>

        {/* Info Requests Card */}
        <MetricCard
          icon={<FileText className="w-4 h-4" />}
          title="Info Requests"
          linkTo={`${baseUrl}/info-requests`}
          status={data.info_requests.overdue > 0 ? 'error' : 'neutral'}
        >
          {data.info_requests.overdue > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-semantic-error">
                  {data.info_requests.overdue}
                </span>
                <span className="text-sm text-semantic-error">overdue</span>
              </div>
              <p className="mt-1 text-sm text-ink/60">
                {data.info_requests.missing_required} required items pending
              </p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-ink">
                  {data.info_requests.missing_required}
                </span>
                <span className="text-sm text-ink/60">pending</span>
              </div>
              <p className="mt-1 text-sm text-ink/50">
                {data.info_requests.total} total requests
              </p>
            </>
          )}
        </MetricCard>

        {/* Shipments Card */}
        <MetricCard
          icon={<Truck className="w-4 h-4" />}
          title="Shipments"
          linkTo={`${baseUrl}/shipments`}
          status={data.shipments.delayed > 0 ? 'warning' : 'neutral'}
        >
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink">
              {data.shipments.in_transit}
            </span>
            <span className="text-sm text-ink/60">in transit</span>
          </div>
          {data.shipments.delayed > 0 && (
            <p className="mt-1 text-sm text-semantic-warning flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {data.shipments.delayed} delayed
            </p>
          )}
          {data.shipments.upcoming.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="text-ink/60 mb-1">Upcoming:</p>
              <ul className="space-y-0.5">
                {data.shipments.upcoming.slice(0, 3).map((s) => (
                  <li key={s.shipment_id} className="text-ink/80">
                    {s.shipment_number || s.carrier || 'Shipment'}{' '}
                    <span className="text-ink/50">
                      {s.direction === 'inbound' ? 'arrives' : 'ships'}{' '}
                      {fmtDate(s.expected_arrival || s.ship_date)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </MetricCard>

        {/* Loans Card */}
        <MetricCard
          icon={<FileText className="w-4 h-4" />}
          title="Loans"
          linkTo={`${baseUrl}/loans`}
          status={
            data.loans.missing_agreements > 0 || data.loans.missing_insurance > 0
              ? 'warning'
              : 'neutral'
          }
        >
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink">
              {data.loans.active}
            </span>
            <span className="text-sm text-ink/60">active loans</span>
          </div>
          <div className="mt-1 flex flex-col gap-0.5 text-sm">
            {data.loans.missing_agreements > 0 && (
              <span className="text-semantic-warning">
                {data.loans.missing_agreements} missing signed agreement
              </span>
            )}
            {data.loans.missing_insurance > 0 && (
              <span className="text-semantic-warning">
                {data.loans.missing_insurance} missing insurance
              </span>
            )}
            {data.loans.missing_agreements === 0 &&
              data.loans.missing_insurance === 0 && (
                <span className="text-ink/50">All documents complete</span>
              )}
          </div>
        </MetricCard>

        {/* Budget Card */}
        <MetricCard
          icon={<DollarSign className="w-4 h-4" />}
          title="Budget"
          linkTo={`${baseUrl}/budget`}
          status={
            Math.abs(data.budget.variance_pct) > 10
              ? data.budget.delta > 0
                ? 'warning'
                : 'success'
              : 'neutral'
          }
        >
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink">
              {fmtCurrency(data.budget.actual_total, data.budget.currency)}
            </span>
            <span className="text-sm text-ink/60">spent</span>
          </div>
          <div className="mt-1 text-sm">
            <span className="text-ink/60">
              of {fmtCurrency(data.budget.estimated_total, data.budget.currency)}{' '}
              estimated
            </span>
            {data.budget.delta !== 0 && (
              <span
                className={`ml-2 ${
                  data.budget.delta > 0 ? 'text-semantic-warning' : 'text-semantic-success'
                }`}
              >
                ({data.budget.delta > 0 ? '+' : ''}
                {data.budget.variance_pct}%)
              </span>
            )}
          </div>
        </MetricCard>
      </div>
    </div>
  );
}

/**
 * Reusable metric card with status indicator and drill-through link
 */
function MetricCard({
  icon,
  title,
  linkTo,
  status,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  linkTo: string;
  status: 'success' | 'warning' | 'error' | 'neutral';
  children: React.ReactNode;
}) {
  const statusColors = {
    success: 'border-l-semantic-success',
    warning: 'border-l-semantic-warning',
    error: 'border-l-semantic-error',
    neutral: 'border-l-fog',
  };

  return (
    <Link
      to={linkTo}
      className={`block p-3 rounded-lg border border-fog hover:bg-mist/50 transition-colors border-l-4 ${statusColors[status]}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm text-ink/70 mb-1">
            {icon}
            <span>{title}</span>
          </div>
          {children}
        </div>
        <ChevronRight className="w-4 h-4 text-ink/30 mt-1" />
      </div>
    </Link>
  );
}
