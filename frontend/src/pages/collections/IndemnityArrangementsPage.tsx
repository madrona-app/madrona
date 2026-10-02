import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Shield, Plus, Search, CheckCircle, Clock, AlertTriangle, FileText, X, Sparkles } from 'lucide-react';
import { getIndemnityArrangements } from '../../lib/api';
import { formatDateShort, formatCurrency as fmtCurrency, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const PROGRAM_LABELS: Record<string, string> = {
  us_arts: 'US Arts & Artifacts Indemnity',
  uk_gis: 'UK Government Indemnity Scheme',
  canada_special: 'Canada Special',
  eu_national: 'EU National',
  australia_indemnity: 'Australia Indemnity',
  other: 'Other',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  submitted: 'bg-semantic-warning/10 text-semantic-warning',
  under_review: 'bg-semantic-info/10 text-semantic-info',
  approved: 'bg-semantic-success/10 text-semantic-success',
  rejected: 'bg-semantic-error/10 text-semantic-error',
  active: 'bg-semantic-success/10 text-semantic-success',
  expired: 'bg-stone text-archive',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
  active: 'Active',
  expired: 'Expired',
};

const LIMIT = 25;
const SCROLL_KEY = 'indemnity-arrangements-scroll';

function IndemnityRow({ indemnity, orgId, formatCurrency }: { indemnity: any; orgId: string; formatCurrency: (amount: number, currency?: string) => string }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/insurance/indemnities/${indemnity.indemnity_id}`}
          className="text-bark hover:text-copper-dark font-medium"
        >
          {indemnity.internal_reference || indemnity.reference_number || indemnity.indemnity_id?.slice(0, 8)}
        </Link>
        <p className="text-xs text-archive mt-0.5">{PROGRAM_LABELS[indemnity.program] || indemnity.program}</p>
      </td>
      <td className="px-4 py-3 text-ink">
        {indemnity.reference_number || '\u2014'}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[indemnity.status] || 'bg-stone text-archive'}`}>
          {STATUS_LABELS[indemnity.status] || indemnity.status}
        </span>
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {indemnity.coverage_start_date ? formatDateShort(indemnity.coverage_start_date) : '\u2014'}
        {indemnity.coverage_end_date ? ` \u2013 ${formatDateShort(indemnity.coverage_end_date)}` : ''}
      </td>
      <td className="px-4 py-3 font-medium text-ink">
        {indemnity.requested_coverage ? formatCurrency(indemnity.requested_coverage, indemnity.coverage_currency) : '\u2014'}
      </td>
      <td className="px-4 py-3 font-medium text-ink">
        {indemnity.awarded_coverage ? formatCurrency(indemnity.awarded_coverage, indemnity.coverage_currency) : '\u2014'}
      </td>
    </tr>
  );
}

export default function IndemnityArrangementsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [programFilter, setProgramFilter] = useState<string>('');
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
    queryKey: ['indemnity-arrangements', orgId, debouncedSearch, statusFilter, programFilter],
    queryFn: () => getIndemnityArrangements(orgId!, {
      status: statusFilter || undefined,
      program: programFilter || undefined,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const showSkeleton = isLoading && !data;

  if (showSkeleton) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading\u2026" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Error loading indemnity arrangements: {(error as Error).message}
        </div>
      </div>
    );
  }

  const indemnities = data?.indemnities || [];

  // Filter by search query (client-side)
  const allFilteredIndemnities = indemnities.filter(indemnity => {
    if (!debouncedSearch) return true;
    const searchLower = debouncedSearch.toLowerCase();
    return (
      indemnity.reference_number?.toLowerCase().includes(searchLower) ||
      indemnity.internal_reference?.toLowerCase().includes(searchLower) ||
      indemnity.program_label?.toLowerCase().includes(searchLower)
    );
  });

  const filteredIndemnities = allFilteredIndemnities.slice(offset, offset + LIMIT);
  const hasActiveFilters = debouncedSearch || statusFilter || programFilter;

  // Stats
  const activeCount = indemnities.filter(i => i.status === 'active' || i.status === 'approved').length;
  const pendingCount = indemnities.filter(i => i.status === 'submitted' || i.status === 'under_review').length;
  const expiringCount = indemnities.filter(i => {
    if (!i.coverage_end_date || (i.status !== 'active' && i.status !== 'approved')) return false;
    const endDate = new Date(i.coverage_end_date);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return endDate <= thirtyDaysFromNow;
  }).length;
  const totalCoverage = indemnities
    .filter(i => i.status === 'active' || i.status === 'approved')
    .reduce((sum, i) => sum + (i.awarded_coverage || i.requested_coverage || 0), 0);

  const formatCurrency = (amount: number, currency = 'USD') => {
    return fmtCurrency(amount, currency, 0);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Shield size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Indemnity Arrangements</h1>
              <p className="text-sm text-archive mt-0.5">
                {indemnities.length === 0 ? <span>No arrangements yet</span>
                : indemnities.length === 1 ? <span>1 arrangement</span>
                : <span>{formatNumber(indemnities.length)} arrangements</span>}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/insurance/indemnities/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            New Arrangement
          </Link>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Manage government indemnity arrangements for exhibitions, loans, and special programs. Track applications, coverage amounts, and approval status.
        </p>
      </div>

      {/* Expiring Soon Alert */}
      {expiringCount > 0 && (
        <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="text-semantic-warning shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-medium text-ink">Arrangements Expiring Soon</p>
            <p className="text-sm text-archive">
              {expiringCount} {expiringCount === 1 ? 'arrangement is' : 'arrangements are'} expiring within the next 30 days.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{activeCount}</p>
              <p className="text-sm text-archive">Active / Approved</p>
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
              <p className="text-sm text-archive">Pending Review</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-info/10 rounded-lg flex items-center justify-center">
              <Shield size={20} className="text-semantic-info" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{formatCurrency(totalCoverage)}</p>
              <p className="text-sm text-archive">Total Coverage</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <FileText size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{indemnities.length}</p>
              <p className="text-sm text-archive">Total Arrangements</p>
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
              placeholder="Search arrangements..."
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
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
          </select>
          <select
            value={programFilter}
            onChange={(e) => { setProgramFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Programs</option>
            <option value="us_arts">US Arts & Artifacts</option>
            <option value="uk_gis">UK Government Indemnity</option>
            <option value="canada_special">Canada Special</option>
            <option value="eu_national">EU National</option>
            <option value="australia_indemnity">Australia Indemnity</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        <table className="w-full">
          <thead className="bg-stone/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Reference / Program</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Reference Number</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Coverage Dates</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Requested</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Awarded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-lichen">
            {filteredIndemnities.map((indemnity) => (
              <IndemnityRow key={indemnity.indemnity_id} indemnity={indemnity} orgId={orgId!} formatCurrency={formatCurrency} />
            ))}
          </tbody>
        </table>

        {filteredIndemnities.length === 0 && hasActiveFilters && (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No arrangements match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn't find any indemnity arrangements matching your filters. Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setProgramFilter(''); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        )}

        {filteredIndemnities.length === 0 && !hasActiveFilters && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No indemnity arrangements yet.</h3>
          </div>
        )}
      </div>

      {/* Pagination */}
      {allFilteredIndemnities.length > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">Showing {offset + 1} - {Math.min(offset + LIMIT, allFilteredIndemnities.length)} of {allFilteredIndemnities.length}</p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= allFilteredIndemnities.length} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
