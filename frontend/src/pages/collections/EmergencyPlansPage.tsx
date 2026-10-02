import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertTriangle, Shield, CheckCircle, Clock, FileText, Search, X, Sparkles, Plus } from 'lucide-react';
import { getEmergencyPlans } from '../../lib/api';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  approved: 'bg-semantic-success/10 text-semantic-success',
  active: 'bg-forest/10 text-forest',
  inactive: 'bg-stone text-archive',
};

const SCROLL_KEY = 'emergency-plans-scroll';
const LIMIT = 24;

function PlanRow({ plan, onClick }: { plan: any; onClick: () => void }) {
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
          {plan.title || plan.plan_number || plan.plan_id.slice(0, 8)}
        </span>
      </td>
      <td className="px-4 py-3 text-ink">
        {plan.facility_name || '—'}
      </td>
      <td className="px-4 py-3 text-archive">
        {plan.plan_version || '1.0'}
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {formatDateShort(plan.last_drill_date)}
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {formatDateShort(plan.next_review_date)}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[plan.status] || 'bg-stone text-archive'}`}>
          {plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
        </span>
      </td>
    </tr>
  );
}

export default function EmergencyPlansPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['emergency-plans', orgId, debouncedSearch, statusFilter, offset],
    queryFn: () => getEmergencyPlans(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const handlePlanClick = useCallback((planId: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/emergency-plans/${planId}`);
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
          Error loading emergency plans: {(error as Error).message}
        </div>
      </div>
    );
  }

  const plans = data?.items || [];
  const isSearchActive = !!(debouncedSearch || statusFilter);
  const isFirstTimeEmpty = !isSearchActive && plans.length === 0 && data?.total === 0;
  const isSearchNoResults = isSearchActive && plans.length === 0;

  // Stats
  const draftCount = plans.filter(p => p.status === 'draft').length;
  const approvedCount = plans.filter(p => p.status === 'approved').length;
  const activeCount = plans.filter(p => p.status === 'active').length;
  const inactiveCount = plans.filter(p => p.status === 'inactive').length;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <AlertTriangle size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Emergency Planning</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No plans yet</span>
                  : data.total === 1 ? <span>1 plan</span>
                  : <span>{formatNumber(data.total)} plans</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/emergency-plans/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              Create Plan
            </Link>
          ) : (
            <span
              className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start"
              title="Requires collections.create permission"
            >
              <Plus size={18} />
              Create Plan
            </span>
          )}
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Supports preparedness for emergencies affecting collections. Documents plans, priorities, and response actions for disasters and critical incidents.
        </p>
      </div>

      {/* Warning Banner */}
      <div className="bg-semantic-info/10 border border-semantic-info/30 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <Shield size={20} className="text-semantic-info mt-0.5" />
          <div>
            <h3 className="font-medium text-ink">Emergency Preparedness</h3>
            <p className="text-sm text-accessible-gray mt-1">
              Emergency plans should be reviewed regularly and drills conducted at least annually.
              Ensure all staff are familiar with evacuation procedures and salvage priorities.
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <FileText size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{draftCount}</p>
              <p className="text-sm text-archive">Draft</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{approvedCount}</p>
              <p className="text-sm text-archive">Approved</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <Shield size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{activeCount}</p>
              <p className="text-sm text-archive">Active</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{inactiveCount}</p>
              <p className="text-sm text-archive">Inactive</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar - Hero Element */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search plans by title, facility, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-12 pr-10 py-3 text-lg"
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
            className="px-3 py-3 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* First-time empty state */}
      {isFirstTimeEmpty && (
        <div className="text-center py-16">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
            <Sparkles size={40} className="text-bark" />
          </div>
          <h3 className="text-2xl font-serif font-medium text-forest mb-6">No emergency plans yet.</h3>
          <div className="flex items-center justify-center gap-4">
            <Link
              to={`/organizations/${orgId}/collections/emergency-plans/create`}
              className="btn btn-primary flex items-center gap-2"
            >
              <Shield size={18} />
              Create First Plan
            </Link>
          </div>
        </div>
      )}

      {/* Search no-results empty state */}
      {isSearchNoResults && (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
            <Search size={32} className="text-archive" />
          </div>
          <h3 className="text-xl font-serif font-medium text-forest mb-3">
            No plans match your search
          </h3>
          <p className="text-archive max-w-md mx-auto mb-6">
            We couldn't find any plans matching "{debouncedSearch}"{statusFilter ? ` with status "${statusFilter}"` : ''}. Try adjusting your search terms or clearing some filters.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setOffset(0); }} className="btn btn-secondary">
              <X size={16} className="mr-1.5" />
              Clear filters
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {plans.length > 0 && (
        <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Plan</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Facility</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Version</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Last Drill</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Next Review</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {plans.map((plan) => (
                <PlanRow
                  key={plan.plan_id}
                  plan={plan}
                  onClick={() => handlePlanClick(plan.plan_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
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
