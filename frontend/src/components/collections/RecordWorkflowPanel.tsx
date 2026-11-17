import { useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Flag, ListChecks, XCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getFriendlyErrorMessage } from '../../lib/apiClient';
import {
  CATALOGING_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  cancelReview,
  decideReview,
  getObjectCompleteness,
  getObjectFlags,
  getObjectReviews,
  listRecordFlags,
  listReviewers,
  setObjectFlags,
  submitForReview,
} from '../../lib/api/recordWorkflow';
import type { RecordReview } from '../../lib/api/recordWorkflow';

const fieldClass =
  'w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark aria-[invalid=true]:border-semantic-error';
const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

interface RecordWorkflowPanelProps {
  orgId: string;
  objectId: string;
  canEdit: boolean;
}

/**
 * Record status for an object: review workflow, flags, and completeness.
 *
 * Screen reader and keyboard first: one region with an h2, an h3 per part,
 * native form controls with visible labels, a fieldset for the flag
 * checkboxes and the decision choice, errors tied to their field, and one
 * polite live region that reports each outcome. After an action, focus moves
 * to the review status heading so the user hears the new state.
 */
export function RecordWorkflowPanel({ orgId, objectId, canEdit }: RecordWorkflowPanelProps) {
  const id = useId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');

  const reviewsQ = useQuery({
    queryKey: ['record-reviews', orgId, objectId],
    queryFn: () => getObjectReviews(orgId, objectId),
  });
  const flagDefsQ = useQuery({ queryKey: ['record-flags', orgId], queryFn: () => listRecordFlags(orgId) });
  const flagsQ = useQuery({
    queryKey: ['object-flags', orgId, objectId],
    queryFn: () => getObjectFlags(orgId, objectId),
  });
  const completenessQ = useQuery({
    queryKey: ['object-completeness', orgId, objectId],
    queryFn: () => getObjectCompleteness(orgId, objectId),
  });

  const reviews = reviewsQ.data?.items ?? [];
  const pending = reviews.find((r) => r.status === 'pending') ?? null;
  const status = reviewsQ.data?.cataloging_status ?? null;
  const isReviewer = !!pending && pending.reviewer_id === user?.user_id;
  // The submitter never decides their own review (the API enforces this too).
  const canDecide = !!pending && pending.requested_by !== user?.user_id && (isReviewer || !!reviewsQ.data?.can_decide_admin);
  const canCancel =
    !!pending && (pending.requested_by === user?.user_id || isReviewer || !!reviewsQ.data?.can_decide_admin);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['record-reviews', orgId, objectId] });
    queryClient.invalidateQueries({ queryKey: ['collection-object', orgId, objectId] });
    queryClient.invalidateQueries({ queryKey: ['object-flags', orgId, objectId] });
    queryClient.invalidateQueries({ queryKey: ['object-completeness', orgId, objectId] });
  };

  const done = (message: string) => {
    setError('');
    setAnnouncement(message);
    refreshAll();
    requestAnimationFrame(() => statusHeadingRef.current?.focus());
  };
  const failed = (err: unknown) => {
    const message = getFriendlyErrorMessage(err);
    setError(message);
    setAnnouncement(message);
  };

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="bg-parchment-warm border border-lichen rounded-lg p-4 space-y-6"
    >
      <h2 id={`${id}-heading`} className="text-base font-semibold text-ink flex items-center gap-2">
        <ClipboardCheck size={18} aria-hidden="true" className="text-forest" />
        Record status
      </h2>

      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      {error && (
        <p className="text-sm text-semantic-error bg-semantic-error/10 rounded px-3 py-2">{error}</p>
      )}

      {/* ── Review ─────────────────────────────────────────────────── */}
      <div>
        <h3 ref={statusHeadingRef} tabIndex={-1} className={`text-sm font-semibold text-ink rounded ${focusRing}`}>
          Review: {status ? CATALOGING_STATUS_LABELS[status] ?? status : 'Not started'}
        </h3>
        {pending && (
          <p className="mt-1 text-sm text-ink">
            Assigned to {pending.reviewer_name ?? 'a reviewer'} by {pending.requested_by_name ?? 'a colleague'} on{' '}
            {formatDate(pending.requested_at)}.
            {pending.request_note && <> Note: {pending.request_note}</>}
          </p>
        )}

        {!pending && canEdit && (
          <SubmitForReviewForm
            orgId={orgId}
            objectId={objectId}
            onDone={(name) => done(`Submitted for review. ${name} has been notified.`)}
            onError={failed}
          />
        )}
        {pending && canDecide && (
          <DecisionForm
            orgId={orgId}
            review={pending}
            onDone={(decision) =>
              done(decision === 'approved' ? 'Record approved. The cataloguer has been notified.' : 'Changes requested. The cataloguer has been notified.')
            }
            onError={failed}
          />
        )}
        {pending && canCancel && (
          <CancelReviewButton orgId={orgId} review={pending} onDone={() => done('Review cancelled.')} onError={failed} />
        )}

        <ReviewHistory reviews={reviews.filter((r) => r.status !== 'pending')} headingId={`${id}-history`} />
      </div>

      {/* ── Flags ──────────────────────────────────────────────────── */}
      <FlagsEditor
        orgId={orgId}
        objectId={objectId}
        canEdit={canEdit}
        definitions={flagDefsQ.data ?? []}
        current={flagsQ.data ?? []}
        onSaved={(labels) => {
          setError('');
          setAnnouncement(labels.length ? `Flags saved: ${labels.join(', ')}` : 'All flags cleared');
          queryClient.invalidateQueries({ queryKey: ['object-flags', orgId, objectId] });
        }}
        onError={failed}
      />

      {/* ── Completeness ───────────────────────────────────────────── */}
      {(completenessQ.data?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <ListChecks size={16} aria-hidden="true" className="text-forest" />
            Completeness rules
          </h3>
          <ul className="mt-2 space-y-2">
            {completenessQ.data!.map((r) => (
              <li key={r.rule_id} className="text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                  {r.met ? (
                    <CheckCircle2 size={16} aria-hidden="true" className="text-semantic-success" />
                  ) : (
                    <XCircle size={16} aria-hidden="true" className="text-semantic-warning" />
                  )}
                  {r.name}: {r.met ? 'met' : 'not met'}
                  {r.required_for_publication && <span className="font-normal text-archive"> (required before publishing)</span>}
                </span>
                {!r.met && r.missing.length > 0 && (
                  <ul className="mt-1 ml-6 list-disc text-archive">
                    {r.missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SubmitForReviewForm({
  orgId, objectId, onDone, onError,
}: { orgId: string; objectId: string; onDone: (reviewerName: string) => void; onError: (e: unknown) => void }) {
  const id = useId();
  const [reviewerId, setReviewerId] = useState('');
  const [note, setNote] = useState('');
  const [showError, setShowError] = useState(false);
  const reviewersQ = useQuery({ queryKey: ['reviewers', orgId], queryFn: () => listReviewers(orgId) });
  const mutation = useMutation({
    mutationFn: () => submitForReview(orgId, objectId, reviewerId, note),
    onSuccess: (r) => {
      setNote('');
      onDone(r.reviewer_name ?? 'The reviewer');
    },
    onError,
  });
  const missingReviewer = showError && !reviewerId;

  return (
    <form
      className="mt-3 space-y-3"
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!reviewerId) {
          setShowError(true);
          document.getElementById(`${id}-reviewer`)?.focus();
          return;
        }
        mutation.mutate();
      }}
    >
      <p id={`${id}-title`} className="text-sm text-archive">Submit this record for review</p>
      <div>
        <label htmlFor={`${id}-reviewer`} className="block text-sm font-medium text-ink mb-1">Reviewer</label>
        <select
          id={`${id}-reviewer`}
          value={reviewerId}
          onChange={(e) => setReviewerId(e.target.value)}
          aria-invalid={missingReviewer}
          aria-describedby={missingReviewer ? `${id}-reviewer-error` : undefined}
          className={fieldClass}
        >
          <option value="">Choose a reviewer</option>
          {(reviewersQ.data ?? []).map((r) => (
            <option key={r.user_id} value={r.user_id}>{r.name}</option>
          ))}
        </select>
        {missingReviewer && (
          <p id={`${id}-reviewer-error`} className="mt-1 text-xs text-semantic-error">Choose who should review this record.</p>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="block text-sm font-medium text-ink mb-1">
          Note for the reviewer <span className="font-normal text-archive">(optional)</span>
        </label>
        <textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={fieldClass} />
      </div>
      <button type="submit" disabled={mutation.isPending} className="btn-primary text-sm">
        {mutation.isPending ? 'Submitting…' : 'Submit for review'}
      </button>
    </form>
  );
}

function DecisionForm({
  orgId, review, onDone, onError,
}: {
  orgId: string;
  review: RecordReview;
  onDone: (decision: 'approved' | 'changes_requested') => void;
  onError: (e: unknown) => void;
}) {
  const id = useId();
  const [decision, setDecision] = useState<'approved' | 'changes_requested' | ''>('');
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const mutation = useMutation({
    mutationFn: () => decideReview(orgId, review.review_id, decision as 'approved' | 'changes_requested', note),
    onSuccess: () => onDone(decision as 'approved' | 'changes_requested'),
    onError,
  });
  const noDecision = showErrors && !decision;
  const noteRequired = decision === 'changes_requested';
  const missingNote = showErrors && noteRequired && !note.trim();

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!decision || (noteRequired && !note.trim())) {
          setShowErrors(true);
          document.getElementById(!decision ? `${id}-approve` : `${id}-note`)?.focus();
          return;
        }
        mutation.mutate();
      }}
    >
      <fieldset aria-describedby={noDecision ? `${id}-decision-error` : undefined}>
        <legend className="text-sm font-medium text-ink mb-1">Your decision</legend>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm text-ink min-h-[24px]">
            <input id={`${id}-approve`} type="radio" name={`${id}-decision`} value="approved"
              checked={decision === 'approved'} onChange={() => setDecision('approved')} className={focusRing} />
            Approve
          </label>
          <label className="flex items-center gap-2 text-sm text-ink min-h-[24px]">
            <input type="radio" name={`${id}-decision`} value="changes_requested"
              checked={decision === 'changes_requested'} onChange={() => setDecision('changes_requested')} className={focusRing} />
            Request changes
          </label>
        </div>
        {noDecision && <p id={`${id}-decision-error`} className="mt-1 text-xs text-semantic-error">Choose approve or request changes.</p>}
      </fieldset>
      <div>
        <label htmlFor={`${id}-note`} className="block text-sm font-medium text-ink mb-1">
          Review notes{' '}
          <span className="font-normal text-archive">{noteRequired ? '(required: say what needs to change)' : '(optional)'}</span>
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          aria-required={noteRequired}
          aria-invalid={missingNote}
          aria-describedby={missingNote ? `${id}-note-error` : undefined}
          className={fieldClass}
        />
        {missingNote && <p id={`${id}-note-error`} className="mt-1 text-xs text-semantic-error">Say what needs to change.</p>}
      </div>
      <button type="submit" disabled={mutation.isPending} className="btn-primary text-sm">
        {mutation.isPending ? 'Saving…' : 'Record decision'}
      </button>
    </form>
  );
}

function CancelReviewButton({
  orgId, review, onDone, onError,
}: { orgId: string; review: RecordReview; onDone: () => void; onError: (e: unknown) => void }) {
  const mutation = useMutation({ mutationFn: () => cancelReview(orgId, review.review_id), onSuccess: onDone, onError });
  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="mt-3 btn-tertiary text-sm"
    >
      Cancel this review
    </button>
  );
}

function ReviewHistory({ reviews, headingId }: { reviews: RecordReview[]; headingId: string }) {
  if (reviews.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 id={headingId} className="text-sm font-medium text-ink">Review history</h4>
      <ol aria-labelledby={headingId} className="mt-1 space-y-2">
        {reviews.map((r) => (
          <li key={r.review_id} className="text-sm text-ink border-l-2 border-lichen pl-3">
            <span className="font-medium">{REVIEW_STATUS_LABELS[r.status]}</span>
            {r.decided_by_name && <> by {r.decided_by_name}</>}
            {r.decided_at && <> on {formatDate(r.decided_at)}</>}.{' '}
            <span className="text-archive">
              Submitted by {r.requested_by_name ?? 'a colleague'} on {formatDate(r.requested_at)}
              {r.reviewer_name && <> for {r.reviewer_name}</>}.
            </span>
            {r.decision_note && <p className="mt-0.5">Notes: {r.decision_note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function FlagsEditor({
  orgId, objectId, canEdit, definitions, current, onSaved, onError,
}: {
  orgId: string;
  objectId: string;
  canEdit: boolean;
  definitions: { flag_id: string; label: string; description: string | null; is_active: boolean; is_rule_managed: boolean }[];
  current: { flag_id: string; label: string; source: 'manual' | 'rule' }[];
  onSaved: (labels: string[]) => void;
  onError: (e: unknown) => void;
}) {
  const id = useId();
  const currentIds = useMemo(() => new Set(current.map((f) => f.flag_id)), [current]);
  const manualDefs = definitions.filter((d) => d.is_active && !d.is_rule_managed);
  const ruleFlags = current.filter((f) => f.source === 'rule');
  const mutation = useMutation({
    mutationFn: (ids: string[]) => setObjectFlags(orgId, objectId, ids),
    onSuccess: (items) => onSaved(items.map((f) => f.label)),
    onError,
  });

  const toggle = (flagId: string, checked: boolean) => {
    const manual = current.filter((f) => f.source === 'manual').map((f) => f.flag_id);
    const next = checked ? [...new Set([...manual, flagId])] : manual.filter((x) => x !== flagId);
    mutation.mutate(next);
  };

  if (manualDefs.length === 0 && current.length === 0) return null;

  return (
    <div>
      {canEdit && manualDefs.length > 0 ? (
        <fieldset>
          <legend className="text-sm font-semibold text-ink flex items-center gap-2">
            <Flag size={16} aria-hidden="true" className="text-forest" />
            Flags
          </legend>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
            {manualDefs.map((d) => (
              <div key={d.flag_id} className="flex items-start gap-2 min-h-[24px]">
                <input
                  id={`${id}-${d.flag_id}`}
                  type="checkbox"
                  checked={currentIds.has(d.flag_id)}
                  disabled={mutation.isPending}
                  onChange={(e) => toggle(d.flag_id, e.target.checked)}
                  aria-describedby={d.description ? `${id}-${d.flag_id}-desc` : undefined}
                  className={`mt-0.5 ${focusRing}`}
                />
                <div>
                  <label htmlFor={`${id}-${d.flag_id}`} className="text-sm text-ink">{d.label}</label>
                  {d.description && <p id={`${id}-${d.flag_id}-desc`} className="text-xs text-archive">{d.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Flag size={16} aria-hidden="true" className="text-forest" />
            Flags
          </h3>
          {current.filter((f) => f.source === 'manual').length === 0 ? (
            <p className="mt-1 text-sm text-archive">No flags set.</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {current.filter((f) => f.source === 'manual').map((f) => (
                <li key={f.flag_id} className="px-2 py-0.5 rounded bg-stone/50 text-sm text-ink">{f.label}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {ruleFlags.length > 0 && (
        <p className="mt-2 text-sm text-ink">
          Set automatically by completeness rules: {ruleFlags.map((f) => f.label).join(', ')}.
        </p>
      )}
    </div>
  );
}
