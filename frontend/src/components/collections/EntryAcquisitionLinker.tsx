import { Link } from 'react-router-dom';
import { Archive, ExternalLink } from 'lucide-react';
import { getAcquisitions, updateAcquisition } from '../../lib/api';
import type { Acquisition } from '../../lib/schemas';
import { RecordLinkerSingle } from '../records';
import { cn } from '../../lib/utils';

interface EntryAcquisitionLinkerProps {
  organizationId: string;
  entryId: string;
  linkedAcquisition?: {
    acquisition_id: string;
    acquisition_number?: string;
    source_name?: string;
    acquisition_method?: string;
    status?: string;
    [key: string]: unknown;
  } | null;
  isEditing?: boolean;
  onLinkChange?: () => void;
  onCountChange?: (count: number) => void;
}

/**
 * Component to link an Object Entry to an existing Acquisition record.
 */
export function EntryAcquisitionLinker({
  organizationId,
  entryId,
  linkedAcquisition,
  isEditing = false,
  onLinkChange,
  onCountChange,
}: EntryAcquisitionLinkerProps) {
  return (
    <RecordLinkerSingle
      organizationId={organizationId}
      onCountChange={onCountChange}
      singularNoun="Acquisition"
      emptyLabel="Link to Existing Acquisition"
      linkedItem={linkedAcquisition ?? null}
      renderItem={(acq) => (
        <Link
          to={`/organizations/${organizationId}/collections/acquisitions/${acq.acquisition_id}`}
          className="block p-4 bg-forest/5 border border-forest/20 rounded-lg hover:border-forest/40 transition-colors no-underline"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">
                {acq.acquisition_number || 'Linked Acquisition'}
              </p>
              <p className="text-sm text-archive mt-1">
                {acq.acquisition_method
                  ? acq.acquisition_method.charAt(0).toUpperCase() + acq.acquisition_method.slice(1)
                  : ''}
                {acq.source_name && ` from ${acq.source_name}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs font-medium',
                  acq.status === 'completed'
                    ? 'bg-semantic-success/10 text-semantic-success'
                    : acq.status === 'approved'
                      ? 'bg-forest/10 text-forest'
                      : 'bg-semantic-warning/10 text-semantic-warning'
                )}
              >
                {acq.status
                  ? acq.status.charAt(0).toUpperCase() + acq.status.slice(1)
                  : 'Unknown'}
              </span>
              <ExternalLink size={16} className="text-archive" />
            </div>
          </div>
        </Link>
      )}
      isEditing={isEditing}
      onLink={async (item: Acquisition) => {
        await updateAcquisition(organizationId, item.acquisition_id, { entry_id: entryId });
      }}
      onUnlink={async () => {
        if (!linkedAcquisition) throw new Error('No acquisition to unlink');
        await updateAcquisition(organizationId, linkedAcquisition.acquisition_id, {
          entry_id: null,
        });
      }}
      onLinkChange={onLinkChange}
      search={{
        title: 'Link to Acquisition',
        subtitle: 'Search for an existing acquisition to link this entry to',
        placeholder: 'Search by acquisition number or source...',
        searchLabel: 'Search Acquisitions',
        queryKey: ['acquisitions-search', organizationId],
        searchFn: async (term) => {
          const result = await getAcquisitions(organizationId, { q: term, limit: 20 });
          return result.items || [];
        },
        getSearchItemId: (acq) => acq.acquisition_id,
        getSearchItemLabel: (acq) => acq.acquisition_number,
        renderSearchItem: (acq) => (
          <div className="flex items-center gap-3">
            <Archive size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink font-medium truncate">
                {acq.acquisition_number}
              </p>
              <p className="text-xs text-archive truncate">
                {[
                  acq.source_name,
                  acq.acquisition_method &&
                    acq.acquisition_method.charAt(0).toUpperCase() +
                      acq.acquisition_method.slice(1),
                ]
                  .filter(Boolean)
                  .join(' \u00b7 ') || 'No details'}
              </p>
            </div>
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                acq.status === 'completed'
                  ? 'bg-semantic-success/10 text-semantic-success'
                  : acq.status === 'approved'
                    ? 'bg-forest/10 text-forest'
                    : 'bg-semantic-warning/10 text-semantic-warning'
              )}
            >
              {acq.status.charAt(0).toUpperCase() + acq.status.slice(1)}
            </span>
          </div>
        ),
      }}
      invalidateKeys={[
        ['object-entry', organizationId, entryId],
        ['acquisitions', organizationId],
      ]}
      submitLabel="Link to Acquisition"
    />
  );
}

export default EntryAcquisitionLinker;
