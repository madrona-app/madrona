/**
 * Collection Grid Block — Embedded collection search grid.
 *
 * Editor: configure search filters, limit, columns, show_facets.
 * Renderer: fetches from Discover search API and renders a mini object grid.
 */

import { useState, useCallback } from 'react';
import Checkbox from '../../../../components/Checkbox';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { searchDiscoverObjects } from '../../../../lib/api/discover';
import type { DiscoverSearchParams } from '../../../../types/discover';
import { cn } from '../../../../lib/utils';

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

interface Filters {
  object_type?: string;
  classification?: string;
  creator?: string;
  material?: string;
  technique?: string;
  subject?: string;
  style_period?: string;
  creation_place?: string;
  on_display?: boolean;
  has_image?: boolean;
}

const FILTER_FIELDS: { key: keyof Filters; label: string; type: 'text' | 'boolean' }[] = [
  { key: 'object_type', label: 'Object Type', type: 'text' },
  { key: 'classification', label: 'Classification', type: 'text' },
  { key: 'creator', label: 'Creator', type: 'text' },
  { key: 'material', label: 'Material', type: 'text' },
  { key: 'technique', label: 'Technique', type: 'text' },
  { key: 'subject', label: 'Subject', type: 'text' },
  { key: 'style_period', label: 'Style / Period', type: 'text' },
  { key: 'creation_place', label: 'Place of Creation', type: 'text' },
  { key: 'on_display', label: 'On Display Only', type: 'boolean' },
  { key: 'has_image', label: 'Has Image Only', type: 'boolean' },
];

const COLUMN_OPTIONS = [2, 3, 4] as const;

// =============================================================================
// Editor
// =============================================================================

export function CollectionGridEditor({ content, onChange }: BlockEditorComponentProps) {
  const filters = (content.filters as Filters) || {};
  const limit = (content.limit as number) ?? 12;
  const columns = (content.columns as number) ?? 3;
  const showFacets = (content.show_facets as boolean) ?? false;

  const updateFilter = useCallback(
    (key: keyof Filters, value: string | boolean) => {
      const updatedFilters = { ...filters };
      if (value === '' || value === false) {
        delete updatedFilters[key];
      } else {
        (updatedFilters as Record<string, unknown>)[key] = value;
      }
      onChange({ ...content, filters: updatedFilters });
    },
    [filters, content, onChange],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-archive">
        Configure which collection objects to show. Leave filters empty to show all discoverable objects.
      </p>

      {/* Text filters */}
      <div className="grid grid-cols-2 gap-3">
        {FILTER_FIELDS.filter((f) => f.type === 'text').map((field) => (
          <div key={field.key}>
            <label className="block text-sm font-medium text-ink mb-1">
              {field.label}
            </label>
            <input
              type="text"
              value={(filters[field.key] as string) || ''}
              onChange={(e) => updateFilter(field.key, e.target.value)}
              placeholder={`Filter by ${field.label.toLowerCase()}...`}
              className="input w-full text-sm"
            />
          </div>
        ))}
      </div>

      {/* Boolean filters */}
      <div className="flex gap-4">
        {FILTER_FIELDS.filter((f) => f.type === 'boolean').map((field) => (
          <label key={field.key} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <Checkbox
              checked={(filters[field.key] as boolean) || false}
              onChange={(e) => updateFilter(field.key, e.target.checked)}
            />
            {field.label}
          </label>
        ))}
      </div>

      {/* Display settings */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Max Objects
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) =>
              onChange({ ...content, limit: Math.max(1, Math.min(100, parseInt(e.target.value) || 12)) })
            }
            className="input w-full text-sm"
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
        <div>
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer mt-6">
            <Checkbox
              checked={showFacets}
              onChange={(e) => onChange({ ...content, show_facets: e.target.checked })}
            />
            Show Facets
          </label>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function CollectionGridRenderer({ content }: BlockRendererComponentProps) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const filters = (content.filters as Filters) || {};
  const limit = (content.limit as number) ?? 12;
  const columns = (content.columns as number) ?? 3;

  // Build search params from filters
  const searchParams: DiscoverSearchParams = {
    limit,
    has_image: filters.has_image,
    on_display: filters.on_display,
    creator: filters.creator,
    material: filters.material,
    technique: filters.technique,
    subject: filters.subject,
    creation_place: filters.creation_place,
    include_facets: false,
  };
  if (filters.object_type) searchParams.object_type = [filters.object_type];
  if (filters.classification) searchParams.classification = [filters.classification];
  if (filters.style_period) searchParams.style_period = [filters.style_period];

  const [page, setPage] = useState(0);
  searchParams.offset = page * limit;

  const { data, isLoading, error } = useQuery({
    queryKey: ['collection-grid-block', orgSlug, filters, limit, page],
    queryFn: () => searchDiscoverObjects(orgSlug!, searchParams),
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

  if (error || !data || data.hits.length === 0) {
    return (
      <div className="text-center py-8 text-archive text-sm">
        No collection objects found.
      </div>
    );
  }

  const gridCols =
    columns === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : columns === 4
        ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
        : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3';

  const totalPages = Math.ceil(data.total / limit);

  return (
    <div className="space-y-4">
      <div className={cn('grid gap-4', gridCols)}>
        {data.hits.map((hit) => (
          <Link
            key={hit.object_id}
            to={`/c/${orgSlug}/objects/${hit.object_id}`}
            className="group block overflow-hidden rounded-lg border border-lichen hover:border-bark/30 transition-colors"
          >
            {hit.thumbnail_url ? (
              <div className="aspect-square bg-stone overflow-hidden">
                <img
                  src={hit.thumbnail_url}
                  alt={hit.title || 'Collection object'}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="aspect-square bg-stone flex items-center justify-center">
                <span className="text-archive/40 text-xs">No image</span>
              </div>
            )}
            <div className="p-3">
              <p className="text-sm font-medium text-ink line-clamp-2 group-hover:text-bark transition-colors">
                {hit.title || 'Untitled'}
              </p>
              {hit.creators.length > 0 && (
                <p className="text-xs text-archive mt-1 line-clamp-1">
                  {hit.creators.join(', ')}
                </p>
              )}
              {hit.creation_date_display && (
                <p className="text-xs text-archive mt-0.5">
                  {hit.creation_date_display}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-sm border border-lichen rounded-lg disabled:opacity-30 hover:border-bark transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-archive">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 text-sm border border-lichen rounded-lg disabled:opacity-30 hover:border-bark transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
