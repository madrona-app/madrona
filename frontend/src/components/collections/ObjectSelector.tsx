import { useState, useId, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { X, Search, Package, ExternalLink } from 'lucide-react';
import { getCollectionObjects, getCollectionObject } from '../../lib/api';
import { MadronaLoader } from '../ui/MadronaLoader';

interface ObjectSelectorProps {
  organizationId: string;
  objectId: string | null;
  onChange: (objectId: string | null) => void;
  onSave?: () => void;
  isEditing?: boolean;
  label?: string;
  placeholder?: string;
}

/**
 * Component to select a single collection object.
 * Used for procedures that relate to one object (Condition Report, Valuation, Conservation, etc.)
 */
export function ObjectSelector({
  organizationId,
  objectId,
  onChange,
  onSave,
  isEditing = false,
  label = 'Linked Object',
  placeholder = 'Search objects by number or title...',
}: ObjectSelectorProps) {
  const [showSearch, setShowSearch] = useState(false);
  const labelId = useId();
  // Opening the search moves focus into it; closing it returns focus to
  // the trigger that replaced it.
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasSearching = useRef(false);
  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
    else if (wasSearching.current) triggerRef.current?.focus();
    wasSearching.current = showSearch;
  }, [showSearch]);
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch linked object details if we have an objectId
  const { data: linkedObject, isLoading: isLoadingObject } = useQuery({
    queryKey: ['collection-object', organizationId, objectId],
    queryFn: () => getCollectionObject(organizationId, objectId!),
    enabled: !!objectId,
  });

  // Search for objects
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['collection-objects-search', organizationId, searchTerm],
    queryFn: () => getCollectionObjects(organizationId, { search: searchTerm, limit: 10 }),
    enabled: showSearch && searchTerm.length >= 2,
  });

  const handleSelect = (selectedObjectId: string) => {
    onChange(selectedObjectId);
    setShowSearch(false);
    setSearchTerm('');
    onSave?.();
  };

  const handleClear = () => {
    onChange(null);
    onSave?.();
  };

  const availableObjects = searchResults?.items || [];

  // View mode - just show the linked object
  if (!isEditing) {
    if (!objectId) {
      return (
        <div>
          <span className="block text-sm font-medium text-archive mb-1">{label}</span>
          <p className="text-ink italic">No object linked</p>
        </div>
      );
    }

    if (isLoadingObject) {
      return (
        <div>
          <span className="block text-sm font-medium text-archive mb-1">{label}</span>
          <MadronaLoader variant="dots" />
        </div>
      );
    }

    return (
      <div>
        <span className="block text-sm font-medium text-archive mb-1">{label}</span>
        <div className="flex items-center gap-3 p-3 border border-lichen rounded-lg bg-parchment">
          <Package size={16} className="text-archive" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink">
              {linkedObject?.object_number || 'Unknown'}
            </div>
            <div className="text-xs text-archive truncate">
              {linkedObject?.titles?.[0]?.title || linkedObject?.object_name || 'Untitled'}
            </div>
          </div>
          <Link
            to={`/organizations/${organizationId}/collections/objects/${objectId}`}
            className="text-bark hover:text-copper-dark p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            title="View object"
            aria-label={`View object ${linkedObject?.object_number || ''}`.trim()}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div role="group" aria-labelledby={labelId}>
      <span id={labelId} className="block text-sm font-medium text-archive mb-1">{label}</span>

      {/* Currently linked object */}
      {objectId && !showSearch && (
        <div className="flex items-center gap-3 p-3 border border-lichen rounded-lg bg-parchment mb-2">
          <Package size={16} className="text-archive" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            {isLoadingObject ? (
              <MadronaLoader variant="dots" />
            ) : (
              <>
                <div className="text-sm font-medium text-ink">
                  {linkedObject?.object_number || 'Unknown'}
                </div>
                <div className="text-xs text-archive truncate">
                  {linkedObject?.titles?.[0]?.title || linkedObject?.object_name || 'Untitled'}
                </div>
              </>
            )}
          </div>
          <Link
            to={`/organizations/${organizationId}/collections/objects/${objectId}`}
            className="text-bark hover:text-copper-dark p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            title="View object"
            aria-label={`View object ${linkedObject?.object_number || ''}`.trim()}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={handleClear}
            className="text-semantic-error hover:text-semantic-error/80 p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            title="Remove object"
            aria-label={`Remove object ${linkedObject?.object_number || ''}`.trim()}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Search trigger */}
      {!showSearch && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setShowSearch(true)}
          className="flex items-center gap-2 text-sm text-bark hover:text-copper-dark"
        >
          <Search size={14} aria-hidden="true" />
          {objectId ? 'Change object' : 'Select an object'}
        </button>
      )}

      {/* Search interface */}
      {showSearch && (
        <div className="border border-lichen rounded-lg p-3 bg-parchment shadow-sm">
          <div className="flex items-center gap-2 mb-3 border border-lichen rounded-lg px-3 py-2 bg-parchment">
            <Search size={14} className="text-archive flex-shrink-0" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              aria-label={`Search objects for ${label}`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={placeholder}
              className="flex-1 text-sm border-none bg-transparent focus-visible:outline-none placeholder:text-archive"
            />
            <button
              type="button"
              onClick={() => { setShowSearch(false); setSearchTerm(''); }}
              aria-label="Close object search"
              className="text-archive hover:text-ink flex-shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          {/* Search Results */}
          <div className="max-h-48 overflow-y-auto">
            {searchTerm.length < 2 ? (
              <p className="text-xs text-archive py-2">Type at least 2 characters to search...</p>
            ) : isSearching ? (
              <p className="text-xs text-archive py-2" role="status">Searching...</p>
            ) : availableObjects.length === 0 ? (
              <p className="text-xs text-archive py-2" role="status">No objects found.</p>
            ) : (
              <ul className="space-y-1" aria-label={`${availableObjects.length} result${availableObjects.length !== 1 ? 's' : ''}`}>
                {availableObjects.map((obj) => (
                  <li key={obj.object_id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(obj.object_id)}
                    className="w-full text-left p-2 rounded border border-transparent hover:border-lichen hover:bg-stone/30 transition-colors"
                  >
                    <div className="text-sm font-medium text-ink">{obj.object_number}</div>
                    <div className="text-xs text-archive truncate">
                      {obj.title || obj.object_name || 'Untitled'}
                    </div>
                  </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
