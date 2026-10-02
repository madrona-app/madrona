/**
 * Hero Banner Block — Full-width banner with overlay text and optional CTA.
 */

import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
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

// =============================================================================
// Editor
// =============================================================================

export function HeroBannerEditor({ content, onChange, organizationId }: BlockEditorComponentProps) {
  const title = (content.title as string) || '';
  const subtitle = (content.subtitle as string) || '';
  const ctaText = (content.cta_text as string) || '';
  const ctaUrl = (content.cta_url as string) || '';
  const mediaId = (content.media_id as string) || '';
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Title <span className="text-semantic-error">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => onChange({ ...content, title: e.target.value })}
          placeholder="Banner headline"
          className="input w-full text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Subtitle
        </label>
        <input
          type="text"
          value={subtitle}
          onChange={(e) => onChange({ ...content, subtitle: e.target.value })}
          placeholder="Supporting text"
          className="input w-full text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Background Image
        </label>
        {mediaId ? (
          <div className="flex items-center gap-3">
            <div className="w-20 h-12 rounded overflow-hidden bg-stone/30 shrink-0">
              <img
                src={`/api/media/${mediaId}/thumbnail?size=200`}
                alt="Background"
                className="w-full h-full object-cover"
              />
            </div>
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
        ) : (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-2 w-full px-4 py-2.5 border border-dashed border-lichen text-archive rounded-lg hover:border-bark hover:text-bark transition-colors text-sm"
          >
            <FolderOpen size={16} />
            Browse media library
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            CTA Button Text
          </label>
          <input
            type="text"
            value={ctaText}
            onChange={(e) => onChange({ ...content, cta_text: e.target.value })}
            placeholder="e.g., Explore Collection"
            className="input w-full text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            CTA Button URL
          </label>
          <input
            type="text"
            value={ctaUrl}
            onChange={(e) => onChange({ ...content, cta_url: e.target.value })}
            placeholder="e.g., /discover"
            className="input w-full text-sm"
          />
        </div>
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

export function HeroBannerRenderer({ content }: BlockRendererComponentProps) {
  const title = (content.title as string) || '';
  const subtitle = (content.subtitle as string) || '';
  const ctaText = (content.cta_text as string) || '';
  const ctaUrl = (content.cta_url as string) || '';
  const mediaId = (content.media_id as string) || '';
  const resolvedUrl = (content.resolved_url as string) || '';
  const resolvedSrcset = (content.resolved_srcset as SrcSetData) || null;

  const hasImage = !!(mediaId || resolvedUrl);

  // Fallback: use CSS background if no resolved srcset available
  const useCssBg = hasImage && !resolvedSrcset;
  const backgroundStyle = useCssBg
    ? {
        backgroundImage: `url(${resolvedUrl || `/api/media/${mediaId}/download`})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : undefined;

  return (
    <div
      className="relative flex items-center justify-center min-h-[320px] rounded-lg overflow-hidden bg-forest"
      style={backgroundStyle}
    >
      {/* Responsive background image */}
      {hasImage && resolvedSrcset && (
        <div className="absolute inset-0">
          <ResponsiveImage
            src={resolvedUrl || `/api/media/${mediaId}/download`}
            srcset={resolvedSrcset}
            alt=""
            sizes="100vw"
            className="w-full h-full object-cover"
            loading="eager"
          />
        </div>
      )}

      {/* Overlay for text readability */}
      {hasImage && (
        <div className="absolute inset-0 bg-ink/50" />
      )}

      <div className="relative z-10 text-center px-6 py-12 max-w-3xl">
        <h1 className="text-3xl md:text-5xl font-bold text-parchment mb-4">
          {title}
        </h1>
        {subtitle && (
          <p className="text-lg md:text-xl text-parchment/80 mb-6">
            {subtitle}
          </p>
        )}
        {ctaText && ctaUrl && (
          <a
            href={ctaUrl}
            className="inline-block px-6 py-3 bg-bark text-parchment rounded-lg font-medium hover:bg-copper-dark transition-colors"
          >
            {ctaText}
          </a>
        )}
      </div>
    </div>
  );
}
