/**
 * VenueDetailPage — Public venue detail page.
 *
 * Route: /c/:orgSlug/visit/:venueSlug
 *
 * Displays full venue information including hero image, hours, admission,
 * accessibility info, and upcoming exhibitions at the venue.
 */

import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import {
  MapPin,
  Phone,
  Mail,
  Globe,
  ArrowLeft,
  Car,
  Accessibility,
  Ticket,
  Calendar,
  Image,
} from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import { getPublicVenueDetail } from '../../lib/api/discover';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';

// =============================================================================
// Constants
// =============================================================================

const DAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const DAY_LABELS: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

// =============================================================================
// Sub-components
// =============================================================================

function HoursTable({ hours }: { hours: Record<string, { open: string; close: string }> }) {
  return (
    <div>
      <h2 className="text-xs font-medium text-archive uppercase tracking-wide mb-3">
        Hours
      </h2>
      <div className="border border-lichen rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {DAY_ORDER.map((day) => {
              const entry = hours[day];
              return (
                <tr key={day} className="border-b border-lichen last:border-b-0">
                  <td className="px-4 py-2.5 font-medium text-ink bg-stone/20 w-28">
                    {DAY_LABELS[day]}
                  </td>
                  <td className="px-4 py-2.5 text-ink">
                    {entry ? `${entry.open} - ${entry.close}` : (
                      <span className="text-archive">Closed</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdmissionInfo({
  admission,
}: {
  admission: {
    tiers?: Array<{ label: string; price: string }>;
    free_days?: string;
    note?: string;
  };
}) {
  return (
    <div>
      <h2 className="text-xs font-medium text-archive uppercase tracking-wide mb-3">
        Admission
      </h2>

      {admission.tiers && admission.tiers.length > 0 && (
        <div className="border border-lichen rounded-lg overflow-hidden mb-3">
          <table className="w-full text-sm">
            <tbody>
              {admission.tiers.map((tier, i) => (
                <tr key={i} className="border-b border-lichen last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">{tier.label}</td>
                  <td className="px-4 py-2.5 text-ink font-medium text-right">{tier.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {admission.free_days && (
        <p className="text-sm text-semantic-success mb-2">
          Free admission: {admission.free_days}
        </p>
      )}

      {admission.note && (
        <p className="text-sm text-archive">{admission.note}</p>
      )}
    </div>
  );
}

function ExhibitionCard({
  exhibition,
  orgSlug,
}: {
  exhibition: {
    exhibition_id: string;
    title: string;
    subtitle: string | null;
    public_url_slug: string | null;
    planned_start_date: string | null;
    planned_end_date: string | null;
    short_description: string | null;
    thumbnail_url: string | null;
  };
  orgSlug: string;
}) {
  const exhibitionUrl = `/c/${orgSlug}/exhibitions/${exhibition.public_url_slug || exhibition.exhibition_id}`;

  const formatDate = (dateStr: string | null): string | null => {
    if (!dateStr) return null;
    const result = formatDateShort(dateStr);
    return result === '\u2014' ? dateStr : result;
  };

  const startDate = formatDate(exhibition.planned_start_date);
  const endDate = formatDate(exhibition.planned_end_date);
  const dateRange = [startDate, endDate].filter(Boolean).join(' - ');

  return (
    <Link
      to={exhibitionUrl}
      className="group flex flex-col bg-parchment border border-lichen rounded-lg overflow-hidden hover:border-bark/30 hover:shadow-sm transition-all"
    >
      {/* Thumbnail */}
      <div className="aspect-[16/10] overflow-hidden bg-stone/30">
        {exhibition.thumbnail_url ? (
          <img
            src={exhibition.thumbnail_url}
            alt={exhibition.title}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-forest/5 to-bark/5">
            <Image className="w-10 h-10 text-archive/20" />
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 p-5">
        <h3 className="text-lg font-medium text-ink group-hover:text-bark transition-colors mb-1 line-clamp-2">
          {exhibition.title}
        </h3>

        {exhibition.subtitle && (
          <p className="text-sm text-archive mb-2 line-clamp-1">{exhibition.subtitle}</p>
        )}

        {dateRange && (
          <p className="flex items-center gap-1.5 text-sm text-archive mb-2">
            <Calendar size={14} className="flex-shrink-0" />
            {dateRange}
          </p>
        )}

        {exhibition.short_description && (
          <p className="text-sm text-archive leading-relaxed line-clamp-3 mt-1">
            {exhibition.short_description}
          </p>
        )}
      </div>
    </Link>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function VenueDetailPage() {
  const { orgSlug, venueSlug } = useParams<{ orgSlug: string; venueSlug: string }>();

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

  // Fetch venue detail
  const {
    data: venueResponse,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['public-venue-detail', orgSlug, venueSlug],
    queryFn: () => getPublicVenueDetail(orgSlug!, venueSlug!),
    enabled: !!orgSlug && !!venueSlug,
  });

  const venue = venueResponse?.data;
  const upcomingExhibitions = venue?.upcoming_exhibitions || [];

  // ── Loading state ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <div className="flex items-center justify-center py-20">
          <MadronaLoader />
        </div>
      </CollectionSiteShell>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error || !venue) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <div className="max-w-7xl mx-auto px-4 py-4">
          <Link
            to={`/c/${orgSlug}/visit`}
            className="text-archive hover:text-bark text-sm flex items-center gap-1 mb-8 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to venues
          </Link>
        </div>
        <div className="max-w-7xl mx-auto px-4 py-12 text-center">
          <h1 className="text-2xl font-medium text-ink mb-2">Venue Not Found</h1>
          <p className="text-archive">This venue could not be found or is no longer available.</p>
        </div>
      </CollectionSiteShell>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>
          {[venue.name, info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        <meta
          name="description"
          content={
            venue.description?.slice(0, 200) ||
            `Visit ${venue.name}${info?.organization_name ? ` at ${info.organization_name}` : ''}. View hours, admission, and directions.`
          }
        />
      </Helmet>

      {/* Hero image */}
      {venue.hero_image_url && (
        <div className="w-full max-h-[400px] overflow-hidden bg-stone/30">
          <img
            src={venue.hero_image_url}
            alt={venue.name}
            className="w-full h-full max-h-[400px] object-cover"
          />
        </div>
      )}

      {/* Back navigation */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <Link
          to={`/c/${orgSlug}/visit`}
          className="text-archive hover:text-bark text-sm flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={16} />
          All venues
        </Link>
      </div>

      {/* Venue header */}
      <div className="max-w-7xl mx-auto px-4 pb-6">
        <h1 className="font-serif text-3xl md:text-4xl font-light text-ink mb-3">
          {venue.name}
        </h1>

        {venue.description && (
          <p className="text-ink leading-relaxed max-w-3xl">{venue.description}</p>
        )}
      </div>

      {/* Two-column layout */}
      <div className="max-w-7xl mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Left column: Hours, Admission, Parking, Accessibility */}
          <div className="lg:col-span-2 space-y-8">
            {venue.hours && Object.keys(venue.hours).length > 0 && (
              <HoursTable hours={venue.hours} />
            )}

            {venue.admission && (
              <AdmissionInfo admission={venue.admission} />
            )}

            {venue.parking_info && (
              <div>
                <h2 className="text-xs font-medium text-archive uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Car size={14} />
                  Parking
                </h2>
                <p className="text-sm text-ink leading-relaxed">{venue.parking_info}</p>
              </div>
            )}

            {venue.accessibility_info && (
              <div>
                <h2 className="text-xs font-medium text-archive uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Accessibility size={14} />
                  Accessibility
                </h2>
                <p className="text-sm text-ink leading-relaxed">{venue.accessibility_info}</p>
              </div>
            )}
          </div>

          {/* Right column: Contact, Map placeholder, Ticketing CTA */}
          <div className="space-y-6">
            {/* Contact info card */}
            <div className="border border-lichen rounded-lg p-5 space-y-4">
              <h2 className="text-xs font-medium text-archive uppercase tracking-wide">
                Contact & Location
              </h2>

              {venue.address && (
                <div className="flex items-start gap-2.5">
                  <MapPin size={16} className="text-archive mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-ink">{venue.address}</p>
                </div>
              )}

              {venue.phone && (
                <div className="flex items-center gap-2.5">
                  <Phone size={16} className="text-archive flex-shrink-0" />
                  <a
                    href={`tel:${venue.phone}`}
                    className="text-sm text-bark hover:text-copper-dark transition-colors"
                  >
                    {venue.phone}
                  </a>
                </div>
              )}

              {venue.email && (
                <div className="flex items-center gap-2.5">
                  <Mail size={16} className="text-archive flex-shrink-0" />
                  <a
                    href={`mailto:${venue.email}`}
                    className="text-sm text-bark hover:text-copper-dark transition-colors"
                  >
                    {venue.email}
                  </a>
                </div>
              )}

              {venue.website_url && (
                <div className="flex items-center gap-2.5">
                  <Globe size={16} className="text-archive flex-shrink-0" />
                  <a
                    href={venue.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-bark hover:text-copper-dark transition-colors"
                  >
                    Website
                  </a>
                </div>
              )}
            </div>

            {/* Map placeholder */}
            {venue.address && (
              <div className="border border-lichen rounded-lg overflow-hidden">
                <div className="aspect-[4/3] bg-stone/30 flex items-center justify-center">
                  <div className="text-center">
                    <MapPin className="w-8 h-8 text-archive/30 mx-auto mb-2" />
                    <p className="text-xs text-archive">Map</p>
                  </div>
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-4 py-3 text-sm text-center text-bark hover:text-copper-dark hover:bg-stone/20 transition-colors border-t border-lichen"
                >
                  Get directions
                </a>
              </div>
            )}

            {/* Ticketing CTA */}
            {venue.ticketing_url && (
              <a
                href={venue.ticketing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-bark text-parchment font-medium rounded-lg hover:bg-copper-dark transition-colors"
              >
                <Ticket size={18} />
                Buy Tickets
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Upcoming Exhibitions */}
      {upcomingExhibitions.length > 0 && (
        <section className="border-t border-lichen">
          <div className="max-w-7xl mx-auto px-4 py-10">
            <h2 className="font-serif text-2xl font-light text-ink mb-6">
              Upcoming Exhibitions
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {upcomingExhibitions.map((exhibition) => (
                <ExhibitionCard
                  key={exhibition.exhibition_id}
                  exhibition={exhibition}
                  orgSlug={orgSlug!}
                />
              ))}
            </div>
          </div>
        </section>
      )}
    </CollectionSiteShell>
  );
}
