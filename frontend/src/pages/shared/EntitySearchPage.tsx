/**
 * Entity Search Page
 *
 * Full-text search for entities powered by OpenSearch with graceful
 * fallback to PostgreSQL when OpenSearch is unavailable.
 *
 * Features:
 * - Full-text search with typo tolerance
 * - Faceted filtering (entity types, datasets, creators)
 * - Search result highlighting
 * - Infinite scroll pagination
 */

import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, lazy, Suspense } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, Filter, ChevronDown, ChevronRight, Loader2, Map as MapIcon, List, X, MapPin } from 'lucide-react';
import { getDatasets } from '../../lib/api';
import type { SearchHit, Facet, SearchFilters } from '../../lib/api';
import { useOrganization } from '../../contexts/useOrganization';
import { useSearch } from '../../hooks/useSearch';
import useGeo from '../../hooks/useGeo';
import AdvancedSearchBuilder from '../../components/AdvancedSearchBuilder';
import { RelationshipFilter } from '../../components/RelationshipFilter';
import { logger } from '../../lib/logger';
import { sanitizeHighlight } from '../../lib/sanitize';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatNumber } from '@/lib/formatters';


// Lazy load MapSearch for code splitting
const MapSearch = lazy(() => import('../../components/maps/MapSearch'));

export default function EntitySearchPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const navigate = useNavigate();

  const [showFilters, setShowFilters] = useState(true);
  const [relationshipFilterKeys, setRelationshipFilterKeys] = useState<string[] | null>(null);
  const [searchMode, setSearchMode] = useState<'text' | 'map'>('text');
  const [mapSearchResults, setMapSearchResults] = useState<{
    objects: Array<{
      object_id: string;
      object_number: string;
      title: string;
      place_role: string;
      place_name: string;
    }>;
    total: number;
  } | null>(null);
  const [isMapSearching, setIsMapSearching] = useState(false);

  // Geo hook for map search
  const { searchObjectsInPolygon } = useGeo();

  // Fetch datasets for name lookups
  const { data: datasets } = useQuery({
    queryKey: ['datasets', organizationId],
    queryFn: () => getDatasets(organizationId!),
    enabled: !!organizationId,
  });

  const datasetMap = useMemo(
    () => new globalThis.Map(datasets?.map((d) => [d.dataset_id, d] as const) ?? []),
    [datasets]
  );

  // Use OpenSearch-powered search
  const {
    query,
    setQuery,
    filters,
    toggleFilterValue,
    clearFilters,
    results,
    facets,
    total,
    tookMs,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    advancedCriteria,
    advancedOperator,
    updateAdvancedSearch,
  } = useSearch();

  const hasAdvancedCriteria = advancedCriteria.some((c) => c.value.trim().length > 0);
  const hasRelationshipFilter = relationshipFilterKeys !== null;
  const isTextSearchMode = query.trim().length > 0 || Object.keys(filters).length > 0 || hasAdvancedCriteria || hasRelationshipFilter;
  const isSearchMode = isTextSearchMode || mapSearchResults !== null;
  const activeFilterCount = Object.keys(filters).length + (hasRelationshipFilter ? 1 : 0);

  // Handle map polygon search
  const handleMapSearch = async (polygon: [number, number][]) => {
    setIsMapSearching(true);
    try {
      const result = await searchObjectsInPolygon.mutateAsync({
        polygon,
        placeRoles: ['creation_place', 'discovery_place', 'provenance_place'],
      });
      setMapSearchResults({
        objects: result.objects,
        total: result.count,
      });
    } catch (error) {
      logger.error('Map search failed:', error);
      setMapSearchResults({ objects: [], total: 0 });
    } finally {
      setIsMapSearching(false);
    }
  };

  // Clear map search results
  const clearMapSearch = () => {
    setMapSearchResults(null);
  };

  // Filter results by relationship keys if active
  const filteredResults = useMemo(() => {
    if (!hasRelationshipFilter) return results;
    if (relationshipFilterKeys.length === 0) return [];
    const keySet = new Set(relationshipFilterKeys);
    return results.filter(hit => keySet.has(hit.entity_key));
  }, [results, relationshipFilterKeys, hasRelationshipFilter]);

  // Get dataset name by ID
  const getDatasetName = (datasetId: string | undefined): string | null => {
    if (!datasetId) return null;
    const dataset = datasetMap.get(datasetId);
    return dataset?.name ?? null;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Entity Search</h1>
          <p className="text-sm text-archive mt-1">
            Search entities across all datasets in this organization
          </p>
        </div>
        {/* Search mode toggle */}
        <div className="flex items-center gap-1 p-1 bg-stone rounded-lg">
          <button
            onClick={() => setSearchMode('text')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              searchMode === 'text'
                ? 'bg-parchment text-ink shadow-sm'
                : 'text-archive hover:text-ink'
            }`}
          >
            <List className="w-4 h-4" />
            Text Search
          </button>
          <button
            onClick={() => setSearchMode('map')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              searchMode === 'map'
                ? 'bg-parchment text-ink shadow-sm'
                : 'text-archive hover:text-ink'
            }`}
          >
            <MapIcon className="w-4 h-4" />
            Map Search
          </button>
        </div>
      </div>

      {/* Search Box - Text Mode */}
      {searchMode === 'text' && (
        <div className="bg-parchment p-6 rounded-lg shadow">
          <div>
            <label htmlFor="entity-search" className="block text-sm font-medium text-ink mb-2">Search</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-archive" />
              </div>
              <input
                id="entity-search"
                type="text"
                placeholder="Search by title, description, identifier, artist..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-lichen rounded-lg text-lg focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-stone-500"
                aria-label="Search entities"
              />
            </div>

            {/* Results summary */}
            <div className="mt-3 flex items-center justify-between text-sm text-archive">
              <span>
                {isLoading && !results.length
                  ? 'Searching...'
                  : isTextSearchMode
                  ? hasRelationshipFilter
                    ? `${formatNumber(filteredResults.length)} related entities${total > 0 ? ` (of ${formatNumber(total)} searched)` : ''}`
                    : `${formatNumber(total)} results${tookMs ? ` (${tookMs}ms)` : ''}`
                  : 'Enter a search term to find entities'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-2 text-stone-600 hover:text-stone-800"
                >
                  <Filter className="w-4 h-4" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="bg-stone-600 text-parchment text-xs px-2 py-0.5 rounded-full">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Advanced Search Builder */}
          <div className="mt-4">
            <AdvancedSearchBuilder
              criteria={advancedCriteria}
              operator={advancedOperator}
              onChange={updateAdvancedSearch}
            />
          </div>

          {/* Relationship Filter */}
          {organizationId && (
            <div className="mt-4">
              <RelationshipFilter
                organizationId={organizationId}
                onFilterChange={setRelationshipFilterKeys}
              />
            </div>
          )}
        </div>
      )}

      {/* Search Box - Map Mode */}
      {searchMode === 'map' && (
        <div className="bg-parchment rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-lichen flex items-center justify-between">
            <div>
              <h2 className="font-medium text-ink">Geographic Search</h2>
              <p className="text-sm text-archive mt-0.5">
                Draw a rectangle on the map to find objects from that region
              </p>
            </div>
            {mapSearchResults && (
              <button
                onClick={clearMapSearch}
                className="flex items-center gap-1 text-sm text-archive hover:text-ink"
              >
                <X className="w-4 h-4" />
                Clear results
              </button>
            )}
          </div>
          <Suspense fallback={
            <div className="h-[500px] flex items-center justify-center bg-stone">
              <MadronaLoader />
            </div>
          }>
            <MapSearch
              onSearch={handleMapSearch}
              placeRoles={['creation_place', 'discovery_place', 'provenance_place']}
              height={500}
            />
          </Suspense>
          {isMapSearching && (
            <div className="p-4 border-t border-lichen flex items-center gap-2 text-archive">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching for objects in selected area...
            </div>
          )}
          {mapSearchResults && !isMapSearching && (
            <div className="p-4 border-t border-lichen">
              <p className="text-sm text-archive">
                Found <strong>{mapSearchResults.total}</strong> object{mapSearchResults.total !== 1 ? 's' : ''} in selected area
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          <p className="font-medium">Search error</p>
          <p className="text-sm mt-1">{error.message}</p>
        </div>
      )}

      {/* Empty state when no search */}
      {!isSearchMode && searchMode === 'text' && (
        <div className="bg-parchment p-12 rounded-lg shadow text-center">
          <Search className="h-12 w-12 text-archive mx-auto mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">Search for entities</h3>
          <p className="text-sm text-archive">
            Enter a search term to find entities across all datasets and source systems
          </p>
        </div>
      )}

      {/* Map search results */}
      {searchMode === 'map' && mapSearchResults && mapSearchResults.objects.length > 0 && (
        <div className="bg-parchment rounded-lg shadow">
          <div className="p-4 border-b border-lichen">
            <h2 className="font-semibold text-ink">Objects in Selected Area</h2>
          </div>
          <div className="divide-y divide-lichen max-h-[400px] overflow-y-auto">
            {mapSearchResults.objects.map((obj) => (
              <div
                key={obj.object_id}
                onClick={() =>
                  navigate(
                    `/organizations/${organizationId}/collections/objects/${obj.object_id}`
                  )
                }
                className="p-4 hover:bg-stone cursor-pointer transition-colors"
              >
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-archive flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ink">{obj.title || 'Untitled'}</div>
                    <div className="text-sm text-archive">{obj.object_number}</div>
                    <div className="text-sm text-archive mt-1">
                      <span className="capitalize">{obj.place_role.replace('_', ' ')}</span>: {obj.place_name}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {searchMode === 'map' && mapSearchResults && mapSearchResults.objects.length === 0 && !isMapSearching && (
        <div className="bg-parchment p-8 rounded-lg shadow text-center">
          <MapPin className="h-12 w-12 text-archive mx-auto mb-3" />
          <h3 className="text-lg font-medium text-ink mb-2">No objects found</h3>
          <p className="text-sm text-archive">
            No objects with place information found in the selected area.
            Try drawing a larger region.
          </p>
        </div>
      )}

      {/* Results with Facets - Text Search Mode */}
      {isTextSearchMode && searchMode === 'text' && (
        <div className="flex gap-6">
          {/* Facets Sidebar */}
          {showFilters && facets && facets.length > 0 && (
            <div className="w-64 flex-shrink-0">
              <div className="bg-parchment rounded-lg border border-lichen p-4 sticky top-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-ink">Filters</h2>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={clearFilters}
                      className="text-sm text-stone-600 hover:text-stone-800"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {facets.map((facet) => (
                  <FacetSection
                    key={facet.field}
                    facet={facet}
                    selectedValues={getFacetFilterValues(facet.field, filters)}
                    onToggle={(value) => toggleFacetFilter(facet.field, value, toggleFilterValue)}
                    datasetMap={datasetMap}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          <div className="flex-1">
            {isLoading && !filteredResults.length ? (
              <div className="flex items-center justify-center py-12">
                <MadronaLoader />
              </div>
            ) : filteredResults.length === 0 ? (
              <div className="bg-parchment rounded-lg border border-lichen p-8 text-center">
                <Search className="h-12 w-12 text-archive mx-auto mb-3" />
                <p className="text-archive mb-2">No results found</p>
                <p className="text-sm text-archive">
                  {hasRelationshipFilter
                    ? 'No entities match your relationship filter'
                    : 'Try adjusting your search or filters'}
                </p>
              </div>
            ) : (
              <>
                {/* Results List */}
                <div className="space-y-3">
                  {filteredResults.map((hit) => (
                    <SearchResultCard
                      key={hit.entity_key}
                      hit={hit}
                      datasetName={getDatasetName(hit.dataset_id)}
                      onClick={() =>
                        navigate(
                          `/organizations/${organizationId}/bridge/entities/${encodeURIComponent(
                            hit.entity_key
                          )}`
                        )
                      }
                    />
                  ))}
                </div>

                {/* Load More - hide when relationship filter is active */}
                {hasNextPage && !hasRelationshipFilter && (
                  <div className="mt-6 text-center">
                    <button
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      className="px-6 py-2 bg-stone-600 text-parchment rounded-lg hover:bg-stone-700 disabled:opacity-50"
                    >
                      {isFetchingNextPage ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading...
                        </span>
                      ) : (
                        'Load more'
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// Facet filter helpers
function getFacetFilterValues(
  field: string,
  filters: SearchFilters
): string[] | undefined {
  // Map facet field names to filter values
  switch (field) {
    case 'Entity Types':
      return filters.entity_type;
    case 'Datasets':
      return filters.dataset_id;
    case 'Creators':
      // creator_name is a single string value, wrap in array for checkbox state
      return filters.creator_name ? [filters.creator_name] : undefined;
    case 'Date Range':
      // Return the year start date to match bucket keys
      return filters.date_from ? [filters.date_from] : undefined;
    default:
      return undefined;
  }
}

function toggleFacetFilter(
  field: string,
  value: string,
  toggle: (key: 'dataset_id' | 'entity_type' | 'creator_name' | 'date_range', value: string) => void
) {
  // Map facet field names to filter keys
  if (field === 'Entity Types') {
    toggle('entity_type', value);
  } else if (field === 'Datasets') {
    toggle('dataset_id', value);
  } else if (field === 'Creators') {
    toggle('creator_name', value);
  } else if (field === 'Date Range') {
    toggle('date_range', value);
  }
}

// Facet Section Component
function FacetSection({
  facet,
  selectedValues,
  onToggle,
  datasetMap,
}: {
  facet: Facet;
  selectedValues?: string[];
  onToggle: (value: string) => void;
  datasetMap: Map<string, { dataset_id: string; name: string }>;
}) {
  const [expanded, setExpanded] = useState(true);

  // Get display label for a facet value
  const getLabel = (bucket: { key: string; label?: string }) => {
    if (bucket.label) return bucket.label;

    // For datasets, look up the name
    if (facet.field === 'Datasets') {
      const dataset = datasetMap.get(bucket.key);
      return dataset?.name || bucket.key;
    }

    // For entity types, capitalize
    if (facet.field === 'Entity Types') {
      return bucket.key.charAt(0).toUpperCase() + bucket.key.slice(1);
    }

    return bucket.key;
  };

  // Only show toggle for supported facet types
  const isToggleable = facet.field === 'Entity Types' || facet.field === 'Datasets' || facet.field === 'Creators' || facet.field === 'Date Range';

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-sm font-medium text-ink mb-2"
      >
        {facet.field}
        {expanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>

      {expanded && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {facet.buckets.slice(0, 10).map((bucket) => (
            <label
              key={bucket.key}
              className={`flex items-center gap-2 text-sm p-1 rounded ${
                isToggleable ? 'cursor-pointer hover:bg-stone' : ''
              }`}
            >
              {isToggleable && (
                <Checkbox
                  checked={selectedValues?.includes(bucket.key) || false}
                  onChange={() => onToggle(bucket.key)}
                  aria-label={`Filter by ${getLabel(bucket)}`}
                />
              )}
              <span className="flex-1 truncate">{getLabel(bucket)}</span>
              <span className="text-archive text-xs">{bucket.doc_count}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Search Result Card Component
function SearchResultCard({
  hit,
  datasetName,
  onClick,
}: {
  hit: SearchHit;
  datasetName: string | null;
  onClick: () => void;
}) {
  const highlightedTitle = hit.highlights?.title?.[0]
    ? sanitizeHighlight(hit.highlights.title[0])
    : null;
  const highlightedDescription = hit.highlights?.description?.[0]
    ? sanitizeHighlight(hit.highlights.description[0])
    : null;

  return (
    <div
      onClick={onClick}
      className="bg-parchment rounded-lg border border-lichen p-4 hover:border-stone-400 cursor-pointer transition-colors"
    >
      <div className="flex gap-4">
        {/* Thumbnail */}
        {hit.thumbnail_url && (
          <img
            src={hit.thumbnail_url}
            alt=""
            className="w-20 h-20 object-cover rounded flex-shrink-0"
          />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title with highlight */}
          {highlightedTitle ? (
            <h3
              className="font-medium text-ink mb-1 line-clamp-1"
              ref={(el) => { if (el) el.innerHTML = highlightedTitle; }}
            />
          ) : (
            <h3 className="font-medium text-ink mb-1 line-clamp-1">
              {hit.title || 'Untitled'}
            </h3>
          )}

          {/* Object number */}
          {hit.object_number && (
            <p className="text-sm text-archive mb-1">{hit.object_number}</p>
          )}

          {/* Creators */}
          {hit.creators && hit.creators.length > 0 && (
            <p className="text-sm text-archive mb-1">
              {hit.creators.map((c) => c.name).join(', ')}
            </p>
          )}

          {/* Description with highlight */}
          {highlightedDescription ? (
            <p
              className="text-sm text-archive line-clamp-2"
              ref={(el) => { if (el) el.innerHTML = highlightedDescription; }}
            />
          ) : hit.description ? (
            <p className="text-sm text-archive line-clamp-2">
              {hit.description}
            </p>
          ) : null}

          {/* Metadata row */}
          <div className="flex items-center gap-3 mt-2">
            {hit.entity_type && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-stone text-ink">
                {hit.entity_type}
              </span>
            )}
            {datasetName && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-stone-100 text-stone-700">
                {datasetName}
              </span>
            )}
            {hit.dates?.created_display && (
              <span className="text-xs text-archive">{hit.dates.created_display}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
