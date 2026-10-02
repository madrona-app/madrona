import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Loader2, FileUp } from 'lucide-react';
import { uploadMediaVersion } from '../../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { ModalPortal } from '../ModalPortal';

interface UploadVersionModalProps {
  organizationId: string;
  mediaId: string;
  onClose: () => void;
}

export function UploadVersionModal({
  organizationId,
  mediaId,
  onClose,
}: UploadVersionModalProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose,
    titlePrefix: 'upload-version-modal',
  });

  const [file, setFile] = useState<File | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('No file selected');
      return uploadMediaVersion(organizationId, mediaId, file, changeNote || undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-versions', organizationId, mediaId] });
      queryClient.invalidateQueries({ queryKey: ['media', organizationId, mediaId] });
      onClose();
    },
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
            <Upload size={20} className="text-bark" />
            Upload New Version
          </h2>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p
            id={descriptionId}
            className="text-sm text-archive"
          >
            Upload a new file to create a new version. The current file will be preserved in version history.
          </p>

          {/* File Drop Zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              dragOver ? 'border-bark bg-parchment' : 'border-stone hover:border-archive'
            }`}
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => !file && fileInputRef.current?.click()}
          >
            {file ? (
              <div className="space-y-2">
                <FileUp className="h-10 w-10 mx-auto text-bark" />
                <p className="font-medium text-ink">{file.name}</p>
                <p className="text-sm text-archive">
                  {formatFileSize(file.size)}
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="text-sm text-semantic-error hover:underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                <Upload className="h-10 w-10 mx-auto text-archive mb-3" />
                <p className="font-medium text-ink mb-1">
                  Drop file here or click to browse
                </p>
                <p className="text-sm text-archive">
                  The new file will become the current version
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </>
            )}
          </div>

          {/* Change Note */}
          <div>
            <label
              htmlFor="change-note"
              className="block text-sm font-medium text-ink mb-1"
            >
              Change Note (optional)
            </label>
            <textarea
              id="change-note"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="Describe what changed in this version..."
              rows={3}
              className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 resize-none"
            />
          </div>

          {/* Info */}
          <div className="p-3 bg-stone/30 border border-lichen rounded-sm text-sm text-ink">
            <p className="m-0">
              Uploading a new version will preserve the current file in the version history.
              Derivatives will be automatically regenerated.
            </p>
          </div>

          {/* Error */}
          {uploadMutation.isError && (
            <div
              role="alert"
              aria-live="assertive"
              className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error"
            >
              {(uploadMutation.error as Error)?.message || 'Failed to upload version'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={uploadMutation.isPending}
            className="px-4 py-2 border border-stone rounded-sm bg-parchment text-ink hover:bg-stone/20 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => uploadMutation.mutate()}
            disabled={!file || uploadMutation.isPending}
            className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {uploadMutation.isPending && <Loader2 size={16} className="animate-spin" />}
            Upload Version
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
