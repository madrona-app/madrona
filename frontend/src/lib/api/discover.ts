/**
 * Public Discover / Gallery API
 */
import { apiFetch, buildQueryString, validate } from './_utils';
import { z } from 'zod';
import {
  DiscoverCollectionInfoSchema,
  DiscoverSearchResponseSchema,
  DiscoverObjectDetailSchema,
  DiscoverHitSchema,
  DiscoverRelatedHitSchema,
  ToggleDiscoverableResponseSchema,
  BulkToggleDiscoverableResponseSchema,
  DiscoverConfigSchema,
  DiscoverStatsSchema,
  DiscoverPreviewResultSchema,
  PublishByCriteriaResponseSchema,
  PublishScheduleSchema,
  PublicEventSchema,
  PublicStaffMemberSchema,
  PublicVenueSchema,
} from '../schemas';
import type {
  DiscoverCollectionInfo,
  DiscoverConfig,
  DiscoverHit,
  DiscoverPreviewResult,
  DiscoverRelatedHit,
  DiscoverSearchParams,
  DiscoverSearchResponse,
  DiscoverObjectDetail,
  DiscoverStats,
  PublishSchedule,
} from '../../types/discover';

export async function getDiscoverInfo(orgSlug: string): Promise<DiscoverCollectionInfo> {
  const data = await apiFetch(`/discover/${orgSlug}/info`, { skipAuth: true });
  return validate(DiscoverCollectionInfoSchema, data) as unknown as DiscoverCollectionInfo;
}

export async function searchDiscoverObjects(
  orgSlug: string,
  params: DiscoverSearchParams = {},
): Promise<DiscoverSearchResponse> {
  const query = buildQueryString(params);
  const data = await apiFetch(`/discover/${orgSlug}/search${query}`, { skipAuth: true });
  return validate(DiscoverSearchResponseSchema, data) as unknown as DiscoverSearchResponse;
}

export async function getDiscoverObject(
  orgSlug: string,
  objectId: string,
): Promise<DiscoverObjectDetail> {
  const data = await apiFetch(`/discover/${orgSlug}/objects/${encodeURIComponent(objectId)}`, { skipAuth: true });
  return validate(DiscoverObjectDetailSchema, data) as unknown as DiscoverObjectDetail;
}

export async function getFeaturedObjects(
  orgSlug: string,
): Promise<{ hits: DiscoverHit[] }> {
  const data = await apiFetch(`/discover/${orgSlug}/featured`, { skipAuth: true });
  return validate(z.object({ hits: z.array(DiscoverHitSchema) }).passthrough(), data) as any;
}

export async function getRelatedObjects(
  orgSlug: string,
  objectId: string,
): Promise<{ hits: DiscoverRelatedHit[] }> {
  const data = await apiFetch(`/discover/${orgSlug}/objects/${encodeURIComponent(objectId)}/related`, { skipAuth: true });
  return validate(z.object({ hits: z.array(DiscoverRelatedHitSchema) }).passthrough(), data) as any;
}

export async function toggleObjectDiscoverable(
  organizationId: string,
  objectId: string,
  isDiscoverable: boolean,
): Promise<{ object_id: string; is_discoverable: boolean; discoverable_at?: string | null }> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/discoverable`, {
    method: 'PATCH',
    body: JSON.stringify({ is_discoverable: isDiscoverable }),
  });
  return validate(ToggleDiscoverableResponseSchema, data);
}

export async function bulkToggleDiscoverable(
  organizationId: string,
  objectIds: string[],
  isDiscoverable: boolean,
): Promise<{ updated: number; is_discoverable: boolean; skipped?: { object_id: string; reason: string }[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/bulk-discoverable`, {
    method: 'POST',
    body: JSON.stringify({ object_ids: objectIds, is_discoverable: isDiscoverable }),
  });
  return validate(BulkToggleDiscoverableResponseSchema, data);
}

export async function getDiscoverConfig(
  organizationId: string,
): Promise<DiscoverConfig> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/discover-config`);
  return validate(DiscoverConfigSchema, data) as unknown as DiscoverConfig;
}

export async function updateDiscoverConfig(
  organizationId: string,
  config: Partial<DiscoverConfig>,
): Promise<DiscoverConfig> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/discover-config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  return validate(DiscoverConfigSchema, data) as unknown as DiscoverConfig;
}

export async function getDiscoverStats(organizationId: string): Promise<DiscoverStats> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/discover/stats`);
  return validate(DiscoverStatsSchema, data) as unknown as DiscoverStats;
}

export async function getDiscoverPreview(
  organizationId: string,
  objectId: string,
): Promise<DiscoverPreviewResult> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/discover-preview`);
  return validate(DiscoverPreviewResultSchema, data) as unknown as DiscoverPreviewResult;
}

export async function publishByCriteria(
  organizationId: string,
  criteria: Record<string, unknown>,
  isDiscoverable: boolean,
  dryRun: boolean = false,
): Promise<{ matched_count?: number; updated_count?: number; sample_objects?: Array<{ object_id: string; object_number: string; title: string | null; object_type: string | null; is_discoverable: boolean }> }> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/discover/publish-by-criteria`, {
    method: 'POST',
    body: JSON.stringify({ criteria, is_discoverable: isDiscoverable, dry_run: dryRun }),
  });
  return validate(PublishByCriteriaResponseSchema, data);
}

export async function createPublishSchedule(
  organizationId: string,
  data: {
    action: 'publish' | 'unpublish';
    scheduled_for: string;
    criteria?: Record<string, unknown>;
    object_ids?: string[];
  },
): Promise<PublishSchedule> {
  const result = await apiFetch(`/organizations/${organizationId}/collections/discover/schedules`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return validate(PublishScheduleSchema, result) as unknown as PublishSchedule;
}

export async function listPublishSchedules(organizationId: string): Promise<PublishSchedule[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/discover/schedules`);
  return validate(z.array(PublishScheduleSchema), data) as unknown as PublishSchedule[];
}

export async function cancelPublishSchedule(
  organizationId: string,
  scheduleId: string,
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/discover/schedules/${scheduleId}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// Public Events (for event_list block)
// =============================================================================

export interface PublicEvent {
  event_id: string;
  title: string;
  event_type: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  description: string | null;
  location_name: string | null;
  capacity: number | null;
  registration_url: string | null;
}

export async function getPublicEvents(
  orgSlug: string,
  params?: { event_type?: string; limit?: number; show_past?: boolean },
): Promise<{ data: PublicEvent[]; total: number }> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/discover/${orgSlug}/events${query}`, { skipAuth: true });
  return validate(z.object({ data: z.array(PublicEventSchema), total: z.number() }).passthrough(), data) as any;
}

// =============================================================================
// Public Staff (for staff_grid block)
// =============================================================================

export interface PublicStaffMember {
  constituent_id: string;
  name: string;
  title: string | null;
  role: string | null;
  department: string | null;
  email: string | null;
  biography: string | null;
}

export async function getPublicStaff(
  orgSlug: string,
  params?: { department?: string; limit?: number; ids?: string },
): Promise<{ data: PublicStaffMember[]; total: number }> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/discover/${orgSlug}/staff${query}`, { skipAuth: true });
  return validate(z.object({ data: z.array(PublicStaffMemberSchema), total: z.number() }).passthrough(), data) as any;
}

// =============================================================================
// Public Venues
// =============================================================================

export async function getPublicVenues(
  orgSlug: string,
): Promise<{ data: import('../../types/discover').PublicVenue[] }> {
  const data = await apiFetch(`/discover/${orgSlug}/venues`, { skipAuth: true });
  return validate(z.object({ data: z.array(PublicVenueSchema) }).passthrough(), data) as any;
}

export async function getPublicVenueDetail(
  orgSlug: string,
  venueSlug: string,
): Promise<{ data: import('../../types/discover').PublicVenue & { upcoming_exhibitions?: Array<{ exhibition_id: string; title: string; subtitle: string | null; public_url_slug: string | null; planned_start_date: string | null; planned_end_date: string | null; short_description: string | null; thumbnail_url: string | null }> } }> {
  const data = await apiFetch(`/discover/${orgSlug}/venues/${encodeURIComponent(venueSlug)}`, { skipAuth: true });
  return validate(z.object({ data: PublicVenueSchema }).passthrough(), data) as any;
}
