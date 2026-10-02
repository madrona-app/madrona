import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Archive,
  Gift,
  ShoppingCart,
  Building2,
  Repeat,
  DollarSign,
  Clock,
  CheckCircle,
  Plus,
  Stamp,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { getAcquisitions } from '../../lib/api';
import type { Acquisition } from '../../lib/schemas';
import { cn } from '../../lib/utils';
import { formatDateShort, formatCurrency, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { StartProcedure } from '../../components/studio/StartProcedure';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  proposed: { label: 'Proposed', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  pending_approval: { label: 'Pending Approval', color: 'bg-copper/10 text-copper', icon: Clock },
  approved: { label: 'Approved', color: 'bg-forest/10 text-forest', icon: CheckCircle },
  completed: { label: 'Completed', color: 'bg-semantic-success/10 text-semantic-success', icon: Stamp },
  accessioned: { label: 'Accessioned', color: 'bg-bark/10 text-bark', icon: Archive },
  cancelled: { label: 'Cancelled', color: 'bg-stone text-archive', icon: Archive },
};

const METHOD_CONFIG: Record<string, { label: string; icon: typeof Gift }> = {
  gift: { label: 'Gift', icon: Gift },
  purchase: { label: 'Purchase', icon: ShoppingCart },
  bequest: { label: 'Bequest', icon: Archive },
  transfer: { label: 'Transfer', icon: Building2 },
  exchange: { label: 'Exchange', icon: Repeat },
  field_collection: { label: 'Field Collection', icon: Archive },
  other: { label: 'Other', icon: Archive },
};

const LIMIT = 25;
const SCROLL_KEY = 'acquisitions-scroll';

function AcquisitionRow({ acquisition, onClick }: { acquisition: Acquisition; onClick: () => void }) {
  const [isHovered, setIsHovered] = useState(false);
  const { orgId } = useParams<{ orgId: string }>();
  const statusConfig = STATUS_CONFIG[acquisition.status] || STATUS_CONFIG.proposed;
  const methodConfig = METHOD_CONFIG[acquisition.acquisition_method] || METHOD_CONFIG.other;
  const StatusIcon = statusConfig.icon;
  const MethodIcon = methodConfig.icon;

  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/acquisitions/${acquisition.acquisition_id}`}
          className="text-bark hover:text-copper-dark font-medium no-underline"
          onClick={(e) => {
            e.stopPropagation();
            sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
          }}
        >
          {acquisition.acquisition_number}
        </Link>
        {acquisition.accession_number && (
          <p className="text-sm text-archive mt-0.5">&rarr; {acquisition.accession_number}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <MethodIcon size={16} className="text-archive" />
          <span className="text-ink">{methodConfig.label}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-ink">{acquisition.source_name || '—'}</td>
      <td className="px-4 py-3 text-ink">
        {formatDateShort(acquisition.acquisition_date)}
      </td>
      <td className="px-4 py-3 text-ink">
        {acquisition.cost
          ? formatCurrency(acquisition.cost, acquisition.cost_currency || 'USD', 0)
          : '—'}
      </td>
      <td className="px-4 py-3">
        <span className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full',
          statusConfig.color
        )}>
          <StatusIcon size={14} />
          {statusConfig.label}
        </span>
      </td>
    </tr>
  );
}

export default function AcquisitionsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [methodFilter, setMethodFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // Restore scroll on mount
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, []);

  // Save scroll on unmount
  useEffect(() => {
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    };
  }, []);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['acquisitions', orgId, debouncedSearch, statusFilter, methodFilter, offset],
    queryFn: () => getAcquisitions(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      acquisition_method: methodFilter || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const showSkeleton = isLoading && !data;

  const acquisitions = data?.items || [];
  const filteredAcquisitions = acquisitions;

  // Calculate stats
  const totalValue = acquisitions
    .filter(a => a.cost)
    .reduce((sum, a) => sum + (a.cost || 0), 0);

  const pendingCount = acquisitions.filter(a => a.status === 'proposed' || a.status === 'pending_approval').length;
  const completedCount = acquisitions.filter(a => a.status === 'completed' || a.status === 'accessioned').length;

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
          Error loading acquisitions: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Archive size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Acquisitions</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No acquisitions yet</span>
                  : data.total === 1 ? <span>1 acquisition</span>
                  : <span>{formatNumber(data.total)} acquisitions</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 sm:self-auto self-start">
            {/* Guided (Studio) entry point — deterministic acquisition_accession plan. */}
            <StartProcedure navItem="acquisitions" label="Start guided" />
            <Link
              to={`/organizations/${orgId}/collections/acquisitions/create`}
              className="btn btn-secondary flex items-center gap-2 no-underline"
            >
              <Plus size={18} />
              New Acquisition
            </Link>
          </div>
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Documents the legal transfer of ownership of an object to the institution. Records acquisition method, dates, approvals, and supporting documentation required to formally add an object to the permanent collection.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <Archive size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{acquisitions.length}</p>
              <p className="text-sm text-archive">Total</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{pendingCount}</p>
              <p className="text-sm text-archive">Pending</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{completedCount}</p>
              <p className="text-sm text-archive">Completed</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-copper/10 rounded-lg flex items-center justify-center">
              <DollarSign size={20} className="text-copper" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {formatCurrency(totalValue, 'USD', 0)}
              </p>
              <p className="text-sm text-archive">Total Value</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 w-full">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search acquisitions..."
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
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-44"
          >
            <option value="">All Statuses</option>
            <option value="proposed">Proposed</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="completed">Completed</option>
            <option value="accessioned">Accessioned</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={methodFilter}
            onChange={(e) => { setMethodFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-44"
          >
            <option value="">All Methods</option>
            <option value="gift">Gift</option>
            <option value="purchase">Purchase</option>
            <option value="bequest">Bequest</option>
            <option value="transfer">Transfer</option>
            <option value="exchange">Exchange</option>
            <option value="field_collection">Field Collection</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table */}
        {filteredAcquisitions.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Acquisition Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Method</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Source</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Value</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {filteredAcquisitions.map((acquisition) => (
                <AcquisitionRow
                  key={acquisition.acquisition_id}
                  acquisition={acquisition}
                  onClick={() => {
                    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
                    navigate(`/organizations/${orgId}/collections/acquisitions/${acquisition.acquisition_id}`);
                  }}
                />
              ))}
            </tbody>
          </table>
        ) : data && data.total === 0 && (debouncedSearch || statusFilter || methodFilter) ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">
              No acquisitions match your search
            </h3>
            <p className="text-archive max-w-md mx-auto mb-6">
              We couldn&apos;t find any acquisitions matching &ldquo;{searchQuery || statusFilter || methodFilter}&rdquo;. Try adjusting your search terms.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('');
                  setMethodFilter('');
                }}
                className="btn btn-secondary"
              >
                <X size={16} className="mr-1.5" />
                Clear filters
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No acquisitions yet.</h3>
            <Link
              to={`/organizations/${orgId}/collections/acquisitions/create`}
              className="btn btn-primary inline-flex items-center gap-2 no-underline"
            >
              <Plus size={16} />
              New Acquisition
            </Link>
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">
            Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}
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
              disabled={offset + LIMIT >= data.total}
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
