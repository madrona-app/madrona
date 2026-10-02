import { Link } from 'react-router-dom';
import { Download, ExternalLink } from 'lucide-react';
import { getLoansIn, addLoanInObjectEntry, removeLoanInObjectEntry } from '../../lib/api';
import type { LoanIn } from '../../lib/schemas';
import { RecordLinkerSingle } from '../records';
import { cn } from '../../lib/utils';

interface EntryLoanLinkerProps {
  organizationId: string;
  entryId: string;
  linkedLoan?: {
    loan_in_id: string;
    loan_number?: string;
    lender_name?: string;
    loan_purpose?: string;
    status?: string;
    [key: string]: unknown;
  } | null;
  loanInEntryId?: string | null;
  isEditing?: boolean;
  onLinkChange?: () => void;
  onCountChange?: (count: number) => void;
}

/**
 * Component to link an Object Entry to an existing Loan In record.
 */
export function EntryLoanLinker({
  organizationId,
  entryId,
  linkedLoan,
  loanInEntryId,
  isEditing = false,
  onLinkChange,
  onCountChange,
}: EntryLoanLinkerProps) {
  return (
    <RecordLinkerSingle
      organizationId={organizationId}
      onCountChange={onCountChange}
      singularNoun="Loan In"
      emptyLabel="Link to Existing Loan In"
      linkedItem={linkedLoan ?? null}
      renderItem={(loan) => (
        <Link
          to={`/organizations/${organizationId}/collections/loans-in/${loan.loan_in_id}`}
          className="block p-4 bg-copper/5 border border-copper/20 rounded-lg hover:border-copper/40 transition-colors no-underline"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink">
                {loan.loan_number || 'Linked Loan'}
              </p>
              <p className="text-sm text-archive mt-1">
                {loan.loan_purpose
                  ? loan.loan_purpose.charAt(0).toUpperCase() +
                    loan.loan_purpose.slice(1).replace('_', ' ')
                  : 'Loan'}
                {loan.lender_name && ` from ${loan.lender_name}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs font-medium',
                  loan.status === 'returned'
                    ? 'bg-stone text-archive'
                    : loan.status === 'on_loan'
                      ? 'bg-semantic-success/10 text-semantic-success'
                      : loan.status === 'approved'
                        ? 'bg-forest/10 text-forest'
                        : 'bg-semantic-warning/10 text-semantic-warning'
                )}
              >
                {loan.status
                  ? loan.status.charAt(0).toUpperCase() + loan.status.slice(1)
                  : 'Unknown'}
              </span>
              <ExternalLink size={16} className="text-archive" />
            </div>
          </div>
        </Link>
      )}
      isEditing={isEditing}
      onLink={async (item: LoanIn) => {
        await addLoanInObjectEntry(organizationId, item.loan_in_id, { entry_id: entryId });
      }}
      onUnlink={async () => {
        if (!linkedLoan || !loanInEntryId) throw new Error('No loan to unlink');
        await removeLoanInObjectEntry(organizationId, linkedLoan.loan_in_id, loanInEntryId);
      }}
      onLinkChange={onLinkChange}
      search={{
        title: 'Link to Loan In',
        subtitle: 'Search for an existing loan to link this entry to',
        placeholder: 'Search by loan number or lender...',
        searchLabel: 'Search Loans',
        queryKey: ['loans-in-search', organizationId],
        searchFn: async (term) => {
          const result = await getLoansIn(organizationId, { q: term, limit: 20 });
          return result.items || [];
        },
        getSearchItemId: (loan) => loan.loan_in_id,
        getSearchItemLabel: (loan) => loan.loan_number,
        renderSearchItem: (loan) => (
          <div className="flex items-center gap-3">
            <Download size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink font-medium truncate">{loan.loan_number}</p>
              <p className="text-xs text-archive truncate">
                {[
                  loan.lender_name,
                  loan.loan_purpose &&
                    loan.loan_purpose.charAt(0).toUpperCase() +
                      loan.loan_purpose.slice(1).replace('_', ' '),
                ]
                  .filter(Boolean)
                  .join(' \u00b7 ') || 'No details'}
              </p>
            </div>
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                loan.status === 'returned'
                  ? 'bg-stone text-archive'
                  : loan.status === 'on_loan'
                    ? 'bg-semantic-success/10 text-semantic-success'
                    : 'bg-semantic-warning/10 text-semantic-warning'
              )}
            >
              {loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}
            </span>
          </div>
        ),
      }}
      invalidateKeys={[
        ['object-entry', organizationId, entryId],
        ['loans-in', organizationId],
      ]}
      submitLabel="Link to Loan"
    />
  );
}

export default EntryLoanLinker;
