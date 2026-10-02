/**
 * Admin API functions
 *
 * Organizations, roles, storage, timezones, auth/user, email events,
 * overview preferences, user profile, page documentation,
 * organization branding, document templates, and document generation.
 */
import { z } from 'zod';
import { apiFetch, validate, buildQueryString } from './_utils';
import {
  OrganizationSchema,
  CurrentUserSchema,
  StorageStatsSchema,
  UpdateOrganizationResponseSchema,
  OrganizationUsersResponseSchema,
  RolesResponseSchema,
  StorageRegionsResponseSchema,
  TimezonesResponseSchema,
  EmailEventSchema,
  EmailEventsResponseSchema,
  EmailEventStatsSchema,
  UserEmailStatusResponseSchema,
  UpdateUserEmailStatusResponseSchema,
  MessageResponseSchema,
  BulkDeleteResponseSchema,
  OverviewPreferencesSchema,
  UserProfileResponseSchema,
  AvatarUploadResponseSchema,
  PageDocSchema,
  DeletePageDocResponseSchema,
  OrganizationBrandingSchema,
  CollectionProfileSchema,
  BrandingLogoResponseSchema,
  BrandingSignatureResponseSchema,
  DocumentTemplateSchema,
  DocumentPreviewResponseSchema,
  FieldAccessPoliciesResponseSchema,
  FieldAccessGrantsResponseSchema,
  UpdateFieldGrantsResponseSchema,
  type Organization,
  type CurrentUser,
  type StorageStats,
  type StorageRegionsResponse,
  type UpdateOrganizationResponse,
  type OrganizationUsersResponse,
  type OrganizationUser,
  type OrgRole,
  type RolesResponse,
  type TimezonesResponse,
  type EmailEvent,
  type EmailEventsResponse,
  type EmailEventStats,
  type UserEmailStatus,
  type UserEmailStatusResponse,
  type UpdateUserEmailStatusResponse,
  type MessageResponse,
  type BulkDeleteResponse,
  type OverviewPreferences,
  type UserProfileResponse,
  type AvatarUploadResponse,
  type PageDoc,
  type DeletePageDocResponse,
  type OrganizationBranding,
  type CollectionProfile,
  type BrandingLogoResponse,
  type BrandingSignatureResponse,
  type DocumentTemplate,
  type DocumentPreviewResponse,
  type FieldAccessPolicy,
  type FieldAccessGrant,
  type FieldGrantInput,
  type FieldAccessPoliciesResponse,
  type FieldAccessGrantsResponse,
  type UpdateFieldGrantsResponse,
  type StorageRegion,
} from '../schemas';

// Re-export types for consumers that import from admin.ts
export type {
  Organization,
  // getCollectionProfile returns this, so callers need the type. It was
  // imported above but missing from this block, and `export *` in the barrel
  // does not forward a type that was only imported.
  CollectionProfile,
  CurrentUser,
  StorageStats,
  StorageRegion,
  UpdateOrganizationResponse,
  OrganizationUser,
  OrgRole,
  RolesResponse,
  StorageRegionsResponse,
  TimezonesResponse,
  EmailEvent,
  EmailEventsResponse,
  EmailEventStats,
  UserEmailStatus,
  UserEmailStatusResponse,
  UpdateUserEmailStatusResponse,
  MessageResponse,
  BulkDeleteResponse,
  OverviewPreferences,
  UserProfileResponse,
  AvatarUploadResponse,
  PageDoc,
  DeletePageDocResponse,
  OrganizationBranding,
  BrandingLogoResponse,
  BrandingSignatureResponse,
  DocumentTemplate,
  DocumentPreviewResponse,
  FieldAccessPolicy,
  FieldAccessGrant,
  FieldGrantInput,
  FieldAccessPoliciesResponse,
  FieldAccessGrantsResponse,
  UpdateFieldGrantsResponse,
};

// ============================================================================
// ORGANIZATIONS
// ============================================================================

export const getOrganizations = async (): Promise<Organization[]> => {
  const data = await apiFetch('/organizations');
  return validate(z.array(OrganizationSchema), data);
};

export const updateOrganization = async (
  organizationId: string,
  updates: {
    name?: string;
    timezone?: string;
  }
): Promise<UpdateOrganizationResponse> => {
  const data = await apiFetch(`/organizations/${organizationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return validate(UpdateOrganizationResponseSchema, data);
};

export const getOrganizationUsers = async (
  organizationId: string,
  status: 'active' | 'deactivated' | 'all' = 'active'
): Promise<OrganizationUsersResponse> => {
  const data = await apiFetch(`/organizations/${organizationId}/users?status=${status}`);
  return validate(OrganizationUsersResponseSchema, data);
};

// ============================================================================
// ROLES
// ============================================================================

export const getRoles = async (
  organizationId: string
): Promise<RolesResponse> => {
  const data = await apiFetch(`/organizations/${organizationId}/roles`);
  return validate(RolesResponseSchema, data);
};

// ============================================================================
// STORAGE
// ============================================================================

export const getOrganizationStorage = async (organizationId: string): Promise<StorageStats> => {
  const data = await apiFetch(`/organizations/${organizationId}/storage`);
  return validate(StorageStatsSchema, data);
};

export const getStorageRegions = async (): Promise<StorageRegionsResponse> => {
  const data = await apiFetch('/storage-regions');
  return validate(StorageRegionsResponseSchema, data);
};

// ============================================================================
// TIMEZONES
// ============================================================================

export const getTimezones = async (all: boolean = false): Promise<TimezonesResponse> => {
  const query = all ? '?all=true' : '';
  const data = await apiFetch(`/timezones${query}`);
  return validate(TimezonesResponseSchema, data);
};

// ============================================================================
// AUTH / USER
// ============================================================================

export const getCurrentUser = async (): Promise<CurrentUser> => {
  const data = await apiFetch('/me');
  return validate(CurrentUserSchema, data);
};

export const createOrganization = async (organization: {
  name: string;
  slug: string;
}): Promise<Organization> => {
  const data = await apiFetch('/organizations', {
    method: 'POST',
    body: JSON.stringify(organization),
  });
  return validate(OrganizationSchema, data);
};

// ============================================================================
// EMAIL EVENTS
// ============================================================================

export interface EmailEventInput {
  page_key: string;
  title: string;
  summary?: string | null;
  body_markdown: string;
  audience?: 'all' | 'viewer' | 'engineer' | 'admin';
}

export const getEmailEvents = async (params?: {
  event_type?: 'bounce' | 'complaint';
  email?: string;
  limit?: number;
  offset?: number;
}): Promise<EmailEventsResponse> => {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/email-events${query}`);
  return validate(EmailEventsResponseSchema, data);
};

export const getEmailEvent = async (eventId: string): Promise<EmailEvent> => {
  const data = await apiFetch(`/email-events/${eventId}`);
  return validate(EmailEventSchema, data);
};

export const getEmailStats = async (): Promise<EmailEventStats> => {
  const data = await apiFetch('/email-events/stats');
  return validate(EmailEventStatsSchema, data);
};

export const getUsersByEmailStatus = async (params?: {
  status?: 'active' | 'bounced' | 'complaint';
  limit?: number;
  offset?: number;
}): Promise<UserEmailStatusResponse> => {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/users/email-status${query}`);
  return validate(UserEmailStatusResponseSchema, data);
};

export const updateUserEmailStatus = async (
  userId: string,
  emailStatus: 'active' | 'bounced' | 'complaint'
): Promise<UpdateUserEmailStatusResponse> => {
  const data = await apiFetch(`/users/${userId}/email-status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_status: emailStatus }),
  });
  return validate(UpdateUserEmailStatusResponseSchema, data);
};

export const deleteEmailEvent = async (eventId: string): Promise<MessageResponse> => {
  const data = await apiFetch(`/email-events/${eventId}`, {
    method: 'DELETE',
  });
  return validate(MessageResponseSchema, data);
};

export const bulkDeleteEmailEvents = async (params: {
  event_type?: 'bounce' | 'complaint';
  before_date?: string;
  delete_all?: boolean;
}): Promise<BulkDeleteResponse> => {
  const data = await apiFetch('/email-events/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return validate(BulkDeleteResponseSchema, data);
};

// ============================================================================
// OVERVIEW PREFERENCES
// ============================================================================

export const getOverviewPreferences = async (): Promise<OverviewPreferences> => {
  const data = await apiFetch('/me/overview-preferences');
  return validate(OverviewPreferencesSchema, data);
};

export const updateOverviewPreferences = async (
  preferences: Omit<OverviewPreferences, 'updated_at'>
): Promise<OverviewPreferences> => {
  const data = await apiFetch('/me/overview-preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });
  return validate(OverviewPreferencesSchema, data);
};

// ============================================================================
// USER PROFILE
// ============================================================================

export interface UserProfileUpdate {
  display_name?: string | null;
  timezone?: string | null;
}

export const updateUserProfile = async (
  profile: UserProfileUpdate
): Promise<UserProfileResponse> => {
  const data = await apiFetch('/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  return validate(UserProfileResponseSchema, data);
};

export const uploadAvatar = async (file: File): Promise<AvatarUploadResponse> => {
  const formData = new FormData();
  formData.append('avatar', file);

  const data = await apiFetch<AvatarUploadResponse>('/me/avatar', {
    method: 'POST',
    body: formData,
  });
  return validate(AvatarUploadResponseSchema, data);
};

export const deleteAvatar = async (): Promise<MessageResponse> => {
  const data = await apiFetch('/me/avatar', {
    method: 'DELETE',
  });
  return validate(MessageResponseSchema, data);
};

// ============================================================================
// PAGE DOCUMENTATION (Inline Help)
// ============================================================================

export interface PageDocInput {
  page_key: string;
  title: string;
  summary?: string | null;
  body_markdown: string;
  audience?: 'all' | 'viewer' | 'engineer' | 'admin';
}

export interface PageDocUpdate {
  title?: string;
  summary?: string | null;
  body_markdown?: string;
  audience?: 'all' | 'viewer' | 'engineer' | 'admin';
}

export const getPageDoc = async (pageKey: string): Promise<PageDoc | null> => {
  const response = await apiFetch(`/docs?pageKey=${encodeURIComponent(pageKey)}`);
  if (!response.doc) return null;
  return validate(PageDocSchema, response.doc);
};

export const createPageDoc = async (doc: PageDocInput): Promise<PageDoc> => {
  const response = await apiFetch('/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  return validate(PageDocSchema, response.doc);
};

export const updatePageDoc = async (docId: string, doc: PageDocUpdate): Promise<PageDoc> => {
  const response = await apiFetch(`/docs/${docId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  return validate(PageDocSchema, response.doc);
};

export const deletePageDoc = async (docId: string): Promise<DeletePageDocResponse> => {
  const data = await apiFetch(`/docs/${docId}`, {
    method: 'DELETE',
  });
  return validate(DeletePageDocResponseSchema, data);
};

export const listPageKeys = async (): Promise<string[]> => {
  const response = await apiFetch('/docs/keys');
  return validate(z.array(z.string()), response.page_keys);
};

export const listAllPageDocs = async (): Promise<PageDoc[]> => {
  const response = await apiFetch('/docs/all');
  return validate(z.array(PageDocSchema), response.docs);
};

// ============================================================================
// ORGANIZATION BRANDING
// ============================================================================

export async function getOrganizationBranding(
  organizationId: string
): Promise<OrganizationBranding> {
  const data = await apiFetch(`/organizations/${organizationId}/branding`);
  return validate(OrganizationBrandingSchema, data);
}

export async function updateOrganizationBranding(
  organizationId: string,
  branding: Partial<OrganizationBranding>
): Promise<OrganizationBranding> {
  const data = await apiFetch(`/organizations/${organizationId}/branding`, {
    method: 'PUT',
    body: JSON.stringify(branding),
  });
  return validate(OrganizationBrandingSchema, data);
}

// ============================================================================
// COLLECTION SCOPE PROFILE (issue #77)
// ============================================================================

export async function getCollectionProfile(
  organizationId: string
): Promise<CollectionProfile> {
  const data = await apiFetch(`/organizations/${organizationId}/collection-profile`);
  return validate(CollectionProfileSchema, data);
}

export async function updateCollectionProfile(
  organizationId: string,
  profile: Partial<CollectionProfile>
): Promise<CollectionProfile> {
  const data = await apiFetch(`/organizations/${organizationId}/collection-profile`, {
    method: 'PUT',
    body: JSON.stringify(profile),
  });
  return validate(CollectionProfileSchema, data);
}

export async function uploadBrandingLogo(
  organizationId: string,
  file: File
): Promise<BrandingLogoResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/branding/logo`, {
    method: 'POST',
    body: file instanceof FormData ? file : (() => { const fd = new FormData(); fd.append('logo', file); return fd; })(),
    headers: {}, // Let browser set content-type for FormData
  });
  return validate(BrandingLogoResponseSchema, data);
}

export async function deleteBrandingLogo(
  organizationId: string
): Promise<MessageResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/branding/logo`, {
    method: 'DELETE',
  });
  return validate(MessageResponseSchema, data);
}

export async function uploadBrandingSignature(
  organizationId: string,
  file: File
): Promise<BrandingSignatureResponse> {
  const formData = new FormData();
  formData.append('signature', file);

  const data = await apiFetch(`/organizations/${organizationId}/branding/signature`, {
    method: 'POST',
    body: formData,
    headers: {},
  });
  return validate(BrandingSignatureResponseSchema, data);
}

export async function deleteBrandingSignature(
  organizationId: string
): Promise<MessageResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/branding/signature`, {
    method: 'DELETE',
  });
  return validate(MessageResponseSchema, data);
}

// ============================================================================
// DOCUMENT TEMPLATES
// ============================================================================

export async function getDocumentTemplates(
  organizationId: string,
  params?: {
    template_type?: string;
    active_only?: boolean;
  }
): Promise<DocumentTemplate[]> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/document-templates${query}`);
  return validate(z.array(DocumentTemplateSchema), data);
}

export async function getDocumentTemplate(
  organizationId: string,
  templateId: string
): Promise<DocumentTemplate> {
  const data = await apiFetch(`/organizations/${organizationId}/document-templates/${templateId}`);
  return validate(DocumentTemplateSchema, data);
}

export async function createDocumentTemplate(
  organizationId: string,
  template: {
    template_type: string;
    name: string;
    description?: string;
    is_default?: boolean;
    config?: Record<string, unknown>;
    terms_and_conditions?: string;
  }
): Promise<DocumentTemplate> {
  const data = await apiFetch(`/organizations/${organizationId}/document-templates`, {
    method: 'POST',
    body: JSON.stringify(template),
  });
  return validate(DocumentTemplateSchema, data);
}

export async function updateDocumentTemplate(
  organizationId: string,
  templateId: string,
  updates: Partial<DocumentTemplate>
): Promise<DocumentTemplate> {
  const data = await apiFetch(`/organizations/${organizationId}/document-templates/${templateId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(DocumentTemplateSchema, data);
}

export async function deleteDocumentTemplate(
  organizationId: string,
  templateId: string
): Promise<MessageResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/document-templates/${templateId}`, {
    method: 'DELETE',
  });
  return validate(MessageResponseSchema, data);
}

// ============================================================================
// DOCUMENT GENERATION
// ============================================================================

export type DocumentType =
  | 'loan_agreement_out'
  | 'loan_agreement_in'
  | 'object_receipt'
  | 'packing_list'
  | 'condition_report'
  | 'facility_report';

export async function generateDocument(
  organizationId: string,
  documentType: DocumentType,
  data: Record<string, unknown>,
  templateId?: string
): Promise<Blob> {
  // Step 1: POST to start async generation — returns { run_id, status: "pending" }
  const dispatchResult = await apiFetch<{ run_id: string; status: string }>(
    `/organizations/${organizationId}/documents/generate`,
    {
      method: 'POST',
      body: JSON.stringify({
        document_type: documentType,
        template_id: templateId,
        data,
      }),
    }
  );

  const runId = dispatchResult.run_id;
  if (!runId) {
    throw new Error('Document generation did not return a run_id');
  }

  // Step 2: Poll the report run until it completes
  const maxAttempts = 60; // 60 attempts * 1s = 60s max wait
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const run = await apiFetch<{ status: string; error_message?: string }>(
      `/organizations/${organizationId}/on-demand-reports/runs/${runId}`
    );

    if (run.status === 'completed') {
      // Step 3: Get the presigned download URL, then fetch the blob
      const downloadInfo = await apiFetch<{ download_url: string }>(
        `/organizations/${organizationId}/on-demand-reports/runs/${runId}/download`
      );
      const fileResponse = await fetch(downloadInfo.download_url);
      if (!fileResponse.ok) {
        throw new Error('Failed to download generated document');
      }
      return fileResponse.blob();
    }

    if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(run.error_message || `Document generation ${run.status}`);
    }
  }

  throw new Error('Document generation timed out');
}

export async function previewDocument(
  organizationId: string,
  documentType: DocumentType,
  data: Record<string, unknown>,
  templateId?: string
): Promise<DocumentPreviewResponse> {
  const result = await apiFetch(`/organizations/${organizationId}/documents/preview`, {
    method: 'POST',
    body: JSON.stringify({
      document_type: documentType,
      template_id: templateId,
      data,
    }),
  });
  return validate(DocumentPreviewResponseSchema, result);
}

// ============================================================================
// FIELD ACCESS CONTROL
// ============================================================================

export async function getFieldPolicies(
  organizationId: string,
  params?: { app_key?: string; entity_type?: string }
): Promise<FieldAccessPoliciesResponse> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/field-access/policies${query}`);
  return validate(FieldAccessPoliciesResponseSchema, data);
}

export async function getFieldGrants(
  organizationId: string,
  roleId: string,
  appKey?: string
): Promise<FieldAccessGrantsResponse> {
  const query = appKey ? `?app_key=${encodeURIComponent(appKey)}` : '';
  const data = await apiFetch(`/organizations/${organizationId}/field-access/grants/${roleId}${query}`);
  return validate(FieldAccessGrantsResponseSchema, data);
}

export async function updateFieldGrants(
  organizationId: string,
  roleId: string,
  grants: FieldGrantInput[]
): Promise<UpdateFieldGrantsResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/field-access/grants/${roleId}`, {
    method: 'PUT',
    body: JSON.stringify({ grants }),
  });
  return validate(UpdateFieldGrantsResponseSchema, data);
}

export async function deleteFieldGrant(
  organizationId: string,
  roleId: string,
  policyId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/field-access/grants/${roleId}/${policyId}`, {
    method: 'DELETE',
  });
}


// ============================================================================
// CUSTOM ROLE MANAGEMENT
// ============================================================================

export interface CustomRoleDetail {
  role_id: string;
  role_key: string;
  display_name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  cloned_from_name: string | null;
  member_count: number;
  permission_count: number;
}

export interface PermissionItem {
  permission_id: string;
  permission_key: string;
  display_name: string;
  description: string | null;
  granted: boolean;
}

export interface PermissionGroup {
  scope: string;
  permissions: PermissionItem[];
}

export async function listCustomRoles(
  organizationId: string,
): Promise<{ roles: CustomRoleDetail[] }> {
  return apiFetch(`/organizations/${organizationId}/custom-roles`);
}

export async function createCustomRole(
  organizationId: string,
  body: { display_name: string; description?: string; clone_from_role_id?: string },
): Promise<CustomRoleDetail> {
  return apiFetch(`/organizations/${organizationId}/custom-roles`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getCustomRole(
  organizationId: string,
  roleId: string,
): Promise<CustomRoleDetail> {
  return apiFetch(`/organizations/${organizationId}/custom-roles/${roleId}`);
}

export async function updateCustomRole(
  organizationId: string,
  roleId: string,
  body: { display_name?: string; description?: string },
): Promise<CustomRoleDetail> {
  return apiFetch(`/organizations/${organizationId}/custom-roles/${roleId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteCustomRole(
  organizationId: string,
  roleId: string,
): Promise<{ status: string; role_id: string }> {
  return apiFetch(`/organizations/${organizationId}/custom-roles/${roleId}`, {
    method: 'DELETE',
  });
}

export async function getRolePermissions(
  organizationId: string,
  roleId: string,
): Promise<{ role_id: string; groups: PermissionGroup[] }> {
  return apiFetch(`/organizations/${organizationId}/custom-roles/${roleId}/permissions`);
}

export async function setRolePermissions(
  organizationId: string,
  roleId: string,
  permissionIds: string[],
): Promise<{ status: string; role_id: string; permission_count: number }> {
  return apiFetch(`/organizations/${organizationId}/custom-roles/${roleId}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permission_ids: permissionIds }),
  });
}
