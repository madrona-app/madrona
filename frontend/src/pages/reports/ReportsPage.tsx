/**
 * Reports Page
 *
 * Dashboard showing key metrics for pipeline health, data volume,
 * and activity summary. Foundation for future Madrona Reports application.
 */

import { useParams } from 'react-router-dom';
import { RefreshCw, Activity, Database, Zap, Clock, AlertCircle } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useReports } from '../../hooks/useReports';
import { StatCard } from '../../components/reports/StatCard';
import { RunActivityChart } from '../../components/reports/RunActivityChart';
import { DatasetTable } from '../../components/reports/DatasetTable';

export default function ReportsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;

  const { summary, dailyRuns, datasets, isLoading, isError, error, refetch } = useReports();

  if (!organizationId) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 mx-auto text-archive mb-4" />
        <p className="text-archive">No organization selected</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Reports</h1>
            <p className="text-sm text-archive mt-1">Loading dashboard metrics...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-parchment rounded-lg shadow p-6 animate-pulse">
              <div className="h-4 bg-lichen rounded w-24 mb-3" />
              <div className="h-8 bg-lichen rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Reports</h1>
          </div>
        </div>
        <div className="bg-semantic-error/10 border border-semantic-error/20 rounded-lg p-6 text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-semantic-error mb-4" />
          <p className="text-semantic-error font-medium">Failed to load reports</p>
          <p className="text-sm text-archive mt-1">{error?.message || 'Unknown error'}</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Reports</h1>
          <p className="text-sm text-archive mt-1">
            Pipeline health and data metrics for the last {summary?.period_days || 30} days
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 text-sm text-forest border border-forest rounded-lg hover:bg-forest hover:text-parchment transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Runs"
          value={summary?.total_runs || 0}
          icon={Activity}
          subtitle={`${summary?.successful_runs || 0} successful, ${summary?.failed_runs || 0} failed`}
        />
        <StatCard
          label="Success Rate"
          value={summary?.success_rate || 0}
          icon={Zap}
          format="percent"
        />
        <StatCard
          label="Total Entities"
          value={summary?.total_entities || 0}
          icon={Database}
        />
        <StatCard
          label="Avg Duration"
          value={summary?.avg_duration_ms || 0}
          icon={Clock}
          format="duration"
          subtitle={`${summary?.active_pipelines || 0} active pipelines`}
        />
      </div>

      {/* Run Activity Chart */}
      <div>
        <RunActivityChart data={dailyRuns} />
      </div>

      {/* Dataset Summary Table */}
      <div>
        <DatasetTable datasets={datasets} organizationId={organizationId} />
      </div>
    </div>
  );
}
