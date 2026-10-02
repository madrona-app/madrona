import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  LogOut,
  Truck,
  CheckCircle,
  Clock,
  Package,
  Plus,
  RotateCcw,
  ArrowRightLeft,
  Trash2,
  FileX,
  Send,
  AlertTriangle,
  Search,
  X,
  Sparkles,
} from 'lucide-react';
import { getObjectExits } from '../../lib/api';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/utils';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const SCROLL_KEY = 'object-exits-scroll';
const LIMIT = 24;

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'bg-semantic-warning/10 text-semantic-warning', icon: Clock },
  preparing: { label: 'Preparing', color: 'bg-copper/10 text-copper', icon: Package },
  dispatched: { label: 'Dispatched', color: 'bg-bark/10 text-bark', icon: Send },
  in_transit: { label: 'In Transit', color: 'bg-forest/10 text-forest', icon: Truck },
  acknowledged: { label: 'Acknowledged', color: 'bg-semantic-success/10 text-semantic-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-stone text-archive', icon: FileX },
};

const REASON_CONFIG: Record<string, { label: string; icon: typeof LogOut }> = {
  loan_return: { label: 'Loan Return', icon: RotateCcw },
  loan_out: { label: 'Loan Out', icon: LogOut },
  transfer: { label: 'Transfer', icon: ArrowRightLeft },
  disposal: { label: 'Disposal', icon: Trash2 },
  deaccession: { label: 'Deaccession', icon: FileX },
  conservation: { label: 'Conservation', icon: Package },
  photography: { label: 'Photography', icon: Package },
  enquiry_return: { label: 'Enquiry Return', icon: RotateCcw },
  repatriation: { label: 'Repatriation', icon: ArrowRightLeft },
  destruction: { label: 'Destruction', icon: AlertTriangle },
  theft_loss: { label: 'Theft/Loss', icon: AlertTriangle },
  other: { label: 'Other', icon: LogOut },
};

interface ExitRowProps {
  exit: {
    exit_id: string;
    exit_number: string;
    status: string;
    exit_reason: string;
    recipient_name?: string | null;
    exit_date?: string | null;
    exit_method?: string | null;
  };
  onClick: () => void;
}

function ExitRow({ exit, onClick }: ExitRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const statusConfig = STATUS_CONFIG[exit.status] || STATUS_CONFIG.pending;
  const reasonConfig = REASON_CONFIG[exit.exit_reason] || REASON_CONFIG.other;
  const StatusIcon = statusConfig.icon;
  const ReasonIcon = reasonConfig.icon;

  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <span className="text-bark hover:text-copper-dark font-medium">
          {exit.exit_number}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <ReasonIcon size={16} className="text-archive" />
          <span className="text-ink">{reasonConfig.label}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-ink">{exit.recipient_name || '—'}</td>
      <td className="px-4 py-3 text-ink">
        {exit.exit_date
          ? formatDateShort(exit.exit_date)
          : '—'}
      </td>
      <td className="px-4 py-3 text-ink">
        {exit.exit_method
          ? exit.exit_method.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
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

export default function ObjectExitsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [reasonFilter, setReasonFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // L17: Scroll persistence — restore on mount
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, []);

  // L17: Scroll persistence — save on unmount
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
    queryKey: ['object-exits', orgId, debouncedSearch, statusFilter, reasonFilter, offset],
    queryFn: () => getObjectExits(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      exit_reason: reasonFilter || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const exits = data?.items || [];

  // L20: Smart skeleton
  const showSkeleton = isLoading && !data;

  // Calculate stats
  const pendingCount = exits.filter(e => e.status === 'pending' || e.status === 'preparing').length;
  const inTransitCount = exits.filter(e => e.status === 'dispatched' || e.status === 'in_transit').length;
  const acknowledgedCount = exits.filter(e => e.status === 'acknowledged').length;

  const hasActiveFilters = !!debouncedSearch || !!statusFilter || !!reasonFilter;

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearch('');
    setStatusFilter('');
    setReasonFilter('');
    setOffset(0);
  }, []);

  // L23: Navigation handler — save scroll before navigating
  const handleExitClick = useCallback((exitId: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/exits/${exitId}`);
  }, [navigate, orgId]);

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
          Error loading object exits: {(error as Error).message}
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
              <LogOut size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Object Exit</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No exits yet</span>
                  : data.total === 1 ? <span>1 exit</span>
                  : <span>{formatNumber(data.total)} exits</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/exits/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              New Object Exit
            </Link>
          ) : (
            <span
              className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start"
              title="Requires collections.create permission"
            >
              <Plus size={18} />
              New Object Exit
            </span>
          )}
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Records the permanent or temporary departure of objects from institutional custody. Used for returns, disposals, transfers, or other non-loan exits.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <LogOut size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{data?.total ?? exits.length}</p>
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
            <div className="w-10 h-10 bg-bark/10 rounded-lg flex items-center justify-center">
              <Truck size={20} className="text-bark" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{inTransitCount}</p>
              <p className="text-sm text-archive">In Transit</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{acknowledgedCount}</p>
              <p className="text-sm text-archive">Acknowledged</p>
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
              placeholder="Search exits..."
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
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-44"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="preparing">Preparing</option>
            <option value="dispatched">Dispatched</option>
            <option value="in_transit">In Transit</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={reasonFilter}
            onChange={(e) => { setReasonFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-44"
          >
            <option value="">All Reasons</option>
            <option value="enquiry_return">Enquiry Return</option>
            <option value="loan_return">Loan Return</option>
            <option value="loan_out">Loan Out</option>
            <option value="transfer">Transfer</option>
            <option value="deaccession">Deaccession</option>
            <option value="conservation">Conservation</option>
            <option value="repatriation">Repatriation</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table or Empty States */}
        {exits.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Exit Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Reason</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Recipient</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Exit Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Method</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {exits.map((exit) => (
                <ExitRow
                  key={exit.exit_id}
                  exit={exit}
                  onClick={() => handleExitClick(exit.exit_id)}
                />
              ))}
            </tbody>
          </table>
        ) : hasActiveFilters ? (
          /* L13: Empty state — no search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">
              No exits match your search
            </h3>
            <p className="text-archive max-w-md mx-auto mb-6">
              We couldn't find any exits matching your current filters. Try adjusting your search terms or clearing some filters.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={clearFilters} className="btn btn-secondary">
                <X size={16} className="mr-1.5" />
                Clear filters
              </button>
            </div>
          </div>
        ) : (
          /* L14: Empty state — first time (no data) */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No exits yet.</h3>
            <div className="flex items-center justify-center gap-4">
              <Link
                to={`/organizations/${orgId}/collections/exits/create`}
                className="btn btn-primary flex items-center gap-2"
              >
                <Plus size={18} />
                Create First Exit
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* L16: Pagination */}
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
