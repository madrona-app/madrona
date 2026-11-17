/**
 * Call To Action Block — Prominent CTA card with heading, text, and button.
 */

import { useId } from 'react';
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

type CTAStyle = 'primary' | 'secondary';

const STYLE_OPTIONS: { value: CTAStyle; label: string }[] = [
  { value: 'primary', label: 'Primary (filled)' },
  { value: 'secondary', label: 'Secondary (outlined)' },
];

// =============================================================================
// Editor
// =============================================================================

export function CallToActionEditor({ content, onChange }: BlockEditorComponentProps) {
  const fieldId = useId();
  const heading = (content.heading as string) || '';
  const text = (content.text as string) || '';
  const buttonText = (content.button_text as string) || '';
  const buttonUrl = (content.button_url as string) || '';
  const style = (content.style as CTAStyle) || 'primary';

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${fieldId}-heading`} className="block text-sm font-medium text-ink mb-1">
          Heading <span className="text-semantic-error">*</span>
        </label>
        <input id={`${fieldId}-heading`}
          type="text"
          value={heading}
          onChange={(e) => onChange({ ...content, heading: e.target.value })}
          placeholder="Call to action heading"
          className="input w-full text-sm"
        />
      </div>

      <div>
        <label htmlFor={`${fieldId}-text`} className="block text-sm font-medium text-ink mb-1">
          Text
        </label>
        <textarea id={`${fieldId}-text`}
          value={text}
          onChange={(e) => onChange({ ...content, text: e.target.value })}
          placeholder="Supporting description text"
          rows={3}
          className="input w-full text-sm resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${fieldId}-button-text`} className="block text-sm font-medium text-ink mb-1">
            Button Text <span className="text-semantic-error">*</span>
          </label>
          <input id={`${fieldId}-button-text`}
            type="text"
            value={buttonText}
            onChange={(e) => onChange({ ...content, button_text: e.target.value })}
            placeholder="e.g., Learn More"
            className="input w-full text-sm"
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-button-url`} className="block text-sm font-medium text-ink mb-1">
            Button URL <span className="text-semantic-error">*</span>
          </label>
          <input id={`${fieldId}-button-url`}
            type="text"
            value={buttonUrl}
            onChange={(e) => onChange({ ...content, button_url: e.target.value })}
            placeholder="e.g., /about"
            className="input w-full text-sm"
          />
        </div>
      </div>

      <div>
        <span id={`${fieldId}-style-group`} className="block text-sm font-medium text-ink mb-1">
          Style
        </span>
        <div role="group" aria-labelledby={`${fieldId}-style-group`} className="flex gap-2">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={style === opt.value}
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
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function CallToActionRenderer({ content }: BlockRendererComponentProps) {
  const heading = (content.heading as string) || '';
  const text = (content.text as string) || '';
  const buttonText = (content.button_text as string) || '';
  const buttonUrl = (content.button_url as string) || '';
  const style = (content.style as CTAStyle) || 'primary';

  if (!heading) {
    return null;
  }

  return (
    <div
      className={cn(
        'rounded-lg px-8 py-10 text-center',
        style === 'primary'
          ? 'bg-forest text-parchment'
          : 'bg-stone border border-lichen',
      )}
    >
      <h3
        className={cn(
          'text-2xl font-bold mb-3',
          style === 'primary' ? 'text-parchment' : 'text-ink',
        )}
      >
        {heading}
      </h3>
      {text && (
        <p
          className={cn(
            'text-base mb-6 max-w-xl mx-auto',
            style === 'primary' ? 'text-parchment/80' : 'text-archive',
          )}
        >
          {text}
        </p>
      )}
      {buttonText && buttonUrl && (
        <a
          href={buttonUrl}
          className={cn(
            'inline-block px-6 py-3 rounded-lg font-medium transition-colors',
            style === 'primary'
              ? 'bg-bark text-parchment hover:bg-copper-dark'
              : 'bg-forest text-parchment hover:bg-forest/90',
          )}
        >
          {buttonText}
        </a>
      )}
    </div>
  );
}
