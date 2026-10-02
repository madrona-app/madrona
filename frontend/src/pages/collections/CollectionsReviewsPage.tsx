import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ClipboardCheck, CheckCircle, PlayCircle, FileText, Search, Sparkles, X } from 'lucide-react';
import { getCollectionsReviews } from '../../lib/api';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { MadronaLoader, MadronaProgressBar } from '../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  approved: 'bg-semantic-success/10 text-semantic-success',
  in_progress: 'bg-forest/10 text-forest',
  completed: 'bg-stone text-archive',
  cancelled: 'bg-stone text-archive',
};

const TYPE_LABELS: Record<string, string> = {
  significance: 'Significance',
  relevance: 'Relevance',
  care: 'Care',
  deaccession: 'Deaccession',
  rationalization: 'Rationalization',
  thematic: 'Thematic',
  condition: 'Condition',
  documentation: 'Documentation',
  comprehensive: 'Comprehensive',
};

const LIMIT = 25;
const SCROLL_KEY = 'collections-reviews-scroll';

interface Review {
  review_id: string;
  title?: string | null;
  review_number?: string | null;
  scope_description?: string | null;
  review_type: string;
  objects_total: number;
  objects_reviewed: number;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  status: string;
}

function ReviewRow({ review, orgId }: { review: Review; orgId: string }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/reviews/${review.review_id}`}
          className="text-bark hover:text-copper-dark font-medium"
          onClick={() => sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)))}
        >
          {review.title || review.review_number || review.review_id.slice(0, 8)}
        </Link>
        {review.scope_description && (
          <p className="text-sm text-archive mt-0.5 line-clamp-1">
            {review.scope_description}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-ink">
        {TYPE_LABELS[review.review_type] || review.review_type}
      </td>
      <td className="px-4 py-3">
        <MadronaProgressBar
          value={review.objects_total > 0 ? Math.round((review.objects_reviewed / review.objects_total) * 100) : 0}
          label={`${review.objects_reviewed}/${review.objects_total}`}
          className="max-w-[140px]"
        />
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {review.planned_start_date && review.planned_end_date ? (
          <>
            {formatDateShort(review.planned_start_date)} -{' '}
            {formatDateShort(review.planned_end_date)}
          </>
        ) : (
          <span className="text-archive">&mdash;</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[review.status] || 'bg-stone text-archive'}`}>
          {review.status.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </span>
      </td>
    </tr>
  );
}

export default function CollectionsReviewsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // L10: Restore scroll on mount
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, []);

  // L10: Save scroll on unmount
  useEffect(() => {
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['collections-reviews', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () => getCollectionsReviews(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      review_type: typeFilter || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const showSkeleton = isLoading && !data;

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
          Error loading collections reviews: {(error as Error).message}
        </div>
      </div>
    );
  }

  const reviews = data?.items || [];
  const total = data?.total ?? 0;
  const hasFilters = debouncedSearch || statusFilter || typeFilter;

  // Stats
  const draftCount = reviews.filter(r => r.status === 'draft').length;
  const approvedCount = reviews.filter(r => r.status === 'approved').length;
  const inProgressCount = reviews.filter(r => r.status === 'in_progress').length;
  const completedCount = reviews.filter(r => r.status === 'completed').length;

  return (
    <div className="max-w-6xl mx-auto">
      {/* L02: Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <ClipboardCheck size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Collections Reviews</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No reviews yet</span>
                  : data.total === 1 ? <span>1 review</span>
                  : <span>{formatNumber(data.total)} reviews</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/reviews/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            New Review
          </Link>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Collections Review procedure. Schedule and track periodic reviews of your collection to ensure objects are properly stored, documented, and accessible.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <FileText size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{draftCount}</p>
              <p className="text-sm text-archive">Draft</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{approvedCount}</p>
              <p className="text-sm text-archive">Approved</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <PlayCircle size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{inProgressCount}</p>
              <p className="text-sm text-archive">In Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{completedCount}</p>
              <p className="text-sm text-archive">Completed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search reviews..."
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
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Types</option>
            <option value="significance">Significance</option>
            <option value="relevance">Relevance</option>
            <option value="care">Care</option>
            <option value="deaccession">Deaccession</option>
            <option value="rationalization">Rationalization</option>
            <option value="thematic">Thematic</option>
            <option value="condition">Condition</option>
            <option value="documentation">Documentation</option>
            <option value="comprehensive">Comprehensive</option>
          </select>
        </div>
      </div>

      {/* L05: Table with opacity transition */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        <table className="w-full">
          <thead className="bg-stone/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Review</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Progress</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Planned Dates</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-lichen">
            {reviews.map((review) => (
              <ReviewRow
                key={review.review_id}
                review={review}
                orgId={orgId!}
              />
            ))}
          </tbody>
        </table>

        {/* L08: No search results empty state */}
        {reviews.length === 0 && hasFilters && (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No reviews match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">Try adjusting your filters or search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setTypeFilter(''); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        )}

        {/* L08: First-time empty state */}
        {reviews.length === 0 && !hasFilters && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No collection reviews yet.</h3>
            <Link
              to={`/organizations/${orgId}/collections/reviews/create`}
              className="btn btn-primary inline-flex items-center gap-2 no-underline"
            >
              New Review
            </Link>
          </div>
        )}
      </div>

      {/* L09: Pagination */}
      {data && total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">
            Showing {offset + 1} - {Math.min(offset + LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="btn btn-tertiary text-sm"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= total}
              className="btn btn-tertiary text-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
