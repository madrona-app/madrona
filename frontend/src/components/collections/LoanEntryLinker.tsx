import { useQuery } from '@tanstack/react-query';
import { FileInput } from 'lucide-react';
import { formatDateShort } from '../../lib/formatters';
import {
  getLoanInObjectEntries,
  addLoanInObjectEntry,
  removeLoanInObjectEntry,
  getObjectEntries,
  type LoanInEntryLink,
} from '../../lib/api';
import { RecordLinker } from '../records';

interface LoanEntryLinkerProps {
  organizationId: string;
  loanId: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

/**
 * Component to manage object entries linked to a loan in record.
 */
export function LoanEntryLinker({
  organizationId,
  loanId,
  isEditing = false,
  onCountChange,
}: LoanEntryLinkerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['loan-in-object-entries', organizationId, loanId],
    queryFn: () => getLoanInObjectEntries(organizationId, loanId),
  });

  const linkedEntries = data?.entries || [];

  return (
    <RecordLinker
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Linked Entries"
      addLabel="Link Entry"
      emptyMessage="No object entries linked to this loan."
      linkedItems={linkedEntries}
      isLoading={isLoading}
      getItemId={(link: LoanInEntryLink) => link.loan_in_entry_id}
      getLinkedEntityId={(link: LoanInEntryLink) => link.entry_id}
      renderItem={(link: LoanInEntryLink) => (
        <>
          <FileInput size={16} className="text-archive" />
          <div>
            <div className="text-sm font-medium text-ink">
              {link.entry_number || 'Unknown Entry'}
            </div>
            {link.depositor_name && (
              <div className="text-xs text-archive">From {link.depositor_name}</div>
            )}
          </div>
          {link.status && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-stone text-archive ml-auto mr-2">
              {link.status.charAt(0).toUpperCase() + link.status.slice(1).replace('_', ' ')}
            </span>
          )}
        </>
      )}
      getItemHref={(link: LoanInEntryLink) =>
        `/organizations/${organizationId}/collections/entries/${link.entry_id}`
      }
      isEditing={isEditing}
      onLink={async (entry) => {
        await addLoanInObjectEntry(organizationId, loanId, { entry_id: (entry as any).entry_id });
      }}
      onUnlink={async (link: LoanInEntryLink) => {
        await removeLoanInObjectEntry(organizationId, loanId, link.loan_in_entry_id);
      }}
      search={{
        title: 'Link Object Entry',
        subtitle: 'Search for an object entry record to link',
        placeholder: 'Search by entry number or depositor...',
        searchLabel: 'Search Entries',
        queryKey: ['object-entries-search', organizationId],
        searchFn: async (term) => {
          const result = await getObjectEntries(organizationId, { q: term, limit: 20 });
          return result.items || [];
        },
        getSearchItemId: (entry) => (entry as any).entry_id,
        getSearchItemLabel: (entry) => (entry as any).entry_number,
        renderSearchItem: (entry) => (
          <>
            <FileInput size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink font-medium truncate">{(entry as any).entry_number}</p>
              <p className="text-xs text-archive truncate">
                {[(entry as any).depositor_name, (entry as any).entry_date && formatDateShort((entry as any).entry_date)]
                  .filter(Boolean)
                  .join(' \u00b7 ') || 'No details'}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={[['loan-in-object-entries', organizationId, loanId]]}
      submitLabel="Link Entry"
    />
  );
}
