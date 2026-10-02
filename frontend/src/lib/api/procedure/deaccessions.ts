/**
 * Deaccessions API
 */
import { apiFetch, validate, buildQueryString } from '../_utils';
import { z } from 'zod';
import {
  DeaccessionSchema,
  PaginatedDeaccessionsSchema,
  DeaccessionAuditSchema,
} from '../../schemas';
import type {
  Deaccession,
  PaginatedDeaccessions,
  DeaccessionAudit,
} from '../../schemas';

export async function getDeaccessions(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    status?: string;
    reason?: string;
  }
): Promise<PaginatedDeaccessions> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/deaccessions${query}`);
  return validate(PaginatedDeaccessionsSchema, data);
}

export async function getDeaccession(
  organizationId: string,
  deaccessionId: string
): Promise<Deaccession> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/deaccessions/${deaccessionId}`);
  return validate(DeaccessionSchema, data);
}

export async function createDeaccession(
  organizationId: string,
  deaccession: Partial<Deaccession>
): Promise<Deaccession> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/deaccessions`, {
    method: 'POST',
    body: JSON.stringify(deaccession),
  });
  return validate(DeaccessionSchema, data);
}

export async function updateDeaccession(
  organizationId: string,
  deaccessionId: string,
  updates: Partial<Deaccession>
): Promise<Deaccession> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/deaccessions/${deaccessionId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(DeaccessionSchema, data);
}

export async function reviewDeaccession(
  organizationId: string,
  deaccessionId: string,
  recommendation: 'approve' | 'reject' | 'defer' | 'modify',
  note?: string
): Promise<Deaccession> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/deaccessions/${deaccessionId}/review`, {
    method: 'POST',
    body: JSON.stringify({ recommendation, note }),
  });
  return validate(DeaccessionSchema, data);
}

export async function approveDeaccession(
  organizationId: string,
  deaccessionId: string,
  boardReference?: string,
  resolution?: string
): Promise<Deaccession> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/deaccessions/${deaccessionId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ board_reference: boardReference, resolution }),
  });
  return validate(DeaccessionSchema, data);
}

export async function completeDeaccession(
  organizationId: string,
  deaccessionId: string,
  exitId?: string
): Promise<Deaccession> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/deaccessions/${deaccessionId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ exit_id: exitId }),
  });
  return validate(DeaccessionSchema, data);
}

export async function getDeaccessionAudit(
  organizationId: string,
  deaccessionId: string
): Promise<DeaccessionAudit[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/deaccessions/${deaccessionId}/audit`);
  return z.array(DeaccessionAuditSchema).parse(data);
}

export async function rollbackDeaccession(
  organizationId: string,
  deaccessionId: string,
  targetStatus: string,
  reason: string
): Promise<Deaccession> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/deaccessions/${deaccessionId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ target_status: targetStatus, reason }),
  });
  return validate(DeaccessionSchema, data);
}

export async function deleteDeaccession(
  organizationId: string,
  deaccessionId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/deaccessions/${deaccessionId}`, {
    method: 'DELETE',
  });
}
