import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { LayoutGrid, Calendar, AlertTriangle, Clock, CheckCircle, Plus, Search, Eye, Archive, X, Sparkles } from 'lucide-react';
import { getExhibitions } from '../../lib/api';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const SCROLL_KEY = 'exhibitions-scroll';
const LIMIT = 24;

const STATUS_STYLES: Record<string, string> = {
  proposed: 'bg-stone text-ink',
  authorized: 'bg-semantic-info/10 text-semantic-info',
  in_preparation: 'bg-semantic-warning/10 text-semantic-warning',
  open: 'bg-semantic-success/10 text-semantic-success',
  closed: 'bg-bark/10 text-bark',
  archived: 'bg-archive/10 text-archive',
};

const TYPE_LABELS: Record<string, string> = {
  permanent: 'Permanent',
  temporary: 'Temporary',
  touring: 'Touring',
  traveling: 'Traveling',
  online: 'Online',
  pop_up: 'Pop-up',
};

function ExhibitionRow({ exhibition, onClick }: { exhibition: any; onClick: () => void }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <span className="text-bark hover:text-copper-dark font-medium">
          {exhibition.title}
        </span>
        {exhibition.exhibition_number && (
          <p className="text-sm text-archive mt-0.5">{exhibition.exhibition_number}</p>
        )}
      </td>
      <td className="px-4 py-3 text-ink">
        {TYPE_LABELS[exhibition.exhibition_type] || exhibition.exhibition_type}
      </td>
      <td className="px-4 py-3 text-ink">
        {exhibition.venue_name || '\u2014'}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Calendar size={14} className="text-archive" />
          <span className="text-ink">
            {formatDateShort(exhibition.planned_start_date)}
          </span>
          <span className="text-archive">\u2192</span>
          <span className="text-ink">
            {formatDateShort(exhibition.planned_end_date)}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-ink">
        {exhibition.placement_count || 0}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[exhibition.status] || 'bg-stone text-ink'}`}>
          {exhibition.status.replace('_', ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </span>
      </td>
    </tr>
  );
}

export default function ExhibitionsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // L17: Scroll persistence — restore
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, []);

  // L17: Scroll persistence — save on cleanup
  useEffect(() => {
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    };
  }, []);

  // L18: Debounce with offset reset
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['exhibitions', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () => getExhibitions(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      exhibition_type: typeFilter || undefined,
      limit: LIMIT,
      offset: offset || undefined,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  // L20: Smart skeleton
  const showSkeleton = isLoading && !data;

  // L23: Navigation handler with scroll save
  const handleExhibitionClick = useCallback((exhibitionId: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/exhibitions/${exhibitionId}`);
  }, [navigate, orgId]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearch('');
    setStatusFilter('');
    setTypeFilter('');
    setOffset(0);
  }, []);

  const hasActiveFilters = debouncedSearch || statusFilter || typeFilter;

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
          Error loading exhibitions: {(error as Error).message}
        </div>
      </div>
    );
  }

  const exhibitions = data?.exhibitions || [];
  const isFirstTimeEmpty = !hasActiveFilters && exhibitions.length === 0 && !isFetching;
  const isSearchNoResults = !!hasActiveFilters && exhibitions.length === 0 && !isFetching;

  // Find exhibitions opening soon (within 30 days)
  const today = new Date();
  const openingSoon = exhibitions.filter(exhibition => {
    if (!exhibition.planned_start_date || exhibition.status === 'open' || exhibition.status === 'closed' || exhibition.status === 'archived') return false;
    const startDate = new Date(exhibition.planned_start_date);
    const daysUntilStart = Math.floor((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilStart >= 0 && daysUntilStart <= 30;
  });

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <LayoutGrid size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Exhibitions</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No exhibitions yet</span>
                  : data.total === 1 ? <span>1 exhibition</span>
                  : <span>{formatNumber(data.total)} exhibitions</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/exhibitions/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              New Exhibition
            </Link>
          ) : (
            <span
              className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start"
              title="Requires collections.create permission"
            >
              <Plus size={18} />
              New Exhibition
            </span>
          )}
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Manage exhibition records as a collections procedure. Track exhibition proposals, authorizations, object loans, and installation documentation.
        </p>
      </div>

      {/* Alert for exhibitions opening soon */}
      {openingSoon.length > 0 && (
        <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-semantic-warning mt-0.5" />
            <div>
              <h3 className="font-medium text-ink">Exhibitions Opening Soon</h3>
              <p className="text-sm text-archive mt-1">
                {openingSoon.length} exhibition{openingSoon.length !== 1 ? 's' : ''} opening within 30 days.
                Ensure all preparations are complete.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <Eye size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {exhibitions.filter(e => e.status === 'open').length}
              </p>
              <p className="text-sm text-archive">Currently Open</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {exhibitions.filter(e => e.status === 'in_preparation').length}
              </p>
              <p className="text-sm text-archive">In Preparation</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-info/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-info" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {exhibitions.filter(e => e.status === 'proposed' || e.status === 'authorized').length}
              </p>
              <p className="text-sm text-archive">Upcoming</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-archive/10 rounded-lg flex items-center justify-center">
              <Archive size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {exhibitions.filter(e => e.status === 'closed' || e.status === 'archived').length}
              </p>
              <p className="text-sm text-archive">Completed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search Hero */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 w-full">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search exhibitions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-12 pr-4 py-3 text-lg"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-archive hover:text-ink"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Statuses</option>
            <option value="proposed">Proposed</option>
            <option value="authorized">Authorized</option>
            <option value="in_preparation">In Preparation</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Types</option>
            <option value="permanent">Permanent</option>
            <option value="temporary">Temporary</option>
            <option value="touring">Touring</option>
            <option value="traveling">Traveling</option>
            <option value="online">Online</option>
            <option value="pop_up">Pop-up</option>
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table */}
        {exhibitions.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Exhibition</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Venue</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Dates</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Objects</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {exhibitions.map((exhibition) => (
                <ExhibitionRow
                  key={exhibition.exhibition_id}
                  exhibition={exhibition}
                  onClick={() => handleExhibitionClick(exhibition.exhibition_id)}
                />
              ))}
            </tbody>
          </table>
        ) : isSearchNoResults ? (
          /* L13: Empty state — no search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">
              No exhibitions match your search
            </h3>
            <p className="text-archive max-w-md mx-auto mb-6">
              We couldn&apos;t find any exhibitions matching &ldquo;{debouncedSearch || statusFilter || typeFilter}&rdquo;. Try adjusting your search terms or clearing some filters.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={clearFilters} className="btn btn-secondary">
                <X size={16} className="mr-1.5" />
                Clear filters
              </button>
            </div>
          </div>
        ) : isFirstTimeEmpty ? (
          /* L14: Empty state — first time (no data) */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No exhibitions yet.</h3>
            <div className="flex items-center justify-center gap-4">
              <Link
                to={`/organizations/${orgId}/collections/exhibitions/create`}
                className="btn btn-primary flex items-center gap-2"
              >
                <Plus size={18} />
                Create Exhibition
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {/* L16: Pagination */}
      {data && data.total !== undefined && data.total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">
            Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
