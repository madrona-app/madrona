/**
 * Report Templates API — upload/list/delete/download custom HTML templates.
 */
import { apiFetch, API_BASE_URL } from './_utils';

export interface ReportTemplate {
  name: string;
  size: number;
  last_modified: string | null;
}

interface ListTemplatesResponse {
  templates: ReportTemplate[];
}

export async function listReportTemplates(orgId: string): Promise<ReportTemplate[]> {
  const data = await apiFetch<ListTemplatesResponse>(
    `/organizations/${orgId}/report-templates`,
  );
  return data.templates;
}

export async function uploadReportTemplate(orgId: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);

  await apiFetch(`/organizations/${orgId}/report-templates`, {
    method: 'POST',
    body: formData,
  });
}

export async function deleteReportTemplate(orgId: string, filename: string): Promise<void> {
  await apiFetch(`/organizations/${orgId}/report-templates/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
}

export function getReportTemplateDownloadUrl(orgId: string, filename: string): string {
  return `${API_BASE_URL}/organizations/${orgId}/report-templates/${encodeURIComponent(filename)}`;
}

export function getDefaultTemplateDownloadUrl(orgId: string, templateName: string): string {
  return `${API_BASE_URL}/organizations/${orgId}/report-templates/default/${encodeURIComponent(templateName)}`;
}
