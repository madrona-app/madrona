/**
 * Acquisitions API (including Acquisition Objects)
 */
import { apiFetch, validate, buildQueryString } from '../_utils';
import {
  AcquisitionSchema,
  PaginatedAcquisitionsSchema,
} from '../../schemas';
import type {
  Acquisition,
  PaginatedAcquisitions,
} from '../../schemas';

export async function getAcquisitions(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    status?: string;
    acquisition_method?: string;
    entry_id?: string;
  }
): Promise<PaginatedAcquisitions> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/acquisitions${query}`);
  return validate(PaginatedAcquisitionsSchema, data);
}

export async function getAcquisition(
  organizationId: string,
  acquisitionId: string
): Promise<Acquisition> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/acquisitions/${acquisitionId}`);
  return validate(AcquisitionSchema, data);
}

export async function createAcquisition(
  organizationId: string,
  acquisition: Partial<Acquisition>
): Promise<Acquisition> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/acquisitions`, {
    method: 'POST',
    body: JSON.stringify(acquisition),
  });
  return validate(AcquisitionSchema, data);
}

export async function updateAcquisition(
  organizationId: string,
  acquisitionId: string,
  updates: Partial<Acquisition>
): Promise<Acquisition> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/acquisitions/${acquisitionId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(AcquisitionSchema, data);
}

export async function approveAcquisition(
  organizationId: string,
  acquisitionId: string,
  note?: string
): Promise<Acquisition> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/acquisitions/${acquisitionId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
  return validate(AcquisitionSchema, data);
}

export async function completeAcquisition(
  organizationId: string,
  acquisitionId: string
): Promise<Acquisition> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/acquisitions/${acquisitionId}/complete`, {
    method: 'POST',
  });
  return validate(AcquisitionSchema, data);
}

export async function rollbackAcquisition(
  organizationId: string,
  acquisitionId: string,
  targetStatus: string,
  reason: string
): Promise<Acquisition> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/acquisitions/${acquisitionId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ target_status: targetStatus, reason }),
  });
  return validate(AcquisitionSchema, data);
}

export async function deleteAcquisition(
  organizationId: string,
  acquisitionId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/acquisitions/${acquisitionId}`, {
    method: 'DELETE',
  });
}

// Acquisition Objects (link/unlink)
export interface AcquisitionObjectLink {
  acquisition_object_id: string;
  acquisition_id: string;
  object_id: string;
  organization_id: string;
  note: string | null;
  created_at: string | null;
  object?: {
    object_id: string;
    object_number: string;
    title: string | null;
    object_name: string | null;
    object_status?: string;
  };
}

export async function getAcquisitionObjects(
  organizationId: string,
  acquisitionId: string
): Promise<{ objects: AcquisitionObjectLink[]; total: number }> {
  return await apiFetch(`/organizations/${organizationId}/collections/acquisitions/${acquisitionId}/objects`);
}

export async function linkAcquisitionObject(
  organizationId: string,
  acquisitionId: string,
  objectId: string,
  note?: string
): Promise<AcquisitionObjectLink> {
  return await apiFetch(`/organizations/${organizationId}/collections/acquisitions/${acquisitionId}/objects`, {
    method: 'POST',
    body: JSON.stringify({ object_id: objectId, note }),
  });
}

export async function unlinkAcquisitionObject(
  organizationId: string,
  acquisitionId: string,
  objectId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/acquisitions/${acquisitionId}/objects/${objectId}`, {
    method: 'DELETE',
  });
}

export async function getObjectAcquisition(
  organizationId: string,
  objectId: string
): Promise<{ acquisition: Acquisition | null; link?: AcquisitionObjectLink }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/acquisition`);
}

export async function setObjectAcquisition(
  organizationId: string,
  objectId: string,
  acquisitionId: string | null,
  note?: string
): Promise<{ acquisition: Acquisition | null; link?: AcquisitionObjectLink }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/acquisition`, {
    method: 'PUT',
    body: JSON.stringify({ acquisition_id: acquisitionId, note }),
  });
}
