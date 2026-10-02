import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, Search, X, ChevronDown, ChevronUp } from 'lucide-react';
import { searchEntities, getEntityRelationships, getRelationshipTypes } from '../lib/api';
import { logger } from '../lib/logger';

interface RelationshipFilterProps {
  onFilterChange: (entityKeys: string[] | null) => void;
  organizationId: string;
}

export function RelationshipFilter({ onFilterChange, organizationId }: RelationshipFilterProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<{ key: string; label: string } | null>(null);
  const [selectedRelType, setSelectedRelType] = useState<string>('');
  const [direction, setDirection] = useState<'all' | 'outgoing' | 'incoming'>('all');
  const [searchResults, setSearchResults] = useState<Array<{ entity_key: string; payload?: { label?: string } }>>([]);
  const [searching, setSearching] = useState(false);

  // Fetch relationship types
  const { data: typesData } = useQuery({
    queryKey: ['relationshipTypes', organizationId],
    queryFn: () => getRelationshipTypes(organizationId),
    enabled: !!organizationId && isExpanded,
  });

  // Fetch relationships for selected entity
  const { data: relData } = useQuery({
    queryKey: ['entityRelationships', selectedEntity?.key, organizationId, direction, selectedRelType],
    queryFn: () => getEntityRelationships(selectedEntity!.key, organizationId, {
      direction,
      relationship_type: selectedRelType || undefined,
    }),
    enabled: !!selectedEntity?.key && !!organizationId,
  });

  // Search for entities
  const handleSearch = async () => {
    if (!searchQuery.trim() || !organizationId) return;
    setSearching(true);
    try {
      const results = await searchEntities(organizationId, { query: { q: searchQuery }, limit: 8 });
      setSearchResults(results.hits.map(hit => ({ entity_key: hit.entity_key, payload: { label: hit.title } })));
    } catch (err) {
      logger.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Select an entity and apply filter
  const handleSelectEntity = (entity: { entity_key: string; payload?: { label?: string } }) => {
    const newSelection = {
      key: entity.entity_key,
      label: (entity.payload?.label as string) || entity.entity_key,
    };
    setSelectedEntity(newSelection);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Clear filter
  const handleClear = () => {
    setSelectedEntity(null);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedRelType('');
    onFilterChange(null);
  };

  // Apply filter when relationships data changes
  const handleApplyFilter = () => {
    if (!relData?.items) {
      onFilterChange(null);
      return;
    }

    // Get unique entity keys from relationships (excluding the selected entity itself)
    const relatedKeys = new Set<string>();
    relData.items.forEach(rel => {
      if (rel.source_entity_key !== selectedEntity?.key) {
        relatedKeys.add(rel.source_entity_key);
      }
      if (rel.target_entity_key !== selectedEntity?.key) {
        relatedKeys.add(rel.target_entity_key);
      }
    });

    if (relatedKeys.size === 0) {
      onFilterChange([]);  // Empty array means no results
    } else {
      onFilterChange(Array.from(relatedKeys));
    }
  };

  // Extract type names from API response, or use fallback defaults
  const relationshipTypes: string[] = typesData?.relationship_types
    ? typesData.relationship_types.map((t: { type: string; count: number }) => t.type)
    : ['relatedTo', 'hasMedia', 'partOf', 'hasPart', 'references'];
  const relatedCount = relData?.items?.length || 0;

  return (
    <div className="border border-lichen rounded-lg bg-parchment">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-stone"
      >
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-archive" />
          <span className="font-medium text-ink">Find by Relationship</span>
          {selectedEntity && (
            <span className="text-xs bg-azurite/10 text-azurite px-2 py-0.5 rounded">
              Related to: {selectedEntity.label}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-archive" />
        ) : (
          <ChevronDown className="h-4 w-4 text-archive" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-lichen">
          {/* Entity search */}
          <div className="pt-3">
            <label className="block text-sm font-medium text-ink mb-1">
              Find entities related to:
            </label>
            {selectedEntity ? (
              <div className="flex items-center gap-2 p-2 bg-stone rounded border border-lichen">
                <span className="flex-1 text-sm">{selectedEntity.label}</span>
                <span className="text-xs text-archive">{selectedEntity.key}</span>
                <button
                  onClick={handleClear}
                  className="p-1 text-archive hover:text-accessible-gray"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search for an entity..."
                    className="flex-1 px-3 py-2 border border-lichen rounded text-sm"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={searching}
                    className="px-3 py-2 bg-stone border border-lichen rounded hover:bg-lichen"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                </div>

                {/* Search results dropdown */}
                {searchResults.length > 0 && (
                  <div className="border border-lichen rounded max-h-48 overflow-y-auto">
                    {searchResults.map((entity) => (
                      <button
                        key={entity.entity_key}
                        onClick={() => handleSelectEntity(entity)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-stone border-b border-lichen last:border-b-0"
                      >
                        <span className="font-medium">{entity.payload?.label || entity.entity_key}</span>
                        <span className="text-archive text-xs ml-2">{entity.entity_key}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Relationship type filter */}
          {selectedEntity && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Relationship Type
                </label>
                <select
                  value={selectedRelType}
                  onChange={(e) => setSelectedRelType(e.target.value)}
                  className="w-full px-3 py-2 border border-lichen rounded text-sm"
                >
                  <option value="">All types</option>
                  {relationshipTypes.map((type: string) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Direction
                </label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'all' | 'outgoing' | 'incoming')}
                  className="w-full px-3 py-2 border border-lichen rounded text-sm"
                >
                  <option value="all">Both directions</option>
                  <option value="outgoing">Outgoing only</option>
                  <option value="incoming">Incoming only</option>
                </select>
              </div>
            </div>
          )}

          {/* Results summary and apply */}
          {selectedEntity && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-accessible-gray">
                {relatedCount} related entit{relatedCount === 1 ? 'y' : 'ies'} found
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleClear}
                  className="px-3 py-1.5 text-sm text-accessible-gray hover:text-ink"
                >
                  Clear
                </button>
                <button
                  onClick={handleApplyFilter}
                  disabled={relatedCount === 0}
                  className="px-3 py-1.5 text-sm bg-bark text-parchment rounded hover:bg-bark/90 disabled:opacity-50"
                >
                  Apply Filter
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
