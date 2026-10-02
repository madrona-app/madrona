import { z } from 'zod';
import { StorageRegionSchema } from './base';

// ============================================================================
// ADMIN / ORGANIZATION SCHEMAS
// ============================================================================

// Tenant schema
export const OrganizationSchema = z.object({
  organization_id: z.string(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string().default('UTC'),  // IANA timezone identifier
  created_at: z.string(),
});

export type Organization = z.infer<typeof OrganizationSchema>;

// User and organization membership schema
export const OrganizationMembershipSchema = z.object({
  organization_id: z.string(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string().default('UTC'),  // IANA timezone identifier
  role: z.enum(['owner', 'admin', 'member']),  // Deprecated - use role_label
  role_label: z.string(),  // Display label from backend (e.g., "Data Engineer", "Organization Administrator")
});

export type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>;

export const DepartmentSchema = z.object({
  department_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  path: z.string(),
  depth: z.number(),
  head_user_id: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  sort_order: z.number(),
  is_active: z.boolean(),
  member_count: z.number(),
  created_at: z.string().nullable().optional(),
});

export type Department = z.infer<typeof DepartmentSchema>;

export const DepartmentMembershipSchema = z.object({
  membership_id: z.string(),
  department_id: z.string(),
  department_name: z.string(),
  department_code: z.string(),
  department_color: z.string().nullable().optional(),
  role: z.enum(['admin', 'curator', 'editor', 'viewer']),
  is_primary: z.boolean(),
});

export type DepartmentMembership = z.infer<typeof DepartmentMembershipSchema>;

export const CurrentUserSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  name: z.string(),
  active_organization_id: z.string().nullable().optional(),
  permissions: z.array(z.string()),  // User's permissions in active org (e.g., ["data.view", "runs.execute"])
  role_label: z.string().nullable().optional(),  // Display label for role in active org
  organizations: z.array(OrganizationMembershipSchema),
  department_memberships: z.array(DepartmentMembershipSchema).nullable().optional().default([]),
  primary_department_id: z.string().nullable().optional(),
});

export type CurrentUser = z.infer<typeof CurrentUserSchema>;

// Organization update response
export const UpdateOrganizationResponseSchema = OrganizationSchema.extend({
  message: z.string(),
  updated_at: z.string(),
}).passthrough();

export type UpdateOrganizationResponse = z.infer<typeof UpdateOrganizationResponseSchema>;

// Organization users
export const OrganizationUserSchema = z.object({
  membership_id: z.string(),
  user_id: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  role_id: z.string(),
  role_key: z.string(),
  role_display_name: z.string(),
  status: z.string(),
  user_status: z.string(),
  created_at: z.string(),
}).passthrough();

export type OrganizationUser = z.infer<typeof OrganizationUserSchema>;

export const OrganizationUsersResponseSchema = z.object({
  organization_id: z.string(),
  users: z.array(OrganizationUserSchema),
  total: z.number(),
}).passthrough();

export type OrganizationUsersResponse = z.infer<typeof OrganizationUsersResponseSchema>;

// Roles
export const OrgRoleSchema = z.object({
  role_id: z.string(),
  role_key: z.string(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
}).passthrough();

export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const RolesResponseSchema = z.object({
  roles: z.array(OrgRoleSchema),
}).passthrough();

export type RolesResponse = z.infer<typeof RolesResponseSchema>;

// Storage regions
export const StorageRegionsResponseSchema = z.object({
  regions: z.array(StorageRegionSchema),
}).passthrough();

export type StorageRegionsResponse = z.infer<typeof StorageRegionsResponseSchema>;

// Timezones
export const TimezonesResponseSchema = z.object({
  timezones: z.array(z.string()),
}).passthrough();

export type TimezonesResponse = z.infer<typeof TimezonesResponseSchema>;

// Email events
export const EmailEventSchema = z.object({
  event_id: z.string(),
  email: z.string(),
  event_type: z.string(),
  bounce_type: z.string().nullable().optional(),
  bounce_subtype: z.string().nullable().optional(),
  complaint_feedback_type: z.string().nullable().optional(),
  message_id: z.string().nullable().optional(),
  sns_message_id: z.string().nullable().optional(),
  raw_message: z.record(z.string(), z.any()).nullable().optional(),
  created_at: z.string(),
}).passthrough();

export type EmailEvent = z.infer<typeof EmailEventSchema>;

export const EmailEventsResponseSchema = z.object({
  items: z.array(EmailEventSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type EmailEventsResponse = z.infer<typeof EmailEventsResponseSchema>;

export const EmailEventStatsSchema = z.object({
  last_30_days: z.object({
    bounces: z.number(),
    complaints: z.number(),
    total_events: z.number(),
  }).passthrough(),
  user_email_status: z.object({
    active: z.number(),
    bounced: z.number(),
    complaint: z.number(),
    total: z.number(),
  }).passthrough(),
}).passthrough();

export type EmailEventStats = z.infer<typeof EmailEventStatsSchema>;

export const UserEmailStatusSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  email_status: z.string(),
  status: z.string(),
  created_at: z.string(),
}).passthrough();

export type UserEmailStatus = z.infer<typeof UserEmailStatusSchema>;

export const UserEmailStatusResponseSchema = z.object({
  items: z.array(UserEmailStatusSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type UserEmailStatusResponse = z.infer<typeof UserEmailStatusResponseSchema>;

export const UpdateUserEmailStatusResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  email_status: z.string(),
  message: z.string(),
}).passthrough();

export type UpdateUserEmailStatusResponse = z.infer<typeof UpdateUserEmailStatusResponseSchema>;

// Overview preferences
export const OverviewPreferencesSchema = z.object({
  visible_dataset_ids: z.array(z.string()),
  dataset_order: z.array(z.string()).nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type OverviewPreferences = z.infer<typeof OverviewPreferencesSchema>;

// User profile
export const UserProfileResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  name: z.string(),
  timezone: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  message: z.string(),
}).passthrough();

export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;

export const AvatarUploadResponseSchema = z.object({
  avatar_url: z.string(),
  message: z.string(),
}).passthrough();

export type AvatarUploadResponse = z.infer<typeof AvatarUploadResponseSchema>;

// Page documentation
export const PageDocSchema = z.object({
  doc_id: z.string(),
  organization_id: z.string(),
  page_key: z.string(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  body_markdown: z.string(),
  audience: z.string(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type PageDoc = z.infer<typeof PageDocSchema>;

export const DeletePageDocResponseSchema = z.object({
  success: z.boolean(),
  deleted_page_key: z.string(),
}).passthrough();

export type DeletePageDocResponse = z.infer<typeof DeletePageDocResponseSchema>;

// Organization branding
export const OrganizationBrandingSchema = z.object({
  branding_id: z.string().nullable().optional(),
  organization_id: z.string(),
  logo_url: z.string().nullable().optional(),
  logo_s3_key: z.string().nullable().optional(),
  logo_width_px: z.number().nullable().optional(),
  letterhead_name: z.string().nullable().optional(),
  letterhead_address_line1: z.string().nullable().optional(),
  letterhead_address_line2: z.string().nullable().optional(),
  letterhead_city_state_zip: z.string().nullable().optional(),
  letterhead_country: z.string().nullable().optional(),
  letterhead_phone: z.string().nullable().optional(),
  letterhead_email: z.string().nullable().optional(),
  letterhead_website: z.string().nullable().optional(),
  footer_text: z.string().nullable().optional(),
  primary_color: z.string(),
  secondary_color: z.string(),
  accent_color: z.string(),
  signature_url: z.string().nullable().optional(),
  signature_s3_key: z.string().nullable().optional(),
  signature_name: z.string().nullable().optional(),
  signature_title: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type OrganizationBranding = z.infer<typeof OrganizationBrandingSchema>;

// Collection scope profile (issue #77) — what the collection covers + its limits.
export const CollectionProfileSchema = z.object({
  organization_id: z.string(),
  scope_note: z.string().nullable().optional(),
  coverage: z.record(z.string(), z.any()).nullable().optional(),
  completeness: z.string().nullable().optional(),
  extent_note: z.string().nullable().optional(),
  known_gaps: z.string().nullable().optional(),
  digitization_status: z.string().nullable().optional(),
}).passthrough();

export type CollectionProfile = z.infer<typeof CollectionProfileSchema>;

export const BrandingLogoResponseSchema = z.object({
  logo_url: z.string(),
  logo_s3_key: z.string(),
  message: z.string(),
}).passthrough();

export type BrandingLogoResponse = z.infer<typeof BrandingLogoResponseSchema>;

export const BrandingSignatureResponseSchema = z.object({
  signature_url: z.string(),
  signature_s3_key: z.string(),
  message: z.string(),
}).passthrough();

export type BrandingSignatureResponse = z.infer<typeof BrandingSignatureResponseSchema>;

// Document templates
export const DocumentTemplateSchema = z.object({
  template_id: z.string(),
  organization_id: z.string().nullable().optional(),
  template_type: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  is_default: z.boolean(),
  is_active: z.boolean(),
  is_system: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  terms_and_conditions: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>;

// Document preview
export const DocumentPreviewResponseSchema = z.object({
  pdf_base64: z.string(),
  filename: z.string(),
  size_bytes: z.number(),
}).passthrough();

export type DocumentPreviewResponse = z.infer<typeof DocumentPreviewResponseSchema>;

// Field access
export const FieldAccessPolicySchema = z.object({
  policy_id: z.string(),
  entity_type: z.string(),
  field_path: z.string(),
  policy_type: z.string(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  default_visible: z.boolean(),
  minimum_role: z.string().nullable().optional(),
}).passthrough();

export type FieldAccessPolicy = z.infer<typeof FieldAccessPolicySchema>;

export const FieldAccessPoliciesResponseSchema = z.object({
  policies: z.array(FieldAccessPolicySchema),
}).passthrough();

export type FieldAccessPoliciesResponse = z.infer<typeof FieldAccessPoliciesResponseSchema>;

export const FieldAccessGrantSchema = z.object({
  policy_id: z.string(),
  entity_type: z.string(),
  field_path: z.string(),
  can_view: z.boolean(),
  can_edit: z.boolean(),
}).passthrough();

export type FieldAccessGrant = z.infer<typeof FieldAccessGrantSchema>;

export const FieldAccessGrantsResponseSchema = z.object({
  grants: z.array(FieldAccessGrantSchema),
}).passthrough();

export type FieldAccessGrantsResponse = z.infer<typeof FieldAccessGrantsResponseSchema>;

export const FieldGrantInputSchema = z.object({
  policy_id: z.string(),
  can_view: z.boolean(),
  can_edit: z.boolean(),
}).passthrough();

export type FieldGrantInput = z.infer<typeof FieldGrantInputSchema>;

export const UpdateFieldGrantsResponseSchema = z.object({
  grants: z.array(FieldGrantInputSchema),
  message: z.string(),
}).passthrough();

export type UpdateFieldGrantsResponse = z.infer<typeof UpdateFieldGrantsResponseSchema>;
