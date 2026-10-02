import { useState } from 'react';
import { Image, ZoomIn, Star } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { MediaManager } from '../../../components/collections/MediaManager';
import { MediaLibraryLinker, OBJECT_USAGE_TYPES, type LinkedMediaItem } from '../../../components/collections/MediaLibraryLinker';
import IIIFViewer from '../../../components/IIIFViewer';
import { getDisplayTitle } from '../../../components/collections/ObjectFieldComponents';
import { cn } from '../../../lib/utils';
import type { CollectionObject } from '../../../lib/schemas';

interface MediaSectionProps {
  orgId: string;
  objectId: string;
  object: CollectionObject;
  isEditing: boolean;
  isCreateMode: boolean;
  linkedMedia: LinkedMediaItem[];
  isLoadingMedia: boolean;
  expandedSections: Record<string, boolean>;
  toggleSection: (sectionId: string) => void;
  sectionRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  getSectionOrder: (sectionId: string) => number;
  isEmpty?: boolean;
  sectionSummaries?: Record<string, string | undefined>;
  /** Whether the Media application is enabled for this org */
  hasMediaApp?: boolean;
  onLinkMedia: (params: { media_id: string; usage_type?: string; caption_override?: string }) => Promise<void>;
  onUnlinkMedia: (mediaId: string) => Promise<void>;
  onSetPrimary: (mediaId: string) => Promise<void>;
  onUpdateLink: (mediaId: string, updates: { caption_override?: string; usage_type?: string }) => Promise<void>;
}

export function MediaSection({
  orgId,
  objectId,
  object,
  isEditing,
  isCreateMode,
  linkedMedia,
  isLoadingMedia,
  expandedSections,
  toggleSection,
  sectionRefs,
  getSectionOrder,
  isEmpty,
  sectionSummaries,
  hasMediaApp = true,
  onLinkMedia,
  onUnlinkMedia,
  onSetPrimary,
  onUpdateLink,
}: MediaSectionProps) {
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [showIIIFViewer, setShowIIIFViewer] = useState(false);

  if (isCreateMode || !objectId) return null;

  const displayTitle = getDisplayTitle(object);

  return (
    <>
      <WorkspaceSection
        id="media"
        title="Media"
        icon={<Image size={18} />}
        hint={sectionSummaries?.media}
        isEmpty={isEmpty}
        isExpanded={expandedSections.media}
        onToggle={() => toggleSection('media')}
        isEditing={isEditing}
        sectionRef={(el) => { sectionRefs.current['media'] = el; }}
        order={getSectionOrder('media')}
      >
        {/* VIEW MODE - Enhanced Gallery */}
        {!isEditing && linkedMedia.length > 0 ? (
          <div className="space-y-4">
            {/* Main Image Display */}
            {(() => {
              const displayItem = selectedMediaId
                ? linkedMedia.find(m => m.media_id === selectedMediaId)
                : linkedMedia.find(m => m.is_primary) || linkedMedia[0];
              const displayMedia = displayItem?.media;

              if (!displayMedia) return null;

              return (
                <div className="space-y-2">
                  {/* Main Image */}
                  <div className="relative rounded-lg overflow-hidden bg-stone group">
                    <img
                      src={displayMedia.preview_url || displayMedia.thumbnail_url || displayMedia.url || undefined}
                      alt={displayMedia.alt_text || displayMedia.title || displayTitle}
                      className="w-full max-h-[50vh] object-contain cursor-pointer"
                      onClick={() => setShowIIIFViewer(true)}
                    />
                    <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setShowIIIFViewer(true)}
                        className="flex items-center gap-2 px-3 py-2 bg-ink/70 hover:bg-ink/90 text-parchment rounded-lg"
                      >
                        <ZoomIn size={18} />
                        <span className="text-sm">Deep Zoom</span>
                      </button>
                    </div>
                    {displayItem?.is_primary && (
                      <div className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 bg-semantic-warning/100 text-parchment rounded text-xs font-medium">
                        <Star size={12} fill="currentColor" />
                        Primary Image
                      </div>
                    )}
                    {displayItem?.usage_type && (
                      <div className="absolute top-3 right-3 px-2 py-1 bg-bark/80 text-parchment rounded text-xs">
                        {OBJECT_USAGE_TYPES.find(t => t.value === displayItem.usage_type)?.label || displayItem.usage_type}
                      </div>
                    )}
                  </div>
                  {(displayItem?.caption_override || displayMedia.description) && (
                    <p className="text-sm text-archive px-1">
                      {displayItem?.caption_override || displayMedia.description}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Thumbnail Gallery */}
            {linkedMedia.length > 1 && (
              <div className="pt-3 border-t border-lichen">
                <p className="text-xs font-medium text-archive mb-2">
                  {linkedMedia.length} images attached
                </p>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                  {linkedMedia.map((item) => {
                    const media = item.media;
                    if (!media) return null;
                    const isSelected = selectedMediaId === item.media_id ||
                      (!selectedMediaId && item.is_primary) ||
                      (!selectedMediaId && !linkedMedia.some(m => m.is_primary) && item === linkedMedia[0]);

                    return (
                      <button
                        key={item.media_id}
                        onClick={() => setSelectedMediaId(item.media_id)}
                        className={cn(
                          'relative aspect-square rounded overflow-hidden border-2 transition-colors',
                          isSelected
                            ? 'border-bark ring-2 ring-bark/30'
                            : 'border-lichen hover:border-bark/50'
                        )}
                      >
                        <img
                          src={media.thumbnail_url || media.preview_url || undefined}
                          alt={media.alt_text || media.title || ''}
                          className="w-full h-full object-cover"
                        />
                        {item.is_primary && (
                          <div className="absolute top-0.5 left-0.5 p-0.5 bg-semantic-warning/100 text-parchment rounded">
                            <Star size={10} fill="currentColor" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : !isEditing ? (
          <div className="text-sm text-archive italic py-4 text-center">
            No media attached to this object.
          </div>
        ) : (
          /* EDIT MODE */
          <div className="space-y-6">
            {/* Upload new media */}
            <div>
              <h5 className="text-sm font-medium text-ink mb-3">Upload New Media</h5>
              <MediaManager
                organizationId={orgId}
                objectId={objectId}
              />
            </div>

            {/* Linked media with inline caption/metadata editing */}
            <div className="pt-4 border-t border-lichen">
              <MediaLibraryLinker
                organizationId={orgId}
                linkedMedia={linkedMedia}
                onLink={onLinkMedia}
                onUnlink={onUnlinkMedia}
                onSetPrimary={onSetPrimary}
                onUpdateLink={onUpdateLink}
                title="Attached Media"
                usageTypes={OBJECT_USAGE_TYPES}
                showPrimary={true}
                isEditing={isEditing}
                isLoading={isLoadingMedia}
                hasMediaApp={hasMediaApp}
                slideOverTitle="Link Media from Library"
                slideOverSubtitle="Select existing media to link to this object"
              />
            </div>
          </div>
        )}
      </WorkspaceSection>

      {/* IIIF Viewer Modal */}
      {showIIIFViewer && linkedMedia.length > 0 && (
        <IIIFViewer
          manifestUrl={`/api/organizations/${orgId}/iiif/objects/${objectId}/manifest.json`}
          showNavigation={true}
          showInfo={true}
          modal={true}
          onClose={() => setShowIIIFViewer(false)}
        />
      )}
    </>
  );
}
