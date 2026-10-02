/**
 * VersionComparisonView — side-by-side comparison of two media versions.
 * For images: displays both side-by-side with a draggable slider divider.
 * For non-images: shows metadata diff (file size, dimensions, format).
 */
import { useState, useRef, useCallback } from 'react';
import { X, ArrowLeftRight } from 'lucide-react';
import type { MediaVersion } from '../../lib/schemas';
import { formatDateTime } from '@/lib/formatters';

/**
 * A media version optionally enriched with the rendition URL and MIME type.
 * The base versions list endpoint omits these, so both are optional here; the
 * component falls back to the download endpoint and a placeholder respectively.
 */
type ComparableVersion = MediaVersion & {
  url?: string | null;
  mime_type?: string | null;
};

interface VersionComparisonViewProps {
  organizationId: string;
  mediaId: string;
  versionA: ComparableVersion;
  versionB: ComparableVersion;
  mediaType: string;
  onClose: () => void;
}

export function VersionComparisonView({
  organizationId,
  mediaId,
  versionA,
  versionB,
  mediaType,
  onClose,
}: VersionComparisonViewProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    setSliderPosition(Math.max(5, Math.min(95, x)));
  }, []);

  const handleMouseDown = () => { isDragging.current = true; };
  const handleMouseUp = () => { isDragging.current = false; };

  const urlA = versionA.url || `/api/organizations/${organizationId}/media/${mediaId}/versions/${versionA.version_id}/download`;
  const urlB = versionB.url || `/api/organizations/${organizationId}/media/${mediaId}/versions/${versionB.version_id}/download`;

  const isImage = mediaType === 'image';

  return (
    <div className="border border-lichen rounded-lg bg-parchment overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-lichen bg-stone/20">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <ArrowLeftRight size={16} className="text-bark" />
          Comparing Version {versionA.version_number} vs Version {versionB.version_number}
        </div>
        <button onClick={onClose} className="p-1 hover:bg-stone rounded transition-colors" aria-label="Close comparison view">
          <X size={16} className="text-archive" />
        </button>
      </div>

      {isImage ? (
        /* Image slider comparison */
        <div
          ref={containerRef}
          className="relative h-[400px] select-none cursor-col-resize overflow-hidden"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Version B (right/full) */}
          <div className="absolute inset-0">
            <img src={urlB} alt={`Version ${versionB.version_number}`} className="w-full h-full object-contain bg-stone" />
          </div>

          {/* Version A (left/clipped) */}
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ width: `${sliderPosition}%` }}
          >
            <img
              src={urlA}
              alt={`Version ${versionA.version_number}`}
              className="h-full object-contain bg-stone/20"
              style={{ width: `${containerRef.current?.offsetWidth || 800}px`, maxWidth: 'none' }}
            />
          </div>

          {/* Slider handle */}
          <div
            role="slider"
            aria-label="Version comparison slider"
            aria-valuemin={5}
            aria-valuemax={95}
            aria-valuenow={Math.round(sliderPosition)}
            tabIndex={0}
            className="absolute top-0 bottom-0 w-1 bg-bark cursor-col-resize z-10 focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
            onMouseDown={handleMouseDown}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setSliderPosition((prev) => Math.max(5, prev - 2));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                setSliderPosition((prev) => Math.min(95, prev + 2));
              }
            }}
          >
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-bark rounded-full flex items-center justify-center shadow-lg">
              <ArrowLeftRight size={14} className="text-parchment" />
            </div>
          </div>

          {/* Labels */}
          <div className="absolute top-3 left-3 bg-ink/70 text-parchment text-xs px-2 py-1 rounded">
            v{versionA.version_number}
          </div>
          <div className="absolute top-3 right-3 bg-ink/70 text-parchment text-xs px-2 py-1 rounded">
            v{versionB.version_number}
          </div>
        </div>
      ) : (
        /* Non-image metadata diff */
        <div className="grid grid-cols-2 gap-4 p-4">
          {[versionA, versionB].map((v) => (
            <div key={v.version_id} className="p-4 border border-lichen rounded-lg">
              <h4 className="font-medium text-ink mb-3">Version {v.version_number}</h4>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-archive">File size</dt>
                  <dd className="text-ink font-medium">{formatFileSize(v.file_size)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-archive">MIME type</dt>
                  <dd className="text-ink font-medium">{v.mime_type || '-'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-archive">Created</dt>
                  <dd className="text-ink font-medium">
                    {v.created_at ? formatDateTime(v.created_at) : '-'}
                  </dd>
                </div>
                {v.change_note && (
                  <div>
                    <dt className="text-archive">Note</dt>
                    <dd className="text-ink mt-1">{v.change_note}</dd>
                  </div>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}

      {/* Size diff summary */}
      <div className="flex items-center justify-center gap-6 p-3 border-t border-lichen bg-stone text-sm">
        <span className="text-archive">
          v{versionA.version_number}: {formatFileSize(versionA.file_size)}
        </span>
        <span className="text-ink font-medium">
          {versionB.file_size > versionA.file_size ? '+' : ''}
          {formatFileSize(versionB.file_size - versionA.file_size)}
        </span>
        <span className="text-archive">
          v{versionB.version_number}: {formatFileSize(versionB.file_size)}
        </span>
      </div>
    </div>
  );
}
