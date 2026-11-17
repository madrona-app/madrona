import React, { useState, useRef, useCallback, useId } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, AlertCircle } from 'lucide-react';
import { MadronaLoader } from '../ui/MadronaLoader';
import {
  listObjectMedia,
  uploadObjectMedia,
} from '../../lib/api';

interface MediaManagerProps {
  organizationId: string;
  objectId: string;
  readOnly?: boolean;
}

const ACCEPTED_FILE_TYPES = {
  image: 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/tiff',
  video: 'video/mp4,video/webm,video/quicktime',
  audio: 'audio/mpeg,audio/wav,audio/ogg,audio/flac',
  document:
    'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,text/html,.html,.htm,.brf',
};

/**
 * MediaManager - Upload-only component for adding media to objects.
 * Media display and management is handled by MediaLibraryLinker.
 */
export function MediaManager({ organizationId, objectId, readOnly = false }: MediaManagerProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Fetch object media count to determine if new uploads should be primary
  const { data: mediaData } = useQuery({
    queryKey: ['object-media', organizationId, objectId],
    queryFn: () => listObjectMedia(organizationId, objectId),
    enabled: !!organizationId && !!objectId,
  });

  const mediaCount = mediaData?.media?.length || 0;

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      // Check if this is the first image (make it primary)
      const isPrimary = mediaCount === 0;
      return uploadObjectMedia(organizationId, objectId, file, {
        is_primary: isPrimary,
        sort_order: mediaCount,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-media', organizationId, objectId] });
      setUploadError(null);
    },
    onError: (error: Error) => {
      setUploadError(error.message);
    },
    onSettled: () => {
      setUploading(false);
    },
  });

  // Handle file selection
  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadError(null);

    // Upload files sequentially
    for (let i = 0; i < files.length; i++) {
      try {
        await uploadMutation.mutateAsync(files[i]);
      } catch {
        // Error handled by mutation
        break;
      }
    }
  }, [uploadMutation]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (readOnly) return;

    const files = e.dataTransfer.files;
    handleFileSelect(files);
  }, [handleFileSelect, readOnly]);

  const handleClickUpload = () => {
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (readOnly) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Upload area: a real button (click / Enter / Space opens the file
          picker) that is also a drop target for dragged files. */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={Object.values(ACCEPTED_FILE_TYPES).join(',')}
        multiple
        onChange={handleInputChange}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className={`
          block w-full border-2 border-dashed rounded-institutional p-6 text-center cursor-pointer transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2
          ${dragOver
            ? 'border-bark bg-bark/5'
            : 'border-lichen hover:border-archive hover:bg-stone/20'
          }
          ${uploading ? 'pointer-events-none opacity-50' : ''}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClickUpload}
        disabled={uploading}
        aria-describedby={uploadError ? errorId : undefined}
      >
        {uploading ? (
          <span className="flex flex-col items-center gap-2" role="status">
            <MadronaLoader />
            <span className="text-sm text-accessible-gray">Uploading...</span>
          </span>
        ) : (
          <span className="flex flex-col items-center gap-2">
            <Upload className="w-8 h-8 text-archive" aria-hidden="true" />
            <span className="text-sm text-ink">
              <span className="font-medium text-bark">Click to upload</span> or drag and drop
            </span>
            <span className="text-xs text-archive">
              Images, videos, audio, or documents
            </span>
          </span>
        )}
      </button>

      {/* Upload error */}
      {uploadError && (
        <div id={errorId} role="alert" className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-institutional text-semantic-error text-sm flex items-start gap-2">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
}

export default MediaManager;
