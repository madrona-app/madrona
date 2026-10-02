import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  Clock,
  AlertCircle,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import { listMyDownloadRequests } from '../../lib/api';
import {
  DownloadRequestStatusBadge,
  DOWNLOAD_REQUEST_PURPOSE_LABELS,
} from '../../components/dam/DownloadRequestStatusBadge';
import type { MediaDownloadRequest } from '../../lib/schemas';
import { formatDateShort } from '@/lib/formatters';

export default function MyDownloadRequestsPage() {
  const { orgId } = useParams<{ orgId: string }>();

  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['my-download-requests', orgId],
    queryFn: () =>
      listMyDownloadRequests(orgId!, {
        limit: 100,
      }),
    enabled: !!orgId,
  });

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  if (!orgId) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-md p-4 text-semantic-error">
          Organization ID is required
        </div>
      </div>
    );
  }

  const requests = (data?.items as MediaDownloadRequest[]) || [];

  // Group requests by status
  const pending = requests.filter((r) => ['submitted', 'review', 'approved'].includes(r.status));
  const fulfilled = requests.filter((r) => r.status === 'fulfilled');
  const closed = requests.filter((r) => ['denied', 'cancelled', 'expired'].includes(r.status));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-forest/10 rounded-lg">
          <Download size={24} className="text-forest" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-stone-900">My Download Requests</h1>
          <p className="text-stone-500">Track your media download requests</p>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-parchment border border-stone-200 rounded-lg p-8 text-center text-stone-500">
          Loading your requests...
        </div>
      ) : error ? (
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-md p-4 text-semantic-error flex items-center gap-2">
          <AlertCircle size={16} />
          <span>Failed to load requests</span>
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-parchment border border-stone-200 rounded-lg p-8 text-center">
          <Download size={32} className="mx-auto text-stone-300 mb-3" />
          <p className="text-stone-600 mb-2">No download requests yet</p>
          <p className="text-sm text-stone-500">
            Select images from a collection and click "Request Download" to get started.
          </p>
        </div>
      ) : (
        <>
          {/* Pending Requests */}
          {pending.length > 0 && (
            <RequestSection title="Pending" requests={pending} orgId={orgId} />
          )}

          {/* Ready to Download */}
          {fulfilled.length > 0 && (
            <div className="bg-parchment border border-stone-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-stone-200 bg-semantic-success/10">
                <h2 className="font-medium text-semantic-success">Ready to Download</h2>
              </div>
              <div className="divide-y divide-stone-100">
                {fulfilled.map((req) => (
                  <FulfilledRequestRow
                    key={req.request_id}
                    request={req}
                    orgId={orgId}
                    copiedToken={copiedToken}
                    onCopyToken={handleCopyToken}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Closed Requests */}
          {closed.length > 0 && (
            <RequestSection title="Closed" requests={closed} orgId={orgId} />
          )}
        </>
      )}
    </div>
  );
}

interface RequestSectionProps {
  title: string;
  requests: MediaDownloadRequest[];
  orgId: string;
}

function RequestSection({ title, requests, orgId }: RequestSectionProps) {
  return (
    <div className="bg-parchment border border-stone-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-200 bg-stone-50">
        <h2 className="font-medium text-stone-900">{title}</h2>
      </div>
      <div className="divide-y divide-stone-100">
        {requests.map((req) => (
          <Link
            key={req.request_id}
            to={`/organizations/${orgId}/media/download-requests/${req.request_id}`}
            className="px-4 py-3 flex items-center justify-between hover:bg-stone-50 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div>
                <div className="text-sm font-medium text-stone-900">
                  {req.request_number}
                </div>
                <div className="text-xs text-stone-500 flex items-center gap-1">
                  <Clock size={10} />
                  {formatDateShort(req.created_at!)}
                </div>
              </div>
              <div className="text-sm text-stone-600">
                {req.item_count || 0} item{(req.item_count || 0) !== 1 ? 's' : ''}
              </div>
              <span className="text-sm text-stone-500">
                {DOWNLOAD_REQUEST_PURPOSE_LABELS[req.purpose] || req.purpose}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <DownloadRequestStatusBadge status={req.status} size="sm" />
              <ChevronRight size={16} className="text-stone-400" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

interface FulfilledRequestRowProps {
  request: MediaDownloadRequest;
  orgId: string;
  copiedToken: string | null;
  onCopyToken: (token: string) => void;
}

function FulfilledRequestRow({
  request,
  orgId,
  copiedToken,
  onCopyToken,
}: FulfilledRequestRowProps) {
  const isExpired =
    request.download_expires_at && new Date(request.download_expires_at) < new Date();

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-sm font-medium text-stone-900">
              {request.request_number}
            </div>
            <div className="text-xs text-stone-500">
              {request.item_count || 0} item{(request.item_count || 0) !== 1 ? 's' : ''}
            </div>
          </div>
          <DownloadRequestStatusBadge status={request.status} size="sm" />
        </div>
        <Link
          to={`/organizations/${orgId}/media/download-requests/${request.request_id}`}
          className="text-sm text-semantic-info hover:text-semantic-info flex items-center gap-1"
        >
          View Details
          <ExternalLink size={12} />
        </Link>
      </div>

      {isExpired ? (
        <div className="text-sm text-stone-500 bg-stone-100 rounded px-3 py-2">
          Download link expired on{' '}
          {formatDateShort(request.download_expires_at!)}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {request.download_token && (
            <button
              onClick={() => onCopyToken(request.download_token!)}
              className="flex items-center gap-2 px-3 py-2 bg-stone-100 rounded text-sm text-stone-600 hover:bg-stone-200 transition-colors"
            >
              {copiedToken === request.download_token ? (
                <>
                  <Check size={14} className="text-semantic-success" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy Token
                </>
              )}
            </button>
          )}
          <Link
            to={`/organizations/${orgId}/media/download-requests/${request.request_id}?download=true`}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-forest text-parchment rounded text-sm hover:bg-forest/90 transition-colors"
          >
            <Download size={16} />
            Download Files
          </Link>
          {request.download_expires_at && (
            <span className="text-xs text-stone-500">
              Expires {formatDateShort(request.download_expires_at)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
