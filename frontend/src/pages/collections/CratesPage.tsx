import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Box,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Thermometer,
  Loader2,
  X,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

interface CrateSummary {
  crate_id: string;
  crate_number: string;
  description: string | null;
  height_cm: string | null;
  width_cm: string | null;
  depth_cm: string | null;
  condition: string | null;
  condition_label: string | null;
  location: { location_id: string; name: string | null } | null;
  climate_controlled: boolean;
  is_active: boolean;
}

interface ListResponse {
  items: CrateSummary[];
  total: number;
}

const CONDITION_STYLES: Record<string, string> = {
  good: 'bg-semantic-success/10 text-semantic-success',
  fair: 'bg-semantic-warning/10 text-semantic-warning',
  poor: 'bg-semantic-warning/10 text-semantic-warning',
  damaged: 'bg-semantic-error/10 text-semantic-error',
};

const LIMIT = 25;
const SCROLL_KEY = 'crates-scroll';

function CrateRow({ crate, onClick }: { crate: CrateSummary; onClick: () => void }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <button
          className="font-medium text-bark hover:text-copper-dark text-left bg-transparent border-0 p-0 cursor-pointer"
        >
          {crate.crate_number}
        </button>
        {crate.description && (
          <div className="text-xs text-archive mt-0.5 truncate max-w-[200px]">{crate.description}</div>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {crate.height_cm && crate.width_cm && crate.depth_cm
          ? `${crate.height_cm} x ${crate.width_cm} x ${crate.depth_cm} cm`
          : '\u2014'}
      </td>
      <td className="px-4 py-3">
        {crate.condition_label ? (
          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${CONDITION_STYLES[crate.condition!] || 'bg-stone text-ink'}`}>
            {crate.condition_label}
          </span>
        ) : (
          <span className="text-sm text-archive">\u2014</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {crate.location?.name || '\u2014'}
      </td>
      <td className="px-4 py-3 text-center">
        {crate.climate_controlled ? (
          <Thermometer className="w-4 h-4 text-semantic-info mx-auto" />
        ) : (
          <span className="text-archive">\u2014</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        {crate.is_active ? (
          <CheckCircle2 className="w-4 h-4 text-semantic-success mx-auto" />
        ) : (
          <XCircle className="w-4 h-4 text-archive mx-auto" />
        )}
      </td>
    </tr>
  );
}

export default function CratesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('true');
  const [offset, setOffset] = useState(0);

  // L10: Scroll persistence
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) { sessionStorage.removeItem(SCROLL_KEY); requestAnimationFrame(() => { document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10)); }); }
  }, []);
  useEffect(() => { return () => { sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0))); }; }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, activeFilter]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['crates', orgId, debouncedSearch, activeFilter, offset],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      params.set('active', activeFilter);
      params.set('limit', String(LIMIT));
      params.set('offset', String(offset));
      return apiFetch<ListResponse>(
        `/organizations/${orgId}/collections/crates?${params}`
      );
    },
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const handleCrateClick = useCallback((crateId: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/crates/${crateId}`);
  }, [navigate, orgId]);

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
          Error loading crates: {(error as Error).message}
        </div>
      </div>
    );
  }

  const crates = data?.items || [];
  const hasFilters = !!(searchQuery || activeFilter !== 'true');

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card — L04: search hero */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Box size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Crates</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No crates yet</span>
                  : data.total === 1 ? <span>1 crate</span>
                  : <span>{formatNumber(data.total)} crates</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/crates/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            New Crate
          </Link>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Manage reusable shipping and storage containers. Track dimensions, condition, and current location.
        </p>
      </div>

      {/* Content Card */}
      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-lichen">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
              <input
                type="text"
                placeholder="Search crates..."
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
              value={activeFilter}
              onChange={(e) => { setActiveFilter(e.target.value); setOffset(0); }}
              className="px-3 py-2 border border-lichen rounded-lg text-sm text-ink bg-parchment"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>

        {/* L08: Two empty states */}
        {crates.length === 0 && hasFilters ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No crates match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn&apos;t find any crates matching your current filters. Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setActiveFilter('true'); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        ) : crates.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No crates yet.</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              {/* L06: thead/th styles */}
              <thead className="bg-stone/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Crate #</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Dimensions (H x W x D)</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Condition</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Location</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Climate</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lichen">
                {crates.map((crate) => (
                  <CrateRow key={crate.crate_id} crate={crate} onClick={() => handleCrateClick(crate.crate_id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Loading indicator for refetch */}
        {isFetching && !isLoading && (
          <div className="px-4 py-2 bg-stone/30 border-t border-lichen flex items-center gap-2 text-sm text-archive">
            <Loader2 size={14} className="animate-spin" />
            Updating...
          </div>
        )}
      </div>

      {/* L09: Pagination */}
      {data && data.total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}</p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
