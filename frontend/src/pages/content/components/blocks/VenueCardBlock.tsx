/**
 * Venue Card Block — Display a venue by its slug (fetched from API).
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPin, Clock, Globe, Phone } from 'lucide-react';
import { getPublicVenueDetail } from '../../../../lib/api/discover';

// =============================================================================
// Shared Types
// =============================================================================

interface BlockEditorComponentProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

interface BlockRendererComponentProps {
  content: Record<string, unknown>;
}

// =============================================================================
// Editor
// =============================================================================

export function VenueCardEditor({ content, onChange }: BlockEditorComponentProps) {
  const venueSlug = (content.venue_slug as string) || '';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Venue Slug <span className="text-semantic-error">*</span>
        </label>
        <input
          type="text"
          value={venueSlug}
          onChange={(e) => onChange({ ...content, venue_slug: e.target.value })}
          placeholder="e.g., main-building"
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
        <p className="text-xs text-archive mt-1">
          The URL slug of the venue to display. The venue must exist in your organization.
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function VenueCardRenderer({ content }: BlockRendererComponentProps) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const venueSlug = (content.venue_slug as string) || '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['venue-card-block', orgSlug, venueSlug],
    queryFn: () => getPublicVenueDetail(orgSlug!, venueSlug),
    enabled: !!orgSlug && !!venueSlug,
    staleTime: 60_000,
  });

  if (!orgSlug || !venueSlug) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-archive" />
      </div>
    );
  }

  if (error || !data?.data) {
    return (
      <div className="text-center py-8 text-archive text-sm">
        Venue not found.
      </div>
    );
  }

  const venue = data.data;

  return (
    <Link
      to={`/c/${orgSlug}/venues/${venue.slug || venueSlug}`}
      className="group block rounded-lg border border-lichen overflow-hidden hover:border-bark/30 transition-colors"
    >
      {venue.hero_image_url && (
        <div className="aspect-[3/1] bg-stone overflow-hidden">
          <img
            src={venue.hero_image_url}
            alt={venue.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        </div>
      )}

      <div className="p-6 space-y-3">
        <h3 className="text-xl font-medium text-ink group-hover:text-bark transition-colors">
          {venue.name}
        </h3>

        {venue.description && (
          <p className="text-sm text-ink/80 leading-relaxed line-clamp-3">
            {venue.description}
          </p>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-archive">
          {venue.address && (
            <span className="flex items-center gap-1.5">
              <MapPin size={13} className="shrink-0" />
              {venue.address}
            </span>
          )}
          {venue.phone && (
            <span className="flex items-center gap-1.5">
              <Phone size={13} className="shrink-0" />
              {venue.phone}
            </span>
          )}
          {venue.website_url && (
            <span className="flex items-center gap-1.5">
              <Globe size={13} className="shrink-0" />
              Website
            </span>
          )}
        </div>

        {venue.hours && Object.keys(venue.hours).length > 0 && (
          <div className="flex items-start gap-1.5 text-sm text-archive">
            <Clock size={13} className="shrink-0 mt-0.5" />
            <div>
              {Object.entries(venue.hours).slice(0, 3).map(([day, times]) => (
                <span key={day} className="block">
                  {day}: {times.open} &ndash; {times.close}
                </span>
              ))}
              {Object.keys(venue.hours).length > 3 && (
                <span className="text-xs text-archive/60">
                  + {Object.keys(venue.hours).length - 3} more days
                </span>
              )}
            </div>
          </div>
        )}

        <span className="inline-block text-xs text-bark group-hover:text-copper-dark transition-colors">
          View venue details &rarr;
        </span>
      </div>
    </Link>
  );
}
