import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  Clock,
  User,
  Building,
  FileText,
  CheckCircle,
  XCircle,
  AlertCircle,
  Copy,
  Check,
  Image as ImageIcon,
} from 'lucide-react';
import {
  getDownloadRequest,
  approveDownloadRequest,
  denyDownloadRequest,
  fulfillDownloadRequest,
  cancelDownloadRequest,
  getDownloadRequestLinks,
} from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import {
  DownloadRequestStatusBadge,
  DOWNLOAD_REQUEST_PURPOSE_LABELS,
  DERIVATIVE_TYPE_LABELS,
} from '../../components/dam/DownloadRequestStatusBadge';
import type { MediaDownloadRequest, MediaDownloadRequestItem } from '../../lib/schemas';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateTime, formatDateShort } from '@/lib/formatters';

export default function DownloadRequestWorkspacePage() {
  const { orgId, requestId } = useParams<{ orgId: string; requestId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [denialReason, setDenialReason] = useState('');
  const [conditions, setConditions] = useState('');
  const [expiresDays, setExpiresDays] = useState(7);
  const [showDenyModal, setShowDenyModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showFulfillModal, setShowFulfillModal] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const { showToast } = useToast();

  const { data: request, isLoading, error } = useQuery({
    queryKey: ['download-request', orgId, requestId],
    queryFn: () => getDownloadRequest(orgId!, requestId!) as Promise<MediaDownloadRequest>,
    enabled: !!orgId && !!requestId,
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      approveDownloadRequest(orgId!, requestId!, { conditions: conditions || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['download-request', orgId, requestId] });
      setShowApproveModal(false);
      setConditions('');
      showToast({ type: 'success', title: 'Request approved' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Failed to approve request', message: err.message });
    },
  });

  const denyMutation = useMutation({
    mutationFn: () => denyDownloadRequest(orgId!, requestId!, denialReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['download-request', orgId, requestId] });
      setShowDenyModal(false);
      setDenialReason('');
      showToast({ type: 'success', title: 'Request denied' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Failed to deny request', message: err.message });
    },
  });

  const fulfillMutation = useMutation({
    mutationFn: () =>
      fulfillDownloadRequest(orgId!, requestId!, { expires_days: expiresDays }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['download-request', orgId, requestId] });
      setShowFulfillModal(false);
      showToast({ type: 'success', title: 'Download links generated' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Failed to fulfill request', message: err.message });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelDownloadRequest(orgId!, requestId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['download-request', orgId, requestId] });
      showToast({ type: 'success', title: 'Request cancelled' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Failed to cancel request', message: err.message });
    },
  });

  const handleCopyToken = () => {
    if (request?.download_token) {
      navigator.clipboard.writeText(request.download_token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  if (!orgId || !requestId) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-md p-4 text-semantic-error">
          Organization ID and Request ID are required
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-md p-4 text-semantic-error flex items-center gap-2">
          <AlertCircle size={16} />
          <span>Failed to load request</span>
        </div>
      </div>
    );
  }

  const canApprove = ['submitted', 'review'].includes(request.status);
  const canFulfill = request.status === 'approved';
  const canCancel = ['submitted', 'review'].includes(request.status);
  const isDownloadable = request.status === 'fulfilled' && request.download_token;
  const isExpired =
    request.download_expires_at && new Date(request.download_expires_at) < new Date();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-stone-100 rounded-md transition-colors"
          >
            <ArrowLeft size={20} className="text-stone-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-stone-900">{request.request_number}</h1>
              <DownloadRequestStatusBadge status={request.status} />
            </div>
            <p className="text-stone-500 flex items-center gap-2">
              <Clock size={14} />
              Submitted {formatDateTime(request.created_at!)}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {canCancel && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={cancelMutation.isPending}
              className="px-3 py-2 border border-stone-300 text-stone-700 rounded-md text-sm hover:bg-stone-50 transition-colors"
            >
              Cancel Request
            </button>
          )}
          {canApprove && (
            <>
              <button
                onClick={() => setShowDenyModal(true)}
                className="px-3 py-2 border border-semantic-error/30 text-semantic-error rounded-md text-sm hover:bg-semantic-error/20 flex items-center gap-1 transition-colors"
              >
                <XCircle size={14} />
                Deny
              </button>
              <button
                onClick={() => setShowApproveModal(true)}
                className="px-3 py-2 bg-semantic-success text-parchment rounded-md text-sm hover:bg-semantic-success/20 flex items-center gap-1 transition-colors"
              >
                <CheckCircle size={14} />
                Approve
              </button>
            </>
          )}
          {canFulfill && (
            <button
              onClick={() => setShowFulfillModal(true)}
              className="px-3 py-2 bg-forest text-parchment rounded-md text-sm hover:bg-forest/90 flex items-center gap-1 transition-colors"
            >
              <Download size={14} />
              Fulfill Request
            </button>
          )}
        </div>
      </div>

      {/* Download Section (for fulfilled requests) */}
      {isDownloadable && !isExpired && (
        <div className="bg-semantic-success/10 border border-semantic-success/30 rounded-lg p-4">
          <h3 className="font-medium text-semantic-success mb-2">Downloads Ready</h3>
          <p className="text-sm text-semantic-success mb-3">
            Expires {formatDateShort(request.download_expires_at!)}
            {request.max_downloads && ` • ${request.download_count}/${request.max_downloads} downloads used`}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyToken}
              className="px-3 py-2 bg-parchment border border-semantic-success/30 text-semantic-success rounded-md text-sm hover:bg-semantic-success/10 flex items-center gap-2 transition-colors"
            >
              {copiedToken ? (
                <>
                  <Check size={14} />
                  Copied!
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy Token
                </>
              )}
            </button>
            <DownloadLinksSection
              orgId={orgId}
              requestId={requestId}
              token={request.download_token!}
            />
          </div>
        </div>
      )}

      {isExpired && (
        <div className="bg-stone-100 border border-stone-200 rounded-lg p-4">
          <p className="text-sm text-stone-600">
            Download link expired on {formatDateShort(request.download_expires_at!)}
          </p>
        </div>
      )}

      {/* Request Details */}
      <div className="bg-parchment border border-stone-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 bg-stone-50">
          <h2 className="font-medium text-stone-900">Request Details</h2>
        </div>
        <div className="p-4 grid grid-cols-2 gap-6">
          {/* Requester Info */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <User size={16} className="text-stone-400 mt-0.5" />
              <div>
                <div className="text-xs text-stone-500">Requester</div>
                <div className="text-sm text-stone-900">{request.requester_name}</div>
                <div className="text-sm text-stone-600">{request.requester_email}</div>
              </div>
            </div>
            {request.requester_institution && (
              <div className="flex items-start gap-3">
                <Building size={16} className="text-stone-400 mt-0.5" />
                <div>
                  <div className="text-xs text-stone-500">Institution</div>
                  <div className="text-sm text-stone-900">{request.requester_institution}</div>
                </div>
              </div>
            )}
          </div>

          {/* Request Info */}
          <div className="space-y-4">
            <div>
              <div className="text-xs text-stone-500">Purpose</div>
              <div className="text-sm text-stone-900">
                {DOWNLOAD_REQUEST_PURPOSE_LABELS[request.purpose] || request.purpose}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-500">File Type</div>
              <div className="text-sm text-stone-900">
                {DERIVATIVE_TYPE_LABELS[request.derivative_type_requested] ||
                  request.derivative_type_requested}
              </div>
            </div>
          </div>
        </div>

        {/* Intended Use */}
        <div className="px-4 pb-4">
          <div className="flex items-start gap-3 bg-stone-50 rounded-lg p-3">
            <FileText size={16} className="text-stone-400 mt-0.5" />
            <div>
              <div className="text-xs text-stone-500 mb-1">Intended Use</div>
              <div className="text-sm text-stone-900 whitespace-pre-wrap">
                {request.intended_use}
              </div>
              {request.project_description && (
                <div className="mt-2 text-sm text-stone-600">
                  <span className="text-stone-500">Project:</span> {request.project_description}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Approval/Denial Info */}
        {(request.approval_conditions || request.denial_reason) && (
          <div className="px-4 pb-4 border-t border-stone-100 pt-4">
            {request.approval_conditions && (
              <div className="bg-semantic-success/10 rounded-lg p-3">
                <div className="text-xs text-semantic-success mb-1">Approval Conditions</div>
                <div className="text-sm text-semantic-success">{request.approval_conditions}</div>
              </div>
            )}
            {request.denial_reason && (
              <div className="bg-semantic-error/10 rounded-lg p-3">
                <div className="text-xs text-semantic-error mb-1">Denial Reason</div>
                <div className="text-sm text-semantic-error">{request.denial_reason}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="bg-parchment border border-stone-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <h2 className="font-medium text-stone-900">Requested Items</h2>
          <span className="text-sm text-stone-500">{request.items?.length || 0} items</span>
        </div>
        <div className="divide-y divide-stone-100">
          {request.items?.map((item: MediaDownloadRequestItem) => (
            <div key={item.item_id} className="px-4 py-3 flex items-center gap-4">
              <ImageIcon size={16} className="text-stone-400" />
              <div className="flex-1">
                <div className="text-sm text-stone-900">
                  {item.media?.title || item.media?.filename || item.media_id}
                </div>
                {item.media && (
                  <div className="text-xs text-stone-500">
                    {item.media.media_type} • {(item.media.file_size / 1024 / 1024).toFixed(1)} MB
                  </div>
                )}
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  item.item_status === 'approved'
                    ? 'bg-semantic-success/10 text-semantic-success'
                    : item.item_status === 'denied'
                      ? 'bg-semantic-error/10 text-semantic-error'
                      : 'bg-stone-100 text-stone-600'
                }`}
              >
                {item.item_status}
              </span>
              {item.downloaded && (
                <span className="text-xs text-stone-500 flex items-center gap-1">
                  <Download size={10} />
                  Downloaded
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Deny Modal */}
      {showDenyModal && (
        <Modal onClose={() => setShowDenyModal(false)}>
          <h3 className="text-lg font-semibold text-stone-900 mb-4">Deny Request</h3>
          <div className="mb-4">
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Reason for Denial <span className="text-semantic-error">*</span>
            </label>
            <textarea
              value={denialReason}
              onChange={(e) => setDenialReason(e.target.value)}
              placeholder="Explain why this request cannot be approved..."
              className="w-full px-3 py-2 border border-stone-300 rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowDenyModal(false)}
              className="px-4 py-2 border border-stone-300 rounded-md text-sm text-stone-700 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              onClick={() => denyMutation.mutate()}
              disabled={!denialReason.trim() || denyMutation.isPending}
              className="px-4 py-2 bg-semantic-error text-parchment rounded-md text-sm hover:bg-semantic-error/20 disabled:opacity-50"
            >
              {denyMutation.isPending ? 'Denying...' : 'Deny Request'}
            </button>
          </div>
        </Modal>
      )}

      {/* Approve Modal */}
      {showApproveModal && (
        <Modal onClose={() => setShowApproveModal(false)}>
          <h3 className="text-lg font-semibold text-stone-900 mb-4">Approve Request</h3>
          <div className="mb-4">
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Conditions (Optional)
            </label>
            <textarea
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              placeholder="e.g., Credit required in publication, low-res only for web..."
              className="w-full px-3 py-2 border border-stone-300 rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowApproveModal(false)}
              className="px-4 py-2 border border-stone-300 rounded-md text-sm text-stone-700 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="px-4 py-2 bg-semantic-success text-parchment rounded-md text-sm hover:bg-semantic-success/20 disabled:opacity-50"
            >
              {approveMutation.isPending ? 'Approving...' : 'Approve Request'}
            </button>
          </div>
        </Modal>
      )}

      {/* Fulfill Modal */}
      {showFulfillModal && (
        <Modal onClose={() => setShowFulfillModal(false)}>
          <h3 className="text-lg font-semibold text-stone-900 mb-4">Fulfill Request</h3>
          <p className="text-sm text-stone-600 mb-4">
            Generate a secure download link for the requester.
          </p>
          <div className="mb-4">
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Link Expiration
            </label>
            <select
              value={expiresDays}
              onChange={(e) => setExpiresDays(Number(e.target.value))}
              className="w-full px-3 py-2 border border-stone-300 rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowFulfillModal(false)}
              className="px-4 py-2 border border-stone-300 rounded-md text-sm text-stone-700 hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              onClick={() => fulfillMutation.mutate()}
              disabled={fulfillMutation.isPending}
              className="px-4 py-2 bg-forest text-parchment rounded-md text-sm hover:bg-forest/90 disabled:opacity-50 flex items-center gap-2"
            >
              {fulfillMutation.isPending ? (
                'Generating...'
              ) : (
                <>
                  <Download size={14} />
                  Generate Download Link
                </>
              )}
            </button>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={() => cancelMutation.mutate()}
        title="Cancel Request"
        message="Cancel this request?"
        confirmText="Cancel Request"
        confirmStyle="danger"
      />
    </div>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-md p-6">
        {children}
      </div>
    </div>
  );
}

function DownloadLinksSection({
  orgId,
  requestId,
  token,
}: {
  orgId: string;
  requestId: string;
  token: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['download-links', orgId, requestId, token],
    queryFn: () => getDownloadRequestLinks(orgId, requestId, token),
    enabled: !!token,
  });

  if (isLoading) {
    return <span className="text-sm text-semantic-success">Loading download links...</span>;
  }

  if (error) {
    return <span className="text-sm text-semantic-error">Failed to load download links</span>;
  }

  const downloads = data?.downloads || [];

  return (
    <div className="flex flex-wrap gap-2">
      {(downloads as { download_url: string | null; filename: string; item_id: string }[]).map((item) => (
        item.download_url && (
          <a
            key={item.item_id}
            href={item.download_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 bg-forest text-parchment rounded-md text-sm hover:bg-forest/90 flex items-center gap-2 transition-colors"
          >
            <Download size={14} />
            {item.filename}
          </a>
        )
      ))}
      {downloads.length === 0 && (
        <span className="text-sm text-semantic-success">No downloads available</span>
      )}
    </div>
  );
}
