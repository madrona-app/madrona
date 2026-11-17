/**
 * Object Spotlight Block — Feature a single collection object.
 *
 * Editor: enter object ID, toggle description/creator, choose layout.
 * Renderer: fetches object detail from Discover API and renders a spotlight card.
 */

import { useId } from 'react';
import Checkbox from '../../../../components/Checkbox';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { getDiscoverObject } from '../../../../lib/api/discover';
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

type SpotlightLayout = 'horizontal' | 'vertical';

// =============================================================================
// Editor
// =============================================================================

export function ObjectSpotlightEditor({ content, onChange }: BlockEditorComponentProps) {
  const fieldId = useId();
  const objectId = (content.object_id as string) || '';
  const showDescription = (content.show_description as boolean) ?? true;
  const showCreator = (content.show_creator as boolean) ?? true;
  const layout = (content.layout as SpotlightLayout) || 'horizontal';

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${fieldId}-object-id`} className="block text-sm font-medium text-ink mb-1">
          Object ID <span className="text-semantic-error">*</span>
        </label>
        <input id={`${fieldId}-object-id`}
          type="text"
          value={objectId}
          onChange={(e) => onChange({ ...content, object_id: e.target.value })}
          placeholder="Enter the collection object ID (UUID)"
          className="input w-full text-sm"
        />
        <p className="text-xs text-archive mt-1">
          The object must be discoverable (published to your public site).
        </p>
      </div>

      <div>
        <span id={`${fieldId}-layout-group`} className="block text-sm font-medium text-ink mb-1">
          Layout
        </span>
        <div role="group" aria-labelledby={`${fieldId}-layout-group`} className="flex gap-2">
          {(['horizontal', 'vertical'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              aria-pressed={layout === opt}
              onClick={() => onChange({ ...content, layout: opt })}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border capitalize transition-colors',
                layout === opt
                  ? 'border-bark bg-bark/10 text-bark'
                  : 'border-lichen text-archive hover:border-bark hover:text-bark',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        <label htmlFor={`${fieldId}-show-description`} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <Checkbox id={`${fieldId}-show-description`}
            checked={showDescription}
            onChange={(e) => onChange({ ...content, show_description: e.target.checked })}
          />
          Show Description
        </label>
        <label htmlFor={`${fieldId}-show-creator`} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <Checkbox id={`${fieldId}-show-creator`}
            checked={showCreator}
            onChange={(e) => onChange({ ...content, show_creator: e.target.checked })}
          />
          Show Creator
        </label>
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function ObjectSpotlightRenderer({ content }: BlockRendererComponentProps) {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const objectId = (content.object_id as string) || '';
  const showDescription = (content.show_description as boolean) ?? true;
  const showCreator = (content.show_creator as boolean) ?? true;
  const layout = (content.layout as SpotlightLayout) || 'horizontal';

  const { data: object, isLoading, error } = useQuery({
    queryKey: ['object-spotlight-block', orgSlug, objectId],
    queryFn: () => getDiscoverObject(orgSlug!, objectId),
    enabled: !!orgSlug && !!objectId,
    staleTime: 60_000,
  });

  if (!objectId || !orgSlug) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-archive" />
      </div>
    );
  }

  if (error || !object) {
    return (
      <div className="text-center py-8 text-archive text-sm">
        Object not found or not available.
      </div>
    );
  }

  const imageUrl = (object.media.find((m) => m.is_primary) ?? object.media[0])?.url;

  if (layout === 'vertical') {
    return (
      <Link
        to={`/c/${orgSlug}/objects/${objectId}`}
        className="block group rounded-lg overflow-hidden border border-lichen hover:border-bark/30 transition-colors"
      >
        {imageUrl && (
          <div className="aspect-[4/3] overflow-hidden bg-stone">
            <img
              src={imageUrl}
              alt={object.title || 'Collection object'}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        )}
        <div className="p-6 space-y-2">
          <h3 className="text-xl font-medium text-ink group-hover:text-bark transition-colors">
            {object.title || 'Untitled'}
          </h3>
          {showCreator && object.creators && object.creators.length > 0 && (
            <p className="text-sm text-archive">{object.creators.join(', ')}</p>
          )}
          {object.creation_date_display && (
            <p className="text-sm text-archive">{object.creation_date_display}</p>
          )}
          {showDescription && object.brief_description && (
            <p className="text-sm text-ink/80 leading-relaxed line-clamp-4">
              {object.brief_description}
            </p>
          )}
        </div>
      </Link>
    );
  }

  // Horizontal layout (default)
  return (
    <Link
      to={`/c/${orgSlug}/objects/${objectId}`}
      className="group flex gap-6 rounded-lg overflow-hidden border border-lichen hover:border-bark/30 transition-colors p-4"
    >
      {imageUrl && (
        <div className="shrink-0 w-48 h-48 rounded-lg overflow-hidden bg-stone">
          <img
            src={imageUrl}
            alt={object.title || 'Collection object'}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </div>
      )}
      <div className="min-w-0 space-y-2 py-1">
        <h3 className="text-xl font-medium text-ink group-hover:text-bark transition-colors">
          {object.title || 'Untitled'}
        </h3>
        {showCreator && object.creators && object.creators.length > 0 && (
          <p className="text-sm text-archive">{object.creators.join(', ')}</p>
        )}
        {object.creation_date_display && (
          <p className="text-sm text-archive">{object.creation_date_display}</p>
        )}
        {showDescription && object.brief_description && (
          <p className="text-sm text-ink/80 leading-relaxed line-clamp-4">
            {object.brief_description}
          </p>
        )}
        <span className="inline-block text-xs text-bark group-hover:text-copper-dark transition-colors mt-2">
          View object &rarr;
        </span>
      </div>
    </Link>
  );
}
