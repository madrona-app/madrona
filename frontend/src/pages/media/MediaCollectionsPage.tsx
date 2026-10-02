/**
 * MediaCollectionsPage - List and manage Lightboxes
 *
 * Lightboxes are curated collections for sharing and publishing media.
 * Unlike Work Sets (for operations), Lightboxes are for:
 * - Sharing with external stakeholders via public links
 * - Publishing curated selections to websites/APIs
 * - Managing consent and rights clearance for external use
 */

import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderHeart,
  Grid3X3,
  List,
  Lock,
  Users,
  Globe,
  Trash2,
  Share2,
  MoreVertical,
  Image,
} from 'lucide-react';
import { listMediaCollections, deleteMediaCollection } from '../../lib/api';
import { CreateCollectionModal, ShareCollectionModal } from '../../components/dam';
import { usePermissions } from '@/hooks/usePermissions';
import type { MediaCollection } from '../../lib/schemas';

const VISIBILITY_ICONS = {
  private: Lock,
  org: Users,
  public: Globe,
};

export default function MediaCollectionsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sharingCollection, setSharingCollection] = useState<MediaCollection | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaCollection | null>(null);
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('media.edit');
  const canDelete = hasPermission('media.delete');

  const { data, isLoading, error } = useQuery({
    queryKey: ['media-collections', orgId],
    queryFn: () => listMediaCollections(orgId!, { limit: 100 }),
    enabled: !!orgId,
  });

  const deleteMutation = useMutation({
    mutationFn: (collectionId: string) => deleteMediaCollection(orgId!, collectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-collections', orgId] });
    },
  });

  const handleDelete = (collection: MediaCollection) => {
    setDeleteTarget(collection);
  };

  const handleCreated = (collectionId: string) => {
    setShowCreateModal(false);
    navigate(`/organizations/${orgId}/media/collections/${collectionId}`);
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-stone/50 rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-48 bg-stone/50 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="p-4 bg-semantic-error/10 border border-semantic-error/30 rounded text-semantic-error">
          Failed to load collections
        </div>
      </div>
    );
  }

  const collections = data?.items || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-bark/10 rounded-lg">
            <FolderHeart size={24} className="text-bark" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Lightboxes</h1>
            <p className="text-archive">
              Curate and share media selections with external stakeholders
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border rounded overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 ${viewMode === 'grid' ? 'bg-stone/50' : 'hover:bg-stone/30'}`}
            >
              <Grid3X3 size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-stone/50' : 'hover:bg-stone/30'}`}
            >
              <List size={18} />
            </button>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!canEdit}
            title={!canEdit ? "You don't have permission" : undefined}
            className={`btn btn-primary flex items-center gap-2 ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <FolderHeart size={16} />
            New Lightbox
          </button>
        </div>
      </div>

      {/* Lightboxes */}
      {collections.length === 0 ? (
        <div className="text-center py-12">
          <FolderHeart size={48} className="mx-auto text-bark mb-4" />
          <h2 className="text-xl font-semibold mb-6">No lightboxes yet.</h2>
          {canEdit && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary"
            >
              Create Lightbox
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((collection) => {
            const VisibilityIcon = VISIBILITY_ICONS[collection.visibility];
            return (
              <div
                key={collection.collection_id}
                className="card group"
              >
                {/* Cover Image */}
                <Link
                  to={`/organizations/${orgId}/media/collections/${collection.collection_id}`}
                  className="block aspect-video bg-stone/50/30 relative overflow-hidden rounded-t-lg"
                >
                  {collection.cover_url ? (
                    <img
                      src={collection.cover_url}
                      alt={collection.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Image size={48} className="text-archive/50" />
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 px-2 py-1 bg-ink/60 text-parchment text-xs rounded">
                    {collection.item_count} items
                  </div>
                </Link>

                {/* Info */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/organizations/${orgId}/media/collections/${collection.collection_id}`}
                        className="font-medium hover:underline truncate block"
                      >
                        {collection.name}
                      </Link>
                      <div className="flex items-center gap-2 text-sm text-archive mt-1">
                        <VisibilityIcon size={14} />
                        <span className="capitalize">{collection.visibility}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen(menuOpen === collection.collection_id ? null : collection.collection_id)}
                        className="p-1 hover:bg-stone/50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {menuOpen === collection.collection_id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setMenuOpen(null)}
                          />
                          <div className="absolute right-0 top-full mt-1 w-40 bg-parchment border rounded-lg shadow-lg z-20">
                            <button
                              onClick={() => {
                                if (!canEdit) return;
                                setSharingCollection(collection);
                                setMenuOpen(null);
                              }}
                              disabled={!canEdit}
                              title={!canEdit ? "You don't have permission" : undefined}
                              className={`w-full px-3 py-2 text-left hover:bg-stone/50 flex items-center gap-2 ${!canEdit ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                            >
                              <Share2 size={14} />
                              Share
                            </button>
                            {canDelete && (
                              <button
                                onClick={() => {
                                  handleDelete(collection);
                                  setMenuOpen(null);
                                }}
                                className="w-full px-3 py-2 text-left hover:bg-stone/50 flex items-center gap-2 text-semantic-error"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card divide-y">
          {collections.map((collection) => {
            const VisibilityIcon = VISIBILITY_ICONS[collection.visibility];
            return (
              <div
                key={collection.collection_id}
                className="flex items-center gap-4 p-4 hover:bg-stone/30"
              >
                <Link
                  to={`/organizations/${orgId}/media/collections/${collection.collection_id}`}
                  className="w-20 h-14 bg-stone/50/30 rounded overflow-hidden flex-shrink-0"
                >
                  {collection.cover_url ? (
                    <img
                      src={collection.cover_url}
                      alt={collection.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Image size={24} className="text-archive/50" />
                    </div>
                  )}
                </Link>

                <div className="flex-1 min-w-0">
                  <Link
                    to={`/organizations/${orgId}/media/collections/${collection.collection_id}`}
                    className="font-medium hover:underline"
                  >
                    {collection.name}
                  </Link>
                  {collection.description && (
                    <p className="text-sm text-archive truncate">
                      {collection.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-4 text-sm text-archive">
                  <span>{collection.item_count} items</span>
                  <div className="flex items-center gap-1">
                    <VisibilityIcon size={14} />
                    <span className="capitalize">{collection.visibility}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { if (canEdit) setSharingCollection(collection); }}
                    disabled={!canEdit}
                    title={!canEdit ? "You don't have permission" : undefined}
                    className={`p-2 hover:bg-stone/50 rounded ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Share2 size={16} />
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(collection)}
                      className="p-2 hover:bg-stone/50 rounded text-semantic-error"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <CreateCollectionModal
          organizationId={orgId!}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}

      {sharingCollection && (
        <ShareCollectionModal
          organizationId={orgId!}
          collection={sharingCollection}
          onClose={() => setSharingCollection(null)}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.collection_id);
        }}
        title="Delete Lightbox"
        message={`Delete lightbox "${deleteTarget?.name}"? This will remove the lightbox and any share links, but not the media files.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
