/**
 * Social Embed Block — Embed YouTube, Vimeo, Instagram, or TikTok content.
 */

import { useMemo } from 'react';

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

type EmbedType = 'youtube' | 'vimeo' | 'instagram' | 'tiktok';

const EMBED_TYPE_OPTIONS: { value: EmbedType; label: string }[] = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'vimeo', label: 'Vimeo' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
];

// =============================================================================
// Editor
// =============================================================================

export function SocialEmbedEditor({ content, onChange }: BlockEditorComponentProps) {
  const embedType = (content.embed_type as EmbedType) || 'youtube';
  const embedUrl = (content.embed_url as string) || '';
  const caption = (content.caption as string) || '';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Platform
        </label>
        <select
          value={embedType}
          onChange={(e) => onChange({ ...content, embed_type: e.target.value })}
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          {EMBED_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Embed URL <span className="text-semantic-error">*</span>
        </label>
        <input
          type="text"
          value={embedUrl}
          onChange={(e) => onChange({ ...content, embed_url: e.target.value })}
          placeholder={
            embedType === 'youtube'
              ? 'https://www.youtube.com/watch?v=...'
              : embedType === 'vimeo'
                ? 'https://vimeo.com/...'
                : embedType === 'instagram'
                  ? 'https://www.instagram.com/p/...'
                  : 'https://www.tiktok.com/@.../video/...'
          }
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Caption
        </label>
        <input
          type="text"
          value={caption}
          onChange={(e) => onChange({ ...content, caption: e.target.value })}
          placeholder="Optional caption text"
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract a valid embed URL from common video sharing URLs.
 */
function getEmbedSrc(embedType: string, url: string): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    if (embedType === 'youtube') {
      // Handle youtube.com/watch?v=ID and youtu.be/ID formats
      if (parsed.hostname.includes('youtube.com')) {
        const videoId = parsed.searchParams.get('v');
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      }
      if (parsed.hostname === 'youtu.be') {
        const videoId = parsed.pathname.slice(1);
        if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      }
      // Already an embed URL
      if (parsed.pathname.startsWith('/embed/')) return url;
    }

    if (embedType === 'vimeo') {
      // Handle vimeo.com/ID format
      if (parsed.hostname.includes('vimeo.com')) {
        const match = parsed.pathname.match(/\/(\d+)/);
        if (match) return `https://player.vimeo.com/video/${match[1]}`;
      }
      // Already a player URL
      if (parsed.hostname === 'player.vimeo.com') return url;
    }

    // Fallback: return as-is if we cannot parse
    return url;
  } catch {
    return null;
  }
}

// =============================================================================
// Renderer
// =============================================================================

export function SocialEmbedRenderer({ content }: BlockRendererComponentProps) {
  const embedType = (content.embed_type as string) || 'youtube';
  const embedUrl = (content.embed_url as string) || '';
  const caption = (content.caption as string) || '';

  const embedSrc = useMemo(() => getEmbedSrc(embedType, embedUrl), [embedType, embedUrl]);

  if (!embedSrc) {
    return (
      <div className="text-center py-8 text-archive text-sm border border-dashed border-lichen rounded-lg">
        Invalid embed URL.
      </div>
    );
  }

  const isVideo = embedType === 'youtube' || embedType === 'vimeo';

  return (
    <figure>
      {isVideo ? (
        <div className="relative aspect-video rounded-lg overflow-hidden bg-ink/5 border border-lichen">
          <iframe
            src={embedSrc}
            title={caption || `${embedType} embed`}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex justify-center">
          <iframe
            src={embedSrc}
            title={caption || `${embedType} embed`}
            className="max-w-lg w-full rounded-lg border border-lichen"
            style={{ minHeight: 480 }}
            loading="lazy"
          />
        </div>
      )}

      {caption && (
        <figcaption className="mt-3 text-sm text-archive text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
