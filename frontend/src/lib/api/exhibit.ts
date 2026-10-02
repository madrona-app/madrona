/**
 * Exhibitions API
 * Exhibitions, exhibition objects, labels, frame styles, mount configs,
 * content blocks, touring venues, and public gallery.
 */
import { apiFetch, buildQueryString, validate } from './_utils';
import {
  ExhibitionSchema,
  ExhibitionsResponseSchema,
  CreateExhibitionResponseSchema,
  ExhibitionObjectsResponseSchema,
  AddExhibitionObjectResponseSchema,
  UpdateExhibitionObjectResponseSchema,
  BatchAddExhibitionObjectsResponseSchema,
  SearchExhibitExhibitionsResponseSchema,
  LabelTemplatesResponseSchema,
  CreateLabelTemplateResponseSchema,
  UpdateLabelTemplateResponseSchema,
  ExhibitionLabelsResponseSchema,
  GenerateExhibitionLabelsResponseSchema,
  ApproveExhibitionLabelResponseSchema,
  FrameStylesResponseSchema,
  CreateFrameStyleResponseSchema,
  UpdateFrameStyleResponseSchema,
  MountConfigsResponseSchema,
  CreateMountConfigResponseSchema,
  UpdateMountConfigResponseSchema,
  ExhibitionContentBlocksResponseSchema,
  CreateContentBlockResponseSchema,
  UpdateContentBlockResponseSchema,
  ReorderContentBlocksResponseSchema,
  ExhibitionVenuesResponseSchema,
  CreateExhibitionVenueResponseSchema,
  UpdateExhibitionVenueResponseSchema,
  PublicExhibitionSchema,
  PublicExhibitionObjectsResponseSchema,
  PublicExhibitionContentResponseSchema,
} from '../schemas';

// ============================================================================
// EXHIBITIONS (Collections)
// ============================================================================

export interface Exhibition {
  exhibition_id: string;
  exhibition_number: string | null;
  title: string;
  description: string | null;
  curator_notes: string | null;
  exhibition_type: string;
  status: string;
  organizer_id: string | null;
  authorizer_id: string | null;
  authorization_date: string | null;
  provisos: string | null;
  outcome: string | null;
  venue_id: string | null;
  venue_name: string | null;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  is_public: boolean;
  public_url_slug: string | null;
  created_at: string | null;
  updated_at?: string | null;
  _restricted_fields?: string[];
  placement_count?: number;
  placements?: Array<{
    placement_id: string;
    floor_plan_id: string;
    floor_plan_name: string | null;
    display_title: string;
    display_artist: string | null;
  }>;
  status_history?: Array<{
    status: string;
    status_date: string | null;
    changed_by: string | null;
    notes: string | null;
  }>;
}

export interface ExhibitionsResponse {
  exhibitions: Exhibition[];
  total?: number;
}

export async function getExhibitions(
  organizationId: string,
  params?: {
    q?: string;
    status?: string;
    exhibition_type?: string;
    limit?: number;
    offset?: number;
  }
): Promise<ExhibitionsResponse> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/exhibitions${query}`);
  return validate(ExhibitionsResponseSchema, data) as any;
}

export async function getExhibition(
  organizationId: string,
  exhibitionId: string
): Promise<Exhibition> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/exhibitions/${exhibitionId}`);
  return validate(ExhibitionSchema, data) as any;
}

export async function createExhibition(
  organizationId: string,
  exhibition: Partial<Exhibition>
): Promise<{ exhibition_id: string; title: string; message: string }> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/exhibitions`, {
    method: 'POST',
    body: JSON.stringify(exhibition),
  });
  return validate(CreateExhibitionResponseSchema, data);
}

export async function updateExhibition(
  organizationId: string,
  exhibitionId: string,
  updates: Partial<Exhibition>
): Promise<Exhibition> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/exhibitions/${exhibitionId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(ExhibitionSchema, data) as any;
}

export async function deleteExhibition(
  organizationId: string,
  exhibitionId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/exhibitions/${exhibitionId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// EXHIBITION OBJECTS
// ============================================================================

export interface ExhibitionObject {
  exhibition_object_id: string;
  object_id?: string | null;
  entity_key?: string | null;
  source_type?: string | null;
  object_number?: string | null;
  title?: string | null;
  description?: string | null;
  thumbnail_url?: string | null;
  creator?: string | null;
  date_created?: string | null;
  primary_image_url?: string | null;
  display_order?: number | null;
  section?: string | null;
  object_status: 'planned' | 'confirmed' | 'on_display' | 'returned';
  confirmed_date?: string | null;
  loan_in_id?: string | null;
  credit_line_override?: string | null;
  special_requirements?: string | null;
  installation_notes?: string | null;
  condition_in_report_id?: string | null;
  condition_out_report_id?: string | null;
  created_at?: string | null;
}

export async function getExhibitionObjects(
  organizationId: string,
  exhibitionId: string
): Promise<{ exhibition_objects: ExhibitionObject[] }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/exhibitions/${exhibitionId}/objects`
  );
  return validate(ExhibitionObjectsResponseSchema, data) as any;
}

export async function addExhibitionObject(
  organizationId: string,
  exhibitionId: string,
  objectData: {
    object_id: string;
    display_order?: number;
    section?: string;
    loan_in_id?: string;
    credit_line_override?: string;
    special_requirements?: string;
    installation_notes?: string;
    object_status?: string;
  }
): Promise<{ exhibition_object_id: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/exhibitions/${exhibitionId}/objects`,
    {
      method: 'POST',
      body: JSON.stringify(objectData),
    }
  );
  return validate(AddExhibitionObjectResponseSchema, data);
}

export async function updateExhibitionObject(
  organizationId: string,
  exhibitionId: string,
  exhibitionObjectId: string,
  objectData: Partial<ExhibitionObject>
): Promise<{ exhibition_object_id: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/exhibitions/${exhibitionId}/objects/${exhibitionObjectId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(objectData),
    }
  );
  return validate(UpdateExhibitionObjectResponseSchema, data);
}

export async function removeExhibitionObject(
  organizationId: string,
  exhibitionId: string,
  exhibitionObjectId: string
): Promise<void> {
  await apiFetch(
    `/organizations/${organizationId}/collections/exhibitions/${exhibitionId}/objects/${exhibitionObjectId}`,
    {
      method: 'DELETE',
    }
  );
}

export async function batchAddExhibitionObjects(
  organizationId: string,
  exhibitionId: string,
  objectIds: string[],
  section?: string
): Promise<{ added: string[]; skipped: string[]; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/collections/exhibitions/${exhibitionId}/objects/batch`,
    {
      method: 'POST',
      body: JSON.stringify({ object_ids: objectIds, section }),
    }
  );
  return validate(BatchAddExhibitionObjectsResponseSchema, data);
}

// Search exhibit exhibitions (for task linking)
export async function searchExhibitExhibitions(
  organizationId: string,
  params?: {
    q?: string;
    status?: string;
    limit?: number;
  }
): Promise<{ exhibitions: Array<{ exhibition_id: string; title: string; exhibition_number: string | null }> }> {
  const queryParams = new URLSearchParams();
  if (params?.q) queryParams.set('q', params.q);
  if (params?.status) queryParams.set('status', params.status);
  if (params?.limit) queryParams.set('limit', params.limit.toString());
  const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
  const data = await apiFetch(`/organizations/${organizationId}/exhibit/exhibitions${query}`);
  return validate(SearchExhibitExhibitionsResponseSchema, data);
}

// ============================================================================
// LABEL TEMPLATES & EXHIBITION LABELS
// ============================================================================

export interface LabelTemplate {
  template_id: string;
  name: string;
  label_type: 'tombstone' | 'extended' | 'wall' | 'didactic';
  template_fields: {
    fields: Array<{ name: string; source: string; format?: string }>;
    layout?: string;
    alignment?: string;
  };
  font_family: string;
  font_size_pt: number;
  width_cm?: number;
  height_cm?: number;
  is_default: boolean;
  created_at?: string;
}

export interface ExhibitionLabel {
  label_id: string;
  exhibition_object_id?: string;
  template_id?: string;
  label_type: string;
  generated_text: string;
  custom_text?: string;
  display_text: string;
  status: 'draft' | 'review' | 'approved' | 'printed';
  reviewed_by?: string;
  reviewed_at?: string;
  approved_by?: string;
  approved_at?: string;
  last_printed_at?: string;
  print_count: number;
  created_at?: string;
}

export async function getLabelTemplates(
  organizationId: string
): Promise<{ label_templates: LabelTemplate[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/exhibit/label-templates`);
  return validate(LabelTemplatesResponseSchema, data) as any;
}

export async function createLabelTemplate(
  organizationId: string,
  template: Partial<LabelTemplate>
): Promise<{ template_id: string; name: string; message: string }> {
  const data = await apiFetch(`/organizations/${organizationId}/exhibit/label-templates`, {
    method: 'POST',
    body: JSON.stringify(template),
  });
  return validate(CreateLabelTemplateResponseSchema, data);
}

export async function updateLabelTemplate(
  organizationId: string,
  templateId: string,
  template: Partial<LabelTemplate>
): Promise<{ template_id: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/label-templates/${templateId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(template),
    }
  );
  return validate(UpdateLabelTemplateResponseSchema, data);
}

export async function deleteLabelTemplate(
  organizationId: string,
  templateId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/exhibit/label-templates/${templateId}`, {
    method: 'DELETE',
  });
}

export async function getExhibitionLabels(
  organizationId: string,
  exhibitionId: string
): Promise<{ labels: ExhibitionLabel[] }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/labels`
  );
  return validate(ExhibitionLabelsResponseSchema, data) as any;
}

export async function generateExhibitionLabels(
  organizationId: string,
  exhibitionId: string,
  templateId: string,
  exhibitionObjectIds?: string[]
): Promise<{ generated_count: number; exhibition_object_ids: string[]; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/labels/generate`,
    {
      method: 'POST',
      body: JSON.stringify({
        template_id: templateId,
        exhibition_object_ids: exhibitionObjectIds,
      }),
    }
  );
  return validate(GenerateExhibitionLabelsResponseSchema, data);
}

export async function approveExhibitionLabel(
  organizationId: string,
  exhibitionId: string,
  labelId: string
): Promise<{ label_id: string; status: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/labels/${labelId}/approve`,
    {
      method: 'POST',
    }
  );
  return validate(ApproveExhibitionLabelResponseSchema, data);
}

// ============================================================================
// FRAME STYLES
// ============================================================================

export interface FrameStyle {
  frame_style_id: string;
  name: string;
  description?: string;
  profile_type: 'flat' | 'stepped' | 'ornate' | 'float' | 'shadowbox';
  default_width_cm: number;
  default_depth_cm: number;
  color?: string;
  material?: string;
  preview_image_url?: string;
  is_system: boolean;
}

export async function getFrameStyles(
  organizationId: string
): Promise<{ frame_styles: FrameStyle[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/exhibit/frame-styles`);
  return validate(FrameStylesResponseSchema, data) as any;
}

export async function createFrameStyle(
  organizationId: string,
  style: Partial<FrameStyle>
): Promise<{ frame_style_id: string; message: string }> {
  const data = await apiFetch(`/organizations/${organizationId}/exhibit/frame-styles`, {
    method: 'POST',
    body: JSON.stringify(style),
  });
  return validate(CreateFrameStyleResponseSchema, data);
}

export async function updateFrameStyle(
  organizationId: string,
  styleId: string,
  style: Partial<FrameStyle>
): Promise<{ frame_style_id: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/frame-styles/${styleId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(style),
    }
  );
  return validate(UpdateFrameStyleResponseSchema, data);
}

export async function deleteFrameStyle(
  organizationId: string,
  styleId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/exhibit/frame-styles/${styleId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// MOUNT CONFIGS
// ============================================================================

export interface MountConfig {
  mount_config_id: string;
  name: string;
  mount_type: 'wall' | 'plinth' | 'vitrine' | 'hanging' | 'floor';
  config: Record<string, unknown>;
  preview_image_url?: string;
  is_system: boolean;
}

export async function getMountConfigs(
  organizationId: string
): Promise<{ mount_configs: MountConfig[] }> {
  const data = await apiFetch(`/organizations/${organizationId}/exhibit/mount-configs`);
  return validate(MountConfigsResponseSchema, data) as any;
}

export async function createMountConfig(
  organizationId: string,
  config: Partial<MountConfig>
): Promise<{ mount_config_id: string; message: string }> {
  const data = await apiFetch(`/organizations/${organizationId}/exhibit/mount-configs`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
  return validate(CreateMountConfigResponseSchema, data);
}

export async function updateMountConfig(
  organizationId: string,
  configId: string,
  config: Partial<MountConfig>
): Promise<{ mount_config_id: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/mount-configs/${configId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(config),
    }
  );
  return validate(UpdateMountConfigResponseSchema, data);
}

export async function deleteMountConfig(
  organizationId: string,
  configId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/exhibit/mount-configs/${configId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// EXHIBITION CONTENT BLOCKS
// ============================================================================

export type ContentBlockType =
  | 'intro_text'
  | 'section_header'
  | 'theme_narrative'
  | 'extended_label'
  | 'educational_content'
  | 'multimedia_embed'
  | 'quote'
  | 'timeline'
  | 'credit_panel';

export interface ExhibitionContentBlock {
  block_id: string;
  block_type: ContentBlockType;
  section?: string;
  display_order: number;
  title?: string;
  content: string;
  content_format: 'markdown' | 'html' | 'plain';
  media_id?: string;
  media_caption?: string;
  status: 'draft' | 'review' | 'published';
  is_public: boolean;
  related_object_ids?: string[];
  created_at?: string;
}

export async function getExhibitionContentBlocks(
  organizationId: string,
  exhibitionId: string
): Promise<{ content_blocks: ExhibitionContentBlock[] }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/content-blocks`
  );
  return validate(ExhibitionContentBlocksResponseSchema, data) as any;
}

export async function createExhibitionContentBlock(
  organizationId: string,
  exhibitionId: string,
  block: Partial<ExhibitionContentBlock>
): Promise<{ block_id: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/content-blocks`,
    {
      method: 'POST',
      body: JSON.stringify(block),
    }
  );
  return validate(CreateContentBlockResponseSchema, data);
}

export async function updateExhibitionContentBlock(
  organizationId: string,
  exhibitionId: string,
  blockId: string,
  block: Partial<ExhibitionContentBlock>
): Promise<{ block_id: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/content-blocks/${blockId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(block),
    }
  );
  return validate(UpdateContentBlockResponseSchema, data);
}

export async function deleteExhibitionContentBlock(
  organizationId: string,
  exhibitionId: string,
  blockId: string
): Promise<void> {
  await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/content-blocks/${blockId}`,
    {
      method: 'DELETE',
    }
  );
}

export async function reorderExhibitionContentBlocks(
  organizationId: string,
  exhibitionId: string,
  blockIds: string[]
): Promise<{ message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/content-blocks/reorder`,
    {
      method: 'POST',
      body: JSON.stringify({ block_ids: blockIds }),
    }
  );
  return validate(ReorderContentBlocksResponseSchema, data);
}

// ============================================================================
// TOURING EXHIBITION VENUES
// ============================================================================

export interface ExhibitionVenue {
  exhibition_venue_id: string;
  venue_id?: string;
  venue_name?: string;
  external_venue_name?: string;
  external_venue_address?: string;
  contact_id?: string;
  tour_order: number;
  planned_start_date?: string;
  planned_end_date?: string;
  actual_start_date?: string;
  actual_end_date?: string;
  status: 'proposed' | 'confirmed' | 'in_transit' | 'installed' | 'open' | 'closing' | 'returned';
  loan_agreement_id?: string;
  fee_amount?: number;
  fee_currency?: string;
  special_requirements?: string;
  created_at?: string;
}

export async function getExhibitionVenues(
  organizationId: string,
  exhibitionId: string
): Promise<{ exhibition_venues: ExhibitionVenue[] }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/venues`
  );
  return validate(ExhibitionVenuesResponseSchema, data) as any;
}

export async function createExhibitionVenue(
  organizationId: string,
  exhibitionId: string,
  venue: Partial<ExhibitionVenue>
): Promise<{ exhibition_venue_id: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/venues`,
    {
      method: 'POST',
      body: JSON.stringify(venue),
    }
  );
  return validate(CreateExhibitionVenueResponseSchema, data);
}

export async function updateExhibitionVenue(
  organizationId: string,
  exhibitionId: string,
  exhibitionVenueId: string,
  venue: Partial<ExhibitionVenue>
): Promise<{ exhibition_venue_id: string; message: string }> {
  const data = await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/venues/${exhibitionVenueId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(venue),
    }
  );
  return validate(UpdateExhibitionVenueResponseSchema, data);
}

export async function deleteExhibitionVenue(
  organizationId: string,
  exhibitionId: string,
  exhibitionVenueId: string
): Promise<void> {
  await apiFetch(
    `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/venues/${exhibitionVenueId}`,
    {
      method: 'DELETE',
    }
  );
}

// ============================================================================
// PUBLIC GALLERY
// ============================================================================

export interface PublicExhibition {
  exhibition_id: string;
  title: string;
  description?: string | null;
  exhibition_type: string;
  status: string;
  venue_name?: string | null;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  actual_start_date?: string | null;
  actual_end_date?: string | null;
  public_url_slug: string;
}

export interface PublicExhibitionObject {
  object_id: string;
  object_number?: string | null;
  title?: string | null;
  creator?: string | null;
  date_created?: string | null;
  medium?: string | null;
  dimensions?: string | null;
  credit_line?: string | null;
  primary_image_url?: string | null;
  section?: string | null;
  display_order: number;
}

export async function getPublicExhibition(slug: string): Promise<PublicExhibition> {
  const data = await apiFetch(`/gallery/${slug}`, { skipAuth: true });
  return validate(PublicExhibitionSchema, data);
}

export async function getPublicExhibitionObjects(
  slug: string,
  params?: { page?: number; per_page?: number }
): Promise<{
  objects: PublicExhibitionObject[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/gallery/${slug}/objects${query}`, { skipAuth: true });
  return validate(PublicExhibitionObjectsResponseSchema, data);
}

export async function getPublicExhibitionContent(
  slug: string
): Promise<{ content_blocks: ExhibitionContentBlock[] }> {
  const data = await apiFetch(`/gallery/${slug}/content`, { skipAuth: true });
  return validate(PublicExhibitionContentResponseSchema, data) as any;
}
