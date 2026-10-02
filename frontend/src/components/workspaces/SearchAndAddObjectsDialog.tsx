/**
 * SearchAndAddObjectsDialog - Search for objects and add them to a workspace
 *
 * Allows users to:
 * - Search for collection objects
 * - Select multiple objects
 * - Add them to the current workspace
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Search, Package, Check, Plus } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { cn } from '../../lib/utils';
import { searchCollections, addWorkspaceItems } from '../../lib/api';
import type { CollectionsSearchHit } from '../../lib/schemas';
import { ModalPortal } from '../ModalPortal';

interface SearchAndAddObjectsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
  existingObjectIds?: string[]; // Objects already in workspace to exclude from search
}

export default function SearchAndAddObjectsDialog({
  isOpen,
  onClose,
  workspaceId,
  workspaceName,
  existingObjectIds = [],
}: SearchAndAddObjectsDialogProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const queryClient = useQueryClient();

  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'search-add-objects-dialog',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedObjects, setSelectedObjects] = useState<Map<string, CollectionsSearchHit>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search for objects
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['collection-search', orgId, debouncedQuery],
    queryFn: () =>
      searchCollections(orgId!, {
        query: debouncedQuery ? { q: debouncedQuery } : undefined,
        limit: 20,
      }),
    enabled: !!orgId && isOpen && debouncedQuery.length > 0,
  });

  // Filter out objects already in workspace
  const filteredResults = searchResults?.hits.filter(
    (hit) => !existingObjectIds.includes(hit.object_id)
  );

  // Add to workspace mutation
  const addMutation = useMutation({
    mutationFn: () => {
      const objectIds = Array.from(selectedObjects.keys());
      return addWorkspaceItems(orgId!, workspaceId, objectIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', orgId, workspaceId] });
      setSuccess(true);
      setError(null);
      // Auto-close after success
      autoCloseRef.current = setTimeout(() => {
        handleClose();
      }, 1500);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to add objects');
    },
  });

  // Clean up auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    };
  }, []);

  const handleClose = () => {
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    setSearchQuery('');
    setDebouncedQuery('');
    setSelectedObjects(new Map());
    setError(null);
    setSuccess(false);
    onClose();
  };

  const toggleSelect = (hit: CollectionsSearchHit) => {
    const newSelected = new Map(selectedObjects);
    if (newSelected.has(hit.object_id)) {
      newSelected.delete(hit.object_id);
    } else {
      newSelected.set(hit.object_id, hit);
    }
    setSelectedObjects(newSelected);
  };

  const handleAdd = () => {
    if (selectedObjects.size > 0) {
      addMutation.mutate();
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    // debouncedQuery is updated via useEffect
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
        className="bg-parchment rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center justify-between">
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-ink">Add Objects</h2>
              <p id={descriptionId} className="text-sm text-archive">to {workspaceName}</p>
            </div>
            <button
              onClick={handleClose}
              className="p-1 text-archive hover:text-ink rounded"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {success ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-semantic-success/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check size={24} className="text-semantic-success" />
              </div>
              <p className="text-ink font-medium">
                Added {selectedObjects.size} object{selectedObjects.size !== 1 ? 's' : ''} to workspace!
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
                  {error}
                </div>
              )}

              {/* Search input */}
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-archive"
                />
                <input
                  type="text"
                  placeholder="Search by accession number, title, or keyword..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                  autoFocus
                />
              </div>

              {/* Selected objects preview */}
              {selectedObjects.size > 0 && (
                <div className="p-3 bg-bark/5 rounded-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-ink">
                      {selectedObjects.size} selected
                    </span>
                    <button
                      onClick={() => setSelectedObjects(new Map())}
                      className="text-xs text-archive hover:text-ink"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(selectedObjects.values()).map((obj) => (
                      <span
                        key={obj.object_id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-parchment border border-lichen rounded text-xs"
                      >
                        {obj.object_number || obj.title || 'Object'}
                        <button
                          onClick={() => toggleSelect(obj)}
                          className="text-archive hover:text-ink"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Search results */}
              <div className="flex-1 overflow-y-auto">
                {!debouncedQuery ? (
                  <div className="text-center py-8 text-sm text-archive">
                    Enter a search term to find objects
                  </div>
                ) : isSearching ? (
                  <div className="text-center py-8 text-sm text-archive">
                    Searching...
                  </div>
                ) : !filteredResults || filteredResults.length === 0 ? (
                  <div className="text-center py-8 text-sm text-archive">
                    No objects found matching "{debouncedQuery}"
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredResults.map((hit) => (
                      <button
                        key={hit.object_id}
                        onClick={() => toggleSelect(hit)}
                        className={cn(
                          'w-full flex items-center gap-3 p-3 border rounded-sm text-left transition-colors',
                          selectedObjects.has(hit.object_id)
                            ? 'border-bark bg-bark/5'
                            : 'border-lichen hover:border-bark/30'
                        )}
                      >
                        {/* Thumbnail */}
                        {hit.primary_image_url ? (
                          <img
                            src={hit.primary_image_url}
                            alt=""
                            className="w-12 h-12 object-cover rounded"
                          />
                        ) : (
                          <div className="w-12 h-12 bg-stone/50 rounded flex items-center justify-center">
                            <Package size={20} className="text-archive" />
                          </div>
                        )}

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-archive">{hit.object_number}</div>
                          <div className="font-medium text-ink truncate">
                            {hit.title || hit.object_name || 'Untitled'}
                          </div>
                          {hit.creators && hit.creators.length > 0 && (
                            <div className="text-sm text-archive truncate">
                              {hit.creators.map((c) => c.name).join(', ')}
                            </div>
                          )}
                        </div>

                        {/* Selection indicator */}
                        <div
                          className={cn(
                            'w-6 h-6 rounded-full border-2 flex items-center justify-center',
                            selectedObjects.has(hit.object_id)
                              ? 'border-bark bg-bark'
                              : 'border-lichen'
                          )}
                        >
                          {selectedObjects.has(hit.object_id) && (
                            <Check size={14} className="text-parchment" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-archive hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={selectedObjects.size === 0 || addMutation.isPending}
              className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Plus size={16} />
              {addMutation.isPending
                ? 'Adding...'
                : `Add ${selectedObjects.size || ''} Object${selectedObjects.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
    </ModalPortal>
  );
}
