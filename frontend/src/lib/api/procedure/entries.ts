/**
 * Object Entries API (including media)
 */
import { apiFetch, validate, buildQueryString } from '../_utils';
import {
  ObjectEntrySchema,
  PaginatedObjectEntriesSchema,
} from '../../schemas';
import type {
  ObjectEntry,
  PaginatedObjectEntries,
  LoanIn,
} from '../../schemas';

export async function getObjectEntries(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    status?: string;
    reason?: string;
  }
): Promise<PaginatedObjectEntries> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/entries${query}`);
  return validate(PaginatedObjectEntriesSchema, data);
}

export async function getObjectEntry(
  organizationId: string,
  entryId: string
): Promise<ObjectEntry> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/entries/${entryId}`);
  return validate(ObjectEntrySchema, data);
}

export async function createObjectEntry(
  organizationId: string,
  entry: Partial<ObjectEntry>
): Promise<ObjectEntry> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/entries`, {
    method: 'POST',
    body: JSON.stringify(entry),
  });
  return validate(ObjectEntrySchema, data);
}

export async function updateObjectEntry(
  organizationId: string,
  entryId: string,
  updates: Partial<ObjectEntry>
): Promise<ObjectEntry> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/entries/${entryId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ObjectEntrySchema, data);
}

/**
 * Object Exit Note 1 alternative: mark the entry as returned via a
 * second signature on the entry form, without creating a separate Object Exit
 * record. Used for simple returns of unaccessioned deposits.
 */
export async function markObjectEntryReturned(
  organizationId: string,
  entryId: string,
  data?: {
    return_date?: string;
    returned_to?: string;
    signature_reference?: string;
    outcome_note?: string;
  }
): Promise<ObjectEntry> {
  const response = await apiFetch(
    `/organizations/${organizationId}/collections/entries/${entryId}/mark-returned`,
    {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }
  );
  return validate(ObjectEntrySchema, response);
}

export async function receiveObjectEntry(
  organizationId: string,
  entryId: string
): Promise<ObjectEntry> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/entries/${entryId}/receive`, {
    method: 'POST',
  });
  return validate(ObjectEntrySchema, data);
}

export async function processObjectEntry(
  organizationId: string,
  entryId: string
): Promise<ObjectEntry> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/entries/${entryId}/process`, {
    method: 'POST',
  });
  return validate(ObjectEntrySchema, data);
}

export async function returnObjectEntry(
  organizationId: string,
  entryId: string,
  returnedTo?: string
): Promise<ObjectEntry> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/entries/${entryId}/return`, {
    method: 'POST',
    body: JSON.stringify({ returned_to: returnedTo }),
  });
  return validate(ObjectEntrySchema, data);
}

export async function accessionObjectEntry(
  organizationId: string,
  entryId: string,
  acquisitionId: string
): Promise<ObjectEntry> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/entries/${entryId}/accession`, {
    method: 'POST',
    body: JSON.stringify({ acquisition_id: acquisitionId }),
  });
  return validate(ObjectEntrySchema, data);
}

export async function deleteObjectEntry(
  organizationId: string,
  entryId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/entries/${entryId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// OBJECT ENTRY ITEMS (per-item CRUD)
// ============================================================================

export interface ObjectEntryItemInput {
  brief_description?: string | null;
  detailed_description?: string | null;
  lender_object_number?: string | null;
  declared_value?: number | null;
  declared_value_currency?: string | null;
  condition_note?: string | null;
  condition_report_id?: string | null;
  location_id?: string | null;
  item_status?: string | null;
  item_outcome?: string | null;
  item_outcome_note?: string | null;
}

export async function addObjectEntryItem(
  organizationId: string,
  entryId: string,
  data: ObjectEntryItemInput
): Promise<Record<string, unknown>> {
  return await apiFetch(
    `/organizations/${organizationId}/collections/entries/${entryId}/items`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
}

export async function updateObjectEntryItem(
  organizationId: string,
  entryId: string,
  entryItemId: string,
  data: ObjectEntryItemInput
): Promise<Record<string, unknown>> {
  return await apiFetch(
    `/organizations/${organizationId}/collections/entries/${entryId}/items/${entryItemId}`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    }
  );
}

export async function removeObjectEntryItem(
  organizationId: string,
  entryId: string,
  entryItemId: string
): Promise<{ success: boolean }> {
  return await apiFetch(
    `/organizations/${organizationId}/collections/entries/${entryId}/items/${entryItemId}`,
    {
      method: 'DELETE',
    }
  );
}

// Object Entry Item Media
export interface ObjectEntryItemMediaItem {
  media_id: string;
  entry_item_id: string;
  filename: string;
  media_type: string;
  mime_type: string;
  thumbnail_url: string | null;
  preview_url: string | null;
  is_primary: boolean;
  sort_order: number;
  caption: string | null;
  usage_type: string | null;
  /** Rights-derived download gate; present when the caller is authenticated. */
  download_access?: 'direct' | 'request' | 'blocked' | null;
  /** Only present on the aggregated endpoint */
  item_number?: number | null;
  item_description?: string | null;
}

/**
 * Aggregated media across every item on an entry — used for the slideshow rail.
 */
export async function getObjectEntryAllMedia(
  organizationId: string,
  entryId: string
): Promise<{ media: ObjectEntryItemMediaItem[]; count: number }> {
  return await apiFetch(`/organizations/${organizationId}/collections/entries/${entryId}/media`);
}

export async function getObjectEntryItemMedia(
  organizationId: string,
  entryId: string,
  entryItemId: string
): Promise<{ media: ObjectEntryItemMediaItem[]; count: number }> {
  return await apiFetch(
    `/organizations/${organizationId}/collections/entries/${entryId}/items/${entryItemId}/media`
  );
}

export async function addObjectEntryItemMedia(
  organizationId: string,
  entryId: string,
  entryItemId: string,
  data: { media_id: string; caption?: string; usage_type?: string; is_primary?: boolean }
): Promise<{ message: string; media_id: string }> {
  return await apiFetch(
    `/organizations/${organizationId}/collections/entries/${entryId}/items/${entryItemId}/media`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
}

export async function removeObjectEntryItemMedia(
  organizationId: string,
  entryId: string,
  entryItemId: string,
  mediaId: string
): Promise<{ message: string }> {
  return await apiFetch(
    `/organizations/${organizationId}/collections/entries/${entryId}/items/${entryItemId}/media/${mediaId}`,
    {
      method: 'DELETE',
    }
  );
}

export async function setObjectEntryItemPrimaryMedia(
  organizationId: string,
  entryId: string,
  entryItemId: string,
  mediaId: string
): Promise<{ success: boolean; media_id: string }> {
  return await apiFetch(
    `/organizations/${organizationId}/collections/entries/${entryId}/items/${entryItemId}/media/${mediaId}/primary`,
    {
      method: 'PUT',
    }
  );
}

export async function uploadObjectEntryItemMedia(
  organizationId: string,
  entryId: string,
  entryItemId: string,
  file: File,
  params?: { caption?: string; usage_type?: string; is_primary?: boolean }
): Promise<{ message: string; media_id: string; is_primary: boolean }> {
  const formData = new FormData();
  formData.append('file', file);

  if (params?.caption) formData.append('caption', params.caption);
  if (params?.usage_type) formData.append('usage_type', params.usage_type);
  if (params?.is_primary) formData.append('is_primary', 'true');

  return await apiFetch(
    `/organizations/${organizationId}/collections/entries/${entryId}/items/${entryItemId}/media`,
    {
      method: 'POST',
      body: formData,
      headers: {},
    }
  );
}

// Get loans linked to an object entry via the join table
export async function getEntryLinkedLoans(
  organizationId: string,
  entryId: string
): Promise<{ loans_in: LoanIn[]; total: number }> {
  return await apiFetch(`/organizations/${organizationId}/collections/entries/${entryId}/loans-in`);
}
