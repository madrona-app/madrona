/**
 * Exhibition Preview Block — Show a public exhibition with details.
 *
 * Editor: enter exhibition slug, toggle dates/description.
 * Renderer: fetches from public Gallery API and renders a preview card.
 */

import Checkbox from '../../../../components/Checkbox';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Calendar } from 'lucide-react';
import { getPublicExhibition } from '../../../../lib/api/exhibit';
import { cn } from '../../../../lib/utils';
import { formatDateLong } from '@/lib/formatters';

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
// Helpers
// =============================================================================

function formatDateRange(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (d: string) => {
    const result = formatDateLong(d);
    return result === '\u2014' ? d : result;
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `Opens ${fmt(start)}`;
  return `Through ${fmt(end!)}`;
}

// =============================================================================
// Editor
// =============================================================================

export function ExhibitionPreviewEditor({ content, onChange }: BlockEditorComponentProps) {
  const exhibitionSlug = (content.exhibition_slug as string) || '';
  const showDates = (content.show_dates as boolean) ?? true;
  const showDescription = (content.show_description as boolean) ?? true;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Exhibition URL Slug <span className="text-semantic-error">*</span>
        </label>
        <input
          type="text"
          value={exhibitionSlug}
          onChange={(e) => onChange({ ...content, exhibition_slug: e.target.value })}
          placeholder="e.g., impressionism-today"
          className="input w-full text-sm"
        />
        <p className="text-xs text-archive mt-1">
          The public URL slug of the exhibition. The exhibition must be published with a public gallery.
        </p>
      </div>

      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <Checkbox
            checked={showDates}
            onChange={(e) => onChange({ ...content, show_dates: e.target.checked })}
          />
          Show Dates
        </label>
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <Checkbox
            checked={showDescription}
            onChange={(e) => onChange({ ...content, show_description: e.target.checked })}
          />
          Show Description
        </label>
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function ExhibitionPreviewRenderer({ content }: BlockRendererComponentProps) {
  const exhibitionSlug = (content.exhibition_slug as string) || '';
  const showDates = (content.show_dates as boolean) ?? true;
  const showDescription = (content.show_description as boolean) ?? true;

  const { data: exhibition, isLoading, error } = useQuery({
    queryKey: ['exhibition-preview-block', exhibitionSlug],
    queryFn: () => getPublicExhibition(exhibitionSlug),
    enabled: !!exhibitionSlug,
    staleTime: 60_000,
  });

  if (!exhibitionSlug) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-archive" />
      </div>
    );
  }

  if (error || !exhibition) {
    return (
      <div className="text-center py-8 text-archive text-sm">
        Exhibition not found or not available.
      </div>
    );
  }

  const dateRange = formatDateRange(
    exhibition.actual_start_date || exhibition.planned_start_date,
    exhibition.actual_end_date || exhibition.planned_end_date,
  );

  return (
    <Link
      to={`/gallery/${exhibitionSlug}`}
      className={cn(
        'group block rounded-lg border border-lichen overflow-hidden',
        'hover:border-bark/30 transition-colors',
      )}
    >
      <div className="p-6 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-bark mb-1">
              Exhibition
            </p>
            <h3 className="text-xl font-medium text-ink group-hover:text-bark transition-colors">
              {exhibition.title}
            </h3>
          </div>
        </div>

        {showDates && dateRange && (
          <div className="flex items-center gap-2 text-sm text-archive">
            <Calendar size={14} className="shrink-0" />
            <span>{dateRange}</span>
          </div>
        )}

        {exhibition.venue_name && (
          <p className="text-sm text-archive">{exhibition.venue_name}</p>
        )}

        {showDescription && exhibition.description && (
          <p className="text-sm text-ink/80 leading-relaxed line-clamp-3">
            {exhibition.description}
          </p>
        )}

        <span className="inline-block text-xs text-bark group-hover:text-copper-dark transition-colors">
          View exhibition &rarr;
        </span>
      </div>
    </Link>
  );
}
