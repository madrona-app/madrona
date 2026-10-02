/**
 * RunActivityChart Component
 *
 * Bar chart showing daily run activity over time.
 * Displays success vs failed runs stacked.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { DailyRunStats } from '../../lib/api';
import { formatDateShort, formatNumber } from '@/lib/formatters';

interface RunActivityChartProps {
  data: DailyRunStats[];
}

export function RunActivityChart({ data }: RunActivityChartProps) {
  // Reverse to show oldest to newest (left to right)
  const chartData = [...data].reverse().map((d) => ({
    ...d,
    // Format date for display
    displayDate: formatDate(d.date),
  }));

  if (chartData.length === 0) {
    return (
      <div className="bg-parchment rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-forest mb-4">Run Activity</h3>
        <div className="h-64 flex items-center justify-center text-archive">
          No run data available for this period
        </div>
      </div>
    );
  }

  return (
    <div className="bg-parchment rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-forest mb-4">Run Activity (Last 30 Days)</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E6E4DF" />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 12, fill: '#6F706C' }}
              tickLine={false}
              axisLine={{ stroke: '#E6E4DF' }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#6F706C' }}
              tickLine={false}
              axisLine={{ stroke: '#E6E4DF' }}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #E6E4DF',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              }}
              formatter={(value, name) => [
                typeof value === 'number' ? formatNumber(value) : '0',
                name === 'success' ? 'Successful' : 'Failed',
              ]}
              labelFormatter={(label) => `Date: ${label}`}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px' }}
              formatter={(value) => (value === 'success' ? 'Successful' : 'Failed')}
            />
            {/* Recharts sets fill as an SVG presentation attr (CSS var() won't resolve there),
                so these mirror semantic-success / semantic-error by value. */}
            <Bar dataKey="success" stackId="runs" fill="#3F7A53" name="success" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed" stackId="runs" fill="#9E3535" name="failed" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  return formatDateShort(dateStr);
}
