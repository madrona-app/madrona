/**
 * On-Demand Reports API
 *
 * Provides endpoints for generating, tracking, and downloading
 * on-demand reports from search results, workspaces, or individual records.
 */
import { apiFetch, buildQueryString } from './_utils';

// ============================================================================
// TYPES
// ============================================================================

export type ReportContextType = 'search' | 'workspace' | 'record';
export type ReportFormat = 'csv' | 'excel' | 'pdf';
export type ReportRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AvailableReport {
  report_key: string;
  name: string;
  description: string;
  category: string;
  style: 'tabular' | 'document';
  supported_formats: ReportFormat[];
  default_format: ReportFormat;
}

export interface AvailableReportsResponse {
  reports: AvailableReport[];
  total: number;
}

export interface GenerateReportRequest {
  report_key: string;
  context_type: ReportContextType;
  context_params: Record<string, unknown>;
  export_format?: ReportFormat;
}

export interface GenerateReportResponse {
  run_id: string;
  status: ReportRunStatus;
  report_key: string;
  export_format: ReportFormat;
}

export interface ReportRun {
  run_id: string;
  report_key: string | null;
  context_type: string | null;
  status: ReportRunStatus;
  triggered_by: string;
  export_format: string | null;
  row_count: number | null;
  execution_time_ms: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  has_download: boolean;
}

export interface ReportRunsResponse {
  items: ReportRun[];
  total: number;
  limit: number;
  offset: number;
}

export interface DownloadResponse {
  download_url: string;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * List available on-demand reports for a given context.
 */
export async function getAvailableReports(
  orgId: string,
  contextType: ReportContextType,
  recordType?: string,
): Promise<AvailableReportsResponse> {
  const qs = buildQueryString({
    context_type: contextType,
    record_type: recordType,
  });
  return apiFetch<AvailableReportsResponse>(
    `/organizations/${orgId}/on-demand-reports/available${qs}`,
  );
}

/**
 * Trigger generation of an on-demand report.
 * Returns immediately with a run_id; generation happens async via Celery.
 */
export async function generateReport(
  orgId: string,
  request: GenerateReportRequest,
): Promise<GenerateReportResponse> {
  return apiFetch<GenerateReportResponse>(
    `/organizations/${orgId}/on-demand-reports/generate`,
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
  );
}

/**
 * List the current user's on-demand report runs.
 */
export async function getReportRuns(
  orgId: string,
  params?: {
    status?: ReportRunStatus;
    limit?: number;
    offset?: number;
  },
): Promise<ReportRunsResponse> {
  const qs = buildQueryString(params || {});
  return apiFetch<ReportRunsResponse>(
    `/organizations/${orgId}/on-demand-reports/runs${qs}`,
  );
}

/**
 * Get a single report run's status and details.
 */
export async function getReportRun(
  orgId: string,
  runId: string,
): Promise<ReportRun> {
  return apiFetch<ReportRun>(
    `/organizations/${orgId}/on-demand-reports/runs/${runId}`,
  );
}

/**
 * Get a download URL for a completed report.
 */
export async function getReportDownloadUrl(
  orgId: string,
  runId: string,
): Promise<DownloadResponse> {
  return apiFetch<DownloadResponse>(
    `/organizations/${orgId}/on-demand-reports/runs/${runId}/download`,
  );
}

/**
 * Cancel a pending or running report run.
 */
export async function cancelReportRun(
  orgId: string,
  runId: string,
): Promise<ReportRun> {
  return apiFetch<ReportRun>(
    `/organizations/${orgId}/on-demand-reports/runs/${runId}/cancel`,
    { method: 'POST' },
  );
}

/**
 * Dismiss a completed/failed/cancelled report run from the panel.
 */
export async function dismissReportRun(
  orgId: string,
  runId: string,
): Promise<ReportRun> {
  return apiFetch<ReportRun>(
    `/organizations/${orgId}/on-demand-reports/runs/${runId}/dismiss`,
    { method: 'POST' },
  );
}

/**
 * Convenience: trigger download of a completed report in the browser.
 */
export async function downloadReport(
  orgId: string,
  runId: string,
): Promise<void> {
  const { download_url } = await getReportDownloadUrl(orgId, runId);
  const win = window.open(download_url, '_blank');
  if (!win) {
    const link = document.createElement('a');
    link.href = download_url;
    link.download = '';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
