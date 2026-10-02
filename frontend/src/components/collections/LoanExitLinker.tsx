import { useQuery } from '@tanstack/react-query';
import { FileOutput } from 'lucide-react';
import { formatDateShort } from '../../lib/formatters';
import { getObjectExits, updateObjectExit } from '../../lib/api';
import type { ObjectExit } from '../../lib/schemas';
import { RecordLinker } from '../records';

interface LoanExitLinkerProps {
  organizationId: string;
  loanId: string;
  lenderName?: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

/**
 * Component to manage object exits linked to a loan in record.
 */
export function LoanExitLinker({
  organizationId,
  loanId,
  lenderName,
  isEditing = false,
  onCountChange,
}: LoanExitLinkerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['loan-in-object-exits', organizationId, loanId],
    queryFn: () => getObjectExits(organizationId, { reference_type: 'loan_in', reference_id: loanId, limit: 100 }),
  });

  const linkedExits = data?.items || [];

  return (
    <RecordLinker
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Linked Exits"
      addLabel="Link Exit"
      emptyMessage="No object exits linked to this loan."
      linkedItems={linkedExits}
      isLoading={isLoading}
      getItemId={(exit: ObjectExit) => exit.exit_id}
      renderItem={(exit: ObjectExit) => (
        <>
          <FileOutput size={16} className="text-archive" />
          <div>
            <div className="text-sm font-medium text-ink">{exit.exit_number}</div>
            <div className="text-xs text-archive">
              {exit.recipient_name ? `To ${exit.recipient_name}` : lenderName ? `To ${lenderName}` : 'Return exit'}
              {exit.exit_date && ` \u00b7 ${formatDateShort(exit.exit_date)}`}
            </div>
          </div>
          {exit.status && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-stone text-archive ml-auto mr-2">
              {exit.status.charAt(0).toUpperCase() + exit.status.slice(1).replace('_', ' ')}
            </span>
          )}
        </>
      )}
      getItemHref={(exit: ObjectExit) =>
        `/organizations/${organizationId}/collections/exits/${exit.exit_id}`
      }
      isEditing={isEditing}
      onLink={async (exit: ObjectExit) => {
        await updateObjectExit(organizationId, exit.exit_id, {
          reference_type: 'loan_in',
          reference_id: loanId,
        });
      }}
      onUnlink={async (exit: ObjectExit) => {
        await updateObjectExit(organizationId, exit.exit_id, {
          reference_type: null,
          reference_id: null,
        });
      }}
      search={{
        title: 'Link Object Exit',
        subtitle: 'Search for an object exit record to link',
        placeholder: 'Search by exit number or recipient...',
        searchLabel: 'Search Exits',
        queryKey: ['object-exits-search', organizationId],
        searchFn: async (term) => {
          const result = await getObjectExits(organizationId, { q: term, limit: 20, exit_reason: 'loan_return' });
          return result.items || [];
        },
        getSearchItemId: (exit) => exit.exit_id,
        getSearchItemLabel: (exit) => exit.exit_number,
        filterLinked: (items, linkedIds) =>
          items.filter((exit) => !linkedIds.has(exit.exit_id) && (!exit.reference_id || exit.reference_id === loanId)),
        renderSearchItem: (exit) => (
          <>
            <FileOutput size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink font-medium truncate">{exit.exit_number}</p>
              <p className="text-xs text-archive truncate">
                {[exit.recipient_name, exit.exit_date && formatDateShort(exit.exit_date)]
                  .filter(Boolean)
                  .join(' \u00b7 ') || 'No details'}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={[
        ['loan-in-object-exits', organizationId, loanId],
        ['object-exits', organizationId],
      ]}
      submitLabel="Link Exit"
    />
  );
}
