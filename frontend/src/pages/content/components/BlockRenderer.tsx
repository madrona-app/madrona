/**
 * BlockRenderer — Read-only renderer for public content pages.
 *
 * Takes an array of ContentBlocks and renders each in order using
 * the appropriate type-specific renderer component.
 */

import type { ContentBlock, BlockType } from '../../../types/content';
import { RichTextRenderer } from './blocks/RichTextBlock';
import { ImageRenderer } from './blocks/ImageBlock';
import { HeroBannerRenderer } from './blocks/HeroBannerBlock';
import { GalleryRenderer } from './blocks/GalleryBlock';
import { VideoRenderer } from './blocks/VideoBlock';
import { DividerRenderer } from './blocks/DividerBlock';
import { QuoteRenderer } from './blocks/QuoteBlock';
import { HtmlRenderer } from './blocks/HtmlBlock';
import { CallToActionRenderer } from './blocks/CallToActionBlock';
// Phase 2: museum-specific blocks
import { CollectionGridRenderer } from './blocks/CollectionGridBlock';
import { ObjectSpotlightRenderer } from './blocks/ObjectSpotlightBlock';
import { ExhibitionPreviewRenderer } from './blocks/ExhibitionPreviewBlock';
import { StaffGridRenderer } from './blocks/StaffGridBlock';
import { EventListRenderer } from './blocks/EventListBlock';
import { MapRenderer } from './blocks/MapBlock';
import { AccordionRenderer } from './blocks/AccordionBlock';
import { ColumnsRenderer } from './blocks/ColumnsBlock';
// Phase 6: extended blocks
import { NewsletterSignupRenderer } from './blocks/NewsletterSignupBlock';
import { MembershipCtaRenderer } from './blocks/MembershipCtaBlock';
import { VenueCardRenderer } from './blocks/VenueCardBlock';
import { ExhibitionGridRenderer } from './blocks/ExhibitionGridBlock';
import { EventCalendarRenderer } from './blocks/EventCalendarBlock';
import { TestimonialRenderer } from './blocks/TestimonialBlock';
import { SocialEmbedRenderer } from './blocks/SocialEmbedBlock';
import { SponsorGridRenderer } from './blocks/SponsorGridBlock';
import { CountdownRenderer } from './blocks/CountdownBlock';
import { TabsRenderer } from './blocks/TabsBlock';
import { FormRenderer } from './blocks/FormBlock';

// =============================================================================
// Types
// =============================================================================

interface BlockRendererProps {
  blocks: ContentBlock[];
}

interface BlockRendererComponentProps {
  content: Record<string, unknown>;
}

// =============================================================================
// Renderer Map
// =============================================================================

const RENDERERS: Record<BlockType, React.ComponentType<BlockRendererComponentProps>> = {
  rich_text: RichTextRenderer,
  image: ImageRenderer,
  hero_banner: HeroBannerRenderer,
  gallery: GalleryRenderer,
  video: VideoRenderer,
  divider: DividerRenderer,
  quote: QuoteRenderer,
  html: HtmlRenderer,
  call_to_action: CallToActionRenderer,
  // Phase 2
  collection_grid: CollectionGridRenderer,
  object_spotlight: ObjectSpotlightRenderer,
  exhibition_preview: ExhibitionPreviewRenderer,
  staff_grid: StaffGridRenderer,
  event_list: EventListRenderer,
  map: MapRenderer,
  accordion: AccordionRenderer,
  columns: ColumnsRenderer,
  // Phase 6
  newsletter_signup: NewsletterSignupRenderer,
  membership_cta: MembershipCtaRenderer,
  venue_card: VenueCardRenderer,
  exhibition_grid: ExhibitionGridRenderer,
  event_calendar: EventCalendarRenderer,
  testimonial: TestimonialRenderer,
  social_embed: SocialEmbedRenderer,
  sponsor_grid: SponsorGridRenderer,
  countdown: CountdownRenderer,
  tabs: TabsRenderer,
  form: FormRenderer,
};

// =============================================================================
// Component
// =============================================================================

export function BlockRenderer({ blocks }: BlockRendererProps) {
  if (!blocks || blocks.length === 0) {
    return null;
  }

  const sorted = [...blocks].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-8">
      {sorted.map((block) => {
        const Renderer = RENDERERS[block.block_type];
        if (!Renderer) {
          return null;
        }
        return (
          <div key={block.block_id}>
            <Renderer content={block.content} />
          </div>
        );
      })}
    </div>
  );
}

export default BlockRenderer;
