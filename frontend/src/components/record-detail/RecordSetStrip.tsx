/**
 * RecordSetStrip - Bottom filmstrip bar showing records in the active workspace
 *
 * When a workspace is set as the active context, this fixed-bottom strip shows
 * thumbnail cards for each item in the workspace. The current record is highlighted.
 * Clicking a card navigates to that record.
 *
 * Rendered at the AppShell level, visible across Collections and Media pages.
 * Suppressed on the WorkspaceDetailPage itself (redundant there).
 *
 * Features:
 * - Prev/Next keyboard navigation (arrow keys when strip is focused)
 * - Quick Actions button for bulk operations on the workspace
 * - Handles workspaces with more items than the fetch limit
 * - Works with both Collections workspaces and Media (DAM) workspaces
 */

import { useRef, useEffect, useCallback, useState, type DragEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  SkipBack,
  SkipForward,
  Zap,
  ExternalLink,
  X,
  Image as ImageIcon,
  Plus,
  Trash2,
} from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useActiveProduct } from '../../hooks/useActiveProduct';
import {
  getActiveContext,
  listWorkspaceItems,
  addWorkspaceItems,
  removeWorkspaceItems,
  clearActiveContext,
  getMediaActiveContext,
  listMediaWorkspaceItems,
  addMediaWorkspaceItems,
  removeMediaWorkspaceItems,
  clearMediaActiveContext,
} from '../../lib/api';
import { BulkActionDialog } from '../workspaces';
import { MediaBulkActionDialog } from '../media-workspaces';
import ConfirmDialog from '../ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import { cn } from '../../lib/utils';
import { getDragPayload, clearDragPayload } from '../../lib/dragTypes';
import type { WorkspaceItem, MediaWorkspaceItem } from '../../lib/schemas';

// Storage key for collapsed state
const STORAGE_KEY_COLLAPSED = 'madrona.recordSetStrip.collapsed';

// Max items to fetch for the filmstrip
const STRIP_FETCH_LIMIT = 100;

/** Normalized item shape for the filmstrip, common across products. */
interface StripItem {
  id: string;
  itemKey: string | null | undefined;
  thumbnailUrl: string | null | undefined;
  label: string;
  title: string;
  href: string;
}

/**
 * Extracts the record ID from the current URL path based on product.
 * Collections: /organizations/:orgId/collections/objects/:objectId
 * Media:       /organizations/:orgId/media/:mediaId
 */
function useCurrentRecordId(): { objectId: string | null; mediaId: string | null } {
  const location = useLocation();
  const objectMatch = location.pathname.match(
    /\/organizations\/[^/]+\/collections\/objects\/([^/]+)/
  );
  const mediaMatch = location.pathname.match(
    /\/organizations\/[^/]+\/media\/([^/]+)$/
  );
  return {
    objectId: objectMatch?.[1] ?? null,
    mediaId: mediaMatch?.[1] ?? null,
  };
}

export function RecordSetStrip() {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const { activeProductId } = useActiveProduct();
  const { objectId: detectedObjectId, mediaId: detectedMediaId } = useCurrentRecordId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const isCollections = activeProductId === 'collections';
  const isMedia = activeProductId === 'media';

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLAnchorElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_COLLAPSED) === 'true';
    } catch {
      return false;
    }
  });

  const [showBulkActions, setShowBulkActions] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<StripItem | null>(null);
  const { showToast } = useToast();

  // Persist collapsed state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_COLLAPSED, String(isCollapsed));
    } catch {
      // ignore
    }
  }, [isCollapsed]);

  // Refetch context on navigation (e.g. leaving workspace detail page)
  const location = useLocation();

  // ── Collections context ──────────────────────────────────────────────
  const { data: collectionsContextData, refetch: refetchCollections } = useQuery({
    queryKey: ['active-context', orgId],
    queryFn: () => getActiveContext(orgId!),
    enabled: !!orgId && isCollections,
    refetchInterval: 30000,
  });

  // ── Media context ────────────────────────────────────────────────────
  const { data: mediaContextData, refetch: refetchMedia } = useQuery({
    queryKey: ['media-active-context', orgId],
    queryFn: () => getMediaActiveContext(orgId!),
    enabled: !!orgId && isMedia,
    refetchInterval: 30000,
  });

  // Refetch context when the route changes (picks up context set on other pages)
  useEffect(() => {
    if (isCollections) refetchCollections();
    if (isMedia) refetchMedia();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Unify context across products ────────────────────────────────────
  let isWorkspace = false;
  let workspaceId: string | undefined;
  let workspaceName: string | undefined;
  let contextItemCount = 0;

  if (isCollections) {
    const ctx = collectionsContextData?.context;
    isWorkspace = ctx?.type === 'workspace';
    workspaceId = ctx?.workspace?.workspace_id;
    workspaceName = ctx?.workspace?.name;
    contextItemCount = ctx?.workspace?.object_count ?? 0;
  } else if (isMedia) {
    const ctx = mediaContextData?.context;
    isWorkspace = ctx?.type === 'media_workspace';
    workspaceId = ctx?.workspace?.workspace_id;
    workspaceName = ctx?.workspace?.name;
    contextItemCount = ctx?.workspace?.asset_count ?? 0;
  }

  // ── Drag-and-drop: accept objects from the cataloging list ──────────
  //
  // Uses HTML5 native drag (not @dnd-kit) because the source (list page)
  // and the target (this strip) live in different React subtrees. Native
  // drag doesn't need a shared DndContext provider.

  // Drag-and-drop uses module-level shared state (getDragPayload) instead
  // of dataTransfer because the source (list page) and target (this strip)
  // are in different React subtrees, and dataTransfer.getData() proved
  // unreliable for custom MIME types across browsers.

  const dropObjectMutation = useMutation({
    mutationFn: (objectId: string) =>
      addWorkspaceItems(orgId!, workspaceId!, [objectId]),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ['workspace-items-strip', orgId, workspaceId],
      });
      showToast({
        type: result.added_count > 0 ? 'success' : 'info',
        title: result.added_count > 0 ? 'Added to work set' : 'Already in work set',
      });
    },
    onError: () => {
      showToast({ type: 'error', title: 'Failed to add to work set' });
    },
  });

  const dropMediaMutation = useMutation({
    mutationFn: (mediaId: string) =>
      addMediaWorkspaceItems(orgId!, workspaceId!, [mediaId]),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ['media-workspace-items-strip', orgId, workspaceId],
      });
      showToast({
        type: result.added_count > 0 ? 'success' : 'info',
        title: result.added_count > 0 ? 'Added to work set' : 'Already in work set',
      });
    },
    onError: () => {
      showToast({ type: 'error', title: 'Failed to add to work set' });
    },
  });

  const removeObjectMutation = useMutation({
    mutationFn: (objectId: string) =>
      removeWorkspaceItems(orgId!, workspaceId!, [objectId], 'objects'),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['workspace-items-strip', orgId, workspaceId],
      });
      queryClient.invalidateQueries({ queryKey: ['active-context', orgId] });
      showToast({ type: 'success', title: 'Removed from work set' });
    },
    onError: () => {
      showToast({ type: 'error', title: 'Failed to remove from work set' });
    },
  });

  const removeMediaMutation = useMutation({
    mutationFn: (mediaId: string) =>
      removeMediaWorkspaceItems(orgId!, workspaceId!, [mediaId]),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['media-workspace-items-strip', orgId, workspaceId],
      });
      queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
      showToast({ type: 'success', title: 'Removed from work set' });
    },
    onError: () => {
      showToast({ type: 'error', title: 'Failed to remove from work set' });
    },
  });

  const handleConfirmDelete = useCallback(() => {
    if (!itemToDelete) return;
    if (isCollections) {
      removeObjectMutation.mutate(itemToDelete.id);
    } else if (isMedia) {
      removeMediaMutation.mutate(itemToDelete.id);
    }
  }, [itemToDelete, isCollections, isMedia, removeObjectMutation, removeMediaMutation]);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      // Accept any drag while a module-level payload is set and a workspace
      // is active. We can't inspect the payload kind during dragover (it's
      // set synchronously on dragstart in another component), but checking
      // getDragPayload() !== null is the gate.
      if (!getDragPayload()) return;
      if (!workspaceId) return;
      e.preventDefault();
      // Don't force dropEffect — the source sets effectAllowed and the
      // browser picks a compatible effect. Media library uses 'move'
      // (for folder drops); forcing 'copy' here made the browser reject
      // the drop because 'copy' ∉ {'move'}.
    },
    [workspaceId],
  );

  const handleDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!getDragPayload()) return;
      if (!workspaceId) return;
      e.preventDefault();
      setIsDragOver(true);
      if (isCollapsed) setIsCollapsed(false);
    },
    [workspaceId, isCollapsed],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setIsDragOver(false);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const payload = getDragPayload();
      clearDragPayload();

      if (!payload || !workspaceId || !orgId) {
        if (!workspaceId) {
          showToast({ type: 'error', title: 'No active work set — activate one first' });
        }
        return;
      }

      if (payload.kind === 'object' && isCollections) {
        dropObjectMutation.mutate(payload.objectId);
      } else if (payload.kind === 'media' && isMedia) {
        dropMediaMutation.mutate(payload.mediaId);
      }
    },
    [workspaceId, orgId, isCollections, isMedia, dropObjectMutation, dropMediaMutation, showToast],
  );

  // ── Fetch workspace items ────────────────────────────────────────────
  const { data: collectionsItemsData } = useQuery({
    queryKey: ['workspace-items-strip', orgId, workspaceId],
    queryFn: () => listWorkspaceItems(orgId!, workspaceId!, { limit: STRIP_FETCH_LIMIT }),
    enabled: !!orgId && !!workspaceId && isWorkspace && isCollections,
    staleTime: 60000,
  });

  const { data: mediaItemsData } = useQuery({
    queryKey: ['media-workspace-items-strip', orgId, workspaceId],
    queryFn: () => listMediaWorkspaceItems(orgId!, workspaceId!, { limit: STRIP_FETCH_LIMIT }),
    enabled: !!orgId && !!workspaceId && isWorkspace && isMedia,
    staleTime: 60000,
  });

  // ── Normalize items to common shape ──────────────────────────────────
  let items: StripItem[] = [];
  let serverTotal = 0;

  if (isCollections && collectionsItemsData) {
    const raw: WorkspaceItem[] = collectionsItemsData.items ?? [];
    serverTotal = collectionsItemsData.total ?? 0;
    items = raw.map((item, index) => ({
      id: item.object_id,
      itemKey: item.workspace_item_id,
      thumbnailUrl: item.thumbnail_url,
      label: item.accession_number || `#${index + 1}`,
      title: [item.accession_number, item.title].filter(Boolean).join(' — ') || 'Untitled',
      href: `/organizations/${orgId}/collections/objects/${item.object_id}`,
    }));
  } else if (isMedia && mediaItemsData) {
    const raw: MediaWorkspaceItem[] = mediaItemsData.items ?? [];
    serverTotal = mediaItemsData.total ?? 0;
    items = raw.map((item, index) => ({
      id: item.media_id,
      itemKey: item.workspace_item_id,
      thumbnailUrl: item.thumbnail_url,
      label: item.filename || item.title || `#${index + 1}`,
      title: item.title || item.filename || 'Untitled',
      href: `/organizations/${orgId}/media/${item.media_id}`,
    }));
  }

  const totalCount = serverTotal > 0 ? serverTotal : (contextItemCount || items.length);
  const hasMore = items.length < serverTotal;

  // ── Current record detection ─────────────────────────────────────────
  const detectedId = isCollections ? detectedObjectId : detectedMediaId;
  const currentIndex = detectedId
    ? items.findIndex((item) => item.id === detectedId)
    : -1;

  const itemNoun = isMedia ? 'assets' : 'objects';

  // Navigate to prev/next record in the set
  const navigateToRecord = useCallback((index: number) => {
    if (index < 0 || index >= items.length) return;
    navigate(items[index].href);
  }, [items, navigate]);

  const goToPrev = useCallback(() => {
    if (currentIndex > 0) {
      navigateToRecord(currentIndex - 1);
    }
  }, [currentIndex, navigateToRecord]);

  const goToNext = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < items.length - 1) {
      navigateToRecord(currentIndex + 1);
    }
  }, [currentIndex, items.length, navigateToRecord]);

  // Clear active context to dismiss the strip
  const handleDismiss = useCallback(async () => {
    if (!orgId) return;
    try {
      if (isMedia) {
        await clearMediaActiveContext(orgId);
        queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
      } else {
        await clearActiveContext(orgId);
        queryClient.invalidateQueries({ queryKey: ['active-context', orgId] });
      }
    } catch {
      // ignore
    }
  }, [orgId, isMedia, queryClient]);

  // Keyboard navigation: arrow keys when strip or its children are focused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when the strip has focus or is the active element's ancestor
      if (!stripRef.current?.contains(document.activeElement) && document.activeElement !== stripRef.current) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNext();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goToPrev, goToNext]);

  // Scroll the active card into view when it changes
  useEffect(() => {
    if (activeCardRef.current && !isCollapsed) {
      activeCardRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [detectedId, isCollapsed]);

  // Scroll navigation (for the filmstrip scroll buttons)
  const scrollStrip = useCallback((direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const scrollAmount = 300;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  }, []);

  // Build workspace detail link
  const workspaceLink = orgId && workspaceId
    ? isMedia
      ? `/organizations/${orgId}/media/work/workspaces/${workspaceId}`
      : `/organizations/${orgId}/collections/work/workspaces/${workspaceId}`
    : null;

  // Determine visibility — show on all pages including workspace detail for context feedback
  const shouldShow =
    (isCollections || isMedia) &&
    isWorkspace &&
    !!workspaceId;

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex >= 0 && currentIndex < items.length - 1;

  // Manage body classes for layout adjustment
  useEffect(() => {
    if (shouldShow) {
      document.body.classList.add('has-record-set-strip');
      if (isCollapsed) {
        document.body.classList.add('record-set-collapsed');
      } else {
        document.body.classList.remove('record-set-collapsed');
      }
    } else {
      document.body.classList.remove('has-record-set-strip', 'record-set-collapsed');
    }
    return () => {
      document.body.classList.remove('has-record-set-strip', 'record-set-collapsed');
    };
  }, [shouldShow, isCollapsed]);

  if (!shouldShow) {
    return null;
  }

  return (
    <>
      <div
        ref={stripRef}
        tabIndex={0}
        className={cn(
          'record-set-strip',
          isCollapsed && 'record-set-strip--collapsed',
          isDragOver && 'ring-2 ring-bark ring-inset'
        )}
        role="toolbar"
        aria-label={`Record set: ${workspaceName}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drop-zone hint — visible only while dragging over the strip */}
        {isDragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bark/10 pointer-events-none rounded">
            <span className="flex items-center gap-1.5 text-xs font-medium text-bark">
              <Plus size={14} /> Drop to add to {workspaceName}
            </span>
          </div>
        )}
        {/* Header bar - always visible */}
        <div className="record-set-strip__header">
          <div className="flex items-center gap-2 min-w-0">
            <Layers size={14} className="text-bark shrink-0" />
            <span className="text-xs font-medium text-ink truncate">
              {workspaceName}
            </span>
            <span className="text-xs text-archive shrink-0">
              {currentIndex >= 0
                ? `${currentIndex + 1} of ${totalCount}`
                : `${totalCount} ${itemNoun}`}
              {hasMore && currentIndex < 0 ? ` (showing ${items.length})` : ''}
            </span>

            {/* Prev/Next record buttons - only when viewing a record in the set */}
            {currentIndex >= 0 && (
              <div className="flex items-center gap-0.5 ml-1">
                <button
                  onClick={goToPrev}
                  disabled={!canGoPrev}
                  className={cn(
                    'p-0.5 rounded transition-colors',
                    canGoPrev
                      ? 'text-ink hover:bg-stone/50'
                      : 'text-lichen cursor-default'
                  )}
                  aria-label="Previous record"
                  title="Previous record (← arrow)"
                >
                  <SkipBack size={13} />
                </button>
                <button
                  onClick={goToNext}
                  disabled={!canGoNext}
                  className={cn(
                    'p-0.5 rounded transition-colors',
                    canGoNext
                      ? 'text-ink hover:bg-stone/50'
                      : 'text-lichen cursor-default'
                  )}
                  aria-label="Next record"
                  title="Next record (→ arrow)"
                >
                  <SkipForward size={13} />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Quick Actions button */}
            {totalCount > 0 && (
              <button
                onClick={() => setShowBulkActions(true)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-bark text-parchment hover:bg-copper-dark transition-colors"
                title="Quick Actions on workspace"
              >
                <Zap size={12} />
                Actions
              </button>
            )}

            {/* View workspace link */}
            {workspaceLink && (
              <Link
                to={workspaceLink}
                className="p-1 rounded hover:bg-stone/50 text-archive hover:text-ink transition-colors"
                title="View workspace"
              >
                <ExternalLink size={14} />
              </Link>
            )}

            {/* Collapse/expand toggle */}
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 rounded hover:bg-stone/50 text-archive hover:text-ink transition-colors"
              aria-label={isCollapsed ? 'Expand record set' : 'Collapse record set'}
            >
              {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {/* Dismiss / clear context */}
            <button
              onClick={handleDismiss}
              className="p-1 rounded hover:bg-semantic-error/10 text-archive hover:text-semantic-error transition-colors"
              aria-label="Close work set"
              title="Close work set"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Filmstrip area - hidden when collapsed or empty */}
        {!isCollapsed && items.length > 0 && (
          <div className="record-set-strip__body">
            {/* Left scroll button */}
            <button
              onClick={() => scrollStrip('left')}
              className="record-set-strip__scroll-btn"
              aria-label="Scroll left"
            >
              <ChevronLeft size={16} />
            </button>

            {/* Scrollable cards */}
            <div ref={scrollRef} className="record-set-strip__cards">
              {items.map((item, idx) => {
                const isActive = item.id === detectedId;
                // Fall back to id (object_id / media_id) when workspace_item_id
                // is null in the API response — otherwise multiple rows
                // collide on key=null and React warns + may dedupe items.
                const reactKey = item.itemKey ?? item.id ?? `idx-${idx}`;

                return (
                  <div key={reactKey} className="group relative">
                    <Link
                      ref={isActive ? activeCardRef : undefined}
                      to={item.href}
                      className={cn(
                        'record-set-strip__card',
                        isActive && 'record-set-strip__card--active'
                      )}
                      title={item.title}
                    >
                      {/* Thumbnail */}
                      <div className="record-set-strip__thumb">
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <ImageIcon size={16} className="text-archive" />
                        )}
                      </div>

                      {/* Label */}
                      <div className="record-set-strip__label">
                        <span className="text-[10px] font-medium text-ink truncate">
                          {item.label}
                        </span>
                      </div>

                      {/* Active indicator dot */}
                      {isActive && (
                        <div className="record-set-strip__active-dot" />
                      )}
                    </Link>

                    {/* Delete button — visible on hover */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setItemToDelete(item);
                      }}
                      className="absolute top-0.5 right-0.5 p-0.5 rounded bg-parchment/90 text-archive hover:bg-semantic-error hover:text-parchment opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-bark/30 transition-opacity"
                      aria-label={`Remove ${item.label} from work set`}
                      title="Remove from work set"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}

              {/* Truncation indicator */}
              {hasMore && (
                <div className="record-set-strip__card record-set-strip__card--more">
                  <div className="record-set-strip__thumb">
                    <span className="text-[10px] font-medium text-archive">
                      +{serverTotal - items.length}
                    </span>
                  </div>
                  <div className="record-set-strip__label">
                    <Link
                      to={workspaceLink || '#'}
                      className="text-[10px] text-bark hover:text-copper-dark"
                    >
                      View all
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Right scroll button */}
            <button
              onClick={() => scrollStrip('right')}
              className="record-set-strip__scroll-btn"
              aria-label="Scroll right"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Bulk Action Dialogs - product-specific */}
      {isCollections && workspaceId && workspaceName && (
        <BulkActionDialog
          isOpen={showBulkActions}
          onClose={() => {
            setShowBulkActions(false);
            queryClient.invalidateQueries({ queryKey: ['active-context', orgId] });
            queryClient.invalidateQueries({ queryKey: ['workspace-items-strip', orgId, workspaceId] });
          }}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          objectCount={totalCount}
        />
      )}
      <ConfirmDialog
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Remove from work set"
        message={
          <>
            Remove <span className="font-medium">{itemToDelete?.title}</span> from{' '}
            <span className="font-medium">{workspaceName}</span>? The record itself will not be deleted.
          </>
        }
        confirmText="Remove"
        confirmStyle="danger"
      />
      {isMedia && workspaceId && workspaceName && (
        <MediaBulkActionDialog
          isOpen={showBulkActions}
          onClose={() => {
            setShowBulkActions(false);
            queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
            queryClient.invalidateQueries({ queryKey: ['media-workspace-items-strip', orgId, workspaceId] });
          }}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          assetCount={totalCount}
        />
      )}
    </>
  );
}

export default RecordSetStrip;
