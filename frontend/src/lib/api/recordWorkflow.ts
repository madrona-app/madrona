/**
 * Record flags, completeness rules and the record review workflow (Collections).
 */
import { apiFetch } from './_utils';

export interface RecordFlagDefinition {
  flag_id: string;
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  is_rule_managed: boolean;
}

export interface ObjectFlagValue {
  flag_id: string;
  key: string;
  label: string;
  source: 'manual' | 'rule';
  note: string | null;
  set_at: string | null;
  set_by: string | null;
}

export type RequirementCheck = 'present' | 'equals' | 'one_of';

export interface RuleRequirement {
  field: string;
  check: RequirementCheck;
  value?: string | string[];
}

export interface CompletenessRule {
  rule_id: string;
  name: string;
  description: string | null;
  requirements: RuleRequirement[];
  flag_id: string;
  flag_label: string | null;
  required_for_publication: boolean;
  is_active: boolean;
}

export interface CheckableField {
  field: string;
  label: string;
  checks: RequirementCheck[];
}

export interface CompletenessResult {
  rule_id: string;
  name: string;
  flag_label: string | null;
  required_for_publication: boolean;
  met: boolean;
  missing: string[];
}

export interface RecordReview {
  review_id: string;
  object_id: string;
  status: 'pending' | 'approved' | 'changes_requested' | 'cancelled';
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: string | null;
  request_note: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface Reviewer {
  user_id: string;
  name: string;
}

const base = (orgId: string) => `/organizations/${orgId}/collections`;

// ── Flag definitions ────────────────────────────────────────────────────────
export async function listRecordFlags(orgId: string): Promise<RecordFlagDefinition[]> {
  const data = await apiFetch<{ items: RecordFlagDefinition[] }>(`${base(orgId)}/settings/record-flags`);
  return data.items;
}

export function createRecordFlag(orgId: string, body: Partial<RecordFlagDefinition>) {
  return apiFetch<RecordFlagDefinition>(`${base(orgId)}/settings/record-flags`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateRecordFlag(orgId: string, flagId: string, body: Partial<RecordFlagDefinition>) {
  return apiFetch<RecordFlagDefinition>(`${base(orgId)}/settings/record-flags/${flagId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function deleteRecordFlag(orgId: string, flagId: string) {
  return apiFetch<{ deleted: boolean; removed_from_records: number }>(
    `${base(orgId)}/settings/record-flags/${flagId}`,
    { method: 'DELETE' },
  );
}

// ── Flags on an object ──────────────────────────────────────────────────────
export async function getObjectFlags(orgId: string, objectId: string): Promise<ObjectFlagValue[]> {
  const data = await apiFetch<{ items: ObjectFlagValue[] }>(`${base(orgId)}/objects/${objectId}/flags`);
  return data.items;
}

export async function setObjectFlags(orgId: string, objectId: string, flagIds: string[]): Promise<ObjectFlagValue[]> {
  const data = await apiFetch<{ items: ObjectFlagValue[] }>(`${base(orgId)}/objects/${objectId}/flags`, {
    method: 'PUT',
    body: JSON.stringify({ flag_ids: flagIds }),
  });
  return data.items;
}

// ── Completeness rules ──────────────────────────────────────────────────────
export function listCompletenessRules(orgId: string) {
  return apiFetch<{ items: CompletenessRule[]; fields: CheckableField[] }>(`${base(orgId)}/settings/completeness-rules`);
}

export function createCompletenessRule(orgId: string, body: Partial<CompletenessRule>) {
  return apiFetch<CompletenessRule>(`${base(orgId)}/settings/completeness-rules`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateCompletenessRule(orgId: string, ruleId: string, body: Partial<CompletenessRule>) {
  return apiFetch<CompletenessRule>(`${base(orgId)}/settings/completeness-rules/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function deleteCompletenessRule(orgId: string, ruleId: string) {
  return apiFetch<{ deleted: boolean }>(`${base(orgId)}/settings/completeness-rules/${ruleId}`, { method: 'DELETE' });
}

export function recomputeCompleteness(orgId: string) {
  return apiFetch<{ records_checked: number }>(`${base(orgId)}/settings/completeness-rules/recompute`, {
    method: 'POST',
  });
}

export async function getObjectCompleteness(orgId: string, objectId: string): Promise<CompletenessResult[]> {
  const data = await apiFetch<{ items: CompletenessResult[] }>(`${base(orgId)}/objects/${objectId}/completeness`);
  return data.items;
}

// ── Reviews ─────────────────────────────────────────────────────────────────
export async function listReviewers(orgId: string): Promise<Reviewer[]> {
  const data = await apiFetch<{ items: Reviewer[] }>(`${base(orgId)}/reviewers`);
  return data.items;
}

export function getObjectReviews(orgId: string, objectId: string) {
  return apiFetch<{ cataloging_status: string | null; items: RecordReview[]; can_decide_admin: boolean }>(
    `${base(orgId)}/objects/${objectId}/reviews`,
  );
}

export function submitForReview(orgId: string, objectId: string, reviewerId: string, note: string) {
  return apiFetch<RecordReview>(`${base(orgId)}/objects/${objectId}/reviews`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_id: reviewerId, note }),
  });
}

export function decideReview(orgId: string, reviewId: string, decision: 'approved' | 'changes_requested', note: string) {
  return apiFetch<RecordReview>(`${base(orgId)}/record-reviews/${reviewId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, note }),
  });
}

export function cancelReview(orgId: string, reviewId: string) {
  return apiFetch<RecordReview>(`${base(orgId)}/record-reviews/${reviewId}/cancel`, { method: 'POST' });
}

export const CATALOGING_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  pending_review: 'In review',
  needs_research: 'Needs research',
  cataloged: 'Cataloged',
};

export const REVIEW_STATUS_LABELS: Record<RecordReview['status'], string> = {
  pending: 'Waiting for review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  cancelled: 'Cancelled',
};
