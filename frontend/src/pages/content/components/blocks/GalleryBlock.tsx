/**
 * Gallery Block — CSS grid gallery of media assets.
 */

import { useState } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { MediaPickerModal } from '../../../../components/content/MediaPickerModal';

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

type ColumnCount = 2 | 3 | 4;

const COLUMN_OPTIONS: { value: ColumnCount; label: string }[] = [
  { value: 2, label: '2 Columns' },
  { value: 3, label: '3 Columns' },
  { value: 4, label: '4 Columns' },
];

const GRID_CLASSES: Record<ColumnCount, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4',
};

// =============================================================================
// Helpers
// =============================================================================

function parseMediaIds(content: Record<string, unknown>): string[] {
  const raw = content.media_ids;
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function serializeMediaIds(ids: string[]): string[] {
  return ids;
}

// =============================================================================
// Editor
// =============================================================================

export function GalleryEditor({ content, onChange, organizationId }: BlockEditorComponentProps) {
  const mediaIds = parseMediaIds(content);
  const columns = (content.columns as ColumnCount) || 3;
  const caption = (content.caption as string) || '';
  const [showPicker, setShowPicker] = useState(false);

  const handleRemoveImage = (index: number) => {
    const updated = mediaIds.filter((_, i) => i !== index);
    onChange({ ...content, media_ids: serializeMediaIds(updated) });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Images
        </label>

        {/* Thumbnail preview grid */}
        {mediaIds.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-2">
            {mediaIds.map((id, i) => (
              <div key={`${id}-${i}`} className="relative aspect-square rounded-lg overflow-hidden bg-stone/30 group">
                <img
                  src={`/api/media/${id}/thumbnail?size=200`}
                  alt=""
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveImage(i)}
                  className="absolute top-1 right-1 w-5 h-5 bg-ink/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} className="text-parchment" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-2 w-full px-4 py-2.5 border border-dashed border-lichen text-archive rounded-lg hover:border-bark hover:text-bark transition-colors text-sm"
        >
          <FolderOpen size={16} />
          Add from library
        </button>
        <p className="mt-1 text-xs text-archive">
          {mediaIds.length} {mediaIds.length === 1 ? 'image' : 'images'} in gallery
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Columns
        </label>
        <select
          value={columns}
          onChange={(e) => onChange({ ...content, columns: Number(e.target.value) })}
          className="input w-full text-sm"
        >
          {COLUMN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Caption
        </label>
        <input
          type="text"
          value={caption}
          onChange={(e) => onChange({ ...content, caption: e.target.value })}
          placeholder="Optional gallery caption"
          className="input w-full text-sm"
        />
      </div>

      {organizationId && (
        <MediaPickerModal
          isOpen={showPicker}
          onClose={() => setShowPicker(false)}
          onSelect={(id) => {
            onChange({ ...content, media_ids: serializeMediaIds([...mediaIds, id]) });
          }}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function GalleryRenderer({ content }: BlockRendererComponentProps) {
  const mediaIds = parseMediaIds(content);
  const columns = (content.columns as ColumnCount) || 3;
  const caption = (content.caption as string) || '';

  if (mediaIds.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-archive border border-dashed border-lichen rounded-lg">
        No images in gallery
      </div>
    );
  }

  return (
    <figure>
      <div className={cn('grid gap-4', GRID_CLASSES[columns])}>
        {mediaIds.map((id) => (
          <div key={id} className="aspect-square overflow-hidden rounded-lg bg-stone">
            <img
              src={`/api/media/${id}/download`}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        ))}
      </div>
      {caption && (
        <figcaption className="mt-3 text-sm text-archive text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
