/**
 * Event List Block — Show upcoming public events.
 *
 * Editor: configure limit, event types, show_past.
 * Renderer: fetches from public events API and renders a list.
 */

import Checkbox from '../../../../components/Checkbox';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Calendar, MapPin, ExternalLink } from 'lucide-react';
import { getPublicEvents } from '../../../../lib/api/discover';
import { cn } from '../../../../lib/utils';
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

const EVENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'program', label: 'Program' },
  { value: 'opening_reception', label: 'Opening Reception' },
  { value: 'teaching_session', label: 'Teaching Session' },
  { value: 'donor_development', label: 'Donor Event' },
];

// =============================================================================
// Helpers
// =============================================================================

function formatEventDate(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatEventTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const result = formatTime(dateStr);
  return result === '\u2014' ? '' : result;
}

// =============================================================================
// Editor
// =============================================================================

export function EventListEditor({ content, onChange }: BlockEditorComponentProps) {
  const limit = (content.limit as number) ?? 5;
  const eventTypes = (content.event_types as string[]) || [];
  const showPast = (content.show_past as boolean) ?? false;

  const toggleEventType = (type: string) => {
    if (!type) {
      onChange({ ...content, event_types: [] });
      return;
    }
    const updated = eventTypes.includes(type)
      ? eventTypes.filter((t) => t !== type)
      : [...eventTypes, type];
    onChange({ ...content, event_types: updated });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Max Events
        </label>
        <input
          type="number"
          min={1}
          max={50}
          value={limit}
          onChange={(e) =>
            onChange({ ...content, limit: Math.max(1, Math.min(50, parseInt(e.target.value) || 5)) })
          }
          className="input w-32 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Event Types
        </label>
        <div className="flex flex-wrap gap-2">
          {EVENT_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => toggleEventType(type.value)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                (type.value === '' && eventTypes.length === 0) ||
                  eventTypes.includes(type.value)
                  ? 'border-bark bg-bark/10 text-bark'
                  : 'border-lichen text-archive hover:border-bark hover:text-bark',
              )}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
        <Checkbox
          checked={showPast}
          onChange={(e) => onChange({ ...content, show_past: e.target.checked })}
        />
        Include past events
      </label>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function EventListRenderer({ content }: BlockRendererComponentProps) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const limit = (content.limit as number) ?? 5;
  const eventTypes = (content.event_types as string[]) || [];
  const showPast = (content.show_past as boolean) ?? false;

  // Use first event type filter if specified (API takes single type)
  const eventType = eventTypes.length > 0 ? eventTypes[0] : undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ['event-list-block', orgSlug, limit, eventType, showPast],
    queryFn: () =>
      getPublicEvents(orgSlug!, {
        limit,
        event_type: eventType,
        show_past: showPast,
      }),
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

  return (
    <div className="divide-y divide-lichen border border-lichen rounded-lg overflow-hidden">
      {data.data.map((event) => (
        <div key={event.event_id} className="p-5 hover:bg-stone/20 transition-colors">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
              <h4 className="text-base font-medium text-ink">{event.title}</h4>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-archive">
                {event.start_at && (
                  <span className="flex items-center gap-1.5">
                    <Calendar size={13} className="shrink-0" />
                    {formatEventDate(event.start_at)}
                    {' at '}
                    {formatEventTime(event.start_at)}
                    {event.end_at && ` – ${formatEventTime(event.end_at)}`}
                  </span>
                )}
                {event.location_name && (
                  <span className="flex items-center gap-1.5">
                    <MapPin size={13} className="shrink-0" />
                    {event.location_name}
                  </span>
                )}
              </div>

              {event.description && (
                <p className="text-sm text-ink/80 line-clamp-2">{event.description}</p>
              )}
            </div>

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
        </div>
      ))}
    </div>
  );
}
