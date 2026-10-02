/**
 * ExhibitionDetailPage — Public exhibition detail page.
 *
 * Route: /c/:orgSlug/exhibitions/:slug
 *
 * Displays a single exhibition with hero image, metadata, description,
 * credits, visitor info, tags, and related objects. Renders inside
 * the collection site shell.
 */

import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import {
  ArrowLeft,
  Image,
  Calendar,
  MapPin,
  Ticket,
  Tag,
  ExternalLink,
  } from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import type { PublicExhibition } from '../../types/discover';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

import { formatDateLong } from '@/lib/formatters';

// =============================================================================
// Fetch helper
// =============================================================================

async function fetchExhibitionDetail(
  orgSlug: string,
  slug: string,
): Promise<PublicExhibition> {
  const res = await fetch(`/api/discover/${orgSlug}/exhibitions/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Exhibition not found');
    throw new Error('Failed to load exhibition');
  }
  const json = await res.json();
  return json.data;
}

// =============================================================================
// Date formatting
// =============================================================================

function formatExhibitionDates(exhibition: PublicExhibition): string | null {
  const start = exhibition.actual_start_date || exhibition.planned_start_date;
  const end = exhibition.actual_end_date || exhibition.planned_end_date;

  if (!start && !end) return null;

  const fmt = (dateStr: string): string => {
    return formatDateLong(dateStr + 'T00:00:00');
  };

  const fmtShort = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
    });
  };

  if (start && end) {
    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    if (startDate.getFullYear() === endDate.getFullYear()) {
      return `${fmtShort(start)} \u2013 ${fmt(end)}`;
    }
    return `${fmt(start)} \u2013 ${fmt(end)}`;
  }

  if (start) return `Opens ${fmt(start)}`;
  return `Through ${fmt(end!)}`;
}

function getStatusLabel(status: string): { label: string; className: string } {
  switch (status) {
    case 'open':
      return { label: 'Now On View', className: 'bg-semantic-success/10 text-semantic-success' };
    case 'upcoming':
      return { label: 'Coming Soon', className: 'bg-semantic-info/10 text-semantic-info' };
    case 'past':
    case 'closed':
      return { label: 'Past Exhibition', className: 'bg-stone text-archive' };
    default:
      return { label: status, className: 'bg-stone text-archive' };
  }
}

// =============================================================================
// Main Component
// =============================================================================

export default function ExhibitionDetailPage() {
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

  // Fetch exhibition detail
  const {
    data: exhibition,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['discover-exhibition-detail', orgSlug, slug],
    queryFn: () => fetchExhibitionDetail(orgSlug!, slug!),
    enabled: !!orgSlug && !!slug,
  });



  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <div className="flex items-center justify-center py-20">
          <MadronaLoader />
        </div>
      </CollectionSiteShell>
    );
  }

  // ── Error / 404 ──────────────────────────────────────────────────────────
  if (error || !exhibition) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <Helmet>
          <title>
            Exhibition Not Found{info?.organization_name ? ` | ${info.organization_name}` : ''}
          </title>
        </Helmet>
        <div className="max-w-7xl mx-auto px-4 py-4">
          <Link
            to={`/c/${orgSlug}/exhibitions`}
            className="text-archive hover:text-bark text-sm flex items-center gap-1 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to exhibitions
          </Link>
        </div>
        <div className="max-w-7xl mx-auto px-4 py-16 text-center">
          <Image className="w-12 h-12 text-archive/40 mx-auto mb-4" />
          <h1 className="text-2xl font-medium text-ink mb-2">Exhibition Not Found</h1>
          <p className="text-archive">
            This exhibition does not exist or is not currently available.
          </p>
        </div>
      </CollectionSiteShell>
    );
  }

  const dateDisplay = formatExhibitionDates(exhibition);
  const statusInfo = getStatusLabel(exhibition.status);

  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>
          {[exhibition.title, info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        <meta
          name="description"
          content={
            exhibition.short_description ||
            exhibition.description?.slice(0, 200) ||
            `${exhibition.title} at ${info?.organization_name || 'the museum'}.`
          }
        />

        {/* Open Graph */}
        <meta property="og:title" content={exhibition.title} />
        <meta
          property="og:description"
          content={exhibition.short_description || exhibition.description?.slice(0, 200) || ''}
        />
        <meta property="og:type" content="website" />
        {exhibition.hero_image_url && (
          <meta property="og:image" content={exhibition.hero_image_url} />
        )}

        {/* Twitter Card */}
        <meta name="twitter:card" content={exhibition.hero_image_url ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={exhibition.title} />
        <meta
          name="twitter:description"
          content={exhibition.short_description || exhibition.description?.slice(0, 200) || ''}
        />
        {exhibition.hero_image_url && (
          <meta name="twitter:image" content={exhibition.hero_image_url} />
        )}
      </Helmet>

      {/* Hero image */}
      {exhibition.hero_image_url ? (
        <div className="relative w-full max-h-[500px] overflow-hidden">
          <img
            src={exhibition.hero_image_url}
            alt={exhibition.title}
            className="w-full h-full max-h-[500px] object-cover"
          />
          {/* Gradient overlay at bottom */}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/20 to-transparent" />

          {/* Title overlay on hero */}
          <div className="absolute bottom-0 left-0 right-0 px-4 pb-8">
            <div className="max-w-7xl mx-auto">
              <span
                className={`inline-block px-3 py-1 rounded-full text-xs font-medium mb-3 ${statusInfo.className}`}
              >
                {statusInfo.label}
              </span>
              <h1 className="font-serif text-3xl md:text-5xl font-light text-parchment leading-tight mb-2">
                {exhibition.title}
              </h1>
              {exhibition.subtitle && (
                <h2 className="text-lg md:text-xl text-parchment/80 font-light">
                  {exhibition.subtitle}
                </h2>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* No hero image: render title in a plain header */
        <div className="bg-forest">
          <div className="max-w-7xl mx-auto px-4 py-12">
            <span
              className={`inline-block px-3 py-1 rounded-full text-xs font-medium mb-3 ${statusInfo.className}`}
            >
              {statusInfo.label}
            </span>
            <h1 className="font-serif text-3xl md:text-5xl font-light text-parchment leading-tight mb-2">
              {exhibition.title}
            </h1>
            {exhibition.subtitle && (
              <h2 className="text-lg md:text-xl text-parchment/80 font-light">
                {exhibition.subtitle}
              </h2>
            )}
          </div>
        </div>
      )}

      {/* Back link */}
      <div className="max-w-7xl mx-auto px-4 pt-6 pb-2">
        <Link
          to={`/c/${orgSlug}/exhibitions`}
          className="text-archive hover:text-bark text-sm flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to exhibitions
        </Link>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Left column: description and details */}
          <div className="lg:col-span-2">
            {/* Date, venue, and CTA row */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8 pb-6 border-b border-lichen">
              <div className="flex-1 space-y-2">
                {dateDisplay && (
                  <div className="flex items-center gap-2 text-sm text-ink">
                    <Calendar size={16} className="text-archive" />
                    <span>{dateDisplay}</span>
                  </div>
                )}
                {exhibition.venue_name && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin size={16} className="text-archive" />
                    {exhibition.venue_slug ? (
                      <Link
                        to={`/c/${orgSlug}/visit/${exhibition.venue_slug}`}
                        className="text-bark hover:text-copper-dark transition-colors"
                      >
                        {exhibition.venue_name}
                      </Link>
                    ) : (
                      <span className="text-ink">{exhibition.venue_name}</span>
                    )}
                  </div>
                )}
              </div>

              {exhibition.ticketing_url && (
                <a
                  href={exhibition.ticketing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-bark text-parchment text-sm font-medium rounded-lg hover:bg-copper-dark transition-colors"
                >
                  <Ticket size={16} />
                  Get Tickets
                  <ExternalLink size={14} />
                </a>
              )}
            </div>

            {/* Exhibition type badge */}
            {exhibition.exhibition_type && (
              <span className="inline-block px-2.5 py-1 text-xs font-medium rounded bg-stone text-archive mb-4">
                {exhibition.exhibition_type}
              </span>
            )}

            {/* Description */}
            {exhibition.description && (
              <div className="mb-8">
                <div className="prose-madrona text-sm text-ink leading-relaxed whitespace-pre-wrap">
                  {exhibition.description}
                </div>
              </div>
            )}

            {/* Credits */}
            {exhibition.credits && (
              <div className="mb-8">
                <h3 className="text-xs font-medium text-archive uppercase tracking-wide mb-3">
                  Credits
                </h3>
                <div className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                  {exhibition.credits}
                </div>
              </div>
            )}
          </div>

          {/* Right column: sidebar info */}
          <div className="lg:col-span-1">
            {/* Visitor info card */}
            {exhibition.visitor_info && (
              <div className="bg-stone/30 rounded-lg p-6 mb-6">
                <h3 className="text-xs font-medium text-archive uppercase tracking-wide mb-3">
                  Visitor Information
                </h3>
                <div className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                  {exhibition.visitor_info}
                </div>
              </div>
            )}

            {/* Tags */}
            {exhibition.tags && exhibition.tags.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-medium text-archive uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Tag size={12} />
                  Tags
                </h3>
                <div className="flex flex-wrap gap-2">
                  {exhibition.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-block px-3 py-1 text-xs font-medium rounded-full bg-bark/8 text-bark"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Ticketing CTA (sidebar, for mobile users who may have scrolled past the main CTA) */}
            {exhibition.ticketing_url && (
              <div className="lg:hidden mt-6">
                <a
                  href={exhibition.ticketing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full px-5 py-2.5 bg-bark text-parchment text-sm font-medium rounded-lg hover:bg-copper-dark transition-colors"
                >
                  <Ticket size={16} />
                  Get Tickets
                  <ExternalLink size={14} />
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom navigation */}
      <div className="border-t border-lichen">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <Link
            to={`/c/${orgSlug}/exhibitions`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-bark hover:text-copper-dark transition-colors"
          >
            <ArrowLeft size={16} />
            View all exhibitions
          </Link>
        </div>
      </div>
    </CollectionSiteShell>
  );
}
