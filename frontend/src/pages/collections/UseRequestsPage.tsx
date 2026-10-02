import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { FileQuestion, CheckCircle, Clock, Inbox, Search, X, Sparkles, Plus } from 'lucide-react';
import { getUseRequests } from '../../lib/api';
import type { UseRequest } from '../../lib/schemas';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { StartProcedure } from '../../components/studio/StartProcedure';

const STATUS_STYLES: Record<string, string> = {
  submitted: 'bg-semantic-info/10 text-semantic-info',
  under_review: 'bg-semantic-info/10 text-semantic-info',
  approved: 'bg-semantic-success/10 text-semantic-success',
  denied: 'bg-semantic-error/10 text-semantic-error',
  in_progress: 'bg-forest/10 text-forest',
  completed: 'bg-stone text-archive',
  cancelled: 'bg-stone text-archive',
  withdrawn: 'bg-stone text-archive',
};

const USE_TYPE_LABELS: Record<string, string> = {
  research: 'Research',
  exhibition: 'Exhibition',
  reproduction: 'Reproduction',
  education: 'Education',
  publication: 'Publication',
  broadcast: 'Broadcast',
  commercial: 'Commercial',
  conservation: 'Conservation',
  loan: 'Loan',
  digitization: 'Digitization',
  other: 'Other',
};

const SCROLL_KEY = 'use-requests-scroll';
const LIMIT = 25;

function RequestRow({ request, onClick }: { request: UseRequest; onClick: () => void }) {
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
          {request.request_number || request.request_id.slice(0, 8)}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="text-ink font-medium">{request.requester_name}</div>
        {request.requester_institution && (
          <div className="text-sm text-archive">{request.requester_institution}</div>
        )}
      </td>
      <td className="px-4 py-3 text-ink">
        {USE_TYPE_LABELS[request.use_type] || request.use_type}
      </td>
      <td className="px-4 py-3 text-accessible-gray max-w-xs truncate">
        {request.use_purpose || '\u2014'}
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {formatDateShort(request.request_date)}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[request.status] || 'bg-stone text-archive'}`}>
          {request.status.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </span>
      </td>
    </tr>
  );
}

export default function UseRequestsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // L10 — Scroll persistence
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) { sessionStorage.removeItem(SCROLL_KEY); requestAnimationFrame(() => { document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10)); }); }
  }, []);
  useEffect(() => { return () => { sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0))); }; }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['use-requests', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () => getUseRequests(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      use_type: typeFilter || undefined,
      limit: LIMIT,
      offset,
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
          Error loading use requests: {(error as Error).message}
        </div>
      </div>
    );
  }

  const requests = data?.items || [];

  // Stats
  const pendingReview = requests.filter(r =>
    r.status === 'submitted' || r.status === 'under_review'
  ).length;
  const approvedCount = requests.filter(r => r.status === 'approved').length;
  const inProgressCount = requests.filter(r => r.status === 'in_progress').length;
  const completedCount = requests.filter(r => r.status === 'completed').length;

  const handleRequestClick = (id: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/use-requests/${id}`);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* L02 — Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <FileQuestion size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Use of Collections</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No requests yet</span>
                  : data.total === 1 ? <span>1 request</span>
                  : <span>{formatNumber(data.total)} requests</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 sm:self-auto self-start">
            {/* Guided (Studio) entry point — deterministic use_reproduction plan. */}
            {hasPermission('collections.create') && (
              <StartProcedure navItem="use-requests" label="Start guided" />
            )}
            {hasPermission('collections.create') ? (
              <Link
                to={`/organizations/${orgId}/collections/use-requests/create`}
                className="btn btn-secondary flex items-center gap-2 no-underline"
              >
                <Plus size={18} />
                New Request
              </Link>
            ) : (
              <span className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed" title="Requires collections.create permission">
                <Plus size={18} />
                New Request
              </span>
            )}
          </div>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Records approved uses of collection objects or information beyond standard access. Includes research access, publication use, educational use, and other authorized purposes.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-info/10 rounded-lg flex items-center justify-center">
              <Inbox size={20} className="text-semantic-info" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{pendingReview}</p>
              <p className="text-sm text-archive">Pending Review</p>
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
              <Clock size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{inProgressCount}</p>
              <p className="text-sm text-archive">In Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{completedCount}</p>
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
              placeholder="Search requests..."
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
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Types</option>
            <option value="research">Research</option>
            <option value="exhibition">Exhibition</option>
            <option value="reproduction">Reproduction</option>
            <option value="education">Education</option>
            <option value="publication">Publication</option>
            <option value="broadcast">Broadcast</option>
            <option value="commercial">Commercial</option>
            <option value="loan">Loan</option>
            <option value="digitization">Digitization</option>
          </select>
        </div>
      </div>

      {/* L05 — Table wrapper with opacity transition */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {requests.length > 0 && (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Request Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Requester</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Purpose</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Request Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {requests.map((request) => (
                <RequestRow
                  key={request.request_id}
                  request={request}
                  onClick={() => handleRequestClick(request.request_id)}
                />
              ))}
            </tbody>
          </table>
        )}

        {/* L08 — Empty state: no search results */}
        {requests.length === 0 && (debouncedSearch || statusFilter || typeFilter) && (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No use requests match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn&apos;t find any requests matching &ldquo;{searchQuery || statusFilter || typeFilter}&rdquo;. Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setTypeFilter(''); setOffset(0); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        )}

        {/* L08 — Empty state: first time */}
        {requests.length === 0 && !debouncedSearch && !statusFilter && !typeFilter && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No use requests yet.</h3>
          </div>
        )}
      </div>

      {/* L09 — Pagination */}
      {data && data.total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}</p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
