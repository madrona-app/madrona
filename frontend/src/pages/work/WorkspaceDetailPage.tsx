/**
 * WorkspaceDetailPage - View and manage a single Work Set
 *
 * Unified page that handles both collections and media workspaces.
 * Determines type from workspace data and renders appropriate UI.
 *
 * Work Sets are operational groupings for bulk operations and team collaboration.
 * Shows work set details and allows:
 * - Viewing/managing items (objects or assets)
 * - Setting as active context
 * - Sharing with team members
 * - Running bulk actions
 */

import { useState, useCallback } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  Package,
  Image,
  Plus,
  Trash2,
  Share2,
  MoreHorizontal,
  ChevronLeft,
  Globe,
  Lock,
  Users,
  Zap,
  GripVertical,
  X,
  Grid,
  List,
  Pin,
  AlertTriangle,
  Search,
  Filter,
  FileSpreadsheet,
} from 'lucide-react';
import { cn, formatFileSize } from '../../lib/utils';
import {
  getWorkspace,
  removeWorkspaceItems,
  setWorkspaceContext,
  setMediaWorkspaceContext,
  deleteWorkspace,
  pinWorkspaceItem,
  updateWorkspace,
} from '../../lib/api';
import { SearchAndAddObjectsDialog, WorkspaceShareDialog, BulkActionDialog } from '../../components/workspaces';
import MediaWorkspaceShareDialog from '../../components/media-workspaces/MediaWorkspaceShareDialog';
import MediaWorkspaceAddAssetsDialog from '../../components/media-workspaces/MediaWorkspaceAddAssetsDialog';
import { MediaBulkActionDialog } from '../../components/media-workspaces';
import type { WorkspaceItem, MediaWorkspaceItem } from '../../lib/schemas';
import { GenerateReportSlideOver } from '../../components/reports/GenerateReportSlideOver';
import ConfirmDialog from '../../components/ConfirmDialog';

// Union type for workspace items
type UnifiedWorkspaceItem = WorkspaceItem | MediaWorkspaceItem;

// Type guard to check if item is a media item
function isMediaItem(item: UnifiedWorkspaceItem): item is MediaWorkspaceItem {
  return 'media_id' in item;
}

// Get the item's primary ID
function getItemId(item: UnifiedWorkspaceItem): string {
  return isMediaItem(item) ? item.media_id : item.object_id;
}

export default function WorkspaceDetailPage() {
  const { orgId, workspaceId } = useParams<{ orgId: string; workspaceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showBulkActionDialog, setShowBulkActionDialog] = useState(false);
  const [showReportSlideOver, setShowReportSlideOver] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [showEditQueryDialog, setShowEditQueryDialog] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const saved = localStorage.getItem('workset-view-mode');
    return (saved === 'grid' || saved === 'list') ? saved : 'grid';
  });

  const handleViewModeChange = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('workset-view-mode', mode);
  };

  // Fetch workspace details - unified API returns workspace_type
  const { data: workspace, isLoading } = useQuery({
    queryKey: ['workspace', orgId, workspaceId],
    queryFn: () => getWorkspace(orgId!, workspaceId!),
    enabled: !!orgId && !!workspaceId,
  });

  // Determine if this is a media workspace
  const isMedia = workspace?.workspace_type === 'media';
  const workSegment = isMedia ? 'media' : 'collections';
  const itemType = isMedia ? 'media' : 'objects';
  const ItemIcon = isMedia ? Image : Package;
  const itemLabel = isMedia ? 'assets' : 'objects';
  const itemCount = isMedia ? workspace?.asset_count : workspace?.object_count;

  // Remove items mutation - handles both types
  const removeItemsMutation = useMutation({
    mutationFn: (itemIds: string[]) => removeWorkspaceItems(orgId!, workspaceId!, itemIds, itemType),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', orgId, workspaceId] });
      setSelectedItems(new Set());
      setError(null);
      setSuccessMessage(`Removed ${data.removed_count} ${itemLabel} from work set`);
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to remove items');
    },
  });

  // Set context mutation — uses the right endpoint per workspace type
  const setContextMutation = useMutation({
    mutationFn: async () => isMedia
      ? setMediaWorkspaceContext(orgId!, workspaceId!)
      : setWorkspaceContext(orgId!, workspaceId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-context'] });
      queryClient.invalidateQueries({ queryKey: ['media-active-context'] });
      setError(null);
      setSuccessMessage('Work set is now active context');
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to set work set as context');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteWorkspace(orgId!, workspaceId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['media-workspaces'] });
      navigate(`/organizations/${orgId}/${workSegment}/work/workspaces`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to delete work set');
    },
  });

  // Pin mutation (for dynamic workspaces)
  const pinMutation = useMutation({
    mutationFn: (objectId: string) => pinWorkspaceItem(orgId!, workspaceId!, objectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', orgId, workspaceId] });
      setSuccessMessage('Item pinned to work set');
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to pin item');
    },
  });

  // Set cover image mutation (media workspaces only)
  const setCoverMutation = useMutation({
    mutationFn: (mediaId: string | null) =>
      updateWorkspace(orgId!, workspaceId!, { cover_media_id: mediaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', orgId, workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspaces', orgId] });
      queryClient.invalidateQueries({ queryKey: ['media-workspaces'] });
      setSuccessMessage('Cover image updated');
      setTimeout(() => setSuccessMessage(null), 3000);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to set cover image');
    },
  });

  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string; confirmStyle: 'danger' | 'primary'} | null>(null);

  const handleRemoveSelected = () => {
    if (selectedItems.size === 0) return;
    setConfirmState({
      action: () => removeItemsMutation.mutate(Array.from(selectedItems)),
      title: 'Remove Items',
      message: `Remove ${selectedItems.size} ${itemLabel} from this work set?`,
      confirmStyle: 'danger',
    });
  };

  const handleDelete = () => {
    setConfirmState({
      action: () => deleteMutation.mutate(),
      title: 'Delete Work Set',
      message: `Delete work set "${workspace?.name}"? This cannot be undone.`,
      confirmStyle: 'danger',
    });
  };

  const toggleSelectAll = () => {
    if (!workspace) return;
    if (selectedItems.size === workspace.items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(workspace.items.map((item) => getItemId(item))));
    }
  };

  // Handle selection with shift-click support
  const handleSelect = useCallback((itemId: string, index: number, event: React.MouseEvent) => {
    if (!workspace) return;

    const newSelected = new Set(selectedItems);

    if (event.shiftKey && lastSelectedIndex !== null) {
      // Range selection
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      for (let i = start; i <= end; i++) {
        newSelected.add(getItemId(workspace.items[i]));
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle individual item
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId);
      } else {
        newSelected.add(itemId);
      }
    } else {
      // Single selection (clear others)
      if (newSelected.has(itemId) && newSelected.size === 1) {
        newSelected.delete(itemId);
      } else {
        newSelected.clear();
        newSelected.add(itemId);
      }
    }

    setSelectedItems(newSelected);
    setLastSelectedIndex(index);
  }, [workspace, selectedItems, lastSelectedIndex]);

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case 'private':
        return <Lock size={14} className="text-archive" />;
      case 'shared':
        return <Users size={14} className="text-bark" />;
      case 'org':
        return <Globe size={14} className="text-semantic-success" />;
      default:
        return null;
    }
  };

  const canEdit = workspace?.is_owner || workspace?.permission_level === 'admin' || workspace?.permission_level === 'edit';
  const canExecute = workspace?.is_owner || workspace?.permission_level === 'admin' || workspace?.permission_level === 'execute';

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-stone/50 rounded w-1/4" />
          <div className="h-4 bg-stone/50 rounded w-1/3" />
          <div className="h-64 bg-stone/50 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="text-center py-16">
          <Layers size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">Work set not found</h3>
          <Link
            to={`/organizations/${orgId}/${workSegment}/work/workspaces`}
            className="text-bark hover:text-copper-dark"
          >
            Back to work sets
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <Link
          to={`/organizations/${orgId}/${workSegment}/work/workspaces`}
          className="flex items-center gap-1 text-archive hover:text-bark"
        >
          <ChevronLeft size={16} />
          Work Sets
        </Link>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-semantic-error hover:text-semantic-error/80">
            <X size={16} />
          </button>
        </div>
      )}
      {successMessage && (
        <div className="mb-4 p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-lg text-sm text-semantic-success">
          {successMessage}
        </div>
      )}

      {/* Header */}
      <div className="bg-parchment border border-lichen rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4 min-w-0">
            {workspace.cover_thumbnail_url ? (
              <img
                src={workspace.cover_thumbnail_url}
                alt={`${workspace.name} cover`}
                className="w-20 h-20 rounded-lg object-cover border border-lichen flex-shrink-0"
              />
            ) : (
              <div className="p-3 bg-bark/10 rounded-lg flex-shrink-0">
                <Layers size={28} className="text-bark" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold text-ink">{workspace.name}</h1>
              </div>
              {workspace.description && (
                <p className="text-sm text-archive mt-1">{workspace.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-sm">
                {workspace.is_dynamic ? (
                  <div className="flex items-center gap-1.5 text-archive">
                    <ItemIcon size={14} />
                    <span>
                      {workspace.pinned_count ?? 0} pinned + {workspace.dynamic_count ?? 0} dynamic results
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-archive">
                    <ItemIcon size={14} />
                    <span>{itemCount} {itemLabel}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  {getVisibilityIcon(workspace.visibility)}
                  <span className="text-archive">
                    {workspace.visibility === 'private' ? 'Private' :
                     workspace.visibility === 'shared' ? 'Shared' : 'Organization'}
                  </span>
                </div>
                {!workspace.is_owner && workspace.owner_name && (
                  <span className="text-archive">
                    Owner: {workspace.owner_name}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setContextMutation.mutate()}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-bark text-bark rounded-lg hover:bg-bark/5"
            >
              <Layers size={16} />
              Set as Context
            </button>
            {!isMedia && workspace.items.length > 0 && (
              <button
                onClick={() => setShowReportSlideOver(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-lichen text-ink rounded-lg hover:bg-stone/30"
              >
                <FileSpreadsheet size={16} />
                Export
              </button>
            )}
            {canExecute && workspace.items.length > 0 && (
              <button
                onClick={() => setShowBulkActionDialog(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment"
              >
                <Zap size={16} />
                Quick Actions
              </button>
            )}
            {workspace.is_owner && (
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-2 rounded-lg border border-lichen hover:bg-stone/30"
                >
                  <MoreHorizontal size={18} className="text-archive" />
                </button>
                {showMenu && (
                  <>
                    {/* Backdrop to close menu */}
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowMenu(false)}
                    />
                    <div className="absolute right-0 top-10 w-48 bg-parchment border border-lichen rounded-lg shadow-lg py-1 z-20">
                      <button
                        onClick={() => {
                          setShowMenu(false);
                          setShowShareDialog(true);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-stone/30"
                      >
                        <Share2 size={14} />
                        Share Work Set
                      </button>
                      {workspace.is_dynamic && (
                        <button
                          onClick={() => {
                            setShowMenu(false);
                            setShowEditQueryDialog(true);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-stone/30"
                        >
                          <Search size={14} />
                          Edit Search Query
                        </button>
                      )}
                      <Link
                        to={`/organizations/${orgId}/${workSegment}/work/workspaces/${workspaceId}/edit`}
                        onClick={() => setShowMenu(false)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-stone/30"
                      >
                        Edit Details
                      </Link>
                      <button
                        onClick={() => {
                          setShowMenu(false);
                          handleDelete();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-semantic-error hover:bg-semantic-error/10"
                      >
                        <Trash2 size={14} />
                        Delete Work Set
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search unavailable warning for dynamic workspaces */}
      {workspace.is_dynamic && workspace.search_unavailable && (
        <div className="mb-4 p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg flex items-center gap-3">
          <AlertTriangle size={18} className="text-semantic-warning flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-semantic-warning">Search temporarily unavailable</p>
            <p className="text-xs text-archive">Only pinned items are shown. Dynamic results will return when search is restored.</p>
          </div>
        </div>
      )}

      {/* Items list */}
      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
          <div className="flex items-center gap-4">
            {canEdit && (
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={workspace.items.length > 0 && selectedItems.size === workspace.items.length}
                  onChange={toggleSelectAll}
                />
                <span className="text-sm text-archive">
                  {selectedItems.size > 0 ? `${selectedItems.size} selected` : 'Select all'}
                </span>
              </label>
            )}
            {selectedItems.size > 0 && canEdit && (
              <button
                onClick={handleRemoveSelected}
                className="flex items-center gap-1.5 text-sm text-semantic-error hover:underline"
              >
                <Trash2 size={14} />
                Remove selected
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center border border-lichen rounded-lg overflow-hidden">
              <button
                onClick={() => handleViewModeChange('grid')}
                className={cn(
                  'p-1.5 transition-colors',
                  viewMode === 'grid' ? 'bg-azurite/10 text-azurite' : 'text-archive hover:bg-stone/30'
                )}
                title="Grid view"
              >
                <Grid size={16} />
              </button>
              <button
                onClick={() => handleViewModeChange('list')}
                className={cn(
                  'p-1.5 transition-colors',
                  viewMode === 'list' ? 'bg-azurite/10 text-azurite' : 'text-archive hover:bg-stone/30'
                )}
                title="List view"
              >
                <List size={16} />
              </button>
            </div>
            {canEdit && (
              <button
                onClick={() => setShowAddDialog(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment"
              >
                <Plus size={16} />
                Add {isMedia ? 'Assets' : 'Objects'}
              </button>
            )}
          </div>
        </div>

        {/* Items display */}
        {workspace.items.length === 0 ? (
          <div className="text-center py-12">
            <ItemIcon size={32} className="mx-auto text-archive mb-3" />
            <p className="text-sm text-archive mb-4">No {itemLabel} in this work set yet</p>
            {canEdit && (
              <button
                onClick={() => setShowAddDialog(true)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment"
              >
                <Plus size={16} />
                Add {isMedia ? 'Assets' : 'Objects'}
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {workspace.items.map((item, index) => {
              const itemId = getItemId(item);
              const wsItem = item as WorkspaceItem;
              const isDynamic = workspace.is_dynamic;
              const isPinned = wsItem.source === 'pinned';
              const isDynamicItem = wsItem.source === 'dynamic';
              const wsPrimaryMediaId = (wsItem as WorkspaceItem & { primary_media_id?: string | null }).primary_media_id;
              return isMedia ? (
                <AssetGridItem
                  key={(item as MediaWorkspaceItem).workspace_item_id ?? `dynamic-${(item as MediaWorkspaceItem).media_id}`}
                  item={item as MediaWorkspaceItem}
                  orgId={orgId!}
                  isSelected={selectedItems.has(itemId)}
                  canEdit={canEdit}
                  isCover={workspace?.cover_media_id === (item as MediaWorkspaceItem).media_id}
                  isPinned={isDynamic ? isPinned : undefined}
                  onSelect={(e) => handleSelect(itemId, index, e)}
                  onRemove={!isDynamic || isPinned ? () => removeItemsMutation.mutate([itemId]) : undefined}
                  onPin={isDynamic && isDynamicItem && canEdit ? () => pinMutation.mutate(itemId) : undefined}
                  onSetCover={canEdit ? (mediaId) => setCoverMutation.mutate(mediaId) : undefined}
                />
              ) : (
                <ObjectGridItem
                  key={wsItem.workspace_item_id ?? `dynamic-${wsItem.object_id}`}
                  item={wsItem}
                  orgId={orgId!}
                  isSelected={selectedItems.has(itemId)}
                  canEdit={canEdit}
                  isCover={!!wsPrimaryMediaId && workspace?.cover_media_id === wsPrimaryMediaId}
                  onSelect={(e) => handleSelect(itemId, index, e)}
                  onRemove={isPinned ? () => removeItemsMutation.mutate([itemId]) : undefined}
                  onPin={isDynamic && isDynamicItem && canEdit ? () => pinMutation.mutate(itemId) : undefined}
                  onSetCover={canEdit ? (mediaId) => setCoverMutation.mutate(mediaId) : undefined}
                  isPinned={isDynamic ? isPinned : undefined}
                />
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="divide-y divide-lichen">
            {workspace.items.map((item, index) => {
              const itemId = getItemId(item);
              const wsItem = item as WorkspaceItem;
              const isDynamic = workspace.is_dynamic;
              const isPinned = wsItem.source === 'pinned';
              const isDynamicItem = wsItem.source === 'dynamic';
              const wsPrimaryMediaId = (wsItem as WorkspaceItem & { primary_media_id?: string | null }).primary_media_id;
              return isMedia ? (
                <AssetListItem
                  key={(item as MediaWorkspaceItem).workspace_item_id ?? `dynamic-${(item as MediaWorkspaceItem).media_id}`}
                  item={item as MediaWorkspaceItem}
                  orgId={orgId!}
                  isSelected={selectedItems.has(itemId)}
                  canEdit={canEdit}
                  isCover={workspace?.cover_media_id === (item as MediaWorkspaceItem).media_id}
                  isPinned={isDynamic ? isPinned : undefined}
                  onSelect={(e) => handleSelect(itemId, index, e)}
                  onRemove={!isDynamic || isPinned ? () => removeItemsMutation.mutate([itemId]) : undefined}
                  onPin={isDynamic && isDynamicItem && canEdit ? () => pinMutation.mutate(itemId) : undefined}
                  onSetCover={canEdit ? (mediaId) => setCoverMutation.mutate(mediaId) : undefined}
                />
              ) : (
                <ObjectListItem
                  key={wsItem.workspace_item_id ?? `dynamic-${wsItem.object_id}`}
                  item={wsItem}
                  orgId={orgId!}
                  isSelected={selectedItems.has(itemId)}
                  canEdit={canEdit}
                  isCover={!!wsPrimaryMediaId && workspace?.cover_media_id === wsPrimaryMediaId}
                  onSelect={(e) => handleSelect(itemId, index, e)}
                  onRemove={isPinned ? () => removeItemsMutation.mutate([itemId]) : undefined}
                  onPin={isDynamic && isDynamicItem && canEdit ? () => pinMutation.mutate(itemId) : undefined}
                  onSetCover={canEdit ? (mediaId) => setCoverMutation.mutate(mediaId) : undefined}
                  isPinned={isDynamic ? isPinned : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Dialogs - render appropriate ones based on workspace type */}
      {isMedia ? (
        <>
          {showAddDialog && (
            <MediaWorkspaceAddAssetsDialog
              isOpen={showAddDialog}
              onClose={() => setShowAddDialog(false)}
              workspaceId={workspaceId!}
              workspaceName={workspace.name}
            />
          )}
          {showShareDialog && (
            <MediaWorkspaceShareDialog
              isOpen={showShareDialog}
              onClose={() => setShowShareDialog(false)}
              workspaceId={workspaceId!}
              workspaceName={workspace.name}
              ownerId={workspace.owner_user_id}
            />
          )}
          {showBulkActionDialog && (
            <MediaBulkActionDialog
              isOpen={showBulkActionDialog}
              onClose={() => {
                setShowBulkActionDialog(false);
                queryClient.invalidateQueries({ queryKey: ['workspace', orgId, workspaceId] });
              }}
              workspaceId={workspaceId!}
              workspaceName={workspace.name}
              assetCount={workspace.items.length}
              selectedMediaIds={selectedItems.size > 0 ? Array.from(selectedItems) : undefined}
            />
          )}
        </>
      ) : (
        <>
          <SearchAndAddObjectsDialog
            isOpen={showAddDialog}
            onClose={() => setShowAddDialog(false)}
            workspaceId={workspaceId!}
            workspaceName={workspace.name}
            existingObjectIds={workspace.items.map((item) => (item as WorkspaceItem).object_id)}
          />
          <WorkspaceShareDialog
            isOpen={showShareDialog}
            onClose={() => setShowShareDialog(false)}
            workspaceId={workspaceId!}
            workspaceName={workspace.name}
            ownerId={workspace.owner_user_id}
          />
          <BulkActionDialog
            isOpen={showBulkActionDialog}
            onClose={() => {
              setShowBulkActionDialog(false);
              queryClient.invalidateQueries({ queryKey: ['workspace', orgId, workspaceId] });
            }}
            workspaceId={workspaceId!}
            workspaceName={workspace.name}
            objectCount={workspace.items.length}
          />
        </>
      )}

      {/* Edit Search Query Dialog (dynamic workspaces) */}
      {workspace.is_dynamic && showEditQueryDialog && (
        <EditQueryDialog
          isOpen={showEditQueryDialog}
          onClose={() => setShowEditQueryDialog(false)}
          workspaceId={workspaceId!}
          currentQuery={workspace.dynamic_query ?? {}}
        />
      )}

      {/* Generate Report SlideOver */}
      <GenerateReportSlideOver
        isOpen={showReportSlideOver}
        onClose={() => setShowReportSlideOver(false)}
        contextType="workspace"
        contextParams={{
          workspace_id: workspaceId,
          record_type: 'collection_objects',
        }}
        recordType="collection_objects"
      />

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle={confirmState?.confirmStyle ?? 'danger'}
      />
    </div>
  );
}

// Edit Query Dialog for dynamic workspaces
function EditQueryDialog({
  isOpen,
  onClose,
  workspaceId,
  currentQuery,
}: {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  currentQuery: Record<string, unknown>;
}) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [queryText, setQueryText] = useState(() => JSON.stringify(currentQuery, null, 2));
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (newQuery: Record<string, unknown>) =>
      updateWorkspace(orgId!, workspaceId, { dynamic_query: newQuery }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', orgId, workspaceId] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to update query');
    },
  });

  const handleSave = () => {
    try {
      const parsed = JSON.parse(queryText);
      setError(null);
      saveMutation.mutate(parsed);
    } catch {
      setError('Invalid JSON');
    }
  };

  // Build summary of current query
  const query = currentQuery as Record<string, unknown>;
  const queryObj = query.query as Record<string, unknown> | undefined;
  const filtersObj = query.filters as Record<string, unknown> | undefined;
  const summaryLines: string[] = [];
  if (queryObj && (queryObj as { q?: string }).q) {
    summaryLines.push(`Search: "${(queryObj as { q: string }).q}"`);
  }
  if (filtersObj) {
    for (const [key, value] of Object.entries(filtersObj)) {
      if (value !== null && value !== undefined) {
        const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const displayVal = Array.isArray(value) ? value.join(', ') : String(value);
        summaryLines.push(`${displayKey}: ${displayVal}`);
      }
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative bg-parchment rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Search size={20} className="text-bark" />
            <h2 className="text-lg font-semibold text-ink">Edit Search Query</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-stone/50 text-archive">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Readable summary */}
          {summaryLines.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Current Query</label>
              <div className="bg-stone/20 border border-lichen rounded-lg p-3 space-y-1">
                {summaryLines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-archive">
                    {line.startsWith('Search:') ? (
                      <Search size={14} className="text-bark flex-shrink-0" />
                    ) : (
                      <Filter size={14} className="text-bark flex-shrink-0" />
                    )}
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* JSON editor */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Query JSON</label>
            <textarea
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              rows={10}
              className="input w-full font-mono text-sm"
            />
          </div>

          {error && (
            <div className="text-sm text-semantic-error bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-lichen">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/30 text-ink"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Object Grid Item Component
function ObjectGridItem({
  item,
  orgId,
  isSelected,
  canEdit,
  isCover,
  onSelect,
  onRemove,
  onPin,
  onSetCover,
  isPinned,
}: {
  item: WorkspaceItem;
  orgId: string;
  isSelected: boolean;
  canEdit: boolean;
  isCover?: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  onPin?: () => void;
  onSetCover?: (mediaId: string | null) => void;
  isPinned?: boolean;
}) {
  const primaryMediaId = (item as WorkspaceItem & { primary_media_id?: string | null }).primary_media_id;
  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      onSelect(e);
    }
  };

  return (
    <div
      className={cn(
        'group relative bg-parchment border rounded-lg overflow-hidden cursor-pointer transition-all hover:shadow-md select-none',
        isSelected ? 'ring-2 ring-bark border-bark' : 'border-lichen hover:border-archive'
      )}
      onClick={handleClick}
    >
      {canEdit && (
        <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onChange={(e) => onSelect(e as unknown as React.MouseEvent)}
            className="bg-parchment/80"
          />
        </div>
      )}
      {/* Cover badge — matches media workset pattern */}
      {isCover && (
        <div className="absolute top-2 left-8 z-10 px-1.5 py-0.5 bg-bark text-parchment text-[10px] font-medium rounded">
          Cover
        </div>
      )}
      {/* Pin indicator for pinned items */}
      {isPinned && !onSetCover && (
        <div className="absolute top-2 right-8 z-10 p-1 bg-parchment/80 rounded text-bark" title="Pinned">
          <Pin size={12} />
        </div>
      )}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Set as cover button — only when a primary image exists and we're not already the cover */}
        {onSetCover && primaryMediaId && !isCover && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetCover(primaryMediaId);
            }}
            className="p-1 bg-parchment/80 rounded text-archive hover:text-bark hover:bg-parchment"
            title="Set as cover image"
          >
            <Image size={14} />
          </button>
        )}
        {/* Pin button for dynamic items */}
        {onPin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPin();
            }}
            className="p-1 bg-parchment/80 rounded text-archive hover:text-bark hover:bg-parchment"
            title="Pin to work set"
          >
            <Pin size={14} />
          </button>
        )}
        {/* Remove button */}
        {canEdit && onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="p-1 bg-parchment/80 rounded text-archive hover:text-semantic-error hover:bg-parchment"
            title={isPinned ? 'Unpin from work set' : 'Remove from work set'}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <Link
        to={`/organizations/${orgId}/collections/objects/${item.object_id}`}
        onClick={(e) => e.stopPropagation()}
        className="block aspect-square bg-stone/30"
      >
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package size={32} className="text-archive" />
          </div>
        )}
      </Link>
      <div className="p-2">
        <Link
          to={`/organizations/${orgId}/collections/objects/${item.object_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-medium text-ink hover:text-bark block truncate"
        >
          {item.accession_number || 'No accession #'}
        </Link>
        {item.title && <p className="text-xs text-archive truncate">{item.title}</p>}
      </div>
    </div>
  );
}

// Object List Item Component
function ObjectListItem({
  item,
  orgId,
  isSelected,
  canEdit,
  isCover,
  onSelect,
  onRemove,
  onPin,
  onSetCover,
  isPinned,
}: {
  item: WorkspaceItem;
  orgId: string;
  isSelected: boolean;
  canEdit: boolean;
  isCover?: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  onPin?: () => void;
  onSetCover?: (mediaId: string | null) => void;
  isPinned?: boolean;
}) {
  const primaryMediaId = (item as WorkspaceItem & { primary_media_id?: string | null }).primary_media_id;
  return (
    <div
      className={cn(
        'flex items-center gap-4 px-4 py-3 hover:bg-stone/30 cursor-pointer group select-none',
        isSelected && 'bg-bark/5'
      )}
      onClick={onSelect}
    >
      {canEdit && (
        <>
          <button className="cursor-move text-archive hover:text-ink">
            <GripVertical size={16} />
          </button>
          <Checkbox
            checked={isSelected}
            onChange={() => {}}
            onClick={(e) => e.stopPropagation()}
          />
        </>
      )}
      {/* Pin indicator */}
      {isPinned && (
        <span title="Pinned">
          <Pin size={14} className="text-bark flex-shrink-0" />
        </span>
      )}
      <div className="relative flex-shrink-0">
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt="" className="w-12 h-12 object-cover rounded" />
        ) : (
          <div className="w-12 h-12 bg-stone/50 rounded flex items-center justify-center">
            <Package size={20} className="text-archive" />
          </div>
        )}
        {isCover && (
          <div className="absolute -top-1 -right-1 px-1 py-0.5 bg-bark text-parchment text-[8px] font-medium rounded leading-none">
            Cover
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <Link
          to={`/organizations/${orgId}/collections/objects/${item.object_id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-ink hover:text-bark block truncate"
        >
          {item.accession_number || 'No accession number'}
        </Link>
        {item.title && <p className="text-sm text-archive truncate">{item.title}</p>}
      </div>
      {item.note && (
        <div className="text-xs text-archive bg-stone/30 px-2 py-1 rounded max-w-xs truncate">
          {item.note}
        </div>
      )}
      {/* Set as cover button — parity with media worksets */}
      {onSetCover && primaryMediaId && !isCover && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetCover(primaryMediaId);
          }}
          className="p-1.5 text-archive hover:text-bark rounded hover:bg-bark/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Set as cover image"
        >
          <Image size={16} />
        </button>
      )}
      {/* Pin button for dynamic items */}
      {onPin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          className="p-1.5 text-archive hover:text-bark rounded hover:bg-bark/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Pin to work set"
        >
          <Pin size={16} />
        </button>
      )}
      {/* Remove/unpin button */}
      {canEdit && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1.5 text-archive hover:text-semantic-error rounded hover:bg-semantic-error/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title={isPinned ? 'Unpin from work set' : 'Remove from work set'}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

// Asset Grid Item Component
function AssetGridItem({
  item,
  orgId,
  isSelected,
  canEdit,
  isCover,
  isPinned,
  onSelect,
  onRemove,
  onSetCover,
  onPin,
}: {
  item: MediaWorkspaceItem;
  orgId: string;
  isSelected: boolean;
  canEdit: boolean;
  isCover?: boolean;
  isPinned?: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  onSetCover?: (mediaId: string | null) => void;
  onPin?: () => void;
}) {
  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      onSelect(e);
    }
  };

  return (
    <div
      className={cn(
        'group relative bg-parchment border rounded-lg overflow-hidden cursor-pointer transition-all hover:shadow-md select-none',
        isSelected ? 'ring-2 ring-bark border-bark' : 'border-lichen hover:border-archive'
      )}
      onClick={handleClick}
    >
      {canEdit && (
        <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onChange={(e) => onSelect(e as unknown as React.MouseEvent)}
            className="bg-parchment/80"
          />
        </div>
      )}
      {/* Cover badge */}
      {isCover && (
        <div className="absolute top-2 left-8 z-10 px-1.5 py-0.5 bg-bark text-parchment text-[10px] font-medium rounded">
          Cover
        </div>
      )}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onSetCover && !isCover && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetCover(item.media_id);
            }}
            className="p-1 bg-parchment/80 rounded text-archive hover:text-bark hover:bg-parchment"
            title="Set as cover image"
          >
            <Image size={14} />
          </button>
        )}
        {onPin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPin();
            }}
            className="p-1 bg-parchment/80 rounded text-archive hover:text-bark hover:bg-parchment"
            title="Pin to work set"
          >
            <Pin size={14} />
          </button>
        )}
        {canEdit && onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="p-1 bg-parchment/80 rounded text-archive hover:text-semantic-error hover:bg-parchment"
            title={isPinned ? 'Unpin from work set' : 'Remove from work set'}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <Link
        to={`/organizations/${orgId}/media/${item.media_id}`}
        onClick={(e) => e.stopPropagation()}
        className="block aspect-square bg-stone/30"
      >
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Image size={32} className="text-archive" />
          </div>
        )}
      </Link>
      <div className="p-2">
        <Link
          to={`/organizations/${orgId}/media/${item.media_id}`}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-medium text-ink hover:text-bark block truncate"
        >
          {item.filename || 'Untitled'}
        </Link>
        <p className="text-xs text-archive truncate">{item.mime_type || 'Unknown type'}</p>
      </div>
    </div>
  );
}

// Asset List Item Component
function AssetListItem({
  item,
  orgId,
  isSelected,
  canEdit,
  isCover,
  isPinned,
  onSelect,
  onRemove,
  onSetCover,
  onPin,
}: {
  item: MediaWorkspaceItem;
  orgId: string;
  isSelected: boolean;
  canEdit: boolean;
  isCover?: boolean;
  isPinned?: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  onSetCover?: (mediaId: string | null) => void;
  onPin?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 hover:bg-stone/30 cursor-pointer group',
        isSelected && 'bg-bark/5'
      )}
      onClick={onSelect}
    >
      {canEdit && (
        <div className="text-archive/40 group-hover:text-archive cursor-grab">
          <GripVertical size={16} />
        </div>
      )}
      {canEdit && (
        <Checkbox
          checked={isSelected}
          onChange={() => {}}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="relative flex-shrink-0">
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt="" className="w-10 h-10 object-cover rounded" />
        ) : (
          <div className="w-10 h-10 bg-stone/50 rounded flex items-center justify-center">
            <Image size={18} className="text-archive" />
          </div>
        )}
        {isCover && (
          <div className="absolute -top-1 -right-1 px-1 py-0.5 bg-bark text-parchment text-[8px] font-medium rounded leading-none">
            Cover
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <Link
          to={`/organizations/${orgId}/media/${item.media_id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-ink hover:text-bark block truncate text-sm"
        >
          {item.filename || 'Untitled'}
        </Link>
        <div className="flex items-center gap-3 text-xs text-archive">
          {item.mime_type && <span>{item.mime_type}</span>}
          {item.file_size && <span>{formatFileSize(item.file_size)}</span>}
        </div>
      </div>
      {item.note && (
        <div className="text-xs text-archive bg-stone/30 px-2 py-1 rounded max-w-xs truncate hidden sm:block">
          {item.note}
        </div>
      )}
      {onSetCover && !isCover && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetCover(item.media_id);
          }}
          className="p-1.5 text-archive hover:text-bark rounded hover:bg-bark/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Set as cover image"
        >
          <Image size={16} />
        </button>
      )}
      {onPin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          className="p-1.5 text-archive hover:text-bark rounded hover:bg-bark/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Pin to work set"
        >
          <Pin size={16} />
        </button>
      )}
      {canEdit && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="p-1.5 text-archive hover:text-semantic-error rounded hover:bg-semantic-error/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title={isPinned ? 'Unpin from work set' : 'Remove from work set'}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
