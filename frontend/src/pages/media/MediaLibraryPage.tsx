import { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext';
import Checkbox from '../../components/Checkbox';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { setDragPayload, clearDragPayload } from '../../lib/dragTypes';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Search,
  Upload,
  Grid,
  List,
  Image,
  Video,
  FileAudio,
  FileText,
  Box,
  Filter,
  Trash2,
  RefreshCw,
  X,
  Check,
  AlertCircle,
  Clock,
  ExternalLink,
  FolderPlus,
  FolderInput,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  Layers,
  Globe,
  Lock,
  Link as LinkIcon,
  Sparkles,
  Zap,
} from 'lucide-react';
import { listMedia, deleteMedia, searchMedia, deleteMediaFolder, moveMediaToFolder, publishMedia, unpublishMedia, getMediaActiveContext } from '../../lib/api';
import { visualSearch } from '../../lib/api/media-dam';
import { getMediaAIConfig } from '../../lib/api/media';
import type { SimilarMediaResult } from '../../lib/api/media-dam';
import type { Media, MediaFolder, MediaListResponse, MediaSearchResponse } from '../../lib/schemas';
import { MediaTagFilter, formatTagFiltersForQuery, AddToCollectionDropdown, BatchMetadataPanel, FolderTree, FolderContextMenu, CreateFolderModal, MoveToFolderModal } from '../../components/dam';
import { ColorFilter } from '../../components/dam/ColorFilter';
import { AddToMediaWorkspaceDialog, MediaBulkActionDialog } from '../../components/media-workspaces';
import SaveMediaSearchAsWorkSetDialog from '../../components/workspaces/SaveMediaSearchAsWorkSetDialog';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useUpload } from '../../contexts/uploadStore';
import { UploadFromUrlModal } from '../../components/dam';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';
import { usePermissions } from '@/hooks/usePermissions';

type ViewMode = 'grid' | 'list';

// The grid is fed by two endpoints with different envelopes: listMedia returns
// the shared paginated shape (`items`), searchMedia returns search hits
// (`hits`). Typed from the real response schemas, not a local interface — a
// hand-written `{ media?: Media[] }` here kept compiling after the list
// endpoint moved to `items`, and the library rendered empty with 152 media in
// the database.
type MediaListData = MediaListResponse | MediaSearchResponse;

function mediaRows(data: MediaListData | undefined): Media[] {
  if (!data) return [];
  return ('items' in data ? data.items : data.hits) as Media[];
}

// Page size for the library grid. Kept modest so a page loads quickly and the
// grid paginates instead of dumping a single large (and slow) batch.
const PAGE_SIZE = 48;

const MEDIA_TYPE_ICONS = {
  image: Image,
  video: Video,
  audio: FileAudio,
  document: FileText,
  model_3d: Box,
};

const PROCESSING_STATUS_STYLES = {
  pending: { icon: Clock, color: 'text-semantic-warning', bg: 'bg-semantic-warning/10' },
  processing: { icon: RefreshCw, color: 'text-semantic-info', bg: 'bg-semantic-info/10', animate: true },
  completed: { icon: Check, color: 'text-semantic-success', bg: 'bg-semantic-success/10' },
  failed: { icon: AlertCircle, color: 'text-semantic-error', bg: 'bg-semantic-error/10' },
};

// Compute rights status from available media fields (heuristic without fetching full rights)
// Color semantics: green=ready, amber=restricted, gray=incomplete, red=blocked
type QuickRightsStatus = 'ready' | 'restricted' | 'incomplete' | 'blocked' | 'unknown';

function getQuickRightsStatus(media: Media): { status: QuickRightsStatus; dotColor: string; label: string } {
  // If still processing, don't show rights status
  if (media.processing_status !== 'completed') {
    return { status: 'unknown', dotColor: '', label: '' };
  }

  // Check for blocked/expired rights (if rights_status field indicates blocked)
  if ((media as Media & { rights_status?: string }).rights_status === 'blocked' ||
      (media as Media & { rights_status?: string }).rights_status === 'expired') {
    return {
      status: 'blocked',
      dotColor: 'bg-semantic-error',
      label: 'Use blocked',
    };
  }

  // Check for explicit copyright status or license
  const hasCopyrightInfo = media.copyright_status || media.license || media.rights_statement || media.copyright_notice;

  if (!hasCopyrightInfo) {
    return {
      status: 'incomplete',
      dotColor: 'bg-archive',
      label: 'Rights incomplete',
    };
  }

  // If published, cleared for use
  if (media.is_published) {
    return {
      status: 'ready',
      dotColor: 'bg-semantic-success',
      label: 'Ready to use',
    };
  }

  // Has some rights info but not published - restricted use
  return {
    status: 'restricted',
    dotColor: 'bg-semantic-warning',
    label: 'Restricted use',
  };
}

export default function MediaLibraryPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addFiles } = useUpload();
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('media.edit');
  const canDelete = hasPermission('media.delete');
  const canPublish = hasPermission('media.publish');
  const lastSelectedIndexRef = useRef<number | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchMode, setSearchMode] = useState<'text' | 'visual'>('text');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [visualThreshold, setVisualThreshold] = useState(0.20);

  // Active media workspace context — powers the "Active Workspace" banner
  // and Quick Actions dialog (same pattern as Collections object list).
  const { data: mediaActiveContextData } = useQuery({
    queryKey: ['media-active-context', orgId],
    queryFn: () => getMediaActiveContext(orgId!),
    enabled: !!orgId,
    refetchInterval: 30000,
  });
  const activeMediaWorkspace =
    mediaActiveContextData?.context?.type === 'media_workspace'
      ? mediaActiveContextData.context.workspace
      : null;

  // Seed threshold from org AI config
  const { data: aiConfigData } = useQuery({
    queryKey: ['media-ai-config', orgId],
    queryFn: () => getMediaAIConfig(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (aiConfigData?.visual_search_threshold != null) {
      setVisualThreshold(aiConfigData.visual_search_threshold);
    }
  }, [aiConfigData?.visual_search_threshold]);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'audio' | 'document' | 'model_3d' | ''>('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showUrlUploadModal, setShowUrlUploadModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [tagFilters, setTagFilters] = useState<Array<{ key: string; value: string; displayName: string }>>([]);
  const [collectionDropdownOpen, setCollectionDropdownOpen] = useState<string | null>(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showBulkActionDialog, setShowBulkActionDialog] = useState(false);
  const [mediaToDelete, setMediaToDelete] = useState<string | null>(null);
  const [showBatchMetadataPanel, setShowBatchMetadataPanel] = useState(false);
  const [showAddToWorkspaceDialog, setShowAddToWorkspaceDialog] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [publishedStatus, setPublishedStatus] = useState<string>('');
  const [aiStatus, setAiStatus] = useState<string>('');
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [showSaveAsWorkSetDialog, setShowSaveAsWorkSetDialog] = useState(false);

  // Folder management state
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null);
  const [editFolder, setEditFolder] = useState<MediaFolder | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{ folder: MediaFolder | null; position: { x: number; y: number } } | null>(null);
  const [showDeleteFolderDialog, setShowDeleteFolderDialog] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<MediaFolder | null>(null);
  const [showMoveToFolderModal, setShowMoveToFolderModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Persist preference in localStorage
    const saved = localStorage.getItem('media-sidebar-collapsed');
    return saved === 'true';
  });

  // Drag and drop state for media items
  const [draggingMediaIds, setDraggingMediaIds] = useState<string[]>([]);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Any change to the result set resets pagination to the first page so the
  // user isn't stranded on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, mediaType, selectedFolderId, tagFilters, processingStatus, publishedStatus, aiStatus, colorFilter]);

  // Visual search query (only active in visual mode with a query)
  const isVisualSearch = searchMode === 'visual' && !!debouncedSearch;
  const { data: visualData, isLoading: visualLoading, isFetching: visualFetching } = useQuery({
    queryKey: ['media-visual-search', orgId, debouncedSearch, visualThreshold],
    queryFn: () => visualSearch(orgId!, debouncedSearch, { top_k: 50, threshold: visualThreshold }),
    enabled: !!orgId && isVisualSearch,
  });

  // Fetch media list (disabled during visual search)
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['media-library', orgId, debouncedSearch, mediaType, selectedFolderId, tagFilters, processingStatus, publishedStatus, aiStatus, colorFilter, page],
    queryFn: async () => {
      // Use search endpoint when we have text search, tag filters, or color filter
      if (debouncedSearch || tagFilters.length > 0 || colorFilter) {
        const tagFilterParams = formatTagFiltersForQuery(tagFilters);
        return searchMedia(orgId!, {
          q: debouncedSearch,
          media_type: mediaType || undefined,
          folder_id: selectedFolderId === 'unfiled' ? 'unfiled' : selectedFolderId || undefined,
          tag_filter: tagFilterParams.length > 0 ? tagFilterParams : undefined,
          processing_status: processingStatus || undefined,
          ai_processing_status: aiStatus || undefined,
          is_published: publishedStatus === 'published' ? true : publishedStatus === 'unpublished' ? false : undefined,
          color_key: colorFilter || undefined,
          offset: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        });
      }
      const mediaTypeParam = mediaType || undefined;
      return listMedia(orgId!, {
        media_type: mediaTypeParam as 'image' | 'video' | 'audio' | 'document' | undefined,
        folder_id: selectedFolderId === 'unfiled' ? 'unfiled' : selectedFolderId || undefined,
        search: debouncedSearch,
        processing_status: processingStatus || undefined,
        ai_processing_status: aiStatus || undefined,
        is_published: publishedStatus === 'published' ? true : publishedStatus === 'unpublished' ? false : undefined,
        page,
        page_size: PAGE_SIZE,
      });
    },
    enabled: !!orgId && !isVisualSearch,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      // Poll if any items are processing
      const hasProcessing = mediaRows(query.state?.data).some((m) => m.processing_status === 'pending' || m.processing_status === 'processing');
      return hasProcessing ? 5000 : false;
    },
  });

  // Build a similarity lookup map for visual search results
  const visualSimilarityMap = new Map<string, number>();
  if (isVisualSearch && visualData?.results) {
    for (const r of visualData.results) {
      visualSimilarityMap.set(r.media_id, r.similarity);
    }
  }

  // Delete folder mutation
  const deleteFolderMutation = useMutation({
    mutationFn: (folderId: string) => deleteMediaFolder(orgId!, folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', orgId] });
      queryClient.invalidateQueries({ queryKey: ['media-library', orgId] });
      setFolderToDelete(null);
      setShowDeleteFolderDialog(false);
      // If we deleted the selected folder, go back to all media
      if (folderToDelete && selectedFolderId === folderToDelete.folder_id) {
        setSelectedFolderId(null);
      }
    },
  });

  // Handle file uploads - uses background upload queue
  const handleUpload = useCallback((files: FileList | File[]) => {
    if (!orgId) return;
    const folderId = selectedFolderId && selectedFolderId !== 'unfiled' ? selectedFolderId : undefined;
    addFiles(files, orgId, folderId);
    setShowUploadModal(false);
    // Invalidate queries after a delay to pick up new uploads
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['media-library', orgId] });
      queryClient.invalidateQueries({ queryKey: ['media-folders', orgId] });
    }, 1000);
  }, [orgId, selectedFolderId, addFiles, queryClient]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (mediaId: string) => deleteMedia(orgId!, mediaId),
    onMutate: async (mediaId) => {
      // Optimistic: remove from cache immediately
      await queryClient.cancelQueries({ queryKey: ['media-library', orgId] });
      queryClient.setQueriesData<MediaListData>({ queryKey: ['media-library', orgId] }, (old) => {
        if (!old) return old;
        const total = (old.total || 1) - 1;
        return 'items' in old
          ? { ...old, items: old.items.filter((m) => m.media_id !== mediaId), total }
          : { ...old, hits: old.hits.filter((m) => m.media_id !== mediaId), total };
      });
      setSelectedItems((prev) => { const next = new Set(prev); next.delete(mediaId); return next; });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library', orgId] });
    },
  });

  // Move to folder mutation (for drag and drop)
  const moveToFolderMutation = useMutation({
    mutationFn: ({ folderId, mediaIds }: { folderId: string; mediaIds: string[] }) =>
      moveMediaToFolder(orgId!, folderId, mediaIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library', orgId] });
      queryClient.invalidateQueries({ queryKey: ['media-folders', orgId] });
      setSelectedItems(new Set());
      setDraggingMediaIds([]);
      showToast({ type: 'success', title: 'Moved', message: 'Media moved to folder' });
    },
  });

  // Bulk publish mutation
  const bulkPublishMutation = useMutation({
    mutationFn: async (mediaIds: string[]) => {
      await Promise.allSettled(mediaIds.map((id) => publishMedia(orgId!, id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library', orgId] });
      setSelectedItems(new Set());
    },
  });

  // Bulk unpublish mutation
  const bulkUnpublishMutation = useMutation({
    mutationFn: async (mediaIds: string[]) => {
      await Promise.allSettled(mediaIds.map((id) => unpublishMedia(orgId!, id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-library', orgId] });
      setSelectedItems(new Set());
    },
  });

  // Check if drag event is from external files (not internal media drag)
  const isExternalFileDrag = useCallback((e: React.DragEvent) => {
    // External file drops have 'Files' in types, internal drags have 'text/plain'
    return e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('text/plain');
  }, []);

  // Handle file drop (only for external files, not internal media drags)
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload, isExternalFileDrag]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    setDragOver(true);
  }, [isExternalFileDrag]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    setDragOver(false);
  }, [isExternalFileDrag]);

  // Handle file select
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUpload(e.target.files);
    }
  }, [handleUpload]);

  // Get media items from data (used in handleSelect and render)
  // In visual search mode, map visual results to Media-like objects
  const mediaData = data as MediaListData | undefined;
  const mediaItems: Media[] = isVisualSearch
    ? (visualData?.results || []).map((r: SimilarMediaResult) => ({
        media_id: r.media_id,
        title: r.title || '',
        filename: r.title || r.media_id,
        media_type: 'image' as const,
        thumbnail_url: r.thumbnail_url || null,
        processing_status: 'completed' as const,
      } as Media))
    : mediaRows(mediaData);

  // Toggle selection with shift-click support for range selection
  const handleSelect = useCallback((index: number, mediaId: string, event?: React.MouseEvent | React.ChangeEvent) => {
    const isShiftClick = event && 'shiftKey' in event && event.shiftKey;

    if (isShiftClick && lastSelectedIndexRef.current !== null) {
      // Shift-click: select range between last selected and current
      const start = Math.min(lastSelectedIndexRef.current, index);
      const end = Math.max(lastSelectedIndexRef.current, index);
      const newSelected = new Set(selectedItems);

      for (let i = start; i <= end; i++) {
        if (mediaItems[i]) {
          newSelected.add(mediaItems[i].media_id);
        }
      }
      setSelectedItems(newSelected);
    } else {
      // Regular click: toggle single item
      const newSelected = new Set(selectedItems);
      if (newSelected.has(mediaId)) {
        newSelected.delete(mediaId);
      } else {
        newSelected.add(mediaId);
      }
      setSelectedItems(newSelected);
      lastSelectedIndexRef.current = index;
    }
  }, [selectedItems, mediaItems]);

  // Folder context menu handlers
  const handleFolderContextMenu = (folder: MediaFolder | null, event: React.MouseEvent) => {
    event.preventDefault();
    setFolderContextMenu({
      folder,
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const handleCreateFolder = (parentId: string | null) => {
    setCreateFolderParentId(parentId);
    setEditFolder(null);
    setShowCreateFolderModal(true);
  };

  const handleRenameFolder = (folder: MediaFolder) => {
    setEditFolder(folder);
    setCreateFolderParentId(null);
    setShowCreateFolderModal(true);
  };

  const handleDeleteFolder = (folder: MediaFolder) => {
    setFolderToDelete(folder);
    setShowDeleteFolderDialog(true);
  };

  // Drag and drop handlers for media items
  const handleMediaDragStart = useCallback((mediaId: string) => {
    // If the dragged item is selected, drag all selected items
    // Otherwise, just drag the single item
    if (selectedItems.has(mediaId)) {
      setDraggingMediaIds(Array.from(selectedItems));
    } else {
      setDraggingMediaIds([mediaId]);
    }
  }, [selectedItems]);

  const handleMediaDragEnd = useCallback(() => {
    setDraggingMediaIds([]);
    clearDragPayload();
  }, []);

  const handleDropOnFolder = useCallback((folderId: string) => {
    if (draggingMediaIds.length > 0) {
      moveToFolderMutation.mutate({ folderId, mediaIds: draggingMediaIds });
    }
  }, [draggingMediaIds, moveToFolderMutation]);

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Only show loader on true initial load (no data yet)
  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-institutional p-4 text-semantic-error">
          Error loading media library: {(error as Error).message}
        </div>
      </div>
    );
  }

  const toggleSidebar = () => {
    const newValue = !sidebarCollapsed;
    setSidebarCollapsed(newValue);
    localStorage.setItem('media-sidebar-collapsed', String(newValue));
  };

  return (
    <div className="flex gap-3 md:gap-6">
      {/* Folder Sidebar — hidden below md. The folder tree is not usable at
       * phone widths (w-64 = 256px leaves ~100px for content on a 375px
       * viewport). Mobile users filter via search and breadcrumbs for now;
       * a slide-over drawer is a follow-up. */}
      <div
        className={`hidden md:block flex-shrink-0 transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-64'
        }`}
      >
        <div className="card sticky top-4 w-64">
          <FolderTree
            organizationId={orgId!}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
            onCreateFolder={handleCreateFolder}
            onFolderContextMenu={handleFolderContextMenu}
            onDropMedia={handleDropOnFolder}
            isDraggingMedia={draggingMediaIds.length > 0}
            draggingCount={draggingMediaIds.length}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Header — flex-wrap so the button cluster drops below the title
         * on narrow viewports instead of pushing Upload off-screen. */}
        <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-2">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={toggleSidebar}
              className="hidden md:inline-flex p-2 hover:bg-stone rounded-md text-archive hover:text-ink transition-colors"
              title={sidebarCollapsed ? 'Show folders' : 'Hide folders'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold text-ink truncate">Media Library</h1>
              <p className="text-sm text-archive mt-1">
                {isVisualSearch
                  ? `${mediaItems.length} visual matches`
                  : `${mediaItems.length} items ${mediaData?.total && mediaData.total > mediaItems.length ? `of ${mediaData.total}` : ''}`
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              className="btn btn-secondary"
              title="Refresh"
              disabled={isFetching}
            >
              <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => { if (canEdit) setShowUrlUploadModal(true); }}
              disabled={!canEdit}
              title={!canEdit ? "You don't have permission" : "Upload from URL"}
              aria-label="Upload from URL"
              className={`btn btn-secondary flex items-center gap-2 ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <LinkIcon size={18} />
              <span className="hidden sm:inline">URL</span>
            </button>
            <button
              onClick={() => { if (canEdit) setShowUploadModal(true); }}
              disabled={!canEdit}
              title={!canEdit ? "You don't have permission" : undefined}
              aria-label="Upload"
              className={`btn btn-primary flex items-center gap-2 ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Upload size={18} />
              <span className="hidden sm:inline">Upload</span>
            </button>
          </div>
        </div>

      {/* Active Workspace context — mirrors the Collections objects list
       * banner so users see which work set is pinned and can jump into
       * bulk actions from here instead of hunting for the bottom strip. */}
      {activeMediaWorkspace && activeMediaWorkspace.asset_count > 0 && (
        <div className="p-4 bg-bark/5 border border-bark/20 rounded-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-bark/10 rounded-lg shrink-0">
                <Layers size={20} className="text-bark" />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-archive mb-0.5">Active Workspace</div>
                <div className="font-medium text-ink truncate">{activeMediaWorkspace.name}</div>
                <div className="text-sm text-archive">
                  {activeMediaWorkspace.asset_count} {activeMediaWorkspace.asset_count === 1 ? 'asset' : 'assets'} ready for bulk actions
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to={`/organizations/${orgId}/media/work/workspaces/${activeMediaWorkspace.workspace_id}`}
                className="btn btn-secondary text-sm py-1.5 flex items-center gap-1.5 no-underline"
              >
                <ExternalLink size={14} />
                <span className="hidden sm:inline">View Workspace</span>
                <span className="sm:hidden">View</span>
              </Link>
              <button
                onClick={() => setShowBulkActionDialog(true)}
                className="btn btn-primary text-sm py-1.5 flex items-center gap-1.5"
              >
                <Zap size={14} />
                <span className="hidden sm:inline">Quick Actions</span>
                <span className="sm:hidden">Actions</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            {searchMode === 'visual' ? (
              <Sparkles size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-bark" />
            ) : (
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
            )}
            <input
              type="text"
              placeholder={searchMode === 'visual' ? 'Describe what you\'re looking for...' : 'Search media...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`input w-full pl-10 pr-10 ${searchMode === 'visual' ? 'border-bark/40' : ''}`}
            />
            {(isFetching || visualFetching) && (
              <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-archive animate-spin" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {searchMode !== 'visual' && (
              <>
                <select
                  value={mediaType}
                  onChange={(e) => setMediaType(e.target.value as 'image' | 'video' | 'audio' | 'document' | 'model_3d' | '')}
                  className="input"
                >
                  <option value="">All Types</option>
                  <option value="image">Images</option>
                  <option value="video">Videos</option>
                  <option value="audio">Audio</option>
                  <option value="document">Documents</option>
                  <option value="model_3d">3D Models</option>
                </select>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`btn ${showFilters ? 'btn-primary' : 'btn-secondary'}`}
                >
                  <Filter size={18} />
                </button>
                {/* Save as Work Set — visible only when a search or filter is active.
                    Creates a dynamic media workset backed by the current query. */}
                {(debouncedSearch || mediaType || processingStatus || publishedStatus ||
                  aiStatus || colorFilter || tagFilters.length > 0) && (
                  <button
                    onClick={() => setShowSaveAsWorkSetDialog(true)}
                    className="btn btn-secondary flex items-center gap-1.5"
                    title="Save this search as a dynamic Work Set"
                  >
                    <Layers size={18} />
                    <span className="hidden sm:inline text-sm">Save as Work Set</span>
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => {
                setSearchMode(searchMode === 'visual' ? 'text' : 'visual');
                setSearch('');
                setDebouncedSearch('');
                setShowFilters(false);
              }}
              className={`btn flex items-center gap-1.5 ${searchMode === 'visual' ? 'btn-primary' : 'btn-secondary'}`}
              title={searchMode === 'visual' ? 'Switch to text search' : 'Search by description (AI)'}
            >
              <Sparkles size={16} />
              <span className="hidden sm:inline text-sm">
                {searchMode === 'visual' ? 'AI' : 'AI'}
              </span>
            </button>
            <div className="border-l pl-2 flex items-center gap-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded ${viewMode === 'grid' ? 'bg-forest/10 text-forest' : 'text-archive hover:bg-stone'}`}
              >
                <Grid size={18} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded ${viewMode === 'list' ? 'bg-forest/10 text-forest' : 'text-archive hover:bg-stone'}`}
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Visual search threshold */}
        {searchMode === 'visual' && (
          <div className="flex items-center gap-3 pt-2">
            <label htmlFor="vs-threshold" className="text-xs text-archive whitespace-nowrap">Precision</label>
            <input
              id="vs-threshold"
              type="range"
              min={0.10}
              max={0.50}
              step={0.01}
              value={visualThreshold}
              onChange={(e) => setVisualThreshold(parseFloat(e.target.value))}
              className="flex-1 accent-bark h-1.5"
            />
            <span className="text-xs text-archive tabular-nums w-8">{Math.round(visualThreshold * 100)}%</span>
          </div>
        )}

        {/* Filters Panel (hidden in visual search mode) */}
        {showFilters && searchMode !== 'visual' && (
          <div className="pt-4 border-t border-lichen space-y-4">
            {/* Quick Filters Row */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-ink">Filters:</span>

              {/* Processing Status */}
              <select
                value={processingStatus}
                onChange={(e) => setProcessingStatus(e.target.value)}
                className="px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                <option value="">Processing Status</option>
                <option value="completed">Completed</option>
                <option value="processing">Processing</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>

              {/* Published Status */}
              <select
                value={publishedStatus}
                onChange={(e) => setPublishedStatus(e.target.value)}
                className="px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                <option value="">Publish Status</option>
                <option value="published">Published</option>
                <option value="unpublished">Unpublished</option>
              </select>

              {/* AI Status */}
              <select
                value={aiStatus}
                onChange={(e) => setAiStatus(e.target.value)}
                className="px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
              >
                <option value="">AI Tagging</option>
                <option value="completed">AI Complete</option>
                <option value="pending">AI Pending</option>
                <option value="processing">AI Processing</option>
                <option value="failed">AI Failed</option>
                <option value="skipped">AI Skipped</option>
              </select>

              {/* Clear Filters */}
              {(processingStatus || publishedStatus || aiStatus || tagFilters.length > 0 || colorFilter) && (
                <button
                  onClick={() => {
                    setProcessingStatus('');
                    setPublishedStatus('');
                    setAiStatus('');
                    setTagFilters([]);
                    setColorFilter(null);
                  }}
                  className="text-sm text-archive hover:text-ink underline"
                >
                  Clear all filters
                </button>
              )}
            </div>

            {/* Tag Filters */}
            <MediaTagFilter
              organizationId={orgId!}
              filters={tagFilters}
              onChange={setTagFilters}
            />

            {/* Color Filter */}
            <ColorFilter
              selectedColor={colorFilter}
              onColorSelect={setColorFilter}
            />
          </div>
        )}

        {/* Bulk Actions */}
        {selectedItems.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-forest/5 rounded-lg">
            {/* Selection counter with inline dismiss */}
            <span className="text-sm font-medium flex items-center gap-1.5">
              {selectedItems.size} selected
              <button
                onClick={() => setSelectedItems(new Set())}
                className="p-0.5 hover:bg-ink/10 rounded text-archive hover:text-ink transition-colors"
                title="Clear selection"
              >
                <X size={14} />
              </button>
            </span>

            {/* Primary action */}
            <button
              onClick={() => { if (canEdit) setShowBatchMetadataPanel(true); }}
              disabled={!canEdit}
              title={!canEdit ? "You don't have permission" : undefined}
              className={`btn btn-primary text-sm ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Edit Metadata
            </button>

            {/* Secondary actions - organizational */}
            <button
              onClick={() => { if (canEdit) setShowMoveToFolderModal(true); }}
              disabled={!canEdit}
              title={!canEdit ? "You don't have permission" : undefined}
              className={`btn btn-secondary text-sm flex items-center gap-1 ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <FolderInput size={16} />
              Move to Folder
            </button>
            <button
              onClick={() => setShowAddToWorkspaceDialog(true)}
              className="btn btn-secondary text-sm flex items-center gap-1"
            >
              <Layers size={16} />
              Add to Work Set
            </button>
            <button
              onClick={() => { if (canPublish) bulkPublishMutation.mutate(Array.from(selectedItems)); }}
              disabled={!canPublish || bulkPublishMutation.isPending}
              title={!canPublish ? "You don't have permission" : undefined}
              className={`btn btn-secondary text-sm flex items-center gap-1 ${!canPublish ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Globe size={16} />
              Publish
            </button>
            <button
              onClick={() => { if (canPublish) bulkUnpublishMutation.mutate(Array.from(selectedItems)); }}
              disabled={!canPublish || bulkUnpublishMutation.isPending}
              title={!canPublish ? "You don't have permission" : undefined}
              className={`btn btn-secondary text-sm flex items-center gap-1 ${!canPublish ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Unpublish
            </button>

            {/* Destructive action - isolated with gap */}
            {canDelete && (
              <div className="ml-4 pl-4 border-l border-lichen">
                <button
                  onClick={() => setShowBulkDeleteDialog(true)}
                  className="btn text-sm flex items-center gap-1 border border-semantic-error/30 text-semantic-error hover:bg-semantic-error/10 hover:border-semantic-error"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}

        {/* Scope indicator: visible when all current-page items are selected but more exist */}
        {selectedItems.size > 0 && selectedItems.size === mediaItems.length && mediaData?.total != null && mediaData.total > mediaItems.length && (
          <div className="px-4 py-2 bg-bark/5 border border-lichen rounded-lg text-sm text-archive text-center">
            All {mediaItems.length} items on this page are selected. {mediaData.total - mediaItems.length} more item{mediaData.total - mediaItems.length !== 1 ? 's' : ''} match your filters.
          </div>
        )}
      </div>

      {/* Drop Zone when dragging - rendered via portal to escape stacking context */}
      {dragOver && createPortal(
        <div
          className="fixed inset-0 bg-forest/20 flex items-center justify-center z-50"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="bg-parchment p-12 rounded-lg shadow-xl text-center">
            <Upload size={48} className="mx-auto text-forest mb-4" />
            <p className="text-xl font-medium">Drop files to upload</p>
          </div>
        </div>,
        document.body
      )}

      {/* Media Grid/List */}
      {mediaItems.length === 0 ? (
        isVisualSearch && debouncedSearch ? (
          <div className="card p-12 text-center">
            {(visualLoading || visualFetching) ? (
              <>
                <Loader2 size={48} className="mx-auto text-archive mb-4 animate-spin" />
                <h3 className="text-lg font-medium text-ink mb-2">Searching...</h3>
                <p className="text-archive">Finding visually matching media</p>
              </>
            ) : (
              <>
                <Sparkles size={48} className="mx-auto text-archive mb-4" />
                <h3 className="text-lg font-medium text-ink mb-2">No matches</h3>
                <p className="text-archive">No media matched your description. Try different terms.</p>
              </>
            )}
          </div>
        ) : (
          <div
            className="card p-12 text-center"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <Upload size={48} className="mx-auto text-archive mb-4" />
            <h3 className="text-lg font-medium text-ink mb-6">No media yet.</h3>
            {canEdit && (
              <button
                onClick={() => setShowUploadModal(true)}
                className="btn btn-primary"
              >
                Upload Media
              </button>
            )}
          </div>
        )
      ) : viewMode === 'grid' ? (
        <div
          className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 transition-all duration-300 ${isFetching ? 'opacity-60' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {mediaItems.map((media: Media, index: number) => (
            <MediaGridItem
              key={media.media_id}
              media={media}
              orgId={orgId!}
              selected={selectedItems.has(media.media_id)}
              onSelect={(e) => handleSelect(index, media.media_id, e)}
              onClick={() => navigate(`/organizations/${orgId}/media/${media.media_id}`)}
              onDelete={canDelete ? () => {
                setMediaToDelete(media.media_id);
                setShowDeleteDialog(true);
              } : undefined}
              collectionDropdownOpen={collectionDropdownOpen === media.media_id}
              onCollectionDropdownToggle={(open) => setCollectionDropdownOpen(open ? media.media_id : null)}
              animationDelay={index * 30}
              onDragStart={() => handleMediaDragStart(media.media_id)}
              onDragEnd={handleMediaDragEnd}
              isDragging={draggingMediaIds.includes(media.media_id)}
              similarity={visualSimilarityMap.get(media.media_id)}
            />
          ))}
        </div>
      ) : (
        <div className={`card overflow-hidden transition-opacity duration-300 ${isFetching ? 'opacity-60' : ''}`}>
          {/* Desktop list view — 8-col table, md and up */}
          <table className="hidden md:table w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="w-8 p-3">
                  <Checkbox
                    checked={selectedItems.size === mediaItems.length && mediaItems.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedItems(new Set(mediaItems.map((m: Media) => m.media_id)));
                      } else {
                        setSelectedItems(new Set());
                      }
                    }}
                  />
                </th>
                <th className="p-3 text-left text-sm font-medium text-archive">Preview</th>
                <th className="p-3 text-left text-sm font-medium text-archive">Name</th>
                <th className="p-3 text-left text-sm font-medium text-archive">Type</th>
                <th className="p-3 text-left text-sm font-medium text-archive">Size</th>
                <th className="p-3 text-left text-sm font-medium text-archive">Status</th>
                <th className="p-3 text-left text-sm font-medium text-archive">Created</th>
                <th className="w-12 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {mediaItems.map((media: Media, index: number) => (
                <MediaListItem
                  key={media.media_id}
                  media={media}
                  orgId={orgId!}
                  selected={selectedItems.has(media.media_id)}
                  onSelect={(e) => handleSelect(index, media.media_id, e)}
                  onClick={() => navigate(`/organizations/${orgId}/media/${media.media_id}`)}
                  onDelete={canDelete ? () => {
                    setMediaToDelete(media.media_id);
                    setShowDeleteDialog(true);
                  } : undefined}
                  formatFileSize={formatFileSize}
                  collectionDropdownOpen={collectionDropdownOpen === media.media_id}
                  onCollectionDropdownToggle={(open) => setCollectionDropdownOpen(open ? media.media_id : null)}
                  onDragStart={() => handleMediaDragStart(media.media_id)}
                  onDragEnd={handleMediaDragEnd}
                  isDragging={draggingMediaIds.includes(media.media_id)}
                />
              ))}
            </tbody>
          </table>

          {/* Mobile list view — stacked cards, below md. Table layout with 8
           * columns is unusable at phone widths, so each row becomes a
           * horizontal card: checkbox, thumbnail, name+metadata, actions. */}
          <ul className="md:hidden divide-y divide-lichen">
            {mediaItems.map((media: Media, index: number) => {
              const MediaIcon =
                MEDIA_TYPE_ICONS[media.media_type as keyof typeof MEDIA_TYPE_ICONS] || FileText;
              const isSelected = selectedItems.has(media.media_id);
              return (
                <li
                  key={media.media_id}
                  className={`flex items-center gap-3 p-3 cursor-pointer select-none transition-colors ${
                    isSelected ? 'bg-forest/5' : 'active:bg-stone/40 hover:bg-stone/20'
                  }`}
                  onClick={() => navigate(`/organizations/${orgId}/media/${media.media_id}`)}
                >
                  <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <Checkbox
                      checked={isSelected}
                      onChange={(e) => handleSelect(index, media.media_id, e)}
                    />
                  </div>
                  <div className="w-14 h-14 shrink-0 bg-stone rounded flex items-center justify-center overflow-hidden">
                    {media.thumbnail_url ? (
                      <img
                        src={media.thumbnail_url}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <MediaIcon size={24} className="text-archive" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">
                      {media.title || media.filename}
                    </p>
                    <p className="text-xs text-archive truncate">
                      <span className="inline-flex items-center gap-1">
                        <MediaIcon size={11} />
                        {media.media_type}
                      </span>
                      {' · '}
                      {formatFileSize(media.file_size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollectionDropdownOpen(
                            collectionDropdownOpen === media.media_id ? null : media.media_id
                          );
                        }}
                        className="tap-target rounded text-archive hover:text-ink hover:bg-stone"
                        aria-label="Add to Lightbox"
                      >
                        <FolderPlus size={18} />
                      </button>
                      {collectionDropdownOpen === media.media_id && (
                        <AddToCollectionDropdown
                          organizationId={orgId!}
                          mediaId={media.media_id}
                          onClose={() => setCollectionDropdownOpen(null)}
                        />
                      )}
                    </div>
                    {canDelete && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMediaToDelete(media.media_id);
                          setShowDeleteDialog(true);
                        }}
                        className="tap-target rounded text-archive hover:text-semantic-error hover:bg-semantic-error/10"
                        aria-label="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Pagination — list/search paths only (visual search returns a fixed top-k) */}
      {!isVisualSearch && mediaItems.length > 0 && (mediaData?.total ?? 0) > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-archive">
            Page {page} of {Math.ceil((mediaData?.total ?? 0) / PAGE_SIZE)}
            {' · '}{mediaData?.total} items
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment text-ink hover:bg-stone disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= Math.ceil((mediaData?.total ?? 0) / PAGE_SIZE) || isFetching}
              className="px-3 py-1.5 text-sm border border-lichen rounded-lg bg-parchment text-ink hover:bg-stone disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Upload Modal - rendered via portal to escape stacking context */}
      {showUploadModal && createPortal(
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4">
          <div className="bg-parchment rounded-lg max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Upload Media</h2>
              <button onClick={() => setShowUploadModal(false)} className="text-archive hover:text-ink">
                <X size={24} />
              </button>
            </div>

            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center ${
                dragOver ? 'border-forest bg-forest/5' : 'border-archive'
              }`}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files.length > 0) {
                  handleUpload(e.dataTransfer.files);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
            >
              <Upload size={48} className="mx-auto text-archive mb-4" />
              <p className="text-lg font-medium mb-2">Drop files here or click to upload</p>
              <p className="text-sm text-archive mb-4">
                Supports images, videos, audio, and documents
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.glb,.gltf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn btn-primary"
              >
                Select Files
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Upload from URL Modal */}
      {showUrlUploadModal && (
        <UploadFromUrlModal
          organizationId={orgId!}
          folderId={selectedFolderId || undefined}
          onClose={() => {
            setShowUrlUploadModal(false);
            queryClient.invalidateQueries({ queryKey: ['media', orgId] });
          }}
        />
      )}

      {/* Bulk Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={showBulkDeleteDialog}
        onClose={() => setShowBulkDeleteDialog(false)}
        onConfirm={() => {
          selectedItems.forEach((id) => deleteMutation.mutate(id));
        }}
        title="Delete Media Items"
        message={`Are you sure you want to delete ${selectedItems.size} items? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Single Item Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setMediaToDelete(null);
        }}
        onConfirm={() => {
          if (mediaToDelete) {
            deleteMutation.mutate(mediaToDelete);
            setShowDeleteDialog(false);
            setMediaToDelete(null);
          }
        }}
        title="Delete Media Item"
        message="Are you sure you want to delete this media item? This action cannot be undone."
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Batch Metadata Panel */}
      {showBatchMetadataPanel && (
        <BatchMetadataPanel
          organizationId={orgId!}
          selectedMediaIds={Array.from(selectedItems)}
          onClose={() => {
            setShowBatchMetadataPanel(false);
            setSelectedItems(new Set());
          }}
        />
      )}
      </div>

      {/* Folder Context Menu */}
      {folderContextMenu && (
        <FolderContextMenu
          folder={folderContextMenu.folder}
          position={folderContextMenu.position}
          onClose={() => setFolderContextMenu(null)}
          onCreateSubfolder={handleCreateFolder}
          onRename={handleRenameFolder}
          onDelete={handleDeleteFolder}
        />
      )}

      {/* Create/Rename Folder Modal */}
      {showCreateFolderModal && (
        <CreateFolderModal
          organizationId={orgId!}
          parentFolderId={createFolderParentId}
          editFolder={editFolder}
          onClose={() => {
            setShowCreateFolderModal(false);
            setCreateFolderParentId(null);
            setEditFolder(null);
          }}
        />
      )}

      {/* Delete Folder Confirm Dialog */}
      {canDelete && <ConfirmDialog
        isOpen={showDeleteFolderDialog}
        onClose={() => {
          setShowDeleteFolderDialog(false);
          setFolderToDelete(null);
        }}
        onConfirm={() => {
          if (folderToDelete) {
            deleteFolderMutation.mutate(folderToDelete.folder_id);
          }
        }}
        title="Delete Folder"
        message={`Are you sure you want to delete "${folderToDelete?.name}"? Media in this folder will be moved to the root level.`}
        confirmText="Delete"
        confirmStyle="danger"
      />}

      {/* Move to Folder Modal */}
      {showMoveToFolderModal && (
        <MoveToFolderModal
          organizationId={orgId!}
          mediaIds={Array.from(selectedItems)}
          currentFolderId={selectedFolderId}
          onClose={() => setShowMoveToFolderModal(false)}
          onSuccess={() => {
            setSelectedItems(new Set());
            refetch();
          }}
        />
      )}

      {/* Add to Workspace Dialog */}
      {showAddToWorkspaceDialog && (
        <AddToMediaWorkspaceDialog
          isOpen={showAddToWorkspaceDialog}
          onClose={() => {
            setShowAddToWorkspaceDialog(false);
            setSelectedItems(new Set());
          }}
          mediaIds={Array.from(selectedItems)}
          assetLabel={`${selectedItems.size} asset${selectedItems.size !== 1 ? 's' : ''}`}
        />
      )}

      {/* Quick Actions dialog for the active media workspace */}
      {activeMediaWorkspace && (
        <MediaBulkActionDialog
          isOpen={showBulkActionDialog}
          onClose={() => {
            setShowBulkActionDialog(false);
            queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
          }}
          workspaceId={activeMediaWorkspace.workspace_id}
          workspaceName={activeMediaWorkspace.name}
          assetCount={activeMediaWorkspace.asset_count}
        />
      )}

      {/* Save Search as Work Set Dialog */}
      <SaveMediaSearchAsWorkSetDialog
        isOpen={showSaveAsWorkSetDialog}
        onClose={() => setShowSaveAsWorkSetDialog(false)}
        searchQuery={debouncedSearch || undefined}
        filters={{
          media_type: mediaType || undefined,
          processing_status: processingStatus || undefined,
          ai_processing_status: aiStatus || undefined,
          is_published:
            publishedStatus === 'published'
              ? true
              : publishedStatus === 'unpublished'
                ? false
                : undefined,
          color_key: colorFilter || undefined,
          tag_filters:
            tagFilters.length > 0
              ? tagFilters.map((t) => ({ key: t.key, value: t.value }))
              : undefined,
        }}
        resultCount={mediaData?.total}
      />
    </div>
  );
}

// Grid item component
function MediaGridItem({
  media,
  orgId,
  selected,
  onSelect,
  onClick,
  onDelete,
  collectionDropdownOpen,
  onCollectionDropdownToggle,
  animationDelay = 0,
  onDragStart,
  onDragEnd,
  isDragging,
  similarity,
}: {
  media: Media;
  orgId: string;
  selected: boolean;
  onSelect: (e: React.MouseEvent | React.ChangeEvent) => void;
  onClick: () => void;
  onDelete?: () => void;
  collectionDropdownOpen: boolean;
  onCollectionDropdownToggle: (open: boolean) => void;
  animationDelay?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  similarity?: number;
}) {
  const Icon = MEDIA_TYPE_ICONS[media.media_type as keyof typeof MEDIA_TYPE_ICONS] || FileText;
  const statusKey = media.processing_status as keyof typeof PROCESSING_STATUS_STYLES;
  const status = PROCESSING_STATUS_STYLES[statusKey];
  const StatusIcon = status?.icon;
  const shouldAnimate = statusKey === 'processing';
  const rightsStatus = getQuickRightsStatus(media);

  const handleClick = (e: React.MouseEvent) => {
    // Shift-click: select (range selection) instead of navigating
    if (e.shiftKey) {
      e.preventDefault();
      onSelect(e);
    } else {
      onClick();
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', media.media_id);
    // Module-level shared state for the RecordSetStrip drop target.
    setDragPayload({
      kind: 'media',
      mediaId: media.media_id,
      filename: media.filename || '',
      title: media.title || media.filename || '',
    });
    onDragStart?.();
  };

  return (
    <div
      className={`group relative card overflow-hidden cursor-pointer transition-all duration-300 hover:scale-[1.02] animate-fade-in select-none ${selected ? 'ring-2 ring-forest' : ''} ${isDragging ? 'opacity-50' : ''}`}
      style={{ animationDelay: `${animationDelay}ms` }}
      onClick={handleClick}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
    >
      {/* Selection checkbox — always visible on touch, hover-reveal on desktop */}
      <div
        className={`absolute top-2 left-2 z-20 transition-opacity ${
          selected ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onChange={onSelect}
          className="bg-parchment/90 shadow-sm"
        />
      </div>

      {/* Right-side badges — stacked vertically to avoid overlap */}
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 items-end">
        {similarity != null && (
          <div className="bg-ink/70 text-parchment text-xs px-2 py-0.5 rounded-full">
            {Math.round(similarity * 100)}%
          </div>
        )}
        {similarity == null && media.processing_status !== 'completed' && status && StatusIcon && (
          <div className={`${status.bg} ${status.color} p-1 rounded`}>
            <StatusIcon size={14} className={shouldAnimate ? 'animate-spin' : ''} />
          </div>
        )}
        {(media as Media & { locked_by?: string }).locked_by && (
          <div className="bg-semantic-warning/90 text-parchment p-1 rounded" title="Locked for editing">
            <Lock size={14} />
          </div>
        )}
      </div>

      {/* Thumbnail/Preview */}
      <div className="aspect-square bg-stone flex items-center justify-center relative">
        {media.thumbnail_url ? (
          <>
            <img
              src={media.thumbnail_url}
              alt={media.title || media.filename}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
            />
            <div className="hidden w-full h-full flex items-center justify-center absolute inset-0">
              <Icon className="text-archive" style={{ width: '30%', height: '30%' }} />
            </div>
          </>
        ) : media.media_type === 'image' && media.url ? (
          <>
            <img
              src={media.preview_url || media.thumbnail_url || media.url}
              alt={media.title || media.filename}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
            />
            <div className="hidden w-full h-full flex items-center justify-center absolute inset-0">
              <Icon className="text-archive" style={{ width: '30%', height: '30%' }} />
            </div>
          </>
        ) : (
          <Icon className="text-archive" style={{ width: '30%', height: '30%' }} />
        )}

        {/* Rights status indicator - bottom left corner */}
        {rightsStatus.dotColor && (
          <div
            className="absolute bottom-[8%] left-[8%] z-10"
            title={rightsStatus.label}
          >
            <span className={`block w-2 h-2 rounded-full ${rightsStatus.dotColor} ring-2 ring-parchment/80`} />
          </div>
        )}
        {/* Published indicator - bottom right corner */}
        {media.is_published && (
          <div
            className="absolute bottom-[8%] right-[8%] z-10 bg-semantic-success/90 text-parchment p-[4%] rounded-full"
            title="Published"
          >
            <Globe className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
          </div>
        )}
      </div>

      {/* Info. Dimensions/mime are shown only at md+ — on phones the space
       * is better spent on the action row below the filename. */}
      <div className="p-2">
        <p className="text-sm font-medium text-ink truncate" title={media.title || media.filename}>
          {media.title || media.filename}
        </p>
        <p className="hidden md:block text-xs text-archive">
          {media.width && media.height ? `${media.width}x${media.height}` : media.mime_type}
        </p>

        {/* Mobile action row — always visible below md. Stacks under the
         * filename so it never overlaps the text. Desktop uses the hover
         * overlay instead. */}
        <div className="md:hidden mt-1 flex items-center justify-end gap-0.5">
          {media.url && (
            <a
              href={media.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-8 h-8 rounded text-ink hover:bg-stone"
              aria-label="Open in new tab"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
          )}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCollectionDropdownToggle(!collectionDropdownOpen);
              }}
              className="inline-flex items-center justify-center w-8 h-8 rounded text-ink hover:bg-stone"
              aria-label="Add to Lightbox"
            >
              <FolderPlus size={14} />
            </button>
            {collectionDropdownOpen && (
              <AddToCollectionDropdown
                organizationId={orgId}
                mediaId={media.media_id}
                onClose={() => onCollectionDropdownToggle(false)}
              />
            )}
          </div>
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="inline-flex items-center justify-center w-8 h-8 rounded text-archive hover:bg-semantic-error/10 hover:text-semantic-error"
              aria-label="Delete"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Hover actions (desktop only) — hierarchy: Open (primary), Add to Collection (secondary), Delete (destructive/muted) */}
      <div
        className="hidden md:flex absolute inset-0 bg-ink/50 opacity-0 group-hover:opacity-100 transition-opacity flex-col items-center justify-center gap-2 pointer-events-none"
      >
        <div className="flex items-center gap-2">
          {/* Primary action: Open */}
          {media.url && (
            <a
              href={media.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 bg-parchment rounded-full hover:bg-stone text-ink pointer-events-auto"
              title="Open in new tab"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {/* Secondary action: Add to Collection */}
          <div className="relative pointer-events-auto">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCollectionDropdownToggle(!collectionDropdownOpen);
              }}
              className="p-2 bg-parchment/90 rounded-full hover:bg-parchment text-ink/80 hover:text-ink"
              title="Add to Lightbox"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
            {collectionDropdownOpen && (
              <AddToCollectionDropdown
                organizationId={orgId}
                mediaId={media.media_id}
                onClose={() => onCollectionDropdownToggle(false)}
              />
            )}
          </div>
          {/* Destructive action: Delete - muted by default, full opacity on direct hover */}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-2 bg-parchment/70 rounded-full text-archive hover:bg-parchment hover:text-semantic-error pointer-events-auto transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        {/* Rights status label on hover */}
        {rightsStatus.label && (
          <span className="text-xs text-parchment/90 bg-ink/40 px-2 py-1 rounded pointer-events-none">
            {rightsStatus.label}
          </span>
        )}
      </div>
    </div>
  );
}

// List item component
function MediaListItem({
  media,
  orgId,
  selected,
  onSelect,
  onClick,
  onDelete,
  formatFileSize,
  collectionDropdownOpen,
  onCollectionDropdownToggle,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  media: Media;
  orgId: string;
  selected: boolean;
  onSelect: (e: React.MouseEvent | React.ChangeEvent) => void;
  onClick: () => void;
  onDelete?: () => void;
  formatFileSize: (bytes: number) => string;
  collectionDropdownOpen: boolean;
  onCollectionDropdownToggle: (open: boolean) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const Icon = MEDIA_TYPE_ICONS[media.media_type as keyof typeof MEDIA_TYPE_ICONS] || FileText;
  const statusKey = media.processing_status as keyof typeof PROCESSING_STATUS_STYLES;
  const status = PROCESSING_STATUS_STYLES[statusKey];
  const StatusIcon = status?.icon;
  const shouldAnimate = statusKey === 'processing';
  const rightsStatus = getQuickRightsStatus(media);

  const handleClick = (e: React.MouseEvent) => {
    // Shift-click: select (range selection) instead of navigating
    if (e.shiftKey) {
      e.preventDefault();
      onSelect(e);
    } else {
      onClick();
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', media.media_id);
    setDragPayload({
      kind: 'media',
      mediaId: media.media_id,
      filename: media.filename || '',
      title: media.title || media.filename || '',
    });
    onDragStart?.();
  };

  return (
    <tr
      className={`border-t cursor-pointer select-none ${selected ? 'bg-forest/5' : 'hover:bg-stone/30'} ${isDragging ? 'opacity-50' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
    >
      <td className="p-3" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onChange={onSelect}
        />
      </td>
      <td className="p-3" onClick={handleClick}>
        <div className="w-12 h-12 bg-stone rounded flex items-center justify-center overflow-hidden relative">
          {media.thumbnail_url ? (
            <>
              <img
                src={media.thumbnail_url}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
              />
              <div className="hidden w-full h-full flex items-center justify-center absolute inset-0">
                <Icon size={24} className="text-archive" />
              </div>
            </>
          ) : (
            <Icon size={24} className="text-archive" />
          )}
          {/* Rights status dot */}
          {rightsStatus.dotColor && (
            <span
              className={`absolute bottom-1 left-1 w-2 h-2 rounded-full ${rightsStatus.dotColor} ring-1 ring-parchment/80`}
              title={rightsStatus.label}
            />
          )}
        </div>
      </td>
      <td className="p-3" onClick={handleClick}>
        <p className="font-medium text-ink">{media.title || media.filename}</p>
        {media.description && (
          <p className="text-sm text-archive truncate max-w-xs">{media.description}</p>
        )}
      </td>
      <td className="p-3">
        <span className="inline-flex items-center gap-1 text-sm text-archive">
          <Icon size={14} />
          {media.media_type}
        </span>
      </td>
      <td className="p-3 text-sm text-archive">{formatFileSize(media.file_size)}</td>
      <td className="p-3">
        <div className="flex items-center gap-2">
          {status && StatusIcon && (
            <span className={`inline-flex items-center gap-1 text-sm ${status.color}`}>
              <StatusIcon size={14} className={shouldAnimate ? 'animate-spin' : ''} />
              {media.processing_status}
            </span>
          )}
          {media.is_published && (
            <span className="inline-flex items-center gap-1 text-xs text-semantic-success" title="Published">
              <Globe size={12} />
            </span>
          )}
        </div>
      </td>
      <td className="p-3 text-sm text-archive">
        {media.created_at && formatDateShort(media.created_at)}
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1">
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCollectionDropdownToggle(!collectionDropdownOpen);
              }}
              className="p-2 hover:bg-stone rounded text-archive hover:text-ink"
              title="Add to Lightbox"
            >
              <FolderPlus size={16} />
            </button>
            {collectionDropdownOpen && (
              <AddToCollectionDropdown
                organizationId={orgId}
                mediaId={media.media_id}
                onClose={() => onCollectionDropdownToggle(false)}
              />
            )}
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-2 hover:bg-semantic-error/10 rounded text-archive hover:text-semantic-error"
              title="Delete"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
