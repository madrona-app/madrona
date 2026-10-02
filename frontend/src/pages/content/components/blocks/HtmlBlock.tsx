/**
 * HTML Block — Raw HTML editor and renderer.
 */

import { AlertTriangle } from 'lucide-react';
import { sanitizeRichHtml } from '../../../../lib/sanitize';

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

export function HtmlEditor({ content, onChange }: BlockEditorComponentProps) {
  const code = (content.code as string) || '';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg">
        <AlertTriangle size={16} className="text-semantic-warning shrink-0" />
        <p className="text-xs text-semantic-warning">
          Raw HTML is rendered without sanitization. Use caution with user-supplied content.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          HTML Code
        </label>
        <textarea
          value={code}
          onChange={(e) => onChange({ ...content, code: e.target.value })}
          placeholder="<div>Your HTML here...</div>"
          rows={10}
          className="input w-full text-sm font-mono resize-y leading-relaxed"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function HtmlRenderer({ content }: BlockRendererComponentProps) {
  const code = (content.code as string) || '';

  if (!code) {
    return null;
  }

  return (
    <div ref={(el) => { if (el) el.innerHTML = sanitizeRichHtml(code); }} />
  );
}
