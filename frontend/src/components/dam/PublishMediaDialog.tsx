import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Loader2, AlertTriangle, Check, Shield } from 'lucide-react';
import { publishMedia, getMedia } from '../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';

interface PublishMediaDialogProps {
  organizationId: string;
  mediaId: string;
  mediaTitle: string;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Publishing is hard-gated (the API enforces it too): a media item can only be
 * published once its rights are documented AND it has passed sensitive-content
 * review. This dialog fetches the item's current state and DISABLES the Publish
 * action until both are satisfied — so the gate is surfaced up front, not as a
 * 422 after the click. The server check remains the backstop.
 */
export function PublishMediaDialog({
  organizationId,
  mediaId,
  mediaTitle,
  onClose,
  onSuccess,
}: PublishMediaDialogProps) {
  const queryClient = useQueryClient();
  const [warnings, setWarnings] = useState<string[]>([]);
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose,
    titlePrefix: 'publish-media-dialog',
  });

  const { data: media, isLoading } = useQuery({
    queryKey: ['media', organizationId, mediaId],
    queryFn: () => getMedia(organizationId, mediaId),
  });

  const publishMutation = useMutation({
    mutationFn: () => publishMedia(organizationId, mediaId),
    onSuccess: (data) => {
      if (data.warnings && data.warnings.length > 0) {
        setWarnings(data.warnings);
      }
      queryClient.invalidateQueries({ queryKey: ['media', organizationId, mediaId] });
      queryClient.invalidateQueries({ queryKey: ['media-library', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['publishing-stats', organizationId] });
      onSuccess?.();
      if (!data.warnings || data.warnings.length === 0) {
        onClose();
      }
    },
  });

  // The two hard gates the server enforces (rights documented + reviewed for
  // sensitive content), plus a non-blocking processing advisory.
  const hasRights = !!media?.copyright_status;
  const isReviewed = !!media?.metadata_reviewed;
  const processingStatus = media?.processing_status ?? 'pending';
  const canPublish = hasRights && isReviewed;

  const blockers: string[] = [];
  if (!hasRights) blockers.push('Document the rights (set a copyright status or add a rights record)');
  if (!isReviewed) blockers.push('Complete the sensitive-content review');

  const showSuccess = publishMutation.isSuccess && warnings.length === 0;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {showSuccess ? (
            <div className="text-center py-4">
              <div className="mx-auto w-12 h-12 bg-semantic-success/10 rounded-full flex items-center justify-center mb-4">
                <Check className="h-6 w-6 text-semantic-success" />
              </div>
              <h2 id={titleId} className="text-lg font-semibold text-ink mb-2">Media Published</h2>
              <p id={descriptionId} className="text-archive">
                "{mediaTitle}" is now publicly accessible.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-bark/10 rounded-full">
                  <Globe className="h-6 w-6 text-bark" />
                </div>
                <div>
                  <h2 id={titleId} className="text-lg font-semibold text-ink">Publish Media</h2>
                  <p className="text-sm text-archive">Make publicly accessible</p>
                </div>
              </div>

              <p id={descriptionId} className="text-archive mb-4">
                You are about to publish "{mediaTitle}". Once published, this media will be
                accessible via public URLs and IIIF endpoints.
              </p>

              {isLoading ? (
                <div className="flex items-center gap-2 text-archive py-4">
                  <Loader2 size={16} className="animate-spin" />
                  Checking publish requirements…
                </div>
              ) : (
                <>
                  {/* Blocking requirements — must be cleared before publishing. */}
                  {blockers.length > 0 && (
                    <div className="mb-4 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm">
                      <div className="flex items-center gap-2 text-semantic-error mb-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="font-medium">Resolve before publishing</span>
                      </div>
                      <ul className="text-sm text-semantic-error space-y-1">
                        {blockers.map((b, i) => (
                          <li key={i}>- {b}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Non-blocking advisory. */}
                  {processingStatus !== 'completed' && (
                    <div className="mb-4 p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-sm text-sm text-semantic-warning flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Processing status is "{processingStatus}"
                    </div>
                  )}

                  {/* Post-publish warnings (server advisories). */}
                  {warnings.length > 0 && (
                    <div className="mb-4 p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-sm">
                      <div className="flex items-center gap-2 text-semantic-warning mb-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="font-medium">Published with warnings</span>
                      </div>
                      <ul className="text-sm text-semantic-warning space-y-1">
                        {warnings.map((warning, i) => (
                          <li key={i}>- {warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Requirement checklist. */}
                  <div className="p-3 bg-stone/30 rounded-sm mb-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Shield className="h-4 w-4 text-archive" />
                      <span className="font-medium text-ink">Publish requirements</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {hasRights ? (
                        <><Check className="h-4 w-4 text-semantic-success" /><span className="text-semantic-success">Rights documented</span></>
                      ) : (
                        <><AlertTriangle className="h-4 w-4 text-semantic-error" /><span className="text-semantic-error">Rights not documented</span></>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {isReviewed ? (
                        <><Check className="h-4 w-4 text-semantic-success" /><span className="text-semantic-success">Reviewed for sensitive content</span></>
                      ) : (
                        <><AlertTriangle className="h-4 w-4 text-semantic-error" /><span className="text-semantic-error">Sensitive-content review pending</span></>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Error (server backstop, e.g. a race). */}
              {publishMutation.isError && (
                <div className="mb-4 p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
                  {(publishMutation.error as Error)?.message || 'Failed to publish media'}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          {showSuccess || warnings.length > 0 ? (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={publishMutation.isPending}
                className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending || isLoading || !canPublish}
                title={!canPublish ? 'Resolve the publish requirements first' : undefined}
                className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {publishMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                Publish
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
