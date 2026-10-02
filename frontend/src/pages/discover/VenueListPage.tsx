/**
 * VenueListPage — Public "Plan Your Visit" page listing all venues.
 *
 * Route: /c/:orgSlug/visit
 *
 * Displays a hero section and responsive grid of venue cards. Each card
 * links to the venue detail page.
 */

import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { MapPin, Clock, ArrowRight } from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import { getPublicVenues } from '../../lib/api/discover';
import type { PublicVenue } from '../../types/discover';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

// =============================================================================
// Helpers
// =============================================================================

/** Build a brief hours summary (e.g. "Mon-Fri 10am-5pm") from the hours map. */
function formatHoursSummary(hours: PublicVenue['hours']): string | null {
  if (!hours) return null;

  const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const dayAbbrevs: Record<string, string> = {
    monday: 'Mon',
    tuesday: 'Tue',
    wednesday: 'Wed',
    thursday: 'Thu',
    friday: 'Fri',
    saturday: 'Sat',
    sunday: 'Sun',
  };

  const entries = dayOrder
    .filter((d) => hours[d])
    .map((d) => ({ day: d, ...hours[d] }));

  if (entries.length === 0) return null;

  // Group consecutive days with the same open/close times
  const groups: Array<{ startDay: string; endDay: string; open: string; close: string }> = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.open === entry.open && last.close === entry.close) {
      last.endDay = entry.day;
    } else {
      groups.push({ startDay: entry.day, endDay: entry.day, open: entry.open, close: entry.close });
    }
  }

  return groups
    .map((g) => {
      const range =
        g.startDay === g.endDay
          ? dayAbbrevs[g.startDay]
          : `${dayAbbrevs[g.startDay]}-${dayAbbrevs[g.endDay]}`;
      return `${range} ${g.open}-${g.close}`;
    })
    .join(', ');
}

// =============================================================================
// Sub-components
// =============================================================================

function VenueCard({ venue, orgSlug }: { venue: PublicVenue; orgSlug: string }) {
  const hoursSummary = formatHoursSummary(venue.hours);
  const venueUrl = `/c/${orgSlug}/visit/${venue.slug || venue.venue_id}`;

  return (
    <Link
      to={venueUrl}
      className="group flex flex-col bg-parchment border border-lichen rounded-lg overflow-hidden hover:border-bark/30 hover:shadow-sm transition-all"
    >
      {/* Thumbnail */}
      <div className="aspect-[16/10] overflow-hidden bg-stone/30">
        {venue.thumbnail_url ? (
          <img
            src={venue.thumbnail_url}
            alt={venue.name}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-forest/5 to-bark/5">
            <MapPin className="w-10 h-10 text-archive/20" />
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 p-5">
        <h2 className="text-lg font-medium text-ink group-hover:text-bark transition-colors mb-2">
          {venue.name}
        </h2>

        {venue.address && (
          <p className="flex items-start gap-1.5 text-sm text-archive mb-2">
            <MapPin size={14} className="mt-0.5 flex-shrink-0" />
            <span className="line-clamp-2">{venue.address}</span>
          </p>
        )}

        {hoursSummary && (
          <p className="flex items-start gap-1.5 text-sm text-archive mb-3">
            <Clock size={14} className="mt-0.5 flex-shrink-0" />
            <span className="line-clamp-1">{hoursSummary}</span>
          </p>
        )}

        <div className="mt-auto pt-3 border-t border-lichen">
          <span className="inline-flex items-center gap-1 text-sm font-medium text-bark group-hover:text-copper-dark transition-colors">
            Visit
            <ArrowRight size={14} />
          </span>
        </div>
      </div>
    </Link>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function VenueListPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();

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

  // Fetch venues list
  const {
    data: venuesResponse,
    isLoading,
  } = useQuery({
    queryKey: ['public-venues', orgSlug],
    queryFn: () => getPublicVenues(orgSlug!),
    enabled: !!orgSlug,
  });

  const venues = venuesResponse?.data || [];

  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>
          {['Plan Your Visit', info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        <meta
          name="description"
          content={`Plan your visit to ${info?.organization_name || 'our museum'}. View locations, hours, and admission information.`}
        />
      </Helmet>

      {/* Hero section */}
      <section className="bg-forest">
        <div className="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 className="font-serif text-4xl md:text-5xl font-light text-parchment mb-4">
            Plan Your Visit
          </h1>
          <p className="text-parchment/70 text-lg max-w-2xl mx-auto">
            Explore our {venues.length > 1 ? 'locations' : 'location'} and plan your next visit
            {info?.organization_name ? ` to ${info.organization_name}` : ''}.
          </p>
        </div>
      </section>

      {/* Venues grid */}
      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <MadronaLoader />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && venues.length === 0 && (
          <div className="py-16 text-center">
            <MapPin className="w-12 h-12 text-archive/30 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-ink mb-2">No venues listed yet</h2>
            <p className="text-archive">
              Check back soon for visitor information.
            </p>
          </div>
        )}

        {/* Venue cards */}
        {!isLoading && venues.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {venues.map((venue) => (
              <VenueCard
                key={venue.venue_id}
                venue={venue}
                orgSlug={orgSlug!}
              />
            ))}
          </div>
        )}
      </div>
    </CollectionSiteShell>
  );
}
