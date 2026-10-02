import { apiFetch, buildQueryString } from './_utils';

// ── Types ──────────────────────────────────────────────────────────

export type RiskLevel = 'critical' | 'high' | 'moderate' | 'low' | 'unknown';
export type VerificationStatus = 'verified' | 'unverified' | 'mismatch' | 'missing';

export interface FormatRiskEntry {
  risk_level: RiskLevel;
  format_name: string;
  pronom_puid: string;
  count: number;
}

export interface FormatRiskSummaryResponse {
  formats: FormatRiskEntry[];
}

export interface AtRiskMediaItem {
  media_id: string;
  filename: string;
  mime_type: string;
  pronom_puid: string;
  format_name: string;
  format_risk_level: 'high' | 'critical';
  file_size: number;
  created_at: string;
}

export interface AtRiskMediaResponse {
  items: AtRiskMediaItem[];
  total: number;
  page: { limit: number; offset: number; has_more: boolean };
}

export interface ReplicationSummary {
  total_media: number;
  replicated_media: number;
  unreplicated_media: number;
  coverage_percent: number;
  by_verification_status: Record<VerificationStatus, number>;
}

export interface PreservationPolicy {
  policy_id: string;
  organization_id: string;
  name: string;
  description: string | null;
  policy_type: 'retention' | 'format_migration' | 'normalization' | 'fixity_schedule';
  scope: Record<string, unknown>;
  rules: Record<string, unknown>;
  is_active: boolean;
  priority: number;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionPlan {
  action_id: string;
  organization_id: string;
  policy_id: string;
  media_id: string;
  action_type: 'migrate_format' | 'review_retention' | 'delete' | 'archive';
  detail: Record<string, unknown>;
  status: 'pending' | 'approved' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  result: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
}

export interface ActionPlansResponse {
  items: ActionPlan[];
  total: number;
  page: { limit: number; offset: number; has_more: boolean };
}

export interface PreservationEvent {
  event_id: string;
  organization_id: string;
  event_type: string;
  media_id: string | null;
  outcome: 'success' | 'failure' | 'warning';
  outcome_detail: string | null;
  detail: Record<string, unknown>;
  agent_type: 'software' | 'person' | 'organization';
  agent_name: string;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  created_at: string;
}

export interface PreservationEventsResponse {
  items: PreservationEvent[];
  total: number;
  page: { limit: number; offset: number; has_more: boolean };
}

export interface ReplicationRecord {
  record_id: string;
  organization_id: string;
  media_id: string;
  storage_location: string;
  storage_provider: string;
  storage_region: string;
  storage_key: string;
  copy_type: 'primary' | 'backup' | 'archive';
  checksum_sha256: string | null;
  last_verified_at: string | null;
  verification_status: VerificationStatus;
  created_at: string;
}

export interface InformationPackage {
  package_id: string;
  organization_id: string;
  media_id: string;
  package_type: 'SIP' | 'AIP' | 'DIP';
  status: string;
  structure: Record<string, unknown>;
  provenance_event_ids: string[];
  export_profile_id: string | null;
  external_identifier: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

// ── Mutation payloads ─────────────────────────────────────────────

export interface CreatePolicyPayload {
  name: string;
  policy_type: PreservationPolicy['policy_type'];
  description?: string | null;
  scope?: Record<string, unknown>;
  rules?: Record<string, unknown>;
  is_active?: boolean;
  priority?: number;
}

export interface UpdatePolicyPayload {
  name?: string;
  description?: string | null;
  scope?: Record<string, unknown>;
  rules?: Record<string, unknown>;
  is_active?: boolean;
  priority?: number;
}

// ── API functions ──────────────────────────────────────────────────

export async function getFormatRiskSummary(orgId: string): Promise<FormatRiskSummaryResponse> {
  return apiFetch(`/organizations/${orgId}/preservation/format-risk-summary`);
}

export async function getAtRiskMedia(
  orgId: string,
  params?: { limit?: number; offset?: number },
): Promise<AtRiskMediaResponse> {
  const query = buildQueryString(params || {});
  return apiFetch(`/organizations/${orgId}/preservation/at-risk-media${query}`);
}

export async function getReplicationSummary(orgId: string): Promise<ReplicationSummary> {
  return apiFetch(`/organizations/${orgId}/preservation/replication-summary`);
}

export async function getPreservationPolicies(orgId: string): Promise<{ policies: PreservationPolicy[] }> {
  return apiFetch(`/organizations/${orgId}/preservation/policies`);
}

export async function getActionPlans(
  orgId: string,
  params?: { status?: string; action_type?: string; limit?: number; offset?: number },
): Promise<ActionPlansResponse> {
  const query = buildQueryString(params || {});
  return apiFetch(`/organizations/${orgId}/preservation/action-plans${query}`);
}

export async function approveActionPlan(orgId: string, actionId: string): Promise<void> {
  return apiFetch(`/organizations/${orgId}/preservation/action-plans/${actionId}/approve`, {
    method: 'POST',
  });
}

export async function cancelActionPlan(orgId: string, actionId: string): Promise<void> {
  return apiFetch(`/organizations/${orgId}/preservation/action-plans/${actionId}/cancel`, {
    method: 'POST',
  });
}

export async function getMediaPreservationEvents(
  orgId: string,
  mediaId: string,
  params?: { limit?: number; offset?: number },
): Promise<PreservationEventsResponse> {
  const query = buildQueryString(params || {});
  return apiFetch(`/organizations/${orgId}/media/${mediaId}/preservation-events${query}`);
}

export async function getMediaReplicas(
  orgId: string,
  mediaId: string,
): Promise<{ replicas: ReplicationRecord[] }> {
  return apiFetch(`/organizations/${orgId}/media/${mediaId}/replicas`);
}

export async function getMediaInfoPackages(
  orgId: string,
  mediaId: string,
): Promise<{ items: InformationPackage[] }> {
  return apiFetch(`/organizations/${orgId}/media/${mediaId}/information-packages`);
}

export async function getAIPManifest(
  orgId: string,
  mediaId: string,
): Promise<Record<string, unknown>> {
  return apiFetch(`/organizations/${orgId}/media/${mediaId}/aip-manifest`);
}

export async function createPreservationPolicy(
  orgId: string,
  data: CreatePolicyPayload,
): Promise<PreservationPolicy> {
  return apiFetch(`/organizations/${orgId}/preservation/policies`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePreservationPolicy(
  orgId: string,
  policyId: string,
  data: UpdatePolicyPayload,
): Promise<PreservationPolicy> {
  return apiFetch(`/organizations/${orgId}/preservation/policies/${policyId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deactivatePreservationPolicy(
  orgId: string,
  policyId: string,
): Promise<{ message: string }> {
  return apiFetch(`/organizations/${orgId}/preservation/policies/${policyId}`, {
    method: 'DELETE',
  });
}
