/**
 * Sponsor Grid Block — Grid of sponsor logos with optional links.
 */

import { useCallback } from 'react';
import { Plus, Trash2, ChevronDown, GripVertical } from 'lucide-react';
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

interface SponsorLogo {
  media_id: string;
  name: string;
  url: string;
}

const COLUMN_OPTIONS = [2, 3, 4, 6] as const;

// =============================================================================
// Editor
// =============================================================================

export function SponsorGridEditor({ content, onChange }: BlockEditorComponentProps) {
  const heading = (content.heading as string) || '';
  const logos = (content.logos as SponsorLogo[]) || [];
  const columns = (content.columns as number) ?? 4;

  const updateLogo = useCallback(
    (index: number, field: keyof SponsorLogo, value: string) => {
      const updated = logos.map((logo, i) =>
        i === index ? { ...logo, [field]: value } : logo,
      );
      onChange({ ...content, logos: updated });
    },
    [logos, content, onChange],
  );

  const addLogo = useCallback(() => {
    onChange({
      ...content,
      logos: [...logos, { media_id: '', name: '', url: '' }],
    });
  }, [logos, content, onChange]);

  const removeLogo = useCallback(
    (index: number) => {
      onChange({ ...content, logos: logos.filter((_, i) => i !== index) });
    },
    [logos, content, onChange],
  );

  const moveLogo = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= logos.length) return;
      const updated = [...logos];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      onChange({ ...content, logos: updated });
    },
    [logos, content, onChange],
  );

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Heading
        </label>
        <input
          type="text"
          value={heading}
          onChange={(e) => onChange({ ...content, heading: e.target.value })}
          placeholder="e.g., Our Sponsors"
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
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

      {/* Logos */}
      <div>
        <label className="block text-sm font-medium text-ink mb-2">
          Sponsor Logos
        </label>

        {logos.length === 0 && (
          <p className="text-sm text-archive italic">
            No sponsors yet. Add one below.
          </p>
        )}

        <div className="space-y-3">
          {logos.map((logo, index) => (
            <div
              key={index}
              className="border border-lichen rounded-lg p-3 space-y-2 bg-stone"
            >
              <div className="flex items-center gap-2">
                <GripVertical size={14} className="shrink-0 text-archive" />
                <span className="text-xs text-archive font-medium">
                  #{index + 1}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => moveLogo(index, -1)}
                  disabled={index === 0}
                  className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move up"
                >
                  <ChevronDown size={14} className="rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => moveLogo(index, 1)}
                  disabled={index === logos.length - 1}
                  className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move down"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => removeLogo(index)}
                  className="p-1 text-archive hover:text-semantic-error"
                  title="Remove sponsor"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <input
                type="text"
                value={logo.name}
                onChange={(e) => updateLogo(index, 'name', e.target.value)}
                placeholder="Sponsor name"
                className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
              />

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={logo.media_id}
                  onChange={(e) => updateLogo(index, 'media_id', e.target.value)}
                  placeholder="Logo media ID"
                  className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full font-mono"
                />
                <input
                  type="text"
                  value={logo.url}
                  onChange={(e) => updateLogo(index, 'url', e.target.value)}
                  placeholder="Sponsor URL (optional)"
                  className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addLogo}
          className="flex items-center gap-2 px-3 py-2 text-sm text-archive border border-dashed border-lichen rounded-lg hover:border-bark hover:text-bark transition-colors w-full mt-2"
        >
          <Plus size={14} />
          Add Sponsor
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

const GRID_CLASSES: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4',
  6: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6',
};

export function SponsorGridRenderer({ content }: BlockRendererComponentProps) {
  const heading = (content.heading as string) || '';
  const logos = (content.logos as SponsorLogo[]) || [];
  const columns = (content.columns as number) ?? 4;

  if (logos.length === 0) return null;

  const gridCols = GRID_CLASSES[columns] || GRID_CLASSES[4];

  return (
    <div className="space-y-4">
      {heading && (
        <h3 className="text-lg font-semibold text-ink text-center">{heading}</h3>
      )}

      <div className={cn('grid gap-6 items-center', gridCols)}>
        {logos.map((logo, index) => {
          const imgEl = (
            <div className="flex items-center justify-center p-4 h-24">
              {logo.media_id ? (
                <img
                  src={`/api/media/${logo.media_id}/download`}
                  alt={logo.name || 'Sponsor logo'}
                  className="max-h-full max-w-full object-contain opacity-70 hover:opacity-100 transition-opacity"
                  loading="lazy"
                />
              ) : (
                <span className="text-sm text-archive">{logo.name}</span>
              )}
            </div>
          );

          if (logo.url) {
            return (
              <a
                key={index}
                href={logo.url}
                target="_blank"
                rel="noopener noreferrer"
                title={logo.name}
                className="block rounded-lg border border-lichen hover:border-bark/30 transition-colors bg-parchment"
              >
                {imgEl}
              </a>
            );
          }

          return (
            <div
              key={index}
              title={logo.name}
              className="rounded-lg border border-lichen bg-parchment"
            >
              {imgEl}
            </div>
          );
        })}
      </div>
    </div>
  );
}
