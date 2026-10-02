import { useState, useCallback, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Upload, Building2, Calendar, AlertTriangle, Shield, DollarSign, CheckCircle, Plus, Search, Map, List, X, Sparkles } from 'lucide-react';
import { getLoansOut } from '../../lib/api';
import { formatDateShort, formatCurrency, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { useListState } from '../../hooks/useListState';
import { useGeo } from '../../hooks/useGeo';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

// Lazy load the map component
const LoanNetworkMap = lazy(() => import('../../components/maps/LoanNetworkMap'));

type ViewMode = 'list' | 'map';

const LIMIT = 24;

const STATUS_STYLES: Record<string, string> = {
  requested: 'bg-stone text-ink',
  approved: 'bg-semantic-info/10 text-semantic-info',
  dispatched: 'bg-bark/10 text-bark',
  on_loan: 'bg-semantic-success/10 text-semantic-success',
  returned: 'bg-stone text-ink',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
};

const PURPOSE_LABELS: Record<string, string> = {
  exhibition: 'Exhibition',
  research: 'Research',
  conservation: 'Conservation',
  education: 'Education',
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
        {loan.exhibition_title && (
          <p className="text-sm text-archive mt-0.5">{loan.exhibition_title}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-archive" />
          <div>
            <span className="text-ink">{loan.borrower_name || '—'}</span>
            {loan.venue_name && (
              <p className="text-xs text-archive">{loan.venue_name}</p>
            )}
          </div>
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
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-ink">
            {loan.insurance_value_total
              ? formatCurrency(loan.insurance_value_total, loan.insurance_currency || 'USD', 0)
              : '—'}
          </span>
          {loan.status === 'on_loan' && !loan.certificate_of_insurance_received && (
            <span title="Missing certificate">
              <Shield size={14} className="text-semantic-error" />
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[loan.status] || 'bg-stone text-ink'}`}>
          {loan.status.replace('_', ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </span>
      </td>
    </tr>
  );
}

export default function LoansOutPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const {
    searchQuery, debouncedQuery, offset,
    setSearchQuery, setOffset, getFilter, setFilter, clearAll,
  } = useListState({ limit: LIMIT });
  const statusFilter = getFilter('status');
  const purposeFilter = getFilter('purpose');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Fetch loan network data for map
  const { useLoanNetwork } = useGeo();
  const { data: loanNetworkData, isLoading: isLoadingNetwork } = useLoanNetwork(false, {
    enabled: viewMode === 'map',
  });

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['loans-out', orgId, debouncedQuery, statusFilter, purposeFilter, offset],
    queryFn: () => getLoansOut(orgId!, {
      q: debouncedQuery || undefined,
      status: statusFilter || undefined,
      loan_purpose: purposeFilter || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const handleLoanClick = useCallback((loanId: string) => {
    navigate(`/organizations/${orgId}/collections/loans-out/${loanId}`);
  }, [navigate, orgId]);

  const clearFilters = useCallback(() => {
    clearAll();
  }, [clearAll]);

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
  const hasActiveFilters = !!debouncedQuery || !!statusFilter || !!purposeFilter;
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

  // Find loans missing certificate of insurance
  const missingInsurance = loans.filter(loan =>
    loan.status === 'on_loan' && !loan.certificate_of_insurance_received
  );

  // Calculate total insurance value at risk
  const totalInsuranceValue = loans
    .filter(l => l.status === 'on_loan')
    .reduce((sum, l) => sum + (l.insurance_value_total || 0), 0);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Upload size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Loans Out</h1>
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
              to={`/organizations/${orgId}/collections/loans-out/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              New Outgoing Loan
            </Link>
          ) : (
            <span
              className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start"
              title="Requires collections.create permission"
            >
              <Plus size={18} />
              New Outgoing Loan
            </span>
          )}
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Documents objects lent by the institution to external borrowers. Tracks approvals, conditions, movements, insurance, and return obligations.
        </p>
      </div>

      {/* Alerts */}
      {expiringSoon.length > 0 && (
        <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-semantic-warning mt-0.5" />
            <div>
              <h3 className="font-medium text-ink">Loans Expiring Soon</h3>
              <p className="text-sm text-archive mt-1">
                {expiringSoon.length} loan{expiringSoon.length !== 1 ? 's' : ''} expiring within 30 days.
                Coordinate returns or renewals.
              </p>
            </div>
          </div>
        </div>
      )}
      {missingInsurance.length > 0 && (
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <Shield size={20} className="text-semantic-error mt-0.5" />
            <div>
              <h3 className="font-medium text-ink">Missing Insurance Certificates</h3>
              <p className="text-sm text-archive mt-1">
                {missingInsurance.length} active loan{missingInsurance.length !== 1 ? 's' : ''} without
                certificate of insurance on file.
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
              <p className="text-sm text-archive">Objects on Loan</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <Upload size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {loans.filter(l => l.status === 'approved').length}
              </p>
              <p className="text-sm text-archive">Pending Dispatch</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-bark/10 rounded-lg flex items-center justify-center">
              <Upload size={20} className="text-bark" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {loans.filter(l => l.status === 'in_transit' || l.status === 'on_loan').length}
              </p>
              <p className="text-sm text-archive">Awaiting Return</p>
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
                {formatCurrency(totalInsuranceValue, 'USD', 0)}
              </p>
              <p className="text-sm text-archive">Insurance Value</p>
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
                onChange={(e) => setFilter('status', e.target.value)}
                className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
              >
                <option value="">All Statuses</option>
                <option value="requested">Requested</option>
                <option value="approved">Approved</option>
                <option value="dispatched">Dispatched</option>
                <option value="on_loan">On Loan</option>
                <option value="returned">Returned</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                value={purposeFilter}
                onChange={(e) => setFilter('purpose', e.target.value)}
                className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
              >
                <option value="">All Purposes</option>
                <option value="exhibition">Exhibition</option>
                <option value="research">Research</option>
                <option value="conservation">Conservation</option>
                <option value="education">Education</option>
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
              This map shows your loan network - institutions you've lent to. Blue markers indicate borrowers, with lines showing loan relationships.
            </p>
          </div>
        )}

        {/* Table */}
        {viewMode === 'list' && loans.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Loan Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Borrower</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Purpose</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Dates</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Insurance</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {loans.map((loan) => (
                <LoanRow
                  key={loan.loan_out_id}
                  loan={loan}
                  onClick={() => handleLoanClick(loan.loan_out_id)}
                />
              ))}
            </tbody>
          </table>
        ) : viewMode === 'list' && isSearchNoResults ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">
              No loans match your search
            </h3>
            <p className="text-archive max-w-md mx-auto mb-6">
              We couldn't find any loans matching "{debouncedQuery || statusFilter || purposeFilter}". Try adjusting your search terms or clearing some filters.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={clearFilters} className="btn btn-secondary">
                <X size={16} className="mr-1.5" />
                Clear filters
              </button>
            </div>
          </div>
        ) : viewMode === 'list' && isFirstTimeEmpty ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No outgoing loans yet.</h3>
            <div className="flex items-center justify-center gap-4">
              <Link
                to={`/organizations/${orgId}/collections/loans-out/create`}
                className="btn btn-primary flex items-center gap-2"
              >
                <Plus size={18} />
                Create Outgoing Loan
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
