import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { GitBranch, Users, Zap, Clock, TrendingUp, ExternalLink } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getRelationshipAnalytics } from '../lib/api';
import type { RelationshipAnalytics } from '../lib/api';
import { formatNumber, formatDateShort } from '../lib/formatters';

interface RelationshipAnalyticsDashboardProps {
  organizationId: string;
}

// Colors for charts
const TYPE_COLORS = [
  'rgb(var(--color-success))', // forest
  'rgb(var(--color-archive))', // bark
  '#8B9B8F', // lichen
  '#A4B8A9', // sage
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  'rgb(var(--color-warning))', // orange
  '#14b8a6', // teal
  '#84cc16', // lime
];

const SOURCE_COLORS: Record<string, string> = {
  manual: '#3b82f6',     // blue
  auto_link: 'rgb(var(--color-success))',  // green
  migration: 'rgb(var(--color-warning))',  // amber
  rule: '#8b5cf6',       // violet
};

export function RelationshipAnalyticsDashboard({ organizationId }: RelationshipAnalyticsDashboardProps) {
  const { data, isLoading, error } = useQuery<RelationshipAnalytics>({
    queryKey: ['relationshipAnalytics', organizationId],
    queryFn: () => getRelationshipAnalytics(organizationId),
    enabled: !!organizationId,
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-lichen rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-lichen rounded-lg" />
          <div className="h-64 bg-lichen rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
        <p className="font-medium">Failed to load analytics</p>
        <p className="text-sm">{(error as Error).message}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { total_relationships, by_type, by_source, top_entities, recent_relationships } = data;

  // Calculate stats
  const autoLinkCount = by_source.find(s => s.source === 'auto_link')?.count || 0;
  const manualCount = by_source.find(s => s.source === 'manual')?.count || 0;
  const uniqueTypes = by_type.length;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<GitBranch className="h-6 w-6" />}
          label="Total Relationships"
          value={formatNumber(total_relationships)}
          color="text-bark"
          bgColor="bg-bark/10"
        />
        <StatCard
          icon={<TrendingUp className="h-6 w-6" />}
          label="Relationship Types"
          value={uniqueTypes.toString()}
          color="text-forest"
          bgColor="bg-forest/10"
        />
        <StatCard
          icon={<Zap className="h-6 w-6" />}
          label="Auto-linked"
          value={formatNumber(autoLinkCount)}
          subtext={total_relationships > 0 ? `${Math.round(autoLinkCount / total_relationships * 100)}%` : '0%'}
          color="text-semantic-success"
          bgColor="bg-semantic-success/10"
        />
        <StatCard
          icon={<Users className="h-6 w-6" />}
          label="Manual"
          value={formatNumber(manualCount)}
          subtext={total_relationships > 0 ? `${Math.round(manualCount / total_relationships * 100)}%` : '0%'}
          color="text-semantic-info"
          bgColor="bg-semantic-info/10"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Type Chart */}
        <div className="bg-parchment rounded-lg border border-lichen p-4">
          <h3 className="font-medium text-ink mb-4">Relationships by Type</h3>
          {by_type.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={by_type}
                  dataKey="count"
                  nameKey="type"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                  labelLine={true}
                >
                  {by_type.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={TYPE_COLORS[index % TYPE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-archive">
              No relationship data
            </div>
          )}
        </div>

        {/* By Source Chart */}
        <div className="bg-parchment rounded-lg border border-lichen p-4">
          <h3 className="font-medium text-ink mb-4">Relationships by Source</h3>
          {by_source.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={by_source} layout="vertical">
                <XAxis type="number" />
                <YAxis type="category" dataKey="source" width={80} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {by_source.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={SOURCE_COLORS[entry.source] || TYPE_COLORS[index]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-archive">
              No relationship data
            </div>
          )}
        </div>
      </div>

      {/* Top Entities and Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Connected Entities */}
        <div className="bg-parchment rounded-lg border border-lichen p-4">
          <h3 className="font-medium text-ink mb-4">Most Connected Entities</h3>
          {top_entities.length > 0 ? (
            <div className="space-y-2">
              {top_entities.slice(0, 8).map((entity, index) => (
                <div key={entity.entity_key} className="flex items-center justify-between py-2 border-b border-lichen last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-archive w-6">{index + 1}</span>
                    <Link
                      to={`/organizations/${organizationId}/bridge/entities/${encodeURIComponent(entity.entity_key)}`}
                      className="text-sm text-semantic-info hover:underline flex items-center gap-1"
                    >
                      {entity.label}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  <span className="text-sm font-medium text-ink">
                    {entity.relationship_count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-archive">
              No entities with relationships
            </div>
          )}
        </div>

        {/* Recent Relationships */}
        <div className="bg-parchment rounded-lg border border-lichen p-4">
          <h3 className="font-medium text-ink mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Recent Relationships
          </h3>
          {recent_relationships.length > 0 ? (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {recent_relationships.map((rel) => (
                <div key={rel.relationship_id} className="py-2 border-b border-lichen last:border-0">
                  <div className="flex items-center gap-2 text-sm">
                    <Link
                      to={`/organizations/${organizationId}/bridge/entities/${encodeURIComponent(rel.source_entity_key)}`}
                      className="text-semantic-info hover:underline truncate max-w-[120px]"
                      title={rel.source_entity_key}
                    >
                      {rel.source_entity_key.split(':').pop()}
                    </Link>
                    <span className="text-archive">-[{rel.relationship_type}]-&gt;</span>
                    <Link
                      to={`/organizations/${organizationId}/bridge/entities/${encodeURIComponent(rel.target_entity_key)}`}
                      className="text-semantic-info hover:underline truncate max-w-[120px]"
                      title={rel.target_entity_key}
                    >
                      {rel.target_entity_key.split(':').pop()}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      rel.created_by_source === 'auto_link' ? 'bg-semantic-success/10 text-semantic-success' :
                      rel.created_by_source === 'manual' ? 'bg-semantic-info/10 text-semantic-info' :
                      'bg-stone text-ink'
                    }`}>
                      {rel.created_by_source}
                    </span>
                    <span className="text-xs text-archive">
                      {rel.created_at ? formatDateShort(rel.created_at) : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-archive">
              No recent relationships
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Stat card component
function StatCard({
  icon,
  label,
  value,
  subtext,
  color,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
  color: string;
  bgColor: string;
}) {
  return (
    <div className="bg-parchment rounded-lg border border-lichen p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bgColor}`}>
          <div className={color}>{icon}</div>
        </div>
        <div>
          <p className="text-sm text-archive">{label}</p>
          <p className="text-2xl font-semibold text-ink">
            {value}
            {subtext && <span className="text-sm font-normal text-archive ml-1">{subtext}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
