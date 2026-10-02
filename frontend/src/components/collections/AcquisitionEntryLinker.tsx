import { Link } from 'react-router-dom';
import { Package, ExternalLink } from 'lucide-react';
import { getObjectEntries, updateAcquisition } from '../../lib/api';
import type { ObjectEntry } from '../../lib/schemas';
import { RecordLinkerSingle } from '../records';
import { cn } from '../../lib/utils';
import { formatDateShort } from '@/lib/formatters';

interface AcquisitionEntryLinkerProps {
  organizationId: string;
  acquisitionId: string;
  linkedEntry?: {
    entry_id: string;
    entry_number?: string;
    depositor_name?: string | null;
    reason?: string | null;
    entry_date?: string | null;
    status?: string | null;
    [key: string]: unknown;
  } | null;
  isEditing?: boolean;
  onLinkChange?: () => void;
  onCountChange?: (count: number) => void;
}

/**
 * Component to link an Acquisition to an existing Object Entry record.
 * Mirrors EntryAcquisitionLinker for bidirectional linking per the collections standard.
 */
export function AcquisitionEntryLinker({
  organizationId,
  acquisitionId,
  linkedEntry,
  isEditing = false,
  onLinkChange,
  onCountChange,
}: AcquisitionEntryLinkerProps) {
  return (
    <RecordLinkerSingle
      organizationId={organizationId}
      onCountChange={onCountChange}
      singularNoun="Object Entry"
      emptyLabel="Link to Source Entry"
      linkedItem={linkedEntry ?? null}
      renderItem={(entry) => (
        <Link
          to={`/organizations/${organizationId}/collections/entries/${entry.entry_id}`}
          className="block p-4 bg-bark/5 border border-bark/20 rounded-lg hover:border-bark/40 transition-colors no-underline"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">
                {entry.entry_number || 'Linked Entry'}
              </p>
              <p className="text-sm text-archive mt-1">
                {entry.reason
                  ? entry.reason.charAt(0).toUpperCase() + entry.reason.slice(1).replace('_', ' ')
                  : ''}
                {entry.depositor_name && ` · ${entry.depositor_name}`}
                {entry.entry_date && ` · ${formatDateShort(entry.entry_date)}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs font-medium',
                  entry.status === 'processed'
                    ? 'bg-semantic-success/10 text-semantic-success'
                    : entry.status === 'received'
                      ? 'bg-forest/10 text-forest'
                      : 'bg-semantic-warning/10 text-semantic-warning'
                )}
              >
                {entry.status
                  ? entry.status.charAt(0).toUpperCase() + entry.status.slice(1)
                  : 'Unknown'}
              </span>
              <ExternalLink size={16} className="text-archive" />
            </div>
          </div>
        </Link>
      )}
      isEditing={isEditing}
      onLink={async (item: ObjectEntry) => {
        await updateAcquisition(organizationId, acquisitionId, { entry_id: item.entry_id });
      }}
      onUnlink={async () => {
        if (!linkedEntry) throw new Error('No entry to unlink');
        await updateAcquisition(organizationId, acquisitionId, { entry_id: null });
      }}
      onLinkChange={onLinkChange}
      search={{
        title: 'Link to Object Entry',
        subtitle: 'Search for an existing entry to link this acquisition to',
        placeholder: 'Search by entry number or depositor...',
        searchLabel: 'Search Entries',
        queryKey: ['entries-search', organizationId],
        searchFn: async (term) => {
          const result = await getObjectEntries(organizationId, { q: term, limit: 20 });
          return result.items || [];
        },
        getSearchItemId: (entry) => entry.entry_id,
        getSearchItemLabel: (entry) => entry.entry_number,
        renderSearchItem: (entry) => (
          <div className="flex items-center gap-3">
            <Package size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink font-medium truncate">
                {entry.entry_number}
              </p>
              <p className="text-xs text-archive truncate">
                {[
                  entry.depositor_name,
                  entry.reason &&
                    entry.reason.charAt(0).toUpperCase() +
                      entry.reason.slice(1).replace('_', ' '),
                  entry.entry_date && formatDateShort(entry.entry_date),
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No details'}
              </p>
            </div>
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                entry.status === 'processed'
                  ? 'bg-semantic-success/10 text-semantic-success'
                  : entry.status === 'received'
                    ? 'bg-forest/10 text-forest'
                    : 'bg-semantic-warning/10 text-semantic-warning'
              )}
            >
              {entry.status ? entry.status.charAt(0).toUpperCase() + entry.status.slice(1) : 'Pending'}
            </span>
          </div>
        ),
      }}
      invalidateKeys={[
        ['acquisition', organizationId, acquisitionId],
        ['object-entry', organizationId],
      ]}
      submitLabel="Link to Entry"
    />
  );
}
