import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { BookOpen, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { getCitations, deleteCitation } from '../../lib/api';
import type { Citation } from '../../lib/schemas';
import { formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import ConfirmDialog from '../../components/ConfirmDialog';

const LIMIT = 25;
const SCROLL_KEY = 'citations-scroll';

const TYPE_LABELS: Record<string, string> = {
  book: 'Book',
  article: 'Article',
  catalog: 'Catalog',
  exhibition_catalog: 'Exhibition Catalog',
  dissertation: 'Dissertation',
  website: 'Website',
  manuscript: 'Manuscript',
  newspaper: 'Newspaper',
  journal: 'Journal',
  proceedings: 'Proceedings',
  other: 'Other',
};

const TYPE_STYLES: Record<string, string> = {
  book: 'bg-semantic-info/10 text-semantic-info',
  article: 'bg-forest/10 text-forest',
  catalog: 'bg-copper/10 text-copper',
  exhibition_catalog: 'bg-bark/10 text-bark',
  dissertation: 'bg-stone text-ink',
  website: 'bg-semantic-info/10 text-semantic-info',
  manuscript: 'bg-stone text-ink',
  newspaper: 'bg-stone text-ink',
  journal: 'bg-forest/10 text-forest',
  proceedings: 'bg-stone text-ink',
  other: 'bg-stone text-ink',
};

function CitationRow({ citation, orgId, onDelete }: { citation: Citation; orgId: string; onDelete: (c: Citation) => void }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/citations/${citation.citation_id}/edit`}
          className="text-bark hover:text-copper-dark font-medium no-underline"
        >
          {citation.brief_citation}
        </Link>
        {citation.title && (
          <p className="text-xs text-archive mt-0.5 truncate max-w-md">{citation.title}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${TYPE_STYLES[citation.citation_type] || 'bg-stone text-ink'}`}>
          {TYPE_LABELS[citation.citation_type] || citation.citation_type}
        </span>
      </td>
      <td className="px-4 py-3 text-ink">{citation.author || '—'}</td>
      <td className="px-4 py-3 text-ink">{citation.publication_year || '—'}</td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          {citation.works_cited && (
            <span className="px-2 py-0.5 text-xs bg-stone rounded-full text-ink">Cited</span>
          )}
          {citation.works_illustrated && (
            <span className="px-2 py-0.5 text-xs bg-stone rounded-full text-ink">Illustrated</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onDelete(citation)}
          className="p-1 text-archive hover:text-semantic-error transition-colors"
          title="Delete citation"
        >
          <Trash2 size={16} />
        </button>
      </td>
    </tr>
  );
}

export default function CitationsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  // L10 — Scroll persistence
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    };
  }, []);

  // L18 — Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['citations', orgId, typeFilter, debouncedSearch, offset],
    queryFn: () => getCitations(orgId!, {
      citation_type: typeFilter || undefined,
      search: debouncedSearch || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const showSkeleton = isLoading && !data;

  const deleteMutation = useMutation({
    mutationFn: (citationId: string) => deleteCitation(orgId!, citationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['citations', orgId] });
    },
  });

  const handleDelete = (citation: Citation) => {
    setConfirmState({
      action: () => deleteMutation.mutate(citation.citation_id),
      title: 'Delete Citation',
      message: `Delete citation "${citation.brief_citation}"? This action cannot be undone.`,
    });
  };

  if (showSkeleton) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Error loading citations: {(error as Error).message}
        </div>
      </div>
    );
  }

  const citations = data?.items || [];

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-bark/10 rounded-lg">
              <BookOpen size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Citations</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No citations yet</span>
                  : data.total === 1 ? <span>1 citation</span>
                  : <span>{formatNumber(data.total)} citations</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/citations/create`}
            className="btn btn-primary flex items-center gap-2 no-underline"
          >
            <Plus size={18} />
            Add Citation
          </Link>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 w-full">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search citations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-12 pr-4 py-3 text-lg"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-archive hover:text-ink">
                <X size={18} />
              </button>
            )}
          </div>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table */}
        {citations.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Brief Citation</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Author</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Year</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Flags</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {citations.map((citation) => (
                <CitationRow
                  key={citation.citation_id}
                  citation={citation}
                  orgId={orgId!}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        ) : debouncedSearch || typeFilter ? (
          /* L08 — No search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No citations match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn&apos;t find any citations matching &ldquo;{searchQuery || typeFilter}&rdquo;. Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setTypeFilter(''); setOffset(0); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        ) : (
          /* L08 — First time empty state */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No citations yet.</h3>
          </div>
        )}
      </div>

      {/* L09 — Pagination */}
      {data && data.total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}</p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />
    </div>
  );
}
