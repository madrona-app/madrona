// Auto-generated from Pydantic models. Do not edit manually.
// Regenerate: cd backend && ./venv/bin/python ../scripts/generate-zod-schemas.py > ../frontend/src/lib/schemas/generated.ts

import { z } from 'zod';

export const AIConfigOutSchema = z.object({
  config_id: z.string().nullable().optional(),
  organization_id: z.string(),
  auto_tag_on_upload: z.boolean().nullable().optional(),
  detect_labels: z.boolean().nullable().optional(),
  detect_text: z.boolean().nullable().optional(),
  detect_faces: z.boolean().nullable().optional(),
  detect_celebrities: z.boolean().nullable().optional(),
  detect_moderation: z.boolean().nullable().optional(),
  extract_pdf_text: z.boolean().nullable().optional(),
  min_label_confidence: z.string().nullable().optional(),
  min_text_confidence: z.string().nullable().optional(),
  max_labels_per_image: z.number().nullable().optional(),
  monthly_budget_usd: z.string().nullable().optional(),
  current_month_usage: z.string().nullable().optional(),
  usage_reset_date: z.string().nullable().optional(),
  visual_search_threshold: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type AIConfigOut = z.infer<typeof AIConfigOutSchema>;

export const AIConfigResponseSchema = z.object({
  config: AIConfigOutSchema,
}).passthrough();

export type AIConfigResponse = z.infer<typeof AIConfigResponseSchema>;

export const TagDefinitionBriefSchema = z.object({
  definition_id: z.string(),
  tag_key: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
}).passthrough();

export type TagDefinitionBrief = z.infer<typeof TagDefinitionBriefSchema>;

export const AITagMappingOutSchema = z.object({
  mapping_id: z.string(),
  organization_id: z.string(),
  ai_tag_type: z.string().nullable().optional(),
  ai_tag_value: z.string().nullable().optional(),
  definition_id: z.string().nullable().optional(),
  definition: TagDefinitionBriefSchema.nullable().optional(),
  mapped_value: z.string().nullable().optional(),
  auto_apply: z.boolean().nullable().optional(),
  min_confidence: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type AITagMappingOut = z.infer<typeof AITagMappingOutSchema>;

export const AITagMappingCreatedResponseSchema = z.object({
  mapping: AITagMappingOutSchema,
}).passthrough();

export type AITagMappingCreatedResponse = z.infer<typeof AITagMappingCreatedResponseSchema>;

export const AITagMappingListResponseSchema = z.object({
  mappings: z.array(AITagMappingOutSchema),
}).passthrough();

export type AITagMappingListResponse = z.infer<typeof AITagMappingListResponseSchema>;

export const AITagMappingUpdatedResponseSchema = z.object({
  mapping: AITagMappingOutSchema,
}).passthrough();

export type AITagMappingUpdatedResponse = z.infer<typeof AITagMappingUpdatedResponseSchema>;

export const BBoxOutSchema = z.object({
  left: z.string().nullable().optional(),
  top: z.string().nullable().optional(),
  width: z.string().nullable().optional(),
  height: z.string().nullable().optional(),
}).passthrough();

export type BBoxOut = z.infer<typeof BBoxOutSchema>;

export const AITagOutSchema = z.object({
  ai_tag_id: z.string(),
  media_id: z.string(),
  tag_type: z.string().nullable().optional(),
  tag_value: z.string().nullable().optional(),
  confidence: z.string().nullable().optional(),
  metadata: z.any().nullable().optional(),
  bbox: BBoxOutSchema.nullable().optional(),
  provider: z.string().nullable().optional(),
  model_version: z.string().nullable().optional(),
  processed_at: z.string().nullable().optional(),
  mapped_to_definition_id: z.string().nullable().optional(),
  mapping_status: z.string().nullable().optional(),
}).passthrough();

export type AITagOut = z.infer<typeof AITagOutSchema>;

export const AITagSuggestionOutSchema = z.object({
  ai_tag_type: z.string(),
  ai_tag_value: z.string(),
  occurrence_count: z.number(),
  avg_confidence: z.number(),
  sample_media_ids: z.array(z.string()),
}).passthrough();

export type AITagSuggestionOut = z.infer<typeof AITagSuggestionOutSchema>;

export const AITagSuggestionsResponseSchema = z.object({
  suggestions: z.array(AITagSuggestionOutSchema),
  total: z.number(),
}).passthrough();

export type AITagSuggestionsResponse = z.infer<typeof AITagSuggestionsResponseSchema>;

export const AITagUpdatedResponseSchema = z.object({
  ai_tag: AITagOutSchema,
}).passthrough();

export type AITagUpdatedResponse = z.infer<typeof AITagUpdatedResponseSchema>;

export const AITaggingStatsResponseSchema = z.object({
  total_media: z.number(),
  pending_count: z.number(),
  processing_count: z.number(),
  completed_count: z.number(),
  failed_count: z.number(),
  skipped_count: z.number(),
  total_ai_tags: z.number(),
  tags_by_type: z.record(z.string(), z.number()),
  unmapped_tags_count: z.number(),
  monthly_usage_usd: z.string().nullable().optional(),
  monthly_budget_usd: z.string().nullable().optional(),
}).passthrough();

export type AITaggingStatsResponse = z.infer<typeof AITaggingStatsResponseSchema>;

export const AITaskQueuedResponseSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  message: z.string(),
}).passthrough();

export type AITaskQueuedResponse = z.infer<typeof AITaskQueuedResponseSchema>;

export const APIKeyDataOutSchema = z.object({
  api_key_id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()).optional(),
  key_prefix: z.string(),
  secret_api_key: z.string().nullable().optional(),
  status: z.string(),
  expires_at: z.string().nullable().optional(),
  created_at: z.string(),
  last_used_at: z.string().nullable().optional(),
}).passthrough();

export type APIKeyDataOut = z.infer<typeof APIKeyDataOutSchema>;

export const APIKeyListOutSchema = z.object({
  api_key_id: z.string(),
  name: z.string(),
  scopes: z.array(z.any()).optional(),
  key_prefix: z.string(),
  status: z.string(),
  expires_at: z.string().nullable().optional(),
  created_at: z.string(),
  last_used_at: z.string().nullable().optional(),
}).passthrough();

export type APIKeyListOut = z.infer<typeof APIKeyListOutSchema>;

export const APIKeyListResponseSchema = z.object({
  api_keys: z.array(APIKeyListOutSchema),
}).passthrough();

export type APIKeyListResponse = z.infer<typeof APIKeyListResponseSchema>;

export const AcceptInvitationBodySchema = z.object({
  token: z.string(),
}).passthrough();

export type AcceptInvitationBody = z.infer<typeof AcceptInvitationBodySchema>;

export const AcceptInvitationResponseSchema = z.object({
  membership_id: z.string(),
  organization_id: z.string(),
  user_id: z.string(),
  role: z.string(),
  created_at: z.string(),
}).passthrough();

export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>;

export const AcquisitionListResponseSchema = z.object({
  items: z.array(z.any()).optional(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type AcquisitionListResponse = z.infer<typeof AcquisitionListResponseSchema>;

export const AcquisitionObjectOutSchema = z.object({
  acquisition_object_id: z.string(),
  acquisition_id: z.string(),
  object_id: z.string(),
  organization_id: z.string(),
  note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  object: z.record(z.string(), z.any()).nullable().optional(),
}).passthrough();

export type AcquisitionObjectOut = z.infer<typeof AcquisitionObjectOutSchema>;

export const AcquisitionObjectListResponseSchema = z.object({
  objects: z.array(AcquisitionObjectOutSchema),
  total: z.number(),
}).passthrough();

export type AcquisitionObjectListResponse = z.infer<typeof AcquisitionObjectListResponseSchema>;

export const AcquisitionOutSchema = z.object({
  acquisition_id: z.string(),
  organization_id: z.string(),
  acquisition_number: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type AcquisitionOut = z.infer<typeof AcquisitionOutSchema>;

export const PreservationActionPlanOutSchema = z.object({
  action_id: z.string(),
  organization_id: z.string(),
  policy_id: z.string(),
  media_id: z.string(),
  action_type: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  scheduled_for: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  result: z.any().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type PreservationActionPlanOut = z.infer<typeof PreservationActionPlanOutSchema>;

export const OffsetPaginationPageSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
}).passthrough();

export type OffsetPaginationPage = z.infer<typeof OffsetPaginationPageSchema>;

export const ActionPlanListResponseSchema = z.object({
  items: z.array(PreservationActionPlanOutSchema),
  total: z.number(),
  page: OffsetPaginationPageSchema,
}).passthrough();

export type ActionPlanListResponse = z.infer<typeof ActionPlanListResponseSchema>;

export const ActionRunResponseSchema = z.object({
  run_id: z.string(),
  action: z.string().nullable().optional(),
  action_params: z.any().nullable().optional(),
  status: z.string().nullable().optional(),
  total_count: z.number().nullable().optional(),
  processed_count: z.number().nullable().optional(),
  success_count: z.number().nullable().optional(),
  error_count: z.number().nullable().optional(),
  results: z.any().nullable().optional(),
  error_message: z.string().nullable().optional(),
  artifact_url: z.string().nullable().optional(),
  artifact_expires_at: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ActionRunResponse = z.infer<typeof ActionRunResponseSchema>;

export const ActivateAccountBodySchema = z.object({
  token: z.string(),
  password: z.string(),
}).passthrough();

export type ActivateAccountBody = z.infer<typeof ActivateAccountBodySchema>;

export const ActivateAccountResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  access_token: z.string(),
  active_organization_id: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type ActivateAccountResponse = z.infer<typeof ActivateAccountResponseSchema>;

export const ContextWorkspaceDetailSchema = z.object({
  workspace_id: z.string(),
  name: z.string().nullable().optional(),
  asset_count: z.number().nullable().optional(),
}).passthrough();

export type ContextWorkspaceDetail = z.infer<typeof ContextWorkspaceDetailSchema>;

export const ContextAssetDetailSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
}).passthrough();

export type ContextAssetDetail = z.infer<typeof ContextAssetDetailSchema>;

export const ActiveContextOutSchema = z.object({
  type: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
  set_at: z.string().nullable().optional(),
  workspace: ContextWorkspaceDetailSchema.nullable().optional(),
  asset: ContextAssetDetailSchema.nullable().optional(),
}).passthrough();

export type ActiveContextOut = z.infer<typeof ActiveContextOutSchema>;

export const ActiveContextResponseSchema = z.object({
  context: ActiveContextOutSchema.nullable().optional(),
}).passthrough();

export type ActiveContextResponse = z.infer<typeof ActiveContextResponseSchema>;

export const ActiveOrganizationResponseSchema = z.object({
  active_organization_id: z.string(),
}).passthrough();

export type ActiveOrganizationResponse = z.infer<typeof ActiveOrganizationResponseSchema>;

export const ActivityEntryOutSchema = z.object({
  id: z.string(),
  kind: z.string(),
  text: z.string(),
  href: z.string().nullable().optional(),
  timestamp: z.number(),
}).passthrough();

export type ActivityEntryOut = z.infer<typeof ActivityEntryOutSchema>;

export const ActivityResponseSchema = z.object({
  entries: z.array(ActivityEntryOutSchema),
}).passthrough();

export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

export const AgreementResponseSchema = z.object({
  link_id: z.string(),
  agreement_signed: z.boolean(),
  agreement_signed_date: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type AgreementResponse = z.infer<typeof AgreementResponseSchema>;

export const AipManifestResponseSchema = z.object({
}).passthrough();

export type AipManifestResponse = z.infer<typeof AipManifestResponseSchema>;

export const AlertTypeCountsSchema = z.object({
  rights: z.number().optional(),
  consent: z.number().optional(),
}).passthrough();

export type AlertTypeCounts = z.infer<typeof AlertTypeCountsSchema>;

export const AlternativeCreatedResponseSchema = z.object({
  alternative_id: z.string(),
  filename: z.string().nullable().optional(),
}).passthrough();

export type AlternativeCreatedResponse = z.infer<typeof AlternativeCreatedResponseSchema>;

export const AlternativeDownloadResponseSchema = z.object({
  download_url: z.string(),
  filename: z.string().nullable().optional(),
}).passthrough();

export type AlternativeDownloadResponse = z.infer<typeof AlternativeDownloadResponseSchema>;

export const AlternativeOutSchema = z.object({
  alternative_id: z.string(),
  alternative_type: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  generated_by: z.string().nullable().optional(),
  generation_params: z.any().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type AlternativeOut = z.infer<typeof AlternativeOutSchema>;

export const AnnotationCreatedResponseSchema = z.object({
  annotation_id: z.string(),
  target_selector: z.any(),
  body: z.any().nullable().optional(),
  motivation: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type AnnotationCreatedResponse = z.infer<typeof AnnotationCreatedResponseSchema>;

export const AnnotationOutSchema = z.object({
  annotation_id: z.string(),
  target_selector: z.any(),
  body: z.any().nullable().optional(),
  motivation: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type AnnotationOut = z.infer<typeof AnnotationOutSchema>;

export const AnnotationListResponseSchema = z.object({
  media_id: z.string(),
  annotations: z.array(AnnotationOutSchema),
}).passthrough();

export type AnnotationListResponse = z.infer<typeof AnnotationListResponseSchema>;

export const AnnotationUpdatedResponseSchema = z.object({
  annotation_id: z.string(),
  target_selector: z.any(),
  body: z.any().nullable().optional(),
  motivation: z.string().nullable().optional(),
}).passthrough();

export type AnnotationUpdatedResponse = z.infer<typeof AnnotationUpdatedResponseSchema>;

export const AppRoleOutSchema = z.object({
  role_id: z.string(),
  role_key: z.string(),
  role_display_name: z.string(),
}).passthrough();

export type AppRoleOut = z.infer<typeof AppRoleOutSchema>;

export const ApplicationOutSchema = z.object({
  key: z.string(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
}).passthrough();

export type ApplicationOut = z.infer<typeof ApplicationOutSchema>;

export const ApplicationsListResponseSchema = z.object({
  applications: z.array(ApplicationOutSchema),
}).passthrough();

export type ApplicationsListResponse = z.infer<typeof ApplicationsListResponseSchema>;

export const ApplyWatermarkResponseSchema = z.object({
  job_id: z.string(),
  media_id: z.string(),
  template_id: z.string(),
  status: z.string(),
  message: z.string(),
}).passthrough();

export type ApplyWatermarkResponse = z.infer<typeof ApplyWatermarkResponseSchema>;

export const ObjectReviewAssessmentOutSchema = z.object({
  assessment_id: z.string(),
  review_id: z.string(),
  object_id: z.string(),
  reviewer_id: z.string().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
  scores: z.any().optional(),
  overall_score: z.number().nullable().optional(),
  recommendation: z.string().nullable().optional(),
  justification: z.string().nullable().optional(),
  follow_up_required: z.boolean().nullable().optional(),
  follow_up_notes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).passthrough();

export type ObjectReviewAssessmentOut = z.infer<typeof ObjectReviewAssessmentOutSchema>;

export const AssessmentListResponseSchema = z.object({
  items: z.array(ObjectReviewAssessmentOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type AssessmentListResponse = z.infer<typeof AssessmentListResponseSchema>;

export const AssignTaskBodySchema = z.object({
  assigned_to_user_id: z.string().nullable().optional(),
}).passthrough();

export type AssignTaskBody = z.infer<typeof AssignTaskBodySchema>;

export const AssignTaskResponseSchema = z.object({
  success: z.boolean().optional(),
  assigned_to_user_id: z.string().nullable().optional(),
  assigned_to_name: z.string().nullable().optional(),
}).passthrough();

export type AssignTaskResponse = z.infer<typeof AssignTaskResponseSchema>;

export const AssignableUserOutSchema = z.object({
  user_id: z.string(),
  name: z.string(),
  email: z.string(),
}).passthrough();

export type AssignableUserOut = z.infer<typeof AssignableUserOutSchema>;

export const AssignableUsersResponseSchema = z.object({
  users: z.array(AssignableUserOutSchema),
}).passthrough();

export type AssignableUsersResponse = z.infer<typeof AssignableUsersResponseSchema>;

export const AtRiskMediaItemSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  pronom_puid: z.string().nullable().optional(),
  format_name: z.string().nullable().optional(),
  format_risk_level: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type AtRiskMediaItem = z.infer<typeof AtRiskMediaItemSchema>;

export const AtRiskMediaResponseSchema = z.object({
  items: z.array(AtRiskMediaItemSchema),
  total: z.number(),
  page: OffsetPaginationPageSchema,
}).passthrough();

export type AtRiskMediaResponse = z.infer<typeof AtRiskMediaResponseSchema>;

export const AttentionItemOutSchema = z.object({
  id: z.string(),
  label: z.string(),
  due_date: z.string().nullable().optional(),
  severity: z.string().nullable().optional(),
  href: z.string().nullable().optional(),
}).passthrough();

export type AttentionItemOut = z.infer<typeof AttentionItemOutSchema>;

export const AttentionCategoryOutSchema = z.object({
  total: z.number(),
  samples: z.array(AttentionItemOutSchema),
}).passthrough();

export type AttentionCategoryOut = z.infer<typeof AttentionCategoryOutSchema>;

export const AttentionItemV2OutSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.string(),
  ref_number: z.string(),
  title: z.string(),
  context: z.string(),
  href: z.string(),
}).passthrough();

export type AttentionItemV2Out = z.infer<typeof AttentionItemV2OutSchema>;

export const AttentionSummaryResponseSchema = z.object({
  loans: AttentionCategoryOutSchema,
  rights: AttentionCategoryOutSchema,
  audits: AttentionCategoryOutSchema,
}).passthrough();

export type AttentionSummaryResponse = z.infer<typeof AttentionSummaryResponseSchema>;

export const AttentionV2ResponseSchema = z.object({
  items: z.array(AttentionItemV2OutSchema),
}).passthrough();

export type AttentionV2Response = z.infer<typeof AttentionV2ResponseSchema>;

export const AuditCampaignOutSchema = z.object({
  audit_id: z.string(),
  organization_id: z.string(),
  audit_number: z.string().nullable().optional(),
  title: z.string(),
  audit_type: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  methodology: z.string().nullable().optional(),
  sample_method: z.string().nullable().optional(),
  sample_size: z.number().nullable().optional(),
  sample_percentage: z.number().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  items_total: z.number().nullable().optional(),
  items_audited: z.number().nullable().optional(),
  discrepancies_found: z.number().nullable().optional(),
  accuracy_rate: z.number().nullable().optional(),
  findings_summary: z.string().nullable().optional(),
  remedial_actions: z.any().optional(),
  status: z.string().nullable().optional(),
  lead_auditor: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type AuditCampaignOut = z.infer<typeof AuditCampaignOutSchema>;

export const AuditCampaignListResponseSchema = z.object({
  items: z.array(AuditCampaignOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type AuditCampaignListResponse = z.infer<typeof AuditCampaignListResponseSchema>;

export const AuditEventOutSchema = z.object({
  event_id: z.string(),
  change_type: z.string().nullable().optional(),
  changed_at: z.string().nullable().optional(),
  changed_by: z.string().nullable().optional(),
  changed_by_name: z.string().nullable().optional(),
  changed_by_email: z.string().nullable().optional(),
  changed_fields: z.array(z.string()).nullable().optional(),
  summary: z.string().nullable().optional(),
  request_method: z.string().nullable().optional(),
  field_diffs: z.array(z.any()).nullable().optional(),
}).passthrough();

export type AuditEventOut = z.infer<typeof AuditEventOutSchema>;

export const AuditLogOutSchema = z.object({
  audit_log_id: z.string(),
  organization_id: z.string(),
  acting_user_id: z.string(),
  target_user_id: z.string().nullable().optional(),
  action: z.string(),
  details: z.any().nullable().optional(),
  created_at: z.string(),
}).passthrough();

export type AuditLogOut = z.infer<typeof AuditLogOutSchema>;

export const PageInfoOutSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
}).passthrough();

export type PageInfoOut = z.infer<typeof PageInfoOutSchema>;

export const AuditLogListResponseSchema = z.object({
  items: z.array(AuditLogOutSchema),
  total: z.number(),
  page: PageInfoOutSchema,
}).passthrough();

export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;

export const AuditResultOutSchema = z.object({
  result_id: z.string(),
  audit_id: z.string(),
  object_id: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  auditor_id: z.string().nullable().optional(),
  audited_at: z.string().nullable().optional(),
  location_verified: z.boolean().nullable().optional(),
  expected_location_id: z.string().nullable().optional(),
  actual_location_id: z.string().nullable().optional(),
  condition_verified: z.boolean().nullable().optional(),
  expected_condition: z.string().nullable().optional(),
  actual_condition: z.string().nullable().optional(),
  documentation_verified: z.boolean().nullable().optional(),
  documentation_issues: z.any().optional(),
  discrepancy_found: z.boolean().nullable().optional(),
  discrepancy_type: z.string().nullable().optional(),
  discrepancy_description: z.string().nullable().optional(),
  resolution_status: z.string().nullable().optional(),
  resolution_notes: z.string().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).passthrough();

export type AuditResultOut = z.infer<typeof AuditResultOutSchema>;

export const AuditResultListResponseSchema = z.object({
  items: z.array(AuditResultOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type AuditResultListResponse = z.infer<typeof AuditResultListResponseSchema>;

export const OrgAuditCountSchema = z.object({
  organization_id: z.string(),
  name: z.string(),
  count: z.number(),
}).passthrough();

export type OrgAuditCount = z.infer<typeof OrgAuditCountSchema>;

export const UserAuditCountSchema = z.object({
  user_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  count: z.number(),
}).passthrough();

export type UserAuditCount = z.infer<typeof UserAuditCountSchema>;

export const AuditStatsDetailSchema = z.object({
  total_events: z.number(),
  by_entity_type: z.record(z.string(), z.number()).optional(),
  by_change_type: z.record(z.string(), z.number()).optional(),
  by_organization: z.array(OrgAuditCountSchema).optional(),
  by_user: z.array(UserAuditCountSchema).optional(),
  events_last_24h: z.number().optional(),
  events_last_7d: z.number().optional(),
  events_last_30d: z.number().optional(),
}).passthrough();

export type AuditStatsDetail = z.infer<typeof AuditStatsDetailSchema>;

export const PersonAuthorityRelationOutSchema = z.object({
  relation_id: z.string(),
  source_authority_id: z.string(),
  related_authority_id: z.string(),
  relationship_type: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).passthrough();

export type PersonAuthorityRelationOut = z.infer<typeof PersonAuthorityRelationOutSchema>;

export const AuthorityRelationsResponseSchema = z.object({
  outgoing_relations: z.array(PersonAuthorityRelationOutSchema),
  incoming_relations: z.array(PersonAuthorityRelationOutSchema),
}).passthrough();

export type AuthorityRelationsResponse = z.infer<typeof AuthorityRelationsResponseSchema>;

export const AuthoritySearchResultItemSchema = z.object({
  id: z.string(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  authority_id: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
}).passthrough();

export type AuthoritySearchResultItem = z.infer<typeof AuthoritySearchResultItemSchema>;

export const AuthoritySearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(AuthoritySearchResultItemSchema),
}).passthrough();

export type AuthoritySearchResponse = z.infer<typeof AuthoritySearchResponseSchema>;

export const AutocompleteDebugOutSchema = z.object({
  field_type: z.string(),
  sources_requested: z.array(z.string()),
  sources_for_field: z.array(z.string()),
  query_length: z.number(),
  local_count: z.number(),
  external_count: z.number(),
}).passthrough();

export type AutocompleteDebugOut = z.infer<typeof AutocompleteDebugOutSchema>;

export const AutocompleteReferenceOutSchema = z.object({
  uri: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  match_confidence: z.string().nullable().optional(),
}).passthrough();

export type AutocompleteReferenceOut = z.infer<typeof AutocompleteReferenceOutSchema>;

export const AutocompleteResponseSchema = z.object({
  suggestions: z.array(z.any()).nullable().optional(),
}).passthrough();

export type AutocompleteResponse = z.infer<typeof AutocompleteResponseSchema>;

export const AutocompleteSearchBodySchema = z.object({
  query: z.string(),
  field_type: z.string(),
  organization_id: z.string(),
  limit: z.number().optional(),
  sources: z.array(z.string()).nullable().optional(),
}).passthrough();

export type AutocompleteSearchBody = z.infer<typeof AutocompleteSearchBodySchema>;

export const AutocompleteSuggestionOutSchema = z.object({
  value: z.string(),
  entity_key: z.string(),
  highlight: z.string().nullable().optional(),
}).passthrough();

export type AutocompleteSuggestionOut = z.infer<typeof AutocompleteSuggestionOutSchema>;

export const AutocompleteSearchResponseSchema = z.object({
  query: z.string(),
  suggestions: z.array(AutocompleteSuggestionOutSchema),
  external_searched: z.boolean(),
  warnings: z.array(z.string()).nullable().optional(),
  search_time_ms: z.number(),
  debug: AutocompleteDebugOutSchema,
}).passthrough();

export type AutocompleteSearchResponse = z.infer<typeof AutocompleteSearchResponseSchema>;

export const AvailableObjectItemSchema = z.object({
  source_type: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  source_system: z.string().nullable().optional(),
}).passthrough();

export type AvailableObjectItem = z.infer<typeof AvailableObjectItemSchema>;

export const AvailableObjectsResponseSchema = z.object({
  objects: z.array(AvailableObjectItemSchema),
  source_mode: z.string().nullable().optional(),
  count: z.number(),
}).passthrough();

export type AvailableObjectsResponse = z.infer<typeof AvailableObjectsResponseSchema>;

export const OnDemandReportDefSchema = z.object({
  report_key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  supported_formats: z.array(z.string()).nullable().optional(),
  default_format: z.string().nullable().optional(),
}).passthrough();

export type OnDemandReportDef = z.infer<typeof OnDemandReportDefSchema>;

export const AvailableReportsResponseSchema = z.object({
  reports: z.array(OnDemandReportDefSchema),
  total: z.number(),
}).passthrough();

export type AvailableReportsResponse = z.infer<typeof AvailableReportsResponseSchema>;

export const AvailableRoleOutSchema = z.object({
  role_id: z.string(),
  role_key: z.string(),
  display_name: z.string(),
}).passthrough();

export type AvailableRoleOut = z.infer<typeof AvailableRoleOutSchema>;

export const AvatarResponseSchema = z.object({
  avatar_url: z.string().nullable().optional(),
  message: z.string(),
}).passthrough();

export type AvatarResponse = z.infer<typeof AvatarResponseSchema>;

export const EnumValueLabelSchema = z.object({
  value: z.string(),
  label: z.string(),
}).passthrough();

export type EnumValueLabel = z.infer<typeof EnumValueLabelSchema>;

export const BarcodeEnumsResponseSchema = z.object({
  entity_types: z.array(EnumValueLabelSchema),
  label_formats: z.array(EnumValueLabelSchema),
  label_statuses: z.array(EnumValueLabelSchema),
  action_types: z.array(EnumValueLabelSchema),
  result_statuses: z.array(EnumValueLabelSchema),
}).passthrough();

export type BarcodeEnumsResponse = z.infer<typeof BarcodeEnumsResponseSchema>;

export const BarcodeLabelOutSchema = z.object({
  label_id: z.string(),
  organization_id: z.string(),
  department_id: z.string().nullable().optional(),
  entity_type: z.string(),
  entity_type_label: z.string(),
  entity_id: z.string(),
  barcode_value: z.string(),
  label_format: z.string(),
  label_format_label: z.string(),
  is_printed: z.boolean(),
  print_count: z.number(),
  last_printed_at: z.string().nullable().optional(),
  batch_id: z.string().nullable().optional(),
  status: z.string(),
  status_label: z.string(),
  note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  entity_summary: z.any().optional(),
  public_url: z.string().nullable().optional(),
}).passthrough();

export type BarcodeLabelOut = z.infer<typeof BarcodeLabelOutSchema>;

export const BarcodeLabelBatchResponseSchema = z.object({
  labels: z.array(BarcodeLabelOutSchema),
  batch_id: z.string(),
  count: z.number(),
}).passthrough();

export type BarcodeLabelBatchResponse = z.infer<typeof BarcodeLabelBatchResponseSchema>;

export const LabelsSummarySchema = z.object({
  total_active: z.number(),
  total_void: z.number(),
  total_printed: z.number(),
  total_unprinted: z.number(),
}).passthrough();

export type LabelsSummary = z.infer<typeof LabelsSummarySchema>;

export const BarcodeLabelListResponseSchema = z.object({
  items: z.array(BarcodeLabelOutSchema),
  summary: LabelsSummarySchema,
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type BarcodeLabelListResponse = z.infer<typeof BarcodeLabelListResponseSchema>;

export const BarcodeLookupResponseSchema = z.object({
  found: z.boolean(),
  barcode_value: z.string(),
  entity_type: z.string(),
  entity_type_label: z.string(),
  entity_id: z.string(),
  entity_summary: z.any().optional(),
}).passthrough();

export type BarcodeLookupResponse = z.infer<typeof BarcodeLookupResponseSchema>;

export const BarcodeScanOutSchema = z.object({
  scan_id: z.string(),
  organization_id: z.string(),
  department_id: z.string().nullable().optional(),
  barcode_value: z.string(),
  resolved_entity_type: z.string().nullable().optional(),
  resolved_entity_type_label: z.string().nullable().optional(),
  resolved_entity_id: z.string().nullable().optional(),
  action_type: z.string(),
  action_type_label: z.string(),
  scan_location_id: z.string().nullable().optional(),
  device_id: z.string().nullable().optional(),
  device_name: z.string().nullable().optional(),
  campaign_id: z.string().nullable().optional(),
  movement_id: z.string().nullable().optional(),
  result_status: z.string(),
  result_status_label: z.string(),
  note: z.string().nullable().optional(),
  scanned_at: z.string().nullable().optional(),
  scanned_by: z.string().nullable().optional(),
  entity_summary: z.any().optional(),
  action_detail: z.any().optional(),
}).passthrough();

export type BarcodeScanOut = z.infer<typeof BarcodeScanOutSchema>;

export const BarcodeScanListResponseSchema = z.object({
  items: z.array(BarcodeScanOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type BarcodeScanListResponse = z.infer<typeof BarcodeScanListResponseSchema>;

export const BarcodeStatsResponseSchema = z.object({
  labels_active: z.number(),
  labels_void: z.number(),
  scans_today: z.number(),
  scans_this_week: z.number(),
  unresolved_count: z.number(),
}).passthrough();

export type BarcodeStatsResponse = z.infer<typeof BarcodeStatsResponseSchema>;

export const BatchCreateResponseSchema = z.object({
  created: z.number(),
  skipped: z.number(),
  errors: z.array(z.any()),
}).passthrough();

export type BatchCreateResponse = z.infer<typeof BatchCreateResponseSchema>;

export const BatchExportOutSchema = z.object({
  objects: z.array(z.any()),
  profile: z.string(),
  count: z.number(),
}).passthrough();

export type BatchExportOut = z.infer<typeof BatchExportOutSchema>;

export const BatchLabelEntrySchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
}).passthrough();

export type BatchLabelEntry = z.infer<typeof BatchLabelEntrySchema>;

export const BatchLodAssessmentOutSchema = z.object({
  averageScore: z.number(),
  objects: z.array(z.any()),
}).passthrough();

export type BatchLodAssessmentOut = z.infer<typeof BatchLodAssessmentOutSchema>;

export const SuccessResponseSchema = z.object({
  success: z.boolean().optional(),
}).passthrough();

export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;

export const BatchOperationResponseSchema = z.object({
  success: z.boolean().optional(),
  operation: z.string(),
  processed: z.number().nullable().optional(),
  queued: z.number().nullable().optional(),
}).passthrough();

export type BatchOperationResponse = z.infer<typeof BatchOperationResponseSchema>;

export const BboxSearchResponseSchema = z.object({
  entities: z.array(z.any()),
  count: z.number(),
}).passthrough();

export type BboxSearchResponse = z.infer<typeof BboxSearchResponseSchema>;

export const BrandingOutSchema = z.object({
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
  primary_color: z.string().nullable().optional(),
  secondary_color: z.string().nullable().optional(),
  accent_color: z.string().nullable().optional(),
  signature_url: z.string().nullable().optional(),
  signature_s3_key: z.string().nullable().optional(),
  signature_name: z.string().nullable().optional(),
  signature_title: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type BrandingOut = z.infer<typeof BrandingOutSchema>;

export const BudgetEnumItemSchema = z.object({
  value: z.string(),
  label: z.string(),
}).passthrough();

export type BudgetEnumItem = z.infer<typeof BudgetEnumItemSchema>;

export const BudgetEnumsResponseSchema = z.object({
  categories: z.array(BudgetEnumItemSchema),
  link_entity_types: z.array(BudgetEnumItemSchema),
}).passthrough();

export type BudgetEnumsResponse = z.infer<typeof BudgetEnumsResponseSchema>;

export const BudgetLinkOutSchema = z.object({
  link_id: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  label: z.string().nullable().optional(),
}).passthrough();

export type BudgetLinkOut = z.infer<typeof BudgetLinkOutSchema>;

export const BudgetLineOutSchema = z.object({
  line_id: z.string(),
  exhibition_id: z.string(),
  category: z.string(),
  category_label: z.string(),
  description: z.string().nullable().optional(),
  estimated_amount: z.number(),
  actual_amount: z.number().nullable().optional(),
  vendor: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  sort_order: z.number(),
  currency_code: z.string(),
  links: z.array(BudgetLinkOutSchema),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type BudgetLineOut = z.infer<typeof BudgetLineOutSchema>;

export const CategoryTotalsSchema = z.object({
  category: z.string(),
  category_label: z.string(),
  estimated: z.number(),
  actual: z.number(),
  variance: z.number(),
  count: z.number(),
}).passthrough();

export type CategoryTotals = z.infer<typeof CategoryTotalsSchema>;

export const BudgetTotalsSchema = z.object({
  by_category: z.array(CategoryTotalsSchema),
  total_estimated: z.number(),
  total_actual: z.number(),
  total_variance: z.number(),
  line_count: z.number(),
}).passthrough();

export type BudgetTotals = z.infer<typeof BudgetTotalsSchema>;

export const BudgetLinesListResponseSchema = z.object({
  lines: z.array(BudgetLineOutSchema).nullable().optional(),
  groups: z.array(z.any()).nullable().optional(),
  totals: BudgetTotalsSchema,
  currency_code: z.string(),
}).passthrough();

export type BudgetLinesListResponse = z.infer<typeof BudgetLinesListResponseSchema>;

export const BudgetSummaryResponseSchema = z.object({
  by_category: z.array(CategoryTotalsSchema),
  total_estimated: z.number(),
  total_actual: z.number(),
  total_variance: z.number(),
  line_count: z.number(),
  currency_code: z.string(),
}).passthrough();

export type BudgetSummaryResponse = z.infer<typeof BudgetSummaryResponseSchema>;

export const BulkActionAsyncResponseSchema = z.object({
  run_id: z.string(),
  status: z.string(),
  total_count: z.number(),
  message: z.string(),
}).passthrough();

export type BulkActionAsyncResponse = z.infer<typeof BulkActionAsyncResponseSchema>;

export const BulkActionConfigOutSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().nullable().optional(),
  required_params: z.array(z.string()).nullable().optional(),
  optional_params: z.array(z.string()).nullable().optional(),
  is_async: z.boolean().nullable().optional(),
  requires_permission: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  download_options: z.array(z.any()).nullable().optional(),
}).passthrough();

export type BulkActionConfigOut = z.infer<typeof BulkActionConfigOutSchema>;

export const BulkActionResultItemSchema = z.object({
  media_id: z.string(),
  status: z.string(),
  message: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
  artifact_url: z.string().nullable().optional(),
}).passthrough();

export type BulkActionResultItem = z.infer<typeof BulkActionResultItemSchema>;

export const BulkActionExecuteResponseSchema = z.object({
  action: z.string(),
  status: z.string(),
  workspace_id: z.string(),
  total_count: z.number(),
  success_count: z.number(),
  error_count: z.number(),
  results: z.array(BulkActionResultItemSchema),
}).passthrough();

export type BulkActionExecuteResponse = z.infer<typeof BulkActionExecuteResponseSchema>;

export const BulkActionOutSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  required_params: z.array(z.string()),
  optional_params: z.array(z.string()),
}).passthrough();

export type BulkActionOut = z.infer<typeof BulkActionOutSchema>;

export const BulkActionListResponseSchema = z.object({
  workspace_id: z.string(),
  actions: z.array(BulkActionOutSchema),
}).passthrough();

export type BulkActionListResponse = z.infer<typeof BulkActionListResponseSchema>;

export const PreviewAssetOutSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  warnings: z.array(z.string()).nullable().optional(),
}).passthrough();

export type PreviewAssetOut = z.infer<typeof PreviewAssetOutSchema>;

export const BulkActionPreviewResponseSchema = z.object({
  action: z.string(),
  action_label: z.string().nullable().optional(),
  workspace_id: z.string(),
  workspace_name: z.string().nullable().optional(),
  assets: z.array(PreviewAssetOutSchema),
  total_count: z.number(),
  has_warnings: z.boolean().nullable().optional(),
  total_size_bytes: z.number().nullable().optional(),
  warnings: z.array(z.string()).nullable().optional(),
}).passthrough();

export type BulkActionPreviewResponse = z.infer<typeof BulkActionPreviewResponseSchema>;

export const ValidationAllowedItemSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
}).passthrough();

export type ValidationAllowedItem = z.infer<typeof ValidationAllowedItemSchema>;

export const ValidationBlockedItemSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
}).passthrough();

export type ValidationBlockedItem = z.infer<typeof ValidationBlockedItemSchema>;

export const BulkActionValidateResponseSchema = z.object({
  action: z.string(),
  action_valid: z.boolean(),
  allowed: z.array(ValidationAllowedItemSchema),
  blocked: z.array(ValidationBlockedItemSchema),
  allowed_count: z.number(),
  blocked_count: z.number(),
  error: z.string().nullable().optional(),
}).passthrough();

export type BulkActionValidateResponse = z.infer<typeof BulkActionValidateResponseSchema>;

export const BulkActionsListResponseSchema = z.object({
  actions: z.array(BulkActionConfigOutSchema),
}).passthrough();

export type BulkActionsListResponse = z.infer<typeof BulkActionsListResponseSchema>;

export const BulkOpResultSchema = z.object({
  index: z.number(),
  op: z.string(),
  line_id: z.string(),
}).passthrough();

export type BulkOpResult = z.infer<typeof BulkOpResultSchema>;

export const BulkOpErrorSchema = z.object({
  index: z.number(),
  error: z.string(),
}).passthrough();

export type BulkOpError = z.infer<typeof BulkOpErrorSchema>;

export const BulkBudgetResponseSchema = z.object({
  results: z.array(BulkOpResultSchema),
  errors: z.array(BulkOpErrorSchema),
  totals: BudgetTotalsSchema,
}).passthrough();

export type BulkBudgetResponse = z.infer<typeof BulkBudgetResponseSchema>;

export const BulkDeleteResponseSchema = z.object({
  message: z.string(),
  deleted_count: z.number(),
}).passthrough();

export type BulkDeleteResponse = z.infer<typeof BulkDeleteResponseSchema>;

export const SkippedDiscoverableObjectSchema = z.object({
  object_id: z.string(),
  reason: z.string(),
}).passthrough();

export type SkippedDiscoverableObject = z.infer<typeof SkippedDiscoverableObjectSchema>;

export const BulkDiscoverableResponseSchema = z.object({
  updated: z.number(),
  is_discoverable: z.boolean(),
  skipped: z.array(SkippedDiscoverableObjectSchema).optional(),
}).passthrough();

export type BulkDiscoverableResponse = z.infer<typeof BulkDiscoverableResponseSchema>;

export const BulkImportResultCountsSchema = z.object({
  created: z.number().optional(),
  skipped: z.number().optional(),
  errors: z.number().optional(),
}).passthrough();

export type BulkImportResultCounts = z.infer<typeof BulkImportResultCountsSchema>;

export const BulkImportResponseSchema = z.object({
  message: z.string(),
  organization_id: z.string(),
  results: BulkImportResultCountsSchema,
  users: z.array(z.any()).optional(),
}).passthrough();

export type BulkImportResponse = z.infer<typeof BulkImportResponseSchema>;

export const BulkImportUsersBodySchema = z.object({
  users: z.array(z.any()),
  send_invitations: z.boolean().optional(),
}).passthrough();

export type BulkImportUsersBody = z.infer<typeof BulkImportUsersBodySchema>;

export const BulkReprocessResponseSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  queued_count: z.number(),
  message: z.string(),
}).passthrough();

export type BulkReprocessResponse = z.infer<typeof BulkReprocessResponseSchema>;

export const BySourceItemSchema = z.object({
  source: z.string(),
  count: z.number(),
}).passthrough();

export type BySourceItem = z.infer<typeof BySourceItemSchema>;

export const ByTypeItemSchema = z.object({
  type: z.string(),
  count: z.number(),
}).passthrough();

export type ByTypeItem = z.infer<typeof ByTypeItemSchema>;

export const CSRFResponseSchema = z.object({
  csrf_token: z.string(),
}).passthrough();

export type CSRFResponse = z.infer<typeof CSRFResponseSchema>;

export const CancelMigrationResponseSchema = z.object({
  message: z.string(),
  files_copied_before_cancel: z.number(),
}).passthrough();

export type CancelMigrationResponse = z.infer<typeof CancelMigrationResponseSchema>;

export const CatalogingHistoryOutSchema = z.object({
  history_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  cataloger_name: z.string().nullable().optional(),
  cataloger_id: z.string().nullable().optional(),
  institution: z.string().nullable().optional(),
  catalog_date: z.string().nullable().optional(),
  catalog_language: z.string().nullable().optional(),
  record_type: z.string().nullable().optional(),
  fields_modified: z.any().nullable().optional(),
  change_summary: z.string().nullable().optional(),
  previous_values: z.any().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type CatalogingHistoryOut = z.infer<typeof CatalogingHistoryOutSchema>;

export const CatalogingHistoryListResponseSchema = z.object({
  cataloging_history: z.array(CatalogingHistoryOutSchema),
}).passthrough();

export type CatalogingHistoryListResponse = z.infer<typeof CatalogingHistoryListResponseSchema>;

export const CategoryOutSchema = z.object({
  category_id: z.string(),
  name: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
}).passthrough();

export type CategoryOut = z.infer<typeof CategoryOutSchema>;

export const CategoryDataResponseSchema = z.object({
  data: CategoryOutSchema,
}).passthrough();

export type CategoryDataResponse = z.infer<typeof CategoryDataResponseSchema>;

export const CategoryListResponseSchema = z.object({
  data: z.array(CategoryOutSchema),
}).passthrough();

export type CategoryListResponse = z.infer<typeof CategoryListResponseSchema>;

export const LookupCategoryOutSchema = z.object({
  category_id: z.string(),
  category_key: z.string(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  applicable_contexts: z.array(z.string()),
  supports_icons: z.boolean(),
}).passthrough();

export type LookupCategoryOut = z.infer<typeof LookupCategoryOutSchema>;

export const LookupValueOutSchema = z.object({
  value_id: z.string(),
  category_id: z.string(),
  organization_id: z.string().nullable().optional(),
  value_key: z.string(),
  label: z.string(),
  description: z.string().nullable().optional(),
  icon_name: z.string().nullable().optional(),
  sort_order: z.number(),
  is_active: z.boolean(),
  is_hidden: z.boolean(),
  is_system: z.boolean(),
}).passthrough();

export type LookupValueOut = z.infer<typeof LookupValueOutSchema>;

export const CategoryValuesResponseSchema = z.object({
  category: LookupCategoryOutSchema,
  values: z.array(LookupValueOutSchema),
}).passthrough();

export type CategoryValuesResponse = z.infer<typeof CategoryValuesResponseSchema>;

export const CdnConfigResponseSchema = z.object({
  cdn_domain: z.string().nullable().optional(),
  has_signing_key: z.boolean(),
  message: z.string(),
}).passthrough();

export type CdnConfigResponse = z.infer<typeof CdnConfigResponseSchema>;

export const FieldDiffOutSchema = z.object({
  diff_id: z.string(),
  field_name: z.string(),
  old_value: z.any().optional(),
  new_value: z.any().optional(),
}).passthrough();

export type FieldDiffOut = z.infer<typeof FieldDiffOutSchema>;

export const ChangeEventOutSchema = z.object({
  change_id: z.string(),
  occurred_at: z.string(),
  entity_key: z.string(),
  entity_type: z.string().nullable().optional(),
  change_type: z.string(),
  applied: z.boolean().nullable().optional(),
  changed_fields: z.any().nullable().optional(),
  old_hash: z.string().nullable().optional(),
  new_hash: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  pipeline_name: z.string().nullable().optional(),
  dataset_name: z.string().nullable().optional(),
  field_diffs: z.array(FieldDiffOutSchema),
}).passthrough();

export type ChangeEventOut = z.infer<typeof ChangeEventOutSchema>;

export const ChangeEventListResponseSchema = z.object({
  items: z.array(ChangeEventOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ChangeEventListResponse = z.infer<typeof ChangeEventListResponseSchema>;

export const ChangePasswordBodySchema = z.object({
  current_password: z.string(),
  new_password: z.string(),
}).passthrough();

export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;

export const ChangePasswordMFABodySchema = z.object({
  session: z.string(),
  mfa_code: z.string(),
  current_password: z.string(),
  new_password: z.string(),
}).passthrough();

export type ChangePasswordMFABody = z.infer<typeof ChangePasswordMFABodySchema>;

export const ChecklistEnumsResponseSchema = z.object({
  phases: z.array(EnumValueLabelSchema),
  roles: z.array(EnumValueLabelSchema),
  statuses: z.array(EnumValueLabelSchema),
  exhibition_types: z.array(z.string()),
  link_entity_types: z.array(z.string()),
}).passthrough();

export type ChecklistEnumsResponse = z.infer<typeof ChecklistEnumsResponseSchema>;

export const ChecklistItemLinkOutSchema = z.object({
  link_id: z.string(),
  linked_entity_type: z.string(),
  linked_entity_id: z.string(),
}).passthrough();

export type ChecklistItemLinkOut = z.infer<typeof ChecklistItemLinkOutSchema>;

export const ChecklistItemLinkWrapperResponseSchema = z.object({
  link: ChecklistItemLinkOutSchema,
}).passthrough();

export type ChecklistItemLinkWrapperResponse = z.infer<typeof ChecklistItemLinkWrapperResponseSchema>;

export const ChecklistItemLinksListResponseSchema = z.object({
  links: z.array(ChecklistItemLinkOutSchema),
}).passthrough();

export type ChecklistItemLinksListResponse = z.infer<typeof ChecklistItemLinksListResponseSchema>;

export const ChecklistItemOutSchema = z.object({
  item_id: z.string(),
  checklist_id: z.string(),
  source_template_item_id: z.string().nullable().optional(),
  phase: z.string(),
  phase_label: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  responsible_role: z.string(),
  responsible_role_label: z.string(),
  assigned_user_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: z.string(),
  status_label: z.string(),
  notes: z.string().nullable().optional(),
  sort_order: z.number(),
  completed_at: z.string().nullable().optional(),
  completed_by: z.string().nullable().optional(),
  links: z.array(ChecklistItemLinkOutSchema).optional(),
  links_count: z.number().nullable().optional(),
}).passthrough();

export type ChecklistItemOut = z.infer<typeof ChecklistItemOutSchema>;

export const ChecklistItemWrapperResponseSchema = z.object({
  item: ChecklistItemOutSchema,
}).passthrough();

export type ChecklistItemWrapperResponse = z.infer<typeof ChecklistItemWrapperResponseSchema>;

export const ChecklistTemplateItemOutSchema = z.object({
  template_item_id: z.string(),
  phase: z.string(),
  phase_label: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  responsible_role: z.string(),
  responsible_role_label: z.string(),
  default_due_offset_days: z.number().nullable().optional(),
  sort_order: z.number(),
  is_required: z.boolean(),
}).passthrough();

export type ChecklistTemplateItemOut = z.infer<typeof ChecklistTemplateItemOutSchema>;

export const ChecklistTemplateItemWrapperResponseSchema = z.object({
  item: ChecklistTemplateItemOutSchema,
}).passthrough();

export type ChecklistTemplateItemWrapperResponse = z.infer<typeof ChecklistTemplateItemWrapperResponseSchema>;

export const ChecklistTemplateVersionOutSchema = z.object({
  version_id: z.string(),
  template_id: z.string(),
  version_number: z.number(),
  is_published: z.boolean(),
  is_locked: z.boolean(),
  change_notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  items: z.array(ChecklistTemplateItemOutSchema).nullable().optional(),
  item_count: z.number().nullable().optional(),
}).passthrough();

export type ChecklistTemplateVersionOut = z.infer<typeof ChecklistTemplateVersionOutSchema>;

export const ChecklistTemplateOutSchema = z.object({
  template_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  exhibition_type: z.string().nullable().optional(),
  is_archived: z.boolean(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  versions: z.array(ChecklistTemplateVersionOutSchema).nullable().optional(),
  published_version_id: z.string().nullable().optional(),
  published_version_number: z.number().nullable().optional(),
}).passthrough();

export type ChecklistTemplateOut = z.infer<typeof ChecklistTemplateOutSchema>;

export const ChecklistTemplateListResponseSchema = z.object({
  templates: z.array(ChecklistTemplateOutSchema),
}).passthrough();

export type ChecklistTemplateListResponse = z.infer<typeof ChecklistTemplateListResponseSchema>;

export const ChecklistTemplateWrapperResponseSchema = z.object({
  template: ChecklistTemplateOutSchema,
}).passthrough();

export type ChecklistTemplateWrapperResponse = z.infer<typeof ChecklistTemplateWrapperResponseSchema>;

export const ChecklistVersionWrapperResponseSchema = z.object({
  version: ChecklistTemplateVersionOutSchema,
}).passthrough();

export type ChecklistVersionWrapperResponse = z.infer<typeof ChecklistVersionWrapperResponseSchema>;

export const CitationOutSchema = z.object({
  citation_id: z.string(),
  organization_id: z.string(),
  citation_type: z.string().nullable().optional(),
  brief_citation: z.string().nullable().optional(),
  full_citation: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  publication: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  publication_place: z.string().nullable().optional(),
  publication_year: z.string().nullable().optional(),
  volume: z.string().nullable().optional(),
  issue: z.string().nullable().optional(),
  pages: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  doi: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  works_cited: z.boolean().nullable().optional(),
  works_illustrated: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type CitationOut = z.infer<typeof CitationOutSchema>;

export const CitationListResponseSchema = z.object({
  items: z.array(CitationOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type CitationListResponse = z.infer<typeof CitationListResponseSchema>;

export const ClassificationOutSchema = z.object({
  term: z.string().nullable().optional(),
}).passthrough();

export type ClassificationOut = z.infer<typeof ClassificationOutSchema>;

export const ClassificationStatsResponseSchema = z.object({
  total_entities: z.number(),
  by_type: z.record(z.string(), z.number()),
  classification_rate: z.number(),
}).passthrough();

export type ClassificationStatsResponse = z.infer<typeof ClassificationStatsResponseSchema>;

export const ClassificationStatusResponseSchema = z.object({
  dataset_id: z.string(),
  total: z.number(),
  by_type: z.record(z.string(), z.number()),
  unclassified_count: z.number(),
  classification_complete: z.boolean(),
}).passthrough();

export type ClassificationStatusResponse = z.infer<typeof ClassificationStatusResponseSchema>;

export const ClassifyDatasetResponseSchema = z.object({
  dataset_id: z.string(),
  queued: z.number(),
  task_id: z.string(),
  message: z.string(),
}).passthrough();

export type ClassifyDatasetResponse = z.infer<typeof ClassifyDatasetResponseSchema>;

export const ClassifyEntityResponseSchema = z.object({
  entity_key: z.string(),
  task_id: z.string(),
  message: z.string(),
}).passthrough();

export type ClassifyEntityResponse = z.infer<typeof ClassifyEntityResponseSchema>;

export const ClassifyOrganizationResponseSchema = z.object({
  organization_id: z.string(),
  queued: z.number(),
  message: z.string(),
}).passthrough();

export type ClassifyOrganizationResponse = z.infer<typeof ClassifyOrganizationResponseSchema>;

export const ClearMetadataReviewResponseSchema = z.object({
  success: z.boolean(),
  media_id: z.string(),
  metadata_reviewed: z.boolean(),
}).passthrough();

export type ClearMetadataReviewResponse = z.infer<typeof ClearMetadataReviewResponseSchema>;

export const CollectionDeletedResponseSchema = z.object({
  success: z.boolean(),
  collection_id: z.string(),
}).passthrough();

export type CollectionDeletedResponse = z.infer<typeof CollectionDeletedResponseSchema>;

export const CollectionDetailSchema = z.object({
  collection_id: z.string(),
  name: z.string().nullable().optional(),
}).passthrough();

export type CollectionDetail = z.infer<typeof CollectionDetailSchema>;

export const CollectionExportJsonLdOutSchema = z.object({
}).passthrough();

export type CollectionExportJsonLdOut = z.infer<typeof CollectionExportJsonLdOutSchema>;

export const CollectionItemCreatedResponseSchema = z.object({
  collection_id: z.string(),
  media_id: z.string(),
  sort_order: z.number().nullable().optional(),
}).passthrough();

export type CollectionItemCreatedResponse = z.infer<typeof CollectionItemCreatedResponseSchema>;

export const CollectionItemMediaDetailSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
}).passthrough();

export type CollectionItemMediaDetail = z.infer<typeof CollectionItemMediaDetailSchema>;

export const CollectionItemOutSchema = z.object({
  collection_id: z.string(),
  media_id: z.string(),
  sort_order: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  added_at: z.string().nullable().optional(),
  added_by: z.string().nullable().optional(),
  media: CollectionItemMediaDetailSchema.nullable().optional(),
}).passthrough();

export type CollectionItemOut = z.infer<typeof CollectionItemOutSchema>;

export const CollectionItemListResponseSchema = z.object({
  items: z.array(CollectionItemOutSchema),
  total: z.number(),
}).passthrough();

export type CollectionItemListResponse = z.infer<typeof CollectionItemListResponseSchema>;

export const CollectionItemRemovedResponseSchema = z.object({
  success: z.boolean(),
  media_id: z.string(),
}).passthrough();

export type CollectionItemRemovedResponse = z.infer<typeof CollectionItemRemovedResponseSchema>;

export const CollectionLodReadinessOutSchema = z.object({
  averageScore: z.number(),
  objectCount: z.number(),
  hintsByCategory: z.record(z.string(), z.any()),
  levelDistribution: z.record(z.string(), z.number()).nullable().optional(),
  objects: z.array(z.any()).nullable().optional(),
}).passthrough();

export type CollectionLodReadinessOut = z.infer<typeof CollectionLodReadinessOutSchema>;

export const CollectionObjectDetailResponseSchema = z.object({
}).passthrough();

export type CollectionObjectDetailResponse = z.infer<typeof CollectionObjectDetailResponseSchema>;

export const CollectionObjectListResponseSchema = z.object({
  items: z.array(z.any()),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  search_engine: z.string().nullable().optional(),
}).passthrough();

export type CollectionObjectListResponse = z.infer<typeof CollectionObjectListResponseSchema>;

export const CollectionObjectMediaOutSchema = z.object({
}).passthrough();

export type CollectionObjectMediaOut = z.infer<typeof CollectionObjectMediaOutSchema>;

export const CollectionObjectOutSchema = z.object({
  object_id: z.string(),
  organization_id: z.string(),
  object_number: z.string().nullable().optional(),
}).passthrough();

export type CollectionObjectOut = z.infer<typeof CollectionObjectOutSchema>;

export const CollectionOriginsResponseSchema = z.object({
  total_objects: z.number(),
  places: z.array(z.any()),
  linked_places_without_coordinates: z.number().optional(),
}).passthrough();

export type CollectionOriginsResponse = z.infer<typeof CollectionOriginsResponseSchema>;

export const CollectionProfileOutSchema = z.object({
  organization_id: z.string(),
  scope_note: z.string().nullable().optional(),
  coverage: z.record(z.string(), z.any()).nullable().optional(),
  completeness: z.string().nullable().optional(),
  extent_note: z.string().nullable().optional(),
  known_gaps: z.string().nullable().optional(),
  digitization_status: z.string().nullable().optional(),
}).passthrough();

export type CollectionProfileOut = z.infer<typeof CollectionProfileOutSchema>;

export const CollectionProfileUpdateSchema = z.object({
  scope_note: z.string().nullable().optional(),
  coverage: z.record(z.string(), z.any()).nullable().optional(),
  completeness: z.string().nullable().optional(),
  extent_note: z.string().nullable().optional(),
  known_gaps: z.string().nullable().optional(),
  digitization_status: z.string().nullable().optional(),
}).passthrough();

export type CollectionProfileUpdate = z.infer<typeof CollectionProfileUpdateSchema>;

export const CollectionSearchResponseSchema = z.object({
}).passthrough();

export type CollectionSearchResponse = z.infer<typeof CollectionSearchResponseSchema>;

export const CollectionShareOutSchema = z.object({
  share_id: z.string(),
  collection_id: z.string(),
  user_id: z.string().nullable().optional(),
  user_name: z.string().nullable().optional(),
  user_email: z.string().nullable().optional(),
  principal_type: z.string().nullable().optional(),
  principal_id: z.string().nullable().optional(),
  principal_name: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  shared_by: z.string().nullable().optional(),
  shared_at: z.string().nullable().optional(),
}).passthrough();

export type CollectionShareOut = z.infer<typeof CollectionShareOutSchema>;

export const CollectionShareListResponseSchema = z.object({
  shares: z.array(CollectionShareOutSchema),
  total: z.number(),
}).passthrough();

export type CollectionShareListResponse = z.infer<typeof CollectionShareListResponseSchema>;

export const CollectionsImpactResponseSchema = z.object({
  needs_movement_plan: z.boolean(),
  needs_condition_checks: z.boolean(),
  needs_rights_verification: z.boolean(),
  objects_needing_movement: z.array(z.any()).optional(),
  objects_needing_condition_check: z.array(z.any()).optional(),
  objects_needing_rights_check: z.array(z.any()).optional(),
  event_status: z.string().nullable().optional(),
  total_objects: z.number(),
}).passthrough();

export type CollectionsImpactResponse = z.infer<typeof CollectionsImpactResponseSchema>;

export const CollectionsReviewOutSchema = z.object({
  review_id: z.string(),
  organization_id: z.string(),
  review_number: z.string().nullable().optional(),
  title: z.string(),
  review_type: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  methodology: z.string().nullable().optional(),
  assessment_criteria: z.any().optional(),
  scoring_guidance: z.any().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  objects_total: z.number().nullable().optional(),
  objects_reviewed: z.number().nullable().optional(),
  findings_summary: z.string().nullable().optional(),
  recommendations: z.any().optional(),
  follow_up_actions: z.any().optional(),
  status: z.string().nullable().optional(),
  lead_reviewer: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type CollectionsReviewOut = z.infer<typeof CollectionsReviewOutSchema>;

export const CollectionsReviewListResponseSchema = z.object({
  items: z.array(CollectionsReviewOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type CollectionsReviewListResponse = z.infer<typeof CollectionsReviewListResponseSchema>;

export const CommentAuthorOutSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
}).passthrough();

export type CommentAuthorOut = z.infer<typeof CommentAuthorOutSchema>;

export const CommentCountResponseSchema = z.object({
  count: z.number(),
}).passthrough();

export type CommentCountResponse = z.infer<typeof CommentCountResponseSchema>;

export const CommentOutSchema = z.object({
  comment_id: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  author: CommentAuthorOutSchema,
  content: z.string(),
  kind: z.string(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type CommentOut = z.infer<typeof CommentOutSchema>;

export const CommentCreatedResponseSchema = z.object({
  comment: CommentOutSchema,
}).passthrough();

export type CommentCreatedResponse = z.infer<typeof CommentCreatedResponseSchema>;

export const ExportRecordOutSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
  organization_id: z.string(),
}).passthrough();

export type ExportRecordOut = z.infer<typeof ExportRecordOutSchema>;

export const ExportCommentOutSchema = z.object({
  author_name: z.string().nullable().optional(),
  author_email: z.string().nullable().optional(),
  content: z.string(),
  kind: z.string(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ExportCommentOut = z.infer<typeof ExportCommentOutSchema>;

export const CommentExportResponseSchema = z.object({
  record: ExportRecordOutSchema,
  comments: z.array(ExportCommentOutSchema),
  total_count: z.number(),
  exported_at: z.string(),
  exported_by: z.string(),
}).passthrough();

export type CommentExportResponse = z.infer<typeof CommentExportResponseSchema>;

export const CommentListResponseSchema = z.object({
  items: z.array(CommentOutSchema),
  total: z.number(),
  has_more: z.boolean(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type CommentListResponse = z.infer<typeof CommentListResponseSchema>;

export const ConditionReportDeleteResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string(),
}).passthrough();

export type ConditionReportDeleteResponse = z.infer<typeof ConditionReportDeleteResponseSchema>;

export const ConditionReportOutSchema = z.object({
  report_id: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
  report_number: z.string().nullable().optional(),
  report_type: z.string().nullable().optional(),
  report_date: z.string().nullable().optional(),
  examiner_id: z.string().nullable().optional(),
  examiner_name: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  linked_entity_type: z.string().nullable().optional(),
  linked_entity_id: z.string().nullable().optional(),
  overall_condition: z.string().nullable().optional(),
  condition_summary: z.string().nullable().optional(),
  detailed_findings: z.any().optional(),
  hazards: z.any().optional(),
  recommendations: z.string().nullable().optional(),
  conservation_needed: z.boolean().nullable().optional(),
  conservation_priority: z.string().nullable().optional(),
  handling_requirements: z.string().nullable().optional(),
  packing_requirements: z.string().nullable().optional(),
  display_restrictions: z.string().nullable().optional(),
  report_note: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  reviewed_by: z.string().nullable().optional(),
  reviewed_date: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type ConditionReportOut = z.infer<typeof ConditionReportOutSchema>;

export const ConditionReportListResponseSchema = z.object({
  items: z.array(ConditionReportOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ConditionReportListResponse = z.infer<typeof ConditionReportListResponseSchema>;

export const ConnectorActionResultResponseSchema = z.object({
  success: z.boolean().nullable().optional(),
  data: z.any().optional(),
  error: z.any().optional(),
}).passthrough();

export type ConnectorActionResultResponse = z.infer<typeof ConnectorActionResultResponseSchema>;

export const ConnectorActionsResponseSchema = z.object({
  connectorInstanceId: z.string(),
  connectorType: z.string(),
  sourceType: z.string().nullable().optional(),
  actions: z.array(z.any()),
}).passthrough();

export type ConnectorActionsResponse = z.infer<typeof ConnectorActionsResponseSchema>;

export const ConnectorDefinitionOutSchema = z.object({
  connector_definition_id: z.string(),
  key: z.string(),
  display_name: z.string(),
  direction: z.string().nullable().optional(),
  implementation_key: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  config_schema: z.any().optional(),
  created_at: z.string(),
}).passthrough();

export type ConnectorDefinitionOut = z.infer<typeof ConnectorDefinitionOutSchema>;

export const ConnectorInstanceOutSchema = z.object({
  connector_instance_id: z.string(),
  organization_id: z.string(),
  connector_definition_id: z.string(),
  name: z.string(),
  status: z.string().nullable().optional(),
  config: z.any().optional(),
  direction: z.string().nullable().optional(),
  definition_key: z.string().nullable().optional(),
  created_at: z.string(),
}).passthrough();

export type ConnectorInstanceOut = z.infer<typeof ConnectorInstanceOutSchema>;

export const ConnectorTestResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().nullable().optional(),
  server: z.any().optional(),
  capabilities: z.any().optional(),
  error: z.any().optional(),
}).passthrough();

export type ConnectorTestResponse = z.infer<typeof ConnectorTestResponseSchema>;

export const ConsentMediaItemSchema = z.object({
  media_id: z.string(),
  title: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
}).passthrough();

export type ConsentMediaItem = z.infer<typeof ConsentMediaItemSchema>;

export const ConsentClearanceResponseSchema = z.object({
  is_cleared: z.boolean(),
  media_count: z.number(),
  media_without_consent: z.array(ConsentMediaItemSchema),
  media_with_expired_consent: z.array(ConsentMediaItemSchema),
}).passthrough();

export type ConsentClearanceResponse = z.infer<typeof ConsentClearanceResponseSchema>;

export const ConsentClearedResponseSchema = z.object({
  success: z.boolean(),
  cleared_at: z.string(),
}).passthrough();

export type ConsentClearedResponse = z.infer<typeof ConsentClearedResponseSchema>;

export const ConservationTreatmentListResponseSchema = z.object({
  items: z.array(z.any()).optional(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ConservationTreatmentListResponse = z.infer<typeof ConservationTreatmentListResponseSchema>;

export const ConservationTreatmentOutSchema = z.object({
  treatment_id: z.string(),
  organization_id: z.string(),
  treatment_number: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type ConservationTreatmentOut = z.infer<typeof ConservationTreatmentOutSchema>;

export const ConstituentBriefSchema = z.object({
  constituent_id: z.string(),
  constituent_type: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  organization_name: z.string().nullable().optional(),
}).passthrough();

export type ConstituentBrief = z.infer<typeof ConstituentBriefSchema>;

export const ConstituentBriefOutSchema = z.object({
  constituent_id: z.string(),
  constituent_type: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  sort_name: z.string().nullable().optional(),
  dates: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  organization_name: z.string().nullable().optional(),
  ulan_id: z.string().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type ConstituentBriefOut = z.infer<typeof ConstituentBriefOutSchema>;

export const ConstituentEnumsResponseSchema = z.object({
  constituent_types: z.array(z.string()),
  statuses: z.array(z.string()),
  entity_types: z.array(z.string()),
  roles_by_entity_type: z.record(z.string(), z.array(z.string())),
  relationship_types: z.array(z.string()),
  attribution_certainty: z.array(z.string()),
}).passthrough();

export type ConstituentEnumsResponse = z.infer<typeof ConstituentEnumsResponseSchema>;

export const ConstituentListResponseSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  items: z.array(ConstituentBriefOutSchema),
}).passthrough();

export type ConstituentListResponse = z.infer<typeof ConstituentListResponseSchema>;

export const ConstituentObjectItemSchema = z.object({
  xref_id: z.string(),
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  role_qualifier: z.string().nullable().optional(),
  attribution_certainty: z.string().nullable().optional(),
}).passthrough();

export type ConstituentObjectItem = z.infer<typeof ConstituentObjectItemSchema>;

export const ConstituentObjectsResponseSchema = z.object({
  objects: z.array(ConstituentObjectItemSchema),
}).passthrough();

export type ConstituentObjectsResponse = z.infer<typeof ConstituentObjectsResponseSchema>;

export const ConstituentOutSchema = z.object({
  constituent_id: z.string(),
  organization_id: z.string(),
  constituent_type: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  organization_name: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  phone_secondary: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  address: z.record(z.string(), z.any()).nullable().optional(),
  contact_categories: z.any().nullable().optional(),
  sort_name: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  given_name: z.string().nullable().optional(),
  family_name: z.string().nullable().optional(),
  name_prefix: z.string().nullable().optional(),
  name_suffix: z.string().nullable().optional(),
  name_type: z.string().nullable().optional(),
  variant_names: z.array(z.string()).nullable().optional(),
  nationality: z.string().nullable().optional(),
  nationalities: z.any().nullable().optional(),
  culture: z.string().nullable().optional(),
  life_roles: z.array(z.string()).nullable().optional(),
  gender: z.string().nullable().optional(),
  birth_date_display: z.string().nullable().optional(),
  birth_date_earliest: z.string().nullable().optional(),
  birth_date_latest: z.string().nullable().optional(),
  birth_place: z.string().nullable().optional(),
  birth_place_tgn_id: z.string().nullable().optional(),
  death_date_display: z.string().nullable().optional(),
  death_date_earliest: z.string().nullable().optional(),
  death_date_latest: z.string().nullable().optional(),
  death_place: z.string().nullable().optional(),
  death_place_tgn_id: z.string().nullable().optional(),
  active_date_display: z.string().nullable().optional(),
  active_date_earliest: z.string().nullable().optional(),
  active_date_latest: z.string().nullable().optional(),
  biography: z.string().nullable().optional(),
  biography_source: z.string().nullable().optional(),
  ulan_id: z.string().nullable().optional(),
  viaf_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  loc_id: z.string().nullable().optional(),
  external_uris: z.array(z.string()).nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  status: z.string().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  verified_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  internal_notes: z.string().nullable().optional(),
  cataloger_notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  linked_records_count: z.number().nullable().optional(),
}).passthrough();

export type ConstituentOut = z.infer<typeof ConstituentOutSchema>;

export const ConstituentRelationBriefSchema = z.object({
  constituent_id: z.string(),
  name: z.string().nullable().optional(),
  constituent_type: z.string().nullable().optional(),
}).passthrough();

export type ConstituentRelationBrief = z.infer<typeof ConstituentRelationBriefSchema>;

export const ConstituentRelationOutSchema = z.object({
  relation_id: z.string(),
  organization_id: z.string(),
  from_constituent_id: z.string(),
  to_constituent_id: z.string(),
  relationship_type: z.string().nullable().optional(),
  relationship_note: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  from_constituent: ConstituentRelationBriefSchema.nullable().optional(),
  to_constituent: ConstituentRelationBriefSchema.nullable().optional(),
}).passthrough();

export type ConstituentRelationOut = z.infer<typeof ConstituentRelationOutSchema>;

export const ConstituentRelationsResponseSchema = z.object({
  constituent_id: z.string(),
  relations: z.array(ConstituentRelationOutSchema),
}).passthrough();

export type ConstituentRelationsResponse = z.infer<typeof ConstituentRelationsResponseSchema>;

export const ConstituentRolesResponseSchema = z.object({
  entity_type: z.string(),
  roles: z.array(z.any()),
}).passthrough();

export type ConstituentRolesResponse = z.infer<typeof ConstituentRolesResponseSchema>;

export const SearchResultItemSchema = z.object({
  id: z.string(),
  source: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  dates: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  roles: z.array(z.string()).nullable().optional(),
  ulan_id: z.string().nullable().optional(),
  constituent_id: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
}).passthrough();

export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

export const ConstituentSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(SearchResultItemSchema),
}).passthrough();

export type ConstituentSearchResponse = z.infer<typeof ConstituentSearchResponseSchema>;

export const ConstituentUpdateResponseSchema = z.object({
  success: z.boolean(),
  constituent_id: z.string(),
}).passthrough();

export type ConstituentUpdateResponse = z.infer<typeof ConstituentUpdateResponseSchema>;

export const ConstituentXrefOutSchema = z.object({
  xref_id: z.string(),
  organization_id: z.string(),
  constituent_id: z.string(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string(),
  role: z.string().nullable().optional(),
  role_qualifier: z.string().nullable().optional(),
  attribution_certainty: z.string().nullable().optional(),
  attribution_note: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  display_name_override: z.string().nullable().optional(),
  is_primary: z.boolean().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  constituent: ConstituentBriefSchema.nullable().optional(),
}).passthrough();

export type ConstituentXrefOut = z.infer<typeof ConstituentXrefOutSchema>;

export const NagpraConsultationEventOutSchema = z.object({
  event_id: z.string(),
  action_id: z.string(),
  organization_id: z.string().nullable().optional(),
  consulting_party_id: z.string().nullable().optional(),
  consulting_party_name: z.string().nullable().optional(),
  event_date: z.string().nullable().optional(),
  event_type: z.string().nullable().optional(),
  direction: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  participants: z.any().optional(),
  outcomes: z.string().nullable().optional(),
  follow_up_required: z.boolean().nullable().optional(),
  follow_up_date: z.string().nullable().optional(),
  follow_up_note: z.string().nullable().optional(),
  document_references: z.any().optional(),
  recorded_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type NagpraConsultationEventOut = z.infer<typeof NagpraConsultationEventOutSchema>;

export const ConsultationEventListResponseSchema = z.object({
  consultation_events: z.array(NagpraConsultationEventOutSchema),
  total: z.number(),
}).passthrough();

export type ConsultationEventListResponse = z.infer<typeof ConsultationEventListResponseSchema>;

export const ContentBlockCreatedResponseSchema = z.object({
  block_id: z.string(),
  message: z.string(),
}).passthrough();

export type ContentBlockCreatedResponse = z.infer<typeof ContentBlockCreatedResponseSchema>;

export const ContentBlockOutSchema = z.object({
  block_id: z.string(),
  block_type: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  title: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  content_format: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  is_public: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ContentBlockOut = z.infer<typeof ContentBlockOutSchema>;

export const ContentBlockListResponseSchema = z.object({
  data: z.array(ContentBlockOutSchema),
}).passthrough();

export type ContentBlockListResponse = z.infer<typeof ContentBlockListResponseSchema>;

export const ContentPageOutSchema = z.object({
  page_id: z.string(),
  organization_id: z.string(),
  slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  page_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  publish_at: z.string().nullable().optional(),
  author_id: z.string().nullable().optional(),
  featured_image_media_id: z.string().nullable().optional(),
  og_image_media_id: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  meta_title: z.string().nullable().optional(),
  meta_description: z.string().nullable().optional(),
  template: z.string().nullable().optional(),
  parent_page_id: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  blocks: z.array(ContentBlockOutSchema).nullable().optional(),
  categories: z.array(z.any()).nullable().optional(),
}).passthrough();

export type ContentPageOut = z.infer<typeof ContentPageOutSchema>;

export const ContentPageDataResponseSchema = z.object({
  data: ContentPageOutSchema,
}).passthrough();

export type ContentPageDataResponse = z.infer<typeof ContentPageDataResponseSchema>;

export const ContentPageListResponseSchema = z.object({
  items: z.array(ContentPageOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ContentPageListResponse = z.infer<typeof ContentPageListResponseSchema>;

export const ConversationSummaryOutSchema = z.object({
  conversation_id: z.string(),
  title: z.string().nullable().optional(),
  persona: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export type ConversationSummaryOut = z.infer<typeof ConversationSummaryOutSchema>;

export const ConversionInfoSchema = z.object({
  organization_id: z.string(),
  organization_name: z.string(),
  organization_slug: z.string(),
  contract_id: z.string(),
  mode: z.string(),
  admin_user_id: z.string().nullable().optional(),
  welcome_email_sent: z.boolean().nullable().optional(),
}).passthrough();

export type ConversionInfo = z.infer<typeof ConversionInfoSchema>;

export const CoordinatePairSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
}).passthrough();

export type CoordinatePair = z.infer<typeof CoordinatePairSchema>;

export const CrateOutSchema = z.object({
  crate_id: z.string(),
  organization_id: z.string(),
  crate_number: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  height_cm: z.string().nullable().optional(),
  width_cm: z.string().nullable().optional(),
  depth_cm: z.string().nullable().optional(),
  weight_empty_kg: z.string().nullable().optional(),
  interior_height_cm: z.string().nullable().optional(),
  interior_width_cm: z.string().nullable().optional(),
  interior_depth_cm: z.string().nullable().optional(),
  materials: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  condition_label: z.string().nullable().optional(),
  climate_controlled: z.boolean().optional(),
  is_stackable: z.boolean().optional(),
  is_oversized: z.boolean().optional(),
  location_id: z.string().nullable().optional(),
  location: z.any().nullable().optional(),
  home_location_id: z.string().nullable().optional(),
  home_location: z.any().nullable().optional(),
  is_active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type CrateOut = z.infer<typeof CrateOutSchema>;

export const CrateListResponseSchema = z.object({
  items: z.array(CrateOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type CrateListResponse = z.infer<typeof CrateListResponseSchema>;

export const CreateAPIKeyBodySchema = z.object({
  name: z.string(),
  scopes: z.array(z.string()),
  expires_in_days: z.number().nullable().optional(),
}).passthrough();

export type CreateAPIKeyBody = z.infer<typeof CreateAPIKeyBodySchema>;

export const CreateAPIKeyResponseSchema = z.object({
  api_key_id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()).optional(),
  key_prefix: z.string(),
  secret_api_key: z.string().nullable().optional(),
  status: z.string(),
  expires_at: z.string().nullable().optional(),
  created_at: z.string(),
  last_used_at: z.string().nullable().optional(),
}).passthrough();

export type CreateAPIKeyResponse = z.infer<typeof CreateAPIKeyResponseSchema>;

export const CreateAuthorityRelationRequestSchema = z.object({
  related_authority_id: z.string(),
  relationship_type: z.string(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).passthrough();

export type CreateAuthorityRelationRequest = z.infer<typeof CreateAuthorityRelationRequestSchema>;

export const CreateCategoryBodySchema = z.object({
  name: z.string(),
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sort_order: z.number().optional(),
}).passthrough();

export type CreateCategoryBody = z.infer<typeof CreateCategoryBodySchema>;

export const CreateCommentBodySchema = z.object({
  content: z.string(),
  kind: z.string().optional(),
}).passthrough();

export type CreateCommentBody = z.infer<typeof CreateCommentBodySchema>;

export const CreateConditionReportRequestSchema = z.object({
  report_type: z.string(),
  object_id: z.string().nullable().optional(),
  linked_entity_type: z.string().nullable().optional(),
  linked_entity_id: z.string().nullable().optional(),
  overall_condition: z.string().nullable().optional(),
  examiner_name: z.string().nullable().optional(),
  condition_summary: z.string().nullable().optional(),
  detailed_findings: z.string().nullable().optional(),
  hazards: z.string().nullable().optional(),
  recommendations: z.string().nullable().optional(),
  conservation_needed: z.boolean().optional(),
  conservation_priority: z.string().nullable().optional(),
  handling_requirements: z.string().nullable().optional(),
  packing_requirements: z.string().nullable().optional(),
  display_restrictions: z.string().nullable().optional(),
  report_note: z.string().nullable().optional(),
}).passthrough();

export type CreateConditionReportRequest = z.infer<typeof CreateConditionReportRequestSchema>;

export const CreateConnectorInstanceBodySchema = z.object({
  organization_id: z.string(),
  connector_definition_id: z.string(),
  name: z.string(),
  config: z.any().nullable().optional(),
}).passthrough();

export type CreateConnectorInstanceBody = z.infer<typeof CreateConnectorInstanceBodySchema>;

export const CreateDatasetBodySchema = z.object({
  organization_id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  schema_def: z.any().nullable().optional(),
}).passthrough();

export type CreateDatasetBody = z.infer<typeof CreateDatasetBodySchema>;

export const CreateLabelRequestSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
  label_format: z.string().optional(),
  barcode_value: z.string().nullable().optional(),
  department_id: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
}).passthrough();

export type CreateLabelRequest = z.infer<typeof CreateLabelRequestSchema>;

export const CreateLabelsBatchRequestSchema = z.object({
  entries: z.array(BatchLabelEntrySchema),
  label_format: z.string().optional(),
  department_id: z.string().nullable().optional(),
}).passthrough();

export type CreateLabelsBatchRequest = z.infer<typeof CreateLabelsBatchRequestSchema>;

export const CreateLookupValueBodySchema = z.object({
  label: z.string(),
  value_key: z.string(),
  description: z.string().nullable().optional(),
  icon_name: z.string().nullable().optional(),
  sort_order: z.number().optional(),
}).passthrough();

export type CreateLookupValueBody = z.infer<typeof CreateLookupValueBodySchema>;

export const CreateObjectPersonAuthorityLinkRequestSchema = z.object({
  authority_id: z.string(),
  role: z.string(),
  role_qualifier: z.string().nullable().optional(),
  attribution_certainty: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  display_name_override: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).passthrough();

export type CreateObjectPersonAuthorityLinkRequest = z.infer<typeof CreateObjectPersonAuthorityLinkRequestSchema>;

export const CreateObjectPlaceAuthorityLinkRequestSchema = z.object({
  place_authority_id: z.string(),
  role: z.string(),
  date_display: z.string().nullable().optional(),
  date_earliest: z.string().nullable().optional(),
  date_latest: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
}).passthrough();

export type CreateObjectPlaceAuthorityLinkRequest = z.infer<typeof CreateObjectPlaceAuthorityLinkRequestSchema>;

export const CreateObjectStylePeriodLinkRequestSchema = z.object({
  authority_id: z.string(),
  assignment_certainty: z.string().nullable().optional(),
  assignment_note: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
}).passthrough();

export type CreateObjectStylePeriodLinkRequest = z.infer<typeof CreateObjectStylePeriodLinkRequestSchema>;

export const CreateObjectSubjectLinkRequestSchema = z.object({
  subject_authority_id: z.string(),
  subject_extent: z.string().nullable().optional(),
  interpretation_note: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
}).passthrough();

export type CreateObjectSubjectLinkRequest = z.infer<typeof CreateObjectSubjectLinkRequestSchema>;

export const CreateOrganizationBodySchema = z.object({
  name: z.string(),
  slug: z.string(),
  timezone: z.string().optional(),
}).passthrough();

export type CreateOrganizationBody = z.infer<typeof CreateOrganizationBodySchema>;

export const CreatePageBodySchema = z.object({
  title: z.string(),
  slug: z.string().nullable().optional(),
  page_type: z.string().optional(),
  template: z.string().optional(),
  excerpt: z.string().nullable().optional(),
  meta_title: z.string().nullable().optional(),
  meta_description: z.string().nullable().optional(),
  featured_image_media_id: z.string().nullable().optional(),
  og_image_media_id: z.string().nullable().optional(),
  parent_page_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  publish_at: z.string().nullable().optional(),
  blocks: z.array(z.any()).optional(),
}).passthrough();

export type CreatePageBody = z.infer<typeof CreatePageBodySchema>;

export const CreatePersonAuthorityRequestSchema = z.object({
  preferred_name: z.string(),
  constituent_type: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  culture: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  life_roles: z.array(z.string()).nullable().optional(),
  birth_date_display: z.string().nullable().optional(),
  birth_date_earliest: z.string().nullable().optional(),
  birth_date_latest: z.string().nullable().optional(),
  birth_place: z.string().nullable().optional(),
  death_date_display: z.string().nullable().optional(),
  death_date_earliest: z.string().nullable().optional(),
  death_date_latest: z.string().nullable().optional(),
  death_place: z.string().nullable().optional(),
  active_date_display: z.string().nullable().optional(),
  biography: z.string().nullable().optional(),
  ulan_id: z.string().nullable().optional(),
  viaf_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  external_uris: z.array(z.string()).nullable().optional(),
  status: z.string().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
  cataloger_notes: z.string().nullable().optional(),
}).passthrough();

export type CreatePersonAuthorityRequest = z.infer<typeof CreatePersonAuthorityRequestSchema>;

export const PipelineSourceBodySchema = z.object({
  connector_instance_id: z.string(),
  enabled: z.boolean().optional(),
  parameters: z.any().nullable().optional(),
  ordering: z.number().optional(),
}).passthrough();

export type PipelineSourceBody = z.infer<typeof PipelineSourceBodySchema>;

export const PipelineDestinationBodySchema = z.object({
  connector_instance_id: z.string(),
  enabled: z.boolean().optional(),
  parameters: z.any().nullable().optional(),
  ordering: z.number().optional(),
  publish_deletes: z.boolean().optional(),
  delete_strategy: z.string().nullable().optional(),
}).passthrough();

export type PipelineDestinationBody = z.infer<typeof PipelineDestinationBodySchema>;

export const CreatePipelineBodySchema = z.object({
  organization_id: z.string(),
  dataset_id: z.string().nullable().optional(),
  status: z.string().optional(),
  sources: z.array(PipelineSourceBodySchema),
  destinations: z.array(PipelineDestinationBodySchema).optional(),
}).passthrough();

export type CreatePipelineBody = z.infer<typeof CreatePipelineBodySchema>;

export const CreatePlaceAuthorityRequestSchema = z.object({
  preferred_name: z.string(),
  place_type: z.string().nullable().optional(),
  tgn_id: z.string().nullable().optional(),
  geonames_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  coordinates_lat: z.number().nullable().optional(),
  coordinates_lng: z.number().nullable().optional(),
  parent_place_id: z.string().nullable().optional(),
  hierarchy_path: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  variant_names: z.array(z.record(z.string(), z.any())).nullable().optional(),
}).passthrough();

export type CreatePlaceAuthorityRequest = z.infer<typeof CreatePlaceAuthorityRequestSchema>;

export const CreateRedirectBodySchema = z.object({
  source_path: z.string(),
  target_path: z.string(),
  redirect_type: z.number().optional(),
  is_active: z.boolean().optional(),
  note: z.string().nullable().optional(),
}).passthrough();

export type CreateRedirectBody = z.infer<typeof CreateRedirectBodySchema>;

export const CreateRunBodySchema = z.object({
  pipeline_id: z.string(),
  triggered_by: z.string().optional(),
  parameters: z.any().optional(),
  force_full_sync: z.boolean().optional(),
}).passthrough();

export type CreateRunBody = z.infer<typeof CreateRunBodySchema>;

export const CreateScheduleBodySchema = z.object({
  type: z.string().optional(),
  every_n: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  time_hour: z.number().nullable().optional(),
  time_minute: z.number().nullable().optional(),
  timezone: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
}).passthrough();

export type CreateScheduleBody = z.infer<typeof CreateScheduleBodySchema>;

export const CreateStaffConversationBodySchema = z.object({
  context_entity_type: z.string().nullable().optional(),
  context_entity_id: z.string().nullable().optional(),
}).passthrough();

export type CreateStaffConversationBody = z.infer<typeof CreateStaffConversationBodySchema>;

export const CreateStylePeriodAuthorityRequestSchema = z.object({
  preferred_term: z.string(),
  authority_type: z.string().nullable().optional(),
  aat_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  culture: z.string().nullable().optional(),
  date_display: z.string().nullable().optional(),
  date_earliest: z.string().nullable().optional(),
  date_latest: z.string().nullable().optional(),
  geographic_scope: z.string().nullable().optional(),
  parent_authority_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  variant_terms: z.array(z.record(z.string(), z.any())).nullable().optional(),
}).passthrough();

export type CreateStylePeriodAuthorityRequest = z.infer<typeof CreateStylePeriodAuthorityRequestSchema>;

export const CreateSubjectAuthorityRequestSchema = z.object({
  preferred_term: z.string(),
  subject_type: z.string().nullable().optional(),
  aat_id: z.string().nullable().optional(),
  iconclass_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  broader_subject_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  variant_terms: z.array(z.record(z.string(), z.any())).nullable().optional(),
}).passthrough();

export type CreateSubjectAuthorityRequest = z.infer<typeof CreateSubjectAuthorityRequestSchema>;

export const CreateTaskBodySchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assigned_user_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  related_entity_type: z.string().nullable().optional(),
  related_entity_id: z.string().nullable().optional(),
  app_context: z.string().nullable().optional(),
}).passthrough();

export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;

export const CreateUserBodySchema = z.object({
  email: z.string(),
  name: z.string().nullable().optional(),
  role_id: z.string(),
}).passthrough();

export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;

export const UserCreatedOutSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  status: z.string(),
  created: z.boolean().nullable().optional(),
}).passthrough();

export type UserCreatedOut = z.infer<typeof UserCreatedOutSchema>;

export const MembershipCreatedOutSchema = z.object({
  membership_id: z.string(),
  organization_id: z.string(),
  role_id: z.string(),
  role_key: z.string(),
  status: z.string(),
  created_at: z.string(),
  created: z.boolean().nullable().optional(),
}).passthrough();

export type MembershipCreatedOut = z.infer<typeof MembershipCreatedOutSchema>;

export const CreateUserResponseSchema = z.object({
  user: UserCreatedOutSchema.nullable().optional(),
  membership: MembershipCreatedOutSchema.nullable().optional(),
  invitation_sent: z.boolean().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;

export const CreateVisitorConversationBodySchema = z.object({
  session_id: z.string().nullable().optional(),
  locale: z.string().optional(),
  source: z.string().nullable().optional(),
  context_entity_type: z.string().nullable().optional(),
  context_entity_id: z.string().nullable().optional(),
}).passthrough();

export type CreateVisitorConversationBody = z.infer<typeof CreateVisitorConversationBodySchema>;

export const CriticalResponseOutSchema = z.object({
  response_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  comment_text: z.string().nullable().optional(),
  comment_summary: z.string().nullable().optional(),
  document_type: z.string().nullable().optional(),
  author_name: z.string().nullable().optional(),
  author_authority_id: z.string().nullable().optional(),
  comment_date_display: z.string().nullable().optional(),
  comment_date_earliest: z.string().nullable().optional(),
  comment_date_latest: z.string().nullable().optional(),
  circumstances: z.string().nullable().optional(),
  publication_info: z.string().nullable().optional(),
  citation_id: z.string().nullable().optional(),
  source_page: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type CriticalResponseOut = z.infer<typeof CriticalResponseOutSchema>;

export const CriticalResponseListResponseSchema = z.object({
  critical_responses: z.array(CriticalResponseOutSchema),
}).passthrough();

export type CriticalResponseListResponse = z.infer<typeof CriticalResponseListResponseSchema>;

export const MFAFactorsOutSchema = z.object({
  totp: z.boolean().optional(),
  sms: z.boolean().optional(),
  email: z.boolean().optional(),
  preferred: z.string().nullable().optional(),
}).passthrough();

export type MFAFactorsOut = z.infer<typeof MFAFactorsOutSchema>;

export const CurrentUserResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  email_verified_at: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  active_organization_id: z.string().nullable().optional(),
  permissions: z.array(z.string()).optional(),
  role_key: z.string().nullable().optional(),
  role_label: z.string().nullable().optional(),
  role_id: z.string().nullable().optional(),
  role_type: z.string().nullable().optional(),
  is_platform_admin: z.boolean().optional(),
  role_override: z.string().nullable().optional(),
  applications: z.array(z.any()).optional(),
  agent_enabled: z.boolean().optional(),
  ai_tagging_enabled: z.boolean().optional(),
  transcription_enabled: z.boolean().optional(),
  role_testing_enabled: z.boolean().optional(),
  department_memberships: z.array(z.any()).optional(),
  primary_department_id: z.string().nullable().optional(),
  organizations: z.array(z.any()).optional(),
  mfa_factors: MFAFactorsOutSchema.nullable().optional(),
  mfa_available: z.boolean().optional(),
}).passthrough();

export type CurrentUserResponse = z.infer<typeof CurrentUserResponseSchema>;

export const DailyRunStatSchema = z.object({
  date: z.string().nullable().optional(),
  total: z.number().optional(),
  success: z.number().optional(),
  failed: z.number().optional(),
  entities: z.number().optional(),
}).passthrough();

export type DailyRunStat = z.infer<typeof DailyRunStatSchema>;

export const DailyRunsResponseSchema = z.object({
  days: z.array(DailyRunStatSchema),
}).passthrough();

export type DailyRunsResponse = z.infer<typeof DailyRunsResponseSchema>;

export const GreetingResponseSchema = z.object({
  subtitle: z.string(),
}).passthrough();

export type GreetingResponse = z.infer<typeof GreetingResponseSchema>;

export const SuggestionsResponseSchema = z.object({
  suggestions: z.array(z.string()),
}).passthrough();

export type SuggestionsResponse = z.infer<typeof SuggestionsResponseSchema>;

export const PulseStatOutSchema = z.object({
  value: z.number(),
  label: z.string(),
}).passthrough();

export type PulseStatOut = z.infer<typeof PulseStatOutSchema>;

export const PulseRecentObjectOutSchema = z.object({
  name: z.string(),
  href: z.string(),
  updated_ago: z.string(),
}).passthrough();

export type PulseRecentObjectOut = z.infer<typeof PulseRecentObjectOutSchema>;

export const PulseResponseSchema = z.object({
  stats: z.array(PulseStatOutSchema),
  recent_object: PulseRecentObjectOutSchema.nullable().optional(),
}).passthrough();

export type PulseResponse = z.infer<typeof PulseResponseSchema>;

export const WorkshopCountsResponseSchema = z.object({
  bridge_running: z.number(),
  collections_records: z.number(),
  guide_active_conversations: z.number(),
  content_drafts: z.number(),
  media_assets: z.number(),
}).passthrough();

export type WorkshopCountsResponse = z.infer<typeof WorkshopCountsResponseSchema>;

export const DashboardSummaryResponseSchema = z.object({
  greeting: GreetingResponseSchema,
  suggestions: SuggestionsResponseSchema,
  attention: AttentionV2ResponseSchema,
  pulse: PulseResponseSchema,
  workshop: WorkshopCountsResponseSchema,
  activity: ActivityResponseSchema,
}).passthrough();

export type DashboardSummaryResponse = z.infer<typeof DashboardSummaryResponseSchema>;

export const DatasetSummaryOutSchema = z.object({
  dataset_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  entity_count: z.number(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type DatasetSummaryOut = z.infer<typeof DatasetSummaryOutSchema>;

export const DatasetListResponseSchema = z.object({
  items: z.array(DatasetSummaryOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type DatasetListResponse = z.infer<typeof DatasetListResponseSchema>;

export const DatasetOutSchema = z.object({
  dataset_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  schema_: z.any().nullable().optional(),
  role: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  entity_count: z.number().nullable().optional(),
}).passthrough();

export type DatasetOut = z.infer<typeof DatasetOutSchema>;

export const SampleRecordOutSchema = z.object({
  entity_key: z.string(),
  entity_type: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  object_number: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  modified_at: z.string().nullable().optional(),
  last_seen_at: z.string().nullable().optional(),
}).passthrough();

export type SampleRecordOut = z.infer<typeof SampleRecordOutSchema>;

export const DatasetPreviewResponseSchema = z.object({
  dataset_id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  schema_: z.any().nullable().optional(),
  sample_records: z.array(SampleRecordOutSchema),
  total_records: z.number(),
  sample_count: z.number(),
}).passthrough();

export type DatasetPreviewResponse = z.infer<typeof DatasetPreviewResponseSchema>;

export const SchemaRefOutSchema = z.object({
  schema_id: z.string(),
  schema_version: z.string(),
  schema_definition: z.any(),
}).passthrough();

export type SchemaRefOut = z.infer<typeof SchemaRefOutSchema>;

export const DatasetSchemaResponseSchema = z.object({
  dataset_id: z.string(),
  schema_ref: SchemaRefOutSchema,
}).passthrough();

export type DatasetSchemaResponse = z.infer<typeof DatasetSchemaResponseSchema>;

export const DatasetSummaryItemSchema = z.object({
  dataset_id: z.string(),
  name: z.string().nullable().optional(),
  entity_count: z.number().optional(),
  last_run_at: z.string().nullable().optional(),
  runs_total: z.number().optional(),
  runs_successful: z.number().optional(),
  success_rate: z.number().nullable().optional(),
}).passthrough();

export type DatasetSummaryItem = z.infer<typeof DatasetSummaryItemSchema>;

export const DatasetsSummaryResponseSchema = z.object({
  datasets: z.array(DatasetSummaryItemSchema),
}).passthrough();

export type DatasetsSummaryResponse = z.infer<typeof DatasetsSummaryResponseSchema>;

export const DayCountSchema = z.object({
  date: z.string(),
  count: z.number(),
}).passthrough();

export type DayCount = z.infer<typeof DayCountSchema>;

export const DeaccessionAuditListResponseSchema = z.object({
  audit_trail: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type DeaccessionAuditListResponse = z.infer<typeof DeaccessionAuditListResponseSchema>;

export const DeaccessionAuditOutSchema = z.object({
}).passthrough();

export type DeaccessionAuditOut = z.infer<typeof DeaccessionAuditOutSchema>;

export const DeaccessionDetailResponseSchema = z.object({
}).passthrough();

export type DeaccessionDetailResponse = z.infer<typeof DeaccessionDetailResponseSchema>;

export const DeaccessionListResponseSchema = z.object({
  items: z.array(z.any()).optional(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type DeaccessionListResponse = z.infer<typeof DeaccessionListResponseSchema>;

export const DeaccessionOutSchema = z.object({
  deaccession_id: z.string(),
  organization_id: z.string(),
  deaccession_number: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type DeaccessionOut = z.infer<typeof DeaccessionOutSchema>;

export const DeepHealthResponseSchema = z.object({
  status: z.string(),
  checks: z.record(z.string(), z.any()),
  response_time_ms: z.number(),
}).passthrough();

export type DeepHealthResponse = z.infer<typeof DeepHealthResponseSchema>;

export const DefinitionOutSchema = z.object({
  definition_id: z.string(),
  organization_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  relationship_type: z.string().nullable().optional(),
  source_dataset_id: z.string().nullable().optional(),
  source_entity_type: z.string().nullable().optional(),
  source_field_path: z.string().nullable().optional(),
  target_dataset_id: z.string().nullable().optional(),
  target_entity_type: z.string().nullable().optional(),
  target_field_path: z.string().nullable().optional(),
  match_transform: z.string().nullable().optional(),
  case_sensitive: z.boolean().nullable().optional(),
  enabled: z.boolean().nullable().optional(),
  auto_link_on_ingest: z.boolean().nullable().optional(),
  bidirectional: z.boolean().nullable().optional(),
  inverse_relationship_type: z.string().nullable().optional(),
  created_by_user_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type DefinitionOut = z.infer<typeof DefinitionOutSchema>;

export const DefinitionCreatedResponseSchema = z.object({
  definition: DefinitionOutSchema,
}).passthrough();

export type DefinitionCreatedResponse = z.infer<typeof DefinitionCreatedResponseSchema>;

export const DefinitionDetailResponseSchema = z.object({
  definition: DefinitionOutSchema,
}).passthrough();

export type DefinitionDetailResponse = z.infer<typeof DefinitionDetailResponseSchema>;

export const DefinitionListResponseSchema = z.object({
  items: z.array(DefinitionOutSchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
}).passthrough();

export type DefinitionListResponse = z.infer<typeof DefinitionListResponseSchema>;

export const DeleteFolderResponseSchema = z.object({
  success: z.boolean().optional(),
  media_items_affected: z.number(),
}).passthrough();

export type DeleteFolderResponse = z.infer<typeof DeleteFolderResponseSchema>;

export const DeleteReportTemplateResponseSchema = z.object({
  message: z.string(),
}).passthrough();

export type DeleteReportTemplateResponse = z.infer<typeof DeleteReportTemplateResponseSchema>;

export const DeleteTagDefinitionResponseSchema = z.object({
  success: z.boolean().optional(),
  hard_deleted: z.boolean(),
}).passthrough();

export type DeleteTagDefinitionResponse = z.infer<typeof DeleteTagDefinitionResponseSchema>;

export const DeleteWatermarkTemplateResponseSchema = z.object({
  success: z.boolean().optional(),
  template_id: z.string(),
}).passthrough();

export type DeleteWatermarkTemplateResponse = z.infer<typeof DeleteWatermarkTemplateResponseSchema>;

export const DeletedResponseSchema = z.object({
  deleted: z.boolean().optional(),
}).passthrough();

export type DeletedResponse = z.infer<typeof DeletedResponseSchema>;

export const DepartmentMembershipInfoSchema = z.object({
  membership_id: z.string(),
  department_id: z.string(),
  department_name: z.string().nullable().optional(),
  department_code: z.string().nullable().optional(),
  department_color: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
}).passthrough();

export type DepartmentMembershipInfo = z.infer<typeof DepartmentMembershipInfoSchema>;

export const DepartmentMembershipOutSchema = z.object({
  membership_id: z.string(),
  department_id: z.string(),
  organization_id: z.string(),
  user_id: z.string(),
  role: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type DepartmentMembershipOut = z.infer<typeof DepartmentMembershipOutSchema>;

export const DepartmentOutSchema = z.object({
  department_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  depth: z.number().nullable().optional(),
  head_user_id: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  is_active: z.boolean().optional(),
  member_count: z.number().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type DepartmentOut = z.infer<typeof DepartmentOutSchema>;

export const DerivativeOutSchema = z.object({
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  format: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
}).passthrough();

export type DerivativeOut = z.infer<typeof DerivativeOutSchema>;

export const DerivativeSizeCreatedResponseSchema = z.object({
  config_id: z.string(),
  name: z.string(),
  label: z.string(),
}).passthrough();

export type DerivativeSizeCreatedResponse = z.infer<typeof DerivativeSizeCreatedResponseSchema>;

export const DerivativeSizeOutSchema = z.object({
  config_id: z.string(),
  organization_id: z.string().nullable().optional(),
  name: z.string(),
  label: z.string(),
  media_type: z.string().nullable().optional(),
  max_width: z.number().nullable().optional(),
  max_height: z.number().nullable().optional(),
  format: z.string().nullable().optional(),
  quality: z.number().nullable().optional(),
  config: z.any().nullable().optional(),
  is_default: z.boolean().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  is_system: z.boolean().nullable().optional(),
}).passthrough();

export type DerivativeSizeOut = z.infer<typeof DerivativeSizeOutSchema>;

export const DerivativeSizeListResponseSchema = z.object({
  derivative_sizes: z.array(DerivativeSizeOutSchema),
}).passthrough();

export type DerivativeSizeListResponse = z.infer<typeof DerivativeSizeListResponseSchema>;

export const DimensionOutSchema = z.object({
  dimension: z.string().nullable().optional(),
  value: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  part: z.string().nullable().optional(),
}).passthrough();

export type DimensionOut = z.infer<typeof DimensionOutSchema>;

export const DisableAppResponseSchema = z.object({
  message: z.string(),
  application_key: z.string(),
  enabled: z.boolean(),
}).passthrough();

export type DisableAppResponse = z.infer<typeof DisableAppResponseSchema>;

export const DiscoverConfigOutSchema = z.object({
  hero_media_id: z.string().nullable().optional(),
  page_title: z.string().nullable().optional(),
  page_subtitle: z.string().nullable().optional(),
  show_object_count: z.boolean().nullable().optional(),
  default_view_mode: z.string().nullable().optional(),
  default_sort: z.string().nullable().optional(),
  header_logo_media_id: z.string().nullable().optional(),
  primary_color: z.string().nullable().optional(),
  accent_color: z.string().nullable().optional(),
  font_family: z.string().nullable().optional(),
  nav_items: z.any().optional(),
  footer_text: z.string().nullable().optional(),
  social_links: z.any().optional(),
  featured_object_ids: z.any().optional(),
  homepage_page_id: z.string().nullable().optional(),
  custom_404_page_id: z.string().nullable().optional(),
  secondary_color: z.string().nullable().optional(),
  background_color: z.string().nullable().optional(),
  text_color: z.string().nullable().optional(),
  heading_font_family: z.string().nullable().optional(),
  body_font_family: z.string().nullable().optional(),
  button_style: z.string().nullable().optional(),
  header_style: z.string().nullable().optional(),
  google_fonts: z.any().optional(),
  custom_css: z.string().nullable().optional(),
  footer_columns: z.any().optional(),
  land_acknowledgment: z.string().nullable().optional(),
  footer_logo_media_id: z.string().nullable().optional(),
  external_integrations: z.any().optional(),
  analytics_config: z.any().optional(),
  cdn_config: z.any().optional(),
}).passthrough();

export type DiscoverConfigOut = z.infer<typeof DiscoverConfigOutSchema>;

export const DiscoverEventOutSchema = z.object({
  event_id: z.string(),
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  event_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  start_at: z.string().nullable().optional(),
  end_at: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  short_description: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  venue_slug: z.string().nullable().optional(),
  capacity: z.number().nullable().optional(),
  registration_url: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  price_member: z.string().nullable().optional(),
  age_range: z.string().nullable().optional(),
  is_featured: z.boolean().nullable().optional(),
  series_name: z.string().nullable().optional(),
  tags: z.any().nullable().optional(),
  hero_image_url: z.string().nullable().optional(),
  exhibition: z.record(z.string(), z.any()).nullable().optional(),
}).passthrough();

export type DiscoverEventOut = z.infer<typeof DiscoverEventOutSchema>;

export const DiscoverEventDetailOutSchema = z.object({
  event_id: z.string(),
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  event_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  start_at: z.string().nullable().optional(),
  end_at: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  short_description: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  venue_slug: z.string().nullable().optional(),
  capacity: z.number().nullable().optional(),
  registration_url: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  price_member: z.string().nullable().optional(),
  age_range: z.string().nullable().optional(),
  is_featured: z.boolean().nullable().optional(),
  series_name: z.string().nullable().optional(),
  tags: z.any().nullable().optional(),
  hero_image_url: z.string().nullable().optional(),
  exhibition: z.record(z.string(), z.any()).nullable().optional(),
}).passthrough();

export type DiscoverEventDetailOut = z.infer<typeof DiscoverEventDetailOutSchema>;

export const DiscoverEventListResponseSchema = z.object({
  data: z.array(DiscoverEventOutSchema),
  total: z.number(),
}).passthrough();

export type DiscoverEventListResponse = z.infer<typeof DiscoverEventListResponseSchema>;

export const DiscoverRelatedObjectOutSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  creators: z.array(z.string()).nullable().optional(),
  creation_date_display: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  thumbnail_srcset: z.any().nullable().optional(),
}).passthrough();

export type DiscoverRelatedObjectOut = z.infer<typeof DiscoverRelatedObjectOutSchema>;

export const DiscoverExhibitionDetailOutSchema = z.object({
  exhibition_id: z.string(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  public_url_slug: z.string().nullable().optional(),
  exhibition_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_end_date: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  short_description: z.string().nullable().optional(),
  credits: z.string().nullable().optional(),
  visitor_info: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  venue_slug: z.string().nullable().optional(),
  is_featured: z.boolean().nullable().optional(),
  ticketing_url: z.string().nullable().optional(),
  hero_image_url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  tags: z.any().nullable().optional(),
  related_objects: z.array(DiscoverRelatedObjectOutSchema).nullable().optional(),
}).passthrough();

export type DiscoverExhibitionDetailOut = z.infer<typeof DiscoverExhibitionDetailOutSchema>;

export const DiscoverExhibitionListItemOutSchema = z.object({
  exhibition_id: z.string(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  public_url_slug: z.string().nullable().optional(),
  exhibition_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_end_date: z.string().nullable().optional(),
  short_description: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  venue_slug: z.string().nullable().optional(),
  is_featured: z.boolean().nullable().optional(),
  ticketing_url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  tags: z.any().nullable().optional(),
}).passthrough();

export type DiscoverExhibitionListItemOut = z.infer<typeof DiscoverExhibitionListItemOutSchema>;

export const DiscoverExhibitionListResponseSchema = z.object({
  data: z.array(DiscoverExhibitionListItemOutSchema),
  total: z.number(),
}).passthrough();

export type DiscoverExhibitionListResponse = z.infer<typeof DiscoverExhibitionListResponseSchema>;

export const DiscoverExhibitionSummaryOutSchema = z.object({
  exhibition_id: z.string(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  public_url_slug: z.string().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  short_description: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
}).passthrough();

export type DiscoverExhibitionSummaryOut = z.infer<typeof DiscoverExhibitionSummaryOutSchema>;

export const DiscoverFacetBucketOutSchema = z.object({
  key: z.string(),
  count: z.number(),
}).passthrough();

export type DiscoverFacetBucketOut = z.infer<typeof DiscoverFacetBucketOutSchema>;

export const DiscoverFacetOutSchema = z.object({
  field: z.string(),
  buckets: z.array(DiscoverFacetBucketOutSchema),
}).passthrough();

export type DiscoverFacetOut = z.infer<typeof DiscoverFacetOutSchema>;

export const DiscoverInfoOutSchema = z.object({
  organization_name: z.string().nullable().optional(),
  organization_slug: z.string().nullable().optional(),
  total_discoverable: z.number().optional(),
  hero_image_url: z.string().nullable().optional(),
  page_title: z.string().nullable().optional(),
  page_subtitle: z.string().nullable().optional(),
  show_object_count: z.boolean().optional(),
  default_view_mode: z.string().optional(),
  default_sort: z.string().optional(),
  header_logo_url: z.string().nullable().optional(),
  primary_color: z.string().nullable().optional(),
  accent_color: z.string().nullable().optional(),
  font_family: z.string().nullable().optional(),
  nav_items: z.any().nullable().optional(),
  footer_text: z.string().nullable().optional(),
  social_links: z.any().nullable().optional(),
  homepage_page_id: z.string().nullable().optional(),
  custom_404_page_id: z.string().nullable().optional(),
  secondary_color: z.string().nullable().optional(),
  background_color: z.string().nullable().optional(),
  text_color: z.string().nullable().optional(),
  heading_font_family: z.string().nullable().optional(),
  body_font_family: z.string().nullable().optional(),
  button_style: z.string().optional(),
  header_style: z.string().optional(),
  google_fonts: z.any().nullable().optional(),
  custom_css: z.string().nullable().optional(),
  footer_columns: z.any().nullable().optional(),
  land_acknowledgment: z.string().nullable().optional(),
  footer_logo_url: z.string().nullable().optional(),
  external_integrations: z.any().nullable().optional(),
  analytics_config: z.any().nullable().optional(),
  guide_enabled: z.boolean().optional(),
  widget_enabled: z.boolean().optional(),
  widget_welcome_message: z.string().nullable().optional(),
}).passthrough();

export type DiscoverInfoOut = z.infer<typeof DiscoverInfoOutSchema>;

export const DiscoverMeasurementOutSchema = z.object({
  dimension: z.string().nullable().optional(),
  value: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  part: z.string().nullable().optional(),
}).passthrough();

export type DiscoverMeasurementOut = z.infer<typeof DiscoverMeasurementOutSchema>;

export const DiscoverMediaOutSchema = z.object({
  media_id: z.string(),
  url: z.string().nullable().optional(),
  srcset: z.any().nullable().optional(),
  media_type: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  alt_text: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  is_primary: z.boolean().nullable().optional(),
  caption: z.string().nullable().optional(),
}).passthrough();

export type DiscoverMediaOut = z.infer<typeof DiscoverMediaOutSchema>;

export const DiscoverTitleOutSchema = z.object({
  title: z.string().nullable().optional(),
  title_type: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  is_preferred: z.boolean().nullable().optional(),
}).passthrough();

export type DiscoverTitleOut = z.infer<typeof DiscoverTitleOutSchema>;

export const DiscoverObjectDetailOutSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  titles: z.array(DiscoverTitleOutSchema).nullable().optional(),
  brief_description: z.string().nullable().optional(),
  full_description: z.string().nullable().optional(),
  object_type: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  classifications: z.array(z.record(z.string(), z.any())).nullable().optional(),
  creators: z.array(z.string()).nullable().optional(),
  creation_date_display: z.string().nullable().optional(),
  creation_date_earliest: z.string().nullable().optional(),
  creation_date_latest: z.string().nullable().optional(),
  creation_place: z.string().nullable().optional(),
  materials: z.any().nullable().optional(),
  techniques: z.any().nullable().optional(),
  measurements: z.array(DiscoverMeasurementOutSchema).nullable().optional(),
  inscriptions: z.array(z.string()).nullable().optional(),
  style_period: z.string().nullable().optional(),
  provenance: z.string().nullable().optional(),
  credit_line: z.string().nullable().optional(),
  media: z.array(DiscoverMediaOutSchema).nullable().optional(),
  has_image: z.boolean().optional(),
}).passthrough();

export type DiscoverObjectDetailOut = z.infer<typeof DiscoverObjectDetailOutSchema>;

export const DiscoverPreviewResponseSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  titles: z.array(z.any()).nullable().optional(),
  brief_description: z.string().nullable().optional(),
  full_description: z.string().nullable().optional(),
  object_type: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  classifications: z.array(z.any()).nullable().optional(),
  creators: z.array(z.any()).nullable().optional(),
  creation_date_display: z.string().nullable().optional(),
  creation_date_earliest: z.string().nullable().optional(),
  creation_date_latest: z.string().nullable().optional(),
  creation_place: z.string().nullable().optional(),
  materials: z.any().optional(),
  techniques: z.any().optional(),
  measurements: z.array(z.any()).nullable().optional(),
  inscriptions: z.array(z.any()).nullable().optional(),
  style_period: z.string().nullable().optional(),
  provenance: z.string().nullable().optional(),
  credit_line: z.string().nullable().optional(),
  media: z.array(z.any()).nullable().optional(),
  has_image: z.boolean(),
  is_currently_discoverable: z.boolean(),
  unpublished_media_count: z.number(),
  preview_warnings: z.array(z.string()),
}).passthrough();

export type DiscoverPreviewResponse = z.infer<typeof DiscoverPreviewResponseSchema>;

export const DiscoverSearchHitOutSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  brief_description: z.string().nullable().optional(),
  creators: z.array(z.string()).nullable().optional(),
  creation_date_display: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  object_type: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  thumbnail_srcset: z.any().nullable().optional(),
  has_image: z.boolean().optional(),
}).passthrough();

export type DiscoverSearchHitOut = z.infer<typeof DiscoverSearchHitOutSchema>;

export const DiscoverSearchResponseSchema = z.object({
  hits: z.array(DiscoverSearchHitOutSchema),
  total: z.number(),
  facets: z.array(DiscoverFacetOutSchema).nullable().optional(),
  next_offset: z.number().nullable().optional(),
}).passthrough();

export type DiscoverSearchResponse = z.infer<typeof DiscoverSearchResponseSchema>;

export const DiscoverStaffOutSchema = z.object({
  constituent_id: z.string(),
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  biography: z.string().nullable().optional(),
}).passthrough();

export type DiscoverStaffOut = z.infer<typeof DiscoverStaffOutSchema>;

export const DiscoverStaffListResponseSchema = z.object({
  data: z.array(DiscoverStaffOutSchema),
  total: z.number(),
}).passthrough();

export type DiscoverStaffListResponse = z.infer<typeof DiscoverStaffListResponseSchema>;

export const DiscoverStatsResponseSchema = z.object({
  total_objects: z.number(),
  discoverable_count: z.number(),
  private_count: z.number(),
  pending_schedules: z.number(),
  published_last_30_days: z.number(),
  unpublished_last_30_days: z.number(),
}).passthrough();

export type DiscoverStatsResponse = z.infer<typeof DiscoverStatsResponseSchema>;

export const DiscoverVenueOutSchema = z.object({
  venue_id: z.string(),
  name: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  hours: z.any().nullable().optional(),
  admission: z.any().nullable().optional(),
  accent_color: z.string().nullable().optional(),
  parking_info: z.string().nullable().optional(),
  accessibility_info: z.string().nullable().optional(),
  ticketing_url: z.string().nullable().optional(),
  hero_image_url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
}).passthrough();

export type DiscoverVenueOut = z.infer<typeof DiscoverVenueOutSchema>;

export const DiscoverVenueDetailOutSchema = z.object({
  venue_id: z.string(),
  name: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  hours: z.any().nullable().optional(),
  admission: z.any().nullable().optional(),
  accent_color: z.string().nullable().optional(),
  parking_info: z.string().nullable().optional(),
  accessibility_info: z.string().nullable().optional(),
  ticketing_url: z.string().nullable().optional(),
  hero_image_url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  exhibitions: z.array(DiscoverExhibitionSummaryOutSchema).nullable().optional(),
}).passthrough();

export type DiscoverVenueDetailOut = z.infer<typeof DiscoverVenueDetailOutSchema>;

export const DiscoverVenueListResponseSchema = z.object({
  data: z.array(DiscoverVenueOutSchema),
  total: z.number(),
}).passthrough();

export type DiscoverVenueListResponse = z.infer<typeof DiscoverVenueListResponseSchema>;

export const DiscoverableToggleResponseSchema = z.object({
  object_id: z.string(),
  is_discoverable: z.boolean(),
  discoverable_at: z.string().nullable().optional(),
}).passthrough();

export type DiscoverableToggleResponse = z.infer<typeof DiscoverableToggleResponseSchema>;

export const DismissHintOutSchema = z.object({
  dismissed: z.boolean(),
  hintId: z.string(),
  scope: z.string(),
}).passthrough();

export type DismissHintOut = z.infer<typeof DismissHintOutSchema>;

export const DismissedHintsOutSchema = z.object({
  dismissedHints: z.array(z.string()),
}).passthrough();

export type DismissedHintsOut = z.infer<typeof DismissedHintsOutSchema>;

export const DisplayProfileSchema = z.object({
  primary_field: z.string(),
  secondary_field: z.string(),
  thumbnail_field: z.string(),
}).passthrough();

export type DisplayProfile = z.infer<typeof DisplayProfileSchema>;

export const DistanceResponseSchema = z.object({
  distance_km: z.number(),
  distance_miles: z.number(),
}).passthrough();

export type DistanceResponse = z.infer<typeof DistanceResponseSchema>;

export const DocDeleteResponseSchema = z.object({
  success: z.boolean().optional(),
  deleted_page_key: z.string(),
}).passthrough();

export type DocDeleteResponse = z.infer<typeof DocDeleteResponseSchema>;

export const OrgScopedDocOutSchema = z.object({
  doc_id: z.string(),
  organization_id: z.string(),
  page_key: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  body_markdown: z.string().nullable().optional(),
  audience: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type OrgScopedDocOut = z.infer<typeof OrgScopedDocOutSchema>;

export const DocListResponseSchema = z.object({
  docs: z.array(OrgScopedDocOutSchema),
}).passthrough();

export type DocListResponse = z.infer<typeof DocListResponseSchema>;

export const DocResponseSchema = z.object({
  doc: OrgScopedDocOutSchema.nullable().optional(),
}).passthrough();

export type DocResponse = z.infer<typeof DocResponseSchema>;

export const DocumentTemplateOutSchema = z.object({
  template_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  template_type: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  is_default: z.boolean().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type DocumentTemplateOut = z.infer<typeof DocumentTemplateOutSchema>;

export const DocumentTemplateListResponseSchema = z.object({
  templates: z.array(DocumentTemplateOutSchema),
}).passthrough();

export type DocumentTemplateListResponse = z.infer<typeof DocumentTemplateListResponseSchema>;

export const DocumentationPlanOutSchema = z.object({
  plan_id: z.string(),
  organization_id: z.string(),
  plan_number: z.string().nullable().optional(),
  title: z.string(),
  plan_type: z.string().nullable().optional(),
  scope_description: z.string().nullable().optional(),
  target_collections: z.any().optional(),
  target_object_types: z.any().optional(),
  priority_criteria: z.any().optional(),
  objectives: z.string().nullable().optional(),
  measurable_results: z.any().optional(),
  actions: z.any().optional(),
  milestones: z.any().optional(),
  resources_required: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  review_frequency: z.string().nullable().optional(),
  next_review_date: z.string().nullable().optional(),
  last_review_date: z.string().nullable().optional(),
  review_notes: z.string().nullable().optional(),
  proposed_by: z.string().nullable().optional(),
  proposed_date: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  approved_at: z.string().nullable().optional(),
  approval_note: z.string().nullable().optional(),
  completion_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type DocumentationPlanOut = z.infer<typeof DocumentationPlanOutSchema>;

export const DocumentationPlanListResponseSchema = z.object({
  items: z.array(DocumentationPlanOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type DocumentationPlanListResponse = z.infer<typeof DocumentationPlanListResponseSchema>;

export const DownloadLinkItemSchema = z.object({
  media_id: z.string().nullable().optional(),
  s3_key: z.string().nullable().optional(),
  download_url: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  mime_type: z.string().nullable().optional(),
}).passthrough();

export type DownloadLinkItem = z.infer<typeof DownloadLinkItemSchema>;

export const DownloadLinksResponseSchema = z.object({
  request_id: z.string(),
  downloads: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type DownloadLinksResponse = z.infer<typeof DownloadLinksResponseSchema>;

export const DownloadRequestItemMediaDetailSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
}).passthrough();

export type DownloadRequestItemMediaDetail = z.infer<typeof DownloadRequestItemMediaDetailSchema>;

export const DownloadRequestItemOutSchema = z.object({
  item_id: z.string(),
  request_id: z.string(),
  media_id: z.string(),
  item_status: z.string().nullable().optional(),
  item_note: z.string().nullable().optional(),
  downloaded: z.boolean().nullable().optional(),
  downloaded_at: z.string().nullable().optional(),
  media: DownloadRequestItemMediaDetailSchema.nullable().optional(),
}).passthrough();

export type DownloadRequestItemOut = z.infer<typeof DownloadRequestItemOutSchema>;

export const RequesterDetailSchema = z.object({
  user_id: z.string(),
  email: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
}).passthrough();

export type RequesterDetail = z.infer<typeof RequesterDetailSchema>;

export const DownloadRequestOutSchema = z.object({
  request_id: z.string(),
  organization_id: z.string(),
  request_number: z.string().nullable().optional(),
  collection_id: z.string().nullable().optional(),
  requester_id: z.string(),
  requester_name: z.string().nullable().optional(),
  requester_email: z.string().nullable().optional(),
  requester_institution: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  intended_use: z.string().nullable().optional(),
  project_description: z.string().nullable().optional(),
  derivative_type_requested: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  reviewed_by_id: z.string().nullable().optional(),
  review_date: z.string().nullable().optional(),
  review_note: z.string().nullable().optional(),
  approved_by_id: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  approval_conditions: z.string().nullable().optional(),
  denial_reason: z.string().nullable().optional(),
  fulfilled_at: z.string().nullable().optional(),
  fulfilled_by_id: z.string().nullable().optional(),
  fulfillment_note: z.string().nullable().optional(),
  download_expires_at: z.string().nullable().optional(),
  download_count: z.number().nullable().optional(),
  max_downloads: z.number().nullable().optional(),
  download_token: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  requester: RequesterDetailSchema.nullable().optional(),
  collection: CollectionDetailSchema.nullable().optional(),
  item_count: z.number().nullable().optional(),
  items: z.array(DownloadRequestItemOutSchema).nullable().optional(),
}).passthrough();

export type DownloadRequestOut = z.infer<typeof DownloadRequestOutSchema>;

export const DownloadRequestListResponseSchema = z.object({
  items: z.array(DownloadRequestOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type DownloadRequestListResponse = z.infer<typeof DownloadRequestListResponseSchema>;

export const DownloadUrlResponseSchema = z.object({
  download_url: z.string(),
}).passthrough();

export type DownloadUrlResponse = z.infer<typeof DownloadUrlResponseSchema>;

export const DuplicatesResponseSchema = z.object({
  duplicates: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type DuplicatesResponse = z.infer<typeof DuplicatesResponseSchema>;

export const EditorObjectOutSchema = z.object({
  exhibition_object_id: z.string(),
  source_type: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  entity_key: z.string().nullable().optional(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  creators: z.array(z.any()).optional(),
  primary_image_url: z.string().nullable().optional(),
  width_cm: z.number().nullable().optional(),
  height_cm: z.number().nullable().optional(),
  depth_cm: z.number().nullable().optional(),
  object_status: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
}).passthrough();

export type EditorObjectOut = z.infer<typeof EditorObjectOutSchema>;

export const EditorObjectListResponseSchema = z.object({
  objects: z.array(EditorObjectOutSchema),
  total: z.number(),
}).passthrough();

export type EditorObjectListResponse = z.infer<typeof EditorObjectListResponseSchema>;

export const EmailEventOutSchema = z.object({
  event_id: z.string(),
  email: z.string(),
  event_type: z.string(),
  bounce_type: z.string().nullable().optional(),
  bounce_subtype: z.string().nullable().optional(),
  complaint_feedback_type: z.string().nullable().optional(),
  message_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type EmailEventOut = z.infer<typeof EmailEventOutSchema>;

export const EmailEventDetailOutSchema = z.object({
  event_id: z.string(),
  email: z.string(),
  event_type: z.string(),
  bounce_type: z.string().nullable().optional(),
  bounce_subtype: z.string().nullable().optional(),
  complaint_feedback_type: z.string().nullable().optional(),
  message_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  sns_message_id: z.string().nullable().optional(),
  raw_message: z.any().nullable().optional(),
}).passthrough();

export type EmailEventDetailOut = z.infer<typeof EmailEventDetailOutSchema>;

export const EmailEventListResponseSchema = z.object({
  items: z.array(EmailEventOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type EmailEventListResponse = z.infer<typeof EmailEventListResponseSchema>;

export const Last30DaysSchema = z.object({
  bounces: z.number(),
  complaints: z.number(),
  total_events: z.number(),
}).passthrough();

export type Last30Days = z.infer<typeof Last30DaysSchema>;

export const UserEmailStatusSchema = z.object({
  active: z.number(),
  bounced: z.number(),
  complaint: z.number(),
  total: z.number(),
}).passthrough();

export type UserEmailStatus = z.infer<typeof UserEmailStatusSchema>;

export const EmailStatsResponseSchema = z.object({
  last_30_days: Last30DaysSchema,
  user_email_status: UserEmailStatusSchema,
}).passthrough();

export type EmailStatsResponse = z.infer<typeof EmailStatsResponseSchema>;

export const EmailVerificationConfirmBodySchema = z.object({
  token: z.string(),
}).passthrough();

export type EmailVerificationConfirmBody = z.infer<typeof EmailVerificationConfirmBodySchema>;

export const EmailVerificationResendBodySchema = z.object({
  email: z.string(),
}).passthrough();

export type EmailVerificationResendBody = z.infer<typeof EmailVerificationResendBodySchema>;

export const EmbedCodesDetailSchema = z.object({
  iframe: z.string(),
  url: z.string(),
}).passthrough();

export type EmbedCodesDetail = z.infer<typeof EmbedCodesDetailSchema>;

export const EmbedCodeResponseSchema = z.object({
  media_id: z.string(),
  embed_codes: EmbedCodesDetailSchema,
}).passthrough();

export type EmbedCodeResponse = z.infer<typeof EmbedCodeResponseSchema>;

export const EmergencyPlanOutSchema = z.object({
  plan_id: z.string(),
  organization_id: z.string(),
  plan_number: z.string().nullable().optional(),
  title: z.string(),
  plan_version: z.string().nullable().optional(),
  facility_name: z.string().nullable().optional(),
  facility_address: z.string().nullable().optional(),
  covered_locations: z.any().optional(),
  risk_assessments: z.any().optional(),
  emergency_contacts: z.any().optional(),
  external_services: z.any().optional(),
  evacuation_routes: z.any().optional(),
  assembly_points: z.any().optional(),
  evacuation_procedures: z.any().optional(),
  site_plan_references: z.any().optional(),
  floor_plan_references: z.any().optional(),
  equipment_inventory: z.any().optional(),
  salvage_priority_guidance: z.any().optional(),
  response_procedures: z.any().optional(),
  recovery_procedures: z.any().optional(),
  training_requirements: z.any().optional(),
  last_drill_date: z.string().nullable().optional(),
  next_drill_date: z.string().nullable().optional(),
  effective_date: z.string().nullable().optional(),
  review_frequency: z.string().nullable().optional(),
  next_review_date: z.string().nullable().optional(),
  last_review_date: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  plan_note: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type EmergencyPlanOut = z.infer<typeof EmergencyPlanOutSchema>;

export const EmergencyPlanListResponseSchema = z.object({
  items: z.array(EmergencyPlanOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type EmergencyPlanListResponse = z.infer<typeof EmergencyPlanListResponseSchema>;

export const EnableAppBodySchema = z.object({
  application_key: z.string(),
  contract_start_date: z.string().nullable().optional(),
  contract_end_date: z.string().nullable().optional(),
}).passthrough();

export type EnableAppBody = z.infer<typeof EnableAppBodySchema>;

export const EnableAppResponseSchema = z.object({
  message: z.string(),
  application_key: z.string(),
  enabled: z.boolean(),
}).passthrough();

export type EnableAppResponse = z.infer<typeof EnableAppResponseSchema>;

export const EnableSemanticSearchResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  task_id: z.string(),
}).passthrough();

export type EnableSemanticSearchResponse = z.infer<typeof EnableSemanticSearchResponseSchema>;

export const EnabledAppOutSchema = z.object({
  app_key: z.string(),
  display_name: z.string(),
}).passthrough();

export type EnabledAppOut = z.infer<typeof EnabledAppOutSchema>;

export const EntityAuditEventOutSchema = z.object({
  event_id: z.string(),
  organization_id: z.string(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string(),
  entity_display_key: z.string().nullable().optional(),
  change_type: z.string().nullable().optional(),
  changed_at: z.string().nullable().optional(),
  changed_by: z.string().nullable().optional(),
  changed_by_name: z.string().nullable().optional(),
  changed_by_email: z.string().nullable().optional(),
  changed_fields: z.any().nullable().optional(),
  summary: z.string().nullable().optional(),
}).passthrough();

export type EntityAuditEventOut = z.infer<typeof EntityAuditEventOutSchema>;

export const EntityAuditFieldDiffOutSchema = z.object({
  diff_id: z.string(),
  field_name: z.string(),
  old_value: z.any().nullable().optional(),
  new_value: z.any().nullable().optional(),
}).passthrough();

export type EntityAuditFieldDiffOut = z.infer<typeof EntityAuditFieldDiffOutSchema>;

export const EntityAuditEventDetailOutSchema = z.object({
  event_id: z.string(),
  organization_id: z.string(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string(),
  entity_display_key: z.string().nullable().optional(),
  change_type: z.string().nullable().optional(),
  changed_at: z.string().nullable().optional(),
  changed_by: z.string().nullable().optional(),
  changed_by_name: z.string().nullable().optional(),
  changed_by_email: z.string().nullable().optional(),
  changed_fields: z.any().nullable().optional(),
  summary: z.string().nullable().optional(),
  field_diffs: z.array(EntityAuditFieldDiffOutSchema),
}).passthrough();

export type EntityAuditEventDetailOut = z.infer<typeof EntityAuditEventDetailOutSchema>;

export const EntityAuditEventDetailResponseSchema = z.object({
  event: EntityAuditEventDetailOutSchema,
}).passthrough();

export type EntityAuditEventDetailResponse = z.infer<typeof EntityAuditEventDetailResponseSchema>;

export const EntityAuditEventListResponseSchema = z.object({
  items: z.array(EntityAuditEventOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type EntityAuditEventListResponse = z.infer<typeof EntityAuditEventListResponseSchema>;

export const EntityAuditEventsResponseSchema = z.object({
  items: z.array(EntityAuditEventOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type EntityAuditEventsResponse = z.infer<typeof EntityAuditEventsResponseSchema>;

export const EntityAuditHistoryEventOutSchema = z.object({
  event_id: z.string(),
  organization_id: z.string(),
  entity_display_key: z.string().nullable().optional(),
  change_type: z.string().nullable().optional(),
  changed_at: z.string().nullable().optional(),
  changed_by: z.string().nullable().optional(),
  changed_by_name: z.string().nullable().optional(),
  changed_by_email: z.string().nullable().optional(),
  changed_fields: z.any().optional(),
  summary: z.string().nullable().optional(),
  field_diffs: z.array(FieldDiffOutSchema).nullable().optional(),
}).passthrough();

export type EntityAuditHistoryEventOut = z.infer<typeof EntityAuditHistoryEventOutSchema>;

export const EntityAuditHistoryResponseSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
  items: z.array(AuditEventOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type EntityAuditHistoryResponse = z.infer<typeof EntityAuditHistoryResponseSchema>;

export const EntityAuditStatsResponseSchema = z.object({
  stats: AuditStatsDetailSchema,
}).passthrough();

export type EntityAuditStatsResponse = z.infer<typeof EntityAuditStatsResponseSchema>;

export const EntityCurrentOutSchema = z.object({
  entity_key: z.string(),
  entity_type: z.string().nullable().optional(),
  dataset_id: z.string().nullable().optional(),
  source_system: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  payload: z.any().nullable().optional(),
  extracted_at: z.string(),
  last_seen_at: z.string(),
  updated_at: z.string(),
  last_run_id: z.string().nullable().optional(),
}).passthrough();

export type EntityCurrentOut = z.infer<typeof EntityCurrentOutSchema>;

export const EntityCurrentListResponseSchema = z.object({
  items: z.array(EntityCurrentOutSchema),
  next_cursor: z.string().nullable().optional(),
}).passthrough();

export type EntityCurrentListResponse = z.infer<typeof EntityCurrentListResponseSchema>;

export const EntityFieldsOutSchema = z.object({
  title: z.string().nullable().optional(),
  object_number: z.string().nullable().optional(),
  modified_at: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
}).passthrough();

export type EntityFieldsOut = z.infer<typeof EntityFieldsOutSchema>;

export const EntityDetailResponseSchema = z.object({
  entity_key: z.string(),
  entity_type: z.string().nullable().optional(),
  dataset_id: z.string().nullable().optional(),
  source_system: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  payload: z.any().nullable().optional(),
  payload_hash: z.string().nullable().optional(),
  extracted_at: z.string().nullable().optional(),
  last_seen_at: z.string().nullable().optional(),
  last_run_id: z.string().nullable().optional(),
  is_deleted: z.boolean(),
  deleted_at: z.string().nullable().optional(),
  fields: EntityFieldsOutSchema,
}).passthrough();

export type EntityDetailResponse = z.infer<typeof EntityDetailResponseSchema>;

export const HistoryEventOutSchema = z.object({
  change_id: z.string(),
  occurred_at: z.string(),
  event_type: z.string(),
  origin_type: z.string(),
  source_label: z.string().nullable().optional(),
  pipeline_name: z.string().nullable().optional(),
  dataset_name: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
  changed_fields: z.any().nullable().optional(),
  old_hash: z.string().nullable().optional(),
  new_hash: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  field_diffs: z.array(FieldDiffOutSchema),
}).passthrough();

export type HistoryEventOut = z.infer<typeof HistoryEventOutSchema>;

export const EntityHistoryResponseSchema = z.object({
  entity_key: z.string(),
  items: z.array(HistoryEventOutSchema),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean(),
  total: z.number(),
}).passthrough();

export type EntityHistoryResponse = z.infer<typeof EntityHistoryResponseSchema>;

export const EntityOutSchema = z.object({
  entity_key: z.string().nullable().optional(),
  dataset_id: z.string().nullable().optional(),
  source_system: z.string().nullable().optional(),
  source_id: z.string().nullable().optional(),
  entity_type: z.string().nullable().optional(),
  payload: z.any().optional(),
  extracted_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type EntityOut = z.infer<typeof EntityOutSchema>;

export const EntityListResponseSchema = z.object({
  items: z.array(EntityOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type EntityListResponse = z.infer<typeof EntityListResponseSchema>;

export const RelationshipOutSchema = z.object({
  relationship_id: z.string(),
  organization_id: z.string(),
  source_entity_key: z.string().nullable().optional(),
  source_dataset_id: z.string().nullable().optional(),
  target_entity_key: z.string().nullable().optional(),
  target_dataset_id: z.string().nullable().optional(),
  relationship_type: z.string().nullable().optional(),
  created_by_source: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  extra_data: z.any().optional(),
  created_by_user_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type RelationshipOut = z.infer<typeof RelationshipOutSchema>;

export const EntityRelationshipItemSchema = z.object({
  relationship: RelationshipOutSchema,
  direction: z.string(),
  related_entity: z.any().optional(),
}).passthrough();

export type EntityRelationshipItem = z.infer<typeof EntityRelationshipItemSchema>;

export const EntityRelationshipsResponseSchema = z.object({
  entity_key: z.string(),
  items: z.array(EntityRelationshipItemSchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
}).passthrough();

export type EntityRelationshipsResponse = z.infer<typeof EntityRelationshipsResponseSchema>;

export const EntitySummaryOutSchema = z.object({
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  part_name: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
}).passthrough();

export type EntitySummaryOut = z.infer<typeof EntitySummaryOutSchema>;

export const EntityTypeOutSchema = z.object({
  entity_type: z.string(),
  count: z.number(),
}).passthrough();

export type EntityTypeOut = z.infer<typeof EntityTypeOutSchema>;

export const EntityTypeListResponseSchema = z.object({
  organization_id: z.string(),
  entity_types: z.array(EntityTypeOutSchema),
}).passthrough();

export type EntityTypeListResponse = z.infer<typeof EntityTypeListResponseSchema>;

export const EntryLinkedLoansResponseSchema = z.object({
  loans_in: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type EntryLinkedLoansResponse = z.infer<typeof EntryLinkedLoansResponseSchema>;

export const EntryMediaAddedResponseSchema = z.object({
  message: z.string(),
  data: z.record(z.string(), z.any()),
}).passthrough();

export type EntryMediaAddedResponse = z.infer<typeof EntryMediaAddedResponseSchema>;

export const EntryMediaItemSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  preview_url: z.string().nullable().optional(),
  is_primary: z.boolean().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  caption: z.string().nullable().optional(),
  usage_type: z.string().nullable().optional(),
  download_access: z.string().nullable().optional(),
}).passthrough();

export type EntryMediaItem = z.infer<typeof EntryMediaItemSchema>;

export const EntryMediaListResponseSchema = z.object({
  media: z.array(EntryMediaItemSchema),
  count: z.number(),
}).passthrough();

export type EntryMediaListResponse = z.infer<typeof EntryMediaListResponseSchema>;

export const EntryMediaSetPrimaryResponseSchema = z.object({
  message: z.string(),
  data: z.record(z.string(), z.any()),
}).passthrough();

export type EntryMediaSetPrimaryResponse = z.infer<typeof EntryMediaSetPrimaryResponseSchema>;

export const EnumItemSchema = z.object({
  value: z.string(),
  label: z.string(),
}).passthrough();

export type EnumItem = z.infer<typeof EnumItemSchema>;

export const ErrorDetailSchema = z.object({
  code: z.string(),
  message: z.string(),
}).passthrough();

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const ErrorResponseSchema = z.object({
  error: ErrorDetailSchema,
}).passthrough();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const EvaluateDefinitionResponseSchema = z.object({
  created: z.number(),
  skipped: z.number(),
  errors: z.array(z.any()),
}).passthrough();

export type EvaluateDefinitionResponse = z.infer<typeof EvaluateDefinitionResponseSchema>;

export const EventOutSchema = z.object({
  event_id: z.string(),
  organization_id: z.string(),
  event_reference_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  event_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  start_at: z.string().nullable().optional(),
  end_at: z.string().nullable().optional(),
  location_id: z.string().nullable().optional(),
  owner_user_id: z.string().nullable().optional(),
  course_code: z.string().nullable().optional(),
  instructor_id: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  institution: z.string().nullable().optional(),
  headcount: z.number().nullable().optional(),
  session_format: z.string().nullable().optional(),
  audience: z.string().nullable().optional(),
  capacity: z.number().nullable().optional(),
  registration_url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  location_path: z.string().nullable().optional(),
  owner_name: z.string().nullable().optional(),
  instructor_name: z.string().nullable().optional(),
  object_count: z.number().nullable().optional(),
  participant_count: z.number().nullable().optional(),
  object_links: z.array(z.any()).nullable().optional(),
  participants: z.array(z.any()).nullable().optional(),
  link: z.any().nullable().optional(),
}).passthrough();

export type EventOut = z.infer<typeof EventOutSchema>;

export const EventListResponseSchema = z.object({
  items: z.array(EventOutSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type EventListResponse = z.infer<typeof EventListResponseSchema>;

export const EventObjectLinkOutSchema = z.object({
  event_object_id: z.string(),
  organization_id: z.string(),
  event_id: z.string(),
  object_id: z.string(),
  role: z.string().nullable().optional(),
  planned_use: z.string().nullable().optional(),
  requirements: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  object: z.any().nullable().optional(),
}).passthrough();

export type EventObjectLinkOut = z.infer<typeof EventObjectLinkOutSchema>;

export const EventObjectListResponseSchema = z.object({
  objects: z.array(EventObjectLinkOutSchema),
  total: z.number(),
}).passthrough();

export type EventObjectListResponse = z.infer<typeof EventObjectListResponseSchema>;

export const EventParticipantOutSchema = z.object({
  participant_id: z.string(),
  xref_id: z.string(),
  organization_id: z.string(),
  event_id: z.string(),
  constituent_id: z.string(),
  role: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  constituent: z.any().nullable().optional(),
  contact: z.any().nullable().optional(),
}).passthrough();

export type EventParticipantOut = z.infer<typeof EventParticipantOutSchema>;

export const EventParticipantListResponseSchema = z.object({
  participants: z.array(EventParticipantOutSchema),
  total: z.number(),
}).passthrough();

export type EventParticipantListResponse = z.infer<typeof EventParticipantListResponseSchema>;

export const EventTypeCountsSchema = z.object({
  views: z.number().optional(),
  downloads: z.number().optional(),
  embeds: z.number().optional(),
  api_accesses: z.number().optional(),
  shares: z.number().optional(),
}).passthrough();

export type EventTypeCounts = z.infer<typeof EventTypeCountsSchema>;

export const ExecuteActionBodySchema = z.object({
  parameters: z.any().nullable().optional(),
}).passthrough();

export type ExecuteActionBody = z.infer<typeof ExecuteActionBodySchema>;

export const ExecuteRunResponseSchema = z.object({
  run_id: z.string(),
  status: z.string(),
  duration_ms: z.number().nullable().optional(),
  counts: z.any().optional(),
  target_url: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  error_stage: z.string().nullable().optional(),
}).passthrough();

export type ExecuteRunResponse = z.infer<typeof ExecuteRunResponseSchema>;

export const ExecutionDashboardResponseSchema = z.object({
  exhibition: z.any(),
  checklist: z.any(),
  info_requests: z.any(),
  shipments: z.any(),
  loans: z.any(),
  budget: z.any(),
  generated_at: z.string(),
}).passthrough();

export type ExecutionDashboardResponse = z.infer<typeof ExecutionDashboardResponseSchema>;

export const ExhibitionChecklistOutSchema = z.object({
  checklist_id: z.string(),
  exhibition_id: z.string(),
  template_version_id: z.string().nullable().optional(),
  name: z.string(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  items: z.array(ChecklistItemOutSchema).nullable().optional(),
  item_count: z.number().nullable().optional(),
  status_summary: z.record(z.string(), z.number()).nullable().optional(),
}).passthrough();

export type ExhibitionChecklistOut = z.infer<typeof ExhibitionChecklistOutSchema>;

export const ExhibitionChecklistWrapperResponseSchema = z.object({
  checklist: ExhibitionChecklistOutSchema.nullable().optional(),
}).passthrough();

export type ExhibitionChecklistWrapperResponse = z.infer<typeof ExhibitionChecklistWrapperResponseSchema>;

export const ExhibitionCreatedResponseSchema = z.object({
  exhibition_id: z.string(),
  title: z.string().nullable().optional(),
  message: z.string(),
}).passthrough();

export type ExhibitionCreatedResponse = z.infer<typeof ExhibitionCreatedResponseSchema>;

export const ExhibitionDetailOutSchema = z.object({
  exhibition_id: z.string(),
  exhibition_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  curator_notes: z.string().nullable().optional(),
  exhibition_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  organizer_id: z.string().nullable().optional(),
  authorizer_id: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  provisos: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  venue_id: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_end_date: z.string().nullable().optional(),
  is_public: z.boolean().nullable().optional(),
  public_url_slug: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  status_history: z.array(z.any()).optional(),
  floor_plans: z.array(z.any()).optional(),
  placements: z.array(z.any()).optional(),
}).passthrough();

export type ExhibitionDetailOut = z.infer<typeof ExhibitionDetailOutSchema>;

export const InfoRequestDocumentOutSchema = z.object({
  link_id: z.string(),
  media_id: z.string(),
  label: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type InfoRequestDocumentOut = z.infer<typeof InfoRequestDocumentOutSchema>;

export const ExhibitionInfoRequestOutSchema = z.object({
  request_id: z.string(),
  exhibition_id: z.string(),
  source_template_item_id: z.string().nullable().optional(),
  request_type: z.string().nullable().optional(),
  request_type_label: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  status_label: z.string().nullable().optional(),
  source_party: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_required: z.boolean().optional(),
  sort_order: z.number().optional(),
  received_at: z.string().nullable().optional(),
  received_by: z.string().nullable().optional(),
  approved_at: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  documents: z.array(InfoRequestDocumentOutSchema).nullable().optional(),
  document_count: z.number().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type ExhibitionInfoRequestOut = z.infer<typeof ExhibitionInfoRequestOutSchema>;

export const ExhibitionLabelOutSchema = z.object({
  label_id: z.string(),
  exhibition_object_id: z.string().nullable().optional(),
  template_id: z.string().nullable().optional(),
  label_type: z.string().nullable().optional(),
  generated_text: z.string().nullable().optional(),
  custom_text: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  print_count: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ExhibitionLabelOut = z.infer<typeof ExhibitionLabelOutSchema>;

export const ExhibitionLabelListResponseSchema = z.object({
  exhibition_labels: z.array(ExhibitionLabelOutSchema),
}).passthrough();

export type ExhibitionLabelListResponse = z.infer<typeof ExhibitionLabelListResponseSchema>;

export const ExhibitionListItemSchema = z.object({
  exhibition_id: z.string(),
  exhibition_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  exhibition_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  venue_id: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  is_public: z.boolean().nullable().optional(),
  public_url_slug: z.string().nullable().optional(),
  placement_count: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ExhibitionListItem = z.infer<typeof ExhibitionListItemSchema>;

export const ExhibitionListResponseSchema = z.object({
  total: z.number(),
  exhibitions: z.array(ExhibitionListItemSchema),
}).passthrough();

export type ExhibitionListResponse = z.infer<typeof ExhibitionListResponseSchema>;

export const ExhibitionLoanObjectOutSchema = z.object({
  loan_object_id: z.string(),
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
}).passthrough();

export type ExhibitionLoanObjectOut = z.infer<typeof ExhibitionLoanObjectOutSchema>;

export const ExhibitionLoanOutSchema = z.object({
  link_id: z.string(),
  exhibition_id: z.string(),
  loan_id: z.string().nullable().optional(),
  loan_type: z.string().nullable().optional(),
  loan_type_label: z.string().nullable().optional(),
  is_linked: z.boolean(),
  loan_number: z.string().nullable().optional(),
  party_name: z.string().nullable().optional(),
  party_contact: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  status_label: z.string().nullable().optional(),
  status_notes: z.string().nullable().optional(),
  agreement_document_id: z.string().nullable().optional(),
  agreement_signed: z.boolean().nullable().optional(),
  agreement_signed_date: z.string().nullable().optional(),
  insurance_confirmed: z.boolean().nullable().optional(),
  insurance_policy: z.string().nullable().optional(),
  insurance_value: z.any().optional(),
  request_date: z.string().nullable().optional(),
  loan_start_date: z.string().nullable().optional(),
  loan_end_date: z.string().nullable().optional(),
  actual_return_date: z.string().nullable().optional(),
  object_count: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  last_synced_at: z.string().nullable().optional(),
  is_active: z.boolean(),
  needs_attention: z.boolean(),
  objects: z.array(ExhibitionLoanObjectOutSchema).nullable().optional(),
}).passthrough();

export type ExhibitionLoanOut = z.infer<typeof ExhibitionLoanOutSchema>;

export const LoansSummaryOutSchema = z.object({
  total: z.number(),
  loans_in: z.number(),
  loans_out: z.number(),
  planning: z.number(),
  linked: z.number(),
  active: z.number(),
  needs_attention: z.number(),
  agreements_pending: z.number(),
  insurance_pending: z.number(),
  by_status: z.record(z.string(), z.number()).nullable().optional(),
}).passthrough();

export type LoansSummaryOut = z.infer<typeof LoansSummaryOutSchema>;

export const ExhibitionLoanListResponseSchema = z.object({
  loans: z.array(ExhibitionLoanOutSchema),
  summary: LoansSummaryOutSchema,
}).passthrough();

export type ExhibitionLoanListResponse = z.infer<typeof ExhibitionLoanListResponseSchema>;

export const ExhibitionObjectAddedResponseSchema = z.object({
  exhibition_object_id: z.string(),
  source_type: z.string().nullable().optional(),
  message: z.string(),
}).passthrough();

export type ExhibitionObjectAddedResponse = z.infer<typeof ExhibitionObjectAddedResponseSchema>;

export const ExhibitionObjectCreatedResponseSchema = z.object({
  exhibition_object_id: z.string(),
  source_type: z.string(),
  message: z.string(),
}).passthrough();

export type ExhibitionObjectCreatedResponse = z.infer<typeof ExhibitionObjectCreatedResponseSchema>;

export const ExhibitionObjectOutSchema = z.object({
  exhibition_object_id: z.string(),
  display_order: z.number().nullable().optional(),
  section: z.string().nullable().optional(),
  object_status: z.string().nullable().optional(),
  confirmed_date: z.string().nullable().optional(),
  credit_line_override: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  installation_notes: z.string().nullable().optional(),
  loan_in_id: z.string().nullable().optional(),
  condition_in_report_id: z.string().nullable().optional(),
  condition_out_report_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  entity_key: z.string().nullable().optional(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  primary_image_url: z.string().nullable().optional(),
  bridge_payload: z.any().optional(),
  bridge_source_system: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
}).passthrough();

export type ExhibitionObjectOut = z.infer<typeof ExhibitionObjectOutSchema>;

export const ExhibitionObjectListResponseSchema = z.object({
  exhibition_objects: z.array(ExhibitionObjectOutSchema),
}).passthrough();

export type ExhibitionObjectListResponse = z.infer<typeof ExhibitionObjectListResponseSchema>;

export const ExhibitionObjectUpdatedResponseSchema = z.object({
  exhibition_object_id: z.string(),
  message: z.string(),
}).passthrough();

export type ExhibitionObjectUpdatedResponse = z.infer<typeof ExhibitionObjectUpdatedResponseSchema>;

export const ExhibitionObjectsBatchAddedResponseSchema = z.object({
  added: z.array(z.string()),
  skipped: z.array(z.string()),
  source_type: z.string().nullable().optional(),
  message: z.string(),
}).passthrough();

export type ExhibitionObjectsBatchAddedResponse = z.infer<typeof ExhibitionObjectsBatchAddedResponseSchema>;

export const ExhibitionShipmentsResponseSchema = z.object({
  exhibition: z.any(),
  shipments: z.array(z.any()),
}).passthrough();

export type ExhibitionShipmentsResponse = z.infer<typeof ExhibitionShipmentsResponseSchema>;

export const ExhibitionSummaryOutSchema = z.object({
  exhibition_id: z.string(),
  exhibition_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  exhibition_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  venue_id: z.string().nullable().optional(),
  venue_name: z.string().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_end_date: z.string().nullable().optional(),
  is_public: z.boolean().nullable().optional(),
  public_url_slug: z.string().nullable().optional(),
  placement_count: z.number().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ExhibitionSummaryOut = z.infer<typeof ExhibitionSummaryOutSchema>;

export const ExhibitionUpdateResponseSchema = z.object({
  exhibition_id: z.string(),
  message: z.string(),
}).passthrough();

export type ExhibitionUpdateResponse = z.infer<typeof ExhibitionUpdateResponseSchema>;

export const ExhibitionUpdatedResponseSchema = z.object({
  exhibition_id: z.string(),
  message: z.string(),
}).passthrough();

export type ExhibitionUpdatedResponse = z.infer<typeof ExhibitionUpdatedResponseSchema>;

export const ExhibitionVenueOutSchema = z.object({
  exhibition_venue_id: z.string(),
  venue_id: z.string().nullable().optional(),
  external_venue_name: z.string().nullable().optional(),
  external_venue_address: z.string().nullable().optional(),
  tour_order: z.number().nullable().optional(),
  planned_start_date: z.string().nullable().optional(),
  planned_end_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_end_date: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  fee_amount: z.number().nullable().optional(),
  fee_currency: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ExhibitionVenueOut = z.infer<typeof ExhibitionVenueOutSchema>;

export const ExhibitionVenueListResponseSchema = z.object({
  exhibition_venues: z.array(ExhibitionVenueOutSchema),
}).passthrough();

export type ExhibitionVenueListResponse = z.infer<typeof ExhibitionVenueListResponseSchema>;

export const ExpirationAlertActionResponseSchema = z.object({
  alert_id: z.string(),
  status: z.string(),
  dismissed_at: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type ExpirationAlertActionResponse = z.infer<typeof ExpirationAlertActionResponseSchema>;

export const ExpirationAlertOutSchema = z.object({
  alert_id: z.string(),
  media_id: z.string(),
  alert_type: z.string().nullable().optional(),
  related_id: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  days_until_expiry: z.number().nullable().optional(),
  severity: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  email_sent_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  media_title: z.string().nullable().optional(),
  media_filename: z.string().nullable().optional(),
}).passthrough();

export type ExpirationAlertOut = z.infer<typeof ExpirationAlertOutSchema>;

export const ExpirationAlertListResponseSchema = z.object({
  items: z.array(ExpirationAlertOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ExpirationAlertListResponse = z.infer<typeof ExpirationAlertListResponseSchema>;

export const SeverityCountsSchema = z.object({
  critical: z.number().optional(),
  urgent: z.number().optional(),
  warning: z.number().optional(),
}).passthrough();

export type SeverityCounts = z.infer<typeof SeverityCountsSchema>;

export const ExpirationAlertSummaryResponseSchema = z.object({
  total_active: z.number(),
  by_severity: SeverityCountsSchema,
  by_type: AlertTypeCountsSchema,
}).passthrough();

export type ExpirationAlertSummaryResponse = z.infer<typeof ExpirationAlertSummaryResponseSchema>;

export const ExportColumnOutSchema = z.object({
  field: z.string(),
  label: z.string(),
}).passthrough();

export type ExportColumnOut = z.infer<typeof ExportColumnOutSchema>;

export const ExportColumnsResponseSchema = z.object({
  record_type: z.string(),
  columns: z.array(ExportColumnOutSchema),
}).passthrough();

export type ExportColumnsResponse = z.infer<typeof ExportColumnsResponseSchema>;

export const ExportOutSchema = z.object({
  export_id: z.string(),
  export_type: z.string().nullable().optional(),
  floor_plan_id: z.string().nullable().optional(),
  wall_id: z.string().nullable().optional(),
  file_url: z.string().nullable().optional(),
  export_metadata: z.any().optional(),
  created_at: z.string(),
  created_by: z.string().nullable().optional(),
}).passthrough();

export type ExportOut = z.infer<typeof ExportOutSchema>;

export const ExportListResponseSchema = z.object({
  exports: z.array(ExportOutSchema),
}).passthrough();

export type ExportListResponse = z.infer<typeof ExportListResponseSchema>;

export const ExportProfileListOutSchema = z.object({
  profiles: z.array(z.any()),
  categories: z.array(z.string()),
  authoritySources: z.array(z.string()),
  mediaOptions: z.array(z.string()),
}).passthrough();

export type ExportProfileListOut = z.infer<typeof ExportProfileListOutSchema>;

export const ExportProfileOutSchema = z.object({
  profile: z.any(),
}).passthrough();

export type ExportProfileOut = z.infer<typeof ExportProfileOutSchema>;

export const ExportProfilePreviewOutSchema = z.object({
  original: z.any(),
  exported: z.any(),
  removedFields: z.array(z.string()),
  transformedFields: z.array(z.string()),
  profile: z.any(),
}).passthrough();

export type ExportProfilePreviewOut = z.infer<typeof ExportProfilePreviewOutSchema>;

export const RecordTypeOutSchema = z.object({
  key: z.string(),
  label: z.string(),
}).passthrough();

export type RecordTypeOut = z.infer<typeof RecordTypeOutSchema>;

export const ExportRecordTypesResponseSchema = z.object({
  record_types: z.array(RecordTypeOutSchema),
}).passthrough();

export type ExportRecordTypesResponse = z.infer<typeof ExportRecordTypesResponseSchema>;

export const ExtractionSchemaItemSchema = z.object({
  definitionKey: z.string(),
  displayName: z.string(),
  direction: z.string().nullable().optional(),
  sourceType: z.string().nullable().optional(),
  extractionSchema: z.any().optional(),
  objectSchema: z.any().optional(),
  columnMappingSchema: z.any().optional(),
}).passthrough();

export type ExtractionSchemaItem = z.infer<typeof ExtractionSchemaItemSchema>;

export const ExtractionSchemaListResponseSchema = z.object({
  schemas: z.array(ExtractionSchemaItemSchema),
}).passthrough();

export type ExtractionSchemaListResponse = z.infer<typeof ExtractionSchemaListResponseSchema>;

export const ExtractionSchemaResponseSchema = z.object({
  definitionKey: z.string(),
  extractionSchema: z.any().optional(),
  objectSchema: z.any().optional(),
  columnMappingSchema: z.any().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type ExtractionSchemaResponse = z.infer<typeof ExtractionSchemaResponseSchema>;

export const FacetBucketOutSchema = z.object({
  key: z.string(),
  count: z.number(),
}).passthrough();

export type FacetBucketOut = z.infer<typeof FacetBucketOutSchema>;

export const FacetOutSchema = z.object({
  field: z.string(),
  buckets: z.array(FacetBucketOutSchema),
}).passthrough();

export type FacetOut = z.infer<typeof FacetOutSchema>;

export const FeatureFlagsSchema = z.object({
  opensearch: z.boolean(),
  clip: z.boolean(),
  whisper: z.boolean(),
  ocr: z.boolean(),
  semantic_search: z.boolean(),
  tus: z.boolean(),
  unoserver: z.boolean(),
  agent: z.boolean(),
}).passthrough();

export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export const FeaturedObjectsResponseSchema = z.object({
  hits: z.array(DiscoverSearchHitOutSchema),
}).passthrough();

export type FeaturedObjectsResponse = z.infer<typeof FeaturedObjectsResponseSchema>;

export const FieldGrantListResponseSchema = z.object({
  grants: z.array(z.any()),
}).passthrough();

export type FieldGrantListResponse = z.infer<typeof FieldGrantListResponseSchema>;

export const FieldGrantUpsertResponseSchema = z.object({
  grants: z.array(z.any()),
  message: z.string(),
}).passthrough();

export type FieldGrantUpsertResponse = z.infer<typeof FieldGrantUpsertResponseSchema>;

export const FieldInheritanceConfigOutSchema = z.object({
  config_id: z.string(),
  organization_id: z.string(),
  source_field: z.string(),
  display_label: z.string(),
  display_context: z.string().nullable().optional(),
  transform_type: z.string().nullable().optional(),
  transform_config: z.any().nullable().optional(),
  sort_order: z.number().optional(),
  is_active: z.boolean().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type FieldInheritanceConfigOut = z.infer<typeof FieldInheritanceConfigOutSchema>;

export const FieldInheritanceConfigListResponseSchema = z.object({
  configs: z.array(FieldInheritanceConfigOutSchema),
  total: z.number(),
}).passthrough();

export type FieldInheritanceConfigListResponse = z.infer<typeof FieldInheritanceConfigListResponseSchema>;

export const FieldPolicyListResponseSchema = z.object({
  policies: z.array(z.any()),
}).passthrough();

export type FieldPolicyListResponse = z.infer<typeof FieldPolicyListResponseSchema>;

export const FlaggedMessageOutSchema = z.object({
  message_id: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  guardrails: z.any().optional(),
  meta: z.any().optional(),
}).passthrough();

export type FlaggedMessageOut = z.infer<typeof FlaggedMessageOutSchema>;

export const FlaggedMessagesResponseSchema = z.object({
  messages: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type FlaggedMessagesResponse = z.infer<typeof FlaggedMessagesResponseSchema>;

export const FloorPlanAddedResponseSchema = z.object({
  message: z.string(),
  floor_plan_id: z.string(),
  visit_order: z.number(),
}).passthrough();

export type FloorPlanAddedResponse = z.infer<typeof FloorPlanAddedResponseSchema>;

export const FloorPlanBackgroundRemovedResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  floor_plan_id: z.string(),
}).passthrough();

export type FloorPlanBackgroundRemovedResponse = z.infer<typeof FloorPlanBackgroundRemovedResponseSchema>;

export const FloorPlanBackgroundResponseSchema = z.object({
  floor_plan_id: z.string(),
  background_image: z.any(),
  message: z.string(),
}).passthrough();

export type FloorPlanBackgroundResponse = z.infer<typeof FloorPlanBackgroundResponseSchema>;

export const FloorPlanCreatedResponseSchema = z.object({
  floor_plan_id: z.string(),
  name: z.string(),
  message: z.string(),
}).passthrough();

export type FloorPlanCreatedResponse = z.infer<typeof FloorPlanCreatedResponseSchema>;

export const FloorPlanDeleteResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
}).passthrough();

export type FloorPlanDeleteResponse = z.infer<typeof FloorPlanDeleteResponseSchema>;

export const FloorPlanDetailOutSchema = z.object({
  floor_plan_id: z.string(),
  venue_id: z.string(),
  venue_name: z.string().nullable().optional(),
  exhibition_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  floor_number: z.number().nullable().optional(),
  geometry: z.any().optional(),
  ceiling_height_cm: z.number().nullable().optional(),
  wall_color: z.string().nullable().optional(),
  floor_texture: z.string().nullable().optional(),
  model_url: z.string().nullable().optional(),
  model_scale: z.number().optional(),
  appearance_settings: z.any().optional(),
}).passthrough();

export type FloorPlanDetailOut = z.infer<typeof FloorPlanDetailOutSchema>;

export const FloorPlanDetailResponseSchema = z.object({
  floor_plan: FloorPlanDetailOutSchema,
}).passthrough();

export type FloorPlanDetailResponse = z.infer<typeof FloorPlanDetailResponseSchema>;

export const FloorPlanOutSchema = z.object({
  floor_plan_id: z.string(),
  name: z.string().nullable().optional(),
  floor_number: z.number().nullable().optional(),
  geometry: z.any().optional(),
  ceiling_height_cm: z.number().nullable().optional(),
  wall_color: z.string().nullable().optional(),
  model_url: z.string().nullable().optional(),
  model_scale: z.number().optional(),
}).passthrough();

export type FloorPlanOut = z.infer<typeof FloorPlanOutSchema>;

export const FloorPlanUpdateResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  floor_plan_id: z.string(),
}).passthrough();

export type FloorPlanUpdateResponse = z.infer<typeof FloorPlanUpdateResponseSchema>;

export const FolderContentsResponseSchema = z.object({
}).passthrough();

export type FolderContentsResponse = z.infer<typeof FolderContentsResponseSchema>;

export const FolderListResponseSchema = z.object({
  folders: z.any(),
  unfiled_count: z.number().nullable().optional(),
}).passthrough();

export type FolderListResponse = z.infer<typeof FolderListResponseSchema>;

export const FormLayoutDeltaSchema = z.object({
  hidden_sections: z.array(z.string()).optional(),
  section_order: z.array(z.string()).optional(),
  group_order: z.array(z.string()).optional(),
  collapsed_groups: z.array(z.string()).optional(),
}).passthrough();

export type FormLayoutDelta = z.infer<typeof FormLayoutDeltaSchema>;

export const FormatRiskSummaryResponseSchema = z.object({
  formats: z.array(z.any()),
}).passthrough();

export type FormatRiskSummaryResponse = z.infer<typeof FormatRiskSummaryResponseSchema>;

export const FrameStyleCreatedResponseSchema = z.object({
  frame_style_id: z.string(),
  name: z.string(),
  message: z.string(),
}).passthrough();

export type FrameStyleCreatedResponse = z.infer<typeof FrameStyleCreatedResponseSchema>;

export const FrameStyleDeleteResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
}).passthrough();

export type FrameStyleDeleteResponse = z.infer<typeof FrameStyleDeleteResponseSchema>;

export const FrameStyleOutSchema = z.object({
  frame_style_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  profile_type: z.string().nullable().optional(),
  default_width_cm: z.number().nullable().optional(),
  default_depth_cm: z.number().nullable().optional(),
  material: z.string().nullable().optional(),
  color_hex: z.string().nullable().optional(),
  preview_image_url: z.string().nullable().optional(),
  is_system: z.boolean().optional(),
}).passthrough();

export type FrameStyleOut = z.infer<typeof FrameStyleOutSchema>;

export const FrameStyleListResponseSchema = z.object({
  frame_styles: z.array(FrameStyleOutSchema),
}).passthrough();

export type FrameStyleListResponse = z.infer<typeof FrameStyleListResponseSchema>;

export const FrameStyleUpdateResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  frame_style_id: z.string(),
}).passthrough();

export type FrameStyleUpdateResponse = z.infer<typeof FrameStyleUpdateResponseSchema>;

export const GDPRDeleteBodySchema = z.object({
  session_id: z.string(),
}).passthrough();

export type GDPRDeleteBody = z.infer<typeof GDPRDeleteBodySchema>;

export const GDPRDeleteResponseSchema = z.object({
  deleted_conversations: z.number(),
}).passthrough();

export type GDPRDeleteResponse = z.infer<typeof GDPRDeleteResponseSchema>;

export const GenerateReportResponseSchema = z.object({
  run_id: z.string(),
  status: z.string(),
  report_key: z.string(),
  export_format: z.string(),
}).passthrough();

export type GenerateReportResponse = z.infer<typeof GenerateReportResponseSchema>;

export const GenericXrefListResponseSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
  xrefs: z.array(ConstituentXrefOutSchema),
}).passthrough();

export type GenericXrefListResponse = z.infer<typeof GenericXrefListResponseSchema>;

export const GeocodeRequestSchema = z.object({
  address: z.string(),
  country_code: z.string().nullable().optional(),
}).passthrough();

export type GeocodeRequest = z.infer<typeof GeocodeRequestSchema>;

export const GeocodeResponseSchema = z.object({
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  formatted_address: z.string().nullable().optional(),
  place_id: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  source: z.string().nullable().optional(),
  raw: z.any().optional(),
}).passthrough();

export type GeocodeResponse = z.infer<typeof GeocodeResponseSchema>;

export const GeometryValidationResponseSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
}).passthrough();

export type GeometryValidationResponse = z.infer<typeof GeometryValidationResponseSchema>;

export const GoogleAuthorizeResponseSchema = z.object({
  authorization_url: z.string(),
}).passthrough();

export type GoogleAuthorizeResponse = z.infer<typeof GoogleAuthorizeResponseSchema>;

export const GoogleCallbackBodySchema = z.object({
  code: z.string(),
}).passthrough();

export type GoogleCallbackBody = z.infer<typeof GoogleCallbackBodySchema>;

export const GoogleStatusResponseSchema = z.object({
  authorized: z.boolean(),
  needs_refresh: z.boolean(),
  oauth_configured: z.boolean(),
}).passthrough();

export type GoogleStatusResponse = z.infer<typeof GoogleStatusResponseSchema>;

export const HeadquartersResponseSchema = z.object({
  name: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
}).passthrough();

export type HeadquartersResponse = z.infer<typeof HeadquartersResponseSchema>;

export const HeadquartersUpdateResponseSchema = z.object({
  success: z.boolean(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
}).passthrough();

export type HeadquartersUpdateResponse = z.infer<typeof HeadquartersUpdateResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.string(),
}).passthrough();

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const HideValueBodySchema = z.object({
  hidden: z.boolean(),
}).passthrough();

export type HideValueBody = z.infer<typeof HideValueBodySchema>;

export const HideValueResponseSchema = z.object({
  message: z.string(),
  hidden: z.boolean(),
}).passthrough();

export type HideValueResponse = z.infer<typeof HideValueResponseSchema>;

export const ImportUlanResponseSchema = z.object({
  constituent_id: z.string(),
  name: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  ulan_id: z.string().nullable().optional(),
  is_new: z.boolean(),
}).passthrough();

export type ImportUlanResponse = z.infer<typeof ImportUlanResponseSchema>;

export const IncidentObjectOutSchema = z.object({
  incident_object_id: z.string(),
  report_id: z.string(),
  object_id: z.string(),
  damage_description: z.string().nullable().optional(),
  damage_extent: z.string().nullable().optional(),
  condition_before: z.string().nullable().optional(),
  condition_after: z.string().nullable().optional(),
  condition_report_id: z.string().nullable().optional(),
  treatment_id: z.string().nullable().optional(),
  estimated_loss_value: z.number().nullable().optional(),
  estimated_loss_currency: z.string().nullable().optional(),
  recovered: z.boolean().nullable().optional(),
  recovered_date: z.string().nullable().optional(),
  recovery_note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  object: z.any().optional(),
}).passthrough();

export type IncidentObjectOut = z.infer<typeof IncidentObjectOutSchema>;

export const IncidentReportOutSchema = z.object({
  report_id: z.string(),
  organization_id: z.string(),
  report_number: z.string().nullable().optional(),
  report_date: z.string().nullable().optional(),
  incident_type: z.string().nullable().optional(),
  incident_subtype: z.string().nullable().optional(),
  incident_date: z.string().nullable().optional(),
  incident_date_approximate: z.boolean().nullable().optional(),
  incident_location_id: z.string().nullable().optional(),
  incident_location_description: z.string().nullable().optional(),
  discovered_date: z.string().nullable().optional(),
  discovered_by: z.string().nullable().optional(),
  discovered_by_name: z.string().nullable().optional(),
  discovery_circumstances: z.string().nullable().optional(),
  incident_description: z.string().nullable().optional(),
  cause_analysis: z.string().nullable().optional(),
  contributing_factors: z.any().optional(),
  immediate_actions: z.string().nullable().optional(),
  police_notified: z.boolean().nullable().optional(),
  police_report_number: z.string().nullable().optional(),
  police_report_date: z.string().nullable().optional(),
  police_contact: z.string().nullable().optional(),
  police_note: z.string().nullable().optional(),
  insurance_claim_filed: z.boolean().nullable().optional(),
  insurance_claim_number: z.string().nullable().optional(),
  insurance_claim_date: z.string().nullable().optional(),
  insurance_adjuster: z.string().nullable().optional(),
  insurance_claim_status: z.string().nullable().optional(),
  insurance_claim_amount: z.number().nullable().optional(),
  insurance_settlement_amount: z.number().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  insurance_note: z.string().nullable().optional(),
  director_notified: z.boolean().nullable().optional(),
  director_notified_date: z.string().nullable().optional(),
  board_notified: z.boolean().nullable().optional(),
  board_notified_date: z.string().nullable().optional(),
  investigation_required: z.boolean().nullable().optional(),
  investigation_lead: z.string().nullable().optional(),
  investigation_findings: z.string().nullable().optional(),
  investigation_completed_date: z.string().nullable().optional(),
  resolution_summary: z.string().nullable().optional(),
  resolved_date: z.string().nullable().optional(),
  lessons_learned: z.string().nullable().optional(),
  preventive_actions: z.any().optional(),
  image_references: z.any().optional(),
  document_references: z.any().optional(),
  status: z.string().nullable().optional(),
  assigned_to_user_id: z.string().nullable().optional(),
  report_note: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  affected_objects: z.array(IncidentObjectOutSchema).nullable().optional(),
}).passthrough();

export type IncidentReportOut = z.infer<typeof IncidentReportOutSchema>;

export const IncidentReportListResponseSchema = z.object({
  items: z.array(IncidentReportOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type IncidentReportListResponse = z.infer<typeof IncidentReportListResponseSchema>;

export const IndemnityObjectOutSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  declared_value: z.number().nullable().optional(),
  approved_value: z.number().nullable().optional(),
  value_currency: z.string().nullable().optional(),
}).passthrough();

export type IndemnityObjectOut = z.infer<typeof IndemnityObjectOutSchema>;

export const IndemnityArrangementOutSchema = z.object({
  indemnity_id: z.string(),
  organization_id: z.string(),
  program: z.string().nullable().optional(),
  program_label: z.string().nullable().optional(),
  reference_number: z.string().nullable().optional(),
  internal_reference: z.string().nullable().optional(),
  exhibition_id: z.string().nullable().optional(),
  loan_in_id: z.string().nullable().optional(),
  application_date: z.string().nullable().optional(),
  requested_coverage: z.number().nullable().optional(),
  awarded_coverage: z.number().nullable().optional(),
  coverage_currency: z.string().nullable().optional(),
  coverage_start_date: z.string().nullable().optional(),
  coverage_end_date: z.string().nullable().optional(),
  commercial_gap_required: z.boolean().optional(),
  gap_coverage_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  status_label: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  objects: z.array(IndemnityObjectOutSchema).nullable().optional(),
  object_count: z.number().nullable().optional(),
  total_declared_value: z.number().nullable().optional(),
  total_approved_value: z.number().nullable().optional(),
}).passthrough();

export type IndemnityArrangementOut = z.infer<typeof IndemnityArrangementOutSchema>;

export const IndemnityListResponseSchema = z.object({
  indemnities: z.array(IndemnityArrangementOutSchema),
  total: z.number(),
}).passthrough();

export type IndemnityListResponse = z.infer<typeof IndemnityListResponseSchema>;

export const IndemnityObjectAddedResponseSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  declared_value: z.number().nullable().optional(),
  approved_value: z.number().nullable().optional(),
}).passthrough();

export type IndemnityObjectAddedResponse = z.infer<typeof IndemnityObjectAddedResponseSchema>;

export const InfoRequestBulkCreateResponseSchema = z.object({
  info_requests: z.array(ExhibitionInfoRequestOutSchema),
  count: z.number(),
}).passthrough();

export type InfoRequestBulkCreateResponse = z.infer<typeof InfoRequestBulkCreateResponseSchema>;

export const InfoRequestDocumentResponseSchema = z.object({
  document: InfoRequestDocumentOutSchema,
}).passthrough();

export type InfoRequestDocumentResponse = z.infer<typeof InfoRequestDocumentResponseSchema>;

export const InfoRequestEnumsResponseSchema = z.object({
  request_types: z.array(EnumItemSchema),
  statuses: z.array(EnumItemSchema),
  source_parties: z.array(EnumItemSchema),
}).passthrough();

export type InfoRequestEnumsResponse = z.infer<typeof InfoRequestEnumsResponseSchema>;

export const InfoRequestSummarySchema = z.object({
  total: z.number(),
  received: z.number(),
  approved: z.number(),
  missing: z.number(),
  overdue: z.number(),
  incomplete: z.number(),
}).passthrough();

export type InfoRequestSummary = z.infer<typeof InfoRequestSummarySchema>;

export const InfoRequestListResponseSchema = z.object({
  info_requests: z.array(ExhibitionInfoRequestOutSchema),
  summary: InfoRequestSummarySchema,
}).passthrough();

export type InfoRequestListResponse = z.infer<typeof InfoRequestListResponseSchema>;

export const InfoRequestResponseSchema = z.object({
  info_request: ExhibitionInfoRequestOutSchema,
}).passthrough();

export type InfoRequestResponse = z.infer<typeof InfoRequestResponseSchema>;

export const InfoRequestTemplateItemOutSchema = z.object({
  template_item_id: z.string(),
  request_type: z.string().nullable().optional(),
  request_type_label: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  default_source_party: z.string().nullable().optional(),
  default_due_offset_days: z.number().nullable().optional(),
  is_required: z.boolean().optional(),
  sort_order: z.number().optional(),
}).passthrough();

export type InfoRequestTemplateItemOut = z.infer<typeof InfoRequestTemplateItemOutSchema>;

export const InfoRequestTemplateOutSchema = z.object({
  template_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  exhibition_type: z.string().nullable().optional(),
  is_archived: z.boolean().optional(),
  item_count: z.number().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  items: z.array(InfoRequestTemplateItemOutSchema).nullable().optional(),
}).passthrough();

export type InfoRequestTemplateOut = z.infer<typeof InfoRequestTemplateOutSchema>;

export const InformationPackageOutSchema = z.object({
  package_id: z.string(),
  organization_id: z.string(),
  media_id: z.string(),
  package_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  structure: z.any().optional(),
  provenance_event_ids: z.any().optional(),
  export_profile_id: z.string().nullable().optional(),
  external_identifier: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
}).passthrough();

export type InformationPackageOut = z.infer<typeof InformationPackageOutSchema>;

export const InformationPackageListResponseSchema = z.object({
  information_packages: z.array(InformationPackageOutSchema),
}).passthrough();

export type InformationPackageListResponse = z.infer<typeof InformationPackageListResponseSchema>;

export const InformationPackagePaginatedResponseSchema = z.object({
  items: z.array(InformationPackageOutSchema),
  total: z.number(),
  page: OffsetPaginationPageSchema,
}).passthrough();

export type InformationPackagePaginatedResponse = z.infer<typeof InformationPackagePaginatedResponseSchema>;

export const InheritedFieldsResponseSchema = z.object({
  inherited_fields: z.any(),
}).passthrough();

export type InheritedFieldsResponse = z.infer<typeof InheritedFieldsResponseSchema>;

export const InsuranceClaimOutSchema = z.object({
  claim_id: z.string(),
  organization_id: z.string(),
  claim_number: z.string().nullable().optional(),
  insurer_claim_number: z.string().nullable().optional(),
  coverage_id: z.string().nullable().optional(),
  indemnity_id: z.string().nullable().optional(),
  incident_report_id: z.string().nullable().optional(),
  date_of_loss: z.string().nullable().optional(),
  loss_description: z.string().nullable().optional(),
  loss_type: z.string().nullable().optional(),
  loss_type_label: z.string().nullable().optional(),
  claimed_amount: z.number().nullable().optional(),
  settlement_amount: z.number().nullable().optional(),
  amount_currency: z.string().nullable().optional(),
  adjuster_name: z.string().nullable().optional(),
  adjuster_contact: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  status_label: z.string().nullable().optional(),
  filed_date: z.string().nullable().optional(),
  settled_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type InsuranceClaimOut = z.infer<typeof InsuranceClaimOutSchema>;

export const InsuranceClaimListResponseSchema = z.object({
  claims: z.array(InsuranceClaimOutSchema),
  total: z.number(),
}).passthrough();

export type InsuranceClaimListResponse = z.infer<typeof InsuranceClaimListResponseSchema>;

export const InsuranceCoverageOutSchema = z.object({
  coverage_id: z.string(),
  organization_id: z.string(),
  policy_id: z.string().nullable().optional(),
  covered_entity_type: z.string().nullable().optional(),
  covered_entity_type_label: z.string().nullable().optional(),
  covered_entity_id: z.string().nullable().optional(),
  coverage_start_date: z.string().nullable().optional(),
  coverage_end_date: z.string().nullable().optional(),
  declared_value: z.number().nullable().optional(),
  agreed_value: z.number().nullable().optional(),
  value_currency: z.string().nullable().optional(),
  third_party_provider: z.string().nullable().optional(),
  third_party_policy_number: z.string().nullable().optional(),
  certificate_requested: z.boolean().optional(),
  certificate_received: z.boolean().optional(),
  certificate_received_date: z.string().nullable().optional(),
  certificate_number: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  status_label: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  is_third_party: z.boolean().optional(),
  has_certificate: z.boolean().optional(),
  policy: z.any().nullable().optional(),
  covered_entity: z.any().nullable().optional(),
}).passthrough();

export type InsuranceCoverageOut = z.infer<typeof InsuranceCoverageOutSchema>;

export const InsuranceCoverageListResponseSchema = z.object({
  coverages: z.array(InsuranceCoverageOutSchema),
  total: z.number(),
}).passthrough();

export type InsuranceCoverageListResponse = z.infer<typeof InsuranceCoverageListResponseSchema>;

export const InsuranceEnumsResponseSchema = z.object({
  policy_types: z.array(EnumItemSchema),
  policy_statuses: z.array(EnumItemSchema),
  covered_entity_types: z.array(EnumItemSchema),
  coverage_statuses: z.array(EnumItemSchema),
  indemnity_programs: z.array(EnumItemSchema),
  indemnity_statuses: z.array(EnumItemSchema),
  loss_types: z.array(EnumItemSchema),
  claim_statuses: z.array(EnumItemSchema),
}).passthrough();

export type InsuranceEnumsResponse = z.infer<typeof InsuranceEnumsResponseSchema>;

export const InsurancePolicyOutSchema = z.object({
  policy_id: z.string(),
  organization_id: z.string(),
  policy_number: z.string().nullable().optional(),
  policy_name: z.string().nullable().optional(),
  policy_type: z.string().nullable().optional(),
  policy_type_label: z.string().nullable().optional(),
  provider_name: z.string().nullable().optional(),
  provider_contact_id: z.string().nullable().optional(),
  broker_name: z.string().nullable().optional(),
  effective_date: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  coverage_limit: z.number().nullable().optional(),
  coverage_limit_currency: z.string().nullable().optional(),
  per_occurrence_limit: z.number().nullable().optional(),
  deductible: z.number().nullable().optional(),
  annual_premium: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  status_label: z.string().nullable().optional(),
  renewal_of_policy_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  is_expired: z.boolean().optional(),
  coverages: z.array(z.any()).nullable().optional(),
  coverage_count: z.number().nullable().optional(),
}).passthrough();

export type InsurancePolicyOut = z.infer<typeof InsurancePolicyOutSchema>;

export const InsurancePolicyListResponseSchema = z.object({
  items: z.array(InsurancePolicyOutSchema),
  total: z.number(),
  limit: z.number().nullable().optional(),
  offset: z.number().nullable().optional(),
}).passthrough();

export type InsurancePolicyListResponse = z.infer<typeof InsurancePolicyListResponseSchema>;

export const InsuranceResponseSchema = z.object({
  link_id: z.string(),
  insurance_confirmed: z.boolean(),
  insurance_policy: z.string().nullable().optional(),
  insurance_value: z.any().optional(),
}).passthrough();

export type InsuranceResponse = z.infer<typeof InsuranceResponseSchema>;

export const InteractionRecordResponseSchema = z.object({
  interaction_id: z.string(),
  visit_id: z.string(),
}).passthrough();

export type InteractionRecordResponse = z.infer<typeof InteractionRecordResponseSchema>;

export const InvitationOutSchema = z.object({
  invitation_id: z.string(),
  organization_id: z.string(),
  email: z.string(),
  role: z.string(),
  expires_at: z.string(),
  created_at: z.string(),
}).passthrough();

export type InvitationOut = z.infer<typeof InvitationOutSchema>;

export const InvitationVerifyResponseSchema = z.object({
  valid: z.boolean().optional(),
  email: z.string(),
  user_id: z.string().nullable().optional(),
  user_status: z.string().nullable().optional(),
  organization_id: z.string(),
  role: z.string(),
  expires_at: z.string(),
}).passthrough();

export type InvitationVerifyResponse = z.infer<typeof InvitationVerifyResponseSchema>;

export const InviteUserBodySchema = z.object({
  email: z.string(),
  role: z.string().optional(),
}).passthrough();

export type InviteUserBody = z.infer<typeof InviteUserBodySchema>;

export const ScheduleOutSchema = z.object({
  schedule_id: z.string(),
  enabled: z.boolean(),
  every_n: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
}).passthrough();

export type ScheduleOut = z.infer<typeof ScheduleOutSchema>;

export const PipelineSummaryOutSchema = z.object({
  pipeline_id: z.string(),
  name: z.string(),
}).passthrough();

export type PipelineSummaryOut = z.infer<typeof PipelineSummaryOutSchema>;

export const JobOutSchema = z.object({
  job_id: z.string(),
  organization_id: z.string(),
  schedule_id: z.string().nullable().optional(),
  pipeline_id: z.string().nullable().optional(),
  status: z.string(),
  scheduled_for: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  attempt: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  run_status: z.string().nullable().optional(),
  schedule: ScheduleOutSchema.nullable().optional(),
  pipeline: PipelineSummaryOutSchema.nullable().optional(),
}).passthrough();

export type JobOut = z.infer<typeof JobOutSchema>;

export const JobListResponseSchema = z.object({
  items: z.array(JobOutSchema),
  total: z.number(),
  limit: z.number(),
}).passthrough();

export type JobListResponse = z.infer<typeof JobListResponseSchema>;

export const LabelApprovedResponseSchema = z.object({
  label_id: z.string(),
  status: z.string(),
  message: z.string(),
}).passthrough();

export type LabelApprovedResponse = z.infer<typeof LabelApprovedResponseSchema>;

export const LabelTemplateCreatedResponseSchema = z.object({
  template_id: z.string(),
  name: z.string().nullable().optional(),
  message: z.string(),
}).passthrough();

export type LabelTemplateCreatedResponse = z.infer<typeof LabelTemplateCreatedResponseSchema>;

export const LabelTemplateOutSchema = z.object({
  template_id: z.string(),
  name: z.string().nullable().optional(),
  label_type: z.string().nullable().optional(),
  template_fields: z.any().optional(),
  font_family: z.string().nullable().optional(),
  font_size_pt: z.number().nullable().optional(),
  width_cm: z.number().nullable().optional(),
  height_cm: z.number().nullable().optional(),
  is_default: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type LabelTemplateOut = z.infer<typeof LabelTemplateOutSchema>;

export const LabelTemplateListResponseSchema = z.object({
  label_templates: z.array(LabelTemplateOutSchema),
}).passthrough();

export type LabelTemplateListResponse = z.infer<typeof LabelTemplateListResponseSchema>;

export const LabelTemplateUpdatedResponseSchema = z.object({
  template_id: z.string(),
  message: z.string(),
}).passthrough();

export type LabelTemplateUpdatedResponse = z.infer<typeof LabelTemplateUpdatedResponseSchema>;

export const LabelsGeneratedResponseSchema = z.object({
  message: z.string(),
  labels_created: z.number(),
}).passthrough();

export type LabelsGeneratedResponse = z.infer<typeof LabelsGeneratedResponseSchema>;

export const LastJobOutSchema = z.object({
  job_id: z.string(),
  status: z.string().nullable().optional(),
  scheduled_for: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
  created_at: z.string(),
  completed_at: z.string().nullable().optional(),
}).passthrough();

export type LastJobOut = z.infer<typeof LastJobOutSchema>;

export const LayoutDeactivateRequestSchema = z.object({
  surface_key: z.string(),
  object_type: z.string().nullable().optional(),
}).passthrough();

export type LayoutDeactivateRequest = z.infer<typeof LayoutDeactivateRequestSchema>;

export const LayoutOverrideCreateSchema = z.object({
  surface_key: z.string(),
  object_type: z.string().nullable().optional(),
  name: z.string(),
  delta: FormLayoutDeltaSchema,
  base_version: z.string().nullable().optional(),
  make_active: z.boolean().optional(),
}).passthrough();

export type LayoutOverrideCreate = z.infer<typeof LayoutOverrideCreateSchema>;

export const LayoutOverrideOutSchema = z.object({
  id: z.string(),
  surface_key: z.string(),
  object_type: z.string().nullable().optional(),
  name: z.string(),
  delta: z.any(),
  base_version: z.string().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export type LayoutOverrideOut = z.infer<typeof LayoutOverrideOutSchema>;

export const LayoutOverrideUpdateSchema = z.object({
  name: z.string().nullable().optional(),
  delta: FormLayoutDeltaSchema.nullable().optional(),
}).passthrough();

export type LayoutOverrideUpdate = z.infer<typeof LayoutOverrideUpdateSchema>;

export const LayoutSectionCatalogItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  group: z.string().nullable().optional(),
  required: z.boolean().optional(),
}).passthrough();

export type LayoutSectionCatalogItem = z.infer<typeof LayoutSectionCatalogItemSchema>;

export const LayoutSuggestRequestSchema = z.object({
  surface_key: z.string(),
  instruction: z.string(),
  sections: z.array(LayoutSectionCatalogItemSchema),
}).passthrough();

export type LayoutSuggestRequest = z.infer<typeof LayoutSuggestRequestSchema>;

export const LoanEnumsResponseSchema = z.object({
  loan_types: z.array(EnumItemSchema),
  statuses: z.array(EnumItemSchema),
  active_statuses: z.array(z.string()),
  completed_statuses: z.array(z.string()),
}).passthrough();

export type LoanEnumsResponse = z.infer<typeof LoanEnumsResponseSchema>;

export const LoanInOutSchema = z.object({
  loan_in_id: z.string(),
  organization_id: z.string(),
  loan_number: z.string().nullable().optional(),
  lender_id: z.string().nullable().optional(),
  lender_name: z.string().nullable().optional(),
  lender_contact: z.any().optional(),
  lender_contact_id: z.string().nullable().optional(),
  lender_contact_name: z.string().nullable().optional(),
  loan_purpose: z.string().nullable().optional(),
  exhibition_id: z.string().nullable().optional(),
  exhibition_name: z.string().nullable().optional(),
  request_date: z.string().nullable().optional(),
  loan_start_date: z.string().nullable().optional(),
  loan_end_date: z.string().nullable().optional(),
  loan_conditions: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  insurance_value: z.any().optional(),
  insurance_currency: z.string().nullable().optional(),
  loan_note: z.string().nullable().optional(),
  entry_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  actual_receipt_date: z.string().nullable().optional(),
  actual_return_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  closing_invoice_sent: z.boolean().nullable().optional(),
  closing_invoice_date: z.string().nullable().optional(),
  closing_invoice_reference: z.string().nullable().optional(),
  closing_invoice_amount: z.any().optional(),
  closing_invoice_currency: z.string().nullable().optional(),
  receipt_acknowledged: z.boolean().nullable().optional(),
  receipt_acknowledged_date: z.string().nullable().optional(),
  receipt_acknowledged_reference: z.string().nullable().optional(),
  conditions_met_confirmed: z.boolean().nullable().optional(),
  conditions_met_date: z.string().nullable().optional(),
  conditions_met_note: z.string().nullable().optional(),
  closing_note: z.string().nullable().optional(),
}).passthrough();

export type LoanInOut = z.infer<typeof LoanInOutSchema>;

export const LoanInDetailOutSchema = z.object({
  loan_in_id: z.string(),
  organization_id: z.string(),
  loan_number: z.string().nullable().optional(),
  lender_id: z.string().nullable().optional(),
  lender_name: z.string().nullable().optional(),
  lender_contact: z.any().optional(),
  lender_contact_id: z.string().nullable().optional(),
  lender_contact_name: z.string().nullable().optional(),
  loan_purpose: z.string().nullable().optional(),
  exhibition_id: z.string().nullable().optional(),
  exhibition_name: z.string().nullable().optional(),
  request_date: z.string().nullable().optional(),
  loan_start_date: z.string().nullable().optional(),
  loan_end_date: z.string().nullable().optional(),
  loan_conditions: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  insurance_value: z.any().optional(),
  insurance_currency: z.string().nullable().optional(),
  loan_note: z.string().nullable().optional(),
  entry_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  actual_receipt_date: z.string().nullable().optional(),
  actual_return_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  closing_invoice_sent: z.boolean().nullable().optional(),
  closing_invoice_date: z.string().nullable().optional(),
  closing_invoice_reference: z.string().nullable().optional(),
  closing_invoice_amount: z.any().optional(),
  closing_invoice_currency: z.string().nullable().optional(),
  receipt_acknowledged: z.boolean().nullable().optional(),
  receipt_acknowledged_date: z.string().nullable().optional(),
  receipt_acknowledged_reference: z.string().nullable().optional(),
  conditions_met_confirmed: z.boolean().nullable().optional(),
  conditions_met_date: z.string().nullable().optional(),
  conditions_met_note: z.string().nullable().optional(),
  closing_note: z.string().nullable().optional(),
  objects: z.array(z.any()).optional(),
}).passthrough();

export type LoanInDetailOut = z.infer<typeof LoanInDetailOutSchema>;

export const LoanInEntryOutSchema = z.object({
  loan_in_entry_id: z.string(),
  entry_id: z.string(),
  entry_number: z.string().nullable().optional(),
  entry_date: z.string().nullable().optional(),
  depositor_name: z.string().nullable().optional(),
  location_name: z.string().nullable().optional(),
  objects_description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type LoanInEntryOut = z.infer<typeof LoanInEntryOutSchema>;

export const LoanInEntryListResponseSchema = z.object({
  entries: z.array(LoanInEntryOutSchema),
}).passthrough();

export type LoanInEntryListResponse = z.infer<typeof LoanInEntryListResponseSchema>;

export const LoanInListResponseSchema = z.object({
  items: z.array(LoanInOutSchema).optional(),
  total: z.number(),
  limit: z.number().optional(),
  offset: z.number().optional(),
}).passthrough();

export type LoanInListResponse = z.infer<typeof LoanInListResponseSchema>;

export const LoanInObjectOutSchema = z.object({
  loan_object_id: z.string().nullable().optional(),
  loan_in_id: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  object_number_lender: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  object_description: z.string().nullable().optional(),
  artist_maker: z.string().nullable().optional(),
  date_description: z.string().nullable().optional(),
  insurance_value: z.any().optional(),
  insurance_currency: z.string().nullable().optional(),
  dimensions: z.string().nullable().optional(),
  medium: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  display_requirements: z.string().nullable().optional(),
  condition_in_note: z.string().nullable().optional(),
  condition_out_note: z.string().nullable().optional(),
  item_status: z.string().nullable().optional(),
  received_date: z.string().nullable().optional(),
  returned_date: z.string().nullable().optional(),
}).passthrough();

export type LoanInObjectOut = z.infer<typeof LoanInObjectOutSchema>;

export const LoanInObjectListResponseSchema = z.object({
  objects: z.array(LoanInObjectOutSchema),
  total: z.number(),
}).passthrough();

export type LoanInObjectListResponse = z.infer<typeof LoanInObjectListResponseSchema>;

export const LoanNetworkResponseSchema = z.object({
  organization: z.any(),
  contacts: z.array(z.any()),
}).passthrough();

export type LoanNetworkResponse = z.infer<typeof LoanNetworkResponseSchema>;

export const LoanOutItemOutSchema = z.object({
  loan_out_id: z.string(),
  organization_id: z.string(),
  loan_number: z.string().nullable().optional(),
  borrower_id: z.string().nullable().optional(),
  borrower_name: z.string().nullable().optional(),
  borrower_contact: z.any().optional(),
  venue_name: z.string().nullable().optional(),
  venue_address: z.any().optional(),
  loan_purpose: z.string().nullable().optional(),
  exhibition_title: z.string().nullable().optional(),
  request_date: z.string().nullable().optional(),
  loan_start_date: z.string().nullable().optional(),
  loan_end_date: z.string().nullable().optional(),
  loan_conditions: z.string().nullable().optional(),
  insurance_requirements: z.string().nullable().optional(),
  insurance_value_total: z.any().optional(),
  insurance_currency: z.string().nullable().optional(),
  loan_note: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  actual_dispatch_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
}).passthrough();

export type LoanOutItemOut = z.infer<typeof LoanOutItemOutSchema>;

export const LoanOutDetailOutSchema = z.object({
  loan_out_id: z.string(),
  organization_id: z.string(),
  loan_number: z.string().nullable().optional(),
  borrower_id: z.string().nullable().optional(),
  borrower_name: z.string().nullable().optional(),
  borrower_contact: z.any().optional(),
  venue_name: z.string().nullable().optional(),
  venue_address: z.any().optional(),
  loan_purpose: z.string().nullable().optional(),
  exhibition_title: z.string().nullable().optional(),
  request_date: z.string().nullable().optional(),
  loan_start_date: z.string().nullable().optional(),
  loan_end_date: z.string().nullable().optional(),
  loan_conditions: z.string().nullable().optional(),
  insurance_requirements: z.string().nullable().optional(),
  insurance_value_total: z.any().optional(),
  insurance_currency: z.string().nullable().optional(),
  loan_note: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  actual_dispatch_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  objects: z.array(z.any()).optional(),
}).passthrough();

export type LoanOutDetailOut = z.infer<typeof LoanOutDetailOutSchema>;

export const LoanOutListResponseSchema = z.object({
  items: z.array(LoanOutItemOutSchema).optional(),
  total: z.number(),
  limit: z.number().optional(),
  offset: z.number().optional(),
}).passthrough();

export type LoanOutListResponse = z.infer<typeof LoanOutListResponseSchema>;

export const LoanOutObjectOutSchema = z.object({
  loan_object_id: z.string().nullable().optional(),
  loan_out_id: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  insurance_value: z.any().optional(),
  insurance_currency: z.string().nullable().optional(),
  display_credit_line: z.string().nullable().optional(),
  display_label: z.string().nullable().optional(),
  display_requirements: z.string().nullable().optional(),
  installation_requirements: z.string().nullable().optional(),
  special_conditions: z.string().nullable().optional(),
  handling_requirements: z.string().nullable().optional(),
  environmental_requirements: z.string().nullable().optional(),
  photography_restrictions: z.string().nullable().optional(),
  condition_out_note: z.string().nullable().optional(),
  condition_return_note: z.string().nullable().optional(),
  item_status: z.string().nullable().optional(),
  dispatched_date: z.string().nullable().optional(),
  returned_date: z.string().nullable().optional(),
  damage_reported: z.boolean().nullable().optional(),
  damage_note: z.string().nullable().optional(),
}).passthrough();

export type LoanOutObjectOut = z.infer<typeof LoanOutObjectOutSchema>;

export const LoanOutObjectListResponseSchema = z.object({
  objects: z.array(LoanOutObjectOutSchema),
  total: z.number(),
}).passthrough();

export type LoanOutObjectListResponse = z.infer<typeof LoanOutObjectListResponseSchema>;

export const LoanOutObjectsAddedResponseSchema = z.object({
  objects: z.array(LoanOutObjectOutSchema),
  added_count: z.number(),
}).passthrough();

export type LoanOutObjectsAddedResponse = z.infer<typeof LoanOutObjectsAddedResponseSchema>;

export const LoanStatusResponseSchema = z.object({
  link_id: z.string(),
  old_status: z.string(),
  new_status: z.string(),
  status_label: z.string(),
}).passthrough();

export type LoanStatusResponse = z.infer<typeof LoanStatusResponseSchema>;

export const LoansSummaryResponseSchema = z.object({
  total: z.number(),
  loans_in: z.number(),
  loans_out: z.number(),
  planning: z.number(),
  linked: z.number(),
  active: z.number(),
  needs_attention: z.number(),
  agreements_pending: z.number(),
  insurance_pending: z.number(),
}).passthrough();

export type LoansSummaryResponse = z.infer<typeof LoansSummaryResponseSchema>;

export const LocationFullOutSchema = z.object({
  location_id: z.string(),
  organization_id: z.string(),
  parent_id: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  depth: z.number().nullable().optional(),
  name: z.string(),
  code: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  alternate_names: z.any().optional(),
  location_type: z.string().nullable().optional(),
  is_external: z.boolean().nullable().optional(),
  address: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  contact_email: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  coordinates: z.any().optional(),
  grid_reference: z.string().nullable().optional(),
  floor_plan_coordinates: z.any().optional(),
  capacity: z.number().nullable().optional(),
  current_count: z.number().nullable().optional(),
  capacity_note: z.string().nullable().optional(),
  climate_controlled: z.boolean().nullable().optional(),
  temperature_min: z.number().nullable().optional(),
  temperature_max: z.number().nullable().optional(),
  humidity_min: z.number().nullable().optional(),
  humidity_max: z.number().nullable().optional(),
  light_level: z.string().nullable().optional(),
  light_level_lux: z.any().optional(),
  uv_filtered: z.boolean().nullable().optional(),
  environment_note: z.string().nullable().optional(),
  default_fitness: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  condition_note: z.string().nullable().optional(),
  condition_date: z.string().nullable().optional(),
  pest_control_date: z.string().nullable().optional(),
  security_level: z.string().nullable().optional(),
  security_note: z.string().nullable().optional(),
  access_restricted: z.boolean().nullable().optional(),
  access_requirements: z.string().nullable().optional(),
  access_note: z.string().nullable().optional(),
  accessibility: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  on_display: z.boolean().nullable().optional(),
  established_date: z.string().nullable().optional(),
  decommissioned_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  object_count: z.number().nullable().optional(),
}).passthrough();

export type LocationFullOut = z.infer<typeof LocationFullOutSchema>;

export const LocationListResponseSchema = z.object({
  items: z.array(z.any()),
  total: z.number(),
  limit: z.number().nullable().optional(),
  offset: z.number().nullable().optional(),
}).passthrough();

export type LocationListResponse = z.infer<typeof LocationListResponseSchema>;

const LocationOutBaseSchema = z.object({
  location_id: z.string(),
  organization_id: z.string(),
  parent_id: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  depth: z.number().nullable().optional(),
  name: z.string(),
  code: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  location_type: z.string().nullable().optional(),
  is_external: z.boolean().nullable().optional(),
  capacity: z.number().nullable().optional(),
  current_count: z.number().nullable().optional(),
  climate_controlled: z.boolean().nullable().optional(),
  default_fitness: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  security_level: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  on_display: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type LocationOut = z.infer<typeof LocationOutBaseSchema> & {
  children?: LocationOut[] | null;
};

export const LocationOutSchema: z.ZodType<LocationOut> = LocationOutBaseSchema.extend({
  children: z.array(z.lazy(() => LocationOutSchema)).nullable().optional(),
});

export const LodFieldHintsOutSchema = z.object({
  field: z.string(),
  hints: z.array(z.any()),
}).passthrough();

export type LodFieldHintsOut = z.infer<typeof LodFieldHintsOutSchema>;

export const LodReadinessOutSchema = z.object({
  score: z.number(),
  level: z.string(),
  hints: z.array(z.any()).nullable().optional(),
  fields: z.any().nullable().optional(),
}).passthrough();

export type LodReadinessOut = z.infer<typeof LodReadinessOutSchema>;

export const LodScoreOutSchema = z.object({
  objectId: z.string(),
  score: z.number(),
  level: z.string(),
}).passthrough();

export type LodScoreOut = z.infer<typeof LodScoreOutSchema>;

export const LoginRequestSchema = z.object({
  email: z.string(),
  password: z.string(),
}).passthrough();

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  access_token: z.string(),
  active_organization_id: z.string().nullable().optional(),
}).passthrough();

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const LogoDeleteResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
}).passthrough();

export type LogoDeleteResponse = z.infer<typeof LogoDeleteResponseSchema>;

export const LogoUploadResponseSchema = z.object({
  success: z.boolean(),
  logo_s3_key: z.string(),
  logo_url: z.string().nullable().optional(),
}).passthrough();

export type LogoUploadResponse = z.infer<typeof LogoUploadResponseSchema>;

export const LookupCategoryWithValuesOutSchema = z.object({
  category_id: z.string(),
  category_key: z.string(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  applicable_contexts: z.array(z.string()),
  supports_icons: z.boolean(),
  values: z.array(LookupValueOutSchema),
}).passthrough();

export type LookupCategoryWithValuesOut = z.infer<typeof LookupCategoryWithValuesOutSchema>;

export const LookupValueBriefSchema = z.object({
  value_id: z.string(),
  value_key: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
}).passthrough();

export type LookupValueBrief = z.infer<typeof LookupValueBriefSchema>;

export const MFAChallengeResponseSchema = z.object({
  mfaRequired: z.boolean().optional(),
  mfaType: z.string(),
  session: z.string(),
}).passthrough();

export type MFAChallengeResponse = z.infer<typeof MFAChallengeResponseSchema>;

export const MFAEmailSetupVerifyBodySchema = z.object({
  code: z.string(),
}).passthrough();

export type MFAEmailSetupVerifyBody = z.infer<typeof MFAEmailSetupVerifyBodySchema>;

export const MFAPasswordChallengeResponseSchema = z.object({
  mfaRequired: z.boolean().optional(),
  session: z.string(),
  challengeType: z.string(),
}).passthrough();

export type MFAPasswordChallengeResponse = z.infer<typeof MFAPasswordChallengeResponseSchema>;

export const MFAPreferenceBodySchema = z.object({
  preferred: z.string(),
}).passthrough();

export type MFAPreferenceBody = z.infer<typeof MFAPreferenceBodySchema>;

export const MFAReverifyRequestSchema = z.object({
  code: z.string(),
}).passthrough();

export type MFAReverifyRequest = z.infer<typeof MFAReverifyRequestSchema>;

export const MFAReverifyResponseSchema = z.object({
  access_token: z.string(),
  mfa_verified: z.boolean().optional(),
  message: z.string().optional(),
}).passthrough();

export type MFAReverifyResponse = z.infer<typeof MFAReverifyResponseSchema>;

export const MFASetupRequiredResponseSchema = z.object({
  mfaSetupRequired: z.boolean().optional(),
  email: z.string(),
  session: z.string(),
}).passthrough();

export type MFASetupRequiredResponse = z.infer<typeof MFASetupRequiredResponseSchema>;

export const MFASetupStartBodySchema = z.object({
  email: z.string(),
  session: z.string(),
}).passthrough();

export type MFASetupStartBody = z.infer<typeof MFASetupStartBodySchema>;

export const MFASetupStartResponseSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
  session: z.string(),
}).passthrough();

export type MFASetupStartResponse = z.infer<typeof MFASetupStartResponseSchema>;

export const MFASetupVerifyBodySchema = z.object({
  email: z.string(),
  code: z.string(),
  session: z.string(),
}).passthrough();

export type MFASetupVerifyBody = z.infer<typeof MFASetupVerifyBodySchema>;

export const MFAVerifyRequestSchema = z.object({
  email: z.string(),
  code: z.string(),
  session: z.string(),
  mfaType: z.string().optional(),
}).passthrough();

export type MFAVerifyRequest = z.infer<typeof MFAVerifyRequestSchema>;

export const MarkAllReadResponseSchema = z.object({
  success: z.boolean().optional(),
  marked_count: z.number(),
}).passthrough();

export type MarkAllReadResponse = z.infer<typeof MarkAllReadResponseSchema>;

export const MediaAITagsResponseSchema = z.object({
  media_id: z.string(),
  ai_processing_status: z.string().nullable().optional(),
  ai_processed_at: z.string().nullable().optional(),
  ai_tags: z.array(AITagOutSchema),
}).passthrough();

export type MediaAITagsResponse = z.infer<typeof MediaAITagsResponseSchema>;

export const MediaAlternativesResponseSchema = z.object({
  media_id: z.string(),
  alternatives: z.array(AlternativeOutSchema),
}).passthrough();

export type MediaAlternativesResponse = z.infer<typeof MediaAlternativesResponseSchema>;

export const MediaCollectionOutSchema = z.object({
  collection_id: z.string(),
  organization_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  cover_media_id: z.string().nullable().optional(),
  visibility: z.string().nullable().optional(),
  public_share_token: z.string().nullable().optional(),
  public_share_enabled: z.boolean().nullable().optional(),
  public_share_expires_at: z.string().nullable().optional(),
  public_share_has_password: z.boolean().nullable().optional(),
  public_share_download_level: z.string().nullable().optional(),
  consent_clearance_required: z.boolean().nullable().optional(),
  consent_cleared_at: z.string().nullable().optional(),
  item_count: z.number().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  cover_url: z.string().nullable().optional(),
}).passthrough();

export type MediaCollectionOut = z.infer<typeof MediaCollectionOutSchema>;

export const MediaCollectionListResponseSchema = z.object({
  items: z.array(MediaCollectionOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type MediaCollectionListResponse = z.infer<typeof MediaCollectionListResponseSchema>;

export const MediaConsentCreatedResponseSchema = z.object({
  consent_id: z.string(),
  media_id: z.string(),
  subject_name: z.string().nullable().optional(),
  consent_type: z.string().nullable().optional(),
  consent_scope: z.string().nullable().optional(),
  is_valid: z.boolean().nullable().optional(),
}).passthrough();

export type MediaConsentCreatedResponse = z.infer<typeof MediaConsentCreatedResponseSchema>;

export const MediaConsentDeletedResponseSchema = z.object({
  success: z.boolean(),
  consent_id: z.string(),
}).passthrough();

export type MediaConsentDeletedResponse = z.infer<typeof MediaConsentDeletedResponseSchema>;

export const MediaConsentOutSchema = z.object({
  consent_id: z.string(),
  media_id: z.string(),
  subject_name: z.string().nullable().optional(),
  subject_role: z.string().nullable().optional(),
  consent_type: z.string().nullable().optional(),
  consent_scope: z.string().nullable().optional(),
  consent_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  consent_document_key: z.string().nullable().optional(),
  is_valid: z.boolean().nullable().optional(),
  revocation_date: z.string().nullable().optional(),
  revocation_reason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type MediaConsentOut = z.infer<typeof MediaConsentOutSchema>;

export const MediaConsentListResponseSchema = z.object({
  media_id: z.string(),
  consent_records: z.array(MediaConsentOutSchema),
  total: z.number(),
  has_valid_consent: z.boolean(),
}).passthrough();

export type MediaConsentListResponse = z.infer<typeof MediaConsentListResponseSchema>;

export const MediaConsentRevokedResponseSchema = z.object({
  consent_id: z.string(),
  media_id: z.string(),
  subject_name: z.string().nullable().optional(),
  is_valid: z.boolean(),
  revocation_date: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type MediaConsentRevokedResponse = z.infer<typeof MediaConsentRevokedResponseSchema>;

export const MediaConsentUpdatedResponseSchema = z.object({
  consent_id: z.string(),
  media_id: z.string(),
  subject_name: z.string().nullable().optional(),
  is_valid: z.boolean().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type MediaConsentUpdatedResponse = z.infer<typeof MediaConsentUpdatedResponseSchema>;

export const MediaDerivativesResponseSchema = z.object({
  media_id: z.string(),
  processing_status: z.string().nullable().optional(),
  derivatives: z.array(DerivativeOutSchema),
}).passthrough();

export type MediaDerivativesResponse = z.infer<typeof MediaDerivativesResponseSchema>;

export const MediaFolderOutSchema = z.object({
  folder_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  parent_folder_id: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  depth: z.number().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  breadcrumbs: z.array(z.any()).nullable().optional(),
}).passthrough();

export type MediaFolderOut = z.infer<typeof MediaFolderOutSchema>;

export const MediaOutSchema = z.object({
  media_id: z.string(),
  organization_id: z.string(),
  s3_key: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  alt_text: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  copyright_notice: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  date_created: z.string().nullable().optional(),
  copyright_status: z.string().nullable().optional(),
  rights_statement: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  tags: z.any().nullable().optional(),
  folder: z.string().nullable().optional(),
  metadata: z.any().nullable().optional(),
  processing_status: z.string().nullable().optional(),
  thumbnail_s3_key: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  current_version: z.number().nullable().optional(),
  checksum_sha256: z.string().nullable().optional(),
  is_published: z.boolean().optional(),
  published_at: z.string().nullable().optional(),
  published_url: z.string().nullable().optional(),
  published_by: z.string().nullable().optional(),
  metadata_reviewed: z.boolean().optional(),
  metadata_reviewed_at: z.string().nullable().optional(),
  metadata_reviewed_by: z.string().nullable().optional(),
  metadata_review_notes: z.string().nullable().optional(),
  technical_metadata: z.any().nullable().optional(),
  iptc_metadata: z.any().nullable().optional(),
  xmp_metadata: z.any().nullable().optional(),
  dublin_core: z.any().nullable().optional(),
  url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  derivatives: z.array(z.any()).nullable().optional(),
}).passthrough();

export type MediaOut = z.infer<typeof MediaOutSchema>;

export const MediaListResponseSchema = z.object({
  items: z.array(MediaOutSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
}).passthrough();

export type MediaListResponse = z.infer<typeof MediaListResponseSchema>;

export const MediaLockResponseSchema = z.object({
  locked: z.boolean(),
  expires_at: z.string().nullable().optional(),
}).passthrough();

export type MediaLockResponse = z.infer<typeof MediaLockResponseSchema>;

export const ProcessingStatusJobOutSchema = z.object({
  job_id: z.string(),
  job_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  retry_count: z.number().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  result: z.any().nullable().optional(),
}).passthrough();

export type ProcessingStatusJobOut = z.infer<typeof ProcessingStatusJobOutSchema>;

export const MediaProcessingStatusResponseSchema = z.object({
  media_id: z.string(),
  processing_status: z.string().nullable().optional(),
  jobs: z.array(ProcessingStatusJobOutSchema),
}).passthrough();

export type MediaProcessingStatusResponse = z.infer<typeof MediaProcessingStatusResponseSchema>;

export const MediaRightsCreatedResponseSchema = z.object({
  rights_id: z.string(),
  media_id: z.string(),
  rights_type: z.string().nullable().optional(),
}).passthrough();

export type MediaRightsCreatedResponse = z.infer<typeof MediaRightsCreatedResponseSchema>;

export const MediaRightsOutSchema = z.object({
  rights_id: z.string(),
  media_id: z.string(),
  organization_id: z.string(),
  rights_type: z.string().nullable().optional(),
  rights_status: z.string().nullable().optional(),
  rights_holder: z.string().nullable().optional(),
  license_type: z.string().nullable().optional(),
  license_url: z.string().nullable().optional(),
  rights_statement: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  usage_restrictions: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type MediaRightsOut = z.infer<typeof MediaRightsOutSchema>;

export const MediaRightsListResponseSchema = z.object({
  media_id: z.string(),
  rights: z.array(MediaRightsOutSchema),
}).passthrough();

export type MediaRightsListResponse = z.infer<typeof MediaRightsListResponseSchema>;

export const MediaRightsUpdatedResponseSchema = z.object({
  rights_id: z.string(),
}).passthrough();

export type MediaRightsUpdatedResponse = z.infer<typeof MediaRightsUpdatedResponseSchema>;

export const MediaSearchHitOutSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  creator: z.string().nullable().optional(),
  copyright_status: z.string().nullable().optional(),
  folder: z.string().nullable().optional(),
  tags: z.any().nullable().optional(),
  structured_tags: z.array(z.record(z.string(), z.string())).nullable().optional(),
  processing_status: z.string().nullable().optional(),
  is_published: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  highlights: z.any().nullable().optional(),
  url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
}).passthrough();

export type MediaSearchHitOut = z.infer<typeof MediaSearchHitOutSchema>;

export const MediaSearchResponseSchema = z.object({
  hits: z.array(MediaSearchHitOutSchema),
  total: z.number(),
  took_ms: z.number().optional(),
  next_offset: z.number().nullable().optional(),
  facets: z.array(FacetOutSchema).nullable().optional(),
}).passthrough();

export type MediaSearchResponse = z.infer<typeof MediaSearchResponseSchema>;

export const MediaTagOutSchema = z.object({
  tag_id: z.string(),
  organization_id: z.string(),
  media_id: z.string(),
  definition_id: z.string(),
  value_id: z.string().nullable().optional(),
  tag_value: z.string(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  tag_key: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
}).passthrough();

export type MediaTagOut = z.infer<typeof MediaTagOutSchema>;

export const MediaTagListResponseSchema = z.object({
  tags: z.array(MediaTagOutSchema),
  total: z.number(),
}).passthrough();

export type MediaTagListResponse = z.infer<typeof MediaTagListResponseSchema>;

export const TopMediaItemSchema = z.object({
  media_id: z.string(),
  title: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
  event_count: z.number(),
}).passthrough();

export type TopMediaItem = z.infer<typeof TopMediaItemSchema>;

export const MediaUsageReportResponseSchema = z.object({
  organization_id: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  period_days: z.number(),
  total_events: z.number(),
  by_event_type: EventTypeCountsSchema,
  top_media: z.array(TopMediaItemSchema),
}).passthrough();

export type MediaUsageReportResponse = z.infer<typeof MediaUsageReportResponseSchema>;

export const MediaUsageStatsResponseSchema = z.object({
  media_id: z.string(),
  period_days: z.number(),
  total_events: z.number(),
  unique_users: z.number(),
  by_event_type: EventTypeCountsSchema,
}).passthrough();

export type MediaUsageStatsResponse = z.infer<typeof MediaUsageStatsResponseSchema>;

export const MediaVersionOutSchema = z.object({
  version_id: z.string(),
  version_number: z.number(),
  file_size: z.number().nullable().optional(),
  checksum_sha256: z.string().nullable().optional(),
  change_note: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type MediaVersionOut = z.infer<typeof MediaVersionOutSchema>;

export const MediaVersionListResponseSchema = z.object({
  media_id: z.string(),
  current_version: z.number(),
  versions: z.array(MediaVersionOutSchema),
}).passthrough();

export type MediaVersionListResponse = z.infer<typeof MediaVersionListResponseSchema>;

const MenuItemOutBaseSchema = z.object({
  label: z.string().nullable().optional(),
  link_type: z.string().nullable().optional(),
  page_slug: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  image_media_id: z.string().nullable().optional(),
  highlight: z.boolean().nullable().optional(),
}).passthrough();

export type MenuItemOut = z.infer<typeof MenuItemOutBaseSchema> & {
  children?: MenuItemOut[] | null;
};

export const MenuItemOutSchema: z.ZodType<MenuItemOut> = MenuItemOutBaseSchema.extend({
  children: z.array(z.lazy(() => MenuItemOutSchema)).nullable().optional(),
});

export const MenuDataOutSchema = z.object({
  location: z.string(),
  items: z.array(MenuItemOutSchema),
}).passthrough();

export type MenuDataOut = z.infer<typeof MenuDataOutSchema>;

export const MenuOutSchema = z.object({
  menu_id: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  items: z.array(MenuItemOutSchema).optional(),
}).passthrough();

export type MenuOut = z.infer<typeof MenuOutSchema>;

export const MenuDataResponseSchema = z.object({
  data: MenuOutSchema,
}).passthrough();

export type MenuDataResponse = z.infer<typeof MenuDataResponseSchema>;

export const MenuResponseSchema = z.object({
  data: MenuDataOutSchema,
}).passthrough();

export type MenuResponse = z.infer<typeof MenuResponseSchema>;

export const MergeConstituentsResponseSchema = z.object({
  success: z.boolean(),
  primary_id: z.string(),
  secondary_id: z.string(),
  xrefs_reassigned: z.number(),
  xrefs_skipped_duplicate: z.number(),
}).passthrough();

export type MergeConstituentsResponse = z.infer<typeof MergeConstituentsResponseSchema>;

export const MergePersonAuthorityRequestSchema = z.object({
  target_authority_id: z.string(),
}).passthrough();

export type MergePersonAuthorityRequest = z.infer<typeof MergePersonAuthorityRequestSchema>;

export const MessageOutSchema = z.object({
  message_id: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  meta: z.any().optional(),
}).passthrough();

export type MessageOut = z.infer<typeof MessageOutSchema>;

export const MessageResponseSchema = z.object({
  message: z.string(),
}).passthrough();

export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const MetadataTemplateCreatedResponseSchema = z.object({
  template_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  template_fields: z.any().optional(),
  is_default: z.boolean().nullable().optional(),
}).passthrough();

export type MetadataTemplateCreatedResponse = z.infer<typeof MetadataTemplateCreatedResponseSchema>;

export const MetadataTemplateDeletedResponseSchema = z.object({
  success: z.boolean(),
  template_id: z.string(),
}).passthrough();

export type MetadataTemplateDeletedResponse = z.infer<typeof MetadataTemplateDeletedResponseSchema>;

export const MetadataTemplateOutSchema = z.object({
  template_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  template_fields: z.any().optional(),
  is_default: z.boolean().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
}).passthrough();

export type MetadataTemplateOut = z.infer<typeof MetadataTemplateOutSchema>;

export const MetadataTemplateListResponseSchema = z.object({
  templates: z.array(MetadataTemplateOutSchema),
}).passthrough();

export type MetadataTemplateListResponse = z.infer<typeof MetadataTemplateListResponseSchema>;

export const MetadataTemplateSetDefaultResponseSchema = z.object({
  success: z.boolean(),
  template_id: z.string(),
  message: z.string(),
}).passthrough();

export type MetadataTemplateSetDefaultResponse = z.infer<typeof MetadataTemplateSetDefaultResponseSchema>;

export const MfaRecoveryConfirmBodySchema = z.object({
  token: z.string(),
  password: z.string(),
}).passthrough();

export type MfaRecoveryConfirmBody = z.infer<typeof MfaRecoveryConfirmBodySchema>;

export const MfaRecoveryRequestBodySchema = z.object({
  email: z.string(),
}).passthrough();

export type MfaRecoveryRequestBody = z.infer<typeof MfaRecoveryRequestBodySchema>;

export const MigrationStartResponseSchema = z.object({
  task_id: z.string(),
  message: z.string(),
  status: z.string(),
  dry_run: z.boolean(),
}).passthrough();

export type MigrationStartResponse = z.infer<typeof MigrationStartResponseSchema>;

export const MigrationStatusResponseSchema = z.object({
  task_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  progress: z.any().optional(),
  result: z.any().optional(),
  completed_at: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type MigrationStatusResponse = z.infer<typeof MigrationStatusResponseSchema>;

export const MountConfigCreatedResponseSchema = z.object({
  mount_config_id: z.string(),
  name: z.string(),
  message: z.string(),
}).passthrough();

export type MountConfigCreatedResponse = z.infer<typeof MountConfigCreatedResponseSchema>;

export const MountConfigDeleteResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
}).passthrough();

export type MountConfigDeleteResponse = z.infer<typeof MountConfigDeleteResponseSchema>;

export const MountConfigOutSchema = z.object({
  mount_config_id: z.string(),
  name: z.string().nullable().optional(),
  mount_type: z.string().nullable().optional(),
  config: z.any().optional(),
  preview_image_url: z.string().nullable().optional(),
  is_system: z.boolean().optional(),
}).passthrough();

export type MountConfigOut = z.infer<typeof MountConfigOutSchema>;

export const MountConfigListResponseSchema = z.object({
  mount_configs: z.array(MountConfigOutSchema),
}).passthrough();

export type MountConfigListResponse = z.infer<typeof MountConfigListResponseSchema>;

export const MountConfigUpdateResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  mount_config_id: z.string(),
}).passthrough();

export type MountConfigUpdateResponse = z.infer<typeof MountConfigUpdateResponseSchema>;

export const MoveItemsResponseSchema = z.object({
  success: z.boolean().optional(),
  moved_count: z.number(),
}).passthrough();

export type MoveItemsResponse = z.infer<typeof MoveItemsResponseSchema>;

export const MovementOutSchema = z.object({
  movement_id: z.string(),
  organization_id: z.string(),
  movement_reference_number: z.string().nullable().optional(),
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  part_id: z.string().nullable().optional(),
  part_number: z.string().nullable().optional(),
  part_name: z.string().nullable().optional(),
  from_location_id: z.string().nullable().optional(),
  from_location_name: z.string().nullable().optional(),
  from_location_path: z.string().nullable().optional(),
  to_location_id: z.string(),
  to_location_name: z.string().nullable().optional(),
  to_location_path: z.string().nullable().optional(),
  location_fitness: z.string().nullable().optional(),
  movement_date: z.string().nullable().optional(),
  planned_removal_date: z.string().nullable().optional(),
  removal_date: z.string().nullable().optional(),
  planned_return_date: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  movement_note: z.string().nullable().optional(),
  reference_type: z.string().nullable().optional(),
  reference_id: z.string().nullable().optional(),
  authorized_by: z.string().nullable().optional(),
  authorizer_id: z.string().nullable().optional(),
  authorizer_name: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  authorization_note: z.string().nullable().optional(),
  movement_contact: z.string().nullable().optional(),
  movement_method: z.string().nullable().optional(),
  moved_by: z.string().nullable().optional(),
  moved_by_name: z.string().nullable().optional(),
  handler_id: z.string().nullable().optional(),
  handler_name: z.string().nullable().optional(),
  organization_courier: z.boolean().nullable().optional(),
  courier_name: z.string().nullable().optional(),
  shipper_id: z.string().nullable().optional(),
  shipper_name: z.string().nullable().optional(),
  shipping_method: z.string().nullable().optional(),
  shipping_tracking_number: z.string().nullable().optional(),
  shipping_insurance_value: z.string().nullable().optional(),
  shipping_insurance_currency: z.string().nullable().optional(),
  shipping_note: z.string().nullable().optional(),
  condition_note: z.string().nullable().optional(),
  condition_report_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
}).passthrough();

export type MovementOut = z.infer<typeof MovementOutSchema>;

export const MovementListResponseSchema = z.object({
  items: z.array(MovementOutSchema),
  total: z.number(),
  limit: z.number().nullable().optional(),
  offset: z.number().nullable().optional(),
}).passthrough();

export type MovementListResponse = z.infer<typeof MovementListResponseSchema>;

export const NagpraActionOutSchema = z.object({
  action_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  action_number: z.string().nullable().optional(),
  group_reference: z.string().nullable().optional(),
  origin_type: z.string().nullable().optional(),
  nagpra_category: z.string().nullable().optional(),
  funerary_association: z.string().nullable().optional(),
  category_basis: z.string().nullable().optional(),
  category_determined_date: z.string().nullable().optional(),
  category_determined_by: z.string().nullable().optional(),
  geographic_origin: z.string().nullable().optional(),
  site_name: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  county: z.string().nullable().optional(),
  affiliation_status: z.string().nullable().optional(),
  affiliated_party_id: z.string().nullable().optional(),
  affiliation_basis: z.string().nullable().optional(),
  affiliation_evidence_types: z.any().optional(),
  affiliation_determined_date: z.string().nullable().optional(),
  display_consent: z.string().nullable().optional(),
  display_consent_date: z.string().nullable().optional(),
  access_consent: z.string().nullable().optional(),
  access_consent_date: z.string().nullable().optional(),
  research_consent: z.string().nullable().optional(),
  research_consent_date: z.string().nullable().optional(),
  handling_preferences: z.string().nullable().optional(),
  storage_preferences: z.string().nullable().optional(),
  hold_active: z.boolean().nullable().optional(),
  notice_type: z.string().nullable().optional(),
  notice_submitted_date: z.string().nullable().optional(),
  notice_published_date: z.string().nullable().optional(),
  notice_fr_citation: z.string().nullable().optional(),
  waiting_period_end_date: z.string().nullable().optional(),
  transfer_date: z.string().nullable().optional(),
  transfer_recipient_id: z.string().nullable().optional(),
  transfer_method: z.string().nullable().optional(),
  transfer_note: z.string().nullable().optional(),
  deaccession_id: z.string().nullable().optional(),
  coordinator_id: z.string().nullable().optional(),
  identified_date: z.string().nullable().optional(),
  consultation_initiated_date: z.string().nullable().optional(),
  closed_date: z.string().nullable().optional(),
  inventory_deadline: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  action_note: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type NagpraActionOut = z.infer<typeof NagpraActionOutSchema>;

export const NearbyPlacesResponseSchema = z.object({
  places: z.array(z.any()),
}).passthrough();

export type NearbyPlacesResponse = z.infer<typeof NearbyPlacesResponseSchema>;

export const NearestEntitiesResponseSchema = z.object({
  entities: z.array(z.any()),
}).passthrough();

export type NearestEntitiesResponse = z.infer<typeof NearestEntitiesResponseSchema>;

export const NotificationActorOutSchema = z.object({
  user_id: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
}).passthrough();

export type NotificationActorOut = z.infer<typeof NotificationActorOutSchema>;

export const NotificationOutSchema = z.object({
  notification_id: z.string(),
  notification_type: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string().nullable().optional(),
  actor: NotificationActorOutSchema.nullable().optional(),
  is_read: z.boolean(),
  read_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type NotificationOut = z.infer<typeof NotificationOutSchema>;

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationOutSchema),
  unread_count: z.number(),
  total: z.number(),
  has_more: z.boolean(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const ObjectAcquisitionResponseSchema = z.object({
  acquisition: z.any().nullable().optional(),
  link: z.any().nullable().optional(),
}).passthrough();

export type ObjectAcquisitionResponse = z.infer<typeof ObjectAcquisitionResponseSchema>;

export const ObjectCitationOutSchema = z.object({
  link_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  citation_id: z.string(),
  page_reference: z.string().nullable().optional(),
  figure_reference: z.string().nullable().optional(),
  plate_reference: z.string().nullable().optional(),
  catalog_number: z.string().nullable().optional(),
  works_cited: z.boolean().nullable().optional(),
  works_illustrated: z.boolean().nullable().optional(),
  is_primary: z.boolean().nullable().optional(),
  display_order: z.number().nullable().optional(),
  link_note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  citation: CitationOutSchema.nullable().optional(),
}).passthrough();

export type ObjectCitationOut = z.infer<typeof ObjectCitationOutSchema>;

export const ObjectCitationListResponseSchema = z.object({
  citations: z.array(ObjectCitationOutSchema),
  total: z.number(),
}).passthrough();

export type ObjectCitationListResponse = z.infer<typeof ObjectCitationListResponseSchema>;

export const ObjectClassificationOutSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  value_id: z.string(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  lookup_value: LookupValueBriefSchema.nullable().optional(),
}).passthrough();

export type ObjectClassificationOut = z.infer<typeof ObjectClassificationOutSchema>;

export const ObjectConstituentsResponseSchema = z.object({
  object_id: z.string(),
  constituents: z.array(ConstituentXrefOutSchema),
}).passthrough();

export type ObjectConstituentsResponse = z.infer<typeof ObjectConstituentsResponseSchema>;

export const ObjectContextOutSchema = z.object({
  context_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  context_type: z.string().nullable().optional(),
  building_name: z.string().nullable().optional(),
  site_name: z.string().nullable().optional(),
  part_placement: z.string().nullable().optional(),
  architectural_date_display: z.string().nullable().optional(),
  architectural_date_earliest: z.string().nullable().optional(),
  architectural_date_latest: z.string().nullable().optional(),
  historical_place_id: z.string().nullable().optional(),
  historical_date_display: z.string().nullable().optional(),
  historical_date_earliest: z.string().nullable().optional(),
  historical_date_latest: z.string().nullable().optional(),
  event_id: z.string().nullable().optional(),
  event_description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type ObjectContextOut = z.infer<typeof ObjectContextOutSchema>;

export const ObjectContextListResponseSchema = z.object({
  contexts: z.array(ObjectContextOutSchema),
}).passthrough();

export type ObjectContextListResponse = z.infer<typeof ObjectContextListResponseSchema>;

export const ObjectEntryDetailResponseSchema = z.object({
}).passthrough();

export type ObjectEntryDetailResponse = z.infer<typeof ObjectEntryDetailResponseSchema>;

export const ObjectEntryListResponseSchema = z.object({
  items: z.array(z.any()).optional(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ObjectEntryListResponse = z.infer<typeof ObjectEntryListResponseSchema>;

export const ObjectEntryOutSchema = z.object({
  entry_id: z.string(),
  organization_id: z.string(),
  entry_number: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type ObjectEntryOut = z.infer<typeof ObjectEntryOutSchema>;

export const ObjectEventsResponseSchema = z.object({
  events: z.array(EventOutSchema),
  total: z.number(),
}).passthrough();

export type ObjectEventsResponse = z.infer<typeof ObjectEventsResponseSchema>;

export const ObjectExitDetailResponseSchema = z.object({
}).passthrough();

export type ObjectExitDetailResponse = z.infer<typeof ObjectExitDetailResponseSchema>;

export const ObjectExitListResponseSchema = z.object({
  items: z.array(z.any()).optional(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ObjectExitListResponse = z.infer<typeof ObjectExitListResponseSchema>;

export const ObjectExitOutSchema = z.object({
  exit_id: z.string(),
  organization_id: z.string(),
  exit_number: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type ObjectExitOut = z.infer<typeof ObjectExitOutSchema>;

export const VocabularyTermOutSchema = z.object({
  term_id: z.string(),
  organization_id: z.string().nullable().optional(),
  vocabulary: z.string().nullable().optional(),
  external_id: z.string().nullable().optional(),
  external_uri: z.string().nullable().optional(),
  preferred_term: z.string().nullable().optional(),
  alternate_terms: z.any().optional(),
  scope_note: z.string().nullable().optional(),
  term_type: z.string().nullable().optional(),
  hierarchy_path: z.string().nullable().optional(),
  broader_term: z.string().nullable().optional(),
  applicable_fields: z.any().optional(),
  usage_count: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  is_custom: z.boolean().nullable().optional(),
  facet: z.string().nullable().optional(),
  hierarchy_fetched_at: z.string().nullable().optional(),
  getty_modified_at: z.string().nullable().optional(),
}).passthrough();

export type VocabularyTermOut = z.infer<typeof VocabularyTermOutSchema>;

export const ObjectMaterialOutSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  vocabulary_term_id: z.string(),
  part: z.string().nullable().optional(),
  extent: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  vocabulary_term: VocabularyTermOutSchema.nullable().optional(),
}).passthrough();

export type ObjectMaterialOut = z.infer<typeof ObjectMaterialOutSchema>;

export const PublicMediaOutSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  file_size: z.number().nullable().optional(),
  alt_text: z.string().nullable().optional(),
  attribution: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  dublin_core: z.record(z.string(), z.any()).nullable().optional(),
  url: z.string().nullable().optional(),
  derivatives: z.record(z.string(), DerivativeOutSchema).nullable().optional(),
  rights: MediaRightsOutSchema.nullable().optional(),
  object_metadata: z.array(z.record(z.string(), z.any())).nullable().optional(),
}).passthrough();

export type PublicMediaOut = z.infer<typeof PublicMediaOutSchema>;

export const ObjectMediaLinkOutSchema = z.object({
  media: PublicMediaOutSchema,
  is_primary: z.boolean().nullable().optional(),
  caption: z.string().nullable().optional(),
}).passthrough();

export type ObjectMediaLinkOut = z.infer<typeof ObjectMediaLinkOutSchema>;

export const ObjectMediaListResponseSchema = z.object({
  media: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type ObjectMediaListResponse = z.infer<typeof ObjectMediaListResponseSchema>;

export const ObjectMediaResponseSchema = z.object({
  data: z.array(ObjectMediaLinkOutSchema),
}).passthrough();

export type ObjectMediaResponse = z.infer<typeof ObjectMediaResponseSchema>;

export const ObjectMetadataLinkOutSchema = z.object({
  object_id: z.string().nullable().optional(),
  is_primary: z.boolean().nullable().optional(),
  caption: z.string().nullable().optional(),
}).passthrough();

export type ObjectMetadataLinkOut = z.infer<typeof ObjectMetadataLinkOutSchema>;

export const ObjectMovementsResponseSchema = z.object({
  movements: z.array(MovementOutSchema),
  total: z.number(),
}).passthrough();

export type ObjectMovementsResponse = z.infer<typeof ObjectMovementsResponseSchema>;

export const ObjectPartOutSchema = z.object({
  part_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  part_number: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  current_location_id: z.string().nullable().optional(),
  current_location_fitness: z.string().nullable().optional(),
  current_location_note: z.string().nullable().optional(),
  current_location_date: z.string().nullable().optional(),
  home_location_id: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  current_location_name: z.string().nullable().optional(),
  current_location_path: z.string().nullable().optional(),
  current_location_on_display: z.boolean().nullable().optional(),
  home_location_name: z.string().nullable().optional(),
  home_location_path: z.string().nullable().optional(),
}).passthrough();

export type ObjectPartOut = z.infer<typeof ObjectPartOutSchema>;

export const ObjectPartListResponseSchema = z.object({
  parts: z.array(ObjectPartOutSchema),
  total: z.number(),
}).passthrough();

export type ObjectPartListResponse = z.infer<typeof ObjectPartListResponseSchema>;

export const PersonAuthorityOutSchema = z.object({
  authority_id: z.string(),
  organization_id: z.string(),
  preferred_name: z.string().nullable().optional(),
  variant_names: z.array(z.string()).nullable().optional(),
  nationality: z.string().nullable().optional(),
  culture: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  life_roles: z.array(z.string()).nullable().optional(),
  birth_date_display: z.string().nullable().optional(),
  birth_date_earliest: z.string().nullable().optional(),
  birth_date_latest: z.string().nullable().optional(),
  birth_place: z.string().nullable().optional(),
  death_date_display: z.string().nullable().optional(),
  death_date_earliest: z.string().nullable().optional(),
  death_date_latest: z.string().nullable().optional(),
  death_place: z.string().nullable().optional(),
  active_date_display: z.string().nullable().optional(),
  biography: z.string().nullable().optional(),
  ulan_id: z.string().nullable().optional(),
  viaf_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  external_uris: z.array(z.string()).nullable().optional(),
  status: z.string().nullable().optional(),
  merged_into_id: z.string().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  linked_objects_count: z.number().nullable().optional(),
}).passthrough();

export type PersonAuthorityOut = z.infer<typeof PersonAuthorityOutSchema>;

export const ObjectPersonAuthorityLinkOutSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  authority_id: z.string(),
  role: z.string().nullable().optional(),
  role_qualifier: z.string().nullable().optional(),
  attribution_certainty: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  display_name_override: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  authority: PersonAuthorityOutSchema.nullable().optional(),
}).passthrough();

export type ObjectPersonAuthorityLinkOut = z.infer<typeof ObjectPersonAuthorityLinkOutSchema>;

export const PlaceAuthorityOutSchema = z.object({
  place_authority_id: z.string(),
  organization_id: z.string(),
  preferred_name: z.string().nullable().optional(),
  variant_names: z.array(z.string()).nullable().optional(),
  place_type: z.string().nullable().optional(),
  tgn_id: z.string().nullable().optional(),
  geonames_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  coordinates_lat: z.number().nullable().optional(),
  coordinates_lng: z.number().nullable().optional(),
  parent_place_id: z.string().nullable().optional(),
  hierarchy_path: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  linked_objects_count: z.number().nullable().optional(),
}).passthrough();

export type PlaceAuthorityOut = z.infer<typeof PlaceAuthorityOutSchema>;

export const ObjectPlaceAuthorityLinkOutSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  place_authority_id: z.string(),
  role: z.string().nullable().optional(),
  date_display: z.string().nullable().optional(),
  date_earliest: z.string().nullable().optional(),
  date_latest: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  place_authority: PlaceAuthorityOutSchema.nullable().optional(),
}).passthrough();

export type ObjectPlaceAuthorityLinkOut = z.infer<typeof ObjectPlaceAuthorityLinkOutSchema>;

export const ObjectPlaceAuthorityListResponseSchema = z.object({
  place_authorities: z.array(ObjectPlaceAuthorityLinkOutSchema),
}).passthrough();

export type ObjectPlaceAuthorityListResponse = z.infer<typeof ObjectPlaceAuthorityListResponseSchema>;

export const ObjectProceduresResponseSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  acquisitions: z.array(z.any()),
  loans_out: z.array(z.any()),
  conservation: z.array(z.any()),
  condition_reports: z.array(z.any()),
  deaccessions: z.array(z.any()),
  use_requests: z.array(z.any()),
  incident_reports: z.array(z.any()),
}).passthrough();

export type ObjectProceduresResponse = z.infer<typeof ObjectProceduresResponseSchema>;

export const ObjectRelationshipOutSchema = z.object({
  relationship_id: z.string(),
  organization_id: z.string(),
  source_object_id: z.string(),
  related_object_id: z.string().nullable().optional(),
  external_work_title: z.string().nullable().optional(),
  external_work_creator: z.string().nullable().optional(),
  external_work_date: z.string().nullable().optional(),
  external_work_location: z.string().nullable().optional(),
  external_work_identifier: z.string().nullable().optional(),
  external_work_thumbnail_url: z.string().nullable().optional(),
  related_object_summary: z.any().nullable().optional(),
  relationship_type: z.string().nullable().optional(),
  relationship_direction: z.string().nullable().optional(),
  sequence_number: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ObjectRelationshipOut = z.infer<typeof ObjectRelationshipOutSchema>;

export const ObjectRelationshipsResponseSchema = z.object({
  outgoing: z.array(ObjectRelationshipOutSchema),
  incoming: z.array(ObjectRelationshipOutSchema),
}).passthrough();

export type ObjectRelationshipsResponse = z.infer<typeof ObjectRelationshipsResponseSchema>;

export const ObjectRightOutSchema = z.object({
  right_id: z.string(),
  organization_id: z.string(),
  object_id: z.string(),
  right_type: z.string().nullable().optional(),
  right_subtype: z.string().nullable().optional(),
  rights_holder_contact_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  is_perpetual: z.boolean().nullable().optional(),
  territory: z.string().nullable().optional(),
  territory_note: z.string().nullable().optional(),
  license_type: z.string().nullable().optional(),
  license_reference: z.string().nullable().optional(),
  license_url: z.string().nullable().optional(),
  usage_conditions: z.string().nullable().optional(),
  restrictions: z.string().nullable().optional(),
  fee_required: z.boolean().nullable().optional(),
  fee_amount: z.number().nullable().optional(),
  fee_currency: z.string().nullable().optional(),
  fee_note: z.string().nullable().optional(),
  is_orphan_work: z.boolean().nullable().optional(),
  due_diligence_conducted: z.boolean().nullable().optional(),
  due_diligence_date: z.string().nullable().optional(),
  due_diligence_steps: z.string().nullable().optional(),
  orphan_works_license_number: z.string().nullable().optional(),
  orphan_works_license_date: z.string().nullable().optional(),
  orphan_works_license_expiry: z.string().nullable().optional(),
  permissions_granted: z.string().nullable().optional(),
  agreement_reference: z.string().nullable().optional(),
  documentation_references: z.any().optional(),
  next_review_date: z.string().nullable().optional(),
  last_review_date: z.string().nullable().optional(),
  right_note: z.string().nullable().optional(),
  internal_note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type ObjectRightOut = z.infer<typeof ObjectRightOutSchema>;

export const ObjectRightListResponseSchema = z.object({
  items: z.array(ObjectRightOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ObjectRightListResponse = z.infer<typeof ObjectRightListResponseSchema>;

export const StylePeriodAuthorityOutSchema = z.object({
  authority_id: z.string(),
  organization_id: z.string(),
  preferred_term: z.string().nullable().optional(),
  variant_terms: z.array(z.string()).nullable().optional(),
  authority_type: z.string().nullable().optional(),
  aat_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  culture: z.string().nullable().optional(),
  date_display: z.string().nullable().optional(),
  date_earliest: z.string().nullable().optional(),
  date_latest: z.string().nullable().optional(),
  geographic_scope: z.string().nullable().optional(),
  parent_authority_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  linked_objects_count: z.number().nullable().optional(),
}).passthrough();

export type StylePeriodAuthorityOut = z.infer<typeof StylePeriodAuthorityOutSchema>;

export const ObjectStylePeriodLinkOutSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  authority_id: z.string(),
  assignment_certainty: z.string().nullable().optional(),
  assignment_note: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  authority: StylePeriodAuthorityOutSchema.nullable().optional(),
}).passthrough();

export type ObjectStylePeriodLinkOut = z.infer<typeof ObjectStylePeriodLinkOutSchema>;

export const ObjectStylePeriodListResponseSchema = z.object({
  style_periods: z.array(ObjectStylePeriodLinkOutSchema),
}).passthrough();

export type ObjectStylePeriodListResponse = z.infer<typeof ObjectStylePeriodListResponseSchema>;

export const SubjectAuthorityOutSchema = z.object({
  authority_id: z.string(),
  organization_id: z.string(),
  preferred_term: z.string().nullable().optional(),
  variant_terms: z.array(z.string()).nullable().optional(),
  subject_type: z.string().nullable().optional(),
  aat_id: z.string().nullable().optional(),
  iconclass_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  broader_subject_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  linked_objects_count: z.number().nullable().optional(),
}).passthrough();

export type SubjectAuthorityOut = z.infer<typeof SubjectAuthorityOutSchema>;

export const ObjectSubjectLinkOutSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  subject_authority_id: z.string(),
  subject_extent: z.string().nullable().optional(),
  interpretation_note: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  subject_authority: SubjectAuthorityOutSchema.nullable().optional(),
}).passthrough();

export type ObjectSubjectLinkOut = z.infer<typeof ObjectSubjectLinkOutSchema>;

export const ObjectSubjectListResponseSchema = z.object({
  subjects: z.array(ObjectSubjectLinkOutSchema),
}).passthrough();

export type ObjectSubjectListResponse = z.infer<typeof ObjectSubjectListResponseSchema>;

export const ObjectTechniqueOutSchema = z.object({
  link_id: z.string(),
  object_id: z.string(),
  vocabulary_term_id: z.string(),
  part: z.string().nullable().optional(),
  extent: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  vocabulary_term: VocabularyTermOutSchema.nullable().optional(),
}).passthrough();

export type ObjectTechniqueOut = z.infer<typeof ObjectTechniqueOutSchema>;

export const ObjectTitleOutSchema = z.object({
  title: z.string().nullable().optional(),
  title_type: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  is_preferred: z.boolean().nullable().optional(),
}).passthrough();

export type ObjectTitleOut = z.infer<typeof ObjectTitleOutSchema>;

export const ValuationOutSchema = z.object({
  valuation_id: z.string(),
  organization_id: z.string(),
  object_id: z.string().nullable().optional(),
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  valuation_type: z.string().nullable().optional(),
  valuation_amount: z.number().nullable().optional(),
  valuation_currency: z.string().nullable().optional(),
  valuation_date: z.string().nullable().optional(),
  valuator_id: z.string().nullable().optional(),
  valuator_name: z.string().nullable().optional(),
  valuator_organization: z.string().nullable().optional(),
  valuator_credentials: z.string().nullable().optional(),
  valuation_method: z.string().nullable().optional(),
  documentation_reference: z.string().nullable().optional(),
  valuation_note: z.string().nullable().optional(),
  valid_from: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  is_current: z.boolean().nullable().optional(),
  authorizer_id: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  authorization_note: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
}).passthrough();

export type ValuationOut = z.infer<typeof ValuationOutSchema>;

export const ObjectValuationListResponseSchema = z.object({
  valuations: z.array(ValuationOutSchema),
  total: z.number(),
}).passthrough();

export type ObjectValuationListResponse = z.infer<typeof ObjectValuationListResponseSchema>;

export const OkResponseSchema = z.object({
  ok: z.boolean().optional(),
}).passthrough();

export type OkResponse = z.infer<typeof OkResponseSchema>;

export const OnDemandRunOutSchema = z.object({
  run_id: z.string(),
  report_key: z.string().nullable().optional(),
  context_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  triggered_by: z.string().nullable().optional(),
  export_format: z.string().nullable().optional(),
  row_count: z.number().nullable().optional(),
  execution_time_ms: z.number().nullable().optional(),
  error_message: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  has_download: z.boolean().optional(),
}).passthrough();

export type OnDemandRunOut = z.infer<typeof OnDemandRunOutSchema>;

export const OnDemandRunListResponseSchema = z.object({
  items: z.array(OnDemandRunOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type OnDemandRunListResponse = z.infer<typeof OnDemandRunListResponseSchema>;

export const OrgAppInfoSchema = z.object({
  key: z.string(),
  display_name: z.string(),
  contract_start_date: z.string().nullable().optional(),
  contract_end_date: z.string().nullable().optional(),
}).passthrough();

export type OrgAppInfo = z.infer<typeof OrgAppInfoSchema>;

export const OrgApplicationOutSchema = z.object({
  application_id: z.string(),
  key: z.string(),
  display_name: z.string(),
  status: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  enabled_at: z.string().nullable().optional(),
  enabled_by: z.string().nullable().optional(),
  contract_start_date: z.string().nullable().optional(),
  contract_end_date: z.string().nullable().optional(),
}).passthrough();

export type OrgApplicationOut = z.infer<typeof OrgApplicationOutSchema>;

export const OrgApplicationsResponseSchema = z.object({
  organization_id: z.string(),
  organization_name: z.string(),
  applications: z.array(OrgApplicationOutSchema),
}).passthrough();

export type OrgApplicationsResponse = z.infer<typeof OrgApplicationsResponseSchema>;

export const OrgStorageInfoSchema = z.object({
  media_bytes: z.number().optional(),
  db_bytes: z.number().optional(),
  search_bytes: z.number().optional(),
  total_used_bytes: z.number().optional(),
  used_gb: z.number().optional(),
  limit_gb: z.number().optional(),
  usage_percent: z.number().optional(),
  metered_at: z.string().nullable().optional(),
}).passthrough();

export type OrgStorageInfo = z.infer<typeof OrgStorageInfoSchema>;

export const OrgStorageOutSchema = z.object({
  organization_id: z.string(),
  name: z.string(),
  slug: z.string(),
  storage_limit_gb: z.number().nullable().optional(),
  usage: z.any().optional(),
  region: z.string().optional(),
}).passthrough();

export type OrgStorageOut = z.infer<typeof OrgStorageOutSchema>;

export const OrgStorageListResponseSchema = z.object({
  organizations: z.array(OrgStorageOutSchema),
}).passthrough();

export type OrgStorageListResponse = z.infer<typeof OrgStorageListResponseSchema>;

export const OrgUserOutSchema = z.object({
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
  app_roles: z.record(z.string(), AppRoleOutSchema).nullable().optional(),
}).passthrough();

export type OrgUserOut = z.infer<typeof OrgUserOutSchema>;

export const OrgUsersResponseSchema = z.object({
  organization_id: z.string(),
  users: z.array(OrgUserOutSchema),
  total: z.number(),
}).passthrough();

export type OrgUsersResponse = z.infer<typeof OrgUsersResponseSchema>;

export const OrganizationOutSchema = z.object({
  organization_id: z.string(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type OrganizationOut = z.infer<typeof OrganizationOutSchema>;

export const StorageUsageDetailSchema = z.object({
  used_bytes: z.number().optional(),
  used_gb: z.number().optional(),
  limit_bytes: z.number().optional(),
  limit_gb: z.number().optional(),
  remaining_bytes: z.number().optional(),
  remaining_gb: z.number().optional(),
  usage_percent: z.number().optional(),
  media_bytes: z.number().optional(),
  db_bytes: z.number().optional(),
  search_bytes: z.number().optional(),
  metered_at: z.string().nullable().optional(),
}).passthrough();

export type StorageUsageDetail = z.infer<typeof StorageUsageDetailSchema>;

export const OrganizationStorageResponseSchema = z.object({
  usage: StorageUsageDetailSchema,
  region: z.string().optional(),
}).passthrough();

export type OrganizationStorageResponse = z.infer<typeof OrganizationStorageResponseSchema>;

export const OtherNumberTypeDeleteResponseSchema = z.object({
  success: z.boolean(),
  deleted: z.boolean(),
  deactivated: z.boolean(),
}).passthrough();

export type OtherNumberTypeDeleteResponse = z.infer<typeof OtherNumberTypeDeleteResponseSchema>;

export const OtherNumberTypeListResponseSchema = z.object({
  types: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type OtherNumberTypeListResponse = z.infer<typeof OtherNumberTypeListResponseSchema>;

export const OtherNumberTypeOutSchema = z.object({
}).passthrough();

export type OtherNumberTypeOut = z.infer<typeof OtherNumberTypeOutSchema>;

export const OverviewPreferencesResponseSchema = z.object({
  visible_dataset_ids: z.array(z.string()).optional(),
  dataset_order: z.array(z.string()).optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type OverviewPreferencesResponse = z.infer<typeof OverviewPreferencesResponseSchema>;

export const PageAncestorOutSchema = z.object({
  page_id: z.string(),
  slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
}).passthrough();

export type PageAncestorOut = z.infer<typeof PageAncestorOutSchema>;

export const _CamelModelSchema = z.object({
}).passthrough();

export type _CamelModel = z.infer<typeof _CamelModelSchema>;

export const PageContextEntityInSchema = z.object({
  type: z.string(),
  id: z.string(),
  label: z.string(),
}).passthrough();

export type PageContextEntityIn = z.infer<typeof PageContextEntityInSchema>;

export const PageContextWorkflowInSchema = z.object({
  status: z.string(),
  blocking_count: z.number(),
  top_blockers: z.array(z.string()).optional(),
}).passthrough();

export type PageContextWorkflowIn = z.infer<typeof PageContextWorkflowInSchema>;

export const PageContextInSchema = z.object({
  route: z.string(),
  product: z.string().nullable().optional(),
  nav_item_id: z.string().nullable().optional(),
  entity: PageContextEntityInSchema.nullable().optional(),
  workflow: PageContextWorkflowInSchema.nullable().optional(),
  edit_mode: z.boolean().nullable().optional(),
}).passthrough();

export type PageContextIn = z.infer<typeof PageContextInSchema>;

export const PageSummaryOutSchema = z.object({
  page_id: z.string(),
  slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  page_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  author_id: z.string().nullable().optional(),
  featured_image_media_id: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  template: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
}).passthrough();

export type PageSummaryOut = z.infer<typeof PageSummaryOutSchema>;

export const PageDetailOutSchema = z.object({
  page_id: z.string(),
  slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  page_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  author_id: z.string().nullable().optional(),
  featured_image_media_id: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  template: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  meta_title: z.string().nullable().optional(),
  meta_description: z.string().nullable().optional(),
  parent_page_id: z.string().nullable().optional(),
  blocks: z.array(ContentBlockOutSchema).nullable().optional(),
  ancestors: z.array(PageAncestorOutSchema).nullable().optional(),
  children: z.array(PageAncestorOutSchema).nullable().optional(),
  is_preview: z.boolean().nullable().optional(),
  categories: z.array(z.any()).nullable().optional(),
  author_name: z.string().nullable().optional(),
}).passthrough();

export type PageDetailOut = z.infer<typeof PageDetailOutSchema>;

export const PageDetailResponseSchema = z.object({
  data: PageDetailOutSchema,
}).passthrough();

export type PageDetailResponse = z.infer<typeof PageDetailResponseSchema>;

export const PageKeysResponseSchema = z.object({
  page_keys: z.array(z.string()),
}).passthrough();

export type PageKeysResponse = z.infer<typeof PageKeysResponseSchema>;

export const PageListResponseSchema = z.object({
  data: z.array(PageSummaryOutSchema),
  total: z.number(),
}).passthrough();

export type PageListResponse = z.infer<typeof PageListResponseSchema>;

const PageTreeNodeBaseSchema = z.object({
  page_id: z.string(),
  slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  template: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  depth: z.number(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type PageTreeNode = z.infer<typeof PageTreeNodeBaseSchema> & {
  children?: PageTreeNode[];
};

export const PageTreeNodeSchema: z.ZodType<PageTreeNode> = PageTreeNodeBaseSchema.extend({
  children: z.array(z.lazy(() => PageTreeNodeSchema)).optional(),
});

export const PageTreeResponseSchema = z.object({
  data: z.array(PageTreeNodeSchema),
}).passthrough();

export type PageTreeResponse = z.infer<typeof PageTreeResponseSchema>;

export const PaginationOutSchema = z.object({
  page: z.number(),
  page_size: z.number(),
  total: z.number(),
  total_pages: z.number(),
}).passthrough();

export type PaginationOut = z.infer<typeof PaginationOutSchema>;

export const PaginatedMediaResponseSchema = z.object({
  data: z.array(PublicMediaOutSchema),
  pagination: PaginationOutSchema,
}).passthrough();

export type PaginatedMediaResponse = z.infer<typeof PaginatedMediaResponseSchema>;

export const PublicObjectOutSchema = z.object({
  id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  titles: z.array(ObjectTitleOutSchema).nullable().optional(),
  description: z.string().nullable().optional(),
  date_created: z.string().nullable().optional(),
  date_created_display: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  medium: z.string().nullable().optional(),
  dimensions: z.array(DimensionOutSchema).nullable().optional(),
  credit_line: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  classifications: z.array(ClassificationOutSchema).nullable().optional(),
  created_at: z.string().nullable().optional(),
  media: z.array(ObjectMediaLinkOutSchema).nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
}).passthrough();

export type PublicObjectOut = z.infer<typeof PublicObjectOutSchema>;

export const PaginatedObjectResponseSchema = z.object({
  data: z.array(PublicObjectOutSchema),
  pagination: PaginationOutSchema,
}).passthrough();

export type PaginatedObjectResponse = z.infer<typeof PaginatedObjectResponseSchema>;

export const PaginatedResponseSchema = z.object({
  items: z.array(z.any()),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type PaginatedResponse = z.infer<typeof PaginatedResponseSchema>;

export const PasswordChangeRequiredResponseSchema = z.object({
  error: z.string().optional(),
  passwordChangeRequired: z.boolean().optional(),
  session: z.string(),
}).passthrough();

export type PasswordChangeRequiredResponse = z.infer<typeof PasswordChangeRequiredResponseSchema>;

export const PasswordResetConfirmBodySchema = z.object({
  token: z.string(),
  password: z.string(),
}).passthrough();

export type PasswordResetConfirmBody = z.infer<typeof PasswordResetConfirmBodySchema>;

export const PasswordResetRequestBodySchema = z.object({
  email: z.string(),
}).passthrough();

export type PasswordResetRequestBody = z.infer<typeof PasswordResetRequestBodySchema>;

export const PerformScanRequestSchema = z.object({
  barcode_value: z.string(),
  action_type: z.string().optional(),
  scan_location_id: z.string().nullable().optional(),
  department_id: z.string().nullable().optional(),
  device_id: z.string().nullable().optional(),
  device_name: z.string().nullable().optional(),
  campaign_id: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
}).passthrough();

export type PerformScanRequest = z.infer<typeof PerformScanRequestSchema>;

export const PermissionEntryOutSchema = z.object({
  permission_id: z.string(),
  permission_key: z.string(),
  display_name: z.string(),
  description: z.string().optional(),
  roles: z.array(z.string()).optional(),
}).passthrough();

export type PermissionEntryOut = z.infer<typeof PermissionEntryOutSchema>;

export const PermissionScopeOutSchema = z.object({
  scope: z.string(),
  permissions: z.array(PermissionEntryOutSchema).optional(),
}).passthrough();

export type PermissionScopeOut = z.infer<typeof PermissionScopeOutSchema>;

export const RoleOutSchema = z.object({
  role_id: z.string(),
  role_key: z.string(),
  display_name: z.string(),
}).passthrough();

export type RoleOut = z.infer<typeof RoleOutSchema>;

export const PermissionsMatrixResponseSchema = z.object({
  roles: z.array(RoleOutSchema).optional(),
  scopes: z.array(PermissionScopeOutSchema).optional(),
}).passthrough();

export type PermissionsMatrixResponse = z.infer<typeof PermissionsMatrixResponseSchema>;

export const PersonAuthorityDeleteResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string(),
}).passthrough();

export type PersonAuthorityDeleteResponse = z.infer<typeof PersonAuthorityDeleteResponseSchema>;

export const PersonAuthorityListResponseSchema = z.object({
  items: z.array(PersonAuthorityOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type PersonAuthorityListResponse = z.infer<typeof PersonAuthorityListResponseSchema>;

export const PersonAuthorityMergeResponseSchema = z.object({
  message: z.string(),
  source_authority: PersonAuthorityOutSchema,
  target_authority: PersonAuthorityOutSchema,
}).passthrough();

export type PersonAuthorityMergeResponse = z.infer<typeof PersonAuthorityMergeResponseSchema>;

export const PipelineDestinationOutSchema = z.object({
  destination_id: z.string(),
  connector_instance_id: z.string(),
  enabled: z.boolean(),
  parameters: z.any().optional(),
  ordering: z.number(),
}).passthrough();

export type PipelineDestinationOut = z.infer<typeof PipelineDestinationOutSchema>;

export const PipelineSourceOutSchema = z.object({
  source_id: z.string(),
  connector_instance_id: z.string(),
  enabled: z.boolean(),
  parameters: z.any().optional(),
  ordering: z.number(),
}).passthrough();

export type PipelineSourceOut = z.infer<typeof PipelineSourceOutSchema>;

export const PipelineOutSchema = z.object({
  pipeline_id: z.string(),
  organization_id: z.string(),
  name: z.string().nullable().optional(),
  sources: z.array(PipelineSourceOutSchema),
  destinations: z.array(PipelineDestinationOutSchema),
  dataset_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string(),
}).passthrough();

export type PipelineOut = z.infer<typeof PipelineOutSchema>;

export const ScheduleWithNextRunSchema = z.object({
  schedule_id: z.string(),
  pipeline_id: z.string(),
  enabled: z.boolean(),
  type: z.string(),
  every_n: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  time_hour: z.number().nullable().optional(),
  time_minute: z.number().nullable().optional(),
  timezone: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  next_run_at: z.string().nullable().optional(),
  last_job: LastJobOutSchema.nullable().optional(),
}).passthrough();

export type ScheduleWithNextRun = z.infer<typeof ScheduleWithNextRunSchema>;

export const PipelineScheduleResponseSchema = z.object({
  schedule: ScheduleWithNextRunSchema.nullable().optional(),
}).passthrough();

export type PipelineScheduleResponse = z.infer<typeof PipelineScheduleResponseSchema>;

export const PlaceAuthorityListResponseSchema = z.object({
  items: z.array(PlaceAuthorityOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type PlaceAuthorityListResponse = z.infer<typeof PlaceAuthorityListResponseSchema>;

export const PlaceGeometryUpdateResponseSchema = z.object({
  success: z.boolean(),
  place_authority_id: z.string(),
  geometry_type: z.string(),
}).passthrough();

export type PlaceGeometryUpdateResponse = z.infer<typeof PlaceGeometryUpdateResponseSchema>;

export const PlacementCreatedResponseSchema = z.object({
  placement_id: z.string(),
  message: z.string(),
}).passthrough();

export type PlacementCreatedResponse = z.infer<typeof PlacementCreatedResponseSchema>;

export const PlacementUpdateResponseSchema = z.object({
  placement_id: z.string(),
  message: z.string(),
}).passthrough();

export type PlacementUpdateResponse = z.infer<typeof PlacementUpdateResponseSchema>;

export const PlatformAuditLogOutSchema = z.object({
  audit_log_id: z.string(),
  organization_id: z.string(),
  acting_user_id: z.string(),
  target_user_id: z.string().nullable().optional(),
  action: z.string(),
  details: z.any().nullable().optional(),
  created_at: z.string(),
  organization_name: z.string().nullable().optional(),
  acting_user_email: z.string().nullable().optional(),
}).passthrough();

export type PlatformAuditLogOut = z.infer<typeof PlatformAuditLogOutSchema>;

export const PlatformAuditLogListResponseSchema = z.object({
  items: z.array(PlatformAuditLogOutSchema),
  total: z.number(),
  page: PageInfoOutSchema,
}).passthrough();

export type PlatformAuditLogListResponse = z.infer<typeof PlatformAuditLogListResponseSchema>;

export const PlatformOrganizationOutSchema = z.object({
  organization_id: z.string(),
  name: z.string(),
  slug: z.string(),
  created_at: z.string().nullable().optional(),
  user_count: z.number().optional(),
  storage: OrgStorageInfoSchema,
  apps: z.array(OrgAppInfoSchema).optional(),
  contract_end_date: z.string().nullable().optional(),
  status: z.string().optional(),
}).passthrough();

export type PlatformOrganizationOut = z.infer<typeof PlatformOrganizationOutSchema>;

export const PlatformOrganizationsResponseSchema = z.object({
  organizations: z.array(PlatformOrganizationOutSchema),
}).passthrough();

export type PlatformOrganizationsResponse = z.infer<typeof PlatformOrganizationsResponseSchema>;

export const PolygonSearchRequestSchema = z.object({
  polygon: z.array(z.array(z.number())),
  place_roles: z.array(z.string()).nullable().optional(),
}).passthrough();

export type PolygonSearchRequest = z.infer<typeof PolygonSearchRequestSchema>;

export const PolygonSearchResponseSchema = z.object({
  objects: z.array(z.any()),
  count: z.number(),
}).passthrough();

export type PolygonSearchResponse = z.infer<typeof PolygonSearchResponseSchema>;

export const PostDetailOutSchema = z.object({
  page_id: z.string(),
  slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  page_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  author_id: z.string().nullable().optional(),
  featured_image_media_id: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  template: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  meta_title: z.string().nullable().optional(),
  meta_description: z.string().nullable().optional(),
  parent_page_id: z.string().nullable().optional(),
  blocks: z.array(ContentBlockOutSchema).nullable().optional(),
  ancestors: z.array(PageAncestorOutSchema).nullable().optional(),
  children: z.array(PageAncestorOutSchema).nullable().optional(),
  is_preview: z.boolean().nullable().optional(),
  categories: z.array(z.any()).nullable().optional(),
  author_name: z.string().nullable().optional(),
}).passthrough();

export type PostDetailOut = z.infer<typeof PostDetailOutSchema>;

export const PostDetailResponseSchema = z.object({
  data: PostDetailOutSchema,
}).passthrough();

export type PostDetailResponse = z.infer<typeof PostDetailResponseSchema>;

export const PostSummaryOutSchema = z.object({
  page_id: z.string(),
  slug: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  page_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  author_id: z.string().nullable().optional(),
  featured_image_media_id: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  template: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  categories: z.array(z.any()).nullable().optional(),
  author_name: z.string().nullable().optional(),
}).passthrough();

export type PostSummaryOut = z.infer<typeof PostSummaryOutSchema>;

export const PostListResponseSchema = z.object({
  data: z.array(PostSummaryOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type PostListResponse = z.infer<typeof PostListResponseSchema>;

export const PreservationEventOutSchema = z.object({
  event_id: z.string(),
  organization_id: z.string(),
  event_type: z.string().nullable().optional(),
  media_id: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  outcome_detail: z.string().nullable().optional(),
  detail: z.any().nullable().optional(),
  agent_type: z.string().nullable().optional(),
  agent_name: z.string().nullable().optional(),
  linked_entity_type: z.string().nullable().optional(),
  linked_entity_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type PreservationEventOut = z.infer<typeof PreservationEventOutSchema>;

export const PreservationEventListResponseSchema = z.object({
  items: z.array(PreservationEventOutSchema),
  total: z.number(),
  page: OffsetPaginationPageSchema,
}).passthrough();

export type PreservationEventListResponse = z.infer<typeof PreservationEventListResponseSchema>;

export const PreservationPolicyOutSchema = z.object({
  policy_id: z.string(),
  organization_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  policy_type: z.string().nullable().optional(),
  scope: z.any().optional(),
  rules: z.any().optional(),
  is_active: z.boolean().nullable().optional(),
  priority: z.number().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  approved_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type PreservationPolicyOut = z.infer<typeof PreservationPolicyOutSchema>;

export const PreservationPolicyListResponseSchema = z.object({
  policies: z.array(PreservationPolicyOutSchema),
}).passthrough();

export type PreservationPolicyListResponse = z.infer<typeof PreservationPolicyListResponseSchema>;

export const PreviewMatchItemSchema = z.object({
  source_entity_key: z.string(),
  target_entity_key: z.string(),
  source_value: z.string().nullable().optional(),
  target_value: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
}).passthrough();

export type PreviewMatchItem = z.infer<typeof PreviewMatchItemSchema>;

export const PreviewDefinitionResponseSchema = z.object({
  items: z.array(PreviewMatchItemSchema),
  has_more: z.boolean(),
}).passthrough();

export type PreviewDefinitionResponse = z.infer<typeof PreviewDefinitionResponseSchema>;

export const PreviewPageResponseSchema = z.object({
  data: PageDetailOutSchema,
}).passthrough();

export type PreviewPageResponse = z.infer<typeof PreviewPageResponseSchema>;

export const PreviewTokenDataSchema = z.object({
  preview_token: z.string(),
  preview_expires: z.string(),
  page_id: z.string(),
}).passthrough();

export type PreviewTokenData = z.infer<typeof PreviewTokenDataSchema>;

export const PreviewTokenResponseSchema = z.object({
  data: PreviewTokenDataSchema,
}).passthrough();

export type PreviewTokenResponse = z.infer<typeof PreviewTokenResponseSchema>;

export const PriorityCountsOutSchema = z.object({
  urgent: z.number(),
  high: z.number(),
  normal: z.number(),
  low: z.number(),
}).passthrough();

export type PriorityCountsOut = z.infer<typeof PriorityCountsOutSchema>;

export const ProcedureSummaryItemSchema = z.object({
}).passthrough();

export type ProcedureSummaryItem = z.infer<typeof ProcedureSummaryItemSchema>;

export const ProcessingJobOutSchema = z.object({
  job_id: z.string(),
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  job_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  parameters: z.any().nullable().optional(),
  result: z.any().nullable().optional(),
  error_message: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ProcessingJobOut = z.infer<typeof ProcessingJobOutSchema>;

export const ProcessingJobStatsOutSchema = z.object({
  pending: z.number().optional(),
  processing: z.number().optional(),
  completed: z.number().optional(),
  failed: z.number().optional(),
}).passthrough();

export type ProcessingJobStatsOut = z.infer<typeof ProcessingJobStatsOutSchema>;

export const ProcessingJobListResponseSchema = z.object({
  jobs: z.array(ProcessingJobOutSchema),
  total: z.number(),
  stats: ProcessingJobStatsOutSchema,
}).passthrough();

export type ProcessingJobListResponse = z.infer<typeof ProcessingJobListResponseSchema>;

export const ProfileComparisonOutSchema = z.object({
  comparisons: z.record(z.string(), z.any()),
  fieldCoverage: z.record(z.string(), z.any()),
  profileCount: z.number(),
}).passthrough();

export type ProfileComparisonOut = z.infer<typeof ProfileComparisonOutSchema>;

export const ProjectionProfileResponseSchema = z.object({
  organization_id: z.string(),
  config: z.any(),
  is_default: z.boolean(),
  defaults: z.any().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type ProjectionProfileResponse = z.infer<typeof ProjectionProfileResponseSchema>;

export const ProvisionOrganizationBodySchema = z.object({
  organization: z.any(),
  applications: z.array(z.any()).optional(),
  contract: z.any().nullable().optional(),
  admin: z.any(),
  onboarding: z.any().nullable().optional(),
  with_demo_data: z.boolean().optional(),
}).passthrough();

export type ProvisionOrganizationBody = z.infer<typeof ProvisionOrganizationBodySchema>;

export const ProvisionSuccessResponseSchema = z.object({
  message: z.string(),
  job_id: z.string(),
  organization_id: z.string().nullable().optional(),
  organization_slug: z.string().nullable().optional(),
  admin_user_id: z.string().nullable().optional(),
  enabled_applications: z.array(z.string()).optional(),
  welcome_email_sent: z.boolean().optional(),
  retry_count: z.number().nullable().optional(),
}).passthrough();

export type ProvisionSuccessResponse = z.infer<typeof ProvisionSuccessResponseSchema>;

export const TimelineStepOutSchema = z.object({
  step: z.string(),
  status: z.string(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
}).passthrough();

export type TimelineStepOut = z.infer<typeof TimelineStepOutSchema>;

export const ProvisioningJobDetailResponseSchema = z.object({
  job_id: z.string(),
  status: z.string(),
  organization_id: z.string().nullable().optional(),
  organization_slug: z.string().nullable().optional(),
  admin_user_id: z.string().nullable().optional(),
  current_step: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  error_step: z.string().nullable().optional(),
  retry_count: z.number().nullable().optional(),
  max_retries: z.number().nullable().optional(),
  steps: z.any().optional(),
  timeline: z.array(TimelineStepOutSchema).optional(),
  event_log: z.array(z.any()).optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ProvisioningJobDetailResponse = z.infer<typeof ProvisioningJobDetailResponseSchema>;

export const ProvisioningJobOutSchema = z.object({
  job_id: z.string(),
  status: z.string(),
  organization_slug: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
  admin_email: z.string().nullable().optional(),
  current_step: z.string().nullable().optional(),
  error_step: z.string().nullable().optional(),
  retry_count: z.number().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ProvisioningJobOut = z.infer<typeof ProvisioningJobOutSchema>;

export const ProvisioningJobListResponseSchema = z.object({
  items: z.array(ProvisioningJobOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ProvisioningJobListResponse = z.infer<typeof ProvisioningJobListResponseSchema>;

export const ProvisioningLogOutSchema = z.object({
  id: z.string(),
  action: z.string(),
  performed_by: z.string().nullable().optional(),
  performer_name: z.string().nullable().optional(),
  performer_email: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
  organization_name: z.string().nullable().optional(),
  organization_slug: z.string().nullable().optional(),
  details: z.any().optional(),
  ip_address: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ProvisioningLogOut = z.infer<typeof ProvisioningLogOutSchema>;

export const ProvisioningLogPageSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
}).passthrough();

export type ProvisioningLogPage = z.infer<typeof ProvisioningLogPageSchema>;

export const ProvisioningLogsResponseSchema = z.object({
  items: z.array(ProvisioningLogOutSchema),
  total: z.number(),
  page: ProvisioningLogPageSchema,
}).passthrough();

export type ProvisioningLogsResponse = z.infer<typeof ProvisioningLogsResponseSchema>;

export const ProvisioningStatsResponseSchema = z.object({
  total_events: z.number(),
  events_today: z.number(),
  events_this_week: z.number(),
  by_action: z.record(z.string(), z.number()).optional(),
  by_day: z.array(DayCountSchema).optional(),
}).passthrough();

export type ProvisioningStatsResponse = z.infer<typeof ProvisioningStatsResponseSchema>;

export const PublicCollectionResponseSchema = z.object({
  collection: MediaCollectionOutSchema,
  items: z.array(CollectionItemOutSchema),
}).passthrough();

export type PublicCollectionResponse = z.infer<typeof PublicCollectionResponseSchema>;

export const PublicSharingEnabledResponseSchema = z.object({
  public_share_token: z.string(),
  public_url: z.string(),
}).passthrough();

export type PublicSharingEnabledResponse = z.infer<typeof PublicSharingEnabledResponseSchema>;

export const PublishBodySchema = z.object({
  publish_at: z.string().nullable().optional(),
}).passthrough();

export type PublishBody = z.infer<typeof PublishBodySchema>;

export const PublishByCriteriaDryRunResponseSchema = z.object({
  matched_count: z.number(),
  restricted_count: z.number().optional(),
  sample_objects: z.array(z.any()),
}).passthrough();

export type PublishByCriteriaDryRunResponse = z.infer<typeof PublishByCriteriaDryRunResponseSchema>;

export const PublishByCriteriaResponseSchema = z.object({
  updated_count: z.number(),
  is_discoverable: z.boolean(),
  skipped_restricted: z.number().optional(),
}).passthrough();

export type PublishByCriteriaResponse = z.infer<typeof PublishByCriteriaResponseSchema>;

export const PublishMediaResponseSchema = z.object({
  success: z.boolean(),
  media_id: z.string(),
  is_published: z.boolean(),
  warnings: z.array(z.string()).nullable().optional(),
}).passthrough();

export type PublishMediaResponse = z.infer<typeof PublishMediaResponseSchema>;

export const PublishScheduleOutSchema = z.object({
  schedule_id: z.string(),
  action: z.string(),
  scheduled_for: z.string(),
  criteria: z.any().optional(),
  object_ids: z.any().optional(),
  status: z.string(),
  result_count: z.number().nullable().optional(),
  error_message: z.string().nullable().optional(),
  executed_at: z.string().nullable().optional(),
  created_at: z.string(),
}).passthrough();

export type PublishScheduleOut = z.infer<typeof PublishScheduleOutSchema>;

export const QualityStatsResponseSchema = z.object({
  total_responses: z.number(),
  flagged_responses: z.number(),
  blocked_responses: z.number(),
  pass_rate: z.number(),
}).passthrough();

export type QualityStatsResponse = z.infer<typeof QualityStatsResponseSchema>;

export const RLSCheckOutSchema = z.object({
  check: z.string(),
  passed: z.boolean(),
  expected: z.any().optional(),
  actual: z.any().optional(),
  error: z.string().nullable().optional(),
  skipped: z.boolean().nullable().optional(),
  reason: z.string().nullable().optional(),
}).passthrough();

export type RLSCheckOut = z.infer<typeof RLSCheckOutSchema>;

export const RLSCanaryResponseSchema = z.object({
  status: z.string(),
  checks: z.array(RLSCheckOutSchema).optional(),
  total: z.number().optional(),
  passed: z.number().optional(),
  failed: z.number().optional(),
  reason: z.string().nullable().optional(),
}).passthrough();

export type RLSCanaryResponse = z.infer<typeof RLSCanaryResponseSchema>;

export const ReconcileResponseSchema = z.object({
  message: z.string(),
  job_id: z.string(),
  cognito_created: z.boolean().nullable().optional(),
  invitation_created: z.boolean().nullable().optional(),
  membership_created: z.boolean().nullable().optional(),
  cognito_user: z.string().nullable().optional(),
  invitation: z.string().nullable().optional(),
  actions: z.array(z.string()).nullable().optional(),
  admin_user_id: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
}).passthrough();

export type ReconcileResponse = z.infer<typeof ReconcileResponseSchema>;

export const RedirectOutSchema = z.object({
  redirect_id: z.string(),
  organization_id: z.string(),
  source_path: z.string(),
  target_path: z.string(),
  redirect_type: z.number().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
}).passthrough();

export type RedirectOut = z.infer<typeof RedirectOutSchema>;

export const RedirectDataResponseSchema = z.object({
  data: RedirectOutSchema,
}).passthrough();

export type RedirectDataResponse = z.infer<typeof RedirectDataResponseSchema>;

export const RedirectListResponseSchema = z.object({
  items: z.array(RedirectOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type RedirectListResponse = z.infer<typeof RedirectListResponseSchema>;

export const RefreshResponseSchema = z.object({
  access_token: z.string(),
  active_organization_id: z.string().nullable().optional(),
  mfa_verified: z.boolean().optional(),
}).passthrough();

export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const RegenerateResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string(),
  media_id: z.string(),
}).passthrough();

export type RegenerateResponse = z.infer<typeof RegenerateResponseSchema>;

export const RegionOutSchema = z.object({
  code: z.string(),
  name: z.string(),
  default: z.boolean().optional(),
}).passthrough();

export type RegionOut = z.infer<typeof RegionOutSchema>;

export const ReindexResponseSchema = z.object({
  success: z.boolean(),
  total: z.number(),
  indexed: z.number(),
  errors: z.number(),
  debug_all_objects: z.any().optional(),
}).passthrough();

export type ReindexResponse = z.infer<typeof ReindexResponseSchema>;

export const RelatedObjectHitOutSchema = z.object({
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  creators: z.array(z.string()).nullable().optional(),
  creation_date_display: z.string().nullable().optional(),
  classification: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  thumbnail_srcset: z.any().nullable().optional(),
}).passthrough();

export type RelatedObjectHitOut = z.infer<typeof RelatedObjectHitOutSchema>;

export const RelatedObjectsResponseSchema = z.object({
  hits: z.array(RelatedObjectHitOutSchema),
}).passthrough();

export type RelatedObjectsResponse = z.infer<typeof RelatedObjectsResponseSchema>;

export const TopEntityItemSchema = z.object({
  entity_key: z.string(),
  label: z.string(),
  relationship_count: z.number(),
}).passthrough();

export type TopEntityItem = z.infer<typeof TopEntityItemSchema>;

export const RelationshipAnalyticsResponseSchema = z.object({
  organization_id: z.string(),
  total_relationships: z.number(),
  by_type: z.array(ByTypeItemSchema),
  by_source: z.array(BySourceItemSchema),
  top_entities: z.array(TopEntityItemSchema),
  recent_relationships: z.array(RelationshipOutSchema),
}).passthrough();

export type RelationshipAnalyticsResponse = z.infer<typeof RelationshipAnalyticsResponseSchema>;

export const RelationshipCreatedResponseSchema = z.object({
  relationship: RelationshipOutSchema,
}).passthrough();

export type RelationshipCreatedResponse = z.infer<typeof RelationshipCreatedResponseSchema>;

export const RelationshipDetailResponseSchema = z.object({
  relationship: RelationshipOutSchema,
  source_entity: z.any().optional(),
  target_entity: z.any().optional(),
}).passthrough();

export type RelationshipDetailResponse = z.infer<typeof RelationshipDetailResponseSchema>;

export const RelationshipListResponseSchema = z.object({
  items: z.array(RelationshipOutSchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
}).passthrough();

export type RelationshipListResponse = z.infer<typeof RelationshipListResponseSchema>;

export const RelationshipTypeItemSchema = z.object({
  type: z.string(),
  count: z.number(),
}).passthrough();

export type RelationshipTypeItem = z.infer<typeof RelationshipTypeItemSchema>;

export const RelationshipTypesResponseSchema = z.object({
  organization_id: z.string(),
  relationship_types: z.array(RelationshipTypeItemSchema),
  total_relationships: z.number(),
}).passthrough();

export type RelationshipTypesResponse = z.infer<typeof RelationshipTypesResponseSchema>;

export const RemoveAppRoleResponseSchema = z.object({
  status: z.string(),
  user_id: z.string(),
  app_key: z.string(),
  deleted: z.boolean(),
}).passthrough();

export type RemoveAppRoleResponse = z.infer<typeof RemoveAppRoleResponseSchema>;

export const ReplaceBlocksBodySchema = z.object({
  blocks: z.array(z.any()),
}).passthrough();

export type ReplaceBlocksBody = z.infer<typeof ReplaceBlocksBodySchema>;

export const ReplicationRecordOutSchema = z.object({
  record_id: z.string(),
  organization_id: z.string(),
  media_id: z.string(),
  storage_location: z.string().nullable().optional(),
  storage_provider: z.string().nullable().optional(),
  storage_region: z.string().nullable().optional(),
  storage_key: z.string().nullable().optional(),
  copy_type: z.string().nullable().optional(),
  checksum_sha256: z.string().nullable().optional(),
  last_verified_at: z.string().nullable().optional(),
  verification_status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ReplicationRecordOut = z.infer<typeof ReplicationRecordOutSchema>;

export const ReplicationRecordListResponseSchema = z.object({
  replicas: z.array(ReplicationRecordOutSchema),
}).passthrough();

export type ReplicationRecordListResponse = z.infer<typeof ReplicationRecordListResponseSchema>;

export const ReplicationSummaryResponseSchema = z.object({
  total_media: z.number(),
  replicated_media: z.number(),
  unreplicated_media: z.number(),
  coverage_percent: z.number(),
  by_verification_status: z.record(z.string(), z.number()),
}).passthrough();

export type ReplicationSummaryResponse = z.infer<typeof ReplicationSummaryResponseSchema>;

export const ReportTemplateItemSchema = z.object({
  name: z.string(),
  size: z.number().nullable().optional(),
  last_modified: z.string().nullable().optional(),
}).passthrough();

export type ReportTemplateItem = z.infer<typeof ReportTemplateItemSchema>;

export const ReportTemplateListResponseSchema = z.object({
  templates: z.array(ReportTemplateItemSchema),
}).passthrough();

export type ReportTemplateListResponse = z.infer<typeof ReportTemplateListResponseSchema>;

export const ReportTemplateUploadedResponseSchema = z.object({
  name: z.string(),
  size: z.number(),
  message: z.string(),
}).passthrough();

export type ReportTemplateUploadedResponse = z.infer<typeof ReportTemplateUploadedResponseSchema>;

export const ReprocessResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string(),
  media_id: z.string(),
  media_type: z.string().nullable().optional(),
  features: z.record(z.string(), z.boolean()).nullable().optional(),
}).passthrough();

export type ReprocessResponse = z.infer<typeof ReprocessResponseSchema>;

export const ReproductionRequestOutSchema = z.object({
  reproduction_id: z.string(),
  organization_id: z.string(),
  request_number: z.string().nullable().optional(),
  use_request_id: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  requester_name: z.string().nullable().optional(),
  requester_institution: z.string().nullable().optional(),
  requester_email: z.string().nullable().optional(),
  requester_phone: z.string().nullable().optional(),
  reproduction_type: z.string().nullable().optional(),
  reproduction_purpose: z.string().nullable().optional(),
  intended_use: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  format_requested: z.string().nullable().optional(),
  dimensions_requested: z.string().nullable().optional(),
  rights_cleared: z.boolean().nullable().optional(),
  rights_check_date: z.string().nullable().optional(),
  rights_cleared_by: z.string().nullable().optional(),
  rights_restrictions: z.string().nullable().optional(),
  credit_line_required: z.boolean().nullable().optional(),
  object_right_id: z.string().nullable().optional(),
  fee_type: z.string().nullable().optional(),
  fee_amount: z.number().nullable().optional(),
  fee_currency: z.string().nullable().optional(),
  fee_paid: z.boolean().nullable().optional(),
  payment_date: z.string().nullable().optional(),
  master_file_reference: z.string().nullable().optional(),
  delivery_method: z.string().nullable().optional(),
  delivery_date: z.string().nullable().optional(),
  quality_approved: z.boolean().nullable().optional(),
  status: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type ReproductionRequestOut = z.infer<typeof ReproductionRequestOutSchema>;

export const ReproductionRequestListResponseSchema = z.object({
  items: z.array(ReproductionRequestOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ReproductionRequestListResponse = z.infer<typeof ReproductionRequestListResponseSchema>;

export const ResendInviteResponseSchema = z.object({
  message: z.string(),
  job_id: z.string(),
  already_active: z.boolean().nullable().optional(),
  dedupe_skipped: z.boolean().nullable().optional(),
  email_sent: z.boolean().nullable().optional(),
  token_rotated: z.boolean().nullable().optional(),
  new_expiry: z.string().nullable().optional(),
  admin_email: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
  admin_user_id: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  invitation_id: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  reused_token: z.boolean().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  cognito_created: z.boolean().nullable().optional(),
  last_sent_at: z.string().nullable().optional(),
}).passthrough();

export type ResendInviteResponse = z.infer<typeof ResendInviteResponseSchema>;

export const RestoreVersionResponseSchema = z.object({
  success: z.boolean().optional(),
  media_id: z.string(),
  restored_from_version: z.number(),
  new_version: z.number(),
}).passthrough();

export type RestoreVersionResponse = z.infer<typeof RestoreVersionResponseSchema>;

export const RetentionReportResponseSchema = z.object({
}).passthrough();

export type RetentionReportResponse = z.infer<typeof RetentionReportResponseSchema>;

export const RetryDestinationResponseSchema = z.object({
  step_id: z.string(),
  status: z.string(),
  counts: z.any().nullable().optional(),
  error: z.string().nullable().optional(),
}).passthrough();

export type RetryDestinationResponse = z.infer<typeof RetryDestinationResponseSchema>;

export const RetryJobResponseSchema = z.object({
  success: z.boolean().optional(),
  job_id: z.string(),
}).passthrough();

export type RetryJobResponse = z.infer<typeof RetryJobResponseSchema>;

export const ReverseGeocodeRequestSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
}).passthrough();

export type ReverseGeocodeRequest = z.infer<typeof ReverseGeocodeRequestSchema>;

export const ReviewMetadataResponseSchema = z.object({
  success: z.boolean(),
  media_id: z.string(),
  metadata_reviewed: z.boolean(),
  metadata_reviewed_at: z.string().nullable().optional(),
  metadata_reviewed_by: z.string().nullable().optional(),
}).passthrough();

export type ReviewMetadataResponse = z.infer<typeof ReviewMetadataResponseSchema>;

export const RevokeAPIKeyResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
}).passthrough();

export type RevokeAPIKeyResponse = z.infer<typeof RevokeAPIKeyResponseSchema>;

export const RoleLabelBodySchema = z.object({
  label: z.string(),
  app_key: z.string().nullable().optional(),
}).passthrough();

export type RoleLabelBody = z.infer<typeof RoleLabelBodySchema>;

export const RoleLabelOutSchema = z.object({
  role_key: z.string(),
  display_name: z.string(),
  default_name: z.string(),
  is_custom: z.boolean(),
}).passthrough();

export type RoleLabelOut = z.infer<typeof RoleLabelOutSchema>;

export const RoleLabelResetResponseSchema = z.object({
  status: z.string(),
  role_key: z.string(),
  display_name: z.string(),
  is_custom: z.boolean(),
  was_custom: z.boolean(),
}).passthrough();

export type RoleLabelResetResponse = z.infer<typeof RoleLabelResetResponseSchema>;

export const RoleLabelSetResponseSchema = z.object({
  status: z.string(),
  role_key: z.string(),
  display_name: z.string(),
  is_custom: z.boolean(),
}).passthrough();

export type RoleLabelSetResponse = z.infer<typeof RoleLabelSetResponseSchema>;

export const RoleLabelsResponseSchema = z.object({
  role_labels: z.array(RoleLabelOutSchema),
}).passthrough();

export type RoleLabelsResponse = z.infer<typeof RoleLabelsResponseSchema>;

export const RolePermissionBodySchema = z.object({
  role_id: z.string(),
  permission_id: z.string(),
}).passthrough();

export type RolePermissionBody = z.infer<typeof RolePermissionBodySchema>;

export const RolesResponseSchema = z.object({
  roles: z.array(RoleOutSchema),
}).passthrough();

export type RolesResponse = z.infer<typeof RolesResponseSchema>;

export const RootResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  api_base: z.string(),
  docs: z.string(),
}).passthrough();

export type RootResponse = z.infer<typeof RootResponseSchema>;

export const RunChangesResponseSchema = z.object({
  items: z.array(ChangeEventOutSchema),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
}).passthrough();

export type RunChangesResponse = z.infer<typeof RunChangesResponseSchema>;

export const RunCountsOutSchema = z.object({
  processed: z.number().optional(),
  created: z.number().optional(),
  updated: z.number().optional(),
  noop: z.number().optional(),
  failed: z.number().optional(),
  deleted: z.number().optional(),
}).passthrough();

export type RunCountsOut = z.infer<typeof RunCountsOutSchema>;

export const RunCreateResponseSchema = z.object({
  run_id: z.string(),
  pipeline_id: z.string(),
  target_connector_instance_id: z.string().nullable().optional(),
  organization_id: z.string(),
  status: z.string(),
  triggered_by: z.string().nullable().optional(),
  parameters: z.any().nullable().optional(),
  created_at: z.string(),
  warning: z.string().nullable().optional(),
}).passthrough();

export type RunCreateResponse = z.infer<typeof RunCreateResponseSchema>;

export const StepOutSchema = z.object({
  step_id: z.string(),
  pipeline_source_id: z.string().nullable().optional(),
  pipeline_destination_id: z.string().nullable().optional(),
  connector_instance_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  counts: z.any().nullable().optional(),
  error: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
}).passthrough();

export type StepOut = z.infer<typeof StepOutSchema>;

export const RunDetailOutSchema = z.object({
  run_id: z.string(),
  pipeline_id: z.string().nullable().optional(),
  target_connector_instance_id: z.string().nullable().optional(),
  status: z.string(),
  started_at: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  counts: RunCountsOutSchema,
  parameters: z.any().nullable().optional(),
  error: z.string().nullable().optional(),
  error_stage: z.string().nullable().optional(),
  error_at: z.string().nullable().optional(),
  target_url: z.string().nullable().optional(),
  sources: z.array(StepOutSchema).nullable().optional(),
  destinations: z.array(StepOutSchema).nullable().optional(),
  run_status: z.string().nullable().optional(),
}).passthrough();

export type RunDetailOut = z.infer<typeof RunDetailOutSchema>;

export const RunExecuteResponseSchema = z.object({
  run_id: z.string(),
  pipeline_id: z.string().nullable().optional(),
  target_connector_instance_id: z.string().nullable().optional(),
  status: z.string(),
  started_at: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  counts: RunCountsOutSchema,
  parameters: z.any().nullable().optional(),
  error: z.string().nullable().optional(),
  error_stage: z.string().nullable().optional(),
  error_at: z.string().nullable().optional(),
  target_url: z.string().nullable().optional(),
  sources: z.array(StepOutSchema).nullable().optional(),
  destinations: z.array(StepOutSchema).nullable().optional(),
  run_status: z.string().nullable().optional(),
}).passthrough();

export type RunExecuteResponse = z.infer<typeof RunExecuteResponseSchema>;

export const RunSummaryOutSchema = z.object({
  run_id: z.string(),
  pipeline_id: z.string().nullable().optional(),
  target_connector_instance_id: z.string().nullable().optional(),
  status: z.string(),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  counts: RunCountsOutSchema,
}).passthrough();

export type RunSummaryOut = z.infer<typeof RunSummaryOutSchema>;

export const RunListResponseSchema = z.object({
  items: z.array(RunSummaryOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type RunListResponse = z.infer<typeof RunListResponseSchema>;

export const SLAEventOutSchema = z.object({
  event_id: z.string(),
  policy_id: z.string(),
  workflow_type: z.string(),
  record_id: z.string(),
  event_type: z.string(),
  days_elapsed: z.number().nullable().optional(),
  notified_user_ids: z.any().nullable().optional(),
  triggered_at: z.string().nullable().optional(),
}).passthrough();

export type SLAEventOut = z.infer<typeof SLAEventOutSchema>;

export const SLAEventListResponseSchema = z.object({
  items: z.array(SLAEventOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type SLAEventListResponse = z.infer<typeof SLAEventListResponseSchema>;

export const SLAPolicyOutSchema = z.object({
  policy_id: z.string(),
  organization_id: z.string(),
  workflow_type: z.string(),
  name: z.string(),
  warning_days: z.number(),
  deadline_days: z.number(),
  critical_days: z.number(),
  escalate_to_role: z.string().nullable().optional(),
  notify_assignee: z.boolean(),
  enabled: z.boolean(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type SLAPolicyOut = z.infer<typeof SLAPolicyOutSchema>;

export const SLAPolicyListResponseSchema = z.object({
  policies: z.array(SLAPolicyOutSchema),
}).passthrough();

export type SLAPolicyListResponse = z.infer<typeof SLAPolicyListResponseSchema>;

export const SLAStatusSummarySchema = z.object({
  ok: z.number(),
  warning: z.number(),
  breach: z.number(),
  critical: z.number(),
}).passthrough();

export type SLAStatusSummary = z.infer<typeof SLAStatusSummarySchema>;

export const SLAStatusResponseSchema = z.object({
  records: z.array(z.any()),
  summary: SLAStatusSummarySchema,
  total: z.number(),
}).passthrough();

export type SLAStatusResponse = z.infer<typeof SLAStatusResponseSchema>;

export const SPMetadataSchema = z.object({
  entity_id: z.string(),
  acs_url: z.string(),
}).passthrough();

export type SPMetadata = z.infer<typeof SPMetadataSchema>;

export const SSOConfigBodySchema = z.object({
  provider: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  idp_entity_id: z.string().nullable().optional(),
  idp_sso_url: z.string().nullable().optional(),
  idp_certificate: z.string().nullable().optional(),
  sp_entity_id: z.string().nullable().optional(),
  client_id: z.string().nullable().optional(),
  client_secret: z.string().nullable().optional(),
  discovery_url: z.string().nullable().optional(),
  auto_provision_users: z.boolean().nullable().optional(),
  default_app_roles: z.any().nullable().optional(),
  allowed_domains: z.array(z.string()).nullable().optional(),
}).passthrough();

export type SSOConfigBody = z.infer<typeof SSOConfigBodySchema>;

export const SSOConfigOutSchema = z.object({
  id: z.string(),
  provider: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  idp_entity_id: z.string().nullable().optional(),
  idp_sso_url: z.string().nullable().optional(),
  idp_certificate: z.string().nullable().optional(),
  sp_entity_id: z.string().nullable().optional(),
  client_id: z.string().nullable().optional(),
  discovery_url: z.string().nullable().optional(),
  auto_provision_users: z.boolean().nullable().optional(),
  default_app_roles: z.any().optional(),
  allowed_domains: z.array(z.string()).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type SSOConfigOut = z.infer<typeof SSOConfigOutSchema>;

export const SSOConfigResponseSchema = z.object({
  organization_id: z.string(),
  organization_name: z.string(),
  sso_config: SSOConfigOutSchema.nullable().optional(),
  sp_metadata: SPMetadataSchema,
  available_roles: z.array(AvailableRoleOutSchema).optional(),
  enabled_apps: z.array(EnabledAppOutSchema).optional(),
}).passthrough();

export type SSOConfigResponse = z.infer<typeof SSOConfigResponseSchema>;

export const SSOTestBodySchema = z.object({
  idp_certificate: z.string().nullable().optional(),
  idp_sso_url: z.string().nullable().optional(),
}).passthrough();

export type SSOTestBody = z.infer<typeof SSOTestBodySchema>;

export const SSOTestDetailsSchema = z.object({
  certificate_valid: z.boolean().optional(),
  certificate_expires: z.string().nullable().optional(),
  certificate_error: z.string().nullable().optional(),
  idp_reachable: z.boolean().nullable().optional(),
}).passthrough();

export type SSOTestDetails = z.infer<typeof SSOTestDetailsSchema>;

export const SSOTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: SSOTestDetailsSchema,
}).passthrough();

export type SSOTestResponse = z.infer<typeof SSOTestResponseSchema>;

export const SSOUpdateResponseSchema = z.object({
  message: z.string(),
  sso_config: z.any().optional(),
}).passthrough();

export type SSOUpdateResponse = z.infer<typeof SSOUpdateResponseSchema>;

export const SaveMenuBodySchema = z.object({
  name: z.string().nullable().optional(),
  items: z.array(z.any()).optional(),
}).passthrough();

export type SaveMenuBody = z.infer<typeof SaveMenuBodySchema>;

export const SearchHealthResponseSchema = z.object({
  status: z.string(),
  message: z.string().nullable().optional(),
  cluster_name: z.string().nullable().optional(),
  number_of_nodes: z.number().nullable().optional(),
  active_shards: z.number().nullable().optional(),
  relocating_shards: z.number().nullable().optional(),
  initializing_shards: z.number().nullable().optional(),
  unassigned_shards: z.number().nullable().optional(),
}).passthrough();

export type SearchHealthResponse = z.infer<typeof SearchHealthResponseSchema>;

export const SearchHitOutSchema = z.object({
  entity_key: z.string(),
  entity_type: z.string().nullable().optional(),
  dataset_id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  object_number: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  creators: z.any().nullable().optional(),
  dates: z.any().nullable().optional(),
  score: z.number(),
  highlights: z.any().nullable().optional(),
}).passthrough();

export type SearchHitOut = z.infer<typeof SearchHitOutSchema>;

export const SearchResponseSchema = z.object({
  hits: z.array(SearchHitOutSchema),
  total: z.number(),
  facets: z.array(FacetOutSchema).nullable().optional(),
  took_ms: z.number(),
  next_offset: z.number().nullable().optional(),
}).passthrough();

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SelectSuggestionBodySchema = z.object({
  suggestion_id: z.string(),
  vocabulary: z.string().nullable().optional(),
  label: z.string(),
  description: z.string().nullable().optional(),
  external_uri: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
  applicable_fields: z.array(z.string()).nullable().optional(),
}).passthrough();

export type SelectSuggestionBody = z.infer<typeof SelectSuggestionBodySchema>;

export const ServerActionRequestSchema = z.object({
  action: z.string(),
  organization_id: z.string().nullable().optional(),
  confirm: z.boolean().nullable().optional(),
}).passthrough();

export type ServerActionRequest = z.infer<typeof ServerActionRequestSchema>;

export const ServerActionResponseSchema = z.object({
  success: z.boolean(),
  action: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.any()).nullable().optional(),
}).passthrough();

export type ServerActionResponse = z.infer<typeof ServerActionResponseSchema>;

export const ServiceStatusSchema = z.object({
  status: z.string(),
  details: z.record(z.string(), z.any()).nullable().optional(),
}).passthrough();

export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const ServerStatusResponseSchema = z.object({
  environment: z.record(z.string(), z.any()),
  feature_flags: FeatureFlagsSchema,
  services: z.record(z.string(), ServiceStatusSchema),
}).passthrough();

export type ServerStatusResponse = z.infer<typeof ServerStatusResponseSchema>;

export const SesWebhookResponseSchema = z.object({
  message: z.string().nullable().optional(),
  subscribe_url: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type SesWebhookResponse = z.infer<typeof SesWebhookResponseSchema>;

export const SetActiveOrganizationBodySchema = z.object({
  organization_id: z.string(),
}).passthrough();

export type SetActiveOrganizationBody = z.infer<typeof SetActiveOrganizationBodySchema>;

export const SetAppRoleBodySchema = z.object({
  role_id: z.string(),
}).passthrough();

export type SetAppRoleBody = z.infer<typeof SetAppRoleBodySchema>;

export const SetAppRoleResponseSchema = z.object({
  status: z.string(),
  user_id: z.string(),
  app_key: z.string(),
  role_id: z.string(),
  role_key: z.string(),
  role_display_name: z.string(),
}).passthrough();

export type SetAppRoleResponse = z.infer<typeof SetAppRoleResponseSchema>;

export const SetOverviewPreferencesBodySchema = z.object({
  visible_dataset_ids: z.array(z.string()).optional(),
  dataset_order: z.array(z.string()).optional(),
}).passthrough();

export type SetOverviewPreferencesBody = z.infer<typeof SetOverviewPreferencesBodySchema>;

export const SetPrimaryMediaResponseSchema = z.object({
  success: z.boolean(),
  media_id: z.string(),
}).passthrough();

export type SetPrimaryMediaResponse = z.infer<typeof SetPrimaryMediaResponseSchema>;

export const SettingValueResponseSchema = z.object({
  key: z.string(),
  value: z.any(),
}).passthrough();

export type SettingValueResponse = z.infer<typeof SettingValueResponseSchema>;

export const ShareCreateResponseSchema = z.object({
  share_id: z.string(),
  created: z.boolean().nullable().optional(),
  updated: z.boolean().nullable().optional(),
}).passthrough();

export type ShareCreateResponse = z.infer<typeof ShareCreateResponseSchema>;

export const ShareOutSchema = z.object({
  share_id: z.string(),
  principal_type: z.string(),
  principal_id: z.string(),
  permission: z.string(),
  created_at: z.string(),
  principal_name: z.string().nullable().optional(),
  principal_email: z.string().nullable().optional(),
}).passthrough();

export type ShareOut = z.infer<typeof ShareOutSchema>;

export const ShareListResponseSchema = z.object({
  shares: z.array(ShareOutSchema),
}).passthrough();

export type ShareListResponse = z.infer<typeof ShareListResponseSchema>;

export const ShareRemovedResponseSchema = z.object({
  success: z.boolean(),
  share_id: z.string(),
}).passthrough();

export type ShareRemovedResponse = z.infer<typeof ShareRemovedResponseSchema>;

export const ShipmentDocumentOutSchema = z.object({
  document_id: z.string(),
  shipment_id: z.string(),
  media_id: z.string(),
  document_type: z.string().nullable().optional(),
  document_type_label: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ShipmentDocumentOut = z.infer<typeof ShipmentDocumentOutSchema>;

export const ShipmentEnumsResponseSchema = z.object({
  shipment_types: z.array(EnumItemSchema),
  directions: z.array(EnumItemSchema),
  purposes: z.array(EnumItemSchema),
  statuses: z.array(EnumItemSchema),
  item_statuses: z.array(EnumItemSchema),
  shipping_methods: z.array(EnumItemSchema),
  leg_statuses: z.array(EnumItemSchema),
  document_types: z.array(EnumItemSchema),
  procedure_types: z.array(EnumItemSchema),
  crate_conditions: z.array(EnumItemSchema),
}).passthrough();

export type ShipmentEnumsResponse = z.infer<typeof ShipmentEnumsResponseSchema>;

export const ShipmentGeometryUpdateResponseSchema = z.object({
  success: z.boolean(),
  shipment_id: z.string(),
}).passthrough();

export type ShipmentGeometryUpdateResponse = z.infer<typeof ShipmentGeometryUpdateResponseSchema>;

export const ShipmentItemOutSchema = z.object({
  shipment_item_id: z.string(),
  shipment_id: z.string(),
  object_id: z.string(),
  object_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  part_id: z.string().nullable().optional(),
  crate_id: z.string().nullable().optional(),
  crate_number: z.string().nullable().optional(),
  item_number: z.string().nullable().optional(),
  insurance_value: z.string().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  status_label: z.string().nullable().optional(),
  condition_out_note: z.string().nullable().optional(),
  condition_in_note: z.string().nullable().optional(),
  special_instructions: z.string().nullable().optional(),
  packing_notes: z.string().nullable().optional(),
}).passthrough();

export type ShipmentItemOut = z.infer<typeof ShipmentItemOutSchema>;

export const ShipmentLegOutSchema = z.object({
  leg_id: z.string(),
  shipment_id: z.string(),
  leg_number: z.number().nullable().optional(),
  shipping_method: z.string().nullable().optional(),
  shipping_method_label: z.string().nullable().optional(),
  carrier_id: z.string().nullable().optional(),
  carrier_name: z.string().nullable().optional(),
  tracking_number: z.string().nullable().optional(),
  flight_vessel_number: z.string().nullable().optional(),
  departure_location: z.string().nullable().optional(),
  departure_date: z.string().nullable().optional(),
  departure_time: z.string().nullable().optional(),
  arrival_location: z.string().nullable().optional(),
  arrival_date: z.string().nullable().optional(),
  arrival_time: z.string().nullable().optional(),
  climate_controlled: z.boolean().optional(),
  status: z.string().nullable().optional(),
  status_label: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
  cost: z.string().nullable().optional(),
  cost_currency: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).passthrough();

export type ShipmentLegOut = z.infer<typeof ShipmentLegOutSchema>;

export const ShipmentOutSchema = z.object({
  shipment_id: z.string(),
  organization_id: z.string(),
  department_id: z.string().nullable().optional(),
  shipment_number: z.string().nullable().optional(),
  shipment_type: z.string().nullable().optional(),
  shipment_type_label: z.string().nullable().optional(),
  direction: z.string().nullable().optional(),
  direction_label: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  purpose_label: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  status_label: z.string().nullable().optional(),
  ship_from_contact_id: z.string().nullable().optional(),
  ship_from_contact: z.any().nullable().optional(),
  ship_from_location_id: z.string().nullable().optional(),
  ship_from_location: z.any().nullable().optional(),
  ship_from_address: z.string().nullable().optional(),
  ship_to_contact_id: z.string().nullable().optional(),
  ship_to_contact: z.any().nullable().optional(),
  ship_to_location_id: z.string().nullable().optional(),
  ship_to_location: z.any().nullable().optional(),
  ship_to_address: z.string().nullable().optional(),
  requested_date: z.string().nullable().optional(),
  estimated_dispatch_date: z.string().nullable().optional(),
  estimated_arrival_date: z.string().nullable().optional(),
  actual_dispatch_date: z.string().nullable().optional(),
  actual_arrival_date: z.string().nullable().optional(),
  insurance_value_total: z.string().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  insurance_note: z.string().nullable().optional(),
  courier_required: z.boolean().optional(),
  is_international: z.boolean().optional(),
  is_high_value: z.boolean().optional(),
  authorized_by: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  internal_notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  legs: z.array(z.any()).nullable().optional(),
  items: z.array(z.any()).nullable().optional(),
  references: z.array(z.any()).nullable().optional(),
  documents: z.array(z.any()).nullable().optional(),
  status_history: z.array(z.any()).nullable().optional(),
  item_count: z.number().nullable().optional(),
  leg_count: z.number().nullable().optional(),
  document_count: z.number().nullable().optional(),
}).passthrough();

export type ShipmentOut = z.infer<typeof ShipmentOutSchema>;

export const ShipmentSummarySchema = z.object({
  total: z.number(),
  in_transit: z.number(),
  delayed: z.number(),
  completed: z.number(),
}).passthrough();

export type ShipmentSummary = z.infer<typeof ShipmentSummarySchema>;

export const ShipmentListResponseSchema = z.object({
  items: z.array(ShipmentOutSchema),
  summary: ShipmentSummarySchema,
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ShipmentListResponse = z.infer<typeof ShipmentListResponseSchema>;

export const ShipmentReferenceOutSchema = z.object({
  reference_id: z.string(),
  shipment_id: z.string(),
  procedure_type: z.string().nullable().optional(),
  procedure_type_label: z.string().nullable().optional(),
  procedure_id: z.string(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type ShipmentReferenceOut = z.infer<typeof ShipmentReferenceOutSchema>;

export const ShipmentStatusUpdateResponseSchema = z.object({
  shipment_id: z.string(),
  old_status: z.string(),
  new_status: z.string(),
  status_label: z.string(),
}).passthrough();

export type ShipmentStatusUpdateResponse = z.infer<typeof ShipmentStatusUpdateResponseSchema>;

export const SignatureDeleteResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
}).passthrough();

export type SignatureDeleteResponse = z.infer<typeof SignatureDeleteResponseSchema>;

export const SignatureUploadResponseSchema = z.object({
  success: z.boolean(),
  signature_s3_key: z.string(),
  signature_url: z.string().nullable().optional(),
}).passthrough();

export type SignatureUploadResponse = z.infer<typeof SignatureUploadResponseSchema>;

export const SimilarEntityOutSchema = z.object({
  entity_key: z.string(),
  title: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  score: z.number(),
}).passthrough();

export type SimilarEntityOut = z.infer<typeof SimilarEntityOutSchema>;

export const SimilarMediaResponseSchema = z.object({
  media_id: z.string(),
  similar: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type SimilarMediaResponse = z.infer<typeof SimilarMediaResponseSchema>;

export const SimilarResponseSchema = z.object({
  similar: z.array(SimilarEntityOutSchema),
}).passthrough();

export type SimilarResponse = z.infer<typeof SimilarResponseSchema>;

export const SingleMediaResponseSchema = z.object({
  data: PublicMediaOutSchema,
}).passthrough();

export type SingleMediaResponse = z.infer<typeof SingleMediaResponseSchema>;

export const SingleObjectResponseSchema = z.object({
  data: PublicObjectOutSchema,
}).passthrough();

export type SingleObjectResponse = z.infer<typeof SingleObjectResponseSchema>;

export const SortOrderBodySchema = z.object({
  value_ids: z.array(z.string()),
}).passthrough();

export type SortOrderBody = z.infer<typeof SortOrderBodySchema>;

export const SortOrderResponseSchema = z.object({
  message: z.string(),
  count: z.number(),
}).passthrough();

export type SortOrderResponse = z.infer<typeof SortOrderResponseSchema>;

export const StaffChatBodySchema = z.object({
  message: z.string(),
  page_context: PageContextInSchema.nullable().optional(),
}).passthrough();

export type StaffChatBody = z.infer<typeof StaffChatBodySchema>;

export const StaffConversationListResponseSchema = z.object({
  conversations: z.array(ConversationSummaryOutSchema),
}).passthrough();

export type StaffConversationListResponse = z.infer<typeof StaffConversationListResponseSchema>;

export const StaffConversationOutSchema = z.object({
  conversation_id: z.string(),
  persona: z.string(),
  title: z.string().nullable().optional(),
  created_at: z.string(),
}).passthrough();

export type StaffConversationOut = z.infer<typeof StaffConversationOutSchema>;

export const StaffMessagesResponseSchema = z.object({
  messages: z.array(z.any()),
}).passthrough();

export type StaffMessagesResponse = z.infer<typeof StaffMessagesResponseSchema>;

export const StatusOkResponseSchema = z.object({
  status: z.string().optional(),
}).passthrough();

export type StatusOkResponse = z.infer<typeof StatusOkResponseSchema>;

export const StorageAnalyticsResponseSchema = z.object({
}).passthrough();

export type StorageAnalyticsResponse = z.infer<typeof StorageAnalyticsResponseSchema>;

export const StorageConfigDeleteResponseSchema = z.object({
  message: z.string(),
  provider: z.string().nullable().optional(),
}).passthrough();

export type StorageConfigDeleteResponse = z.infer<typeof StorageConfigDeleteResponseSchema>;

export const StorageConfigOutSchema = z.object({
  provider: z.string(),
  is_verified: z.boolean().nullable().optional(),
  verified_at: z.string().nullable().optional(),
  verification_error: z.string().nullable().optional(),
  storage_region: z.string().nullable().optional(),
  cdn_domain: z.string().nullable().optional(),
  has_cdn_signing_key: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  bucket: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  endpoint_url: z.string().nullable().optional(),
  container: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
}).passthrough();

export type StorageConfigOut = z.infer<typeof StorageConfigOutSchema>;

export const StorageConfigUpdateResponseSchema = z.object({
  provider: z.string(),
  bucket: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  verified_at: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type StorageConfigUpdateResponse = z.infer<typeof StorageConfigUpdateResponseSchema>;

export const StorageRegionsResponseSchema = z.object({
  regions: z.array(RegionOutSchema),
}).passthrough();

export type StorageRegionsResponse = z.infer<typeof StorageRegionsResponseSchema>;

export const StorageTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
}).passthrough();

export type StorageTestResponse = z.infer<typeof StorageTestResponseSchema>;

export const StylePeriodAuthorityListResponseSchema = z.object({
  items: z.array(StylePeriodAuthorityOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type StylePeriodAuthorityListResponse = z.infer<typeof StylePeriodAuthorityListResponseSchema>;

export const SubjectAuthorityListResponseSchema = z.object({
  items: z.array(SubjectAuthorityOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type SubjectAuthorityListResponse = z.infer<typeof SubjectAuthorityListResponseSchema>;

export const SuccessMessageResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string(),
}).passthrough();

export type SuccessMessageResponse = z.infer<typeof SuccessMessageResponseSchema>;

export const SyncDataOutSchema = z.object({
  media: z.array(PublicMediaOutSchema),
  objects: z.array(PublicObjectOutSchema),
}).passthrough();

export type SyncDataOut = z.infer<typeof SyncDataOutSchema>;

export const SyncMetaOutSchema = z.object({
  since: z.string(),
  until: z.string(),
  media_count: z.number(),
  object_count: z.number(),
  has_more: z.boolean(),
}).passthrough();

export type SyncMetaOut = z.infer<typeof SyncMetaOutSchema>;

export const SyncResponseSchema = z.object({
  data: SyncDataOutSchema,
  sync: SyncMetaOutSchema,
}).passthrough();

export type SyncResponse = z.infer<typeof SyncResponseSchema>;

export const SystemPromptCreateBodySchema = z.object({
  persona: z.string(),
  content: z.string(),
}).passthrough();

export type SystemPromptCreateBody = z.infer<typeof SystemPromptCreateBodySchema>;

export const SystemPromptOutSchema = z.object({
  prompt_id: z.string(),
  organization_id: z.string().nullable().optional(),
  persona: z.string(),
  content: z.string(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export type SystemPromptOut = z.infer<typeof SystemPromptOutSchema>;

export const SystemPromptListResponseSchema = z.object({
  prompts: z.array(SystemPromptOutSchema),
}).passthrough();

export type SystemPromptListResponse = z.infer<typeof SystemPromptListResponseSchema>;

export const SystemPromptUpdateBodySchema = z.object({
  content: z.string(),
}).passthrough();

export type SystemPromptUpdateBody = z.infer<typeof SystemPromptUpdateBodySchema>;

export const TagDefinitionOutSchema = z.object({
  definition_id: z.string(),
  organization_id: z.string(),
  tag_key: z.string(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  field_type: z.string().optional(),
  allow_multiple: z.boolean().optional(),
  is_required: z.boolean().optional(),
  sort_order: z.number().optional(),
  is_active: z.boolean().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  value_count: z.number().nullable().optional(),
}).passthrough();

export type TagDefinitionOut = z.infer<typeof TagDefinitionOutSchema>;

export const TagDefinitionListResponseSchema = z.object({
  definitions: z.array(TagDefinitionOutSchema),
  total: z.number(),
}).passthrough();

export type TagDefinitionListResponse = z.infer<typeof TagDefinitionListResponseSchema>;

export const TagValueOutSchema = z.object({
  value_id: z.string(),
  definition_id: z.string(),
  parent_id: z.string().nullable().optional(),
  value: z.string(),
  sort_order: z.number().optional(),
  is_active: z.boolean().optional(),
  depth: z.number().nullable().optional(),
  usage_count: z.number().nullable().optional(),
}).passthrough();

export type TagValueOut = z.infer<typeof TagValueOutSchema>;

export const TagValueListResponseSchema = z.object({
  values: z.array(TagValueOutSchema),
  total: z.number(),
}).passthrough();

export type TagValueListResponse = z.infer<typeof TagValueListResponseSchema>;

export const TagValuesResponseSchema = z.object({
  values: z.array(z.string()),
  total: z.number(),
}).passthrough();

export type TagValuesResponse = z.infer<typeof TagValuesResponseSchema>;

export const TaskCountResponseSchema = z.object({
  count: z.number(),
  urgent: z.number(),
}).passthrough();

export type TaskCountResponse = z.infer<typeof TaskCountResponseSchema>;

export const TaskEnumItemSchema = z.object({
  value: z.string(),
  label: z.string(),
}).passthrough();

export type TaskEnumItem = z.infer<typeof TaskEnumItemSchema>;

export const TaskEnumsResponseSchema = z.object({
  statuses: z.array(TaskEnumItemSchema),
  priorities: z.array(TaskEnumItemSchema),
  related_entity_types: z.array(z.string()),
}).passthrough();

export type TaskEnumsResponse = z.infer<typeof TaskEnumsResponseSchema>;

export const TaskOutSchema = z.object({
  task_id: z.string(),
  organization_id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  status: z.string(),
  status_label: z.string(),
  priority: z.string(),
  priority_label: z.string(),
  assigned_user_id: z.string().nullable().optional(),
  assigned_user_name: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_by_name: z.string().nullable().optional(),
  completed_by: z.string().nullable().optional(),
  app_context: z.string().nullable().optional(),
  related_entity_type: z.string().nullable().optional(),
  related_entity_id: z.string().nullable().optional(),
  related_entity_label: z.string().nullable().optional(),
}).passthrough();

export type TaskOut = z.infer<typeof TaskOutSchema>;

export const TaskListResponseSchema = z.object({
  items: z.array(TaskOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export const TaskWrapperResponseSchema = z.object({
  task: TaskOutSchema,
}).passthrough();

export type TaskWrapperResponse = z.infer<typeof TaskWrapperResponseSchema>;

export const TaxonomyDeleteResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string(),
}).passthrough();

export type TaxonomyDeleteResponse = z.infer<typeof TaxonomyDeleteResponseSchema>;

export const TemplateItemResponseSchema = z.object({
  item: InfoRequestTemplateItemOutSchema,
}).passthrough();

export type TemplateItemResponse = z.infer<typeof TemplateItemResponseSchema>;

export const TemplateListResponseSchema = z.object({
  templates: z.array(InfoRequestTemplateOutSchema),
}).passthrough();

export type TemplateListResponse = z.infer<typeof TemplateListResponseSchema>;

export const TemplateResponseSchema = z.object({
  template: InfoRequestTemplateOutSchema,
}).passthrough();

export type TemplateResponse = z.infer<typeof TemplateResponseSchema>;

export const TestSourceBodySchema = z.object({
  type: z.string(),
}).passthrough();

export type TestSourceBody = z.infer<typeof TestSourceBodySchema>;

export const TimezoneItemSchema = z.object({
  label: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  offset: z.string().nullable().optional(),
}).passthrough();

export type TimezoneItem = z.infer<typeof TimezoneItemSchema>;

export const TimezonesResponseSchema = z.object({
  timezones: z.array(z.any()),
}).passthrough();

export type TimezonesResponse = z.infer<typeof TimezonesResponseSchema>;

export const TourRouteResponseSchema = z.object({
  exhibition: z.any(),
  venues: z.array(z.any()),
}).passthrough();

export type TourRouteResponse = z.infer<typeof TourRouteResponseSchema>;

export const TouringVenueCreatedResponseSchema = z.object({
  exhibition_venue_id: z.string(),
  message: z.string(),
}).passthrough();

export type TouringVenueCreatedResponse = z.infer<typeof TouringVenueCreatedResponseSchema>;

export const TranscodeResponseSchema = z.object({
  success: z.boolean().optional(),
  media_id: z.string(),
  task_id: z.string(),
  message: z.string(),
}).passthrough();

export type TranscodeResponse = z.infer<typeof TranscodeResponseSchema>;

export const TranscriptResponseSchema = z.object({
  media_id: z.string(),
  transcript: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
}).passthrough();

export type TranscriptResponse = z.infer<typeof TranscriptResponseSchema>;

export const TransformImageResponseSchema = z.object({
  download_url: z.string(),
  width: z.number(),
  height: z.number(),
  file_size: z.number(),
  mime_type: z.string(),
}).passthrough();

export type TransformImageResponse = z.infer<typeof TransformImageResponseSchema>;

export const TransformerActivateResponseSchema = z.object({
  transformer_id: z.string(),
  status: z.string(),
  activated_at: z.string(),
}).passthrough();

export type TransformerActivateResponse = z.infer<typeof TransformerActivateResponseSchema>;

export const TransformerDetailOutSchema = z.object({
  transformer_id: z.string(),
  dataset_id: z.string(),
  target_format: z.string(),
  status: z.string(),
  ai_provider: z.string().nullable().optional(),
  transformer_code: z.string(),
  generated_at: z.string(),
  activated_at: z.string().nullable().optional(),
}).passthrough();

export type TransformerDetailOut = z.infer<typeof TransformerDetailOutSchema>;

export const TransformerGeneratedOutSchema = z.object({
  transformer_id: z.string(),
  dataset_id: z.string(),
  target_format: z.string(),
  status: z.string(),
  ai_provider: z.string().nullable().optional(),
  sample_count: z.number().nullable().optional(),
  code_length: z.number(),
  generated_at: z.string(),
}).passthrough();

export type TransformerGeneratedOut = z.infer<typeof TransformerGeneratedOutSchema>;

export const TransformerSummaryOutSchema = z.object({
  transformer_id: z.string(),
  target_format: z.string(),
  status: z.string(),
  ai_provider: z.string().nullable().optional(),
  sample_count: z.number().nullable().optional(),
  code_length: z.number(),
  generated_at: z.string(),
  activated_at: z.string().nullable().optional(),
}).passthrough();

export type TransformerSummaryOut = z.infer<typeof TransformerSummaryOutSchema>;

export const TransformerListResponseSchema = z.object({
  transformers: z.array(TransformerSummaryOutSchema),
}).passthrough();

export type TransformerListResponse = z.infer<typeof TransformerListResponseSchema>;

export const TransformerUpdateResponseSchema = z.object({
  transformer_id: z.string(),
  updated: z.boolean(),
}).passthrough();

export type TransformerUpdateResponse = z.infer<typeof TransformerUpdateResponseSchema>;

export const TusUploadCompleteResponseSchema = z.object({
  success: z.boolean().optional(),
  media_id: z.string(),
  status: z.string(),
}).passthrough();

export type TusUploadCompleteResponse = z.infer<typeof TusUploadCompleteResponseSchema>;

export const UlanRecordOutSchema = z.object({
  ulan_id: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
  preferred_name: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  sort_name: z.string().nullable().optional(),
  given_name: z.string().nullable().optional(),
  family_name: z.string().nullable().optional(),
  variant_names: z.any().nullable().optional(),
  birth_date_display: z.string().nullable().optional(),
  birth_place: z.string().nullable().optional(),
  death_date_display: z.string().nullable().optional(),
  death_place: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  nationalities: z.any().nullable().optional(),
  gender: z.string().nullable().optional(),
  life_roles: z.any().nullable().optional(),
  biography: z.string().nullable().optional(),
}).passthrough();

export type UlanRecordOut = z.infer<typeof UlanRecordOutSchema>;

export const UlanSearchResultItemSchema = z.object({
  id: z.string(),
  source: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  dates: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  ulan_id: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
}).passthrough();

export type UlanSearchResultItem = z.infer<typeof UlanSearchResultItemSchema>;

export const UlanSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(UlanSearchResultItemSchema),
}).passthrough();

export type UlanSearchResponse = z.infer<typeof UlanSearchResponseSchema>;

export const UnpublishMediaResponseSchema = z.object({
  success: z.boolean(),
  media_id: z.string(),
  is_published: z.boolean(),
}).passthrough();

export type UnpublishMediaResponse = z.infer<typeof UnpublishMediaResponseSchema>;

export const UnreadCountResponseSchema = z.object({
  unread_count: z.number(),
}).passthrough();

export type UnreadCountResponse = z.infer<typeof UnreadCountResponseSchema>;

export const UpdateCategoryBodySchema = z.object({
  name: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
}).passthrough();

export type UpdateCategoryBody = z.infer<typeof UpdateCategoryBodySchema>;

export const UpdateConditionReportRequestSchema = z.object({
  report_type: z.string().nullable().optional(),
  check_reason: z.string().nullable().optional(),
  completeness: z.string().nullable().optional(),
  completeness_date: z.string().nullable().optional(),
  next_check_date: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  linked_entity_type: z.string().nullable().optional(),
  linked_entity_id: z.string().nullable().optional(),
  overall_condition: z.string().nullable().optional(),
  examiner_name: z.string().nullable().optional(),
  condition_summary: z.string().nullable().optional(),
  detailed_findings: z.string().nullable().optional(),
  hazards: z.string().nullable().optional(),
  recommendations: z.string().nullable().optional(),
  conservation_needed: z.boolean().nullable().optional(),
  conservation_priority: z.string().nullable().optional(),
  handling_requirements: z.string().nullable().optional(),
  packing_requirements: z.string().nullable().optional(),
  display_restrictions: z.string().nullable().optional(),
  report_note: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  authorizer_id: z.string().nullable().optional(),
  authorization_date: z.string().nullable().optional(),
  authorization_note: z.string().nullable().optional(),
}).passthrough();

export type UpdateConditionReportRequest = z.infer<typeof UpdateConditionReportRequestSchema>;

export const UpdateConnectorInstanceBodySchema = z.object({
  organization_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  config: z.any().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type UpdateConnectorInstanceBody = z.infer<typeof UpdateConnectorInstanceBodySchema>;

export const UpdateDatasetBodySchema = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
}).passthrough();

export type UpdateDatasetBody = z.infer<typeof UpdateDatasetBodySchema>;

export const UpdateHeadquartersRequestSchema = z.object({
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
}).passthrough();

export type UpdateHeadquartersRequest = z.infer<typeof UpdateHeadquartersRequestSchema>;

export const UpdateLabelRequestSchema = z.object({
  status: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  label_format: z.string().nullable().optional(),
}).passthrough();

export type UpdateLabelRequest = z.infer<typeof UpdateLabelRequestSchema>;

export const UpdateLookupValueBodySchema = z.object({
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  icon_name: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
}).passthrough();

export type UpdateLookupValueBody = z.infer<typeof UpdateLookupValueBodySchema>;

export const UpdateObjectPersonAuthorityLinkRequestSchema = z.object({
  role: z.string().nullable().optional(),
  role_qualifier: z.string().nullable().optional(),
  attribution_certainty: z.string().nullable().optional(),
  display_order: z.number().nullable().optional(),
  display_name_override: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}).passthrough();

export type UpdateObjectPersonAuthorityLinkRequest = z.infer<typeof UpdateObjectPersonAuthorityLinkRequestSchema>;

export const UpdateOrganizationBodySchema = z.object({
  name: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
}).passthrough();

export type UpdateOrganizationBody = z.infer<typeof UpdateOrganizationBodySchema>;

export const UpdateOrganizationResponseSchema = z.object({
  message: z.string(),
  organization_id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string().nullable().optional(),
  is_demo: z.boolean().nullable().optional(),
  timezone: z.string().nullable().optional(),
}).passthrough();

export type UpdateOrganizationResponse = z.infer<typeof UpdateOrganizationResponseSchema>;

export const UpdatePageBodySchema = z.object({
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  meta_title: z.string().nullable().optional(),
  meta_description: z.string().nullable().optional(),
  template: z.string().nullable().optional(),
  featured_image_media_id: z.string().nullable().optional(),
  og_image_media_id: z.string().nullable().optional(),
  publish_at: z.string().nullable().optional(),
  parent_page_id: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  category_ids: z.array(z.string()).nullable().optional(),
}).passthrough();

export type UpdatePageBody = z.infer<typeof UpdatePageBodySchema>;

export const UpdatePersonAuthorityRequestSchema = z.object({
  preferred_name: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  constituent_type: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  culture: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  life_roles: z.array(z.string()).nullable().optional(),
  birth_date_display: z.string().nullable().optional(),
  birth_date_earliest: z.string().nullable().optional(),
  birth_date_latest: z.string().nullable().optional(),
  birth_place: z.string().nullable().optional(),
  death_date_display: z.string().nullable().optional(),
  death_date_earliest: z.string().nullable().optional(),
  death_date_latest: z.string().nullable().optional(),
  death_place: z.string().nullable().optional(),
  active_date_display: z.string().nullable().optional(),
  biography: z.string().nullable().optional(),
  ulan_id: z.string().nullable().optional(),
  viaf_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  external_uris: z.array(z.string()).nullable().optional(),
  status: z.string().nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
  cataloger_notes: z.string().nullable().optional(),
}).passthrough();

export type UpdatePersonAuthorityRequest = z.infer<typeof UpdatePersonAuthorityRequestSchema>;

export const UpdatePipelineBodySchema = z.object({
  organization_id: z.string().nullable().optional(),
  dataset_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  sources: z.array(PipelineSourceBodySchema).nullable().optional(),
  destinations: z.array(PipelineDestinationBodySchema).nullable().optional(),
}).passthrough();

export type UpdatePipelineBody = z.infer<typeof UpdatePipelineBodySchema>;

export const UpdatePlaceAuthorityRequestSchema = z.object({
  preferred_name: z.string().nullable().optional(),
  place_type: z.string().nullable().optional(),
  tgn_id: z.string().nullable().optional(),
  geonames_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  coordinates_lat: z.number().nullable().optional(),
  coordinates_lng: z.number().nullable().optional(),
  parent_place_id: z.string().nullable().optional(),
  hierarchy_path: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  variant_names: z.array(z.record(z.string(), z.any())).nullable().optional(),
}).passthrough();

export type UpdatePlaceAuthorityRequest = z.infer<typeof UpdatePlaceAuthorityRequestSchema>;

export const UpdatePlaceGeometryRequestSchema = z.object({
  type: z.enum(['point', 'polygon']),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  coordinates: z.array(z.array(z.number())).nullable().optional(),
}).passthrough();

export type UpdatePlaceGeometryRequest = z.infer<typeof UpdatePlaceGeometryRequestSchema>;

export const UpdateProfileBodySchema = z.object({
  display_name: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
}).passthrough();

export type UpdateProfileBody = z.infer<typeof UpdateProfileBodySchema>;

export const UpdateProfileResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
}).passthrough();

export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponseSchema>;

export const UpdateRedirectBodySchema = z.object({
  source_path: z.string().nullable().optional(),
  target_path: z.string().nullable().optional(),
  redirect_type: z.number().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  note: z.string().nullable().optional(),
}).passthrough();

export type UpdateRedirectBody = z.infer<typeof UpdateRedirectBodySchema>;

export const UpdateScheduleBodySchema = z.object({
  type: z.string().nullable().optional(),
  every_n: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  time_hour: z.number().nullable().optional(),
  time_minute: z.number().nullable().optional(),
  timezone: z.string().nullable().optional(),
  enabled: z.boolean().nullable().optional(),
}).passthrough();

export type UpdateScheduleBody = z.infer<typeof UpdateScheduleBodySchema>;

export const UpdateShipmentGeometryRequestSchema = z.object({
  origin: CoordinatePairSchema.nullable().optional(),
  destination: CoordinatePairSchema.nullable().optional(),
}).passthrough();

export type UpdateShipmentGeometryRequest = z.infer<typeof UpdateShipmentGeometryRequestSchema>;

export const UpdateStorageBodySchema = z.object({
  storage_limit_gb: z.number().nullable().optional(),
}).passthrough();

export type UpdateStorageBody = z.infer<typeof UpdateStorageBodySchema>;

export const UpdateStorageResponseSchema = z.object({
  message: z.string(),
  organization_id: z.string(),
  storage_limit_gb: z.number().nullable().optional(),
}).passthrough();

export type UpdateStorageResponse = z.infer<typeof UpdateStorageResponseSchema>;

export const UpdateStylePeriodAuthorityRequestSchema = z.object({
  preferred_term: z.string().nullable().optional(),
  authority_type: z.string().nullable().optional(),
  aat_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  culture: z.string().nullable().optional(),
  date_display: z.string().nullable().optional(),
  date_earliest: z.string().nullable().optional(),
  date_latest: z.string().nullable().optional(),
  geographic_scope: z.string().nullable().optional(),
  parent_authority_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type UpdateStylePeriodAuthorityRequest = z.infer<typeof UpdateStylePeriodAuthorityRequestSchema>;

export const UpdateSubjectAuthorityRequestSchema = z.object({
  preferred_term: z.string().nullable().optional(),
  subject_type: z.string().nullable().optional(),
  aat_id: z.string().nullable().optional(),
  iconclass_id: z.string().nullable().optional(),
  wikidata_id: z.string().nullable().optional(),
  broader_subject_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  variant_terms: z.array(z.record(z.string(), z.any())).nullable().optional(),
}).passthrough();

export type UpdateSubjectAuthorityRequest = z.infer<typeof UpdateSubjectAuthorityRequestSchema>;

export const UpdateTaskBodySchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  assigned_user_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  related_entity_type: z.string().nullable().optional(),
  related_entity_id: z.string().nullable().optional(),
}).passthrough();

export type UpdateTaskBody = z.infer<typeof UpdateTaskBodySchema>;

export const UpdateUserBodySchema = z.object({
  action: z.string().nullable().optional(),
  role_id: z.string().nullable().optional(),
}).passthrough();

export type UpdateUserBody = z.infer<typeof UpdateUserBodySchema>;

export const UpdateVenueGeometryRequestSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
}).passthrough();

export type UpdateVenueGeometryRequest = z.infer<typeof UpdateVenueGeometryRequestSchema>;

export const UploadFromUrlResponseSchema = z.object({
  success: z.boolean(),
  task_id: z.string(),
  message: z.string(),
}).passthrough();

export type UploadFromUrlResponse = z.infer<typeof UploadFromUrlResponseSchema>;

export const UploadVersionResponseSchema = z.object({
  success: z.boolean().optional(),
  media_id: z.string(),
  version: z.number(),
  previous_version_id: z.string(),
}).passthrough();

export type UploadVersionResponse = z.infer<typeof UploadVersionResponseSchema>;

export const UriHistoryEntryOutSchema = z.object({
  uri: z.string(),
  status: z.string(),
  created_at: z.string().nullable().optional(),
  redirect_to: z.string().nullable().optional(),
  tombstone_reason: z.string().nullable().optional(),
}).passthrough();

export type UriHistoryEntryOut = z.infer<typeof UriHistoryEntryOutSchema>;

export const UriHistoryOutSchema = z.object({
  uri: z.string(),
  entity_id: z.string(),
  entity_type: z.string(),
  history: z.array(UriHistoryEntryOutSchema),
}).passthrough();

export type UriHistoryOut = z.infer<typeof UriHistoryOutSchema>;

export const UsageEventCreatedResponseSchema = z.object({
  event_id: z.string(),
  media_id: z.string(),
  event_type: z.string(),
  logged_at: z.string().nullable().optional(),
}).passthrough();

export type UsageEventCreatedResponse = z.infer<typeof UsageEventCreatedResponseSchema>;

export const UseRequestObjectOutSchema = z.object({
  request_object_id: z.string(),
  request_id: z.string(),
  object_id: z.string(),
  object_note: z.string().nullable().optional(),
  special_handling: z.string().nullable().optional(),
  approved: z.boolean().nullable().optional(),
  approval_note: z.string().nullable().optional(),
  denial_reason: z.string().nullable().optional(),
  fulfilled: z.boolean().nullable().optional(),
  fulfillment_date: z.string().nullable().optional(),
  fulfillment_note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  object: z.any().optional(),
}).passthrough();

export type UseRequestObjectOut = z.infer<typeof UseRequestObjectOutSchema>;

export const UseRequestOutSchema = z.object({
  request_id: z.string(),
  organization_id: z.string(),
  request_number: z.string().nullable().optional(),
  request_date: z.string().nullable().optional(),
  use_type: z.string().nullable().optional(),
  use_subtype: z.string().nullable().optional(),
  use_purpose: z.string().nullable().optional(),
  use_description: z.string().nullable().optional(),
  requester_user_id: z.string().nullable().optional(),
  requester_name: z.string().nullable().optional(),
  requester_title: z.string().nullable().optional(),
  requester_institution: z.string().nullable().optional(),
  requester_address: z.string().nullable().optional(),
  requester_email: z.string().nullable().optional(),
  requester_phone: z.string().nullable().optional(),
  access_date_start: z.string().nullable().optional(),
  access_date_end: z.string().nullable().optional(),
  location_required: z.string().nullable().optional(),
  special_requirements: z.string().nullable().optional(),
  project_title: z.string().nullable().optional(),
  project_description: z.string().nullable().optional(),
  project_deadline: z.string().nullable().optional(),
  reproduction_type: z.string().nullable().optional(),
  reproduction_quantity: z.number().nullable().optional(),
  reproduction_format: z.string().nullable().optional(),
  reproduction_dimensions: z.string().nullable().optional(),
  intended_use: z.string().nullable().optional(),
  publication_details: z.string().nullable().optional(),
  credit_line: z.string().nullable().optional(),
  exhibition_title: z.string().nullable().optional(),
  exhibition_venue: z.string().nullable().optional(),
  exhibition_dates: z.string().nullable().optional(),
  exhibition_organizer: z.string().nullable().optional(),
  insurance_value: z.number().nullable().optional(),
  insurance_currency: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  reviewed_by_id: z.string().nullable().optional(),
  review_date: z.string().nullable().optional(),
  review_note: z.string().nullable().optional(),
  approved_by_id: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  approval_conditions: z.string().nullable().optional(),
  denial_reason: z.string().nullable().optional(),
  fee_quoted: z.number().nullable().optional(),
  fee_paid: z.number().nullable().optional(),
  fee_currency: z.string().nullable().optional(),
  fee_waived: z.boolean().nullable().optional(),
  fee_waiver_reason: z.string().nullable().optional(),
  fulfillment_date: z.string().nullable().optional(),
  fulfillment_note: z.string().nullable().optional(),
  knowledge_gained: z.string().nullable().optional(),
  publication_reference: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  requested_objects: z.array(UseRequestObjectOutSchema).nullable().optional(),
}).passthrough();

export type UseRequestOut = z.infer<typeof UseRequestOutSchema>;

export const UseRequestListResponseSchema = z.object({
  items: z.array(UseRequestOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type UseRequestListResponse = z.infer<typeof UseRequestListResponseSchema>;

export const UseRequestObjectsResponseSchema = z.object({
  objects: z.array(UseRequestObjectOutSchema),
}).passthrough();

export type UseRequestObjectsResponse = z.infer<typeof UseRequestObjectsResponseSchema>;

export const UserAppRolesResponseSchema = z.object({
  user_id: z.string(),
  default_role_id: z.string(),
  default_role_key: z.string(),
  default_role_display_name: z.string(),
  app_roles: z.any().optional(),
}).passthrough();

export type UserAppRolesResponse = z.infer<typeof UserAppRolesResponseSchema>;

export const UserDepartmentOutSchema = z.object({
  membership_id: z.string(),
  department_id: z.string(),
  organization_id: z.string(),
  user_id: z.string(),
  role: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
  created_at: z.string().nullable().optional(),
  department_name: z.string().nullable().optional(),
  department_code: z.string().nullable().optional(),
  department_color: z.string().nullable().optional(),
}).passthrough();

export type UserDepartmentOut = z.infer<typeof UserDepartmentOutSchema>;

export const UserEmailStatusOutSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  email_status: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type UserEmailStatusOut = z.infer<typeof UserEmailStatusOutSchema>;

export const UserEmailStatusListResponseSchema = z.object({
  items: z.array(UserEmailStatusOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type UserEmailStatusListResponse = z.infer<typeof UserEmailStatusListResponseSchema>;

export const UserEmailStatusUpdateResponseSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  email_status: z.string(),
  message: z.string(),
}).passthrough();

export type UserEmailStatusUpdateResponse = z.infer<typeof UserEmailStatusUpdateResponseSchema>;

export const UserProfileOrganizationSchema = z.object({
  organization_id: z.string(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  role_key: z.string().nullable().optional(),
  role_label: z.string().nullable().optional(),
}).passthrough();

export type UserProfileOrganization = z.infer<typeof UserProfileOrganizationSchema>;

export const UserUpdateResponseSchema = z.object({
  message: z.string(),
  membership_id: z.string(),
  user_id: z.string(),
  organization_id: z.string(),
  old_role_id: z.string().nullable().optional(),
  new_role_id: z.string().nullable().optional(),
  new_role_key: z.string().nullable().optional(),
  role_id: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();

export type UserUpdateResponse = z.infer<typeof UserUpdateResponseSchema>;

export const ValuationListResponseSchema = z.object({
  items: z.array(ValuationOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type ValuationListResponse = z.infer<typeof ValuationListResponseSchema>;

export const VenueCreatedResponseSchema = z.object({
  venue_id: z.string(),
  name: z.string(),
  message: z.string(),
}).passthrough();

export type VenueCreatedResponse = z.infer<typeof VenueCreatedResponseSchema>;

export const VenueDeleteResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
}).passthrough();

export type VenueDeleteResponse = z.infer<typeof VenueDeleteResponseSchema>;

export const VenueDetailOutSchema = z.object({
  venue_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  default_ceiling_height_cm: z.number().nullable().optional(),
  default_wall_color: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  floor_plans: z.array(FloorPlanOutSchema).optional(),
}).passthrough();

export type VenueDetailOut = z.infer<typeof VenueDetailOutSchema>;

export const VenueGeometryUpdateResponseSchema = z.object({
  success: z.boolean(),
  exhibition_venue_id: z.string(),
}).passthrough();

export type VenueGeometryUpdateResponse = z.infer<typeof VenueGeometryUpdateResponseSchema>;

export const VenueSummaryOutSchema = z.object({
  venue_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  default_ceiling_height_cm: z.number().nullable().optional(),
  default_wall_color: z.string().nullable().optional(),
  floor_plan_count: z.number().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type VenueSummaryOut = z.infer<typeof VenueSummaryOutSchema>;

export const VenueListResponseSchema = z.object({
  venues: z.array(VenueSummaryOutSchema),
}).passthrough();

export type VenueListResponse = z.infer<typeof VenueListResponseSchema>;

export const VenueUpdateResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  venue_id: z.string(),
}).passthrough();

export type VenueUpdateResponse = z.infer<typeof VenueUpdateResponseSchema>;

export const VerificationStatusResponseSchema = z.object({
  task_id: z.string(),
  status: z.string(),
  result: z.any().optional(),
  error: z.string().nullable().optional(),
}).passthrough();

export type VerificationStatusResponse = z.infer<typeof VerificationStatusResponseSchema>;

export const VerifyConstituentResponseSchema = z.object({
  success: z.boolean(),
  constituent_id: z.string(),
  is_verified: z.boolean(),
  verified_at: z.string(),
}).passthrough();

export type VerifyConstituentResponse = z.infer<typeof VerifyConstituentResponseSchema>;

export const VerifyMigrationResponseSchema = z.object({
  task_id: z.string(),
  message: z.string(),
  status: z.string(),
  sample_rate: z.number(),
}).passthrough();

export type VerifyMigrationResponse = z.infer<typeof VerifyMigrationResponseSchema>;

export const VisitorChatBodySchema = z.object({
  message: z.string(),
  session_id: z.string(),
  locale: z.string().nullable().optional(),
  input_mode: z.enum(['text', 'voice']).nullable().optional(),
}).passthrough();

export type VisitorChatBody = z.infer<typeof VisitorChatBodySchema>;

export const VisitorConversationOutSchema = z.object({
  conversation_id: z.string(),
  persona: z.string(),
  visitor_id: z.string(),
  visit_id: z.string(),
  session_id: z.string(),
}).passthrough();

export type VisitorConversationOut = z.infer<typeof VisitorConversationOutSchema>;

export const VisitorIdentifyResponseSchema = z.object({
  visitor_id: z.string(),
  email: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
}).passthrough();

export type VisitorIdentifyResponse = z.infer<typeof VisitorIdentifyResponseSchema>;

export const VisitorProfileResponseSchema = z.object({
  visitor_id: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  locale: z.string().nullable().optional(),
  session_token: z.string().nullable().optional(),
  visit_count: z.number().nullable().optional(),
  interaction_count: z.number().nullable().optional(),
  first_visit: z.string().nullable().optional(),
  last_visit: z.string().nullable().optional(),
  recent_interactions: z.array(z.any()).optional(),
}).passthrough();

export type VisitorProfileResponse = z.infer<typeof VisitorProfileResponseSchema>;

export const VisualSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type VisualSearchResponse = z.infer<typeof VisualSearchResponseSchema>;

export const VocabularyBrowseByFacetResponseSchema = z.object({
  vocabulary: z.string(),
  facet: z.string(),
  terms: z.array(VocabularyTermOutSchema),
}).passthrough();

export type VocabularyBrowseByFacetResponse = z.infer<typeof VocabularyBrowseByFacetResponseSchema>;

export const VocabularyBrowseFacetsResponseSchema = z.object({
  vocabulary: z.string(),
  facets: z.array(z.any()),
}).passthrough();

export type VocabularyBrowseFacetsResponse = z.infer<typeof VocabularyBrowseFacetsResponseSchema>;

export const VocabularyExpandResponseSchema = z.object({
  original_count: z.number(),
  expanded_count: z.number(),
  terms: z.array(z.any()),
}).passthrough();

export type VocabularyExpandResponse = z.infer<typeof VocabularyExpandResponseSchema>;

export const VocabularyImportQueuedResponseSchema = z.object({
  status: z.string(),
  task_id: z.string().nullable().optional(),
  term_id: z.string().nullable().optional(),
  vocabulary: z.string(),
  external_id: z.string(),
  preferred_term: z.string().nullable().optional(),
}).passthrough();

export type VocabularyImportQueuedResponse = z.infer<typeof VocabularyImportQueuedResponseSchema>;

export const VocabularyLookupTermOutSchema = z.object({
}).passthrough();

export type VocabularyLookupTermOut = z.infer<typeof VocabularyLookupTermOutSchema>;

export const VocabularySearchResponseSchema = z.object({
  terms: z.array(z.any()),
  total: z.number(),
}).passthrough();

export type VocabularySearchResponse = z.infer<typeof VocabularySearchResponseSchema>;

export const VocabularySyncResponseSchema = z.object({
  status: z.string(),
  task_id: z.string(),
  term_id: z.string(),
  vocabulary: z.string(),
  external_id: z.string(),
}).passthrough();

export type VocabularySyncResponse = z.infer<typeof VocabularySyncResponseSchema>;

export const VocabularyTermHierarchyResponseSchema = z.object({
}).passthrough();

export type VocabularyTermHierarchyResponse = z.infer<typeof VocabularyTermHierarchyResponseSchema>;

export const WatchStatusResponseSchema = z.object({
  watching: z.boolean(),
  watch_id: z.string().nullable().optional(),
}).passthrough();

export type WatchStatusResponse = z.infer<typeof WatchStatusResponseSchema>;

export const WatermarkTemplateOutSchema = z.object({
  template_id: z.string(),
  name: z.string(),
  watermark_type: z.string(),
  config: z.any().nullable().optional(),
  is_default: z.boolean().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type WatermarkTemplateOut = z.infer<typeof WatermarkTemplateOutSchema>;

export const WatermarkTemplateListResponseSchema = z.object({
  templates: z.array(WatermarkTemplateOutSchema),
}).passthrough();

export type WatermarkTemplateListResponse = z.infer<typeof WatermarkTemplateListResponseSchema>;

export const WorkTaskOutSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  record_type: z.string(),
  record_id: z.string(),
  record_number: z.string().nullable().optional(),
  priority: z.string(),
  due_date: z.string().nullable().optional(),
  assigned_at: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  accession_number: z.string().nullable().optional(),
  object_title: z.string().nullable().optional(),
  object_count: z.number().nullable().optional(),
  assigned_to_user_id: z.string().nullable().optional(),
  assigned_to_name: z.string().nullable().optional(),
}).passthrough();

export type WorkTaskOut = z.infer<typeof WorkTaskOutSchema>;

export const WorkTaskListResponseSchema = z.object({
  items: z.array(WorkTaskOutSchema),
  total: z.number(),
  counts: PriorityCountsOutSchema,
  page: PageInfoOutSchema,
}).passthrough();

export type WorkTaskListResponse = z.infer<typeof WorkTaskListResponseSchema>;

export const WorkspaceAddItemsResponseSchema = z.object({
  added: z.array(z.string()),
  skipped: z.array(z.string()),
  added_count: z.number(),
}).passthrough();

export type WorkspaceAddItemsResponse = z.infer<typeof WorkspaceAddItemsResponseSchema>;

export const WorkspaceCreateResponseSchema = z.object({
  workspace_id: z.string(),
  workspace_type: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.string(),
  is_owner: z.boolean(),
  is_dynamic: z.boolean().optional(),
  created_at: z.string(),
  object_count: z.number().nullable().optional(),
  asset_count: z.number().nullable().optional(),
}).passthrough();

export type WorkspaceCreateResponse = z.infer<typeof WorkspaceCreateResponseSchema>;

export const WorkspaceCreatedResponseSchema = z.object({
  workspace_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  visibility: z.string().nullable().optional(),
  asset_count: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type WorkspaceCreatedResponse = z.infer<typeof WorkspaceCreatedResponseSchema>;

export const WorkspaceDetailOutSchema = z.object({
  workspace_id: z.string(),
  workspace_type: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.string(),
  owner_user_id: z.string(),
  owner_name: z.string().nullable().optional(),
  is_owner: z.boolean(),
  permission_level: z.string(),
  is_dynamic: z.boolean().nullable().optional(),
  dynamic_query: z.any().optional(),
  search_unavailable: z.boolean().nullable().optional(),
  pinned_count: z.number().nullable().optional(),
  dynamic_count: z.number().nullable().optional(),
  items: z.array(z.any()),
  object_count: z.number().nullable().optional(),
  asset_count: z.number().nullable().optional(),
  item_count: z.number().nullable().optional(),
  cover_media_id: z.string().nullable().optional(),
  cover_thumbnail_url: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export type WorkspaceDetailOut = z.infer<typeof WorkspaceDetailOutSchema>;

export const WorkspaceItemOutSchema = z.object({
  workspace_item_id: z.string(),
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  file_size: z.number().nullable().optional(),
  note: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  added_at: z.string().nullable().optional(),
  copyright_status: z.string().nullable().optional(),
  rights_statement: z.string().nullable().optional(),
}).passthrough();

export type WorkspaceItemOut = z.infer<typeof WorkspaceItemOutSchema>;

export const WorkspacePaginationSchema = z.object({
  page: z.number(),
  page_size: z.number(),
  total: z.number(),
  total_pages: z.number(),
}).passthrough();

export type WorkspacePagination = z.infer<typeof WorkspacePaginationSchema>;

export const WorkspaceDetailResponseSchema = z.object({
  workspace_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  visibility: z.string().nullable().optional(),
  owner_user_id: z.string().nullable().optional(),
  owner_name: z.string().nullable().optional(),
  is_owner: z.boolean().nullable().optional(),
  permission_level: z.string().nullable().optional(),
  asset_count: z.number().nullable().optional(),
  cover_thumbnail_url: z.string().nullable().optional(),
  items: z.array(WorkspaceItemOutSchema),
  pagination: WorkspacePaginationSchema,
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type WorkspaceDetailResponse = z.infer<typeof WorkspaceDetailResponseSchema>;

export const WorkspaceItemListResponseSchema = z.object({
  items: z.array(z.any()),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  pinned_count: z.number().nullable().optional(),
  dynamic_count: z.number().nullable().optional(),
  search_unavailable: z.boolean().nullable().optional(),
}).passthrough();

export type WorkspaceItemListResponse = z.infer<typeof WorkspaceItemListResponseSchema>;

export const WorkspaceItemsAddedResponseSchema = z.object({
  added: z.array(z.string()),
  skipped: z.array(z.string()),
  added_count: z.number(),
}).passthrough();

export type WorkspaceItemsAddedResponse = z.infer<typeof WorkspaceItemsAddedResponseSchema>;

export const WorkspaceItemsRemovedResponseSchema = z.object({
  removed_count: z.number(),
}).passthrough();

export type WorkspaceItemsRemovedResponse = z.infer<typeof WorkspaceItemsRemovedResponseSchema>;

export const WorkspaceSummaryOutSchema = z.object({
  workspace_id: z.string(),
  workspace_type: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.string(),
  owner_user_id: z.string(),
  owner_name: z.string().nullable().optional(),
  is_owner: z.boolean(),
  is_dynamic: z.boolean().nullable().optional(),
  object_count: z.number().nullable().optional(),
  asset_count: z.number().nullable().optional(),
  item_count: z.number(),
  cover_media_id: z.string().nullable().optional(),
  cover_thumbnail_url: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).passthrough();

export type WorkspaceSummaryOut = z.infer<typeof WorkspaceSummaryOutSchema>;

export const WorkspaceListResponseSchema = z.object({
  workspaces: z.array(WorkspaceSummaryOutSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;

export const WorkspacePinResponseSchema = z.object({
  workspace_item_id: z.string(),
  object_id: z.string(),
  already_pinned: z.boolean(),
}).passthrough();

export type WorkspacePinResponse = z.infer<typeof WorkspacePinResponseSchema>;

export const WorkspaceRemoveItemsResponseSchema = z.object({
  removed_count: z.number(),
}).passthrough();

export type WorkspaceRemoveItemsResponse = z.infer<typeof WorkspaceRemoveItemsResponseSchema>;

export const WorkspaceShareCreatedResponseSchema = z.object({
  share_id: z.string(),
  permission: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type WorkspaceShareCreatedResponse = z.infer<typeof WorkspaceShareCreatedResponseSchema>;

export const WorkspaceShareOutSchema = z.object({
  share_id: z.string(),
  principal_type: z.string().nullable().optional(),
  principal_id: z.string().nullable().optional(),
  principal_name: z.string().nullable().optional(),
  principal_email: z.string().nullable().optional(),
  permission: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
}).passthrough();

export type WorkspaceShareOut = z.infer<typeof WorkspaceShareOutSchema>;

export const WorkspaceShareListResponseSchema = z.object({
  shares: z.array(WorkspaceShareOutSchema),
}).passthrough();

export type WorkspaceShareListResponse = z.infer<typeof WorkspaceShareListResponseSchema>;

export const WorkspaceUpdateResponseSchema = z.object({
  workspace_id: z.string(),
  workspace_type: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.string(),
  updated_at: z.string(),
  cover_media_id: z.string().nullable().optional(),
}).passthrough();

export type WorkspaceUpdateResponse = z.infer<typeof WorkspaceUpdateResponseSchema>;

export const WorkspaceUpdatedResponseSchema = z.object({
  workspace_id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  visibility: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough();

export type WorkspaceUpdatedResponse = z.infer<typeof WorkspaceUpdatedResponseSchema>;

