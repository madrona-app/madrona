import { useState, useEffect, useLayoutEffect, useCallback, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Download, Building2, Calendar, AlertTriangle, Clock, CheckCircle, Plus, Search, Map, List, X, Sparkles } from 'lucide-react';
import { getLoansIn } from '../../lib/api';
import { formatDateShort, formatCurrency, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { useGeo } from '../../hooks/useGeo';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
// Lazy load the map component
const LoanNetworkMap = lazy(() => import('../../components/maps/LoanNetworkMap'));

type ViewMode = 'list' | 'map';

const SCROLL_KEY = 'loans-in-scroll';
const LIMIT = 24;

const STATUS_STYLES: Record<string, string> = {
  requested: 'bg-stone text-ink',
  approved: 'bg-semantic-info/10 text-semantic-info',
  received: 'bg-bark/10 text-bark',
  on_loan: 'bg-semantic-success/10 text-semantic-success',
  returned: 'bg-stone text-ink',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
};

const PURPOSE_LABELS: Record<string, string> = {
  exhibition: 'Exhibition',
  research: 'Research',
  conservation: 'Conservation',
  long_term: 'Long-term',
  other: 'Other',
};

function LoanRow({ loan, onClick }: { loan: any; onClick: () => void }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <span className="text-bark font-medium">
          {loan.loan_number}
        </span>
        {loan.exhibition_name && (
          <p className="text-sm text-archive mt-0.5">{loan.exhibition_name}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-archive" />
          <span className="text-ink">{loan.lender_name || '—'}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-ink">
        {PURPOSE_LABELS[loan.loan_purpose] || loan.loan_purpose}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Calendar size={14} className="text-archive" />
          <span className="text-ink">
            {formatDateShort(loan.loan_start_date)}
          </span>
          <span className="text-archive">→</span>
          <span className="text-ink">
            {formatDateShort(loan.loan_end_date)}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-ink">
        {loan.insurance_value
          ? formatCurrency(loan.insurance_value, loan.insurance_currency || 'USD', 0)
          : '—'}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[loan.status] || 'bg-stone text-ink'}`}>
          {loan.status.replace('_', ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </span>
      </td>
    </tr>
  );
}

export default function LoansInPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [purposeFilter, setPurposeFilter] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
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

  // Fetch loan network data for map
  const { useLoanNetwork } = useGeo();
  const { data: loanNetworkData, isLoading: isLoadingNetwork } = useLoanNetwork(false, {
    enabled: viewMode === 'map',
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['loans-in', orgId, debouncedSearch, statusFilter, purposeFilter, offset],
    queryFn: () => getLoansIn(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      loan_purpose: purposeFilter || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const handleLoanClick = useCallback((loanId: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/loans-in/${loanId}`);
  }, [navigate, orgId]);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearch('');
    setStatusFilter('');
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
          Error loading loans: {(error as Error).message}
        </div>
      </div>
    );
  }

  const loans = data?.items || [];
  const hasActiveFilters = !!debouncedSearch || !!statusFilter || !!purposeFilter;
  const isFirstTimeEmpty = !hasActiveFilters && data?.total === 0;
  const isSearchNoResults = hasActiveFilters && data?.total === 0;

  // Find loans expiring soon (within 30 days)
  const today = new Date();
  const expiringSoon = loans.filter(loan => {
    if (!loan.loan_end_date || loan.status === 'returned') return false;
    const endDate = new Date(loan.loan_end_date);
    const daysUntilEnd = Math.floor((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilEnd >= 0 && daysUntilEnd <= 30;
  });

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Download size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Loans In</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No loans yet</span>
                  : data.total === 1 ? <span>1 loan</span>
                  : <span>{formatNumber(data.total)} loans</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/loans-in/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              New Incoming Loan
            </Link>
          ) : (
            <span
              className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start"
              title="Requires collections.create permission"
            >
              <Plus size={18} />
              New Incoming Loan
            </span>
          )}
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Documents objects borrowed by the institution from external lenders. Records agreements, conditions, movements, and responsibilities for incoming loans.
        </p>
      </div>

      {/* Alert for expiring loans */}
      {expiringSoon.length > 0 && (
        <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-semantic-warning mt-0.5" />
            <div>
              <h3 className="font-medium text-ink">Loans Expiring Soon</h3>
              <p className="text-sm text-archive mt-1">
                {expiringSoon.length} loan{expiringSoon.length !== 1 ? 's' : ''} expiring within 30 days.
                Review and coordinate renewals or returns.
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
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {loans.filter(l => l.status === 'on_loan').length}
              </p>
              <p className="text-sm text-archive">Active Loans</p>
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
                {loans.filter(l => l.status === 'requested').length}
              </p>
              <p className="text-sm text-archive">Pending Approval</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <Download size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {loans.filter(l => l.status === 'approved').length}
              </p>
              <p className="text-sm text-archive">Awaiting Receipt</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-copper/10 rounded-lg flex items-center justify-center">
              <AlertTriangle size={20} className="text-copper" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {expiringSoon.length}
              </p>
              <p className="text-sm text-archive">Expiring Soon</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search Hero */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          {/* View Mode Toggle */}
          <div className="flex border border-lichen rounded-lg overflow-hidden shrink-0">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                viewMode === 'list'
                  ? 'bg-azurite text-parchment'
                  : 'bg-parchment text-ink hover:bg-stone'
              }`}
            >
              <List size={14} />
              List
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                viewMode === 'map'
                  ? 'bg-azurite text-parchment'
                  : 'bg-parchment text-ink hover:bg-stone'
              }`}
            >
              <Map size={14} />
              Network
            </button>
          </div>

          {viewMode === 'list' && (
            <>
              <div className="relative flex-1 w-full">
                <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
                <input
                  type="text"
                  placeholder="Search loans..."
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
                <option value="requested">Requested</option>
                <option value="approved">Approved</option>
                <option value="received">Received</option>
                <option value="on_loan">On Loan</option>
                <option value="returned">Returned</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                value={purposeFilter}
                onChange={(e) => { setPurposeFilter(e.target.value); setOffset(0); }}
                className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
              >
                <option value="">All Purposes</option>
                <option value="exhibition">Exhibition</option>
                <option value="research">Research</option>
                <option value="conservation">Conservation</option>
                <option value="long_term">Long-term</option>
                <option value="other">Other</option>
              </select>
            </>
          )}
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Map View */}
        {viewMode === 'map' && (
          <div className="p-4">
            {isLoadingNetwork ? (
              <div className="h-[500px] bg-stone rounded-lg flex items-center justify-center">
                <MadronaLoader variant="dots" />
              </div>
            ) : loanNetworkData?.contacts && loanNetworkData.contacts.length > 0 ? (
              <Suspense
                fallback={
                  <div className="h-[500px] bg-stone rounded-lg flex items-center justify-center">
                    <MadronaLoader variant="dots" />
                  </div>
                }
              >
                <LoanNetworkMap
                  contacts={loanNetworkData.contacts.filter(
                    (c) => c.latitude != null && c.longitude != null
                  )}
                  organizationCoordinates={
                    loanNetworkData.organization?.latitude
                      ? {
                          latitude: loanNetworkData.organization.latitude,
                          longitude: loanNetworkData.organization.longitude!,
                          name: loanNetworkData.organization.name ?? undefined,
                        }
                      : undefined
                  }
                  height={500}
                  showFlowLines={true}
                  onContactClick={(contact) => {
                    navigate(`/organizations/${orgId}/collections/contacts/${contact.contact_id}`);
                  }}
                />
              </Suspense>
            ) : (
              <div className="h-[500px] bg-stone/30 rounded-lg flex flex-col items-center justify-center text-archive">
                <Map size={40} className="mb-3 opacity-40" />
                <p className="text-sm font-medium">No loan network data available</p>
                <p className="text-xs mt-1">
                  Contacts with coordinates and loan relationships will appear here
                </p>
              </div>
            )}
            <p className="text-xs text-archive mt-3 text-center">
              This map shows your loan network - institutions you've borrowed from. Blue markers indicate lenders, with lines showing loan relationships.
            </p>
          </div>
        )}

        {/* Table */}
        {viewMode === 'list' && loans.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Loan Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Lender</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Purpose</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Dates</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Insurance Value</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {loans.map((loan) => (
                <LoanRow
                  key={loan.loan_in_id}
                  loan={loan}
                  onClick={() => handleLoanClick(loan.loan_in_id)}
                />
              ))}
            </tbody>
          </table>
        ) : viewMode === 'list' && isSearchNoResults ? (
          /* L13: Empty state - no search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">
              No loans match your search
            </h3>
            <p className="text-archive max-w-md mx-auto mb-6">
              We couldn't find any loans matching "{debouncedSearch || statusFilter || purposeFilter}". Try adjusting your search terms or clearing some filters.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={clearFilters} className="btn btn-secondary">
                <X size={16} className="mr-1.5" />
                Clear filters
              </button>
            </div>
          </div>
        ) : viewMode === 'list' && isFirstTimeEmpty ? (
          /* L14: Empty state - first time (no data) */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No incoming loans yet.</h3>
            <div className="flex items-center justify-center gap-4">
              <Link
                to={`/organizations/${orgId}/collections/loans-in/create`}
                className="btn btn-primary flex items-center gap-2"
              >
                <Plus size={18} />
                Create Incoming Loan
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {/* Pagination */}
      {data && data.total > LIMIT && viewMode === 'list' && (
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
