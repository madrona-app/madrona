/**
 * Events API - Museum Programming Activities
 *
 * Extracted from the monolithic api.ts.
 * Covers event CRUD, object links, participants, and collections impact.
 */
import { apiFetch, validate, buildQueryString } from './_utils';
import {
  EventSchema,
  PaginatedEventsSchema,
  EventObjectLinksResponseSchema,
  EventObjectLinkSchema,
  EventParticipantsResponseSchema,
  EventParticipantSchema,
  CollectionsImpactSchema,
  ObjectEventsResponseSchema,
} from '../schemas';
import type {
  Event,
  PaginatedEvents,
  EventObjectLink,
  EventObjectLinksResponse,
  EventParticipant,
  EventParticipantsResponse,
  CollectionsImpact,
  ObjectEventsResponse,
} from '../schemas';

// ============================================================================
// EVENTS - Museum Programming Activities
// ============================================================================

export async function getEvents(
  organizationId: string,
  params?: {
    q?: string;
    status?: string;
    event_type?: string;
    owner_user_id?: string;
    page?: number;
    limit?: number;
    offset?: number;
    sort?: string;
    order?: 'asc' | 'desc';
  }
): Promise<PaginatedEvents> {
  const queryString = buildQueryString(params || {});
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events${queryString}`
  );
  return validate(PaginatedEventsSchema, data);
}

export async function getEvent(
  organizationId: string,
  eventId: string
): Promise<Event> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}`
  );
  return validate(EventSchema, data);
}

export async function createEvent(
  organizationId: string,
  event: Partial<Event>
): Promise<Event> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events`,
    {
      method: 'POST',
      body: JSON.stringify(event),
    }
  );
  return validate(EventSchema, data);
}

export async function updateEvent(
  organizationId: string,
  eventId: string,
  updates: Partial<Event>
): Promise<Event> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }
  );
  return validate(EventSchema, data);
}

export async function deleteEvent(
  organizationId: string,
  eventId: string
): Promise<void> {
  await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}`,
    { method: 'DELETE' }
  );
}

// Event Object Links

export async function getEventObjects(
  organizationId: string,
  eventId: string
): Promise<EventObjectLinksResponse> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}/objects`
  );
  return validate(EventObjectLinksResponseSchema, data);
}

export async function addEventObject(
  organizationId: string,
  eventId: string,
  payload: {
    object_id: string;
    planned_use: string;
    role?: string;
    requirements?: Record<string, unknown>;
    notes?: string;
  }
): Promise<EventObjectLink> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}/objects`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  return validate(EventObjectLinkSchema, data);
}

export async function updateEventObject(
  organizationId: string,
  eventId: string,
  linkId: string,
  updates: Partial<{
    role: string;
    planned_use: string;
    requirements: Record<string, unknown>;
    notes: string;
    display_order: number;
  }>
): Promise<EventObjectLink> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}/objects/${linkId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }
  );
  return validate(EventObjectLinkSchema, data);
}

export async function removeEventObject(
  organizationId: string,
  eventId: string,
  linkId: string
): Promise<void> {
  await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}/objects/${linkId}`,
    { method: 'DELETE' }
  );
}

// Event Participants

export async function getEventParticipants(
  organizationId: string,
  eventId: string
): Promise<EventParticipantsResponse> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}/participants`
  );
  return validate(EventParticipantsResponseSchema, data);
}

export async function addEventParticipant(
  organizationId: string,
  eventId: string,
  payload: {
    contact_id: string;
    role?: string;
    notes?: string;
  }
): Promise<EventParticipant> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}/participants`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  return validate(EventParticipantSchema, data);
}

export async function removeEventParticipant(
  organizationId: string,
  eventId: string,
  participantId: string
): Promise<void> {
  await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}/participants/${participantId}`,
    { method: 'DELETE' }
  );
}

// Object Events (reverse lookup)

export async function getObjectEvents(
  organizationId: string,
  objectId: string
): Promise<ObjectEventsResponse> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/objects/${objectId}/events`
  );
  return validate(ObjectEventsResponseSchema, data);
}

// Collections Impact

export async function getCollectionsImpact(
  organizationId: string,
  eventId: string
): Promise<CollectionsImpact> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/events/${eventId}/collections-impact`
  );
  return validate(CollectionsImpactSchema, data);
}
