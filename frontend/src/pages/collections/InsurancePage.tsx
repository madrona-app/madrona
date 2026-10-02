import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Shield, Plus, Search, CheckCircle, Clock, AlertTriangle, FileText, X, Sparkles } from 'lucide-react';
import { getInsurancePolicies } from '../../lib/api';
import { formatDateShort, formatCurrency as fmtCurrency, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const POLICY_TYPE_LABELS: Record<string, string> = {
  blanket: 'Blanket Coverage',
  fine_arts: 'Fine Arts',
  marine: 'Marine',
  exhibition: 'Exhibition',
  all_risk: 'All Risk',
  named_perils: 'Named Perils',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  pending_approval: 'bg-semantic-warning/10 text-semantic-warning',
  active: 'bg-semantic-success/10 text-semantic-success',
  expired: 'bg-stone text-archive',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
  renewed: 'bg-semantic-info/10 text-semantic-info',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  active: 'Active',
  expired: 'Expired',
  cancelled: 'Cancelled',
  renewed: 'Renewed',
};

const LIMIT = 25;
const SCROLL_KEY = 'insurance-scroll';

function PolicyRow({ policy, orgId, formatCurrency }: { policy: any; orgId: string; formatCurrency: (amount: number, currency?: string) => string }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/insurance/policies/${policy.policy_id}`}
          className="text-bark hover:text-copper-dark font-medium"
        >
          {policy.policy_number}
        </Link>
        {policy.policy_name && (
          <p className="text-xs text-archive mt-0.5">{policy.policy_name}</p>
        )}
      </td>
      <td className="px-4 py-3 text-ink">
        {policy.provider_name}
      </td>
      <td className="px-4 py-3 text-ink">
        {POLICY_TYPE_LABELS[policy.policy_type] || policy.policy_type}
      </td>
      <td className="px-4 py-3 font-medium text-ink">
        {policy.coverage_limit ? formatCurrency(policy.coverage_limit, policy.coverage_limit_currency) : '\u2014'}
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {formatDateShort(policy.expiration_date)}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[policy.status] || 'bg-stone text-archive'}`}>
          {STATUS_LABELS[policy.status] || policy.status}
        </span>
      </td>
    </tr>
  );
}

export default function InsurancePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
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
    queryKey: ['insurance-policies', orgId, debouncedSearch, statusFilter, typeFilter],
    queryFn: () => getInsurancePolicies(orgId!, {
      status: statusFilter || undefined,
      policy_type: typeFilter || undefined,
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
          Error loading insurance policies: {(error as Error).message}
        </div>
      </div>
    );
  }

  const policies = data?.items || [];

  // Filter by search query (client-side since API doesn't support it yet)
  const allFilteredPolicies = policies.filter(policy => {
    if (!debouncedSearch) return true;
    const searchLower = debouncedSearch.toLowerCase();
    return (
      policy.policy_number?.toLowerCase().includes(searchLower) ||
      policy.policy_name?.toLowerCase().includes(searchLower) ||
      policy.provider_name?.toLowerCase().includes(searchLower)
    );
  });

  const filteredPolicies = allFilteredPolicies.slice(offset, offset + LIMIT);
  const hasActiveFilters = debouncedSearch || statusFilter || typeFilter;

  // Stats
  const activeCount = policies.filter(p => p.status === 'active').length;
  const pendingCount = policies.filter(p => p.status === 'pending_approval').length;
  const expiringCount = policies.filter(p => {
    if (!p.expiration_date || p.status !== 'active') return false;
    const expDate = new Date(p.expiration_date);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return expDate <= thirtyDaysFromNow;
  }).length;
  const totalCoverage = policies
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + (p.coverage_limit || 0), 0);

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
              <h1 className="text-2xl font-semibold text-ink">Insurance</h1>
              <p className="text-sm text-archive mt-0.5">
                {policies.length === 0 ? <span>No policies yet</span>
                : policies.length === 1 ? <span>1 policy</span>
                : <span>{formatNumber(policies.length)} policies</span>}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/insurance/policies/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            New Policy
          </Link>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Manage insurance policies and coverage for collection objects, loans, exhibitions, and shipments. Track certificates of insurance, indemnity arrangements, and claims.
        </p>
      </div>

      {/* Expiring Soon Alert */}
      {expiringCount > 0 && (
        <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="text-semantic-warning shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-medium text-ink">Policies Expiring Soon</p>
            <p className="text-sm text-archive">
              {expiringCount} {expiringCount === 1 ? 'policy is' : 'policies are'} expiring within the next 30 days.
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
              <p className="text-sm text-archive">Active Policies</p>
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
              <p className="text-sm text-archive">Pending Approval</p>
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
              <p className="text-2xl font-semibold text-ink">{policies.length}</p>
              <p className="text-sm text-archive">Total Policies</p>
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
              placeholder="Search policies..."
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
            <option value="pending_approval">Pending Approval</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
            <option value="renewed">Renewed</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Types</option>
            <option value="blanket">Blanket Coverage</option>
            <option value="fine_arts">Fine Arts</option>
            <option value="marine">Marine</option>
            <option value="exhibition">Exhibition</option>
            <option value="all_risk">All Risk</option>
            <option value="named_perils">Named Perils</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        <table className="w-full">
          <thead className="bg-stone/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Policy Number</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Provider</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Coverage Limit</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Expiration</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-lichen">
            {filteredPolicies.map((policy) => (
              <PolicyRow key={policy.policy_id} policy={policy} orgId={orgId!} formatCurrency={formatCurrency} />
            ))}
          </tbody>
        </table>

        {filteredPolicies.length === 0 && hasActiveFilters && (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No insurance records match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn't find any insurance records matching "{searchQuery}". Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setTypeFilter(''); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        )}

        {filteredPolicies.length === 0 && !hasActiveFilters && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No insurance records yet.</h3>
          </div>
        )}
      </div>

      {/* Pagination */}
      {allFilteredPolicies.length > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">Showing {offset + 1} - {Math.min(offset + LIMIT, allFilteredPolicies.length)} of {allFilteredPolicies.length}</p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= allFilteredPolicies.length} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
