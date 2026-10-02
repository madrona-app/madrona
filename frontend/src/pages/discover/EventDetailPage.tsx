/**
 * EventDetailPage -- Single event detail view for the public site.
 *
 * Route: /c/:orgSlug/events/:slug
 *
 * Displays all event information including hero image, date/time,
 * venue, pricing, description, registration CTA, and "Add to Calendar"
 * download. Renders inside the collection site shell.
 */

import { useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  MapPin,
  Ticket,
  Users,
  ExternalLink,
  CalendarPlus,
  Tag,
  Star,
} from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import { apiFetch } from '../../lib/api/_utils';
import type { PublicEvent } from '../../types/discover';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatTime } from '@/lib/formatters';

// =============================================================================
// API helper
// =============================================================================

async function fetchEventDetail(
  orgSlug: string,
  slug: string,
): Promise<{ data: PublicEvent }> {
  return await apiFetch(`/discover/${orgSlug}/events/${encodeURIComponent(slug)}`, {
    skipAuth: true,
  });
}

// =============================================================================
// ICS calendar helper
// =============================================================================

function formatICSDate(dateStr: string): string {
  const d = new Date(dateStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function generateICS(event: PublicEvent): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Madrona//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
  ];

  if (event.start_at) {
    lines.push(`DTSTART:${formatICSDate(event.start_at)}`);
  }
  if (event.end_at) {
    lines.push(`DTEND:${formatICSDate(event.end_at)}`);
  }

  lines.push(`SUMMARY:${escapeICSText(event.title)}`);

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICSText(event.description)}`);
  } else if (event.short_description) {
    lines.push(`DESCRIPTION:${escapeICSText(event.short_description)}`);
  }

  const location = [event.venue_name, event.location_name]
    .filter(Boolean)
    .join(', ');
  if (location) {
    lines.push(`LOCATION:${escapeICSText(location)}`);
  }

  if (event.registration_url) {
    lines.push(`URL:${event.registration_url}`);
  }

  lines.push(`UID:${event.event_id}@madrona`);
  lines.push(`DTSTAMP:${formatICSDate(new Date().toISOString())}`);
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

function downloadICS(event: PublicEvent) {
  const icsContent = generateICS(event);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${event.slug || event.event_id}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// =============================================================================
// Date formatting helpers
// =============================================================================

function formatEventDateFull(startAt: string | null, endAt: string | null): string {
  if (!startAt) return 'Date TBD';

  const start = new Date(startAt);
  const datePart = start.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const startTime = formatTime(start);

  if (!endAt) {
    return `${datePart} | ${startTime}`;
  }

  const end = new Date(endAt);
  const endTime = formatTime(end);

  // Check if same day
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) {
    return `${datePart} | ${startTime} \u2013 ${endTime}`;
  }

  // Multi-day event
  const endDatePart = end.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `${datePart}, ${startTime} \u2013 ${endDatePart}, ${endTime}`;
}

// =============================================================================
// Event type labels
// =============================================================================

const EVENT_TYPE_LABELS: Record<string, string> = {
  program: 'Program',
  opening_reception: 'Opening Reception',
  lecture: 'Lecture',
  workshop: 'Workshop',
  tour: 'Tour',
  performance: 'Performance',
  screening: 'Screening',
  family: 'Family',
  members_only: 'Members Only',
  fundraiser: 'Fundraiser',
  other: 'Other',
};

// =============================================================================
// Main Component
// =============================================================================

export default function EventDetailPage() {
  const { orgSlug, slug } = useParams<{ orgSlug: string; slug: string }>();

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

  // Fetch event detail
  const {
    data: eventResponse,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['public-event-detail', orgSlug, slug],
    queryFn: () => fetchEventDetail(orgSlug!, slug!),
    enabled: !!orgSlug && !!slug,
  });

  const event = eventResponse?.data;

  const handleAddToCalendar = useCallback(() => {
    if (event) downloadICS(event);
  }, [event]);

  // ── Loading ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <div className="flex items-center justify-center py-20">
          <MadronaLoader />
        </div>
      </CollectionSiteShell>
    );
  }

  // ── Error / Not Found ────────────────────────────────────────────────
  if (error || !event) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <Helmet>
          <title>
            Event Not Found{info?.organization_name ? ` | ${info.organization_name}` : ''}
          </title>
        </Helmet>
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link
            to={`/c/${orgSlug}/events`}
            className="text-archive hover:text-bark text-sm flex items-center gap-1 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to events
          </Link>
        </div>
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <CalendarDays className="w-12 h-12 text-archive/40 mx-auto mb-4" />
          <h1 className="text-2xl font-medium text-ink mb-2">Event Not Found</h1>
          <p className="text-archive">
            This event does not exist or is no longer available.
          </p>
        </div>
      </CollectionSiteShell>
    );
  }

  // ── Prepare display values ───────────────────────────────────────────
  const dateDisplay = formatEventDateFull(event.start_at, event.end_at);
  const typeLabel = EVENT_TYPE_LABELS[event.event_type] || event.event_type;
  const canonicalUrl = `${window.location.origin}/c/${orgSlug}/events/${slug}`;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>
          {[event.title, info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        <meta
          name="description"
          content={
            event.short_description ||
            event.description?.slice(0, 200) ||
            `${event.title} at ${info?.organization_name || 'the museum'}.`
          }
        />
        <link rel="canonical" href={canonicalUrl} />

        {/* Open Graph */}
        <meta property="og:title" content={event.title} />
        <meta
          property="og:description"
          content={event.short_description || event.description?.slice(0, 200) || ''}
        />
        <meta property="og:type" content="event" />
        <meta property="og:url" content={canonicalUrl} />
        {event.hero_image_url && (
          <meta property="og:image" content={event.hero_image_url} />
        )}

        {/* Twitter Card */}
        <meta
          name="twitter:card"
          content={event.hero_image_url ? 'summary_large_image' : 'summary'}
        />
        <meta name="twitter:title" content={event.title} />
        {event.short_description && (
          <meta name="twitter:description" content={event.short_description} />
        )}
        {event.hero_image_url && (
          <meta name="twitter:image" content={event.hero_image_url} />
        )}

        {/* JSON-LD: Event */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Event',
            name: event.title,
            description: event.short_description || event.description || undefined,
            url: canonicalUrl,
            ...(event.start_at ? { startDate: event.start_at } : {}),
            ...(event.end_at ? { endDate: event.end_at } : {}),
            ...(event.hero_image_url ? { image: event.hero_image_url } : {}),
            ...(event.venue_name || event.location_name
              ? {
                  location: {
                    '@type': 'Place',
                    name: event.venue_name || event.location_name,
                  },
                }
              : {}),
            ...(event.registration_url
              ? {
                  offers: {
                    '@type': 'Offer',
                    url: event.registration_url,
                    ...(event.price ? { price: event.price } : {}),
                  },
                }
              : {}),
            ...(info?.organization_name
              ? {
                  organizer: {
                    '@type': 'Organization',
                    name: info.organization_name,
                  },
                }
              : {}),
          })}
        </script>
      </Helmet>

      {/* Back link */}
      <div className="max-w-4xl mx-auto px-4 pt-6 pb-2">
        <Link
          to={`/c/${orgSlug}/events`}
          className="text-archive hover:text-bark text-sm flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to events
        </Link>
      </div>

      {/* Hero image */}
      {event.hero_image_url && (
        <div className="max-w-5xl mx-auto px-4 mt-4">
          <div className="max-h-[400px] overflow-hidden rounded-lg bg-stone/30">
            <img
              src={event.hero_image_url}
              alt={event.title}
              className="w-full h-full object-cover max-h-[400px]"
            />
          </div>
        </div>
      )}

      {/* Event content */}
      <article className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <header className="mb-8">
          {/* Type badge + featured indicator */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-bark/8 text-bark">
              {typeLabel}
            </span>
            {event.is_featured && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-bark">
                <Star size={12} className="fill-bark" />
                Featured
              </span>
            )}
            {event.series_name && (
              <span className="text-xs text-archive border-l border-lichen pl-2">
                Part of: {event.series_name}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 className="font-serif text-3xl md:text-4xl font-light text-ink leading-tight mb-4">
            {event.title}
          </h1>

          {/* Date/time */}
          <div className="flex items-center gap-2 text-ink mb-3">
            <CalendarDays size={18} className="text-bark flex-shrink-0" />
            <span className="text-base font-medium">{dateDisplay}</span>
          </div>

          {/* Venue / location */}
          {(event.venue_name || event.location_name) && (
            <div className="flex items-center gap-2 text-ink mb-3">
              <MapPin size={18} className="text-bark flex-shrink-0" />
              <span className="text-base">
                {event.venue_slug ? (
                  <Link
                    to={`/c/${orgSlug}/venues/${event.venue_slug}`}
                    className="text-bark hover:text-copper-dark transition-colors"
                  >
                    {event.venue_name}
                  </Link>
                ) : (
                  event.venue_name
                )}
                {event.location_name && event.venue_name && event.location_name !== event.venue_name && (
                  <span className="text-archive"> &mdash; {event.location_name}</span>
                )}
                {event.location_name && !event.venue_name && event.location_name}
              </span>
            </div>
          )}
        </header>

        {/* Two-column layout for details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Main content column */}
          <div className="md:col-span-2">
            {/* Description */}
            {event.description && (
              <div className="prose-madrona mb-8">
                <div className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                  {event.description}
                </div>
              </div>
            )}

            {/* Short description fallback */}
            {!event.description && event.short_description && (
              <div className="mb-8">
                <p className="text-sm text-ink leading-relaxed">
                  {event.short_description}
                </p>
              </div>
            )}

            {/* Tags */}
            {event.tags && event.tags.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xs font-medium text-archive uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Tag size={12} />
                  Tags
                </h2>
                <div className="flex flex-wrap gap-2">
                  {event.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 text-xs font-medium bg-stone/50 text-ink rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar column */}
          <aside className="md:col-span-1">
            <div className="bg-stone/20 rounded-lg p-5 space-y-5 sticky top-24">
              {/* Pricing section */}
              {(event.price || event.price_member) && (
                <div>
                  <h3 className="text-xs font-medium text-archive uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <Ticket size={12} />
                    Admission
                  </h3>
                  {event.price && (
                    <div className="flex items-baseline justify-between text-sm mb-1">
                      <span className="text-archive">General</span>
                      <span className="text-ink font-medium">{event.price}</span>
                    </div>
                  )}
                  {event.price_member && (
                    <div className="flex items-baseline justify-between text-sm mb-1">
                      <span className="text-archive">Members</span>
                      <span className="text-ink font-medium">{event.price_member}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Age range */}
              {event.age_range && (
                <div>
                  <h3 className="text-xs font-medium text-archive uppercase tracking-wide mb-1">
                    Ages
                  </h3>
                  <p className="text-sm text-ink">{event.age_range}</p>
                </div>
              )}

              {/* Capacity */}
              {event.capacity && (
                <div className="flex items-center gap-2 text-sm text-archive">
                  <Users size={14} />
                  <span>Capacity: {event.capacity}</span>
                </div>
              )}

              {/* Registration CTA */}
              {event.registration_url && (
                <a
                  href={event.registration_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors"
                >
                  Register Now
                  <ExternalLink size={14} />
                </a>
              )}

              {/* Add to Calendar */}
              {event.start_at && (
                <button
                  onClick={handleAddToCalendar}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-ink border border-lichen rounded-lg hover:bg-stone/50 hover:border-bark/30 transition-colors"
                >
                  <CalendarPlus size={14} />
                  Add to Calendar
                </button>
              )}

              {/* Date/time summary */}
              <div className="pt-3 border-t border-lichen">
                <div className="flex items-start gap-2 text-sm text-archive">
                  <Clock size={14} className="mt-0.5 flex-shrink-0" />
                  <span>{dateDisplay}</span>
                </div>
              </div>

              {/* Venue summary */}
              {(event.venue_name || event.location_name) && (
                <div className="flex items-start gap-2 text-sm text-archive">
                  <MapPin size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {event.venue_slug ? (
                      <Link
                        to={`/c/${orgSlug}/venues/${event.venue_slug}`}
                        className="text-bark hover:text-copper-dark transition-colors"
                      >
                        {event.venue_name || event.location_name}
                      </Link>
                    ) : (
                      event.venue_name || event.location_name
                    )}
                  </span>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* Series info */}
        {event.series_name && (
          <div className="mt-10 pt-6 border-t border-lichen">
            <p className="text-sm text-archive">
              This event is part of the{' '}
              <span className="font-medium text-ink">{event.series_name}</span>{' '}
              series.{' '}
              <Link
                to={`/c/${orgSlug}/events?series=${encodeURIComponent(event.series_name)}`}
                className="text-bark hover:text-copper-dark transition-colors"
              >
                View all events in this series
              </Link>
            </p>
          </div>
        )}

        {/* Bottom navigation */}
        <footer className="mt-10 pt-8 border-t border-lichen">
          <Link
            to={`/c/${orgSlug}/events`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-bark hover:text-copper-dark transition-colors"
          >
            <ArrowLeft size={16} />
            Back to all events
          </Link>
        </footer>
      </article>
    </CollectionSiteShell>
  );
}
