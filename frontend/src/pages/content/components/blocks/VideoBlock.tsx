/**
 * Video Block — YouTube/Vimeo embed with caption.
 */

import { Video } from 'lucide-react';

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
// Helpers
// =============================================================================

/**
 * Convert a YouTube or Vimeo URL into an embeddable URL.
 * Returns null if the URL is not recognized.
 */
function getEmbedUrl(url: string): string | null {
  if (!url) return null;

  // YouTube: standard and shortened URLs
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (ytMatch) {
    return `https://www.youtube.com/embed/${ytMatch[1]}`;
  }

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }

  return null;
}

// =============================================================================
// Editor
// =============================================================================

export function VideoEditor({ content, onChange }: BlockEditorComponentProps) {
  const url = (content.url as string) || '';
  const caption = (content.caption as string) || '';
  const embedUrl = getEmbedUrl(url);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Video URL
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => onChange({ ...content, url: e.target.value })}
          placeholder="https://www.youtube.com/watch?v=... or https://vimeo.com/..."
          className="input w-full text-sm"
        />
        {url && !embedUrl && (
          <p className="mt-1 text-xs text-semantic-warning">
            Could not parse embed URL. Supported: YouTube, Vimeo.
          </p>
        )}
        {embedUrl && (
          <p className="mt-1 text-xs text-semantic-success">
            Embed URL detected
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Caption
        </label>
        <input
          type="text"
          value={caption}
          onChange={(e) => onChange({ ...content, caption: e.target.value })}
          placeholder="Optional video caption"
          className="input w-full text-sm"
        />
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function VideoRenderer({ content }: BlockRendererComponentProps) {
  const url = (content.url as string) || '';
  const caption = (content.caption as string) || '';
  const embedUrl = getEmbedUrl(url);

  if (!embedUrl) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-archive border border-dashed border-lichen rounded-lg">
        <Video size={20} />
        <span>{url ? 'Unsupported video URL' : 'No video URL provided'}</span>
      </div>
    );
  }

  return (
    <figure>
      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-ink">
        <iframe
          src={embedUrl}
          title={caption || 'Embedded video'}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      {caption && (
        <figcaption className="mt-2 text-sm text-archive text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
