/**
 * AlternativeFilesTab — list/download/manage alternative files (transcripts, subtitles, conversions).
 * Shows on MediaDetailPage as a tab.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2, FileText, Film, Loader2, Upload } from 'lucide-react';
import {
  getAlternatives,
  getAlternativeDownloadUrl,
  deleteAlternative,
} from '../../lib/api/media-dam';
import { useToast } from '../../contexts/ToastContext';
import ConfirmDialog from '../ConfirmDialog';

interface AlternativeFilesTabProps {
  organizationId: string;
  mediaId: string;
}

const TYPE_ICONS: Record<string, typeof FileText> = {
  transcript_txt: FileText,
  subtitle_srt: Film,
  subtitle_vtt: Film,
  crop: FileText,
  conversion: FileText,
  ocr_txt: FileText,
};

const TYPE_LABELS: Record<string, string> = {
  transcript_txt: 'Transcript',
  subtitle_srt: 'SRT Subtitles',
  subtitle_vtt: 'VTT Subtitles',
  crop: 'Crop',
  conversion: 'Conversion',
  ocr_txt: 'OCR Text',
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AlternativeFilesTab({
  organizationId,
  mediaId,
}: AlternativeFilesTabProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [confirmState, setConfirmState] = useState<{action: () => void; title: string; message: string} | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['media-alternatives', organizationId, mediaId],
    queryFn: () => getAlternatives(organizationId, mediaId),
    enabled: !!organizationId && !!mediaId,
  });

  const deleteMutation = useMutation({
    mutationFn: (altId: string) =>
      deleteAlternative(organizationId, mediaId, altId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['media-alternatives', organizationId, mediaId],
      });
      showToast({ title: 'Alternative file deleted', type: 'success' });
    },
  });

  const handleDownload = async (altId: string, filename: string) => {
    try {
      const { download_url } = await getAlternativeDownloadUrl(
        organizationId,
        mediaId,
        altId
      );
      const a = document.createElement('a');
      a.href = download_url;
      a.download = filename;
      a.click();
    } catch {
      showToast({ title: 'Failed to generate download link', type: 'error' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-archive" />
      </div>
    );
  }

  const alternatives = data?.alternatives || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">
          Alternative Files ({alternatives.length})
        </h3>
      </div>

      {alternatives.length === 0 ? (
        <div className="py-8 text-center text-sm text-archive">
          <Upload size={24} className="mx-auto mb-2 opacity-30" />
          <p>No alternative files yet.</p>
          <p className="text-xs mt-1">
            Transcription and OCR will automatically create alternative files.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-lichen border border-lichen rounded-lg overflow-hidden">
          {alternatives.map((alt) => {
            const Icon = TYPE_ICONS[alt.alternative_type] || FileText;
            return (
              <div
                key={alt.alternative_id}
                className="flex items-center justify-between p-3 hover:bg-stone transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon size={16} className="text-archive flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">
                      {alt.label || alt.filename}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-archive">
                      <span>
                        {TYPE_LABELS[alt.alternative_type] || alt.alternative_type}
                      </span>
                      {alt.file_size && (
                        <>
                          <span>&middot;</span>
                          <span>{formatFileSize(alt.file_size)}</span>
                        </>
                      )}
                      {alt.generated_by && (
                        <>
                          <span>&middot;</span>
                          <span>by {alt.generated_by}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      handleDownload(alt.alternative_id, alt.filename)
                    }
                    className="p-1.5 text-archive hover:text-ink transition-colors"
                    title="Download"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setConfirmState({
                        action: () => deleteMutation.mutate(alt.alternative_id),
                        title: 'Delete Alternative File',
                        message: 'Delete this alternative file?',
                      });
                    }}
                    className="p-1.5 text-archive hover:text-semantic-error transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null); }}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmText="Confirm"
        confirmStyle="danger"
      />
    </div>
  );
}
