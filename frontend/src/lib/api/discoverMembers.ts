/**
 * Portal member API: sign-in by emailed link and saved personal collections.
 *
 * Backend: routers/discover_members.py (public, per portal) and
 * routers/collections_discover_members.py (staff). The member session is an
 * HttpOnly cookie the browser sends only to /api/discover/{slug}/member, so
 * nothing here handles a token. State-changing calls carry the CSRF header
 * through apiFetch.
 */
import { z } from 'zod';
import { apiFetch, ApiError, validate, API_BASE_URL } from './_utils';

// ── Types ───────────────────────────────────────────────────────────────────

const MemberSchema = z.object({
  display_name: z.string().nullable().optional(),
  email: z.string(),
});
export type PortalMemberIdentity = z.infer<typeof MemberSchema>;

const MemberSessionSchema = z.object({
  enabled: z.boolean(),
  member: MemberSchema.nullable(),
});
export interface MemberSessionState {
  /** False when the portal does not offer saved collections (API 404). */
  enabled: boolean;
  member: PortalMemberIdentity | null;
}

const MemberCollectionSummarySchema = z.object({
  collection_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  item_count: z.number(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  contains_object: z.boolean().optional(),
});
export type MemberCollectionSummary = z.infer<typeof MemberCollectionSummarySchema>;

const PublicObjectSchema = z
  .object({
    object_id: z.string(),
    object_number: z.string().nullable().optional(),
    canonical_url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    creators: z.array(z.string()).optional().default([]),
    creation_date_display: z.string().nullable().optional(),
    object_type: z.string().nullable().optional(),
    brief_description: z.string().nullable().optional(),
  })
  .passthrough();

const MemberCollectionItemSchema = z.object({
  object_id: z.string(),
  note: z.string().nullable().optional(),
  added_at: z.string().nullable().optional(),
  object: PublicObjectSchema,
});
export type MemberCollectionItem = z.infer<typeof MemberCollectionItemSchema>;

const MemberCollectionDetailSchema = MemberCollectionSummarySchema.extend({
  items: z.array(MemberCollectionItemSchema),
});
export type MemberCollectionDetail = z.infer<typeof MemberCollectionDetailSchema>;

const AddItemResponseSchema = z.object({
  object_id: z.string(),
  collection_id: z.string(),
  already_saved: z.boolean(),
});

function base(orgSlug: string): string {
  return `/discover/${encodeURIComponent(orgSlug)}/member`;
}

// ── Session and sign-in ─────────────────────────────────────────────────────

export async function getMemberSession(orgSlug: string): Promise<MemberSessionState> {
  try {
    const data = await apiFetch(`${base(orgSlug)}/session`, { skipAuth: true });
    return validate(MemberSessionSchema, data);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { enabled: false, member: null };
    }
    throw err;
  }
}

export async function requestMemberSignInLink(orgSlug: string, email: string): Promise<string> {
  const data = await apiFetch<{ message: string }>(`${base(orgSlug)}/sign-in/request`, {
    method: 'POST',
    body: JSON.stringify({ email }),
    skipAuth: true,
  });
  return data.message;
}

export async function exchangeMemberSignInLink(orgSlug: string, token: string): Promise<PortalMemberIdentity> {
  const data = await apiFetch(`${base(orgSlug)}/sign-in/exchange`, {
    method: 'POST',
    body: JSON.stringify({ token }),
    skipAuth: true,
  });
  return validate(z.object({ member: MemberSchema }), data).member;
}

export async function memberSignOut(orgSlug: string): Promise<void> {
  await apiFetch(`${base(orgSlug)}/sign-out`, { method: 'POST', skipAuth: true });
}

// ── Collections ─────────────────────────────────────────────────────────────

export async function listMemberCollections(
  orgSlug: string,
  objectId?: string,
): Promise<MemberCollectionSummary[]> {
  const qs = objectId ? `?object_id=${encodeURIComponent(objectId)}` : '';
  const data = await apiFetch(`${base(orgSlug)}/collections${qs}`, { skipAuth: true });
  return validate(z.object({ collections: z.array(MemberCollectionSummarySchema) }), data).collections;
}

export async function createMemberCollection(
  orgSlug: string,
  body: { name: string; description?: string | null },
): Promise<MemberCollectionSummary> {
  const data = await apiFetch(`${base(orgSlug)}/collections`, {
    method: 'POST',
    body: JSON.stringify(body),
    skipAuth: true,
  });
  return validate(MemberCollectionSummarySchema, data);
}

export async function getMemberCollection(orgSlug: string, collectionId: string): Promise<MemberCollectionDetail> {
  const data = await apiFetch(`${base(orgSlug)}/collections/${encodeURIComponent(collectionId)}`, { skipAuth: true });
  return validate(MemberCollectionDetailSchema, data);
}

export async function updateMemberCollection(
  orgSlug: string,
  collectionId: string,
  body: { name?: string; description?: string | null },
): Promise<MemberCollectionSummary> {
  const data = await apiFetch(`${base(orgSlug)}/collections/${encodeURIComponent(collectionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    skipAuth: true,
  });
  return validate(MemberCollectionSummarySchema, data);
}

export async function deleteMemberCollection(orgSlug: string, collectionId: string): Promise<void> {
  await apiFetch(`${base(orgSlug)}/collections/${encodeURIComponent(collectionId)}`, {
    method: 'DELETE',
    skipAuth: true,
  });
}

export async function addObjectToMemberCollection(
  orgSlug: string,
  collectionId: string,
  objectId: string,
): Promise<{ already_saved: boolean }> {
  const data = await apiFetch(`${base(orgSlug)}/collections/${encodeURIComponent(collectionId)}/items`, {
    method: 'POST',
    body: JSON.stringify({ object_id: objectId }),
    skipAuth: true,
  });
  return validate(AddItemResponseSchema, data);
}

export async function removeObjectFromMemberCollection(
  orgSlug: string,
  collectionId: string,
  objectId: string,
): Promise<void> {
  await apiFetch(
    `${base(orgSlug)}/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(objectId)}`,
    { method: 'DELETE', skipAuth: true },
  );
}

/** Plain download link (the session cookie rides along, same origin). */
export function getMemberCollectionExportUrl(orgSlug: string, collectionId: string, format: 'csv' | 'json'): string {
  const root = API_BASE_URL.replace(/\/$/, '');
  return `${root}${base(orgSlug)}/collections/${encodeURIComponent(collectionId)}/export?format=${format}`;
}

// ── Staff: member management ────────────────────────────────────────────────

const StaffMemberSchema = z.object({
  member_id: z.string(),
  email: z.string(),
  display_name: z.string().nullable().optional(),
  status: z.enum(['invited', 'active', 'suspended']),
  approved_at: z.string().nullable().optional(),
  last_sign_in_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  collection_count: z.number().optional().default(0),
});
export type StaffPortalMember = z.infer<typeof StaffMemberSchema>;

const StaffMemberListSchema = z.object({
  member_collections_enabled: z.boolean(),
  members: z.array(StaffMemberSchema),
});
export type StaffPortalMemberList = z.infer<typeof StaffMemberListSchema>;

const SignInLinkSchema = z.object({
  url: z.string(),
  expires_at: z.string(),
  expires_in_minutes: z.number(),
  emailed: z.boolean(),
  feature_enabled: z.boolean(),
});
export type StaffSignInLink = z.infer<typeof SignInLinkSchema>;

function staffBase(organizationId: string): string {
  return `/organizations/${organizationId}/collections/discover/members`;
}

export async function listPortalMembers(organizationId: string): Promise<StaffPortalMemberList> {
  const data = await apiFetch(staffBase(organizationId));
  return validate(StaffMemberListSchema, data);
}

export async function setMemberCollectionsEnabled(organizationId: string, enabled: boolean): Promise<boolean> {
  const data = await apiFetch(`${staffBase(organizationId)}/settings`, {
    method: 'PUT',
    body: JSON.stringify({ member_collections_enabled: enabled }),
  });
  return validate(z.object({ member_collections_enabled: z.boolean() }), data).member_collections_enabled;
}

export async function invitePortalMember(
  organizationId: string,
  body: { email: string; display_name?: string | null; approve?: boolean },
): Promise<StaffPortalMember> {
  const data = await apiFetch(staffBase(organizationId), { method: 'POST', body: JSON.stringify(body) });
  return validate(StaffMemberSchema, data);
}

export async function approvePortalMember(organizationId: string, memberId: string): Promise<StaffPortalMember> {
  const data = await apiFetch(`${staffBase(organizationId)}/${memberId}/approve`, { method: 'POST' });
  return validate(StaffMemberSchema, data);
}

export async function suspendPortalMember(organizationId: string, memberId: string): Promise<StaffPortalMember> {
  const data = await apiFetch(`${staffBase(organizationId)}/${memberId}/suspend`, { method: 'POST' });
  return validate(StaffMemberSchema, data);
}

export async function generatePortalMemberSignInLink(
  organizationId: string,
  memberId: string,
  sendEmail = false,
): Promise<StaffSignInLink> {
  const data = await apiFetch(`${staffBase(organizationId)}/${memberId}/sign-in-link`, {
    method: 'POST',
    body: JSON.stringify({ send_email: sendEmail }),
  });
  return validate(SignInLinkSchema, data);
}
