/**
 * Types for the public Collections Discover feature.
 */

// =============================================================================
// Responsive Image types
// =============================================================================

export interface SrcSetEntry {
  url: string;
  width: number;
  height: number;
}

export interface SrcSetData {
  webp?: SrcSetEntry[];
  jpeg?: SrcSetEntry[];
}

export interface ExternalIntegrations {
  ticketing?: { base_url: string; button_text?: string };
  membership?: { url: string; button_text?: string };
  shop?: { url: string; button_text?: string };
  donate?: { url: string; button_text?: string };
}

export interface AnalyticsConfig {
  ga_id?: string;
  gtm_id?: string;
  plausible_domain?: string;
}

export interface FooterColumn {
  heading: string;
  type: 'links' | 'text' | 'hours';
  content: unknown;
}

export interface DiscoverCollectionInfo {
  organization_name: string;
  organization_slug: string;
  total_discoverable: number;
  hero_image_url: string | null;
  page_title: string | null;
  page_subtitle: string | null;
  show_object_count: boolean;
  default_view_mode: 'grid' | 'list';
  default_sort: string;
  header_logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  font_family: string | null;
  nav_items: Array<{ label: string; url: string }> | null;
  footer_text: string | null;
  social_links: Array<{ platform: string; url: string }> | null;
  homepage_page_id: string | null;
  custom_404_page_id: string | null;
  // Phase 2: Extended theming
  secondary_color: string | null;
  background_color: string | null;
  text_color: string | null;
  heading_font_family: string | null;
  body_font_family: string | null;
  button_style: 'rounded' | 'square' | 'pill';
  header_style: 'solid' | 'transparent' | 'gradient';
  google_fonts: string[] | null;
  custom_css: string | null;
  // Phase 2B: Rich footer
  footer_columns: FooterColumn[] | null;
  land_acknowledgment: string | null;
  footer_logo_url: string | null;
  // Phase 7: External integrations
  external_integrations: ExternalIntegrations | null;
  // Phase 8: Analytics
  analytics_config: AnalyticsConfig | null;
  // CDN
  cdn_config: CdnConfig | null;
  // Guide (AI assistant) — only shown when org has purchased Guide
  guide_enabled: boolean;
  // Visitor widget — requires the per-org widget_enabled config flag
  // (off by default), distinct from merely having the Guide app
  widget_enabled: boolean;
  widget_welcome_message: string | null;
}

export interface CdnConfig {
  provider: 'cloudflare' | 'cloudfront';
  zone_id?: string;
  api_token?: string;
  distribution_id?: string;
}

export interface DiscoverSearchParams {
  q?: string;
  object_type?: string[];
  classification?: string[];
  creator?: string;
  material?: string;
  technique?: string;
  subject?: string;
  style_period?: string[];
  creation_place?: string;
  has_image?: boolean;
  date_from?: string;
  date_to?: string;
  on_display?: boolean;
  sort?: 'relevance' | 'title_asc' | 'title_desc' | 'date_asc' | 'date_desc' | 'newest';
  limit?: number;
  offset?: number;
  include_facets?: boolean;
}

export interface DiscoverHit {
  object_id: string;
  object_number: string | null;
  title: string | null;
  brief_description: string | null;
  creators: string[];
  creation_date_display: string | null;
  classification: string | null;
  object_type: string | null;
  thumbnail_url: string | null;
  thumbnail_srcset: SrcSetData | null;
  has_image: boolean;
}

export interface DiscoverFacetBucket {
  key: string;
  count: number;
}

export interface DiscoverFacet {
  field: string;
  buckets: DiscoverFacetBucket[];
}

export interface DiscoverSearchResponse {
  hits: DiscoverHit[];
  total: number;
  facets: DiscoverFacet[] | null;
  next_offset: number | null;
}

export interface DiscoverMediaItem {
  media_id: string;
  url: string;
  media_type: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  attribution: string | null;
  is_primary: boolean;
  caption: string | null;
  srcset: SrcSetData | null;
}

export interface DiscoverRelatedHit {
  object_id: string;
  object_number: string | null;
  title: string | null;
  creators: string[];
  creation_date_display: string | null;
  classification: string | null;
  thumbnail_url: string | null;
  thumbnail_srcset: SrcSetData | null;
}

export interface DiscoverObjectDetail {
  object_id: string;
  object_number: string;
  canonical_url: string;
  title: string | null;
  titles: Array<{ title: string; title_type?: string; is_preferred?: boolean }> | null;
  brief_description: string | null;
  full_description: string | null;
  object_type: string | null;
  classification: string | null;
  classifications: Array<{ term: string }> | null;
  creators: string[];
  creation_date_display: string | null;
  creation_date_earliest: string | null;
  creation_date_latest: string | null;
  creation_place: string | null;
  materials: Array<{ name?: string; value?: string }> | null;
  techniques: Array<{ name?: string; value?: string }> | null;
  measurements: Array<{ type: string; value: number; unit: string }> | null;
  inscriptions: Array<{ content?: string; text?: string }> | null;
  style_period: string | null;
  provenance: string | null;
  credit_line: string | null;
  media: DiscoverMediaItem[];
  has_image: boolean;
}

export interface DiscoverConfig {
  hero_media_id: string | null;
  page_title: string | null;
  page_subtitle: string | null;
  show_object_count: boolean;
  default_view_mode: 'grid' | 'list';
  default_sort: string;
  header_logo_media_id: string | null;
  primary_color: string | null;
  accent_color: string | null;
  font_family: string | null;
  nav_items: Array<{ label: string; url: string }> | null;
  footer_text: string | null;
  social_links: Array<{ platform: string; url: string }> | null;
  featured_object_ids: string[] | null;
  homepage_page_id: string | null;
  custom_404_page_id: string | null;
  // Phase 2: Extended theming
  secondary_color: string | null;
  background_color: string | null;
  text_color: string | null;
  heading_font_family: string | null;
  body_font_family: string | null;
  button_style: 'rounded' | 'square' | 'pill';
  header_style: 'solid' | 'transparent' | 'gradient';
  google_fonts: string[] | null;
  custom_css: string | null;
  // Phase 2B: Rich footer
  footer_columns: FooterColumn[] | null;
  land_acknowledgment: string | null;
  footer_logo_media_id: string | null;
  // Phase 7: External integrations
  external_integrations: ExternalIntegrations | null;
  // Phase 8: Analytics
  analytics_config: AnalyticsConfig | null;
  // CDN
  cdn_config: CdnConfig | null;
}

export interface DiscoverStats {
  total_objects: number;
  discoverable_count: number;
  private_count: number;
  pending_schedules: number;
  published_last_30_days: number;
  unpublished_last_30_days: number;
}

export interface PublishSchedule {
  schedule_id: string;
  action: 'publish' | 'unpublish';
  scheduled_for: string;
  criteria: Record<string, unknown> | null;
  object_ids: string[] | null;
  status: 'pending' | 'executed' | 'cancelled' | 'failed';
  result_count: number | null;
  error_message: string | null;
  executed_at: string | null;
  created_at: string;
}

export interface DiscoverPreviewResult extends DiscoverObjectDetail {
  is_currently_discoverable: boolean;
  unpublished_media_count: number;
  preview_warnings: string[];
}

// =============================================================================
// Public Venue types (Phase 3)
// =============================================================================

export interface PublicVenue {
  venue_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  hours: Record<string, { open: string; close: string }> | null;
  admission: {
    tiers?: Array<{ label: string; price: string }>;
    free_days?: string;
    note?: string;
  } | null;
  accent_color: string | null;
  parking_info: string | null;
  accessibility_info: string | null;
  ticketing_url: string | null;
  hero_image_url: string | null;
  thumbnail_url: string | null;
}

// =============================================================================
// Public Exhibition types (Phase 4)
// =============================================================================

export interface PublicExhibition {
  exhibition_id: string;
  title: string;
  subtitle: string | null;
  public_url_slug: string | null;
  exhibition_type: string;
  status: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  short_description: string | null;
  description?: string | null;
  credits?: string | null;
  visitor_info?: string | null;
  venue_name: string | null;
  venue_slug: string | null;
  is_featured: boolean;
  ticketing_url: string | null;
  thumbnail_url: string | null;
  hero_image_url?: string | null;
  tags: string[] | null;
}

// =============================================================================
// Public Event types (Phase 5)
// =============================================================================

export interface PublicEvent {
  event_id: string;
  title: string;
  slug: string | null;
  event_type: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  description: string | null;
  short_description: string | null;
  location_name: string | null;
  venue_name: string | null;
  venue_slug: string | null;
  capacity: number | null;
  registration_url: string | null;
  price: string | null;
  price_member: string | null;
  age_range: string | null;
  is_featured: boolean;
  series_name: string | null;
  tags: string[] | null;
  hero_image_url: string | null;
}
