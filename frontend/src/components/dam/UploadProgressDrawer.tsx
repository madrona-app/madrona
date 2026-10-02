/**
 * UploadProgressDrawer - Floating drawer showing upload progress
 *
 * Features:
 * - Collapsible drawer in bottom-right corner
 * - Individual file progress bars
 * - Retry failed uploads
 * - Clear completed
 * - Cancel all queued
 */

import { useState } from 'react';
import {
  X,
  ChevronDown,
  ChevronUp,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  Trash2,
  Image,
  Video,
  FileAudio,
  FileText,
  Box,
} from 'lucide-react';
import { useUpload } from '../../contexts/uploadStore';
import { MadronaProgressBar } from '../ui/MadronaLoader';

const FILE_TYPE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  image: Image,
  video: Video,
  audio: FileAudio,
  model: Box,
};

function getFileIcon(file: File) {
  const type = file.type.split('/')[0];
  return FILE_TYPE_ICONS[type] || FileText;
}

export function UploadProgressDrawer() {
  const {
    uploads,
    isUploading,
    completedCount,
    failedCount,
    retryUpload,
    removeUpload,
    clearCompleted,
    cancelAll,
  } = useUpload();

  const [isExpanded, setIsExpanded] = useState(true);

  // Don't show if no uploads
  if (uploads.length === 0) return null;

  const activeUploads = uploads.filter(u => u.status === 'uploading' || u.status === 'queued' || u.status === 'processing');
  const totalProgress = uploads.length > 0
    ? Math.round(uploads.reduce((acc, u) => acc + (u.status === 'completed' ? 100 : u.progress), 0) / uploads.length)
    : 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-parchment rounded-lg shadow-xl border border-lichen overflow-hidden" role="region" aria-label="Upload progress">
      {/* Header - always visible */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-stone/30 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {isUploading ? (
            <Loader2 size={18} className="text-bark animate-spin" />
          ) : failedCount > 0 ? (
            <AlertCircle size={18} className="text-semantic-error" />
          ) : (
            <Check size={18} className="text-semantic-success" />
          )}
          <span className="font-medium text-sm">
            {isUploading
              ? `Uploading ${activeUploads.length} file${activeUploads.length !== 1 ? 's' : ''}...`
              : failedCount > 0
                ? `${failedCount} failed, ${completedCount} completed`
                : `${completedCount} file${completedCount !== 1 ? 's' : ''} uploaded`
            }
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isUploading && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearCompleted();
              }}
              className="p-1 hover:bg-stone rounded text-archive hover:text-ink"
              title="Clear all"
              aria-label="Clear all uploads"
            >
              <X size={16} />
            </button>
          )}
          <button className="p-1 text-archive" aria-label={isExpanded ? 'Collapse upload list' : 'Expand upload list'} aria-expanded={isExpanded}>
            {isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Overall progress bar */}
      {isUploading && (
        <MadronaProgressBar value={totalProgress} className="px-4 pt-1" />
      )}

      {/* Expanded content */}
      {isExpanded && (
        <div className="max-h-64 overflow-y-auto">
          {uploads.map(upload => {
            const Icon = getFileIcon(upload.file);
            return (
              <div
                key={upload.id}
                className="flex items-center gap-3 px-4 py-2 border-b border-lichen last:border-b-0"
              >
                {/* File icon */}
                <Icon size={20} className="flex-shrink-0 text-archive" />

                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate" title={upload.file.name}>
                    {upload.file.name}
                  </p>
                  <div className="flex items-center gap-2">
                    {upload.status === 'queued' && (
                      <span className="text-xs text-archive">Waiting...</span>
                    )}
                    {upload.status === 'uploading' && (
                      <MadronaProgressBar value={upload.progress} className="flex-1" />
                    )}
                    {upload.status === 'processing' && (
                      <span className="text-xs text-bark flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" />
                        Processing...
                      </span>
                    )}
                    {upload.status === 'completed' && (
                      <span className="text-xs text-semantic-success flex items-center gap-1">
                        <Check size={12} />
                        Uploaded
                      </span>
                    )}
                    {upload.status === 'failed' && (
                      <span className="text-xs text-semantic-error flex items-center gap-1">
                        <AlertCircle size={12} />
                        {upload.error || 'Failed'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex-shrink-0">
                  {upload.status === 'failed' && (
                    <button
                      onClick={() => retryUpload(upload.id)}
                      className="p-1 hover:bg-stone rounded text-archive hover:text-bark"
                      title="Retry"
                      aria-label={`Retry uploading ${upload.file.name}`}
                    >
                      <RefreshCw size={14} />
                    </button>
                  )}
                  {(upload.status === 'completed' || upload.status === 'failed') && (
                    <button
                      onClick={() => removeUpload(upload.id)}
                      className="p-1 hover:bg-stone rounded text-archive hover:text-ink"
                      title="Remove"
                      aria-label={`Remove ${upload.file.name} from list`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer actions */}
      {isExpanded && isUploading && uploads.filter(u => u.status === 'queued').length > 0 && (
        <div className="px-4 py-2 border-t border-lichen bg-stone/20">
          <button
            onClick={cancelAll}
            className="text-xs text-archive hover:text-semantic-error"
          >
            Cancel remaining uploads
          </button>
        </div>
      )}
    </div>
  );
}
