import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Loader2, AlertTriangle } from 'lucide-react';
import { restoreMediaVersion } from '../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import type { MediaVersion } from '../../lib/schemas';
import { formatDateTime } from '@/lib/formatters';
import { ModalPortal } from '../ModalPortal';

interface RestoreVersionDialogProps {
  organizationId: string;
  mediaId: string;
  version: MediaVersion;
  onClose: () => void;
}

export function RestoreVersionDialog({
  organizationId,
  mediaId,
  version,
  onClose,
}: RestoreVersionDialogProps) {
  const queryClient = useQueryClient();
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose,
    titlePrefix: 'restore-version-dialog',
  });

  const restoreMutation = useMutation({
    mutationFn: () => restoreMediaVersion(organizationId, mediaId, version.version_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-versions', organizationId, mediaId] });
      queryClient.invalidateQueries({ queryKey: ['media', organizationId, mediaId] });
      queryClient.invalidateQueries({ queryKey: ['media-derivatives', organizationId, mediaId] });
      onClose();
    },
  });

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'Unknown date';
    return formatDateTime(dateString);
  };

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <h2
            id={titleId}
            className="text-lg font-semibold text-ink flex items-center gap-2"
          >
            <RotateCcw size={20} className="text-bark" />
            Restore Previous Version
          </h2>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p
            id={descriptionId}
            className="text-sm text-archive"
          >
            Are you sure you want to restore this previous version? The current file will be
            preserved in the version history.
          </p>

          {/* Version details */}
          <div className="p-4 bg-stone/30 border border-lichen rounded-sm">
            <h4 className="font-medium text-ink mb-3">Restoring to:</h4>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between">
                <dt className="text-archive">Version</dt>
                <dd className="font-medium text-ink">{version.version_number}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-archive">File Size</dt>
                <dd className="text-ink">{formatFileSize(version.file_size)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-archive">Created</dt>
                <dd className="text-ink">{formatDate(version.created_at)}</dd>
              </div>
              {version.change_note && (
                <div className="pt-2 border-t border-lichen mt-2">
                  <dt className="text-archive mb-1">Note</dt>
                  <dd className="text-ink">{version.change_note}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-semantic-warning/10 border border-semantic-warning/30 rounded-sm text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-semantic-warning" />
            <p className="m-0 text-semantic-warning">
              Derivatives will be regenerated from the restored file. This may take a few
              moments to complete.
            </p>
          </div>

          {/* Error */}
          {restoreMutation.isError && (
            <div
              role="alert"
              aria-live="assertive"
              className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error"
            >
              {(restoreMutation.error as Error)?.message || 'Failed to restore version'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={restoreMutation.isPending}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => restoreMutation.mutate()}
            disabled={restoreMutation.isPending}
            className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {restoreMutation.isPending && <Loader2 size={16} className="animate-spin" />}
            Restore Version
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
