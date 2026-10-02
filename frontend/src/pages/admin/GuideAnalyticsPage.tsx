import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { formatNumber as fmtNumber } from '@/lib/formatters';
import {
  MessageSquare,
  Coins,
  Zap,
  AlertTriangle,
  Wrench,
  ThumbsUp,
  HelpCircle,
  Search,
  MapPin,
} from 'lucide-react';

interface AnalyticsData {
  period_days: number;
  summary: {
    total_requests: number;
    total_errors: number;
    error_rate: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
    avg_latency_ms: number;
    satisfaction_positive: number;
    satisfaction_negative: number;
  };
  by_org: Array<{
    organization_id: string;
    organization_name: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
    tool_calls: number;
    avg_latency_ms: number;
  }>;
  by_tool: Array<{ tool: string; calls: number }>;
  by_provider: Record<string, number>;
  daily: Array<{
    date: string;
    requests: number;
    tokens: number;
    estimated_cost_usd: number;
  }>;
  top_questions: Array<{ question: string; count: number }>;
  retrieval_misses: Array<{ question: string | null; tools: string[] | null; entity_type: string | null }>;
  top_pages: Array<{ route: string; count: number }>;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-lichen bg-parchment p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-forest/10 p-2">
          <Icon className="h-5 w-5 text-forest" />
        </div>
        <div>
          <p className="text-sm text-archive">{label}</p>
          <p className="text-2xl font-semibold text-ink">{value}</p>
          {sub && <p className="text-xs text-archive">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return fmtNumber(n);
}

function DailyChart({ daily }: { daily: AnalyticsData['daily'] }) {
  if (!daily.length) return <p className="text-sm text-archive">No data yet.</p>;

  const maxRequests = Math.max(...daily.map((d) => d.requests), 1);

  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {daily.map((d) => {
        const height = Math.max((d.requests / maxRequests) * 100, 2);
        return (
          <div
            key={d.date}
            className="group relative flex-1"
            style={{ minWidth: 4, maxWidth: 20 }}
          >
            <div
              className="w-full rounded-t bg-forest/70 transition-colors hover:bg-forest"
              style={{ height: `${height}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-parchment group-hover:block">
              {d.date}: {d.requests} requests
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function GuideAnalyticsPage() {
  const [days, setDays] = useState(30);

  const { data, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ['guide-analytics', days],
    queryFn: () => apiFetch<AnalyticsData>(`/admin/guide-analytics?days=${days}`),
  });

  if (isLoading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-ink">Guide Analytics</h1>
        <p className="mt-4 text-archive">Loading...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-ink">Guide Analytics</h1>
        <p className="mt-4 text-semantic-error">Failed to load analytics.</p>
      </div>
    );
  }

  const { summary, by_org, by_tool, by_provider, daily, top_questions, retrieval_misses, top_pages } = data;
  const totalFeedback = summary.satisfaction_positive + summary.satisfaction_negative;
  const satisfactionRate = totalFeedback > 0 ? Math.round((summary.satisfaction_positive / totalFeedback) * 100) : null;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Guide Analytics</h1>
        <div className="flex gap-1 rounded-lg border border-lichen bg-parchment p-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                days === d
                  ? 'bg-forest text-parchment'
                  : 'text-archive hover:bg-stone'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={MessageSquare}
          label="Requests"
          value={formatNumber(summary.total_requests)}
          sub={summary.total_errors > 0 ? `${summary.total_errors} errors (${(summary.error_rate * 100).toFixed(1)}%)` : undefined}
        />
        <StatCard
          icon={Coins}
          label="Estimated Cost"
          value={`$${summary.estimated_cost_usd.toFixed(2)}`}
          sub={`${formatNumber(summary.total_tokens)} tokens`}
        />
        <StatCard
          icon={Zap}
          label="Avg Latency"
          value={summary.avg_latency_ms > 1000 ? `${(summary.avg_latency_ms / 1000).toFixed(1)}s` : `${summary.avg_latency_ms}ms`}
        />
        <StatCard
          icon={ThumbsUp}
          label="Satisfaction"
          value={satisfactionRate !== null ? `${satisfactionRate}%` : '—'}
          sub={totalFeedback > 0 ? `${summary.satisfaction_positive} positive, ${summary.satisfaction_negative} negative` : 'No feedback yet'}
        />
        <StatCard
          icon={AlertTriangle}
          label="Providers"
          value={Object.keys(by_provider).join(', ') || 'none'}
          sub={Object.entries(by_provider).map(([p, c]) => `${p}: ${c}`).join(', ')}
        />
      </div>

      {/* Daily chart */}
      <div className="mb-8 rounded-lg border border-lichen bg-parchment p-5">
        <h2 className="mb-4 text-sm font-medium text-archive">Daily Requests</h2>
        <DailyChart daily={daily} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* By org table */}
        <div className="lg:col-span-2 rounded-lg border border-lichen bg-parchment">
          <div className="border-b border-lichen px-5 py-3">
            <h2 className="text-sm font-medium text-archive">Usage by Organization</h2>
          </div>
          {by_org.length === 0 ? (
            <p className="p-5 text-sm text-archive">No usage data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-lichen text-left text-xs text-archive">
                    <th className="px-5 py-2 font-medium">Organization</th>
                    <th className="px-5 py-2 font-medium text-right">Requests</th>
                    <th className="px-5 py-2 font-medium text-right">Tokens</th>
                    <th className="px-5 py-2 font-medium text-right">Cost</th>
                    <th className="px-5 py-2 font-medium text-right">Tools</th>
                    <th className="px-5 py-2 font-medium text-right">Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {by_org.map((org) => (
                    <tr key={org.organization_id} className="border-b border-lichen last:border-0">
                      <td className="px-5 py-2.5 text-ink">{org.organization_name}</td>
                      <td className="px-5 py-2.5 text-right text-ink">{fmtNumber(org.requests)}</td>
                      <td className="px-5 py-2.5 text-right text-archive">{formatNumber(org.total_tokens)}</td>
                      <td className="px-5 py-2.5 text-right text-ink">${org.estimated_cost_usd.toFixed(2)}</td>
                      <td className="px-5 py-2.5 text-right text-archive">{org.tool_calls}</td>
                      <td className="px-5 py-2.5 text-right text-archive">
                        {org.avg_latency_ms > 1000 ? `${(org.avg_latency_ms / 1000).toFixed(1)}s` : `${org.avg_latency_ms}ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Tool breakdown */}
        <div className="rounded-lg border border-lichen bg-parchment">
          <div className="border-b border-lichen px-5 py-3">
            <h2 className="text-sm font-medium text-archive">Tool Usage</h2>
          </div>
          {by_tool.length === 0 ? (
            <p className="p-5 text-sm text-archive">No tool calls yet.</p>
          ) : (
            <div className="p-5 space-y-3">
              {by_tool.map((tool) => {
                const maxCalls = by_tool[0]?.calls || 1;
                const pct = (tool.calls / maxCalls) * 100;
                return (
                  <div key={tool.tool}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-ink">
                        <Wrench className="h-3.5 w-3.5 text-archive" />
                        {tool.tool}
                      </span>
                      <span className="text-archive">{fmtNumber(tool.calls)}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-lichen">
                      <div
                        className="h-1.5 rounded-full bg-forest/60"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Question Intelligence */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Questions */}
        <div className="rounded-lg border border-lichen bg-parchment">
          <div className="border-b border-lichen px-5 py-3">
            <h2 className="text-sm font-medium text-archive flex items-center gap-2">
              <HelpCircle className="h-4 w-4" />
              Top Questions
            </h2>
          </div>
          {top_questions.length === 0 ? (
            <p className="p-5 text-sm text-archive">No questions recorded yet.</p>
          ) : (
            <div className="divide-y divide-lichen max-h-80 overflow-y-auto">
              {top_questions.map((q, i) => (
                <div key={i} className="px-5 py-2.5 flex items-start justify-between gap-3">
                  <p className="text-sm text-ink line-clamp-2 flex-1">{q.question}</p>
                  <span className="text-xs text-archive shrink-0 bg-stone px-2 py-0.5 rounded-full">
                    {q.count}×
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Pages */}
        <div className="rounded-lg border border-lichen bg-parchment">
          <div className="border-b border-lichen px-5 py-3">
            <h2 className="text-sm font-medium text-archive flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Most-Asked-From Pages
            </h2>
          </div>
          {top_pages.length === 0 ? (
            <p className="p-5 text-sm text-archive">No page data yet.</p>
          ) : (
            <div className="divide-y divide-lichen max-h-80 overflow-y-auto">
              {top_pages.map((p, i) => (
                <div key={i} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <p className="text-sm text-ink truncate flex-1 font-mono text-xs">{p.route}</p>
                  <span className="text-xs text-archive shrink-0 bg-stone px-2 py-0.5 rounded-full">
                    {p.count}×
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Retrieval Misses */}
      {retrieval_misses.length > 0 && (
        <div className="mt-6 rounded-lg border border-semantic-warning/30 bg-semantic-warning/5">
          <div className="border-b border-semantic-warning/20 px-5 py-3">
            <h2 className="text-sm font-medium text-semantic-warning flex items-center gap-2">
              <Search className="h-4 w-4" />
              Retrieval Misses ({retrieval_misses.length})
              <span className="text-xs font-normal text-archive ml-1">Questions where tools returned empty</span>
            </h2>
          </div>
          <div className="divide-y divide-semantic-warning/10 max-h-60 overflow-y-auto">
            {retrieval_misses.map((m, i) => (
              <div key={i} className="px-5 py-2.5">
                <p className="text-sm text-ink">{m.question || '(no question recorded)'}</p>
                <div className="flex gap-3 mt-1 text-xs text-archive">
                  {m.tools && <span>Tools: {m.tools.join(', ')}</span>}
                  {m.entity_type && <span>Entity: {m.entity_type}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
