import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Activity, History, ListChecks } from 'lucide-react';
import { VersionHistoryTab, ProcessingHistoryTab } from '../../../components/dam';
import { RecordAuditHistory } from '../../../components/workspace/RecordAuditHistory';
import { cn } from '../../../lib/utils';
import type { MediaDetailOutletContext } from './types';

type HistorySection = 'processing' | 'versions' | 'changes';

const SECTIONS: { key: HistorySection; label: string; icon: typeof Activity }[] = [
  { key: 'processing', label: 'Processing', icon: Activity },
  { key: 'versions', label: 'Versions', icon: History },
  // Who changed the record: fields, tags, alternatives, annotations,
  // preservation actions.
  { key: 'changes', label: 'Record changes', icon: ListChecks },
];

export default function HistoryPage() {
  const { organizationId, mediaId, media } = useOutletContext<MediaDetailOutletContext>();
  const [section, setSection] = useState<HistorySection>('processing');

  return (
    <div>
      {/* Section toggle */}
      <div className="flex items-center gap-1 px-4 pt-4 sm:px-6 sm:pt-6" role="group" aria-label="History sections">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-pressed={section === key}
            onClick={() => setSection(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
              section === key
                ? 'bg-azurite/10 text-azurite font-medium'
                : 'text-archive hover:text-ink hover:bg-stone/30'
            )}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </button>
        ))}
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

      {section === 'changes' && (
        <div className="p-4 sm:p-6">
          <RecordAuditHistory
            organizationId={organizationId}
            entityType="media"
            entityId={mediaId}
            title="Record changes"
            headingLevel={2}
          />
        </div>
      )}
    </div>
  );
}
