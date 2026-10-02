/**
 * MediaWorkspaceAddAssetsDialog - Search and add media assets to a DAM workspace
 *
 * Allows users to:
 * - Search the media library
 * - Select multiple assets
 * - Add selected assets to the current workspace
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Search,
  Check,
  Image,
  FileText,
  Video,
  Music,
  Loader2,
  Plus,
} from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { cn } from '../../lib/utils';
import { searchMedia, addMediaWorkspaceItems } from '../../lib/api';
import type { MediaSearchHit } from '../../lib/schemas';
import { ModalPortal } from '../ModalPortal';

interface MediaWorkspaceAddAssetsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName?: string;
}

const MEDIA_TYPE_ICONS: Record<string, typeof Image> = {
  image: Image,
  video: Video,
  audio: Music,
  document: FileText,
};

export default function MediaWorkspaceAddAssetsDialog({
  isOpen,
  onClose,
  workspaceId,
  workspaceName,
}: MediaWorkspaceAddAssetsDialogProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const queryClient = useQueryClient();

  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'search-media-for-workspace',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());
  const [mediaTypeFilter, setMediaTypeFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Search media
  const { data: mediaData, isLoading, isFetching } = useQuery({
    queryKey: ['media-search-for-workspace', orgId, searchQuery, mediaTypeFilter],
    queryFn: () =>
      searchMedia(orgId!, {
        q: searchQuery || undefined,
        media_type: mediaTypeFilter || undefined,
        limit: 50,
      }),
    enabled: !!orgId && isOpen,
    staleTime: 30000,
  });

  const media = mediaData?.hits ?? [];

  // Add to workspace mutation
  const addMutation = useMutation({
    mutationFn: () => addMediaWorkspaceItems(orgId!, workspaceId, Array.from(selectedMediaIds)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-workspace', orgId, workspaceId] });
      setSuccess(true);
      setError(null);
      // Auto-close after success
      setTimeout(() => {
        handleClose();
      }, 1500);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to add assets to workspace');
    },
  });

  const handleClose = useCallback(() => {
    setSearchQuery('');
    setSelectedMediaIds(new Set());
    setMediaTypeFilter('');
    setError(null);
    setSuccess(false);
    onClose();
  }, [onClose]);

  const toggleMediaSelection = (mediaId: string) => {
    setSelectedMediaIds((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) {
        next.delete(mediaId);
      } else {
        next.add(mediaId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedMediaIds(new Set(media.map((m: MediaSearchHit) => m.media_id)));
  };

  const clearSelection = () => {
    setSelectedMediaIds(new Set());
  };

  const handleAdd = () => {
    if (selectedMediaIds.size > 0) {
      addMutation.mutate();
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        onClick={(e) => e.stopPropagation()}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center justify-between">
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-ink">
                Add Assets to Workspace
              </h2>
              <p id={descriptionId} className="text-sm text-archive">
                {workspaceName ? `Adding to "${workspaceName}"` : 'Search and select assets to add'}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-1 text-archive hover:text-ink rounded transition-colors"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="px-6 py-3 border-b border-lichen bg-parchment/30">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-archive"
              />
              <input
                type="text"
                placeholder="Search media..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                autoFocus
              />
            </div>
            <select
              value={mediaTypeFilter}
              onChange={(e) => setMediaTypeFilter(e.target.value)}
              className="px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            >
              <option value="">All Types</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="audio">Audio</option>
              <option value="document">Documents</option>
            </select>
          </div>

          {/* Selection controls */}
          {media.length > 0 && (
            <div className="flex items-center gap-3 mt-3 text-sm">
              <span className="text-archive">
                {selectedMediaIds.size} of {media.length} selected
              </span>
              <button
                onClick={selectAll}
                className="text-bark hover:underline"
              >
                Select all
              </button>
              {selectedMediaIds.size > 0 && (
                <button
                  onClick={clearSelection}
                  className="text-archive hover:text-ink"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {success ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-semantic-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-semantic-success" />
              </div>
              <p className="text-lg font-medium text-ink">
                Added {selectedMediaIds.size} asset{selectedMediaIds.size !== 1 ? 's' : ''} to workspace!
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
                  {error}
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={32} className="animate-spin text-archive" />
                </div>
              ) : media.length === 0 ? (
                <div className="text-center py-12">
                  <Image size={48} className="mx-auto text-archive mb-4" />
                  <p className="text-ink font-medium">No media found</p>
                  <p className="text-sm text-archive mt-1">
                    {searchQuery
                      ? 'Try adjusting your search terms'
                      : 'Upload media to the Media Library first'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                  {media.map((item: MediaSearchHit) => {
                    const Icon = MEDIA_TYPE_ICONS[item.media_type] || FileText;
                    const isSelected = selectedMediaIds.has(item.media_id);

                    return (
                      <button
                        key={item.media_id}
                        onClick={() => toggleMediaSelection(item.media_id)}
                        className={cn(
                          'relative aspect-square rounded-sm overflow-hidden border-2 transition-all',
                          isSelected
                            ? 'border-bark ring-2 ring-bark/20'
                            : 'border-transparent hover:border-lichen'
                        )}
                      >
                        {item.thumbnail_url ? (
                          <img
                            src={item.thumbnail_url}
                            alt={item.title || item.filename}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-stone/50 flex items-center justify-center">
                            <Icon size={24} className="text-archive" />
                          </div>
                        )}

                        {/* Selection indicator */}
                        <div
                          className={cn(
                            'absolute top-1 right-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
                            isSelected
                              ? 'bg-bark border-bark'
                              : 'bg-parchment/80 border-lichen'
                          )}
                        >
                          {isSelected && <Check size={12} className="text-parchment" />}
                        </div>

                        {/* Title tooltip on hover */}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 hover:opacity-100 transition-opacity">
                          <p className="text-xs text-parchment truncate">
                            {item.title || item.filename}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {isFetching && !isLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={20} className="animate-spin text-archive" />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="px-6 py-4 border-t border-lichen flex items-center justify-between">
            <div className="text-sm text-archive">
              {selectedMediaIds.size > 0 && (
                <span>{selectedMediaIds.size} asset{selectedMediaIds.size !== 1 ? 's' : ''} selected</span>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm text-ink hover:bg-stone/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={selectedMediaIds.size === 0 || addMutation.isPending}
                className="px-4 py-2 bg-bark text-parchment rounded-sm text-sm hover:bg-bark/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {addMutation.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Add {selectedMediaIds.size > 0 ? selectedMediaIds.size : ''} Asset{selectedMediaIds.size !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </ModalPortal>
  );
}
