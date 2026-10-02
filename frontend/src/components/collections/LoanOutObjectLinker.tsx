import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { formatNumber } from '../../lib/formatters';
import {
  addLoanOutObject,
  getCollectionObjects,
} from '../../lib/api';
import { apiFetch } from '../../lib/apiClient';
import { RecordLinker } from '../records';

interface LoanOutObjectLinkerProps {
  organizationId: string;
  loanId: string;
  isEditing?: boolean;
  onCountChange?: (count: number) => void;
}

interface LoanOutObjectItem {
  loan_object_id: string;
  object_id: string;
  insurance_value?: number;
  object?: {
    object_id: string;
    object_number?: string | null;
    title?: string | null;
    object_name?: string | null;
  };
}

/**
 * Component to manage collection objects linked to a loan out record.
 * Uses the standard RecordLinker pattern with slide-over search.
 */
export function LoanOutObjectLinker({
  organizationId,
  loanId,
  isEditing = false,
  onCountChange,
}: LoanOutObjectLinkerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['loan-out-objects', organizationId, loanId],
    queryFn: async () => {
      const result = await apiFetch<{ objects: LoanOutObjectItem[] }>(
        `/organizations/${organizationId}/collections/loans-out/${loanId}/objects`
      );
      return result;
    },
  });

  const linkedObjects = data?.objects || [];

  return (
    <RecordLinker
      organizationId={organizationId}
      onCountChange={onCountChange}
      title="Loan Objects"
      addLabel="Add Object"
      emptyMessage="No objects linked to this loan yet."
      linkedItems={linkedObjects}
      isLoading={isLoading}
      getItemId={(obj: LoanOutObjectItem) => obj.loan_object_id}
      getLinkedEntityId={(obj: LoanOutObjectItem) => obj.object_id}
      renderItem={(obj: LoanOutObjectItem) => (
        <>
          <Package size={16} className="text-archive" />
          <div>
            <div className="text-sm font-medium text-ink">
              {obj.object?.object_number || 'Unknown'}
            </div>
            {(obj.object?.title || obj.object?.object_name) && (
              <div className="text-xs text-archive">
                {obj.object?.title || obj.object?.object_name}
              </div>
            )}
          </div>
          {obj.insurance_value != null && (
            <span className="text-xs text-archive ml-auto mr-2">
              Insured: ${formatNumber(obj.insurance_value)}
            </span>
          )}
        </>
      )}
      getItemHref={(obj: LoanOutObjectItem) =>
        `/organizations/${organizationId}/collections/objects/${obj.object_id}`
      }
      isEditing={isEditing}
      onLink={async (searchItem) => {
        await addLoanOutObject(organizationId, loanId, {
          object_id: (searchItem as any).object_id,
        });
      }}
      onUnlink={async (obj: LoanOutObjectItem) => {
        await apiFetch(
          `/organizations/${organizationId}/collections/loans-out/${loanId}/objects/${obj.loan_object_id}`,
          { method: 'DELETE' }
        );
      }}
      search={{
        title: 'Add Object to Loan',
        subtitle: 'Search for a collection object to add',
        placeholder: 'Search by accession number or title...',
        searchLabel: 'Search Objects',
        queryKey: ['collection-objects-search', organizationId],
        searchFn: async (term) => {
          const result = await getCollectionObjects(organizationId, {
            search: term,
            limit: 20,
          });
          return result.items || [];
        },
        getSearchItemId: (obj) => (obj as any).object_id,
        getSearchItemLabel: (obj) => (obj as any).object_number || (obj as any).accession_number,
        renderSearchItem: (obj) => (
          <>
            <Package size={16} className="text-archive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink font-medium truncate">
                {(obj as any).object_number || (obj as any).accession_number || 'Unknown'}
              </p>
              <p className="text-xs text-archive truncate">
                {(obj as any).title || (obj as any).object_name || 'Untitled'}
              </p>
            </div>
          </>
        ),
      }}
      invalidateKeys={[
        ['loan-out-objects', organizationId, loanId],
        ['loan-out', organizationId, loanId],
      ]}
      submitLabel="Add to Loan"
    />
  );
}
