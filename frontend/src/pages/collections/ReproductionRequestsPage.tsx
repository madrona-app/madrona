import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Copy, Camera, FileCheck, Clock, CheckCircle, Plus, Search, X, Sparkles } from 'lucide-react';
import { getReproductionRequests } from '../../lib/api';
import type { ReproductionRequest } from '../../lib/schemas';
import { formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const REPRODUCTION_TYPE_LABELS: Record<string, string> = {
  photograph: 'Photograph',
  scan: 'Scan',
  cast: 'Cast/Mold',
  '3d_print': '3D Print',
  digital_copy: 'Digital Copy',
  film: 'Film',
  video: 'Video',
  other: 'Other',
};

const STATUS_STYLES: Record<string, string> = {
  submitted: 'bg-stone text-archive',
  rights_review: 'bg-semantic-warning/10 text-semantic-warning',
  approved: 'bg-semantic-success/10 text-semantic-success',
  denied: 'bg-semantic-error/10 text-semantic-error',
  in_production: 'bg-semantic-info/10 text-semantic-info',
  delivered: 'bg-forest/10 text-forest',
  completed: 'bg-semantic-success/10 text-semantic-success',
  cancelled: 'bg-stone text-archive',
};

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  rights_review: 'Rights Review',
  approved: 'Approved',
  denied: 'Denied',
  in_production: 'In Production',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const SCROLL_KEY = 'reproduction-requests-scroll';
const LIMIT = 25;

function ReproductionRow({ request, onClick }: { request: ReproductionRequest; onClick: () => void }) {
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
          {request.request_number}
        </span>
      </td>
      <td className="px-4 py-3 text-ink">
        <div>{request.requester_name}</div>
        {request.requester_institution && (
          <div className="text-xs text-accessible-gray">{request.requester_institution}</div>
        )}
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {request.object_number || request.object_title || request.object_id?.slice(0, 8) || '\u2014'}
      </td>
      <td className="px-4 py-3 text-ink">
        {REPRODUCTION_TYPE_LABELS[request.reproduction_type] || request.reproduction_type}
      </td>
      <td className="px-4 py-3">
        {request.rights_cleared ? (
          <span className="inline-flex items-center gap-1 text-semantic-success text-sm">
            <CheckCircle size={14} /> Cleared
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-semantic-warning text-sm">
            <Clock size={14} /> Pending
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[request.status] || 'bg-stone text-archive'}`}>
          {STATUS_LABELS[request.status] || request.status}
        </span>
      </td>
    </tr>
  );
}

export default function ReproductionRequestsPage() {
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
    queryKey: ['reproduction-requests', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () => getReproductionRequests(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      reproduction_type: typeFilter || undefined,
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
          Error loading reproduction requests: {(error as Error).message}
        </div>
      </div>
    );
  }

  const requests = data?.items || [];

  // Stats
  const submittedCount = requests.filter(r => r.status === 'submitted').length;
  const pendingRightsCount = requests.filter(r => r.status === 'rights_review').length;
  const inProductionCount = requests.filter(r => r.status === 'in_production').length;
  const completedCount = requests.filter(r => r.status === 'completed' || r.status === 'delivered').length;

  const handleRequestClick = (id: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/reproduction-requests/${id}`);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Copy size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Reproduction</h1>
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
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/reproduction-requests/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              New Request
            </Link>
          ) : (
            <span className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start" title="Requires collections.create permission">
              <Plus size={18} />
              New Request
            </span>
          )}
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Manages the creation and delivery of reproductions of collection objects. Includes photography, digitization, and fulfillment of reproduction requests.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{submittedCount}</p>
              <p className="text-sm text-archive">Submitted</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <FileCheck size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{pendingRightsCount}</p>
              <p className="text-sm text-archive">Rights Review</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-info/10 rounded-lg flex items-center justify-center">
              <Camera size={20} className="text-semantic-info" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{inProductionCount}</p>
              <p className="text-sm text-archive">In Production</p>
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
            <option value="rights_review">Rights Review</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="in_production">In Production</option>
            <option value="delivered">Delivered</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Types</option>
            <option value="photograph">Photograph</option>
            <option value="scan">Scan</option>
            <option value="cast">Cast/Mold</option>
            <option value="3d_print">3D Print</option>
            <option value="digital_copy">Digital Copy</option>
            <option value="film">Film</option>
            <option value="video">Video</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Table — L05: opacity transition */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {requests.length > 0 && (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Request #</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Requester</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Object</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Rights</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {requests.map((request) => (
                <ReproductionRow
                  key={request.reproduction_id}
                  request={request}
                  onClick={() => handleRequestClick(request.reproduction_id)}
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
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No reproduction requests match your search</h3>
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
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No reproduction requests yet.</h3>
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
