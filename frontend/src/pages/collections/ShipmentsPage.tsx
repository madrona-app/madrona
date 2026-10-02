import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Truck,
  Plus,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Package,
  X,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

interface ShipmentSummary {
  shipment_id: string;
  shipment_number: string;
  shipment_type: string;
  shipment_type_label: string;
  direction: string | null;
  direction_label: string | null;
  purpose: string | null;
  purpose_label: string | null;
  status: string;
  status_label: string;
  ship_from_address: Record<string, string> | null;
  ship_to_address: Record<string, string> | null;
  estimated_dispatch_date: string | null;
  actual_dispatch_date: string | null;
  item_count: number;
  created_at: string;
}

interface ListResponse {
  items: ShipmentSummary[];
  summary: {
    total: number;
    in_transit: number;
    delayed: number;
    completed: number;
  };
  total: number;
}

const SCROLL_KEY = 'shipments-scroll';
const LIMIT = 25;

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-ink',
  confirmed: 'bg-semantic-info/10 text-semantic-info',
  dispatched: 'bg-bark/10 text-bark',
  in_transit: 'bg-semantic-info/10 text-semantic-info',
  delayed: 'bg-semantic-warning/10 text-semantic-warning',
  delivered: 'bg-semantic-success/10 text-semantic-success',
  completed: 'bg-semantic-success/10 text-semantic-success',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
};

const formatDate = (dateStr: string | null): string => {
  return formatDateShort(dateStr);
};

function ShipmentRow({ shipment, onClick }: { shipment: ShipmentSummary; onClick: () => void }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <span className="font-medium text-bark">
          {shipment.shipment_number}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {shipment.shipment_type_label}
      </td>
      <td className="px-4 py-3 text-sm">
        {shipment.direction === 'inbound' && (
          <span className="flex items-center gap-1 text-semantic-success">
            <ArrowDownLeft className="w-3.5 h-3.5" />
            Inbound
          </span>
        )}
        {shipment.direction === 'outbound' && (
          <span className="flex items-center gap-1 text-semantic-info">
            <ArrowUpRight className="w-3.5 h-3.5" />
            Outbound
          </span>
        )}
        {!shipment.direction && <span className="text-archive">{'\u2014'}</span>}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[shipment.status] || 'bg-stone text-ink'}`}>
          {shipment.status_label}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {shipment.purpose_label || '\u2014'}
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {formatDate(shipment.actual_dispatch_date || shipment.estimated_dispatch_date)}
      </td>
      <td className="px-4 py-3 text-sm text-right">
        {shipment.item_count > 0 && (
          <span className="flex items-center justify-end gap-1 text-archive">
            <Package className="w-3.5 h-3.5" />
            {shipment.item_count}
          </span>
        )}
        {shipment.item_count === 0 && <span className="text-archive">{'\u2014'}</span>}
      </td>
    </tr>
  );
}

export default function ShipmentsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [directionFilter, setDirectionFilter] = useState<string>('');
  const [purposeFilter, setPurposeFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // Scroll persistence: restore on mount
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, []);

  // Scroll persistence: save on unmount
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
    queryKey: ['shipments', orgId, debouncedSearch, statusFilter, directionFilter, purposeFilter, offset],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      if (directionFilter) params.set('direction', directionFilter);
      if (purposeFilter) params.set('purpose', purposeFilter);
      params.set('limit', String(LIMIT));
      params.set('offset', String(offset));
      return apiFetch<ListResponse>(
        `/organizations/${orgId}/collections/shipments?${params}`
      );
    },
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const handleShipmentClick = useCallback((shipmentId: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/shipments/${shipmentId}`);
  }, [navigate, orgId]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearch('');
    setStatusFilter('');
    setDirectionFilter('');
    setPurposeFilter('');
    setOffset(0);
  }, []);

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
          Error loading shipments: {(error as Error).message}
        </div>
      </div>
    );
  }

  const shipments = data?.items || [];
  const summary = data?.summary || { total: 0, in_transit: 0, delayed: 0, completed: 0 };
  const hasActiveFilters = !!debouncedSearch || !!statusFilter || !!directionFilter || !!purposeFilter;
  const isFirstTimeEmpty = !hasActiveFilters && data?.total === 0;
  const isSearchNoResults = hasActiveFilters && data?.total === 0;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card — L04 */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Truck size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Shipments</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No shipments yet</span>
                  : data.total === 1 ? <span>1 shipment</span>
                  : <span>{formatNumber(data.total)} shipments</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/shipments/create`}
            className="btn btn-primary flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            New Shipment
          </Link>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Track transport logistics for collection objects. Manage multi-leg shipments, items, crates, and linked procedures.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="text-sm text-archive mb-1">Total</div>
          <div className="text-2xl font-semibold text-ink">{summary.total}</div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="text-sm text-archive mb-1 flex items-center gap-1">
            <Truck className="w-3.5 h-3.5 text-semantic-info" />
            In Transit
          </div>
          <div className="text-2xl font-semibold text-semantic-info">{summary.in_transit}</div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="text-sm text-archive mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-semantic-warning" />
            Delayed
          </div>
          <div className="text-2xl font-semibold text-semantic-warning">{summary.delayed}</div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="text-sm text-archive mb-1 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-semantic-success" />
            Completed
          </div>
          <div className="text-2xl font-semibold text-semantic-success">{summary.completed}</div>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Toolbar */}
        <div className="p-4 border-b border-lichen">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
              <input
                type="text"
                placeholder="Search shipments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input w-full pl-12 pr-4 py-3 text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
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
              className="px-3 py-2 border border-lichen rounded-lg text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="dispatched">Dispatched</option>
              <option value="in_transit">In Transit</option>
              <option value="delayed">Delayed</option>
              <option value="delivered">Delivered</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={directionFilter}
              onChange={(e) => { setDirectionFilter(e.target.value); setOffset(0); }}
              className="px-3 py-2 border border-lichen rounded-lg text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              <option value="">All Directions</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            <select
              value={purposeFilter}
              onChange={(e) => { setPurposeFilter(e.target.value); setOffset(0); }}
              className="px-3 py-2 border border-lichen rounded-lg text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              <option value="">All Purposes</option>
              <option value="loan">Loan</option>
              <option value="exhibition">Exhibition</option>
              <option value="conservation">Conservation</option>
              <option value="acquisition">Acquisition</option>
              <option value="repatriation">Repatriation</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {shipments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              {/* L06 */}
              <thead className="bg-stone/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Shipment #</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Direction</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Purpose</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Dispatch Date</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-ink">Items</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lichen">
                {shipments.map((shipment) => (
                  <ShipmentRow key={shipment.shipment_id} shipment={shipment} onClick={() => handleShipmentClick(shipment.shipment_id)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : isSearchNoResults ? (
          /* L08: Empty state - no search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">
              No shipments match your search
            </h3>
            <p className="text-archive max-w-md mx-auto mb-6">
              We couldn't find any shipments matching your criteria. Try adjusting your search terms or clearing some filters.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={clearFilters} className="btn btn-secondary">
                <X size={16} className="mr-1.5" />
                Clear filters
              </button>
            </div>
          </div>
        ) : isFirstTimeEmpty ? (
          /* L08: Empty state - first time (no data) */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-bark/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No shipments yet.</h3>
            <div className="flex items-center justify-center gap-4">
              <Link
                to={`/organizations/${orgId}/collections/shipments/create`}
                className="btn btn-primary flex items-center gap-2"
              >
                <Plus size={18} />
                Create Shipment
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {/* L09: Pagination */}
      {data && data.total > LIMIT && (
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
