import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { FileText, ClipboardCheck, Clock, CheckCircle, Plus, AlertCircle, Search, X } from 'lucide-react';
import { getDocumentationPlans } from '../../lib/api';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const LIMIT = 25;
const SCROLL_KEY = 'documentation-plans-scroll';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  approved: 'bg-semantic-info/10 text-semantic-info',
  in_progress: 'bg-semantic-warning/10 text-semantic-warning',
  completed: 'bg-semantic-success/10 text-semantic-success',
  cancelled: 'bg-semantic-error/10 text-semantic-error',
};

const TYPE_LABELS: Record<string, string> = {
  documentation_policy: 'Documentation Policy',
  cataloging_plan: 'Cataloging Plan',
  photography_plan: 'Photography Plan',
  digitisation_plan: 'Digitisation Plan',
  inventory_plan: 'Inventory Plan',
  backlog_plan: 'Backlog Plan',
  other: 'Other',
};

function PlanRow({ plan, orgId }: { plan: any; orgId: string }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/documentation-plans/${plan.plan_id}`}
          className="text-bark hover:text-copper-dark font-medium"
        >
          {plan.plan_number || '\u2014'}
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/documentation-plans/${plan.plan_id}`}
          className="text-ink hover:text-bark"
        >
          {plan.title}
        </Link>
      </td>
      <td className="px-4 py-3 text-ink">
        {TYPE_LABELS[plan.plan_type] || plan.plan_type}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[plan.status] || 'bg-stone text-archive'}`}>
          {plan.status.replace('_', ' ').charAt(0).toUpperCase() + plan.status.replace('_', ' ').slice(1)}
        </span>
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {formatDateShort(plan.start_date)}
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {formatDateShort(plan.end_date)}
      </td>
      <td className="px-4 py-3">
        {plan.next_review_date ? (
          <span className={`text-sm ${new Date(plan.next_review_date) < new Date() ? 'text-semantic-error' : 'text-accessible-gray'}`}>
            {formatDateShort(plan.next_review_date)}
            {new Date(plan.next_review_date) < new Date() && (
              <AlertCircle size={14} className="inline ml-1" />
            )}
          </span>
        ) : (
          '\u2014'
        )}
      </td>
    </tr>
  );
}

export default function DocumentationPlansPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, statusFilter, typeFilter]);

  // L10 — Scroll restore
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['documentation-plans', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () => getDocumentationPlans(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      plan_type: typeFilter || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const plans = data?.items || [];
  const total = data?.total ?? 0;
  const currentPage = Math.floor(offset / LIMIT) + 1;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const handlePreviousPage = useCallback(() => {
    setOffset((prev) => Math.max(0, prev - LIMIT));
  }, []);

  const handleNextPage = useCallback(() => {
    setOffset((prev) => prev + LIMIT);
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
          Error loading documentation plans: {(error as Error).message}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* L02 — Header card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <FileText size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Documentation Plans</h1>
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
          <Link
            to={`/organizations/${orgId}/collections/documentation-plans/create`}
            className="btn btn-primary inline-flex items-center gap-2 no-underline shrink-0"
          >
            <Plus size={16} />
            Create Plan
          </Link>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Documentation Planning. Manage cataloging, photography, digitisation, and inventory plans for your collections.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <FileText size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{plans.filter(p => p.status === 'draft').length}</p>
              <p className="text-sm text-archive">Draft</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-info/10 rounded-lg flex items-center justify-center">
              <ClipboardCheck size={20} className="text-semantic-info" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{plans.filter(p => p.status === 'approved').length}</p>
              <p className="text-sm text-archive">Approved</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{plans.filter(p => p.status === 'in_progress').length}</p>
              <p className="text-sm text-archive">In Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{plans.filter(p => p.status === 'completed').length}</p>
              <p className="text-sm text-archive">Completed</p>
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
              placeholder="Search plans..."
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
            <option value="approved">Approved</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* L05 — Plans Table */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        <table className="w-full">
          <thead className="bg-stone/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Plan Number</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Title</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Start Date</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">End Date</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Next Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-lichen">
            {plans.map((plan) => (
              <PlanRow key={plan.plan_id} plan={plan} orgId={orgId!} />
            ))}
          </tbody>
        </table>

        {plans.length === 0 && (
          <div className="text-center py-12">
            <FileText size={48} className="mx-auto text-archive mb-4" />
            <h3 className="text-lg font-serif font-medium text-forest mb-2">No documentation plans found</h3>
            <p className="text-accessible-gray mb-4">
              Create your first documentation plan to meet UK Accreditation requirements.
            </p>
            <Link
              to={`/organizations/${orgId}/collections/documentation-plans/create`}
              className="btn btn-primary inline-flex items-center gap-2 no-underline"
            >
              Create Plan
            </Link>
          </div>
        )}
      </div>

      {/* L09 — Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-archive">
            Showing {offset + 1}&ndash;{Math.min(offset + LIMIT, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreviousPage}
              disabled={offset === 0}
              className="px-3 py-1.5 text-sm border border-lichen rounded-lg hover:bg-stone disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-archive">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={handleNextPage}
              disabled={offset + LIMIT >= total}
              className="px-3 py-1.5 text-sm border border-lichen rounded-lg hover:bg-stone disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
