/**
 * StatCard Component
 *
 * Displays a single metric with label, value, and optional formatting.
 * Used in the reports dashboard for summary statistics.
 */

import type { LucideIcon } from 'lucide-react';
import { formatNumber } from '@/lib/formatters';

interface StatCardProps {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  format?: 'number' | 'percent' | 'duration';
  trend?: 'up' | 'down' | 'neutral';
  subtitle?: string;
}

export function StatCard({ label, value, icon: Icon, format = 'number', subtitle }: StatCardProps) {
  const formatValue = () => {
    if (typeof value === 'string') return value;

    switch (format) {
      case 'percent':
        return `${value.toFixed(1)}%`;
      case 'duration':
        if (value < 1000) return `${value}ms`;
        if (value < 60000) return `${(value / 1000).toFixed(1)}s`;
        return `${(value / 60000).toFixed(1)}m`;
      case 'number':
      default:
        return formatNumber(value);
    }
  };

  return (
    <div className="bg-parchment rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-archive">{label}</p>
          <p className="text-3xl font-semibold text-forest mt-1">{formatValue()}</p>
          {subtitle && <p className="text-xs text-archive mt-1">{subtitle}</p>}
        </div>
        {Icon && (
          <div className="p-3 bg-parchment rounded-full">
            <Icon className="w-6 h-6 text-forest" />
          </div>
        )}
      </div>
    </div>
  );
}
