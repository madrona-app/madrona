/**
 * EventListPage -- Public events listing page.
 *
 * Route: /c/:orgSlug/events
 *
 * Displays a chronological, filterable list of upcoming (and optionally
 * past) events grouped by month. Renders inside the collection site shell.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import {
  Calendar,
  MapPin,
  Clock,
  SlidersHorizontal,
  X,
  ChevronDown,
  ExternalLink,
  CalendarDays,
  Ticket,
  Star,
} from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import { apiFetch, buildQueryString } from '../../lib/api/_utils';
import type { PublicEvent } from '../../types/discover';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatTime } from '@/lib/formatters';

// =============================================================================
// Constants
// =============================================================================

const EVENTS_PER_PAGE = 20;

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
// API helpers
// =============================================================================

interface EventListParams {
  event_type?: string;
  venue?: string;
  series?: string;
  date_from?: string;
  date_to?: string;
  show_past?: boolean;
  limit?: number;
  offset?: number;
}

async function fetchEvents(
  orgSlug: string,
  params: EventListParams,
): Promise<{ data: PublicEvent[]; total: number }> {
  const query = buildQueryString(params as Record<string, unknown>);
  return await apiFetch(`/discover/${orgSlug}/events${query}`, { skipAuth: true });
}

// =============================================================================
// Date formatting helpers
// =============================================================================

function formatDay(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { day: 'numeric' });
}

function formatMonthShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
}

function formatTimeRange(startAt: string | null, endAt: string | null): string {
  if (!startAt) return '';
  const startTime = formatTime(startAt);
  if (!endAt) return startTime;
  const endTime = formatTime(endAt);
  return `${startTime} \u2013 ${endTime}`;
}

function formatWeekday(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'long' });
}

function getMonthYearKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthYear(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// =============================================================================
// Sub-components
// =============================================================================

function EventTypeFilters({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (type: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
        Event Type
      </h3>
      {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
        <button
          key={key}
          onClick={() => onToggle(key)}
          className={`block w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
            selected.has(key)
              ? 'bg-bark/10 text-bark font-medium'
              : 'text-ink hover:bg-stone/50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function VenueFilter({
  venues,
  selected,
  onChange,
}: {
  venues: string[];
  selected: string;
  onChange: (v: string) => void;
}) {
  if (venues.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
        Venue
      </h3>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-lichen rounded-lg px-3 py-2 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2 outline-none"
      >
        <option value="">All Venues</option>
        {venues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateFilter({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
        Date Range
      </h3>
      <div className="space-y-2">
        <label className="block">
          <span className="text-xs text-archive">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="mt-0.5 w-full text-sm border border-lichen rounded-lg px-3 py-2 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2 outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs text-archive">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="mt-0.5 w-full text-sm border border-lichen rounded-lg px-3 py-2 bg-parchment text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2 outline-none"
          />
        </label>
      </div>
    </div>
  );
}

function ShowPastToggle({
  checked,
  onChange: _onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer group">
      <span
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
          checked ? 'bg-bark' : 'bg-stone'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-parchment shadow transition-transform mt-0.5 ${
            checked ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="text-sm text-ink group-hover:text-bark transition-colors">
        Show Past Events
      </span>
    </label>
  );
}

function EventCard({
  event,
  orgSlug,
}: {
  event: PublicEvent;
  orgSlug: string;
}) {
  const timeRange = formatTimeRange(event.start_at, event.end_at);
  const typeLabel = EVENT_TYPE_LABELS[event.event_type] || event.event_type;

  return (
    <div
      className={`flex gap-4 sm:gap-6 py-5 ${
        event.is_featured ? 'bg-bark/5 -mx-4 px-4 rounded-lg border border-bark/10' : ''
      }`}
    >
      {/* Date block */}
      {event.start_at && (
        <div className="flex-shrink-0 w-14 text-center">
          <div className="text-xs font-semibold text-bark tracking-wider">
            {formatMonthShort(event.start_at)}
          </div>
          <div className="text-2xl font-light text-ink leading-tight">
            {formatDay(event.start_at)}
          </div>
          <div className="text-xs text-archive">
            {formatWeekday(event.start_at)}
          </div>
        </div>
      )}

      {/* Event info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 mb-1">
          <Link
            to={`/c/${orgSlug}/events/${event.slug || event.event_id}`}
            className="text-lg font-medium text-ink hover:text-bark transition-colors line-clamp-2"
          >
            {event.title}
          </Link>
          {event.is_featured && (
            <Star size={14} className="flex-shrink-0 text-bark mt-1.5 fill-bark" />
          )}
        </div>

        {/* Type badge */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-bark/8 text-bark">
            {typeLabel}
          </span>
          {event.series_name && (
            <span className="text-xs text-archive">
              {event.series_name}
            </span>
          )}
        </div>

        {/* Time and venue */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-archive mb-2">
          {timeRange && (
            <span className="flex items-center gap-1">
              <Clock size={13} />
              {timeRange}
            </span>
          )}
          {(event.venue_name || event.location_name) && (
            <span className="flex items-center gap-1">
              <MapPin size={13} />
              {event.venue_name || event.location_name}
            </span>
          )}
        </div>

        {/* Short description */}
        {event.short_description && (
          <p className="text-sm text-archive leading-relaxed line-clamp-2 mb-2">
            {event.short_description}
          </p>
        )}

        {/* Price + register */}
        <div className="flex flex-wrap items-center gap-3 mt-2">
          {event.price && (
            <span className="text-sm text-ink font-medium">
              <Ticket size={13} className="inline mr-1 -mt-0.5" />
              {event.price}
              {event.price_member && (
                <span className="text-archive font-normal ml-1">
                  ({event.price_member} members)
                </span>
              )}
            </span>
          )}
          {event.age_range && (
            <span className="text-xs text-archive">
              Ages: {event.age_range}
            </span>
          )}
          {event.registration_url && (
            <a
              href={event.registration_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-bark text-parchment rounded hover:bg-copper-dark transition-colors"
            >
              Register
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      {/* Hero image (if available) */}
      {event.hero_image_url && (
        <Link
          to={`/c/${orgSlug}/events/${event.slug || event.event_id}`}
          className="hidden md:block flex-shrink-0 w-40 h-28 rounded-lg overflow-hidden bg-stone/30"
        >
          <img
            src={event.hero_image_url}
            alt={event.title}
            className="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-300"
          />
        </Link>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function EventListPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Parse filter state from URL
  const selectedTypes = useMemo(() => {
    const raw = searchParams.get('event_type');
    return raw ? new Set(raw.split(',')) : new Set<string>();
  }, [searchParams]);

  const selectedVenue = searchParams.get('venue') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';
  const showPast = searchParams.get('show_past') === 'true';
  const currentOffset = Math.max(0, Number(searchParams.get('offset') || '0'));

  // Hide the initial loading overlay
  useEffect(() => {
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 300);
    }
  }, []);

  // Update URL params helper
  const updateFilter = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams);
      // Reset offset when filters change (unless offset is explicitly being set)
      if (!('offset' in updates)) {
        params.delete('offset');
      }
      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Filter handlers
  const handleTypeToggle = useCallback(
    (type: string) => {
      const next = new Set(selectedTypes);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      updateFilter({
        event_type: next.size > 0 ? Array.from(next).join(',') : undefined,
      });
    },
    [selectedTypes, updateFilter],
  );

  const handleVenueChange = useCallback(
    (venue: string) => updateFilter({ venue: venue || undefined }),
    [updateFilter],
  );

  const handleDateFromChange = useCallback(
    (v: string) => updateFilter({ date_from: v || undefined }),
    [updateFilter],
  );

  const handleDateToChange = useCallback(
    (v: string) => updateFilter({ date_to: v || undefined }),
    [updateFilter],
  );

  const handleShowPastChange = useCallback(
    (v: boolean) => updateFilter({ show_past: v ? 'true' : undefined }),
    [updateFilter],
  );

  const handleClearFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const handleLoadMore = useCallback(() => {
    updateFilter({ offset: String(currentOffset + EVENTS_PER_PAGE) });
  }, [currentOffset, updateFilter]);

  const hasActiveFilters =
    selectedTypes.size > 0 || !!selectedVenue || !!dateFrom || !!dateTo || showPast;

  // Fetch collection info for the shell
  const { data: info } = useQuery({
    queryKey: ['discover-info', orgSlug],
    queryFn: () => getDiscoverInfo(orgSlug!),
    enabled: !!orgSlug,
  });

  // Build API params
  const apiParams: EventListParams = useMemo(() => {
    const p: EventListParams = {
      limit: EVENTS_PER_PAGE,
      show_past: showPast || undefined,
    };
    if (selectedTypes.size > 0) {
      p.event_type = Array.from(selectedTypes).join(',');
    }
    if (selectedVenue) p.venue = selectedVenue;
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (currentOffset > 0) p.offset = currentOffset;
    return p;
  }, [selectedTypes, selectedVenue, dateFrom, dateTo, showPast, currentOffset]);

  // Fetch events
  const {
    data: eventsResponse,
    isLoading,
  } = useQuery({
    queryKey: ['public-events', orgSlug, apiParams],
    queryFn: () => fetchEvents(orgSlug!, apiParams),
    enabled: !!orgSlug,
  });

  const events = eventsResponse?.data || [];
  const totalEvents = eventsResponse?.total || 0;
  const hasMore = currentOffset + EVENTS_PER_PAGE < totalEvents;

  // Extract unique venue names for the filter dropdown
  const venueNames = useMemo(() => {
    const names = new Set<string>();
    events.forEach((e) => {
      if (e.venue_name) names.add(e.venue_name);
    });
    return Array.from(names).sort();
  }, [events]);

  // Group events by month
  const groupedEvents = useMemo(() => {
    const groups: { key: string; label: string; events: PublicEvent[] }[] = [];
    const groupMap = new Map<string, PublicEvent[]>();

    events.forEach((event) => {
      const dateKey = event.start_at
        ? getMonthYearKey(event.start_at)
        : 'undated';
      if (!groupMap.has(dateKey)) {
        groupMap.set(dateKey, []);
      }
      groupMap.get(dateKey)!.push(event);
    });

    // Sort groups chronologically
    const sortedKeys = Array.from(groupMap.keys()).sort();
    sortedKeys.forEach((key) => {
      const groupEvents = groupMap.get(key)!;
      const label =
        key === 'undated'
          ? 'Date TBD'
          : formatMonthYear(groupEvents[0].start_at!);
      groups.push({ key, label, events: groupEvents });
    });

    return groups;
  }, [events]);

  // ── Filter sidebar content (shared between desktop and mobile) ──
  const filterContent = (
    <div className="space-y-6">
      <EventTypeFilters selected={selectedTypes} onToggle={handleTypeToggle} />
      <VenueFilter
        venues={venueNames}
        selected={selectedVenue}
        onChange={handleVenueChange}
      />
      <DateFilter
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={handleDateFromChange}
        onDateToChange={handleDateToChange}
      />
      <ShowPastToggle checked={showPast} onChange={handleShowPastChange} />
      {hasActiveFilters && (
        <button
          onClick={handleClearFilters}
          className="w-full text-sm text-bark hover:text-copper-dark transition-colors font-medium py-2"
        >
          Clear all filters
        </button>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>
          {['Events', info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        <meta
          name="description"
          content={`Upcoming events at ${info?.organization_name || 'the museum'}. Programs, lectures, workshops, and more.`}
        />
        <meta property="og:title" content={`Events | ${info?.organization_name || 'Collection'}`} />
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Page heading */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="font-serif text-4xl font-light text-ink mb-2">Events</h1>
            <p className="text-archive">
              Programs, lectures, workshops, and more at{' '}
              {info?.organization_name || 'the museum'}.
            </p>
          </div>

          {/* Mobile filter toggle */}
          <button
            onClick={() => setMobileFiltersOpen(true)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-ink border border-lichen rounded-lg hover:bg-stone/50 transition-colors"
          >
            <SlidersHorizontal size={16} />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 w-5 h-5 flex items-center justify-center text-xs bg-bark text-parchment rounded-full">
                {selectedTypes.size + (selectedVenue ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (showPast ? 1 : 0)}
              </span>
            )}
          </button>
        </div>

        {/* Active filter pills (mobile + desktop) */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {Array.from(selectedTypes).map((type) => (
              <button
                key={type}
                onClick={() => handleTypeToggle(type)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-bark/10 text-bark rounded-full hover:bg-bark/20 transition-colors"
              >
                {EVENT_TYPE_LABELS[type] || type}
                <X size={12} />
              </button>
            ))}
            {selectedVenue && (
              <button
                onClick={() => handleVenueChange('')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-bark/10 text-bark rounded-full hover:bg-bark/20 transition-colors"
              >
                {selectedVenue}
                <X size={12} />
              </button>
            )}
            {dateFrom && (
              <button
                onClick={() => handleDateFromChange('')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-bark/10 text-bark rounded-full hover:bg-bark/20 transition-colors"
              >
                From: {dateFrom}
                <X size={12} />
              </button>
            )}
            {dateTo && (
              <button
                onClick={() => handleDateToChange('')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-bark/10 text-bark rounded-full hover:bg-bark/20 transition-colors"
              >
                To: {dateTo}
                <X size={12} />
              </button>
            )}
            {showPast && (
              <button
                onClick={() => handleShowPastChange(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-bark/10 text-bark rounded-full hover:bg-bark/20 transition-colors"
              >
                Past events
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {/* Two-column layout: filters + event list */}
        <div className="flex gap-10">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <div className="sticky top-24">{filterContent}</div>
          </aside>

          {/* Events list */}
          <div className="flex-1 min-w-0">
            {/* Loading state */}
            {isLoading && (
              <div className="flex items-center justify-center py-20">
                <MadronaLoader />
              </div>
            )}

            {/* Empty state */}
            {!isLoading && events.length === 0 && (
              <div className="py-16 text-center">
                <CalendarDays className="w-12 h-12 text-archive/30 mx-auto mb-4" />
                <h2 className="text-xl font-medium text-ink mb-2">No events found</h2>
                <p className="text-archive">
                  {hasActiveFilters
                    ? 'No events match your current filters. Try adjusting or clearing them.'
                    : 'Check back soon for upcoming events.'}
                </p>
                {hasActiveFilters && (
                  <button
                    onClick={handleClearFilters}
                    className="mt-4 text-sm font-medium text-bark hover:text-copper-dark transition-colors"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            )}

            {/* Grouped events */}
            {!isLoading && groupedEvents.length > 0 && (
              <div className="space-y-8">
                {groupedEvents.map((group) => (
                  <section key={group.key}>
                    {/* Month header */}
                    <div className="flex items-center gap-3 mb-4">
                      <Calendar size={16} className="text-bark" />
                      <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">
                        {group.label}
                      </h2>
                      <div className="flex-1 h-px bg-lichen" />
                    </div>

                    {/* Event cards */}
                    <div className="divide-y divide-lichen">
                      {group.events.map((event) => (
                        <EventCard
                          key={event.event_id}
                          event={event}
                          orgSlug={orgSlug!}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {/* Load more */}
                {hasMore && (
                  <div className="flex justify-center pt-4 pb-2">
                    <button
                      onClick={handleLoadMore}
                      className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-ink border border-lichen rounded-lg hover:bg-stone/50 hover:border-bark/30 transition-colors"
                    >
                      <ChevronDown size={16} />
                      Load more events
                    </button>
                  </div>
                )}

                {/* Results summary */}
                <p className="text-center text-xs text-archive pt-2">
                  Showing {Math.min(currentOffset + EVENTS_PER_PAGE, totalEvents)} of{' '}
                  {totalEvents} event{totalEvents !== 1 ? 's' : ''}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setMobileFiltersOpen(false)}
          />
          {/* Drawer */}
          <div className="absolute right-0 top-0 bottom-0 w-80 max-w-[85vw] bg-parchment shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-4 border-b border-lichen">
              <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">
                Filters
              </h2>
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="p-1 text-archive hover:text-ink transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">{filterContent}</div>
          </div>
        </div>
      )}
    </CollectionSiteShell>
  );
}
