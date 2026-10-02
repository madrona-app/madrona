import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus,
  Search,
  Image,
  Film,
  FileText,
  Music,
  ExternalLink,
  X,
  Loader2,
  Star,
  Filter,
  Edit2,
  Check,
} from 'lucide-react';
import { searchMedia } from '../../lib/api';
import type { Media, MediaSearchHit } from '../../lib/schemas';
import SlideOver from '../ui/SlideOver';
import { MadronaLoader } from '../ui/MadronaLoader';

// Generic link parameters that work across contexts
export interface MediaLinkParams {
  media_id: string;
  is_primary?: boolean;
  sort_order?: number;
  caption_override?: string;
  usage_type?: string;
}

// Linked media item shape (generic across contexts)
export interface LinkedMediaItem {
  link_id: string;
  media_id: string;
  is_primary?: boolean;
  caption_override?: string;
  usage_type?: string;
  media?: Media;
}

// Usage type option for different contexts
export interface UsageTypeOption {
  value: string;
  label: string;
}

// Default usage types for collection objects
// Must match check constraint: main, detail, context, conservation, installation, historical, comparison, documentation, other
export const OBJECT_USAGE_TYPES: UsageTypeOption[] = [
  { value: 'main', label: 'Main Image' },
  { value: 'detail', label: 'Detail' },
  { value: 'context', label: 'Context' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'installation', label: 'Installation' },
  { value: 'historical', label: 'Historical' },
  { value: 'comparison', label: 'Comparison' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'other', label: 'Other' },
];

export const CONDITION_REPORT_USAGE_TYPES: UsageTypeOption[] = [
  { value: 'before', label: 'Before Treatment' },
  { value: 'during', label: 'During Treatment' },
  { value: 'after', label: 'After Treatment' },
  { value: 'detail', label: 'Detail/Close-up' },
  { value: 'overview', label: 'Overview' },
];

export const INCIDENT_USAGE_TYPES: UsageTypeOption[] = [
  { value: 'damage', label: 'Damage Documentation' },
  { value: 'scene', label: 'Scene Photo' },
  { value: 'evidence', label: 'Evidence' },
];

export const CONSERVATION_USAGE_TYPES: UsageTypeOption[] = [
  { value: 'before', label: 'Before Treatment' },
  { value: 'during', label: 'During Treatment' },
  { value: 'after', label: 'After Treatment' },
  { value: 'detail', label: 'Detail' },
  { value: 'process', label: 'Process Documentation' },
  { value: 'materials', label: 'Materials Used' },
];

const MEDIA_TYPE_ICONS = {
  image: Image,
  video: Film,
  audio: Music,
  document: FileText,
};

const MEDIA_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'document', label: 'Documents' },
];

interface MediaLibraryLinkerProps {
  organizationId: string;
  // Linked media list
  linkedMedia: LinkedMediaItem[];
  // Callbacks
  onLink: (params: MediaLinkParams) => Promise<void>;
  onUnlink: (linkId: string) => Promise<void>;
  onSetPrimary?: (linkId: string) => Promise<void>;
  onUpdateLink?: (mediaId: string, updates: { caption_override?: string; usage_type?: string }) => Promise<void>;
  // Configuration
  title?: string;
  usageTypes?: UsageTypeOption[];
  showPrimary?: boolean;
  isEditing?: boolean;
  isLoading?: boolean;
  /** Whether the Media application is enabled. When false, hides library search/link and "View in library" links. */
  hasMediaApp?: boolean;
  // For SlideOver customization
  slideOverTitle?: string;
  slideOverSubtitle?: string;
}

/**
 * Flexible media library linker component.
 * Can be used to link media from the library to various entities:
 * - Collection objects
 * - Condition reports
 * - Conservation treatments
 * - Incident reports
 * - And more...
 */
export function MediaLibraryLinker({
  organizationId,
  linkedMedia,
  onLink,
  onUnlink,
  onSetPrimary,
  onUpdateLink,
  title = 'Linked Media',
  usageTypes,
  showPrimary = true,
  isEditing = false,
  isLoading = false,
  hasMediaApp = true,
  slideOverTitle = 'Link Media from Library',
  slideOverSubtitle = 'Search for media in your library to link',
}: MediaLibraryLinkerProps) {
  const [showSlideOver, setShowSlideOver] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleUpdateLink = async (mediaId: string, updates: { caption_override?: string; usage_type?: string }) => {
    if (!onUpdateLink) return;
    setUpdatingId(mediaId);
    try {
      await onUpdateLink(mediaId, updates);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleUnlink = async (linkId: string) => {
    setUnlinkingId(linkId);
    try {
      await onUnlink(linkId);
    } finally {
      setUnlinkingId(null);
    }
  };

  const handleSetPrimary = async (linkId: string) => {
    if (!onSetPrimary) return;
    setSettingPrimaryId(linkId);
    try {
      await onSetPrimary(linkId);
    } finally {
      setSettingPrimaryId(null);
    }
  };

  const linkedMediaIds = new Set(linkedMedia.map(m => m.media_id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-ink">
          {title} ({linkedMedia.length})
        </h4>
        {isEditing && hasMediaApp && (
          <button
            onClick={() => setShowSlideOver(true)}
            className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
          >
            <Plus size={14} />
            Link Media
          </button>
        )}
      </div>

      {/* Linked Media List */}
      {isLoading ? (
        <MadronaLoader variant="dots" />
      ) : linkedMedia.length === 0 ? (
        <div className="text-sm text-archive italic py-4 text-center">
          No media linked.
          {isEditing && hasMediaApp && (
            <button
              onClick={() => setShowSlideOver(true)}
              className="block mx-auto mt-2 text-bark hover:text-copper-dark"
            >
              Link media from library
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {linkedMedia.map((item) => (
            <MediaLinkCard
              key={item.link_id}
              item={item}
              organizationId={organizationId}
              showPrimary={showPrimary}
              usageTypes={usageTypes}
              isEditing={isEditing}
              isUnlinking={unlinkingId === item.link_id}
              isSettingPrimary={settingPrimaryId === item.link_id}
              isUpdating={updatingId === item.media_id}
              hasMediaApp={hasMediaApp}
              onUnlink={() => handleUnlink(item.link_id)}
              onSetPrimary={onSetPrimary ? () => handleSetPrimary(item.link_id) : undefined}
              onUpdateLink={onUpdateLink ? (updates) => handleUpdateLink(item.media_id, updates) : undefined}
            />
          ))}
        </div>
      )}

      {/* Link Media SlideOver */}
      <LinkMediaSlideOver
        isOpen={showSlideOver}
        organizationId={organizationId}
        linkedMediaIds={linkedMediaIds}
        usageTypes={usageTypes}
        title={slideOverTitle}
        subtitle={slideOverSubtitle}
        onClose={() => setShowSlideOver(false)}
        onLink={async (params) => {
          await onLink(params);
          setShowSlideOver(false);
        }}
      />
    </div>
  );
}

// Individual media link card with inline editing
interface MediaLinkCardProps {
  item: LinkedMediaItem;
  organizationId: string;
  showPrimary: boolean;
  usageTypes?: UsageTypeOption[];
  isEditing: boolean;
  isUnlinking: boolean;
  isSettingPrimary: boolean;
  isUpdating: boolean;
  hasMediaApp: boolean;
  onUnlink: () => void;
  onSetPrimary?: () => void;
  onUpdateLink?: (updates: { caption_override?: string; usage_type?: string }) => void;
}

function MediaLinkCard({
  item,
  organizationId,
  showPrimary,
  usageTypes,
  isEditing,
  isUnlinking,
  isSettingPrimary,
  isUpdating,
  hasMediaApp,
  onUnlink,
  onSetPrimary,
  onUpdateLink,
}: MediaLinkCardProps) {
  const media = item.media;
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(item.caption_override || '');

  if (!media) return null;

  const Icon = MEDIA_TYPE_ICONS[media.media_type as keyof typeof MEDIA_TYPE_ICONS] || FileText;
  const isImage = media.media_type === 'image';

  const handleSaveCaption = () => {
    if (onUpdateLink) {
      onUpdateLink({ caption_override: captionDraft || undefined });
    }
    setIsEditingCaption(false);
  };

  const handleUsageTypeChange = (newUsageType: string) => {
    if (onUpdateLink) {
      onUpdateLink({ usage_type: newUsageType || undefined });
    }
  };

  return (
    <div className="flex gap-3 p-3 bg-stone/30 rounded-lg group">
      {/* Thumbnail */}
      <div className="w-16 h-16 flex-shrink-0 rounded overflow-hidden bg-stone relative">
        {isImage && (media.thumbnail_url || media.preview_url) ? (
          <img
            src={media.thumbnail_url ?? media.preview_url ?? undefined}
            alt={media.alt_text || media.title || media.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Icon className="w-8 h-8 text-archive" />
          </div>
        )}
        {/* Primary badge on thumbnail */}
        {showPrimary && item.is_primary && (
          <div className="absolute top-0.5 left-0.5 p-0.5 bg-semantic-warning/100 text-parchment rounded">
            <Star size={10} fill="currentColor" />
          </div>
        )}
      </div>

      {/* Info & Editable Fields */}
      <div className="flex-1 min-w-0">
        {/* Title row with badges and actions */}
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-medium text-ink truncate flex-1">
            {media.title || media.filename}
          </p>
          {showPrimary && item.is_primary && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-semantic-warning/100 text-parchment rounded text-[10px] font-medium flex-shrink-0">
              <Star size={8} fill="currentColor" />
              Primary
            </span>
          )}
          {/* Actions - always visible in edit mode */}
          {isEditing && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {showPrimary && onSetPrimary && !item.is_primary && isImage && (
                <button
                  onClick={onSetPrimary}
                  disabled={isSettingPrimary}
                  className="p-1 text-archive hover:text-semantic-warning disabled:opacity-50"
                  title="Set as primary"
                >
                  {isSettingPrimary ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
                </button>
              )}
              {hasMediaApp && (
                <Link
                  to={`/organizations/${organizationId}/media/${item.media_id}`}
                  className="p-1 text-archive hover:text-bark"
                  title="View in library"
                >
                  <ExternalLink size={14} />
                </Link>
              )}
              <button
                onClick={onUnlink}
                disabled={isUnlinking}
                className="p-1 text-archive hover:text-semantic-error disabled:opacity-50"
                title="Unlink"
              >
                {isUnlinking ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              </button>
            </div>
          )}
        </div>

        {/* Usage type - editable select in edit mode */}
        {isEditing && usageTypes && usageTypes.length > 0 ? (
          <div className="mb-1.5">
            <select
              value={item.usage_type || ''}
              onChange={(e) => handleUsageTypeChange(e.target.value)}
              disabled={isUpdating}
              className="text-xs px-2 py-1 border border-lichen rounded bg-parchment focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <option value="">Select usage type...</option>
              {usageTypes.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : item.usage_type && (
          <div className="mb-1.5">
            <span className="px-1.5 py-0.5 bg-bark/20 text-bark rounded text-[10px]">
              {usageTypes?.find(t => t.value === item.usage_type)?.label || item.usage_type}
            </span>
          </div>
        )}

        {/* Caption - editable in edit mode */}
        {isEditing && onUpdateLink ? (
          isEditingCaption ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={captionDraft}
                onChange={(e) => setCaptionDraft(e.target.value)}
                placeholder="Add a caption..."
                className="flex-1 text-xs px-2 py-1 border border-lichen rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveCaption();
                  } else if (e.key === 'Escape') {
                    setCaptionDraft(item.caption_override || '');
                    setIsEditingCaption(false);
                  }
                }}
              />
              <button
                onClick={handleSaveCaption}
                disabled={isUpdating}
                className="p-1 text-semantic-success hover:bg-semantic-success/10 rounded"
              >
                {isUpdating ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              </button>
              <button
                onClick={() => {
                  setCaptionDraft(item.caption_override || '');
                  setIsEditingCaption(false);
                }}
                className="p-1 text-archive hover:bg-stone rounded"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-xs text-archive flex-1 truncate">
                {item.caption_override || <span className="italic">No caption</span>}
              </p>
              <button
                onClick={() => {
                  setCaptionDraft(item.caption_override || '');
                  setIsEditingCaption(true);
                }}
                className="p-1 text-archive hover:text-bark"
                title="Edit caption"
              >
                <Edit2 size={12} />
              </button>
            </div>
          )
        ) : item.caption_override ? (
          <p className="text-xs text-archive truncate" title={item.caption_override}>
            {item.caption_override}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// SlideOver for linking media from library
interface LinkMediaSlideOverProps {
  isOpen: boolean;
  organizationId: string;
  linkedMediaIds: Set<string>;
  usageTypes?: UsageTypeOption[];
  title: string;
  subtitle: string;
  onClose: () => void;
  onLink: (params: MediaLinkParams) => Promise<void>;
}

function LinkMediaSlideOver({
  isOpen,
  organizationId,
  linkedMediaIds,
  usageTypes,
  title,
  subtitle,
  onClose,
  onLink,
}: LinkMediaSlideOverProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<MediaSearchHit | null>(null);
  const [usageType, setUsageType] = useState('');
  const [caption, setCaption] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  // Search media
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['media-search', organizationId, searchTerm, mediaTypeFilter],
    queryFn: () => searchMedia(organizationId, {
      q: searchTerm || undefined,
      media_type: mediaTypeFilter || undefined,
      limit: 24,
    }),
    enabled: isOpen && (searchTerm.length >= 2 || mediaTypeFilter !== ''),
  });

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    if (value.length >= 2) {
      setHasSearched(true);
    }
  };

  const handleSelectMedia = (media: MediaSearchHit) => {
    setSelectedMedia(media);
  };

  const handleLink = async () => {
    if (!selectedMedia) {
      setError('Please select media to link');
      return;
    }

    setError(null);
    setIsLinking(true);

    try {
      await onLink({
        media_id: selectedMedia.media_id,
        usage_type: usageType || undefined,
        caption_override: caption || undefined,
      });
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link media');
    } finally {
      setIsLinking(false);
    }
  };

  const resetForm = () => {
    setSearchTerm('');
    setMediaTypeFilter('');
    setSelectedMedia(null);
    setUsageType('');
    setCaption('');
    setHasSearched(false);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Filter out already linked media
  const availableMedia = (searchResults?.hits || []).filter(
    (m) => !linkedMediaIds.has(m.media_id)
  );

  const showNoResults = hasSearched && !isSearching && (searchTerm.length >= 2 || mediaTypeFilter) && availableMedia.length === 0;

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      subtitle={subtitle}
      width="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={handleClose} className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50">
            Cancel
          </button>
          <button
            onClick={handleLink}
            disabled={isLinking || !selectedMedia}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 flex items-center gap-2"
          >
            {isLinking ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Linking...
              </>
            ) : (
              'Link Media'
            )}
          </button>
        </div>
      }
    >
      <div className="flex flex-col h-full -my-5">
        {/* Error message */}
        {error && (
          <div className="p-3 mx-1 mt-5 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {/* Search and filters - fixed at top */}
        <div className="flex gap-3 p-1 pt-5 flex-shrink-0">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search media by title, filename..."
              className="w-full pl-9 pr-4 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
              autoFocus
            />
          </div>
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive pointer-events-none" />
            <select
              value={mediaTypeFilter}
              onChange={(e) => {
                setMediaTypeFilter(e.target.value);
                setHasSearched(true);
              }}
              className="pl-9 pr-8 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark appearance-none bg-parchment"
            >
              {MEDIA_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Search Results Grid - fills remaining space */}
        <div className="flex-1 min-h-0 mt-4 border border-lichen rounded-lg overflow-hidden flex flex-col">
          {!hasSearched && searchTerm.length < 2 && !mediaTypeFilter ? (
            <div className="p-8 text-center text-archive text-sm">
              Type at least 2 characters to search, or filter by type...
            </div>
          ) : isSearching ? (
            <div className="p-8 text-center text-archive">
              <Loader2 size={20} className="inline animate-spin mr-2" />
              Searching...
            </div>
          ) : availableMedia.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 overflow-y-auto flex-1 content-start">
              {availableMedia.map((media) => {
                const Icon = MEDIA_TYPE_ICONS[media.media_type as keyof typeof MEDIA_TYPE_ICONS] || FileText;
                const isImage = media.media_type === 'image';
                const isSelected = selectedMedia?.media_id === media.media_id;
                const imageUrl = media.thumbnail_url || media.url;
                const displayName = media.title || media.filename;

                return (
                  <button
                    key={media.media_id}
                    type="button"
                    onClick={() => handleSelectMedia(media)}
                    className={`relative rounded-lg overflow-hidden border-2 transition-all text-left ${
                      isSelected
                        ? 'border-bark ring-2 ring-bark/20 bg-bark/5'
                        : 'border-lichen hover:border-bark/50 bg-parchment'
                    }`}
                  >
                    <div className="aspect-square bg-stone/30 flex items-center justify-center relative">
                      {isImage && imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Icon className="w-8 h-8 text-archive" />
                      )}
                      {isSelected && (
                        <div className="absolute inset-0 bg-bark/20 flex items-center justify-center">
                          <div className="bg-bark text-parchment rounded-full p-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>
                      )}
                      {/* Media type badge */}
                      <span className="absolute top-1 right-1 bg-ink/60 text-parchment text-[10px] px-1.5 py-0.5 rounded capitalize">
                        {media.media_type}
                      </span>
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium text-ink truncate" title={displayName}>
                        {displayName}
                      </p>
                      {media.creator && (
                        <p className="text-[10px] text-archive truncate">{media.creator}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : showNoResults ? (
            <div className="p-8 text-center text-archive text-sm">
              No media found matching your search
            </div>
          ) : null}
        </div>

        {/* Selected media details - fixed at bottom */}
        {selectedMedia && (
          <div className="flex-shrink-0 p-3 mt-4 bg-bark/5 border border-bark/20 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 bg-stone/30 rounded flex-shrink-0 overflow-hidden">
                {selectedMedia.media_type === 'image' && (selectedMedia.thumbnail_url || selectedMedia.url) ? (
                  <img
                    src={selectedMedia.thumbnail_url || selectedMedia.url || ''}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {(() => {
                      const Icon = MEDIA_TYPE_ICONS[selectedMedia.media_type as keyof typeof MEDIA_TYPE_ICONS] || FileText;
                      return <Icon className="w-5 h-5 text-archive" />;
                    })()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">
                  {selectedMedia.title || selectedMedia.filename}
                </p>
                <p className="text-xs text-archive">
                  {selectedMedia.media_type} • {formatFileSize(selectedMedia.file_size)}
                </p>
              </div>
              {/* Inline usage type and caption */}
              <div className="flex gap-2 flex-shrink-0">
                {usageTypes && usageTypes.length > 0 && (
                  <select
                    value={usageType}
                    onChange={(e) => setUsageType(e.target.value)}
                    className="px-2 py-1 border border-lichen rounded text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  >
                    <option value="">Usage...</option>
                    {usageTypes.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Caption..."
                  className="w-32 px-2 py-1 border border-lichen rounded text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </SlideOver>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default MediaLibraryLinker;
