import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Activity, History } from 'lucide-react';
import { VersionHistoryTab, ProcessingHistoryTab } from '../../../components/dam';
import { cn } from '../../../lib/utils';
import type { MediaDetailOutletContext } from './types';

type HistorySection = 'processing' | 'versions';

export default function HistoryPage() {
  const { organizationId, mediaId, media } = useOutletContext<MediaDetailOutletContext>();
  const [section, setSection] = useState<HistorySection>('processing');

  return (
    <div>
      {/* Section toggle */}
      <div className="flex items-center gap-1 px-4 pt-4 sm:px-6 sm:pt-6">
        <button
          onClick={() => setSection('processing')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors',
            section === 'processing'
              ? 'bg-azurite/10 text-azurite font-medium'
              : 'text-archive hover:text-ink hover:bg-stone/30'
          )}
        >
          <Activity size={14} />
          Processing
        </button>
        <button
          onClick={() => setSection('versions')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors',
            section === 'versions'
              ? 'bg-azurite/10 text-azurite font-medium'
              : 'text-archive hover:text-ink hover:bg-stone/30'
          )}
        >
          <History size={14} />
          Versions
        </button>
      </div>

      {section === 'processing' && (
        <div className="p-4 sm:p-6">
          <ProcessingHistoryTab
            organizationId={organizationId}
            mediaId={mediaId}
          />
        </div>
      )}

      {section === 'versions' && (
        <div className="p-4 sm:p-6">
          <VersionHistoryTab
            organizationId={organizationId}
            mediaId={mediaId}
            currentVersion={media.current_version || 1}
            mediaType={media.media_type}
          />
        </div>
      )}
    </div>
  );
}
