/**
 * ExhibitionListPage — Public exhibition listing page.
 *
 * Route: /c/:orgSlug/exhibitions
 *
 * Displays a tabbed, filterable grid of exhibitions with pagination.
 * Tabs: "Now On View" (open), "Coming Soon" (upcoming), "Past" (past).
 * Renders inside the collection site shell.
 */

import { useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import {
  Image,
  Calendar,
  MapPin,
  Ticket,
  Star,
} from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import type { PublicExhibition } from '../../types/discover';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';

// =============================================================================
// Constants
// =============================================================================

const PAGE_SIZE = 20;

interface TabConfig {
  key: string;
  label: string;
  status: string;
}

const TABS: TabConfig[] = [
  { key: 'now', label: 'Now On View', status: 'open' },
  { key: 'upcoming', label: 'Coming Soon', status: 'upcoming' },
  { key: 'past', label: 'Past', status: 'past' },
];

// =============================================================================
// Date formatting
// =============================================================================

function formatExhibitionDates(exhibition: PublicExhibition): string | null {
  const start = exhibition.actual_start_date || exhibition.planned_start_date;
  const end = exhibition.actual_end_date || exhibition.planned_end_date;

  if (!start && !end) return null;

  const fmt = (dateStr: string): string => {
    return formatDateShort(dateStr + 'T00:00:00');
  };

  const fmtShort = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };

  if (start && end) {
    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    // If same year, omit year from start date
    if (startDate.getFullYear() === endDate.getFullYear()) {
      return `${fmtShort(start)} \u2013 ${fmt(end)}`;
    }
    return `${fmt(start)} \u2013 ${fmt(end)}`;
  }

  if (start) return `Opens ${fmt(start)}`;
  return `Through ${fmt(end!)}`;
}

// =============================================================================
// Fetch helper
// =============================================================================

async function fetchExhibitions(
  orgSlug: string,
  params: { status: string; venue?: string; limit: number; offset: number },
): Promise<{ data: PublicExhibition[]; total: number }> {
  const searchParams = new URLSearchParams();
  searchParams.set('status', params.status);
  searchParams.set('limit', String(params.limit));
  searchParams.set('offset', String(params.offset));
  if (params.venue) searchParams.set('venue', params.venue);

  const res = await fetch(`/api/discover/${orgSlug}/exhibitions?${searchParams.toString()}`);
  if (!res.ok) throw new Error('Failed to load exhibitions');
  return res.json();
}

async function fetchVenues(orgSlug: string): Promise<{ slug: string; name: string }[]> {
  try {
    const res = await fetch(`/api/discover/${orgSlug}/venues`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || []).map((v: { slug: string | null; name: string }) => ({
      slug: v.slug || '',
      name: v.name,
    })).filter((v: { slug: string }) => v.slug);
  } catch {
    return [];
  }
}

// =============================================================================
// Sub-components
// =============================================================================

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  return (
    <div className="flex border-b border-lichen" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={activeTab === tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`px-5 py-3 text-sm font-medium transition-colors relative ${
            activeTab === tab.key
              ? 'text-bark'
              : 'text-archive hover:text-ink'
          }`}
        >
          {tab.label}
          {activeTab === tab.key && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-bark" />
          )}
        </button>
      ))}
    </div>
  );
}

function VenueFilter({
  venues,
  activeVenue,
  onVenueChange,
}: {
  venues: { slug: string; name: string }[];
  activeVenue: string;
  onVenueChange: (venue: string) => void;
}) {
  if (venues.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <MapPin size={14} className="text-archive" />
      <select
        value={activeVenue}
        onChange={(e) => onVenueChange(e.target.value)}
        className="text-sm border border-lichen rounded-lg px-3 py-1.5 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2 outline-none"
      >
        <option value="">All Venues</option>
        {venues.map((v) => (
          <option key={v.slug} value={v.slug}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ExhibitionCard({
  exhibition,
  orgSlug,
}: {
  exhibition: PublicExhibition;
  orgSlug: string;
}) {
  const dateDisplay = formatExhibitionDates(exhibition);
  const slug = exhibition.public_url_slug || exhibition.exhibition_id;

  return (
    <Link
      to={`/c/${orgSlug}/exhibitions/${slug}`}
      className={`group flex flex-col bg-parchment border border-lichen rounded-lg overflow-hidden hover:border-bark/30 hover:shadow-sm transition-all ${
        exhibition.is_featured ? 'ring-1 ring-bark/20' : ''
      }`}
    >
      {/* Thumbnail or placeholder */}
      <div className="aspect-[16/10] overflow-hidden bg-stone/30 relative">
        {exhibition.thumbnail_url ? (
          <img
            src={exhibition.thumbnail_url}
            alt={exhibition.title}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-forest/5 to-bark/5">
            <Image className="w-10 h-10 text-archive/20" />
          </div>
        )}
        {exhibition.is_featured && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bark/90 text-parchment text-xs font-medium">
            <Star size={10} />
            Featured
          </span>
        )}
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 p-5">
        {/* Title */}
        <h2 className="text-lg font-medium text-ink group-hover:text-bark transition-colors mb-1 line-clamp-2">
          {exhibition.title}
        </h2>

        {/* Subtitle */}
        {exhibition.subtitle && (
          <p className="text-sm text-archive mb-2 line-clamp-1">
            {exhibition.subtitle}
          </p>
        )}

        {/* Short description */}
        {exhibition.short_description && (
          <p className="text-sm text-archive leading-relaxed line-clamp-2 mb-3 flex-1">
            {exhibition.short_description}
          </p>
        )}

        {/* Meta row */}
        <div className="mt-auto pt-3 border-t border-lichen space-y-1.5">
          {dateDisplay && (
            <div className="flex items-center gap-1.5 text-xs text-archive">
              <Calendar size={12} />
              <span>{dateDisplay}</span>
            </div>
          )}
          {exhibition.venue_name && (
            <div className="flex items-center gap-1.5 text-xs text-archive">
              <MapPin size={12} />
              <span>{exhibition.venue_name}</span>
            </div>
          )}
        </div>

        {/* Tickets link */}
        {exhibition.ticketing_url && (
          <div className="mt-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-bark group-hover:text-copper-dark transition-colors">
              <Ticket size={12} />
              Get Tickets
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function ExhibitionListPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive state from URL search params
  const activeTabKey = searchParams.get('tab') || 'now';
  const activeVenue = searchParams.get('venue') || '';
  const currentOffset = Math.max(0, Number(searchParams.get('offset') || '0'));

  const activeStatus = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTabKey);
    return tab ? tab.status : 'open';
  }, [activeTabKey]);

  // Hide the initial loading overlay
  useEffect(() => {
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 300);
    }
  }, []);

  // Fetch collection info for the shell
  const { data: info } = useQuery({
    queryKey: ['discover-info', orgSlug],
    queryFn: () => getDiscoverInfo(orgSlug!),
    enabled: !!orgSlug,
  });

  // Fetch venues for filter dropdown
  const { data: venues } = useQuery({
    queryKey: ['discover-venues-list', orgSlug],
    queryFn: () => fetchVenues(orgSlug!),
    enabled: !!orgSlug,
  });

  // Fetch exhibitions
  const {
    data: exhibitionsResponse,
    isLoading,
  } = useQuery({
    queryKey: ['discover-exhibitions', orgSlug, activeStatus, activeVenue, currentOffset],
    queryFn: () =>
      fetchExhibitions(orgSlug!, {
        status: activeStatus,
        venue: activeVenue || undefined,
        limit: PAGE_SIZE,
        offset: currentOffset,
      }),
    enabled: !!orgSlug,
  });

  const exhibitions = exhibitionsResponse?.data || [];
  const totalResults = exhibitionsResponse?.total || 0;
  const hasMore = currentOffset + PAGE_SIZE < totalResults;

  // URL-driven state changes
  const updateSearchParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleTabChange = useCallback(
    (tabKey: string) => {
      updateSearchParams({ tab: tabKey === 'now' ? null : tabKey, offset: null, venue: null });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [updateSearchParams],
  );

  const handleVenueChange = useCallback(
    (venue: string) => {
      updateSearchParams({ venue: venue || null, offset: null });
    },
    [updateSearchParams],
  );

  const handleLoadMore = useCallback(() => {
    updateSearchParams({ offset: String(currentOffset + PAGE_SIZE) });
  }, [currentOffset, updateSearchParams]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>
          {['Exhibitions', info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        <meta
          name="description"
          content={`Explore current, upcoming, and past exhibitions at ${info?.organization_name || 'the museum'}.`}
        />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Page heading */}
        <div className="mb-8">
          <h1 className="font-serif text-4xl font-light text-ink mb-2">Exhibitions</h1>
          <p className="text-archive">
            Discover exhibitions at {info?.organization_name || 'the museum'}.
          </p>
        </div>

        {/* Tabs and filters */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <TabBar activeTab={activeTabKey} onTabChange={handleTabChange} />
          <VenueFilter
            venues={venues || []}
            activeVenue={activeVenue}
            onVenueChange={handleVenueChange}
          />
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <MadronaLoader />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && exhibitions.length === 0 && (
          <div className="py-16 text-center">
            <Image className="w-12 h-12 text-archive/30 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-ink mb-2">No exhibitions found</h2>
            <p className="text-archive">
              {activeVenue
                ? 'No exhibitions at this venue. Try clearing the filter.'
                : activeTabKey === 'upcoming'
                  ? 'No upcoming exhibitions at this time. Check back soon.'
                  : activeTabKey === 'past'
                    ? 'No past exhibitions to display.'
                    : 'No exhibitions currently on view.'}
            </p>
          </div>
        )}

        {/* Exhibition grid */}
        {!isLoading && exhibitions.length > 0 && (
          <>
            {/* Results count */}
            <p className="text-sm text-archive mb-4">
              Showing {Math.min(currentOffset + PAGE_SIZE, totalResults)} of {totalResults}{' '}
              {totalResults === 1 ? 'exhibition' : 'exhibitions'}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {exhibitions.map((exhibition) => (
                <ExhibitionCard
                  key={exhibition.exhibition_id}
                  exhibition={exhibition}
                  orgSlug={orgSlug!}
                />
              ))}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center pt-10">
                <button
                  onClick={handleLoadMore}
                  className="px-6 py-2.5 text-sm font-medium text-ink border border-lichen rounded-lg hover:bg-stone/50 transition-colors"
                >
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </CollectionSiteShell>
  );
}
