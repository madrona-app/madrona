import { useState, useEffect, useLayoutEffect } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { DollarSign, TrendingUp, CheckCircle, Clock, Plus, Search, X, Sparkles } from 'lucide-react';
import { getValuations } from '../../lib/api';
import type { Valuation } from '../../lib/schemas';
import { formatDateShort, formatCurrency as fmtCurrency, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const VALUATION_TYPE_LABELS: Record<string, string> = {
  insurance: 'Insurance',
  market: 'Market Value',
  replacement: 'Replacement Cost',
  probate: 'Probate',
  donation: 'Donation',
  internal: 'Internal',
};

const STATUS_STYLES: Record<string, string> = {
  current: 'bg-semantic-success/10 text-semantic-success',
  expired: 'bg-stone text-archive',
};

const LIMIT = 25;
const SCROLL_KEY = 'valuations-scroll';

function ValuationRow({ valuation, onClick, formatCurrency }: { valuation: Valuation; onClick: () => void; formatCurrency: (amount: number | null, currency?: string) => string }) {
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
          {valuation.object_number || valuation.object_title || valuation.object_id?.slice(0, 8) || 'Collection-level'}
        </span>
      </td>
      <td className="px-4 py-3 text-ink">
        {VALUATION_TYPE_LABELS[valuation.valuation_type] || valuation.valuation_type}
      </td>
      <td className="px-4 py-3 font-medium text-ink">
        {formatCurrency(valuation.valuation_amount ?? null, valuation.valuation_currency)}
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {formatDateShort(valuation.valuation_date)}
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {valuation.valuator_name || valuation.valuator_organization || '\u2014'}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${valuation.is_current ? STATUS_STYLES.current : STATUS_STYLES.expired}`}>
          {valuation.is_current ? 'Current' : 'Expired'}
        </span>
      </td>
    </tr>
  );
}

export default function ValuationsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [currentOnly, setCurrentOnly] = useState<boolean>(true);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) { sessionStorage.removeItem(SCROLL_KEY); requestAnimationFrame(() => { document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10)); }); }
  }, []);

  useEffect(() => {
    return () => { sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0))); };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['valuations', orgId, debouncedSearch, typeFilter, currentOnly],
    queryFn: () => getValuations(orgId!, {
      q: debouncedSearch || undefined,
      valuation_type: typeFilter || undefined,
      is_current: currentOnly || undefined,
      limit: 50,
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
          Error loading valuations: {(error as Error).message}
        </div>
      </div>
    );
  }

  const valuations = data?.items || [];

  // Client-side search filtering
  const allFilteredValuations = valuations.filter(valuation => {
    if (!debouncedSearch) return true;
    const searchLower = debouncedSearch.toLowerCase();
    return (
      valuation.object_number?.toLowerCase().includes(searchLower) ||
      valuation.object_title?.toLowerCase().includes(searchLower) ||
      valuation.valuator_name?.toLowerCase().includes(searchLower) ||
      valuation.valuator_organization?.toLowerCase().includes(searchLower)
    );
  });

  const filteredValuations = allFilteredValuations.slice(offset, offset + LIMIT);
  const hasActiveFilters = debouncedSearch || typeFilter;

  // Stats by type
  const insuranceTotal = valuations
    .filter(v => v.valuation_type === 'insurance' && v.is_current)
    .reduce((sum, v) => sum + (v.valuation_amount ?? 0), 0);
  const marketTotal = valuations
    .filter(v => v.valuation_type === 'market' && v.is_current)
    .reduce((sum, v) => sum + (v.valuation_amount ?? 0), 0);
  const currentCount = valuations.filter(v => v.is_current).length;
  const expiredCount = valuations.filter(v => !v.is_current).length;

  const formatCurrency = (amount: number | null, currency = 'USD') => {
    return fmtCurrency(amount, currency, 0);
  };

  const handleValuationClick = (id: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/valuations/${id}`);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card — L02 */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <DollarSign size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Valuations</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No valuations yet</span>
                  : data.total === 1 ? <span>1 valuation</span>
                  : <span>{formatNumber(data.total)} valuations</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/valuations/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              Create Valuation
            </Link>
          ) : (
            <span className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start" title="Requires collections.create permission">
              <Plus size={18} />
              Create Valuation
            </span>
          )}
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Records financial values assigned to objects for insurance, indemnity, or risk assessment purposes. Values may change over time and do not necessarily reflect market or sale price.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <DollarSign size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{formatCurrency(insuranceTotal)}</p>
              <p className="text-sm text-archive">Insurance Total</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-info/10 rounded-lg flex items-center justify-center">
              <TrendingUp size={20} className="text-semantic-info" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{formatCurrency(marketTotal)}</p>
              <p className="text-sm text-archive">Market Total</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{currentCount}</p>
              <p className="text-sm text-archive">Current</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{expiredCount}</p>
              <p className="text-sm text-archive">Expired</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search valuations..."
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
            <option value="insurance">Insurance</option>
            <option value="market">Market Value</option>
            <option value="replacement">Replacement Cost</option>
            <option value="probate">Probate</option>
            <option value="donation">Donation</option>
            <option value="internal">Internal</option>
          </select>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={currentOnly}
              onChange={(e) => { setCurrentOnly(e.target.checked); setOffset(0); }}
            />
            <span className="text-sm text-ink">Current valuations only</span>
          </label>
        </div>
      </div>

      {/* Table — L05 */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        <table className="w-full">
          <thead className="bg-stone/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Object</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Amount</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Date</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Valuator</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-lichen">
            {filteredValuations.map((valuation) => (
              <ValuationRow
                key={valuation.valuation_id}
                valuation={valuation}
                onClick={() => handleValuationClick(valuation.valuation_id)}
                formatCurrency={formatCurrency}
              />
            ))}
          </tbody>
        </table>

        {/* L08 — No search results empty state */}
        {filteredValuations.length === 0 && hasActiveFilters && (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No valuations match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn't find any valuations matching your filters. Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setTypeFilter(''); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        )}

        {/* L08 — First-time empty state */}
        {filteredValuations.length === 0 && !hasActiveFilters && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No valuations yet.</h3>
          </div>
        )}
      </div>

      {/* Pagination — L09 */}
      {allFilteredValuations.length > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">Showing {offset + 1} - {Math.min(offset + LIMIT, allFilteredValuations.length)} of {allFilteredValuations.length}</p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= allFilteredValuations.length} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
