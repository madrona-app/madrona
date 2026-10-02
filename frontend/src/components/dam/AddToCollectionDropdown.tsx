import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Plus, Loader2, X } from 'lucide-react';
import { listMediaCollections, addCollectionItem } from '../../lib/api';
import { CreateCollectionModal } from './CreateCollectionModal';
import { ModalPortal } from '../ModalPortal';

interface AddToCollectionDropdownProps {
  organizationId: string;
  mediaId: string;
  onClose?: () => void;
}

export function AddToCollectionDropdown({
  organizationId,
  mediaId,
  onClose,
}: AddToCollectionDropdownProps) {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [addingAfterCreate, setAddingAfterCreate] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: collectionsData, isLoading } = useQuery({
    queryKey: ['media-collections', organizationId],
    queryFn: () => listMediaCollections(organizationId, { limit: 100 }),
  });

  const addMutation = useMutation({
    mutationFn: (collectionId: string) => addCollectionItem(organizationId, collectionId, mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-collections', organizationId] });
      setAddingTo(null);
      onClose?.();
    },
    onError: () => {
      setAddingTo(null);
      setAddingAfterCreate(false);
    },
  });

  // Close on click outside (but not when create modal is open)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (showCreateModal) return;
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose?.();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, showCreateModal]);

  // Close on escape key (but not when create modal is open - it handles its own escape)
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (showCreateModal) return;
      if (event.key === 'Escape') {
        onClose?.();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, showCreateModal]);

  const handleAdd = (collectionId: string) => {
    setAddingTo(collectionId);
    addMutation.mutate(collectionId);
  };

  const handleCreated = (collectionId: string) => {
    // Mark that we're adding after create to prevent dropdown flash
    setAddingAfterCreate(true);
    setShowCreateModal(false);
    handleAdd(collectionId);
  };

  const collections = collectionsData?.items || [];

  // When create modal is open, render only that modal (single modal context)
  if (showCreateModal) {
    return createPortal(
      <CreateCollectionModal
        organizationId={organizationId}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleCreated}
      />,
      document.body
    );
  }

  // When adding after create, show minimal loading state (no dropdown flash)
  if (addingAfterCreate) {
    return (
      <ModalPortal>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50">
        <div className="bg-parchment rounded-lg shadow-xl p-6 flex items-center gap-3">
          <Loader2 size={20} className="animate-spin text-bark" />
          <span className="text-sm text-ink">Adding to lightbox...</span>
        </div>
      </div>
      </ModalPortal>
    );
  }

  // Render the collection picker dropdown
  return (
    <ModalPortal>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[1000]"
        onClick={() => onClose?.()}
        aria-hidden="true"
      />

      {/* Dropdown - centered modal style for reliability */}
      <div
        ref={dropdownRef}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[1001] w-80 bg-parchment border border-lichen rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Add to Lightbox</p>
          <button
            onClick={() => onClose?.()}
            className="p-1 text-archive hover:text-ink rounded transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-archive" />
            </div>
          ) : collections.length === 0 ? (
            <div className="p-4 text-center text-sm text-archive">
              No lightboxes yet. Create one below.
            </div>
          ) : (
            <div className="py-1">
              {collections.map((collection) => (
                <button
                  key={collection.collection_id}
                  onClick={() => handleAdd(collection.collection_id)}
                  disabled={addingTo === collection.collection_id}
                  className="w-full px-4 py-2 text-left hover:bg-stone/30 flex items-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {addingTo === collection.collection_id ? (
                    <Loader2 size={16} className="animate-spin text-bark" />
                  ) : (
                    <FolderPlus size={16} className="text-archive" />
                  )}
                  <span className="flex-1 truncate text-sm text-ink">{collection.name}</span>
                  <span className="text-xs text-archive">{collection.item_count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-2 border-t border-lichen">
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full px-3 py-2 text-left hover:bg-stone/30 flex items-center gap-2 rounded-sm text-sm text-ink transition-colors"
          >
            <Plus size={16} className="text-bark" />
            <span>Create New Lightbox</span>
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
