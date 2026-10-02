/**
 * TranscriptPanel — displays transcript from Whisper, allows triggering transcription.
 * Shows on MediaDetailPage as a tab.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Play, Copy, Check, Download, Edit2, Save, X } from 'lucide-react';
import { getTranscript, triggerTranscription } from '../../lib/api/media-dam';
import { useToast } from '../../contexts/ToastContext';

/**
 * Convert plain transcript text to SRT subtitle format.
 * Splits into ~10-second segments of ~20 words each.
 */
function transcriptToSRT(text: string): string {
  const words = text.split(/\s+/);
  const segmentWords = 20;
  const segmentDuration = 10;
  const lines: string[] = [];
  let index = 1;

  for (let i = 0; i < words.length; i += segmentWords) {
    const segment = words.slice(i, i + segmentWords).join(' ');
    const startSec = Math.floor(i / segmentWords) * segmentDuration;
    const endSec = startSec + segmentDuration;
    const startTime = formatSRTTime(startSec);
    const endTime = formatSRTTime(endSec);
    lines.push(`${index}\n${startTime} --> ${endTime}\n${segment}\n`);
    index++;
  }
  return lines.join('\n');
}

function transcriptToVTT(text: string): string {
  return 'WEBVTT\n\n' + transcriptToSRT(text).replace(/(\d+)\n/g, (_, num) => `${num}\n`);
}

function formatSRTTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},000`;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface TranscriptPanelProps {
  organizationId: string;
  mediaId: string;
  mediaType: string;
}

export function TranscriptPanel({
  organizationId,
  mediaId,
  mediaType,
}: TranscriptPanelProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState('');

  const isTranscribable = mediaType === 'video' || mediaType === 'audio';

  const { data, isLoading } = useQuery({
    queryKey: ['media-transcript', organizationId, mediaId],
    queryFn: () => getTranscript(organizationId, mediaId),
    enabled: !!organizationId && !!mediaId && isTranscribable,
  });

  const transcribeMutation = useMutation({
    mutationFn: () => triggerTranscription(organizationId, mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['media-transcript', organizationId, mediaId],
      });
      showToast({ title: 'Transcription started', type: 'success' });
    },
    onError: (error: Error) => {
      showToast({
        title: `Transcription failed: ${error.message}`,
        type: 'error',
      });
    },
  });

  const handleCopy = async () => {
    if (data?.transcript) {
      await navigator.clipboard.writeText(data.transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isTranscribable) {
    return (
      <div className="text-sm text-archive py-8 text-center">
        <FileText size={24} className="mx-auto mb-2 opacity-50" />
        <p>Transcription is only available for audio and video files.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-archive" />
      </div>
    );
  }

  const hasTranscript = data?.transcript && data.transcript.length > 0;
  const isProcessing = data?.status === 'processing';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-archive" />
          <h3 className="text-sm font-medium text-ink">Transcript</h3>
          {data?.language && (
            <span className="text-xs bg-stone/30 text-archive px-2 py-0.5 rounded">
              {data.language.toUpperCase()}
            </span>
          )}
          {data?.model && (
            <span className="text-xs text-archive">
              ({data.model})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasTranscript && !isEditing && (
            <>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 text-xs text-archive hover:text-ink transition-colors"
                title="Copy transcript"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => {
                  setEditedText(data?.transcript || '');
                  setIsEditing(true);
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs text-archive hover:text-ink transition-colors"
                title="Edit transcript"
              >
                <Edit2 size={14} />
                Edit
              </button>
              <button
                onClick={() => downloadFile(transcriptToSRT(data!.transcript!), `transcript-${mediaId.slice(0, 8)}.srt`, 'text/plain')}
                className="flex items-center gap-1 px-2 py-1 text-xs text-archive hover:text-ink transition-colors"
                title="Export as SRT"
              >
                <Download size={14} />
                SRT
              </button>
              <button
                onClick={() => downloadFile(transcriptToVTT(data!.transcript!), `transcript-${mediaId.slice(0, 8)}.vtt`, 'text/vtt')}
                className="flex items-center gap-1 px-2 py-1 text-xs text-archive hover:text-ink transition-colors"
                title="Export as VTT"
              >
                <Download size={14} />
                VTT
              </button>
            </>
          )}

          {isEditing ? (
            <>
              <button
                onClick={() => setIsEditing(false)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-archive hover:text-ink transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
              <button
                onClick={() => {
                  // Save edited transcript via copy for now (backend PUT not yet available)
                  navigator.clipboard.writeText(editedText);
                  showToast({ title: 'Edited transcript copied to clipboard', type: 'success' });
                  setIsEditing(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bark text-parchment rounded hover:bg-bark/90 transition-colors"
              >
                <Save size={14} />
                Copy Edited
              </button>
            </>
          ) : (
            <button
              onClick={() => transcribeMutation.mutate()}
              disabled={transcribeMutation.isPending || isProcessing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bark text-parchment rounded hover:bg-bark/90 disabled:opacity-50 transition-colors"
            >
              {transcribeMutation.isPending || isProcessing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              {hasTranscript ? 'Re-transcribe' : 'Generate Transcript'}
            </button>
          )}
        </div>
      </div>

      {/* Status */}
      {isProcessing && (
        <div className="flex items-center gap-2 p-3 bg-semantic-warning/10 border border-semantic-warning/20 rounded-lg">
          <Loader2 size={16} className="animate-spin text-semantic-warning" />
          <span className="text-sm text-semantic-warning">
            Transcription in progress... This may take a few minutes.
          </span>
        </div>
      )}

      {data?.status === 'failed' && (
        <div className="p-3 bg-semantic-error/10 border border-semantic-error/20 rounded-lg">
          <span className="text-sm text-semantic-error">
            Transcription failed. Try again or contact support.
          </span>
        </div>
      )}

      {/* Transcript content */}
      {hasTranscript ? (
        <div className="p-4 bg-stone border border-lichen rounded-lg max-h-96 overflow-y-auto">
          {isEditing ? (
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="w-full min-h-[200px] text-sm text-ink bg-parchment border border-lichen rounded p-3 leading-relaxed resize-y focus-visible:ring-2 ring-bark/30 ring-offset-2"
            />
          ) : (
            <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">
              {data.transcript}
            </p>
          )}
        </div>
      ) : (
        !isProcessing && (
          <div className="py-8 text-center text-sm text-archive">
            <FileText size={32} className="mx-auto mb-3 opacity-30" />
            <p>No transcript available.</p>
            <p className="mt-1 text-xs">
              Click &ldquo;Generate Transcript&rdquo; to transcribe this{' '}
              {mediaType} using Whisper AI.
            </p>
          </div>
        )
      )}
    </div>
  );
}
