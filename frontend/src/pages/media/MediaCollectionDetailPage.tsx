import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  Edit2,
  Save,
  X,
  Share2,
  Trash2,
  Plus,
  GripVertical,
  Lock,
  Users,
  Globe,
  Image,
  Video,
  FileAudio,
  FileText,
  Box,
  FileDown,
} from 'lucide-react';
import {
  getMediaCollection,
  updateMediaCollection,
  deleteMediaCollection,
  listCollectionItems,
  removeCollectionItem,
  reorderCollectionItems,
} from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { ShareCollectionModal, RequestDownloadModal, ContactSheetGenerator } from '../../components/dam';
import { usePermissions } from '@/hooks/usePermissions';
import type { MediaCollection } from '../../lib/schemas';
import ConfirmDialog from '../../components/ConfirmDialog';

const MEDIA_TYPE_ICONS = {
  image: Image,
  video: Video,
  audio: FileAudio,
  document: FileText,
  model_3d: Box,
};

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', icon: Lock },
  { value: 'org', label: 'Organization', icon: Users },
  { value: 'public', label: 'Public', icon: Globe },
];

export default function MediaCollectionDetailPage() {
  const { orgId, collectionId } = useParams<{ orgId: string; collectionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<MediaCollection>>({});
  const [showShareModal, setShowShareModal] = useState(false);
  const [draggingItem, setDraggingItem] = useState<string | null>(null);
  const [showRemoveItemDialog, setShowRemoveItemDialog] = useState(false);
  const [itemToRemove, setItemToRemove] = useState<string | null>(null);
  const [showRequestDownloadModal, setShowRequestDownloadModal] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showContactSheet, setShowContactSheet] = useState(false);
  const { showToast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('media.edit');
  const canDelete = hasPermission('media.delete');

  // Fetch collection
  const { data: collection, isLoading, error } = useQuery({
    queryKey: ['media-collection', orgId, collectionId],
    queryFn: () => getMediaCollection(orgId!, collectionId!),
    enabled: !!orgId && !!collectionId,
  });

  // Warn before leaving with unsaved edits
  const isEditDirty = useMemo(() => {
    if (!isEditing || !collection) return false;
    return editForm.name !== collection.name
      || editForm.description !== collection.description
      || editForm.visibility !== collection.visibility;
  }, [isEditing, editForm, collection]);
  useUnsavedGuard(isEditDirty);

  // Fetch items
  const { data: itemsData } = useQuery({
    queryKey: ['collection-items', orgId, collectionId],
    queryFn: () => listCollectionItems(orgId!, collectionId!),
    enabled: !!orgId && !!collectionId,
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (updates: Partial<{ name: string; description: string; visibility: 'private' | 'org' | 'public'; cover_media_id: string; consent_clearance_required: boolean }>) =>
      updateMediaCollection(orgId!, collectionId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-collection', orgId, collectionId] });
      setIsEditing(false);
      showToast({ type: 'success', title: 'Lightbox updated' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Failed to update lightbox', message: err.message });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteMediaCollection(orgId!, collectionId!),
    onSuccess: () => {
      navigate(`/organizations/${orgId}/media/collections`);
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Failed to delete lightbox', message: err.message });
    },
  });

  // Remove item mutation
  const removeItemMutation = useMutation({
    mutationFn: (mediaId: string) => removeCollectionItem(orgId!, collectionId!, mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-items', orgId, collectionId] });
      queryClient.invalidateQueries({ queryKey: ['media-collection', orgId, collectionId] });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Failed to remove item', message: err.message });
    },
  });

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: (items: Array<{ media_id: string; sort_order: number }>) =>
      reorderCollectionItems(orgId!, collectionId!, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-items', orgId, collectionId] });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Failed to reorder items', message: err.message });
    },
  });

  const handleEdit = () => {
    setEditForm({
      name: collection?.name || '',
      description: collection?.description || '',
      visibility: collection?.visibility || 'private',
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate({
      name: editForm.name,
      description: editForm.description ?? undefined,
      visibility: editForm.visibility,
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditForm({});
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const handleRemoveItem = (mediaId: string) => {
    setItemToRemove(mediaId);
    setShowRemoveItemDialog(true);
  };

  const handleDragStart = (mediaId: string) => {
    setDraggingItem(mediaId);
  };

  const handleDragOver = (e: React.DragEvent, targetMediaId: string) => {
    e.preventDefault();
    if (!draggingItem || draggingItem === targetMediaId) return;

    // Reorder items
    const items = itemsData?.items || [];
    const dragIndex = items.findIndex((i) => i.media_id === draggingItem);
    const targetIndex = items.findIndex((i) => i.media_id === targetMediaId);

    if (dragIndex !== -1 && targetIndex !== -1) {
      const newItems = [...items];
      const [removed] = newItems.splice(dragIndex, 1);
      newItems.splice(targetIndex, 0, removed);

      // Update sort orders
      const reordered = newItems.map((item, index) => ({
        media_id: item.media_id,
        sort_order: index,
      }));

      reorderMutation.mutate(reordered);
    }
  };

  const handleDragEnd = () => {
    setDraggingItem(null);
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-stone/50 rounded w-48" />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="aspect-square bg-stone/50 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="p-4 bg-semantic-error/10 border border-semantic-error/30 rounded text-semantic-error">
          {error ? `Error: ${(error as Error).message}` : 'Lightbox not found'}
        </div>
      </div>
    );
  }

  const items = itemsData?.items || [];
  const VisibilityIcon =
    VISIBILITY_OPTIONS.find((o) => o.value === collection.visibility)?.icon || Lock;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to={`/organizations/${orgId}/media/collections`}
            className="p-2 hover:bg-stone/50 rounded"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            {isEditing ? (
              <input
                type="text"
                value={editForm.name || ''}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="input text-2xl font-bold"
                autoFocus
              />
            ) : (
              <h1 className="text-2xl font-bold">{collection.name}</h1>
            )}
            <div className="flex items-center gap-2 text-sm text-archive mt-1">
              <VisibilityIcon size={14} />
              <span className="capitalize">{collection.visibility}</span>
              <span>•</span>
              <span>{collection.item_count} items</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isEditing ? (
            <>
              {/* Request Download button - shown when items are selected or for the whole collection */}
              {items.length > 0 && (
                <>
                  <button
                    onClick={() => setShowContactSheet(!showContactSheet)}
                    className="btn btn-secondary flex items-center gap-2"
                    title="Generate PDF contact sheet"
                  >
                    <FileDown size={16} />
                    Contact Sheet
                  </button>
                  <button
                    onClick={() => setShowRequestDownloadModal(true)}
                    className="btn btn-secondary flex items-center gap-2"
                    title={selectedItems.size > 0 ? `Request download for ${selectedItems.size} selected items` : 'Request download for all items'}
                  >
                    <Download size={16} />
                    Request Download
                    {selectedItems.size > 0 && ` (${selectedItems.size})`}
                  </button>
                </>
              )}
              <button
                onClick={() => { if (canEdit) setShowShareModal(true); }}
                disabled={!canEdit}
                title={!canEdit ? "You don't have permission" : undefined}
                className={`btn btn-secondary flex items-center gap-2 ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Share2 size={16} />
                Share
              </button>
              <button
                onClick={() => { if (canEdit) handleEdit(); }}
                disabled={!canEdit}
                title={!canEdit ? "You don't have permission" : undefined}
                className={`btn btn-secondary flex items-center gap-2 ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Edit2 size={16} />
                Edit
              </button>
              {canDelete && (
                <button
                  onClick={handleDelete}
                  className="btn btn-danger flex items-center gap-2"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={handleCancel} className="btn btn-secondary flex items-center gap-2">
                <X size={16} />
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="btn btn-primary flex items-center gap-2"
              >
                <Save size={16} />
                Save
              </button>
            </>
          )}
        </div>
      </div>

      {/* Description */}
      {isEditing ? (
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={editForm.description || ''}
            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            className="input w-full"
            rows={2}
            placeholder="Lightbox description..."
          />
        </div>
      ) : collection.description ? (
        <p className="text-archive">{collection.description}</p>
      ) : null}

      {/* Visibility selector (edit mode) */}
      {isEditing && (
        <div>
          <label className="block text-sm font-medium mb-2">Visibility</label>
          <div className="flex gap-2">
            {VISIBILITY_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => setEditForm({ ...editForm, visibility: option.value as MediaCollection['visibility'] })}
                  className={`flex items-center gap-2 px-3 py-2 border rounded ${
                    editForm.visibility === option.value
                      ? 'border-bark bg-bark/5'
                      : 'hover:bg-stone/50/50'
                  }`}
                >
                  <Icon size={16} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Contact Sheet Generator */}
      {showContactSheet && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">Generate Contact Sheet</h3>
            <button onClick={() => setShowContactSheet(false)} className="text-archive hover:text-ink">
              <X size={16} />
            </button>
          </div>
          <ContactSheetGenerator
            organizationId={orgId!}
            collectionId={collectionId!}
            collectionTitle={collection.name}
          />
        </div>
      )}

      {/* Items Grid */}
      {items.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <Image size={48} className="mx-auto text-archive/50 mb-4" />
          <h2 className="text-xl font-semibold mb-2">No items yet</h2>
          <p className="text-archive mb-4">
            Add media items to this lightbox from the media library.
          </p>
          <Link
            to={`/organizations/${orgId}/media`}
            className="btn btn-primary inline-flex items-center gap-2"
          >
            <Plus size={16} />
            Browse Media Library
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((item) => {
            const media = item.media;
            const Icon =
              MEDIA_TYPE_ICONS[(media?.media_type as keyof typeof MEDIA_TYPE_ICONS) || 'image'] ||
              FileText;

            return (
              <div
                key={item.media_id}
                draggable={canEdit}
                onDragStart={canEdit ? () => handleDragStart(item.media_id) : undefined}
                onDragOver={canEdit ? (e) => handleDragOver(e, item.media_id) : undefined}
                onDragEnd={canEdit ? handleDragEnd : undefined}
                className={`group relative card overflow-hidden ${
                  draggingItem === item.media_id ? 'opacity-50' : ''
                }`}
              >
                {/* Drag Handle */}
                <div
                  className={`absolute top-2 left-2 p-1 bg-ink/50 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 ${canEdit ? 'cursor-move' : 'opacity-50 cursor-not-allowed'}`}
                  title={!canEdit ? "You don't have permission" : undefined}
                >
                  <GripVertical size={14} className="text-parchment" />
                </div>

                {/* Remove Button */}
                {canEdit && (
                  <button
                    onClick={() => handleRemoveItem(item.media_id)}
                    className="absolute top-2 right-2 p-1 bg-ink/50 rounded hover:bg-semantic-error/80 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    <X size={14} className="text-parchment" />
                  </button>
                )}

                {/* Thumbnail */}
                <Link
                  to={`/organizations/${orgId}/media/${item.media_id}`}
                  className="block aspect-square bg-stone/50/30"
                >
                  {media?.thumbnail_url ? (
                    <img
                      src={media.thumbnail_url}
                      alt={media.title || media.filename}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Icon size={32} className="text-archive/50" />
                    </div>
                  )}
                </Link>

                {/* Info */}
                <div className="p-2">
                  <Link
                    to={`/organizations/${orgId}/media/${item.media_id}`}
                    className="text-sm font-medium hover:underline truncate block"
                  >
                    {media?.title || media?.filename || 'Untitled'}
                  </Link>
                  {item.notes && (
                    <p className="text-xs text-archive truncate">{item.notes}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <ShareCollectionModal
          organizationId={orgId!}
          collection={collection}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Request Download Modal — portalled to escape sidebar stacking context */}
      {showRequestDownloadModal && createPortal(
        <RequestDownloadModal
          organizationId={orgId!}
          mediaItems={
            selectedItems.size > 0
              ? items
                  .filter((item) => selectedItems.has(item.media_id))
                  .map((item) => ({
                    media_id: item.media_id,
                    filename: item.media?.filename || 'Unknown',
                    title: item.media?.title,
                  }))
              : items.map((item) => ({
                  media_id: item.media_id,
                  filename: item.media?.filename || 'Unknown',
                  title: item.media?.title,
                }))
          }
          collectionId={collectionId}
          collectionName={collection.name}
          onClose={() => {
            setShowRequestDownloadModal(false);
            setSelectedItems(new Set());
          }}
        />,
        document.body,
      )}

      {/* Remove Item Confirm Dialog */}
      <ConfirmDialog
        isOpen={showRemoveItemDialog}
        onClose={() => {
          setShowRemoveItemDialog(false);
          setItemToRemove(null);
        }}
        onConfirm={() => {
          if (itemToRemove) {
            removeItemMutation.mutate(itemToRemove);
          }
        }}
        title="Remove Item from Lightbox"
        message={<>Are you sure you want to remove this item from <strong>{collection.name}</strong>? The media file will not be deleted.</>}
        confirmText="Remove"
        confirmStyle="danger"
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete Lightbox"
        message={`Delete lightbox "${collection?.name}"? This will remove the lightbox but not the media files.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
