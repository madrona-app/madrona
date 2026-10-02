/**
 * Conservation Treatments API
 */
import { apiFetch, validate, buildQueryString } from '../_utils';
import {
  ConservationTreatmentSchema,
  PaginatedConservationTreatmentsSchema,
} from '../../schemas';
import type {
  ConservationTreatment,
  PaginatedConservationTreatments,
} from '../../schemas';

export async function getConservationTreatments(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    object_id?: string;
    status?: string;
    treatment_type?: string;
  }
): Promise<PaginatedConservationTreatments> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/conservation${query}`);
  return validate(PaginatedConservationTreatmentsSchema, data);
}

export async function getConservationTreatment(
  organizationId: string,
  treatmentId: string
): Promise<ConservationTreatment> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/conservation/${treatmentId}`);
  return validate(ConservationTreatmentSchema, data);
}

export async function createConservationTreatment(
  organizationId: string,
  treatment: Partial<ConservationTreatment>
): Promise<ConservationTreatment> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/conservation`, {
    method: 'POST',
    body: JSON.stringify(treatment),
  });
  return validate(ConservationTreatmentSchema, data);
}

export async function updateConservationTreatment(
  organizationId: string,
  treatmentId: string,
  updates: Partial<ConservationTreatment>
): Promise<ConservationTreatment> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/conservation/${treatmentId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ConservationTreatmentSchema, data);
}

export async function approveConservationTreatment(
  organizationId: string,
  treatmentId: string,
  note?: string
): Promise<ConservationTreatment> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/conservation/${treatmentId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
  return validate(ConservationTreatmentSchema, data);
}

export async function startConservationTreatment(
  organizationId: string,
  treatmentId: string,
  startDate?: string
): Promise<ConservationTreatment> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/conservation/${treatmentId}/start`, {
    method: 'POST',
    body: JSON.stringify({ start_date: startDate }),
  });
  return validate(ConservationTreatmentSchema, data);
}

export async function completeConservationTreatment(
  organizationId: string,
  treatmentId: string,
  endDate?: string
): Promise<ConservationTreatment> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/conservation/${treatmentId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ end_date: endDate }),
  });
  return validate(ConservationTreatmentSchema, data);
}

export async function deleteConservationTreatment(
  organizationId: string,
  treatmentId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/conservation/${treatmentId}`, {
    method: 'DELETE',
  });
}
