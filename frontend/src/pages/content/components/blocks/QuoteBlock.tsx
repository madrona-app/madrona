/**
 * Quote Block — Styled blockquote with attribution.
 */

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

export function QuoteEditor({ content, onChange }: BlockEditorComponentProps) {
  const text = (content.text as string) || '';
  const attribution = (content.attribution as string) || '';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Quote Text <span className="text-semantic-error">*</span>
        </label>
        <textarea
          value={text}
          onChange={(e) => onChange({ ...content, text: e.target.value })}
          placeholder="Enter the quote..."
          rows={4}
          className="input w-full text-sm resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Attribution
        </label>
        <input
          type="text"
          value={attribution}
          onChange={(e) => onChange({ ...content, attribution: e.target.value })}
          placeholder="e.g., John Ruskin, The Stones of Venice"
          className="input w-full text-sm"
        />
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function QuoteRenderer({ content }: BlockRendererComponentProps) {
  const text = (content.text as string) || '';
  const attribution = (content.attribution as string) || '';

  if (!text) {
    return null;
  }

  return (
    <blockquote className="border-l-4 border-bark pl-6 py-2">
      <p className="text-lg italic text-ink leading-relaxed">
        &ldquo;{text}&rdquo;
      </p>
      {attribution && (
        <footer className="mt-3 text-sm text-archive">
          &mdash; {attribution}
        </footer>
      )}
    </blockquote>
  );
}
