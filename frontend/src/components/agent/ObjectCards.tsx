/**
 * Inline object cards for the visitor chat.
 *
 * When the guide mentions works from the collection, they appear as tappable
 * cards inside the conversation — image, title, maker/date — with an in-chat
 * detail expansion. The visitor never gets bounced out to the Discover
 * record UI mid-conversation; the full record stays one (secondary,
 * new-tab) link away.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, ImageOff } from 'lucide-react';
import { API_BASE_URL } from '../../lib/apiClient';

export interface ObjectCardData {
  object_id: string;
  object_number?: string | null;
  title: string;
  creator?: string | null;
  date?: string | null;
  /** Public discover path: /c/{slug}/objects/{id} */
  path: string;
  thumbnail_url?: string | null;
}

interface DetailState {
  loading: boolean;
  description?: string | null;
  error?: boolean;
}

/** Parse /c/{slug}/objects/{id} into its parts (null when malformed). */
function parsePath(path: string): { slug: string; id: string } | null {
  const m = path.match(/^\/c\/([^/]+)\/objects\/([^/?#]+)/);
  return m ? { slug: m[1], id: m[2] } : null;
}

function ObjectCard({ card }: { card: ObjectCardData }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) {
      const parsed = parsePath(card.path);
      if (!parsed) {
        setDetail({ loading: false, error: true });
        return;
      }
      setDetail({ loading: true });
      try {
        const res = await fetch(
          `${API_BASE_URL}/discover/${parsed.slug}/objects/${parsed.id}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setDetail({
          loading: false,
          description: data.full_description || data.brief_description || null,
        });
      } catch {
        setDetail({ loading: false, error: true });
      }
    }
  };

  const meta = [card.creator, card.date].filter(Boolean).join(' · ');

  return (
    <div className="w-full overflow-hidden rounded-lg border border-lichen bg-parchment-warm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-2 text-left transition-colors hover:bg-stone/30 focus-visible:ring-2 ring-bark/30"
      >
        {card.thumbnail_url ? (
          <img
            src={card.thumbnail_url}
            alt={card.title}
            loading="lazy"
            className="h-14 w-14 flex-shrink-0 rounded object-cover bg-stone"
          />
        ) : (
          <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded bg-stone text-archive">
            <ImageOff size={18} aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{card.title}</span>
          {meta && <span className="block truncate text-xs text-archive">{meta}</span>}
        </span>
        <span className="flex-shrink-0 text-archive">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-lichen px-3 py-2.5">
          {card.thumbnail_url && (
            <img
              src={card.thumbnail_url}
              alt={card.title}
              className="mb-2 max-h-56 w-full rounded object-contain bg-stone/40"
            />
          )}
          {detail?.loading && <p className="text-xs text-archive">Loading…</p>}
          {detail?.error && (
            <p className="text-xs text-archive">Details unavailable right now.</p>
          )}
          {detail?.description && (
            <p className="text-sm leading-relaxed text-ink line-clamp-6">{detail.description}</p>
          )}
          <a
            href={card.path}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-azurite hover:text-azurite-deep"
          >
            Full record <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  );
}

export function ObjectCards({ objects }: { objects: ObjectCardData[] }) {
  if (!objects?.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="object-cards">
      {objects.map(card => (
        <ObjectCard key={card.object_id} card={card} />
      ))}
    </div>
  );
}
