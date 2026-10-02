/**
 * Constituent media API functions.
 */
import { apiFetch } from '../apiClient';
import type { Media } from '../schemas';

export interface ConstituentMediaItem {
  media_id: string;
  constituent_id: string;
  is_primary: boolean;
  sort_order: number;
  caption_override: string | null;
  usage_type: string | null;
  filename: string;
  media_type: Media['media_type'];
  mime_type: string | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  url: string | null;
  title: string | null;
}

export async function listConstituentMedia(orgId: string, constituentId: string) {
  return apiFetch<{ media: ConstituentMediaItem[]; count: number }>(
    `/organizations/${orgId}/collections/constituents/${constituentId}/media`
  );
}

export async function addConstituentMedia(
  orgId: string,
  constituentId: string,
  data: { media_id: string; is_primary?: boolean; usage_type?: string; caption_override?: string },
) {
  return apiFetch(`/organizations/${orgId}/collections/constituents/${constituentId}/media`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function removeConstituentMedia(orgId: string, constituentId: string, mediaId: string) {
  return apiFetch(`/organizations/${orgId}/collections/constituents/${constituentId}/media/${mediaId}`, {
    method: 'DELETE',
  });
}

export async function setConstituentPrimaryMedia(orgId: string, constituentId: string, mediaId: string) {
  return apiFetch(`/organizations/${orgId}/collections/constituents/${constituentId}/media/${mediaId}/primary`, {
    method: 'PUT',
  });
}
