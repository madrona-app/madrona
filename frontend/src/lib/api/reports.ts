/**
 * Pipeline-run telemetry, Entity History and Record Audit History.
 *
 * The report-builder half of this module (saved reports, schedules, exports)
 * was removed with the reports module — it was routed but unreachable, with
 * no nav entry and no link from anywhere in the app.
 */
import { apiFetch, buildQueryString } from './_utils';
import type { JsonValue } from '../../types/api';

export interface ReportsSummary {
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  success_rate: number;
  total_entities: number;
  active_pipelines: number;
  avg_duration_ms: number;
  period_days: number;
}

export interface DailyRunStats {
  date: string;
  total: number;
  success: number;
  failed: number;
  entities: number;
}

export interface DailyRunsResponse {
  days: DailyRunStats[];
}

export interface DatasetSummary {
  dataset_id: string;
  name: string;
  entity_count: number;
  last_run_at: string | null;
  runs_total: number;
  runs_successful: number;
  success_rate: number | null;
}

export interface DatasetsSummaryResponse {
  datasets: DatasetSummary[];
}

export async function getReportsSummary(
  organizationId: string,
  days: number = 30
): Promise<ReportsSummary> {
  const params = new URLSearchParams({ days: days.toString() });
  return await apiFetch(`/organizations/${organizationId}/reports/summary?${params}`);
}

export async function getDailyRuns(
  organizationId: string,
  days: number = 30
): Promise<DailyRunsResponse> {
  const params = new URLSearchParams({ days: days.toString() });
  return await apiFetch(`/organizations/${organizationId}/reports/runs/daily?${params}`);
}

export async function getDatasetsSummary(
  organizationId: string
): Promise<DatasetsSummaryResponse> {
  return await apiFetch(`/organizations/${organizationId}/reports/datasets/summary`);
}

// ============================================================================
// Entity History API
// ============================================================================

export interface EntityHistoryFieldDiff {
  field_name: string;
  old_value: JsonValue;
  new_value: JsonValue;
  array_delta: number | null;
}

export interface EntityHistoryEvent {
  change_id: string;
  occurred_at: string;
  event_type: 'Created' | 'Updated' | 'Deleted';
  origin_type: 'pipeline_run' | 'api' | 'manual';
  source_label: string | null;
  pipeline_name: string | null;
  dataset_name: string | null;
  run_id: string | null;
  changed_fields: string[] | null;
  old_hash: string | null;
  new_hash: string | null;
  summary: string | null;
  field_diffs: EntityHistoryFieldDiff[];
}

export interface EntityHistoryResponse {
  entity_key: string;
  items: EntityHistoryEvent[];
  next_cursor: string | null;
  has_more: boolean;
  total: number;
}

export async function getEntityHistory(
  entityKey: string,
  organizationId: string,
  params?: { limit?: number; cursor?: string }
): Promise<EntityHistoryResponse> {
  const query = buildQueryString({
    organization_id: organizationId,
    ...params,
  });
  return await apiFetch(`/entities/${encodeURIComponent(entityKey)}/history${query}`);
}

// ============================================================================
// Record Audit History API (for Collections/Workspace entities)
// ============================================================================

export interface RecordAuditFieldDiff {
  field_name: string;
  old_value: JsonValue;
  new_value: JsonValue;
}

export interface RecordAuditEvent {
  event_id: string;
  change_type: 'created' | 'updated' | 'deleted' | 'link_added' | 'link_removed' | 'link_updated';
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
  changed_fields: string[];
  summary: string | null;
  request_method: string | null;
  field_diffs?: RecordAuditFieldDiff[];
}

export interface RecordAuditHistoryResponse {
  entity_type: string;
  entity_id: string;
  items: RecordAuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Get audit history for a collections/workspace entity.
 *
 * @param organizationId - Organization UUID
 * @param entityType - Entity type (e.g., 'collection_object', 'object_entry', 'loan_in')
 * @param entityId - Entity UUID
 * @param params - Optional pagination params
 */
export async function getRecordAuditHistory(
  organizationId: string,
  entityType: string,
  entityId: string,
  params?: { limit?: number; offset?: number; include_diffs?: boolean }
): Promise<RecordAuditHistoryResponse> {
  const query = buildQueryString(params || {});
  return await apiFetch(
    `/organizations/${organizationId}/entity-history/${entityType}/${entityId}${query}`
  );
}

// Org-wide entity audit events
export interface EntityAuditEvent {
  event_id: string;
  organization_id: string;
  entity_type: string;
  entity_id: string;
  entity_display_key: string | null;
  change_type: 'created' | 'updated' | 'deleted' | 'link_added' | 'link_removed' | 'link_updated';
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
  changed_fields: string[];
  summary: string | null;
  field_diffs?: RecordAuditFieldDiff[];
}

export interface EntityAuditEventsResponse {
  items: EntityAuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export async function getEntityAuditEvents(
  organizationId: string,
  params?: {
    entity_type?: string;
    change_type?: string;
    changed_by?: string;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
  }
): Promise<EntityAuditEventsResponse> {
  const query = buildQueryString(params || {});
  return await apiFetch(
    `/organizations/${organizationId}/entity-audit-events${query}`
  );
}

export async function getEntityAuditEventDetail(
  organizationId: string,
  eventId: string
): Promise<{ event: EntityAuditEvent }> {
  return await apiFetch(
    `/organizations/${organizationId}/entity-audit-events/${eventId}`
  );
}

// ============================================================================
// REPORT BUILDER API
// ============================================================================

// --- Reports ---


// --- Report Templates ---


// --- Data Sources ---


// --- Report Schedules ---


// --- Report Runs ---


// --- Scheduled Reports ---


// --- Report Export ---

export interface ExportFormat {
  format: string;
  label: string;
  description: string;
  available: boolean;
}


