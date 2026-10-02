import { useState } from 'react';
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
          <label className="block text-sm font-medium text-archive mb-1">{label}</label>
          <p className="text-ink italic">No object linked</p>
        </div>
      );
    }

    if (isLoadingObject) {
      return (
        <div>
          <label className="block text-sm font-medium text-archive mb-1">{label}</label>
          <MadronaLoader variant="dots" />
        </div>
      );
    }

    return (
      <div>
        <label className="block text-sm font-medium text-archive mb-1">{label}</label>
        <div className="flex items-center gap-3 p-3 border border-lichen rounded-lg bg-parchment">
          <Package size={16} className="text-archive" />
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
            className="text-bark hover:text-copper-dark p-1"
            title="View object"
          >
            <ExternalLink size={14} />
          </Link>
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div>
      <label className="block text-sm font-medium text-archive mb-1">{label}</label>

      {/* Currently linked object */}
      {objectId && !showSearch && (
        <div className="flex items-center gap-3 p-3 border border-lichen rounded-lg bg-parchment mb-2">
          <Package size={16} className="text-archive" />
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
            className="text-bark hover:text-copper-dark p-1"
            title="View object"
          >
            <ExternalLink size={14} />
          </Link>
          <button
            onClick={handleClear}
            className="text-semantic-error hover:text-semantic-error/80 p-1"
            title="Remove object"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Search trigger */}
      {!showSearch && (
        <button
          onClick={() => setShowSearch(true)}
          className="flex items-center gap-2 text-sm text-bark hover:text-copper-dark"
        >
          <Search size={14} />
          {objectId ? 'Change object' : 'Select an object'}
        </button>
      )}

      {/* Search interface */}
      {showSearch && (
        <div className="border border-lichen rounded-lg p-3 bg-parchment shadow-sm">
          <div className="flex items-center gap-2 mb-3 border border-lichen rounded-lg px-3 py-2 bg-parchment">
            <Search size={14} className="text-archive flex-shrink-0" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={placeholder}
              className="flex-1 text-sm border-none bg-transparent focus-visible:outline-none placeholder:text-archive"
              autoFocus
            />
            <button
              onClick={() => { setShowSearch(false); setSearchTerm(''); }}
              className="text-archive hover:text-ink flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>

          {/* Search Results */}
          <div className="max-h-48 overflow-y-auto">
            {searchTerm.length < 2 ? (
              <p className="text-xs text-archive py-2">Type at least 2 characters to search...</p>
            ) : isSearching ? (
              <p className="text-xs text-archive py-2">Searching...</p>
            ) : availableObjects.length === 0 ? (
              <p className="text-xs text-archive py-2">No objects found.</p>
            ) : (
              <div className="space-y-1">
                {availableObjects.map((obj) => (
                  <button
                    key={obj.object_id}
                    onClick={() => handleSelect(obj.object_id)}
                    className="w-full text-left p-2 rounded border border-transparent hover:border-lichen hover:bg-stone/30 transition-colors"
                  >
                    <div className="text-sm font-medium text-ink">{obj.object_number}</div>
                    <div className="text-xs text-archive truncate">
                      {obj.title || obj.object_name || 'Untitled'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
