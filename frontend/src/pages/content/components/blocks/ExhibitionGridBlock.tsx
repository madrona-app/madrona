/**
 * Exhibition Grid Block — Grid of exhibitions with venue/status filters.
 *
 * Editor: configure venue, status, limit, columns.
 * Renderer: fetches from public exhibitions API and renders a grid.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Calendar } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { apiFetch, buildQueryString } from '../../../../lib/api/_utils';
import { formatDateShort } from '@/lib/formatters';

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

type StatusFilter = 'open' | 'upcoming' | 'past';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

const COLUMN_OPTIONS = [2, 3, 4] as const;

// =============================================================================
// Editor
// =============================================================================

export function ExhibitionGridEditor({ content, onChange }: BlockEditorComponentProps) {
  const venueFilter = (content.venue_filter as string) || '';
  const statusFilter = (content.status_filter as StatusFilter) || 'open';
  const limit = (content.limit as number) ?? 6;
  const columns = (content.columns as number) ?? 3;

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
          Filter exhibitions to a specific venue, or leave empty to show all.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Status
        </label>
        <select
          value={statusFilter}
          onChange={(e) => onChange({ ...content, status_filter: e.target.value })}
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Max Exhibitions
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={limit}
            onChange={(e) =>
              onChange({ ...content, limit: Math.max(1, Math.min(50, parseInt(e.target.value) || 6)) })
            }
            className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-32"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Columns
          </label>
          <div className="flex gap-2">
            {COLUMN_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ ...content, columns: n })}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                  columns === n
                    ? 'border-bark bg-bark/10 text-bark'
                    : 'border-lichen text-archive hover:border-bark hover:text-bark',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// API helper
// =============================================================================

interface ExhibitionListItem {
  exhibition_id: string;
  title: string;
  subtitle: string | null;
  public_url_slug: string | null;
  status: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  short_description: string | null;
  venue_name: string | null;
  thumbnail_url: string | null;
}

async function fetchPublicExhibitions(
  orgSlug: string,
  params: { limit?: number; status?: string; venue?: string },
): Promise<{ data: ExhibitionListItem[]; total: number }> {
  const query = buildQueryString(params);
  return await apiFetch(`/discover/${orgSlug}/exhibitions${query}`, { skipAuth: true });
}

// =============================================================================
// Helpers
// =============================================================================

function formatDateRange(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (d: string) => {
    const result = formatDateShort(d);
    return result === '\u2014' ? d : result;
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `Opens ${fmt(start)}`;
  return `Through ${fmt(end!)}`;
}

// =============================================================================
// Renderer
// =============================================================================

export function ExhibitionGridRenderer({ content }: BlockRendererComponentProps) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const venueFilter = (content.venue_filter as string) || '';
  const statusFilter = (content.status_filter as string) || 'open';
  const limit = (content.limit as number) ?? 6;
  const columns = (content.columns as number) ?? 3;

  const params: Record<string, unknown> = { limit, status: statusFilter };
  if (venueFilter) params.venue = venueFilter;

  const { data, isLoading, error } = useQuery({
    queryKey: ['exhibition-grid-block', orgSlug, venueFilter, statusFilter, limit],
    queryFn: () => fetchPublicExhibitions(orgSlug!, params as { limit?: number; status?: string; venue?: string }),
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
        No exhibitions found.
      </div>
    );
  }

  const gridCols =
    columns === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : columns === 4
        ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
        : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3';

  return (
    <div className={cn('grid gap-5', gridCols)}>
      {data.data.map((ex) => {
        const dateRange = formatDateRange(
          ex.actual_start_date || ex.planned_start_date,
          ex.actual_end_date || ex.planned_end_date,
        );

        return (
          <Link
            key={ex.exhibition_id}
            to={ex.public_url_slug ? `/c/${orgSlug}/exhibitions/${ex.public_url_slug}` : '#'}
            className="group block rounded-lg border border-lichen overflow-hidden hover:border-bark/30 transition-colors"
          >
            {ex.thumbnail_url ? (
              <div className="aspect-[4/3] bg-stone overflow-hidden">
                <img
                  src={ex.thumbnail_url}
                  alt={ex.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="aspect-[4/3] bg-stone flex items-center justify-center">
                <span className="text-archive/40 text-xs">No image</span>
              </div>
            )}

            <div className="p-4 space-y-2">
              <h4 className="text-base font-medium text-ink line-clamp-2 group-hover:text-bark transition-colors">
                {ex.title}
              </h4>

              {dateRange && (
                <div className="flex items-center gap-1.5 text-xs text-archive">
                  <Calendar size={12} className="shrink-0" />
                  <span>{dateRange}</span>
                </div>
              )}

              {ex.venue_name && (
                <p className="text-xs text-archive">{ex.venue_name}</p>
              )}

              {ex.short_description && (
                <p className="text-sm text-ink/80 line-clamp-2">{ex.short_description}</p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
