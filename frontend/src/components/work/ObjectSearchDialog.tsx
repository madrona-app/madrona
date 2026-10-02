/**
 * ObjectSearchDialog - Search and select an object to set as active context
 *
 * Per specification:
 * - Provides quick object lookup for setting context
 * - Shows recent objects for faster selection
 * - Supports search by accession number or title
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Package, Clock } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useWork } from '../../contexts/WorkContext';
import { searchCollections } from '../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';

interface ObjectSearchDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when dialog should close */
  onClose: () => void;
  /** Callback when an object is selected */
  onSelect?: (object: {
    object_id: string;
    accession_number: string;
    title: string;
    thumbnail_url?: string | null;
  }) => void;
  /** Optional title override */
  title?: string;
}

export function ObjectSearchDialog({
  isOpen,
  onClose,
  onSelect,
  title = 'Select Object',
}: ObjectSearchDialogProps) {
  const { activeOrganization } = useOrganization();
  const { setActiveObject, recentItems } = useWork();
  const orgId = activeOrganization?.organization_id;

  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'object-search-dialog',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setDebouncedQuery('');
    }
  }, [isOpen]);

  // Search query
  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['object-search', orgId, debouncedQuery],
    queryFn: () => searchCollections(orgId!, {
      query: { q: debouncedQuery },
      limit: 10,
    }),
    enabled: !!orgId && debouncedQuery.length >= 2,
  });

  // Get recent objects from recent items
  const recentObjects = recentItems
    .filter(item => item.type === 'object')
    .slice(0, 5);

  const handleSelect = (object: {
    object_id: string;
    accession_number: string;
    title: string;
    thumbnail_url?: string | null;
  }) => {
    setActiveObject({
      object_id: object.object_id,
      accession_number: object.accession_number,
      title: object.title,
      thumbnail_url: object.thumbnail_url,
    });
    onSelect?.(object);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 text-archive hover:text-ink rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Search Input */}
          <div>
            <label id={descriptionId} className="block text-sm font-medium text-ink mb-1">
              Search by accession number or title
            </label>
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-archive"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by accession number or title..."
                className="w-full px-3 py-2 pl-10 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                autoComplete="off"
                autoFocus
              />
            </div>
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto">
            {/* Loading */}
            {isLoading && (
              <div className="p-4 text-center text-archive">
                <div className="animate-pulse">Searching...</div>
              </div>
            )}

            {/* Search Results */}
            {!isLoading && searchResults && searchResults.hits.length > 0 && (
              <div>
                <p className="px-2 py-1 text-xs font-medium text-archive uppercase tracking-wide">
                  Search Results
                </p>
                {searchResults.hits.map((hit) => {
                  // Get display title - title field or object_name
                  const displayTitle = hit.title || hit.object_name || 'Untitled';

                  return (
                    <button
                      key={hit.object_id}
                      onClick={() => handleSelect({
                        object_id: hit.object_id,
                        accession_number: hit.object_number || 'Unknown',
                        title: displayTitle,
                        thumbnail_url: hit.primary_image_url,
                      })}
                      className="w-full flex items-center gap-3 p-2 rounded-sm hover:bg-stone/30 transition-colors text-left"
                    >
                      {hit.primary_image_url ? (
                        <img
                          src={hit.primary_image_url}
                          alt=""
                          className="w-10 h-10 rounded-sm object-cover bg-stone"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-sm bg-stone/50 flex items-center justify-center">
                          <Package size={16} className="text-archive" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-bark">{hit.object_number || 'Unknown'}</p>
                        <p className="text-sm text-ink truncate">{displayTitle}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* No Results */}
            {!isLoading && searchResults && searchResults.hits.length === 0 && debouncedQuery.length >= 2 && (
              <div className="p-8 text-center text-archive">
                <Package size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No objects found for "{debouncedQuery}"</p>
              </div>
            )}

            {/* Recent Objects (shown when no search query) */}
            {!searchQuery && recentObjects.length > 0 && (
              <div>
                <p className="px-2 py-1 text-xs font-medium text-archive uppercase tracking-wide flex items-center gap-1">
                  <Clock size={12} />
                  Recent Objects
                </p>
                {recentObjects.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect({
                      object_id: item.id,
                      accession_number: item.label,
                      title: item.sublabel || 'Untitled',
                      thumbnail_url: null,
                    })}
                    className="w-full flex items-center gap-3 p-2 rounded-sm hover:bg-stone/30 transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-sm bg-stone/50 flex items-center justify-center">
                      <Package size={16} className="text-archive" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-bark">{item.label}</p>
                      {item.sublabel && (
                        <p className="text-sm text-ink truncate">{item.sublabel}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Empty State */}
            {!searchQuery && recentObjects.length === 0 && (
              <div className="p-8 text-center text-archive">
                <Search size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Start typing to search for objects</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <p className="text-xs text-archive flex-1">Type at least 2 characters to search</p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
