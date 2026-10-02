/**
 * Condition Reports API
 */
import { apiFetch, validate, buildQueryString } from '../_utils';
import {
  ConditionReportSchema,
  PaginatedConditionReportsSchema,
} from '../../schemas';
import type {
  ConditionReport,
  PaginatedConditionReports,
} from '../../schemas';

export async function getConditionReports(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    object_id?: string;
    report_type?: string;
    status?: string;
  }
): Promise<PaginatedConditionReports> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/condition-reports${query}`);
  return validate(PaginatedConditionReportsSchema, data);
}

export async function getConditionReport(
  organizationId: string,
  reportId: string
): Promise<ConditionReport> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/condition-reports/${reportId}`);
  return validate(ConditionReportSchema, data);
}

export async function createConditionReport(
  organizationId: string,
  report: Partial<ConditionReport>
): Promise<ConditionReport> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/condition-reports`, {
    method: 'POST',
    body: JSON.stringify(report),
  });
  return validate(ConditionReportSchema, data);
}

export async function updateConditionReport(
  organizationId: string,
  reportId: string,
  updates: Partial<ConditionReport>
): Promise<ConditionReport> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/condition-reports/${reportId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ConditionReportSchema, data);
}

export async function completeConditionReport(
  organizationId: string,
  reportId: string
): Promise<ConditionReport> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/condition-reports/${reportId}/complete`, {
    method: 'POST',
  });
  return validate(ConditionReportSchema, data);
}

export async function reviewConditionReport(
  organizationId: string,
  reportId: string
): Promise<ConditionReport> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/condition-reports/${reportId}/review`, {
    method: 'POST',
  });
  return validate(ConditionReportSchema, data);
}

export async function getObjectConditionReports(
  organizationId: string,
  objectId: string
): Promise<PaginatedConditionReports> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/condition-reports?object_id=${objectId}`);
  return validate(PaginatedConditionReportsSchema, data);
}

export async function deleteConditionReport(
  organizationId: string,
  reportId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/condition-reports/${reportId}`, {
    method: 'DELETE',
  });
}
