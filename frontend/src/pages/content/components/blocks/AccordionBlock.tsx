/**
 * Accordion Block — Expandable FAQ / info sections.
 */

import { useState, useCallback } from 'react';
import { ChevronDown, Plus, Trash2, GripVertical } from 'lucide-react';
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

interface AccordionItem {
  title: string;
  body: string;
}

// =============================================================================
// Editor
// =============================================================================

export function AccordionEditor({ content, onChange }: BlockEditorComponentProps) {
  const items = (content.items as AccordionItem[]) || [];

  const updateItem = useCallback(
    (index: number, field: keyof AccordionItem, value: string) => {
      const updated = items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      );
      onChange({ ...content, items: updated });
    },
    [items, content, onChange],
  );

  const addItem = useCallback(() => {
    onChange({ ...content, items: [...items, { title: '', body: '' }] });
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
        Accordion Items
      </label>

      {items.length === 0 && (
        <p className="text-sm text-archive italic">
          No items yet. Add one below.
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
              title="Remove item"
            >
              <Trash2 size={14} />
            </button>
          </div>

          <input
            type="text"
            value={item.title}
            onChange={(e) => updateItem(index, 'title', e.target.value)}
            placeholder="Section title"
            className="input w-full text-sm"
          />

          <textarea
            value={item.body}
            onChange={(e) => updateItem(index, 'body', e.target.value)}
            placeholder="Section content..."
            rows={3}
            className="input w-full text-sm resize-none"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addItem}
        className="flex items-center gap-2 px-3 py-2 text-sm text-archive border border-dashed border-lichen rounded-lg hover:border-bark hover:text-bark transition-colors w-full"
      >
        <Plus size={14} />
        Add Item
      </button>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function AccordionRenderer({ content }: BlockRendererComponentProps) {
  const items = (content.items as AccordionItem[]) || [];
  const [openIndices, setOpenIndices] = useState<Set<number>>(new Set());

  const toggle = useCallback((index: number) => {
    setOpenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="border border-lichen rounded-lg divide-y divide-lichen overflow-hidden">
      {items.map((item, index) => {
        const isOpen = openIndices.has(index);
        return (
          <div key={index}>
            <button
              type="button"
              onClick={() => toggle(index)}
              className="flex items-center justify-between w-full px-5 py-4 text-left hover:bg-stone/30 transition-colors"
              aria-expanded={isOpen}
            >
              <span className="text-sm font-medium text-ink pr-4">
                {item.title}
              </span>
              <ChevronDown
                size={16}
                className={cn(
                  'shrink-0 text-archive transition-transform duration-200',
                  isOpen && 'rotate-180',
                )}
              />
            </button>
            {isOpen && (
              <div className="px-5 pb-4 text-sm text-ink/80 leading-relaxed whitespace-pre-wrap">
                {item.body}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
