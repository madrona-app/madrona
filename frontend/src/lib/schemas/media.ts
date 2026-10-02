import { z } from 'zod';

// ============================================================================
// MEDIA SCHEMAS
// ============================================================================

export const MediaSchema = z.object({
  media_id: z.string(),
  organization_id: z.string(),
  s3_key: z.string(),
  filename: z.string(),
  file_size: z.number(),
  mime_type: z.string(),
  media_type: z.enum(['image', 'video', 'audio', 'document', 'model_3d']),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  alt_text: z.string().nullable().optional(),
  ai_alt_text: z.string().nullable().optional(),
  ai_description_long: z.string().nullable().optional(),
  ai_description_emoji: z.string().nullable().optional(),
  ai_descriptions_generated_at: z.string().nullable().optional(),
  ai_descriptions_model: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  copyright_notice: z.string().nullable().optional(),
  preview_url: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  date_created: z.string().nullable().optional(),
  copyright_status: z.string().nullable().optional(),
  rights_statement: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  folder: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
  processing_status: z.enum(['pending', 'processing', 'completed', 'failed']),
  thumbnail_s3_key: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  // DAM extended fields
  current_version: z.number().nullable().optional(),
  checksum_sha256: z.string().nullable().optional(),
  is_published: z.boolean().nullable().optional(),
  published_at: z.string().nullable().optional(),
  published_url: z.string().nullable().optional(),
  published_by: z.string().nullable().optional(),
  // Metadata review status
  metadata_reviewed: z.boolean().nullable().optional(),
  metadata_reviewed_at: z.string().nullable().optional(),
  metadata_reviewed_by: z.string().nullable().optional(),
  metadata_review_notes: z.string().nullable().optional(),
  technical_metadata: z.record(z.string(), z.any()).nullable().optional(),
  iptc_metadata: z.record(z.string(), z.any()).nullable().optional(),
  xmp_metadata: z.record(z.string(), z.any()).nullable().optional(),
  dublin_core: z.record(z.string(), z.any()).nullable().optional(),
  // AI tagging fields
  ai_processing_status: z.enum(['pending', 'processing', 'completed', 'failed', 'skipped']).nullable().optional(),
  ai_processed_at: z.string().nullable().optional(),
  ai_label_count: z.number().nullable().optional(),
  // Preservation fields
  format_name: z.string().nullable().optional(),
  pronom_puid: z.string().nullable().optional(),
  format_risk_level: z.string().nullable().optional(),
  // Download access (rights-based)
  download_access: z.enum(['direct', 'request', 'blocked']).nullable().optional(),
  // Lock status
  locked_by: z.string().nullable().optional(),
  locked_by_name: z.string().nullable().optional(),
  lock_expires_at: z.string().nullable().optional(),
  current_user_id: z.string().nullable().optional(),
});

export type Media = z.infer<typeof MediaSchema>;

// Embedded media schema - for when media is nested in other responses
// Many fields are optional since backend may return partial data in joins
export const MediaEmbeddedSchema = z.object({
  media_id: z.string(),
  organization_id: z.string().nullable().optional(),
  s3_key: z.string().nullable().optional(),
  filename: z.string(),
  file_size: z.number().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  media_type: z.enum(['image', 'video', 'audio', 'document', 'model_3d']).nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  alt_text: z.string().nullable().optional(),
  ai_alt_text: z.string().nullable().optional(),
  ai_description_long: z.string().nullable().optional(),
  ai_description_emoji: z.string().nullable().optional(),
  ai_descriptions_generated_at: z.string().nullable().optional(),
  ai_descriptions_model: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  copyright_notice: z.string().nullable().optional(),
  preview_url: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  date_created: z.string().nullable().optional(),
  copyright_status: z.string().nullable().optional(),
  rights_statement: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  folder: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
  processing_status: z.enum(['pending', 'processing', 'completed', 'failed']).nullable().optional(),
  thumbnail_s3_key: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  is_published: z.boolean().nullable().optional(),
});

export type MediaEmbedded = z.infer<typeof MediaEmbeddedSchema>;

export const MediaListResponseSchema = z.object({
  items: z.array(MediaSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_pages: z.number(),
});

export type MediaListResponse = z.infer<typeof MediaListResponseSchema>;

// DAM Search schemas
// Inline structured tag schema for search results (main schema at end of file)
const SearchStructuredTagSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const MediaSearchHitSchema = z.object({
  media_id: z.string(),
  filename: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  media_type: z.string(),
  mime_type: z.string(),
  file_size: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  creator: z.string().nullable().optional(),
  copyright_status: z.string().nullable().optional(),
  folder: z.string().nullable().optional(),
  structured_tags: z.array(SearchStructuredTagSchema).nullable().optional(),
  processing_status: z.string(),
  is_published: z.boolean(),
  created_at: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  highlights: z.record(z.string(), z.array(z.string())).nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  alt_text: z.string().nullable().optional(),
});

export type MediaSearchHit = z.infer<typeof MediaSearchHitSchema>;

export const MediaSearchFacetBucketSchema = z.object({
  key: z.string(),
  count: z.number(),
});

export const MediaSearchFacetSchema = z.object({
  field: z.string(),
  buckets: z.array(MediaSearchFacetBucketSchema),
});

export const MediaSearchResponseSchema = z.object({
  hits: z.array(MediaSearchHitSchema),
  total: z.number(),
  took_ms: z.number().nullable().optional(),
  next_offset: z.number().nullable().optional(),
  facets: z.array(MediaSearchFacetSchema).nullable().optional(),
});

export type MediaSearchResponse = z.infer<typeof MediaSearchResponseSchema>;

// Media Derivative schema
export const MediaDerivativeSchema = z.object({
  derivative_id: z.string(),
  media_id: z.string(),
  derivative_type: z.string(),
  format: z.string(),
  s3_key: z.string(),
  width: z.number(),
  height: z.number(),
  file_size: z.number(),
  quality: z.number().nullable().optional(),
  url: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type MediaDerivative = z.infer<typeof MediaDerivativeSchema>;

// Media Processing Job schema
export const MediaProcessingJobSchema = z.object({
  job_id: z.string(),
  media_id: z.string(),
  job_type: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  parameters: z.record(z.string(), z.any()).nullable().optional(),
  result: z.record(z.string(), z.any()).nullable().optional(),
  error_message: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  // Media info flattened on the job object
  filename: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
});

export type MediaProcessingJob = z.infer<typeof MediaProcessingJobSchema>;

export const ProcessingJobsResponseSchema = z.object({
  jobs: z.array(MediaProcessingJobSchema),
  stats: z.object({
    pending: z.number(),
    processing: z.number(),
    completed: z.number(),
    failed: z.number(),
  }),
  total: z.number(),
});

export type ProcessingJobsResponse = z.infer<typeof ProcessingJobsResponseSchema>;

// Processing step schema (audit trail within job.result.steps)
export const ProcessingStepSchema = z.object({
  name: z.string(),
  label: z.string(),
  status: z.enum(['started', 'completed', 'skipped', 'failed']),
  at: z.string(),
  duration_ms: z.number().nullable().optional(),
  details: z.record(z.string(), z.any()).nullable().optional(),
});

export type ProcessingStep = z.infer<typeof ProcessingStepSchema>;

// Media processing status response (per-media job history)
export const MediaProcessingStatusResponseSchema = z.object({
  media_id: z.string(),
  processing_status: z.string(),
  jobs: z.array(z.object({
    job_id: z.string(),
    job_type: z.string(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']),
    error_message: z.string().nullable().optional(),
    retry_count: z.number().nullable().optional(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    result: z.record(z.string(), z.any()).nullable().optional(),
  })),
});

export type MediaProcessingStatusResponse = z.infer<typeof MediaProcessingStatusResponseSchema>;

// Watermark Template schemas
export const WatermarkTemplateSchema = z.object({
  template_id: z.string(),
  name: z.string(),
  watermark_type: z.enum(['text', 'image']),
  config: z.object({
    // Text watermark config
    text: z.string().nullable().optional(),
    font_size: z.number().nullable().optional(),
    font_color: z.string().nullable().optional(),
    opacity: z.number().nullable().optional(),
    position: z.enum(['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right']).nullable().optional(),
    // Image watermark config
    image_s3_key: z.string().nullable().optional(),
    scale: z.number().nullable().optional(),
  }),
  is_default: z.boolean(),
  created_at: z.string().nullable().optional(),
});

export type WatermarkTemplate = z.infer<typeof WatermarkTemplateSchema>;

export const WatermarkTemplatesResponseSchema = z.object({
  templates: z.array(WatermarkTemplateSchema),
});

export type WatermarkTemplatesResponse = z.infer<typeof WatermarkTemplatesResponseSchema>;

// Metadata Template schemas
export const MetadataTemplateFieldsSchema = z.object({
  title_prefix: z.string().nullable().optional(),
  title_suffix: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  alt_text: z.string().nullable().optional(),
  creator: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  copyright_status: z.string().nullable().optional(),
  rights_statement: z.string().nullable().optional(),
  license: z.string().nullable().optional(),
  extra_metadata: z.record(z.string(), z.any()).nullable().optional(),
});

export type MetadataTemplateFields = z.infer<typeof MetadataTemplateFieldsSchema>;

export const MetadataTemplateSchema = z.object({
  template_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  template_fields: MetadataTemplateFieldsSchema.nullable().optional(),
  is_default: z.boolean(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
});

export type MetadataTemplate = z.infer<typeof MetadataTemplateSchema>;

export const MetadataTemplatesResponseSchema = z.object({
  templates: z.array(MetadataTemplateSchema),
});

export type MetadataTemplatesResponse = z.infer<typeof MetadataTemplatesResponseSchema>;

// Media Version schemas
export const MediaVersionSchema = z.object({
  version_id: z.string(),
  version_number: z.number(),
  file_size: z.number(),
  checksum_sha256: z.string().nullable().optional(),
  change_note: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type MediaVersion = z.infer<typeof MediaVersionSchema>;

export const MediaVersionsResponseSchema = z.object({
  media_id: z.string(),
  current_version: z.number(),
  versions: z.array(MediaVersionSchema),
});

export type MediaVersionsResponse = z.infer<typeof MediaVersionsResponseSchema>;

// Media Usage Report schemas
export const MediaUsageReportItemSchema = z.object({
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  event_count: z.number().nullable().optional(),
  total_events: z.number().nullable().optional(),
  views: z.number().nullable().optional(),
  downloads: z.number().nullable().optional(),
  embeds: z.number().nullable().optional(),
  api_accesses: z.number().nullable().optional(),
});

export type MediaUsageReportItem = z.infer<typeof MediaUsageReportItemSchema>;

export const MediaUsageReportSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  period_days: z.number().nullable().optional(),
  total_events: z.number(),
  by_event_type: z.object({
    views: z.number(),
    downloads: z.number(),
    embeds: z.number(),
    api_accesses: z.number(),
    shares: z.number().nullable().optional(),
  }),
  top_media: z.array(MediaUsageReportItemSchema),
}).passthrough();

export type MediaUsageReport = z.infer<typeof MediaUsageReportSchema>;

// ============================================================================
// DAM ENHANCEMENT SCHEMAS
// ============================================================================

// Media Consent
export const MediaConsentSchema = z.object({
  consent_id: z.string(),
  media_id: z.string(),
  subject_name: z.string(),
  subject_role: z.string().nullable().optional(),
  consent_type: z.enum(['photo_release', 'model_release', 'interview', 'performance', 'general', 'other']),
  consent_scope: z.enum(['internal', 'public', 'commercial', 'educational', 'all']),
  consent_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  consent_document_key: z.string().nullable().optional(),
  is_valid: z.boolean(),
  revocation_date: z.string().nullable().optional(),
  revocation_reason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type MediaConsent = z.infer<typeof MediaConsentSchema>;

export const MediaConsentListResponseSchema = z.object({
  media_id: z.string(),
  consent_records: z.array(MediaConsentSchema),
  total: z.number(),
  has_valid_consent: z.boolean(),
});

export type MediaConsentListResponse = z.infer<typeof MediaConsentListResponseSchema>;

// Media Usage Event
export const MediaUsageEventSchema = z.object({
  event_id: z.string(),
  media_id: z.string(),
  event_type: z.enum(['view', 'download', 'embed', 'api_access', 'share']),
  logged_at: z.string().nullable().optional(),
});

export type MediaUsageEvent = z.infer<typeof MediaUsageEventSchema>;

export const MediaUsageStatsSchema = z.object({
  media_id: z.string(),
  period_days: z.number(),
  total_events: z.number(),
  unique_users: z.number(),
  by_event_type: z.object({
    views: z.number().default(0),
    downloads: z.number().default(0),
    embeds: z.number().default(0),
    api_access: z.number().default(0),
    shares: z.number().default(0),
  }),
});

export type MediaUsageStats = z.infer<typeof MediaUsageStatsSchema>;

export const MediaAnalyticsReportSchema = z.object({
  organization_id: z.string(),
  period_days: z.number(),
  total_events: z.number(),
  by_event_type: z.object({
    views: z.number().default(0),
    downloads: z.number().default(0),
    embeds: z.number().default(0),
    api_access: z.number().default(0),
    shares: z.number().default(0),
  }),
  top_media: z.array(z.object({
    media_id: z.string(),
    title: z.string().nullable().optional(),
    filename: z.string().nullable().optional(),
    event_count: z.number(),
  })),
});

export type MediaAnalyticsReport = z.infer<typeof MediaAnalyticsReportSchema>;

// Expiration Alert
export const ExpirationAlertSchema = z.object({
  alert_id: z.string(),
  media_id: z.string(),
  media_title: z.string().nullable().optional(),
  media_filename: z.string().nullable().optional(),
  alert_type: z.enum(['rights', 'consent']),
  related_id: z.string(),
  expiry_date: z.string().nullable().optional(),
  days_until_expiry: z.number(),
  severity: z.enum(['warning', 'urgent', 'critical']),
  status: z.enum(['active', 'dismissed', 'resolved', 'acknowledged']),
  email_sent_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export type ExpirationAlert = z.infer<typeof ExpirationAlertSchema>;

export const ExpirationAlertsListResponseSchema = z.object({
  items: z.array(ExpirationAlertSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type ExpirationAlertsListResponse = z.infer<typeof ExpirationAlertsListResponseSchema>;

export const ExpirationAlertsSummarySchema = z.object({
  total_active: z.number(),
  by_severity: z.object({
    critical: z.number(),
    urgent: z.number(),
    warning: z.number(),
  }),
  by_type: z.object({
    rights: z.number(),
    consent: z.number(),
  }),
});

export type ExpirationAlertsSummary = z.infer<typeof ExpirationAlertsSummarySchema>;

// Media Folders
export const MediaFolderSchema = z.object({
  folder_id: z.string(),
  organization_id: z.string().nullable().optional(),
  name: z.string(),
  parent_folder_id: z.string().nullable().optional(),
  path: z.string(),
  depth: z.number(),
  sort_order: z.number(),
  media_count: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  breadcrumbs: z.array(z.object({
    folder_id: z.string(),
    name: z.string(),
  })).nullable().optional(),
});

export type MediaFolder = z.infer<typeof MediaFolderSchema>;

export const MediaFolderTreeResponseSchema = z.object({
  folders: z.array(MediaFolderSchema),
  unfiled_count: z.number().nullable().optional(),
});

export type MediaFolderTreeResponse = z.infer<typeof MediaFolderTreeResponseSchema>;

export const MediaFolderContentsSchema = z.object({
  subfolders: z.array(z.object({
    folder_id: z.string(),
    name: z.string(),
    path: z.string(),
    depth: z.number(),
  })),
  media: z.array(z.object({
    media_id: z.string(),
    filename: z.string(),
    title: z.string().nullable().optional(),
    media_type: z.string(),
    thumbnail_s3_key: z.string().nullable().optional(),
  })),
  total_media: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type MediaFolderContents = z.infer<typeof MediaFolderContentsSchema>;

export interface CreateFolderPayload {
  name: string;
  parent_folder_id?: string | null;
}

export interface UpdateFolderPayload {
  name?: string;
  parent_folder_id?: string | null;
}

export interface MoveFolderItemsPayload {
  media_ids: string[];
}

// Media Collection (Lightbox)
export const MediaCollectionSchema = z.object({
  collection_id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  cover_media_id: z.string().nullable().optional(),
  cover_url: z.string().nullable().optional(),
  visibility: z.enum(['private', 'org', 'public']),
  public_share_token: z.string().nullable().optional(),
  public_share_enabled: z.boolean(),
  public_share_expires_at: z.string().nullable().optional(),
  public_share_has_password: z.boolean().optional(),
  public_share_download_level: z.enum(['none', 'derivatives', 'originals']).optional(),
  consent_clearance_required: z.boolean(),
  consent_cleared_at: z.string().nullable().optional(),
  item_count: z.number(),
  created_by: z.string().nullable().optional(),
  created_by_name: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type MediaCollection = z.infer<typeof MediaCollectionSchema>;

export const MediaCollectionListResponseSchema = z.object({
  items: z.array(MediaCollectionSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type MediaCollectionListResponse = z.infer<typeof MediaCollectionListResponseSchema>;

export const MediaCollectionItemSchema = z.object({
  collection_id: z.string(),
  media_id: z.string(),
  sort_order: z.number(),
  notes: z.string().nullable().optional(),
  added_at: z.string().nullable().optional(),
  added_by: z.string().nullable().optional(),
  // Use lenient embedded schema since backend returns partial data in joins
  media: MediaEmbeddedSchema.nullable().optional(),
});

export type MediaCollectionItem = z.infer<typeof MediaCollectionItemSchema>;

export const MediaCollectionItemsResponseSchema = z.object({
  items: z.array(MediaCollectionItemSchema),
  total: z.number(),
});

export type MediaCollectionItemsResponse = z.infer<typeof MediaCollectionItemsResponseSchema>;

export const MediaCollectionShareSchema = z.object({
  share_id: z.string(),
  collection_id: z.string(),
  user_id: z.string(),
  user_name: z.string().nullable().optional(),
  user_email: z.string().nullable().optional(),
  principal_type: z.enum(['user', 'role']).nullable().optional(),
  principal_id: z.string().nullable().optional(),
  principal_name: z.string().nullable().optional(),
  role: z.enum(['viewer', 'editor']),
  shared_by: z.string().nullable().optional(),
  shared_at: z.string().nullable().optional(),
});

export type MediaCollectionShare = z.infer<typeof MediaCollectionShareSchema>;

export const MediaCollectionSharesResponseSchema = z.object({
  shares: z.array(MediaCollectionShareSchema),
  total: z.number(),
});

export type MediaCollectionSharesResponse = z.infer<typeof MediaCollectionSharesResponseSchema>;

// Consent Clearance Result
export const ConsentClearanceResultSchema = z.object({
  is_cleared: z.boolean(),
  media_count: z.number(),
  media_without_consent: z.array(z.object({
    media_id: z.string(),
    title: z.string().nullable().optional(),
    filename: z.string(),
  })),
  media_with_expired_consent: z.array(z.object({
    media_id: z.string(),
    title: z.string().nullable().optional(),
    filename: z.string(),
    expiry_date: z.string(),
  })),
});

export type ConsentClearanceResult = z.infer<typeof ConsentClearanceResultSchema>;

// ============================================================================
// MEDIA TAG DEFINITIONS & TAGS
// ============================================================================

export const MediaTagFieldTypeSchema = z.enum([
  'text',
  'dropdown',
  'multi_select',
  'category_tree',
  'dynamic_keywords',
  'date',
]);
export type MediaTagFieldType = z.infer<typeof MediaTagFieldTypeSchema>;

export const MediaTagDefinitionSchema = z.object({
  definition_id: z.string(),
  organization_id: z.string(),
  tag_key: z.string(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  field_type: MediaTagFieldTypeSchema.default('text'),
  allow_multiple: z.boolean().default(false),
  is_required: z.boolean(),
  sort_order: z.number(),
  is_active: z.boolean(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  value_count: z.number().nullable().optional(),
});

export type MediaTagDefinition = z.infer<typeof MediaTagDefinitionSchema>;

export const MediaTagValueSchema = z.object({
  value_id: z.string(),
  definition_id: z.string(),
  parent_id: z.string().nullable().optional(),
  value: z.string(),
  sort_order: z.number(),
  is_active: z.boolean(),
  depth: z.number().nullable().optional(),
  usage_count: z.number().nullable().optional(),
});

export type MediaTagValue = z.infer<typeof MediaTagValueSchema>;

export const MediaTagValueListResponseSchema = z.object({
  values: z.array(MediaTagValueSchema),
  total: z.number(),
});
export type MediaTagValueListResponse = z.infer<typeof MediaTagValueListResponseSchema>;

export const MediaTagDefinitionsResponseSchema = z.object({
  definitions: z.array(MediaTagDefinitionSchema),
  total: z.number(),
});

export type MediaTagDefinitionsResponse = z.infer<typeof MediaTagDefinitionsResponseSchema>;

export const MediaTagSchema = z.object({
  tag_id: z.string(),
  organization_id: z.string(),
  media_id: z.string(),
  definition_id: z.string(),
  value_id: z.string().nullable().optional(),
  tag_value: z.string(),
  tag_key: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
});

export type MediaTag = z.infer<typeof MediaTagSchema>;

export const MediaTagsResponseSchema = z.object({
  tags: z.array(MediaTagSchema),
  total: z.number(),
});

export type MediaTagsResponse = z.infer<typeof MediaTagsResponseSchema>;

export const TagValuesResponseSchema = z.object({
  values: z.array(z.string()),
  total: z.number(),
});

export type TagValuesResponse = z.infer<typeof TagValuesResponseSchema>;

// Structured tag for search results
export const StructuredTagSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export type StructuredTag = z.infer<typeof StructuredTagSchema>;

// ============================================================================
// WORKSPACES (WORKING SETS)
// ============================================================================

// Collections workspace item (objects)
export const WorkspaceItemSchema = z.object({
  workspace_item_id: z.string(),
  object_id: z.string(),
  accession_number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  added_at: z.string(),
  source: z.enum(['pinned', 'dynamic']).nullable().optional(),
});

export type WorkspaceItem = z.infer<typeof WorkspaceItemSchema>;

// DAM Workspaces
export const MediaWorkspaceItemSchema = z.object({
  workspace_item_id: z.string().nullable().optional(),
  media_id: z.string(),
  filename: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  media_type: z.string().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  file_size: z.number().nullable().optional(),
  copyright_status: z.string().nullable().optional(),
  rights_statement: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  sort_order: z.number().nullable().optional(),
  added_at: z.string().nullable().optional(),
  source: z.enum(['pinned', 'dynamic']).nullable().optional(),
});

export type MediaWorkspaceItem = z.infer<typeof MediaWorkspaceItemSchema>;

// Unified workspace schema - supports both collections and media types
export const WorkspaceSchema = z.object({
  workspace_id: z.string(),
  workspace_type: z.enum(['collections', 'media']).nullable().optional().default('collections'),
  name: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.enum(['private', 'shared', 'org']),
  owner_user_id: z.string(),
  owner_name: z.string().nullable().optional(),
  is_owner: z.boolean(),
  // Unified item count field
  item_count: z.number().nullable().optional(),
  // Collections-specific (when workspace_type='collections')
  object_count: z.number().nullable().optional(),
  // Media-specific (when workspace_type='media')
  asset_count: z.number().nullable().optional(),
  cover_media_id: z.string().nullable().optional(),
  cover_thumbnail_url: z.string().nullable().optional(),
  is_dynamic: z.boolean().nullable().optional(),
  dynamic_query: z.record(z.string(), z.any()).nullable().optional(),
  pinned_count: z.number().nullable().optional(),
  dynamic_count: z.number().nullable().optional(),
  search_unavailable: z.boolean().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

// Unified detail schema for both workspace types
export const WorkspaceDetailSchema = WorkspaceSchema.extend({
  permission_level: z.enum(['admin', 'edit', 'execute', 'view', 'none']),
  // Items array - will contain WorkspaceItem for collections or MediaWorkspaceItem for media
  items: z.array(z.union([WorkspaceItemSchema, z.lazy(() => MediaWorkspaceItemSchema)])),
});

export type WorkspaceDetail = z.infer<typeof WorkspaceDetailSchema>;

export const WorkspacesListResponseSchema = z.object({
  items: z.array(WorkspaceSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type WorkspacesListResponse = z.infer<typeof WorkspacesListResponseSchema>;

export const WorkspaceShareSchema = z.object({
  share_id: z.string(),
  principal_type: z.enum(['user', 'role', 'team']),
  principal_id: z.string(),
  principal_name: z.string().nullable().optional(),
  principal_email: z.string().nullable().optional(),
  permission: z.enum(['view', 'edit', 'execute', 'admin']),
  created_at: z.string(),
});

export type WorkspaceShare = z.infer<typeof WorkspaceShareSchema>;

export const ActiveContextSchema = z.object({
  type: z.enum(['object', 'workspace', 'media_workspace']).nullable().optional(),
  id: z.string().nullable().optional(),
  set_at: z.string().nullable().optional(),
  object: z.object({
    object_id: z.string(),
    accession_number: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
  }).nullable().optional(),
  workspace: z.object({
    workspace_id: z.string(),
    name: z.string(),
    object_count: z.number(),
  }).nullable().optional(),
});

export type ActiveContext = z.infer<typeof ActiveContextSchema>;

export const MediaWorkspaceSchema = z.object({
  workspace_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.enum(['private', 'shared', 'org']),
  cover_thumbnail_url: z.string().nullable().optional(),
  owner_user_id: z.string(),
  owner_name: z.string().nullable().optional(),
  is_owner: z.boolean(),
  asset_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type MediaWorkspace = z.infer<typeof MediaWorkspaceSchema>;

export const MediaWorkspaceDetailSchema = MediaWorkspaceSchema.extend({
  permission_level: z.enum(['admin', 'edit', 'execute', 'view', 'none']),
  items: z.array(MediaWorkspaceItemSchema),
});

export type MediaWorkspaceDetail = z.infer<typeof MediaWorkspaceDetailSchema>;

export const MediaWorkspacesListResponseSchema = z.object({
  items: z.array(MediaWorkspaceSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type MediaWorkspacesListResponse = z.infer<typeof MediaWorkspacesListResponseSchema>;

export const MediaWorkspaceShareSchema = z.object({
  share_id: z.string(),
  principal_type: z.enum(['user', 'role', 'team']),
  principal_id: z.string(),
  principal_name: z.string().nullable().optional(),
  principal_email: z.string().nullable().optional(),
  permission: z.enum(['view', 'edit', 'execute', 'admin']),
  created_at: z.string(),
});

export type MediaWorkspaceShare = z.infer<typeof MediaWorkspaceShareSchema>;

export const MediaActiveContextSchema = z.object({
  type: z.enum(['asset', 'media_workspace']).nullable().optional(),
  id: z.string().nullable().optional(),
  set_at: z.string().nullable().optional(),
  asset: z.object({
    media_id: z.string(),
    filename: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    thumbnail_url: z.string().nullable().optional(),
  }).nullable().optional(),
  workspace: z.object({
    workspace_id: z.string(),
    name: z.string(),
    asset_count: z.number(),
  }).nullable().optional(),
});

export type MediaActiveContext = z.infer<typeof MediaActiveContextSchema>;

// DAM Bulk Action Types
export interface MediaBulkActionConfig {
  key: string;
  label: string;
  description: string;
  required_params: string[];
  optional_params: string[];
}

export interface MediaBulkActionPreviewAsset {
  media_id: string;
  filename: string | null;
  title: string | null;
  thumbnail_url: string | null;
  mime_type: string | null;
  file_size: number | null;
  warnings: string[];
}

export interface MediaBulkActionPreviewResult {
  action: string;
  action_label: string;
  workspace_id: string;
  workspace_name: string;
  assets: MediaBulkActionPreviewAsset[];
  total_count: number;
  has_warnings: boolean;
}

export interface MediaBulkActionValidateResult {
  action: string;
  action_valid: boolean;
  allowed: { media_id: string; filename: string | null; title: string | null }[];
  blocked: { media_id: string; filename: string | null; title: string | null; reason: string }[];
  allowed_count: number;
  blocked_count: number;
}

export interface MediaBulkActionResult {
  media_id: string;
  filename: string | null;
  status: 'success' | 'error' | 'skipped';
  artifact_url?: string;
  message?: string;
}

export interface MediaBulkActionExecuteResult {
  action: string;
  status: 'completed' | 'failed' | 'pending' | 'running';
  run_id?: string;
  workspace_id: string;
  results?: MediaBulkActionResult[];
  total_count?: number;
  success_count?: number;
  error_count?: number;
  skipped_count?: number;
  message?: string;
}

export interface MediaBulkActionRunStatus {
  run_id: string;
  action: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_count: number;
  processed_count: number;
  success_count: number;
  error_count: number;
  artifact_url: string | null;
  results: MediaBulkActionResult[];
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}


// ============================================================================
// MEDIA FIELD INHERITANCE
// ============================================================================

export const MediaFieldInheritanceConfigSchema = z.object({
  config_id: z.string(),
  organization_id: z.string(),
  source_field: z.string(),
  display_label: z.string(),
  display_context: z.enum(['detail', 'list', 'both']),
  transform_type: z.enum(['array_first', 'array_join', 'array_concat_field']).nullable().optional(),
  transform_config: z.record(z.string(), z.any()).nullable().optional(),
  sort_order: z.number(),
  is_active: z.boolean(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type MediaFieldInheritanceConfig = z.infer<typeof MediaFieldInheritanceConfigSchema>;

export interface InheritedField {
  source_field: string;
  display_label: string;
  value: string | number | boolean | null;
}

export interface InheritedObjectFields {
  object_id: string;
  object_number: string;
  fields: InheritedField[];
}

export interface MediaInheritedFieldsResponse {
  inherited_fields: InheritedObjectFields[];
}

export interface MediaFieldInheritanceConfigListResponse {
  configs: MediaFieldInheritanceConfig[];
  total: number;
}


// ============================================================================
// MEDIA DOWNLOAD REQUESTS
// ============================================================================

export const DownloadRequestPurpose = z.enum([
  'research',
  'publication',
  'exhibition',
  'commercial',
  'educational',
  'personal',
  'other',
]);

export type DownloadRequestPurposeType = z.infer<typeof DownloadRequestPurpose>;

export const DownloadRequestStatus = z.enum([
  'submitted',
  'review',
  'approved',
  'denied',
  'fulfilled',
  'expired',
  'cancelled',
]);

export type DownloadRequestStatusType = z.infer<typeof DownloadRequestStatus>;

export const DerivativeTypeRequested = z.enum([
  'access_master',
  'large',
  'original',
  'watermarked',
]);

export type DerivativeTypeRequestedType = z.infer<typeof DerivativeTypeRequested>;

export const DownloadRequestItemStatus = z.enum([
  'pending',
  'approved',
  'denied',
]);

export type DownloadRequestItemStatusType = z.infer<typeof DownloadRequestItemStatus>;

export const MediaDownloadRequestItemSchema = z.object({
  item_id: z.string(),
  request_id: z.string(),
  media_id: z.string(),
  item_status: DownloadRequestItemStatus,
  item_note: z.string().nullable().optional(),
  downloaded: z.boolean(),
  downloaded_at: z.string().nullable().optional(),
  media: z.object({
    media_id: z.string(),
    filename: z.string(),
    title: z.string().nullable().optional(),
    media_type: z.string(),
    mime_type: z.string(),
    file_size: z.number(),
  }).nullable().optional(),
});

export type MediaDownloadRequestItem = z.infer<typeof MediaDownloadRequestItemSchema>;

export const MediaDownloadRequestSchema = z.object({
  request_id: z.string(),
  organization_id: z.string(),
  request_number: z.string(),
  collection_id: z.string().nullable().optional(),
  requester_id: z.string(),
  requester_name: z.string(),
  requester_email: z.string(),
  requester_institution: z.string().nullable().optional(),
  purpose: DownloadRequestPurpose,
  intended_use: z.string(),
  project_description: z.string().nullable().optional(),
  derivative_type_requested: DerivativeTypeRequested,
  status: DownloadRequestStatus,
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
  download_count: z.number(),
  max_downloads: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  requester: z.object({
    user_id: z.string(),
    email: z.string(),
    display_name: z.string().nullable().optional(),
  }).nullable().optional(),
  collection: z.object({
    collection_id: z.string(),
    name: z.string(),
  }).nullable().optional(),
  items: z.array(MediaDownloadRequestItemSchema).nullable().optional(),
  item_count: z.number().nullable().optional(),
  download_token: z.string().nullable().optional(),
});

export type MediaDownloadRequest = z.infer<typeof MediaDownloadRequestSchema>;

export interface MediaDownloadRequestListResponse {
  items: MediaDownloadRequest[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateDownloadRequestPayload {
  media_ids: string[];
  purpose: DownloadRequestPurposeType;
  intended_use: string;
  collection_id?: string;
  requester_institution?: string;
  project_description?: string;
  derivative_type_requested?: DerivativeTypeRequestedType;
}

export interface ApproveDownloadRequestPayload {
  conditions?: string;
  item_approvals?: Record<string, boolean>;
}

export interface DenyDownloadRequestPayload {
  reason: string;
}

export interface FulfillDownloadRequestPayload {
  expires_days?: number;
  max_downloads?: number;
  note?: string;
}

export interface DownloadLinkItem {
  item_id: string;
  media_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  s3_key: string;
  downloaded: boolean;
  download_url: string | null;
}

export interface DownloadLinksResponse {
  request_id: string;
  downloads: DownloadLinkItem[];
  total: number;
}

// ============================================================================
// MEDIA AI TAGGING SCHEMAS
// ============================================================================

// AI processing status enum
export const AIProcessingStatusEnum = z.enum([
  'pending', 'processing', 'completed', 'failed', 'skipped'
]);
export type AIProcessingStatus = z.infer<typeof AIProcessingStatusEnum>;

// AI tag type enum
export const AITagTypeEnum = z.enum([
  'label', 'text', 'face', 'color', 'celebrity', 'moderation'
]);
export type AITagType = z.infer<typeof AITagTypeEnum>;

// AI tag mapping status enum
export const AITagMappingStatusEnum = z.enum([
  'pending', 'mapped', 'rejected', 'ignored'
]);
export type AITagMappingStatus = z.infer<typeof AITagMappingStatusEnum>;

// Media AI Config schema
export const MediaAIConfigSchema = z.object({
  config_id: z.string().nullable().optional(),  // null when config hasn't been persisted yet
  organization_id: z.string(),
  // Feature toggles
  auto_tag_on_upload: z.boolean(),
  detect_labels: z.boolean(),
  detect_text: z.boolean(),
  detect_faces: z.boolean(),
  detect_celebrities: z.boolean(),
  detect_moderation: z.boolean(),
  extract_pdf_text: z.boolean(),
  // Thresholds
  min_label_confidence: z.string().or(z.number()),  // Decimal comes as string
  min_text_confidence: z.string().or(z.number()),
  max_labels_per_image: z.number(),
  visual_search_threshold: z.number().nullable().optional(),
  // Cost controls
  monthly_budget_usd: z.string().or(z.number()).nullable().optional(),
  current_month_usage: z.string().or(z.number()),
  usage_reset_date: z.string().nullable().optional(),
  // Audit
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export type MediaAIConfig = z.infer<typeof MediaAIConfigSchema>;

// AI tag mapping schema
export const MediaAITagMappingSchema = z.object({
  mapping_id: z.string(),
  organization_id: z.string(),
  ai_tag_type: AITagTypeEnum,
  ai_tag_value: z.string(),
  definition_id: z.string(),
  mapped_value: z.string(),
  auto_apply: z.boolean(),
  min_confidence: z.string().or(z.number()),
  created_at: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  // Joined fields
  definition_display_name: z.string().nullable().optional(),
});

export type MediaAITagMapping = z.infer<typeof MediaAITagMappingSchema>;

export const MediaAITagMappingsListSchema = z.object({
  mappings: z.array(MediaAITagMappingSchema).default([]),
  total: z.number().optional().default(0),
});

export type MediaAITagMappingsList = z.infer<typeof MediaAITagMappingsListSchema>;

// AI tag schema (raw AI-detected tags)
export const MediaAITagSchema = z.object({
  ai_tag_id: z.string(),
  media_id: z.string(),
  tag_type: AITagTypeEnum,
  tag_value: z.string(),
  confidence: z.string().or(z.number()),
  metadata: z.any().nullable().optional(),
  // Bounding box (nested object from backend)
  bbox: z.object({
    left: z.string().or(z.number()),
    top: z.string().or(z.number()),
    width: z.string().or(z.number()),
    height: z.string().or(z.number()),
  }).nullable().optional(),
  // Processing info
  provider: z.string(),
  model_version: z.string().nullable().optional(),
  processed_at: z.string().nullable().optional(),
  // Mapping
  mapped_to_definition_id: z.string().nullable().optional(),
  mapping_status: AITagMappingStatusEnum,
});

export type MediaAITag = z.infer<typeof MediaAITagSchema>;

export const MediaAITagsListSchema = z.object({
  media_id: z.string().nullable().optional(),
  ai_processing_status: z.string().nullable().optional(),
  ai_processed_at: z.string().nullable().optional(),
  ai_tags: z.array(MediaAITagSchema),
  total: z.number().nullable().optional(),
});

export type MediaAITagsList = z.infer<typeof MediaAITagsListSchema>;

// AI tagging stats schema
export const AITaggingStatsSchema = z.object({
  total_media: z.number(),
  pending_count: z.number(),
  processing_count: z.number(),
  completed_count: z.number(),
  failed_count: z.number(),
  skipped_count: z.number(),
  total_ai_tags: z.number(),
  tags_by_type: z.record(z.string(), z.number()),
  unmapped_tags_count: z.number(),
  monthly_usage_usd: z.string().or(z.number()),
  monthly_budget_usd: z.string().or(z.number()).nullable().optional(),
});

export type AITaggingStats = z.infer<typeof AITaggingStatsSchema>;

// ============================================================================
// MEDIA-DAM SCHEMAS
// ============================================================================

export const SimilarMediaResultSchema = z.object({
  media_id: z.string(),
  similarity: z.number(),
}).passthrough();

export const TranscriptResponseSchema = z.object({
  media_id: z.string(),
  transcript: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
}).passthrough();

export const MediaAlternativeSchema = z.object({
  alternative_id: z.string(),
  alternative_type: z.string(),
  filename: z.string(),
  sort_order: z.number(),
}).passthrough();

export const MediaAnnotationSchema = z.object({
  annotation_id: z.string(),
  target_selector: z.record(z.string(), z.unknown()),
}).passthrough();

export const DerivativeSizeConfigSchema = z.object({
  config_id: z.string(),
  organization_id: z.string().nullable().optional(),
  name: z.string(),
  label: z.string(),
  media_type: z.string().nullable().optional(),
  format: z.string(),
  quality: z.number().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  is_default: z.boolean(),
  sort_order: z.number(),
  is_system: z.boolean().optional(),
}).passthrough();

// ============================================================================
// WORKSPACES MODULE SCHEMAS (work tasks, notifications, comments)
// ============================================================================

export const WorkTaskSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  record_type: z.string(),
  record_id: z.string(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']),
}).passthrough();

export const WorkTasksResponseSchema = z.object({
  items: z.array(WorkTaskSchema),
  total: z.number(),
  counts: z.object({
    urgent: z.number(),
    high: z.number(),
    normal: z.number(),
    low: z.number(),
  }),
  page: z.object({
    limit: z.number(),
    offset: z.number(),
    has_more: z.boolean(),
  }),
}).passthrough();

export const WorkTaskCountResponseSchema = z.object({
  count: z.number(),
  urgent: z.number(),
}).passthrough();

export const NotificationSchema = z.object({
  notification_id: z.string(),
  notification_type: z.string(),
  title: z.string(),
  is_read: z.boolean(),
  created_at: z.string(),
}).passthrough();

export const NotificationsResponseSchema = z.object({
  items: z.array(NotificationSchema),
  unread_count: z.number(),
  total: z.number(),
  has_more: z.boolean(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();

export const RecordCommentSchema = z.object({
  comment_id: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  author: z.object({
    user_id: z.string(),
    display_name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  }),
  content: z.string(),
  kind: z.enum(['user', 'system']),
  created_at: z.string(),
}).passthrough();

export const RecordCommentsResponseSchema = z.object({
  items: z.array(RecordCommentSchema),
  total: z.number(),
  has_more: z.boolean(),
  limit: z.number(),
  offset: z.number(),
}).passthrough();
