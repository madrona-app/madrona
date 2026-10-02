/**
 * DatasetTable Component
 *
 * Table showing per-dataset statistics including entity counts,
 * last sync time, and success rate.
 */

import { Link } from 'react-router-dom';
import { Database, ExternalLink } from 'lucide-react';
import type { DatasetSummary } from '../../lib/api';
import { formatNumber, formatRelativeTime } from '@/lib/formatters';

interface DatasetTableProps {
  datasets: DatasetSummary[];
  organizationId: string;
}

export function DatasetTable({ datasets, organizationId }: DatasetTableProps) {
  if (datasets.length === 0) {
    return (
      <div className="bg-parchment rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-forest mb-4">Dataset Summary</h3>
        <div className="text-center py-8 text-archive">
          <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No datasets found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-parchment rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-lichen">
        <h3 className="text-lg font-semibold text-forest">Dataset Summary</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-lichen">
          <thead className="bg-parchment">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Dataset
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-archive uppercase tracking-wider">
                Entities
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Last Sync
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-archive uppercase tracking-wider">
                Runs
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-archive uppercase tracking-wider">
                Success Rate
              </th>
            </tr>
          </thead>
          <tbody className="bg-parchment divide-y divide-lichen">
            {datasets.map((dataset) => (
              <tr key={dataset.dataset_id} className="hover:bg-lichen/30">
                <td className="px-6 py-4 whitespace-nowrap">
                  <Link
                    to={`/organizations/${organizationId}/bridge/datasets/${dataset.dataset_id}`}
                    className="flex items-center gap-2 text-forest hover:text-bark"
                  >
                    <Database className="w-4 h-4" />
                    <span className="font-medium">{dataset.name}</span>
                    <ExternalLink className="w-3 h-3 opacity-50" />
                  </Link>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-ink">
                  {formatNumber(dataset.entity_count)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-archive">
                  {formatRelativeTime(dataset.last_run_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-ink">
                  {dataset.runs_total}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <SuccessRateBar rate={dataset.success_rate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SuccessRateBar({ rate }: { rate: number | null }) {
  if (rate === null) {
    return <span className="text-sm text-archive">N/A</span>;
  }

  const width = Math.min(100, Math.max(0, rate));
  const color = rate >= 90 ? 'bg-semantic-success' : rate >= 70 ? 'bg-semantic-warning' : 'bg-semantic-error';

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-lichen rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${width}%` }} />
      </div>
      <span className="text-sm text-ink">{rate.toFixed(0)}%</span>
    </div>
  );
}

