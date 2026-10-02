/**
 * Newsletter Signup Block — Email signup form with heading and description.
 */

import { useState, useCallback } from 'react';
import { Mail, CheckCircle, Loader2 } from 'lucide-react';

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

export function NewsletterSignupEditor({ content, onChange }: BlockEditorComponentProps) {
  const heading = (content.heading as string) || '';
  const description = (content.description as string) || '';
  const buttonText = (content.button_text as string) || '';
  const formActionUrl = (content.form_action_url as string) || '';

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
          placeholder="e.g., Stay in the loop"
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => onChange({ ...content, description: e.target.value })}
          placeholder="Subscribe to our newsletter for the latest exhibitions and events."
          rows={3}
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Button Text
          </label>
          <input
            type="text"
            value={buttonText}
            onChange={(e) => onChange({ ...content, button_text: e.target.value })}
            placeholder="e.g., Subscribe"
            className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            Form Action URL
          </label>
          <input
            type="text"
            value={formActionUrl}
            onChange={(e) => onChange({ ...content, form_action_url: e.target.value })}
            placeholder="e.g., https://mailchimp.com/..."
            className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
          />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function NewsletterSignupRenderer({ content }: BlockRendererComponentProps) {
  const heading = (content.heading as string) || 'Stay in Touch';
  const description = (content.description as string) || '';
  const buttonText = (content.button_text as string) || 'Subscribe';
  const formActionUrl = (content.form_action_url as string) || '';

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email || !formActionUrl) return;

      setSubmitting(true);
      setError(null);

      try {
        const res = await fetch(formActionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });

        if (!res.ok) {
          throw new Error('Subscription failed. Please try again.');
        }

        setSubmitted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setSubmitting(false);
      }
    },
    [email, formActionUrl],
  );

  if (submitted) {
    return (
      <div className="rounded-lg bg-forest px-8 py-10 text-center">
        <CheckCircle size={32} className="mx-auto text-parchment mb-3" />
        <p className="text-lg font-medium text-parchment">Thank you for subscribing!</p>
        <p className="text-sm text-parchment/70 mt-1">
          You will receive updates at {email}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-forest px-8 py-10 text-center">
      <Mail size={28} className="mx-auto text-parchment/60 mb-3" />
      <h3 className="text-2xl font-bold text-parchment mb-2">{heading}</h3>
      {description && (
        <p className="text-sm text-parchment/80 mb-6 max-w-md mx-auto">
          {description}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-center gap-3 max-w-md mx-auto">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          className="flex-1 w-full px-4 py-2.5 rounded-lg text-sm text-ink bg-parchment border border-lichen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        />
        <button
          type="submit"
          disabled={submitting || !formActionUrl}
          className="shrink-0 px-6 py-2.5 rounded-lg text-sm font-medium bg-bark text-parchment hover:bg-copper-dark transition-colors disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            buttonText
          )}
        </button>
      </form>

      {error && (
        <p className="text-sm text-semantic-error mt-3">{error}</p>
      )}
    </div>
  );
}
