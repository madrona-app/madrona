/**
 * Modal prompt asking visitors if they'd like a post-visit email recap.
 *
 * Shown after a period of inactivity or when leaving the site.
 * Collects email and sends it to the visitor identify endpoint.
 */

import { useState, useCallback } from 'react';
import { Mail, X } from 'lucide-react';

interface VisitRecapPromptProps {
  orgSlug: string;
  sessionId: string;
  onClose: () => void;
}

// Same-origin by default — see lib/apiClient.ts.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export function VisitRecapPrompt({ orgSlug, sessionId, onClose }: VisitRecapPromptProps) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = API_BASE_URL.replace(/\/api\/?$/, '');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    // Basic email validation
    if (!trimmed.includes('@') || !trimmed.includes('.')) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      const res = await fetch(`${baseUrl}/api/guide/${orgSlug}/visitor/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          email: trimmed,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to save email');
      }

      setSubmitted(true);
      setTimeout(onClose, 3000);
    } catch {
      setError('Something went wrong. Please try again.');
    }
  }, [email, baseUrl, orgSlug, sessionId, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4 rounded-lg border border-lichen bg-parchment p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-archive hover:text-ink transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {submitted ? (
          <div className="text-center py-4">
            <Mail size={32} className="mx-auto text-bark mb-3" />
            <p className="text-sm text-ink font-medium">Thanks! We'll send your recap shortly.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Mail size={20} className="text-bark" />
              <h3 className="text-sm font-medium text-ink">Want a recap of your visit?</h3>
            </div>
            <p className="text-xs text-archive mb-4">
              We'll email you a summary of the objects you explored and highlights from your conversation with Madrona.
            </p>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null); }}
                placeholder="Your email address"
                className="flex-1 rounded border border-lichen bg-parchment px-3 py-2 text-sm text-ink placeholder:text-archive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-1"
                autoFocus
              />
              <button
                type="submit"
                disabled={!email.trim()}
                className="rounded px-4 py-2 text-sm font-medium text-parchment transition-colors disabled:opacity-30"
                style={{ backgroundColor: 'var(--c-primary, #1F3A2E)' }}
              >
                Send
              </button>
            </form>
            {error && (
              <p className="mt-2 text-xs text-semantic-error">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
