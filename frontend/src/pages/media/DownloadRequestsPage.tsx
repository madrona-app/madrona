import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  Search,
  Filter,
  ChevronRight,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { listDownloadRequests } from '../../lib/api';
import {
  DownloadRequestStatusBadge,
  DOWNLOAD_REQUEST_STATUS_OPTIONS,
  DOWNLOAD_REQUEST_PURPOSE_LABELS,
} from '../../components/dam/DownloadRequestStatusBadge';
import type { MediaDownloadRequest } from '../../lib/schemas';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';

export default function DownloadRequestsPage() {
  const { orgId } = useParams<{ orgId: string }>();

  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['download-requests', orgId, statusFilter],
    queryFn: () =>
      listDownloadRequests(orgId!, {
        status: statusFilter.length > 0 ? statusFilter : undefined,
        limit: 100,
      }),
    enabled: !!orgId,
  });

  if (!orgId) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-md p-4 text-semantic-error">
          Organization ID is required
        </div>
      </div>
    );
  }

  const requests = (data?.items as MediaDownloadRequest[]) || [];
  const total = data?.total || 0;

  // Client-side filter by search query
  const filteredRequests = requests.filter((req) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      req.request_number.toLowerCase().includes(query) ||
      req.requester_name.toLowerCase().includes(query) ||
      req.requester_email.toLowerCase().includes(query) ||
      req.intended_use.toLowerCase().includes(query)
    );
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-forest/10 rounded-lg">
            <Download size={24} className="text-forest" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-900">Download Requests</h1>
            <p className="text-stone-500">Review and manage media download requests</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-parchment border border-stone-200 rounded-lg p-4">
        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by request number, requester, or use..."
              className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-stone-400" />
            <select
              value={statusFilter.join(',')}
              onChange={(e) =>
                setStatusFilter(e.target.value ? e.target.value.split(',') : [])
              }
              className="px-3 py-2 border border-stone-300 rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
            >
              <option value="">All Statuses</option>
              <option value="submitted,review">Pending Review</option>
              <option value="approved">Approved</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="denied,cancelled,expired">Closed</option>
              {DOWNLOAD_REQUEST_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Requests List */}
      <div className="bg-parchment border border-stone-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center"><MadronaLoader variant="dots" /></div>
        ) : error ? (
          <div className="p-4 text-semantic-error flex items-center gap-2">
            <AlertCircle size={16} />
            <span>Failed to load requests</span>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-8 text-center text-stone-500">
            {requests.length === 0
              ? 'No download requests yet'
              : 'No requests match your filters'}
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {/* Header Row */}
            <div className="px-4 py-3 bg-stone-50 grid grid-cols-12 gap-4 text-xs font-medium text-stone-500 uppercase tracking-wider">
              <div className="col-span-2">Request</div>
              <div className="col-span-3">Requester</div>
              <div className="col-span-2">Purpose</div>
              <div className="col-span-2">Items</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-1"></div>
            </div>

            {/* Request Rows */}
            {filteredRequests.map((req) => (
              <Link
                key={req.request_id}
                to={`/organizations/${orgId}/media/download-requests/${req.request_id}`}
                className="px-4 py-3 grid grid-cols-12 gap-4 items-center hover:bg-stone-50 transition-colors"
              >
                <div className="col-span-2">
                  <div className="text-sm font-medium text-stone-900">
                    {req.request_number}
                  </div>
                  <div className="text-xs text-stone-500 flex items-center gap-1">
                    <Clock size={10} />
                    {formatDateShort(req.created_at!)}
                  </div>
                </div>
                <div className="col-span-3">
                  <div className="text-sm text-stone-900">{req.requester_name}</div>
                  <div className="text-xs text-stone-500">{req.requester_email}</div>
                  {req.requester_institution && (
                    <div className="text-xs text-stone-400">{req.requester_institution}</div>
                  )}
                </div>
                <div className="col-span-2">
                  <span className="text-sm text-stone-700">
                    {DOWNLOAD_REQUEST_PURPOSE_LABELS[req.purpose] || req.purpose}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-sm text-stone-600">
                    {req.item_count || 0} item{(req.item_count || 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="col-span-2">
                  <DownloadRequestStatusBadge status={req.status} size="sm" />
                </div>
                <div className="col-span-1 flex justify-end">
                  <ChevronRight size={16} className="text-stone-400" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Footer */}
        {total > 0 && (
          <div className="px-4 py-3 border-t border-stone-200 bg-stone-50 text-sm text-stone-500">
            Showing {filteredRequests.length} of {total} requests
          </div>
        )}
      </div>
    </div>
  );
}
