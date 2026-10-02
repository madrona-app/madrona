import { useQuery } from '@tanstack/react-query';
import { X, AlertTriangle, Globe } from 'lucide-react';
import { getDiscoverPreview } from '../../lib/api';
import { MadronaLoader } from '../ui/MadronaLoader';
import { ResponsiveImage } from '../ui/ResponsiveImage';
import { ModalPortal } from '../ModalPortal';

interface DiscoverPreviewModalProps {
  organizationId: string;
  objectId: string;
  onClose: () => void;
  onPublish?: () => void;
}

export function DiscoverPreviewModal({
  organizationId,
  objectId,
  onClose,
  onPublish,
}: DiscoverPreviewModalProps) {
  const { data: preview, isLoading, isError } = useQuery({
    queryKey: ['discover-preview', organizationId, objectId],
    queryFn: () => getDiscoverPreview(organizationId, objectId),
  });

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50">
      <div className="bg-parchment rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-lichen">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-bark" />
            <h2 className="text-sm font-semibold text-ink">Discover Preview</h2>
            {preview && (
              <span
                className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
                  preview.is_currently_discoverable
                    ? 'bg-semantic-success/10 text-semantic-success'
                    : 'bg-stone-100 text-stone-600'
                }`}
              >
                {preview.is_currently_discoverable ? 'Published' : 'Private'}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 text-archive hover:text-ink hover:bg-stone/50 transition-colors rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <MadronaLoader variant="dots" />
            </div>
          )}

          {isError && (
            <div className="text-center py-10 text-semantic-error">
              Failed to load preview
            </div>
          )}

          {preview && (
            <>
              {/* Warnings */}
              {preview.preview_warnings.length > 0 && (
                <div className="mb-6 space-y-2">
                  {preview.preview_warnings.map((warning, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg"
                    >
                      <AlertTriangle size={16} className="text-semantic-warning flex-shrink-0" />
                      <span className="text-sm text-semantic-warning">{warning}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Object preview */}
              <div className="space-y-6">
                {/* Primary image */}
                {preview.media.length > 0 && (
                  <div className="bg-parchment rounded-lg overflow-hidden border border-lichen">
                    <ResponsiveImage
                      src={preview.media[0].url}
                      srcset={preview.media[0].srcset}
                      alt={preview.media[0].alt_text || preview.title || ''}
                      sizes="(max-width: 768px) 100vw, 720px"
                      className="w-full max-h-80 object-contain"
                      loading="eager"
                    />
                    {preview.media[0].attribution && (
                      <p className="px-4 py-2 text-xs text-archive border-t border-lichen">
                        {preview.media[0].attribution}
                      </p>
                    )}
                  </div>
                )}

                {/* Title & metadata */}
                <div>
                  <h3 className="text-xl font-serif font-semibold text-ink">
                    {preview.title || 'Untitled'}
                  </h3>
                  {preview.creators && preview.creators.length > 0 && (
                    <p className="text-sm text-archive mt-1">
                      {preview.creators.join(', ')}
                    </p>
                  )}
                  {preview.creation_date_display && (
                    <p className="text-sm text-archive">{preview.creation_date_display}</p>
                  )}
                </div>

                {preview.brief_description && (
                  <p className="text-sm text-ink leading-relaxed">{preview.brief_description}</p>
                )}

                {/* Metadata grid */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  {preview.object_number && (
                    <MetaField label="Accession Number" value={preview.object_number} />
                  )}
                  {preview.object_type && (
                    <MetaField label="Object Type" value={preview.object_type} />
                  )}
                  {preview.classification && (
                    <MetaField label="Classification" value={preview.classification} />
                  )}
                  {preview.creation_place && (
                    <MetaField label="Place of Origin" value={preview.creation_place} />
                  )}
                  {preview.style_period && (
                    <MetaField label="Style / Period" value={preview.style_period} />
                  )}
                  {preview.credit_line && (
                    <MetaField label="Credit Line" value={preview.credit_line} />
                  )}
                  {preview.materials && preview.materials.length > 0 && (
                    <MetaField
                      label="Materials"
                      value={preview.materials.map((m) => m.name || m.value || '').filter(Boolean).join(', ')}
                    />
                  )}
                  {preview.techniques && preview.techniques.length > 0 && (
                    <MetaField
                      label="Techniques"
                      value={preview.techniques.map((t) => t.name || t.value || '').filter(Boolean).join(', ')}
                    />
                  )}
                </div>

                {/* Additional media thumbnails */}
                {preview.media.length > 1 && (
                  <div>
                    <p className="text-xs font-medium text-archive mb-2">
                      {preview.media.length} images
                    </p>
                    <div className="flex gap-2 overflow-x-auto">
                      {preview.media.slice(1).map((m) => (
                        <ResponsiveImage
                          key={m.media_id}
                          src={m.url}
                          srcset={m.srcset}
                          alt={m.alt_text || ''}
                          sizes="80px"
                          className="w-20 h-20 object-cover rounded border border-lichen flex-shrink-0"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-archive hover:text-ink border border-lichen rounded-lg transition-colors"
          >
            Close
          </button>
          {preview && !preview.is_currently_discoverable && onPublish && (
            <button
              onClick={onPublish}
              className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors"
            >
              Publish Now
            </button>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-archive">{label}</dt>
      <dd className="text-ink mt-0.5">{value}</dd>
    </div>
  );
}
