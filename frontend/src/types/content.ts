/**
 * Content CMS types — pages, blog posts, blocks, categories.
 */

// =============================================================================
// Block Types
// =============================================================================

export type BlockType =
  | 'rich_text'
  | 'image'
  | 'hero_banner'
  | 'gallery'
  | 'video'
  | 'divider'
  | 'quote'
  | 'html'
  | 'call_to_action'
  // Phase 2: museum-specific blocks
  | 'collection_grid'
  | 'object_spotlight'
  | 'exhibition_preview'
  | 'staff_grid'
  | 'event_list'
  | 'map'
  | 'accordion'
  | 'columns'
  // Phase 6: extended blocks
  | 'newsletter_signup'
  | 'membership_cta'
  | 'venue_card'
  | 'exhibition_grid'
  | 'event_calendar'
  | 'testimonial'
  | 'social_embed'
  | 'sponsor_grid'
  | 'countdown'
  | 'tabs'
  | 'form';

export interface RichTextContent {
  html: string;
}

export interface ImageBlockContent {
  media_id: string;
  caption?: string;
  alt?: string;
  size?: 'small' | 'medium' | 'full';
}

export interface HeroBannerContent {
  media_id?: string;
  title: string;
  subtitle?: string;
  cta_text?: string;
  cta_url?: string;
}

export interface GalleryContent {
  media_ids: string[];
  columns?: 2 | 3 | 4;
  caption?: string;
}

export interface VideoContent {
  url: string;
  caption?: string;
}

export interface DividerContent {
  style?: 'line' | 'space' | 'dots';
}

export interface QuoteContent {
  text: string;
  attribution?: string;
}

export interface HtmlBlockContent {
  code: string;
}

export interface CallToActionContent {
  heading: string;
  text?: string;
  button_text: string;
  button_url: string;
  style?: 'primary' | 'secondary';
}

// Phase 2: museum-specific block content interfaces

export interface CollectionGridContent {
  filters?: {
    object_type?: string;
    classification?: string;
    creator?: string;
    material?: string;
    technique?: string;
    subject?: string;
    style_period?: string;
    creation_place?: string;
    on_display?: boolean;
    has_image?: boolean;
  };
  limit?: number;
  columns?: 2 | 3 | 4;
  show_facets?: boolean;
}

export interface ObjectSpotlightContent {
  object_id: string;
  show_description?: boolean;
  show_creator?: boolean;
  layout?: 'horizontal' | 'vertical';
}

export interface ExhibitionPreviewContent {
  exhibition_slug: string;
  show_dates?: boolean;
  show_description?: boolean;
}

export interface StaffGridContent {
  constituent_ids?: string[];
  department_filter?: string;
  columns?: 2 | 3 | 4;
  show_bio?: boolean;
}

export interface EventListContent {
  limit?: number;
  event_types?: string[];
  show_past?: boolean;
}

export interface MapContent {
  lat: number;
  lng: number;
  zoom?: number;
  marker_label?: string;
  style?: 'streets' | 'satellite';
}

export interface AccordionItem {
  title: string;
  body: string;
}

export interface AccordionContent {
  items: AccordionItem[];
}

export interface ColumnsContent {
  column_count: 2 | 3;
  column_blocks: Array<Array<{
    block_type: BlockType;
    content: Record<string, unknown>;
  }>>;
}

// Phase 6: Extended block content interfaces

export interface NewsletterSignupContent {
  heading: string;
  description?: string;
  button_text?: string;
  form_action_url: string;
}

export interface MembershipCtaContent {
  heading: string;
  description?: string;
  tiers?: Array<{ name: string; price: string; benefits?: string[] }>;
  cta_url: string;
}

export interface VenueCardContent {
  venue_slug: string;
}

export interface ExhibitionGridContent {
  venue_filter?: string;
  status_filter?: string;
  limit?: number;
  columns?: 2 | 3 | 4;
}

export interface EventCalendarContent {
  venue_filter?: string;
  type_filter?: string;
  limit?: number;
}

export interface TestimonialContent {
  items: Array<{
    quote: string;
    attribution?: string;
    source_url?: string;
    logo_media_id?: string;
  }>;
}

export interface SocialEmbedContent {
  embed_type: string;
  embed_url: string;
  caption?: string;
}

export interface SponsorGridContent {
  heading?: string;
  logos: Array<{ media_id: string; name: string; url?: string }>;
  columns?: 2 | 3 | 4 | 6;
}

export interface CountdownContent {
  target_date: string;
  heading?: string;
  cta_text?: string;
  cta_url?: string;
}

export interface TabsContent {
  tabs: Array<{
    label: string;
    blocks: Array<{ block_type: BlockType; content: Record<string, unknown> }>;
  }>;
}

export interface FormContent {
  fields: Array<{ label: string; type: string; required?: boolean }>;
  action_url: string;
  success_message?: string;
}


export type BlockContent =
  | RichTextContent
  | ImageBlockContent
  | HeroBannerContent
  | GalleryContent
  | VideoContent
  | DividerContent
  | QuoteContent
  | HtmlBlockContent
  | CallToActionContent
  | CollectionGridContent
  | ObjectSpotlightContent
  | ExhibitionPreviewContent
  | StaffGridContent
  | EventListContent
  | MapContent
  | AccordionContent
  | ColumnsContent
  | NewsletterSignupContent
  | MembershipCtaContent
  | VenueCardContent
  | ExhibitionGridContent
  | EventCalendarContent
  | TestimonialContent
  | SocialEmbedContent
  | SponsorGridContent
  | CountdownContent
  | TabsContent
  | FormContent;

// =============================================================================
// Content Block
// =============================================================================

export interface ContentBlock {
  block_id: string;
  page_id?: string;
  block_type: BlockType;
  content: Record<string, unknown>;
  sort_order: number;
}

// =============================================================================
// Page / Post
// =============================================================================

export type PageType = 'page' | 'post';
export type PageStatus = 'draft' | 'published' | 'archived';
export type PageTemplate = 'default' | 'full_width' | 'sidebar' | 'landing';

export interface ContentPage {
  page_id: string;
  organization_id?: string;
  slug: string;
  title: string;
  page_type: PageType;
  status: PageStatus;
  published_at: string | null;
  publish_at?: string | null;
  author_id: string | null;
  author_name?: string | null;
  featured_image_media_id: string | null;
  og_image_media_id?: string | null;
  excerpt: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  template: string | null;
  parent_page_id?: string | null;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  updated_by?: string | null;
  blocks?: ContentBlock[];
  categories?: ContentCategory[];
}

// =============================================================================
// Category
// =============================================================================

export interface ContentCategory {
  category_id: string;
  organization_id?: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

// =============================================================================
// API Request/Response types
// =============================================================================

export interface CreatePageRequest {
  title: string;
  slug?: string;
  page_type: PageType;
  template?: PageTemplate;
  excerpt?: string;
  meta_title?: string;
  meta_description?: string;
  featured_image_media_id?: string | null;
  parent_page_id?: string | null;
  sort_order?: number;
  blocks?: Array<{
    block_type: BlockType;
    content: Record<string, unknown>;
  }>;
}

export interface UpdatePageRequest {
  title?: string;
  slug?: string;
  excerpt?: string;
  meta_title?: string;
  meta_description?: string;
  template?: PageTemplate;
  featured_image_media_id?: string | null;
  og_image_media_id?: string | null;
  publish_at?: string | null;
  parent_page_id?: string | null;
  sort_order?: number;
  category_ids?: string[];
}

export interface SaveBlocksRequest {
  blocks: Array<{
    block_id?: string;
    block_type: BlockType;
    content: Record<string, unknown>;
  }>;
}

export interface CreateCategoryRequest {
  name: string;
  slug?: string;
  description?: string;
  sort_order?: number;
}

export interface UpdateCategoryRequest {
  name?: string;
  slug?: string;
  description?: string;
  sort_order?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Menus
// =============================================================================

export type MenuLocation = 'header' | 'footer';
export type MenuItemLinkType = 'page' | 'url' | 'collection' | 'category' | 'exhibition' | 'event';

export interface MenuItem {
  menu_item_id?: string;
  label: string;
  link_type: MenuItemLinkType;
  page_id?: string | null;
  url?: string | null;
  sort_order: number;
  description?: string | null;
  image_media_id?: string | null;
  highlight?: boolean;
  children?: MenuItem[];
}

export interface ContentMenu {
  menu_id?: string;
  location: MenuLocation;
  name: string;
  items: MenuItem[];
}

export interface SaveMenuRequest {
  name?: string;
  items: Array<{
    label: string;
    link_type: MenuItemLinkType;
    page_id?: string | null;
    url?: string | null;
    description?: string | null;
    image_media_id?: string | null;
    highlight?: boolean;
    children?: Array<{
      label: string;
      link_type: MenuItemLinkType;
      page_id?: string | null;
      url?: string | null;
      description?: string | null;
      image_media_id?: string | null;
      highlight?: boolean;
    }>;
  }>;
}

// Public menu item (has page_slug instead of page_id)
export interface PublicMenuItem {
  label: string;
  link_type: MenuItemLinkType;
  page_slug?: string | null;
  url?: string | null;
  description?: string | null;
  image_media_id?: string | null;
  highlight?: boolean;
  children?: PublicMenuItem[];
}

export interface PublicMenu {
  location: MenuLocation;
  items: PublicMenuItem[];
}

// =============================================================================
// Page Tree (hierarchy)
// =============================================================================

export interface PageTreeNode {
  page_id: string;
  slug: string;
  title: string;
  status: string;
  template: string | null;
  sort_order: number;
  depth: number;
  updated_at: string | null;
  children: PageTreeNode[];
}

export interface PageAncestor {
  page_id: string;
  slug: string;
  title: string;
}

export interface PageChild {
  page_id: string;
  slug: string;
  title: string;
}
