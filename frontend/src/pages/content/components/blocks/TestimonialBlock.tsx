/**
 * Testimonial Block — Quotes/testimonials with attribution and optional logos.
 */

import { useCallback } from 'react';
import { Plus, Trash2, ChevronDown, GripVertical, Quote } from 'lucide-react';

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

interface TestimonialItem {
  quote: string;
  attribution: string;
  source_url: string;
  logo_media_id: string;
}

// =============================================================================
// Editor
// =============================================================================

export function TestimonialEditor({ content, onChange }: BlockEditorComponentProps) {
  const items = (content.items as TestimonialItem[]) || [];

  const updateItem = useCallback(
    (index: number, field: keyof TestimonialItem, value: string) => {
      const updated = items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      );
      onChange({ ...content, items: updated });
    },
    [items, content, onChange],
  );

  const addItem = useCallback(() => {
    onChange({
      ...content,
      items: [...items, { quote: '', attribution: '', source_url: '', logo_media_id: '' }],
    });
  }, [items, content, onChange]);

  const removeItem = useCallback(
    (index: number) => {
      onChange({ ...content, items: items.filter((_, i) => i !== index) });
    },
    [items, content, onChange],
  );

  const moveItem = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return;
      const updated = [...items];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      onChange({ ...content, items: updated });
    },
    [items, content, onChange],
  );

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-ink">
        Testimonials
      </label>

      {items.length === 0 && (
        <p className="text-sm text-archive italic">
          No testimonials yet. Add one below.
        </p>
      )}

      {items.map((item, index) => (
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
              onClick={() => moveItem(index, -1)}
              disabled={index === 0}
              className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move up"
            >
              <ChevronDown size={14} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => moveItem(index, 1)}
              disabled={index === items.length - 1}
              className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move down"
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="p-1 text-archive hover:text-semantic-error"
              title="Remove testimonial"
            >
              <Trash2 size={14} />
            </button>
          </div>

          <textarea
            value={item.quote}
            onChange={(e) => updateItem(index, 'quote', e.target.value)}
            placeholder="Testimonial quote..."
            rows={3}
            className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full resize-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={item.attribution}
              onChange={(e) => updateItem(index, 'attribution', e.target.value)}
              placeholder="Attribution (e.g., Jane Doe, Donor)"
              className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
            />
            <input
              type="text"
              value={item.source_url}
              onChange={(e) => updateItem(index, 'source_url', e.target.value)}
              placeholder="Source URL (optional)"
              className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
            />
          </div>

          <input
            type="text"
            value={item.logo_media_id}
            onChange={(e) => updateItem(index, 'logo_media_id', e.target.value)}
            placeholder="Logo media ID (optional)"
            className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full font-mono"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addItem}
        className="flex items-center gap-2 px-3 py-2 text-sm text-archive border border-dashed border-lichen rounded-lg hover:border-bark hover:text-bark transition-colors w-full"
      >
        <Plus size={14} />
        Add Testimonial
      </button>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function TestimonialRenderer({ content }: BlockRendererComponentProps) {
  const items = (content.items as TestimonialItem[]) || [];

  if (items.length === 0) return null;

  return (
    <div className="space-y-6">
      {items.map((item, index) => (
        <div
          key={index}
          className="relative rounded-lg border border-lichen bg-stone/20 p-6"
        >
          <Quote size={24} className="absolute top-4 left-4 text-bark/20" />

          <div className="flex items-start gap-4">
            {item.logo_media_id && (
              <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-parchment border border-lichen">
                <img
                  src={`/api/media/${item.logo_media_id}/thumbnail?size=128`}
                  alt=""
                  className="w-full h-full object-contain p-1"
                  loading="lazy"
                />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <blockquote className="text-base italic text-ink leading-relaxed pl-6">
                &ldquo;{item.quote}&rdquo;
              </blockquote>

              {item.attribution && (
                <footer className="mt-3 pl-6 text-sm text-archive">
                  &mdash;{' '}
                  {item.source_url ? (
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-bark hover:text-copper-dark transition-colors"
                    >
                      {item.attribution}
                    </a>
                  ) : (
                    item.attribution
                  )}
                </footer>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
