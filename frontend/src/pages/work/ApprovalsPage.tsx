/**
 * ApprovalsPage - Pending approval requests for the organization
 *
 * Lists approval requests that need review, with inline approve/reject actions.
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Check,
  X,
  Clock,
  User,
  UserPlus,
  CheckCircle,
  XCircle,
  History as HistoryIcon,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { cn } from '../../lib/utils';
import { formatDateShort, formatDateTime } from '../../lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { usePermissions } from '../../hooks/usePermissions';

interface ApprovalRequest {
  request_id: string;
  entity_type: string;
  entity_id: string;
  rule_description: string;
  requester_id?: string;
  requester_name: string | null;
  requested_action: {
    action: string;
    resubmitted?: boolean;
    changed_fields?: string[];
  };
  created_at: string;
  status: string;
  assigned_to_user_id?: string | null;
  assignee_name?: string | null;
  approver_permission?: string | null;
  reviewed_by?: string | null;
  reviewer_name?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
}

interface Assignee {
  user_id: string;
  display_name: string;
  email: string;
}

type ApprovalView = 'mine' | 'pending' | 'history';

/** Format entity_type slug into readable label */
function formatEntityType(entityType: string): string {
  return entityType
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Where each approvable entity_type lives, as an app-qualified path segment.
 *
 * This was previously a short map with a `entityType.replace(/_/g,"-") + "s"`
 * fallback, which invented URLs rather than admitting it did not know one: 17
 * of the 33 entity types that reach approvals resolved to routes that do not
 * exist. `collection_object` — the commonest type of all — guessed
 * "collection-objects" because only "object" was mapped, and every media type
 * was sent to a /collections/ path. Naive pluralisation also broke every word
 * ending in y ("place-authoritys").
 *
 * So the table is explicit and total, and a type with no addressable route
 * maps to null rather than to a guess. Adding an entity type without adding it
 * here renders the badge unlinked, which is wrong but harmless — unlike a link
 * to a 404.
 */
const ENTITY_ROUTES: Record<string, string | null> = {
  // Collections records
  acquisition: 'collections/acquisitions',
  agent_plan: 'collections/work/plans',
  collection_object: 'collections/objects',
  condition_report: 'collections/condition-reports',
  conservation: 'collections/conservation',
  conservation_treatment: 'collections/conservation',
  constituent: 'collections/constituents',
  deaccession: 'collections/deaccessions',
  event: 'collections/events',
  incident_report: 'collections/incidents',
  insurance_policy: 'collections/insurance/policies',
  loan_in: 'collections/loans-in',
  loan_out: 'collections/loans-out',
  movement: 'collections/movements',
  object_entry: 'collections/entries',
  object_exit: 'collections/exits',
  place_authority: 'collections/place-authorities',
  reproduction_request: 'collections/reproduction-requests',
  right: 'collections/rights',
  style_period_authority: 'collections/style-period-authorities',
  subject_authority: 'collections/subject-authorities',
  use_request: 'collections/use-requests',
  valuation: 'collections/valuations',

  // Media records. These carry a media_id (see the draft factory registry's
  // id_attr), so they address the asset itself.
  media: 'media',
  media_metadata: 'media',
  media_publish: 'media',
  media_review: 'media',

  // Addressable by no route: media_rights and media_consent carry a rights_id
  // and a consent_id, which are only reachable through their asset's tabs;
  // object_right has no detail route; a location is a config sub-page with no
  // per-record URL; an information package has a list but no detail page.
  media_rights: null,
  media_consent: null,
  object_right: null,
  location: null,
  information_package: null,
};

/**
 * Resolve the link target for an approval's entity, or null when the record
 * has no addressable URL — the caller renders those unlinked.
 *
 * Agent drafts (from the draft-chaining engine's draft_approval gates) are not
 * a record workspace: they live in the Drafts inbox, so deep-link there and
 * focus the draft.
 */
function approvalEntityHref(
  orgId: string,
  entityType: string,
  entityId: string
): string | null {
  if (entityType === 'agent_draft') {
    return `/organizations/${orgId}/collections/work/drafts?draft=${entityId}`;
  }
  const segment = ENTITY_ROUTES[entityType];
  if (!segment) return null;
  return `/organizations/${orgId}/${segment}/${entityId}`;
}

/** Entity type badge color mapping */
function entityBadgeClasses(entityType: string): string {
  switch (entityType) {
    case 'loan_out':
    case 'loan_in':
      return 'bg-semantic-info/10 text-semantic-info';
    case 'deaccession':
      return 'bg-semantic-error/10 text-semantic-error';
    case 'acquisition':
      return 'bg-semantic-success/10 text-semantic-success';
    default:
      return 'bg-stone text-ink';
  }
}

export default function ApprovalsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();

  // Which view: awaiting-you queue, all-pending queue, or historical record
  const [view, setView] = useState<ApprovalView>('mine');

  // Which row is being reviewed (inline)
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected' | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Which row is being (re)assigned (inline)
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['approvals', orgId, view],
    queryFn: () => {
      const statusParam = view === 'history' ? 'reviewed' : 'pending';
      const mineParam = view === 'mine' ? '&mine=true' : '';
      return apiFetch<{ items: ApprovalRequest[]; total: number }>(
        `/organizations/${orgId}/approvals?status=${statusParam}&limit=100${mineParam}`,
      );
    },
    enabled: !!orgId,
  });

  // Separate query for the "awaiting you" count badge (shown regardless of view).
  const { data: mineCountData } = useQuery({
    queryKey: ['approval-count', orgId, 'mine'],
    queryFn: () =>
      apiFetch<{ count: number }>(
        `/organizations/${orgId}/approvals/count?mine=true`,
      ),
    enabled: !!orgId,
  });
  const mineCount = mineCountData?.count ?? 0;

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
      setReviewingId(null);
      setReviewAction(null);
      setReviewNote('');
      setReviewError(null);
    },
    onError: (err: Error) => {
      setReviewingId(null);
      setReviewAction(null);
      setReviewNote('');
      setReviewError(err.message || 'Failed to submit review');
    },
  });

  const approvals = data?.items ?? [];

  function startReview(id: string, action: 'approved' | 'rejected') {
    setAssigningId(null);
    setReviewingId(id);
    setReviewAction(action);
    setReviewNote('');
    setReviewError(null);
  }

  function startAssign(id: string) {
    setReviewingId(null);
    setAssigningId(id);
  }

  function cancelReview() {
    setReviewingId(null);
    setReviewAction(null);
    setReviewNote('');
  }

  function submitReview() {
    if (!reviewingId || !reviewAction) return;
    reviewMutation.mutate({
      approvalId: reviewingId,
      decision: reviewAction,
      note: reviewNote,
    });
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <ClipboardCheck size={24} className="text-forest" />
          <h1 className="text-2xl font-semibold text-ink">Approvals</h1>
        </div>
        <p className="text-archive text-sm mt-1">
          {view === 'mine'
            ? 'Approvals awaiting you — directed to you, or open to your role.'
            : view === 'pending'
              ? 'All pending approval requests for the organization.'
              : 'Completed approval decisions — approvals and rejections.'}
        </p>
      </div>

      {/* Tab bar: Awaiting you | All pending | History */}
      <div className="mb-4 flex items-center gap-1 border-b border-lichen">
        <button
          type="button"
          onClick={() => setView('mine')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            view === 'mine'
              ? 'border-bark text-bark'
              : 'border-transparent text-archive hover:text-ink',
          )}
        >
          <span className="inline-flex items-center gap-2">
            <ClipboardCheck size={14} />
            Awaiting you
            {mineCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] rounded-full bg-semantic-error/10 text-semantic-error font-semibold">
                {mineCount}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setView('pending')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            view === 'pending'
              ? 'border-bark text-bark'
              : 'border-transparent text-archive hover:text-ink',
          )}
        >
          <span className="inline-flex items-center gap-2">
            <Clock size={14} />
            All pending
          </span>
        </button>
        <button
          type="button"
          onClick={() => setView('history')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            view === 'history'
              ? 'border-bark text-bark'
              : 'border-transparent text-archive hover:text-ink',
          )}
        >
          <span className="inline-flex items-center gap-2">
            <HistoryIcon size={14} />
            History
          </span>
        </button>
      </div>

      {/* Error banner */}
      {reviewError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-semantic-error/10 border border-semantic-error/30 text-semantic-error text-sm flex items-center justify-between">
          <span>{reviewError}</span>
          <button onClick={() => setReviewError(null)} className="text-semantic-error hover:text-semantic-error/70">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <MadronaLoader variant="inline" label="Loading approvals…" />
        </div>
      )}

      {/* Error state */}
      {!isLoading && isError && (
        <ErrorState
          title="Could not load approvals."
          description="The request failed. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}

      {/* Empty state */}
      {!isLoading && !isError && approvals.length === 0 && (
        <EmptyState
          icon={view === 'history' ? HistoryIcon : ClipboardCheck}
          title={
            view === 'mine'
              ? 'Nothing awaiting you'
              : view === 'pending'
                ? 'No pending approvals'
                : 'No completed approvals yet'
          }
          variant="compact"
        />
      )}

      {/* Approvals table */}
      {!isLoading && !isError && approvals.length > 0 && (
        <div className="bg-parchment rounded-lg border border-lichen overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone text-left">
                <th className="px-4 py-3 font-medium text-ink">Entity</th>
                <th className="px-4 py-3 font-medium text-ink">Description</th>
                <th className="px-4 py-3 font-medium text-ink">
                  <span className="flex items-center gap-1.5">
                    <User size={14} />
                    Requester
                  </span>
                </th>
                <th className="px-4 py-3 font-medium text-ink">
                  <span className="flex items-center gap-1.5">
                    <Clock size={14} />
                    {view === 'history' ? 'Reviewed' : 'Created'}
                  </span>
                </th>
                <th className="px-4 py-3 font-medium text-ink text-right">
                  {view === 'history' ? 'Decision' : 'Actions'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {approvals.map((approval) => {
                // Per-row gate: only holders of the rule's approver permission
                // may act. Backend enforces this too; this hides the controls.
                const canAct = approval.approver_permission
                  ? hasPermission(approval.approver_permission)
                  : false;
                const entityHref = approvalEntityHref(
                  orgId ?? '',
                  approval.entity_type,
                  approval.entity_id
                );
                const entityBadge = (
                  <span
                    className={cn(
                      'px-2 py-0.5 text-xs rounded',
                      entityBadgeClasses(approval.entity_type)
                    )}
                  >
                    {formatEntityType(approval.entity_type)}
                  </span>
                );
                return (
                <tr key={approval.request_id} className="group">
                  <td className="px-4 py-3">
                    {entityHref ? (
                      <Link
                        to={entityHref}
                        className="text-bark hover:text-copper-dark font-medium"
                      >
                        {entityBadge}
                      </Link>
                    ) : (
                      entityBadge
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink">
                    <div>{approval.rule_description}</div>
                    {approval.requested_action?.resubmitted && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="px-1.5 py-0.5 text-xs bg-semantic-warning/10 text-semantic-warning rounded">
                          Resubmitted
                        </span>
                        {approval.requested_action.changed_fields?.map((f) => (
                          <span key={f} className="px-1.5 py-0.5 text-xs bg-stone text-archive rounded">
                            {f.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-archive">
                    {approval.requester_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-archive">
                    {view === 'history' && approval.reviewed_at
                      ? formatDateShort(approval.reviewed_at)
                      : formatDateShort(approval.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    {view === 'history' ? (
                      <HistoryDecisionCell approval={approval} />
                    ) : !canAct ? (
                      <span className="text-xs text-archive italic">
                        {approval.assignee_name
                          ? `Assigned to ${approval.assignee_name}`
                          : 'View only'}
                      </span>
                    ) : reviewingId === approval.request_id ? (
                      <div className="flex flex-col gap-2 items-end">
                        <textarea
                          value={reviewNote}
                          onChange={(e) => setReviewNote(e.target.value)}
                          placeholder={`Add a note (optional)...`}
                          rows={2}
                          className="w-64 text-sm border border-lichen rounded-lg px-3 py-2 bg-parchment focus-visible:ring-2 ring-bark/30 ring-offset-2"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={cancelReview}
                            className="text-archive hover:text-ink text-sm px-2 py-1"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={submitReview}
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
                    ) : assigningId === approval.request_id ? (
                      <AssignPicker
                        orgId={orgId!}
                        request={approval}
                        onDone={() => setAssigningId(null)}
                      />
                    ) : (
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => startAssign(approval.request_id)}
                          className="text-archive hover:text-ink rounded-lg px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
                          title={
                            approval.assignee_name
                              ? `Directed to ${approval.assignee_name} — click to reassign`
                              : 'Direct this approval to a specific person'
                          }
                        >
                          <UserPlus size={14} />
                          {approval.assignee_name ?? 'Assign'}
                        </button>
                        <button
                          onClick={() => startReview(approval.request_id, 'approved')}
                          className="bg-semantic-success/10 text-semantic-success hover:bg-semantic-success/20 rounded-lg px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
                        >
                          <Check size={14} />
                          Approve
                        </button>
                        <button
                          onClick={() => startReview(approval.request_id, 'rejected')}
                          className="bg-semantic-error/10 text-semantic-error hover:bg-semantic-error/20 rounded-lg px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5"
                        >
                          <X size={14} />
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Inline picker for directing an approval to a specific person. Lists the staff
 * who hold the rule's approver permission (the only valid assignees); selecting
 * one routes the request to them. "Clear" returns it to the open pool.
 */
function AssignPicker({
  orgId,
  request,
  onDone,
}: {
  orgId: string;
  request: ApprovalRequest;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['approval-assignees', orgId, request.request_id],
    queryFn: () =>
      apiFetch<{ assignees: Assignee[] }>(
        `/organizations/${orgId}/approvals/${request.request_id}/assignees`,
      ),
  });

  const assignMutation = useMutation({
    mutationFn: (assigneeId: string | null) =>
      apiFetch(`/organizations/${orgId}/approvals/${request.request_id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assigned_to_user_id: assigneeId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals', orgId] });
      queryClient.invalidateQueries({ queryKey: ['approval-count', orgId] });
      onDone();
    },
  });

  const assignees = data?.assignees ?? [];

  return (
    <div className="flex flex-col gap-1 items-end w-64">
      {isLoading && <span className="text-sm text-archive py-1">Loading…</span>}
      {!isLoading && assignees.length === 0 && (
        <span className="text-sm text-archive py-1">No eligible approvers</span>
      )}
      {assignees.map((a) => (
        <button
          key={a.user_id}
          type="button"
          onClick={() => assignMutation.mutate(a.user_id)}
          disabled={assignMutation.isPending}
          className={cn(
            'w-full text-right rounded px-2 py-1 text-sm hover:bg-stone disabled:opacity-50',
            a.user_id === request.assigned_to_user_id && 'font-semibold text-bark',
          )}
        >
          {a.display_name}
        </button>
      ))}
      <div className="flex items-center gap-2 pt-1">
        {request.assigned_to_user_id && (
          <button
            type="button"
            onClick={() => assignMutation.mutate(null)}
            disabled={assignMutation.isPending}
            className="text-semantic-error hover:text-semantic-error/70 text-sm px-2 py-1 disabled:opacity-50"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className="text-archive hover:text-ink text-sm px-2 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Renders the decision column for a reviewed approval row: a status badge,
 * the reviewer's name, and the optional review note.
 */
function HistoryDecisionCell({ approval }: { approval: ApprovalRequest }) {
  const isApproved = approval.status === 'approved';
  const isRejected = approval.status === 'rejected';

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          isApproved && 'bg-semantic-success/10 text-semantic-success',
          isRejected && 'bg-semantic-error/10 text-semantic-error',
          !isApproved && !isRejected && 'bg-stone text-archive',
        )}
      >
        {isApproved ? (
          <CheckCircle size={12} />
        ) : isRejected ? (
          <XCircle size={12} />
        ) : null}
        {isApproved ? 'Approved' : isRejected ? 'Rejected' : approval.status}
      </span>
      {approval.reviewer_name && (
        <span className="text-xs text-archive">
          by {approval.reviewer_name}
        </span>
      )}
      {approval.reviewed_at && (
        <span
          className="text-[11px] text-archive/80"
          title={formatDateTime(approval.reviewed_at)}
        >
          {formatDateTime(approval.reviewed_at)}
        </span>
      )}
      {approval.review_note && (
        <span
          className="text-[11px] text-archive italic max-w-[260px] text-right"
          title={approval.review_note}
        >
          "{approval.review_note}"
        </span>
      )}
    </div>
  );
}
