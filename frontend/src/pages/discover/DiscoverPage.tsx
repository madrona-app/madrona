import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { getDiscoverInfo, searchDiscoverObjects } from '../../lib/api';
import { getPublishedPageById } from '../../lib/api/content';
import { useDiscoverSearch } from './hooks/useDiscoverSearch';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { HeroSection } from './components/HeroSection';
import { FeaturedObjectsSection } from './components/FeaturedObjectsSection';
import { FilterPanel } from './components/FilterPanel';
import { ActiveFilters } from './components/ActiveFilters';
import { ResultsGrid } from './components/ResultsGrid';
import { Pagination } from './components/Pagination';
import { BlockRenderer } from '../content/components/BlockRenderer';
import type { ContentBlock } from '../../types/content';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

export function DiscoverPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const {
    params,
    searchInput,
    setSearchInput,
    clearSearch,
    viewMode,
    setViewMode,
    currentPage,
    pageSize,
    handlePageChange,
    handleSortChange,
    handleFacetToggle,
    handleRemoveFilter,
    handleClearAll,
    updateParams,
  } = useDiscoverSearch();

  // Hide the initial loading overlay
  useEffect(() => {
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 300);
    }
  }, []);

  // Fetch collection info
  const { data: info } = useQuery({
    queryKey: ['discover-info', orgSlug],
    queryFn: () => getDiscoverInfo(orgSlug!),
    enabled: !!orgSlug,
  });

  // Use default view mode from config
  useEffect(() => {
    if (info?.default_view_mode) {
      setViewMode(info.default_view_mode);
    }
  }, [info?.default_view_mode]);

  // Fetch CMS homepage page (when configured)
  const homepagePageId = info?.homepage_page_id;
  const {
    data: homepageResponse,
    isLoading: isLoadingHomepage,
  } = useQuery({
    queryKey: ['content-homepage', orgSlug, homepagePageId],
    queryFn: () => getPublishedPageById(orgSlug!, homepagePageId!),
    enabled: !!orgSlug && !!homepagePageId,
  });

  const homepagePage = homepageResponse?.data;
  const homepageBlocks: ContentBlock[] = homepagePage?.blocks ?? [];

  // Fetch search results
  const { data: searchResult, isLoading, error: searchError } = useQuery({
    queryKey: ['discover-search', orgSlug, params],
    queryFn: () => searchDiscoverObjects(orgSlug!, params),
    enabled: !!orgSlug,
    placeholderData: keepPreviousData,
  });

  const totalPages = searchResult ? Math.ceil(searchResult.total / pageSize) : 0;
  const facets = searchResult?.facets || [];

  const toggleHasImage = useCallback(() => {
    handleFacetToggle('has_image', 'true');
  }, [handleFacetToggle]);

  const toggleOnDisplay = useCallback(() => {
    handleFacetToggle('on_display', 'true');
  }, [handleFacetToggle]);

  // Show featured section only when no active search query
  const hasActiveSearch = !!params.q || Object.keys(params).some(
    (k) => !['sort', 'limit', 'offset', 'include_facets'].includes(k) && params[k as keyof typeof params] !== undefined,
  );

  // ── CMS Homepage Rendering ────────────────────────────────────────────
  if (homepagePageId) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <Helmet>
          <title>
            {homepagePage?.meta_title || homepagePage?.title || info?.page_title || info?.organization_name || 'Collection'}
          </title>
          {(homepagePage?.meta_description || homepagePage?.excerpt || info?.page_subtitle) && (
            <meta name="description" content={homepagePage?.meta_description || homepagePage?.excerpt || info?.page_subtitle || ''} />
          )}
        </Helmet>

        {isLoadingHomepage ? (
          <div className="flex items-center justify-center py-20">
            <MadronaLoader />
          </div>
        ) : homepageBlocks.length > 0 ? (
          homepagePage?.template === 'landing' ? (
            // Landing template: alternating full-width sections
            <div className="w-full">
              {homepageBlocks.map((block, i) => (
                <section
                  key={block.block_id}
                  className={`py-12 ${i % 2 === 1 ? 'bg-stone/30' : 'bg-parchment'}`}
                >
                  <div className="max-w-7xl mx-auto px-4">
                    <BlockRenderer blocks={[block]} />
                  </div>
                </section>
              ))}
            </div>
          ) : homepagePage?.template === 'full_width' ? (
            <div className="w-full">
              <BlockRenderer blocks={homepageBlocks} />
            </div>
          ) : (
            <div className="max-w-4xl mx-auto px-4 py-10">
              <BlockRenderer blocks={homepageBlocks} />
            </div>
          )
        ) : (
          // Fallback: show default search grid if CMS page has no content
          <>
            <HeroSection
              info={info}
              searchInput={searchInput}
              onSearchChange={setSearchInput}
              onClearSearch={clearSearch}
              onToggleFilters={() => setFilterPanelOpen(true)}
            />
            {!hasActiveSearch && <FeaturedObjectsSection orgSlug={orgSlug!} />}
            <div className="max-w-7xl mx-auto px-4 py-8">
              <ResultsGrid
                hits={searchResult?.hits || []}
                total={searchResult?.total || 0}
                isLoading={isLoading}
                error={searchError}
                viewMode={viewMode}
                orgSlug={orgSlug!}
              />
            </div>
          </>
        )}
      </CollectionSiteShell>
    );
  }

  // ── Default Search Grid ──────────────────────────────────────────────
  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>{info?.page_title || info?.organization_name || 'Explore the Collection'}</title>
        {info?.page_subtitle && <meta name="description" content={info.page_subtitle} />}
      </Helmet>

      {/* Hero */}
      <HeroSection
        info={info}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        onClearSearch={clearSearch}
        onToggleFilters={() => setFilterPanelOpen(true)}
      />

      {/* Featured objects — only when not searching */}
      {!hasActiveSearch && <FeaturedObjectsSection orgSlug={orgSlug!} />}

      {/* Results area */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <ActiveFilters
          params={params}
          onRemove={handleRemoveFilter}
          onClearAll={handleClearAll}
        />

        <ResultsGrid
          hits={searchResult?.hits || []}
          total={searchResult?.total || 0}
          isLoading={isLoading}
          error={searchError}
          viewMode={viewMode}
          orgSlug={orgSlug!}
        />

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      </div>

      {/* Filter panel (slide-out) */}
      <FilterPanel
        isOpen={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        facets={facets}
        params={params}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onSortChange={handleSortChange}
        onFacetToggle={handleFacetToggle}
        onToggleHasImage={toggleHasImage}
        onToggleOnDisplay={toggleOnDisplay}
        updateParams={updateParams}
      />
    </CollectionSiteShell>
  );
}
