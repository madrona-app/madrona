/**
 * CorpusGapsPanel — surfaces "questions your assistant couldn't answer" on the
 * Corpus page, turning the org's own Guide usage into a to-do list for the
 * knowledge base. Each gap offers "Cover this", which scrolls to the uploader
 * (the gap → fill loop closes where the corpus is managed).
 *
 * Backed by the org-scoped GET /guide/insights (no cost/provider/cross-org).
 */

import { useQuery } from '@tanstack/react-query';
import { Search, ArrowUp } from 'lucide-react';
import { getGuideInsights, type CorpusGap } from '../../lib/api/guideInsights';
import { formatDateShort } from '@/lib/formatters';

const WINDOW_DAYS = 30;

export function CorpusGapsPanel({ onCover }: { onCover: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['guide-insights', WINDOW_DAYS],
    queryFn: () => getGuideInsights(WINDOW_DAYS),
    staleTime: 60_000,
  });

  // Quiet while loading or if the endpoint errors — this is a helper panel, not
  // the page's primary content; never block the corpus list behind it.
  if (isLoading || isError || !data) return null;

  const gaps = data.corpus_gaps;

  return (
    <section className="mb-6 rounded-lg border border-semantic-warning/30 bg-semantic-warning/5">
      <div className="flex items-center gap-2 border-b border-semantic-warning/20 px-5 py-3">
        <Search className="h-4 w-4 text-semantic-warning" aria-hidden />
        <h2 className="text-sm font-medium text-ink">Corpus gaps</h2>
        <span className="text-xs text-archive">
          questions your assistant couldn&rsquo;t answer · last {data.period_days} days
        </span>
      </div>

      {gaps.length === 0 ? (
        <p className="px-5 py-4 text-sm text-archive">
          No gaps in the last {data.period_days} days — your corpus is covering what people ask. 🎉
        </p>
      ) : (
        <ul className="divide-y divide-semantic-warning/10">
          {gaps.map((gap, i) => (
            <GapRow key={i} gap={gap} onCover={onCover} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GapRow({ gap, onCover }: { gap: CorpusGap; onCover: () => void }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{gap.question}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-archive">
          <span className="rounded-full bg-stone/60 px-2 py-0.5 font-medium">{gap.count}×</span>
          {gap.last_seen && <span>last asked {formatDateShort(gap.last_seen)}</span>}
          {gap.sample_route && (
            <span className="truncate font-mono text-[10px]">from {gap.sample_route}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onCover}
        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-bark/40 px-2.5 py-1 text-xs font-medium text-bark transition-colors hover:bg-bark/10 focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        title="Upload a document to cover this gap"
      >
        <ArrowUp className="h-3 w-3" aria-hidden />
        Cover this
      </button>
    </li>
  );
}
