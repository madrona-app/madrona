/**
 * PendingApprovalBanner - Shown on workspace pages when a record is pending approval.
 *
 * For users with approve permission, shows inline Approve/Reject buttons.
 * After review the parent is notified via onReviewed() to refetch entity data.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Check, X } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/utils';

interface ApprovalRequest {
  request_id: string;
  entity_type: string;
  entity_id: string;
  rule_description: string | null;
  approver_permission: string | null;
  status: string;
}

interface PendingApprovalBannerProps {
  visible: boolean;
  entityType: string;
  entityId: string;
  orgId: string;
  onReviewed?: () => void;
}

export function PendingApprovalBanner({
  visible,
  entityType,
  entityId,
  orgId,
  onReviewed,
}: PendingApprovalBannerProps) {
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected' | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  // Fetch approval request for this specific entity
  const { data } = useQuery({
    queryKey: ['approvals', orgId, entityType, entityId],
    queryFn: () =>
      apiFetch<{ items: ApprovalRequest[] }>(
        `/organizations/${orgId}/approvals?entity_type=${entityType}`
      ),
    enabled: visible && !!orgId,
  });

  const approval = data?.items?.find(
    (a) => a.entity_id === entityId && a.status === 'pending'
  );

  const reviewMutation = useMutation({
    mutationFn: ({
      approvalId,
      decision,
      note,
    }: {
      approvalId: string;
      decision: 'approved' | 'rejected';
      note: string;
    }) =>
      apiFetch(`/organizations/${orgId}/approvals/${approvalId}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals', orgId] });
      queryClient.invalidateQueries({ queryKey: ['approval-count', orgId] });
      setReviewAction(null);
      setReviewNote('');
      onReviewed?.();
    },
  });

  if (!visible) return null;

  // Check the entity-specific approver permission (e.g., loans.approve, deaccession.approve)
  const canApprove = approval?.approver_permission
    ? hasPermission(approval.approver_permission)
    : false;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 px-4 py-3 mb-4 rounded-lg',
        'bg-semantic-warning/10 border border-semantic-warning/30'
      )}
    >
      <div className="flex items-center gap-2 text-sm text-semantic-warning">
        <Clock size={14} className="shrink-0" />
        <span className="font-medium">This record is pending approval</span>
      </div>

      {canApprove && approval && !reviewAction && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReviewAction('approved')}
            className="bg-semantic-success/10 text-semantic-success hover:bg-semantic-success/20 rounded-lg px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Check size={14} />
            Approve
          </button>
          <button
            onClick={() => setReviewAction('rejected')}
            className="bg-semantic-error/10 text-semantic-error hover:bg-semantic-error/20 rounded-lg px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
          >
            <X size={14} />
            Reject
          </button>
        </div>
      )}

      {canApprove && approval && reviewAction && (
        <div className="flex flex-col gap-2">
          <textarea
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            placeholder="Add a note (optional)..."
            rows={2}
            className="w-full max-w-md text-sm border border-lichen rounded-lg px-3 py-2 bg-parchment focus-visible:ring-2 ring-bark/30 ring-offset-2"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setReviewAction(null);
                setReviewNote('');
              }}
              className="text-archive hover:text-ink text-sm px-2 py-1"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!approval) return;
                reviewMutation.mutate({
                  approvalId: approval.request_id,
                  decision: reviewAction,
                  note: reviewNote,
                });
              }}
              disabled={reviewMutation.isPending}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium',
                reviewAction === 'approved'
                  ? 'bg-semantic-success/10 text-semantic-success hover:bg-semantic-success/20'
                  : 'bg-semantic-error/10 text-semantic-error hover:bg-semantic-error/20'
              )}
            >
              {reviewMutation.isPending
                ? 'Submitting...'
                : reviewAction === 'approved'
                  ? 'Confirm Approve'
                  : 'Confirm Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
