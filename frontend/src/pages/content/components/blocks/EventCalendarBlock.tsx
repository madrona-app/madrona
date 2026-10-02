/**
 * Event Calendar Block — Calendar/list of events with filters.
 *
 * Editor: configure venue, type, and limit.
 * Renderer: fetches from public events API and renders grouped event list.
 */

import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Calendar, MapPin, ExternalLink } from 'lucide-react';
import { apiFetch, buildQueryString } from '../../../../lib/api/_utils';
import { formatTime } from '@/lib/formatters';

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

export function EventCalendarEditor({ content, onChange }: BlockEditorComponentProps) {
  const venueFilter = (content.venue_filter as string) || '';
  const typeFilter = (content.type_filter as string) || '';
  const limit = (content.limit as number) ?? 10;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Venue Filter
        </label>
        <input
          type="text"
          value={venueFilter}
          onChange={(e) => onChange({ ...content, venue_filter: e.target.value })}
          placeholder="Venue slug (leave empty for all venues)"
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
        <p className="text-xs text-archive mt-1">
          Filter events to a specific venue, or leave empty to show all.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Type Filter
        </label>
        <input
          type="text"
          value={typeFilter}
          onChange={(e) => onChange({ ...content, type_filter: e.target.value })}
          placeholder="e.g., program, opening_reception (leave empty for all)"
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
        <p className="text-xs text-archive mt-1">
          Filter by event type, or leave empty to show all types.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Max Events
        </label>
        <input
          type="number"
          min={1}
          max={100}
          value={limit}
          onChange={(e) =>
            onChange({ ...content, limit: Math.max(1, Math.min(100, parseInt(e.target.value) || 10)) })
          }
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-32"
        />
      </div>
    </div>
  );
}

// =============================================================================
// API helper
// =============================================================================

interface EventCalendarItem {
  event_id: string;
  title: string;
  slug: string | null;
  event_type: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  description: string | null;
  short_description: string | null;
  location_name: string | null;
  venue_name: string | null;
  registration_url: string | null;
  price: string | null;
  hero_image_url: string | null;
}

async function fetchPublicEvents(
  orgSlug: string,
  params: { limit?: number; type?: string; venue?: string },
): Promise<{ data: EventCalendarItem[]; total: number }> {
  const query = buildQueryString(params);
  return await apiFetch(`/discover/${orgSlug}/events${query}`, { skipAuth: true });
}

// =============================================================================
// Helpers
// =============================================================================

function formatEventTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const result = formatTime(dateStr);
  return result === '\u2014' ? '' : result;
}

// =============================================================================
// Renderer
// =============================================================================

export function EventCalendarRenderer({ content }: BlockRendererComponentProps) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const venueFilter = (content.venue_filter as string) || '';
  const typeFilter = (content.type_filter as string) || '';
  const limit = (content.limit as number) ?? 10;

  const params: Record<string, unknown> = { limit };
  if (venueFilter) params.venue = venueFilter;
  if (typeFilter) params.type = typeFilter;

  const { data, isLoading, error } = useQuery({
    queryKey: ['event-calendar-block', orgSlug, venueFilter, typeFilter, limit],
    queryFn: () => fetchPublicEvents(orgSlug!, params as { limit?: number; type?: string; venue?: string }),
    enabled: !!orgSlug,
    staleTime: 60_000,
  });

  if (!orgSlug) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-archive" />
      </div>
    );
  }

  if (error || !data || data.data.length === 0) {
    return (
      <div className="text-center py-8 text-archive text-sm">
        No upcoming events.
      </div>
    );
  }

  // Group events by date
  const grouped = new Map<string, EventCalendarItem[]>();
  for (const event of data.data) {
    const dateKey = event.start_at
      ? new Date(event.start_at).toISOString().split('T')[0]
      : 'no-date';
    const group = grouped.get(dateKey) || [];
    group.push(event);
    grouped.set(dateKey, group);
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([dateKey, events]) => (
        <div key={dateKey}>
          {/* Date header */}
          <div className="flex items-center gap-3 mb-3">
            <Calendar size={16} className="text-bark shrink-0" />
            <h4 className="text-sm font-semibold text-ink uppercase tracking-wider">
              {dateKey !== 'no-date'
                ? new Date(dateKey + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'Date TBD'}
            </h4>
            <div className="flex-1 border-t border-lichen" />
          </div>

          {/* Event rows */}
          <div className="space-y-3">
            {events.map((event) => (
              <div
                key={event.event_id}
                className="flex items-start gap-4 p-4 rounded-lg border border-lichen hover:border-bark/30 transition-colors"
              >
                {/* Time column */}
                <div className="shrink-0 w-20 text-center">
                  {event.start_at && (
                    <p className="text-sm font-medium text-ink">
                      {formatEventTime(event.start_at)}
                    </p>
                  )}
                  {event.end_at && (
                    <p className="text-xs text-archive">
                      to {formatEventTime(event.end_at)}
                    </p>
                  )}
                </div>

                {/* Details */}
                <div className="min-w-0 flex-1 space-y-1">
                  <h5 className="text-base font-medium text-ink">{event.title}</h5>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-archive">
                    {event.location_name && (
                      <span className="flex items-center gap-1">
                        <MapPin size={11} className="shrink-0" />
                        {event.location_name}
                      </span>
                    )}
                    {event.venue_name && !event.location_name && (
                      <span className="flex items-center gap-1">
                        <MapPin size={11} className="shrink-0" />
                        {event.venue_name}
                      </span>
                    )}
                    {event.price && (
                      <span>{event.price}</span>
                    )}
                    {event.event_type && (
                      <span className="rounded-full bg-bark/10 text-bark px-2 py-0.5 text-xs">
                        {event.event_type.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>

                  {(event.short_description || event.description) && (
                    <p className="text-sm text-ink/80 line-clamp-2">
                      {event.short_description || event.description}
                    </p>
                  )}
                </div>

                {/* Register CTA */}
                {event.registration_url && (
                  <a
                    href={event.registration_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-bark border border-bark rounded-lg hover:bg-bark hover:text-parchment transition-colors"
                  >
                    Register
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
