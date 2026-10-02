/**
 * Divider Block — Visual separator with multiple styles.
 */

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

type DividerStyle = 'line' | 'space' | 'dots';

const STYLE_OPTIONS: { value: DividerStyle; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'space', label: 'Space' },
  { value: 'dots', label: 'Dots' },
];

// =============================================================================
// Editor
// =============================================================================

export function DividerEditor({ content, onChange }: BlockEditorComponentProps) {
  const style = (content.style as DividerStyle) || 'line';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Style
        </label>
        <div className="flex gap-2">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...content, style: opt.value })}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                style === opt.value
                  ? 'border-bark bg-bark/10 text-bark'
                  : 'border-lichen text-archive hover:border-bark hover:text-bark',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="pt-2">
        <p className="text-xs text-archive mb-2">Preview:</p>
        <DividerRenderer content={content} />
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function DividerRenderer({ content }: BlockRendererComponentProps) {
  const style = (content.style as DividerStyle) || 'line';

  if (style === 'space') {
    return <div className="py-6" aria-hidden="true" />;
  }

  if (style === 'dots') {
    return (
      <div className="flex items-center justify-center gap-3 py-6" aria-hidden="true">
        <span className="w-1.5 h-1.5 rounded-full bg-archive/40" />
        <span className="w-1.5 h-1.5 rounded-full bg-archive/40" />
        <span className="w-1.5 h-1.5 rounded-full bg-archive/40" />
      </div>
    );
  }

  // Default: line
  return <hr className="border-t border-lichen my-6" />;
}
