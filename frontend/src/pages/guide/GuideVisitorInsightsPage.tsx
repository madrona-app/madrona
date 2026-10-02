/**
 * Visitor curiosity insights: what the org's public visitors are asking about.
 *
 * Org-scoped counterpart to the staff Corpus insights — reads persona='visitor'
 * traffic plus the visitor-engagement tables. No cost/provider/cross-org data.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HelpCircle,
  Image,
  Languages,
  MessageSquare,
  QrCode,
  SearchX,
  ThumbsUp,
  Users,
} from 'lucide-react';
import { getVisitorInsights, type VisitorInsights } from '../../lib/api/visitorInsights';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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
        <div className="rounded-md bg-azurite/10 p-2">
          <Icon className="h-5 w-5 text-azurite" />
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

function DailyBars({ daily }: { daily: VisitorInsights['daily'] }) {
  if (!daily.length) {
    return <p className="text-sm text-archive">No visitor questions yet.</p>;
  }
  const max = Math.max(...daily.map((d) => d.questions), 1);
  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {daily.map((d) => {
        const height = Math.max((d.questions / max) * 100, 2);
        return (
          <div
            key={d.date}
            className="group relative flex-1"
            style={{ minWidth: 4, maxWidth: 24 }}
          >
            <div
              className="w-full rounded-t bg-azurite/70 transition-colors hover:bg-azurite"
              style={{ height: `${height}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-parchment group-hover:block">
              {d.date}: {d.questions} question{d.questions === 1 ? '' : 's'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function GuideVisitorInsightsPage() {
  const [days, setDays] = useState(30);

  const { data, isLoading, error } = useQuery<VisitorInsights>({
    queryKey: ['visitor-insights', days],
    queryFn: () => getVisitorInsights(days),
  });

  const header = (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Visitor Insights</h1>
        <p className="mt-1 text-sm text-archive">
          What your public visitors are curious about.
        </p>
      </div>
      <div className="flex gap-1 rounded-lg border border-lichen bg-parchment p-1">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              days === d ? 'bg-azurite text-parchment' : 'text-archive hover:bg-stone'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        {header}
        <p className="text-archive">Loading…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        {header}
        <p className="text-semantic-error">Failed to load visitor insights.</p>
      </div>
    );
  }

  const { summary, daily, top_objects, top_questions, unanswered, languages } = data;
  const totalFeedback = summary.satisfaction.positive + summary.satisfaction.negative;
  const satisfactionRate =
    totalFeedback > 0
      ? Math.round((summary.satisfaction.positive / totalFeedback) * 100)
      : null;
  const isEmpty =
    summary.total_questions === 0 &&
    summary.visitors === 0 &&
    summary.visits === 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {header}

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-lichen bg-parchment-warm p-12 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-archive" />
          <p className="mt-3 text-sm text-archive">
            No visitor activity in this period yet. Once your public Guide widget is
            live, visitor questions and engagement will show up here.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              icon={MessageSquare}
              label="Questions"
              value={formatNumber(summary.total_questions)}
              sub={
                summary.answered_rate !== null
                  ? `${Math.round(summary.answered_rate * 100)}% answered`
                  : undefined
              }
            />
            <StatCard
              icon={Users}
              label="Visitors"
              value={formatNumber(summary.visitors)}
            />
            <StatCard
              icon={MessageSquare}
              label="Visits"
              value={formatNumber(summary.visits)}
            />
            <StatCard
              icon={QrCode}
              label="QR Share"
              value={
                summary.qr_scan_share !== null
                  ? `${Math.round(summary.qr_scan_share * 100)}%`
                  : '—'
              }
              sub="of visits from QR"
            />
            <StatCard
              icon={ThumbsUp}
              label="Satisfaction"
              value={satisfactionRate !== null ? `${satisfactionRate}%` : '—'}
              sub={
                totalFeedback > 0
                  ? `${summary.satisfaction.positive} up, ${summary.satisfaction.negative} down`
                  : 'No feedback yet'
              }
            />
          </div>

          {/* Daily questions */}
          <div className="mb-8 rounded-lg border border-lichen bg-parchment p-5">
            <h2 className="mb-4 text-sm font-medium text-archive">Daily Questions</h2>
            <DailyBars daily={daily} />
          </div>

          {/* Most asked-about objects */}
          <div className="mb-8 rounded-lg border border-lichen bg-parchment">
            <div className="border-b border-lichen px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-archive">
                <Image className="h-4 w-4" />
                Most Asked-About Objects
              </h2>
            </div>
            {top_objects.length === 0 ? (
              <p className="p-5 text-sm text-archive">No object questions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-lichen text-left text-xs text-archive">
                      <th className="px-5 py-2 font-medium">Object</th>
                      <th className="px-5 py-2 text-right font-medium">Questions</th>
                      <th className="px-5 py-2 text-right font-medium">Views</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top_objects.map((o) => (
                      <tr key={o.entity_id} className="border-b border-lichen last:border-0">
                        <td className="px-5 py-2.5 text-ink">
                          {o.title || <span className="text-archive">Untitled object</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right font-semibold text-azurite">
                          {formatNumber(o.questions)}
                        </td>
                        <td className="px-5 py-2.5 text-right text-archive">
                          {formatNumber(o.views)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Top questions */}
            <div className="rounded-lg border border-lichen bg-parchment">
              <div className="border-b border-lichen px-5 py-3">
                <h2 className="flex items-center gap-2 text-sm font-medium text-archive">
                  <HelpCircle className="h-4 w-4" />
                  Top Questions
                </h2>
              </div>
              {top_questions.length === 0 ? (
                <p className="p-5 text-sm text-archive">No questions recorded yet.</p>
              ) : (
                <div className="max-h-80 divide-y divide-lichen overflow-y-auto">
                  {top_questions.map((q, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 px-5 py-2.5">
                      <p className="line-clamp-2 flex-1 text-sm text-ink">{q.question}</p>
                      <span className="shrink-0 rounded-full bg-azurite/10 px-2 py-0.5 text-xs text-azurite">
                        {q.count}×
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Couldn't answer */}
            <div className="rounded-lg border border-semantic-warning/30 bg-semantic-warning/5">
              <div className="border-b border-semantic-warning/20 px-5 py-3">
                <h2 className="flex items-center gap-2 text-sm font-medium text-semantic-warning">
                  <SearchX className="h-4 w-4" />
                  Couldn't Answer
                </h2>
              </div>
              {unanswered.length === 0 ? (
                <p className="p-5 text-sm text-archive">
                  Nothing went unanswered — nice.
                </p>
              ) : (
                <div className="max-h-80 divide-y divide-semantic-warning/10 overflow-y-auto">
                  {unanswered.map((u, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 px-5 py-2.5">
                      <p className="line-clamp-2 flex-1 text-sm text-ink">{u.question}</p>
                      <span className="shrink-0 rounded-full bg-semantic-warning/10 px-2 py-0.5 text-xs text-semantic-warning">
                        {u.count}×
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Languages */}
          <div className="mt-8 rounded-lg border border-lichen bg-parchment p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-archive">
              <Languages className="h-4 w-4" />
              Languages
            </h2>
            {languages.length === 0 ? (
              <p className="text-sm text-archive">No visitor language data yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {languages.map((l) => (
                  <span
                    key={l.locale}
                    className="inline-flex items-center gap-1.5 rounded-full border border-lichen bg-parchment-warm px-3 py-1 text-sm text-ink"
                  >
                    <span className="font-medium uppercase">{l.locale}</span>
                    <span className="text-archive">{formatNumber(l.visitors)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
