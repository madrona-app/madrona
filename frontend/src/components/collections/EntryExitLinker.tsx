import { Link } from 'react-router-dom';
import { LogOut, ExternalLink } from 'lucide-react';
import { formatDateShort } from '../../lib/formatters';
import { getObjectExits, updateObjectExit } from '../../lib/api';
import type { ObjectExit } from '../../lib/schemas';
import { RecordLinkerSingle } from '../records';

interface EntryExitLinkerProps {
  organizationId: string;
  entryId: string;
  linkedExit?: {
    exit_id: string;
    exit_number?: string;
    recipient_name?: string;
    exit_date?: string;
    status?: string;
    [key: string]: unknown;
  } | null;
  depositorName?: string;
  isEditing?: boolean;
  onLinkChange?: () => void;
  onCountChange?: (count: number) => void;
}

/**
 * Component to link an Object Entry to an existing Object Exit record.
 */
export function EntryExitLinker({
  organizationId,
  entryId,
  linkedExit,
  depositorName,
  isEditing = false,
  onLinkChange,
  onCountChange,
}: EntryExitLinkerProps) {
  return (
    <RecordLinkerSingle
      organizationId={organizationId}
      onCountChange={onCountChange}
      singularNoun="Object Exit"
      emptyLabel="Link to Existing Object Exit"
      linkedItem={linkedExit ?? null}
      renderItem={(exit) => (
        <Link
          to={`/organizations/${organizationId}/collections/exits/${exit.exit_id}`}
          className="block p-4 bg-stone/30 border border-stone rounded-lg hover:border-archive transition-colors no-underline"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">
                {exit.exit_number || 'Linked Exit'}
              </p>
              <p className="text-sm text-archive mt-1">
                Returned to {exit.recipient_name || depositorName || 'recipient'}
                {exit.exit_date &&
                  ` on ${formatDateShort(exit.exit_date)}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-stone text-archive">
                {exit.status
                  ? exit.status.charAt(0).toUpperCase() +
                    exit.status.slice(1).replace('_', ' ')
                  : 'Unknown'}
              </span>
              <ExternalLink size={16} className="text-archive" />
            </div>
          </div>
        </Link>
      )}
      isEditing={isEditing}
      onLink={async (item: ObjectExit) => {
        await updateObjectExit(organizationId, item.exit_id, { entry_id: entryId });
      }}
      onUnlink={async () => {
        if (!linkedExit) throw new Error('No exit to unlink');
        await updateObjectExit(organizationId, linkedExit.exit_id, { entry_id: null });
      }}
      onLinkChange={onLinkChange}
      search={{
        title: 'Link to Object Exit',
        subtitle: 'Search for an existing exit to link this entry to',
        placeholder: 'Search by exit number or recipient...',
        searchLabel: 'Search Exits',
        queryKey: ['object-exits-search', organizationId],
        searchFn: async (term) => {
          const result = await getObjectExits(organizationId, { q: term, limit: 20 });
          return result.items || [];
        },
        getSearchItemId: (exit) => exit.exit_id,
        getSearchItemLabel: (exit) => exit.exit_number,
        renderSearchItem: (exit) => (
          <>
            <LogOut size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink font-medium truncate">{exit.exit_number}</p>
              <p className="text-xs text-archive truncate">
                {[
                  exit.recipient_name,
                  exit.exit_date && formatDateShort(exit.exit_date),
                ]
                  .filter(Boolean)
                  .join(' \u00b7 ') || 'No details'}
              </p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-stone text-archive">
              {exit.status.charAt(0).toUpperCase() +
                exit.status.slice(1).replace('_', ' ')}
            </span>
          </>
        ),
      }}
      invalidateKeys={[
        ['object-entry', organizationId, entryId],
        ['object-exits', organizationId],
      ]}
      submitLabel="Link to Exit"
    />
  );
}

export default EntryExitLinker;
