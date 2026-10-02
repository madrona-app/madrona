/**
 * BlockEditor — Drag-and-drop block editor for CMS content pages.
 *
 * Uses @dnd-kit for sortable drag-and-drop. Each block renders a
 * drag handle, type indicator, move/delete controls, and its
 * type-specific inline editor component.
 */

import { useState, useCallback, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Type,
  Image,
  Layout,
  Grid3X3,
  Video,
  Minus,
  Quote,
  Code,
  MousePointerClick,
  ChevronRight,
  LayoutGrid,
  Star,
  Frame,
  Users,
  CalendarDays,
  MapPin,
  ChevronsUpDown,
  Columns3,
  // Phase 6
  Mail,
  BadgeDollarSign,
  Building2,
  GalleryHorizontalEnd,
  CalendarRange,
  MessageSquareQuote,
  Share2,
  Handshake,
  Timer,
  PanelTop,
  FileInput,
  } from 'lucide-react';
import type { ContentBlock, BlockType } from '../../../types/content';
import { cn } from '../../../lib/utils';

// Block editors
import { RichTextEditor } from './blocks/RichTextBlock';
import { ImageEditor } from './blocks/ImageBlock';
import { HeroBannerEditor } from './blocks/HeroBannerBlock';
import { GalleryEditor } from './blocks/GalleryBlock';
import { VideoEditor } from './blocks/VideoBlock';
import { DividerEditor } from './blocks/DividerBlock';
import { QuoteEditor } from './blocks/QuoteBlock';
import { HtmlEditor } from './blocks/HtmlBlock';
import { CallToActionEditor } from './blocks/CallToActionBlock';
// Phase 2: museum-specific blocks
import { CollectionGridEditor } from './blocks/CollectionGridBlock';
import { ObjectSpotlightEditor } from './blocks/ObjectSpotlightBlock';
import { ExhibitionPreviewEditor } from './blocks/ExhibitionPreviewBlock';
import { StaffGridEditor } from './blocks/StaffGridBlock';
import { EventListEditor } from './blocks/EventListBlock';
import { MapEditor } from './blocks/MapBlock';
import { AccordionEditor } from './blocks/AccordionBlock';
import { ColumnsEditor } from './blocks/ColumnsBlock';
// Phase 6: extended blocks
import { NewsletterSignupEditor } from './blocks/NewsletterSignupBlock';
import { MembershipCtaEditor } from './blocks/MembershipCtaBlock';
import { VenueCardEditor } from './blocks/VenueCardBlock';
import { ExhibitionGridEditor } from './blocks/ExhibitionGridBlock';
import { EventCalendarEditor } from './blocks/EventCalendarBlock';
import { TestimonialEditor } from './blocks/TestimonialBlock';
import { SocialEmbedEditor } from './blocks/SocialEmbedBlock';
import { SponsorGridEditor } from './blocks/SponsorGridBlock';
import { CountdownEditor } from './blocks/CountdownBlock';
import { TabsEditor } from './blocks/TabsBlock';
import { FormEditor } from './blocks/FormBlock';

// =============================================================================
// Types
// =============================================================================

interface BlockEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  organizationId: string;
}

export interface BlockEditorComponentProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
  organizationId?: string;
}

// =============================================================================
// Block Type Config
// =============================================================================

interface BlockTypeConfig {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
  defaultContent: Record<string, unknown>;
}

const BLOCK_TYPES: Record<BlockType, BlockTypeConfig> = {
  rich_text: {
    label: 'Rich Text',
    icon: Type,
    description: 'Formatted text with headings, links, and lists',
    defaultContent: { html: '' },
  },
  image: {
    label: 'Image',
    icon: Image,
    description: 'Single image with caption and alt text',
    defaultContent: { media_id: '', caption: '', alt: '', size: 'full' },
  },
  hero_banner: {
    label: 'Hero Banner',
    icon: Layout,
    description: 'Full-width banner with overlay text and CTA',
    defaultContent: { title: '', subtitle: '', media_id: '', cta_text: '', cta_url: '' },
  },
  gallery: {
    label: 'Gallery',
    icon: Grid3X3,
    description: 'Grid gallery of multiple images',
    defaultContent: { media_ids: [], columns: 3, caption: '' },
  },
  video: {
    label: 'Video',
    icon: Video,
    description: 'YouTube or Vimeo embed',
    defaultContent: { url: '', caption: '' },
  },
  divider: {
    label: 'Divider',
    icon: Minus,
    description: 'Visual separator between sections',
    defaultContent: { style: 'line' },
  },
  quote: {
    label: 'Quote',
    icon: Quote,
    description: 'Styled blockquote with attribution',
    defaultContent: { text: '', attribution: '' },
  },
  html: {
    label: 'HTML',
    icon: Code,
    description: 'Raw HTML code block',
    defaultContent: { code: '' },
  },
  call_to_action: {
    label: 'Call to Action',
    icon: MousePointerClick,
    description: 'Prominent CTA card with button',
    defaultContent: { heading: '', text: '', button_text: '', button_url: '', style: 'primary' },
  },
  // Phase 2: museum-specific blocks
  collection_grid: {
    label: 'Collection Grid',
    icon: LayoutGrid,
    description: 'Embedded grid of collection objects with filters',
    defaultContent: { filters: {}, limit: 12, columns: 3, show_facets: false },
  },
  object_spotlight: {
    label: 'Object Spotlight',
    icon: Star,
    description: 'Feature a single collection object',
    defaultContent: { object_id: '', show_description: true, show_creator: true, layout: 'horizontal' },
  },
  exhibition_preview: {
    label: 'Exhibition Preview',
    icon: Frame,
    description: 'Preview a public exhibition with dates and description',
    defaultContent: { exhibition_slug: '', show_dates: true, show_description: true },
  },
  staff_grid: {
    label: 'Staff Grid',
    icon: Users,
    description: 'Team member grid from your contacts',
    defaultContent: { constituent_ids: [], department_filter: '', columns: 3, show_bio: false },
  },
  event_list: {
    label: 'Event List',
    icon: CalendarDays,
    description: 'Upcoming public events',
    defaultContent: { limit: 5, event_types: [], show_past: false },
  },
  map: {
    label: 'Map',
    icon: MapPin,
    description: 'Embedded map with location pin',
    defaultContent: { lat: 40.7794, lng: -73.9632, zoom: 15, marker_label: '' },
  },
  accordion: {
    label: 'Accordion',
    icon: ChevronsUpDown,
    description: 'Expandable FAQ / info sections',
    defaultContent: { items: [] },
  },
  columns: {
    label: 'Columns',
    icon: Columns3,
    description: '2 or 3 column layout with nested content',
    defaultContent: { column_count: 2, column_blocks: [[], []] },
  },
  // Phase 6: extended blocks
  newsletter_signup: {
    label: 'Newsletter Signup',
    icon: Mail,
    description: 'Email subscription form with heading and CTA',
    defaultContent: { heading: '', description: '', button_text: 'Subscribe', form_action_url: '' },
  },
  membership_cta: {
    label: 'Membership CTA',
    icon: BadgeDollarSign,
    description: 'Membership tiers with pricing and benefits',
    defaultContent: { heading: '', description: '', tiers: [], cta_url: '' },
  },
  venue_card: {
    label: 'Venue Card',
    icon: Building2,
    description: 'Display a venue with details',
    defaultContent: { venue_slug: '' },
  },
  exhibition_grid: {
    label: 'Exhibition Grid',
    icon: GalleryHorizontalEnd,
    description: 'Grid of exhibitions with filters',
    defaultContent: { venue_filter: '', status_filter: 'open', limit: 6, columns: 3 },
  },
  event_calendar: {
    label: 'Event Calendar',
    icon: CalendarRange,
    description: 'Calendar of events with venue and type filters',
    defaultContent: { venue_filter: '', type_filter: '', limit: 10 },
  },
  testimonial: {
    label: 'Testimonial',
    icon: MessageSquareQuote,
    description: 'Quotes and testimonials with attribution',
    defaultContent: { items: [] },
  },
  social_embed: {
    label: 'Social Embed',
    icon: Share2,
    description: 'Embed YouTube, Vimeo, Instagram, or TikTok',
    defaultContent: { embed_type: 'youtube', embed_url: '', caption: '' },
  },
  sponsor_grid: {
    label: 'Sponsor Grid',
    icon: Handshake,
    description: 'Grid of sponsor logos with links',
    defaultContent: { heading: '', logos: [], columns: 4 },
  },
  countdown: {
    label: 'Countdown',
    icon: Timer,
    description: 'Countdown timer to a target date',
    defaultContent: { target_date: '', heading: '', cta_text: '', cta_url: '' },
  },
  tabs: {
    label: 'Tabs',
    icon: PanelTop,
    description: 'Tabbed content sections with nested blocks',
    defaultContent: { tabs: [] },
  },
  form: {
    label: 'Form',
    icon: FileInput,
    description: 'Custom form with configurable fields',
    defaultContent: { fields: [], action_url: '', success_message: '' },
  },
};

const EDITORS: Record<BlockType, React.ComponentType<BlockEditorComponentProps>> = {
  rich_text: RichTextEditor,
  image: ImageEditor,
  hero_banner: HeroBannerEditor,
  gallery: GalleryEditor,
  video: VideoEditor,
  divider: DividerEditor,
  quote: QuoteEditor,
  html: HtmlEditor,
  call_to_action: CallToActionEditor,
  // Phase 2
  collection_grid: CollectionGridEditor,
  object_spotlight: ObjectSpotlightEditor,
  exhibition_preview: ExhibitionPreviewEditor,
  staff_grid: StaffGridEditor,
  event_list: EventListEditor,
  map: MapEditor,
  accordion: AccordionEditor,
  columns: ColumnsEditor,
  // Phase 6
  newsletter_signup: NewsletterSignupEditor,
  membership_cta: MembershipCtaEditor,
  venue_card: VenueCardEditor,
  exhibition_grid: ExhibitionGridEditor,
  event_calendar: EventCalendarEditor,
  testimonial: TestimonialEditor,
  social_embed: SocialEmbedEditor,
  sponsor_grid: SponsorGridEditor,
  countdown: CountdownEditor,
  tabs: TabsEditor,
  form: FormEditor,
};

// =============================================================================
// ID Generator
// =============================================================================

let blockCounter = 0;

function generateBlockId(): string {
  blockCounter += 1;
  return `new-block-${Date.now()}-${blockCounter}`;
}

// =============================================================================
// Sortable Block
// =============================================================================

interface SortableBlockProps {
  block: ContentBlock;
  index: number;
  totalBlocks: number;
  isExpanded: boolean;
  organizationId: string;
  onToggleExpand: () => void;
  onContentChange: (content: Record<string, unknown>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function SortableBlock({
  block,
  index,
  totalBlocks,
  isExpanded,
  organizationId,
  onToggleExpand,
  onContentChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: SortableBlockProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.block_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 50 : undefined,
  };

  const config = BLOCK_TYPES[block.block_type];
  const Editor = EDITORS[block.block_type];
  const Icon = config.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'border border-lichen rounded-lg bg-parchment transition-shadow',
        isDragging && 'shadow-lg',
      )}
    >
      {/* Block header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-lichen bg-stone/20">
        {/* Drag handle */}
        <button
          type="button"
          className="shrink-0 cursor-grab active:cursor-grabbing text-archive hover:text-ink touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>

        {/* Type indicator */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={14} className="shrink-0 text-bark" />
          <span className="text-sm font-medium text-ink truncate">
            {config.label}
          </span>
          <span className="text-xs text-archive">
            #{index + 1}
          </span>
        </div>

        <div className="flex-1" />

        {/* Expand/collapse */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="p-1 text-archive hover:text-ink rounded transition-colors"
          title={isExpanded ? 'Collapse block' : 'Expand block'}
        >
          <ChevronRight
            size={14}
            className={cn(
              'transition-transform',
              isExpanded && 'rotate-90',
            )}
          />
        </button>

        {/* Move up/down */}
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          className="p-1 text-archive hover:text-ink rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move up"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === totalBlocks - 1}
          className="p-1 text-archive hover:text-ink rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move down"
        >
          <ChevronDown size={14} />
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          className="p-1 text-archive hover:text-semantic-error rounded transition-colors"
          title="Delete block"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Block editor content */}
      {isExpanded && Editor && (
        <div className="p-4">
          <Editor content={block.content} onChange={onContentChange} organizationId={organizationId} />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Add Block Dropdown
// =============================================================================

interface AddBlockDropdownProps {
  onSelect: (blockType: BlockType) => void;
}

function AddBlockDropdown({ onSelect }: AddBlockDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback(
    (blockType: BlockType) => {
      onSelect(blockType);
      setIsOpen(false);
    },
    [onSelect],
  );

  // Close on click outside
  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.relatedTarget as Node)) {
      setIsOpen(false);
    }
  }, []);

  const blockTypes = Object.entries(BLOCK_TYPES) as [BlockType, BlockTypeConfig][];

  return (
    <div className="relative" ref={dropdownRef} onBlur={handleBlur}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 px-4 py-2.5 w-full border border-dashed border-lichen text-archive rounded-lg hover:border-bark hover:text-bark transition-colors"
      >
        <Plus size={16} />
        <span className="text-sm">Add Block</span>
      </button>

      {isOpen && (
        <div className="absolute z-40 mt-1 w-full bg-parchment border border-lichen rounded-lg shadow-lg overflow-hidden">
          <div className="max-h-80 overflow-y-auto">
            {blockTypes.map(([type, config]) => {
              const Icon = config.icon;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleSelect(type)}
                  className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-stone/50 transition-colors"
                >
                  <Icon size={18} className="shrink-0 text-bark" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">
                      {config.label}
                    </div>
                    <div className="text-xs text-archive truncate">
                      {config.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main Block Editor
// =============================================================================

export function BlockEditor({ blocks, onChange, organizationId }: BlockEditorProps) {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(() => {
    // Expand all blocks initially
    return new Set(blocks.map((b) => b.block_id));
  });

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Handlers
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = blocks.findIndex((b) => b.block_id === active.id);
      const newIndex = blocks.findIndex((b) => b.block_id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(blocks, oldIndex, newIndex).map(
        (block, idx) => ({ ...block, sort_order: idx }),
      );
      onChange(reordered);
    },
    [blocks, onChange],
  );

  const handleContentChange = useCallback(
    (blockId: string, content: Record<string, unknown>) => {
      const updated = blocks.map((b) =>
        b.block_id === blockId ? { ...b, content } : b,
      );
      onChange(updated);
    },
    [blocks, onChange],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      const reordered = arrayMove(blocks, index, index - 1).map(
        (block, idx) => ({ ...block, sort_order: idx }),
      );
      onChange(reordered);
    },
    [blocks, onChange],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index === blocks.length - 1) return;
      const reordered = arrayMove(blocks, index, index + 1).map(
        (block, idx) => ({ ...block, sort_order: idx }),
      );
      onChange(reordered);
    },
    [blocks, onChange],
  );

  const handleDelete = useCallback(
    (blockId: string) => {
      const updated = blocks
        .filter((b) => b.block_id !== blockId)
        .map((block, idx) => ({ ...block, sort_order: idx }));
      onChange(updated);
      setExpandedBlocks((prev) => {
        const next = new Set(prev);
        next.delete(blockId);
        return next;
      });
    },
    [blocks, onChange],
  );

  const handleAddBlock = useCallback(
    (blockType: BlockType) => {
      const config = BLOCK_TYPES[blockType];
      const newBlock: ContentBlock = {
        block_id: generateBlockId(),
        block_type: blockType,
        content: { ...config.defaultContent },
        sort_order: blocks.length,
      };
      onChange([...blocks, newBlock]);
      setExpandedBlocks((prev) => new Set(prev).add(newBlock.block_id));
    },
    [blocks, onChange],
  );

  const toggleExpand = useCallback((blockId: string) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);

  const sortedBlocks = [...blocks].sort((a, b) => a.sort_order - b.sort_order);
  const blockIds = sortedBlocks.map((b) => b.block_id);

  return (
    <div className="space-y-3">
      {sortedBlocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-archive border border-dashed border-lichen rounded-lg">
          <Type size={32} className="mb-3 text-archive/50" />
          <p className="text-sm font-medium mb-1">No content blocks yet</p>
          <p className="text-xs">Add a block below to start building your page</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {sortedBlocks.map((block, index) => (
                <SortableBlock
                  key={block.block_id}
                  block={block}
                  index={index}
                  totalBlocks={sortedBlocks.length}
                  isExpanded={expandedBlocks.has(block.block_id)}
                  organizationId={organizationId}
                  onToggleExpand={() => toggleExpand(block.block_id)}
                  onContentChange={(content) =>
                    handleContentChange(block.block_id, content)
                  }
                  onMoveUp={() => handleMoveUp(index)}
                  onMoveDown={() => handleMoveDown(index)}
                  onDelete={() => handleDelete(block.block_id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AddBlockDropdown onSelect={handleAddBlock} />
    </div>
  );
}

export default BlockEditor;
