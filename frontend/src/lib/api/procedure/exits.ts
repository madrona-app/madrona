/**
 * Object Exits API
 */
import { apiFetch, validate, buildQueryString } from '../_utils';
import {
  ObjectExitSchema,
  PaginatedObjectExitsSchema,
} from '../../schemas';
import type {
  ObjectExit,
  PaginatedObjectExits,
} from '../../schemas';

export async function getObjectExits(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    status?: string;
    exit_reason?: string;
    entry_id?: string;
    reference_type?: string;
    reference_id?: string;
  }
): Promise<PaginatedObjectExits> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/exits${query}`);
  return validate(PaginatedObjectExitsSchema, data);
}

export async function getObjectExit(
  organizationId: string,
  exitId: string
): Promise<ObjectExit> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/exits/${exitId}`);
  return validate(ObjectExitSchema, data);
}

export async function createObjectExit(
  organizationId: string,
  exit: Partial<ObjectExit>
): Promise<ObjectExit> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/exits`, {
    method: 'POST',
    body: JSON.stringify(exit),
  });
  return validate(ObjectExitSchema, data);
}

export async function updateObjectExit(
  organizationId: string,
  exitId: string,
  updates: Partial<ObjectExit>
): Promise<ObjectExit> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/exits/${exitId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ObjectExitSchema, data);
}

export async function dispatchObjectExit(
  organizationId: string,
  exitId: string
): Promise<ObjectExit> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/exits/${exitId}/dispatch`, {
    method: 'POST',
  });
  return validate(ObjectExitSchema, data);
}

export async function acknowledgeObjectExit(
  organizationId: string,
  exitId: string,
  acknowledgedBy?: string,
  reference?: string
): Promise<ObjectExit> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/exits/${exitId}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ acknowledged_by: acknowledgedBy, reference }),
  });
  return validate(ObjectExitSchema, data);
}

export async function rollbackObjectExit(
  organizationId: string,
  exitId: string,
  targetStatus: string,
  reason: string
): Promise<ObjectExit> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/exits/${exitId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ target_status: targetStatus, reason }),
  });
  return validate(ObjectExitSchema, data);
}

export async function deleteObjectExit(
  organizationId: string,
  exitId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/exits/${exitId}`, {
    method: 'DELETE',
  });
}
