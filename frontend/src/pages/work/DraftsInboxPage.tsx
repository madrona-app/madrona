/**
 * DraftsInboxPage — review/act surface for Guide-proposed drafts (v1 §1.4).
 *
 * Drafts never touch live records; a reviewer edits, approves (→ apply to the
 * live entity), or rejects them here. Rule-bound drafts (with an approval
 * request) are decided in Approvals instead. Live state via react-query.
 */

import { useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useActiveProduct, workBasePath } from '../../hooks/useActiveProduct';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileEdit,
  Check,
  X,
  Save,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import {
  listDrafts,
  patchDraft,
  approveDraft,
  rejectDraft,
  type AgentDraft,
  type DraftStatus,
} from '../../lib/api/drafts';
import { formatDateTime } from '../../lib/formatters';
import { cn } from '../../lib/utils';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { StudioWordmark } from '../../components/studio/StudioWordmark';
import { StudioAttribution } from '../../components/studio/StudioAttribution';
import { ProcedurePreApprovalRibbon } from '../../components/studio/ProcedurePreApprovalRibbon';
import { DraftPayloadForm } from '../../components/studio/DraftPayloadForm';
import { StudioLauncherCard } from '../../components/studio/StudioLauncherCard';
import { usePermissions } from '../../hooks/usePermissions';

type Tab = 'pending' | 'reviewed' | 'all';

const TAB_LABEL: Record<Tab, string> = {
  pending: 'Pending',
  reviewed: 'Reviewed',
  all: 'All',
};

const REVIEWED: ReadonlySet<DraftStatus> = new Set([
  'approved',
  'rejected',
  'cancelled',
  'superseded',
  'expired',
]);

const STATUS_PILL: Record<DraftStatus, string> = {
  pending: 'bg-semantic-warning/15 text-semantic-warning',
  approved: 'bg-semantic-success/15 text-semantic-success',
  rejected: 'bg-semantic-error/15 text-semantic-error',
  superseded: 'bg-stone/60 text-archive',
  cancelled: 'bg-stone/60 text-archive',
  expired: 'bg-stone/60 text-archive',
};

function summarize(d: AgentDraft): string {
  const p = d.payload || {};
  const type = (p.report_type as string) || d.entity_type.replace(/_/g, ' ');
  return `${type} — object ${(p.object_id as string) ?? '—'}`;
}

export default function DraftsInboxPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  // Mutating endpoints require collections.create (same gate the backend
  // enforces). Hide act controls for view-only roles instead of letting them
  // click into a 403.
  const canAct = hasPermission('collections.create');
  const [tab, setTab] = useState<Tab>('pending');
  // Deep-link focus: ?draft=<id> (e.g. from an Approvals row) pre-expands that draft.
  const [searchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(() => searchParams.get('draft'));

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['drafts', orgId],
    queryFn: () => listDrafts(orgId as string),
    enabled: !!orgId,
  });

  const drafts = useMemo(() => data?.drafts ?? [], [data]);
  const buckets = useMemo(
    () => ({
      pending: drafts.filter((d) => d.status === 'pending'),
      reviewed: drafts.filter((d) => REVIEWED.has(d.status)),
      all: drafts,
    }),
    [drafts],
  );
  const visible = buckets[tab];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['drafts', orgId] });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveDraft(orgId as string, id),
    onSuccess: invalidate,
  });
  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectDraft(orgId as string, id),
    onSuccess: invalidate,
  });
  const patchMut = useMutation({
    mutationFn: (v: { id: string; payload: Record<string, unknown> }) =>
      patchDraft(orgId as string, v.id, v.payload),
    onSuccess: invalidate,
  });

  const approvalsHref = `/organizations/${orgId}/collections/work/approvals`;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Studio brand breadcrumb (§6), in-product short form (§2). */}
      <div className="flex items-center gap-2 mb-4">
        <nav aria-label="Breadcrumb" className="flex items-baseline gap-2">
          <StudioWordmark className="text-2xl leading-none" />
          <span className="text-xl text-stone" aria-hidden>/</span>
          <h1 className="font-sans text-base font-medium tracking-wide text-archive">Drafts</h1>
        </nav>
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-auto inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark"
          title="Refresh"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} aria-hidden />
          Refresh
        </button>
      </div>

      <div className="flex gap-1 mb-4 border-b border-lichen" role="tablist">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 text-sm border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-bark text-ink font-medium'
                : 'border-transparent text-archive hover:text-ink',
            )}
          >
            {TAB_LABEL[t]}
            <span className="ml-1.5 text-[10px] text-archive">{buckets[t].length}</span>
          </button>
        ))}
      </div>

      {isLoading && <MadronaLoader variant="inline" label="Loading drafts…" />}
      {isError && (
        <ErrorState variant="inline" title="Could not load drafts." onRetry={() => refetch()} />
      )}
      {!isLoading && !isError && visible.length === 0 && (
        tab === 'pending'
          ? <EmptyState icon={FileEdit} title="No drafts awaiting review." variant="compact" />
          : <StudioLauncherCard descriptor="Studio drafts records here for your review — nothing touches the collection until you approve it." />
      )}

      <ul className="space-y-2">
        {visible.map((d) => (
          <DraftRow
            key={d.draft_id}
            draft={d}
            canAct={canAct}
            approvalsHref={approvalsHref}
            expanded={expanded === d.draft_id}
            onToggle={() =>
              setExpanded((cur) => (cur === d.draft_id ? null : d.draft_id))
            }
            onApprove={() => approveMut.mutate(d.draft_id)}
            onReject={() => rejectMut.mutate(d.draft_id)}
            onSave={(payload) => patchMut.mutate({ id: d.draft_id, payload })}
            busy={approveMut.isPending || rejectMut.isPending || patchMut.isPending}
            saveError={patchMut.isError}
          />
        ))}
      </ul>
    </div>
  );
}

interface DraftRowProps {
  draft: AgentDraft;
  canAct: boolean;
  approvalsHref: string;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  busy: boolean;
  saveError: boolean;
}

function DraftRow({
  draft,
  canAct,
  approvalsHref,
  expanded,
  onToggle,
  onApprove,
  onReject,
  onSave,
  busy,
  saveError,
}: DraftRowProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeProductId } = useActiveProduct();
  const workBase = workBasePath(orgId as string, activeProductId);
  const Toggle = expanded ? ChevronDown : ChevronRight;
  const [payload, setPayload] = useState<Record<string, unknown>>(
    () => (draft.payload as Record<string, unknown>) || {},
  );
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [edit, setEdit] = useState(() => JSON.stringify(draft.payload, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const pending = draft.status === 'pending';
  const ruleBound = !!draft.approval_request_id;

  function switchMode(next: 'form' | 'json') {
    if (next === 'json') {
      setEdit(JSON.stringify(payload, null, 2));
    } else {
      // Entering form mode: adopt any valid raw edits, else keep the form state.
      try { setPayload(JSON.parse(edit)); setJsonError(null); } catch { /* keep */ }
    }
    setMode(next);
  }

  function handleSave() {
    if (mode === 'json') {
      try {
        const parsed = JSON.parse(edit) as Record<string, unknown>;
        setJsonError(null);
        onSave(parsed);
      } catch {
        setJsonError('Payload is not valid JSON.');
      }
      return;
    }
    setJsonError(null);
    onSave(payload);
  }

  return (
    <li className="rounded-md border border-lichen bg-parchment">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        <Toggle size={14} className="text-archive shrink-0" aria-hidden />
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone/50 text-ink shrink-0">
          {draft.entity_type.replace(/_/g, ' ')}
        </span>
        <span className="truncate text-sm text-ink flex-1">{summarize(draft)}</span>
        <span
          className={cn(
            'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0',
            STATUS_PILL[draft.status],
          )}
        >
          {draft.status}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-lichen text-sm">
          {draft.rationale && (
            <p className="text-archive italic mt-2">{draft.rationale}</p>
          )}
          <div className="text-[11px] text-archive mt-1 flex flex-wrap gap-2">
            {/* §9: Studio is named as the actor — "Drafted by Studio" — not the
                individual sub-agent persona. */}
            <StudioAttribution className="text-[11px]" />
            {draft.model_id && <span className="font-mono">· {draft.model_id}</span>}
            {draft.created_at && <span>· {formatDateTime(draft.created_at)}</span>}
            {draft.plan_id && (
              <Link
                to={`${workBase}/plans/${draft.plan_id}`}
                className="text-bark hover:text-copper-dark"
              >
                · view plan
              </Link>
            )}
          </div>

          {/* Pre-approval procedure trust marker (§7): the procedure this draft
              follows + whether it meets the proposal-stage requirements. */}
          {draft.procedure && (
            <div className="mt-2">
              <ProcedurePreApprovalRibbon procedure={draft.procedure} />
            </div>
          )}

          {draft.apply_error && (
            <p className="text-[11px] text-semantic-error mt-1">{draft.apply_error}</p>
          )}

          <div className="mt-3 mb-1 flex items-center justify-between">
            <span className="text-[11px] text-archive">Proposed record</span>
            <div className="inline-flex rounded border border-lichen overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => switchMode('form')}
                className={mode === 'form'
                  ? 'px-2 py-0.5 bg-bark text-parchment'
                  : 'px-2 py-0.5 text-archive hover:bg-stone/40'}
              >
                Form
              </button>
              <button
                type="button"
                onClick={() => switchMode('json')}
                className={mode === 'json'
                  ? 'px-2 py-0.5 bg-bark text-parchment'
                  : 'px-2 py-0.5 text-archive hover:bg-stone/40'}
              >
                JSON
              </button>
            </div>
          </div>
          {mode === 'form' ? (
            <DraftPayloadForm
              entityType={draft.entity_type}
              value={payload}
              onChange={setPayload}
              disabled={!pending || !canAct}
              onUnavailable={() => setMode('json')}
            />
          ) : (
            <textarea
              id={`draft-payload-${draft.draft_id}`}
              aria-label="Draft payload (JSON)"
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
              disabled={!pending || !canAct}
              spellCheck={false}
              rows={Math.min(14, edit.split('\n').length + 1)}
              className="w-full font-mono text-xs rounded border border-lichen bg-stone/20 p-2 text-ink disabled:opacity-70"
            />
          )}
          {(jsonError || saveError) && (
            <p className="text-[11px] text-semantic-error mt-1">
              {jsonError || 'Could not save the draft.'}
            </p>
          )}

          {pending && (
            <div className="flex items-center gap-2 mt-2">
              {canAct && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs text-bark border border-lichen rounded px-2 py-1 hover:border-bark/30 disabled:opacity-60"
                >
                  <Save size={12} aria-hidden />
                  Save
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {/* Rule-bound drafts are decided in Approvals (gated there on the
                    rule's approver permission) — the link is just navigation, so
                    it shows for any viewer. */}
                {ruleBound && (
                  <Link
                    to={approvalsHref}
                    className="inline-flex items-center gap-1 text-xs bg-bark text-parchment rounded px-2.5 py-1 hover:bg-copper-dark"
                  >
                    <ExternalLink size={12} aria-hidden />
                    Review in Approvals
                  </Link>
                )}
                {canAct && !ruleBound && (
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-xs bg-bark text-parchment rounded px-2.5 py-1 hover:bg-copper-dark disabled:opacity-60"
                  >
                    <Check size={12} aria-hidden />
                    Approve
                  </button>
                )}
                {canAct && (
                  <button
                    type="button"
                    onClick={onReject}
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-xs text-semantic-error border border-lichen rounded px-2 py-1 hover:border-semantic-error/40 disabled:opacity-60"
                  >
                    <X size={12} aria-hidden />
                    Reject
                  </button>
                )}
                {!canAct && !ruleBound && (
                  <span className="text-[11px] text-archive italic">
                    View only — you don't have permission to act on drafts.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
