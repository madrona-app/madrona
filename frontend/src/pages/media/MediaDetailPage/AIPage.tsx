import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Sparkles, FileAudio } from 'lucide-react';
import { MediaAITagsTab } from '../../../components/dam';
import { TranscriptPanel } from '../../../components/dam/TranscriptPanel';
import { cn } from '../../../lib/utils';
import { useAuth } from '../../../hooks/useAuth';
import type { MediaDetailOutletContext } from './types';

type AISection = 'tags' | 'transcript';

export default function AIPage() {
  const { organizationId, mediaId, media } = useOutletContext<MediaDetailOutletContext>();
  const { user } = useAuth();
  // Both halves are deployment capabilities, off unless a model is
  // configured. Offer only what the server can actually produce.
  const taggingEnabled = user?.ai_tagging_enabled !== false;
  const transcriptionEnabled = user?.transcription_enabled !== false;
  const hasTranscript =
    transcriptionEnabled && (media.media_type === 'video' || media.media_type === 'audio');
  const [section, setSection] = useState<AISection>(taggingEnabled ? 'tags' : 'transcript');

  return (
    <div>
      {/* Section toggle */}
      {hasTranscript && taggingEnabled && (
        <div className="flex items-center gap-1 px-4 pt-4 sm:px-6 sm:pt-6">
          <button
            onClick={() => setSection('tags')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors',
              section === 'tags'
                ? 'bg-azurite/10 text-azurite font-medium'
                : 'text-archive hover:text-ink hover:bg-stone/30'
            )}
          >
            <Sparkles size={14} />
            Auto-Tags
          </button>
          <button
            onClick={() => setSection('transcript')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors',
              section === 'transcript'
                ? 'bg-azurite/10 text-azurite font-medium'
                : 'text-archive hover:text-ink hover:bg-stone/30'
            )}
          >
            <FileAudio size={14} />
            Transcript
          </button>
        </div>
      )}

      {section === 'tags' && taggingEnabled && (
        <MediaAITagsTab
          organizationId={organizationId}
          mediaId={mediaId}
          aiProcessingStatus={media.ai_processing_status}
          aiProcessedAt={media.ai_processed_at}
          aiLabelCount={media.ai_label_count}
        />
      )}

      {section === 'transcript' && hasTranscript && (
        <div className="p-4 sm:p-6">
          <TranscriptPanel
            organizationId={organizationId}
            mediaId={mediaId}
            mediaType={media.media_type}
          />
        </div>
      )}
    </div>
  );
}
