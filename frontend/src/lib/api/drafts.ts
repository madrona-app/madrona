import { apiFetch } from './_utils';

export type DraftStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'superseded'
  | 'cancelled'
  | 'expired';

export interface AgentDraft {
  draft_id: string;
  entity_type: string;
  intended_action: string;
  status: DraftStatus;
  payload: Record<string, unknown>;
  rationale: string | null;
  citations: Array<Record<string, unknown>> | null;
  target_entity_id: string | null;
  proposed_by_user_id: string;
  proposed_by_persona: string | null;
  plan_id: string | null;
  plan_step_id: string | null;
  conversation_id: string | null;
  approval_request_id: string | null;
  applied_entity_id: string | null;
  apply_error: string | null;
  model_provider: string | null;
  model_id: string | null;
  procedure: ProcedureValidation | null;
  created_at: string | null;
  decided_at: string | null;
}

/** One editable field in a draft's generated form. */
export interface DraftFormField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'enum' | 'date' | 'number' | 'boolean' | 'json' | 'reference';
  required: boolean;
  enum_values: string[] | null;
  section: string;
  lookup_category: string | null;
  /** For type='reference': which entity kind to pick/resolve. */
  reference_kind: 'object' | 'constituent' | 'location' | 'user' | null;
}

/** Resolve referenced-entity ids to display labels (so the form shows names, not UUIDs). */
export function resolveRefs(
  orgId: string,
  refs: Array<{ kind: string; id: string }>,
): Promise<{ labels: Record<string, string> }> {
  return apiFetch(`/organizations/${orgId}/drafts/resolve-refs`, {
    method: 'POST',
    body: JSON.stringify({ refs }),
  });
}

/** Field shape for editing a draft payload as a form instead of raw JSON. */
export interface DraftFormSchema {
  entity_type: string;
  entity_label: string;
  fields: DraftFormField[];
}

export function getDraftFormSchema(
  orgId: string,
  entityType: string,
): Promise<DraftFormSchema> {
  return apiFetch(
    `/organizations/${orgId}/drafts/form-schema?entity_type=${encodeURIComponent(entityType)}`,
  );
}

/** Pre-approval procedure validation summary attached to a draft (§7 trust). */
export interface ProcedureValidation {
  procedure_type: string;
  procedure_label: string;
  procedure: string;
  evaluated_status: string;
  blocking_total: number;
  blocking_met: number;
  passed: boolean;
  missing: Array<{ id: string; label: string }>;
}

export async function listDrafts(
  orgId: string,
  opts?: { status?: DraftStatus; mine?: boolean },
): Promise<{ drafts: AgentDraft[] }> {
  const p = new URLSearchParams();
  if (opts?.status) p.append('status', opts.status);
  if (opts?.mine) p.append('mine', 'true');
  const q = p.toString();
  return apiFetch(`/organizations/${orgId}/drafts${q ? `?${q}` : ''}`);
}

export async function patchDraft(
  orgId: string,
  draftId: string,
  payload: Record<string, unknown>,
): Promise<AgentDraft> {
  return apiFetch(`/organizations/${orgId}/drafts/${draftId}`, {
    method: 'PATCH',
    body: JSON.stringify({ payload }),
  });
}

export async function approveDraft(orgId: string, draftId: string): Promise<AgentDraft> {
  return apiFetch(`/organizations/${orgId}/drafts/${draftId}/approve`, {
    method: 'POST',
  });
}

export async function rejectDraft(
  orgId: string,
  draftId: string,
  note?: string,
): Promise<AgentDraft> {
  return apiFetch(`/organizations/${orgId}/drafts/${draftId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note: note ?? null }),
  });
}
