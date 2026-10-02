/**
 * Media API - Digital Asset Management
 *
 * Extracted from the monolithic api.ts.
 * Covers media CRUD, collection object media, DAM library functions,
 * storage analytics, watermark templates, metadata templates, versioning,
 * publishing, consent, usage analytics, expiration alerts, collections,
 * tag definitions, tags, AI tagging, field inheritance, download requests,
 * and folders.
 */
import { apiFetch, validate, buildQueryString, API_BASE_URL, getCsrfToken } from './_utils';
import {
  MediaSchema,
  MediaListResponseSchema,
  MediaSearchResponseSchema,
  CollectionObjectMediaSchema,
  CollectionObjectMediaListSchema,
  ProcessingJobsResponseSchema,
  MediaProcessingStatusResponseSchema,
  WatermarkTemplatesResponseSchema,
  MetadataTemplatesResponseSchema,
  MetadataTemplateSchema,
  MediaVersionsResponseSchema,
  MediaConsentListResponseSchema,
  MediaUsageStatsSchema,
  MediaUsageReportSchema,
  ExpirationAlertsListResponseSchema,
  ExpirationAlertsSummarySchema,
  MediaCollectionListResponseSchema,
  MediaCollectionSchema,
  MediaCollectionItemsResponseSchema,
  MediaCollectionSharesResponseSchema,
  ConsentClearanceResultSchema,
  MediaTagDefinitionSchema,
  MediaTagDefinitionsResponseSchema,
  MediaTagSchema,
  MediaTagsResponseSchema,
  MediaTagValueSchema,
  MediaTagValueListResponseSchema,
  TagValuesResponseSchema,
  MediaAIConfigSchema,
  MediaAITagMappingSchema,
  MediaAITagMappingsListSchema,
  MediaAITagsListSchema,
  AITaggingStatsSchema,
} from '../schemas';
import type {
  Media,
  MediaListResponse,
  MediaSearchResponse,
  MediaDerivative,
  CollectionObjectMedia,
  CollectionObjectMediaList,
  ProcessingJobsResponse,
  MediaProcessingStatusResponse,
  WatermarkTemplate,
  WatermarkTemplatesResponse,
  MetadataTemplate,
  MetadataTemplateFields,
  MetadataTemplatesResponse,
  MediaVersionsResponse,
  MediaConsentListResponse,
  MediaUsageStats,
  MediaUsageReport,
  ExpirationAlertsListResponse,
  ExpirationAlertsSummary,
  MediaCollection,
  MediaCollectionListResponse,
  MediaCollectionItem,
  MediaCollectionItemsResponse,
  MediaCollectionSharesResponse,
  ConsentClearanceResult,
  MediaTagDefinition,
  MediaTagDefinitionsResponse,
  MediaTag,
  MediaTagsResponse,
  MediaTagValue,
  MediaTagValueListResponse,
  TagValuesResponse,
  MediaAIConfig,
  MediaAITag,
  MediaAITagMapping,
  MediaAITagMappingsList,
  MediaAITagsList,
  AITaggingStats,
} from '../schemas';

// ============================================================================
// MEDIA API
// ============================================================================

export interface MediaUploadParams {
  title?: string;
  description?: string;
  alt_text?: string;
  caption?: string;
  credit?: string;
  copyright_notice?: string;
  creator?: string;
  source?: string;
  copyright_status?: string;
  rights_statement?: string;
  license?: string;
  tags?: string[];
  folder?: string;
  folder_id?: string;
  dublin_core?: Record<string, string | null>;
  iptc_metadata?: Record<string, string | null>;
}

export async function uploadMedia(
  organizationId: string,
  file: File,
  params?: MediaUploadParams,
  onProgress?: (progress: number) => void
): Promise<Media> {
  const formData = new FormData();
  formData.append('file', file);

  if (params) {
    if (params.title) formData.append('title', params.title);
    if (params.description) formData.append('description', params.description);
    if (params.alt_text) formData.append('alt_text', params.alt_text);
    if (params.credit) formData.append('credit', params.credit);
    if (params.creator) formData.append('creator', params.creator);
    if (params.source) formData.append('source', params.source);
    if (params.copyright_status) formData.append('copyright_status', params.copyright_status);
    if (params.rights_statement) formData.append('rights_statement', params.rights_statement);
    if (params.license) formData.append('license', params.license);
    if (params.folder) formData.append('folder', params.folder);
    if (params.folder_id) formData.append('folder_id', params.folder_id);
    if (params.tags) formData.append('tags', JSON.stringify(params.tags));
  }

  // Use XMLHttpRequest for progress support if callback provided
  if (onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE_URL}/organizations/${organizationId}/media`);
      xhr.withCredentials = true; // Include cookies

      // Include CSRF token (double-submit pattern)
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        xhr.setRequestHeader('X-CSRF-Token', csrfToken);
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded / event.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(validate(MediaSchema, data));
          } catch {
            reject(new Error('Invalid response from server'));
          }
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new Error('Upload cancelled'));

      xhr.send(formData);
    });
  }

  // Use fetch for simple uploads without progress
  const data = await apiFetch(`/organizations/${organizationId}/media`, {
    method: 'POST',
    body: formData,
    headers: {}, // Let browser set Content-Type with boundary
  });
  return validate(MediaSchema, data);
}

export async function listMedia(
  organizationId: string,
  params?: {
    media_type?: 'image' | 'video' | 'audio' | 'document' | 'model_3d';
    folder?: string;
    folder_id?: string;
    search?: string;
    processing_status?: string;
    ai_processing_status?: string;
    is_published?: boolean;
    page?: number;
    page_size?: number;
  }
): Promise<MediaListResponse> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/media${query}`);
  return validate(MediaListResponseSchema, data);
}

export async function getMedia(
  organizationId: string,
  mediaId: string
): Promise<Media> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}`);
  return validate(MediaSchema, data);
}

export async function updateMedia(
  organizationId: string,
  mediaId: string,
  updates: Partial<MediaUploadParams & { metadata?: Record<string, any> }>
): Promise<Media> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(MediaSchema, data);
}

export async function deleteMedia(
  organizationId: string,
  mediaId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// COLLECTION OBJECT MEDIA API
// ============================================================================

export interface LinkMediaParams {
  media_id?: string;
  is_primary?: boolean;
  sort_order?: number;
  caption_override?: string;
  usage_type?: string;
}

export async function uploadObjectMedia(
  organizationId: string,
  objectId: string,
  file: File,
  params?: LinkMediaParams & MediaUploadParams
): Promise<CollectionObjectMedia> {
  const formData = new FormData();
  formData.append('file', file);

  if (params) {
    if (params.is_primary) formData.append('is_primary', 'true');
    if (params.sort_order !== undefined) formData.append('sort_order', String(params.sort_order));
    if (params.caption_override) formData.append('caption_override', params.caption_override);
    if (params.usage_type) formData.append('usage_type', params.usage_type);
    if (params.title) formData.append('title', params.title);
    if (params.description) formData.append('description', params.description);
    if (params.alt_text) formData.append('alt_text', params.alt_text);
    if (params.credit) formData.append('credit', params.credit);
    if (params.copyright_status) formData.append('copyright_status', params.copyright_status);
  }

  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/media`, {
    method: 'POST',
    body: formData,
    headers: {},
  });
  return validate(CollectionObjectMediaSchema, data);
}

export async function linkMediaToObject(
  organizationId: string,
  objectId: string,
  params: LinkMediaParams & { media_id: string }
): Promise<CollectionObjectMedia> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/media`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return validate(CollectionObjectMediaSchema, data);
}

export async function listObjectMedia(
  organizationId: string,
  objectId: string
): Promise<CollectionObjectMediaList> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/media`);
  return validate(CollectionObjectMediaListSchema, data);
}

export async function updateObjectMediaLink(
  organizationId: string,
  objectId: string,
  mediaId: string,
  updates: Partial<LinkMediaParams>
): Promise<CollectionObjectMedia> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/media/${mediaId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(CollectionObjectMediaSchema, data);
}

export async function unlinkMediaFromObject(
  organizationId: string,
  objectId: string,
  mediaId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/media/${mediaId}`, {
    method: 'DELETE',
  });
}

export async function setObjectPrimaryMedia(
  organizationId: string,
  objectId: string,
  mediaId: string
): Promise<{ success: boolean; media_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/media/${mediaId}/primary`, {
    method: 'PUT',
  });
}

// ============================================================================
// MEDIA LIBRARY API (Extended DAM functions)
// ============================================================================

export async function searchMedia(
  organizationId: string,
  params?: {
    q?: string;
    media_type?: string;
    folder?: string;
    folder_id?: string;
    copyright_status?: string;
    creator?: string;
    license?: string;
    is_published?: boolean;
    processing_status?: string;
    ai_processing_status?: string;
    date_from?: string;
    date_to?: string;
    offset?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: string;
    facets?: boolean;
    tag_filter?: string[];  // Format: "key:value"
    color_key?: string;  // Dominant color filter
    metadata_reviewed?: boolean;
  }
): Promise<MediaSearchResponse> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/media/search${query}`);
  return validate(MediaSearchResponseSchema, data);
}

export async function reindexMedia(
  organizationId: string,
  batchSize?: number
): Promise<{ success: boolean; indexed: number; total: number; message: string }> {
  const query = batchSize ? `?batch_size=${batchSize}` : '';
  return await apiFetch(`/organizations/${organizationId}/media/reindex${query}`, {
    method: 'POST',
  });
}

// Storage Analytics Types
export interface StorageTierBreakdown {
  storage_class: string;
  object_count: number;
  total_bytes: number;
  total_gb: number;
  estimated_monthly_cost: number;
}

export interface StorageCategoryBreakdown {
  category: 'originals' | 'derivatives';
  object_count: number;
  total_bytes: number;
  total_gb: number;
  tiers: StorageTierBreakdown[];
}

export interface LifecycleTransition {
  days: number;
  storage_class: string;
}

export interface LifecycleRule {
  rule_id: string;
  status: string;
  filter: string;
  transitions: LifecycleTransition[];
  noncurrent_version_expiration_days: number | null;
  abort_incomplete_multipart_days: number | null;
}

export interface StorageAnalytics {
  organization_id: string;
  total_bytes: number;
  total_gb: number;
  object_count: number;
  estimated_monthly_cost: number;
  categories: StorageCategoryBreakdown[];
  lifecycle_rules: LifecycleRule[];
  error?: string;
}

export async function getStorageAnalytics(
  organizationId: string
): Promise<StorageAnalytics> {
  return await apiFetch(`/organizations/${organizationId}/storage/analytics`);
}

export async function getMediaDerivatives(
  organizationId: string,
  mediaId: string
): Promise<{ media_id: string; processing_status: string; derivatives: MediaDerivative[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}/derivatives`);
  return data;
}

export async function regenerateMediaDerivatives(
  organizationId: string,
  mediaId: string,
  options?: { generate_webp?: boolean }
): Promise<{ success: boolean; message: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/regenerate`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

export async function reprocessMedia(
  organizationId: string,
  mediaId: string
): Promise<{ success: boolean; message: string; media_type: string; features?: Record<string, boolean> }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/reprocess`, {
    method: 'POST',
  });
}

export async function batchMediaOperation(
  organizationId: string,
  operation: 'regenerate' | 'extract_metadata' | 'delete' | 'update_metadata',
  mediaIds: string[],
  params?: { generate_webp?: boolean; metadata_updates?: Record<string, unknown> }
): Promise<{ success: boolean; operation: string; queued?: number; processed?: number }> {
  return await apiFetch(`/organizations/${organizationId}/media/batch`, {
    method: 'POST',
    body: JSON.stringify({ operation, media_ids: mediaIds, params }),
  });
}

export async function getProcessingJobs(
  organizationId: string,
  options?: {
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    job_type?: 'derivatives' | 'transcode' | 'metadata_extract';
    page?: number;
    page_size?: number;
  }
): Promise<ProcessingJobsResponse> {
  const query = buildQueryString(options || {});
  const data = await apiFetch(`/organizations/${organizationId}/media/processing-jobs${query}`);
  return validate(ProcessingJobsResponseSchema, data);
}

export async function retryProcessingJob(
  organizationId: string,
  jobId: string
): Promise<{ success: boolean; job_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/processing-jobs/${jobId}/retry`, {
    method: 'POST',
  });
}

export async function getMediaProcessingStatus(
  organizationId: string,
  mediaId: string
): Promise<MediaProcessingStatusResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}/processing-status`);
  return validate(MediaProcessingStatusResponseSchema, data);
}

// ============================================================================
// WATERMARK TEMPLATES API
// ============================================================================

export async function getWatermarkTemplates(
  organizationId: string
): Promise<WatermarkTemplatesResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/media/watermark-templates`);
  return validate(WatermarkTemplatesResponseSchema, data);
}

export async function createWatermarkTemplate(
  organizationId: string,
  template: {
    name: string;
    watermark_type: 'text' | 'image';
    config: {
      text?: string;
      font_size?: number;
      font_color?: string;
      opacity?: number;
      position?: string;
      image_s3_key?: string;
      scale?: number;
    };
    is_default?: boolean;
  }
): Promise<WatermarkTemplate> {
  return await apiFetch(`/organizations/${organizationId}/media/watermark-templates`, {
    method: 'POST',
    body: JSON.stringify(template),
  });
}

export async function deleteWatermarkTemplate(
  organizationId: string,
  templateId: string
): Promise<{ success: boolean; template_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/watermark-templates/${templateId}`, {
    method: 'DELETE',
  });
}

export async function setDefaultWatermarkTemplate(
  organizationId: string,
  templateId: string
): Promise<WatermarkTemplate> {
  // Create a new template with is_default=true to set it as default
  // The backend will unset other defaults
  return await apiFetch(`/organizations/${organizationId}/media/watermark-templates/${templateId}/set-default`, {
    method: 'POST',
  });
}

// ============================================================================
// METADATA TEMPLATE API
// ============================================================================

export async function getMetadataTemplates(
  organizationId: string,
  options?: { includeInactive?: boolean; search?: string }
): Promise<MetadataTemplatesResponse> {
  const params = new URLSearchParams();
  if (options?.includeInactive) {
    params.set('include_inactive', 'true');
  }
  if (options?.search) {
    params.set('search', options.search);
  }
  const query = params.toString();
  const url = `/organizations/${organizationId}/media/metadata-templates${query ? `?${query}` : ''}`;
  const data = await apiFetch(url);
  return validate(MetadataTemplatesResponseSchema, data);
}

export async function getMetadataTemplate(
  organizationId: string,
  templateId: string
): Promise<MetadataTemplate> {
  const data = await apiFetch(`/organizations/${organizationId}/media/metadata-templates/${templateId}`);
  return validate(MetadataTemplateSchema, data);
}

export async function createMetadataTemplate(
  organizationId: string,
  template: {
    name: string;
    description?: string | null;
    template_fields?: MetadataTemplateFields | null;
    is_default?: boolean;
  }
): Promise<MetadataTemplate> {
  return await apiFetch(`/organizations/${organizationId}/media/metadata-templates`, {
    method: 'POST',
    body: JSON.stringify(template),
  });
}

export async function updateMetadataTemplate(
  organizationId: string,
  templateId: string,
  template: {
    name?: string;
    description?: string | null;
    template_fields?: MetadataTemplateFields | null;
    is_default?: boolean;
  }
): Promise<MetadataTemplate> {
  return await apiFetch(`/organizations/${organizationId}/media/metadata-templates/${templateId}`, {
    method: 'PATCH',
    body: JSON.stringify(template),
  });
}

export async function deleteMetadataTemplate(
  organizationId: string,
  templateId: string
): Promise<{ success: boolean; template_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/metadata-templates/${templateId}`, {
    method: 'DELETE',
  });
}

export async function setDefaultMetadataTemplate(
  organizationId: string,
  templateId: string
): Promise<{ success: boolean; template_id: string; message: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/metadata-templates/${templateId}/set-default`, {
    method: 'POST',
  });
}

// ============================================================================
// MEDIA VERSIONING API
// ============================================================================

export async function getMediaVersions(
  organizationId: string,
  mediaId: string
): Promise<MediaVersionsResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}/versions`);
  return validate(MediaVersionsResponseSchema, data);
}

export async function uploadMediaVersion(
  organizationId: string,
  mediaId: string,
  file: File,
  changeNote?: string
): Promise<{ success: boolean; media_id: string; version: number; previous_version_id: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (changeNote) {
    formData.append('change_note', changeNote);
  }

  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/versions`, {
    method: 'POST',
    body: formData,
    headers: {}, // Let browser set content-type for FormData
  });
}

export async function restoreMediaVersion(
  organizationId: string,
  mediaId: string,
  versionId: string
): Promise<{ success: boolean; media_id: string; restored_from_version: number; new_version: number }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/versions/${versionId}/restore`, {
    method: 'POST',
  });
}

// ============================================================================
// MEDIA PUBLISHING API
// ============================================================================

export async function publishMedia(
  organizationId: string,
  mediaId: string
): Promise<{ success: boolean; media_id: string; is_published: boolean; warnings: string[] }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/publish`, {
    method: 'POST',
  });
}

export async function unpublishMedia(
  organizationId: string,
  mediaId: string
): Promise<{ success: boolean; media_id: string; is_published: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/unpublish`, {
    method: 'POST',
  });
}

export async function reviewMetadata(
  organizationId: string,
  mediaId: string,
  notes?: string
): Promise<{
  success: boolean;
  media_id: string;
  metadata_reviewed: boolean;
  metadata_reviewed_at: string;
  metadata_reviewed_by: string | null;
}> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/review-metadata`, {
    method: 'POST',
    body: notes ? JSON.stringify({ notes }) : undefined,
  });
}

export async function clearMetadataReview(
  organizationId: string,
  mediaId: string
): Promise<{ success: boolean; media_id: string; metadata_reviewed: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/clear-metadata-review`, {
    method: 'POST',
  });
}

export async function getPublishingStats(
  organizationId: string
): Promise<{ published: number; pending_review: number; rights_issues: number; total: number }> {
  return await apiFetch(`/organizations/${organizationId}/media/publishing-stats`);
}

// ============================================================================
// DAM ENHANCEMENT APIs - Consent, Usage Analytics, Expiration Alerts, Collections
// ============================================================================

// --- Media Consent ---

export async function listMediaConsents(
  organizationId: string,
  mediaId: string
): Promise<MediaConsentListResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}/consent`);
  return validate(MediaConsentListResponseSchema, data);
}

export async function createMediaConsent(
  organizationId: string,
  mediaId: string,
  consent: {
    subject_name: string;
    subject_role?: string;
    consent_type?: 'photo_release' | 'model_release' | 'interview' | 'performance' | 'general' | 'other';
    consent_scope?: 'internal' | 'public' | 'commercial' | 'educational' | 'all';
    consent_date?: string;
    expiry_date?: string;
    notes?: string;
  }
): Promise<{ consent_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/consent`, {
    method: 'POST',
    body: JSON.stringify(consent),
  });
}

export async function updateMediaConsent(
  organizationId: string,
  mediaId: string,
  consentId: string,
  updates: Partial<{
    subject_name: string;
    subject_role: string;
    consent_type: string;
    consent_scope: string;
    consent_date: string;
    expiry_date: string;
    notes: string;
    is_valid: boolean;
  }>
): Promise<{ consent_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/consent/${consentId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteMediaConsent(
  organizationId: string,
  mediaId: string,
  consentId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/consent/${consentId}`, {
    method: 'DELETE',
  });
}

export async function revokeMediaConsent(
  organizationId: string,
  mediaId: string,
  consentId: string,
  revocationReason?: string
): Promise<{ consent_id: string; is_valid: boolean; revocation_date: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/consent/${consentId}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ revocation_reason: revocationReason }),
  });
}

export async function uploadConsentDocument(
  organizationId: string,
  mediaId: string,
  consentId: string,
  file: File
): Promise<{ consent_id: string; document_key: string }> {
  const formData = new FormData();
  formData.append('file', file);

  return apiFetch<{ consent_id: string; document_key: string }>(
    `/organizations/${organizationId}/media/${mediaId}/consent/${consentId}/document`,
    { method: 'POST', body: formData }
  );
}

export async function getConsentDocumentUrl(
  organizationId: string,
  mediaId: string,
  consentId: string
): Promise<{ document_url: string; expires_in: number }> {
  return await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/consent/${consentId}/document`
  );
}

// --- Media Rights ---

export interface MediaRightsRecord {
  rights_id: string;
  rights_type: 'copyright' | 'license' | 'restriction' | 'permission';
  rights_status?: string;
  rights_holder?: string;
  license_type?: string;
  license_url?: string;
  rights_statement?: string;
  start_date?: string;
  end_date?: string;
  territory?: string;
  usage_restrictions?: string[];
  is_active: boolean;
  created_at?: string;
}

export async function listMediaRights(
  organizationId: string,
  mediaId: string
): Promise<{ media_id: string; rights: MediaRightsRecord[] }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/rights`);
}

export async function createMediaRights(
  organizationId: string,
  mediaId: string,
  rights: {
    rights_type: 'copyright' | 'license' | 'restriction' | 'permission';
    rights_status?: string;
    rights_holder?: string;
    license_type?: string;
    license_url?: string;
    rights_statement?: string;
    start_date?: string;
    end_date?: string;
    territory?: string;
    usage_restrictions?: string[];
  }
): Promise<{ rights_id: string; media_id: string; rights_type: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/rights`, {
    method: 'POST',
    body: JSON.stringify(rights),
  });
}

export async function updateMediaRights(
  organizationId: string,
  mediaId: string,
  rightsId: string,
  updates: Partial<{
    rights_type: string;
    rights_status: string;
    rights_holder: string;
    license_type: string;
    license_url: string;
    rights_statement: string;
    start_date: string;
    end_date: string;
    territory: string;
    usage_restrictions: string[];
    is_active: boolean;
  }>
): Promise<{ rights_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/rights/${rightsId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteMediaRights(
  organizationId: string,
  mediaId: string,
  rightsId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/rights/${rightsId}`, {
    method: 'DELETE',
  });
}

// --- Media Usage Analytics ---

export async function logMediaUsage(
  organizationId: string,
  mediaId: string,
  eventType: 'view' | 'download' | 'embed' | 'api_access' | 'share',
  options?: {
    derivative_type?: string;
    access_context?: string;
    metadata?: Record<string, any>;
  }
): Promise<{ event_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/usage`, {
    method: 'POST',
    body: JSON.stringify({
      event_type: eventType,
      ...options,
    }),
  });
}

export async function getMediaUsageStats(
  organizationId: string,
  mediaId: string,
  days?: number
): Promise<MediaUsageStats> {
  const query = days ? `?days=${days}` : '';
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}/usage${query}`);
  return validate(MediaUsageStatsSchema, data);
}

export async function getMediaUsageReport(
  organizationId: string,
  params?: {
    days?: number;
    limit?: number;
    event_type?: string;
  }
): Promise<MediaUsageReport> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/media/usage/report${query}`);
  return validate(MediaUsageReportSchema, data);
}

// --- Expiration Alerts ---

export async function listExpirationAlerts(
  organizationId: string,
  params?: {
    status?: 'active' | 'dismissed' | 'resolved' | 'acknowledged';
    severity?: 'warning' | 'urgent' | 'critical';
    alert_type?: 'rights' | 'consent';
    limit?: number;
    offset?: number;
  }
): Promise<ExpirationAlertsListResponse> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/media/expiration-alerts${query}`);
  return validate(ExpirationAlertsListResponseSchema, data);
}

export async function getExpirationAlertsSummary(
  organizationId: string
): Promise<ExpirationAlertsSummary> {
  const data = await apiFetch(`/organizations/${organizationId}/media/expiration-alerts/summary`);
  return validate(ExpirationAlertsSummarySchema, data);
}

export async function dismissExpirationAlert(
  organizationId: string,
  alertId: string,
  notes?: string
): Promise<{ alert_id: string; status: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/expiration-alerts/${alertId}/dismiss`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
}

export async function acknowledgeExpirationAlert(
  organizationId: string,
  alertId: string,
  notes?: string
): Promise<{ alert_id: string; status: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/expiration-alerts/${alertId}/acknowledge`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
}

// --- Media Collections (Lightboxes) ---

export async function listMediaCollections(
  organizationId: string,
  params?: {
    visibility?: 'private' | 'org' | 'public';
    limit?: number;
    offset?: number;
  }
): Promise<MediaCollectionListResponse> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/media-collections${query}`);
  return validate(MediaCollectionListResponseSchema, data);
}

export async function createMediaCollection(
  organizationId: string,
  collection: {
    name: string;
    description?: string;
    visibility?: 'private' | 'org' | 'public';
    consent_clearance_required?: boolean;
  }
): Promise<MediaCollection> {
  const data = await apiFetch(`/organizations/${organizationId}/media-collections`, {
    method: 'POST',
    body: JSON.stringify(collection),
  });
  return validate(MediaCollectionSchema, data);
}

export async function getMediaCollection(
  organizationId: string,
  collectionId: string
): Promise<MediaCollection> {
  const data = await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}`);
  return validate(MediaCollectionSchema, data);
}

export async function updateMediaCollection(
  organizationId: string,
  collectionId: string,
  updates: Partial<{
    name: string;
    description: string;
    visibility: 'private' | 'org' | 'public';
    cover_media_id: string;
    consent_clearance_required: boolean;
  }>
): Promise<MediaCollection> {
  const data = await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(MediaCollectionSchema, data);
}

export async function deleteMediaCollection(
  organizationId: string,
  collectionId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}`, {
    method: 'DELETE',
  });
}

// --- Collection Items ---

export async function listCollectionItems(
  organizationId: string,
  collectionId: string
): Promise<MediaCollectionItemsResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/items`);
  return validate(MediaCollectionItemsResponseSchema, data);
}

export async function addCollectionItem(
  organizationId: string,
  collectionId: string,
  mediaId: string,
  options?: { notes?: string; sort_order?: number }
): Promise<{ collection_id: string; media_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/items`, {
    method: 'POST',
    body: JSON.stringify({ media_id: mediaId, ...options }),
  });
}

export async function removeCollectionItem(
  organizationId: string,
  collectionId: string,
  mediaId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/items/${mediaId}`, {
    method: 'DELETE',
  });
}

export async function reorderCollectionItems(
  organizationId: string,
  collectionId: string,
  items: Array<{ media_id: string; sort_order: number }>
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/items/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ items }),
  });
}

// --- Collection Sharing ---

export async function listCollectionShares(
  organizationId: string,
  collectionId: string
): Promise<MediaCollectionSharesResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/shares`);
  return validate(MediaCollectionSharesResponseSchema, data);
}

export async function shareCollection(
  organizationId: string,
  collectionId: string,
  params: {
    user_id?: string;
    principal_type?: 'user' | 'role';
    principal_id?: string;
    role: 'viewer' | 'editor';
  }
): Promise<{ share_id: string }> {
  // Support both old (user_id) and new (principal_type/principal_id) format
  const body = params.principal_type && params.principal_id
    ? { principal_type: params.principal_type, principal_id: params.principal_id, role: params.role }
    : { user_id: params.user_id, role: params.role };

  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/shares`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function removeCollectionShare(
  organizationId: string,
  collectionId: string,
  shareId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/shares/${shareId}`, {
    method: 'DELETE',
  });
}

// --- Public Sharing ---

export interface PublicShareSettings {
  expires_at?: string | null;
  password?: string | null;
  download_level?: 'none' | 'derivatives' | 'originals';
}

export async function enablePublicSharing(
  organizationId: string,
  collectionId: string,
  settings?: PublicShareSettings,
): Promise<{ public_share_token: string; public_url: string }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/enable-public`, {
    method: 'POST',
    body: JSON.stringify(settings ?? {}),
  });
}

export async function updatePublicShareSettings(
  organizationId: string,
  collectionId: string,
  settings: PublicShareSettings,
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/public-share/settings`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function rotatePublicShareToken(
  organizationId: string,
  collectionId: string,
): Promise<{ public_share_token: string; public_url: string }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/public-share/rotate`, {
    method: 'POST',
  });
}

export interface PublicShareAccessEntry {
  access_id: string;
  accessed_at: string | null;
  action: 'view' | 'auth' | 'download';
  media_id: string | null;
  auth_success: boolean | null;
  ip_address: string | null;
  user_agent: string | null;
  referrer: string | null;
}

export async function listPublicShareAccessLog(
  organizationId: string,
  collectionId: string,
  params?: { limit?: number; offset?: number },
): Promise<{ total: number; entries: PublicShareAccessEntry[] }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const suffix = qs.toString() ? `?${qs}` : '';
  return await apiFetch(
    `/organizations/${organizationId}/media-collections/${collectionId}/public-share/access-log${suffix}`,
  );
}

export interface MyPublicShareRow {
  collection_id: string;
  name: string;
  item_count: number;
  public_share_token: string | null;
  public_share_expires_at: string | null;
  public_share_has_password: boolean;
  public_share_download_level: 'none' | 'derivatives' | 'originals';
  created_at: string | null;
  updated_at: string | null;
  views: number;
  downloads: number;
  failed_auth: number;
  last_accessed_at: string | null;
}

export async function listMyPublicShares(
  organizationId: string,
): Promise<{ shares: MyPublicShareRow[] }> {
  return await apiFetch(`/organizations/${organizationId}/media/my-shares`);
}

export async function disablePublicSharing(
  organizationId: string,
  collectionId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/disable-public`, {
    method: 'DELETE',
  });
}

export async function checkConsentClearance(
  organizationId: string,
  collectionId: string
): Promise<ConsentClearanceResult> {
  const data = await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/consent-clearance`);
  return validate(ConsentClearanceResultSchema, data);
}

export async function clearCollectionForPublic(
  organizationId: string,
  collectionId: string
): Promise<{ success: boolean; cleared_at: string }> {
  return await apiFetch(`/organizations/${organizationId}/media-collections/${collectionId}/clear-consent`, {
    method: 'POST',
  });
}

// --- Public Collection Access (no auth) ---

export async function getPublicCollection(
  shareToken: string,
  password?: string,
): Promise<{
  collection: MediaCollection;
  items: MediaCollectionItem[];
}> {
  const headers: Record<string, string> = {};
  if (password) headers['X-Share-Password'] = password;
  return await apiFetch(`/public/collections/${shareToken}`, {
    headers,
  });
}

export async function getPublicCollectionDownloadUrl(
  shareToken: string,
  mediaId: string,
  variant: 'original' | string,
  password?: string,
): Promise<{ url: string; variant: string; expires_in: number }> {
  const headers: Record<string, string> = {};
  if (password) headers['X-Share-Password'] = password;
  return await apiFetch(
    `/public/collections/${shareToken}/media/${mediaId}/download?variant=${encodeURIComponent(variant)}`,
    { headers },
  );
}

// ============================================================================
// MEDIA TAG DEFINITIONS (Admin-managed)
// ============================================================================

export async function listTagDefinitions(
  organizationId: string,
  options?: { includeInactive?: boolean }
): Promise<MediaTagDefinitionsResponse> {
  const params = options?.includeInactive ? '?include_inactive=true' : '';
  const data = await apiFetch(`/organizations/${organizationId}/media/tag-definitions${params}`);
  return validate(MediaTagDefinitionsResponseSchema, data);
}

export async function createTagDefinition(
  organizationId: string,
  definition: {
    tag_key: string;
    display_name: string;
    description?: string;
    is_required?: boolean;
    sort_order?: number;
  }
): Promise<MediaTagDefinition> {
  const data = await apiFetch(`/organizations/${organizationId}/media/tag-definitions`, {
    method: 'POST',
    body: JSON.stringify(definition),
  });
  return validate(MediaTagDefinitionSchema, data);
}

export async function getTagDefinition(
  organizationId: string,
  definitionId: string
): Promise<MediaTagDefinition> {
  const data = await apiFetch(`/organizations/${organizationId}/media/tag-definitions/${definitionId}`);
  return validate(MediaTagDefinitionSchema, data);
}

export async function updateTagDefinition(
  organizationId: string,
  definitionId: string,
  updates: {
    display_name?: string;
    description?: string;
    is_required?: boolean;
    sort_order?: number;
    is_active?: boolean;
  }
): Promise<MediaTagDefinition> {
  const data = await apiFetch(`/organizations/${organizationId}/media/tag-definitions/${definitionId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(MediaTagDefinitionSchema, data);
}

export async function deleteTagDefinition(
  organizationId: string,
  definitionId: string,
  hardDelete?: boolean
): Promise<{ success: boolean; hard_deleted: boolean }> {
  const params = hardDelete ? '?hard_delete=true' : '';
  return await apiFetch(`/organizations/${organizationId}/media/tag-definitions/${definitionId}${params}`, {
    method: 'DELETE',
  });
}

export async function reorderTagDefinitions(
  organizationId: string,
  order: string[]
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/tag-definitions/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ order }),
  });
}

// ============================================================================
// MEDIA TAGS (User-assigned values)
// ============================================================================

export async function getMediaTags(
  organizationId: string,
  mediaId: string
): Promise<MediaTagsResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}/tags`);
  return validate(MediaTagsResponseSchema, data);
}

export async function setMediaTag(
  organizationId: string,
  mediaId: string,
  tag: {
    definition_id: string;
    value_id?: string;
    tag_value?: string;
  }
): Promise<MediaTag> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}/tags`, {
    method: 'POST',
    body: JSON.stringify(tag),
  });
  return validate(MediaTagSchema, data);
}

export async function deleteMediaTag(
  organizationId: string,
  mediaId: string,
  definitionId: string,
  valueId?: string,
): Promise<{ success: boolean }> {
  const qs = valueId ? `?value_id=${encodeURIComponent(valueId)}` : '';
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/tags/${definitionId}${qs}`, {
    method: 'DELETE',
  });
}

export async function bulkUpdateMediaTags(
  organizationId: string,
  mediaId: string,
  tags: Array<{ definition_id: string; value_id?: string; tag_value?: string }>,
): Promise<MediaTagsResponse> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tags }),
  });
  return validate(MediaTagsResponseSchema, data);
}

// ── Allowed values (controlled vocabulary) ─────────────────────────────────

export async function listTagValuesForDefinition(
  organizationId: string,
  definitionId: string,
  options?: { includeInactive?: boolean; includeUsage?: boolean },
): Promise<MediaTagValueListResponse> {
  const params = new URLSearchParams();
  if (options?.includeInactive) params.set('include_inactive', 'true');
  if (options?.includeUsage) params.set('include_usage', 'true');
  const qs = params.toString();
  const data = await apiFetch(
    `/organizations/${organizationId}/media/tag-definitions/${definitionId}/values${qs ? `?${qs}` : ''}`,
  );
  return validate(MediaTagValueListResponseSchema, data);
}

export async function addTagValue(
  organizationId: string,
  definitionId: string,
  body: { value: string; parent_id?: string | null; sort_order?: number; is_active?: boolean },
): Promise<MediaTagValue> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/tag-definitions/${definitionId}/values`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return validate(MediaTagValueSchema, data);
}

export async function updateTagValue(
  organizationId: string,
  definitionId: string,
  valueId: string,
  body: { value?: string; parent_id?: string | null; sort_order?: number; is_active?: boolean },
): Promise<MediaTagValue> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/tag-definitions/${definitionId}/values/${valueId}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
  return validate(MediaTagValueSchema, data);
}

export async function reorderTagValues(
  organizationId: string,
  definitionId: string,
  order: string[],
): Promise<{ success: boolean }> {
  return await apiFetch(
    `/organizations/${organizationId}/media/tag-definitions/${definitionId}/values/reorder`,
    { method: 'PUT', body: JSON.stringify({ order }) },
  );
}

export async function deleteTagValue(
  organizationId: string,
  definitionId: string,
  valueId: string,
  hardDelete: boolean = false,
): Promise<{ success: boolean }> {
  const qs = hardDelete ? '?hard_delete=true' : '';
  return await apiFetch(
    `/organizations/${organizationId}/media/tag-definitions/${definitionId}/values/${valueId}${qs}`,
    { method: 'DELETE' },
  );
}

export async function getTagValues(
  organizationId: string,
  definitionId: string,
  options?: { prefix?: string; limit?: number }
): Promise<TagValuesResponse> {
  const params = new URLSearchParams({ definition_id: definitionId });
  if (options?.prefix) params.append('prefix', options.prefix);
  if (options?.limit) params.append('limit', String(options.limit));
  const data = await apiFetch(`/organizations/${organizationId}/media/tags/values?${params}`);
  return validate(TagValuesResponseSchema, data);
}

// =============================================================================
// MEDIA AI TAGGING API
// =============================================================================

// Re-export types for consumers
export type {
  MediaAIConfig,
  MediaAITagMapping,
  MediaAITagMappingsList,
  MediaAITagsList,
  AITaggingStats,
};

// Get AI config for organization
export async function getMediaAIConfig(
  organizationId: string
): Promise<MediaAIConfig> {
  const data = await apiFetch(`/organizations/${organizationId}/media/ai-config`);
  return validate(MediaAIConfigSchema, data.config ?? data);
}

// Update AI config
export async function updateMediaAIConfig(
  organizationId: string,
  config: Partial<{
    auto_tag_on_upload: boolean;
    detect_labels: boolean;
    detect_text: boolean;
    detect_faces: boolean;
    detect_celebrities: boolean;
    detect_moderation: boolean;
    extract_pdf_text: boolean;
    min_label_confidence: number;
    min_text_confidence: number;
    max_labels_per_image: number;
    monthly_budget_usd: number | null;
    visual_search_threshold: number;
  }>
): Promise<MediaAIConfig> {
  const data = await apiFetch(`/organizations/${organizationId}/media/ai-config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  return validate(MediaAIConfigSchema, data);
}

// Get AI tag mappings
export async function getMediaAITagMappings(
  organizationId: string,
  options?: { ai_tag_type?: string }
): Promise<MediaAITagMappingsList> {
  const params = new URLSearchParams();
  if (options?.ai_tag_type) params.append('ai_tag_type', options.ai_tag_type);
  const queryString = params.toString();
  const data = await apiFetch(
    `/organizations/${organizationId}/media/ai-mappings${queryString ? `?${queryString}` : ''}`
  );
  return validate(MediaAITagMappingsListSchema, data);
}

// Create AI tag mapping
export async function createMediaAITagMapping(
  organizationId: string,
  mapping: {
    ai_tag_type: string;
    ai_tag_value: string;
    definition_id: string;
    mapped_value: string;
    auto_apply?: boolean;
    min_confidence?: number;
  }
): Promise<MediaAITagMapping> {
  const data = await apiFetch(`/organizations/${organizationId}/media/ai-mappings`, {
    method: 'POST',
    body: JSON.stringify(mapping),
  });
  return validate(MediaAITagMappingSchema, data);
}

// Update AI tag mapping
export async function updateMediaAITagMapping(
  organizationId: string,
  mappingId: string,
  updates: Partial<{
    definition_id: string;
    mapped_value: string;
    auto_apply: boolean;
    min_confidence: number;
  }>
): Promise<MediaAITagMapping> {
  const data = await apiFetch(`/organizations/${organizationId}/media/ai-mappings/${mappingId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(MediaAITagMappingSchema, data);
}

// Delete AI tag mapping
export async function deleteMediaAITagMapping(
  organizationId: string,
  mappingId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/ai-mappings/${mappingId}`, {
    method: 'DELETE',
  });
}

// Get AI tags for a specific media item
export async function getMediaAITags(
  organizationId: string,
  mediaId: string
): Promise<MediaAITagsList> {
  const data = await apiFetch(`/organizations/${organizationId}/media/${mediaId}/ai-tags`);
  return validate(MediaAITagsListSchema, data);
}

// Update an AI tag's mapping status (reject, ignore, etc.)
export async function updateMediaAITagStatus(
  organizationId: string,
  mediaId: string,
  aiTagId: string,
  mappingStatus: 'pending' | 'rejected' | 'ignored'
): Promise<{ ai_tag: MediaAITag }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/ai-tags/${aiTagId}`, {
    method: 'PATCH',
    body: JSON.stringify({ mapping_status: mappingStatus }),
  });
}

// Delete an AI tag
export async function deleteMediaAITag(
  organizationId: string,
  mediaId: string,
  aiTagId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/ai-tags/${aiTagId}`, {
    method: 'DELETE',
  });
}

// Reprocess AI tags for a media item
export async function reprocessMediaAITags(
  organizationId: string,
  mediaId: string
): Promise<{ task_id: string; message: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/ai-tags/reprocess`, {
    method: 'POST',
  });
}

export interface TieredDescriptionsResult {
  media_id: string;
  ai_alt_text: string | null;
  ai_description_long: string | null;
  ai_description_emoji: string | null;
  ai_descriptions_generated_at: string | null;
  ai_descriptions_model: string | null;
  sensitivity_flag: boolean;
}

export async function generateMediaDescriptions(
  organizationId: string,
  mediaId: string,
  options?: { model?: string },
): Promise<TieredDescriptionsResult> {
  return await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/generate-descriptions`,
    {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    },
  );
}

// Bulk reprocess AI tags
export async function bulkReprocessAITags(
  organizationId: string,
  options?: { status_filter?: string; limit?: number }
): Promise<{ task_id: string; queued_count: number; message: string }> {
  return await apiFetch(`/organizations/${organizationId}/media/ai-tags/bulk-reprocess`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

// Get AI tagging stats
export async function getAITaggingStats(
  organizationId: string
): Promise<AITaggingStats> {
  const data = await apiFetch(`/organizations/${organizationId}/media/ai-tags/stats`);
  return validate(AITaggingStatsSchema, data);
}

// AI tag suggestion type
export interface AITagSuggestion {
  ai_tag_type: string;
  ai_tag_value: string;
  occurrence_count: number;
  avg_confidence: number;
  sample_media_ids: string[];
}

export interface AITagSuggestionsResponse {
  suggestions: AITagSuggestion[];
  total: number;
}

// Get unmapped AI tag suggestions (frequently occurring tags without mappings)
export async function getAITagSuggestions(
  organizationId: string,
  options?: { tag_type?: string; min_occurrences?: number; limit?: number }
): Promise<AITagSuggestionsResponse> {
  const params = new URLSearchParams();
  if (options?.tag_type) params.append('tag_type', options.tag_type);
  if (options?.min_occurrences) params.append('min_occurrences', String(options.min_occurrences));
  if (options?.limit) params.append('limit', String(options.limit));
  const queryString = params.toString();
  return await apiFetch(
    `/organizations/${organizationId}/media/ai-tags/suggestions${queryString ? `?${queryString}` : ''}`
  );
}

// ============================================================================
// MEDIA FIELD INHERITANCE
// ============================================================================

export async function getMediaInheritedFields(
  organizationId: string,
  mediaId: string,
  context?: 'detail' | 'list'
): Promise<{ inherited_fields: { object_id: string; object_number: string; fields: { source_field: string; display_label: string; value: unknown }[] }[] }> {
  const query = context ? `?context=${context}` : '';
  return await apiFetch(`/organizations/${organizationId}/media/${mediaId}/inherited-fields${query}`);
}

export async function listFieldInheritanceConfig(
  organizationId: string,
  context?: 'detail' | 'list'
): Promise<{ configs: unknown[]; total: number }> {
  const query = context ? `?context=${context}` : '';
  return await apiFetch(`/organizations/${organizationId}/media/field-inheritance-config${query}`);
}

export async function createFieldInheritanceConfig(
  organizationId: string,
  data: {
    source_field: string;
    display_label: string;
    display_context?: 'detail' | 'list' | 'both';
    transform_type?: 'array_first' | 'array_join' | 'array_concat_field' | null;
    transform_config?: Record<string, unknown> | null;
    sort_order?: number;
    is_active?: boolean;
  }
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/field-inheritance-config`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateFieldInheritanceConfig(
  organizationId: string,
  configId: string,
  data: {
    display_label?: string;
    display_context?: 'detail' | 'list' | 'both';
    transform_type?: 'array_first' | 'array_join' | 'array_concat_field' | null;
    transform_config?: Record<string, unknown> | null;
    sort_order?: number;
    is_active?: boolean;
  }
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/field-inheritance-config/${configId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteFieldInheritanceConfig(
  organizationId: string,
  configId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/field-inheritance-config/${configId}`, {
    method: 'DELETE',
  });
}

export async function seedFieldInheritanceConfig(
  organizationId: string
): Promise<{ configs: unknown[]; total: number }> {
  return await apiFetch(`/organizations/${organizationId}/media/field-inheritance-config/seed`, {
    method: 'POST',
  });
}


// ============================================================================
// MEDIA DOWNLOAD REQUESTS
// ============================================================================

export async function listDownloadRequests(
  organizationId: string,
  filters?: {
    status?: string | string[];
    limit?: number;
    offset?: number;
  }
): Promise<{ items: unknown[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (filters?.status) {
    params.set('status', Array.isArray(filters.status) ? filters.status.join(',') : filters.status);
  }
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return await apiFetch(`/organizations/${organizationId}/media/download-requests${query}`);
}

export async function listMyDownloadRequests(
  organizationId: string,
  filters?: {
    status?: string | string[];
    limit?: number;
    offset?: number;
  }
): Promise<{ items: unknown[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (filters?.status) {
    params.set('status', Array.isArray(filters.status) ? filters.status.join(',') : filters.status);
  }
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return await apiFetch(`/organizations/${organizationId}/media/download-requests/my${query}`);
}

export async function createDownloadRequest(
  organizationId: string,
  data: {
    media_ids: string[];
    purpose: string;
    intended_use: string;
    collection_id?: string;
    requester_institution?: string;
    project_description?: string;
    derivative_type_requested?: string;
  }
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/download-requests`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getDownloadRequest(
  organizationId: string,
  requestId: string
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/download-requests/${requestId}`);
}

export async function startDownloadRequestReview(
  organizationId: string,
  requestId: string,
  note?: string
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/download-requests/${requestId}/review`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export async function approveDownloadRequest(
  organizationId: string,
  requestId: string,
  data?: {
    conditions?: string;
    item_approvals?: Record<string, boolean>;
  }
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/download-requests/${requestId}/approve`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export async function denyDownloadRequest(
  organizationId: string,
  requestId: string,
  reason: string
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/download-requests/${requestId}/deny`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function fulfillDownloadRequest(
  organizationId: string,
  requestId: string,
  data?: {
    expires_days?: number;
    max_downloads?: number;
    note?: string;
  }
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/download-requests/${requestId}/fulfill`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}

export async function getDownloadRequestLinks(
  organizationId: string,
  requestId: string,
  token: string
): Promise<{ request_id: string; downloads: unknown[]; total: number }> {
  return await apiFetch(`/organizations/${organizationId}/media/download-requests/${requestId}/downloads?token=${encodeURIComponent(token)}`);
}

export async function recordDownloadRequestDownload(
  organizationId: string,
  requestId: string,
  itemId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/media/download-requests/${requestId}/downloads/${itemId}/record`, {
    method: 'POST',
  });
}

export async function cancelDownloadRequest(
  organizationId: string,
  requestId: string
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/download-requests/${requestId}/cancel`, {
    method: 'POST',
  });
}

// ============================================================================
// MEDIA FOLDERS
// ============================================================================

export async function listMediaFolders(
  organizationId: string,
  includeCounts = true
): Promise<{ folders: unknown[]; unfiled_count: number | null }> {
  const params = new URLSearchParams();
  if (!includeCounts) {
    params.set('include_counts', 'false');
  }
  return await apiFetch(`/organizations/${organizationId}/media/folders?${params.toString()}`);
}

export async function createMediaFolder(
  organizationId: string,
  data: { name: string; parent_folder_id?: string | null }
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/folders`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getMediaFolder(
  organizationId: string,
  folderId: string
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/folders/${folderId}`);
}

export async function updateMediaFolder(
  organizationId: string,
  folderId: string,
  data: { name?: string; parent_folder_id?: string | null }
): Promise<unknown> {
  return await apiFetch(`/organizations/${organizationId}/media/folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteMediaFolder(
  organizationId: string,
  folderId: string,
  moveToFolderId?: string | null
): Promise<{ success: boolean; media_items_affected: number }> {
  const params = new URLSearchParams();
  if (moveToFolderId) {
    params.set('move_to', moveToFolderId);
  }
  return await apiFetch(`/organizations/${organizationId}/media/folders/${folderId}?${params.toString()}`, {
    method: 'DELETE',
  });
}

export async function getMediaFolderContents(
  organizationId: string,
  folderId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ subfolders: unknown[]; media: unknown[]; total_media: number; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());
  return await apiFetch(`/organizations/${organizationId}/media/folders/${folderId}/contents?${params.toString()}`);
}

export async function moveMediaToFolder(
  organizationId: string,
  folderId: string,
  mediaIds: string[]
): Promise<{ success: boolean; moved_count: number }> {
  return await apiFetch(`/organizations/${organizationId}/media/folders/${folderId}/move-items`, {
    method: 'POST',
    body: JSON.stringify({ media_ids: mediaIds }),
  });
}
