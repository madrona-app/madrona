/**
 * Image Block — Media asset with caption, alt text, and size controls.
 */

import { useState } from 'react';
import { Image as ImageIcon, FolderOpen } from 'lucide-react';
import { MediaPickerModal } from '../../../../components/content/MediaPickerModal';
import { ResponsiveImage } from '../../../../components/ui/ResponsiveImage';
import type { SrcSetData } from '../../../../types/discover';

// =============================================================================
// Shared Types
// =============================================================================

interface BlockEditorComponentProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
  organizationId?: string;
}

interface BlockRendererComponentProps {
  content: Record<string, unknown>;
}

type ImageSize = 'small' | 'medium' | 'full';

const SIZE_OPTIONS: { value: ImageSize; label: string }[] = [
  { value: 'small', label: 'Small (33%)' },
  { value: 'medium', label: 'Medium (66%)' },
  { value: 'full', label: 'Full Width' },
];

const SIZE_CLASSES: Record<ImageSize, string> = {
  small: 'max-w-sm mx-auto',
  medium: 'max-w-2xl mx-auto',
  full: 'w-full',
};

// =============================================================================
// Editor
// =============================================================================

export function ImageEditor({ content, onChange, organizationId }: BlockEditorComponentProps) {
  const mediaId = (content.media_id as string) || '';
  const caption = (content.caption as string) || '';
  const alt = (content.alt as string) || '';
  const size = (content.size as ImageSize) || 'full';
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Image
        </label>
        {mediaId ? (
          <div className="flex items-start gap-3">
            <div className="w-24 h-24 rounded-lg overflow-hidden bg-stone/30 shrink-0">
              <img
                src={`/api/media/${mediaId}/thumbnail?size=200`}
                alt={alt || 'Selected image'}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-archive font-mono break-all">{mediaId}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="text-xs text-bark hover:text-copper-dark transition-colors"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...content, media_id: '' })}
                  className="text-xs text-archive hover:text-semantic-error transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-2 w-full px-4 py-3 border border-dashed border-lichen text-archive rounded-lg hover:border-bark hover:text-bark transition-colors"
          >
            <FolderOpen size={16} />
            <span className="text-sm">Browse media library</span>
          </button>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Alt Text
        </label>
        <input
          type="text"
          value={alt}
          onChange={(e) => onChange({ ...content, alt: e.target.value })}
          placeholder="Describe the image for accessibility"
          className="input w-full text-sm"
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
          placeholder="Optional caption displayed below the image"
          className="input w-full text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Size
        </label>
        <select
          value={size}
          onChange={(e) => onChange({ ...content, size: e.target.value })}
          className="input w-full text-sm"
        >
          {SIZE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {organizationId && (
        <MediaPickerModal
          isOpen={showPicker}
          onClose={() => setShowPicker(false)}
          onSelect={(id) => onChange({ ...content, media_id: id })}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function ImageRenderer({ content }: BlockRendererComponentProps) {
  const mediaId = (content.media_id as string) || '';
  const caption = (content.caption as string) || '';
  const alt = (content.alt as string) || '';
  const size = (content.size as ImageSize) || 'full';
  // Backend resolves these for public rendering
  const resolvedUrl = (content.resolved_url as string) || '';
  const resolvedSrcset = (content.resolved_srcset as SrcSetData) || null;

  if (!mediaId && !resolvedUrl) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-archive border border-dashed border-lichen rounded-lg">
        <ImageIcon size={20} />
        <span>No image selected</span>
      </div>
    );
  }

  const imgSrc = resolvedUrl || `/api/media/${mediaId}/download`;

  return (
    <figure className={SIZE_CLASSES[size]}>
      <ResponsiveImage
        src={imgSrc}
        srcset={resolvedSrcset}
        alt={alt}
        sizes="(max-width: 768px) 100vw, 800px"
        className="w-full rounded-lg"
        loading="lazy"
      />
      {caption && (
        <figcaption className="mt-2 text-sm text-archive text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
