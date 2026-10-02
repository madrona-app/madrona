/**
 * Extended DAM API functions.
 *
 * Covers CLIP visual search, Whisper transcription, OCR,
 * media alternatives, annotations, transforms, conversions,
 * derivative sizes, locking, contact sheets, and embed codes.
 */
import { apiFetch, buildQueryString, validate } from './_utils';
import { z } from 'zod';
import {
  SimilarMediaResultSchema,
  TranscriptResponseSchema,
  MediaAlternativeSchema,
  MediaAnnotationSchema,
  DerivativeSizeConfigSchema,
} from '../schemas';

// =============================================================================
// CLIP Visual Search
// =============================================================================

export interface SimilarMediaResult {
  media_id: string;
  similarity: number;
  title?: string;
  preview_url?: string | null;
  thumbnail_url?: string | null;
}

export async function getSimilarMedia(
  organizationId: string,
  mediaId: string,
  params?: { top_k?: number; threshold?: number }
): Promise<{ media_id: string; similar: SimilarMediaResult[]; total: number }> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(
    `/organizations/${organizationId}/media/similar/${mediaId}${query}`
  );
  return validate(z.object({
    media_id: z.string(),
    similar: z.array(SimilarMediaResultSchema),
    total: z.number(),
  }).passthrough(), data);
}

export async function visualSearch(
  organizationId: string,
  text: string,
  params?: { top_k?: number; threshold?: number }
): Promise<{ query: string; results: SimilarMediaResult[]; total: number }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/search/visual`,
    { method: 'POST', body: JSON.stringify({ text, ...params }) }
  );
  return validate(z.object({
    query: z.string(),
    results: z.array(SimilarMediaResultSchema),
    total: z.number(),
  }).passthrough(), data);
}

export async function findDuplicates(
  organizationId: string,
  threshold?: number
): Promise<{
  duplicates: { media_id_a: string; media_id_b: string; similarity: number }[];
  total: number;
}> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/duplicates`,
    { method: 'POST', body: JSON.stringify({ threshold }) }
  );
  return validate(z.object({
    duplicates: z.array(z.object({
      media_id_a: z.string(),
      media_id_b: z.string(),
      similarity: z.number(),
    })),
    total: z.number(),
  }).passthrough(), data);
}

export async function bulkGenerateClip(
  organizationId: string
): Promise<{ success: boolean; task_id: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/clip/bulk-generate`,
    { method: 'POST' }
  );
  return validate(z.object({ success: z.boolean(), task_id: z.string() }).passthrough(), data);
}

// =============================================================================
// Whisper Transcription
// =============================================================================

export interface TranscriptResponse {
  media_id: string;
  transcript?: string | null;
  language?: string | null;
  status?: string | null;
  model?: string | null;
}

export async function getTranscript(
  organizationId: string,
  mediaId: string
): Promise<TranscriptResponse> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/transcript`
  );
  return validate(TranscriptResponseSchema, data);
}

export async function triggerTranscription(
  organizationId: string,
  mediaId: string
): Promise<{ success: boolean; task_id: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/transcribe`,
    { method: 'POST' }
  );
  return validate(z.object({ success: z.boolean(), task_id: z.string() }).passthrough(), data);
}

export async function bulkTranscribe(
  organizationId: string
): Promise<{ success: boolean; task_id: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/bulk-transcribe`,
    { method: 'POST' }
  );
  return validate(z.object({ success: z.boolean(), task_id: z.string() }).passthrough(), data);
}

// =============================================================================
// Media Alternatives
// =============================================================================

export interface MediaAlternative {
  alternative_id: string;
  alternative_type: string;
  label?: string | null;
  description?: string | null;
  filename: string;
  file_size?: number | null;
  mime_type?: string | null;
  generated_by?: string | null;
  generation_params?: Record<string, unknown> | null;
  sort_order: number;
  created_at?: string | null;
}

export async function getAlternatives(
  organizationId: string,
  mediaId: string
): Promise<{ media_id: string; alternatives: MediaAlternative[] }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/alternatives`
  );
  return validate(z.object({
    media_id: z.string(),
    alternatives: z.array(MediaAlternativeSchema),
  }).passthrough(), data);
}

export async function getAlternativeDownloadUrl(
  organizationId: string,
  mediaId: string,
  alternativeId: string
): Promise<{ download_url: string; filename: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/alternatives/${alternativeId}/download`
  );
  return validate(z.object({ download_url: z.string(), filename: z.string() }).passthrough(), data);
}

export async function deleteAlternative(
  organizationId: string,
  mediaId: string,
  alternativeId: string
): Promise<{ success: boolean }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/alternatives/${alternativeId}`,
    { method: 'DELETE' }
  );
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// =============================================================================
// Annotations
// =============================================================================

export interface MediaAnnotation {
  annotation_id: string;
  target_selector: Record<string, unknown>;
  body?: Record<string, unknown> | null;
  motivation?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
}

export async function getAnnotations(
  organizationId: string,
  mediaId: string
): Promise<{ media_id: string; annotations: MediaAnnotation[] }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/annotations`
  );
  return validate(z.object({
    media_id: z.string(),
    annotations: z.array(MediaAnnotationSchema),
  }).passthrough(), data);
}

export async function createAnnotation(
  organizationId: string,
  mediaId: string,
  body: {
    target_selector: Record<string, unknown>;
    body?: Record<string, unknown>;
    motivation?: string;
  }
): Promise<MediaAnnotation> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/annotations`,
    { method: 'POST', body: JSON.stringify(body) }
  );
  return validate(MediaAnnotationSchema, data) as any;
}

export async function updateAnnotation(
  organizationId: string,
  mediaId: string,
  annotationId: string,
  body: Partial<{
    target_selector: Record<string, unknown>;
    body: Record<string, unknown>;
    motivation: string;
  }>
): Promise<MediaAnnotation> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/annotations/${annotationId}`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
  return validate(MediaAnnotationSchema, data) as any;
}

export async function deleteAnnotation(
  organizationId: string,
  mediaId: string,
  annotationId: string
): Promise<{ success: boolean }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/annotations/${annotationId}`,
    { method: 'DELETE' }
  );
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// =============================================================================
// Image Transform
// =============================================================================

export interface TransformParams {
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
  crop_unit?: 'percent' | 'pixels';
  rotate?: number;
  flip_horizontal?: boolean;
  flip_vertical?: boolean;
  gamma?: number;
  max_width?: number;
  max_height?: number;
  format?: string;
  quality?: number;
}

export async function transformImage(
  organizationId: string,
  mediaId: string,
  params: TransformParams
): Promise<{
  download_url: string;
  width: number;
  height: number;
  file_size: number;
  mime_type: string;
}> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/transform`,
    { method: 'POST', body: JSON.stringify(params) }
  );
  return validate(z.object({
    download_url: z.string(),
    width: z.number(),
    height: z.number(),
    file_size: z.number(),
    mime_type: z.string(),
  }).passthrough(), data);
}

// =============================================================================
// Format Conversion Download
// =============================================================================

export async function getDownloadUrl(
  organizationId: string,
  mediaId: string,
  params?: { format?: string; quality?: number }
): Promise<{ download_url: string }> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/download${query}`
  );
  return validate(z.object({ download_url: z.string() }).passthrough(), data);
}

// =============================================================================
// Upload from URL
// =============================================================================

export async function uploadFromUrl(
  organizationId: string,
  url: string,
  title?: string,
  folderId?: string
): Promise<{ success: boolean; task_id: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/upload-from-url`,
    {
      method: 'POST',
      body: JSON.stringify({ url, title, folder_id: folderId }),
    }
  );
  return validate(z.object({ success: z.boolean(), task_id: z.string() }).passthrough(), data);
}

// =============================================================================
// Derivative Size Config
// =============================================================================

export interface DerivativeSizeConfig {
  config_id: string;
  organization_id?: string | null;
  name: string;
  label: string;
  media_type?: string | null;
  max_width?: number | null;
  max_height?: number | null;
  format: string;
  quality?: number | null;
  config?: Record<string, unknown> | null;
  is_default: boolean;
  sort_order: number;
  is_system?: boolean;
}

export async function getDerivativeSizes(
  organizationId: string
): Promise<{ derivative_sizes: DerivativeSizeConfig[] }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/derivative-sizes`
  );
  return validate(z.object({
    derivative_sizes: z.array(DerivativeSizeConfigSchema),
  }).passthrough(), data);
}

export async function createDerivativeSize(
  organizationId: string,
  body: Omit<DerivativeSizeConfig, 'config_id'>
): Promise<{ config_id: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/derivative-sizes`,
    { method: 'POST', body: JSON.stringify(body) }
  );
  return validate(z.object({ config_id: z.string() }).passthrough(), data);
}

export async function deleteDerivativeSize(
  organizationId: string,
  configId: string
): Promise<{ success: boolean }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/derivative-sizes/${configId}`,
    { method: 'DELETE' }
  );
  return validate(z.object({ success: z.boolean() }).passthrough(), data);
}

// =============================================================================
// Media Locking
// =============================================================================

export async function lockMedia(
  organizationId: string,
  mediaId: string
): Promise<{ locked: boolean; expires_at: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/lock`,
    { method: 'POST' }
  );
  return validate(z.object({ locked: z.boolean(), expires_at: z.string() }).passthrough(), data);
}

export async function unlockMedia(
  organizationId: string,
  mediaId: string
): Promise<{ locked: boolean }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/lock`,
    { method: 'DELETE' }
  );
  return validate(z.object({ locked: z.boolean() }).passthrough(), data);
}

// =============================================================================
// Contact Sheet
// =============================================================================

export async function generateContactSheet(
  organizationId: string,
  collectionId: string,
  params?: {
    layout?: string;
    page_size?: string;
    columns?: number;
    include_title?: boolean;
    include_filename?: boolean;
    include_description?: boolean;
  }
): Promise<{ run_id: string; status: string }> {
  return apiFetch(
    `/organizations/${organizationId}/media/collections/${collectionId}/contact-sheet`,
    { method: 'POST', body: JSON.stringify(params || {}) }
  );
}

// =============================================================================
// Embed Code
// =============================================================================

export async function getEmbedCode(
  organizationId: string,
  mediaId: string
): Promise<{ media_id: string; embed_codes: { iframe: string; url: string } }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/media/${mediaId}/embed-code`
  );
  return validate(z.object({
    media_id: z.string(),
    embed_codes: z.object({ iframe: z.string(), url: z.string() }),
  }).passthrough(), data);
}
