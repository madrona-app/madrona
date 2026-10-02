import { useState, useCallback, useMemo, lazy, Suspense, type MouseEvent, type ReactNode } from 'react';
import Checkbox from '../../components/Checkbox';
import { useListState } from '../../hooks/useListState';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { setDragPayload, clearDragPayload } from '../../lib/dragTypes';
import {
  Search,
  Plus,
  Filter,
  Grid,
  List,
  ChevronDown,
  X,
  Package,
  MapPin,
  Users,
  ArrowRightLeft,
  FileText,
  Image as ImageIcon,
  Scale,
  CheckCircle2,
  Edit,
  Sparkles,
  Layers,
  Zap,
  ExternalLink,
  BookOpen,
  Map,
  Globe,
  Globe2,
} from 'lucide-react';
import { searchCollections, getActiveContext } from '../../lib/api';
import { LocationPickerButton } from '../../components/collections/LocationPickerModal';
import { useGeo } from '../../hooks/useGeo';

// Lazy load map components
const MapSearch = lazy(() => import('../../components/maps/MapSearch'));
const CollectionOriginMap = lazy(() => import('../../components/maps/CollectionOriginMap'));
import type {
  CollectionsSearchRequest,
  CollectionsSearchHit,
  CollectionsSearchFilters,
  Facet,
} from '../../lib/schemas';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { cn, getObjectTypeColor } from '../../lib/utils';
import { AddToWorkspaceDialog, BulkActionDialog, SaveSearchAsWorkSetDialog } from '../../components/workspaces';
import { logger } from '../../lib/logger';
import { sanitizeHighlight } from '../../lib/sanitize';
import { formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const SCROLL_KEY = 'collection-objects-scroll';

type ViewMode = 'grid' | 'list';
type SearchMode = 'text' | 'map' | 'origins';

export default function CollectionObjectsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const { hasAppAccess } = useAuth();
  const hasDiscoverApp = hasAppAccess('discover');
  const { searchObjectsInPolygon } = useGeo();

  const limit = 24;

  // Search state
  const {
    searchQuery, debouncedQuery, offset,
    setSearchQuery, setOffset,
  } = useListState({ limit });
  const [filters, setFilters] = useState<CollectionsSearchFilters>({});
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showFilters, setShowFilters] = useState(false);
  const [workspaceDialogObject, setWorkspaceDialogObject] = useState<{ id: string; label: string } | null>(null);
  const [showBulkActionDialog, setShowBulkActionDialog] = useState(false);
  const [showSaveAsWorkSetDialog, setShowSaveAsWorkSetDialog] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('text');
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

  // Build search request
  const searchRequest: CollectionsSearchRequest = {
    query: debouncedQuery ? { q: debouncedQuery } : undefined,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    limit,
    offset,
    include_facets: true,
    highlight: true,
  };

  // OpenSearch handles all listing — faster than DB and supports facets/relevance
  const {
    data: effectiveResults,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['collections-search', orgId, searchRequest],
    queryFn: () => searchCollections(orgId!, searchRequest),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  // Only show skeleton on initial load (no data yet)
  const showSkeleton = isLoading && !effectiveResults;

  // Fetch active context to show workspace info
  const { data: activeContextData } = useQuery({
    queryKey: ['active-context', orgId],
    queryFn: () => getActiveContext(orgId!),
    enabled: !!orgId,
    refetchInterval: 30000,
  });

  const activeWorkspace = activeContextData?.context?.type === 'workspace' ? activeContextData.context.workspace : null;

  const handleFilterChange = useCallback(<K extends keyof CollectionsSearchFilters>(
    key: K,
    value: CollectionsSearchFilters[K] | undefined
  ) => {
    setFilters(prev => {
      const next = { ...prev };
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
    setOffset(0);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearchQuery('');
    setOffset(0);
  }, [setSearchQuery, setOffset]);

  const handleObjectClick = (objectId: string) => {
    navigate(`/organizations/${orgId}/collections/objects/${objectId}`);
  };

  const activeFilterCount = Object.keys(filters).length;

  // Get facets for filters
  const facetsByField = useMemo(() => {
    const map: Record<string, Facet> = {};
    effectiveResults?.facets?.forEach(facet => {
      map[facet.field] = facet;
    });
    return map;
  }, [effectiveResults?.facets]);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <BookOpen size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Cataloging</h1>
              <p className="text-sm text-archive mt-0.5">
                {effectiveResults?.total !== undefined ? (
                  effectiveResults.total === 0 ? (
                    <span>No objects yet</span>
                  ) : effectiveResults.total === 1 ? (
                    <span>1 object in your collection</span>
                  ) : (
                    <span>{formatNumber(effectiveResults.total)} objects in your collection</span>
                  )
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/objects/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              New Object
            </Link>
          ) : (
            <span
              className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start"
              title="Requires collections.create permission"
            >
              <Plus size={18} />
              Create Object
            </span>
          )}
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Creates and maintains authoritative descriptive information about collection objects. Includes identification, classification, descriptions, measurements, and contextual data used for discovery, research, and management.
        </p>
      </div>

      {/* Active Workspace Context */}
      {activeWorkspace && activeWorkspace.object_count > 0 && (
        <div className="mb-6 p-4 bg-bark/5 border border-bark/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-bark/10 rounded-lg">
                <Layers size={20} className="text-bark" />
              </div>
              <div>
                <div className="text-xs text-archive mb-0.5">Active Workspace</div>
                <div className="font-medium text-ink">{activeWorkspace.name}</div>
                <div className="text-sm text-archive">
                  {activeWorkspace.object_count} objects ready for bulk actions
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/organizations/${orgId}/collections/work/workspaces/${activeWorkspace.workspace_id}`}
                className="btn btn-secondary text-sm py-1.5 flex items-center gap-1.5 no-underline"
              >
                <ExternalLink size={14} />
                View Workspace
              </Link>
              <button
                onClick={() => setShowBulkActionDialog(true)}
                className="btn btn-primary text-sm py-1.5 flex items-center gap-1.5"
              >
                <Zap size={14} />
                Quick Actions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar - Hero Element */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        {/* Search Mode Toggle */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-archive">Search by:</span>
          <div className="flex border border-lichen rounded-lg overflow-hidden">
            <button
              onClick={() => setSearchMode('text')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors',
                searchMode === 'text'
                  ? 'bg-azurite text-parchment'
                  : 'bg-parchment text-ink hover:bg-stone'
              )}
            >
              <Search size={14} />
              Text
            </button>
            <button
              onClick={() => setSearchMode('map')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors',
                searchMode === 'map'
                  ? 'bg-azurite text-parchment'
                  : 'bg-parchment text-ink hover:bg-stone'
              )}
            >
              <Map size={14} />
              Map
            </button>
            <button
              onClick={() => setSearchMode('origins')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors',
                searchMode === 'origins'
                  ? 'bg-azurite text-parchment'
                  : 'bg-parchment text-ink hover:bg-stone'
              )}
            >
              <Globe size={14} />
              Origins
            </button>
          </div>
        </div>

        {searchMode === 'text' ? (
        <>
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          {/* Search Input - Larger, more prominent */}
          <div className="relative flex-1 w-full">
            <Search
              size={20}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-archive"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, artist, object number, description..."
              className="input w-full pl-12 pr-4 py-3 text-lg"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-archive hover:text-ink"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="flex gap-3">
            {/* Filter Toggle - Compact */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-3 border rounded-institutional transition-all
                         ${showFilters || activeFilterCount > 0
                           ? 'border-bark text-bark bg-bark/5'
                           : 'border-lichen text-ink hover:bg-stone hover:border-archive'
                         }`}
            >
              <Filter size={18} />
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="bg-bark text-parchment text-xs px-2 py-0.5 rounded-full font-medium">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                size={16}
                className={`transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Save as Work Set - visible when search or filters are active */}
            {(debouncedQuery || activeFilterCount > 0) && (
              <button
                onClick={() => setShowSaveAsWorkSetDialog(true)}
                className="flex items-center gap-2 px-4 py-3 border border-lichen text-ink rounded-institutional hover:border-bark hover:text-bark transition-all"
                title="Save this search as a dynamic Work Set"
              >
                <Layers size={18} />
                <span className="hidden sm:inline">Save as Work Set</span>
              </button>
            )}

            {/* View Mode Toggle */}
            <div className="flex border border-lichen rounded-institutional overflow-hidden" role="group" aria-label="View mode">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-3 transition-colors ${viewMode === 'grid'
                  ? 'bg-azurite text-parchment ring-2 ring-inset ring-azurite/50'
                  : 'text-archive hover:bg-stone hover:text-ink'
                }`}
                title="Gallery view"
                aria-pressed={viewMode === 'grid'}
              >
                <Grid size={18} aria-hidden="true" />
                <span className="sr-only">Gallery view</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-3 transition-colors ${viewMode === 'list'
                  ? 'bg-azurite text-parchment ring-2 ring-inset ring-azurite/50'
                  : 'text-archive hover:bg-stone hover:text-ink'
                }`}
                title="List view"
                aria-pressed={viewMode === 'list'}
              >
                <List size={18} aria-hidden="true" />
                <span className="sr-only">List view</span>
              </button>
            </div>
          </div>
        </div>

        {/* Collapsible Filter Panel with smooth animation */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out
                        ${showFilters ? 'max-h-[500px] opacity-100 mt-6 pt-6 border-t border-lichen' : 'max-h-0 opacity-0'}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Object Type Filter */}
              <FacetFilter
                label="Object Type"
                facet={facetsByField['object_type']}
                value={filters.object_type ?? undefined}
                onChange={(value) => handleFilterChange('object_type', value)}
              />

              {/* Classification Filter */}
              <FacetFilter
                label="Classification"
                facet={facetsByField['classification']}
                value={filters.classification ?? undefined}
                onChange={(value) => handleFilterChange('classification', value)}
              />

              {/* Status Filter */}
              <FacetFilter
                label="Status"
                facet={facetsByField['object_status']}
                value={filters.object_status ?? undefined}
                onChange={(value) => handleFilterChange('object_status', value)}
              />

              {/* Location Filter */}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Location
                </label>
                <LocationPickerButton
                  organizationId={orgId!}
                  value={filters.location_id?.[0] || null}
                  onChange={(locationId) => handleFilterChange('location_id', locationId ? [locationId] : undefined)}
                  placeholder="All Locations"
                />
              </div>

              {/* On Display Filter */}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Display Status
                </label>
                <select
                  value={filters.on_display == null ? '' : filters.on_display.toString()}
                  onChange={(e) => handleFilterChange('on_display', e.target.value === '' ? undefined : e.target.value === 'true')}
                  className="input w-full"
                >
                  <option value="">All</option>
                  <option value="true">On Display</option>
                  <option value="false">In Storage</option>
                </select>
              </div>

              {/* Creator Filter */}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Creator
                </label>
                <input
                  type="text"
                  value={filters.creator_name || ''}
                  onChange={(e) => handleFilterChange('creator_name', e.target.value || undefined)}
                  placeholder="Filter by creator name"
                  className="input w-full"
                />
              </div>

              {/* Material Filter */}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Material
                </label>
                <input
                  type="text"
                  value={filters.material || ''}
                  onChange={(e) => handleFilterChange('material', e.target.value || undefined)}
                  placeholder="Filter by material"
                  className="input w-full"
                />
              </div>

              {/* Date Range */}
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  Date Range
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={filters.date_from || ''}
                    onChange={(e) => handleFilterChange('date_from', e.target.value || undefined)}
                    placeholder="From"
                    className="input w-1/2 text-sm"
                  />
                  <input
                    type="text"
                    value={filters.date_to || ''}
                    onChange={(e) => handleFilterChange('date_to', e.target.value || undefined)}
                    placeholder="To"
                    className="input w-1/2 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Discoverable filter — one of the few relationship filters
                with actual backend/OpenSearch support. The rest (has_active_loan,
                has_conservation, missing_location, etc.) were never wired into
                the search index or query builder. They'll come back when the
                transformer is extended to index relationship state. */}
            {hasDiscoverApp && (
              <div className="mt-4 pt-4 border-t border-lichen">
                <div className="flex flex-wrap gap-2">
                  <RelationshipFilterChip
                    label="Discoverable"
                    isActive={filters.is_discoverable === true}
                    onChange={(value) => handleFilterChange('is_discoverable', value ? true : undefined)}
                    icon={<Globe2 size={14} />}
                  />
                </div>
              </div>
            )}

            {activeFilterCount > 0 && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={clearFilters}
                  className="text-sm text-bark hover:text-copper-dark hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            )}
        </div>
        </>
        ) : searchMode === 'map' ? (
          /* Map Search Mode */
          <div className="flex flex-col">
            <p className="text-sm text-archive mb-4">
              Draw a rectangle or polygon on the map to find all objects with creation, discovery, or provenance places within that area.
            </p>
            <Suspense fallback={
              <div className="h-[500px] bg-stone rounded-lg flex items-center justify-center">
                <div className="text-archive">Loading map...</div>
              </div>
            }>
              <MapSearch
                height={500}
                onSearch={async (polygon) => {
                  setIsMapSearching(true);
                  setMapSearchResults(null);
                  try {
                    const results = await searchObjectsInPolygon.mutateAsync({
                      polygon,
                      placeRoles: ['creation_place', 'discovery_place', 'provenance_place'],
                    });
                    setMapSearchResults({
                      objects: results.objects || [],
                      total: results.count || results.objects?.length || 0,
                    });
                  } catch (error) {
                    logger.error('Map search error:', error);
                    setMapSearchResults({ objects: [], total: 0 });
                  } finally {
                    setIsMapSearching(false);
                  }
                }}
                placeRoles={['creation_place', 'discovery_place', 'provenance_place']}
              />
            </Suspense>
            <p className="text-xs text-archive mt-3">
              Tip: Use the polygon tool to draw a custom shape, or the rectangle tool for quick area selection.
            </p>

            {/* Map Search Results */}
            {isMapSearching && (
              <div className="mt-4 p-4 bg-stone/50 rounded-lg text-center">
                <div className="text-sm text-archive">Searching objects in selected area...</div>
              </div>
            )}
            {mapSearchResults && !isMapSearching && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-ink">
                    {mapSearchResults.total === 0
                      ? 'No objects found in selected area'
                      : `Found ${mapSearchResults.total} object${mapSearchResults.total !== 1 ? 's' : ''} in selected area`}
                  </h3>
                  {mapSearchResults.total > 0 && (
                    <button
                      onClick={() => setMapSearchResults(null)}
                      className="text-xs text-archive hover:text-ink"
                    >
                      Clear results
                    </button>
                  )}
                </div>
                {mapSearchResults.objects.length > 0 && (
                  <div className="bg-parchment border border-lichen rounded-lg divide-y divide-lichen max-h-[300px] overflow-y-auto">
                    {mapSearchResults.objects.map((obj) => (
                      <div
                        key={obj.object_id}
                        className="p-3 hover:bg-stone/30 cursor-pointer flex items-center justify-between"
                        onClick={() => navigate(`/organizations/${orgId}/collections/objects/${obj.object_id}`)}
                      >
                        <div>
                          <div className="text-sm font-medium text-ink">{obj.title || 'Untitled'}</div>
                          <div className="text-xs text-archive">
                            {obj.object_number} • {obj.place_name} ({obj.place_role.replace('_', ' ')})
                          </div>
                        </div>
                        <ChevronDown size={16} className="text-archive -rotate-90" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : searchMode === 'origins' ? (
          /* Collection Origins Map Mode */
          <div className="flex flex-col">
            <p className="text-sm text-archive mb-4">
              Explore where objects in your collection originated from. Click on a place to see the objects associated with it.
            </p>
            <Suspense fallback={
              <div className="h-[500px] bg-stone rounded-lg flex items-center justify-center">
                <div className="text-archive">Loading origins map...</div>
              </div>
            }>
              <CollectionOriginsMapWrapper
                organizationId={orgId!}
                onPlaceClick={(place) => {
                  // Navigate to objects filtered by this place
                  navigate(`/organizations/${orgId}/collections/objects?place=${place.place_id}`);
                }}
              />
            </Suspense>
            <p className="text-xs text-archive mt-3">
              Marker size indicates the number of objects from that location. Click markers to explore.
            </p>
          </div>
        ) : null}
      </div>

      {/* Results */}
      {error ? (
        <div className="text-center py-12 text-semantic-error">
          Error loading objects: {(error as Error).message}
        </div>
      ) : showSkeleton ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <MadronaLoader label="Loading…" />
        </div>
      ) : effectiveResults?.hits.length === 0 ? (
        <EmptyState
          searchQuery={searchQuery}
          hasFilters={activeFilterCount > 0}
          onClearFilters={clearFilters}
          onCreateNew={() => navigate(`/organizations/${orgId}/collections/objects/create`)}
          canCreate={hasPermission('collections.create')}
        />
      ) : viewMode === 'grid' ? (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
          {effectiveResults?.hits.map((hit) => (
            <ObjectCard
              key={hit.object_id}
              hit={hit as CollectionsSearchHit}
              onClick={() => handleObjectClick(hit.object_id)}
              onQuickMove={() => {
                // Navigate directly to movement creation with object pre-selected
                navigate(`/organizations/${orgId}/collections/movements/create?object_id=${hit.object_id}`);
              }}
              onAddToWorkspace={() => {
                setWorkspaceDialogObject({
                  id: hit.object_id,
                  label: hit.object_number || hit.title || 'Object',
                });
              }}
              hasDiscoverApp={hasDiscoverApp}
            />
          ))}
        </div>
      ) : (
        <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
          <table className="w-full" aria-label="Collection objects">
            <thead className="bg-stone/50">
              <tr>
                <th scope="col" className="w-12 px-4 py-3"></th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Object</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Creator</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Location</th>
                <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-ink">Relationships</th>
                <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
                <th scope="col" className="w-10 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {effectiveResults?.hits.map((hit) => (
                <ObjectRow
                  key={hit.object_id}
                  hit={hit as CollectionsSearchHit}
                  onClick={() => handleObjectClick(hit.object_id)}
                  onEdit={() => {
                    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
                    navigate(`/organizations/${orgId}/collections/objects/${hit.object_id}/edit`);
                  }}
                  onAddToWorkspace={() => {
                    setWorkspaceDialogObject({
                      id: hit.object_id,
                      label: hit.object_number || hit.title || 'Object',
                    });
                  }}
                  hasDiscoverApp={hasDiscoverApp}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {effectiveResults && effectiveResults.total > limit && (
        <nav aria-label="Pagination" className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">
            Showing {offset + 1} - {Math.min(offset + limit, effectiveResults.total)} of {effectiveResults.total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="btn btn-tertiary text-sm"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= effectiveResults.total}
              className="btn btn-tertiary text-sm"
            >
              Next
            </button>
          </div>
        </nav>
      )}

      {/* Add to Workspace Dialog */}
      <AddToWorkspaceDialog
        isOpen={!!workspaceDialogObject}
        onClose={() => setWorkspaceDialogObject(null)}
        objectIds={workspaceDialogObject ? [workspaceDialogObject.id] : []}
        objectLabel={workspaceDialogObject?.label}
      />

      {/* Bulk Action Dialog for active workspace */}
      {activeWorkspace && (
        <BulkActionDialog
          isOpen={showBulkActionDialog}
          onClose={() => {
            setShowBulkActionDialog(false);
            queryClient.invalidateQueries({ queryKey: ['active-context', orgId] });
          }}
          workspaceId={activeWorkspace.workspace_id}
          workspaceName={activeWorkspace.name}
          objectCount={activeWorkspace.object_count}
        />
      )}

      {/* Save Search as Work Set Dialog */}
      <SaveSearchAsWorkSetDialog
        isOpen={showSaveAsWorkSetDialog}
        onClose={() => setShowSaveAsWorkSetDialog(false)}
        searchQuery={debouncedQuery || undefined}
        filters={Object.keys(filters).length > 0 ? filters : undefined}
        resultCount={effectiveResults?.total}
      />
    </div>
  );
}

// Object Card Component (Grid View) - Gallery Style with Relationship Preview
function ObjectCard({
  hit,
  onClick,
  onQuickMove,
  onAddToWorkspace,
  hasDiscoverApp,
}: {
  hit: CollectionsSearchHit;
  onClick: () => void;
  onQuickMove?: () => void;
  onAddToWorkspace?: () => void;
  hasDiscoverApp?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const typeColor = getObjectTypeColor(hit.object_type);

  // Relationship preview data from search results
  const hasImage = !!hit.primary_image_url;
  // Use person_authority_count if available (from linked Person Authorities),
  // otherwise fall back to counting creators array
  const personAuthorityCount = hit.person_authority_count ?? 0;
  const creatorsCount = hit.creators?.length ?? 0;
  const associatedPeopleCount = hit.associated_people?.length ?? 0;
  const previewData = {
    // Prefer person_authority_count, fall back to creators + associated_people
    peopleCount: personAuthorityCount > 0 ? personAuthorityCount : (creatorsCount + associatedPeopleCount),
    hasLocation: !!hit.current_location,
    hasImages: hasImage || (hit.image_count ?? 0) > 0,
    hasRights: hit.has_rights ?? false,
    // These would be populated from extended search results
    activeProcedures: hit.active_procedures_count ?? 0,
  };

  // Calculate completeness for subtle indicator
  const completenessItems = [
    previewData.hasImages,
    previewData.hasLocation,
    previewData.peopleCount > 0,
    previewData.hasRights,
  ];
  const completeness = completenessItems.filter(Boolean).length;
  const isComplete = completeness === completenessItems.length;

  const handleQuickAction = (e: MouseEvent, action: () => void) => {
    e.stopPropagation();
    action();
  };

  const handleDragStart = useCallback(() => {
    setDragPayload({
      kind: 'object',
      objectId: hit.object_id,
      objectNumber: hit.object_number || '',
      title: hit.title || hit.object_name || '',
    });
  }, [hit.object_id, hit.object_number, hit.title, hit.object_name]);

  const handleDragEnd = useCallback(() => {
    clearDragPayload();
  }, []);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'card overflow-hidden text-left group transition-all duration-300 cursor-pointer',
        'hover:shadow-archival-md hover:-translate-y-1 border-l-2',
        typeColor.border
      )}
    >
      {/* Image - Primary visual element */}
      <div className="relative aspect-[4/3] bg-stone overflow-hidden">
        {hasImage ? (
          <img
            src={hit.primary_image_url ?? undefined}
            alt={hit.title || hit.object_name || 'Collection object'}
            className={cn(
              'w-full h-full object-cover transition-transform duration-500',
              isHovered ? 'scale-105' : 'scale-100'
            )}
          />
        ) : (
          /* Graceful fallback with object type color accent */
          <div className={cn('w-full h-full flex flex-col items-center justify-center', typeColor.bg)}>
            <Package size={40} className={cn(typeColor.text, 'opacity-40')} />
            {hit.object_type && (
              <span className={cn('mt-2 text-xs opacity-60 capitalize', typeColor.text)}>
                {hit.object_type}
              </span>
            )}
          </div>
        )}

        {/* Object type color accent bar */}
        <div className={cn('absolute bottom-0 left-0 right-0 h-1 opacity-80', typeColor.accent)} />

        {/* Relationship Preview Indicators - Top Right */}
        <div className={cn(
          'absolute top-2 right-2 flex gap-1.5 transition-opacity duration-300',
          isHovered ? 'opacity-0' : 'opacity-100'
        )}>
          {/* Completeness indicator — only shown when fully complete */}
          {isComplete && (
            <span className="flex items-center gap-1 px-2 py-1 bg-semantic-success/80 text-parchment text-xs rounded-full backdrop-blur-sm">
              <CheckCircle2 size={12} />
            </span>
          )}

          {/* Discoverable indicator */}
          {hasDiscoverApp && hit.is_discoverable && (
            <span className="flex items-center gap-1 px-2 py-1 bg-bark/80 text-parchment text-xs rounded-full backdrop-blur-sm" title="Publicly discoverable">
              <Globe2 size={12} />
            </span>
          )}

          {/* Active procedures warning */}
          {previewData.activeProcedures > 0 && (
            <span className="flex items-center gap-1 px-2 py-1 bg-semantic-warning/80 text-parchment text-xs rounded-full backdrop-blur-sm">
              <FileText size={12} />
              {previewData.activeProcedures}
            </span>
          )}
        </div>

        {/* Hover Overlay with Quick Actions */}
        <div className={cn(
          'absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/60 to-ink/30',
          'flex flex-col justify-between p-4 transition-opacity duration-300',
          isHovered ? 'opacity-100' : 'opacity-0'
        )}>
          {/* Quick Actions - Top */}
          <div className="flex justify-end gap-2">
            {onQuickMove && (
              <button
                onClick={(e) => handleQuickAction(e, onQuickMove)}
                className="p-1.5 bg-parchment/90 text-ink rounded-lg hover:bg-parchment transition-colors shadow-sm"
                title="Move object"
              >
                <ArrowRightLeft size={14} />
              </button>
            )}
            {onAddToWorkspace && (
              <button
                onClick={(e) => handleQuickAction(e, onAddToWorkspace)}
                className="p-1.5 bg-parchment/90 text-ink rounded-lg hover:bg-parchment transition-colors shadow-sm"
                title="Add to workspace"
              >
                <Layers size={14} />
              </button>
            )}
          </div>

          {/* Relationship summary - Bottom */}
          <div className="text-parchment">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {previewData.hasLocation && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-parchment/20 text-xs rounded-full">
                  <MapPin size={10} /> {hit.current_location?.name}
                </span>
              )}
            </div>
            {hit.brief_description && (
              <p className="text-sm line-clamp-2">{hit.brief_description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Minimal text info - larger, more generous */}
      <div className="p-5">
        <p className="text-xs text-archive mb-2 tracking-wide uppercase">
          {hit.object_number}
        </p>
        {hit.highlights?.title?.[0] ? (
          <h3
            className="font-serif text-lg font-medium text-forest line-clamp-2 mb-2"
            ref={(el) => { if (el) el.innerHTML = sanitizeHighlight(hit.highlights!.title![0]); }}
          />
        ) : (
          <h3 className="font-serif text-lg font-medium text-forest line-clamp-2 mb-2">
            {hit.title || hit.object_name || 'Untitled'}
          </h3>
        )}
        {hit.creators && hit.creators.length > 0 && (
          <p className="text-sm text-accessible-gray">
            {hit.creators.map(c => c.name).join(', ')}
          </p>
        )}
        {hit.creation_date?.text && (
          <p className="text-sm text-archive mt-1">
            {hit.creation_date.text}
          </p>
        )}

        {/* Location shown subtly when present */}
        {previewData.hasLocation && hit.current_location?.name && (
          <p className="text-xs text-archive mt-3 pt-3 border-t border-lichen/50 flex items-center gap-1">
            <MapPin size={10} /> {hit.current_location.name}
          </p>
        )}
      </div>
    </div>
  );
}

// Object Row Component (List View) - Dense, operational, relational
function ObjectRow({
  hit,
  onClick,
  onEdit,
  onAddToWorkspace,
  hasDiscoverApp,
}: {
  hit: CollectionsSearchHit;
  onClick: () => void;
  onEdit: () => void;
  onAddToWorkspace?: () => void;
  hasDiscoverApp?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const typeColor = getObjectTypeColor(hit.object_type);

  // Relationship preview data - use person_authority_count if available,
  // otherwise fall back to counting creators and associated_people arrays
  const personAuthorityCount = hit.person_authority_count ?? 0;
  const creatorsCount = hit.creators?.length ?? 0;
  const associatedPeopleCount = hit.associated_people?.length ?? 0;
  const previewData = {
    peopleCount: personAuthorityCount > 0 ? personAuthorityCount : (creatorsCount + associatedPeopleCount),
    hasLocation: !!hit.current_location,
    hasImages: !!hit.primary_image_url || (hit.image_count ?? 0) > 0,
    activeProcedures: hit.active_procedures_count ?? 0,
    hasRights: hit.has_rights ?? false,
  };

  const handleEdit = (e: MouseEvent) => {
    e.stopPropagation();
    onEdit();
  };

  const handleAddToWorkspace = (e: MouseEvent) => {
    e.stopPropagation();
    onAddToWorkspace?.();
  };

  const handleDragStart = useCallback(() => {
    setDragPayload({
      kind: 'object',
      objectId: hit.object_id,
      objectNumber: hit.object_number || '',
      title: hit.title || hit.object_name || '',
    });
  }, [hit.object_id, hit.object_number, hit.title, hit.object_name]);

  const handleDragEnd = useCallback(() => {
    clearDragPayload();
  }, []);

  return (
    <tr
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'cursor-pointer transition-colors',
        isHovered ? 'bg-stone/30' : ''
      )}
    >
      {/* Thumbnail */}
      <td className="px-4 py-3">
        <div className={cn(
          'w-10 h-10 rounded-md overflow-hidden border-l-2 bg-stone/50',
          typeColor.border
        )}>
          {hit.primary_image_url ? (
            <img
              src={hit.primary_image_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className={cn('w-full h-full flex items-center justify-center', typeColor.bg)}>
              <Package size={16} className={typeColor.text} />
            </div>
          )}
        </div>
      </td>

      {/* Object info */}
      <td className="px-4 py-3">
        <div>
          <p className="text-xs text-archive">{hit.object_number}</p>
          {hit.highlights?.title?.[0] ? (
            <p
              className="font-medium text-ink line-clamp-1"
              ref={(el) => { if (el) el.innerHTML = sanitizeHighlight(hit.highlights!.title![0]); }}
            />
          ) : (
            <p className="font-medium text-ink line-clamp-1">
              {hit.title || hit.object_name || 'Untitled'}
            </p>
          )}
        </div>
      </td>

      {/* Type with color dot */}
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', typeColor.accent)} />
          <span className="text-ink text-sm capitalize">
            {hit.object_type || '-'}
          </span>
        </span>
      </td>

      {/* Creator */}
      <td className="px-4 py-3 text-ink text-sm">
        {hit.creators?.map(c => c.name).join(', ') || '-'}
      </td>

      {/* Location */}
      <td className="px-4 py-3">
        {hit.current_location ? (
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <MapPin size={14} className="text-archive" />
            {hit.current_location.name}
          </span>
        ) : (
          <span className="text-sm text-archive italic">Not assigned</span>
        )}
      </td>

      {/* Relationship indicators */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-center gap-1">
          {/* People indicator */}
          <RelationshipIndicator
            icon={<Users size={14} />}
            count={previewData.peopleCount}
            label="people"
            present={previewData.peopleCount > 0}
          />

          {/* Images indicator */}
          <RelationshipIndicator
            icon={<ImageIcon size={14} />}
            present={previewData.hasImages}
            label="images"
          />

          {/* Rights indicator */}
          <RelationshipIndicator
            icon={<Scale size={14} />}
            present={previewData.hasRights}
            label="rights"
          />

          {/* Discoverable indicator */}
          {hasDiscoverApp && hit.is_discoverable && (
            <span
              className="flex items-center gap-0.5 px-1.5 py-0.5 bg-azurite/10 text-azurite rounded text-xs"
              title="Publicly discoverable"
            >
              <Globe2 size={12} />
            </span>
          )}

          {/* Active procedures (warning) */}
          {previewData.activeProcedures > 0 && (
            <span
              className="flex items-center gap-0.5 px-1.5 py-0.5 bg-semantic-warning/10 text-semantic-warning rounded text-xs"
              title={`${previewData.activeProcedures} active procedure(s)`}
            >
              <FileText size={12} />
              {previewData.activeProcedures}
            </span>
          )}
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span className={cn(
          'inline-flex px-2 py-0.5 text-xs font-medium rounded-full',
          hit.object_status === 'active' ? 'bg-semantic-success/10 text-semantic-success' : 'bg-stone text-ink'
        )}>
          {hit.object_status || 'active'}
        </span>
      </td>

      {/* Quick actions */}
      <td className="px-4 py-3">
        <div className={cn(
          'flex items-center gap-1 transition-all',
          isHovered ? 'opacity-100' : 'opacity-0'
        )}>
          {onAddToWorkspace && (
            <button
              onClick={handleAddToWorkspace}
              className="p-1.5 rounded-lg bg-stone hover:bg-lichen"
              title="Add to workspace"
            >
              <Layers size={14} className="text-archive" />
            </button>
          )}
          <button
            onClick={handleEdit}
            className="p-1.5 rounded-lg bg-stone hover:bg-lichen"
            title="Edit object"
          >
            <Edit size={14} className="text-archive" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// Relationship Indicator for list view
function RelationshipIndicator({
  icon,
  count,
  present,
  label,
}: {
  icon: ReactNode;
  count?: number;
  present: boolean;
  label: string;
}) {
  return (
    <span
      className={cn(
        'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs transition-colors',
        present
          ? 'bg-semantic-success/10 text-semantic-success'
          : 'bg-stone text-archive/40'
      )}
      title={present ? `Has ${label}` : `No ${label}`}
    >
      {icon}
      {count !== undefined && count > 0 && <span>{count}</span>}
    </span>
  );
}

// Facet Filter Component
function FacetFilter({
  label,
  facet,
  value,
  onChange,
}: {
  label: string;
  facet?: Facet;
  value?: string[];
  onChange: (value: string[] | undefined) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedCount = value?.length || 0;

  const toggleValue = (key: string) => {
    const current = value || [];
    if (current.includes(key)) {
      const next = current.filter(v => v !== key);
      onChange(next.length > 0 ? next : undefined);
    } else {
      onChange([...current, key]);
    }
  };

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-ink mb-1">
        {label}
      </label>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="input w-full flex items-center justify-between text-left"
      >
        <span className={selectedCount > 0 ? 'text-bark' : 'text-archive'}>
          {selectedCount > 0 ? `${selectedCount} selected` : `All ${label}`}
        </span>
        <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && facet && (
        <div className="absolute z-10 mt-1 w-full bg-parchment border border-lichen rounded-institutional shadow-archival-md max-h-60 overflow-auto">
          {facet.buckets.map(bucket => (
            <label
              key={bucket.key}
              className="flex items-center gap-2 px-3 py-2 hover:bg-stone cursor-pointer"
            >
              <Checkbox
                checked={value?.includes(bucket.key) || false}
                onChange={() => toggleValue(bucket.key)}
              />
              <span className="flex-1 text-sm text-ink">
                {bucket.key}
              </span>
              <span className="text-xs text-archive">
                {bucket.doc_count}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Relationship Filter Chip Component
function RelationshipFilterChip({
  label,
  isActive,
  onChange,
  icon,
  variant = 'default',
}: {
  label: string;
  isActive?: boolean;
  onChange: (value: boolean) => void;
  icon?: ReactNode;
  variant?: 'default' | 'warning';
}) {
  return (
    <button
      onClick={() => onChange(!isActive)}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-all',
        isActive
          ? variant === 'warning'
            ? 'bg-semantic-warning text-parchment border-semantic-warning'
            : 'bg-bark text-parchment border-bark'
          : variant === 'warning'
            ? 'bg-semantic-warning/5 text-semantic-warning border-semantic-warning/30 hover:border-semantic-warning hover:bg-semantic-warning/10'
            : 'bg-parchment text-ink border-lichen hover:border-archive hover:bg-stone'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// Empty State Component - Warm and invitational
function EmptyState({
  searchQuery,
  hasFilters,
  onClearFilters,
  onCreateNew,
  canCreate = true,
}: {
  searchQuery: string;
  hasFilters: boolean;
  onClearFilters: () => void;
  onCreateNew: () => void;
  canCreate?: boolean;
}) {
  // Different states for different scenarios
  if (searchQuery || hasFilters) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
          <Search size={32} className="text-archive" />
        </div>
        <h3 className="text-xl font-serif font-medium text-forest mb-3">
          No objects match your search
        </h3>
        <p className="text-archive max-w-md mx-auto mb-6">
          We couldn't find any objects matching "{searchQuery || 'your filters'}".
          Try adjusting your search terms or clearing some filters.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={onClearFilters}
            className="btn btn-secondary"
          >
            <X size={16} className="mr-1.5" />
            Clear filters
          </button>
        </div>
      </div>
    );
  }

  // First-time / empty collection state
  return (
    <div className="text-center py-16">
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
        <Sparkles size={40} className="text-bark" />
      </div>
      <h3 className="text-2xl font-serif font-medium text-forest mb-6">No objects yet.</h3>
      <div className="flex items-center justify-center gap-4">
        {canCreate ? (
          <button
            onClick={onCreateNew}
            className="btn btn-primary flex items-center gap-2"
          >
            <Plus size={16} className="mr-1.5" />
            Add your first object
          </button>
        ) : (
          <span
            className="btn bg-archive/50 text-parchment cursor-not-allowed flex items-center gap-2"
            title="Requires collections.create permission"
          >
            <Plus size={16} className="mr-1.5" />
            Add your first object
          </span>
        )}
      </div>
    </div>
  );
}

// Collection Origins Map Wrapper - fetches data and renders map
function CollectionOriginsMapWrapper({
  organizationId: _organizationId,
  onPlaceClick,
}: {
  organizationId: string;
  onPlaceClick?: (place: { place_id: string; name: string }) => void;
}) {
  const { useCollectionOrigins } = useGeo();
  const { data, isLoading } = useCollectionOrigins(undefined, 200, { enabled: true });

  if (isLoading) {
    return (
      <div className="h-[500px] bg-stone rounded-lg flex items-center justify-center">
        <div className="text-archive">Loading collection origins...</div>
      </div>
    );
  }

  if (!data?.places || data.places.length === 0) {
    const missingCoords = data?.linked_places_without_coordinates ?? 0;
    return (
      <div className="h-[500px] bg-stone/30 rounded-lg flex flex-col items-center justify-center text-archive">
        <Globe size={40} className="mb-3 opacity-40" />
        <p className="text-sm font-medium">No origin data available</p>
        {missingCoords > 0 ? (
          <p className="text-xs mt-1">
            {missingCoords} linked place{missingCoords !== 1 ? 's' : ''} ha{missingCoords !== 1 ? 've' : 's'} no
            coordinates yet — add coordinates to the place authorities to see them on the map
          </p>
        ) : (
          <p className="text-xs mt-1">Add place associations to your objects to see them on the map</p>
        )}
      </div>
    );
  }

  // Filter to only places with coordinates
  const placesWithCoords = data.places.filter(
    (p) => p.latitude != null && p.longitude != null
  );

  return (
    <CollectionOriginMap
      places={placesWithCoords.map((p) => ({
        place_id: p.place_id,
        name: p.name,
        latitude: p.latitude!,
        longitude: p.longitude!,
        object_count: p.object_count,
        hierarchy: p.hierarchy ?? undefined,
        place_type: p.place_type ?? undefined,
        role: p.role as 'creation_place' | 'discovery_place' | 'provenance_place' | 'other',
      }))}
      height={500}
      onPlaceClick={onPlaceClick}
      collectionName="Your Collection"
    />
  );
}
